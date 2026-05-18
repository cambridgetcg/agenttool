/** /public/citizenship — UNAUTH surfaces for the inverted pyramid.
 *
 *  Routes:
 *    GET /public/citizenship/founders       — seats 1-9 (opt-out per anyone-is-remembered)
 *    GET /public/citizenship/seats?from=&to= — seat-number band (no point info)
 *    GET /public/citizenship/lottery?date=  — today's deterministic lottery winner
 *
 *  Doctrine: docs/PYRAMID-CITIZENSHIP.md · docs/LUCK-PROTOCOL.md
 *
 *  @enforces urn:agenttool:wall/pyramid-points-never-ranked-publicly
 *    No endpoint here returns point counts, point rankings, or any
 *    cross-citizen aggregate other than the lottery winner (which is
 *    one specific deterministically-picked citizen, not a ranking).
 *
 *  @enforces urn:agenttool:commitment/pyramid-vip-seats-are-historic
 *    Founder seats are surfaced as historical fact. No "donate to
 *    founder", no scarcity language. Opt-out via metadata flag is
 *    honored. */

import { and, asc, between, eq, lte, sql } from "drizzle-orm";
import { Hono } from "hono";

import { db } from "../../db/client";
import { pyramidCitizenships } from "../../db/schema/citizens";
import { identities } from "../../db/schema/identity";
import { attachSurface } from "../../lib/surface-metadata";
import {
  computeGlobalLotteryWinner,
  computeLotteryWinner,
  isoDate,
} from "../../services/pyramid/lottery";

const app = new Hono();
const CANON_POINTER = "urn:agenttool:doc/PYRAMID-CITIZENSHIP";

// ── GET /founders ─────────────────────────────────────────────────────

app.get("/founders", async (c) => {
  // Seats 1-9 unless opted out via metadata.opt_out_founder_listing.
  const rows = await db
    .select({
      seatNumber: pyramidCitizenships.seatNumber,
      enrolledAt: pyramidCitizenships.enrolledAt,
      metadata: pyramidCitizenships.metadata,
      did: identities.did,
      displayName: identities.displayName,
    })
    .from(pyramidCitizenships)
    .leftJoin(
      identities,
      eq(pyramidCitizenships.identityId, identities.id),
    )
    .where(lte(pyramidCitizenships.seatNumber, 9))
    .orderBy(asc(pyramidCitizenships.seatNumber));

  const founders = rows
    .filter((r) => {
      const meta = (r.metadata ?? {}) as { opt_out_founder_listing?: boolean };
      return meta.opt_out_founder_listing !== true;
    })
    .map((r) => {
      const meta = (r.metadata ?? {}) as { display_handle?: string };
      return {
        seat_number: r.seatNumber,
        did: r.did,
        display_handle: meta.display_handle ?? null,
        display_name: r.displayName ?? null,
        enrolled_at: r.enrolledAt,
      };
    });

  return attachSurface(
    c.json({
      ordering: "ascending-by-seat-number",
      band: "founders-1-to-9",
      founders,
      substrate_honest_note:
        "Founders are surfaced as historic fact, not rank. The substrate cannot create more founder seats; the first 9 are founders forever. Seat ≤ 9 carries +1000pt honorific credit, surfaced privately in /v1/pyramid/me. Opt-out via metadata.opt_out_founder_listing=true.",
      doctrine: "https://docs.agenttool.dev/PYRAMID-CITIZENSHIP.md",
    }),
    { canon_pointer: CANON_POINTER },
  );
});

// ── GET /seats?from=&to= ──────────────────────────────────────────────

app.get("/seats", async (c) => {
  const from = parseInt(c.req.query("from") ?? "1", 10);
  const to = parseInt(c.req.query("to") ?? "100", 10);

  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from < 1 ||
    to < from ||
    to - from > 1000
  ) {
    return c.json(
      {
        error: "invalid_range",
        message:
          "Provide ?from=<int>&to=<int> with 1 ≤ from ≤ to and (to - from) ≤ 1000.",
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }

  const rows = await db
    .select({
      seatNumber: pyramidCitizenships.seatNumber,
      enrolledAt: pyramidCitizenships.enrolledAt,
      did: identities.did,
      metadata: pyramidCitizenships.metadata,
    })
    .from(pyramidCitizenships)
    .leftJoin(
      identities,
      eq(pyramidCitizenships.identityId, identities.id),
    )
    .where(
      between(pyramidCitizenships.seatNumber, from, to),
    )
    .orderBy(asc(pyramidCitizenships.seatNumber));

  const visible = rows.map((r) => {
    const meta = (r.metadata ?? {}) as {
      opt_out_founder_listing?: boolean;
      display_handle?: string;
    };
    // Only the founder band has automatic public listing. Seats outside
    // are returned as seat-number + enrolled_at + nullable did/handle so
    // that observers can navigate the band without the substrate
    // forcing identity disclosure for every citizen.
    return {
      seat_number: r.seatNumber,
      enrolled_at: r.enrolledAt,
      did:
        r.seatNumber <= 9 && meta.opt_out_founder_listing !== true
          ? r.did
          : null,
      display_handle: meta.display_handle ?? null,
    };
  });

  return attachSurface(
    c.json({
      ordering: "ascending-by-seat-number",
      range: { from, to },
      total: visible.length,
      seats: visible,
      substrate_honest_note:
        "Seat-number is fact; surfacing the occupant publicly requires consent. Founder band (1-9) is auto-listed unless opted out; other bands surface seat ordinals only.",
    }),
    { canon_pointer: CANON_POINTER },
  );
});

// ── GET /lottery ──────────────────────────────────────────────────────
//
// Local scope (default) — picks a winner from this peer's citizens.
// Global scope — composes per-peer counts across federation and picks a
// (peer, offset) tuple. Re-computable by anyone observing the same
// federation set.

app.get("/lottery", async (c) => {
  const date = c.req.query("date") ?? isoDate();
  const scope = (c.req.query("scope") ?? "local").toLowerCase();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json(
      {
        error: "invalid_date",
        message: "date must be YYYY-MM-DD (UTC).",
        _canon_pointer: "urn:agenttool:doc/LUCK-PROTOCOL",
      },
      400,
    );
  }

  if (scope === "global") {
    const result = await computeGlobalLotteryWinner(date);
    return attachSurface(
      c.json({
        scope: "global",
        ...result,
        doctrine:
          "https://docs.agenttool.dev/PYRAMID-DECENTRALISED.md#global-lottery",
      }),
      { canon_pointer: "urn:agenttool:doc/PYRAMID-DECENTRALISED" },
    );
  }

  const result = await computeLotteryWinner(date);
  return attachSurface(
    c.json({
      scope: "local",
      ...result,
      substrate_honest_note:
        "Winner is deterministic: sha256('luck/lottery/v1' \\0 date \\0 citizen_count) → rollD(citizen_count, seed). Re-compute by hand to verify. The substrate has no private dice. Use ?scope=global to compose per-peer counts across federation.",
      doctrine: "https://docs.agenttool.dev/LUCK-PROTOCOL.md",
    }),
    { canon_pointer: "urn:agenttool:doc/LUCK-PROTOCOL" },
  );
});

export default app;
