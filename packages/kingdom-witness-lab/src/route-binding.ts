import {
  API_DIALECTS,
  EXECUTION_ROUTE_BINDING_SCHEMA,
  EXECUTION_ROUTE_BINDING_STATEMENT,
  INPUT_DISCLOSURES,
  RESEARCH_KINDS,
  RESEARCH_PROVIDERS,
  RETENTION_BASES,
  ROUTE_EQUIVALENCE,
  ROUTE_FEATURE_NOTES,
  ROUTE_FEATURE_STATUSES,
  ROUTE_FEATURES,
  ROUTE_PROVIDERS,
  TRAINING_USES,
} from "./constants.js";
import { canonicalJson, deepFreeze, domainSeparatedId, snapshotJson } from "./canonical.js";
import { fail } from "./errors.js";
import type {
  CreateExecutionRouteBindingInput,
  ExecutionRouteBinding,
  RouteFeatureObservation,
} from "./types.js";
import {
  artifactRef,
  canonicalTime,
  enumeration,
  exactKeys,
  nullableDescriptor,
  object,
  opaqueId,
  sha256,
  sourceRefs,
} from "./validation.js";

const CODE = "route_binding_error" as const;

function parseRoute(value: unknown): CreateExecutionRouteBindingInput["route"] {
  const input = object(value, "$.route", CODE);
  exactKeys(
    input,
    [
      "provider",
      "route_id",
      "effective_version",
      "observed_at",
      "api_dialect",
      "equivalence",
      "equivalence_evidence_refs",
    ],
    "$.route",
    CODE,
  );
  const output: CreateExecutionRouteBindingInput["route"] = {
    provider: enumeration(input.provider, ROUTE_PROVIDERS, "$.route.provider", CODE),
    route_id: opaqueId(input.route_id, "$.route.route_id", CODE),
    effective_version: nullableDescriptor(
      input.effective_version,
      "$.route.effective_version",
      CODE,
    ),
    observed_at: canonicalTime(input.observed_at, "$.route.observed_at", CODE),
    api_dialect: enumeration(input.api_dialect, API_DIALECTS, "$.route.api_dialect", CODE),
    equivalence: enumeration(input.equivalence, ROUTE_EQUIVALENCE, "$.route.equivalence", CODE),
    equivalence_evidence_refs: sourceRefs(
      input.equivalence_evidence_refs,
      "$.route.equivalence_evidence_refs",
      CODE,
    ),
  };
  if (output.equivalence === "unknown" && output.equivalence_evidence_refs.length !== 0) {
    fail(CODE, "unknown route equivalence must not carry equivalence evidence");
  }
  if (output.equivalence !== "unknown" && output.equivalence_evidence_refs.length === 0) {
    fail(CODE, "asserted or verified route equivalence requires an opaque evidence reference");
  }
  return output;
}

function parseFeatures(value: unknown): RouteFeatureObservation[] {
  if (!Array.isArray(value) || value.length !== ROUTE_FEATURES.length) {
    fail(CODE, `$.features must describe all ${ROUTE_FEATURES.length} route features`);
  }
  const output = value.map((entry, index) => {
    const path = `$.features[${index}]`;
    const input = object(entry, path, CODE);
    exactKeys(input, ["feature", "status", "note_code"], path, CODE);
    const observation: RouteFeatureObservation = {
      feature: enumeration(input.feature, ROUTE_FEATURES, `${path}.feature`, CODE),
      status: enumeration(input.status, ROUTE_FEATURE_STATUSES, `${path}.status`, CODE),
      note_code: input.note_code === null
        ? null
        : enumeration(input.note_code, ROUTE_FEATURE_NOTES, `${path}.note_code`, CODE),
    };
    if (observation.status === "ignored" && observation.note_code !== "silently_ignored") {
      fail(CODE, `${path} ignored features must say silently_ignored`);
    }
    if (observation.status !== "ignored" && observation.note_code === "silently_ignored") {
      fail(CODE, `${path} silently_ignored is valid only for an ignored feature`);
    }
    if (observation.status === "remapped" && observation.note_code === null) {
      fail(CODE, `${path} remapped features require a note_code`);
    }
    return observation;
  });
  const features = output.map((entry) => entry.feature);
  if (new Set(features).size !== ROUTE_FEATURES.length
    || features.some((feature, index) => feature !== ROUTE_FEATURES[index])) {
    fail(CODE, "$.features must cover ROUTE_FEATURES once in canonical order");
  }
  return output;
}

function parseDisclosure(value: unknown): CreateExecutionRouteBindingInput["disclosure"] {
  const input = object(value, "$.disclosure", CODE);
  exactKeys(
    input,
    ["retention_basis", "input_disclosure", "training_use", "evidence_refs"],
    "$.disclosure",
    CODE,
  );
  const output: CreateExecutionRouteBindingInput["disclosure"] = {
    retention_basis: enumeration(
      input.retention_basis,
      RETENTION_BASES,
      "$.disclosure.retention_basis",
      CODE,
    ),
    input_disclosure: enumeration(
      input.input_disclosure,
      INPUT_DISCLOSURES,
      "$.disclosure.input_disclosure",
      CODE,
    ),
    training_use: enumeration(input.training_use, TRAINING_USES, "$.disclosure.training_use", CODE),
    evidence_refs: sourceRefs(input.evidence_refs, "$.disclosure.evidence_refs", CODE),
  };
  const claimsExternalBasis = output.retention_basis === "contractual"
    || output.retention_basis === "provider_policy_observed"
    || output.training_use === "allowed_by_general_policy"
    || output.training_use === "opted_out_reported";
  if (claimsExternalBasis && output.evidence_refs.length === 0) {
    fail(CODE, "external retention or training-use claims require an opaque disclosure evidence reference");
  }
  return output;
}

function parseInput(value: unknown): CreateExecutionRouteBindingInput {
  const root = object(snapshotJson(value), "$", CODE);
  exactKeys(root, ["artifact", "route", "features", "disclosure", "evidence_refs"], "$", CODE);
  const output: CreateExecutionRouteBindingInput = {
    artifact: artifactRef(root.artifact, "$.artifact", CODE, RESEARCH_PROVIDERS, RESEARCH_KINDS),
    route: parseRoute(root.route),
    features: parseFeatures(root.features),
    disclosure: parseDisclosure(root.disclosure),
    evidence_refs: sourceRefs(root.evidence_refs, "$.evidence_refs", CODE),
  };
  const remote = output.route.provider === "deepseek_api"
    || output.route.provider === "huggingface_inference";
  if (remote && output.disclosure.input_disclosure === "local_only") {
    fail(CODE, "a remote provider route cannot claim local-only input disclosure");
  }
  if (!remote && output.disclosure.training_use === "allowed_by_general_policy") {
    fail(CODE, "general provider training policy is not applicable to an injected non-provider route");
  }
  return output;
}

export function createExecutionRouteBinding(
  input: CreateExecutionRouteBindingInput,
): ExecutionRouteBinding {
  const parsed = parseInput(input);
  const unsigned = {
    schema: EXECUTION_ROUTE_BINDING_SCHEMA,
    ...parsed,
    boundaries: {
      artifact_route_equivalence: parsed.route.equivalence,
      credentials: "not_received",
      dispatch: "not_performed",
      authority: "none",
      automatic_action: false,
    },
    statement: EXECUTION_ROUTE_BINDING_STATEMENT,
  } as const;
  return deepFreeze({
    schema: unsigned.schema,
    binding_id: domainSeparatedId(EXECUTION_ROUTE_BINDING_SCHEMA, unsigned),
    artifact: unsigned.artifact,
    route: unsigned.route,
    features: unsigned.features,
    disclosure: unsigned.disclosure,
    evidence_refs: unsigned.evidence_refs,
    boundaries: unsigned.boundaries,
    statement: unsigned.statement,
  }) as ExecutionRouteBinding;
}

export function validateExecutionRouteBinding(value: unknown): ExecutionRouteBinding {
  const root = object(snapshotJson(value), "$", CODE);
  exactKeys(
    root,
    ["schema", "binding_id", "artifact", "route", "features", "disclosure", "evidence_refs", "boundaries", "statement"],
    "$",
    CODE,
  );
  if (root.schema !== EXECUTION_ROUTE_BINDING_SCHEMA) fail(CODE, "$.schema is not supported");
  sha256(root.binding_id, "$.binding_id", CODE);
  const expected = createExecutionRouteBinding({
    artifact: root.artifact as CreateExecutionRouteBindingInput["artifact"],
    route: root.route as CreateExecutionRouteBindingInput["route"],
    features: root.features as RouteFeatureObservation[],
    disclosure: root.disclosure as CreateExecutionRouteBindingInput["disclosure"],
    evidence_refs: root.evidence_refs as string[],
  });
  if (canonicalJson(root) !== canonicalJson(expected)) {
    fail(CODE, "binding_id or fixed boundary fields do not bind the admitted route body");
  }
  return expected;
}
