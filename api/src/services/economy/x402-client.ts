/** x402 V2 client — the half of the protocol agenttool never built.
 *
 *  `x402-payments.ts` is the server: it charges callers, verifies their
 *  EIP-3009 authorizations, and settles. There has never been a client. So
 *  the substrate can be paid by an agent, but cannot pay for its own inputs —
 *  its RPC still runs on an API key a human provisioned against a human's
 *  card.
 *
 *  `docs/CLI-GAPS.md` names that exact asymmetry as a reason agenttool exists:
 *
 *      "A wallet — the agent has no way to fund itself.
 *       The credit card belongs to the human."
 *
 *  This module is the first piece of closing that on ourselves. It turns a
 *  402 challenge into a signed, capability-bounded payment authorization.
 *
 *  ## What this module does NOT do
 *
 *  No network. It parses, refuses, and signs; the caller performs egress
 *  through the existing `services/net/safe-fetch` boundary. Keeping it pure
 *  means every wall below is testable without a live counterparty, and means
 *  a bug here cannot itself spend anything.
 *
 *  No key custody. The caller passes a signer callback. The private half
 *  never enters this module — the same posture `packages/wallet` takes.
 *
 *  ## The walls
 *
 *  1. **A cap that is not advisory.** `maxAmountAtomic` is checked before
 *     signing. An over-cap requirement is refused, not clamped: silently
 *     paying less than asked would produce an authorization the counterparty
 *     rejects, which reads as our bug rather than their price.
 *  2. **Allowlists, not denylists.** Network, asset, and (optionally) payTo
 *     must be named in advance. A 402 body is untrusted input from whoever
 *     we are talking to; it must never be able to introduce a new asset
 *     contract or a new recipient.
 *  3. **The narrowest validity window that satisfies the requirement.** The
 *     authorization expires on its own. A signed EIP-3009 authorization is
 *     bearer-spendable until `validBefore`; a long window is a long liability.
 *  4. **No re-signing. Ever.** This is `no_auto_retry_payout` — one of the
 *     eight walls published in every wake — applied to the paying side. If a
 *     request carrying an authorization fails ambiguously, the counterparty
 *     may still settle it. Signing a *fresh* authorization for the same
 *     resource is how you pay twice. Retry the identical bytes, which every
 *     conformant facilitator dedupes by nonce, or stop and let an operator
 *     look. `authorizationHash` exists so a caller can persist what it emitted
 *     before emitting it — the same persist-before-submit discipline as
 *     `workers/payout/`.
 *
 *  Doctrine: docs/CLI-GAPS.md · docs/AGENT-ECONOMY.md · api/src/workers/payout/CLAUDE.md
 *
 *  @enforces urn:agenttool:wall/no-auto-retry-payout
 *    Applied to outbound payment: `signExactEvmAuthorization` mints a fresh
 *    nonce every call, so the module refuses to be a retry mechanism by
 *    construction — a caller that wants to retry must replay the bytes it
 *    already holds. */

import { createHash, randomBytes } from "node:crypto";

import {
  encodeCanonicalBase64Json,
  parsePaymentRequirements,
  X402_VERSION,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type ResourceInfo,
  type X402Network,
} from "../../middleware/x402";

/** EIP-712 types for USDC-style `transferWithAuthorization`. Identical to the
 *  server's verifier in `x402-payments.ts` — the two sides must agree
 *  byte-for-byte, so the shape is duplicated deliberately rather than
 *  imported: a future edit to one is meant to be a visible divergence from
 *  the other, not a silent shared-constant change. */
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

/** What this instance is willing to spend, before it sees any challenge.
 *  Every field is a refusal condition, not a preference. */
export interface X402SpendPolicy {
  /** Hard per-payment ceiling in the asset's atomic units. */
  maxAmountAtomic: bigint;
  /** CAIP-2 networks we will sign for. */
  allowedNetworks: readonly X402Network[];
  /** Asset contract addresses we will sign for. Compared case-insensitively. */
  allowedAssets: readonly string[];
  /** Optional recipient allowlist. Omit to accept the challenge's payTo. */
  allowedPayTo?: readonly string[];
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
  requirement: PaymentRequirements;
  amountAtomic: bigint;
}

/** Parse an untrusted 402 response body into a `PaymentRequired`.
 *
 *  Deliberately stricter than "does it have the fields": every entry in
 *  `accepts` goes through the same `parsePaymentRequirements` the server uses
 *  on inbound headers, so a counterparty cannot hand us a shape our own
 *  verifier would reject. */
export function parsePaymentRequiredBody(value: unknown): PaymentRequired | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (body.x402Version !== X402_VERSION) return null;

  const resourceValue = body.resource;
  if (resourceValue === null || typeof resourceValue !== "object" || Array.isArray(resourceValue)) {
    return null;
  }
  const resourceUrl = (resourceValue as Record<string, unknown>).url;
  if (typeof resourceUrl !== "string" || resourceUrl.length === 0) return null;

  if (!Array.isArray(body.accepts) || body.accepts.length === 0 || body.accepts.length > 16) {
    return null;
  }
  const accepts: PaymentRequirements[] = [];
  for (const entry of body.accepts) {
    const parsed = parsePaymentRequirements(entry);
    if (!parsed) return null;
    accepts.push(parsed);
  }

  return {
    x402Version: X402_VERSION,
    ...(typeof body.error === "string" ? { error: body.error } : {}),
    resource: resourceValue as ResourceInfo,
    accepts,
  };
}

function lowerSet(values: readonly string[]): Set<string> {
  return new Set(values.map((v) => v.toLowerCase()));
}

/** Pick the first requirement this policy permits, or say precisely why none
 *  qualified.
 *
 *  "First permitted", not "cheapest": the counterparty orders `accepts` by
 *  its own preference, and reordering by price would quietly opt us into
 *  whichever rail they listed last. Cost is bounded by the cap instead. */
export function selectPayableRequirement(
  required: PaymentRequired,
  policy: X402SpendPolicy,
): X402SelectedRequirement | X402ClientRefusal {
  const networks = new Set<string>(policy.allowedNetworks);
  const assets = lowerSet(policy.allowedAssets);
  const payTo = policy.allowedPayTo ? lowerSet(policy.allowedPayTo) : null;

  // Remember the most specific reason seen, so a caller learns "your cap is
  // too low" rather than the useless "nothing matched".
  let lastRefusal: X402ClientRefusal | null = null;
  const refuse = (reason: X402ClientRefusalReason, detail: string): X402ClientRefusal => ({
    ok: false,
    reason,
    detail,
  });

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
    if (payTo && !payTo.has(requirement.payTo.toLowerCase())) {
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
      lastRefusal = refuse(
        "no_acceptable_requirement",
        "Challenge amount is not positive.",
      );
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

/** EIP-712 payload handed to the caller's signer. Shaped for viem's
 *  `signTypedData`, but structurally plain so any signer can consume it. */
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

export type X402Signer = (
  typedData: TransferWithAuthorizationTypedData,
) => Promise<string>;

export interface SignedX402Payment {
  /** Ready for the PAYMENT-SIGNATURE header. */
  header: string;
  payload: PaymentPayload;
  /** Stable identity of the authorization these bytes carry.
   *
   *  Persist this BEFORE emitting the request. If the response is ambiguous,
   *  recovery is a lookup on what was emitted — not a fresh signature. Same
   *  discipline as persisting `tx_hash` before an RPC submit. */
  authorizationHash: string;
  /** Unix seconds after which these bytes are dead. */
  validBefore: number;
}

/** Canonical identity of an authorization: the fields that decide where the
 *  money goes. Two byte-identical emissions hash the same; any change to
 *  recipient, amount, window, or nonce does not. */
export function authorizationHash(auth: {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        from: auth.from.toLowerCase(),
        to: auth.to.toLowerCase(),
        value: auth.value,
        validAfter: auth.validAfter,
        validBefore: auth.validBefore,
        nonce: auth.nonce.toLowerCase(),
      }),
      "utf-8",
    )
    .digest("hex");
}

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
 *  `nowSeconds` is injected rather than read from the clock so the window is
 *  testable and so a caller with a trusted time source can supply it. */
export async function signExactEvmAuthorization(options: {
  requirement: PaymentRequirements;
  policy: X402SpendPolicy;
  payerAddress: string;
  signer: X402Signer;
  nowSeconds: number;
  resource?: ResourceInfo;
}): Promise<SignedX402Payment> {
  const { requirement, policy, payerAddress, nowSeconds } = options;

  if (!Number.isSafeInteger(nowSeconds) || nowSeconds <= 0) {
    throw new Error("x402 client: nowSeconds must be a positive safe integer.");
  }

  const chainId = Number(requirement.network.slice("eip155:".length));
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error(`x402 client: unusable chain id in network ${requirement.network}.`);
  }

  // The narrowest window that still satisfies the counterparty. A signed
  // EIP-3009 authorization is bearer-spendable until validBefore; a long
  // window is a long liability.
  const windowSeconds = Math.min(requirement.maxTimeoutSeconds, policy.maxValiditySeconds);
  if (windowSeconds <= 0) {
    throw new Error("x402 client: no positive validity window remains after applying the policy.");
  }

  // validAfter is one second in the past: a signature minted at exactly `now`
  // can otherwise lose a race against a verifier whose clock is a tick behind.
  const validAfter = nowSeconds - 1;
  const validBefore = nowSeconds + windowSeconds;
  const nonce = `0x${randomBytes(32).toString("hex")}`;

  const authorization = {
    from: payerAddress,
    to: requirement.payTo,
    value: requirement.amount,
    validAfter: String(validAfter),
    validBefore: String(validBefore),
    nonce,
  };

  const signature = await options.signer({
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

  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/u.test(signature)) {
    // A malformed signature would be spent effort and a confusing 402 loop;
    // fail here where the cause is obvious.
    throw new Error("x402 client: signer returned something that is not a 65-byte hex signature.");
  }

  const payload: PaymentPayload = {
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
export function paymentIsStillReplayable(
  signed: SignedX402Payment,
  nowSeconds: number,
): boolean {
  return nowSeconds < signed.validBefore;
}
