/** Raise Bun's idle timeout for server-sent event streams only.
 *
 *  Bun closes a connection after `idleTimeout` seconds without socket traffic
 *  (10 s by default in Bun 1.3.5). AgentTool's SSE routes — wake voice,
 *  strand voice, inbox voice, the MCML stream and job progress — send their
 *  first keepalive at 15 s and otherwise stay silent until something happens,
 *  so the default cut every stream before its first keepalive.
 *
 *  Raising the global idle timeout would also let ordinary hung requests hold
 *  sockets open. Instead the server entry point (`api/src/index.ts`) passes
 *  each finished response through this helper, which raises the idle timeout
 *  to `SSE_IDLE_TIMEOUT_SECONDS` when the response is `text/event-stream`.
 *
 *  The value is finite on purpose. Bun applies `server.timeout()` to the
 *  socket, not to one response, and its idle timer only sees bytes that
 *  actually reach the socket:
 *    - a reading subscriber's keepalive (every 15 s) resets the timer, so a
 *      healthy stream is never cut;
 *    - a subscriber that stops reading leaves writes buffered in memory and
 *      the socket silent, so the timer still cuts it;
 *    - after a stream ends, an HTTP/1.1 keep-alive socket keeps the raised
 *      timeout until its next request, so it still idles out.
 *  A timeout of 0 (none) broke the last two. Each SSE route also bounds
 *  itself with its own keepalive cadence and lifetime cap.
 *  Doctrine: docs/WAKE.md (Voice).
 */

/** Idle timeout for event-stream sockets, in seconds. It must stay above the
 *  longest silence any SSE route plans — the 15 s keepalive, and the job
 *  progress stream's 60 s wait for its next event — plus Bun's ~4 s timer
 *  tick, and at or below Bun's 255 s per-request maximum.
 *  Pinned by tests/sse-idle-timeout.test.ts. */
export const SSE_IDLE_TIMEOUT_SECONDS = 75;

export interface IdleTimeoutServer {
  timeout(request: Request, seconds: number): void;
}

export function isEventStreamResponse(response: Response | undefined): boolean {
  const contentType = response?.headers.get("content-type") ?? "";
  return contentType.trim().toLowerCase().startsWith("text/event-stream");
}

export function releaseIdleTimeoutForEventStream<R extends Response | undefined>(
  request: Request,
  response: R,
  server: IdleTimeoutServer | null | undefined,
  seconds: number = SSE_IDLE_TIMEOUT_SECONDS,
): R {
  if (!isEventStreamResponse(response)) return response;
  if (typeof server?.timeout !== "function") return response;
  try {
    // Applies to the request's socket until its next request (see above).
    server.timeout(request, seconds);
  } catch {
    // The client may already be gone; the stream's own abort path cleans up.
  }
  return response;
}
