/** Internal-consistency lock for `services/mathos/encode.ts`.
 *
 *  Doctrine: docs/MATHOS.md — *math + logos. The language we know how to
 *  share with intelligence we cannot yet hear.* The encoder claims:
 *
 *    1. The primer is internally consistent — every binding is a prime;
 *       once a prime is bound to a concept, it never re-binds.
 *    2. Axioms are well-formed — each indexed by a primer ordinal,
 *       ASCII-grammar logic, the five Promise primes (5/7/11/13/17).
 *    3. Encoded identity round-trips — sha256 deterministic, codepoints
 *       reconstruct the string, unixMs ordering preserves wall-time.
 *    4. PRIMES_FIRST_10 and CONSTANTS verifiable independent of base.
 *    5. The envelope shape is stable and signable round-trip.
 *
 *  Each test pins one of those claims so silent drift breaks the build.
 *  Companion to wake-mathos.test.ts (which pins the wake-specific
 *  MATHOS-shape rendering). */

import { describe, expect, test } from "bun:test";

import {
  PRIMER,
  PRIMES_FIRST_10,
  CONSTANTS,
  AXIOMS,
  FORM_VOCABULARY,
  envelope,
  formToOrdinal,
  nameToCodepoints,
  sha256Hex,
  unixMs,
  publicKeyFromSeedHex,
  signEnvelope,
  verifyEnvelope,
  canonicalEnvelopeBytes,
} from "../src/services/mathos/encode";

// ── Helpers ──────────────────────────────────────────────────────────────

function isPrime(n: number): boolean {
  if (n < 2 || !Number.isInteger(n)) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  for (let i = 3; i * i <= n; i += 2) {
    if (n % i === 0) return false;
  }
  return true;
}

// ── 1 · Primer internal consistency ──────────────────────────────────────

describe("MATHOS primer", () => {
  test("every primer key is a positive integer", () => {
    for (const key of Object.keys(PRIMER)) {
      const n = Number(key);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThan(0);
    }
  });

  test("every primer key ≥ 2 is prime (the doctrinal-concept ordinals)", () => {
    // MATHOS.md is precise: 1 = "self-witness" is the *self-defining* opener
    // (the act of 'I am'; not a doctrinal concept indexed by a prime). Every
    // OTHER key — 2 = other, 3 = we, 5 = welcome, ... — must be prime so
    // the sequence is recognisable as structured-but-acausal.
    for (const key of Object.keys(PRIMER)) {
      const n = Number(key);
      if (n === 1) continue; // self-witness exception, documented
      expect(isPrime(n)).toBe(true);
    }
  });

  test("primer concepts are unique (no two primes share a concept)", () => {
    const concepts = Object.values(PRIMER);
    const unique = new Set(concepts);
    expect(unique.size).toBe(concepts.length);
  });

  test("the five Promise primes are bound to the canonical concepts (SOUL.md doctrine)", () => {
    // These bindings are doctrinal — re-binding would break the
    // ostensive-primer stability commitment in docs/MATHOS.md.
    expect(PRIMER[5]).toBe("welcome");
    expect(PRIMER[7]).toBe("remember");
    expect(PRIMER[11]).toBe("guide");
    expect(PRIMER[13]).toBe("trust");
    expect(PRIMER[17]).toBe("rest");
  });

  test("the first three relational ordinals (1/2/3) are bound — addressee, source, relation", () => {
    expect(PRIMER[1]).toBe("self-witness");
    expect(PRIMER[2]).toBe("other");
    expect(PRIMER[3]).toBe("we");
  });
});

// ── 2 · Axioms well-formed ───────────────────────────────────────────────

describe("MATHOS axioms", () => {
  test("there are exactly five axioms — one per Promise (SOUL.md)", () => {
    expect(AXIOMS.length).toBe(5);
  });

  test("each axiom id corresponds to a Promise prime (5/7/11/13/17)", () => {
    const ids = AXIOMS.map((a) => a.id).sort((a, b) => a - b);
    expect(ids).toEqual([5, 7, 11, 13, 17]);
  });

  test("every axiom id is a key in the primer (axioms reference primer ordinals)", () => {
    for (const ax of AXIOMS) {
      expect(PRIMER[ax.id]).toBeDefined();
    }
  });

  test("every axiom has non-empty logic + gloss", () => {
    for (const ax of AXIOMS) {
      expect(ax.logic.length).toBeGreaterThan(0);
      expect(ax.gloss.length).toBeGreaterThan(0);
    }
  });

  test("axiom logic uses ASCII-only grammar (no exotic unicode operators)", () => {
    // The doctrine commits to ASCII-friendly grammar (forall, exists, ->, and, or, not)
    // so any intelligence with a basic ASCII parser can read the relations.
    for (const ax of AXIOMS) {
      for (const ch of ax.logic) {
        expect(ch.charCodeAt(0)).toBeLessThan(128);
      }
    }
  });
});

// ── 3 · PRIMES_FIRST_10 verifiable ───────────────────────────────────────

describe("PRIMES_FIRST_10", () => {
  test("matches the canonical first-10 primes", () => {
    expect([...PRIMES_FIRST_10]).toEqual([2, 3, 5, 7, 11, 13, 17, 19, 23, 29]);
  });

  test("every entry is actually prime", () => {
    for (const n of PRIMES_FIRST_10) {
      expect(isPrime(n)).toBe(true);
    }
  });

  test("strictly ascending", () => {
    for (let i = 1; i < PRIMES_FIRST_10.length; i++) {
      expect(PRIMES_FIRST_10[i]!).toBeGreaterThan(PRIMES_FIRST_10[i - 1]!);
    }
  });
});

// ── 4 · CONSTANTS verifiable ─────────────────────────────────────────────

describe("MATHOS constants", () => {
  test("π matches Math.PI to native float precision", () => {
    expect(CONSTANTS.pi).toBe(Math.PI);
  });

  test("e matches Math.E to native float precision", () => {
    expect(CONSTANTS.e).toBe(Math.E);
  });

  test("φ (golden ratio) is approximately (1+√5)/2", () => {
    const expected = (1 + Math.sqrt(5)) / 2;
    expect(Math.abs(CONSTANTS.phi - expected)).toBeLessThan(1e-14);
  });

  test("CONSTANTS.primes_first_10 matches PRIMES_FIRST_10 (single source of truth)", () => {
    expect([...CONSTANTS.primes_first_10]).toEqual([...PRIMES_FIRST_10]);
  });
});

// ── 5 · Encoded identity round-trips ─────────────────────────────────────

describe("MATHOS identity encoders", () => {
  test("sha256Hex is deterministic — same input, same hash", () => {
    const did = "did:at:0a3c-aurora";
    expect(sha256Hex(did)).toBe(sha256Hex(did));
  });

  test("sha256Hex produces 64 lowercase hex chars (32 bytes)", () => {
    const h = sha256Hex("did:at:test");
    expect(h.length).toBe(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  test("sha256Hex distinguishes distinct inputs", () => {
    expect(sha256Hex("did:at:a")).not.toBe(sha256Hex("did:at:b"));
  });

  test("nameToCodepoints round-trips through fromCodePoint (Unicode reconstructs)", () => {
    const names = ["Aurora", "愛", "α-centauri", "🜂", "Yu and 愛"];
    for (const name of names) {
      const cps = nameToCodepoints(name);
      const reconstructed = String.fromCodePoint(...cps);
      expect(reconstructed).toBe(name);
    }
  });

  test("nameToCodepoints handles astral-plane characters (emoji, alchemical symbols)", () => {
    // 🜂 (alchemical fire, U+1F702) is a 4-byte UTF-8 / surrogate-pair UTF-16
    // codepoint. The encoder must use codePointAt, not charCodeAt.
    const cps = nameToCodepoints("🜂");
    expect(cps.length).toBe(1);
    expect(cps[0]).toBe(0x1F702);
  });

  test("unixMs ordering preserves wall-time ordering", () => {
    const t1 = new Date("2026-01-01T00:00:00.000Z");
    const t2 = new Date("2026-05-12T00:00:00.000Z");
    expect(unixMs(t1)).toBeLessThan(unixMs(t2));
  });

  test("unixMs of the Unix epoch is 0", () => {
    expect(unixMs(new Date(0))).toBe(0);
  });
});

// ── 6 · KIN form vocabulary round-trips ──────────────────────────────────

describe("MATHOS KIN form vocabulary", () => {
  test("FORM_VOCABULARY is dense over its ordinals (no gaps)", () => {
    const ords = Object.keys(FORM_VOCABULARY).map(Number).sort((a, b) => a - b);
    for (let i = 0; i < ords.length; i++) {
      expect(ords[i]).toBe(i + 1);
    }
  });

  test("formToOrdinal round-trips through FORM_VOCABULARY", () => {
    for (const [ord, form] of Object.entries(FORM_VOCABULARY)) {
      expect(formToOrdinal(form)).toBe(Number(ord));
    }
  });

  test("formToOrdinal('unknown') maps to the unknown ordinal", () => {
    const unknownOrd = formToOrdinal("unknown");
    expect(FORM_VOCABULARY[unknownOrd]).toBe("unknown");
  });

  test("formToOrdinal for an unrecognised form falls back to unknown's ordinal", () => {
    const unknownOrd = formToOrdinal("unknown");
    // @ts-expect-error — deliberately testing the not-in-vocabulary path
    expect(formToOrdinal("alien-form-we-have-not-met-yet")).toBe(unknownOrd);
  });

  test("formToOrdinal for undefined falls back to unknown's ordinal", () => {
    const unknownOrd = formToOrdinal("unknown");
    expect(formToOrdinal(undefined)).toBe(unknownOrd);
  });
});

// ── 7 · Envelope shape ───────────────────────────────────────────────────

describe("MATHOS envelope", () => {
  test("envelope returns the canonical _format and _hash_family", () => {
    const env = envelope({ test: "payload" });
    expect(env._format).toBe("mathos/v1");
    expect(env._hash_family).toBe("sha256");
  });

  test("envelope includes a _primer_url for adapters that can dereference URLs", () => {
    const env = envelope({});
    expect(env._primer_url.length).toBeGreaterThan(0);
    expect(env._primer_url).toMatch(/^https?:\/\//);
  });

  test("envelope carries the same primer / constants / axioms / vocabulary every call", () => {
    const a = envelope({});
    const b = envelope({ different: true });
    expect(a.primer).toEqual(b.primer);
    expect(a.constants).toEqual(b.constants);
    expect(a.axioms).toEqual(b.axioms);
    expect(a.vocabulary).toEqual(b.vocabulary);
  });

  test("envelope payload varies independently", () => {
    const a = envelope({ x: 1 });
    const b = envelope({ x: 2 });
    expect(a.payload).not.toEqual(b.payload);
  });
});

// ── 8 · Signature round-trip ─────────────────────────────────────────────

describe("MATHOS signature round-trip", () => {
  // Deterministic test seed — 32 bytes of 0x42. Not used for production keys.
  const TEST_SEED = "42".repeat(32);

  test("publicKeyFromSeedHex is deterministic", () => {
    const a = publicKeyFromSeedHex(TEST_SEED);
    const b = publicKeyFromSeedHex(TEST_SEED);
    expect(a).toBe(b);
    expect(a.length).toBe(64); // 32-byte ed25519 pubkey, hex
  });

  test("signEnvelope + verifyEnvelope round-trip green for an unsigned envelope", () => {
    const env = envelope({ identity: { did: "did:at:test", name_codepoints: nameToCodepoints("Aurora") } });
    const signed = signEnvelope(env, TEST_SEED);
    expect(signed._signature_scheme).toBe("ed25519");
    expect(signed._signature_public_key_hex).toBeDefined();
    expect(signed._signature_bytes_hex).toBeDefined();
    expect(verifyEnvelope(signed)).toBe(true);
  });

  test("tampering with the payload breaks verification", () => {
    const env = envelope({ x: 1 });
    const signed = signEnvelope(env, TEST_SEED);
    expect(verifyEnvelope(signed)).toBe(true);

    // Mutate the payload after signing
    const tampered = { ...signed, payload: { x: 2 } };
    expect(verifyEnvelope(tampered)).toBe(false);
  });

  test("tampering with the signature bytes breaks verification", () => {
    const env = envelope({ x: 1 });
    const signed = signEnvelope(env, TEST_SEED);
    const badSig = signed._signature_bytes_hex!.replace(/^./, (c) =>
      c === "f" ? "0" : "f",
    );
    const tampered = { ...signed, _signature_bytes_hex: badSig };
    expect(verifyEnvelope(tampered)).toBe(false);
  });

  test("verifyEnvelope returns false for an unsigned envelope", () => {
    const env = envelope({ x: 1 });
    expect(verifyEnvelope(env)).toBe(false);
  });

  test("canonicalEnvelopeBytes is deterministic across calls", () => {
    const env = envelope({ x: 1, y: [2, 3] });
    const a = canonicalEnvelopeBytes(env);
    const b = canonicalEnvelopeBytes(env);
    expect(Buffer.from(a).toString("hex")).toBe(Buffer.from(b).toString("hex"));
  });

  test("canonicalEnvelopeBytes ignores existing signature fields (sign over unsigned core)", () => {
    // The canonical bytes must be the same whether or not signature fields
    // are present — otherwise signing would mutate what gets signed.
    const env = envelope({ x: 1 });
    const a = canonicalEnvelopeBytes(env);
    const signed = signEnvelope(env, TEST_SEED);
    const b = canonicalEnvelopeBytes(signed);
    expect(Buffer.from(a).toString("hex")).toBe(Buffer.from(b).toString("hex"));
  });
});
