import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  base64UrlEncode,
  base64UrlDecode,
  canonicalJson,
  sealSimulationReceipt,
  sealTransactionIntent,
  sealWalletCapability,
  sha256BytesId,
} from "@agenttool/wallet";
import {
  createTreasuryPolicy,
  createWalletIdentityBinding,
  createWalletIdentityBindingProofEnvelope,
  createWalletIdentityBindingSigningRequest,
} from "@agenttool/zerone-agent-economy";
import {
  createZeroneEconomyDirectSignPlan,
  createZeroneEconomySimulationEvidence,
  createZeroneEconomySimulationReceiptCore,
  reconstructZeroneEconomyDirectSignPlan,
  zeroneEconomyDirectSignPlanContentId,
} from "@agenttool/wallet-zerone-economy";

import {
  ECONOMY_COMMITMENT_HASH_DOMAIN,
  EXECUTION_SUPPORT,
  ZeroneAgentHostStore,
  createTrustedBindingCurrentnessVerifierAssertion,
  createTrustedSimulationAdapterAssertion,
  createZeroneEconomyActivationCurrentnessAssertion,
  type BindingCurrentnessAssertion,
  type TrustedBindingCurrentnessVerifierAssertion,
  type TrustedSimulationAdapterAssertion,
  type ZeroneAccountSnapshot,
  type ZeroneEconomyActivationCurrentnessAssertion,
  type ZeroneAgentHostStoreOptions,
} from "../src/index.js";
import {
  ACTIVATION_OBSERVATION,
  SECP_PRIVATE_KEY,
  SECP_PUBLIC_KEY,
  SOURCE_ACCOUNT,
  accountObservation,
  defaultProjections,
  delegate,
  owner,
  profile,
  simulationAdapter,
  vector,
  walletBundle,
} from "../../wallet-zerone-economy/tests/fixtures.js";
import {
  currentnessForProof,
  fixture as genericFixture,
  hash,
  rewriteEventChain,
} from "./helpers.js";

const ACTIVATION_BLOCK = "A".repeat(64);
const SIMULATION_BLOCK = "B".repeat(64);
const ACCOUNT_KEY = Object.freeze({
  public_key_type_url: "/cosmos.crypto.secp256k1.PubKey" as const,
  public_key_b64u: base64UrlEncode(SECP_PUBLIC_KEY),
});

type Kind = "create_bounty" | "submit_claim" | "fulfill_bounty";

interface EconomyFixtureOptions {
  readonly sequence?: string;
  readonly account_height?: string;
  readonly account_block_hash?: string;
  readonly account_observed_at?: string;
  readonly simulation_height?: string;
  readonly simulation_block_hash?: string;
  readonly simulated_at?: string;
  readonly currentness_verified_at?: string;
  readonly currentness_valid_until?: string;
  readonly host_now?: string;
  readonly registered_key?: boolean;
  readonly intent_id?: string;
  readonly intent_nonce?: string;
  readonly simulation_id?: string;
  readonly operation_id?: string;
  readonly request_id?: string;
}

async function economyFixture(kind: Kind, options: EconomyFixtureOptions = {}) {
  const projectionIndex = kind === "create_bounty" ? 0 : kind === "submit_claim" ? 1 : 2;
  const projection = defaultProjections()[projectionIndex];
  if (projection === undefined) throw new Error("planner fixture projection is absent");
  const nativeSpend = kind === "create_bounty" ? "500000" : kind === "submit_claim" ? "100000" : "0";
  const base = await walletBundle({
    projections: [projection],
    declared_spends: nativeSpend === "0"
      ? []
      : [{ asset_id: profile.native_asset_id, amount_atomic: nativeSpend }],
  });
  const binding = createWalletIdentityBinding({
    network: "testnet",
    owner_identity_id: base.descriptor.owner_identity_id,
    wallet_id: base.descriptor.wallet_id,
    wallet_descriptor_id: base.descriptor.record_id,
    identity_authority: base.descriptor.authority,
    zerone_account_id: SOURCE_ACCOUNT,
    zerone_public_key: SECP_PUBLIC_KEY,
    revision: 1,
    wallet_continuity_sequence: 0,
    previous_binding_id: null,
    issued_at: "2026-08-20T18:00:00.000Z",
  });
  const bindingRequest = createWalletIdentityBindingSigningRequest(binding);
  const bindingDigest = base64UrlDecode(bindingRequest.shared_signing_digest_b64u);
  const proof = createWalletIdentityBindingProofEnvelope({
    binding,
    identity_signature_b64u: await owner.signer.sign_digest(bindingDigest),
    wallet_signature_b64u: base64UrlEncode(secp256k1.sign(
      bindingDigest,
      SECP_PRIVATE_KEY,
      { prehash: false, lowS: true, format: "compact" },
    )),
  });
  const treasury = createTreasuryPolicy({
    wallet_binding: binding,
    network: "testnet",
    wallet_binding_id: binding.binding_id,
    treasury_account: SOURCE_ACCOUNT,
    denom: "uzrn",
    reserve_floor_uzrn: "100000",
    max_single_spend_uzrn: "2000000",
    window_blocks: "1000",
    window_caps_uzrn: {
      compute: "0",
      knowledge_bond: "5000000",
      network_fee: "5000000",
      sponsorship_escrow: "5000000",
      storage: "0",
      total: "10000000",
    },
    allowed_purposes: ["knowledge_bond", "network_fee", "sponsorship_escrow"],
    issued_at: "2026-08-20T18:00:00.000Z",
  });
  const {
    signature: _capabilitySignature,
    record_id: _capabilityRecordId,
    ...baseCapabilityCore
  } = base.capability;
  const capability = await sealWalletCapability({
    ...baseCapabilityCore,
    spend_limits: kind === "fulfill_bounty" ? [] : baseCapabilityCore.spend_limits,
    policy_hash: treasury.treasury_policy_id,
  }, owner.signer);
  const {
    signature: _intentSignature,
    record_id: _intentRecordId,
    ...baseIntentCore
  } = base.intent;
  const intent = await sealTransactionIntent({
    ...baseIntentCore,
    intent_id: options.intent_id ?? "75555555-5555-4555-8555-555555555555",
    capability_record_id: capability.record_id,
    nonce: options.intent_nonce ?? `host-${kind}-fixture`,
  }, delegate.signer);
  const sequence = options.sequence ?? "9";
  const registeredKey = options.registered_key ?? sequence !== "0";
  const accountHeight = options.account_height ?? "700000";
  const accountBlockHash = options.account_block_hash ?? ACTIVATION_BLOCK;
  const accountObservedAt = options.account_observed_at ?? "2026-08-20T18:02:15.000Z";
  const planInput = Object.freeze({
    intent,
    projections: [projection],
    network: "testnet" as const,
    signer_public_key: SECP_PUBLIC_KEY,
    account_observation: accountObservation({
      sequence,
      observed_at_height: accountHeight,
      public_key_type_url: registeredKey ? ACCOUNT_KEY.public_key_type_url : null,
      public_key_b64u: registeredKey ? ACCOUNT_KEY.public_key_b64u : null,
    }),
    activation_observation: ACTIVATION_OBSERVATION,
    fee_amount_uzrn: vector.profile.fee_amount_uzrn,
    gas_limit: vector.profile.gas_limit,
  });
  const plan = createZeroneEconomyDirectSignPlan(planInput);
  const simulatedAt = options.simulated_at ?? "2026-08-20T18:02:30.000Z";
  const simulationHeight = options.simulation_height ?? "700001";
  const simulationBlockHash = options.simulation_block_hash ?? SIMULATION_BLOCK;
  const simulationResult = Object.freeze({
    status: "succeeded" as const,
    simulation_tx_bytes_hash: plan.simulation_tx_bytes_hash,
    code: 0,
    codespace: "",
    gas_wanted: plan.gas_limit,
    gas_used: plan.required_gas_limit,
    observed_at_height: simulationHeight,
  });
  const simulationCore = createZeroneEconomySimulationReceiptCore({
    plan,
    simulation: simulationResult,
    intent,
    adapter: simulationAdapter.key,
    simulation_id: options.simulation_id ?? "76666666-6666-4666-8666-666666666666",
    block_hash: simulationBlockHash,
    simulated_at: simulatedAt,
    valid_until: new Date(Date.parse(simulatedAt) + 3 * 60 * 1000).toISOString(),
  });
  const simulation = await sealSimulationReceipt(simulationCore, simulationAdapter.signer);
  const simulationEvidence = await createZeroneEconomySimulationEvidence({
    plan,
    simulation,
    simulation_result: simulationResult,
    signer: simulationAdapter.signer,
  });
  const currentness = currentnessForProof(proof, {
    verifier_id: "economy-identity-wallet-resolver",
    verified_at: options.currentness_verified_at ?? "2026-08-20T18:02:00.000Z",
    valid_until: options.currentness_valid_until ?? "2026-08-20T18:07:00.000Z",
  });
  const bindingTrust = createTrustedBindingCurrentnessVerifierAssertion({
    external_verification_id: hash("1"),
    verifier_id: currentness.verifier_id,
    verified_at: "2026-08-20T18:00:00.000Z",
    valid_until: "2026-08-20T19:00:00.000Z",
  });
  const activationCurrentness = createZeroneEconomyActivationCurrentnessAssertion({
    external_verification_id: hash("2"),
    verifier_id: "economy-activation-resolver",
    network: "testnet",
    chain_id: profile.chain_id,
    activation_observation_hash: plan.activation_observation_hash,
    observed_at_height: ACTIVATION_OBSERVATION.observed_at_height,
    block_hash: ACTIVATION_BLOCK,
    verified_at: "2026-08-20T18:02:00.000Z",
    valid_until: "2026-08-20T18:07:00.000Z",
  });
  const adapterTrust = createTrustedSimulationAdapterAssertion({
    external_verification_id: hash("3"),
    verifier_id: "economy-simulation-adapter-config",
    chain_id: profile.chain_id,
    adapter: simulationAdapter.key,
    verified_at: "2026-08-20T18:02:00.000Z",
    valid_until: "2026-08-20T18:07:00.000Z",
  });
  const snapshot: ZeroneAccountSnapshot = Object.freeze({
    chain_id: profile.chain_id,
    account: SOURCE_ACCOUNT,
    account_number: vector.profile.account_number,
    sequence,
    balance_uzrn: "10000000",
    observed_at_height: accountHeight,
    block_hash: accountBlockHash,
    observed_at: accountObservedAt,
    public_key_type_url: registeredKey ? ACCOUNT_KEY.public_key_type_url : null,
    public_key_b64u: registeredKey ? ACCOUNT_KEY.public_key_b64u : null,
    valid_until: new Date(Date.parse(accountObservedAt) + 5 * 60 * 1000).toISOString(),
  });
  return Object.freeze({
    kind,
    descriptor: base.descriptor,
    capability,
    intent,
    binding,
    proof,
    treasury,
    planInput,
    plan,
    simulation,
    simulationEvidence,
    currentness,
    bindingTrust,
    activationCurrentness,
    adapterTrust,
    snapshot,
    hostNow: options.host_now ?? "2026-08-20T18:03:00.000Z",
    operationId: options.operation_id ?? `economy-${kind}`,
    requestId: options.request_id ?? (
      kind === "create_bounty"
        ? "77777777-7777-4777-8777-777777777771"
        : kind === "submit_claim"
          ? "77777777-7777-4777-8777-777777777772"
          : "77777777-7777-4777-8777-777777777773"
    ),
  });
}

type EconomyFixture = Awaited<ReturnType<typeof economyFixture>>;

interface AuthorityController {
  now: string;
  currentness: BindingCurrentnessAssertion;
  activation: ZeroneEconomyActivationCurrentnessAssertion;
  snapshot: ZeroneAccountSnapshot;
}

function controllerFor(value: EconomyFixture): AuthorityController {
  return {
    now: value.hostNow,
    currentness: value.currentness,
    activation: value.activationCurrentness,
    snapshot: value.snapshot,
  };
}

function configuredOptions(
  value: EconomyFixture,
  controller: AuthorityController,
  overrides: Partial<ZeroneAgentHostStoreOptions> = {},
): ZeroneAgentHostStoreOptions {
  return {
    create: true,
    allow_in_memory_for_tests: true,
    now: () => controller.now,
    binding_currentness_resolver: {
      resolveCurrentness: async () => controller.currentness,
    },
    activation_currentness_resolver: {
      resolveCurrentness: async () => controller.activation,
    },
    account_observer: {
      observeAccount: async () => controller.snapshot,
    },
    trusted_binding_currentness_verifiers: [value.bindingTrust],
    trusted_simulation_adapters: [value.adapterTrust],
    trusted_activation_verifier_ids: [value.activationCurrentness.verifier_id],
    ...overrides,
  };
}

function inputFor(value: EconomyFixture, overrides: Record<string, unknown> = {}) {
  return {
    operation_id: value.operationId,
    request_id: value.requestId,
    proof: value.proof,
    expected_binding_head: null,
    activation_observation: ACTIVATION_OBSERVATION,
    descriptor: value.descriptor,
    capability: value.capability,
    intent: value.intent,
    simulation: value.simulation,
    simulation_evidence: value.simulationEvidence,
    plan: value.plan,
    treasury_policy: value.treasury,
    ...overrides,
  } as Parameters<ZeroneAgentHostStore["reserveAndEnterZeroneEconomySigningBoundary"]>[0];
}

function expectNoEconomyMutation(store: ZeroneAgentHostStore, value: EconomyFixture): void {
  expect(store.getOperation(value.operationId)).toBeNull();
  expect(store.getBindingHead(value.binding.wallet_id)).toBeNull();
  expect(store.getCapabilityUsage(value.capability.record_id)).toBeNull();
  expect(store.getTreasuryExposure(profile.chain_id, SOURCE_ACCOUNT)).toBe("0");
  expect(store.verify().operation_count).toBe(0);
}

describe("typed Zerone economy signing boundary", () => {
  test("atomically maps Create, Submit, and fee-only Fulfill into exact sticky signing requests", async () => {
    for (const kind of ["create_bounty", "submit_claim", "fulfill_bounty"] as const) {
      const value = await economyFixture(kind);
      const controller = controllerFor(value);
      const store = new ZeroneAgentHostStore(":memory:", configuredOptions(
        value,
        controller,
        kind === "create_bounty"
          ? { allow_legacy_generic_injected_for_tests: true }
          : {},
      ));
      store.initialize();
      const result = await store.reserveAndEnterZeroneEconomySigningBoundary(inputFor(value));
      const expectedPurpose = kind === "create_bounty"
        ? "sponsorship_escrow"
        : kind === "submit_claim"
          ? "knowledge_bond"
          : null;
      expect(result.operation).toMatchObject({
        operation_kind: "zerone_economy",
        revision: 2,
        status: "signing",
        signer_invoked: true,
        created_at: value.hostNow,
        updated_at: value.hostNow,
      });
      expect(result.signing_request).toMatchObject({
        request_id: value.requestId,
        unsigned_payload_hash: value.plan.sign_doc_bytes_hash,
        signer_key_id: value.plan.signer_key_id,
        authorization: { checked_at: value.hostNow },
      });
      expect(result.commitment.requested_at).toBe(value.hostNow);
      expect(result.commitment.plan_content_id)
        .toBe(zeroneEconomyDirectSignPlanContentId(value.plan));
      expect(result.commitment.network_effects_performed).toBeFalse();
      expect(result.operation.reservations.every(({ state }) => state === "sticky")).toBeTrue();
      expect(result.operation.reservations.find(({ purpose }) => purpose === "network_fee")?.amount_uzrn)
        .toBe(value.plan.fee.amount);
      const nonFee = result.operation.reservations.filter(({ purpose }) => purpose !== "network_fee");
      expect(nonFee).toEqual(expectedPurpose === null ? [] : [{
        purpose: expectedPurpose,
        amount_uzrn: value.plan.total_reserved_spend_uzrn,
        state: "sticky",
      }]);
      expect(store.listEvents(value.operationId).map(({ kind: eventKind, at }) => [eventKind, at]))
        .toEqual([
          ["reserved", value.hostNow],
          ["signer_invocation_boundary", value.hostNow],
        ]);
      expect(store.getCapabilityUsage(value.capability.record_id)).toMatchObject({
        reserved_intents: 0,
        consumed_intents: 1,
        reserved_spend_uzrn: "0",
        consumed_spend_uzrn: value.plan.total_reserved_spend_uzrn,
      });
      if (kind === "create_bounty") {
        expect(() => store.recordVerifiedSignedEvidence({
          operation_id: value.operationId,
          expected_revision: result.operation.revision,
          tx_hash: "D".repeat(64),
          signed_payload_hash: hash("4"),
          external_verification_id: hash("5"),
          at: "2026-08-20T18:04:00.000Z",
        })).toThrow(/typed Zerone economy operation/);
      }
      expect(store.verify()).toMatchObject({ ok: true, operation_count: 1 });
      store.close();
    }
  });

  test("rejects unbranded plans and every external trust/policy/fork/key gate with full rollback", async () => {
    const value = await economyFixture("create_bounty");
    const cases: Array<{
      label: string;
      options?: Partial<ZeroneAgentHostStoreOptions>;
      controller?: (controller: AuthorityController) => void;
      input?: Record<string, unknown>;
    }> = [
      { label: "unbranded plan", input: { plan: JSON.parse(canonicalJson(value.plan)) } },
      { label: "binding verifier", options: { trusted_binding_currentness_verifiers: [] } },
      { label: "activation verifier", options: { trusted_activation_verifier_ids: [] } },
      { label: "adapter", options: { trusted_simulation_adapters: [] } },
      {
        label: "fork",
        controller: (controller) => {
          controller.snapshot = { ...controller.snapshot, block_hash: "C".repeat(64) };
        },
      },
      {
        label: "registered key",
        controller: (controller) => {
          controller.snapshot = {
            ...controller.snapshot,
            public_key_type_url: null,
            public_key_b64u: null,
          };
        },
      },
      {
        label: "treasury policy",
        input: { treasury_policy: { ...value.treasury, max_single_spend_uzrn: "1" } },
      },
    ];
    for (const hostile of cases) {
      const controller = controllerFor(value);
      hostile.controller?.(controller);
      const store = new ZeroneAgentHostStore(":memory:", configuredOptions(
        value,
        controller,
        hostile.options,
      ));
      store.initialize();
      await expect(store.reserveAndEnterZeroneEconomySigningBoundary(
        inputFor(value, hostile.input),
      )).rejects.toThrow();
      expectNoEconomyMutation(store, value);
      store.close();
    }
  });

  test("accepts only planner reconstruction before entry, then reopens as signing_unknown without retry", async () => {
    const value = await economyFixture("create_bounty");
    const reconstructed = reconstructZeroneEconomyDirectSignPlan({
      ...value.planInput,
      expected_plan_content_id: zeroneEconomyDirectSignPlanContentId(value.plan),
    });
    const directory = mkdtempSync(join(tmpdir(), "zerone-economy-boundary-reopen-"));
    const path = join(directory, "host.sqlite");
    const controller = controllerFor(value);
    let store = new ZeroneAgentHostStore(path, configuredOptions(value, controller, {
      allow_in_memory_for_tests: false,
    }));
    store.initialize();
    await store.reserveAndEnterZeroneEconomySigningBoundary(inputFor(value, {
      plan: reconstructed,
    }));
    store.close();

    const missingTrust = new ZeroneAgentHostStore(path, configuredOptions(value, controller, {
      create: false,
      allow_in_memory_for_tests: false,
      trusted_simulation_adapters: [],
    }));
    expect(() => missingTrust.initialize()).toThrow(/commitment|adapter/i);
    missingTrust.close();

    store = new ZeroneAgentHostStore(path, configuredOptions(value, controller, {
      create: false,
      allow_in_memory_for_tests: false,
    }));
    store.initialize();
    expect(store.getOperation(value.operationId)).toMatchObject({
      status: "signing_unknown",
      signer_invoked: true,
    });
    const before = store.listEvents(value.operationId);
    await expect(store.reserveAndEnterZeroneEconomySigningBoundary(inputFor(value)))
      .rejects.toThrow(/already present/);
    expect(store.listEvents(value.operationId)).toEqual(before);
    expect(() => store.recordVerifiedSignedEvidence({
      operation_id: value.operationId,
      expected_revision: 3,
      tx_hash: "D".repeat(64),
      signed_payload_hash: hash("4"),
      external_verification_id: hash("5"),
      at: "2026-08-20T18:04:00.000Z",
    })).toThrow(/generic|legacy|typed/i);
    expect(store.verify().ok).toBeTrue();
    store.close();
  });

  test("allows sequence zero, rejects null-key release, and rejects a rehashed wrong-key reopen", async () => {
    const value = await economyFixture("create_bounty", {
      sequence: "0",
      registered_key: false,
      operation_id: "economy-sequence-zero",
      request_id: "77777777-7777-4777-8777-777777777780",
    });
    const controller = controllerFor(value);
    const directory = mkdtempSync(join(tmpdir(), "zerone-economy-sequence-key-reopen-"));
    const path = join(directory, "host.sqlite");
    const store = new ZeroneAgentHostStore(path, configuredOptions(value, controller, {
      allow_in_memory_for_tests: false,
    }));
    store.initialize();
    const result = await store.reserveAndEnterZeroneEconomySigningBoundary(inputFor(value));
    expect(result.operation.status).toBe("signing");
    const beforeEvents = store.listEvents(value.operationId);
    const beforeAccount = store.getAccountState(profile.chain_id, SOURCE_ACCOUNT);
    const missingKey: ZeroneAccountSnapshot = {
      ...value.snapshot,
      sequence: "1",
      observed_at_height: "700002",
      block_hash: "C".repeat(64),
      observed_at: "2026-08-20T18:03:30.000Z",
      valid_until: "2026-08-20T18:08:30.000Z",
    };
    expect(() => store.applySequenceAdvanceEvidence({
      operation_id: value.operationId,
      expected_revision: result.operation.revision,
      evidence_id: hash("6"),
      snapshot: missingKey,
      observed_at: missingKey.observed_at,
    })).toThrow(/exact registered Cosmos signer key/);
    expect(store.listEvents(value.operationId)).toEqual(beforeEvents);
    expect(store.getAccountState(profile.chain_id, SOURCE_ACCOUNT)).toEqual(beforeAccount);
    const exactKey = { ...missingKey, ...ACCOUNT_KEY };
    expect(store.applySequenceAdvanceEvidence({
      operation_id: value.operationId,
      expected_revision: result.operation.revision,
      evidence_id: hash("7"),
      snapshot: exactKey,
      observed_at: exactKey.observed_at,
    })).toMatchObject({ status: "sequence_superseded" });
    expect(store.verify().ok).toBeTrue();

    const wrongPublicKey = base64UrlEncode(secp256k1.getPublicKey(
      Uint8Array.from({ length: 32 }, (_, index) => index === 31 ? 2 : 0),
      true,
    ));
    rewriteEventChain(store, value.operationId, (eventKind, details) =>
      eventKind === "sequence_advanced"
        ? { ...details, account_public_key_b64u: wrongPublicKey }
        : details);
    const database = Reflect.get(store, "db") as Database;
    database.query(`
      UPDATE account_states SET public_key_b64u = ? WHERE chain_id = ? AND source_account = ?
    `).run(wrongPublicKey, profile.chain_id, SOURCE_ACCOUNT);
    expect(() => store.verify()).toThrow(/exact registered Cosmos signer key/);
    store.close();

    const reopened = new ZeroneAgentHostStore(path, configuredOptions(value, controller, {
      create: false,
      allow_in_memory_for_tests: false,
    }));
    expect(() => reopened.initialize()).toThrow(/exact registered Cosmos signer key/);
    reopened.close();
  });

  test("rejects a self-consistent rewritten prior-usage commitment by global ledger replay", async () => {
    const value = await economyFixture("create_bounty");
    const controller = controllerFor(value);
    const store = new ZeroneAgentHostStore(":memory:", configuredOptions(value, controller));
    store.initialize();
    const result = await store.reserveAndEnterZeroneEconomySigningBoundary(inputFor(value));
    const database = Reflect.get(store, "db") as Database;
    const commitment = JSON.parse(canonicalJson(result.commitment)) as Record<string, unknown>;
    commitment.authorization_usage_json = canonicalJson({
      revocation_nonce: 0,
      intent_count: 1,
      spent: [{ asset_id: profile.native_asset_id, amount_atomic: "500000" }],
      host_verified_approval_ids: [],
    });
    const { commitment_id: _priorCommitmentId, ...core } = commitment;
    const nextCommitmentId = sha256BytesId(new TextEncoder().encode(
      `${ECONOMY_COMMITMENT_HASH_DOMAIN}\0${canonicalJson(core)}`,
    ));
    commitment.commitment_id = nextCommitmentId;
    const nextCommitmentJson = canonicalJson(commitment);
    database.exec("DROP TRIGGER economy_operation_commitments_no_update");
    database.query(`
      UPDATE economy_operation_commitments SET commitment_id = ?, commitment_json = ?
      WHERE operation_id = ?
    `).run(nextCommitmentId, nextCommitmentJson, value.operationId);
    database.exec(`
      CREATE TRIGGER economy_operation_commitments_no_update
      BEFORE UPDATE ON economy_operation_commitments
      BEGIN SELECT RAISE(ABORT, 'economy commitments are append-only'); END
    `);
    database.query(`
      UPDATE operations SET signing_boundary_verification_id = ? WHERE operation_id = ?
    `).run(nextCommitmentId, value.operationId);
    rewriteEventChain(store, value.operationId, (eventKind, details) =>
      eventKind === "reserved" || eventKind === "signer_invocation_boundary"
        ? {
            ...details,
            economy_commitment_id: nextCommitmentId,
            economy_commitment_json: nextCommitmentJson,
            ...(eventKind === "signer_invocation_boundary"
              ? { external_verification_id: nextCommitmentId }
              : {}),
          }
        : details);
    expect(() => store.verify()).toThrow(/authorization usage does not replay before reservation/);
    store.close();
  });

  test("commits exact prior consumed usage and rolls back a late duplicate-request conflict", async () => {
    const first = await economyFixture("create_bounty");
    const second = await economyFixture("create_bounty", {
      sequence: "10",
      account_height: "700002",
      account_block_hash: "C".repeat(64),
      account_observed_at: "2026-08-20T18:03:30.000Z",
      simulation_height: "700003",
      simulation_block_hash: "D".repeat(64),
      simulated_at: "2026-08-20T18:03:45.000Z",
      currentness_verified_at: "2026-08-20T18:03:15.000Z",
      currentness_valid_until: "2026-08-20T18:08:15.000Z",
      host_now: "2026-08-20T18:04:00.000Z",
      intent_id: "75555555-5555-4555-8555-555555555556",
      intent_nonce: "host-create-second",
      simulation_id: "76666666-6666-4666-8666-666666666667",
      operation_id: "economy-create-second",
      request_id: "77777777-7777-4777-8777-777777777781",
    });
    const third = await economyFixture("create_bounty", {
      sequence: "11",
      account_height: "700004",
      account_block_hash: "E".repeat(64),
      account_observed_at: "2026-08-20T18:04:30.000Z",
      simulation_height: "700005",
      simulation_block_hash: "F".repeat(64),
      simulated_at: "2026-08-20T18:04:45.000Z",
      currentness_verified_at: "2026-08-20T18:04:15.000Z",
      currentness_valid_until: "2026-08-20T18:09:15.000Z",
      host_now: "2026-08-20T18:05:00.000Z",
      intent_id: "75555555-5555-4555-8555-555555555557",
      intent_nonce: "host-create-third",
      simulation_id: "76666666-6666-4666-8666-666666666668",
      operation_id: "economy-create-third",
      request_id: first.requestId,
    });
    expect(second.capability.record_id).toBe(first.capability.record_id);
    expect(third.capability.record_id).toBe(first.capability.record_id);
    const controller = controllerFor(first);
    const store = new ZeroneAgentHostStore(":memory:", configuredOptions(first, controller));
    store.initialize();
    const firstResult = await store.reserveAndEnterZeroneEconomySigningBoundary(inputFor(first));
    store.applySequenceAdvanceEvidence({
      operation_id: first.operationId,
      expected_revision: firstResult.operation.revision,
      evidence_id: hash("8"),
      snapshot: second.snapshot,
      observed_at: second.snapshot.observed_at,
    });
    const firstHead = store.getBindingHead(first.binding.wallet_id);
    if (firstHead === null) throw new Error("first typed binding head is absent");
    controller.now = second.hostNow;
    controller.currentness = second.currentness;
    controller.activation = second.activationCurrentness;
    controller.snapshot = second.snapshot;
    const secondResult = await store.reserveAndEnterZeroneEconomySigningBoundary(inputFor(second, {
      expected_binding_head: {
        wallet_id: firstHead.wallet_id,
        binding_id: firstHead.binding.binding_id,
        proof_id: firstHead.proof.proof_id,
        currentness_id: firstHead.currentness.currentness_id,
        head_version: firstHead.head_version,
      },
    }));
    expect(JSON.parse(secondResult.commitment.authorization_usage_json)).toEqual({
      revocation_nonce: 0,
      intent_count: 1,
      spent: [{ asset_id: profile.native_asset_id, amount_atomic: "500000" }],
      host_verified_approval_ids: [],
    });
    expect(store.getCapabilityUsage(first.capability.record_id)).toMatchObject({
      reserved_intents: 0,
      consumed_intents: 2,
      consumed_spend_uzrn: "1000000",
    });
    expect(store.verify().ok).toBeTrue();

    store.applySequenceAdvanceEvidence({
      operation_id: second.operationId,
      expected_revision: secondResult.operation.revision,
      evidence_id: hash("9"),
      snapshot: third.snapshot,
      observed_at: third.snapshot.observed_at,
    });
    const secondHead = store.getBindingHead(first.binding.wallet_id);
    if (secondHead === null) throw new Error("second typed binding head is absent");
    const database = Reflect.get(store, "db") as Database;
    const beforeHistory = database.query("SELECT COUNT(*) AS count FROM binding_history")
      .get() as { count: number };
    const beforeUsage = store.getCapabilityUsage(first.capability.record_id);
    const beforeAccount = store.getAccountState(profile.chain_id, SOURCE_ACCOUNT);
    controller.now = third.hostNow;
    controller.currentness = third.currentness;
    controller.activation = third.activationCurrentness;
    controller.snapshot = third.snapshot;
    await expect(store.reserveAndEnterZeroneEconomySigningBoundary(inputFor(third, {
      expected_binding_head: {
        wallet_id: secondHead.wallet_id,
        binding_id: secondHead.binding.binding_id,
        proof_id: secondHead.proof.proof_id,
        currentness_id: secondHead.currentness.currentness_id,
        head_version: secondHead.head_version,
      },
    }))).rejects.toThrow(/UNIQUE|request/i);
    expect(store.getOperation(third.operationId)).toBeNull();
    expect(store.getBindingHead(first.binding.wallet_id)).toEqual(secondHead);
    expect(store.getCapabilityUsage(first.capability.record_id)).toEqual(beforeUsage);
    expect(store.getAccountState(profile.chain_id, SOURCE_ACCOUNT)).toEqual(beforeAccount);
    expect((database.query("SELECT COUNT(*) AS count FROM binding_history")
      .get() as { count: number }).count).toBe(beforeHistory.count);
    expect(store.verify().ok).toBeTrue();
    store.close();
  });
});

describe("legacy generic injected gate", () => {
  test("is default-off, fails closed on legacy reopen, and requires the explicit test-only flag", () => {
    const values = genericFixture();
    const defaultStore = new ZeroneAgentHostStore(":memory:", {
      create: true,
      allow_in_memory_for_tests: true,
    });
    defaultStore.initialize();
    defaultStore.putBindingHead(values.proof, values.currentness, {
      expected: null,
      updated_at: "2026-08-20T20:00:00.000Z",
    });
    expect(() => defaultStore.reserveOperation(values.reserve())).toThrow(/legacy_generic|legacy generic/i);
    expect(defaultStore.getOperation("operation-1")).toBeNull();
    expect(defaultStore.verify().operation_count).toBe(0);
    defaultStore.close();

    const path = join(mkdtempSync(join(tmpdir(), "zerone-legacy-generic-gate-")), "host.sqlite");
    let legacy = new ZeroneAgentHostStore(path, {
      create: true,
      allow_legacy_generic_injected_for_tests: true,
    });
    legacy.initialize();
    legacy.putBindingHead(values.proof, values.currentness, {
      expected: null,
      updated_at: "2026-08-20T20:00:00.000Z",
    });
    legacy.reserveOperation(values.reserve());
    legacy.close();

    const denied = new ZeroneAgentHostStore(path, { create: false });
    expect(() => denied.initialize()).toThrow(/test-only constructor escape hatch/);
    denied.close();
    legacy = new ZeroneAgentHostStore(path, {
      create: false,
      allow_legacy_generic_injected_for_tests: true,
    });
    legacy.initialize();
    expect(legacy.verify()).toMatchObject({ ok: true, operation_count: 1 });
    expect(EXECUTION_SUPPORT.signer_invocation).toBe("external_not_implemented");
    legacy.close();
  });
});
