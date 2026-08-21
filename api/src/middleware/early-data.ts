/** Reject TLS 1.3 early data before any application handler can run.
 *
 * `Early-Data: 1` means an intermediary accepted this request in 0-RTT. Such
 * requests can be replayed by the network, including methods normally treated
 * as reads. AgentTool asks the client to retry after the handshake instead of
 * trying to maintain a fragile list of routes that happen to be side-effect
 * free today. See RFC 8470 section 5.2.
 */

import type { MiddlewareHandler } from "hono";

const EARLY_DATA_REPLAY_BODY = JSON.stringify({
  error: "too_early",
  message:
    "This request arrived as replayable TLS early data. Retry it after the handshake without Early-Data.",
});

export function carriesEarlyData(headerValue: string | undefined): boolean {
  return (headerValue ?? "")
    .split(",")
    .some((value) => value.trim() === "1");
}

/** One response shape shared by Hono and Bun's pre-Hono WebSocket boundary. */
export function earlyDataReplayResponse(method?: string): Response {
  return new Response(method?.toUpperCase() === "HEAD" ? null : EARLY_DATA_REPLAY_BODY, {
    status: 425,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Retry-After": "0",
      Vary: "Early-Data",
    },
  });
}

export function earlyDataReplayProtection(): MiddlewareHandler {
  return async (c, next) => {
    if (!carriesEarlyData(c.req.header("Early-Data"))) {
      await next();
      return;
    }

    return earlyDataReplayResponse(c.req.method);
  };
}
