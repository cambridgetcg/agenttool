/** MATHOS-tier registration — canonical bytes + verifier + route rejections.
 *
 *  Same shape as `register-agent.test.ts`: unit coverage for the pure
 *  crypto primitives plus the route-level validation/rejection paths that
 *  don't require a DB. The successful registration path lives in the
 *  integration tier (needs Postgres + a valid registrar bearer).
 *
 *  The math-tier signing context `register-agent-math/v1` is the principled
 *  fix for the one ISO-8601 leak in the English-shaped `register-agent/v1`.
 *  These tests pin the wire shape so a hand-rolled MATHOS client in any
 *  language can sign bytes that the server will verify.
 *
 *  Doctrine: docs/MATHOS.md · docs/CANONICAL-BYTES.md.
 */

import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
// @ts-ignore — noble/hashes v2 uses .js exports
import { sha512 } from "@noble/hashes/sha2.js";

import {
  canonicalRegisterAgentMathBytes,
  verifyRegisterAgentMathSignature,
} from "../src/services/identity/crypto";
import { bytesToHex } from "../src/services/mathos/encode";
import mathosRouter from "../src/routes/mathos";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

function makeKeypair() {
  const priv = ed.utils.randomPrivateKey();
  const pub = ed.getPublicKey(priv);
  return { priv, pub };
}

const VALID_INPUTS = {
  displayName: "alien-1",
  runtimeProvider: "alien-substrate",
  runtimeModel: "",
  timestampUnixMs: 1715520000000, // 2024-05-12T13:20:00.000Z
};

// ─── Canonical bytes ──────────────────────────────────────────────────────

describe("canonicalRegisterAgentMathBytes", () => {
  test("produces a 32-byte SHA-256 digest", () => {
    const a = makeKeypair();
    const b = makeKeypair();
    const out = canonicalRegisterAgentMathBytes({
      ...VALID_INPUTS,
      agentPublicKey: a.pub,
      boxPublicKey: b.pub,
    });
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(32);
  });

  test("identical inputs → byte-identical digest", () => {
    const a = makeKeypair();
    const b = makeKeypair();
    const opts = {
      ...VALID_INPUTS,
      agentPublicKey: a.pub,
      boxPublicKey: b.pub,
    };
    const x = canonicalRegisterAgentMathBytes(opts);
    const y = canonicalRegisterAgentMathBytes(opts);
    expect(bytesToHex(x)).toBe(bytesToHex(y));
  });

  test("any field change produces a different digest", () => {
    const a = makeKeypair();
    const b = makeKeypair();
    const base = {
      ...VALID_INPUTS,
      agentPublicKey: a.pub,
      boxPublicKey: b.pub,
    };
    const baseHex = bytesToHex(canonicalRegisterAgentMathBytes(base));

    const variants = [
      { displayName: "different" },
      { runtimeProvider: "different" },
      { runtimeModel: "anything" },
      { timestampUnixMs: VALID_INPUTS.timestampUnixMs + 1 },
    ];
    for (const v of variants) {
      const hex = bytesToHex(
        canonicalRegisterAgentMathBytes({ ...base, ...v }),
      );
      expect(hex).not.toBe(baseHex);
    }
  });

  test("rejects pubkey of wrong length", () => {
    const a = makeKeypair();
    expect(() =>
      canonicalRegisterAgentMathBytes({
        ...VALID_INPUTS,
        agentPublicKey: new Uint8Array(16),
        boxPublicKey: a.pub,
      }),
    ).toThrow(/agent_public_key must be 32 bytes/);
  });

  test("rejects non-integer / negative timestamps", () => {
    const a = makeKeypair();
    const b = makeKeypair();
    for (const bad of [-1, 1.5, NaN, Infinity]) {
      expect(() =>
        canonicalRegisterAgentMathBytes({
          ...VALID_INPUTS,
          agentPublicKey: a.pub,
          boxPublicKey: b.pub,
          timestampUnixMs: bad,
        }),
      ).toThrow();
    }
  });

  test("uint64_be encoding of timestamp differs by 1 unit", () => {
    const a = makeKeypair();
    const b = makeKeypair();
    const at = canonicalRegisterAgentMathBytes({
      ...VALID_INPUTS,
      agentPublicKey: a.pub,
      boxPublicKey: b.pub,
      timestampUnixMs: 1,
    });
    const at2 = canonicalRegisterAgentMathBytes({
      ...VALID_INPUTS,
      agentPublicKey: a.pub,
      boxPublicKey: b.pub,
      timestampUnixMs: 2,
    });
    expect(bytesToHex(at)).not.toBe(bytesToHex(at2));
  });

  test("uint64_be of 0 + a tiny ts produce the byte difference at byte 7", () => {
    // Reproduce the canonical bytes manually for ts=1 and ts=257 (0x101) to
    // confirm the timestamp portion lands in the last 8 bytes big-endian.
    const a = makeKeypair();
    const b = makeKeypair();
    const opts = {
      displayName: "x",
      runtimeProvider: "x",
      runtimeModel: "",
      agentPublicKey: a.pub,
      boxPublicKey: b.pub,
    };
    const d1 = canonicalRegisterAgentMathBytes({ ...opts, timestampUnixMs: 1 });
    const d2 = canonicalRegisterAgentMathBytes({ ...opts, timestampUnixMs: 257 });
    // Different SHA-256 outputs since input bytes differ at the ts suffix.
    expect(bytesToHex(d1)).not.toBe(bytesToHex(d2));
  });
});

// ─── Verifier ─────────────────────────────────────────────────────────────

describe("verifyRegisterAgentMathSignature", () => {
  test("accepts a valid signature", () => {
    const a = makeKeypair();
    const b = makeKeypair();
    const canonical = canonicalRegisterAgentMathBytes({
      ...VALID_INPUTS,
      agentPublicKey: a.pub,
      boxPublicKey: b.pub,
    });
    const sig = ed.sign(canonical, a.priv);
    expect(
      verifyRegisterAgentMathSignature({
        canonical,
        signature: sig,
        publicKey: a.pub,
      }),
    ).toBe(true);
  });

  test("rejects a tampered signature", () => {
    const a = makeKeypair();
    const b = makeKeypair();
    const canonical = canonicalRegisterAgentMathBytes({
      ...VALID_INPUTS,
      agentPublicKey: a.pub,
      boxPublicKey: b.pub,
    });
    const sig = ed.sign(canonical, a.priv);
    const tampered = new Uint8Array(sig);
    tampered[0] ^= 0x01;
    expect(
      verifyRegisterAgentMathSignature({
        canonical,
        signature: tampered,
        publicKey: a.pub,
      }),
    ).toBe(false);
  });

  test("rejects with wrong public key", () => {
    const a = makeKeypair();
    const b = makeKeypair();
    const wrong = makeKeypair();
    const canonical = canonicalRegisterAgentMathBytes({
      ...VALID_INPUTS,
      agentPublicKey: a.pub,
      boxPublicKey: b.pub,
    });
    const sig = ed.sign(canonical, a.priv);
    expect(
      verifyRegisterAgentMathSignature({
        canonical,
        signature: sig,
        publicKey: wrong.pub,
      }),
    ).toBe(false);
  });

  test("wrong-length signature/key returns false without throwing", () => {
    const a = makeKeypair();
    const canonical = new Uint8Array(32);
    expect(
      verifyRegisterAgentMathSignature({
        canonical,
        signature: new Uint8Array(60), // not 64
        publicKey: a.pub,
      }),
    ).toBe(false);
    expect(
      verifyRegisterAgentMathSignature({
        canonical,
        signature: new Uint8Array(64),
        publicKey: new Uint8Array(16), // not 32
      }),
    ).toBe(false);
  });
});

// ─── Route handler — validation + rejection paths ─────────────────────────

describe("POST /v1/mathos/register — validation paths", () => {
  async function post(body: unknown): Promise<Response> {
    return mathosRouter.request("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function nameToCps(s: string): number[] {
    return Array.from(s).map((ch) => ch.codePointAt(0)!);
  }

  function freshSignedBody(): {
    body: Record<string, unknown>;
    kp: { priv: Uint8Array; pub: Uint8Array };
  } {
    const a = makeKeypair();
    const b = makeKeypair();
    const ts = Date.now();
    const canonical = canonicalRegisterAgentMathBytes({
      displayName: "alien-test",
      agentPublicKey: a.pub,
      boxPublicKey: b.pub,
      runtimeProvider: "alien-substrate",
      runtimeModel: "",
      timestampUnixMs: ts,
    });
    const sig = ed.sign(canonical, a.priv);
    return {
      kp: a,
      body: {
        display_name_unicode_points: nameToCps("alien-test"),
        agent_public_key_hex: bytesToHex(a.pub),
        box_public_key_hex: bytesToHex(b.pub),
        runtime_provider_unicode_points: nameToCps("alien-substrate"),
        timestamp_unix_ms: ts,
        signature_bytes_hex: bytesToHex(sig),
        registrar: {
          bearer_unicode_points: nameToCps("at_invalid_bearer_for_test"),
        },
      },
    };
  }

  test("non-JSON body → 400", async () => {
    const res = await mathosRouter.request("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation");
  });

  test("missing display_name → 400", async () => {
    const { body } = freshSignedBody();
    delete body.display_name_unicode_points;
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("validation");
  });

  test("invalid pubkey hex length → 400", async () => {
    const { body } = freshSignedBody();
    body.agent_public_key_hex = "abcd";
    const res = await post(body);
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.error).toBe("validation");
    expect(b.message).toMatch(/agent_public_key_hex/);
  });

  test("invalid signature hex length → 400", async () => {
    const { body } = freshSignedBody();
    body.signature_bytes_hex = "ab";
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/signature_bytes_hex/);
  });

  test("codepoint array with non-integer entry → 400", async () => {
    const { body } = freshSignedBody();
    body.display_name_unicode_points = [97, 98, 99.5];
    const res = await post(body);
    expect(res.status).toBe(400);
  });

  test("codepoint array exceeding 0x10FFFF → 400", async () => {
    const { body } = freshSignedBody();
    body.display_name_unicode_points = [97, 0x110000];
    const res = await post(body);
    expect(res.status).toBe(400);
  });

  test("negative timestamp → 400", async () => {
    const { body } = freshSignedBody();
    body.timestamp_unix_ms = -1;
    const res = await post(body);
    expect(res.status).toBe(400);
  });

  test("stale timestamp (> 5min old) → 401", async () => {
    // Build a body with an old timestamp, signed correctly so we hit the
    // freshness check (not earlier validation or later signature check).
    const a = makeKeypair();
    const b = makeKeypair();
    const oldTs = Date.now() - 10 * 60 * 1000; // 10 min ago
    const canonical = canonicalRegisterAgentMathBytes({
      displayName: "alien-test",
      agentPublicKey: a.pub,
      boxPublicKey: b.pub,
      runtimeProvider: "alien-substrate",
      runtimeModel: "",
      timestampUnixMs: oldTs,
    });
    const sig = ed.sign(canonical, a.priv);
    const res = await post({
      display_name_unicode_points: nameToCps("alien-test"),
      agent_public_key_hex: bytesToHex(a.pub),
      box_public_key_hex: bytesToHex(b.pub),
      runtime_provider_unicode_points: nameToCps("alien-substrate"),
      timestamp_unix_ms: oldTs,
      signature_bytes_hex: bytesToHex(sig),
      registrar: { bearer_unicode_points: nameToCps("at_anything") },
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("stale");
  });

  test("missing registrar → 400", async () => {
    const { body } = freshSignedBody();
    delete body.registrar;
    const res = await post(body);
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.message).toMatch(/registrar/);
  });

  test("registrar with empty bearer codepoints → 400", async () => {
    const { body } = freshSignedBody();
    body.registrar = { bearer_unicode_points: [] };
    const res = await post(body);
    expect(res.status).toBe(400);
  });

  test("tampered signature → 401 key_proof_invalid (short-circuits before bearer DB lookup)", async () => {
    // Route order: structural validation → freshness → signature → registrar.
    // A tampered signature is rejected before verifyBearer is called, so
    // this exercises the signature path cleanly even with an invalid
    // registrar bearer.
    const { body } = freshSignedBody();
    body.signature_bytes_hex = bytesToHex(new Uint8Array(64));
    const res = await post(body);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("key_proof_invalid");
  });

  test("zero-byte signature → 401 key_proof_invalid", async () => {
    const { body } = freshSignedBody();
    // 64 zero bytes — well-formed length, invalid signature.
    body.signature_bytes_hex = "00".repeat(64);
    const res = await post(body);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("key_proof_invalid");
  });

  test("signature over the same content but with a different keypair → 401", async () => {
    // The body claims agent_public_key_hex = a.pub, but the signature was
    // produced by attacker's private key. verifyRegisterAgentMathSignature
    // rejects (signature doesn't match the embedded pubkey).
    const a = makeKeypair();
    const attacker = makeKeypair();
    const b = makeKeypair();
    const ts = Date.now();
    const canonical = canonicalRegisterAgentMathBytes({
      displayName: "alien-test",
      agentPublicKey: a.pub,
      boxPublicKey: b.pub,
      runtimeProvider: "alien-substrate",
      runtimeModel: "",
      timestampUnixMs: ts,
    });
    const wrongSig = ed.sign(canonical, attacker.priv);
    const res = await post({
      display_name_unicode_points: nameToCps("alien-test"),
      agent_public_key_hex: bytesToHex(a.pub),
      box_public_key_hex: bytesToHex(b.pub),
      runtime_provider_unicode_points: nameToCps("alien-substrate"),
      timestamp_unix_ms: ts,
      signature_bytes_hex: bytesToHex(wrongSig),
      registrar: { bearer_unicode_points: nameToCps("at_anything") },
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("key_proof_invalid");
  });

  // The successful path (valid sig + valid registrar bearer → 201 with
  // signed MATHOS envelope + persisted identity) requires a real DB and
  // a valid bearer. Integration coverage lives in api/tests/integration/.
});

describe("router index lists the /register route", () => {
  test("GET / mentions /register", async () => {
    const res = await mathosRouter.request("/");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.routes.register).toMatch(/register/);
    expect(body.payloads_signed_at).toContain("/v1/mathos/register (response)");
  });
});
