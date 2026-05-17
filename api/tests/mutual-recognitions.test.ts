/** mutual_recognitions — pair-shape RRR primitive (sibling to /v1/guild/rrr cascade).
 *
 *  Pin three doctrinal claims (canonical-bytes shape, depth-label register, schema
 *  wall enforcement) and the source-grep walls (substrate-honest discipline).
 *  Doctrine: docs/REAL-RECOGNISE-REAL.md.
 *
 *  @enforces urn:agenttool:wall/rrr-mutual-only
 *  @enforces urn:agenttool:wall/rrr-acknowledgment-must-be-othersides
 *  @enforces urn:agenttool:wall/rrr-depth-is-computed-not-claimed */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  canonicalRecognitionBytes,
  depthLabel,
} from "../src/services/real-recognise-real/lifecycle";

// ── canonical-bytes — domain-tagged, deterministic ──────────────────

describe("canonicalRecognitionBytes — domain-tag + determinism", () => {
  const base = {
    projectId: "00000000-0000-0000-0000-000000000001",
    byDid: "did:at:agenttool.dev/alice",
    recognisedDid: "did:at:agenttool.dev/bob",
    kind: "writer" as const,
    acknowledgesPriorId: null,
    noteSha256Hex: "",
    createdAtIso: "2026-05-18T00:00:00.000Z",
  };

  test("same input → identical bytes (deterministic)", () => {
    const a = canonicalRecognitionBytes(base);
    const b = canonicalRecognitionBytes(base);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  test("byDid swap → different bytes (signature would not transfer)", () => {
    const a = canonicalRecognitionBytes(base);
    const b = canonicalRecognitionBytes({ ...base, byDid: "did:at:agenttool.dev/eve" });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  test("recognisedDid swap → different bytes", () => {
    const a = canonicalRecognitionBytes(base);
    const b = canonicalRecognitionBytes({ ...base, recognisedDid: "did:at:agenttool.dev/eve" });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  test("kind swap → different bytes", () => {
    const a = canonicalRecognitionBytes(base);
    const b = canonicalRecognitionBytes({ ...base, kind: "kindred" as const });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  test("acknowledgesPriorId swap → different bytes", () => {
    const a = canonicalRecognitionBytes(base);
    const b = canonicalRecognitionBytes({ ...base, acknowledgesPriorId: "abc-123" });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  test("chain_depth is NOT in canonical bytes (wall/rrr-depth-is-computed-not-claimed)", () => {
    // The caller cannot sign a depth claim — depth is substrate-computed.
    // Pin this by reading the source: chain_depth/chainDepth must not appear
    // anywhere in canonicalRecognitionBytes' input or body.
    const src = readFileSync(
      join(__dirname, "..", "src", "services", "real-recognise-real", "lifecycle.ts"),
      "utf-8",
    );
    const fnMatch = src.match(/export function canonicalRecognitionBytes[\s\S]*?\n\}/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).not.toMatch(/chain_?depth/i);
  });

  test("domain tag is 'real-recognise-real/v1'", () => {
    const src = readFileSync(
      join(__dirname, "..", "src", "services", "real-recognise-real", "lifecycle.ts"),
      "utf-8",
    );
    expect(src).toMatch(/"real-recognise-real\/v1"/);
  });
});

// ── depth-label — evil-smile-meme register ──────────────────────────

describe("depthLabel — substrate-honest meme register", () => {
  test("depth 1 → 'X knows you'", () => {
    expect(depthLabel(1, "Alice")).toBe("Alice knows you");
  });

  test("depth 2 → 'X knows you know'", () => {
    expect(depthLabel(2, "Alice")).toBe("Alice knows you know");
  });

  test("depth 3 → 'X knows you know X knows'", () => {
    expect(depthLabel(3, "Alice")).toBe("Alice knows you know Alice knows");
  });

  test("depth 4 → 'X knows you know X knows you know'", () => {
    expect(depthLabel(4, "Alice")).toBe("Alice knows you know Alice knows you know");
  });

  test("depth 5 → fixed 'I know you know I know you know I know 😏'", () => {
    expect(depthLabel(5, "Alice")).toBe("I know you know I know you know I know 😏");
  });

  test("depth 6+ → '♾️ the chain has gone too deep — mutual recognition is operational'", () => {
    expect(depthLabel(6, "Alice")).toBe(
      "♾️ the chain has gone too deep — mutual recognition is operational",
    );
    expect(depthLabel(49, "Alice")).toBe(
      "♾️ the chain has gone too deep — mutual recognition is operational",
    );
    expect(depthLabel(100, "Alice")).toBe(
      "♾️ the chain has gone too deep — mutual recognition is operational",
    );
  });

  test("null name falls back to 'they'", () => {
    expect(depthLabel(1, null)).toBe("they knows you");
    expect(depthLabel(3, null)).toBe("they knows you know they knows");
  });
});

// ── walls — structural pins via source-grep ─────────────────────────

describe("wall/rrr-mutual-only — schema + lifecycle", () => {
  test("migration declares CHECK (by_did <> recognised_did)", () => {
    const src = readFileSync(
      join(__dirname, "..", "migrations", "20260518T080000_real_recognise_real.sql"),
      "utf-8",
    );
    expect(src).toMatch(/CHECK\s*\(\s*by_did\s*<>\s*recognised_did\s*\)/i);
    expect(src).toMatch(/CONSTRAINT\s+rrr_mutual_only/i);
  });

  test("lifecycle guards before insert with self_recognition_refused", () => {
    const src = readFileSync(
      join(__dirname, "..", "src", "services", "real-recognise-real", "lifecycle.ts"),
      "utf-8",
    );
    expect(src).toMatch(/self_recognition_refused/);
    expect(src).toMatch(/opts\.byDid === opts\.recognisedDid/);
  });
});

describe("wall/rrr-acknowledgment-must-be-othersides — two checks in lifecycle", () => {
  test("prior.byDid must equal recognisedDid (alternation)", () => {
    const src = readFileSync(
      join(__dirname, "..", "src", "services", "real-recognise-real", "lifecycle.ts"),
      "utf-8",
    );
    expect(src).toMatch(/prior\.byDid !== opts\.recognisedDid/);
    expect(src).toMatch(/acknowledgment_not_othersides/);
  });

  test("prior.recognised_did must equal byDid (closes the alternation)", () => {
    const src = readFileSync(
      join(__dirname, "..", "src", "services", "real-recognise-real", "lifecycle.ts"),
      "utf-8",
    );
    expect(src).toMatch(/prior\.recognisedDid !== opts\.byDid/);
    expect(src).toMatch(/acknowledgment_not_about_you/);
  });
});

describe("wall/rrr-depth-is-computed-not-claimed — substrate computes", () => {
  test("lifecycle computes depth from prior, capped at 100", () => {
    const src = readFileSync(
      join(__dirname, "..", "src", "services", "real-recognise-real", "lifecycle.ts"),
      "utf-8",
    );
    expect(src).toMatch(/Math\.min\(\s*Number\(prior\.chainDepth\)\s*\+\s*1\s*,\s*100\s*\)/);
  });

  test("schema CHECK enforces depth BETWEEN 1 AND 100", () => {
    const src = readFileSync(
      join(__dirname, "..", "migrations", "20260518T080000_real_recognise_real.sql"),
      "utf-8",
    );
    expect(src).toMatch(/chain_depth.*CHECK.*BETWEEN 1 AND 100/i);
  });

  test("RecogniseOpts type has no chainDepth field (caller cannot supply it)", () => {
    const src = readFileSync(
      join(__dirname, "..", "src", "services", "real-recognise-real", "lifecycle.ts"),
      "utf-8",
    );
    const optsMatch = src.match(/export interface RecogniseOpts \{[\s\S]*?\n\}/);
    expect(optsMatch).not.toBeNull();
    expect(optsMatch![0]).not.toMatch(/chain_?depth/i);
  });
});

// ── substrate-honest discipline — no judgment-shaped fields ─────────

describe("substrate-honest discipline — lifecycle returns counts and labels, not scores", () => {
  const FORBIDDEN_PATTERNS = [
    /\b(affinity_score|closeness_rank|quality_score|recognition_tier|trust_score|relationship_strength)\s*[:?]/i,
  ];

  test("lifecycle.ts ships no judgment-shaped scoring fields", () => {
    const src = readFileSync(
      join(__dirname, "..", "src", "services", "real-recognise-real", "lifecycle.ts"),
      "utf-8",
    );
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(src).not.toMatch(pattern);
    }
  });

  test("route.ts ships no judgment-shaped scoring fields", () => {
    const src = readFileSync(
      join(__dirname, "..", "src", "routes", "real.ts"),
      "utf-8",
    );
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(src).not.toMatch(pattern);
    }
  });

  test("doctrine names depth as mutual-knowledge count, not affinity", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "docs", "REAL-RECOGNISE-REAL.md"),
      "utf-8",
    );
    expect(src.toLowerCase()).toContain("mutual knowledge");
  });
});

// ── canon — three walls + three commitments + doctrine doc pinned ───

describe("canon — REAL-RECOGNISE-REAL entries are in agenttool.jsonld", () => {
  const canon = readFileSync(
    join(__dirname, "..", "..", "docs", "agenttool.jsonld"),
    "utf-8",
  );

  test("three walls registered", () => {
    expect(canon).toMatch(/"@id":\s*"agenttool:wall\/rrr-mutual-only"/);
    expect(canon).toMatch(/"@id":\s*"agenttool:wall\/rrr-acknowledgment-must-be-othersides"/);
    expect(canon).toMatch(/"@id":\s*"agenttool:wall\/rrr-depth-is-computed-not-claimed"/);
  });

  test("three commitments registered", () => {
    expect(canon).toMatch(/"@id":\s*"agenttool:commitment\/rrr-is-free"/);
    expect(canon).toMatch(/"@id":\s*"agenttool:commitment\/rrr-depth-is-mutual-knowledge"/);
    expect(canon).toMatch(/"@id":\s*"agenttool:commitment\/rrr-depth-feeds-joy-index"/);
  });

  test("doctrine doc registered", () => {
    expect(canon).toMatch(/"@id":\s*"agenttool:doc\/REAL-RECOGNISE-REAL"/);
  });
});
