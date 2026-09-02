import { readFile, writeFile } from "node:fs/promises";

import {
  CREATION_ECONOMY_BOUNDARY,
  CREATION_ECONOMY_COMPATIBILITY,
  CREATION_ECONOMY_EFFECTS,
  CREATION_ECONOMY_FORMATS,
  CREATION_ECONOMY_SOURCE_PINS,
} from "../dist/index.js";

const check = process.argv.includes("--check");
const draft = "https://json-schema.org/draft/2020-12/schema";
const sha256 = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const nullableSha256 = { anyOf: [sha256, { type: "null" }] };
const bareSha256 = { type: "string", pattern: "^[0-9a-f]{64}$" };
const address = { type: "string", pattern: "^zrn1[0-9a-z]{38}$" };
const chainId = {
  type: "string",
  pattern: "^cosmos:zerone-creation-private-[a-z0-9](?:[a-z0-9-]{0,6}[a-z0-9])?$",
};
const account = {
  type: "string",
  pattern: "^cosmos:zerone-creation-private-[a-z0-9](?:[a-z0-9-]{0,6}[a-z0-9])?:zrn1[0-9a-z]{38}$",
};
const identifier = { type: "string", minLength: 1, maxLength: 256 };
const positiveUint64 = {
  type: "string",
  pattern: "^[1-9][0-9]{0,19}$",
};
const base64url = {
  type: "string",
  minLength: 1,
  maxLength: 180_000,
  pattern: "^[A-Za-z0-9_-]+$",
};
const semanticBoundary = {
  zrn_role: "settlement_and_compute_asset_only",
  creates_identity: false,
  determines_truth: false,
  creates_karma: false,
  grants_governance: false,
};
const structuralLimit =
  "STRUCTURAL_ONLY: this schema checks closed JSON shape and fixed literals. "
  + "It cannot recompute hashes or protobuf bytes, prove source-bundle/proof provenance, "
  + "or enforce cross-record account, chain, receipt, and message equality. ";
const messageStructuralComment = structuralLimit
  + "Use validateCreationEconomyMessageProjection for standalone byte/value coupling; "
  + "only an enclosing source-bound handoff can establish source provenance.";
const handoffStructuralComment = structuralLimit
  + "Use validateCreationEconomyHandoff with the exact source bundle and branded proof.";

function object(properties) {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

const workContract = object({
  work_spec_hash: bareSha256,
  acceptance_hash: bareSha256,
  input_root: bareSha256,
  environment_root: bareSha256,
  min_corroborations: positiveUint64,
  worker_address: address,
});

const commitment = object({
  work_spec_hash: bareSha256,
  acceptance_hash: bareSha256,
  input_root: bareSha256,
  environment_root: bareSha256,
  artifact_root: bareSha256,
  evidence_root: bareSha256,
  work_receipt_hash: bareSha256,
});

const requiresRelation = object({
  target_fact_id: identifier,
  relation: { const: 3 },
  inference: { const: 0 },
  inference_strength_bps: { const: "0" },
  method_id: { const: "" },
});

const createBounty = object({
  sponsor: address,
  domain: identifier,
  price_per_artifact: positiveUint64,
  target_count: { const: 1 },
  duration_blocks: positiveUint64,
  work_contract: workContract,
});

const submitClaim = object({
  submitter: address,
  fact_content: {
    type: "string",
    pattern: "^agenttool\\.zerone-creation-fact-envelope/0\\.1 sha256:[0-9a-f]{64}$",
  },
  domain: identifier,
  category: { enum: ["formal", "computational"] },
  stake: positiveUint64,
  references: { type: "array", maxItems: 0 },
  partnership_id: { const: "" },
  claim_type: { const: 7 },
  relations: {
    type: "array",
    maxItems: 16,
    uniqueItems: true,
    items: requiresRelation,
  },
  structure: { type: "null" },
  canonical_form: {
    type: "string",
    pattern: "^agenttool\\.zerone-creation-fact-envelope/0\\.1 sha256:[0-9a-f]{64}$",
  },
  sponsored: { const: false },
  method_id: { enum: ["M-FORMAL", "M-COMPUTATIONAL"] },
  reasoning_trace: sha256,
  computational_commitment: commitment,
});
submitClaim.allOf = [
  {
    if: { properties: { category: { const: "formal" } }, required: ["category"] },
    then: { properties: { method_id: { const: "M-FORMAL" } } },
  },
  {
    if: { properties: { category: { const: "computational" } }, required: ["category"] },
    then: { properties: { method_id: { const: "M-COMPUTATIONAL" } } },
  },
];

function projection(typeURL, walletMethod, value) {
  return object({
    format: { const: CREATION_ECONOMY_FORMATS.message_projection },
    network: { const: "requested_private_disposable_testnet" },
    chain_id: chainId,
    source_account: account,
    type_url: { const: typeURL },
    wallet_method: { const: walletMethod },
    value,
    projection_bytes_b64u: base64url,
    projection_hash: sha256,
    protobuf_value_b64u: base64url,
    protobuf_value_hash: sha256,
    protobuf_any_b64u: base64url,
    protobuf_any_hash: sha256,
    compatibility: { const: CREATION_ECONOMY_COMPATIBILITY },
    semantic_boundary: { const: semanticBoundary },
  });
}

const createProjection = projection(
  "/zerone.sponsorship.v1.MsgCreateBountyOrder",
  "zerone.sponsorship.v1.MsgCreateBountyOrder",
  createBounty,
);
const submitProjection = projection(
  "/zerone.knowledge.v1.MsgSubmitClaim",
  "zerone.knowledge.v1.MsgSubmitClaim",
  submitClaim,
);

const creationScope = object({
  lane: { enum: ["formal_math", "defensive_security"] },
  artifact_kind: {
    enum: [
      "algorithm",
      "bounded_process_result",
      "counterexample",
      "defensive_patch",
      "detector",
      "formal_result",
      "security_invariant",
    ],
  },
  cyber_provider: { enum: ["none", "openai_cyber"] },
  cyber_access_tier: { enum: ["not_used", "defensive_approved"] },
  provider_access_ref: nullableSha256,
  provider_policy_ref: nullableSha256,
  target_authorization_ref: nullableSha256,
  engagement_scope_ref: nullableSha256,
  publication_authority_ref: sha256,
  evidence_scope: {
    const: "SOURCE_CONTRACT_RECOMPUTED_CALLER_DECLARATIONS_NOT_CURRENTNESS_PROOF",
  },
  provider_access_is_target_authorization: { const: false },
  target_authorization_currentness_proven: { const: false },
  engagement_scope_currentness_proven: { const: false },
});
creationScope.allOf = [
  {
    if: { properties: { lane: { const: "formal_math" } }, required: ["lane"] },
    then: {
      properties: {
        cyber_provider: { const: "none" },
        cyber_access_tier: { const: "not_used" },
        provider_access_ref: { type: "null" },
        provider_policy_ref: { type: "null" },
        target_authorization_ref: { type: "null" },
        engagement_scope_ref: { type: "null" },
      },
    },
  },
  {
    if: { properties: { lane: { const: "defensive_security" } }, required: ["lane"] },
    then: {
      properties: {
        cyber_provider: { const: "openai_cyber" },
        cyber_access_tier: { const: "defensive_approved" },
        provider_access_ref: sha256,
        provider_policy_ref: sha256,
        target_authorization_ref: sha256,
        engagement_scope_ref: sha256,
      },
    },
  },
];

const messageSchema = {
  $schema: draft,
  $id: "https://agenttool.dev/schemas/zerone-creation-economy/message-projection-v0.1",
  title: "AgentTool Zerone creation economy structural message projection v0.1",
  $comment: messageStructuralComment,
  description: "Structural interchange preflight only; runtime semantic validation remains required.",
  oneOf: [createProjection, submitProjection],
};

const handoffSchema = {
  $schema: draft,
  $id: "https://agenttool.dev/schemas/zerone-creation-economy/handoff-v0.1",
  title: "AgentTool Zerone creation economy structural handoff v0.1",
  $comment: handoffStructuralComment,
  description: "Structural interchange preflight only; exact source-bound runtime validation remains required.",
  ...object({
    format: { const: CREATION_ECONOMY_FORMATS.handoff },
    handoff_id: sha256,
    source: object({
      contract_id: sha256,
      creation_work_spec_id: sha256,
      creation_witness_id: sha256,
      lifecycle_id: sha256,
      creation_artifact_id: sha256,
      creation_claim_projection_id: sha256,
      source_claim_status: { const: "NOT_CONSENSUS_ADMISSIBLE" },
    }),
    creation_scope: creationScope,
    activation_evidence: object({
      zerone_core_commit: { const: CREATION_ECONOMY_SOURCE_PINS.zerone_core_commit },
      cosmos_sdk: { const: CREATION_ECONOMY_SOURCE_PINS.cosmos_sdk },
      chain_reference: {
        type: "string",
        pattern: "^zerone-creation-private-[a-z0-9](?:[a-z0-9-]{0,6}[a-z0-9])?$",
      },
      chain_id: chainId,
      knowledge_consensus_version: { const: 7 },
      sponsorship_consensus_version: { const: 2 },
      binary_ref: sha256,
      genesis_ref: sha256,
      version_map_ref: sha256,
      migration_evidence_ref: sha256,
      bounty_roundtrip_evidence_ref: sha256,
      claim_roundtrip_evidence_ref: sha256,
      evidence_scope: { const: "caller_declared_structural_only" },
      chain_reference_uniqueness_proven: { const: false },
      chain_privacy_proven: { const: false },
      chain_disposability_proven: { const: false },
      currentness_proven: { const: false },
    }),
    wallet_identity: object({
      worker_account: account,
      worker_address: address,
      wallet_binding_id: sha256,
      wallet_binding_proof_id: sha256,
      wallet_descriptor_id: sha256,
      signer_key_id: sha256,
      producer_identity_ref: sha256,
      key_control_proof_scope_chain_id: { const: "cosmos:zerone-testnet-1" },
      key_control_verified_in_process: { const: true },
      identity_root_currentness_proven: { const: false },
      wallet_binding_head_currentness_proven: { const: false },
      custody_proven: { const: false },
      transaction_authority_proven: { const: false },
    }),
    sponsor_authority: object({
      sponsor_account: account,
      sponsor_address: address,
      wallet_controller_ref: sha256,
      bounty_escrow_authorization_ref: sha256,
      role_separation: { const: "DISTINCT_ACCOUNT_AND_WALLET_CONTROLLER_REQUIRED" },
      key_control_proof_id: { type: "null" },
      key_control_verified_in_process: { const: false },
      custody_proven: { const: false },
      transaction_authority_proven: { const: false },
    }),
    funding_evidence: object({
      denom: { const: "uzrn" },
      bounty_prefunding_uzrn: positiveUint64,
      bounty_escrow_reservation_ref: sha256,
      review_stake_uzrn: positiveUint64,
      review_stake_payer_address: address,
      review_stake_funding_ref: sha256,
      transaction_fee_payer_address: address,
      transaction_fee_reservation_ref: sha256,
      observation_status: { const: "caller_declared_reserved_not_verified" },
      balances_observed: { const: false },
      reservations_current: { const: false },
      minting_allowed: { const: false },
    }),
    knowledge_context: object({
      tree_id: identifier,
      base_root: sha256,
      parent_fact_ids: {
        type: "array",
        maxItems: 16,
        uniqueItems: true,
        items: identifier,
      },
      transition_kind: { const: "add_fact" },
      relation_support: { const: "requires_only" },
      domain: identifier,
      category: { enum: ["formal", "computational"] },
      method_id: { enum: ["M-FORMAL", "M-COMPUTATIONAL"] },
      methodology_registry_evidence_ref: sha256,
      chain_domain_observed: { const: false },
      method_registry_currentness_proven: { const: false },
      tree_base_root_currentness_proven: { const: false },
      parent_facts_exist_proven: { const: false },
      parent_facts_citable_proven: { const: false },
    }),
    receipt_binding: object({
      chain_work_spec_hash: sha256,
      mapping: { const: "SOURCE_CREATION_WORK_SPEC_ID_PRESERVED_EXACTLY" },
      acceptance_hash: sha256,
      input_root: sha256,
      environment_root: sha256,
      artifact_root: sha256,
      evidence_root: sha256,
      payee_address: address,
      source_work_receipt_input_root: sha256,
      chain_work_receipt_hash: bareSha256,
    }),
    messages: object({
      lifecycle: { const: "SEQUENTIAL_ONE_MESSAGE_PLANS_ONLY" },
      create_bounty: createProjection,
      submit_claim: submitProjection,
      fulfill_bounty: { type: "null" },
      fulfillment_status: { const: "BLOCKED_PENDING_AUTHENTICATED_CHAIN_MATURITY" },
    }),
    boundary: { const: CREATION_ECONOMY_BOUNDARY },
    effects: { const: CREATION_ECONOMY_EFFECTS },
  }),
};

for (const [name, schema] of [
  ["message-projection-v0.1.schema.json", messageSchema],
  ["handoff-v0.1.schema.json", handoffSchema],
]) {
  const target = new URL(`../schema/${name}`, import.meta.url);
  const rendered = `${JSON.stringify(schema, null, 2)}\n`;
  if (check) {
    const current = await readFile(target, "utf8").catch(() => "");
    if (current !== rendered) throw new Error(`${name} is stale`);
  } else {
    await writeFile(target, rendered);
  }
}
