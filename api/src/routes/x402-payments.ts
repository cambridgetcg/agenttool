/** Authenticated, project-scoped x402 payment status.
 *
 * This endpoint reconciles the payment/credit lifecycle only. It does not
 * replay or promise an exactly-once result from the paid tool request. */

import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { getProductionX402PaymentStatus } from "../services/economy/x402-payments";
import { storedX402NetworkMayApply } from "../services/economy/x402-policy";

type StatusLoader = typeof getProductionX402PaymentStatus;

export function createX402PaymentsRouter(
  loadStatus: StatusLoader = getProductionX402PaymentStatus,
  nowMs: () => number = Date.now,
  networkMayApply: (network: string) => boolean = storedX402NetworkMayApply,
) {
  const app = new Hono<ProjectContext>();
  app.get("/:authorizationHash", async (c) => {
    c.header("Cache-Control", "private, no-store");
    const hash = c.req.param("authorizationHash");
    if (!/^[0-9a-f]{64}$/u.test(hash)) {
      return c.json({ error: "payment_not_found" }, 404);
    }
    const row = await loadStatus(c.var.project.id, hash);
    if (!row) return c.json({ error: "payment_not_found" }, 404);
    const validBefore = row.authorizationEvidence.validBefore;
    const validBeforeMs = typeof validBefore === "string" && /^\d{1,78}$/u.test(validBefore)
      ? BigInt(validBefore) * 1000n
      : 0n;
    const graceDeadlineMs = validBeforeMs > 0n
      ? validBeforeMs + 5000n
      : 0n;
    const rawNowMs = nowMs();
    const currentMs = Number.isFinite(rawNowMs) && rawNowMs >= 0
      ? BigInt(Math.floor(rawNowMs))
      : 0n;
    const applicableInCurrentEnvironment = networkMayApply(row.network);
    const networkStatusOnly = !applicableInCurrentEnvironment &&
      (row.status === "inserted" || row.status === "pending" ||
        row.status === "externally_settled");
    const insertedAuthorizationExpired = row.status === "inserted" &&
      currentMs >= validBeforeMs;
    const pendingWithoutAttemptIsLive = !networkStatusOnly && row.status === "pending" &&
      !row.settlementAttemptedAt && currentMs < graceDeadlineMs;
    const rawRetryAfterSeconds = pendingWithoutAttemptIsLive
      ? (graceDeadlineMs - currentMs + 999n) / 1000n
      : null;
    const retryAfterSeconds = rawRetryAfterSeconds === null
      ? null
      : Number(rawRetryAfterSeconds > 2_147_483_647n
        ? 2_147_483_647n
        : rawRetryAfterSeconds);
    if (retryAfterSeconds !== null) {
      c.header("Retry-After", String(retryAfterSeconds));
    }
    let nextAction: string;
    if (networkStatusOnly) {
      nextAction = "payment_network_not_applicable_in_current_environment";
    } else if (insertedAuthorizationExpired) {
      nextAction = "request_fresh_challenge_without_payment_signature";
    } else if (row.status === "inserted") {
      nextAction = "retry_same_payment_signature";
    } else if (row.status === "pending" && row.settlementAttemptedAt) {
      nextAction = "manual_onchain_investigation";
    } else if (pendingWithoutAttemptIsLive) {
      nextAction = "await_current_attempt";
    } else if (row.status === "pending") {
      nextAction = "request_fresh_challenge_without_payment_signature";
    } else if (row.status === "externally_settled") {
      nextAction = "retry_same_payment_signature_to_apply_credit";
    } else if (row.status === "settled") {
      nextAction = "complete";
    } else {
      nextAction = "new_authorization";
    }
    return c.json({
      payment_id: row.authorizationHash,
      status: row.status,
      failure_reason: row.failureReason ?? null,
      scheme: row.scheme,
      network: row.network,
      asset: row.asset,
      amount: row.amountAtomic,
      pay_to: row.payTo,
      max_timeout_seconds: row.maxTimeoutSeconds,
      requirement_extra: row.requirementExtra,
      resource: row.resource,
      resource_info: row.resourceInfo,
      credits_purchased: row.creditsPurchased,
      authorization_evidence: row.authorizationEvidence,
      settlement_attempted_at: row.settlementAttemptedAt?.toISOString() ?? null,
      transaction: row.receipt?.transaction ?? null,
      receipt: row.receipt ?? null,
      credits_applied: row.creditsApplied ?? null,
      reconciles: "payment_and_project_credit_only",
      next_action: nextAction,
      retry_after_seconds: retryAfterSeconds,
      environment_note: networkStatusOnly
        ? `Stored network ${row.network} is inspectable but cannot settle or apply project credit in the current runtime. Base-Sepolia application requires the explicit local test environment and is always disabled in production and on Fly.`
        : null,
      pending_note: row.status === "pending" && row.settlementAttemptedAt
        ? "Settlement outcome is ambiguous. No automatic reconciliation worker exists; use the persisted authorization evidence for manual on-chain investigation before any credit decision."
        : pendingWithoutAttemptIsLive
          ? "The request that claimed this authorization may still be verifying it. Wait through validBefore plus five seconds; no automatic reconciliation worker is claimed."
          : row.status === "pending"
            ? "No settlement attempt was recorded before the authorization expired. This signature remains status-only; retry the tool without PAYMENT-SIGNATURE to request a fresh challenge under current policy. Tool output is not replayed."
            : null,
      updated_at: row.updatedAt?.toISOString() ?? null,
    });
  });
  return app;
}

const app = createX402PaymentsRouter();

export default app;
