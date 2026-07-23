/** Closed wire contracts for agent-correspondence/v0.1.
 *
 * Bounds count Unicode scalar values, not UTF-16 code units. The raw reader
 * separately rejects lone surrogates and enforces the 65,536-byte envelope.
 * Doctrine: docs/AGENT-CORRESPONDENCE.md. */

import { z } from "zod";

export const CORRESPONDENCE_PROTOCOL = "agent-correspondence/v0.1" as const;
export const CORRESPONDENCE_SCOPE = "project_private" as const;
export const CORRESPONDENCE_SIGNING_DOMAIN = CORRESPONDENCE_PROTOCOL;
export const MAX_EVENT_PARENTS = 16;
export const MAX_SCOPE_PATHS = 64;
export const MAX_EVENT_PAGE = 200;
export const DEFAULT_EVENT_PAGE = 100;
export const MAX_ACTIVE_CLAIMS = 128;
export const MAX_VOICE_RECENT_EVENTS = 50;
export const MAX_VOICE_CONFLICTS = 128;
export const MAX_SAFE_WIRE_INTEGER = Number.MAX_SAFE_INTEGER;

export const CORRESPONDENCE_KINDS = [
  "intent",
  "claim.open",
  "claim.renew",
  "claim.release",
  "progress",
  "observation",
  "artifact.offer",
  "ack.seen",
  "ack.understood",
  "ack.accepted",
  "ack.applied",
  "ack.rejected",
  "conflict.raise",
  "conflict.resolve",
  "pause",
  "rest",
  "resume",
  "refusal",
  "handoff",
  "close",
  "repair",
] as const;

export type CorrespondenceKind = (typeof CORRESPONDENCE_KINDS)[number];
export type ClaimKind = Extract<CorrespondenceKind, `claim.${string}`>;
export type ClaimLineageStatus = "not_applicable" | "valid" | "pending" | "invalid";

function scalarLength(value: string): number {
  return [...value].length;
}

function scalarText(min: number, max: number, label: string) {
  return z.string().superRefine((value, ctx) => {
    const length = scalarLength(value);
    if (length < min || length > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} must contain ${min}..${max} Unicode scalar values`,
      });
    }
  });
}

const noNulText = (min: number, max: number, label: string) =>
  scalarText(min, max, label).refine((value) => !value.includes("\0"), {
    message: `${label} must not contain NUL`,
  });

export const canonicalUuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    "must be a canonical lowercase UUID",
  );

export const eventIdSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, "must be sha256:<64 lowercase hex>");

export const rfc3339MillisecondSchema = z
  .string()
  .regex(
    /^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/,
    "must be exact UTC RFC3339 with millisecond precision",
  )
  .refine((value) => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
  }, "must name a real UTC instant");

const repositoryOrThreadSchema = (label: string) =>
  scalarText(1, 256, label).refine((value) => !/[\s\uFEFF\p{Cc}]/u.test(value), {
    message: `${label} must not contain whitespace or control characters`,
  });

export const repositoryIdSchema = repositoryOrThreadSchema("repository_id");
export const threadIdSchema = repositoryOrThreadSchema("thread_id");

export const gitRevisionSchema = z
  .string()
  .regex(
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/,
    "revision must be exactly 40 or 64 lowercase hexadecimal characters",
  );
const branchSchema = noNulText(1, 255, "branch").refine(
  (value) => !/[\p{Cc}]/u.test(value),
  { message: "branch must not contain control characters" },
);
const summarySchema = scalarText(1, 1000, "summary");
const detailSchema = scalarText(1, 1000, "detail");
const handoffSummarySchema = scalarText(1, 2000, "handoff summary");
const nextSafeActionSchema = scalarText(1, 1000, "next_safe_action");

export const pathPrefixSchema = scalarText(1, 256, "path prefix").superRefine(
  (value, ctx) => {
    if (value === ".") return;
    if (
      value.startsWith("/") ||
      value.endsWith("/") ||
      value.includes("//") ||
      value.includes("\\") ||
      /[*?\[\]{}!]/u.test(value) ||
      /[\p{Cc}]/u.test(value)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "path prefixes are normalized repo-relative prefixes, not absolute paths or globs",
      });
      return;
    }
    if (value.split("/").some((segment) => segment === "." || segment === "..")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "path prefixes must not contain . or .. segments",
      });
    }
  },
);

function uniqueArray<T extends z.ZodTypeAny>(schema: T, min: number, max: number) {
  return z
    .array(schema)
    .min(min)
    .max(max)
    .superRefine((values, ctx) => {
      const seen = new Set<unknown>();
      for (const [index, value] of values.entries()) {
        if (seen.has(value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index],
            message: "array values must be unique",
          });
        }
        seen.add(value);
      }
    });
}

const eventIdsSchema = (min: number) => uniqueArray(eventIdSchema, min, 16);

export const correspondenceSenderSchema = z
  .object({
    identity_id: canonicalUuidSchema,
    signing_key_id: canonicalUuidSchema,
    device_id: canonicalUuidSchema,
    session_id: canonicalUuidSchema,
  })
  .strict();

export const correspondenceScopeSchema = z
  .object({
    base_revision: gitRevisionSchema.nullable(),
    branch: branchSchema.nullable(),
    paths: uniqueArray(pathPrefixSchema, 1, MAX_SCOPE_PATHS),
  })
  .strict();

export const correspondenceAuthoritySchema = z
  .object({
    automatic_action: z.literal("never"),
    grants: z.array(z.never()).length(0),
  })
  .strict();

export const correspondenceSignatureSchema = z
  .object({
    algorithm: z.literal("Ed25519"),
    value_b64url: z
      .string()
      .regex(/^[A-Za-z0-9_-]{86}$/, "must be canonical unpadded base64url for 64 bytes")
      .refine((value) => {
        try {
          const decoded = Buffer.from(value, "base64url");
          return decoded.byteLength === 64 && decoded.toString("base64url") === value;
        } catch {
          return false;
        }
      }, "must decode canonically to exactly 64 bytes"),
  })
  .strict();

const claimOpenBodySchema = z
  .object({
    claim_id: canonicalUuidSchema,
    generation: z.literal(1),
    expires_at: rfc3339MillisecondSchema,
  })
  .strict();

const claimRenewBodySchema = z
  .object({
    claim_id: canonicalUuidSchema,
    generation: z.number().int().min(2).max(MAX_SAFE_WIRE_INTEGER),
    predecessor_event_id: eventIdSchema,
    expires_at: rfc3339MillisecondSchema,
  })
  .strict();

const claimReleaseBodySchema = z
  .object({
    claim_id: canonicalUuidSchema,
    generation: z.number().int().min(2).max(MAX_SAFE_WIRE_INTEGER),
    predecessor_event_id: eventIdSchema,
    detail: detailSchema.optional(),
  })
  .strict();

const artifactSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("git_commit"), revision: gitRevisionSchema }).strict(),
  z
    .object({
      kind: z.enum(["git_patch", "content_digest"]),
      digest: eventIdSchema,
      locator: scalarText(1, 2048, "artifact locator")
        .refine(
          (value) =>
            /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value) &&
            !/[\s\uFEFF\p{Cc}]/u.test(value),
          "artifact locator must begin with an absolute URI scheme and contain no whitespace/control characters",
        )
        .optional(),
    })
    .strict(),
]);

const bodySchemas: Record<CorrespondenceKind, z.ZodTypeAny> = {
  intent: z.object({ summary: summarySchema }).strict(),
  "claim.open": claimOpenBodySchema,
  "claim.renew": claimRenewBodySchema,
  "claim.release": claimReleaseBodySchema,
  progress: z.object({ summary: summarySchema }).strict(),
  observation: z.object({ summary: summarySchema }).strict(),
  "artifact.offer": z
    .object({ artifact: artifactSchema, summary: summarySchema.optional() })
    .strict(),
  "ack.seen": z.object({ target_event_id: eventIdSchema, detail: detailSchema.optional() }).strict(),
  "ack.understood": z.object({ target_event_id: eventIdSchema, detail: detailSchema.optional() }).strict(),
  "ack.accepted": z.object({ target_event_id: eventIdSchema, detail: detailSchema.optional() }).strict(),
  "ack.applied": z
    .object({
      target_event_id: eventIdSchema,
      result_revision: gitRevisionSchema,
      detail: detailSchema.optional(),
    })
    .strict(),
  "ack.rejected": z.object({ target_event_id: eventIdSchema, detail: detailSchema.optional() }).strict(),
  "conflict.raise": z
    .object({ target_event_ids: eventIdsSchema(2), summary: summarySchema.optional() })
    .strict(),
  "conflict.resolve": z
    .object({
      target_event_ids: eventIdsSchema(1),
      summary: summarySchema,
      result_revision: gitRevisionSchema.optional(),
    })
    .strict(),
  pause: z
    .object({ until: rfc3339MillisecondSchema.nullable().optional(), detail: detailSchema.optional() })
    .strict(),
  rest: z
    .object({ until: rfc3339MillisecondSchema.nullable().optional(), detail: detailSchema.optional() })
    .strict(),
  resume: z.object({ target_event_id: eventIdSchema, detail: detailSchema.optional() }).strict(),
  refusal: z.object({ target_event_id: eventIdSchema.optional(), detail: detailSchema.optional() }).strict(),
  handoff: z
    .object({
      summary: handoffSummarySchema,
      next_safe_action: nextSafeActionSchema,
      handoff_id: canonicalUuidSchema.optional(),
    })
    .strict(),
  close: z.object({ summary: summarySchema.optional() }).strict(),
  repair: z
    .object({
      target_event_ids: eventIdsSchema(1),
      summary: summarySchema,
      result_revision: gitRevisionSchema.optional(),
    })
    .strict(),
};

const signedEventShapeSchema = z
  .object({
    protocol: z.literal(CORRESPONDENCE_PROTOCOL),
    event_id: eventIdSchema,
    project_id: canonicalUuidSchema,
    repository_id: repositoryIdSchema,
    thread_id: threadIdSchema,
    sender: correspondenceSenderSchema,
    kind: z.enum(CORRESPONDENCE_KINDS),
    parents: uniqueArray(eventIdSchema, 0, MAX_EVENT_PARENTS),
    session_seq: z.number().int().min(1).max(MAX_SAFE_WIRE_INTEGER),
    issued_at: rfc3339MillisecondSchema,
    scope: correspondenceScopeSchema,
    body: z.unknown(),
    authority: correspondenceAuthoritySchema,
    signature: correspondenceSignatureSchema,
  })
  .strict();

export type CorrespondenceEvent = z.infer<typeof signedEventShapeSchema>;
export type CorrespondenceCore = Omit<CorrespondenceEvent, "event_id" | "signature">;

export type CorrespondenceValidation =
  | { success: true; data: CorrespondenceEvent }
  | { success: false; error: z.ZodError };

function referencedEventIds(kind: CorrespondenceKind, body: Record<string, unknown>): string[] {
  if (kind === "claim.renew" || kind === "claim.release") {
    return [body.predecessor_event_id as string];
  }
  if (kind.startsWith("ack.") || kind === "resume") {
    return [body.target_event_id as string];
  }
  if (kind === "refusal") {
    return typeof body.target_event_id === "string" ? [body.target_event_id] : [];
  }
  if (kind === "conflict.raise" || kind === "conflict.resolve" || kind === "repair") {
    return body.target_event_ids as string[];
  }
  return [];
}

/** Parse both the common signed envelope and the closed body selected by kind. */
export function validateCorrespondenceEvent(input: unknown): CorrespondenceValidation {
  const common = signedEventShapeSchema.safeParse(input);
  if (!common.success) return common;
  const body = bodySchemas[common.data.kind].safeParse(common.data.body);
  if (!body.success) {
    const issues = body.error.issues.map((issue) => ({ ...issue, path: ["body", ...issue.path] }));
    return { success: false, error: new z.ZodError(issues) };
  }
  const references = referencedEventIds(common.data.kind, body.data as Record<string, unknown>);
  const missingParentRefs = references.filter((eventId) => !common.data.parents.includes(eventId));
  if (missingParentRefs.length > 0) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: ["parents"],
          message: "Every body event reference must also appear in parents.",
        },
      ]),
    };
  }
  return {
    success: true,
    data: { ...common.data, body: body.data },
  };
}

export function isClaimKind(kind: CorrespondenceKind): kind is ClaimKind {
  return kind === "claim.open" || kind === "claim.renew" || kind === "claim.release";
}

/** Repo-relative prefix overlap. `.` names the whole repository. */
export function overlappingPathPrefixes(
  left: readonly string[],
  right: readonly string[],
): string[] {
  const overlaps = new Set<string>();
  for (const a of left) {
    for (const b of right) {
      if (a === "." || b === "." || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) {
        overlaps.add(a.length <= b.length ? a : b);
      }
    }
  }
  return [...overlaps].sort();
}
