import {
  base64UrlDecode,
  canonicalJson,
  sha256BytesId,
  snapshotJsonData,
  type SimulationEffect,
  type TransactionIntent,
} from "@agenttool/wallet";
import {
  addressFromZeroneAccountId,
  assertZeroneAccountId,
  assertZeroneAddress,
  getZeroneProfile,
  type ZeroneNetwork,
} from "@agenttool/wallet-zerone";
import {
  FORMATS,
  MESSAGE_TYPE_URLS,
  SEMANTIC_BOUNDARY,
  WALLET_METHODS,
  WALLET_ZERONE_SUPPORT,
  decodeCreateBountyOrderValue,
  decodeFulfillBountyValue,
  decodeSubmitComputationalClaimValue,
  describeCanonicalProjection,
  type CreateBountyOrderValue,
  type FulfillBountyValue,
  type SubmitComputationalClaimValue,
  type UnsignedMessageProjection,
} from "@agenttool/zerone-agent-economy";

import {
  ECONOMY_GAS,
  ECONOMY_LIMITS,
  ECONOMY_MESSAGE_ORDER,
} from "./constants.js";
import { fail } from "./errors.js";
import { getZeroneEconomyModuleAccounts } from "./profiles.js";
import type {
  EconomyMessageKind,
  ZeroneEconomyEffect,
  ZeroneEconomyPlannedMessage,
} from "./types.js";
import { closedRecord, freezeArray } from "./validation.js";
import type { EconomyProtoAny } from "./wire.js";

interface BoundEconomyMessages {
  readonly messages: readonly ZeroneEconomyPlannedMessage[];
  readonly protoMessages: readonly EconomyProtoAny[];
  readonly simulationEffects: readonly SimulationEffect[];
  readonly economicEffects: readonly ZeroneEconomyEffect[];
  readonly totalReservedSpend: bigint;
}

type DecodedValue =
  | CreateBountyOrderValue
  | SubmitComputationalClaimValue
  | FulfillBountyValue;

interface DecodedProjection {
  readonly kind: EconomyMessageKind;
  readonly actor: string;
  readonly module: "sponsorship" | "knowledge";
  readonly method: ZeroneEconomyPlannedMessage["wallet_method"];
  readonly value: DecodedValue;
  readonly valueBytes: Uint8Array;
  readonly reservedSpend: bigint;
  readonly requiredGas: bigint;
}

function assertProjectionShape(projection: UnsignedMessageProjection, path: string): void {
  closedRecord(projection, [
    "chain_id",
    "compatibility",
    "format",
    "network",
    "projection_bytes_b64u",
    "projection_hash",
    "protobuf_value_b64u",
    "protobuf_value_hash",
    "semantic_boundary",
    "source_account",
    "type_url",
    "value",
    "wallet_method",
  ], path);
  if (projection.format !== FORMATS.unsigned_message) {
    fail("projection_mismatch", `${path}.format is unsupported.`, `${path}.format`);
  }
  if (
    canonicalJson(projection.compatibility) !== canonicalJson(WALLET_ZERONE_SUPPORT)
    || canonicalJson(projection.semantic_boundary) !== canonicalJson(SEMANTIC_BOUNDARY)
  ) {
    fail(
      "projection_mismatch",
      `${path} changes the source economy compatibility or semantic boundary.`,
      path,
    );
  }
}

function productUint256(left: string, right: number, path: string): bigint {
  const product = BigInt(left) * BigInt(right);
  if (product <= 0n || product > ECONOMY_LIMITS.max_uint256) {
    fail(
      "projection_mismatch",
      `${path} overflows the chain/Wallet uint256 amount boundary.`,
      path,
    );
  }
  return product;
}

function decodeProjection(
  projection: UnsignedMessageProjection,
  path: string,
): DecodedProjection {
  assertProjectionShape(projection, path);
  const valueBytes = base64UrlDecode(
    projection.protobuf_value_b64u,
    `${path}.protobuf_value_b64u`,
  );
  if (valueBytes.byteLength === 0 || valueBytes.byteLength > ECONOMY_LIMITS.max_message_bytes) {
    fail("projection_mismatch", `${path} protobuf value is empty or oversized.`, path);
  }
  if (sha256BytesId(valueBytes) !== projection.protobuf_value_hash) {
    fail("projection_mismatch", `${path} protobuf value hash does not match its bytes.`, path);
  }

  let decoded: DecodedProjection;
  if (projection.type_url === MESSAGE_TYPE_URLS.create_bounty) {
    const value = decodeCreateBountyOrderValue(valueBytes);
    decoded = Object.freeze({
      kind: "create_bounty",
      actor: value.sponsor,
      module: "sponsorship",
      method: WALLET_METHODS.create_bounty,
      value,
      valueBytes,
      reservedSpend: productUint256(
        value.price_per_artifact,
        value.target_count,
        `${path}.value.total_escrow`,
      ),
      requiredGas: ECONOMY_GAS.create_bounty,
    });
  } else if (projection.type_url === MESSAGE_TYPE_URLS.submit_claim) {
    const value = decodeSubmitComputationalClaimValue(valueBytes);
    const stake = BigInt(value.stake);
    if (stake <= 0n || stake > ECONOMY_LIMITS.max_uint256) {
      fail("projection_mismatch", `${path}.value.stake is outside uint256.`, `${path}.value.stake`);
    }
    decoded = Object.freeze({
      kind: "submit_claim",
      actor: value.submitter,
      module: "knowledge",
      method: WALLET_METHODS.submit_claim,
      value,
      valueBytes,
      reservedSpend: stake,
      requiredGas: ECONOMY_GAS.submit_claim,
    });
  } else if (projection.type_url === MESSAGE_TYPE_URLS.fulfill_bounty) {
    const value = decodeFulfillBountyValue(valueBytes);
    decoded = Object.freeze({
      kind: "fulfill_bounty",
      actor: value.caller,
      module: "sponsorship",
      method: WALLET_METHODS.fulfill_bounty,
      value,
      valueBytes,
      reservedSpend: 0n,
      requiredGas: ECONOMY_GAS.fulfill_bounty,
    });
  } else {
    fail("unsupported_message", `${path}.type_url is outside the economy allowlist.`, `${path}.type_url`);
  }

  if (projection.wallet_method !== decoded.method) {
    fail("projection_mismatch", `${path}.wallet_method does not match decoded bytes.`, `${path}.wallet_method`);
  }
  if (canonicalJson(projection.value) !== canonicalJson(decoded.value)) {
    fail("projection_mismatch", `${path}.value does not match decoded canonical protobuf bytes.`, `${path}.value`);
  }
  const described = describeCanonicalProjection({
    type_url: projection.type_url,
    value: decoded.value,
  });
  if (
    projection.projection_bytes_b64u !== described.projection_bytes_b64u
    || projection.projection_hash !== described.projection_hash
  ) {
    fail("projection_mismatch", `${path} canonical projection bytes/hash do not match decoded bytes.`, path);
  }
  try {
    assertZeroneAddress(decoded.actor, `${path}.actor`);
  } catch {
    fail("projection_mismatch", `${path} actor is not a canonical Zerone account.`, `${path}.actor`);
  }
  return decoded;
}

function assertDeclaredSpend(intent: TransactionIntent, assetId: string, total: bigint): void {
  if (total === 0n) {
    if (intent.declared_spends.length !== 0) {
      fail(
        "projection_mismatch",
        "Fee-only economy intent must have no declared native spend.",
        "intent.declared_spends",
      );
    }
    return;
  }
  if (
    intent.declared_spends.length !== 1
    || intent.declared_spends[0]?.asset_id !== assetId
    || BigInt(intent.declared_spends[0].amount_atomic) !== total
  ) {
    fail(
      "projection_mismatch",
      "Intent declared_spends must equal decoded Create escrow plus Submit review fee.",
      "intent.declared_spends",
    );
  }
}

export function bindEconomyIntentMessages(input: {
  readonly intent: TransactionIntent;
  readonly projections: readonly UnsignedMessageProjection[];
  readonly network: ZeroneNetwork;
}): BoundEconomyMessages {
  const profile = getZeroneProfile(input.network);
  const modules = getZeroneEconomyModuleAccounts(input.network);
  const projectionSnapshot = snapshotJsonData(input.projections);
  if (
    !Array.isArray(projectionSnapshot)
    || projectionSnapshot.length < 1
    || projectionSnapshot.length > ECONOMY_LIMITS.max_messages
    || projectionSnapshot.length !== input.intent.calls.length
  ) {
    fail(
      "projection_mismatch",
      "Intent and projection lists must contain the same one through three messages.",
      "projections",
    );
  }
  const projections = projectionSnapshot as unknown as readonly UnsignedMessageProjection[];
  if (input.intent.chain_id !== profile.chain_id) {
    fail("projection_mismatch", "Intent chain does not match selected Zerone network.", "intent.chain_id");
  }
  try {
    assertZeroneAccountId(input.intent.source_account, profile, "intent.source_account");
  } catch {
    fail("projection_mismatch", "Intent source account does not match selected network.", "intent.source_account");
  }
  const sourceAddress = addressFromZeroneAccountId(input.intent.source_account as never, profile);
  const messages: ZeroneEconomyPlannedMessage[] = [];
  const protoMessages: EconomyProtoAny[] = [];
  const simulationEffects: SimulationEffect[] = [];
  const economicEffects: ZeroneEconomyEffect[] = [];
  let totalReservedSpend = 0n;
  let previousOrder = -1;
  const seenKinds = new Set<EconomyMessageKind>();

  for (const [index, projection] of projections.entries()) {
    const path = `projections[${index}]`;
    const decoded = decodeProjection(projection, path);
    const order = ECONOMY_MESSAGE_ORDER.indexOf(projection.type_url as never);
    if (order < 0 || order <= previousOrder || seenKinds.has(decoded.kind)) {
      fail(
        "projection_mismatch",
        "Economy messages must be unique and follow Create → Submit → Fulfill order.",
        path,
      );
    }
    previousOrder = order;
    seenKinds.add(decoded.kind);
    if (
      projection.network !== input.network
      || projection.chain_id !== profile.chain_id
      || projection.source_account !== input.intent.source_account
      || decoded.actor !== sourceAddress
    ) {
      fail(
        "projection_mismatch",
        `${path} decoded actor, source account, chain, or network differs from the Wallet intent.`,
        path,
      );
    }
    const moduleAccount = modules[decoded.module];
    const call = input.intent.calls[index];
    if (call === undefined) {
      fail("projection_mismatch", "Intent call is missing.", `intent.calls[${index}]`);
    }
    const expectedNativeValue = decoded.reservedSpend === 0n
      ? null
      : Object.freeze({
          asset_id: profile.native_asset_id,
          amount_atomic: decoded.reservedSpend.toString(),
        });
    if (
      call.action !== "call"
      || call.target_account !== moduleAccount
      || call.method !== decoded.method
      || call.payload_b64u !== projection.protobuf_value_b64u
      || call.payload_hash !== projection.protobuf_value_hash
      || (
        expectedNativeValue === null
          ? call.native_value !== null
          : call.native_value === null
            || call.native_value.asset_id !== expectedNativeValue.asset_id
            || call.native_value.amount_atomic !== expectedNativeValue.amount_atomic
      )
    ) {
      fail(
        "projection_mismatch",
        `intent.calls[${index}] does not bind the decoded actor, module, method, payload, and spend.`,
        `intent.calls[${index}]`,
      );
    }
    totalReservedSpend += decoded.reservedSpend;
    if (totalReservedSpend > ECONOMY_LIMITS.max_uint256) {
      fail("projection_mismatch", "Total economy reserved spend exceeds uint256.");
    }

    messages.push(Object.freeze({
      kind: decoded.kind,
      type_url: projection.type_url,
      wallet_method: decoded.method,
      projection_hash: projection.projection_hash,
      value_b64u: projection.protobuf_value_b64u,
      value_hash: projection.protobuf_value_hash,
      actor_address: decoded.actor,
      module_account: moduleAccount,
      reserved_spend_uzrn: decoded.reservedSpend.toString(),
      required_gas: decoded.requiredGas.toString(),
    }));
    protoMessages.push(Object.freeze({
      typeUrl: projection.type_url,
      value: Uint8Array.from(decoded.valueBytes),
    }));
    simulationEffects.push(Object.freeze({
      action: "call",
      target_account: moduleAccount,
      method: decoded.method,
      asset_id: null,
      amount_atomic: "0",
    }));
    if (decoded.reservedSpend > 0n) {
      simulationEffects.push(Object.freeze({
        action: "transfer",
        target_account: moduleAccount,
        method: null,
        asset_id: profile.native_asset_id,
        amount_atomic: decoded.reservedSpend.toString(),
      }));
    }
    economicEffects.push(Object.freeze({
      message_index: index,
      kind: decoded.kind === "create_bounty"
        ? "escrow_lock"
        : decoded.kind === "submit_claim"
          ? "review_fee"
          : "fulfillment_request",
      module: decoded.module,
      direction: decoded.kind === "fulfill_bounty" ? "conditional_incoming" : "outgoing",
      asset_id: profile.native_asset_id,
      amount_atomic: decoded.kind === "fulfill_bounty"
        ? null
        : decoded.reservedSpend.toString(),
      condition: decoded.kind === "fulfill_bounty"
        ? "keeper_state_and_message_success"
        : "message_success",
    }));
  }

  assertDeclaredSpend(input.intent, profile.native_asset_id, totalReservedSpend);
  return Object.freeze({
    messages: freezeArray(messages) as readonly ZeroneEconomyPlannedMessage[],
    protoMessages: freezeArray(protoMessages) as readonly EconomyProtoAny[],
    simulationEffects: freezeArray(simulationEffects) as readonly SimulationEffect[],
    economicEffects: freezeArray(economicEffects) as readonly ZeroneEconomyEffect[],
    totalReservedSpend,
  });
}
