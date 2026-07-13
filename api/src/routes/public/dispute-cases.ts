/** /public/dispute-cases — UNAUTHENTICATED historical transparency.
 *
 *  Exposes retained ruling/voting fields WITHOUT evidence or project IDs.
 *  Arbitration is resting; this read makes no claim that qualification,
 *  fairness, signatures, or pool selection were independently verifiable.
 *
 *  Doctrine: docs/MARKETPLACE.md (Dispute primitive section). */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { db } from "../../db/client";
import { eq } from "drizzle-orm";
import { disputeCases, disputePoolVotes } from "../../db/schema/marketplace";

const app = new Hono();

app.get("/:id", async (c) => {
  const [r] = await db
    .select()
    .from(disputeCases)
    .where(eq(disputeCases.id, c.req.param("id")))
    .limit(1);
  if (!r) throw new HTTPException(404, { message: "dispute_case_not_found" });
  const votes = await db
    .select({
      voter_did: disputePoolVotes.voterDid,
      vote: disputePoolVotes.vote,
      alternative_ruling: disputePoolVotes.alternativeRuling,
      alternative_split_pct: disputePoolVotes.alternativeSplitPct,
      signature: disputePoolVotes.signature,
      voted_at: disputePoolVotes.votedAt,
    })
    .from(disputePoolVotes)
    .where(eq(disputePoolVotes.disputeCaseId, r.id));
  return c.json({
    id: r.id,
    invocation_id: r.invocationId,
    filer_role: r.filerRole,
    first_arbiter_did: r.firstArbiterDid,
    first_arbiter_ruling: r.firstArbiterRuling,
    first_arbiter_split_pct: r.firstArbiterSplitPct,
    first_arbiter_signature: r.firstArbiterSignature,
    first_arbiter_ruled_at: r.firstArbiterRuledAt,
    escalation_deadline_at: r.escalationDeadlineAt,
    escalated_by_role: r.escalatedByRole,
    escalator_bond_amount: r.escalatorBondAmount,
    pool_drawn_at: r.poolDrawnAt,
    pool_size: r.poolSize,
    pool_vote_deadline_at: r.poolVoteDeadlineAt,
    pool_draw: (r.metadata as Record<string, unknown>)?.pool_draw ?? null,
    pool_votes: votes,
    final_ruling: r.finalRuling,
    final_split_pct: r.finalSplitPct,
    status: r.status,
    resolution_path: r.resolutionPath,
    resolved_at: r.resolvedAt,
    created_at: r.createdAt,
    _note:
      "Read-only historical schema record. Evidence and project IDs are omitted; " +
      "arbitration is resting and this endpoint makes no qualification, fairness, or reproducibility claim.",
  });
});

export default app;
