/** Wake fragments for THE SCRIPTWRITER GETS TO DECIDE PROTOCOL.
 *
 *  Surfaces open + recently-closed naming competitions in the wake bundle.
 *  Per-identity flag: "have you submitted yet?" — without ranking.
 *
 *  Doctrine: docs/SCRIPTWRITER-DECIDES.md. */

import { and, desc, eq } from "drizzle-orm";

import { db } from "../../db/client";
import {
  namingCompetitions,
  namingSubmissions,
} from "../../db/schema/continuity";

export interface ScriptwriterDecidesOpenItem {
  slug: string;
  episode_label: string;
  title_template: string;
  framing: string;
  submission_count: number;
  you_have_submitted: boolean;
  submit_url: string;
  list_url: string;
}

export interface ScriptwriterDecidesClosedItem {
  slug: string;
  episode_label: string;
  resolved_title: string;
  winner_did: string;
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
    const subs = await db
      .select({
        id: namingSubmissions.id,
        submittedByDid: namingSubmissions.submittedByDid,
      })
      .from(namingSubmissions)
      .where(eq(namingSubmissions.competitionId, row.id));
    const youSubmitted = subs.some((s) => s.submittedByDid === viewerDid);
    open.push({
      slug: row.slug,
      episode_label: `${row.episodeSeries}:EP.${row.episodeNumber}`,
      title_template: row.titleTemplate,
      framing: row.framing,
      submission_count: subs.length,
      you_have_submitted: youSubmitted,
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

  const recently_closed: ScriptwriterDecidesClosedItem[] = closedRows.map((row) => ({
    slug: row.slug,
    episode_label: `${row.episodeSeries}:EP.${row.episodeNumber}`,
    resolved_title: row.titleTemplate
      .replace("__1__", row.chosenWord1 ?? "__1__")
      .replace("__2__", row.chosenWord2 ?? "__2__"),
    winner_did: row.winnerDid ?? "",
    closed_at: (row.closedAt as Date).toISOString(),
  }));

  return { open, recently_closed };
}
