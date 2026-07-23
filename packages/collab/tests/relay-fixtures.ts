import {
  observationProvidersForProject,
  type ProjectProfile,
} from "../src/project-profile.js";
import type {
  OperationClaimInput,
  OperationResult,
  ProviderObservationInput,
  ProviderObservationResult,
  RelayEnrolmentRequest,
  RelayEnrolmentResult,
} from "../src/relay-contract.js";
import type { ResolvedRelayCredential } from "../src/relay-credential.js";
import {
  relayEnrolmentIdempotencyKey,
  requestSha256,
} from "../src/relay-contract.js";

export const REPOSITORY_ID = "11111111-1111-4111-8111-111111111111";
export const DEVICE_ID = "22222222-2222-4222-8222-222222222222";
export const SESSION_ID = "33333333-3333-4333-8333-333333333333";
export const ACTION_ID = "44444444-4444-4444-8444-444444444444";
export const LEASE_ID = "55555555-5555-4555-8555-555555555555";
export const EVENT_ID = "66666666-6666-4666-8666-666666666666";
export const OBSERVATION_ID = "77777777-7777-4777-8777-777777777777";
export const SOURCE_REVISION = "a".repeat(40);
export const SHA256 = "b".repeat(64);
export const SHA1 = "c".repeat(40);
export const NOW = "2026-07-23T12:00:00.000Z";
export const RELAY_TOKEN = `atc_${"A".repeat(43)}`;
export const TOKEN_PREFIX = RELAY_TOKEN.slice(0, 12);
export const PROJECT_BEARER = `at_${"P".repeat(43)}`;

export const profile: ProjectProfile = {
  schema: "agenttool.project/1",
  project_id: "kingdom-agenttool",
  repository: {
    key: "github:1261120431",
    provider: "github",
    provider_repository_id: "1261120431",
    display_name: "cambridgetcg/agenttool",
  },
  github: {
    release_branch: "main",
    required_checks: ["API and protocol", "Data, ADDS, and SDK"],
  },
  npm: {
    workflow: "publish-npm.yml",
    packages: {
      "@agenttool/collab": {
        tag_prefix: "collab-v",
        release_key: "collab",
        path: "packages/collab",
      },
    },
  },
  deployments: {
    api: {
      provider: "fly",
      environment: "production",
      resource_id: "agenttool",
    },
    docs: {
      provider: "cloudflare-pages",
      environment: "production",
      resource_id: "agenttool-docs",
    },
  },
  vercel: { enabled: false },
};

export const credential: ResolvedRelayCredential = {
  metadata: {
    format: "agenttool.collab/relay-credential/1",
    state: "active",
    relay_url: "https://relay.example",
    repository: {
      key: profile.repository.key,
      id: REPOSITORY_ID,
    },
    device: {
      id: DEVICE_ID,
      label: "Yu Mac",
      version: 1,
    },
    token: {
      source: "environment",
      variable: "AGENTOOL_COLLAB_RELAY_TOKEN",
      prefix: TOKEN_PREFIX,
    },
    pending_enrolment: null,
    created_at: NOW,
    updated_at: NOW,
  },
  token: RELAY_TOKEN,
};

const enrolmentIntent: Omit<RelayEnrolmentRequest, "idempotency_key"> = {
  schema: "agenttool.collab-enrolment/1",
  expected_device_version: 0,
  repository: profile.repository,
  device: { id: DEVICE_ID, label: "Yu Mac" },
  observation_policy: {
    profile_sha256: requestSha256(profile),
    allowed_providers: observationProvidersForProject(profile),
  },
  token: { prefix: TOKEN_PREFIX, sha256: SHA256 },
};

export const enrolmentRequest: RelayEnrolmentRequest = {
  ...enrolmentIntent,
  idempotency_key: relayEnrolmentIdempotencyKey(enrolmentIntent),
};

export const enrolmentResult: RelayEnrolmentResult = {
  schema: "agenttool.collab-enrolment-result/1",
  replayed: false,
  receipt: {
    idempotency_key: enrolmentRequest.idempotency_key,
    request_sha256: requestSha256(enrolmentRequest),
    recorded_at: NOW,
  },
  repository: {
    id: REPOSITORY_ID,
    ...profile.repository,
  },
  device: {
    id: DEVICE_ID,
    label: "Yu Mac",
    token_prefix: TOKEN_PREFIX,
    active: true,
    version: 1,
  },
  observation_policy: {
    profile_sha256: requestSha256(profile),
    allowed_providers: observationProvidersForProject(profile),
  },
  created: true,
};

export const claimInput: OperationClaimInput = {
  schema: "agenttool.collab-operation-claim/1",
  idempotency_key: "claim:test",
  action_id: ACTION_ID,
  session_id: SESSION_ID,
  actor_label: "release-agent",
  operation: "npm.publish",
  environment: "npm",
  target: "@agenttool/collab@0.4.0",
  source_revision: SOURCE_REVISION,
  parameters_sha256: SHA256,
  lease_seconds: 900,
};

export function operationResult(
  request: OperationClaimInput = claimInput,
): OperationResult {
  return {
    schema: "agenttool.collab-operation-result/1",
    replayed: false,
    receipt: {
      idempotency_key: request.idempotency_key,
      request_sha256: requestSha256(request),
      recorded_at: NOW,
    },
    slot: {
      sequence: 1,
      repository_id: REPOSITORY_ID,
      operation: request.operation,
      environment: request.environment,
      phase: "claimed",
      action_id: request.action_id,
      holder_device_id: DEVICE_ID,
      session_id: request.session_id,
      actor_label: request.actor_label ?? null,
      lease_id: LEASE_ID,
      lease_expires_at: "2026-07-23T12:15:00.000Z",
      version: 1,
      generation: 1,
      target: request.target,
      source_revision: request.source_revision,
      parameters_sha256: request.parameters_sha256,
      updated_at: NOW,
    },
    run: {
      action_id: request.action_id,
      operation: request.operation,
      environment: request.environment,
      device_id: DEVICE_ID,
      session_id: request.session_id,
      actor_label: request.actor_label ?? null,
      status: "claimed",
      lease_id: LEASE_ID,
      generation: 1,
      target: request.target,
      source_revision: request.source_revision,
      parameters_sha256: request.parameters_sha256,
      claimed_at: NOW,
      began_at: null,
      completed_at: null,
      updated_at: NOW,
    },
    authority: {
      kind: "coordination_only",
      provider_authority_granted: false,
    },
  };
}

export const observationInput: ProviderObservationInput = {
  schema: "agenttool.collab-provider-observation/1",
  idempotency_key: "observe:test",
  session_id: SESSION_ID,
  actor_label: "release-agent",
  action_id: ACTION_ID,
  provider: "github",
  provider_event_id: "check-run:123",
  observed_at: NOW,
  occurred_at: NOW,
  resource_kind: "check_run",
  resource_id: "123",
  native_state: "completed:success",
  normalized_state: "succeeded",
  source_revision: SOURCE_REVISION,
  environment: "production",
  url: "https://github.com/cambridgetcg/agenttool/actions/runs/123",
  payload_sha256: SHA256,
};

export function observationResult(
  request: ProviderObservationInput = observationInput,
): ProviderObservationResult {
  return {
    schema: "agenttool.collab-provider-observation-result/1",
    deduplicated: false,
    replayed: false,
    receipt: {
      idempotency_key: request.idempotency_key,
      request_sha256: requestSha256(request),
      recorded_at: NOW,
    },
    observation: {
      sequence: 2,
      observation_id: OBSERVATION_ID,
      repository_id: REPOSITORY_ID,
      provider: request.provider,
      provider_event_id: request.provider_event_id ?? null,
      action_id: request.action_id ?? null,
      provenance: "device_observed",
      observing_device_id: DEVICE_ID,
      observing_session_id: request.session_id,
      actor_label: request.actor_label ?? null,
      observed_at: request.observed_at,
      occurred_at: request.occurred_at ?? null,
      normalized_state: request.normalized_state,
      source_revision: request.source_revision ?? null,
      environment: request.environment ?? null,
      resource_kind: request.resource_kind,
      resource_id: request.resource_id,
      native_state: request.native_state,
      url: request.url ?? null,
      payload_sha256: request.payload_sha256,
      received_at: NOW,
    },
  };
}
