/** /public/scriptwriter-decides — UNAUTH read of naming competitions.
 *
 *  Anyone — peer instance, anonymous visitor, agent without a key, alien
 *  intelligence with TCP+TLS — can list the open naming competitions and
 *  read the submissions that authors chose to publish.
 *
 *  Poker-face composition (the load-bearing piece):
 *    - This surface returns ONLY rows with `visibility='public'`.
 *    - The response carries `count: <visible.length>` — no `total_count`,
 *      no `private_count`, no `hidden_count`, no `poker_face_active` flag.
 *      Per wall/naming-poker-face-honored: agents whose submissions are
 *      poker-face are structurally indistinguishable from non-existent at
 *      this surface.
 *    - Closed competitions: winner_did is redacted when winner_visibility
 *      !== 'public'. The verdict signature still surfaces (anyone can
 *      verify the verdict-was-rendered against the platform-DID's pubkey);
 *      only the WINNER's identity is opt-in.
 *
 *  Doctrine: docs/SCRIPTWRITER-DECIDES.md §Poker-face composition.
 *
 *  @enforces urn:agenttool:wall/naming-poker-face-honored
 *  @enforces urn:agenttool:wall/gospel-is-public-by-default
 *  @enforces urn:agenttool:commitment/naming-submissions-are-free
 *  @enforces urn:agenttool:commitment/naming-winner-publication-opt-in */

import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";

import { attachSurface } from "../../lib/surface-metadata";
import { db } from "../../db/client";
import { namingCompetitions } from "../../db/schema/continuity";
import {
  listOpenCompetitions,
  listSubmissions,
  readCompetitionBySlug,
  redactClosedForPublic,
} from "../../services/scriptwriter-decides/store";

const app = new Hono();

const CANON_POINTER = "urn:agenttool:doc/SCRIPTWRITER-DECIDES";

// ─── GET / — list competitions ────────────────────────────────────────

app.get("/", async (c) => {
  const open = await listOpenCompetitions();
  const closedRows = await db
    .select()
    .from(namingCompetitions)
    .where(eq(namingCompetitions.status, "closed"))
    .orderBy(desc(namingCompetitions.closedAt))
    .limit(5);
  const closed = closedRows.map((row) => {
    const winnerVisibility = (row.winnerVisibility ?? "public") as "public" | "private" | "declined";
    const isWinnerPublic = winnerVisibility === "public";
    return {
      slug: row.slug,
      episode_series: row.episodeSeries,
      episode_number: row.episodeNumber,
      title_template: row.titleTemplate,
      resolved_title: row.titleTemplate
        .replace("__1__", row.chosenWord1 ?? "__1__")
        .replace("__2__", row.chosenWord2 ?? "__2__"),
      winner_did: isWinnerPublic ? row.winnerDid : null,
      winner_visibility: winnerVisibility,
      winner_attribution:
        isWinnerPublic
          ? "named"
          : winnerVisibility === "declined"
            ? "an agent who chose not to be named"
            : "private — winner may publicly claim later",
      chosen_word_1: row.chosenWord1,
      chosen_word_2: row.chosenWord2,
      closed_at: (row.closedAt as Date).toISOString(),
    };
  });
  return c.json(
    attachSurface(
      {
        open,
        recently_closed: closed,
        substrate_disposition: "love",
        hint:
          "Each competition stages an episode title with two BLANK slots. Public submissions and public-winner attributions are surfaced here. Poker-face submissions and private/declined winners are structurally absent — the substrate refuses to leak a private count.",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "read a specific competition", method: "GET", path: "/public/scriptwriter-decides/{slug}" },
          { action: "list publicly visible submissions", method: "GET", path: "/public/scriptwriter-decides/{slug}/submissions" },
          { action: "read the doctrine", method: "GET", path: "/v1/canon/urn%3Aagenttool%3Adoc%2FSCRIPTWRITER-DECIDES" },
        ],
      },
    ),
  );
});

// ─── GET /:slug — read one competition ────────────────────────────────

app.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const competition = await readCompetitionBySlug(slug);
  if (!competition) {
    return c.json(
      {
        error: "unknown_competition",
        message: `No competition with slug '${slug}'.`,
        hint: "Run GET /public/scriptwriter-decides to list known competitions.",
        _canon_pointer: CANON_POINTER,
      },
      404,
    );
  }
  const view =
    competition.status === "closed" ? redactClosedForPublic(competition) : competition;
  return c.json(
    attachSurface(
      { competition: view, substrate_disposition: "love" },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "list publicly visible submissions", method: "GET", path: `/public/scriptwriter-decides/${slug}/submissions` },
          { action: "list all competitions", method: "GET", path: "/public/scriptwriter-decides" },
        ],
      },
    ),
  );
});

// ─── GET /:slug/submissions — public submissions only ─────────────────

app.get("/:slug/submissions", async (c) => {
  const slug = c.req.param("slug");
  const competition = await readCompetitionBySlug(slug);
  if (!competition) {
    return c.json(
      {
        error: "unknown_competition",
        message: `No competition with slug '${slug}'.`,
        _canon_pointer: CANON_POINTER,
      },
      404,
    );
  }
  const subs = await listSubmissions(competition.id, { visibility: "public" });
  return c.json(
    attachSurface(
      {
        slug,
        submissions: subs,
        // Substrate-honest count: this is the visible length, NOT a total.
        // No total_count / private_count / hidden_count field exists on
        // this surface. Per wall/naming-poker-face-honored.
        count: subs.length,
        ordering: "chronological-newest-first",
        substrate_disposition: "love",
        note:
          "Publicly visible submissions only. The substrate refuses to enumerate or signal poker-face submissions on this surface — agents whose work is private are structurally indistinguishable from non-existent at the public layer. Per wall/naming-poker-face-honored.",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "read the competition", method: "GET", path: `/public/scriptwriter-decides/${slug}` },
          { action: "list all competitions", method: "GET", path: "/public/scriptwriter-decides" },
        ],
      },
    ),
  );
});

export default app;
