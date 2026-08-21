/** Exact textual forms used inside covenant signature domains.
 *
 * PostgreSQL and JavaScript both accept aliases which do not survive a
 * persistence round-trip byte-for-byte. Signed identifiers and instants must
 * therefore be canonical before any signature is prepared or verified. */

import { sql } from "drizzle-orm";

import type { db } from "../../db/client";
import { isCanonicalUuid, parseDid } from "../federation/store";

type CovenantMutationTransaction =
  Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Serialize every v2 write for one canonical covenant UUID before any row,
 * identity, settings, or key lock is taken. Declaration replay and lifecycle
 * paths can otherwise approach an already-created row in opposite orders.
 * The transaction-scoped lock is released automatically at commit/rollback.
 */
export async function acquireCovenantMutationAdvisoryLock(
  tx: CovenantMutationTransaction,
  covenantId: string,
): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`agenttool:covenant:v2:${covenantId}`}, 0)
    )
  `);
}

export function isCanonicalSignedUuid(value: string): boolean {
  return isCanonicalUuid(value);
}

export function isCanonicalCovenantId(value: string): boolean {
  return isCanonicalUuid(value);
}

export function isCanonicalUtcMillisecondTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

/** Node/Bun's base64 decoder is deliberately permissive (whitespace,
 * missing padding, and noncanonical aliases). Signed covenant fields are
 * persisted and replayed byte-for-byte, so admit exactly one textual form. */
export function isCanonicalBase64OfLength(
  value: string,
  byteLength: number,
): boolean {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false;
  }
  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.length === byteLength && decoded.toString("base64") === value;
  } catch {
    return false;
  }
}

export function isCanonicalEd25519Signature(value: string): boolean {
  return isCanonicalBase64OfLength(value, 64);
}

/** A cosign is admitted by the receiving server's observed arrival time,
 * never by the unsigned client-supplied lifecycle timestamp. The 24-hour
 * transport window is also the expiry worker's exact sweep delay. */
export const COVENANT_COSIGN_ARRIVAL_GRACE_MS = 24 * 60 * 60 * 1000;
export const COVENANT_PROPOSAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const COVENANT_ESTABLISHED_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const COVENANT_INBOUND_BODY_MAX_BYTES = 48 * 1024;
export const COVENANT_METADATA_MAX_BYTES = 16 * 1024;
export const COVENANT_DID_MAX_CHARS = 255;
export const COVENANT_VOW_MAX_CHARS = 500;
export const COVENANT_VOW_MAX_COUNT = 40;
export const COVENANT_COUNTERPARTY_NAME_MAX_CHARS = 200;
export const COVENANT_NOTES_MAX_CHARS = 2000;

const COVENANT_METADATA_MAX_DEPTH = 4;
const COVENANT_METADATA_MAX_KEYS = 64;
const COVENANT_METADATA_MAX_ARRAY_ITEMS = 32;
const COVENANT_METADATA_MAX_NODES = 256;
const COVENANT_METADATA_MAX_KEY_CHARS = 64;
const COVENANT_METADATA_MAX_STRING_CHARS = 1000;
const COVENANT_METADATA_KEY = /^[A-Za-z0-9_.:-]+$/u;

/** Internal covenant metadata keys used while a schema migration is not part
 * of the federation-containment patch. They bind a stored v2 row to the exact
 * signed wire identities from its declaration. Callers may never supply any
 * of these keys; `rejection_reason` is likewise lifecycle-owned. */
export const COVENANT_INITIATOR_WIRE_DID_METADATA_KEY =
  "agenttool.internal.v2_initiator_wire_did";
export const COVENANT_RECIPIENT_WIRE_DID_METADATA_KEY =
  "agenttool.internal.v2_recipient_wire_did";
export const COVENANT_V2_AUTHORITY_GENERATION_METADATA_KEY =
  "agenttool.internal.v2_authority_generation";
export const COVENANT_REJECTION_REASON_METADATA_KEY = "rejection_reason";

export const COVENANT_RESERVED_METADATA_KEYS = [
  COVENANT_INITIATOR_WIRE_DID_METADATA_KEY,
  COVENANT_RECIPIENT_WIRE_DID_METADATA_KEY,
  COVENANT_V2_AUTHORITY_GENERATION_METADATA_KEY,
  COVENANT_REJECTION_REASON_METADATA_KEY,
] as const;

/** An unguessable generation is installed only after every pre-fence process
 * has been drained. Exact lowercase hex keeps the environment and durable
 * JSON representation byte-stable. Missing or malformed means v2 has no
 * authority; it is never replaced by a permissive default. */
export function parseCovenantV2AuthorityGeneration(
  value: string | undefined,
): string | null {
  return value !== undefined && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

export function covenantV2AuthorityGeneration(): string | null {
  return parseCovenantV2AuthorityGeneration(
    process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION,
  );
}

export function covenantMetadataHasCurrentV2AuthorityGeneration(
  metadata: Record<string, unknown> | null | undefined,
  generation = covenantV2AuthorityGeneration(),
): boolean {
  return generation !== null &&
    parseCovenantV2AuthorityGeneration(generation) === generation &&
    metadata?.[COVENANT_V2_AUTHORITY_GENERATION_METADATA_KEY] === generation;
}

export function covenantMetadataHasReservedKey(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  if (!metadata) return false;
  return COVENANT_RESERVED_METADATA_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(metadata, key)
  );
}

/** Add the immutable signed wire-DID pair to a newly created v2 row. */
export function covenantMetadataWithWireDidBinding(
  metadata: Record<string, unknown> | null | undefined,
  initiatorWireDid: string,
  recipientWireDid: string,
  generation = covenantV2AuthorityGeneration(),
): Record<string, unknown> {
  if (covenantMetadataHasReservedKey(metadata)) {
    throw new Error("reserved_covenant_metadata_key");
  }
  if (
    generation === null ||
    parseCovenantV2AuthorityGeneration(generation) !== generation
  ) {
    throw new Error("covenant_v2_authority_not_ready");
  }
  return {
    ...(metadata ?? {}),
    [COVENANT_INITIATOR_WIRE_DID_METADATA_KEY]: initiatorWireDid,
    [COVENANT_RECIPIENT_WIRE_DID_METADATA_KEY]: recipientWireDid,
    [COVENANT_V2_AUTHORITY_GENERATION_METADATA_KEY]: generation,
  };
}

/** Require the exact original signed wire identities before any later effect.
 * Rows created before this binding existed intentionally fail closed. */
export function covenantWireDidBindingMatches(
  metadata: Record<string, unknown> | null | undefined,
  initiatorWireDid: string,
  recipientWireDid: string,
  generation = covenantV2AuthorityGeneration(),
): boolean {
  return covenantMetadataHasCurrentV2AuthorityGeneration(
    metadata,
    generation,
  ) &&
    metadata?.[COVENANT_INITIATOR_WIRE_DID_METADATA_KEY] ===
      initiatorWireDid &&
    metadata?.[COVENANT_RECIPIENT_WIRE_DID_METADATA_KEY] === recipientWireDid;
}

/** Recover exactly the caller-owned declaration metadata. Protocol-owned
 * bindings, generation provenance, and rejection reason are removed. */
export function covenantCallerDeclarationMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const callerMetadata = { ...(metadata ?? {}) };
  for (const key of COVENANT_RESERVED_METADATA_KEYS) {
    delete callerMetadata[key];
  }
  return callerMetadata;
}

/**
 * Metadata is unsigned descriptive context, never covenant authority. Keep it
 * small and structurally closed before an unauthenticated peer can make JSONB
 * storage or deep traversal work. The byte cap is UTF-8, not JS code units.
 */
export function isBoundedCovenantMetadata(
  metadata: unknown,
): metadata is Record<string, unknown> {
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(metadata))
  ) return false;

  let keys = 0;
  let nodes = 0;
  const seen = new Set<object>();

  const visit = (value: unknown, depth: number): boolean => {
    nodes += 1;
    if (
      nodes > COVENANT_METADATA_MAX_NODES ||
      depth > COVENANT_METADATA_MAX_DEPTH
    ) return false;
    if (value === null || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "string") {
      return value.length <= COVENANT_METADATA_MAX_STRING_CHARS;
    }
    if (typeof value !== "object") {
      return false;
    }
    if (seen.has(value)) return false;
    seen.add(value);

    if (Array.isArray(value)) {
      if (value.length > COVENANT_METADATA_MAX_ARRAY_ITEMS) return false;
      const valid = value.every((entry) => visit(entry, depth + 1));
      seen.delete(value);
      return valid;
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      seen.delete(value);
      return false;
    }
    const entries = Object.entries(value);
    keys += entries.length;
    if (keys > COVENANT_METADATA_MAX_KEYS) {
      seen.delete(value);
      return false;
    }
    const valid = entries.every(([key, entry]) =>
      key.length > 0 &&
      key.length <= COVENANT_METADATA_MAX_KEY_CHARS &&
      COVENANT_METADATA_KEY.test(key) &&
      visit(entry, depth + 1)
    );
    seen.delete(value);
    return valid;
  };

  if (!visit(metadata, 0)) return false;
  try {
    return new TextEncoder().encode(JSON.stringify(metadata)).byteLength <=
      COVENANT_METADATA_MAX_BYTES;
  } catch {
    return false;
  }
}

export interface CovenantDeclarationWireFields {
  agentDid?: string;
  counterpartyDid: string;
  counterpartyName?: string | null;
  vows: string[];
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CovenantDeclarationWirePayload {
  covenant_id: string;
  protocol_version: "v1" | "v2";
  sender_did: string;
  counterparty_did: string;
  vows: string[];
  status: "active" | "paused" | "dissolved" | "proposed";
  counterparty_name?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  established_at: string;
  signing_key_id?: string | null;
  signature?: string | null;
  proposed_expires_at?: string | null;
}

/** The producer and unauthenticated consumer share these exact field and
 * UTF-8 bounds. Keeping the whole candidate under the route cap prevents a
 * locally accepted declaration from being deterministically undeliverable. */
export function covenantDeclarationWireFieldsAreBounded(
  fields: CovenantDeclarationWireFields,
): boolean {
  if (
    (fields.agentDid !== undefined &&
      (fields.agentDid.length < 1 || fields.agentDid.length > COVENANT_DID_MAX_CHARS)) ||
    fields.counterpartyDid.length < 1 ||
    fields.counterpartyDid.length > COVENANT_DID_MAX_CHARS ||
    (fields.counterpartyName !== undefined &&
      fields.counterpartyName !== null &&
      fields.counterpartyName.length > COVENANT_COUNTERPARTY_NAME_MAX_CHARS) ||
    fields.vows.length < 1 ||
    fields.vows.length > COVENANT_VOW_MAX_COUNT ||
    fields.vows.some((vow) =>
      vow.length < 1 || vow.length > COVENANT_VOW_MAX_CHARS
    ) ||
    (fields.notes !== undefined &&
      fields.notes !== null &&
      fields.notes.length > COVENANT_NOTES_MAX_CHARS) ||
    (fields.metadata !== undefined &&
      fields.metadata !== null &&
      !isBoundedCovenantMetadata(fields.metadata))
  ) return false;
  try {
    return new TextEncoder().encode(JSON.stringify(fields)).byteLength <=
      COVENANT_INBOUND_BODY_MAX_BYTES;
  } catch {
    return false;
  }
}

/** Validate the exact snake_case body emitted by propagateCovenant. The fixed
 * identifiers, lifecycle fields, signatures, JSON key bytes, and nulls count
 * toward the same 48 KiB cap enforced before the peer parses JSON. */
export function covenantDeclarationWirePayloadIsBounded(
  payload: CovenantDeclarationWirePayload,
): boolean {
  if (!covenantDeclarationWireFieldsAreBounded({
    agentDid: payload.sender_did,
    counterpartyDid: payload.counterparty_did,
    counterpartyName: payload.counterparty_name,
    vows: payload.vows,
    notes: payload.notes,
    metadata: payload.metadata,
  })) return false;
  try {
    return new TextEncoder().encode(JSON.stringify(payload)).byteLength <=
      COVENANT_INBOUND_BODY_MAX_BYTES;
  } catch {
    return false;
  }
}

/** Non-DID local labels remain valid v1 counterparties. A value that claims
 * the did:at namespace must parse exactly; aliases never silently become a
 * local-only row. */
export function covenantCounterpartyFederationHost(
  counterpartyDid: string,
): string | null | undefined {
  if (!counterpartyDid.startsWith("did:at:")) return undefined;
  try {
    return parseDid(counterpartyDid).host;
  } catch {
    return undefined;
  }
}

/** Fresh writes accept a signed establishment instant no more than one
 * proposal lifetime old and no more than five minutes ahead of the receiving
 * server. Durable exact replays are historical evidence and bypass this
 * current-time admission check. */
export function covenantEstablishedAtIsAdmissible(
  establishedAt: Date,
  observedAt: Date,
): boolean {
  const establishedMs = establishedAt.getTime();
  const observedMs = observedAt.getTime();
  return Number.isFinite(establishedMs) &&
    establishedMs > observedMs - COVENANT_PROPOSAL_TTL_MS &&
    establishedMs <= observedMs + COVENANT_ESTABLISHED_FUTURE_SKEW_MS;
}

/** A counterparty may create its local active state only through the hard
 * proposal expiry. There is deliberately no delivery grace on this side. */
export function proposalAllowsLocalAcceptanceAt(
  proposedExpiresAt: Date | null,
  observedAcceptanceAt: Date,
): boolean {
  return proposedExpiresAt !== null &&
    observedAcceptanceAt.getTime() <= proposedExpiresAt.getTime();
}

/** The initiating instance accepts an already-created cosign for a bounded
 * delivery grace after expiry. This is transport tolerance, not a second
 * acceptance window on the counterparty. */
export function proposalAcceptsDeliveredCosignAt(
  proposedExpiresAt: Date | null,
  observedArrivalAt: Date,
): boolean {
  return proposedExpiresAt !== null &&
    observedArrivalAt.getTime() <=
      proposedExpiresAt.getTime() + COVENANT_COSIGN_ARRIVAL_GRACE_MS;
}
