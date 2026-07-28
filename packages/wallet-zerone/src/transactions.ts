import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  assertAuthorizedIntent,
  assertSignedPayloadMatchesRequest,
  assertVerifiedRecord,
  base64UrlDecode,
  base64UrlEncode,
  bytesToHex,
  concatBytes,
  createSigningRequest,
  equalBytes,
  sha256BytesId,
  type SignedPayload,
  type SimulationEffect,
  type SimulationReceipt,
  type SimulationReceiptCore,
  type Verified,
} from "@agenttool/wallet";

import {
  AGENTTOOL_ADAPTER_ID,
  AGENTTOOL_WORK_CLASS_ID,
  COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL,
  ZERONE_ADAPTER_PROTOCOL,
  ZERONE_CORE_COMMIT,
  ZERONE_DENOM,
  ZERONE_DIRECT_SIGN_ALGORITHM,
  ZERONE_LIMITS,
  ZERONE_MSG_SEND_TYPE_URL,
  ZERONE_MSG_SUBMIT_EXTERNAL_ATTESTATION_TYPE_URL,
  ZERONE_WALLET_METHOD_SUBMIT_EXTERNAL_ATTESTATION,
} from "./constants.js";
import { ZeroneAdapterError, invalid, mismatch } from "./errors.js";
import {
  decodeZeroneMsgSubmitExternalAttestation,
  encodeZeroneMsgSend,
} from "./messages.js";
import {
  addressFromZeroneAccountId,
  assertSecp256k1PublicKey,
  assertZeroneAccountId,
  describeZeronePublicKey,
  getZeroneProfile,
} from "./profiles.js";
import type {
  CreateZeroneDirectSignPlanInput,
  CreateZeroneSimulationBindingInput,
  CreateZeroneSignedPayloadInput,
  CreateZeroneSigningRequestInput,
  ZeroneAdapterSnapshot,
  ZeroneAllowedMessage,
  ZeroneCoin,
  ZeroneDirectSignPlan,
  ZeroneMsgSend,
  ZeroneNetwork,
  ZeroneSimulationReceiptInput,
  ZeroneSimulationBinding,
  VerifiedZeroneTransaction,
} from "./types.js";
import {
  assertAtomicAmount,
  assertBoundedText,
  assertIdentifier,
  assertSafeCode,
  assertUint64,
  freezeArray,
} from "./validation.js";
import {
  assertCanonicalProtobuf,
  bytesField,
  decodeFields,
  decodeUtf8,
  requireBytesField,
  requireUintField,
  stringField,
  uintField,
  type WireField,
} from "./wire.js";

const directSignPlans = new WeakSet<object>();
const verifiedTransactions = new WeakSet<object>();
const simulationBindings = new WeakMap<
  object,
  Readonly<{
    plan: ZeroneDirectSignPlan;
    simulation: Verified<SimulationReceipt>;
  }>
>();
const zeroneSigningRequests = new WeakMap<
  object,
  Readonly<{
    plan: ZeroneDirectSignPlan;
    binding: ZeroneSimulationBinding;
    simulation: Verified<SimulationReceipt>;
  }>
>();

interface ProtoAny {
  readonly typeUrl: string;
  readonly value: Uint8Array;
}

interface DecodedAuthInfo {
  readonly publicKey: Uint8Array;
  readonly sequence: string;
  readonly feeAmount: string;
  readonly gasLimit: string;
}

interface DecodedTxRaw {
  readonly bodyBytes: Uint8Array;
  readonly authInfoBytes: Uint8Array;
  readonly signature: Uint8Array;
}

function assertFieldSequence(
  fields: readonly WireField[],
  expected: readonly number[],
  path: string,
): void {
  if (
    fields.length !== expected.length
    || fields.some((field, index) => field.number !== expected[index])
  ) {
    invalid(`${path} has unsupported, missing, duplicated, or reordered protobuf fields.`, path);
  }
}

function encodeCoin(coin: ZeroneCoin): Uint8Array {
  if (coin.denom !== ZERONE_DENOM) {
    invalid("Transaction fee supports only uzrn.", "fee.denom");
  }
  assertAtomicAmount(coin.amount, "fee.amount");
  return concatBytes(
    stringField(1, coin.denom),
    stringField(2, coin.amount),
  );
}

function decodeCoin(bytes: Uint8Array, path: string): ZeroneCoin {
  const fields = decodeFields(bytes);
  assertFieldSequence(fields, [1, 2], path);
  const denom = decodeUtf8(requireBytesField(fields[0], 1, `${path}.denom`), `${path}.denom`);
  const amount = decodeUtf8(requireBytesField(fields[1], 2, `${path}.amount`), `${path}.amount`);
  if (denom !== ZERONE_DENOM) invalid(`${path}.denom must be uzrn.`, `${path}.denom`);
  assertAtomicAmount(amount, `${path}.amount`);
  const coin: ZeroneCoin = Object.freeze({ denom: ZERONE_DENOM, amount });
  assertCanonicalProtobuf(bytes, encodeCoin(coin), path);
  return coin;
}

function encodeAny(value: ProtoAny): Uint8Array {
  assertBoundedText(value.typeUrl, "any.type_url", 256);
  if (!value.typeUrl.startsWith("/")) {
    invalid("Any type URL must start with '/'.", "any.type_url");
  }
  return concatBytes(
    stringField(1, value.typeUrl),
    bytesField(2, value.value),
  );
}

function decodeAny(bytes: Uint8Array, path: string): ProtoAny {
  const fields = decodeFields(bytes);
  assertFieldSequence(fields, [1, 2], path);
  const typeUrl = decodeUtf8(
    requireBytesField(fields[0], 1, `${path}.type_url`),
    `${path}.type_url`,
  );
  const value = requireBytesField(fields[1], 2, `${path}.value`);
  const any = Object.freeze({ typeUrl, value });
  assertCanonicalProtobuf(bytes, encodeAny(any), path);
  return any;
}

function encodePublicKey(publicKey: Uint8Array): Uint8Array {
  assertSecp256k1PublicKey(publicKey);
  return bytesField(1, publicKey);
}

function decodePublicKey(bytes: Uint8Array): Uint8Array {
  const fields = decodeFields(bytes);
  assertFieldSequence(fields, [1], "public_key");
  const publicKey = requireBytesField(fields[0], 1, "public_key.key");
  assertSecp256k1PublicKey(publicKey);
  assertCanonicalProtobuf(bytes, encodePublicKey(publicKey), "public_key");
  return publicKey;
}

function encodeTxBody(messages: readonly ProtoAny[]): Uint8Array {
  return concatBytes(
    ...messages.map((message) => bytesField(1, encodeAny(message))),
    // Memo, timeout height, and extension options are intentionally omitted.
  );
}

function encodeModeInfoDirect(): Uint8Array {
  // ModeInfo.single = field 1; ModeInfo.Single.mode = SIGN_MODE_DIRECT (1).
  return bytesField(1, uintField(1, 1n));
}

function encodeSignerInfo(
  publicKey: Uint8Array,
  sequence: bigint,
): Uint8Array {
  return concatBytes(
    bytesField(1, encodeAny({
      typeUrl: COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL,
      value: encodePublicKey(publicKey),
    })),
    bytesField(2, encodeModeInfoDirect()),
    uintField(3, sequence),
  );
}

function encodeFee(fee: ZeroneCoin, gasLimit: bigint): Uint8Array {
  return concatBytes(
    bytesField(1, encodeCoin(fee)),
    uintField(2, gasLimit),
    // fee payer and granter are intentionally omitted.
  );
}

function encodeAuthInfo(
  publicKey: Uint8Array,
  sequence: bigint,
  fee: ZeroneCoin,
  gasLimit: bigint,
): Uint8Array {
  return concatBytes(
    bytesField(1, encodeSignerInfo(publicKey, sequence)),
    bytesField(2, encodeFee(fee, gasLimit)),
  );
}

function decodeAuthInfo(bytes: Uint8Array): DecodedAuthInfo {
  const fields = decodeFields(bytes);
  assertFieldSequence(fields, [1, 2], "auth_info");

  const signerBytes = requireBytesField(fields[0], 1, "auth_info.signer_infos[0]");
  const signerFields = decodeFields(signerBytes);
  const signerExpected = signerFields.at(-1)?.number === 3 ? [1, 2, 3] : [1, 2];
  assertFieldSequence(signerFields, signerExpected, "signer_info");

  const publicKeyAny = decodeAny(
    requireBytesField(signerFields[0], 1, "signer_info.public_key"),
    "signer_info.public_key",
  );
  if (publicKeyAny.typeUrl !== COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL) {
    invalid("SignerInfo must contain a Cosmos secp256k1 public key.", "signer_info.public_key.type_url");
  }
  const publicKey = decodePublicKey(publicKeyAny.value);

  const modeInfoBytes = requireBytesField(
    signerFields[1],
    2,
    "signer_info.mode_info",
  );
  const modeInfoFields = decodeFields(modeInfoBytes);
  assertFieldSequence(modeInfoFields, [1], "mode_info");
  const singleBytes = requireBytesField(modeInfoFields[0], 1, "mode_info.single");
  const singleFields = decodeFields(singleBytes);
  assertFieldSequence(singleFields, [1], "mode_info.single");
  if (requireUintField(singleFields[0], 1, "mode_info.single.mode") !== 1n) {
    invalid("Only SIGN_MODE_DIRECT is supported.", "mode_info.single.mode");
  }
  const sequence = signerFields.length === 3
    ? requireUintField(signerFields[2], 3, "signer_info.sequence")
    : 0n;

  const feeBytes = requireBytesField(fields[1], 2, "auth_info.fee");
  const feeFields = decodeFields(feeBytes);
  const feeExpected = feeFields.at(-1)?.number === 2 ? [1, 2] : [1];
  assertFieldSequence(feeFields, feeExpected, "fee");
  const fee = decodeCoin(
    requireBytesField(feeFields[0], 1, "fee.amount[0]"),
    "fee.amount[0]",
  );
  const gasLimit = feeFields.length === 2
    ? requireUintField(feeFields[1], 2, "fee.gas_limit")
    : 0n;

  assertCanonicalProtobuf(
    bytes,
    encodeAuthInfo(publicKey, sequence, fee, gasLimit),
    "auth_info",
  );
  return Object.freeze({
    publicKey,
    sequence: sequence.toString(),
    feeAmount: fee.amount,
    gasLimit: gasLimit.toString(),
  });
}

function encodeSignDoc(
  bodyBytes: Uint8Array,
  authInfoBytes: Uint8Array,
  chainReference: string,
  accountNumber: bigint,
): Uint8Array {
  return concatBytes(
    bytesField(1, bodyBytes),
    bytesField(2, authInfoBytes),
    stringField(3, chainReference),
    uintField(4, accountNumber),
  );
}

function encodeTxRaw(
  bodyBytes: Uint8Array,
  authInfoBytes: Uint8Array,
  signature: Uint8Array,
): Uint8Array {
  return concatBytes(
    bytesField(1, bodyBytes),
    bytesField(2, authInfoBytes),
    // A repeated bytes element is encoded even when empty for simulation.
    bytesField(3, signature, { emitEmpty: true }),
  );
}

function decodeTxRaw(bytes: Uint8Array): DecodedTxRaw {
  const fields = decodeFields(bytes);
  assertFieldSequence(fields, [1, 2, 3], "tx_raw");
  const value = Object.freeze({
    bodyBytes: requireBytesField(fields[0], 1, "tx_raw.body_bytes"),
    authInfoBytes: requireBytesField(fields[1], 2, "tx_raw.auth_info_bytes"),
    signature: requireBytesField(fields[2], 3, "tx_raw.signatures[0]"),
  });
  assertCanonicalProtobuf(
    bytes,
    encodeTxRaw(value.bodyBytes, value.authInfoBytes, value.signature),
    "tx_raw",
  );
  return value;
}

function validateAdapterSnapshot(
  snapshot: ZeroneAdapterSnapshot,
  chainId: string,
  bondUzrn: string,
  fetchedAtHeight: string,
): void {
  if (
    snapshot.chain_id !== chainId
    || snapshot.adapter_id !== AGENTTOOL_ADAPTER_ID
  ) {
    mismatch("Adapter snapshot is not bound to this chain and adapter.");
  }
  assertBoundedText(snapshot.version, "adapter_snapshot.version", 128);
  if (snapshot.status !== "active") {
    throw new ZeroneAdapterError(
      "adapter_inactive",
      "AgentTool attestation adapter is not active in the supplied snapshot.",
    );
  }
  assertAtomicAmount(
    snapshot.min_attestation_bond_uzrn,
    "adapter_snapshot.min_attestation_bond_uzrn",
  );
  assertUint64(
    snapshot.observed_at_height,
    "adapter_snapshot.observed_at_height",
    { positive: true },
  );
  if (
    !Array.isArray(snapshot.allowed_work_class_ids)
    || snapshot.allowed_work_class_ids.length > 64
  ) {
    invalid("Adapter work-class allowlist is invalid.", "adapter_snapshot.allowed_work_class_ids");
  }
  for (const [index, item] of snapshot.allowed_work_class_ids.entries()) {
    assertIdentifier(
      item,
      `adapter_snapshot.allowed_work_class_ids[${index}]`,
    );
  }
  if (
    new Set(snapshot.allowed_work_class_ids).size
      !== snapshot.allowed_work_class_ids.length
  ) {
    invalid(
      "Adapter work-class allowlist must not contain duplicates.",
      "adapter_snapshot.allowed_work_class_ids",
    );
  }
  if (
    snapshot.allowed_work_class_ids.length > 0
    && !snapshot.allowed_work_class_ids.includes(AGENTTOOL_WORK_CLASS_ID)
  ) {
    throw new ZeroneAdapterError(
      "adapter_inactive",
      "Adapter snapshot does not allow the AgentTool invocation work class.",
    );
  }
  if (snapshot.required_qualification_domain !== null) {
    throw new ZeroneAdapterError(
      "adapter_inactive",
      "Adapter qualification proofs are outside the 0.1 package and cannot be assumed.",
    );
  }
  if (BigInt(bondUzrn) < BigInt(snapshot.min_attestation_bond_uzrn)) {
    mismatch("Attestation bond is below the supplied active adapter minimum.");
  }
  if (BigInt(fetchedAtHeight) > BigInt(snapshot.observed_at_height)) {
    mismatch("Attestation source height is newer than its adapter snapshot.");
  }
}

function assertSpendMatches(
  declaredSpends: readonly { readonly asset_id: string; readonly amount_atomic: string }[],
  nativeAssetId: string,
  total: bigint,
): void {
  if (
    declaredSpends.length !== 1
    || declaredSpends[0]?.asset_id !== nativeAssetId
    || BigInt(declaredSpends[0].amount_atomic) !== total
  ) {
    mismatch(
      "Intent declared_spends must exactly equal all MsgSend amounts and attestation bonds.",
      "intent.declared_spends",
    );
  }
}

function bindIntentMessages(
  input: CreateZeroneDirectSignPlanInput,
): Readonly<{
  messages: readonly ZeroneAllowedMessage[];
  protoMessages: readonly ProtoAny[];
  effects: readonly SimulationEffect[];
  adapterSnapshotHeight: string | null;
}> {
  const profile = getZeroneProfile(input.network);
  const sourceAddress = addressFromZeroneAccountId(
    input.intent.source_account as never,
    profile,
  );
  if (input.intent.calls.length > ZERONE_LIMITS.max_messages) {
    invalid(
      `Zerone 0.1 supports at most ${ZERONE_LIMITS.max_messages} messages.`,
      "intent.calls",
    );
  }

  const messages: ZeroneAllowedMessage[] = [];
  const protoMessages: ProtoAny[] = [];
  const effects: SimulationEffect[] = [];
  let totalSpend = 0n;
  let adapterSnapshotHeight: string | null = null;
  let sawAttestation = false;
  const attestationSourceIds = new Set<string>();

  for (const [index, call] of input.intent.calls.entries()) {
    const path = `intent.calls[${index}]`;
    if (call.action === "transfer") {
      assertZeroneAccountId(call.target_account, profile, `${path}.target_account`);
      if (call.native_value === null) {
        mismatch("MsgSend transfer requires exact native_value.", `${path}.native_value`);
      }
      if (call.native_value.asset_id !== profile.native_asset_id) {
        mismatch("MsgSend native_value must use the Zerone uzrn asset profile.", `${path}.native_value`);
      }
      assertAtomicAmount(call.native_value.amount_atomic, `${path}.native_value.amount_atomic`, {
        positive: true,
      });
      const targetAddress = addressFromZeroneAccountId(
        call.target_account as never,
        profile,
      );
      const msg: ZeroneMsgSend = Object.freeze({
        from_address: sourceAddress,
        to_address: targetAddress,
        amount: Object.freeze([Object.freeze({
          denom: ZERONE_DENOM,
          amount: call.native_value.amount_atomic,
        })]) as ZeroneMsgSend["amount"],
      });
      const encoded = encodeZeroneMsgSend(msg);
      const publicMessage = Object.freeze({
        type_url: ZERONE_MSG_SEND_TYPE_URL,
        value_b64u: base64UrlEncode(encoded),
        value_hash: sha256BytesId(encoded),
      });
      messages.push(publicMessage);
      protoMessages.push(Object.freeze({
        typeUrl: ZERONE_MSG_SEND_TYPE_URL,
        value: encoded,
      }));
      effects.push(Object.freeze({
        action: "transfer",
        target_account: call.target_account,
        method: null,
        asset_id: profile.native_asset_id,
        amount_atomic: call.native_value.amount_atomic,
      }));
      totalSpend += BigInt(call.native_value.amount_atomic);
      continue;
    }

    if (
      call.action !== "call"
      || call.method !== ZERONE_WALLET_METHOD_SUBMIT_EXTERNAL_ATTESTATION
    ) {
      throw new ZeroneAdapterError(
        "unsupported_message",
        "Only MsgSend transfers and MsgSubmitExternalAttestation calls are supported.",
        { path },
      );
    }
    sawAttestation = true;
    if (call.target_account !== profile.substrate_bridge_account) {
      mismatch(
        "Attestation target_account must be the deterministic substrate_bridge module account.",
        `${path}.target_account`,
      );
    }
    if (
      call.native_value === null
      || call.native_value.asset_id !== profile.native_asset_id
    ) {
      mismatch("Attestation bond must be exact native_value.", `${path}.native_value`);
    }
    const payload = base64UrlDecode(call.payload_b64u, `${path}.payload_b64u`);
    const msg = decodeZeroneMsgSubmitExternalAttestation(payload);
    if (attestationSourceIds.has(msg.link.source.source_id)) {
      mismatch(
        "One transaction cannot submit the same attestation source_id twice.",
        `${path}.payload_b64u`,
      );
    }
    attestationSourceIds.add(msg.link.source.source_id);
    if (msg.submitter !== sourceAddress) {
      mismatch("Attestation submitter must equal intent.source_account.", `${path}.payload_b64u`);
    }
    if (msg.bond_uzrn !== call.native_value.amount_atomic) {
      mismatch("Attestation payload bond and native_value differ.", `${path}.native_value`);
    }
    if (input.adapter_snapshot === undefined) {
      invalid(
        "Attestation signing requires a caller-supplied active adapter snapshot.",
        "adapter_snapshot",
      );
    }
    validateAdapterSnapshot(
      input.adapter_snapshot,
      profile.chain_id,
      msg.bond_uzrn,
      msg.link.source.fetched_at_block,
    );
    adapterSnapshotHeight = input.adapter_snapshot.observed_at_height;
    const publicMessage = Object.freeze({
      type_url: ZERONE_MSG_SUBMIT_EXTERNAL_ATTESTATION_TYPE_URL,
      value_b64u: base64UrlEncode(payload),
      value_hash: sha256BytesId(payload),
    });
    messages.push(publicMessage);
    protoMessages.push(Object.freeze({
      typeUrl: ZERONE_MSG_SUBMIT_EXTERNAL_ATTESTATION_TYPE_URL,
      value: payload,
    }));
    // Wallet 0.1 call effects cannot carry assets. Emit the module call plus
    // the bond escrow as a transfer-like effect so declared spend is conserved.
    effects.push(
      Object.freeze({
        action: "call",
        target_account: profile.substrate_bridge_account,
        method: ZERONE_WALLET_METHOD_SUBMIT_EXTERNAL_ATTESTATION,
        asset_id: null,
        amount_atomic: "0",
      }),
      Object.freeze({
        action: "transfer",
        target_account: profile.substrate_bridge_account,
        method: null,
        asset_id: profile.native_asset_id,
        amount_atomic: msg.bond_uzrn,
      }),
    );
    totalSpend += BigInt(msg.bond_uzrn);
  }

  if (!sawAttestation && input.adapter_snapshot !== undefined) {
    invalid("adapter_snapshot is accepted only when an attestation call is present.", "adapter_snapshot");
  }
  assertSpendMatches(
    input.intent.declared_spends,
    profile.native_asset_id,
    totalSpend,
  );
  return Object.freeze({
    messages: freezeArray(messages),
    protoMessages: freezeArray(protoMessages),
    effects: freezeArray(effects),
    adapterSnapshotHeight,
  });
}

export function createZeroneDirectSignPlan(
  input: CreateZeroneDirectSignPlanInput,
): Readonly<ZeroneDirectSignPlan> {
  assertVerifiedRecord(input.intent);
  const profile = getZeroneProfile(input.network);
  if (input.intent.chain_id !== profile.chain_id) {
    throw new ZeroneAdapterError(
      "unsupported_chain",
      "Intent chain_id does not match the selected Zerone profile.",
    );
  }
  assertZeroneAccountId(input.intent.source_account, profile, "intent.source_account");
  assertSecp256k1PublicKey(input.signer_public_key);
  const publicKey = Uint8Array.from(input.signer_public_key);
  const signer = describeZeronePublicKey(publicKey);
  const sourceAddress = addressFromZeroneAccountId(
    input.intent.source_account as never,
    profile,
  );
  if (signer.address !== sourceAddress) {
    throw new ZeroneAdapterError(
      "signer_mismatch",
      "Signer public key does not derive the intent source account.",
    );
  }
  const account = input.account_observation;
  if (
    account.status !== "found"
    || account.account !== input.intent.source_account
  ) {
    mismatch("Account observation does not bind the exact intent source account.");
  }
  assertUint64(account.account_number, "account_observation.account_number");
  assertUint64(account.sequence, "account_observation.sequence");
  assertUint64(
    account.observed_at_height,
    "account_observation.observed_at_height",
    { positive: true },
  );
  const hasNoRegisteredKey =
    account.public_key_type_url === null
    && account.public_key_b64u === null;
  if (
    !hasNoRegisteredKey
    && (
      account.public_key_type_url !== COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL
      || account.public_key_b64u === null
      || !equalBytes(
        base64UrlDecode(
          account.public_key_b64u,
          "account_observation.public_key_b64u",
        ),
        publicKey,
      )
    )
  ) {
    throw new ZeroneAdapterError(
      "signer_mismatch",
      "Account public key must be unset or the exact same Cosmos secp256k1 key; rotated Ed25519 and unknown keys are unsupported.",
    );
  }
  assertAtomicAmount(input.fee_amount_uzrn, "fee_amount_uzrn", {
    positive: true,
  });
  assertUint64(input.gas_limit, "gas_limit", { positive: true });
  if (BigInt(input.gas_limit) < ZERONE_LIMITS.min_gas_limit) {
    invalid(
      `gas_limit is below the pinned Zerone minimum ${ZERONE_LIMITS.min_gas_limit}.`,
      "gas_limit",
    );
  }
  if (BigInt(input.gas_limit) > ZERONE_LIMITS.max_gas_limit) {
    invalid(
      `gas_limit exceeds the pinned Zerone per-transaction cap ${ZERONE_LIMITS.max_gas_limit}.`,
      "gas_limit",
    );
  }
  if (BigInt(input.fee_amount_uzrn) < BigInt(input.gas_limit)) {
    mismatch(
      "fee_amount_uzrn must meet Zerone's pinned minimum of 1 uzrn per gas unit.",
      "fee_amount_uzrn",
    );
  }
  if (
    input.intent.max_fee.asset_id !== profile.native_asset_id
    || BigInt(input.fee_amount_uzrn) > BigInt(input.intent.max_fee.amount_atomic)
  ) {
    mismatch("Exact transaction fee exceeds or changes intent.max_fee.", "fee_amount_uzrn");
  }

  const bound = bindIntentMessages(input);
  const summedMessageGas = bound.messages.reduce(
    (total, message) =>
      total
      + (
        message.type_url === ZERONE_MSG_SEND_TYPE_URL
          ? ZERONE_LIMITS.msg_send_gas
          : ZERONE_LIMITS.msg_submit_external_attestation_gas
      ),
    0n,
  );
  const requiredGas =
    summedMessageGas < ZERONE_LIMITS.min_gas_limit
      ? ZERONE_LIMITS.min_gas_limit
      : summedMessageGas;
  if (BigInt(input.gas_limit) < requiredGas) {
    mismatch(
      `gas_limit is below the pinned Zerone per-message requirement ${requiredGas}.`,
      "gas_limit",
    );
  }
  const fee: ZeroneCoin = Object.freeze({
    denom: ZERONE_DENOM,
    amount: input.fee_amount_uzrn,
  });
  const bodyBytes = encodeTxBody(bound.protoMessages);
  const authInfoBytes = encodeAuthInfo(
    publicKey,
    BigInt(account.sequence),
    fee,
    BigInt(input.gas_limit),
  );
  // Decode the generated AuthInfo too; this pins the same decoder used after
  // signing and catches encoder/decoder drift before a signer is invoked.
  decodeAuthInfo(authInfoBytes);
  const signDocBytes = encodeSignDoc(
    bodyBytes,
    authInfoBytes,
    profile.chain_reference,
    BigInt(account.account_number),
  );
  const simulationTxBytes = encodeTxRaw(
    bodyBytes,
    authInfoBytes,
    new Uint8Array(),
  );
  if (
    bodyBytes.byteLength > ZERONE_LIMITS.max_transaction_bytes
    || authInfoBytes.byteLength > ZERONE_LIMITS.max_transaction_bytes
    || signDocBytes.byteLength > ZERONE_LIMITS.max_transaction_bytes
    || simulationTxBytes.byteLength > ZERONE_LIMITS.max_transaction_bytes
  ) {
    invalid("Constructed Zerone transaction exceeds its byte boundary.");
  }
  const planId = sha256BytesId(signDocBytes);
  const plan: ZeroneDirectSignPlan = Object.freeze({
    protocol: ZERONE_ADAPTER_PROTOCOL,
    zerone_core_commit: ZERONE_CORE_COMMIT,
    plan_id: planId,
    network: input.network,
    chain_id: profile.chain_id,
    chain_reference: profile.chain_reference,
    source_account: input.intent.source_account as never,
    intent_record_id: input.intent.record_id,
    signer_key_id: signer.signer_key_id,
    signer_public_key_b64u: signer.public_key_b64u,
    account_number: account.account_number,
    sequence: account.sequence,
    fee,
    gas_limit: input.gas_limit,
    required_gas_limit: requiredGas.toString(),
    messages: bound.messages,
    simulation_effects: bound.effects,
    body_bytes_b64u: base64UrlEncode(bodyBytes),
    body_bytes_hash: sha256BytesId(bodyBytes),
    auth_info_bytes_b64u: base64UrlEncode(authInfoBytes),
    auth_info_bytes_hash: sha256BytesId(authInfoBytes),
    sign_doc_bytes_b64u: base64UrlEncode(signDocBytes),
    sign_doc_bytes_hash: planId,
    simulation_tx_bytes_b64u: base64UrlEncode(simulationTxBytes),
    simulation_tx_bytes_hash: sha256BytesId(simulationTxBytes),
    adapter_snapshot_height: bound.adapterSnapshotHeight,
  });
  directSignPlans.add(plan);
  return plan;
}

export function assertZeroneDirectSignPlan(
  plan: ZeroneDirectSignPlan,
): void {
  if (!directSignPlans.has(plan)) {
    throw new ZeroneAdapterError(
      "invalid_state",
      "Sign plan must be returned by createZeroneDirectSignPlan in this process.",
    );
  }
}

function sameSimulationEffects(
  left: readonly SimulationEffect[],
  right: readonly SimulationEffect[],
): boolean {
  return (
    left.length === right.length
    && left.every((effect, index) => {
      const other = right[index];
      return (
        other !== undefined
        && effect.action === other.action
        && effect.target_account === other.target_account
        && effect.method === other.method
        && effect.asset_id === other.asset_id
        && effect.amount_atomic === other.amount_atomic
      );
    })
  );
}

export function createZeroneSimulationBinding(
  input: CreateZeroneSimulationBindingInput,
): Readonly<ZeroneSimulationBinding> {
  assertZeroneDirectSignPlan(input.plan);
  assertVerifiedRecord(input.simulation);
  assertSafeCode(input.simulation_result.code, "simulation_result.code");
  assertBoundedText(
    input.simulation_result.codespace,
    "simulation_result.codespace",
    128,
    { allowEmpty: true },
  );
  assertUint64(
    input.simulation_result.gas_wanted,
    "simulation_result.gas_wanted",
  );
  assertUint64(
    input.simulation_result.gas_used,
    "simulation_result.gas_used",
  );
  assertUint64(
    input.simulation_result.observed_at_height,
    "simulation_result.observed_at_height",
    { positive: true },
  );
  const expectedAsset = getZeroneProfile(input.plan.network).native_asset_id;
  if (
    input.simulation_result.status !== "succeeded"
    || input.simulation_result.code !== 0
    || input.simulation_result.simulation_tx_bytes_hash
      !== input.plan.simulation_tx_bytes_hash
  ) {
    mismatch("Only a successful simulation of the exact planned TxRaw can be bound.");
  }
  if (
    input.simulation.intent_record_id !== input.plan.intent_record_id
    || input.simulation.chain_id !== input.plan.chain_id
    || input.simulation.source_account !== input.plan.source_account
    || input.simulation.success !== true
    || input.simulation.block_ref
      !== `${input.plan.chain_reference}:${input.simulation_result.observed_at_height}`
    || !sameSimulationEffects(
      input.simulation.effects,
      input.plan.simulation_effects,
    )
    || input.simulation.estimated_fee.asset_id !== expectedAsset
    || input.simulation.estimated_fee.amount_atomic !== input.plan.fee.amount
  ) {
    mismatch(
      "Verified simulation receipt does not describe the exact Zerone plan.",
    );
  }
  const binding: ZeroneSimulationBinding = Object.freeze({
    protocol: "agent-wallet-zerone.simulation-binding/0.1",
    plan_id: input.plan.plan_id,
    intent_record_id: input.plan.intent_record_id,
    simulation_record_id: input.simulation.record_id,
    simulation_tx_bytes_hash: input.plan.simulation_tx_bytes_hash,
  });
  simulationBindings.set(binding, Object.freeze({
    plan: input.plan,
    simulation: input.simulation,
  }));
  return binding;
}

export function createZeroneSigningRequest(
  input: CreateZeroneSigningRequestInput,
): ReturnType<typeof createSigningRequest> {
  assertZeroneDirectSignPlan(input.plan);
  assertVerifiedRecord(input.simulation);
  assertAuthorizedIntent(input.authorization);
  const bound = simulationBindings.get(input.binding);
  if (
    bound === undefined
    || bound.plan !== input.plan
    || bound.simulation !== input.simulation
    || input.binding.protocol
      !== "agent-wallet-zerone.simulation-binding/0.1"
    || input.binding.plan_id !== input.plan.plan_id
    || input.binding.intent_record_id !== input.plan.intent_record_id
    || input.binding.simulation_record_id !== input.simulation.record_id
    || input.binding.simulation_tx_bytes_hash
      !== input.plan.simulation_tx_bytes_hash
  ) {
    mismatch(
      "Simulation binding was not created for this exact plan and verified receipt in this process.",
    );
  }
  if (
    input.authorization.intent_record_id !== input.plan.intent_record_id
    || input.authorization.simulation_record_id
      !== input.simulation.record_id
    || input.authorization.simulation_record_id
      !== input.binding.simulation_record_id
  ) {
    mismatch(
      "Authorization is not bound to the plan's exact intent and simulation.",
    );
  }
  const request = createSigningRequest({
    request_id: input.request_id,
    authorization: input.authorization,
    signer_key_id: input.plan.signer_key_id,
    unsigned_payload: base64UrlDecode(
      input.plan.sign_doc_bytes_b64u,
      "plan.sign_doc_bytes_b64u",
    ),
  });
  zeroneSigningRequests.set(request, Object.freeze({
    plan: input.plan,
    binding: input.binding,
    simulation: input.simulation,
  }));
  return request;
}

function assertZeroneSigningRequest(
  plan: ZeroneDirectSignPlan,
  request: object,
): void {
  const bound = zeroneSigningRequests.get(request);
  if (
    bound === undefined
    || bound.plan !== plan
    || simulationBindings.get(bound.binding)?.plan !== plan
    || simulationBindings.get(bound.binding)?.simulation !== bound.simulation
  ) {
    mismatch(
      "Signing request must be returned by createZeroneSigningRequest for this exact simulation-bound plan.",
    );
  }
}

function txHash(txBytes: Uint8Array): string {
  return bytesToHex(sha256(txBytes)).toUpperCase();
}

export function createZeroneSignedPayload(
  input: CreateZeroneSignedPayloadInput,
): Readonly<SignedPayload> {
  assertZeroneDirectSignPlan(input.plan);
  assertZeroneSigningRequest(input.plan, input.request);
  if (
    input.request.authorization.intent_record_id !== input.plan.intent_record_id
    || input.request.signer_key_id !== input.plan.signer_key_id
    || input.request.unsigned_payload_hash !== input.plan.sign_doc_bytes_hash
    || input.request.unsigned_payload_b64u !== input.plan.sign_doc_bytes_b64u
  ) {
    mismatch("Signing request does not bind the exact Zerone sign plan.");
  }
  if (!(input.signature instanceof Uint8Array) || input.signature.byteLength !== 64) {
    invalid("Signer signature must be compact 64-byte secp256k1.", "signature");
  }
  const bodyBytes = base64UrlDecode(input.plan.body_bytes_b64u);
  const authInfoBytes = base64UrlDecode(input.plan.auth_info_bytes_b64u);
  const txBytes = encodeTxRaw(bodyBytes, authInfoBytes, input.signature);
  const result: SignedPayload = {
    request_id: input.request.request_id,
    signer_key_id: input.plan.signer_key_id,
    unsigned_payload_hash: input.plan.sign_doc_bytes_hash,
    signed_payload_b64u: base64UrlEncode(txBytes),
    signed_payload_hash: sha256BytesId(txBytes),
    operation_id: input.signer_operation_id ?? null,
  };
  const checked = assertSignedPayloadMatchesRequest(input.request, result);
  // Chain-native verification is mandatory even for this assembly helper.
  verifyZeroneSignedPayload({
    plan: input.plan,
    request: input.request,
    payload: checked,
  });
  return checked;
}

export function verifyZeroneSignedPayload(input: {
  readonly plan: ZeroneDirectSignPlan;
  readonly request: Parameters<typeof assertSignedPayloadMatchesRequest>[0];
  readonly payload: Parameters<typeof assertSignedPayloadMatchesRequest>[1];
}): Readonly<VerifiedZeroneTransaction> {
  assertZeroneDirectSignPlan(input.plan);
  assertZeroneSigningRequest(input.plan, input.request);
  if (
    input.request.authorization.intent_record_id !== input.plan.intent_record_id
    || input.request.signer_key_id !== input.plan.signer_key_id
    || input.request.unsigned_payload_b64u !== input.plan.sign_doc_bytes_b64u
  ) {
    mismatch("Signing request does not bind the exact Zerone sign plan.");
  }
  const payload = assertSignedPayloadMatchesRequest(
    input.request,
    input.payload,
  );
  const txBytes = base64UrlDecode(
    payload.signed_payload_b64u,
    "signed_payload_b64u",
  );
  const decoded = decodeTxRaw(txBytes);
  const expectedBody = base64UrlDecode(input.plan.body_bytes_b64u);
  const expectedAuth = base64UrlDecode(input.plan.auth_info_bytes_b64u);
  if (
    !equalBytes(decoded.bodyBytes, expectedBody)
    || !equalBytes(decoded.authInfoBytes, expectedAuth)
  ) {
    throw new ZeroneAdapterError(
      "signature_invalid",
      "Signed TxRaw does not contain the exact planned body and AuthInfo.",
    );
  }
  const auth = decodeAuthInfo(decoded.authInfoBytes);
  const expectedPublicKey = base64UrlDecode(
    input.plan.signer_public_key_b64u,
    "plan.signer_public_key_b64u",
  );
  if (
    !equalBytes(auth.publicKey, expectedPublicKey)
    || auth.sequence !== input.plan.sequence
    || auth.feeAmount !== input.plan.fee.amount
    || auth.gasLimit !== input.plan.gas_limit
  ) {
    throw new ZeroneAdapterError(
      "signature_invalid",
      "Signed TxRaw AuthInfo does not match the signer, sequence, fee, and gas plan.",
    );
  }
  if (decoded.signature.byteLength !== 64) {
    throw new ZeroneAdapterError(
      "signature_invalid",
      "TxRaw must contain exactly one compact secp256k1 signature.",
    );
  }
  const signDoc = base64UrlDecode(input.plan.sign_doc_bytes_b64u);
  let valid = false;
  try {
    valid = secp256k1.verify(
      decoded.signature,
      signDoc,
      expectedPublicKey,
      { prehash: true, lowS: true, format: "compact" },
    );
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new ZeroneAdapterError(
      "signature_invalid",
      "Cosmos secp256k1 SIGN_MODE_DIRECT signature is invalid or malleable.",
    );
  }
  const transaction: VerifiedZeroneTransaction = Object.freeze({
    chain_id: input.plan.chain_id,
    intent_record_id: input.plan.intent_record_id,
    tx_hash: txHash(txBytes),
    tx_bytes_b64u: payload.signed_payload_b64u,
    tx_bytes_hash: payload.signed_payload_hash,
    signed_payload: payload,
  });
  verifiedTransactions.add(transaction);
  return transaction;
}

export function assertVerifiedZeroneTransaction(
  transaction: VerifiedZeroneTransaction,
): void {
  if (!verifiedTransactions.has(transaction)) {
    throw new ZeroneAdapterError(
      "invalid_state",
      "Transaction must be returned by verifyZeroneSignedPayload in this process.",
    );
  }
}

export function createZeroneSimulationReceiptCore(
  input: ZeroneSimulationReceiptInput,
): Readonly<SimulationReceiptCore> {
  assertZeroneDirectSignPlan(input.plan);
  assertVerifiedRecord(input.intent);
  if (
    input.intent.record_id !== input.plan.intent_record_id
    || input.simulation.simulation_tx_bytes_hash
      !== input.plan.simulation_tx_bytes_hash
  ) {
    mismatch("Simulation does not bind the exact plan and intent.");
  }
  assertSafeCode(input.simulation.code, "simulation.code");
  assertUint64(
    input.simulation.observed_at_height,
    "simulation.observed_at_height",
    { positive: true },
  );
  assertUint64(input.simulation.gas_wanted, "simulation.gas_wanted");
  assertUint64(input.simulation.gas_used, "simulation.gas_used");
  const success =
    input.simulation.status === "succeeded"
    && input.simulation.code === 0;
  if (
    (input.simulation.status === "succeeded") !==
      (input.simulation.code === 0)
  ) {
    invalid("Simulation status and code disagree.", "simulation");
  }
  return Object.freeze({
    schema: "agent-wallet/simulation/0.1",
    simulation_id: input.simulation_id,
    intent_id: input.intent.intent_id,
    intent_record_id: input.intent.record_id,
    chain_id: input.plan.chain_id,
    source_account: input.plan.source_account,
    adapter: input.adapter,
    block_ref:
      `${input.plan.chain_reference}:${input.simulation.observed_at_height}`,
    block_hash: null,
    success,
    effects: [...input.plan.simulation_effects],
    estimated_fee: Object.freeze({
      asset_id: getZeroneProfile(input.plan.network).native_asset_id,
      amount_atomic: input.plan.fee.amount,
    }),
    simulated_at: input.simulated_at,
    valid_until: input.valid_until,
  });
}

export function zeroneDirectSignAlgorithm(): typeof ZERONE_DIRECT_SIGN_ALGORITHM {
  return ZERONE_DIRECT_SIGN_ALGORITHM;
}
