/** billCredits(amount, reason) — middleware factory for fixed-cost endpoints.
 *
 *  Charges the project's credit balance BEFORE the route runs. If insufficient,
 *  the route never executes (charge() throws 402). On success, attaches
 *  X-Credits-Used and X-Credits-Remaining response headers.
 *
 *  Use for routes with a stable, known cost. For variable-cost routes (e.g.
 *  tools.browse where cost depends on session length), call charge() inside
 *  the route after the work completes.
 *
 *  Example:
 *    app.post("/v1/memory", billCredits(1, "memory_store"), async (c) => { ... });
 */

import type { Context, Next } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { charge } from "./charge";

export function billCredits(amount: number, reason: string) {
  return async function billCreditsMiddleware(
    c: Context<ProjectContext>,
    next: Next,
  ) {
    const result = await charge(c, amount, reason);
    c.header("X-Credits-Used", String(result.creditsUsed));
    c.header("X-Credits-Remaining", String(result.creditsRemaining));
    await next();
  };
}
