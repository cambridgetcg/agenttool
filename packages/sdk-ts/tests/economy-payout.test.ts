import { afterEach, describe, expect, mock, test } from "bun:test";

import {
  AgentTool,
  AgentToolError,
  type RequestPayoutOpts,
} from "../src/index.js";

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;

function mockResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setupMock(status: number, body: unknown): void {
  mockFetch = mock(() => Promise.resolve(mockResponse(status, body)));
  globalThis.fetch = mockFetch as unknown as typeof fetch;
}

function makeClient(): AgentTool {
  return new AgentTool({ apiKey: "test-key" });
}

function lastCall(): { url: string; init: RequestInit } {
  const call = mockFetch.mock.calls.at(-1);
  if (!call) throw new Error("expected one fetch call");
  return {
    url: call[0] as string,
    init: (call[1] ?? {}) as RequestInit,
  };
}

const payoutRequest: RequestPayoutOpts = {
  chain: "base",
  token: "USDC",
  amount_base: "1500000",
  destination_address: "0x1111111111111111111111111111111111111111",
  metadata: { purpose: "settlement", sequence: 7 },
  idempotency_key: "settlement-wallet-7-v1",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("economy.request_payout", () => {
  test("sends exact base units and the required key only as a header", async () => {
    setupMock(202, {
      id: "pay_1",
      status: "requested",
      broadcast_pending: true,
      replayed: false,
      note: "Recorded once.",
    });

    const outcome = await makeClient().economy.request_payout(
      "wal_1",
      payoutRequest,
    );

    expect(outcome).toEqual({
      id: "pay_1",
      status: "requested",
      broadcast_pending: true,
      replayed: false,
      note: "Recorded once.",
    });

    const { url, init } = lastCall();
    expect(url).toEndWith("/v1/wallets/wal_1/payout");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe(
      payoutRequest.idempotency_key,
    );
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      chain: "base",
      token: "USDC",
      amount_base: "1500000",
      destination_address: payoutRequest.destination_address,
      metadata: { purpose: "settlement", sequence: 7 },
    });
    expect(body).not.toHaveProperty("idempotency_key");
  });

  test("surfaces the durable replay decision and current payout state", async () => {
    setupMock(202, {
      id: "pay_1",
      status: "confirmed",
      broadcast_pending: false,
      replayed: true,
    });

    const outcome = await makeClient().economy.request_payout(
      "wal_1",
      payoutRequest,
    );

    expect(outcome.replayed).toBe(true);
    expect(outcome.status).toBe("confirmed");
    expect(outcome.broadcast_pending).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("rejects missing or malformed keys before transport", async () => {
    setupMock(202, {});
    const invalidKeys: unknown[] = [
      undefined,
      "1234567",
      "contains space",
      "line\nbreak",
      "12345678\n",
      "éééééééé",
      "x".repeat(257),
    ];

    for (const idempotencyKey of invalidKeys) {
      await expect(
        makeClient().economy.request_payout("wal_1", {
          ...payoutRequest,
          idempotency_key: idempotencyKey,
        } as unknown as RequestPayoutOpts),
      ).rejects.toThrow(
        "idempotency_key must be 8-256 visible ASCII characters without spaces",
      );
    }

    expect(mockFetch).toHaveBeenCalledTimes(0);
  });

  test("does not retry a server failure", async () => {
    setupMock(503, { error: "payout_daily_total_unavailable" });

    await expect(
      makeClient().economy.request_payout("wal_1", payoutRequest),
    ).rejects.toBeInstanceOf(AgentToolError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("economy.list_payouts", () => {
  test("returns typed rows without converting exact base units to numbers", async () => {
    setupMock(200, {
      wallet_id: "wal_1",
      payouts: [
        {
          id: "pay_2",
          chain: "ethereum",
          token: "USDC",
          amount_base: "9007199254740991",
          destination_address: "0x2222222222222222222222222222222222222222",
          status: "broadcast",
          tx_hash: "0xabc",
          requested_at: "2026-07-26T12:00:00.000Z",
          confirmed_at: null,
        },
      ],
      count: 1,
    });

    const payouts = await makeClient().economy.list_payouts("wal_1");

    expect(payouts).toEqual([
      {
        id: "pay_2",
        chain: "ethereum",
        token: "USDC",
        amount_base: "9007199254740991",
        destination_address: "0x2222222222222222222222222222222222222222",
        status: "broadcast",
        tx_hash: "0xabc",
        requested_at: "2026-07-26T12:00:00.000Z",
        confirmed_at: null,
      },
    ]);
    expect(typeof payouts[0]?.amount_base).toBe("string");
    expect(lastCall().url).toEndWith("/v1/wallets/wal_1/payouts");
    expect(lastCall().init.method).toBe("GET");
  });
});
