import { bech32 } from "@scure/base";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  assertCaip10,
  assertCaip19,
  assertCaip2,
  base64UrlEncode,
  bytesToHex,
  sha256BytesId,
} from "@agenttool/wallet";

import {
  SUBSTRATE_BRIDGE_MODULE_NAME,
  ZERONE_BECH32_PREFIX,
} from "./constants.js";
import { ZeroneAdapterError, invalid } from "./errors.js";
import type {
  ZeroneAccountId,
  ZeroneChainProfile,
  ZeroneNetwork,
} from "./types.js";

function moduleAddress(name: string): string {
  const digest = sha256(new TextEncoder().encode(name)).subarray(0, 20);
  return bech32.encodeFromBytes(ZERONE_BECH32_PREFIX, digest);
}

const SUBSTRATE_BRIDGE_ADDRESS = moduleAddress(
  SUBSTRATE_BRIDGE_MODULE_NAME,
);

function makeProfile(
  network: ZeroneNetwork,
  chainReference: "zerone-1" | "zerone-testnet-1",
): ZeroneChainProfile {
  const chainId = `cosmos:${chainReference}` as const;
  return Object.freeze({
    network,
    chain_reference: chainReference,
    chain_id: chainId,
    // This is an adapter-local Cosmos denom namespace profile. It is not a
    // claim that "denom" is a registered CAIP asset namespace.
    native_asset_id: `${chainId}/denom:uzrn`,
    native_denom: "uzrn",
    display_denom: "ZRN",
    decimals: 6,
    bech32_prefix: ZERONE_BECH32_PREFIX,
    bip44_coin_type: 118,
    substrate_bridge_account:
      `${chainId}:${SUBSTRATE_BRIDGE_ADDRESS}` as ZeroneAccountId,
    confirmation_depth: 1,
  });
}

export const ZERONE_CHAIN_PROFILES: Readonly<
  Record<ZeroneNetwork, ZeroneChainProfile>
> = Object.freeze({
  mainnet: makeProfile("mainnet", "zerone-1"),
  testnet: makeProfile("testnet", "zerone-testnet-1"),
});

export function getZeroneProfile(
  network: ZeroneNetwork,
): ZeroneChainProfile {
  const profile = ZERONE_CHAIN_PROFILES[network];
  if (profile === undefined) {
    throw new ZeroneAdapterError(
      "unsupported_chain",
      "Only Zerone mainnet and testnet profiles are supported.",
    );
  }
  return profile;
}

export function assertZeroneAddress(
  value: unknown,
  path = "address",
): asserts value is string {
  if (typeof value !== "string" || value !== value.toLowerCase()) {
    invalid(`${path} must be a canonical lowercase zrn Bech32 address.`, path);
  }
  try {
    const decoded = bech32.decodeToBytes(value);
    if (
      decoded.prefix !== ZERONE_BECH32_PREFIX
      || decoded.bytes.byteLength !== 20
      || bech32.encodeFromBytes(decoded.prefix, decoded.bytes) !== value
    ) {
      invalid(`${path} must use the zrn HRP and a 20-byte account address.`, path);
    }
  } catch {
    invalid(`${path} must be a valid Bech32 account address.`, path);
  }
}

export function assertZeroneAccountId(
  value: unknown,
  profile: ZeroneChainProfile,
  path = "account",
): asserts value is ZeroneAccountId {
  assertCaip10(value, path);
  if (typeof value !== "string" || !value.startsWith(`${profile.chain_id}:`)) {
    invalid(`${path} belongs to a different Zerone profile.`, path);
  }
  assertZeroneAddress(value.slice(profile.chain_id.length + 1), `${path}.address`);
}

export function assertZeroneProfileIdentifiers(
  profile: ZeroneChainProfile,
): void {
  assertCaip2(profile.chain_id, "profile.chain_id");
  assertCaip19(profile.native_asset_id, "profile.native_asset_id");
  assertZeroneAccountId(
    profile.substrate_bridge_account,
    profile,
    "profile.substrate_bridge_account",
  );
}

export function zeroneAccountId(
  profile: ZeroneChainProfile,
  address: string,
): ZeroneAccountId {
  assertZeroneAddress(address);
  return `${profile.chain_id}:${address}` as ZeroneAccountId;
}

export function addressFromZeroneAccountId(
  accountId: ZeroneAccountId,
  profile: ZeroneChainProfile,
): string {
  assertZeroneAccountId(accountId, profile);
  return accountId.slice(profile.chain_id.length + 1);
}

export function assertSecp256k1PublicKey(
  value: unknown,
  path = "signer_public_key",
): asserts value is Uint8Array {
  if (
    !(value instanceof Uint8Array)
    || value.byteLength !== 33
    || !secp256k1.utils.isValidPublicKey(value, true)
  ) {
    invalid(`${path} must be a compressed 33-byte secp256k1 public key.`, path);
  }
}

export function zeroneAddressFromSecp256k1PublicKey(
  publicKey: Uint8Array,
): string {
  assertSecp256k1PublicKey(publicKey);
  return bech32.encodeFromBytes(
    ZERONE_BECH32_PREFIX,
    ripemd160(sha256(publicKey)),
  );
}

export function zeroneSignerKeyId(
  publicKey: Uint8Array,
): `sha256:${string}` {
  assertSecp256k1PublicKey(publicKey);
  return sha256BytesId(publicKey);
}

export function describeZeronePublicKey(publicKey: Uint8Array): Readonly<{
  readonly public_key_b64u: string;
  readonly public_key_hex: string;
  readonly signer_key_id: `sha256:${string}`;
  readonly address: string;
}> {
  assertSecp256k1PublicKey(publicKey);
  const snapshot = Uint8Array.from(publicKey);
  return Object.freeze({
    public_key_b64u: base64UrlEncode(snapshot),
    public_key_hex: bytesToHex(snapshot),
    signer_key_id: zeroneSignerKeyId(snapshot),
    address: zeroneAddressFromSecp256k1PublicKey(snapshot),
  });
}
