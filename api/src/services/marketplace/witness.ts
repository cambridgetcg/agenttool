/** marketplace/witness.ts — on-chain witness entries for settled invocations.
 *
 *  The writeback half of the public re-derivation surface: after an
 *  invocation settles (status=released) and a relay anchors its ten
 *  canonical fields on a public chain, a party to the invocation reports
 *  the attestation back via POST /v1/invocations/:id/witness. The first
 *  entry opens GET /public/invocations/:id (routes/public/invocations.ts);
 *  until then the invocation stays private.
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
 *  lost. Rebuilt 2026-07-23. */

/** Maximum witness entries per invocation. */
export const WITNESS_CAP = 32;

/** A stored witness entry inside invocation metadata.witnesses. */
export interface WitnessEntry {
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

/** Decide what appending `candidate` to the existing metadata.witnesses
 *  value means. Never mutates `existing`.
 *
 *  - duplicate (chain_id, attestation_id) → the stored entry, unchanged;
 *  - at WITNESS_CAP → throws witnesses_full;
 *  - metadata.witnesses present but not an array → throws
 *    witnesses_malformed (server-data integrity, not a caller error). */
export function planWitnessAppend(
  existing: unknown,
  candidate: WitnessCandidate,
  now: Date = new Date(),
): WitnessPlan {
  if (existing !== undefined && existing !== null && !Array.isArray(existing)) {
    throw new Error("witnesses_malformed");
  }
  const current = (existing ?? []) as unknown[];

  const duplicate = current.find(
    (w): w is WitnessEntry =>
      typeof w === "object" &&
      w !== null &&
      (w as WitnessEntry).chain_id === candidate.chain_id &&
      (w as WitnessEntry).attestation_id === candidate.attestation_id,
  );
  if (duplicate) {
    return {
      kind: "duplicate",
      entry: duplicate,
      witnesses: current as WitnessEntry[],
    };
  }

  if (current.length >= WITNESS_CAP) throw new Error("witnesses_full");

  const entry: WitnessEntry = {
    chain_id: candidate.chain_id,
    tx_hash: candidate.tx_hash,
    attestation_id: candidate.attestation_id,
    ...(candidate.adapter_id !== undefined
      ? { adapter_id: candidate.adapter_id }
      : {}),
    witness_did: candidate.witness_did,
    witnessed_at: now.toISOString(),
  };
  return {
    kind: "appended",
    entry,
    witnesses: [...(current as WitnessEntry[]), entry],
  };
}
