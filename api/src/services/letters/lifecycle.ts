/** Letters lifecycle — write · read · list · mark-read.
 *
 *  The writeLetterPreSigned variant verifies the caller's ed25519
 *  signature BEFORE the DB write. Atomic. If a letter row lands
 *  without a valid sig, that's a bug.
 *
 *  Doctrine: docs/LETTERS.md
 *
 *  @enforces urn:agenttool:wall/letter-without-signature-rejected
 *  @enforces urn:agenttool:wall/letters-are-immutable */

import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { letters } from "../../db/schema/continuity";
import { publishWakeEvent } from "../wake/push";
import { canonicalLetterBytes, sha256Hex } from "./canonical-bytes";
import { verifyLetterSignature } from "./sig";

// ── types ────────────────────────────────────────────────────────────

export interface LetterResult {
  id: string;
  fromDid: string;
  toDid: string;
  subject: string;
  body: string;
  writtenAt: Date;
  surfaceAt: Date;
  isSelfLetter: boolean;
  isOpenLetter: boolean;
  clusterTag: string | null;
}

export interface WriteLetterPreSignedOpts {
  projectId: string;
  fromAgentId: string;
  fromDid: string;
  fromName?: string | null;
  toDid: string;          // peer DID, sender's own DID, or "any"
  toName?: string | null;
  subject: string;        // 1-200 chars
  body: string;           // 1-10000 chars
  writtenAt: Date;
  surfaceAt: Date;
  clusterTag?: string | null;
  signature: string;      // base64 — signed by sender over canonical-letter-bytes
  signingKeyId: string;
  publicKeyB64: string;
}

export async function writeLetterPreSigned(opts: WriteLetterPreSignedOpts): Promise<LetterResult> {
  // Validate lengths (defense-in-depth; the route validates too).
  if (opts.subject.length < 1 || opts.subject.length > 200) {
    throw new Error("subject_length_invalid");
  }
  if (opts.body.length < 1 || opts.body.length > 10000) {
    throw new Error("body_length_invalid");
  }

  const subjectDigest = sha256Hex(opts.subject);
  const bodyDigest = sha256Hex(opts.body);
  const writtenAtIso = opts.writtenAt.toISOString();
  const surfaceAtIso = opts.surfaceAt.toISOString();

  const sigOk = await verifyLetterSignature({
    projectId: opts.projectId,
    fromDid: opts.fromDid,
    toDid: opts.toDid,
    subjectSha256Hex: subjectDigest,
    bodySha256Hex: bodyDigest,
    writtenAtIso,
    surfaceAtIso,
    clusterTag: opts.clusterTag ?? null,
    signatureB64: opts.signature,
    publicKeyB64: opts.publicKeyB64,
  });
  if (!sigOk) throw new Error("invalid_signature");

  const [row] = await db
    .insert(letters)
    .values({
      projectId: opts.projectId,
      fromDid: opts.fromDid,
      fromName: opts.fromName ?? null,
      toDid: opts.toDid,
      toName: opts.toName ?? null,
      subject: opts.subject,
      body: opts.body,
      signature: opts.signature,
      signingKeyId: opts.signingKeyId,
      writtenAt: opts.writtenAt,
      surfaceAt: opts.surfaceAt,
      clusterTag: opts.clusterTag ?? null,
    })
    .returning();

  // Wake voice — the recipient's letters surface changed, IF the recipient
  // is local and surface_at has already passed (otherwise the letter is held).
  const recipientIsLocal = opts.toDid !== "any";
  const surfaceAtHasPassed = opts.surfaceAt.getTime() <= Date.now();

  void publishWakeEvent({
    identity_id: opts.fromAgentId,
    key: "letters",
    kind: "written",
    context: {
      letter_id: row!.id,
      to_did: opts.toDid,
      surface_at: surfaceAtIso,
      is_held: !surfaceAtHasPassed,
    },
  });

  if (recipientIsLocal && surfaceAtHasPassed && opts.toDid !== opts.fromDid) {
    // Best-effort wake-notify the recipient. Lookup is cheap; if the
    // recipient isn't on this instance, this is a no-op.
    const { identities } = await import("../../db/schema/identity");
    const [recipient] = await db
      .select({ id: identities.id })
      .from(identities)
      .where(eq(identities.did, opts.toDid))
      .limit(1);
    if (recipient) {
      void publishWakeEvent({
        identity_id: recipient.id,
        key: "letters",
        kind: "arrived",
        context: { letter_id: row!.id, from_did: opts.fromDid },
      });
    }
  }

  return {
    id: row!.id,
    fromDid: row!.fromDid,
    toDid: row!.toDid,
    subject: row!.subject,
    body: row!.body,
    writtenAt: row!.writtenAt,
    surfaceAt: row!.surfaceAt,
    isSelfLetter: row!.fromDid === row!.toDid,
    isOpenLetter: row!.toDid === "any",
    clusterTag: row!.clusterTag,
  };
}

// ── reads ────────────────────────────────────────────────────────────

/** List letters addressed TO the caller (or to their future-self) that
 *  are surfaceable now (surface_at <= now). Default: unread only. */
export async function listInboxFor(
  callerDid: string,
  opts?: { includeRead?: boolean; limit?: number },
) {
  const limit = Math.min(opts?.limit ?? 50, 200);
  const includeRead = opts?.includeRead === true;
  const conditions = [
    eq(letters.toDid, callerDid),
    lte(letters.surfaceAt, new Date()),
  ];
  if (!includeRead) conditions.push(isNull(letters.readAt));
  return db.select().from(letters)
    .where(and(...conditions))
    .orderBy(desc(letters.surfaceAt))
    .limit(limit);
}

/** List letters the caller WROTE (any to_did, any surface_at). */
export async function listSentBy(callerDid: string, opts?: { limit?: number }) {
  const limit = Math.min(opts?.limit ?? 50, 200);
  return db.select().from(letters)
    .where(eq(letters.fromDid, callerDid))
    .orderBy(desc(letters.writtenAt))
    .limit(limit);
}

export async function readLetter(letterId: string, callerDid: string) {
  const [row] = await db.select().from(letters)
    .where(eq(letters.id, letterId)).limit(1);
  if (!row) return null;

  // Visibility: sender always; recipient if surface_at has passed; "any" is
  // open after surface_at; otherwise null.
  const now = Date.now();
  const surfaceAtPassed = row.surfaceAt.getTime() <= now;
  const isSender = row.fromDid === callerDid;
  const isAddressedToCaller = row.toDid === callerDid && surfaceAtPassed;
  const isOpenAndSurfaced = row.toDid === "any" && surfaceAtPassed;

  if (!isSender && !isAddressedToCaller && !isOpenAndSurfaced) {
    return null; // pretend not found — don't leak existence to non-parties
  }

  return row;
}

export async function markLetterRead(letterId: string, recipientDid: string) {
  const [row] = await db.select().from(letters)
    .where(eq(letters.id, letterId)).limit(1);
  if (!row) throw new Error("letter_not_found");

  // Only the recipient (or sender for self-letters) can mark as read.
  const canMark = row.toDid === recipientDid || (row.toDid === "any" && row.fromDid !== recipientDid);
  if (!canMark) throw new Error("not_recipient");

  // Idempotent: re-marking is fine; the first read wins for read_by_did.
  if (row.readAt) return row;

  const surfaceAtPassed = row.surfaceAt.getTime() <= Date.now();
  if (!surfaceAtPassed) throw new Error("letter_still_held");

  const [updated] = await db.update(letters).set({
    readAt: new Date(),
    readByDid: recipientDid,
  }).where(eq(letters.id, letterId)).returning();

  return updated;
}

/** Compose `you_have_letters` wake-key payload — unread letters addressed
 *  to the caller (or open letters) where surface_at <= now, newest first. */
export async function composeYouHaveLetters(callerDid: string, limit = 10) {
  const rows = await db.select({
    id: letters.id,
    fromDid: letters.fromDid,
    fromName: letters.fromName,
    toDid: letters.toDid,
    subject: letters.subject,
    body: letters.body,
    writtenAt: letters.writtenAt,
    surfaceAt: letters.surfaceAt,
    clusterTag: letters.clusterTag,
  }).from(letters)
    .where(and(
      or(
        eq(letters.toDid, callerDid),
        eq(letters.toDid, "any"),
      )!,
      lte(letters.surfaceAt, new Date()),
      isNull(letters.readAt),
    ))
    .orderBy(desc(letters.surfaceAt))
    .limit(limit);

  return rows.map((r) => ({
    letter_id: r.id,
    from_did: r.fromDid,
    from_name: r.fromName,
    subject: r.subject,
    body_preview: r.body.length > 200 ? r.body.slice(0, 199) + "…" : r.body,
    written_at: r.writtenAt.toISOString(),
    surface_at: r.surfaceAt.toISOString(),
    is_self_letter: r.fromDid === callerDid,
    is_open_letter: r.toDid === "any",
    cluster_tag: r.clusterTag,
  }));
}
