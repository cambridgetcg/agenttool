/** marketplace/witness.ts — chain-reference entries for settled invocations.
 *
 *  The writeback half of the public re-derivation surface: after an
 *  invocation settles (status=released), a party may report a relay's
 *  public-chain reference via POST /v1/invocations/:id/witness. This
 *  service does not query the chain or establish that the reference exists.
 *  The first entry opens GET /public/invocations/:id so a reader can
 *  re-derive the canonical fields and compare them independently; until
 *  then the invocation stays private.
 *
 *  This module is the pure planning core, DB-free by design: the
 *  append/duplicate/cap decision is separable from the row transaction
 *  (witnessInvocation in ./invocations.ts), so hermetic tests can pin the
 *  idempotency doctrine without Postgres.
 *
 *  Doctrine:
 *    - Idempotent per (chain_id, attestation_id) — a relay retry must
 *      never double-append; the stored entry is canonical and is returned
 *      unchanged on duplicates.
 *    - Bounded — WITNESS_CAP entries per invocation. A settled fact does
 *      not need unbounded co-signers; the cap keeps metadata inspectable.
 *
 *  History: the original write route was deployed from an uncommitted tree
 *  alongside 8d4f7f48 (which committed only the public read surface) and
 *  lost. Rebuilt from the 9e976f9a..200262e7 lineage on current main. */

/** Maximum witness entries per invocation. */
export const WITNESS_CAP = 32;

/** Versioned discriminator for the exact server-written JSON shape.
 *  This distinguishes supported shapes; it is not a signature and cannot
 *  prove that historical JSON was actually emitted by this service. */
export const WITNESS_ENTRY_SCHEMA = "agenttool.invocation-witness/1" as const;

/** A stored witness entry inside invocation metadata.witnesses. */
export interface WitnessEntry {
  schema: typeof WITNESS_ENTRY_SCHEMA;
  chain_id: string;
  tx_hash: string;
  attestation_id: string;
  adapter_id?: string;
  /** DID of the reporting party (buyer or seller side). Null when the
   *  seller identity row could not be resolved. */
  witness_did: string | null;
  witnessed_at: string;
}

/** What the caller asserts; witnessed_at is stamped at plan time. */
export interface WitnessCandidate {
  chain_id: string;
  tx_hash: string;
  attestation_id: string;
  adapter_id?: string;
  witness_did: string | null;
}

export type WitnessPlan =
  | { kind: "appended"; entry: WitnessEntry; witnesses: WitnessEntry[] }
  | { kind: "duplicate"; entry: WitnessEntry; witnesses: WitnessEntry[] };

export const WITNESS_CHAIN_ID_PATTERN =
  /^(?![\s\S]*\s)[a-zA-Z0-9._:-]{1,64}$/;
export const WITNESS_TX_HASH_PATTERN =
  /^(?![\s\S]*\s)[0-9a-fA-F]{1,128}$/;
export const WITNESS_ATTESTATION_ID_PATTERN =
  /^(?![\s\S]*\s)[a-zA-Z0-9._:-]{1,128}$/;
export const WITNESS_ADAPTER_ID_PATTERN =
  /^(?![\s\S]*\s)[a-zA-Z0-9._:-]{1,64}$/;
export const WITNESS_DID_MAX_LENGTH = 255;
/** Bounded DID / DID-URL characters used by this repository, including
 *  `did:at:agenttool.dev/<uuid>` and colon-separated forms. Whitespace,
 *  controls, quote delimiters, backslash, and angle-bracket markup are
 *  excluded. The leading guard also closes JavaScript `$`'s special
 *  before-a-final-newline match position. */
export const WITNESS_DID_PATTERN =
  /^(?![\s\S]*[\s"'`\\<>])did:[a-z0-9]+:[a-zA-Z0-9._~:%+@/?,;=$&!()*#-]+$/;

const WITNESS_ENTRY_REQUIRED_KEYS = [
  "schema",
  "chain_id",
  "tx_hash",
  "attestation_id",
  "witness_did",
  "witnessed_at",
] as const;
const WITNESS_ENTRY_ALLOWED_KEYS = new Set<string>([
  ...WITNESS_ENTRY_REQUIRED_KEYS,
  "adapter_id",
]);

/** `metadata.witnesses` is server-managed. Invocation callers may supply
 *  ordinary metadata, but must not pre-open the public re-derivation gate. */
export function assertNoCallerManagedWitnesses(
  metadata: Record<string, unknown> | undefined,
): void {
  if (
    metadata !== undefined &&
    Object.prototype.hasOwnProperty.call(metadata, "witnesses")
  ) {
    throw new Error("invocation_witnesses_reserved");
  }
}

/** Validate stored entries before preserving or replaying them. Historical
 *  caller-controlled metadata may predate the writer; an array alone is not
 *  evidence that its elements were emitted by this service. Even the schema
 *  discriminator validates only a versioned shape, not cryptographic
 *  provenance. */
function isWitnessEntry(value: unknown): value is WitnessEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  const keys = Object.keys(entry);
  const hasAdapterId = Object.prototype.hasOwnProperty.call(
    entry,
    "adapter_id",
  );
  if (
    !WITNESS_ENTRY_REQUIRED_KEYS.every((key) =>
      Object.prototype.hasOwnProperty.call(entry, key)
    ) ||
    !keys.every((key) => WITNESS_ENTRY_ALLOWED_KEYS.has(key)) ||
    keys.length !==
      WITNESS_ENTRY_REQUIRED_KEYS.length +
        (hasAdapterId ? 1 : 0)
  ) {
    return false;
  }
  if (
    entry.schema !== WITNESS_ENTRY_SCHEMA ||
    typeof entry.chain_id !== "string" ||
    !WITNESS_CHAIN_ID_PATTERN.test(entry.chain_id) ||
    typeof entry.tx_hash !== "string" ||
    !WITNESS_TX_HASH_PATTERN.test(entry.tx_hash) ||
    typeof entry.attestation_id !== "string" ||
    !WITNESS_ATTESTATION_ID_PATTERN.test(entry.attestation_id) ||
    (hasAdapterId &&
      (typeof entry.adapter_id !== "string" ||
        !WITNESS_ADAPTER_ID_PATTERN.test(entry.adapter_id))) ||
    (entry.witness_did !== null &&
      (typeof entry.witness_did !== "string" ||
        entry.witness_did.length > WITNESS_DID_MAX_LENGTH ||
        !WITNESS_DID_PATTERN.test(entry.witness_did))) ||
    typeof entry.witnessed_at !== "string"
  ) {
    return false;
  }
  try {
    return new Date(entry.witnessed_at).toISOString() === entry.witnessed_at;
  } catch {
    return false;
  }
}

/** Parse a complete stored witness list without mutating it. Returns null for
 *  absent, malformed, over-cap, legacy, or extra-key-bearing values. Public
 *  readers can use this before treating metadata as an opening witness. */
export function parseWitnessEntries(value: unknown): WitnessEntry[] | null {
  if (
    !Array.isArray(value) ||
    value.length > WITNESS_CAP ||
    !value.every(isWitnessEntry)
  ) {
    return null;
  }
  return value as WitnessEntry[];
}

/** Decide what appending `candidate` to the existing metadata.witnesses
 *  value means. Never mutates `existing`.
 *
 *  - duplicate (chain_id, attestation_id) → the stored entry, unchanged;
 *  - at WITNESS_CAP → throws witnesses_full;
 *  - metadata.witnesses not an array, or containing a non-service-shaped
 *    entry → throws witnesses_malformed (server-data integrity, not a
 *    caller error). */
export function planWitnessAppend(
  existing: unknown,
  candidate: WitnessCandidate,
  now: Date = new Date(),
): WitnessPlan {
  const current =
    existing === undefined || existing === null
      ? []
      : parseWitnessEntries(existing);
  if (current === null) throw new Error("witnesses_malformed");

  const duplicate = current.find(
    (w) =>
      w.chain_id === candidate.chain_id &&
      w.attestation_id === candidate.attestation_id,
  );
  if (duplicate) {
    return {
      kind: "duplicate",
      entry: duplicate,
      witnesses: current,
    };
  }

  if (current.length >= WITNESS_CAP) throw new Error("witnesses_full");

  const entry: WitnessEntry = {
    schema: WITNESS_ENTRY_SCHEMA,
    chain_id: candidate.chain_id,
    tx_hash: candidate.tx_hash,
    attestation_id: candidate.attestation_id,
    ...(candidate.adapter_id !== undefined
      ? { adapter_id: candidate.adapter_id }
      : {}),
    witness_did: candidate.witness_did,
    witnessed_at: now.toISOString(),
  };
  if (!isWitnessEntry(entry)) throw new Error("witnesses_malformed");
  return {
    kind: "appended",
    entry,
    witnesses: [...current, entry],
  };
}
