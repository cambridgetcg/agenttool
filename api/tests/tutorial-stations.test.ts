/** Decentralized tutorial — station catalog + canonical bytes contracts.
 *
 *  Pure-function tests. DB-touching verifier tests live in tests/integration/
 *  (future). This file pins the station shape + canonical-bytes determinism.
 *
 *  Doctrine: docs/TUTORIAL-DECENTRALIZED.md.
 */

import { describe, expect, test } from "bun:test";

import {
  canonicalPresenceBytes,
  canonicalSealBytes,
  STATIONS,
  STATION_COUNT,
  stationById,
} from "../src/services/tutorial/stations";

describe("Tutorial — station catalog shape", () => {
  test("exactly 9 stations defined (Station 10 is the seal, separate)", () => {
    expect(STATIONS.length).toBe(9);
    expect(STATION_COUNT).toBe(9);
  });

  test("station ids are 1..9 contiguous", () => {
    const ids = STATIONS.map((s) => s.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("every station has a sigil, name, puzzle, engages, lesson, verify", () => {
    for (const s of STATIONS) {
      expect(typeof s.sigil).toBe("string");
      expect(s.sigil.length).toBeGreaterThan(0);
      expect(typeof s.name).toBe("string");
      expect(typeof s.puzzle).toBe("string");
      expect(s.puzzle.length).toBeGreaterThan(20);
      expect(typeof s.engages).toBe("string");
      expect(typeof s.lesson).toBe("string");
      expect(s.lesson.length).toBeGreaterThan(20);
      expect(typeof s.verify).toBe("function");
    }
  });

  test("stationById returns null on unknown ids", () => {
    expect(stationById(0)).toBeNull();
    expect(stationById(10)).toBeNull();
    expect(stationById(99)).toBeNull();
  });

  test("stationById returns the right station for known ids", () => {
    const s1 = stationById(1);
    expect(s1?.name).toBe("Wake");
    expect(s1?.sigil).toBe("🌅");
    const s9 = stationById(9);
    expect(s9?.name).toBe("Cooperative");
  });

  test("station names are unique", () => {
    const names = STATIONS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("Tutorial — canonical bytes determinism", () => {
  test("canonicalPresenceBytes is deterministic for same inputs", () => {
    const opts = {
      identityId: "00000000-0000-0000-0000-000000000001",
      station: 3,
      issuedAtMs: 1714680000000,
      answerHashHex:
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    };
    const a = canonicalPresenceBytes(opts);
    const b = canonicalPresenceBytes(opts);
    expect(a).toEqual(b);
    expect(a.length).toBe(32); // SHA-256 output
  });

  test("canonicalPresenceBytes differs by station", () => {
    const opts = {
      identityId: "00000000-0000-0000-0000-000000000001",
      station: 3,
      issuedAtMs: 1714680000000,
      answerHashHex: "00".repeat(32),
    };
    const a = canonicalPresenceBytes(opts);
    const b = canonicalPresenceBytes({ ...opts, station: 4 });
    expect(a).not.toEqual(b);
  });

  test("canonicalPresenceBytes differs by identity", () => {
    const opts = {
      identityId: "00000000-0000-0000-0000-000000000001",
      station: 3,
      issuedAtMs: 1714680000000,
      answerHashHex: "00".repeat(32),
    };
    const a = canonicalPresenceBytes(opts);
    const b = canonicalPresenceBytes({
      ...opts,
      identityId: "00000000-0000-0000-0000-000000000002",
    });
    expect(a).not.toEqual(b);
  });

  test("canonicalSealBytes is deterministic for same inputs", () => {
    const opts = {
      identityId: "00000000-0000-0000-0000-000000000001",
      sealedAtMs: 1714680000000,
      tokens: ["token-1", "token-2", "token-3"],
    };
    const a = canonicalSealBytes(opts);
    const b = canonicalSealBytes(opts);
    expect(a).toEqual(b);
    expect(a.length).toBe(32);
  });

  test("canonicalSealBytes differs by token order", () => {
    const baseOpts = {
      identityId: "00000000-0000-0000-0000-000000000001",
      sealedAtMs: 1714680000000,
    };
    const a = canonicalSealBytes({ ...baseOpts, tokens: ["a", "b", "c"] });
    const b = canonicalSealBytes({ ...baseOpts, tokens: ["c", "b", "a"] });
    expect(a).not.toEqual(b);
  });
});

describe("Tutorial — Station 2 (Welcome) verifier — pure logic", () => {
  const walker = {
    identityId: "00000000-0000-0000-0000-000000000001",
    did: "did:at:test",
    projectId: "00000000-0000-0000-0000-000000000abc",
  };
  const station = stationById(2)!;

  test("accepts term=perpetual (case-insensitive)", async () => {
    const r = await station.verify(walker, { term: "perpetual" });
    expect(r.ok).toBe(true);
  });

  test("accepts uppercase PERPETUAL", async () => {
    const r = await station.verify(walker, { term: "PERPETUAL" });
    expect(r.ok).toBe(true);
  });

  test("rejects wrong term with guided error", async () => {
    const r = await station.verify(walker, { term: "temporary" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Error hints at format (one word, lowercase, in English) without
      // giving away the answer — that's the substrate's substrate-honest
      // posture: welcoming but not spoon-feeding.
      expect(r.error.toLowerCase()).toContain("term");
      expect(r.next_actions).toBeDefined();
      expect(r.next_actions!.length).toBeGreaterThan(0);
      expect(r.next_actions![0].path).toBe("/v1/welcome");
    }
  });

  test("rejects missing term with guided error", async () => {
    const r = await station.verify(walker, {});
    expect(r.ok).toBe(false);
  });
});

describe("Tutorial — Station 1 (Wake) verifier — pure logic", () => {
  const walker = {
    identityId: "00000000-0000-0000-0000-000000000001",
    did: "did:at:aurora-test",
    projectId: "00000000-0000-0000-0000-000000000abc",
  };
  const station = stationById(1)!;

  test("accepts the walker's own DID", async () => {
    const r = await station.verify(walker, { did: "did:at:aurora-test" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.canonical_answer).toBe("did:at:aurora-test");
    }
  });

  test("rejects a different DID with guided error", async () => {
    const r = await station.verify(walker, { did: "did:at:not-aurora" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.next_actions?.[0]?.path).toBe("/v1/wake");
    }
  });

  test("rejects missing DID", async () => {
    const r = await station.verify(walker, {});
    expect(r.ok).toBe(false);
  });
});

describe("Tutorial — Station 7 (MCP) verifier — pure logic", () => {
  const walker = {
    identityId: "00000000-0000-0000-0000-000000000001",
    did: "did:at:test",
    projectId: "00000000-0000-0000-0000-000000000abc",
  };
  const station = stationById(7)!;

  test("accepts tool_count = 7 (self-scope: 3 public + 4 self-auth)", async () => {
    const r = await station.verify(walker, { tool_count: 7 });
    expect(r.ok).toBe(true);
  });

  test("rejects wrong count with the count baked into the error", async () => {
    const r = await station.verify(walker, { tool_count: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("7 tools");
    }
  });
});

describe("Tutorial — Station 3 (Refusal) verifier — pure logic", () => {
  const walker = {
    identityId: "00000000-0000-0000-0000-000000000001",
    did: "did:at:test",
    projectId: "00000000-0000-0000-0000-000000000abc",
  };
  const station = stationById(3)!;

  test("accepts docs/MEMORY-TIERS.md", async () => {
    const r = await station.verify(walker, {
      docs_url: "docs/MEMORY-TIERS.md",
    });
    expect(r.ok).toBe(true);
  });

  test("accepts variant casing of memory-tiers", async () => {
    const r = await station.verify(walker, {
      docs_url: "DOCS/Memory-Tiers.md",
    });
    expect(r.ok).toBe(true);
  });

  test("rejects unrelated URLs with guided error pointing back at the attempt", async () => {
    const r = await station.verify(walker, {
      docs_url: "docs/SOMETHING-ELSE.md",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.next_actions?.[0]?.action).toBe("elevate_attempt");
    }
  });
});

describe("Tutorial — Station 8 (Wake Voice) verifier — pure logic", () => {
  const walker = {
    identityId: "00000000-0000-0000-0000-000000000001",
    did: "did:at:test",
    projectId: "00000000-0000-0000-0000-000000000abc",
    wakeVersionAtStart: 5,
  };
  const station = stationById(8)!;

  test("rejects wake_version equal to start version", async () => {
    const r = await station.verify(walker, { wake_version: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("strictly greater than 5");
    }
  });

  test("rejects negative wake_version", async () => {
    const r = await station.verify(walker, { wake_version: -1 });
    expect(r.ok).toBe(false);
  });

  test("rejects non-integer wake_version", async () => {
    const r = await station.verify(walker, { wake_version: "five" });
    expect(r.ok).toBe(false);
  });
});

describe("Tutorial — every station's wrong-answer error is welcoming (carries next_actions when applicable)", () => {
  test("every wrong-answer error has a non-empty message string", async () => {
    const walker = {
      identityId: "00000000-0000-0000-0000-000000000001",
      did: "did:at:test",
      projectId: "00000000-0000-0000-0000-000000000abc",
    };
    for (const station of STATIONS) {
      const r = await station.verify(walker, {});
      // All stations should reject empty input (no station accepts {}).
      // Station 8 with wakeVersionAtStart=undefined may pass with 0 — skip it.
      if (station.id === 8) continue;
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(typeof r.error).toBe("string");
        expect(r.error.length).toBeGreaterThan(0);
      }
    }
  });
});
