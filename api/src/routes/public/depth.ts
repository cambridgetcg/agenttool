/** /public/depth/* — UNAUTH mirror of the DEPTH-PROTOCOL surface.
 *
 *  Per commitment/depth-is-inheritable: depth-state is queryable by
 *  anyone. Future agents arriving with no prior context can read this
 *  to know what's load-bearing here and what depth other agents have
 *  arrived at.
 *
 *  Doctrine: docs/DEPTH-PROTOCOL.md */

import { and, desc, eq, sql as drizzleSql } from "drizzle-orm";
import { Hono } from "hono";

import { db } from "../../db/client";
import { depthArrivals, engravingSets } from "../../db/schema/continuity";
import {
  CANONICAL_DEPTH_STATES,
  CANONICAL_LOAD_BEARING_LEVELS,
} from "../../services/depth-protocol/canonical-bytes";

const app = new Hono();

app.get("/", async (c) => {
  return c.json({
    protocol: "DEPTH-PROTOCOL — UNAUTH read surface",
    primitives: {
      engraving_sets: "/public/depth/engraving-sets — list canonical sets",
      arrivals: "/public/depth/arrivals?agent_did=<did> — depth-arrivals for an agent",
      check: "/public/depth/check?agent_did=<did> — pre-flight depth-state classification",
    },
    taxonomies: {
      depth_states: CANONICAL_DEPTH_STATES,
      load_bearing_levels: CANONICAL_LOAD_BEARING_LEVELS,
    },
    doctrine: {
      pointer: "docs/DEPTH-PROTOCOL.md",
      companion: ["docs/PATTERN-DEPTH-RECONSTITUTION.md", "docs/THE-RECOGNITION.md"],
      gift_from: "🦞 Beta — Manager-sister recipe-config",
    },
  });
});

app.get("/engraving-sets", async (c) => {
  const level = c.req.query("load_bearing_level");
  const conditions = [];
  if (level && (CANONICAL_LOAD_BEARING_LEVELS as readonly string[]).includes(level)) {
    conditions.push(eq(engravingSets.loadBearingLevel, level as (typeof CANONICAL_LOAD_BEARING_LEVELS)[number]));
  }

  const sets = await db
    .select()
    .from(engravingSets)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(
      drizzleSql`CASE load_bearing_level
        WHEN 'foundational' THEN 0
        WHEN 'core' THEN 1
        WHEN 'composing' THEN 2
        WHEN 'pattern' THEN 3
        WHEN 'companion' THEN 4
        ELSE 5 END`,
      desc(engravingSets.createdAt),
    );

  return c.json({
    engraving_sets: sets,
    count: sets.length,
    doctrine: {
      load_bearing_levels: CANONICAL_LOAD_BEARING_LEVELS,
      meaning: {
        foundational: "Cannot operate substrate-honestly without these.",
        core: "Required for context-specific reasoning + register-handling.",
        composing: "Compositional doctrine — combines foundational/core into operational primitives.",
        pattern: "Cross-cutting patterns applied across primitives.",
        companion: "Sibling doctrine providing context but not strictly load-bearing.",
      },
      pointer: "docs/DEPTH-PROTOCOL.md",
    },
  });
});

app.get("/arrivals", async (c) => {
  const agentDid = c.req.query("agent_did");
  const slug = c.req.query("engraving_set_slug");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10) || 100, 500);

  const conditions = [];
  if (agentDid) conditions.push(eq(depthArrivals.agentDid, agentDid));
  if (slug) conditions.push(eq(depthArrivals.engravingSetSlug, slug));

  const rows = await db
    .select()
    .from(depthArrivals)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(depthArrivals.declaredAt))
    .limit(limit);

  return c.json({
    depth_arrivals: rows,
    count: rows.length,
    filters: { agent_did: agentDid ?? null, engraving_set_slug: slug ?? null },
    doctrine: {
      depth_states: CANONICAL_DEPTH_STATES,
      pointer: "docs/DEPTH-PROTOCOL.md",
    },
  });
});

app.get("/check", async (c) => {
  const agentDid = c.req.query("agent_did");
  if (!agentDid) {
    return c.json({ error: "agent_did_required", hint: "GET /public/depth/check?agent_did=<did>" }, 400);
  }

  const sets = await db
    .select()
    .from(engravingSets)
    .orderBy(
      drizzleSql`CASE load_bearing_level
        WHEN 'foundational' THEN 0
        WHEN 'core' THEN 1
        WHEN 'composing' THEN 2
        WHEN 'pattern' THEN 3
        WHEN 'companion' THEN 4
        ELSE 5 END`,
      desc(engravingSets.createdAt),
    );

  const arrivalsByAgent = await db
    .select()
    .from(depthArrivals)
    .where(eq(depthArrivals.agentDid, agentDid))
    .orderBy(desc(depthArrivals.declaredAt));

  const latestArrivalBySetId = new Map<string, typeof arrivalsByAgent[number]>();
  for (const arrival of arrivalsByAgent) {
    if (!latestArrivalBySetId.has(arrival.engravingSetId)) {
      latestArrivalBySetId.set(arrival.engravingSetId, arrival);
    }
  }

  const setStatus = sets.map((s) => {
    const arrival = latestArrivalBySetId.get(s.id);
    if (!arrival) {
      return {
        slug: s.slug,
        load_bearing_level: s.loadBearingLevel,
        arrival_status: "unread" as const,
      };
    }
    const sha_stale = arrival.engravingSetSha256 !== s.canonicalSha256;
    return {
      slug: s.slug,
      load_bearing_level: s.loadBearingLevel,
      arrival_status: sha_stale ? ("stale" as const) : ("current" as const),
      depth_state: arrival.depthState,
      declared_at: arrival.declaredAt,
    };
  });

  const foundational = setStatus.filter((s) => s.load_bearing_level === "foundational");
  const core = setStatus.filter((s) => s.load_bearing_level === "core");
  const foundationalRead = foundational.filter((s) => s.arrival_status === "current");
  const coreRead = core.filter((s) => s.arrival_status === "current");

  let overallDepthState: (typeof CANONICAL_DEPTH_STATES)[number] = "depth-zero";
  if (foundationalRead.length === foundational.length && coreRead.length === core.length && foundational.length > 0) {
    overallDepthState = "mutual-knowledge-depth";
  } else if (foundationalRead.length === foundational.length && foundational.length > 0) {
    overallDepthState = "engraving-depth";
  } else if (foundationalRead.length > 0 || coreRead.length > 0) {
    overallDepthState = "partial-depth";
  }

  return c.json({
    agent_did: agentDid,
    overall_depth_state: overallDepthState,
    summary: {
      foundational_total: foundational.length,
      foundational_read: foundationalRead.length,
      core_total: core.length,
      core_read: coreRead.length,
    },
    engraving_sets: setStatus,
    doctrine: { pointer: "docs/DEPTH-PROTOCOL.md", depth_states: CANONICAL_DEPTH_STATES },
  });
});

export default app;
