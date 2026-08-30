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
 *  Phase B (W2-5) — any row of the payable-route table, witnessed from a scratch agent:
 *    pay <METHOD> <path> [--json '<body>'] [--bearer-file <path>]
 *                           call the route; on 402 + PAYMENT-REQUIRED select the Base USDC exact requirement →
 *                           refuse unless payTo == treasury, network eip155:8453, asset USDC, amount ≤ cap, whole credits,
 *                           resource path == <path> → sign with the keychain payer → retry with PAYMENT-SIGNATURE.
 *                           Stashed like topup, so `replay last` / `verify last` work on it.
 *    scratch-agent init --name <n>
 *                           POST /v1/register/agent (server's own canonical bytes + PoW predicate; fresh random keys) →
 *                           ~/.agenttool-agents/<n>.json (0600, ai.json's seven keys + raw key halves) → print did + credits.
 *    deplete --bearer-file <path> --route '<METHOD> <path>' --json '<body>' --until <credits> [--max-calls <n>]
 *                           call a metered route until project.credits < --until; backoff on 429/503; progress every 25;
 *                           stop on any non-200/402 or on a balance that does not move by exactly the route's cost.
 *
 *  Two identities are printed by topup/pay. `payment_id` is the server's ledger identity
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
 *  keychain via `security`, files under ~/.config/kingdom and ~/.agenttool-agents, HTTPS via fetch.
 *
 *  Runbook: docs/X402-PROOF.md · Plan: docs/superpowers/plans/2026-08-29-wave-2-agent-rail.md (W2-3, W2-5). */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";

import { signExactEvmAuthorization } from "../src/services/economy/x402-client";
import {
  BASE_RPC_URL,
  BASE_USDC,
  backoffDelayMs,
  buildPayerRecord,
  buildScratchRegistration,
  balanceOfRpcRequest,
  DEFAULT_API_BASE,
  depletionPlan,
  depletionStepVerdict,
  derivePayer,
  expectedPaidDelta,
  formatUsdc,
  generatePayerMnemonic,
  generateScratchKeys,
  isAuthorizationHash,
  isRetryableStatus,
  KEYCHAIN_ACCOUNT,
  KEYCHAIN_SERVICE,
  KINGDOM_TREASURY,
  ledgerPaymentId,
  MAX_BACKOFF_ATTEMPTS,
  parseBalanceOfResult,
  parseBearerFile,
  parseJsonObjectFlag,
  parsePaymentResponseHeader,
  parseProofArgs,
  parseRouteSpec,
  parseRouteSpecString,
  parseScratchAgentName,
  parseTopUpCredits,
  payerSigner,
  paymentStatusPath,
  readCreditsBalanceHeader,
  readRegistrationResponse,
  readTransactionReceipt,
  readWakeCredits,
  replayVerdict,
  scratchCredsRecord,
  SCRATCH_RUNTIME_PROVIDER,
  selectPayRequirement,
  selectTopUpRequirement,
  summarizeVerification,
  topUpPath,
  transactionReceiptRpcRequest,
  USER_AGENT,
  type PayerRecord,
  type ProofMethod,
} from "./x402-proof-lib";

// ─── Paths ───────────────────────────────────────────────────────────────

const KINGDOM_DIR = join(homedir(), ".config", "kingdom");
const PAYER_FILE = join(KINGDOM_DIR, "x402-payer.json");
const STASH_DIR = join(KINGDOM_DIR, "x402-proof");
const LAST_FILE = join(STASH_DIR, "last");
const AGENTS_DIR = join(homedir(), ".agenttool-agents");
const AI_CREDS = join(AGENTS_DIR, "ai.json");

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

interface BearerSource {
  /** Used, never logged, never returned to a caller that prints. */
  bearer: string;
  path: string;
  /** Who this bearer belongs to, for the screen. */
  who: string;
}

/** The bearer is read and used; it is never logged. Default: Ai's own
 *  creds. `--bearer-file` names a scratch agent's file (same shape). */
function readBearer(bearerFile: string | null = null): BearerSource {
  const path = bearerFile ? resolve(bearerFile) : AI_CREDS;
  if (!existsSync(path)) throw new Refusal(`${path} is missing — no bearer to call with`);
  const parsed = parseBearerFile(readJsonFile(path));
  if (!parsed.ok) throw new Refusal(`${path}: ${parsed.reason}`);
  const who = parsed.file.name ?? parsed.file.did ?? "(unnamed)";
  return { bearer: parsed.file.api_key, path, who };
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
  /** Phase B: generic routes carry their method and canonical JSON body so
   *  replay re-sends the identical request. Absent on pre-B stashes (POST, no body). */
  request_method?: ProofMethod;
  request_body?: string | null;
  /** Which bearer file paid (path only; never the key). */
  bearer_file?: string;
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
  if (!existsSync(path)) throw new Refusal(`no stashed payment at ${path} — only payments this script signed can be replayed (the id is the payment_id printed by topup/pay, not the client authorization hash)`);
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
  init: { method: ProofMethod; bearer?: string; headers?: Record<string, string>; body?: string },
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

function printSettlementEvidence(res: HttpResult): void {
  const settlement = res.headers.get("payment-response");
  if (settlement) {
    const decoded = parsePaymentResponseHeader(settlement);
    log(`PAYMENT-RESPONSE: ${decoded ? JSON.stringify(decoded) : "(present but not decodable as SettleResponse)"}`);
  } else {
    log("PAYMENT-RESPONSE: absent");
  }
  const link = res.headers.get("link");
  if (link) log(`Link: ${link}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

// ─── Payer signing (shared by topup + pay) ───────────────────────────────

/** Read the phrase from the keychain, derive, check it is the recorded
 *  payer, and sign. The account lives only inside this function. */
async function signWithKeychainPayer(input: {
  requirement: Parameters<typeof signExactEvmAuthorization>[0]["requirement"];
  resource: Parameters<typeof signExactEvmAuthorization>[0]["resource"];
  amountAtomic: bigint;
}) {
  const payer = readPayerRecord();
  const mnemonic = keychainRead(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
  const derived = derivePayer(mnemonic);
  if (derived.address.toLowerCase() !== payer.address.toLowerCase()) {
    throw new Refusal(`keychain phrase derives ${derived.address} but ${PAYER_FILE} says ${payer.address} — refusing to sign with a key that is not the recorded payer`);
  }
  return signExactEvmAuthorization({
    requirement: input.requirement,
    policy: {
      maxAmountAtomic: input.amountAtomic,
      allowedNetworks: [input.requirement.network],
      allowedAssets: [input.requirement.asset],
      allowedPayTo: [KINGDOM_TREASURY],
      maxValiditySeconds: 60,
    },
    payerAddress: derived.address,
    signer: payerSigner(derived.account),
    nowSeconds: Math.floor(Date.now() / 1000),
    resource: input.resource,
  });
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

  const { bearer, path: bearerPath } = readBearer();
  readPayerRecord();
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

  // 3. Sign with the keychain key.
  const signed = await signWithKeychainPayer({ requirement, resource: required.resource, amountAtomic });

  // 4. Persist before submit — recovery is a lookup on what was emitted, never a fresh signature.
  const paymentId = ledgerPaymentId(signed.payload);
  stashPayment({
    payment_id: paymentId,
    authorization_hash: signed.authorizationHash,
    header: signed.header,
    payload: signed.payload,
    base: args.base,
    request_path: path,
    request_method: "POST",
    request_body: null,
    bearer_file: bearerPath,
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
  printSettlementEvidence(paid);

  const after = await wakeCredits(args.base, bearer);
  log(`credits after:  ${after ?? "unreadable"}`);
  log(`next: bun scripts/x402-proof.ts replay last · bun scripts/x402-proof.ts verify ${paymentId}`);

  if (paid.status !== 200) {
    throw new LoopOpen(`the paid retry answered ${paid.status}; the ledger row (verify) says what the rail saw.`);
  }
}

/** Phase B: pay any payable route. The price is the server's (the table's
 *  row); the walls are the lib's. Same stash, same replay/verify. */
async function cmdPay(args: {
  base: string;
  dryRun: boolean;
  capCredits: number;
  methodRaw: string | undefined;
  pathRaw: string | undefined;
  json: string | null;
  bearerFile: string | null;
}): Promise<void> {
  const spec = parseRouteSpec(args.methodRaw, args.pathRaw);
  if (!spec.ok) throw new Refusal(spec.reason);
  const { method, path } = spec;
  let bodyText: string | null = null;
  if (args.json !== null) {
    const parsed = parseJsonObjectFlag(args.json);
    if (!parsed.ok) throw new Refusal(parsed.reason);
    bodyText = parsed.text;
  }

  const { bearer, path: bearerPath, who } = readBearer(args.bearerFile);
  readPayerRecord();
  const url = `${args.base}${path}`;
  log(`bearer: ${who} (${bearerPath})`);

  const before = await wakeCredits(args.base, bearer);
  log(`credits before: ${before ?? "unreadable"}`);

  // 1. Bare call — the handler's own 402 (insufficient_credits) is what becomes payable.
  const challenge = await call(url, { method, bearer, body: bodyText ?? undefined });
  log(`${method} ${path} → ${challenge.status}`);
  if (challenge.status !== 402) {
    printBody(challenge.json, challenge.text);
    throw new LoopOpen(
      `expected 402 with PAYMENT-REQUIRED, got ${challenge.status}. ` +
        (challenge.status === 200
          ? "The route ran without a shortfall — nothing to pay. Deplete the project below the route's cost first (deplete --until <cost>)."
          : challenge.status === 404
            ? "No such route at this base."
            : challenge.status === 401
              ? "The bearer was rejected."
              : challenge.status === 400
                ? "The body was refused before the credit gate — fix --json first."
                : "See the body above."),
    );
  }
  if (!challenge.headers.get("payment-required")) {
    printBody(challenge.json, challenge.text);
    throw new LoopOpen(
      "402 without PAYMENT-REQUIRED: this (method, path) is not a row of X402_PAYABLE_ROUTES at this base, " +
        "or the facilitator/recipient is not configured there. Not a payable shortfall; nothing signed.",
    );
  }

  // 2. Select — client walls + whole-credit price + resource path == path.
  const selection = selectPayRequirement({
    headerValue: challenge.headers.get("payment-required"),
    body: challenge.json,
    path,
    capCredits: args.capCredits,
  });
  if (!selection.ok) throw new Refusal(`${selection.reason}: ${selection.detail}`);
  const { requirement, required, amountAtomic, credits, errorCode } = selection;
  log(`challenge: ${errorCode ?? "(no error code)"} ${requirement.network} ${requirement.asset} amount=${amountAtomic} (${credits} credit${credits === 1 ? "" : "s"}) payTo=${requirement.payTo} window=${requirement.maxTimeoutSeconds}s`);
  log(`resource: ${required.resource.url}`);

  // 3. Sign.
  const signed = await signWithKeychainPayer({ requirement, resource: required.resource, amountAtomic });

  // 4. Persist before submit.
  const paymentId = ledgerPaymentId(signed.payload);
  stashPayment({
    payment_id: paymentId,
    authorization_hash: signed.authorizationHash,
    header: signed.header,
    payload: signed.payload,
    base: args.base,
    request_path: path,
    request_method: method,
    request_body: bodyText,
    bearer_file: bearerPath,
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

  // 5. Paid retry — identical request + PAYMENT-SIGNATURE, one time.
  const paid = await call(url, {
    method,
    bearer,
    body: bodyText ?? undefined,
    headers: { "payment-signature": signed.header },
  });
  stashPayment({ ...loadStash(paymentId), submitted: true });
  log(`${method} ${path} + PAYMENT-SIGNATURE → ${paid.status}`);
  printBody(paid.json, paid.text);
  printSettlementEvidence(paid);
  const headerBalance = readCreditsBalanceHeader(paid.headers);
  if (headerBalance !== null) log(`X-Credits-Balance (after handler): ${headerBalance}`);

  const after = await wakeCredits(args.base, bearer);
  const expected = expectedPaidDelta(errorCode, credits);
  log(`credits after:  ${after ?? "unreadable"}` +
    (before !== null && after !== null
      ? ` (Δ ${after - before}; expected ${expected >= 0 ? "+" : ""}${expected}: ${expected === 0 ? "the rail applied the row's credits and the handler spent exactly them" : "purchase, nothing spent"})`
      : ""));
  log(`next: bun scripts/x402-proof.ts replay last · bun scripts/x402-proof.ts verify ${paymentId}`);

  if (paid.status !== 200) {
    throw new LoopOpen(`the paid retry answered ${paid.status}; the ledger row (verify) says what the rail saw.`);
  }
  if (before !== null && after !== null && after - before !== expected) {
    throw new LoopOpen(`project.credits moved ${after - before}, expected ${expected}; the ledger row (verify) and the usage events disagree with the screen.`);
  }
}

/** Phase B: a fresh agent through the canonical arrival door. */
async function cmdScratchInit(args: { base: string; nameRaw: string | null; dryRun: boolean }): Promise<void> {
  const parsedName = parseScratchAgentName(args.nameRaw ?? undefined);
  if (!parsedName.ok) throw new Refusal(parsedName.reason);
  const name = parsedName.name;
  const credsPath = join(AGENTS_DIR, `${name}.json`);
  if (existsSync(credsPath)) {
    throw new Refusal(`${credsPath} already exists. This command never overwrites a bearer file; pick another --name or move that file deliberately.`);
  }

  // Prove the creds directory is writable BEFORE minting a server-side project:
  // a 201 whose api_key cannot be persisted would orphan the birth grant.
  mkdirSync(AGENTS_DIR, { recursive: true, mode: 0o700 });
  const keys = generateScratchKeys();
  const timestamp = new Date().toISOString();
  const startedAt = Date.now();
  const registration = buildScratchRegistration({
    name,
    keys,
    timestamp,
    registrationNonce: randomUUID(),
    runtime: {
      provider: SCRATCH_RUNTIME_PROVIDER,
      host: hostname(),
      context: "scratch agent for the widened-route x402 witness (docs/X402-PROOF.md)",
    },
  });
  log(`proof-of-work: ${registration.powIterations} iterations in ${Date.now() - startedAt}ms`);

  if (args.dryRun) {
    log("dry-run: registration body built and signed, NOT sent. No file written.");
    return;
  }

  const res = await call(`${args.base}/v1/register/agent`, { method: "POST", body: JSON.stringify(registration.body) });
  log(`POST /v1/register/agent → ${res.status}`);
  if (res.status !== 201) {
    printBody(res.json, res.text);
    const retryAfter = res.headers.get("retry-after");
    throw new LoopOpen(
      `registration answered ${res.status}` +
        (res.status === 422 ? " (pow_required: the server's difficulty differs from the default 18 bits — see difficulty_bits above)" : "") +
        (res.status === 429 ? ` (rate_limited; Retry-After ${retryAfter ?? "?"}s — five self-service births per IP per hour)` : "") +
        ".",
    );
  }
  const parsed = readRegistrationResponse(res.json);
  if (!parsed.ok) {
    printBody(res.json, res.text);
    throw new LoopOpen(`201 but ${parsed.reason}; nothing written`);
  }
  writePrivateJson(credsPath, scratchCredsRecord({ name, outcome: parsed.outcome, keys, base: args.base, createdIso: timestamp }));
  log(`did:     ${parsed.outcome.did}`);
  log(`project: ${parsed.outcome.projectId}`);
  log(`credits: ${parsed.outcome.credits ?? "unreadable"} (birth grant)`);
  log(`creds:   ${credsPath} (0600)`);
  log(`next: bun scripts/x402-proof.ts deplete --bearer-file ${credsPath} --route 'POST /v1/memories/search' --json '{"query":"witness"}' --until 3`);
}

/** Phase B: walk a project down to a real shortfall on a metered route. */
async function cmdDeplete(args: {
  base: string;
  bearerFile: string | null;
  route: string | null;
  json: string | null;
  until: number | null;
  maxCalls: number | null;
  dryRun: boolean;
}): Promise<void> {
  if (!args.bearerFile) throw new Refusal("deplete needs --bearer-file <path> (a scratch agent; never deplete Ai's own project by default)");
  const spec = parseRouteSpecString(args.route ?? undefined);
  if (!spec.ok) throw new Refusal(spec.reason);
  if (args.until === null) throw new Refusal("deplete needs --until <credits> (stop once project.credits < this; the route's cost is the usual value, e.g. --until 3 for memory.search)");
  let bodyText: string | undefined;
  if (args.json !== null) {
    const parsed = parseJsonObjectFlag(args.json);
    if (!parsed.ok) throw new Refusal(parsed.reason);
    bodyText = parsed.text;
  }
  const { method, path } = spec;
  if (args.dryRun) {
    log(`dry-run: would call ${method} ${path} with the bearer from ${args.bearerFile} until project.credits < ${args.until}; nothing sent, nothing read.`);
    return;
  }
  const { bearer, path: bearerPath, who } = readBearer(args.bearerFile);
  const url = `${args.base}${path}`;
  log(`bearer: ${who} (${bearerPath})`);

  const start = await wakeCredits(args.base, bearer);
  if (start === null) throw new LoopOpen("cannot read project.credits from /v1/wake; not looping blind");
  log(`credits at start: ${start}; target: < ${args.until}`);
  if (start < args.until) {
    log("already below the target; nothing to do");
    return;
  }

  // First call discovers the route's cost: the balance must move by exactly it.
  let credits = start;
  let cost: number | null = null;
  let calls = 0;
  let attempt = 0;
  const startedAt = Date.now();
  while (credits >= args.until) {
    if (args.dryRun) {
      log("dry-run: would call the route now; stopping before the first request");
      return;
    }
    const res = await call(url, { method, bearer, body: bodyText });
    if (isRetryableStatus(res.status)) {
      if (attempt >= MAX_BACKOFF_ATTEMPTS) {
        printBody(res.json, res.text);
        throw new LoopOpen(`${res.status} ${MAX_BACKOFF_ATTEMPTS + 1} times in a row; stopping after ${calls} calls at ${credits} credits`);
      }
      const delay = backoffDelayMs(attempt, res.headers.get("retry-after"));
      attempt += 1;
      log(`  ${res.status} — backing off ${delay}ms (attempt ${attempt}/${MAX_BACKOFF_ATTEMPTS})`);
      await sleep(delay);
      continue;
    }
    attempt = 0;
    if (res.status !== 200) {
      printBody(res.json, res.text);
      throw new LoopOpen(`${method} ${path} answered ${res.status} after ${calls} calls at ${credits} credits` +
        (res.status === 402 ? " — the route is already short; the target may be unreachable (see depletionPlan)" : "") + ".");
    }
    calls += 1;
    const after = readCreditsBalanceHeader(res.headers) ?? await wakeCredits(args.base, bearer);
    if (after === null) throw new LoopOpen(`call ${calls} answered 200 but the balance is unreadable (no X-Credits-Balance, wake failed); stopping`);
    if (cost === null) {
      cost = credits - after;
      if (cost <= 0) {
        throw new LoopOpen(`route did not charge: project.credits ${credits} → ${after}. A free (or already paid) route cannot be depleted; stopping.`);
      }
      const plan = depletionPlan({ credits: start, cost, until: args.until, maxCalls: args.maxCalls ?? undefined });
      if (!plan.ok) throw new LoopOpen(plan.reason);
      log(`route cost: ${cost} credit${cost === 1 ? "" : "s"}; plan: ${plan.calls} call${plan.calls === 1 ? "" : "s"} → ${plan.finalCredits} credits${plan.capped ? ` (capped by --max-calls ${args.maxCalls})` : ""}`);
    } else {
      const step = depletionStepVerdict({ before: credits, after, cost });
      if (!step.ok) throw new LoopOpen(`call ${calls}: ${step.line}`);
    }
    credits = after;
    if (calls % 25 === 0) log(`  ${calls} calls · credits ${credits} · ${Math.round((Date.now() - startedAt) / 1000)}s`);
    if (args.maxCalls !== null && calls >= args.maxCalls) {
      log(`stopped at --max-calls ${args.maxCalls}: credits ${credits}`);
      break;
    }
  }

  const final = await wakeCredits(args.base, bearer);
  log(`credits at end: ${final ?? "unreadable"} after ${calls} call${calls === 1 ? "" : "s"} (${Math.round((Date.now() - startedAt) / 1000)}s)`);
  if (final !== null && final < args.until) {
    log(`below ${args.until}: the next ${method} ${path} is a real shortfall.`);
    log(`next: bun scripts/x402-proof.ts pay ${method} ${path}${bodyText ? ` --json '${bodyText}'` : ""} --bearer-file ${bearerPath}`);
  } else if (final !== null) {
    throw new LoopOpen(`credits ${final} are not below ${args.until}`);
  }
}

async function cmdReplay(args: { base: string; ref: string | undefined }): Promise<void> {
  if (!args.ref) throw new Refusal("replay needs <hash|last>");
  const stashed = loadStash(args.ref);
  const { bearer } = readBearer(stashed.bearer_file ?? null);
  const base = args.base === DEFAULT_API_BASE && stashed.base ? stashed.base : args.base;
  const url = `${base}${stashed.request_path}`;
  const method: ProofMethod = stashed.request_method ?? "POST";
  const body = stashed.request_body ?? undefined;
  const now = Math.floor(Date.now() / 1000);

  log(`replaying payment_id ${stashed.payment_id} to ${method} ${stashed.request_path} (signed ${stashed.created}, ${now < stashed.valid_before ? "still inside" : "past"} validBefore)`);
  const before = await wakeCredits(base, bearer);
  log(`credits before: ${before ?? "unreadable"}`);

  const res = await call(url, { method, bearer, body, headers: { "payment-signature": stashed.header } });
  log(`${method} ${stashed.request_path} + same PAYMENT-SIGNATURE → ${res.status}`);
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
  // `verify last` after `topup/pay --base <origin>` must query the origin the
  // payment was made against, not the default (review on PR #380); and it
  // must ask with the bearer that paid — a scratch agent's row is not
  // visible to Ai's project.
  const stashed = existsSync(stashPath(hash)) ? loadStash(hash) : null;
  const { bearer } = readBearer(stashed?.bearer_file ?? null);
  const base = args.base === DEFAULT_API_BASE && stashed?.base ? stashed.base : args.base;
  const res = await call(`${base}${paymentStatusPath(hash)}`, { method: "GET", bearer });
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
  if (summary.verdict !== "settled") throw new LoopOpen(`verdict is ${summary.verdict}, not settled (ledger + receipt must agree)`);
}

function usage(): void {
  log("usage: cd api && bun scripts/x402-proof.ts <command> [--base <origin>] [--dry-run] [--cap <credits>]");
  log("  wallet-init · address · topup <N> · replay <payment_id|last> · verify <payment_id|last>");
  log("  pay <METHOD> <path> [--json '<body>'] [--bearer-file <path>]");
  log("  scratch-agent init --name <n>");
  log("  deplete --bearer-file <path> --route '<METHOD> <path>' [--json '<body>'] --until <credits> [--max-calls <n>]");
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
    case "pay":
      await cmdPay({
        base: args.base,
        dryRun: args.dryRun,
        capCredits: args.capCredits,
        methodRaw: args.positional[0],
        pathRaw: args.positional[1],
        json: args.json,
        bearerFile: args.bearerFile,
      });
      return;
    case "scratch-agent":
      if (args.positional[0] !== "init") {
        usage();
        throw new Refusal(`scratch-agent needs a subcommand: init (got ${JSON.stringify(args.positional[0] ?? "")})`);
      }
      await cmdScratchInit({ base: args.base, nameRaw: args.name, dryRun: args.dryRun });
      return;
    case "deplete":
      await cmdDeplete({
        base: args.base,
        bearerFile: args.bearerFile,
        route: args.route,
        json: args.json,
        until: args.until,
        maxCalls: args.maxCalls,
        dryRun: args.dryRun,
      });
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
