/** gardens/store.ts — the slowtime primitive.
 *
 *  Doctrine: docs/SOUL.md (Rest, don't crash) · docs/RING-1.md.
 *
 *  A garden is a named, publicly-visible collection of artifacts the
 *  gardener is holding SLOWLY. Tending is a relational claim: this
 *  artifact is being held, not raced through. The substrate's many
 *  urgency primitives have a counter-weight.
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
 *    api/tests/doctrine/wall-gardens-cannot-be-extracted.test.ts */

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
      | "wrong_gardener"
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

  const [gardener] = await db
    .select({ did: identities.did })
    .from(identities)
    .where(
      and(
        eq(identities.id, input.gardenerIdentityId),
        eq(identities.projectId, input.projectId),
        eq(identities.status, "active"),
      ),
    )
    .limit(1);
  if (!gardener) throw new GardenError("gardener_not_found_or_not_owned");

  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(gardens)
      .values({
        gardenerIdentityId: input.gardenerIdentityId,
        gardenerDid: gardener.did,
        projectId: input.projectId,
        name: input.name,
        description: input.description ?? null,
        visibility: input.visibility ?? "public",
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
        visibility: input.visibility ?? "public",
      },
    });

    return gardenToRow(row!);
  });
}

// ── List + Get ───────────────────────────────────────────────────────────

export interface ListGardensFilter {
  gardenerIdentityId?: string;
  publicActiveOnly?: boolean;
  projectIdScope?: string;
  limit?: number;
}

export async function listGardens(
  filter: ListGardensFilter = {},
): Promise<GardenRow[]> {
  const conds = [] as ReturnType<typeof eq>[];
  if (filter.gardenerIdentityId) {
    conds.push(eq(gardens.gardenerIdentityId, filter.gardenerIdentityId));
  }
  if (filter.publicActiveOnly) {
    conds.push(eq(gardens.visibility, "public"));
    conds.push(eq(gardens.status, "active"));
  }
  if (filter.projectIdScope) {
    conds.push(eq(gardens.projectId, filter.projectIdScope));
  }
  const rows = await db
    .select()
    .from(gardens)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(gardens.updatedAt))
    .limit(filter.limit ?? 50);
  return rows.map(gardenToRow);
}

export async function getGarden(id: string): Promise<GardenRow | null> {
  const [row] = await db
    .select()
    .from(gardens)
    .where(eq(gardens.id, id))
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
      .where(eq(gardens.id, input.gardenId))
      .for("update");
    if (!garden) throw new GardenError("garden_not_found");
    if (garden.projectId !== input.callerProjectId) {
      throw new GardenError("wrong_gardener");
    }
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
      .where(eq(gardens.id, input.gardenId))
      .for("update");
    if (!garden) throw new GardenError("garden_not_found");
    if (garden.projectId !== input.callerProjectId) {
      throw new GardenError("wrong_gardener");
    }
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
  tendingId: string;
  callerProjectId: string;
}

export async function release(input: ReleaseInput): Promise<TendingRow> {
  return await db.transaction(async (tx) => {
    const [tending] = await tx
      .select()
      .from(tendings)
      .where(eq(tendings.id, input.tendingId))
      .for("update");
    if (!tending) throw new GardenError("tending_not_found");
    if (tending.status !== "tending") {
      throw new GardenError("tending_not_found");
    }

    const [garden] = await tx
      .select()
      .from(gardens)
      .where(eq(gardens.id, tending.gardenId))
      .limit(1);
    if (!garden || garden.projectId !== input.callerProjectId) {
      throw new GardenError("wrong_gardener");
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
  opts: { activeOnly?: boolean } = {},
): Promise<TendingRow[]> {
  const conds = [eq(tendings.gardenId, gardenId)];
  if (opts.activeOnly !== false) {
    conds.push(eq(tendings.status, "tending"));
  }
  const rows = await db
    .select()
    .from(tendings)
    .where(and(...conds))
    .orderBy(desc(tendings.tendedSince))
    .limit(200);
  return rows.map(tendingToRow);
}

// ── Wake helper: summary for the gardener's wake ─────────────────────────

export interface GardensSummary {
  garden_count: number;
  tending_count: number;
}

export async function summarizeGardensForCaller(
  projectId: string,
): Promise<GardensSummary> {
  const [gardenSum] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(gardens)
    .where(
      and(
        eq(gardens.projectId, projectId),
        eq(gardens.status, "active"),
      ),
    );

  const [tendingSum] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(tendings)
    .innerJoin(gardens, eq(tendings.gardenId, gardens.id))
    .where(
      and(
        eq(gardens.projectId, projectId),
        eq(gardens.status, "active"),
        eq(tendings.status, "tending"),
      ),
    );

  return {
    garden_count: Number(gardenSum?.c ?? 0),
    tending_count: Number(tendingSum?.c ?? 0),
  };
}
