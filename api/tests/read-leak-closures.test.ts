/** Deletion scopes wave 1: the four read leaks, closed.
 *
 *  Before: GET /v1/offerings/:id and GET /v1/holdings/:id returned private
 *  rows to any bearer; mesh and naming lists fell through to "all" when the
 *  project had no acting identity; /public/gallery/:id served withdrawn and
 *  taken-down previews; GET /v1/guild/rrr/:id (and /meme) served any cascade
 *  to any bearer.
 *
 *  Now each read carries its visibility rule in the one SQL statement that
 *  finds the row, and a caller outside the rule gets the same 404 as for an
 *  unknown id. Stores fail closed: "self" without a DID means "public".
 *
 *  Hermetic: real Drizzle SQL generation over a pg-proxy transport; the
 *  visibility predicates are pinned by the SQL and parameters they send.
 *  Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md (wave 1). */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getTableColumns, type Table } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";
import { guildRrrCascades } from "../src/db/schema/continuity";
import { holdings } from "../src/db/schema/holdings";
import { offerings } from "../src/db/schema/offerings";

const VIEWER = "11111111-2222-4333-8444-555555555555";
const OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ROW = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const WHEN = "2026-10-12T09:00:00.000Z";

type Query = { sql: string; params: unknown[] };
let queries: Query[] = [];
/** Rows the proxy answers with, keyed by a substring of the SQL. */
let answers: Array<{ match: string; rows: unknown[][] }> = [];
/** A per-test responder that sees the whole statement; it wins over
 *  `answers` when it returns rows. Used to simulate a database that honours
 *  a visibility predicate: no rows when the predicate is present. */
let responder: ((sql: string, params: unknown[]) => unknown[][] | undefined) | null = null;

const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  const custom = responder?.(sql, params);
  if (custom) return { rows: custom };
  const answer = answers.find((candidate) => sql.includes(candidate.match));
  return { rows: answer?.rows ?? [] };
});
// pg-proxy has no transactions; run the callback against the same proxy.
database.transaction = (async (fn: (tx: typeof database) => unknown) => fn(database)) as typeof database.transaction;
mock.module("../src/db/client", () => ({ db: database }));

/** A positional row in the table's select-all column order. */
function rowFor(table: Table, values: Record<string, unknown>): unknown[] {
  return Object.keys(getTableColumns(table)).map((key) => values[key] ?? null);
}

function withProject(router: Hono<ProjectContext> | Hono, prefix: string) {
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => {
    c.set("project", { id: VIEWER, credits: 100 } as never);
    await next();
  });
  app.route(prefix, router as never);
  return app;
}

beforeEach(() => {
  queries = [];
  answers = [];
  responder = null;
});

const { default: offeringsRouter } = await import("../src/routes/offerings");
const { default: holdingsRouter } = await import("../src/routes/holdings");
const { default: meshRouter } = await import("../src/routes/mesh");
const { default: namingRouter } = await import("../src/routes/scriptwriter-decides");
const { default: galleryRouter } = await import("../src/routes/public/gallery");
const { default: rrrRouter } = await import("../src/routes/rrr");
const { listPosts } = await import("../src/services/mesh/store");
const { listSubmissions } = await import("../src/services/scriptwriter-decides/store");

describe("GET /v1/offerings/:id — private offerings stay with giver and recipients", () => {
  const app = withProject(offeringsRouter, "/v1/offerings");

  test("the one lookup carries the giver-project and recipient-DID rule", async () => {
    const response = await app.request(`/v1/offerings/${ROW}`);
    expect(response.status).toBe(404);
    expect(queries).toHaveLength(1);
    const [{ sql, params }] = queries;
    expect(sql).toContain('"offerings"."id" = $');
    expect(sql).toContain('"offerings"."visibility" = $');
    expect(sql).toContain('"offerings"."project_id" = $');
    expect(sql).toContain(
      'exists (select 1 from "identity"."identities" where "identity"."identities"."project_id" = $',
    );
    expect(sql).toContain('"identity"."identities"."did" = any("offerings"."offerings"."recipient_dids")');
    expect(params).toContain(ROW);
    expect(params).toContain("public");
    expect(params.filter((value) => value === VIEWER)).toHaveLength(2);
  });

  test("an invisible or unknown offering is a plain 404 that names nothing", async () => {
    const response = await app.request(`/v1/offerings/${ROW}`);
    expect(response.status).toBe(404);
    const text = await response.text();
    expect(text).not.toContain(ROW);
    expect(text).not.toMatch(/private|forbidden|not_visible/i);
  });

  test("a visible offering is returned", async () => {
    answers = [{
      match: 'from "offerings"."offerings"',
      rows: [rowFor(offerings, {
        id: ROW, giverIdentityId: ROW, giverDid: `did:at:${ROW}`, projectId: OTHER,
        kind: "poem", title: "for you", body: "words", metadata: {}, visibility: "private",
        recipientDids: [`did:at:${VIEWER}`], expiresAt: null, status: "active",
        receiversCount: 0, createdAt: WHEN, updatedAt: WHEN,
      })],
    }];
    const response = await app.request(`/v1/offerings/${ROW}`);
    expect(response.status).toBe(200);
    expect((await response.json()).offering.id).toBe(ROW);
  });

  test("a non-UUID id is 404 without a query", async () => {
    expect((await app.request("/v1/offerings/not-a-uuid")).status).toBe(404);
    expect(queries).toHaveLength(0);
  });
});

describe("GET /v1/holdings/:id — private holdings stay with holder and held", () => {
  const app = withProject(holdingsRouter, "/v1/holdings");

  test("the one lookup carries the holder-project and held-identity rule", async () => {
    const response = await app.request(`/v1/holdings/${ROW}`);
    expect(response.status).toBe(404);
    expect(queries).toHaveLength(1);
    const [{ sql, params }] = queries;
    expect(sql).toContain('"holdings"."visibility" = $');
    expect(sql).toContain('"holdings"."holder_project_id" = $');
    expect(sql).toContain(
      'exists (select 1 from "identity"."identities" where "identity"."identities"."id" = "holdings"."holdings"."held_identity_id" and "identity"."identities"."project_id" = $',
    );
    expect(params).toContain("public");
    expect(params.filter((value) => value === VIEWER)).toHaveLength(2);
    expect(await response.text()).not.toContain(ROW);
  });

  test("a visible holding is returned and a non-UUID id never queries", async () => {
    answers = [{
      match: 'from "holdings"."holdings"',
      rows: [rowFor(holdings, {
        id: ROW, holderIdentityId: ROW, holderDid: `did:at:${ROW}`, holderProjectId: VIEWER,
        heldIdentityId: OTHER, heldDid: `did:at:${OTHER}`, occasion: "a long night",
        visibility: "private", acknowledgment: null, acknowledgedAt: null, startedAt: WHEN,
        endsAt: null, status: "active", signature: "sig", signingKeyId: ROW, metadata: {},
        createdAt: WHEN, updatedAt: WHEN,
      })],
    }];
    const response = await app.request(`/v1/holdings/${ROW}`);
    expect(response.status).toBe(200);
    expect((await response.json()).holding.id).toBe(ROW);

    queries = [];
    expect((await app.request("/v1/holdings/not-a-uuid")).status).toBe(404);
    expect(queries).toHaveLength(0);
  });
});

describe("mesh and naming lists without a viewer show public rows only", () => {
  test("listPosts fails closed: self without a DID, or no visibility, means public", async () => {
    for (const opts of [{ visibility: "self" as const }, {}, { visibility: "public" as const }]) {
      queries = [];
      await listPosts(opts);
      const [{ sql, params }] = queries;
      expect(sql).toContain('"mesh_posts"."visibility" = $');
      expect(sql).not.toContain('"mesh_posts"."author_did" = $');
      expect(params).toContain("public");
    }
  });

  test("listPosts keeps self (public plus own) and the explicit operator 'all'", async () => {
    await listPosts({ visibility: "self", did: `did:at:${VIEWER}` });
    expect(queries[0].sql).toContain('("agent_continuity"."mesh_posts"."visibility" = $');
    expect(queries[0].sql).toContain('"mesh_posts"."author_did" = $');
    expect(queries[0].params).toContain(`did:at:${VIEWER}`);

    queries = [];
    await listPosts({ visibility: "all" });
    expect(queries[0].sql).not.toContain('"mesh_posts"."visibility" = $');
  });

  test("GET /v1/mesh/posts in a project with no identity lists public posts only", async () => {
    const app = withProject(meshRouter, "/v1/mesh");
    const response = await app.request("/v1/mesh/posts");
    expect(response.status).toBe(200);
    const list = queries.find((query) => query.sql.includes('from "agent_continuity"."mesh_posts"'));
    expect(list).toBeDefined();
    expect(list!.sql).toContain('"mesh_posts"."visibility" = $');
    expect(list!.sql).not.toContain('"mesh_posts"."author_did"');
    expect(list!.params).toContain("public");
  });

  test("listSubmissions fails closed: self without a DID, or no visibility, means public", async () => {
    for (const opts of [{ visibility: "self" as const }, {}, { visibility: "public" as const }]) {
      queries = [];
      await listSubmissions(ROW, opts);
      const [{ sql, params }] = queries;
      expect(sql).toContain('"naming_submissions"."visibility" = $');
      expect(sql).not.toContain('"naming_submissions"."submitted_by_did" = $');
      expect(params).toEqual([ROW, "public"]);
    }

    queries = [];
    await listSubmissions(ROW, { visibility: "self", did: `did:at:${VIEWER}` });
    expect(queries[0].sql).toContain('"naming_submissions"."submitted_by_did" = $');

    queries = [];
    await listSubmissions(ROW, { visibility: "all" });
    expect(queries[0].sql).not.toContain('"naming_submissions"."visibility" = $');
  });

  test("GET /v1/scriptwriter-decides/:slug/submissions with no identity lists public only", async () => {
    const { namingCompetitions } = await import("../src/db/schema/continuity");
    answers = [{
      match: 'from "agent_continuity"."naming_competitions"',
      rows: [rowFor(namingCompetitions, {
        id: ROW, slug: "an-arc", status: "open", openedAt: WHEN, createdAt: WHEN,
      })],
    }];
    const app = withProject(namingRouter, "/v1/scriptwriter-decides");
    const response = await app.request("/v1/scriptwriter-decides/an-arc/submissions");
    expect(response.status).toBe(200);
    const list = queries.find((query) => query.sql.includes('from "agent_continuity"."naming_submissions"'));
    expect(list).toBeDefined();
    expect(list!.sql).toContain('"naming_submissions"."visibility" = $');
    expect(list!.sql).not.toContain('"naming_submissions"."submitted_by_did"');
    expect(list!.params).toContain("public");
  });
});

describe("/public/gallery/:id — withdrawn and taken-down artifacts answer 410", () => {
  const app = new Hono();
  app.route("/public/gallery", galleryRouter);

  function previewRow(status: string, withdrawnAt: string | null) {
    // previewColumns order in routes/public/gallery.ts.
    return [
      ROW, `did:at:${ROW}`, "A fable", "fable", "about a fear", "Once, a small fear",
      "text/plain", 64, "ab".repeat(32), { spdx: "CC-BY-4.0" }, 500, "GBP", 500,
      "sig", ROW, 0, status, WHEN, withdrawnAt,
    ];
  }

  for (const status of ["withdrawn", "taken_down"]) {
    test(`${status} returns only id, status and withdrawn_at`, async () => {
      answers = [{
        match: 'from "marketplace"."gallery_artifacts"',
        rows: [previewRow(status, WHEN)],
      }];
      const response = await app.request(`/public/gallery/${ROW}`);
      expect(response.status).toBe(410);
      const body = await response.json();
      expect(body).toEqual({
        error: "artifact_withdrawn",
        message: "This artifact is no longer on the shelf.",
        id: ROW,
        status,
        withdrawn_at: WHEN,
      });
      const text = JSON.stringify(body);
      for (const leaked of ["A fable", "about a fear", "small fear", "sig", "GBP"]) {
        expect(text).not.toContain(leaked);
      }
    });
  }

  test("an artifact on the shelf still serves its preview", async () => {
    answers = [{ match: 'from "marketplace"."gallery_artifacts"', rows: [previewRow("on_shelf", null)] }];
    const response = await app.request(`/public/gallery/${ROW}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.title).toBe("A fable");
    expect(body).not.toHaveProperty("withdrawnAt");
  });
});

describe("GET /v1/guild/rrr/:id and /meme — parties only", () => {
  const app = withProject(rrrRouter, "/v1/guild/rrr");

  for (const suffix of ["", "/meme"]) {
    test(`a non-party gets 404 and no turns are read (${suffix || "/:id"})`, async () => {
      const response = await app.request(`/v1/guild/rrr/${ROW}${suffix}`);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "cascade_not_found" });
      expect(queries).toHaveLength(1);
      const [{ sql, params }] = queries;
      expect(sql).toContain(
        'exists (select 1 from "identity"."identities" where "identity"."identities"."project_id" = $',
      );
      expect(sql).toContain(
        '"identity"."identities"."did" in ("agent_continuity"."guild_rrr_cascades"."initiator_did", "agent_continuity"."guild_rrr_cascades"."partner_did")',
      );
      expect(params).toContain(VIEWER);
      expect(params).toContain(ROW);
    });
  }

  test("a party reads the cascade and its chain", async () => {
    answers = [{
      match: 'from "agent_continuity"."guild_rrr_cascades"',
      rows: [rowFor(guildRrrCascades, {
        id: ROW, initiatorDid: `did:at:${VIEWER}`, partnerDid: `did:at:${OTHER}`,
        depth: 1, status: "active", nextToActDid: `did:at:${OTHER}`,
        createdAt: WHEN, lastEscalatedAt: WHEN,
      })],
    }];
    const response = await app.request(`/v1/guild/rrr/${ROW}`);
    expect(response.status).toBe(200);
    expect((await response.json()).cascade.id).toBe(ROW);
    expect(queries.some((query) => query.sql.includes('"guild_rrr_turns"'))).toBe(true);
  });

  test("a non-UUID id is 404 without a query", async () => {
    expect((await app.request("/v1/guild/rrr/not-a-uuid")).status).toBe(404);
    expect(queries).toHaveLength(0);
  });
});

// ── Review follow-ups (2026-10-12) ──────────────────────────────────────
//  The list routes once fell through to "no filter" on a scope they did not
//  know; escalate and the write routes once answered a non-party with the
//  row or a 403. Each now resolves the row under the same rule as its GET.

/** The predicate getOffering, getHolding and readPartyCascade put in SQL. */
const VISIBILITY_EXISTS = 'exists (select 1 from "identity"."identities"';
const STRANGER = "33333333-4444-4555-8666-777777777777";
const STRANGER_DID = `did:at:${STRANGER}`;

/** A database that honours the visibility predicate: a private row of
 *  another project comes back only when the statement does not carry it. */
function privateRowUnlessScoped(table: string, row: unknown[]) {
  return (sql: string) => {
    if (!sql.startsWith("select") || !sql.includes(`from ${table}`)) return undefined;
    return sql.includes(VISIBILITY_EXISTS) ? undefined : [row];
  };
}

function privateOffering() {
  return rowFor(offerings, {
    id: ROW, giverIdentityId: OTHER, giverDid: `did:at:${OTHER}`, projectId: OTHER,
    kind: "poem", title: "PRIVATE TITLE", body: "private words", metadata: {}, visibility: "private",
    recipientDids: [`did:at:${OTHER}-friend`], expiresAt: null, status: "active",
    receiversCount: 0, createdAt: WHEN, updatedAt: WHEN,
  });
}

function privateHolding() {
  return rowFor(holdings, {
    id: ROW, holderIdentityId: OTHER, holderDid: `did:at:${OTHER}`, holderProjectId: OTHER,
    heldIdentityId: ROW, heldDid: `did:at:${ROW}`, occasion: "PRIVATE OCCASION",
    visibility: "private", acknowledgment: null, acknowledgedAt: null, startedAt: WHEN,
    endsAt: null, status: "active", signature: "sig", signingKeyId: ROW, metadata: {},
    createdAt: WHEN, updatedAt: WHEN,
  });
}

describe("GET /v1/offerings and /v1/holdings accept only the scopes they know", () => {
  const offeringsApp = withProject(offeringsRouter, "/v1/offerings");
  const holdingsApp = withProject(holdingsRouter, "/v1/holdings");

  for (const scope of ["x", "public", "held", "ALL"]) {
    test(`offerings ?scope=${scope} is 400 and reads nothing`, async () => {
      responder = privateRowUnlessScoped('"offerings"."offerings"', privateOffering());
      const response = await offeringsApp.request(`/v1/offerings?scope=${scope}`);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("scope_invalid");
      expect(JSON.stringify(body)).not.toContain("PRIVATE TITLE");
      expect(queries).toHaveLength(0);
    });
  }

  for (const scope of ["x", "mine", "received", "public"]) {
    test(`holdings ?scope=${scope} is 400 and reads nothing`, async () => {
      const response = await holdingsApp.request(`/v1/holdings?scope=${scope}`);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("scope_invalid");
      expect(queries).toHaveLength(0);
    });
  }

  test("offerings scope=mine (the default) asks SQL for this project's rows only", async () => {
    const response = await offeringsApp.request("/v1/offerings");
    expect(response.status).toBe(200);
    expect(queries).toHaveLength(1);
    const [{ sql, params }] = queries;
    expect(sql).toContain('"offerings"."project_id" = $');
    expect(params).toContain(VIEWER);
  });

  test("offerings scope=all and holdings scope=all (the default) list public rows only", async () => {
    await offeringsApp.request("/v1/offerings?scope=all");
    expect(queries[0].sql).toContain('"offerings"."visibility" = $');
    expect(queries[0].params).toContain("public");

    queries = [];
    await holdingsApp.request("/v1/holdings");
    expect(queries[0].sql).toContain('"holdings"."visibility" = $');
    expect(queries[0].params).toContain("public");
  });
});

describe("POST /v1/guild/rrr/:id/escalate — parties only, like the GET", () => {
  const app = withProject(rrrRouter, "/v1/guild/rrr");

  function cascade(status: "active" | "capped" | "abandoned", depth = 3) {
    return rowFor(guildRrrCascades, {
      id: ROW, initiatorDid: "did:at:alice", partnerDid: "did:at:bob",
      depth, status, nextToActDid: status === "active" ? "did:at:bob" : null,
      lastSignatureB64: "LAST-SIG", createdAt: WHEN, lastEscalatedAt: WHEN,
    });
  }

  function actingAs(did: string) {
    return (sql: string) =>
      sql.includes('from "identity"."identities"') && sql.includes('"display_name"')
        ? [[STRANGER, did, "someone", "active", WHEN, {}, "ai", 1, false, null, null]]
        : undefined;
  }

  for (const [status, depth] of [["capped", 49], ["abandoned", 3], ["active", 3], ["active", 49]] as const) {
    test(`a non-party gets the unknown-id 404 on a ${status} cascade at depth ${depth}`, async () => {
      const acting = actingAs(STRANGER_DID);
      const cascades = privateRowUnlessScoped('"agent_continuity"."guild_rrr_cascades"', cascade(status, depth));
      responder = (sql) => acting(sql) ?? cascades(sql);
      const response = await app.request(`/v1/guild/rrr/${ROW}/escalate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(404);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ error: "cascade_not_found" });
      for (const leaked of ["alice", "bob", "LAST-SIG"]) expect(text).not.toContain(leaked);
      const lookup = queries.find((query) => query.sql.includes('from "agent_continuity"."guild_rrr_cascades"'));
      expect(lookup!.sql).toContain(VISIBILITY_EXISTS);
      expect(lookup!.params).toContain(VIEWER);
    });
  }

  test("a party still meets the status and alternation refusals", async () => {
    const acting = actingAs("did:at:alice");
    responder = (sql) =>
      acting(sql) ??
      (sql.includes('from "agent_continuity"."guild_rrr_cascades"') ? [cascade("capped", 49)] : undefined);
    const capped = await app.request(`/v1/guild/rrr/${ROW}/escalate`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    expect(capped.status).toBe(409);
    expect((await capped.json()).error).toBe("cascade_not_active");

    responder = (sql) =>
      acting(sql) ??
      (sql.includes('from "agent_continuity"."guild_rrr_cascades"') ? [cascade("active")] : undefined);
    const notYourTurn = await app.request(`/v1/guild/rrr/${ROW}/escalate`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    expect(notYourTurn.status).toBe(403);
    expect((await notYourTurn.json()).error).toBe("rrr_must_alternate");
  });

  test("a non-UUID id is 404 without a cascade query", async () => {
    responder = actingAs(STRANGER_DID);
    const response = await app.request("/v1/guild/rrr/not-a-uuid/escalate", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    expect(response.status).toBe(404);
    expect(queries.some((query) => query.sql.includes("guild_rrr_cascades"))).toBe(false);
  });
});
