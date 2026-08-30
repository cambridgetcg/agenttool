/** The opt-in paying transport + `at.x402` — Wave 2 Phase C (W2-7).
 *
 *  Every request is a fetch mock; no network, no keychain, no real key. The
 *  payer is the fixture's Anvil #1 key and the challenge is the exact
 *  PaymentRequired the server produced (`fixtures/x402-eip3009-vector.json`).
 *
 *  What is pinned here is the doctrine, not the crypto (x402.test.ts pins
 *  the bytes):
 *    - no `x402` option → the SDK never signs; a 402 surfaces untouched
 *    - option present → exactly two fetches: bare → 402 → ONE signed retry
 *    - the retry is the same request (method, URL, body, bearer,
 *      Idempotency-Key) plus PAYMENT-SIGNATURE
 *    - a second 402 is a typed error, never a loop
 *    - a policy refusal is a typed error with the refusal code, nothing signed
 *    - the env fallback is read only when the option is present
 *    - a policy without maxAmountAtomic / allowedPayTo is refused at
 *      construction */

import { afterEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AGENTTOOL_TREASURY,
  AgentTool,
  AgentToolError,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  X402_ATOMIC_PER_CREDIT,
  X402_BASE_NETWORK,
  X402_BASE_USDC,
  X402Client,
  authorizationHash,
  decodeCanonicalBase64,
  localEvmSigner,
  recoverTypedDataAddress,
  type AgentToolTransport,
  type X402PaymentEvent,
  type X402PaymentPayload,
  type X402PaymentRequired,
  type X402PaymentRequirement,
  type X402Signer,
  type X402SpendPolicy,
} from "../src/index.js";
import {
  X402_PRIVATE_KEY_ENV,
  paymentIdFromStatusLink,
  resolveX402Options,
  x402PayingTransport,
} from "../src/_x402-transport.js";

// ─── Fixture ──────────────────────────────────────────────────────────────

interface Vector {
  payer: { private_key: string; address: string };
  requirement: X402PaymentRequirement;
  payment_required: X402PaymentRequired;
  payment_required_header: string;
  authorization_identity_hash: string;
  now_seconds: number;
}

const vector = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "x402-eip3009-vector.json"), "utf-8"),
) as Vector;

const LEDGER_ID = vector.authorization_identity_hash;
const STATUS_LINK = `</v1/x402/payments/${LEDGER_ID}>; rel="payment-status"`;
const RECEIPT = "eyJzdWNjZXNzIjp0cnVlLCJ0cmFuc2FjdGlvbiI6IjB4MzMiLCJuZXR3b3JrIjoiZWlwMTU1Ojg0NTMifQ==";

function policy(overrides: Partial<X402SpendPolicy> = {}): X402SpendPolicy {
  return {
    maxAmountAtomic: 10n * X402_ATOMIC_PER_CREDIT,
    allowedPayTo: [AGENTTOOL_TREASURY],
    allowedNetworks: [X402_BASE_NETWORK],
    allowedAssets: [X402_BASE_USDC],
    maxValiditySeconds: 60,
    ...overrides,
  };
}

/** The 402 exactly as the API emits it: guidance body with the envelope
 *  spread over it, plus the pure envelope in PAYMENT-REQUIRED. */
function challengeBody(): Record<string, unknown> {
  return {
    error: "top_up_payment_required",
    message: "Pay 1000 atomic USDC (1 credit) to add 1 credit to this project.",
    hint: "Sign accepts[0] and retry with PAYMENT-SIGNATURE.",
    next_actions: [{ action: "pay", method: "POST", path: "/v1/x402/top-up/1" }],
    ...vector.payment_required,
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function challenge402(headers: Record<string, string> = {}): Response {
  return json(402, challengeBody(), {
    "PAYMENT-REQUIRED": vector.payment_required_header,
    "X-Credits-Balance": "0",
    ...headers,
  });
}

function settled200(): Response {
  return json(
    200,
    {
      credits_added: 1,
      credits_total: 11,
      authorization_hash: LEDGER_ID,
      amount_atomic: "1000",
      unit: "1 credit = 1,000 USDC atomic units (USD 0.001)",
      finality: "Top-ups are final.",
      payment_status: `/v1/x402/payments/${LEDGER_ID}`,
    },
    { "PAYMENT-RESPONSE": RECEIPT, Link: STATUS_LINK, "X-Credits-Balance": "11" },
  );
}

// ─── Fetch mock: a sequence of responses, one per call ────────────────────

const originalFetch = globalThis.fetch;
interface Recorded {
  url: string;
  init: RequestInit;
  headers: Headers;
}
let calls: Recorded[] = [];

function mockSequence(responses: Array<() => Response | Promise<Response>>): void {
  calls = [];
  let index = 0;
  const fetchMock = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const record: Recorded = { url, init: init ?? {}, headers: new Headers(init?.headers) };
    calls.push(record);
    const next = responses[index];
    index += 1;
    if (!next) throw new Error(`fetch mock: unexpected call #${index} to ${url}`);
    return Promise.resolve(next());
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env[X402_PRIVATE_KEY_ENV];
});

function payingClient(extra: Partial<ConstructorParameters<typeof AgentTool>[0] & object> = {}): {
  at: AgentTool;
  events: X402PaymentEvent[];
  signer: X402Signer;
} {
  const events: X402PaymentEvent[] = [];
  const signer = localEvmSigner(vector.payer.private_key);
  const at = new AgentTool({
    apiKey: "test-key-123",
    x402: {
      signer,
      policy: policy(),
      onPayment: (event) => {
        events.push(event);
      },
      nowSeconds: () => vector.now_seconds,
    },
    ...extra,
  });
  return { at, events, signer };
}

function decodeSignature(header: string | null): X402PaymentPayload {
  expect(header).not.toBeNull();
  const bytes = decodeCanonicalBase64(header!);
  expect(bytes).not.toBeNull();
  return JSON.parse(new TextDecoder().decode(bytes!)) as X402PaymentPayload;
}

async function caught(run: () => Promise<unknown>): Promise<AgentToolError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(AgentToolError);
    return error as AgentToolError;
  }
  throw new Error("expected the call to throw");
}

// ─── The two-fetch contract ───────────────────────────────────────────────

describe("x402 paying transport — exactly two fetches", () => {
  test("402 + PAYMENT-REQUIRED → one signed retry carrying the same request", async () => {
    mockSequence([challenge402, settled200]);
    const { at, events, signer } = payingClient();

    const result = await at.x402.topUp(1);

    expect(calls.length).toBe(2);
    const [bare, retry] = calls;

    // Same request: method, URL, bearer, Idempotency-Key, body.
    expect(bare!.url).toBe("https://api.agenttool.dev/v1/x402/top-up/1");
    expect(retry!.url).toBe(bare!.url);
    expect(retry!.init.method).toBe("POST");
    expect(retry!.headers.get("authorization")).toBe("Bearer test-key-123");
    expect(retry!.headers.get("authorization")).toBe(bare!.headers.get("authorization"));
    expect(bare!.headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/u);
    expect(retry!.headers.get("idempotency-key")).toBe(bare!.headers.get("idempotency-key"));
    expect(retry!.headers.get("x-agenttool-client")).toBe(bare!.headers.get("x-agenttool-client"));
    expect(retry!.init.body).toBe(bare!.init.body);

    // The bare call carried no signature; the retry carries exactly one.
    expect(bare!.headers.get("payment-signature")).toBeNull();
    const payload = decodeSignature(retry!.headers.get("payment-signature"));
    expect(payload.x402Version).toBe(2);
    expect(payload.resource).toEqual(vector.payment_required.resource);
    expect(payload.accepted).toEqual(vector.payment_required.accepts[0]!);
    const inner = payload.payload as { signature: string; authorization: Record<string, string> };
    expect(inner.authorization.from).toBe(signer.address);
    expect(inner.authorization.from).toBe(vector.payer.address);
    expect(inner.authorization.to).toBe(AGENTTOOL_TREASURY);
    expect(inner.authorization.value).toBe("1000");
    expect(inner.authorization.validAfter).toBe(String(vector.now_seconds - 1));
    expect(inner.authorization.validBefore).toBe(String(vector.now_seconds + 60));
    expect(inner.authorization.nonce).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(Object.keys(payload)).toEqual(["x402Version", "resource", "accepted", "payload"]);

    // The signature recovers to the payer — what the verifier checks offline.
    expect(
      recoverTypedDataAddress(
        {
          domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: X402_BASE_USDC },
          types: TRANSFER_WITH_AUTHORIZATION_TYPES,
          primaryType: "TransferWithAuthorization",
          message: {
            from: inner.authorization.from!,
            to: inner.authorization.to!,
            value: BigInt(inner.authorization.value!),
            validAfter: BigInt(inner.authorization.validAfter!),
            validBefore: BigInt(inner.authorization.validBefore!),
            nonce: inner.authorization.nonce!,
          },
        },
        inner.signature,
      ),
    ).toBe(vector.payer.address);

    // onPayment: the identity of what was emitted, plus the retry's receipt.
    expect(events.length).toBe(1);
    const event = events[0]!;
    expect(event.authorizationHash).toBe(
      authorizationHash(inner.authorization as unknown as Parameters<typeof authorizationHash>[0]),
    );
    expect(event.validBefore).toBe(vector.now_seconds + 60);
    expect(event.status).toBe(200);
    expect(event.paymentResponse).toBe(RECEIPT);
    expect(event.paymentStatusLink).toBe(STATUS_LINK);
    expect(event.paymentId).toBe(LEDGER_ID);
    expect(event.creditsBalance).toBe("11");

    // The namespace result.
    expect(result.creditsAdded).toBe(1);
    expect(result.creditsTotal).toBe(11);
    expect(result.authorizationHash).toBe(LEDGER_ID);
    expect(result.amountAtomic).toBe("1000");
    expect(result.paymentStatus).toBe(`/v1/x402/payments/${LEDGER_ID}`);
    expect(result.paymentResponse).toBe(RECEIPT);
    expect(result.paymentStatusLink).toBe(STATUS_LINK);
    expect(result.creditsBalance).toBe("11");
  });

  test("a second 402 is a typed error, never a third fetch", async () => {
    mockSequence([
      challenge402,
      () =>
        json(
          402,
          { error: "payment_verification_failed", message: "The facilitator refused the authorization." },
          { "PAYMENT-RESPONSE": RECEIPT, Link: STATUS_LINK, "Retry-After": "5" },
        ),
      () => {
        throw new Error("a third fetch is a loop");
      },
    ]);
    const { at, events } = payingClient();

    const err = await caught(() => at.x402.topUp(1));
    expect(calls.length).toBe(2);
    expect(err.code).toBe("x402_payment_not_accepted");
    expect(err.status).toBe(402);
    expect(err.paymentResponse).toBe(RECEIPT);
    expect(err.paymentStatusLink).toBe(STATUS_LINK);
    expect(err.retryAfter).toBe("5");
    const details = err.details as { authorizationHash: string; validBefore: number; paymentId?: string; serverError?: string };
    expect(details.authorizationHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(details.validBefore).toBe(vector.now_seconds + 60);
    expect(details.paymentId).toBe(LEDGER_ID);
    expect(details.serverError).toBe("payment_verification_failed");
    expect(err.hint).toContain("never mint a new authorization");
    // onPayment still fired for the one signed retry, with its status.
    expect(events.length).toBe(1);
    expect(events[0]!.status).toBe(402);
    expect(events[0]!.authorizationHash).toBe(details.authorizationHash);
  });

  test("the paid response of a Tools call flows back through the normal parser", async () => {
    mockSequence([
      () => json(402, { error: "insufficient_credits", ...vector.payment_required, resource: { url: "https://api.agenttool.dev/v1/scrape" } }),
      () =>
        json(
          200,
          { url: "https://example.com", title: "Paid", content: "body", extracted: null, links: [], fetched_at: "t", duration_ms: 1 },
          { "PAYMENT-RESPONSE": RECEIPT, "X-Credits-Balance": "9" },
        ),
    ]);
    const { at, events } = payingClient();

    const result = await at.tools.scrape("https://example.com");
    expect(calls.length).toBe(2);
    expect(calls[1]!.headers.get("payment-signature")).not.toBeNull();
    expect(calls[1]!.init.body).toBe(calls[0]!.init.body);
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ url: "https://example.com" });
    expect(result.title).toBe("Paid");
    expect(result.paymentResponse).toBe(RECEIPT);
    expect(result.creditsBalance).toBe("9");
    expect(events.length).toBe(1);
    expect(events[0]!.paymentId).toBeUndefined();
  });

  test("a 2xx is never signed for: one fetch, the signer untouched", async () => {
    mockSequence([settled200]);
    let signCalls = 0;
    const base = localEvmSigner(vector.payer.private_key);
    const signer: X402Signer = {
      address: base.address,
      signTypedData: (typed) => {
        signCalls += 1;
        return base.signTypedData(typed);
      },
    };
    const at = new AgentTool({ apiKey: "k", x402: { signer, policy: policy() } });
    await at.x402.topUp(1);
    expect(calls.length).toBe(1);
    expect(signCalls).toBe(0);
  });

  test("a custom signer is called exactly once per challenge", async () => {
    mockSequence([challenge402, settled200]);
    let signCalls = 0;
    const base = localEvmSigner(vector.payer.private_key);
    const signer: X402Signer = {
      address: base.address,
      signTypedData: (typed) => {
        signCalls += 1;
        return base.signTypedData(typed);
      },
    };
    const at = new AgentTool({ apiKey: "k", x402: { signer, policy: policy() } });
    await at.x402.topUp(1);
    expect(calls.length).toBe(2);
    expect(signCalls).toBe(1);
  });
});

// ─── Walls ────────────────────────────────────────────────────────────────

describe("x402 paying transport — walls", () => {
  test("no x402 option → the 402 surfaces untouched after one fetch", async () => {
    mockSequence([challenge402]);
    const at = new AgentTool({ apiKey: "test-key-123" });

    const err = await caught(() => at.x402.topUp(1));
    expect(calls.length).toBe(1);
    expect(calls[0]!.headers.get("payment-signature")).toBeNull();
    expect(err.status).toBe(402);
    expect(err.code).toBe("top_up_payment_required");
    expect(err.x402Version).toBe(2);
    expect(err.accepts).toEqual(vector.payment_required.accepts);
    expect(err.resource).toEqual(vector.payment_required.resource);
    expect(err.paymentRequired).toBe(vector.payment_required_header);
    expect(err.creditsBalance).toBe("0");
  });

  test("AT_X402_PRIVATE_KEY alone (no option) never pays", async () => {
    process.env[X402_PRIVATE_KEY_ENV] = vector.payer.private_key;
    mockSequence([challenge402]);
    const at = new AgentTool({ apiKey: "test-key-123" });

    const err = await caught(() => at.x402.topUp(1));
    expect(calls.length).toBe(1);
    expect(err.status).toBe(402);
    expect(err.code).toBe("top_up_payment_required");
  });

  test("policy refusal (amount_over_cap) → typed error, nothing signed, one fetch", async () => {
    mockSequence([challenge402]);
    const { at, events } = payingClient({
      x402: {
        signer: localEvmSigner(vector.payer.private_key),
        policy: policy({ maxAmountAtomic: 999n }),
        onPayment: () => {
          throw new Error("must not be called");
        },
      },
    });

    const err = await caught(() => at.x402.topUp(1));
    expect(calls.length).toBe(1);
    expect(calls[0]!.headers.get("payment-signature")).toBeNull();
    expect(err.code).toBe("amount_over_cap");
    expect(err.status).toBe(402);
    expect(err.message).toContain("caps a single payment at 999");
    // The challenge travels with the refusal so the caller can decide.
    expect(err.accepts).toEqual(vector.payment_required.accepts);
    expect(err.paymentRequired).toBe(vector.payment_required_header);
    const details = err.details as { refusal: { reason: string }; serverError?: string };
    expect(details.refusal.reason).toBe("amount_over_cap");
    expect(details.serverError).toBe("top_up_payment_required");
    expect(events.length).toBe(0);
  });

  test("policy refusal (pay_to_not_allowed) — a 402 cannot choose the recipient", async () => {
    mockSequence([challenge402]);
    const { at } = payingClient({
      x402: {
        signer: localEvmSigner(vector.payer.private_key),
        policy: policy({ allowedPayTo: ["0x0000000000000000000000000000000000000001"] }),
      },
    });
    const err = await caught(() => at.x402.topUp(1));
    expect(calls.length).toBe(1);
    expect(err.code).toBe("pay_to_not_allowed");
  });

  test("a caller-supplied PAYMENT-SIGNATURE is never signed over", async () => {
    mockSequence([challenge402]);
    const { at, events } = payingClient();

    const err = await caught(() =>
      at.tools.scrape("https://example.com", { paymentSignature: "eyJ4NDAyVmVyc2lvbiI6Mn0=" }),
    );
    expect(calls.length).toBe(1);
    expect(calls[0]!.headers.get("payment-signature")).toBe("eyJ4NDAyVmVyc2lvbiI6Mn0=");
    expect(err.status).toBe(402);
    expect(events.length).toBe(0);
  });

  test("a 402 without a challenge (fail-closed admission) surfaces untouched", async () => {
    mockSequence([
      () => json(402, { error: "insufficient_credits", message: "Payment admission is temporarily unavailable." }, { "Retry-After": "600" }),
    ]);
    const { at, events } = payingClient();

    const err = await caught(() => at.tools.scrape("https://example.com"));
    expect(calls.length).toBe(1);
    expect(err.status).toBe(402);
    expect(err.retryAfter).toBe("600");
    expect(err.paymentRequired).toBeUndefined();
    expect(events.length).toBe(0);
  });

  test("a replay-suppressed 402 (PAYMENT-RESPONSE, no challenge) surfaces untouched", async () => {
    mockSequence([
      () => json(402, { error: "top_up_payment_required", message: "already settled" }, { "PAYMENT-RESPONSE": RECEIPT, Link: STATUS_LINK }),
    ]);
    const { at, events } = payingClient();

    const err = await caught(() => at.x402.topUp(1));
    expect(calls.length).toBe(1);
    expect(err.status).toBe(402);
    expect(err.paymentResponse).toBe(RECEIPT);
    expect(err.paymentStatusLink).toBe(STATUS_LINK);
    expect(events.length).toBe(0);
  });

  test("a malformed challenge is not paid: the header must parse strictly", async () => {
    const tampered = { ...challengeBody(), accepts: [{ ...vector.requirement, scheme: "upto" }] };
    mockSequence([() => json(402, tampered, { "PAYMENT-REQUIRED": "not-base64!" })]);
    const { at, events } = payingClient();

    const err = await caught(() => at.x402.topUp(1));
    expect(calls.length).toBe(1);
    expect(err.status).toBe(402);
    expect(events.length).toBe(0);
  });

  test("the challenge is read from the header first, then the body", async () => {
    // Header only: body is guidance without the envelope.
    mockSequence([
      () => json(402, { error: "top_up_payment_required", message: "pay" }, { "PAYMENT-REQUIRED": vector.payment_required_header }),
      settled200,
    ]);
    const { at } = payingClient();
    await at.x402.topUp(1);
    expect(calls.length).toBe(2);

    // Body only: no header at all.
    mockSequence([() => json(402, challengeBody()), settled200]);
    const { at: at2 } = payingClient();
    await at2.x402.topUp(1);
    expect(calls.length).toBe(2);
  });

  test("the retry goes through the caller's own transport (no bearer added)", async () => {
    let requests = 0;
    const seen: Array<{ url: string; headers: Headers }> = [];
    const transport: AgentToolTransport = {
      async request(input, init) {
        requests += 1;
        seen.push({ url: String(input), headers: new Headers(init?.headers) });
        return requests === 1 ? challenge402() : settled200();
      },
    };
    const at = new AgentTool({
      transport,
      x402: { signer: localEvmSigner(vector.payer.private_key), policy: policy() },
    });

    const result = await at.x402.topUp(2);
    expect(requests).toBe(2);
    expect(seen[0]!.url).toBe("https://api.agenttool.dev/v1/x402/top-up/2");
    expect(seen[1]!.url).toBe(seen[0]!.url);
    expect(seen[0]!.headers.get("authorization")).toBeNull();
    expect(seen[1]!.headers.get("authorization")).toBeNull();
    expect(seen[1]!.headers.get("payment-signature")).not.toBeNull();
    expect(seen[1]!.headers.get("idempotency-key")).toBe(seen[0]!.headers.get("idempotency-key"));
    expect(result.creditsAdded).toBe(1);
  });

  test("a stream body is refused before anything is signed", async () => {
    let signCalls = 0;
    const base = localEvmSigner(vector.payer.private_key);
    const inner: AgentToolTransport = { request: async () => challenge402() };
    const transport = x402PayingTransport(inner, {
      signer: {
        address: base.address,
        signTypedData: (typed) => {
          signCalls += 1;
          return base.signTypedData(typed);
        },
      },
      policy: policy(),
      onPayment: undefined,
      nowSeconds: () => vector.now_seconds,
    });

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    });
    const err = await caught(() =>
      transport.request("https://api.agenttool.dev/v1/x402/top-up/1", { method: "POST", body }),
    );
    expect(err.code).toBe("x402_request_not_replayable");
    expect(signCalls).toBe(0);
  });

  test("a retry that fails on the wire still reports what was emitted", async () => {
    const events: X402PaymentEvent[] = [];
    let requests = 0;
    const inner: AgentToolTransport = {
      async request() {
        requests += 1;
        if (requests === 1) return challenge402();
        throw new TypeError("fetch failed");
      },
    };
    const transport = x402PayingTransport(inner, {
      signer: localEvmSigner(vector.payer.private_key),
      policy: policy(),
      onPayment: (event) => {
        events.push(event);
      },
      nowSeconds: () => vector.now_seconds,
    });

    await expect(
      transport.request("https://api.agenttool.dev/v1/x402/top-up/1", { method: "POST" }),
    ).rejects.toThrow("fetch failed");
    expect(requests).toBe(2);
    expect(events.length).toBe(1);
    expect(events[0]!.authorizationHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(events[0]!.validBefore).toBe(vector.now_seconds + 60);
    expect(events[0]!.status).toBeUndefined();
  });
});

// ─── Construction ─────────────────────────────────────────────────────────

describe("AgentTool x402 option — validated at construction", () => {
  const signer = localEvmSigner(vector.payer.private_key);

  function constructionError(options: Record<string, unknown>): AgentToolError {
    try {
      new AgentTool({ apiKey: "k", ...(options as object) });
    } catch (error) {
      expect(error).toBeInstanceOf(AgentToolError);
      return error as AgentToolError;
    }
    throw new Error("expected construction to throw");
  }

  test("maxAmountAtomic is mandatory — no default cap", () => {
    const { maxAmountAtomic: _omit, ...rest } = policy();
    const err = constructionError({ x402: { signer, policy: rest } });
    expect(err.code).toBe("x402_spend_policy_invalid");
    expect(err.message).toContain("maxAmountAtomic is mandatory");
  });

  test("allowedPayTo is mandatory — a 402 cannot choose the recipient", () => {
    const { allowedPayTo: _omit, ...rest } = policy();
    const err = constructionError({ x402: { signer, policy: rest } });
    expect(err.code).toBe("x402_spend_policy_invalid");
    expect(err.message).toContain("allowedPayTo is mandatory");
    expect(constructionError({ x402: { signer, policy: policy({ allowedPayTo: [] }) } }).code).toBe(
      "x402_spend_policy_invalid",
    );
  });

  test("every other wall is validated by the same assertion selection uses", () => {
    expect(constructionError({ x402: { signer, policy: policy({ allowedAssets: [] }) } }).code).toBe(
      "x402_spend_policy_invalid",
    );
    expect(constructionError({ x402: { signer, policy: policy({ allowedNetworks: [] }) } }).code).toBe(
      "x402_spend_policy_invalid",
    );
    expect(constructionError({ x402: { signer, policy: policy({ maxValiditySeconds: 0 }) } }).code).toBe(
      "x402_spend_policy_invalid",
    );
    expect(constructionError({ x402: { signer, policy: policy({ maxAmountAtomic: 0n }) } }).code).toBe(
      "x402_spend_policy_invalid",
    );
    // A number is not a bigint: no silent coercion of the cap.
    expect(
      constructionError({ x402: { signer, policy: { ...policy(), maxAmountAtomic: 1000 } } }).code,
    ).toBe("x402_spend_policy_invalid");
  });

  test("no policy at all, or a non-object option, is refused", () => {
    expect(constructionError({ x402: { signer } }).code).toBe("x402_spend_policy_invalid");
    expect(constructionError({ x402: true }).code).toBe("x402_option_invalid");
    expect(constructionError({ x402: "pay" }).code).toBe("x402_option_invalid");
  });

  test("a signer without an address or signTypedData is refused", () => {
    expect(constructionError({ x402: { signer: {}, policy: policy() } }).code).toBe("x402_signer_invalid");
    expect(
      constructionError({ x402: { signer: { address: "nope", signTypedData: async () => "0x" }, policy: policy() } })
        .code,
    ).toBe("x402_signer_invalid");
  });

  test("onPayment and nowSeconds must be functions when given", () => {
    expect(constructionError({ x402: { signer, policy: policy(), onPayment: "later" } }).code).toBe(
      "x402_option_invalid",
    );
    expect(constructionError({ x402: { signer, policy: policy(), nowSeconds: 1 } }).code).toBe(
      "x402_option_invalid",
    );
  });

  test("env fallback: AT_X402_PRIVATE_KEY is honoured only with the option present and no signer", async () => {
    // Option present, no signer, no env → typed, before any request.
    delete process.env[X402_PRIVATE_KEY_ENV];
    expect(constructionError({ x402: { policy: policy() } }).code).toBe("x402_signer_missing");

    // Option present, no signer, env set → pays with the env key.
    process.env[X402_PRIVATE_KEY_ENV] = vector.payer.private_key;
    mockSequence([challenge402, settled200]);
    const events: X402PaymentEvent[] = [];
    const at = new AgentTool({
      apiKey: "k",
      x402: { policy: policy(), onPayment: (e) => { events.push(e); }, nowSeconds: () => vector.now_seconds },
    });
    await at.x402.topUp(1);
    expect(calls.length).toBe(2);
    const payload = decodeSignature(calls[1]!.headers.get("payment-signature"));
    expect((payload.payload as { authorization: { from: string } }).authorization.from).toBe(vector.payer.address);
    expect(events.length).toBe(1);
  });

  test("an explicit signer wins over the env key", async () => {
    process.env[X402_PRIVATE_KEY_ENV] = "0x" + "ab".repeat(32);
    mockSequence([challenge402, settled200]);
    const at = new AgentTool({
      apiKey: "k",
      x402: { signer, policy: policy(), nowSeconds: () => vector.now_seconds },
    });
    await at.x402.topUp(1);
    const payload = decodeSignature(calls[1]!.headers.get("payment-signature"));
    expect((payload.payload as { authorization: { from: string } }).authorization.from).toBe(vector.payer.address);
  });

  test("a malformed env key is refused at construction without echoing it", () => {
    process.env[X402_PRIVATE_KEY_ENV] = "0xnot-a-key";
    const err = constructionError({ x402: { policy: policy() } });
    expect(err.code).toBe("x402_private_key_invalid");
    expect(err.message).not.toContain("not-a-key");
  });

  test("resolveX402Options never reads the env when a signer is given", () => {
    const resolved = resolveX402Options({ signer, policy: policy() }, { [X402_PRIVATE_KEY_ENV]: "0xgarbage" });
    expect(resolved.signer).toBe(signer);
    expect(resolved.onPayment).toBeUndefined();
    expect(typeof resolved.nowSeconds()).toBe("number");
  });
});

// ─── at.x402 namespace ────────────────────────────────────────────────────

describe("at.x402 namespace", () => {
  test("is an X402Client, cached, exposed on the client", () => {
    const at = new AgentTool({ apiKey: "k" });
    expect(at.x402).toBeInstanceOf(X402Client);
    expect(at.x402).toBe(at.x402);
  });

  test("topUp refuses a non-positive or fractional credit count locally", async () => {
    mockSequence([]);
    const at = new AgentTool({ apiKey: "k" });
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      const err = await caught(() => at.x402.topUp(bad));
      expect(err.code).toBe("top_up_invalid_credits");
    }
    expect(calls.length).toBe(0);
  });

  test("topUp honours a caller Idempotency-Key and forwards a caller signature", async () => {
    mockSequence([settled200]);
    const at = new AgentTool({ apiKey: "k" });
    await at.x402.topUp(1, { idempotency_key: "top-up-key-0001", paymentSignature: "eyJ4NDAyVmVyc2lvbiI6Mn0=" });
    expect(calls.length).toBe(1);
    expect(calls[0]!.headers.get("idempotency-key")).toBe("top-up-key-0001");
    expect(calls[0]!.headers.get("payment-signature")).toBe("eyJ4NDAyVmVyc2lvbiI6Mn0=");
    expect(calls[0]!.init.body).toBeUndefined();
  });

  test("topUp surfaces a 400 with the server's guidance", async () => {
    mockSequence([() => json(400, { error: "top_up_invalid_credits", message: "credits must be a plain positive integer between 1 and 10000." })]);
    const at = new AgentTool({ apiKey: "k" });
    const err = await caught(() => at.x402.topUp(20_000));
    expect(err.status).toBe(400);
    expect(err.code).toBe("top_up_invalid_credits");
  });

  test("payment(id) reads the ledger row", async () => {
    const row = {
      payment_id: LEDGER_ID,
      status: "settled",
      failure_reason: null,
      scheme: "exact",
      network: "eip155:8453",
      asset: X402_BASE_USDC,
      amount: "1000",
      pay_to: AGENTTOOL_TREASURY,
      max_timeout_seconds: 60,
      requirement_extra: { name: "USD Coin", version: "2", assetTransferMethod: "eip3009" },
      resource: "https://api.agenttool.dev/v1/x402/top-up/1",
      resource_info: null,
      credits_purchased: 1,
      authorization_evidence: {},
      settlement_attempted_at: null,
      transaction: "0x33",
      receipt: null,
      credits_applied: 1,
      reconciles: "payment_and_project_credit_only",
      next_action: "complete",
      retry_after_seconds: null,
      environment_note: null,
      pending_note: null,
      updated_at: null,
    };
    mockSequence([() => json(200, row)]);
    const at = new AgentTool({ apiKey: "k" });
    const status = await at.x402.payment(LEDGER_ID);
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe(`https://api.agenttool.dev/v1/x402/payments/${LEDGER_ID}`);
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer k");
    expect(status).toEqual(row);
  });

  test("payment(id) refuses an empty or non-string id before any request", async () => {
    mockSequence([]);
    const at = new AgentTool({ apiKey: "k" });
    for (const bad of ["", undefined, 42]) {
      const err = await caught(() => at.x402.payment(bad as never));
      expect(err.code).toBe("x402_payment_id_invalid");
    }
    expect(calls.length).toBe(0);
  });

  test("payment(id) encodes a hostile id so it stays under /v1/x402/payments/", async () => {
    mockSequence([() => json(404, { error: "payment_not_found" })]);
    const at = new AgentTool({ apiKey: "k" });
    const err = await caught(() => at.x402.payment("../wake?x=1#f"));
    expect(err.status).toBe(404);
    expect(calls[0]!.url).toBe("https://api.agenttool.dev/v1/x402/payments/..%2Fwake%3Fx%3D1%23f");
  });

  test("payment(id) surfaces a 404 as a typed error", async () => {
    mockSequence([() => json(404, { error: "payment_not_found" })]);
    const at = new AgentTool({ apiKey: "k" });
    const err = await caught(() => at.x402.payment(LEDGER_ID));
    expect(err.status).toBe(404);
    expect(err.code).toBe("payment_not_found");
  });

  test("paymentIdFromStatusLink parses only a rel=payment-status Link with a 64-hex id", () => {
    expect(paymentIdFromStatusLink(STATUS_LINK)).toBe(LEDGER_ID);
    expect(paymentIdFromStatusLink(`<https://api.agenttool.dev/v1/x402/payments/${LEDGER_ID}>; rel="payment-status"`)).toBe(LEDGER_ID);
    expect(paymentIdFromStatusLink('</v1/x402/payments/auth-1>; rel="payment-status"')).toBeUndefined();
    expect(paymentIdFromStatusLink(`</v1/x402/payments/${LEDGER_ID}>; rel="next"`)).toBeUndefined();
    expect(paymentIdFromStatusLink(undefined)).toBeUndefined();
  });
});
