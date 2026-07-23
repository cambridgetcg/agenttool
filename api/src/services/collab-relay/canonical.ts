/** Canonical metadata hashing for relay idempotency and event chaining.
 *
 * Inputs are strict JSON protocol objects. SHA-256 digests are evidence of
 * exact request equivalence; they are not signatures or authorization.
 * Doctrine: docs/CROSS-DEVICE-COLLABORATION.md. */

import { createHash } from "node:crypto";

import type {
  CollabEnrolmentInput,
  ProviderObservationInput,
} from "./contracts";

type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

function canonicalValue(value: Json): string {
  if (
    value === null
    || typeof value === "boolean"
    || typeof value === "number"
    || typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key]!)}`)
    .join(",")}}`;
}

export function collabCanonicalJson(value: unknown): string {
  return canonicalValue(value as Json);
}

export function collabSha256(value: unknown): string {
  return createHash("sha256")
    .update(collabCanonicalJson(value), "utf8")
    .digest("hex");
}

export function relayTokenSha256(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** Deterministic enrollment retry identity. It binds only the strict,
 * hash-only enrollment intent; the raw scoped bearer is never an input. */
export function collabEnrolmentIdempotencyKey(
  input:
    | CollabEnrolmentInput
    | Omit<CollabEnrolmentInput, "idempotency_key">,
): string {
  const { idempotency_key: _ignored, ...intent } =
    input as CollabEnrolmentInput;
  return `enrol:${collabSha256(intent)}`;
}

/** Stable provider projection identity. Observer attribution and the local
 * time at which a device noticed the provider fact are deliberately excluded,
 * so two devices can import the same native event without a false collision. */
export function providerObservationProjectionSha256(
  input: ProviderObservationInput,
): string {
  return collabSha256({
    schema: input.schema,
    provider: input.provider,
    provider_event_id: input.provider_event_id ?? null,
    action_id: input.action_id ?? null,
    occurred_at: input.occurred_at
      ? new Date(input.occurred_at).toISOString()
      : null,
    resource_kind: input.resource_kind,
    resource_id: input.resource_id,
    native_state: input.native_state,
    normalized_state: input.normalized_state,
    source_revision: input.source_revision ?? null,
    environment: input.environment ?? null,
    url: input.url ? new URL(input.url).href : null,
    payload_sha256: input.payload_sha256,
  });
}

export function collabEventHash(input: {
  previous_hash: string | null;
  sequence: number;
  event_id: string;
  type: string;
  occurred_at: string;
  device_id: string | null;
  session_id: string | null;
  actor_label: string | null;
  body: Record<string, unknown>;
}): string {
  return collabSha256({
    domain: "agenttool.collab-event/1",
    ...input,
  });
}
