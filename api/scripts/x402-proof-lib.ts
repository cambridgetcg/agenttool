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
 *  Plan: docs/superpowers/plans/2026-08-29-wave-2-agent-rail.md (W2-3).
 *  Runbook: docs/X402-PROOF.md. */

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
  verdict: "settled" | "pending" | "failed" | "not_found" | "unknown";
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
    verdict = input.receipt?.status === "success" || input.receipt === null && input.txHash
      ? "settled"
      : input.receipt?.status === "reverted" ? "failed" : "settled";
  } else if (status === "pending" || status === "inserted" || status === "externally_settled") {
    verdict = "pending";
  } else if (status === "failed" || status === "expired" || status === "rejected") {
    verdict = "failed";
  } else {
    verdict = "unknown";
  }
  return { verdict, lines };
}

// ─── CLI args ────────────────────────────────────────────────────────────

export interface ProofArgs {
  command: string | null;
  positional: string[];
  base: string;
  dryRun: boolean;
  capCredits: number;
  error: string | null;
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
    error: null,
  };
  const envCap = env.X402_TOP_UP_MAX_CREDITS;
  if (envCap !== undefined) {
    const parsed = parseTopUpCredits(envCap);
    if (!parsed.ok) return { ...out, error: `X402_TOP_UP_MAX_CREDITS: ${parsed.reason}` };
    out.capCredits = parsed.credits;
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") {
      out.dryRun = true;
    } else if (arg === "--base" || arg.startsWith("--base=")) {
      const value = arg.includes("=") ? arg.slice("--base=".length) : argv[++i];
      if (!value || !/^https?:\/\/[^\s/]+/u.test(value)) {
        return { ...out, error: "--base needs an http(s) origin, e.g. --base http://127.0.0.1:3000" };
      }
      out.base = value.replace(/\/+$/u, "");
    } else if (arg === "--cap" || arg.startsWith("--cap=")) {
      const value = arg.includes("=") ? arg.slice("--cap=".length) : argv[++i];
      const parsed = parseTopUpCredits(value ?? "");
      if (!parsed.ok) return { ...out, error: `--cap: ${parsed.reason}` };
      out.capCredits = parsed.credits;
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
