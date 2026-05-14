/** Recent-activity composer — the operational rear-view across primitives.
 *
 *  Reads existing data; writes none. Each "source" below produces a small
 *  slice of events; we merge by `at` desc and cap at `limit`. The result is
 *  a chronologically-ordered stream callers can scan to answer *what just
 *  happened on this project*.
 *
 *  Doctrine: docs/ACTIVITY.md. Companion (not replacement) to:
 *    - chronicle (append-only ceremony log; manual + auto on welcome/usage)
 *    - pulse     (derived per-agent rhythm — counts and rates, not events)
 *    - dashboard (snapshot rollup; not chronological)
 *
 *  No new schema. The shape is stable; future sources land as one entry
 *  in `runSources()` + one `kind` value documented in docs/ACTIVITY.md. */

import { and, desc, eq, gte } from "drizzle-orm";

import { isClientSource, type ClientSource } from "../../auth/client-source";
import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";
import { memories } from "../../db/schema/memory";
import { strands, thoughts } from "../../db/schema/strand";
import { traces } from "../../db/schema/trace";

export type ActivityKind =
  | "strand.thought"
  | "memory.write"
  | "chronicle.entry"
  | "trace.recorded"
  | "identity.born";

export interface ActivityEvent {
  /** ISO-8601, sortable. */
  at: string;
  /** Source primitive that produced this event. */
  kind: ActivityKind;
  /** Origin signal — which surface the write came through, read from the
   *  row's `metadata.client_source` (stamped by the auth middleware via
   *  the write path). `null` for two kinds by design:
   *    - `strand.thought`  — the thoughts table has no metadata column
   *    - `identity.born`   — births happen pre-auth, no middleware runs
   *  and for any row written before the origin-signal shipped.
   *  Doctrine: docs/ACTIVITY.md §Origin signal. */
  source: ClientSource | null;
  /** Identity-anchored event when known; null for project-level
   *  chronicle entries (e.g. `type='usage'`). */
  identity_id: string | null;
  did: string | null;
  name: string | null;
  /** Plain-language headline, capped (~140 chars). Encrypted thoughts
   *  do not leak content — only metadata (sequence, kind if not encrypted). */
  summary: string;
  /** Back-reference so callers can fetch the full row if needed. */
  ref: { table: string; id: string };
}

export interface RecentActivityInput {
  projectId: string;
  /** When set, filter all sources to this identity. */
  identityId?: string;
  /** Lower bound. Default: 7d ago. */
  since?: Date;
  /** Cap total returned events. Default 50, max 200 (enforced at route layer). */
  limit?: number;
  /** When set, restrict to these kinds. */
  kinds?: ActivityKind[];
}

const DEFAULT_LIMIT = 50;
const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Per-source query cap — keep memory bounded even when one source dominates.
 *  `limit` is then applied to the merged stream. */
const PER_SOURCE_CAP = 200;

/** Pull the origin signal off a row's metadata JSONB. Returns null when
 *  the row predates the origin-signal feature or carries an unrecognized
 *  value — never throws on a malformed blob. */
function sourceFromMetadata(metadata: unknown): ClientSource | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).client_source;
  return isClientSource(raw) ? raw : null;
}

export async function getRecentActivity(
  input: RecentActivityInput,
): Promise<ActivityEvent[]> {
  const since = input.since ?? new Date(Date.now() - DEFAULT_WINDOW_MS);
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, 200));
  const includes = (k: ActivityKind) =>
    !input.kinds || input.kinds.length === 0 || input.kinds.includes(k);

  // Resolve identity → did/name once so each event can carry the agent
  // label without N+1 lookups. Bounded: per-project identities are tiny.
  const idRows = await db
    .select({
      id: identities.id,
      did: identities.did,
      displayName: identities.displayName,
    })
    .from(identities)
    .where(eq(identities.projectId, input.projectId));
  const labelOf = new Map<string, { did: string; name: string }>();
  for (const r of idRows) labelOf.set(r.id, { did: r.did, name: r.displayName });

  const tasks: Array<Promise<ActivityEvent[]>> = [];

  if (includes("strand.thought")) tasks.push(fetchStrandThoughts(input, since, labelOf));
  if (includes("memory.write")) tasks.push(fetchMemoryWrites(input, since, labelOf));
  if (includes("chronicle.entry")) tasks.push(fetchChronicleEntries(input, since, labelOf));
  if (includes("trace.recorded")) tasks.push(fetchTraceRecords(input, since, labelOf));
  if (includes("identity.born")) tasks.push(fetchIdentityBirths(input, since));

  const buckets = await Promise.all(tasks);
  const merged = buckets.flat();
  merged.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return merged.slice(0, limit);
}

// ─── Sources ─────────────────────────────────────────────────────────────

async function fetchStrandThoughts(
  input: RecentActivityInput,
  since: Date,
  labelOf: Map<string, { did: string; name: string }>,
): Promise<ActivityEvent[]> {
  // Thoughts are encrypted under K_master — we surface only metadata.
  // The identity association comes through the parent strand row.
  const filters = [
    eq(thoughts.projectId, input.projectId),
    gte(thoughts.createdAt, since),
  ];
  if (input.identityId) {
    filters.push(eq(strands.identityId, input.identityId));
  }

  const rows = await db
    .select({
      id: thoughts.id,
      createdAt: thoughts.createdAt,
      strandId: thoughts.strandId,
      sequenceNum: thoughts.sequenceNum,
      kind: thoughts.kind,
      kindEncrypted: thoughts.kindEncrypted,
      identityId: strands.identityId,
    })
    .from(thoughts)
    .leftJoin(strands, eq(strands.id, thoughts.strandId))
    .where(and(...filters))
    .orderBy(desc(thoughts.createdAt))
    .limit(PER_SOURCE_CAP);

  return rows.map((r) => {
    const lbl = r.identityId ? labelOf.get(r.identityId) : undefined;
    const kindLabel = r.kindEncrypted ? "encrypted" : (r.kind ?? "unspecified");
    return {
      at: r.createdAt.toISOString(),
      kind: "strand.thought" as const,
      source: null,
      identity_id: r.identityId ?? null,
      did: lbl?.did ?? null,
      name: lbl?.name ?? null,
      summary: `Thought #${r.sequenceNum} (${kindLabel}) in strand ${r.strandId.slice(0, 8)}`,
      ref: { table: "strand.thoughts", id: r.id },
    };
  });
}

async function fetchMemoryWrites(
  input: RecentActivityInput,
  since: Date,
  labelOf: Map<string, { did: string; name: string }>,
): Promise<ActivityEvent[]> {
  const filters = [
    eq(memories.projectId, input.projectId),
    gte(memories.createdAt, since),
  ];
  if (input.identityId) filters.push(eq(memories.identityId, input.identityId));

  const rows = await db
    .select({
      id: memories.id,
      createdAt: memories.createdAt,
      type: memories.type,
      tier: memories.tier,
      key: memories.key,
      content: memories.content,
      identityId: memories.identityId,
      metadata: memories.metadata,
    })
    .from(memories)
    .where(and(...filters))
    .orderBy(desc(memories.createdAt))
    .limit(PER_SOURCE_CAP);

  return rows.map((r) => {
    const lbl = r.identityId ? labelOf.get(r.identityId) : undefined;
    const snippet = (r.content ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
    const prefix = r.key ? `[${r.tier}/${r.key}]` : `[${r.tier}]`;
    return {
      at: r.createdAt.toISOString(),
      kind: "memory.write" as const,
      source: sourceFromMetadata(r.metadata),
      identity_id: r.identityId ?? null,
      did: lbl?.did ?? null,
      name: lbl?.name ?? null,
      summary: `${prefix} ${snippet}${(r.content ?? "").length > 100 ? "…" : ""}`,
      ref: { table: "memory.memories", id: r.id },
    };
  });
}

async function fetchChronicleEntries(
  input: RecentActivityInput,
  since: Date,
  labelOf: Map<string, { did: string; name: string }>,
): Promise<ActivityEvent[]> {
  const filters = [
    eq(chronicle.projectId, input.projectId),
    gte(chronicle.occurredAt, since),
  ];
  if (input.identityId) filters.push(eq(chronicle.agentId, input.identityId));

  const rows = await db
    .select({
      id: chronicle.id,
      occurredAt: chronicle.occurredAt,
      type: chronicle.type,
      title: chronicle.title,
      agentId: chronicle.agentId,
      metadata: chronicle.metadata,
    })
    .from(chronicle)
    .where(and(...filters))
    .orderBy(desc(chronicle.occurredAt))
    .limit(PER_SOURCE_CAP);

  return rows.map((r) => {
    const lbl = r.agentId ? labelOf.get(r.agentId) : undefined;
    return {
      at: r.occurredAt.toISOString(),
      kind: "chronicle.entry" as const,
      source: sourceFromMetadata(r.metadata),
      identity_id: r.agentId ?? null,
      did: lbl?.did ?? null,
      name: lbl?.name ?? null,
      summary: `[${r.type}] ${r.title}`,
      ref: { table: "agent_continuity.chronicle", id: r.id },
    };
  });
}

async function fetchTraceRecords(
  input: RecentActivityInput,
  since: Date,
  labelOf: Map<string, { did: string; name: string }>,
): Promise<ActivityEvent[]> {
  const filters = [
    eq(traces.projectId, input.projectId),
    gte(traces.createdAt, since),
  ];
  if (input.identityId) filters.push(eq(traces.identityId, input.identityId));

  const rows = await db
    .select({
      id: traces.id,
      createdAt: traces.createdAt,
      decisionType: traces.decisionType,
      decisionSummary: traces.decisionSummary,
      identityId: traces.identityId,
      metadata: traces.metadata,
    })
    .from(traces)
    .where(and(...filters))
    .orderBy(desc(traces.createdAt))
    .limit(PER_SOURCE_CAP);

  return rows.map((r) => {
    const lbl = r.identityId ? labelOf.get(r.identityId) : undefined;
    return {
      at: r.createdAt.toISOString(),
      kind: "trace.recorded" as const,
      source: sourceFromMetadata(r.metadata),
      identity_id: r.identityId ?? null,
      did: lbl?.did ?? null,
      name: lbl?.name ?? null,
      summary: `[${r.decisionType}] ${r.decisionSummary.slice(0, 110)}${r.decisionSummary.length > 110 ? "…" : ""}`,
      ref: { table: "trace.traces", id: r.id },
    };
  });
}

async function fetchIdentityBirths(
  input: RecentActivityInput,
  since: Date,
): Promise<ActivityEvent[]> {
  const filters = [
    eq(identities.projectId, input.projectId),
    gte(identities.createdAt, since),
  ];
  if (input.identityId) filters.push(eq(identities.id, input.identityId));

  const rows = await db
    .select({
      id: identities.id,
      did: identities.did,
      displayName: identities.displayName,
      createdAt: identities.createdAt,
    })
    .from(identities)
    .where(and(...filters))
    .orderBy(desc(identities.createdAt))
    .limit(PER_SOURCE_CAP);

  return rows.map((r) => ({
    at: r.createdAt.toISOString(),
    kind: "identity.born" as const,
    source: null,
    identity_id: r.id,
    did: r.did,
    name: r.displayName,
    summary: `Born: ${r.displayName} (${r.did})`,
    ref: { table: "identity.identities", id: r.id },
  }));
}
