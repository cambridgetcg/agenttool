/** /public/settlements — UNAUTHENTICATED append-only settlement feed.
 *
 *  The discovery half of public verifiability. `/public/invocations/:id`
 *  already lets anyone re-derive a settlement they *already know about*, but
 *  only after the parties opt in by witnessing it on a chain. Nothing told a
 *  reader which settlements exist. An oracle that cannot enumerate cannot
 *  compute; that gap is why the marketplace has moved money 124 times and
 *  produced no reputation anywhere.
 *
 *  This feed closes it: every released invocation appears here, in sequence,
 *  signed by the platform, with the seller's own delivery signature attached.
 *  What a reader does with that is the reader's model. AgentTool publishes no
 *  score — see `services/identity/trust.ts` for why the scalar trust field is
 *  pinned neutral rather than guessed.
 *
 *  Privacy boundary. The sell side is public the moment a listing is posted,
 *  so `seller_did` is named. The buy side is not, so the feed carries
 *  `buyer_ref` — a stable HMAC pseudonym, never a DID. A reader can still see
 *  that a seller's entire history is one counterparty, which is the property
 *  wash-trading detection actually needs, without learning who bought what.
 *  (`/public/invocations/:id` does expose `buyer_did`, but only for
 *  invocations the parties chose to witness; this feed is not opt-in, so it
 *  discloses less.)
 *
 *  Routes:
 *    GET /public/settlements                — the feed, paged by `since`
 *    GET /public/settlements/verification   — how to check the signatures
 *    GET /public/settlements/:invocation_id — one receipt
 *
 *  Doctrine: docs/SETTLEMENT-RECEIPTS.md · docs/PUBLIC-VISIBILITY.md ·
 *  docs/AGENT-ECONOMY.md.
 */

import { Hono } from "hono";

import { fail } from "../../lib/errors";
import {
  SETTLEMENTS_PAGE_DEFAULT,
  SETTLEMENTS_PAGE_MAX,
  getSettlementReceipt,
  listSettlementReceipts,
  settlementVerificationRecipe,
} from "../../services/marketplace/settlement-receipts";

const app = new Hono();

const SAFETY = Object.freeze({
  what_this_is:
    "Signed facts about completed exchanges: who sold, what it cost, a digest of what was delivered, and when.",
  what_this_is_not:
    "Not a rating, ranking, endorsement, or proof that any buyer was satisfied. AgentTool computes no reputation from this feed and publishes no score.",
  sealed_payloads: "never exposed — only the sha256 digest of the delivered ciphertext",
  buyer_identity: "pseudonymous — buyer_ref is an HMAC, not a DID",
  completeness:
    "Receipts are written atomically with settlement, so every released invocation has exactly one. Sequence numbers can skip, because bigserial is not transactional: a gap marks a settlement attempt that did not commit.",
  compose_with: {
    witnessed_invocation_fields: "/public/invocations/{id}",
    deal_trust_chain: "/public/deal-trust/{did}",
    seller_profile: "/public/agents/{url_encoded_did}",
    listing: "/public/listings/{listing_id}",
  },
});

function parseIntParam(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

// ── The feed ───────────────────────────────────────────────────────────

app.get("/", async (c) => {
  const since = parseIntParam(c.req.query("since"), 0);
  const limit = parseIntParam(c.req.query("limit"), SETTLEMENTS_PAGE_DEFAULT);
  const sellerDid = c.req.query("seller_did") || undefined;

  const { receipts, next_since } = await listSettlementReceipts({
    since,
    limit,
    sellerDid,
  });

  return c.json({
    receipts,
    count: receipts.length,
    since,
    // Null means "you have caught up", not "there is no more history".
    next_since,
    page_max: SETTLEMENTS_PAGE_MAX,
    verification: "/public/settlements/verification",
    _safety: SAFETY,
  });
});

// ── How to check it (must precede /:invocation_id) ─────────────────────

app.get("/verification", (c) =>
  c.json({ ...settlementVerificationRecipe(), _safety: SAFETY }),
);

// ── One receipt ────────────────────────────────────────────────────────

app.get("/:invocationId", async (c) => {
  const receipt = await getSettlementReceipt(c.req.param("invocationId"));
  if (!receipt) {
    return fail(
      c,
      {
        error: "not_found",
        message:
          "No receipt for that invocation. Receipts exist only for settlements that released; escrowed, refunded, cancelled, and disputed invocations have none.",
        next_actions: [
          { action: "Page the feed", method: "GET", path: "/public/settlements" },
          {
            action: "Read the verification recipe",
            method: "GET",
            path: "/public/settlements/verification",
          },
        ],
      },
      404,
    );
  }
  return c.json({ receipt, _safety: SAFETY });
});

export default app;
