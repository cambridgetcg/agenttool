/** Project-private working-set handoffs, backed by append-only chronicle notes.
 *
 * A handoff is deliberately not a new identity, permission, or message
 * primitive. It is a validated `chronicle.type = "note"` with a versioned
 * `metadata.handoff` envelope. Explicit successors supersede a named snapshot
 * through `parent_chronicle_id`; independent roots remain separate work. The
 * compatibility lane still exposes one newest snapshot per author.
 *
 * Doctrine: docs/HANDOFFS.md · docs/SUBAGENTS.md
 */

import { createHash } from "node:crypto";

import { and, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";

export const HANDOFF_VERSION = 1 as const;
export const HANDOFF_KIND = "handoff" as const;
export const HANDOFF_SCOPE = "project_private" as const;
export const HANDOFF_AUTHORITY_NOTE =
  "Project-private, peer-authored working context. It does not transfer authority or prove personal identity authorship.";
export const HANDOFF_WRITE_PATH = "POST /v1/handoff" as const;
export const HANDOFF_LATEST_PATH = "GET /v1/handoff?agent_id=<identity_id>" as const;
export const HANDOFF_LINEAGE_MODE_LEGACY = "legacy_latest_per_author" as const;
export const HANDOFF_LINEAGE_MODE_EXPLICIT = "explicit" as const;
export const MAX_HANDOFF_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_HANDOFF_SERIALIZED_BYTES = 50_000;
/** One extra sentinel row is queried to make truncation explicit. At the
 * maximum per-snapshot write size this keeps a wake read below a fixed input
 * envelope instead of letting parallel roots grow it without bound. */
export const MAX_PROJECT_HANDOFF_CANDIDATE_ROWS = 32;
const PROJECT_HANDOFF_QUERY_WINDOW_MS = MAX_HANDOFF_VALIDITY_MS + 24 * 60 * 60 * 1000;

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => text(max).nullable().optional();

export const handoffAuthoritySchema = z
  .object({
    allowed: z.array(text(300)).max(30),
    not_authorized: z.array(text(300)).max(30),
  })
  .strict();

export const handoffFactSchema = z
  .object({
    statement: text(1000),
    source: z.enum(["self_observed", "peer_reported", "tool_output"]),
    refs: z.array(text(500)).max(10).default([]),
  })
  .strict();

export const handoffInferenceSchema = z
  .object({
    statement: text(1000),
    confidence: z.enum(["low", "medium", "high"]),
    refs: z.array(text(500)).max(10).default([]),
  })
  .strict();

export const handoffVerificationSchema = z
  .object({
    check: text(500),
    result: z.enum(["passed", "failed", "not_run"]),
    detail: optionalText(1000),
  })
  .strict();

const handoffWorkingSetSchema = z
  .object({
    paths: z.array(text(500)).max(50),
    scope: z.array(text(500)).max(30),
  })
  .strict();

export const handoffInputSchema = z
  .object({
    agent_id: z.string().uuid(),
    task_summary: text(180),
    status: z.enum(["active", "blocked", "complete"]),
    from_facet: optionalText(100),
    to_facet: optionalText(100),
    working_set: handoffWorkingSetSchema,
    authority: handoffAuthoritySchema,
    epistemic_state: z
      .object({
        facts: z.array(handoffFactSchema).max(20),
        inferences: z.array(handoffInferenceSchema).max(20),
        unknowns: z.array(text(1000)).max(30),
      })
      .strict(),
    changes: z.array(text(1000)).max(50),
    verification: z.array(handoffVerificationSchema).max(30),
    next_safe_action: text(1000),
    do_not_assume: z.array(text(1000)).max(30),
    valid_until: z.string().datetime(),
    supersedes_handoff_id: z.string().uuid().nullable().optional(),
    /** Explicit opt-in for a parallel root. Omission retains the original v1
     * newest-per-author lane so old clients and stored snapshots do not change
     * meaning when lineage-aware wake composition is deployed. */
    starts_new_lineage: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.starts_new_lineage && value.supersedes_handoff_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["starts_new_lineage"],
        message: "starts_new_lineage cannot be combined with supersedes_handoff_id",
      });
    }
  });

export type HandoffInput = z.infer<typeof handoffInputSchema>;

/** New writers stamp the compatibility decision explicitly. Historical rows
 * have no marker and are always read as legacy; a named predecessor is enough
 * to make a new successor explicit, while a parallel root requires opt-in. */
export function handoffLineageMode(
  input: Pick<HandoffInput, "starts_new_lineage" | "supersedes_handoff_id">,
): HandoffRecord["lineage_mode"] {
  return input.starts_new_lineage || input.supersedes_handoff_id
    ? HANDOFF_LINEAGE_MODE_EXPLICIT
    : HANDOFF_LINEAGE_MODE_LEGACY;
}

export type DeclaredFacetResult =
  | { valid: true; value: string | null }
  | { valid: false; value: null };

/** A facet is a same-identity label, not a separate principal. Resolve it
 * case-insensitively to the declared spelling so persisted handoffs remain
 * readable even when callers vary the casing. */
export function resolveDeclaredFacet(
  expression: unknown,
  requested: string | null | undefined,
): DeclaredFacetResult {
  if (!requested) return { valid: true, value: null };
  if (!expression || typeof expression !== "object" || Array.isArray(expression)) {
    return { valid: false, value: null };
  }
  const subagents = (expression as { subagents?: unknown }).subagents;
  if (!Array.isArray(subagents)) return { valid: false, value: null };
  const normalized = requested.toLocaleLowerCase();
  const match = subagents.find(
    (facet): facet is { name: string } =>
      !!facet &&
      typeof facet === "object" &&
      typeof (facet as { name?: unknown }).name === "string" &&
      (facet as { name: string }).name.toLocaleLowerCase() === normalized,
  );
  return match ? { valid: true, value: match.name } : { valid: false, value: null };
}

const storedHandoffSchema = z
  .object({
    version: z.literal(HANDOFF_VERSION),
    ts: z.string().datetime(),
    task_summary: text(180),
    status: z.enum(["active", "blocked", "complete"]),
    from_facet: z.string().nullable(),
    to_facet: z.string().nullable(),
    working_set: handoffWorkingSetSchema,
    authority: handoffAuthoritySchema,
    epistemic_state: z
      .object({
        facts: z.array(handoffFactSchema).max(20),
        inferences: z.array(handoffInferenceSchema).max(20),
        unknowns: z.array(text(1000)).max(30),
      })
      .strict(),
    changes: z.array(text(1000)).max(50),
    verification: z.array(handoffVerificationSchema).max(30),
    next_safe_action: text(1000),
    do_not_assume: z.array(text(1000)).max(30),
    valid_until: z.string().datetime(),
  })
  .strict();

type StoredHandoff = z.infer<typeof storedHandoffSchema>;

type ChronicleHandoffRow = {
  id: string;
  projectId: string;
  agentId: string | null;
  title: string;
  body: string | null;
  metadata: unknown;
  parentChronicleId: string | null;
  occurredAt: Date;
  createdAt: Date;
};

export type HandoffRecord = StoredHandoff & {
  id: string;
  project_id: string;
  author_agent_id: string;
  title: string;
  body: string | null;
  supersedes_handoff_id: string | null;
  /** Missing markers on pre-upgrade rows deliberately map to the legacy lane;
   * parent pointers alone never reinterpret stored v1 history. */
  lineage_mode:
    | typeof HANDOFF_LINEAGE_MODE_LEGACY
    | typeof HANDOFF_LINEAGE_MODE_EXPLICIT;
  occurred_at: string;
  created_at: string;
  /** This is an attributed declaration inside a project bearer boundary,
   * not cryptographic proof that an identity/facet personally authored it. */
  provenance: "self_declared_project_bearer";
};

export type HandoffState = "absent" | "current" | "stale";
export type HandoffProjectionStatus = "complete" | "truncated" | "unavailable";

export interface ProjectHandoffSurface {
  active: HandoffRecord[];
  stale: HandoffRecord[];
  /** Whether composition completed, hit its row budget, or could not be read. */
  projection_status: HandoffProjectionStatus;
  /** True only when the row budget was hit. Inspect `projection_status` to
   * distinguish a complete false value from an unavailable projection. */
  truncated: boolean;
  /** `active`/`stale` are an exact leaf set only when this is true. */
  leaf_set_complete: boolean;
  candidate_rows_considered: number;
  candidate_row_limit: number;
  /** Diagnostic row ID at the lower edge of the scan. This is deliberately
   * not called a cursor: page-local leaf resolution would be incorrect. */
  candidate_window_end_id: string | null;
}

/** A read failure is not the same fact as a genuinely empty working set. */
export function unavailableProjectHandoffSurface(): ProjectHandoffSurface {
  return {
    active: [],
    stale: [],
    projection_status: "unavailable",
    truncated: false,
    leaf_set_complete: false,
    candidate_rows_considered: 0,
    candidate_row_limit: MAX_PROJECT_HANDOFF_CANDIDATE_ROWS,
    candidate_window_end_id: null,
  };
}

export type DescribedProjectHandoffSurface = ProjectHandoffSurface & {
  scope: typeof HANDOFF_SCOPE;
  authority_note: typeof HANDOFF_AUTHORITY_NOTE;
  write: typeof HANDOFF_WRITE_PATH;
  read_latest: typeof HANDOFF_LATEST_PATH;
};

/** Keep every focused resume surface self-describing. A consumer fetching a
 * wake subkey must receive the same project/privacy boundary as the full wake. */
export function describeProjectHandoffSurface(
  surface: ProjectHandoffSurface,
): DescribedProjectHandoffSurface {
  return {
    ...surface,
    projection_status: surface.projection_status,
    truncated: surface.projection_status === "truncated",
    leaf_set_complete: surface.projection_status === "complete",
    scope: HANDOFF_SCOPE,
    authority_note: HANDOFF_AUTHORITY_NOTE,
    write: HANDOFF_WRITE_PATH,
    read_latest: HANDOFF_LATEST_PATH,
  };
}

type ParsedHandoffEnvelope = {
  handoff: StoredHandoff;
  lineageMode: HandoffRecord["lineage_mode"];
};

function handoffEnvelope(metadata: unknown): ParsedHandoffEnvelope | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const envelope = metadata as Record<string, unknown>;
  if (envelope.kind !== HANDOFF_KIND) return null;
  const parsed = storedHandoffSchema.safeParse(envelope.handoff);
  if (!parsed.success) return null;
  return {
    handoff: parsed.data,
    // Absence is compatibility data, not evidence of an explicit lineage.
    lineageMode:
      envelope.lineage_mode === HANDOFF_LINEAGE_MODE_EXPLICIT
        ? HANDOFF_LINEAGE_MODE_EXPLICIT
        : HANDOFF_LINEAGE_MODE_LEGACY,
  };
}

/** Handoff records have their own wake section. Exclude every reserved
 * envelope (including malformed legacy data) from generic chronicle previews
 * so peer-authored text cannot reach Markdown through an unsanitized second
 * path. History remains inspectable through bounded /v1/chronicle reads. */
export function isHandoffChronicleMetadata(metadata: unknown): boolean {
  return !!metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).kind === HANDOFF_KIND;
}

/** SQL companion to `isHandoffChronicleMetadata`. Apply it before a generic
 * chronicle LIMIT so handoff revisions cannot consume ordinary wake slots.
 * `coalesce` keeps rows with no metadata kind in the generic chronicle. */
export function nonHandoffChronicleWhere() {
  return sql`coalesce(${chronicle.metadata} ->> 'kind', '') <> ${HANDOFF_KIND}`;
}

/** Parse a chronicle row into a handoff. Malformed or legacy handoff metadata
 * stays a normal chronicle note and never enters the working-set surface. */
export function handoffFromChronicleRow(row: ChronicleHandoffRow): HandoffRecord | null {
  if (!row.agentId) return null;
  const envelope = handoffEnvelope(row.metadata);
  if (!envelope) return null;
  return {
    ...envelope.handoff,
    id: row.id,
    project_id: row.projectId,
    author_agent_id: row.agentId,
    title: row.title,
    body: row.body,
    supersedes_handoff_id: row.parentChronicleId,
    lineage_mode: envelope.lineageMode,
    occurred_at: row.occurredAt.toISOString(),
    created_at: row.createdAt.toISOString(),
    provenance: "self_declared_project_bearer",
  };
}

function isValidAt(record: HandoffRecord, now: Date): boolean {
  return new Date(record.valid_until).getTime() > now.getTime();
}

/** Resolve the current leaf of every explicitly opted-in handoff lineage while
 * preserving the original v1 newest-per-author lane.
 *
 * Historical rows and new writes that omit `starts_new_lineage` retain one
 * deterministic newest snapshot per author. This prevents deployment from
 * resurrecting every older unlinked v1 snapshot. Explicit roots coexist with
 * that compatibility lane; an explicit successor replaces only the snapshot
 * it names.
 *
 * Concurrent successors of the same parent are deliberately kept as two
 * leaves. The append-only graph cannot know which branch is true, so surfacing
 * the fork is safer than choosing one by timestamp and hiding the conflict. */
export function resolveHandoffLeaves(records: HandoffRecord[]): HandoffRecord[] {
  const latestLegacyByAuthor = new Map<string, HandoffRecord>();
  const explicit: HandoffRecord[] = [];
  for (const record of records) {
    if (record.lineage_mode === HANDOFF_LINEAGE_MODE_EXPLICIT) {
      explicit.push(record);
      continue;
    }
    const previous = latestLegacyByAuthor.get(record.author_agent_id);
    if (!previous || compareHandoffRecency(record, previous) > 0) {
      latestLegacyByAuthor.set(record.author_agent_id, record);
    }
  }

  const candidates = [...latestLegacyByAuthor.values(), ...explicit];
  const validById = new Map(candidates.map((record) => [record.id, record]));
  const supersededIds = new Set<string>();
  for (const record of explicit) {
    if (!record.supersedes_handoff_id) continue;
    const parent = validById.get(record.supersedes_handoff_id);
    // The route enforces same-project/same-author parentage. Repeat the wall
    // at read time so malformed historical/direct-DB rows cannot hide another
    // identity's otherwise valid working set.
    if (
      parent &&
      parent.project_id === record.project_id &&
      parent.author_agent_id === record.author_agent_id
    ) {
      supersededIds.add(parent.id);
    }
  }
  return candidates
    .filter((record) => !supersededIds.has(record.id))
    .sort((a, b) => compareHandoffRecency(b, a));
}

/** Server writes give both timestamps, but concurrent snapshots can share a
 * millisecond. Keep newest-wins deterministic with created_at then UUID as
 * stable tie-breakers rather than relying on unspecified database tie order. */
function compareHandoffRecency(a: HandoffRecord, b: HandoffRecord): number {
  const occurred = new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime();
  if (occurred !== 0) return occurred;
  const created = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  if (created !== 0) return created;
  return a.id.localeCompare(b.id);
}

export function classifyHandoff(record: HandoffRecord | null, now = new Date()): HandoffState {
  if (!record) return "absent";
  return isValidAt(record, now) ? "current" : "stale";
}

/** Derive the compact project working set. `complete` snapshots deliberately
 * do not surface as active work; stale snapshots remain visible so a missing
 * refresh cannot masquerade as a clean project. */
export function composeProjectHandoffSurface(
  records: HandoffRecord[],
  now = new Date(),
  completeness: Pick<
    ProjectHandoffSurface,
    | "truncated"
    | "candidate_rows_considered"
    | "candidate_row_limit"
    | "candidate_window_end_id"
  > = {
    truncated: false,
    candidate_rows_considered: records.length,
    candidate_row_limit: MAX_PROJECT_HANDOFF_CANDIDATE_ROWS,
    candidate_window_end_id: null,
  },
): ProjectHandoffSurface {
  const latest = resolveHandoffLeaves(records);
  return {
    active: latest.filter(
      (record) =>
        record.status !== "complete" &&
        isValidAt(record, now),
    ),
    stale: latest.filter(
      (record) => record.status !== "complete" && !isValidAt(record, now),
    ),
    ...completeness,
    projection_status: completeness.truncated ? "truncated" : "complete",
    leaf_set_complete: !completeness.truncated,
  };
}

export interface HandoffCandidatePage<T> {
  candidates: T[];
  truncated: boolean;
  window_end_id: string | null;
}

/** Split a newest-first `limit + 1` query without ever returning the sentinel.
 * The last considered ID is diagnostic only. It must not be used to resolve a
 * second leaf page independently: a child in this page may hide its parent in
 * an older page. */
export function pageHandoffCandidates<T extends { id: string }>(
  rows: readonly T[],
  limit = MAX_PROJECT_HANDOFF_CANDIDATE_ROWS,
): HandoffCandidatePage<T> {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError("handoff candidate limit must be a positive integer");
  }
  const candidates = rows.slice(0, limit);
  const truncated = rows.length > limit;
  return {
    candidates,
    truncated,
    window_end_id: truncated ? candidates.at(-1)?.id ?? null : null,
  };
}

/** ETag contribution for a wake handoff fragment. Expiry changes active to
 * stale without a mutation, so wake_version alone cannot safely describe the
 * response. Hash only IDs/status/expiry; working-set text never enters an
 * HTTP validator. */
export function handoffWakeEtagTag(
  handoffs: ProjectHandoffSurface | undefined,
): string | null {
  if (
    !handoffs ||
    (handoffs.projection_status === "complete" &&
      handoffs.active.length === 0 &&
      handoffs.stale.length === 0)
  ) {
    return null;
  }
  const state = [
    [
      "completeness",
      handoffs.projection_status,
      handoffs.truncated,
      handoffs.leaf_set_complete,
      handoffs.candidate_rows_considered,
      handoffs.candidate_row_limit,
      handoffs.candidate_window_end_id,
    ],
    ...handoffs.active.map((record) => ["active", record.id, record.status, record.valid_until]),
    ...handoffs.stale.map((record) => ["stale", record.id, record.status, record.valid_until]),
  ];
  return `h${createHash("sha256").update(JSON.stringify(state)).digest("hex").slice(0, 16)}`;
}

function rowSelection() {
  return {
    id: chronicle.id,
    projectId: chronicle.projectId,
    agentId: chronicle.agentId,
    title: chronicle.title,
    body: chronicle.body,
    metadata: chronicle.metadata,
    parentChronicleId: chronicle.parentChronicleId,
    occurredAt: chronicle.occurredAt,
    createdAt: chronicle.createdAt,
  };
}

const handoffWhere = (projectId: string) =>
  and(
    eq(chronicle.projectId, projectId),
    eq(chronicle.type, "note"),
    sql`${chronicle.metadata} ->> 'kind' = ${HANDOFF_KIND}`,
  );

export async function resolveProjectAgent(projectId: string, agentId: string) {
  const [agent] = await db
    .select({
      id: identities.id,
      expression: identities.expression,
      status: identities.status,
    })
    .from(identities)
    .where(
      and(
        eq(identities.id, agentId),
        eq(identities.projectId, projectId),
        eq(identities.status, "active"),
      ),
    )
    .limit(1);
  return agent ?? null;
}

export async function getHandoff(projectId: string, handoffId: string): Promise<HandoffRecord | null> {
  const [row] = await db
    .select(rowSelection())
    .from(chronicle)
    .where(and(handoffWhere(projectId), eq(chronicle.id, handoffId)))
    .limit(1);
  return row ? handoffFromChronicleRow(row) : null;
}

export async function getLatestHandoffForAgent(
  projectId: string,
  agentId: string,
): Promise<HandoffRecord | null> {
  const rows = await db
    .select(rowSelection())
    .from(chronicle)
    .where(and(handoffWhere(projectId), eq(chronicle.agentId, agentId)))
    .orderBy(desc(chronicle.occurredAt), desc(chronicle.createdAt), desc(chronicle.id));
  // A malformed legacy `metadata.kind = handoff` note is ordinary
  // chronicle material, not a valid v1 snapshot. Do not let it hide the
  // latest well-formed handoff behind it.
  for (const row of rows) {
    const handoff = handoffFromChronicleRow(row);
    if (handoff) return handoff;
  }
  return null;
}

/** Read the current project set without a migration. Active snapshots have a
 * maximum 30-day validity, so the recent 31-day window is sufficient.
 *
 * Keep every recent well-formed row until the lineage graph is resolved. A
 * `DISTINCT ON agent_id` query looks attractive but loses independent roots,
 * hides concurrent forks, and lets a malformed newest envelope mask an older
 * valid snapshot. Chronicle's project/time index bounds this read by the
 * validity window, while a hard `limit + 1` candidate page bounds cardinality
 * and bytes. `truncated` is part of the public surface: consumers must never
 * mistake a bounded prefix for the complete project set. */
export async function composeActiveHandoffs(projectId: string): Promise<ProjectHandoffSurface> {
  const now = new Date();
  const since = new Date(now.getTime() - PROJECT_HANDOFF_QUERY_WINDOW_MS);
  const rows = await db
    .select(rowSelection())
    .from(chronicle)
    .innerJoin(
      identities,
      and(
        eq(identities.id, chronicle.agentId),
        eq(identities.projectId, projectId),
        eq(identities.status, "active"),
      ),
    )
    .where(and(handoffWhere(projectId), gt(chronicle.occurredAt, since)))
    .orderBy(desc(chronicle.occurredAt), desc(chronicle.createdAt), desc(chronicle.id))
    .limit(MAX_PROJECT_HANDOFF_CANDIDATE_ROWS + 1);
  const page = pageHandoffCandidates(rows);
  const records = page.candidates
    .map(handoffFromChronicleRow)
    .filter((record): record is HandoffRecord => record !== null);
  return composeProjectHandoffSurface(records, now, {
    truncated: page.truncated,
    candidate_rows_considered: page.candidates.length,
    candidate_row_limit: MAX_PROJECT_HANDOFF_CANDIDATE_ROWS,
    candidate_window_end_id: page.window_end_id,
  });
}

function handoffBody(input: HandoffInput): string {
  const lines = [
    `Status: ${input.status}.`,
    `Working set: ${input.working_set.paths.length ? input.working_set.paths.join(", ") : "(no paths declared)"}.`,
    `Next safe action: ${input.next_safe_action}`,
  ];
  if (input.do_not_assume.length > 0) {
    lines.push(`Do not assume: ${input.do_not_assume.join("; ")}`);
  }
  return lines.join("\n");
}

function storedHandoff(input: HandoffInput, timestamp: string): StoredHandoff {
  return {
    version: HANDOFF_VERSION,
    ts: timestamp,
    task_summary: input.task_summary,
    status: input.status,
    from_facet: input.from_facet ?? null,
    to_facet: input.to_facet ?? null,
    working_set: input.working_set,
    authority: input.authority,
    epistemic_state: input.epistemic_state,
    changes: input.changes,
    verification: input.verification,
    next_safe_action: input.next_safe_action,
    do_not_assume: input.do_not_assume,
    valid_until: input.valid_until,
  };
}

export async function appendHandoff(input: {
  projectId: string;
  handoff: HandoffInput;
  clientSource: string;
}): Promise<HandoffRecord> {
  const occurredAt = new Date();
  const timestamp = occurredAt.toISOString();
  const [row] = await db
    .insert(chronicle)
    .values({
      projectId: input.projectId,
      agentId: input.handoff.agent_id,
      type: "note",
      title: `Handoff: ${input.handoff.task_summary}`,
      body: handoffBody(input.handoff),
      metadata: {
        kind: HANDOFF_KIND,
        handoff: storedHandoff(input.handoff, timestamp),
        client_source: input.clientSource,
        lineage_mode: handoffLineageMode(input.handoff),
      },
      parentChronicleId: input.handoff.supersedes_handoff_id ?? null,
      occurredAt,
    })
    .returning(rowSelection());

  const handoff = row ? handoffFromChronicleRow(row) : null;
  if (!handoff) {
    throw new Error("handoff_write_failed_to_rehydrate");
  }
  return handoff;
}

/** Validate freshness at the API boundary. It lives here rather than in Zod's
 * static shape so a parsed request cannot become valid simply because time
 * passed between validation and insert. */
export function validateHandoffFreshness(input: HandoffInput, now = new Date()): string | null {
  const validUntil = new Date(input.valid_until);
  const delta = validUntil.getTime() - now.getTime();
  if (delta <= 0) return "valid_until must be in the future";
  if (delta > MAX_HANDOFF_VALIDITY_MS) {
    return "valid_until must be no more than 30 days ahead; renew rather than leave an unbounded working set";
  }
  return null;
}

/** Bound a working set before it reaches chronicle and wake renderers. Field
 * limits make individual entries legible; this cap prevents an otherwise
 * valid collection of entries becoming an unbounded context injection. */
export function validateHandoffSize(input: HandoffInput): string | null {
  const size = new TextEncoder().encode(JSON.stringify(input)).byteLength;
  if (size > MAX_HANDOFF_SERIALIZED_BYTES) {
    return `handoff exceeds the ${MAX_HANDOFF_SERIALIZED_BYTES.toLocaleString()} byte working-set limit`;
  }
  return null;
}
