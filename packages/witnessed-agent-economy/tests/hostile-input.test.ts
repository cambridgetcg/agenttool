import { describe, expect, test } from "bun:test";

import {
  capabilityConsumeNullifier,
  createSettlementBatchProjection,
  createSettlementLeaf,
  createWitnessRecord,
  decodeWitnessCanonicalJson,
  projectCapabilityConsume,
  projectCapabilityRevoke,
  projectCollaborationCheckpoint,
  projectPublicOfferRevoke,
  projectPublicOfferSupersede,
  projectPublicRecognitionWithdrawal,
  projectPublicWakeSupersede,
  projectPublicWakeWithdrawal,
  rfc6962InclusionProof,
  rfc6962MerkleRoot,
  verifyPublicWakeWithdrawalForContract,
  verifyRfc6962Inclusion,
  validateSingleKeyControlAuthority,
} from "../src/index.js";

function accessorObject(keys: readonly string[]) {
  let calls = 0;
  const value: Record<string, unknown> = {};
  for (const [index, key] of keys.entries()) {
    if (index === 0) {
      Object.defineProperty(value, key, {
        enumerable: true,
        get() {
          calls += 1;
          throw new Error("getter must never execute");
        },
      });
    } else {
      Object.defineProperty(value, key, { enumerable: true, value: null });
    }
  }
  return { value, calls: () => calls };
}

function expectGetterRefused(
  keys: readonly string[],
  invoke: (value: Record<string, unknown>) => unknown,
): void {
  const hostile = accessorObject(keys);
  expect(() => invoke(hostile.value)).toThrow();
  expect(hostile.calls()).toBe(0);
}

describe("hostile wrapper totality", () => {
  test("projection option objects are closed before any property dereference", () => {
    const cases: Array<[readonly string[], (value: Record<string, unknown>) => unknown]> = [
      [[
        "audience", "subject_ref", "capability_ref", "grant_commitment", "asset_ref",
        "source_event_digest",
      ], (value) => capabilityConsumeNullifier(value as never)],
      [["capability", "intent", "grant_commitment", "audience"], (value) => projectCapabilityConsume(value as never)],
      [["capability", "continuity_event", "grant_commitment"], (value) => projectCapabilityRevoke(value as never)],
      [["adoption", "withdrawal", "adoption_commitment"], (value) => projectPublicRecognitionWithdrawal(value as never)],
      [["previous_offer", "next_offer", "supersedes"], (value) => projectPublicOfferSupersede(value as never)],
      [["previous_offer", "revoke_offer", "offer_commitment"], (value) => projectPublicOfferRevoke(value as never)],
      [["previous_contract", "next_contract", "supersedes"], (value) => projectPublicWakeSupersede(value as never)],
      [["contract", "withdrawal", "checkpoint_commitment"], (value) => projectPublicWakeWithdrawal(value as never)],
      [["contract", "withdrawal"], (value) => verifyPublicWakeWithdrawalForContract(value as never)],
      [["receipts", "independently_pinned_platform_key_hex", "previous_batch"], (value) => createSettlementBatchProjection(value as never)],
      [["workspace", "events", "participant_blinding_key_hex"], (value) => projectCollaborationCheckpoint(value as never)],
    ];
    for (const [keys, invoke] of cases) expectGetterRefused(keys, invoke);

    const leafOptions = accessorObject(["independently_pinned_platform_key_hex"]);
    expect(() => createSettlementLeaf(null, leafOptions.value as never)).toThrow();
    expect(leafOptions.calls()).toBe(0);
  });

  test("proxies and decorated arrays cannot run callbacks", () => {
    let proxyGets = 0;
    const proxy = new Proxy({}, {
      get() {
        proxyGets += 1;
        throw new Error("proxy get must never execute");
      },
    });
    expect(() => projectCapabilityConsume(proxy as never)).toThrow(/proxy/i);
    expect(proxyGets).toBe(0);

    expect(() => validateSingleKeyControlAuthority(proxy as never, "$authority")).toThrow(/proxy/i);
    expect(proxyGets).toBe(0);

    let arrayGets = 0;
    const decorated: unknown[] = [{}];
    Object.defineProperty(decorated, "trap", {
      enumerable: true,
      get() {
        arrayGets += 1;
        throw new Error("array getter must never execute");
      },
    });
    expect(() => rfc6962MerkleRoot(decorated)).toThrow();
    expect(() => rfc6962InclusionProof(decorated, 0)).toThrow();
    expect(() => createSettlementBatchProjection({
      receipts: decorated,
      independently_pinned_platform_key_hex: "11".repeat(32),
      previous_batch: null,
    })).toThrow();
    expect(() => projectCollaborationCheckpoint({
      workspace: {},
      events: decorated,
      participant_blinding_key_hex: "11".repeat(32),
    })).toThrow();
    expect(arrayGets).toBe(0);

    const verifyOptions = accessorObject([
      "value", "index", "tree_size", "proof", "expected_root_hex",
    ]);
    expect(verifyRfc6962Inclusion(verifyOptions.value as never)).toBe(false);
    expect(verifyOptions.calls()).toBe(0);
  });

  test("malformed nested fields fail with protocol errors, never native coercion", () => {
    const opaqueObject = Object.create(null) as Record<string, unknown>;
    for (const field of [
      "subject_ref", "capability_ref", "grant_commitment", "asset_ref", "source_event_digest",
    ]) {
      const candidate = {
        audience: "kingdom:offline-shadow",
        subject_ref: "11".repeat(32),
        capability_ref: "11".repeat(32),
        grant_commitment: `sha256:${"22".repeat(32)}`,
        asset_ref: `sha256:${"33".repeat(32)}`,
        source_event_digest: `sha256:${"44".repeat(32)}`,
        [field]: opaqueObject,
      };
      try {
        capabilityConsumeNullifier(candidate as never);
        throw new Error("expected protocol rejection");
      } catch (error) {
        expect(error).toMatchObject({ name: "WitnessProjectionError", code: "INVALID_INPUT" });
      }
    }
  });

  test("createWitnessRecord inspects every non-callback field before signing", async () => {
    const input = accessorObject([
      "kind", "action", "audience", "subject_ref", "sequence", "parent", "issuer",
      "policy_digest", "expiry_height", "payload", "signer",
    ]);
    await expect(createWitnessRecord(input.value as never)).rejects.toThrow();
    expect(input.calls()).toBe(0);
  });
});

describe("hostile canonical byte input", () => {
  test("rejects proxies, subclasses and decorated byte views without invoking hooks", () => {
    const ordinary = new TextEncoder().encode('{"a":1}');

    let proxyGets = 0;
    const proxy = new Proxy(ordinary, {
      get() {
        proxyGets += 1;
        throw new Error("typed-array proxy get must never execute");
      },
    });
    expect(() => decodeWitnessCanonicalJson(proxy as never)).toThrow(/non-proxy/u);
    expect(proxyGets).toBe(0);

    let speciesCalls = 0;
    class HostileBytes extends Uint8Array {
      static get [Symbol.species](): Uint8ArrayConstructor {
        speciesCalls += 1;
        throw new Error("species must never execute");
      }
    }
    const subclass = new HostileBytes(ordinary);
    expect(() => decodeWitnessCanonicalJson(subclass)).toThrow(/subclass/u);
    expect(speciesCalls).toBe(0);

    let sliceCalls = 0;
    const decorated = new Uint8Array(ordinary);
    Object.defineProperty(decorated, "slice", {
      enumerable: true,
      get() {
        sliceCalls += 1;
        throw new Error("slice getter must never execute");
      },
    });
    expect(() => decodeWitnessCanonicalJson(decorated)).toThrow(/decorated/u);
    expect(sliceCalls).toBe(0);

    let lengthCalls = 0;
    const lengthDecorated = new Uint8Array(ordinary);
    Object.defineProperty(lengthDecorated, "byteLength", {
      enumerable: true,
      get() {
        lengthCalls += 1;
        throw new Error("byteLength getter must never execute");
      },
    });
    expect(() => decodeWitnessCanonicalJson(lengthDecorated)).toThrow(/decorated/u);
    expect(lengthCalls).toBe(0);
  });

  test("rejects detached buffers and every non-canonical wire form", () => {
    const detached = new Uint8Array(new ArrayBuffer(4));
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(() => decodeWitnessCanonicalJson(detached)).toThrow(/detached/u);

    const bytes = (value: string) => new TextEncoder().encode(value);
    expect(() => decodeWitnessCanonicalJson(bytes('{"a":"\\u0062"}'))).toThrow(/unique canonical/u);
    expect(() => decodeWitnessCanonicalJson(bytes('{"a":01}'))).toThrow(/valid JSON/u);
    expect(() => decodeWitnessCanonicalJson(bytes('{"a":9007199254740992}'))).toThrow(/safely represented/u);
    expect(() => decodeWitnessCanonicalJson(new Uint8Array([0xff]))).toThrow(/valid UTF-8/u);
    expect(() => decodeWitnessCanonicalJson(bytes('{"a":1}\n'))).toThrow(/unique canonical/u);
  });
});
