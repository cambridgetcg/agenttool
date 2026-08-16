import {
  ASSESSMENT_NON_CLAIMS,
  BINDING_BOUNDARIES,
  OBSERVATION_BOUNDARIES,
  PUBLICATION_PATH,
  RECORD_SCHEMAS,
} from "../src/constants.js";
import type {
  PublicSurfaceAssessment,
  PublicSurfaceBinding,
  PublicSurfaceObservation,
  PublicSurfaceRevocation,
} from "../src/types.js";

export const SHA_A = `sha256:${"a".repeat(64)}` as const;
export const SHA_B = `sha256:${"b".repeat(64)}` as const;
export const SHA_C = `sha256:${"c".repeat(64)}` as const;
export const SHA_D = `sha256:${"d".repeat(64)}` as const;
export const SHA_E = `sha256:${"e".repeat(64)}` as const;
export const SHA_F = `sha256:${"f".repeat(64)}` as const;
export const SHA_G = `sha256:${"0".repeat(64)}` as const;
export const SHA_H = `sha256:${"1".repeat(64)}` as const;

export const FIXTURE_PUBLIC_KEY =
  "11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=";
export const FIXTURE_SIGNATURE =
  "5VZDAMNgrHKQhuLMgG6CioSHfx645dl02HPgZSJJAVVfuIIVkKM7rMYeOXAc+bRr0lv18FlbviRlUUFDjnoQCw==";

export const SUBJECT = Object.freeze({
  identity_namespace: "agenttool-local",
  identity_id: "11111111-1111-4111-8111-111111111111",
  signing_key: {
    algorithm: "Ed25519",
    key_id: "22222222-2222-4222-8222-222222222222",
    public_key: FIXTURE_PUBLIC_KEY,
  },
} as const);

export const GET_OBSERVATION: PublicSurfaceObservation = {
  schema: RECORD_SCHEMAS.observation,
  origin: "https://surface.agenttool.dev",
  request_url: `https://surface.agenttool.dev${PUBLICATION_PATH}`,
  request: {
    method: "GET",
    credential_mode: "omit",
    started_at: "2026-08-16T12:00:00.000Z",
    ended_at: "2026-08-16T12:00:00.250Z",
    crawler_version: "fixture-crawler/0.1",
  },
  status_code: 200,
  final_url: `https://surface.agenttool.dev${PUBLICATION_PATH}`,
  redirect_chain: [],
  media_type: "application/json",
  bytes: 321,
  body_sha256: SHA_A,
  collector: {
    name: "fixture-collector",
    version: "0.1.0",
    report_schema: "fixture-report/0.1",
    report_sha256: SHA_B,
    source_id: "fixture-source",
  },
  robots: {
    source: "not_collected",
    robots_url: null,
    snapshot_sha256: null,
    matched_group: null,
    directive: "not_observed",
    is_access_authorization: false,
  },
  usage_preferences: [],
  request_authentication: {
    kind: "none",
    status: "unverified",
    verifier: "none",
    protocol_variant: null,
    claimed_identity_url: null,
    key_thumbprint: null,
    covered_components: [],
    nonce_checked: false,
  },
  boundaries: OBSERVATION_BOUNDARIES,
  evidence_id: SHA_C,
};

export const BINDING: PublicSurfaceBinding = {
  schema: RECORD_SCHEMAS.binding,
  subject: SUBJECT,
  origin: "https://surface.agenttool.dev",
  observation_id: SHA_C,
  observed_body_sha256: SHA_A,
  relation: "declares_association_with_surface",
  scope: "exact_origin",
  purpose: "public_identity_locator",
  publication_path: PUBLICATION_PATH,
  issued_at: "2026-08-16T12:01:00.000Z",
  not_before: "2026-08-16T12:01:00.000Z",
  expires_at: "2026-08-30T12:01:00.000Z",
  nonce: "AAECAwQFBgcICQoLDA0ODw",
  boundaries: BINDING_BOUNDARIES,
  signature: {
    algorithm: "Ed25519",
    value: FIXTURE_SIGNATURE,
  },
  binding_id: SHA_D,
};

export const REVOCATION: PublicSurfaceRevocation = {
  schema: RECORD_SCHEMAS.revocation,
  binding_id: SHA_D,
  subject: SUBJECT,
  revoked_at: "2026-08-17T12:01:00.000Z",
  reason: "withdrawn",
  superseded_by: null,
  nonce: "EBESExQVFhcYGRobHB0eHw",
  signature: {
    algorithm: "Ed25519",
    value: FIXTURE_SIGNATURE,
  },
  revocation_id: SHA_E,
};

export const ASSESSMENT: PublicSurfaceAssessment = {
  schema: RECORD_SCHEMAS.assessment,
  binding_id: SHA_D,
  evaluated_at: "2026-08-16T12:02:00.000Z",
  inputs: {
    binding_document_sha256: SHA_A,
    key_evidence_ref: SHA_G,
    key_evidence_sha256: SHA_B,
    observation_id: SHA_C,
    origin_observation_id: SHA_H,
    revocation_ids: [],
    revocation_document_sha256s: [],
    revocation_key_evidence_refs: [],
    revocation_key_evidence_sha256s: [],
  },
  integrity: "valid",
  signature: "valid",
  key_authorization: "caller_evidence_matches",
  evidence_match: "matches",
  origin_confirmation: "observed_at_time",
  freshness: "current",
  revocation: "not_observed",
  establishes: [
    "key_holder_signed_claim",
    "caller_key_evidence_match",
    "origin_served_exact_binding_bytes",
  ],
  does_not_establish: [...ASSESSMENT_NON_CLAIMS],
  authority: "none",
  score: null,
  wake_effect: false,
  memory_effect: false,
  karma_effect: false,
  training_effect: false,
  assessment_id: SHA_F,
};
