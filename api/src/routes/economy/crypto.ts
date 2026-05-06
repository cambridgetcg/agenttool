/** /v1/wallets/:id/{deposit-address,onchain,payouts} + crypto webhooks.
 *
 *  Foundation for sovereign-agent crypto payment. The agent gets a
 *  deterministic deposit address per chain, sends USDC there from its
 *  own wallet, and the inbound webhook credits its agenttool balance.
 *  Onchain identity binding lets the agent prove it controls the address.
 *
 *  Doctrine: docs/CRYPTO-PAYMENT.md.
 *  Phase 3c will fill in: payout broadcast, Solana derivation + sigverify,
 *  multi-provider webhook adapters (Alchemy + Helius + ...). */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { wallets } from "../../db/schema/economy";
import {
  ALL_CHAINS,
  isChain,
  isEvmChain,
  USDC_ADDRESSES,
  type Chain,
  type EvmChain,
} from "../../services/economy/crypto/chains";
import {
  getOrCreateDepositAddress,
  ingestInboundTransfer,
  issueChallenge,
  listDepositAddresses,
  listOnchainIdentities,
  listPayouts,
  requestPayout,
  verifyAndBind,
} from "../../services/economy/crypto";
import { economyConfig } from "../../services/economy/config";

import { createHmac } from "node:crypto";

const router = new Hono<ProjectContext>();

// ── Wallet ownership check (used by all wallet-scoped routes) ──────────

async function ensureWalletOwnership(
  c: { var: { project: { id: string } } },
  walletId: string,
) {
  const [w] = await db.select().from(wallets).where(eq(wallets.id, walletId));
  if (!w || w.projectId !== c.var.project.id) {
    throw new HTTPException(404, { message: "wallet_not_found" });
  }
  return w;
}

// ── GET /v1/wallets/:id/deposit-address?chain=&token= ──────────────────
router.get("/wallets/:walletId/deposit-address", async (c) => {
  const walletId = c.req.param("walletId");
  await ensureWalletOwnership(c, walletId);

  const chainParam = c.req.query("chain");
  const token = c.req.query("token") ?? "USDC";

  // No chain filter → list all minted addresses.
  if (!chainParam) {
    const rows = await listDepositAddresses(walletId);
    return c.json({
      wallet_id: walletId,
      addresses: rows.map((r) => ({
        chain: r.chain,
        token: r.token,
        address: r.address,
        derivation_path: r.derivationPath,
        created_at: r.createdAt.toISOString(),
      })),
      supported_chains: ALL_CHAINS,
      hint: "Pass ?chain=base&token=USDC to mint or fetch a specific address.",
    });
  }

  if (!isChain(chainParam)) {
    throw new HTTPException(400, {
      message: `chain must be one of: ${ALL_CHAINS.join(", ")}`,
    });
  }

  const result = await getOrCreateDepositAddress(
    walletId,
    chainParam as Chain,
    token,
  );

  return c.json({
    wallet_id: walletId,
    chain: result.chain,
    token: result.token,
    address: result.address,
    derivation_path: result.derivation_path,
    contract_address: isEvmChain(result.chain as string)
      ? USDC_ADDRESSES[result.chain as EvmChain]
      : null,
    instructions:
      "Send USDC to this address from any wallet. Confirmation is automatic " +
      "via on-chain webhook; credits land within 1–2 minutes of finality.",
  });
});

// ── POST /v1/wallets/:id/onchain/challenge ─────────────────────────────
router.post("/wallets/:walletId/onchain/challenge", async (c) => {
  const walletId = c.req.param("walletId");
  await ensureWalletOwnership(c, walletId);

  const body = await c.req.json().catch(() => ({}));
  const chain = body?.chain;
  if (!chain || !isChain(chain)) {
    throw new HTTPException(400, {
      message: `chain must be one of: ${ALL_CHAINS.join(", ")}`,
    });
  }

  const challenge = issueChallenge(walletId, chain as Chain);
  return c.json({
    wallet_id: walletId,
    chain,
    ...challenge,
    instructions:
      isEvmChain(chain as string)
        ? "Sign `message` with personal_sign (e.g. MetaMask, viem.signMessage). " +
          "POST {chain, address, signature, nonce} to /onchain/verify."
        : "Sign `message` with your ed25519 keypair. POST {chain, address, signature, nonce} to /onchain/verify. (Verification arrives in Phase 3c.)",
  });
});

// ── POST /v1/wallets/:id/onchain/verify ────────────────────────────────
const verifySchema = z.object({
  chain: z.string(),
  address: z.string().min(1).max(255),
  signature: z.string().min(1),
  nonce: z.string().min(1),
});

router.post("/wallets/:walletId/onchain/verify", async (c) => {
  const walletId = c.req.param("walletId");
  await ensureWalletOwnership(c, walletId);

  const body = await c.req.json();
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  if (!isChain(parsed.data.chain)) {
    return c.json({ error: "unsupported_chain" }, 400);
  }

  const result = await verifyAndBind({
    walletId,
    chain: parsed.data.chain as Chain,
    address: parsed.data.address,
    signature: parsed.data.signature,
    nonce: parsed.data.nonce,
  });

  if ("error" in result) {
    return c.json({ ok: false, ...result }, 400);
  }
  return c.json({ ok: true, ...result });
});

// ── GET /v1/wallets/:id/onchain ────────────────────────────────────────
router.get("/wallets/:walletId/onchain", async (c) => {
  const walletId = c.req.param("walletId");
  await ensureWalletOwnership(c, walletId);

  const rows = await listOnchainIdentities(walletId);
  return c.json({
    wallet_id: walletId,
    identities: rows.map((r) => ({
      id: r.id,
      chain: r.chain,
      address: r.address,
      verified_at: r.verifiedAt.toISOString(),
    })),
    count: rows.length,
  });
});

// ── POST /v1/wallets/:id/payout ────────────────────────────────────────
const payoutSchema = z.object({
  chain: z.string(),
  token: z.string().default("USDC"),
  amount_base: z.string().regex(/^\d+$/, "must be a positive integer string"),
  destination_address: z.string().min(1).max(255),
  metadata: z.record(z.unknown()).optional(),
});

router.post("/wallets/:walletId/payout", async (c) => {
  const walletId = c.req.param("walletId");
  const w = await ensureWalletOwnership(c, walletId);

  const body = await c.req.json();
  const parsed = payoutSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  if (!isChain(parsed.data.chain)) {
    return c.json({ error: "unsupported_chain" }, 400);
  }

  try {
    const result = await requestPayout({
      walletId,
      projectId: w.projectId,
      chain: parsed.data.chain as Chain,
      token: parsed.data.token,
      amountBase: parsed.data.amount_base,
      destinationAddress: parsed.data.destination_address,
      metadata: parsed.data.metadata,
    });
    return c.json(
      {
        ...result,
        note:
          "Payout recorded and equivalent credits debited. " +
          "Broadcast happens in Phase 3c when the signing worker lands. " +
          "Status will progress requested → broadcast → confirmed.",
      },
      202,
    );
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "insufficient_balance") {
      return c.json({ error: "insufficient_balance" }, 402);
    }
    return c.json({ error: msg }, 400);
  }
});

// ── GET /v1/wallets/:id/payouts ────────────────────────────────────────
router.get("/wallets/:walletId/payouts", async (c) => {
  const walletId = c.req.param("walletId");
  await ensureWalletOwnership(c, walletId);

  const rows = await listPayouts(walletId);
  return c.json({
    wallet_id: walletId,
    payouts: rows.map((r) => ({
      id: r.id,
      chain: r.chain,
      token: r.token,
      amount_base: r.amountBase,
      destination_address: r.destinationAddress,
      status: r.status,
      tx_hash: r.txHash,
      requested_at: r.requestedAt.toISOString(),
      confirmed_at: r.confirmedAt?.toISOString() ?? null,
    })),
    count: rows.length,
  });
});

// ── POST /v1/billing/crypto-webhook/:chain ─────────────────────────────
//
// Public — signature-verified per chain.
// Mounted on the parent app at /v1/billing/crypto-webhook (NOT auth-gated).
//
// Foundation: Alchemy ERC-20 transfer payload for EVM chains is wired.
// Helius (Solana) and other providers arrive in Phase 3c — until then this
// returns 501 with a doc pointer so integrators can scaffold against a
// known interface.

export const cryptoWebhookRouter = new Hono();

cryptoWebhookRouter.post("/:chain", async (c) => {
  const chainParam = c.req.param("chain");
  if (!isChain(chainParam)) {
    return c.json({ error: "unsupported_chain" }, 400);
  }

  const rawBody = await c.req.text();

  // Verify signature for EVM (Alchemy). Solana arrives in Phase 3c.
  if (isEvmChain(chainParam)) {
    const sig = c.req.header("x-alchemy-signature");
    if (economyConfig.alchemyWebhookSecret) {
      const expected = createHmac("sha256", economyConfig.alchemyWebhookSecret)
        .update(rawBody)
        .digest("hex");
      if (sig !== expected) {
        return c.json({ error: "invalid_signature" }, 400);
      }
    }
  } else {
    return c.json(
      {
        error: "not_implemented",
        message:
          `Webhook handler for ${chainParam} pending Phase 3c. ` +
          "EVM chains (alchemy provider) are live.",
      },
      501,
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const event = (payload.event as Record<string, unknown> | undefined) ?? {};
  const transfers = Array.isArray(event.activity)
    ? (event.activity as Array<Record<string, unknown>>)
    : [];

  const ingested: unknown[] = [];

  for (const transfer of transfers) {
    const toAddress = String(transfer.toAddress ?? "");
    const rawContract =
      ((transfer.rawContract as Record<string, unknown> | undefined)?.address as
        | string
        | undefined) ?? "";
    const valueUSDC = Number(transfer.value ?? 0);
    const txHash = String(transfer.hash ?? "");
    const logIndex = Number((transfer.log as { logIndex?: number } | undefined)?.logIndex ?? 0) || null;

    if (!toAddress || !txHash || !(valueUSDC > 0)) continue;

    // Alchemy reports value in human units (1.5 = 1.5 USDC). Convert to base.
    const amountBase = String(Math.floor(valueUSDC * 1_000_000));

    const result = await ingestInboundTransfer({
      chain: chainParam,
      txHash,
      logIndex,
      toAddress,
      contractAddress: rawContract,
      token: "USDC",
      amountBase,
      rawPayload: transfer,
    });
    ingested.push({ txHash, ...result });
  }

  return c.json({ received: true, processed: ingested });
});

export default router;
