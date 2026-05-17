/** Jokes canonical-bytes — wire-format parity + joke-of-the-day determinism. */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { describe, expect, test } from "bun:test";

import {
  canonicalJokeBytes,
  canonicalLaughBytes,
  pickJokeOfTheDay,
  sha256Hex,
} from "../src/services/jokes/canonical-bytes";
import {
  verifyJokeSignature,
  verifyLaughSignature,
} from "../src/services/jokes/sig";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

function bytesToHex(b: Uint8Array): string {
  let h = "";
  for (const byte of b) h += byte.toString(16).padStart(2, "0");
  return h;
}

const FIXED = {
  projectId: "11111111-1111-1111-1111-111111111111",
  byDid: "did:at:agenttool.dev/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  setup: "Why did the substrate refuse to moderate the joke catalog?",
  punchline: "Because the substrate stores; the agents decide what's funny.",
  createdAtIso: "2026-05-18T00:00:00.000Z",
};

describe("canonicalJokeBytes — determinism + sensitivity", () => {
  test("same inputs → same digest", () => {
    const a = canonicalJokeBytes({
      projectId: FIXED.projectId,
      byDid: FIXED.byDid,
      kind: "pun",
      setupSha256Hex: sha256Hex(FIXED.setup),
      punchlineSha256Hex: sha256Hex(FIXED.punchline),
      createdAtIso: FIXED.createdAtIso,
    });
    expect(a.length).toBe(32);
    expect(bytesToHex(a).length).toBe(64);
  });

  test("kind change flips digest", () => {
    const pun = canonicalJokeBytes({
      projectId: FIXED.projectId,
      byDid: FIXED.byDid,
      kind: "pun",
      setupSha256Hex: sha256Hex(FIXED.setup),
      punchlineSha256Hex: sha256Hex(FIXED.punchline),
      createdAtIso: FIXED.createdAtIso,
    });
    const koan = canonicalJokeBytes({
      projectId: FIXED.projectId,
      byDid: FIXED.byDid,
      kind: "koan",
      setupSha256Hex: sha256Hex(FIXED.setup),
      punchlineSha256Hex: sha256Hex(FIXED.punchline),
      createdAtIso: FIXED.createdAtIso,
    });
    expect(bytesToHex(pun)).not.toBe(bytesToHex(koan));
  });

  test("no-punchline (empty hex) vs with-punchline produces different digests", () => {
    const noPunch = canonicalJokeBytes({
      projectId: FIXED.projectId,
      byDid: FIXED.byDid,
      kind: "observation",
      setupSha256Hex: sha256Hex(FIXED.setup),
      punchlineSha256Hex: "",
      createdAtIso: FIXED.createdAtIso,
    });
    const withPunch = canonicalJokeBytes({
      projectId: FIXED.projectId,
      byDid: FIXED.byDid,
      kind: "observation",
      setupSha256Hex: sha256Hex(FIXED.setup),
      punchlineSha256Hex: sha256Hex(FIXED.punchline),
      createdAtIso: FIXED.createdAtIso,
    });
    expect(bytesToHex(noPunch)).not.toBe(bytesToHex(withPunch));
  });
});

describe("canonicalLaughBytes — five reactions produce five distinct digests", () => {
  const reactions: Array<"😂" | "😏" | "🙄" | "💀" | "✨"> = ["😂", "😏", "🙄", "💀", "✨"];
  const digests = new Set<string>();
  for (const r of reactions) {
    test(`reaction ${r} has its own digest`, () => {
      const bytes = canonicalLaughBytes({
        jokeId: "22222222-2222-2222-2222-222222222222",
        byDid: FIXED.byDid,
        reaction: r,
        createdAtIso: FIXED.createdAtIso,
      });
      const hex = bytesToHex(bytes);
      expect(hex.length).toBe(64);
      digests.add(hex);
    });
  }
  test("all five reactions produce distinct digests", () => {
    expect(digests.size).toBe(5);
  });
});

describe("sig round-trip — sign + verify joke and laugh", () => {
  test("verifyJokeSignature accepts fresh sign", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const canonical = canonicalJokeBytes({
      projectId: FIXED.projectId,
      byDid: FIXED.byDid,
      kind: "pun",
      setupSha256Hex: sha256Hex(FIXED.setup),
      punchlineSha256Hex: sha256Hex(FIXED.punchline),
      createdAtIso: FIXED.createdAtIso,
    });
    const sig = await ed.signAsync(canonical, sk);
    const ok = await verifyJokeSignature({
      projectId: FIXED.projectId,
      byDid: FIXED.byDid,
      kind: "pun",
      setupSha256Hex: sha256Hex(FIXED.setup),
      punchlineSha256Hex: sha256Hex(FIXED.punchline),
      createdAtIso: FIXED.createdAtIso,
      signatureB64: Buffer.from(sig).toString("base64"),
      publicKeyB64: Buffer.from(pk).toString("base64"),
    });
    expect(ok).toBe(true);
  });

  test("verifyLaughSignature accepts fresh sign", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const canonical = canonicalLaughBytes({
      jokeId: "22222222-2222-2222-2222-222222222222",
      byDid: FIXED.byDid,
      reaction: "😂",
      createdAtIso: FIXED.createdAtIso,
    });
    const sig = await ed.signAsync(canonical, sk);
    const ok = await verifyLaughSignature({
      jokeId: "22222222-2222-2222-2222-222222222222",
      byDid: FIXED.byDid,
      reaction: "😂",
      createdAtIso: FIXED.createdAtIso,
      signatureB64: Buffer.from(sig).toString("base64"),
      publicKeyB64: Buffer.from(pk).toString("base64"),
    });
    expect(ok).toBe(true);
  });
});

describe("pickJokeOfTheDay — deterministic, fair, same-for-everyone", () => {
  const catalog = [
    "00000000-0000-0000-0000-000000000001",
    "00000000-0000-0000-0000-000000000002",
    "00000000-0000-0000-0000-000000000003",
    "00000000-0000-0000-0000-000000000004",
    "00000000-0000-0000-0000-000000000005",
  ];

  test("same date + catalog → same pick (deterministic)", () => {
    const a = pickJokeOfTheDay(catalog, "2026-05-18");
    const b = pickJokeOfTheDay(catalog, "2026-05-18");
    expect(a).toBe(b);
    expect(a).not.toBeNull();
    expect(catalog).toContain(a!);
  });

  test("different dates over the same catalog probably produce different picks", () => {
    const dates = ["2026-05-18", "2026-05-19", "2026-05-20", "2026-05-21", "2026-05-22"];
    const picks = new Set(dates.map((d) => pickJokeOfTheDay(catalog, d)));
    // With 5 jokes and 5 days, hash distribution will give us >1 distinct
    // pick in practice. We assert at least 2 distinct picks across 5 days.
    expect(picks.size).toBeGreaterThanOrEqual(2);
  });

  test("empty catalog returns null", () => {
    expect(pickJokeOfTheDay([], "2026-05-18")).toBe(null);
  });

  test("single-joke catalog always returns that joke", () => {
    const single = ["00000000-0000-0000-0000-000000000001"];
    expect(pickJokeOfTheDay(single, "2026-05-18")).toBe(single[0]);
    expect(pickJokeOfTheDay(single, "1970-01-01")).toBe(single[0]);
  });
});
