import {
  assertCaip10,
  assertCaip2,
  base64UrlDecode,
  canonicalJson,
  snapshotJsonData,
} from "@agenttool/wallet";
import { assertZeroneAddress } from "@agenttool/wallet-zerone";
import {
  MESSAGE_TYPE_URLS,
  SEMANTIC_BOUNDARY,
  WALLET_METHODS,
  decodeCreateBountyOrderValue,
  describeCanonicalProjection,
  describeProtobufValue,
  encodeCreateBountyOrderValue,
  type CreateBountyOrderValue,
} from "@agenttool/zerone-agent-economy";
import { deepFreeze } from "@agenttool/zerone-creation-claim";

import {
  CREATION_ECONOMY_COMPATIBILITY,
  CREATION_ECONOMY_FORMATS,
  CREATION_ECONOMY_SOURCE_PINS,
} from "./constants.js";
import { fail } from "./errors.js";
import type {
  CreationEconomyMessageProjection,
  CreationEconomyMessageValue,
  CreationPrivateAccountId,
  CreationPrivateCaip2,
  CreationSubmitClaimValue,
} from "./types.js";
import {
  assertCreationBountyValueProfile,
  decodeCreationSubmitClaimValue,
  encodeCreationEconomyAny,
  encodeCreationSubmitClaimValue,
} from "./wire.js";

const PROJECTION_KEYS = [
  "chain_id",
  "compatibility",
  "format",
  "network",
  "projection_bytes_b64u",
  "projection_hash",
  "protobuf_value_b64u",
  "protobuf_value_hash",
  "protobuf_any_b64u",
  "protobuf_any_hash",
  "semantic_boundary",
  "source_account",
  "type_url",
  "value",
  "wallet_method",
] as const;
const MAX_BASE64URL_CHARS = 180_000;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;

function assertPrivateChainId(value: unknown, path: string): asserts value is CreationPrivateCaip2 {
  if (
    typeof value !== "string"
    || !/^cosmos:zerone-creation-private-[a-z0-9](?:[a-z0-9-]{0,6}[a-z0-9])?$/u.test(value)
  ) {
    fail("invalid_profile", `${path} must match the requested private creation-chain naming profile.`, path);
  }
  try {
    assertCaip2(value, path);
  } catch {
    fail("invalid_profile", `${path} is not a canonical CAIP-2 chain ID.`, path);
  }
  const reference = value.slice("cosmos:".length);
  if ((CREATION_ECONOMY_SOURCE_PINS.reserved_chain_references as readonly string[]).includes(reference)) {
    fail("invalid_profile", `${path} cannot impersonate a shared Zerone network.`, path);
  }
}

function assertPrivateAccount(
  value: unknown,
  chainId: CreationPrivateCaip2,
  actor: string,
  path: string,
): asserts value is CreationPrivateAccountId {
  try {
    assertCaip10(value, path);
  } catch {
    fail("invalid_projection", `${path} must be a canonical CAIP-10 account.`, path);
  }
  if (value !== `${chainId}:${actor}`) {
    fail("projection_mismatch", `${path} must bind the exact message actor on the requested chain.`, path);
  }
}

function validateCommon(value: unknown): Record<string, unknown> {
  const snapshot = snapshotJsonData(value);
  if (snapshot === null || Array.isArray(snapshot) || typeof snapshot !== "object") {
    fail("invalid_projection", "Projection must be a closed record.");
  }
  const item = snapshot as Record<string, unknown>;
  const actual = Object.keys(item).sort();
  const expected = [...PROJECTION_KEYS].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("invalid_projection", `Projection must contain exactly: ${expected.join(", ")}.`);
  }
  if (
    item.format !== CREATION_ECONOMY_FORMATS.message_projection
    || item.network !== "requested_private_disposable_testnet"
  ) {
    fail("invalid_projection", "Projection format or network posture changed.");
  }
  for (const field of [
    "projection_bytes_b64u",
    "protobuf_value_b64u",
    "protobuf_any_b64u",
  ] as const) {
    const encoded = item[field];
    if (
      typeof encoded !== "string"
      || encoded.length === 0
      || encoded.length > MAX_BASE64URL_CHARS
      || !BASE64URL.test(encoded)
    ) {
      fail("invalid_projection", `${field} must be bounded canonical base64url text.`, field);
    }
  }
  for (const field of [
    "projection_hash",
    "protobuf_value_hash",
    "protobuf_any_hash",
  ] as const) {
    if (typeof item[field] !== "string" || !SHA256_ID.test(item[field])) {
      fail("invalid_projection", `${field} must be a canonical SHA-256 identifier.`, field);
    }
  }
  if (canonicalJson(item.compatibility) !== canonicalJson(CREATION_ECONOMY_COMPATIBILITY)) {
    fail("invalid_projection", "Projection compatibility boundary changed.", "compatibility");
  }
  if (canonicalJson(item.semantic_boundary) !== canonicalJson(SEMANTIC_BOUNDARY)) {
    fail("invalid_projection", "Projection ZRN semantic boundary changed.", "semantic_boundary");
  }
  assertPrivateChainId(item.chain_id, "chain_id");
  return item;
}

export function projectCreationEconomyMessage<T extends CreationEconomyMessageValue>(input: {
  readonly chain_id: CreationPrivateCaip2;
  readonly source_address: string;
  readonly type_url: CreationEconomyMessageProjection<T>["type_url"];
  readonly wallet_method: CreationEconomyMessageProjection<T>["wallet_method"];
  readonly value: T;
  readonly protobuf_value: Uint8Array;
}): CreationEconomyMessageProjection<T> {
  assertPrivateChainId(input.chain_id, "chain_id");
  try {
    assertZeroneAddress(input.source_address, "source_address");
  } catch {
    fail("invalid_projection", "source_address must be a canonical Zerone address.", "source_address");
  }
  const sourceAccount = `${input.chain_id}:${input.source_address}` as CreationPrivateAccountId;
  const described = describeCanonicalProjection({
    type_url: input.type_url,
    value: input.value,
  });
  const describedValue = describeProtobufValue(input.protobuf_value);
  const describedAny = describeProtobufValue(
    encodeCreationEconomyAny(input.type_url, input.protobuf_value),
  );
  return deepFreeze({
    format: CREATION_ECONOMY_FORMATS.message_projection,
    network: "requested_private_disposable_testnet",
    chain_id: input.chain_id,
    source_account: sourceAccount,
    type_url: input.type_url,
    wallet_method: input.wallet_method,
    value: input.value,
    ...described,
    ...describedValue,
    protobuf_any_b64u: describedAny.protobuf_value_b64u,
    protobuf_any_hash: describedAny.protobuf_value_hash,
    compatibility: CREATION_ECONOMY_COMPATIBILITY,
    semantic_boundary: SEMANTIC_BOUNDARY,
  }) as CreationEconomyMessageProjection<T>;
}

export function validateCreationEconomyMessageProjection(
  value: unknown,
): CreationEconomyMessageProjection {
  const item = validateCommon(value);
  const chainId = item.chain_id as CreationPrivateCaip2;
  let decoded: CreationEconomyMessageValue;
  let encoded: Uint8Array;
  let actor: string;
  let method: CreationEconomyMessageProjection["wallet_method"];
  if (item.type_url === MESSAGE_TYPE_URLS.create_bounty) {
    if (item.wallet_method !== WALLET_METHODS.create_bounty) {
      fail("projection_mismatch", "Create-bounty wallet method changed.", "wallet_method");
    }
    const bytes = base64UrlDecode(String(item.protobuf_value_b64u));
    decoded = decodeCreateBountyOrderValue(bytes);
    assertCreationBountyValueProfile(decoded);
    encoded = encodeCreateBountyOrderValue(decoded);
    actor = decoded.sponsor;
    method = WALLET_METHODS.create_bounty;
  } else if (item.type_url === MESSAGE_TYPE_URLS.submit_claim) {
    if (item.wallet_method !== WALLET_METHODS.submit_claim) {
      fail("projection_mismatch", "Submit-claim wallet method changed.", "wallet_method");
    }
    const bytes = base64UrlDecode(String(item.protobuf_value_b64u));
    decoded = decodeCreationSubmitClaimValue(bytes);
    encoded = encodeCreationSubmitClaimValue(decoded);
    actor = decoded.submitter;
    method = WALLET_METHODS.submit_claim;
  } else {
    fail("invalid_projection", "Creation economy projection supports Create or Submit only.", "type_url");
  }
  const expected = projectCreationEconomyMessage({
    chain_id: chainId,
    source_address: actor,
    type_url: item.type_url,
    wallet_method: method,
    value: decoded,
    protobuf_value: encoded,
  });
  assertPrivateAccount(item.source_account, chainId, actor, "source_account");
  if (canonicalJson(item) !== canonicalJson(expected)) {
    fail("projection_mismatch", "Projection bytes, hashes, decoded value, or boundary do not match.");
  }
  return expected;
}

export function creationBountyProjection(input: {
  readonly chain_id: CreationPrivateCaip2;
  readonly value: CreateBountyOrderValue;
}): CreationEconomyMessageProjection<CreateBountyOrderValue> {
  return projectCreationEconomyMessage({
    chain_id: input.chain_id,
    source_address: input.value.sponsor,
    type_url: MESSAGE_TYPE_URLS.create_bounty,
    wallet_method: WALLET_METHODS.create_bounty,
    value: input.value,
    protobuf_value: encodeCreateBountyOrderValue(input.value),
  });
}

export function creationSubmitProjection(input: {
  readonly chain_id: CreationPrivateCaip2;
  readonly value: CreationSubmitClaimValue;
}): CreationEconomyMessageProjection<CreationSubmitClaimValue> {
  return projectCreationEconomyMessage({
    chain_id: input.chain_id,
    source_address: input.value.submitter,
    type_url: MESSAGE_TYPE_URLS.submit_claim,
    wallet_method: WALLET_METHODS.submit_claim,
    value: input.value,
    protobuf_value: encodeCreationSubmitClaimValue(input.value),
  });
}
