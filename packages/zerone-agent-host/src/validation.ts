import type { Sha256Id } from "@agenttool/wallet";
import {
  getZeroneProfile,
  assertZeroneAccountId,
  type ZeroneAccountId,
  type ZeroneCaip2,
} from "@agenttool/wallet-zerone";
import type { TreasuryPurpose } from "@agenttool/zerone-agent-economy";

import { TREASURY_PURPOSES } from "./constants.js";
import { fail } from "./errors.js";
import type { BindingProofReference, ZeroneAccountSnapshot } from "./types.js";

const UINT64_MAX = (1n << 64n) - 1n;
const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;
const TX_HASH = /^[0-9A-F]{64}$/u;
const BLOCK_HASH = /^[0-9A-F]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;

export function assertSha256Id(value: unknown, label: string): asserts value is Sha256Id {
  if (typeof value !== "string" || !SHA256_ID.test(value)) {
    fail("invalid_input", `${label} must be sha256:<64 lowercase hexadecimal characters>`);
  }
}

export function assertTxHash(value: unknown, label = "tx_hash"): asserts value is string {
  if (typeof value !== "string" || !TX_HASH.test(value)) {
    fail("invalid_input", `${label} must be 64 uppercase hexadecimal characters`);
  }
}

export function assertBlockHash(value: unknown, label = "block_hash"): asserts value is string {
  if (typeof value !== "string" || !BLOCK_HASH.test(value)) {
    fail("invalid_input", `${label} must be 64 uppercase hexadecimal characters`);
  }
}

export function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    fail("invalid_input", `${label} must be a bounded identifier`);
  }
}

export function parseUint64(value: unknown, label: string, positive = false): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/u.test(value)) {
    fail("invalid_input", `${label} must be a canonical uint64 decimal string`);
  }
  const parsed = BigInt(value);
  if (parsed > UINT64_MAX || (positive && parsed === 0n)) {
    fail("invalid_input", `${label} is outside uint64`);
  }
  return parsed;
}

export function assertCount(value: unknown, label: string, positive = false): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < (positive ? 1 : 0)) {
    fail("invalid_input", `${label} must be a ${positive ? "positive" : "non-negative"} safe integer`);
  }
}

export function assertTimestamp(value: unknown, label: string): asserts value is string {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || !Number.isFinite(parsed)
    || new Date(parsed).toISOString() !== value
  ) {
    fail("invalid_input", `${label} must be a canonical millisecond UTC timestamp`);
  }
}

export function assertPurpose(value: unknown, label: string): asserts value is TreasuryPurpose {
  if (typeof value !== "string" || !(TREASURY_PURPOSES as readonly string[]).includes(value)) {
    fail("invalid_input", `${label} is not a supported treasury purpose`);
  }
}

export function validateProofReference(value: BindingProofReference): BindingProofReference {
  if (
    value.format !== "agenttool.zerone-binding-proof-reference/0.1"
    || value.currentness !== "asserted_by_injected_resolver"
    || value.effects_performed !== false
  ) {
    fail("invalid_input", "Binding proof reference boundary is invalid");
  }
  assertSha256Id(value.proof_id, "proof.proof_id");
  assertIdentifier(value.verifier_id, "proof.verifier_id");
  assertTimestamp(value.verified_at, "proof.verified_at");
  assertCount(value.wallet_revocation_nonce, "proof.wallet_revocation_nonce");
  return Object.freeze({ ...value });
}

export function validateAccountSnapshot(value: ZeroneAccountSnapshot): ZeroneAccountSnapshot {
  const network = value.chain_id === "cosmos:zerone-1"
    ? "mainnet"
    : value.chain_id === "cosmos:zerone-testnet-1"
      ? "testnet"
      : null;
  if (network === null) fail("invalid_input", "account_snapshot.chain_id is not a Zerone profile");
  const profile = getZeroneProfile(network);
  try {
    assertZeroneAccountId(value.account, profile, "account_snapshot.account");
  } catch {
    fail("invalid_input", "account_snapshot.account does not match chain_id");
  }
  parseUint64(value.account_number, "account_snapshot.account_number");
  parseUint64(value.sequence, "account_snapshot.sequence");
  parseUint64(value.balance_uzrn, "account_snapshot.balance_uzrn");
  parseUint64(value.observed_at_height, "account_snapshot.observed_at_height", true);
  assertBlockHash(value.block_hash, "account_snapshot.block_hash");
  assertTimestamp(value.observed_at, "account_snapshot.observed_at");
  return Object.freeze({ ...value }) as ZeroneAccountSnapshot;
}

export function networkForChain(chainId: ZeroneCaip2): "mainnet" | "testnet" {
  return chainId === "cosmos:zerone-1" ? "mainnet" : "testnet";
}

export function asZeroneAccount(value: string): ZeroneAccountId {
  return value as ZeroneAccountId;
}
