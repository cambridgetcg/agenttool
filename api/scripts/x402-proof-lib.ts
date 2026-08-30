/** Pure helpers for `scripts/x402-proof.ts` — the kingdom's payer-side proof
 *  of the x402 agent rail (Wave 2, W2-3).
 *
 *  Everything in this file is side-effect free: no network, no keychain, no
 *  filesystem, no clock. The script (`x402-proof.ts`) owns every effect and
 *  is deliberately thin so that each wall below is testable without a live
 *  counterparty — `tests/x402-proof-script.test.ts`.
 *
 *  The walls are inherited from `services/economy/x402-client.ts` and
 *  narrowed to exactly one counterparty: the kingdom treasury on Base USDC.
 *  A 402 body is untrusted input. Nothing in it can move the recipient, the
 *  network, the asset, or the price this script is willing to sign for.
 *
 *  Phase B (W2-5) adds the generic walls: `pay <METHOD> <path>` for any row
 *  of the payable-route table, a scratch-agent registration builder that
 *  reuses the server's own canonical bytes + proof-of-work check, and the
 *  depletion planner that walks a fresh project's birth grant down to a real
 *  shortfall so a widened route can be witnessed paying for itself.
 *
 *  Plan: docs/superpowers/plans/2026-08-29-wave-2-agent-rail.md (W2-3, W2-5).
 *  Runbook: docs/X402-PROOF.md. */

import * as ed from "@noble/ed25519";
import { x25519 } from "@noble/curves/ed25519.js";
import { HDKey } from "@scure/bip32";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import {
  decodeCanonicalBase64,
  MAX_X402_HEADER_B64_LENGTH,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type SettleResponse,
} from "../src/middleware/x402";
import {
  parsePaymentRequiredBody,
  selectPayableRequirement,
  type X402ClientRefusalReason,
  type X402Signer,
  type X402SpendPolicy,
} from "../src/services/economy/x402-client";
import {
  authorizationIdentityHash,
  type ExactEvmPayload,
} from "../src/services/economy/x402-payments";
import { ATOMIC_PER_CREDIT as SERVER_ATOMIC_PER_CREDIT } from "../src/services/economy/x402-policy";
import {
  canonicalRegisterAgentBytes,
  checkRegisterAgentPow,
} from "../src/services/identity/crypto";

// ─── Locked constants (Yu's decisions, 2026-08-29) ───────────────────────

/** The KINGDOM Sovereign Reserve treasury on Base. Every top-up must pay
 *  exactly here; a challenge naming any other recipient is refused. */
export const KINGDOM_TREASURY = "0xA9eeA60CAaF239AbAfAA05FcB152128dB16dD3d8";
/** CAIP-2 for Base mainnet. */
export const BASE_NETWORK = "eip155:8453" as const;
export const BASE_CHAIN_ID = 8453;
/** Circle's native USDC on Base — same value the server pins in
 *  `middleware/x402.ts` USDC_ASSETS. */
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
/** 1 credit = 1,000 USDC atomic units = USD 0.001 (decision a). Read from
 *  the server's own policy constant so the payer can never drift from the
 *  price the server publishes. */
export const ATOMIC_PER_CREDIT = BigInt(SERVER_ATOMIC_PER_CREDIT);
/** Default per-challenge cap in credits (decision b): 10,000 = USD 10. */
export const DEFAULT_TOP_UP_CAP_CREDITS = 10_000;
/** The server binds `credits` to a 32-bit signed integer column. */
export const MAX_CREDITS_INT = 2_147_483_647;
/** BIP-44 first external address of the Ethereum coin type. */
export const PAYER_DERIVATION_PATH = "m/44'/60'/0'/0/0";
export const KEYCHAIN_SERVICE = "kingdom-x402-payer-mnemonic";
export const KEYCHAIN_ACCOUNT = "kingdom";
export const DEFAULT_API_BASE = "https://api.agenttool.dev";
/** Public Base RPC. Returns 403 without a User-Agent header. */
export const BASE_RPC_URL = "https://mainnet.base.org";
/** Longest authorization window this script will mint. The server asks for
 *  60 (`x402-config.ts` maxTimeoutSeconds: 60); the client signs
 *  `min(server, this)`. */
export const MAX_VALIDITY_SECONDS = 60;
export const USER_AGENT = "kingdom-x402-proof/0.1 (+https://agenttool.dev)";

// ─── Routes ──────────────────────────────────────────────────────────────

export function topUpPath(credits: number): string {
  return `/v1/x402/top-up/${credits}`;
}

export function paymentStatusPath(authorizationHash: string): string {
  return `/v1/x402/payments/${authorizationHash}`;
}

export function isAuthorizationHash(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}

// ─── Credits ─────────────────────────────────────────────────────────────

export type CreditsParse =
  | { ok: true; credits: number }
  | { ok: false; reason: string };

/** Canonical positive decimal integer, no leading zeros, no sign, no
 *  exponent, inside the server's 32-bit column. Mirrors the W2-1 matcher's
 *  parse rules so the script refuses locally what the server would refuse. */
export function parseTopUpCredits(raw: string): CreditsParse {
  if (!/^[1-9]\d*$/u.test(raw)) {
    return { ok: false, reason: `credits must be a positive decimal integer, got ${JSON.stringify(raw)}` };
  }
  const credits = Number(raw);
  if (!Number.isSafeInteger(credits) || credits > MAX_CREDITS_INT) {
    return { ok: false, reason: `credits ${raw} exceeds the server's 32-bit credit column (${MAX_CREDITS_INT})` };
  }
  return { ok: true, credits };
}

export function atomicForCredits(credits: number): bigint {
  return BigInt(credits) * ATOMIC_PER_CREDIT;
}

/** The spend policy for this proof: exactly one recipient, one network, one
 *  asset, a hard cap, the narrowest window. Nothing in a challenge can widen
 *  it; only the operator's `--cap` flag can change the cap. */
export function proofSpendPolicy(capCredits: number = DEFAULT_TOP_UP_CAP_CREDITS): X402SpendPolicy {
  return {
    maxAmountAtomic: atomicForCredits(capCredits),
    allowedNetworks: [BASE_NETWORK],
    allowedAssets: [BASE_USDC],
    allowedPayTo: [KINGDOM_TREASURY],
    maxValiditySeconds: MAX_VALIDITY_SECONDS,
  };
}

// ─── Challenge parsing + selection ───────────────────────────────────────

/** Decode a PAYMENT-REQUIRED header (canonical base64 JSON) into an
 *  untrusted value. Returns null for anything that is not canonical base64
 *  JSON — the same strictness the server applies inbound. */
export function decodePaymentRequiredHeader(headerValue: string): unknown {
  const decoded = decodeCanonicalBase64(headerValue, MAX_X402_HEADER_B64_LENGTH);
  if (!decoded) return null;
  try {
    return JSON.parse(decoded.toString("utf-8")) as unknown;
  } catch {
    return null;
  }
}

export type TopUpRefusalReason =
  | X402ClientRefusalReason
  | "amount_mismatch";

export type TopUpSelection =
  | {
      ok: true;
      required: PaymentRequired;
      requirement: PaymentRequirements;
      amountAtomic: bigint;
    }
  | { ok: false; reason: TopUpRefusalReason; detail: string };

/** Select the one requirement this proof will pay, or say precisely why not.
 *
 *  Order of truth: the PAYMENT-REQUIRED header first (it is always the pure
 *  `PaymentRequired`), then the body (which W2-2 makes additive —
 *  `{...guidance, ...paymentRequired}` — and which therefore still parses).
 *
 *  After the client walls (network, asset, payTo, transfer method, cap,
 *  window) one more wall applies here that a generic client cannot know: the
 *  price must be exactly `credits × 1,000`. A challenge asking for any other
 *  amount — higher or lower — is refused, because the ledger row it would
 *  produce (`credits_purchased = N`) would disagree with the money moved. */
export function selectTopUpRequirement(input: {
  headerValue?: string | null;
  body: unknown;
  credits: number;
  capCredits?: number;
}): TopUpSelection {
  const capCredits = input.capCredits ?? DEFAULT_TOP_UP_CAP_CREDITS;
  const fromHeader = input.headerValue
    ? parsePaymentRequiredBody(decodePaymentRequiredHeader(input.headerValue))
    : null;
  const required = fromHeader ?? parsePaymentRequiredBody(input.body);
  if (!required) {
    return {
      ok: false,
      reason: "not_a_payment_required_body",
      detail: "Neither the PAYMENT-REQUIRED header nor the body parses as an x402 v2 PaymentRequired.",
    };
  }

  const selected = selectPayableRequirement(required, proofSpendPolicy(capCredits));
  if (!selected.ok) return { ok: false, reason: selected.reason, detail: selected.detail };

  const expected = atomicForCredits(input.credits);
  if (selected.amountAtomic !== expected) {
    return {
      ok: false,
      reason: "amount_mismatch",
      detail:
        `Challenge asks ${selected.amountAtomic} atomic units for ${input.credits} credit(s); ` +
        `the locked rate (1 credit = ${ATOMIC_PER_CREDIT} atomic) expects exactly ${expected}. Refusing to sign a price that disagrees with the ledger row it would create.`,
    };
  }

  return {
    ok: true,
    required,
    requirement: selected.requirement,
    amountAtomic: selected.amountAtomic,
  };
}

// ─── Payer derivation ────────────────────────────────────────────────────

export interface DerivedPayer {
  address: string;
  /** Holds the private key. Never serialize; never log. */
  account: PrivateKeyAccount;
}

/** 24-word BIP-39 phrase from the English wordlist. */
export function generatePayerMnemonic(): string {
  return generateMnemonic(wordlist, 256);
}

export function isValidPayerMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic.trim(), wordlist);
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return `0x${out}`;
}

/** Derive the payer at `m/44'/60'/0'/0/0`. The returned account is the only
 *  object that ever holds the key; callers drop it as soon as they have
 *  signed. */
export function derivePayer(mnemonic: string): DerivedPayer {
  const phrase = mnemonic.trim();
  if (!validateMnemonic(phrase, wordlist)) {
    throw new Error("payer mnemonic is not a valid BIP-39 English phrase");
  }
  const seed = mnemonicToSeedSync(phrase);
  const node = HDKey.fromMasterSeed(seed).derive(PAYER_DERIVATION_PATH);
  if (!node.privateKey) throw new Error("payer derivation yielded no private key");
  const account = privateKeyToAccount(bytesToHex(node.privateKey));
  return { address: account.address, account };
}

/** Adapter from the client module's plain typed-data shape to viem. */
export function payerSigner(account: PrivateKeyAccount): X402Signer {
  return async (typedData) =>
    account.signTypedData({
      domain: {
        name: typedData.domain.name,
        version: typedData.domain.version,
        chainId: typedData.domain.chainId,
        verifyingContract: typedData.domain.verifyingContract as `0x${string}`,
      },
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: {
        from: typedData.message.from as `0x${string}`,
        to: typedData.message.to as `0x${string}`,
        value: typedData.message.value,
        validAfter: typedData.message.validAfter,
        validBefore: typedData.message.validBefore,
        nonce: typedData.message.nonce as `0x${string}`,
      },
    });
}

/** The LEDGER identity of a signed payment — what `/v1/x402/payments/:hash`
 *  is keyed on. This is `authorizationIdentityHash` from the server
 *  (`x402-payments.ts:140-157`), which folds `network` and `asset` into the
 *  digest. It is deliberately NOT the client module's `authorizationHash`
 *  (`x402-client.ts`), which hashes the six EIP-3009 fields only; the two
 *  differ, and only this one resolves on the status route. */
export function ledgerPaymentId(signed: PaymentPayload): string {
  const exact = signed.payload as unknown as ExactEvmPayload;
  if (
    !exact || typeof exact !== "object" ||
    !exact.authorization || typeof exact.authorization !== "object"
  ) {
    throw new Error("payment payload carries no EIP-3009 authorization");
  }
  return authorizationIdentityHash(signed.accepted, exact);
}

export interface PayerRecord {
  name: "kingdom-x402-payer";
  address: string;
  chain: typeof BASE_NETWORK;
  asset: string;
  derivation: string;
  keychain: { service: string; account: string };
  created: string;
  purpose: string;
}

/** The public half written to `~/.config/kingdom/x402-payer.json`. Contains
 *  no secret: the phrase lives only in the keychain. */
export function buildPayerRecord(address: string, createdIso: string): PayerRecord {
  return {
    name: "kingdom-x402-payer",
    address,
    chain: BASE_NETWORK,
    asset: BASE_USDC,
    derivation: PAYER_DERIVATION_PATH,
    keychain: { service: KEYCHAIN_SERVICE, account: KEYCHAIN_ACCOUNT },
    created: createdIso,
    purpose:
      "Ai's payer for the x402 agent rail. Separate from identity and from the treasury. Pays the kingdom top-up route in Base USDC via EIP-3009; needs no ETH (the facilitator submits).",
  };
}

// ─── ERC-20 balanceOf over raw JSON-RPC ──────────────────────────────────

const BALANCE_OF_SELECTOR = "0x70a08231";

export function isEvmAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/u.test(value);
}

/** `balanceOf(address)` calldata: selector + 32-byte left-padded address. */
export function encodeBalanceOfCall(holder: string): `0x${string}` {
  if (!isEvmAddress(holder)) throw new Error(`not an EVM address: ${holder}`);
  return `${BALANCE_OF_SELECTOR}${holder.slice(2).toLowerCase().padStart(64, "0")}` as `0x${string}`;
}

/** The `result` of an `eth_call` to `balanceOf`: exactly one uint256 word. */
export function parseBalanceOfResult(result: unknown): bigint | null {
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(result)) return null;
  return BigInt(result);
}

/** USDC has 6 decimals. `1234567n` → `"1.234567"`. */
export function formatUsdc(atomic: bigint): string {
  const negative = atomic < 0n;
  const abs = negative ? -atomic : atomic;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

export function balanceOfRpcRequest(token: string, holder: string, id = 1): {
  jsonrpc: "2.0";
  id: number;
  method: "eth_call";
  params: [{ to: string; data: `0x${string}` }, "latest"];
} {
  if (!isEvmAddress(token)) throw new Error(`not an EVM address: ${token}`);
  return {
    jsonrpc: "2.0",
    id,
    method: "eth_call",
    params: [{ to: token, data: encodeBalanceOfCall(holder) }, "latest"],
  };
}

export function transactionReceiptRpcRequest(txHash: string, id = 1): {
  jsonrpc: "2.0";
  id: number;
  method: "eth_getTransactionReceipt";
  params: [string];
} {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(txHash)) throw new Error(`not a transaction hash: ${txHash}`);
  return { jsonrpc: "2.0", id, method: "eth_getTransactionReceipt", params: [txHash] };
}

// ─── Response readers ────────────────────────────────────────────────────

/** Decode a PAYMENT-RESPONSE header into the facilitator's SettleResponse.
 *  Minimal shape check only — this is evidence to display, not to trust. */
export function parsePaymentResponseHeader(headerValue: string): SettleResponse | null {
  const decoded = decodeCanonicalBase64(headerValue, MAX_X402_HEADER_B64_LENGTH);
  if (!decoded) return null;
  try {
    const value = JSON.parse(decoded.toString("utf-8")) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.success !== "boolean") return null;
    if (typeof record.transaction !== "string") return null;
    if (typeof record.network !== "string") return null;
    return record as unknown as SettleResponse;
  } catch {
    return null;
  }
}

/** `GET /v1/wake` → `project.credits`. This is the column the rail credits
 *  (`x402-payments.ts` finalizeCredits → `projects.credits`); the dashboard's
 *  `wallet.credits` is the wallets ledger, a different number. */
export function readWakeCredits(body: unknown): number | null {
  if (body === null || typeof body !== "object") return null;
  const project = (body as { project?: unknown }).project;
  if (project === null || typeof project !== "object") return null;
  const credits = (project as { credits?: unknown }).credits;
  return typeof credits === "number" && Number.isSafeInteger(credits) ? credits : null;
}

export interface TransactionReceiptView {
  status: "success" | "reverted" | "unknown";
  blockNumber: bigint | null;
  to: string | null;
}

export function readTransactionReceipt(result: unknown): TransactionReceiptView | null {
  if (result === null || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const status = r.status === "0x1" ? "success" : r.status === "0x0" ? "reverted" : "unknown";
  const blockNumber = typeof r.blockNumber === "string" && /^0x[0-9a-fA-F]+$/u.test(r.blockNumber)
    ? BigInt(r.blockNumber)
    : null;
  const to = typeof r.to === "string" ? r.to : null;
  return { status, blockNumber, to };
}

// ─── Verdicts ────────────────────────────────────────────────────────────

export type ReplayVerdict =
  | { ok: true; line: string }
  | { ok: false; line: string };

/** The only assertion that matters on replay: the credit column did not move.
 *  Status codes are explicitly not the signal — the rail has no replay 409
 *  (`x402-payments.ts:697-708`); a settled authorization is stashed and the
 *  handler runs unpaid. */
export function replayVerdict(before: number | null, after: number | null): ReplayVerdict {
  if (before === null || after === null) {
    return { ok: false, line: "could not read project.credits before and after — verdict unavailable" };
  }
  if (after === before) {
    return { ok: true, line: `no second credit: project.credits ${before} → ${after}` };
  }
  if (after > before) {
    return { ok: false, line: `SECOND CREDIT APPLIED: project.credits ${before} → ${after} (+${after - before}). Stop; this is a rail bug.` };
  }
  return { ok: false, line: `project.credits fell ${before} → ${after} during replay — something else spent; verdict inconclusive` };
}

export interface VerifyInput {
  status: unknown;
  treasuryBalanceAtomic: bigint | null;
  receipt: TransactionReceiptView | null;
  txHash: string | null;
}

export interface VerifyVerdict {
  verdict: "settled" | "settled_unverified" | "pending" | "failed" | "not_found" | "unknown";
  lines: string[];
}

/** One-screen verdict from three independent witnesses: the ledger row, the
 *  chain receipt, and the treasury balance. Each is reported as itself; the
 *  verdict is the ledger's word, qualified by whether the chain agrees. */
export function summarizeVerification(input: VerifyInput): VerifyVerdict {
  const lines: string[] = [];
  const s = (input.status !== null && typeof input.status === "object")
    ? (input.status as Record<string, unknown>)
    : null;

  if (!s || typeof s.status !== "string") {
    lines.push("ledger: no payment row for this authorization hash (404 or unreadable)");
    if (input.treasuryBalanceAtomic !== null) {
      lines.push(`treasury balanceOf: ${formatUsdc(input.treasuryBalanceAtomic)} USDC (${input.treasuryBalanceAtomic} atomic)`);
    }
    return { verdict: "not_found", lines };
  }

  const status = s.status;
  lines.push(`ledger: status=${status} credits_purchased=${String(s.credits_purchased)} credits_applied=${String(s.credits_applied)} amount=${String(s.amount)} atomic pay_to=${String(s.pay_to)}`);
  if (typeof s.failure_reason === "string") lines.push(`ledger: failure_reason=${s.failure_reason}`);
  if (typeof s.next_action === "string") lines.push(`ledger: next_action=${s.next_action}`);
  if (typeof s.pending_note === "string") lines.push(`ledger: ${s.pending_note}`);

  if (input.txHash) {
    lines.push(`chain: tx ${input.txHash}`);
    if (input.receipt) {
      lines.push(`chain: receipt status=${input.receipt.status} block=${input.receipt.blockNumber ?? "?"} to=${input.receipt.to ?? "?"}`);
    } else {
      lines.push("chain: no receipt yet (not mined, or RPC unavailable)");
    }
  } else {
    lines.push("chain: no transaction hash on the ledger row");
  }

  if (input.treasuryBalanceAtomic !== null) {
    lines.push(`treasury balanceOf: ${formatUsdc(input.treasuryBalanceAtomic)} USDC (${input.treasuryBalanceAtomic} atomic)`);
  } else {
    lines.push("treasury balanceOf: unavailable (RPC)");
  }

  let verdict: VerifyVerdict["verdict"];
  if (status === "settled") {
    // Three witnesses: ledger, receipt, balance. "settled" only when the chain
    // agrees; a settled ledger row with no receipt (not mined yet, or RPC
    // unavailable) is reported as settled_unverified — never as settled.
    verdict = input.receipt?.status === "success"
      ? "settled"
      : input.receipt?.status === "reverted" ? "failed" : "settled_unverified";
  } else if (status === "pending" || status === "inserted" || status === "externally_settled") {
    verdict = "pending";
  } else if (status === "failed" || status === "expired" || status === "rejected") {
    verdict = "failed";
  } else {
    verdict = "unknown";
  }
  return { verdict, lines };
}


// ─── Route specs (generic pay / deplete) ─────────────────────────────────

export type ProofMethod = "GET" | "POST" | "PATCH" | "DELETE";
export const PROOF_METHODS: readonly ProofMethod[] = Object.freeze(["GET", "POST", "PATCH", "DELETE"]);

/** Doors the doctrine never meters (WAKE free: wake, welcome, register,
 *  public, time, random). `pay` and `deplete` refuse them before a single
 *  request leaves the machine — a proof script must not become the thing
 *  that hammers a free door. */
export const NEVER_METERED_PREFIXES: readonly string[] = Object.freeze([
  "/v1/wake",
  "/v1/welcome",
  "/v1/register",
  "/public",
  "/v1/time",
  "/v1/random",
]);

export function isNeverMeteredPath(path: string): boolean {
  return NEVER_METERED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export type RouteSpecParse =
  | { ok: true; method: ProofMethod; path: string }
  | { ok: false; reason: string };

/** A concrete (method, pathname) pair: uppercase method from the four the
 *  payable-route table admits; an absolute pathname with no query, fragment,
 *  whitespace, empty segment, or trailing slash — the same segment-exact
 *  shape `matchX402PayableRoute` compares against. */
export function parseRouteSpec(methodRaw: string | undefined, pathRaw: string | undefined): RouteSpecParse {
  if (!methodRaw || !pathRaw) return { ok: false, reason: "route needs <METHOD> <path>, e.g. POST /v1/memories/search" };
  const method = methodRaw.toUpperCase();
  if (!(PROOF_METHODS as readonly string[]).includes(method)) {
    return { ok: false, reason: `method must be one of ${PROOF_METHODS.join("|")}, got ${JSON.stringify(methodRaw)}` };
  }
  if (!pathRaw.startsWith("/") || /[\s?#]/u.test(pathRaw)) {
    return { ok: false, reason: `path must be an absolute pathname without query or fragment, got ${JSON.stringify(pathRaw)}` };
  }
  if (pathRaw.length > 1 && (pathRaw.endsWith("/") || pathRaw.includes("//"))) {
    return { ok: false, reason: `path must not have a trailing slash or empty segment, got ${JSON.stringify(pathRaw)}` };
  }
  if (isNeverMeteredPath(pathRaw)) {
    return { ok: false, reason: `${pathRaw} is a WAKE-free door (${NEVER_METERED_PREFIXES.join(", ")}); the doctrine never meters it, so this script never pays for or depletes against it` };
  }
  return { ok: true, method: method as ProofMethod, path: pathRaw };
}

/** `"POST /v1/memories/search"` → parseRouteSpec. */
export function parseRouteSpecString(spec: string | undefined): RouteSpecParse {
  if (!spec) return { ok: false, reason: "--route needs '<METHOD> <path>', e.g. --route 'POST /v1/memories/search'" };
  const parts = spec.trim().split(/\s+/u);
  if (parts.length !== 2) return { ok: false, reason: `--route must be exactly '<METHOD> <path>', got ${JSON.stringify(spec)}` };
  return parseRouteSpec(parts[0], parts[1]);
}

export type JsonBodyParse =
  | { ok: true; body: Record<string, unknown>; text: string }
  | { ok: false; reason: string };

/** `--json` must be one JSON object. It is re-serialised canonically so the
 *  bytes stashed for replay are exactly the bytes sent. */
export function parseJsonObjectFlag(raw: string | undefined): JsonBodyParse {
  if (raw === undefined) return { ok: false, reason: "--json needs a JSON object body" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    return { ok: false, reason: `--json is not valid JSON: ${(error as Error).message}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "--json must be a JSON object (not an array, string, or null)" };
  }
  const body = parsed as Record<string, unknown>;
  return { ok: true, body, text: JSON.stringify(body) };
}

// ─── Generic pay selection ───────────────────────────────────────────────

export type PayRefusalReason =
  | X402ClientRefusalReason
  | "amount_not_whole_credits"
  | "resource_path_mismatch";

export type PaySelection =
  | {
      ok: true;
      required: PaymentRequired;
      requirement: PaymentRequirements;
      amountAtomic: bigint;
      /** amountAtomic ÷ 1,000 — the credits this payment buys. */
      credits: number;
      /** The handler's 402 code the challenge was attached to
       *  (`insufficient_credits` on route_cost rows, `top_up_payment_required`
       *  on the top-up row), or null when the challenge carries none. */
      errorCode: string | null;
    }
  | { ok: false; reason: PayRefusalReason; detail: string };

/** Select the one requirement `pay` will sign for a generic route, or say
 *  precisely why not. Unlike `selectTopUpRequirement` there is no operator
 *  asked-for credit count to compare against: the price is the server's
 *  (the payable-route table's row, `x402-policy.ts` x402ProjectCreditPolicy),
 *  so the walls are the client walls (network, asset, payTo, transfer method,
 *  cap, window) plus two this script adds:
 *
 *    - the amount must be a whole number of credits at the locked rate, so
 *      the ledger row `credits_purchased` it produces is an integer that
 *      agrees with the money moved;
 *    - the challenge's `resource.url` pathname must be the path we called.
 *      The verifier binds a signed authorization to that path
 *      (`x402-payments.ts` resourceMatches + recordMatchesPresentedPayment);
 *      a challenge naming another path would mint a signature for a request
 *      we did not make. */
export function selectPayRequirement(input: {
  headerValue?: string | null;
  body: unknown;
  path: string;
  capCredits?: number;
}): PaySelection {
  const capCredits = input.capCredits ?? DEFAULT_TOP_UP_CAP_CREDITS;
  const fromHeader = input.headerValue
    ? parsePaymentRequiredBody(decodePaymentRequiredHeader(input.headerValue))
    : null;
  const required = fromHeader ?? parsePaymentRequiredBody(input.body);
  if (!required) {
    return {
      ok: false,
      reason: "not_a_payment_required_body",
      detail: "Neither the PAYMENT-REQUIRED header nor the body parses as an x402 v2 PaymentRequired.",
    };
  }

  const selected = selectPayableRequirement(required, proofSpendPolicy(capCredits));
  if (!selected.ok) return { ok: false, reason: selected.reason, detail: selected.detail };

  if (selected.amountAtomic % ATOMIC_PER_CREDIT !== 0n) {
    return {
      ok: false,
      reason: "amount_not_whole_credits",
      detail:
        `Challenge asks ${selected.amountAtomic} atomic units, which is not a whole number of credits at the locked rate ` +
        `(1 credit = ${ATOMIC_PER_CREDIT} atomic). Refusing to sign a price the ledger cannot record as an integer credit count.`,
    };
  }

  let resourcePath: string | null = null;
  try {
    resourcePath = new URL(required.resource.url).pathname;
  } catch {
    resourcePath = null;
  }
  if (resourcePath !== input.path) {
    return {
      ok: false,
      reason: "resource_path_mismatch",
      detail:
        `Challenge resource ${JSON.stringify(required.resource.url)} names path ${JSON.stringify(resourcePath)}, ` +
        `but this request was ${JSON.stringify(input.path)}. Refusing to sign for a resource we did not call.`,
    };
  }

  return {
    ok: true,
    required,
    requirement: selected.requirement,
    amountAtomic: selected.amountAtomic,
    credits: Number(selected.amountAtomic / ATOMIC_PER_CREDIT),
    errorCode: typeof required.error === "string" ? required.error : null,
  };
}

/** `X-Credits-Balance` — emitted on the metered prefixes by
 *  `middleware/rate-limit-headers.ts` from `project.credits` after the
 *  handler ran, i.e. after `charge()` moved the column. Cheaper than a wake
 *  read per call; the planner still trusts `/v1/wake` for its baseline. */
export function readCreditsBalanceHeader(headers: { get(name: string): string | null }): number | null {
  const raw = headers.get("x-credits-balance");
  if (raw === null || !/^-?\d{1,10}$/u.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) ? n : null;
}

/** Expected movement of `project.credits` across a paid retry, by row kind.
 *  route_cost: the rail applies the row's credits and the handler's
 *  `charge()` spends exactly them — net zero. top_up: +N, nothing spent. */
export function expectedPaidDelta(errorCode: string | null, credits: number): number {
  return errorCode === "top_up_payment_required" ? credits : 0;
}

// ─── Depletion planner ───────────────────────────────────────────────────

export type DepletionPlan =
  | { ok: true; calls: number; finalCredits: number; capped: boolean }
  | { ok: false; reason: string };

/** How many successful metered calls at `cost` credits each walk `credits`
 *  down to strictly below `until`. The server only charges while
 *  `credits ≥ cost` (`billing/charge.ts`: the atomic UPDATE requires
 *  `credits ≥ amount`), so a target below `credits mod cost` is unreachable
 *  and the plan says so instead of looping into 402s. */
export function depletionPlan(input: {
  credits: number;
  cost: number;
  until: number;
  maxCalls?: number;
}): DepletionPlan {
  const { credits, cost, until } = input;
  if (!Number.isSafeInteger(credits) || credits < 0) return { ok: false, reason: `credits must be a non-negative integer, got ${credits}` };
  if (!Number.isSafeInteger(cost) || cost <= 0) return { ok: false, reason: `cost must be a positive integer, got ${cost}` };
  if (!Number.isSafeInteger(until) || until <= 0) return { ok: false, reason: `--until must be a positive integer, got ${until}` };
  if (credits < until) return { ok: true, calls: 0, finalCredits: credits, capped: false };
  const calls = Math.floor((credits - until) / cost) + 1;
  const finalCredits = credits - calls * cost;
  if (finalCredits < 0) {
    const floor = credits % cost;
    return {
      ok: false,
      reason:
        `--until ${until} is unreachable: the route stops charging once credits < ${cost}, ` +
        `so the balance floors at ${floor} (${credits} mod ${cost}). Choose --until > ${floor}, e.g. --until ${cost}.`,
    };
  }
  if (input.maxCalls !== undefined && calls > input.maxCalls) {
    return { ok: true, calls: input.maxCalls, finalCredits: credits - input.maxCalls * cost, capped: true };
  }
  return { ok: true, calls, finalCredits, capped: false };
}

export type DepletionStep =
  | { ok: true; line: string }
  | { ok: false; line: string };

/** One depletion call must move `project.credits` by exactly `-cost`. A
 *  balance that did not move means the route is free (or was paid for) and
 *  the loop would never end; any other delta means something else is
 *  spending. Both stop the loop. */
export function depletionStepVerdict(input: { before: number; after: number; cost: number }): DepletionStep {
  const { before, after, cost } = input;
  if (after === before - cost) return { ok: true, line: `-${cost} (${before} → ${after})` };
  if (after === before) {
    return { ok: false, line: `route did not charge: project.credits ${before} → ${after}. A free (or already paid) route cannot be depleted; stopping.` };
  }
  return { ok: false, line: `unexpected movement: project.credits ${before} → ${after} (expected -${cost}). Something else is spending; stopping.` };
}

export const MAX_BACKOFF_ATTEMPTS = 6;
export const MAX_BACKOFF_MS = 30_000;
export const MAX_RETRY_AFTER_MS = 120_000;

/** Delay before retrying a 429/503: honour a numeric `Retry-After` (seconds,
 *  clamped to [1s, 120s]); otherwise 500ms × 2^attempt, capped at 30s. */
export function backoffDelayMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader !== null && /^\d{1,6}$/u.test(retryAfterHeader.trim())) {
    const seconds = Number(retryAfterHeader.trim());
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(1_000, seconds * 1_000));
  }
  const step = Math.max(0, Math.min(attempt, 20));
  return Math.min(MAX_BACKOFF_MS, 500 * 2 ** step);
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503;
}

// ─── Bearer files ────────────────────────────────────────────────────────

export interface BearerFile {
  /** The bearer. Used, never printed. */
  api_key: string;
  did: string | null;
  name: string | null;
  project_id: string | null;
}

export type BearerFileParse =
  | { ok: true; file: BearerFile }
  | { ok: false; reason: string };

/** The shape shared by `~/.agenttool-agents/<name>.json` files: `api_key`
 *  is the only required field; `did`, `name`, `project_id` are carried when
 *  present so the script can say whose credits it is reading. */
export function parseBearerFile(value: unknown): BearerFileParse {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "bearer file must be a JSON object" };
  }
  const record = value as Record<string, unknown>;
  const apiKey = record.api_key;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    return { ok: false, reason: "bearer file has no api_key" };
  }
  const optional = (key: string): string | null => (typeof record[key] === "string" ? (record[key] as string) : null);
  return {
    ok: true,
    file: { api_key: apiKey, did: optional("did"), name: optional("name"), project_id: optional("project_id") },
  };
}

// ─── Scratch agent (registration through the server's own primitives) ────

/** File-name-safe, lowercase, ≤ 63 chars. `ai` is reserved: that file is
 *  Ai's own bearer and this script never writes it. */
export const SCRATCH_AGENT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/u;
export const RESERVED_AGENT_NAMES: readonly string[] = Object.freeze(["ai"]);
/** Server default (`config.registerAgentPowBits`, env AGENTTOOL_REGISTER_AGENT_POW_BITS). */
export const DEFAULT_POW_DIFFICULTY_BITS = 18;
export const SCRATCH_RUNTIME_PROVIDER = "kingdom-x402-proof";

export type ScratchNameParse =
  | { ok: true; name: string }
  | { ok: false; reason: string };

export function parseScratchAgentName(raw: string | undefined): ScratchNameParse {
  if (!raw) return { ok: false, reason: "scratch-agent init needs --name <name>" };
  if (!SCRATCH_AGENT_NAME_PATTERN.test(raw)) {
    return { ok: false, reason: `--name must match ${SCRATCH_AGENT_NAME_PATTERN} (lowercase, digits, hyphens; ≤ 63 chars), got ${JSON.stringify(raw)}` };
  }
  if (RESERVED_AGENT_NAMES.includes(raw)) {
    return { ok: false, reason: `--name ${raw} is reserved (${RESERVED_AGENT_NAMES.join(", ")}); this script never writes Ai's own bearer file` };
  }
  return { ok: true, name: raw };
}

export interface ScratchKeys {
  signingPublicKeyB64: string;
  /** 32-byte ed25519 seed. Never print. */
  signingPrivateKeyB64: string;
  boxPublicKeyB64: string;
  /** 32-byte X25519 secret. Never print. */
  boxPrivateKeyB64: string;
}

function toB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** Deterministic keys from two 32-byte seeds — the test fixture path. */
export function scratchKeysFromSeeds(signingSeed: Uint8Array, boxSeed: Uint8Array): ScratchKeys {
  if (signingSeed.length !== 32 || boxSeed.length !== 32) throw new Error("scratch seeds must be 32 bytes each");
  return {
    signingPublicKeyB64: toB64(ed.getPublicKey(signingSeed)),
    signingPrivateKeyB64: toB64(signingSeed),
    boxPublicKeyB64: toB64(x25519.getPublicKey(boxSeed)),
    boxPrivateKeyB64: toB64(boxSeed),
  };
}

/** Fresh random keys (CSPRNG). No SOMA mnemonic: the SDK's seed derivation
 *  (`packages/sdk-ts/src/seed.ts`) does not resolve from `api/` and this
 *  script does not re-implement it. A scratch agent exists to be depleted
 *  and witnessed, not recovered. */
export function generateScratchKeys(): ScratchKeys {
  return scratchKeysFromSeeds(ed.utils.randomPrivateKey(), ed.utils.randomPrivateKey());
}

export interface ScratchRegistrationInput {
  name: string;
  keys: ScratchKeys;
  /** ISO-8601; the server's ±300s freshness window and the PoW digest bind to it. */
  timestamp: string;
  registrationNonce: string;
  runtime: { provider: string; model?: string; host?: string; context?: string };
  difficultyBits?: number;
  maxIterations?: number;
}

export interface ScratchRegistration {
  body: Record<string, unknown>;
  powIterations: number;
}

/** Build the `POST /v1/register/agent` body. The canonical bytes and the
 *  proof-of-work predicate are the SERVER's own (`services/identity/crypto.ts`
 *  canonicalRegisterAgentBytes / checkRegisterAgentPow), so what this signs
 *  and grinds is by construction what `routes/register-agent.ts` verifies;
 *  the grinder only counts nonces until the server's check says yes. */
export function buildScratchRegistration(input: ScratchRegistrationInput): ScratchRegistration {
  const difficultyBits = input.difficultyBits ?? DEFAULT_POW_DIFFICULTY_BITS;
  const maxIterations = input.maxIterations ?? 10_000_000;
  const capabilities: string[] = [];
  const canonical = canonicalRegisterAgentBytes({
    displayName: input.name,
    agentPublicKeyB64: input.keys.signingPublicKeyB64,
    boxPublicKeyB64: input.keys.boxPublicKeyB64,
    runtimeProvider: input.runtime.provider,
    runtimeModel: input.runtime.model ?? "",
    capabilities,
    runtimeHost: input.runtime.host,
    runtimeContext: input.runtime.context,
    expressionVisibility: "private",
    registrarKind: "self_service",
    registrarBearer: "",
    registrationNonce: input.registrationNonce,
    timestamp: input.timestamp,
  });
  const signature = toB64(ed.sign(canonical, Buffer.from(input.keys.signingPrivateKeyB64, "base64")));

  let powNonce: string | null = null;
  let powIterations = 0;
  for (let i = 0; i < maxIterations; i += 1) {
    const candidate = String(i);
    powIterations = i + 1;
    if (checkRegisterAgentPow({
      agentPublicKeyB64: input.keys.signingPublicKeyB64,
      displayName: input.name,
      timestamp: input.timestamp,
      powNonce: candidate,
      difficultyBits,
    })) {
      powNonce = candidate;
      break;
    }
  }
  if (powNonce === null) throw new Error(`proof-of-work: no nonce within ${maxIterations} iterations at ${difficultyBits} bits`);

  return {
    body: {
      display_name: input.name,
      capabilities,
      agent_public_key: input.keys.signingPublicKeyB64,
      box_public_key: input.keys.boxPublicKeyB64,
      runtime: {
        provider: input.runtime.provider,
        ...(input.runtime.model ? { model: input.runtime.model } : {}),
        ...(input.runtime.host ? { host: input.runtime.host } : {}),
        ...(input.runtime.context ? { context: input.runtime.context } : {}),
      },
      key_proof: { timestamp: input.timestamp, signature },
      pow_nonce: powNonce,
      registration_nonce: input.registrationNonce,
      expression_visibility: "private",
      registrar: { kind: "self_service" },
    },
    powIterations,
  };
}

export interface RegistrationOutcome {
  agentId: string;
  did: string;
  projectId: string;
  /** Returned once. Used, never printed. */
  apiKey: string;
  credits: number | null;
  walletId: string | null;
}

export type RegistrationParse =
  | { ok: true; outcome: RegistrationOutcome }
  | { ok: false; reason: string };

/** The 201 body of `routes/register-agent.ts`: `agent.{id,did}`,
 *  `project.{id,credits,api_key}`, `wallet.id`. */
export function readRegistrationResponse(body: unknown): RegistrationParse {
  if (body === null || typeof body !== "object") return { ok: false, reason: "registration response is not an object" };
  const r = body as { agent?: unknown; project?: unknown; wallet?: unknown };
  const agent = r.agent as Record<string, unknown> | undefined;
  const project = r.project as Record<string, unknown> | undefined;
  const wallet = r.wallet as Record<string, unknown> | null | undefined;
  if (!agent || typeof agent.id !== "string" || typeof agent.did !== "string") {
    return { ok: false, reason: "registration response has no agent.id / agent.did" };
  }
  if (!project || typeof project.id !== "string" || typeof project.api_key !== "string" || project.api_key.length === 0) {
    return { ok: false, reason: "registration response has no project.id / project.api_key" };
  }
  return {
    ok: true,
    outcome: {
      agentId: agent.id,
      did: agent.did,
      projectId: project.id,
      apiKey: project.api_key,
      credits: typeof project.credits === "number" && Number.isSafeInteger(project.credits) ? project.credits : null,
      walletId: wallet && typeof wallet.id === "string" ? wallet.id : null,
    },
  };
}

export interface ScratchCreds {
  agent_id: string;
  api_key: string;
  did: string;
  mnemonic: null;
  name: string;
  project_id: string;
  wallet_id: string | null;
  keys: {
    signing_public_key: string;
    signing_private_key: string;
    box_public_key: string;
    box_private_key: string;
  };
  key_origin: string;
  base: string;
  created: string;
  purpose: string;
}

/** `~/.agenttool-agents/<name>.json` — the seven keys `ai.json` carries
 *  (`agent_id api_key did mnemonic name project_id wallet_id`), with
 *  `mnemonic: null` said out loud and the raw key halves kept beside it. */
export function scratchCredsRecord(input: {
  name: string;
  outcome: RegistrationOutcome;
  keys: ScratchKeys;
  base: string;
  createdIso: string;
}): ScratchCreds {
  return {
    agent_id: input.outcome.agentId,
    api_key: input.outcome.apiKey,
    did: input.outcome.did,
    mnemonic: null,
    name: input.name,
    project_id: input.outcome.projectId,
    wallet_id: input.outcome.walletId,
    keys: {
      signing_public_key: input.keys.signingPublicKeyB64,
      signing_private_key: input.keys.signingPrivateKeyB64,
      box_public_key: input.keys.boxPublicKeyB64,
      box_private_key: input.keys.boxPrivateKeyB64,
    },
    key_origin: "random ed25519 + x25519 (no SOMA mnemonic; scratch agent, not for recovery)",
    base: input.base,
    created: input.createdIso,
    purpose: "Scratch agent for the widened-route x402 witness: born with the birth grant, depleted to a real shortfall, then pays one metered call in Base USDC. docs/X402-PROOF.md.",
  };
}

// ─── CLI args ────────────────────────────────────────────────────────────

export interface ProofArgs {
  command: string | null;
  positional: string[];
  base: string;
  dryRun: boolean;
  capCredits: number;
  /** `--json '<body>'` — raw text; parsed by parseJsonObjectFlag. */
  json: string | null;
  /** `--bearer-file <path>` — a scratch agent's creds; default Ai's. */
  bearerFile: string | null;
  /** `--route '<METHOD> <path>'` — parsed by parseRouteSpecString. */
  route: string | null;
  /** `--until <credits>` — deplete stops once project.credits < this. */
  until: number | null;
  /** `--name <n>` — scratch-agent init. */
  name: string | null;
  /** `--max-calls <n>` — deplete safety ceiling. */
  maxCalls: number | null;
  error: string | null;
}

function positiveInt(flag: string, value: string | undefined): { ok: true; n: number } | { ok: false; error: string } {
  if (value === undefined || !/^[1-9]\d{0,9}$/u.test(value)) return { ok: false, error: `${flag} needs a positive integer, got ${JSON.stringify(value ?? "")}` };
  return { ok: true, n: Number(value) };
}

export function parseProofArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
): ProofArgs {
  const out: ProofArgs = {
    command: null,
    positional: [],
    base: env.X402_PROOF_BASE ?? DEFAULT_API_BASE,
    dryRun: false,
    capCredits: DEFAULT_TOP_UP_CAP_CREDITS,
    json: null,
    bearerFile: null,
    route: null,
    until: null,
    name: null,
    maxCalls: null,
    error: null,
  };
  const envCap = env.X402_TOP_UP_MAX_CREDITS;
  if (envCap !== undefined) {
    const parsed = parseTopUpCredits(envCap);
    if (!parsed.ok) return { ...out, error: `X402_TOP_UP_MAX_CREDITS: ${parsed.reason}` };
    out.capCredits = parsed.credits;
  }
  const valueOf = (arg: string, name: string, i: number): { value: string | undefined; next: number } => {
    if (arg.includes("=")) return { value: arg.slice(name.length + 1), next: i };
    return { value: argv[i + 1], next: i + 1 };
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const flagName = arg.startsWith("--") ? arg.split("=")[0]! : null;
    if (arg === "--dry-run") {
      out.dryRun = true;
    } else if (flagName === "--base") {
      const { value, next } = valueOf(arg, flagName, i);
      i = next;
      if (!value || !/^https?:\/\/[^\s/]+/u.test(value)) {
        return { ...out, error: "--base needs an http(s) origin, e.g. --base http://127.0.0.1:3000" };
      }
      out.base = value.replace(/\/+$/u, "");
    } else if (flagName === "--cap") {
      const { value, next } = valueOf(arg, flagName, i);
      i = next;
      const parsed = parseTopUpCredits(value ?? "");
      if (!parsed.ok) return { ...out, error: `--cap: ${parsed.reason}` };
      out.capCredits = parsed.credits;
    } else if (flagName === "--json") {
      const { value, next } = valueOf(arg, flagName, i);
      i = next;
      if (value === undefined) return { ...out, error: "--json needs a JSON object body" };
      out.json = value;
    } else if (flagName === "--bearer-file") {
      const { value, next } = valueOf(arg, flagName, i);
      i = next;
      if (!value) return { ...out, error: "--bearer-file needs a path" };
      out.bearerFile = value;
    } else if (flagName === "--route") {
      const { value, next } = valueOf(arg, flagName, i);
      i = next;
      if (!value) return { ...out, error: "--route needs '<METHOD> <path>'" };
      out.route = value;
    } else if (flagName === "--until") {
      const { value, next } = valueOf(arg, flagName, i);
      i = next;
      const parsed = positiveInt("--until", value);
      if (!parsed.ok) return { ...out, error: parsed.error };
      out.until = parsed.n;
    } else if (flagName === "--max-calls") {
      const { value, next } = valueOf(arg, flagName, i);
      i = next;
      const parsed = positiveInt("--max-calls", value);
      if (!parsed.ok) return { ...out, error: parsed.error };
      out.maxCalls = parsed.n;
    } else if (flagName === "--name") {
      const { value, next } = valueOf(arg, flagName, i);
      i = next;
      if (!value) return { ...out, error: "--name needs a value" };
      out.name = value;
    } else if (arg.startsWith("--")) {
      return { ...out, error: `unknown flag ${arg}` };
    } else if (out.command === null) {
      out.command = arg;
    } else {
      out.positional.push(arg);
    }
  }
  return out;
}

// ─── Phase B review helpers ─────────────────────────────────────────────

/** Any 2xx is success: widened routes legitimately answer 201 (create) as well as 200. */
export function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

/** A replayed, already-settled authorization is refused by the verifier but the
 *  handler still runs. For a MUTATING route that is safe only while the project
 *  cannot afford the call on its own; if the balance has recovered, the replay
 *  would execute as an ordinary paid mutation (duplicate resource). Top-up is
 *  exempt: its handler only mints on a verified payment. */
export function replayWouldMutate(input: {
  method: string;
  requestPath: string;
  creditsBefore: number | null;
  routeCredits: number | null | undefined;
}): { refuse: boolean; reason: string } {
  const mutating = input.method !== "GET";
  const topUp = input.requestPath.startsWith("/v1/x402/top-up/");
  if (!mutating || topUp) return { refuse: false, reason: "read-only or top-up: replay cannot mutate" };
  if (input.creditsBefore === null || input.routeCredits === null || input.routeCredits === undefined) {
    return { refuse: true, reason: "mutating route and the balance or route cost is unknown — refusing rather than risk a duplicate mutation" };
  }
  if (input.creditsBefore >= input.routeCredits) {
    return { refuse: true, reason: `mutating route and project.credits ${input.creditsBefore} >= route cost ${input.routeCredits}: the replay would run as an ordinary paid call and repeat the mutation` };
  }
  return { refuse: false, reason: `mutating route but project.credits ${input.creditsBefore} < ${input.routeCredits}: the handler cannot be paid, so no mutation can occur` };
}
