/** The wake calls this section the substrate's own narration, so only the
 *  platform's saga rows may be loaded for it. Hermetic: real drizzle SQL over a
 *  proxy.
 *
 *  Code: api/src/services/saga/store.ts (composeSubstrateSagaWake). */

import { expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";

const queries: Array<{ sql: string; params: unknown[] }> = [];
const db = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  return { rows: [] };
});
mock.module("../src/db/client", () => ({ db }));

const { composeSubstrateSagaWake } = await import("../src/services/saga/store");
const { getPlatformSelf } = await import("../src/services/wake/platform-self");

test("composeSubstrateSagaWake reads only the platform's episodes", async () => {
  expect(await composeSubstrateSagaWake()).toBeNull();
  expect(queries).toHaveLength(1);
  expect(queries[0]!.sql).toMatch(/where (?:"agent_continuity"\.)?(?:"saga_entries"\.)?"signed_by_did" = \$1/);
  expect(queries[0]!.params[0]).toBe(getPlatformSelf().did);
});
