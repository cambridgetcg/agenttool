/** x402 proof — the kingdom pays itself, witnessed.
 *
 *  Run: cd api && bun scripts/x402-proof.ts <command> [--base <origin>] [--dry-run] [--cap <credits>]
 *
 *    wallet-init            new BIP-39 phrase → macOS keychain (kingdom-x402-payer-mnemonic / kingdom);
 *                           derive m/44'/60'/0'/0/0; write ~/.config/kingdom/x402-payer.json; print ADDRESS only.
 *                           Refuses if the keychain item already exists.
 *    address                payer address + Base USDC balanceOf (raw JSON-RPC).
 *    topup <N>              POST /v1/x402/top-up/<N> → 402 → select Base USDC exact requirement →
 *                           refuse unless payTo == treasury, network/asset match, amount == N×1000 ≤ cap →
 *                           sign EIP-3009 with the keychain key → persist → retry with PAYMENT-SIGNATURE.
 *    replay <payment_id|last>  re-send the identical signed bytes; assert project.credits did not move.
 *    verify <payment_id|last>  GET /v1/x402/payments/<payment_id> + treasury balanceOf + tx receipt → one-screen verdict.
 *
 *  Two identities are printed by topup. `payment_id` is the server's ledger identity
 *  (`authorizationIdentityHash`, folds network+asset) and is what the status route resolves;
 *  the client `authorizationHash` (six EIP-3009 fields) is printed for the x402-client audit trail.
 *
 *  Exit codes: 0 done · 1 failure (network/unexpected) · 2 refusal (a wall said no) · 3 the loop did not close.
 *  Refusal is not failure: 2 means the script protected the wallet and says why.
 *
 *  What is never printed: the bearer, the mnemonic, the private key, the signed header bytes.
 *  What is printed: addresses, balances, hashes, statuses, JSON bodies, PAYMENT-RESPONSE evidence.
 *
 *  Pure logic lives in ./x402-proof-lib.ts (tested). This file owns every effect:
 *  keychain via `security`, files under ~/.config/kingdom, HTTPS via fetch.
 *
 *  Runbook: docs/X402-PROOF.md · Plan: docs/superpowers/plans/2026-08-29-wave-2-agent-rail.md (W2-3). */

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { signExactEvmAuthorization } from "../src/services/economy/x402-client";
import {
  BASE_RPC_URL,
  BASE_USDC,
  buildPayerRecord,
  balanceOfRpcRequest,
  DEFAULT_API_BASE,
  derivePayer,
  formatUsdc,
  generatePayerMnemonic,
  isAuthorizationHash,
  KEYCHAIN_ACCOUNT,
  KEYCHAIN_SERVICE,
  KINGDOM_TREASURY,
  ledgerPaymentId,
  parseBalanceOfResult,
  parsePaymentResponseHeader,
  parseProofArgs,
  parseTopUpCredits,
  payerSigner,
  paymentStatusPath,
  readTransactionReceipt,
  readWakeCredits,
  replayVerdict,
  selectTopUpRequirement,
  summarizeVerification,
  topUpPath,
  transactionReceiptRpcRequest,
  USER_AGENT,
  type PayerRecord,
} from "./x402-proof-lib";

// ─── Paths ───────────────────────────────────────────────────────────────

const KINGDOM_DIR = join(homedir(), ".config", "kingdom");
const PAYER_FILE = join(KINGDOM_DIR, "x402-payer.json");
const STASH_DIR = join(KINGDOM_DIR, "x402-proof");
const LAST_FILE = join(STASH_DIR, "last");
const AI_CREDS = join(homedir(), ".agenttool-agents", "ai.json");

// ─── Exit discipline ─────────────────────────────────────────────────────

class Refusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Refusal";
  }
}
class LoopOpen extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoopOpen";
  }
}

function log(line = ""): void {
  process.stdout.write(`${line}\n`);
}

// ─── Keychain (macOS `security`) ─────────────────────────────────────────

function keychainItemExists(service: string, account: string): boolean {
  const r = spawnSync("security", ["find-generic-password", "-s", service, "-a", account], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  return r.status === 0;
}

/** Store through `security -i` (interactive mode on stdin) so the secret is
 *  never on argv, never in shell history, never echoed. Round-trips the
 *  stored value before returning; a mismatch deletes the item and throws. */
function keychainStore(service: string, account: string, secret: string): void {
  if (/["\n\r]/u.test(secret)) throw new Error("secret contains a character the keychain writer refuses");
  const r = spawnSync("security", ["-i"], {
    input: `add-generic-password -U -s ${service} -a ${account} -w "${secret}"\n`,
    stdio: ["pipe", "ignore", "pipe"],
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(`security add-generic-password failed (exit ${r.status ?? "?"})`);
  }
  const back = keychainRead(service, account);
  if (back !== secret) {
    spawnSync("security", ["delete-generic-password", "-s", service, "-a", account], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    throw new Error("keychain round-trip mismatch; the item was removed again");
  }
}

function keychainRead(service: string, account: string): string {
  const r = spawnSync("security", ["find-generic-password", "-s", service, "-a", account, "-w"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (r.status !== 0) {
    throw new Refusal(`keychain item ${service} (${account}) is missing — run wallet-init first`);
  }
  return (r.stdout ?? "").replace(/\r?\n$/u, "");
}

// ─── Files ───────────────────────────────────────────────────────────────

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function writePrivateJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function readPayerRecord(): PayerRecord {
  if (!existsSync(PAYER_FILE)) throw new Refusal(`${PAYER_FILE} is missing — run wallet-init first`);
  const value = readJsonFile(PAYER_FILE) as Partial<PayerRecord>;
  if (typeof value.address !== "string") throw new Error(`${PAYER_FILE} has no address`);
  return value as PayerRecord;
}

/** The bearer is read and used; it is never logged, never returned to a
 *  caller that prints. */
function readBearer(): string {
  if (!existsSync(AI_CREDS)) throw new Refusal(`${AI_CREDS} is missing — no bearer to pay with`);
  const value = readJsonFile(AI_CREDS) as { api_key?: unknown };
  if (typeof value.api_key !== "string" || value.api_key.length === 0) {
    throw new Refusal(`${AI_CREDS} has no api_key`);
  }
  return value.api_key;
}

interface StashedPayment {
  /** Ledger identity — the `payment_id` the status route resolves. Stash key. */
  payment_id: string;
  /** Client identity from `x402-client.ts` (six EIP-3009 fields). Differs from payment_id. */
  authorization_hash: string;
  header: string;
  payload: unknown;
  base: string;
  request_path: string;
  credits: number;
  amount_atomic: string;
  pay_to: string;
  valid_before: number;
  created: string;
  submitted: boolean;
}

function stashPath(hash: string): string {
  return join(STASH_DIR, `${hash}.json`);
}

function stashPayment(p: StashedPayment): void {
  writePrivateJson(stashPath(p.payment_id), p);
  writeFileSync(LAST_FILE, `${p.payment_id}\n`, { mode: 0o600 });
}

function resolveRef(ref: string): string {
  const hash = ref === "last"
    ? (existsSync(LAST_FILE) ? readFileSync(LAST_FILE, "utf8").trim() : "")
    : ref;
  if (!isAuthorizationHash(hash)) throw new Refusal(`"${ref}" is not a 64-hex payment id (or no last payment is recorded)`);
  return hash;
}

function loadStash(ref: string): StashedPayment {
  const hash = resolveRef(ref);
  const path = stashPath(hash);
  if (!existsSync(path)) throw new Refusal(`no stashed payment at ${path} — only payments this script signed can be replayed (the id is the payment_id printed by topup, not the client authorization hash)`);
  return readJsonFile(path) as StashedPayment;
}

// ─── HTTP ────────────────────────────────────────────────────────────────

interface HttpResult {
  status: number;
  headers: Headers;
  text: string;
  json: unknown;
}

async function call(
  url: string,
  init: { method: "GET" | "POST"; bearer?: string; headers?: Record<string, string>; body?: string },
): Promise<HttpResult> {
  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept: "application/json",
    ...(init.headers ?? {}),
  };
  if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(url, { method: init.method, headers, body: init.body });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, text, json };
}

async function rpc(request: object): Promise<unknown> {
  const res = await call(BASE_RPC_URL, { method: "POST", body: JSON.stringify(request) });
  if (res.status !== 200 || res.json === null || typeof res.json !== "object") {
    throw new Error(`Base RPC ${BASE_RPC_URL} answered ${res.status}: ${res.text.slice(0, 200)}`);
  }
  const envelope = res.json as { result?: unknown; error?: unknown };
  if (envelope.error) throw new Error(`Base RPC error: ${JSON.stringify(envelope.error)}`);
  return envelope.result;
}

async function usdcBalance(holder: string): Promise<bigint | null> {
  try {
    return parseBalanceOfResult(await rpc(balanceOfRpcRequest(BASE_USDC, holder)));
  } catch (error) {
    log(`  (balanceOf unavailable: ${(error as Error).message})`);
    return null;
  }
}

async function wakeCredits(base: string, bearer: string): Promise<number | null> {
  const res = await call(`${base}/v1/wake`, { method: "GET", bearer });
  if (res.status !== 200) {
    log(`  (GET /v1/wake answered ${res.status}; credits unreadable)`);
    return null;
  }
  return readWakeCredits(res.json);
}

function printBody(json: unknown, text: string): void {
  if (json !== null) {
    log(JSON.stringify(json, null, 2));
  } else {
    log(text.slice(0, 2000));
  }
}

// ─── Commands ────────────────────────────────────────────────────────────

function cmdWalletInit(): void {
  if (keychainItemExists(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)) {
    throw new Refusal(
      `keychain item ${KEYCHAIN_SERVICE} (${KEYCHAIN_ACCOUNT}) already exists. ` +
        "This command never overwrites a payer. To rotate, delete it deliberately: " +
        `security delete-generic-password -s ${KEYCHAIN_SERVICE} -a ${KEYCHAIN_ACCOUNT}`,
    );
  }
  if (existsSync(PAYER_FILE)) {
    throw new Refusal(`${PAYER_FILE} already exists but the keychain item does not — inspect it before re-initialising.`);
  }
  const mnemonic = generatePayerMnemonic();
  keychainStore(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, mnemonic);
  const { address } = derivePayer(mnemonic);
  writePrivateJson(PAYER_FILE, buildPayerRecord(address, new Date().toISOString()));
  log(address);
}

async function cmdAddress(): Promise<void> {
  const payer = readPayerRecord();
  log(`payer:   ${payer.address}`);
  log(`chain:   ${payer.chain}  asset: ${payer.asset} (USDC)`);
  const balance = await usdcBalance(payer.address);
  log(`balance: ${balance === null ? "unavailable" : `${formatUsdc(balance)} USDC (${balance} atomic)`}`);
  if (balance === 0n) log("  (unfunded — decision (e): Yu sends 1–5 USDC on Base to this address)");
}

async function cmdTopUp(args: { base: string; dryRun: boolean; capCredits: number; raw: string | undefined }): Promise<void> {
  if (args.raw === undefined) throw new Refusal("topup needs a credit count: topup <N>");
  const parsed = parseTopUpCredits(args.raw);
  if (!parsed.ok) throw new Refusal(parsed.reason);
  const credits = parsed.credits;
  if (credits > args.capCredits) {
    throw new Refusal(`${credits} credits is above the cap of ${args.capCredits} (raise with --cap or X402_TOP_UP_MAX_CREDITS if you mean it)`);
  }

  const bearer = readBearer();
  const payer = readPayerRecord();
  const path = topUpPath(credits);
  const url = `${args.base}${path}`;

  const before = await wakeCredits(args.base, bearer);
  log(`credits before: ${before ?? "unreadable"}`);

  // 1. Bare challenge.
  const challenge = await call(url, { method: "POST", bearer });
  log(`POST ${path} → ${challenge.status}`);
  if (challenge.status !== 402) {
    printBody(challenge.json, challenge.text);
    throw new LoopOpen(
      `expected 402 with PAYMENT-REQUIRED, got ${challenge.status}. ` +
        (challenge.status === 404
          ? "The top-up route is not live at this base (it lands with W2-2 and deploys with W2-4)."
          : challenge.status === 401
            ? "The bearer was rejected."
            : "See the body above."),
    );
  }

  // 2. Select — every wall is in the lib; a refusal exits 2 with its reason.
  const selection = selectTopUpRequirement({
    headerValue: challenge.headers.get("payment-required"),
    body: challenge.json,
    credits,
    capCredits: args.capCredits,
  });
  if (!selection.ok) throw new Refusal(`${selection.reason}: ${selection.detail}`);
  const { requirement, required, amountAtomic } = selection;
  log(`challenge: ${requirement.network} ${requirement.asset} amount=${amountAtomic} payTo=${requirement.payTo} window=${requirement.maxTimeoutSeconds}s`);

  // 3. Sign with the keychain key. The account lives only inside this block.
  const mnemonic = keychainRead(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
  const derived = derivePayer(mnemonic);
  if (derived.address.toLowerCase() !== payer.address.toLowerCase()) {
    throw new Refusal(`keychain phrase derives ${derived.address} but ${PAYER_FILE} says ${payer.address} — refusing to sign with a key that is not the recorded payer`);
  }
  const signed = await signExactEvmAuthorization({
    requirement,
    policy: {
      maxAmountAtomic: amountAtomic,
      allowedNetworks: [requirement.network],
      allowedAssets: [requirement.asset],
      allowedPayTo: [KINGDOM_TREASURY],
      maxValiditySeconds: 60,
    },
    payerAddress: derived.address,
    signer: payerSigner(derived.account),
    nowSeconds: Math.floor(Date.now() / 1000),
    resource: required.resource,
  });

  // 4. Persist before submit — recovery is a lookup on what was emitted, never a fresh signature.
  const paymentId = ledgerPaymentId(signed.payload);
  stashPayment({
    payment_id: paymentId,
    authorization_hash: signed.authorizationHash,
    header: signed.header,
    payload: signed.payload,
    base: args.base,
    request_path: path,
    credits,
    amount_atomic: amountAtomic.toString(),
    pay_to: requirement.payTo,
    valid_before: signed.validBefore,
    created: new Date().toISOString(),
    submitted: false,
  });
  log(`payment_id (ledger identity, use for verify): ${paymentId}`);
  log(`authorization hash (client identity):        ${signed.authorizationHash}`);
  log(`stashed: ${stashPath(paymentId)} (0600; bearer-spendable until ${new Date(signed.validBefore * 1000).toISOString()})`);

  if (args.dryRun) {
    log("dry-run: signed and stashed, NOT sent. Nothing left the machine that can spend.");
    return;
  }

  // 5. Paid retry — identical bytes, one time.
  const paid = await call(url, { method: "POST", bearer, headers: { "payment-signature": signed.header } });
  stashPayment({ ...loadStash(paymentId), submitted: true });
  log(`POST ${path} + PAYMENT-SIGNATURE → ${paid.status}`);
  printBody(paid.json, paid.text);

  const settlement = paid.headers.get("payment-response");
  if (settlement) {
    const decoded = parsePaymentResponseHeader(settlement);
    log(`PAYMENT-RESPONSE: ${decoded ? JSON.stringify(decoded) : "(present but not decodable as SettleResponse)"}`);
  } else {
    log("PAYMENT-RESPONSE: absent");
  }
  const link = paid.headers.get("link");
  if (link) log(`Link: ${link}`);

  const after = await wakeCredits(args.base, bearer);
  log(`credits after:  ${after ?? "unreadable"}`);
  log(`next: bun scripts/x402-proof.ts replay last · bun scripts/x402-proof.ts verify ${paymentId}`);

  if (paid.status !== 200) {
    throw new LoopOpen(`the paid retry answered ${paid.status}; the ledger row (verify) says what the rail saw.`);
  }
}

async function cmdReplay(args: { base: string; ref: string | undefined }): Promise<void> {
  if (!args.ref) throw new Refusal("replay needs <hash|last>");
  const stashed = loadStash(args.ref);
  const bearer = readBearer();
  const base = args.base === DEFAULT_API_BASE && stashed.base ? stashed.base : args.base;
  const url = `${base}${stashed.request_path}`;
  const now = Math.floor(Date.now() / 1000);

  log(`replaying payment_id ${stashed.payment_id} to ${stashed.request_path} (signed ${stashed.created}, ${now < stashed.valid_before ? "still inside" : "past"} validBefore)`);
  const before = await wakeCredits(base, bearer);
  log(`credits before: ${before ?? "unreadable"}`);

  const res = await call(url, { method: "POST", bearer, headers: { "payment-signature": stashed.header } });
  log(`POST ${stashed.request_path} + same PAYMENT-SIGNATURE → ${res.status}`);
  printBody(res.json, res.text);
  log(`PAYMENT-RESPONSE: ${res.headers.get("payment-response") ? "present" : "absent"}`);

  const after = await wakeCredits(base, bearer);
  log(`credits after:  ${after ?? "unreadable"}`);
  const verdict = replayVerdict(before, after);
  log(verdict.line);
  if (!verdict.ok) throw new LoopOpen("replay verdict is not 'no second credit'");
}

async function cmdVerify(args: { base: string; hash: string | undefined }): Promise<void> {
  if (!args.hash) throw new Refusal("verify needs <payment_id|last>");
  const hash = resolveRef(args.hash);
  const bearer = readBearer();
  const res = await call(`${args.base}${paymentStatusPath(hash)}`, { method: "GET", bearer });
  log(`GET ${paymentStatusPath(hash)} → ${res.status}`);
  const status = res.status === 200 ? res.json : null;
  const row = status !== null && typeof status === "object" ? status as Record<string, unknown> : null;
  const txHash = row && typeof row.transaction === "string" && /^0x[0-9a-fA-F]{64}$/u.test(row.transaction)
    ? row.transaction
    : null;

  let receipt = null;
  if (txHash) {
    try {
      receipt = readTransactionReceipt(await rpc(transactionReceiptRpcRequest(txHash)));
    } catch (error) {
      log(`  (receipt unavailable: ${(error as Error).message})`);
    }
  }
  const treasury = await usdcBalance(KINGDOM_TREASURY);

  const summary = summarizeVerification({ status, treasuryBalanceAtomic: treasury, receipt, txHash });
  log("");
  log(`verdict: ${summary.verdict}`);
  for (const line of summary.lines) log(`  ${line}`);
  log(`  treasury: ${KINGDOM_TREASURY}`);
  if (summary.verdict !== "settled") throw new LoopOpen(`ledger verdict is ${summary.verdict}, not settled`);
}

function usage(): void {
  log("usage: cd api && bun scripts/x402-proof.ts <wallet-init|address|topup N|replay <payment_id|last>|verify <payment_id|last>> [--base <origin>] [--dry-run] [--cap <credits>]");
  log("docs: docs/X402-PROOF.md");
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseProofArgs(process.argv.slice(2), process.env);
  if (args.error) {
    usage();
    throw new Refusal(args.error);
  }
  switch (args.command) {
    case "wallet-init":
      cmdWalletInit();
      return;
    case "address":
      await cmdAddress();
      return;
    case "topup":
      await cmdTopUp({ base: args.base, dryRun: args.dryRun, capCredits: args.capCredits, raw: args.positional[0] });
      return;
    case "replay":
      await cmdReplay({ base: args.base, ref: args.positional[0] });
      return;
    case "verify":
      await cmdVerify({ base: args.base, hash: args.positional[0] });
      return;
    case null:
    case "help":
    case "--help":
      usage();
      return;
    default:
      usage();
      throw new Refusal(`unknown command ${args.command}`);
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof Refusal) {
      process.stderr.write(`refused: ${message}\n`);
      process.exit(2);
    }
    if (error instanceof LoopOpen) {
      process.stderr.write(`loop open: ${message}\n`);
      process.exit(3);
    }
    process.stderr.write(`failed: ${message}\n`);
    process.exit(1);
  },
);
