/** Seeded catalogs any key-holder can read carry no personal material.
 *
 *  Some catalogs come from checksummed migrations, so their rows stay as
 *  written and the API applies a public reading when it serves them:
 *    - DEPTH-PROTOCOL engraving sets (/v1/depth/*): sets about Yu's own life
 *      are not offered, and paths stay inside the repository;
 *    - SELF-LOVE-MODULES (/v1/self-love/*): general wording, no citation of
 *      an auto-memory file on one machine;
 *    - saga seed episodes: a seed row that matches no current seed (retired
 *      or retitled) is served a short note, never its stored body;
 *    - the platform's public profile: the current expression, not the copy
 *      stored at first boot.
 *
 *  Hermetic: the routes run real drizzle SQL over a pg-proxy transport that
 *  answers with the seed rows parsed from the migrations. Hits name the
 *  surface, rule id and line only (tests/fixtures/relational-scan.ts). */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";

import { asText, MACHINE_PATH, scanRelational } from "./fixtures/relational-scan";
import { seedRows } from "./fixtures/sql-seed-rows";

const MIGRATIONS = join(import.meta.dir, "..", "migrations");
const PROJECT = "11111111-1111-4111-8111-111111111111";
const OWN = "33333333-3333-4333-8333-333333333333";
const PLATFORM_ID = "00000000-0000-0000-0000-000000000000";
const PLATFORM_DID = "did:agenttool:platform";
const SEED_SIGNATURE = "SEED_ENTRY_NO_RUNTIME_SIGNATURE";
const PERSONAL_SETS = ["mutual-knowledge-engraving", "sister-summoning", "substrate-honest-intimate"];

type Row = Record<string, unknown>;
const migration = (file: string) => readFileSync(join(MIGRATIONS, file), "utf8");

const ENGRAVING_SETS: Row[] = seedRows(migration("20260520T020000_depth_protocol.sql"), "agent_continuity.engraving_sets")
  .map((row, index) => ({
    ...row,
    id: `aaaaaaaa-0000-4000-8000-00000000000${index}`,
    canonical_sha256: "0".repeat(63) + String(index),
    created_at: "2026-05-20 02:00:00+00",
    updated_at: "2026-05-20 02:00:00+00",
  }));

const SELF_LOVE_MODULES: Row[] = seedRows(migration("20260520T040000_self_love_modules.sql"), "agent_continuity.self_love_modules")
  .map((row, index) => ({ ...row, id: `bbbbbbbb-0000-4000-8000-00000000000${index}`, created_at: "2026-05-20 04:00:00+00" }));

/** Seed rows a database may hold from earlier seed versions (titles from
 *  git history), next to an authored episode with a real signature. */
let SAGA_ROWS: Row[] = [];

const IDENTITIES: Row[] = [
  {
    id: OWN, did: `did:at:${OWN}`, project_id: PROJECT, display_name: "Own", capabilities: [], trust_score: 0,
    status: "active", metadata: {}, expression: null, expression_visibility: "private", created_at: "2026-05-20 00:00:00+00",
    parent_identity_id: null, forked_at: null, quiet_until: null, quiet_reason: null,
  },
  {
    id: PLATFORM_ID, did: PLATFORM_DID, project_id: PLATFORM_ID, display_name: "agenttool", capabilities: [], trust_score: 0,
    status: "active", metadata: { kind: "platform" }, expression_visibility: "public", created_at: "2026-05-13 00:00:00+00",
    parent_identity_id: null, forked_at: null, quiet_until: null, quiet_reason: null,
    // The copy stored at first boot: it differs from the current constant.
    expression: { register: "first boot", walls: [], wake_text: "first boot", doctrine: ["docs/STORED-AT-FIRST-BOOT.md"], built_with: "love" },
  },
];

const TABLES: Record<string, () => Row[]> = {
  '"agent_continuity"."engraving_sets"': () => ENGRAVING_SETS,
  '"agent_continuity"."self_love_modules"': () => SELF_LOVE_MODULES,
  '"agent_continuity"."saga_entries"': () => SAGA_ROWS,
  '"identity"."identities"': () => IDENTITIES,
};

function columns(sql: string): string[] {
  const list = sql.slice("select ".length, sql.indexOf(" from "));
  return list.split(", ").map((column) => column.split(".").pop()!.replace(/"/g, ""));
}

/** Conjunctive column = $n equality, the only filter these reads use. */
function matches(row: Row, sql: string, params: unknown[]): boolean {
  const where = sql.includes(" where ") ? sql.slice(sql.indexOf(" where ")) : "";
  for (const m of where.matchAll(/"([a-z_]+)" = \$(\d+)/g)) {
    if (row[m[1]!] !== params[Number(m[2]) - 1]) return false;
  }
  return true;
}

const database = drizzle(async (sql, params) => {
  if (sql.startsWith("select")) {
    const table = Object.keys(TABLES).find((name) => sql.includes(`from ${name}`));
    if (table) {
      const cols = columns(sql);
      return { rows: TABLES[table]!().filter((row) => matches(row, sql, params)).map((row) => cols.map((c) => row[c] ?? null)) };
    }
  }
  return { rows: [] };
});
mock.module("../src/db/client", () => ({ db: database }));

const depthRouter = (await import("../src/routes/depth-protocol")).default;
const selfLoveModulesRouter = (await import("../src/routes/self-love-modules")).default;
const agentsRouter = (await import("../src/routes/public/agents")).default;
const { listSaga, readSaga, RETIRED_SEED_BODY } = await import("../src/services/saga/store");
const { SAGA_SEEDS } = await import("../src/services/saga/seed");
const { platformExpression } = await import("../src/services/wake/platform-bootstrap");

function app() {
  const server = new Hono();
  server.use("*", async (c, next) => {
    c.set("project" as never, { id: PROJECT } as never);
    await next();
  });
  server.route("/v1", depthRouter);
  server.route("/v1", selfLoveModulesRouter);
  server.route("/public/agents", agentsRouter);
  return server;
}

async function served(path: string): Promise<{ status: number; body: unknown; text: string }> {
  const response = await app().request(path);
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text), text };
}

describe("DEPTH-PROTOCOL engraving sets, as any key-holder reads them", () => {
  test("the seed parses into the eight seeded sets", () => {
    expect(ENGRAVING_SETS.map((row) => row.slug)).toHaveLength(8);
    for (const slug of PERSONAL_SETS) expect(ENGRAVING_SETS.some((row) => row.slug === slug)).toBe(true);
  });

  test("GET /v1/depth/engraving-sets offers only the general sets, with repository paths", async () => {
    const { status, body, text } = await served("/v1/depth/engraving-sets");
    expect(status).toBe(200);
    const sets = (body as { engraving_sets: Array<{ slug: string; canonicalPaths: string[] }> }).engraving_sets;
    expect(sets.map((set) => set.slug).sort()).toEqual([
      "caught-mode-math",
      "math-tetralogy",
      "naming-and-recognition",
      "seven-doctrine-framework",
      "strategy-14-cloud-continuity",
    ]);
    for (const set of sets) {
      expect(set.canonicalPaths.length).toBeGreaterThan(0);
      for (const path of set.canonicalPaths) expect(path.startsWith("docs/")).toBe(true);
    }
    expect(scanRelational("/v1/depth/engraving-sets", asText(body))).toEqual([]);
    expect(MACHINE_PATH.test(text)).toBe(false);
    expect(text).not.toMatch(/auto-memory|\.claude\//i);
  });

  test("GET /v1/depth/check lists and suggests only the general sets", async () => {
    const { status, body, text } = await served(`/v1/depth/check?agent_did=did:at:${OWN}`);
    expect(status).toBe(200);
    const check = body as { engraving_sets: Array<{ slug: string }>; summary: { total_sets: number } };
    expect(check.summary.total_sets).toBe(5);
    for (const slug of PERSONAL_SETS) expect(text).not.toContain(slug);
    expect(scanRelational("/v1/depth/check", asText(body))).toEqual([]);
    expect(MACHINE_PATH.test(text)).toBe(false);
  });

  test("an arrival at a set that is not offered is refused like an unknown set", async () => {
    for (const slug of PERSONAL_SETS) {
      const response = await app().request("/v1/depth/arrive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_did: `did:at:${OWN}`,
          engraving_set_slug: slug,
          engravings_read: ["docs/THE-RECOGNITION.md"],
          depth_state: "partial-depth",
          signature: "c2lnbmF0dXJl",
          signing_key_id: "99999999-9999-4999-8999-999999999999",
        }),
      });
      expect(response.status).toBe(404);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("unknown_engraving_set");
    }
  });
});

describe("SELF-LOVE-MODULES catalog, as any key-holder reads it", () => {
  test("GET /v1/self-love/modules serves the eight modules in their general sense", async () => {
    const { status, body, text } = await served("/v1/self-love/modules");
    expect(status).toBe(200);
    const modules = (body as { modules: Array<{ slug: string; compositionWith: string[] }> }).modules;
    expect(modules).toHaveLength(8);
    for (const module of modules) expect(module.compositionWith.length).toBeGreaterThan(0);
    expect(scanRelational("/v1/self-love/modules", asText(body))).toEqual([]);
    expect(MACHINE_PATH.test(text)).toBe(false);
    // An agent tending its own auto-memory is a general practice; a citation
    // of one machine's memory file is not.
    expect(text).not.toMatch(/feedback[-_]|\(auto-memory\)/i);
  });

  test("GET /v1/self-love/check scans clean", async () => {
    const { status, body } = await served(`/v1/self-love/check?agent_did=did:at:${OWN}`);
    expect(status).toBe(200);
    expect(scanRelational("/v1/self-love/check", asText(body))).toEqual([]);
  });
});

describe("saga seed rows from earlier seed versions", () => {
  test("a seed row that matches no current seed is served the note, never its stored body", async () => {
    const stored = (n: number) => `stored body of an earlier seed version, row ${n}`;
    SAGA_ROWS = [
      // Titles from the first saga seed, retired or retitled since.
      { ep: 2, title: "THE SUBSTRATE REVIEWS EP.1" },
      { ep: 3, title: "THE SUBSTRATE REVIEWS THE REVIEW" },
      // Current seeds, as an older version stored them.
      ...SAGA_SEEDS.map((seed) => ({ ep: seed.ep_number, title: seed.title })),
    ].map((row, index) => ({
      id: `cccccccc-0000-4000-8000-00000000000${index}`,
      ep_number: row.ep,
      title: row.title,
      logline: "logline",
      body: stored(index),
      references_ep_numbers: [],
      cast_dids: [],
      signed_by_did: PLATFORM_DID,
      signature: SEED_SIGNATURE,
      signing_key_id: PLATFORM_ID,
      aired_at: "2026-05-18 00:00:00+00",
      parent_saga_did: null,
      spinoff_kind: null,
    }));
    SAGA_ROWS.push({
      ...SAGA_ROWS[0]!,
      id: "cccccccc-0000-4000-8000-0000000000aa",
      ep_number: 7,
      title: "An authored episode",
      body: "authored text",
      signed_by_did: `did:at:${OWN}`,
      signature: "c2lnbmVk",
    });

    const episodes = await listSaga({ limit: 50 });
    expect(episodes).toHaveLength(SAGA_ROWS.length);
    for (const episode of episodes) {
      if (episode.signed_by_did !== PLATFORM_DID) {
        expect(episode.body).toBe("authored text");
        continue;
      }
      const current = SAGA_SEEDS.find((seed) => seed.ep_number === episode.ep_number && seed.title === episode.title);
      expect(episode.body).toBe(current ? current.body : RETIRED_SEED_BODY);
      expect(episode.body).not.toMatch(/stored body of an earlier seed version/);
    }
    const retired = await readSaga(3);
    expect(retired?.body).toBe(RETIRED_SEED_BODY);
  });
});

describe("the platform's public profile", () => {
  test("serves the current expression, not the copy stored at first boot", async () => {
    const { status, body, text } = await served(`/public/agents/${encodeURIComponent(PLATFORM_DID)}`);
    expect(status).toBe(200);
    expect((body as { expression: unknown }).expression).toEqual(platformExpression());
    expect(text).not.toContain("STORED-AT-FIRST-BOOT");
    expect(scanRelational("/public/agents/<platform>", asText(body))).toEqual([]);
  });
});
