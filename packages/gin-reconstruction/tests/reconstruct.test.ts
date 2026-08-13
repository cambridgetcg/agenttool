import { describe, expect, test } from "bun:test";

import {
  createGinReconstructionRequest,
  evaluatePolynomial,
  normalizeAffineObservation,
  reconstructGin,
  validateGinReconstructionReceipt,
} from "../src/index.js";
import { jsonClone, ref, vectors } from "./fixtures.js";

describe("Gin finite-model reconstruction", () => {
  test("corrects one incompatible report at the sharp universal threshold", () => {
    const { request, receipt } = vectors.cases.unique!;
    const rebuilt = reconstructGin(request);
    expect(rebuilt).toEqual(receipt);
    expect(rebuilt.outcome).toMatchObject({
      status: "unique_model_candidate",
      candidate_count: 1,
      uniqueness_scope: "universal_within_declared_model",
      witness_candidates: [{
        coefficients: [2, 3],
        incompatible_observation_ids: ["u2"],
      }],
    });
    expect(rebuilt.theorem).toMatchObject({
      usable_observations: 4,
      refused_erasures: 1,
      image_minimum_distance: 3,
      parameter_separation_distance: 3,
      required_usable_observations_for_universal_unique_correction: 4,
      universal_unique_correction_guarantee: true,
    });
  });

  test("preserves ambiguity below the universal correction threshold", () => {
    const receipt = reconstructGin(vectors.cases.ambiguous!.request);
    expect(receipt.outcome.status).toBe("multiple_model_candidates");
    expect(receipt.outcome.candidate_count).toBe(3);
    expect(receipt.outcome.witness_candidates[0]!.coefficients).toEqual([0, 0]);
    expect(receipt.outcome.witness_candidates[1]!.coefficients).toEqual([0, 1]);
    expect(receipt.theorem.universal_unique_correction_guarantee).toBe(false);
  });

  test("labels below-threshold uniqueness as instance-only", () => {
    const receipt = reconstructGin(vectors.cases.instance_unique!.request);
    expect(receipt.outcome).toMatchObject({
      status: "unique_model_candidate",
      candidate_count: 1,
      uniqueness_scope: "this_instance_only",
    });
  });

  test("separates image distance from parameter non-identifiability", () => {
    const receipt = reconstructGin(vectors.cases.parameter_alias!.request);
    expect(receipt.outcome).toMatchObject({
      status: "multiple_model_candidates",
      candidate_count: 5,
    });
    expect(receipt.theorem).toMatchObject({
      parameter_identifiable: false,
      image_minimum_distance: 1,
      parameter_separation_distance: 0,
    });
  });

  test("distinguishes model inconsistency and bounded resource refusal", () => {
    const none = reconstructGin(vectors.cases.no_candidate!.request);
    expect(none.outcome).toMatchObject({
      status: "no_candidate_for_model_and_budget",
      candidate_count: 0,
      candidates_checked: 5,
    });

    const refused = reconstructGin(vectors.cases.resource_refusal!.request);
    expect(refused.outcome).toMatchObject({
      status: "resource_refusal",
      candidate_count: null,
      uniqueness_scope: "not_determined",
      candidates_checked: 0,
      enumeration_space: "3969126001",
      resource_wall: "enumeration_limit",
    });
  });

  test("does not turn a resource refusal into a false non-uniqueness claim", () => {
    const source = jsonClone(vectors.cases.unique!.request) as Record<string, any>;
    delete source.schema_version;
    delete source.request_id;
    delete source.boundaries;
    source.model.report_error_budget = 0;
    source.model.enumeration_limit = 1;
    source.observations = source.observations.slice(0, 3);
    const receipt = reconstructGin(createGinReconstructionRequest(source));
    expect(receipt.theorem.universal_unique_correction_guarantee).toBe(true);
    expect(receipt.outcome).toMatchObject({
      status: "resource_refusal",
      candidate_count: null,
      uniqueness_scope: "not_determined",
    });
  });

  test("refuses a candidate space whose derived evaluation work exceeds the fixed safety wall", () => {
    const request = createGinReconstructionRequest({
      problem_ref: ref("work-wall"),
      model: {
        field_prime: 7,
        degree_bound: 6,
        report_error_budget: 0,
        enumeration_limit: 1_000_000,
        calibration_model: "affine_exact_two_anchor_per_usable_observation",
      },
      observations: Array.from({ length: 7 }, (_, intervention) => ({
        observation_id: `work-${String(intervention)}`,
        substrate_ref: ref(`work-substrate-${String(intervention)}`),
        intervention,
        availability: "usable" as const,
        encoded_output: 0,
        calibration: {
          posture: "declared_exact_two_anchor_affine" as const,
          encoded_zero: 0,
          encoded_one: 1,
        },
        evidence_ref: ref(`work-evidence-${String(intervention)}`),
      })),
    });
    const receipt = reconstructGin(request);
    expect(receipt.outcome).toMatchObject({
      status: "resource_refusal",
      enumeration_space: "823543",
      estimated_evaluation_work: "40353607",
      resource_wall: "evaluation_work_ceiling",
      candidates_checked: 0,
    });
  });

  test("recovers affine chart coordinates from two exact anchors", () => {
    expect(normalizeAffineObservation(1, {
      posture: "declared_exact_two_anchor_affine",
      encoded_zero: 3,
      encoded_one: 0,
    }, 5)).toBe(4);
    expect(() => normalizeAffineObservation(1, {
      posture: "declared_exact_two_anchor_affine",
      encoded_zero: 2,
      encoded_one: 2,
    }, 5)).toThrow(/distinct field elements/u);
  });

  test("sorts observation coordinates before hashing and decoding", () => {
    const original = vectors.cases.unique!.request;
    const source = jsonClone(original) as Record<string, unknown>;
    const observations = [...(source.observations as unknown[])].reverse();
    const rebuilt = createGinReconstructionRequest({
      problem_ref: source.problem_ref,
      model: source.model,
      observations,
    });
    expect(rebuilt.request_id).toBe(original.request_id);
    expect(reconstructGin(rebuilt).receipt_id).toBe(vectors.cases.unique!.receipt.receipt_id);
  });

  test("treats refused and unavailable reports as erasures, never mismatches", () => {
    const request = createGinReconstructionRequest({
      problem_ref: ref("erasures"),
      model: {
        field_prime: 3,
        degree_bound: 0,
        report_error_budget: 0,
        enumeration_limit: 100,
        calibration_model: "affine_exact_two_anchor_per_usable_observation",
      },
      observations: [
        {
          observation_id: "usable",
          substrate_ref: ref("usable-substrate"),
          intervention: 0,
          availability: "usable",
          encoded_output: 2,
          calibration: {
            posture: "declared_exact_two_anchor_affine",
            encoded_zero: 0,
            encoded_one: 1,
          },
          evidence_ref: ref("usable-evidence"),
        },
        {
          observation_id: "refused",
          substrate_ref: ref("refused-substrate"),
          intervention: 1,
          availability: "refused",
          encoded_output: null,
          calibration: null,
          evidence_ref: null,
        },
        {
          observation_id: "unavailable",
          substrate_ref: ref("unavailable-substrate"),
          intervention: 2,
          availability: "unavailable",
          encoded_output: null,
          calibration: null,
          evidence_ref: null,
        },
      ],
    });
    const receipt = reconstructGin(request);
    expect(receipt.outcome.witness_candidates[0]!.incompatible_observation_ids).toEqual([]);
    expect(receipt.theorem).toMatchObject({ usable_observations: 1, refused_erasures: 1, unavailable_erasures: 1 });
  });

  test("enumerates every coefficient parameter when there are no usable reports", () => {
    const request = createGinReconstructionRequest({
      problem_ref: ref("empty"),
      model: {
        field_prime: 2,
        degree_bound: 1,
        report_error_budget: 0,
        enumeration_limit: 4,
        calibration_model: "affine_exact_two_anchor_per_usable_observation",
      },
      observations: [],
    });
    const receipt = reconstructGin(request);
    expect(receipt.outcome).toMatchObject({ status: "multiple_model_candidates", candidate_count: 4 });
    expect(receipt.theorem).toMatchObject({ image_minimum_distance: null, parameter_separation_distance: 0 });
  });

  test("rejects invalid field, coordinates, duplicate points, and slopes", () => {
    const base = jsonClone(vectors.cases.unique!.request) as Record<string, any>;
    delete base.schema_version;
    delete base.request_id;
    delete base.boundaries;

    const composite = jsonClone(base);
    composite.model.field_prime = 6;
    expect(() => createGinReconstructionRequest(composite)).toThrow(/must be prime/u);

    const noncanonical = jsonClone(base);
    noncanonical.observations[0].intervention = 5;
    expect(() => createGinReconstructionRequest(noncanonical)).toThrow(/canonical element/u);

    const duplicate = jsonClone(base);
    duplicate.observations[1].intervention = duplicate.observations[0].intervention;
    expect(() => createGinReconstructionRequest(duplicate)).toThrow(/distinct/u);

    const flat = jsonClone(base);
    flat.observations[0].calibration.encoded_one = flat.observations[0].calibration.encoded_zero;
    expect(() => createGinReconstructionRequest(flat)).toThrow(/distinct field elements/u);
  });

  test("recomputes receipts instead of trusting claimed candidate results", () => {
    const receipt = jsonClone(vectors.cases.unique!.receipt) as Record<string, any>;
    receipt.outcome.witness_candidates[0].coefficients = [4, 4];
    expect(() => validateGinReconstructionReceipt(receipt, vectors.cases.unique!.request)).toThrow(/does not match/u);
  });
});

describe("finite-field theorem checks", () => {
  test("measures n-d minimum distance for small distinct-point codes", () => {
    const cases = [
      ...[2, 3, 5].flatMap((prime) =>
        Array.from({ length: prime }, (_, index) => index + 1).flatMap((n) =>
          Array.from({ length: n }, (_, degree) => ({ prime, n, degree })))),
      ...Array.from({ length: 4 }, (_, degree) => ({ prime: 7, n: 7, degree })),
    ];
    for (const { prime, n, degree } of cases) {
      let minimum = n;
      const count = prime ** (degree + 1);
      for (let index = 1; index < count; index += 1) {
        let remaining = index;
        const coefficients = new Array<number>(degree + 1).fill(0);
        for (let position = degree; position >= 0; position -= 1) {
          coefficients[position] = remaining % prime;
          remaining = Math.floor(remaining / prime);
        }
        const weight = Array.from({ length: n }, (_, x) => evaluatePolynomial(coefficients, x, prime))
          .filter((value) => value !== 0).length;
        minimum = Math.min(minimum, weight);
      }
      expect(minimum).toBe(n - degree);
    }
  });
});
