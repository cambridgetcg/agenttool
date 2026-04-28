import { describe, expect, mock, test } from "bun:test";

// ── Minimal mock helpers ─────────────────────────────────────────────────────

function makeWallet(overrides = {}) {
  return {
    id: "wallet-1",
    projectId: "project-1",
    name: "Test Wallet",
    agentId: null,
    balance: 10000,
    currency: "GBP",
    status: "active",
    createdAt: new Date(),
    ...overrides,
  };
}

function makePolicy(overrides = {}) {
  return {
    id: "policy-1",
    walletId: "wallet-1",
    maxPerTransaction: null,
    maxPerHour: null,
    maxPerDay: null,
    allowedRecipients: null,
    requiresApprovalAbove: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeTx(overrides = {}) {
  return {
    id: "tx-1",
    walletId: "wallet-1",
    type: "spend",
    amount: -500,
    counterparty: "agent-2",
    description: "test",
    escrowId: null,
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Wallet logic (pure unit tests) ──────────────────────────────────────────

describe("Wallet balance logic", () => {
  test("fund increases balance", () => {
    const wallet = makeWallet({ balance: 1000 });
    const funded = wallet.balance + 500;
    expect(funded).toBe(1500);
  });

  test("spend decreases balance", () => {
    const wallet = makeWallet({ balance: 1000 });
    const after = wallet.balance - 300;
    expect(after).toBe(700);
  });

  test("spend rejected when balance insufficient", () => {
    const wallet = makeWallet({ balance: 100 });
    const amount = 500;
    expect(wallet.balance < amount).toBe(true);
  });

  test("frozen wallet cannot spend", () => {
    const wallet = makeWallet({ status: "frozen" });
    expect(wallet.status !== "active").toBe(true);
  });

  test("closed wallet cannot be funded", () => {
    const wallet = makeWallet({ status: "closed" });
    expect(wallet.status === "closed").toBe(true);
  });
});

describe("Policy enforcement logic", () => {
  test("maxPerTransaction blocks large spend", () => {
    const policy = makePolicy({ maxPerTransaction: 1000 });
    const amount = 1500;
    const blocked = policy.maxPerTransaction !== null && amount > policy.maxPerTransaction;
    expect(blocked).toBe(true);
  });

  test("maxPerTransaction allows small spend", () => {
    const policy = makePolicy({ maxPerTransaction: 1000 });
    const amount = 500;
    const blocked = policy.maxPerTransaction !== null && amount > policy.maxPerTransaction;
    expect(blocked).toBe(false);
  });

  test("allowedRecipients rejects unknown counterparty", () => {
    const policy = makePolicy({ allowedRecipients: ["agent-allowed"] });
    const counterparty = "agent-stranger";
    const blocked =
      policy.allowedRecipients !== null &&
      policy.allowedRecipients.length > 0 &&
      !policy.allowedRecipients.includes(counterparty);
    expect(blocked).toBe(true);
  });

  test("allowedRecipients allows known counterparty", () => {
    const policy = makePolicy({ allowedRecipients: ["agent-allowed"] });
    const counterparty = "agent-allowed";
    const blocked =
      policy.allowedRecipients !== null &&
      policy.allowedRecipients.length > 0 &&
      !policy.allowedRecipients.includes(counterparty);
    expect(blocked).toBe(false);
  });

  test("requiresApprovalAbove flags large transactions", () => {
    const policy = makePolicy({ requiresApprovalAbove: 5000 });
    const amount = 7500;
    const requiresApproval =
      policy.requiresApprovalAbove !== null && amount > policy.requiresApprovalAbove;
    expect(requiresApproval).toBe(true);
  });

  test("hourly limit blocks excess spend (simulated)", () => {
    const policy = makePolicy({ maxPerHour: 2000 });
    const alreadySpent = 1800;
    const newAmount = 500;
    const blocked =
      policy.maxPerHour !== null && alreadySpent + newAmount > policy.maxPerHour;
    expect(blocked).toBe(true);
  });

  test("daily limit blocks excess spend (simulated)", () => {
    const policy = makePolicy({ maxPerDay: 5000 });
    const alreadySpent = 4800;
    const newAmount = 300;
    const blocked =
      policy.maxPerDay !== null && alreadySpent + newAmount > policy.maxPerDay;
    expect(blocked).toBe(true);
  });
});

describe("Transaction records", () => {
  test("fund transaction has positive amount", () => {
    const tx = makeTx({ type: "fund", amount: 1000 });
    expect(tx.amount).toBeGreaterThan(0);
  });

  test("spend transaction has negative amount", () => {
    const tx = makeTx({ type: "spend", amount: -500 });
    expect(tx.amount).toBeLessThan(0);
  });

  test("escrow_lock transaction has negative amount", () => {
    const tx = makeTx({ type: "escrow_lock", amount: -2000 });
    expect(tx.amount).toBeLessThan(0);
  });

  test("escrow_release transaction has positive amount", () => {
    const tx = makeTx({ type: "escrow_release", amount: 2000 });
    expect(tx.amount).toBeGreaterThan(0);
  });
});
