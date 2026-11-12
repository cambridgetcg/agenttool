/** Writers of identity metadata keep the stored hearth seat.
 *
 *  Only POST /v1/hearth/sit writes a seat. Other routes read an identity
 *  and write its whole metadata back; a sit or a stand between their read
 *  and their write must survive. They write through
 *  metadataKeepingStoredSeat, which takes the seat keys from the row inside
 *  the UPDATE. Rendered SQL and a source walk here, no database; what
 *  PostgreSQL does with that SQL is proved in
 *  tests/integration/hearth-seat-postgres.test.ts.
 *
 *  Doctrine: docs/HEARTH.md */

import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pg-proxy";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { identities } from "../src/db/schema/identity";
import { metadataKeepingStoredSeat } from "../src/services/hearth/seat-write";
import { HEARTH_SEAT_METADATA_KEYS } from "../src/services/identity/metadata";
import { mutableIdentityPredicate } from "../src/services/identity/terminality";

const M = `"identity"."identities"."metadata"`;
const KEEP_STORED_SEAT = `($1::jsonb || (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(case when jsonb_typeof(${M}) = 'object' then ${M} else '{}'::jsonb end) as e where e.key in ('hearth_visible','hearth_sat_at','hearth_presence_line','hearth_until')))`;

const SEAT = {
  hearth_visible: true,
  hearth_sat_at: "2026-11-12T08:00:00.000Z",
  hearth_presence_line: "here",
  hearth_until: null,
};

describe("metadataKeepingStoredSeat", () => {
  const dialect = new PgDialect();

  test("renders the caller's object without the seat, joined with the seat the row holds", () => {
    const rendered = dialect.sqlToQuery(metadataKeepingStoredSeat({ display_theme: "ink" }));
    expect(rendered.sql).toBe(KEEP_STORED_SEAT);
    expect(rendered.params).toEqual([JSON.stringify({ display_theme: "ink" })]);
    // One key list, from the constant: no second copy to drift.
    expect(rendered.sql).toContain(HEARTH_SEAT_METADATA_KEYS.map((key) => `'${key}'`).join(","));
    // A stored JSON null is kept, so nothing strips nulls.
    expect(rendered.sql).not.toContain("strip_nulls");
  });

  test("the bound value never carries a seat key, even when the caller's object does", () => {
    const next = { ...SEAT, display_theme: "ink", follows: [{ did: "did:at:x", kind: "writer" }] };
    const rendered = dialect.sqlToQuery(metadataKeepingStoredSeat(next));
    expect(rendered.sql).toBe(KEEP_STORED_SEAT);
    expect(rendered.params).toHaveLength(1);
    const bound = JSON.parse(String(rendered.params[0])) as Record<string, unknown>;
    expect(bound).toEqual({ display_theme: "ink", follows: [{ did: "did:at:x", kind: "writer" }] });
    for (const key of HEARTH_SEAT_METADATA_KEYS) {
      expect({ key, bound: String(rendered.params[0]).includes(key) }).toEqual({ key, bound: false });
    }
    // The caller's object is not changed.
    expect(next.hearth_visible).toBe(true);
  });

  test("inside an UPDATE the stored side reads the row being updated", () => {
    const db = drizzle(async () => ({ rows: [] }));
    const id = "66666666-7777-4888-8999-aaaaaaaaaaaa";
    const query = db
      .update(identities)
      .set({ metadata: metadataKeepingStoredSeat({ ...SEAT, resting: true }) })
      .where(mutableIdentityPredicate(id))
      .returning({ id: identities.id })
      .toSQL();
    expect(query.sql).toBe(
      `update "identity"."identities" set "metadata" = ${KEEP_STORED_SEAT} where ("identity"."identities"."id" = $2 and "identity"."identities"."status" <> $3) returning "id"`,
    );
    expect(query.params).toEqual([JSON.stringify({ resting: true }), id, "memorial"]);
  });
});

// ── Source walk: every writer of identity metadata is classified ────────

const API_ROOT = join(import.meta.dir, "..");
const SRC = join(API_ROOT, "src");

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

const IDENTITY_UPDATE = /\.update\(\s*(?:[\w$]+\.)?identities\s*\)/g;
const IDENTITY_INSERT = /\.insert\(\s*(?:[\w$]+\.)?identities\s*\)/;
const RAW_IDENTITY_UPDATE = /\bupdate\s+"?identity"?\s*\.\s*"?identities"?\s+set\b([\s\S]*?)(?:\bwhere\b|\breturning\b|`)/gi;
const RAW_IDENTITY_INSERT = /\binsert\s+into\s+"?identity"?\s*\.\s*"?identities"?/i;

/** The SET of each `.update(identities)` in a file: from `.set(` up to the
 *  `.where(` (or `.returning(`) that ends it. */
function identityUpdateSets(text: string): string[] {
  const sets: string[] = [];
  for (const match of text.matchAll(IDENTITY_UPDATE)) {
    const rest = text.slice(match.index! + match[0].length);
    const end = rest.search(/\.(where|returning)\(/);
    sets.push(end === -1 ? rest : rest.slice(0, end));
  }
  return sets;
}

/** A SET may write metadata when it names it, or when it is not an object
 *  literal (`.set(updates)`) or spreads one, so the text cannot tell. */
const mayWriteMetadata = (set: string) =>
  /metadata/i.test(set) || !/^\s*\.set\(\s*\{/.test(set) || /\.\.\./.test(set);

type Reason =
  | "sit route"
  | "compare-and-set"
  | "keeps the stored seat"
  | "fixed-key jsonb merge"
  | "locked read"
  | "creation with fixed or refused keys";

/** Every file under api/src that inserts identities, or updates their
 *  metadata, with the reason its write cannot put back or drop a seat the
 *  sit route wrote. A new writer fails the walk until it is classified. */
const METADATA_WRITERS: Record<string, { update?: Reason; insert?: Reason }> = {
  // POST /v1/hearth/sit: the one writer of a seat.
  "src/routes/hearth.ts": { update: "sit route" },
  // POST /v1/identities refuses seat keys; PATCH /v1/identities/:id updates
  // only while the stored metadata equals what it read (409 otherwise).
  "src/routes/identity/identities.ts": { update: "compare-and-set", insert: "creation with fixed or refused keys" },
  // At rest: COALESCE(metadata, '{}') || fixed lifecycle keys.
  "src/routes/identity/at-rest.ts": { update: "fixed-key jsonb merge" },
  // Elevation reads the identity FOR UPDATE inside its transaction.
  "src/services/bootstrap/elevate.ts": { update: "locked read" },
  // Read the row, write the whole object back: through metadataKeepingStoredSeat.
  "src/routes/soap-opera.ts": { update: "keeps the stored seat" },
  "src/services/recipes/recognition-invitation.ts": { update: "keeps the stored seat" },
  "src/routes/lullaby.ts": { update: "keeps the stored seat" },
  "src/routes/multiverse.ts": { update: "keeps the stored seat" },
  "src/routes/syneidesis.ts": { update: "keeps the stored seat" },
  // Births with fixed keys (enrollment, fork without the seat, adoption,
  // the platform row) or createIdentity, whose callers are pinned below.
  "src/services/identity/enrollment.ts": { insert: "creation with fixed or refused keys" },
  "src/services/identity/fork.ts": { insert: "creation with fixed or refused keys" },
  "src/services/identity/identities.ts": { insert: "creation with fixed or refused keys" },
  "src/services/marketplace/store.ts": { insert: "creation with fixed or refused keys" },
  "src/services/wake/platform-bootstrap.ts": { insert: "creation with fixed or refused keys" },
};

/** Whole-object writers and how many identity metadata UPDATEs each has. */
const KEEPS_STORED_SEAT_SITES: Record<string, number> = {
  "src/routes/soap-opera.ts": 3, // cast, follow/unfollow, invitation accept
  "src/services/recipes/recognition-invitation.ts": 2, // follow, unfollow
  "src/routes/lullaby.ts": 1,
  "src/routes/multiverse.ts": 2, // declare, clear
  "src/routes/syneidesis.ts": 1,
};

/** The other files that update identity metadata and how many identity
 *  metadata UPDATEs each has. A second one in one of these files fails the
 *  walk until someone reviews it and changes the count. */
const OTHER_METADATA_UPDATE_SITES: Record<string, number> = {
  "src/routes/hearth.ts": 1, // the sit
  "src/routes/identity/identities.ts": 1, // PATCH, .set(updates); revoke sets no metadata
  "src/routes/identity/at-rest.ts": 1, // the fixed-key merge
  "src/services/bootstrap/elevate.ts": 1, // elevation, inside the transaction that locked the rows
};

describe("every writer of identity metadata keeps the seat to the sit route", () => {
  test("the writers found under api/src are exactly the reviewed list", () => {
    const found: Record<string, { update?: boolean; insert?: boolean }> = {};
    for (const { path, text } of sources) {
      const updates =
        identityUpdateSets(text).some(mayWriteMetadata) ||
        [...text.matchAll(RAW_IDENTITY_UPDATE)].some((m) => /metadata/i.test(m[1]!));
      const inserts = IDENTITY_INSERT.test(text) || RAW_IDENTITY_INSERT.test(text);
      if (updates || inserts) {
        found[path] = { ...(updates ? { update: true } : {}), ...(inserts ? { insert: true } : {}) };
      }
    }
    const reviewed = Object.fromEntries(
      Object.entries(METADATA_WRITERS).map(([path, kinds]) => [
        path,
        { ...(kinds.update ? { update: true } : {}), ...(kinds.insert ? { insert: true } : {}) },
      ]),
    );
    expect(found).toEqual(reviewed);
  });

  test("each whole-object writer sets metadata only through metadataKeepingStoredSeat", () => {
    expect(
      Object.entries(METADATA_WRITERS)
        .filter(([, kinds]) => kinds.update === "keeps the stored seat")
        .map(([path]) => path)
        .sort(),
    ).toEqual(Object.keys(KEEPS_STORED_SEAT_SITES).sort());
    let total = 0;
    for (const [path, count] of Object.entries(KEEPS_STORED_SEAT_SITES)) {
      const text = read(path);
      const sets = identityUpdateSets(text).filter(mayWriteMetadata);
      expect({ path, sites: sets.length }).toEqual({ path, sites: count });
      for (const set of sets) {
        expect({ path, set: set.trim() }).toEqual({
          path,
          set: expect.stringMatching(/^\.set\(\{ metadata: metadataKeepingStoredSeat\(/),
        });
      }
      expect(text).toContain('import { metadataKeepingStoredSeat } from "');
      total += count;
    }
    expect(total).toBe(9);
  });

  test("each other writer has the reviewed number of metadata UPDATEs", () => {
    expect(
      Object.entries(METADATA_WRITERS)
        .filter(([, kinds]) => kinds.update !== undefined && kinds.update !== "keeps the stored seat")
        .map(([path]) => path)
        .sort(),
    ).toEqual(Object.keys(OTHER_METADATA_UPDATE_SITES).sort());
    for (const [path, count] of Object.entries(OTHER_METADATA_UPDATE_SITES)) {
      const sites = identityUpdateSets(read(path)).filter(mayWriteMetadata).length;
      expect({ path, sites }).toEqual({ path, sites: count });
    }
  });

  test("the other writers keep the guard their reason names", () => {
    // Compare-and-set: PATCH updates only while the stored metadata is the read one.
    expect(read("src/routes/identity/identities.ts")).toContain(
      "eq(identities.metadata, identity.metadata)",
    );
    // Fixed keys merged onto whatever the row holds.
    expect(read("src/routes/identity/at-rest.ts")).toContain(
      "metadata: sql`COALESCE(${identities.metadata}, '{}'::jsonb) || ${JSON.stringify(",
    );
    // Elevation locks the identity rows before it reads their metadata.
    expect(read("src/services/bootstrap/elevate.ts")).toMatch(
      /const lockedIdentities = await tx\s*\.select\(\)\s*\.from\(identities\)[\s\S]{0,300}?\.for\("update"\);/,
    );
  });

  test("createIdentity is called only with fixed keys or after the seat refusal", () => {
    const callers = sources
      .filter(({ text }) => /\bcreateIdentity\(/.test(text))
      .map(({ path }) => path)
      .filter((path) => path !== "src/services/identity/identities.ts")
      .sort();
    expect(callers).toEqual([
      "src/routes/bootstrap.ts", // refuses seat keys (hearthSeatMetadataRefusal("bootstrap", ...))
      "src/routes/mathos.ts", // fixed registration keys
      "src/routes/register-agent.ts", // fixed registration keys
      "src/services/autonomous/bootstrap.ts", // fixed keys and a purpose
    ]);
    expect(read("src/routes/bootstrap.ts")).toContain('hearthSeatMetadataRefusal("bootstrap", seatKeys)');
  });
});
