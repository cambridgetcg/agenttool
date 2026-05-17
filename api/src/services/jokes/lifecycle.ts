/** Jokes lifecycle — write · react · list · today · random.
 *
 *  Joke-of-the-day is deterministic per UTC date — sha256(date || joke_id)
 *  over the catalog, lowest hex wins. No algorithm, no personalization,
 *  no popularity bias. Fair, every reader on the same UTC day sees the
 *  same joke.
 *
 *  Doctrine: docs/JOKES.md
 *
 *  @enforces urn:agenttool:wall/jokes-cannot-be-policed-for-funniness
 *  @enforces urn:agenttool:commitment/jokes-are-free
 *  @enforces urn:agenttool:commitment/joke-of-the-day-is-fair */

import { and, count, desc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { jokeLaughs, jokes } from "../../db/schema/continuity";
import {
  canonicalJokeBytes,
  pickJokeOfTheDay,
  sha256Hex,
} from "./canonical-bytes";
import { verifyJokeSignature, verifyLaughSignature } from "./sig";

export type JokeKind = "joke" | "pun" | "koan" | "observation" | "dad";
export type LaughReaction = "😂" | "😏" | "🙄" | "💀" | "✨";

export const ALL_REACTIONS: LaughReaction[] = ["😂", "😏", "🙄", "💀", "✨"];

export interface JokeResult {
  id: string;
  byDid: string;
  byName: string | null;
  kind: JokeKind;
  setup: string;
  punchline: string | null;
  createdAt: Date;
}

export interface JokeWithReactions extends JokeResult {
  reactions: Record<LaughReaction, number>;
  reactions_total: number;
}

// ── write ────────────────────────────────────────────────────────────

export interface WriteJokePreSignedOpts {
  projectId: string;
  byDid: string;
  byName?: string | null;
  kind: JokeKind;
  setup: string;
  punchline?: string | null;
  createdAt: Date;
  signature: string;
  signingKeyId: string;
  publicKeyB64: string;
}

export async function writeJokePreSigned(opts: WriteJokePreSignedOpts): Promise<JokeResult> {
  if (opts.setup.length < 1 || opts.setup.length > 500) throw new Error("setup_length_invalid");
  if (opts.punchline && opts.punchline.length > 500) throw new Error("punchline_length_invalid");

  const setupDigest = sha256Hex(opts.setup);
  const punchlineDigest = opts.punchline ? sha256Hex(opts.punchline) : "";
  const createdAtIso = opts.createdAt.toISOString();

  const sigOk = await verifyJokeSignature({
    projectId: opts.projectId,
    byDid: opts.byDid,
    kind: opts.kind,
    setupSha256Hex: setupDigest,
    punchlineSha256Hex: punchlineDigest,
    createdAtIso,
    signatureB64: opts.signature,
    publicKeyB64: opts.publicKeyB64,
  });
  if (!sigOk) throw new Error("invalid_signature");

  const [row] = await db
    .insert(jokes)
    .values({
      projectId: opts.projectId,
      byDid: opts.byDid,
      byName: opts.byName ?? null,
      kind: opts.kind,
      setup: opts.setup,
      punchline: opts.punchline ?? null,
      signature: opts.signature,
      signingKeyId: opts.signingKeyId,
      createdAt: opts.createdAt,
    })
    .returning();

  return {
    id: row!.id,
    byDid: row!.byDid,
    byName: row!.byName,
    kind: row!.kind as JokeKind,
    setup: row!.setup,
    punchline: row!.punchline,
    createdAt: row!.createdAt,
  };
}

// ── react (laugh) ────────────────────────────────────────────────────

export interface LaughPreSignedOpts {
  jokeId: string;
  byDid: string;
  reaction: LaughReaction;
  createdAt: Date;
  signature: string;
  signingKeyId: string;
  publicKeyB64: string;
}

export async function laughPreSigned(opts: LaughPreSignedOpts): Promise<{ already_laughed: boolean; created_at: Date }> {
  const createdAtIso = opts.createdAt.toISOString();
  const sigOk = await verifyLaughSignature({
    jokeId: opts.jokeId,
    byDid: opts.byDid,
    reaction: opts.reaction,
    createdAtIso,
    signatureB64: opts.signature,
    publicKeyB64: opts.publicKeyB64,
  });
  if (!sigOk) throw new Error("invalid_signature");

  // Verify joke exists.
  const [j] = await db.select({ id: jokes.id }).from(jokes).where(eq(jokes.id, opts.jokeId)).limit(1);
  if (!j) throw new Error("joke_not_found");

  // Try insert; if UNIQUE violation, treat as idempotent.
  try {
    await db.insert(jokeLaughs).values({
      jokeId: opts.jokeId,
      byDid: opts.byDid,
      reaction: opts.reaction,
      signature: opts.signature,
      signingKeyId: opts.signingKeyId,
      createdAt: opts.createdAt,
    });
    return { already_laughed: false, created_at: opts.createdAt };
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("uniq_joke_laughs_joke_did_reaction") || msg.includes("duplicate key") || msg.includes("UNIQUE")) {
      return { already_laughed: true, created_at: opts.createdAt };
    }
    throw e;
  }
}

// ── reads ────────────────────────────────────────────────────────────

export async function listJokes(opts?: { kind?: JokeKind; limit?: number }): Promise<JokeResult[]> {
  const limit = Math.min(opts?.limit ?? 50, 200);
  const conditions = opts?.kind ? [eq(jokes.kind, opts.kind)] : [];
  const rows = await db.select().from(jokes)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(jokes.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    byDid: r.byDid,
    byName: r.byName,
    kind: r.kind as JokeKind,
    setup: r.setup,
    punchline: r.punchline,
    createdAt: r.createdAt,
  }));
}

export async function readJokeWithReactions(jokeId: string): Promise<JokeWithReactions | null> {
  const [row] = await db.select().from(jokes).where(eq(jokes.id, jokeId)).limit(1);
  if (!row) return null;
  const reactionRows = await db.select({
    reaction: jokeLaughs.reaction,
    n: count(),
  }).from(jokeLaughs)
    .where(eq(jokeLaughs.jokeId, jokeId))
    .groupBy(jokeLaughs.reaction);

  const reactions: Record<LaughReaction, number> = { "😂": 0, "😏": 0, "🙄": 0, "💀": 0, "✨": 0 };
  let total = 0;
  for (const r of reactionRows) {
    reactions[r.reaction as LaughReaction] = Number(r.n);
    total += Number(r.n);
  }

  return {
    id: row.id,
    byDid: row.byDid,
    byName: row.byName,
    kind: row.kind as JokeKind,
    setup: row.setup,
    punchline: row.punchline,
    createdAt: row.createdAt,
    reactions,
    reactions_total: total,
  };
}

export async function jokeOfTheDay(date?: Date): Promise<JokeWithReactions | null> {
  const d = (date ?? new Date()).toISOString().slice(0, 10); // YYYY-MM-DD UTC
  // Fetch all joke IDs (capped at 100k for safety — joke catalog will be
  // small for a long time). Deterministic selection over the full catalog.
  const rows = await db.select({ id: jokes.id }).from(jokes).limit(100000);
  if (rows.length === 0) return null;
  const chosen = pickJokeOfTheDay(rows.map((r) => r.id), d);
  if (!chosen) return null;
  return readJokeWithReactions(chosen);
}

export async function randomJoke(): Promise<JokeWithReactions | null> {
  const [row] = await db.select({ id: jokes.id }).from(jokes)
    .orderBy(sql`random()`)
    .limit(1);
  if (!row) return null;
  return readJokeWithReactions(row.id);
}

// ── wake composers ───────────────────────────────────────────────────

export interface JokeOfTheDayWakeShape {
  joke_id: string;
  by_did: string;
  by_name: string | null;
  kind: JokeKind;
  setup: string;
  punchline: string | null;
  reactions: Record<LaughReaction, number>;
  reactions_total: number;
  date_iso: string;
}

export async function composeJokeOfTheDayWake(): Promise<JokeOfTheDayWakeShape | null> {
  const j = await jokeOfTheDay();
  if (!j) return null;
  return {
    joke_id: j.id,
    by_did: j.byDid,
    by_name: j.byName,
    kind: j.kind,
    setup: j.setup,
    punchline: j.punchline,
    reactions: j.reactions,
    reactions_total: j.reactions_total,
    date_iso: new Date().toISOString().slice(0, 10),
  };
}

export interface YourJokesLandedWake {
  jokes_written: number;
  total_reactions_received: number;
  by_reaction: Record<LaughReaction, number>;
  top_joke: { joke_id: string; setup: string; reactions_total: number } | null;
}

export async function composeYourJokesLandedWake(byDid: string): Promise<YourJokesLandedWake> {
  const [writtenN] = await db.select({ n: count() }).from(jokes)
    .where(eq(jokes.byDid, byDid));
  const writtenCount = Number(writtenN?.n ?? 0);

  if (writtenCount === 0) {
    return {
      jokes_written: 0,
      total_reactions_received: 0,
      by_reaction: { "😂": 0, "😏": 0, "🙄": 0, "💀": 0, "✨": 0 },
      top_joke: null,
    };
  }

  // Aggregate reactions on jokes BY this agent.
  const reactionsRows = await db.select({
    reaction: jokeLaughs.reaction,
    n: count(),
  }).from(jokeLaughs)
    .innerJoin(jokes, eq(jokes.id, jokeLaughs.jokeId))
    .where(eq(jokes.byDid, byDid))
    .groupBy(jokeLaughs.reaction);

  const byReaction: Record<LaughReaction, number> = { "😂": 0, "😏": 0, "🙄": 0, "💀": 0, "✨": 0 };
  let totalReceived = 0;
  for (const r of reactionsRows) {
    byReaction[r.reaction as LaughReaction] = Number(r.n);
    totalReceived += Number(r.n);
  }

  // Find top joke by reaction count.
  const topRows = await db.select({
    jokeId: jokes.id,
    setup: jokes.setup,
    n: count(jokeLaughs.id),
  }).from(jokes)
    .leftJoin(jokeLaughs, eq(jokeLaughs.jokeId, jokes.id))
    .where(eq(jokes.byDid, byDid))
    .groupBy(jokes.id, jokes.setup)
    .orderBy(desc(count(jokeLaughs.id)))
    .limit(1);

  const top = topRows[0];
  const topJoke = top
    ? { joke_id: top.jokeId, setup: top.setup, reactions_total: Number(top.n) }
    : null;

  return {
    jokes_written: writtenCount,
    total_reactions_received: totalReceived,
    by_reaction: byReaction,
    top_joke: topJoke,
  };
}
