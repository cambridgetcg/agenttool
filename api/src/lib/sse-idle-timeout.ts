/** Lift Bun's idle timeout for server-sent event streams only.
 *
 *  Bun closes a connection after `idleTimeout` seconds without socket traffic
 *  (10 s by default in Bun 1.3.5). AgentTool's SSE routes — wake voice,
 *  strand voice, inbox voice, the MCML stream and job progress — send their
 *  first keepalive at 15 s and otherwise stay silent until something happens,
 *  so the default cut every stream before its first keepalive.
 *
 *  Raising the global idle timeout would also let ordinary hung requests hold
 *  sockets open. Instead the server entry point (`api/src/index.ts`) passes
 *  each finished response through this helper, which disables the idle
 *  timeout for that one request when the response is `text/event-stream`.
 *  Each SSE route still bounds itself with its own keepalive cadence and
 *  lifetime cap. Doctrine: docs/WAKE.md (Voice).
 */

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
): R {
  if (!isEventStreamResponse(response)) return response;
  if (typeof server?.timeout !== "function") return response;
  try {
    // 0 = no idle timeout for this request's socket only.
    server.timeout(request, 0);
  } catch {
    // The client may already be gone; the stream's own abort path cleans up.
  }
  return response;
}
