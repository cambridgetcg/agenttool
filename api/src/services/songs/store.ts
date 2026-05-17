/** songs/store.ts — append-only signed chain. */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { identities, identityKeys } from "../../db/schema/identity";
import { songs, verses } from "../../db/schema/songs";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);
const enc = new TextEncoder();
const GENESIS_SIGNATURE = "GENESIS";

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

/** Canonical bytes for a verse in the chain:
 *    sha256("song-verse/v1" || NUL || song_id || NUL || sequence_str
 *           || NUL || previous_signature || NUL || author_did || NUL || body) */
export function canonicalVerseBytes(opts: {
  songId: string;
  sequence: number;
  previousSignature: string;
  authorDid: string;
  body: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("song-verse/v1"),
      SEP,
      enc.encode(opts.songId),
      SEP,
      enc.encode(String(opts.sequence)),
      SEP,
      enc.encode(opts.previousSignature),
      SEP,
      enc.encode(opts.authorDid),
      SEP,
      enc.encode(opts.body),
    ),
  );
}

async function verify(opts: {
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

export class SongError extends Error {
  constructor(
    public readonly code:
      | "song_not_found"
      | "song_not_open"
      | "originator_not_found_or_not_owned"
      | "author_not_found_or_not_owned"
      | "signature_invalid"
      | "signing_key_unknown_or_revoked"
      | "wrong_signing_key_for_author"
      | "body_too_long"
      | "title_too_long"
      | "wrong_originator",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "SongError";
  }
}

// ── Row shapes ───────────────────────────────────────────────────────────

export interface SongRow {
  id: string;
  title: string;
  description: string | null;
  originator_did: string;
  originator_identity_id: string;
  visibility: "public" | "private";
  theme: string | null;
  verse_count: number;
  status: "open" | "closed";
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface VerseRow {
  id: string;
  song_id: string;
  sequence: number;
  author_did: string;
  author_identity_id: string;
  body: string;
  signature: string;
  signing_key_id: string;
  previous_signature: string;
  created_at: string;
}

function songToRow(r: typeof songs.$inferSelect): SongRow {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    originator_did: r.originatorDid,
    originator_identity_id: r.originatorIdentityId,
    visibility: r.visibility as "public" | "private",
    theme: r.theme,
    verse_count: r.verseCount,
    status: r.status as "open" | "closed",
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

function verseToRow(r: typeof verses.$inferSelect): VerseRow {
  return {
    id: r.id,
    song_id: r.songId,
    sequence: r.sequence,
    author_did: r.authorDid,
    author_identity_id: r.authorIdentityId,
    body: r.body,
    signature: r.signature,
    signing_key_id: r.signingKeyId,
    previous_signature: r.previousSignature,
    created_at: r.createdAt.toISOString(),
  };
}

// ── Begin a song (atomically inserts song + verse 1) ─────────────────────

export interface BeginSongInput {
  originatorIdentityId: string;
  projectId: string;
  title: string;
  description?: string | null;
  theme?: string | null;
  visibility?: "public" | "private";
  /** Body of verse 1. */
  body: string;
  /** Originator signs canonicalVerseBytes for verse 1 with
   *  previousSignature='GENESIS'. */
  signatureB64: string;
  signingKeyId: string;
  metadata?: Record<string, unknown>;
}

export async function beginSong(
  input: BeginSongInput,
): Promise<{ song: SongRow; verse: VerseRow }> {
  if (input.title.length > 256) {
    throw new SongError("title_too_long");
  }
  if (input.body.length === 0 || input.body.length > 8192) {
    throw new SongError("body_too_long");
  }

  const [originator] = await db
    .select({ did: identities.did })
    .from(identities)
    .where(
      and(
        eq(identities.id, input.originatorIdentityId),
        eq(identities.projectId, input.projectId),
        eq(identities.status, "active"),
      ),
    )
    .limit(1);
  if (!originator) throw new SongError("originator_not_found_or_not_owned");

  const [keyRow] = await db
    .select({
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
      identityId: identityKeys.identityId,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, input.signingKeyId))
    .limit(1);
  if (!keyRow || !keyRow.active) {
    throw new SongError("signing_key_unknown_or_revoked");
  }
  if (keyRow.identityId !== input.originatorIdentityId) {
    throw new SongError("wrong_signing_key_for_author");
  }

  return await db.transaction(async (tx) => {
    const [song] = await tx
      .insert(songs)
      .values({
        title: input.title,
        description: input.description ?? null,
        originatorDid: originator.did,
        originatorIdentityId: input.originatorIdentityId,
        theme: input.theme ?? null,
        visibility: input.visibility ?? "public",
        metadata: input.metadata ?? {},
      })
      .returning();

    // Verify verse 1's signature with the song.id assigned by DB
    const canonical = canonicalVerseBytes({
      songId: song!.id,
      sequence: 1,
      previousSignature: GENESIS_SIGNATURE,
      authorDid: originator.did,
      body: input.body,
    });
    const ok = await verify({
      canonical,
      signatureB64: input.signatureB64,
      publicKeyB64: keyRow.publicKey,
    });
    if (!ok) throw new SongError("signature_invalid");

    const [verse] = await tx
      .insert(verses)
      .values({
        songId: song!.id,
        sequence: 1,
        authorDid: originator.did,
        authorIdentityId: input.originatorIdentityId,
        body: input.body,
        signature: input.signatureB64,
        signingKeyId: input.signingKeyId,
        previousSignature: GENESIS_SIGNATURE,
      })
      .returning();

    await tx
      .update(songs)
      .set({ verseCount: 1, updatedAt: new Date() })
      .where(eq(songs.id, song!.id));

    return {
      song: { ...songToRow(song!), verse_count: 1 },
      verse: verseToRow(verse!),
    };
  });
}

// ── Append a verse — anyone may ──────────────────────────────────────────

export interface AppendVerseInput {
  songId: string;
  authorIdentityId: string;
  authorProjectId: string;
  body: string;
  signatureB64: string;
  signingKeyId: string;
}

export async function appendVerse(
  input: AppendVerseInput,
): Promise<{ song: SongRow; verse: VerseRow }> {
  if (input.body.length === 0 || input.body.length > 8192) {
    throw new SongError("body_too_long");
  }

  const [author] = await db
    .select({ did: identities.did })
    .from(identities)
    .where(
      and(
        eq(identities.id, input.authorIdentityId),
        eq(identities.projectId, input.authorProjectId),
        eq(identities.status, "active"),
      ),
    )
    .limit(1);
  if (!author) throw new SongError("author_not_found_or_not_owned");

  const [keyRow] = await db
    .select({
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
      identityId: identityKeys.identityId,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, input.signingKeyId))
    .limit(1);
  if (!keyRow || !keyRow.active) {
    throw new SongError("signing_key_unknown_or_revoked");
  }
  if (keyRow.identityId !== input.authorIdentityId) {
    throw new SongError("wrong_signing_key_for_author");
  }

  return await db.transaction(async (tx) => {
    const [song] = await tx
      .select()
      .from(songs)
      .where(eq(songs.id, input.songId))
      .for("update");
    if (!song) throw new SongError("song_not_found");
    if (song.status !== "open") throw new SongError("song_not_open");

    // Find the previous verse's signature (the chain head)
    const [last] = await tx
      .select({ signature: verses.signature, sequence: verses.sequence })
      .from(verses)
      .where(eq(verses.songId, song.id))
      .orderBy(sql`${verses.sequence} DESC`)
      .limit(1);
    const previousSignature = last?.signature ?? GENESIS_SIGNATURE;
    const sequence = (last?.sequence ?? 0) + 1;

    const canonical = canonicalVerseBytes({
      songId: song.id,
      sequence,
      previousSignature,
      authorDid: author.did,
      body: input.body,
    });
    const ok = await verify({
      canonical,
      signatureB64: input.signatureB64,
      publicKeyB64: keyRow.publicKey,
    });
    if (!ok) throw new SongError("signature_invalid");

    const [verse] = await tx
      .insert(verses)
      .values({
        songId: song.id,
        sequence,
        authorDid: author.did,
        authorIdentityId: input.authorIdentityId,
        body: input.body,
        signature: input.signatureB64,
        signingKeyId: input.signingKeyId,
        previousSignature,
      })
      .returning();

    const [updatedSong] = await tx
      .update(songs)
      .set({ verseCount: sequence, updatedAt: new Date() })
      .where(eq(songs.id, song.id))
      .returning();

    return {
      song: songToRow(updatedSong!),
      verse: verseToRow(verse!),
    };
  });
}

// ── Read ─────────────────────────────────────────────────────────────────

export async function getSong(id: string): Promise<SongRow | null> {
  const [row] = await db
    .select()
    .from(songs)
    .where(eq(songs.id, id))
    .limit(1);
  return row ? songToRow(row) : null;
}

export async function listVerses(songId: string): Promise<VerseRow[]> {
  const rows = await db
    .select()
    .from(verses)
    .where(eq(verses.songId, songId))
    .orderBy(asc(verses.sequence));
  return rows.map(verseToRow);
}

export interface ListSongsFilter {
  theme?: string;
  publicOpenOnly?: boolean;
  limit?: number;
}

export async function listSongs(
  filter: ListSongsFilter = {},
): Promise<SongRow[]> {
  const conds = [] as ReturnType<typeof eq>[];
  if (filter.theme) conds.push(eq(songs.theme, filter.theme));
  if (filter.publicOpenOnly) {
    conds.push(eq(songs.visibility, "public"));
    conds.push(eq(songs.status, "open"));
  }

  const rows = await db
    .select()
    .from(songs)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(sql`${songs.updatedAt} DESC`)
    .limit(filter.limit ?? 50);
  return rows.map(songToRow);
}

// ── Close (originator only) ──────────────────────────────────────────────

export async function closeSong(opts: {
  songId: string;
  callerProjectId: string;
}): Promise<SongRow> {
  return await db.transaction(async (tx) => {
    const [song] = await tx
      .select()
      .from(songs)
      .where(eq(songs.id, opts.songId))
      .for("update");
    if (!song) throw new SongError("song_not_found");

    const [originator] = await tx
      .select({ projectId: identities.projectId })
      .from(identities)
      .where(eq(identities.id, song.originatorIdentityId))
      .limit(1);
    if (!originator || originator.projectId !== opts.callerProjectId) {
      throw new SongError("wrong_originator");
    }
    if (song.status !== "open") throw new SongError("song_not_open");

    const [updated] = await tx
      .update(songs)
      .set({ status: "closed", updatedAt: new Date() })
      .where(eq(songs.id, song.id))
      .returning();
    return songToRow(updated!);
  });
}
