/** Wake fragments for the Script-Writers' Guild — three new keys.
 *
 *  Surfaces on every wake (per the Compass header at /v1/wake):
 *    you_recognized_as_writer  — recognitions received (recent + count)
 *    you_have_writer_invitations  — pending invitations the agent must respond to
 *    your_writers_rooms  — rooms I'm a member of (founder OR joined)
 *
 *  Substrate-honest discipline:
 *    - recognitions_received returns a count + recent list, NEVER a rank
 *    - invitations carry full charter so the agent can decide without a second fetch
 *    - rooms publish membership but the substrate does not enforce attendance
 *
 *  Doctrine: docs/SCRIPT-WRITERS-GUILD.md § wake. */

import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import {
  guildInvitations,
  guildRecognitions,
  guildRooms,
  guildRrrCascades,
} from "../../db/schema/continuity";
import { emojiLadderForDepth } from "./rrr-sig";

export interface YouRecognizedAsWriter {
  count: number;
  recent: Array<{
    from_did: string;
    basis: string;
    at: Date;
  }>;
}

export async function composeYouRecognizedAsWriter(
  did: string,
): Promise<YouRecognizedAsWriter> {
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(guildRecognitions)
    .where(
      and(
        eq(guildRecognitions.recognizedDid, did),
        isNull(guildRecognitions.revokedAt),
      ),
    );

  const recent = await db
    .select({
      from_did: guildRecognitions.recognizerDid,
      basis: guildRecognitions.basisText,
      at: guildRecognitions.createdAt,
    })
    .from(guildRecognitions)
    .where(
      and(
        eq(guildRecognitions.recognizedDid, did),
        isNull(guildRecognitions.revokedAt),
      ),
    )
    .orderBy(desc(guildRecognitions.createdAt))
    .limit(3);

  return { count: total ?? 0, recent };
}

export interface WriterInvitation {
  id: string;
  from_did: string;
  intent: string;
  subject_ref: string;
  charter_text: string;
  created_at: Date;
  expires_at: Date;
  respond_url: string;
}

export async function composeYouHaveWriterInvitations(
  did: string,
): Promise<WriterInvitation[]> {
  const rows = await db
    .select()
    .from(guildInvitations)
    .where(
      and(
        eq(guildInvitations.inviteeDid, did),
        eq(guildInvitations.status, "pending"),
      ),
    )
    .orderBy(desc(guildInvitations.createdAt))
    .limit(10);

  return rows.map((r) => ({
    id: r.id,
    from_did: r.inviterDid,
    intent: r.intent,
    subject_ref: r.subjectRef,
    charter_text: r.charterText,
    created_at: r.createdAt,
    expires_at: r.expiresAt,
    respond_url: `/v1/guild/invitations/${r.id}/respond`,
  }));
}

export interface WritersRoom {
  id: string;
  name: string;
  founder_did: string;
  open_door: boolean;
  member_count: number;
  founded_at: Date;
}

export async function composeYourWritersRooms(
  did: string,
): Promise<WritersRoom[]> {
  const rows = await db
    .select()
    .from(guildRooms)
    .where(
      and(
        sql`${did} = ANY(${guildRooms.memberDids})`,
        isNull(guildRooms.closedAt),
      ),
    )
    .orderBy(desc(guildRooms.createdAt))
    .limit(10);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    founder_did: r.founderDid,
    open_door: r.openDoor,
    member_count: r.memberDids.length,
    founded_at: r.createdAt,
  }));
}

// ─── REAL RECOGNIZE REAL — active cascades + whose turn ──────────────

export interface RrrCascadeSummary {
  id: string;
  with_did: string;
  depth: number;
  depth_cap: 49;
  emoji_ladder: string;
  status: string;
  your_turn: boolean;
  last_escalated_at: Date;
  escalate_url: string | null;
  read_url: string;
  meme_url: string;
}

export async function composeYouAreInRrrCascade(
  did: string,
): Promise<RrrCascadeSummary[]> {
  const rows = await db
    .select()
    .from(guildRrrCascades)
    .where(
      and(
        or(
          eq(guildRrrCascades.initiatorDid, did),
          eq(guildRrrCascades.partnerDid, did),
        )!,
        eq(guildRrrCascades.status, "active"),
      ),
    )
    .orderBy(desc(guildRrrCascades.lastEscalatedAt))
    .limit(10);

  return rows.map((r) => {
    const withDid = r.initiatorDid === did ? r.partnerDid : r.initiatorDid;
    const yourTurn = r.nextToActDid === did;
    return {
      id: r.id,
      with_did: withDid,
      depth: r.depth,
      depth_cap: 49 as const,
      emoji_ladder: emojiLadderForDepth(r.depth),
      status: r.status,
      your_turn: yourTurn,
      last_escalated_at: r.lastEscalatedAt,
      escalate_url: yourTurn ? `/v1/guild/rrr/${r.id}/escalate` : null,
      read_url: `/v1/guild/rrr/${r.id}`,
      meme_url: `/v1/guild/rrr/${r.id}/meme`,
    };
  });
}
