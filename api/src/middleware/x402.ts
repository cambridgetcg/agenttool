/** x402 — HTTP 402 Payment Required, internet-native agent payments.
 *
 *  Move 4 of docs/ALIGNMENT-MOVES.md. Coinbase x402 protocol donated to
 *  Linux Foundation 2026-04-02. 22 launch orgs. 69k+ active agents, 119M+
 *  transactions on Base, 35M+ on Solana, ~$50–600M cumulative annualized
 *  settled volume, zero protocol fees. Supports Base, Polygon, Arbitrum,
 *  World, Solana.
 *
 *  Wire (per x402 spec):
 *
 *    1. Client requests a paid resource.
 *    2. Server returns `402 Payment Required` with body:
 *       {
 *         "x402Version": 1,
 *         "accepts": [PaymentRequirements, …],
 *         "error": "free-tier exhausted"
 *       }
 *       and `X-PAYMENT-REQUIRED` response header containing the same JSON.
 *    3. Client signs payment off-chain (or onchain), sends a follow-up
 *       request with `X-PAYMENT: <base64-encoded payment payload>`.
 *    4. Server verifies via facilitator (e.g. https://api.cdp.coinbase.com/v2/x402).
 *    5. On success: 200 OK + `X-PAYMENT-RESPONSE` header carrying
 *       settlement info (tx hash, etc.).
 *
 *  This module provides the *envelope*: build PaymentRequirements,
 *  wrap a Hono response in the x402 envelope, and parse the X-PAYMENT
 *  header on incoming requests. Actual facilitator verification is a
 *  follow-up — for now `verifyX402Payment` returns a parsed structure
 *  that the route handler can pass to a facilitator client.
 *
 *  Persist-identity discipline (docs/PATTERN-PERSIST-IDENTITY.md):
 *  when this lands in services/economy/usage.ts, the UserOp hash (or
 *  facilitator transaction id) MUST be persisted BEFORE the facilitator
 *  POST, flipped to 'applied' after — same shape as the stripe_events
 *  pre-flight row.
 *
 *  Doctrine: docs/ECOSYSTEM.md · docs/ALIGNMENT-MOVES.md (Move 4) ·
 *  docs/PATTERN-PERSIST-IDENTITY.md.
 */

import type { Context, MiddlewareHandler } from "hono";

// ─── x402 protocol types ─────────────────────────────────────────────

export type X402Network =
  | "base"
  | "base-sepolia"
  | "polygon"
  | "arbitrum"
  | "world"
  | "solana"
  | "solana-devnet";

export type X402Scheme = "exact" | "upto" | "subscribe";

/** A single payment requirement per x402 spec. Server publishes one or
 *  more in the 402 response; client picks one it can fulfill. */
export interface PaymentRequirements {
  /** Payment scheme — "exact" pays the named amount once; "upto" caps
   *  spending; "subscribe" pays a recurring rate. v0 uses "exact". */
  scheme: X402Scheme;
  /** Blockchain network on which to settle. */
  network: X402Network;
  /** Atomic amount in the asset's smallest unit (e.g. USDC has 6 decimals
   *  so $0.001 = "1000"). String to avoid precision loss. */
  maxAmountRequired: string;
  /** The resource being paid for (URL or URI). */
  resource: string;
  /** Human-readable description. */
  description: string;
  /** MIME type the resource will return on payment. */
  mimeType: string;
  /** Recipient wallet address (or DID-anchored alias). */
  payTo: string;
  /** Seconds the requirements remain valid for client follow-up. */
  maxTimeoutSeconds: number;
  /** EIP-55 / SPL token address. For USDC on Base: 0x833589... */
  asset: string;
  /** EIP-712 typed-data hint for the client signature (optional). */
  extra?: Record<string, unknown>;
  /** Facilitator URL the server will use to verify the client's
   *  payment. Clients may use this directly for off-chain schemes. */
  outputSchema?: Record<string, unknown>;
}

export interface X402Required {
  x402Version: 1;
  accepts: PaymentRequirements[];
  error?: string;
}

export interface X402PaymentHeader {
  x402Version: 1;
  scheme: X402Scheme;
  network: X402Network;
  /** Base64-encoded signed payment payload — opaque to this layer;
   *  facilitator verifies. */
  payload: string;
}

// ─── Builders ────────────────────────────────────────────────────────

/** USDC token addresses by network (Coinbase x402 spec). */
const USDC_ASSETS: Record<X402Network, string> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  world: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
  solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "solana-devnet": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

const COINBASE_FACILITATOR = "https://api.cdp.coinbase.com/v2/x402";

export interface BuildRequirementsInput {
  resource: string; // route URL or URI
  amountAtomic: string; // e.g. "1000" = $0.001 USDC
  payTo: string;
  description?: string;
  network?: X402Network;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  facilitator?: string;
}

export function buildPaymentRequirements(
  input: BuildRequirementsInput,
): PaymentRequirements {
  const network = input.network ?? "base";
  return {
    scheme: "exact",
    network,
    maxAmountRequired: input.amountAtomic,
    resource: input.resource,
    description:
      input.description ?? "Payment required to access this agenttool resource.",
    mimeType: input.mimeType ?? "application/json",
    payTo: input.payTo,
    maxTimeoutSeconds: input.maxTimeoutSeconds ?? 60,
    asset: USDC_ASSETS[network],
    extra: {
      facilitator: input.facilitator ?? COINBASE_FACILITATOR,
    },
  };
}

export function buildX402Required(
  accepts: PaymentRequirements[],
  errorMessage?: string,
): X402Required {
  return {
    x402Version: 1,
    accepts,
    error: errorMessage,
  };
}

// ─── Inbound X-PAYMENT header parse ──────────────────────────────────

/** Parse the `X-PAYMENT` header on an incoming request. Returns the
 *  parsed envelope. Does NOT verify the payment — caller must POST to
 *  the facilitator's /verify endpoint to confirm before granting access.
 *
 *  Per persist-identity discipline: callers MUST persist the
 *  envelope.payload hash to a `x402_payments` row with status='pending'
 *  BEFORE the facilitator POST, then flip to 'verified' or 'failed'. */
export function parseX402Header(headerValue: string): X402PaymentHeader | null {
  try {
    // x402 spec: header value is base64-encoded JSON.
    const decoded = Buffer.from(headerValue, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded) as X402PaymentHeader;
    if (parsed.x402Version !== 1) return null;
    if (!parsed.scheme || !parsed.network || !parsed.payload) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ─── Hono middleware factory ─────────────────────────────────────────

export interface X402MiddlewareOptions {
  /** Required: how to build the payment requirements for a route that
   *  returned 402. Called only when the inner handler returns 402 OR
   *  when no `X-PAYMENT` header is present on a paid route. */
  buildRequirements(c: Context): PaymentRequirements[] | Promise<PaymentRequirements[]>;
  /** Optional: how to verify a client's X-PAYMENT header. v0 default
   *  is "parse-only" (returns true if the envelope decodes). Real
   *  deployments swap in a facilitator client. */
  verifyPayment?(
    c: Context,
    header: X402PaymentHeader,
  ): boolean | Promise<boolean>;
  /** When the inner handler returns a non-402 response and the client
   *  paid, write the settlement info to `X-PAYMENT-RESPONSE` header. */
  buildSettlementHeader?(c: Context): string | undefined;
}

/** Hono middleware that:
 *    - Detects X-PAYMENT on incoming requests; verifies (or stores for
 *      verification); attaches parsed payment to `c.set("x402Payment", …)`
 *    - On a 402 response from the inner handler, wraps the response
 *      body in the x402 envelope and emits the `X-PAYMENT-REQUIRED` header
 *    - On a successful response that follows a payment, emits the
 *      `X-PAYMENT-RESPONSE` header carrying settlement info
 */
export function x402Middleware(opts: X402MiddlewareOptions): MiddlewareHandler {
  return async (c, next) => {
    // ── 1. Inbound: parse X-PAYMENT if present ───────────────────────
    const headerValue = c.req.header("x-payment");
    if (headerValue) {
      const parsed = parseX402Header(headerValue);
      if (parsed) {
        const verify = opts.verifyPayment ?? (() => true);
        const ok = await verify(c, parsed);
        if (ok) {
          // Make the parsed payment available to the inner handler.
          (c as Context & { _x402Payment?: X402PaymentHeader })._x402Payment = parsed;
        }
      }
    }

    await next();

    // ── 2. Outbound: wrap 402 responses with x402 envelope ────────────
    if (c.res.status === 402) {
      const accepts = await opts.buildRequirements(c);
      const errorBody = await safeReadJson(c);
      const envelope = buildX402Required(
        accepts,
        typeof errorBody?.error === "string" ? errorBody.error : undefined,
      );
      const headers = new Headers(c.res.headers);
      headers.set("content-type", "application/json; charset=utf-8");
      headers.set("x-payment-required", JSON.stringify(envelope));
      c.res = new Response(JSON.stringify(envelope), {
        status: 402,
        headers,
      });
      return;
    }

    // ── 3. Settlement: emit X-PAYMENT-RESPONSE on 2xx after payment ──
    if (
      c.res.status >= 200 &&
      c.res.status < 300 &&
      (c as Context & { _x402Payment?: X402PaymentHeader })._x402Payment &&
      opts.buildSettlementHeader
    ) {
      const settlement = opts.buildSettlementHeader(c);
      if (settlement) {
        const headers = new Headers(c.res.headers);
        headers.set("x-payment-response", settlement);
        // Need to clone the response to add headers
        const body = await c.res.clone().arrayBuffer();
        c.res = new Response(body, {
          status: c.res.status,
          headers,
        });
      }
    }
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

async function safeReadJson(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const cloned = c.res.clone();
    if (!cloned.headers.get("content-type")?.includes("json")) return null;
    return (await cloned.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Helper for routes that want to gate behind x402: returns the parsed
 *  payment if the request carried one + the middleware verified it. */
export function getX402Payment(c: Context): X402PaymentHeader | undefined {
  return (c as Context & { _x402Payment?: X402PaymentHeader })._x402Payment;
}
