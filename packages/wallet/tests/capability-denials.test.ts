import { describe, expect, test } from "bun:test";

import {
  WalletProtocolError,
  assertAssetBelongsToSource,
  assertIntentWithinCapabilityStatic,
  sealSimulationReceipt,
  sealTransactionIntent,
  sealWalletCapability,
  sealWalletDescriptor,
  sha256BytesId,
  type CallRule,
  type SimulationReceiptCore,
  type TransactionIntentCore,
  type WalletCapabilityCore,
  type WalletDescriptorCore,
  type WalletProtocolErrorCode,
} from "../src/index.js";
import {
  NATIVE_ASSET,
  SOURCE,
  TARGET,
  capabilityCore,
  delegate,
  descriptorCore,
  intentCore,
  owner,
  replacement,
  simulationCore,
  simulator,
} from "./fixtures.js";

const OTHER_SOURCE = "eip155:84532:0x3333333333333333333333333333333333333333";
const TOKEN = "eip155:84532/erc20:0x4444444444444444444444444444444444444444";
const PAYLOAD = { payload_b64u: "AQ", payload_hash: sha256BytesId(new Uint8Array([1])) };

function usage(overrides: Record<string, unknown> = {}) {
  return {
    revocation_nonce: 0,
    intent_count: 0,
    spent: [],
    host_verified_approval_ids: [],
    ...overrides,
  };
}

function context(overrides: Record<string, unknown> = {}) {
  return { now: "2026-07-21T10:02:00.000Z", usage: usage(), ...overrides } as any;
}

async function bundleWith(overrides: {
  descriptor?: Partial<WalletDescriptorCore>;
  capability?: Partial<WalletCapabilityCore>;
  intent?: Partial<TransactionIntentCore>;
  simulation?: Partial<SimulationReceiptCore>;
} = {}) {
  const descriptor = await sealWalletDescriptor(descriptorCore(overrides.descriptor), owner.signer);
  const capability = await sealWalletCapability(
    capabilityCore(descriptor, overrides.capability),
    owner.signer,
  );
  const intent = await sealTransactionIntent(
    intentCore({ descriptor, capability, overrides: overrides.intent ?? {} }),
    delegate.signer,
  );
  const simulation = await sealSimulationReceipt(
    simulationCore({ intent, overrides: overrides.simulation ?? {} }),
    simulator.signer,
  );
  return { descriptor, capability, intent, simulation };
}

function expectRefusal(run: () => unknown, code: WalletProtocolErrorCode, message: RegExp): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(WalletProtocolError);
  expect((caught as WalletProtocolError).code).toBe(code);
  expect((caught as WalletProtocolError).message).toMatch(message);
}

function rule(actions: CallRule["actions"], methods: string[], requires_approval: boolean): CallRule {
  return { target_account: TARGET, actions, methods, requires_approval };
}

function callIntent(action: "call" | "approve", method: string): Partial<TransactionIntentCore> {
  return {
    calls: [{ action, target_account: TARGET, method, ...PAYLOAD, native_value: null }],
    declared_spends: [],
  };
}

const NO_EFFECTS: Partial<SimulationReceiptCore> = { effects: [] };

describe("record binding denials", () => {
  test("refuses a capability bound to a different descriptor record", async () => {
    const bundle = await bundleWith();
    const other = await sealWalletDescriptor(descriptorCore({ recovery_mode: "none" }), owner.signer);
    expectRefusal(
      () => assertIntentWithinCapabilityStatic({ ...bundle, descriptor: other, context: context() }),
      "AUTHORITY_MISMATCH",
      /not bound to this wallet descriptor/i,
    );
  });

  test("refuses a capability whose issuer is not the descriptor authority", async () => {
    const bundle = await bundleWith();
    const capability = await sealWalletCapability(
      capabilityCore(bundle.descriptor, { issuer: replacement.key }),
      replacement.signer,
    );
    expectRefusal(
      () => assertIntentWithinCapabilityStatic({ ...bundle, capability, context: context() }),
      "AUTHORITY_MISMATCH",
      /issuer is not the descriptor authority/i,
    );
  });

  test("refuses an intent that references another grant", async () => {
    const bundle = await bundleWith({ intent: { grant_id: "99999999-9999-4999-8999-999999999999" } });
    expectRefusal(
      () => assertIntentWithinCapabilityStatic({ ...bundle, context: context() }),
      "CAPABILITY_DENIED",
      /intent references do not bind/i,
    );
  });

  test("refuses an intent signed by a substituted delegate", async () => {
    const bundle = await bundleWith();
    const intent = await sealTransactionIntent(intentCore({
      descriptor: bundle.descriptor,
      capability: bundle.capability,
      overrides: { delegate: replacement.key },
    }), replacement.signer);
    const simulation = await sealSimulationReceipt(simulationCore({ intent }), simulator.signer);
    expectRefusal(
      () => assertIntentWithinCapabilityStatic({ ...bundle, intent, simulation, context: context() }),
      "CAPABILITY_DENIED",
      /delegate does not match/i,
    );
  });

  test("refuses a simulation that does not bind the exact intent", async () => {
    const bundle = await bundleWith({
      simulation: { intent_id: "99999999-9999-4999-8999-999999999999" },
    });
    expectRefusal(
      () => assertIntentWithinCapabilityStatic({ ...bundle, context: context() }),
      "SIMULATION_INVALID",
      /does not bind the exact intent/i,
    );
  });
});

describe("descriptor, time and simulation-state denials", () => {
  test("a watch-only descriptor cannot authorize signing", async () => {
    const bundle = await bundleWith({ descriptor: { custody_mode: "watch_only" } });
    expectRefusal(
      () => assertIntentWithinCapabilityStatic({ ...bundle, context: context() }),
      "CAPABILITY_DENIED",
      /watch-only/i,
    );
  });

  test("refuses before the capability's not_before", async () => {
    const bundle = await bundleWith({ capability: { not_before: "2026-07-21T10:03:00.000Z" } });
    expectRefusal(
      () => assertIntentWithinCapabilityStatic({ ...bundle, context: context() }),
      "CAPABILITY_INACTIVE",
      /not active at sign time/i,
    );
  });

  test("refuses a capability issued before its descriptor existed", async () => {
    const bundle = await bundleWith({ descriptor: { created_at: "2026-07-21T10:00:30.000Z" } });
    expectRefusal(
      () => assertIntentWithinCapabilityStatic({ ...bundle, context: context() }),
      "CAPABILITY_INACTIVE",
      /chronology/i,
    );
  });

  test("refuses an intent issued before its capability", async () => {
    const bundle = await bundleWith({ intent: { issued_at: "2026-07-21T09:59:00.000Z" } });
    expectRefusal(
      () => assertIntentWithinCapabilityStatic({ ...bundle, context: context() }),
      "CAPABILITY_INACTIVE",
      /chronology/i,
    );
  });

  test("refuses an intent that outlives its capability", async () => {
    const bundle = await bundleWith({ capability: { expires_at: "2026-07-21T10:04:00.000Z" } });
    expectRefusal(
      () => assertIntentWithinCapabilityStatic({ ...bundle, context: context() }),
      "CAPABILITY_INACTIVE",
      /intent lifetime is outside/i,
    );
  });

  test("refuses a failed simulation", async () => {
    const bundle = await bundleWith({ simulation: { success: false } });
    expectRefusal(
      () => assertIntentWithinCapabilityStatic({ ...bundle, context: context() }),
      "SIMULATION_INVALID",
      /reverted or otherwise failed/i,
    );
  });

  test("refuses a descriptor account the capability does not grant", async () => {
    const bundle = await bundleWith({
      descriptor: {
        accounts: [
          { account_id: SOURCE, account_kind: "smart_account" },
          { account_id: OTHER_SOURCE, account_kind: "smart_account" },
        ],
      },
      intent: { source_account: OTHER_SOURCE },
    });
    expectRefusal(
      () => assertIntentWithinCapabilityStatic({ ...bundle, context: context() }),
      "CAPABILITY_DENIED",
      /source account is not granted/i,
    );
  });
});

describe("call rule allowlist and approval gating", () => {
  test("allowlists call methods exactly", async () => {
    const capability = { call_rules: [rule(["call"], ["mint"], false)] };
    const allowed = await bundleWith({ capability, intent: callIntent("call", "mint"), simulation: NO_EFFECTS });
    expect(assertIntentWithinCapabilityStatic({ ...allowed, context: context() }).grant_id)
      .toBe(allowed.capability.grant_id);

    const denied = await bundleWith({ capability, intent: callIntent("call", "burn"), simulation: NO_EFFECTS });
    expectRefusal(
      () => assertIntentWithinCapabilityStatic({ ...denied, context: context() }),
      "CAPABILITY_DENIED",
      /outside the target\/action\/method allowlist/i,
    );
  });

  test("allowlists approve methods exactly", async () => {
    const bundle = await bundleWith({
      capability: { call_rules: [rule(["approve"], ["approve"], false)] },
      intent: callIntent("approve", "increaseAllowance"),
      simulation: NO_EFFECTS,
    });
    expectRefusal(
      () => assertIntentWithinCapabilityStatic({ ...bundle, context: context() }),
      "CAPABILITY_DENIED",
      /outside the target\/action\/method allowlist/i,
    );
  });

  test("gates an approval-required simulation effect behind an ungated call", async () => {
    const bundle = await bundleWith({
      capability: {
        approval_threshold: 1,
        call_rules: [rule(["call"], ["mint"], false), rule(["transfer"], [], true)],
      },
      intent: {
        calls: [{
          action: "call",
          target_account: TARGET,
          method: "mint",
          ...PAYLOAD,
          native_value: { asset_id: NATIVE_ASSET, amount_atomic: "5" },
        }],
        declared_spends: [{ asset_id: NATIVE_ASSET, amount_atomic: "5" }],
      },
      simulation: {
        effects: [
          { action: "call", target_account: TARGET, method: "mint", asset_id: null, amount_atomic: "0" },
          { action: "transfer", target_account: TARGET, method: null, asset_id: NATIVE_ASSET, amount_atomic: "5" },
        ],
      },
    });
    expectRefusal(
      () => assertIntentWithinCapabilityStatic({ ...bundle, context: context() }),
      "CAPABILITY_DENIED",
      /simulation effect requires more distinct host-verified approval IDs/i,
    );
    expect(assertIntentWithinCapabilityStatic({
      ...bundle,
      context: context({ usage: usage({ host_verified_approval_ids: ["one"] }) }),
    }).grant_id).toBe(bundle.capability.grant_id);
  });

  test("overlapping call rules require approval when any matching rule does, whatever the sort order", async () => {
    for (const other of ["a", "z"]) {
      const bundle = await bundleWith({
        capability: {
          approval_threshold: 1,
          call_rules: [rule(["call"], [other, "m"].sort(), false), rule(["call"], ["m"], true)]
            .sort((left, right) => left.methods.join(",") < right.methods.join(",") ? -1 : 1),
        },
        intent: callIntent("call", "m"),
        simulation: NO_EFFECTS,
      });
      expectRefusal(
        () => assertIntentWithinCapabilityStatic({ ...bundle, context: context() }),
        "CAPABILITY_DENIED",
        /intent call requires more distinct host-verified approval IDs/i,
      );
      expect(assertIntentWithinCapabilityStatic({
        ...bundle,
        context: context({ usage: usage({ host_verified_approval_ids: ["one"] }) }),
      }).grant_id, other).toBe(bundle.capability.grant_id);
    }
  });

  test("a mixed call/transfer rule cannot lift the approval gate of a transfer rule", async () => {
    const bundle = await bundleWith({
      capability: {
        approval_threshold: 1,
        call_rules: [rule(["call", "transfer"], ["noop"], false), rule(["transfer"], [], true)],
      },
    });
    expectRefusal(
      () => assertIntentWithinCapabilityStatic({ ...bundle, context: context() }),
      "CAPABILITY_DENIED",
      /intent call requires more distinct host-verified approval IDs/i,
    );
  });

  test("overlapping ungated rules still allowlist", async () => {
    const bundle = await bundleWith({
      capability: {
        call_rules: [rule(["call"], ["a", "m"], false), rule(["call"], ["m"], false)],
      },
      intent: callIntent("call", "m"),
      simulation: NO_EFFECTS,
    });
    expect(assertIntentWithinCapabilityStatic({ ...bundle, context: context() }).grant_id)
      .toBe(bundle.capability.grant_id);
  });
});

describe("spend and fee denials", () => {
  test("refuses a declared spend that omits native call value", async () => {
    const bundle = await bundleWith({ intent: { declared_spends: [] }, simulation: NO_EFFECTS });
    expectRefusal(
      () => assertIntentWithinCapabilityStatic({ ...bundle, context: context() }),
      "CAPABILITY_DENIED",
      /omits native value/i,
    );
  });

  test("refuses an asset without a spend limit", async () => {
    const bundle = await bundleWith({ capability: { spend_limits: [] } });
    expectRefusal(
      () => assertIntentWithinCapabilityStatic({ ...bundle, context: context() }),
      "CAPABILITY_DENIED",
      /no spend limit grants asset/i,
    );
  });

  test("refuses a spend over the per-intent limit", async () => {
    const bundle = await bundleWith({
      capability: { spend_limits: [{ asset_id: NATIVE_ASSET, max_per_intent: "5", max_total: "25" }] },
    });
    expectRefusal(
      () => assertIntentWithinCapabilityStatic({ ...bundle, context: context() }),
      "CAPABILITY_DENIED",
      /per-intent spend limit exceeded/i,
    );
  });

  test("refuses a simulation fee in another asset or above the intent bound", async () => {
    for (const estimated_fee of [
      { asset_id: TOKEN, amount_atomic: "1" },
      { asset_id: NATIVE_ASSET, amount_atomic: "3" },
    ]) {
      const bundle = await bundleWith({ simulation: { estimated_fee } });
      expectRefusal(
        () => assertIntentWithinCapabilityStatic({ ...bundle, context: context() }),
        "SIMULATION_INVALID",
        /fee exceeds or changes the intent fee bound/i,
      );
    }
  });

  test("refuses an intent fee outside the capability fee limit", async () => {
    for (const fee_limits of [
      [{ asset_id: NATIVE_ASSET, max_per_intent: "1" }],
      [{ asset_id: TOKEN, max_per_intent: "2" }],
    ]) {
      const bundle = await bundleWith({ capability: { fee_limits } });
      expectRefusal(
        () => assertIntentWithinCapabilityStatic({ ...bundle, context: context() }),
        "CAPABILITY_DENIED",
        /outside the capability fee limit/i,
      );
    }
  });

  test("refuses an asset on a different chain from the source account", () => {
    expect(() => assertAssetBelongsToSource(NATIVE_ASSET, SOURCE)).not.toThrow();
    expectRefusal(
      () => assertAssetBelongsToSource(NATIVE_ASSET, "eip155:1:0x1111111111111111111111111111111111111111"),
      "CAPABILITY_DENIED",
      /chains differ/i,
    );
  });
});

describe("authorization context snapshot", () => {
  test("refuses malformed or open contexts", async () => {
    const bundle = await bundleWith();
    const cases: Array<[unknown, RegExp]> = [
      [null, /plain object/i],
      [{ ...context(), extra: true }, /must contain exactly/i],
      [context({ now: "yesterday" }), /authorization\.now/i],
      [context({ usage: null }), /usage is required/i],
      [context({ usage: usage({ revocation_nonce: -1 }) }), /non-negative safe integers/i],
      [context({ usage: usage({ spent: {} }) }), /spent must be an array/i],
      [context({ usage: usage({ spent: [null] }) }), /spent entries must be objects/i],
      [context({ usage: usage({ spent: [{ asset_id: "nope", amount_atomic: "1" }] }) }), /spent\[0\]\.asset_id/i],
      [context({ usage: usage({ spent: [{ asset_id: NATIVE_ASSET, amount_atomic: "01" }] }) }), /spent\[0\]\.amount_atomic/i],
      [context({
        usage: usage({
          spent: [
            { asset_id: NATIVE_ASSET, amount_atomic: "1" },
            { asset_id: TOKEN, amount_atomic: "1" },
          ],
        }),
      }), /sorted and unique/i],
      [context({ usage: usage({ spent: [{ asset_id: NATIVE_ASSET, amount_atomic: "1", note: "x" }] }) }), /must contain exactly/i],
      [context({ usage: usage({ host_verified_approval_ids: "one" }) }), /must be an array/i],
      [context({ usage: usage({ host_verified_approval_ids: [""] }) }), /non-empty string/i],
      [context({ usage: usage({ extra: 1 }) }), /must contain exactly/i],
    ];
    for (const [supplied, message] of cases) {
      expectRefusal(
        () => assertIntentWithinCapabilityStatic({ ...bundle, context: supplied as any }),
        "INVALID_INPUT",
        message,
      );
    }
  });

  async function approvalGated() {
    return bundleWith({
      capability: {
        approval_threshold: 2,
        call_rules: [rule(["transfer"], [], true)],
      },
    });
  }

  test("refuses an approval list whose custom iterator hides duplicates", async () => {
    const bundle = await approvalGated();
    const approvals = ["same", "same"];
    Object.defineProperty(approvals, Symbol.iterator, {
      value: function* () {
        yield "same";
      },
    });
    expectRefusal(
      () => assertIntentWithinCapabilityStatic({
        ...bundle,
        context: context({ usage: usage({ host_verified_approval_ids: approvals }) }),
      }),
      "INVALID_INPUT",
      /arrays must be dense and contain only index properties/i,
    );
  });

  test("refuses accessor-backed usage without invoking it", async () => {
    const bundle = await approvalGated();
    let invoked = false;
    const supplied = usage();
    Object.defineProperty(supplied, "host_verified_approval_ids", {
      enumerable: true,
      get() {
        invoked = true;
        return ["one", "two"];
      },
    });
    expectRefusal(
      () => assertIntentWithinCapabilityStatic({ ...bundle, context: context({ usage: supplied }) }),
      "INVALID_INPUT",
      /not accessors/i,
    );
    expect(invoked).toBe(false);
  });

  test("reads each option once, so later checks cannot see a different context", async () => {
    const bundle = await approvalGated();
    const reads: Record<string, number> = {};
    const options = {} as Parameters<typeof assertIntentWithinCapabilityStatic>[0];
    for (const key of ["descriptor", "capability", "intent", "simulation", "context"] as const) {
      Object.defineProperty(options, key, {
        enumerable: true,
        get() {
          reads[key] = (reads[key] ?? 0) + 1;
          if (key !== "context") return bundle[key];
          return reads[key] === 1
            ? context()
            : context({ usage: usage({ host_verified_approval_ids: ["one", "two"] }) });
        },
      });
    }
    expectRefusal(
      () => assertIntentWithinCapabilityStatic(options),
      "CAPABILITY_DENIED",
      /requires more distinct host-verified approval IDs/i,
    );
    expect(reads).toEqual({ descriptor: 1, capability: 1, intent: 1, simulation: 1, context: 1 });
  });
});
