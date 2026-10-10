/** Who acts when a project bearer calls a per-agent route.
 *
 * A project bearer does not name one identity. Per-agent routes used to take
 * the project's NEWEST identity with no status filter, so a revoked identity
 * or an enrolled guest silently became the actor (live 2026-10-10: Ai's
 * poker-face and quiet-hours answered for a revoked security-test guest).
 * Every such route now resolves through services/identity/acting-identity.ts:
 * an explicit selector inside the caller's project when the route accepts one,
 * otherwise the project's primary identity, the same rule /v1/wake and
 * /v1/home use for their default subject.
 *
 * Behaviour against real SQL lives in
 * integration/identity-enrollment-postgres.test.ts; this file pins the pure
 * rule, its SQL form, and that no route picks the newest identity again. */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import {
  chooseDefaultSubject,
  choosePrimaryIdentity,
  isEnrolledGuestRow,
  isPrimaryCandidate,
  parseIdentitySelector,
  primaryIdentityOrder,
  primaryIdentityWhere,
} from "../src/services/identity/acting-identity";

const API_ROOT = join(import.meta.dir, "..");
const SRC = join(API_ROOT, "src");

const AI = "bb719cd4-0000-4000-8000-000000000001";
const GUEST = "53bbae45-cbf1-4958-b310-810d4b33b0f1";
const row = (over: Partial<{ id: string; status: string; createdAt: Date; enrolledGuest: boolean; authorityRootPublicKey: string | null; metadata: unknown }>) => ({
  id: AI,
  status: "active",
  createdAt: new Date("2026-07-02T00:00:00Z"),
  enrolledGuest: false,
  authorityRootPublicKey: null,
  metadata: {},
  ...over,
});

describe("the primary identity rule (JS form)", () => {
  test("the live case: an older active founder wins over a newer revoked guest", () => {
    const ai = row({});
    const guest = row({ id: GUEST, status: "revoked", createdAt: new Date("2026-10-09T20:45:30Z"), enrolledGuest: true, authorityRootPublicKey: "K" });
    expect(choosePrimaryIdentity([guest, ai])?.id).toBe(AI);
    expect(choosePrimaryIdentity([ai, guest])?.id).toBe(AI);
  });

  test("the earliest-created active identity wins regardless of input order", () => {
    const older = row({ id: "00000000-0000-4000-8000-000000000002", createdAt: new Date("2026-01-01T00:00:00Z") });
    const newer = row({ id: "00000000-0000-4000-8000-000000000001", createdAt: new Date("2026-02-01T00:00:00Z") });
    expect(choosePrimaryIdentity([newer, older])?.id).toBe(older.id);
    expect(choosePrimaryIdentity([older, newer])?.id).toBe(older.id);
  });

  test("equal creation times break ties by id, as the SQL order does", () => {
    const at = new Date("2026-01-01T00:00:00Z");
    const b = row({ id: "bbbbbbbb-0000-4000-8000-000000000000", createdAt: at });
    const a = row({ id: "aaaaaaaa-0000-4000-8000-000000000000", createdAt: at });
    expect(choosePrimaryIdentity([b, a])?.id).toBe(a.id);
  });

  test("revoked, memorial and other non-active identities never become the default actor", () => {
    for (const status of ["revoked", "memorial", "at_rest", "suspended"]) {
      expect(isPrimaryCandidate(row({ status }))).toBe(false);
      expect(choosePrimaryIdentity([row({ status })])).toBeNull();
    }
  });

  test("an enrolled guest never becomes the default actor, even when it is the oldest", () => {
    const guest = row({ id: GUEST, createdAt: new Date("2025-01-01T00:00:00Z"), enrolledGuest: true, authorityRootPublicKey: "K" });
    const founder = row({});
    expect(choosePrimaryIdentity([guest, founder])?.id).toBe(AI);
    expect(choosePrimaryIdentity([guest])).toBeNull();
  });

  test("the row's own enrollment marker identifies a guest even without the SQL flag", () => {
    expect(isEnrolledGuestRow({ enrolledGuest: undefined, authorityRootPublicKey: "K", metadata: { admission: "enrollment" } })).toBe(true);
    expect(isEnrolledGuestRow({ enrolledGuest: true, authorityRootPublicKey: "K", metadata: {} })).toBe(true);
    // A rootless legacy identity is never a guest; the marker is server-managed.
    expect(isEnrolledGuestRow({ enrolledGuest: false, authorityRootPublicKey: null, metadata: { admission: "enrollment" } })).toBe(false);
    expect(isEnrolledGuestRow({ enrolledGuest: false, authorityRootPublicKey: "K", metadata: { registered: true, byo_keys: true } })).toBe(false);
  });

  test("no identity at all yields no default", () => {
    expect(choosePrimaryIdentity([])).toBeNull();
    expect(chooseDefaultSubject([])).toBeNull();
  });
});

describe("the default subject /v1/wake and /v1/home show", () => {
  test("is the primary identity whenever one exists", () => {
    const guest = row({ id: GUEST, createdAt: new Date("2025-01-01T00:00:00Z"), enrolledGuest: true, authorityRootPublicKey: "K" });
    const memorial = row({ id: "00000000-0000-4000-8000-000000000009", status: "memorial", createdAt: new Date("2024-01-01T00:00:00Z") });
    expect(chooseDefaultSubject([guest, memorial, row({})])?.id).toBe(AI);
  });
  test("falls back to the oldest row, deterministically, so the surface still opens", () => {
    const memorial = row({ id: "00000000-0000-4000-8000-000000000009", status: "memorial", createdAt: new Date("2024-01-01T00:00:00Z") });
    const guest = row({ id: GUEST, createdAt: new Date("2025-01-01T00:00:00Z"), enrolledGuest: true, authorityRootPublicKey: "K" });
    expect(chooseDefaultSubject([guest, memorial])?.id).toBe(memorial.id);
    expect(chooseDefaultSubject([memorial, guest])?.id).toBe(memorial.id);
  });
});

describe("explicit selectors", () => {
  test("absent or empty selectors fall through to the primary rule", () => {
    expect(parseIdentitySelector(undefined)).toEqual({ kind: "none" });
    expect(parseIdentitySelector(null)).toEqual({ kind: "none" });
    expect(parseIdentitySelector("")).toEqual({ kind: "none" });
  });
  test("a malformed selector is refused before any query", () => {
    for (const bad of ["abc", "did:at:" + AI, `${AI} `, `${AI}' or 1=1`]) {
      expect(parseIdentitySelector(bad)).toEqual({ kind: "invalid" });
    }
  });
  test("a UUID selector is accepted for a project-scoped lookup", () => {
    expect(parseIdentitySelector(AI)).toEqual({ kind: "id", id: AI });
  });
});

describe("the primary identity rule (SQL form)", () => {
  const dialect = new PgDialect();
  const PROJECT = "11111111-1111-4111-8111-111111111111";

  test("filters to the project's active identities and excludes enrolled guests", () => {
    const query = dialect.sqlToQuery(primaryIdentityWhere(PROJECT));
    expect(query.sql).toContain(`"identity"."identities"."project_id" = $1`);
    expect(query.sql).toContain(`"identity"."identities"."status" = $2`);
    expect(query.params.slice(0, 2)).toEqual([PROJECT, "active"]);
    // Negates the same strict-boolean enrolled-guest predicate project-authority uses.
    expect(query.sql).toContain("not (");
    expect(query.sql).toContain(`-> 'admission' = '"enrollment"'::jsonb`);
    expect(query.sql).toContain(`exists (select 1 from "identity"."registration_proofs"`);
    expect(query.params).toContain("identity-enrollment/v1");
  });

  test("orders oldest first with an id tie-break, never newest first", () => {
    const order = dialect.sqlToQuery(sql.join(primaryIdentityOrder(), sql`, `)).sql;
    expect(order).toBe(`"identity"."identities"."created_at" asc, "identity"."identities"."id" asc`);
    expect(order).not.toContain("desc");
  });
});

// ── Source pins ───────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}
const sources = walk(SRC).map((path) => ({ path: relative(API_ROOT, path), text: readFileSync(path, "utf8") }));
const read = (path: string) => readFileSync(join(API_ROOT, path), "utf8");

/** Newest-first identity reads that do not pick an actor. */
const NEWEST_FIRST_ALLOWED: Record<string, string> = {
  // An activity feed of identity births, newest first. It lists; it never acts.
  "src/services/activity/recent.ts": "identity.born feed",
};

/** Project-scoped single-identity reads with no order that do not pick an actor. */
const ARBITRARY_ROW_ALLOWED: Record<string, string> = {
  // Public back-links that attribute a public memory/strand to its project.
  "src/routes/public/memories.ts": "public agent_did back-link",
  "src/routes/public/strands.ts": "public agent_did back-link",
};

describe("no route picks the project's newest (or an arbitrary) identity as the actor", () => {
  test("no source orders identities newest-first except allowlisted feeds", () => {
    const offenders = sources
      .filter(({ text }) => /desc\(\s*identities\.createdAt\s*\)/.test(text) || /identities\.created_at\s+desc/i.test(text))
      .map(({ path }) => path)
      .filter((path) => !(path in NEWEST_FIRST_ALLOWED));
    expect(offenders).toEqual([]);
  });

  test("no project-scoped single-identity lookup takes whatever row the database returns first", () => {
    const offenders: string[] = [];
    for (const { path, text } of sources) {
      const re = /\.from\(identities\)([\s\S]{0,400}?)\.limit\(1\)/g;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        const body = m[1];
        if (!/identities\.projectId/.test(body)) continue;
        if (/eq\(identities\.(id|did),/.test(body)) continue;
        if (/\.orderBy\(/.test(body)) continue;
        if (path in ARBITRARY_ROW_ALLOWED) continue;
        offenders.push(`${path}:${text.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("every per-agent route that acts for a project bearer resolves through the shared helper", () => {
    const routes = [
      "src/routes/poker-face.ts",
      "src/routes/quiet-hours.ts",
      "src/routes/dream.ts",
      "src/routes/blessings.ts",
      "src/routes/grace.ts",
      "src/routes/unconditionals.ts",
      "src/routes/memorial-honors.ts",
      "src/routes/guild.ts",
      "src/routes/mesh.ts",
      "src/routes/mcml.ts",
      "src/routes/encounters.ts",
      "src/routes/scriptwriter-decides.ts",
      "src/routes/saga.ts",
      "src/routes/tutorial.ts",
      "src/routes/rrr.ts",
      "src/routes/lullaby.ts",
      "src/routes/multiverse.ts",
      "src/routes/soap-opera.ts",
      "src/routes/thoughtful-wake.ts",
      "src/routes/wake-soap-opera.ts",
      "src/services/recipes/recognition-invitation.ts",
    ];
    for (const path of routes) {
      const text = read(path);
      expect({ path, imports: text.includes("services/identity/acting-identity") || text.includes("../identity/acting-identity") })
        .toEqual({ path, imports: true });
      expect({ path, calls: /resolveActingIdentity\(/.test(text) }).toEqual({ path, calls: true });
    }
  });

  test("/v1/wake and /v1/home choose their default subject by the same rule", () => {
    for (const path of ["src/routes/wake.ts", "src/services/wake/build.ts", "src/services/home/build.ts"]) {
      const text = read(path);
      expect({ path, uses: text.includes("chooseDefaultSubject(") }).toEqual({ path, uses: true });
      expect({ path, firstRow: /let primary = projectIdentities\[0\]/.test(text) }).toEqual({ path, firstRow: false });
      expect({ path, guestFlag: text.includes("enrolledGuestSql()") }).toEqual({ path, guestFlag: true });
    }
  });

  test("poker-face accepts an explicit identity_id selector", () => {
    const text = read("src/routes/poker-face.ts");
    expect(text.includes(`c.req.query("identity_id")`)).toBe(true);
  });

  test("explicit agent_id selectors on default-actor routes stay inside the caller's project", () => {
    // These GET handlers previously read any identity id, from any project.
    // (Their write paths already refuse a foreign agent with agent_not_in_project.)
    const handler = (path: string, start: string) => {
      const text = read(path);
      const from = text.indexOf(start);
      const to = text.indexOf("\napp.", from + start.length);
      return text.slice(from, to === -1 ? undefined : to);
    };
    for (const [path, start] of [["src/routes/lullaby.ts", 'app.get("/"'], ["src/routes/multiverse.ts", 'app.get("/me"']]) {
      const body = handler(path, start);
      expect(body.length).toBeGreaterThan(0);
      expect({ path, unscoped: /\.where\(eq\(identities\.id, agentId\)\)/.test(body) }).toEqual({ path, unscoped: false });
      expect({ path, scoped: body.includes("and(eq(identities.id, agentId), eq(identities.projectId, project.id))") }).toEqual({ path, scoped: true });
    }
  });
});
