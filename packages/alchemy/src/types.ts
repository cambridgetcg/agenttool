export type HexQuantity = `0x${string}`;
export type HexData = `0x${string}`;
export type EvmAddress = `0x${string}`;
export type EvmHash = `0x${string}`;

export type EvmBlockReference =
  | "latest"
  | "safe"
  | "finalized"
  | HexQuantity;

export type AlchemyChain =
  | "ethereum"
  | "base"
  | "polygon"
  | "arbitrum"
  | "optimism";

export type AlchemyEnvironment = "mainnet" | "testnet";

export type AlchemyNetwork =
  | "ethereum-mainnet"
  | "ethereum-sepolia"
  | "base-mainnet"
  | "base-sepolia"
  | "polygon-mainnet"
  | "polygon-amoy"
  | "arbitrum-mainnet"
  | "arbitrum-sepolia"
  | "optimism-mainnet"
  | "optimism-sepolia";

export type AlchemyNetworkSlug =
  | "eth-mainnet"
  | "eth-sepolia"
  | "base-mainnet"
  | "base-sepolia"
  | "polygon-mainnet"
  | "polygon-amoy"
  | "arb-mainnet"
  | "arb-sepolia"
  | "opt-mainnet"
  | "opt-sepolia";

export type EvmChainId = `eip155:${string}`;

export interface AlchemyNetworkDescriptor {
  readonly network: AlchemyNetwork;
  readonly chain: AlchemyChain;
  readonly environment: AlchemyEnvironment;
  readonly chainId: number;
  readonly caip2: EvmChainId;
  readonly alchemyNetwork: AlchemyNetworkSlug;
}

export type AlchemyTransferCategory =
  | "external"
  | "internal"
  | "erc20"
  | "erc721"
  | "erc1155"
  | "specialnft";

export interface AlchemyAssetTransfersRpcParams {
  readonly fromBlock: HexQuantity;
  readonly toBlock: HexQuantity | "latest" | "indexed";
  readonly category: readonly AlchemyTransferCategory[];
  readonly excludeZeroValue: boolean;
  readonly withMetadata: false;
  readonly maxCount: HexQuantity;
  readonly fromAddress?: EvmAddress;
  readonly toAddress?: EvmAddress;
  readonly contractAddresses?: readonly EvmAddress[];
  readonly pageKey?: string;
}

export type AlchemyReadMethod =
  | "eth_chainId"
  | "eth_blockNumber"
  | "eth_getBlockByNumber"
  | "eth_getBalance"
  | "eth_getTransactionByHash"
  | "eth_getTransactionReceipt"
  | "eth_getCode"
  | "alchemy_getAssetTransfers";

interface ReadCall<
  Method extends AlchemyReadMethod,
  Params extends readonly unknown[],
> {
  readonly method: Method;
  readonly params: Params;
}

export type AlchemyReadCall =
  | ReadCall<"eth_chainId", readonly []>
  | ReadCall<"eth_blockNumber", readonly []>
  | ReadCall<
      "eth_getBlockByNumber",
      readonly [EvmBlockReference, false]
    >
  | ReadCall<
      "eth_getBalance",
      readonly [EvmAddress, EvmBlockReference]
    >
  | ReadCall<"eth_getTransactionByHash", readonly [EvmHash]>
  | ReadCall<"eth_getTransactionReceipt", readonly [EvmHash]>
  | ReadCall<"eth_getCode", readonly [EvmAddress, EvmBlockReference]>
  | ReadCall<
      "alchemy_getAssetTransfers",
      readonly [AlchemyAssetTransfersRpcParams]
    >;

export interface AlchemyTransportRequest {
  readonly protocol: "agenttool.alchemy.transport/0.1";
  readonly operationId: number;
  readonly network: AlchemyNetwork;
  readonly chainId: EvmChainId;
  readonly call: AlchemyReadCall;
  readonly signal: AbortSignal;
  readonly deadlineAtMs: number;
  readonly maxResponseBytes: number;
}

export interface AlchemyTransportResponse {
  readonly chainId: EvmChainId;
  readonly method: AlchemyReadMethod;
  readonly result: JsonValue;
  readonly auditId?: string;
  readonly redactions?: number;
}

/**
 * A host-owned credential and network boundary.
 *
 * Implementations map the fixed `network` value to a trusted endpoint, add
 * credentials outside this package, generate and validate the JSON-RPC
 * envelope, enforce the byte/deadline limits while reading, and return only a
 * parsed result bound to the requested method and CAIP-2 chain.
 */
export interface AlchemyReadTransport {
  send(request: AlchemyTransportRequest): Promise<AlchemyTransportResponse>;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface AlchemyReadCallOptions {
  readonly signal?: AbortSignal;
  readonly deadlineAtMs?: number;
}

export type ObservationSource = "live-rpc" | "alchemy-index";

export type ObservationState =
  | "provider-head"
  | "provider-safe-tag"
  | "provider-finalized-tag"
  | "historical"
  | "pending"
  | "indexed";

export type FinalityEvidence =
  | "none"
  | "provider-asserted-safe"
  | "provider-asserted-finalized"
  | "unknown";

export interface ObservationFreshness {
  readonly source: ObservationSource;
  readonly state: ObservationState;
  readonly blockReference: string;
  readonly finalityEvidence: FinalityEvidence;
  readonly indexLagPossible: boolean;
  readonly caveat: string;
}

export interface ObservationProvenance {
  readonly provider: "alchemy";
  readonly network: AlchemyNetwork;
  /**
   * Chain ID from AgentTool's fixed network table. It is configuration, not
   * independent proof of the endpoint used by the injected transport.
   */
  readonly configuredChainId: number;
  readonly method: AlchemyReadMethod;
  readonly requestId: number;
  readonly requestedAt: string;
  readonly receivedAt: string;
  readonly resultBytes: number;
  readonly transportAuditId: string | null;
  readonly transportRedactions: number | null;
  readonly freshness: ObservationFreshness;
}

export interface ChainIdObservation {
  readonly chainId: number;
  readonly chainIdHex: HexQuantity;
  readonly provenance: ObservationProvenance;
}

export interface BlockNumberObservation {
  readonly blockNumber: string;
  readonly blockNumberHex: HexQuantity;
  readonly provenance: ObservationProvenance;
}

export interface EvmBlock {
  readonly hash: EvmHash;
  readonly parentHash: EvmHash;
  readonly number: string;
  readonly numberHex: HexQuantity;
  readonly timestamp: string;
  readonly timestampHex: HexQuantity;
  readonly transactionCount: number;
}

export interface BlockObservation {
  readonly blockReference: EvmBlockReference;
  readonly block: EvmBlock | null;
  readonly provenance: ObservationProvenance;
}

export interface BalanceObservation {
  readonly address: EvmAddress;
  readonly block: EvmBlockReference;
  readonly balanceWei: string;
  readonly balanceHex: HexQuantity;
  readonly provenance: ObservationProvenance;
}

export interface EvmTransaction {
  readonly hash: EvmHash;
  readonly from: EvmAddress;
  readonly to: EvmAddress | null;
  readonly blockHash: EvmHash | null;
  readonly blockNumber: string | null;
  readonly blockNumberHex: HexQuantity | null;
  readonly transactionIndex: string | null;
  readonly transactionIndexHex: HexQuantity | null;
  readonly nonce: string;
  readonly nonceHex: HexQuantity;
  readonly valueWei: string;
  readonly valueHex: HexQuantity;
  readonly input: HexData;
  readonly inputBytes: number;
}

export interface TransactionObservation {
  readonly transactionHash: EvmHash;
  readonly transaction: EvmTransaction | null;
  readonly provenance: ObservationProvenance;
}

export interface EvmTransactionReceipt {
  readonly transactionHash: EvmHash;
  readonly blockHash: EvmHash;
  readonly blockNumber: string;
  readonly blockNumberHex: HexQuantity;
  readonly transactionIndex: string;
  readonly transactionIndexHex: HexQuantity;
  readonly from: EvmAddress;
  readonly to: EvmAddress | null;
  readonly contractAddress: EvmAddress | null;
  readonly status: "success" | "reverted" | null;
  readonly gasUsed: string;
  readonly gasUsedHex: HexQuantity;
  readonly cumulativeGasUsed: string;
  readonly cumulativeGasUsedHex: HexQuantity;
  readonly effectiveGasPriceWei: string | null;
  readonly effectiveGasPriceHex: HexQuantity | null;
  readonly logsCount: number;
}

export interface TransactionReceiptObservation {
  readonly transactionHash: EvmHash;
  readonly receipt: EvmTransactionReceipt | null;
  readonly provenance: ObservationProvenance;
}

export interface CodeObservation {
  readonly address: EvmAddress;
  readonly block: EvmBlockReference;
  readonly code: HexData;
  readonly codeBytes: number;
  readonly provenance: ObservationProvenance;
}

export interface AssetTransfersQuery {
  readonly fromBlock: HexQuantity;
  readonly toBlock: HexQuantity | "latest" | "indexed";
  readonly categories: readonly AlchemyTransferCategory[];
  readonly fromAddress?: EvmAddress;
  readonly toAddress?: EvmAddress;
  readonly contractAddresses?: readonly EvmAddress[];
  readonly excludeZeroValue?: boolean;
  readonly pageSize?: number;
}

export interface NormalizedAssetTransfersQuery {
  readonly fromBlock: HexQuantity;
  readonly toBlock: HexQuantity | "latest" | "indexed";
  readonly categories: readonly AlchemyTransferCategory[];
  readonly fromAddress: EvmAddress | null;
  readonly toAddress: EvmAddress | null;
  readonly contractAddresses: readonly EvmAddress[];
  readonly excludeZeroValue: boolean;
  readonly pageSize: number;
}

declare const ASSET_TRANSFERS_CURSOR_BRAND: unique symbol;

/**
 * Opaque, process-local continuation state issued by one Alchemy read client.
 *
 * A cursor can be used only with the same client instance that issued it. It
 * contains no publicly readable provider page key or mutable query fields.
 */
export interface AssetTransfersCursor {
  readonly [ASSET_TRANSFERS_CURSOR_BRAND]:
    "agenttool.alchemy.asset-transfers-cursor/0.1";
}

export interface AlchemyAssetTransfer {
  readonly transferId: string;
  readonly transactionHash: EvmHash;
  readonly blockNumber: string;
  readonly blockNumberHex: HexQuantity;
  readonly from: EvmAddress;
  readonly to: EvmAddress | null;
  readonly category: AlchemyTransferCategory;
  readonly contractAddress: EvmAddress | null;
  readonly rawValueHex: HexQuantity | null;
  readonly tokenId: HexQuantity | null;
  readonly erc1155Values: readonly Erc1155TransferValue[];
}

export interface Erc1155TransferValue {
  readonly tokenId: HexQuantity;
  readonly valueHex: HexQuantity;
}

export interface AssetTransfersPageObservation {
  readonly query: NormalizedAssetTransfersQuery;
  readonly transfers: readonly AlchemyAssetTransfer[];
  readonly nextCursor: AssetTransfersCursor | null;
  readonly provenance: ObservationProvenance;
}

export interface GetBlockInput {
  readonly block: EvmBlockReference;
}

export interface GetBalanceInput {
  readonly address: EvmAddress;
  readonly block?: EvmBlockReference;
}

export interface GetTransactionInput {
  readonly transactionHash: EvmHash;
}

export interface GetCodeInput {
  readonly address: EvmAddress;
  readonly block?: EvmBlockReference;
}

export interface AlchemyReadClient {
  getChainId(options?: AlchemyReadCallOptions): Promise<ChainIdObservation>;
  getBlockNumber(
    options?: AlchemyReadCallOptions,
  ): Promise<BlockNumberObservation>;
  getBlock(
    input: GetBlockInput,
    options?: AlchemyReadCallOptions,
  ): Promise<BlockObservation>;
  getBalance(
    input: GetBalanceInput,
    options?: AlchemyReadCallOptions,
  ): Promise<BalanceObservation>;
  getTransaction(
    input: GetTransactionInput,
    options?: AlchemyReadCallOptions,
  ): Promise<TransactionObservation>;
  getTransactionReceipt(
    input: GetTransactionInput,
    options?: AlchemyReadCallOptions,
  ): Promise<TransactionReceiptObservation>;
  getCode(
    input: GetCodeInput,
    options?: AlchemyReadCallOptions,
  ): Promise<CodeObservation>;
  getAssetTransfersPage(
    query: AssetTransfersQuery,
    options?: AlchemyReadCallOptions,
  ): Promise<AssetTransfersPageObservation>;
  getNextAssetTransfersPage(
    cursor: AssetTransfersCursor,
    options?: AlchemyReadCallOptions,
  ): Promise<AssetTransfersPageObservation>;
}

export interface CreateAlchemyReadClientOptions {
  readonly network: AlchemyNetwork;
  readonly transport: AlchemyReadTransport;
  readonly defaultTimeoutMs?: number;
  /** Trusted host clock injection for deterministic tests. */
  readonly now?: () => number;
}
