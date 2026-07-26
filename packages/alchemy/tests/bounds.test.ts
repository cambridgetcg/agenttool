import { describe, expect, test } from "bun:test";

import {
  AlchemyReadError,
  MAX_ALCHEMY_RESPONSE_BYTES,
  createAlchemyReadClient,
  type AlchemyReadTransport,
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

async function expectCode(
  promise: Promise<unknown>,
  code: AlchemyReadError["code"],
): Promise<AlchemyReadError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AlchemyReadError);
    const typed = error as AlchemyReadError;
    expect(typed.code).toBe(code);
    return typed;
  }
  throw new Error("Expected operation to reject.");
}

function basicClient(transport: AlchemyReadTransport) {
  return createAlchemyReadClient({
    network: "ethereum-mainnet",
    transport,
    now: () => NOW,
  });
}

describe("input and response bounds", () => {
  test("rejects unknown config and operation fields before transport", async () => {
    const transport = new FakeTransport((request) =>
      transportResponse(request, "0x0"),
    );
    expect(() =>
      createAlchemyReadClient({
        network: "ethereum-mainnet",
        transport,
        apiKey: "must-not-be-accepted",
      } as never),
    ).toThrow(AlchemyReadError);
    expect(() =>
      createAlchemyReadClient({
        network: "unknown-mainnet",
        transport,
      } as never),
    ).toThrow(AlchemyReadError);
    expect(() =>
      createAlchemyReadClient({
        network: "ethereum-mainnet",
        transport,
        url: "https://caller.invalid",
      } as never),
    ).toThrow(AlchemyReadError);

    const client = basicClient(transport);
    await expectCode(
      client.getBalance({
        address: ADDRESS_A,
        block: "latest",
        method: "eth_sendRawTransaction",
      } as never),
      "invalid_input",
    );
    await expectCode(
      client.getBlock({ block: "pending" } as never),
      "invalid_input",
    );
    await expectCode(
      client.getTransaction({
        transactionHash: "0x1234" as typeof HASH_A,
      }),
      "invalid_input",
    );
    expect(transport.requests).toHaveLength(0);
  });

  test("bounds transfer queries and rejects raw provider page keys", async () => {
    const transport = new FakeTransport((request) =>
      transportResponse(request, { transfers: [] }),
    );
    const client = basicClient(transport);
    const base = {
      fromBlock: "0x1" as const,
      toBlock: "0x2" as const,
      categories: ["erc20"] as const,
    };

    await expectCode(client.getAssetTransfersPage(base), "invalid_input");
    await expectCode(
      client.getAssetTransfersPage({
        ...base,
        toAddress: ADDRESS_A,
        pageSize: 101,
      }),
      "invalid_input",
    );
    await expectCode(
      client.getAssetTransfersPage({
        ...base,
        categories: ["external"],
        contractAddresses: [ADDRESS_A],
      }),
      "invalid_input",
    );
    await expectCode(
      client.getAssetTransfersPage({
        ...base,
        toAddress: ADDRESS_A,
        categories: ["erc20", "erc20"],
      }),
      "invalid_input",
    );
    await expectCode(
      client.getAssetTransfersPage({
        ...base,
        toAddress: ADDRESS_A,
        toBlock: "0x186a2",
      }),
      "invalid_input",
    );
    await expectCode(
      client.getAssetTransfersPage({
        ...base,
        toAddress: ADDRESS_A,
        pageKey: "provider_page_1=",
      } as never),
      "invalid_input",
    );
    expect(transport.requests).toHaveLength(0);
  });

  test("rejects internal-transfer queries on networks where Alchemy does not support them", async () => {
    const transport = new FakeTransport((request) =>
      transportResponse(request, { transfers: [] }),
    );
    const client = createAlchemyReadClient({
      network: "base-mainnet",
      transport,
      now: () => NOW,
    });
    await expectCode(
      client.getAssetTransfersPage({
        fromBlock: "0x1",
        toBlock: "indexed",
        categories: ["internal"],
        toAddress: ADDRESS_A,
      }),
      "invalid_input",
    );
    expect(transport.requests).toHaveLength(0);
  });

  test("checks response bytes locally even when the transport does not", async () => {
    const client = basicClient(
      new FakeTransport((request) =>
        transportResponse(
          request,
          "x".repeat(MAX_ALCHEMY_RESPONSE_BYTES + 1),
        ),
      ),
    );
    await expectCode(client.getBlockNumber(), "response_too_large");
  });

  test("rejects oversized code and transaction input fields", async () => {
    const codeClient = basicClient(
      new FakeTransport((request) =>
        transportResponse(request, `0x${"00".repeat(512 * 1024 + 1)}`),
      ),
    );
    await expectCode(
      codeClient.getCode({ address: ADDRESS_A }),
      "invalid_response",
    );

    const transactionClient = basicClient(
      new FakeTransport((request) =>
        transportResponse(request, {
          hash: HASH_A,
          from: ADDRESS_A,
          to: null,
          blockHash: null,
          blockNumber: null,
          transactionIndex: null,
          nonce: "0x0",
          value: "0x0",
          input: `0x${"00".repeat(128 * 1024 + 1)}`,
        }),
      ),
    );
    await expectCode(
      transactionClient.getTransaction({ transactionHash: HASH_A }),
      "invalid_response",
    );
  });

  test("rejects chain/method mismatches and overfilled transfer pages", async () => {
    const mismatch = basicClient(
      new FakeTransport((request) => transportResponse(request, "0x89")),
    );
    await expectCode(mismatch.getChainId(), "chain_mismatch");

    const wrongMethod = basicClient(
      new FakeTransport((request) => ({
        ...transportResponse(request, "0x1"),
        method: "eth_blockNumber",
      })),
    );
    await expectCode(wrongMethod.getChainId(), "invalid_response");

    const wrongChain = basicClient(
      new FakeTransport((request) => ({
        ...transportResponse(request, "0x1"),
        chainId: "eip155:137",
      })),
    );
    await expectCode(wrongChain.getChainId(), "chain_mismatch");

    const tooMany = basicClient(
      new FakeTransport((request) =>
        transportResponse(request, {
          transfers: [{}, {}],
        }),
      ),
    );
    await expectCode(
      tooMany.getAssetTransfersPage({
        fromBlock: "0x1",
        toBlock: "0x2",
        categories: ["erc20"],
        toAddress: ADDRESS_A,
        pageSize: 1,
      }),
      "invalid_response",
    );
  });

  test("binds numbered blocks and transaction results to the requested identity", async () => {
    const blockClient = basicClient(
      new FakeTransport((request) =>
        transportResponse(request, {
          hash: HASH_A,
          parentHash: HASH_B,
          number: "0x11",
          timestamp: "0x20",
          transactions: [],
        }),
      ),
    );
    await expectCode(
      blockClient.getBlock({ block: "0x10" }),
      "invalid_response",
    );

    const transactionClient = basicClient(
      new FakeTransport((request) =>
        transportResponse(request, {
          hash: HASH_B,
          from: ADDRESS_A,
          to: ADDRESS_B,
          blockHash: null,
          blockNumber: null,
          transactionIndex: null,
          nonce: "0x0",
          value: "0x0",
          input: "0x",
        }),
      ),
    );
    await expectCode(
      transactionClient.getTransaction({ transactionHash: HASH_A }),
      "invalid_response",
    );

    const receiptClient = basicClient(
      new FakeTransport((request) =>
        transportResponse(request, {
          transactionHash: HASH_B,
          blockHash: HASH_A,
          blockNumber: "0x10",
          transactionIndex: "0x0",
          from: ADDRESS_A,
          to: ADDRESS_B,
          contractAddress: null,
          status: "0x1",
          gasUsed: "0x5208",
          cumulativeGasUsed: "0x5208",
          effectiveGasPrice: "0x1",
          logs: [],
        }),
      ),
    );
    await expectCode(
      receiptClient.getTransactionReceipt({
        transactionHash: HASH_A,
      }),
      "invalid_response",
    );
  });

  test("rejects transfer rows outside the requested filters", async () => {
    const validTransfer = {
      uniqueId: "transfer:bounded",
      hash: HASH_A,
      blockNum: "0x15",
      from: ADDRESS_A,
      to: ADDRESS_B,
      category: "erc20",
      rawContract: {
        address: CONTRACT,
        value: "0x1",
      },
    };
    const invalidRows = [
      { ...validTransfer, blockNum: "0xf" },
      { ...validTransfer, blockNum: "0x21" },
      { ...validTransfer, from: ADDRESS_B },
      { ...validTransfer, to: ADDRESS_A },
      {
        ...validTransfer,
        rawContract: {
          address: ADDRESS_A,
          value: "0x1",
        },
      },
      {
        ...validTransfer,
        category: "external",
        rawContract: null,
      },
    ];

    for (const transfer of invalidRows) {
      const client = basicClient(
        new FakeTransport((request) =>
          transportResponse(request, { transfers: [transfer] }),
        ),
      );
      await expectCode(
        client.getAssetTransfersPage({
          fromBlock: "0x10",
          toBlock: "0x20",
          categories: ["erc20"],
          fromAddress: ADDRESS_A,
          toAddress: ADDRESS_B,
          contractAddresses: [CONTRACT],
        }),
        "invalid_response",
      );
    }
  });

  test("applies contract filters only to contract-addressed transfer categories", async () => {
    const client = basicClient(
      new FakeTransport((request) =>
        transportResponse(request, {
          transfers: [
            {
              uniqueId: "transfer:external",
              hash: HASH_A,
              blockNum: "0x15",
              from: ADDRESS_A,
              to: ADDRESS_B,
              category: "external",
              rawContract: null,
            },
          ],
        }),
      ),
    );

    const page = await client.getAssetTransfersPage({
      fromBlock: "0x10",
      toBlock: "0x20",
      categories: ["external", "erc20"],
      fromAddress: ADDRESS_A,
      contractAddresses: [CONTRACT],
    });
    expect(page.transfers[0]).toMatchObject({
      category: "external",
      contractAddress: null,
    });
  });

  test("rejects forged or cross-client continuation cursors before transport", async () => {
    const issuingTransport = new FakeTransport((request) =>
      transportResponse(request, {
        transfers: [],
        pageKey: "provider_page_1=",
      }),
    );
    const issuingClient = basicClient(issuingTransport);
    const first = await issuingClient.getAssetTransfersPage({
      fromBlock: "0x1",
      toBlock: "0x2",
      categories: ["erc20"],
      toAddress: ADDRESS_A,
    });
    const cursor = first.nextCursor;
    if (cursor === null) {
      throw new Error("Expected a continuation cursor.");
    }

    const otherTransport = new FakeTransport((request) =>
      transportResponse(request, { transfers: [] }),
    );
    const otherClient = basicClient(otherTransport);
    await expectCode(
      otherClient.getNextAssetTransfersPage(cursor),
      "invalid_input",
    );
    await expectCode(
      issuingClient.getNextAssetTransfersPage({} as never),
      "invalid_input",
    );
    expect(issuingTransport.requests).toHaveLength(1);
    expect(otherTransport.requests).toHaveLength(0);
  });
});

describe("cancellation, failures, and sanitization", () => {
  test("does not invoke transport for an already-aborted signal", async () => {
    const transport = new FakeTransport((request) =>
      transportResponse(request, "0x1"),
    );
    const controller = new AbortController();
    controller.abort();
    await expectCode(
      basicClient(transport).getChainId({ signal: controller.signal }),
      "aborted",
    );
    expect(transport.requests).toHaveLength(0);
  });

  test("propagates in-flight cancellation and a bounded deadline", async () => {
    const transport = new FakeTransport(
      () => new Promise(() => undefined),
    );
    const client = basicClient(transport);
    const controller = new AbortController();
    const cancelled = client.getBlockNumber({ signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expectCode(cancelled, "aborted");
    expect(transport.requests[0]?.signal.aborted).toBe(true);

    const deadlineTransport = new FakeTransport(
      () => new Promise(() => undefined),
    );
    const deadlineClient = basicClient(deadlineTransport);
    await expectCode(
      deadlineClient.getBlockNumber({ deadlineAtMs: NOW + 5 }),
      "deadline_exceeded",
    );
    expect(deadlineTransport.requests[0]?.deadlineAtMs).toBe(NOW + 5);
    expect(deadlineTransport.requests[0]?.signal.aborted).toBe(true);
  });

  test("never forwards malformed-result or transport error text", async () => {
    const malformedResult = basicClient(
      new FakeTransport((request) =>
        transportResponse(request, {
          internal: "credential-shaped-sensitive-provider-text",
        }),
      ),
    );
    const resultError = await expectCode(
      malformedResult.getBlockNumber(),
      "invalid_response",
    );
    expect(resultError.message).not.toContain("sensitive");
    expect(JSON.stringify(resultError)).not.toContain("sensitive");

    const transportFailure = basicClient(
      new FakeTransport(() => {
        throw new Error("credential-shaped-sensitive-transport-text");
      }),
    );
    const transportError = await expectCode(
      transportFailure.getBlockNumber(),
      "transport_failed",
    );
    expect(transportError.message).not.toContain("sensitive");
  });
});
