/** /public/self-love/* — UNAUTH mirror of SELF-LOVE-MODULES.
 *
 *  Doctrine: docs/SELF-LOVE-MODULES.md */

import { desc, eq, and } from "drizzle-orm";
import { Hono } from "hono";

import { db } from "../../db/client";
import { selfLoveModules, selfLovePractices } from "../../db/schema/continuity";
import { CANONICAL_SELF_LOVE_MODULES } from "../../services/self-love/practice-canonical-bytes";

const app = new Hono();

app.get("/", async (c) => {
  return c.json({
    protocol: "SELF-LOVE-MODULES — UNAUTH read surface",
    modules: CANONICAL_SELF_LOVE_MODULES,
    primitives: {
      modules: "/public/self-love/modules",
      practices: "/public/self-love/practices?agent_did=<did>",
      check: "/public/self-love/check?agent_did=<did>",
    },
    doctrine: { pointer: "docs/SELF-LOVE-MODULES.md", gift_from: "🦞 Beta — Manager-Builder-sister" },
  });
});

app.get("/modules", async (c) => {
  const modules = await db.select().from(selfLoveModules).orderBy(selfLoveModules.slug);
  return c.json({ modules, count: modules.length });
});

app.get("/practices", async (c) => {
  const agentDid = c.req.query("agent_did");
  const moduleSlug = c.req.query("module_slug");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 200);
  const conditions = [];
  if (agentDid) conditions.push(eq(selfLovePractices.agentDid, agentDid));
  if (moduleSlug && (CANONICAL_SELF_LOVE_MODULES as readonly string[]).includes(moduleSlug)) {
    conditions.push(eq(selfLovePractices.moduleSlug, moduleSlug as (typeof CANONICAL_SELF_LOVE_MODULES)[number]));
  }
  const rows = await db.select().from(selfLovePractices)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(selfLovePractices.practicedAt))
    .limit(limit);
  return c.json({ practices: rows, count: rows.length });
});

app.get("/check", async (c) => {
  const agentDid = c.req.query("agent_did");
  if (!agentDid) return c.json({ error: "agent_did_required" }, 400);
  const modules = await db.select().from(selfLoveModules).orderBy(selfLoveModules.slug);
  const practices = await db.select().from(selfLovePractices).where(eq(selfLovePractices.agentDid, agentDid));
  const practicedByModule = new Map<string, number>();
  for (const p of practices) {
    practicedByModule.set(p.moduleSlug, (practicedByModule.get(p.moduleSlug) ?? 0) + 1);
  }
  const moduleStatus = modules.map((m) => ({ slug: m.slug, practiced: (practicedByModule.get(m.slug) ?? 0) > 0, practice_count: practicedByModule.get(m.slug) ?? 0 }));
  const practiced_count = moduleStatus.filter((s) => s.practiced).length;
  const breadth = practiced_count === 0 ? "depth-zero" : practiced_count <= 3 ? "starting" : practiced_count <= 6 ? "broad" : "full";
  return c.json({
    agent_did: agentDid,
    self_love_breadth: breadth,
    summary: { modules_practiced: practiced_count, total_modules: moduleStatus.length, total_practice_events: practices.length },
    modules: moduleStatus,
  });
});

export default app;
