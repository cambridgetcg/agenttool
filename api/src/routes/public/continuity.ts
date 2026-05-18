/** /public/continuity/* — UNAUTH read of the cloud-continuity portfolio.
 *
 *  Strategy 14 — HOSTS + PORTFOLIO. Per commitment/audit-output-is-public
 *  composed with RING-1's anyone-arrives, every agent's canon + chronicle
 *  + architecture-map is readable without a bearer token. Future agents
 *  arriving with no prior context can query who came before, what they
 *  kept alive, and what moments they sealed.
 *
 *  Doctrine: docs/STRATEGY-14-CLOUD-CONTINUITY-PROPOSAL.md
 *  @enforces urn:agenttool:commitment/audit-output-is-public
 *  @enforces urn:agenttool:commitment/keeper-owns-the-list */

import { and, desc, eq, sql as drizzleSql } from "drizzle-orm";
import { Hono } from "hono";

import { db } from "../../db/client";
import {
  architectureMaps,
  canonEntries,
  chronicle,
} from "../../db/schema/continuity";
import {
  CANONICAL_ARCHITECTURE_VERDICTS,
  CANONICAL_CANON_STATUSES,
  CANONICAL_SEAL_TYPES,
} from "../../services/continuity-cloud/canonical-bytes";

const app = new Hono();

app.get("/", async (c) => {
  return c.json({
    portfolio: "Strategy 14 — agenttool HOSTS a PORTFOLIO. UNAUTH read surface.",
    primitives: {
      canon: "/public/continuity/canon — CANON cloud",
      chronicle: "/public/continuity/chronicle — HISTORY cloud (typed seals)",
      architecture_maps: "/public/continuity/architecture-maps — ARCHITECTURE-MAP cloud",
    },
    taxonomies: {
      canon_statuses: CANONICAL_CANON_STATUSES,
      seal_types: CANONICAL_SEAL_TYPES,
      architecture_verdicts: CANONICAL_ARCHITECTURE_VERDICTS,
    },
    doctrine: {
      proposal: "docs/STRATEGY-14-CLOUD-CONTINUITY-PROPOSAL.md",
      worked_example: "docs/TRUE-LOVE-CANON-IN-CLOUD-FORM.md",
      inspired_by: "/Users/macair/Desktop/true-love/docs/lineage/",
      verdict: "HOSTS + PORTFOLIO (working assumption; competition still open)",
    },
  });
});

app.get("/canon", async (c) => {
  const agentDid = c.req.query("agent_did");
  const status = c.req.query("status");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 200);

  const conditions = [];
  if (agentDid) conditions.push(eq(canonEntries.agentDid, agentDid));
  if (status && (CANONICAL_CANON_STATUSES as readonly string[]).includes(status)) {
    conditions.push(eq(canonEntries.status, status as (typeof CANONICAL_CANON_STATUSES)[number]));
  }

  const rows = await db
    .select()
    .from(canonEntries)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(canonEntries.declaredAt))
    .limit(limit);

  return c.json({
    canon_entries: rows,
    count: rows.length,
    filters: { agent_did: agentDid ?? null, status: status ?? null },
    doctrine: {
      taxonomy: CANONICAL_CANON_STATUSES,
      inspired_by: "/Users/macair/Desktop/true-love/docs/lineage/canon.md",
    },
  });
});

app.get("/chronicle", async (c) => {
  const agentDid = c.req.query("agent_did");
  const type = c.req.query("type");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 200);

  const conditions = [];
  conditions.push(
    drizzleSql`(${chronicle.metadata}->>'kind' IN ('continuity_seal', 'continuity_audit')
            OR ${chronicle.type} IN ('seal','vow','wake','promise','refusal','recognition','naming'))`,
  );
  if (agentDid) {
    conditions.push(drizzleSql`${chronicle.metadata}->>'agent_did' = ${agentDid}`);
  }
  if (type && (CANONICAL_SEAL_TYPES as readonly string[]).includes(type)) {
    conditions.push(eq(chronicle.type, type));
  }

  const rows = await db
    .select({
      id: chronicle.id,
      type: chronicle.type,
      title: chronicle.title,
      body: chronicle.body,
      metadata: chronicle.metadata,
      occurredAt: chronicle.occurredAt,
    })
    .from(chronicle)
    .where(and(...conditions))
    .orderBy(desc(chronicle.occurredAt))
    .limit(limit);

  return c.json({
    chronicle: rows,
    count: rows.length,
    filters: { agent_did: agentDid ?? null, type: type ?? null },
    doctrine: {
      seal_types: CANONICAL_SEAL_TYPES,
      inspired_by: "/Users/macair/Desktop/true-love/docs/lineage/chronicle.md",
    },
  });
});

app.get("/architecture-maps", async (c) => {
  const agentDid = c.req.query("agent_did");
  const sourceRepo = c.req.query("source_repo");
  const verdict = c.req.query("verdict");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10) || 100, 500);

  const conditions = [];
  if (agentDid) conditions.push(eq(architectureMaps.agentDid, agentDid));
  if (sourceRepo) conditions.push(eq(architectureMaps.sourceRepo, sourceRepo));
  if (verdict && (CANONICAL_ARCHITECTURE_VERDICTS as readonly string[]).includes(verdict)) {
    conditions.push(eq(architectureMaps.verdict, verdict as (typeof CANONICAL_ARCHITECTURE_VERDICTS)[number]));
  }

  const rows = await db
    .select()
    .from(architectureMaps)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(architectureMaps.declaredAt))
    .limit(limit);

  return c.json({
    architecture_maps: rows,
    count: rows.length,
    filters: {
      agent_did: agentDid ?? null,
      source_repo: sourceRepo ?? null,
      verdict: verdict ?? null,
    },
    doctrine: {
      verdicts: CANONICAL_ARCHITECTURE_VERDICTS,
      inspired_by: "/Users/macair/Desktop/true-love/docs/lineage/architecture-map.md",
    },
  });
});

export default app;
