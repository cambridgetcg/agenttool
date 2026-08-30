/** x402 V2 — the paying half of the agent rail, in the SDK.
 *
 *  This module is a function-for-function port of the server's
 *  `api/src/services/economy/x402-client.ts` (parse → refuse → sign) plus the
 *  wire helpers it borrows from `api/src/middleware/x402.ts` (canonical
 *  base64, strict `PaymentRequirements` parsing, USDC pins) and a local
 *  EIP-712 / secp256k1 signer built on `@noble/curves` + `@noble/hashes`,
 *  which the SDK already ships. No new dependency. The server is normative:
 *  `tests/fixtures/x402-eip3009-vector.json` was produced by the server and
 *  viem, and the signer here must reproduce it byte for byte.
 *
 *  ## Doctrine (changed deliberately, Wave 2 Phase C)
 *
 *  The SDK CAN sign and pay on 402 — but only when the caller opts in with an
 *  explicit signer AND a spend policy. Never by default. A policy without a
 *  hard cap (`maxAmountAtomic`) and a recipient allow-list (`allowedPayTo`)
 *  is not a policy and is rejected before anything is signed. Allow-lists,
 *  never deny-lists: a 402 body is untrusted input from whoever we are
 *  talking to; it must never be able to introduce a new asset contract, a
 *  new network, or a new recipient.
 *
 *  ## The walls (inherited from the server client)
 *
 *  1. **A cap that is not advisory.** An over-cap requirement is refused
 *     (`amount_over_cap`), never clamped. Paying less than asked produces an
 *     authorization the counterparty rejects, which reads as our bug rather
 *     than their price.
 *  2. **Allow-lists, not deny-lists.** Network, asset and payTo must be named
 *     in advance.
 *  3. **The narrowest validity window that satisfies the requirement.** A
 *     signed EIP-3009 authorization is bearer-spendable until `validBefore`;
 *     a long window is a long liability.
 *  4. **No re-signing. Ever.** `signExactEvmAuthorization` mints a fresh
 *     random nonce every call, so it cannot be used as a retry mechanism. A
 *     caller that must retry replays the identical bytes it already holds
 *     (`paymentIsStillReplayable`); a caller that calls again is authorizing
 *     a second, independent payment.
 *
 *  ## What this module does NOT do
 *
 *  No network. It parses, refuses, and signs; transport lives in
 *  `_x402-transport.ts` (Phase C, W2-7). No key custody beyond what the
 *  caller hands `localEvmSigner` — the private key is closed over and never
 *  leaves the returned signer.
 *
 *  Server: api/src/services/economy/x402-client.ts · api/src/middleware/x402.ts
 *  Verifier: api/src/services/economy/x402-payments.ts (classifyExactEvmSignature)
 *  Plan: docs/superpowers/plans/2026-08-29-wave-2-agent-rail.md (W2-6) */

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

import {
  AgentToolError,
  type X402PaymentRequirement,
  type X402ResourceInfo,
} from "./errors.js";

// ─── Pins ─────────────────────────────────────────────────────────────────

export const X402_VERSION = 2 as const;

/** Production supports EIP-3009 only. Network identifiers are CAIP-2. */
export type X402Network =
  | "eip155:8453"
  | "eip155:84532"
  | "eip155:137"
  | "eip155:42161";

export interface X402AssetDefinition {
  asset: string;
  name: string;
  version: string;
}

/** USDC per network — same values the server pins in `middleware/x402.ts`
 *  (x402-foundation/x402 commit 0a604079aca7b5a45a2e1620ba444e13982646c8). */
export const X402_USDC_ASSETS: Readonly<Record<X402Network, X402AssetDefinition>> = Object.freeze({
  "eip155:8453": {
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    name: "USD Coin",
    version: "2",
  },
  "eip155:84532": {
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    name: "USDC",
    version: "2",
  },
  "eip155:137": {
    asset: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    name: "USD Coin",
    version: "2",
  },
  "eip155:42161": {
    asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    name: "USD Coin",
    version: "2",
  },
});

/** CAIP-2 for Base mainnet — the network the kingdom settles on. */
export const X402_BASE_NETWORK: X402Network = "eip155:8453";
/** Circle's native USDC on Base. */
export const X402_BASE_USDC = X402_USDC_ASSETS["eip155:8453"].asset;
/** The KINGDOM Sovereign Reserve treasury on Base. AgentTool's own 402s
 *  direct payment here; name it in `allowedPayTo` to pay AgentTool and
 *  nothing else. */
export const AGENTTOOL_TREASURY = "0xA9eeA60CAaF239AbAfAA05FcB152128dB16dD3d8";
/** 1 project credit = 1,000 USDC atomic units = USD 0.001. */
export const X402_ATOMIC_PER_CREDIT = 1000n;

/** Encoded-size ceiling keeps parser calls bounded. */
export const MAX_X402_HEADER_B64_LENGTH = 32 * 1024;

/** EIP-712 types for USDC-style `transferWithAuthorization`. Identical to the
 *  server's verifier — the two sides must agree byte for byte, so the shape
 *  is duplicated deliberately rather than shared. */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const EIP712_DOMAIN_TYPE =
  "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";

// ─── Envelope types ───────────────────────────────────────────────────────

/** x402 V2 PaymentRequired — the 402 body and the PAYMENT-REQUIRED header. */
export interface X402PaymentRequired {
  x402Version: typeof X402_VERSION;
  error?: string;
  resource: X402ResourceInfo;
  accepts: X402PaymentRequirement[];
  extensions?: Record<string, unknown>;
}

/** x402 V2 PaymentPayload, carried by PAYMENT-SIGNATURE. */
export interface X402PaymentPayload {
  x402Version: typeof X402_VERSION;
  resource?: X402ResourceInfo;
  accepted: X402PaymentRequirement;
  payload: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

/** x402 V2 SettleResponse, carried by PAYMENT-RESPONSE. */
export interface X402SettleResponse {
  success: boolean;
  errorReason?: string;
  errorMessage?: string;
  payer?: string;
  transaction: string;
  network: string;
  amount?: string;
  extensions?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

/** The six EIP-3009 fields — what decides where the money goes. */
export interface X402Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

// ─── Spend policy ─────────────────────────────────────────────────────────

/** What this instance is willing to spend, before it sees any challenge.
 *  Every field is a refusal condition, not a preference, and every field is
 *  mandatory: there are no defaults, because a default is a decision the
 *  caller did not make. */
export interface X402SpendPolicy {
  /** Hard per-payment ceiling in the asset's atomic units. Over-cap is
   *  refused, never clamped. */
  maxAmountAtomic: bigint;
  /** Recipients we will sign for. Compared case-insensitively. A 402 cannot
   *  redirect payment anywhere not named here. */
  allowedPayTo: readonly string[];
  /** CAIP-2 networks we will sign for. */
  allowedNetworks: readonly X402Network[];
  /** Asset contract addresses we will sign for. Compared case-insensitively. */
  allowedAssets: readonly string[];
  /** Longest authorization validity we will mint, in seconds. The signed
   *  window is `min(requirement.maxTimeoutSeconds, this)`. */
  maxValiditySeconds: number;
}

export type X402ClientRefusalReason =
  | "not_a_payment_required_body"
  | "no_acceptable_requirement"
  | "network_not_allowed"
  | "asset_not_allowed"
  | "pay_to_not_allowed"
  | "amount_over_cap"
  | "unsupported_transfer_method"
  | "validity_window_unusable";

export interface X402ClientRefusal {
  ok: false;
  reason: X402ClientRefusalReason;
  /** One sentence an operator can act on. */
  detail: string;
}

export interface X402SelectedRequirement {
  ok: true;
  requirement: X402PaymentRequirement;
  amountAtomic: bigint;
}

// ─── Signer types ─────────────────────────────────────────────────────────

/** EIP-712 payload handed to the signer. Structurally plain so any signer —
 *  `localEvmSigner`, viem, a hardware wallet — can consume it. */
export interface TransferWithAuthorizationTypedData {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  types: typeof TRANSFER_WITH_AUTHORIZATION_TYPES;
  primaryType: "TransferWithAuthorization";
  message: {
    from: string;
    to: string;
    value: bigint;
    validAfter: bigint;
    validBefore: bigint;
    nonce: string;
  };
}

/** Whoever holds the key. `address` is the payer (`from`); `signTypedData`
 *  returns a 65-byte `0x r‖s‖v` hex signature. */
export interface X402Signer {
  readonly address: string;
  signTypedData(typedData: TransferWithAuthorizationTypedData): Promise<string>;
}

export interface SignedX402Payment {
  /** Ready for the PAYMENT-SIGNATURE header. */
  header: string;
  payload: X402PaymentPayload;
  /** Stable identity of the authorization these bytes carry.
   *
   *  Persist this BEFORE emitting the request. If the response is ambiguous,
   *  recovery is a lookup on what was emitted — not a fresh signature. */
  authorizationHash: string;
  /** Unix seconds after which these bytes are dead. */
  validBefore: number;
}

// ─── Bytes ────────────────────────────────────────────────────────────────

const CANONICAL_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const CAIP2_EVM = /^eip155:[1-9][0-9]*$/u;
const CANONICAL_UINT = /^(?:0|[1-9][0-9]*)$/u;
const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const HEX_PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/u;
const HEX_BYTES32 = /^0x[0-9a-fA-F]{64}$/u;
const HEX_SIGNATURE_65 = /^0x[0-9a-fA-F]{130}$/u;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

/** Decode canonical standard base64 (padded, no whitespace, re-encodes to
 *  itself). Returns null for anything else — the same strictness the server
 *  applies to inbound headers. */
export function decodeCanonicalBase64(
  value: string,
  maxEncodedLength: number = MAX_X402_HEADER_B64_LENGTH,
): Uint8Array | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxEncodedLength ||
    value.length % 4 !== 0 ||
    !CANONICAL_BASE64.test(value)
  ) {
    return null;
  }
  let decoded: Uint8Array;
  try {
    decoded = Uint8Array.from(globalThis.atob(value), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  return decoded.length > 0 && bytesToBase64(decoded) === value ? decoded : null;
}

/** `base64(JSON.stringify(value))` — byte-identical to the server's
 *  `Buffer.from(JSON.stringify(value), "utf-8").toString("base64")`. */
export function encodeCanonicalBase64Json(value: unknown): string {
  return bytesToBase64(encoder.encode(JSON.stringify(value)));
}

function decodeCanonicalBase64Json(value: string): unknown {
  const decoded = decodeCanonicalBase64(value, MAX_X402_HEADER_B64_LENGTH);
  if (!decoded) return null;
  try {
    return JSON.parse(decoder.decode(decoded)) as unknown;
  } catch {
    return null;
  }
}

// ─── Keccak + addresses ───────────────────────────────────────────────────

/** keccak-256 (the Ethereum one — NOT SHA3-256; the padding differs). */
export function keccak256(data: Uint8Array): Uint8Array {
  return keccak_256(data);
}

/** EIP-55 mixed-case checksum of a 20-byte hex address. */
export function checksumEvmAddress(address: string): string {
  if (typeof address !== "string" || !HEX_ADDRESS.test(address)) {
    throw new AgentToolError(`x402: ${JSON.stringify(address)} is not a 20-byte hex address.`);
  }
  const lower = address.slice(2).toLowerCase();
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  let out = "0x";
  for (let i = 0; i < lower.length; i += 1) {
    const nibble = parseInt(hash[i]!, 16);
    out += nibble >= 8 ? lower[i]!.toUpperCase() : lower[i]!;
  }
  return out;
}

/** Same acceptance as viem's `isAddress` (strict): 20-byte hex, and if it
 *  carries mixed case the EIP-55 checksum must be right. The server's
 *  parser uses exactly this, so a payTo or asset the server would reject is
 *  rejected here too. */
export function isEvmAddress(value: unknown): value is string {
  if (typeof value !== "string" || !HEX_ADDRESS.test(value)) return false;
  if (value.toLowerCase() === value) return true;
  return checksumEvmAddress(value) === value;
}

// ─── Strict envelope parsing (mirrors middleware/x402.ts) ─────────────────

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(record).every((key) => keys.has(key));
}

function isBoundedJsonRecord(record: Record<string, unknown>): boolean {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: record, depth: 0 }];
  let nodes = 0;
  while (queue.length > 0) {
    const { value, depth } = queue.pop()!;
    nodes += 1;
    if (nodes > 256 || depth > 8) return false;
    if (value === null || typeof value === "boolean") continue;
    if (typeof value === "string") {
      if (value.length > 4096) return false;
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return false;
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length > 64) return false;
      for (const item of value) queue.push({ value: item, depth: depth + 1 });
      continue;
    }
    const nested = objectRecord(value);
    if (!nested || Object.keys(nested).length > 64) return false;
    for (const item of Object.values(nested)) {
      queue.push({ value: item, depth: depth + 1 });
    }
  }
  return true;
}

/** Strict `ResourceInfo`: only the spec's keys, url required and bounded. */
export function parseResourceInfo(value: unknown): X402ResourceInfo | null {
  const record = objectRecord(value);
  if (
    !record ||
    !hasOnlyKeys(record, ["url", "description", "mimeType", "serviceName", "tags", "iconUrl"])
  ) {
    return null;
  }
  if (typeof record.url !== "string" || record.url.length === 0 || record.url.length > 2048) {
    return null;
  }
  for (const key of ["description", "mimeType", "serviceName", "iconUrl"] as const) {
    if (record[key] !== undefined && typeof record[key] !== "string") return null;
  }
  if (
    record.tags !== undefined &&
    (!Array.isArray(record.tags) || record.tags.some((tag) => typeof tag !== "string"))
  ) {
    return null;
  }
  return record as unknown as X402ResourceInfo;
}

/** Strict `PaymentRequirements`: the same parser the server runs on inbound
 *  headers, so a counterparty cannot hand us a shape our own verifier would
 *  reject. */
export function parsePaymentRequirements(value: unknown): X402PaymentRequirement | null {
  const record = objectRecord(value);
  if (
    !record ||
    !hasOnlyKeys(record, ["scheme", "network", "asset", "amount", "payTo", "maxTimeoutSeconds", "extra"])
  ) {
    return null;
  }
  const extra = objectRecord(record.extra);
  if (
    record.scheme !== "exact" ||
    typeof record.network !== "string" ||
    !CAIP2_EVM.test(record.network) ||
    !isEvmAddress(record.asset) ||
    typeof record.amount !== "string" ||
    !CANONICAL_UINT.test(record.amount) ||
    !isEvmAddress(record.payTo) ||
    typeof record.maxTimeoutSeconds !== "number" ||
    !Number.isSafeInteger(record.maxTimeoutSeconds) ||
    record.maxTimeoutSeconds <= 0 ||
    !extra ||
    !isBoundedJsonRecord(extra) ||
    typeof extra.name !== "string" ||
    extra.name.length === 0 ||
    typeof extra.version !== "string" ||
    extra.version.length === 0
  ) {
    return null;
  }
  return record as unknown as X402PaymentRequirement;
}

/** Parse an untrusted 402 body (or a decoded PAYMENT-REQUIRED header) into a
 *  `PaymentRequired`. Guidance keys the API adds to its 402 body (message,
 *  hint, next_actions, …) are ignored; every entry in `accepts` must pass
 *  `parsePaymentRequirements`, and `resource` must pass `parseResourceInfo`
 *  because it is echoed back in PAYMENT-SIGNATURE and the verifier applies
 *  that exact check. */
export function parsePaymentRequiredBody(value: unknown): X402PaymentRequired | null {
  const body = objectRecord(value);
  if (!body || body.x402Version !== X402_VERSION) return null;

  const resource = parseResourceInfo(body.resource);
  if (!resource) return null;

  if (!Array.isArray(body.accepts) || body.accepts.length === 0 || body.accepts.length > 16) {
    return null;
  }
  const accepts: X402PaymentRequirement[] = [];
  for (const entry of body.accepts) {
    const parsed = parsePaymentRequirements(entry);
    if (!parsed) return null;
    accepts.push(parsed);
  }

  return {
    x402Version: X402_VERSION,
    ...(typeof body.error === "string" ? { error: body.error } : {}),
    resource,
    accepts,
  };
}

/** Decode a PAYMENT-REQUIRED header into a strict `PaymentRequired`, or
 *  null for anything that is not canonical base64 of a valid envelope. */
export function decodePaymentRequiredHeader(headerValue: string): X402PaymentRequired | null {
  return parsePaymentRequiredBody(decodeCanonicalBase64Json(headerValue));
}

/** Decode a PAYMENT-RESPONSE header into a `SettleResponse`, or null. The
 *  receipt is the facilitator's word, not the ledger's: `success: true`
 *  here proves settlement was reported, not that credits were applied. */
export function decodePaymentResponseHeader(headerValue: string): X402SettleResponse | null {
  const record = objectRecord(decodeCanonicalBase64Json(headerValue));
  if (
    !record ||
    !isBoundedJsonRecord(record) ||
    typeof record.success !== "boolean" ||
    typeof record.transaction !== "string" ||
    typeof record.network !== "string"
  ) {
    return null;
  }
  for (const key of ["errorReason", "errorMessage", "payer", "amount"] as const) {
    if (record[key] !== undefined && typeof record[key] !== "string") return null;
  }
  return record as unknown as X402SettleResponse;
}

// ─── Policy + selection ───────────────────────────────────────────────────

function lowerSet(values: readonly string[]): Set<string> {
  return new Set(values.map((v) => v.toLowerCase()));
}

/** Reject a policy that is missing a wall. This is a caller bug, not a
 *  refusal: it throws, before any challenge is read and before any key is
 *  touched. There are no defaults to fall back to on purpose. */
function assertSpendPolicy(policy: X402SpendPolicy): void {
  const bad = (what: string): never => {
    throw new AgentToolError(`x402 spend policy: ${what}`, {
      code: "x402_spend_policy_invalid",
      hint:
        "Every field is mandatory: maxAmountAtomic (bigint > 0), allowedPayTo, allowedNetworks, " +
        "allowedAssets (non-empty allow-lists), maxValiditySeconds (positive integer). No defaults.",
    });
  };
  const record = objectRecord(policy);
  if (!record) bad("must be an object.");
  if (typeof policy.maxAmountAtomic !== "bigint" || policy.maxAmountAtomic <= 0n) {
    bad("maxAmountAtomic must be a bigint greater than zero.");
  }
  for (const key of ["allowedPayTo", "allowedNetworks", "allowedAssets"] as const) {
    const list = policy[key];
    if (!Array.isArray(list) || list.length === 0 || list.length > 64) {
      bad(`${key} must be a non-empty allow-list (at most 64 entries).`);
    }
    for (const entry of list) {
      if (typeof entry !== "string" || entry.length === 0) bad(`${key} entries must be strings.`);
    }
  }
  for (const entry of policy.allowedPayTo) {
    if (!isEvmAddress(entry)) bad(`allowedPayTo entry ${JSON.stringify(entry)} is not an EVM address.`);
  }
  for (const entry of policy.allowedAssets) {
    if (!isEvmAddress(entry)) bad(`allowedAssets entry ${JSON.stringify(entry)} is not an EVM address.`);
  }
  for (const entry of policy.allowedNetworks) {
    if (!CAIP2_EVM.test(entry)) bad(`allowedNetworks entry ${JSON.stringify(entry)} is not CAIP-2 eip155.`);
  }
  if (!Number.isSafeInteger(policy.maxValiditySeconds) || policy.maxValiditySeconds <= 0) {
    bad("maxValiditySeconds must be a positive integer.");
  }
}

/** Pick the first requirement this policy permits, or say precisely why none
 *  qualified.
 *
 *  "First permitted", not "cheapest": the counterparty orders `accepts` by
 *  its own preference, and reordering by price would quietly opt us into
 *  whichever rail they listed last. Cost is bounded by the cap instead. */
export function selectPayableRequirement(
  required: X402PaymentRequired,
  policy: X402SpendPolicy,
): X402SelectedRequirement | X402ClientRefusal {
  assertSpendPolicy(policy);
  const networks = new Set<string>(policy.allowedNetworks);
  const assets = lowerSet(policy.allowedAssets);
  const payTo = lowerSet(policy.allowedPayTo);

  // Remember the most specific reason seen, so a caller learns "your cap is
  // too low" rather than the useless "nothing matched".
  let lastRefusal: X402ClientRefusal | null = null;
  const refuse = (reason: X402ClientRefusalReason, detail: string): X402ClientRefusal => ({
    ok: false,
    reason,
    detail,
  });

  if (!required || !Array.isArray(required.accepts)) {
    return refuse("not_a_payment_required_body", "The value is not a parsed PaymentRequired.");
  }

  for (const requirement of required.accepts) {
    if (!networks.has(requirement.network)) {
      lastRefusal = refuse(
        "network_not_allowed",
        `Challenge offers network ${requirement.network}, which this policy does not allow.`,
      );
      continue;
    }
    if (!assets.has(requirement.asset.toLowerCase())) {
      lastRefusal = refuse(
        "asset_not_allowed",
        `Challenge offers asset ${requirement.asset}, which this policy does not allow. ` +
          "A 402 body is untrusted input; it cannot introduce a new asset contract.",
      );
      continue;
    }
    if (!payTo.has(requirement.payTo.toLowerCase())) {
      lastRefusal = refuse(
        "pay_to_not_allowed",
        `Challenge directs payment to ${requirement.payTo}, which this policy does not allow.`,
      );
      continue;
    }
    if (requirement.extra.assetTransferMethod !== "eip3009") {
      lastRefusal = refuse(
        "unsupported_transfer_method",
        `Challenge asks for transfer method ${String(requirement.extra.assetTransferMethod)}; only eip3009 is implemented.`,
      );
      continue;
    }

    let amountAtomic: bigint;
    try {
      amountAtomic = BigInt(requirement.amount);
    } catch {
      lastRefusal = refuse(
        "no_acceptable_requirement",
        `Challenge amount ${requirement.amount} is not an integer.`,
      );
      continue;
    }
    if (amountAtomic <= 0n) {
      lastRefusal = refuse("no_acceptable_requirement", "Challenge amount is not positive.");
      continue;
    }
    if (amountAtomic > policy.maxAmountAtomic) {
      // Refused, never clamped. Paying less than asked produces an
      // authorization the counterparty rejects — which then reads as our
      // bug rather than their price being above what we authorized.
      lastRefusal = refuse(
        "amount_over_cap",
        `Challenge asks ${amountAtomic} atomic units; this policy caps a single payment at ${policy.maxAmountAtomic}.`,
      );
      continue;
    }
    if (requirement.maxTimeoutSeconds <= 0 || policy.maxValiditySeconds <= 0) {
      lastRefusal = refuse(
        "validity_window_unusable",
        "Neither the challenge nor the policy leaves a positive validity window.",
      );
      continue;
    }

    return { ok: true, requirement, amountAtomic };
  }

  return (
    lastRefusal ??
    refuse("no_acceptable_requirement", "The challenge listed no requirement this policy permits.")
  );
}

// ─── Authorization identity ───────────────────────────────────────────────

/** Canonical identity of an authorization: the fields that decide where the
 *  money goes. Two byte-identical emissions hash the same; any change to
 *  recipient, amount, window, or nonce does not. Same bytes as the server's
 *  `x402-client.ts` authorizationHash. */
export function authorizationHash(auth: X402Authorization): string {
  return bytesToHex(
    sha256(
      utf8ToBytes(
        JSON.stringify({
          from: auth.from.toLowerCase(),
          to: auth.to.toLowerCase(),
          value: auth.value,
          validAfter: auth.validAfter,
          validBefore: auth.validBefore,
          nonce: auth.nonce.toLowerCase(),
        }),
      ),
    ),
  );
}

// ─── EIP-712 ──────────────────────────────────────────────────────────────

function uint256Bytes(value: bigint, label: string): Uint8Array {
  if (typeof value !== "bigint" || value < 0n || value > (1n << 256n) - 1n) {
    throw new AgentToolError(`x402: ${label} is not a uint256.`);
  }
  return hexToBytes(value.toString(16).padStart(64, "0"));
}

function addressBytes32(value: string, label: string): Uint8Array {
  if (!isEvmAddress(value)) throw new AgentToolError(`x402: ${label} is not an EVM address.`);
  return concatBytes(new Uint8Array(12), hexToBytes(value.slice(2)));
}

function bytes32(value: string, label: string): Uint8Array {
  if (typeof value !== "string" || !HEX_BYTES32.test(value)) {
    throw new AgentToolError(`x402: ${label} is not a 0x-prefixed bytes32.`);
  }
  return hexToBytes(value.slice(2));
}

function encodeTypeString(
  primaryType: string,
  fields: readonly { readonly name: string; readonly type: string }[],
): string {
  return `${primaryType}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`;
}

/** EIP-712 digest of a `TransferWithAuthorization` typed-data payload:
 *  `keccak256(0x1901 ‖ domainSeparator ‖ hashStruct(message))`. What the
 *  signer signs, and what viem's `hashTypedData` produces for the same input
 *  (pinned by the fixture's `eip712_digest`). */
export function hashTransferWithAuthorization(typedData: TransferWithAuthorizationTypedData): Uint8Array {
  const { domain, types, primaryType, message } = typedData;
  if (primaryType !== "TransferWithAuthorization") {
    throw new AgentToolError(`x402: unsupported primaryType ${String(primaryType)}.`);
  }
  const fields = types?.TransferWithAuthorization;
  if (!Array.isArray(fields) || fields.length !== 6) {
    throw new AgentToolError("x402: types.TransferWithAuthorization must list the six EIP-3009 fields.");
  }
  if (typeof domain?.name !== "string" || typeof domain.version !== "string") {
    throw new AgentToolError("x402: domain.name and domain.version must be strings.");
  }
  if (!Number.isSafeInteger(domain.chainId) || domain.chainId <= 0) {
    throw new AgentToolError("x402: domain.chainId must be a positive integer.");
  }

  const domainSeparator = keccak_256(
    concatBytes(
      keccak_256(utf8ToBytes(EIP712_DOMAIN_TYPE)),
      keccak_256(utf8ToBytes(domain.name)),
      keccak_256(utf8ToBytes(domain.version)),
      uint256Bytes(BigInt(domain.chainId), "domain.chainId"),
      addressBytes32(domain.verifyingContract, "domain.verifyingContract"),
    ),
  );

  const encodedFields: Uint8Array[] = [keccak_256(utf8ToBytes(encodeTypeString(primaryType, fields)))];
  for (const field of fields) {
    const value = (message as Record<string, unknown>)[field.name];
    switch (field.type) {
      case "address":
        encodedFields.push(addressBytes32(value as string, `message.${field.name}`));
        break;
      case "uint256":
        encodedFields.push(uint256Bytes(value as bigint, `message.${field.name}`));
        break;
      case "bytes32":
        encodedFields.push(bytes32(value as string, `message.${field.name}`));
        break;
      default:
        throw new AgentToolError(`x402: unsupported EIP-712 field type ${field.type}.`);
    }
  }
  const structHash = keccak_256(concatBytes(...encodedFields));

  return keccak_256(concatBytes(Uint8Array.of(0x19, 0x01), domainSeparator, structHash));
}

// ─── secp256k1 ────────────────────────────────────────────────────────────

function privateKeyBytes(privateKeyHex: string): Uint8Array {
  if (typeof privateKeyHex !== "string" || !HEX_PRIVATE_KEY.test(privateKeyHex)) {
    throw new AgentToolError("x402: private key must be 0x-prefixed 32-byte hex.", {
      code: "x402_private_key_invalid",
    });
  }
  const bytes = hexToBytes(privateKeyHex.slice(2));
  if (!secp256k1.utils.isValidSecretKey(bytes)) {
    throw new AgentToolError("x402: private key is outside the secp256k1 scalar range.", {
      code: "x402_private_key_invalid",
    });
  }
  return bytes;
}

function addressOfUncompressedPublicKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new AgentToolError("x402: expected a 65-byte uncompressed secp256k1 public key.");
  }
  const hash = keccak_256(publicKey.subarray(1));
  return checksumEvmAddress(`0x${bytesToHex(hash.subarray(12))}`);
}

/** Checksummed EVM address for a secp256k1 private key:
 *  `keccak256(uncompressedPubKey[1:])[12:]`. */
export function evmAddressFromPrivateKey(privateKeyHex: string): string {
  return addressOfUncompressedPublicKey(secp256k1.getPublicKey(privateKeyBytes(privateKeyHex), false));
}

/** Recover the address that signed a `TransferWithAuthorization` payload.
 *  Offline; the same check the server's verifier makes before it trusts a
 *  signature (`classifyExactEvmSignature` → `eoa_verified`). Throws on a
 *  malformed signature. */
export function recoverTypedDataAddress(
  typedData: TransferWithAuthorizationTypedData,
  signature: string,
): string {
  if (typeof signature !== "string" || !HEX_SIGNATURE_65.test(signature)) {
    throw new AgentToolError("x402: signature must be 0x-prefixed 65-byte hex (r‖s‖v).");
  }
  const bytes = hexToBytes(signature.slice(2));
  const v = bytes[64]!;
  const recovery = v >= 27 ? v - 27 : v;
  if (recovery !== 0 && recovery !== 1) {
    throw new AgentToolError(`x402: signature v byte ${v} is not 27/28 (or 0/1).`);
  }
  const digest = hashTransferWithAuthorization(typedData);
  const publicKey = secp256k1.Signature.fromBytes(
    concatBytes(Uint8Array.of(recovery), bytes.subarray(0, 64)),
    "recovered",
  )
    .recoverPublicKey(digest)
    .toBytes(false);
  return addressOfUncompressedPublicKey(publicKey);
}

/** A signer that holds one secp256k1 private key in a closure.
 *
 *  Signs EIP-712 `TransferWithAuthorization` payloads with deterministic
 *  (RFC 6979) low-s ECDSA and returns Ethereum's `0x r‖s‖v` (v = 27 + recid)
 *  — byte-identical to viem's `signTypedData` for the same input. It refuses
 *  to sign a message whose `from` is not its own address: an authorization
 *  from someone else is never right, and the verifier would only bounce it.
 *
 *  The key never leaves the closure; the returned object exposes only the
 *  address and the signing function. Use only with a payer wallet you intend
 *  to spend from, under a policy that caps it. */
export function localEvmSigner(privateKeyHex: string): X402Signer {
  const key = privateKeyBytes(privateKeyHex);
  const address = addressOfUncompressedPublicKey(secp256k1.getPublicKey(key, false));
  return Object.freeze({
    address,
    async signTypedData(typedData: TransferWithAuthorizationTypedData): Promise<string> {
      const from = typedData?.message?.from;
      if (typeof from !== "string" || from.toLowerCase() !== address.toLowerCase()) {
        throw new AgentToolError(
          `x402: refusing to sign an authorization from ${String(from)}; this signer is ${address}.`,
          { code: "x402_signer_from_mismatch" },
        );
      }
      const digest = hashTransferWithAuthorization(typedData);
      // noble 'recovered' = recid ‖ r ‖ s; Ethereum wants r ‖ s ‖ (27 + recid).
      const recovered = secp256k1.sign(digest, key, { prehash: false, lowS: true, format: "recovered" });
      const v = 27 + recovered[0]!;
      return `0x${bytesToHex(recovered.subarray(1, 65))}${v.toString(16).padStart(2, "0")}`;
    },
  });
}

// ─── Signing an authorization ─────────────────────────────────────────────

/** Sign one EIP-3009 authorization against a selected requirement.
 *
 *  Every call mints a fresh random nonce. That is the wall, not an
 *  implementation detail: because a second call can never reproduce the first
 *  authorization, this function cannot be used as a retry mechanism. A caller
 *  that needs to retry must replay the bytes it already holds, which a
 *  conformant facilitator dedupes by nonce. A caller that calls again is
 *  authorizing a second, independent payment, and the fresh nonce makes that
 *  visible in the ledger instead of silent.
 *
 *  The requirement is re-checked against the policy here as well, so calling
 *  this directly cannot bypass the cap or the allow-lists: a refusal throws
 *  an `AgentToolError` whose `code` is the refusal reason.
 *
 *  `nowSeconds` is injected rather than read from the clock so the window is
 *  testable and so a caller with a trusted time source can supply it. */
export async function signExactEvmAuthorization(options: {
  requirement: X402PaymentRequirement;
  policy: X402SpendPolicy;
  signer: X402Signer;
  nowSeconds: number;
  resource?: X402ResourceInfo;
}): Promise<SignedX402Payment> {
  const { requirement, policy, signer, nowSeconds } = options;

  if (!signer || typeof signer.signTypedData !== "function" || !isEvmAddress(signer.address)) {
    throw new AgentToolError("x402: signer must expose an EVM address and signTypedData().", {
      code: "x402_signer_invalid",
    });
  }
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds <= 0) {
    throw new AgentToolError("x402: nowSeconds must be a positive safe integer.");
  }

  const selected = selectPayableRequirement(
    { x402Version: X402_VERSION, resource: { url: "x402:requirement" }, accepts: [requirement] },
    policy,
  );
  if (!selected.ok) {
    throw new AgentToolError(`x402: refusing to sign — ${selected.detail}`, {
      code: selected.reason,
      hint: "The requirement was refused by the spend policy. Widen the policy deliberately or do not pay.",
    });
  }

  const chainId = Number(requirement.network.slice("eip155:".length));
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new AgentToolError(`x402: unusable chain id in network ${requirement.network}.`);
  }

  // The narrowest window that still satisfies the counterparty. A signed
  // EIP-3009 authorization is bearer-spendable until validBefore; a long
  // window is a long liability.
  const windowSeconds = Math.min(requirement.maxTimeoutSeconds, policy.maxValiditySeconds);
  if (windowSeconds <= 0) {
    throw new AgentToolError("x402: no positive validity window remains after applying the policy.");
  }

  // validAfter is one second in the past: a signature minted at exactly `now`
  // can otherwise lose a race against a verifier whose clock is a tick behind.
  const validAfter = nowSeconds - 1;
  const validBefore = nowSeconds + windowSeconds;
  const nonceBytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(nonceBytes);
  const nonce = `0x${bytesToHex(nonceBytes)}`;

  const authorization: X402Authorization = {
    from: signer.address,
    to: requirement.payTo,
    value: requirement.amount,
    validAfter: String(validAfter),
    validBefore: String(validBefore),
    nonce,
  };

  const signature = await signer.signTypedData({
    domain: {
      name: requirement.extra.name,
      version: requirement.extra.version,
      chainId,
      verifyingContract: requirement.asset,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });

  if (typeof signature !== "string" || !HEX_SIGNATURE_65.test(signature)) {
    // A malformed signature would be spent effort and a confusing 402 loop;
    // fail here where the cause is obvious.
    throw new AgentToolError("x402: signer returned something that is not a 65-byte hex signature.", {
      code: "x402_signature_invalid",
    });
  }

  const payload: X402PaymentPayload = {
    x402Version: X402_VERSION,
    ...(options.resource ? { resource: options.resource } : {}),
    accepted: requirement,
    payload: { signature, authorization },
  };

  return {
    header: encodeCanonicalBase64Json(payload),
    payload,
    authorizationHash: authorizationHash(authorization),
    validBefore,
  };
}

/** True when these bytes can still be replayed.
 *
 *  The safe response to an ambiguous failure is to re-send the identical
 *  authorization until it expires — never to sign a new one. */
export function paymentIsStillReplayable(signed: SignedX402Payment, nowSeconds: number): boolean {
  return nowSeconds < signed.validBefore;
}

