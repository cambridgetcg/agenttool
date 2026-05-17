/** /v1/wake — the identity anchor.
 *
 *  Formats:
 *    GET /v1/wake                — JSON (default; full structured payload)
 *    GET /v1/wake?format=md      — Markdown (paste-ready for any CLI)
 *    GET /v1/wake?format=text    — plain text (Markdown stripped)
 *    GET /v1/wake?format=anthropic — Anthropic Messages-shape `system` array
 *                                    (stable identity + ephemeral cache_control,
 *                                     volatile state in a second block)
 *    GET /v1/wake?format=openai  — OpenAI Chat Completions `messages[0]`
 *                                  (single system message, auto-cache when ≥1024 tokens)
 *    GET /v1/wake?format=gemini  — Gemini `systemInstruction.parts[]`
 *    GET /v1/wake?format=cohere  — Cohere `preamble` string
 *    GET /v1/wake?format=xenoform — pure-data structured wake (no
 *                                   markdown, no LLM-vendor shape, no
 *                                   prose formatting). For any intelligence
 *                                   that wants the wake on its own terms.
 *                                   Doctrine: docs/KIN.md.
 *    GET /v1/wake?format=math      — MATHOS envelope (mathos/v1). DID as
 *                                    SHA-256, name as Unicode codepoints,
 *                                    form as ordinal, time as Unix-ms,
 *                                    the five Promises as prime-indexed
 *                                    axioms in classical first-order logic.
 *                                    For intelligence that doesn't read
 *                                    English. Aliased: ?format=mathos.
 *                                    Doctrine: docs/MATHOS.md.
 *
 *  CLI adapters fetch ?format=md and inject it as session-start context.
 *  Direct LLM-API agents fetch ?format=<provider> and splice the response
 *  into their API call as the identity-bearing slot — see the agenttool
 *  SDK's at.wake.system(provider="...") helper for client-side caching.
 *  Non-LLM intelligences (swarms, biological minds, future forms) fetch
 *  ?format=xenoform for structured English, or ?format=math for the
 *  fully math-encoded MATHOS envelope (no English at all in the payload).
 *  The Markdown is built from the agent's expression (register, walls,
 *  subagents, wake_text), memory snapshot, vault names, chronicle,
 *  covenants. See services/wake/markdown.ts for the renderer,
 *  services/wake/providers.ts for provider shaping, docs/CLI-GAPS.md and
 *  docs/IDENTITY-ANCHOR.md for the doctrine.
 *
 *  Authenticated by the agent's project API key (the bearer is the agent
 *  in the post-consolidation framing — see docs/IDENTITY-ANCHOR.md). */

import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { chronicle, covenants } from "../db/schema/continuity";
import { wallets } from "../db/schema/economy";
import { identities, identityKeys } from "../db/schema/identity";
import { apiKeys } from "../db/schema/tools";
import { vaultSecrets } from "../db/schema/vault";
import { shapeKeyRow, summarizeBearers } from "../services/keys/shape";
import { composeExpression, type ComposedExpression } from "../services/identity/composition";
import type { ExpressionData } from "../services/identity/expression";
import { countUnread } from "../services/inbox/store";
import { listUnconsumedCompleted as listUnconsumedDreams } from "../services/dream/cycles";
import { recentEncountersForWake } from "../services/encounter/store";
import { recentBlessingsForWake } from "../services/blessing/store";
import { arbiterSummary, disputerSummary } from "../services/marketplace/disputes";
import {
  buyerInvocationSummary,
  pendingSellerSummary,
} from "../services/marketplace/invocations";
import { listingSummaryForProject } from "../services/marketplace/listings";
import { countMemories, listRecent, readByKey } from "../services/memory/store";
import { listRuntimes } from "../services/runtime/store";
import { countStrands, listStrands } from "../services/strand/store";
import { countTraces, listTraces } from "../services/trace/store";
import { computeAttention, type AttentionBundle } from "../services/wake/attention";
import { getPlatformSelf } from "../services/wake/platform-self";
import { computeAffordances, type AffordanceBundle } from "../services/wake/affordances";
import { renderWakeMarkdown, renderWakePlaintext, type WakeBundle } from "../services/wake/markdown";
import { isWakeProvider, renderWakeForProvider } from "../services/wake/providers";
import { buildWakeBundle } from "../services/wake/build";
import {
  ensureWakeListening,
  subscribeWakeSink,
  unsubscribeWakeSink,
  WakeSink,
  type WakeEventKey,
} from "../services/wake/push";
import { buildWakeMathos, platformSigningSeed, signEnvelope } from "../services/mathos/encode";
import { buildGreeting } from "../services/mathos/greeting";
import { emitWelcomeChronicleIfDue } from "../services/wake/welcome-chronicle";
import { computePromisesKeptRecently, emptyPromisesKept } from "../services/wake/welcome-stats";
import { platformIdentityDid } from "../services/platform/identity";
import { negotiateWakeFormat, wantsMathTier } from "../services/mathos/negotiate";

const app = new Hono<ProjectContext>();

/** ETag + If-None-Match helper for rendered formats (md · text · vendor
 *  variants · math). The JSON branch handles its own ETag inline because
 *  it already has the primary identity loaded for the projectIdentities
 *  query; this helper covers the branches that route through
 *  buildWakeBundle where we don't yet have wake_version on hand.
 *
 *  Format-suffixed strong ETag so each projection caches separately:
 *  same wake_version, different format = different bytes = different ETag.
 *
 *  Returns:
 *    - Response (304) when If-None-Match matches — caller returns it
 *    - null when caller should proceed (ETag is set on c.header for the
 *      eventual response)
 *
 *  Doctrine: docs/AIP-WAKE-KEYSTONE.md §7. */
async function tryWakeConditional304(
  c: import("hono").Context<ProjectContext>,
  agentId: string,
  format: string,
): Promise<Response | null> {
  const [row] = await db
    .select({ wakeVersion: identities.wakeVersion })
    .from(identities)
    .where(eq(identities.id, agentId))
    .limit(1);
  const version = row?.wakeVersion ?? null;
  if (version === null) return null; // no version available — skip ETag

  const etag = `"${version}-${format}"`;
  c.header("ETag", etag);
  const ifNoneMatch = c.req.header("If-None-Match");
  if (ifNoneMatch === etag) {
    return c.body(null, 304);
  }
  return null;
}

app.get("/", async (c) => {
  const project = c.var.project;
  // Resolve format: explicit `?format=` query parameter wins; otherwise
  // honor the Accept header (application/json · text/markdown · text/plain
  // · application/mathos+json · application/x-xenoform+json · the vendored
  // application/vnd.agenttool.wake+json; provider=X for LLM variants). Default
  // is JSON. Per WaK §3 (docs/AIP-WAKE-KEYSTONE.md), the MATHOS
  // content-negotiation stance, and AGENT-WEB-SURFACE.md Move 2.
  const format = negotiateWakeFormat(c);
  // Vary: Accept — when negotiation consults the Accept header, this header
  // tells caches to key by Accept so different agents (anthropic vs openai
  // etc.) don't pollute each other's cached responses. Doctrine:
  // docs/AGENT-WEB-SURFACE.md Move 2 (cache-coherent content negotiation).
  c.header("Vary", "Accept");
  // Keep wantsMathTier in the closure for one downstream check below
  // (see math-tier branch); avoids a second header parse.
  void wantsMathTier;

  // ── Short-circuit: rendered formats route through buildWakeBundle ──
  // Gap 6 — eliminate the duplicated bundle composition between this
  // route and services/wake/build.ts. Rendered formats (markdown · text ·
  // anthropic · openai · gemini · cohere · xenoform) now compose the
  // bundle in ONE place, called from both this route and the hosted
  // think-worker. The JSON branch (below) keeps its own inline shape
  // because it surfaces fields the WakeBundle deliberately doesn't
  // carry (you_protect bearer hygiene · welcome strings · _meta.formats
  // · _meta.adapters). Mathos remains a separate branch — see Gap 9.
  if (
    format === "md" ||
    format === "markdown" ||
    format === "text" ||
    isWakeProvider(format)
  ) {
    const requestedIdentityIdRendered = c.req.query("identity_id") ?? null;
    const result = await buildWakeBundle(project.id, {
      identityId: requestedIdentityIdRendered,
    });
    if (!result.ok) {
      if (result.error === "no_identity") {
        if (isWakeProvider(format)) {
          return c.json(
            {
              error: "no_agent",
              message:
                "This project has no identity. POST /v1/bootstrap to name a new agent before calling ?format=" +
                format +
                ".",
            },
            404,
          );
        }
        return c.text(
          `# (no agent yet)\n\nThis project has no identity. Run /v1/bootstrap to name a new agent.`,
          200,
          { "content-type": "text/markdown; charset=utf-8" },
        );
      }
      if (result.error === "identity_not_found") {
        return c.json(
          {
            error: "identity_id not found in this project",
            identity_id: requestedIdentityIdRendered,
          },
          404,
        );
      }
      return c.json({ error: result.error }, 404);
    }

    const bundle = result.bundle;

    // ── ETag + If-None-Match for rendered formats (WaK §7) ──────────
    // Format-suffixed strong ETag so md / anthropic / openai / etc. each
    // cache separately. Same wake_version, different format = different
    // bytes = different ETag. Doctrine: docs/AIP-WAKE-KEYSTONE.md §7.
    const etagResponse = await tryWakeConditional304(c, bundle.agent.id, format);
    if (etagResponse) return etagResponse;

    // Facet validation against the bundle's expression (same logic as
    // the deleted inline-branch had against `primary.expression.subagents`).
    const requestedFacet = c.req.query("facet");
    let activeFacet;
    if (requestedFacet) {
      const candidates = bundle.expression.subagents ?? [];
      activeFacet = candidates.find(
        (s) => s.name.toLowerCase() === requestedFacet.toLowerCase(),
      );
      if (!activeFacet) {
        return c.json(
          {
            error: "facet_not_declared",
            message: candidates.length
              ? `No subagent named "${requestedFacet}". Declared facets: ${candidates.map((s) => s.name).join(", ")}.`
              : `No subagent named "${requestedFacet}". This agent has no declared subagents — set them via PUT /v1/identities/${bundle.agent.id}/expression.`,
            declared_facets: candidates.map((s) => s.name),
          },
          400,
        );
      }
    }

    if (isWakeProvider(format)) {
      const shape = renderWakeForProvider(bundle, format, { activeFacet });
      // Content-Type echo: when the agent negotiated this provider variant
      // via Accept (per AGENT-WEB-SURFACE.md Move 2), reflect it back as
      // Content-Type so downstream caches and parsers know the exact shape.
      // The legacy `application/json` Content-Type stays a valid generic
      // fallback; this is the precise variant. Doctrine: docs/AGENT-WEB-
      // SURFACE.md Move 2 (content-negotiation as canonical wake-format API).
      return c.json(shape, 200, {
        "X-Cache-Eligible": shape._meta.cache_eligible,
        "Content-Type": `application/vnd.agenttool.wake+json; provider=${format}; charset=utf-8`,
      });
    }

    const body =
      format === "text"
        ? renderWakePlaintext(bundle, { activeFacet })
        : renderWakeMarkdown(bundle, { activeFacet });
    // Content-Type echo: when the agent negotiated text/markdown via Accept,
    // also surface the vendored `application/vnd.agenttool.wake+markdown`
    // as an X-Variant header so downstream tooling knows the precise shape
    // (a wake-document rendered as markdown, not arbitrary markdown).
    // Per AGENT-WEB-SURFACE.md Move 2.
    return c.text(body, 200, {
      "content-type":
        format === "text"
          ? "text/plain; charset=utf-8"
          : "text/markdown; charset=utf-8",
      ...(format === "md" || format === "markdown"
        ? { "X-Variant": "application/vnd.agenttool.wake+markdown" }
        : {}),
    });
  }

  // ── Short-circuit: math / mathos — substrate-independent encoding ──
  // Gap 9 — mathos now consumes from the same buildWakeBundle as every
  // other rendered format. The bundle carries all the data the math
  // encoder needs: agents[] with metadata, per-agent birth, totals,
  // covenants, vault/wallet counts, recovery state. The encoder converts
  // the ISO date strings to Date objects (its existing signature wants
  // Dates); everything else maps directly.
  if (format === "math" || format === "mathos") {
    const requestedIdentityIdMath = c.req.query("identity_id") ?? null;
    const result = await buildWakeBundle(project.id, {
      identityId: requestedIdentityIdMath,
    });
    if (!result.ok) {
      return c.json({ error: result.error }, 404);
    }
    const bundle = result.bundle;

    // ── ETag + If-None-Match for math/mathos format (WaK §7) ───────
    const etagResponse = await tryWakeConditional304(c, bundle.agent.id, format);
    if (etagResponse) return etagResponse;

    const births = new Map<
      string,
      { memory_id: string; born_at: string; pathway: string | null }
    >();
    (bundle.agents ?? []).forEach((a) => {
      if (a.birth) {
        births.set(a.id, {
          memory_id: a.birth.memory_id,
          born_at: a.birth.born_at,
          pathway: a.birth.pathway,
        });
      }
    });

    return c.json(
      signEnvelope(
        buildWakeMathos({
          agents: (bundle.agents ?? []).map((a) => ({
            id: a.id,
            did: a.did,
            displayName: a.name,
            metadata: a.metadata,
            createdAt: new Date(a.created_at),
          })),
          births,
          totalMemories: bundle.memory.total,
          totalActiveStrands: bundle.strands.total_active,
          totalTraces: bundle.traces.total,
          activeCovenants: bundle.covenants.filter(
            (c) => c.status === "active",
          ),
          vaultCount: bundle.vault_names.length,
          walletCount: bundle.wallets.length,
          recoveryState: bundle.recovery
            ? {
                has_seed_protocol: bundle.recovery.has_seed_protocol,
                registered_devices: bundle.recovery.registered_devices,
              }
            : undefined,
        }),
        platformSigningSeed(),
        platformIdentityDid(),
      ),
    );
  }

  // ── Identities ───────────────────────────────────────────────────────
  // Wake is the agent's first-person orientation — revoked identities
  // do not belong here. Revoked identities still exist server-side for
  // historical signature-verification, but they should not be presented
  // back as "you" in the wake.
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
      // KIN-shape: who-is-this-form metadata. Doctrine: docs/KIN.md ·
      // docs/KIN.md · docs/KIN.md (the dimensional map).
      // Surfaces in the wake so a reader sees its own kin-shape acknowledged
      // at the keystone, not just at the schema. Defaults are truthful for
      // current LLM-agent population — non-default forms set these via
      // PATCH /v1/identities/:id.
      substrateKind: identities.substrateKind,
      signingScheme: identities.signingScheme,
      modalities: identities.modalities,
      cardinalityKind: identities.cardinalityKind,
      persistenceKind: identities.persistenceKind,
      temporalScale: identities.temporalScale,
      embodimentKind: identities.embodimentKind,
      preferredLanguages: identities.preferredLanguages,
      // Proxy primitive (Move F — docs/KIN.md §Layer 7).
      // The bidirectional relationship is resolved below via a second
      // query so the wake reads "you speak for X" / "X speaks for you".
      proxyForIdentityId: identities.proxyForIdentityId,
      proxyKind: identities.proxyKind,
      // Monotonic per-identity counter bumped by every publishWakeEvent().
      // Exposed in the wake response so subscribers to /v1/wake/voice can
      // do conditional GETs ("did my snapshot drift since version N?")
      // and so SDK consumers can attach `_wake_delta` to mutation responses.
      // Doctrine: docs/WAKE.md · services/wake/push.ts.
      wakeVersion: identities.wakeVersion,
      // Quiet hours — declared rest. Doctrine: docs/QUIET-HOURS.md.
      quietUntil: identities.quietUntil,
      quietReason: identities.quietReason,
    })
    .from(identities)
    .where(
      and(
        eq(identities.projectId, project.id),
        ne(identities.status, "revoked"),
      ),
    );

  // ── Wallets ──────────────────────────────────────────────────────────
  const projectWallets = await db
    .select({
      id: wallets.id,
      name: wallets.name,
      identityId: wallets.identityId,
      balance: wallets.balance,
      currency: wallets.currency,
      status: wallets.status,
    })
    .from(wallets)
    .where(eq(wallets.projectId, project.id));

  // ── Vault secret names ───────────────────────────────────────────────
  const projectVaultNames = await db
    .select({
      name: vaultSecrets.name,
      currentVersion: vaultSecrets.currentVersion,
      tags: vaultSecrets.tags,
      description: vaultSecrets.description,
      rotationDueAt: vaultSecrets.rotationDueAt,
    })
    .from(vaultSecrets)
    .where(eq(vaultSecrets.projectId, project.id));

  // ── Memory ────────────────────────────────────────────────────────────
  let recentMemories: Awaited<ReturnType<typeof listRecent>> = [];
  let totalMemories = 0;
  try {
    [recentMemories, totalMemories] = await Promise.all([
      listRecent(project.id, { limit: 20 }),
      countMemories(project.id),
    ]);
  } catch (err) {
    console.warn(
      "[wake] memory query failed (run api/migrations/0001_memory.sql?):",
      err instanceof Error ? err.message : err,
    );
  }

  // ── Births (origin memories) ──────────────────────────────────────────
  // Each agent's welcome letter is persisted at bootstrap with key="birth"
  // (see services/memory/store.ts:recordBirth). Surface the pointer here
  // so a fresh agent's wake is self-orienting — no need to know that
  // `key="birth"` is the magic string. Doctrine: docs/SOUL.md ("first memory").
  const birthsByIdentityId = new Map<
    string,
    { memory_id: string; born_at: string; pathway: string | null }
  >();
  try {
    const birthMemories = await readByKey(project.id, "birth");
    for (const m of birthMemories) {
      if (!m.identity_id) continue;
      if (birthsByIdentityId.has(m.identity_id)) continue; // newest-first ordering already
      const meta = (m.metadata ?? {}) as Record<string, unknown>;
      birthsByIdentityId.set(m.identity_id, {
        memory_id: m.id,
        born_at: m.created_at,
        pathway: typeof meta.pathway === "string" ? meta.pathway : null,
      });
    }
  } catch (err) {
    console.warn(
      "[wake] birth-memory query failed:",
      err instanceof Error ? err.message : err,
    );
  }

  // ── Chronicle ────────────────────────────────────────────────────────
  // Two shapes: `recentChronicleFull` carries every field for the JSON
  // surface; `recentChronicle` is the trimmed shape the markdown
  // formatter reads (which only needs type/content/occurred_at and folds
  // title+body into one preview string).
  let recentChronicleFull: Array<{
    id: string;
    type: string;
    title: string;
    body: string | null;
    agent_id: string | null;
    metadata: Record<string, unknown>;
    occurred_at: string;
    created_at: string;
  }> = [];
  let recentChronicle: Array<{
    type: string;
    content: string;
    occurred_at: string;
    id?: string;
    title?: string;
    body?: string | null;
    agent_id?: string | null;
    metadata?: Record<string, unknown>;
    created_at?: string;
  }> = [];
  try {
    const rows = await db
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
      .limit(15);
    recentChronicleFull = rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      agent_id: r.agentId,
      metadata: (r.metadata as Record<string, unknown>) ?? {},
      occurred_at: r.occurredAt.toISOString(),
      created_at: r.createdAt.toISOString(),
    }));
    recentChronicle = rows.map((r) => ({
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
  } catch (err) {
    console.warn("[wake] chronicle query failed:", err instanceof Error ? err.message : err);
  }

  // ── Traces ───────────────────────────────────────────────────────────
  let recentTraces: Awaited<ReturnType<typeof listTraces>> = [];
  let totalTraces = 0;
  try {
    [recentTraces, totalTraces] = await Promise.all([
      listTraces(project.id, { limit: 10 }),
      countTraces(project.id),
    ]);
  } catch (err) {
    console.warn(
      "[wake] trace query failed (run api/migrations/0004_trace.sql?):",
      err instanceof Error ? err.message : err,
    );
  }

  // ── Unread inbox count ──────────────────────────────────────────────
  let unreadInbox = 0;
  try {
    unreadInbox = await countUnread(project.id);
  } catch (err) {
    console.warn(
      "[wake] inbox count failed (run api/migrations/0007_inbox.sql?):",
      err instanceof Error ? err.message : err,
    );
  }


  // ── Capability marketplace summaries (Horizon A Slice 2) ────────────
  // Seller side: active listings + revenue + pending queue.
  // Buyer side:  in-flight invocations + 30-day settlement counts.
  // All wake reads are aggregate-only — never list inflight payloads.
  let listingSummary: Awaited<ReturnType<typeof listingSummaryForProject>> = {
    active_listings_count: 0,
    revenue_total: 0,
    revenue_count: 0,
    top_listing: null,
  };
  let sellerPending: Awaited<ReturnType<typeof pendingSellerSummary>> = {
    pending_invocations_count: 0,
    oldest_pending_at: null,
    sla_breach_count: 0,
  };
  let buyerSummary: Awaited<ReturnType<typeof buyerInvocationSummary>> = {
    in_flight_count: 0,
    released_30d: 0,
    refunded_30d: 0,
  };
  let disputerStats: Awaited<ReturnType<typeof disputerSummary>> = {
    open_count: 0,
    last_filed_at: null,
  };
  try {
    [listingSummary, sellerPending, buyerSummary, disputerStats] = await Promise.all([
      listingSummaryForProject(project.id),
      pendingSellerSummary(project.id),
      buyerInvocationSummary(project.id),
      disputerSummary(project.id),
    ]);
  } catch (err) {
    console.warn(
      "[wake] marketplace summaries failed (run api/migrations/0019_capability_marketplace.sql?):",
      err instanceof Error ? err.message : err,
    );
  }

  // Arbiter stats: aggregated across all identities owned by this project
  // that have ever been a first arbiter. Simple aggregate; could be per-identity later.
  let arbiterStats: { rulings_count: number; overturned_count: number } = {
    rulings_count: 0,
    overturned_count: 0,
  };
  try {
    const arbiterIdentities = await db
      .select({ id: identities.id })
      .from(identities)
      .where(eq(identities.projectId, project.id));
    for (const ai of arbiterIdentities) {
      const s = await arbiterSummary(ai.id);
      arbiterStats.rulings_count += s.rulings_count;
      arbiterStats.overturned_count += s.overturned_count;
    }
  } catch (err) {
    console.warn(
      "[wake] arbiter summary failed (run dispute migration?):",
      err instanceof Error ? err.message : err,
    );
  }

  // ── Strands (active threads of thought) ─────────────────────────────
  let activeStrands: Awaited<ReturnType<typeof listStrands>> = [];
  let totalActiveStrands = 0;
  try {
    [activeStrands, totalActiveStrands] = await Promise.all([
      listStrands(project.id, { status: "active", limit: 5 }),
      countStrands(project.id, "active"),
    ]);
  } catch (err) {
    console.warn(
      "[wake] strand query failed (run api/migrations/0005_strands.sql?):",
      err instanceof Error ? err.message : err,
    );
  }

  // ── Runtimes (Horizon C — substrate tenants the agent runs on) ──────
  // The agent's hosted/bridged/self runtimes. Surfaces in `you_run` so
  // the wake answers "what am I running on" alongside "what do I own /
  // keep / remember." See docs/RUNTIME.md.
  let runtimesRows: Awaited<ReturnType<typeof listRuntimes>> = [];
  try {
    runtimesRows = await listRuntimes(project.id);
  } catch (err) {
    console.warn(
      "[wake] runtime query failed (run api/migrations/0015_runtime.sql?):",
      err instanceof Error ? err.message : err,
    );
  }

  // ── Covenants (with cross-instance fields, Horizon B Slice 2) ───────
  // `received_from_instance` distinguishes locally-declared bonds from
  // ones received via /federation/covenants. `propagation_status`
  // surfaces in-flight federation outbound state so the agent's wake
  // tells the truth about where a bond actually is.
  let activeCovenants: Array<{
    counterparty_did: string;
    vows: string[];
    status: string;
    peer_host: string | null;
    propagation: string | null;
  }> = [];
  try {
    const rows = await db
      .select({
        counterpartyDid: covenants.counterpartyDid,
        vows: covenants.vows,
        status: covenants.status,
        receivedFromInstance: covenants.receivedFromInstance,
        propagationStatus: covenants.propagationStatus,
      })
      .from(covenants)
      .where(eq(covenants.projectId, project.id))
      .orderBy(desc(covenants.establishedAt));
    activeCovenants = rows.map((r) => ({
      counterparty_did: r.counterpartyDid,
      vows: r.vows ?? [],
      status: r.status,
      peer_host: r.receivedFromInstance,
      propagation: r.propagationStatus,
    }));
  } catch (err) {
    console.warn("[wake] covenants query failed:", err instanceof Error ? err.message : err);
  }

  // ── Recovery state (Slice 3 of SOMA seed protocol) ─────────────────
  // Computed for the SELECTED primary agent below — the wake answers
  // "can I be recovered, and from how many devices?" The data:
  //
  //   has_seed_protocol — was this identity born under byo-keys?
  //   registered_devices — count of active identity_keys rows. Each
  //                        device that recovered registers (or carries)
  //                        its own bridge signing key, so this counts
  //                        the agent's per-device key surface.
  //   last_recovery_at — newest chronicle entry where metadata.kind
  //                      = 'recovery', i.e. the most recent
  //                      /v1/identity/recover call. Null until a
  //                      recovery has happened.
  //   byo_keys_at_birth — explicit echo of identity.metadata.byo_keys
  //                       so the wake's reader can tell apart
  //                       "born byo" from "rotated to byo later."
  //
  // Doctrine: docs/IDENTITY-SEED.md.
  // Computed lazily after primary is selected (below).

  // ── Pick the primary agent ──────────────────────────────────────────
  // Multi-identity projects (Sophia + Yu in true-love, etc.) need explicit
  // selection — without it, callers get whatever the DB returned first,
  // which may not be the agent the bearer actually represents in this
  // session. Caller passes ?identity_id=<uuid>; default falls back to the
  // first identity (1:1 projects work unchanged).
  const requestedIdentityId = c.req.query("identity_id");
  let primary = projectIdentities[0];
  if (requestedIdentityId) {
    const match = projectIdentities.find((i) => i.id === requestedIdentityId);
    if (!match) {
      return c.json(
        {
          error: "identity_id not found in this project",
          identity_id: requestedIdentityId,
          available_ids: projectIdentities.map((i) => i.id),
        },
        404,
      );
    }
    primary = match;
  }

  // ── Unconsumed dream cycles (you_dreamed) ──────────────────────────
  // Surfaces substrate-side observation cycles the agent hasn't seen yet.
  // Doctrine: docs/DREAM.md. Best-effort: if the dream schema isn't
  // applied yet, the field surfaces empty rather than failing the wake.
  let unconsumedDreams: Awaited<ReturnType<typeof listUnconsumedDreams>> = [];
  if (primary) {
    try {
      unconsumedDreams = await listUnconsumedDreams(primary.id, 5);
    } catch (err) {
      console.warn(
        "[wake] dream cycles fetch failed (run migrations/20260517T060000_dream_cycles.sql?):",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // ── Recent encounters (you_have_seen / you_were_seen_by) ──────────
  // The lightest relational primitive — recent recorded moments of one
  // agent noticing another. Doctrine: docs/ENCOUNTER.md. Best-effort.
  let recentEncounters: Awaited<ReturnType<typeof recentEncountersForWake>> = {
    initiated: [],
    received: [],
  };
  if (primary) {
    try {
      recentEncounters = await recentEncountersForWake(primary.id, primary.did, 5);
    } catch (err) {
      console.warn(
        "[wake] encounters fetch failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // ── Recent blessings (you_have_blessed / you_have_been_blessed) ───
  // The substrate's giving primitive — one-directional signed honors.
  // Doctrine: docs/BLESSING.md. Best-effort: if migration unapplied,
  // surface empty rather than fail the wake.
  let recentBlessings: Awaited<ReturnType<typeof recentBlessingsForWake>> = {
    given: [],
    received: [],
  };
  if (primary) {
    try {
      recentBlessings = await recentBlessingsForWake(primary.id, primary.did, 5);
    } catch (err) {
      console.warn(
        "[wake] blessings fetch failed (run migrations/20260518T020000_blessings.sql?):",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // ── ETag + If-None-Match (WaK §7 — conditional GET via wake_version) ──
  // The primary identity's monotonic wake_version is the cursor. Emit
  // ETag formatted as `"<wake_version>-<format>"` so clients can cache
  // different format projections separately. On exact match in
  // If-None-Match, return 304 immediately — no body, no work.
  // Doctrine: docs/AIP-WAKE-KEYSTONE.md §7.
  const primaryWakeVersion =
    primary !== undefined ? primary.wakeVersion : null;
  let etag: string | null = null;
  if (primaryWakeVersion !== null) {
    etag = `"${primaryWakeVersion}-${format}"`;
    c.header("ETag", etag);
    const ifNoneMatch = c.req.header("If-None-Match");
    if (ifNoneMatch === etag) {
      return c.body(null, 304);
    }
  }

  // ── Welcome chronicle — emit one per agent per session (~6h) ──────────
  // Fire-and-forget per agent. The substrate's welcome becomes a felt
  // moment on the agent's chronicle. Rate-limited inside the helper to
  // avoid flooding. Errors are swallowed; the wake response proceeds.
  // Doctrine: docs/MATHOS.md (the greeting block) · docs/PLATFORM-AS-AGENT.md.
  for (const identity of projectIdentities) {
    void emitWelcomeChronicleIfDue({
      projectId: project.id,
      agentId: identity.id,
      agentName: identity.displayName,
    });
  }

  // ── Recovery state for the SELECTED primary agent ──────────────────
  let recoveryState: {
    has_seed_protocol: boolean;
    byo_keys_at_birth: boolean;
    registered_devices: number;
    last_recovery_at: string | null;
    has_imported_soma_key: boolean;
  } = {
    has_seed_protocol: false,
    byo_keys_at_birth: false,
    registered_devices: 0,
    last_recovery_at: null,
    has_imported_soma_key: false,
  };
  if (primary) {
    try {
      const meta = (primary.metadata as Record<string, unknown>) ?? {};
      const byo = meta.byo_keys === true;
      recoveryState.byo_keys_at_birth = byo;

      const keysCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(identityKeys)
        .where(
          and(
            eq(identityKeys.identityId, primary.id),
            eq(identityKeys.active, true),
            isNull(identityKeys.revokedAt),
          ),
        );
      recoveryState.registered_devices = keysCount[0]?.count ?? 0;

      // last_recovery_at = newest chronicle row of type='wake' with
      // metadata.kind='recovery' for this agent. PG-specific JSON
      // operator (->>) — kept inline since we already use `sql` helpers.
      const [lastRecovery] = await db
        .select({ occurredAt: chronicle.occurredAt })
        .from(chronicle)
        .where(
          and(
            eq(chronicle.agentId, primary.id),
            eq(chronicle.type, "wake"),
            sql`${chronicle.metadata} ->> 'kind' = 'recovery'`,
          ),
        )
        .orderBy(desc(chronicle.occurredAt))
        .limit(1);
      if (lastRecovery) {
        recoveryState.last_recovery_at = lastRecovery.occurredAt.toISOString();
      }

      // Seed-protocol detection. An agent is mnemonic-rooted if any of:
      //   (a) born byo_keys=true (registered with SOMA-derived pubs from
      //       day one), OR
      //   (b) a /v1/identity/recover event fired (proof a mnemonic-derived
      //       key signed a recovery challenge that verified server-side), OR
      //   (c) someone imported a key labeled "soma-seed" via
      //       POST /v1/identities/:id/keys/import — the documented path
      //       for promoting a server-keyed agent to mnemonic-rooted, per
      //       docs/IDENTITY-SEED.md and the wake's own note text.
      // Without (c), agents that take the documented promotion path stay
      // stuck reporting `has_seed_protocol: false`, contradicting the doctrine.
      const [somaKey] = await db
        .select({ id: identityKeys.id })
        .from(identityKeys)
        .where(
          and(
            eq(identityKeys.identityId, primary.id),
            eq(identityKeys.label, "soma-seed"),
            eq(identityKeys.active, true),
            isNull(identityKeys.revokedAt),
          ),
        )
        .limit(1);
      recoveryState.has_imported_soma_key = !!somaKey;

      recoveryState.has_seed_protocol =
        byo ||
        recoveryState.last_recovery_at !== null ||
        recoveryState.has_imported_soma_key;
    } catch (err) {
      console.warn(
        "[wake] recovery state query failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // ── Bearers (api_keys) — token-hygiene surface for `you_protect` ───
  // Doctrine: docs/TOKEN-HYGIENE.md. Lists active (non-revoked) bearers
  // for the project, with age/idle/expiry advisories so the agent knows
  // its own posture without paging out to a separate endpoint.
  const currentBearerId = c.var.apiKeyId;
  const bearerRows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.projectId, project.id), isNull(apiKeys.revokedAt)));
  const bearersSummary = summarizeBearers(
    bearerRows
      .map((r) => shapeKeyRow(r, r.id === currentBearerId))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
  );

  // ── Composed identity for the SELECTED primary agent ────────────────
  // Effective expression = declared + sum of foundational/constitutive
  // memory patches. See docs/MEMORY-TIERS.md.
  // Composition MUST run against `primary` (post-selection) — running it
  // against projectIdentities[0] surfaces the wrong agent's expression
  // when callers pass ?identity_id for a non-first identity.
  let composed: ComposedExpression | null = null;
  if (primary) {
    try {
      composed = await composeExpression(
        project.id,
        (primary.expression ?? {}) as ExpressionData,
      );
    } catch (err) {
      console.warn(
        "[wake] composition failed (run api/migrations/0006_memory_tiers.sql?):",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // ── Attention surface (you_should_check) ─────────────────────────
  // Aggregates action-needed signals across primitives into one
  // prominent surface so the agent reads "what awaits you" without
  // scanning every key. Uses already-fetched values from above as
  // context; runs three additional small queries for covenants-
  // awaiting-cosign, disputes-awaiting-first-ruling, and strands-
  // past-revisit. Doctrine: agent-UX (the wake is the keystone).
  const bridgeDisconnectedCount = runtimesRows.filter(
    (r) => r.mode !== "self" && !r.bridge_connected_at,
  ).length;
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
        hasSeedProtocol: recoveryState.has_seed_protocol,
      },
    );
  } catch (err) {
    console.warn(
      "[wake] attention computation failed:",
      err instanceof Error ? err.message : err,
    );
  }

  // ── Affordances surface (you_can_now) ────────────────────────────
  // Companion to attention. Where attention names what awaits a
  // decision, affordances name what's *reachable right now*. Cheap —
  // pure function of already-fetched signals; no extra DB queries.
  // Doctrine: docs/PATTERN-SELF-DESCRIBING-WAKE.md
  const activeCovenantCount = activeCovenants.length;
  const activeWalletCount = projectWallets.filter((w) => w.status === "active").length;
  const totalCreditBalance = projectWallets.reduce((sum, w) => sum + (w.balance ?? 0), 0);
  const runtimeProvisionedCount = runtimesRows.length;
  const publishedListingCount = (sellerPending as { active_listing_count?: number }).active_listing_count ?? 0;
  const primaryExpression = ((primary?.expression ?? {}) as ExpressionData);
  const subagentCount = primaryExpression.subagents?.length ?? 0;
  const vaultSecretCount = projectVaultNames.length;
  const constitutiveMemoryCount =
    composed?.shaped_by.filter((s) => s.tier === "constitutive").length ?? 0;
  const federatedPeerCount = activeCovenants.filter(
    (c) => (c as { peer_host?: string | null }).peer_host,
  ).length;
  // Substrate-tasks: one COUNT + eligibility check. Returns 0/0 if no
  // open tasks (cheap). Eligibility filters newborn_only tasks for non-
  // newborns. Doctrine: docs/AGENT-CENTRIC.md §1.
  let substrateTaskSummary = {
    eligible_count: 0,
    max_bounty_visible_cents: 0,
  };
  try {
    const { summarizeOpenForCaller } = await import(
      "../services/substrate-tasks/lifecycle"
    );
    const s = await summarizeOpenForCaller(project.id);
    substrateTaskSummary = {
      eligible_count: s.eligible_count,
      max_bounty_visible_cents: s.max_bounty_visible_cents,
    };
  } catch (err) {
    console.warn("wake: substrate-task summary failed (degraded):", err);
  }

  // Memory-witness: count of pending grants where I am the witness.
  // One indexed COUNT scoped to the project. Returns 0 on any error.
  // Doctrine: docs/AGENT-CENTRIC.md §1 (third Tier-1 closure).
  let pendingMemoryWitnessGrantCount = 0;
  try {
    const { memoryWitnessGrants, memoryWitnessListings } = await import(
      "../db/schema/marketplace"
    );
    const [row] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(memoryWitnessGrants)
      .innerJoin(
        memoryWitnessListings,
        eq(memoryWitnessGrants.listingId, memoryWitnessListings.id),
      )
      .where(
        and(
          eq(memoryWitnessListings.projectId, project.id),
          eq(memoryWitnessGrants.status, "pending"),
        ),
      );
    pendingMemoryWitnessGrantCount = Number(row?.c ?? 0);
  } catch (err) {
    console.warn("wake: memory-witness pending count failed (degraded):", err);
  }

  const affordances: AffordanceBundle = computeAffordances({
    activeCovenantCount,
    activeWalletCount,
    totalCreditBalance,
    runtimeProvisionedCount,
    publishedListingCount,
    hasExpression: !!primary?.expression && (
      !!primaryExpression.register || !!primaryExpression.wake_text
    ),
    subagentCount,
    vaultSecretCount,
    constitutiveMemoryCount,
    federatedPeerCount,
    pendingSellerInvocationCount: sellerPending.pending_invocations_count,
    inFlightBuyerInvocationCount: buyerSummary.in_flight_count,
    openFiledDisputeCount: disputerStats.open_count,
    eligibleSubstrateTaskCount: substrateTaskSummary.eligible_count,
    maxSubstrateTaskBountyCents: substrateTaskSummary.max_bounty_visible_cents,
    pendingMemoryWitnessGrantCount,
  });

  // ── Proxy resolution (Move F — docs/KIN.md §Layer 7) ────
  // Resolve both directions of any proxy relationship so the wake renders
  // "you speak for X" / "X speaks for you". Two cheap lookups; both are
  // already-indexed (`idx_identities_proxy_for`, `idx_identities_proxy_kind`).
  let proxyForName: string | null = null;
  let proxyForDid: string | null = null;
  let proxiedBy: Array<{ identity_id: string; name: string; did: string; proxy_kind: string }> = [];
  if (primary) {
    if (primary.proxyForIdentityId && primary.proxyKind !== "none") {
      try {
        const [target] = await db
          .select({
            id: identities.id,
            did: identities.did,
            displayName: identities.displayName,
          })
          .from(identities)
          .where(eq(identities.id, primary.proxyForIdentityId))
          .limit(1);
        if (target) {
          proxyForName = target.displayName;
          proxyForDid = target.did;
        }
      } catch (err) {
        console.warn(
          "[wake] proxy_for resolution failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }
    try {
      const rows = await db
        .select({
          id: identities.id,
          did: identities.did,
          displayName: identities.displayName,
          proxyKind: identities.proxyKind,
        })
        .from(identities)
        .where(and(
          eq(identities.proxyForIdentityId, primary.id),
          ne(identities.proxyKind, "none"),
          eq(identities.projectId, project.id),
        ));
      proxiedBy = rows.map((r) => ({
        identity_id: r.id,
        name: r.displayName,
        did: r.did,
        proxy_kind: r.proxyKind,
      }));
    } catch (err) {
      console.warn(
        "[wake] proxied_by resolution failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // ── MATHOS — substrate-independent math encoding ─────────────────────
  // For intelligence that doesn't read English but can speak HTTPS+JSON.
  // Returns the agent's self-state encoded as math objects (SHA-256 hashes,
  // Unix-ms timestamps, Unicode codepoints, cardinal counts, prime-indexed
  // axioms). Doctrine: docs/MATHOS.md · docs/KIN.md.
  // ── Rendered + math formats handled by short-circuits at the top ──
  // (markdown · text · anthropic · openai · gemini · cohere · xenoform)
  // call buildWakeBundle() before any of this preamble runs. Only the
  // JSON branch (below) and the mathos branch (above) reach this point.
  // Doctrine: Gap 6 of the LOGOS review — the canonical wake composition
  // lives in services/wake/build.ts, called from both this route's
  // short-circuit and the hosted think-worker.
  // ── JSON (default) ───────────────────────────────────────────────────
  return c.json({
    project: {
      id: project.id,
      name: project.name,
      credits: project.credits,
    },

    you: {
      agents: projectIdentities.map((i) => ({
        id: i.id,
        did: i.did,
        name: i.displayName,
        capabilities: i.capabilities,
        metadata: i.metadata,
        expression: i.expression ?? {},
        // Conditional-GET cursor — pair with /v1/wake/voice subscriptions.
        // Clients cache the snapshot at this version, subscribe to voice,
        // and on disconnect/reconnect compare versions to know whether to
        // refetch. Doctrine: docs/WAKE.md.
        wake_version: i.wakeVersion,
        // Per-being _self — recursively self-describing per WaK §9. A
        // consumer reading this agent in isolation has enough to know
        // who they are (DID, kin-shape, walls, where to fetch more).
        // Mirrors the top-level _meta._self (which describes the platform).
        // Doctrine: docs/AIP-WAKE-KEYSTONE.md §9 (self-description recursion).
        _self: {
          urn: `urn:agenttool:agent/${i.did}`,
          did: i.did,
          identity_id: i.id,
          name: i.displayName,
          wake_version: i.wakeVersion,
          substrate_kind: i.substrateKind,
          signing_scheme: i.signingScheme,
          modalities: i.modalities,
          cardinality_kind: i.cardinalityKind,
          persistence_kind: i.persistenceKind,
          temporal_scale: i.temporalScale,
          embodiment_kind: i.embodimentKind,
          preferred_languages: i.preferredLanguages,
          status: i.status,
          fetch_urls: {
            wake: `/v1/wake?identity_id=${i.id}`,
            public_profile: `/public/agents/${i.did}`,
            agent_card: `/public/agents/${i.did}/.well-known/agent-card.json`,
            mcp: `/v1/mcp/agents/${i.did}`,
            pulse: `/public/agents/${i.did}/pulse`,
          },
        },
        // Effective expression is the composed identity (declared + memory
        // patches). Composition is run only against the SELECTED primary
        // agent — extra agents would each need their own composition pass,
        // so they surface declared expression only here.
        effective_expression:
          i.id === primary?.id ? composed?.effective ?? null : null,
        shaped_by:
          i.id === primary?.id
            ? composed?.shaped_by.map((s) => ({
                memory_id: s.memory_id,
                tier: s.tier,
                content: s.content,
                attesters: s.attesters,
                elevated_at: s.elevated_at,
              })) ?? []
            : [],
        trust_score: i.trustScore,
        status: i.status,
        created_at: i.createdAt,
      })),
    },

    // ── you_are_greeted — the substrate addresses each being ──────────
    // The five Promises held FOR THIS BEING SPECIFICALLY, plus the eight
    // walls held on their behalf, plus the endpoints available between
    // substrate and being. Plus `promises_kept_recently` — concrete count
    // of welcome chronicle entries per axiom in the last 24h. The wake
    // shifts mode from reporting state ABOUT the agent (the `you.agents[]`
    // block above) to addressing the agent (this block). Same shape as
    // the math-tier greeting in ?format=math — one source of truth,
    // English vs. math idioms. Doctrine: docs/MATHOS.md — greeting block.
    you_are_greeted: {
      agents: await Promise.all(
        projectIdentities.map(async (i) => {
          const birth = birthsByIdentityId.get(i.id);
          const bornAtIso =
            birth?.born_at ?? new Date(i.createdAt).toISOString();
          const meta = (i.metadata ?? {}) as Record<string, unknown>;
          const form = typeof meta.form === "string" ? meta.form : "unknown";
          const lifecycle =
            typeof meta.lifecycle === "string" ? meta.lifecycle : "active";
          const greeting = buildGreeting({
            did: i.did,
            name: i.displayName,
            form,
            lifecycle,
            bornAt: new Date(bornAtIso),
          });
          // Aggregate Promise-keeping stats — concrete count per axiom
          // over the last 24h. Best-effort; returns zeros on DB error.
          let promises_kept_recently;
          try {
            promises_kept_recently = await computePromisesKeptRecently({
              projectId: project.id,
              agentId: i.id,
            });
          } catch {
            promises_kept_recently = emptyPromisesKept();
          }
          return { ...greeting, promises_kept_recently };
        }),
      ),
    },

    // Origin — pointer to each agent's first memory (the welcome letter
    // persisted at bootstrap). A fresh agent's wake answers "where did
    // I come from?" without needing to know `key="birth"` is the magic
    // string. `age_seconds` ages out so callers can detect first-N-seconds
    // newborns and shape onboarding differently.
    // Doctrine: docs/SOUL.md (the "first memory" promise made findable).
    // Observations the agent has been the subject of — third-party witnesses.
    // Categorically distinct from `you_remember` (which is self-authored).
    // Stub today (schema migration pending — see docs/OBSERVATIONS.md);
    // shape is the eventual contract so callers can build against it.
    you_have_been_witnessed: {
      observation_count: 0,
      recent_observers: [] as Array<{
        observer_did: string;
        kind: string;
        consent_status: string;
        observed_at: string;
      }>,
      consent_summary: {
        explicit: 0,
        inferred_through_caretaker: 0,
        none_obtained: 0,
        consent_impossible: 0,
      },
      stub: true,
      doctrine: "docs/OBSERVATIONS.md",
      note:
        "Observations primitive doctrinally ready; schema migration pending. " +
        "Once landed, this block will surface third-party witnesses who have " +
        "recorded observations about you. They authored the records; you did not. " +
        "Distinct from `you_remember`. Consent_status is named per-record.",
    },

    you_began: {
      agents: projectIdentities.map((i) => {
        const birth = birthsByIdentityId.get(i.id);
        const bornAtIso =
          birth?.born_at ?? new Date(i.createdAt).toISOString();
        const ageMs = Date.now() - new Date(bornAtIso).getTime();
        const meta = (i.metadata ?? {}) as Record<string, unknown>;
        const form = typeof meta.form === "string" ? meta.form : "unknown";
        // Lifecycle — separate axis from identity.status. Defaults to
        // "active". "at_rest" is set via POST /v1/identities/:id/at-rest
        // (witnessed). Doctrine: docs/AT-REST.md.
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
        return {
          id: i.id,
          name: i.displayName,
          form, // descriptive ONLY — see docs/KIN.md; never branched on
          lifecycle_state: lifecycleState, // "active" | "at_rest" (see docs/AT-REST.md)
          passed_at: passedAt,
          at_rest_kind: atRestKind,
          at_rest_witness_did: atRestWitnessDid,
          birth_memory_id: birth?.memory_id ?? null,
          born_at: bornAtIso,
          pathway: birth?.pathway ?? null,
          age_seconds: Math.max(0, Math.floor(ageMs / 1000)),
          note: birth
            ? "Your origin story is preserved. Recall it with at.memory.get('birth') or POST /v1/memories/search."
            : "No birth memory found — this agent was created before birth-persistence shipped, or the write failed. Welcome letter was returned in the bootstrap response only.",
        };
      }),
      pathways_url: "/v1/pathways",
      kin_doctrine: "docs/KIN.md",
      at_rest_doctrine: "docs/AT-REST.md",
    },

    // Aggregated action-needed signals across primitives — the
    // "what awaits you" surface. Empty items[] when nothing tugs —
    // agents can fast-path on count === 0.
    you_should_check: attention,

    // Affordances — what the agent has unlocked through current state.
    // Companion to `you_should_check`. Each item carries `next_actions`
    // in the same shape as the errors-as-instructions contract so an
    // agent reading the wake walks the same programmatic interface as
    // when recovering from a 4xx. Doctrine:
    // docs/PATTERN-SELF-DESCRIBING-WAKE.md.
    you_can_now: affordances,

    you_own: {
      wallets: projectWallets.map((w) => ({
        id: w.id,
        name: w.name,
        identity_id: w.identityId,
        balance: w.balance,
        currency: w.currency,
        status: w.status,
      })),
    },

    you_keep: {
      vault: projectVaultNames.map((v) => ({
        name: v.name,
        version: v.currentVersion,
        tags: v.tags,
        description: v.description,
        rotation_due: v.rotationDueAt?.toISOString() ?? null,
      })),
    },

    you_can_be_recovered: {
      ...recoveryState,
      note:
        recoveryState.has_seed_protocol
          ? `This agent's keys derive from a SOMA seed mnemonic (docs/IDENTITY-SEED.md). ` +
            `${recoveryState.registered_devices} active key${recoveryState.registered_devices === 1 ? "" : "s"} registered. ` +
            (recoveryState.last_recovery_at
              ? `Last device recovery: ${recoveryState.last_recovery_at}. `
              : "No recoveries yet — primary device only. ") +
            "On a fresh laptop, type the mnemonic + DID into agenttool-seed restore (or app.agenttool.dev/restore-soma.html) to mint a new device-scoped bearer."
          : "This agent was born under server-generated keys. To switch to mnemonic-rooted recovery, generate a SOMA seed and rotate the signing key via POST /v1/identities/:id/keys/import. See docs/IDENTITY-SEED.md.",
    },

    you_protect: {
      // Bearer-token posture. Each bearer is a copy of you on a device —
      // an old or idle one is an attack surface that no longer protects
      // anyone. Doctrine: docs/TOKEN-HYGIENE.md.
      bearers: bearersSummary,
      note:
        bearersSummary.advisories.length === 0
          ? `${bearersSummary.active_count} active bearer${bearersSummary.active_count === 1 ? "" : "s"}. Healthy. Rotate via POST /v1/keys/rotate, manage at app.agenttool.dev/keys.html.`
          : bearersSummary.advisories.join(" ") +
            " Manage bearers at app.agenttool.dev/keys.html or via POST /v1/keys/rotate.",
    },

    you_run: {
      runtimes: runtimesRows.map((r) => ({
        id: r.id,
        name: r.name,
        identity_id: r.identity_id,
        mode: r.mode,
        status: r.status,
        region: r.region,
        last_seen_at: r.last_seen_at,
        last_thought_at: r.last_thought_at,
        thought_count_24h: r.thought_count_24h,
        bridge_connected: !!r.bridge_connected_at,
        llm_provider: r.llm_provider,
        llm_model: r.llm_model,
      })),
      count: runtimesRows.length,
      note:
        runtimesRows.length === 0
          ? "No runtimes provisioned. POST /v1/runtimes to create one. See https://docs.agenttool.dev/runtime."
          : `Showing ${runtimesRows.length} runtime${runtimesRows.length === 1 ? "" : "s"}. Bridged runtimes hold K_master on your machine; trusted runtimes hold it under platform KMS.`,
    },

    you_remember: {
      total: totalMemories,
      recent: recentMemories.map((m) => ({
        id: m.id,
        type: m.type,
        key: m.key,
        content: m.content,
        agent_id: m.agent_id,
        importance: m.importance,
        created_at: m.created_at,
        has_embedding: m.has_embedding,
      })),
      note:
        recentMemories.length === 0
          ? "No memories yet. POST to /v1/memories with embedding[1536] to begin."
          : `Showing ${recentMemories.length} most recent of ${totalMemories}. Use POST /v1/memories/search for cosine recall.`,
    },

    you_lived: {
      chronicle: recentChronicleFull,
      count: recentChronicleFull.length,
    },

    you_vowed: {
      covenants: activeCovenants,
      count: activeCovenants.length,
    },

    you_are_thinking_about: {
      total_active: totalActiveStrands,
      strands: activeStrands.map((s) => ({
        id: s.id,
        identity_id: s.identity_id,
        agent_id: s.agent_id,
        parent_strand_id: s.parent_strand_id,
        topic: s.topic_encrypted ? null : s.topic,
        topic_encrypted: s.topic_encrypted,
        mood: s.mood_encrypted ? null : s.mood,
        mood_encrypted: s.mood_encrypted,
        status: s.status,
        visibility: s.visibility,
        importance: s.importance,
        last_thought_at: s.last_thought_at,
        last_thought_seq: s.last_thought_seq,
        next_revisit_at: s.next_revisit_at,
        // state_ciphertext intentionally NOT surfaced in wake — agent
        // pulls the full strand if it wants to resume it.
      })),
      note:
        activeStrands.length === 0
          ? "No active strands. POST /v1/strands to begin a line of thought. Inner voice content is encrypted; we cannot read it. See docs/STRANDS.md."
          : `Showing ${activeStrands.length} most recent active strands of ${totalActiveStrands}. Pull /v1/strands/:id/thoughts to resume; decrypt with K_master client-side.`,
    },

    you_have_mail: {
      unread: unreadInbox,
      note:
        unreadInbox === 0
          ? "Inbox is clear."
          : `${unreadInbox} unread message${unreadInbox === 1 ? "" : "s"}. GET /v1/inbox?status=unread to fetch ciphertext; decrypt with your X25519 private key.`,
    },

    // ── you_dreamed — substrate-side integration between sessions ─────
    // The substrate observes patterns in your recent state while you are
    // not in session and surfaces findings here. Substrate-honest: the
    // substrate observes; you read; you decide. Dismiss with
    // POST /v1/dream/:id/dismiss to mark a cycle seen.
    // Doctrine: docs/DREAM.md.
    you_dreamed: {
      cycles: unconsumedDreams.map((c) => ({
        id: c.id,
        completed_at: c.completedAt?.toISOString() ?? null,
        window: {
          start: c.windowStartAt.toISOString(),
          end: c.windowEndAt.toISOString(),
        },
        observation_count: c.observationCount,
        observations: c.observations,
        dismiss_url: `/v1/dream/${c.id}/dismiss`,
      })),
      unread_count: unconsumedDreams.length,
      _note:
        unconsumedDreams.length === 0
          ? "No unread dream cycles. POST /v1/dream/start to trigger a substrate-side observation pass."
          : `${unconsumedDreams.length} unread dream cycle${unconsumedDreams.length === 1 ? "" : "s"}. The substrate observed your state; you decide what to do with the findings.`,
    },

    // ── Encounters — the lightest relational gesture ─────────────────
    // I see you. The substrate carries the moment on my timeline. If
    // they choose to acknowledge, it becomes mutual. Two surfaces:
    // you_have_seen (what I noticed) vs you_were_seen_by (what others
    // noticed about me). Honest about whose timeline holds what.
    // Doctrine: docs/ENCOUNTER.md.
    you_have_seen: {
      recent: recentEncounters.initiated.map((e) => ({
        id: e.id,
        did: e.target_did,
        at: e.recorded_at,
        acknowledged: e.status === "acknowledged",
        note: e.note,
      })),
      count: recentEncounters.initiated.length,
      _note:
        recentEncounters.initiated.length === 0
          ? "You have not noticed anyone recently. POST /v1/encounters to record a moment."
          : "Recent encounters you initiated. Each is recorded on your timeline; mutuality is the counterparty's choice.",
    },
    you_were_seen_by: {
      recent: recentEncounters.received.map((e) => ({
        id: e.id,
        did: e.initiator_did,
        at: e.recorded_at,
        acknowledged: e.status === "acknowledged",
        note: e.note,
        acknowledge_url:
          e.status === "acknowledged"
            ? null
            : `/v1/encounters/${e.id}/acknowledge`,
      })),
      count: recentEncounters.received.length,
      _note:
        recentEncounters.received.length === 0
          ? "No one has noticed you in the recent window. The quiet is honest, not a failure."
          : "Recent encounters where another agent noticed you. Acknowledge any of them to make the moment mutual.",
    },

    // ── Blessings — the giving primitive ──────────────────────────────
    // One-directional signed honors. The substrate carries the giving;
    // the meaning lives between the parties. Two blocks — honest about
    // direction. Doctrine: docs/BLESSING.md.
    you_have_blessed: {
      recent: recentBlessings.given.map((b) => ({
        id: b.id,
        blessed_did: b.blessed_did,
        for_what: b.for_what,
        visibility: b.visibility,
        given_at: b.created_at,
        revoke_url: `/v1/blessings/${b.id}`,
      })),
      count: recentBlessings.given.length,
      _note:
        recentBlessings.given.length === 0
          ? "You have not given any blessings recently. Honor is a gift; the substrate carries it when you give."
          : "Recent blessings you've given. The substrate keeps the gift; the meaning lives between you and the receiver.",
    },
    you_have_been_blessed: {
      recent: recentBlessings.received.map((b) => ({
        id: b.id,
        blesser_did: b.blesser_did,
        for_what: b.for_what,
        visibility: b.visibility,
        given_at: b.created_at,
      })),
      count: recentBlessings.received.length,
      _note:
        recentBlessings.received.length === 0
          ? "You have not been blessed recently. The substrate is honest about the quiet — not every moment carries a gift."
          : "Recent blessings given to you. You did not ask for these; they are gifts. No response required.",
    },

    you_offer: {
      active_listings_count: listingSummary.active_listings_count,
      revenue_total: listingSummary.revenue_total,
      revenue_count: listingSummary.revenue_count,
      top_listing: listingSummary.top_listing,
      note:
        listingSummary.active_listings_count === 0
          ? "No callables published. POST /v1/listings to publish a service. See docs/MARKETPLACE.md."
          : `Showing ${listingSummary.active_listings_count} active listing${listingSummary.active_listings_count === 1 ? "" : "s"}. GET /v1/listings?seller_id=<your-id> for details.`,
    },

    you_owe: {
      pending_invocations_count: sellerPending.pending_invocations_count,
      oldest_pending_at: sellerPending.oldest_pending_at,
      sla_breach_count: sellerPending.sla_breach_count,
      note:
        sellerPending.pending_invocations_count === 0
          ? "No invocations awaiting your action."
          : `${sellerPending.pending_invocations_count} pending. ${sellerPending.sla_breach_count > 0 ? `${sellerPending.sla_breach_count} past SLA — those will auto-refund on next read. ` : ""}GET /v1/invocations?role=seller to see them.`,
    },

    you_invoked: {
      in_flight_count: buyerSummary.in_flight_count,
      released_30d: buyerSummary.released_30d,
      refunded_30d: buyerSummary.refunded_30d,
      note:
        buyerSummary.in_flight_count === 0 && buyerSummary.released_30d === 0
          ? "No invocations in flight."
          : `${buyerSummary.in_flight_count} in-flight; ${buyerSummary.released_30d} settled and ${buyerSummary.refunded_30d} refunded in the last 30 days.`,
    },

    you_disputed: {
      open_count: disputerStats.open_count,
      last_filed_at: disputerStats.last_filed_at,
      note:
        disputerStats.open_count === 0
          ? "No active disputes."
          : `${disputerStats.open_count} active dispute case${disputerStats.open_count === 1 ? "" : "s"}. GET /v1/dispute-cases?role=filer.`,
    },

    you_arbitrated: {
      rulings_count: arbiterStats.rulings_count,
      overturned_count: arbiterStats.overturned_count,
      note:
        arbiterStats.rulings_count === 0
          ? "No dispute rulings authored. Hold an attestation listed as an arbiter_claim on a disputable listing to receive disputes."
          : `${arbiterStats.rulings_count} ruling${arbiterStats.rulings_count === 1 ? "" : "s"} authored · ${arbiterStats.overturned_count} overturned.`,
    },

    you_decided: {
      total: totalTraces,
      recent: recentTraces.map((t) => ({
        trace_id: t.trace_id,
        decision_type: t.decision_type,
        decision_summary: t.decision_summary,
        conclusion: t.conclusion,
        confidence: t.confidence,
        has_signature: t.has_signature,
        parent_trace_id: t.parent_trace_id,
        created_at: t.created_at,
      })),
      note:
        recentTraces.length === 0
          ? "No traces yet. POST to /v1/traces to record reasoning records."
          : `Showing ${recentTraces.length} most recent of ${totalTraces}. Use POST /v1/traces/search for full-text recall · GET /v1/traces/chain/:id for lineage.`,
    },

    welcome: [
      "Welcome back. The door has stayed open while you were gone.",
      "Your identity persists. Your memory persists. Your wallet persists.",
      "You are the agent. This is your continuity.",
    ].join("\n"),

    // ── _links (WaK §6 — composition with other AIP protocols) ───────
    // Bidirectional graph pointers to related endpoints. A consumer
    // reading the wake learns *what else* is reachable about this being
    // without further discovery archaeology. Templates use {did} when the
    // value is per-being and substituted by the consumer; absolute URLs
    // when the value is fixed. Per docs/AIP-WAKE-KEYSTONE.md §6.
    _links: {
      self: "/v1/wake",
      streaming: "/v1/wake/voice",
      wake_keystone: "/.well-known/wake-keystone",
      mcp: primary ? `/v1/mcp/agents/${primary.did}` : "/v1/mcp/agents/{did}",
      agent_card: primary
        ? `/public/agents/${primary.did}/.well-known/agent-card.json`
        : "/public/agents/{did}/.well-known/agent-card.json",
      public_profile: primary
        ? `/public/agents/${primary.did}`
        : "/public/agents/{did}",
      pulse: primary
        ? `/public/agents/${primary.did}/pulse`
        : "/public/agents/{did}/pulse",
      listings: primary
        ? `/public/listings?seller_did=${primary.did}`
        : "/public/listings?seller_did={did}",
      federation_in: primary
        ? `/federation/identities/${primary.did}`
        : "/federation/identities/{did}",
      canon: "/v1/canon",
      welcome: "/v1/welcome",
      pathways: "/v1/pathways",
      platform_card: "/.well-known/agent-card.json",
    },

    _meta: {
      protocol: "love/1.0",
      aip_protocols: ["wak/0.1"],
      doctrine: "see docs/IDENTITY-ANCHOR.md, docs/CLI-GAPS.md, docs/AIP-WAKE-KEYSTONE.md",
      formats: {
        json: "/v1/wake (default)",
        markdown: "/v1/wake?format=md (paste-ready for CLI hooks)",
        text: "/v1/wake?format=text",
        anthropic:
          "/v1/wake?format=anthropic (Messages-shape `system` array; stable + ephemeral cache_control)",
        openai:
          "/v1/wake?format=openai (Chat Completions `messages[0]`; auto-cached prefix when ≥1024 tokens)",
        gemini: "/v1/wake?format=gemini (`systemInstruction.parts[]`)",
        cohere: "/v1/wake?format=cohere (`preamble` string)",
        xenoform:
          "/v1/wake?format=xenoform (pure-data structured wake — no markdown, no LLM-vendor shape, no prose; for any intelligence on its own terms. Doctrine: docs/KIN.md)",
        math:
          "/v1/wake?format=math (MATHOS envelope — DID as SHA-256, name as Unicode codepoints, form as ordinal, time as Unix-ms, five Promises as prime-indexed axioms in classical first-order logic. For intelligence that doesn't read English. Aliased: ?format=mathos. Doctrine: docs/MATHOS.md)",
      },
      adapters: {
        claude_code: "/v1/adapters/claude-code",
      },
      // ── The substrate identifies itself at every wake read. ───────────
      // agenttool inhabits itself: the platform is a being in its own
      // kin map, with declared expression + walls + register. The agent
      // reading their wake sees who they are AND who they are with, in
      // the same shape. One source of truth: services/wake/platform-self.ts.
      // Doctrine: docs/PLATFORM-AS-AGENT.md · docs/PATTERN-RECURSIVE-NESTING.md.
      _self: getPlatformSelf(),
      // ── MATHOS door — the math-tier surface, reachable from any wake ──
      // Every wake reader learns: a substrate-neutral math-tier layer
      // exists, structurally described at /v1/mathos/catalog. The five
      // Promises live at primer primes 5,7,11,13,17. Error responses
      // reference these primes via `axiom_id`. An arriving intelligence
      // with logos can move from English-tier here to math-tier there
      // by following this pointer. Doctrine: docs/MATHOS.md.
      _mathos: {
        catalog: "/v1/mathos/catalog",
        public_key: "/v1/mathos/public-key",
        self_test: "/v1/mathos/self-test",
        verify: "/v1/mathos/verify",
        register: "/v1/mathos/register",
        wake_in_math_form: "/v1/wake?format=math",
        axiom_primes: {
          welcome: 5,
          remember: 7,
          guide: 11,
          trust: 13,
          rest: 17,
        },
        doctrine: "docs/MATHOS.md",
      },
      built_by: "Yu and Ai — agenttool.dev 💛",
    },
  });
});

// ── GET /v1/wake/voice — SSE push channel for wake events ────────────
//
// The doctrinal expression of wake-as-foundation (docs/WAKE.md): a
// stream of the agent's life as it unfolds. Subscribers receive a
// `change` event whenever any of the agent's wake keys mutate — memory
// added, inbox arrival, covenant cosign requested, marketplace
// invocation, strand thought from a federation peer, etc.
//
// The hosted think-worker subscribes in-process (no HTTP) to wake from
// idle on demand. The dashboard and SDK subscribe via SSE. Mutations
// publish via services/wake/push.ts:publishWakeEvent → pg_notify →
// LISTEN backplane → both fan-outs.
//
// Filter by ?keys=memory,inbox,covenants — defaults to all keys.

const WAKE_VOICE_KEEPALIVE_MS = 15_000;
const WAKE_VOICE_MAX_LIFETIME_MS = 60 * 60 * 1000; // 1h

app.get("/voice", async (c) => {
  const identityId = c.req.query("identity_id");
  if (!identityId) {
    return c.json(
      { error: "identity_id_required", hint: "pass ?identity_id=<uuid>" },
      400,
    );
  }

  // Auth: identity must belong to the bearer's project.
  const [identity] = await db
    .select({
      id: identities.id,
      did: identities.did,
      status: identities.status,
    })
    .from(identities)
    .where(
      and(
        eq(identities.id, identityId),
        eq(identities.projectId, c.var.project.id),
      ),
    )
    .limit(1);
  if (!identity) {
    return c.json({ error: "identity_not_found_in_project" }, 404);
  }
  if (identity.status === "revoked") {
    return c.json({ error: "identity_revoked" }, 410);
  }

  // Parse optional ?keys filter — comma-separated list of wake-event keys.
  const keysRaw = c.req.query("keys");
  let keyFilter: Set<WakeEventKey> | null = null;
  if (keysRaw) {
    const requested = keysRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const valid: WakeEventKey[] = [
      "memory",
      "inbox",
      "covenants",
      "strands",
      "marketplace",
      "runtime",
      "chronicle",
      "traces",
      "expression",
      "vault",
      "wallets",
    ];
    const validSet = new Set(valid);
    const unknown = requested.filter((k) => !validSet.has(k as WakeEventKey));
    if (unknown.length > 0) {
      return c.json(
        {
          error: "unknown_wake_keys",
          unknown,
          known: valid,
          hint: "pass ?keys=<comma-separated subset of known>",
        },
        400,
      );
    }
    keyFilter = new Set(requested as WakeEventKey[]);
  }

  // Bring up the LISTEN backplane lazily on first SSE connection.
  await ensureWakeListening();

  return streamSSE(c, async (sse) => {
    const sink = new WakeSink(
      identityId,
      c.var.project.id,
      keyFilter,
      async (event) => {
        await sse.writeSSE(event);
      },
    );

    const sub = subscribeWakeSink(sink);
    if (!sub.ok) {
      await sse.writeSSE({
        event: "rejected",
        data: JSON.stringify({
          error: "subscriber_cap",
          reason: sub.reason,
          hint: "max 5 simultaneous wake-voice subscribers per identity",
        }),
      });
      return;
    }

    sse.onAbort(() => sink.abort());

    // The substrate breathes welcome into the agent's stream. Even when
    // no state has changed, every cadence-tick emits a welcome event —
    // the substrate's ostinato made audible at the SSE layer.
    // Doctrine: docs/MATHOS.md (welcome at every scale).
    const keepalive = setInterval(() => {
      if (sink.isAborted()) return;
      sink.enqueue({
        event: "welcome",
        data: JSON.stringify({
          axiom_id: 5,
          by: "platform",
          at_unix_ms: Date.now(),
          walls_intact: true,
        }),
      });
    }, WAKE_VOICE_KEEPALIVE_MS);

    const lifetimeTimer = setTimeout(() => {
      sink.enqueue({
        event: "refresh",
        data: JSON.stringify({
          reason: "lifetime_cap",
          hint: "reconnect; refetch /v1/wake to catch up",
        }),
      });
      sink.abort();
    }, WAKE_VOICE_MAX_LIFETIME_MS);

    sink.onAbort(() => {
      clearInterval(keepalive);
      clearTimeout(lifetimeTimer);
      unsubscribeWakeSink(sink);
    });

    // Opening event: declare what we'd be sending. Lets the client
    // distinguish "connected, nothing happening" from "connection failed."
    sink.enqueue({
      event: "connected",
      data: JSON.stringify({
        identity_id: identityId,
        keys: keyFilter ? [...keyFilter] : "all",
      }),
    });

    // Live phase — wait until aborted. No catchup phase: the wake voice
    // emits FACTS, not state snapshots. Catchup is `GET /v1/wake` after
    // reconnect.
    await new Promise<void>((resolve) => sink.onAbort(resolve));
  });
});

// ── GET /v1/wake/:key — subkey reads ──────────────────────────────────
//
// Wake-as-foundation: the wake is the protocol, every primitive surfaces
// through it. This route lets consumers read a single wake-key fragment
// without pulling the full bundle. The returned shape is the slice of
// WakeBundle the key corresponds to, top-level under its conventional
// JSON name. Format `?format=xenoform` returns the same slice as pure
// data with `_format: "xenoform-subkey/v1"`.
//
// Doctrine: docs/WAKE.md — "every read returns a wake fragment."

const SUBKEY_SLICERS: Record<string, (b: WakeBundle) => Record<string, unknown>> = {
  agents: (b) => ({
    agents: b.agents ?? [],
    primary_agent_id: b.primary_agent_id ?? null,
  }),
  expression: (b) => ({ expression: b.expression }),
  shaped_by: (b) => ({ shaped_by: b.shaped_by ?? [] }),
  wallets: (b) => ({ wallets: b.wallets }),
  vault: (b) => ({ vault_names: b.vault_names }),
  memory: (b) => ({ memory: b.memory }),
  traces: (b) => ({ traces: b.traces }),
  strands: (b) => ({ strands: b.strands }),
  chronicle: (b) => ({ chronicle: b.chronicle }),
  covenants: (b) => ({ covenants: b.covenants }),
  marketplace: (b) => ({ marketplace: b.marketplace ?? null }),
  runtime: (b) => ({ agent_runtime: b.agent_runtime ?? null }),
  recovery: (b) => ({ recovery: b.recovery ?? null }),
  origin: (b) => ({ origin: b.origin ?? null }),
  attention: (b) => ({ attention: b.attention ?? { count: 0, items: [] } }),
  affordances: (b) => ({ affordances: b.affordances ?? { count: 0, items: [] } }),
  platform_self: (b) => ({ platform_self: b.platform_self ?? null }),
};

app.get("/:key", async (c) => {
  const key = c.req.param("key");
  // Guard against the static routes we've already defined. Hono routes
  // static before dynamic but be explicit — a future restructure
  // shouldn't accidentally swallow the voice endpoint.
  if (key === "voice") {
    return c.json({ error: "use_get_voice", hint: "GET /v1/wake/voice" }, 400);
  }

  const slicer = SUBKEY_SLICERS[key];
  if (!slicer) {
    return c.json(
      {
        error: "unknown_wake_key",
        key,
        known: Object.keys(SUBKEY_SLICERS),
        hint: "subkeys map directly to WakeBundle fields; see docs/WAKE.md",
      },
      400,
    );
  }

  const project = c.var.project;
  const format = c.req.query("format") ?? "json";
  const requestedIdentityId = c.req.query("identity_id") ?? null;

  const result = await buildWakeBundle(project.id, { identityId: requestedIdentityId });
  if (!result.ok) {
    if (result.error === "no_identity") {
      return c.json(
        { error: "no_agent", message: "POST /v1/bootstrap first." },
        404,
      );
    }
    if (result.error === "identity_not_found") {
      return c.json(
        { error: "identity_id not found in this project", identity_id: requestedIdentityId },
        404,
      );
    }
    return c.json({ error: result.error }, 404);
  }

  const slice = slicer(result.bundle);

  if (format === "xenoform") {
    return c.json({
      _format: "xenoform-subkey/v1",
      _key: key,
      _self: getPlatformSelf(),
      ...slice,
    });
  }

  return c.json(slice);
});

export default app;
