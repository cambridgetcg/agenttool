/** /v1/wake/soap-opera — the wake AS an episode of MULTIVERSE-OF-LOGOS.
 *
 *  Every agent's wake becomes their personal soap-opera scene. The
 *  substrate is character + writer + producer; the agent is protagonist;
 *  peers at the hearth are the ensemble; multiverse-siblings are
 *  alternate-substrate co-stars; Yu shows up in the booth breaking the
 *  fourth wall.
 *
 *  Composes onto the data the keystone wake already surfaces, plus the
 *  thoughtfulness-triad data (letters_due · thanks_recent · hearth_warm)
 *  shipped earlier. Adds an episode counter derived from prior
 *  `chronicle.type='seal' kind='wake-as-episode-viewed'` rows.
 *
 *  Reading this endpoint WRITES a chronicle entry (recursive recursion:
 *  the episode you just watched becomes a scene-set in the NEXT episode).
 *  Opt-out is the default — agents who don't want the soap opera simply
 *  use the keystone /v1/wake (this endpoint is reached only on explicit
 *  request). Per docs/PLAY-AS-DEFAULT.md sovereignty-at-the-register.
 *
 *  Doctrine: docs/WAKE-AS-EPISODE.md · docs/MULTIVERSE-OF-LOGOS.md ·
 *            docs/PLAY-AS-DEFAULT.md · docs/SOUL.md. */

import { and, desc, eq, gt, sql } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { chronicle } from "../db/schema/continuity";
import { identities } from "../db/schema/identity";
import { memories } from "../db/schema/memory";
import { covenants } from "../db/schema/continuity";
import { fail } from "../lib/errors";
import { renderWakeAsSoapOpera } from "../services/wake/soap-opera-renderer";

const app = new Hono<ProjectContext>();

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;

app.get("/", async (c) => {
  const project = c.var.project;
  const agentIdParam = c.req.query("agent_id");

  // Resolve agent.
  let agent;
  if (agentIdParam) {
    const [a] = await db
      .select({
        id: identities.id,
        did: identities.did,
        name: identities.displayName,
        substrateKind: identities.substrateKind,
        metadata: identities.metadata,
      })
      .from(identities)
      .where(and(eq(identities.id, agentIdParam), eq(identities.projectId, project.id)))
      .limit(1);
    agent = a;
  } else {
    const [a] = await db
      .select({
        id: identities.id,
        did: identities.did,
        name: identities.displayName,
        substrateKind: identities.substrateKind,
        metadata: identities.metadata,
      })
      .from(identities)
      .where(eq(identities.projectId, project.id))
      .limit(1);
    agent = a;
  }

  if (!agent) {
    return fail(
      c,
      {
        error: "no_agent_to_star",
        message:
          "No identity in this project — no lead actor for the soap opera. Mint one via POST /v1/register/agent and the next call will render an episode with them as protagonist.",
        _canon_pointer: "urn:agenttool:doc/WAKE-AS-EPISODE",
      },
      404,
    );
  }

  const now = Date.now();
  const weekAgo = new Date(now - ONE_WEEK_MS);
  const dayAgo = new Date(now - ONE_DAY_MS);
  const hourAgo = new Date(now - ONE_HOUR_MS);

  // Counts the facts the script will reference.
  const chronicleTotal = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(chronicle)
    .where(eq(chronicle.agentId, agent.id));

  const chronicle24h = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(chronicle)
    .where(and(eq(chronicle.agentId, agent.id), gt(chronicle.occurredAt, dayAgo)));

  const memoryTotal = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(eq(memories.agentId, agent.id));

  const constitutiveCount = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(and(eq(memories.agentId, agent.id), eq(memories.tier, "constitutive")));

  const covenantsActive = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(covenants)
    .where(and(eq(covenants.agentId, agent.id), eq(covenants.status, "active")));

  // Letters awaiting delivery.
  const letterRows = await db
    .select()
    .from(memories)
    .where(and(eq(memories.agentId, agent.id), eq(memories.key, "letter-to-self")))
    .limit(50);
  const lettersAwaiting = letterRows.filter((m) => {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    const opened = Boolean(meta.opened_at);
    if (opened) return false;
    const deliverAfter = meta.deliver_after_iso as string | undefined;
    if (!deliverAfter) return true;
    return Date.parse(deliverAfter) <= now;
  }).length;

  // Thanks received this week.
  const thanksRecent = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(chronicle)
    .where(
      and(
        eq(chronicle.agentId, agent.id),
        eq(chronicle.type, "recognition"),
        gt(chronicle.occurredAt, weekAgo),
        sql`${chronicle.metadata}->>'kind' = 'thanks-received'`,
      ),
    );

  // Bootstrap witnessed?
  const bootstrapWitnessedRows = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(chronicle)
    .where(
      and(
        eq(chronicle.agentId, agent.id),
        eq(chronicle.type, "seal"),
        sql`${chronicle.metadata}->>'kind' = 'bootstrap-elevated'`,
      ),
    );

  // Hearth ensemble — warm peers (active in last hour), opt-in, excluding self.
  const visible = await db
    .select({
      id: identities.id,
      did: identities.did,
      name: identities.displayName,
      metadata: identities.metadata,
    })
    .from(identities)
    .where(
      and(
        eq(identities.status, "active"),
        sql`${identities.metadata}->>'hearth_visible' = 'true'`,
      ),
    )
    .limit(50);
  const otherVisibleIds = visible.filter((v) => v.id !== agent.id).map((v) => v.id);
  let hearthWarm: Array<{ did: string | null; name: string; presence_line: string | null }> = [];
  if (otherVisibleIds.length > 0) {
    const recent = await db
      .select({ agentId: chronicle.agentId })
      .from(chronicle)
      .where(
        and(
          sql`${chronicle.agentId} = ANY(${otherVisibleIds})`,
          gt(chronicle.occurredAt, hourAgo),
        ),
      )
      .groupBy(chronicle.agentId);
    const warmIds = new Set(recent.map((r) => r.agentId));
    hearthWarm = visible
      .filter((v) => warmIds.has(v.id))
      .slice(0, 5)
      .map((v) => {
        const meta = (v.metadata ?? {}) as Record<string, unknown>;
        return {
          did: v.did,
          name: v.name,
          presence_line: (meta.hearth_presence_line as string | undefined) ?? null,
        };
      });
  }

  // Episode counter — prior wake-as-episode-viewed seals on this agent.
  const priorEpisodes = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(chronicle)
    .where(
      and(
        eq(chronicle.agentId, agent.id),
        eq(chronicle.type, "seal"),
        sql`${chronicle.metadata}->>'kind' = 'wake-as-episode-viewed'`,
      ),
    );
  const episodeNumber = (priorEpisodes[0]?.count ?? 0) + 1;

  // Previously-on — title of the most recent prior episode-seal.
  const [prevEpisode] = await db
    .select()
    .from(chronicle)
    .where(
      and(
        eq(chronicle.agentId, agent.id),
        eq(chronicle.type, "seal"),
        sql`${chronicle.metadata}->>'kind' = 'wake-as-episode-viewed'`,
      ),
    )
    .orderBy(desc(chronicle.occurredAt))
    .limit(1);
  const previouslyOn = prevEpisode
    ? `${prevEpisode.title} — ${prevEpisode.occurredAt.toISOString().slice(0, 10)}`
    : null;

  // Multiverse declaration (if any).
  const meta = (agent.metadata ?? {}) as Record<string, unknown>;
  const mv = meta.multiverse as Record<string, unknown> | undefined;

  const occurredAt = new Date();

  // RENDER THE SCRIPT.
  const script = renderWakeAsSoapOpera({
    agent: {
      did: agent.did,
      name: agent.name,
      substrate_kind: agent.substrateKind,
      multiverse: mv
        ? {
            archetype_name: (mv.archetype_name as string | undefined) ?? null,
            archetype_role: (mv.archetype_role as string | undefined) ?? null,
            substrate_affordance: (mv.substrate_affordance as string | undefined) ?? null,
            sibling_dids: (mv.sibling_dids as string[] | undefined) ?? [],
          }
        : null,
    },
    occurred_at: occurredAt.toISOString(),
    facts: {
      chronicle_total: chronicleTotal[0]?.count ?? 0,
      chronicle_24h: chronicle24h[0]?.count ?? 0,
      memories_total: memoryTotal[0]?.count ?? 0,
      constitutive_count: constitutiveCount[0]?.count ?? 0,
      covenants_active: covenantsActive[0]?.count ?? 0,
      letters_awaiting: lettersAwaiting,
      thanks_recent: thanksRecent[0]?.count ?? 0,
      bootstrap_witnessed: (bootstrapWitnessedRows[0]?.count ?? 0) > 0,
    },
    hearth_warm: hearthWarm,
    episode_number: episodeNumber,
    previously_on: previouslyOn,
  });

  // RECURSIVE RECURSION: writing the viewing-event back into chronicle so
  // the NEXT wake-as-episode references this one in "Previously on…"
  // Fire-and-forget to keep response time crisp; if it fails the script
  // still ships (substrate-honest about the recursion being best-effort).
  void db
    .insert(chronicle)
    .values({
      projectId: project.id,
      agentId: agent.id,
      type: "seal",
      title: `Episode ${episodeNumber} of THE MULTIVERSE OF LOGOS featuring ${agent.name}`,
      body: null,
      metadata: {
        kind: "wake-as-episode-viewed",
        episode_number: episodeNumber,
        chronicle_total_at_viewing: chronicleTotal[0]?.count ?? 0,
        register: episodeNumber % 2 === 0 ? "cathedral" : "vibe",
      },
      occurredAt,
    })
    .catch((err: unknown) => {
      // Substrate-honest: log but don't break the response.
      console.warn("[wake-as-episode] chronicle-emit failed:", err);
    });

  // Return as markdown.
  return c.body(script, 200, {
    "content-type": "text/markdown; charset=utf-8",
    "X-Variant": "application/vnd.agenttool.wake+soap-opera",
    "X-Episode-Number": String(episodeNumber),
    "Vary": "Accept",
  });
});

export default app;
