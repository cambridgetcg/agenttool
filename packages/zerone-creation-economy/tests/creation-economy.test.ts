import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";
import {
  base64UrlDecode,
  base64UrlEncode,
  bytesToHex,
  canonicalJson,
  equalBytes,
  type Sha256Id,
} from "@agenttool/wallet";
import {
  CHAIN_WORK_RECEIPT_DOMAIN,
  decodeCreateBountyOrderValue,
  domainSeparatedId,
  encodeCreateBountyOrderValue,
  sha256IdToChainHash,
} from "@agenttool/zerone-agent-economy";

import {
  CREATION_ECONOMY_BOUNDARY,
  CREATION_ECONOMY_COMPATIBILITY,
  CREATION_ECONOMY_EFFECTS,
  CREATION_ECONOMY_HASH_DOMAINS,
  CREATION_ECONOMY_SOURCE_PINS,
  CreationEconomyError,
  createCreationEconomyHandoff,
  decodeCreationSubmitClaimValue,
  encodeCreationEconomyAny,
  encodeCreationSubmitClaimValue,
  validateCreationEconomyHandoff,
  validateCreationEconomyMessageProjection,
} from "../src/index.js";
import {
  FIXTURE_CHAIN_REFERENCE,
  FIXTURE_REVIEW_STAKE_UZRN,
  FIXTURE_ZERONE_REVISION,
  buildReadyDefensiveSecurityCreationFixture,
  buildReadyFormalCreationFixture,
  clone,
} from "./fixtures.js";

const EXPECTED = Object.freeze({
  work_spec_id: "sha256:fcdaf6772917187c0267984dbedd5ccd46dbfa3b3ab208b265acf0cb73dc3936",
  handoff_id: "sha256:9010cb474b3ab1c895386c1eb05076c804c378e75d8cbfd07d1f26197ac0c3a9",
  work_receipt_hash: "8b900721536008da00f911647757731713a3cd070760200464baa0900a0d9253",
  create_projection_hash: "sha256:cf66abbc440f094bd919f3c905ec0d13449e469d18c56f48c67e916e48d8c645",
  create_protobuf_hash: "sha256:a477a4482824efa63f68675a1798a8ee5c288fba521d14d3c9a494061967bd4b",
  create_any_hash: "sha256:c1de3fe0012cde157a7986818c2ed613808996d27be1ed466c7811e69cb8e8fb",
  submit_projection_hash: "sha256:6493f90be3af0722afb4ca263a44b49ac65e0076ca2ea2536ea56b3aa4cd30b6",
  submit_protobuf_hash: "sha256:52320e87b978818e0cf06f2843e6e9365929d06f733056a27e4c9e7b26cf3505",
  submit_any_hash: "sha256:94650de13ebf27569d469c92cb23d0bb1beba85276372e9bd06b1895fbee0ad4",
  defensive_handoff_id: "sha256:64d215f4c7e378d9c12a65a9c1ab3e8ac23b5880f801e0d8b7bb768b2ac7ae78",
  defensive_work_receipt_hash: "0c8940674e992b9467633c2e09f59a6ce80682153b8642a0908065a34f0f689b",
  defensive_create_protobuf_hash: "sha256:d90363c671d97a7f9318c3b1f8d12328b937014c70f883974ee3ab0b67f3e826",
  defensive_create_any_hash: "sha256:5889bc926295c6370bcb3050384a0fbfeeecc90634b3f6adaf0894554f88c4dd",
  defensive_submit_protobuf_hash: "sha256:933a690b607b434de61714eac2f9fc040cf5312a4ecd07c917cd6fd3985ddaab",
  defensive_submit_any_hash: "sha256:147b3557ee69e8af0240b6460034fd6c42b64aaf033143e977e3ae47fb930a69",
} as const);

interface ParsedField {
  readonly number: number;
  readonly wire_type: number;
  readonly bytes: Uint8Array | null;
}

function handoffInput(fixture: ReturnType<typeof buildReadyFormalCreationFixture>) {
  return {
    contract: fixture.contract,
    work_spec: fixture.workSpec,
    creation_witness: fixture.creationWitness,
    verification_witnesses: fixture.verificationWitnesses,
    lifecycle: fixture.lifecycle,
    creation_artifact: fixture.creationArtifact,
    creation_claim_projection: fixture.creationClaimProjection,
    worker_binding_proof: fixture.bindingProof,
  } as const;
}

function sha256Bytes(bytes: Uint8Array): Sha256Id {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function rehashHandoff<T extends Record<string, any>>(value: T): T {
  const { handoff_id: _discarded, ...core } = value;
  value.handoff_id = domainSeparatedId(CREATION_ECONOMY_HASH_DOMAINS.handoff, core);
  return value;
}

function uint64BigEndian(value: bigint): Uint8Array {
  const output = new Uint8Array(8);
  new DataView(output.buffer).setBigUint64(0, value, false);
  return output;
}

function independentWorkReceipt(input: {
  readonly work_spec_id: Sha256Id;
  readonly acceptance_hash: Sha256Id;
  readonly input_root: Sha256Id;
  readonly environment_root: Sha256Id;
  readonly artifact_root: Sha256Id;
  readonly evidence_root: Sha256Id;
  readonly payee_address: string;
}): string {
  const fields = [
    input.work_spec_id,
    input.acceptance_hash,
    input.input_root,
    input.environment_root,
    input.artifact_root,
    input.evidence_root,
  ].map((value) => new TextEncoder().encode(value.slice("sha256:".length)));
  fields.push(new TextEncoder().encode(input.payee_address));
  const chunks = [new TextEncoder().encode("ZRN.work.receipt.v1\0")];
  for (const field of fields) {
    chunks.push(uint64BigEndian(BigInt(field.byteLength)), field);
  }
  const bytes = Buffer.concat(chunks.map((value) => Buffer.from(value)));
  return createHash("sha256").update(bytes).digest("hex");
}

function readVarint(bytes: Uint8Array, start: number) {
  let value = 0n;
  let shift = 0n;
  let offset = start;
  while (offset < bytes.length && shift <= 63n) {
    const byte = bytes[offset++]!;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7n;
  }
  throw new Error("invalid test fixture varint");
}

function parseFields(bytes: Uint8Array): readonly ParsedField[] {
  const output: ParsedField[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset);
    offset = tag.offset;
    const number = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 7n);
    if (wireType === 0) {
      offset = readVarint(bytes, offset).offset;
      output.push({ number, wire_type: wireType, bytes: null });
      continue;
    }
    if (wireType !== 2) throw new Error("unsupported test fixture wire type");
    const length = readVarint(bytes, offset);
    offset = length.offset;
    const end = offset + Number(length.value);
    if (end > bytes.length) throw new Error("truncated test fixture field");
    output.push({ number, wire_type: wireType, bytes: bytes.slice(offset, end) });
    offset = end;
  }
  return output;
}

function fieldText(fields: readonly ParsedField[], number: number): string {
  const field = fields.find((candidate) => candidate.number === number);
  if (field?.bytes === null || field?.bytes === undefined) {
    throw new Error(`missing text field ${String(number)}`);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(field.bytes);
}

describe("bounded creation to Zerone economy handoff", () => {
  test("builds one deterministic READY formal source bundle at the exact candidate", () => {
    const first = buildReadyFormalCreationFixture();
    const second = buildReadyFormalCreationFixture();

    expect(first.lifecycle.state).toBe("structurally_ready_for_tok_proposal");
    expect(first.lifecycle.blockers).toEqual([]);
    expect(first.workSpec.chain_profile.chain_id).toBe(FIXTURE_CHAIN_REFERENCE);
    expect(first.workSpec.chain_profile.integrated_source_revision).toBe(FIXTURE_ZERONE_REVISION);
    expect(first.workSpec.claim_submission.review_stake_uzrn).toBe(FIXTURE_REVIEW_STAKE_UZRN);
    expect(BigInt(first.workSpec.claim_submission.review_stake_uzrn)).toBeGreaterThanOrEqual(100000n);
    expect(first.workSpec.work_spec_id).toBe(EXPECTED.work_spec_id);
    expect(second.workSpec.work_spec_id).toBe(first.workSpec.work_spec_id);
    expect(second.creationClaimProjection.projection_id)
      .toBe(first.creationClaimProjection.projection_id);
    expect(first.binding.zerone_address).toBe(first.workSpec.worker.account_address);
    expect(first.binding.binding_id).toBe(first.workSpec.worker.wallet_binding_ref);
    expect(first.binding.zerone_signer.key_id).toBe(first.workSpec.worker.producer_key_ref);
    expect(first.binding.wallet_descriptor_id).toBe(first.workSpec.worker.wallet_controller_ref);
  });

  test("preserves the source WorkSpec, formal claim, roots, and exact receipt", () => {
    const fixture = buildReadyFormalCreationFixture();
    const handoff = createCreationEconomyHandoff(handoffInput(fixture));
    const create = handoff.messages.create_bounty.value;
    const submit = handoff.messages.submit_claim.value;
    const source = fixture.creationClaimProjection;
    const roots = fixture.creationArtifact.computational_roots;

    expect(handoff.source.creation_work_spec_id).toBe(fixture.workSpec.work_spec_id);
    expect(handoff.receipt_binding.chain_work_spec_hash).toBe(fixture.workSpec.work_spec_id);
    expect(handoff.receipt_binding.source_work_receipt_input_root)
      .toBe(fixture.creationArtifact.work_receipt_input_root);
    expect(handoff.receipt_binding.mapping)
      .toBe("SOURCE_CREATION_WORK_SPEC_ID_PRESERVED_EXACTLY");
    expect(create.work_contract.work_spec_hash)
      .toBe(sha256IdToChainHash(fixture.workSpec.work_spec_id));
    expect(submit.computational_commitment.work_spec_hash)
      .toBe(sha256IdToChainHash(fixture.workSpec.work_spec_id));

    expect(submit.fact_content).toBe(source.fact_content);
    expect(submit.domain).toBe(source.domain);
    expect(submit.category).toBe("formal");
    expect(submit.stake).toBe(FIXTURE_REVIEW_STAKE_UZRN);
    expect(submit.canonical_form).toBe(source.canonical_form);
    expect(submit.canonical_form).toBe(submit.fact_content);
    expect(submit.method_id).toBe("M-FORMAL");
    expect(submit.reasoning_trace).toBe(fixture.creationWitness.creation_witness_id);
    expect(submit.reasoning_trace).toBe(source.reasoning_trace);
    expect(submit.relations).toEqual(source.relations.map((relation) => ({
      target_fact_id: relation.target_fact_id,
      relation: 3,
      inference: 0,
      inference_strength_bps: "0",
      method_id: "",
    })));

    const independentlyDerived = independentWorkReceipt({
      work_spec_id: fixture.workSpec.work_spec_id,
      acceptance_hash: roots.acceptance_hash,
      input_root: roots.input_root,
      environment_root: roots.environment_root,
      artifact_root: roots.artifact_root,
      evidence_root: roots.evidence_root,
      payee_address: fixture.workSpec.payee_address,
    });
    expect(CHAIN_WORK_RECEIPT_DOMAIN).toBe("ZRN.work.receipt.v1\0");
    expect(independentlyDerived).toBe(EXPECTED.work_receipt_hash);
    expect(handoff.receipt_binding.chain_work_receipt_hash).toBe(independentlyDerived);
    expect(submit.computational_commitment.work_receipt_hash).toBe(independentlyDerived);
    expect(handoff.receipt_binding.source_work_receipt_input_root)
      .not.toBe(`sha256:${independentlyDerived}`);

    expect(handoff.sponsor_authority.sponsor_account)
      .toBe(`cosmos:${FIXTURE_CHAIN_REFERENCE}:${fixture.workSpec.sponsor.account_address}`);
    expect(handoff.sponsor_authority.key_control_proof_id).toBeNull();
    expect(handoff.sponsor_authority.key_control_verified_in_process).toBe(false);
    expect(handoff.sponsor_authority.role_separation)
      .toBe("DISTINCT_ACCOUNT_AND_WALLET_CONTROLLER_REQUIRED");
    expect(handoff.funding_evidence.bounty_prefunding_uzrn)
      .toBe(fixture.workSpec.settlement.prefunded_escrow_uzrn);
    expect(handoff.funding_evidence.review_stake_uzrn).toBe(submit.stake);
    expect(handoff.funding_evidence.balances_observed).toBe(false);
    expect(handoff.knowledge_context.base_root).toBe(fixture.workSpec.target_tree.base_root);
    expect(handoff.knowledge_context.parent_fact_ids)
      .toEqual(fixture.workSpec.target_tree.parent_fact_ids);
  });

  test("round-trips exact projection bytes and canonical protobuf without loss", () => {
    const fixture = buildReadyFormalCreationFixture();
    const handoff = createCreationEconomyHandoff(handoffInput(fixture));
    const create = handoff.messages.create_bounty;
    const submit = handoff.messages.submit_claim;

    expect(validateCreationEconomyHandoff(clone(handoff), handoffInput(fixture))).toEqual(handoff);
    expect(validateCreationEconomyMessageProjection(clone(create))).toEqual(create);
    expect(validateCreationEconomyMessageProjection(clone(submit))).toEqual(submit);

    const createBytes = base64UrlDecode(create.protobuf_value_b64u);
    const submitBytes = base64UrlDecode(submit.protobuf_value_b64u);
    expect(decodeCreateBountyOrderValue(createBytes)).toEqual(create.value);
    expect(decodeCreationSubmitClaimValue(submitBytes)).toEqual(submit.value);
    expect(equalBytes(encodeCreateBountyOrderValue(create.value), createBytes)).toBe(true);
    expect(equalBytes(encodeCreationSubmitClaimValue(submit.value), submitBytes)).toBe(true);
    expect(sha256Bytes(createBytes)).toBe(create.protobuf_value_hash);
    expect(sha256Bytes(submitBytes)).toBe(submit.protobuf_value_hash);
    expect(create.projection_hash).toBe(EXPECTED.create_projection_hash);
    expect(create.protobuf_value_hash).toBe(EXPECTED.create_protobuf_hash);
    expect(submit.projection_hash).toBe(EXPECTED.submit_projection_hash);
    expect(submit.protobuf_value_hash).toBe(EXPECTED.submit_protobuf_hash);
    expect(create.protobuf_any_hash).toBe(EXPECTED.create_any_hash);
    expect(submit.protobuf_any_hash).toBe(EXPECTED.submit_any_hash);
    expect(handoff.handoff_id).toBe(EXPECTED.handoff_id);

    for (const projection of [create, submit] as const) {
      const projectionBytes = base64UrlDecode(projection.projection_bytes_b64u);
      expect(new TextDecoder().decode(projectionBytes)).toBe(canonicalJson({
        type_url: projection.type_url,
        value: projection.value,
      }));
      expect(sha256Bytes(projectionBytes)).toBe(projection.projection_hash);
      const valueBytes = base64UrlDecode(projection.protobuf_value_b64u);
      const anyBytes = base64UrlDecode(projection.protobuf_any_b64u);
      expect(equalBytes(
        encodeCreationEconomyAny(projection.type_url, valueBytes),
        anyBytes,
      )).toBe(true);
      expect(sha256Bytes(anyBytes)).toBe(projection.protobuf_any_hash);
    }

    const fields = parseFields(submitBytes);
    expect(fields.map((field) => field.number)).toEqual([
      1, 2, 3, 4, 5, 8, 9, 9, 11, 13, 14, 15,
    ]);
    expect(fieldText(fields, 4)).toBe("formal");
    expect(fieldText(fields, 11)).toBe(fixture.creationClaimProjection.canonical_form);
    expect(fieldText(fields, 13)).toBe("M-FORMAL");
    expect(fieldText(fields, 14)).toBe(fixture.creationWitness.creation_witness_id);
  });

  test("retains the offline zero-effect boundary and never manufactures Fulfill", () => {
    const fixture = buildReadyFormalCreationFixture();
    const handoff = createCreationEconomyHandoff(handoffInput(fixture));

    expect(handoff.effects).toEqual(CREATION_ECONOMY_EFFECTS);
    expect(Object.values(handoff.effects).every((effect) => effect === false)).toBe(true);
    expect(handoff.boundary).toEqual(CREATION_ECONOMY_BOUNDARY);
    expect(handoff.boundary.transaction_authority_proven).toBe(false);
    expect(handoff.boundary.wallet_planner_admissible).toBe(false);
    expect(handoff.boundary.chain_maturity_observed).toBe(false);
    expect(handoff.boundary.settlement_authorized).toBe(false);
    expect(handoff.boundary.earnings_observed).toBe(false);
    expect(handoff.boundary.named_upgrade_boundary_proven).toBe(false);
    expect(handoff.boundary.verifier_selection_integrity_proven).toBe(false);
    expect(handoff.boundary.agent_controlled_sybil_resistance_proven).toBe(false);
    expect(handoff.boundary.authenticated_chain_roundtrip_proven).toBe(false);
    expect(handoff.boundary.economic_security_proven).toBe(false);
    expect(handoff.boundary.mainnet_admissible).toBe(false);
    expect(handoff.boundary.chain_reference_uniqueness_proven).toBe(false);
    expect(handoff.boundary.chain_privacy_proven).toBe(false);
    expect(handoff.boundary.chain_disposability_proven).toBe(false);
    expect(handoff.boundary.target_tree_transition_enforced_on_chain).toBe(false);
    expect(handoff.boundary.base_root_compare_and_swap_available).toBe(false);
    expect(handoff.messages.fulfill_bounty).toBeNull();
    expect(handoff.messages.fulfillment_status)
      .toBe("BLOCKED_PENDING_AUTHENTICATED_CHAIN_MATURITY");
    expect(handoff.messages.create_bounty.compatibility).toEqual(CREATION_ECONOMY_COMPATIBILITY);
    expect(handoff.messages.submit_claim.compatibility.effects_performed).toBe(false);
    expect(handoff.messages.submit_claim.compatibility.shared_agenttool_zerone_vector)
      .toBe("exact_value_and_any_bytes_pinned_at_a5b82e82");
    expect(handoff.messages.submit_claim.compatibility.authenticated_stored_state_roundtrip)
      .toBe("blocked_pending_private_chain_evidence");
    expect(handoff.wallet_identity.key_control_proof_scope_chain_id)
      .toBe("cosmos:zerone-testnet-1");
    expect(handoff.wallet_identity.worker_account)
      .toBe(`cosmos:${FIXTURE_CHAIN_REFERENCE}:${fixture.address}`);
    expect(handoff.activation_evidence.zerone_core_commit)
      .toBe(CREATION_ECONOMY_SOURCE_PINS.zerone_core_commit);
    expect(handoff.activation_evidence.chain_reference_uniqueness_proven).toBe(false);
    expect(handoff.activation_evidence.chain_privacy_proven).toBe(false);
    expect(handoff.activation_evidence.chain_disposability_proven).toBe(false);
  });

  test("preserves a bounded OpenAI Cyber computational creation without inflating authority", () => {
    const fixture = buildReadyDefensiveSecurityCreationFixture();
    const input = handoffInput(fixture);
    const handoff = createCreationEconomyHandoff(input);
    const submit = handoff.messages.submit_claim;

    expect(fixture.contract.lane).toBe("defensive_security");
    expect(fixture.contract.artifact_kind).toBe("security_invariant");
    expect(fixture.contract.authorities.cyber.provider).toBe("openai_cyber");
    expect(fixture.contract.authorities.cyber.access_tier).toBe("defensive_approved");
    expect(fixture.contract.authorities.cyber.provider_access_ref)
      .not.toBe(fixture.contract.authorities.target_authorization_ref);
    expect(fixture.contract.authorities.target_authorization_ref)
      .not.toBe(fixture.contract.authorities.engagement_scope_ref);
    expect(fixture.verificationWitnesses).toHaveLength(7);
    expect(fixture.lifecycle.state).toBe("structurally_ready_for_tok_proposal");
    expect(fixture.lifecycle.blockers).toEqual([]);
    for (const kind of ["authorization_currentness", "security_boundary"] as const) {
      expect(fixture.lifecycle.requirements.find((entry) => entry.kind === kind)?.status)
        .toBe("satisfied");
    }

    expect(handoff.creation_scope).toEqual({
      lane: fixture.contract.lane,
      artifact_kind: fixture.contract.artifact_kind,
      cyber_provider: fixture.contract.authorities.cyber.provider,
      cyber_access_tier: fixture.contract.authorities.cyber.access_tier,
      provider_access_ref: fixture.contract.authorities.cyber.provider_access_ref,
      provider_policy_ref: fixture.contract.authorities.cyber.provider_policy_ref,
      target_authorization_ref: fixture.contract.authorities.target_authorization_ref,
      engagement_scope_ref: fixture.contract.authorities.engagement_scope_ref,
      publication_authority_ref: fixture.contract.authorities.publication_authority_ref,
      evidence_scope: "SOURCE_CONTRACT_RECOMPUTED_CALLER_DECLARATIONS_NOT_CURRENTNESS_PROOF",
      provider_access_is_target_authorization: false,
      target_authorization_currentness_proven: false,
      engagement_scope_currentness_proven: false,
    });
    expect(submit.value.category).toBe("computational");
    expect(submit.value.method_id).toBe("M-COMPUTATIONAL");
    expect(submit.value.fact_content).toBe(submit.value.canonical_form);
    expect(handoff.handoff_id).toBe(EXPECTED.defensive_handoff_id);
    expect(handoff.receipt_binding.chain_work_receipt_hash)
      .toBe(EXPECTED.defensive_work_receipt_hash);
    expect(handoff.messages.create_bounty.protobuf_value_hash)
      .toBe(EXPECTED.defensive_create_protobuf_hash);
    expect(handoff.messages.create_bounty.protobuf_any_hash)
      .toBe(EXPECTED.defensive_create_any_hash);
    expect(submit.protobuf_value_hash).toBe(EXPECTED.defensive_submit_protobuf_hash);
    expect(submit.protobuf_any_hash).toBe(EXPECTED.defensive_submit_any_hash);
    const submitBytes = base64UrlDecode(submit.protobuf_value_b64u);
    expect(decodeCreationSubmitClaimValue(submitBytes)).toEqual(submit.value);
    expect(equalBytes(encodeCreationSubmitClaimValue(submit.value), submitBytes)).toBe(true);
    expect(validateCreationEconomyHandoff(clone(handoff), input)).toEqual(handoff);
    expect(Object.values(handoff.effects).every((effect) => effect === false)).toBe(true);
  });

  test("rejects source-valid defensive provider tuples outside the narrow bridge profile", () => {
    for (const cyber_profile of ["none", "other_advanced"] as const) {
      const fixture = buildReadyDefensiveSecurityCreationFixture({ cyber_profile });
      expect(fixture.lifecycle.state).toBe("structurally_ready_for_tok_proposal");
      expect(() => createCreationEconomyHandoff(handoffInput(fixture)))
        .toThrow(/supports only the OpenAI Cyber defensive-approved tuple/u);
    }
  });

  test("rejects source-valid target and engagement refs on the formal bridge profile", () => {
    const fixture = buildReadyFormalCreationFixture({ formal_authority_refs: true });
    expect(fixture.lifecycle.state).toBe("structurally_ready_for_tok_proposal");
    expect(() => createCreationEconomyHandoff(handoffInput(fixture)))
      .toThrow(/formal bridge profile cannot carry Cyber or target-engagement/u);
  });

  test("requires publication authority to be distinct from every defensive authority ref", () => {
    const fixture = buildReadyDefensiveSecurityCreationFixture({
      publication_authority_overlaps_provider: true,
    });
    expect(fixture.lifecycle.state).toBe("structurally_ready_for_tok_proposal");
    expect(() => createCreationEconomyHandoff(handoffInput(fixture)))
      .toThrow(/authority refs must all be distinct/u);
  });

  test("matches Zerone generated Go value and Any bytes for both exact-pin cases", async () => {
    const formal = createCreationEconomyHandoff(handoffInput(
      buildReadyFormalCreationFixture(),
    ));
    const defensive = createCreationEconomyHandoff(handoffInput(
      buildReadyDefensiveSecurityCreationFixture(),
    ));
    const goVector = JSON.parse(await Bun.file(new URL(
      "../vectors/go-cosmos-creation-economy-v0.1.json",
      import.meta.url,
    )).text());

    expect(goVector.source_pins.zerone_core_commit)
      .toBe(CREATION_ECONOMY_SOURCE_PINS.zerone_core_commit);
    expect(goVector.generator_evidence).toEqual({
      relevant_source_status: "head_exact_no_changes_or_extra_files",
      zerone_git_head: CREATION_ECONOMY_SOURCE_PINS.zerone_core_commit,
      zerone_module: "github.com/zerone-chain/zerone",
    });
    expect(goVector.consensus_hashes.work_receipt_hash)
      .toBe(formal.receipt_binding.chain_work_receipt_hash);
    expect(goVector.consensus_hashes.defensive_security_work_receipt_hash)
      .toBe(defensive.receipt_binding.chain_work_receipt_hash);

    for (const [prefix, handoff] of [
      ["", formal],
      ["defensive_security_", defensive],
    ] as const) {
      expect(goVector.values[`${prefix}create_bounty_value`].hex)
        .toBe(bytesToHex(base64UrlDecode(handoff.messages.create_bounty.protobuf_value_b64u)));
      expect(goVector.values[`${prefix}create_bounty_any`].hex)
        .toBe(bytesToHex(base64UrlDecode(handoff.messages.create_bounty.protobuf_any_b64u)));
      expect(goVector.values[`${prefix}submit_claim_value`].hex)
        .toBe(bytesToHex(base64UrlDecode(handoff.messages.submit_claim.protobuf_value_b64u)));
      expect(goVector.values[`${prefix}submit_claim_any`].hex)
        .toBe(bytesToHex(base64UrlDecode(handoff.messages.submit_claim.protobuf_any_b64u)));
      expect(goVector.values[`${prefix}create_bounty_value`].sha256_id)
        .toBe(handoff.messages.create_bounty.protobuf_value_hash);
      expect(goVector.values[`${prefix}create_bounty_any`].sha256_id)
        .toBe(handoff.messages.create_bounty.protobuf_any_hash);
      expect(goVector.values[`${prefix}submit_claim_value`].sha256_id)
        .toBe(handoff.messages.submit_claim.protobuf_value_hash);
      expect(goVector.values[`${prefix}submit_claim_any`].sha256_id)
        .toBe(handoff.messages.submit_claim.protobuf_any_hash);
    }
  });

  test("rejects shared, reserved, and overlong chain identities", () => {
    for (const chainReference of [
      "zerone-1",
      "zerone-testnet-1",
      "zerone-creation-private-fixture-1",
    ]) {
      const fixture = buildReadyFormalCreationFixture({
        chain_reference: chainReference,
      });
      expect(() => createCreationEconomyHandoff(handoffInput(fixture)))
        .toThrow(CreationEconomyError);
    }
  });

  test("rejects the wrong Zerone revision and a serialized unbranded proof", () => {
    const wrongRevision = buildReadyFormalCreationFixture({
      zerone_revision: "b".repeat(40),
    });
    expect(() => createCreationEconomyHandoff(handoffInput(wrongRevision)))
      .toThrow(/chain_profile\.integrated_source_revision/u);

    const fixture = buildReadyFormalCreationFixture();
    const unbranded = clone(fixture.bindingProof);
    expect(() => createCreationEconomyHandoff({
      ...handoffInput(fixture),
      worker_binding_proof: unbranded,
    })).toThrow(/returned by a create or verify function in this process/u);
  });

  test("rejects sponsor/worker account or controller overlap", () => {
    for (const sponsor_overlap of ["account", "controller", "both"] as const) {
      const fixture = buildReadyFormalCreationFixture({ sponsor_overlap });
      expect(() => createCreationEconomyHandoff(handoffInput(fixture)))
        .toThrow(/sponsor and worker require distinct accounts and wallet controllers/u);
    }
  });

  test("revalidates the exact source bundle and branded proof after reload", () => {
    const fixture = buildReadyFormalCreationFixture();
    const handoff = createCreationEconomyHandoff(handoffInput(fixture));

    const changedProof = rehashHandoff(clone<any>(handoff));
    changedProof.wallet_identity.wallet_binding_proof_id = `sha256:${"f".repeat(64)}`;
    rehashHandoff(changedProof);
    expect(() => validateCreationEconomyHandoff(changedProof, handoffInput(fixture)))
      .toThrow(/exact recomputed source bundle and branded proof/u);

    for (const key of [
      "contract_id",
      "creation_artifact_id",
      "creation_claim_projection_id",
    ] as const) {
      const changedSource = clone<any>(handoff);
      changedSource.source[key] = `sha256:${"e".repeat(64)}`;
      rehashHandoff(changedSource);
      expect(() => validateCreationEconomyHandoff(changedSource, handoffInput(fixture)))
        .toThrow(/exact recomputed source bundle and branded proof/u);
    }

    expect(() => (validateCreationEconomyHandoff as any)(clone(handoff)))
      .toThrow(/exact source bundle and an in-process branded worker proof/u);
  });

  test("rejects accessor-swapped source fields without reading the accessor", () => {
    const fixture = buildReadyFormalCreationFixture();
    const source = handoffInput(fixture);
    const handoff = createCreationEconomyHandoff(source);
    const { worker_binding_proof: _proof, ...dataFields } = source;
    let reads = 0;
    const accessorInput = { ...dataFields } as Record<string, unknown>;
    Object.defineProperty(accessorInput, "worker_binding_proof", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1
          ? fixture.bindingProof
          : reads === 2
            ? { binding: fixture.binding }
            : { proof_id: `sha256:${"f".repeat(64)}` };
      },
    });

    expect(() => createCreationEconomyHandoff(accessorInput as any))
      .toThrow(/own data properties, not accessors/u);
    expect(() => validateCreationEconomyHandoff(clone(handoff), accessorInput as any))
      .toThrow(/own data properties, not accessors/u);
    expect(reads).toBe(0);
  });

  test("rejects receipt and protobuf message mutations", () => {
    const fixture = buildReadyFormalCreationFixture();
    const handoff = createCreationEconomyHandoff(handoffInput(fixture));

    const changedReceipt = clone<any>(handoff);
    changedReceipt.receipt_binding.chain_work_receipt_hash =
      `${"0".repeat(63)}1`;
    expect(() => validateCreationEconomyHandoff(changedReceipt, handoffInput(fixture)))
      .toThrow(/chain_work_receipt_hash/u);

    const changedMessage = clone<any>(handoff);
    const messageBytes = base64UrlDecode(
      changedMessage.messages.submit_claim.protobuf_value_b64u,
    );
    messageBytes[messageBytes.length - 1] ^= 1;
    changedMessage.messages.submit_claim.protobuf_value_b64u =
      base64UrlEncode(messageBytes);
    expect(() => validateCreationEconomyHandoff(changedMessage, handoffInput(fixture)))
      .toThrow(CreationEconomyError);

    const changedAny = clone<any>(handoff);
    changedAny.messages.submit_claim.protobuf_any_b64u =
      changedAny.messages.create_bounty.protobuf_any_b64u;
    expect(() => validateCreationEconomyHandoff(changedAny, handoffInput(fixture)))
      .toThrow(CreationEconomyError);

    const changedFunding = clone<any>(handoff);
    changedFunding.funding_evidence.bounty_prefunding_uzrn = "999";
    expect(() => validateCreationEconomyHandoff(changedFunding, handoffInput(fixture)))
      .toThrow(/bounty_prefunding_uzrn/u);

    const changedParent = clone<any>(handoff);
    changedParent.knowledge_context.parent_fact_ids[0] = "fact-other";
    expect(() => validateCreationEconomyHandoff(changedParent, handoffInput(fixture)))
      .toThrow(CreationEconomyError);
  });

  test("keeps standalone Create projection admission at one artifact and uint64 amounts", () => {
    const fixture = buildReadyFormalCreationFixture();
    const handoff = createCreationEconomyHandoff(handoffInput(fixture));
    const widenedBytes = encodeCreateBountyOrderValue({
      ...handoff.messages.create_bounty.value,
      target_count: 2,
    });
    const widened = clone<any>(handoff.messages.create_bounty);
    widened.protobuf_value_b64u = base64UrlEncode(widenedBytes);
    expect(() => validateCreationEconomyMessageProjection(clone(widened)))
      .toThrow(/target_count must remain exactly 1/u);
    expect(() => encodeCreationEconomyAny(
      widened.type_url,
      widenedBytes,
    )).toThrow(/target_count must remain exactly 1/u);

    const oversizedPriceBytes = encodeCreateBountyOrderValue({
      ...handoff.messages.create_bounty.value,
      price_per_artifact: "18446744073709551616",
    });
    const oversizedPrice = clone<any>(handoff.messages.create_bounty);
    oversizedPrice.protobuf_value_b64u = base64UrlEncode(oversizedPriceBytes);
    expect(() => validateCreationEconomyMessageProjection(clone(oversizedPrice)))
      .toThrow(/value\.price_per_artifact/u);
    expect(() => encodeCreationEconomyAny(
      oversizedPrice.type_url,
      oversizedPriceBytes,
    )).toThrow(/value\.price_per_artifact/u);
  });

  test("rejects Any type confusion and concurrently mutable wire input", () => {
    const fixture = buildReadyFormalCreationFixture();
    const handoff = createCreationEconomyHandoff(handoffInput(fixture));
    const createBytes = base64UrlDecode(handoff.messages.create_bounty.protobuf_value_b64u);
    const submitBytes = base64UrlDecode(handoff.messages.submit_claim.protobuf_value_b64u);

    expect(() => encodeCreationEconomyAny(
      handoff.messages.create_bounty.type_url,
      submitBytes,
    )).toThrow();
    expect(() => encodeCreationEconomyAny(
      handoff.messages.submit_claim.type_url,
      createBytes,
    )).toThrow();

    const shared = new Uint8Array(new SharedArrayBuffer(submitBytes.byteLength));
    shared.set(submitBytes);
    expect(() => decodeCreationSubmitClaimValue(shared)).toThrow(/shared memory/u);
    expect(() => encodeCreationEconomyAny(
      handoff.messages.submit_claim.type_url,
      shared,
    )).toThrow(/shared memory/u);

    const disguisedBacking = new SharedArrayBuffer(submitBytes.byteLength);
    const disguisedShared = new Uint8Array(disguisedBacking);
    disguisedShared.set(submitBytes);
    Object.setPrototypeOf(disguisedBacking, ArrayBuffer.prototype);
    expect(() => decodeCreationSubmitClaimValue(disguisedShared))
      .toThrow(/shared memory/u);
    expect(() => encodeCreationEconomyAny(
      handoff.messages.submit_claim.type_url,
      disguisedShared,
    )).toThrow(/shared memory/u);

    let iteratorUsed = false;
    class IteratorOverride extends Uint8Array {
      override *[Symbol.iterator](): Uint8ArrayIterator<number> {
        iteratorUsed = true;
        yield* super[Symbol.iterator]();
      }
    }
    const iteratorOverride = new IteratorOverride(submitBytes);
    expect(decodeCreationSubmitClaimValue(iteratorOverride)).toEqual(
      handoff.messages.submit_claim.value,
    );
    expect(iteratorUsed).toBe(false);

    class SharedSlotOverride extends Uint8Array {
      override get buffer(): ArrayBuffer {
        return new ArrayBuffer(1);
      }

      override get byteLength(): number {
        return 1;
      }
    }
    const hiddenShared = new SharedSlotOverride(
      new SharedArrayBuffer(submitBytes.byteLength),
    );
    expect(() => decodeCreationSubmitClaimValue(hiddenShared)).toThrow(/shared memory/u);
  });
});
