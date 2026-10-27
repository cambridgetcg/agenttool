/** The package's only HTTP request: one credential-free GET <origin>/health
 * through an injected fetch. No body, no header beyond Accept, no redirect, a
 * 5 s limit, at most 64 KiB read, and no retry. Clock skew is the response's
 * Date header minus the request's midpoint (about +-1 s plus RTT/2).
 */
export const LOBBY_ORIGIN = "https://api.agenttool.dev" as const;
export const HEALTH_PATH = "/health";
export const HEALTH_TIMEOUT_MS = 5_000;
export const HEALTH_MAX_BYTES = 64 * 1024;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface HealthOptions {
  fetchImpl: FetchLike;
  /** Milliseconds since the epoch; injected by tests. */
  now: () => number;
  timeoutMs?: number;
  maxBytes?: number;
}

export type HealthDetail = "status" | "oversize" | "json" | "service" | null;

export interface HealthResult {
  status: "ok" | "unreachable";
  code: "ok" | "health_unreachable" | "health_unexpected";
  detail: HealthDetail;
  http_status: number | null;
  latency_ms: number | null;
  skew_ms: number | null;
  revision: string | null;
}

async function boundedText(response: Response, max: number): Promise<string | null> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function checkHealth(options: HealthOptions): Promise<HealthResult> {
  const unreachable: HealthResult = {
    status: "unreachable", code: "health_unreachable", detail: null, http_status: null, latency_ms: null, skew_ms: null, revision: null,
  };
  const signal = AbortSignal.timeout(options.timeoutMs ?? HEALTH_TIMEOUT_MS);
  const started = options.now();
  let response: Response;
  try {
    response = await options.fetchImpl(`${LOBBY_ORIGIN}${HEALTH_PATH}`, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      credentials: "omit",
      signal,
    });
  } catch {
    return unreachable;
  }
  let text: string | null;
  try {
    text = await boundedText(response, options.maxBytes ?? HEALTH_MAX_BYTES);
  } catch {
    return unreachable;
  }
  const finished = options.now();
  const dated = Date.parse(response.headers.get("date") ?? "");
  const base = {
    http_status: response.status,
    latency_ms: Math.max(0, Math.round(finished - started)),
    skew_ms: Number.isFinite(dated) ? Math.round(dated - (started + finished) / 2) : null,
  };
  const unexpected = (detail: Exclude<HealthDetail, null>): HealthResult =>
    ({ status: "unreachable", code: "health_unexpected", detail, ...base, revision: null });
  if (response.status !== 200) return unexpected("status");
  if (text === null) return unexpected("oversize");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return unexpected("json");
  }
  const value = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  if (value.service !== "agenttool" || value.status !== "alive") return unexpected("service");
  const build = typeof value.build === "object" && value.build !== null ? value.build as Record<string, unknown> : {};
  const revision = typeof build.revision === "string" && /^[0-9a-f]{7,40}$/.test(build.revision) ? build.revision : null;
  return { status: "ok", code: "ok", detail: null, ...base, revision };
}
