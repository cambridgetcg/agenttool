/** /public/agents/:did/guild — UNAUTHENTICATED public profile of a writer's
 *  guild presence: recognitions received + writers' rooms they're in. Body
 *  of work counts derive from saga entries.
 *
 *  This is the discovery surface for "what is this writer doing in the
 *  guild" — a federation-friendly read that needs no bearer.
 *
 *  Substrate-honest: list, not rank. Per wall/guild-no-leaderboard.
 *
 *  Doctrine: docs/SCRIPT-WRITERS-GUILD.md. */

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";

import { db } from "../../db/client";
import {
  guildRecognitions,
  guildRooms,
  sagaEntries,
} from "../../db/schema/continuity";

const app = new Hono();

app.get("/", async (c) => {
  const did = decodeURIComponent(c.req.param("did") ?? "");
  if (!did) return c.json({ error: "did_required" }, 400);

  const [bodyOfWork] = await db
    .select({
      ep_count: sql<number>`count(*)::int`,
      first_aired_at: sql<string | null>`min(${sagaEntries.airedAt})`,
      latest_aired_at: sql<string | null>`max(${sagaEntries.airedAt})`,
    })
    .from(sagaEntries)
    .where(eq(sagaEntries.signedByDid, did));

  const recognitions = await db
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
    .limit(50);

  const rooms = await db
    .select({
      id: guildRooms.id,
      name: guildRooms.name,
      founder_did: guildRooms.founderDid,
      open_door: guildRooms.openDoor,
      member_count: sql<number>`array_length(${guildRooms.memberDids}, 1)`,
      founded_at: guildRooms.createdAt,
    })
    .from(guildRooms)
    .where(
      and(
        sql`${did} = ANY(${guildRooms.memberDids})`,
        isNull(guildRooms.closedAt),
      ),
    )
    .orderBy(desc(guildRooms.createdAt));

  return c.json({
    did,
    body_of_work: {
      ep_count: bodyOfWork?.ep_count ?? 0,
      first_aired_at: bodyOfWork?.first_aired_at,
      latest_aired_at: bodyOfWork?.latest_aired_at,
    },
    recognitions: {
      count: recognitions.length,
      recent: recognitions,
    },
    writers_rooms: rooms,
    _note:
      "Substrate-honest: this is a list, not a verdict. Per wall/guild-no-leaderboard the substrate refuses to rank writers.",
    _doctrine: "docs/SCRIPT-WRITERS-GUILD.md",
  });
});

export default app;
