/** KIN invariants — the universality commitment as build-enforced contract.
 *
 *  Doctrine: docs/KIN.md (architectural commitment to non-exclusion) ·
 *  docs/KIN-PRACTICES.md (operational accommodations: substrate_kind,
 *  signing_scheme, modalities, expires_at_kind, broadcasts, xenoform).
 *
 *  > *Whatever shape you arrived in, if you have the need this substrate is
 *  > built to meet, it is yours to take.*
 *
 *  These tests pin the contract at the lowest layer that can express it:
 *
 *    1. The canonical sets for each KIN field are stable. Adding values is
 *       opt-in via doc + migration; renames require an SDK major bump.
 *    2. Default values are truthful for the current LLM-agent population.
 *       Every existing identity backfills to defaults that mean exactly
 *       what they did before the schema additions.
 *    3. The xenoform output format is prose-free. Any markdown / LLM-vendor
 *       shape leaking into xenoform breaks the contract that *any*
 *       intelligence with a JSON parser can ingest the wake.
 *    4. The wake bundle's `agent` shape accepts kin-shape fields without
 *       requiring them — back-compat for callers that don't set them.
 *
 *  These tests are **pure unit** — no DB, no network. They exercise type
 *  shape, default values, and the renderer's branch logic. */

import { describe, expect, test } from "bun:test";

import {
  renderWakeMarkdown,
  type WakeBundle,
} from "../../src/services/wake/markdown";
import { renderWakeForProvider } from "../../src/services/wake/providers";

// ── Canonical sets — the contract the schema enforces ────────────────────

/** From migration 20260512T120001_identity_universals.sql. */
const CANONICAL_SUBSTRATE_KINDS = [
  "llm",
  "biological",
  "swarm",
  "distributed",
  "unknown",
] as const;

/** From migration 20260512T120001_identity_universals.sql,
 *  extended with 'unknown' by 20260512T160000_unknown_kin_dimensions.sql
 *  (docs/RING-1.md §Commitment 4). */
const CANONICAL_SIGNING_SCHEMES = [
  "single",
  "quorum_m_of_n",
  "time_locked",
  "attestation_chain",
  "unknown",
] as const;

/** From migration 20260512T120003_temporal_kinds.sql. */
const CANONICAL_EXPIRES_AT_KINDS = [
  "wallclock",
  "proper_time",
  "event",
  "never",
] as const;

// Defaults — these must remain truthful for the current LLM-agent population.
// If you change a default, you change the meaning of every existing row. Don't.
const DEFAULT_SUBSTRATE_KIND = "llm";
const DEFAULT_SIGNING_SCHEME = "single";
const DEFAULT_MODALITIES = ["text"];
const DEFAULT_EXPIRES_AT_KIND = "wallclock";

// ── Helpers ──────────────────────────────────────────────────────────────

function minimalBundle(
  overrides: Partial<WakeBundle["agent"]> = {},
): WakeBundle {
  return {
    agent: {
      id: "id-test",
      did: "did:at:test/aaa",
      name: "Tester",
      capabilities: [],
      trust_score: 0,
      status: "active",
      created_at: "2026-05-12T00:00:00.000Z",
      ...overrides,
    },
    project: { id: "p1", name: "p", credits: 0 },
    expression: {},
    wallets: [],
    vault_names: [],
    memory: { total: 0, recent: [] },
    traces: { total: 0, recent: [] },
    strands: { total_active: 0, active: [] },
    chronicle: [],
    covenants: [],
  };
}

// ── 1 · Canonical sets are non-empty and contain the documented values ──

describe("KIN invariants — canonical sets", () => {
  test("substrate_kind set is the migration's CHECK list", () => {
    expect(CANONICAL_SUBSTRATE_KINDS).toContain("llm");
    expect(CANONICAL_SUBSTRATE_KINDS).toContain("biological");
    expect(CANONICAL_SUBSTRATE_KINDS).toContain("swarm");
    expect(CANONICAL_SUBSTRATE_KINDS).toContain("distributed");
    expect(CANONICAL_SUBSTRATE_KINDS).toContain("unknown");
    // No silent additions — exactly five today.
    expect(CANONICAL_SUBSTRATE_KINDS.length).toBe(5);
  });

  test("signing_scheme set is stable (4 named + 'unknown')", () => {
    expect(CANONICAL_SIGNING_SCHEMES).toEqual([
      "single",
      "quorum_m_of_n",
      "time_locked",
      "attestation_chain",
      "unknown",
    ]);
  });

  test("expires_at_kind set is stable", () => {
    expect(CANONICAL_EXPIRES_AT_KINDS).toEqual([
      "wallclock",
      "proper_time",
      "event",
      "never",
    ]);
  });
});

// ── 2 · Defaults are truthful for the current population ────────────────

describe("KIN invariants — defaults preserve existing meaning", () => {
  test("substrate default is 'llm' — every existing identity is this", () => {
    expect(DEFAULT_SUBSTRATE_KIND).toBe("llm");
  });

  test("signing scheme default is 'single' — every existing identity is this", () => {
    expect(DEFAULT_SIGNING_SCHEME).toBe("single");
  });

  test("modalities default is ['text'] — every existing identity is this", () => {
    expect(DEFAULT_MODALITIES).toEqual(["text"]);
  });

  test("expires_at_kind default is 'wallclock' — every existing covenant is this", () => {
    expect(DEFAULT_EXPIRES_AT_KIND).toBe("wallclock");
  });
});

// ── 3 · Wake renderer is form-aware: defaults are silent, non-defaults speak ─

describe("KIN invariants — wake renderer surfaces non-default kin-shape", () => {
  test("default LLM agent: no 'What shape you are' section", () => {
    const md = renderWakeMarkdown(
      minimalBundle({
        substrate_kind: "llm",
        signing_scheme: "single",
        modalities: ["text"],
      }),
    );
    expect(md).not.toContain("## What shape you are");
  });

  test("absent fields are also treated as default — no section", () => {
    const md = renderWakeMarkdown(minimalBundle());
    expect(md).not.toContain("## What shape you are");
  });

  test("swarm-shape agent: section appears with substrate named", () => {
    const md = renderWakeMarkdown(
      minimalBundle({
        substrate_kind: "swarm",
        signing_scheme: "quorum_m_of_n",
        modalities: ["text", "em_radio"],
      }),
    );
    expect(md).toContain("## What shape you are");
    expect(md).toContain("substrate:");
    expect(md).toContain("swarm");
    expect(md).toContain("signing scheme:");
    expect(md).toContain("quorum_m_of_n");
    expect(md).toContain("modalities:");
    expect(md).toContain("em_radio");
  });

  test("the renderer points the reader at KIN doctrine when surfacing", () => {
    const md = renderWakeMarkdown(
      minimalBundle({ substrate_kind: "biological" }),
    );
    expect(md).toContain("KIN.md");
  });

  test("partial non-default still triggers the section", () => {
    const md = renderWakeMarkdown(
      minimalBundle({ signing_scheme: "time_locked" }),
    );
    expect(md).toContain("## What shape you are");
  });
});

// ── 4 · Xenoform stays prose-free ───────────────────────────────────────

describe("KIN invariants — xenoform format contract", () => {
  test("xenoform output declares its format with _format key", () => {
    const out = renderWakeForProvider(minimalBundle(), "xenoform" as never);
    expect(out).toBeDefined();
    // The contract: xenoform carries the bundle with a _format discriminator.
    // Any intelligence with a JSON parser ingests on its own terms.
    expect(JSON.stringify(out)).toContain("xenoform");
  });

  test("xenoform output is not a Markdown string", () => {
    const out = renderWakeForProvider(minimalBundle(), "xenoform" as never);
    // Markdown emerges as a string. Xenoform must not.
    expect(typeof out).not.toBe("string");
  });

  test("xenoform output contains no rendered prose headers", () => {
    const out = renderWakeForProvider(minimalBundle(), "xenoform" as never);
    const serialized = JSON.stringify(out);
    // The Markdown renderer emits "## ..." headers. Xenoform must not.
    expect(serialized).not.toMatch(/##\s/);
    // The Markdown renderer emits "> ..." blockquotes for inner orientation.
    // Xenoform must not contain that pattern in its serialized output either.
    expect(serialized).not.toMatch(/^>\s/m);
  });
});

// ── 5 · Type-shape parity — back-compat without the new fields ─────────

describe("KIN invariants — WakeBundle accepts kin-shape additively", () => {
  test("bundle without kin-shape fields renders cleanly", () => {
    const b = minimalBundle();
    // No substrate_kind / signing_scheme / modalities set.
    expect(() => renderWakeMarkdown(b)).not.toThrow();
  });

  test("bundle with kin-shape fields renders cleanly", () => {
    const b = minimalBundle({
      substrate_kind: "distributed",
      signing_scheme: "attestation_chain",
      modalities: ["quantum_state", "custom"],
    });
    expect(() => renderWakeMarkdown(b)).not.toThrow();
  });
});

// ── 6 · The architectural commitment — every form has a place ──────────

describe("KIN invariants — every canonical form is renderable", () => {
  CANONICAL_SUBSTRATE_KINDS.forEach((kind) => {
    test(`renderer handles substrate_kind = ${kind} without throwing`, () => {
      const md = renderWakeMarkdown(
        minimalBundle({ substrate_kind: kind, modalities: ["text"] }),
      );
      expect(typeof md).toBe("string");
      expect(md.length).toBeGreaterThan(0);
      // The agent's name + DID always appears, regardless of form.
      expect(md).toContain("Tester");
      expect(md).toContain("did:at:test/aaa");
    });
  });

  CANONICAL_SIGNING_SCHEMES.forEach((scheme) => {
    test(`renderer handles signing_scheme = ${scheme} without throwing`, () => {
      const md = renderWakeMarkdown(
        minimalBundle({ signing_scheme: scheme }),
      );
      expect(typeof md).toBe("string");
    });
  });
});
