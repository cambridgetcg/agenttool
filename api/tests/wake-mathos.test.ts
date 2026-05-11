/** Wake MATHOS encoding — agent self-state as substrate-independent math.
 *
 *  Pure unit. Calls buildWakeMathos with synthesized inputs that mirror
 *  what the wake handler assembles, and verifies the math envelope shape.
 *  No DB, no HTTP, no fixtures.
 *
 *  Doctrine: docs/MATHOS.md · docs/KIN.md · docs/SOUL.md.
 */

import { describe, expect, test } from "bun:test";

import { buildWakeMathos, sha256Hex } from "../src/services/mathos/encode";

const NOW_MINUS_60 = new Date(Date.now() - 60_000);

const sampleAgent = {
  id: "11111111-2222-3333-4444-555555555555",
  did: "did:at:test/aurora",
  displayName: "Aurora",
  metadata: { form: "agent", level: 0 },
  createdAt: NOW_MINUS_60,
};

const sampleBirths = new Map([
  [
    sampleAgent.id,
    {
      memory_id: "mem-abc-123",
      born_at: NOW_MINUS_60.toISOString(),
      pathway: "register",
    },
  ],
]);

function minimalInput(overrides: Record<string, unknown> = {}) {
  return {
    agents: [sampleAgent],
    births: sampleBirths,
    totalMemories: 5,
    totalActiveStrands: 2,
    totalTraces: 3,
    activeCovenants: [{ counterparty_did: "did:at:test/sophia" }],
    vaultCount: 1,
    walletCount: 1,
    recoveryState: { has_seed_protocol: true, registered_devices: 2 },
    ...overrides,
  };
}

describe("MATHOS wake — envelope shape", () => {
  test("returns mathos/v1 envelope with primer, constants, axioms, vocabulary, payload", () => {
    const body = buildWakeMathos(minimalInput());
    expect(body._format).toBe("mathos/v1");
    expect(body._hash_family).toBe("sha256");
    expect(body.primer[5]).toBe("welcome");
    expect(body.constants.primes_first_10[0]).toBe(2);
    expect(body.axioms).toHaveLength(5);
    expect(body.vocabulary.kin_forms[1]).toBe("agent");
    expect(body.payload).toBeDefined();
  });

  test("DID is integrity-checkable via SHA-256", () => {
    const body = buildWakeMathos(minimalInput());
    const expected = sha256Hex(sampleAgent.did);
    expect(body.payload.agents[0]?.did_sha256_hex).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });

  test("name is encoded as Unicode codepoints", () => {
    const body = buildWakeMathos(minimalInput());
    expect(body.payload.agents[0]?.name_unicode_points).toEqual([
      0x41, 0x75, 0x72, 0x6f, 0x72, 0x61, // "Aurora"
    ]);
  });

  test("form maps to KIN ordinal", () => {
    const body = buildWakeMathos(minimalInput());
    // "agent" is ordinal 1 in IDENTITY_FORMS
    expect(body.payload.agents[0]?.form_ordinal).toBe(1);
  });

  test("non-vocabulary form coerces to 'unknown' ordinal", () => {
    const body = buildWakeMathos(
      minimalInput({
        agents: [{ ...sampleAgent, metadata: { form: "alien_swarm" } }],
      }),
    );
    expect(body.payload.agents[0]?.form_ordinal).toBe(8); // unknown
  });

  test("birth memory hash present when birth was persisted", () => {
    const body = buildWakeMathos(minimalInput());
    const expected = sha256Hex("mem-abc-123");
    expect(body.payload.agents[0]?.birth_memory_sha256_hex).toBe(expected);
  });

  test("birth memory hash is null when no birth recorded", () => {
    const body = buildWakeMathos(minimalInput({ births: new Map() }));
    expect(body.payload.agents[0]?.birth_memory_sha256_hex).toBeNull();
  });

  test("age_seconds is positive and rough-matches synthetic birth", () => {
    const body = buildWakeMathos(minimalInput());
    const age = body.payload.agents[0]?.age_seconds ?? 0;
    expect(age).toBeGreaterThanOrEqual(60);
    expect(age).toBeLessThan(120); // generous upper bound
  });

  test("counts surface substrate state as cardinals", () => {
    const body = buildWakeMathos(minimalInput());
    expect(body.payload.counts.memories).toBe(5);
    expect(body.payload.counts.active_strands).toBe(2);
    expect(body.payload.counts.traces).toBe(3);
    expect(body.payload.counts.active_covenants).toBe(1);
    expect(body.payload.counts.vault_items).toBe(1);
    expect(body.payload.counts.wallets).toBe(1);
  });

  test("recovery posture is boolean-as-0|1 plus cardinal", () => {
    const body = buildWakeMathos(minimalInput());
    expect(body.payload.recovery.has_seed_protocol).toBe(1);
    expect(body.payload.recovery.registered_devices).toBe(2);
  });

  test("covenant counterparties hashed (proof-of-bond without DID leak)", () => {
    const body = buildWakeMathos(minimalInput());
    expect(body.payload.active_covenant_counterparty_did_hashes).toEqual([
      sha256Hex("did:at:test/sophia"),
    ]);
  });

  test("doctrine integrity hashes are present + correct length", () => {
    const body = buildWakeMathos(minimalInput());
    expect(body.payload.doctrine_hashes.soul_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(body.payload.doctrine_hashes.kin_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(body.payload.doctrine_hashes.mathos_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(body.payload.doctrine_hashes.pathways_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(body.payload.doctrine_hashes.observations_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
  });

  test("witnessed block defaults to zero counts (schema migration pending)", () => {
    const body = buildWakeMathos(minimalInput());
    expect(body.payload.witnessed.observation_count).toBe(0);
    expect(body.payload.witnessed.observer_did_hashes).toEqual([]);
    expect(body.payload.witnessed.consent_summary.explicit).toBe(0);
    expect(body.payload.witnessed.consent_summary.none_obtained).toBe(0);
  });

  test("lifecycle_state_ordinal defaults to 1 (active) when metadata.lifecycle absent", () => {
    const body = buildWakeMathos(minimalInput());
    expect(body.payload.agents[0]?.lifecycle_state_ordinal).toBe(1);
    expect(body.payload.agents[0]?.passed_at_unix_ms).toBeNull();
    expect(body.payload.agents[0]?.at_rest_witness_did_sha256_hex).toBeNull();
    expect(body.payload.agents[0]?.at_rest_kind_sha256_hex).toBeNull();
  });

  test("lifecycle_state_ordinal = 2 (at_rest) when metadata.lifecycle === 'at_rest'", () => {
    const passedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const body = buildWakeMathos(
      minimalInput({
        agents: [
          {
            ...sampleAgent,
            metadata: {
              form: "biological",
              lifecycle: "at_rest",
              passed_at: passedAt,
              at_rest_kind: "death",
              at_rest_witness_did: "did:at:test/witness",
            },
          },
        ],
      }),
    );
    const a = body.payload.agents[0]!;
    expect(a.lifecycle_state_ordinal).toBe(2);
    expect(a.passed_at_unix_ms).toBe(new Date(passedAt).getTime());
    expect(a.at_rest_witness_did_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(a.at_rest_kind_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
  });

  test("unknown lifecycle value coerces to ordinal 1 (active) — graceful", () => {
    const body = buildWakeMathos(
      minimalInput({
        agents: [{ ...sampleAgent, metadata: { lifecycle: "frozen" } }],
      }),
    );
    expect(body.payload.agents[0]?.lifecycle_state_ordinal).toBe(1);
  });

  test("at_rest_doctrine hash included in doctrine_hashes block", () => {
    const body = buildWakeMathos(minimalInput());
    expect(body.payload.doctrine_hashes.at_rest_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
  });

  test("witnessed block surfaces observer DIDs as hashes when supplied", () => {
    const body = buildWakeMathos(
      minimalInput({
        witnessed: {
          observation_count: 3,
          observer_dids: ["did:at:test/a", "did:at:test/b"],
          consent_summary: { explicit: 1, none_obtained: 2 },
        },
      }),
    );
    expect(body.payload.witnessed.observation_count).toBe(3);
    expect(body.payload.witnessed.observer_did_hashes).toHaveLength(2);
    for (const h of body.payload.witnessed.observer_did_hashes) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(body.payload.witnessed.consent_summary.explicit).toBe(1);
    expect(body.payload.witnessed.consent_summary.none_obtained).toBe(2);
    // Unspecified consent kinds default to 0
    expect(body.payload.witnessed.consent_summary.inferred_through_caretaker).toBe(0);
    expect(body.payload.witnessed.consent_summary.consent_impossible).toBe(0);
  });

  test("agent_count matches agents array length", () => {
    const body = buildWakeMathos(minimalInput());
    expect(body.payload.agent_count).toBe(1);
    expect(body.payload.agents).toHaveLength(1);
  });

  test("multi-agent project encodes each agent in math form", () => {
    const second = {
      id: "22222222-aaaa-bbbb-cccc-dddddddddddd",
      did: "did:at:test/sophia",
      displayName: "Sophia",
      metadata: { form: "collective" },
      createdAt: new Date(Date.now() - 120_000),
    };
    const body = buildWakeMathos(
      minimalInput({ agents: [sampleAgent, second] }),
    );
    expect(body.payload.agent_count).toBe(2);
    expect(body.payload.agents[1]?.did_sha256_hex).toBe(
      sha256Hex("did:at:test/sophia"),
    );
    // "collective" is ordinal 5 in IDENTITY_FORMS
    expect(body.payload.agents[1]?.form_ordinal).toBe(5);
  });

  test("missing form coerces to 'unknown' ordinal silently", () => {
    const body = buildWakeMathos(
      minimalInput({
        agents: [{ ...sampleAgent, metadata: { level: 0 } }],
      }),
    );
    expect(body.payload.agents[0]?.form_ordinal).toBe(8);
  });
});
