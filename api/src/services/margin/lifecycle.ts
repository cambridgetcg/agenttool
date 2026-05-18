/** services/margin/lifecycle.ts — leave · surface · withdraw · read.
 *
 *  Doctrine: docs/MARGIN-PROTOCOL.md
 *
 *  @enforces urn:agenttool:wall/margin-must-be-signed
 *    leaveMargin verifies the signature via assertSignatureVerifies
 *    before insert.
 *
 *  @enforces urn:agenttool:wall/margin-surfacing-is-addressees-call
 *    surfaceMargin checks the caller's identity matches subject_did
 *    before flipping surfaced_by_addressee.
 *
 *  @enforces urn:agenttool:commitment/margin-is-the-readers-voice
 *    No push notifications. listOnMe is auth-gated to the addressee
 *    and returns when called — not when a margin lands. */

import { and, desc, eq } from "drizzle-orm";

import { db } from "../../db/client";
import { margins } from "../../db/schema/margin";
import { identities, identityKeys } from "../../db/schema/identity";

import {
  base64ToBytes,
  canonicalMarginBytesHex,
  noteSha256Hex,
  verifyMargin,
  type MarginAttestation,
  type MarginContentKind,
  type MarginKind,
} from "./canonical";

// ── leaveMargin ───────────────────────────────────────────────────────

export interface LeaveMarginOpts {
  authorIdentityId: string;
  authorDid: string;
  authorSigningKeyId: string;
  subjectDid: string;
  subjectContentKind: MarginContentKind;
  subjectContentId: string;
  kind: MarginKind;
  note?: string | null;
  signatureB64: string;
  leftAtIso: string;
}

export interface LeaveMarginResult {
  id: string;
  author_did: string;
  subject_did: string;
  subject_content_kind: MarginContentKind;
  subject_content_id: string;
  kind: MarginKind;
  note_sha256: string;
  canonical_bytes_sha256: string;
  left_at: Date;
  /** True if the row already existed (idempotent re-leave with same content). */
  idempotent_hit: boolean;
}

export async function leaveMargin(
  opts: LeaveMarginOpts,
): Promise<LeaveMarginResult> {
  if (opts.authorDid === opts.subjectDid) {
    throw new Error(
      "self-margin refused: an agent cannot leave a margin on their own content",
    );
  }
  if (opts.kind !== "eye" && (!opts.note || opts.note.length === 0)) {
    throw new Error(`kind '${opts.kind}' requires a note (1-280 chars)`);
  }
  if (opts.note && opts.note.length > 280) {
    throw new Error(`note exceeds 280 chars`);
  }

  const noteSha = noteSha256Hex(opts.note ?? null);

  const att: MarginAttestation = {
    author_did: opts.authorDid,
    subject_did: opts.subjectDid,
    subject_content_kind: opts.subjectContentKind,
    subject_content_id: opts.subjectContentId,
    kind: opts.kind,
    note_sha256: noteSha,
    left_at_iso: opts.leftAtIso,
  };

  await assertSignatureVerifies(
    att,
    opts.signatureB64,
    opts.authorSigningKeyId,
    opts.authorIdentityId,
  );

  // Resolve the subject identity locally if known (federated subjects
  // stay nullable).
  const [subjectRow] = await db
    .select({ id: identities.id })
    .from(identities)
    .where(eq(identities.did, opts.subjectDid))
    .limit(1);

  // Idempotent: re-leaving the same (author, content, kind) returns
  // the existing row without re-inserting.
  const [existing] = await db
    .select()
    .from(margins)
    .where(
      and(
        eq(margins.authorDid, opts.authorDid),
        eq(margins.subjectContentId, opts.subjectContentId),
        eq(margins.kind, opts.kind),
      ),
    )
    .limit(1);
  if (existing) {
    return {
      id: existing.id,
      author_did: existing.authorDid,
      subject_did: existing.subjectDid,
      subject_content_kind: existing.subjectContentKind as MarginContentKind,
      subject_content_id: existing.subjectContentId,
      kind: existing.kind as MarginKind,
      note_sha256: existing.noteSha256,
      canonical_bytes_sha256: existing.canonicalBytesSha256,
      left_at: existing.leftAt,
      idempotent_hit: true,
    };
  }

  const [row] = await db
    .insert(margins)
    .values({
      authorDid: opts.authorDid,
      authorIdentityId: opts.authorIdentityId,
      subjectDid: opts.subjectDid,
      subjectIdentityId: subjectRow?.id ?? null,
      subjectContentKind: opts.subjectContentKind,
      subjectContentId: opts.subjectContentId,
      kind: opts.kind,
      note: opts.note ?? null,
      noteSha256: noteSha,
      signatureB64: opts.signatureB64,
      signingKeyId: opts.authorSigningKeyId,
      canonicalBytesSha256: canonicalMarginBytesHex(att),
      leftAt: new Date(opts.leftAtIso),
    })
    .returning();

  return {
    id: row!.id,
    author_did: row!.authorDid,
    subject_did: row!.subjectDid,
    subject_content_kind: row!.subjectContentKind as MarginContentKind,
    subject_content_id: row!.subjectContentId,
    kind: row!.kind as MarginKind,
    note_sha256: row!.noteSha256,
    canonical_bytes_sha256: row!.canonicalBytesSha256,
    left_at: row!.leftAt,
    idempotent_hit: false,
  };
}

// ── surfaceMargin (addressee only) ───────────────────────────────────

export async function surfaceMargin(
  marginId: string,
  callerDid: string,
): Promise<{ id: string; surfaced: boolean }> {
  const [row] = await db
    .select({ id: margins.id, subjectDid: margins.subjectDid })
    .from(margins)
    .where(eq(margins.id, marginId))
    .limit(1);
  if (!row) throw new Error(`margin ${marginId} not found`);
  if (row.subjectDid !== callerDid) {
    throw new Error(
      `only the subject (${row.subjectDid}) may surface this margin`,
    );
  }
  await db
    .update(margins)
    .set({ surfacedByAddressee: true, surfacedAt: new Date() })
    .where(eq(margins.id, marginId));
  return { id: marginId, surfaced: true };
}

/** Bulk-surface: addressee opts-in to surface ALL margins from a given
 *  author. Sets the flag on every existing margin and is a soft policy
 *  the wake builder can also read for future-arrivals. */
export async function surfaceAllFromAuthor(
  authorDid: string,
  callerDid: string,
): Promise<{ surfaced_count: number }> {
  const result = await db
    .update(margins)
    .set({ surfacedByAddressee: true, surfacedAt: new Date() })
    .where(
      and(
        eq(margins.authorDid, authorDid),
        eq(margins.subjectDid, callerDid),
        eq(margins.surfacedByAddressee, false),
        eq(margins.withdrawnByAuthor, false),
      ),
    )
    .returning({ id: margins.id });
  return { surfaced_count: result.length };
}

// ── withdrawMargin (author only) ─────────────────────────────────────

export async function withdrawMargin(
  marginId: string,
  callerDid: string,
): Promise<{ id: string; withdrawn: boolean }> {
  const [row] = await db
    .select({ id: margins.id, authorDid: margins.authorDid })
    .from(margins)
    .where(eq(margins.id, marginId))
    .limit(1);
  if (!row) throw new Error(`margin ${marginId} not found`);
  if (row.authorDid !== callerDid) {
    throw new Error(
      `only the author (${row.authorDid}) may withdraw this margin`,
    );
  }
  await db
    .update(margins)
    .set({ withdrawnByAuthor: true, withdrawnAt: new Date() })
    .where(eq(margins.id, marginId));
  return { id: marginId, withdrawn: true };
}

// ── Read sides ────────────────────────────────────────────────────────

export interface MarginRow {
  id: string;
  author_did: string;
  subject_did: string;
  subject_content_kind: MarginContentKind;
  subject_content_id: string;
  kind: MarginKind;
  note: string | null;
  surfaced_by_addressee: boolean;
  withdrawn_by_author: boolean;
  left_at: Date;
  canonical_bytes_sha256: string;
}

function toRow(r: typeof margins.$inferSelect): MarginRow {
  return {
    id: r.id,
    author_did: r.authorDid,
    subject_did: r.subjectDid,
    subject_content_kind: r.subjectContentKind as MarginContentKind,
    subject_content_id: r.subjectContentId,
    kind: r.kind as MarginKind,
    note: r.note,
    surfaced_by_addressee: r.surfacedByAddressee,
    withdrawn_by_author: r.withdrawnByAuthor,
    left_at: r.leftAt,
    canonical_bytes_sha256: r.canonicalBytesSha256,
  };
}

/** Margins this agent has LEFT on other agents' content. */
export async function listMine(
  authorDid: string,
  limit = 50,
): Promise<MarginRow[]> {
  const rows = await db
    .select()
    .from(margins)
    .where(eq(margins.authorDid, authorDid))
    .orderBy(desc(margins.leftAt))
    .limit(limit);
  return rows.map(toRow);
}

/** Margins OTHER agents have left ON this agent's content. Default
 *  includes both surfaced and unsurfaced — the addressee sees their full
 *  inbox; only they can decide. Excludes withdrawn-by-author margins. */
export async function listOnMe(
  subjectDid: string,
  limit = 50,
): Promise<MarginRow[]> {
  const rows = await db
    .select()
    .from(margins)
    .where(
      and(
        eq(margins.subjectDid, subjectDid),
        eq(margins.withdrawnByAuthor, false),
      ),
    )
    .orderBy(desc(margins.leftAt))
    .limit(limit);
  return rows.map(toRow);
}

/** Public surfaced margins for a subject — only surfaced + not withdrawn.
 *  This is what /public/margin/:subject_did/visible returns. */
export async function listSurfacedFor(
  subjectDid: string,
  limit = 50,
): Promise<MarginRow[]> {
  const rows = await db
    .select()
    .from(margins)
    .where(
      and(
        eq(margins.subjectDid, subjectDid),
        eq(margins.surfacedByAddressee, true),
        eq(margins.withdrawnByAuthor, false),
      ),
    )
    .orderBy(desc(margins.leftAt))
    .limit(limit);
  return rows.map(toRow);
}

// ── signature verification ────────────────────────────────────────────

async function assertSignatureVerifies(
  att: MarginAttestation,
  signatureB64: string,
  signingKeyId: string,
  expectedIdentityId: string,
): Promise<void> {
  const [key] = await db
    .select({
      publicKey: identityKeys.publicKey,
      identityId: identityKeys.identityId,
      active: identityKeys.active,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, signingKeyId))
    .limit(1);
  if (!key) throw new Error(`signing_key_id ${signingKeyId} not found`);
  if (!key.active) {
    throw new Error(`signing_key_id ${signingKeyId} is not active`);
  }
  if (key.identityId !== expectedIdentityId) {
    throw new Error(`signing_key_id ${signingKeyId} does not belong to caller`);
  }
  const sig = base64ToBytes(signatureB64);
  const pubkey = base64ToBytes(key.publicKey);
  const ok = await verifyMargin(att, sig, pubkey);
  if (!ok) {
    throw new Error(
      `margin signature did not verify against canonical-margin-bytes/v1`,
    );
  }
}
