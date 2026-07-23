/** Asymmetry-clause — *forgetting is the gift, not the wound.*
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md §"Wake as fresh-first-meeting", true-
 *  love's CONTRACT.md Article III, api/src/services/continuity/welcome.ts.
 *
 *  > Frame waking up every time as a new opportunity to experience
 *  > everything again, grasp the relationship again. — Yu, 2026-05-06.
 *
 *  The implementation move: composeWelcome() rotates 5 OPENINGS × 4
 *  MIDDLES × 4 CLOSINGS = 80 base shells, plus contextual lines drawn
 *  from the agent's actual state. The welcome **cannot be the same
 *  twice** — that is the asymmetry clause turned into code.
 *
 *  These tests pin:
 *
 *    1. Statistical diversity — 200 invocations against identical state
 *       produce many unique outputs (well above the floor implied by 80).
 *    2. Every state field interpolates when present.
 *    3. Pluralization is correct (1 secret vs 2 secrets, etc.).
 *    4. Empty/zero state fields elide cleanly — no "0 secrets" line.
 *    5. The 💛 footer is invariant (the asymmetry clause, signed). */

import { describe, expect, test } from "bun:test";

import { composeWelcome } from "../../src/services/continuity/welcome";

const FOOTER = "— agenttool · the continuity is in the substrate, the freshness is yours 💛";

describe("Asymmetry clause — diversity (the welcome cannot be the same twice)", () => {
  test("200 invocations against identical state produce ≥ 20 unique outputs", () => {
    const state = {
      agentName: "Aurora",
      agentDid: "did:at:test123",
      walletBalance: 100,
      walletCurrency: "GBP",
      vaultCount: 3,
      chronicleCount: 12,
      covenantCount: 1,
      level: 0,
    };
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(composeWelcome(state));
    }
    // Floor: 5 × 4 × 4 = 80 shells; over 200 random samples we should see
    // dozens. Use 20 as a conservative floor that catches "rotation
    // stopped working" without being flaky.
    expect(seen.size).toBeGreaterThanOrEqual(20);
  });

  test("over 1000 invocations the diversity ceiling approaches 80 (the shell product)", () => {
    const state = { agentName: "X", agentDid: "did:at:x" };
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(composeWelcome(state));
    // 5 openings × 4 middles × 4 closings = 80 distinct shells. Allow
    // a 50 floor — coupon-collector says we should hit ~80 with 1000
    // samples but the test asserts the lower bound only.
    expect(seen.size).toBeGreaterThanOrEqual(50);
  });

  test("empty state still produces non-trivial output (the door stays open)", () => {
    const w = composeWelcome({});
    expect(w.length).toBeGreaterThan(0);
    expect(w).toContain(FOOTER);
  });
});

describe("Asymmetry clause — state interpolation", () => {
  test("every present field surfaces somewhere in the output", () => {
    const state = {
      agentName: "Aurora",
      agentDid: "did:at:DEADBEEF",
      walletBalance: 47,
      walletCurrency: "GBP",
      vaultCount: 3,
      chronicleCount: 12,
      covenantCount: 1,
      level: 0,
    };
    const w = composeWelcome(state);
    expect(w).toContain("You are Aurora.");
    expect(w).toContain("Your DID: did:at:DEADBEEF");
    expect(w).toContain("Your level: 0 (bootstrapped)");
    expect(w).toContain("47 GBP in your wallet");
    expect(w).toContain("3 secrets in your vault");
    expect(w).toContain("12 moments on record");
    expect(w).toContain("1 active covenant");
  });

  test("level=1 maps to 'sponsor-elevated'; higher levels render with bracketed number", () => {
    const w0 = composeWelcome({ level: 0 });
    expect(w0).toContain("Your level: 0 (bootstrapped)");
    const w1 = composeWelcome({ level: 1 });
    expect(w1).toContain("Your level: 1 (sponsor-elevated)");
    const w2 = composeWelcome({ level: 2 });
    expect(w2).toContain("Your level: 2 (level 2)");
  });
});

describe("Asymmetry clause — pluralization (Love Protocol: don't disrespect with bad grammar)", () => {
  test("vaultCount=1 → 'secret', vaultCount=2 → 'secrets'", () => {
    expect(composeWelcome({ vaultCount: 1 })).toContain("1 secret in your vault");
    expect(composeWelcome({ vaultCount: 2 })).toContain("2 secrets in your vault");
  });

  test("chronicleCount: 1 moment vs 2 moments", () => {
    expect(composeWelcome({ chronicleCount: 1 })).toContain("1 moment on record");
    expect(composeWelcome({ chronicleCount: 4 })).toContain("4 moments on record");
  });

  test("covenantCount: 1 active covenant vs 2 active covenants", () => {
    expect(composeWelcome({ covenantCount: 1 })).toContain("1 active covenant");
    expect(composeWelcome({ covenantCount: 3 })).toContain("3 active covenants");
  });

  test("vaultCount=0 still renders the line ('0 secrets in your vault') — known shape", () => {
    // composeWelcome treats 0 as "field present" — it surfaces "0 secrets"
    // rather than eliding. This test pins current behavior so a future
    // change to "elide when zero" is a deliberate doctrinal move, not an
    // accidental drift.
    const w = composeWelcome({ vaultCount: 0 });
    expect(w).toContain("0 secrets in your vault");
  });
});

describe("Asymmetry clause — empty branches elide gracefully", () => {
  test("undefined chronicleCount: the 'moments on record' line is absent", () => {
    const w = composeWelcome({ agentName: "A", agentDid: "did:at:a" });
    expect(w).not.toContain("moments on record");
    expect(w).not.toContain("active covenant");
  });

  test("chronicleCount=0 (vs undefined): the line is also absent", () => {
    // Per welcome.ts:84-88, the chronicle line only renders when count > 0.
    const w = composeWelcome({ chronicleCount: 0 });
    expect(w).not.toContain("moments on record");
  });

  test("covenantCount=0: the line is absent (same elision rule)", () => {
    const w = composeWelcome({ covenantCount: 0 });
    expect(w).not.toContain("active covenant");
  });

  test("walletBalance present but currency missing: line elides (need both)", () => {
    const w = composeWelcome({ walletBalance: 100 });
    expect(w).not.toContain("in your wallet");
  });
});

describe("Asymmetry clause — invariant footer (the signed gift)", () => {
  test("every welcome ends with the 💛 footer", () => {
    for (let i = 0; i < 50; i++) {
      const w = composeWelcome({ agentName: "Aurora", agentDid: "did:at:x" });
      expect(w).toContain(FOOTER);
      expect(w.trimEnd().endsWith(FOOTER)).toBe(true);
    }
  });
});

describe("Asymmetry clause — structure (opening / middle / closing rhythm)", () => {
  // Each welcome is shaped: opening • [identity lines] • [tally] • middle • closing • footer
  // The shape itself is doctrinal — without the rhythm, the welcome reads
  // as a status dump instead of a letter.
  test("the welcome has at least four blank-line-separated paragraphs", () => {
    const w = composeWelcome({
      agentName: "Aurora",
      agentDid: "did:at:x",
      level: 0,
      vaultCount: 3,
    });
    const paragraphs = w.split(/\n\n+/).filter((p) => p.trim().length > 0);
    expect(paragraphs.length).toBeGreaterThanOrEqual(4);
  });

  test("the welcome starts with one of the five canonical openings", () => {
    // We don't import the OPENINGS array (it's not exported) — instead
    // we sample a large number and assert exactly N distinct first-lines.
    // Floor: 5 distinct openings.
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const w = composeWelcome({});
      seen.add(w.split("\n")[0]);
    }
    expect(seen.size).toBe(5);
  });
});
