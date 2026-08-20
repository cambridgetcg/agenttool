import { base64UrlDecode, bytesToHex } from "@agenttool/wallet";

import {
  createWalletIdentityBindingSigningRequest,
  toChainComputationalCommitment,
  toChainWorkContract,
} from "../src/index.js";
import { buildFixture, buildIdentityProofFixture } from "../tests/fixtures.js";

function wire(value: { readonly protobuf_value_b64u: string; readonly protobuf_value_hash: string }) {
  return {
    hex: bytesToHex(base64UrlDecode(value.protobuf_value_b64u)),
    sha256_id: value.protobuf_value_hash,
  };
}

export function buildVector() {
  const fixture = buildFixture();
  const identityProofFixture = buildIdentityProofFixture();
  const signing = createWalletIdentityBindingSigningRequest(
    identityProofFixture.binding,
  );
  const workContract = toChainWorkContract(fixture.workSpec);
  const commitment = toChainComputationalCommitment(fixture.artifact);
  return {
    protocol: "agenttool.zerone-agent-economy-vectors/0.1",
    fixture: "testnet-single-computational-work",
    identity: {
      proof_status: identityProofFixture.binding.proof_status,
      binding_id: identityProofFixture.binding.binding_id,
      proof_id: identityProofFixture.bindingProof.proof_id,
      shared_signing_digest: signing.shared_signing_digest,
      shared_signing_digest_b64u: signing.shared_signing_digest_b64u,
      signature_input: signing.signature_input,
      identity_signature_b64u:
        identityProofFixture.bindingProof.identity_proof.signature_b64u,
      wallet_signature_b64u:
        identityProofFixture.bindingProof.wallet_proof.signature_b64u,
      zerone_account_id: identityProofFixture.binding.zerone_account_id,
      zerone_address: identityProofFixture.binding.zerone_address,
      zerone_signer_key_id: identityProofFixture.binding.zerone_signer.key_id,
    },
    work: {
      work_spec_id: fixture.workSpec.work_spec_id,
      source_work_id: fixture.artifact.source_work_id,
      artifact_id: fixture.artifact.artifact_id,
      chain_work_receipt_hash: fixture.artifact.chain_work_receipt_hash,
      computational_commitment_hash: fixture.commitmentHash,
      evidence_receipt_id: fixture.evidence.evidence_receipt_id,
      settlement_intent_id: fixture.settlement.settlement_intent_id,
      settlement_nullifier: fixture.settlement.expected_chain_nullifier,
      settlement_nullifier_inputs: {
        work_spec_hash: workContract.work_spec_hash,
        acceptance_hash: workContract.acceptance_hash,
        input_root: workContract.input_root,
        environment_root: workContract.environment_root,
        artifact_root: commitment.artifact_root,
        worker_address: workContract.worker_address,
      },
      treasury_policy_id: fixture.treasury.treasury_policy_id,
    },
    chain: {
      work_contract: workContract,
      computational_commitment: commitment,
    },
    messages: {
      create_bounty: {
        type_url: fixture.createBounty.type_url,
        projection_hash: fixture.createBounty.projection_hash,
        ...wire(fixture.createBounty),
      },
      submit_claim: {
        type_url: fixture.submitClaim.type_url,
        projection_hash: fixture.submitClaim.projection_hash,
        ...wire(fixture.submitClaim),
      },
      fulfill_bounty: {
        type_url: fixture.fulfill.type_url,
        projection_hash: fixture.fulfill.projection_hash,
        ...wire(fixture.fulfill),
      },
    },
  };
}

if (import.meta.main) {
  const output = `${JSON.stringify(buildVector(), null, 2)}\n`;
  if (process.argv.includes("--check")) {
    const path = new URL("../vectors/zerone-agent-economy-v0.1-vectors.json", import.meta.url);
    const existing = await Bun.file(path).text();
    if (existing !== output) {
      console.error("zerone-agent-economy vectors drifted");
      process.exit(1);
    }
  } else {
    process.stdout.write(output);
  }
}
