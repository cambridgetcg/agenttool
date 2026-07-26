/**
 * Closed internal Alchemy read/simulation adapter.
 *
 * This is deliberately not a generic JSON-RPC client. Callers choose one of
 * six named operations; this module owns the exact RPC method and parameter
 * shape. It never accepts an endpoint, arbitrary method, signed transaction,
 * raw transaction, private key, or broadcast operation, and it is not mounted
 * on AgentTool's public HTTP or MCP surfaces.
 *
 * Results are bounded provider observations. Reads are not finality proofs and
 * simulations are predictions, not authorization, safety proofs, transaction
 * execution, or guarantees that later chain state will behave identically.
 * Result payloads remain provider JSON: this adapter validates their outer
 * operation-specific shape but does not attest every nested field, convert
 * enriched transfer numbers into accounting values, or persist evidence.
 * Consumers doing exact accounting must use and independently validate raw
 * integer fields rather than Alchemy's human-unit `value`.
 * Alchemy currently documents both simulation methods as deprecated after
 * 2026-09-30; callers must treat that operation family as replaceable.
 *
 * The injected fetch implementation is a trusted internal/test dependency. It
 * can observe the Authorization header by design; untrusted code must never be
 * allowed to supply it.
 *
 * Official shapes checked 2026-07-26:
 * - https://www.alchemy.com/docs/how-to-use-api-keys-in-http-headers
 * - https://www.alchemy.com/docs/chains/ethereum/ethereum-api-endpoints/eth-get-balance
 * - https://www.alchemy.com/docs/chains/base/base-api-endpoints/eth-get-transaction-receipt
 * - https://www.alchemy.com/docs/chains/stable/stable-api-endpoints/eth-get-logs
 * - https://www.alchemy.com/docs/data/transfers-api/transfers-endpoints/alchemy-get-asset-transfers
 * - https://www.alchemy.com/docs/data/simulation-apis/transaction-simulation-endpoints/alchemy-simulate-asset-changes
 * - https://www.alchemy.com/docs/data/simulation-apis/transaction-simulation-endpoints/alchemy-simulate-execution
 *
 * Doctrine: docs/CRYPTO-PAYMENT.md.
 */

import { isAddress } from "viem";

import type { EvmChain } from "./chains";
import type { ActiveNetwork } from "./network";

export const ALCHEMY_INTERNAL_DEFAULT_TIMEOUT_MS = 8_000;
export const ALCHEMY_INTERNAL_MAX_TIMEOUT_MS = 30_000;
export const ALCHEMY_INTERNAL_DEFAULT_RESPONSE_BYTES = 512 * 1024;
export const ALCHEMY_INTERNAL_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const ALCHEMY_INTERNAL_MAX_REQUEST_BYTES = 128 * 1024;
export const ALCHEMY_INTERNAL_LOG_BLOCKS = 10;
export const ALCHEMY_INTERNAL_TRANSFER_BLOCKS = 10_000;
export const ALCHEMY_SIMULATION_DEPRECATION_DATE = "2026-09-30" as const;

const JSON_RPC_ID = 1;
const MAX_ADDRESSES = 20;
const MAX_TRANSFER_RESULTS = 100;
const MAX_PAGE_KEY_BYTES = 512;
const MAX_CALLDATA_BYTES = 32 * 1024;
const MAX_RESPONSE_CHUNKS = 4_096;

const EVM_CHAINS = [
  "ethereum",
  "base",
  "polygon",
  "arbitrum",
  "optimism",
] as const satisfies readonly EvmChain[];

const ACTIVE_NETWORKS = ["mainnet", "testnet"] as const;

const ALCHEMY_HOSTS: Record<
  EvmChain,
  Record<ActiveNetwork, string>
> = {
  ethereum: {
    mainnet: "eth-mainnet.g.alchemy.com",
    testnet: "eth-sepolia.g.alchemy.com",
  },
  base: {
    mainnet: "base-mainnet.g.alchemy.com",
    testnet: "base-sepolia.g.alchemy.com",
  },
  polygon: {
    mainnet: "polygon-mainnet.g.alchemy.com",
    testnet: "polygon-amoy.g.alchemy.com",
  },
  arbitrum: {
    mainnet: "arb-mainnet.g.alchemy.com",
    testnet: "arb-sepolia.g.alchemy.com",
  },
  optimism: {
    mainnet: "opt-mainnet.g.alchemy.com",
    testnet: "opt-sepolia.g.alchemy.com",
  },
};

export const ALCHEMY_INTERNAL_RPC_METHODS = Object.freeze({
  balance: "eth_getBalance",
  receipt: "eth_getTransactionReceipt",
  logs: "eth_getLogs",
  transfers: "alchemy_getAssetTransfers",
  simulate_asset_changes: "alchemy_simulateAssetChanges",
  simulate_execution: "alchemy_simulateExecution",
} as const);

export type AlchemyInternalOperationName =
  keyof typeof ALCHEMY_INTERNAL_RPC_METHODS;

export type AlchemyReadBlockTag =
  | "latest"
  | "safe"
  | "finalized"
  | "earliest"
  | "pending";

export type AlchemySimulationBlockTag = Exclude<
  AlchemyReadBlockTag,
  "pending"
>;

export type AlchemyTransferCategory =
  | "external"
  | "internal"
  | "erc20"
  | "erc721"
  | "erc1155"
  | "specialnft";

export type AlchemyLogTopic =
  | string
  | null
  | readonly string[];

export interface AlchemySimulationTransaction {
  from: string;
  to: string;
  value?: string;
  data?: string;
  gas?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export type AlchemyInternalOperation =
  | {
      operation: "balance";
      address: string;
      block?: AlchemyReadBlockTag | string;
    }
  | {
      operation: "receipt";
      transactionHash: string;
    }
  | {
      operation: "logs";
      fromBlock: string;
      toBlock: string;
      address?: string | readonly string[];
      topics?: readonly AlchemyLogTopic[];
    }
  | {
      operation: "transfers";
      fromBlock: string;
      toBlock: string;
      category: readonly AlchemyTransferCategory[];
      fromAddress?: string;
      toAddress?: string;
      contractAddresses?: readonly string[];
      excludeZeroValue?: boolean;
      withMetadata?: boolean;
      order?: "asc" | "desc";
      maxCount?: number;
      pageKey?: string;
    }
  | {
      operation: "simulate_asset_changes";
      transaction: AlchemySimulationTransaction;
    }
  | {
      operation: "simulate_execution";
      transaction: AlchemySimulationTransaction;
      blockTag?: AlchemySimulationBlockTag;
    };

export type AlchemyJson =
  | null
  | boolean
  | number
  | string
  | AlchemyJson[]
  | { [key: string]: AlchemyJson };

export interface AlchemyInternalResult {
  provider: "alchemy";
  operation: AlchemyInternalOperationName;
  chain: EvmChain;
  network: ActiveNetwork;
  kind: "read" | "simulation";
  finality: "not_established";
  stateChanged: false;
  endpoint: {
    origin: string;
    path: "/v2";
  };
  simulationDeprecationDate?: typeof ALCHEMY_SIMULATION_DEPRECATION_DATE;
  result: AlchemyJson;
}

export interface AlchemyInternalAdapter {
  execute(operation: AlchemyInternalOperation): Promise<AlchemyInternalResult>;
}

export interface AlchemyInternalAdapterOptions {
  apiKey: string;
  chain: EvmChain;
  network: ActiveNetwork;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export type AlchemyInternalAdapterErrorCode =
  | "invalid_configuration"
  | "invalid_operation"
  | "request_too_large"
  | "timeout"
  | "transport_unavailable"
  | "provider_http_error"
  | "provider_rpc_error"
  | "response_too_large"
  | "invalid_response";

const ERROR_MESSAGES: Record<AlchemyInternalAdapterErrorCode, string> = {
  invalid_configuration:
    "Alchemy internal adapter configuration is invalid.",
  invalid_operation:
    "Alchemy internal operation is invalid or outside the closed allowlist.",
  request_too_large:
    "Alchemy internal request exceeds the local size boundary.",
  timeout:
    "Alchemy internal request exceeded its local deadline.",
  transport_unavailable:
    "Alchemy internal transport is unavailable.",
  provider_http_error:
    "Alchemy returned a non-success HTTP response.",
  provider_rpc_error:
    "Alchemy returned a JSON-RPC error.",
  response_too_large:
    "Alchemy response exceeds the local size boundary.",
  invalid_response:
    "Alchemy returned an invalid or mismatched response.",
};

export class AlchemyInternalAdapterError extends Error {
  readonly code: AlchemyInternalAdapterErrorCode;
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(
    code: AlchemyInternalAdapterErrorCode,
    options: { retryable?: boolean; status?: number | null } = {},
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = "AlchemyInternalAdapterError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? null;
  }
}

interface ValidatedAdapterConfig {
  apiKey: string;
  chain: EvmChain;
  network: ActiveNetwork;
  endpoint: string;
  origin: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maxResponseBytes: number;
}

type AllowedRpcMethod =
  (typeof ALCHEMY_INTERNAL_RPC_METHODS)[AlchemyInternalOperationName];

interface RpcPlan {
  operation: AlchemyInternalOperationName;
  kind: "read" | "simulation";
  method: AllowedRpcMethod;
  params: AlchemyJson[];
  maxTransferResults?: number;
  receiptHash?: string;
}

function adapterError(
  code: AlchemyInternalAdapterErrorCode,
  options?: { retryable?: boolean; status?: number | null },
): AlchemyInternalAdapterError {
  return new AlchemyInternalAdapterError(code, options);
}

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw adapterError("invalid_operation");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw adapterError("invalid_operation");
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const keys = Reflect.ownKeys(record);
  if (
    keys.some(
      (key) => typeof key !== "string" || !allowed.includes(key),
    )
  ) {
    throw adapterError("invalid_operation");
  }
}

function validAddress(value: unknown): string {
  if (typeof value !== "string" || !isAddress(value)) {
    throw adapterError("invalid_operation");
  }
  return value;
}

function canonicalHexQuantity(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 66 ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)
  ) {
    throw adapterError("invalid_operation");
  }
  return value.toLowerCase();
}

function canonicalBlockNumber(value: unknown): {
  encoded: string;
  number: bigint;
} {
  const encoded = canonicalHexQuantity(value);
  // A uint64 local cap is far above current EVM block heights and keeps range
  // arithmetic bounded even if a caller supplies an adversarial quantity.
  if (encoded.length > 18) {
    throw adapterError("invalid_operation");
  }
  return { encoded, number: BigInt(encoded) };
}

function validateInclusiveRange(
  fromValue: unknown,
  toValue: unknown,
  maximumBlocks: number,
): { fromBlock: string; toBlock: string } {
  const from = canonicalBlockNumber(fromValue);
  const to = canonicalBlockNumber(toValue);
  if (
    to.number < from.number ||
    to.number - from.number + 1n > BigInt(maximumBlocks)
  ) {
    throw adapterError("invalid_operation");
  }
  return { fromBlock: from.encoded, toBlock: to.encoded };
}

function balanceBlock(value: unknown): string {
  if (value === undefined) return "latest";
  if (
    isOneOf(value, [
      "latest",
      "safe",
      "finalized",
      "earliest",
      "pending",
    ] as const)
  ) {
    return value;
  }
  if (
    typeof value === "string" &&
    /^0x[0-9a-f]{64}$/i.test(value)
  ) {
    return value.toLowerCase();
  }
  return canonicalBlockNumber(value).encoded;
}

function transactionHash(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-f]{64}$/i.test(value)
  ) {
    throw adapterError("invalid_operation");
  }
  return value.toLowerCase();
}

function addressList(
  value: unknown,
  options: { optional: boolean },
): string[] | undefined {
  if (value === undefined && options.optional) return undefined;
  const candidates = Array.isArray(value) ? value : [value];
  if (candidates.length < 1 || candidates.length > MAX_ADDRESSES) {
    throw adapterError("invalid_operation");
  }
  return candidates.map(validAddress);
}

function logTopics(value: unknown): AlchemyJson[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 4) {
    throw adapterError("invalid_operation");
  }
  return value.map((candidate) => {
    if (candidate === null) return null;
    const alternatives = Array.isArray(candidate)
      ? candidate
      : [candidate];
    if (alternatives.length < 1 || alternatives.length > MAX_ADDRESSES) {
      throw adapterError("invalid_operation");
    }
    const normalized = alternatives.map((topic) => {
      if (
        typeof topic !== "string" ||
        !/^0x[0-9a-f]{64}$/i.test(topic)
      ) {
        throw adapterError("invalid_operation");
      }
      return topic.toLowerCase();
    });
    return Array.isArray(candidate) ? normalized : normalized[0]!;
  });
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw adapterError("invalid_operation");
  }
  return value;
}

function optionalAddress(value: unknown): string | undefined {
  return value === undefined ? undefined : validAddress(value);
}

function simulationTransaction(value: unknown): AlchemyJson {
  const record = plainRecord(value);
  requireExactKeys(record, [
    "from",
    "to",
    "value",
    "data",
    "gas",
    "gasPrice",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
  ]);

  const output: Record<string, AlchemyJson> = {
    from: validAddress(record.from),
    to: validAddress(record.to),
  };

  for (const field of [
    "value",
    "gas",
    "gasPrice",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
  ] as const) {
    if (record[field] !== undefined) {
      output[field] = canonicalHexQuantity(record[field]);
    }
  }

  if (record.data !== undefined) {
    if (
      typeof record.data !== "string" ||
      !/^0x(?:[0-9a-f]{2})*$/i.test(record.data) ||
      (record.data.length - 2) / 2 > MAX_CALLDATA_BYTES
    ) {
      throw adapterError("invalid_operation");
    }
    output.data = record.data.toLowerCase();
  }

  return output;
}

function buildRpcPlan(value: unknown): RpcPlan {
  const input = plainRecord(value);
  if (
    !isOneOf(
      input.operation,
      Object.keys(ALCHEMY_INTERNAL_RPC_METHODS) as AlchemyInternalOperationName[],
    )
  ) {
    throw adapterError("invalid_operation");
  }

  switch (input.operation) {
    case "balance": {
      requireExactKeys(input, ["operation", "address", "block"]);
      return {
        operation: input.operation,
        kind: "read",
        method: ALCHEMY_INTERNAL_RPC_METHODS.balance,
        params: [validAddress(input.address), balanceBlock(input.block)],
      };
    }

    case "receipt": {
      requireExactKeys(input, ["operation", "transactionHash"]);
      const hash = transactionHash(input.transactionHash);
      return {
        operation: input.operation,
        kind: "read",
        method: ALCHEMY_INTERNAL_RPC_METHODS.receipt,
        params: [hash],
        receiptHash: hash,
      };
    }

    case "logs": {
      requireExactKeys(input, [
        "operation",
        "fromBlock",
        "toBlock",
        "address",
        "topics",
      ]);
      const range = validateInclusiveRange(
        input.fromBlock,
        input.toBlock,
        ALCHEMY_INTERNAL_LOG_BLOCKS,
      );
      const addresses = addressList(input.address, { optional: true });
      const topics = logTopics(input.topics);
      if (!addresses && !topics?.some((topic) => topic !== null)) {
        throw adapterError("invalid_operation");
      }
      const filter: Record<string, AlchemyJson> = { ...range };
      if (addresses) {
        filter.address = Array.isArray(input.address)
          ? addresses
          : addresses[0]!;
      }
      if (topics) filter.topics = topics;
      return {
        operation: input.operation,
        kind: "read",
        method: ALCHEMY_INTERNAL_RPC_METHODS.logs,
        params: [filter],
      };
    }

    case "transfers": {
      requireExactKeys(input, [
        "operation",
        "fromBlock",
        "toBlock",
        "category",
        "fromAddress",
        "toAddress",
        "contractAddresses",
        "excludeZeroValue",
        "withMetadata",
        "order",
        "maxCount",
        "pageKey",
      ]);
      const range = validateInclusiveRange(
        input.fromBlock,
        input.toBlock,
        ALCHEMY_INTERNAL_TRANSFER_BLOCKS,
      );
      if (
        !Array.isArray(input.category) ||
        input.category.length < 1 ||
        input.category.length > 6 ||
        new Set(input.category).size !== input.category.length ||
        input.category.some(
          (category) =>
            !isOneOf(category, [
              "external",
              "internal",
              "erc20",
              "erc721",
              "erc1155",
              "specialnft",
            ] as const),
        )
      ) {
        throw adapterError("invalid_operation");
      }
      const fromAddress = optionalAddress(input.fromAddress);
      const toAddress = optionalAddress(input.toAddress);
      const contractAddresses = addressList(input.contractAddresses, {
        optional: true,
      });
      if (!fromAddress && !toAddress && !contractAddresses) {
        throw adapterError("invalid_operation");
      }
      const maxCount =
        input.maxCount === undefined
          ? MAX_TRANSFER_RESULTS
          : typeof input.maxCount === "number"
            ? input.maxCount
            : Number.NaN;
      if (
        !Number.isSafeInteger(maxCount) ||
        maxCount < 1 ||
        maxCount > MAX_TRANSFER_RESULTS
      ) {
        throw adapterError("invalid_operation");
      }
      if (
        input.order !== undefined &&
        input.order !== "asc" &&
        input.order !== "desc"
      ) {
        throw adapterError("invalid_operation");
      }
      if (
        input.pageKey !== undefined &&
        (typeof input.pageKey !== "string" ||
          new TextEncoder().encode(input.pageKey).byteLength >
            MAX_PAGE_KEY_BYTES ||
          !/^[\x21-\x7e]+$/.test(input.pageKey))
      ) {
        throw adapterError("invalid_operation");
      }

      const params: Record<string, AlchemyJson> = {
        ...range,
        category: [...input.category] as AlchemyTransferCategory[],
        maxCount: `0x${maxCount.toString(16)}`,
        excludeZeroValue:
          optionalBoolean(input.excludeZeroValue) ?? true,
        withMetadata: optionalBoolean(input.withMetadata) ?? false,
      };
      if (fromAddress) params.fromAddress = fromAddress;
      if (toAddress) params.toAddress = toAddress;
      if (contractAddresses) params.contractAddresses = contractAddresses;
      if (input.order) params.order = input.order;
      if (input.pageKey) params.pageKey = input.pageKey;

      return {
        operation: input.operation,
        kind: "read",
        method: ALCHEMY_INTERNAL_RPC_METHODS.transfers,
        params: [params],
        maxTransferResults: maxCount,
      };
    }

    case "simulate_asset_changes": {
      requireExactKeys(input, ["operation", "transaction"]);
      return {
        operation: input.operation,
        kind: "simulation",
        method: ALCHEMY_INTERNAL_RPC_METHODS.simulate_asset_changes,
        params: [simulationTransaction(input.transaction)],
      };
    }

    case "simulate_execution": {
      requireExactKeys(input, ["operation", "transaction", "blockTag"]);
      const blockTag =
        input.blockTag === undefined ? "latest" : input.blockTag;
      if (
        !isOneOf(blockTag, [
          "latest",
          "safe",
          "finalized",
          "earliest",
        ] as const)
      ) {
        throw adapterError("invalid_operation");
      }
      // Current Alchemy reference order is [format, transaction, blockTag].
      // FLAT gives one stable top-level calls[]/logs[] response contract.
      return {
        operation: input.operation,
        kind: "simulation",
        method: ALCHEMY_INTERNAL_RPC_METHODS.simulate_execution,
        params: ["FLAT", simulationTransaction(input.transaction), blockTag],
      };
    }
  }
}

function validateAdapterConfig(
  options: AlchemyInternalAdapterOptions,
): ValidatedAdapterConfig {
  if (
    !options ||
    typeof options !== "object" ||
    typeof options.apiKey !== "string" ||
    options.apiKey.length < 8 ||
    options.apiKey.length > 2_048 ||
    options.apiKey.trim() !== options.apiKey ||
    !/^[\x21-\x7e]+$/.test(options.apiKey) ||
    !isOneOf(options.chain, EVM_CHAINS) ||
    !isOneOf(options.network, ACTIVE_NETWORKS) ||
    (options.fetchImpl !== undefined &&
      typeof options.fetchImpl !== "function")
  ) {
    throw adapterError("invalid_configuration");
  }

  const timeoutMs =
    options.timeoutMs ?? ALCHEMY_INTERNAL_DEFAULT_TIMEOUT_MS;
  const maxResponseBytes =
    options.maxResponseBytes ?? ALCHEMY_INTERNAL_DEFAULT_RESPONSE_BYTES;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > ALCHEMY_INTERNAL_MAX_TIMEOUT_MS ||
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes < 1 ||
    maxResponseBytes > ALCHEMY_INTERNAL_MAX_RESPONSE_BYTES
  ) {
    throw adapterError("invalid_configuration");
  }

  const endpoint = alchemyInternalEndpoint(options.chain, options.network);
  const parsed = new URL(endpoint);
  return {
    apiKey: options.apiKey,
    chain: options.chain,
    network: options.network,
    endpoint,
    origin: parsed.origin,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    timeoutMs,
    maxResponseBytes,
  };
}

/** Resolve only the ten explicitly supported HTTPS Alchemy Node API origins. */
export function alchemyInternalEndpoint(
  chain: EvmChain,
  network: ActiveNetwork,
): string {
  if (!isOneOf(chain, EVM_CHAINS) || !isOneOf(network, ACTIVE_NETWORKS)) {
    throw adapterError("invalid_configuration");
  }
  const host = ALCHEMY_HOSTS[chain][network];
  const endpoint = `https://${host}/v2`;
  const parsed = new URL(endpoint);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== host ||
    parsed.port !== "" ||
    parsed.pathname !== "/v2" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw adapterError("invalid_configuration");
  }
  return endpoint;
}

async function cancelBody(response: Response): Promise<void> {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // Cancellation is resource cleanup only; never replace the stable fault.
  }
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const declared = response.headers.get("content-length");
  if (
    declared &&
    /^\d+$/.test(declared) &&
    (declared.length > 16 || BigInt(declared) > BigInt(maximumBytes))
  ) {
    await cancelBody(response);
    throw adapterError("response_too_large");
  }
  if (!response.body) {
    throw adapterError("invalid_response");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;
      total += value.byteLength;
      if (
        total > maximumBytes ||
        chunks.length >= MAX_RESPONSE_CHUNKS
      ) {
        void reader.cancel().catch(() => undefined);
        throw adapterError("response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw adapterError("invalid_response");
  }
}

function responseRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw adapterError("invalid_response");
  }
  return value as Record<string, unknown>;
}

function validateProviderResult(
  plan: RpcPlan,
  result: unknown,
): AlchemyJson {
  switch (plan.operation) {
    case "balance":
      if (
        typeof result !== "string" ||
        !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(result)
      ) {
        throw adapterError("invalid_response");
      }
      return result.toLowerCase();

    case "receipt": {
      if (result === null) return null;
      const receipt = responseRecord(result);
      if (
        typeof receipt.transactionHash !== "string" ||
        receipt.transactionHash.toLowerCase() !== plan.receiptHash
      ) {
        throw adapterError("invalid_response");
      }
      return receipt as AlchemyJson;
    }

    case "logs":
      if (!Array.isArray(result)) {
        throw adapterError("invalid_response");
      }
      return result as AlchemyJson;

    case "transfers": {
      const transfers = responseRecord(result);
      if (
        !Array.isArray(transfers.transfers) ||
        transfers.transfers.length > (plan.maxTransferResults ?? 0) ||
        (transfers.pageKey !== undefined &&
          (typeof transfers.pageKey !== "string" ||
            new TextEncoder().encode(transfers.pageKey).byteLength >
              MAX_PAGE_KEY_BYTES))
      ) {
        throw adapterError("invalid_response");
      }
      return transfers as AlchemyJson;
    }

    case "simulate_asset_changes": {
      const simulation = responseRecord(result);
      if (!Array.isArray(simulation.changes)) {
        throw adapterError("invalid_response");
      }
      return simulation as AlchemyJson;
    }

    case "simulate_execution": {
      const simulation = responseRecord(result);
      if (
        !Array.isArray(simulation.calls) ||
        !Array.isArray(simulation.logs)
      ) {
        throw adapterError("invalid_response");
      }
      return simulation as AlchemyJson;
    }
  }
}

async function performRequest(
  config: ValidatedAdapterConfig,
  plan: RpcPlan,
  signal: AbortSignal,
): Promise<AlchemyJson> {
  const requestBody = JSON.stringify({
    jsonrpc: "2.0",
    id: JSON_RPC_ID,
    method: plan.method,
    params: plan.params,
  });
  if (
    new TextEncoder().encode(requestBody).byteLength >
    ALCHEMY_INTERNAL_MAX_REQUEST_BYTES
  ) {
    throw adapterError("request_too_large");
  }

  const response = await config.fetchImpl(config.endpoint, {
    method: "POST",
    redirect: "error",
    signal,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: requestBody,
  });

  if (!response.ok) {
    await cancelBody(response);
    throw adapterError("provider_http_error", {
      status: response.status,
      retryable:
        response.status === 408 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status >= 500,
    });
  }

  const rawBody = await readBoundedBody(
    response,
    config.maxResponseBytes,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw adapterError("invalid_response");
  }
  const envelope = responseRecord(parsed);
  if (
    envelope.jsonrpc !== "2.0" ||
    (envelope.id !== JSON_RPC_ID &&
      envelope.id !== String(JSON_RPC_ID))
  ) {
    throw adapterError("invalid_response");
  }
  if (envelope.error !== undefined && envelope.error !== null) {
    throw adapterError("provider_rpc_error");
  }
  if (!Object.prototype.hasOwnProperty.call(envelope, "result")) {
    throw adapterError("invalid_response");
  }
  return validateProviderResult(plan, envelope.result);
}

async function executePlan(
  config: ValidatedAdapterConfig,
  plan: RpcPlan,
): Promise<AlchemyInternalResult> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(adapterError("timeout", { retryable: true }));
    }, config.timeoutMs);
  });

  const work = performRequest(config, plan, controller.signal);
  let result: AlchemyJson;
  try {
    result = await Promise.race([work, deadline]);
  } catch (error) {
    if (error instanceof AlchemyInternalAdapterError) throw error;
    if (timedOut || controller.signal.aborted) {
      throw adapterError("timeout", { retryable: true });
    }
    throw adapterError("transport_unavailable", { retryable: true });
  } finally {
    if (timer) clearTimeout(timer);
  }

  return {
    provider: "alchemy",
    operation: plan.operation,
    chain: config.chain,
    network: config.network,
    kind: plan.kind,
    finality: "not_established",
    stateChanged: false,
    endpoint: {
      origin: config.origin,
      path: "/v2",
    },
    ...(plan.kind === "simulation"
      ? {
          simulationDeprecationDate:
            ALCHEMY_SIMULATION_DEPRECATION_DATE,
        }
      : {}),
    result,
  };
}

export function createAlchemyInternalAdapter(
  options: AlchemyInternalAdapterOptions,
): AlchemyInternalAdapter {
  let config: ValidatedAdapterConfig;
  try {
    config = validateAdapterConfig(options);
  } catch (error) {
    if (error instanceof AlchemyInternalAdapterError) throw error;
    throw adapterError("invalid_configuration");
  }
  return Object.freeze({
    async execute(
      operation: AlchemyInternalOperation,
    ): Promise<AlchemyInternalResult> {
      let plan: RpcPlan;
      try {
        plan = buildRpcPlan(operation);
      } catch (error) {
        if (error instanceof AlchemyInternalAdapterError) throw error;
        throw adapterError("invalid_operation");
      }
      return executePlan(config, plan);
    },
  });
}
