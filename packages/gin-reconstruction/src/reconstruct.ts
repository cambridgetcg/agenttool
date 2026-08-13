import {
  GIN_RECEIPT_SCHEMA,
  GIN_RECONSTRUCTION_BOUNDARIES,
  GIN_REQUEST_SCHEMA,
  MAX_DEGREE_BOUND,
  MAX_ENUMERATION_LIMIT,
  MAX_EVALUATION_WORK,
  MAX_OBSERVATIONS,
  OBSERVATION_AVAILABILITY,
} from "./constants.js";
import { canonicalJson, compareUnicode, deepFreeze, domainSeparatedId, snapshotJson } from "./canonical.js";
import { assertPrime, canonicalFieldElement, evaluatePolynomial, normalizeAffineObservation } from "./field.js";
import { fail } from "./errors.js";
import type {
  AffineCalibration,
  CreateGinReconstructionRequestInput,
  GinCandidateWitness,
  GinObservation,
  GinReconstructionModel,
  GinReconstructionOutcome,
  GinReconstructionReceipt,
  GinReconstructionRequest,
  GinReconstructionTheorem,
} from "./types.js";
import {
  arrayValue,
  digest,
  enumValue,
  exactKeys,
  integer,
  nullableDigest,
  record,
  token,
} from "./validation.js";

interface NormalizedObservation {
  observation_id: string;
  intervention: number;
  output: number;
}

export function createGinReconstructionRequest(input: CreateGinReconstructionRequestInput): GinReconstructionRequest;
export function createGinReconstructionRequest(input: unknown): GinReconstructionRequest;
export function createGinReconstructionRequest(input: unknown): GinReconstructionRequest {
  const value = record(snapshotJson(input), "$request_input");
  exactKeys(value, ["problem_ref", "model", "observations"], "$request_input");
  const model = parseModel(value.model);
  const observations = parseObservations(value.observations, model.field_prime);
  const usable = observations.filter((observation) => observation.availability === "usable").length;
  if (model.report_error_budget > usable) {
    fail("invalid_input", "model.report_error_budget cannot exceed the usable observation count");
  }

  const body = {
    schema_version: GIN_REQUEST_SCHEMA,
    problem_ref: digest(value.problem_ref, "$request_input.problem_ref"),
    model,
    observations,
    boundaries: GIN_RECONSTRUCTION_BOUNDARIES,
  };
  const request: GinReconstructionRequest = {
    ...body,
    request_id: domainSeparatedId(GIN_REQUEST_SCHEMA, body),
  };
  return deepFreeze(request) as GinReconstructionRequest;
}

export function validateGinReconstructionRequest(input: unknown): GinReconstructionRequest {
  const value = record(snapshotJson(input), "$request");
  exactKeys(
    value,
    ["schema_version", "request_id", "problem_ref", "model", "observations", "boundaries"],
    "$request",
  );
  if (value.schema_version !== GIN_REQUEST_SCHEMA) fail("invalid_artifact", "request schema_version is unsupported");
  const rebuilt = createGinReconstructionRequest({
    problem_ref: value.problem_ref,
    model: value.model,
    observations: value.observations,
  });
  if (canonicalJson(rebuilt) !== canonicalJson(value)) {
    fail("invalid_artifact", "request content, boundaries, or request_id do not match canonical reconstruction");
  }
  return rebuilt;
}

export function reconstructGin(input: unknown): GinReconstructionReceipt {
  const request = validateGinReconstructionRequest(input);
  const normalized = normalizeUsableObservations(request);
  const theorem = theoremFor(request, normalized.length);
  const enumerationSpace = BigInt(request.model.field_prime) ** BigInt(request.model.degree_bound + 1);
  const estimatedWork = enumerationSpace
    * BigInt(Math.max(1, normalized.length))
    * BigInt(request.model.degree_bound + 1);

  let outcome: GinReconstructionOutcome;
  const resourceWall = enumerationSpace > BigInt(request.model.enumeration_limit)
    ? "enumeration_limit"
    : estimatedWork > BigInt(MAX_EVALUATION_WORK)
      ? "evaluation_work_ceiling"
      : "none";
  if (resourceWall !== "none") {
    outcome = {
      status: "resource_refusal",
      enumeration_space: enumerationSpace.toString(10),
      estimated_evaluation_work: estimatedWork.toString(10),
      resource_wall: resourceWall,
      candidates_checked: 0,
      candidate_count: null,
      uniqueness_scope: "not_determined",
      witness_candidates: [],
    };
  } else {
    const result = enumerateCandidates(request, normalized, Number(enumerationSpace));
    let status: GinReconstructionOutcome["status"];
    if (result.candidate_count === 0) status = "no_candidate_for_model_and_budget";
    else if (result.candidate_count === 1) status = "unique_model_candidate";
    else status = "multiple_model_candidates";
    outcome = {
      status,
      enumeration_space: enumerationSpace.toString(10),
      estimated_evaluation_work: estimatedWork.toString(10),
      resource_wall: "none",
      candidates_checked: Number(enumerationSpace),
      candidate_count: result.candidate_count,
      uniqueness_scope: status === "unique_model_candidate"
        ? theorem.universal_unique_correction_guarantee
          ? "universal_within_declared_model"
          : "this_instance_only"
        : "not_unique",
      witness_candidates: result.witness_candidates,
    };
  }

  return createReceipt(request, theorem, outcome);
}

export function validateGinReconstructionReceipt(
  receiptInput: unknown,
  requestInput: unknown,
): GinReconstructionReceipt {
  const request = validateGinReconstructionRequest(requestInput);
  const receipt = record(snapshotJson(receiptInput), "$receipt");
  exactKeys(
    receipt,
    ["schema_version", "receipt_id", "request_id", "problem_ref", "theorem", "outcome", "boundaries"],
    "$receipt",
  );
  if (receipt.schema_version !== GIN_RECEIPT_SCHEMA) fail("invalid_artifact", "receipt schema_version is unsupported");
  const rebuilt = reconstructGin(request);
  if (canonicalJson(rebuilt) !== canonicalJson(receipt)) {
    fail("receipt_mismatch", "receipt does not match the supplied request and deterministic decoder");
  }
  return rebuilt;
}

function parseModel(input: unknown): GinReconstructionModel {
  const value = record(input, "$request_input.model");
  exactKeys(
    value,
    ["field_prime", "degree_bound", "report_error_budget", "enumeration_limit", "calibration_model"],
    "$request_input.model",
  );
  const prime = integer(value.field_prime, 2, 251, "$request_input.model.field_prime");
  assertPrime(prime);
  if (value.calibration_model !== "affine_exact_two_anchor_per_usable_observation") {
    fail("invalid_input", "model.calibration_model must declare the exact supported affine model");
  }
  return {
    field_prime: prime,
    degree_bound: integer(value.degree_bound, 0, MAX_DEGREE_BOUND, "$request_input.model.degree_bound"),
    report_error_budget: integer(value.report_error_budget, 0, MAX_OBSERVATIONS, "$request_input.model.report_error_budget"),
    enumeration_limit: integer(value.enumeration_limit, 1, MAX_ENUMERATION_LIMIT, "$request_input.model.enumeration_limit"),
    calibration_model: "affine_exact_two_anchor_per_usable_observation",
  };
}

function parseObservations(input: unknown, prime: number): GinObservation[] {
  const values = arrayValue(input, MAX_OBSERVATIONS, "$request_input.observations");
  const observations = values.map((entry, index) => parseObservation(entry, index, prime));
  const ids = observations.map((observation) => observation.observation_id);
  if (new Set(ids).size !== ids.length) fail("invalid_input", "observation_id values must be unique");
  const interventions = observations.map((observation) => observation.intervention);
  if (new Set(interventions).size !== interventions.length) {
    fail("invalid_input", "all planned intervention values must be distinct");
  }
  return observations.sort((left, right) =>
    left.intervention - right.intervention || compareUnicode(left.observation_id, right.observation_id));
}

function parseObservation(input: unknown, index: number, prime: number): GinObservation {
  const path = `$request_input.observations[${String(index)}]`;
  const value = record(input, path);
  exactKeys(
    value,
    ["observation_id", "substrate_ref", "intervention", "availability", "encoded_output", "calibration", "evidence_ref"],
    path,
  );
  const availability = enumValue(value.availability, OBSERVATION_AVAILABILITY, `${path}.availability`);
  const observation: GinObservation = {
    observation_id: token(value.observation_id, `${path}.observation_id`),
    substrate_ref: digest(value.substrate_ref, `${path}.substrate_ref`),
    intervention: canonicalFieldElement(value.intervention, prime, `${path}.intervention`),
    availability,
    encoded_output: null,
    calibration: null,
    evidence_ref: nullableDigest(value.evidence_ref, `${path}.evidence_ref`),
  };

  if (availability === "usable") {
    observation.encoded_output = canonicalFieldElement(value.encoded_output, prime, `${path}.encoded_output`);
    observation.calibration = parseCalibration(value.calibration, path, prime);
    normalizeAffineObservation(observation.encoded_output, observation.calibration, prime);
  } else if (value.encoded_output !== null || value.calibration !== null) {
    fail("invalid_input", `${path} must omit encoded output and calibration when availability is ${availability}`);
  }
  return observation;
}

function parseCalibration(input: unknown, observationPath: string, prime: number): AffineCalibration {
  const path = `${observationPath}.calibration`;
  const value = record(input, path);
  exactKeys(value, ["posture", "encoded_zero", "encoded_one"], path);
  if (value.posture !== "declared_exact_two_anchor_affine") {
    fail("invalid_input", `${path}.posture must declare the supported exact two-anchor assumption`);
  }
  return {
    posture: "declared_exact_two_anchor_affine",
    encoded_zero: canonicalFieldElement(value.encoded_zero, prime, `${path}.encoded_zero`),
    encoded_one: canonicalFieldElement(value.encoded_one, prime, `${path}.encoded_one`),
  };
}

function normalizeUsableObservations(request: GinReconstructionRequest): NormalizedObservation[] {
  return request.observations.flatMap((observation) => {
    if (observation.availability !== "usable") return [];
    return [{
      observation_id: observation.observation_id,
      intervention: observation.intervention,
      output: normalizeAffineObservation(
        observation.encoded_output!,
        observation.calibration!,
        request.model.field_prime,
      ),
    }];
  });
}

function theoremFor(request: GinReconstructionRequest, usable: number): GinReconstructionTheorem {
  const degree = request.model.degree_bound;
  const errorBudget = request.model.report_error_budget;
  const identifiable = degree < usable;
  const required = degree + 2 * errorBudget + 1;
  const universal = identifiable && usable >= required;
  return {
    usable_observations: usable,
    refused_erasures: request.observations.filter((entry) => entry.availability === "refused").length,
    unavailable_erasures: request.observations.filter((entry) => entry.availability === "unavailable").length,
    evaluation_points_distinct: true,
    parameter_identifiable: identifiable,
    image_minimum_distance: usable === 0 ? null : identifiable ? usable - degree : 1,
    parameter_separation_distance: identifiable ? usable - degree : 0,
    required_usable_observations_for_universal_unique_correction: required,
    universal_unique_correction_guarantee: universal,
    guarantee_scope: universal ? "universal_within_declared_model" : "instance_only_or_not_unique",
  };
}

function enumerateCandidates(
  request: GinReconstructionRequest,
  normalized: readonly NormalizedObservation[],
  enumerationSpace: number,
): { candidate_count: number; witness_candidates: GinCandidateWitness[] } {
  let candidateCount = 0;
  const witnesses: GinCandidateWitness[] = [];
  for (let index = 0; index < enumerationSpace; index += 1) {
    const coefficients = coefficientsAt(index, request.model.degree_bound + 1, request.model.field_prime);
    const incompatible = normalized.filter((observation) =>
      evaluatePolynomial(coefficients, observation.intervention, request.model.field_prime) !== observation.output)
      .map((observation) => observation.observation_id);
    if (incompatible.length <= request.model.report_error_budget) {
      candidateCount += 1;
      if (witnesses.length < 2) {
        witnesses.push({ coefficients, incompatible_observation_ids: incompatible });
      }
    }
  }
  return { candidate_count: candidateCount, witness_candidates: witnesses };
}

function coefficientsAt(index: number, length: number, prime: number): number[] {
  let remaining = index;
  const coefficients = new Array<number>(length).fill(0);
  for (let position = length - 1; position >= 0; position -= 1) {
    coefficients[position] = remaining % prime;
    remaining = Math.floor(remaining / prime);
  }
  return coefficients;
}

function createReceipt(
  request: GinReconstructionRequest,
  theorem: GinReconstructionTheorem,
  outcome: GinReconstructionOutcome,
): GinReconstructionReceipt {
  const body = {
    schema_version: GIN_RECEIPT_SCHEMA,
    request_id: request.request_id,
    problem_ref: request.problem_ref,
    theorem,
    outcome,
    boundaries: GIN_RECONSTRUCTION_BOUNDARIES,
  };
  const receipt: GinReconstructionReceipt = {
    ...body,
    receipt_id: domainSeparatedId(GIN_RECEIPT_SCHEMA, body),
  };
  return deepFreeze(receipt) as GinReconstructionReceipt;
}
