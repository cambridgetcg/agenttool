/** /v1/wallets/:id/{deposit-address,onchain,payouts} + crypto webhooks.
 *
 *  Foundation for sovereign-agent crypto payment. The agent gets a
 *  deterministic deposit address per chain, sends USDC there from its
 *  own wallet, and the inbound webhook credits its agenttool balance.
 *  Onchain identity binding lets the agent prove it controls the address.
 *
 *  Doctrine: docs/CRYPTO-PAYMENT.md.
 *  Payout broadcast, Solana derivation/signature verification, and Alchemy +
 *  Helius ingress exist. Deposit finality/reorg reconciliation remains a
 *  production blocker. */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { isAddress } from "viem";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { errors, fail } from "../../lib/errors";
import { wallets } from "../../db/schema/economy";
import {
  ALL_CHAINS,
  isChain,
  isEvmChain,
  type Chain,
  type EvmChain,
} from "../../services/economy/crypto/chains";
import {
  cancelPayout,
  DepositAddressInvariantError,
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
import {
  AlchemyNotifyConfigurationError,
  AlchemyNotifyUnavailableError,
  alchemyAddressActivityNetwork,
  alchemyNotifyConfig,
} from "../../services/economy/crypto/alchemy-notify";
import {
  activeNetwork,
  activeUsdcAddress,
  activeUsdcMintSolana,
} from "../../services/economy/crypto/network";

import { createHmac, timingSafeEqual } from "node:crypto";

const router = new Hono<ProjectContext>();
const MAX_CRYPTO_WEBHOOK_BODY_BYTES = 1024 * 1024;

/** Constant-time string compare that never leaks length via early return.
 *  Returns false for any nullish input. */
function secretsMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

class WebhookBodyTooLargeError extends Error {}

function parseAlchemyLogIndex(value: unknown): number | null {
  // Address Activity documents logIndex as a hex quantity. Accept only its
  // canonical wire shape so null, booleans, empty strings, decimal strings,
  // arrays, and other JavaScript-coercible values cannot collapse to log 0.
  if (
    typeof value !== "string" ||
    value.length > 10 ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)
  ) {
    return null;
  }

  const parsed = BigInt(value);
  return parsed <= 2_147_483_647n ? Number(parsed) : null;
}

function parseHeliusUsdcAmount(value: unknown): string | null {
  // Enhanced Helius tokenTransfers expose a human-unit JSON number rather
  // than an atomic string. Rebuild at most six USDC decimal places from the
  // number's canonical decimal rendering; never floor a floating product.
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const decimal = value.toString();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(decimal)) {
    return null;
  }
  const [whole, fraction = ""] = decimal.split(".");
  const atomic =
    BigInt(whole!) * 1_000_000n +
    BigInt(fraction.padEnd(6, "0"));
  if (atomic <= 0n || atomic > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return atomic.toString(10);
}

/** Read the actual stream with an independent byte cap. Content-Length is an
 *  early rejection hint only; it is never trusted as proof of the body size. */
async function readWebhookBody(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (
    declared &&
    /^\d+$/.test(declared) &&
    Number(declared) > MAX_CRYPTO_WEBHOOK_BODY_BYTES
  ) {
    throw new WebhookBodyTooLargeError();
  }

  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_CRYPTO_WEBHOOK_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new WebhookBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

interface ListedDepositAddress {
  chain: string;
  token: string;
  createdAt: Date;
}

interface ReadyDepositAddress {
  chain: Chain;
  token: string;
  address: string;
  derivation_path: string;
  contract_address: string | null;
  watch_status: "provider_accepted" | "operator_configuration_unverified";
  credit_finality: "unreconciled";
  created_at: string;
}

export async function resolveReadyDepositAddressRows(
  walletId: string,
  rows: ListedDepositAddress[],
  resolveAddress: typeof getOrCreateDepositAddress =
    getOrCreateDepositAddress,
): Promise<ReadyDepositAddress[]> {
  const readyRows: ReadyDepositAddress[] = [];
  for (const row of rows) {
    if (!isChain(row.chain) || row.token !== "USDC") {
      throw new DepositAddressInvariantError();
    }
    const ready = await resolveAddress(walletId, row.chain, row.token);
    const evm = isEvmChain(ready.chain);
    readyRows.push({
      chain: ready.chain,
      token: ready.token,
      address: ready.address,
      derivation_path: ready.derivation_path,
      contract_address: evm
        ? activeUsdcAddress(ready.chain as EvmChain)
        : ready.chain === "solana"
          ? activeUsdcMintSolana()
          : null,
      watch_status: evm
        ? "provider_accepted"
        : "operator_configuration_unverified",
      credit_finality: "unreconciled",
      created_at: row.createdAt.toISOString(),
    });
  }
  return readyRows;
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

  if (token !== "USDC") {
    return fail(
      c,
      errors.refusal({
        error: "unsupported_deposit_token",
        message: "Only USDC deposit addresses are supported.",
        hint: "Retry with token=USDC.",
        token,
        supported_tokens: ["USDC"],
      }),
      400,
    );
  }

  // No chain filter → list all minted addresses.
  if (!chainParam) {
    const rows = await listDepositAddresses(walletId);
    let readyRows: ReadyDepositAddress[];
    try {
      // Listing an old database row is not proof that the active derivation
      // root still controls it or that its provider watch is ready. Reuse the
      // same fail-closed read path as the single-chain response before
      // disclosing any address.
      readyRows = await resolveReadyDepositAddressRows(walletId, rows);
    } catch (error) {
      if (
        error instanceof AlchemyNotifyConfigurationError ||
        error instanceof AlchemyNotifyUnavailableError
      ) {
        return fail(
          c,
          errors.refusal({
            error: error.code,
            retryable: error instanceof AlchemyNotifyUnavailableError,
            message: error.message,
            hint:
              "Retry this exact deposit-address list after the operator restores every listed chain's Alchemy watch configuration.",
            consequence:
              "No deposit address was disclosed because at least one stored EVM address is not yet confirmed as watched.",
          }),
          503,
        );
      }
      if (error instanceof DepositAddressInvariantError) {
        return fail(
          c,
          errors.refusal({
            error: error.code,
            retryable: false,
            message: error.message,
            hint:
              "Do not use previously cached addresses; an operator must reconcile the active derivation root first.",
            consequence:
              "No deposit address was disclosed because at least one stored row failed active derivation validation.",
          }),
          503,
        );
      }
      throw error;
    }
    return c.json({
      wallet_id: walletId,
      addresses: readyRows,
      supported_chains: ALL_CHAINS,
      hint: "Pass ?chain=base&token=USDC to mint or fetch a specific address.",
      watch_warning: readyRows.some(
        (row) => row.watch_status !== "provider_accepted",
      )
        ? "Solana rows do not prove Helius watch registration; confirm provider configuration before sending funds."
        : null,
      finality_warning:
        "Deposit confirmation and reorg reversal remain unreconciled on every chain.",
    });
  }

  if (!isChain(chainParam)) {
    throw new HTTPException(400, {
      message: `chain must be one of: ${ALL_CHAINS.join(", ")}`,
    });
  }

  let result;
  try {
    result = await getOrCreateDepositAddress(
      walletId,
      chainParam as Chain,
      token,
    );
  } catch (error) {
    if (
      error instanceof AlchemyNotifyConfigurationError ||
      error instanceof AlchemyNotifyUnavailableError
    ) {
      return fail(
        c,
        errors.refusal({
          error: error.code,
          chain: chainParam,
          retryable: error instanceof AlchemyNotifyUnavailableError,
          message: error.message,
          hint:
            "Retry this exact deposit-address request after the operator restores the chain's Alchemy watch configuration.",
          consequence:
            "The deposit address exists locally, but AgentTool will not claim automatic detection until its Alchemy watch registration succeeds.",
        }),
        503,
      );
    }
    if (error instanceof DepositAddressInvariantError) {
      return fail(
        c,
        errors.refusal({
          error: error.code,
          chain: chainParam,
          retryable: false,
          message: error.message,
          hint:
            "Do not send funds to a previously cached address; an operator must reconcile the active derivation root first.",
          consequence:
            "No deposit address was disclosed. An operator must reconcile the stored row, active network, and derivation root.",
        }),
        503,
      );
    }
    throw error;
  }

  return c.json({
    wallet_id: walletId,
    chain: result.chain,
    token: result.token,
    address: result.address,
    derivation_path: result.derivation_path,
    contract_address: isEvmChain(result.chain as string)
      ? activeUsdcAddress(result.chain as EvmChain)
      : result.chain === "solana"
        ? activeUsdcMintSolana()
        : null,
    watch_status: isEvmChain(result.chain as string)
      ? "provider_accepted"
      : "operator_configuration_unverified",
    credit_finality: "unreconciled",
    instructions: isEvmChain(result.chain as string)
      ? "Send USDC to this address from any wallet. The chain-specific Alchemy watch accepted the address, but deposit finality and reorg reversal are not yet reconciled; do not treat credited value as production-final."
      : "Do not send production funds until an operator confirms that the active-network Helius webhook watches this address. Signed ingress exists, but address-watch readiness, deposit finality, and reversal are not yet reconciled.",
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
  token: z.literal("USDC").default("USDC"),
  amount_base: z
    .string()
    .regex(/^[1-9]\d{0,15}$/, "must be a canonical positive integer string")
    .refine(
      (value) =>
        /^[1-9]\d{0,15}$/.test(value) &&
        BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER),
      "exceeds the current exact-conversion boundary",
    ),
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
          "The opt-in worker progresses requested → broadcasting → broadcast " +
          "→ confirmed. Ambiguous submission remains broadcasting for operator " +
          "reconciliation and is never automatically retried or refunded.",
      },
      202,
    );
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "insufficient_balance") {
      // Errors-as-instructions — see docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md
      return fail(c, errors.insufficientBalance(), 402);
    }
    if (
      msg === "amount_base_must_be_positive" ||
      msg === "payout_amount_exceeds_safe_conversion"
    ) {
      return fail(
        c,
        errors.refusal({
          error: msg,
          message:
            "The payout amount cannot be converted exactly within the current integer wallet and FX boundary.",
          hint:
            "Send a canonical positive USDC base-unit amount no greater than 9007199254740991.",
        }),
        400,
      );
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
    if (msg === "payout_daily_total_unavailable") {
      return c.json(
        {
          error: msg,
          message:
            "The payout ceiling could not be checked safely, so no debit was made. Retry once storage is healthy.",
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
      msg === "payout_requires_gbp_wallet"
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
      return fail(
        c,
        errors.refusal({
          error: "payout_not_found",
          message: "Payout was not found for this wallet.",
          hint: "List this wallet's payouts and retry with one of its IDs.",
        }),
        404,
      );
    }
    if (result.error === "not_cancellable") {
      return fail(
        c,
        errors.refusal({
          error: "not_cancellable",
          message: "Only requested payouts can be cancelled.",
          current_status: result.currentStatus,
          hint:
            "Only 'requested' payouts can be cancelled. " +
            "Once 'broadcasting' or further, the chain has the only authority.",
        }),
        409,
      );
    }
    return fail(
      c,
      errors.refusal({
        error: "refund_unreconciled",
        message:
          "Cancellation is paused because the original server ledger debit cannot be reconciled exactly.",
        hint:
          "Do not retry blindly. The payout remains requested and an operator must repair or reconcile its ledger provenance.",
        retryable: false,
      }),
      503,
    );
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

// ── POST /v1/billing/crypto-webhook/:chain ─────────────────────────────
//
// Public — signature-verified per chain.
// Mounted on the parent app at /v1/billing/crypto-webhook (NOT auth-gated).
//
// Providers wired:
//   ethereum/base/polygon/arbitrum/optimism — Alchemy ERC-20 transfer
//   solana                                  — Helius enhanced webhooks

export function createCryptoWebhookRouter(
  ingestTransfer: typeof ingestInboundTransfer = ingestInboundTransfer,
) {
  const cryptoWebhookRouter = new Hono();

cryptoWebhookRouter.post("/:chain", async (c) => {
  const chainParam = c.req.param("chain");
  if (!isChain(chainParam)) {
    return fail(
      c,
      errors.refusal({
        error: "unsupported_chain",
        message: `Crypto webhook chain must be one of: ${ALL_CHAINS.join(", ")}.`,
        hint: "Send the provider delivery to the route for its configured chain.",
      }),
      400,
    );
  }

  let rawBodyBytes: Uint8Array;
  try {
    rawBodyBytes = await readWebhookBody(c.req.raw);
  } catch (error) {
    if (error instanceof WebhookBodyTooLargeError) {
      c.header("Cache-Control", "private, no-store");
      return fail(
        c,
        errors.refusal({
          received: false,
          error: "webhook_body_too_large",
          message: "Crypto webhook bodies are capped at 1 MiB.",
          hint: "Split the provider delivery into payloads no larger than 1 MiB.",
        }),
        413,
      );
    }
    throw error;
  }

  // ── Signature verification (per provider) ──────────────────────────
  // This route is UNAUTH and credits real wallet balance, so an unset secret
  // FAILS CLOSED (503) rather than accepting an unsigned, forgeable payload.
  // Local dev may opt out with CRYPTO_WEBHOOK_ALLOW_UNSIGNED=1 (see config.ts).
  if (isEvmChain(chainParam)) {
    // Alchemy: HMAC-SHA256 over raw body, hex digest in x-alchemy-signature.
    const signingKey = economyConfig.alchemyWebhookSigningKeys[chainParam];
    if (!signingKey) {
      if (!economyConfig.allowUnsignedWebhooks) {
        return fail(c, errors.webhookSecretUnset({ chain: chainParam }), 503);
      }
    } else {
      const sig = c.req.header("x-alchemy-signature");
      const expected = createHmac("sha256", signingKey)
        .update(rawBodyBytes)
        .digest("hex");
      if (!secretsMatch(sig, expected)) {
        return fail(
          c,
          errors.refusal({
            error: "invalid_signature",
            message:
              "The Alchemy signature does not verify over the exact request bytes.",
            hint:
              "Use the signing key from this specific webhook and do not transform the body before signing.",
          }),
          400,
        );
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
        return fail(
          c,
          errors.refusal({
            error: "invalid_signature",
            message:
              "The Helius Authorization value does not match this webhook's configured secret.",
            hint:
              "Use the exact shared secret configured for this Helius webhook.",
          }),
          400,
        );
      }
    }
  } else {
    return fail(
      c,
      errors.refusal({
        error: "not_implemented",
        message: `Webhook handler for ${chainParam} not yet wired.`,
        hint: "Use one of the currently documented Alchemy EVM or Helius Solana webhook routes.",
      }),
      501,
    );
  }

  // ── Parse payload (per provider shape) ─────────────────────────────
  let rawBody: string;
  try {
    rawBody = new TextDecoder("utf-8", { fatal: true }).decode(rawBodyBytes);
  } catch {
    return fail(
      c,
      errors.refusal({
        error: "invalid_utf8",
        message: "The signed webhook body is not valid UTF-8.",
        hint: "Send the provider's original UTF-8 JSON bytes without transcoding.",
      }),
      400,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return fail(
      c,
      errors.refusal({
        error: "invalid_json",
        message: "The signed webhook body is not valid JSON.",
        hint: "Send the provider's original JSON delivery without modification.",
      }),
      400,
    );
  }

  const ingested: unknown[] = [];

  if (chainParam === "solana") {
    // Helius enhanced-webhook payload: array of transaction objects.
    // Each has signature + tokenTransfers[]. Each tokenTransfer:
    //   { mint, tokenAmount (human units), toUserAccount, ... }
    if (!Array.isArray(parsed)) {
      return fail(
        c,
        errors.refusal({
          error: "invalid_payload",
          message: "Helius enhanced webhook payload must be a JSON array.",
          hint: "Send the original Helius enhanced webhook delivery.",
        }),
        400,
      );
    }
    const solanaUsdcMint = activeUsdcMintSolana();
    const txns = parsed as unknown[];

    for (const candidate of txns) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        return fail(
          c,
          errors.refusal({
            error: "invalid_activity",
            message: "Each Helius transaction item must be a JSON object.",
            hint: "Send the original Helius enhanced webhook delivery.",
          }),
          400,
        );
      }
      const txn = candidate as Record<string, unknown>;
      const txSignature = String(txn.signature ?? "");
      const tokenTransfers = Array.isArray(txn.tokenTransfers)
        ? (txn.tokenTransfers as unknown[])
        : [];
      let logIndex = 0;
      for (const transfer of tokenTransfers) {
        if (!transfer || typeof transfer !== "object" || Array.isArray(transfer)) {
          return fail(
            c,
            errors.refusal({
              error: "invalid_activity",
              message: "Each Helius token transfer must be a JSON object.",
              hint: "Send the original Helius enhanced webhook delivery.",
            }),
            400,
          );
        }
        const t = transfer as Record<string, unknown>;
        const mint = String(t.mint ?? "");
        if (mint !== solanaUsdcMint) {
          logIndex += 1;
          continue;
        }
        const toAddress = String(
          t.toUserAccount ?? t.toTokenAccount ?? "",
        );
        const amountBase = parseHeliusUsdcAmount(t.tokenAmount);
        if (!toAddress || !txSignature || amountBase === null) {
          return fail(
            c,
            errors.refusal({
              received: false,
              error: "invalid_usdc_activity",
              message:
                "A Helius USDC transfer is missing a transaction signature, recipient, or exact amount with at most six decimal places.",
              hint:
                "Send the original enhanced webhook delivery. Values outside the exact JSON-number boundary require a raw atomic source.",
            }),
            400,
          );
        }
        const result = await ingestTransfer({
          chain: "solana",
          txHash: txSignature,
          logIndex,
          toAddress,
          contractAddress: solanaUsdcMint,
          token: "USDC",
          amountBase,
          rawPayload: t,
        });
        if (result.retryable) {
          return fail(
            c,
            errors.refusal({
              received: false,
              error: "ingestion_unavailable",
              retryable: true,
              message:
                "The signed webhook could not be committed. Return is non-2xx so the provider can redeliver it.",
              hint:
                "Retry the identical signed delivery; no credit was acknowledged.",
            }),
            503,
          );
        }
        ingested.push({ txSignature, mint, ...result });
        logIndex += 1;
      }
    }

    return c.json({ received: true, processed: ingested });
  }

  // EVM (Alchemy) branch.
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail(
      c,
      errors.refusal({
        error: "invalid_payload",
        message: "Alchemy webhook payload must be a JSON object.",
        hint: "Send the original Address Activity webhook envelope.",
      }),
      400,
    );
  }
  const payload = parsed as Record<string, unknown>;
  const expectedWebhookId =
    alchemyNotifyConfig().webhookIds[chainParam as EvmChain];
  if (!expectedWebhookId) {
    return fail(
      c,
      errors.refusal({
        received: false,
        error: "alchemy_webhook_identity_unconfigured",
        message:
          "The route has no configured webhook ID, so it cannot bind this signed delivery to the intended subscription.",
        hint:
          "Configure the existing per-chain Address Activity webhook ID before retrying this delivery.",
      }),
      503,
    );
  }
  if (
    !payload.event ||
    typeof payload.event !== "object" ||
    Array.isArray(payload.event)
  ) {
    return fail(
      c,
      errors.refusal({
        error: "invalid_payload",
        message: "Alchemy webhook payload is missing its event object.",
        hint: "Send the original Address Activity webhook envelope.",
      }),
      400,
    );
  }
  const event = payload.event as Record<string, unknown>;
  const expectedNetwork = alchemyAddressActivityNetwork(
    chainParam as EvmChain,
    activeNetwork(),
  );
  if (
    payload.webhookId !== expectedWebhookId ||
    payload.type !== "ADDRESS_ACTIVITY" ||
    event.network !== expectedNetwork
  ) {
    return fail(
      c,
      errors.refusal({
        received: false,
        error: "invalid_webhook_identity",
        message:
          "The signed delivery does not match this route's configured webhook, type, and network.",
        hint:
          "Send each Address Activity delivery only to its configured chain and network route.",
      }),
      400,
    );
  }
  if (!Array.isArray(event.activity)) {
    return fail(
      c,
      errors.refusal({
        error: "invalid_payload",
        message: "Alchemy Address Activity event must contain an activity array.",
        hint: "Send the original Address Activity webhook envelope.",
      }),
      400,
    );
  }
  const transfers = event.activity as unknown[];
  const expectedContract = activeUsdcAddress(
    chainParam as EvmChain,
  ).toLowerCase();

  for (const candidate of transfers) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return fail(
        c,
        errors.refusal({
          error: "invalid_activity",
          message: "Each Alchemy activity item must be a JSON object.",
          hint: "Send the original Address Activity webhook envelope.",
        }),
        400,
      );
    }
    const transfer = candidate as Record<string, unknown>;
    const toAddress = String(transfer.toAddress ?? "");
    if (
      transfer.rawContract !== undefined &&
      transfer.rawContract !== null &&
      (typeof transfer.rawContract !== "object" ||
        Array.isArray(transfer.rawContract))
    ) {
      return fail(
        c,
        errors.refusal({
          error: "invalid_activity",
          message:
            "Alchemy activity rawContract must be a JSON object or absent.",
          hint: "Send the original Address Activity webhook envelope.",
        }),
        400,
      );
    }
    const rawContractData =
      (transfer.rawContract as Record<string, unknown> | undefined | null) ??
      {};
    if (
      rawContractData.address !== undefined &&
      rawContractData.address !== null &&
      typeof rawContractData.address !== "string"
    ) {
      return fail(
        c,
        errors.refusal({
          error: "invalid_activity",
          message:
            "Alchemy activity rawContract.address must be a string or absent.",
          hint: "Send the original Address Activity webhook envelope.",
        }),
        400,
      );
    }
    const rawContract =
      typeof rawContractData.address === "string"
        ? rawContractData.address
        : "";
    // Address Activity includes every asset touching a watched address. Other
    // contracts are expected and are classified as irrelevant to USDC funding.
    if (rawContract.toLowerCase() !== expectedContract) continue;

    const rawValue = String(rawContractData.rawValue ?? "");
    const decimals = rawContractData.decimals;
    const txHash = String(transfer.hash ?? "");
    const log =
      transfer.log && typeof transfer.log === "object"
        ? (transfer.log as Record<string, unknown>)
        : null;
    // A token log's on-chain identity must come from the provider, never from
    // its position in this delivery's array: event grouping/order can change
    // across deliveries. Require Alchemy's canonical hexadecimal quantity and
    // reject any missing, coercible, negative, or oversized identity.
    const rawLogIndex = log?.logIndex;
    const logIndex = parseAlchemyLogIndex(rawLogIndex);

    if (
      !isAddress(toAddress) ||
      !/^0x[0-9a-f]{64}$/i.test(txHash) ||
      logIndex === null ||
      typeof log?.removed !== "boolean" ||
      decimals !== 6 ||
      !/^0x[0-9a-f]+$/i.test(rawValue)
    ) {
      return fail(
        c,
        errors.refusal({
          received: false,
          error: "invalid_usdc_activity",
          message:
            "A USDC activity item is missing an exact address, transaction hash, log index, decimals, or raw value.",
          hint:
            "Send the original activity item with its canonical on-chain log identity and raw token amount.",
        }),
        400,
      );
    }

    // A removed USDC log may be reversing a previously credited event. Check
    // its canonical identity first; malformed data must not create an endless
    // retryable response. Valid removed evidence remains unacknowledged until
    // the reconciler can reverse or quarantine the earlier credit.
    if (log?.removed === true) {
      return fail(
        c,
        errors.refusal({
          received: false,
          error: "reorg_reconciliation_unavailable",
          retryable: true,
          message:
            "A removed USDC log requires credit reversal or quarantine, which is not implemented.",
          hint:
            "Retry the same delivery after the operator enables reorg reconciliation; the event was not acknowledged.",
        }),
        503,
      );
    }

    // Use Alchemy's exact raw token amount rather than its human-unit JSON
    // number. Passing through Number/Math.floor can round large or fractional
    // transfers before the idempotent credit is written.
    const amountAtomic = BigInt(rawValue);
    if (amountAtomic <= 0n) continue;
    const amountBase = amountAtomic.toString(10);
    const normalizedTxHash = txHash.toLowerCase();

    const result = await ingestTransfer({
      chain: chainParam,
      txHash: normalizedTxHash,
      logIndex,
      toAddress,
      contractAddress: rawContract,
      token: "USDC",
      amountBase,
      rawPayload: transfer,
    });
    if (result.retryable) {
      return fail(
        c,
        errors.refusal({
          received: false,
          error: "ingestion_unavailable",
          retryable: true,
          message:
            "The signed webhook could not be committed. Return is non-2xx so the provider can redeliver it.",
          hint:
            "Retry the identical signed delivery; no credit was acknowledged.",
        }),
        503,
      );
    }
    ingested.push({ txHash: normalizedTxHash, ...result });
  }

  return c.json({ received: true, processed: ingested });
});
  return cryptoWebhookRouter;
}

export const cryptoWebhookRouter = createCryptoWebhookRouter();

export default router;
