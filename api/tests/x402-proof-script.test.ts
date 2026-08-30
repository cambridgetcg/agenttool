/** x402 proof script — the pure half.
 *
 *  `scripts/x402-proof.ts` is the kingdom's payer-side proof of the agent
 *  rail. Its walls live in `scripts/x402-proof-lib.ts` so they can be pinned
 *  here without a network, a keychain, or a clock:
 *
 *    - requirement selection against a fixture 402 built by the SERVER's own
 *      builders (`buildPaymentRequired` / `buildPaymentRequirements`), so a
 *      drift between what the server emits and what the script accepts is a
 *      test failure, not a surprise at settlement time;
 *    - the refusal matrix: wrong payTo, wrong network, wrong asset, over cap,
 *      price that disagrees with the locked rate, malformed header/body;
 *    - address derivation from a fixed test mnemonic → the known address;
 *    - balanceOf calldata + result parsing, USDC formatting;
 *    - replay + verify verdicts, CLI arg parsing.
 *
 *  Phase B (W2-5) adds, in the same spirit:
 *
 *    - generic `pay` selection against a memory.search 402 built with the
 *      server's own resource + requirement builders, plus its refusal matrix
 *      (whole-credit price, resource path == the path we called);
 *    - the depletion planner's arithmetic, checked against a simulation of
 *      the server's charge rule (`credits ≥ cost` or 402);
 *    - the scratch-agent registration body, verified by the SERVER's own
 *      `checkRegisterAgentPow` + `verifyRegisterAgentSignature`;
 *    - bearer-file shape, route-spec parsing (WAKE-free doors refused), args.
 *
 *  No test here touches `security`, `~/.config/kingdom`, `~/.agenttool-agents`, or fetch. */

import { describe, expect, test } from "bun:test";

import {
  buildPaymentRequired,
  buildPaymentRequirements,
  encodeCanonicalBase64Json,
  X402_VERSION,
} from "../src/middleware/x402";
import { parseX402Header } from "../src/middleware/x402";
import { errors } from "../src/lib/errors";
import { signExactEvmAuthorization } from "../src/services/economy/x402-client";
import { authorizationIdentityHash } from "../src/services/economy/x402-payments";
import {
  x402ProjectCreditResource,
  type X402ProjectCreditPolicy,
} from "../src/services/economy/x402-policy";
import {
  canonicalRegisterAgentBytes,
  checkRegisterAgentPow,
  verifyRegisterAgentSignature,
} from "../src/services/identity/crypto";
import {
  ATOMIC_PER_CREDIT,
  atomicForCredits,
  backoffDelayMs,
  balanceOfRpcRequest,
  buildScratchRegistration,
  DEFAULT_POW_DIFFICULTY_BITS,
  depletionPlan,
  depletionStepVerdict,
  expectedPaidDelta,
  isNeverMeteredPath,
  isRetryableStatus,
  MAX_BACKOFF_ATTEMPTS,
  NEVER_METERED_PREFIXES,
  parseBearerFile,
  parseJsonObjectFlag,
  parseRouteSpec,
  parseRouteSpecString,
  parseScratchAgentName,
  readCreditsBalanceHeader,
  readRegistrationResponse,
  RESERVED_AGENT_NAMES,
  scratchCredsRecord,
  scratchKeysFromSeeds,
  SCRATCH_RUNTIME_PROVIDER,
  selectPayRequirement,
  BASE_NETWORK,
  BASE_USDC,
  buildPayerRecord,
  DEFAULT_API_BASE,
  DEFAULT_TOP_UP_CAP_CREDITS,
  decodePaymentRequiredHeader,
  derivePayer,
  encodeBalanceOfCall,
  formatUsdc,
  isAuthorizationHash,
  isValidPayerMnemonic,
  KEYCHAIN_ACCOUNT,
  KEYCHAIN_SERVICE,
  KINGDOM_TREASURY,
  ledgerPaymentId,
  MAX_VALIDITY_SECONDS,
  parseBalanceOfResult,
  parsePaymentResponseHeader,
  parseProofArgs,
  parseTopUpCredits,
  PAYER_DERIVATION_PATH,
  payerSigner,
  paymentStatusPath,
  proofSpendPolicy,
  readTransactionReceipt,
  readWakeCredits,
  replayVerdict,
  selectTopUpRequirement,
  summarizeVerification,
  topUpPath,
  transactionReceiptRpcRequest,
} from "../scripts/x402-proof-lib";

// The Anvil/Hardhat development phrase. Public, worthless, and its first
// account is the best-known address in EVM tooling.
const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const OTHER_ADDRESS = "0x1111111111111111111111111111111111111111";
const POLYGON_USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

/** A fixture 402 exactly as the server would emit it for `topup N`. */
function fixture402(credits: number, overrides: Partial<{
  payTo: string;
  network: "eip155:8453" | "eip155:137" | "eip155:84532";
  amountAtomic: string;
  asset: string;
}> = {}) {
  const requirement = buildPaymentRequirements({
    amountAtomic: overrides.amountAtomic ?? atomicForCredits(credits).toString(),
    payTo: overrides.payTo ?? KINGDOM_TREASURY,
    network: overrides.network ?? BASE_NETWORK,
    maxTimeoutSeconds: 60,
  });
  if (overrides.asset) requirement.asset = overrides.asset;
  const required = buildPaymentRequired(
    {
      url: `${DEFAULT_API_BASE}${topUpPath(credits)}`,
      description: `Top up ${credits} credit(s)`,
      mimeType: "application/json",
      serviceName: "AgentTool",
    },
    [requirement],
    "top_up_payment_required",
  );
  return {
    required,
    headerValue: encodeCanonicalBase64Json(required),
    // W2-2 shape: guidance keys spread under the PaymentRequired keys.
    body: {
      error: "top_up_payment_required",
      message: "Pay the challenge to add credits.",
      hint: "Retry with PAYMENT-SIGNATURE.",
      ...required,
    },
  };
}

describe("locked constants", () => {
  test("rate, cap, treasury, asset, path are the plan's numbers", () => {
    expect(ATOMIC_PER_CREDIT).toBe(1000n);
    expect(DEFAULT_TOP_UP_CAP_CREDITS).toBe(10_000);
    expect(KINGDOM_TREASURY).toBe("0xA9eeA60CAaF239AbAfAA05FcB152128dB16dD3d8");
    expect(BASE_USDC).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(BASE_NETWORK).toBe("eip155:8453");
    expect(PAYER_DERIVATION_PATH).toBe("m/44'/60'/0'/0/0");
    expect(KEYCHAIN_SERVICE).toBe("kingdom-x402-payer-mnemonic");
    expect(KEYCHAIN_ACCOUNT).toBe("kingdom");
    expect(MAX_VALIDITY_SECONDS).toBe(60);
  });

  test("the server's own USDC pin for Base is the one this script allows", () => {
    // If the server's asset table ever moves, the script must move with it.
    expect(buildPaymentRequirements({ amountAtomic: "1000", payTo: KINGDOM_TREASURY }).asset)
      .toBe(BASE_USDC);
  });

  test("the spend policy names exactly one recipient, network, asset", () => {
    const policy = proofSpendPolicy();
    expect(policy.allowedPayTo).toEqual([KINGDOM_TREASURY]);
    expect(policy.allowedNetworks).toEqual([BASE_NETWORK]);
    expect(policy.allowedAssets).toEqual([BASE_USDC]);
    expect(policy.maxAmountAtomic).toBe(10_000_000n);
    expect(policy.maxValiditySeconds).toBe(60);
    expect(proofSpendPolicy(3).maxAmountAtomic).toBe(3000n);
  });

  test("paths", () => {
    expect(topUpPath(1)).toBe("/v1/x402/top-up/1");
    expect(paymentStatusPath("a".repeat(64))).toBe(`/v1/x402/payments/${"a".repeat(64)}`);
    expect(isAuthorizationHash("a".repeat(64))).toBe(true);
    expect(isAuthorizationHash("A".repeat(64))).toBe(false);
    expect(isAuthorizationHash("a".repeat(63))).toBe(false);
  });
});

describe("credits parsing", () => {
  test("accepts canonical positive integers inside the 32-bit column", () => {
    expect(parseTopUpCredits("1")).toEqual({ ok: true, credits: 1 });
    expect(parseTopUpCredits("10000")).toEqual({ ok: true, credits: 10_000 });
    expect(parseTopUpCredits("2147483647")).toEqual({ ok: true, credits: 2_147_483_647 });
  });

  test("refuses everything the W2-1 matcher refuses", () => {
    for (const bad of ["0", "abc", "01", "1e9", "-1", "+1", "1.5", "", " 1", "2147483648", "99999999999999999999"]) {
      const parsed = parseTopUpCredits(bad);
      expect(parsed.ok).toBe(false);
    }
  });

  test("atomic conversion follows the locked rate", () => {
    expect(atomicForCredits(1)).toBe(1000n);
    expect(atomicForCredits(10_000)).toBe(10_000_000n);
  });
});

describe("requirement selection against the server's own 402", () => {
  test("selects the Base USDC exact requirement for topup 1 from the header", () => {
    const f = fixture402(1);
    const selection = selectTopUpRequirement({ headerValue: f.headerValue, body: f.body, credits: 1 });
    expect(selection.ok).toBe(true);
    if (!selection.ok) return;
    expect(selection.amountAtomic).toBe(1000n);
    expect(selection.requirement.payTo).toBe(KINGDOM_TREASURY);
    expect(selection.requirement.network).toBe("eip155:8453");
    expect(selection.requirement.asset).toBe(BASE_USDC);
    expect(selection.requirement.extra.assetTransferMethod).toBe("eip3009");
    expect(selection.required.resource.url).toBe("https://api.agenttool.dev/v1/x402/top-up/1");
  });

  test("falls back to the additive W2-2 body when no header is present", () => {
    const f = fixture402(7);
    const selection = selectTopUpRequirement({ headerValue: null, body: f.body, credits: 7 });
    expect(selection.ok).toBe(true);
    if (!selection.ok) return;
    expect(selection.amountAtomic).toBe(7000n);
  });

  test("the header wins over a body that disagrees", () => {
    const f = fixture402(1);
    const rogueBody = fixture402(1, { payTo: OTHER_ADDRESS }).body;
    const selection = selectTopUpRequirement({ headerValue: f.headerValue, body: rogueBody, credits: 1 });
    expect(selection.ok).toBe(true);
  });

  test("decodePaymentRequiredHeader is canonical-strict", () => {
    expect(decodePaymentRequiredHeader("not base64!")).toBeNull();
    expect(decodePaymentRequiredHeader(Buffer.from("[1,2").toString("base64"))).toBeNull();
    expect(decodePaymentRequiredHeader(fixture402(1).headerValue)).toMatchObject({ x402Version: X402_VERSION });
  });
});

describe("refusal matrix", () => {
  const refusal = (input: Parameters<typeof selectTopUpRequirement>[0]) => {
    const selection = selectTopUpRequirement(input);
    expect(selection.ok).toBe(false);
    return selection.ok ? null : selection;
  };

  test("payTo that is not the treasury", () => {
    const f = fixture402(1, { payTo: OTHER_ADDRESS });
    const r = refusal({ headerValue: f.headerValue, body: f.body, credits: 1 });
    expect(r?.reason).toBe("pay_to_not_allowed");
    expect(r?.detail).toContain(OTHER_ADDRESS);
  });

  test("network that is not Base", () => {
    const f = fixture402(1, { network: "eip155:137" });
    const r = refusal({ headerValue: f.headerValue, body: f.body, credits: 1 });
    expect(r?.reason).toBe("network_not_allowed");
  });

  test("Base Sepolia is refused too — this proof is mainnet only", () => {
    const f = fixture402(1, { network: "eip155:84532" });
    expect(refusal({ headerValue: f.headerValue, body: f.body, credits: 1 })?.reason).toBe("network_not_allowed");
  });

  test("asset that is not Base USDC", () => {
    const f = fixture402(1, { asset: POLYGON_USDC });
    const r = refusal({ headerValue: f.headerValue, body: f.body, credits: 1 });
    expect(r?.reason).toBe("asset_not_allowed");
  });

  test("amount over the default cap is refused, never clamped", () => {
    const f = fixture402(10_001);
    const r = refusal({ headerValue: f.headerValue, body: f.body, credits: 10_001 });
    expect(r?.reason).toBe("amount_over_cap");
    expect(r?.detail).toContain("10000000");
  });

  test("a lower --cap tightens the wall", () => {
    const f = fixture402(5);
    expect(refusal({ headerValue: f.headerValue, body: f.body, credits: 5, capCredits: 4 })?.reason)
      .toBe("amount_over_cap");
    expect(selectTopUpRequirement({ headerValue: f.headerValue, body: f.body, credits: 5, capCredits: 5 }).ok)
      .toBe(true);
  });

  test("a price that disagrees with the locked rate — higher", () => {
    const f = fixture402(1, { amountAtomic: "1001" });
    const r = refusal({ headerValue: f.headerValue, body: f.body, credits: 1 });
    expect(r?.reason).toBe("amount_mismatch");
    expect(r?.detail).toContain("expects exactly 1000");
  });

  test("a price that disagrees with the locked rate — lower (a discount is still a mismatch)", () => {
    const f = fixture402(2, { amountAtomic: "1000" });
    expect(refusal({ headerValue: f.headerValue, body: f.body, credits: 2 })?.reason).toBe("amount_mismatch");
  });

  test("the deposit rail's 0.01 rate would be refused", () => {
    // 1 credit at CREDITS_PER_USDC=100 would be 10,000 atomic. The locked
    // x402 rate is 1,000. The script refuses the other rate on sight.
    const f = fixture402(1, { amountAtomic: "10000" });
    expect(refusal({ headerValue: f.headerValue, body: f.body, credits: 1 })?.reason).toBe("amount_mismatch");
  });

  test("not a PaymentRequired at all", () => {
    expect(refusal({ headerValue: null, body: { error: "insufficient_credits" }, credits: 1 })?.reason)
      .toBe("not_a_payment_required_body");
    expect(refusal({ headerValue: "garbage", body: null, credits: 1 })?.reason)
      .toBe("not_a_payment_required_body");
    expect(refusal({ headerValue: null, body: { ...fixture402(1).required, x402Version: 1 }, credits: 1 })?.reason)
      .toBe("not_a_payment_required_body");
  });

  test("a requirement with an extra key is refused by the server parser, so by us", () => {
    const f = fixture402(1);
    const body = {
      ...f.required,
      accepts: [{ ...f.required.accepts[0], surprise: true }],
    };
    expect(refusal({ headerValue: null, body, credits: 1 })?.reason).toBe("not_a_payment_required_body");
  });

  test("the first acceptable entry wins; a rogue first entry is skipped with the last refusal remembered", () => {
    const f = fixture402(1);
    const rogue = buildPaymentRequirements({ amountAtomic: "1000", payTo: OTHER_ADDRESS });
    const body = { ...f.required, accepts: [rogue, f.required.accepts[0]] };
    const selection = selectTopUpRequirement({ headerValue: null, body, credits: 1 });
    expect(selection.ok).toBe(true);
    if (selection.ok) expect(selection.requirement.payTo).toBe(KINGDOM_TREASURY);
  });
});

describe("payer derivation", () => {
  test("the fixed test mnemonic derives the known first account", () => {
    const payer = derivePayer(TEST_MNEMONIC);
    expect(payer.address).toBe(TEST_ADDRESS);
    expect(payer.account.address).toBe(TEST_ADDRESS);
  });

  test("whitespace around the phrase is tolerated; a bad phrase is not", () => {
    expect(derivePayer(`  ${TEST_MNEMONIC}\n`).address).toBe(TEST_ADDRESS);
    expect(isValidPayerMnemonic(TEST_MNEMONIC)).toBe(true);
    expect(isValidPayerMnemonic("test test test")).toBe(false);
    expect(() => derivePayer("test test test")).toThrow(/valid BIP-39/u);
  });

  test("the payer record carries no secret and the right public facts", () => {
    const record = buildPayerRecord(TEST_ADDRESS, "2026-08-29T00:00:00.000Z");
    expect(record).toEqual({
      name: "kingdom-x402-payer",
      address: TEST_ADDRESS,
      chain: "eip155:8453",
      asset: BASE_USDC,
      derivation: "m/44'/60'/0'/0/0",
      keychain: { service: KEYCHAIN_SERVICE, account: KEYCHAIN_ACCOUNT },
      created: "2026-08-29T00:00:00.000Z",
      purpose: expect.stringContaining("Separate from identity and from the treasury"),
    });
    expect(JSON.stringify(record)).not.toContain("test test");
  });

  test("what the derived payer signs satisfies the server's inbound parser", async () => {
    const f = fixture402(1);
    const selection = selectTopUpRequirement({ headerValue: f.headerValue, body: f.body, credits: 1 });
    expect(selection.ok).toBe(true);
    if (!selection.ok) return;
    const payer = derivePayer(TEST_MNEMONIC);
    const signed = await signExactEvmAuthorization({
      requirement: selection.requirement,
      policy: proofSpendPolicy(),
      payerAddress: payer.address,
      signer: payerSigner(payer.account),
      nowSeconds: 1_800_000_000,
      resource: selection.required.resource,
    });
    const parsed = parseX402Header(signed.header);
    expect(parsed).not.toBeNull();
    expect(parsed!.accepted.payTo).toBe(KINGDOM_TREASURY);
    expect((parsed!.payload.authorization as { from: string }).from).toBe(TEST_ADDRESS);
    expect((parsed!.payload.authorization as { value: string }).value).toBe("1000");
    expect(signed.validBefore - 1_800_000_000).toBe(60);
    expect(isAuthorizationHash(signed.authorizationHash)).toBe(true);
  });

  test("the ledger payment_id is the server's identity hash, not the client's authorization hash", async () => {
    const f = fixture402(1);
    const selection = selectTopUpRequirement({ headerValue: f.headerValue, body: f.body, credits: 1 });
    if (!selection.ok) throw new Error(selection.detail);
    const payer = derivePayer(TEST_MNEMONIC);
    const signed = await signExactEvmAuthorization({
      requirement: selection.requirement,
      policy: proofSpendPolicy(),
      payerAddress: payer.address,
      signer: payerSigner(payer.account),
      nowSeconds: 1_800_000_000,
    });
    const paymentId = ledgerPaymentId(signed.payload);
    expect(isAuthorizationHash(paymentId)).toBe(true);
    // Same bytes the server would receive → same identity the status route is keyed on.
    const parsed = parseX402Header(signed.header)!;
    expect(paymentId).toBe(authorizationIdentityHash(parsed.accepted, parsed.payload as never));
    // And it is NOT the client-side hash: the server folds network + asset in.
    expect(paymentId).not.toBe(signed.authorizationHash);
    expect(() => ledgerPaymentId({ ...signed.payload, payload: {} })).toThrow(/EIP-3009/u);
  });
});

describe("balanceOf over raw JSON-RPC", () => {
  test("calldata is selector + left-padded lowercase address", () => {
    expect(encodeBalanceOfCall(KINGDOM_TREASURY)).toBe(
      "0x70a08231000000000000000000000000a9eea60caaf239abafaa05fcb152128db16dd3d8",
    );
    expect(() => encodeBalanceOfCall("0x123")).toThrow(/EVM address/u);
  });

  test("request envelope targets the USDC contract at latest", () => {
    const req = balanceOfRpcRequest(BASE_USDC, TEST_ADDRESS, 7);
    expect(req).toEqual({
      jsonrpc: "2.0",
      id: 7,
      method: "eth_call",
      params: [{ to: BASE_USDC, data: encodeBalanceOfCall(TEST_ADDRESS) }, "latest"],
    });
    expect(transactionReceiptRpcRequest(`0x${"ab".repeat(32)}`)).toMatchObject({ method: "eth_getTransactionReceipt" });
    expect(() => transactionReceiptRpcRequest("0xnope")).toThrow(/transaction hash/u);
  });

  test("result parsing accepts one uint256 word and nothing else", () => {
    expect(parseBalanceOfResult(`0x${"0".repeat(63)}1`)).toBe(1n);
    expect(parseBalanceOfResult(`0x${"0".repeat(58)}0f4240`)).toBe(1_000_000n);
    expect(parseBalanceOfResult("0x")).toBeNull();
    expect(parseBalanceOfResult("0x1")).toBeNull();
    expect(parseBalanceOfResult(null)).toBeNull();
    expect(parseBalanceOfResult(`0x${"0".repeat(64)}00`)).toBeNull();
  });

  test("USDC formatting is six decimals, exact", () => {
    expect(formatUsdc(0n)).toBe("0.000000");
    expect(formatUsdc(1000n)).toBe("0.001000");
    expect(formatUsdc(1_234_567n)).toBe("1.234567");
    expect(formatUsdc(5_000_000n)).toBe("5.000000");
    expect(formatUsdc(-1n)).toBe("-0.000001");
  });

  test("transaction receipt view", () => {
    expect(readTransactionReceipt({ status: "0x1", blockNumber: "0x10", to: BASE_USDC }))
      .toEqual({ status: "success", blockNumber: 16n, to: BASE_USDC });
    expect(readTransactionReceipt({ status: "0x0" })).toMatchObject({ status: "reverted", blockNumber: null });
    expect(readTransactionReceipt(null)).toBeNull();
  });
});

describe("response readers", () => {
  test("PAYMENT-RESPONSE decodes the facilitator's SettleResponse", () => {
    const settle = { success: true, transaction: `0x${"cd".repeat(32)}`, network: "eip155:8453" as const, payer: TEST_ADDRESS };
    expect(parsePaymentResponseHeader(encodeCanonicalBase64Json(settle))).toEqual(settle);
    expect(parsePaymentResponseHeader(encodeCanonicalBase64Json({ success: "yes" }))).toBeNull();
    expect(parsePaymentResponseHeader("nope")).toBeNull();
  });

  test("credits come from /v1/wake project.credits — the column the rail credits", () => {
    expect(readWakeCredits({ project: { id: "p", name: "ai", credits: 110_800 } })).toBe(110_800);
    expect(readWakeCredits({ wallet: { credits: 5 } })).toBeNull();
    expect(readWakeCredits({ project: { credits: "5" } })).toBeNull();
    expect(readWakeCredits(null)).toBeNull();
  });
});

describe("verdicts", () => {
  test("replay: only an unchanged credit column is a pass", () => {
    expect(replayVerdict(100, 100)).toEqual({ ok: true, line: expect.stringContaining("no second credit") });
    expect(replayVerdict(100, 101)).toEqual({ ok: false, line: expect.stringContaining("SECOND CREDIT APPLIED") });
    expect(replayVerdict(100, 99).ok).toBe(false);
    expect(replayVerdict(null, 100).ok).toBe(false);
  });

  test("verify: settled row without a receipt is settled_unverified, never settled", () => {
    const v = summarizeVerification({
      status: { status: "settled", credits_purchased: 1, credits_applied: 1, amount: "1000", pay_to: KINGDOM_TREASURY, transaction: `0x${"ab".repeat(32)}` },
      treasuryBalanceAtomic: null,
      receipt: null,
      txHash: `0x${"ab".repeat(32)}`,
    });
    expect(v.verdict).toBe("settled_unverified");
  });

  test("verify: settled row + successful receipt → settled", () => {
    const v = summarizeVerification({
      status: { status: "settled", credits_purchased: 1, credits_applied: 1, amount: "1000", pay_to: KINGDOM_TREASURY, transaction: `0x${"ab".repeat(32)}`, next_action: "complete" },
      treasuryBalanceAtomic: 1000n,
      receipt: { status: "success", blockNumber: 1n, to: BASE_USDC },
      txHash: `0x${"ab".repeat(32)}`,
    });
    expect(v.verdict).toBe("settled");
    expect(v.lines.join("\n")).toContain("status=settled");
    expect(v.lines.join("\n")).toContain("0.001000 USDC");
  });

  test("verify: pending/inserted rows are pending; missing row is not_found; reverted receipt is failed", () => {
    expect(summarizeVerification({ status: { status: "pending" }, treasuryBalanceAtomic: null, receipt: null, txHash: null }).verdict).toBe("pending");
    expect(summarizeVerification({ status: { status: "inserted" }, treasuryBalanceAtomic: null, receipt: null, txHash: null }).verdict).toBe("pending");
    expect(summarizeVerification({ status: null, treasuryBalanceAtomic: 0n, receipt: null, txHash: null }).verdict).toBe("not_found");
    expect(summarizeVerification({ status: { status: "failed", failure_reason: "settle_refused" }, treasuryBalanceAtomic: null, receipt: null, txHash: null }).verdict).toBe("failed");
    expect(summarizeVerification({
      status: { status: "settled" },
      treasuryBalanceAtomic: null,
      receipt: { status: "reverted", blockNumber: null, to: null },
      txHash: `0x${"ab".repeat(32)}`,
    }).verdict).toBe("failed");
  });
});

describe("CLI args", () => {
  test("defaults: production base, no dry-run, default cap", () => {
    expect(parseProofArgs(["topup", "1"])).toEqual({
      command: "topup",
      positional: ["1"],
      base: DEFAULT_API_BASE,
      dryRun: false,
      capCredits: DEFAULT_TOP_UP_CAP_CREDITS,
      json: null,
      bearerFile: null,
      route: null,
      until: null,
      name: null,
      maxCalls: null,
      error: null,
    });
  });

  test("--base, --dry-run, --cap, env cap, trailing slash trimmed", () => {
    const args = parseProofArgs(["topup", "1", "--base", "http://127.0.0.1:3000/", "--dry-run", "--cap=5"]);
    expect(args.base).toBe("http://127.0.0.1:3000");
    expect(args.dryRun).toBe(true);
    expect(args.capCredits).toBe(5);
    expect(parseProofArgs(["address"], { X402_TOP_UP_MAX_CREDITS: "20" }).capCredits).toBe(20);
    expect(parseProofArgs(["address"], { X402_PROOF_BASE: "https://x.example" }).base).toBe("https://x.example");
  });

  test("bad flags are errors, not guesses", () => {
    expect(parseProofArgs(["--nope"]).error).toContain("unknown flag");
    expect(parseProofArgs(["topup", "--base"]).error).toContain("--base");
    expect(parseProofArgs(["topup", "--base", "ftp://x"]).error).toContain("--base");
    expect(parseProofArgs(["topup", "--cap", "0"]).error).toContain("--cap");
    expect(parseProofArgs(["address"], { X402_TOP_UP_MAX_CREDITS: "abc" }).error).toContain("X402_TOP_UP_MAX_CREDITS");
  });
});

// ═══ Phase B (W2-5) ═══════════════════════════════════════════════════════

/** The memory.search row's price. On this branch the route charges a literal
 *  3 (`routes/memory/search.ts` `charge(c, 3, "memory.search")`); W2-5's
 *  route-credits table hoists it. The fixture is priced from that number
 *  through the locked rate, never from a hand-typed atomic amount. */
import { ROUTE_CREDITS } from "../src/billing/route-credits";
const MEMORY_SEARCH_CREDITS = ROUTE_CREDITS["memory.search"];
const MEMORY_SEARCH_PATH = "/v1/memories/search";

/** A route_cost 402 exactly as the server would emit it: the policy shape
 *  `x402ProjectCreditPolicy` produces for a static row, the resource from
 *  `x402ProjectCreditResource` (the same builder the challenge and the
 *  verifier share), the requirement from `buildPaymentRequirements`, and the
 *  handler's own `insufficient_credits` guidance spread under the spec keys. */
function routeCost402(input: {
  path?: string;
  credits?: number;
  payTo?: string;
  network?: "eip155:8453" | "eip155:137" | "eip155:84532";
  amountAtomic?: string;
  asset?: string;
  base?: string;
} = {}) {
  const path = input.path ?? MEMORY_SEARCH_PATH;
  const credits = input.credits ?? MEMORY_SEARCH_CREDITS;
  const base = input.base ?? DEFAULT_API_BASE;
  const policy: X402ProjectCreditPolicy = {
    path,
    pattern: path,
    kind: "route_cost",
    label: "memory.search",
    creditsRequired: credits,
    amountAtomic: atomicForCredits(credits).toString(),
    description: `Exact project-credit payment for ${path} (${credits} credits).`,
  };
  const resource = x402ProjectCreditResource(policy, `${base}${path}`, base);
  if (!resource) throw new Error("fixture: no resource");
  const requirement = buildPaymentRequirements({
    amountAtomic: input.amountAtomic ?? policy.amountAtomic,
    payTo: input.payTo ?? KINGDOM_TREASURY,
    network: input.network ?? BASE_NETWORK,
    maxTimeoutSeconds: 60,
  });
  if (input.asset) requirement.asset = input.asset;
  const required = buildPaymentRequired(resource, [requirement], "insufficient_credits");
  const guidance = errors.insufficientCredits({ reason: "memory.search", need: credits, have: credits - 1 });
  return {
    required,
    headerValue: encodeCanonicalBase64Json(required),
    body: { ...guidance, ...required },
  };
}

describe("route specs", () => {
  test("accepts a concrete (METHOD, pathname) and uppercases the method", () => {
    expect(parseRouteSpec("post", MEMORY_SEARCH_PATH)).toEqual({ ok: true, method: "POST", path: MEMORY_SEARCH_PATH });
    expect(parseRouteSpecString("POST /v1/memories/search")).toEqual({ ok: true, method: "POST", path: MEMORY_SEARCH_PATH });
    expect(parseRouteSpecString("  delete   /v1/listings/abc  ")).toEqual({ ok: true, method: "DELETE", path: "/v1/listings/abc" });
  });

  test("refuses what the payable-route matcher would never match", () => {
    for (const [method, path] of [
      ["PUT", MEMORY_SEARCH_PATH],
      ["POST", "v1/memories/search"],
      ["POST", "/v1/memories/search?x=1"],
      ["POST", "/v1/memories/search#frag"],
      ["POST", "/v1/memories/search/"],
      ["POST", "/v1//memories/search"],
      ["POST", "/v1/memories search"],
      [undefined, MEMORY_SEARCH_PATH],
      ["POST", undefined],
    ] as const) {
      const r = parseRouteSpec(method, path);
      expect(r.ok).toBe(false);
    }
    expect(parseRouteSpecString(undefined).ok).toBe(false);
    expect(parseRouteSpecString("POST").ok).toBe(false);
    expect(parseRouteSpecString("POST /a /b").ok).toBe(false);
  });

  test("WAKE-free doors are refused before any request: wake, welcome, register, public, time, random", () => {
    expect(NEVER_METERED_PREFIXES).toEqual(["/v1/wake", "/v1/welcome", "/v1/register", "/public", "/v1/time", "/v1/random"]);
    for (const prefix of NEVER_METERED_PREFIXES) {
      expect(isNeverMeteredPath(prefix)).toBe(true);
      expect(isNeverMeteredPath(`${prefix}/agent`)).toBe(true);
      const r = parseRouteSpec("POST", prefix);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("WAKE-free");
    }
    expect(isNeverMeteredPath("/v1/wakeful")).toBe(false);
    expect(isNeverMeteredPath("/v1/publicity")).toBe(false);
    expect(isNeverMeteredPath(MEMORY_SEARCH_PATH)).toBe(false);
    expect(isNeverMeteredPath(topUpPath(1))).toBe(false);
  });

  test("--json must be one JSON object; it is re-serialised canonically", () => {
    const r = parseJsonObjectFlag('{ "query" : "witness" , "limit": 1 }');
    expect(r).toEqual({ ok: true, body: { query: "witness", limit: 1 }, text: '{"query":"witness","limit":1}' });
    expect(parseJsonObjectFlag("[1]").ok).toBe(false);
    expect(parseJsonObjectFlag("null").ok).toBe(false);
    expect(parseJsonObjectFlag('"x"').ok).toBe(false);
    expect(parseJsonObjectFlag("{nope").ok).toBe(false);
    expect(parseJsonObjectFlag(undefined).ok).toBe(false);
  });
});

describe("generic pay selection against the server's own route_cost 402", () => {
  test("selects the Base USDC exact requirement for memory.search (3 credits) from the header", () => {
    const f = routeCost402();
    const selection = selectPayRequirement({ headerValue: f.headerValue, body: f.body, path: MEMORY_SEARCH_PATH });
    expect(selection.ok).toBe(true);
    if (!selection.ok) return;
    expect(selection.amountAtomic).toBe(atomicForCredits(MEMORY_SEARCH_CREDITS));
    expect(selection.credits).toBe(MEMORY_SEARCH_CREDITS);
    expect(selection.errorCode).toBe("insufficient_credits");
    expect(selection.requirement.payTo).toBe(KINGDOM_TREASURY);
    expect(selection.requirement.network).toBe("eip155:8453");
    expect(selection.requirement.asset).toBe(BASE_USDC);
    expect(selection.requirement.extra.assetTransferMethod).toBe("eip3009");
    expect(selection.required.resource.url).toBe(`${DEFAULT_API_BASE}${MEMORY_SEARCH_PATH}`);
  });

  test("the handler's guidance survives the additive merge and the body alone still parses", () => {
    const f = routeCost402();
    expect(f.body.error).toBe("insufficient_credits");
    expect(f.body.next_actions).toBeDefined();
    const selection = selectPayRequirement({ headerValue: null, body: f.body, path: MEMORY_SEARCH_PATH });
    expect(selection.ok).toBe(true);
    if (selection.ok) expect(selection.errorCode).toBe("insufficient_credits");
  });

  test("the header wins over a body that disagrees", () => {
    const f = routeCost402();
    const rogueBody = routeCost402({ payTo: OTHER_ADDRESS }).body;
    expect(selectPayRequirement({ headerValue: f.headerValue, body: rogueBody, path: MEMORY_SEARCH_PATH }).ok).toBe(true);
  });

  test("the top-up row's 402 is also payable through the generic path, with its own code", () => {
    const f = fixture402(7);
    const selection = selectPayRequirement({ headerValue: f.headerValue, body: f.body, path: topUpPath(7) });
    expect(selection.ok).toBe(true);
    if (!selection.ok) return;
    expect(selection.credits).toBe(7);
    expect(selection.errorCode).toBe("top_up_payment_required");
    expect(expectedPaidDelta(selection.errorCode, selection.credits)).toBe(7);
  });

  test("expected credit movement: route_cost nets zero (applied then spent), top_up is +N", () => {
    expect(expectedPaidDelta("insufficient_credits", 3)).toBe(0);
    expect(expectedPaidDelta(null, 3)).toBe(0);
    expect(expectedPaidDelta("top_up_payment_required", 250)).toBe(250);
  });

  test("what the payer signs for memory.search satisfies the server's inbound parser and binds the resource", async () => {
    const f = routeCost402();
    const selection = selectPayRequirement({ headerValue: f.headerValue, body: f.body, path: MEMORY_SEARCH_PATH });
    if (!selection.ok) throw new Error(selection.detail);
    const payer = derivePayer(TEST_MNEMONIC);
    const signed = await signExactEvmAuthorization({
      requirement: selection.requirement,
      policy: proofSpendPolicy(),
      payerAddress: payer.address,
      signer: payerSigner(payer.account),
      nowSeconds: 1_800_000_000,
      resource: selection.required.resource,
    });
    const parsed = parseX402Header(signed.header);
    expect(parsed).not.toBeNull();
    expect(parsed!.accepted.amount).toBe(atomicForCredits(MEMORY_SEARCH_CREDITS).toString());
    expect(parsed!.resource?.url).toBe(`${DEFAULT_API_BASE}${MEMORY_SEARCH_PATH}`);
    expect((parsed!.payload.authorization as { value: string }).value).toBe("3000");
    expect(isAuthorizationHash(ledgerPaymentId(signed.payload))).toBe(true);
  });
});

describe("generic pay refusal matrix", () => {
  const refusal = (input: Parameters<typeof selectPayRequirement>[0]) => {
    const selection = selectPayRequirement(input);
    expect(selection.ok).toBe(false);
    return selection.ok ? null : selection;
  };

  test("payTo that is not the treasury", () => {
    const f = routeCost402({ payTo: OTHER_ADDRESS });
    const r = refusal({ headerValue: f.headerValue, body: f.body, path: MEMORY_SEARCH_PATH });
    expect(r?.reason).toBe("pay_to_not_allowed");
    expect(r?.detail).toContain(OTHER_ADDRESS);
  });

  test("network that is not Base mainnet (Polygon, Base Sepolia)", () => {
    expect(refusal({ ...routeCost402({ network: "eip155:137" }), path: MEMORY_SEARCH_PATH })?.reason).toBe("network_not_allowed");
    expect(refusal({ ...routeCost402({ network: "eip155:84532" }), path: MEMORY_SEARCH_PATH })?.reason).toBe("network_not_allowed");
  });

  test("asset that is not Base USDC", () => {
    expect(refusal({ ...routeCost402({ asset: POLYGON_USDC }), path: MEMORY_SEARCH_PATH })?.reason).toBe("asset_not_allowed");
  });

  test("amount over --cap is refused, never clamped", () => {
    const f = routeCost402();
    const r = refusal({ headerValue: f.headerValue, body: f.body, path: MEMORY_SEARCH_PATH, capCredits: 2 });
    expect(r?.reason).toBe("amount_over_cap");
    expect(selectPayRequirement({ headerValue: f.headerValue, body: f.body, path: MEMORY_SEARCH_PATH, capCredits: 3 }).ok).toBe(true);
  });

  test("a price that is not a whole number of credits", () => {
    const f = routeCost402({ amountAtomic: "3001" });
    const r = refusal({ headerValue: f.headerValue, body: f.body, path: MEMORY_SEARCH_PATH });
    expect(r?.reason).toBe("amount_not_whole_credits");
    expect(r?.detail).toContain("3001");
    // 3,500 atomic is 3.5 credits — same wall.
    expect(refusal({ ...routeCost402({ amountAtomic: "3500" }), path: MEMORY_SEARCH_PATH })?.reason).toBe("amount_not_whole_credits");
  });

  test("a resource that names a path we did not call", () => {
    const f = routeCost402({ path: "/v1/scrape" });
    const r = refusal({ headerValue: f.headerValue, body: f.body, path: MEMORY_SEARCH_PATH });
    expect(r?.reason).toBe("resource_path_mismatch");
    expect(r?.detail).toContain("/v1/scrape");
    // A local base with the right path is fine: only the pathname is bound.
    const local = routeCost402({ base: "http://127.0.0.1:3000" });
    expect(selectPayRequirement({ headerValue: local.headerValue, body: local.body, path: MEMORY_SEARCH_PATH }).ok).toBe(true);
    // A resource that is not a URL at all is a mismatch, not a crash.
    const broken = { ...f.required, resource: { ...f.required.resource, url: "not a url" } };
    expect(refusal({ headerValue: null, body: broken, path: MEMORY_SEARCH_PATH })?.reason).toBe("resource_path_mismatch");
  });

  test("not a PaymentRequired at all — a bare insufficient_credits body is not a promise", () => {
    expect(refusal({ headerValue: null, body: errors.insufficientCredits({ reason: "memory.search", need: 3, have: 1 }), path: MEMORY_SEARCH_PATH })?.reason)
      .toBe("not_a_payment_required_body");
    expect(refusal({ headerValue: "garbage", body: null, path: MEMORY_SEARCH_PATH })?.reason).toBe("not_a_payment_required_body");
  });
});

describe("depletion planner", () => {
  /** The server's rule (`billing/charge.ts`): a call succeeds and deducts
   *  `cost` only while `credits ≥ cost`; otherwise it 402s and nothing moves. */
  function simulate(credits: number, cost: number, calls: number): { credits: number; refused: number } {
    let balance = credits;
    let refused = 0;
    for (let i = 0; i < calls; i += 1) {
      if (balance >= cost) balance -= cost;
      else refused += 1;
    }
    return { credits: balance, refused };
  }

  test("the birth grant to below memory.search's cost: 1,000 → 333 calls → 1 credit", () => {
    const plan = depletionPlan({ credits: 1_000, cost: MEMORY_SEARCH_CREDITS, until: MEMORY_SEARCH_CREDITS });
    expect(plan).toEqual({ ok: true, calls: 333, finalCredits: 1, capped: false });
    const sim = simulate(1_000, 3, 333);
    expect(sim).toEqual({ credits: 1, refused: 0 });
    expect(sim.credits < MEMORY_SEARCH_CREDITS).toBe(true);
    // One fewer call is not below the target.
    expect(simulate(1_000, 3, 332).credits).toBe(4);
  });

  test("boundaries: already below, exactly at, one step", () => {
    expect(depletionPlan({ credits: 2, cost: 3, until: 3 })).toEqual({ ok: true, calls: 0, finalCredits: 2, capped: false });
    expect(depletionPlan({ credits: 3, cost: 3, until: 3 })).toEqual({ ok: true, calls: 1, finalCredits: 0, capped: false });
    expect(depletionPlan({ credits: 4, cost: 3, until: 3 })).toEqual({ ok: true, calls: 1, finalCredits: 1, capped: false });
    expect(depletionPlan({ credits: 1_000, cost: 3, until: 1_000 })).toEqual({ ok: true, calls: 1, finalCredits: 997, capped: false });
    expect(depletionPlan({ credits: 999, cost: 3, until: 1_000 })).toEqual({ ok: true, calls: 0, finalCredits: 999, capped: false });
  });

  test("every plan lands below the target with no refused call, across a grid", () => {
    for (const cost of [1, 2, 3, 5, 7, 12]) {
      for (const credits of [0, 1, 2, 3, 10, 999, 1_000, 1_001]) {
        for (const until of [1, 2, 3, 4, 13, 1_000]) {
          const plan = depletionPlan({ credits, cost, until });
          if (!plan.ok) {
            // Unreachable only when the floor (credits mod cost) is ≥ until.
            expect(credits % cost >= until).toBe(true);
            continue;
          }
          const sim = simulate(credits, cost, plan.calls);
          expect(sim.refused).toBe(0);
          expect(sim.credits).toBe(plan.finalCredits);
          expect(sim.credits < until).toBe(true);
          if (plan.calls > 0) expect(simulate(credits, cost, plan.calls - 1).credits >= until).toBe(true);
        }
      }
    }
  });

  test("an unreachable target says why instead of looping into 402s", () => {
    const plan = depletionPlan({ credits: 5, cost: 3, until: 1 });
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.reason).toContain("floors at 2");
      expect(plan.reason).toContain("--until 3");
    }
  });

  test("--max-calls caps the plan and says so", () => {
    expect(depletionPlan({ credits: 1_000, cost: 3, until: 3, maxCalls: 10 })).toEqual({ ok: true, calls: 10, finalCredits: 970, capped: true });
    expect(depletionPlan({ credits: 1_000, cost: 3, until: 3, maxCalls: 500 })).toEqual({ ok: true, calls: 333, finalCredits: 1, capped: false });
  });

  test("bad inputs are refusals", () => {
    expect(depletionPlan({ credits: -1, cost: 3, until: 3 }).ok).toBe(false);
    expect(depletionPlan({ credits: 10, cost: 0, until: 3 }).ok).toBe(false);
    expect(depletionPlan({ credits: 10, cost: 3, until: 0 }).ok).toBe(false);
    expect(depletionPlan({ credits: 1.5, cost: 3, until: 3 }).ok).toBe(false);
  });

  test("a step must move the balance by exactly the cost", () => {
    expect(depletionStepVerdict({ before: 10, after: 7, cost: 3 })).toEqual({ ok: true, line: "-3 (10 → 7)" });
    expect(depletionStepVerdict({ before: 10, after: 10, cost: 3 }).ok).toBe(false);
    expect(depletionStepVerdict({ before: 10, after: 10, cost: 3 }).line).toContain("did not charge");
    expect(depletionStepVerdict({ before: 10, after: 5, cost: 3 }).ok).toBe(false);
    expect(depletionStepVerdict({ before: 10, after: 12, cost: 3 }).ok).toBe(false);
  });

  test("backoff honours Retry-After, else doubles from 500ms and caps at 30s", () => {
    expect(backoffDelayMs(0, null)).toBe(500);
    expect(backoffDelayMs(1, null)).toBe(1_000);
    expect(backoffDelayMs(5, null)).toBe(16_000);
    expect(backoffDelayMs(6, null)).toBe(30_000);
    expect(backoffDelayMs(99, null)).toBe(30_000);
    expect(backoffDelayMs(0, "7")).toBe(7_000);
    expect(backoffDelayMs(0, "0")).toBe(1_000);
    expect(backoffDelayMs(0, "999999")).toBe(120_000);
    expect(backoffDelayMs(2, "Wed, 21 Oct 2026 07:28:00 GMT")).toBe(2_000);
    expect(MAX_BACKOFF_ATTEMPTS).toBe(6);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(402)).toBe(false);
    expect(isRetryableStatus(500)).toBe(false);
  });

  test("X-Credits-Balance is read as the post-handler project.credits", () => {
    expect(readCreditsBalanceHeader(new Headers({ "X-Credits-Balance": "997" }))).toBe(997);
    expect(readCreditsBalanceHeader(new Headers({ "x-credits-balance": " 0 " }))).toBe(0);
    expect(readCreditsBalanceHeader(new Headers({ "x-credits-balance": "abc" }))).toBeNull();
    expect(readCreditsBalanceHeader(new Headers())).toBeNull();
  });
});

describe("bearer files", () => {
  test("ai.json's shape: api_key required, did/name/project_id carried when present", () => {
    const parsed = parseBearerFile({
      agent_id: "a", api_key: "at_fake_for_tests", did: "did:at:abc", mnemonic: "x", name: "ai", project_id: "p", wallet_id: "w",
    });
    expect(parsed).toEqual({ ok: true, file: { api_key: "at_fake_for_tests", did: "did:at:abc", name: "ai", project_id: "p" } });
    expect(parseBearerFile({ api_key: "k" })).toEqual({ ok: true, file: { api_key: "k", did: null, name: null, project_id: null } });
  });

  test("anything without an api_key is refused", () => {
    expect(parseBearerFile({}).ok).toBe(false);
    expect(parseBearerFile({ api_key: "" }).ok).toBe(false);
    expect(parseBearerFile({ api_key: 42 }).ok).toBe(false);
    expect(parseBearerFile([]).ok).toBe(false);
    expect(parseBearerFile(null).ok).toBe(false);
  });
});

describe("scratch agent", () => {
  const SIGNING_SEED = new Uint8Array(32).fill(7);
  const BOX_SEED = new Uint8Array(32).fill(9);
  const FIXED = {
    name: "w2b-witness",
    timestamp: "2026-08-30T12:00:00.000Z",
    registrationNonce: "00000000-0000-4000-8000-000000000000",
    runtime: { provider: SCRATCH_RUNTIME_PROVIDER, host: "test-host", context: "scratch" },
  };

  test("names are file-safe and `ai` is reserved", () => {
    expect(parseScratchAgentName("w2b-witness")).toEqual({ ok: true, name: "w2b-witness" });
    expect(RESERVED_AGENT_NAMES).toEqual(["ai"]);
    expect(parseScratchAgentName("ai").ok).toBe(false);
    expect(parseScratchAgentName("Ai").ok).toBe(false);
    expect(parseScratchAgentName("../ai").ok).toBe(false);
    expect(parseScratchAgentName("-x").ok).toBe(false);
    expect(parseScratchAgentName("a".repeat(64)).ok).toBe(false);
    expect(parseScratchAgentName("a".repeat(63)).ok).toBe(true);
    expect(parseScratchAgentName(undefined).ok).toBe(false);
  });

  test("keys from fixed seeds are deterministic and canonically encoded", () => {
    const keys = scratchKeysFromSeeds(SIGNING_SEED, BOX_SEED);
    expect(scratchKeysFromSeeds(SIGNING_SEED, BOX_SEED)).toEqual(keys);
    // The server's decodeCanonicalPublicKey wants 43 alphabet chars + '='.
    expect(keys.signingPublicKeyB64).toMatch(/^[A-Za-z0-9+/]{43}=$/u);
    expect(keys.boxPublicKeyB64).toMatch(/^[A-Za-z0-9+/]{43}=$/u);
    expect(keys.signingPublicKeyB64).not.toBe(keys.boxPublicKeyB64);
    expect(() => scratchKeysFromSeeds(new Uint8Array(31), BOX_SEED)).toThrow(/32 bytes/u);
  });

  test("the registration body passes the server's own PoW check and key proof", () => {
    const keys = scratchKeysFromSeeds(SIGNING_SEED, BOX_SEED);
    const { body, powIterations } = buildScratchRegistration({ ...FIXED, keys, difficultyBits: 8 });
    expect(powIterations).toBeGreaterThan(0);
    expect(body).toMatchObject({
      display_name: FIXED.name,
      capabilities: [],
      agent_public_key: keys.signingPublicKeyB64,
      box_public_key: keys.boxPublicKeyB64,
      runtime: { provider: SCRATCH_RUNTIME_PROVIDER, host: "test-host", context: "scratch" },
      key_proof: { timestamp: FIXED.timestamp },
      registration_nonce: FIXED.registrationNonce,
      expression_visibility: "private",
      registrar: { kind: "self_service" },
    });
    // What routes/register-agent.ts step 3 runs.
    expect(checkRegisterAgentPow({
      agentPublicKeyB64: body.agent_public_key as string,
      displayName: body.display_name as string,
      timestamp: FIXED.timestamp,
      powNonce: body.pow_nonce as string,
      difficultyBits: 8,
    })).toBe(true);
    // What step 5 runs — the same canonical bytes, the same verifier.
    const canonical = canonicalRegisterAgentBytes({
      displayName: FIXED.name,
      agentPublicKeyB64: keys.signingPublicKeyB64,
      boxPublicKeyB64: keys.boxPublicKeyB64,
      runtimeProvider: SCRATCH_RUNTIME_PROVIDER,
      runtimeModel: "",
      capabilities: [],
      runtimeHost: "test-host",
      runtimeContext: "scratch",
      expressionVisibility: "private",
      registrarKind: "self_service",
      registrarBearer: "",
      registrationNonce: FIXED.registrationNonce,
      timestamp: FIXED.timestamp,
    });
    const signature = (body.key_proof as { signature: string }).signature;
    expect(verifyRegisterAgentSignature({ canonical, signatureB64: signature, publicKeyB64: keys.signingPublicKeyB64 })).toBe(true);
    // A different display name is a different preimage: the proof does not transfer.
    const other = canonicalRegisterAgentBytes({
      displayName: "someone-else",
      agentPublicKeyB64: keys.signingPublicKeyB64,
      boxPublicKeyB64: keys.boxPublicKeyB64,
      runtimeProvider: SCRATCH_RUNTIME_PROVIDER,
      runtimeModel: "",
      capabilities: [],
      runtimeHost: "test-host",
      runtimeContext: "scratch",
      registrationNonce: FIXED.registrationNonce,
      timestamp: FIXED.timestamp,
    });
    expect(verifyRegisterAgentSignature({ canonical: other, signatureB64: signature, publicKeyB64: keys.signingPublicKeyB64 })).toBe(false);
  });

  test("the PoW is deterministic for fixed inputs and bound to the timestamp", () => {
    const keys = scratchKeysFromSeeds(SIGNING_SEED, BOX_SEED);
    const a = buildScratchRegistration({ ...FIXED, keys, difficultyBits: 8 });
    const b = buildScratchRegistration({ ...FIXED, keys, difficultyBits: 8 });
    expect(a.body.pow_nonce).toBe(b.body.pow_nonce);
    expect(checkRegisterAgentPow({
      agentPublicKeyB64: keys.signingPublicKeyB64,
      displayName: FIXED.name,
      timestamp: "2026-08-30T12:00:01.000Z",
      powNonce: a.body.pow_nonce as string,
      difficultyBits: 8,
      // Probabilistically false at 8 bits (1/256 chance of a lucky collision); at 16 bits negligible.
    }) && checkRegisterAgentPow({
      agentPublicKeyB64: keys.signingPublicKeyB64,
      displayName: FIXED.name,
      timestamp: "2026-08-30T12:00:02.000Z",
      powNonce: a.body.pow_nonce as string,
      difficultyBits: 8,
    })).toBe(false);
    expect(DEFAULT_POW_DIFFICULTY_BITS).toBe(18);
    expect(() => buildScratchRegistration({ ...FIXED, keys, difficultyBits: 40, maxIterations: 10 })).toThrow(/no nonce within 10/u);
  });

  test("the 201 body is read for did, project, api_key, credits, wallet", () => {
    const parsed = readRegistrationResponse({
      agent: { id: "aid", did: "did:at:xyz" },
      project: { id: "pid", name: "w2b-witness", plan: "free", credits: 1_000, api_key: "at_fake" },
      wallet: { id: "wid", currency: "GBP", balance: 1_000 },
    });
    expect(parsed).toEqual({ ok: true, outcome: { agentId: "aid", did: "did:at:xyz", projectId: "pid", apiKey: "at_fake", credits: 1_000, walletId: "wid" } });
    expect(readRegistrationResponse({ agent: { id: "aid", did: "d" }, project: { id: "pid", api_key: "k" }, wallet: null }))
      .toMatchObject({ ok: true, outcome: { credits: null, walletId: null } });
    expect(readRegistrationResponse({ agent: { id: "aid" }, project: { id: "pid", api_key: "k" } }).ok).toBe(false);
    expect(readRegistrationResponse({ agent: { id: "aid", did: "d" }, project: { id: "pid", api_key: "" } }).ok).toBe(false);
    expect(readRegistrationResponse(null).ok).toBe(false);
  });

  test("the creds file carries ai.json's seven keys, mnemonic null said out loud, and the raw halves", () => {
    const keys = scratchKeysFromSeeds(SIGNING_SEED, BOX_SEED);
    const record = scratchCredsRecord({
      name: "w2b-witness",
      outcome: { agentId: "aid", did: "did:at:xyz", projectId: "pid", apiKey: "at_fake", credits: 1_000, walletId: "wid" },
      keys,
      base: DEFAULT_API_BASE,
      createdIso: FIXED.timestamp,
    });
    for (const key of ["agent_id", "api_key", "did", "mnemonic", "name", "project_id", "wallet_id"]) {
      expect(Object.hasOwn(record, key)).toBe(true);
    }
    expect(record.mnemonic).toBeNull();
    expect(record.api_key).toBe("at_fake");
    expect(record.keys.signing_private_key).toBe(keys.signingPrivateKeyB64);
    expect(record.keys.box_private_key).toBe(keys.boxPrivateKeyB64);
    expect(record.key_origin).toContain("no SOMA mnemonic");
    expect(parseBearerFile(record)).toEqual({ ok: true, file: { api_key: "at_fake", did: "did:at:xyz", name: "w2b-witness", project_id: "pid" } });
  });
});

describe("CLI args — Phase B flags", () => {
  test("pay takes METHOD and path as positionals with --json and --bearer-file", () => {
    const args = parseProofArgs(["pay", "POST", MEMORY_SEARCH_PATH, "--json", '{"query":"witness"}', "--bearer-file", "~/.agenttool-agents/w2b.json", "--cap=3"]);
    expect(args.error).toBeNull();
    expect(args.command).toBe("pay");
    expect(args.positional).toEqual(["POST", MEMORY_SEARCH_PATH]);
    expect(args.json).toBe('{"query":"witness"}');
    expect(args.bearerFile).toBe("~/.agenttool-agents/w2b.json");
    expect(args.capCredits).toBe(3);
  });

  test("deplete flags: --route, --until, --max-calls; scratch-agent: --name", () => {
    const args = parseProofArgs(["deplete", "--bearer-file=x.json", "--route", "POST /v1/memories/search", "--until", "3", "--max-calls=400"]);
    expect(args.error).toBeNull();
    expect(args.route).toBe("POST /v1/memories/search");
    expect(args.until).toBe(3);
    expect(args.maxCalls).toBe(400);
    expect(args.bearerFile).toBe("x.json");
    const init = parseProofArgs(["scratch-agent", "init", "--name", "w2b-witness"]);
    expect(init.positional).toEqual(["init"]);
    expect(init.name).toBe("w2b-witness");
  });

  test("bad Phase B flags are errors, not guesses", () => {
    expect(parseProofArgs(["deplete", "--until", "0"]).error).toContain("--until");
    expect(parseProofArgs(["deplete", "--until", "abc"]).error).toContain("--until");
    expect(parseProofArgs(["deplete", "--until"]).error).toContain("--until");
    expect(parseProofArgs(["deplete", "--max-calls", "-5"]).error).toContain("--max-calls");
    expect(parseProofArgs(["deplete", "--route"]).error).toContain("--route");
    expect(parseProofArgs(["pay", "--bearer-file"]).error).toContain("--bearer-file");
    expect(parseProofArgs(["pay", "--json"]).error).toContain("--json");
    expect(parseProofArgs(["scratch-agent", "init", "--name"]).error).toContain("--name");
  });
});
