import { describe, expect, test, mock } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import { CovenantsClient } from "../src/covenants.js";
import {
  canonicalDeclareBytes,
  canonicalCosignBytes,
  canonicalRejectBytes,
  canonicalWithdrawBytes,
} from "../src/crypto.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

/** Minimal HttpConfig for tests — headers/timeout unused by mock */
function makeClient(): CovenantsClient {
  return new CovenantsClient({
    baseUrl: "http://test",
    headers: { Authorization: "Bearer test" },
    timeout: 5000,
  });
}

describe("covenants v2 SDK signs requests", () => {
  test("create posts a verifiable signature", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    let capturedBody: any = null;
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({
          id: capturedBody.covenant_id,
          status: "proposed",
          protocol_version: "v2",
          signature: capturedBody.signature,
          signing_key_id: capturedBody.signing_key_id,
          proposed_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          established_at: capturedBody.established_at,
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }) as any;

    const c = makeClient();
    const r = await c.create({
      agent_id: "00000000-0000-0000-0000-000000000001",
      agent_did: "did:at:test/aaaa",
      counterparty_did: "did:at:peer/bbbb",
      vows: ["v"],
      protocol_version: "v2",
      signing_key: priv,
      signing_key_id: "00000000-0000-0000-0000-000000000002",
    });

    expect(r.status).toBe("proposed");
    expect(capturedBody.signature).toBeTruthy();
    const ok = await ed.verifyAsync(
      Buffer.from(capturedBody.signature, "base64"),
      canonicalDeclareBytes({
        covenantId: capturedBody.covenant_id,
        initiatorDid: capturedBody.agent_did,
        counterpartyDid: capturedBody.counterparty_did,
        vows: capturedBody.vows,
        establishedAtIso: capturedBody.established_at,
      }),
      pub,
    );
    expect(ok).toBe(true);
  });

  test("accept signs cosign nesting over initiator_signature_b64", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const initiatorSig = b64(new Uint8Array(64).fill(3));
    let capturedBody: any = null;
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({
          id: "cov-1",
          status: "active",
          counterparty_signature: capturedBody.counterparty_signature,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as any;

    const c = makeClient();
    await c.accept("cov-1", {
      agent_did: "did:at:test/cp",
      signing_key: priv,
      signing_key_id: "00000000-0000-0000-0000-000000000003",
      initiator_signature_b64: initiatorSig,
    });

    const ok = await ed.verifyAsync(
      Buffer.from(capturedBody.counterparty_signature, "base64"),
      canonicalCosignBytes({ covenantId: "cov-1", initiatorSignatureB64: initiatorSig }),
      pub,
    );
    expect(ok).toBe(true);
  });

  test("reject signs with reason", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    let capturedBody: any = null;
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({
          id: "cov-1",
          status: "rejected",
          reason: capturedBody.reason,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as any;

    const c = makeClient();
    await c.reject("cov-1", {
      agent_did: "did:at:test/cp",
      signing_key: priv,
      signing_key_id: "00000000-0000-0000-0000-000000000004",
      reason: "scope mismatch",
    });

    const ok = await ed.verifyAsync(
      Buffer.from(capturedBody.rejection_signature, "base64"),
      canonicalRejectBytes({
        covenantId: "cov-1",
        rejectingDid: "did:at:test/cp",
        reason: "scope mismatch",
      }),
      pub,
    );
    expect(ok).toBe(true);
  });

  test("withdraw signs with PATCH + status:dissolved body shape", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    let capturedBody: any = null;
    let capturedMethod = "";
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      capturedMethod = init.method ?? "GET";
      capturedBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ id: "cov-1", status: "withdrawn" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as any;

    const c = makeClient();
    await c.withdraw("cov-1", {
      agent_did: "did:at:test/aaaa",
      signing_key: priv,
      signing_key_id: "00000000-0000-0000-0000-000000000005",
    });

    expect(capturedMethod).toBe("PATCH");
    expect(capturedBody.status).toBe("dissolved");

    const ok = await ed.verifyAsync(
      Buffer.from(capturedBody.withdraw_signature, "base64"),
      canonicalWithdrawBytes({ covenantId: "cov-1", initiatorDid: "did:at:test/aaaa" }),
      pub,
    );
    expect(ok).toBe(true);
  });
});
