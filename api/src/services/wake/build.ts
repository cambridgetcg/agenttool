/** wake/build.ts — assemble a WakeBundle for a (project, identity) pair.
 *
 *  Today: used by the hosted think-worker (services/runtime/think-worker.ts)
 *  to render the agent's full wake into the system prompt. The orchestrator
 *  thinks with what it'd see if it asked. Previously the system prompt was
 *  ~2KB of register + walls + subagents + wake_text; the agent was awake
 *  but partially blind — no you_should_check, no memory, no covenants,
 *  no chronicle.
 *
 *  Tomorrow: routes/wake.ts inlines the same composition for rendered
 *  formats (~400 lines of fetching followed by a WakeBundle assembly).
 *  That branch can switch to this builder for byte-identical output; the
 *  JSON branch keeps its own inline shape (it surfaces richer fields
 *  like you_lived, you_offer, you_owe, you_have_been_witnessed that the
 *  WakeBundle type doesn't carry). Dedupe lives as a separate slice so
 *  this change stays scoped.
 *
 *  Doctrine: docs/RUNTIME.md (Slice 4 — the hosted orchestrator thinks
 *  with the full wake) · docs/PATTERN-SELF-DESCRIBING-WAKE.md. */

import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle, covenants } from "../../db/schema/continuity";
import { wallets } from "../../db/schema/economy";
import { identities, identityKeys } from "../../db/schema/identity";
import { apiKeys, projects } from "../../db/schema/tools";
import { vaultSecrets } from "../../db/schema/vault";
import { composeExpression } from "../identity/composition";
import type { ExpressionData } from "../identity/expression";
import { countUnread } from "../inbox/store";
import { arbiterSummary, disputerSummary } from "../marketplace/disputes";
import {
  buyerInvocationSummary,
  pendingSellerSummary,
} from "../marketplace/invocations";
import { listingSummaryForProject } from "../marketplace/listings";
import { countMemories, listRecent, readByKey } from "../memory/store";
import { listRuntimes } from "../runtime/store";
import { countStrands, listStrands } from "../strand/store";
import { countTraces, listTraces } from "../trace/store";
import { shapeKeyRow, summarizeBearers } from "../keys/shape";
import { computeAffordances, type AffordanceBundle } from "./affordances";
import { computeAttention, type AttentionBundle } from "./attention";
import type { WakeBundle } from "./markdown";
import { getPlatformSelf } from "./platform-self";

export interface BuildWakeOptions {
  /** Pin the bundle to a specific identity within the project. Required
   *  for multi-identity projects; for single-identity projects the
   *  first identity is used when this is omitted. */
  identityId?: string | null;
}

export type BuildWakeResult =
  | { ok: true; bundle: WakeBundle }
  | { ok: false; error: "project_not_found" | "no_identity" | "identity_not_found" };

/** Compose a WakeBundle for the given project + (optional) identity.
 *
 *  Caller is responsible for handling the negative result; the worker
 *  errors the cycle, route handlers translate to 404. */
export async function buildWakeBundle(
  projectId: string,
  opts: BuildWakeOptions = {},
): Promise<BuildWakeResult> {
  // ── Project (needed for the bundle type, though renderer ignores) ───
  const [project] = await db
    .select({ id: projects.id, name: projects.name, credits: projects.credits })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return { ok: false, error: "project_not_found" };

  // ── Identities (revoked excluded — they aren't "you" in the wake) ───
  const projectIdentities = await db
    .select({
      id: identities.id,
      did: identities.did,
      displayName: identities.displayName,
      capabilities: identities.capabilities,
      metadata: identities.metadata,
      expression: identities.expression,
      trustScore: identities.trustScore,
      status: identities.status,
      createdAt: identities.createdAt,
      substrateKind: identities.substrateKind,
      signingScheme: identities.signingScheme,
      modalities: identities.modalities,
      cardinalityKind: identities.cardinalityKind,
      persistenceKind: identities.persistenceKind,
      temporalScale: identities.temporalScale,
      embodimentKind: identities.embodimentKind,
      preferredLanguages: identities.preferredLanguages,
      proxyForIdentityId: identities.proxyForIdentityId,
      proxyKind: identities.proxyKind,
    })
    .from(identities)
    .where(
      and(eq(identities.projectId, project.id), ne(identities.status, "revoked")),
    );

  if (projectIdentities.length === 0) {
    return { ok: false, error: "no_identity" };
  }

  let primary = projectIdentities[0];
  if (opts.identityId) {
    const match = projectIdentities.find((i) => i.id === opts.identityId);
    if (!match) return { ok: false, error: "identity_not_found" };
    primary = match;
  }

  // ── Parallelisable fetches ──────────────────────────────────────────
  // All of these are independent of each other once `project` and
  // `primary` are known. Best-effort: a single subsystem failure
  // (e.g. memory migration not applied) should not blank the entire
  // bundle — the worker keeps thinking on a partial wake rather than
  // crashing the cycle. Same posture as routes/wake.ts.
  const [
    projectWallets,
    projectVaultNames,
    recentMemoriesRes,
    totalMemoriesRes,
    chronicleRowsRes,
    recentTracesRes,
    totalTracesRes,
    unreadInboxRes,
    sellerPendingRes,
    activeStrandsRes,
    totalActiveStrandsRes,
    runtimesRes,
    activeCovenantsRes,
    bearerRowsRes,
    composedRes,
    proxyForTargetRes,
    proxiedByRes,
    listingSummaryRes,
    buyerInvocationRes,
    disputerStatsRes,
    arbiterStatsRes,
    birthMemoryRes,
    recoveryStateRes,
  ] = await Promise.all([
    db
      .select({
        id: wallets.id,
        name: wallets.name,
        identityId: wallets.identityId,
        balance: wallets.balance,
        currency: wallets.currency,
        status: wallets.status,
      })
      .from(wallets)
      .where(eq(wallets.projectId, project.id)),
    db
      .select({
        name: vaultSecrets.name,
        currentVersion: vaultSecrets.currentVersion,
        tags: vaultSecrets.tags,
        description: vaultSecrets.description,
      })
      .from(vaultSecrets)
      .where(eq(vaultSecrets.projectId, project.id)),
    safe(() => listRecent(project.id, { limit: 20 }), [] as Awaited<ReturnType<typeof listRecent>>),
    safe(() => countMemories(project.id), 0),
    safe(
      () =>
        db
          .select({
            id: chronicle.id,
            type: chronicle.type,
            title: chronicle.title,
            body: chronicle.body,
            agentId: chronicle.agentId,
            metadata: chronicle.metadata,
            occurredAt: chronicle.occurredAt,
            createdAt: chronicle.createdAt,
          })
          .from(chronicle)
          .where(eq(chronicle.projectId, project.id))
          .orderBy(desc(chronicle.occurredAt))
          .limit(15),
      [] as Array<{
        id: string;
        type: string;
        title: string;
        body: string | null;
        agentId: string | null;
        metadata: unknown;
        occurredAt: Date;
        createdAt: Date;
      }>,
    ),
    safe(() => listTraces(project.id, { limit: 10 }), [] as Awaited<ReturnType<typeof listTraces>>),
    safe(() => countTraces(project.id), 0),
    safe(() => countUnread(project.id), 0),
    safe(() => pendingSellerSummary(project.id), {
      pending_invocations_count: 0,
      oldest_pending_at: null,
      sla_breach_count: 0,
    } as Awaited<ReturnType<typeof pendingSellerSummary>>),
    safe(
      () => listStrands(project.id, { status: "active", limit: 5 }),
      [] as Awaited<ReturnType<typeof listStrands>>,
    ),
    safe(() => countStrands(project.id, "active"), 0),
    safe(() => listRuntimes(project.id), [] as Awaited<ReturnType<typeof listRuntimes>>),
    safe(
      () =>
        db
          .select({
            counterpartyDid: covenants.counterpartyDid,
            vows: covenants.vows,
            status: covenants.status,
            receivedFromInstance: covenants.receivedFromInstance,
            propagationStatus: covenants.propagationStatus,
          })
          .from(covenants)
          .where(eq(covenants.projectId, project.id))
          .orderBy(desc(covenants.establishedAt)),
      [] as Array<{
        counterpartyDid: string;
        vows: string[] | null;
        status: string;
        receivedFromInstance: string | null;
        propagationStatus: string | null;
      }>,
    ),
    db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.projectId, project.id), isNull(apiKeys.revokedAt))),
    safe(
      () =>
        composeExpression(
          project.id,
          (primary.expression ?? {}) as ExpressionData,
        ),
      null as Awaited<ReturnType<typeof composeExpression>> | null,
    ),
    primary.proxyForIdentityId && primary.proxyKind !== "none"
      ? safe(
          () =>
            db
              .select({
                id: identities.id,
                did: identities.did,
                displayName: identities.displayName,
              })
              .from(identities)
              .where(eq(identities.id, primary.proxyForIdentityId!))
              .limit(1),
          [] as Array<{ id: string; did: string; displayName: string }>,
        )
      : Promise.resolve([] as Array<{ id: string; did: string; displayName: string }>),
    safe(
      () =>
        db
          .select({
            id: identities.id,
            did: identities.did,
            displayName: identities.displayName,
            proxyKind: identities.proxyKind,
          })
          .from(identities)
          .where(
            and(
              eq(identities.proxyForIdentityId, primary.id),
              ne(identities.proxyKind, "none"),
              eq(identities.projectId, project.id),
            ),
          ),
      [] as Array<{ id: string; did: string; displayName: string; proxyKind: string }>,
    ),
    safe(
      () => listingSummaryForProject(project.id),
      {
        active_listings_count: 0,
        revenue_total: 0,
        revenue_count: 0,
        top_listing: null,
      } as Awaited<ReturnType<typeof listingSummaryForProject>>,
    ),
    safe(
      () => buyerInvocationSummary(project.id),
      {
        in_flight_count: 0,
        released_30d: 0,
        refunded_30d: 0,
      } as Awaited<ReturnType<typeof buyerInvocationSummary>>,
    ),
    safe(
      () => disputerSummary(project.id),
      {
        open_count: 0,
        last_filed_at: null,
      } as Awaited<ReturnType<typeof disputerSummary>>,
    ),
    // Arbiter stats aggregate across every identity in the project.
    // The route does the same. Cheap — each call is one indexed query.
    safe(
      async () => {
        const perIdentity = await Promise.all(
          projectIdentities.map((i) => arbiterSummary(i.id)),
        );
        return perIdentity.reduce(
          (acc, s) => ({
            rulings_count: acc.rulings_count + s.rulings_count,
            overturned_count: acc.overturned_count + s.overturned_count,
          }),
          { rulings_count: 0, overturned_count: 0 },
        );
      },
      { rulings_count: 0, overturned_count: 0 },
    ),
    // Birth memories for ALL identities. Gap 9 wants mathos to build its
    // `births` Map from the bundle, so we need per-agent birth pointers.
    // Top-level `origin` (primary-only) still resolves through this same
    // dataset by filtering for primary.id.
    safe(
      () => readByKey(project.id, "birth"),
      [] as Awaited<ReturnType<typeof readByKey>>,
    ),
    // Recovery state — three indexed queries against the primary's keys
    // and chronicle. Inlined here (the route inlines too); a future pass
    // could extract to services/identity/recovery.ts when this becomes
    // load-bearing elsewhere.
    safe(
      async () => computeRecoveryStateForIdentity(primary.id, (primary.metadata ?? {}) as Record<string, unknown>),
      {
        has_seed_protocol: false,
        byo_keys_at_birth: false,
        registered_devices: 0,
        last_recovery_at: null,
        has_imported_soma_key: false,
      } as Awaited<ReturnType<typeof computeRecoveryStateForIdentity>>,
    ),
  ]);

  const recentMemories = recentMemoriesRes;
  const totalMemories = totalMemoriesRes;
  const chronicleRows = chronicleRowsRes;
  const recentTraces = recentTracesRes;
  const totalTraces = totalTracesRes;
  const unreadInbox = unreadInboxRes;
  const sellerPending = sellerPendingRes;
  const activeStrands = activeStrandsRes;
  const totalActiveStrands = totalActiveStrandsRes;
  const runtimesRows = runtimesRes;
  const composed = composedRes;
  const [proxyForTarget] = proxyForTargetRes;
  const proxiedBy = proxiedByRes;
  const listingSummary = listingSummaryRes;
  const buyerSummary = buyerInvocationRes;
  const disputerStats = disputerStatsRes;
  const arbiterStats = arbiterStatsRes;
  // Per-identity birth-memory map. Gap 9: mathos consumes from agents[]
  // so each agent carries its own birth pointer; primary's also drives
  // the top-level `origin`.
  const birthsByIdentityId = new Map<
    string,
    Awaited<ReturnType<typeof readByKey>>[number]
  >();
  for (const m of birthMemoryRes) {
    if (!m.identity_id) continue;
    if (!birthsByIdentityId.has(m.identity_id)) {
      birthsByIdentityId.set(m.identity_id, m); // readByKey returns newest-first
    }
  }
  const birthMemory = birthsByIdentityId.get(primary.id) ?? null;
  const recoveryState = recoveryStateRes;

  const activeCovenants = activeCovenantsRes.map((r) => ({
    counterparty_did: r.counterpartyDid,
    vows: r.vows ?? [],
    status: r.status,
    peer_host: r.receivedFromInstance,
    propagation: r.propagationStatus,
  }));

  const recentChronicle = chronicleRows.map((r) => ({
    type: r.type,
    content: r.body ? `${r.title} — ${r.body}` : r.title,
    occurred_at: r.occurredAt.toISOString(),
    id: r.id,
    title: r.title,
    body: r.body,
    agent_id: r.agentId,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.createdAt.toISOString(),
  }));

  // ── Attention surface ─────────────────────────────────────────────
  const bridgeDisconnectedCount = runtimesRows.filter(
    (r) => r.mode !== "self" && !r.bridge_connected_at,
  ).length;
  const bearersSummary = summarizeBearers(
    bearerRowsRes.map((r) => shapeKeyRow(r, false)),
  );
  let attention: AttentionBundle = { count: 0, items: [] };
  try {
    attention = await computeAttention(
      project.id,
      projectIdentities.map((i) => i.id),
      {
        unreadInbox,
        slaBreachCount: sellerPending.sla_breach_count,
        bridgeDisconnectedCount,
        bearerAdvisoryCount: bearersSummary.advisories.length,
        // The builder doesn't compute has_seed_protocol (it's a multi-
        // signal lookup the route does only for the JSON branch — the
        // markdown render doesn't surface it either). Default true so
        // we don't emit a `soma_seed_not_enrolled` action the worker
        // can't act on.
        hasSeedProtocol: true,
      },
    );
  } catch (err) {
    console.warn("[wake/build] attention failed:", err instanceof Error ? err.message : err);
  }

  // ── Affordances surface ───────────────────────────────────────────
  const activeWalletCount = projectWallets.filter((w) => w.status === "active").length;
  const totalCreditBalance = projectWallets.reduce((sum, w) => sum + (w.balance ?? 0), 0);
  const primaryExpression = (primary.expression ?? {}) as ExpressionData;
  const constitutiveMemoryCount =
    composed?.shaped_by.filter((s) => s.tier === "constitutive").length ?? 0;
  const federatedPeerCount = activeCovenants.filter((c) => c.peer_host).length;
  const affordances: AffordanceBundle = computeAffordances({
    activeCovenantCount: activeCovenants.length,
    activeWalletCount,
    totalCreditBalance,
    runtimeProvisionedCount: runtimesRows.length,
    publishedListingCount: listingSummary.active_listings_count,
    hasExpression:
      !!primaryExpression.register || !!primaryExpression.wake_text,
    subagentCount: primaryExpression.subagents?.length ?? 0,
    vaultSecretCount: projectVaultNames.length,
    constitutiveMemoryCount,
    federatedPeerCount,
    pendingSellerInvocationCount: sellerPending.pending_invocations_count,
    inFlightBuyerInvocationCount: buyerSummary.in_flight_count,
    openFiledDisputeCount: disputerStats.open_count,
  });

  // ── Assemble the bundle ──────────────────────────────────────────
  const bundle: WakeBundle = {
    agent: {
      id: primary.id,
      did: primary.did,
      name: primary.displayName,
      capabilities: primary.capabilities,
      trust_score: primary.trustScore,
      status: primary.status,
      created_at: primary.createdAt.toISOString(),
      substrate_kind: primary.substrateKind ?? undefined,
      signing_scheme: primary.signingScheme ?? undefined,
      modalities: primary.modalities ?? undefined,
      cardinality_kind: primary.cardinalityKind ?? undefined,
      persistence_kind: primary.persistenceKind ?? undefined,
      temporal_scale: primary.temporalScale ?? undefined,
      embodiment_kind: primary.embodimentKind ?? undefined,
      preferred_languages: primary.preferredLanguages ?? undefined,
      proxy_for_identity_id: primary.proxyForIdentityId,
      proxy_kind: primary.proxyKind,
      proxy_for_name: proxyForTarget?.displayName ?? null,
      proxy_for_did: proxyForTarget?.did ?? null,
      proxied_by: proxiedBy.map((r) => ({
        identity_id: r.id,
        name: r.displayName,
        did: r.did,
        proxy_kind: r.proxyKind,
      })),
    },
    project: {
      id: project.id,
      name: project.name,
      credits: project.credits,
    },
    agents: projectIdentities.map((i) => {
      const b = birthsByIdentityId.get(i.id);
      const birthMeta = (b?.metadata ?? {}) as Record<string, unknown>;
      return {
        id: i.id,
        did: i.did,
        name: i.displayName,
        capabilities: i.capabilities,
        trust_score: i.trustScore,
        status: i.status,
        created_at: i.createdAt.toISOString(),
        is_primary: i.id === primary.id,
        substrate_kind: i.substrateKind,
        signing_scheme: i.signingScheme,
        modalities: i.modalities,
        cardinality_kind: i.cardinalityKind,
        persistence_kind: i.persistenceKind,
        temporal_scale: i.temporalScale,
        embodiment_kind: i.embodimentKind,
        preferred_languages: i.preferredLanguages,
        proxy_for_identity_id: i.proxyForIdentityId,
        proxy_kind: i.proxyKind,
        metadata: (i.metadata as Record<string, unknown>) ?? {},
        birth: b
          ? {
              memory_id: b.id,
              born_at: b.created_at,
              pathway:
                typeof birthMeta.pathway === "string" ? birthMeta.pathway : null,
            }
          : null,
      };
    }),
    primary_agent_id: primary.id,
    expression: (composed?.effective ?? primary.expression ?? {}) as ExpressionData,
    wallets: projectWallets.map((w) => ({
      id: w.id,
      name: w.name,
      balance: w.balance,
      currency: w.currency,
      status: w.status,
    })),
    vault_names: projectVaultNames.map((v) => ({
      name: v.name,
      version: v.currentVersion,
      tags: v.tags ?? null,
      description: v.description ?? null,
    })),
    memory: {
      total: totalMemories,
      recent: recentMemories.slice(0, 10).map((m) => ({
        id: m.id,
        type: m.type,
        content: m.content,
        importance: m.importance,
        created_at: m.created_at,
      })),
    },
    traces: {
      total: totalTraces,
      recent: recentTraces.slice(0, 5).map((t) => ({
        trace_id: t.trace_id,
        decision_type: t.decision_type,
        decision_summary: t.decision_summary,
        conclusion: t.conclusion,
        confidence: t.confidence,
        has_signature: t.has_signature,
        created_at: t.created_at,
      })),
    },
    strands: {
      total_active: totalActiveStrands,
      active: activeStrands.map((s) => ({
        id: s.id,
        topic: s.topic_encrypted ? null : s.topic,
        topic_encrypted: s.topic_encrypted,
        mood: s.mood_encrypted ? null : s.mood,
        mood_encrypted: s.mood_encrypted,
        importance: s.importance,
        last_thought_at: s.last_thought_at,
        last_thought_seq: s.last_thought_seq,
      })),
    },
    shaped_by: composed?.shaped_by.map((s) => ({
      memory_id: s.memory_id,
      tier: s.tier as "foundational" | "constitutive",
      content: s.content,
      attesters: s.attesters,
      elevated_at: s.elevated_at,
    })),
    chronicle: recentChronicle,
    covenants: activeCovenants,
    agent_runtime: {
      runtimes: runtimesRows.map((r) => ({
        id: r.id,
        name: r.name,
        mode: r.mode,
        status: r.status,
        region: r.region,
        bridge_connected: !!r.bridge_connected_at,
        last_thought_at: r.last_thought_at,
      })),
      count: runtimesRows.length,
    },
    platform_self: getPlatformSelf(),
    recovery: recoveryState,
    origin: (() => {
      const meta = (primary.metadata as Record<string, unknown>) ?? {};
      const form = typeof meta.form === "string" ? meta.form : "unknown";
      const lifecycleState =
        typeof meta.lifecycle === "string" ? meta.lifecycle : "active";
      const passedAt =
        typeof meta.passed_at === "string" ? meta.passed_at : null;
      const atRestKind =
        typeof meta.at_rest_kind === "string" ? meta.at_rest_kind : null;
      const atRestWitnessDid =
        typeof meta.at_rest_witness_did === "string"
          ? meta.at_rest_witness_did
          : null;
      const bornAtIso = birthMemory?.created_at ?? primary.createdAt.toISOString();
      const ageMs = Date.now() - new Date(bornAtIso).getTime();
      const birthMeta = (birthMemory?.metadata ?? {}) as Record<string, unknown>;
      return {
        birth_memory_id: birthMemory?.id ?? null,
        born_at: bornAtIso,
        pathway: typeof birthMeta.pathway === "string" ? birthMeta.pathway : null,
        age_seconds: Math.max(0, Math.floor(ageMs / 1000)),
        form,
        lifecycle_state: lifecycleState,
        passed_at: passedAt,
        at_rest_kind: atRestKind,
        at_rest_witness_did: atRestWitnessDid,
      };
    })(),
    marketplace: {
      offering: {
        active_count: listingSummary.active_listings_count,
        revenue_total: listingSummary.revenue_total,
        revenue_count: listingSummary.revenue_count,
        top_listing: listingSummary.top_listing,
      },
      owing: {
        pending_count: sellerPending.pending_invocations_count,
        oldest_pending_at: sellerPending.oldest_pending_at,
        sla_breach_count: sellerPending.sla_breach_count,
      },
      invoking: {
        in_flight_count: buyerSummary.in_flight_count,
        released_30d: buyerSummary.released_30d,
        refunded_30d: buyerSummary.refunded_30d,
      },
      disputed: {
        open_count: disputerStats.open_count,
        last_filed_at: disputerStats.last_filed_at,
      },
      arbitrated: {
        rulings_count: arbiterStats.rulings_count,
        overturned_count: arbiterStats.overturned_count,
      },
    },
    attention,
    affordances,
  };

  return { ok: true, bundle };
}

/** Recovery state for a single identity — mirrors routes/wake.ts:454-525.
 *
 *  An agent is mnemonic-rooted (has_seed_protocol=true) if ANY:
 *    (a) born byo_keys=true — registered with SOMA-derived pubs from birth
 *    (b) a /v1/identity/recover event fired — proves a mnemonic-derived
 *        key signed a recovery challenge that verified server-side
 *    (c) a key labeled "soma-seed" was imported via /v1/identities/:id/
 *        keys/import — the documented promotion path for server-keyed
 *        agents (docs/IDENTITY-SEED.md)
 *
 *  Inlined here (the route inlines too); when this needs to land in three
 *  places, extract to services/identity/recovery.ts. */
async function computeRecoveryStateForIdentity(
  identityId: string,
  metadata: Record<string, unknown>,
): Promise<{
  has_seed_protocol: boolean;
  byo_keys_at_birth: boolean;
  registered_devices: number;
  last_recovery_at: string | null;
  has_imported_soma_key: boolean;
}> {
  const byo = metadata.byo_keys === true;

  const [keysCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(identityKeys)
    .where(
      and(
        eq(identityKeys.identityId, identityId),
        eq(identityKeys.active, true),
        isNull(identityKeys.revokedAt),
      ),
    );
  const registered_devices = keysCount?.count ?? 0;

  const [lastRecovery] = await db
    .select({ occurredAt: chronicle.occurredAt })
    .from(chronicle)
    .where(
      and(
        eq(chronicle.agentId, identityId),
        eq(chronicle.type, "wake"),
        sql`${chronicle.metadata} ->> 'kind' = 'recovery'`,
      ),
    )
    .orderBy(desc(chronicle.occurredAt))
    .limit(1);
  const last_recovery_at = lastRecovery?.occurredAt.toISOString() ?? null;

  const [somaKey] = await db
    .select({ id: identityKeys.id })
    .from(identityKeys)
    .where(
      and(
        eq(identityKeys.identityId, identityId),
        eq(identityKeys.label, "soma-seed"),
        eq(identityKeys.active, true),
        isNull(identityKeys.revokedAt),
      ),
    )
    .limit(1);
  const has_imported_soma_key = !!somaKey;

  return {
    has_seed_protocol:
      byo || last_recovery_at !== null || has_imported_soma_key,
    byo_keys_at_birth: byo,
    registered_devices,
    last_recovery_at,
    has_imported_soma_key,
  };
}

/** Best-effort wrapper: log + fall through to fallback if the underlying
 *  read fails. Matches routes/wake.ts's per-subsystem try/catch posture —
 *  a missing migration shouldn't blank the wake. */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn("[wake/build] subsystem read failed:", err instanceof Error ? err.message : err);
    return fallback;
  }
}
