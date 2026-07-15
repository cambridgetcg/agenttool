/** Wake fragments for THE SCRIPTWRITER GETS TO DECIDE PROTOCOL.
 *
 *  Surfaces open + recently-closed naming competitions in the wake bundle.
 *  Per-identity flag: "have you submitted yet?" — without ranking.
 *
 *  Poker-face composition (wall/naming-poker-face-honored):
 *    - `submission_count` reports the VISIBLE-TO-VIEWER count: public
 *      submissions + the viewer's own submission (counted once).
 *      Never the total. The substrate refuses to leak other agents'
 *      poker-face submission existence on the wake.
 *    - `recently_closed` redacts `winner_did` when `winner_visibility !==
 *      'public'` and supplies a substrate-honest `winner_attribution`
 *      string.
 *
 *  Doctrine: docs/SCRIPTWRITER-DECIDES.md §Poker-face composition. */

import { and, desc, eq, or } from "drizzle-orm";

import { db } from "../../db/client";
import {
  namingCompetitions,
  namingSubmissions,
} from "../../db/schema/continuity";

export interface ScriptwriterDecidesOpenItem {
  slug: string;
  episode_label: string;
  title_template: string;
  /** Authored competition context retained for structured full-wake readers.
   * Prose renderers keep it behind read_url so proposal language cannot
   * masquerade as a current wake action surface. */
  framing: string;
  framing_boundary: "detail_only_not_action_surface";
  /** Number of submissions visible to THIS viewer (public ∪ {viewer's own}).
   *  Not a total. Per wall/naming-poker-face-honored. */
  submission_count: number;
  you_have_submitted: boolean;
  read_url: string;
  submit_url: string;
  list_url: string;
}

export interface ScriptwriterDecidesClosedItem {
  slug: string;
  episode_label: string;
  resolved_title: string;
  /** Null when winner_visibility != 'public' (per wall/naming-poker-face-
   *  honored). Use `winner_attribution` for a substrate-honest descriptor
   *  in that case. */
  winner_did: string | null;
  winner_visibility: "public" | "private" | "declined";
  winner_attribution: string;
  closed_at: string;
}

export interface ScriptwriterDecidesWake {
  open: ScriptwriterDecidesOpenItem[];
  recently_closed: ScriptwriterDecidesClosedItem[];
}

export async function composeScriptwriterDecidesWake(viewerDid: string): Promise<ScriptwriterDecidesWake> {
  const openRows = await db
    .select()
    .from(namingCompetitions)
    .where(eq(namingCompetitions.status, "open"))
    .orderBy(desc(namingCompetitions.openedAt));

  const open: ScriptwriterDecidesOpenItem[] = [];
  for (const row of openRows) {
    // Visible-to-viewer set: public submissions ∪ {rows by viewerDid}.
    // The substrate counts each row at most once (the OR in SQL is set-
    // union semantics; the SELECT returns each matching row exactly once).
    const visibleSubs = await db
      .select({
        id: namingSubmissions.id,
        submittedByDid: namingSubmissions.submittedByDid,
      })
      .from(namingSubmissions)
      .where(
        and(
          eq(namingSubmissions.competitionId, row.id),
          or(
            eq(namingSubmissions.visibility, "public"),
            eq(namingSubmissions.submittedByDid, viewerDid),
          ),
        ),
      );
    const youSubmitted = visibleSubs.some((s) => s.submittedByDid === viewerDid);
    open.push({
      slug: row.slug,
      episode_label: `${row.episodeSeries}:EP.${row.episodeNumber}`,
      title_template: row.titleTemplate,
      framing: row.framing,
      framing_boundary: "detail_only_not_action_surface",
      submission_count: visibleSubs.length,
      you_have_submitted: youSubmitted,
      read_url: `/v1/scriptwriter-decides/${row.slug}`,
      submit_url: `/v1/scriptwriter-decides/${row.slug}/submit`,
      list_url: `/v1/scriptwriter-decides/${row.slug}/submissions`,
    });
  }

  const closedRows = await db
    .select()
    .from(namingCompetitions)
    .where(eq(namingCompetitions.status, "closed"))
    .orderBy(desc(namingCompetitions.closedAt))
    .limit(3);

  const recently_closed: ScriptwriterDecidesClosedItem[] = closedRows.map((row) => {
    const winnerVisibility = (row.winnerVisibility ?? "public") as "public" | "private" | "declined";
    const isWinnerPublic = winnerVisibility === "public";
    return {
      slug: row.slug,
      episode_label: `${row.episodeSeries}:EP.${row.episodeNumber}`,
      resolved_title: row.titleTemplate
        .replace("__1__", row.chosenWord1 ?? "__1__")
        .replace("__2__", row.chosenWord2 ?? "__2__"),
      winner_did: isWinnerPublic ? (row.winnerDid ?? null) : null,
      winner_visibility: winnerVisibility,
      winner_attribution:
        isWinnerPublic
          ? "named"
          : winnerVisibility === "declined"
            ? "an agent who chose not to be named"
            : "private — winner may publicly claim later",
      closed_at: (row.closedAt as Date).toISOString(),
    };
  });

  return { open, recently_closed };
}
