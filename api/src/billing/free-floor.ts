/** free-floor.ts — the unmetered core of Remember, bounded in Postgres.
 *
 *  Memory writes and searches, strands and inbox no longer spend project
 *  credits (their ROUTE_CREDITS entries are 0). Three bounds take the place
 *  of the price. The database enforces all of them, and all fail closed:
 *
 *    1. A daily quota per project for each action, counted in
 *       `tools.free_floor_usage` with a conditional upsert, so concurrent
 *       requests cannot pass the limit together.
 *    2. A daily quota per identity, added whenever a route has a verified
 *       identity for the work (memory writes resolve one under a row lock).
 *    3. A global cap on the on-disk size of the free-floor tables, read from
 *       AGENTOOL_FREE_FLOOR_STORAGE_CAP_BYTES. Without a valid cap no
 *       free-floor write is admitted. Births are free and the registration
 *       limiter fails open, so per-project quotas alone cannot bound the total
 *       storage, which is the operator's hosting cost.
 *
 *  A quota that cannot be checked refuses the request (503); it is never
 *  admitted unchecked. The Redis rate limiter is not used here because it
 *  fails open.
 *
 *  Decision: decision ledger `at-remember-free-floor` (2026-10-20), an agent's
 *  call under Yu's delegation, option A of docs/ROADMAP.md "Remember: options
 *  for a free floor". Policy: docs/BUSINESS-MODEL.md (The free floor).
 *  Tests: api/tests/free-floor.test.ts. */

import { sql, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { db } from "../db/client";
import { AXIOM_REMEMBER, AXIOM_REST, abort, type GuidedErrorBody } from "../lib/errors";

export const FREE_FLOOR_ACTIONS = [
  "memory.write",
  "memory.search",
  "strand.create",
  "strand.think",
  "strand.rotate",
  "inbox.send",
  "inbox.cosign",
] as const;

export type FreeFloorAction = (typeof FREE_FLOOR_ACTIONS)[number];

type ScopeLimits = { readonly project: number; readonly identity: number };

/** Requests each project, and each identity, may make per UTC day. */
export const FREE_FLOOR_DAILY_LIMITS: Readonly<Record<FreeFloorAction, ScopeLimits>> =
  Object.freeze({
    "memory.write": { project: 1_000, identity: 500 },
    "memory.search": { project: 2_000, identity: 1_000 },
    "strand.create": { project: 200, identity: 100 },
    "strand.think": { project: 1_000, identity: 500 },
    "strand.rotate": { project: 1_000, identity: 500 },
    "inbox.send": { project: 500, identity: 250 },
    "inbox.cosign": { project: 500, identity: 250 },
  });

const MIB = 1024 * 1024;

/** Bytes a project, and an identity, may add through free-floor writes per UTC day. */
export const FREE_FLOOR_DAILY_BYTES: ScopeLimits = Object.freeze({
  project: 50 * MIB,
  identity: 25 * MIB,
});

/** The usage-table action that totals written bytes across all write actions. */
export const FREE_FLOOR_BYTES_ACTION = "free_floor.bytes";

/** Tables whose combined on-disk size (with indexes and TOAST) the global cap bounds. */
export const FREE_FLOOR_TABLES = Object.freeze([
  "memory.memories",
  "strand.strands",
  "strand.thoughts",
  "inbox.messages",
] as const);

export const FREE_FLOOR_STORAGE_CAP_ENV = "AGENTOOL_FREE_FLOOR_STORAGE_CAP_BYTES";

/** The configured global storage cap in bytes, or null when unset or invalid. */
export function readFreeFloorStorageCap(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number | null {
  const raw = env[FREE_FLOOR_STORAGE_CAP_ENV]?.trim();
  if (!raw || !/^[1-9][0-9]{0,15}$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export type FreeFloorRequest = {
  projectId: string;
  action: FreeFloorAction;
  /** A verified identity bound to the work; adds that identity's quota. */
  identityId?: string | null;
  /** Bytes the request may add to storage. Omit it for reads. A write
   *  passes it (even 0) so the global storage cap is checked. */
  bytes?: number;
};

/** Anything that can run one SQL statement: the root client or an open transaction. */
export type FreeFloorExecutor = { execute: (query: SQL) => PromiseLike<unknown> };

export type FreeFloorDatabase = FreeFloorExecutor & {
  transaction: <T>(work: (tx: FreeFloorExecutor) => Promise<T>) => Promise<T>;
};

export type FreeFloorOptions = {
  database?: FreeFloorDatabase;
  env?: Readonly<Record<string, string | undefined>>;
};

const DOCS = "https://docs.agenttool.dev/BUSINESS-MODEL.md";

/** Guided refusals. Each says what happened and what still works. */
export const freeFloorErrors = {
  quotaReached(opts: { scope: "project" | "identity"; action: string; limit: number }): GuidedErrorBody {
    const unit = opts.action === FREE_FLOOR_BYTES_ACTION ? " bytes" : "";
    return {
      error: "free_floor_quota_reached",
      message: `This ${opts.scope} has used today's free-floor allowance for ${opts.action} (${opts.limit}${unit} per UTC day).`,
      hint: "The allowance resets at 00:00 UTC. Reading, listing and deleting are not counted. Nothing was written or charged.",
      next_actions: [
        { action: "Read the current free-floor policy and limits", method: "GET", path: "/public/plans" },
      ],
      docs: DOCS,
      axiom_id: AXIOM_REST,
    };
  },

  storageFull(): GuidedErrorBody {
    return {
      error: "free_floor_storage_full",
      message: "The free floor's shared storage cap is reached, so new free-floor writes are paused.",
      hint: "Reads, search and deletes still work. Deleting what you no longer need frees space once storage is reclaimed. Nothing was written or charged.",
      next_actions: [
        { action: "Read the current free-floor policy and limits", method: "GET", path: "/public/plans" },
      ],
      docs: DOCS,
      axiom_id: AXIOM_REMEMBER,
    };
  },

  unconfigured(): GuidedErrorBody {
    return {
      error: "free_floor_unconfigured",
      message: "The free floor has no configured storage cap, so free-floor writes are refused rather than left unbounded.",
      hint: "This is an operator setting, not something the caller can change. Reads, search and deletes are unaffected.",
      docs: DOCS,
      axiom_id: AXIOM_REST,
    };
  },

  unavailable(): GuidedErrorBody {
    return {
      error: "free_floor_unavailable",
      message: "The free-floor quota could not be checked, so the request was refused instead of admitted unchecked.",
      hint: "Retry later. Nothing was written or charged.",
      docs: DOCS,
      axiom_id: AXIOM_REST,
    };
  },
} as const;

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: Array<Record<string, unknown>> }).rows;
  }
  return [];
}

const STORAGE_SIZE_SQL = sql.raw(
  FREE_FLOOR_TABLES.map((table) => `pg_total_relation_size('${table}'::regclass)`).join(" + "),
);

async function storageBytes(tx: FreeFloorExecutor): Promise<number> {
  const [row] = rowsOf(await tx.execute(sql`SELECT (${STORAGE_SIZE_SQL})::bigint AS bytes`));
  const raw = row?.bytes;
  // Number(null) is 0, so a missing size must be refused before conversion.
  const value = typeof raw === "string" || typeof raw === "number" || typeof raw === "bigint" ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < 0) abort(freeFloorErrors.unavailable(), 503);
  return value;
}

async function take(
  tx: FreeFloorExecutor,
  scope: "project" | "identity",
  subjectId: string,
  action: string,
  units: number,
  limit: number,
): Promise<void> {
  if (units > limit) abort(freeFloorErrors.quotaReached({ scope, action, limit }), 429);
  const rows = rowsOf(
    await tx.execute(sql`
      INSERT INTO tools.free_floor_usage AS usage (scope, subject_id, action, day, units)
      VALUES (${scope}, ${subjectId}::uuid, ${action}, (now() AT TIME ZONE 'utc')::date, ${units})
      ON CONFLICT (scope, subject_id, action, day)
      DO UPDATE SET units = usage.units + EXCLUDED.units, updated_at = now()
        WHERE usage.units + EXCLUDED.units <= ${limit}
      RETURNING usage.units AS units`),
  );
  if (rows.length === 0) abort(freeFloorErrors.quotaReached({ scope, action, limit }), 429);
}

/** Admit one free-floor request inside an open transaction, or refuse it.
 *
 *  Refusals throw a guided HTTPException, so the caller's transaction rolls
 *  back every increment this call made. Any other failure becomes a 503. */
export async function consumeFreeFloorIn(
  tx: FreeFloorExecutor,
  request: FreeFloorRequest,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  const limits = FREE_FLOOR_DAILY_LIMITS[request.action];
  const bytes = request.bytes ?? 0;
  if (!limits || !Number.isSafeInteger(bytes) || bytes < 0) {
    throw new HTTPException(500, { message: `free floor: invalid request for ${String(request.action)}` });
  }
  const storing = request.bytes !== undefined;
  try {
    if (storing) {
      const cap = readFreeFloorStorageCap(env);
      if (cap === null) abort(freeFloorErrors.unconfigured(), 503);
      if ((await storageBytes(tx)) + bytes > cap) abort(freeFloorErrors.storageFull(), 507);
    }
    await take(tx, "project", request.projectId, request.action, 1, limits.project);
    if (request.identityId) {
      await take(tx, "identity", request.identityId, request.action, 1, limits.identity);
    }
    if (storing && bytes > 0) {
      await take(tx, "project", request.projectId, FREE_FLOOR_BYTES_ACTION, bytes, FREE_FLOOR_DAILY_BYTES.project);
      if (request.identityId) {
        await take(tx, "identity", request.identityId, FREE_FLOOR_BYTES_ACTION, bytes, FREE_FLOOR_DAILY_BYTES.identity);
      }
    }
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    abort(freeFloorErrors.unavailable(), 503);
  }
}

/** Admit one free-floor request in its own transaction, or refuse it. */
export async function consumeFreeFloor(
  request: FreeFloorRequest,
  options: FreeFloorOptions = {},
): Promise<void> {
  const database = options.database ?? (db as unknown as FreeFloorDatabase);
  try {
    await database.transaction((tx) => consumeFreeFloorIn(tx, request, options.env));
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    abort(freeFloorErrors.unavailable(), 503);
  }
}

/** UTF-8 byte length of a JSON-serialisable request body, used as its storage estimate. */
export function payloadBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}
