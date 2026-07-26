import { describe, expect, test } from "bun:test";

import {
  ALCHEMY_NETWORKS,
  createAlchemyReadClient,
  type AlchemyTransportRequest,
} from "../src/index.js";
import {
  ADDRESS_A,
  ADDRESS_B,
  CONTRACT,
  FakeTransport,
  HASH_A,
  HASH_B,
  NOW,
  transportResponse,
} from "./helpers.js";

function resultFor(request: AlchemyTransportRequest): unknown {
  switch (request.call.method) {
    case "eth_chainId":
      return "0x1";
    case "eth_blockNumber":
      return "0x10";
    case "eth_getBlockByNumber":
      return {
        hash: HASH_A,
        parentHash: HASH_B,
        number: "0x10",
        timestamp: "0x20",
        transactions: [HASH_A, HASH_B],
        ignoredProviderField: "not forwarded",
      };
    case "eth_getBalance":
      return "0xde0b6b3a7640000";
    case "eth_getTransactionByHash":
      return {
        hash: HASH_A,
        from: ADDRESS_A,
        to: ADDRESS_B,
        blockHash: HASH_B,
        blockNumber: "0x10",
        transactionIndex: "0x1",
        nonce: "0x2",
        value: "0x2a",
        input: "0x1234",
      };
    case "eth_getTransactionReceipt":
      return {
        transactionHash: HASH_A,
        blockHash: HASH_B,
        blockNumber: "0x10",
        transactionIndex: "0x1",
        from: ADDRESS_A,
        to: ADDRESS_B,
        contractAddress: null,
        status: "0x1",
        gasUsed: "0x5208",
        cumulativeGasUsed: "0x5208",
        effectiveGasPrice: "0x3b9aca00",
        logs: [{ deliberately: "not forwarded" }],
      };
    case "eth_getCode":
      return "0x60016000";
    case "alchemy_getAssetTransfers":
      return {
        transfers: [
          {
            uniqueId: "transfer:1",
            hash: HASH_A,
            blockNum: "0x10",
            from: ADDRESS_A,
            to: ADDRESS_B,
            category: "erc20",
            asset: "TOK",
            rawContract: {
              address: CONTRACT,
              value: `0x${"0".repeat(62)}2a`,
              decimal: 18,
            },
          },
        ],
        pageKey: "next_page-1=",
      };
  }
}

describe("bounded named reads", () => {
  test("uses the repository's fixed ten-network mapping", () => {
    expect(Object.keys(ALCHEMY_NETWORKS)).toEqual([
      "ethereum-mainnet",
      "ethereum-sepolia",
      "base-mainnet",
      "base-sepolia",
      "polygon-mainnet",
      "polygon-amoy",
      "arbitrum-mainnet",
      "arbitrum-sepolia",
      "optimism-mainnet",
      "optimism-sepolia",
    ]);
    expect(ALCHEMY_NETWORKS["polygon-amoy"]).toEqual({
      network: "polygon-amoy",
      chain: "polygon",
      environment: "testnet",
      chainId: 80_002,
      caip2: "eip155:80002",
      alchemyNetwork: "polygon-amoy",
    });
    expect(Object.isFrozen(ALCHEMY_NETWORKS)).toBe(true);
    expect(Object.isFrozen(ALCHEMY_NETWORKS["ethereum-mainnet"])).toBe(true);
  });

  test("emits only exact closed RPC methods and normalizes typed results", async () => {
    const transport = new FakeTransport((request) => ({
      ...transportResponse(request, resultFor(request)),
      auditId: `audit-${request.operationId}`,
      redactions: 0,
    }));
    const client = createAlchemyReadClient({
      network: "ethereum-mainnet",
      transport,
      now: () => NOW,
    });

    const chain = await client.getChainId();
    const head = await client.getBlockNumber();
    const block = await client.getBlock({ block: "0x10" });
    const balance = await client.getBalance({
      address: ADDRESS_A.toUpperCase().replace("0X", "0x") as typeof ADDRESS_A,
      block: "safe",
    });
    const transaction = await client.getTransaction({
      transactionHash: HASH_A,
    });
    const receipt = await client.getTransactionReceipt({
      transactionHash: HASH_A,
    });
    const code = await client.getCode({
      address: ADDRESS_A,
      block: "finalized",
    });
    const transfers = await client.getAssetTransfersPage({
      fromBlock: "0x1",
      toBlock: "indexed",
      categories: ["erc20"],
      toAddress: ADDRESS_B,
      contractAddresses: [CONTRACT],
      pageSize: 25,
      pageKey: "page_0=",
    });

    expect(chain.chainId).toBe(1);
    expect(chain.provenance.configuredChainId).toBe(1);
    expect(chain.provenance.requestedAt).toBe("2026-07-26T00:00:00.000Z");
    expect(chain.provenance).toMatchObject({
      resultBytes: 5,
      transportAuditId: "audit-1",
      transportRedactions: 0,
    });
    expect(head).toMatchObject({
      blockNumber: "16",
      blockNumberHex: "0x10",
    });
    expect(block.block).toEqual({
      hash: HASH_A,
      parentHash: HASH_B,
      number: "16",
      numberHex: "0x10",
      timestamp: "32",
      timestampHex: "0x20",
      transactionCount: 2,
    });
    expect(block.blockReference).toBe("0x10");
    expect(block.provenance.freshness).toMatchObject({
      state: "historical",
      finalityEvidence: "unknown",
    });
    expect(balance).toMatchObject({
      address: ADDRESS_A,
      balanceWei: "1000000000000000000",
      block: "safe",
    });
    expect(balance.provenance.freshness).toMatchObject({
      state: "provider-safe-tag",
      finalityEvidence: "provider-asserted-safe",
    });
    expect(transaction.transaction).toMatchObject({
      hash: HASH_A,
      valueWei: "42",
      inputBytes: 2,
      blockNumber: "16",
    });
    expect(transaction.transactionHash).toBe(HASH_A);
    expect(receipt.receipt).toMatchObject({
      status: "success",
      gasUsed: "21000",
      logsCount: 1,
    });
    expect(receipt.transactionHash).toBe(HASH_A);
    expect(code).toMatchObject({
      code: "0x60016000",
      codeBytes: 4,
    });
    expect(code.provenance.freshness).toMatchObject({
      state: "provider-finalized-tag",
      finalityEvidence: "provider-asserted-finalized",
    });
    expect(transfers).toMatchObject({
      query: {
        fromBlock: "0x1",
        toBlock: "indexed",
        categories: ["erc20"],
        fromAddress: null,
        toAddress: ADDRESS_B,
        contractAddresses: [CONTRACT],
        excludeZeroValue: true,
        pageSize: 25,
        pageKey: "page_0=",
      },
      nextPageKey: "next_page-1=",
      transfers: [
        {
          transferId: "transfer:1",
          transactionHash: HASH_A,
          blockNumber: "16",
          from: ADDRESS_A,
          to: ADDRESS_B,
          category: "erc20",
          contractAddress: CONTRACT,
          rawValueHex: "0x2a",
          tokenId: null,
        },
      ],
    });
    expect(transfers.provenance.freshness).toMatchObject({
      source: "alchemy-index",
      state: "indexed",
      blockReference: "indexed",
      indexLagPossible: true,
    });

    expect(transport.requests.map((request) => request.call.method)).toEqual([
      "eth_chainId",
      "eth_blockNumber",
      "eth_getBlockByNumber",
      "eth_getBalance",
      "eth_getTransactionByHash",
      "eth_getTransactionReceipt",
      "eth_getCode",
      "alchemy_getAssetTransfers",
    ]);
    expect(transport.requests.every((request) => request.network === "ethereum-mainnet")).toBe(true);
    expect(
      transport.requests.every(
        (request) => request.chainId === "eip155:1",
      ),
    ).toBe(true);
    expect(transport.requests.map((request) => request.operationId)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(
      transport.requests.every(
        (request) =>
          request.protocol === "agenttool.alchemy.transport/0.1" &&
          request.maxResponseBytes === 2 * 1024 * 1024 &&
          Object.isFrozen(request.call) &&
          Object.isFrozen(request.call.params),
      ),
    ).toBe(true);
    expect(transport.requests[2]?.call.params).toEqual(["0x10", false]);
    expect(transport.requests[3]?.call.params).toEqual([ADDRESS_A, "safe"]);
    expect(transport.requests[7]?.call.params).toEqual([
      {
        fromBlock: "0x1",
        toBlock: "indexed",
        category: ["erc20"],
        excludeZeroValue: true,
        withMetadata: false,
        maxCount: "0x19",
        toAddress: ADDRESS_B,
        contractAddresses: [CONTRACT],
        pageKey: "page_0=",
      },
    ]);
  });

  test("binds numbered blocks, transactions, and receipts to their request", async () => {
    const mismatchedBlock = createAlchemyReadClient({
      network: "ethereum-mainnet",
      transport: new FakeTransport((request) =>
        transportResponse(request, resultFor(request)),
      ),
      now: () => NOW,
    });
    await expect(
      mismatchedBlock.getBlock({ block: "0x11" }),
    ).rejects.toMatchObject({ code: "invalid_response" });

    const mismatchedTransaction = createAlchemyReadClient({
      network: "ethereum-mainnet",
      transport: new FakeTransport((request) =>
        transportResponse(request, {
          ...(resultFor(request) as Record<string, unknown>),
          hash: HASH_B,
        }),
      ),
      now: () => NOW,
    });
    await expect(
      mismatchedTransaction.getTransaction({ transactionHash: HASH_A }),
    ).rejects.toMatchObject({ code: "invalid_response" });

    const mismatchedReceipt = createAlchemyReadClient({
      network: "ethereum-mainnet",
      transport: new FakeTransport((request) =>
        transportResponse(request, {
          ...(resultFor(request) as Record<string, unknown>),
          transactionHash: HASH_B,
        }),
      ),
      now: () => NOW,
    });
    await expect(
      mismatchedReceipt.getTransactionReceipt({ transactionHash: HASH_A }),
    ).rejects.toMatchObject({ code: "invalid_response" });

    const nullResult = createAlchemyReadClient({
      network: "ethereum-mainnet",
      transport: new FakeTransport((request) =>
        transportResponse(request, null),
      ),
      now: () => NOW,
    });
    await expect(
      nullResult.getBlock({ block: "0x11" }),
    ).resolves.toMatchObject({ block: null });
    await expect(
      nullResult.getTransaction({ transactionHash: HASH_A }),
    ).resolves.toMatchObject({ transaction: null });
    await expect(
      nullResult.getTransactionReceipt({ transactionHash: HASH_A }),
    ).resolves.toMatchObject({ receipt: null });
  });

  test("binds transfer results to enforceable request filters", async () => {
    const query = {
      fromBlock: "0x10" as const,
      toBlock: "0x20" as const,
      categories: ["erc20"] as const,
      fromAddress: ADDRESS_A,
      toAddress: ADDRESS_B,
      contractAddresses: [CONTRACT],
      excludeZeroValue: true,
    };
    const transfer: Record<string, unknown> = {
      uniqueId: "0xabc:log:1",
      hash: HASH_A,
      blockNum: "0x11",
      from: ADDRESS_A,
      to: ADDRESS_B,
      category: "erc20",
      rawContract: {
        address: CONTRACT,
        value: "0x1",
      },
    };
    const mutations: Array<Record<string, unknown>> = [
      { ...transfer, blockNum: "0x9" },
      { ...transfer, blockNum: "0x21" },
      { ...transfer, from: ADDRESS_B },
      { ...transfer, to: ADDRESS_A },
      {
        ...transfer,
        rawContract: {
          ...(transfer.rawContract as Record<string, unknown>),
          address: ADDRESS_A,
        },
      },
      {
        ...transfer,
        rawContract: {
          ...(transfer.rawContract as Record<string, unknown>),
          value: "0x0",
        },
      },
      {
        ...transfer,
        rawContract: {
          ...(transfer.rawContract as Record<string, unknown>),
          value: null,
        },
      },
    ];

    for (const mismatched of mutations) {
      const client = createAlchemyReadClient({
        network: "ethereum-mainnet",
        transport: new FakeTransport((request) =>
          transportResponse(request, { transfers: [mismatched] }),
        ),
        now: () => NOW,
      });
      await expect(
        client.getAssetTransfersPage(query),
      ).rejects.toMatchObject({ code: "invalid_response" });
    }

    const zeroBatchValue = {
      ...transfer,
      category: "erc1155",
      rawContract: {
        ...(transfer.rawContract as Record<string, unknown>),
        value: null,
      },
      erc1155Metadata: [{ tokenId: "0x1", value: "0x0" }],
    };
    const erc1155Client = createAlchemyReadClient({
      network: "ethereum-mainnet",
      transport: new FakeTransport((request) =>
        transportResponse(request, { transfers: [zeroBatchValue] }),
      ),
      now: () => NOW,
    });
    await expect(
      erc1155Client.getAssetTransfersPage({
        ...query,
        categories: ["erc1155"],
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  test("supports address-selected mixed token and native transfer queries", async () => {
    const externalTransfer = {
      uniqueId: "0xabc:external:1",
      hash: HASH_A,
      blockNum: "0x11",
      from: ADDRESS_A,
      to: ADDRESS_B,
      category: "external",
      rawContract: {
        address: null,
        value: "0x1",
      },
    };
    const tokenTransfer = {
      uniqueId: "0xabc:log:2",
      hash: HASH_A,
      blockNum: "0x11",
      from: ADDRESS_A,
      to: ADDRESS_B,
      category: "erc20",
      rawContract: {
        address: CONTRACT,
        value: "0x2",
      },
    };
    const transport = new FakeTransport((request) =>
      transportResponse(request, {
        transfers: [externalTransfer, tokenTransfer],
      }),
    );
    const client = createAlchemyReadClient({
      network: "ethereum-mainnet",
      transport,
      now: () => NOW,
    });

    const page = await client.getAssetTransfersPage({
      fromBlock: "0x10",
      toBlock: "0x20",
      categories: ["external", "erc20"],
      toAddress: ADDRESS_B,
      contractAddresses: [CONTRACT],
      excludeZeroValue: true,
    });

    expect(page.transfers.map((transfer) => transfer.category)).toEqual([
      "external",
      "erc20",
    ]);
    expect(transport.requests[0]?.call.params).toMatchObject([
      {
        category: ["external", "erc20"],
        toAddress: ADDRESS_B,
        contractAddresses: [CONTRACT],
      },
    ]);
  });

  test("returns null for not-yet-observed blocks, transactions, and receipts", async () => {
    const transport = new FakeTransport((request) =>
      transportResponse(request, null),
    );
    const client = createAlchemyReadClient({
      network: "ethereum-mainnet",
      transport,
      now: () => NOW,
    });

    expect((await client.getBlock({ block: "0x999" })).block).toBeNull();
    expect(
      (
        await client.getTransaction({
          transactionHash: HASH_A,
        })
      ).transaction,
    ).toBeNull();
    expect(
      (
        await client.getTransactionReceipt({
          transactionHash: HASH_A,
        })
      ).receipt,
    ).toBeNull();
  });

  test("labels a transaction without block identity as pending", async () => {
    const transport = new FakeTransport((request) =>
      transportResponse(request, {
        hash: HASH_A,
        from: ADDRESS_A,
        to: null,
        blockHash: null,
        blockNumber: null,
        transactionIndex: null,
        nonce: "0x0",
        value: "0x0",
        input: "0x",
      }),
    );
    const client = createAlchemyReadClient({
      network: "ethereum-mainnet",
      transport,
      now: () => NOW,
    });

    const observation = await client.getTransaction({
      transactionHash: HASH_A,
    });
    expect(observation.provenance.freshness).toMatchObject({
      state: "pending",
      finalityEvidence: "none",
    });
  });

  test("treats the provider's empty page key as end of pagination", async () => {
    const transport = new FakeTransport((request) =>
      transportResponse(request, {
        transfers: [],
        pageKey: "",
      }),
    );
    const client = createAlchemyReadClient({
      network: "ethereum-mainnet",
      transport,
      now: () => NOW,
    });

    const page = await client.getAssetTransfersPage({
      fromBlock: "0x1",
      toBlock: "indexed",
      categories: ["erc20"],
      toAddress: ADDRESS_B,
    });
    expect(page.nextPageKey).toBeNull();
  });

  test("preserves bounded ERC-1155 batch token/value identity", async () => {
    const transport = new FakeTransport((request) =>
      transportResponse(request, {
        transfers: [
          {
            uniqueId: `${HASH_A}:erc1155:1`,
            hash: HASH_A,
            blockNum: "0x10",
            from: ADDRESS_A,
            to: ADDRESS_B,
            category: "erc1155",
            tokenId: null,
            erc721TokenId: null,
            erc1155Metadata: [
              {
                tokenId: `0x${"0".repeat(63)}a`,
                value: `0x${"0".repeat(63)}2`,
              },
            ],
            rawContract: {
              address: CONTRACT,
              value: null,
            },
          },
        ],
      }),
    );
    const client = createAlchemyReadClient({
      network: "ethereum-mainnet",
      transport,
      now: () => NOW,
    });

    const page = await client.getAssetTransfersPage({
      fromBlock: "0x1",
      toBlock: "0x10",
      categories: ["erc1155"],
      contractAddresses: [CONTRACT],
    });
    expect(page.transfers[0]?.erc1155Values).toEqual([
      {
        tokenId: "0xa",
        valueHex: "0x2",
      },
    ]);
  });
});
