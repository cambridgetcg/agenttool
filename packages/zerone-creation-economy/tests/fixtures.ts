import { createHash } from "node:crypto";

import { secp256k1 } from "@noble/curves/secp256k1.js";
import * as ed25519 from "@noble/ed25519";
import {
  base64UrlDecode,
  base64UrlEncode,
  keyIdForPublicKey,
  type Ed25519PublicKey,
  type Sha256Id,
} from "@agenttool/wallet";
import {
  getZeroneProfile,
  zeroneAccountId,
  zeroneAddressFromSecp256k1PublicKey,
} from "@agenttool/wallet-zerone";
import {
  createWalletIdentityBinding,
  createWalletIdentityBindingProofEnvelope,
  createWalletIdentityBindingSigningRequest,
} from "@agenttool/zerone-agent-economy";
import {
  VERIFICATION_KINDS,
  aggregateCreationLifecycle,
  createCreationArtifact,
  createCreationContract,
  createVerificationWitness,
  createCreationWitness,
  createCreationWorkSpec,
  projectCreationClaim,
  sha256Id,
} from "@agenttool/zerone-creation-claim";

import {
  contractInput,
  creationWitnessInput,
  rebuildVerifications,
  verificationWitnessInput,
  vectors,
  workSpecInput,
} from "../../zerone-creation-claim/tests/fixtures.js";

ed25519.etc.sha512Sync = (...messages: Uint8Array[]) => {
  const digest = createHash("sha512");
  for (const message of messages) digest.update(message);
  return Uint8Array.from(digest.digest());
};

export const FIXTURE_CHAIN_REFERENCE = "zerone-creation-private-fixt1";
export const FIXTURE_ZERONE_REVISION =
  "a5b82e82b2a32be2b75bd11575964b0a69aa34ac";
export const FIXTURE_REVIEW_STAKE_UZRN = "100000";

const WALLET_DESCRIPTOR_ID = `sha256:${"01".repeat(32)}` as Sha256Id;
const SECP256K1_PRIVATE_KEY = Uint8Array.from(
  { length: 32 },
  (_, index) => index === 31 ? 1 : 0,
);
const SECP256K1_PUBLIC_KEY = secp256k1.getPublicKey(
  SECP256K1_PRIVATE_KEY,
  true,
);
const ED25519_PRIVATE_KEY = Uint8Array.from(
  { length: 32 },
  (_, index) => index + 1,
);

export interface ReadyFormalFixtureOptions {
  readonly chain_reference?: string;
  readonly zerone_revision?: string;
  readonly sponsor_overlap?: "account" | "controller" | "both";
  readonly cyber_profile?: "none" | "other_advanced";
  readonly formal_authority_refs?: boolean;
  readonly publication_authority_overlaps_provider?: boolean;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

function identityAuthority(): Ed25519PublicKey {
  const publicKey = base64UrlEncode(ed25519.getPublicKey(ED25519_PRIVATE_KEY));
  return Object.freeze({
    algorithm: "Ed25519",
    key_id: keyIdForPublicKey(publicKey),
    public_key: publicKey,
  });
}

function buildIdentityProofFixture() {
  const profile = getZeroneProfile("testnet");
  const address = zeroneAddressFromSecp256k1PublicKey(SECP256K1_PUBLIC_KEY);
  const account = zeroneAccountId(profile, address);
  const binding = createWalletIdentityBinding({
    network: "testnet",
    owner_identity_id: "did:agenttool:creation-economy-fixture",
    wallet_id: "wallet-creation-economy-fixture-001",
    wallet_descriptor_id: WALLET_DESCRIPTOR_ID,
    identity_authority: identityAuthority(),
    zerone_account_id: account,
    zerone_public_key: SECP256K1_PUBLIC_KEY,
    revision: 1,
    wallet_continuity_sequence: 0,
    previous_binding_id: null,
    issued_at: "2026-09-02T12:00:00.000Z",
  });
  const bindingSigningRequest = createWalletIdentityBindingSigningRequest(binding);
  const signingDigest = base64UrlDecode(
    bindingSigningRequest.shared_signing_digest_b64u,
  );
  const bindingProof = createWalletIdentityBindingProofEnvelope({
    binding,
    identity_signature_b64u: base64UrlEncode(
      ed25519.sign(signingDigest, ED25519_PRIVATE_KEY),
    ),
    wallet_signature_b64u: base64UrlEncode(secp256k1.sign(
      signingDigest,
      SECP256K1_PRIVATE_KEY,
      { prehash: false, lowS: true, format: "compact" },
    )),
  });
  return Object.freeze({
    profile,
    address,
    account,
    binding,
    bindingProof,
    bindingSigningRequest,
  });
}

function fixtureRef(label: string): Sha256Id {
  return sha256Id(`agenttool.zerone-creation-economy.fixture:${label}`);
}

function configureDefensiveContract(input: Record<string, any>): void {
  input.lane = "defensive_security";
  input.artifact_kind = "security_invariant";
  input.claim_policy = {
    category: "computational",
    method_id: "M-COMPUTATIONAL",
    methodology_registry_evidence_ref: fixtureRef("cyber:methodology-registry"),
    methodology_observation_status: "caller_declared_not_verified",
    max_review_stake_uzrn: FIXTURE_REVIEW_STAKE_UZRN,
  };
  input.authorities.target_authorization_ref = fixtureRef("cyber:target-authorization");
  input.authorities.engagement_scope_ref = fixtureRef("cyber:engagement-scope");
  input.authorities.cyber = {
    provider: "openai_cyber",
    access_tier: "defensive_approved",
    provider_access_ref: fixtureRef("cyber:provider-access"),
    provider_policy_ref: fixtureRef("cyber:provider-policy"),
  };
  const route = input.outcome_routes.find(
    (candidate: Record<string, any>) => candidate.outcome === "bounded_answer",
  );
  route.requirements.push(
    {
      kind: "authorization_currentness",
      minimum_passes: "1",
      independence: "not_required",
      policy_ref: fixtureRef("cyber:authorization-policy"),
    },
    {
      kind: "security_boundary",
      minimum_passes: "1",
      independence: "not_required",
      policy_ref: fixtureRef("cyber:security-policy"),
    },
  );
  route.requirements.sort(
    (left: Record<string, any>, right: Record<string, any>) =>
      VERIFICATION_KINDS.indexOf(left.kind) - VERIFICATION_KINDS.indexOf(right.kind),
  );
}

function defensiveVerificationWitnesses(
  contract: any,
  workSpec: any,
  creationWitness: any,
): any[] {
  const route = contract.outcome_routes.find(
    (candidate: Record<string, any>) => candidate.outcome === "bounded_answer",
  );
  return (["authorization_currentness", "security_boundary"] as const).map(
    (kind, index) => {
      const source = verificationWitnessInput(
        vectors.cases.ready_formal_creation.verification_witnesses[index],
      );
      const requirement = route.requirements.find(
        (candidate: Record<string, any>) => candidate.kind === kind,
      );
      source.kind = kind;
      source.policy_ref = requirement.policy_ref;
      source.observation_ref = fixtureRef(`cyber:${kind}:observation`);
      source.method_ref = fixtureRef(`cyber:${kind}:method`);
      source.environment_root = fixtureRef(`cyber:${kind}:environment`);
      source.evidence_root = fixtureRef(`cyber:${kind}:evidence`);
      source.limitation_refs = [];
      source.verifier = {
        controller_ref: fixtureRef(`cyber:${kind}:controller`),
        claimed_key_ref: fixtureRef(`cyber:${kind}:key`),
        attestation_ref: fixtureRef(`cyber:${kind}:attestation`),
        relation_to_producer: "unknown",
        independence_evidence_ref: null,
      };
      return createVerificationWitness(
        contract,
        workSpec,
        creationWitness,
        source as never,
      );
    },
  );
}

function buildReadyCreationFixture(
  options: ReadyFormalFixtureOptions = {},
  defensiveSecurity = false,
) {
  const identity = buildIdentityProofFixture();

  const contractSource = contractInput();
  contractSource.claim_policy.max_review_stake_uzrn = FIXTURE_REVIEW_STAKE_UZRN;
  if (defensiveSecurity) {
    configureDefensiveContract(contractSource);
    if (options.cyber_profile === "none") {
      contractSource.authorities.cyber = {
        provider: "none",
        access_tier: "not_used",
        provider_access_ref: null,
        provider_policy_ref: null,
      };
    } else if (options.cyber_profile === "other_advanced") {
      contractSource.authorities.cyber = {
        provider: "other",
        access_tier: "advanced_separately_approved",
        provider_access_ref: fixtureRef("cyber:other-provider-access"),
        provider_policy_ref: fixtureRef("cyber:other-provider-policy"),
      };
    }
    if (options.publication_authority_overlaps_provider) {
      contractSource.authorities.publication_authority_ref =
        contractSource.authorities.cyber.provider_access_ref;
    }
  } else if (options.formal_authority_refs) {
    contractSource.authorities.target_authorization_ref =
      fixtureRef("formal:unexpected-target-authorization");
    contractSource.authorities.engagement_scope_ref =
      fixtureRef("formal:unexpected-engagement-scope");
  }
  const contract = createCreationContract(contractSource as never);

  const workSpecSource = workSpecInput();
  workSpecSource.chain_profile.chain_id =
    options.chain_reference ?? FIXTURE_CHAIN_REFERENCE;
  workSpecSource.chain_profile.integrated_source_revision =
    options.zerone_revision ?? FIXTURE_ZERONE_REVISION;
  workSpecSource.worker.account_address = identity.address;
  workSpecSource.worker.producer_key_ref = identity.binding.zerone_signer.key_id;
  workSpecSource.worker.wallet_binding_ref = identity.binding.binding_id;
  workSpecSource.worker.wallet_controller_ref = identity.binding.wallet_descriptor_id;
  workSpecSource.payee_address = identity.address;
  workSpecSource.fulfillment_caller_address = identity.address;
  workSpecSource.claim_submission.review_stake_uzrn = FIXTURE_REVIEW_STAKE_UZRN;
  workSpecSource.claim_submission.review_stake_payer_address = identity.address;
  workSpecSource.claim_submission.transaction_fee_payer_address = identity.address;
  if (defensiveSecurity) {
    workSpecSource.claim_submission.category = contract.claim_policy.category;
    workSpecSource.claim_submission.method_id = contract.claim_policy.method_id;
    workSpecSource.claim_submission.methodology_registry_evidence_ref =
      contract.claim_policy.methodology_registry_evidence_ref;
  }
  if (options.sponsor_overlap === "account" || options.sponsor_overlap === "both") {
    workSpecSource.sponsor.account_address = identity.address;
  }
  if (options.sponsor_overlap === "controller" || options.sponsor_overlap === "both") {
    workSpecSource.sponsor.wallet_controller_ref = identity.binding.wallet_descriptor_id;
  }
  const workSpec = createCreationWorkSpec(contract, workSpecSource as never);

  const witnessSource = creationWitnessInput();
  witnessSource.producer.account_address = identity.address;
  witnessSource.producer.producer_key_ref = identity.binding.zerone_signer.key_id;
  witnessSource.producer.wallet_binding_ref = identity.binding.binding_id;
  witnessSource.producer.wallet_controller_ref = identity.binding.wallet_descriptor_id;
  if (defensiveSecurity) {
    witnessSource.artifact_kind = contract.artifact_kind;
    witnessSource.run.input_root = contract.input_root;
  }
  const creationWitness = createCreationWitness(contract, workSpec, witnessSource as never);
  const verificationWitnesses = [
    ...rebuildVerifications(
      contract,
      workSpec,
      creationWitness,
    ),
    ...(defensiveSecurity
      ? defensiveVerificationWitnesses(contract, workSpec, creationWitness)
      : []),
  ];
  const lifecycle = aggregateCreationLifecycle(
    contract,
    workSpec,
    creationWitness,
    verificationWitnesses,
  );
  const creationArtifact = createCreationArtifact(
    contract,
    workSpec,
    creationWitness,
    verificationWitnesses,
    lifecycle,
  );
  const creationClaimProjection = projectCreationClaim(
    contract,
    workSpec,
    creationWitness,
    verificationWitnesses,
    lifecycle,
    creationArtifact,
  );

  return Object.freeze({
    ...identity,
    contract,
    workSpec,
    creationWitness,
    verificationWitnesses,
    lifecycle,
    creationArtifact,
    creationClaimProjection,
  });
}

export function buildReadyFormalCreationFixture(
  options: ReadyFormalFixtureOptions = {},
) {
  return buildReadyCreationFixture(options, false);
}

export function buildReadyDefensiveSecurityCreationFixture(
  options: ReadyFormalFixtureOptions = {},
) {
  return buildReadyCreationFixture(options, true);
}
