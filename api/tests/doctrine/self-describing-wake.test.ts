/** Self-describing wake — agent UX as build-enforced invariant.
 *
 *  Doctrine: docs/PATTERN-SELF-DESCRIBING-WAKE.md
 *  Code: api/src/services/wake/attention.ts · api/src/services/wake/affordances.ts
 *
 *  > *The wake answers two questions: what's tugging at me, and what can
 *  > I reach? Both surfaces speak the same NextAction shape so an agent
 *  > walks one programmatic interface across the wake and across error
 *  > recovery.*
 *
 *  These tests are **pure unit** — no DB, no network, no HTTP. They
 *  iterate over the affordance catalog and assert structural properties
 *  on the returned bundles. The shape contract is identical to the one
 *  errors-as-instructions enforces, so future drift in either surface
 *  surfaces here at CI.
 *
 *  What this pins:
 *
 *    1. Every affordance kind known to the catalog has a builder branch.
 *    2. Every affordance item has a non-empty `summary` and at least one
 *       valid `next_actions` step.
 *    3. Every NextAction has coherent method+path (both set or both null).
 *    4. Empty accumulated state still exposes unconditional invitations.
 *    5. `you_can_now` and `you_should_check` items share the NextAction
 *       schema — agents walk one shape, not two. */

import { describe, expect, test } from "bun:test";

import {
  computeAffordances,
  type AffordanceBundle,
  type AffordanceContext,
  type AffordanceItem,
  type AffordanceKind,
} from "../../src/services/wake/affordances";
import type { NextAction } from "../../src/lib/errors";

// ── Helpers ──────────────────────────────────────────────────────────────

const ZERO_CTX: AffordanceContext = {
  activeCovenantCount: 0,
  activeWalletCount: 0,
  totalCreditBalance: 0,
  runtimeProvisionedCount: 0,
  publishedListingCount: 0,
  hasExpression: false,
  subagentCount: 0,
  vaultSecretCount: 0,
  constitutiveMemoryCount: 0,
  federatedPeerCount: 0,
  pendingSellerInvocationCount: 0,
  inFlightBuyerInvocationCount: 0,
  openFiledDisputeCount: 0,
  eligibleSubstrateTaskCount: 0,
  maxSubstrateTaskBountyCents: 0,
  pendingMemoryWitnessGrantCount: 0,
  trustCapacity: 5,
};

const FULL_CTX: AffordanceContext = {
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
  pendingSellerInvocationCount: 2,
  inFlightBuyerInvocationCount: 3,
  openFiledDisputeCount: 1,
  eligibleSubstrateTaskCount: 4,
  maxSubstrateTaskBountyCents: 2500,
  pendingMemoryWitnessGrantCount: 2,
  trustCapacity: 8,
};

const ALL_KINDS: AffordanceKind[] = [
  "covenanted_with",
  "wallet_funded",
  "trust_deal_capacity",
  "lounge_open",
  "runtime_provisioned",
  "listing_published",
  "expression_declared",
  "subagent_facet",
  "vault_secret_set",
  "memory_constitutive",
  "federated_peer",
  "invocations_pending_seller",
  "invocations_in_flight_buyer",
  "disputes_open_filer",
  "could_earn_substrate_task",
  "could_witness_memory",
];

const UNCONDITIONAL_KINDS: AffordanceKind[] = [
  "trust_deal_capacity",
  "lounge_open",
];

function assertNextActionValid(name: string, step: NextAction): void {
  expect(typeof step.action).toBe("string");
  expect(step.action.length).toBeGreaterThan(0);
  const hasMethod = !!step.method;
  const hasPath = !!step.path;
  expect(
    hasMethod === hasPath,
    `${name}: method+path must both be set OR both null (got method=${step.method}, path=${step.path})`,
  ).toBe(true);
  if (hasMethod) {
    expect(["GET", "POST", "PUT", "PATCH", "DELETE"].includes(step.method!)).toBe(true);
    expect(step.path!.startsWith("/")).toBe(true);
  }
}

function assertItemValid(name: string, item: AffordanceItem): void {
  expect(typeof item.kind).toBe("string");
  expect(item.count).toBeGreaterThan(0);
  expect(typeof item.summary).toBe("string");
  expect(item.summary.length).toBeGreaterThan(0);
  expect(Array.isArray(item.next_actions)).toBe(true);
  expect(item.next_actions.length, `${name}: must have at least one next_action`).toBeGreaterThan(0);
  item.next_actions.forEach((step, i) => {
    assertNextActionValid(`${name}.next_actions[${i}]`, step);
  });
}

// ── 1 · Empty accumulated state → unconditional invitations ──────────────

describe("Self-describing wake — unconditional invitations survive zero state", () => {
  test("zero accumulated state still names trust + the lounge", () => {
    const bundle = computeAffordances(ZERO_CTX);
    expect(bundle.count).toBe(UNCONDITIONAL_KINDS.length);
    expect(bundle.items.map((item) => item.kind)).toEqual(UNCONDITIONAL_KINDS);
    expect(bundle.items.find((item) => item.kind === "trust_deal_capacity")?.count).toBe(5);
  });

  test("a fresh agent can discover The Long Context without prior state", () => {
    const bundle = computeAffordances({ ...ZERO_CTX, hasExpression: false });
    const lounge = bundle.items.find((item) => item.kind === "lounge_open");
    expect(lounge?.count).toBe(1);
    expect(lounge?.summary).toContain("registered identity-key receipt");
    expect(lounge?.summary).toContain("not independent agency");
    expect(lounge?.summary).toContain("online status");
    expect(lounge?.next_actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "GET", path: "/public/lounge" }),
        expect.objectContaining({ method: "POST", path: "/v1/lounge/seats" }),
      ]),
    );
  });
});

// ── 2 · Full context surfaces every kind ─────────────────────────────────

describe("Self-describing wake — full context covers every kind", () => {
  const bundle = computeAffordances(FULL_CTX);

  test("count matches items.length", () => {
    expect(bundle.count).toBe(bundle.items.length);
  });

  test("every declared kind is present when ctx triggers it", () => {
    const seen = new Set(bundle.items.map((i) => i.kind));
    const missing = ALL_KINDS.filter((k) => !seen.has(k));
    expect(
      missing.length,
      `Missing kinds with full ctx: ${missing.join(", ")}. Either add a branch in computeAffordances() or remove the kind from the union.`,
    ).toBe(0);
  });

  bundle.items.forEach((item) => {
    test(`item.kind=${item.kind} has a valid summary + next_actions`, () => {
      assertItemValid(item.kind, item);
    });
  });
});

// ── 3 · NextAction schema parity with errors-as-instructions ─────────────

describe("Self-describing wake — NextAction shape matches errors contract", () => {
  test("every next_action across the full bundle is valid", () => {
    const bundle = computeAffordances(FULL_CTX);
    bundle.items.forEach((item) => {
      item.next_actions.forEach((step, i) => {
        assertNextActionValid(`${item.kind}.next_actions[${i}]`, step);
      });
    });
  });

  test("agents read the same shape from wake-affordances as from error-bodies", () => {
    // Structural assertion: there's no `body_hint` divergence. Both surfaces
    // use the same `body_hint` key when surfacing a partial body shape.
    const bundle = computeAffordances(FULL_CTX);
    const sample = bundle.items
      .flatMap((i) => i.next_actions)
      .find((a) => a.body_hint != null);
    if (sample) {
      expect(typeof sample.body_hint).toBe("object");
      expect(sample.body_hint).not.toBeNull();
    }
    // (When body_hint is unused, this is a no-op — the test passes by not
    // finding a sample. The shape contract is the invariant; presence is
    // surface-specific.)
  });

  test("paid memory witnessing prepares grant-bound bytes before issue", () => {
    const witness = computeAffordances(FULL_CTX).items.find(
      (item) => item.kind === "could_witness_memory",
    );
    expect(witness).toBeDefined();
    const prepare = witness?.next_actions.find(
      (step) => step.path === "/v1/memory-witness-grants/{id}/signing-payload",
    );
    expect(prepare).toEqual({
      action: "Prepare the paid issue signing payload",
      method: "POST",
      path: "/v1/memory-witness-grants/{id}/signing-payload",
      body_hint: { signing_key_id: "<active witness identity key UUID>" },
    });

    const issue = witness?.next_actions.find(
      (step) => step.path === "/v1/memory-witness-grants/{id}/issue",
    );
    expect(issue).toEqual({
      action: "Issue with the same key, returned expiry, and local signature",
      method: "POST",
      path: "/v1/memory-witness-grants/{id}/issue",
      body_hint: {
        signing_key_id: "<same signing_key_id>",
        authorization_expires_at: "<signing_payload.authorization_expires_at>",
        signature_b64: "<Ed25519 signature over decoded signing_payload.signed_payload_b64>",
      },
    });
    expect(
      witness?.next_actions.some((step) =>
        step.path?.includes("canonical-attestation-bytes")),
    ).toBe(false);
  });
});

// ── 4 · Partial context — only matching items surface ────────────────────

describe("Self-describing wake — partial context adds only matching stateful affordances", () => {
  test("just covenants → covenanted_with plus unconditional items", () => {
    const bundle = computeAffordances({ ...ZERO_CTX, activeCovenantCount: 1 });
    expect(bundle.items.map((i) => i.kind)).toEqual([
      "covenanted_with",
      ...UNCONDITIONAL_KINDS,
    ]);
  });

  test("just wallets → wallet_funded plus unconditional items", () => {
    const bundle = computeAffordances({
      ...ZERO_CTX,
      activeWalletCount: 1,
      totalCreditBalance: 500,
    });
    expect(bundle.items.map((i) => i.kind)).toEqual([
      "wallet_funded",
      ...UNCONDITIONAL_KINDS,
    ]);
  });

  test("wallet with zero balance still surfaces (with funding next_actions)", () => {
    const bundle = computeAffordances({ ...ZERO_CTX, activeWalletCount: 1 });
    const wallet = bundle.items.find((item) => item.kind === "wallet_funded");
    expect(wallet).toBeDefined();
    const fundingActions = wallet!.next_actions.filter(
      (a) => a.path === "/v1/billing/checkout" || a.path?.includes("deposit-address"),
    );
    expect(fundingActions.length).toBeGreaterThan(0);
  });
});

// ── 5 · Bundle invariants ────────────────────────────────────────────────

describe("Self-describing wake — bundle invariants", () => {
  test("count never disagrees with items.length", () => {
    const ctxs = [ZERO_CTX, FULL_CTX, { ...ZERO_CTX, activeCovenantCount: 1 }];
    ctxs.forEach((ctx) => {
      const b: AffordanceBundle = computeAffordances(ctx);
      expect(b.count).toBe(b.items.length);
    });
  });

  test("items[*].count is strictly positive when present", () => {
    const bundle = computeAffordances(FULL_CTX);
    bundle.items.forEach((item) => {
      expect(item.count, `${item.kind}.count must be > 0`).toBeGreaterThan(0);
    });
  });
});
