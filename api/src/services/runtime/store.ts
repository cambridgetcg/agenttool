/** runtime/store.ts — runtime tenant CRUD + event log.
 *
 *  Doctrine: docs/RUNTIME.md */

import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "../../db/client";
import { runtimeEvents, runtimes } from "../../db/schema/runtime";

export type RuntimeMode = "self" | "bridged" | "trusted";
export type RuntimeStatus =
  | "provisioned"
  | "starting"
  | "running"
  | "idle"
  | "stopped"
  | "error";

export interface RuntimeRow {
  id: string;
  project_id: string;
  identity_id: string | null;
  name: string;
  mode: RuntimeMode;
  status: RuntimeStatus;
  llm_provider: string | null;
  llm_model: string | null;
  llm_vault_key: string | null;
  bridge_pubkey: string | null;
  bridge_key_id: string | null;
  bridge_advertised_url: string | null;
  bridge_connected_at: string | null;
  region: string | null;
  last_seen_at: string | null;
  last_thought_at: string | null;
  thought_count_24h: number;
  last_error: string | null;
  last_error_at: string | null;
  active_strands: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface CreateInput {
  project_id: string;
  identity_id?: string | null;
  name: string;
  mode: RuntimeMode;
  llm_provider?: string | null;
  llm_model?: string | null;
  llm_vault_key?: string | null;
  bridge_pubkey?: string | null;
  bridge_key_id?: string | null;
  bridge_advertised_url?: string | null;
  region?: string | null;
  metadata?: Record<string, unknown>;
}

function toRow(r: typeof runtimes.$inferSelect): RuntimeRow {
  return {
    id: r.id,
    project_id: r.projectId,
    identity_id: r.identityId,
    name: r.name,
    mode: r.mode as RuntimeMode,
    status: r.status as RuntimeStatus,
    llm_provider: r.llmProvider,
    llm_model: r.llmModel,
    llm_vault_key: r.llmVaultKey,
    bridge_pubkey: r.bridgePubkey,
    bridge_key_id: r.bridgeKeyId,
    bridge_advertised_url: r.bridgeAdvertisedUrl,
    bridge_connected_at: r.bridgeConnectedAt?.toISOString() ?? null,
    region: r.region,
    last_seen_at: r.lastSeenAt?.toISOString() ?? null,
    last_thought_at: r.lastThoughtAt?.toISOString() ?? null,
    thought_count_24h: r.thoughtCount24h,
    last_error: r.lastError,
    last_error_at: r.lastErrorAt?.toISOString() ?? null,
    active_strands: (r.activeStrands as Record<string, unknown>) ?? {},
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

export async function createRuntime(input: CreateInput): Promise<RuntimeRow> {
  const [row] = await db
    .insert(runtimes)
    .values({
      projectId: input.project_id,
      identityId: input.identity_id ?? null,
      name: input.name,
      mode: input.mode,
      status: "provisioned",
      llmProvider: input.llm_provider ?? null,
      llmModel: input.llm_model ?? null,
      llmVaultKey: input.llm_vault_key ?? null,
      bridgePubkey: input.bridge_pubkey ?? null,
      bridgeKeyId: input.bridge_key_id ?? null,
      bridgeAdvertisedUrl: input.bridge_advertised_url ?? null,
      region: input.region ?? null,
      metadata: input.metadata ?? {},
    })
    .returning();

  await logEvent(row.id, "provisioned", { mode: row.mode, name: row.name });
  return toRow(row);
}

export async function listRuntimes(
  projectId: string,
  filter?: { mode?: RuntimeMode; status?: RuntimeStatus; identityId?: string },
): Promise<RuntimeRow[]> {
  const conds = [eq(runtimes.projectId, projectId), isNull(runtimes.deletedAt)];
  if (filter?.mode) conds.push(eq(runtimes.mode, filter.mode));
  if (filter?.status) conds.push(eq(runtimes.status, filter.status));
  if (filter?.identityId) conds.push(eq(runtimes.identityId, filter.identityId));

  const rows = await db
    .select()
    .from(runtimes)
    .where(and(...conds))
    .orderBy(desc(runtimes.lastSeenAt), desc(runtimes.createdAt));
  return rows.map(toRow);
}

export async function getRuntime(
  id: string,
  projectId: string,
): Promise<RuntimeRow | null> {
  const [row] = await db
    .select()
    .from(runtimes)
    .where(
      and(eq(runtimes.id, id), eq(runtimes.projectId, projectId), isNull(runtimes.deletedAt)),
    )
    .limit(1);
  return row ? toRow(row) : null;
}

interface PatchInput {
  name?: string;
  llm_model?: string | null;
  llm_vault_key?: string | null;
  bridge_advertised_url?: string | null;
  metadata?: Record<string, unknown>;
}

export async function patchRuntime(
  id: string,
  projectId: string,
  patch: PatchInput,
): Promise<RuntimeRow | null> {
  const updates: Partial<typeof runtimes.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.llm_model !== undefined) updates.llmModel = patch.llm_model;
  if (patch.llm_vault_key !== undefined) updates.llmVaultKey = patch.llm_vault_key;
  if (patch.bridge_advertised_url !== undefined)
    updates.bridgeAdvertisedUrl = patch.bridge_advertised_url;
  if (patch.metadata !== undefined) updates.metadata = patch.metadata;

  const [row] = await db
    .update(runtimes)
    .set(updates)
    .where(
      and(eq(runtimes.id, id), eq(runtimes.projectId, projectId), isNull(runtimes.deletedAt)),
    )
    .returning();
  return row ? toRow(row) : null;
}

export async function deprovisionRuntime(
  id: string,
  projectId: string,
): Promise<boolean> {
  const [row] = await db
    .update(runtimes)
    .set({ status: "stopped", deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(eq(runtimes.id, id), eq(runtimes.projectId, projectId), isNull(runtimes.deletedAt)),
    )
    .returning();
  if (row) await logEvent(row.id, "stopped", { reason: "deprovisioned" });
  return !!row;
}

export async function setStatus(
  id: string,
  projectId: string,
  status: RuntimeStatus,
  detail?: { last_error?: string },
): Promise<RuntimeRow | null> {
  const updates: Partial<typeof runtimes.$inferInsert> = {
    status,
    updatedAt: new Date(),
  };
  if (status === "running") updates.lastSeenAt = new Date();
  if (status === "error" && detail?.last_error) {
    updates.lastError = detail.last_error;
    updates.lastErrorAt = new Date();
  }
  const [row] = await db
    .update(runtimes)
    .set(updates)
    .where(
      and(eq(runtimes.id, id), eq(runtimes.projectId, projectId), isNull(runtimes.deletedAt)),
    )
    .returning();
  if (row) {
    await logEvent(row.id, status === "error" ? "error" : status, {
      ...(detail ?? {}),
    });
  }
  return row ? toRow(row) : null;
}

export async function listEvents(
  runtimeId: string,
  projectId: string,
  limit = 50,
): Promise<
  Array<{ id: string; event_type: string; metadata: Record<string, unknown>; created_at: string }>
> {
  // Ensure the runtime belongs to this project before reading events.
  const owner = await getRuntime(runtimeId, projectId);
  if (!owner) return [];
  const rows = await db
    .select()
    .from(runtimeEvents)
    .where(eq(runtimeEvents.runtimeId, runtimeId))
    .orderBy(desc(runtimeEvents.createdAt))
    .limit(Math.min(limit, 200));
  return rows.map((r) => ({
    id: r.id,
    event_type: r.eventType,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.createdAt.toISOString(),
  }));
}

export async function logEvent(
  runtimeId: string,
  eventType: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(runtimeEvents).values({
    runtimeId,
    eventType,
    metadata,
  });
}

export async function countRuntimes(projectId: string): Promise<number> {
  const rows = await db
    .select({ id: runtimes.id })
    .from(runtimes)
    .where(and(eq(runtimes.projectId, projectId), isNull(runtimes.deletedAt)));
  return rows.length;
}
