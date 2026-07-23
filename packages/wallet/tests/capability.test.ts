import { describe, expect, test } from "bun:test";

import {
  WalletProtocolError,
  assertAssetBelongsToSource,
  assertIntentWithinCapabilityStatic,
  sealSimulationReceipt,
  sealTransactionIntent,
  sealWalletCapability,
  sealWalletDescriptor,
} from "../src/index.js";
import {
  NATIVE_ASSET,
  capabilityCore,
  delegate,
  intentCore,
  descriptorCore,
  owner,
  signedBundle,
  simulator,
  simulationCore,
} from "./fixtures.js";

const OTHER_SOURCE = "eip155:84532:0x3333333333333333333333333333333333333333";

function context(overrides: Record<string, unknown> = {}) {
  return {
    now: "2026-07-21T10:02:00.000Z",
    usage: {
      revocation_nonce: 0,
      intent_count: 0,
      spent: [],
      host_verified_approval_ids: [],
    },
    ...overrides,
  } as any;
}

describe("static capability enforcement", () => {
  test("authorizes exact verified records inside all bounds", async () => {
    const bundle = await signedBundle();
    const authorization = assertIntentWithinCapabilityStatic({ ...bundle, context: context() });
    expect(authorization).toMatchObject({
      wallet_id: bundle.descriptor.wallet_id,
      capability_record_id: bundle.capability.record_id,
      intent_record_id: bundle.intent.record_id,
      simulation_record_id: bundle.simulation.record_id,
    });
  });

  test("requires records to have passed signature verification in this process", async () => {
    const bundle = await signedBundle();
    expect(() => assertIntentWithinCapabilityStatic({
      ...bundle,
      intent: structuredClone(bundle.intent) as any,
      context: context(),
    })).toThrow(/verify/);
  });

  test("never grants a source account absent from the bound descriptor", async () => {
    const descriptor = await sealWalletDescriptor(descriptorCore(), owner.signer);
    const capability = await sealWalletCapability(capabilityCore(descriptor, {
      accounts: [OTHER_SOURCE],
    }), owner.signer);
    const intent = await sealTransactionIntent(intentCore({
      descriptor,
      capability,
      overrides: { source_account: OTHER_SOURCE },
    }), delegate.signer);
    const simulation = await sealSimulationReceipt(simulationCore({ intent }), simulator.signer);
    expect(() => assertIntentWithinCapabilityStatic({
      descriptor,
      capability,
      intent,
      simulation,
      context: context(),
    })).toThrow(/absent from the bound wallet descriptor/i);
  });

  test("fails at exact capability, intent and simulation expiry boundaries", async () => {
    const bundle = await signedBundle();
    for (const now of [bundle.simulation.valid_until, bundle.intent.expires_at, bundle.capability.expires_at]) {
      expect(() => assertIntentWithinCapabilityStatic({ ...bundle, context: context({ now }) }))
        .toThrow(WalletProtocolError);
    }
  });

  test("rejects future-issued intents and simulations that predate their intent", async () => {
    const bundle = await signedBundle();
    const futureIntent = await sealTransactionIntent(intentCore({
      descriptor: bundle.descriptor,
      capability: bundle.capability,
      overrides: {
        issued_at: "2026-07-21T10:05:00.000Z",
        expires_at: "2026-07-21T10:06:00.000Z",
      },
    }), delegate.signer);
    const futureSimulation = await sealSimulationReceipt(simulationCore({
      intent: futureIntent,
      overrides: {
        simulated_at: "2026-07-21T10:05:15.000Z",
        valid_until: "2026-07-21T10:05:45.000Z",
      },
    }), simulator.signer);
    expect(() => assertIntentWithinCapabilityStatic({
      ...bundle,
      intent: futureIntent,
      simulation: futureSimulation,
      context: context(),
    })).toThrow(/intent lifetime/i);

    const intent = await sealTransactionIntent(intentCore({
      descriptor: bundle.descriptor,
      capability: bundle.capability,
      overrides: { issued_at: "2026-07-21T10:02:00.000Z" },
    }), delegate.signer);
    const staleSimulation = await sealSimulationReceipt(simulationCore({ intent }), simulator.signer);
    expect(() => assertIntentWithinCapabilityStatic({
      ...bundle,
      intent,
      simulation: staleSimulation,
      context: context(),
    })).toThrow(/simulation is not current/i);
  });

  test("rechecks revocation epoch, usage count and cumulative spend at sign time", async () => {
    const bundle = await signedBundle();
    expect(() => assertIntentWithinCapabilityStatic({
      ...bundle,
      context: context({ usage: { ...context().usage, revocation_nonce: 1 } }),
    })).toThrow(/revocation/i);
    expect(() => assertIntentWithinCapabilityStatic({
      ...bundle,
      context: context({ usage: { ...context().usage, intent_count: 3 } }),
    })).toThrow(/exhausted/i);
    expect(() => assertIntentWithinCapabilityStatic({
      ...bundle,
      context: context({
        usage: {
          ...context().usage,
          spent: [{ asset_id: NATIVE_ASSET, amount_atomic: "16" }],
        },
      }),
    })).toThrow(/cumulative/i);
  });

  test("successful simulation cannot bypass a capability target denial", async () => {
    const bundle = await signedBundle();
    const changed = simulationCore({
      intent: bundle.intent,
      overrides: {
        effects: [{
          action: "transfer",
          target_account: "eip155:84532:0x9999999999999999999999999999999999999999",
          method: null,
          asset_id: NATIVE_ASSET,
          amount_atomic: "10",
        }],
      },
    });
    const simulation = await sealSimulationReceipt(changed, simulator.signer);
    expect(() => assertIntentWithinCapabilityStatic({ ...bundle, simulation, context: context() }))
      .toThrow(/outside the allowlist/i);
  });

  test("simulation effects must exactly match declared aggregate spends", async () => {
    const bundle = await signedBundle();
    const changed = simulationCore({
      intent: bundle.intent,
      overrides: {
        effects: [{
          action: "transfer",
          target_account: bundle.intent.calls[0]!.target_account,
          method: null,
          asset_id: NATIVE_ASSET,
          amount_atomic: "9",
        }],
      },
    });
    const simulation = await sealSimulationReceipt(changed, simulator.signer);
    expect(() => assertIntentWithinCapabilityStatic({ ...bundle, simulation, context: context() }))
      .toThrow(/do not equal/i);
  });

  test("counts distinct host-verified approval IDs for approval-gated rules", async () => {
    const bundle = await signedBundle();
    const capability = await sealWalletCapability(capabilityCore(bundle.descriptor, {
      approval_threshold: 2,
      call_rules: [{ ...bundle.capability.call_rules[0]!, requires_approval: true }],
    }), owner.signer);
    const intent = await sealTransactionIntent(intentCore({
      descriptor: bundle.descriptor,
      capability,
    }), delegate.signer);
    const simulation = await sealSimulationReceipt(simulationCore({ intent }), simulator.signer);

    expect(() => assertIntentWithinCapabilityStatic({
      descriptor: bundle.descriptor,
      capability,
      intent,
      simulation,
      context: context(),
    })).toThrow(/requires more distinct host-verified approval IDs/i);
    expect(assertIntentWithinCapabilityStatic({
      descriptor: bundle.descriptor,
      capability,
      intent,
      simulation,
      context: context({
        usage: { ...context().usage, host_verified_approval_ids: ["one", "two"] },
      }),
    }).grant_id).toBe(capability.grant_id);

    expect(() => assertIntentWithinCapabilityStatic({
      descriptor: bundle.descriptor,
      capability,
      intent,
      simulation,
      context: context({
        usage: { ...context().usage, host_verified_approval_ids: ["same", "same"] },
      }),
    })).toThrow(/distinct/i);
  });

  test("validates CAIP syntax before comparing asset and source chains", () => {
    expect(() => assertAssetBelongsToSource(NATIVE_ASSET, "not-an-account"))
      .toThrow(/CAIP-2 chain/i);
    expect(() => assertAssetBelongsToSource("not-an-asset", OTHER_SOURCE))
      .toThrow(/CAIP-2\/asset/i);
  });
});
