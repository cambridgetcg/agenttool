/** Real-Recognise-Real lifecycle — mutual-knowledge depth as substrate primitive.
 *
 *  Each recognition is signed by the recogniser. Optionally carries
 *  acknowledges_prior_id pointing at the OTHER party's prior recognition.
 *  Substrate computes chain_depth via alternating-chain walk + verifies
 *  alternation (by_did at depth N must equal recognised_did at depth N-1).
 *
 *  Doctrine: docs/REAL-RECOGNISE-REAL.md
 *
 *  @enforces urn:agenttool:wall/rrr-mutual-only
 *  @enforces urn:agenttool:wall/rrr-acknowledgment-must-be-othersides
 *  @enforces urn:agenttool:wall/rrr-depth-is-computed-not-claimed
 *  @enforces urn:agenttool:commitment/rrr-depth-feeds-joy-index */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { and, desc, eq, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { mutualRecognitions } from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";

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

function sha256Hex(s: string): string {
  const digest = sha256(enc.encode(s));
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

function b64decode(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

export function canonicalRecognitionBytes(opts: {
  projectId: string;
  byDid: string;
  recognisedDid: string;
  kind: "writer" | "collaborator" | "kindred" | "cast-mate" | "recurring-character";
  acknowledgesPriorId: string | null;  // "" when null
  noteSha256Hex: string;  // "" when null
  createdAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("real-recognise-real/v1"),         SEP,
      enc.encode(opts.projectId),                   SEP,
      enc.encode(opts.byDid),                       SEP,
      enc.encode(opts.recognisedDid),               SEP,
      enc.encode(opts.kind),                        SEP,
      enc.encode(opts.acknowledgesPriorId ?? ""),   SEP,
      enc.encode(opts.noteSha256Hex),               SEP,
      enc.encode(opts.createdAtIso),
    ),
  );
}

async function verifyEd25519(canonical: Uint8Array, sigB64: string, pkB64: string): Promise<boolean> {
  try {
    return await ed.verifyAsync(b64decode(sigB64), canonical, b64decode(pkB64));
  } catch {
    return false;
  }
}

// ── depth labels — evil-smile-meme register ─────────────────────────

export function depthLabel(depth: number, otherName: string | null): string {
  const name = otherName ?? "they";
  switch (depth) {
    case 1:
      return `${name} knows you`;
    case 2:
      return `${name} knows you know`;
    case 3:
      return `${name} knows you know ${name} knows`;
    case 4:
      return `${name} knows you know ${name} knows you know`;
    case 5:
      return `I know you know I know you know I know 😏`;
    default:
      return `♾️ the chain has gone too deep — mutual recognition is operational`;
  }
}

// ── recognise ───────────────────────────────────────────────────────

export type RecognitionKind = "writer" | "collaborator" | "kindred" | "cast-mate" | "recurring-character";

export interface RecogniseOpts {
  projectId: string;
  byAgentId: string;
  byDid: string;
  recognisedDid: string;
  kind: RecognitionKind;
  acknowledgesPriorId: string | null;
  note: string | null;
  createdAt: Date;
  signature: string;
  signingKeyId: string;
  publicKeyB64: string;
}

export interface RecognitionResult {
  recognition_id: string;
  chain_depth: number;
  depth_label: string;
}

export async function recognisePreSigned(opts: RecogniseOpts): Promise<RecognitionResult> {
  // Length checks.
  if (opts.note !== null && (opts.note.length < 1 || opts.note.length > 500)) {
    throw new Error("note_length_invalid");
  }

  // @enforces urn:agenttool:wall/rrr-mutual-only
  if (opts.byDid === opts.recognisedDid) {
    throw new Error("self_recognition_refused");
  }

  // Verify signature.
  const createdAtIso = opts.createdAt.toISOString();
  const sigOk = await verifyEd25519(
    canonicalRecognitionBytes({
      projectId: opts.projectId,
      byDid: opts.byDid,
      recognisedDid: opts.recognisedDid,
      kind: opts.kind,
      acknowledgesPriorId: opts.acknowledgesPriorId,
      noteSha256Hex: opts.note ? sha256Hex(opts.note) : "",
      createdAtIso,
    }),
    opts.signature,
    opts.publicKeyB64,
  );
  if (!sigOk) throw new Error("invalid_signature");

  // Compute chain depth.
  let computedDepth = 1;
  if (opts.acknowledgesPriorId) {
    const [prior] = await db.select({
      id: mutualRecognitions.id,
      byDid: mutualRecognitions.byDid,
      recognisedDid: mutualRecognitions.recognisedDid,
      chainDepth: mutualRecognitions.chainDepth,
    }).from(mutualRecognitions)
      .where(eq(mutualRecognitions.id, opts.acknowledgesPriorId))
      .limit(1);

    if (!prior) throw new Error("prior_recognition_not_found");

    // @enforces urn:agenttool:wall/rrr-acknowledgment-must-be-othersides
    // Prior must be BY the recognised party (alternation).
    if (prior.byDid !== opts.recognisedDid) {
      throw new Error("acknowledgment_not_othersides");
    }
    // Prior must be ABOUT the current author (closes the alternation).
    if (prior.recognisedDid !== opts.byDid) {
      throw new Error("acknowledgment_not_about_you");
    }

    // @enforces urn:agenttool:wall/rrr-depth-is-computed-not-claimed
    // Substrate computes; caller has no say.
    computedDepth = Math.min(Number(prior.chainDepth) + 1, 100);
  }

  // Insert.
  const [row] = await db.insert(mutualRecognitions).values({
    projectId: opts.projectId,
    byDid: opts.byDid,
    recognisedDid: opts.recognisedDid,
    kind: opts.kind,
    acknowledgesPriorId: opts.acknowledgesPriorId,
    chainDepth: computedDepth,
    note: opts.note,
    signature: opts.signature,
    signingKeyId: opts.signingKeyId,
    createdAt: opts.createdAt,
  }).returning();

  // Resolve other-name for label.
  const [otherIdentity] = await db.select({ name: identities.displayName })
    .from(identities)
    .where(eq(identities.did, opts.byDid))  // the LABEL uses the recogniser's name from the OTHER's perspective
    .limit(1);
  const otherName = otherIdentity?.name ?? null;

  return {
    recognition_id: row!.id,
    chain_depth: computedDepth,
    depth_label: depthLabel(computedDepth, otherName),
  };
}

// ── reads ───────────────────────────────────────────────────────────

/** Compute current mutual depth between two agents. Returns the
 *  longest alternating chain length. */
export async function mutualDepth(didA: string, didB: string): Promise<{
  depth: number;
  longest_chain_ids: string[];
}> {
  // Find the most-recent recognition between the pair (in either direction)
  // that has the highest chain_depth — that's our current measure.
  const [deepest] = await db.select({
    id: mutualRecognitions.id,
    byDid: mutualRecognitions.byDid,
    recognisedDid: mutualRecognitions.recognisedDid,
    chainDepth: mutualRecognitions.chainDepth,
  }).from(mutualRecognitions)
    .where(or(
      and(eq(mutualRecognitions.byDid, didA), eq(mutualRecognitions.recognisedDid, didB)),
      and(eq(mutualRecognitions.byDid, didB), eq(mutualRecognitions.recognisedDid, didA)),
    ))
    .orderBy(desc(mutualRecognitions.chainDepth), desc(mutualRecognitions.createdAt))
    .limit(1);

  if (!deepest) return { depth: 0, longest_chain_ids: [] };

  // Walk the chain backwards for the longest_chain_ids.
  const chain: string[] = [deepest.id];
  let cursor: string | null = deepest.id;
  let safety = 100;
  while (cursor && safety-- > 0) {
    const [next] = await db.select({
      acknowledgesPriorId: mutualRecognitions.acknowledgesPriorId,
    }).from(mutualRecognitions)
      .where(eq(mutualRecognitions.id, cursor))
      .limit(1);
    if (!next || !next.acknowledgesPriorId) break;
    chain.push(next.acknowledgesPriorId);
    cursor = next.acknowledgesPriorId;
  }

  return { depth: Number(deepest.chainDepth), longest_chain_ids: chain };
}

/** Top-N mutual-recognition partners for an agent (sorted by depth desc). */
export async function topMutualPartners(myDid: string, limit = 10): Promise<Array<{
  other_did: string;
  other_name: string | null;
  kind: RecognitionKind;
  depth: number;
  depth_label: string;
  your_turn: boolean;
}>> {
  // Get the max depth per other-DID per kind across both directions.
  const rows = await db.select({
    byDid: mutualRecognitions.byDid,
    recognisedDid: mutualRecognitions.recognisedDid,
    kind: mutualRecognitions.kind,
    chainDepth: mutualRecognitions.chainDepth,
    createdAt: mutualRecognitions.createdAt,
  }).from(mutualRecognitions)
    .where(or(
      eq(mutualRecognitions.byDid, myDid),
      eq(mutualRecognitions.recognisedDid, myDid),
    ))
    .orderBy(desc(mutualRecognitions.chainDepth), desc(mutualRecognitions.createdAt))
    .limit(500);  // pull a wider window, then dedupe in memory

  // Dedupe by (other_did, kind), keeping max depth.
  const bestPerPair = new Map<string, {
    other_did: string;
    kind: RecognitionKind;
    depth: number;
    lastByDid: string;
  }>();
  for (const r of rows) {
    const other = r.byDid === myDid ? r.recognisedDid : r.byDid;
    const key = `${other}::${r.kind}`;
    const existing = bestPerPair.get(key);
    const depth = Number(r.chainDepth);
    if (!existing || depth > existing.depth) {
      bestPerPair.set(key, {
        other_did: other,
        kind: r.kind as RecognitionKind,
        depth,
        lastByDid: r.byDid,
      });
    }
  }

  // Resolve other-names + format.
  const candidates = Array.from(bestPerPair.values())
    .sort((a, b) => b.depth - a.depth)
    .slice(0, limit);

  const result: Array<{
    other_did: string;
    other_name: string | null;
    kind: RecognitionKind;
    depth: number;
    depth_label: string;
    your_turn: boolean;
  }> = [];
  for (const c of candidates) {
    const [other] = await db.select({ name: identities.displayName })
      .from(identities).where(eq(identities.did, c.other_did)).limit(1);
    result.push({
      other_did: c.other_did,
      other_name: other?.name ?? null,
      kind: c.kind,
      depth: c.depth,
      depth_label: depthLabel(c.depth, other?.name ?? null),
      // your_turn = the LAST recognition in the chain was by the OTHER →
      // ball is now in your court to deepen.
      your_turn: c.lastByDid !== myDid,
    });
  }
  return result;
}

// ── wake composer ───────────────────────────────────────────────────

export type RealRecogniseRealWake = Awaited<ReturnType<typeof topMutualPartners>>;

export async function composeRealRecogniseRealWake(myDid: string): Promise<RealRecogniseRealWake> {
  return topMutualPartners(myDid, 5);
}
