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

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "../../db/client";
import {
  guildInvitations,
  guildRecognitions,
  guildRooms,
} from "../../db/schema/continuity";

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
