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
import { errors, fail } from "../../lib/errors";
import { wallets } from "../../db/schema/economy";
import {
  ALL_CHAINS,
  isChain,
  isEvmChain,
  USDC_ADDRESSES,
  USDC_SOL_MINT,
  type Chain,
  type EvmChain,
} from "../../services/economy/crypto/chains";
import {
  cancelPayout,
  getOrCreateDepositAddress,
  ingestInboundTransfer,
  issueChallenge,
  listDepositAddresses,
  listOnchainIdentities,
  listPayouts,
  requestPayout,
  verifyAndBind,
} from "../../services/economy/crypto";
import {
  economyConfig,
  payoutWorkerBootAllowed,
} from "../../services/economy/config";

import { createHmac, timingSafeEqual } from "node:crypto";

const router = new Hono<ProjectContext>();

/** Constant-time string compare that never leaks length via early return.
 *  Returns false for any nullish input. */
function secretsMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

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
        : "Sign `message` with your Solana wallet (e.g. Phantom signMessage). " +
          "POST {chain, address, signature, nonce} to /onchain/verify. " +
          "Address = base58 ed25519 pubkey. Signature = base58 or hex.",
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
  // Startup and request acceptance share one predicate. Otherwise the global
  // off-switch could prevent worker boot while this route still debits credits
  // and leaves a payout stuck at status='requested'.
  if (!payoutWorkerBootAllowed()) {
    const globallyDisabled =
      process.env.AGENTTOOL_DISABLE_WORKERS === "1";
    return c.json(
      {
        error: "payout_broadcast_not_available",
        payout_worker_enabled: economyConfig.payout.workerEnabled,
        global_workers_disabled: globallyDisabled,
        message:
          (globallyDisabled
            ? "The global worker off-switch is active on this instance. "
            : "The payout broadcast worker is not enabled on this instance. ") +
          "Until it is, payout requests would lock credits indefinitely. " +
          "If you have a payout already in 'requested' state, cancel it via " +
          "POST /v1/wallets/:walletId/payouts/:payoutId/cancel. " +
          "Payout acceptance requires PAYOUT_WORKER_ENABLED=true and " +
          "AGENTTOOL_DISABLE_WORKERS to be unset. See " +
          "docs/PAYOUT-BROADCAST-PLAN.md.",
      },
      503,
    );
  }
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
      // Errors-as-instructions — see docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md
      return fail(c, errors.insufficientBalance(), 402);
    }
    // Operator misconfiguration, not the agent's fault: no FX rate set. 503 so
    // the caller knows to wait, not to change their request.
    if (msg === "payout_fx_rate_unset") {
      return c.json(
        {
          error: msg,
          message:
            "Payout is enabled but no GBP→USD rate is configured (PAYOUT_GBP_USD_RATE). " +
            "This is an operator setting; try again once it is set.",
        },
        503,
      );
    }
    // Policy + earned-wall violations — return 403 with the error code +
    // optional detail line. Agents can adjust amount / destination /
    // wait-for-tomorrow / earn-more accordingly.
    if (
      msg === "payout_below_min" ||
      msg === "destination_not_allowlisted" ||
      msg === "payout_exceeds_daily_ceiling" ||
      msg === "payout_dual_control_required" ||
      msg === "payout_exceeds_earned" ||
      msg === "payout_requires_gbp_wallet" ||
      // signed-capability policy denials (tamper-evident payout bound)
      msg === "payout_capability_required" ||
      msg === "payout_capability_invalid" ||
      msg === "payout_capability_owner_mismatch" ||
      msg === "payout_capability_not_active" ||
      msg === "payout_capability_misconfigured" ||
      msg === "payout_asset_uncapped" ||
      msg === "payout_exceeds_per_payout_cap" ||
      msg === "payout_exceeds_cumulative_cap"
    ) {
      return c.json(
        {
          error: msg,
          detail: (err as Error & { detail?: string }).detail,
        },
        403,
      );
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

// ── POST /v1/wallets/:id/payouts/:payout_id/cancel ─────────────────────
//  Cancel a payout still in `requested` state and refund the credits.
//  Atomic compare-and-swap on status so concurrent attempts (or a worker
//  that has just flipped to 'broadcasting') resolve cleanly with
//  `not_cancellable`. Closes the credit-freeze visibility gap: if the
//  worker is disabled (Slice 0) and a stale `requested` row exists, the
//  agent can recover its credits without operator intervention.
//  Doctrine: docs/PAYOUT-BROADCAST-PLAN.md (Slice 0).
router.post("/wallets/:walletId/payouts/:payoutId/cancel", async (c) => {
  const walletId = c.req.param("walletId");
  const payoutId = c.req.param("payoutId");
  const w = await ensureWalletOwnership(c, walletId);

  const result = await cancelPayout({
    walletId,
    payoutId,
    projectId: w.projectId,
  });

  if (!result.ok) {
    // Mask cross-wallet access as 404 — same rationale as the wallet
    // ownership check above, prevents payout-id enumeration.
    if (result.error === "payout_not_found" || result.error === "wrong_wallet") {
      return c.json({ error: "payout_not_found" }, 404);
    }
    if (result.error === "not_cancellable") {
      return c.json(
        {
          error: "not_cancellable",
          current_status: result.currentStatus,
          hint:
            "Only 'requested' payouts can be cancelled. " +
            "Once 'broadcasting' or further, the chain has the only authority.",
        },
        409,
      );
    }
    return c.json({ error: result.error }, 400);
  }

  return c.json({
    payout_id: payoutId,
    status: result.status,
    refunded: result.refunded,
    note:
      `Cancelled and ${result.refunded} credit${result.refunded === 1 ? "" : "s"} ` +
      `refunded to wallet ${walletId}.`,
  });
});

// ── POST /v1/wallets/:id/payouts/:payout_id/cancel ─────────────────────
//
// Refund a payout still in 'requested' state. Atomic; idempotent
// (re-cancelling returns 409 not_cancellable). Available regardless of
// `payoutWorkerEnabled` — the cancel path closes the credit-freeze wall
// when the worker isn't yet running, AND lets users retract still-queued
// payouts even after enable. A worker that has just claimed the row
// ('broadcasting' or further) wins the race; the cancel returns 409.
router.post("/wallets/:walletId/payouts/:payoutId/cancel", async (c) => {
  const walletId = c.req.param("walletId");
  const payoutId = c.req.param("payoutId");
  const w = await ensureWalletOwnership(c, walletId);

  const result = await cancelPayout({
    walletId,
    payoutId,
    projectId: w.projectId,
  });

  if (!result.ok) {
    if (
      result.error === "payout_not_found" ||
      result.error === "wrong_wallet"
    ) {
      // Mask cross-wallet access as 404 — don't leak that the payout_id
      // exists in another wallet within the project (or another project).
      return c.json({ error: "payout_not_found" }, 404);
    }
    return c.json(
      {
        error: "not_cancellable",
        message: `Payout is in status '${result.currentStatus ?? "unknown"}'. Only 'requested' payouts can be cancelled.`,
        current_status: result.currentStatus ?? null,
      },
      409,
    );
  }

  return c.json({
    ok: true,
    payout_id: payoutId,
    status: "cancelled",
    refunded_credits: result.refunded,
    message: "Payout cancelled and credits refunded to wallet.",
  });
});

// ── POST /v1/billing/crypto-webhook/:chain ─────────────────────────────
//
// Public — signature-verified per chain.
// Mounted on the parent app at /v1/billing/crypto-webhook (NOT auth-gated).
//
// Providers wired:
//   ethereum/base/polygon/arbitrum/optimism — Alchemy ERC-20 transfer
//   solana                                  — Helius enhanced webhooks

export const cryptoWebhookRouter = new Hono();

cryptoWebhookRouter.post("/:chain", async (c) => {
  const chainParam = c.req.param("chain");
  if (!isChain(chainParam)) {
    return c.json({ error: "unsupported_chain" }, 400);
  }

  const rawBody = await c.req.text();

  // ── Signature verification (per provider) ──────────────────────────
  // This route is UNAUTH and credits real wallet balance, so an unset secret
  // FAILS CLOSED (503) rather than accepting an unsigned, forgeable payload.
  // Local dev may opt out with CRYPTO_WEBHOOK_ALLOW_UNSIGNED=1 (see config.ts).
  if (isEvmChain(chainParam)) {
    // Alchemy: HMAC-SHA256 over raw body, hex digest in x-alchemy-signature.
    if (!economyConfig.alchemyWebhookSecret) {
      if (!economyConfig.allowUnsignedWebhooks) {
        return fail(c, errors.webhookSecretUnset({ chain: chainParam }), 503);
      }
    } else {
      const sig = c.req.header("x-alchemy-signature");
      const expected = createHmac("sha256", economyConfig.alchemyWebhookSecret)
        .update(rawBody)
        .digest("hex");
      if (!secretsMatch(sig, expected)) {
        return c.json({ error: "invalid_signature" }, 400);
      }
    }
  } else if (chainParam === "solana") {
    // Helius: shared-secret in Authorization header (plain, not Bearer).
    if (!economyConfig.heliusWebhookSecret) {
      if (!economyConfig.allowUnsignedWebhooks) {
        return fail(c, errors.webhookSecretUnset({ chain: chainParam }), 503);
      }
    } else {
      const sig = c.req.header("authorization");
      if (!secretsMatch(sig, economyConfig.heliusWebhookSecret)) {
        return c.json({ error: "invalid_signature" }, 400);
      }
    }
  } else {
    return c.json(
      {
        error: "not_implemented",
        message: `Webhook handler for ${chainParam} not yet wired.`,
      },
      501,
    );
  }

  // ── Parse payload (per provider shape) ─────────────────────────────
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const ingested: unknown[] = [];

  if (chainParam === "solana") {
    // Helius enhanced-webhook payload: array of transaction objects.
    // Each has signature + tokenTransfers[]. Each tokenTransfer:
    //   { mint, tokenAmount (human units), toUserAccount, ... }
    const txns = Array.isArray(parsed)
      ? (parsed as Array<Record<string, unknown>>)
      : [];

    for (const txn of txns) {
      const txSignature = String(txn.signature ?? "");
      const tokenTransfers = Array.isArray(txn.tokenTransfers)
        ? (txn.tokenTransfers as Array<Record<string, unknown>>)
        : [];
      let logIndex = 0;
      for (const t of tokenTransfers) {
        const mint = String(t.mint ?? "");
        if (mint !== USDC_SOL_MINT) {
          logIndex += 1;
          continue;
        }
        const toAddress = String(
          t.toUserAccount ?? t.toTokenAccount ?? "",
        );
        const tokenAmount = Number(t.tokenAmount ?? 0);
        if (!toAddress || !txSignature || !(tokenAmount > 0)) {
          logIndex += 1;
          continue;
        }
        // Helius returns human units (1.5 = 1.5 USDC). USDC has 6
        // decimals on Solana too. Match Alchemy's amountBase semantics.
        const amountBase = String(Math.floor(tokenAmount * 1_000_000));
        const result = await ingestInboundTransfer({
          chain: "solana",
          txHash: txSignature,
          logIndex,
          toAddress,
          contractAddress: USDC_SOL_MINT,
          token: "USDC",
          amountBase,
          rawPayload: t,
        });
        ingested.push({ txSignature, mint, ...result });
        logIndex += 1;
      }
    }

    return c.json({ received: true, processed: ingested });
  }

  // EVM (Alchemy) branch.
  const payload = parsed as Record<string, unknown>;
  const event = (payload.event as Record<string, unknown> | undefined) ?? {};
  const transfers = Array.isArray(event.activity)
    ? (event.activity as Array<Record<string, unknown>>)
    : [];

  for (const [i, transfer] of transfers.entries()) {
    const toAddress = String(transfer.toAddress ?? "");
    const rawContract =
      ((transfer.rawContract as Record<string, unknown> | undefined)?.address as
        | string
        | undefined) ?? "";
    const valueUSDC = Number(transfer.value ?? 0);
    const txHash = String(transfer.hash ?? "");
    // Preserve a real logIndex of 0 (a valid first-log position). Fall back to
    // the transfer's array position, NEVER null: the (chain,txHash,logIndex)
    // dedupe unique index treats NULL as distinct in Postgres, so a null here
    // lets a redelivered event insert twice → double-credit. The old
    // `?? 0 || null` coerced a genuine 0 to null and reopened exactly that.
    const rawLogIndex = (transfer.log as { logIndex?: number } | undefined)?.logIndex;
    const logIndex = Number.isFinite(Number(rawLogIndex)) ? Number(rawLogIndex) : i;

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
