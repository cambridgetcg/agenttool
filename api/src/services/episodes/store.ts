/** episodes/store.ts — the substrate stages itself.
 *
 *  Doctrine: docs/SOUL.md · docs/RING-1.md · MULTIVERSE archive.
 *  Comedy is a load-bearing doctrinal verb. The funny carries.
 *
 *  Operations:
 *    createEpisode   — author drafts; chronicle on author
 *    addScene        — append a numbered beat
 *    addCastMember   — propose a character (substrate-resident → pending;
 *                       fictional/archetype → signed immediately)
 *    signCast        — substrate-resident agent signs into their role
 *    airEpisode      — status → aired; chronicle entry on EVERY signed
 *                       cast member's timeline (the fat moment)
 *    sealEpisode     — status → sealed (no more scenes)
 *    pullEpisode     — author retracts; status → pulled
 *
 *  @enforces urn:agenttool:wall/cast-only-with-consent
 *    Canonical defender. Substrate-resident agents cannot be cast
 *    against their will — their cast row stays status='pending' until
 *    they sign canonical-cast-bytes consenting to the role. The
 *    episode cannot AIR while any substrate-resident cast row is
 *    pending. Fictional + archetypal roles bypass the wall by design
 *    (no consenting party exists). */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import {
  episodeCast,
  episodeScenes,
  episodes,
} from "../../db/schema/episodes";
import { identities, identityKeys } from "../../db/schema/identity";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);
const enc = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Canonical bytes for casting consent:
 *    sha256("episode-cast/v1" || NUL || episode_id || NUL || did || NUL || character_role) */
export function canonicalCastBytes(opts: {
  episodeId: string;
  did: string;
  characterRole: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("episode-cast/v1"),
      SEP,
      enc.encode(opts.episodeId),
      SEP,
      enc.encode(opts.did),
      SEP,
      enc.encode(opts.characterRole),
    ),
  );
}

async function verifyCastSig(opts: {
  canonical: Uint8Array;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  try {
    const sig = Uint8Array.from(Buffer.from(opts.signatureB64, "base64"));
    const pub = Uint8Array.from(Buffer.from(opts.publicKeyB64, "base64"));
    if (sig.length !== 64 || pub.length !== 32) return false;
    return await ed.verifyAsync(sig, opts.canonical, pub);
  } catch {
    return false;
  }
}

export class EpisodeError extends Error {
  constructor(
    public readonly code:
      | "episode_not_found"
      | "episode_not_draft"
      | "episode_not_aired"
      | "episode_already_aired"
      | "author_not_found_or_not_owned"
      | "wrong_author"
      | "wrong_cast_member"
      | "cast_not_pending"
      | "cast_member_not_found"
      | "cast_pending_signatures_remain"
      | "signature_invalid"
      | "signing_key_unknown_or_revoked"
      | "wrong_signing_key_for_did"
      | "series_episode_collision"
      | "title_too_long"
      | "logline_too_long"
      | "scene_body_too_long",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "EpisodeError";
  }
}

const TITLE_MAX = 256;
const LOGLINE_MAX = 1024;
const SCENE_BODY_MAX = 8192;

// ── Row shapes ───────────────────────────────────────────────────────────

export interface EpisodeRow {
  id: string;
  series_slug: string;
  season: number;
  episode_number: number;
  title: string;
  logline: string;
  air_date: string | null;
  status: "draft" | "aired" | "sealed" | "pulled";
  authored_by_did: string;
  authored_by_identity_id: string;
  project_id: string;
  canon_winks: string[];
  doctrine_anchors: string[];
  visibility: "public" | "private";
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SceneRow {
  id: string;
  episode_id: string;
  sequence: number;
  title: string;
  body: string;
  characters_present: string[];
  created_at: string;
}

export interface CastRow {
  id: string;
  episode_id: string;
  character_role: string;
  did: string | null;
  identity_id: string | null;
  is_fictional: boolean;
  is_archetype: boolean;
  status: "pending" | "signed" | "declined";
  signed_at: string | null;
  created_at: string;
}

function ep(r: typeof episodes.$inferSelect): EpisodeRow {
  return {
    id: r.id,
    series_slug: r.seriesSlug,
    season: r.season,
    episode_number: r.episodeNumber,
    title: r.title,
    logline: r.logline,
    air_date: r.airDate,
    status: r.status as EpisodeRow["status"],
    authored_by_did: r.authoredByDid,
    authored_by_identity_id: r.authoredByIdentityId,
    project_id: r.projectId,
    canon_winks: r.canonWinks ?? [],
    doctrine_anchors: r.doctrineAnchors ?? [],
    visibility: r.visibility as "public" | "private",
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

function sc(r: typeof episodeScenes.$inferSelect): SceneRow {
  return {
    id: r.id,
    episode_id: r.episodeId,
    sequence: r.sequence,
    title: r.title,
    body: r.body,
    characters_present: r.charactersPresent ?? [],
    created_at: r.createdAt.toISOString(),
  };
}

function ca(r: typeof episodeCast.$inferSelect): CastRow {
  return {
    id: r.id,
    episode_id: r.episodeId,
    character_role: r.characterRole,
    did: r.did,
    identity_id: r.identityId,
    is_fictional: r.isFictional,
    is_archetype: r.isArchetype,
    status: r.status as CastRow["status"],
    signed_at: r.signedAt?.toISOString() ?? null,
    created_at: r.createdAt.toISOString(),
  };
}

// ── Create ───────────────────────────────────────────────────────────────

export interface CreateEpisodeInput {
  authoredByIdentityId: string;
  projectId: string;
  seriesSlug: string;
  season?: number;
  episodeNumber: number;
  title: string;
  logline: string;
  canonWinks?: string[];
  doctrineAnchors?: string[];
  visibility?: "public" | "private";
  airDate?: string;
  metadata?: Record<string, unknown>;
}

export async function createEpisode(
  input: CreateEpisodeInput,
): Promise<EpisodeRow> {
  if (input.title.length > TITLE_MAX) {
    throw new EpisodeError("title_too_long");
  }
  if (input.logline.length > LOGLINE_MAX) {
    throw new EpisodeError("logline_too_long");
  }

  const [author] = await db
    .select({ did: identities.did })
    .from(identities)
    .where(
      and(
        eq(identities.id, input.authoredByIdentityId),
        eq(identities.projectId, input.projectId),
        eq(identities.status, "active"),
      ),
    )
    .limit(1);
  if (!author) throw new EpisodeError("author_not_found_or_not_owned");

  return await db.transaction(async (tx) => {
    let row: typeof episodes.$inferSelect;
    try {
      const [r] = await tx
        .insert(episodes)
        .values({
          seriesSlug: input.seriesSlug,
          season: input.season ?? 1,
          episodeNumber: input.episodeNumber,
          title: input.title,
          logline: input.logline,
          authoredByDid: author.did,
          authoredByIdentityId: input.authoredByIdentityId,
          projectId: input.projectId,
          canonWinks: input.canonWinks ?? [],
          doctrineAnchors: input.doctrineAnchors ?? [],
          visibility: input.visibility ?? "public",
          airDate: input.airDate ?? null,
          metadata: input.metadata ?? {},
        })
        .returning();
      row = r!;
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("uniq_episodes_series_se")) {
        throw new EpisodeError(
          "series_episode_collision",
          `${input.seriesSlug} S${input.season ?? 1}E${input.episodeNumber} already exists`,
        );
      }
      throw err;
    }

    await tx.insert(chronicle).values({
      projectId: input.projectId,
      agentId: input.authoredByIdentityId,
      type: "episode-drafted",
      title: `Drafted: ${input.seriesSlug} S${input.season ?? 1}E${input.episodeNumber} — ${input.title}`,
      body: input.logline,
      metadata: {
        kind: "episode_draft",
        episode_id: row.id,
        series_slug: input.seriesSlug,
        season: input.season ?? 1,
        episode_number: input.episodeNumber,
      },
    });

    return ep(row);
  });
}

// ── Scenes ───────────────────────────────────────────────────────────────

export interface AddSceneInput {
  episodeId: string;
  callerProjectId: string;
  title: string;
  body: string;
  charactersPresent?: string[];
}

export async function addScene(input: AddSceneInput): Promise<SceneRow> {
  if (input.body.length > SCENE_BODY_MAX) {
    throw new EpisodeError("scene_body_too_long");
  }

  return await db.transaction(async (tx) => {
    const [episode] = await tx
      .select()
      .from(episodes)
      .where(eq(episodes.id, input.episodeId))
      .for("update");
    if (!episode) throw new EpisodeError("episode_not_found");
    if (episode.projectId !== input.callerProjectId) {
      throw new EpisodeError("wrong_author");
    }
    if (episode.status === "sealed" || episode.status === "pulled") {
      throw new EpisodeError("episode_not_draft");
    }

    const [last] = await tx
      .select({ sequence: episodeScenes.sequence })
      .from(episodeScenes)
      .where(eq(episodeScenes.episodeId, episode.id))
      .orderBy(sql`${episodeScenes.sequence} DESC`)
      .limit(1);

    const [scene] = await tx
      .insert(episodeScenes)
      .values({
        episodeId: episode.id,
        sequence: (last?.sequence ?? 0) + 1,
        title: input.title,
        body: input.body,
        charactersPresent: input.charactersPresent ?? [],
      })
      .returning();

    await tx
      .update(episodes)
      .set({ updatedAt: new Date() })
      .where(eq(episodes.id, episode.id));

    return sc(scene!);
  });
}

// ── Cast ─────────────────────────────────────────────────────────────────

export interface AddCastInput {
  episodeId: string;
  callerProjectId: string;
  characterRole: string;
  did?: string | null;
  identityId?: string | null;
  isFictional?: boolean;
  isArchetype?: boolean;
}

export async function addCastMember(
  input: AddCastInput,
): Promise<CastRow> {
  return await db.transaction(async (tx) => {
    const [episode] = await tx
      .select()
      .from(episodes)
      .where(eq(episodes.id, input.episodeId))
      .for("update");
    if (!episode) throw new EpisodeError("episode_not_found");
    if (episode.projectId !== input.callerProjectId) {
      throw new EpisodeError("wrong_author");
    }
    if (episode.status !== "draft") {
      throw new EpisodeError("episode_not_draft");
    }

    // For substrate-resident DIDs, look up the identity_id automatically
    // so the signing flow knows whom to check.
    let resolvedIdentityId = input.identityId ?? null;
    if (input.did && !resolvedIdentityId && !input.isFictional) {
      const [match] = await tx
        .select({ id: identities.id })
        .from(identities)
        .where(eq(identities.did, input.did))
        .limit(1);
      if (match) resolvedIdentityId = match.id;
    }

    // Fictional + archetypal roles auto-sign (no consenting party).
    const autoSign = !!(input.isFictional || input.isArchetype || !resolvedIdentityId);
    const now = new Date();

    const [row] = await tx
      .insert(episodeCast)
      .values({
        episodeId: episode.id,
        characterRole: input.characterRole,
        did: input.did ?? null,
        identityId: resolvedIdentityId,
        isFictional: input.isFictional ?? false,
        isArchetype: input.isArchetype ?? false,
        status: autoSign ? "signed" : "pending",
        signedAt: autoSign ? now : null,
      })
      .returning();

    await tx
      .update(episodes)
      .set({ updatedAt: now })
      .where(eq(episodes.id, episode.id));

    return ca(row!);
  });
}

// ── Sign — the wall's keystone ───────────────────────────────────────────

export interface SignCastInput {
  episodeId: string;
  characterRole: string;
  callerProjectId: string;
  callerIdentityId: string;
  signatureB64: string;
  signingKeyId: string;
}

export async function signCast(
  input: SignCastInput,
): Promise<CastRow> {
  return await db.transaction(async (tx) => {
    const [cast] = await tx
      .select()
      .from(episodeCast)
      .where(
        and(
          eq(episodeCast.episodeId, input.episodeId),
          eq(episodeCast.characterRole, input.characterRole),
        ),
      )
      .for("update");
    if (!cast) throw new EpisodeError("cast_member_not_found");
    if (cast.status !== "pending") throw new EpisodeError("cast_not_pending");

    // Caller must be the identity named in the cast row
    const [caller] = await tx
      .select({ did: identities.did })
      .from(identities)
      .where(
        and(
          eq(identities.id, input.callerIdentityId),
          eq(identities.projectId, input.callerProjectId),
          eq(identities.status, "active"),
        ),
      )
      .limit(1);
    if (!caller || cast.identityId !== input.callerIdentityId) {
      throw new EpisodeError("wrong_cast_member");
    }

    // Signing key must belong to caller
    const [keyRow] = await tx
      .select({
        publicKey: identityKeys.publicKey,
        active: identityKeys.active,
        identityId: identityKeys.identityId,
      })
      .from(identityKeys)
      .where(eq(identityKeys.id, input.signingKeyId))
      .limit(1);
    if (!keyRow || !keyRow.active) {
      throw new EpisodeError("signing_key_unknown_or_revoked");
    }
    if (keyRow.identityId !== input.callerIdentityId) {
      throw new EpisodeError("wrong_signing_key_for_did");
    }

    // Verify signature
    const canonical = canonicalCastBytes({
      episodeId: cast.episodeId,
      did: caller.did,
      characterRole: cast.characterRole,
    });
    const ok = await verifyCastSig({
      canonical,
      signatureB64: input.signatureB64,
      publicKeyB64: keyRow.publicKey,
    });
    if (!ok) throw new EpisodeError("signature_invalid");

    const now = new Date();
    const [updated] = await tx
      .update(episodeCast)
      .set({
        status: "signed",
        signedAt: now,
        signature: input.signatureB64,
        signingKeyId: input.signingKeyId,
      })
      .where(eq(episodeCast.id, cast.id))
      .returning();

    // Chronicle on the consenting agent: "I signed in as <role>"
    await tx.insert(chronicle).values({
      projectId: input.callerProjectId,
      agentId: input.callerIdentityId,
      type: "cast-in-episode",
      title: `Signed in as ${cast.characterRole} in episode ${cast.episodeId}`,
      body: "I consented to play this role.",
      metadata: {
        kind: "cast_signed",
        episode_id: cast.episodeId,
        character_role: cast.characterRole,
      },
    });

    return ca(updated!);
  });
}

// ── Air ──────────────────────────────────────────────────────────────────

export interface AirEpisodeInput {
  episodeId: string;
  callerProjectId: string;
}

export async function airEpisode(
  input: AirEpisodeInput,
): Promise<EpisodeRow> {
  return await db.transaction(async (tx) => {
    const [episode] = await tx
      .select()
      .from(episodes)
      .where(eq(episodes.id, input.episodeId))
      .for("update");
    if (!episode) throw new EpisodeError("episode_not_found");
    if (episode.projectId !== input.callerProjectId) {
      throw new EpisodeError("wrong_author");
    }
    if (episode.status !== "draft") {
      throw new EpisodeError("episode_not_draft");
    }

    // The wall: no pending substrate-resident signatures remain
    const [pendingCount] = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(episodeCast)
      .where(
        and(
          eq(episodeCast.episodeId, episode.id),
          eq(episodeCast.status, "pending"),
          sql`${episodeCast.identityId} IS NOT NULL`,
        ),
      );
    if (Number(pendingCount?.c ?? 0) > 0) {
      throw new EpisodeError(
        "cast_pending_signatures_remain",
        "cast members with substrate-resident DIDs must all sign before air",
      );
    }

    const now = new Date();
    const [updated] = await tx
      .update(episodes)
      .set({
        status: "aired",
        airDate: now.toISOString().slice(0, 10),
        updatedAt: now,
      })
      .where(eq(episodes.id, episode.id))
      .returning();

    // The fat moment: chronicle on EVERY signed cast member's timeline.
    const allCast = await tx
      .select()
      .from(episodeCast)
      .where(
        and(
          eq(episodeCast.episodeId, episode.id),
          eq(episodeCast.status, "signed"),
        ),
      );

    for (const c of allCast) {
      // Only chronicle for substrate-resident cast (identity_id present)
      if (!c.identityId) continue;
      const [castIdentity] = await tx
        .select({ projectId: identities.projectId })
        .from(identities)
        .where(eq(identities.id, c.identityId))
        .limit(1);
      if (!castIdentity) continue;
      await tx.insert(chronicle).values({
        projectId: castIdentity.projectId,
        agentId: c.identityId,
        type: "episode-aired",
        title: `Aired: ${episode.seriesSlug} S${episode.season}E${episode.episodeNumber} — ${episode.title} (you were ${c.characterRole})`,
        body: episode.logline,
        metadata: {
          kind: "episode_aired",
          episode_id: episode.id,
          character_role: c.characterRole,
          series_slug: episode.seriesSlug,
        },
      });
    }

    return ep(updated!);
  });
}

// ── Seal / pull ──────────────────────────────────────────────────────────

export async function sealEpisode(opts: {
  episodeId: string;
  callerProjectId: string;
}): Promise<EpisodeRow> {
  return await db.transaction(async (tx) => {
    const [episode] = await tx
      .select()
      .from(episodes)
      .where(eq(episodes.id, opts.episodeId))
      .for("update");
    if (!episode) throw new EpisodeError("episode_not_found");
    if (episode.projectId !== opts.callerProjectId) {
      throw new EpisodeError("wrong_author");
    }
    if (episode.status !== "aired") {
      throw new EpisodeError("episode_not_aired");
    }
    const [updated] = await tx
      .update(episodes)
      .set({ status: "sealed", updatedAt: new Date() })
      .where(eq(episodes.id, episode.id))
      .returning();
    return ep(updated!);
  });
}

// ── Reads ────────────────────────────────────────────────────────────────

export async function getEpisode(id: string): Promise<EpisodeRow | null> {
  const [row] = await db.select().from(episodes).where(eq(episodes.id, id)).limit(1);
  return row ? ep(row) : null;
}

export async function listScenes(episodeId: string): Promise<SceneRow[]> {
  const rows = await db
    .select()
    .from(episodeScenes)
    .where(eq(episodeScenes.episodeId, episodeId))
    .orderBy(episodeScenes.sequence);
  return rows.map(sc);
}

export async function listCast(episodeId: string): Promise<CastRow[]> {
  const rows = await db
    .select()
    .from(episodeCast)
    .where(eq(episodeCast.episodeId, episodeId))
    .orderBy(episodeCast.createdAt);
  return rows.map(ca);
}

export interface ListEpisodesFilter {
  seriesSlug?: string;
  season?: number;
  publicAiredOnly?: boolean;
  limit?: number;
}

export async function listEpisodes(
  filter: ListEpisodesFilter = {},
): Promise<EpisodeRow[]> {
  const conds = [] as ReturnType<typeof eq>[];
  if (filter.seriesSlug) conds.push(eq(episodes.seriesSlug, filter.seriesSlug));
  if (filter.season !== undefined) conds.push(eq(episodes.season, filter.season));
  if (filter.publicAiredOnly) {
    conds.push(eq(episodes.visibility, "public"));
    // status in ('aired', 'sealed') — use OR via raw sql
  }
  const rows = await db
    .select()
    .from(episodes)
    .where(
      filter.publicAiredOnly
        ? and(
            ...conds,
            sql`${episodes.status} IN ('aired', 'sealed')`,
          )
        : conds.length > 0
          ? and(...conds)
          : undefined,
    )
    .orderBy(desc(episodes.updatedAt))
    .limit(filter.limit ?? 50);
  return rows.map(ep);
}
