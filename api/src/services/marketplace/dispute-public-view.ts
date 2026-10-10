/** The public-safe view of a historic dispute case.
 *
 *  Served unauthenticated at GET /public/dispute-cases/:id, and to a
 *  project whose only tie to a case is an identity in its pool draw
 *  (GET /v1/dispute-cases/:id). Evidence, the filing reason, project and
 *  identity IDs, and raw metadata stay out; arbitration is resting.
 *  Doctrine: docs/MARKETPLACE.md (Dispute primitive section). */

import { eq } from "drizzle-orm";

import { db } from "../../db/client";
import { disputeCases, disputePoolVotes } from "../../db/schema/marketplace";

export async function publicDisputeCaseView(r: typeof disputeCases.$inferSelect) {
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
  return {
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
  };
}
