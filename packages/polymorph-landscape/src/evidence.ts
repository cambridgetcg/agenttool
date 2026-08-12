import { REPORTED_CLAIM_EVIDENCE_STATUSES } from "./constants.js";
import type { EvidenceWitness } from "./types.js";

export function hasReportedOrMeasuredPrimary(
  witnesses: readonly Pick<EvidenceWitness, "status">[],
): boolean {
  return witnesses.some((witness) => (
    REPORTED_CLAIM_EVIDENCE_STATUSES as readonly string[]
  ).includes(witness.status));
}
