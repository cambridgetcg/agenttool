import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  zeroneAccountId,
  zeroneAddressFromSecp256k1PublicKey,
} from "@agenttool/wallet-zerone";

import {
  deriveChainSettlementNullifier,
  deriveChainWorkReceiptHash,
  domainSeparatedId,
  decodeCreateBountyOrderValue,
  decodeFulfillBountyValue,
  decodeSubmitComputationalClaimValue,
  encodeCreateBountyOrderValue,
  encodeFulfillBountyValue,
  encodeSubmitComputationalClaimValue,
  createFulfillBountyMessage,
  createComputationalArtifact,
  createComputationalClaimMessage,
  createEvidenceReceipt,
  createSettlementIntent,
  createWalletIdentityBinding,
  HASH_DOMAINS,
  sha256IdToChainHash,
  toChainComputationalCommitment,
  validateComputationalArtifact,
} from "../src/index.js";
import {
  buildFixture,
  FACT_CONTENT,
  HASHES,
  PARENT_FACT_ID,
  SECOND_SECP_PUBLIC_KEY,
  ed25519Authority,
} from "./fixtures.js";

function uint64(value: number): Buffer {
  const output = Buffer.alloc(8);
  output.writeBigUInt64BE(BigInt(value));
  return output;
}

function lp(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([uint64(bytes.length), bytes]);
}

describe("work, evidence, and settlement", () => {
  test("matches the independent Zerone receipt and nullifier byte recipes", () => {
    const { artifact, workSpec, address, settlement } = buildFixture();
    const receiptFields = [
      sha256IdToChainHash(workSpec.work_spec_id),
      sha256IdToChainHash(workSpec.acceptance_hash),
      sha256IdToChainHash(workSpec.input_root),
      sha256IdToChainHash(workSpec.environment_root),
      sha256IdToChainHash(artifact.artifact_root),
      sha256IdToChainHash(artifact.evidence_root),
      address,
    ];
    const expectedReceipt = createHash("sha256")
      .update(Buffer.concat([
        Buffer.from("ZRN.work.receipt.v1\0", "utf8"),
        ...receiptFields.map(lp),
      ]))
      .digest("hex");
    expect(artifact.chain_work_receipt_hash).toBe(expectedReceipt);
    expect(deriveChainWorkReceiptHash({
      work_spec_id: workSpec.work_spec_id,
      acceptance_hash: workSpec.acceptance_hash,
      input_root: workSpec.input_root,
      environment_root: workSpec.environment_root,
      artifact_root: artifact.artifact_root,
      evidence_root: artifact.evidence_root,
      payee_address: address,
    })).toBe(expectedReceipt);

    const expectedNullifier = createHash("sha256")
      .update(Buffer.concat([
        Buffer.from("ZRN.sponsorship.settlement.v2\0", "utf8"),
        lp(sha256IdToChainHash(workSpec.work_spec_id)),
        lp(sha256IdToChainHash(workSpec.acceptance_hash)),
        lp(sha256IdToChainHash(workSpec.input_root)),
        lp(sha256IdToChainHash(workSpec.environment_root)),
        lp(sha256IdToChainHash(artifact.artifact_root)),
        lp(address),
      ]))
      .digest("hex");
    expect(settlement.expected_chain_nullifier).toBe(expectedNullifier);
    const nullifierInput = {
      work_spec_id: workSpec.work_spec_id,
      acceptance_hash: workSpec.acceptance_hash,
      input_root: workSpec.input_root,
      environment_root: workSpec.environment_root,
      artifact_root: artifact.artifact_root,
      worker_address: address,
    };
    expect(deriveChainSettlementNullifier(nullifierInput)).toBe(expectedNullifier);
    // Evidence/receipt variation is outside the key; changing a contract root is not.
    const changedEvidenceReceipt = deriveChainWorkReceiptHash({
      work_spec_id: workSpec.work_spec_id,
      acceptance_hash: workSpec.acceptance_hash,
      input_root: workSpec.input_root,
      environment_root: workSpec.environment_root,
      artifact_root: artifact.artifact_root,
      evidence_root: HASHES.output,
      payee_address: address,
    });
    expect(changedEvidenceReceipt).not.toBe(expectedReceipt);
    expect(deriveChainSettlementNullifier(nullifierInput)).toBe(expectedNullifier);
    expect(deriveChainSettlementNullifier({ ...nullifierInput, input_root: HASHES.output }))
      .not.toBe(expectedNullifier);
    const cloneAddress = zeroneAddressFromSecp256k1PublicKey(SECOND_SECP_PUBLIC_KEY);
    expect(deriveChainSettlementNullifier({ ...nullifierInput, worker_address: cloneAddress }))
      .not.toBe(expectedNullifier);
    expect(() => deriveChainSettlementNullifier({
      ...nullifierInput,
      worker_address: address.toUpperCase(),
    })).toThrow();
  });

  test("keeps a richer off-chain receipt beside the narrower consensus receipt", () => {
    const { artifact, binding } = buildFixture();
    expect(artifact.producer_binding_id).toBe(binding.binding_id);
    expect(artifact.producer_account).toBe(binding.zerone_account_id);
    expect(artifact.artifact_id).toStartWith("sha256:");
    expect(artifact.chain_work_receipt_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(artifact.artifact_id.slice(7)).not.toBe(artifact.chain_work_receipt_hash);
  });

  test("rejects receipt tampering and contract-limit overrun", () => {
    const { artifact } = buildFixture();
    expect(() => validateComputationalArtifact({
      ...artifact,
      chain_work_receipt_hash: "f".repeat(64),
    })).toThrow();
    expect(() => validateComputationalArtifact({
      ...artifact,
      artifact_root: HASHES.output,
    })).toThrow();
  });

  test("requires a nonzero closed challenge window at the exact maturity boundary", () => {
    const { artifact, commitmentHash, workSpec } = buildFixture();
    const evidenceInput = {
      work_spec: workSpec,
      artifact,
      knowledge_claim_id: "claim-boundary",
      knowledge_fact_id: "fact-boundary",
      computational_commitment_hash: commitmentHash,
      outcome: "contract_mature" as const,
      corroborations: "2",
      challenge_window_end_height: "1200",
      observed_at_height: "1200",
      open_challenges: 0,
      issuer_id: "zerone-consensus-observation",
      issuer_key_id: HASHES.issuer,
      issued_at: "2026-08-20T18:10:00.000Z",
    };
    expect(() => createEvidenceReceipt(evidenceInput)).not.toThrow();
    expect(() => createEvidenceReceipt({ ...evidenceInput, observed_at_height: "1199" }))
      .toThrow();
    expect(() => createEvidenceReceipt({
      ...evidenceInput,
      challenge_window_end_height: "0",
      observed_at_height: "0",
    })).toThrow();
    expect(() => createEvidenceReceipt({
      ...evidenceInput,
      computational_commitment_hash: HASHES.output,
    })).toThrow();
  });

  test("rechecks sponsor-selected corroborations when forming settlement", () => {
    const fixture = buildFixture();
    const { evidence_receipt_id: _id, ...core } = fixture.evidence;
    const lowCore = { ...core, corroborations: "1" };
    const lowEvidence = {
      ...lowCore,
      evidence_receipt_id: domainSeparatedId(HASH_DOMAINS.evidence, lowCore),
    };
    expect(() => createSettlementIntent({
      bounty_id: "bounty-001",
      work_spec: fixture.workSpec,
      artifact: fixture.artifact,
      evidence: lowEvidence,
      payee_binding: fixture.binding,
      created_at: "2026-08-20T18:11:00.000Z",
      valid_until_height: "2000",
    })).toThrow();

    const wrongReceiptCore = { ...core, chain_work_receipt_hash: "f".repeat(64) };
    const wrongReceiptEvidence = {
      ...wrongReceiptCore,
      evidence_receipt_id: domainSeparatedId(HASH_DOMAINS.evidence, wrongReceiptCore),
    };
    expect(() => createSettlementIntent({
      bounty_id: "bounty-001",
      work_spec: fixture.workSpec,
      artifact: fixture.artifact,
      evidence: wrongReceiptEvidence,
      payee_binding: fixture.binding,
      created_at: "2026-08-20T18:11:00.000Z",
      valid_until_height: "2000",
    })).toThrow();
  });

  test("projects exact v2 fields while fulfillment stays payee-signed", () => {
    const {
      createBounty, submitClaim, fulfill, artifact, binding, profile, workSpec,
      sponsorAddress, evidence,
    } = buildFixture();
    expect(createBounty.value.work_contract).toEqual({
      work_spec_hash: createBounty.value.work_contract.work_spec_hash,
      acceptance_hash: "07".repeat(32),
      input_root: "05".repeat(32),
      environment_root: "06".repeat(32),
      min_corroborations: "2",
      worker_address: binding.zerone_address,
    });
    expect(createBounty.value.sponsor).toBe(sponsorAddress);
    expect(createBounty.value.work_contract.worker_address).not.toBe(createBounty.value.sponsor);
    expect(submitClaim.value.claim_type).toBe(7);
    expect(submitClaim.value.fact_content).toBe(FACT_CONTENT);
    expect(submitClaim.value.relations).toEqual([{
      target_fact_id: PARENT_FACT_ID,
      relation: 3,
      inference: 0,
      inference_strength_bps: "0",
      method_id: "",
    }]);
    expect(submitClaim.value.computational_commitment).toEqual(
      toChainComputationalCommitment(artifact),
    );
    expect(submitClaim.value.computational_commitment.work_receipt_hash).toBe(
      artifact.chain_work_receipt_hash,
    );
    expect(Object.keys(fulfill.value).sort()).toEqual(["bounty_id", "caller", "fact_id"]);
    expect(fulfill.value.caller).toBe(binding.zerone_address);
    expect(fulfill.compatibility.wallet_zerone_message_support).toBe("unsupported");
    expect(fulfill.compatibility.effects_performed).toBeFalse();
    const otherAccount = zeroneAccountId(
      profile,
      zeroneAddressFromSecp256k1PublicKey(SECOND_SECP_PUBLIC_KEY),
    );
    expect(() => createFulfillBountyMessage({
      settlement_intent: buildFixture().settlement,
      work_spec: workSpec,
      caller_account: otherAccount,
    })).toThrow();

    const cloneBinding = createWalletIdentityBinding({
      network: "testnet",
      owner_identity_id: "did:agenttool:clone",
      wallet_id: "wallet-clone-001",
      wallet_descriptor_id: HASHES.output,
      identity_authority: ed25519Authority(32),
      zerone_account_id: otherAccount,
      zerone_public_key: SECOND_SECP_PUBLIC_KEY,
      revision: 1,
      wallet_continuity_sequence: 0,
      previous_binding_id: null,
      issued_at: "2026-08-20T18:00:00.000Z",
    });
    expect(() => createComputationalArtifact({
      work_spec: workSpec,
      producer_binding: cloneBinding,
      artifact_root: HASHES.artifact,
      evidence_root: HASHES.executionEvidence,
      claim_commitment: artifact.claim_commitment,
      proposed_tree_transition: artifact.proposed_tree_transition,
      resource_usage: artifact.resource_usage,
      completed_at: artifact.completed_at,
    })).toThrow();
    expect(() => createSettlementIntent({
      bounty_id: "bounty-001",
      work_spec: workSpec,
      artifact,
      evidence,
      payee_binding: cloneBinding,
      created_at: "2026-08-20T18:11:00.000Z",
      valid_until_height: "2000",
    })).toThrow();
  });

  test("round-trips exact canonical protobuf values and rejects unknown wire fields", () => {
    const { createBounty, submitClaim, fulfill } = buildFixture();
    const createBytes = encodeCreateBountyOrderValue(createBounty.value);
    const claimBytes = encodeSubmitComputationalClaimValue(submitClaim.value);
    const fulfillBytes = encodeFulfillBountyValue(fulfill.value);
    expect(decodeCreateBountyOrderValue(createBytes)).toEqual(createBounty.value);
    expect(decodeSubmitComputationalClaimValue(claimBytes)).toEqual(submitClaim.value);
    expect(decodeFulfillBountyValue(fulfillBytes)).toEqual(fulfill.value);
    expect(createBounty.protobuf_value_b64u.length).toBeGreaterThan(0);
    expect(createBounty.protobuf_value_hash).toStartWith("sha256:");
    expect(() => decodeFulfillBountyValue(Uint8Array.from([...fulfillBytes, 0x20, 0x01])))
      .toThrow();
    expect(() => encodeCreateBountyOrderValue({
      ...createBounty.value,
      work_contract: {
        ...createBounty.value.work_contract,
        worker_address: createBounty.value.work_contract.worker_address.toUpperCase(),
      },
    })).toThrow();

    const zeroCorroborations = {
      ...createBounty.value,
      work_contract: {
        ...createBounty.value.work_contract,
        min_corroborations: "0",
      },
    };
    const zeroBytes = encodeCreateBountyOrderValue(zeroCorroborations);
    expect(decodeCreateBountyOrderValue(zeroBytes)).toEqual(zeroCorroborations);
    expect(zeroBytes.byteLength).toBe(createBytes.byteLength - 2);
  });

  test("bounds the review-fee stake to consensus uint64 without truncation", () => {
    const fixture = buildFixture();
    const input = {
      work_spec: fixture.workSpec,
      artifact: fixture.artifact,
      producer_binding: fixture.binding,
      fact_content: FACT_CONTENT,
      references: [] as readonly string[],
    };
    expect(() => createComputationalClaimMessage({
      ...input,
      stake_uzrn: "18446744073709551615",
    })).not.toThrow();
    expect(() => createComputationalClaimMessage({
      ...input,
      stake_uzrn: "18446744073709551616",
    })).toThrow();
    expect(() => createComputationalClaimMessage({ ...input, stake_uzrn: "0" }))
      .toThrow();
  });
});
