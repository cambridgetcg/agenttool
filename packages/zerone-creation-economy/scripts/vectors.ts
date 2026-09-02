import { readFile, writeFile } from "node:fs/promises";

import { base64UrlDecode, bytesToHex } from "@agenttool/wallet";

import {
  CREATION_ECONOMY_SOURCE_PINS,
  createCreationEconomyHandoff,
} from "../src/index.js";
import {
  buildReadyDefensiveSecurityCreationFixture,
  buildReadyFormalCreationFixture,
} from "../tests/fixtures.js";

function buildCase(
  fixture: ReturnType<typeof buildReadyFormalCreationFixture>,
  name: string,
) {
  const handoff = createCreationEconomyHandoff({
    contract: fixture.contract,
    work_spec: fixture.workSpec,
    creation_witness: fixture.creationWitness,
    verification_witnesses: fixture.verificationWitnesses,
    lifecycle: fixture.lifecycle,
    creation_artifact: fixture.creationArtifact,
    creation_claim_projection: fixture.creationClaimProjection,
    worker_binding_proof: fixture.bindingProof,
  });
  return {
    fixture: name,
    source: {
      contract_id: fixture.contract.contract_id,
      creation_work_spec_id: fixture.workSpec.work_spec_id,
      creation_witness_id: fixture.creationWitness.creation_witness_id,
      lifecycle_id: fixture.lifecycle.lifecycle_id,
      creation_artifact_id: fixture.creationArtifact.artifact_id,
      creation_claim_projection_id: fixture.creationClaimProjection.projection_id,
      wallet_binding_id: fixture.binding.binding_id,
      wallet_binding_proof_id: fixture.bindingProof.proof_id,
    },
    handoff,
    wire: {
      create_bounty_value_hex: bytesToHex(
        base64UrlDecode(handoff.messages.create_bounty.protobuf_value_b64u),
      ),
      create_bounty_any_hex: bytesToHex(
        base64UrlDecode(handoff.messages.create_bounty.protobuf_any_b64u),
      ),
      submit_claim_value_hex: bytesToHex(
        base64UrlDecode(handoff.messages.submit_claim.protobuf_value_b64u),
      ),
      submit_claim_any_hex: bytesToHex(
        base64UrlDecode(handoff.messages.submit_claim.protobuf_any_b64u),
      ),
    },
  } as const;
}

export function buildVector() {
  const formal = buildCase(
    buildReadyFormalCreationFixture(),
    "bounded-formal-creation-offline-review",
  );
  const defensiveSecurity = buildCase(
    buildReadyDefensiveSecurityCreationFixture(),
    "bounded-openai-cyber-defensive-creation-offline-review",
  );
  return {
    protocol: "agenttool.zerone-creation-economy-vectors/0.1",
    source_pins: CREATION_ECONOMY_SOURCE_PINS,
    ...formal,
    defensive_security: defensiveSecurity,
  } as const;
}

if (import.meta.main) {
  const target = new URL(
    "../vectors/zerone-creation-economy-v0.1-vectors.json",
    import.meta.url,
  );
  const rendered = `${JSON.stringify(buildVector(), null, 2)}\n`;
  if (process.argv.includes("--check")) {
    const current = await readFile(target, "utf8").catch(() => "");
    if (current !== rendered) {
      throw new Error("creation-economy vectors are stale or nondeterministic");
    }
  } else {
    await writeFile(target, rendered);
  }
}
