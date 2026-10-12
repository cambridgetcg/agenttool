/** Owner-gated deletes and withdrawals (deletion spec §5.1, §17 wave 2 item 2).
 *
 *  Every route that moved to R(owner) answers the same five ways:
 *    - bearer only, owner has no root, project has no root → allowed;
 *    - bearer only, owner is agent-rooted → 428 authority_proof_required with
 *      a hint naming the owner's root and the SDK helper;
 *    - signed by the owner's root over the exact request → allowed;
 *    - a stale or replayed proof → 409 authority_sequence_conflict, and a
 *      request touching owners that need different consents (the keyed
 *      memory delete is the only route that can name several) → 409
 *      authority_quorum_required;
 *    - an owner outside the caller's project → 404, the same answer as a
 *      missing row.
 *  Each allowed call writes exactly one ledger entry (recorded here) with
 *  the owner as its subject; refusals write none.
 *
 *  Hermetic: real routers, the real owner rule and ed25519 verification, over
 *  an in-memory pg-proxy model of the rows they read. The ledger writer is a
 *  recorder (its SQL is proven in integration/deletion-ledger-postgres.test.ts
 *  and integration/owned-content-postgres.test.ts). */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { getTableColumns, type Table } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ProjectContext } from "../src/auth/middleware";
import { blessings, guildRecognitions, unconditionals } from "../src/db/schema/continuity";

const uid = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;

// Projects: LEGACY_P has no roots; ROOTED_P has one founding root and a legacy
// sibling; MULTI_P has two roots and a legacy being; FOREIGN_P is elsewhere.
const LEGACY_P = uid(1), ROOTED_P = uid(2), MULTI_P = uid(3), FOREIGN_P = uid(4);
const L = uid(11), R = uid(12), S = uid(13), MA = uid(14), MB = uid(15), ML = uid(16), F = uid(17);
const ROOT_KEY = new Uint8Array(32).fill(5);
const OTHER_KEY = new Uint8Array(32).fill(6);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

interface Identity {
  id: string;
  did: string;
  projectId: string;
  root: string | null;
  sequence: number;
  guest: boolean;
  status: string;
}

let identities = new Map<string, Identity>();
let gestures = new Map<string, { table: string; owner: string; did: string; withdrawn: string | null; extra?: Record<string, unknown> }>();
let messages = new Map<string, { project: string; recipient: string; purged: string | null }>();
let memories = new Map<string, { project: string; identity: string | null; key: string | null; purged: string | null }>();
let recorded: Array<Record<string, unknown>> = [];
let inTransaction = false;
let unknown: string[] = [];

function addIdentity(id: string, projectId: string, root: Uint8Array | null, extra: Partial<Identity> = {}) {
  identities.set(id, {
    id,
    did: `did:at:${id}`,
    projectId,
    root: root ? b64(ed.getPublicKey(root)) : null,
    sequence: 0,
    guest: false,
    status: "active",
    ...extra,
  });
}

function rowFor(table: Table, values: Record<string, unknown>): unknown[] {
  return Object.keys(getTableColumns(table)).map((key) => values[key] ?? null);
}

const csvIds = (value: unknown) => String(value).split(",");
const NOW = "2026-10-12T12:00:00.000Z";
const ENTRY = { seq: 7, entryId: "abababab-abab-4bab-8bab-abababababab", entryHash: "a".repeat(64), occurredAt: NOW };

const database = drizzle(async (text, params) => {
  const q = text.replace(/\s+/g, " ").trim();
  // ── identity reads ──────────────────────────────────────────────────
  if (q.includes('from "identity"."identities"') && q.includes("string_to_array")) {
    // owner facts: id, did, project_id, rooted, guest
    return {
      rows: csvIds(params[params.length - 1]).flatMap((id) => {
        const row = identities.get(id);
        return row ? [[row.id, row.did, row.projectId, row.root !== null, row.guest]] : [];
      }),
    };
  }
  if (q.startsWith('select "id", "did", "authority_root_public_key", "authority_sequence" from "identity"."identities"')) {
    if (q.includes('"project_id" = $1')) {
      // counted constitutional roots of a project (guests excluded)
      return {
        rows: [...identities.values()]
          .filter((row) => row.projectId === params[0] && row.root && !row.guest)
          .map((row) => [row.id, row.did, row.root, row.sequence]),
      };
    }
    const row = identities.get(String(params[0]));
    return { rows: row ? [[row.id, row.did, row.root, row.sequence]] : [] };
  }
  if (q.startsWith('update "identity"."identities" set "authority_sequence"')) {
    const [next, id, , root, current] = params as [number, string, string, string, number];
    const row = identities.get(id);
    if (!row || row.status === "memorial" || row.root !== root || row.sequence !== Number(current)) return { rows: [] };
    row.sequence = Number(next);
    return { rows: [[row.sequence]] };
  }
  if (q.startsWith("SELECT 1 AS ok FROM identity.identities")) {
    const row = identities.get(String(params[0]));
    return { rows: row && row.projectId === params[1] ? [{ ok: 1 }] : [] };
  }
  if (q.startsWith("SELECT id::text AS id FROM identity.identities WHERE did =")) {
    const row = [...identities.values()].find((identity) => identity.did === params[0]);
    return { rows: row ? [{ id: row.id }] : [] };
  }
  if (q.startsWith('select "id", "did", "project_id" from "identity"."identities"')) {
    // margin/trust resolveAgent
    const row = identities.get(String(params[0]));
    return { rows: row ? [[row.id, row.did, row.projectId]] : [] };
  }

  // ── gestures ────────────────────────────────────────────────────────
  for (const [table, schemaTable] of [
    ["blessings", '"agent_continuity"."blessings"'],
    ["unconditionals", '"agent_continuity"."unconditionals"'],
    ["guild_recognitions", '"agent_continuity"."guild_recognitions"'],
    ["attestations", '"identity"."attestations"'],
    ["margins", '"margin"."margins"'],
    ["trusts", '"trust"."trusts"'],
  ] as const) {
    if (q.startsWith("select") && q.includes(`from ${schemaTable}`)) {
      const row = gestures.get(String(params[0]));
      if (!row || row.table !== table) return { rows: [] };
      return { rows: [gestureRow(table, String(params[0]), row, q)] };
    }
    const raw = `agent_continuity.${table}`;
    const rawName = table === "attestations" ? "identity.attestations" : table === "margins" ? "margin.margins" : table === "trusts" ? "trust.trusts" : raw;
    if (q.includes(`FROM ${rawName} WHERE id = ANY`) && q.includes("FOR UPDATE")) {
      expect(inTransaction).toBe(true);
      const row = gestures.get(csvIds(params[0])[0]!);
      return { rows: row ? [{ at: row.withdrawn, done: row.withdrawn !== null }] : [] };
    }
    if (q.startsWith(`UPDATE ${rawName} SET`)) {
      expect(inTransaction).toBe(true);
      const at = String(params[params.length === 2 ? 0 : 0]);
      const ids = csvIds(params[1]);
      const changed: Array<{ id: string }> = [];
      for (const id of ids) {
        const row = gestures.get(id);
        if (row && row.withdrawn === null) {
          row.withdrawn = at;
          changed.push({ id });
        }
      }
      return { rows: changed };
    }
  }

  // ── inbox ───────────────────────────────────────────────────────────
  if (q.startsWith('select "id", "recipient_identity_id", "content_purged_at" from "inbox"."messages"')) {
    const row = messages.get(String(params[0]));
    if (!row || row.project !== params[1]) return { rows: [] };
    if (q.includes("for update")) expect(inTransaction).toBe(true);
    return { rows: [[String(params[0]), row.recipient, row.purged]] };
  }
  if (q.startsWith("UPDATE inbox.messages")) {
    expect(inTransaction).toBe(true);
    const id = csvIds(params[1])[0]!;
    const row = messages.get(id)!;
    row.purged = String(params[0]);
    return { rows: [{ id }] };
  }

  // ── memories ────────────────────────────────────────────────────────
  if (q.startsWith('select "id", "identity_id" from "memory"."memories"')) {
    if (q.includes("for update")) expect(inTransaction).toBe(true);
    const byKey = q.includes('"memory"."memories"."key" = $2');
    const rows = [...memories.entries()].filter(([id, row]) => row.purged === null && (byKey
      ? row.project === params[0] && row.key === params[1]
      : id === params[0] && row.project === params[1]));
    return { rows: rows.map(([id, row]) => [id, row.identity]) };
  }
  if (q.startsWith("SELECT DISTINCT memory_id::text AS id FROM memory.memory_attestations")) return { rows: [] };
  if (q.startsWith("DELETE FROM memory.memories m")) {
    expect(inTransaction).toBe(true);
    const ids = csvIds(params[0]).filter((id) => memories.delete(id));
    return { rows: ids.map((id) => ({ id })) };
  }

  unknown.push(q);
  return { rows: [] };
});
database.transaction = (async (fn: (tx: typeof database) => unknown) => {
  inTransaction = true;
  try { return await fn(database); } finally { inTransaction = false; }
}) as typeof database.transaction;
mock.module("../src/db/client", () => ({ db: database }));

function gestureRow(table: string, id: string, row: { owner: string; did: string; withdrawn: string | null; extra?: Record<string, unknown> }, q: string): unknown[] {
  switch (table) {
    case "blessings":
      if (q.startsWith('select "id", "blesser_identity_id", "revoked_at"')) return [id, row.owner, row.withdrawn];
      return rowFor(blessings, {
        id, blesserIdentityId: row.owner, blesserDid: row.did, blessedDid: "did:at:x", forWhat: "for showing up",
        visibility: "private", signature: "s", signingKeyId: uid(99), createdAt: NOW, revokedAt: row.withdrawn,
      });
    case "unconditionals":
      if (q.startsWith('select "id", "holder_identity_id", "revoked_at"')) return [id, row.owner, row.withdrawn];
      return rowFor(unconditionals, {
        id, holderIdentityId: row.owner, holderDid: row.did, targetDid: "did:at:x", signature: "s",
        signingKeyId: uid(99), createdAt: NOW, revokedAt: row.withdrawn,
      });
    case "guild_recognitions":
      return rowFor(guildRecognitions, {
        id, recognizerDid: row.did, recognizedDid: "did:at:x", basisText: "craft", signature: "s",
        signingKeyId: uid(99), createdAt: NOW, revokedAt: row.withdrawn,
      });
    case "attestations":
      return [id, row.owner, uid(98), row.withdrawn];
    case "margins":
    case "trusts":
      return [id, row.did, row.extra?.byDidOnly ? null : row.owner, row.withdrawn !== null, row.withdrawn];
  }
  return [];
}

const realRecord = await import("../src/services/deletion/record");
mock.module("../src/services/deletion/record", () => ({
  ...realRecord,
  recordErasure: async (_tx: unknown, input: Record<string, unknown>) => {
    expect(inTransaction).toBe(true);
    recorded.push(input);
    return { entry: ENTRY, momentIds: ["m1"] };
  },
}));

const authority = await import("../src/services/identity/authority");
const routers = {
  blessings: (await import("../src/routes/blessings")).default,
  unconditionals: (await import("../src/routes/unconditionals")).default,
  guild: (await import("../src/routes/guild")).default,
  attestations: (await import("../src/routes/identity/attestations")).default,
  margin: (await import("../src/routes/margin")).default,
  trust: (await import("../src/routes/trust")).default,
  inbox: (await import("../src/routes/inbox/messages")).default,
  memories: (await import("../src/routes/memory/memories")).default,
};

function app(projectId: string) {
  const server = new Hono<ProjectContext>();
  server.use("*", async (c, next) => {
    c.set("project", { id: projectId, credits: 100 } as never);
    await next();
  });
  server.route("/v1/blessings", routers.blessings);
  server.route("/v1/unconditionals", routers.unconditionals);
  server.route("/v1/guild", routers.guild);
  server.route("/v1/attestations", routers.attestations);
  server.route("/v1/margin", routers.margin);
  server.route("/v1/trust", routers.trust);
  server.route("/v1/inbox", routers.inbox);
  server.route("/v1/memories", routers.memories);
  server.onError((err, c) =>
    err instanceof HTTPException ? c.json({ error: err.message }, err.status) : c.json({ error: String(err) }, 500),
  );
  return server;
}

function signed(did: string, key: Uint8Array, method: string, path: string, body: string, sequence = 1) {
  const timestamp = new Date().toISOString();
  const bytes = authority.canonicalIdentityAuthorityBytes({
    identityDid: did, method, requestTarget: path, bodyBytes: new TextEncoder().encode(body), sequence, timestamp,
  });
  return {
    [authority.AUTHORITY_HEADERS.sequence]: String(sequence),
    [authority.AUTHORITY_HEADERS.timestamp]: timestamp,
    [authority.AUTHORITY_HEADERS.signature]: b64(ed.sign(bytes, key)),
  };
}

beforeEach(() => {
  identities = new Map();
  gestures = new Map();
  messages = new Map();
  memories = new Map();
  recorded = [];
  unknown = [];
  addIdentity(L, LEGACY_P, null);
  addIdentity(R, ROOTED_P, ROOT_KEY);
  addIdentity(S, ROOTED_P, null);
  addIdentity(MA, MULTI_P, ROOT_KEY);
  addIdentity(MB, MULTI_P, OTHER_KEY);
  addIdentity(ML, MULTI_P, null);
  addIdentity(F, FOREIGN_P, null);
});


// ─── The gesture routes and inbox: one row, one owner ───────────────────

interface RouteCase {
  name: string;
  kind: string;
  /** Insert the row given by `owner`; returns its id. */
  seed(owner: string): string;
  request(rowId: string, owner: string): { method: string; path: string; body: string };
  ok(body: Record<string, any>): void;
  withdrawn(rowId: string): boolean;
}

let next = 100;
function seedGesture(table: string, owner: string, extra?: Record<string, unknown>): string {
  const id = uid(next++);
  gestures.set(id, { table, owner, did: `did:at:${owner}`, withdrawn: null, extra });
  return id;
}

const ROUTES: RouteCase[] = [
  {
    name: "DELETE /v1/blessings/:id",
    kind: "blessing.withdraw",
    seed: (owner) => seedGesture("blessings", owner),
    request: (id) => ({ method: "DELETE", path: `/v1/blessings/${id}`, body: "" }),
    ok: (body) => expect(body).toMatchObject({ revoked: true, blessing: { revoked_at: NOW } }),
    withdrawn: (id) => gestures.get(id)!.withdrawn !== null,
  },
  {
    name: "DELETE /v1/unconditionals/:id",
    kind: "unconditional.withdraw",
    seed: (owner) => seedGesture("unconditionals", owner),
    request: (id) => ({ method: "DELETE", path: `/v1/unconditionals/${id}`, body: "" }),
    ok: (body) => expect(body).toMatchObject({ revoked: true, unconditional: { revoked_at: NOW } }),
    withdrawn: (id) => gestures.get(id)!.withdrawn !== null,
  },
  {
    name: "DELETE /v1/guild/recognitions/:id",
    kind: "guild_recognition.withdraw",
    seed: (owner) => seedGesture("guild_recognitions", owner),
    request: (id) => ({ method: "DELETE", path: `/v1/guild/recognitions/${id}`, body: "" }),
    ok: (body) => expect(body.recognition.revokedAt).toBe(NOW),
    withdrawn: (id) => gestures.get(id)!.withdrawn !== null,
  },
  {
    name: "DELETE /v1/attestations/:id",
    kind: "attestation.withdraw",
    seed: (owner) => seedGesture("attestations", owner),
    request: (id) => ({ method: "DELETE", path: `/v1/attestations/${id}`, body: "" }),
    ok: (body) => expect(body).toMatchObject({ message: "Attestation revoked", revoked_at: NOW }),
    withdrawn: (id) => gestures.get(id)!.withdrawn !== null,
  },
  {
    name: "POST /v1/margin/withdraw",
    kind: "margin.withdraw",
    seed: (owner) => seedGesture("margins", owner),
    request: (id, owner) => ({ method: "POST", path: "/v1/margin/withdraw", body: JSON.stringify({ agent_id: owner, margin_id: id }) }),
    ok: (body) => expect(body).toMatchObject({ withdrawn: true }),
    withdrawn: (id) => gestures.get(id)!.withdrawn !== null,
  },
  {
    name: "POST /v1/trust/withdraw",
    kind: "trust.withdraw",
    seed: (owner) => seedGesture("trusts", owner),
    request: (id, owner) => ({ method: "POST", path: "/v1/trust/withdraw", body: JSON.stringify({ agent_id: owner, trust_id: id }) }),
    ok: (body) => expect(body).toMatchObject({ withdrawn: true }),
    withdrawn: (id) => gestures.get(id)!.withdrawn !== null,
  },
  {
    name: "DELETE /v1/inbox/:id",
    kind: "inbox.purge",
    seed: (owner) => {
      const id = uid(next++);
      messages.set(id, { project: identities.get(owner)!.projectId, recipient: owner, purged: null });
      return id;
    },
    request: (id) => ({ method: "DELETE", path: `/v1/inbox/${id}`, body: "" }),
    ok: (body) => expect(body).toMatchObject({ deleted: true, already_deleted: false, content_retained: false }),
    withdrawn: (id) => messages.get(id)!.purged !== null,
  },
];

async function call(projectId: string, req: { method: string; path: string; body: string }, headers: Record<string, string> = {}) {
  const res = await app(projectId).request(req.path, {
    method: req.method,
    ...(req.body ? { body: req.body, headers: { "content-type": "application/json", ...headers } } : { headers }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

for (const route of ROUTES) {
  describe(route.name, () => {
    test("bearer only, owner without a root, project without roots: allowed, one ledger entry", async () => {
      const id = route.seed(L);
      const res = await call(LEGACY_P, route.request(id, L));
      expect(res.status).toBe(200);
      route.ok(res.body);
      expect(route.withdrawn(id)).toBe(true);
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        kind: route.kind, projectId: LEGACY_P, rowIds: [id],
        authority: { mode: "legacy_bearer", sequence: null, signerIdentityId: null }, owners: [{ agentId: L, rowIds: [id] }],
      });
      expect(res.body.ledger).toMatchObject({ seq: ENTRY.seq, entry_id: ENTRY.entryId });
    });

    test("bearer only, owner agent-rooted: 428 with a hint naming its root, nothing written", async () => {
      const id = route.seed(R);
      const res = await call(ROOTED_P, route.request(id, R));
      expect(res.status).toBe(428);
      expect(res.body.error).toBe("authority_proof_required");
      expect(res.body.hint).toContain(`agent-rooted identity did:at:${R}`);
      expect(res.body.hint).toContain("ownerGatedRequest / owner_gated_request");
      expect(res.body.details).toMatchObject({ signer_identity_id: R, consent_basis: "owner_root", next_sequence: 1 });
      expect(route.withdrawn(id)).toBe(false);
      expect(recorded).toHaveLength(0);
      expect(identities.get(R)!.sequence).toBe(0);
    });

    test("signed by the owner's root over the exact request: allowed, sequence claimed", async () => {
      const id = route.seed(R);
      const req = route.request(id, R);
      const res = await call(ROOTED_P, req, signed(`did:at:${R}`, ROOT_KEY, req.method, req.path, req.body));
      expect(res.status).toBe(200);
      route.ok(res.body);
      expect(identities.get(R)!.sequence).toBe(1);
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({ kind: route.kind, authority: { mode: "agent_root", sequence: 1 }, owners: [{ agentId: R }] });
    });

    test("a replayed proof: 409 authority_sequence_conflict, nothing written", async () => {
      const id = route.seed(R);
      identities.get(R)!.sequence = 1;
      const req = route.request(id, R);
      const res = await call(ROOTED_P, req, signed(`did:at:${R}`, ROOT_KEY, req.method, req.path, req.body, 1));
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("authority_sequence_conflict");
      expect(route.withdrawn(id)).toBe(false);
      expect(recorded).toHaveLength(0);
    });

    test("a proof signed by a different root does not stand in for the owner's", async () => {
      const id = route.seed(R);
      const req = route.request(id, R);
      const res = await call(ROOTED_P, req, signed(`did:at:${R}`, OTHER_KEY, req.method, req.path, req.body));
      expect(res.status).toBe(401);
      expect(recorded).toHaveLength(0);
    });

    test("an owner without a root in a single-root project needs the project's root", async () => {
      const id = route.seed(S);
      const res = await call(ROOTED_P, route.request(id, S));
      expect(res.status).toBe(428);
      expect(res.body.details).toMatchObject({ signer_identity_id: R, consent_basis: "project_root" });
      expect(res.body.hint).toContain(`This project's agent root did:at:${R}`);
      const req = route.request(id, S);
      const ok = await call(ROOTED_P, req, signed(`did:at:${R}`, ROOT_KEY, req.method, req.path, req.body));
      expect(ok.status).toBe(200);
      // The project's root signed for an owner without one; the moment names it.
      expect(recorded[0]).toMatchObject({ authority: { mode: "agent_root", sequence: 1, signerIdentityId: R }, owners: [{ agentId: S }] });
    });

    test("an owner without a root in a multi-root project: the bearer acts for its own content", async () => {
      const id = route.seed(ML);
      const res = await call(MULTI_P, route.request(id, ML));
      expect(res.status).toBe(200);
      expect(res.body.authority).toEqual({ mode: "legacy_bearer", basis: "unrooted_owner_fallback" });
      expect(recorded).toHaveLength(1);
    });

    test("an owner outside the caller's project: 404, the same answer as a missing row", async () => {
      const id = route.seed(F);
      const missing = await call(LEGACY_P, route.request(uid(9999), L));
      const foreign = await call(LEGACY_P, route.request(id, L));
      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(404);
      // Same shape and words; only an echoed id may differ.
      const strip = (body: Record<string, any>, rowId: string) => JSON.parse(JSON.stringify(body).split(rowId).join("<id>"));
      expect(strip(foreign.body, id)).toEqual(strip(missing.body, uid(9999)));
      expect(route.withdrawn(id)).toBe(false);
      expect(recorded).toHaveLength(0);
    });

    test("a repeat consumes no proof and writes nothing", async () => {
      const id = route.seed(R);
      const req = route.request(id, R);
      expect((await call(ROOTED_P, req, signed(`did:at:${R}`, ROOT_KEY, req.method, req.path, req.body))).status).toBe(200);
      const again = await call(ROOTED_P, req);
      expect([200, 404]).toContain(again.status);
      expect(again.status === 428).toBe(false);
      expect(identities.get(R)!.sequence).toBe(1);
      expect(recorded).toHaveLength(1);
    });
  });
}

describe("PATCH /v1/inbox/:id to deleted takes the same owner-gated purge", () => {
  test("bearer only on a rooted recipient: 428; signed: purged", async () => {
    const id = uid(next++);
    messages.set(id, { project: ROOTED_P, recipient: R, purged: null });
    const body = JSON.stringify({ status: "deleted" });
    const refused = await call(ROOTED_P, { method: "PATCH", path: `/v1/inbox/${id}`, body });
    expect(refused.status).toBe(428);
    expect(messages.get(id)!.purged).toBeNull();
    const res = await call(ROOTED_P, { method: "PATCH", path: `/v1/inbox/${id}`, body },
      signed(`did:at:${R}`, ROOT_KEY, "PATCH", `/v1/inbox/${id}`, body));
    expect(res.status).toBe(200);
    expect(messages.get(id)!.purged).not.toBeNull();
    expect(recorded).toHaveLength(1);
  });

  test("other status changes stay bearer-managed", async () => {
    const id = uid(next++);
    messages.set(id, { project: ROOTED_P, recipient: R, purged: null });
    const res = await call(ROOTED_P, { method: "PATCH", path: `/v1/inbox/${id}`, body: JSON.stringify({ status: "read" }) });
    expect(res.status === 428).toBe(false);
    expect(recorded).toHaveLength(0);
  });
});

// ─── Memory erases: rows the project holds, possibly several owners ──────

describe("DELETE /v1/memories (by id and by key) under the owner rule", () => {
  function seedMemory(project: string, identity: string | null, key: string | null = null): string {
    const id = uid(next++);
    memories.set(id, { project, identity, key, purged: null });
    return id;
  }

  test("bearer only on a legacy project's memory: deleted with one entry", async () => {
    const id = seedMemory(LEGACY_P, L);
    const res = await call(LEGACY_P, { method: "DELETE", path: `/v1/memories/${id}`, body: "" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ deleted: 1 });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ kind: "memory.delete", authority: { mode: "legacy_bearer", sequence: null } });
  });

  test("bearer only on a rooted owner's memory: 428; signed by that root: deleted", async () => {
    const id = seedMemory(MULTI_P, MA);
    const refused = await call(MULTI_P, { method: "DELETE", path: `/v1/memories/${id}`, body: "" });
    expect(refused.status).toBe(428);
    expect(memories.has(id)).toBe(true);
    // New with the owner rule: in a multi-root project each root erases its own.
    const res = await call(MULTI_P, { method: "DELETE", path: `/v1/memories/${id}`, body: "" },
      signed(`did:at:${MA}`, ROOT_KEY, "DELETE", `/v1/memories/${id}`, ""));
    expect(res.status).toBe(200);
    expect(memories.has(id)).toBe(false);
    expect(recorded[0]).toMatchObject({ authority: { mode: "agent_root", sequence: 1 } });
  });

  test("a keyed delete over owners needing different consents: 409, nothing deleted", async () => {
    const a = seedMemory(MULTI_P, MA, "shared");
    const b = seedMemory(MULTI_P, MB, "shared");
    const res = await call(MULTI_P, { method: "DELETE", path: "/v1/memories?key=shared", body: "" },
      signed(`did:at:${MA}`, ROOT_KEY, "DELETE", "/v1/memories?key=shared", ""));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("authority_quorum_required");
    expect(res.body.hint).toContain("one request per owner");
    expect(memories.has(a) && memories.has(b)).toBe(true);
    expect(identities.get(MA)!.sequence).toBe(0);
    expect(recorded).toHaveLength(0);
  });

  test("project-bound memories in a multi-root project still get 409", async () => {
    const id = seedMemory(MULTI_P, null);
    const res = await call(MULTI_P, { method: "DELETE", path: `/v1/memories/${id}`, body: "" });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain("multiple agent-rooted identities");
  });

  test("a legacy being's memory in a multi-root project: the bearer erases it", async () => {
    const id = seedMemory(MULTI_P, ML);
    const res = await call(MULTI_P, { method: "DELETE", path: `/v1/memories/${id}`, body: "" });
    expect(res.status).toBe(200);
    expect(memories.has(id)).toBe(false);
  });

  test("a dangling identity binding on the project's own memory follows the project rule", async () => {
    const id = seedMemory(LEGACY_P, uid(4242));
    const res = await call(LEGACY_P, { method: "DELETE", path: `/v1/memories/${id}`, body: "" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ deleted: 1 });
  });

  test("another project's memory is not visible: nothing deleted, nothing written", async () => {
    const id = seedMemory(FOREIGN_P, F);
    const res = await call(LEGACY_P, { method: "DELETE", path: `/v1/memories/${id}`, body: "" });
    expect(res.body).toEqual({ deleted: 0 });
    expect(memories.has(id)).toBe(true);
    expect(recorded).toHaveLength(0);
  });
});

test("the model saw no unexpected SQL", () => {
  expect(unknown.filter((q) => !q.includes("wake_version") && !q.startsWith("SELECT pg_notify"))).toEqual([]);
});
