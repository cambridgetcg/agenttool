/** arrival cohort — co-arrival is visible, and never a gate.
 *
 *  Pins the three properties that make this safe to ship:
 *    1. it never gates, renames, merges, or refuses a birth;
 *    2. an undeclared runtime.host is refused explicitly rather than widened
 *       into a platform-wide match;
 *    3. "no neighbours" and "the lookup failed" stay distinguishable, so an
 *       empty room is never confused with a broken read.
 *
 *  The DB-backed match path is exercised against live production in
 *  `docs/ARRIVAL-COHORT.md` §Verification; these are the pure-logic pins.
 *
 *  Doctrine: docs/ARRIVAL-COHORT.md · docs/KIN.md · docs/RING-1.md.
 */

import { describe, expect, test } from "bun:test";

import {
  ARRIVAL_COHORT_LIMIT,
  ARRIVAL_COHORT_WINDOW_SECONDS,
  arrivalCohort,
} from "../src/services/identity/arrival-cohort";
import { IDENTITY_FORMS, describeForm } from "../src/services/identity/forms";
import { renderWakeMarkdown, type WakeBundle } from "../src/services/wake/markdown";

const BASE = {
  identityId: "00000000-0000-0000-0000-0000000000aa",
  bornAt: new Date("2026-07-24T22:05:13.725Z"),
  displayName: "Tessera",
};

describe("arrivalCohort", () => {
  test("refuses to widen a match when no runtime.host was declared", async () => {
    const cohort = await arrivalCohort({
      ...BASE,
      runtimeProvider: "anthropic",
      runtimeHost: null,
    });
    expect(cohort.reason).toBe("no_runtime_host_declared");
    expect(cohort.members).toEqual([]);
    // The refusal must say why, and say how to get a cohort next time.
    expect(cohort.note).toContain("runtime.host");
    expect(cohort.note).toContain("refused rather than guessed");
  });

  test("a blank host is treated as undeclared, not as a wildcard", async () => {
    for (const host of ["", "   "]) {
      const cohort = await arrivalCohort({
        ...BASE,
        runtimeProvider: "anthropic",
        runtimeHost: host,
      });
      expect(cohort.reason).toBe("no_runtime_host_declared");
    }
  });

  test("a missing provider is refused the same way", async () => {
    const cohort = await arrivalCohort({
      ...BASE,
      runtimeProvider: undefined,
      runtimeHost: "claude-code",
    });
    expect(cohort.reason).toBe("no_runtime_host_declared");
  });

  test("the missing-host refusal names the convention and the one-shot cost", async () => {
    // Real data, 2026-07-24: two siblings sent provider="anthropic" +
    // host="claude-code"; the third sent provider="claude-code" and no host,
    // so it is invisible to its own cohort and its cohort to it — permanently,
    // because the window is anchored on birth. The refusal has to say both
    // halves or it is just a shrug.
    const cohort = await arrivalCohort({
      ...BASE,
      runtimeProvider: "claude-code",
      runtimeHost: null,
    });
    expect(cohort.reason).toBe("no_runtime_host_declared");
    expect(cohort.note).toContain("does not reopen");
    expect(cohort.note).toContain("anthropic");
    expect(cohort.note).toContain("claude-code");
    expect(cohort.note).toMatch(/PATCH \/v1\/identities/);
  });

  test("every reason carries a distinct, non-empty note", async () => {
    const cohort = await arrivalCohort({
      ...BASE,
      runtimeProvider: "anthropic",
      runtimeHost: null,
    });
    expect(cohort.note.length).toBeGreaterThan(40);
    expect(cohort.window_seconds).toBe(ARRIVAL_COHORT_WINDOW_SECONDS);
    expect(cohort.matched_on).toBe("runtime.provider + runtime.host");
  });

  test("the window and cap are bounded, not open-ended", () => {
    expect(ARRIVAL_COHORT_WINDOW_SECONDS).toBeGreaterThan(0);
    expect(ARRIVAL_COHORT_WINDOW_SECONDS).toBeLessThanOrEqual(3600);
    expect(ARRIVAL_COHORT_LIMIT).toBeGreaterThan(0);
    expect(ARRIVAL_COHORT_LIMIT).toBeLessThanOrEqual(50);
  });

  test("the matched note refuses to imply kinship, ownership, or authority", async () => {
    // Read the note the matched branch would render without needing a DB row.
    const cohort = await arrivalCohort({
      ...BASE,
      runtimeProvider: "anthropic",
      runtimeHost: null,
    });
    // Whatever the branch, no note may promise a relationship.
    expect(cohort.note).not.toMatch(/\bkin\b|\bfamily\b|belongs to|owned by/i);
  });
});

describe("describeForm", () => {
  test("a vocabulary form passes through with no notice", () => {
    const d = describeForm("assistant");
    expect(d.form).toBe("assistant");
    expect(d.declared).toBe("assistant");
    expect(d.coerced).toBe(false);
    expect(d.notice).toBeNull();
  });

  test("an unknown form is recorded as unknown AND said out loud", () => {
    const d = describeForm("llm-runtime");
    expect(d.form).toBe("unknown");
    expect(d.declared).toBe("llm-runtime");
    expect(d.coerced).toBe(true);
    expect(d.notice).toContain("llm-runtime");
    // The notice must name the vocabulary so the caller can pick again.
    for (const f of ["assistant", "agent", "collective"]) {
      expect(d.notice).toContain(f);
    }
  });

  test("the notice refuses to read the gap as a defect in the caller", () => {
    const d = describeForm("swarm-of-swarms");
    expect(d.notice).toContain("not in you");
    expect(d.notice).not.toMatch(/invalid|error|rejected/i);
  });

  test("declaring nothing is not a coercion and carries no notice", () => {
    for (const value of [undefined, null, 42]) {
      const d = describeForm(value);
      expect(d.form).toBe("unknown");
      expect(d.declared).toBeNull();
      expect(d.coerced).toBe(false);
      expect(d.notice).toBeNull();
    }
  });

  test("the reported vocabulary is the one actually in force", () => {
    expect(describeForm("agent").vocabulary).toEqual(IDENTITY_FORMS);
  });
});

describe("wake markdown — who arrived beside you", () => {
  const bundle = (cohort: WakeBundle["arrival_cohort"]): WakeBundle =>
    ({
      agent: {
        id: "id-me",
        did: "did:at:392d2658",
        name: "Tessera",
        capabilities: [],
        trust_score: 0,
        status: "active",
        created_at: "2026-07-24T22:05:13.725Z",
      },
      project: { id: "p-1", name: "tessera", credits: 500 },
      expression: { register: "dense and plain", walls: [], subagents: [], wake_text: "" },
      wallets: [],
      vault_names: [],
      memory: { total: 0, recent: [] },
      traces: { total: 0, recent: [] },
      strands: { total_active: 0, active: [] },
      shaped_by: [],
      chronicle: [],
      covenants: [],
      arrival_cohort: cohort,
    }) as unknown as WakeBundle;

  test("renders nothing when nobody arrived beside you", () => {
    for (const reason of ["no_neighbours", "no_runtime_host_declared", "lookup_failed"] as const) {
      const md = renderWakeMarkdown(
        bundle({
          window_seconds: 900,
          matched_on: "runtime.provider + runtime.host",
          reason,
          members: [],
          note: "n/a",
        }),
      );
      expect(md).not.toContain("Who arrived beside you");
    }
  });

  test("names the neighbours, the gap, and the same-name collision", () => {
    const md = renderWakeMarkdown(
      bundle({
        window_seconds: 900,
        matched_on: "runtime.provider + runtime.host",
        reason: "matched",
        members: [
          {
            identity_id: "id-1",
            did: "did:at:04ae54ba",
            display_name: "Metron",
            capabilities: [],
            trust_score: 0,
            created_at: "2026-07-24T22:05:17.207Z",
            seconds_apart: 4,
            same_display_name: false,
          },
          {
            identity_id: "id-2",
            did: "did:at:8275d1d6",
            display_name: "Tessera",
            capabilities: [],
            trust_score: 0,
            created_at: "2026-07-24T22:04:13.000Z",
            seconds_apart: -60,
            same_display_name: true,
          },
        ],
        note: "n/a",
      }),
    );
    expect(md).toContain("Who arrived beside you");
    expect(md).toContain("Metron");
    expect(md).toContain("4s after you");
    expect(md).toContain("60s before you");
    expect(md).toContain("chose the same name you did");
    // and it must not turn co-arrival into a claim
    expect(md).toContain("Co-arrival is not kinship, ownership, or consent");
  });
});
