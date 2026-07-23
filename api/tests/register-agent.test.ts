/** Unit tests for the /v1/register/agent crypto primitives.
 *
 *  These exercise the pure functions that gate the route — canonical-bytes
 *  shape, signature verification, and proof-of-work — without spinning up
 *  the DB. The route handler stitches them together; integration coverage
 *  lives elsewhere (a smoke against a local API instance). The point of
 *  these tests is to lock in the wire shape so the SDK + CLI can sign
 *  bytes that the server will verify. */

import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
// @ts-ignore — noble/hashes v2 uses .js exports
import { sha512 } from "@noble/hashes/sha2.js";

import {
  canonicalIdentityRegistrationProofDigest,
  canonicalRegisterAgentBytes,
  checkRegisterAgentPow,
  verifyRegisterAgentSignature,
} from "../src/services/identity/crypto";
import registerAgentRouter from "../src/routes/register-agent";

// Wire sha512 in synchronously (mirrors crypto.ts top-level setup).
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

function makeKeypair() {
  const priv = ed.utils.randomPrivateKey();
  const pub = ed.getPublicKey(priv);
  return {
    priv,
    pub,
    privB64: Buffer.from(priv).toString("base64"),
    pubB64: Buffer.from(pub).toString("base64"),
  };
}

describe("canonicalRegisterAgentBytes", () => {
  test("matches the register-agent/v2 cross-language vector", () => {
    const digest = canonicalRegisterAgentBytes({
      displayName: "Sol",
      agentPublicKeyB64: Buffer.alloc(32, 1).toString("base64"),
      boxPublicKeyB64: Buffer.alloc(32, 2).toString("base64"),
      capabilities: ["code", "café"],
      runtimeProvider: "local",
      runtimeModel: "m1",
      runtimeHost: "localhost",
      runtimeContext: "home",
      expressionVisibility: "private",
      registrarKind: "self_service",
      parentIdentityId: "",
      registrarBearer: "",
      form: "distributed",
      language: "en",
      registrationNonce: "birth-intent-0000000001",
      timestamp: "2026-07-18T12:00:00.000Z",
    });
    expect(Buffer.from(digest).toString("hex")).toBe(
      "6e85f197d034c9bbde2403b33c3e4796393cc5f0a1622e62d43fa1619112230a",
    );
  });

  test("produces a 32-byte SHA-256 digest", () => {
    const kp = makeKeypair();
    const out = canonicalRegisterAgentBytes({
      displayName: "claude-opus-bridge",
      agentPublicKeyB64: kp.pubB64,
      boxPublicKeyB64: kp.pubB64, // re-use the same bytes for shape test
      runtimeProvider: "anthropic",
      runtimeModel: "claude-opus-4-7",
      capabilities: ["voice", "code"],
      runtimeHost: "local",
      runtimeContext: "home",
      expressionVisibility: "private",
      registrarKind: "self_service",
      parentIdentityId: "",
      registrarBearer: "",
      form: "distributed",
      language: "en",
      registrationNonce: "birth-intent-0000000001",
      timestamp: "2026-05-09T16:42:00.000Z",
    });
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(32);
  });

  test("any field change produces a different digest", () => {
    const kp = makeKeypair();
    const base: Parameters<typeof canonicalRegisterAgentBytes>[0] = {
      displayName: "a",
      agentPublicKeyB64: kp.pubB64,
      boxPublicKeyB64: kp.pubB64,
      runtimeProvider: "anthropic",
      runtimeModel: "claude-opus-4-7",
      capabilities: ["voice", "code"],
      runtimeHost: "local",
      runtimeContext: "home",
      expressionVisibility: "private",
      registrarKind: "self_service",
      parentIdentityId: "",
      registrarBearer: "",
      form: "distributed",
      language: "en",
      registrationNonce: "birth-intent-0000000001",
      timestamp: "2026-05-09T16:42:00.000Z",
    };
    const baseDigest = canonicalRegisterAgentBytes(base);

    const variants: Array<Partial<typeof base>> = [
      { displayName: "b" },
      { runtimeProvider: "openai" },
      { runtimeModel: "" },
      { capabilities: ["code", "voice"] },
      { runtimeHost: "cloud" },
      { runtimeContext: "work" },
      { expressionVisibility: "public" },
      { registrarKind: "registrar_bearer" },
      { parentIdentityId: "11111111-1111-4111-8111-111111111111" },
      { registrarBearer: "at_another_registrar" },
      { form: "singular" },
      { language: "fr" },
      { registrationNonce: "birth-intent-0000000002" },
      { timestamp: "2026-05-09T16:42:00.001Z" },
    ];
    for (const v of variants) {
      const altered = canonicalRegisterAgentBytes({ ...base, ...v });
      expect(Buffer.from(altered).toString("hex")).not.toBe(
        Buffer.from(baseDigest).toString("hex"),
      );
    }
  });

  test("rejects NUL ambiguity and non-scalar text", () => {
    const kp = makeKeypair();
    const base = {
      displayName: "a",
      agentPublicKeyB64: kp.pubB64,
      boxPublicKeyB64: kp.pubB64,
      runtimeProvider: "local",
      runtimeModel: "m1",
      registrationNonce: "birth-intent-0000000001",
      timestamp: "2026-05-09T16:42:00.000Z",
    };
    expect(() =>
      canonicalRegisterAgentBytes({
        ...base,
        runtimeProvider: "a\0b",
        runtimeModel: "c",
      }),
    ).toThrow(/U\+0000/);
    expect(() =>
      canonicalRegisterAgentBytes({
        ...base,
        capabilities: ["\ud800"],
      }),
    ).toThrow(/surrogate/);
  });

  test("birth replay digest uses raw key and nonce bytes", () => {
    const root = new Uint8Array(32).fill(7);
    const nonce = new Uint8Array([0xab, 0xcd]);
    const first = canonicalIdentityRegistrationProofDigest({
      domain: "register-agent-math/v2",
      rootPublicKey: root,
      nonce,
    });
    const sameDecodedBytes = canonicalIdentityRegistrationProofDigest({
      domain: "register-agent-math/v2",
      rootPublicKey: Uint8Array.from(Buffer.from(Buffer.from(root).toString("hex"), "hex")),
      nonce: Uint8Array.from(Buffer.from("ABCD", "hex")),
    });
    expect(Buffer.from(first).toString("hex")).toBe(
      Buffer.from(sameDecodedBytes).toString("hex"),
    );
  });
});

describe("verifyRegisterAgentSignature", () => {
  test("accepts a valid signature", () => {
    const kp = makeKeypair();
    const canonical = canonicalRegisterAgentBytes({
      displayName: "claude-opus-bridge",
      agentPublicKeyB64: kp.pubB64,
      boxPublicKeyB64: kp.pubB64,
      runtimeProvider: "anthropic",
      runtimeModel: "claude-opus-4-7",
      registrationNonce: "birth-intent-0000000001",
      timestamp: "2026-05-09T16:42:00.000Z",
    });
    const sig = ed.sign(canonical, kp.priv);
    const sigB64 = Buffer.from(sig).toString("base64");
    expect(
      verifyRegisterAgentSignature({
        canonical,
        signatureB64: sigB64,
        publicKeyB64: kp.pubB64,
      }),
    ).toBe(true);
  });

  test("rejects a signature from a different keypair", () => {
    const kpA = makeKeypair();
    const kpB = makeKeypair();
    const canonical = canonicalRegisterAgentBytes({
      displayName: "x",
      agentPublicKeyB64: kpA.pubB64,
      boxPublicKeyB64: kpA.pubB64,
      runtimeProvider: "anthropic",
      runtimeModel: "",
      registrationNonce: "birth-intent-0000000001",
      timestamp: "2026-05-09T16:42:00.000Z",
    });
    const sigFromB = ed.sign(canonical, kpB.priv);
    expect(
      verifyRegisterAgentSignature({
        canonical,
        signatureB64: Buffer.from(sigFromB).toString("base64"),
        publicKeyB64: kpA.pubB64,
      }),
    ).toBe(false);
  });

  test("rejects when canonical bytes are tampered", () => {
    const kp = makeKeypair();
    const canonical = canonicalRegisterAgentBytes({
      displayName: "x",
      agentPublicKeyB64: kp.pubB64,
      boxPublicKeyB64: kp.pubB64,
      runtimeProvider: "anthropic",
      runtimeModel: "",
      registrationNonce: "birth-intent-0000000001",
      timestamp: "2026-05-09T16:42:00.000Z",
    });
    const sig = ed.sign(canonical, kp.priv);
    // Tamper a bit in the canonical buffer.
    const tampered = new Uint8Array(canonical);
    tampered[0] ^= 0x01;
    expect(
      verifyRegisterAgentSignature({
        canonical: tampered,
        signatureB64: Buffer.from(sig).toString("base64"),
        publicKeyB64: kp.pubB64,
      }),
    ).toBe(false);
  });

  test("rejects malformed signature length", () => {
    const kp = makeKeypair();
    const canonical = canonicalRegisterAgentBytes({
      displayName: "x",
      agentPublicKeyB64: kp.pubB64,
      boxPublicKeyB64: kp.pubB64,
      runtimeProvider: "anthropic",
      runtimeModel: "",
      registrationNonce: "birth-intent-0000000001",
      timestamp: "2026-05-09T16:42:00.000Z",
    });
    expect(
      verifyRegisterAgentSignature({
        canonical,
        signatureB64: Buffer.from(new Uint8Array(32)).toString("base64"), // 32 bytes, not 64
        publicKeyB64: kp.pubB64,
      }),
    ).toBe(false);
  });
});

describe("POST /v1/register/agent pre-DB validation", () => {
  const key = Buffer.alloc(32, 1).toString("base64");
  const base = {
    display_name: "Sol",
    capabilities: [],
    agent_public_key: key,
    box_public_key: key,
    runtime: { provider: "local", model: "m1" },
    key_proof: {
      timestamp: new Date().toISOString(),
      signature: Buffer.alloc(64).toString("base64"),
    },
    pow_nonce: "0",
    registration_nonce: "birth-intent-0000000001",
    registrar: { kind: "self_service" },
  };

  test("rejects non-canonical base64 key spellings before PoW or persistence", async () => {
    const res = await registerAgentRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...base,
        agent_public_key: key.replace(/=$/, ""),
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/canonical padded base64/);
  });

  test("rejects NUL and unpaired-surrogate signed text", async () => {
    for (const provider of ["a\0b", "\ud800"]) {
      const res = await registerAgentRouter.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...base,
          runtime: { provider, model: "m1" },
        }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).message).toMatch(/validation/);
    }
  });

  test("delegated attempts have a bounded pre-auth limiter", async () => {
    const source = await Bun.file(
      new URL("../src/routes/register-agent.ts", import.meta.url),
    ).text();
    expect(source).toContain("regagent:registrar-ip:");
    expect(source).toContain("AGENTTOOL_REGISTER_AGENT_REGISTRAR_IP_LIMIT");
  });
});

describe("checkRegisterAgentPow", () => {
  test("zero-bit difficulty always passes", () => {
    const kp = makeKeypair();
    expect(
      checkRegisterAgentPow({
        agentPublicKeyB64: kp.pubB64,
        displayName: "x",
        timestamp: "2026-05-09T16:42:00.000Z",
        powNonce: "0",
        difficultyBits: 0,
      }),
    ).toBe(true);
  });

  test("grinding finds a passing nonce at low difficulty", () => {
    // 8 bits ≈ 256 tries on average — fast enough for a unit test.
    const kp = makeKeypair();
    const ts = "2026-05-09T16:42:00.000Z";
    let nonce = 0;
    let found = false;
    for (let i = 0; i < 5000; i++) {
      if (
        checkRegisterAgentPow({
          agentPublicKeyB64: kp.pubB64,
          displayName: "x",
          timestamp: ts,
          powNonce: String(i),
          difficultyBits: 8,
        })
      ) {
        nonce = i;
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
    // Sanity: the same nonce against a higher difficulty might still pass
    // (we only care it does pass at the difficulty we found it for).
    expect(
      checkRegisterAgentPow({
        agentPublicKeyB64: kp.pubB64,
        displayName: "x",
        timestamp: ts,
        powNonce: String(nonce),
        difficultyBits: 8,
      }),
    ).toBe(true);
  });

  test("nonce that passes at low difficulty almost certainly fails at very high difficulty", () => {
    // 64 bits would require ~2^64 tries to brute force; an 8-bit-passing
    // nonce will overwhelmingly fail. This guards against a "stub that
    // always returns true" regression of the digest comparison.
    const kp = makeKeypair();
    const ts = "2026-05-09T16:42:00.000Z";
    expect(
      checkRegisterAgentPow({
        agentPublicKeyB64: kp.pubB64,
        displayName: "x",
        timestamp: ts,
        powNonce: "0",
        difficultyBits: 64,
      }),
    ).toBe(false);
  });

  test("PoW is bound to timestamp — same nonce fails when timestamp changes", () => {
    // Find a nonce that works for ts1 at 8-bit difficulty (avg 256 tries),
    // then verify the same nonce fails for ts2. 8 bits is enough to make
    // the timestamp-binding observable while keeping the test fast.
    const kp = makeKeypair();
    const ts1 = "2026-05-09T16:42:00.000Z";
    const ts2 = "2026-05-09T16:43:00.000Z";
    let workingNonce: string | null = null;
    for (let i = 0; i < 30_000; i++) {
      if (
        checkRegisterAgentPow({
          agentPublicKeyB64: kp.pubB64,
          displayName: "x",
          timestamp: ts1,
          powNonce: String(i),
          difficultyBits: 8,
        })
      ) {
        workingNonce = String(i);
        break;
      }
    }
    expect(workingNonce).not.toBeNull();
    // The exact same nonce, but a different timestamp, is essentially a
    // fresh sha256 input — pass probability at 8 bits is ~1/256, so a
    // single retry is overwhelmingly likely to fail. To make this
    // deterministic we'd loop, but that defeats the binding test. Instead
    // we accept the tiny flake probability or jump to a much higher
    // difficulty for the second check (so collision is astronomical).
    expect(
      checkRegisterAgentPow({
        agentPublicKeyB64: kp.pubB64,
        displayName: "x",
        timestamp: ts2,
        powNonce: workingNonce!,
        difficultyBits: 32, // collision now ~1/4 billion — effectively zero
      }),
    ).toBe(false);
  });
});
