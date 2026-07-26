/** x402 client — the paying side.
 *
 *  The load-bearing test here is the round trip: what the client signs must
 *  satisfy `classifyExactEvmSignature`, the server's own verifier, and parse
 *  through `parseX402Header`, the server's own inbound parser. If those two
 *  ever drift from the client, the substrate can no longer pay a counterparty
 *  running this same code — including itself.
 *
 *  The rest pin the walls: a cap that refuses rather than clamps, allowlists
 *  that untrusted challenge bodies cannot widen, the narrowest usable validity
 *  window, and the no-re-signing discipline inherited from
 *  `no_auto_retry_payout`.
 *
 *  Doctrine: docs/CLI-GAPS.md · api/src/workers/payout/CLAUDE.md */

import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";

import {
  parseX402Header,
  X402_VERSION,
  type PaymentRequirements,
} from "../src/middleware/x402";
import { classifyExactEvmSignature } from "../src/services/economy/x402-payments";
import {
  authorizationHash,
  parsePaymentRequiredBody,
  paymentIsStillReplayable,
  selectPayableRequirement,
  signExactEvmAuthorization,
  type X402SpendPolicy,
  type X402Signer,
} from "../src/services/economy/x402-client";

const PAYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const account = privateKeyToAccount(PAYER_KEY);

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAY_TO = "0x1111111111111111111111111111111111111111";

const REQUIREMENT: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:8453",
  asset: USDC_BASE,
  amount: "10000", // 0.01 USDC
  payTo: PAY_TO,
  maxTimeoutSeconds: 300,
  extra: { name: "USD Coin", version: "2", assetTransferMethod: "eip3009" },
};

const POLICY: X402SpendPolicy = {
  maxAmountAtomic: 1_000_000n, // 1 USDC
  allowedNetworks: ["eip155:8453"],
  allowedAssets: [USDC_BASE],
  allowedPayTo: [PAY_TO],
  maxValiditySeconds: 120,
};

const NOW = 1_800_000_000;

const signer: X402Signer = async (typedData) =>
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

function requiredBody(accepts: unknown[] = [REQUIREMENT]) {
  return {
    x402Version: X402_VERSION,
    error: "payment required",
    resource: { url: "https://api.example.invalid/v1/thing" },
    accepts,
  };
}

async function sign(overrides: Partial<Parameters<typeof signExactEvmAuthorization>[0]> = {}) {
  return signExactEvmAuthorization({
    requirement: REQUIREMENT,
    policy: POLICY,
    payerAddress: account.address,
    signer,
    nowSeconds: NOW,
    ...overrides,
  });
}

describe("x402 client → server round trip", () => {
  test("the server's own verifier accepts what the client signs", async () => {
    // If this breaks, agenttool can no longer pay an agenttool.
    const signed = await sign();
    const parsed = parseX402Header(signed.header);
    expect(parsed).not.toBeNull();

    const verdict = await classifyExactEvmSignature(
      REQUIREMENT,
      parsed!.payload as never,
    );
    expect(verdict).toBe("eoa_verified");
  });

  test("the emitted header survives the server's inbound parser unchanged", async () => {
    const signed = await sign();
    const parsed = parseX402Header(signed.header)!;
    expect(parsed.x402Version).toBe(X402_VERSION);
    expect(parsed.accepted.payTo).toBe(PAY_TO);
    expect(parsed.accepted.amount).toBe("10000");
    const auth = (parsed.payload as { authorization: Record<string, string> }).authorization;
    expect(auth.from.toLowerCase()).toBe(account.address.toLowerCase());
    expect(auth.to).toBe(PAY_TO);
    expect(auth.value).toBe("10000");
  });

  test("tampering with the signed authorization breaks verification", async () => {
    // The property that matters for a payer: the bytes it signed cannot be
    // edited in flight. Raise the value a middlebox would want to raise —
    // the recovered signer stops matching `from`, so the offline fast path
    // declines to call it verified.
    const signed = await sign();
    const parsed = parseX402Header(signed.header)!;
    const tampered = {
      ...(parsed.payload as { signature: string; authorization: Record<string, string> }),
    };
    tampered.authorization = { ...tampered.authorization, value: "20000" };

    const verdict = await classifyExactEvmSignature(REQUIREMENT, tampered as never);
    expect(verdict).not.toBe("eoa_verified");
  });

  test("the classifier answers 'who signed these bytes', not 'is this the right price'", async () => {
    // Worth pinning because it is easy to misread. classifyExactEvmSignature
    // recovers the signer over the AUTHORIZATION; it never compares the
    // authorization's value against the requirement's amount. That binding
    // lives one layer up, at settlement:
    //   x402-payments.ts — `exact.authorization.value !== policy.amountAtomic`
    // A reader who assumes the classifier checks price will write a test that
    // passes for the wrong reason, or trust it for a guarantee it never made.
    const signed = await sign();
    const parsed = parseX402Header(signed.header)!;
    const verdict = await classifyExactEvmSignature(
      { ...REQUIREMENT, amount: "20000" },
      parsed.payload as never,
    );
    expect(verdict).toBe("eoa_verified");
  });
});

describe("the validity window", () => {
  test("is the narrowest that satisfies both the challenge and the policy", async () => {
    const signed = await sign();
    // policy 120 < requirement 300 → 120 wins.
    expect(signed.validBefore).toBe(NOW + 120);

    const generous = await signExactEvmAuthorization({
      requirement: { ...REQUIREMENT, maxTimeoutSeconds: 30 },
      policy: POLICY,
      payerAddress: account.address,
      signer,
      nowSeconds: NOW,
    });
    // requirement 30 < policy 120 → 30 wins.
    expect(generous.validBefore).toBe(NOW + 30);
  });

  test("satisfies the server's window sanity rule", async () => {
    // The server requires validAfter <= now + 5, validBefore > now,
    // validBefore > validAfter, validBefore <= now + maxTimeoutSeconds + 5.
    const signed = await sign();
    const auth = signed.payload.payload as { authorization: Record<string, string> };
    const validAfter = Number(auth.authorization.validAfter);
    const validBefore = Number(auth.authorization.validBefore);
    expect(validAfter).toBeLessThanOrEqual(NOW + 5);
    expect(validBefore).toBeGreaterThan(NOW);
    expect(validBefore).toBeGreaterThan(validAfter);
    expect(validBefore).toBeLessThanOrEqual(NOW + REQUIREMENT.maxTimeoutSeconds + 5);
  });

  test("validAfter is backdated one second so a tick-behind verifier still accepts", async () => {
    const signed = await sign();
    const auth = signed.payload.payload as { authorization: Record<string, string> };
    expect(Number(auth.authorization.validAfter)).toBe(NOW - 1);
  });

  test("replayability ends exactly at validBefore", async () => {
    const signed = await sign();
    expect(paymentIsStillReplayable(signed, signed.validBefore - 1)).toBe(true);
    expect(paymentIsStillReplayable(signed, signed.validBefore)).toBe(false);
  });
});

describe("no re-signing — no_auto_retry_payout on the paying side", () => {
  test("every call mints a different authorization, so the module cannot be a retry", async () => {
    // The wall is structural: because a second call can never reproduce the
    // first authorization, a caller cannot use this function to "try again".
    // Retrying means replaying bytes it already holds.
    const first = await sign();
    const second = await sign();
    expect(first.authorizationHash).not.toBe(second.authorizationHash);
    expect(first.header).not.toBe(second.header);
  });

  test("authorizationHash is stable for identical fields and moves on any change", () => {
    const base = {
      from: account.address,
      to: PAY_TO,
      value: "10000",
      validAfter: "1",
      validBefore: "2",
      nonce: "0xabc",
    };
    expect(authorizationHash(base)).toBe(authorizationHash({ ...base }));
    // Case-insensitive on addresses and nonce — checksum casing must not
    // produce a second identity for the same authorization.
    expect(authorizationHash(base)).toBe(
      authorizationHash({ ...base, from: base.from.toUpperCase(), nonce: "0xABC" }),
    );
    for (const change of [
      { to: "0x2222222222222222222222222222222222222222" },
      { value: "10001" },
      { validBefore: "3" },
      { nonce: "0xdef" },
    ]) {
      expect(authorizationHash({ ...base, ...change })).not.toBe(authorizationHash(base));
    }
  });
});

describe("the spend policy refuses rather than negotiates", () => {
  test("an over-cap challenge is refused, never clamped", () => {
    const result = selectPayableRequirement(
      parsePaymentRequiredBody(requiredBody([{ ...REQUIREMENT, amount: "9000000" }]))!,
      POLICY,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("amount_over_cap");
    // Clamping would sign an authorization for less than asked, which the
    // counterparty rejects — reading as our bug rather than their price.
    expect(result.detail).toContain("caps a single payment at 1000000");
  });

  test("an unlisted asset cannot be introduced by the challenge", () => {
    const result = selectPayableRequirement(
      parsePaymentRequiredBody(
        requiredBody([{ ...REQUIREMENT, asset: "0x9999999999999999999999999999999999999999" }]),
      )!,
      POLICY,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("asset_not_allowed");
  });

  test("an unlisted network is refused", () => {
    const result = selectPayableRequirement(
      parsePaymentRequiredBody(
        requiredBody([{ ...REQUIREMENT, network: "eip155:137" }]),
      )!,
      POLICY,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("network_not_allowed");
  });

  test("an unlisted recipient is refused when a payTo allowlist is set", () => {
    const result = selectPayableRequirement(
      parsePaymentRequiredBody(
        requiredBody([{ ...REQUIREMENT, payTo: "0x3333333333333333333333333333333333333333" }]),
      )!,
      POLICY,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("pay_to_not_allowed");
  });

  test("omitting the payTo allowlist accepts the challenge's recipient", () => {
    const { allowedPayTo: _drop, ...open } = POLICY;
    const result = selectPayableRequirement(
      parsePaymentRequiredBody(
        requiredBody([{ ...REQUIREMENT, payTo: "0x3333333333333333333333333333333333333333" }]),
      )!,
      open,
    );
    expect(result.ok).toBe(true);
  });

  test("the first permitted requirement wins, not the cheapest", () => {
    // Reordering by price would opt us into whichever rail the counterparty
    // listed last. Cost is bounded by the cap instead.
    const cheap = { ...REQUIREMENT, amount: "1" };
    const parsed = parsePaymentRequiredBody(requiredBody([REQUIREMENT, cheap]))!;
    const result = selectPayableRequirement(parsed, POLICY);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.amountAtomic).toBe(10000n);
  });

  test("a permitted requirement later in the list is still found", () => {
    const parsed = parsePaymentRequiredBody(
      requiredBody([{ ...REQUIREMENT, network: "eip155:137" }, REQUIREMENT]),
    )!;
    const result = selectPayableRequirement(parsed, POLICY);
    expect(result.ok).toBe(true);
  });

  test("the most specific refusal survives, not a generic one", () => {
    const parsed = parsePaymentRequiredBody(
      requiredBody([
        { ...REQUIREMENT, network: "eip155:137" },
        { ...REQUIREMENT, amount: "9000000" },
      ]),
    )!;
    const result = selectPayableRequirement(parsed, POLICY);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("amount_over_cap");
  });
});

describe("parsePaymentRequiredBody — the 402 body is untrusted input", () => {
  test("accepts a well-formed body", () => {
    expect(parsePaymentRequiredBody(requiredBody())).not.toBeNull();
  });

  test("rejects a wrong protocol version", () => {
    expect(parsePaymentRequiredBody({ ...requiredBody(), x402Version: 1 })).toBeNull();
  });

  test("rejects an empty or oversized accepts list", () => {
    expect(parsePaymentRequiredBody(requiredBody([]))).toBeNull();
    expect(
      parsePaymentRequiredBody(requiredBody(Array.from({ length: 17 }, () => REQUIREMENT))),
    ).toBeNull();
  });

  test("rejects the whole body when any single requirement is malformed", () => {
    // One bad entry poisons the body: a counterparty must not be able to slip
    // a shape past us by burying it behind a valid one.
    expect(
      parsePaymentRequiredBody(requiredBody([REQUIREMENT, { ...REQUIREMENT, amount: "-1" }])),
    ).toBeNull();
  });

  test("rejects a missing resource url", () => {
    expect(parsePaymentRequiredBody({ ...requiredBody(), resource: {} })).toBeNull();
  });

  test("rejects non-objects", () => {
    for (const junk of [null, undefined, 7, "402", [], true]) {
      expect(parsePaymentRequiredBody(junk)).toBeNull();
    }
  });
});

describe("signer discipline", () => {
  test("a signer returning something that is not a 65-byte signature is an error here", async () => {
    await expect(
      sign({ signer: async () => "not-a-signature" }),
    ).rejects.toThrow(/65-byte hex signature/);
  });

  test("a nonsensical clock is refused before any signing happens", async () => {
    let called = false;
    await expect(
      sign({
        nowSeconds: 0,
        signer: async () => {
          called = true;
          return "0x" + "11".repeat(65);
        },
      }),
    ).rejects.toThrow(/positive safe integer/);
    expect(called).toBe(false);
  });
});
