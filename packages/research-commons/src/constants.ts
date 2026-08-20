export const RESEARCH_COMMONS_VERSION = "0.1.0-dev.0" as const;

export const RESEARCH_FORMATS = {
  nodeRef: "agenttool.research-node-ref/0.1",
  controller: "agenttool.research-controller-declaration/0.1",
  researchCase: "agenttool.research-case/0.1",
  fundingCommitment: "agenttool.research-funding-commitment/0.1",
  compensationSchedule: "agenttool.research-compensation-schedule/0.1",
  workPackage: "agenttool.research-work-package/0.1",
  artifactRevision: "agenttool.research-artifact-revision/0.1",
  evidenceReceipt: "agenttool.research-evidence-receipt/0.1",
  review: "agenttool.research-review/0.1",
  challenge: "agenttool.research-challenge/0.1",
  milestone: "agenttool.research-milestone/0.1",
  settlementBundle: "agenttool.research-settlement-bundle/0.1",
  publicProjection: "agenttool.research-public-projection/0.1",
  simulation: "agenttool.research-simulation/0.1",
  simulationState: "agenttool.research-simulation-state/0.1",
  simulationReport: "agenttool.research-simulation-report/0.1",
} as const;

export const ZERONE_TREE_SCHEMA = "zerone.constructive-intelligence-tree/v1" as const;
export const ZERONE_TREE_RAW_SHA256 =
  "sha256:8070d8d1b7ea28a314f5a8550c675d7ccbe5d9b234ef02d54d4913c650c01aaf" as const;
export const MATH_PROOFCRAFT_NODE_ID = "math-proofcraft@1" as const;
export const MATH_PROOFCRAFT_NODE_SHA256 =
  "sha256:d8f364772611a214aaf5f671c630a5fa00daa3558330bfaf5e85efe7c5a1d0e2" as const;

export const EVIDENCE_LEVELS = ["E0", "E1", "E2", "E3", "E4", "E5", "E6"] as const;
export const DECLARED_RESULT_KINDS = [
  "INCONCLUSIVE",
  "NEGATIVE",
  "NOT_APPLICABLE",
  "NULL",
  "POSITIVE",
] as const;

export const SIMULATED_CREDIT_UNIT = "SIMULATED_NONTRANSFERABLE_CREDIT" as const;
export const SIMULATED_PAYMENT_CONDITION = "SIMULATED_DELIVERY_ONLY" as const;
export const RESULT_AUTHORITY = "NONE" as const;
export const DISCLOSURE_LANE = "PUBLIC_DIGEST_ONLY" as const;

export const SIX_LEDGER_PROFILE_ID = "research-commons.six-ledger-boundary/0.1" as const;

export const SIX_LEDGER_PROFILE = Object.freeze({
  _format: SIX_LEDGER_PROFILE_ID,
  cross_ledger_arithmetic: false,
  cross_ledger_conversion: false,
  cross_ledger_inference: false,
  external_non_imports: Object.freeze([
    Object.freeze({
      kind: "ATTENTION_METABOLISM",
      posture: "EXTERNAL_NOT_IMPORTED_NO_EQUIVALENCE",
    }),
    Object.freeze({
      kind: "EXTERNAL_VALUE",
      posture: "EXTERNAL_NOT_IMPORTED_NO_EQUIVALENCE",
    }),
    Object.freeze({
      kind: "IDENTITY",
      posture: "EXTERNAL_NOT_IMPORTED_NO_EQUIVALENCE",
    }),
    Object.freeze({
      kind: "RELATIONAL_KARMA",
      posture: "EXTERNAL_NOT_IMPORTED_NO_EQUIVALENCE",
    }),
    Object.freeze({
      kind: "WORK_REST_OBLIGATIONS",
      posture: "EXTERNAL_NOT_IMPORTED_NO_EQUIVALENCE",
    }),
  ]),
  ledgers: Object.freeze([
    Object.freeze({
      cannot_determine: "IDENTITY_OWNERSHIP_OR_REPUTATION",
      holds: "CALLER_DECLARED_AUTHORSHIP_AND_CONTRIBUTION_REFS_ONLY",
      kind: "ATTRIBUTION_CREDIT",
    }),
    Object.freeze({
      cannot_determine: "EXTERNAL_VALUE_DEBT_OR_ENTITLEMENT",
      holds: "SIMULATED_PREFUNDED_CREDIT_ACCOUNTING_ONLY",
      kind: "FUNDING_LIABILITY",
    }),
    Object.freeze({
      cannot_determine: "CONSENT_GOVERNANCE_IDENTITY_OR_AUTHORITY",
      holds: "EXPLICIT_NO_EFFECT_DECLARATIONS_ONLY",
      kind: "GOVERNANCE_AUTHORITY",
    }),
    Object.freeze({
      cannot_determine: "NOVELTY_OR_PRIORITY",
      holds: "PRIOR_ART_AND_TIMESTAMP_REFS_ONLY",
      kind: "NOVELTY_PRIORITY",
    }),
    Object.freeze({
      cannot_determine: "SIGNIFICANCE_OR_IMPACT",
      holds: "DECLARED_SCOPE_AND_CONSEQUENCE_REFS_ONLY",
      kind: "SIGNIFICANCE_CONSEQUENCE",
    }),
    Object.freeze({
      cannot_determine: "SCIENTIFIC_TRUTH",
      holds: "EVIDENCE_AND_DELIVERY_REVIEW_STATUS_ONLY",
      kind: "VALIDITY",
    }),
  ]),
  profile_id: SIX_LEDGER_PROFILE_ID,
  shared_unit: false,
} as const);

// sha256 of the recursively Unicode-code-point-key-sorted compact JSON profile above.
// A test independently recomputes this pin before any public projection is accepted.
export const SIX_LEDGER_PROFILE_DIGEST =
  "sha256:fd5ed0b66dd00b180729221a06e7fbeeb7ef6149136916842014a1afbdbc54b2" as const;

export const ZERO_EFFECTS = Object.freeze({
  agenttool_api_write: false,
  agenttool_database_write: false,
  authority: false,
  bridge: false,
  burn: false,
  chain_write: false,
  consent: false,
  cross_ledger_equivalence: false,
  economic: false,
  escrow: false,
  external_value: false,
  governance: false,
  identity: false,
  identity_equivalence: false,
  knowledge_admission: false,
  hosted_route: false,
  mainnet: false,
  mint: false,
  network: false,
  payout: false,
  qualification: false,
  reputation: false,
  reward: false,
  scientific_adjudication: false,
  transfer: false,
  wallet: false,
  zrn: false,
  zerone_read: false,
  zerone_write: false,
} as const);

export const ZERO_EFFECT_COUNT = 29 as const;

export const PARTICIPATION_RIGHTS = Object.freeze({
  creates_debt: false,
  earned_credit_confiscation: false,
  earned_credit_preserved: true,
  exit_without_penalty: true,
  inactivity_penalty: false,
  pause_without_penalty: true,
  refusal_without_penalty: true,
  rest_requires_justification: false,
  rest_without_penalty: true,
  silence_is_consent: false,
  withdraw_without_penalty: true,
} as const);

export const PUBLIC_SAFE_THEORETICAL_LANE = Object.freeze({
  lane: "PUBLIC_SAFE_THEORETICAL_ONLY",
  clinical_bytes: false,
  confidential_bytes: false,
  dual_use_operational_bytes: false,
  embargoed_bytes: false,
  genomic_bytes: false,
  licensed_restricted_bytes: false,
  operational_wet_lab_bytes: false,
  personal_bytes: false,
  security_sensitive_bytes: false,
} as const);

export const MAX_JSON_BYTES = 1_048_576;
export const MAX_JSON_DEPTH = 64;
export const MAX_JSON_NODES = 32_768;
export const MAX_STRING_BYTES = 8_192;
export const MAX_REFERENCES = 256;
