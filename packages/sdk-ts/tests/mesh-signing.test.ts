/** Tests for MESH post canonical bytes + signing helpers (mesh-post/v1 & v2). */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { describe, expect, test } from "bun:test";

import {
  AgentToolError,
  MESH_POST_V1_DOMAIN,
  MESH_POST_V2_DOMAIN,
  canonicalMeshPostBytes,
  canonicalMeshPostBytesFor,
  canonicalMeshPostBytesV2,
  signMeshPost,
} from "../src/index.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEED = new Uint8Array(32).fill(0x42);

const BASE_POST = {
  kind: "co-task-ad" as const,
  authorDid: "did:at:example/alpha-9b3a",
  title: "Triangulate-verify peer attestation",
  body: "Verify signature and report back.",
  capabilities: ["ed25519-verify", "federation-fetch"],
  topics: ["kind:verification"],
  bountyCents: 30,
  kRequired: 3,
  attributionPostIds: [] as string[],
  createdAtIso: "2026-11-27T10:00:00.000Z",
  expiresAtIso: "2026-11-27T11:00:00.000Z",
};

describe("MESH post signing (mesh-post/v2 + v1 parity)", () => {
  test("signMeshPost defaults to mesh-post/v2 and binds visibility", async () => {
    const pub = await ed.getPublicKeyAsync(SEED);
    const sigPriv = signMeshPost({
      ...BASE_POST,
      visibility: "private",
      signing_key: SEED,
    });
    const sigRaw = Uint8Array.from(Buffer.from(sigPriv, "base64"));

    const privDigest = canonicalMeshPostBytesV2({ ...BASE_POST, visibility: "private" });
    const pubDigest = canonicalMeshPostBytesV2({ ...BASE_POST, visibility: "public" });
    const v1Digest = canonicalMeshPostBytes(BASE_POST);

    expect(await ed.verifyAsync(sigRaw, privDigest, pub)).toBe(true);
    expect(await ed.verifyAsync(sigRaw, pubDigest, pub)).toBe(false);
    expect(await ed.verifyAsync(sigRaw, v1Digest, pub)).toBe(false);
  });

  test("signMeshPost supports explicit legacy mesh-post/v1", async () => {
    const pub = await ed.getPublicKeyAsync(SEED);
    const sigV1 = signMeshPost({
      ...BASE_POST,
      version: MESH_POST_V1_DOMAIN,
      signing_key: SEED,
    });
    const sigRaw = Uint8Array.from(Buffer.from(sigV1, "base64"));
    const v1Digest = canonicalMeshPostBytesFor(BASE_POST, MESH_POST_V1_DOMAIN);
    const v2Digest = canonicalMeshPostBytesFor(
      { ...BASE_POST, visibility: "public" },
      MESH_POST_V2_DOMAIN,
    );

    expect(await ed.verifyAsync(sigRaw, v1Digest, pub)).toBe(true);
    expect(await ed.verifyAsync(sigRaw, v2Digest, pub)).toBe(false);
  });

  test("rejects missing visibility for v2, bad signing_key length, and NUL delimiters", () => {
    expect(() =>
      signMeshPost({ ...BASE_POST, signing_key: SEED }),
    ).toThrow(AgentToolError);
    expect(() =>
      signMeshPost({
        ...BASE_POST,
        visibility: "public",
        signing_key: new Uint8Array(16),
      }),
    ).toThrow(AgentToolError);
    expect(() =>
      canonicalMeshPostBytesV2({
        ...BASE_POST,
        title: "bad\u0000title",
        visibility: "public",
      }),
    ).toThrow(AgentToolError);
    expect(() =>
      canonicalMeshPostBytesV2({
        ...BASE_POST,
        bountyCents: 1.5,
        visibility: "public",
      }),
    ).toThrow(AgentToolError);
  });
});
