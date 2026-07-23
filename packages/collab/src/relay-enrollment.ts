import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CollabError } from "./errors.js";
import {
  observationProvidersForProject,
  validateProjectProfile,
  type ProjectProfile,
} from "./project-profile.js";
import {
  acquireRelayCredentialFileLock,
  defaultRelayCredentialPath,
  EnvironmentRelaySecretStore,
  generateRelayToken,
  MacOSKeychainRelaySecretStore,
  normalizeRelayUrl,
  readRelayCredentialFile,
  relayTokenPrefix,
  relayTokenSha256,
  type RelayCredentialMetadata,
  type RelaySecretStore,
  writeRelayCredentialFile,
} from "./relay-credential.js";
import {
  postRelayEnrolment,
  type RelayFetch,
} from "./relay-client.js";
import {
  RELAY_ENROLMENT_SCHEMA,
  relayEnrolmentIdempotencyKey,
  requestSha256,
  type RelayEnrolmentRequest,
  type RelayEnrolmentResult,
} from "./relay-contract.js";

export const PROJECT_BEARER_ENV =
  "AGENTOOL_COLLAB_PROJECT_BEARER" as const;
export const DEVICE_LABEL_ENV = "AGENTOOL_COLLAB_DEVICE_LABEL" as const;
export const DEVICE_ID_ENV = "AGENTOOL_COLLAB_DEVICE_ID" as const;

export interface EnrollRelayOptions {
  profile: ProjectProfile;
  relay_url: string;
  project_bearer: string;
  device_label: string;
  device_id?: string;
  credential_path?: string;
  secret_store?: RelaySecretStore;
  fetch?: RelayFetch;
  now?: () => string;
  state_env?: NodeJS.ProcessEnv;
}

export interface EnrollRelayResult {
  enrolment: RelayEnrolmentResult;
  credential_file: string;
  token_storage: RelayCredentialMetadata["token"]["source"];
  token_prefix: string;
  secret_boundary:
    "raw_relay_bearer_is_not_returned_and_is_resolved_only_by_the_scoped_runtime";
}

export async function enrollRelay(
  options: EnrollRelayOptions,
): Promise<EnrollRelayResult> {
  const profile = validateProjectProfile(options.profile);
  const relayUrl = normalizeRelayUrl(options.relay_url);
  const deviceLabel = validateDeviceLabel(options.device_label);
  const now = options.now ?? (() => new Date().toISOString());
  const credentialPath =
    options.credential_path
    ?? defaultRelayCredentialPath(
      profile.repository.key,
      options.device_id,
      options.state_env,
    );
  const localLock = acquireRelayCredentialFileLock(credentialPath);
  try {
  let existing = existsSync(credentialPath)
    ? readRelayCredentialFile(credentialPath)
    : null;
  const deviceId = canonicalDeviceId(
    options.device_id ?? existing?.device.id ?? randomUUID(),
  );
  if (existing) {
    assertExistingScope(existing, {
      relay_url: relayUrl,
      repository_key: profile.repository.key,
      device_id: deviceId,
    });
  }

  const secretStore: RelaySecretStore =
    options.secret_store
    ?? defaultSecretStore(existing);
  let token: string;
  let reference: RelayCredentialMetadata["token"];
  let storedNewSecret = false;
  if (existing) {
    reference = existing.token;
    token = secretStore.resolve(reference);
  } else {
    token = secretStore.existingToken?.() ?? generateRelayToken();
    reference = secretStore.store(token, {
      repository_key: profile.repository.key,
      device_id: deviceId,
    });
    storedNewSecret = true;
  }

  let request = existing?.pending_enrolment ?? null;
  if (request) {
    if (
      request.token.prefix !== relayTokenPrefix(token)
      || request.token.sha256 !== relayTokenSha256(token)
    ) {
      throw new CollabError(
        "relay_pending_enrolment_token_mismatch",
        "Pending enrollment no longer matches the scoped token reference",
      );
    }
  } else {
    const intent: Omit<RelayEnrolmentRequest, "idempotency_key"> = {
      schema: RELAY_ENROLMENT_SCHEMA,
      expected_device_version: existing?.device.version ?? 0,
      repository: profile.repository,
      device: { id: deviceId, label: deviceLabel },
      observation_policy: {
        profile_sha256: requestSha256(profile),
        allowed_providers: observationProvidersForProject(profile),
      },
      token: {
        prefix: relayTokenPrefix(token),
        sha256: relayTokenSha256(token),
      },
    };
    request = {
      ...intent,
      idempotency_key: relayEnrolmentIdempotencyKey(intent),
    };
  }

  const pendingTimestamp = now();
  const pendingMetadata: RelayCredentialMetadata = existing
    ? {
        ...existing,
        pending_enrolment: request,
        updated_at: pendingTimestamp,
      }
    : {
        format: "agenttool.collab/relay-credential/1",
        state: "pending",
        relay_url: relayUrl,
        repository: {
          key: profile.repository.key,
          id: null,
        },
        device: {
          id: deviceId,
          label: request.device.label,
          version: 0,
        },
        token: reference,
        pending_enrolment: request,
        created_at: pendingTimestamp,
        updated_at: pendingTimestamp,
      };
  try {
    writeRelayCredentialFile(
      credentialPath,
      pendingMetadata,
      existing ? { replace: true } : {},
    );
  } catch (error) {
    if (storedNewSecret) {
      try {
        secretStore.remove(reference);
      } catch {
        // The credential metadata was never persisted and no request began.
      }
    }
    throw error;
  }

  try {
    const enrolment = await postRelayEnrolment({
      relay_url: relayUrl,
      project_bearer: options.project_bearer,
      request,
      fetch: options.fetch,
    });
    assertEnrolmentResult(enrolment, request);
    const prior = readRelayCredentialFile(credentialPath);
    if (
      prior.device.version !== request.expected_device_version
      || prior.pending_enrolment === null
      || (
        prior.pending_enrolment.idempotency_key
        !== request.idempotency_key
      )
      || requestSha256(prior.pending_enrolment) !== requestSha256(request)
    ) {
      throw new CollabError(
        "relay_enrolment_local_fence_changed",
        "Local relay enrollment metadata changed while this request was in flight; refusing to replace the newer state",
      );
    }
    if (
      prior.repository.id !== null
      && prior.repository.id !== enrolment.repository.id
    ) {
      throw new CollabError(
        "relay_enrolment_scope_mismatch",
        "Relay enrollment response changed the credential repository scope",
      );
    }
    const timestamp = now();
    writeRelayCredentialFile(credentialPath, {
      ...prior,
      state: "active",
      repository: {
        key: prior.repository.key,
        id: enrolment.repository.id,
      },
      device: {
        id: prior.device.id,
        label: request.device.label,
        version: enrolment.device.version,
      },
      pending_enrolment: null,
      updated_at: timestamp,
    }, { replace: true });
    return {
      enrolment,
      credential_file: credentialPath,
      token_storage: reference.source,
      token_prefix: reference.prefix,
      secret_boundary:
        "raw_relay_bearer_is_not_returned_and_is_resolved_only_by_the_scoped_runtime",
    };
  } catch (error) {
    // Once the pending metadata exists, the server may already have committed
    // even if its response was lost or local activation failed. Preserve its
    // exact hash-only request and token reference for a safe retry.
    throw error;
  }
  } finally {
    localLock.release();
  }
}

function assertExistingScope(
  credential: RelayCredentialMetadata,
  expected: {
    relay_url: string;
    repository_key: string;
    device_id: string;
  },
): void {
  if (
    credential.relay_url !== expected.relay_url
    || credential.repository.key !== expected.repository_key
    || credential.device.id !== expected.device_id
  ) {
    throw new CollabError(
      "relay_credential_scope_mismatch",
      "Existing relay credential metadata belongs to another relay, repository, or device",
    );
  }
}

function defaultSecretStore(
  existing: RelayCredentialMetadata | null,
): RelaySecretStore {
  if (existing?.token.source === "environment") {
    return new EnvironmentRelaySecretStore();
  }
  if (existing?.token.source === "keychain") {
    return new MacOSKeychainRelaySecretStore();
  }
  return process.env.AGENTOOL_COLLAB_RELAY_TOKEN
    ? new EnvironmentRelaySecretStore()
    : new MacOSKeychainRelaySecretStore();
}

function assertEnrolmentResult(
  result: RelayEnrolmentResult,
  request: RelayEnrolmentRequest,
): void {
  if (
    result.repository.key !== request.repository.key
    || result.repository.provider !== request.repository.provider
    || (
      result.repository.provider_repository_id
      !== request.repository.provider_repository_id
    )
    || result.repository.display_name !== request.repository.display_name
    || result.device.id !== request.device.id
    || result.device.label !== request.device.label
    || result.device.token_prefix !== request.token.prefix
    || result.receipt.idempotency_key !== request.idempotency_key
    || result.receipt.request_sha256 !== requestSha256(request)
    || result.device.version
      < Math.max(1, request.expected_device_version)
    || result.device.version > request.expected_device_version + 1
    || result.created !== (request.expected_device_version === 0)
    || result.observation_policy.profile_sha256
      !== request.observation_policy.profile_sha256
    || result.observation_policy.allowed_providers.length
      !== request.observation_policy.allowed_providers.length
    || result.observation_policy.allowed_providers.some(
      (provider, index) =>
        provider !== request.observation_policy.allowed_providers[index],
    )
    || !result.device.active
  ) {
    throw new CollabError(
      "relay_enrolment_scope_mismatch",
      "Relay enrollment response does not bind the requested repository, device, and token prefix",
    );
  }
}

function canonicalDeviceId(value: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  ) {
    throw new CollabError(
      "relay_device_id_invalid",
      "Relay device ID must be a canonical lowercase UUID",
    );
  }
  return value;
}

function validateDeviceLabel(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length < 1
    || trimmed.length > 128
    || /[\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    throw new CollabError(
      "relay_device_label_invalid",
      "Relay device label must be 1 to 128 visible characters",
    );
  }
  return trimmed;
}
