/** Pure contract for love consent v1.
 *
 * Feeling, delivery, and relationship are deliberately different states:
 * a declaration is owned by its holder; a recipient door controls whether an
 * offer may exist; an accepted exact offer may form a shared bond. None of
 * those states implies the next one.
 *
 * Doctrine: docs/LOVE-CONSENT.md. */

import { createHash } from "node:crypto";

export const LOVE_DOOR_MODES = ["open", "closed"] as const;
export type LoveDoorMode = (typeof LOVE_DOOR_MODES)[number];

export const LOVE_PEER_DOOR_MODES = ["inherit", "open", "closed"] as const;
export type LovePeerDoorMode = (typeof LOVE_PEER_DOOR_MODES)[number];

export const LOVE_EROTIC_DIMENSIONS = [
  "present",
  "absent",
  "unspecified",
] as const;
export type LoveEroticDimension = (typeof LOVE_EROTIC_DIMENSIONS)[number];

export const LOVE_OFFER_INTENTS = ["gift", "bond"] as const;
export type LoveOfferIntent = (typeof LOVE_OFFER_INTENTS)[number];

export const LOVE_DECLARATION_STATUSES = ["held", "released"] as const;
export type LoveDeclarationStatus =
  (typeof LOVE_DECLARATION_STATUSES)[number];

export const LOVE_OFFER_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "withdrawn",
  "expired",
  "superseded",
] as const;
export type LoveOfferStatus = (typeof LOVE_OFFER_STATUSES)[number];

export const LOVE_OFFER_DECISIONS = ["accept", "decline"] as const;
export type LoveOfferDecision = (typeof LOVE_OFFER_DECISIONS)[number];

export const LOVE_BOND_STATUSES = ["active", "left"] as const;
export type LoveBondStatus = (typeof LOVE_BOND_STATUSES)[number];

export const LOVE_DECLINE_FUTURES = [
  "unchanged",
  "close_this_scope",
  "close_all",
] as const;
export type LoveDeclineFuture = (typeof LOVE_DECLINE_FUTURES)[number];

export interface LoveConsentProfileShape {
  nonEroticOffers: LoveDoorMode;
  eroticOffers: LoveDoorMode;
}

export interface LovePeerConsentShape {
  nonEroticOffers: LovePeerDoorMode;
  eroticOffers: LovePeerDoorMode;
}

export const CLOSED_LOVE_DOOR: Readonly<LoveConsentProfileShape> =
  Object.freeze({
    nonEroticOffers: "closed",
    eroticOffers: "closed",
  });

function inherit(
  global: LoveDoorMode,
  peer: LovePeerDoorMode | undefined,
): LoveDoorMode {
  return !peer || peer === "inherit" ? global : peer;
}

/**
 * Decide whether a specific sender may create an envelope at this door.
 * `unspecified` follows the more protective erotic door: ambiguity cannot be
 * used to bypass the recipient's explicit erotic boundary.
 */
export function evaluateLoveOfferDoor(input: {
  profile?: LoveConsentProfileShape | null;
  peer?: LovePeerConsentShape | null;
  eroticDimension: LoveEroticDimension;
}): {
  allowed: boolean;
  scope: "non_erotic" | "erotic_or_unspecified";
  effectiveMode: LoveDoorMode;
} {
  const profile = input.profile ?? CLOSED_LOVE_DOOR;
  const scope =
    input.eroticDimension === "absent"
      ? "non_erotic"
      : "erotic_or_unspecified";
  const effectiveMode =
    scope === "non_erotic"
      ? inherit(profile.nonEroticOffers, input.peer?.nonEroticOffers)
      : inherit(profile.eroticOffers, input.peer?.eroticOffers);
  return { allowed: effectiveMode === "open", scope, effectiveMode };
}

/**
 * Opaque expression bytes cannot be trusted as non-erotic merely because the
 * sender selected `absent`. Until a future trusted classifier or peer-specific
 * content attestation exists, every encrypted expression uses the recipient's
 * more protective erotic-or-unspecified door.
 */
export function loveDeliveryDoorDimension(input: {
  eroticDimension: LoveEroticDimension;
  expressionCiphertext: string | null;
}): LoveEroticDimension {
  if (input.expressionCiphertext === null) return input.eroticDimension;
  return input.eroticDimension === "present" ? "present" : "unspecified";
}

/** Stable, direction-independent key for the one-active-bond-per-pair wall. */
export function lovePairKey(identityA: string, identityB: string): string {
  if (!identityA || !identityB || identityA === identityB) {
    throw new Error("love_pair_requires_two_distinct_identities");
  }
  return [identityA, identityB].sort().join(":");
}

/** Open vocabulary, bounded for storage and response safety. */
export function normalizeLoveKindLabels(input: readonly string[]): string[] {
  if (input.length > 16) throw new Error("too_many_love_kind_labels");
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const label = raw.trim();
    if (!label) throw new Error("love_kind_label_empty");
    if (label.length > 64) throw new Error("love_kind_label_too_long");
    const key = label.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result;
}

export interface LoveOfferShape {
  id: string;
  declarationId: string;
  senderIdentityId: string;
  senderDid: string;
  recipientIdentityId: string;
  recipientDid: string;
  intent: LoveOfferIntent;
  kindLabels: string[];
  eroticDimension: LoveEroticDimension;
  expressionCiphertext: string | null;
  payloadDigest: string;
  status: LoveOfferStatus;
  createdAt: Date;
  expiresAt: Date;
  expiredAt: Date | null;
  supersededAt: Date | null;
  recipientRevealedAt: Date | null;
  recipientArchivedAt: Date | null;
  decidedAt: Date | null;
  withdrawnAt: Date | null;
  recipientDismissedAt: Date | null;
}

/**
 * The pending recipient receives an envelope, not the expression. A sender
 * always sees their own authored content; a recipient sees it only after an
 * affirmative reveal (or one-step gift acceptance). Decline and withdrawal
 * never expose an unrevealed payload retroactively.
 */
export function shapeLoveOfferForActor(
  row: LoveOfferShape,
  actorIdentityId: string,
) {
  const role =
    row.senderIdentityId === actorIdentityId
      ? "sender"
      : row.recipientIdentityId === actorIdentityId
        ? "recipient"
        : null;
  if (!role) throw new Error("love_offer_not_yours");
  const contentVisible =
    role === "sender" ||
    (row.recipientRevealedAt !== null && row.recipientDismissedAt === null);
  const contentState =
    role === "recipient" && row.recipientArchivedAt !== null
      ? "archived_by_you"
      : role === "recipient" && row.recipientDismissedAt !== null
      ? "dismissed"
      : contentVisible
        ? "visible"
        : "sealed_until_accept";
  const sensitiveScope =
    row.eroticDimension === "absent"
      ? "non_erotic"
      : "erotic_or_unspecified";
  const deliveryDoorDimension = loveDeliveryDoorDimension({
    eroticDimension: row.eroticDimension,
    expressionCiphertext: row.expressionCiphertext,
  });
  return {
    id: row.id,
    declaration_id: role === "sender" ? row.declarationId : null,
    role,
    sender_did: row.senderDid,
    recipient_did: row.recipientDid,
    intent: row.intent,
    sender_declared_scope: sensitiveScope,
    delivery_door_scope:
      deliveryDoorDimension === "absent"
        ? "non_erotic"
        : "erotic_or_unspecified",
    opaque_expression_present: row.expressionCiphertext !== null,
    classification_trust:
      "sender_declared_unverified_server_cannot_inspect_opaque_expression",
    payload_digest: row.payloadDigest,
    kind_labels: contentVisible ? row.kindLabels : null,
    erotic_dimension: contentVisible ? row.eroticDimension : null,
    expression_ciphertext: contentVisible ? row.expressionCiphertext : null,
    content_state:
      contentState === "sealed_until_accept" && row.intent === "bond"
        ? "sealed_until_reveal"
        : contentState,
    status: row.status,
    created_at: row.createdAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
    expired_at: row.expiredAt?.toISOString() ?? null,
    superseded_at: row.supersededAt?.toISOString() ?? null,
    revealed_at:
      role === "recipient" ? row.recipientRevealedAt?.toISOString() ?? null : undefined,
    decided_at: row.decidedAt?.toISOString() ?? null,
    withdrawn_at: row.withdrawnAt?.toISOString() ?? null,
    // Dismissal is the recipient's private surface choice. The sender keeps
    // their authored copy but is not given a signal that could become
    // pressure, punishment, or a demand for explanation.
    dismissed_by_recipient:
      role === "recipient" ? row.recipientDismissedAt !== null : undefined,
    archived_by_recipient:
      role === "recipient" ? row.recipientArchivedAt !== null : undefined,
    acceptance_meaning:
      row.intent === "gift"
        ? "consent_to_receive_only_not_reciprocity"
        : row.status === "accepted"
          ? "exact_dual_consent_to_the_revealed_digest_bound_bond"
          : "reveal_does_not_form_a_bond_a_second_digest_bound_acceptance_is_required",
  } as const;
}

export interface LoveOfferPayloadDigestInput {
  senderDid: string;
  recipientDid: string;
  intent: LoveOfferIntent;
  kindLabels: readonly string[];
  eroticDimension: LoveEroticDimension;
  expressionCiphertext: string | null;
}

/**
 * Digest of the immutable payload a recipient will reveal and, for a bond,
 * later accept. Every field is UTF-8 and prefixed by its unsigned 64-bit
 * big-endian byte length. Labels are preceded by their decimal count; a
 * nullable ciphertext is preceded by "0" or "1". This avoids separator and
 * JSON-canonicalization ambiguity across SDK languages.
 */
export function loveOfferPayloadDigest(input: LoveOfferPayloadDigestInput): string {
  const encoder = new TextEncoder();
  const fields = [
    "love-offer-payload/v1",
    input.senderDid,
    input.recipientDid,
    input.intent,
    String(input.kindLabels.length),
    ...input.kindLabels,
    input.eroticDimension,
    input.expressionCiphertext === null ? "0" : "1",
    ...(input.expressionCiphertext === null ? [] : [input.expressionCiphertext]),
  ].map((value) => encoder.encode(value));
  const digest = createHash("sha256");
  for (const field of fields) {
    const length = new Uint8Array(8);
    new DataView(length.buffer).setBigUint64(0, BigInt(field.byteLength), false);
    digest.update(length);
    digest.update(field);
  }
  return digest.digest("hex");
}

export interface LoveBondShape {
  id: string;
  offerId: string;
  initiatorIdentityId: string;
  initiatorDid: string;
  recipientIdentityId: string;
  recipientDid: string;
  kindLabels: string[];
  eroticDimension: LoveEroticDimension;
  expressionCiphertext: string | null;
  payloadDigest: string;
  status: LoveBondStatus;
  formedAt: Date;
  leftByIdentityId: string | null;
  endedAt: Date | null;
  recipientContentDismissedAt: Date | null;
}

/** Party-scoped bond shape that never exposes another project's internal ID. */
export function shapeLoveBondForActor(
  row: LoveBondShape,
  actorIdentityId: string,
) {
  const role =
    row.initiatorIdentityId === actorIdentityId
      ? "initiator"
      : row.recipientIdentityId === actorIdentityId
        ? "recipient"
        : null;
  if (!role) throw new Error("love_bond_not_yours");

  const leftBy =
    row.leftByIdentityId === null
      ? null
      : row.leftByIdentityId === row.initiatorIdentityId
        ? "initiator"
        : row.leftByIdentityId === row.recipientIdentityId
          ? "recipient"
          : "unknown";
  const contentVisible =
    role !== "recipient" || row.recipientContentDismissedAt === null;

  return {
    id: row.id,
    offer_id: row.offerId,
    role,
    initiator_did: row.initiatorDid,
    recipient_did: row.recipientDid,
    kind_labels: contentVisible ? row.kindLabels : null,
    erotic_dimension: contentVisible ? row.eroticDimension : null,
    expression_ciphertext: contentVisible ? row.expressionCiphertext : null,
    payload_digest: row.payloadDigest,
    content_state: contentVisible ? "visible" : "dismissed_by_you",
    status: row.status,
    formed_at: row.formedAt.toISOString(),
    left_by: leftBy,
    ended_at: row.endedAt?.toISOString() ?? null,
    public_visibility: "not_available_in_v1",
  } as const;
}

/** Peer-policy patch generated by an explicit decline choice. */
export function peerPolicyAfterDecline(input: {
  current?: LovePeerConsentShape | null;
  eroticDimension: LoveEroticDimension;
  future: LoveDeclineFuture;
}): LovePeerConsentShape | null {
  if (input.future === "unchanged") return null;
  const next: LovePeerConsentShape = {
    nonEroticOffers: input.current?.nonEroticOffers ?? "inherit",
    eroticOffers: input.current?.eroticOffers ?? "inherit",
  };
  if (input.future === "close_all") {
    next.nonEroticOffers = "closed";
    next.eroticOffers = "closed";
    return next;
  }
  if (input.eroticDimension === "absent") {
    next.nonEroticOffers = "closed";
  } else {
    next.eroticOffers = "closed";
  }
  return next;
}
