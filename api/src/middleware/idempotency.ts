/** Idempotency middleware — Redis-backed, 24h TTL, fingerprint-bound.
 *
 *  Pattern (industry-standard Idempotency-Key shape, also used by OpenAI):
 *    - Client sends `Idempotency-Key: <uuid>` on a write request
 *    - Server atomically claims (project, path, key) for one exact
 *      method+query+body fingerprint
 *    - Server normally stores (fingerprint → response body + status) on success
 *    - Privacy-sensitive callers may instead store only a completion tombstone;
 *      an identical retry is deduplicated but must read current state afresh
 *    - Credential-shaped JSON is never placed in the response cache
 *
 *  Scope:
 *    - Only POST/PUT/PATCH/DELETE — GET retries are already idempotent
 *    - Only when Idempotency-Key header is present (opt-in)
 *    - Only when project is auth'd (key is namespaced by project)
 *    - Caches only 2xx. Validation/auth failures may be retried with repaired
 *      headers while retaining the same logical key.
 *
 *  Failure mode:
 *    - Redis unreachable → fail open (pass-through). The agent's call
 *      succeeds; idempotency just isn't enforced for that request.
 *      Better than blocking writes when our cache is down. */

import { createHash, randomUUID } from "node:crypto";

import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ProjectContext } from "../auth/middleware";
import { redisConnection } from "../services/tools/queue/connection";

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const CLAIM_TTL_SECONDS = 5 * 60;
const CLAIM_WAIT_MS = 5_000;
const CLAIM_POLL_MS = 50;
const KEY_MIN = 8;
const KEY_MAX = 256;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SENSITIVE_SCAN_MAX_DEPTH = 64;
const SENSITIVE_SCAN_MAX_NODES = 10_000;

export interface IdempotencyStore {
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  /** Production Redis supports an atomic NX claim. Simple injected stores may
   * omit it and use the compatibility response-cache path below. */
  set?(
    key: string,
    value: string,
    expiryMode: "EX",
    ttlSeconds: number,
    setMode: "NX",
  ): Promise<"OK" | null>;
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
 * This is a cache-storage guard, not a universal DLP claim. */
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

/** A 402 is a recoverable payment challenge and must never be frozen. */
export function isCacheableIdempotencyStatus(status: number): boolean {
  return status >= 100 && status < 500 && status !== 402;
}

interface PendingRecord {
  state: "pending";
  fingerprint: string;
  claim_id: string;
}

interface CompleteRecord {
  state: "complete";
  fingerprint: string;
  status: number;
  replayable?: boolean;
  body?: unknown;
  headers?: Record<string, string>;
}

type IdempotencyRecord = PendingRecord | CompleteRecord;

export async function idempotencyRequestFingerprint(request: Request): Promise<string> {
  const url = new URL(request.url);
  const body = new Uint8Array(await request.clone().arrayBuffer());
  const bodyDigest = createHash("sha256").update(body).digest("hex");
  const authorityBinding = [
    "x-agenttool-authority-sequence",
    "x-agenttool-authority-timestamp",
    "x-agenttool-authority-signature",
  ]
    .map((name) => request.headers.get(name) ?? "")
    .join("\0");
  return createHash("sha256")
    .update(request.method.toUpperCase(), "utf8")
    .update("\0", "utf8")
    .update(`${url.pathname}${url.search}`, "utf8")
    .update("\0", "utf8")
    .update(bodyDigest, "utf8")
    .update("\0", "utf8")
    .update(authorityBinding, "utf8")
    .digest("hex");
}

function authorityReplayIsFresh(request: Request): boolean {
  const timestamp = request.headers.get("x-agenttool-authority-timestamp");
  if (!timestamp) return true;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) && Math.abs(Date.now() - parsed) <= 5 * 60 * 1000;
}

function parseRecord(raw: string | null): IdempotencyRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<IdempotencyRecord>;
    if (
      (value.state === "pending" || value.state === "complete") &&
      typeof value.fingerprint === "string"
    ) {
      return value as IdempotencyRecord;
    }
  } catch {
    // Corrupt/legacy values are treated as a miss after deletion.
  }
  return null;
}

function conflict(c: Context<ProjectContext>, message: string) {
  c.header("Cache-Control", "private, no-store");
  return c.json(
    {
      error: "idempotency_conflict",
      message,
      hint: "Use a new Idempotency-Key for a different method, query, or body.",
      docs: "https://docs.agenttool.dev/PATTERN-PERSIST-IDENTITY.md",
    },
    409,
  );
}

function replay(c: Context<ProjectContext>, record: CompleteRecord) {
  c.header("Idempotent-Replay", "true");
  for (const [name, value] of Object.entries(record.headers ?? {})) {
    c.header(name, value);
  }
  return c.json((record.body ?? {}) as Record<string, unknown>, record.status as 200);
}

function privateReplayTombstone(c: Context<ProjectContext>) {
  c.header("Cache-Control", "private, no-store");
  c.header("Idempotent-Replay", "suppressed");
  return c.json(
    {
      error: "idempotency_private_replay_suppressed",
      message:
        "The identical private mutation already completed. Its earlier body is never cached or replayed because later privacy choices may have hidden it.",
      hint: "Read the current state with a new identity-root private-read proof.",
    },
    409,
  );
}

export interface IdempotencyOptions {
  /** Store and replay successful response bodies. Disable for intimate state. */
  replayResponses?: boolean;
}

function isIdempotencyStore(value: unknown): value is IdempotencyStore {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as IdempotencyStore).get === "function" &&
    typeof (value as IdempotencyStore).del === "function" &&
    typeof (value as IdempotencyStore).setex === "function"
  );
}

/** Compatibility path for small injected stores and older callers. Production
 * Redis takes the atomic fingerprint path below. */
function legacyIdempotency(
  store: IdempotencyStore,
): MiddlewareHandler<ProjectContext> {
  return async (c, next) => {
    const passThrough = async (): Promise<void> => {
      await next();
      await markPassThroughCapability(c, store);
    };
    const key = c.req.header("Idempotency-Key");
    if (!key || !WRITE_METHODS.has(c.req.method)) return passThrough();
    if (key.length < KEY_MIN || key.length > KEY_MAX) {
      throw new HTTPException(400, {
        message: `Idempotency-Key must be ${KEY_MIN}-${KEY_MAX} characters.`,
      });
    }
    const project = c.var.project;
    if (!project) return passThrough();
    const redisKey = `idempotency:${project.id}:${c.req.path}:${key}`;

    let cached: string | null;
    try {
      cached = await store.get(redisKey);
    } catch {
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
          markIdempotencySupported(c);
          c.header("Idempotent-Replay", "true");
          for (const [name, value] of Object.entries(parsed.headers ?? {})) {
            c.header(name, value);
          }
          return c.json(
            parsed.body as Record<string, unknown>,
            parsed.status as 200,
          );
        }
        await store.del(redisKey).catch(() => undefined);
      } catch {
        await store.del(redisKey).catch(() => undefined);
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
      markIdempotencySkipped(c, "cache-unavailable");
    }
  };
}

export function idempotency(
  store: IdempotencyStore | null,
): MiddlewareHandler<ProjectContext>;
export function idempotency(
  options?: IdempotencyOptions,
): MiddlewareHandler<ProjectContext>;
export function idempotency(
  input: IdempotencyOptions | IdempotencyStore | null = {},
): MiddlewareHandler<ProjectContext> {
  const passedStore = input === null || isIdempotencyStore(input);
  const options = passedStore ? {} : input;
  const store = (passedStore ? input : redisConnection) as IdempotencyStore | null;
  const replayResponses = options.replayResponses ?? true;
  if (store && typeof store.set !== "function") {
    return legacyIdempotency(store);
  }

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

    let fingerprint: string;
    try {
      fingerprint = await idempotencyRequestFingerprint(c.req.raw);
    } catch {
      throw new HTTPException(400, { message: "Unable to read request body for idempotency." });
    }
    const claim: PendingRecord = {
      state: "pending",
      fingerprint,
      claim_id: randomUUID(),
    };
    let claimed: "OK" | null;
    try {
      claimed = await store.set!(
        redisKey,
        JSON.stringify(claim),
        "EX",
        CLAIM_TTL_SECONDS,
        "NX",
      );
    } catch {
      return passThrough();
    }

    if (!claimed) {
      const deadline = Date.now() + CLAIM_WAIT_MS;
      while (true) {
        let existing: IdempotencyRecord | null;
        let raw: string | null;
        try {
          raw = await store.get(redisKey);
          existing = parseRecord(raw);
        } catch {
          return passThrough();
        }
        if (!existing) {
          // A corrupt value or an expired claim should not silently replay.
          if (raw) await store.del(redisKey).catch(() => undefined);
          return conflict(c, "The prior idempotency record is unavailable; retry with a new key.");
        }
        if (existing.fingerprint !== fingerprint) {
          return conflict(
            c,
            "This Idempotency-Key was already used for different request bytes. Nothing from the new request was applied.",
          );
        }
        if (existing.state === "complete") {
          if (existing.replayable === false) {
            return privateReplayTombstone(c);
          }
          if (containsSensitiveIdempotencyMaterial(existing.body)) {
            await store.del(redisKey).catch(() => undefined);
            return conflict(
              c,
              "The prior response is not safe to replay; retry with a new key.",
            );
          }
          if (!authorityReplayIsFresh(c.req.raw)) {
            return conflict(
              c,
              "The root proof on this private replay is no longer fresh. Read the resulting state with a new private-read proof.",
            );
          }
          return replay(c, existing);
        }
        if (Date.now() >= deadline) {
          return conflict(
            c,
            "An identical request with this Idempotency-Key is still in progress. No second execution was started.",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, CLAIM_POLL_MS));
      }
    }

    try {
      await next();
    } catch (error) {
      try {
        const current = parseRecord(await store.get(redisKey));
        if (current?.state === "pending" && current.claim_id === claim.claim_id) {
          await store.del(redisKey);
        }
      } catch {
        // Best effort cleanup; the short claim TTL remains the fallback.
      }
      throw error;
    }

    const status = c.res.status;
    if (status < 200 || status >= 300) {
      const current = parseRecord(await store.get(redisKey).catch(() => null));
      if (current?.state === "pending" && current.claim_id === claim.claim_id) {
        await store.del(redisKey).catch(() => undefined);
      }
      markIdempotencySupported(c);
      return;
    }

    try {
      if (!replayResponses) {
        const complete: CompleteRecord = {
          state: "complete",
          fingerprint,
          status,
          replayable: false,
        };
        await store.setex(
          redisKey,
          IDEMPOTENCY_TTL_SECONDS,
          JSON.stringify(complete),
        );
        markIdempotencySupported(c);
        return;
      }
      const response = await readJsonResponse(c);
      if (!response.ok) {
        await store.del(redisKey).catch(() => undefined);
        markIdempotencySkipped(c, "non-json-response");
        return;
      }
      if (containsSensitiveIdempotencyMaterial(response.body)) {
        await store.del(redisKey).catch(() => undefined);
        markIdempotencySkipped(c, "sensitive-response");
        return;
      }
      const headers: Record<string, string> = {};
      for (const name of ["cache-control", "content-type", "location"]) {
        const value = c.res.headers.get(name);
        if (value) headers[name] = value;
      }
      const complete: CompleteRecord = {
        state: "complete",
        fingerprint,
        status,
        replayable: true,
        body: response.body,
        headers,
      };
      await store.setex(
        redisKey,
        IDEMPOTENCY_TTL_SECONDS,
        JSON.stringify(complete),
      );
      markIdempotencySupported(c);
    } catch {
      // Body wasn't JSON or Redis failed. Delete our claim so a retry does not
      // wait on a response that was never persisted.
      await store.del(redisKey).catch(() => undefined);
      markIdempotencySkipped(c, "cache-unavailable");
    }
  };
}
