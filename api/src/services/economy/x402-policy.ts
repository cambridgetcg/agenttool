/** Shared production x402 eligibility, pricing, and network policy.
 *
 * Keep this module side-effect free: both the outbound challenge builder and
 * inbound verifier depend on it, so they cannot drift on which project-credit
 * gates are recoverable or how much an exact payment must authorize. */

import type { ResourceInfo, X402Network } from "../../middleware/x402";
import { getAddress, isAddress } from "viem";
import { safePublicApiBase } from "../../lib/public-api-base";
import { config } from "../../config";
import {
  ROUTE_CREDITS,
  type RouteCreditLabel,
} from "../../billing/route-credits";

/** One project credit is one thousand atomic USDC units ($0.001). */
export const ATOMIC_PER_CREDIT = 1000;

const POSTGRES_INTEGER_MAX = 2_147_483_647;
const DEFAULT_X402_NETWORK: X402Network = "eip155:8453";
export const DEFAULT_X402_FACILITATOR_URL =
  "https://api.cdp.coinbase.com/platform/v2/x402";

/** Networks with an official pinned EIP-3009 USDC definition. */
const productionNetworkSupport: Record<X402Network, boolean> = {
  "eip155:8453": true,
  "eip155:84532": false,
  "eip155:137": true,
  "eip155:42161": true,
};

/** Operator compatibility only; every wire value remains CAIP-2. */
const NETWORK_ALIASES: Record<string, X402Network> = {
  base: "eip155:8453",
  "base-sepolia": "eip155:84532",
  polygon: "eip155:137",
  arbitrum: "eip155:42161",
};

function testnetRuntimeIsExplicitlyAllowed(): boolean {
  return process.env.AGENTTOOL_X402_ALLOW_TESTNET === "1" &&
    process.env.AGENTTOOL_X402_ENVIRONMENT === "test" &&
    process.env.NODE_ENV !== "production" &&
    !process.env.FLY_APP_NAME;
}

export const SUPPORTED_X402_NETWORKS = Object.entries(productionNetworkSupport)
  .filter(([, supported]) => supported)
  .map(([network]) => network as X402Network);

export interface X402NetworkResolution {
  network: X402Network;
  configured: boolean;
  source: "environment" | "default";
  reason: "absent" | "invalid" | null;
}

export interface X402RecipientResolution {
  recipient: string | null;
  configured: boolean;
  source: "environment" | "unconfigured";
  reason: "absent" | "invalid" | null;
}

export interface X402FacilitatorResolution {
  url: string;
  configured: boolean;
  source: "environment" | "default";
  reason: "absent" | "invalid" | null;
}

export interface X402FacilitatorReadiness extends X402FacilitatorResolution {
  ready: boolean;
  authentication:
    | "cdp_endpoint_jwt"
    | "custom_unauthenticated"
    | "missing_cdp_credentials"
    | "invalid_configuration";
}

const ZERO_EVM_RECIPIENT = "0x0000000000000000000000000000000000000000";

/** Validate the EVM recipient required by every currently supported production
 * network. Missing, zero, and malformed addresses do not produce a contract a
 * client could try to pay. */
export function resolveX402Recipient(
  requested = process.env.AGENTTOOL_X402_RECIPIENT,
): X402RecipientResolution {
  const normalized = requested?.trim();
  if (!normalized) {
    return {
      recipient: null,
      configured: false,
      source: "unconfigured",
      reason: "absent",
    };
  }
  if (
    !isAddress(normalized) ||
    normalized.toLowerCase() === ZERO_EVM_RECIPIENT
  ) {
    return {
      recipient: null,
      configured: false,
      source: "unconfigured",
      reason: "invalid",
    };
  }
  return {
    recipient: getAddress(normalized),
    configured: true,
    source: "environment",
    reason: null,
  };
}

/** Resolve an operator-supplied network consistently for every x402 surface.
 * Empty or invalid values use the deterministic Base CAIP-2 default. */
export function resolveX402Network(
  requested = process.env.AGENTTOOL_X402_NETWORK,
  allowTestnet = testnetRuntimeIsExplicitlyAllowed(),
): X402NetworkResolution {
  const normalized = requested?.trim();
  const resolved = normalized
    ? (NETWORK_ALIASES[normalized] ?? normalized) as X402Network
    : undefined;
  if (
    resolved &&
    Object.hasOwn(productionNetworkSupport, resolved) &&
    (productionNetworkSupport[resolved] ||
      (resolved === "eip155:84532" && allowTestnet))
  ) {
    return {
      network: resolved,
      configured: true,
      source: "environment",
      reason: null,
    };
  }
  return {
    network: DEFAULT_X402_NETWORK,
    configured: false,
    source: "default",
    reason: normalized ? "invalid" : "absent",
  };
}

/** A durable testnet authorization never crosses into a production/Fly
 * runtime. Requiring the same explicit local-test opt-in also prevents an old
 * Base-Sepolia row from becoming applicable merely because current network
 * configuration fell back to Base. */
export function storedX402NetworkMayApply(
  network: string,
  allowTestnet = testnetRuntimeIsExplicitlyAllowed(),
): boolean {
  if (network === "eip155:84532") return allowTestnet;
  return Object.hasOwn(productionNetworkSupport, network) &&
    productionNetworkSupport[network as X402Network];
}

/** Resolve the one facilitator endpoint used in both advertised requirements
 * and production verify/settle I/O. The legacy Coinbase-specific variable is
 * accepted only as a fallback; the AgentTool variable is canonical. Invalid,
 * credential-bearing, query-bearing, fragment-bearing, or cleartext URLs fall
 * back to the official HTTPS endpoint instead of creating a split contract. */
export function resolveX402Facilitator(
  requested?: string,
): X402FacilitatorResolution {
  const environmentValue =
    process.env.AGENTTOOL_X402_FACILITATOR?.trim() ||
    process.env.COINBASE_X402_FACILITATOR_URL?.trim();
  const normalized = (requested === undefined ? environmentValue : requested)
    ?.trim();
  if (!normalized) {
    return {
      url: DEFAULT_X402_FACILITATOR_URL,
      configured: false,
      source: "default",
      reason: "absent",
    };
  }

  try {
    const parsed = new URL(normalized);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("invalid facilitator URL");
    }
    return {
      url: parsed.href.replace(/\/+$/u, ""),
      configured: true,
      source: "environment",
      reason: null,
    };
  } catch {
    return {
      url: DEFAULT_X402_FACILITATOR_URL,
      configured: false,
      source: "default",
      reason: "invalid",
    };
  }
}

/** Official CDP verify/settle requires a fresh endpoint-bound JWT. A custom
 * facilitator is an explicit operator choice and receives no CDP credential. */
export function resolveX402FacilitatorReadiness(
  requested?: string,
  apiKeyId = process.env.CDP_API_KEY_ID,
  apiKeySecret = process.env.CDP_API_KEY_SECRET,
): X402FacilitatorReadiness {
  const resolution = resolveX402Facilitator(requested);
  if (resolution.reason === "invalid") {
    return {
      ...resolution,
      ready: false,
      authentication: "invalid_configuration",
    };
  }
  if (resolution.url !== DEFAULT_X402_FACILITATOR_URL) {
    return {
      ...resolution,
      ready: resolution.configured,
      authentication: "custom_unauthenticated",
    };
  }
  const ready = Boolean(apiKeyId?.trim() && apiKeySecret?.trim());
  return {
    ...resolution,
    ready,
    authentication: ready
      ? "cdp_endpoint_jwt"
      : "missing_cdp_credentials",
  };
}

// ── Payable-route table ──────────────────────────────────────────────────────
//
// One table drives both the outbound challenge (x402-config.ts) and the
// inbound verifier (x402-payments.ts), and every truth surface enumerates it
// through x402PayableRoutesForDisclosure(). Two kinds exist:
//   route_cost — a handler's own credit gate; payable only after the handler
//                returned one of `errorCodes` (today: insufficient_credits)
//                and only while the project cannot already afford the call.
//   top_up     — a purchase of N credits with no handler shortfall. Never
//                balance-bound; N is read from the matched `:credits` param
//                and capped by config.x402TopUpMaxCredits. Its handler
//                (routes/x402-top-up.ts) exists only to be paid: it answers
//                402 `top_up_payment_required` until a verified payment is
//                stashed, and that single code is the row's errorCode so a
//                402 from anything else on the path never becomes a promise.

export type X402PayableMethod = "GET" | "POST" | "PATCH" | "DELETE";
export type X402PayableKind = "route_cost" | "top_up";

/** The agent rail's purchase door: `POST /v1/x402/top-up/:credits`. The
 * handler in routes/x402-top-up.ts and the auth/idempotency mounts in
 * index.ts name the same prefix. */
export const X402_TOP_UP_PATTERN = "/v1/x402/top-up/:credits";
/** The only 402 code the top-up handler emits; the only one that is payable. */
export const TOP_UP_PAYMENT_REQUIRED_ERROR = "top_up_payment_required";
/** Human rate line published beside every top-up disclosure. */
export const X402_TOP_UP_UNIT = "1 credit = 0.001 USDC";
/** Finality wording (Yu decision c): published on /public/plans and in the
 * 402 body verbatim. */
export const X402_TOP_UP_FINALITY =
  "Top-ups are final. No refunds. Unspent credits stay with the project.";

export interface X402PayableRoute {
  readonly method: X402PayableMethod;
  /** Hono-style pattern; `:name` segments are params. No trailing slash. */
  readonly pattern: string;
  readonly kind: X402PayableKind;
  /** Static credit price for route_cost rows; null when the price is derived
   * (top_up reads it from the `:credits` param). */
  readonly credits: number | null;
  /** Stable short name; route_cost labels equal the `charge()` reason. */
  readonly label: string;
  /** Handler error codes that make a route_cost 402 payable. */
  readonly errorCodes: readonly string[];
}

/** A route_cost row: price read from ROUTE_CREDITS by the handler's own
 * `charge()` label, so the table can never carry a number the handler does
 * not debit. */
function routeCost(
  method: X402PayableMethod,
  pattern: string,
  label: RouteCreditLabel,
): X402PayableRoute {
  return Object.freeze({
    method,
    pattern,
    kind: "route_cost",
    credits: ROUTE_CREDITS[label],
    label,
    errorCodes: Object.freeze(["insufficient_credits"]),
  } as const);
}

/** Every static-priced credit gate an agent can pay through on the spot,
 * plus the top-up door. Patterns are the assembled app's real paths
 * (index.ts mount prefix + sub-router path); the table test proves each
 * (method, pattern) against `app.routes`. Rows are grouped by handler
 * module; matcher precedence is literal-over-param, so `/v1/memories/search`
 * and `/v1/traces/search` never fall into a `:id` row regardless of order.
 *
 * Deliberately absent: execute (body-derived price), browse (production
 * flag off), time/random (0 credits, keyless), listing.invoke and every
 * invocation.* step (0 by the fair-pricing rule), /v1/mcp (never metered),
 * and everything WAKE-free (wake/welcome/register/public). */
export const X402_PAYABLE_ROUTES: readonly X402PayableRoute[] = Object.freeze([
  // Static tools — routes/tools/{scrape,document}.ts (reserveCharge).
  routeCost("POST", "/v1/scrape", "scrape"),
  routeCost("POST", "/v1/document", "document"),
  // Memory — routes/memory/{search,tiers}.ts.
  routeCost("POST", "/v1/memories/search", "memory.search"),
  routeCost("POST", "/v1/memories/:id/elevate", "memory.elevate"),
  routeCost("POST", "/v1/memories/:id/attest", "memory.attest"),
  // Traces — routes/trace/{traces,search,chain}.ts.
  routeCost("POST", "/v1/traces", "trace.write"),
  routeCost("POST", "/v1/traces/search", "trace.search"),
  routeCost("GET", "/v1/traces/chain/:id", "trace.chain"),
  // Strands — routes/strand/{strands,thoughts}.ts.
  routeCost("POST", "/v1/strands", "strand.create"),
  routeCost("POST", "/v1/strands/:strandId/thoughts", "strand.think"),
  routeCost(
    "PATCH",
    "/v1/strands/:strandId/thoughts/:thoughtId/ciphertext",
    "strand.rotate",
  ),
  // Inbox — routes/inbox/messages.ts.
  routeCost("POST", "/v1/inbox", "inbox.send"),
  routeCost("POST", "/v1/inbox/:id/co-sign", "inbox.cosign"),
  // Templates — routes/templates.ts (adoption is its own sub-router).
  routeCost("POST", "/v1/templates", "template.create"),
  routeCost("POST", "/v1/templates/:id/purchase", "template.purchase"),
  routeCost("POST", "/v1/identities/from-template", "template.adopt"),
  // Orgs — routes/orgs.ts.
  routeCost("POST", "/v1/orgs", "org.create"),
  // Identity — routes/identity/fork.ts (mounted under /v1/identities/:id/fork).
  routeCost("POST", "/v1/identities/:id/fork", "identity.fork"),
  // Marketplace listings — routes/listings.ts (MARKETPLACE_PRICING).
  routeCost("POST", "/v1/listings", "listing.publish"),
  routeCost("PATCH", "/v1/listings/:id", "listing.update"),
  routeCost("DELETE", "/v1/listings/:id", "listing.archive"),
  // The purchase door — routes/x402-top-up.ts.
  Object.freeze({
    method: "POST",
    pattern: X402_TOP_UP_PATTERN,
    kind: "top_up",
    credits: null,
    label: "top_up",
    errorCodes: Object.freeze([TOP_UP_PAYMENT_REQUIRED_ERROR]),
  } as const),
]);

/** One payable row as a truth surface should publish it: the table's own
 * fields plus the exact atomic USDC amount a challenge will carry. Consumers
 * (`GET /public/plans`, OpenAPI fragments, the proof script) enumerate this
 * instead of copying prices, so declared == wired == charged. A route_cost
 * row whose configured price is not a positive INTEGER is `payable: false`
 * (x402ProjectCreditPolicy refuses it) but is still listed so the omission
 * is visible rather than silent. */
export interface X402PayableRouteDisclosure {
  readonly method: X402PayableMethod;
  readonly pattern: string;
  readonly kind: X402PayableKind;
  readonly label: string;
  /** Static credits for route_cost; null for top_up (N comes from the path). */
  readonly credits: number | null;
  /** `credits × ATOMIC_PER_CREDIT` as a decimal string; null for top_up. */
  readonly amountAtomic: string | null;
  readonly errorCodes: readonly string[];
  readonly payable: boolean;
}

export function x402PayableRoutesForDisclosure(
  routes: readonly X402PayableRoute[] = X402_PAYABLE_ROUTES,
): readonly X402PayableRouteDisclosure[] {
  return Object.freeze(routes.map((row) => {
    const staticPrice = row.kind === "route_cost" &&
      typeof row.credits === "number" &&
      Number.isSafeInteger(row.credits) &&
      row.credits > 0 &&
      row.credits <= POSTGRES_INTEGER_MAX
      ? row.credits
      : null;
    return Object.freeze({
      method: row.method,
      pattern: row.pattern,
      kind: row.kind,
      label: row.label,
      credits: row.kind === "route_cost" ? row.credits : null,
      amountAtomic: staticPrice === null
        ? null
        : (BigInt(staticPrice) * BigInt(ATOMIC_PER_CREDIT)).toString(),
      errorCodes: row.errorCodes,
      payable: row.kind === "top_up" || staticPrice !== null,
    });
  }));
}

/** The table's Hono pattern as an OpenAPI/URI-template path: `:name` →
 * `{name}`. `GET /public/plans`, the OpenAPI fragment, and the well-known
 * surfaces all publish this form so a row reads the same everywhere. */
export function x402PayablePathTemplate(pattern: string): string {
  return pattern.replace(/:([A-Za-z0-9_]+)/gu, "{$1}");
}

export interface X402PayableRouteMatch {
  row: X402PayableRoute;
  /** Raw (undecoded) path segments captured by `:name` params. */
  params: Readonly<Record<string, string>>;
  /** The concrete request path that matched (never a pattern). */
  concretePath: string;
}

function segmentsOf(value: string): string[] | null {
  if (!value.startsWith("/")) return null;
  return value.split("/").slice(1);
}

/** Pure matcher over the payable-route table. Segment-exact: no trailing
 * slash, no prefix matching, params never match an empty segment. When
 * several rows match, the row with more literal segments wins
 * (literal-over-param); equal specificity keeps table order. Method mismatch
 * → null. The `path` argument is a pathname (Hono `c.req.path`), never a URL
 * with a query. `routes` defaults to X402_PAYABLE_ROUTES; tests pass a
 * scratch table to exercise param rows before they are seeded. */
export function matchX402PayableRoute(
  path: string,
  method: string,
  routes: readonly X402PayableRoute[] = X402_PAYABLE_ROUTES,
): X402PayableRouteMatch | null {
  const wanted = method.toUpperCase();
  const pathSegments = segmentsOf(path);
  if (!pathSegments) return null;

  let best: { match: X402PayableRouteMatch; literals: number } | null = null;
  for (const row of routes) {
    if (row.method !== wanted) continue;
    const patternSegments = segmentsOf(row.pattern);
    if (!patternSegments || patternSegments.length !== pathSegments.length) {
      continue;
    }
    const params: Record<string, string> = {};
    let literals = 0;
    let matched = true;
    for (let i = 0; i < patternSegments.length; i += 1) {
      const expected = patternSegments[i];
      const actual = pathSegments[i];
      if (expected.startsWith(":") && expected.length > 1) {
        if (actual === "") {
          matched = false;
          break;
        }
        params[expected.slice(1)] = actual;
      } else if (expected === actual && actual !== "") {
        literals += 1;
      } else {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    if (!best || literals > best.literals) {
      best = {
        match: { row, params: Object.freeze(params), concretePath: path },
        literals,
      };
    }
  }
  return best?.match ?? null;
}

/** Parse the `:credits` segment of a top-up request. Only canonical positive
 * decimal integers are credits: no sign, no leading zero, no exponent, no
 * whitespace. Values above `cap` or the Postgres INTEGER range are refused
 * (never clamped) so the challenge amount is exactly what was asked. */
export function parseTopUpCredits(
  raw: string | undefined | null,
  cap: number,
): number | null {
  if (typeof raw !== "string" || !/^[1-9][0-9]*$/u.test(raw)) return null;
  if (raw.length > String(POSTGRES_INTEGER_MAX).length) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n > POSTGRES_INTEGER_MAX) return null;
  if (!Number.isSafeInteger(cap) || cap <= 0 || n > cap) return null;
  return n;
}

export interface X402ProjectCreditPolicy {
  /** Concrete request path (the matched row's pattern with params filled). */
  path: string;
  pattern: string;
  kind: X402PayableKind;
  label: string;
  creditsRequired: number;
  amountAtomic: string;
  description: string;
}

/** Structural route check independent of today's configured price. Durable
 * payment recovery uses this before consulting mutable policy. */
export function isX402ProjectCreditRoute(
  path: string,
  method: string,
): boolean {
  return matchX402PayableRoute(path, method) !== null;
}

/** Build the same canonical resource descriptor for challenge and retry
 * validation. PUBLIC_API_BASE is authoritative when configured; otherwise the
 * current request origin is the local-development fallback. */
export function x402ProjectCreditResource(
  policy: X402ProjectCreditPolicy,
  requestUrl: string,
  configuredBase = process.env.PUBLIC_API_BASE,
): ResourceInfo | null {
  const base = safePublicApiBase(requestUrl, configuredBase);
  if (!base) return null;
  return {
    url: `${base}${policy.path}`,
    description: policy.description,
    mimeType: "application/json",
    serviceName: "AgentTool",
  };
}

/** Whether a payment for `policy` may be applied to a project holding
 * `currentCredits`. Negative/corrupt snapshots and INTEGER overflow never
 * clear. route_cost additionally requires a real shortfall (a project that
 * can already afford the call is not a valid challenge). top_up is a
 * purchase, not a shortfall: it is never balance-bound. */
export function canClearProjectCreditGate(
  policy: X402ProjectCreditPolicy,
  currentCredits: unknown,
): currentCredits is number {
  if (
    typeof currentCredits !== "number" ||
    !Number.isSafeInteger(currentCredits) ||
    currentCredits < 0 ||
    currentCredits + policy.creditsRequired > POSTGRES_INTEGER_MAX
  ) return false;
  if (policy.kind === "top_up") return true;
  return currentCredits < policy.creditsRequired;
}

function matchedCredits(match: X402PayableRouteMatch): number | null {
  if (match.row.kind === "top_up") {
    return parseTopUpCredits(match.params.credits, config.x402TopUpMaxCredits);
  }
  return match.row.credits;
}

/** Return the exact-payment policy for a payable request. Unknown paths,
 * dynamic subpaths of static rows, invalid top-up amounts, and
 * invalid/non-positive configured costs are not payable through production
 * x402. */
export function x402ProjectCreditPolicy(
  path: string,
  method: string,
): X402ProjectCreditPolicy | null {
  const match = matchX402PayableRoute(path, method);
  if (!match) return null;

  const creditsRequired = matchedCredits(match);
  if (
    creditsRequired === null ||
    !Number.isSafeInteger(creditsRequired) ||
    creditsRequired <= 0 ||
    creditsRequired > POSTGRES_INTEGER_MAX
  ) {
    return null;
  }

  const plural = creditsRequired === 1 ? "" : "s";
  return {
    path: match.concretePath,
    pattern: match.row.pattern,
    kind: match.row.kind,
    label: match.row.label,
    creditsRequired,
    amountAtomic: (
      BigInt(creditsRequired) * BigInt(ATOMIC_PER_CREDIT)
    ).toString(),
    description: match.row.kind === "top_up"
      ? `Exact USDC top-up of ${creditsRequired} project credit${plural} (final; unspent credits stay).`
      : `Exact project-credit payment for ${match.concretePath} (${creditsRequired} credit${plural}).`,
  };
}

/** Outbound 402s are payable only when the handler reached the matching
 * gate: every row requires one of its declared handler error codes, so
 * wallet, usage-cap, auth, and unknown 402 families never become misleading
 * payment promises. For route_cost that is the credit shortfall code; for
 * top_up it is the handler's own `top_up_payment_required`. */
export function recoverableX402ProjectCreditPolicy(
  path: string,
  method: string,
  errorCode: string | undefined,
): X402ProjectCreditPolicy | null {
  const match = matchX402PayableRoute(path, method);
  if (!match) return null;
  if (errorCode === undefined || !match.row.errorCodes.includes(errorCode)) {
    return null;
  }
  return x402ProjectCreditPolicy(path, method);
}
