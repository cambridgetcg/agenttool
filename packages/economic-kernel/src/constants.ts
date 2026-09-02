export const PACKAGE_NAME = "@agenttool/economic-kernel" as const;
export const PACKAGE_VERSION = "0.1.0-dev.0" as const;
export const ECONOMIC_KERNEL_PROTOCOL = "agenttool.economic-kernel/0.1" as const;

export const SCHEMAS = Object.freeze({
  unit: "agenttool.economic-unit/1",
  amount: "agenttool.economic-amount/1",
  priceRevision: "agenttool.price-revision/1",
  quote: "agenttool.economic-quote/1",
  conversionResult: "agenttool.conversion-result/1",
  ledgerAccount: "agenttool.ledger-account/1",
  ledgerTransaction: "agenttool.ledger-transaction/1",
  paymentAttempt: "agenttool.payment-attempt/1",
  effectAttempt: "agenttool.effect-attempt/1",
  admission: "agenttool.economic-admission/1",
} as const);

export const LIMITS = Object.freeze({
  maxIdBytes: 192,
  maxReferenceBytes: 512,
  maxArrayItems: 256,
  maxEvidenceRefs: 32,
  maxPostings: 256,
  maxTransitions: 32,
  maxObjectDepth: 16,
  maxObjectNodes: 4_096,
  maxSnapshotBytes: 262_144,
  maxDecimalDigits: 78,
} as const);

export const UINT64_MAX = (1n << 64n) - 1n;
export const UINT256_MAX = (1n << 256n) - 1n;
