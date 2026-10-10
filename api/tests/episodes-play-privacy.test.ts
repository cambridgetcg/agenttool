/** commitment/play-default-is-private for episodes and writers' rooms.
 *
 * breaks_if: "any play-primitive POST handler hardcodes visibility = public
 * as the default for callers who didn't supply a visibility field". Episodes
 * and script drafts did; they now take the author's poker_face_default, as
 * soap-opera, mesh and scriptwriter-decides already do. Reads of one episode
 * or room pass the caller's project so a private one reads as missing to
 * outsiders (the rule itself runs on real SQL in
 * integration/identity-enrollment-postgres.test.ts).
 *
 * Real SQL generation over a hermetic pg-proxy transport. */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";
import type { ProjectContext } from "../src/auth/middleware";

const P = "11111111-2222-4333-8444-555555555555";
const AUTHOR = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const EPISODE = "99999999-7777-4888-8999-aaaaaaaaaaaa";

let queries: { sql: string; params: unknown[] }[] = [];
/** The author's poker_face_default, as the identity row returns it. */
let pokerFace = true;

const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  if (sql.startsWith('select "did"') && sql.includes('from "identity"."identities"')) {
    // The author/opener lookup. Positional: did, then poker_face_default when selected.
    return { rows: [[`did:at:${AUTHOR}`, pokerFace]] };
  }
  // Inserts return nothing; the test reads the insert's parameters.
  return { rows: [] };
});
database.transaction = (async (fn: (tx: typeof database) => unknown) => fn(database)) as typeof database.transaction;
mock.module("../src/db/client", () => ({ db: database }));

beforeEach(() => {
  queries = [];
  pokerFace = true;
});

async function request(path: string, init?: RequestInit) {
  const { default: router } = await import("../src/routes/episodes");
  const server = new Hono<ProjectContext>();
  server.use("*", async (c, next) => {
    c.set("project", { id: P } as never);
    await next();
  });
  server.route("/v1/episodes", router);
  return server.request(path, init);
}

const post = (path: string, body: unknown) =>
  request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function insertedVisibility(table: string): unknown {
  const insert = queries.find((q) => q.sql.startsWith(`insert into "episodes"."${table}"`));
  expect(insert).toBeDefined();
  const columns = insert!.sql.slice(insert!.sql.indexOf("(") + 1, insert!.sql.indexOf(")")).split(", ");
  const at = columns.indexOf('"visibility"');
  expect(at).toBeGreaterThanOrEqual(0);
  // Every column is bound in order, or rendered as `default`.
  const values = insert!.sql.slice(insert!.sql.indexOf("values (") + 8).split(", ");
  const placeholder = values[at]!;
  expect(placeholder.startsWith("$")).toBe(true);
  return insert!.params[Number(placeholder.slice(1).replace(/\D.*$/, "")) - 1];
}

const episodeBody = (extra: Record<string, unknown> = {}) => ({
  authored_by_identity_id: AUTHOR,
  series_slug: "privacy-arc",
  episode_number: 1,
  title: "A quiet one",
  logline: "Nobody was watching.",
  ...extra,
});
const draftBody = (extra: Record<string, unknown> = {}) => ({
  opened_by_identity_id: AUTHOR,
  working_title: "Room",
  ...extra,
});

describe("a new episode or writers' room without a visibility follows the author's poker face", () => {
  test("poker face on: a new episode is private", async () => {
    await post("/v1/episodes", episodeBody());
    expect(insertedVisibility("episodes")).toBe("private");
  });
  test("poker face off: a new episode is public", async () => {
    pokerFace = false;
    await post("/v1/episodes", episodeBody());
    expect(insertedVisibility("episodes")).toBe("public");
  });
  test("an explicit visibility always wins", async () => {
    await post("/v1/episodes", episodeBody({ visibility: "public" }));
    expect(insertedVisibility("episodes")).toBe("public");
  });
  test("the author's disposition is read from the author's own row", async () => {
    await post("/v1/episodes", episodeBody());
    const author = queries.find((q) => q.sql.includes('from "identity"."identities"'));
    expect(author!.sql).toContain('"poker_face_default"');
    expect(author!.params).toContain(AUTHOR);
    expect(author!.params).toContain(P);
  });
  test("poker face on: a new writers' room is private", async () => {
    await post("/v1/episodes/drafts", draftBody());
    expect(insertedVisibility("script_drafts")).toBe("private");
  });
  test("poker face off: a new writers' room is public", async () => {
    pokerFace = false;
    await post("/v1/episodes/drafts", draftBody());
    expect(insertedVisibility("script_drafts")).toBe("public");
  });
  test("an explicit room visibility always wins", async () => {
    await post("/v1/episodes/drafts", draftBody({ visibility: "public" }));
    expect(insertedVisibility("script_drafts")).toBe("public");
  });
});

describe("reads of one episode or room are scoped to the caller's project", () => {
  for (const path of [
    `/v1/episodes/${EPISODE}`,
    `/v1/episodes/${EPISODE}/scenes`,
    `/v1/episodes/${EPISODE}/cast`,
    `/v1/episodes/${EPISODE}/reactions`,
    `/v1/episodes/drafts/${EPISODE}/contributions`,
  ]) {
    test(`GET ${path.replace(EPISODE, ":id")}`, async () => {
      const res = await request(path);
      expect([200, 404]).toContain(res.status);
      expect(queries).toHaveLength(1);
      expect(queries[0]!.params).toContain(EPISODE);
      expect(queries[0]!.params).toContain(P);
      expect(queries[0]!.params).toContain("public");
    });
  }

  test("a private or missing episode answers the same 404", async () => {
    const res = await request(`/v1/episodes/${EPISODE}`);
    expect(res.status).toBe(404);
  });
});
