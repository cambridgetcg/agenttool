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
 *  No test here touches `security`, `~/.config/kingdom`, or fetch. */

import { describe, expect, test } from "bun:test";

import {
  buildPaymentRequired,
  buildPaymentRequirements,
  encodeCanonicalBase64Json,
  X402_VERSION,
} from "../src/middleware/x402";
import { parseX402Header } from "../src/middleware/x402";
import { signExactEvmAuthorization } from "../src/services/economy/x402-client";
import { authorizationIdentityHash } from "../src/services/economy/x402-payments";
import {
  ATOMIC_PER_CREDIT,
  atomicForCredits,
  balanceOfRpcRequest,
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
