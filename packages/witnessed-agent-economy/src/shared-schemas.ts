import {
  REQUIRED_NONCLAIMS,
  WITNESS_ACTIONS,
  WITNESS_KINDS,
  WITNESS_PROTOCOL,
  ZERO_EFFECTS,
} from "./constants.js";
import { scopedHash } from "./hash.js";
import { deepFreeze } from "./internal.js";
import type { Sha256Id, WitnessKind } from "./types.js";

type Schema = Record<string, unknown>;

const overflow = "^([2-9][0-9]{19}|19[0-9]{18}|18[5-9][0-9]{17}|184[5-9][0-9]{16}|1844[7-9][0-9]{15}|18446[8-9][0-9]{14}|184467[5-9][0-9]{13}|1844674[5-9][0-9]{12}|18446744[1-9][0-9]{11}|184467440[8-9][0-9]{10}|1844674407[4-9][0-9]{9}|18446744073[8-9][0-9]{8}|184467440737[1-9][0-9]{7}|18446744073709[6-9][0-9]{5}|184467440737095[6-9][0-9]{4}|1844674407370955[2-9][0-9]{3}|18446744073709551[7-9][0-9]{2}|184467440737095516[2-9][0-9]|1844674407370955161[6-9])$";
const ref = { type: "string", pattern: "^[0-9a-f]{64}$" } as const;
const digest = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" } as const;
const positive = {
  type: "string",
  pattern: "^[1-9][0-9]{0,19}$",
  not: { pattern: overflow },
} as const;
const uint = {
  type: "string",
  pattern: "^(0|[1-9][0-9]{0,19})$",
  not: { pattern: overflow },
} as const;
const protocol = {
  type: "string",
  pattern: "^(?!.*//)[a-z][a-z0-9.-]{0,63}/[A-Za-z0-9._/-]{1,127}$",
} as const;
const key = {
  type: "string",
  pattern: "^ed25519-sha256:[0-9a-f]{64}$",
} as const;
const git = {
  type: "string",
  pattern: "^(sha1:[0-9a-f]{40}|sha256:[0-9a-f]{64})$",
} as const;

function base(id: string): Schema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `urn:kingdom:witnessed-agent-economy:0.1:${id}`,
  };
}

function closed(properties: Record<string, unknown>): Schema {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

function definitions(entries: Record<string, unknown>): Schema {
  return { $defs: entries };
}

const kingdomRelease = {
  ...base("payload:kingdom-release-root"),
  ...closed({
    release_ref: { $ref: "#/$defs/ref" },
    ledger_protocol: { $ref: "#/$defs/protocol" },
    ledger_document_digest: { $ref: "#/$defs/digest" },
    entry_merkle_root: { $ref: "#/$defs/digest" },
    entry_count: { $ref: "#/$defs/uint" },
    git_commit: { $ref: "#/$defs/git" },
    git_tree: { $ref: "#/$defs/git" },
    build_manifest_digest: { $ref: "#/$defs/digest" },
    deployment_manifest_digest: { $ref: "#/$defs/digest" },
    verifier_protocol: { $ref: "#/$defs/protocol" },
    verifier_digest: { $ref: "#/$defs/digest" },
    previous_release: { oneOf: [{ type: "null" }, { $ref: "#/$defs/digest" }] },
  }),
  ...definitions({ ref, digest, uint, protocol, git }),
};

const gap = closed({
  first: { $ref: "#/$defs/positive" },
  last: { $ref: "#/$defs/positive" },
});
const settlement = {
  ...base("payload:agenttool-settlement-root"),
  ...closed({
    receipt_protocol: protocol,
    receipt_schema_digest: { $ref: "#/$defs/digest" },
    source_sequence_binding: { const: "PROJECTION_ONLY" },
    receipt_uniqueness_scope: { const: "BATCH_ONLY" },
    first_sequence: { $ref: "#/$defs/positive" },
    last_sequence: { $ref: "#/$defs/positive" },
    receipt_count: { $ref: "#/$defs/positive" },
    declared_gaps: { type: "array", maxItems: 4096, items: gap },
    merkle_root: { $ref: "#/$defs/digest" },
    previous_batch: { oneOf: [{ type: "null" }, { $ref: "#/$defs/digest" }] },
  }),
  ...definitions({ digest, positive }),
};

const capability = {
  ...base("payload:agenttool-capability"),
  oneOf: [
    closed({
      capability_ref: { $ref: "#/$defs/ref" },
      grant_digest: { $ref: "#/$defs/digest" },
      asset_ref: { $ref: "#/$defs/digest" },
      max_per_consume_minor: { $ref: "#/$defs/positive" },
      max_total_minor: { $ref: "#/$defs/positive" },
    }),
    closed({
      capability_ref: { $ref: "#/$defs/ref" },
      grant_commitment: { $ref: "#/$defs/digest" },
      asset_ref: { $ref: "#/$defs/digest" },
      amount_minor: { $ref: "#/$defs/positive" },
      source_event_digest: { $ref: "#/$defs/digest" },
      nullifier: { $ref: "#/$defs/digest" },
    }),
    closed({
      capability_ref: { $ref: "#/$defs/ref" },
      grant_commitment: { $ref: "#/$defs/digest" },
      reason_digest: { $ref: "#/$defs/digest" },
    }),
  ],
  ...definitions({ ref, digest, positive }),
};

const recognition = {
  ...base("payload:agenttool-public-recognition"),
  oneOf: [
    closed({
      recognition_ref: { $ref: "#/$defs/ref" },
      surface_digest: { $ref: "#/$defs/digest" },
      registry_digest: { $ref: "#/$defs/digest" },
      adoption_document_digest: { $ref: "#/$defs/digest" },
      authority_sequence: { $ref: "#/$defs/positive" },
      visibility: { const: "PUBLIC" },
    }),
    closed({
      recognition_ref: { $ref: "#/$defs/ref" },
      adoption_commitment: { $ref: "#/$defs/digest" },
      surface_digest: { $ref: "#/$defs/digest" },
      registry_digest: { $ref: "#/$defs/digest" },
      withdrawal_document_digest: { $ref: "#/$defs/digest" },
      authority_sequence: { $ref: "#/$defs/positive" },
      reason_digest: { $ref: "#/$defs/digest" },
      visibility: { const: "PUBLIC" },
    }),
  ],
  ...definitions({ ref, digest, positive }),
};

const offer = {
  ...base("payload:agenttool-offer"),
  oneOf: [
    closed({
      offer_ref: { $ref: "#/$defs/ref" },
      offer_document_digest: { $ref: "#/$defs/digest" },
      capability_root: { $ref: "#/$defs/digest" },
      pricing_root: { $ref: "#/$defs/digest" },
      sla_root: { $ref: "#/$defs/digest" },
      terms_digest: { $ref: "#/$defs/digest" },
      revision: { $ref: "#/$defs/positive" },
      authority_sequence: { $ref: "#/$defs/positive" },
      visibility: { const: "PUBLIC" },
    }),
    closed({
      offer_ref: { $ref: "#/$defs/ref" },
      offer_document_digest: { $ref: "#/$defs/digest" },
      capability_root: { $ref: "#/$defs/digest" },
      pricing_root: { $ref: "#/$defs/digest" },
      sla_root: { $ref: "#/$defs/digest" },
      terms_digest: { $ref: "#/$defs/digest" },
      revision: { $ref: "#/$defs/positive" },
      authority_sequence: { $ref: "#/$defs/positive" },
      visibility: { const: "PUBLIC" },
      supersedes: { $ref: "#/$defs/digest" },
    }),
    closed({
      offer_ref: { $ref: "#/$defs/ref" },
      offer_commitment: { $ref: "#/$defs/digest" },
      offer_document_digest: { $ref: "#/$defs/digest" },
      authority_sequence: { $ref: "#/$defs/positive" },
      reason_digest: { $ref: "#/$defs/digest" },
      visibility: { const: "PUBLIC" },
    }),
  ],
  ...definitions({ ref, digest, positive }),
};

const wake = {
  ...base("payload:wake-public-checkpoint"),
  oneOf: [
    closed({
      public_contract_protocol: { $ref: "#/$defs/protocol" },
      public_contract_schema_digest: { $ref: "#/$defs/digest" },
      contract_root: { $ref: "#/$defs/digest" },
      capability_root: { $ref: "#/$defs/digest" },
      pricing_root: { $ref: "#/$defs/digest" },
      protocols_root: { $ref: "#/$defs/digest" },
      boundaries_root: { $ref: "#/$defs/digest" },
      authority_sequence: { $ref: "#/$defs/positive" },
    }),
    closed({
      public_contract_protocol: { $ref: "#/$defs/protocol" },
      public_contract_schema_digest: { $ref: "#/$defs/digest" },
      contract_root: { $ref: "#/$defs/digest" },
      capability_root: { $ref: "#/$defs/digest" },
      pricing_root: { $ref: "#/$defs/digest" },
      protocols_root: { $ref: "#/$defs/digest" },
      boundaries_root: { $ref: "#/$defs/digest" },
      authority_sequence: { $ref: "#/$defs/positive" },
      supersedes: { $ref: "#/$defs/digest" },
    }),
    closed({
      checkpoint_commitment: { $ref: "#/$defs/digest" },
      withdrawal_document_digest: { $ref: "#/$defs/digest" },
      authority_sequence: { $ref: "#/$defs/positive" },
      reason_digest: { $ref: "#/$defs/digest" },
      visibility: { const: "PUBLIC" },
    }),
  ],
  ...definitions({ digest, positive, protocol }),
};

const keyContinuity = {
  ...base("payload:issuer-key-continuity"),
  oneOf: [
    closed({
      previous_key_fingerprint: { $ref: "#/$defs/key" },
      next_key_fingerprint: { $ref: "#/$defs/key" },
      rotation_digest: { $ref: "#/$defs/digest" },
    }),
    closed({
      revoked_key_fingerprint: { $ref: "#/$defs/key" },
      reason_digest: { $ref: "#/$defs/digest" },
    }),
  ],
  ...definitions({ digest, key }),
};

const artifactLineage = {
  ...base("payload:artifact-lineage"),
  ...closed({
    upstream_ref: { $ref: "#/$defs/ref" },
    downstream_ref: { $ref: "#/$defs/ref" },
    relation: {
      enum: [
        "DERIVES_FROM", "USES_CAPABILITY", "FULFILLS", "SETTLES",
        "CHECKPOINTS", "SUPERSEDES", "REVOKES",
      ],
    },
    evidence_digest: { $ref: "#/$defs/digest" },
  }),
  ...definitions({ ref, digest }),
};

const collaboration = {
  ...base("payload:collaboration-checkpoint"),
  description: "A complete contiguous v0 journal-prefix checkpoint. Normative verification additionally requires event_head_sequence to equal event_count; JSON Schema 2020-12 cannot express cross-property string equality.",
  ...closed({
    workspace_ref: { $ref: "#/$defs/ref" },
    epoch_ref: { $ref: "#/$defs/digest" },
    event_head_sequence: { $ref: "#/$defs/uint" },
    event_head_hash: { $ref: "#/$defs/digest" },
    event_count: { $ref: "#/$defs/uint" },
    participant_set_root: { $ref: "#/$defs/digest" },
  }),
  ...definitions({ ref, digest, uint }),
};

const dispute = {
  ...base("payload:dispute-terminal"),
  ...closed({
    settlement_commitment: { $ref: "#/$defs/digest" },
    outcome: { enum: ["RELEASE", "REFUND", "SPLIT", "DISMISS"] },
    decision_digest: { $ref: "#/$defs/digest" },
    distribution_root: { $ref: "#/$defs/digest" },
  }),
  ...definitions({ digest }),
};

export const SHARED_PAYLOAD_SCHEMAS = deepFreeze({
  KINGDOM_RELEASE_ROOT: kingdomRelease,
  AGENTTOOL_SETTLEMENT_ROOT: settlement,
  AGENTTOOL_CAPABILITY: capability,
  AGENTTOOL_PUBLIC_RECOGNITION: recognition,
  AGENTTOOL_OFFER: offer,
  WAKE_PUBLIC_CHECKPOINT: wake,
  ISSUER_KEY_CONTINUITY: keyContinuity,
  ARTIFACT_LINEAGE: artifactLineage,
  COLLABORATION_CHECKPOINT: collaboration,
  DISPUTE_TERMINAL: dispute,
} satisfies Record<WitnessKind, Schema>);

export const EXPECTED_SCHEMA_HASHES = deepFreeze(Object.fromEntries(
  Object.entries(SHARED_PAYLOAD_SCHEMAS).map(([kind, schema]) => [kind, scopedHash("schema", schema)]),
) as Record<WitnessKind, Sha256Id>);

const issuer = closed({
  namespace: { type: "string", pattern: "^[a-z][a-z0-9.-]{0,63}$" },
  controller_ref: { $ref: "#/$defs/ref" },
  key_fingerprint: key,
});
const effects = closed(Object.fromEntries(
  Object.entries(ZERO_EFFECTS).map(([name, value]) => [name, { const: value }]),
));
const envelope = closed({
  protocol: { const: WITNESS_PROTOCOL },
  kind: { enum: WITNESS_KINDS },
  action: { enum: WITNESS_ACTIONS },
  audience: { type: "string", pattern: "^[a-z][a-z0-9.-]{0,31}:[a-z0-9][a-z0-9._-]{0,95}$" },
  subject_ref: { $ref: "#/$defs/ref" },
  sequence: { $ref: "#/$defs/positive" },
  parent: { oneOf: [{ type: "null" }, { $ref: "#/$defs/digest" }] },
  issuer,
  schema_hash: { $ref: "#/$defs/digest" },
  payload_root: { $ref: "#/$defs/digest" },
  policy_digest: { $ref: "#/$defs/digest" },
  expiry_height: { oneOf: [{ type: "null" }, { $ref: "#/$defs/positive" }] },
  effects,
  nonclaims: { const: REQUIRED_NONCLAIMS },
});

export const WITNESS_RECORD_SCHEMA = deepFreeze({
  ...base("record"),
  title: "WAKE-WORK-WITNESS v0 signed commitment record",
  ...closed({
    envelope,
    payload: { type: "object" },
    commitment: { $ref: "#/$defs/digest" },
    signature: closed({
      algorithm: { const: "Ed25519" },
      public_key: ref,
      value: { type: "string", pattern: "^[0-9a-f]{128}$" },
    }),
  }),
  ...definitions({ ref, digest, positive }),
});

export const SETTLEMENT_BATCH_SIDECAR_SCHEMA = deepFreeze({
  ...base("settlement-batch-sidecar"),
  ...closed({
    first_sequence: { $ref: "#/$defs/positive" },
    last_sequence: { $ref: "#/$defs/positive" },
    receipt_count: { $ref: "#/$defs/positive" },
    declared_gaps: { type: "array", maxItems: 4096, items: gap },
    leaves: {
      type: "array",
      minItems: 1,
      maxItems: 4096,
      items: closed({
        sequence: { $ref: "#/$defs/positive" },
        receipt_digest: { $ref: "#/$defs/digest" },
      }),
    },
  }),
  ...definitions({ digest, positive }),
});
