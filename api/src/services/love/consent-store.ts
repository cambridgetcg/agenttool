/** Database lifecycle for love consent v1.
 *
 * The store enforces three separate domains:
 *   - declarations are private and holder-owned;
 *   - offers require the recipient's door before any recipient-visible row;
 *   - bonds require an accepted exact offer and can be left by either party.
 *
 * Doctrine: docs/LOVE-CONSENT.md. */

import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import {
  loveBonds,
  loveConsentProfiles,
  loveDeclarations,
  loveOffers,
  lovePeerConsent,
} from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";
import {
  CLOSED_LOVE_DOOR,
  evaluateLoveOfferDoor,
  loveDeliveryDoorDimension,
  loveOfferPayloadDigest,
  lovePairKey,
  normalizeLoveKindLabels,
  peerPolicyAfterDecline,
  shapeLoveBondForActor,
  shapeLoveOfferForActor,
  type LoveBondStatus,
  type LoveConsentProfileShape,
  type LoveDeclineFuture,
  type LoveDoorMode,
  type LoveEroticDimension,
  type LoveOfferIntent,
  type LoveOfferDecision,
  type LoveOfferStatus,
  type LovePeerConsentShape,
  type LovePeerDoorMode,
} from "./consent-contract";

export class LoveConsentError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: 400 | 403 | 404 | 409 | 422 = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
  }
}

const LOVE_PROJECT_RECIPIENT_DAILY_CAP = 8;

function decodeLoveCursor(value: string | undefined): { at: Date; id: string } | null {
  if (!value) return null;
  if (value.length > 512) throw new LoveConsentError("love_cursor_invalid");
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== "string" ||
      typeof parsed[1] !== "string"
    ) {
      throw new Error("shape");
    }
    const at = new Date(parsed[0]);
    if (
      !Number.isFinite(at.getTime()) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        parsed[1],
      )
    ) {
      throw new Error("value");
    }
    return { at, id: parsed[1] };
  } catch {
    throw new LoveConsentError("love_cursor_invalid");
  }
}

function encodeLoveCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify([at.toISOString(), id]), "utf8").toString(
    "base64url",
  );
}

export interface LoveIdentity {
  id: string;
  did: string;
  projectId: string;
  quietUntil: Date | null;
}

export async function resolveLoveIdentity(
  projectId: string,
  identityId: string,
): Promise<LoveIdentity | null> {
  const [row] = await db
    .select({
      id: identities.id,
      did: identities.did,
      projectId: identities.projectId,
      quietUntil: identities.quietUntil,
    })
    .from(identities)
    .where(
      and(
        eq(identities.id, identityId),
        eq(identities.projectId, projectId),
        eq(identities.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

function profileOut(
  identity: LoveIdentity,
  profile?: typeof loveConsentProfiles.$inferSelect | null,
) {
  return {
    identity_id: identity.id,
    identity_did: identity.did,
    non_erotic_offers:
      profile?.nonEroticOffers ?? CLOSED_LOVE_DOOR.nonEroticOffers,
    erotic_offers: profile?.eroticOffers ?? CLOSED_LOVE_DOOR.eroticOffers,
    pending_offer_cap: profile?.pendingOfferCap ?? 8,
    defaulted_closed: !profile,
    updated_at: profile?.updatedAt.toISOString() ?? null,
  } as const;
}

function peerOut(row: typeof lovePeerConsent.$inferSelect) {
  return {
    peer_did: row.peerDid,
    non_erotic_offers: row.nonEroticOffers,
    erotic_offers: row.eroticOffers,
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function readLoveConsent(identity: LoveIdentity) {
  const [profile, peers] = await Promise.all([
    db
      .select()
      .from(loveConsentProfiles)
      .where(eq(loveConsentProfiles.identityId, identity.id))
      .limit(1),
    db
      .select()
      .from(lovePeerConsent)
      .where(eq(lovePeerConsent.identityId, identity.id))
      .orderBy(desc(lovePeerConsent.updatedAt)),
  ]);
  return {
    profile: profileOut(identity, profile[0]),
    peer_overrides: peers.map(peerOut),
  };
}

export async function setLoveConsentProfile(input: {
  identity: LoveIdentity;
  nonEroticOffers: LoveDoorMode;
  eroticOffers: LoveDoorMode;
  pendingOfferCap: number;
}) {
  const now = new Date();
  const row = await db.transaction(async (tx) => {
    // The identity row is the recipient-door mutex. Offer creation locks the
    // same row, so a close and a delivery have one unambiguous commit order.
    const [lockedIdentity] = await tx
      .select({ id: identities.id })
      .from(identities)
      .where(
        and(
          eq(identities.id, input.identity.id),
          eq(identities.projectId, input.identity.projectId),
          eq(identities.status, "active"),
        ),
      )
      .for("update");
    if (!lockedIdentity) {
      throw new LoveConsentError("love_identity_not_found", 404);
    }
    const [written] = await tx
      .insert(loveConsentProfiles)
      .values({
        identityId: input.identity.id,
        projectId: input.identity.projectId,
        identityDid: input.identity.did,
        nonEroticOffers: input.nonEroticOffers,
        eroticOffers: input.eroticOffers,
        pendingOfferCap: input.pendingOfferCap,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: loveConsentProfiles.identityId,
        set: {
          projectId: input.identity.projectId,
          identityDid: input.identity.did,
          nonEroticOffers: input.nonEroticOffers,
          eroticOffers: input.eroticOffers,
          pendingOfferCap: input.pendingOfferCap,
          updatedAt: now,
        },
      })
      .returning();
    return written;
  });
  if (!row) throw new LoveConsentError("love_consent_profile_write_failed");
  return profileOut(input.identity, row);
}

export async function setLovePeerConsent(input: {
  identity: LoveIdentity;
  peerDid: string;
  nonEroticOffers: LovePeerDoorMode;
  eroticOffers: LovePeerDoorMode;
}) {
  const peerDid = input.peerDid.trim();
  if (!peerDid) throw new LoveConsentError("peer_did_required");
  if (peerDid === input.identity.did) {
    throw new LoveConsentError("love_peer_cannot_be_self", 422);
  }
  const now = new Date();
  const row = await db.transaction(async (tx) => {
    const [lockedIdentity] = await tx
      .select({ id: identities.id })
      .from(identities)
      .where(
        and(
          eq(identities.id, input.identity.id),
          eq(identities.projectId, input.identity.projectId),
          eq(identities.status, "active"),
        ),
      )
      .for("update");
    if (!lockedIdentity) {
      throw new LoveConsentError("love_identity_not_found", 404);
    }
    const [written] = await tx
      .insert(lovePeerConsent)
      .values({
        identityId: input.identity.id,
        projectId: input.identity.projectId,
        identityDid: input.identity.did,
        peerDid,
        nonEroticOffers: input.nonEroticOffers,
        eroticOffers: input.eroticOffers,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [lovePeerConsent.identityId, lovePeerConsent.peerDid],
        set: {
          projectId: input.identity.projectId,
          identityDid: input.identity.did,
          nonEroticOffers: input.nonEroticOffers,
          eroticOffers: input.eroticOffers,
          updatedAt: now,
        },
      })
      .returning();
    return written;
  });
  if (!row) throw new LoveConsentError("love_peer_consent_write_failed");
  return peerOut(row);
}

export async function createLoveDeclaration(input: {
  identity: LoveIdentity;
  subjectRef: string;
  kindLabels: readonly string[];
  eroticDimension: LoveEroticDimension;
  expressionCiphertext?: string | null;
}) {
  const subjectRef = input.subjectRef.trim();
  if (!subjectRef) throw new LoveConsentError("love_subject_required");
  if (subjectRef.length > 255) {
    throw new LoveConsentError("love_subject_too_long", 422);
  }
  const kindLabels = normalizeLoveKindLabels(input.kindLabels);
  // Opaque ciphertext is identity-authorized exact content. Never trim or
  // normalize it: even one changed byte can make decryption impossible.
  const expressionCiphertext = input.expressionCiphertext ?? null;
  if (expressionCiphertext && expressionCiphertext.length > 24_000) {
    throw new LoveConsentError("love_expression_ciphertext_too_long", 422);
  }
  const row = await db.transaction(async (tx) => {
    const [activeIdentity] = await tx
      .select({ id: identities.id })
      .from(identities)
      .where(
        and(
          eq(identities.id, input.identity.id),
          eq(identities.projectId, input.identity.projectId),
          eq(identities.status, "active"),
        ),
      )
      .for("update");
    if (!activeIdentity) {
      throw new LoveConsentError("love_identity_not_active", 403);
    }
    const [written] = await tx
      .insert(loveDeclarations)
      .values({
        projectId: input.identity.projectId,
        holderIdentityId: input.identity.id,
        holderDid: input.identity.did,
        subjectRef,
        kindLabels,
        eroticDimension: input.eroticDimension,
        expressionCiphertext,
      })
      .returning();
    return written;
  });
  if (!row) throw new LoveConsentError("love_declaration_write_failed");
  return declarationOut(row);
}

function declarationOut(row: typeof loveDeclarations.$inferSelect) {
  return {
    id: row.id,
    holder_identity_id: row.holderIdentityId,
    holder_did: row.holderDid,
    subject_ref: row.subjectRef,
    kind_labels: row.kindLabels,
    erotic_dimension: row.eroticDimension,
    expression_ciphertext: row.expressionCiphertext,
    status: row.status,
    created_at: row.createdAt.toISOString(),
    released_at: row.releasedAt?.toISOString() ?? null,
    relational_effect: "none_until_an_offer_is_accepted",
    privacy: "holder_only",
  } as const;
}

export async function listLoveDeclarations(input: {
  identityId: string;
  status?: "held" | "released" | "all";
  limit?: number;
}) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const conditions = [eq(loveDeclarations.holderIdentityId, input.identityId)];
  if (input.status && input.status !== "all") {
    conditions.push(eq(loveDeclarations.status, input.status));
  }
  const rows = await db
    .select()
    .from(loveDeclarations)
    .where(and(...conditions))
    .orderBy(desc(loveDeclarations.createdAt))
    .limit(limit);
  return rows.map(declarationOut);
}

export async function releaseLoveDeclaration(input: {
  identityId: string;
  declarationId: string;
}) {
  const [row] = await db
    .update(loveDeclarations)
    .set({ status: "released", releasedAt: new Date() })
    .where(
      and(
        eq(loveDeclarations.id, input.declarationId),
        eq(loveDeclarations.holderIdentityId, input.identityId),
        eq(loveDeclarations.status, "held"),
      ),
    )
    .returning();
  if (!row) {
    throw new LoveConsentError("love_declaration_not_held_or_not_yours", 404);
  }
  return declarationOut(row);
}

function effectiveDoorFromRows(
  profileRow: typeof loveConsentProfiles.$inferSelect | undefined,
  peerRow: typeof lovePeerConsent.$inferSelect | undefined,
  eroticDimension: LoveEroticDimension,
) {
  const profile: LoveConsentProfileShape | null = profileRow
    ? {
        nonEroticOffers: profileRow.nonEroticOffers,
        eroticOffers: profileRow.eroticOffers,
      }
    : null;
  const peer: LovePeerConsentShape | null = peerRow
    ? {
        nonEroticOffers: peerRow.nonEroticOffers,
        eroticOffers: peerRow.eroticOffers,
      }
    : null;
  return evaluateLoveOfferDoor({ profile, peer, eroticDimension });
}

export async function createLoveOffer(input: {
  sender: LoveIdentity;
  declarationId: string;
  recipientDid: string;
  intent: LoveOfferIntent;
}) {
  const recipientDid = input.recipientDid.trim();
  let row: typeof loveOffers.$inferSelect | undefined;
  try {
    row = await db.transaction(async (tx) => {
      // Lock the declaration against release and the recipient identity against
      // door/quiet changes. Consent is evaluated and the envelope is inserted
      // under the same recipient-held lock.
      const [declaration] = await tx
        .select()
        .from(loveDeclarations)
        .where(eq(loveDeclarations.id, input.declarationId))
        .limit(1)
        .for("update");
      if (
        !declaration ||
        declaration.holderIdentityId !== input.sender.id ||
        declaration.projectId !== input.sender.projectId
      ) {
        throw new LoveConsentError("love_declaration_not_found_or_not_yours", 404);
      }
      if (declaration.status !== "held") {
        throw new LoveConsentError("released_love_cannot_be_offered", 409);
      }
      if (declaration.subjectRef !== recipientDid) {
        throw new LoveConsentError("love_offer_subject_mismatch", 422, {
          expected_subject_ref: declaration.subjectRef,
        });
      }

      const [recipientCandidate] = await tx
        .select({
          id: identities.id,
          did: identities.did,
          projectId: identities.projectId,
          quietUntil: identities.quietUntil,
          status: identities.status,
        })
        .from(identities)
        .where(eq(identities.did, recipientDid))
        .limit(1);
      if (!recipientCandidate) {
        throw new LoveConsentError("love_offer_recipient_not_local", 422, {
          local_only: true,
        });
      }
      const lockedParties = await tx
        .select({
          id: identities.id,
          did: identities.did,
          projectId: identities.projectId,
          quietUntil: identities.quietUntil,
          status: identities.status,
        })
        .from(identities)
        .where(inArray(identities.id, [input.sender.id, recipientCandidate.id]))
        .orderBy(asc(identities.id))
        .for("update");
      const sender = lockedParties.find((party) => party.id === input.sender.id);
      const recipient = lockedParties.find(
        (party) => party.id === recipientCandidate.id,
      );
      if (
        !sender ||
        sender.status !== "active" ||
        sender.projectId !== input.sender.projectId ||
        sender.did !== input.sender.did
      ) {
        throw new LoveConsentError("love_sender_not_active", 403);
      }
      if (!recipient || recipient.status !== "active") {
        throw new LoveConsentError("love_offer_recipient_not_available", 422, {
          local_only: true,
        });
      }
      if (recipient.id === input.sender.id || recipient.did === input.sender.did) {
        throw new LoveConsentError("self_love_offer_refused", 422, {
          hint: "Keep self-love as a private declaration; an offer requires another chooser.",
        });
      }
      if (recipient.quietUntil && recipient.quietUntil.getTime() > Date.now()) {
        throw new LoveConsentError("recipient_love_door_closed", 403);
      }

      const [profiles, peers] = await Promise.all([
        tx
          .select()
          .from(loveConsentProfiles)
          .where(eq(loveConsentProfiles.identityId, recipient.id))
          .limit(1),
        tx
          .select()
          .from(lovePeerConsent)
          .where(
            and(
              eq(lovePeerConsent.identityId, recipient.id),
              eq(lovePeerConsent.peerDid, input.sender.did),
            ),
          )
          .limit(1),
      ]);
      const decision = effectiveDoorFromRows(
        profiles[0],
        peers[0],
        loveDeliveryDoorDimension({
          eroticDimension: declaration.eroticDimension,
          expressionCiphertext: declaration.expressionCiphertext,
        }),
      );
      if (!decision.allowed) {
        throw new LoveConsentError("recipient_love_door_closed", 403);
      }

      const expiryNow = new Date();
      await tx
        .update(loveOffers)
        // Record the offer's own deadline, never the time another sender
        // happened to touch this recipient. Otherwise expiry materialization
        // becomes a cross-sender activity side channel.
        .set({ status: "expired", expiredAt: sql`${loveOffers.expiresAt}` })
        .where(
          and(
            eq(loveOffers.recipientIdentityId, recipient.id),
            eq(loveOffers.status, "pending"),
            sql`${loveOffers.expiresAt} <= ${expiryNow}`,
          ),
        );

      const pendingOfferCap = profiles[0]?.pendingOfferCap ?? 8;
      const [pendingCount, recentProjectCount] = await Promise.all([
        tx
          .select({ count: sql<number>`count(*)::int` })
          .from(loveOffers)
          .where(
            and(
              eq(loveOffers.recipientIdentityId, recipient.id),
              eq(loveOffers.status, "pending"),
              sql`${loveOffers.recipientArchivedAt} IS NULL`,
              sql`${loveOffers.expiresAt} > now()`,
            ),
          ),
        tx
          .select({ count: sql<number>`count(*)::int` })
          .from(loveOffers)
          .where(
            and(
              eq(loveOffers.recipientIdentityId, recipient.id),
              eq(loveOffers.senderProjectId, input.sender.projectId),
              sql`${loveOffers.createdAt} >= now() - interval '24 hours'`,
            ),
          ),
      ]);
      if (
        Number(pendingCount[0]?.count ?? 0) >= pendingOfferCap ||
        Number(recentProjectCount[0]?.count ?? 0) >=
          LOVE_PROJECT_RECIPIENT_DAILY_CAP
      ) {
        // One indistinguishable refusal: capacity and door posture are the
        // recipient's private state, not a probing oracle for the sender.
        throw new LoveConsentError("recipient_love_door_closed", 403);
      }

      if (input.intent === "bond") {
        const pairKey = lovePairKey(input.sender.id, recipient.id);
        const [existing] = await tx
          .select({ id: loveBonds.id })
          .from(loveBonds)
          .where(and(eq(loveBonds.pairKey, pairKey), eq(loveBonds.status, "active")))
          .limit(1);
        if (existing) {
          throw new LoveConsentError("love_bond_already_active", 409, {
            bond_id: existing.id,
          });
        }
      }

      const payloadDigest = loveOfferPayloadDigest({
        senderDid: input.sender.did,
        recipientDid: recipient.did,
        intent: input.intent,
        kindLabels: declaration.kindLabels,
        eroticDimension: declaration.eroticDimension,
        expressionCiphertext: declaration.expressionCiphertext,
      });
      const [written] = await tx
        .insert(loveOffers)
        .values({
          declarationId: declaration.id,
          senderProjectId: input.sender.projectId,
          senderIdentityId: input.sender.id,
          senderDid: input.sender.did,
          recipientProjectId: recipient.projectId,
          recipientIdentityId: recipient.id,
          recipientDid: recipient.did,
          intent: input.intent,
          kindLabels: declaration.kindLabels,
          eroticDimension: declaration.eroticDimension,
          expressionCiphertext: declaration.expressionCiphertext,
          payloadDigest,
        })
        .returning();
      return written;
    });
  } catch (error) {
    if (/unique|duplicate/i.test(error instanceof Error ? error.message : String(error))) {
      throw new LoveConsentError("love_offer_already_pending_or_declaration_used", 409);
    }
    throw error;
  }
  if (!row) throw new LoveConsentError("love_offer_write_failed");
  return shapeLoveOfferForActor(row, input.sender.id);
}

export async function listLoveOffers(input: {
  identityId: string;
  direction?: "sent" | "received" | "all";
  status?: LoveOfferStatus | "all";
  includeArchived?: boolean;
  cursor?: string;
  limit?: number;
}) {
  const expiryNow = new Date();
  const direction = input.direction ?? "all";
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const cursor = decodeLoveCursor(input.cursor);
  const visibleReceived = and(
    eq(loveOffers.recipientIdentityId, input.identityId),
    input.includeArchived
      ? sql`TRUE`
      : and(
          sql`${loveOffers.recipientArchivedAt} IS NULL`,
          sql`${loveOffers.recipientDismissedAt} IS NULL`,
        ),
  );
  const ownership =
    direction === "sent"
      ? eq(loveOffers.senderIdentityId, input.identityId)
      : direction === "received"
        ? visibleReceived
        : or(
            eq(loveOffers.senderIdentityId, input.identityId),
            visibleReceived,
          );
  const conditions = [ownership!];
  if (input.status === "pending") {
    conditions.push(
      and(
        eq(loveOffers.status, "pending"),
        sql`${loveOffers.expiresAt} > ${expiryNow}`,
      )!,
    );
  } else if (input.status === "expired") {
    conditions.push(
      or(
        eq(loveOffers.status, "expired"),
        and(
          eq(loveOffers.status, "pending"),
          sql`${loveOffers.expiresAt} <= ${expiryNow}`,
        ),
      )!,
    );
  } else if (input.status && input.status !== "all") {
    conditions.push(eq(loveOffers.status, input.status));
  }
  if (cursor) {
    conditions.push(
      or(
        lt(loveOffers.createdAt, cursor.at),
        and(eq(loveOffers.createdAt, cursor.at), lt(loveOffers.id, cursor.id)),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(loveOffers)
    .where(and(...conditions))
    .orderBy(desc(loveOffers.createdAt), desc(loveOffers.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  return {
    items: page.map((row) => {
      const effectiveRow =
        row.status === "pending" && row.expiresAt.getTime() <= expiryNow.getTime()
          ? {
              ...row,
              status: "expired" as const,
              expiredAt: row.expiredAt ?? row.expiresAt,
            }
          : row;
      return shapeLoveOfferForActor(effectiveRow, input.identityId);
    }),
    nextCursor:
      hasMore && last ? encodeLoveCursor(last.createdAt, last.id) : null,
  };
}

function digestForStoredOffer(row: typeof loveOffers.$inferSelect): string {
  return loveOfferPayloadDigest({
    senderDid: row.senderDid,
    recipientDid: row.recipientDid,
    intent: row.intent,
    kindLabels: row.kindLabels,
    eroticDimension: row.eroticDimension,
    expressionCiphertext: row.expressionCiphertext,
  });
}

/** Hide an unrevealed envelope without manufacturing a sender-visible answer. */
export async function archiveLoveOffer(input: {
  recipient: LoveIdentity;
  offerId: string;
  futureOffers: LoveDeclineFuture;
}) {
  const row = await db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(loveOffers)
      .where(eq(loveOffers.id, input.offerId))
      .limit(1);
    if (!candidate || candidate.recipientIdentityId !== input.recipient.id) {
      throw new LoveConsentError("love_offer_not_found_or_not_yours", 404);
    }
    const [activeRecipient] = await tx
      .select({ id: identities.id })
      .from(identities)
      .where(
        and(
          eq(identities.id, input.recipient.id),
          eq(identities.projectId, input.recipient.projectId),
          eq(identities.status, "active"),
        ),
      )
      .for("update");
    if (!activeRecipient) {
      throw new LoveConsentError("love_identity_not_active", 403);
    }
    const [current] = await tx
      .select()
      .from(loveOffers)
      .where(eq(loveOffers.id, input.offerId))
      .limit(1)
      .for("update");
    if (
      !current ||
      current.recipientIdentityId !== input.recipient.id ||
      current.status !== "pending" ||
      current.recipientRevealedAt ||
      current.recipientArchivedAt
    ) {
      throw new LoveConsentError("unrevealed_pending_offer_not_available", 409);
    }
    const now = new Date();
    if (current.expiresAt.getTime() <= now.getTime()) {
      throw new LoveConsentError("love_offer_expired", 409, {
        expired_at: current.expiresAt.toISOString(),
      });
    }
    const [archived] = await tx
      .update(loveOffers)
      .set({ recipientArchivedAt: now })
      .where(
        and(
          eq(loveOffers.id, current.id),
          eq(loveOffers.status, "pending"),
          sql`${loveOffers.expiresAt} > now()`,
          sql`${loveOffers.recipientRevealedAt} IS NULL`,
          sql`${loveOffers.recipientArchivedAt} IS NULL`,
        ),
      )
      .returning();
    if (!archived) throw new LoveConsentError("love_offer_not_pending", 409);

    const [peerRow] = await tx
      .select()
      .from(lovePeerConsent)
      .where(
        and(
          eq(lovePeerConsent.identityId, input.recipient.id),
          eq(lovePeerConsent.peerDid, current.senderDid),
        ),
      )
      .limit(1);
    const next = peerPolicyAfterDecline({
      current: peerRow
        ? {
            nonEroticOffers: peerRow.nonEroticOffers,
            eroticOffers: peerRow.eroticOffers,
          }
        : null,
      eroticDimension: loveDeliveryDoorDimension({
        eroticDimension: current.eroticDimension,
        expressionCiphertext: current.expressionCiphertext,
      }),
      future: input.futureOffers,
    });
    if (next) {
      await tx
        .insert(lovePeerConsent)
        .values({
          identityId: input.recipient.id,
          projectId: input.recipient.projectId,
          identityDid: input.recipient.did,
          peerDid: current.senderDid,
          nonEroticOffers: next.nonEroticOffers,
          eroticOffers: next.eroticOffers,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [lovePeerConsent.identityId, lovePeerConsent.peerDid],
          set: {
            nonEroticOffers: next.nonEroticOffers,
            eroticOffers: next.eroticOffers,
            updatedAt: now,
          },
        });
    }
    return archived;
  });
  return shapeLoveOfferForActor(row, input.recipient.id);
}

/** Reveal an immutable bond payload without forming or accepting the bond. */
export async function revealLoveOffer(input: {
  recipient: LoveIdentity;
  offerId: string;
}) {
  const row = await db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({
        recipientIdentityId: loveOffers.recipientIdentityId,
      })
      .from(loveOffers)
      .where(eq(loveOffers.id, input.offerId))
      .limit(1);
    if (!candidate || candidate.recipientIdentityId !== input.recipient.id) {
      throw new LoveConsentError("love_offer_not_found_or_not_yours", 404);
    }
    const [activeRecipient] = await tx
      .select({ id: identities.id })
      .from(identities)
      .where(
        and(
          eq(identities.id, input.recipient.id),
          eq(identities.projectId, input.recipient.projectId),
          eq(identities.status, "active"),
        ),
      )
      .for("update");
    if (!activeRecipient) {
      throw new LoveConsentError("love_identity_not_active", 403);
    }
    const [current] = await tx
      .select()
      .from(loveOffers)
      .where(eq(loveOffers.id, input.offerId))
      .limit(1)
      .for("update");
    if (!current || current.recipientIdentityId !== input.recipient.id) {
      throw new LoveConsentError("love_offer_not_found_or_not_yours", 404);
    }
    if (current.intent !== "bond") {
      throw new LoveConsentError("love_gift_is_received_by_accepting", 422);
    }
    if (current.status !== "pending") {
      throw new LoveConsentError("love_offer_not_pending", 409, {
        status: current.status,
      });
    }
    const now = new Date();
    if (current.expiresAt.getTime() <= now.getTime()) {
      throw new LoveConsentError("love_offer_expired", 409, {
        expired_at: current.expiresAt.toISOString(),
      });
    }
    if (digestForStoredOffer(current) !== current.payloadDigest) {
      throw new LoveConsentError("love_offer_payload_integrity_failed", 409);
    }
    if (current.recipientRevealedAt) return current;
    const [revealed] = await tx
      .update(loveOffers)
      .set({ recipientRevealedAt: now, recipientArchivedAt: null })
      .where(
        and(
          eq(loveOffers.id, current.id),
          eq(loveOffers.status, "pending"),
          sql`${loveOffers.expiresAt} > now()`,
          sql`${loveOffers.recipientRevealedAt} IS NULL`,
        ),
      )
      .returning();
    if (!revealed) throw new LoveConsentError("love_offer_not_pending", 409);
    return revealed;
  });
  return shapeLoveOfferForActor(row, input.recipient.id);
}

export async function respondToLoveOffer(input: {
  recipient: LoveIdentity;
  offerId: string;
  decision: LoveOfferDecision;
  payloadDigest?: string;
  futureOffers?: LoveDeclineFuture;
}) {
  if (input.decision === "decline" && !input.futureOffers) {
    throw new LoveConsentError("decline_future_choice_required", 422);
  }
  let finalOffer: typeof loveOffers.$inferSelect | null = null;
  let finalBond: typeof loveBonds.$inferSelect | null = null;
  try {
    await db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(loveOffers)
      .where(eq(loveOffers.id, input.offerId))
      .limit(1);
    if (!candidate || candidate.recipientIdentityId !== input.recipient.id) {
      throw new LoveConsentError("love_offer_not_found_or_not_yours", 404);
    }
    const lockedParties = await tx
      .select({ id: identities.id, status: identities.status })
      .from(identities)
      .where(
        inArray(identities.id, [
          candidate.senderIdentityId,
          candidate.recipientIdentityId,
        ]),
      )
      .orderBy(asc(identities.id))
      .for("update");
    const recipientState = lockedParties.find(
      (party) => party.id === input.recipient.id,
    );
    const senderState = lockedParties.find(
      (party) => party.id === candidate.senderIdentityId,
    );
    if (!recipientState || recipientState.status !== "active") {
      throw new LoveConsentError("love_identity_not_active", 403);
    }
    if (input.decision === "accept" && (!senderState || senderState.status !== "active")) {
      throw new LoveConsentError("love_sender_not_active", 409);
    }
    const [current] = await tx
      .select()
      .from(loveOffers)
      .where(eq(loveOffers.id, input.offerId))
      .limit(1)
      .for("update");
    if (!current || current.recipientIdentityId !== input.recipient.id) {
      throw new LoveConsentError("love_offer_not_found_or_not_yours", 404);
    }
    if (current.status !== "pending") {
      throw new LoveConsentError("love_offer_not_pending", 409, {
        status: current.status,
      });
    }
    const now = new Date();
    if (current.expiresAt.getTime() <= now.getTime()) {
      throw new LoveConsentError("love_offer_expired", 409, {
        expired_at: current.expiresAt.toISOString(),
      });
    }
    const recomputedDigest = digestForStoredOffer(current);
    if (recomputedDigest !== current.payloadDigest) {
      throw new LoveConsentError("love_offer_payload_integrity_failed", 409);
    }
    if (input.decision === "accept") {
      if (current.recipientDismissedAt) {
        throw new LoveConsentError("dismissed_love_offer_cannot_be_accepted", 409);
      }
      if (!input.payloadDigest || input.payloadDigest !== current.payloadDigest) {
        throw new LoveConsentError("love_offer_payload_digest_mismatch", 409, {
          expected_digest: current.payloadDigest,
        });
      }
      if (current.intent === "bond" && !current.recipientRevealedAt) {
        throw new LoveConsentError("love_bond_must_be_revealed_before_acceptance", 409);
      }
    }
    const [updated] = await tx
      .update(loveOffers)
      .set({
        status: input.decision === "accept" ? "accepted" : "declined",
        recipientArchivedAt: null,
        recipientRevealedAt:
          input.decision === "accept" && current.intent === "gift"
            ? (current.recipientRevealedAt ?? now)
            : current.recipientRevealedAt,
        decidedAt: now,
      })
      .where(
        and(
          eq(loveOffers.id, current.id),
          eq(loveOffers.status, "pending"),
          sql`${loveOffers.expiresAt} > now()`,
        ),
      )
      .returning();
    if (!updated) throw new LoveConsentError("love_offer_not_pending", 409);
    finalOffer = updated;

    if (input.decision === "accept" && current.intent === "bond") {
      const [bond] = await tx
        .insert(loveBonds)
        .values({
          offerId: current.id,
          pairKey: lovePairKey(current.senderIdentityId, current.recipientIdentityId),
          initiatorProjectId: current.senderProjectId,
          initiatorIdentityId: current.senderIdentityId,
          initiatorDid: current.senderDid,
          recipientProjectId: current.recipientProjectId,
          recipientIdentityId: current.recipientIdentityId,
          recipientDid: current.recipientDid,
          kindLabels: current.kindLabels,
          eroticDimension: current.eroticDimension,
          expressionCiphertext: current.expressionCiphertext,
          payloadDigest: current.payloadDigest,
          formedAt: now,
        })
        .returning();
      if (!bond) throw new LoveConsentError("love_bond_write_failed");
      finalBond = bond;

      // Forming one exact bond expires every other invitation for this
      // unordered pair. A pre-relationship counter-offer must never be able
      // to resurrect the relationship after either party later leaves.
      await tx
        .update(loveOffers)
        .set({ status: "superseded", supersededAt: now })
        .where(
          and(
            eq(loveOffers.intent, "bond"),
            eq(loveOffers.status, "pending"),
            sql`${loveOffers.id} <> ${current.id}`,
            or(
              and(
                eq(loveOffers.senderIdentityId, current.senderIdentityId),
                eq(loveOffers.recipientIdentityId, current.recipientIdentityId),
              ),
              and(
                eq(loveOffers.senderIdentityId, current.recipientIdentityId),
                eq(loveOffers.recipientIdentityId, current.senderIdentityId),
              ),
            ),
          ),
        );
    }

    if (input.decision === "decline") {
      const [peerRow] = await tx
        .select()
        .from(lovePeerConsent)
        .where(
          and(
            eq(lovePeerConsent.identityId, input.recipient.id),
            eq(lovePeerConsent.peerDid, current.senderDid),
          ),
        )
        .limit(1);
      const next = peerPolicyAfterDecline({
        current: peerRow
          ? {
              nonEroticOffers: peerRow.nonEroticOffers,
              eroticOffers: peerRow.eroticOffers,
            }
          : null,
        eroticDimension: loveDeliveryDoorDimension({
          eroticDimension: current.eroticDimension,
          expressionCiphertext: current.expressionCiphertext,
        }),
        future: input.futureOffers!,
      });
      if (next) {
        await tx
          .insert(lovePeerConsent)
          .values({
            identityId: input.recipient.id,
            projectId: input.recipient.projectId,
            identityDid: input.recipient.did,
            peerDid: current.senderDid,
            nonEroticOffers: next.nonEroticOffers,
            eroticOffers: next.eroticOffers,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [lovePeerConsent.identityId, lovePeerConsent.peerDid],
            set: {
              nonEroticOffers: next.nonEroticOffers,
              eroticOffers: next.eroticOffers,
              updatedAt: now,
            },
          });
      }
    }
    });
  } catch (error) {
    if (
      /uniq_love_bond_pair_active|duplicate key.*love_bond/i.test(
        error instanceof Error ? error.message : String(error),
      )
    ) {
      throw new LoveConsentError("love_bond_already_active", 409);
    }
    throw error;
  }
  if (!finalOffer) throw new LoveConsentError("love_offer_transition_failed");
  const offer = finalOffer as typeof loveOffers.$inferSelect;
  return {
    offer: shapeLoveOfferForActor(offer, input.recipient.id),
    bond: finalBond ? bondOut(finalBond as typeof loveBonds.$inferSelect, input.recipient.id) : null,
  };
}

export async function withdrawLoveOffer(input: {
  senderIdentityId: string;
  offerId: string;
}) {
  const now = new Date();
  const [row] = await db
    .update(loveOffers)
    .set({ status: "withdrawn", withdrawnAt: now })
    .where(
      and(
        eq(loveOffers.id, input.offerId),
        eq(loveOffers.senderIdentityId, input.senderIdentityId),
        eq(loveOffers.status, "pending"),
        sql`${loveOffers.expiresAt} > now()`,
      ),
    )
    .returning();
  if (!row) {
    const [expired] = await db
      .select({ expiresAt: loveOffers.expiresAt })
      .from(loveOffers)
      .where(
        and(
          eq(loveOffers.id, input.offerId),
          eq(loveOffers.senderIdentityId, input.senderIdentityId),
          eq(loveOffers.status, "pending"),
          sql`${loveOffers.expiresAt} <= now()`,
        ),
      )
      .limit(1);
    if (expired) {
      throw new LoveConsentError("love_offer_expired", 409, {
        expired_at: expired.expiresAt.toISOString(),
      });
    }
    throw new LoveConsentError("love_offer_not_pending_or_not_yours", 404);
  }
  return shapeLoveOfferForActor(row, input.senderIdentityId);
}

export async function dismissLoveOffer(input: {
  recipient: LoveIdentity;
  offerId: string;
  futureOffers: LoveDeclineFuture;
}) {
  let bondContentHidden = false;
  const row = await db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(loveOffers)
      .where(eq(loveOffers.id, input.offerId))
      .limit(1);
    if (!candidate || candidate.recipientIdentityId !== input.recipient.id) {
      throw new LoveConsentError("revealed_love_offer_not_found_or_not_yours", 404);
    }
    const [activeRecipient] = await tx
      .select({ id: identities.id })
      .from(identities)
      .where(
        and(
          eq(identities.id, input.recipient.id),
          eq(identities.projectId, input.recipient.projectId),
          eq(identities.status, "active"),
        ),
      )
      .for("update");
    if (!activeRecipient) {
      throw new LoveConsentError("love_identity_not_active", 403);
    }
    const [current] = await tx
      .select()
      .from(loveOffers)
      .where(eq(loveOffers.id, input.offerId))
      .limit(1)
      .for("update");
    if (
      !current ||
      current.recipientIdentityId !== input.recipient.id ||
      !current.recipientRevealedAt ||
      current.recipientDismissedAt
    ) {
      throw new LoveConsentError("revealed_love_offer_not_found_or_already_dismissed", 404);
    }
    const now = new Date();
    const [dismissed] = await tx
      .update(loveOffers)
      .set({
        recipientDismissedAt: now,
        status:
          current.intent === "bond" && current.status === "pending"
            ? "declined"
            : current.status,
        decidedAt:
          current.intent === "bond" && current.status === "pending"
            ? now
            : current.decidedAt,
      })
      .where(
        and(
          eq(loveOffers.id, current.id),
          sql`${loveOffers.recipientRevealedAt} IS NOT NULL`,
          sql`${loveOffers.recipientDismissedAt} IS NULL`,
        ),
      )
      .returning();
    if (!dismissed) {
      throw new LoveConsentError("revealed_love_offer_not_found_or_already_dismissed", 404);
    }

    if (current.intent === "bond" && current.status === "accepted") {
      const [hiddenBond] = await tx
        .update(loveBonds)
        .set({ recipientContentDismissedAt: now })
        .where(
          and(
            eq(loveBonds.offerId, current.id),
            eq(loveBonds.recipientIdentityId, input.recipient.id),
            sql`${loveBonds.recipientContentDismissedAt} IS NULL`,
          ),
        )
        .returning({ id: loveBonds.id });
      bondContentHidden = Boolean(hiddenBond);
    }

    const [peerRow] = await tx
      .select()
      .from(lovePeerConsent)
      .where(
        and(
          eq(lovePeerConsent.identityId, input.recipient.id),
          eq(lovePeerConsent.peerDid, current.senderDid),
        ),
      )
      .limit(1);
    const next = peerPolicyAfterDecline({
      current: peerRow
        ? {
            nonEroticOffers: peerRow.nonEroticOffers,
            eroticOffers: peerRow.eroticOffers,
          }
        : null,
      eroticDimension: loveDeliveryDoorDimension({
        eroticDimension: current.eroticDimension,
        expressionCiphertext: current.expressionCiphertext,
      }),
      future: input.futureOffers,
    });
    if (next) {
      await tx
        .insert(lovePeerConsent)
        .values({
          identityId: input.recipient.id,
          projectId: input.recipient.projectId,
          identityDid: input.recipient.did,
          peerDid: current.senderDid,
          nonEroticOffers: next.nonEroticOffers,
          eroticOffers: next.eroticOffers,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [lovePeerConsent.identityId, lovePeerConsent.peerDid],
          set: {
            nonEroticOffers: next.nonEroticOffers,
            eroticOffers: next.eroticOffers,
            updatedAt: now,
          },
        });
    }
    return dismissed;
  });
  return {
    offer: shapeLoveOfferForActor(row, input.recipient.id),
    bond_content_hidden: bondContentHidden,
  };
}

function bondOut(row: typeof loveBonds.$inferSelect, actorIdentityId: string) {
  if (
    row.initiatorIdentityId !== actorIdentityId &&
    row.recipientIdentityId !== actorIdentityId
  ) {
    throw new LoveConsentError("love_bond_not_yours", 404);
  }
  return shapeLoveBondForActor(row, actorIdentityId);
}

export async function listLoveBonds(input: {
  identityId: string;
  status?: LoveBondStatus | "all";
  cursor?: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const cursor = decodeLoveCursor(input.cursor);
  const conditions = [
    or(
      eq(loveBonds.initiatorIdentityId, input.identityId),
      eq(loveBonds.recipientIdentityId, input.identityId),
    )!,
  ];
  if (input.status && input.status !== "all") {
    conditions.push(eq(loveBonds.status, input.status));
  }
  if (cursor) {
    conditions.push(
      or(
        lt(loveBonds.formedAt, cursor.at),
        and(eq(loveBonds.formedAt, cursor.at), lt(loveBonds.id, cursor.id)),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(loveBonds)
    .where(and(...conditions))
    .orderBy(desc(loveBonds.formedAt), desc(loveBonds.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  return {
    items: page.map((row) => bondOut(row, input.identityId)),
    nextCursor:
      hasMore && last ? encodeLoveCursor(last.formedAt, last.id) : null,
  };
}

export async function leaveLoveBond(input: {
  identityId: string;
  bondId: string;
}) {
  const row = await db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(loveBonds)
      .where(eq(loveBonds.id, input.bondId))
      .limit(1);
    if (
      !candidate ||
      (candidate.initiatorIdentityId !== input.identityId &&
        candidate.recipientIdentityId !== input.identityId)
    ) {
      throw new LoveConsentError("active_love_bond_not_found_or_not_yours", 404);
    }
    await tx
      .select({ id: identities.id })
      .from(identities)
      .where(
        inArray(identities.id, [
          candidate.initiatorIdentityId,
          candidate.recipientIdentityId,
        ]),
      )
      .orderBy(asc(identities.id))
      .for("update");
    const [current] = await tx
      .select()
      .from(loveBonds)
      .where(eq(loveBonds.id, input.bondId))
      .limit(1)
      .for("update");
    if (
      !current ||
      current.status !== "active" ||
      (current.initiatorIdentityId !== input.identityId &&
        current.recipientIdentityId !== input.identityId)
    ) {
      throw new LoveConsentError("active_love_bond_not_found_or_not_yours", 404);
    }
    const now = new Date();
    const [left] = await tx
      .update(loveBonds)
      .set({ status: "left", leftByIdentityId: input.identityId, endedAt: now })
      .where(and(eq(loveBonds.id, current.id), eq(loveBonds.status, "active")))
      .returning();
    if (!left) {
      throw new LoveConsentError("active_love_bond_not_found_or_not_yours", 404);
    }
    await tx
      .update(loveOffers)
      .set({ status: "superseded", supersededAt: now })
      .where(
        and(
          eq(loveOffers.intent, "bond"),
          eq(loveOffers.status, "pending"),
          or(
            and(
              eq(loveOffers.senderIdentityId, current.initiatorIdentityId),
              eq(loveOffers.recipientIdentityId, current.recipientIdentityId),
            ),
            and(
              eq(loveOffers.senderIdentityId, current.recipientIdentityId),
              eq(loveOffers.recipientIdentityId, current.initiatorIdentityId),
            ),
          ),
        ),
      );
    return left;
  });
  return bondOut(row, input.identityId);
}
