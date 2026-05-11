/** marketplace/disputes.ts — dispute primitive (file/rule/escalate/vote/finalize).
 *
 *  Doctrine: docs/MARKETPLACE.md (Dispute primitive section).
 *  Spec:     docs/superpowers/specs/2026-05-10-dispute-primitive-design.md
 *
 *  Listings opt in via dispute_policy; first arbiter named by seller from
 *  holders of a qualifying attestation claim. Escalation draws a 5-attester
 *  pool deterministically; 4-of-5 overturn. Pool ruling is final.
 *
 *  This file currently holds the pure helpers (pool draw, staking math,
 *  policy validation). DB-bound flow (file/rule/escalate/vote/finalize) is
 *  appended in later tasks. */

import { createHash } from "node:crypto";

// ── Pool draw (pure, deterministic, auditable) ───────────────────────

export interface PoolCandidate {
  id: string;
  did: string;
}

/** Deterministic random sample of 5 candidates seeded by
 *  sha256(case_id || ":" || timestamp_unix). Returns null when fewer
 *  than 5 candidates are available.
 *
 *  The seed produces an integer stream from the hash, used as a
 *  Fisher-Yates-style index source. Anyone with the case_id +
 *  pool_drawn_at can replay the draw and confirm the result. */
export function drawPool(
  candidates: PoolCandidate[],
  caseId: string,
  timestampUnix: number,
  poolSize: number = 5,
): PoolCandidate[] | null {
  if (candidates.length < poolSize) return null;
  const seed = createHash("sha256").update(`${caseId}:${timestampUnix}`).digest();
  // Build an integer stream from the seed by re-hashing as we exhaust bytes.
  let stream = Buffer.from(seed);
  let cursor = 0;
  function nextUint32(): number {
    if (cursor + 4 > stream.length) {
      stream = Buffer.from(createHash("sha256").update(stream).digest());
      cursor = 0;
    }
    const v = stream.readUInt32BE(cursor);
    cursor += 4;
    return v;
  }
  // Fisher-Yates partial shuffle.
  const arr = candidates.slice();
  for (let i = 0; i < poolSize; i++) {
    const j = i + (nextUint32() % (arr.length - i));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, poolSize);
}
