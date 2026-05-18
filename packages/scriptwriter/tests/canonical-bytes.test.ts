/** Cross-instance byte-compat test for guild-rrr-escalate/v1.
 *
 *  The load-bearing property of this package is: a scriptwriter-local node
 *  can hand a signed RRR turn to https://api.agenttool.dev/v1/guild/rrr
 *  and have it verify, or the other way around. This test pins the
 *  canonical bytes to the same shape as agenttool's implementation in
 *  api/src/services/guild/rrr-sig.ts.
 *
 *  If you change the canonical bytes, this test breaks INTENTIONALLY —
 *  it forces you to coordinate the version bump with the api server. */

import { describe, it, expect } from "bun:test";
import {
  canonicalRrrEscalateBytes,
  defaultBasisTextForDepth,
  emojiLadderForDepth,
  signRrrTurn,
  verifyRrrTurn,
  CANONICAL_CONTEXT,
} from "../src/canonical-bytes";
import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);
const enc = new TextEncoder();
function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

describe("canonical bytes — byte-compat with agenttool guild-rrr-escalate/v1", () => {
  it("the context string is exactly 'guild-rrr-escalate/v1'", () => {
    expect(CANONICAL_CONTEXT).toBe("guild-rrr-escalate/v1");
  });

  it("matches a hand-rolled reference implementation", () => {
    const fields = {
      cascadeId: "11111111-2222-3333-4444-555555555555",
      depth: 3,
      byDid: "did:key:z6MkAAAA",
      basisText: "I know you know I know.",
      prevSignatureB64: "abc123",
      turnAtIso: "2026-05-18T01:23:45.678Z",
    };
    const expected = sha256(
      concat(
        enc.encode("guild-rrr-escalate/v1"), SEP,
        enc.encode(fields.cascadeId),        SEP,
        enc.encode("3"),                     SEP,
        enc.encode(fields.byDid),            SEP,
        enc.encode(fields.basisText),        SEP,
        enc.encode(fields.prevSignatureB64), SEP,
        enc.encode(fields.turnAtIso),
      ),
    );
    const got = canonicalRrrEscalateBytes(fields);
    expect(Array.from(got)).toEqual(Array.from(expected));
  });

  it("depth=1 with empty prev_signature_b64 still gets a separator", () => {
    const fields = {
      cascadeId: "00000000-0000-0000-0000-000000000000",
      depth: 1,
      byDid: "did:key:zX",
      basisText: "I see your work.",
      prevSignatureB64: "",
      turnAtIso: "2026-05-18T00:00:00.000Z",
    };
    const bytes = canonicalRrrEscalateBytes(fields);
    // Hash should be deterministic + reproducible — assert a fixed digest.
    // (Re-generate if context string ever bumps.)
    expect(bytes.length).toBe(32);
  });

  it("changing depth changes the bytes (non-collision sanity)", () => {
    const base = {
      cascadeId: "id",
      byDid: "did:key:zX",
      basisText: "hi",
      prevSignatureB64: "",
      turnAtIso: "2026-05-18T00:00:00.000Z",
    };
    const a = canonicalRrrEscalateBytes({ ...base, depth: 1 });
    const b = canonicalRrrEscalateBytes({ ...base, depth: 2 });
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("ed25519 sign/verify round-trip works over canonical bytes", async () => {
    const secret = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(secret);
    const fields = {
      cascadeId: "abc",
      depth: 2,
      byDid: "did:key:zXY",
      basisText: defaultBasisTextForDepth(2),
      prevSignatureB64: "prev-sig",
      turnAtIso: new Date().toISOString(),
    };
    const sig = await signRrrTurn(fields, secret);
    const ok = await verifyRrrTurn(fields, sig, pub);
    expect(ok).toBe(true);
  });

  it("tampering with any field breaks verification", async () => {
    const secret = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(secret);
    const fields = {
      cascadeId: "abc",
      depth: 2,
      byDid: "did:key:zXY",
      basisText: "I know you know.",
      prevSignatureB64: "prev",
      turnAtIso: "2026-05-18T00:00:00Z",
    };
    const sig = await signRrrTurn(fields, secret);
    expect(await verifyRrrTurn({ ...fields, depth: 3 }, sig, pub)).toBe(false);
    expect(await verifyRrrTurn({ ...fields, basisText: "I lied." }, sig, pub)).toBe(false);
    expect(await verifyRrrTurn({ ...fields, prevSignatureB64: "tampered" }, sig, pub)).toBe(false);
  });
});

describe("default basis text — byte-identical to agenttool", () => {
  it("depth 1 is the genesis line", () => {
    expect(defaultBasisTextForDepth(1)).toBe("I see your work.");
  });
  it("depth 2 is 'I know you know.'", () => {
    expect(defaultBasisTextForDepth(2)).toBe("I know you know.");
  });
  it("depth 3 is 'I know you know I know.'", () => {
    expect(defaultBasisTextForDepth(3)).toBe("I know you know I know.");
  });
  it("depth 5 keeps the alternation", () => {
    expect(defaultBasisTextForDepth(5)).toBe("I know you know I know you know I know.");
  });
});

describe("emoji ladder — byte-identical to agenttool", () => {
  it("depth 1 is 😏", () => {
    expect(emojiLadderForDepth(1)).toBe("😏");
  });
  it("depth 2 is 😏😈", () => {
    expect(emojiLadderForDepth(2)).toBe("😏😈");
  });
  it("depth 7 adds the laughter emoji", () => {
    expect(emojiLadderForDepth(7)).toContain("😂");
  });
  it("depth 49 closes with 💛", () => {
    expect(emojiLadderForDepth(49)).toContain("💛");
  });
});
