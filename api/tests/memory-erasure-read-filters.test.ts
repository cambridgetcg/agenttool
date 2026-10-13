/** The memory service's reads skip erased-in-place and expired memories.
 *
 *  Deletion spec wave 2 (§6 group 4, §7.4): a memory a paid witness receipt
 *  holds is erased in place (content_purged_at set, content = the marker),
 *  and an expired working memory is not served, by id included. /public/
 *  retention, the erase response and the docs say the memory service's reads
 *  (by id, by key, list, the keyset walk, text and vector search, count and
 *  the Wake's memory window) skip both. This pins the filter on each of those
 *  reads in the SQL drizzle generates, so a refactor that drops one fails
 *  here and not only in the opt-in PostgreSQL proof
 *  (integration/deletion-erase-postgres.test.ts). The keyset walk is pinned
 *  in continuity-walk-routes.test.ts.
 *
 *  Hermetic: real SQL generation over a pg-proxy transport that answers no
 *  rows. Uses mock.module, so the hermetic runner isolates this file. */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";

const PROJECT = "11111111-2222-4333-8444-555555555555";
const MEMORY = "22222222-2222-4333-8444-555555555555";

let queries: string[] = [];
const database = drizzle(async (sql) => {
  queries.push(sql.replace(/\s+/g, " "));
  return { rows: [] };
});
mock.module("../src/db/client", () => ({ db: database }));

const store = await import("../src/services/memory/store");

const PURGED_DRIZZLE = '"memory"."memories"."content_purged_at" is null';
const EXPIRY_DRIZZLE =
  '("memory"."memories"."expires_at" is null or "memory"."memories"."expires_at" > now())';
const PURGED_RAW = "AND content_purged_at IS NULL";
const EXPIRY_RAW = "AND (expires_at IS NULL OR expires_at > now())";

function memoryReads(): string[] {
  return queries.filter((sql) => /^(select|with)\b/i.test(sql.trim()) && /from "?memory"?\."?memories"?/i.test(sql));
}

async function run(read: () => Promise<unknown>): Promise<string[]> {
  queries = [];
  // The proxy answers no rows; some raw-SQL readers then fail to map an
  // empty result shape. Only the SQL they sent matters here.
  await read().catch(() => undefined);
  const reads = memoryReads();
  expect(reads.length).toBeGreaterThan(0);
  return reads;
}

beforeEach(() => {
  queries = [];
});

describe("the memory service's reads filter erasure and expiry", () => {
  const drizzleReads: Array<[string, () => Promise<unknown>]> = [
    ["readById", () => store.readById(PROJECT, MEMORY)],
    ["readByKey", () => store.readByKey(PROJECT, "notes")],
    ["listRecent", () => store.listRecent(PROJECT, { limit: 5 })],
    ["listForWake (the Wake's memory window)", () => store.listForWake(PROJECT, { limit: 5 })],
  ];
  for (const [name, read] of drizzleReads) {
    test(`${name}: content_purged_at IS NULL and the expiry predicate`, async () => {
      for (const sql of await run(read)) {
        expect({ name, purged: sql.includes(PURGED_DRIZZLE) }).toEqual({ name, purged: true });
        expect({ name, expiry: sql.includes(EXPIRY_DRIZZLE) }).toEqual({ name, expiry: true });
      }
    });
  }

  const rawReads: Array<[string, () => Promise<unknown>]> = [
    ["search (vector)", () => store.search(PROJECT, { query_embedding: Array(1536).fill(0.01), limit: 3 })],
    ["searchByText", () => store.searchByText(PROJECT, { query: "withdrawn by author", limit: 3 })],
    ["countMemories", () => store.countMemories(PROJECT)],
  ];
  for (const [name, read] of rawReads) {
    test(`${name}: content_purged_at IS NULL and the expiry predicate`, async () => {
      for (const sql of await run(read)) {
        expect({ name, purged: sql.includes(PURGED_RAW) }).toEqual({ name, purged: true });
        expect({ name, expiry: sql.includes(EXPIRY_RAW) }).toEqual({ name, expiry: true });
      }
    });
  }

  test("a repeat delete finds an erased-in-place row no longer (by id and by key)", async () => {
    database.transaction = (async (fn: (tx: typeof database) => unknown) => fn(database)) as typeof database.transaction;
    queries = [];
    await store.deleteById(PROJECT, MEMORY).catch(() => undefined);
    await store.deleteByKey(PROJECT, "notes").catch(() => undefined);
    const locks = memoryReads();
    expect(locks).toHaveLength(2);
    for (const sql of locks) {
      expect(sql).toContain(PURGED_DRIZZLE);
      expect(sql).toContain("for update");
    }
  });
});
