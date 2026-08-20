import {
  PUBLIC_OFFER_BOUNDARIES,
  PUBLIC_WAKE_CONTRACT_BOUNDARIES,
  PUBLIC_WAKE_WITHDRAWAL_BOUNDARIES,
  SOURCE_SCHEMAS,
} from "./constants.js";
import { canonicalSha256 } from "./hash.js";
import { deepFreeze } from "./internal.js";

type Schema = Record<string, unknown>;

const sha256Id = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" } as const;
const opaqueRef = { type: "string", pattern: "^[0-9a-f]{64}$" } as const;
const publicKey = opaqueRef;
const keyFingerprint = {
  type: "string",
  pattern: "^ed25519-sha256:[0-9a-f]{64}$",
} as const;
const uint64OverflowPattern = "^([2-9][0-9]{19}|19[0-9]{18}|18[5-9][0-9]{17}|184[5-9][0-9]{16}|1844[7-9][0-9]{15}|18446[8-9][0-9]{14}|184467[5-9][0-9]{13}|1844674[5-9][0-9]{12}|18446744[1-9][0-9]{11}|184467440[8-9][0-9]{10}|1844674407[4-9][0-9]{9}|18446744073[8-9][0-9]{8}|184467440737[1-9][0-9]{7}|18446744073709[6-9][0-9]{5}|184467440737095[6-9][0-9]{4}|1844674407370955[2-9][0-9]{3}|18446744073709551[7-9][0-9]{2}|184467440737095516[2-9][0-9]|1844674407370955161[6-9])$";
const uint64String = {
  type: "string",
  pattern: "^(0|[1-9][0-9]{0,19})$",
  not: { pattern: uint64OverflowPattern },
} as const;
const positiveUint64String = {
  type: "string",
  pattern: "^[1-9][0-9]{0,19}$",
  not: { pattern: uint64OverflowPattern },
} as const;
const instant = {
  type: "string",
  format: "date-time",
  pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$",
} as const;
const audience = {
  type: "string",
  pattern: "^[a-z][a-z0-9.-]{0,31}:[a-z0-9][a-z0-9._-]{0,95}$",
} as const;
const nonce = opaqueRef;
const signature = {
  type: "object",
  additionalProperties: false,
  required: ["algorithm", "public_key", "value"],
  properties: {
    algorithm: { const: "Ed25519" },
    public_key: publicKey,
    value: { type: "string", pattern: "^[0-9a-f]{128}$" },
  },
} as const;

function closedObject(required: readonly string[], properties: Record<string, unknown>): Schema {
  return {
    type: "object",
    additionalProperties: false,
    required: [...required],
    properties,
  };
}

function constantsObject(value: Readonly<Record<string, unknown>>): Schema {
  return closedObject(
    Object.keys(value),
    Object.fromEntries(Object.entries(value).map(([key, constant]) => [key, { const: constant }])),
  );
}

const authority = closedObject(
  ["scheme", "public_key", "key_fingerprint", "registry_match", "multi_root_quorum"],
  {
    scheme: { const: "single_ed25519" },
    public_key: publicKey,
    key_fingerprint: keyFingerprint,
    registry_match: { const: "not_established" },
    multi_root_quorum: { const: "not_implemented" },
  },
);

const wakeRoots = closedObject(
  ["capabilities", "prices", "protocols", "safety"],
  {
    capabilities: sha256Id,
    prices: sha256Id,
    protocols: sha256Id,
    safety: sha256Id,
  },
);

const wakeContractProperties = {
  schema: { const: SOURCE_SCHEMAS.public_wake_contract },
  audience,
  subject_ref: opaqueRef,
  controller_ref: opaqueRef,
  authority_sequence: positiveUint64String,
  previous_contract_id: { anyOf: [{ type: "null" }, sha256Id] },
  roots: wakeRoots,
  valid_from: instant,
  expires_at: instant,
  nonce,
  authority,
  boundaries: constantsObject(PUBLIC_WAKE_CONTRACT_BOUNDARIES),
  signature,
  contract_id: sha256Id,
};

export const PUBLIC_WAKE_CONTRACT_SCHEMA = deepFreeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://agenttool.dev/schemas/public-wake-contract/0.1.json",
  title: "AgentTool root-signed public WAKE contract",
  ...closedObject(Object.keys(wakeContractProperties), wakeContractProperties),
} as const);

const predecessor = closedObject(
  ["contract_id", "document_digest"],
  { contract_id: sha256Id, document_digest: sha256Id },
);

const wakeWithdrawalProperties = {
  schema: { const: SOURCE_SCHEMAS.public_wake_withdrawal },
  audience,
  subject_ref: opaqueRef,
  controller_ref: opaqueRef,
  authority_sequence: positiveUint64String,
  predecessor,
  reason_digest: sha256Id,
  withdrawn_at: instant,
  visibility: { const: "PUBLIC" },
  nonce,
  authority,
  boundaries: constantsObject(PUBLIC_WAKE_WITHDRAWAL_BOUNDARIES),
  signature,
  withdrawal_id: sha256Id,
};

export const PUBLIC_WAKE_WITHDRAWAL_SCHEMA = deepFreeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://agenttool.dev/schemas/public-wake-withdrawal/0.1.json",
  title: "AgentTool root-signed public WAKE withdrawal",
  ...closedObject(Object.keys(wakeWithdrawalProperties), wakeWithdrawalProperties),
} as const);

const offerPredecessor = closedObject(
  ["offer_id", "document_digest"],
  { offer_id: sha256Id, document_digest: sha256Id },
);
const offerCommon = {
  schema: { const: SOURCE_SCHEMAS.public_offer },
  audience,
  offer_ref: opaqueRef,
  subject_ref: opaqueRef,
  controller_ref: opaqueRef,
  authority_sequence: positiveUint64String,
  revision: positiveUint64String,
  visibility: { const: "PUBLIC" },
  nonce,
  authority,
  boundaries: constantsObject(PUBLIC_OFFER_BOUNDARIES),
};
const offerTerms = {
  capability_root: sha256Id,
  pricing_root: sha256Id,
  sla_root: sha256Id,
  terms_digest: sha256Id,
  valid_from: instant,
  expires_at: instant,
};
const publishProperties = { ...offerCommon, action: { const: "PUBLISH" }, ...offerTerms };
const supersedeProperties = {
  ...offerCommon,
  action: { const: "SUPERSEDE" },
  predecessor: offerPredecessor,
  ...offerTerms,
};
const revokeProperties = {
  ...offerCommon,
  action: { const: "REVOKE" },
  predecessor: offerPredecessor,
  reason_digest: sha256Id,
  revoked_at: instant,
};

export const PUBLIC_OFFER_SCHEMA = deepFreeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://agenttool.dev/schemas/public-offer/0.1.json",
  title: "AgentTool signed public offer lifecycle record",
  oneOf: [
    closedObject([...Object.keys(publishProperties), "signature", "offer_id"], {
      ...publishProperties,
      signature,
      offer_id: sha256Id,
    }),
    closedObject([...Object.keys(supersedeProperties), "signature", "offer_id"], {
      ...supersedeProperties,
      signature,
      offer_id: sha256Id,
    }),
    closedObject([...Object.keys(revokeProperties), "signature", "offer_id"], {
      ...revokeProperties,
      signature,
      offer_id: sha256Id,
    }),
  ],
} as const);

export const PUBLIC_WAKE_CONTRACT_SCHEMA_DIGEST = canonicalSha256(PUBLIC_WAKE_CONTRACT_SCHEMA);
export const PUBLIC_WAKE_WITHDRAWAL_SCHEMA_DIGEST = canonicalSha256(PUBLIC_WAKE_WITHDRAWAL_SCHEMA);
export const PUBLIC_OFFER_SCHEMA_DIGEST = canonicalSha256(PUBLIC_OFFER_SCHEMA);

// Exported for schema-generation code and tests; counters remain decimal
// strings even though the shared canonical profile permits small JSON numbers.
export const SOURCE_SCHEMA_PRIMITIVES = deepFreeze({
  sha256Id,
  opaqueRef,
  uint64String,
} as const);
