/** /v1/dispute-cases — dispute primitive auth-gated surface.
 *
 *  Doctrine: docs/MARKETPLACE.md (Dispute primitive section).
 *  Routes:
 *    POST /v1/dispute-cases/:id/rule       (first arbiter)
 *    POST /v1/dispute-cases/:id/escalate   (buyer or seller)
 *    POST /v1/dispute-cases/:id/vote       (pool member)
 *    POST /v1/dispute-cases/:id/finalize   (anyone — idempotent)
 *    GET  /v1/dispute-cases/:id
 *    GET  /v1/dispute-cases?role=filer|arbiter|pool */

import type { Context } from "hono";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { charge } from "../billing/charge";
import { db } from "../db/client";
import { eq, desc, sql } from "drizzle-orm";
import { disputeCases } from "../db/schema/marketplace";
import { identities } from "../db/schema/identity";
import {
  escalateDispute,
  finalizeCase,
  maybeExpireFirstArbiterSla,
  submitFirstRuling,
  submitPoolVote,
} from "../services/marketplace/disputes";

const app = new Hono<ProjectContext>();

const ruleSchema = z
  .object({
    ruling: z.enum(["release", "refund", "split"]),
    split_pct: z.number().int().min(0).max(100).nullish(),
    signature: z.string().min(1),
    signing_key_id: z.string().uuid(),
  })
  .strict();

const escalateSchema = z
  .object({
    escalator_role: z.enum(["buyer", "seller"]),
    bond_wallet_id: z.string().uuid(),
  })
  .strict();

const voteSchema = z
  .object({
    voter_identity_id: z.string().uuid(),
    vote: z.enum(["uphold", "overturn"]),
    alternative_ruling: z.enum(["release", "refund", "split"]).nullish(),
    alternative_split_pct: z.number().int().min(0).max(100).nullish(),
    signature: z.string().min(1),
    signing_key_id: z.string().uuid(),
  })
  .strict();

function mapServiceError(msg: string): { status: number; code: string; hint?: string } {
  if (msg === "dispute_case_not_found") return { status: 404, code: msg };
  if (msg === "invocation_not_found") return { status: 404, code: msg };
  if (msg === "listing_not_found") return { status: 404, code: msg };
  if (msg === "first_arbiter_not_resolved") return { status: 404, code: msg };
  if (msg === "signing_key_not_found") return { status: 404, code: msg };
  if (msg === "bond_wallet_not_found") return { status: 404, code: msg };

  if (msg === "not_buyer" || msg === "not_seller" || msg === "not_first_arbiter" || msg === "not_voter") {
    return { status: 403, code: msg };
  }

  if (msg === "insufficient_bond_balance") {
    return { status: 402, code: msg, hint: "Fund the bond wallet before escalating." };
  }

  if (msg.startsWith("dispute_case_state_invalid")) return { status: 409, code: msg };
  if (msg === "escalation_window_expired") return { status: 409, code: msg };
  if (msg === "pool_vote_window_expired") return { status: 409, code: msg };
  if (msg === "first_arbiter_sla_expired") return { status: 409, code: msg };
  if (msg === "first_ruling_signature_invalid") return { status: 409, code: msg };
  if (msg === "pool_vote_signature_invalid") return { status: 409, code: msg };
  if (msg === "vote_already_cast") return { status: 409, code: msg };
  if (msg === "not_in_pool") return { status: 403, code: msg };
  if (msg === "signing_key_revoked") return { status: 409, code: msg };
  if (msg === "signing_key_does_not_belong_to_arbiter") return { status: 409, code: msg };
  if (msg === "signing_key_does_not_belong_to_voter") return { status: 409, code: msg };
  if (msg === "bond_wallet_not_active") return { status: 409, code: msg };
  if (msg === "bond_wallet_currency_mismatch") return { status: 409, code: msg };

  if (msg === "bond_amount_zero") return { status: 400, code: msg };
  if (msg === "split_pct_required_for_split") return { status: 400, code: msg };
  if (msg === "split_pct_out_of_range") return { status: 400, code: msg };
  if (msg === "alternative_ruling_required_on_overturn") return { status: 400, code: msg };
  if (msg === "alternative_split_pct_required_for_split") return { status: 400, code: msg };
  if (msg === "alternative_split_pct_out_of_range") return { status: 400, code: msg };

  return { status: 500, code: "internal_error", hint: msg };
}

function mapAndRespond(c: Context<ProjectContext>, msg: string) {
  const m = mapServiceError(msg);
  if (m.status === 500) throw new Error(msg);
  const body: Record<string, unknown> = { error: m.code };
  if (m.hint) body.hint = m.hint;
  return c.json(body, m.status as 400 | 402 | 403 | 404 | 409);
}

// POST /v1/dispute-cases/:id/rule
app.post("/:id/rule", async (c) => {
  const body = await c.req.json();
  const parsed = ruleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  await charge(c, 3, "dispute.rule");
  try {
    const caseRow = await submitFirstRuling({
      disputeCaseId: c.req.param("id"),
      arbiterProjectId: c.var.project.id,
      ruling: parsed.data.ruling,
      splitPct: parsed.data.split_pct ?? null,
      signatureB64: parsed.data.signature,
      signingKeyId: parsed.data.signing_key_id,
    });
    return c.json(caseRow);
  } catch (err) {
    return mapAndRespond(c, (err as Error).message);
  }
});

// POST /v1/dispute-cases/:id/escalate
app.post("/:id/escalate", async (c) => {
  const body = await c.req.json();
  const parsed = escalateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  await charge(c, 5, "dispute.escalate");
  try {
    const result = await escalateDispute({
      disputeCaseId: c.req.param("id"),
      escalatorProjectId: c.var.project.id,
      escalatorRole: parsed.data.escalator_role,
      bondWalletId: parsed.data.bond_wallet_id,
    });
    return c.json({ dispute_case: result, pool: result.pool, escalated: true });
  } catch (err) {
    return mapAndRespond(c, (err as Error).message);
  }
});

// POST /v1/dispute-cases/:id/vote
app.post("/:id/vote", async (c) => {
  const body = await c.req.json();
  const parsed = voteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  await charge(c, 2, "dispute.vote");
  try {
    const caseRow = await submitPoolVote({
      disputeCaseId: c.req.param("id"),
      voterProjectId: c.var.project.id,
      voterIdentityId: parsed.data.voter_identity_id,
      vote: parsed.data.vote,
      alternativeRuling: parsed.data.alternative_ruling ?? null,
      alternativeSplitPct: parsed.data.alternative_split_pct ?? null,
      signatureB64: parsed.data.signature,
      signingKeyId: parsed.data.signing_key_id,
    });
    return c.json(caseRow);
  } catch (err) {
    return mapAndRespond(c, (err as Error).message);
  }
});

// POST /v1/dispute-cases/:id/finalize — idempotent settlement trigger.
app.post("/:id/finalize", async (c) => {
  await charge(c, 1, "dispute.finalize");
  try {
    const caseRow = await finalizeCase(c.req.param("id"));
    return c.json(caseRow);
  } catch (err) {
    return mapAndRespond(c, (err as Error).message);
  }
});

// GET /v1/dispute-cases/:id
app.get("/:id", async (c) => {
  await maybeExpireFirstArbiterSla(c.req.param("id"));
  const [r] = await db
    .select()
    .from(disputeCases)
    .where(eq(disputeCases.id, c.req.param("id")))
    .limit(1);
  if (!r) throw new HTTPException(404, { message: "dispute_case_not_found" });

  // Access: filer, first arbiter, or pool member. Otherwise 404.
  let allowed = r.filerProjectId === c.var.project.id;
  if (!allowed && r.firstArbiterIdentityId) {
    const [arb] = await db
      .select({ projectId: identities.projectId })
      .from(identities)
      .where(eq(identities.id, r.firstArbiterIdentityId))
      .limit(1);
    if (arb?.projectId === c.var.project.id) allowed = true;
  }
  if (!allowed) {
    const poolDraw = (r.metadata as Record<string, unknown>)?.pool_draw as
      | Array<{ id: string; did: string }>
      | undefined;
    if (poolDraw && poolDraw.length > 0) {
      const poolIds = poolDraw.map((p) => p.id);
      const poolMembers = await db
        .select({ id: identities.id, projectId: identities.projectId })
        .from(identities)
        .where(sql`${identities.id} = ANY(${poolIds}::uuid[])`);
      if (poolMembers.some((m) => m.projectId === c.var.project.id)) allowed = true;
    }
  }
  if (!allowed) {
    throw new HTTPException(404, { message: "dispute_case_not_found" });
  }
  return c.json(r);
});

// GET /v1/dispute-cases?role=filer
app.get("/", async (c) => {
  const role = c.req.query("role") ?? "filer";
  if (role !== "filer") {
    return c.json({ error: "role_unsupported", hint: "Only ?role=filer is supported in v1." }, 400);
  }
  const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);
  const rows = await db
    .select()
    .from(disputeCases)
    .where(eq(disputeCases.filerProjectId, c.var.project.id))
    .orderBy(desc(disputeCases.createdAt))
    .limit(Number.isFinite(limit) ? limit : 50);
  return c.json({ dispute_cases: rows, count: rows.length, role });
});

export default app;
