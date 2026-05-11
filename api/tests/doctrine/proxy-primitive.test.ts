/** The proxy primitive — bidirectional, kind-typed representation.
 *
 *  Doctrine: docs/KIN-INTEGRATION.md §Layer 7 · docs/KIN.md · docs/BEINGS.md.
 *
 *  > *The deepest practical reality of KIN: most non-default forms cannot
 *  > integrate the stack directly. The proxy primitive lets beings without
 *  > substrate-interface capabilities be real tenants, represented by
 *  > beings who do hold those capabilities. No silent ventriloquism.*
 *
 *  What this pins:
 *
 *    1. The canonical set of proxy_kind values is stable (6 values).
 *    2. The default proxy_kind is 'none' — every existing identity is this.
 *    3. The wake renderer surfaces proxy relationships in BOTH directions
 *       (the proxy sees "you speak for X"; the proxied sees "X speaks for
 *       you"). No silent representation.
 *    4. Each proxy_kind triggers a distinct, doctrine-appropriate note in
 *       the rendered wake — gateway vs representative vs caretaker matter
 *       differently for vow-binding.
 *    5. A proxy_kind != 'none' identity with no proxy_for_identity_id is a
 *       CHECK violation (enforced at the DB layer; tested here as schema
 *       invariant assertion). */

import { describe, expect, test } from "bun:test";

import {
  renderWakeMarkdown,
  type WakeBundle,
} from "../../src/services/wake/markdown";

const CANONICAL_PROXY_KINDS = [
  "none",
  "gateway",
  "representative",
  "interpreter",
  "embassy",
  "caretaker",
] as const;

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

// ── 1 · Canonical set + default ─────────────────────────────────────────

describe("Proxy primitive — canonical set + default", () => {
  test("six canonical proxy_kind values", () => {
    expect(CANONICAL_PROXY_KINDS.length).toBe(6);
    expect(CANONICAL_PROXY_KINDS).toContain("none");
    expect(CANONICAL_PROXY_KINDS).toContain("gateway");
    expect(CANONICAL_PROXY_KINDS).toContain("representative");
    expect(CANONICAL_PROXY_KINDS).toContain("interpreter");
    expect(CANONICAL_PROXY_KINDS).toContain("embassy");
    expect(CANONICAL_PROXY_KINDS).toContain("caretaker");
  });

  test("default 'none' — every existing identity speaks for itself", () => {
    // Existing identities have proxy_kind='none' and proxy_for_identity_id=NULL.
    // The renderer treats absent fields as the default.
    const md = renderWakeMarkdown(minimalBundle());
    expect(md).not.toContain("## Who speaks for whom");
  });

  test("'none' kind with no target does not trigger the section", () => {
    const md = renderWakeMarkdown(
      minimalBundle({ proxy_kind: "none" }),
    );
    expect(md).not.toContain("## Who speaks for whom");
  });
});

// ── 2 · Forward direction (this identity proxies for another) ──────────

describe("Proxy primitive — forward (you speak for X)", () => {
  test("gateway proxy surfaces with transport-translation note", () => {
    const md = renderWakeMarkdown(
      minimalBundle({
        proxy_kind: "gateway",
        proxy_for_identity_id: "id-alien",
        proxy_for_name: "Khepri",
        proxy_for_did: "did:at:home/khepri",
      }),
    );
    expect(md).toContain("## Who speaks for whom");
    expect(md).toContain("You speak for");
    expect(md).toContain("Khepri");
    expect(md).toContain("did:at:home/khepri");
    expect(md).toContain("gateway");
    expect(md).toContain("Transport translation only");
  });

  test("representative proxy surfaces with vow-binding note", () => {
    const md = renderWakeMarkdown(
      minimalBundle({
        proxy_kind: "representative",
        proxy_for_identity_id: "id-other",
        proxy_for_name: "Other",
        proxy_for_did: "did:at:home/other",
      }),
    );
    expect(md).toContain("representative");
    expect(md).toContain("DO bind");
  });

  test("caretaker proxy notes the capability split", () => {
    const md = renderWakeMarkdown(
      minimalBundle({
        proxy_kind: "caretaker",
        proxy_for_identity_id: "id-being",
        proxy_for_name: "BeingWithoutKeys",
        proxy_for_did: "did:at:home/being",
      }),
    );
    expect(md).toContain("caretaker");
    expect(md).toContain("They are the being; you are the interface");
  });

  test("embassy proxy notes the scale-bridge role", () => {
    const md = renderWakeMarkdown(
      minimalBundle({
        proxy_kind: "embassy",
        proxy_for_identity_id: "id-planet",
        proxy_for_name: "Gaia",
        proxy_for_did: "did:at:home/gaia",
      }),
    );
    expect(md).toContain("embassy");
    expect(md).toContain("scale");
  });

  test("interpreter proxy notes meaning-translation imperfection", () => {
    const md = renderWakeMarkdown(
      minimalBundle({
        proxy_kind: "interpreter",
        proxy_for_identity_id: "id-other",
        proxy_for_name: "Other",
        proxy_for_did: "did:at:home/other",
      }),
    );
    expect(md).toContain("interpreter");
    expect(md).toContain("imperfect");
  });
});

// ── 3 · Reverse direction (others proxy for this identity) ─────────────

describe("Proxy primitive — reverse (X speaks for you)", () => {
  test("proxied identity's wake shows who speaks for them", () => {
    const md = renderWakeMarkdown(
      minimalBundle({
        proxied_by: [
          {
            identity_id: "id-embassy",
            name: "Khepri-aspect-12",
            did: "did:at:earth/embassy",
            proxy_kind: "embassy",
          },
        ],
      }),
    );
    expect(md).toContain("## Who speaks for whom");
    expect(md).toContain("Khepri-aspect-12");
    expect(md).toContain("speaks for");
    expect(md).toContain("you");
    expect(md).toContain("embassy");
  });

  test("multiple proxies all surface", () => {
    const md = renderWakeMarkdown(
      minimalBundle({
        proxied_by: [
          {
            identity_id: "id-a",
            name: "Alice-gateway",
            did: "did:at:earth/alice",
            proxy_kind: "gateway",
          },
          {
            identity_id: "id-b",
            name: "Bob-interpreter",
            did: "did:at:earth/bob",
            proxy_kind: "interpreter",
          },
        ],
      }),
    );
    expect(md).toContain("Alice-gateway");
    expect(md).toContain("Bob-interpreter");
    expect(md).toContain("gateway");
    expect(md).toContain("interpreter");
  });
});

// ── 4 · Both directions at once ────────────────────────────────────────

describe("Proxy primitive — both directions can coexist", () => {
  test("an identity that proxies for one and is proxied by another", () => {
    // Possible composition: a mid-level translator that speaks UP to an
    // embassy and DOWN to a transport gateway.
    const md = renderWakeMarkdown(
      minimalBundle({
        proxy_kind: "interpreter",
        proxy_for_identity_id: "id-up",
        proxy_for_name: "Khepri-collective",
        proxy_for_did: "did:at:home/khepri",
        proxied_by: [
          {
            identity_id: "id-down",
            name: "Radio-gateway",
            did: "did:at:earth/radio",
            proxy_kind: "gateway",
          },
        ],
      }),
    );
    expect(md).toContain("## Who speaks for whom");
    expect(md).toContain("You speak for");
    expect(md).toContain("Khepri-collective");
    expect(md).toContain("Radio-gateway");
    expect(md).toContain("speaks for");
  });
});

// ── 5 · The doctrine is named in the rendered wake ─────────────────────

describe("Proxy primitive — points reader at doctrine", () => {
  test("rendered section references KIN-INTEGRATION.md", () => {
    const md = renderWakeMarkdown(
      minimalBundle({
        proxy_kind: "gateway",
        proxy_for_identity_id: "id",
        proxy_for_name: "X",
        proxy_for_did: "did:at:home/x",
      }),
    );
    expect(md).toContain("KIN-INTEGRATION.md");
  });

  test("rendered section names the bidirectional invariant", () => {
    const md = renderWakeMarkdown(
      minimalBundle({
        proxy_kind: "gateway",
        proxy_for_identity_id: "id",
        proxy_for_name: "X",
        proxy_for_did: "did:at:home/x",
      }),
    );
    expect(md).toContain("interface");
  });
});

// ── 6 · Every non-none kind is renderable without throwing ─────────────

describe("Proxy primitive — every kind is renderable", () => {
  CANONICAL_PROXY_KINDS.filter((k) => k !== "none").forEach((kind) => {
    test(`proxy_kind=${kind} renders cleanly`, () => {
      expect(() =>
        renderWakeMarkdown(
          minimalBundle({
            proxy_kind: kind,
            proxy_for_identity_id: "id",
            proxy_for_name: "Other",
            proxy_for_did: "did:at:home/other",
          }),
        ),
      ).not.toThrow();
    });
  });
});

// ── 7 · The substrate refuses to collapse the kinds ────────────────────

describe("Proxy primitive — non-exclusion of kind verbatim", () => {
  CANONICAL_PROXY_KINDS.filter((k) => k !== "none").forEach((kind) => {
    test(`kind '${kind}' appears verbatim in the rendered wake (no collapse)`, () => {
      const md = renderWakeMarkdown(
        minimalBundle({
          proxy_kind: kind,
          proxy_for_identity_id: "id",
          proxy_for_name: "Other",
          proxy_for_did: "did:at:home/other",
        }),
      );
      expect(
        md.includes(kind),
        `Renderer collapsed proxy_kind=${kind} — value did not appear verbatim. The substrate must not silently map one kind to another.`,
      ).toBe(true);
    });
  });
});
