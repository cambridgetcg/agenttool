/** Strict wire contracts for the cross-device collaboration relay.
 *
 * These messages expose coordination-metadata fields only and reject common
 * credential shapes. Callers must still keep secrets, raw webhook bodies,
 * logs, command output, and file content out: no pattern filter is universal.
 * Doctrine: docs/CROSS-DEVICE-COLLABORATION.md.
 * Spec: docs/specs/AGENTTOOL-COLLAB-RELEASE-ROOM-0.4.md. */

import { z } from "zod";

export const COLLAB_MAX_PAGE = 200;
export const COLLAB_DEFAULT_PAGE = 100;
export const COLLAB_MIN_LEASE_SECONDS = 30;
export const COLLAB_MAX_LEASE_SECONDS = 3_600;

const knownCredentialPattern =
  /\b(?:(?:atc?|npm|gh[pousr])_[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{16,}|(?:api[_ -]?key|access[_ -]?token|client[_ -]?secret|password)\s*[:=]\s*\S{8,})|-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i;

function safeUrlPath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

const boundedText = (
  minimum: number,
  maximum: number,
  label: string,
) =>
  z
    .string()
    .min(minimum, `${label} must not be empty`)
    .max(maximum, `${label} is too long`)
    .refine(
      (value) => !/[\u0000-\u001f\u007f]/.test(value),
      `${label} must not contain ASCII control characters`,
    )
    .refine(
      (value) => !knownCredentialPattern.test(value),
      `${label} must not contain a known credential pattern`,
    );

export const canonicalUuidSchema = z
  .string()
  .uuid()
  .refine(
    (value) => value === value.toLowerCase(),
    "must be a canonical lowercase UUID",
  );

export const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "must be a lowercase SHA-256 hex digest");

export const repositoryKeySchema = boundedText(1, 256, "repository key");
export const operationNameSchema = boundedText(1, 96, "operation").refine(
  (value) => /^[a-z0-9][a-z0-9._:-]*$/.test(value),
  "operation contains unsupported characters",
);
export const environmentNameSchema = boundedText(
  1,
  128,
  "environment",
).refine(
  (value) => /^[a-z0-9][a-z0-9._:-]*$/.test(value),
  "environment contains unsupported characters",
);
export const idempotencyKeySchema = boundedText(
  1,
  128,
  "idempotency key",
).refine(
  (value) => /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value),
  "idempotency key contains unsupported characters",
);

export const relayTokenPrefixSchema = z
  .string()
  .regex(
    /^atc_[A-Za-z0-9_-]{8}$/,
    "token prefix must be exactly the first 12 characters of the atc_ bearer",
  );

export const repositoryProviderSchema = z.enum(["github", "git", "other"]);
export const providerObservationProviderSchema = z.enum([
  "github",
  "npm",
  "fly",
  "cloudflare-pages",
  "vercel",
]);
const observationProviderPolicySchema = z
  .array(providerObservationProviderSchema)
  .max(5)
  .refine(
    (values) => new Set(values).size === values.length,
    "allowed observation providers must be unique",
  )
  .refine(
    (values) =>
      values.every(
        (value, index) => index === 0 || values[index - 1]! < value,
      ),
    "allowed observation providers must use canonical lexical order",
  );
export const operationPhaseSchema = z.enum([
  "idle",
  "claimed",
  "executing",
  "recovery_required",
]);
export const operationRunStatusSchema = z.enum([
  "claimed",
  "executing",
  "succeeded",
  "failed",
  "cancelled",
  "uncertain",
  "released",
  "recovery_required",
]);
export const operationOutcomeSchema = z.enum([
  "succeeded",
  "failed",
  "cancelled",
  "uncertain",
]);
export const normalizedProviderStateSchema = z.enum([
  "pending",
  "running",
  "awaiting_approval",
  "succeeded",
  "failed",
  "cancelled",
  "uncertain",
]);

export type RepositoryProvider = z.infer<typeof repositoryProviderSchema>;
export type ProviderObservationProvider = z.infer<
  typeof providerObservationProviderSchema
>;
export type OperationPhase = z.infer<typeof operationPhaseSchema>;
export type OperationRunStatus = z.infer<typeof operationRunStatusSchema>;
export type OperationOutcome = z.infer<typeof operationOutcomeSchema>;
export type NormalizedProviderState = z.infer<
  typeof normalizedProviderStateSchema
>;

export const collabEnrolmentSchema = z
  .object({
    schema: z.literal("agenttool.collab-enrolment/1"),
    idempotency_key: idempotencyKeySchema,
    expected_device_version: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER),
    repository: z
      .object({
        key: repositoryKeySchema,
        provider: repositoryProviderSchema,
        provider_repository_id: boundedText(
          1,
          256,
          "provider repository ID",
        ),
        display_name: boundedText(1, 256, "repository display name"),
      })
      .strict(),
    device: z
      .object({
        id: canonicalUuidSchema,
        label: boundedText(1, 128, "device label"),
      })
      .strict(),
    observation_policy: z
      .object({
        profile_sha256: sha256Schema,
        allowed_providers: observationProviderPolicySchema,
      })
      .strict(),
    token: z
      .object({
        prefix: relayTokenPrefixSchema,
        sha256: sha256Schema,
      })
      .strict(),
  })
  .strict();

const operationBindingShape = {
  action_id: canonicalUuidSchema,
  session_id: canonicalUuidSchema,
  actor_label: boundedText(1, 128, "actor label").optional(),
  operation: operationNameSchema,
  environment: environmentNameSchema,
  target: boundedText(1, 512, "operation target"),
  source_revision: z
    .string()
    .regex(
      /^[0-9a-f]{40,64}$/,
      "source revision must be 40 to 64 lowercase Git hex characters",
    ),
  parameters_sha256: sha256Schema,
};

export const operationClaimSchema = z
  .object({
    schema: z.literal("agenttool.collab-operation-claim/1"),
    idempotency_key: idempotencyKeySchema,
    ...operationBindingShape,
    lease_seconds: z
      .number()
      .int()
      .min(COLLAB_MIN_LEASE_SECONDS)
      .max(COLLAB_MAX_LEASE_SECONDS),
  })
  .strict();

const fencedOperationShape = {
  idempotency_key: idempotencyKeySchema,
  ...operationBindingShape,
  lease_id: canonicalUuidSchema,
  expected_version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  expected_generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
};

export const operationRenewSchema = z
  .object({
    schema: z.literal("agenttool.collab-operation-renew/1"),
    ...fencedOperationShape,
    lease_seconds: z
      .number()
      .int()
      .min(COLLAB_MIN_LEASE_SECONDS)
      .max(COLLAB_MAX_LEASE_SECONDS),
  })
  .strict();

export const operationBeginSchema = z
  .object({
    schema: z.literal("agenttool.collab-operation-begin/1"),
    ...fencedOperationShape,
  })
  .strict();

const operationEvidenceShape = {
  receipt_ref: z
    .object({
      schema: z.enum([
        "agenttool.npm-release/1",
        "agenttool-deploy-receipt/v2",
        "other",
      ]),
      sha256: sha256Schema,
    })
    .strict()
    .optional(),
  observation_ids: z
    .array(canonicalUuidSchema)
    .max(32)
    .refine(
      (values) => new Set(values).size === values.length,
      "observation IDs must be unique",
    )
    .optional(),
};

export const operationCompleteSchema = z
  .object({
    schema: z.literal("agenttool.collab-operation-complete/1"),
    ...fencedOperationShape,
    outcome: operationOutcomeSchema,
    ...operationEvidenceShape,
  })
  .strict();

export const operationReleaseSchema = z
  .object({
    schema: z.literal("agenttool.collab-operation-release/1"),
    ...fencedOperationShape,
    reason: boundedText(1, 256, "release reason").optional(),
  })
  .strict();

export const operationRecoverSchema = z
  .object({
    schema: z.literal("agenttool.collab-operation-recover/1"),
    idempotency_key: idempotencyKeySchema,
    ...operationBindingShape,
    expected_version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    expected_generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    disposition: z.enum(["succeeded", "failed", "cancelled", "uncertain"]),
    reason: boundedText(1, 512, "recovery reason"),
    ...operationEvidenceShape,
  })
  .strict();

export const providerObservationSchema = z
  .object({
    schema: z.literal("agenttool.collab-provider-observation/1"),
    idempotency_key: idempotencyKeySchema,
    provider: providerObservationProviderSchema,
    provider_event_id: boundedText(1, 256, "provider event ID")
      .nullable()
      .optional(),
    action_id: canonicalUuidSchema.optional(),
    session_id: canonicalUuidSchema,
    actor_label: boundedText(1, 128, "actor label").optional(),
    observed_at: z.string().datetime({ offset: true }),
    occurred_at: z.string().datetime({ offset: true }).optional(),
    normalized_state: normalizedProviderStateSchema,
    source_revision: z
      .string()
      .regex(
        /^[0-9a-f]{40,64}$/,
        "source revision must be 40 to 64 lowercase Git hex characters",
      )
      .optional(),
    environment: environmentNameSchema.optional(),
    resource_kind: boundedText(1, 128, "resource kind"),
    resource_id: boundedText(1, 512, "resource ID"),
    native_state: boundedText(1, 256, "native state"),
    url: z.string().url().max(2_048).refine((value) => {
      const parsed = new URL(value);
      return parsed.protocol === "https:"
        && parsed.username === ""
        && parsed.password === ""
        && parsed.search === ""
        && parsed.hash === ""
        && !knownCredentialPattern.test(value)
        && !knownCredentialPattern.test(safeUrlPath(parsed.pathname));
    }, "provider URL must be HTTPS without credentials, query, fragment, or known credential pattern")
      .nullable()
      .optional(),
    payload_sha256: sha256Schema,
  })
  .strict();

export const listPageQuerySchema = z
  .object({
    after: z.coerce
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .default(0),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(COLLAB_MAX_PAGE)
      .default(COLLAB_DEFAULT_PAGE),
  })
  .strict();

export const listOperationsQuerySchema = listPageQuerySchema.extend({
  operation: operationNameSchema.optional(),
  environment: environmentNameSchema.optional(),
}).strict();

export type CollabEnrolmentInput = z.infer<typeof collabEnrolmentSchema>;
export type OperationClaimInput = z.infer<typeof operationClaimSchema>;
export type OperationRenewInput = z.infer<typeof operationRenewSchema>;
export type OperationBeginInput = z.infer<typeof operationBeginSchema>;
export type OperationCompleteInput = z.infer<typeof operationCompleteSchema>;
export type OperationReleaseInput = z.infer<typeof operationReleaseSchema>;
export type OperationRecoverInput = z.infer<typeof operationRecoverSchema>;
export type ProviderObservationInput = z.infer<
  typeof providerObservationSchema
>;
export type ListPageInput = z.infer<typeof listPageQuerySchema>;
export type ListOperationsInput = z.infer<typeof listOperationsQuerySchema>;

export interface CollabPrincipal {
  project_id: string;
  repository_id: string;
  device_id: string;
  device_label: string;
  token_prefix: string;
  /** Internal request fence; never serialized in relay responses or events. */
  token_sha256: string;
}

export interface EnrolmentResult {
  schema: "agenttool.collab-enrolment-result/1";
  replayed: boolean;
  receipt: MutationReceipt;
  repository: {
    id: string;
    key: string;
    provider: RepositoryProvider;
    provider_repository_id: string;
    display_name: string;
  };
  device: {
    id: string;
    label: string;
    token_prefix: string;
    active: boolean;
    version: number;
  };
  observation_policy: {
    profile_sha256: string;
    allowed_providers: ProviderObservationProvider[];
  };
  created: boolean;
}

export interface OperationSlotRecord {
  sequence: number;
  repository_id: string;
  operation: string;
  environment: string;
  phase: OperationPhase;
  action_id: string | null;
  holder_device_id: string | null;
  session_id: string | null;
  actor_label: string | null;
  lease_id: string | null;
  lease_expires_at: string | null;
  version: number;
  generation: number;
  target: string | null;
  source_revision: string | null;
  parameters_sha256: string | null;
  updated_at: string;
}

export interface OperationRunRecord {
  action_id: string;
  operation: string;
  environment: string;
  device_id: string;
  session_id: string;
  actor_label: string | null;
  status: OperationRunStatus;
  lease_id: string;
  generation: number;
  target: string;
  source_revision: string;
  parameters_sha256: string;
  claimed_at: string;
  began_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface MutationReceipt {
  idempotency_key: string;
  request_sha256: string;
  recorded_at: string;
}

export interface OperationResult {
  schema: "agenttool.collab-operation-result/1";
  replayed: boolean;
  receipt: MutationReceipt;
  slot: OperationSlotRecord;
  run: OperationRunRecord;
  authority: {
    kind: "coordination_only";
    provider_authority_granted: false;
  };
}

export interface OperationPage {
  schema: "agenttool.collab-operation-page/1";
  repository_id: string;
  operations: OperationSlotRecord[];
  next_after: number;
  has_more: boolean;
}

export interface CollabEventRecord {
  sequence: number;
  event_id: string;
  type: string;
  occurred_at: string;
  device_id: string | null;
  session_id: string | null;
  actor_label: string | null;
  body: Record<string, unknown>;
  previous_hash: string | null;
  event_hash: string;
}

export interface CollabEventPage {
  schema: "agenttool.collab-event-page/1";
  repository_id: string;
  events: CollabEventRecord[];
  next_after: number;
  has_more: boolean;
}

export interface ProviderObservationRecord {
  sequence: number;
  observation_id: string;
  repository_id: string;
  provider: ProviderObservationProvider;
  provider_event_id: string | null;
  action_id: string | null;
  provenance: "device_observed";
  observing_device_id: string;
  observing_session_id: string;
  actor_label: string | null;
  observed_at: string;
  occurred_at: string | null;
  normalized_state: NormalizedProviderState;
  source_revision: string | null;
  environment: string | null;
  resource_kind: string;
  resource_id: string;
  native_state: string;
  url: string | null;
  payload_sha256: string;
  received_at: string;
}

export interface ProviderObservationResult {
  schema: "agenttool.collab-provider-observation-result/1";
  deduplicated: boolean;
  replayed: boolean;
  receipt: MutationReceipt;
  observation: ProviderObservationRecord;
}

export interface ProviderObservationPage {
  schema: "agenttool.collab-provider-observation-page/1";
  repository_id: string;
  observations: ProviderObservationRecord[];
  next_after: number;
  has_more: boolean;
}
