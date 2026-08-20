import { strictEd25519Verify } from "@agenttool/public-surface-binding";

import {
  LIMITS,
  HASH_DOMAINS,
  MAX_UINT64,
  SETTLEMENT_LEAF_BOUNDARIES,
  SOURCE_SCHEMAS,
} from "./constants.js";
import { WitnessProjectionError, invalid } from "./errors.js";
import {
  agentToolSourceHash,
  concatBytes,
  ed25519Fingerprint,
  hexToBytes,
  sha256Bytes,
  sha256Id,
} from "./hash.js";
import {
  base64,
  canonicalInstant,
  exactKeys,
  exactString,
  hex,
  nonEmptyString,
  nullableCanonicalInstant,
  snapshotInputWrapper,
  snapshotObject,
  unsignedDecimal,
  uuid,
  validated,
  type JsonValue,
} from "./internal.js";
import {
  RFC6962_MERKLE_ALGORITHM,
  SETTLEMENT_LEAF_DOMAIN,
  rfc6962MerkleRootHex,
} from "./merkle.js";
import type {
  SettlementBatchProjection,
  SettlementActivationBoundary,
  SettlementLeaf,
  SettlementReceiptSource,
  SettlementSequenceGap,
} from "./types.js";

export const SETTLEMENT_RECEIPT_PROTOCOL = "settlement-receipt/v1" as const;
export const SETTLEMENT_RECEIPT_FIELDS = Object.freeze([
  "invocation_id",
  "listing_id",
  "seller_did",
  "buyer_ref",
  "amount_gross",
  "platform_fee",
  "amount_net",
  "currency",
  "take_rate_bps",
  "output_digest_hex",
  "completion_sig_b64",
  "seller_public_key_b64",
  "sla_deadline_at",
  "acknowledged_at",
  "settled_at",
] as const);

export const SETTLEMENT_RECEIPT_SCHEMA_DESCRIPTOR = Object.freeze({
  protocol: SETTLEMENT_RECEIPT_PROTOCOL,
  recipe: "SHA256_UTF8_DOMAIN_NUL_FIELDS",
  recipe_ordinal: "1",
  fields: SETTLEMENT_RECEIPT_FIELDS,
  numeric_encoding: "CANONICAL_UNSIGNED_DECIMAL",
  absent_buyer_ref: "EMPTY_STRING",
  absent_timestamp: "EMPTY_STRING",
  buyer_reference: "HMAC_SHA256_OR_EMPTY",
} as const);

export const SETTLEMENT_RECEIPT_SCHEMA_DIGEST = agentToolSourceHash(
  HASH_DOMAINS.settlement_receipt_schema,
  SETTLEMENT_RECEIPT_SCHEMA_DESCRIPTOR,
);

const utf8 = new TextEncoder();
const NUL = new Uint8Array([0]);

function validateDid(value: JsonValue, path: string): string {
  const did = nonEmptyString(value, path, 512);
  if (!/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/u.test(did)) {
    invalid(`${path} must be a bounded DID string.`, path);
  }
  return did;
}

function validateBuyerRef(value: JsonValue, path: string): string {
  if (value === "") return "";
  return hex(value, 32, path);
}

function validateCurrency(value: JsonValue, path: string): string {
  const currency = nonEmptyString(value, path, 12);
  if (!/^[A-Z][A-Z0-9]{2,11}$/u.test(currency)) {
    invalid(`${path} must be an uppercase currency token.`, path);
  }
  return currency;
}

function nullableBase64(value: JsonValue, expectedBytes: number, path: string): string | null {
  return value === null ? null : base64(value, expectedBytes, path);
}

function nullableHex(value: JsonValue, expectedBytes: number, path: string): string | null {
  return value === null ? null : hex(value, expectedBytes, path);
}

function canonicalSettlementReceiptDigestFromValidated(
  source: Readonly<SettlementReceiptSource>,
): Uint8Array {
  const values = [
    source.invocation_id,
    source.listing_id,
    source.seller_did,
    source.buyer_ref,
    source.amount_gross,
    source.platform_fee,
    source.amount_net,
    source.currency,
    source.take_rate_bps,
    source.output_digest_hex,
    source.completion_sig_b64,
    source.seller_public_key_b64,
    source.sla_deadline_at,
    source.acknowledged_at,
    source.settled_at,
  ];
  const parts: Uint8Array[] = [utf8.encode(SETTLEMENT_RECEIPT_PROTOCOL)];
  for (const value of values) parts.push(NUL, utf8.encode(value));
  return sha256Bytes(concatBytes(...parts));
}

export function canonicalSettlementReceiptDigest(source: Readonly<SettlementReceiptSource>): Uint8Array {
  return canonicalSettlementReceiptDigestFromValidated(
    validateSettlementReceiptSourceInternal(source, false),
  );
}

function validateSettlementReceiptSourceInternal(
  value: unknown,
  verifySelfBinding: boolean,
): Readonly<SettlementReceiptSource> {
  const record = snapshotObject(value, "$settlement_receipt");
  exactKeys(record, [
    "sequence", "invocation_id", "listing_id", "seller_did", "buyer_ref",
    "amount_gross", "platform_fee", "amount_net", "currency", "take_rate_bps",
    "output_digest_hex", "completion_sig_b64", "seller_public_key_b64",
    "sla_deadline_at", "acknowledged_at", "settled_at", "receipt_digest_hex",
    "platform_sig_b64", "platform_key_hex",
  ], "$settlement_receipt");
  unsignedDecimal(record.sequence!, "$settlement_receipt.sequence", { minimum: 1n });
  uuid(record.invocation_id!, "$settlement_receipt.invocation_id");
  uuid(record.listing_id!, "$settlement_receipt.listing_id");
  validateDid(record.seller_did!, "$settlement_receipt.seller_did");
  validateBuyerRef(record.buyer_ref!, "$settlement_receipt.buyer_ref");
  const gross = unsignedDecimal(record.amount_gross!, "$settlement_receipt.amount_gross");
  const fee = unsignedDecimal(record.platform_fee!, "$settlement_receipt.platform_fee");
  const net = unsignedDecimal(record.amount_net!, "$settlement_receipt.amount_net");
  if (BigInt(fee) + BigInt(net) !== BigInt(gross)) {
    invalid("Settlement gross must equal platform fee plus net amount.", "$settlement_receipt.amount_gross");
  }
  validateCurrency(record.currency!, "$settlement_receipt.currency");
  unsignedDecimal(record.take_rate_bps!, "$settlement_receipt.take_rate_bps", { maximum: 10_000n });
  hex(record.output_digest_hex!, 32, "$settlement_receipt.output_digest_hex");
  base64(record.completion_sig_b64!, 64, "$settlement_receipt.completion_sig_b64");
  base64(record.seller_public_key_b64!, 32, "$settlement_receipt.seller_public_key_b64");
  nullableCanonicalInstant(record.sla_deadline_at!, "$settlement_receipt.sla_deadline_at");
  nullableCanonicalInstant(record.acknowledged_at!, "$settlement_receipt.acknowledged_at");
  canonicalInstant(record.settled_at!, "$settlement_receipt.settled_at");
  const receiptDigestHex = hex(record.receipt_digest_hex!, 32, "$settlement_receipt.receipt_digest_hex");
  const signature = nullableBase64(record.platform_sig_b64!, 64, "$settlement_receipt.platform_sig_b64");
  const publicKey = nullableHex(record.platform_key_hex!, 32, "$settlement_receipt.platform_key_hex");
  if ((signature === null) !== (publicKey === null)) {
    invalid("Platform signature and key must both be present or both be null.", "$settlement_receipt.platform_sig_b64");
  }
  const candidate = validated<SettlementReceiptSource>(record);
  const canonical = canonicalSettlementReceiptDigestFromValidated(candidate);
  if (verifySelfBinding && Buffer.from(canonical).toString("hex") !== receiptDigestHex) {
    invalid("receipt_digest_hex does not match the exact settlement-receipt/v1 canonical bytes.", "$settlement_receipt.receipt_digest_hex");
  }
  if (
    verifySelfBinding
    && signature !== null
    && publicKey !== null
    && !strictEd25519Verify(
      Uint8Array.from(Buffer.from(signature, "base64")),
      canonical,
      hexToBytes(publicKey, 32),
    )
  ) {
    throw new WitnessProjectionError("SIGNATURE_INVALID", "Settlement platform signature is invalid.", {
      path: "$settlement_receipt.platform_sig_b64",
    });
  }
  return candidate;
}

export function validateSettlementReceiptSource(value: unknown): Readonly<SettlementReceiptSource> {
  return validateSettlementReceiptSourceInternal(value, true);
}

function assertSettlementBoundaries(value: JsonValue): void {
  const record = snapshotObject(value, "$settlement_leaf.boundaries");
  exactKeys(record, Object.keys(SETTLEMENT_LEAF_BOUNDARIES), "$settlement_leaf.boundaries");
  for (const [key, expected] of Object.entries(SETTLEMENT_LEAF_BOUNDARIES)) {
    if (record[key] !== expected) invalid(`Settlement boundary ${key} changed.`, `$settlement_leaf.boundaries.${key}`);
  }
}

export interface SettlementLeafOptions {
  /** Independently pinned by the caller from AgentTool controller policy. The
   * receipt cannot establish this key's authority by self-signing itself. */
  independently_pinned_platform_key_hex?: string;
}

export function createSettlementLeaf(
  value: unknown,
  optionsValue: SettlementLeafOptions = {},
): Readonly<SettlementLeaf> {
  const options = snapshotObject(optionsValue, "$settlement_leaf.options");
  const optionKeys = Object.keys(options);
  if (
    optionKeys.length > 1
    || (optionKeys.length === 1 && optionKeys[0] !== "independently_pinned_platform_key_hex")
  ) {
    invalid(
      "$settlement_leaf.options may contain only independently_pinned_platform_key_hex.",
      "$settlement_leaf.options",
    );
  }
  const source = validateSettlementReceiptSource(value);
  const pinnedKey = options.independently_pinned_platform_key_hex === undefined
    ? null
    : hex(
      options.independently_pinned_platform_key_hex as unknown as JsonValue,
      32,
      "$settlement_leaf.independently_pinned_platform_key_hex",
    );
  if (pinnedKey !== null) {
    if (source.platform_key_hex === null || source.platform_sig_b64 === null) {
      throw new WitnessProjectionError(
        "SOURCE_RECORD_INVALID",
        "A pinned-key settlement leaf requires the source platform signature and key.",
      );
    }
    if (source.platform_key_hex !== pinnedKey) {
      throw new WitnessProjectionError(
        "SIGNER_MISMATCH",
        "Settlement receipt key does not match the independently pinned platform key.",
        { path: "$settlement_receipt.platform_key_hex" },
      );
    }
  }
  const signatureBytes = source.platform_sig_b64 === null
    ? null
    : Uint8Array.from(Buffer.from(source.platform_sig_b64, "base64"));
  const leaf: SettlementLeaf = {
    schema: SOURCE_SCHEMAS.settlement_leaf,
    sequence: source.sequence,
    invocation_id: source.invocation_id,
    receipt_digest: `sha256:${source.receipt_digest_hex}`,
    buyer_ref: source.buyer_ref,
    platform_signature_state: pinnedKey !== null
      ? "PIN_MATCH_VALID"
      : source.platform_sig_b64 === null
        ? "ABSENT"
        : "UNTRUSTED_KEY_VALID",
    projection_class: pinnedKey === null ? "UNTRUSTED_SHADOW" : "PINNED_KEY_SHADOW",
    platform_key_fingerprint: source.platform_key_hex === null
      ? null
      : ed25519Fingerprint(source.platform_key_hex),
    platform_signature_digest: signatureBytes === null ? null : sha256Id(signatureBytes),
    boundaries: SETTLEMENT_LEAF_BOUNDARIES,
  };
  assertSettlementBoundaries(leaf.boundaries as unknown as JsonValue);
  return validated<SettlementLeaf>(snapshotObject(leaf, "$settlement_leaf"));
}

export interface SettlementBatchInput {
  receipts: readonly unknown[];
  /** Required for a shared settlement-root projection. It must come from an
   * independent AgentTool controller policy, not from any receipt in the batch. */
  independently_pinned_platform_key_hex: string;
  previous_batch: {
    commitment: `sha256:${string}`;
    last_sequence: string;
  } | null;
}

export const SETTLEMENT_ACTIVATION_BOUNDARY: SettlementActivationBoundary = Object.freeze({
  status: "OUTSIDE_ACTIVATION",
  consensus_admissible: false,
  blocker: "AUTHENTICATED_SOURCE_ORDER_AND_CROSS_BATCH_REPLAY_PROOF_REQUIRED",
});

function appendGap(gaps: SettlementSequenceGap[], first: bigint, last: bigint): void {
  if (first <= last) gaps.push({ first: first.toString(), last: last.toString() });
}

export function createSettlementBatchProjection(
  inputValue: SettlementBatchInput,
): Readonly<{
  payload: SettlementBatchProjection;
  leaves: readonly Readonly<SettlementLeaf>[];
  activation: SettlementActivationBoundary;
}> {
  const input = snapshotInputWrapper(
    inputValue,
    "$batch",
    ["receipts", "independently_pinned_platform_key_hex", "previous_batch"],
    ["receipts"],
  );
  if (!Array.isArray(input.receipts) || input.receipts.length === 0) {
    invalid("A settlement checkpoint requires at least one receipt.", "$batch.receipts");
  }
  if (input.receipts.length > LIMITS.max_settlement_batch_receipts) {
    invalid(`Settlement batch exceeds ${LIMITS.max_settlement_batch_receipts} receipts.`, "$batch.receipts");
  }
  const pinnedKey = hex(
    input.independently_pinned_platform_key_hex as unknown as JsonValue,
    32,
    "$batch.independently_pinned_platform_key_hex",
  );
  const leaves = input.receipts.map((receipt) => createSettlementLeaf(receipt, {
    independently_pinned_platform_key_hex: pinnedKey,
  }));
  const seenInvocations = new Set<string>();
  const seenDigests = new Set<string>();
  let previousSequence: bigint | null = null;
  for (const [index, leaf] of leaves.entries()) {
    const sequence = BigInt(leaf.sequence);
    if (previousSequence !== null && sequence <= previousSequence) {
      invalid("Settlement receipts must be strictly increasing by sequence.", `$batch.receipts[${index}].sequence`);
    }
    if (seenInvocations.has(leaf.invocation_id) || seenDigests.has(leaf.receipt_digest)) {
      invalid("Settlement batch contains a duplicate invocation or canonical receipt digest.", `$batch.receipts[${index}]`);
    }
    previousSequence = sequence;
    seenInvocations.add(leaf.invocation_id);
    seenDigests.add(leaf.receipt_digest);
  }

  let priorCommitment: `sha256:${string}` | null = null;
  let expected = 1n;
  if (input.previous_batch !== null) {
    const previousBatch = snapshotObject(input.previous_batch, "$batch.previous_batch");
    exactKeys(previousBatch, ["commitment", "last_sequence"], "$batch.previous_batch");
    if (typeof previousBatch.commitment !== "string") {
      invalid("previous_batch.commitment must be a string.", "$batch.previous_batch.commitment");
    }
    priorCommitment = previousBatch.commitment as `sha256:${string}`;
    if (!/^sha256:[0-9a-f]{64}$/u.test(priorCommitment)) {
      invalid("previous_batch.commitment must be a canonical sha256 identifier.", "$batch.previous_batch.commitment");
    }
    const priorLast = BigInt(unsignedDecimal(
      previousBatch.last_sequence!,
      "$batch.previous_batch.last_sequence",
      { minimum: 1n },
    ));
    if (priorLast === MAX_UINT64) {
      invalid("A settlement batch cannot extend beyond the uint64 sequence ceiling.", "$batch.previous_batch.last_sequence");
    }
    expected = priorLast + 1n;
  }
  const first = BigInt(leaves[0]!.sequence);
  if (first < expected) {
    invalid("Settlement batch overlaps or precedes its declared prior batch.", "$batch.receipts[0].sequence");
  }
  const gaps: SettlementSequenceGap[] = [];
  appendGap(gaps, expected, first - 1n);
  for (let index = 1; index < leaves.length; index += 1) {
    const left = BigInt(leaves[index - 1]!.sequence);
    const right = BigInt(leaves[index]!.sequence);
    appendGap(gaps, left + 1n, right - 1n);
  }

  const payload: SettlementBatchProjection = {
    // settlement-receipt/v1 does not sign the database sequence and this pure
    // package has no global replay set. These constants are consensus-critical
    // honesty: the root is an offline shadow checkpoint only.
    source_sequence_binding: "PROJECTION_ONLY",
    receipt_uniqueness_scope: "BATCH_ONLY",
    // The checkpoint range begins at the first sequence after the preceding
    // checkpoint (or 1 at genesis), even when that position is a declared
    // bigserial gap. This makes omissions across batch boundaries visible.
    first_sequence: expected.toString(),
    last_sequence: leaves[leaves.length - 1]!.sequence,
    receipt_count: leaves.length.toString(),
    declared_gaps: gaps,
    // Core WITNESS leaves stay deliberately tiny. The exact canonical receipt
    // digest already commits every signed source field, including buyer_ref;
    // the richer validated evidence leaf is returned off-chain beside this
    // portable two-field Merkle input.
    merkle_root: `sha256:${rfc6962MerkleRootHex(leaves.map(({ sequence, receipt_digest }) => ({
      sequence,
      receipt_digest,
    })))}`,
    previous_batch: priorCommitment,
    receipt_protocol: SETTLEMENT_RECEIPT_PROTOCOL,
    receipt_schema_digest: SETTLEMENT_RECEIPT_SCHEMA_DIGEST,
  };
  return Object.freeze({
    payload: validated<SettlementBatchProjection>(snapshotObject(payload, "$batch.payload")),
    leaves: Object.freeze(leaves),
    activation: SETTLEMENT_ACTIVATION_BOUNDARY,
  });
}

export const SETTLEMENT_MERKLE_PROFILE = Object.freeze({
  algorithm: RFC6962_MERKLE_ALGORITHM,
  domain: SETTLEMENT_LEAF_DOMAIN,
  leaf: "SHA256(0x00 || protocol || NUL || settlement-leaf || NUL || canonical_json(leaf))",
  node: "SHA256(0x01 || left || right)",
  empty: "SHA256(empty)",
} as const);
