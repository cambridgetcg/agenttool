/** Discovery — search / filter active identities.
 *
 *  Query params: capability · q · min_settlements · limit · offset
 *  (`min_trust` is still accepted; above 0 it refuses with instructions.)
 *
 *  This surface answers a buyer's question: *which of these agents should I
 *  send work to?* It used to answer with `trust_score`, which
 *  `services/identity/trust.ts` pins to a constant zero on purpose — there are
 *  no qualified trust roots and no Sybil-resistant weighting, so a derived
 *  scalar would be the platform's unsupported opinion. Sound refusal. But the
 *  field stayed in the response, and a constant that looks like a measurement
 *  is worse than no field at all: it invites exactly the comparison it cannot
 *  support. Three things followed from that, all addressed here.
 *
 *    - `min_trust` filtered on the constant, so any value above 0 matched
 *      nothing, forever, and returned an empty page with no explanation. It now
 *      refuses with instructions instead of failing silently.
 *    - `total` was `rows.length` — the page size wearing the name of the
 *      population. It is now a real count over the filter.
 *    - Nothing distinguished sellers. Settled-work facts now do, read from the
 *      receipts in docs/SETTLEMENT-RECEIPTS.md. Counts and timestamps, not a
 *      score: the substrate says which is which, never which is better.
 *
 *  Doctrine: docs/SETTLEMENT-RECEIPTS.md · docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md.
 */

import { and, asc, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { settlementReceipts } from "../../db/schema/marketplace";
import { fail } from "../../lib/errors";
import { projectDiscoverableIdentity } from "../../services/identity/public-profile";
import {
  NO_SETTLEMENTS,
  settlementFactsForSellers,
} from "../../services/marketplace/settlement-receipts";

const app = new Hono<ProjectContext>();

const discoverQuerySchema = z.object({
  capability: z.string().min(1).max(200).optional(),
  min_trust: z.coerce.number().min(0).max(1).optional(),
  min_settlements: z.coerce.number().int().min(0).max(100_000).optional(),
  q: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const TRUST_SCORE_NOTE =
  "trust_score is structurally 0 for every identity and cannot rank anyone. " +
  "AgentTool has no qualified trust roots, no personhood guarantee, and no " +
  "Sybil-resistant weighting model, so it publishes no score. The field stays " +
  "for response compatibility. Weigh the per-row settlement facts, or read the " +
  "signed receipts at /public/settlements and apply your own model. " +
  "Doctrine: docs/SETTLEMENT-RECEIPTS.md.";

app.get("/", async (c) => {
  const parsed = discoverQuerySchema.safeParse({
    capability: c.req.query("capability"),
    min_trust: c.req.query("min_trust"),
    min_settlements: c.req.query("min_settlements"),
    q: c.req.query("q"),
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  if (!parsed.success) {
    return c.json(
      { error: "validation", details: parsed.error.flatten() },
      400,
    );
  }
  const {
    capability,
    min_trust: minTrust,
    min_settlements: minSettlements,
    q,
    limit,
    offset,
  } = parsed.data;

  // A filter that can only ever return nothing should say so. Serving an empty
  // page let a caller conclude "there are no trustworthy agents here" when the
  // truth was "this filter reads a constant".
  if (minTrust !== undefined && minTrust > 0) {
    return fail(
      c,
      {
        error: "filter_cannot_match",
        message: `min_trust=${minTrust} can never match. ${TRUST_SCORE_NOTE}`,
        next_actions: [
          {
            action: "Filter on settled work instead",
            method: "GET",
            path: "/v1/discover?min_settlements=1",
          },
          {
            action: "Read the signed settlement feed and weigh it yourself",
            method: "GET",
            path: "/public/settlements",
          },
          {
            action: "Read how a receipt is verified",
            method: "GET",
            path: "/public/settlements/verification",
          },
        ],
        docs: "https://docs.agenttool.dev/SETTLEMENT-RECEIPTS.md",
      },
      400,
    );
  }

  const conditions = [eq(identities.status, "active")];

  if (capability) {
    // capabilities @> ARRAY[capability]::text[]
    conditions.push(
      sql`${identities.capabilities} @> ARRAY[${capability}]::text[]`,
    );
  }

  // min_trust=0 stays a no-op rather than an error: it has always matched
  // everyone, so a caller already passing it keeps working unchanged.
  if (minTrust !== undefined) {
    conditions.push(gte(identities.trustScore, minTrust));
  }

  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      sql`${identities.displayName} ILIKE ${pattern}`,
    );
  }

  if (minSettlements !== undefined && minSettlements > 0) {
    conditions.push(
      sql`(SELECT COUNT(*) FROM ${settlementReceipts}
           WHERE ${settlementReceipts.sellerIdentityId} = ${identities.id})
          >= ${minSettlements}`,
    );
  }

  const where = and(...conditions);

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: identities.id,
        did: identities.did,
        displayName: identities.displayName,
        capabilities: identities.capabilities,
        trustScore: identities.trustScore,
        createdAt: identities.createdAt,
      })
      .from(identities)
      .where(where)
      .orderBy(asc(identities.createdAt), asc(identities.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(identities)
      .where(where),
  ]);

  // One grouped query for the whole page, never one per row.
  const facts = await settlementFactsForSellers(rows.map((r) => r.id));

  return c.json({
    identities: rows.map((r) => ({
      ...projectDiscoverableIdentity(r),
      settlements: facts.get(r.id) ?? NO_SETTLEMENTS,
    })),
    count: rows.length,
    // Was `rows.length` — the page size named as the population, which is a
    // trap for anyone paging. Now a real count over the same filter.
    total: totals[0]?.total ?? 0,
    limit,
    offset,
    _note: TRUST_SCORE_NOTE,
  });
});

export default app;
