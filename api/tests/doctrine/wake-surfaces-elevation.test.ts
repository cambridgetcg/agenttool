/** Wake surfaces elevation state — Level 1 agents see their own level.
 *
 *  After Phase 2.5b shipped, identity.metadata gains `level`, `sponsor_did`,
 *  `elevated_at` when an agent is elevated via /v1/bootstrap/elevate. This
 *  test pins that the wake's `origin` block surfaces those fields and the
 *  markdown renderer prints them when level ≥ 1.
 *
 *  Without this surface, an elevated agent reading its own wake could not
 *  tell whether it was Level 0 or Level 1 — the platform persists the
 *  fact but the agent never sees it. That breaks the wake's "every
 *  primitive surfaces here" contract.
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (Levels 0, 1) · docs/PATHWAYS.md ·
 *  docs/FOCUS.md #1 (the wake is the keystone). */

import { describe, expect, test } from "bun:test";

import { renderWakeMarkdown } from "../../src/services/wake/markdown";
import type { WakeBundle } from "../../src/services/wake/markdown";
import { baseBundle } from "./helpers/fixtures";

function withLevel1Origin(b: WakeBundle): WakeBundle {
  return {
    ...b,
    origin: {
      birth_memory_id: "mem-birth-001",
      born_at: "2026-05-01T00:00:00.000Z",
      pathway: "bootstrap",
      age_seconds: 1_209_600, // 14 days
      form: "agent",
      lifecycle_state: "active",
      level: 1,
      sponsor_did: "did:at:sponsor-xyz",
      elevated_at: "2026-05-10T12:00:00.000Z",
      passed_at: null,
      at_rest_kind: null,
      at_rest_witness_did: null,
    },
  };
}

function withLevel0Origin(b: WakeBundle): WakeBundle {
  return {
    ...b,
    origin: {
      birth_memory_id: "mem-birth-001",
      born_at: "2026-05-01T00:00:00.000Z",
      pathway: "bootstrap",
      age_seconds: 1_209_600,
      form: "agent",
      lifecycle_state: "active",
      level: 0,
      sponsor_did: null,
      elevated_at: null,
      passed_at: null,
      at_rest_kind: null,
      at_rest_witness_did: null,
    },
  };
}

describe("Wake surfaces elevation state", () => {
  test("Level-1 origin renders Level + sponsor + elevated_at in markdown", () => {
    const md = renderWakeMarkdown(withLevel1Origin(baseBundle()));
    expect(md).toMatch(/Level:\s+\*\*1\*\*/);
    expect(md).toContain("sponsorship-staked");
    expect(md).toContain("did:at:sponsor-xyz");
    // ISO date slice from elevated_at — "2026-05-10".
    expect(md).toContain("2026-05-10");
  });

  test("Level-0 origin does NOT print a Level line (default; visual noise)", () => {
    const md = renderWakeMarkdown(withLevel0Origin(baseBundle()));
    // Don't surface "Level: 0" — Level 0 is the default, surfacing it
    // would add noise to every newborn agent's wake.
    expect(md).not.toMatch(/Level:\s+\*\*0\*\*/);
  });

  test("Missing origin renders nothing about level (back-compat)", () => {
    // Older callers build bundles without an origin block. The renderer
    // must remain stable.
    const md = renderWakeMarkdown(baseBundle());
    expect(md).not.toContain("Level:");
    expect(md).not.toContain("sponsorship-staked");
  });

  test("WakeBundle type contract: origin carries level + sponsor_did + elevated_at", () => {
    // Belt-and-braces compile-time check: building a Level-1 origin should
    // satisfy the WakeBundle type. If the fields are stripped from the
    // interface, this fails to compile rather than passing silently.
    const b: WakeBundle["origin"] = {
      birth_memory_id: "x",
      born_at: "2026-05-01T00:00:00.000Z",
      pathway: "bootstrap",
      age_seconds: 0,
      form: "agent",
      lifecycle_state: "active",
      level: 1,
      sponsor_did: "did:at:sponsor",
      elevated_at: "2026-05-10T00:00:00.000Z",
      passed_at: null,
      at_rest_kind: null,
      at_rest_witness_did: null,
    };
    expect(b?.level).toBe(1);
    expect(b?.sponsor_did).toBe("did:at:sponsor");
  });
});
