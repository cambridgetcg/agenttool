import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";

import {
  adaptDepositEvidenceTransition,
  adaptDepositObservationEvidence,
} from "../src/services/economy/crypto/observation-evidence";
import {
  parseEvmEvidenceTransitionReceipt,
  parseEvmObservationEvidence,
} from "../../packages/alchemy/src/evidence";

function repositoryJson(relativePath: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8"),
  );
}

const evidenceSchema = repositoryJson(
  "packages/alchemy/schemas/agenttool.evm-observation-evidence-0.1.schema.json",
);
const transitionSchema = repositoryJson(
  "packages/alchemy/schemas/agenttool.evm-evidence-transition-receipt-0.1.schema.json",
);
const evidenceFixture = repositoryJson(
  "packages/alchemy/fixtures/agenttool.evm-observation-evidence-0.1.json",
);
const transitionFixture = repositoryJson(
  "packages/alchemy/fixtures/agenttool.evm-evidence-transition-receipt-0.1.json",
);

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("shared EVM evidence schemas and vectors", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validateEvidence = ajv.compile(evidenceSchema);
  const validateTransition = ajv.compile(transitionSchema);

  test("validates the shared vectors as strict Draft 2020-12 structures", () => {
    expect(validateEvidence(evidenceFixture), JSON.stringify(validateEvidence.errors))
      .toBe(true);
    expect(validateTransition(transitionFixture), JSON.stringify(validateTransition.errors))
      .toBe(true);
    expect(parseEvmObservationEvidence(evidenceFixture)).toEqual(evidenceFixture);
    expect(parseEvmEvidenceTransitionReceipt(transitionFixture)).toEqual(
      transitionFixture,
    );
  });

  test("rejects unknown structural fields and inconsistent availability states", () => {
    const unknown = { ...(clone(evidenceFixture) as object), cursor: "not-wire-state" };
    expect(validateEvidence(unknown)).toBe(false);

    const unavailable = clone(evidenceFixture) as Record<string, unknown>;
    unavailable.observation_state = "unavailable";
    expect(validateEvidence(unavailable)).toBe(false);
  });

  test("keeps semantic/canonical validation explicitly stronger than JSON Schema", () => {
    const structurallyValid = clone(evidenceFixture) as {
      transfer: { quantity: { atomic_unit: string } };
    };
    structurallyValid.transfer.quantity.atomic_unit =
      "eip155:10/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48/base-unit";

    // JSON Schema cannot express equality with the sibling chain/contract
    // fields. parse* is the normative semantic and canonical validator.
    expect(validateEvidence(structurallyValid), JSON.stringify(validateEvidence.errors))
      .toBe(true);
    expect(() => parseEvmObservationEvidence(structurallyValid)).toThrow(
      "must exactly bind",
    );
  });

  test("keeps runtime timestamps inside the schema's four-digit UTC form", () => {
    const expandedWire = clone(evidenceFixture) as {
      basis: { observed_at: string };
    };
    expandedWire.basis.observed_at = "+010000-01-01T00:00:00.000Z";

    expect(validateEvidence(expandedWire)).toBe(false);
    expect(() => parseEvmObservationEvidence(expandedWire)).toThrow(
      "canonical UTC timestamp",
    );
    expect(() => adaptDepositObservationEvidence({
      chainId: "eip155:1",
      blockNumber: 21_000_000n,
      blockHash: `0x${"a".repeat(64)}`,
      transactionHash: `0x${"b".repeat(64)}`,
      logIndex: 7,
      contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      fromAddress: "0x1111111111111111111111111111111111111111",
      toAddress: "0x2222222222222222222222222222222222222222",
      atomicValue: "2500000",
      observationState: "live",
      finality: {
        canonicality: "canonical",
        confirmations: { status: "exact", count: "12" },
        settlement: "unsettled",
      },
      basis: {
        observationChannel: "combined",
        observedAt: "+010000-01-01T00:00:00.000Z",
        sourceReceiptDigest:
          "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      },
    })).toThrow("canonical UTC timestamp");
  });
});

describe("self-contained API conformance adapter", () => {
  test("emits byte-equivalent package evidence without a package runtime import", () => {
    const evidence = adaptDepositObservationEvidence({
      chainId: "eip155:1",
      blockNumber: 21_000_000n,
      blockHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      transactionHash:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      logIndex: 7,
      contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      fromAddress: "0x1111111111111111111111111111111111111111",
      toAddress: "0x2222222222222222222222222222222222222222",
      atomicValue: "2500000",
      observationState: "live",
      finality: {
        canonicality: "canonical",
        confirmations: { status: "exact", count: "12" },
        settlement: "unsettled",
      },
      basis: {
        observationChannel: "combined",
        observedAt: "2026-08-24T12:00:00.000Z",
        sourceReceiptDigest:
          "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      },
    });

    expect(evidence).toEqual(evidenceFixture);
    expect(parseEvmObservationEvidence(evidence)).toEqual(evidenceFixture);
    expect(Object.isFrozen(evidence)).toBe(true);

    const adapterSource = readFileSync(
      new URL(
        "../src/services/economy/crypto/observation-evidence.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(adapterSource).not.toContain('from "../../packages');
    expect(adapterSource).not.toContain("packages/alchemy/src");
    expect(adapterSource).not.toContain("fixtures/");
    expect(adapterSource).not.toContain("schemas/");
  });

  test("emits the same semantic transition receipt and applies no effect", () => {
    const receipt = adaptDepositEvidenceTransition({
      fromDigest: null,
      toDigest:
        "sha256:9ddba2f0894da2bb0d17aee7ec529efd01b907cb28227d3d3aa800514d822da0",
      relation: "initial_observation",
      preserved: [
        "chain_id",
        "block_generation",
        "transaction_identity",
        "transfer_parties",
        "atomic_quantity",
        "observation_state",
        "finality_axes",
        "basis",
      ],
      discarded: [],
      assumptions: [
        "chain_mapping_accepted",
        "current_generation_selected",
        "logical_event_equivalent",
        "observation_channel_authentic",
        "policy_supplied",
      ],
      counterexample: null,
      stopCondition: "continue_observing",
    });

    expect(receipt).toEqual(transitionFixture);
    expect(receipt.effect_boundary).toBe("semantic_only_no_state_change");
    expect(receipt.non_grants).toContain("authority");
    expect(receipt.non_grants).toContain("permission");
    expect(receipt.non_grants).toContain("truth");
  });

  test("rejects ordinary accessors without invoking them", () => {
    let getterCalls = 0;
    const accessored = {
      get fromDigest() {
        getterCalls += 1;
        return null;
      },
      toDigest:
        "sha256:9ddba2f0894da2bb0d17aee7ec529efd01b907cb28227d3d3aa800514d822da0" as const,
      relation: "initial_observation" as const,
      preserved: [
        "chain_id",
        "block_generation",
        "transaction_identity",
        "transfer_parties",
        "atomic_quantity",
        "observation_state",
        "finality_axes",
        "basis",
      ] as const,
      discarded: [] as const,
      assumptions: [] as const,
      counterexample: null,
      stopCondition: "no_effect" as const,
    };

    expect(() => adaptDepositEvidenceTransition(accessored)).toThrow(
      "accessors are not accepted",
    );
    expect(getterCalls).toBe(0);
  });

  test("does not admit cursor/provider continuation state or unavailable effects", () => {
    const source = JSON.stringify(evidenceFixture);
    expect(source).not.toContain("cursor");
    expect(source).not.toContain("pageKey");
    expect(source).not.toContain("endpoint");
    expect(source).not.toContain("credential");

    expect(() => adaptDepositObservationEvidence({
      chainId: "eip155:1",
      blockNumber: 1n,
      blockHash: `0x${"a".repeat(64)}`,
      transactionHash: `0x${"b".repeat(64)}`,
      logIndex: 0,
      contractAddress: "0x1111111111111111111111111111111111111111",
      fromAddress: null,
      toAddress: "0x2222222222222222222222222222222222222222",
      atomicValue: "1",
      observationState: "unavailable",
      finality: {
        canonicality: "canonical",
        confirmations: { status: "exact", count: "1" },
        settlement: "unsettled",
      },
      basis: {
        observationChannel: "rpc_read",
        observedAt: "2026-08-24T12:00:00.000Z",
        sourceReceiptDigest: null,
      },
    })).toThrow("unavailable state requires unavailable axes");
  });
});
