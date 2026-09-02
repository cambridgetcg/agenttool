import { describe, expect, test } from "bun:test";
import {
  canonicalJsonBytes,
  concatBytes,
  sha256BytesId,
  type Sha256Id,
} from "@agenttool/wallet";

import {
  ECONOMY_DURABLE_PLAN_HASH_DOMAIN,
  assertZeroneEconomyDirectSignPlan,
  reconstructZeroneEconomyDirectSignPlan,
  zeroneEconomyDirectSignPlanContentId,
  type CreateZeroneEconomyDirectSignPlanInput,
  type ReconstructZeroneEconomyDirectSignPlanInput,
} from "../src/index.js";
import {
  ACTIVATION_OBSERVATION,
  SECP_PUBLIC_KEY,
  accountObservation,
  defaultProjections,
  planFor,
  vector,
  walletBundle,
} from "./fixtures.js";

type WalletBundle = Awaited<ReturnType<typeof walletBundle>>;

function reconstructionInput(
  bundle: WalletBundle,
  expectedPlanContentId: Sha256Id,
  overrides: Partial<CreateZeroneEconomyDirectSignPlanInput> = {},
): ReconstructZeroneEconomyDirectSignPlanInput {
  return {
    expected_plan_content_id: expectedPlanContentId,
    intent: bundle.intent,
    projections: bundle.projections,
    network: "testnet",
    signer_public_key: SECP_PUBLIC_KEY,
    account_observation: accountObservation(),
    activation_observation: ACTIVATION_OBSERVATION,
    fee_amount_uzrn: vector.profile.fee_amount_uzrn,
    gas_limit: vector.profile.gas_limit,
    ...overrides,
  };
}

describe("full durable economy-plan commitment", () => {
  test("uses the exact domain and deterministically commits the complete branded plan", async () => {
    const { plan } = await planFor();
    const contentId = zeroneEconomyDirectSignPlanContentId(plan);
    const independentlyComputed = sha256BytesId(concatBytes(
      new TextEncoder().encode(
        "agent-wallet-zerone-economy-durable-plan/v1\0",
      ),
      canonicalJsonBytes(plan),
    ));

    expect(ECONOMY_DURABLE_PLAN_HASH_DOMAIN).toBe(
      "agent-wallet-zerone-economy-durable-plan/v1\0",
    );
    expect(contentId).toBe(independentlyComputed);
    expect(contentId).toBe(
      "sha256:df04f9c4d40bacd462e97c8336eafb41950bc7c9fb0110ea9c077b4732e601d7",
    );
    expect(contentId).toBe(zeroneEconomyDirectSignPlanContentId(plan));
    expect(contentId).not.toBe(plan.plan_id);
  });

  test("reconstructs only through the original verified inputs and restores a new brand", async () => {
    const { bundle, plan } = await planFor();
    const expectedPlanContentId = zeroneEconomyDirectSignPlanContentId(plan);
    const reconstructed = reconstructZeroneEconomyDirectSignPlan(
      reconstructionInput(bundle, expectedPlanContentId),
    );

    expect(reconstructed).not.toBe(plan);
    expect(reconstructed).toEqual(plan);
    expect(zeroneEconomyDirectSignPlanContentId(reconstructed)).toBe(
      expectedPlanContentId,
    );
    expect(() => assertZeroneEconomyDirectSignPlan(reconstructed)).not.toThrow();
  });

  test("rejects an otherwise valid reconstruction under the wrong commitment", async () => {
    const { bundle } = await planFor();
    expect(() => reconstructZeroneEconomyDirectSignPlan(
      reconstructionInput(bundle, `sha256:${"0".repeat(64)}`),
    )).toThrow(/expected full durable content commitment/u);
  });

  test("rejects valid fee, account, activation, and projection substitutions", async () => {
    const { bundle, plan } = await planFor();
    const expectedPlanContentId = zeroneEconomyDirectSignPlanContentId(plan);
    const substitutions: readonly [string, ReconstructZeroneEconomyDirectSignPlanInput][] = [
      [
        "fee",
        reconstructionInput(bundle, expectedPlanContentId, {
          fee_amount_uzrn: "144445",
        }),
      ],
      [
        "account",
        reconstructionInput(bundle, expectedPlanContentId, {
          account_observation: accountObservation({ sequence: "10" }),
        }),
      ],
      [
        "activation",
        reconstructionInput(bundle, expectedPlanContentId, {
          activation_observation: {
            ...ACTIVATION_OBSERVATION,
            observed_at_height: "699999",
          },
        }),
      ],
    ];

    for (const [, input] of substitutions) {
      expect(() => reconstructZeroneEconomyDirectSignPlan(input)).toThrow(
        /expected full durable content commitment/u,
      );
    }

    const fulfill = defaultProjections()[2]!;
    const alternateBundle = await walletBundle({
      projections: [fulfill],
      declared_spends: [],
    });
    expect(() => reconstructZeroneEconomyDirectSignPlan(
      reconstructionInput(alternateBundle, expectedPlanContentId),
    )).toThrow(/expected full durable content commitment/u);
  });

  test("never treats cloned or serialized plan JSON as a branded plan", async () => {
    const { bundle, plan } = await planFor();
    const expectedPlanContentId = zeroneEconomyDirectSignPlanContentId(plan);
    const serializedPlan = JSON.parse(JSON.stringify(plan)) as typeof plan;

    expect(() => zeroneEconomyDirectSignPlanContentId(
      structuredClone(plan),
    )).toThrow(/created and retained in this process/u);
    expect(() => zeroneEconomyDirectSignPlanContentId(
      serializedPlan,
    )).toThrow(/created and retained in this process/u);
    expect(() => reconstructZeroneEconomyDirectSignPlan({
      expected_plan_content_id: expectedPlanContentId,
      plan: serializedPlan,
    } as never)).toThrow();
    expect(() => reconstructZeroneEconomyDirectSignPlan(
      reconstructionInput(bundle, expectedPlanContentId, {
        intent: structuredClone(bundle.intent),
      } as never),
    )).toThrow(/verify.*seal/u);
  });

  test("reads reconstruction getters and proxies once and rejects plan proxies before inspection", async () => {
    const { bundle, plan } = await planFor();
    const expectedPlanContentId = zeroneEconomyDirectSignPlanContentId(plan);
    const honest = reconstructionInput(bundle, expectedPlanContentId);
    const fieldNames = [
      "expected_plan_content_id",
      "intent",
      "projections",
      "network",
      "signer_public_key",
      "account_observation",
      "activation_observation",
      "fee_amount_uzrn",
      "gas_limit",
    ] as const;

    const getterReads = new Map<string, number>();
    const getterInput = Object.create(null) as Record<string, unknown>;
    for (const field of fieldNames) {
      Object.defineProperty(getterInput, field, {
        enumerable: true,
        get() {
          const reads = (getterReads.get(field) ?? 0) + 1;
          getterReads.set(field, reads);
          if (reads !== 1) throw new Error(`unstable getter reread: ${field}`);
          return honest[field];
        },
      });
    }
    const fromGetters = reconstructZeroneEconomyDirectSignPlan(
      getterInput as unknown as ReconstructZeroneEconomyDirectSignPlanInput,
    );
    expect(zeroneEconomyDirectSignPlanContentId(fromGetters)).toBe(
      expectedPlanContentId,
    );
    expect([...getterReads.values()]).toEqual(fieldNames.map(() => 1));

    const proxyReads = new Map<PropertyKey, number>();
    const inputProxy = new Proxy(honest, {
      get(target, property, receiver) {
        const reads = (proxyReads.get(property) ?? 0) + 1;
        proxyReads.set(property, reads);
        if (reads !== 1) throw new Error(`unstable proxy reread: ${String(property)}`);
        return Reflect.get(target, property, receiver);
      },
    });
    const fromProxy = reconstructZeroneEconomyDirectSignPlan(inputProxy);
    expect(zeroneEconomyDirectSignPlanContentId(fromProxy)).toBe(
      expectedPlanContentId,
    );
    expect(fieldNames.map((field) => proxyReads.get(field))).toEqual(
      fieldNames.map(() => 1),
    );

    let planProxyInspected = false;
    const planProxy = new Proxy(plan, {
      ownKeys() {
        planProxyInspected = true;
        throw new Error("unbranded plan proxy must not be inspected");
      },
    });
    expect(() => zeroneEconomyDirectSignPlanContentId(planProxy)).toThrow(
      /created and retained in this process/u,
    );
    expect(planProxyInspected).toBe(false);
  });
});
