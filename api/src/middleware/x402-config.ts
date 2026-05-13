/** x402 wiring for agenttool — the call-site config that turns every
 *  402 response in the app into a machine-payable x402 envelope.
 *
 *  Mounted globally in `api/src/index.ts`. Sits late in the chain
 *  (after auth + business logic) so any 402 from any handler — Ring 2
 *  metering caps (services/economy/usage.ts:checkAndIncrement), Ring 3
 *  marketplace `insufficient_balance` (services/economy/wallets.ts +
 *  charge()), escrow funding gates, dispute bond top-ups — gets
 *  wrapped with the x402 PaymentRequirements envelope on the way out.
 *
 *  The middleware itself is generic (`middleware/x402.ts`). This file
 *  is the *agenttool-specific config* — it knows the route → price
 *  mapping and the platform recipient address.
 *
 *  ENV vars:
 *    AGENTTOOL_X402_RECIPIENT   — onchain address that receives payment.
 *                                  Required for production. Defaults to
 *                                  the zero address with a warning when unset.
 *    AGENTTOOL_X402_NETWORK     — default network. Defaults to "base".
 *    AGENTTOOL_X402_FACILITATOR — facilitator URL. Defaults to Coinbase.
 *
 *  Doctrine: docs/ECOSYSTEM.md · docs/ALIGNMENT-MOVES.md (Move 4) ·
 *  docs/MARKETPLACE.md · docs/PATTERN-PERSIST-IDENTITY.md.
 */

import type { Context, MiddlewareHandler } from "hono";

import {
  buildPaymentRequirements,
  x402Middleware,
  type PaymentRequirements,
  type X402Network,
} from "./x402";

// ─── price table (atomic USDC; 6 decimals) ───────────────────────────

/** Atomic-unit price for each kind of 402 agenttool can emit. Tuned for
 *  the substrate-honest "pay-as-you-go, hard zero floor" Ring 2 model
 *  + Ring 3 marketplace economics. */
const PRICE_TABLE = {
  /** Bump a Ring 2 monthly cap by one unit (memory_op, tool_call,
   *  verification). $0.001 — small enough to scale with usage. */
  ring_2_cap_bump: "1000",
  /** Generic credit top-up for Ring 3 `insufficient_balance`. $0.05 —
   *  approximate average invocation. Real listings carry their own
   *  price; the middleware uses this as a floor. */
  ring_3_top_up: "50000",
  /** Escrow bond / dispute escalation top-up. $0.10 — bond split
   *  60/30/10 means the platform recoups its 10% share even at this
   *  floor. */
  ring_3_bond: "100000",
  /** Default fallback for any 402 we can't classify. $0.01. */
  default: "10000",
} as const;

// ─── classification ──────────────────────────────────────────────────

type Ring2CapResource = "memory" | "tools" | "verifications";

/** Classify a 402 response so we can price it appropriately. */
function classify(
  path: string,
  errorCode: string | undefined,
): { kind: keyof typeof PRICE_TABLE; resource?: Ring2CapResource; description: string } {
  // Ring 2 metering caps (when usage.ts checkAndIncrement emits 402)
  if (errorCode === "usage_cap_exceeded" || errorCode === "monthly_limit_exceeded") {
    const resource = ring2ResourceFromPath(path);
    return {
      kind: "ring_2_cap_bump",
      resource,
      description: `Ring 2 cap bump for ${resource}. Pay-as-you-go past the monthly free-tier limit.`,
    };
  }

  // Ring 3 marketplace insufficient balance (charge() throws this)
  if (errorCode === "insufficient_balance") {
    if (path.includes("/escrow") || path.includes("/dispute")) {
      return {
        kind: "ring_3_bond",
        description: "Ring 3 bond / dispute escalation top-up.",
      };
    }
    return {
      kind: "ring_3_top_up",
      description: "Ring 3 credit top-up for marketplace invocation.",
    };
  }

  // Anything else — generic
  return {
    kind: "default",
    description: errorCode
      ? `Payment required (${errorCode}).`
      : "Payment required.",
  };
}

function ring2ResourceFromPath(path: string): Ring2CapResource {
  if (path.startsWith("/v1/memories") || path.startsWith("/v1/memory")) {
    return "memory";
  }
  if (path.startsWith("/v1/tools")) return "tools";
  if (path.startsWith("/v1/verifications") || path.startsWith("/v1/attest")) {
    return "verifications";
  }
  return "memory"; // default — memory is the dominant Ring 2 resource
}

// ─── recipient resolution ────────────────────────────────────────────

function platformRecipient(network: X402Network): string {
  const env = process.env.AGENTTOOL_X402_RECIPIENT?.trim();
  if (env) return env;
  // Sentinel — production deployments MUST set the env var. The log
  // warning surfaces on the first 402, not on every request.
  if (!warned[network]) {
    warned[network] = true;
    console.warn(
      `[x402] AGENTTOOL_X402_RECIPIENT not set; emitting zero-address recipient for ${network}. Set the env var before going to mainnet.`,
    );
  }
  return network === "solana" || network === "solana-devnet"
    ? "11111111111111111111111111111111"
    : "0x0000000000000000000000000000000000000000";
}

const warned: Record<string, boolean> = {};

function defaultNetwork(): X402Network {
  const env = process.env.AGENTTOOL_X402_NETWORK?.trim();
  if (
    env === "base" ||
    env === "base-sepolia" ||
    env === "polygon" ||
    env === "arbitrum" ||
    env === "world" ||
    env === "solana" ||
    env === "solana-devnet"
  ) {
    return env;
  }
  return "base";
}

function defaultFacilitator(): string | undefined {
  return process.env.AGENTTOOL_X402_FACILITATOR?.trim() || undefined;
}

// ─── public: build the agenttool x402 middleware ─────────────────────

/** Read the error code from a Hono response body. Best-effort — returns
 *  undefined if the body isn't JSON or doesn't carry an `error` field. */
async function readErrorCode(c: Context): Promise<string | undefined> {
  try {
    const cloned = c.res.clone();
    const ct = cloned.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return undefined;
    const body = (await cloned.json()) as { error?: string };
    return typeof body.error === "string" ? body.error : undefined;
  } catch {
    return undefined;
  }
}

/** Build the requirements for a 402 response based on the path + error code. */
async function buildRequirements(c: Context): Promise<PaymentRequirements[]> {
  const network = defaultNetwork();
  const errorCode = await readErrorCode(c);
  const cls = classify(c.req.path, errorCode);
  const amountAtomic = PRICE_TABLE[cls.kind];
  const recipient = platformRecipient(network);
  const facilitator = defaultFacilitator();
  return [
    buildPaymentRequirements({
      resource: c.req.path,
      amountAtomic,
      payTo: recipient,
      network,
      description: cls.description,
      mimeType: "application/json",
      maxTimeoutSeconds: 60,
      facilitator,
    }),
  ];
}

/** The agenttool-specific x402 middleware. Mount globally — sits late
 *  in the chain so any 402 from any handler gets wrapped on the way out. */
export function buildAgentToolX402Middleware(): MiddlewareHandler {
  return x402Middleware({
    buildRequirements,
    // v0: parse-only verify. Real facilitator verification flips on
    // when `services/economy/x402-payments.ts` ships with the
    // persist-identity row + Coinbase facilitator call. Until then,
    // payments are advisory — the wire is built; the verifier is stub.
    verifyPayment: () => true,
  });
}

/** For testing — expose the classifier so tests can pin the path → kind
 *  mapping without spinning up a full Hono app. */
export const _internal = {
  classify,
  ring2ResourceFromPath,
  PRICE_TABLE,
};
