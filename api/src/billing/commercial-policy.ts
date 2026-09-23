/** Owner decision, 2026-09-23: understanding needs no commercial return.
 * New platform purchases are retired, not waiting for an environment switch.
 * Existing payment records, refunds and reconciliation remain authoritative.
 * Doctrine: docs/BUSINESS-MODEL.md.
 */
import type { MiddlewareHandler } from "hono";
import { fail } from "../lib/errors";
import { getX402Payment } from "../middleware/x402";

export const NEW_PLATFORM_PURCHASES_ENABLED = false;
export const PURCHASES_RETIRED_MESSAGE =
  "New paid sign-ups, checkout and project-credit purchases are retired. Existing payment records, refunds and recovery remain available.";

export const retiredPurchaseAdmission: MiddlewareHandler = async (c) =>
  fail(c, {
    error: "purchases_retired",
    message: PURCHASES_RETIRED_MESSAGE,
    hint: "New purchase admission is retired. Previously recorded payment status and recovery receipts remain available; no fresh payment is requested.",
  }, 410);

/** Only the template purchase route has a historical x402 execution tariff.
 * Production's verifier rejects fresh authorizations. This marker therefore
 * admits only the exact prior project/path authorization whose credit settlement
 * won its one-time CAS in this request. A raw signature, receipt, pending state,
 * or settled replay cannot reopen purchase admission.
 */
export const retiredTemplatePurchaseAdmission: MiddlewareHandler = async (c, next) => {
  if (getX402Payment(c)) {
    await next();
    return;
  }
  return retiredPurchaseAdmission(c, next);
};
