import type { BridgeEvaluation, Sha256Id } from "../src/index.js";

declare const evidenceRef: Sha256Id;

const preserved = {
  invariant_id: "refusal-visible",
  state: "preserved_reported",
  evidence_refs: [evidenceRef],
} as const satisfies BridgeEvaluation;

const unknown = {
  invariant_id: "refusal-visible",
  state: "unknown",
  evidence_refs: [],
} as const satisfies BridgeEvaluation;

// @ts-expect-error Reported preservation requires at least one evidence ref.
const preservationWithoutEvidence: BridgeEvaluation = {
  invariant_id: "refusal-visible",
  state: "not_preserved_reported",
  evidence_refs: [],
};

// @ts-expect-error Refusal carries no required reason or evidence.
const refusalWithEvidence: BridgeEvaluation = {
  invariant_id: "refusal-visible",
  state: "refused_reported",
  evidence_refs: [evidenceRef],
};

void [preserved, unknown, preservationWithoutEvidence, refusalWithEvidence];
