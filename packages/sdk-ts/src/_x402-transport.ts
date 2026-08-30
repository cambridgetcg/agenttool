/**
 * @internal x402 paying transport — the SDK's "pay on 402" wall.
 *
 * Wraps whichever authenticated transport the client selected (direct bearer
 * or broker) so that a 402 carrying an x402 V2 `PaymentRequired` challenge is
 * answered with exactly one signed retry:
 *
 *   bare request ──► 402 + challenge ──► select under policy ──► sign
 *                ──► the SAME request + PAYMENT-SIGNATURE ──► response
 *
 * Doctrine (Wave 2 Phase C, changed deliberately): the SDK CAN sign and pay,
 * but only when the caller opted in at construction with a signer AND a
 * spend policy. Never by default. This module is never reached unless the
 * `x402` option was passed to `AgentTool`.
 *
 * The walls this wrapper adds on top of `x402.ts`:
 *
 *   1. Exactly two fetches, ever. A second 402 after the signed retry is a
 *      typed error (`x402_payment_not_accepted`), never another signature.
 *      Signing again would be a second, independent payment.
 *   2. The retry is the same request: same method, same URL, same body, same
 *      caller headers (including `Idempotency-Key`), same authenticating
 *      transport — so the same bearer. Only `PAYMENT-SIGNATURE` is added.
 *   3. A request that already carries a caller-supplied `PAYMENT-SIGNATURE`
 *      is never paid for again; its 402 surfaces untouched.
 *   4. A 402 without a parseable challenge (fail-closed admission with
 *      `Retry-After`, a replay-suppressed 402 echoing `PAYMENT-RESPONSE`) is
 *      not payable and surfaces untouched, headers intact.
 *   5. A refusal by the spend policy is a typed error whose `code` is the
 *      refusal reason. Nothing was signed; one fetch happened.
 *   6. A body that cannot be re-sent (a stream) is refused BEFORE anything is
 *      signed: a signature that cannot be delivered is a liability.
 *
 * The leading underscore keeps the parity scanner off this file: it is
 * plumbing, not the public surface. The public surface is `x402.ts`.
 */

import { errorFromBody, type AgentToolTransport } from "./_http.js";
import { AgentToolError } from "./errors.js";
import {
  X402_VERSION,
  decodePaymentRequiredHeader,
  isEvmAddress,
  localEvmSigner,
  parsePaymentRequiredBody,
  selectPayableRequirement,
  signExactEvmAuthorization,
  type SignedX402Payment,
  type X402ClientRefusal,
  type X402PaymentRequired,
  type X402Signer,
  type X402SpendPolicy,
} from "./x402.js";

/** Environment variable read ONLY when the `x402` option is present without
 *  a signer. Its absence with no `x402` option changes nothing. */
export const X402_PRIVATE_KEY_ENV = "AT_X402_PRIVATE_KEY";

/** What `onPayment` receives after the signed retry was attempted. */
export interface X402PaymentEvent {
  /** Client identity of the signed authorization (the six EIP-3009 fields,
   *  `authorizationHash` in x402.ts). Persist it: recovery is a lookup on
   *  what was emitted, never a fresh signature. */
  authorizationHash: string;
  /** Unix seconds after which the signed bytes are dead. */
  validBefore: number;
  /** HTTP status of the signed retry. Absent when the retry itself threw
   *  (network failure) — the authorization may still have been received. */
  status?: number;
  /** Raw `PAYMENT-RESPONSE` settlement receipt from the retry, if any. */
  paymentResponse?: string;
  /** Raw `Link` header from the retry (rel="payment-status"), if any. */
  paymentStatusLink?: string;
  /** The server's LEDGER identity for this payment, parsed from the
   *  rel="payment-status" Link when present. This — not `authorizationHash`
   *  — is what `at.x402.payment(id)` resolves. */
  paymentId?: string;
  /** Raw `X-Credits-Balance` from the retry, if any. */
  creditsBalance?: string;
}

export type X402PaymentCallback = (event: X402PaymentEvent) => void | Promise<void>;

/** The `x402` option on `AgentToolOptions`. Presence is the opt-in. */
export interface AgentToolX402Options {
  /** Whoever holds the key. Omit to read `AT_X402_PRIVATE_KEY` into a
   *  `localEvmSigner` — honoured ONLY because this option object exists. */
  signer?: X402Signer;
  /** Mandatory, no defaults: `maxAmountAtomic` and `allowedPayTo` above all.
   *  A policy without a hard cap and a recipient allow-list is refused at
   *  construction, before any request is made. */
  policy: X402SpendPolicy;
  /** Called once per signed retry with the identity of what was emitted. */
  onPayment?: X402PaymentCallback;
  /** Clock for the authorization window (unix seconds). Defaults to
   *  `Date.now()`; injectable for tests and trusted time sources. */
  nowSeconds?: () => number;
}

/** @internal Validated form handed to the transport. */
export interface ResolvedX402Options {
  signer: X402Signer;
  policy: X402SpendPolicy;
  onPayment: X402PaymentCallback | undefined;
  nowSeconds: () => number;
}

const AUTHORIZATION_HASH = /^[0-9a-f]{64}$/u;
const PAYMENT_STATUS_LINK = /<([^>]*\/v1\/x402\/payments\/([0-9a-f]{64}))>\s*;\s*rel="payment-status"/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @internal Validate the `x402` option at construction.
 *
 * Throws typed `AgentToolError`s: `x402_option_invalid` (not an object, bad
 * callback), `x402_spend_policy_invalid` (missing/invalid policy — the cap
 * and the payTo allow-list are named first because they are the two walls
 * that matter most), `x402_signer_invalid`, `x402_private_key_invalid`,
 * `x402_signer_missing`. Nothing here touches the network.
 */
export function resolveX402Options(
  option: unknown,
  env: Readonly<Record<string, string | undefined>>,
): ResolvedX402Options {
  if (!isRecord(option)) {
    throw new AgentToolError("x402 option must be an object: { signer?, policy, onPayment? }.", {
      code: "x402_option_invalid",
      hint: "Pass x402: { signer: localEvmSigner(key), policy: { maxAmountAtomic, allowedPayTo, allowedNetworks, allowedAssets, maxValiditySeconds } }.",
    });
  }

  const policyValue = option.policy;
  if (!isRecord(policyValue)) {
    throw new AgentToolError("x402 option needs a spend policy; there is no default.", {
      code: "x402_spend_policy_invalid",
      hint: "A policy without maxAmountAtomic and allowedPayTo is not a policy. Name the cap and the recipients you will pay.",
    });
  }
  if (typeof policyValue.maxAmountAtomic !== "bigint" || policyValue.maxAmountAtomic <= 0n) {
    throw new AgentToolError("x402 spend policy: maxAmountAtomic is mandatory (bigint > 0). Over-cap is refused, never clamped.", {
      code: "x402_spend_policy_invalid",
      hint: "Set maxAmountAtomic to the most atomic USDC one payment may move, e.g. 10n * X402_ATOMIC_PER_CREDIT.",
    });
  }
  if (!Array.isArray(policyValue.allowedPayTo) || policyValue.allowedPayTo.length === 0) {
    throw new AgentToolError("x402 spend policy: allowedPayTo is mandatory (non-empty allow-list). A 402 cannot choose the recipient.", {
      code: "x402_spend_policy_invalid",
      hint: "Name the recipients explicitly, e.g. allowedPayTo: [AGENTTOOL_TREASURY].",
    });
  }
  const policy = policyValue as unknown as X402SpendPolicy;
  // The one validator: selectPayableRequirement asserts every wall before it
  // looks at any requirement. An empty challenge exercises the assertion
  // and nothing else (the refusal it returns is discarded).
  selectPayableRequirement(
    { x402Version: X402_VERSION, resource: { url: "x402:policy" }, accepts: [] },
    policy,
  );

  let signer: X402Signer;
  if (option.signer !== undefined) {
    const candidate = option.signer as Partial<X402Signer> | null;
    if (
      !candidate ||
      typeof candidate !== "object" ||
      typeof candidate.signTypedData !== "function" ||
      !isEvmAddress(candidate.address)
    ) {
      throw new AgentToolError("x402 signer must expose an EVM address and signTypedData().", {
        code: "x402_signer_invalid",
        hint: "Use localEvmSigner(privateKeyHex) or an object { address, signTypedData(typedData) } backed by your wallet.",
      });
    }
    signer = candidate as X402Signer;
  } else {
    const key = env[X402_PRIVATE_KEY_ENV];
    if (typeof key !== "string" || key.length === 0) {
      throw new AgentToolError(
        `x402 option is present but no signer was given and ${X402_PRIVATE_KEY_ENV} is not set.`,
        {
          code: "x402_signer_missing",
          hint: `Pass x402.signer (e.g. localEvmSigner(key)) or set ${X402_PRIVATE_KEY_ENV}. The env variable is read only when the x402 option is present.`,
        },
      );
    }
    signer = localEvmSigner(key); // throws x402_private_key_invalid; never echoes the key
  }

  if (option.onPayment !== undefined && typeof option.onPayment !== "function") {
    throw new AgentToolError("x402 onPayment must be a function.", { code: "x402_option_invalid" });
  }
  if (option.nowSeconds !== undefined && typeof option.nowSeconds !== "function") {
    throw new AgentToolError("x402 nowSeconds must be a function returning unix seconds.", {
      code: "x402_option_invalid",
    });
  }

  return {
    signer,
    policy,
    onPayment: option.onPayment as X402PaymentCallback | undefined,
    nowSeconds: (option.nowSeconds as (() => number) | undefined) ?? (() => Math.floor(Date.now() / 1000)),
  };
}

// ─── Challenge reading ────────────────────────────────────────────────────

interface Challenge {
  required: X402PaymentRequired;
  /** Raw PAYMENT-REQUIRED header, when the challenge came from it. */
  paymentRequired: string | undefined;
  body: unknown;
}

function paymentRequiredHeader(resp: Response): string | undefined {
  return resp.headers.get("PAYMENT-REQUIRED") ?? resp.headers.get("X-PAYMENT-REQUIRED") ?? undefined;
}

/** Order of truth: the PAYMENT-REQUIRED header first (always the pure
 *  `PaymentRequired`), then the body (the API spreads the envelope over its
 *  guidance body, so it parses too). The body is read from a clone so the
 *  original response stays readable for whoever surfaces the 402. */
async function readChallenge(resp: Response): Promise<Challenge | null> {
  const header = paymentRequiredHeader(resp);
  const fromHeader = header ? decodePaymentRequiredHeader(header) : null;
  let body: unknown;
  try {
    body = await resp.clone().json();
  } catch {
    body = undefined;
  }
  const required = fromHeader ?? parsePaymentRequiredBody(body);
  if (!required) return null;
  return { required, paymentRequired: fromHeader ? header : undefined, body };
}

/** A body the SDK can send twice. The SDK's own clients send JSON strings;
 *  a caller-built stream can be read once only. */
function bodyIsReplayable(body: BodyInit | null | undefined): boolean {
  if (body === undefined || body === null) return true;
  if (typeof body === "string") return true;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return true;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return true;
  if (typeof FormData !== "undefined" && body instanceof FormData) return true;
  if (typeof Blob !== "undefined" && body instanceof Blob) return true;
  return false;
}

/** Parse the ledger id out of a rel="payment-status" Link header. */
export function paymentIdFromStatusLink(link: string | undefined): string | undefined {
  if (!link) return undefined;
  const match = PAYMENT_STATUS_LINK.exec(link);
  const id = match?.[2];
  return id && AUTHORIZATION_HASH.test(id) ? id : undefined;
}

// ─── Typed errors ─────────────────────────────────────────────────────────

/** Start from the server's own guided body (so `accepts`, `resource`,
 *  `paymentRequired`, `paymentResponse`, `paymentStatusLink`, `retryAfter`
 *  and `creditsBalance` travel intact) and override only what this wall
 *  decided: message, code, hint, details. */
function x402Error(
  resp: Response,
  body: unknown,
  operation: string,
  override: { message: string; code: string; hint: string; details: unknown },
): AgentToolError {
  const base = errorFromBody(body, resp.status, operation, resp.headers);
  return new AgentToolError(override.message, {
    code: override.code,
    hint: override.hint,
    details: override.details,
    status: base.status,
    next_actions: base.next_actions,
    docs: base.docs,
    safety: base.safety,
    x402Version: base.x402Version,
    accepts: base.accepts,
    resource: base.resource,
    extensions: base.extensions,
    paymentRequired: base.paymentRequired,
    paymentResponse: base.paymentResponse,
    paymentStatusLink: base.paymentStatusLink,
    retryAfter: base.retryAfter,
    creditsBalance: base.creditsBalance,
  });
}

function refusalError(resp: Response, challenge: Challenge, refusal: X402ClientRefusal): AgentToolError {
  return x402Error(resp, challenge.body, "x402 challenge refused", {
    message: `x402: not paying — ${refusal.detail}`,
    code: refusal.reason,
    hint:
      "The challenge was refused by this client's spend policy; nothing was signed. " +
      "Widen the policy deliberately (cap, allow-lists) or do not pay. Over-cap is refused, never clamped.",
    details: { refusal, serverError: typeof (challenge.body as Record<string, unknown> | undefined)?.error === "string" ? (challenge.body as Record<string, unknown>).error : undefined },
  });
}

function notAcceptedError(resp: Response, body: unknown, signed: SignedX402Payment, event: X402PaymentEvent): AgentToolError {
  return x402Error(resp, body, "x402 signed retry", {
    message:
      "x402: the signed retry was answered with a second 402. Not signing again — a second signature would be a second payment.",
    code: "x402_payment_not_accepted",
    hint:
      "Look up the payment before deciding anything: at.x402.payment(paymentId) when the rel=payment-status Link names one, " +
      "otherwise inspect paymentResponse / retryAfter. Replay the same bytes only if the status says so; never mint a new authorization for this request.",
    details: {
      authorizationHash: signed.authorizationHash,
      validBefore: signed.validBefore,
      paymentId: event.paymentId,
      serverError: isRecord(body) && typeof body.error === "string" ? body.error : undefined,
    },
  });
}

// ─── The transport ────────────────────────────────────────────────────────

function retryHeaders(init: RequestInit, paymentSignature: string): Record<string, string> {
  const headers = new Headers(init.headers);
  headers.set("PAYMENT-SIGNATURE", paymentSignature);
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name] = value;
  });
  return out;
}

/**
 * @internal Wrap `inner` so a challenged 402 is paid once, under `resolved`.
 *
 * `inner` performs authentication; the retry goes through it again, so the
 * bearer (or broker grant) on the retry is the same one the bare request
 * carried. This wrapper never sees a credential.
 */
export function x402PayingTransport(
  inner: AgentToolTransport,
  resolved: ResolvedX402Options,
): AgentToolTransport {
  const { signer, policy, onPayment, nowSeconds } = resolved;

  const emit = async (event: X402PaymentEvent): Promise<void> => {
    if (onPayment) await onPayment(event);
  };

  return {
    async request(input, init = {}) {
      const first = await inner.request(input, init);
      if (first.status !== 402) return first;

      // Wall 3: a caller who signed already is not signed for again.
      if (new Headers(init.headers).has("PAYMENT-SIGNATURE")) return first;

      // Wall 4: no challenge → not payable here; surface untouched.
      const challenge = await readChallenge(first);
      if (!challenge) return first;

      // Wall 6: refuse before signing what could not be delivered.
      if (!bodyIsReplayable(init.body)) {
        throw x402Error(first, challenge.body, "x402 challenge", {
          message: "x402: the request body cannot be re-sent, so the challenge cannot be paid.",
          code: "x402_request_not_replayable",
          hint: "Send a string, ArrayBuffer, Blob, FormData or URLSearchParams body — not a stream — when a request may be challenged.",
          details: { bodyType: typeof init.body },
        });
      }

      // Wall 5: select under the policy; a refusal is typed and final.
      const selected = selectPayableRequirement(challenge.required, policy);
      if (!selected.ok) throw refusalError(first, challenge, selected);

      // Sign once. Fresh nonce; the narrowest window; the policy re-checked.
      const signed = await signExactEvmAuthorization({
        requirement: selected.requirement,
        policy,
        signer,
        nowSeconds: nowSeconds(),
        resource: challenge.required.resource,
      });

      // Wall 2: the same request, plus PAYMENT-SIGNATURE, through the same
      // authenticating transport.
      let second: Response;
      try {
        second = await inner.request(input, {
          ...init,
          headers: retryHeaders(init, signed.header),
        });
      } catch (error) {
        // The bytes may have reached the server. Hand the caller the identity
        // of what was emitted before the failure surfaces.
        await emit({ authorizationHash: signed.authorizationHash, validBefore: signed.validBefore });
        throw error;
      }

      const paymentStatusLink = second.headers.get("Link") ?? undefined;
      const event: X402PaymentEvent = {
        authorizationHash: signed.authorizationHash,
        validBefore: signed.validBefore,
        status: second.status,
        paymentResponse:
          second.headers.get("PAYMENT-RESPONSE") ?? second.headers.get("X-PAYMENT-RESPONSE") ?? undefined,
        paymentStatusLink,
        paymentId: paymentIdFromStatusLink(paymentStatusLink),
        creditsBalance: second.headers.get("X-Credits-Balance") ?? undefined,
      };
      // The settled response is the caller's artifact; a throwing onPayment
      // must not discard it (credits were applied server-side). Callback
      // failures are swallowed on the success path and surfaced only when the
      // retry itself was not accepted (they ride along on that error).
      let callbackError: unknown = undefined;
      try {
        await emit(event);
      } catch (error) {
        callbackError = error;
      }

      // Wall 1: two fetches, ever.
      if (second.status === 402) {
        let body: unknown;
        try {
          body = await second.clone().json();
        } catch {
          body = undefined;
        }
        const err = notAcceptedError(second, body, signed, event);
        if (callbackError !== undefined) (err as { cause?: unknown }).cause = callbackError;
        throw err;
      }
      return second;
    },
  };
}
