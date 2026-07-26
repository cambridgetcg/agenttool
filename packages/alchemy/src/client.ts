/**
 * Closed Alchemy observation client.
 *
 * Credentials, endpoint selection, signing, broadcasting, provider
 * administration, and webhook mutation remain outside this package.
 *
 * Doctrine: docs/ALCHEMY.md.
 */

import { AlchemyReadError } from "./errors.js";
import { getAlchemyNetwork } from "./networks.js";
import type {
  AlchemyAssetTransfer,
  AlchemyAssetTransfersRpcParams,
  AlchemyNetwork,
  AlchemyReadCallOptions,
  AlchemyReadCall,
  AlchemyReadClient,
  AlchemyTransferCategory,
  AlchemyTransportRequest,
  AlchemyTransportResponse,
  AssetTransfersPageObservation,
  AssetTransfersQuery,
  BalanceObservation,
  BlockNumberObservation,
  BlockObservation,
  ChainIdObservation,
  CodeObservation,
  CreateAlchemyReadClientOptions,
  Erc1155TransferValue,
  EvmBlock,
  EvmBlockReference,
  EvmTransaction,
  EvmTransactionReceipt,
  GetBalanceInput,
  GetBlockInput,
  GetCodeInput,
  GetTransactionInput,
  HexQuantity,
  NormalizedAssetTransfersQuery,
  ObservationFreshness,
  ObservationProvenance,
  TransactionObservation,
  TransactionReceiptObservation,
} from "./types.js";
import {
  assertExactInputKeys,
  assertExactResponseKeys,
  invalidInput,
  invalidResponse,
  normalizeAddress,
  normalizeBlockReference,
  normalizeHash,
  normalizeHexQuantity,
  parseAddress,
  parseHash,
  parseHexData,
  parseHexQuantity,
  parsePaddedHexQuantity,
  parseNullableAddress,
  parseNullableHash,
  quantityToDecimal,
  requireBoundedResponseString,
  requireInputInteger,
  requireInputRecord,
  requireResponseInteger,
  requireResponseRecord,
  utf8Bytes,
} from "./validation.js";

export const MAX_ALCHEMY_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_ALCHEMY_CODE_BYTES = 512 * 1024;
export const MAX_ALCHEMY_TRANSACTION_INPUT_BYTES = 128 * 1024;
export const MAX_ALCHEMY_CALL_DURATION_MS = 30_000;
export const MAX_ALCHEMY_TRANSFER_PAGE_SIZE = 100;
export const MAX_ALCHEMY_TRANSFER_BLOCK_SPAN = 100_000;
export const MAX_ALCHEMY_TRANSFER_CONTRACTS = 20;

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TRANSFER_CURSOR_BYTES = 1_024;
const MAX_TRANSFER_ID_BYTES = 256;
const MAX_BLOCK_TRANSACTIONS = 20_000;
const MAX_RECEIPT_LOGS = 10_000;
const MAX_ERC1155_VALUES_PER_TRANSFER = 100;
const MAX_JSON_RESULT_DEPTH = 64;
const MAX_JSON_RESULT_NODES = 100_000;
const MAX_TRANSPORT_AUDIT_ID_BYTES = 128;
const TRANSFER_CURSOR_PATTERN = /^[A-Za-z0-9._~+/=-]+$/;
const TRANSFER_ID_PATTERN = /^[A-Za-z0-9:._~-]+$/;
const TRANSPORT_AUDIT_ID_PATTERN = /^[A-Za-z0-9:._~-]+$/;
const INTERNAL_TRANSFER_NETWORKS: ReadonlySet<AlchemyNetwork> = new Set([
  "ethereum-mainnet",
  "polygon-mainnet",
]);
const CONTRACT_FILTER_CATEGORIES: ReadonlySet<AlchemyTransferCategory> =
  new Set(["erc20", "erc721", "erc1155"]);
const TRANSFER_CATEGORIES: readonly AlchemyTransferCategory[] = [
  "external",
  "internal",
  "erc20",
  "erc721",
  "erc1155",
  "specialnft",
];
const TRANSFER_CATEGORY_SET = new Set<string>(TRANSFER_CATEGORIES);

interface InvocationResult {
  readonly result: unknown;
  readonly provenance: ObservationProvenance;
}

class DeadlineSignal extends Error {}

function freezeCall(call: AlchemyReadCall): AlchemyReadCall {
  Object.freeze(call.params);
  return Object.freeze(call);
}

function jsonResultBytes(value: unknown): number {
  const stack: Array<{ value: unknown; depth: number }> = [
    { value, depth: 0 },
  ];
  const seen = new Set<object>();
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      return invalidResponse();
    }
    nodes += 1;
    if (
      nodes > MAX_JSON_RESULT_NODES ||
      current.depth > MAX_JSON_RESULT_DEPTH
    ) {
      return invalidResponse();
    }
    const item = current.value;
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "boolean"
    ) {
      continue;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) {
        return invalidResponse();
      }
      continue;
    }
    if (typeof item !== "object") {
      return invalidResponse();
    }
    if (seen.has(item)) {
      return invalidResponse();
    }
    seen.add(item);
    if (Array.isArray(item)) {
      for (const child of item) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
      continue;
    }
    const record = requireResponseRecord(item);
    for (const key of Reflect.ownKeys(record)) {
      if (typeof key !== "string") {
        return invalidResponse();
      }
      stack.push({
        value: record[key],
        depth: current.depth + 1,
      });
    }
  }

  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return invalidResponse();
  }
  if (encoded === undefined) {
    return invalidResponse();
  }
  const bytes = utf8Bytes(encoded);
  if (bytes > MAX_ALCHEMY_RESPONSE_BYTES) {
    throw new AlchemyReadError("response_too_large");
  }
  return bytes;
}

function blockFreshness(
  block: string,
  source: "live-rpc" | "alchemy-index" = "live-rpc",
): ObservationFreshness {
  if (source === "alchemy-index") {
    return {
      source,
      state: "indexed",
      blockReference: block,
      finalityEvidence: "unknown",
      indexLagPossible: true,
      caveat:
        "Alchemy indexed results may lag the chain and do not independently prove finality.",
    };
  }
  if (block === "latest") {
    return {
      source,
      state: "provider-head",
      blockReference: block,
      finalityEvidence: "none",
      indexLagPossible: false,
      caveat:
        "A provider head observation can change during a reorganization and is not finality proof.",
    };
  }
  if (block === "safe") {
    return {
      source,
      state: "provider-safe-tag",
      blockReference: block,
      finalityEvidence: "provider-asserted-safe",
      indexLagPossible: false,
      caveat:
        "The safe tag is a provider assertion and was not independently verified.",
    };
  }
  if (block === "finalized") {
    return {
      source,
      state: "provider-finalized-tag",
      blockReference: block,
      finalityEvidence: "provider-asserted-finalized",
      indexLagPossible: false,
      caveat:
        "The finalized tag is a provider assertion and was not independently verified.",
    };
  }
  return {
    source,
    state: "historical",
    blockReference: block,
    finalityEvidence: "unknown",
    indexLagPossible: false,
    caveat:
      "A numbered block observation has unknown finality without independent head and reorg evidence.",
  };
}

function pendingFreshness(): ObservationFreshness {
  return {
    source: "live-rpc",
    state: "pending",
    blockReference: "unmined",
    finalityEvidence: "none",
    indexLagPossible: false,
    caveat:
      "The transaction is not in an observed block and can disappear or be replaced.",
  };
}

function parseBlock(value: unknown): EvmBlock | null {
  if (value === null) {
    return null;
  }
  const block = requireResponseRecord(value);
  const numberHex = parseHexQuantity(block.number);
  const timestampHex = parseHexQuantity(block.timestamp);
  if (!Array.isArray(block.transactions)) {
    return invalidResponse();
  }
  if (block.transactions.length > MAX_BLOCK_TRANSACTIONS) {
    return invalidResponse();
  }
  for (const transactionHash of block.transactions) {
    parseHash(transactionHash);
  }
  return {
    hash: parseHash(block.hash),
    parentHash: parseHash(block.parentHash),
    number: quantityToDecimal(numberHex),
    numberHex,
    timestamp: quantityToDecimal(timestampHex),
    timestampHex,
    transactionCount: block.transactions.length,
  };
}

function parseTransaction(value: unknown): EvmTransaction | null {
  if (value === null) {
    return null;
  }
  const transaction = requireResponseRecord(value);
  const blockHash = parseNullableHash(transaction.blockHash);
  const blockNumberHex =
    transaction.blockNumber === null
      ? null
      : parseHexQuantity(transaction.blockNumber);
  const transactionIndexHex =
    transaction.transactionIndex === null
      ? null
      : parseHexQuantity(transaction.transactionIndex);
  const minedFields = [blockHash, blockNumberHex, transactionIndexHex];
  if (
    minedFields.some((field) => field === null) &&
    minedFields.some((field) => field !== null)
  ) {
    return invalidResponse();
  }
  const nonceHex = parseHexQuantity(transaction.nonce);
  const valueHex = parseHexQuantity(transaction.value);
  const input = parseHexData(
    transaction.input,
    MAX_ALCHEMY_TRANSACTION_INPUT_BYTES,
  );
  return {
    hash: parseHash(transaction.hash),
    from: parseAddress(transaction.from),
    to: parseNullableAddress(transaction.to),
    blockHash,
    blockNumber:
      blockNumberHex === null ? null : quantityToDecimal(blockNumberHex),
    blockNumberHex,
    transactionIndex:
      transactionIndexHex === null
        ? null
        : quantityToDecimal(transactionIndexHex),
    transactionIndexHex,
    nonce: quantityToDecimal(nonceHex),
    nonceHex,
    valueWei: quantityToDecimal(valueHex),
    valueHex,
    input: input.value,
    inputBytes: input.bytes,
  };
}

function parseReceipt(value: unknown): EvmTransactionReceipt | null {
  if (value === null) {
    return null;
  }
  const receipt = requireResponseRecord(value);
  const blockNumberHex = parseHexQuantity(receipt.blockNumber);
  const transactionIndexHex = parseHexQuantity(receipt.transactionIndex);
  const gasUsedHex = parseHexQuantity(receipt.gasUsed);
  const cumulativeGasUsedHex = parseHexQuantity(receipt.cumulativeGasUsed);
  let effectiveGasPriceHex: HexQuantity | null = null;
  if (
    receipt.effectiveGasPrice !== undefined &&
    receipt.effectiveGasPrice !== null
  ) {
    effectiveGasPriceHex = parseHexQuantity(receipt.effectiveGasPrice);
  }
  let status: "success" | "reverted" | null = null;
  if (receipt.status !== undefined && receipt.status !== null) {
    const statusHex = parseHexQuantity(receipt.status);
    if (statusHex === "0x1") {
      status = "success";
    } else if (statusHex === "0x0") {
      status = "reverted";
    } else {
      return invalidResponse();
    }
  }
  if (!Array.isArray(receipt.logs) || receipt.logs.length > MAX_RECEIPT_LOGS) {
    return invalidResponse();
  }
  return {
    transactionHash: parseHash(receipt.transactionHash),
    blockHash: parseHash(receipt.blockHash),
    blockNumber: quantityToDecimal(blockNumberHex),
    blockNumberHex,
    transactionIndex: quantityToDecimal(transactionIndexHex),
    transactionIndexHex,
    from: parseAddress(receipt.from),
    to: parseNullableAddress(receipt.to),
    contractAddress: parseNullableAddress(receipt.contractAddress),
    status,
    gasUsed: quantityToDecimal(gasUsedHex),
    gasUsedHex,
    cumulativeGasUsed: quantityToDecimal(cumulativeGasUsedHex),
    cumulativeGasUsedHex,
    effectiveGasPriceWei:
      effectiveGasPriceHex === null
        ? null
        : quantityToDecimal(effectiveGasPriceHex),
    effectiveGasPriceHex,
    logsCount: receipt.logs.length,
  };
}

function normalizeTransferCategory(value: unknown): AlchemyTransferCategory {
  if (typeof value !== "string" || !TRANSFER_CATEGORY_SET.has(value)) {
    return invalidInput();
  }
  return value as AlchemyTransferCategory;
}

function parseTransferCategory(value: unknown): AlchemyTransferCategory {
  if (typeof value !== "string" || !TRANSFER_CATEGORY_SET.has(value)) {
    return invalidResponse();
  }
  return value as AlchemyTransferCategory;
}

function normalizePageKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    utf8Bytes(value) > MAX_TRANSFER_CURSOR_BYTES ||
    !TRANSFER_CURSOR_PATTERN.test(value)
  ) {
    return invalidInput();
  }
  return value;
}

function parsePageKey(value: unknown): string {
  const pageKey = requireBoundedResponseString(
    value,
    MAX_TRANSFER_CURSOR_BYTES,
  );
  if (!TRANSFER_CURSOR_PATTERN.test(pageKey)) {
    return invalidResponse();
  }
  return pageKey;
}

function normalizeTransfersQuery(
  value: unknown,
): {
  readonly params: AlchemyAssetTransfersRpcParams;
  readonly pageSize: number;
  readonly categories: ReadonlySet<AlchemyTransferCategory>;
  readonly query: NormalizedAssetTransfersQuery;
} {
  const query = requireInputRecord(value);
  assertExactInputKeys(query, [
    "fromBlock",
    "toBlock",
    "categories",
    "fromAddress",
    "toAddress",
    "contractAddresses",
    "excludeZeroValue",
    "pageSize",
    "pageKey",
  ]);
  const fromBlock = normalizeHexQuantity(query.fromBlock);
  let toBlock: HexQuantity | "latest" | "indexed";
  if (query.toBlock === "latest" || query.toBlock === "indexed") {
    toBlock = query.toBlock;
  } else {
    toBlock = normalizeHexQuantity(query.toBlock);
    const start = BigInt(fromBlock);
    const end = BigInt(toBlock);
    if (
      end < start ||
      end - start > BigInt(MAX_ALCHEMY_TRANSFER_BLOCK_SPAN)
    ) {
      return invalidInput();
    }
  }
  if (!Array.isArray(query.categories) || query.categories.length === 0) {
    return invalidInput();
  }
  const category = query.categories.map(normalizeTransferCategory);
  if (category.length > TRANSFER_CATEGORIES.length) {
    return invalidInput();
  }
  const categorySet = new Set(category);
  if (categorySet.size !== category.length) {
    return invalidInput();
  }

  const fromAddress =
    query.fromAddress === undefined
      ? undefined
      : normalizeAddress(query.fromAddress);
  const toAddress =
    query.toAddress === undefined
      ? undefined
      : normalizeAddress(query.toAddress);

  let contractAddresses: readonly ReturnType<typeof normalizeAddress>[] | undefined;
  if (query.contractAddresses !== undefined) {
    if (
      !Array.isArray(query.contractAddresses) ||
      query.contractAddresses.length === 0 ||
      query.contractAddresses.length > MAX_ALCHEMY_TRANSFER_CONTRACTS
    ) {
      return invalidInput();
    }
    const normalized = query.contractAddresses.map(normalizeAddress);
    if (new Set(normalized).size !== normalized.length) {
      return invalidInput();
    }
    contractAddresses = Object.freeze(normalized);
  }
  if (
    fromAddress === undefined &&
    toAddress === undefined &&
    contractAddresses === undefined
  ) {
    return invalidInput();
  }
  if (
    fromAddress === undefined &&
    toAddress === undefined &&
    category.some(
      (transferCategory) =>
        !CONTRACT_FILTER_CATEGORIES.has(transferCategory),
    )
  ) {
    return invalidInput();
  }

  const pageSize =
    query.pageSize === undefined
      ? MAX_ALCHEMY_TRANSFER_PAGE_SIZE
      : requireInputInteger(
          query.pageSize,
          1,
          MAX_ALCHEMY_TRANSFER_PAGE_SIZE,
        );
  if (
    query.excludeZeroValue !== undefined &&
    typeof query.excludeZeroValue !== "boolean"
  ) {
    return invalidInput();
  }
  const pageKey =
    query.pageKey === undefined ? undefined : normalizePageKey(query.pageKey);

  const params: AlchemyAssetTransfersRpcParams = {
    fromBlock,
    toBlock,
    category: Object.freeze(category),
    excludeZeroValue: query.excludeZeroValue ?? true,
    withMetadata: false,
    maxCount: `0x${pageSize.toString(16)}`,
    ...(fromAddress === undefined ? {} : { fromAddress }),
    ...(toAddress === undefined ? {} : { toAddress }),
    ...(contractAddresses === undefined ? {} : { contractAddresses }),
    ...(pageKey === undefined ? {} : { pageKey }),
  };
  return {
    params: Object.freeze(params),
    pageSize,
    categories: categorySet,
    query: Object.freeze({
      fromBlock,
      toBlock,
      categories: params.category,
      fromAddress: fromAddress ?? null,
      toAddress: toAddress ?? null,
      contractAddresses: contractAddresses ?? Object.freeze([]),
      excludeZeroValue: params.excludeZeroValue,
      pageSize,
      pageKey: pageKey ?? null,
    }),
  };
}

function parseTransfer(
  value: unknown,
  requestedCategories: ReadonlySet<AlchemyTransferCategory>,
): AlchemyAssetTransfer {
  const transfer = requireResponseRecord(value);
  const category = parseTransferCategory(transfer.category);
  if (!requestedCategories.has(category)) {
    return invalidResponse();
  }
  const rawContract =
    transfer.rawContract === null || transfer.rawContract === undefined
      ? null
      : requireResponseRecord(transfer.rawContract);
  const contractAddress =
    rawContract === null ||
    rawContract.address === null ||
    rawContract.address === undefined
      ? null
      : parseAddress(rawContract.address);
  const rawValueHex =
    rawContract === null ||
    rawContract.value === null ||
    rawContract.value === undefined
      ? null
      : parsePaddedHexQuantity(rawContract.value);
  const tokenIdValue =
    transfer.erc721TokenId ?? transfer.tokenId ?? null;
  let tokenId: HexQuantity | null = null;
  if (tokenIdValue !== null) {
    tokenId = parsePaddedHexQuantity(tokenIdValue);
  }
  let erc1155Values: readonly Erc1155TransferValue[] = [];
  if (
    transfer.erc1155Metadata !== null &&
    transfer.erc1155Metadata !== undefined
  ) {
    if (
      !Array.isArray(transfer.erc1155Metadata) ||
      transfer.erc1155Metadata.length === 0 ||
      transfer.erc1155Metadata.length > MAX_ERC1155_VALUES_PER_TRANSFER
    ) {
      return invalidResponse();
    }
    erc1155Values = Object.freeze(
      transfer.erc1155Metadata.map((item) => {
        const metadata = requireResponseRecord(item);
        assertExactResponseKeys(metadata, ["tokenId", "value"]);
        return Object.freeze({
          tokenId: parsePaddedHexQuantity(metadata.tokenId),
          valueHex: parsePaddedHexQuantity(metadata.value),
        });
      }),
    );
  }
  if (
    (category === "erc721" && tokenId === null) ||
    (category !== "erc721" &&
      category !== "specialnft" &&
      tokenId !== null) ||
    (category === "erc1155" && erc1155Values.length === 0) ||
    (category !== "erc1155" && erc1155Values.length !== 0)
  ) {
    return invalidResponse();
  }
  const blockNumberHex = parseHexQuantity(transfer.blockNum);
  const transferId = requireBoundedResponseString(
    transfer.uniqueId,
    MAX_TRANSFER_ID_BYTES,
  );
  if (!TRANSFER_ID_PATTERN.test(transferId)) {
    return invalidResponse();
  }
  return {
    transferId,
    transactionHash: parseHash(transfer.hash),
    blockNumber: quantityToDecimal(blockNumberHex),
    blockNumberHex,
    from: parseAddress(transfer.from),
    to: parseNullableAddress(transfer.to),
    category,
    contractAddress,
    rawValueHex,
    tokenId,
    erc1155Values,
  };
}

class ReadClient implements AlchemyReadClient {
  readonly #network: AlchemyNetwork;
  readonly #configuredChainId: number;
  readonly #configuredCaip2: `eip155:${string}`;
  readonly #transport: CreateAlchemyReadClientOptions["transport"];
  readonly #defaultTimeoutMs: number;
  readonly #now: () => number;
  #requestId = 0;

  constructor(options: CreateAlchemyReadClientOptions) {
    const input = requireInputRecord(options);
    assertExactInputKeys(input, [
      "network",
      "transport",
      "defaultTimeoutMs",
      "now",
    ]);
    let descriptor;
    try {
      descriptor = getAlchemyNetwork(options.network);
    } catch {
      invalidInput();
    }
    if (
      typeof options.transport !== "object" ||
      options.transport === null ||
      typeof options.transport.send !== "function"
    ) {
      invalidInput();
    }
    if (options.now !== undefined && typeof options.now !== "function") {
      invalidInput();
    }
    this.#network = descriptor.network;
    this.#configuredChainId = descriptor.chainId;
    this.#configuredCaip2 = descriptor.caip2;
    this.#transport = options.transport;
    this.#defaultTimeoutMs =
      options.defaultTimeoutMs === undefined
        ? DEFAULT_TIMEOUT_MS
        : requireInputInteger(
            options.defaultTimeoutMs,
            1,
            MAX_ALCHEMY_CALL_DURATION_MS,
          );
    this.#now = options.now ?? Date.now;
  }

  async #invoke(
    call: AlchemyReadCall,
    freshness: ObservationFreshness,
    options?: AlchemyReadCallOptions,
  ): Promise<InvocationResult> {
    const callOptions =
      options === undefined ? {} : requireInputRecord(options);
    assertExactInputKeys(callOptions, ["signal", "deadlineAtMs"]);
    const externalSignal = options?.signal;
    if (
      externalSignal !== undefined &&
      (typeof externalSignal !== "object" ||
        typeof externalSignal.aborted !== "boolean" ||
        typeof externalSignal.addEventListener !== "function" ||
        typeof externalSignal.removeEventListener !== "function")
    ) {
      return invalidInput();
    }
    if (externalSignal?.aborted === true) {
      throw new AlchemyReadError("aborted");
    }

    const requestedAtMs = this.#readClock();
    const maximumDeadline = requestedAtMs + MAX_ALCHEMY_CALL_DURATION_MS;
    const deadlineAtMs =
      options?.deadlineAtMs ??
      requestedAtMs + this.#defaultTimeoutMs;
    if (
      !Number.isSafeInteger(deadlineAtMs) ||
      deadlineAtMs <= requestedAtMs ||
      deadlineAtMs > maximumDeadline
    ) {
      return invalidInput();
    }

    const controller = new AbortController();
    let externallyAborted = false;
    let deadlineExpired = false;
    const onExternalAbort = (): void => {
      externallyAborted = true;
      controller.abort();
    };
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

    const timer = setTimeout(() => {
      deadlineExpired = true;
      controller.abort();
    }, deadlineAtMs - requestedAtMs);

    const operationId = this.#nextId();
    const request: AlchemyTransportRequest = Object.freeze({
      protocol: "agenttool.alchemy.transport/0.1",
      operationId,
      network: this.#network,
      chainId: this.#configuredCaip2,
      call: freezeCall(call),
      signal: controller.signal,
      deadlineAtMs,
      maxResponseBytes: MAX_ALCHEMY_RESPONSE_BYTES,
    });

    const abortPromise = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => {
          reject(new DeadlineSignal());
        },
        { once: true },
      );
    });
    let response: AlchemyTransportResponse;
    try {
      const transportPromise = Promise.resolve().then(() =>
        this.#transport.send(request),
      );
      response = await Promise.race([transportPromise, abortPromise]);
    } catch (error) {
      if (externallyAborted) {
        throw new AlchemyReadError("aborted");
      }
      if (deadlineExpired || error instanceof DeadlineSignal) {
        throw new AlchemyReadError("deadline_exceeded");
      }
      throw new AlchemyReadError("transport_failed");
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }

    const responseRecord = requireResponseRecord(response);
    assertExactResponseKeys(responseRecord, [
      "chainId",
      "method",
      "result",
      "auditId",
      "redactions",
    ]);
    if (!Object.hasOwn(responseRecord, "result")) {
      return invalidResponse();
    }
    if (response.chainId !== this.#configuredCaip2) {
      throw new AlchemyReadError("chain_mismatch");
    }
    if (response.method !== call.method) {
      return invalidResponse();
    }
    const hasAuditId = Object.hasOwn(responseRecord, "auditId");
    const hasRedactions = Object.hasOwn(responseRecord, "redactions");
    if (hasAuditId !== hasRedactions) {
      return invalidResponse();
    }
    let transportAuditId: string | null = null;
    let transportRedactions: number | null = null;
    if (hasAuditId && hasRedactions) {
      transportAuditId = requireBoundedResponseString(
        response.auditId,
        MAX_TRANSPORT_AUDIT_ID_BYTES,
      );
      if (!TRANSPORT_AUDIT_ID_PATTERN.test(transportAuditId)) {
        return invalidResponse();
      }
      transportRedactions = requireResponseInteger(
        response.redactions,
        0,
        1_000_000,
      );
    }
    const resultBytes = jsonResultBytes(response.result);
    const receivedAtMs = Math.max(requestedAtMs, this.#readClock());
    return {
      result: response.result,
      provenance: {
        provider: "alchemy",
        network: this.#network,
        configuredChainId: this.#configuredChainId,
        method: call.method,
        requestId: operationId,
        requestedAt: new Date(requestedAtMs).toISOString(),
        receivedAt: new Date(receivedAtMs).toISOString(),
        resultBytes,
        transportAuditId,
        transportRedactions,
        freshness,
      },
    };
  }

  #readClock(): number {
    const value = this.#now();
    if (!Number.isSafeInteger(value) || value < 0) {
      return invalidInput();
    }
    return value;
  }

  #nextId(): number {
    this.#requestId =
      this.#requestId >= Number.MAX_SAFE_INTEGER ? 1 : this.#requestId + 1;
    return this.#requestId;
  }

  async getChainId(
    options?: AlchemyReadCallOptions,
  ): Promise<ChainIdObservation> {
    const invocation = await this.#invoke(
      {
        method: "eth_chainId",
        params: [],
      },
      blockFreshness("latest"),
      options,
    );
    const chainIdHex = parseHexQuantity(invocation.result);
    const chainIdBigInt = BigInt(chainIdHex);
    if (
      chainIdBigInt > BigInt(Number.MAX_SAFE_INTEGER) ||
      Number(chainIdBigInt) !== this.#configuredChainId
    ) {
      throw new AlchemyReadError("chain_mismatch");
    }
    return {
      chainId: Number(chainIdBigInt),
      chainIdHex,
      provenance: invocation.provenance,
    };
  }

  async getBlockNumber(
    options?: AlchemyReadCallOptions,
  ): Promise<BlockNumberObservation> {
    const invocation = await this.#invoke(
      {
        method: "eth_blockNumber",
        params: [],
      },
      blockFreshness("latest"),
      options,
    );
    const blockNumberHex = parseHexQuantity(invocation.result);
    return {
      blockNumber: quantityToDecimal(blockNumberHex),
      blockNumberHex,
      provenance: invocation.provenance,
    };
  }

  async getBlock(
    input: GetBlockInput,
    options?: AlchemyReadCallOptions,
  ): Promise<BlockObservation> {
    const value = requireInputRecord(input);
    assertExactInputKeys(value, ["block"]);
    const block = normalizeBlockReference(value.block);
    const invocation = await this.#invoke(
      {
        method: "eth_getBlockByNumber",
        params: [block, false],
      },
      blockFreshness(block),
      options,
    );
    return {
      blockReference: block,
      block: parseBlock(invocation.result),
      provenance: invocation.provenance,
    };
  }

  async getBalance(
    input: GetBalanceInput,
    options?: AlchemyReadCallOptions,
  ): Promise<BalanceObservation> {
    const value = requireInputRecord(input);
    assertExactInputKeys(value, ["address", "block"]);
    const address = normalizeAddress(value.address);
    const block =
      value.block === undefined
        ? "latest"
        : normalizeBlockReference(value.block);
    const invocation = await this.#invoke(
      {
        method: "eth_getBalance",
        params: [address, block],
      },
      blockFreshness(block),
      options,
    );
    const balanceHex = parseHexQuantity(invocation.result);
    return {
      address,
      block,
      balanceWei: quantityToDecimal(balanceHex),
      balanceHex,
      provenance: invocation.provenance,
    };
  }

  async getTransaction(
    input: GetTransactionInput,
    options?: AlchemyReadCallOptions,
  ): Promise<TransactionObservation> {
    const value = requireInputRecord(input);
    assertExactInputKeys(value, ["transactionHash"]);
    const transactionHash = normalizeHash(value.transactionHash);
    const invocation = await this.#invoke(
      {
        method: "eth_getTransactionByHash",
        params: [transactionHash],
      },
      blockFreshness("latest"),
      options,
    );
    const transaction = parseTransaction(invocation.result);
    return {
      transactionHash,
      transaction,
      provenance:
        transaction?.blockNumberHex === null
          ? {
              ...invocation.provenance,
              freshness: pendingFreshness(),
            }
          : transaction === null
            ? invocation.provenance
            : {
                ...invocation.provenance,
                freshness: blockFreshness(transaction.blockNumberHex),
              },
    };
  }

  async getTransactionReceipt(
    input: GetTransactionInput,
    options?: AlchemyReadCallOptions,
  ): Promise<TransactionReceiptObservation> {
    const value = requireInputRecord(input);
    assertExactInputKeys(value, ["transactionHash"]);
    const transactionHash = normalizeHash(value.transactionHash);
    const invocation = await this.#invoke(
      {
        method: "eth_getTransactionReceipt",
        params: [transactionHash],
      },
      blockFreshness("latest"),
      options,
    );
    const receipt = parseReceipt(invocation.result);
    return {
      transactionHash,
      receipt,
      provenance:
        receipt === null
          ? invocation.provenance
          : {
              ...invocation.provenance,
              freshness: blockFreshness(receipt.blockNumberHex),
            },
    };
  }

  async getCode(
    input: GetCodeInput,
    options?: AlchemyReadCallOptions,
  ): Promise<CodeObservation> {
    const value = requireInputRecord(input);
    assertExactInputKeys(value, ["address", "block"]);
    const address = normalizeAddress(value.address);
    const block =
      value.block === undefined
        ? "latest"
        : normalizeBlockReference(value.block);
    const invocation = await this.#invoke(
      {
        method: "eth_getCode",
        params: [address, block],
      },
      blockFreshness(block),
      options,
    );
    const code = parseHexData(invocation.result, MAX_ALCHEMY_CODE_BYTES);
    return {
      address,
      block,
      code: code.value,
      codeBytes: code.bytes,
      provenance: invocation.provenance,
    };
  }

  async getAssetTransfersPage(
    query: AssetTransfersQuery,
    options?: AlchemyReadCallOptions,
  ): Promise<AssetTransfersPageObservation> {
    const normalized = normalizeTransfersQuery(query);
    if (
      normalized.categories.has("internal") &&
      !INTERNAL_TRANSFER_NETWORKS.has(this.#network)
    ) {
      return invalidInput();
    }
    const invocation = await this.#invoke(
      {
        method: "alchemy_getAssetTransfers",
        params: [normalized.params],
      },
      blockFreshness(normalized.params.toBlock, "alchemy-index"),
      options,
    );
    const result = requireResponseRecord(invocation.result);
    if (
      !Array.isArray(result.transfers) ||
      result.transfers.length > normalized.pageSize
    ) {
      return invalidResponse();
    }
    const transfers = result.transfers.map((transfer) =>
      parseTransfer(transfer, normalized.categories),
    );
    const nextPageKey =
      result.pageKey === undefined ||
      result.pageKey === null ||
      result.pageKey === ""
        ? null
        : parsePageKey(result.pageKey);
    return {
      query: normalized.query,
      transfers: Object.freeze(transfers),
      nextPageKey,
      provenance: invocation.provenance,
    };
  }
}

export function createAlchemyReadClient(
  options: CreateAlchemyReadClientOptions,
): AlchemyReadClient {
  return new ReadClient(options);
}
