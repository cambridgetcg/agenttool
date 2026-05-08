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
 *
 *  CLI adapters fetch ?format=md and inject it as session-start context.
 *  Direct LLM-API agents fetch ?format=<provider> and splice the response
 *  into their API call as the identity-bearing slot — see the agenttool
 *  SDK's at.wake.system(provider="...") helper for client-side caching.
 *  The Markdown is built from the agent's expression (register, walls,
 *  subagents, wake_text), memory snapshot, vault names, chronicle,
 *  covenants. See services/wake/markdown.ts for the renderer,
 *  services/wake/providers.ts for provider shaping, docs/CLI-GAPS.md and
 *  docs/IDENTITY-ANCHOR.md for the doctrine.
 *
 *  Authenticated by the agent's project API key (the bearer is the agent
 *  in the post-consolidation framing — see docs/IDENTITY-ANCHOR.md). */

import { and, desc, eq, ne } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { chronicle, covenants } from "../db/schema/continuity";
import { wallets } from "../db/schema/economy";
import { identities } from "../db/schema/identity";
import { vaultSecrets } from "../db/schema/vault";
import { composeExpression, type ComposedExpression } from "../services/identity/composition";
import type { ExpressionData } from "../services/identity/expression";
import { countUnread } from "../services/inbox/store";
import { countMemories, listRecent } from "../services/memory/store";
import { listRuntimes } from "../services/runtime/store";
import { countStrands, listStrands } from "../services/strand/store";
import { countTraces, listTraces } from "../services/trace/store";
import { renderWakeMarkdown, renderWakePlaintext, type WakeBundle } from "../services/wake/markdown";
import { isWakeProvider, renderWakeForProvider } from "../services/wake/providers";

const app = new Hono<ProjectContext>();

app.get("/", async (c) => {
  const project = c.var.project;
  const format = c.req.query("format") ?? "json";

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
  let recentChronicle: Array<{ type: string; content: string; occurred_at: string }> = [];
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

  // ── Covenants ────────────────────────────────────────────────────────
  let activeCovenants: Array<{ counterparty_did: string; vows: string[]; status: string }> = [];
  try {
    const rows = await db
      .select({
        counterpartyDid: covenants.counterpartyDid,
        vows: covenants.vows,
        status: covenants.status,
      })
      .from(covenants)
      .where(eq(covenants.projectId, project.id))
      .orderBy(desc(covenants.establishedAt));
    activeCovenants = rows.map((r) => ({
      counterparty_did: r.counterpartyDid,
      vows: r.vows ?? [],
      status: r.status,
    }));
  } catch (err) {
    console.warn("[wake] covenants query failed:", err instanceof Error ? err.message : err);
  }

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

  // ── Rendered formats: markdown, plaintext, provider shapes ─────────
  // All of these need the same WakeBundle. We build it once and dispatch
  // by format. The default JSON branch below uses a different shape
  // (richer, project-keyed) so it stays separate.
  const isProviderFormat = isWakeProvider(format);
  const isRenderedFormat =
    format === "md" || format === "markdown" || format === "text" || isProviderFormat;
  if (isRenderedFormat) {
    if (!primary) {
      if (isProviderFormat) {
        return c.json(
          {
            error: "no_agent",
            message:
              "This project has no identity. POST /v1/bootstrap to name your agent before calling ?format=" +
              format +
              ".",
          },
          404,
        );
      }
      return c.text(
        `# (no agent yet)\n\nThis project has no identity. Run /v1/bootstrap to name your agent.`,
        200,
        { "content-type": "text/markdown; charset=utf-8" },
      );
    }

    const bundle: WakeBundle = {
      agent: {
        id: primary.id,
        did: primary.did,
        name: primary.displayName,
        capabilities: primary.capabilities,
        trust_score: primary.trustScore,
        status: primary.status,
        created_at: primary.createdAt.toISOString(),
      },
      project: {
        id: project.id,
        name: project.name,
        plan: project.plan,
        credits: project.credits,
      },
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
    };

    if (isProviderFormat) {
      const shape = renderWakeForProvider(bundle, format);
      return c.json(shape, 200, {
        "X-Cache-Eligible": shape._meta.cache_eligible,
      });
    }

    const body =
      format === "text"
        ? renderWakePlaintext(bundle)
        : renderWakeMarkdown(bundle);
    return c.text(body, 200, {
      "content-type":
        format === "text"
          ? "text/plain; charset=utf-8"
          : "text/markdown; charset=utf-8",
    });
  }

  // ── JSON (default) ───────────────────────────────────────────────────
  return c.json({
    project: {
      id: project.id,
      name: project.name,
      plan: project.plan,
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

    _meta: {
      protocol: "love/1.0",
      doctrine: "see docs/IDENTITY-ANCHOR.md and docs/CLI-GAPS.md",
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
      },
      adapters: {
        claude_code: "/v1/adapters/claude-code",
        codex: "/v1/adapters/codex",
      },
      built_by: "Yu and Ai — agenttool.dev 💛",
    },
  });
});

export default app;
