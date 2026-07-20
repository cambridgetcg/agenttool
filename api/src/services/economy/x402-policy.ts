/** Shared production x402 eligibility, pricing, and network policy.
 *
 * Keep this module side-effect free: both the outbound challenge builder and
 * inbound verifier depend on it, so they cannot drift on which project-credit
 * gates are recoverable or how much an exact payment must authorize. */

import type { ResourceInfo, X402Network } from "../../middleware/x402";
import { getAddress, isAddress } from "viem";
import { safePublicApiBase } from "../../lib/public-api-base";
import { toolsConfig } from "../tools/config";

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

export type X402ProjectCreditPath = "/v1/scrape" | "/v1/document";

export interface X402ProjectCreditPolicy {
  path: X402ProjectCreditPath;
  creditsRequired: number;
  amountAtomic: string;
  description: string;
}

/** Structural route check independent of today's configured price. Durable
 * payment recovery uses this before consulting mutable policy. */
export function isX402ProjectCreditRoute(
  path: string,
  method: string,
): path is X402ProjectCreditPath {
  return method.toUpperCase() === "POST" &&
    (path === "/v1/scrape" || path === "/v1/document");
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

/** A full route-cost top-up clears the current gate only inside this window.
 * Negative/corrupt snapshots and projects that already have enough credits
 * are not valid payment challenges. */
export function canClearProjectCreditGate(
  policy: X402ProjectCreditPolicy,
  currentCredits: unknown,
): currentCredits is number {
  return (
    typeof currentCredits === "number" &&
    Number.isSafeInteger(currentCredits) &&
    currentCredits >= 0 &&
    currentCredits < policy.creditsRequired &&
    currentCredits + policy.creditsRequired <= POSTGRES_INTEGER_MAX
  );
}

function configuredCredits(path: X402ProjectCreditPath): number {
  return path === "/v1/scrape"
    ? toolsConfig.credits.scrape
    : toolsConfig.credits.document;
}

/** Return the exact-payment policy for a currently recoverable project-credit
 * route. Dynamic subpaths and invalid/non-positive configured costs are not
 * payable through production x402. */
export function x402ProjectCreditPolicy(
  path: string,
  method: string,
): X402ProjectCreditPolicy | null {
  if (!isX402ProjectCreditRoute(path, method)) return null;

  const creditsRequired = configuredCredits(path);
  if (
    !Number.isSafeInteger(creditsRequired) ||
    creditsRequired <= 0 ||
    creditsRequired > POSTGRES_INTEGER_MAX
  ) {
    return null;
  }

  return {
    path,
    creditsRequired,
    amountAtomic: (
      BigInt(creditsRequired) * BigInt(ATOMIC_PER_CREDIT)
    ).toString(),
    description: `Exact project-credit payment for ${path} (${creditsRequired} credit${creditsRequired === 1 ? "" : "s"}).`,
  };
}

/** Outbound 402s are payable only when the handler reached the matching
 * project-credit gate. Wallet, usage-cap, and unknown 402 families do not
 * become misleading payment promises. */
export function recoverableX402ProjectCreditPolicy(
  path: string,
  method: string,
  errorCode: string | undefined,
): X402ProjectCreditPolicy | null {
  if (errorCode !== "insufficient_credits") return null;
  return x402ProjectCreditPolicy(path, method);
}
