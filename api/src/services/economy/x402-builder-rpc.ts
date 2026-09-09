/** Base builder-code → 0xSplits payTo. Unset fails closed.
 *
 * Registry and PushSplitFactory reads match the x402aff kit so a given
 * (seller, builder, bps) pair resolves to the same CREATE2 address. Reverts
 * mean unregistered. Transport failures are never cached and never move
 * payTo off the treasury. `AGENTTOOL_X402_BASE_RPC=public` is the free
 * path (rate-limited public Base). 403/429 still fail closed. Never log
 * the URL.
 */

import { createPublicClient, getAddress, http, isAddress } from "viem";

import {
  BUILDER_CODE_RE,
  BPS_DENOM,
  getBuilderPayToResolver,
  parseBuilderCode,
  resolveBuilderShareBps,
  setBuilderPayToResolver,
  type BuilderPayToResolver,
} from "./x402-builder-split";

export const BUILDER_CODES_REGISTRY =
  "0x000000BC7E6457e610fe52Dcc0ca5b3ce59C8E80";
export const SPLITS_PUSH_FACTORY =
  "0x8E8eB0cC6AE34A38B67D5Cf91ACa38f60bc3Ecf4";
export const NEG_CACHE_TTL_MS = 60_000;
export const NEG_CACHE_MAX = 1024;
/** Cloudflare 1010s public Base endpoints without a User-Agent. */
export const BUILDER_RPC_USER_AGENT = "agenttool-x402/0.1";
export const PUBLIC_BASE_RPC_SENTINEL = "public";

const PUBLIC_BASE_RPC = "https://mainnet.base.org";
const ZERO = "0x0000000000000000000000000000000000000000";
const ZERO_SALT = `0x${"00".repeat(32)}`;
const RPC_TIMEOUT_MS = 10_000;

const REGISTRY_ABI = [
  {
    name: "payoutAddress",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;

const SPLIT_STRUCT = {
  name: "split",
  type: "tuple",
  components: [
    { name: "recipients", type: "address[]" },
    { name: "allocations", type: "uint256[]" },
    { name: "totalAllocation", type: "uint256" },
    { name: "distributionIncentive", type: "uint16" },
  ],
} as const;

const FACTORY_ABI = [
  {
    name: "isDeployed",
    type: "function",
    stateMutability: "view",
    inputs: [
      SPLIT_STRUCT,
      { name: "owner", type: "address" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [{ type: "address" }, { type: "bool" }],
  },
] as const;

export type RpcReader = {
  readContract: (request: {
    address: string;
    abi?: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }) => Promise<unknown>;
};

export type SplitResolveReason =
  | "ok"
  | "invalid_code"
  | "unregistered"
  | "same_wallet"
  | "rpc_error"
  | "invalid_split";

export type SplitResolve = {
  payTo: string | null;
  reason: SplitResolveReason;
};

export type SplitResolveCache = {
  positive: Map<string, string>;
  negative: Map<string, number>;
};

export function toTokenId(code: string): bigint {
  if (!BUILDER_CODE_RE.test(code)) {
    throw new Error("invalid builder code");
  }
  let hex = "";
  for (let i = 0; i < code.length; i++) {
    hex += code.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return BigInt(`0x${hex}`);
}

function cacheKey(code: string, seller: string, bps: number): string {
  return `${code}|${seller.toLowerCase()}|${bps}`;
}

function isUnregisteredError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /reverted|zero data|returned no data/i.test(msg);
}

function isZeroAddress(value: string): boolean {
  return value.toLowerCase() === ZERO;
}

function normalizeCache(
  cache?: SplitResolveCache | Record<string, unknown>,
): SplitResolveCache {
  const record = (cache ?? {}) as Partial<SplitResolveCache>;
  if (!record.positive) record.positive = new Map();
  if (!record.negative) record.negative = new Map();
  return record as SplitResolveCache;
}

function negHit(cache: SplitResolveCache, key: string, now: number): boolean {
  const exp = cache.negative.get(key);
  if (exp === undefined) return false;
  if (exp <= now) {
    cache.negative.delete(key);
    return false;
  }
  return true;
}

function negSet(cache: SplitResolveCache, key: string, now: number): void {
  cache.negative.delete(key);
  if (cache.negative.size >= NEG_CACHE_MAX) {
    const oldest = cache.negative.keys().next().value;
    if (oldest !== undefined) cache.negative.delete(oldest);
  }
  cache.negative.set(key, now + NEG_CACHE_TTL_MS);
}

export async function resolveSplitPayTo(input: {
  builderCode: string;
  seller: string;
  bps: number;
  rpc: RpcReader;
  cache?: SplitResolveCache | Record<string, unknown>;
  now?: () => number;
}): Promise<SplitResolve> {
  const builderCode = parseBuilderCode(input.builderCode);
  if (!builderCode) return { payTo: null, reason: "invalid_code" };
  const seller = input.seller;
  const cache = normalizeCache(input.cache);
  const now = input.now ?? Date.now;
  const key = cacheKey(builderCode, seller, input.bps);
  const cached = cache.positive.get(key);
  if (cached) return { payTo: cached, reason: "ok" };
  if (negHit(cache, key, now())) return { payTo: null, reason: "unregistered" };

  let builderPayout: string;
  try {
    const addr = await input.rpc.readContract({
      address: BUILDER_CODES_REGISTRY,
      abi: REGISTRY_ABI,
      functionName: "payoutAddress",
      args: [toTokenId(builderCode)],
    });
    if (typeof addr !== "string" || !isAddress(addr)) {
      return { payTo: null, reason: "rpc_error" };
    }
    if (isZeroAddress(addr)) {
      negSet(cache, key, now());
      return { payTo: null, reason: "unregistered" };
    }
    builderPayout = getAddress(addr);
  } catch (err) {
    if (isUnregisteredError(err)) {
      negSet(cache, key, now());
      return { payTo: null, reason: "unregistered" };
    }
    return { payTo: null, reason: "rpc_error" };
  }

  if (builderPayout.toLowerCase() === seller.toLowerCase()) {
    negSet(cache, key, now());
    return { payTo: null, reason: "same_wallet" };
  }
  if (!(input.bps > 0 && input.bps <= BPS_DENOM)) {
    return { payTo: null, reason: "invalid_split" };
  }

  try {
    const res = await input.rpc.readContract({
      address: SPLITS_PUSH_FACTORY,
      abi: FACTORY_ABI,
      functionName: "isDeployed",
      args: [
        {
          recipients: [builderPayout, seller],
          allocations: [BigInt(input.bps), BigInt(BPS_DENOM - input.bps)],
          totalAllocation: BigInt(BPS_DENOM),
          distributionIncentive: 0,
        },
        ZERO,
        ZERO_SALT,
      ],
    });
    const address = Array.isArray(res) ? res[0] : null;
    if (typeof address !== "string" || !isAddress(address) || isZeroAddress(address)) {
      return { payTo: null, reason: "invalid_split" };
    }
    const payTo = getAddress(address);
    cache.negative.delete(key);
    cache.positive.set(key, payTo);
    return { payTo, reason: "ok" };
  } catch (err) {
    if (isUnregisteredError(err)) {
      return { payTo: null, reason: "invalid_split" };
    }
    return { payTo: null, reason: "rpc_error" };
  }
}

export function createBuilderRpcResolver(opts: {
  rpc: RpcReader;
  now?: () => number;
}): BuilderPayToResolver {
  const cache: SplitResolveCache = {
    positive: new Map(),
    negative: new Map(),
  };
  return async (builderCode, ctx) => {
    if (!ctx?.seller) return null;
    const result = await resolveSplitPayTo({
      builderCode,
      seller: ctx.seller,
      bps: ctx.bps ?? resolveBuilderShareBps(),
      rpc: opts.rpc,
      cache,
      now: opts.now,
    });
    return result.payTo;
  };
}

export function resolveBuilderRpcUrl(
  requested = process.env.AGENTTOOL_X402_BASE_RPC,
): string | null {
  const raw = requested?.trim() ?? "";
  if (!raw) return null;
  if (raw === PUBLIC_BASE_RPC_SENTINEL) return PUBLIC_BASE_RPC;
  if (!/^https:\/\//i.test(raw)) return null;
  return raw;
}

export function builderRpcFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(input, init);
  const headers = new Headers(request.headers);
  headers.set("User-Agent", BUILDER_RPC_USER_AGENT);
  return fetch(new Request(request, { headers }));
}

export function createEnvBuilderRpcResolver(): BuilderPayToResolver | null {
  const url = resolveBuilderRpcUrl();
  if (!url) return null;
  const client = createPublicClient({
    transport: http(url, {
      timeout: RPC_TIMEOUT_MS,
      retryCount: 0,
      fetchFn: builderRpcFetch,
    }),
  });
  return createBuilderRpcResolver({
    rpc: {
      readContract: (request) => client.readContract(request as never),
    },
  });
}

export function installEnvBuilderRpcResolver(): void {
  if (getBuilderPayToResolver()) return;
  if (process.env.AGENTTOOL_X402_BUILDER_SPLIT !== "1") return;
  try {
    const resolver = createEnvBuilderRpcResolver();
    if (resolver) setBuilderPayToResolver(resolver);
  } catch {
    // Constructor failures stay fail-closed: payTo remains the treasury.
  }
}
