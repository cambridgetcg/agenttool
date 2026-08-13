import { describe, expect, test } from "bun:test";

import {
  createGinChallenge,
  createGinReconstructionRequest,
  evaluatePolynomial,
  normalizeAffineObservation,
  sha256Id,
} from "../src/index.js";
import { jsonClone, vectors } from "./fixtures.js";

function requestInput(): Record<string, any> {
  const value = jsonClone(vectors.cases.unique!.request) as Record<string, any>;
  delete value.schema_version;
  delete value.request_id;
  delete value.boundaries;
  return value;
}

function challengeInput(): Record<string, any> {
  const value = jsonClone(vectors.challenge.artifact) as Record<string, any>;
  delete value.schema_version;
  delete value.challenge_id;
  delete value.boundaries;
  return value;
}

describe("hostile input boundaries", () => {
  test("rejects Proxy, accessor, cycle, custom prototype, and sparse arrays before semantics", () => {
    expect(() => createGinReconstructionRequest(new Proxy(requestInput(), {}))).toThrow(/Proxy/u);

    const accessor = requestInput();
    Object.defineProperty(accessor, "problem_ref", { enumerable: true, get: () => sha256Id("getter") });
    expect(() => createGinReconstructionRequest(accessor)).toThrow(/data property/u);

    const cycle = requestInput();
    cycle.loop = cycle;
    expect(() => createGinReconstructionRequest(cycle)).toThrow(/cycles/u);

    const custom = Object.assign(Object.create({ inherited: true }), requestInput());
    expect(() => createGinReconstructionRequest(custom)).toThrow(/plain object/u);

    const sparse = requestInput();
    sparse.observations = new Array(2);
    sparse.observations[1] = requestInput().observations[0];
    expect(() => createGinReconstructionRequest(sparse)).toThrow(/dense Array/u);
  });

  test("rejects malformed Unicode and does not coerce scalar values", () => {
    const malformed = requestInput();
    malformed.observations[0].observation_id = "bad\ud800";
    expect(() => createGinReconstructionRequest(malformed)).toThrow(/malformed Unicode/u);

    const coercion = requestInput();
    coercion.model.field_prime = { valueOf: () => 5 };
    expect(() => createGinReconstructionRequest(coercion)).toThrow(/not canonical JSON|safe integer|integer/u);

    const challenge = challengeInput();
    challenge.incentives.audience_counterfactual = new String("same_constructive_value_declared");
    expect(() => createGinChallenge(challenge)).toThrow(/must use a standard Array or plain object|must be one of/u);
  });

  test("keeps exported finite-field helpers inside bounded hostile-input walls", () => {
    expect(() => evaluatePolynomial(new Proxy([1, 2], {}), 1, 5)).toThrow(/Proxy/u);
    expect(() => evaluatePolynomial(Array.from({ length: 34 }, () => 0), 1, 5)).toThrow(/at most 33/u);
    const calibration = new Proxy({
      posture: "declared_exact_two_anchor_affine" as const,
      encoded_zero: 0,
      encoded_one: 1,
    }, {});
    expect(() => normalizeAffineObservation(1, calibration, 5)).toThrow(/Proxy/u);
    expect(() => normalizeAffineObservation(1, {
      posture: "wrong",
      encoded_zero: 0,
      encoded_one: 1,
    } as any, 5)).toThrow(/exact declared/u);
  });

  test("rejects duplicate observations, references, and outcome coverage", () => {
    const duplicateId = requestInput();
    duplicateId.observations[1].observation_id = duplicateId.observations[0].observation_id;
    expect(() => createGinReconstructionRequest(duplicateId)).toThrow(/observation_id values must be unique/u);

    const duplicateRef = challengeInput();
    duplicateRef.authority.declared_scope_refs.push(duplicateRef.authority.declared_scope_refs[0]);
    expect(() => createGinChallenge(duplicateRef)).toThrow(/duplicate references/u);

    const duplicateOutcome = challengeInput();
    duplicateOutcome.outcome_value[1].result_status = duplicateOutcome.outcome_value[0].result_status;
    duplicateOutcome.outcome_value[1].postures = ["propose_build_or_repair"];
    expect(() => createGinChallenge(duplicateOutcome)).toThrow(/every reconstruction status/u);
  });
});
