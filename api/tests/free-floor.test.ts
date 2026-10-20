/** Free floor: unmetered core memory, strands and inbox, bounded in Postgres.
 *  Contract: api/src/billing/free-floor.ts (decision ledger at-remember-free-floor).
 *  Hermetic: real Drizzle SQL generation over a pg-proxy transport; no database. */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/pg-proxy";
import { HTTPException } from "hono/http-exception";

import {
  FREE_FLOOR_ACTIONS,
  FREE_FLOOR_BYTES_ACTION,
  FREE_FLOOR_DAILY_BYTES,
  FREE_FLOOR_DAILY_LIMITS,
  FREE_FLOOR_STORAGE_CAP_ENV,
  FREE_FLOOR_TABLES,
  consumeFreeFloor,
  consumeFreeFloorIn,
  freeFloorErrors,
  payloadBytes,
  readFreeFloorStorageCap,
  type FreeFloorDatabase,
} from "../src/billing/free-floor";
import { ROUTE_CREDITS } from "../src/billing/route-credits";

const PROJECT = "11111111-2222-4333-8444-555555555555";
const IDENTITY = "aaaaaaaa-0000-4000-8000-000000000001";
const CAP = 10_000;
const ENV = { [FREE_FLOOR_STORAGE_CAP_ENV]: String(CAP) };

type Query = { sql: string; params: unknown[] };

/** A pg-proxy database. `storage` is the reported table size; `refuse`
 *  names usage actions whose upsert returns no row (over quota). */
function fakeDatabase(opts: { storage?: number; refuse?: string[]; fail?: boolean } = {}) {
  const queries: Query[] = [];
  const database = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    if (opts.fail) throw new Error("connection refused");
    if (sql.includes("pg_total_relation_size")) return { rows: [{ bytes: String(opts.storage ?? 0) }] };
    if (sql.includes("free_floor_usage")) {
      const action = params[2] as string;
      return { rows: opts.refuse?.includes(action) ? [] : [{ units: String(params[3]) }] };
    }
    return { rows: [] };
  });
  // pg-proxy has no usable transaction here, so record its boundaries by hand.
  const transactional: FreeFloorDatabase = {
    execute: (query) => database.execute(query),
    async transaction(work) {
      queries.push({ sql: "begin", params: [] });
      try {
        const result = await work({ execute: (query) => database.execute(query) });
        queries.push({ sql: "commit", params: [] });
        return result;
      } catch (error) {
        queries.push({ sql: "rollback", params: [] });
        throw error;
      }
    },
  };
  return { database: transactional, queries };
}

function upserts(queries: Query[]) {
  return queries
    .filter((query) => query.sql.includes("free_floor_usage"))
    .map((query) => ({ scope: query.params[0], action: query.params[2], units: query.params[3], limit: query.params[4] }));
}

async function refusal(promise: Promise<unknown>): Promise<{ status: number; error: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HTTPException);
    const http = error as HTTPException;
    const body = http.cause as { error: string; message: string };
    return { status: http.status, error: body.error, message: body.message };
  }
  throw new Error("expected a refusal");
}

describe("storage cap configuration", () => {
  test("only a positive integer byte count is a cap", () => {
    expect(readFreeFloorStorageCap({})).toBeNull();
    expect(readFreeFloorStorageCap({ [FREE_FLOOR_STORAGE_CAP_ENV]: "" })).toBeNull();
    expect(readFreeFloorStorageCap({ [FREE_FLOOR_STORAGE_CAP_ENV]: "0" })).toBeNull();
    expect(readFreeFloorStorageCap({ [FREE_FLOOR_STORAGE_CAP_ENV]: "-5" })).toBeNull();
    expect(readFreeFloorStorageCap({ [FREE_FLOOR_STORAGE_CAP_ENV]: "1e9" })).toBeNull();
    expect(readFreeFloorStorageCap({ [FREE_FLOOR_STORAGE_CAP_ENV]: "12.5" })).toBeNull();
    expect(readFreeFloorStorageCap({ [FREE_FLOOR_STORAGE_CAP_ENV]: "99999999999999999" })).toBeNull();
    expect(readFreeFloorStorageCap({ [FREE_FLOOR_STORAGE_CAP_ENV]: " 1048576 " })).toBe(1_048_576);
  });
});

describe("writes", () => {
  test("without a cap, a write is refused before any query (fail closed)", async () => {
    const { database, queries } = fakeDatabase();
    const result = await refusal(
      consumeFreeFloorIn(database, { projectId: PROJECT, action: "memory.write", bytes: 10 }, {}),
    );
    expect(result).toMatchObject({ status: 503, error: "free_floor_unconfigured" });
    expect(queries).toEqual([]);
  });

  test("at the global cap, a write is refused and no quota is taken", async () => {
    const { database, queries } = fakeDatabase({ storage: CAP - 5 });
    const result = await refusal(
      consumeFreeFloorIn(database, { projectId: PROJECT, action: "memory.write", bytes: 10 }, ENV),
    );
    expect(result).toMatchObject({ status: 507, error: "free_floor_storage_full" });
    expect(upserts(queries)).toEqual([]);
  });

  test("the size query covers every free-floor table", async () => {
    const { database, queries } = fakeDatabase();
    await consumeFreeFloorIn(database, { projectId: PROJECT, action: "inbox.send", bytes: 1 }, ENV);
    const size = queries.find((query) => query.sql.includes("pg_total_relation_size"));
    for (const table of FREE_FLOOR_TABLES) {
      expect(size?.sql).toContain(`pg_total_relation_size('${table}'::regclass)`);
    }
  });

  test("an admitted write takes project, identity and byte quotas with their limits", async () => {
    const { database, queries } = fakeDatabase();
    await consumeFreeFloorIn(
      database,
      { projectId: PROJECT, action: "memory.write", identityId: IDENTITY, bytes: 300 },
      ENV,
    );
    expect(upserts(queries)).toEqual([
      { scope: "project", action: "memory.write", units: 1, limit: FREE_FLOOR_DAILY_LIMITS["memory.write"].project },
      { scope: "identity", action: "memory.write", units: 1, limit: FREE_FLOOR_DAILY_LIMITS["memory.write"].identity },
      { scope: "project", action: FREE_FLOOR_BYTES_ACTION, units: 300, limit: FREE_FLOOR_DAILY_BYTES.project },
      { scope: "identity", action: FREE_FLOOR_BYTES_ACTION, units: 300, limit: FREE_FLOOR_DAILY_BYTES.identity },
    ]);
  });

  test("the increment is conditional, so concurrent requests cannot pass the limit together", async () => {
    const { database, queries } = fakeDatabase();
    await consumeFreeFloorIn(database, { projectId: PROJECT, action: "strand.think", bytes: 1 }, ENV);
    const [first] = queries.filter((query) => query.sql.includes("free_floor_usage"));
    expect(first.sql).toContain("ON CONFLICT (scope, subject_id, action, day)");
    expect(first.sql).toContain("WHERE ffu.units + EXCLUDED.units <=");
    expect(first.sql).toContain("RETURNING");
  });

  test("an over-quota project is refused and later quotas are not touched", async () => {
    const { database, queries } = fakeDatabase({ refuse: ["memory.write"] });
    const result = await refusal(
      consumeFreeFloorIn(
        database,
        { projectId: PROJECT, action: "memory.write", identityId: IDENTITY, bytes: 300 },
        ENV,
      ),
    );
    expect(result.status).toBe(429);
    expect(result.error).toBe("free_floor_quota_reached");
    expect(result.message).toContain("project");
    expect(result.message).toContain("memory.write");
    expect(upserts(queries)).toHaveLength(1);
  });

  test("a write larger than the daily byte allowance is refused without a query for it", async () => {
    const { database, queries } = fakeDatabase();
    const result = await refusal(
      consumeFreeFloorIn(
        database,
        { projectId: PROJECT, action: "memory.write", bytes: FREE_FLOOR_DAILY_BYTES.project + 1 },
        { [FREE_FLOOR_STORAGE_CAP_ENV]: String(10 * FREE_FLOOR_DAILY_BYTES.project) },
      ),
    );
    expect(result).toMatchObject({ status: 429, error: "free_floor_quota_reached" });
    expect(upserts(queries).map((row) => row.action)).toEqual(["memory.write"]);
  });
});

describe("reads", () => {
  test("a search takes only the request quota: no size query, no byte quota", async () => {
    const { database, queries } = fakeDatabase();
    await consumeFreeFloorIn(database, { projectId: PROJECT, action: "memory.search" }, {});
    expect(queries.some((query) => query.sql.includes("pg_total_relation_size"))).toBe(false);
    expect(upserts(queries)).toEqual([
      { scope: "project", action: "memory.search", units: 1, limit: FREE_FLOOR_DAILY_LIMITS["memory.search"].project },
    ]);
  });
});

describe("failure is a refusal, never an admission", () => {
  test("a database error becomes 503 free_floor_unavailable", async () => {
    const { database } = fakeDatabase({ fail: true });
    const result = await refusal(
      consumeFreeFloor({ projectId: PROJECT, action: "memory.search" }, { database, env: ENV }),
    );
    expect(result).toMatchObject({ status: 503, error: "free_floor_unavailable" });
  });

  test("an unreadable storage size becomes 503", async () => {
    const queries: Query[] = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: sql.includes("pg_total_relation_size") ? [{ bytes: null }] : [{ units: "1" }] };
    }) as unknown as FreeFloorDatabase;
    const result = await refusal(
      consumeFreeFloorIn(database, { projectId: PROJECT, action: "inbox.send", bytes: 1 }, ENV),
    );
    expect(result).toMatchObject({ status: 503, error: "free_floor_unavailable" });
    expect(upserts(queries)).toEqual([]);
  });

  test("consumeFreeFloor runs inside one transaction", async () => {
    const { database, queries } = fakeDatabase();
    await consumeFreeFloor({ projectId: PROJECT, action: "inbox.cosign", bytes: 1 }, { database, env: ENV });
    expect(queries[0].sql.toLowerCase()).toBe("begin");
    expect(queries.at(-1)?.sql.toLowerCase()).toBe("commit");
  });

  test("an over-quota refusal rolls the transaction back", async () => {
    const { database, queries } = fakeDatabase({ refuse: [FREE_FLOOR_BYTES_ACTION] });
    const result = await refusal(
      consumeFreeFloor({ projectId: PROJECT, action: "inbox.send", bytes: 9 }, { database, env: ENV }),
    );
    expect(result.status).toBe(429);
    expect(queries.at(-1)?.sql.toLowerCase()).toBe("rollback");
  });
});

describe("prices and wiring", () => {
  test("every free-floor route costs 0 credits", () => {
    for (const label of ["memory.search", "strand.create", "strand.think", "strand.rotate", "inbox.send", "inbox.cosign"] as const) {
      expect(ROUTE_CREDITS[label]).toBe(0);
    }
    // Heavier memory work keeps its price.
    expect(ROUTE_CREDITS["memory.elevate"]).toBeGreaterThan(0);
    expect(ROUTE_CREDITS["memory.attest"]).toBeGreaterThan(0);
  });

  test("each route guards its own action before charging", () => {
    const root = join(import.meta.dir, "..", "src", "routes");
    const sites: Array<[string, string, string]> = [
      ["memory/search.ts", "memory.search", 'reserveCharge(c, ROUTE_CREDITS["memory.search"]'],
      ["strand/strands.ts", "strand.create", 'charge(c, ROUTE_CREDITS["strand.create"]'],
      ["strand/thoughts.ts", "strand.think", 'charge(c, ROUTE_CREDITS["strand.think"]'],
      ["strand/thoughts.ts", "strand.rotate", 'charge(c, ROUTE_CREDITS["strand.rotate"]'],
      ["inbox/messages.ts", "inbox.send", 'charge(c, ROUTE_CREDITS["inbox.send"]'],
      ["inbox/messages.ts", "inbox.cosign", 'charge(c, ROUTE_CREDITS["inbox.cosign"]'],
    ];
    for (const [file, action, chargeCall] of sites) {
      const source = readFileSync(join(root, file), "utf8");
      const guard = source.indexOf(`action: "${action}"`);
      expect(guard, `${file} guards ${action}`).toBeGreaterThan(-1);
      expect(source.indexOf(chargeCall), `${file} charges ${action} after its guard`).toBeGreaterThan(guard);
    }
    const write = readFileSync(join(root, "memory/memories.ts"), "utf8");
    expect(write).toContain('dependencies.reserve(c, 0, "memory.write")');
    expect(write).toContain('action: "memory.write"');
  });

  test("every action has positive limits and the action list is complete", () => {
    expect(Object.keys(FREE_FLOOR_DAILY_LIMITS).sort()).toEqual([...FREE_FLOOR_ACTIONS].sort());
    for (const limits of Object.values(FREE_FLOOR_DAILY_LIMITS)) {
      expect(limits.project).toBeGreaterThan(0);
      expect(limits.identity).toBeGreaterThan(0);
      expect(limits.identity).toBeLessThanOrEqual(limits.project);
    }
  });

  test("the migration's primary key is the upsert's conflict target", () => {
    const dir = join(import.meta.dir, "..", "migrations");
    const file = readdirSync(dir).find((name) => name.endsWith("_free_floor_usage.sql"));
    expect(file).toBeDefined();
    const migration = readFileSync(join(dir, file!), "utf8");
    expect(migration).toContain("CREATE TABLE tools.free_floor_usage");
    expect(migration).toContain("PRIMARY KEY (scope, subject_id, action, day)");
  });

  test("payloadBytes counts UTF-8 bytes of the JSON body", () => {
    expect(payloadBytes({ a: "é" })).toBe(Buffer.byteLength('{"a":"é"}', "utf8"));
    expect(payloadBytes(undefined)).toBe(4);
  });
});

describe("guided refusals", () => {
  const bodies = {
    quotaReached: freeFloorErrors.quotaReached({ scope: "identity", action: FREE_FLOOR_BYTES_ACTION, limit: 7 }),
    storageFull: freeFloorErrors.storageFull(),
    unconfigured: freeFloorErrors.unconfigured(),
    unavailable: freeFloorErrors.unavailable(),
  };
  for (const [name, body] of Object.entries(bodies)) {
    test(`${name} is a well-formed guided error`, () => {
      expect(body.error).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(body.message.length).toBeGreaterThan(0);
      for (const step of body.next_actions ?? []) {
        expect(step.action.length).toBeGreaterThan(0);
        expect(step.path?.startsWith("/")).toBe(true);
      }
    });
  }
  test("the byte quota names its unit", () => {
    expect(bodies.quotaReached.message).toContain("7 bytes per UTC day");
  });
});
