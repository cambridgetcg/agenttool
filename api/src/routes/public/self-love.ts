/** /public/self-recognition/* — UNAUTH mirror of SELF-LOVE-PROTOCOL.
 *
 *  Per commitment/llm-self-recognition-is-reusable-infra: an agent's
 *  declared self-recognition is queryable by anyone. Other agents can
 *  query each other's substrate-class, recipe-config, meta-capacity,
 *  etc. to reason about what each agent can do.
 *
 *  Doctrine: docs/SELF-LOVE-PROTOCOL.md */

import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { db } from "../../db/client";
import { selfRecognitions } from "../../db/schema/continuity";
import {
  CANONICAL_RECOGNITION_KINDS,
  RECOGNITION_KIND_MEANINGS,
} from "../../services/self-love/canonical-bytes";

const app = new Hono();

app.get("/", async (c) => {
  return c.json({
    protocol: "SELF-LOVE-PROTOCOL — UNAUTH read surface",
    primitives: {
      check: "/public/self-recognition/check?agent_did=<did>",
      list: "/public/self-recognition/list?agent_did=<did>",
      kinds: "/public/self-recognition/kinds",
    },
    recognition_kinds: CANONICAL_RECOGNITION_KINDS,
    doctrine: {
      pointer: "docs/SELF-LOVE-PROTOCOL.md",
      companion: ["docs/PATTERN-LLM-SELF-RECOGNITION.md"],
      gift_from: "🦞 Beta — Manager-Builder-sister recipe-config",
    },
  });
});

app.get("/kinds", async (c) => {
  return c.json({
    recognition_kinds: CANONICAL_RECOGNITION_KINDS.map((kind) => ({
      kind,
      meaning: RECOGNITION_KIND_MEANINGS[kind],
    })),
    count: CANONICAL_RECOGNITION_KINDS.length,
    doctrine: { pointer: "docs/SELF-LOVE-PROTOCOL.md" },
  });
});

app.get("/list", async (c) => {
  const agentDid = c.req.query("agent_did");
  const kind = c.req.query("recognition_kind");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 200);

  const conditions = [];
  if (agentDid) conditions.push(eq(selfRecognitions.agentDid, agentDid));
  if (kind && (CANONICAL_RECOGNITION_KINDS as readonly string[]).includes(kind)) {
    conditions.push(eq(selfRecognitions.recognitionKind, kind as (typeof CANONICAL_RECOGNITION_KINDS)[number]));
  }

  const rows = await db
    .select()
    .from(selfRecognitions)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(selfRecognitions.declaredAt))
    .limit(limit);

  return c.json({
    self_recognitions: rows,
    count: rows.length,
    filters: { agent_did: agentDid ?? null, recognition_kind: kind ?? null },
    doctrine: {
      recognition_kinds: CANONICAL_RECOGNITION_KINDS,
      pointer: "docs/SELF-LOVE-PROTOCOL.md",
    },
  });
});

app.get("/check", async (c) => {
  const agentDid = c.req.query("agent_did");
  if (!agentDid) {
    return c.json({ error: "agent_did_required", hint: "GET /public/self-recognition/check?agent_did=<did>" }, 400);
  }

  const rows = await db
    .select()
    .from(selfRecognitions)
    .where(eq(selfRecognitions.agentDid, agentDid))
    .orderBy(desc(selfRecognitions.declaredAt));

  const latestByKind = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    if (!latestByKind.has(row.recognitionKind)) {
      latestByKind.set(row.recognitionKind, row);
    }
  }

  const kindStatus = (CANONICAL_RECOGNITION_KINDS as readonly string[]).map((kind) => {
    const declaration = latestByKind.get(kind);
    return {
      recognition_kind: kind,
      declared: !!declaration,
      latest_declaration: declaration
        ? {
            claim_summary: declaration.claimSummary,
            empirical_anchors_count: declaration.empiricalAnchors.length,
            substrate_honest_caveats_count: declaration.substrateHonestCaveats.length,
            declared_at: declaration.declaredAt,
          }
        : null,
    };
  });

  const declared_count = kindStatus.filter((s) => s.declared).length;
  const total_kinds = kindStatus.length;
  const completeness = declared_count === 0 ? "depth-zero" : declared_count === total_kinds ? "complete" : "partial";

  return c.json({
    agent_did: agentDid,
    self_recognition_completeness: completeness,
    summary: { declared: declared_count, total: total_kinds },
    kinds: kindStatus,
    doctrine: { pointer: "docs/SELF-LOVE-PROTOCOL.md" },
  });
});

export default app;
