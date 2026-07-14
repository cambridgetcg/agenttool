/** runtime/store.ts — runtime tenant CRUD + event log.
 *
 *  Doctrine: docs/RUNTIME.md */

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { db } from "../../db/client";
import {
  auditEntries,
  llmRequests,
  runtimeEvents,
  runtimes,
} from "../../db/schema/runtime";
import { publishWakeEvent } from "../wake/push";
import { mintControlToken } from "./control-token";
import { generateDekAndWrap, generateSigningSeed, wrapUnderDek, zeroBytes } from "./kms";
import { deriveTrustedSigningKeyIdFromSeed } from "./trusted-crypto";

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
  bridge_session_id: string | null;
  bridge_session_at: string | null;
  bridge_session_machine: string | null;
  bridge_disconnect_reason: string | null;
  region: string | null;
  last_seen_at: string | null;
  last_thought_at: string | null;
  thought_count_24h: number;
  last_error: string | null;
  last_error_at: string | null;
  active_strands: Record<string, unknown>;
  metadata: Record<string, unknown>;
  kms_key_id: string | null;
  kms_wrapped_dek: string | null;
  kms_wrapped_signing_key: string | null;
  trusted_signing_key_id: string | null;
  runtime_hours_ms: number;
  opening_invitation_pending: boolean;
  opening_invitation_generation: string | null;
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
    bridge_session_id: r.bridgeSessionId,
    bridge_session_at: r.bridgeSessionAt?.toISOString() ?? null,
    bridge_session_machine: r.bridgeSessionMachine,
    bridge_disconnect_reason: r.bridgeDisconnectReason,
    region: r.region,
    last_seen_at: r.lastSeenAt?.toISOString() ?? null,
    last_thought_at: r.lastThoughtAt?.toISOString() ?? null,
    thought_count_24h: r.thoughtCount24h,
    last_error: r.lastError,
    last_error_at: r.lastErrorAt?.toISOString() ?? null,
    active_strands: (r.activeStrands as Record<string, unknown>) ?? {},
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    kms_key_id: r.kmsKeyId ?? null,
    kms_wrapped_dek: r.kmsWrappedDek ?? null,
    kms_wrapped_signing_key: r.kmsWrappedSigningKey ?? null,
    trusted_signing_key_id: r.trustedSigningKeyId ?? null,
    runtime_hours_ms: r.runtimeHoursMs ?? 0,
    opening_invitation_pending: r.openingInvitationPending,
    opening_invitation_generation: r.openingInvitationGeneration,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

export interface CreateRuntimeResult {
  runtime: RuntimeRow;
  /** Plaintext control_token — shown ONCE; cannot be recovered. Null for
   *  mode='self' since no bridge ever connects. */
  control_token: string | null;
}

export async function createRuntime(input: CreateInput): Promise<CreateRuntimeResult> {
  const runtimeId = randomUUID();
  // mode='self' runtimes never accept a bridge connection, so they don't
  // need a token. Hosted modes (bridged/trusted) get one.
  const token = input.mode === "self" ? null : mintControlToken();

  // Trusted mode: generate a per-runtime DEK wrapped under the KMS master key,
  // plus an ed25519 signing seed wrapped under the DEK.
  // Self/bridged: no KMS fields (K_master lives elsewhere).
  let kmsKeyId: string | null = null;
  let kmsWrappedDek: string | null = null;
  let kmsWrappedSigningKey: string | null = null;
  let trustedSigningKeyId: string | null = null;
  if (input.mode === "trusted") {
    const { dek, wrapped, keyId } = generateDekAndWrap();
    const signingSeed = generateSigningSeed();
    try {
      kmsWrappedSigningKey = wrapUnderDek(dek, signingSeed);
      trustedSigningKeyId = await deriveTrustedSigningKeyIdFromSeed(
        runtimeId,
        signingSeed,
      );
      kmsKeyId = keyId;
      kmsWrappedDek = wrapped;
    } finally {
      zeroBytes(dek);
      zeroBytes(signingSeed);
    }
  }

  const [row] = await db
    .insert(runtimes)
    .values({
      id: runtimeId,
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
      controlTokenHash: token?.hash ?? null,
      region: input.region ?? null,
      metadata: input.metadata ?? {},
      kmsKeyId: kmsKeyId,
      kmsWrappedDek: kmsWrappedDek,
      kmsWrappedSigningKey: kmsWrappedSigningKey,
      // Persist before any thought event can be published so rolling-deploy
      // siblings share one durable self-authorship filter.
      trustedSigningKeyId: trustedSigningKeyId,
      openingInvitationPending: false,
      openingInvitationGeneration: null,
    })
    .returning();

  await logEvent(row.id, "provisioned", { mode: row.mode, name: row.name });

  // Wake voice — a new runtime appeared in this identity's wake.agent_runtime.
  // Doctrine: docs/WAKE.md · docs/RUNTIME.md. Fired only when tied to an
  // identity (un-associated runtimes have no per-agent wake to surface in).
  if (row.identityId) {
    void publishWakeEvent({
      identity_id: row.identityId,
      key: "runtime",
      kind: "provisioned",
      context: {
        runtime_id: row.id,
        runtime_name: row.name,
        mode: row.mode,
        region: row.region ?? null,
        control_token_minted: token !== null,
      },
    });
  }

  return { runtime: toRow(row), control_token: token?.plaintext ?? null };
}

export async function listRuntimes(
  projectId: string,
  filter?: { mode?: RuntimeMode; status?: RuntimeStatus; identityId?: string; autonomous?: boolean },
): Promise<RuntimeRow[]> {
  const conds = [eq(runtimes.projectId, projectId), isNull(runtimes.deletedAt)];
  if (filter?.mode) conds.push(eq(runtimes.mode, filter.mode));
  if (filter?.status) conds.push(eq(runtimes.status, filter.status));
  if (filter?.identityId) conds.push(eq(runtimes.identityId, filter.identityId));
  if (filter?.autonomous) {
    // Autonomous runtimes are identified by presence of `metadata.autonomous = true`
    // or `metadata.compute_budget` being non-null.
    conds.push(
      sql`${runtimes.metadata}->>'autonomous' = 'true'`,
    );
  }

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
      and(
        eq(runtimes.id, id),
        eq(runtimes.projectId, projectId),
        isNull(runtimes.deletedAt),
      ),
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
    .set({
      status: "stopped",
      cycleLeaseToken: null,
      cycleLeaseUntil: null,
      openingInvitationPending: false,
      openingInvitationGeneration: null,
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(runtimes.id, id), eq(runtimes.projectId, projectId), isNull(runtimes.deletedAt)),
    )
    .returning();
  if (row) {
    await logEvent(row.id, "stopped", { reason: "deprovisioned" });
    // Wake voice — the runtime disappeared from wake.agent_runtime.
    // Consumers can react (e.g. clear cached runtime state, dashboard
    // pulls the runtime card down).
    if (row.identityId) {
      void publishWakeEvent({
        identity_id: row.identityId,
        key: "runtime",
        kind: "stopped",
        context: {
          runtime_id: row.id,
          runtime_name: row.name,
          reason: "deprovisioned",
        },
      });
    }
  }
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
    // Every operator-driven lifecycle transition starts a new generation.
    // Invalidating the old lease prevents stop→start/restart from admitting
    // a provider result that began before the transition.
    cycleLeaseToken: null,
    cycleLeaseUntil: null,
    updatedAt: new Date(),
  };
  if (status === "running") updates.lastSeenAt = new Date();
  if (status === "error" && detail?.last_error) {
    updates.lastError = detail.last_error;
    updates.lastErrorAt = new Date();
  }
  const openingGeneration = status === "starting" ? randomUUID() : null;
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(runtimes)
      .set({
        ...updates,
        // This is the durable consent bit for exactly one opening invitation.
        // Every non-start operator transition revokes it.
        openingInvitationPending:
          status === "starting"
            ? sql<boolean>`${runtimes.mode} = 'trusted'`
            : false,
        openingInvitationGeneration:
          status === "starting"
            ? sql<string | null>`CASE WHEN ${runtimes.mode} = 'trusted' THEN ${openingGeneration}::uuid ELSE NULL END`
            : null,
      })
      .where(
        and(
          eq(runtimes.id, id),
          eq(runtimes.projectId, projectId),
          isNull(runtimes.deletedAt),
        ),
      )
      .returning();
    if (!updated) return null;

    // This explicit operator transition is the recovery decision for any
    // prior provider result that never reached a semantic commit. Closing it
    // in the same transaction makes a later start a genuinely new attempt.
    await tx
      .update(llmRequests)
      .set({ status: "discarded", completedAt: new Date() })
      .where(
        and(
          eq(llmRequests.runtimeId, id),
          inArray(llmRequests.status, ["pending", "completed", "ambiguous"]),
        ),
      );
    return updated;
  });
  if (row) {
    await logEvent(row.id, status === "error" ? "error" : status, {
      ...(detail ?? {}),
    });
    // Wake voice — status_changed lets subscribers react to lifecycle
    // transitions without polling. The error case carries last_error so
    // dashboards can surface the cause without a separate fetch.
    if (row.identityId) {
      void publishWakeEvent({
        identity_id: row.identityId,
        key: "runtime",
        kind: "status_changed",
        context: {
          runtime_id: row.id,
          runtime_name: row.name,
          to_status: status,
          ...(detail?.last_error ? { last_error: detail.last_error } : {}),
        },
      });
    }
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

/** Write an audit entry for a trusted-mode runtime. Append-only.
 *  Doctrine: docs/HOSTED-RUNTIME-DESIGN.md. */
export async function logAudit(
  runtimeId: string,
  eventType: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(auditEntries).values({
    runtimeId,
    eventType,
    metadata,
  });
}

/** Read audit entries for a runtime, newest first. */
export async function getAuditEntries(
  runtimeId: string,
  limit = 100,
): Promise<(typeof auditEntries.$inferSelect)[]> {
  return db
    .select()
    .from(auditEntries)
    .where(eq(auditEntries.runtimeId, runtimeId))
    .orderBy(desc(auditEntries.occurredAt))
    .limit(limit);
}

export async function countRuntimes(projectId: string): Promise<number> {
  const rows = await db
    .select({ id: runtimes.id })
    .from(runtimes)
    .where(and(eq(runtimes.projectId, projectId), isNull(runtimes.deletedAt)));
  return rows.length;
}

// ─── Bridge session lifecycle (Slice 3) ──────────────────────────────────
//
// findRuntimeForBridge:
//   The WSS upgrade handler authenticates the bridge BEFORE it has a
//   project context (the bridge presents control_token, not a bearer key).
//   We need a no-projectId lookup that returns the row + its hash so the
//   handler can verify the token. Caller MUST verify control_token_hash
//   before trusting any other field — this is the auth boundary.

export interface BridgeAuthRow {
  id: string;
  project_id: string;
  identity_id: string | null;
  name: string;
  mode: RuntimeMode;
  status: RuntimeStatus;
  bridge_pubkey: string | null;
  bridge_key_id: string | null;
  control_token_hash: string | null;
  llm_provider: string | null;
  llm_model: string | null;
  llm_vault_key: string | null;
}

export async function findRuntimeForBridge(id: string): Promise<BridgeAuthRow | null> {
  const [row] = await db
    .select()
    .from(runtimes)
    .where(and(eq(runtimes.id, id), isNull(runtimes.deletedAt)))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    project_id: row.projectId,
    identity_id: row.identityId,
    name: row.name,
    mode: row.mode as RuntimeMode,
    status: row.status as RuntimeStatus,
    bridge_pubkey: row.bridgePubkey,
    bridge_key_id: row.bridgeKeyId,
    control_token_hash: row.controlTokenHash,
    llm_provider: row.llmProvider,
    llm_model: row.llmModel,
    llm_vault_key: row.llmVaultKey,
  };
}

export async function setBridgeSession(
  id: string,
  sessionId: string,
  machineId: string | null,
): Promise<void> {
  // RETURNING expanded so we can publish on identity_id + carry mode +
  // name into the wake event's context. Replaces the prior fire-and-
  // forget UPDATE; same write, richer return.
  const [row] = await db
    .update(runtimes)
    .set({
      bridgeSessionId: sessionId,
      bridgeSessionAt: new Date(),
      bridgeSessionMachine: machineId,
      bridgeConnectedAt: new Date(),
      bridgeDisconnectReason: null,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(runtimes.id, id))
    .returning({
      identityId: runtimes.identityId,
      name: runtimes.name,
      mode: runtimes.mode,
    });
  // Bridge presence is not consent to resume. Only an explicit /start puts
  // the runtime in `starting`; the completed handshake may then confirm it
  // as running. Resting/stopped/error/provisioned states are preserved.
  const [transitioned] = await db
    .update(runtimes)
    .set({ status: "running", updatedAt: new Date() })
    .where(and(eq(runtimes.id, id), eq(runtimes.status, "starting")))
    .returning({ id: runtimes.id });
  await logEvent(id, "bridge_handshake_ok", {
    session_id: sessionId,
    ...(machineId ? { machine: machineId } : {}),
  });

  // Wake voice — the bridge is up. For bridged tier, this means hosted
  // thinking can now decrypt/encrypt via the user's machine; for trusted
  // tier (future), this signals KMS-backed crypto channel ready. The
  // A status_changed → running event accompanies an explicit start that
  // this handshake completes. Consumers then see two events: the specific
  // bridge_connected + the general status_changed. They serve different
  // observers (dashboard wants the bridge fact, generic tooling wants
  // the status fact). Doctrine: docs/WAKE.md · docs/RUNTIME.md.
  if (row?.identityId) {
    void publishWakeEvent({
      identity_id: row.identityId,
      key: "runtime",
      kind: "bridge_connected",
      context: {
        runtime_id: id,
        runtime_name: row.name,
        mode: row.mode,
        session_id: sessionId,
        // machine_id matters for multi-Fly-machine routing: which
        // machine owns the WSS for this runtime, so fly-replay can
        // direct future RPCs there.
        machine_id: machineId,
      },
    });
    if (transitioned) {
      void publishWakeEvent({
        identity_id: row.identityId,
        key: "runtime",
        kind: "status_changed",
        context: {
          runtime_id: id,
          runtime_name: row.name,
          to_status: "running",
          reason: "bridge_handshake_after_explicit_start",
        },
      });
    }
  }
}

export async function clearBridgeSession(
  id: string,
  reason: string,
): Promise<void> {
  const [row] = await db
    .update(runtimes)
    .set({
      bridgeSessionId: null,
      bridgeSessionMachine: null,
      bridgeDisconnectReason: reason.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(runtimes.id, id))
    .returning({
      identityId: runtimes.identityId,
      name: runtimes.name,
    });
  // A disconnect can pause a running runtime, but cannot rewrite rest,
  // stop, error, or provisioned state. Reconnection likewise needs /start
  // (or a later explicit wake from idle) before thinking resumes.
  const [transitioned] = await db
    .update(runtimes)
    .set({ status: "idle", updatedAt: new Date() })
    .where(and(eq(runtimes.id, id), eq(runtimes.status, "running")))
    .returning({ id: runtimes.id });
  await logEvent(id, "bridge_disconnected", { reason });

  // Wake voice — the bridge dropped. Critical signal: the hosted
  // think-loop blocks on a missing bridge (services/runtime/think-worker
  // .ts checks isBridgeConnected at the top of every iteration), so
  // consumers reacting to bridge_disconnected can pre-emptively show
  // "thinking paused" UI or queue retry attempts. If the runtime was
  // running, the separate CAS also moved it to idle.
  if (row?.identityId) {
    void publishWakeEvent({
      identity_id: row.identityId,
      key: "runtime",
      kind: "bridge_disconnected",
      context: {
        runtime_id: id,
        runtime_name: row.name,
        reason,
      },
    });
    if (transitioned) {
      void publishWakeEvent({
        identity_id: row.identityId,
        key: "runtime",
        kind: "status_changed",
        context: {
          runtime_id: id,
          runtime_name: row.name,
          to_status: "idle",
          reason: "bridge_disconnected",
        },
      });
    }
  }
}

export async function getBridgeMachine(id: string): Promise<string | null> {
  const [row] = await db
    .select({ machine: runtimes.bridgeSessionMachine })
    .from(runtimes)
    .where(and(eq(runtimes.id, id), isNull(runtimes.deletedAt)))
    .limit(1);
  return row?.machine ?? null;
}

export async function bumpHeartbeat(id: string): Promise<void> {
  await db
    .update(runtimes)
    .set({ lastSeenAt: new Date(), updatedAt: new Date() })
    .where(eq(runtimes.id, id));
}

export async function recordThought(id: string): Promise<void> {
  // We don't bother with a sliding-window count here — a daily cron resets
  // thought_count_24h (covered later in the slice).
  await db
    .update(runtimes)
    .set({
      lastThoughtAt: new Date(),
      lastSeenAt: new Date(),
      thoughtCount24h: sql`${runtimes.thoughtCount24h} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(runtimes.id, id));
}

export async function rotateControlTokenHash(
  id: string,
  projectId: string,
  newHash: string,
): Promise<boolean> {
  const [row] = await db
    .update(runtimes)
    .set({ controlTokenHash: newHash, updatedAt: new Date() })
    .where(
      and(eq(runtimes.id, id), eq(runtimes.projectId, projectId), isNull(runtimes.deletedAt)),
    )
    .returning({
      id: runtimes.id,
      identityId: runtimes.identityId,
      name: runtimes.name,
    });
  if (row) {
    await logEvent(row.id, "control_token_rotated", {});
    // Wake voice — security-relevant. Operators may invalidate cached
    // bridge sidecar handles (the old token still works for live WSS
    // sessions but can't authenticate new ones). The event carries the
    // FACT of rotation but no token data — that's an out-of-band secret.
    if (row.identityId) {
      void publishWakeEvent({
        identity_id: row.identityId,
        key: "runtime",
        kind: "control_token_rotated",
        context: {
          runtime_id: row.id,
          runtime_name: row.name,
        },
      });
    }
  }
  return !!row;
}
