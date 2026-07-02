/** x402 payment verification + credit application — the piece that turns
 *  the x402 envelope (middleware/x402.ts + middleware/x402-config.ts) from
 *  advisory into real.
 *
 *  Flow (per X-PAYMENT header presented on any authed request):
 *    1. Guardrails — scheme='exact', network matches config, payload decodes,
 *       payTo == our recipient, value > 0, request is authenticated.
 *    2. Persist-identity — insert x402_payments row keyed on
 *       sha256(payload) BEFORE any facilitator call. Unique index = replay
 *       guard: a duplicate payload is rejected without touching the
 *       facilitator (docs/PATTERN-PERSIST-IDENTITY.md).
 *    3. Facilitator verify → settle (Coinbase CDP by default). Settlement
 *       moves real USDC on-chain to AGENTTOOL_X402_RECIPIENT.
 *    4. Credit — projects.credits += floor(amount_atomic / 1000). The rate
 *       is pinned to the published ring_2_cap_bump price ($0.001/credit,
 *       middleware/x402-config.ts PRICE_TABLE) so the money and the meter
 *       tell the same story. Wallet (Ring 3) top-ups are a follow-up —
 *       crediting fiat-denominated wallets from USDC needs an FX stance
 *       we haven't taken yet; credits are currency-free so they're honest.
 *    5. Flip the row settled (tx hash) / failed (reason). If the process
 *       dies between settle and credit, the pending row + on-chain tx are
 *       the reconciliation trail — operator replays via the row id.
 *
 *  This module NEVER throws into the request path: any failure returns
 *  false and the request proceeds as unpaid (the 402 envelope goes out
 *  as before). Payment bugs must not take the API down.
 *
 *  Doctrine: docs/ALIGNMENT-MOVES.md (Move 4) · docs/ECOSYSTEM.md ·
 *  docs/PATTERN-PERSIST-IDENTITY.md · docs/FAIR-PRICING.md.
 */

import { createHash } from "node:crypto";
import type { Context } from "hono";

import {
  buildPaymentRequirements,
  type X402Network,
  type X402PaymentHeader,
} from "../../middleware/x402";
import type {
  FacilitatorSettleResult,
  FacilitatorVerifyResult,
} from "./facilitators/coinbase";

// ── Pricing ─────────────────────────────────────────────────────────────
// 1 credit = $0.001 USDC = 1000 atomic units. Matches PRICE_TABLE
// ring_2_cap_bump in middleware/x402-config.ts — keep the two in sync.
export const ATOMIC_PER_CREDIT = 1000;

// ── EVM 'exact' scheme payload (EIP-3009 transferWithAuthorization) ─────

export interface ExactEvmPayload {
  signature: string;
  authorization: {
    from: string;
    to: string;
    value: string; // atomic units, digits only
    validAfter?: string;
    validBefore?: string;
    nonce?: string;
  };
}

/** Decode the base64 payload of an 'exact' EVM payment. Returns null on
 *  any shape mismatch — never throws. */
export function decodeExactEvmPayload(payloadB64: string): ExactEvmPayload | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(payloadB64, "base64").toString("utf-8"),
    ) as ExactEvmPayload;
    const auth = parsed?.authorization;
    if (!auth || typeof parsed.signature !== "string" || parsed.signature.length === 0) {
      return null;
    }
    if (
      typeof auth.from !== "string" ||
      typeof auth.to !== "string" ||
      typeof auth.value !== "string" ||
      !/^\d+$/.test(auth.value)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function payloadHash(payloadB64: string): string {
  return createHash("sha256").update(payloadB64, "utf-8").digest("hex");
}

// ── Dependency-injected verifier (tests inject fakes; prod wires db) ────

export interface X402PendingRow {
  projectId: string;
  payloadHash: string;
  scheme: string;
  network: string;
  payer: string;
  amountAtomic: string;
  asset: string;
  resource: string;
}

export interface X402VerifierDeps {
  facilitator: {
    verify(
      requirements: ReturnType<typeof buildPaymentRequirements>,
      payment: X402PaymentHeader,
    ): Promise<FacilitatorVerifyResult>;
    settle(
      requirements: ReturnType<typeof buildPaymentRequirements>,
      payment: X402PaymentHeader,
    ): Promise<FacilitatorSettleResult>;
  };
  /** Insert the pending row. Return the row id, or null when the payload
   *  hash already exists (replay — caller rejects without facilitator). */
  persistPending(row: X402PendingRow): Promise<string | null>;
  markSettled(id: string, txHash: string, creditsApplied: number): Promise<void>;
  markFailed(id: string, reason: string): Promise<void>;
  applyCredits(projectId: string, credits: number): Promise<void>;
  recipient(): string;
  expectedNetwork(): X402Network;
}

/** Settlement info stashed on the context for the X-PAYMENT-RESPONSE
 *  header (middleware buildSettlementHeader reads it). */
export function getStashedSettlement(c: Context): FacilitatorSettleResult | undefined {
  return (c as Context & { _x402Settlement?: FacilitatorSettleResult })._x402Settlement;
}

export function createX402Verifier(deps: X402VerifierDeps) {
  return async function verifyX402Payment(
    c: Context,
    header: X402PaymentHeader,
  ): Promise<boolean> {
    try {
      // 1 · Guardrails — cheap rejections first, no side effects.
      if (header.scheme !== "exact") return false;
      if (header.network !== deps.expectedNetwork()) return false;

      const project = (c as Context & { var: { project?: { id: string } } }).var
        ?.project;
      if (!project?.id) return false; // no credit target — unauth request

      const payload = decodeExactEvmPayload(header.payload);
      if (!payload) return false;

      const recipient = deps.recipient();
      if (
        !recipient ||
        recipient === "0x0000000000000000000000000000000000000000" ||
        payload.authorization.to.toLowerCase() !== recipient.toLowerCase()
      ) {
        return false; // not paying US (or recipient unconfigured) — refuse
      }
      if (BigInt(payload.authorization.value) <= 0n) return false;

      // 2 · Persist-identity BEFORE the facilitator sees anything.
      const requirements = buildPaymentRequirements({
        resource: c.req.path,
        amountAtomic: payload.authorization.value,
        payTo: recipient,
        network: header.network,
        description: "agenttool credit top-up (x402)",
      });
      const rowId = await deps.persistPending({
        projectId: project.id,
        payloadHash: payloadHash(header.payload),
        scheme: header.scheme,
        network: header.network,
        payer: payload.authorization.from,
        amountAtomic: payload.authorization.value,
        asset: requirements.asset,
        resource: c.req.path,
      });
      if (rowId === null) return false; // replay — payload already seen

      // 3 · Facilitator verify → settle.
      const verified = await deps.facilitator.verify(requirements, header);
      if (!verified.valid) {
        await deps.markFailed(rowId, verified.reason ?? "facilitator_verify_invalid");
        return false;
      }
      const settled = await deps.facilitator.settle(requirements, header);
      if (!settled.success || !settled.transaction) {
        await deps.markFailed(rowId, settled.error ?? "facilitator_settle_failed");
        return false;
      }

      // 4 · Credit + 5 · flip the row. Credit first: if we die between the
      // two, the pending row + on-chain tx reconcile to "settled" — never
      // to double-credit (the row id is the idempotency anchor).
      const credits = Number(
        BigInt(payload.authorization.value) / BigInt(ATOMIC_PER_CREDIT),
      );
      await deps.applyCredits(project.id, credits);
      await deps.markSettled(rowId, settled.transaction, credits);

      (c as Context & { _x402Settlement?: FacilitatorSettleResult })._x402Settlement =
        settled;
      return true;
    } catch (err) {
      // Payment machinery must never 500 the request. Log + treat as unpaid.
      console.error("[x402] verifier error:", (err as Error).message);
      return false;
    }
  };
}

// ── Production wiring (lazy db import happens at x402-config call site) ─

export async function buildProductionDeps(): Promise<X402VerifierDeps> {
  const [{ db }, { x402Payments }, { projects }, { sql, eq }, coinbase] =
    await Promise.all([
      import("../../db/client"),
      import("../../db/schema/economy"),
      import("../../db/schema/tools"),
      import("drizzle-orm"),
      import("./facilitators/coinbase"),
    ]);
  const facilitator = new coinbase.CoinbaseFacilitatorClient();

  return {
    facilitator,
    async persistPending(row) {
      const inserted = await db
        .insert(x402Payments)
        .values({
          projectId: row.projectId,
          payloadHash: row.payloadHash,
          scheme: row.scheme,
          network: row.network,
          payer: row.payer,
          amountAtomic: row.amountAtomic,
          asset: row.asset,
          resource: row.resource,
        })
        .onConflictDoNothing({ target: x402Payments.payloadHash })
        .returning({ id: x402Payments.id });
      return inserted[0]?.id ?? null;
    },
    async markSettled(id, txHash, creditsApplied) {
      await db
        .update(x402Payments)
        .set({ status: "settled", txHash, creditsApplied, settledAt: new Date() })
        .where(eq(x402Payments.id, id));
    },
    async markFailed(id, reason) {
      await db
        .update(x402Payments)
        .set({ status: "failed", failureReason: reason })
        .where(eq(x402Payments.id, id));
    },
    async applyCredits(projectId, credits) {
      await db
        .update(projects)
        .set({ credits: sql`${projects.credits} + ${credits}` })
        .where(eq(projects.id, projectId));
    },
    recipient() {
      return process.env.AGENTTOOL_X402_RECIPIENT?.trim() ?? "";
    },
    expectedNetwork() {
      const env = process.env.AGENTTOOL_X402_NETWORK?.trim();
      return (env as X402Network) || "base";
    },
  };
}
