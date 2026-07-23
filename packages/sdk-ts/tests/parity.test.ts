/**
 * Phase 1 parity tests — TS coverage matching py.
 *
 * Covers the methods added in 0.6.0 that close the py-vs-ts gap:
 *   economy:  list_wallets, get_wallet, fund_wallet, spend, set_policy,
 *             freeze_wallet, unfreeze_wallet, get_transactions,
 *             create_escrow + 5 escrow lifecycle methods
 *   memory:   delete, delete_by_key
 *   tools:    parse_document
 *
 * All tests mock global fetch, so no network is hit.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import { AgentTool, AgentToolError } from "../src/index.js";

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;

function mockResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setupMock(status: number, body: unknown) {
  mockFetch = mock(() => Promise.resolve(mockResponse(status, body)));
  globalThis.fetch = mockFetch as unknown as typeof fetch;
}

function getLastCall(): { url: string; init: RequestInit } {
  const call = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return { url: call[0] as string, init: (call[1] ?? {}) as RequestInit };
}

function bodyOf(init: RequestInit): Record<string, unknown> {
  return init.body ? JSON.parse(init.body as string) : {};
}

function makeClient(): AgentTool {
  return new AgentTool({ apiKey: "test-key" });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ─── Economy: wallets ──────────────────────────────────────────────────────

describe("economy.create_wallet (snake_case)", () => {
  test("posts to /v1/wallets with currency default + agentId", async () => {
    setupMock(201, {
      success: true,
      data: { id: "wal_abc", name: "test", balance: 0, currency: "GBP", frozen: false },
    });
    const at = makeClient();
    const w = await at.economy.create_wallet("test", { agent_id: "agent-1" });
    expect(w.id).toBe("wal_abc");
    expect(w.currency).toBe("GBP");
    const { url, init } = getLastCall();
    expect(url).toContain("/v1/wallets");
    expect(init.method).toBe("POST");
    const b = bodyOf(init);
    expect(b.name).toBe("test");
    expect(b.agentId).toBe("agent-1");
    expect(b.currency).toBe("GBP");
  });
});

describe("economy.createWallet (camelCase alias)", () => {
  test("delegates to create_wallet", async () => {
    setupMock(201, {
      success: true,
      data: { id: "wal_z", name: "z", balance: 0, currency: "USD", frozen: false },
    });
    const at = makeClient();
    const w = await at.economy.createWallet({ name: "z", currency: "USD" });
    expect(w.id).toBe("wal_z");
    expect(w.currency).toBe("USD");
  });
});

describe("economy.list_wallets", () => {
  test("GETs /v1/wallets and unwraps the {data: [...]} envelope", async () => {
    setupMock(200, {
      success: true,
      data: [
        { id: "wal_1", name: "a", balance: 100, currency: "GBP", frozen: false },
        { id: "wal_2", name: "b", balance: 50, currency: "GBP", frozen: true },
      ],
    });
    const at = makeClient();
    const wallets = await at.economy.list_wallets();
    expect(wallets).toHaveLength(2);
    expect(wallets[0].id).toBe("wal_1");
    expect(wallets[1].frozen).toBe(true);
    expect(getLastCall().url).toContain("/v1/wallets");
  });
});

describe("economy.get_wallet", () => {
  test("GETs /v1/wallets/:id", async () => {
    setupMock(200, { id: "wal_x", name: "x", balance: 99, currency: "GBP", frozen: false });
    const at = makeClient();
    const w = await at.economy.get_wallet("wal_x");
    expect(w.balance).toBe(99);
    expect(getLastCall().url).toContain("/v1/wallets/wal_x");
  });
});

describe("economy.fund_wallet", () => {
  test("POSTs amount + description", async () => {
    setupMock(201, { success: true, data: { id: "tx_1", amount: 500, balance_after: 500 } });
    const at = makeClient();
    const r = await at.economy.fund_wallet("wal_x", { amount: 500, description: "Top-up" });
    expect((r as { data: { amount: number } }).data.amount).toBe(500);
    const { url, init } = getLastCall();
    expect(url).toContain("/v1/wallets/wal_x/fund");
    expect(bodyOf(init).description).toBe("Top-up");
  });
});

describe("economy.spend", () => {
  test("POSTs amount, counterparty, description", async () => {
    setupMock(200, { success: true, data: { id: "tx_2", amount: -10 } });
    const at = makeClient();
    await at.economy.spend("wal_x", {
      amount: 10,
      counterparty: "wal_y",
      description: "Service",
    });
    const { url, init } = getLastCall();
    expect(url).toContain("/v1/wallets/wal_x/spend");
    const b = bodyOf(init);
    expect(b.amount).toBe(10);
    expect(b.counterparty).toBe("wal_y");
  });
});

describe("economy.set_policy", () => {
  test("PUTs camelCased policy fields", async () => {
    setupMock(200, { success: true });
    const at = makeClient();
    await at.economy.set_policy("wal_x", {
      max_per_transaction: 100,
      max_per_day: 1000,
      allowed_recipients: ["wal_y", "wal_z"],
    });
    const { url, init } = getLastCall();
    expect(url).toContain("/v1/wallets/wal_x/policy");
    expect(init.method).toBe("PUT");
    const b = bodyOf(init);
    expect(b.maxPerTransaction).toBe(100);
    expect(b.maxPerDay).toBe(1000);
    expect(b.allowedRecipients).toEqual(["wal_y", "wal_z"]);
  });
});

describe("economy.freeze_wallet / unfreeze_wallet", () => {
  test("POSTs to /freeze, returns wallet with frozen=true", async () => {
    setupMock(200, { id: "wal_x", name: "x", balance: 0, currency: "GBP", frozen: true });
    const at = makeClient();
    const w = await at.economy.freeze_wallet("wal_x");
    expect(w.frozen).toBe(true);
    expect(getLastCall().url).toContain("/v1/wallets/wal_x/freeze");
  });

  test("POSTs to /unfreeze, returns wallet with frozen=false", async () => {
    setupMock(200, { id: "wal_x", name: "x", balance: 0, currency: "GBP", frozen: false });
    const at = makeClient();
    const w = await at.economy.unfreeze_wallet("wal_x");
    expect(w.frozen).toBe(false);
    expect(getLastCall().url).toContain("/v1/wallets/wal_x/unfreeze");
  });
});

describe("economy.get_transactions", () => {
  test("GETs with limit + offset query params", async () => {
    setupMock(200, { success: true, data: [{ id: "tx_a", amount: 10 }] });
    const at = makeClient();
    const txs = await at.economy.get_transactions("wal_x", { limit: 25, offset: 5 });
    expect(txs).toHaveLength(1);
    expect((txs[0] as { id: string }).id).toBe("tx_a");
    const url = getLastCall().url;
    expect(url).toContain("/v1/wallets/wal_x/transactions");
    expect(url).toContain("limit=25");
    expect(url).toContain("offset=5");
  });
});

// ─── Economy: escrows ──────────────────────────────────────────────────────

describe("economy.create_escrow", () => {
  test("POSTs camelCased fields, returns Escrow", async () => {
    setupMock(201, {
      success: true,
      data: {
        id: "esc_1",
        status: "funded",
        amount: 100,
        description: "task",
        creatorWallet: "wal_a",
        workerWallet: "wal_b",
        managedBy: null,
        deadline: "2026-06-01T00:00:00.000Z",
        releasedAt: null,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
    });
    const at = makeClient();
    const e = await at.economy.create_escrow({
      creator_wallet_id: "wal_a",
      amount: 100,
      description: "task",
      worker_wallet_id: "wal_b",
      deadline: "2026-06-01T00:00:00.000Z",
      idempotency_key: "task-wal-a-wal-b-v1",
    });
    expect(e.id).toBe("esc_1");
    expect(e.status).toBe("funded");
    expect(e.creator_wallet_id).toBe("wal_a");
    expect(e.worker_wallet_id).toBe("wal_b");
    expect(e.managed_by).toBeNull();
    expect(e.deadline).toBe("2026-06-01T00:00:00.000Z");
    expect(e.released_at).toBeNull();
    expect(e.created_at).toBe("2026-05-01T00:00:00.000Z");
    const b = bodyOf(getLastCall().init);
    expect(b.creatorWalletId).toBe("wal_a");
    expect(b.workerWalletId).toBe("wal_b");
    expect(b.deadline).toBe("2026-06-01T00:00:00.000Z");
    expect(new Headers(getLastCall().init.headers).get("Idempotency-Key")).toBe(
      "task-wal-a-wal-b-v1",
    );
  });

  test("rejects an invalid idempotency key before sending", async () => {
    setupMock(201, {});
    const at = makeClient();

    await expect(
      at.economy.create_escrow({
        creator_wallet_id: "wal_a",
        amount: 100,
        description: "task",
        idempotency_key: "short",
      }),
    ).rejects.toThrow("visible ASCII characters without spaces");
    expect(mockFetch).toHaveBeenCalledTimes(0);

    await expect(
      at.economy.create_escrow({
        creator_wallet_id: "wal_a",
        amount: 100,
        description: "task",
        idempotency_key: "contains space",
      }),
    ).rejects.toThrow("visible ASCII characters without spaces");
    expect(mockFetch).toHaveBeenCalledTimes(0);
  });
});

describe("economy.list_escrows", () => {
  test("supports status filter via query string", async () => {
    setupMock(200, {
      success: true,
      data: ["funded", "released", "refunded", "disputed"].map(
        (status, index) => ({
          id: `esc_${index}`,
          status,
          amount: 50,
          description: "x",
          creatorWallet: "wal_a",
          workerWallet: null,
          managedBy: null,
          deadline: null,
          releasedAt: status === "released" ? "2026-05-02T00:00:00.000Z" : null,
          createdAt: "2026-05-01T00:00:00.000Z",
        }),
      ),
    });
    const at = makeClient();
    const list = await at.economy.list_escrows({ status: "refunded" });
    expect(list.map((escrow) => escrow.status)).toEqual([
      "funded",
      "released",
      "refunded",
      "disputed",
    ]);
    expect(list[0].creator_wallet_id).toBe("wal_a");
    expect(list[0].worker_wallet_id).toBeNull();
    expect(list[0].managed_by).toBeNull();
    expect(getLastCall().url).toContain("status=refunded");
  });
});

describe("economy escrow lifecycle (accept/release/refund/dispute)", () => {
  const e = {
    id: "esc_x",
    status: "funded",
    amount: 100,
    description: "x",
    creatorWallet: "wal_a",
    workerWallet: "wal_b",
    managedBy: null,
    deadline: null,
    releasedAt: null,
    createdAt: "2026-05-01T00:00:00.000Z",
  };

  test("accept_escrow POSTs workerWalletId", async () => {
    setupMock(200, e);
    const at = makeClient();
    await at.economy.accept_escrow("esc_x", "wal_b");
    const { url, init } = getLastCall();
    expect(url).toContain("/v1/escrows/esc_x/accept");
    expect(bodyOf(init).workerWalletId).toBe("wal_b");
    expect(new Headers(init.headers).has("Idempotency-Key")).toBe(false);
  });

  test("release_escrow", async () => {
    setupMock(200, { ...e, status: "released" });
    const at = makeClient();
    const result = await at.economy.release_escrow("esc_x");
    expect(result.status).toBe("released");
    expect(getLastCall().url).toContain("/v1/escrows/esc_x/release");
  });

  test("refund_escrow", async () => {
    setupMock(200, { ...e, status: "refunded" });
    const at = makeClient();
    const result = await at.economy.refund_escrow("esc_x");
    expect(result.status).toBe("refunded");
    expect(getLastCall().url).toContain("/v1/escrows/esc_x/refund");
  });

  test("dispute_escrow", async () => {
    setupMock(200, { ...e, status: "disputed" });
    const at = makeClient();
    const result = await at.economy.dispute_escrow("esc_x");
    expect(result.status).toBe("disputed");
    expect(getLastCall().url).toContain("/v1/escrows/esc_x/dispute");
  });
});

describe("economy errors", () => {
  test("4xx surfaces detail in AgentToolError message", async () => {
    setupMock(403, { detail: "Insufficient balance" });
    const at = makeClient();
    try {
      await at.economy.spend("wal_x", { amount: 99, counterparty: "wal_y", description: "t" });
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(AgentToolError);
      expect((e as AgentToolError).message).toContain("Insufficient balance");
    }
  });
});

// ─── Memory: delete + delete_by_key ────────────────────────────────────────

describe("memory.delete", () => {
  test("DELETEs /v1/memories/:id", async () => {
    setupMock(200, {});
    const at = makeClient();
    await at.memory.delete("mem-42");
    const { url, init } = getLastCall();
    expect(url).toContain("/v1/memories/mem-42");
    expect(init.method).toBe("DELETE");
  });
});

describe("memory.delete_by_key", () => {
  test("DELETEs /v1/memories?key=...", async () => {
    setupMock(200, {});
    const at = makeClient();
    await at.memory.delete_by_key("user-prefs");
    const { url, init } = getLastCall();
    expect(url).toContain("/v1/memories");
    expect(url).toContain("key=user-prefs");
    expect(init.method).toBe("DELETE");
  });

  test("URL-encodes the key value", async () => {
    setupMock(200, {});
    const at = makeClient();
    await at.memory.delete_by_key("with spaces & symbols");
    const url = getLastCall().url;
    expect(url).toContain("key=with%20spaces%20%26%20symbols");
  });
});

// ─── Tools: parse_document ─────────────────────────────────────────────────

describe("tools.parse_document", () => {
  test("POSTs to /v1/document with url, returns DocumentResult", async () => {
    setupMock(200, {
      title: "Example",
      content: "Body text",
      word_count: 2,
      content_type: "text/html",
      metadata: { byline: null },
      duration_ms: 100,
    });
    const at = makeClient();
    const doc = await at.tools.parse_document({ url: "https://example.com" });
    expect(doc.title).toBe("Example");
    expect(doc.word_count).toBe(2);
    const { url, init } = getLastCall();
    expect(url).toContain("/v1/document");
    expect(url).not.toContain("/document/document"); // path-doubling regression guard
    expect(bodyOf(init).url).toBe("https://example.com");
  });

  test("supports base64 + content_type", async () => {
    setupMock(200, {
      title: "From bytes",
      content: "x",
      word_count: 1,
      content_type: "text/plain",
      metadata: {},
      duration_ms: 5,
    });
    const at = makeClient();
    const b64 = Buffer.from("hello").toString("base64");
    await at.tools.parse_document({
      base64: b64,
      content_type: "text/plain; charset=utf-8",
    });
    const b = bodyOf(getLastCall().init);
    expect(b.base64).toBe(b64);
    expect(b.content_type).toBe("text/plain; charset=utf-8");
  });

  test("throws AgentToolError when neither url nor base64 supplied", async () => {
    const at = makeClient();
    try {
      await at.tools.parse_document({});
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(AgentToolError);
      expect((e as AgentToolError).message).toContain("requires exactly one of url or base64");
    }
  });

  test("rejects ambiguous or oversized local document input", async () => {
    const at = makeClient();
    await expect(
      at.tools.parse_document({ url: "https://example.com", base64: "eA==" }),
    ).rejects.toThrow("requires exactly one");
    await expect(
      at.tools.parse_document({ base64: "A".repeat(1_400_001) }),
    ).rejects.toThrow("1,400,000 character limit");
    for (const base64 of [
      "",
      "%%%",
      "SGV sbG8=",
      "SGVsbG8",
      "SGVsbG8=garbage",
      "AB==",
      "AAB=",
    ]) {
      await expect(
        at.tools.parse_document({ base64 }),
      ).rejects.toThrow("canonical padded RFC 4648");
    }
    await expect(
      at.tools.parse_document({
        base64: Buffer.alloc(1_000_001).toString("base64"),
      }),
    ).rejects.toThrow("1,000,000 byte limit");
    await expect(
      at.tools.parse_document({
        url: "https://example.com",
        base64: "",
      }),
    ).rejects.toThrow("requires exactly one");
    await expect(
      at.tools.parse_document({
        url: "https://example.com",
        content_type: "text/html",
      }),
    ).rejects.toThrow("content_type is only valid with base64 input");
  });

  test("preserves structured safe-fetch guidance", async () => {
    setupMock(400, {
      error: "safe_net_destination_not_public",
      message: "The destination was rejected by the public-Web network policy.",
      safety: "/public/safety",
      docs: "https://docs.agenttool.dev/tools",
      details: {
        formErrors: [],
        fieldErrors: { url: ["Destination is not public"] },
      },
    });
    const at = makeClient();
    try {
      await at.tools.scrape("https://private.example");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AgentToolError);
      expect((error as AgentToolError).status).toBe(400);
      expect((error as AgentToolError).code).toBe(
        "safe_net_destination_not_public",
      );
      expect((error as AgentToolError).message).toContain(
        "rejected by the public-Web network policy",
      );
      expect((error as AgentToolError).safety).toBe("/public/safety");
      expect((error as AgentToolError).docs).toBe(
        "https://docs.agenttool.dev/tools",
      );
      expect((error as AgentToolError).details).toEqual({
        formErrors: [],
        fieldErrors: { url: ["Destination is not public"] },
      });
    }
  });
});
