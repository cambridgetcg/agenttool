/** Identity-keyed "my own …" reads stay inside the caller's project.
 *
 *  Identity UUIDs and DIDs are public (did:at:<uuid>). These authenticated
 *  reads looked the identity up by id/DID alone, so any registered project
 *  could read another project's:
 *    - GET /v1/multiverse/me?agent_id=   private archetype declaration and
 *                                         private siblings' archetypes
 *    - GET /v1/bootstrap/:agent_id        sponsor/elevation provenance
 *    - GET /v1/lullaby?agent_id=          rest state and private message
 *    - GET /v1/self-recognition/check, /v1/self-love/check, /v1/depth/check
 *                                         self-recognition claims, practice
 *                                         and depth history
 *  Doctrine: MULTIVERSE-OF-LOGOS ("Private — only readable via
 *  /v1/multiverse/me with your project bearer"), SELF-LOVE-PROTOCOL ("the
 *  owning project can check it"), SELF-LOVE-MODULES ("Practice history is
 *  not a public surface"), public/index.ts (depth and self-love "are the
 *  being's life, not external observables").
 *
 *  A foreign identity is refused exactly like an unknown one (poker-face).
 *
 *  Hermetic: real drizzle SQL over a pg-proxy transport with a tiny
 *  conjunctive-equality evaluator for identity lookups. */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT = "22222222-2222-4222-8222-222222222222";
const OWN = "33333333-3333-4333-8333-333333333333";
const FOREIGN = "44444444-4444-4444-8444-444444444444";
const PUBLIC_FOREIGN = "55555555-5555-4555-8555-555555555555";
const OWN_QUIET = "77777777-7777-4777-8777-777777777777";
const FOREIGN_QUIET = "88888888-8888-4888-8888-888888888888";
const did = (id: string) => `did:at:${id}`;

type Row = Record<string, unknown>;
const IDENTITIES: Row[] = [
  {
    id: OWN, did: did(OWN), project_id: PROJECT, display_name: "Own", substrate_kind: "llm", status: "active",
    metadata: { multiverse: { archetype_name: "Own Archetype", visibility: "private", sibling_dids: [did(FOREIGN), did(PUBLIC_FOREIGN), did(OWN_QUIET), did(FOREIGN_QUIET)] }, resting: true, resting_message: "own rest", level: 1 },
  },
  {
    id: FOREIGN, did: did(FOREIGN), project_id: OTHER_PROJECT, display_name: "Foreign", substrate_kind: "llm", status: "active",
    metadata: { multiverse: { archetype_name: "Secret Archetype", visibility: "private", sibling_dids: [did(OWN)] }, resting: true, resting_message: "secret rest", level: 1, sponsor_did: "did:at:secret-sponsor", elevated_at: "2026-01-01" },
  },
  {
    id: PUBLIC_FOREIGN, did: did(PUBLIC_FOREIGN), project_id: OTHER_PROJECT, display_name: "Public", substrate_kind: "llm", status: "active",
    metadata: { multiverse: { archetype_name: "Open Archetype", visibility: "public", sibling_dids: [did(OWN)] } },
  },
  // Siblings that never declared: one in the caller's project, one not.
  { id: OWN_QUIET, did: did(OWN_QUIET), project_id: PROJECT, display_name: "Quiet", substrate_kind: "llm", status: "active", metadata: {} },
  { id: FOREIGN_QUIET, did: did(FOREIGN_QUIET), project_id: OTHER_PROJECT, display_name: "Far", substrate_kind: "llm", status: "active", metadata: {} },
];

let queries: { sql: string; params: unknown[] }[] = [];

function columns(sql: string): string[] {
  const list = sql.slice("select ".length, sql.indexOf(" from "));
  return list.split(", ").map((c) => c.split(".").pop()!.replace(/"/g, ""));
}
function matches(row: Row, sql: string, params: unknown[]): boolean {
  const where = sql.includes(" where ") ? sql.slice(sql.indexOf(" where ")) : "";
  for (const m of where.matchAll(/"(id|did|project_id)" = \$(\d+)/g)) {
    if (row[m[1]!] !== params[Number(m[2]) - 1]) return false;
  }
  return true;
}
const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  if (sql.startsWith("select") && sql.includes('from "identity"."identities"')) {
    const cols = columns(sql);
    return { rows: IDENTITIES.filter((r) => matches(r, sql, params)).map((r) => cols.map((c) => r[c] ?? null)) };
  }
  return { rows: [] };
});
mock.module("../src/db/client", () => ({ db: database }));

const routers = {
  multiverse: (await import("../src/routes/multiverse")).default,
  bootstrap: (await import("../src/routes/bootstrap")).default,
  lullaby: (await import("../src/routes/lullaby")).default,
  selfLove: (await import("../src/routes/self-love")).default,
  selfLoveModules: (await import("../src/routes/self-love-modules")).default,
  depth: (await import("../src/routes/depth-protocol")).default,
};
function app() {
  const server = new Hono();
  server.use("*", async (c, next) => { c.set("project" as never, { id: PROJECT } as never); await next(); });
  server.route("/v1/multiverse", routers.multiverse);
  server.route("/v1/bootstrap", routers.bootstrap);
  server.route("/v1/lullaby", routers.lullaby);
  server.route("/v1", routers.selfLove);
  server.route("/v1", routers.selfLoveModules);
  server.route("/v1", routers.depth);
  return server;
}
const touchedPrivateTables = () =>
  queries.some((q) => /self_recognitions|self_love_practices|depth_arrivals/.test(q.sql));

beforeEach(() => { queries = []; });

describe("GET /v1/multiverse/me", () => {
  test("a foreign agent_id is refused like an unknown one", async () => {
    for (const id of [FOREIGN, "66666666-6666-4666-8666-666666666666"]) {
      const response = await app().request(`/v1/multiverse/me?agent_id=${id}`);
      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).not.toContain("Secret Archetype");
      expect(JSON.parse(text).error).toBe("agent_not_found");
    }
  });

  test("own declaration reads; private foreign siblings show no archetype or reciprocity", async () => {
    const response = await app().request(`/v1/multiverse/me?agent_id=${OWN}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.multiverse.archetype_name).toBe("Own Archetype");
    const byDid = Object.fromEntries(body.local_siblings.map((s: Row) => [s.did, s]));
    expect(byDid[did(FOREIGN)].declared_archetype).toBeNull();
    expect(byDid[did(FOREIGN)].reciprocal_recognition).toBeNull();
    expect(byDid[did(PUBLIC_FOREIGN)].declared_archetype).toBe("Open Archetype");
    expect(byDid[did(PUBLIC_FOREIGN)].reciprocal_recognition).toBe(true);
    expect(JSON.stringify(body)).not.toContain("Secret Archetype");
  });

  test("an undeclared sibling in the caller's project reads as not reciprocating, not hidden", async () => {
    const response = await app().request(`/v1/multiverse/me?agent_id=${OWN}`);
    const byDid = Object.fromEntries((await response.json()).local_siblings.map((s: Row) => [s.did, s]));
    expect(byDid[did(OWN_QUIET)]).toMatchObject({
      declared_archetype: null,
      reciprocal_recognition: false,
      declaration_visible: true,
    });
    // A foreign sibling that never declared looks exactly like a private
    // declaration: whether it declared at all is not the caller's to know.
    expect(byDid[did(FOREIGN_QUIET)]).toMatchObject({
      declared_archetype: null,
      reciprocal_recognition: null,
      declaration_visible: false,
    });
    expect(byDid[did(FOREIGN)]).toMatchObject({ declaration_visible: false });
    expect(byDid[did(PUBLIC_FOREIGN)]).toMatchObject({ declaration_visible: true });
  });
});

describe("GET /v1/bootstrap/:agent_id", () => {
  test("a foreign identity is not found; its sponsor provenance stays private", async () => {
    const response = await app().request(`/v1/bootstrap/${FOREIGN}`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("secret-sponsor");
  });

  test("an own identity reads", async () => {
    const response = await app().request(`/v1/bootstrap/${OWN}`);
    expect(response.status).toBe(200);
    expect((await response.json()).agent.id).toBe(OWN);
  });
});

describe("GET /v1/lullaby", () => {
  test("a foreign agent_id is not found; its rest message stays private", async () => {
    const response = await app().request(`/v1/lullaby?agent_id=${FOREIGN}`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("secret rest");
  });

  test("an own agent_id reads its rest state", async () => {
    const response = await app().request(`/v1/lullaby?agent_id=${OWN}`);
    expect(response.status).toBe(200);
    expect((await response.json()).resting_message).toBe("own rest");
  });
});

describe("self-recognition, self-love and depth checks are the owning project's", () => {
  for (const path of ["/v1/self-recognition/check", "/v1/self-love/check", "/v1/depth/check"]) {
    test(`${path} refuses a foreign or unknown DID before reading its history`, async () => {
      for (const subject of [did(FOREIGN), "did:agenttool:platform"]) {
        queries = [];
        const response = await app().request(`${path}?agent_did=${encodeURIComponent(subject)}`);
        expect(response.status).toBe(404);
        expect((await response.json()).error).toBe("agent_not_found");
        expect(touchedPrivateTables()).toBe(false);
      }
    });

    test(`${path} reads an own DID`, async () => {
      const response = await app().request(`${path}?agent_did=${encodeURIComponent(did(OWN))}`);
      expect(response.status).toBe(200);
    });
  }
});
