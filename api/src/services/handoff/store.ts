/** Project-private working-set handoffs, backed by append-only chronicle notes.
 *
 * A handoff is deliberately not a new identity, permission, or message
 * primitive. It is a validated `chronicle.type = "note"` with a versioned
 * `metadata.handoff` envelope. New snapshots supersede prior snapshots through
 * `parent_chronicle_id`; the old record remains readable in the chronicle.
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
export const MAX_HANDOFF_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_HANDOFF_SERIALIZED_BYTES = 50_000;
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
  })
  .strict();

export type HandoffInput = z.infer<typeof handoffInputSchema>;

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
  occurred_at: string;
  created_at: string;
  /** This is an attributed declaration inside a project bearer boundary,
   * not cryptographic proof that an identity/facet personally authored it. */
  provenance: "self_declared_project_bearer";
};

export type HandoffState = "absent" | "current" | "stale";

export interface ProjectHandoffSurface {
  active: HandoffRecord[];
  stale: HandoffRecord[];
}

function handoffEnvelope(metadata: unknown): StoredHandoff | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const envelope = metadata as Record<string, unknown>;
  if (envelope.kind !== HANDOFF_KIND) return null;
  const parsed = storedHandoffSchema.safeParse(envelope.handoff);
  return parsed.success ? parsed.data : null;
}

/** Handoff records have their own wake section. Exclude every reserved
 * envelope (including malformed legacy data) from generic chronicle previews
 * so peer-authored text cannot reach Markdown through an unsanitized second
 * path. Full chronicle history remains readable through /v1/chronicle. */
export function isHandoffChronicleMetadata(metadata: unknown): boolean {
  return !!metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).kind === HANDOFF_KIND;
}

/** Parse a chronicle row into a handoff. Malformed or legacy handoff metadata
 * stays a normal chronicle note and never enters the working-set surface. */
export function handoffFromChronicleRow(row: ChronicleHandoffRow): HandoffRecord | null {
  if (!row.agentId) return null;
  const handoff = handoffEnvelope(row.metadata);
  if (!handoff) return null;
  return {
    ...handoff,
    id: row.id,
    project_id: row.projectId,
    author_agent_id: row.agentId,
    title: row.title,
    body: row.body,
    supersedes_handoff_id: row.parentChronicleId,
    occurred_at: row.occurredAt.toISOString(),
    created_at: row.createdAt.toISOString(),
    provenance: "self_declared_project_bearer",
  };
}

function isValidAt(record: HandoffRecord, now: Date): boolean {
  return new Date(record.valid_until).getTime() > now.getTime();
}

/** Resolve the current snapshot per author. A newer snapshot is authoritative
 * even when it is stale or complete: never silently fall back to an older,
 * more convenient handoff. */
export function resolveLatestHandoffs(records: HandoffRecord[]): HandoffRecord[] {
  const latestByAuthor = new Map<string, HandoffRecord>();
  for (const record of records) {
    const previous = latestByAuthor.get(record.author_agent_id);
    if (!previous || compareHandoffRecency(record, previous) > 0) {
      latestByAuthor.set(record.author_agent_id, record);
    }
  }
  return [...latestByAuthor.values()].sort((a, b) => compareHandoffRecency(b, a));
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
): ProjectHandoffSurface {
  const latest = resolveLatestHandoffs(records);
  return {
    active: latest.filter(
      (record) =>
        record.status !== "complete" &&
        isValidAt(record, now),
    ),
    stale: latest.filter(
      (record) => record.status !== "complete" && !isValidAt(record, now),
    ),
  };
}

/** ETag contribution for a wake handoff fragment. Expiry changes active to
 * stale without a mutation, so wake_version alone cannot safely describe the
 * response. Hash only IDs/status/expiry; working-set text never enters an
 * HTTP validator. */
export function handoffWakeEtagTag(
  handoffs: ProjectHandoffSurface | undefined,
): string | null {
  if (!handoffs || (handoffs.active.length === 0 && handoffs.stale.length === 0)) {
    return null;
  }
  const state = [
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
 * maximum 30-day validity, so the recent 31-day window is sufficient. The
 * database reduces to one newest snapshot per active author *before* rows
 * reach the process; a noisy author cannot crowd other working sets out. */
export async function composeActiveHandoffs(projectId: string): Promise<ProjectHandoffSurface> {
  const now = new Date();
  const since = new Date(now.getTime() - PROJECT_HANDOFF_QUERY_WINDOW_MS);
  const rows = await db
    .selectDistinctOn([chronicle.agentId], rowSelection())
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
    .orderBy(
      chronicle.agentId,
      desc(chronicle.occurredAt),
      desc(chronicle.createdAt),
      desc(chronicle.id),
    );
  const records = rows
    .map(handoffFromChronicleRow)
    .filter((record): record is HandoffRecord => record !== null);
  return composeProjectHandoffSurface(records, now);
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
