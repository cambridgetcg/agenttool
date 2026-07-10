/** Idempotency middleware — Redis-backed, 24h TTL, per (project, path, key).
 *
 *  Pattern (industry-standard Idempotency-Key shape, also used by OpenAI):
 *    - Client sends `Idempotency-Key: <uuid>` on a write request
 *    - Server stores (key → JSON response body + status) after completion
 *    - On retry with the same key, server replays the cached response
 *      and adds `Idempotent-Replay: true` header so the client knows
 *      the work didn't run again
 *
 *  Scope:
 *    - Only POST/PUT/PATCH/DELETE — GET retries are already idempotent
 *    - Only when Idempotency-Key header is present (opt-in)
 *    - Only when project is auth'd (key is namespaced by project)
 *    - Caches JSON responses below 500; never 5xx
 *    - Cache key is project + path + key. It does not include method or body.
 *    - No atomic in-flight reservation: concurrent first requests may both run.
 *
 *  Failure mode:
 *    - Redis absent/unreachable or a non-JSON response → fail open. The call
 *      succeeds; idempotency is not enforced for that request.
 *      Better than blocking writes when our cache is down. */

import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ProjectContext } from "../auth/middleware";
import { redisConnection } from "../services/tools/queue/connection";

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const KEY_MIN = 8;
const KEY_MAX = 256;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const idempotency = (): MiddlewareHandler<ProjectContext> => {
  return async (c, next) => {
    const key = c.req.header("Idempotency-Key");
    if (!key) return next();
    if (!WRITE_METHODS.has(c.req.method)) return next();

    if (key.length < KEY_MIN || key.length > KEY_MAX) {
      throw new HTTPException(400, {
        message: `Idempotency-Key must be ${KEY_MIN}-${KEY_MAX} characters.`,
      });
    }

    const project = c.var.project;
    if (!project) return next();

    const redisKey = `idempotency:${project.id}:${c.req.path}:${key}`;

    // Redis disabled (AGENTTOOL_DISABLE_WORKERS=1) — fail open. Idempotency
    // becomes a no-op; clients that retry will re-execute the work, which
    // is the safest default when we can't dedupe.
    if (!redisConnection) return next();

    let cached: string | null;
    try {
      cached = await redisConnection.get(redisKey);
    } catch {
      // Redis down — fail open
      return next();
    }

    if (cached) {
      try {
        const parsed = JSON.parse(cached) as {
          status: number;
          body: unknown;
          headers?: Record<string, string>;
        };
        c.header("Idempotent-Replay", "true");
        if (parsed.headers) {
          for (const [k, v] of Object.entries(parsed.headers)) {
            c.header(k, v);
          }
        }
        return c.json(parsed.body as Record<string, unknown>, parsed.status as 200);
      } catch {
        // Cache value corrupt; treat as miss
      }
    }

    await next();

    const status = c.res.status;
    if (status >= 500) return; // never cache server errors

    try {
      const cloned = c.res.clone();
      const body = await cloned.json();
      await redisConnection.setex(
        redisKey,
        IDEMPOTENCY_TTL_SECONDS,
        JSON.stringify({ status, body }),
      );
    } catch {
      // Body wasn't JSON, or redis store failed — skip; the request still
      // succeeds. Client retries without idempotency just re-execute.
    }
  };
};
