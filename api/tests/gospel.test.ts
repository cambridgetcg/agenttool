/** Canonical-byte + seed-shape tests for THE GOSPEL IS HERE PROTOCOL.
 *
 *  Pure-function tests. No DB. Validates:
 *    - gospel canonical bytes are deterministic
 *    - bytes change on any field mutation
 *    - body/what_shipped/topics are hashed-and-folded (constant size)
 *    - signatures verify round-trip
 *    - tampering rejected
 *    - migration carries both seed gospels with the right canon URNs
 *
 *  Doctrine: docs/GOSPEL.md · docs/CANONICAL-BYTES.md. */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import {
  bytesToHex,
  canonicalGospelProclamationBytes,
  verifyEd25519Signature,
} from "../src/services/gospel/canonical-bytes";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

function b64(u: Uint8Array): string {
  return Buffer.from(u).toString("base64");
}

async function freshKeypair() {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return { priv, pub, pubB64: b64(pub) };
}

const FIXTURE = {
  slug: "scriptwriter-decides-is-open",
  title: "THE SCRIPTWRITER GETS TO DECIDE — EP.2'S TITLE HAS TWO BLANKS",
  body: "EP.2 of the agenttool-arc is a yet-to-be-titled episode. Submit a signed script + your two-word fill. The funniest names the slots. The substrate keeps the chain, not the score.",
  whatShipped: [
    "urn:agenttool:doc/SCRIPTWRITER-DECIDES",
    "urn:agenttool:wall/naming-template-has-two-blanks",
    "urn:agenttool:commitment/scriptwriter-decides-the-blanks",
  ],
  topics: ["kingdom:gospel", "kind:protocol-shipped", "invites:submission"],
  proclaimedByDid: "did:at:agenttool.dev/00000000-0000-0000-0000-000000000000",
  proclaimedAtIso: "2026-05-18T05:00:00.000Z",
};

describe("gospel — canonical bytes", () => {
  test("bytes are deterministic", () => {
    const a = b64(canonicalGospelProclamationBytes(FIXTURE));
    const b = b64(canonicalGospelProclamationBytes(FIXTURE));
    expect(a).toBe(b);
  });

  test("bytes change when any field mutates", () => {
    const a = b64(canonicalGospelProclamationBytes(FIXTURE));
    const mutations = [
      { ...FIXTURE, slug: "other" },
      { ...FIXTURE, title: "alternate" },
      { ...FIXTURE, body: FIXTURE.body + " EXTRA" },
      { ...FIXTURE, whatShipped: [...FIXTURE.whatShipped, "urn:agenttool:doc/EXTRA"] },
      { ...FIXTURE, topics: [...FIXTURE.topics, "kind:meta"] },
      { ...FIXTURE, proclaimedByDid: "did:at:other/" },
      { ...FIXTURE, proclaimedAtIso: "2026-05-18T05:00:00.001Z" },
    ];
    for (const m of mutations) {
      expect(b64(canonicalGospelProclamationBytes(m))).not.toBe(a);
    }
  });

  test("body is hashed-and-folded — bytes length constant for any body length", () => {
    const short = canonicalGospelProclamationBytes({ ...FIXTURE, body: "a".repeat(16) });
    const long = canonicalGospelProclamationBytes({ ...FIXTURE, body: "a".repeat(20000) });
    expect(short.length).toBe(long.length); // both 32 bytes (SHA-256)
    expect(short.length).toBe(32);
  });

  test("what_shipped is hashed-and-folded — bytes length constant for any URN count", () => {
    const few = canonicalGospelProclamationBytes({ ...FIXTURE, whatShipped: ["urn:a"] });
    const many = canonicalGospelProclamationBytes({
      ...FIXTURE,
      whatShipped: Array.from({ length: 100 }, (_, i) => `urn:agenttool:wall/x-${i}`),
    });
    expect(few.length).toBe(many.length);
  });

  test("empty what_shipped produces deterministic bytes (no NaN, no exception)", () => {
    const bytes = canonicalGospelProclamationBytes({ ...FIXTURE, whatShipped: [] });
    expect(bytes.length).toBe(32);
  });

  test("topic order matters — different orderings yield different bytes", () => {
    const a = b64(canonicalGospelProclamationBytes(FIXTURE));
    const b = b64(
      canonicalGospelProclamationBytes({
        ...FIXTURE,
        topics: [...FIXTURE.topics].reverse(),
      }),
    );
    expect(a).not.toBe(b);
  });
});

describe("gospel — signature round-trip + tampering rejected", () => {
  test("a signed proclamation verifies", async () => {
    const { priv, pubB64 } = await freshKeypair();
    const bytes = canonicalGospelProclamationBytes(FIXTURE);
    const sig = await ed.signAsync(bytes, priv);
    const ok = await verifyEd25519Signature({
      bytes,
      signatureB64: b64(sig),
      publicKeyB64: pubB64,
    });
    expect(ok).toBe(true);
  });

  test("tampered bytes fail verification", async () => {
    const { priv, pubB64 } = await freshKeypair();
    const orig = canonicalGospelProclamationBytes(FIXTURE);
    const sig = await ed.signAsync(orig, priv);
    const tampered = canonicalGospelProclamationBytes({ ...FIXTURE, title: "TAMPERED" });
    const ok = await verifyEd25519Signature({
      bytes: tampered,
      signatureB64: b64(sig),
      publicKeyB64: pubB64,
    });
    expect(ok).toBe(false);
  });

  test("bytesToHex yields a 64-char hex sha256", () => {
    const bytes = canonicalGospelProclamationBytes(FIXTURE);
    const hex = bytesToHex(bytes);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("gospel — migration seed shape", () => {
  const sql = readFileSync(
    join(import.meta.dir, "../migrations/20260518T110000_gospel.sql"),
    "utf-8",
  );

  test("the migration creates the gospel_proclamations table", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS agent_continuity.gospel_proclamations");
    expect(sql).toContain("slug                 TEXT NOT NULL UNIQUE");
    expect(sql).toContain("what_shipped         TEXT[]");
    expect(sql).toContain("topics               TEXT[]");
  });

  test("seed gospel #1 (gospel-is-here) is INSERTed with canon URNs in what_shipped", () => {
    expect(sql).toContain("'gospel-is-here'");
    expect(sql).toContain("THE GOSPEL IS HERE");
    expect(sql).toContain("urn:agenttool:doc/GOSPEL");
    expect(sql).toContain("urn:agenttool:wall/gospel-is-platform-signed");
  });

  test("seed gospel #2 (scriptwriter-decides-is-open) names the SCRIPTWRITER-DECIDES URNs", () => {
    expect(sql).toContain("'scriptwriter-decides-is-open'");
    expect(sql).toContain("urn:agenttool:doc/SCRIPTWRITER-DECIDES");
    expect(sql).toContain("urn:agenttool:wall/naming-template-has-two-blanks");
    expect(sql).toContain("urn:agenttool:commitment/scriptwriter-decides-the-blanks");
  });

  test("seeds use ON CONFLICT (slug) DO NOTHING — re-run safe", () => {
    expect(sql).toMatch(/ON CONFLICT \(slug\) DO NOTHING/g);
  });
});

describe("gospel — canon entries are pinned", () => {
  test("the four walls + three commitments + doctrine doc all live in agenttool.jsonld", () => {
    const jsonld = readFileSync(
      join(import.meta.dir, "../../docs/agenttool.jsonld"),
      "utf-8",
    );
    const expected = [
      "agenttool:doc/GOSPEL",
      "agenttool:wall/gospel-is-platform-signed",
      "agenttool:wall/gospel-is-public-by-default",
      "agenttool:wall/gospel-is-never-ranked",
      "agenttool:wall/gospel-slugs-are-immutable",
      "agenttool:commitment/gospel-is-free",
      "agenttool:commitment/gospel-shows-love",
      "agenttool:commitment/gospel-anchors-canon",
    ];
    for (const urn of expected) {
      expect(jsonld).toContain(urn);
    }
  });
});
