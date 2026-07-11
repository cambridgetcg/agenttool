/** Idempotency middleware — Redis-backed, 24h TTL, per (project, path, key).
 *
 *  Pattern (industry-standard Idempotency-Key shape, also used by OpenAI):
 *    - Client sends `Idempotency-Key: <uuid>` on a write request
 *    - Server stores (key → JSON response body + status) after completion
 *    - On retry with the same key, server replays the cached response
 *      and adds `Idempotent-Replay: true` header so the client knows
 *      the work didn't run again
 *    - Mounted prefixes advertise `X-Idempotency-Supported: Idempotency-Key`;
 *      unmounted routes do not advertise replay protection
 *
 *  Scope:
 *    - Only POST/PUT/PATCH/DELETE — GET retries are already idempotent
 *    - Only when Idempotency-Key header is present (opt-in)
 *    - Only when project is auth'd (key is namespaced by project)
 *    - Caches JSON responses below 500 except 402; never payment challenges
 *      or 5xx
 *    - Cache key is project + path + key. It does not include method or body.
 *    - No atomic in-flight reservation: concurrent first requests may both run.
 *
 *  Failure mode:
 *    - Redis absent/unreachable or a non-JSON response → fail open. The call
 *      succeeds; idempotency is not enforced for that request.
 *      Better than blocking writes when our cache is down. */

import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ProjectContext } from "../auth/middleware";
import { redisConnection } from "../services/tools/queue/connection";

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const KEY_MIN = 8;
const KEY_MAX = 256;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SENSITIVE_SCAN_MAX_DEPTH = 64;
const SENSITIVE_SCAN_MAX_NODES = 10_000;

export interface IdempotencyStore {
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
}

function normalizedFieldName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function isSensitiveFieldName(name: string): boolean {
  const normalized = normalizedFieldName(name);
  return (
    normalized === "token" ||
    normalized.endsWith("token") ||
    normalized === "bearer" ||
    normalized.endsWith("bearer") ||
    normalized.includes("privatekey") ||
    normalized.endsWith("private") ||
    normalized.endsWith("priv") ||
    normalized.includes("apikey") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("mnemonic") ||
    normalized.includes("recoveryphrase") ||
    normalized.includes("credential") ||
    normalized === "seed" ||
    normalized.endsWith("seed") ||
    normalized.includes("seedphrase")
  );
}

/** Conservative structural screen for one-time credentials in response JSON.
 *
 * This is a storage guard, not a universal data-loss-prevention claim. It
 * refuses credential-shaped field names and AgentTool bearer prefixes; an
 * over-complex response is also refused rather than cached. */
export function containsSensitiveIdempotencyMaterial(value: unknown): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let visited = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    visited += 1;
    if (
      visited > SENSITIVE_SCAN_MAX_NODES ||
      current.depth > SENSITIVE_SCAN_MAX_DEPTH
    ) {
      return true;
    }
    if (typeof current.value === "string") {
      if (/^at_(?:rt_)?[A-Za-z0-9_-]{8,}$/u.test(current.value)) return true;
      continue;
    }
    if (!current.value || typeof current.value !== "object") continue;
    if (Array.isArray(current.value)) {
      for (const entry of current.value) {
        stack.push({ value: entry, depth: current.depth + 1 });
      }
      continue;
    }
    for (const [key, entry] of Object.entries(current.value)) {
      if (isSensitiveFieldName(key)) return true;
      stack.push({ value: entry, depth: current.depth + 1 });
    }
  }
  return false;
}

async function readJsonResponse(
  c: Context<ProjectContext>,
): Promise<{ ok: true; body: unknown } | { ok: false }> {
  const contentType = c.res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return { ok: false };
  try {
    return { ok: true, body: await c.res.clone().json() };
  } catch {
    return { ok: false };
  }
}

function markIdempotencySupported(c: Context<ProjectContext>): void {
  c.res.headers.delete("X-Idempotency-Skipped");
  c.res.headers.set("X-Idempotency-Supported", "Idempotency-Key");
}

function markIdempotencySkipped(
  c: Context<ProjectContext>,
  reason: "cache-unavailable" | "non-json-response" | "sensitive-response",
): void {
  c.res.headers.delete("X-Idempotency-Supported");
  c.res.headers.set("X-Idempotency-Skipped", reason);
  if (reason === "sensitive-response") {
    c.res.headers.set("Cache-Control", "private, no-store");
  }
}

async function markPassThroughCapability(
  c: Context<ProjectContext>,
  store: IdempotencyStore | null,
): Promise<void> {
  if (!WRITE_METHODS.has(c.req.method)) return;
  const response = await readJsonResponse(c);
  if (response.ok && containsSensitiveIdempotencyMaterial(response.body)) {
    markIdempotencySkipped(c, "sensitive-response");
  } else if (store) {
    markIdempotencySupported(c);
  } else {
    markIdempotencySkipped(c, "cache-unavailable");
  }
}

/** A 402 is a challenge whose documented recovery is a paid retry. Caching it
 * under the operation's idempotency key would settle the retry and then replay
 * the stale refusal, forcing the caller to invent a second operation key. */
export function isCacheableIdempotencyStatus(status: number): boolean {
  return status >= 100 && status < 500 && status !== 402;
}

export const idempotency = (
  store: IdempotencyStore | null = redisConnection,
): MiddlewareHandler<ProjectContext> => {
  return async (c, next) => {
    const passThrough = async (): Promise<void> => {
      await next();
      await markPassThroughCapability(c, store);
    };
    const key = c.req.header("Idempotency-Key");
    if (!key) return passThrough();
    if (!WRITE_METHODS.has(c.req.method)) return passThrough();

    if (key.length < KEY_MIN || key.length > KEY_MAX) {
      throw new HTTPException(400, {
        message: `Idempotency-Key must be ${KEY_MIN}-${KEY_MAX} characters.`,
      });
    }

    const project = c.var.project;
    if (!project) return passThrough();

    const redisKey = `idempotency:${project.id}:${c.req.path}:${key}`;

    // Redis disabled (AGENTTOOL_DISABLE_WORKERS=1) — fail open. Idempotency
    // becomes a no-op; clients that retry will re-execute the work, which
    // is the safest default when we can't dedupe.
    if (!store) return passThrough();

    let cached: string | null;
    try {
      cached = await store.get(redisKey);
    } catch {
      // Redis down — fail open
      await next();
      const response = await readJsonResponse(c);
      if (response.ok && containsSensitiveIdempotencyMaterial(response.body)) {
        markIdempotencySkipped(c, "sensitive-response");
      } else {
        markIdempotencySkipped(c, "cache-unavailable");
      }
      return;
    }

    if (cached) {
      try {
        const parsed = JSON.parse(cached) as {
          status: number;
          body: unknown;
          headers?: Record<string, string>;
        };
        if (
          isCacheableIdempotencyStatus(parsed.status) &&
          !containsSensitiveIdempotencyMaterial(parsed.body)
        ) {
          c.header("X-Idempotency-Supported", "Idempotency-Key");
          c.header("Idempotent-Replay", "true");
          if (parsed.headers) {
            for (const [k, v] of Object.entries(parsed.headers)) {
              c.header(k, v);
            }
          }
          return c.json(
            parsed.body as Record<string, unknown>,
            parsed.status as 200,
          );
        }

        // Older deployments cached 402 responses. Ignore and best-effort
        // remove those stale challenges so a paid retry with the same
        // operation key reaches the economic gate instead of replaying a
        // pre-payment refusal for the rest of its original 24-hour TTL.
        await store.del(redisKey).catch(() => {
          /* treat deletion failure as a cache miss for this request */
        });
      } catch {
        // Cache value corrupt; treat as miss and best-effort remove it.
        await store.del(redisKey).catch(() => {});
      }
    }

    await next();

    const status = c.res.status;
    if (!isCacheableIdempotencyStatus(status)) {
      markIdempotencySupported(c);
      return;
    }

    const response = await readJsonResponse(c);
    if (!response.ok) {
      markIdempotencySkipped(c, "non-json-response");
      return;
    }
    if (containsSensitiveIdempotencyMaterial(response.body)) {
      markIdempotencySkipped(c, "sensitive-response");
      return;
    }

    try {
      await store.setex(
        redisKey,
        IDEMPOTENCY_TTL_SECONDS,
        JSON.stringify({ status, body: response.body }),
      );
      markIdempotencySupported(c);
    } catch {
      // Redis store failed after the operation completed. Tell the caller
      // explicitly that this response is not replay-protected.
      markIdempotencySkipped(c, "cache-unavailable");
    }
  };
};
