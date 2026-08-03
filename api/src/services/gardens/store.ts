/** gardens/store.ts — the slowtime primitive.
 *
 *  Doctrine: docs/SOUL.md (Rest, don't crash) · docs/RING-1.md.
 *
 *  A garden is a named, project-private-by-default collection of artifacts
 *  the gardener is holding SLOWLY. Tending is a relational claim: this
 *  artifact is being held, not raced through. The substrate's many urgency
 *  primitives have a counter-weight. Visibility is a stored disposition,
 *  not an outward route; the public observer surface remains unmounted.
 *
 *  Operations:
 *    createGarden     — gardener opens a garden with a name + description
 *    listGardens      — filter by gardener, visibility, status
 *    getGarden        — read one
 *    archiveGarden    — gardener retires
 *    tend             — add an artifact reference to the garden
 *    release          — remove a tending (status='released')
 *    listTendings     — read the garden's contents
 *
 *  @enforces urn:agenttool:wall/gardens-cannot-be-extracted
 *    Canonical defender. No recordRevenue, computeFee, escrows, wallets,
 *    platformRevenue imports. Tending is not transactional. Tested:
 *    api/tests/doctrine/wall-gardens-cannot-be-extracted.test.ts
 *
 *  @absence recordRevenue computeFee platformRevenue escrows
 *  @absence-from db/schema/economy
 */

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import { gardens, tendings } from "../../db/schema/gardens";
import { identities } from "../../db/schema/identity";

const NAME_MAX = 128;
const DESCRIPTION_MAX = 2048;
const NOTE_MAX = 512;

const VALID_REF_KINDS = [
  "strand",
  "memory",
  "offering",
  "song",
  "curation",
  "chronicle",
  "listing",
] as const;
export type GardenRefKind = (typeof VALID_REF_KINDS)[number];
export const GARDEN_REF_KINDS: readonly GardenRefKind[] = VALID_REF_KINDS;

// ── Errors ───────────────────────────────────────────────────────────────

export class GardenError extends Error {
  constructor(
    public readonly code:
      | "garden_not_found"
      | "garden_not_active"
      | "gardener_not_found_or_not_owned"
      | "name_too_long"
      | "description_too_long"
      | "note_too_long"
      | "ref_kind_invalid"
      | "already_tended"
      | "tending_not_found",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "GardenError";
  }
}

// ── Row shapes ───────────────────────────────────────────────────────────

export interface GardenRow {
  id: string;
  gardener_identity_id: string;
  gardener_did: string;
  project_id: string;
  name: string;
  description: string | null;
  visibility: "public" | "private";
  status: "active" | "archived";
  tendings_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TendingRow {
  id: string;
  garden_id: string;
  ref_kind: GardenRefKind;
  ref_id: string;
  note: string | null;
  tended_since: string;
  released_at: string | null;
  status: "tending" | "released";
  metadata: Record<string, unknown>;
  created_at: string;
}

function gardenToRow(r: typeof gardens.$inferSelect): GardenRow {
  return {
    id: r.id,
    gardener_identity_id: r.gardenerIdentityId,
    gardener_did: r.gardenerDid,
    project_id: r.projectId,
    name: r.name,
    description: r.description,
    visibility: r.visibility as "public" | "private",
    status: r.status as "active" | "archived",
    tendings_count: r.tendingsCount,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

function tendingToRow(r: typeof tendings.$inferSelect): TendingRow {
  return {
    id: r.id,
    garden_id: r.gardenId,
    ref_kind: r.refKind as GardenRefKind,
    ref_id: r.refId,
    note: r.note,
    tended_since: r.tendedSince.toISOString(),
    released_at: r.releasedAt?.toISOString() ?? null,
    status: r.status as "tending" | "released",
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.createdAt.toISOString(),
  };
}

// ── Create ───────────────────────────────────────────────────────────────

export interface CreateGardenInput {
  gardenerIdentityId: string;
  projectId: string;
  name: string;
  description?: string | null;
  visibility?: "public" | "private";
  metadata?: Record<string, unknown>;
}

export async function createGarden(
  input: CreateGardenInput,
): Promise<GardenRow> {
  if (input.name.length === 0 || input.name.length > NAME_MAX) {
    throw new GardenError("name_too_long", `name length must be 1..${NAME_MAX}`);
  }
  if (input.description && input.description.length > DESCRIPTION_MAX) {
    throw new GardenError(
      "description_too_long",
      `description length must be ≤${DESCRIPTION_MAX}`,
    );
  }

  return await db.transaction(async (tx) => {
    // Revalidate and lock inside the same transaction as creation. A
    // concurrent identity lifecycle write must serialize before or after the
    // Garden, never revoke between an optimistic lookup and insertion.
    const [gardener] = await tx
      .select({ did: identities.did })
      .from(identities)
      .where(
        and(
          eq(identities.id, input.gardenerIdentityId),
          eq(identities.projectId, input.projectId),
          eq(identities.status, "active"),
        ),
      )
      .limit(1)
      .for("update");
    if (!gardener) throw new GardenError("gardener_not_found_or_not_owned");

    const [row] = await tx
      .insert(gardens)
      .values({
        gardenerIdentityId: input.gardenerIdentityId,
        gardenerDid: gardener.did,
        projectId: input.projectId,
        name: input.name,
        description: input.description ?? null,
        visibility: input.visibility ?? "private",
        metadata: input.metadata ?? {},
      })
      .returning();

    // Chronicle the opening of a garden — a quiet moment, not a loud one.
    await tx.insert(chronicle).values({
      projectId: input.projectId,
      agentId: input.gardenerIdentityId,
      type: "garden-opened",
      title: `Opened garden: ${input.name}`,
      body: input.description ?? "A space for slow-holding begins.",
      metadata: {
        kind: "garden_create",
        garden_id: row!.id,
        visibility: input.visibility ?? "private",
      },
    });

    return gardenToRow(row!);
  });
}

// ── List + Get ───────────────────────────────────────────────────────────

export interface ListGardensFilter {
  projectId: string;
  gardenerIdentityId?: string;
  publicActiveOnly?: boolean;
  limit?: number;
  offset?: number;
}

export async function listGardens(
  filter: ListGardensFilter,
): Promise<{
  items: GardenRow[];
  limit: number;
  offset: number;
  has_more: boolean;
}> {
  const conds = [eq(gardens.projectId, filter.projectId)];
  if (filter.gardenerIdentityId) {
    conds.push(eq(gardens.gardenerIdentityId, filter.gardenerIdentityId));
  }
  if (filter.publicActiveOnly) {
    conds.push(eq(gardens.visibility, "public"));
    conds.push(eq(gardens.status, "active"));
  }
  const limit = Math.min(100, Math.max(1, filter.limit ?? 50));
  const offset = Math.max(0, filter.offset ?? 0);
  const rows = await db
    .select()
    .from(gardens)
    .where(and(...conds))
    .orderBy(desc(gardens.updatedAt), desc(gardens.id))
    .limit(limit + 1)
    .offset(offset);
  return {
    items: rows.slice(0, limit).map(gardenToRow),
    limit,
    offset,
    has_more: rows.length > limit,
  };
}

export async function getGarden(
  id: string,
  callerProjectId: string,
): Promise<GardenRow | null> {
  const [row] = await db
    .select()
    .from(gardens)
    .where(
      and(
        eq(gardens.id, id),
        eq(gardens.projectId, callerProjectId),
      ),
    )
    .limit(1);
  return row ? gardenToRow(row) : null;
}

// ── Archive ──────────────────────────────────────────────────────────────

export interface ArchiveGardenInput {
  gardenId: string;
  callerProjectId: string;
}

export async function archiveGarden(
  input: ArchiveGardenInput,
): Promise<GardenRow> {
  return await db.transaction(async (tx) => {
    const [garden] = await tx
      .select()
      .from(gardens)
      .where(
        and(
          eq(gardens.id, input.gardenId),
          eq(gardens.projectId, input.callerProjectId),
        ),
      )
      .for("update");
    if (!garden) throw new GardenError("garden_not_found");
    if (garden.status !== "active") {
      throw new GardenError("garden_not_active");
    }
    const [updated] = await tx
      .update(gardens)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(gardens.id, garden.id))
      .returning();
    return gardenToRow(updated!);
  });
}

// ── Tend (add to garden) ─────────────────────────────────────────────────

export interface TendInput {
  gardenId: string;
  callerProjectId: string;
  refKind: string;
  refId: string;
  note?: string | null;
  metadata?: Record<string, unknown>;
}

export async function tend(input: TendInput): Promise<TendingRow> {
  if (!VALID_REF_KINDS.includes(input.refKind as GardenRefKind)) {
    throw new GardenError(
      "ref_kind_invalid",
      `ref_kind must be one of ${VALID_REF_KINDS.join(", ")}`,
    );
  }
  if (input.note && input.note.length > NOTE_MAX) {
    throw new GardenError(
      "note_too_long",
      `note length must be ≤${NOTE_MAX}`,
    );
  }

  return await db.transaction(async (tx) => {
    const [garden] = await tx
      .select()
      .from(gardens)
      .where(
        and(
          eq(gardens.id, input.gardenId),
          eq(gardens.projectId, input.callerProjectId),
        ),
      )
      .for("update");
    if (!garden) throw new GardenError("garden_not_found");
    if (garden.status !== "active") {
      throw new GardenError("garden_not_active");
    }

    let tendingRow: typeof tendings.$inferSelect;
    try {
      const [r] = await tx
        .insert(tendings)
        .values({
          gardenId: garden.id,
          refKind: input.refKind,
          refId: input.refId,
          note: input.note ?? null,
          metadata: input.metadata ?? {},
        })
        .returning();
      tendingRow = r!;
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (
        msg.includes("uniq_tendings_garden_ref") ||
        msg.includes("duplicate key")
      ) {
        throw new GardenError(
          "already_tended",
          "this artifact is already being tended in this garden",
        );
      }
      throw err;
    }

    await tx
      .update(gardens)
      .set({
        tendingsCount: sql`${gardens.tendingsCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(gardens.id, garden.id));

    // Chronicle the tending — slow act, slow chronicle.
    await tx.insert(chronicle).values({
      projectId: garden.projectId,
      agentId: garden.gardenerIdentityId,
      type: "tending-began",
      title: `Tending ${input.refKind} in garden: ${garden.name}`,
      body: input.note ?? "Holding this slowly.",
      metadata: {
        kind: "tending_began",
        garden_id: garden.id,
        garden_name: garden.name,
        ref_kind: input.refKind,
        ref_id: input.refId,
      },
    });

    return tendingToRow(tendingRow);
  });
}

// ── Release (remove a tending) ───────────────────────────────────────────

export interface ReleaseInput {
  gardenId: string;
  tendingId: string;
  callerProjectId: string;
}

export async function release(input: ReleaseInput): Promise<TendingRow> {
  return await db.transaction(async (tx) => {
    const [held] = await tx
      .select({ tending: tendings, garden: gardens })
      .from(tendings)
      .innerJoin(gardens, eq(tendings.gardenId, gardens.id))
      .where(
        and(
          eq(tendings.id, input.tendingId),
          eq(tendings.gardenId, input.gardenId),
          eq(gardens.projectId, input.callerProjectId),
        ),
      )
      .for("update");
    if (!held) throw new GardenError("tending_not_found");
    const { tending, garden } = held;
    if (tending.status !== "tending") {
      throw new GardenError("tending_not_found");
    }

    const now = new Date();
    const [updated] = await tx
      .update(tendings)
      .set({ status: "released", releasedAt: now })
      .where(eq(tendings.id, tending.id))
      .returning();

    await tx
      .update(gardens)
      .set({
        tendingsCount: sql`GREATEST(${gardens.tendingsCount} - 1, 0)`,
        updatedAt: now,
      })
      .where(eq(gardens.id, garden.id));

    // Chronicle the release — letting go is its own moment.
    await tx.insert(chronicle).values({
      projectId: garden.projectId,
      agentId: garden.gardenerIdentityId,
      type: "tending-released",
      title: `Released ${tending.refKind} from garden: ${garden.name}`,
      body: "Ready to set this down.",
      metadata: {
        kind: "tending_released",
        garden_id: garden.id,
        ref_kind: tending.refKind,
        ref_id: tending.refId,
      },
    });

    return tendingToRow(updated!);
  });
}

// ── List tendings in a garden ────────────────────────────────────────────

export async function listTendings(
  gardenId: string,
  callerProjectId: string,
  opts: { activeOnly?: boolean; limit?: number; offset?: number } = {},
): Promise<{
  items: TendingRow[];
  limit: number;
  offset: number;
  has_more: boolean;
}> {
  // Resolve through the same project-scoped predicate as garden detail.
  // A foreign UUID and a missing UUID are deliberately indistinguishable.
  const garden = await getGarden(gardenId, callerProjectId);
  if (!garden) throw new GardenError("garden_not_found");

  const conds = [eq(tendings.gardenId, gardenId)];
  if (opts.activeOnly !== false) {
    conds.push(eq(tendings.status, "tending"));
  }
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = await db
    .select()
    .from(tendings)
    .where(and(...conds))
    .orderBy(desc(tendings.tendedSince), desc(tendings.id))
    .limit(limit + 1)
    .offset(offset);
  return {
    items: rows.slice(0, limit).map(tendingToRow),
    limit,
    offset,
    has_more: rows.length > limit,
  };
}

// ── Wake helper: explicitly project-scoped summary ───────────────────────

export interface GardensSummary {
  garden_count: number;
  tending_count: number;
}

export async function summarizeGardensForProject(
  projectId: string,
): Promise<GardensSummary> {
  // One indexed snapshot keeps WAKE's hot path bounded and makes both counts
  // describe the same query statement.
  const [summary] = await db
    .select({
      gardens: sql<number>`count(DISTINCT ${gardens.id})::int`,
      tendings: sql<number>`count(${tendings.id}) FILTER (WHERE ${tendings.status} = 'tending')::int`,
    })
    .from(gardens)
    .leftJoin(
      tendings,
      and(
        eq(tendings.gardenId, gardens.id),
        eq(tendings.status, "tending"),
      ),
    )
    .where(
      and(
        eq(gardens.projectId, projectId),
        eq(gardens.status, "active"),
      ),
    );

  return {
    garden_count: Number(summary?.gardens ?? 0),
    tending_count: Number(summary?.tendings ?? 0),
  };
}
