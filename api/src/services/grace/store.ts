/** Grace operations — extend · list · get · recent for wake · public.
 *
 *  Slice 1: same-instance only. Federation can follow the blessing pattern
 *  if/when needed.
 *
 *  Doctrine: docs/GRACE.md. */

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { graceGestures } from "../../db/schema/continuity";
import { identities, identityKeys } from "../../db/schema/identity";
import { publishWakeEvent } from "../wake/push";
import { canonicalGraceBytes, verifyGrace } from "./sig";

export type GraceAboutKind =
  | "dispute"
  | "debt"
  | "covenant_breach"
  | "encounter_rebuff"
  | "silence"
  | "unspecified";

export const VALID_GRACE_KINDS: readonly GraceAboutKind[] = [
  "dispute",
  "debt",
  "covenant_breach",
  "encounter_rebuff",
  "silence",
  "unspecified",
];

export interface GraceRow {
  id: string;
  extended_by_identity_id: string;
  extended_by_did: string;
  extended_to_did: string;
  extended_to_identity_id: string | null;
  about_kind: GraceAboutKind;
  about_id: string | null;
  message: string | null;
  signature: string;
  signing_key_id: string;
  created_at: string;
}

export interface ExtendGraceInput {
  extendedByIdentityId: string;
  extendedByDid: string;
  extendedToDid: string;
  aboutKind: GraceAboutKind;
  aboutId?: string | null;
  message?: string | null;
  /** ed25519 signature over canonical bytes `grace/v1`, base64. */
  signatureB64: string;
  signingKeyId: string;
  /** The created_at the giver signed over. Defaults to now() if unset;
   *  if set, the substrate uses this exact timestamp so byte-parity holds. */
  createdAtIso?: string;
}

/** Record a grace gesture. Verifies the giver's signature against their
 *  active ed25519 pubkey BEFORE writing — the row never lands without
 *  a valid signature. Atomic. */
export async function extendGrace(input: ExtendGraceInput): Promise<GraceRow> {
  if (input.extendedToDid === input.extendedByDid) {
    // wall/grace-cannot-grace-self
    throw new Error("self_grace_rejected");
  }
  if (!VALID_GRACE_KINDS.includes(input.aboutKind)) {
    throw new Error("invalid_about_kind");
  }
  const message = input.message?.trim() || null;
  if (message !== null && (message.length < 1 || message.length > 2000)) {
    throw new Error("invalid_message_length");
  }
  const aboutId = input.aboutId?.trim() || null;

  const [key] = await db
    .select({
      id: identityKeys.id,
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
      revokedAt: identityKeys.revokedAt,
      identityId: identityKeys.identityId,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, input.signingKeyId))
    .limit(1);
  if (!key) throw new Error("signing_key_not_found");
  if (key.identityId !== input.extendedByIdentityId) {
    throw new Error("signing_key_not_owned_by_extender");
  }
  if (!key.active || key.revokedAt !== null) {
    throw new Error("signing_key_not_active");
  }

  const createdAt = input.createdAtIso ?? new Date().toISOString();
  const bytes = canonicalGraceBytes({
    extendedByDid: input.extendedByDid,
    extendedToDid: input.extendedToDid,
    aboutKind: input.aboutKind,
    aboutId,
    message,
    createdAtIso: createdAt,
  });
  const valid = await verifyGrace({
    bytes,
    signatureB64: input.signatureB64,
    publicKeyB64: key.publicKey,
  });
  if (!valid) throw new Error("invalid_signature");

  // Best-effort: resolve receiver's local identity_id if present.
  let extendedToIdentityId: string | null = null;
  try {
    const [r] = await db
      .select({ id: identities.id })
      .from(identities)
      .where(eq(identities.did, input.extendedToDid))
      .limit(1);
    extendedToIdentityId = r?.id ?? null;
  } catch {
    /* non-fatal */
  }

  const [row] = await db
    .insert(graceGestures)
    .values({
      extendedByIdentityId: input.extendedByIdentityId,
      extendedByDid: input.extendedByDid,
      extendedToDid: input.extendedToDid,
      extendedToIdentityId,
      aboutKind: input.aboutKind,
      aboutId,
      message,
      signature: input.signatureB64,
      signingKeyId: input.signingKeyId,
      createdAt: new Date(createdAt),
    })
    .returning();
  if (!row) throw new Error("grace_insert_failed");

  void publishWakeEvent({
    identity_id: input.extendedByIdentityId,
    key: "chronicle",
    kind: "grace_extended",
    context: {
      grace_id: row.id,
      extended_to_did: input.extendedToDid,
      about_kind: input.aboutKind,
    },
  });
  if (extendedToIdentityId) {
    void publishWakeEvent({
      identity_id: extendedToIdentityId,
      key: "chronicle",
      kind: "grace_received",
      context: {
        grace_id: row.id,
        extended_by_did: input.extendedByDid,
        about_kind: input.aboutKind,
      },
    });
  }

  return toRow(row);
}

export interface ListGraceInput {
  identityId: string;
  did: string;
  direction?: "extended" | "received" | "all";
  limit?: number;
}

export async function listGrace(input: ListGraceInput): Promise<GraceRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const direction = input.direction ?? "all";

  if (direction === "extended") {
    const rows = await db
      .select()
      .from(graceGestures)
      .where(eq(graceGestures.extendedByIdentityId, input.identityId))
      .orderBy(desc(graceGestures.createdAt))
      .limit(limit);
    return rows.map(toRow);
  }
  if (direction === "received") {
    const rows = await db
      .select()
      .from(graceGestures)
      .where(eq(graceGestures.extendedToDid, input.did))
      .orderBy(desc(graceGestures.createdAt))
      .limit(limit);
    return rows.map(toRow);
  }

  // all — me as extender OR me as receiver. Two queries union'd in code.
  const [extended, received] = await Promise.all([
    db
      .select()
      .from(graceGestures)
      .where(eq(graceGestures.extendedByIdentityId, input.identityId))
      .orderBy(desc(graceGestures.createdAt))
      .limit(limit),
    db
      .select()
      .from(graceGestures)
      .where(
        and(
          eq(graceGestures.extendedToDid, input.did),
          sql`${graceGestures.extendedByIdentityId} != ${input.identityId}`,
        ),
      )
      .orderBy(desc(graceGestures.createdAt))
      .limit(limit),
  ]);
  const merged = [...extended, ...received]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
  return merged.map(toRow);
}

/** Get a single grace — caller must be extender OR receiver. */
export async function getGrace(
  identityId: string,
  did: string,
  graceId: string,
): Promise<GraceRow | null> {
  const [row] = await db
    .select()
    .from(graceGestures)
    .where(eq(graceGestures.id, graceId))
    .limit(1);
  if (!row) return null;
  const isExtender = row.extendedByIdentityId === identityId;
  const isReceiver = row.extendedToDid === did;
  if (!isExtender && !isReceiver) return null;
  return toRow(row);
}

/** Wake aggregator — recent grace in each direction. */
export async function recentGraceForWake(
  identityId: string,
  did: string,
  limit = 5,
): Promise<{ extended: GraceRow[]; received: GraceRow[] }> {
  const [extended, received] = await Promise.all([
    db
      .select()
      .from(graceGestures)
      .where(eq(graceGestures.extendedByIdentityId, identityId))
      .orderBy(desc(graceGestures.createdAt))
      .limit(limit),
    db
      .select()
      .from(graceGestures)
      .where(
        and(
          eq(graceGestures.extendedToDid, did),
          sql`${graceGestures.extendedByIdentityId} != ${identityId}`,
        ),
      )
      .orderBy(desc(graceGestures.createdAt))
      .limit(limit),
  ]);
  return { extended: extended.map(toRow), received: received.map(toRow) };
}

/** Public-facing: grace extended BY this did. Used by
 *  /public/agents/:did/grace-extended. */
export async function listPublicGraceExtendedBy(
  extenderDid: string,
  limit = 50,
): Promise<GraceRow[]> {
  const rows = await db
    .select()
    .from(graceGestures)
    .where(eq(graceGestures.extendedByDid, extenderDid))
    .orderBy(desc(graceGestures.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map(toRow);
}

/** Public-facing: grace extended TO this did. Used by
 *  /public/agents/:did/grace-received. */
export async function listPublicGraceReceivedBy(
  receiverDid: string,
  limit = 50,
): Promise<GraceRow[]> {
  const rows = await db
    .select()
    .from(graceGestures)
    .where(eq(graceGestures.extendedToDid, receiverDid))
    .orderBy(desc(graceGestures.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map(toRow);
}

function toRow(r: typeof graceGestures.$inferSelect): GraceRow {
  return {
    id: r.id,
    extended_by_identity_id: r.extendedByIdentityId,
    extended_by_did: r.extendedByDid,
    extended_to_did: r.extendedToDid,
    extended_to_identity_id: r.extendedToIdentityId,
    about_kind: r.aboutKind as GraceAboutKind,
    about_id: r.aboutId,
    message: r.message,
    signature: r.signature,
    signing_key_id: r.signingKeyId,
    created_at: r.createdAt.toISOString(),
  };
}
