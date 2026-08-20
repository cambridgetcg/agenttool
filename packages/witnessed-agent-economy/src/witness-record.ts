import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { strictEd25519Verify } from "@agenttool/public-surface-binding";
import { isProxy } from "node:util/types";

import {
  ALLOWED_ACTIONS,
  MAX_UINT64,
  REQUIRED_NONCLAIMS,
  WITNESS_KINDS,
  WITNESS_PROTOCOL,
  ZERO_EFFECTS,
} from "./constants.js";
import { WitnessProjectionError, invalid } from "./errors.js";
import {
  bytesToHex,
  ed25519Fingerprint,
  hexToBytes,
  sha256Bytes,
  scopedHash,
} from "./hash.js";
import { deepFreeze } from "./internal.js";
import { EXPECTED_SCHEMA_HASHES, SHARED_PAYLOAD_SCHEMAS } from "./shared-schemas.js";
import { validateHexEd25519Signer } from "./signature.js";
import type {
  AllowedAction,
  HexEd25519Signer,
  Sha256Id,
  VerifiedWitnessRecord,
  WitnessEnvelope,
  WitnessIssuer,
  WitnessKind,
  WitnessRecord,
} from "./types.js";
import {
  decodeWitnessCanonicalJson,
  encodeWitnessCanonicalJson,
  snapshotWitnessJsonData,
  witnessCanonicalJson,
  type WitnessJsonValue,
} from "./witness-canonical.js";

type WitnessObject = Record<string, WitnessJsonValue>;

const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
const payloadValidators = Object.freeze(Object.fromEntries(
  Object.entries(SHARED_PAYLOAD_SCHEMAS).map(([kind, schema]) => [
    kind,
    ajv.compile(JSON.parse(JSON.stringify(schema)) as object),
  ]),
) as Record<WitnessKind, ValidateFunction>);

const ACTION_PAYLOAD_KEYS = deepFreeze({
  KINGDOM_RELEASE_ROOT: {
    CHECKPOINT: [
      "release_ref", "ledger_protocol", "ledger_document_digest", "entry_merkle_root",
      "entry_count", "git_commit", "git_tree", "build_manifest_digest",
      "deployment_manifest_digest", "verifier_protocol", "verifier_digest", "previous_release",
    ],
  },
  AGENTTOOL_SETTLEMENT_ROOT: {
    CHECKPOINT: [
      "receipt_protocol", "receipt_schema_digest", "source_sequence_binding",
      "receipt_uniqueness_scope", "first_sequence", "last_sequence", "receipt_count",
      "declared_gaps", "merkle_root", "previous_batch",
    ],
  },
  AGENTTOOL_CAPABILITY: {
    GRANT: ["capability_ref", "grant_digest", "asset_ref", "max_per_consume_minor", "max_total_minor"],
    CONSUME: ["capability_ref", "grant_commitment", "asset_ref", "amount_minor", "source_event_digest", "nullifier"],
    REVOKE: ["capability_ref", "grant_commitment", "reason_digest"],
  },
  AGENTTOOL_PUBLIC_RECOGNITION: {
    ADOPT: [
      "recognition_ref", "surface_digest", "registry_digest", "adoption_document_digest",
      "authority_sequence", "visibility",
    ],
    WITHDRAW: [
      "recognition_ref", "adoption_commitment", "surface_digest", "registry_digest",
      "withdrawal_document_digest", "authority_sequence", "reason_digest", "visibility",
    ],
  },
  AGENTTOOL_OFFER: {
    PUBLISH: [
      "offer_ref", "offer_document_digest", "capability_root", "pricing_root", "sla_root",
      "terms_digest", "revision", "authority_sequence", "visibility",
    ],
    SUPERSEDE: [
      "offer_ref", "offer_document_digest", "capability_root", "pricing_root", "sla_root",
      "terms_digest", "revision", "authority_sequence", "visibility", "supersedes",
    ],
    REVOKE: [
      "offer_ref", "offer_commitment", "offer_document_digest", "authority_sequence",
      "reason_digest", "visibility",
    ],
  },
  WAKE_PUBLIC_CHECKPOINT: {
    CHECKPOINT: [
      "public_contract_protocol", "public_contract_schema_digest", "contract_root",
      "capability_root", "pricing_root", "protocols_root", "boundaries_root", "authority_sequence",
    ],
    SUPERSEDE: [
      "public_contract_protocol", "public_contract_schema_digest", "contract_root",
      "capability_root", "pricing_root", "protocols_root", "boundaries_root", "authority_sequence",
      "supersedes",
    ],
    WITHDRAW: [
      "checkpoint_commitment", "withdrawal_document_digest", "authority_sequence",
      "reason_digest", "visibility",
    ],
  },
  ISSUER_KEY_CONTINUITY: {
    ROTATE: ["previous_key_fingerprint", "next_key_fingerprint", "rotation_digest"],
    REVOKE: ["revoked_key_fingerprint", "reason_digest"],
  },
  ARTIFACT_LINEAGE: {
    CHECKPOINT: ["upstream_ref", "downstream_ref", "relation", "evidence_digest"],
  },
  COLLABORATION_CHECKPOINT: {
    CHECKPOINT: [
      "workspace_ref", "epoch_ref", "event_head_sequence", "event_head_hash", "event_count",
      "participant_set_root",
    ],
  },
  DISPUTE_TERMINAL: {
    SETTLE: ["settlement_commitment", "outcome", "decision_digest", "distribution_root"],
  },
} as const);

function object(value: WitnessJsonValue, path: string): WitnessObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    invalid(`${path} must be an object.`, path);
  }
  return value;
}

function exactKeys(value: WitnessObject, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    invalid(`${path} must contain exactly ${wanted.join(", ")}.`, path);
  }
}

function string(value: WitnessJsonValue, path: string): string {
  if (typeof value !== "string") invalid(`${path} must be a string.`, path);
  return value;
}

function ref(value: WitnessJsonValue, path: string): string {
  const candidate = string(value, path);
  if (!/^[0-9a-f]{64}$/u.test(candidate)) invalid(`${path} must be 64 lowercase hex.`, path);
  return candidate;
}

function digest(value: WitnessJsonValue, path: string): Sha256Id {
  const candidate = string(value, path);
  if (!/^sha256:[0-9a-f]{64}$/u.test(candidate)) invalid(`${path} must be a sha256 digest.`, path);
  return candidate as Sha256Id;
}

function decimal(value: WitnessJsonValue, path: string, allowZero: boolean): string {
  const candidate = string(value, path);
  if (candidate.length > 20) invalid(`${path} exceeds the canonical uint64 width.`, path);
  if (!(allowZero ? /^(0|[1-9][0-9]*)$/u : /^[1-9][0-9]*$/u).test(candidate)) {
    invalid(`${path} must be a canonical ${allowZero ? "unsigned" : "positive"} decimal string.`, path);
  }
  if (BigInt(candidate) > MAX_UINT64) invalid(`${path} exceeds uint64.`, path);
  return candidate;
}

function kind(value: WitnessJsonValue): WitnessKind {
  const candidate = string(value, "$record.envelope.kind");
  if (!(WITNESS_KINDS as readonly string[]).includes(candidate)) {
    invalid("Unsupported WITNESS kind.", "$record.envelope.kind");
  }
  return candidate as WitnessKind;
}

function action<K extends WitnessKind>(recordKind: K, value: WitnessJsonValue): AllowedAction<K> {
  const candidate = string(value, "$record.envelope.action");
  if (!(ALLOWED_ACTIONS[recordKind] as readonly string[]).includes(candidate)) {
    invalid("Unsupported WITNESS kind/action pair.", "$record.envelope.action");
  }
  return candidate as AllowedAction<K>;
}

function validatePayloadShape<K extends WitnessKind>(
  recordKind: K,
  recordAction: AllowedAction<K>,
  payloadValue: WitnessJsonValue,
): WitnessObject {
  const payload = object(payloadValue, "$record.payload");
  const validator = payloadValidators[recordKind];
  if (!validator(payload)) {
    invalid(`Payload does not match the closed ${recordKind} schema: ${ajv.errorsText(validator.errors)}.`, "$record.payload");
  }
  const perKind = ACTION_PAYLOAD_KEYS[recordKind] as Record<string, readonly string[]>;
  exactKeys(payload, perKind[recordAction]!, "$record.payload");
  return payload;
}

function validateBatch(payload: WitnessObject): void {
  const first = BigInt(decimal(payload.first_sequence!, "$record.payload.first_sequence", false));
  const last = BigInt(decimal(payload.last_sequence!, "$record.payload.last_sequence", false));
  const count = BigInt(decimal(payload.receipt_count!, "$record.payload.receipt_count", false));
  if (last < first) invalid("Settlement last_sequence precedes first_sequence.", "$record.payload.last_sequence");
  const gaps = payload.declared_gaps;
  if (!Array.isArray(gaps)) invalid("declared_gaps must be an array.", "$record.payload.declared_gaps");
  let missing = 0n;
  let priorLast: bigint | null = null;
  for (const [index, gapValue] of gaps.entries()) {
    const gap = object(gapValue, `$record.payload.declared_gaps[${index}]`);
    const gapFirst = BigInt(decimal(gap.first!, `$record.payload.declared_gaps[${index}].first`, false));
    const gapLast = BigInt(decimal(gap.last!, `$record.payload.declared_gaps[${index}].last`, false));
    if (gapFirst < first || gapLast > last || gapLast < gapFirst) {
      invalid("Settlement gap is outside the declared batch range.", `$record.payload.declared_gaps[${index}]`);
    }
    if (priorLast !== null && gapFirst <= priorLast + 1n) {
      invalid("Settlement gaps must be sorted, disjoint and maximally merged.", `$record.payload.declared_gaps[${index}]`);
    }
    missing += gapLast - gapFirst + 1n;
    if (missing > MAX_UINT64) invalid("Settlement gap count overflows uint64.", "$record.payload.declared_gaps");
    priorLast = gapLast;
  }
  if (count !== last - first + 1n - missing) {
    invalid("receipt_count must equal range size minus declared gaps.", "$record.payload.receipt_count");
  }
}

function validateStableSubject(envelope: WitnessObject, payload: WitnessObject, field: string): void {
  if (envelope.subject_ref !== payload[field]) {
    invalid(`subject_ref must equal payload.${field}.`, "$record.envelope.subject_ref");
  }
}

function requireInitialLifecycleAction(envelope: WitnessObject): void {
  if (envelope.sequence !== "1" || envelope.parent !== null) {
    invalid(
      "Initial lifecycle action requires sequence 1 and null parent.",
      "$record.envelope",
    );
  }
}

function requireNonInitialLifecycleAction(envelope: WitnessObject): void {
  if (envelope.sequence === "1" || envelope.parent === null) {
    invalid(
      "Non-initial lifecycle action requires sequence greater than 1 and non-null parent.",
      "$record.envelope",
    );
  }
}

function validateOptionalParentPointer(
  envelope: WitnessObject,
  payload: WitnessObject,
  field: string,
): void {
  if (payload[field] !== envelope.parent) {
    invalid(
      `${field} must equal envelope.parent, including null at sequence 1.`,
      `$record.payload.${field}`,
    );
  }
}

function validateRequiredParentPointer(
  envelope: WitnessObject,
  payload: WitnessObject,
  field: string,
): void {
  if (envelope.parent === null || payload[field] !== envelope.parent) {
    invalid(
      `${field} must equal non-null envelope.parent.`,
      `$record.payload.${field}`,
    );
  }
}

function validatePayloadSemantics<K extends WitnessKind>(
  envelope: WitnessObject,
  recordKind: K,
  recordAction: AllowedAction<K>,
  payload: WitnessObject,
): void {
  switch (recordKind) {
    case "KINGDOM_RELEASE_ROOT":
      validateStableSubject(envelope, payload, "release_ref");
      validateOptionalParentPointer(envelope, payload, "previous_release");
      break;
    case "AGENTTOOL_SETTLEMENT_ROOT":
      validateBatch(payload);
      if (payload.source_sequence_binding !== "PROJECTION_ONLY") {
        invalid("source_sequence_binding must be PROJECTION_ONLY.", "$record.payload.source_sequence_binding");
      }
      if (payload.receipt_uniqueness_scope !== "BATCH_ONLY") {
        invalid("receipt_uniqueness_scope must be BATCH_ONLY.", "$record.payload.receipt_uniqueness_scope");
      }
      validateOptionalParentPointer(envelope, payload, "previous_batch");
      if (payload.previous_batch === null && payload.first_sequence !== "1") {
        invalid("Genesis settlement batch must begin at first_sequence 1.", "$record.payload.first_sequence");
      }
      break;
    case "AGENTTOOL_CAPABILITY":
      validateStableSubject(envelope, payload, "capability_ref");
      if (recordAction === "GRANT") {
        requireInitialLifecycleAction(envelope);
        const perUse = BigInt(decimal(payload.max_per_consume_minor!, "$record.payload.max_per_consume_minor", false));
        const total = BigInt(decimal(payload.max_total_minor!, "$record.payload.max_total_minor", false));
        if (perUse > total) invalid("max_per_consume_minor exceeds max_total_minor.", "$record.payload");
      } else if (recordAction === "CONSUME") {
        requireNonInitialLifecycleAction(envelope);
        const expected = capabilityNullifierFromObjects(envelope, payload);
        if (payload.nullifier !== expected) invalid("Capability nullifier mismatch.", "$record.payload.nullifier");
      } else {
        requireNonInitialLifecycleAction(envelope);
      }
      break;
    case "AGENTTOOL_PUBLIC_RECOGNITION":
      validateStableSubject(envelope, payload, "recognition_ref");
      if (recordAction === "ADOPT") requireInitialLifecycleAction(envelope);
      else validateRequiredParentPointer(envelope, payload, "adoption_commitment");
      break;
    case "AGENTTOOL_OFFER":
      validateStableSubject(envelope, payload, "offer_ref");
      if (recordAction === "PUBLISH") requireInitialLifecycleAction(envelope);
      else if (recordAction === "SUPERSEDE") validateRequiredParentPointer(envelope, payload, "supersedes");
      else validateRequiredParentPointer(envelope, payload, "offer_commitment");
      break;
    case "WAKE_PUBLIC_CHECKPOINT":
      if (recordAction === "CHECKPOINT") requireInitialLifecycleAction(envelope);
      else if (recordAction === "SUPERSEDE") validateRequiredParentPointer(envelope, payload, "supersedes");
      else validateRequiredParentPointer(envelope, payload, "checkpoint_commitment");
      break;
    case "ISSUER_KEY_CONTINUITY": {
      const issuer = object(envelope.issuer!, "$record.envelope.issuer");
      if (envelope.subject_ref !== issuer.controller_ref) {
        invalid("Key-continuity subject_ref must equal issuer.controller_ref.", "$record.envelope.subject_ref");
      }
      if (recordAction === "ROTATE") {
        if (payload.previous_key_fingerprint !== issuer.key_fingerprint) {
          invalid("Rotation previous key must equal the signing key.", "$record.payload.previous_key_fingerprint");
        }
        if (payload.previous_key_fingerprint === payload.next_key_fingerprint) {
          invalid("Key rotation must change fingerprint.", "$record.payload.next_key_fingerprint");
        }
      } else if (payload.revoked_key_fingerprint !== issuer.key_fingerprint) {
        invalid("Revoked key must equal the signing key.", "$record.payload.revoked_key_fingerprint");
      }
      break;
    }
    case "ARTIFACT_LINEAGE":
      validateStableSubject(envelope, payload, "downstream_ref");
      if (payload.upstream_ref === payload.downstream_ref) {
        invalid("Artifact lineage endpoints must differ.", "$record.payload");
      }
      break;
    case "COLLABORATION_CHECKPOINT":
      validateStableSubject(envelope, payload, "workspace_ref");
      if (payload.event_head_sequence !== payload.event_count) {
        invalid(
          "Full-prefix collaboration checkpoints require event_head_sequence equal event_count.",
          "$record.payload",
        );
      }
      break;
    case "DISPUTE_TERMINAL":
      break;
  }
}

function capabilityNullifierFromObjects(envelope: WitnessObject, payload: WitnessObject): Sha256Id {
  const grant = hexToBytes(digest(payload.grant_commitment!, "$record.payload.grant_commitment").slice(7), 32);
  const asset = hexToBytes(digest(payload.asset_ref!, "$record.payload.asset_ref").slice(7), 32);
  const source = hexToBytes(digest(payload.source_event_digest!, "$record.payload.source_event_digest").slice(7), 32);
  const utf8 = new TextEncoder();
  const nul = new Uint8Array([0]);
  const parts = [
    utf8.encode(WITNESS_PROTOCOL), nul,
    utf8.encode("capability-nullifier"), nul,
    utf8.encode(string(envelope.audience!, "$record.envelope.audience")), nul,
    utf8.encode(ref(envelope.subject_ref!, "$record.envelope.subject_ref")), nul,
    utf8.encode(ref(payload.capability_ref!, "$record.payload.capability_ref")), nul,
    grant, nul, asset, nul, source,
  ];
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return `sha256:${bytesToHex(sha256Bytes(bytes))}`;
}

export function witnessPayloadRoot<K extends WitnessKind>(
  recordKind: K,
  recordAction: AllowedAction<K>,
  payload: unknown,
): Sha256Id {
  if (
    typeof recordKind !== "string"
    || !(WITNESS_KINDS as readonly string[]).includes(recordKind)
  ) {
    invalid("Unsupported WITNESS kind.", "$kind");
  }
  const permitted = ALLOWED_ACTIONS[recordKind] as readonly string[];
  if (typeof recordAction !== "string" || !permitted.includes(recordAction)) {
    invalid("Unsupported WITNESS kind/action pair.", "$action");
  }
  return scopedHash(`payload/${recordKind}/${recordAction}`, payload);
}

export function witnessCommitment(envelope: unknown): Sha256Id {
  return scopedHash("envelope", envelope);
}

function validateEnvelope(value: WitnessJsonValue, payloadValue: WitnessJsonValue): WitnessEnvelope {
  const envelope = object(value, "$record.envelope");
  exactKeys(envelope, [
    "protocol", "kind", "action", "audience", "subject_ref", "sequence", "parent",
    "issuer", "schema_hash", "payload_root", "policy_digest", "expiry_height",
    "effects", "nonclaims",
  ], "$record.envelope");
  if (envelope.protocol !== WITNESS_PROTOCOL) invalid("WITNESS protocol mismatch.", "$record.envelope.protocol");
  const recordKind = kind(envelope.kind!);
  const recordAction = action(recordKind, envelope.action!);
  const audience = string(envelope.audience!, "$record.envelope.audience");
  if (!/^[a-z][a-z0-9.-]{0,31}:[a-z0-9][a-z0-9._-]{0,95}$/u.test(audience)) {
    invalid("Invalid WITNESS audience.", "$record.envelope.audience");
  }
  ref(envelope.subject_ref!, "$record.envelope.subject_ref");
  const sequence = decimal(envelope.sequence!, "$record.envelope.sequence", false);
  if (sequence === "1") {
    if (envelope.parent !== null) invalid("parent must be null at sequence 1.", "$record.envelope.parent");
  } else {
    digest(envelope.parent!, "$record.envelope.parent");
  }
  const issuer = object(envelope.issuer!, "$record.envelope.issuer");
  exactKeys(issuer, ["namespace", "controller_ref", "key_fingerprint"], "$record.envelope.issuer");
  if (!/^[a-z][a-z0-9.-]{0,63}$/u.test(string(issuer.namespace!, "$record.envelope.issuer.namespace"))) {
    invalid("Invalid WITNESS issuer namespace.", "$record.envelope.issuer.namespace");
  }
  ref(issuer.controller_ref!, "$record.envelope.issuer.controller_ref");
  if (!/^ed25519-sha256:[0-9a-f]{64}$/u.test(string(issuer.key_fingerprint!, "$record.envelope.issuer.key_fingerprint"))) {
    invalid("Invalid WITNESS issuer key fingerprint.", "$record.envelope.issuer.key_fingerprint");
  }
  const schemaHash = digest(envelope.schema_hash!, "$record.envelope.schema_hash");
  if (schemaHash !== EXPECTED_SCHEMA_HASHES[recordKind]) {
    invalid("Payload schema hash mismatch.", "$record.envelope.schema_hash");
  }
  const payload = validatePayloadShape(recordKind, recordAction, payloadValue);
  validatePayloadSemantics(envelope, recordKind, recordAction, payload);
  if (digest(envelope.payload_root!, "$record.envelope.payload_root") !== witnessPayloadRoot(recordKind, recordAction, payload)) {
    invalid("Payload root mismatch.", "$record.envelope.payload_root");
  }
  digest(envelope.policy_digest!, "$record.envelope.policy_digest");
  if (envelope.expiry_height !== null) decimal(envelope.expiry_height!, "$record.envelope.expiry_height", false);
  if (witnessCanonicalJson(envelope.effects) !== witnessCanonicalJson(ZERO_EFFECTS)) {
    invalid("effects must be the exact offline zero-effect object.", "$record.envelope.effects");
  }
  if (witnessCanonicalJson(envelope.nonclaims) !== witnessCanonicalJson(REQUIRED_NONCLAIMS)) {
    invalid("nonclaims must be the exact ordered required set.", "$record.envelope.nonclaims");
  }
  return envelope as unknown as WitnessEnvelope;
}

/** Validate an already materialized in-memory object. This cannot recover wire
 * properties lost by a prior JSON parser; external records must use the byte
 * entrypoint below. */
export function verifyWitnessRecordObject(value: unknown): VerifiedWitnessRecord {
  const snapshot = snapshotWitnessJsonData(value);
  const record = object(snapshot, "$record");
  exactKeys(record, ["envelope", "payload", "commitment", "signature"], "$record");
  const envelope = validateEnvelope(record.envelope!, record.payload!);
  const commitment = digest(record.commitment!, "$record.commitment");
  if (commitment !== witnessCommitment(envelope)) {
    throw new WitnessProjectionError("COMMITMENT_MISMATCH", "WITNESS envelope commitment mismatch.");
  }
  const signature = object(record.signature!, "$record.signature");
  exactKeys(signature, ["algorithm", "public_key", "value"], "$record.signature");
  if (signature.algorithm !== "Ed25519") invalid("signature.algorithm must be Ed25519.", "$record.signature.algorithm");
  const publicKey = ref(signature.public_key!, "$record.signature.public_key");
  const signatureValue = string(signature.value!, "$record.signature.value");
  if (!/^[0-9a-f]{128}$/u.test(signatureValue)) invalid("Invalid Ed25519 signature hex.", "$record.signature.value");
  if (ed25519Fingerprint(publicKey) !== envelope.issuer.key_fingerprint) {
    throw new WitnessProjectionError("SIGNER_MISMATCH", "WITNESS signature key does not match issuer fingerprint.");
  }
  if (!strictEd25519Verify(
    hexToBytes(signatureValue, 64),
    hexToBytes(commitment.slice(7), 32),
    hexToBytes(publicKey, 32),
  )) {
    throw new WitnessProjectionError("SIGNATURE_INVALID", "WITNESS commitment signature is invalid.");
  }
  encodeWitnessCanonicalJson(record);
  return deepFreeze(record) as unknown as VerifiedWitnessRecord;
}

export function verifyWitnessRecordBytes(bytes: Uint8Array): VerifiedWitnessRecord {
  return verifyWitnessRecordObject(decodeWitnessCanonicalJson(bytes));
}

export interface CreateWitnessRecordInput<K extends WitnessKind> {
  kind: K;
  action: AllowedAction<K>;
  audience: string;
  subject_ref: string;
  sequence: string;
  parent: Sha256Id | null;
  issuer: Omit<WitnessIssuer, "key_fingerprint">;
  policy_digest: Sha256Id;
  expiry_height: string | null;
  payload: unknown;
  signer: HexEd25519Signer;
}

const CREATE_INPUT_KEYS = [
  "kind", "action", "audience", "subject_ref", "sequence", "parent", "issuer",
  "policy_digest", "expiry_height", "payload", "signer",
] as const;

function inspectCreateInput<K extends WitnessKind>(
  value: CreateWitnessRecordInput<K>,
): CreateWitnessRecordInput<K> {
  if (value === null || typeof value !== "object" || isProxy(value)) {
    invalid("createWitnessRecord input must be a non-proxy plain object.", "$create");
  }
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return invalid("createWitnessRecord input could not be safely inspected.", "$create");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    invalid("createWitnessRecord input must be a plain object.", "$create");
  }
  const actual = keys.map((key) => typeof key === "string"
    ? key
    : invalid("Symbol input fields are forbidden.", "$create")).sort();
  const expected = [...CREATE_INPUT_KEYS].sort();
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    invalid(`createWitnessRecord input must contain exactly ${expected.join(", ")}.`, "$create");
  }
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of CREATE_INPUT_KEYS) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return invalid(`$create.${key} could not be safely inspected.`, `$create.${key}`);
    }
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      invalid(`$create.${key} must be an enumerable data property.`, `$create.${key}`);
    }
    output[key] = key === "signer"
      ? validateHexEd25519Signer(descriptor.value)
      : snapshotWitnessJsonData(descriptor.value);
  }
  return output as unknown as CreateWitnessRecordInput<K>;
}

export async function createWitnessRecord<K extends WitnessKind>(
  inputValue: CreateWitnessRecordInput<K>,
): Promise<VerifiedWitnessRecord<unknown, K>> {
  const input = inspectCreateInput(inputValue);
  const payload = snapshotWitnessJsonData(input.payload);
  const envelope: WitnessEnvelope<K> = {
    protocol: WITNESS_PROTOCOL,
    kind: input.kind,
    action: input.action,
    audience: input.audience,
    subject_ref: input.subject_ref,
    sequence: input.sequence,
    parent: input.parent,
    issuer: {
      ...input.issuer,
      key_fingerprint: ed25519Fingerprint(input.signer.public_key),
    },
    schema_hash: EXPECTED_SCHEMA_HASHES[input.kind],
    payload_root: witnessPayloadRoot(input.kind, input.action, payload),
    policy_digest: input.policy_digest,
    expiry_height: input.expiry_height,
    effects: ZERO_EFFECTS,
    nonclaims: REQUIRED_NONCLAIMS,
  };
  validateEnvelope(snapshotWitnessJsonData(envelope), payload);
  const commitment = witnessCommitment(envelope);
  const signatureValue = await input.signer.sign_digest(hexToBytes(commitment.slice(7), 32));
  const candidate: WitnessRecord<unknown, K> = {
    envelope,
    payload,
    commitment,
    signature: {
      algorithm: "Ed25519",
      public_key: input.signer.public_key,
      value: signatureValue,
    },
  };
  return verifyWitnessRecordObject(candidate) as VerifiedWitnessRecord<unknown, K>;
}
