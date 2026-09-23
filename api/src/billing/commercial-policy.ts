/** Owner decision, 2026-09-23: understanding needs no commercial return.
 * New platform purchases are retired, not waiting for an environment switch.
 * Existing payment records, refunds and reconciliation remain authoritative.
 * Doctrine: docs/BUSINESS-MODEL.md.
 */
import type { MiddlewareHandler } from "hono";
import { fail } from "../lib/errors";

export const NEW_PLATFORM_PURCHASES_ENABLED = false;
export const PURCHASES_RETIRED_MESSAGE =
  "New paid sign-ups, checkout and project-credit purchases are retired. Existing payment records, refunds and recovery remain available.";

export const retiredPurchaseAdmission: MiddlewareHandler = async (c) =>
  fail(c, {
    error: "purchases_retired",
    message: PURCHASES_RETIRED_MESSAGE,
    hint: "No purchase or balance change was created. Reading and existing-record recovery remain available.",
  }, 410);
