import { CollabError } from "./errors.js";
import {
  validateProjectProfile,
  type ProjectProfile,
} from "./project-profile.js";
import {
  normalizeRelayUrl,
  type ResolvedRelayCredential,
} from "./relay-credential.js";
import {
  assertBoundedSafeJson,
  operationBeginSchema,
  operationClaimSchema,
  operationCompleteSchema,
  operationPageSchema,
  operationRecoverSchema,
  operationReleaseSchema,
  operationRenewSchema,
  operationResultSchema,
  operationStatusQuerySchema,
  providerObservationInputSchema,
  providerObservationPageSchema,
  providerObservationResultSchema,
  relayEnrolmentIdempotencyKey,
  relayEnrolmentRequestSchema,
  relayEnrolmentResultSchema,
  relayEventPageSchema,
  requestSha256,
  type OperationBeginInput,
  type OperationClaimInput,
  type OperationCompleteInput,
  type OperationPage,
  type OperationRecoverInput,
  type OperationReleaseInput,
  type OperationRenewInput,
  type OperationResult,
  type OperationStatusQuery,
  type ProviderObservationInput,
  type ProviderObservationPage,
  type ProviderObservationResult,
  type RelayEnrolmentRequest,
  type RelayEnrolmentResult,
  type RelayEventPage,
} from "./relay-contract.js";
import type { z } from "zod";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface RelayFetch {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export interface CollabRelayClientOptions {
  credential: ResolvedRelayCredential;
  profile: ProjectProfile;
  fetch?: RelayFetch;
  timeout_ms?: number;
}

export interface RelayPublicContext {
  relay_url: string;
  repository_id: string;
  repository_key: string;
  device_id: string;
  project_id: string;
  authentication_boundary:
    "scoped_device_bearer_coordinates_participating_clients_but_grants_no_provider_authority";
}

export class CollabRelayClient {
  readonly #relayUrl: string;
  readonly #repositoryId: string;
  readonly #repositoryKey: string;
  readonly #deviceId: string;
  readonly #token: string;
  readonly #profile: ProjectProfile;
  readonly #fetch: RelayFetch;
  readonly #timeoutMs: number;

  constructor(options: CollabRelayClientOptions) {
    const profile = validateProjectProfile(options.profile);
    this.#relayUrl = normalizeRelayUrl(options.credential.metadata.relay_url);
    if (this.#relayUrl !== options.credential.metadata.relay_url) {
      throw new CollabError(
        "relay_credential_url_mismatch",
        "Relay credential URL is not a canonical origin",
      );
    }
    if (
      options.credential.metadata.repository.key
      !== profile.repository.key
    ) {
      throw new CollabError(
        "relay_profile_scope_mismatch",
        "Relay credential and project profile identify different repositories",
      );
    }
    this.#repositoryId = options.credential.metadata.repository.id;
    this.#repositoryKey = options.credential.metadata.repository.key;
    this.#deviceId = options.credential.metadata.device.id;
    this.#token = options.credential.token;
    this.#profile = profile;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = normalizeTimeout(options.timeout_ms);
  }

  context(): RelayPublicContext {
    return {
      relay_url: this.#relayUrl,
      repository_id: this.#repositoryId,
      repository_key: this.#repositoryKey,
      device_id: this.#deviceId,
      project_id: this.#profile.project_id,
      authentication_boundary:
        "scoped_device_bearer_coordinates_participating_clients_but_grants_no_provider_authority",
    };
  }

  async events(input: {
    after?: number;
    limit?: number;
  } = {}): Promise<RelayEventPage> {
    const query = pageQuery(input);
    const page = await this.#request(
      "GET",
      `/events?${query}`,
      relayEventPageSchema,
    );
    this.#assertRepositoryScope(page.repository_id, "event page");
    return page;
  }

  async operations(
    input: OperationStatusQuery = {},
  ): Promise<OperationPage> {
    const parsed = operationStatusQuerySchema.parse(input);
    const query = new URLSearchParams({
      after: String(parsed.after),
      limit: String(parsed.limit),
    });
    if (parsed.operation) query.set("operation", parsed.operation);
    if (parsed.environment) query.set("environment", parsed.environment);
    const page = await this.#request(
      "GET",
      `/operations?${query}`,
      operationPageSchema,
    );
    this.#assertRepositoryScope(page.repository_id, "operation page");
    return page;
  }

  async claim(input: OperationClaimInput): Promise<OperationResult> {
    return await this.#operationMutation(
      "/operations/claim",
      operationClaimSchema.parse(input),
      "claim",
    );
  }

  async renew(input: OperationRenewInput): Promise<OperationResult> {
    const parsed = operationRenewSchema.parse(input);
    return await this.#operationMutation(
      `/operations/${encodeURIComponent(parsed.action_id)}/renew`,
      parsed,
      "renew",
    );
  }

  async begin(input: OperationBeginInput): Promise<OperationResult> {
    const parsed = operationBeginSchema.parse(input);
    return await this.#operationMutation(
      `/operations/${encodeURIComponent(parsed.action_id)}/begin`,
      parsed,
      "begin",
    );
  }

  async complete(input: OperationCompleteInput): Promise<OperationResult> {
    const parsed = operationCompleteSchema.parse(input);
    return await this.#operationMutation(
      `/operations/${encodeURIComponent(parsed.action_id)}/complete`,
      parsed,
    );
  }

  async release(input: OperationReleaseInput): Promise<OperationResult> {
    const parsed = operationReleaseSchema.parse(input);
    return await this.#operationMutation(
      `/operations/${encodeURIComponent(parsed.action_id)}/release`,
      parsed,
    );
  }

  async recover(input: OperationRecoverInput): Promise<OperationResult> {
    const parsed = operationRecoverSchema.parse(input);
    return await this.#operationMutation(
      `/operations/${encodeURIComponent(parsed.action_id)}/recover`,
      parsed,
    );
  }

  async observe(
    input: ProviderObservationInput,
  ): Promise<ProviderObservationResult> {
    // Current enrollment policy and exact historical receipt replay are
    // authoritative at the relay. Pre-rejecting from the current local profile
    // would make a valid exact retry impossible after a provider is disabled.
    const parsed = providerObservationInputSchema.parse(input);
    const result = await this.#request(
      "POST",
      "/observations",
      providerObservationResultSchema,
      parsed,
      parsed.idempotency_key,
    );
    this.#verifyMutationReceipt(parsed, result.receipt);
    this.#assertRepositoryScope(
      result.observation.repository_id,
      "provider observation result",
    );
    return result;
  }

  async observations(input: {
    after?: number;
    limit?: number;
  } = {}): Promise<ProviderObservationPage> {
    const query = pageQuery(input);
    const page = await this.#request(
      "GET",
      `/observations?${query}`,
      providerObservationPageSchema,
    );
    this.#assertRepositoryScope(
      page.repository_id,
      "provider observation page",
    );
    return page;
  }

  async #operationMutation(
    path: string,
    input:
      | OperationClaimInput
      | OperationRenewInput
      | OperationBeginInput
      | OperationCompleteInput
      | OperationReleaseInput
      | OperationRecoverInput,
    actionableReplay?: "claim" | "renew" | "begin",
  ): Promise<OperationResult> {
    const result = await this.#request(
      "POST",
      path,
      operationResultSchema,
      input,
      input.idempotency_key,
    );
    this.#verifyMutationReceipt(input, result.receipt);
    this.#assertRepositoryScope(
      result.slot.repository_id,
      "operation result",
    );
    if (actionableReplay) {
      this.#assertActionableLeaseFresh(result);
      await this.#verifyActionableResultIsCurrent(result);
    }
    return result;
  }

  #assertActionableLeaseFresh(result: OperationResult): void {
    if (
      result.slot.lease_expires_at
      && Date.parse(result.slot.lease_expires_at) > Date.now()
    ) {
      return;
    }
    throw new CollabError(
      result.slot.phase === "executing"
        ? "recovery_required"
        : "lease_expired",
      result.slot.phase === "executing"
        ? "The returned executing lease is already expired and requires recovery"
        : "The returned claimed lease is already expired",
      {
        action_id: result.slot.action_id,
        version: result.slot.version,
        generation: result.slot.generation,
      },
    );
  }

  async #verifyActionableResultIsCurrent(
    result: OperationResult,
  ): Promise<void> {
    const page = await this.operations({
      after: 0,
      limit: 1,
      operation: result.slot.operation,
      environment: result.slot.environment,
    });
    const current = page.operations[0];
    if (current?.phase === "recovery_required") {
      throw new CollabError(
        "recovery_required",
        "The operation result is historical and now requires recovery",
        {
          action_id: current.action_id,
          version: current.version,
          generation: current.generation,
        },
      );
    }
    if (
      current
      && current.lease_expires_at
      && Date.parse(current.lease_expires_at) <= Date.now()
    ) {
      throw new CollabError(
        current.phase === "executing"
          ? "recovery_required"
          : "lease_expired",
        current.phase === "executing"
          ? "The current executing lease expired and requires recovery"
          : "The current claimed lease has expired",
        {
          action_id: current.action_id,
          version: current.version,
          generation: current.generation,
        },
      );
    }
    if (!current || !sameOperationSlotFence(result.slot, current)) {
      throw new CollabError(
        "stale_fence",
        "The operation result no longer matches the current slot fence",
        current
          ? {
              action_id: current.action_id,
              version: current.version,
              generation: current.generation,
            }
          : undefined,
      );
    }
  }

  #assertRepositoryScope(repositoryId: string, label: string): void {
    if (repositoryId !== this.#repositoryId) {
      throw new CollabError(
        "relay_scope_mismatch",
        `Relay ${label} does not match the scoped repository`,
      );
    }
  }

  #verifyMutationReceipt(
    input: { idempotency_key: string },
    receipt: { idempotency_key: string; request_sha256: string },
  ): void {
    if (
      receipt.idempotency_key !== input.idempotency_key
      || receipt.request_sha256 !== requestSha256(input)
    ) {
      throw new CollabError(
        "relay_receipt_mismatch",
        "Relay mutation receipt does not bind the exact request",
      );
    }
  }

  async #request<T>(
    method: "GET" | "POST",
    path: string,
    responseSchema: z.ZodType<T>,
    body?: unknown,
    idempotency?: string,
  ): Promise<T> {
    const base = normalizeRelayUrl(this.#relayUrl);
    const url =
      `${base}/v1/collab/repositories/${encodeURIComponent(this.#repositoryId)}${path}`;
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    const attempts = method === "POST" && idempotency ? 2 : 1;
    let lastFailure: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
      try {
        const headers: Record<string, string> = {
          Accept: "application/json",
          Authorization: `Bearer ${this.#token}`,
        };
        if (serialized !== undefined) headers["Content-Type"] = "application/json";
        if (idempotency) headers["Idempotency-Key"] = idempotency;
        const response = await this.#fetch(url, {
          method,
          headers,
          body: serialized,
          signal: controller.signal,
        });
        if (
          attempt < attempts
          && RETRYABLE_STATUS.has(response.status)
        ) {
          await drainResponse(response);
          continue;
        }
        const payload = await responseJson(response);
        if (!response.ok) throw mappedRelayError(response.status, payload);
        const parsed = responseSchema.safeParse(payload);
        if (!parsed.success) {
          throw new CollabError(
            "relay_invalid_response",
            "Relay returned a response outside the expected bounded contract",
            {
              http_status: response.status,
              issues: parsed.error.issues.slice(0, 10).map((issue) => ({
                path: issue.path.join("."),
                message: issue.message.slice(0, 200),
              })),
            },
          );
        }
        return parsed.data;
      } catch (error) {
        if (error instanceof CollabError) throw error;
        lastFailure = error;
        if (attempt >= attempts) break;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new CollabError(
      "relay_unavailable",
      "The release-room relay is unavailable; no remote coordination mutation was assumed",
      {
        method,
        operation: safeOperationLabel(path),
        failure:
          lastFailure instanceof DOMException && lastFailure.name === "AbortError"
            ? "timeout"
            : "network",
      },
    );
  }
}

export async function postRelayEnrolment(input: {
  relay_url: string;
  project_bearer: string;
  request: RelayEnrolmentRequest;
  fetch?: RelayFetch;
  timeout_ms?: number;
}): Promise<RelayEnrolmentResult> {
  const relayUrl = normalizeRelayUrl(input.relay_url);
  const request = relayEnrolmentRequestSchema.parse(input.request);
  if (
    request.idempotency_key
    !== relayEnrolmentIdempotencyKey(request)
  ) {
    throw new CollabError(
      "relay_enrolment_idempotency_invalid",
      "Enrollment idempotency key does not bind the exact request intent",
    );
  }
  const bearer = validateProjectBearer(input.project_bearer);
  const serialized = JSON.stringify(request);
  const attempts = 2;
  let lastFailure: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      normalizeTimeout(input.timeout_ms),
    );
    try {
      const response = await (input.fetch ?? fetch)(
        `${relayUrl}/v1/collab/enrolments`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${bearer}`,
            "Content-Type": "application/json",
            "Idempotency-Key": request.idempotency_key,
          },
          body: serialized,
          signal: controller.signal,
        },
      );
      if (
        attempt < attempts
        && RETRYABLE_STATUS.has(response.status)
      ) {
        await drainResponse(response);
        continue;
      }
      const payload = await responseJson(response);
      if (!response.ok) throw mappedRelayError(response.status, payload);
      const result = relayEnrolmentResultSchema.safeParse(payload);
      if (!result.success) {
        throw new CollabError(
          "relay_invalid_response",
          "Relay enrollment response is outside the expected bounded contract",
        );
      }
      if (
        result.data.receipt.idempotency_key !== request.idempotency_key
        || result.data.receipt.request_sha256 !== requestSha256(request)
      ) {
        throw new CollabError(
          "relay_receipt_mismatch",
          "Relay enrollment receipt does not bind the exact request",
        );
      }
      return result.data;
    } catch (error) {
      if (error instanceof CollabError) throw error;
      lastFailure = error;
      if (attempt >= attempts) break;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new CollabError(
    "relay_unavailable",
    "The relay enrollment endpoint is unavailable",
    {
      failure:
        lastFailure instanceof DOMException && lastFailure.name === "AbortError"
          ? "timeout"
          : "network",
    },
  );
}

function pageQuery(input: { after?: number; limit?: number }): string {
  const after = input.after ?? 0;
  const limit = input.limit ?? 100;
  if (
    !Number.isSafeInteger(after)
    || after < 0
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 200
  ) {
    throw new CollabError(
      "relay_page_invalid",
      "Relay page requires after >= 0 and limit between 1 and 200",
    );
  }
  return new URLSearchParams({
    after: String(after),
    limit: String(limit),
  }).toString();
}

async function responseJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > MAX_RESPONSE_BYTES) {
    throw new CollabError(
      "relay_response_too_large",
      "Relay response exceeds its byte bound",
      { http_status: response.status },
    );
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new CollabError(
      "relay_response_too_large",
      "Relay response exceeds its byte bound",
      { http_status: response.status },
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CollabError(
      "relay_invalid_response",
      "Relay returned non-JSON data",
      { http_status: response.status },
    );
  }
}

async function drainResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The retry reuses only the exact already-serialized idempotent request.
  }
}

function mappedRelayError(status: number, payload: unknown): CollabError {
  if (
    payload
    && typeof payload === "object"
    && !Array.isArray(payload)
    && "error" in payload
  ) {
    const error = (payload as { error?: unknown }).error;
    if (
      error
      && typeof error === "object"
      && !Array.isArray(error)
      && typeof (error as { code?: unknown }).code === "string"
      && typeof (error as { message?: unknown }).message === "string"
    ) {
      const code = (error as { code: string }).code;
      const message = (error as { message: string }).message;
      const details = (error as { details?: unknown }).details;
      let safeDetails: Record<string, unknown> | undefined;
      try {
        if (
          !/^[a-z][a-z0-9_]{0,99}$/.test(code)
          || !isSafeRemoteText(message, 500)
        ) {
          throw new Error("unsafe remote error envelope");
        }
        if (details !== undefined) {
          if (
            !details
            || typeof details !== "object"
            || Array.isArray(details)
          ) {
            throw new Error("unsafe remote error details");
          }
          assertBoundedSafeJson(details);
          if (containsCredentialMaterial(details)) {
            throw new Error("credential-like remote error details");
          }
          safeDetails = details as Record<string, unknown>;
        }
        return new CollabError(code, message, {
          http_status: status,
          ...(safeDetails ? { relay_details: safeDetails } : {}),
        });
      } catch {
        // A relay is not trusted to reflect arbitrary text across the local
        // credential/log boundary.
      }
    }
  }
  return new CollabError(
    "relay_http_error",
    "Relay rejected the request; unsafe or malformed remote error text was withheld",
    { http_status: status },
  );
}

function isSafeRemoteText(value: string, maximum: number): boolean {
  return value.length >= 1
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value)
    && !/(?:^|[^A-Za-z0-9])at(?:c)?_[A-Za-z0-9_-]{8,}/.test(value);
}

function containsCredentialMaterial(value: unknown): boolean {
  if (typeof value === "string") {
    return !isSafeRemoteText(value, 8_000);
  }
  if (Array.isArray(value)) {
    return value.some(containsCredentialMaterial);
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, child]) =>
        /(?:authorization|bearer|token|secret|password|credential|api[_-]?key)/i.test(
          key,
        )
        || containsCredentialMaterial(child),
    );
  }
  return false;
}

function normalizeTimeout(value?: number): number {
  const timeout = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60_000) {
    throw new CollabError(
      "relay_timeout_invalid",
      "Relay timeout must be between 100 and 60000 milliseconds",
    );
  }
  return timeout;
}

function validateProjectBearer(value: string): string {
  if (
    typeof value !== "string"
    || !/^at_[A-Za-z0-9_-]{43}$/.test(value)
  ) {
    throw new CollabError(
      "project_bearer_invalid",
      "Project bearer must use the exact AgentTool at_ credential format",
    );
  }
  return value;
}

function safeOperationLabel(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1)?.slice(0, 100) ?? "relay_request";
}

function sameOperationSlotFence(
  replayed: OperationResult["slot"],
  current: OperationResult["slot"],
): boolean {
  return current.sequence === replayed.sequence
    && current.repository_id === replayed.repository_id
    && current.operation === replayed.operation
    && current.environment === replayed.environment
    && current.phase === replayed.phase
    && current.action_id === replayed.action_id
    && current.holder_device_id === replayed.holder_device_id
    && current.session_id === replayed.session_id
    && current.actor_label === replayed.actor_label
    && current.lease_id === replayed.lease_id
    && current.lease_expires_at === replayed.lease_expires_at
    && current.version === replayed.version
    && current.generation === replayed.generation
    && current.target === replayed.target
    && current.source_revision === replayed.source_revision
    && current.parameters_sha256 === replayed.parameters_sha256;
}
