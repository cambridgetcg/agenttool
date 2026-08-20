import { describe, expect, test } from "bun:test";
import * as ed25519 from "@noble/ed25519";

import {
  RECORD_SCHEMAS,
  base64UrlEncode,
  keyIdForPublicKey,
  sealContinuityEvent,
  sealTransactionIntent,
  sealWalletCapability,
  sealWalletDescriptor,
  sha256BytesId,
  type ContinuityEventCore,
  type Ed25519PublicKey,
  type RecordSigner,
  type SpendLimit,
  type TransactionIntentCore,
  type WalletCapabilityCore,
  type WalletDescriptorCore,
} from "@agenttool/wallet";

import {
  capabilityConsumeNullifier,
  projectCapabilityConsume,
  projectCapabilityGrant,
  projectCapabilityRevoke,
} from "../src/index.js";
import { digest } from "./fixtures.js";

const SOURCE = "eip155:84532:0x1111111111111111111111111111111111111111";
const TARGET = "eip155:84532:0x2222222222222222222222222222222222222222";
const ASSET = "eip155:84532/slip44:60";
const SECOND_ASSET = "eip155:84532/erc20:0x3333333333333333333333333333333333333333";

function walletSigner(seedByte: number): { signer: RecordSigner; key: Ed25519PublicKey } {
  const seed = new Uint8Array(32).fill(seedByte);
  const publicKey = base64UrlEncode(ed25519.getPublicKey(seed));
  return {
    key: {
      algorithm: "Ed25519",
      key_id: keyIdForPublicKey(publicKey),
      public_key: publicKey,
    },
    signer: {
      public_key: publicKey,
      sign_digest: (value) => base64UrlEncode(ed25519.sign(value, seed)),
    },
  };
}

const owner = walletSigner(31);
const delegate = walletSigner(32);

async function signedSources(options: {
  spend_limits?: SpendLimit[];
  declared_spends?: TransactionIntentCore["declared_spends"];
} = {}) {
  const descriptorCore: WalletDescriptorCore = {
    schema: RECORD_SCHEMAS.descriptor,
    wallet_id: "11111111-1111-4111-8111-111111111111",
    owner_identity_id: "did:at:fixture-owner",
    authority: owner.key,
    custody_mode: "self_custodied",
    accounts: [SOURCE].map((account_id) => ({ account_id, account_kind: "smart_account" })),
    recovery_mode: "guardian",
    created_at: "2026-08-20T10:00:00.000Z",
  };
  const descriptor = await sealWalletDescriptor(descriptorCore, owner.signer);
  const capabilityCore: WalletCapabilityCore = {
    schema: RECORD_SCHEMAS.capability,
    grant_id: "22222222-2222-4222-8222-222222222222",
    wallet_id: descriptor.wallet_id,
    descriptor_id: descriptor.record_id,
    issuer: owner.key,
    delegate: delegate.key,
    accounts: [SOURCE],
    call_rules: [{
      target_account: TARGET,
      actions: ["transfer"],
      methods: [],
      requires_approval: false,
    }],
    spend_limits: options.spend_limits ?? [{
      asset_id: ASSET,
      max_per_intent: "10",
      max_total: "25",
    }],
    fee_limits: [{ asset_id: ASSET, max_per_intent: "2" }],
    max_intents: 3,
    approval_threshold: 0,
    issued_at: "2026-08-20T10:00:00.000Z",
    not_before: "2026-08-20T10:00:00.000Z",
    expires_at: "2026-08-20T11:00:00.000Z",
    revocation_nonce: 0,
    policy_hash: digest("a"),
    purpose: "Strict WITNESS projection fixture",
  };
  const capability = await sealWalletCapability(capabilityCore, owner.signer);
  const declaredSpends = options.declared_spends ?? [{ asset_id: ASSET, amount_atomic: "10" }];
  const intentCore: TransactionIntentCore = {
    schema: RECORD_SCHEMAS.intent,
    intent_id: "33333333-3333-4333-8333-333333333333",
    wallet_id: descriptor.wallet_id,
    descriptor_id: descriptor.record_id,
    grant_id: capability.grant_id,
    capability_record_id: capability.record_id,
    delegate: delegate.key,
    chain_id: "eip155:84532",
    source_account: SOURCE,
    calls: [{
      action: "transfer",
      target_account: TARGET,
      method: null,
      payload_b64u: "",
      payload_hash: sha256BytesId(new Uint8Array()),
      native_value: { asset_id: ASSET, amount_atomic: "10" },
    }],
    declared_spends: declaredSpends,
    max_fee: { asset_id: ASSET, amount_atomic: "2" },
    issued_at: "2026-08-20T10:01:00.000Z",
    expires_at: "2026-08-20T10:06:00.000Z",
    nonce: "witness-capability-fixture",
  };
  const intent = await sealTransactionIntent(intentCore, delegate.signer);
  const continuityCore: ContinuityEventCore = {
    schema: RECORD_SCHEMAS.continuity,
    event_id: "44444444-4444-4444-8444-444444444444",
    wallet_id: descriptor.wallet_id,
    sequence: 1,
    previous_record_id: null,
    event_kind: "capability_revoked",
    previous_value: null,
    next_value: null,
    revocation_nonce: 1,
    actor: owner.key,
    reason: "Revoke fixture capability epoch",
    effective_at: "2026-08-20T10:04:00.000Z",
  };
  const continuity = await sealContinuityEvent(continuityCore, owner.signer);
  return { capability, intent, continuity };
}

describe("single-asset Agent Wallet capability projection", () => {
  test("projects one coherent grant/consume/revoke subject lane", async () => {
    const { capability, intent, continuity } = await signedSources();
    const grant = projectCapabilityGrant(capability);
    expect(grant.max_per_consume_minor).toBe("10");
    expect(grant.max_total_minor).toBe("25");
    const consume = projectCapabilityConsume({
      capability,
      intent,
      audience: "kingdom:offline-shadow",
      grant_commitment: digest("b"),
    });
    expect(consume.capability_ref).toBe(grant.capability_ref);
    expect(consume.amount_minor).toBe("10");
    const revoke = projectCapabilityRevoke({
      capability,
      continuity_event: continuity,
      grant_commitment: digest("b"),
    });
    expect(revoke.capability_ref).toBe(grant.capability_ref);
  });

  test("nullifier excludes envelope sequence but binds audience, asset, grant and source", async () => {
    const { capability, intent } = await signedSources();
    const consume = projectCapabilityConsume({
      capability,
      intent,
      audience: "kingdom:offline-shadow",
      grant_commitment: digest("b"),
    });
    // There is intentionally no sequence input. Re-derivation is identical.
    expect(capabilityConsumeNullifier({
      audience: "kingdom:offline-shadow",
      subject_ref: consume.capability_ref,
      capability_ref: consume.capability_ref,
      grant_commitment: consume.grant_commitment,
      asset_ref: consume.asset_ref,
      source_event_digest: consume.source_event_digest,
    })).toBe(consume.nullifier);
    expect(capabilityConsumeNullifier({
      audience: "kingdom:offline-shadow",
      subject_ref: consume.capability_ref,
      capability_ref: consume.capability_ref,
      grant_commitment: consume.grant_commitment,
      asset_ref: digest("c"),
      source_event_digest: consume.source_event_digest,
    })).not.toBe(consume.nullifier);
    expect(() => projectCapabilityConsume({
      capability,
      intent,
      audience: "not-an-audience",
      grant_commitment: digest("b"),
    })).toThrow(/WITNESS audience/u);
  });

  test("fails closed for multi-limit grants and multi-asset intents", async () => {
    const multiLimit = await signedSources({
      spend_limits: [
        { asset_id: SECOND_ASSET, max_per_intent: "5", max_total: "10" },
        { asset_id: ASSET, max_per_intent: "10", max_total: "25" },
      ],
    });
    expect(() => projectCapabilityGrant(multiLimit.capability)).toThrow(/exactly one signed spend_limit/u);
    expect(() => projectCapabilityConsume({
      capability: multiLimit.capability,
      intent: multiLimit.intent,
      audience: "kingdom:offline-shadow",
      grant_commitment: digest("b"),
    })).toThrow(/exactly one signed spend_limit/u);

    const multiSpend = await signedSources({
      spend_limits: [{ asset_id: ASSET, max_per_intent: "20", max_total: "30" }],
      declared_spends: [
        { asset_id: SECOND_ASSET, amount_atomic: "5" },
        { asset_id: ASSET, amount_atomic: "10" },
      ],
    });
    expect(() => projectCapabilityConsume({
      capability: multiSpend.capability,
      intent: multiSpend.intent,
      audience: "kingdom:offline-shadow",
      grant_commitment: digest("b"),
    })).toThrow(/exactly one declared-spend/u);
  });

  test("rejects source uint256 limits above uint64 without truncation in every lane", async () => {
    const tooWide = await signedSources({
      spend_limits: [{
        asset_id: ASSET,
        max_per_intent: "18446744073709551616",
        max_total: "18446744073709551616",
      }],
    });
    for (const projection of [
      () => projectCapabilityGrant(tooWide.capability),
      () => projectCapabilityConsume({
        capability: tooWide.capability,
        intent: tooWide.intent,
        audience: "kingdom:offline-shadow",
        grant_commitment: digest("b"),
      }),
      () => projectCapabilityRevoke({
        capability: tooWide.capability,
        continuity_event: tooWide.continuity,
        grant_commitment: digest("b"),
      }),
    ]) {
      try {
        projection();
        throw new Error("expected OUTSIDE_SCOPE");
      } catch (error) {
        expect(error).toMatchObject({ code: "OUTSIDE_SCOPE" });
      }
    }
  });

  test("rejects zero bounds and accepts the exact uint64 ceiling", async () => {
    const zero = await signedSources({
      spend_limits: [{ asset_id: ASSET, max_per_intent: "0", max_total: "0" }],
    });
    for (const projection of [
      () => projectCapabilityGrant(zero.capability),
      () => projectCapabilityConsume({
        capability: zero.capability,
        intent: zero.intent,
        audience: "kingdom:offline-shadow",
        grant_commitment: digest("b"),
      }),
      () => projectCapabilityRevoke({
        capability: zero.capability,
        continuity_event: zero.continuity,
        grant_commitment: digest("b"),
      }),
    ]) {
      try {
        projection();
        throw new Error("expected OUTSIDE_SCOPE");
      } catch (error) {
        expect(error).toMatchObject({ code: "OUTSIDE_SCOPE" });
      }
    }

    const maximum = await signedSources({
      spend_limits: [{
        asset_id: ASSET,
        max_per_intent: "18446744073709551615",
        max_total: "18446744073709551615",
      }],
    });
    expect(projectCapabilityGrant(maximum.capability)).toMatchObject({
      max_per_consume_minor: "18446744073709551615",
      max_total_minor: "18446744073709551615",
    });
    expect(projectCapabilityConsume({
      capability: maximum.capability,
      intent: maximum.intent,
      audience: "kingdom:offline-shadow",
      grant_commitment: digest("b"),
    }).amount_minor).toBe("10");
  });
});
