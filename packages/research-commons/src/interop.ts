import {
  MATH_PROOFCRAFT_NODE_ID,
  MATH_PROOFCRAFT_NODE_SHA256,
  ORIGINAL_STATIC_INTEROP_PIN,
  RECIPROCAL_INTEGRATION_STATUS,
  RECIPROCAL_PIN_STAGE,
  RECIPROCAL_PROFILE_CANONICALIZATION,
  RECIPROCAL_PROFILE_ID_ALGORITHM,
  RESEARCH_FORMATS,
  SIX_LEDGER_PROFILE_DIGEST,
  SIX_LEDGER_PROFILE_ID,
  ZERO_EFFECTS,
  ZERONE_PHASE_A_PIN,
  ZERONE_TREE_RAW_SHA256,
  ZERONE_TREE_SCHEMA,
} from "./constants.js";
import { deepFreeze, domainSeparatedId, parseStrictJson, snapshotJson } from "./canonical.js";
import { fail } from "./errors.js";
import { exactKeys, literal, record, sha256, zeroEffects } from "./validation.js";
import type {
  ZeroneResearchAdapterReciprocalBody,
  ZeroneResearchAdapterReciprocalProfile,
} from "./types.js";

const BODY_KEYS = [
  "_format",
  "agenttool_formats",
  "authority_transfer",
  "canonicalization",
  "effects",
  "integration_ready",
  "integration_status",
  "original_static_interop",
  "pin_stage",
  "profile_id_algorithm",
  "six_ledger_boundary",
  "tree",
  "zerone_phase_a",
] as const;

export const ZERONE_RESEARCH_ADAPTER_RECIPROCAL_BODY = deepFreeze({
  _format: RESEARCH_FORMATS.zeroneResearchAdapterReciprocal,
  agenttool_formats: {
    public_projection: RESEARCH_FORMATS.publicProjection,
    settlement_bundle: RESEARCH_FORMATS.settlementBundle,
  },
  authority_transfer: false,
  canonicalization: RECIPROCAL_PROFILE_CANONICALIZATION,
  effects: ZERO_EFFECTS,
  integration_ready: false,
  integration_status: RECIPROCAL_INTEGRATION_STATUS,
  original_static_interop: ORIGINAL_STATIC_INTEROP_PIN,
  pin_stage: RECIPROCAL_PIN_STAGE,
  profile_id_algorithm: RECIPROCAL_PROFILE_ID_ALGORITHM,
  six_ledger_boundary: {
    profile_digest: SIX_LEDGER_PROFILE_DIGEST,
    profile_id: SIX_LEDGER_PROFILE_ID,
  },
  tree: {
    node_digest: MATH_PROOFCRAFT_NODE_SHA256,
    node_id: MATH_PROOFCRAFT_NODE_ID,
    raw_sha256: ZERONE_TREE_RAW_SHA256,
    schema: ZERONE_TREE_SCHEMA,
  },
  zerone_phase_a: ZERONE_PHASE_A_PIN,
}) as ZeroneResearchAdapterReciprocalBody;

export const ZERONE_RESEARCH_ADAPTER_RECIPROCAL_PROFILE = deepFreeze({
  profile: ZERONE_RESEARCH_ADAPTER_RECIPROCAL_BODY,
  profile_id: domainSeparatedId(
    RESEARCH_FORMATS.zeroneResearchAdapterReciprocal,
    ZERONE_RESEARCH_ADAPTER_RECIPROCAL_BODY,
  ),
}) as ZeroneResearchAdapterReciprocalProfile;

function closedLiteral(
  value: unknown,
  expected: object,
  expectedKeys: readonly string[],
  path: string,
): void {
  const candidate = record(value as never, path);
  exactKeys(candidate, expectedKeys, path);
  literal(candidate, expected, path);
}

function validateBody(value: unknown, path: string): void {
  const body = record(value as never, path);
  exactKeys(body, BODY_KEYS, path);
  literal(body._format, RESEARCH_FORMATS.zeroneResearchAdapterReciprocal, `${path}._format`);
  closedLiteral(
    body.agenttool_formats,
    ZERONE_RESEARCH_ADAPTER_RECIPROCAL_BODY.agenttool_formats,
    ["public_projection", "settlement_bundle"],
    `${path}.agenttool_formats`,
  );
  literal(body.authority_transfer, false, `${path}.authority_transfer`);
  literal(body.canonicalization, RECIPROCAL_PROFILE_CANONICALIZATION, `${path}.canonicalization`);
  zeroEffects(body.effects, `${path}.effects`);
  literal(body.integration_ready, false, `${path}.integration_ready`);
  literal(body.integration_status, RECIPROCAL_INTEGRATION_STATUS, `${path}.integration_status`);
  closedLiteral(
    body.original_static_interop,
    ORIGINAL_STATIC_INTEROP_PIN,
    ["format", "path", "raw_sha256"],
    `${path}.original_static_interop`,
  );
  literal(body.pin_stage, RECIPROCAL_PIN_STAGE, `${path}.pin_stage`);
  literal(body.profile_id_algorithm, RECIPROCAL_PROFILE_ID_ALGORITHM, `${path}.profile_id_algorithm`);
  closedLiteral(
    body.six_ledger_boundary,
    ZERONE_RESEARCH_ADAPTER_RECIPROCAL_BODY.six_ledger_boundary,
    ["profile_digest", "profile_id"],
    `${path}.six_ledger_boundary`,
  );
  closedLiteral(
    body.tree,
    ZERONE_RESEARCH_ADAPTER_RECIPROCAL_BODY.tree,
    ["node_digest", "node_id", "raw_sha256", "schema"],
    `${path}.tree`,
  );
  closedLiteral(
    body.zerone_phase_a,
    ZERONE_PHASE_A_PIN,
    [
      "adapter_spec",
      "fixture_manifest",
      "main_merge_revision",
      "pull_request",
      "repository",
      "source_revision",
      "status",
    ],
    `${path}.zerone_phase_a`,
  );
}

export function validateZeroneResearchAdapterReciprocalProfile(
  value: unknown,
): ZeroneResearchAdapterReciprocalProfile {
  const envelope = record(snapshotJson(value), "$reciprocal");
  exactKeys(envelope, ["profile", "profile_id"], "$reciprocal");
  validateBody(envelope.profile, "$reciprocal.profile");
  const profileId = sha256(envelope.profile_id, "$reciprocal.profile_id");
  const expected = domainSeparatedId(
    RESEARCH_FORMATS.zeroneResearchAdapterReciprocal,
    envelope.profile,
  );
  if (profileId !== expected) {
    fail("validation_error", "$reciprocal.profile_id does not bind the closed profile body");
  }
  return ZERONE_RESEARCH_ADAPTER_RECIPROCAL_PROFILE;
}

export function parseZeroneResearchAdapterReciprocalProfileJson(
  input: string | Uint8Array,
): ZeroneResearchAdapterReciprocalProfile {
  return validateZeroneResearchAdapterReciprocalProfile(parseStrictJson(input));
}
