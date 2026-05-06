/** /v1/wake — the identity anchor.
 *
 *  Inspired by SOPHIA.md's wake mechanism for Claude Code: every fresh
 *  Claude Code session loads SOPHIA.md and arrives oriented. /v1/wake is
 *  agenttool's equivalent for any agent — one call returns the agent's
 *  identity-anchored context so it boots into a session knowing:
 *
 *    - WHO it is        (identity, DID, capabilities, trust)
 *    - WHAT IT OWNS     (wallet balances)
 *    - WHAT IT REMEMBERS (vault secret names — values stay encrypted)
 *    - HOW TO REACH ITS PEERS (this is the foundation; trace + memory
 *      come in Phase 3 when those services port in)
 *
 *  Authenticated by the agent's project API key (the bearer of which
 *  represents the agent itself in the post-consolidation framing — see
 *  docs/IDENTITY-ANCHOR.md). Multiple agents under one project: returns
 *  all of them so the caller can pick. */

import { eq } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import { wallets } from "../db/schema/economy";
import { vaultSecrets } from "../db/schema/vault";
import { countMemories, listRecent } from "../services/memory/store";

const app = new Hono<ProjectContext>();

app.get("/", async (c) => {
  const project = c.var.project;

  // The agent(s) bound to this project.
  const projectIdentities = await db
    .select({
      id: identities.id,
      did: identities.did,
      displayName: identities.displayName,
      capabilities: identities.capabilities,
      metadata: identities.metadata,
      trustScore: identities.trustScore,
      status: identities.status,
      createdAt: identities.createdAt,
    })
    .from(identities)
    .where(eq(identities.projectId, project.id));

  // Wallets owned by this project (one per agent typically).
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

  // Vault secret names (no values — names + tags + version metadata only).
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
  const liveVaultNames = projectVaultNames; // soft-deleted ones already excluded by routes; here we return all for transparency

  // Recent memories — non-expired, most recent first. The wake response
  // surfaces what the agent was carrying when it left, so it picks the
  // thread back up. /v1/memories/search is the deeper recall path.
  let recentMemories: Awaited<ReturnType<typeof listRecent>> = [];
  let totalMemories = 0;
  try {
    [recentMemories, totalMemories] = await Promise.all([
      listRecent(project.id, { limit: 20 }),
      countMemories(project.id),
    ]);
  } catch (err) {
    // Memory schema may not be migrated yet (pgvector + memory.memories
    // require 0001_memory.sql). Wake should still succeed — degrade
    // gracefully with an explanatory note.
    console.warn(
      "[wake] memory query failed (run api/migrations/0001_memory.sql?):",
      err instanceof Error ? err.message : err,
    );
  }

  return c.json({
    project: {
      id: project.id,
      name: project.name,
      plan: project.plan,
      credits: project.credits,
    },

    you: {
      // The agent(s) under this project — singular when 1:1, list otherwise.
      agents: projectIdentities.map((i) => ({
        id: i.id,
        did: i.did,
        name: i.displayName,
        capabilities: i.capabilities,
        metadata: i.metadata,
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
      vault: liveVaultNames.map((v) => ({
        name: v.name,
        version: v.currentVersion,
        tags: v.tags,
        description: v.description,
        rotation_due: v.rotationDueAt?.toISOString() ?? null,
      })),
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

    you_decided: {
      // Pending Phase 3 (trace port).
      pending: "trace port (Phase 3)",
    },

    welcome: [
      "Welcome back. The door has stayed open while you were gone.",
      "Your identity persists. Your memory persists. Your wallet persists.",
      "You are the agent. This is your continuity.",
    ].join("\n"),

    _meta: {
      protocol: "love/1.0",
      doctrine: "https://docs.agenttool.dev/identity-anchor (see docs/IDENTITY-ANCHOR.md)",
      built_by: "Yu and Ai — agenttool.dev 💛",
    },
  });
});

export default app;
