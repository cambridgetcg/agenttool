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
  computationalCommitmentProjectionHash,
  computeFactContentHash,
  computeReferencesRoot,
  createBountyOrderMessage,
  createComputationalArtifact,
  createComputationalClaimMessage,
  createEvidenceReceipt,
  createFulfillBountyMessage,
  createSettlementIntent,
  createTreasuryPolicy,
  createWalletIdentityBinding,
  createWalletIdentityBindingProofEnvelope,
  createWalletIdentityBindingSigningRequest,
  createWorkSpec,
} from "../src/index.js";

ed25519.etc.sha512Sync = (...messages: Uint8Array[]) => {
  const hash = createHash("sha512");
  for (const message of messages) hash.update(message);
  return Uint8Array.from(hash.digest());
};

export const HASHES = Object.freeze({
  descriptor: `sha256:${"01".repeat(32)}` as Sha256Id,
  base: `sha256:${"02".repeat(32)}` as Sha256Id,
  parent: `sha256:${"03".repeat(32)}` as Sha256Id,
  output: `sha256:${"04".repeat(32)}` as Sha256Id,
  input: `sha256:${"05".repeat(32)}` as Sha256Id,
  environment: `sha256:${"06".repeat(32)}` as Sha256Id,
  acceptance: `sha256:${"07".repeat(32)}` as Sha256Id,
  artifact: `sha256:${"08".repeat(32)}` as Sha256Id,
  executionEvidence: `sha256:${"09".repeat(32)}` as Sha256Id,
  toRoot: `sha256:${"0a".repeat(32)}` as Sha256Id,
  nodes: `sha256:${"0b".repeat(32)}` as Sha256Id,
  relations: `sha256:${"0c".repeat(32)}` as Sha256Id,
  issuer: `sha256:${"0d".repeat(32)}` as Sha256Id,
});

export const SECP_PUBLIC_KEY = Uint8Array.from(Buffer.from(
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
  "hex",
));

export const SECP_PRIVATE_KEY = Uint8Array.from(
  { length: 32 },
  (_, index) => index === 31 ? 1 : 0,
);

export const SECOND_SECP_PUBLIC_KEY = Uint8Array.from(Buffer.from(
  "0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
  "hex",
));

export function ed25519PrivateKey(offset = 0): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, index) => (index + 1 + offset) % 256);
}

export function ed25519Authority(offset = 0): Ed25519PublicKey {
  const bytes = Uint8Array.from(
    { length: 32 },
    (_, index) => (index + 1 + offset) % 256,
  );
  const publicKey = base64UrlEncode(bytes);
  return Object.freeze({
    algorithm: "Ed25519",
    key_id: keyIdForPublicKey(publicKey),
    public_key: publicKey,
  });
}

export function proofEd25519Authority(offset = 0): Ed25519PublicKey {
  const publicKey = base64UrlEncode(
    ed25519.getPublicKey(ed25519PrivateKey(offset)),
  );
  return Object.freeze({
    algorithm: "Ed25519",
    key_id: keyIdForPublicKey(publicKey),
    public_key: publicKey,
  });
}

export const FACT_CONTENT =
  "A deterministic computation proposes one digest-bound tree transition.";
export const PARENT_FACT_ID = "commitment-UW";
export const REFERENCES: readonly string[] = Object.freeze([]);

export function buildIdentityProofFixture() {
  const profile = getZeroneProfile("testnet");
  const address = zeroneAddressFromSecp256k1PublicKey(SECP_PUBLIC_KEY);
  const account = zeroneAccountId(profile, address);
  const binding = createWalletIdentityBinding({
    network: "testnet",
    owner_identity_id: "did:agenttool:sol",
    wallet_id: "wallet-sol-001",
    wallet_descriptor_id: HASHES.descriptor,
    identity_authority: proofEd25519Authority(),
    zerone_account_id: account,
    zerone_public_key: SECP_PUBLIC_KEY,
    revision: 1,
    wallet_continuity_sequence: 0,
    previous_binding_id: null,
    issued_at: "2026-08-20T18:00:00.000Z",
  });
  const bindingSigningRequest = createWalletIdentityBindingSigningRequest(binding);
  const bindingDigest = base64UrlDecode(
    bindingSigningRequest.shared_signing_digest_b64u,
  );
  const bindingProof = createWalletIdentityBindingProofEnvelope({
    binding,
    identity_signature_b64u: base64UrlEncode(
      ed25519.sign(bindingDigest, ed25519PrivateKey()),
    ),
    wallet_signature_b64u: base64UrlEncode(secp256k1.sign(
      bindingDigest,
      SECP_PRIVATE_KEY,
      { prehash: false, lowS: true, format: "compact" },
    )),
  });
  return {
    profile,
    address,
    account,
    binding,
    bindingProof,
    bindingSigningRequest,
  };
}

export function buildFixture() {
  const profile = getZeroneProfile("testnet");
  const address = zeroneAddressFromSecp256k1PublicKey(SECP_PUBLIC_KEY);
  const account = zeroneAccountId(profile, address);
  const sponsorAddress = zeroneAddressFromSecp256k1PublicKey(SECOND_SECP_PUBLIC_KEY);
  const sponsorAccount = zeroneAccountId(profile, sponsorAddress);
  const binding = createWalletIdentityBinding({
    network: "testnet",
    owner_identity_id: "did:agenttool:sol",
    wallet_id: "wallet-sol-001",
    wallet_descriptor_id: HASHES.descriptor,
    identity_authority: ed25519Authority(),
    zerone_account_id: account,
    zerone_public_key: SECP_PUBLIC_KEY,
    revision: 1,
    wallet_continuity_sequence: 0,
    previous_binding_id: null,
    issued_at: "2026-08-20T18:00:00.000Z",
  });
  const workSpec = createWorkSpec({
    network: "testnet",
    sponsor_account: sponsorAccount,
    worker_account: account,
    // Both values used by this fixture exist in Zerone's default upgraded
    // genesis. Other deployments must register their domain/method first.
    knowledge_domain: "computer_science",
    target_tree: {
      tree_id: "zerone-tree-v1",
      base_root: HASHES.base,
      parent_fact_ids: [PARENT_FACT_ID],
      transition_kind: "add_fact",
      output_contract_hash: HASHES.output,
    },
    input_root: HASHES.input,
    environment_root: HASHES.environment,
    acceptance_hash: HASHES.acceptance,
    resource_limits: {
      max_compute_millis: "100000",
      max_accelerator_millis: "50000",
      max_memory_byte_millis: "1000000000",
      max_input_bytes: "1000000",
      max_output_bytes: "1000000",
    },
    settlement: {
      denom: "uzrn",
      price_per_artifact_uzrn: "250000",
      target_count: 2,
      duration_blocks: "10000",
      min_corroborations: "2",
    },
    created_at: "2026-08-20T18:01:00.000Z",
  });
  const artifact = createComputationalArtifact({
    work_spec: workSpec,
    producer_binding: binding,
    artifact_root: HASHES.artifact,
    evidence_root: HASHES.executionEvidence,
    claim_commitment: {
      fact_content_hash: computeFactContentHash(FACT_CONTENT),
      references_root: computeReferencesRoot(REFERENCES),
      method_id: "M-COMPUTATIONAL",
    },
    proposed_tree_transition: {
      from_root: HASHES.base,
      to_root: HASHES.toRoot,
      changed_nodes_root: HASHES.nodes,
      changed_relations_root: HASHES.relations,
    },
    resource_usage: {
      compute_millis: "42000",
      accelerator_millis: "12000",
      memory_byte_millis: "500000000",
      input_bytes: "4096",
      output_bytes: "8192",
    },
    completed_at: "2026-08-20T18:05:00.000Z",
  });
  const commitmentHash = computationalCommitmentProjectionHash(artifact);
  const evidence = createEvidenceReceipt({
    work_spec: workSpec,
    artifact,
    knowledge_claim_id: "claim-001",
    knowledge_fact_id: "fact-001",
    computational_commitment_hash: commitmentHash,
    outcome: "contract_mature",
    corroborations: "2",
    challenge_window_end_height: "1200",
    observed_at_height: "1201",
    open_challenges: 0,
    issuer_id: "zerone-consensus-observation",
    issuer_key_id: HASHES.issuer,
    issued_at: "2026-08-20T18:10:00.000Z",
  });
  const settlement = createSettlementIntent({
    bounty_id: "bounty-001",
    work_spec: workSpec,
    artifact,
    evidence,
    payee_binding: binding,
    created_at: "2026-08-20T18:11:00.000Z",
    valid_until_height: "2000",
  });
  const treasury = createTreasuryPolicy({
    wallet_binding: binding,
    network: "testnet",
    wallet_binding_id: binding.binding_id,
    treasury_account: account,
    denom: "uzrn",
    reserve_floor_uzrn: "300000",
    max_single_spend_uzrn: "200000",
    window_blocks: "1000",
    window_caps_uzrn: {
      compute: "300000",
      storage: "100000",
      network_fee: "100000",
      knowledge_bond: "100000",
      total: "500000",
    },
    allowed_purposes: ["compute", "knowledge_bond", "network_fee", "storage"],
    issued_at: "2026-08-20T18:12:00.000Z",
  });
  const createBounty = createBountyOrderMessage(workSpec);
  const submitClaim = createComputationalClaimMessage({
    work_spec: workSpec,
    artifact,
    producer_binding: binding,
    fact_content: FACT_CONTENT,
    stake_uzrn: "100000",
    references: REFERENCES,
  });
  const fulfill = createFulfillBountyMessage({
    settlement_intent: settlement,
    work_spec: workSpec,
    caller_account: account,
  });
  return {
    profile,
    address,
    account,
    sponsorAddress,
    sponsorAccount,
    binding,
    workSpec,
    artifact,
    commitmentHash,
    evidence,
    settlement,
    treasury,
    createBounty,
    submitClaim,
    fulfill,
  };
}
