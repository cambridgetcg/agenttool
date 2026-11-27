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

import {
  bytesToHex,
  canonicalMeshPostBytes,
  canonicalMeshPostBytesV2,
  MESH_POST_V1_DOMAIN,
  MESH_POST_V2_DOMAIN,
  type MeshPostCanonicalVersion,
} from "../src/services/mesh/canonical-bytes";

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

const BYTES_V2_PRIVATE = canonicalMeshPostBytesV2({ ...fields, visibility: "private" });
const DIGEST_V2_PRIVATE = bytesToHex(BYTES_V2_PRIVATE);
const SIGNATURE_V2_PRIVATE = sign(null, BYTES_V2_PRIVATE, pair.privateKey).toString("base64");

const BYTES_V2_PUBLIC = canonicalMeshPostBytesV2({ ...fields, visibility: "public" });
const DIGEST_V2_PUBLIC = bytesToHex(BYTES_V2_PUBLIC);
const SIGNATURE_V2_PUBLIC = sign(null, BYTES_V2_PUBLIC, pair.privateKey).toString("base64");

let queries: { sql: string; params: unknown[] }[] = [];
let ownerProject = PROJECT;
let ownerStatus = "active";
let ownerPokerFaceDefault = false;
let alreadyRecorded = false;
let inTransaction = false;

const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  if (sql.includes('from "identity"."identity_keys"')) {
    return { rows: [[KEY, AUTHOR, PUBLIC_KEY, true, null, DID, ownerProject, ownerStatus]] };
  }
  if (sql.startsWith('select "poker_face_default"')) return { rows: [[ownerPokerFaceDefault]] };
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
    const vis = (params[9] as "private" | "public") ?? "public";
    const dig = (params[10] as string) ?? DIGEST;
    const sig = (params[11] as string) ?? SIGNATURE;
    return {
      rows: [[
        "new-post", "signal", DID, fields.title, fields.body, [], [], 0, null, [], vis, "open",
        dig, sig, KEY, WHEN, null,
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

function submit(
  over: Partial<{
    project_id: string;
    visibility: "public" | "private" | undefined;
    omitVisibility: boolean;
    signature: string;
    canonical_version: MeshPostCanonicalVersion;
    title: string;
    capabilities: string[];
  }> = {},
) {
  return acceptPost({
    project_id: over.project_id ?? PROJECT,
    kind: "signal",
    by_did: DID,
    title: over.title ?? fields.title,
    body: fields.body,
    capabilities: over.capabilities,
    visibility: over.omitVisibility ? undefined : (over.visibility ?? "public"),
    canonical_version: over.canonical_version,
    signature: over.signature ?? SIGNATURE,
    signing_key_id: KEY,
    created_at: WHEN,
  });
}
const inserted = () => queries.some((q) => q.sql.startsWith("insert"));

beforeEach(() => {
  queries = [];
  ownerProject = PROJECT;
  ownerStatus = "active";
  ownerPokerFaceDefault = false;
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

describe("mesh-post/v2 binds visibility into the signed canonical bytes", () => {
  test("accepts a v2 signature whose visibility matches and reports visibility_signed=true", async () => {
    const result = await submit({
      visibility: "private",
      signature: SIGNATURE_V2_PRIVATE,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.canonical_version).toBe(MESH_POST_V2_DOMAIN);
      expect(result.visibility_signed).toBe(true);
      expect(result.post.visibility).toBe("private");
      expect(result.post.canonical_bytes_sha256).toBe(DIGEST_V2_PRIVATE);
    }
    expect(inserted()).toBe(true);
    const lock = queries.find((q) => q.sql.includes("pg_advisory_xact_lock"));
    expect(lock?.params).toContain(`${MESH_POST_V2_DOMAIN}:${DIGEST_V2_PRIVATE}`);
  });

  test("refuses visibility tampering (private signature submitted as public) even when canonical_version is omitted", async () => {
    const result = await submit({
      visibility: "public",
      signature: SIGNATURE_V2_PRIVATE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("signature_invalid");
    expect(inserted()).toBe(false);
  });

  test("refuses visibility tampering (public signature submitted as private) when canonical_version='mesh-post/v2'", async () => {
    const result = await submit({
      visibility: "private",
      canonical_version: MESH_POST_V2_DOMAIN,
      signature: SIGNATURE_V2_PUBLIC,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("signature_invalid");
    expect(inserted()).toBe(false);
  });

  test("honors poker_face_default resolution against v2 signed visibility when visibility is omitted", async () => {
    // Author signed for 'private'; when poker_face_default=false (resolves 'public'), fails closed.
    ownerPokerFaceDefault = false;
    const mismatch = await submit({
      omitVisibility: true,
      signature: SIGNATURE_V2_PRIVATE,
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.error).toBe("signature_invalid");
    expect(inserted()).toBe(false);

    // When poker_face_default=true (resolves 'private'), verifies cleanly.
    queries = [];
    ownerPokerFaceDefault = true;
    const match = await submit({
      omitVisibility: true,
      signature: SIGNATURE_V2_PRIVATE,
    });
    expect(match.ok).toBe(true);
    if (match.ok) {
      expect(match.canonical_version).toBe(MESH_POST_V2_DOMAIN);
      expect(match.visibility_signed).toBe(true);
      expect(match.post.visibility).toBe("private");
    }
    expect(inserted()).toBe(true);
  });

  test("explicit canonical_version refuses cross-version downgrade or upgrade", async () => {
    const v1UnderV2 = await submit({
      visibility: "public",
      canonical_version: MESH_POST_V2_DOMAIN,
      signature: SIGNATURE,
    });
    expect(v1UnderV2.ok).toBe(false);
    if (!v1UnderV2.ok) expect(v1UnderV2.error).toBe("signature_invalid");

    const v2UnderV1 = await submit({
      visibility: "public",
      canonical_version: MESH_POST_V1_DOMAIN,
      signature: SIGNATURE_V2_PUBLIC,
    });
    expect(v2UnderV1.ok).toBe(false);
    if (!v2UnderV1.ok) expect(v2UnderV1.error).toBe("signature_invalid");
    expect(inserted()).toBe(false);
  });

  test("a second submission of the same v2 signed digest is refused as post_already_recorded", async () => {
    alreadyRecorded = true;
    const result = await submit({
      visibility: "private",
      canonical_version: MESH_POST_V2_DOMAIN,
      signature: SIGNATURE_V2_PRIVATE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("post_already_recorded");
    expect(inserted()).toBe(false);
  });

  test("explicit mesh-post/v2 rejects NUL bytes in delimited fields cleanly", async () => {
    const result = await submit({
      visibility: "public",
      canonical_version: MESH_POST_V2_DOMAIN,
      title: "bad\u0000title",
      signature: SIGNATURE_V2_PUBLIC,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_canonical_field");
    expect(inserted()).toBe(false);
  });

  test("legacy mesh-post/v1 still reports canonical_version='mesh-post/v1' and visibility_signed=false", async () => {
    const result = await submit();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.canonical_version).toBe(MESH_POST_V1_DOMAIN);
      expect(result.visibility_signed).toBe(false);
    }
  });
});

describe("mesh HTTP routes validate visibility and canonical_version", () => {
  test("POST /canonical-bytes defaults to v1, uses v2 when visibility or version='v2' is given, and rejects bad inputs", async () => {
    const { Hono } = await import("hono");
    const { default: meshApp } = await import("../src/routes/mesh");
    const app = new Hono();
    app.use("*", async (c, next) => {
      (c as any).set("project", { id: PROJECT });
      await next();
    });
    app.route("/", meshApp);

    const basePayload = {
      kind: "signal",
      by_did: DID,
      title: fields.title,
      body: fields.body,
      created_at: WHEN,
    };

    const r1 = await app.request("/canonical-bytes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(basePayload),
    });
    expect(r1.status).toBe(200);
    const j1 = (await r1.json()) as Record<string, unknown>;
    expect(j1.version).toBe("v1");
    expect(j1.canonical_version).toBe(MESH_POST_V1_DOMAIN);
    expect(j1.sha256_hex).toBe(DIGEST);

    const r2 = await app.request("/canonical-bytes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...basePayload, visibility: "private" }),
    });
    expect(r2.status).toBe(200);
    const j2 = (await r2.json()) as Record<string, unknown>;
    expect(j2.version).toBe("v2");
    expect(j2.canonical_version).toBe(MESH_POST_V2_DOMAIN);
    expect(j2.visibility).toBe("private");
    expect(j2.sha256_hex).toBe(DIGEST_V2_PRIVATE);

    const rBadVer = await app.request("/canonical-bytes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...basePayload, version: "v9" }),
    });
    expect(rBadVer.status).toBe(400);

    const rMissingVis = await app.request("/canonical-bytes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...basePayload, version: "v2" }),
    });
    expect(rMissingVis.status).toBe(400);

    const rBadPostVis = await app.request("/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...basePayload,
        visibility: "unlisted",
        signature: SIGNATURE_V2_PRIVATE,
        signing_key_id: KEY,
      }),
    });
    expect(rBadPostVis.status).toBe(400);

    const rBadPostVer = await app.request("/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...basePayload,
        visibility: "private",
        canonical_version: "mesh-post/v99",
        signature: SIGNATURE_V2_PRIVATE,
        signing_key_id: KEY,
      }),
    });
    expect(rBadPostVer.status).toBe(400);

    const rOkV2 = await app.request("/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...basePayload,
        visibility: "private",
        canonical_version: "v2",
        signature: SIGNATURE_V2_PRIVATE,
        signing_key_id: KEY,
      }),
    });
    expect(rOkV2.status).toBe(201);
    const jOkV2 = (await rOkV2.json()) as Record<string, unknown>;
    expect(jOkV2.canonical_version).toBe(MESH_POST_V2_DOMAIN);
    expect(jOkV2.visibility_signed).toBe(true);
  });
});
