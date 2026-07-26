import { describe, expect, test } from "bun:test";

import {
  AlchemyReadError,
  MAX_ALCHEMY_RESPONSE_BYTES,
  createAlchemyReadClient,
  type AlchemyReadTransport,
} from "../src/index.js";
import {
  ADDRESS_A,
  FakeTransport,
  HASH_A,
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

  test("requires transfer selectors, exact categories, bounded pages, and bounded ranges", async () => {
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
        pageKey: "\u001b[secret]",
      }),
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
