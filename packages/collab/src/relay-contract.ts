import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "./canonical.js";
import { CollabError } from "./errors.js";
import {
  validateProjectProfile,
  type ProjectProfile,
} from "./project-profile.js";

export const RELAY_ENROLMENT_SCHEMA = "agenttool.collab-enrolment/1" as const;
export const RELAY_ENROLMENT_RESULT_SCHEMA =
  "agenttool.collab-enrolment-result/1" as const;
export const RELAY_EVENT_PAGE_SCHEMA = "agenttool.collab-event-page/1" as const;
export const RELAY_OPERATION_PAGE_SCHEMA =
  "agenttool.collab-operation-page/1" as const;
export const RELAY_OPERATION_RESULT_SCHEMA =
  "agenttool.collab-operation-result/1" as const;
export const RELAY_PROVIDER_OBSERVATION_SCHEMA =
  "agenttool.collab-provider-observation/1" as const;
export const RELAY_PROVIDER_OBSERVATION_RESULT_SCHEMA =
  "agenttool.collab-provider-observation-result/1" as const;
export const RELAY_PROVIDER_OBSERVATION_PAGE_SCHEMA =
  "agenttool.collab-provider-observation-page/1" as const;
export const NPM_RELEASE_RECEIPT_SCHEMA = "agenttool.npm-release/1" as const;
export const DEPLOY_RECEIPT_SCHEMA = "agenttool-deploy-receipt/v2" as const;

const uuid = z.string().uuid()
  .refine((value) => value === value.toLowerCase(), "must be a canonical lowercase UUID");
const sha1 = z.string().regex(/^[a-f0-9]{40}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const sourceRevision = z.string().regex(/^[a-f0-9]{40,64}$/);
const isoTime = z.string().datetime({ offset: true });
const knownCredentialPattern =
  /\b(?:(?:atc?|npm|gh[pousr])_[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{16,}|(?:api[_ -]?key|access[_ -]?token|client[_ -]?secret|password)\s*[:=]\s*\S{8,})|-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i;
const safeMetadataText = (value: string) =>
  !hasControlCharacter(value) && !knownCredentialPattern.test(value);
const idempotencyKey = z.string().min(1).max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)
  .refine(
    safeMetadataText,
    "must not contain control characters or known credential patterns",
  );
const opaqueKey = z.string().min(1).max(256)
  .refine(safeMetadataText, "must not contain control characters or known credential patterns");
const actorLabel = z.string().min(1).max(128)
  .refine(safeMetadataText, "must not contain control characters or known credential patterns");
const operationName = z.string().min(1).max(96)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/)
  .refine(
    safeMetadataText,
    "must not contain control characters or known credential patterns",
  );
const environmentName = z.string().min(1).max(128)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/)
  .refine(
    safeMetadataText,
    "must not contain control characters or known credential patterns",
  );
const boundedText = z.string().min(1).max(512)
  .refine(safeMetadataText, "must not contain control characters or known credential patterns");
export const providerUrlSchema = z.string().url().max(2048)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && safeMetadataText(value)
      && safeMetadataText(decodeUrlPath(url.pathname));
  }, "must use HTTPS without credentials, query parameters, fragments, or known credential patterns");
const nullableHttpsUrl = providerUrlSchema.nullable();
const leaseSeconds = z.number().int().min(30).max(3600);
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const generation = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const completionOutcome = z.enum([
  "succeeded",
  "failed",
  "cancelled",
  "uncertain",
]);
const normalizedState = z.enum([
  "pending",
  "running",
  "awaiting_approval",
  "succeeded",
  "failed",
  "cancelled",
  "uncertain",
]);
const provider = z.enum([
  "github",
  "npm",
  "fly",
  "cloudflare-pages",
  "vercel",
]);
const observationProviderPolicy = z.array(provider).max(5)
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

export const relayReceiptRefSchema = z.object({
  schema: z.enum([
    NPM_RELEASE_RECEIPT_SCHEMA,
    DEPLOY_RECEIPT_SCHEMA,
    "other",
  ]),
  sha256,
}).strict();
export type RelayReceiptRef = z.infer<typeof relayReceiptRefSchema>;

export const relayMutationReceiptSchema = z.object({
  idempotency_key: idempotencyKey,
  request_sha256: sha256,
  recorded_at: isoTime,
}).strict();

const repositoryIdentitySchema = z.object({
  key: opaqueKey,
  provider: z.enum(["github", "git", "other"]),
  provider_repository_id: opaqueKey,
  display_name: z.string().min(1).max(256)
    .refine(safeMetadataText, "must not contain control characters or known credential patterns"),
}).strict();

export const relayEnrolmentRequestSchema = z.object({
  schema: z.literal(RELAY_ENROLMENT_SCHEMA),
  idempotency_key: idempotencyKey,
  expected_device_version: sequence,
  repository: repositoryIdentitySchema,
  device: z.object({
    id: uuid,
    label: z.string().min(1).max(128)
      .refine(safeMetadataText, "must not contain control characters or known credential patterns"),
  }).strict(),
  observation_policy: z.object({
    profile_sha256: sha256,
    allowed_providers: observationProviderPolicy,
  }).strict(),
  token: z.object({
    prefix: z.string().regex(/^atc_[A-Za-z0-9_-]{8}$/),
    sha256,
  }).strict(),
}).strict();
export type RelayEnrolmentRequest = z.infer<typeof relayEnrolmentRequestSchema>;

export function relayEnrolmentIdempotencyKey(
  input:
    | RelayEnrolmentRequest
    | Omit<RelayEnrolmentRequest, "idempotency_key">,
): string {
  const { idempotency_key: _ignored, ...intent } =
    input as RelayEnrolmentRequest;
  return `enrol:${requestSha256(intent)}`;
}

export const relayEnrolmentResultSchema = z.object({
  schema: z.literal(RELAY_ENROLMENT_RESULT_SCHEMA),
  replayed: z.boolean(),
  receipt: relayMutationReceiptSchema,
  repository: z.object({
    id: uuid,
    key: repositoryIdentitySchema.shape.key,
    provider: repositoryIdentitySchema.shape.provider,
    provider_repository_id: opaqueKey,
    display_name: repositoryIdentitySchema.shape.display_name,
  }).strict(),
  device: z.object({
    id: uuid,
    label: z.string().min(1).max(128)
      .refine(safeMetadataText, "must not contain control characters or known credential patterns"),
    token_prefix: z.string().regex(/^atc_[A-Za-z0-9_-]{8}$/),
    active: z.boolean(),
    version,
  }).strict(),
  observation_policy: z.object({
    profile_sha256: sha256,
    allowed_providers: observationProviderPolicy,
  }).strict(),
  created: z.boolean(),
}).strict();
export type RelayEnrolmentResult = z.infer<typeof relayEnrolmentResultSchema>;

const operationBindingShape = {
  idempotency_key: idempotencyKey,
  action_id: uuid,
  session_id: uuid,
  actor_label: actorLabel.optional(),
  operation: operationName,
  environment: environmentName,
  target: boundedText,
  source_revision: sourceRevision,
  parameters_sha256: sha256,
};

export const operationClaimSchema = z.object({
  schema: z.literal("agenttool.collab-operation-claim/1"),
  ...operationBindingShape,
  lease_seconds: leaseSeconds,
}).strict();
export type OperationClaimInput = z.infer<typeof operationClaimSchema>;

export const operationRenewSchema = z.object({
  schema: z.literal("agenttool.collab-operation-renew/1"),
  ...operationBindingShape,
  lease_id: uuid,
  expected_version: version,
  expected_generation: generation,
  lease_seconds: leaseSeconds,
}).strict();
export type OperationRenewInput = z.infer<typeof operationRenewSchema>;

export const operationBeginSchema = z.object({
  schema: z.literal("agenttool.collab-operation-begin/1"),
  ...operationBindingShape,
  lease_id: uuid,
  expected_version: version,
  expected_generation: generation,
}).strict();
export type OperationBeginInput = z.infer<typeof operationBeginSchema>;

export const operationCompleteSchema = z.object({
  schema: z.literal("agenttool.collab-operation-complete/1"),
  ...operationBindingShape,
  lease_id: uuid,
  expected_version: version,
  expected_generation: generation,
  outcome: completionOutcome,
  receipt_ref: relayReceiptRefSchema.optional(),
  observation_ids: z.array(uuid).max(32)
    .refine((values) => new Set(values).size === values.length)
    .optional(),
}).strict();
export type OperationCompleteInput = z.infer<typeof operationCompleteSchema>;

export const operationReleaseSchema = z.object({
  schema: z.literal("agenttool.collab-operation-release/1"),
  ...operationBindingShape,
  lease_id: uuid,
  expected_version: version,
  expected_generation: generation,
  reason: z.string().min(1).max(256)
    .refine(safeMetadataText, "must not contain control characters or known credential patterns")
    .optional(),
}).strict();
export type OperationReleaseInput = z.infer<typeof operationReleaseSchema>;

export const operationRecoverSchema = z.object({
  schema: z.literal("agenttool.collab-operation-recover/1"),
  ...operationBindingShape,
  expected_version: version,
  expected_generation: generation,
  disposition: completionOutcome,
  reason: z.string().min(1).max(512)
    .refine(safeMetadataText, "must not contain control characters or known credential patterns"),
  receipt_ref: relayReceiptRefSchema.optional(),
  observation_ids: z.array(uuid).max(32)
    .refine((values) => new Set(values).size === values.length)
    .optional(),
}).strict();
export type OperationRecoverInput = z.infer<typeof operationRecoverSchema>;

export const operationStatusQuerySchema = z.object({
  after: sequence.default(0),
  limit: z.number().int().min(1).max(200).default(100),
  operation: operationName.optional(),
  environment: environmentName.optional(),
}).strict();
export type OperationStatusQuery = z.input<typeof operationStatusQuerySchema>;

const operationRunSchema = z.object({
  action_id: uuid,
  operation: operationName,
  environment: environmentName,
  device_id: uuid,
  session_id: uuid,
  actor_label: actorLabel.nullable(),
  status: z.enum([
    "claimed",
    "executing",
    "succeeded",
    "failed",
    "cancelled",
    "uncertain",
    "released",
    "recovery_required",
  ]),
  lease_id: uuid,
  generation,
  target: boundedText,
  source_revision: sourceRevision,
  parameters_sha256: sha256,
  claimed_at: isoTime,
  began_at: isoTime.nullable(),
  completed_at: isoTime.nullable(),
  updated_at: isoTime,
}).strict();

export const operationSlotSchema = z.object({
  sequence: sequence,
  repository_id: uuid,
  operation: operationName,
  environment: environmentName,
  phase: z.enum(["idle", "claimed", "executing", "recovery_required"]),
  action_id: uuid.nullable(),
  session_id: uuid.nullable(),
  actor_label: actorLabel.nullable(),
  holder_device_id: uuid.nullable(),
  lease_id: uuid.nullable(),
  lease_expires_at: isoTime.nullable(),
  version,
  generation,
  target: boundedText.nullable(),
  source_revision: sourceRevision.nullable(),
  parameters_sha256: sha256.nullable(),
  updated_at: isoTime,
}).strict();
export type OperationSlot = z.infer<typeof operationSlotSchema>;

export const operationPageSchema = z.object({
  schema: z.literal(RELAY_OPERATION_PAGE_SCHEMA),
  repository_id: uuid,
  operations: z.array(operationSlotSchema).max(200),
  next_after: sequence,
  has_more: z.boolean(),
}).strict().superRefine((value, context) => {
  for (const [index, operation] of value.operations.entries()) {
    if (operation.repository_id !== value.repository_id) {
      context.addIssue({
        code: "custom",
        path: ["operations", index, "repository_id"],
        message: "operation repository must match its enclosing page",
      });
    }
  }
  for (let index = 1; index < value.operations.length; index += 1) {
    if (
      value.operations[index - 1]!.sequence
      >= value.operations[index]!.sequence
    ) {
      context.addIssue({
        code: "custom",
        path: ["operations", index, "sequence"],
        message: "operation sequences must be strictly ascending",
      });
    }
  }
  if (!value.has_more) {
    if (value.next_after !== 0) {
      context.addIssue({
        code: "custom",
        path: ["next_after"],
        message: "a terminal operation page must reset next_after to zero",
      });
    }
    return;
  }
  const finalSequence = value.operations.at(-1)?.sequence;
  if (finalSequence === undefined || value.next_after !== finalSequence) {
    context.addIssue({
      code: "custom",
      path: ["next_after"],
      message:
        "a nonterminal operation page must advance to its final operation sequence",
    });
  }
});
export type OperationPage = z.infer<typeof operationPageSchema>;

export const operationResultSchema = z.object({
  schema: z.literal(RELAY_OPERATION_RESULT_SCHEMA),
  replayed: z.boolean(),
  receipt: relayMutationReceiptSchema,
  slot: operationSlotSchema,
  run: operationRunSchema,
  authority: z.object({
    kind: z.literal("coordination_only"),
    provider_authority_granted: z.literal(false),
  }).strict(),
}).strict();
export type OperationResult = z.infer<typeof operationResultSchema>;

const safeEventBody = z.record(z.string().min(1).max(100), z.unknown());
const relayEventSchema = z.object({
  sequence: sequence,
  event_id: uuid,
  type: z.string().min(1).max(100)
    .regex(/^[a-z][a-z0-9._-]*$/),
  occurred_at: isoTime,
  device_id: uuid.nullable(),
  session_id: uuid.nullable(),
  actor_label: actorLabel.nullable(),
  body: safeEventBody,
  previous_hash: sha256.nullable(),
  event_hash: sha256,
}).strict();

export const relayEventPageSchema = z.object({
  schema: z.literal(RELAY_EVENT_PAGE_SCHEMA),
  repository_id: uuid,
  events: z.array(relayEventSchema).max(200),
  next_after: sequence,
  has_more: z.boolean(),
}).strict().superRefine((value, context) => {
  for (const [index, event] of value.events.entries()) {
    try {
      assertBoundedSafeJson(event.body);
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["events", index, "body"],
        message: error instanceof Error ? error.message : "unsafe event body",
      });
    }
  }
});
export type RelayEventPage = z.infer<typeof relayEventPageSchema>;

export const providerObservationInputSchema = z.object({
  schema: z.literal(RELAY_PROVIDER_OBSERVATION_SCHEMA),
  idempotency_key: idempotencyKey,
  session_id: uuid,
  actor_label: actorLabel.optional(),
  action_id: uuid.optional(),
  provider,
  provider_event_id: z.string().min(1).max(256)
    .refine(safeMetadataText, "must not contain control characters or known credential patterns")
    .nullable()
    .optional(),
  observed_at: isoTime,
  occurred_at: isoTime.optional(),
  resource_kind: z.string().min(1).max(128)
    .refine(safeMetadataText, "must not contain control characters or known credential patterns"),
  resource_id: boundedText,
  native_state: z.string().min(1).max(256)
    .refine(safeMetadataText, "must not contain control characters or known credential patterns"),
  normalized_state: normalizedState,
  source_revision: sourceRevision.optional(),
  environment: environmentName.optional(),
  url: nullableHttpsUrl.optional(),
  payload_sha256: sha256,
}).strict();
export type ProviderObservationInput =
  z.infer<typeof providerObservationInputSchema>;

export const providerObservationSchema = z.object({
  sequence,
  observation_id: uuid,
  repository_id: uuid,
  provider,
  provider_event_id: z.string().min(1).max(256)
    .refine(safeMetadataText)
    .nullable(),
  action_id: uuid.nullable(),
  provenance: z.literal("device_observed"),
  observing_device_id: uuid,
  observing_session_id: uuid,
  actor_label: actorLabel.nullable(),
  observed_at: isoTime,
  occurred_at: isoTime.nullable(),
  normalized_state: normalizedState,
  source_revision: sourceRevision.nullable(),
  environment: environmentName.nullable(),
  resource_kind: z.string().min(1).max(128)
    .refine(safeMetadataText),
  resource_id: boundedText,
  native_state: z.string().min(1).max(256)
    .refine(safeMetadataText),
  url: nullableHttpsUrl,
  payload_sha256: sha256,
  received_at: isoTime,
}).strict();
export type ProviderObservation = z.infer<typeof providerObservationSchema>;

export const providerObservationResultSchema = z.object({
  schema: z.literal(RELAY_PROVIDER_OBSERVATION_RESULT_SCHEMA),
  deduplicated: z.boolean(),
  replayed: z.boolean(),
  receipt: relayMutationReceiptSchema,
  observation: providerObservationSchema,
}).strict();
export type ProviderObservationResult =
  z.infer<typeof providerObservationResultSchema>;

export const providerObservationPageSchema = z.object({
  schema: z.literal(RELAY_PROVIDER_OBSERVATION_PAGE_SCHEMA),
  repository_id: uuid,
  observations: z.array(providerObservationSchema).max(200),
  next_after: sequence,
  has_more: z.boolean(),
}).strict().superRefine((value, context) => {
  for (const [index, observation] of value.observations.entries()) {
    if (observation.repository_id !== value.repository_id) {
      context.addIssue({
        code: "custom",
        path: ["observations", index, "repository_id"],
        message: "observation repository must match its enclosing page",
      });
    }
  }
});
export type ProviderObservationPage =
  z.infer<typeof providerObservationPageSchema>;

export const npmReleaseReceiptSchema = z.object({
  schema: z.literal(NPM_RELEASE_RECEIPT_SCHEMA),
  package: z.object({
    key: z.string().min(1).max(100)
      .regex(/^[a-z0-9][a-z0-9._-]*$/),
    name: z.string().min(1).max(214)
      .regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/),
    version: z.string().min(1).max(256)
      .regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/),
    path: z.string().min(1).max(500)
      .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/),
  }).strict(),
  tag: boundedText,
  tag_commit: sourceRevision,
  source_revision: sourceRevision,
  artifact: z.object({
    filename: z.string().min(1).max(300)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/),
    size: z.number().int().positive().max(1024 * 1024 * 1024),
    sha1,
    sha256,
    integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/),
  }).strict(),
  prepared_at: isoTime,
  result: z.object({
    status: z.enum(["published", "already_published_exact"]),
    npm_tag: z.string().min(1).max(100)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    registry_observed_at: isoTime,
    registry_tarball: z.string().url().max(2000)
      .refine((value) => {
        const url = new URL(value);
        return url.protocol === "https:"
          && url.hostname === "registry.npmjs.org";
      }, "must be an npmjs registry tarball URL"),
  }).strict().optional(),
}).strict();
export type NpmReleaseReceipt = z.infer<typeof npmReleaseReceiptSchema>;

export const deployReceiptSchema = z.object({
  schema: z.literal(DEPLOY_RECEIPT_SCHEMA),
  outcome: z.enum(["succeeded", "failed_or_uncertain"]),
  completed_at: isoTime,
  exit_status: z.number().int().min(0).max(255),
  source_revision: sourceRevision,
  source_dirty: z.boolean(),
  release_head_snapshot: z.object({
    remote: z.string().min(1).max(100)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    branch: z.string().min(1).max(256)
      .refine((value) => !hasControlCharacter(value), "must not contain control characters"),
    revision: sourceRevision,
    observed_at: isoTime,
  }).strict(),
  source_overrides: z.object({
    dirty: z.boolean(),
    non_release_head: z.boolean(),
  }).strict(),
  external_mutation_started: z.boolean(),
  phases: z.object({
    migrations: z.string().min(1).max(100)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    preflight: z.string().min(1).max(100)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    api: z.string().min(1).max(100)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    frontends: z.string().min(1).max(100)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  }).strict(),
  verified_api_machines: z.number().int().nonnegative().max(10_000),
}).strict();
export type DeployReceipt = z.infer<typeof deployReceiptSchema>;

export interface ReceiptObservationContext {
  idempotency_key: string;
  session_id: string;
  actor_label?: string;
  action_id?: string;
  observed_at?: string;
}

export interface NpmReceiptObservationContext
  extends ReceiptObservationContext {
  profile: ProjectProfile;
}

export interface DeployObservationContext extends ReceiptObservationContext {
  profile: ProjectProfile;
  provider: "fly" | "cloudflare-pages" | "vercel";
  resource_kind: string;
  resource_id: string;
  environment: string;
  url?: string;
}

export interface NormalizedReceiptObservation {
  receipt_ref: RelayReceiptRef;
  observation: ProviderObservationInput;
}

export function normalizeNpmReleaseReceipt(
  input: unknown,
  context: NpmReceiptObservationContext,
): NormalizedReceiptObservation {
  const profile = validateProjectProfile(context.profile);
  const receipt = parseOrThrow(
    npmReleaseReceiptSchema,
    input,
    "npm_release_receipt_invalid",
    "npm release receipt does not match agenttool.npm-release/1",
  );
  assertNpmReleaseBinding(receipt, profile);
  const receiptHash = digest(receipt);
  const nativeState = receipt.result?.status ?? "prepared";
  const observation = providerObservationInputSchema.parse({
    schema: RELAY_PROVIDER_OBSERVATION_SCHEMA,
    idempotency_key: context.idempotency_key,
    session_id: context.session_id,
    actor_label: context.actor_label,
    action_id: context.action_id,
    provider: "npm",
    provider_event_id:
      `npm-release:${digest({
        package: receipt.package.name,
        version: receipt.package.version,
        artifact_sha256: receipt.artifact.sha256,
        state: nativeState,
      })}`,
    observed_at:
      context.observed_at
      ?? receipt.result?.registry_observed_at
      ?? receipt.prepared_at,
    occurred_at: receipt.result?.registry_observed_at ?? receipt.prepared_at,
    resource_kind: "package_version",
    resource_id: `${receipt.package.name}@${receipt.package.version}`,
    native_state: nativeState,
    normalized_state: receipt.result ? "succeeded" : "pending",
    source_revision: receipt.source_revision,
    environment: "npm",
    url: receipt.result?.registry_tarball,
    payload_sha256: receiptHash,
  });
  return {
    receipt_ref: { schema: NPM_RELEASE_RECEIPT_SCHEMA, sha256: receiptHash },
    observation,
  };
}

export function normalizeDeployReceipt(
  input: unknown,
  context: DeployObservationContext,
): NormalizedReceiptObservation {
  const profile = validateProjectProfile(context.profile);
  const receipt = parseOrThrow(
    deployReceiptSchema,
    input,
    "deploy_receipt_invalid",
    "deploy receipt does not match agenttool-deploy-receipt/v2",
  );
  assertDeploymentBinding({ ...context, profile });
  if (
    context.provider !== "fly"
    || receipt.outcome !== "succeeded"
    || receipt.phases.api !== "deployed_verified"
  ) {
    throw new CollabError(
      "deploy_receipt_surface_unproven",
      "The v2 deploy wrapper receipt proves only an explicitly deployed-and-verified Fly API phase; use direct provider evidence for skipped or unverified API phases and individual frontend surfaces",
    );
  }
  const receiptHash = digest(receipt);
  const observation = providerObservationInputSchema.parse({
    schema: RELAY_PROVIDER_OBSERVATION_SCHEMA,
    idempotency_key: context.idempotency_key,
    session_id: context.session_id,
    actor_label: context.actor_label,
    action_id: context.action_id,
    provider: context.provider,
    provider_event_id:
      `deploy-receipt:${digest({
        source_revision: receipt.source_revision,
        completed_at: receipt.completed_at,
        provider: context.provider,
        environment: context.environment,
        resource_id: context.resource_id,
      })}`,
    observed_at: context.observed_at ?? receipt.completed_at,
    occurred_at: receipt.completed_at,
    resource_kind: context.resource_kind,
    resource_id: context.resource_id,
    native_state: receipt.outcome,
    normalized_state:
      receipt.outcome === "succeeded" ? "succeeded" : "uncertain",
    source_revision: receipt.source_revision,
    environment: context.environment,
    url: context.url,
    payload_sha256: receiptHash,
  });
  return {
    receipt_ref: { schema: DEPLOY_RECEIPT_SCHEMA, sha256: receiptHash },
    observation,
  };
}

export function validateProviderObservationForProfile(
  input: unknown,
  profile: ProjectProfile,
): ProviderObservationInput {
  const validatedProfile = validateProjectProfile(profile);
  const observation = parseOrThrow(
    providerObservationInputSchema,
    input,
    "provider_observation_invalid",
    "Provider observation contains unsupported or unbounded fields",
  );
  if (observation.provider === "vercel") {
    if (!validatedProfile.vercel.enabled) {
      throw new CollabError(
        "vercel_not_bound",
        "Vercel observations require an explicit enabled project binding",
      );
    }
    if (
      observation.resource_kind === "project"
      && observation.resource_id !== validatedProfile.vercel.project_id
    ) {
      throw new CollabError(
        "vercel_project_mismatch",
        "Vercel project observation does not match the committed binding",
      );
    }
  }
  return observation;
}

export function requestSha256(value: unknown): string {
  return digest(value);
}

export function assertBoundedSafeJson(
  value: unknown,
  depth = 0,
  budget: { nodes: number } = { nodes: 0 },
): void {
  budget.nodes += 1;
  if (budget.nodes > 5_000) throw new Error("JSON value exceeds node bound");
  if (depth > 8) throw new Error("JSON value exceeds nesting bound");
  if (
    value === null
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
  ) return;
  if (typeof value === "string") {
    if (value.length > 8_000) throw new Error("JSON string exceeds length bound");
    if (knownCredentialPattern.test(value)) {
      throw new Error("JSON string contains a known credential pattern");
    }
    if (hasControlCharacter(value) && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
      throw new Error("JSON string contains unsafe control characters");
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 500) throw new Error("JSON array exceeds length bound");
    for (const child of value) assertBoundedSafeJson(child, depth + 1, budget);
    return;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 500) throw new Error("JSON object exceeds key bound");
    for (const [key, child] of entries) {
      if (key.length < 1 || key.length > 100 || hasControlCharacter(key)) {
        throw new Error("JSON object contains an invalid key");
      }
      assertBoundedSafeJson(child, depth + 1, budget);
    }
    return;
  }
  throw new Error("JSON value contains an unsupported type");
}

function assertDeploymentBinding(context: DeployObservationContext): void {
  const matching = Object.values(context.profile.deployments).some(
    (surface) =>
      surface.provider === context.provider
      && surface.environment === context.environment
      && surface.resource_id === context.resource_id,
  );
  if (!matching) {
    throw new CollabError(
      "deployment_binding_mismatch",
      "Deployment receipt provider/environment is not declared in the project profile",
    );
  }
  if (context.provider === "vercel") {
    if (!context.profile.vercel.enabled) {
      throw new CollabError(
        "vercel_not_bound",
        "Vercel receipt import requires an explicit enabled project binding",
      );
    }
    if (context.resource_id !== context.profile.vercel.project_id) {
      throw new CollabError(
        "vercel_project_mismatch",
        "Vercel receipt resource does not match the committed project binding",
      );
    }
  }
}

function assertNpmReleaseBinding(
  receipt: NpmReleaseReceipt,
  profile: ProjectProfile,
): void {
  const npm = profile.npm;
  const binding = npm?.packages[receipt.package.name];
  if (!npm || !binding) {
    throw new CollabError(
      "npm_package_binding_mismatch",
      "npm release receipt package is not declared in the project profile",
    );
  }
  if (
    receipt.package.key !== binding.release_key
    || receipt.package.path !== binding.path
  ) {
    throw new CollabError(
      "npm_package_binding_mismatch",
      "npm release receipt key or path does not match the declared package binding",
    );
  }
  if (receipt.tag !== `${binding.tag_prefix}${receipt.package.version}`) {
    throw new CollabError(
      "npm_tag_binding_mismatch",
      "npm release receipt tag does not match the profile package tag prefix and version",
    );
  }
}

function parseOrThrow<T>(
  schema: z.ZodType<T>,
  input: unknown,
  code: string,
  message: string,
): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new CollabError(code, message, {
    issues: result.error.issues.slice(0, 20).map((issue) => ({
      path: issue.path.join("."),
      message: issue.message.slice(0, 300),
    })),
  });
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function decodeUrlPath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}
