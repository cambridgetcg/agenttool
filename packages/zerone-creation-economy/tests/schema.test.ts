import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  createCreationEconomyHandoff,
  validateCreationEconomyHandoff,
} from "../src/index.js";
import {
  buildReadyDefensiveSecurityCreationFixture,
  buildReadyFormalCreationFixture,
  clone,
} from "./fixtures.js";

function portable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildHandoff(
  fixture = buildReadyFormalCreationFixture(),
) {
  const sourceInput = {
    contract: fixture.contract,
    work_spec: fixture.workSpec,
    creation_witness: fixture.creationWitness,
    verification_witnesses: fixture.verificationWitnesses,
    lifecycle: fixture.lifecycle,
    creation_artifact: fixture.creationArtifact,
    creation_claim_projection: fixture.creationClaimProjection,
    worker_binding_proof: fixture.bindingProof,
  } as const;
  return { fixture, sourceInput, handoff: createCreationEconomyHandoff(sourceInput) };
}

async function validator(name: string) {
  const schema = await Bun.file(new URL(`../schema/${name}`, import.meta.url)).json();
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return { ajv, schema, validate: ajv.compile(schema) };
}

describe("closed creation-economy schemas", () => {
  test("accept both canonical creation cases and their coupled message variants", async () => {
    const handoffValidator = await validator("handoff-v0.1.schema.json");
    const messageValidator = await validator("message-projection-v0.1.schema.json");

    for (const fixture of [
      buildReadyFormalCreationFixture(),
      buildReadyDefensiveSecurityCreationFixture(),
    ]) {
      const { handoff } = buildHandoff(fixture);
      expect(
        handoffValidator.validate(portable(handoff)),
        handoffValidator.ajv.errorsText(handoffValidator.validate.errors),
      ).toBeTrue();
      for (const message of [
        handoff.messages.create_bounty,
        handoff.messages.submit_claim,
      ]) {
        expect(
          messageValidator.validate(portable(message)),
          messageValidator.ajv.errorsText(messageValidator.validate.errors),
        ).toBeTrue();
      }
    }
  });

  test("reject extras, boundary widening, variant confusion, and overlong chain IDs", async () => {
    const { handoff } = buildHandoff();
    const handoffValidator = await validator("handoff-v0.1.schema.json");
    const messageValidator = await validator("message-projection-v0.1.schema.json");

    const jsonHandoff = portable(handoff);
    expect(handoffValidator.validate({ ...jsonHandoff, rpc_url: "https://example.invalid" }))
      .toBeFalse();
    expect(handoffValidator.validate({
      ...jsonHandoff,
      boundary: { ...jsonHandoff.boundary, wallet_planner_admissible: true },
    })).toBeFalse();
    expect(messageValidator.validate({
      ...portable(handoff.messages.create_bounty),
      type_url: handoff.messages.submit_claim.type_url,
    })).toBeFalse();
    expect(messageValidator.validate({
      ...portable(handoff.messages.submit_claim),
      value: { ...portable(handoff.messages.submit_claim.value), method_id: "M-COMPUTATIONAL" },
    })).toBeFalse();
    const overlong = clone<any>(jsonHandoff);
    overlong.activation_evidence.chain_reference = "zerone-creation-private-fixture-1";
    overlong.activation_evidence.chain_id = "cosmos:zerone-creation-private-fixture-1";
    expect(handoffValidator.validate(overlong)).toBeFalse();
  });

  test("labels schema checks as structural and requires source-bound runtime validation", async () => {
    const { handoff, sourceInput } = buildHandoff();
    const handoffValidator = await validator("handoff-v0.1.schema.json");
    const messageValidator = await validator("message-projection-v0.1.schema.json");
    expect(handoffValidator.schema.$comment).toContain("STRUCTURAL_ONLY");
    expect(messageValidator.schema.$comment).toContain("STRUCTURAL_ONLY");

    const changedCanonicalForm = portable<any>(handoff);
    changedCanonicalForm.messages.submit_claim.value.canonical_form =
      `agenttool.zerone-creation-fact-envelope/0.1 sha256:${"f".repeat(64)}`;
    const changedProtobufHash = portable<any>(handoff);
    changedProtobufHash.messages.submit_claim.protobuf_value_hash =
      `sha256:${"e".repeat(64)}`;
    const changedChainCoupling = portable<any>(handoff);
    changedChainCoupling.activation_evidence.chain_reference =
      "zerone-creation-private-fixt2";
    const changedAuthority = portable<any>(handoff);
    changedAuthority.creation_scope.publication_authority_ref =
      `sha256:${"d".repeat(64)}`;

    for (const structurallyValidButSemanticallyInvalid of [
      changedCanonicalForm,
      changedProtobufHash,
      changedChainCoupling,
      changedAuthority,
    ]) {
      expect(
        handoffValidator.validate(structurallyValidButSemanticallyInvalid),
        handoffValidator.ajv.errorsText(handoffValidator.validate.errors),
      ).toBeTrue();
      expect(() => validateCreationEconomyHandoff(
        structurallyValidButSemanticallyInvalid,
        sourceInput,
      )).toThrow();
    }
  });
});
