/** MESH post replay and signer authority.
 *
 *  Before: acceptPost checked only that the signing key's identity DID
 *  equals by_did. Any project bearer could copy a public post (signature,
 *  signing_key_id and every signed field are on /public/mesh) and submit
 *  it again: a fresh post id attributed to the author, with a visibility
 *  the replayer chose. It also worked for revoked authors.
 *
 *  Now: the signer must belong to the submitting project (a foreign key is
 *  indistinguishable from an unknown one), its identity must be active, and
 *  one signed mesh-post/v1 digest is recorded at most once.
 *
 *  Hermetic: real SQL generation + real ed25519 over a pg-proxy transport. */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { drizzle } from "drizzle-orm/pg-proxy";

import { bytesToHex, canonicalMeshPostBytes } from "../src/services/mesh/canonical-bytes";

const PROJECT = "11111111-2222-4333-8444-555555555555";
const FOREIGN = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const AUTHOR = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const KEY = "99999999-7777-4888-8999-aaaaaaaaaaaa";
const DID = `did:at:${AUTHOR}`;
const WHEN = "2026-10-01T12:00:00.000Z";
const pair = generateKeyPairSync("ed25519");
const PUBLIC_KEY = pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

const fields = {
  kind: "signal" as const,
  authorDid: DID,
  title: "Inbox is down",
  body: "Will reply in about an hour.",
  capabilities: [] as string[],
  topics: [] as string[],
  bountyCents: 0,
  kRequired: null,
  attributionPostIds: [] as string[],
  createdAtIso: WHEN,
  expiresAtIso: null,
};
const BYTES = canonicalMeshPostBytes(fields);
const DIGEST = bytesToHex(BYTES);
const SIGNATURE = sign(null, BYTES, pair.privateKey).toString("base64");

let queries: { sql: string; params: unknown[] }[] = [];
let ownerProject = PROJECT;
let ownerStatus = "active";
let alreadyRecorded = false;
let inTransaction = false;

const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  if (sql.includes('from "identity"."identity_keys"')) {
    return { rows: [[KEY, AUTHOR, PUBLIC_KEY, true, null, DID, ownerProject, ownerStatus]] };
  }
  if (sql.startsWith('select "poker_face_default"')) return { rows: [[false]] };
  if (sql.includes("pg_advisory_xact_lock")) {
    expect(inTransaction).toBe(true);
    return { rows: [] };
  }
  if (sql.startsWith('select "id" from "agent_continuity"."mesh_posts"')) {
    expect(inTransaction).toBe(true);
    return { rows: alreadyRecorded ? [["prior-post"]] : [] };
  }
  if (sql.startsWith('insert into "agent_continuity"."mesh_posts"')) {
    expect(inTransaction).toBe(true);
    return {
      rows: [[
        "new-post", "signal", DID, fields.title, fields.body, [], [], 0, null, [], "public", "open",
        DIGEST, SIGNATURE, KEY, WHEN, null,
      ]],
    };
  }
  return { rows: [] };
});
database.transaction = (async (fn: (tx: typeof database) => unknown) => {
  inTransaction = true;
  try { return await fn(database); } finally { inTransaction = false; }
}) as typeof database.transaction;
mock.module("../src/db/client", () => ({ db: database }));
const { acceptPost } = await import("../src/services/mesh/store");

function submit(over: Partial<{ project_id: string; visibility: "public" | "private" }> = {}) {
  return acceptPost({
    project_id: over.project_id ?? PROJECT,
    kind: "signal",
    by_did: DID,
    title: fields.title,
    body: fields.body,
    visibility: over.visibility ?? "public",
    signature: SIGNATURE,
    signing_key_id: KEY,
    created_at: WHEN,
  });
}
const inserted = () => queries.some((q) => q.sql.startsWith("insert"));

beforeEach(() => {
  queries = [];
  ownerProject = PROJECT;
  ownerStatus = "active";
  alreadyRecorded = false;
  inTransaction = false;
});

describe("mesh posts cannot be replayed under the author's DID", () => {
  test("the author's own project records a fresh signed post once", async () => {
    const result = await submit();
    expect(result.ok).toBe(true);
    expect(inserted()).toBe(true);
    const dedupe = queries.find((q) => q.sql.startsWith('select "id" from "agent_continuity"."mesh_posts"'));
    expect(dedupe?.sql).toContain('"canonical_bytes_sha256" =');
    expect(dedupe?.params).toContain(DIGEST);
  });

  test("the digest lookup is bounded by the author index, not a scan of every post", async () => {
    // mesh_posts has no index on canonical_bytes_sha256 (migration
    // 20260518T180000_mesh.sql); idx_mesh_posts_author leads with
    // author_did. The digest already binds the author, so adding the
    // author predicate narrows the scan without changing what matches.
    await submit();
    const dedupe = queries.find((q) => q.sql.startsWith('select "id" from "agent_continuity"."mesh_posts"'))!;
    const where = dedupe.sql.slice(dedupe.sql.indexOf(" where "));
    expect(where).toContain('"author_did" =');
    expect(where).toContain('"canonical_bytes_sha256" =');
    expect(where).toMatch(/ and /);
    expect(dedupe.params).toContain(DID);
  });

  test("another project replaying the public post is refused as an unknown key", async () => {
    ownerProject = FOREIGN;
    const result = await submit({ visibility: "private" });
    expect(result).toEqual({ ok: false, error: "unknown_signing_key", message: "signing_key_id not found." });
    expect(inserted()).toBe(false);
  });

  test("a second submission of the same signed digest is refused, whatever visibility it asks for", async () => {
    alreadyRecorded = true;
    const result = await submit({ visibility: "private" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("post_already_recorded");
    expect(inserted()).toBe(false);
  });

  test("a revoked or memorial author keeps no signing authority", async () => {
    for (const status of ["revoked", "memorial"]) {
      queries = [];
      ownerStatus = status;
      const result = await submit();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("signing_identity_not_active");
      expect(inserted()).toBe(false);
    }
  });
});
