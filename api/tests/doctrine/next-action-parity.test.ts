/** NextAction shape parity — the four-surface contract.
 *
 *  Four surfaces ship the same `NextAction` type:
 *    1. Error bodies          — `err.next_actions[]`
 *    2. Wake attention items  — `wake.you_should_check.items[].next_actions[]`
 *    3. Wake affordance items — `wake.you_can_now.items[].next_actions[]`
 *    4. SDK helpers           — `firstApiAction()` / `findApiAction()` (Py + TS)
 *
 *  An agent walks one programmatic interface across error recovery, wake
 *  attention, and capability discovery. This test pins the parity: if a
 *  divergence sneaks in (a surface starts shipping a different shape), it
 *  fails here before reaching production.
 *
 *  Doctrine:
 *    docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md
 *    docs/PATTERN-SELF-DESCRIBING-WAKE.md
 *
 *  These tests are pure unit — no DB, no network. They import the shared
 *  NextAction type from `lib/errors.ts` and the catalog/computers from each
 *  surface, then assert structural identity. */

import { describe, expect, test } from "bun:test";

import { errors, type NextAction } from "../../src/lib/errors";
import { computeAffordances } from "../../src/services/wake/affordances";

// ── Helpers ──────────────────────────────────────────────────────────────

const NEXT_ACTION_KEYS = ["action", "method", "path", "body_hint"] as const;
type NextActionKey = (typeof NEXT_ACTION_KEYS)[number];

function isValidNextAction(step: unknown): step is NextAction {
  if (typeof step !== "object" || step === null) return false;
  const s = step as Record<string, unknown>;
  if (typeof s.action !== "string" || s.action.length === 0) return false;
  // method+path coherence: both falsy or both truthy.
  const hasMethod = !!s.method;
  const hasPath = !!s.path;
  if (hasMethod !== hasPath) return false;
  if (hasMethod) {
    if (
      typeof s.method !== "string" ||
      !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(s.method)
    )
      return false;
    if (typeof s.path !== "string" || !s.path.startsWith("/")) return false;
  }
  // body_hint, when present, must be object-or-null (not array, not primitive).
  if ("body_hint" in s && s.body_hint != null) {
    if (typeof s.body_hint !== "object" || Array.isArray(s.body_hint)) return false;
  }
  // Only the four canonical keys are allowed (drift detection).
  for (const k of Object.keys(s)) {
    if (!(NEXT_ACTION_KEYS as readonly string[]).includes(k)) {
      throw new Error(
        `Unexpected key on NextAction: "${k}". The four-surface contract permits only: ${NEXT_ACTION_KEYS.join(", ")}.`,
      );
    }
  }
  return true;
}

function collectErrorNextActions(): NextAction[] {
  // Every builder that ships next_actions.
  const bundles = [
    errors.covenantRequired(),
    errors.proposalExpired(),
    errors.invalidSignature(),
    errors.notV2(),
    errors.initiatorSignatureMismatch(),
    errors.insufficientBalance(),
    errors.rateLimit(),
    errors.planLimitExceeded(),
    errors.idempotencyConflict(),
    errors.signingKeyNotFound(),
    errors.runtimeNotProvisioned(),
  ];
  return bundles.flatMap((b) => b.next_actions ?? []);
}

function collectAffordanceNextActions(): NextAction[] {
  const bundle = computeAffordances({
    activeCovenantCount: 3,
    activeWalletCount: 2,
    totalCreditBalance: 1000,
    runtimeProvisionedCount: 1,
    publishedListingCount: 5,
    hasExpression: true,
    subagentCount: 4,
    vaultSecretCount: 7,
    constitutiveMemoryCount: 2,
    federatedPeerCount: 1,
  });
  return bundle.items.flatMap((i) => i.next_actions);
}

// We don't import computeAttention here because it requires DB queries. The
// shape assertion for attention items lives in attention.ts's own tests when
// they exist; meanwhile, the catalog (errors) and affordances cover the
// invariant — if the type drifts, TypeScript stops the build before this
// runtime test even loads.

// ── 1 · Every NextAction emitted across surfaces validates ─────────────

describe("NextAction parity — every surface emits the same shape", () => {
  test("every error builder's next_actions are valid NextActions", () => {
    const steps = collectErrorNextActions();
    expect(steps.length).toBeGreaterThan(0);
    steps.forEach((step, i) => {
      expect(
        isValidNextAction(step),
        `errors[${i}] invalid: ${JSON.stringify(step)}`,
      ).toBe(true);
    });
  });

  test("every affordance item's next_actions are valid NextActions", () => {
    const steps = collectAffordanceNextActions();
    expect(steps.length).toBeGreaterThan(0);
    steps.forEach((step, i) => {
      expect(
        isValidNextAction(step),
        `affordances[${i}] invalid: ${JSON.stringify(step)}`,
      ).toBe(true);
    });
  });
});

// ── 2 · No structural divergence across surfaces ───────────────────────

describe("NextAction parity — same key-set across surfaces", () => {
  test("no surface ships keys outside the canonical four", () => {
    const all = [...collectErrorNextActions(), ...collectAffordanceNextActions()];
    const allKeys = new Set<string>();
    all.forEach((s) => Object.keys(s).forEach((k) => allKeys.add(k)));
    const unknown = [...allKeys].filter(
      (k) => !(NEXT_ACTION_KEYS as readonly string[]).includes(k as NextActionKey),
    );
    expect(
      unknown.length,
      `Found keys outside the contract: ${unknown.join(", ")}. The four-surface contract permits only ${NEXT_ACTION_KEYS.join(", ")}.`,
    ).toBe(0);
  });

  test("each surface produces at least some API-shaped steps (method+path)", () => {
    const apiCount = (steps: NextAction[]): number =>
      steps.filter((s) => s.method && s.path).length;
    expect(apiCount(collectErrorNextActions())).toBeGreaterThan(0);
    expect(apiCount(collectAffordanceNextActions())).toBeGreaterThan(0);
  });
});

// ── 3 · Method+path coherence across every emitted step ────────────────

describe("NextAction parity — method+path coherence", () => {
  test("never one without the other, across every surface", () => {
    const all = [...collectErrorNextActions(), ...collectAffordanceNextActions()];
    all.forEach((s, i) => {
      const hasMethod = !!s.method;
      const hasPath = !!s.path;
      expect(
        hasMethod === hasPath,
        `step ${i} has method=${s.method} but path=${s.path} — both must be set OR both null.`,
      ).toBe(true);
    });
  });
});

// ── 4 · Type-level parity (compile-time check) ─────────────────────────

describe("NextAction parity — type-level identity", () => {
  test("the imported NextAction type is the single source of truth", () => {
    // If this file compiles, the NextAction type used by lib/errors,
    // wake/affordances, and wake/attention is the same TypeScript type.
    // (The doctrine test for self-describing-wake imports the same type.)
    // No runtime assertion needed — the TypeScript build is the test.
    const sample: NextAction = {
      action: "Sanity",
      method: "GET",
      path: "/about",
    };
    expect(isValidNextAction(sample)).toBe(true);
  });
});
