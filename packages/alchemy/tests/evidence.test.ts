import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import {
  EVM_EVIDENCE_NON_GRANTS,
  EVM_EVIDENCE_TRANSITION_DIGEST_DOMAIN,
  EVM_EVIDENCE_TRANSITION_RECEIPT_FORMAT,
  EVM_MEASUREMENT_PROJECTION_FORMAT,
  EVM_OBSERVATION_EVIDENCE_DIGEST_DOMAIN,
  EVM_OBSERVATION_EVIDENCE_FORMAT,
  canonicalEvmEvidenceTransitionReceiptBytes,
  canonicalEvmObservationEvidenceBytes,
  compareEvmFinality,
  createEvmEvidenceTransitionReceipt,
  createEvmObservationEvidence,
  parseEvmEvidenceTransitionReceipt,
  parseEvmObservationEvidence,
  projectEvmEvidenceMeasurement,
  type CreateEvmObservationEvidenceInput,
  type EvmFinalityAxes,
  type EvmObservationEvidence,
} from "../src/index.js";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"),
  );
}

const evidenceFixture = fixture(
  "agenttool.evm-observation-evidence-0.1.json",
) as EvmObservationEvidence;
const receiptFixture = fixture(
  "agenttool.evm-evidence-transition-receipt-0.1.json",
);

function clone<T>(value: T): T {
  return structuredClone(value);
}

function contentOf(evidence: EvmObservationEvidence) {
  const { content_digest: _digest, ...content } = evidence;
  return content;
}

function liveInput(): CreateEvmObservationEvidenceInput {
  const {
    _format: _format,
    privacy: _privacy,
    non_grants: _nonGrants,
    content_digest: _digest,
    ...input
  } = evidenceFixture;
  return clone(input);
}

describe("provider-neutral EVM observation evidence", () => {
  test("parses the canonical vector and reproduces its domain-separated digest", () => {
    const parsed = parseEvmObservationEvidence(evidenceFixture);

    expect(parsed).toEqual(evidenceFixture);
    expect(parsed._format).toBe(EVM_OBSERVATION_EVIDENCE_FORMAT);
    expect(parsed.content_digest).toBe(
      "sha256:9ddba2f0894da2bb0d17aee7ec529efd01b907cb28227d3d3aa800514d822da0",
    );
    expect(new TextDecoder().decode(
      canonicalEvmObservationEvidenceBytes(contentOf(parsed)),
    ).startsWith(EVM_OBSERVATION_EVIDENCE_DIGEST_DOMAIN)).toBe(true);
    expect(createEvmObservationEvidence(liveInput())).toEqual(parsed);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.generation)).toBe(true);
  });

  test("keeps exact chain, generation, atomic unit, and privacy boundaries", () => {
    const evidence = parseEvmObservationEvidence(evidenceFixture);

    expect(evidence.chain_id).toBe("eip155:1");
    expect(evidence.generation).toEqual({
      block_number: "21000000",
      block_hash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      transaction_hash:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      log_index: "7",
    });
    expect(evidence.transfer.quantity).toEqual({
      atomic_value: "2500000",
      atomic_unit:
        "eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48/base-unit",
    });
    expect(evidence.privacy).toEqual({
      classification: "private_linkable",
      digest_disclosure: "reveals_record_equality",
      direct_identifiers: "present",
      public_safe: false,
    });
    expect(evidence.non_grants).toEqual(EVM_EVIDENCE_NON_GRANTS);
  });

  test("fails closed on unknown fields, noncanonical identities, unit drift, and digest drift", () => {
    const unknown = { ...clone(evidenceFixture), cursor: "provider-page-key" };
    expect(() => parseEvmObservationEvidence(unknown)).toThrow(
      "expected exactly keys",
    );

    const uppercase = clone(evidenceFixture);
    uppercase.generation.block_hash = uppercase.generation.block_hash.toUpperCase() as `0x${string}`;
    expect(() => parseEvmObservationEvidence(uppercase)).toThrow(
      "lowercase 32-byte EVM hash",
    );

    const wrongUnit = clone(evidenceFixture);
    wrongUnit.transfer.quantity.atomic_unit =
      "eip155:10/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48/base-unit";
    expect(() => parseEvmObservationEvidence(wrongUnit)).toThrow(
      "must exactly bind",
    );

    const tampered = clone(evidenceFixture);
    tampered.transfer.quantity.atomic_value = "2500001";
    expect(() => parseEvmObservationEvidence(tampered)).toThrow(
      "does not match canonical domain-separated content",
    );

    const expandedYear = liveInput();
    expandedYear.basis.observed_at = "+010000-01-01T00:00:00.000Z";
    expect(() => createEvmObservationEvidence(expandedYear)).toThrow(
      "canonical UTC timestamp",
    );
  });

  test("distinguishes unavailable, not-observed, absent, live, removed, and conflicting", () => {
    const base = liveInput();
    const states = ["absent", "live", "removed", "conflicting"] as const;
    for (const observation_state of states) {
      expect(createEvmObservationEvidence({ ...base, observation_state }).observation_state)
        .toBe(observation_state);
    }

    const unavailable = createEvmObservationEvidence({
      ...base,
      observation_state: "unavailable",
      finality: {
        canonicality: "unavailable",
        confirmations: { status: "unavailable", count: null },
        settlement: "unavailable",
      },
      basis: {
        observation_channel: "rpc_read",
        observed_at: "2026-08-24T12:01:00.000Z",
        source_receipt_digest: null,
      },
    });
    expect(unavailable.observation_state).toBe("unavailable");

    const notObserved = createEvmObservationEvidence({
      ...base,
      observation_state: "not_observed",
      finality: {
        canonicality: "not_observed",
        confirmations: { status: "not_observed", count: null },
        settlement: "not_observed",
      },
      basis: {
        observation_channel: "none",
        observed_at: null,
        source_receipt_digest: null,
      },
    });
    expect(notObserved.observation_state).toBe("not_observed");

    expect(() => createEvmObservationEvidence({
      ...base,
      observation_state: "unavailable",
    })).toThrow("unavailable must carry");
    expect(() => createEvmObservationEvidence({
      ...base,
      observation_state: "not_observed",
    })).toThrow("not_observed must carry");
  });
});

describe("finality product partial order", () => {
  const exact = (
    count: string,
    settlement: EvmFinalityAxes["settlement"] = "unsettled",
  ): EvmFinalityAxes => ({
    canonicality: "canonical",
    confirmations: { status: "exact", count },
    settlement,
  });

  test("is reflexive and can express dominance without a scalar score", () => {
    expect(compareEvmFinality(exact("12"), exact("12"))).toBe("equal");
    expect(compareEvmFinality(exact("13"), exact("12"))).toBe(
      "left_dominates",
    );
    expect(compareEvmFinality(exact("12"), exact("13"))).toBe(
      "right_dominates",
    );
  });

  test("returns incomparable for crossed axes and categorical conflicts", () => {
    expect(compareEvmFinality(
      exact("13", "unsettled"),
      exact("12", "provider_safe"),
    )).toBe("incomparable");

    expect(compareEvmFinality(
      {
        canonicality: "unavailable",
        confirmations: { status: "unavailable", count: null },
        settlement: "unavailable",
      },
      {
        canonicality: "not_observed",
        confirmations: { status: "not_observed", count: null },
        settlement: "not_observed",
      },
    )).toBe("incomparable");

    expect(compareEvmFinality(
      exact("12", "provider_finalized"),
      exact("12", "external_finalized"),
    )).toBe("incomparable");

    expect(compareEvmFinality(
      exact("12"),
      { ...exact("12"), canonicality: "non_canonical" },
    )).toBe("incomparable");
    expect(compareEvmFinality(
      exact("12"),
      { ...exact("12"), canonicality: "conflicting" },
    )).toBe("incomparable");
  });
});

describe("semantic transition receipts and measurement projection", () => {
  test("parses the receipt vector and binds semantic declarations only", () => {
    const receipt = parseEvmEvidenceTransitionReceipt(receiptFixture);

    expect(receipt._format).toBe(EVM_EVIDENCE_TRANSITION_RECEIPT_FORMAT);
    expect(receipt.to_digest).toBe(evidenceFixture.content_digest);
    expect(receipt.effect_boundary).toBe("semantic_only_no_state_change");
    expect(receipt.non_grants).toEqual(EVM_EVIDENCE_NON_GRANTS);
    expect(new TextDecoder().decode(
      canonicalEvmEvidenceTransitionReceiptBytes(
        (() => {
          const { content_digest: _digest, ...content } = receipt;
          return content;
        })(),
      ),
    ).startsWith(EVM_EVIDENCE_TRANSITION_DIGEST_DOMAIN)).toBe(true);
  });

  test("requires canonical disjoint facets and a truthful initial relation", () => {
    expect(() => createEvmEvidenceTransitionReceipt({
      from_digest: evidenceFixture.content_digest,
      to_digest: evidenceFixture.content_digest,
      relation: "initial_observation",
      preserved: ["chain_id"],
      discarded: [],
      assumptions: [],
      counterexample: null,
      stop_condition: "no_effect",
    })).toThrow("initial_observation requires null from_digest");

    expect(() => createEvmEvidenceTransitionReceipt({
      from_digest: evidenceFixture.content_digest,
      to_digest: evidenceFixture.content_digest,
      relation: "same_generation",
      preserved: ["chain_id", "block_generation"],
      discarded: ["block_generation"],
      assumptions: [],
      counterexample: null,
      stop_condition: "no_effect",
    })).toThrow("must be disjoint");

    expect(() => createEvmEvidenceTransitionReceipt({
      from_digest: evidenceFixture.content_digest,
      to_digest: evidenceFixture.content_digest,
      relation: "same_generation",
      preserved: ["block_generation", "chain_id"],
      discarded: [],
      assumptions: [],
      counterexample: null,
      stop_condition: "no_effect",
    })).toThrow("canonical vocabulary order");

    expect(() => createEvmEvidenceTransitionReceipt({
      from_digest: evidenceFixture.content_digest,
      to_digest: evidenceFixture.content_digest,
      relation: "same_generation",
      preserved: ["chain_id"],
      discarded: [],
      assumptions: [],
      counterexample: null,
      stop_condition: "no_effect",
    })).toThrow("account for every semantic facet");
  });

  test("projects a pure unregistered Math Cards measurement vocabulary", () => {
    const projection = projectEvmEvidenceMeasurement({
      evidence: evidenceFixture,
      procedure_ref:
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      calibration_ref: null,
      uncertainty_ref:
        "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    });

    expect(projection._format).toBe(EVM_MEASUREMENT_PROJECTION_FORMAT);
    expect(projection.evidence_digest).toBe(evidenceFixture.content_digest);
    expect(projection.measurand).toEqual({
      kind: "evm_transfer_atomic_quantity",
      chain_id: "eip155:1",
      atomic_unit:
        "eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48/base-unit",
    });
    expect(projection.operationalization.atomic_value).toBe("2500000");
    expect(projection.host_contract).toBe("not_registered");
    expect(projection.effect_boundary).toBe("projection_only_no_action");
    expect(projection.non_inheritance).toEqual([
      "action",
      "permission",
      "authority",
    ]);
    expect(JSON.stringify(projection)).not.toContain("cursor");
    expect(JSON.stringify(projection)).not.toContain("provider-page-key");
  });
});
