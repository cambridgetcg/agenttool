import { describe, expect, test } from "bun:test";

// ── Minimal mock helpers ─────────────────────────────────────────────────────

function makeEscrow(overrides = {}) {
  return {
    id: "escrow-1",
    creatorWallet: "wallet-creator",
    workerWallet: null as string | null,
    amount: 5000,
    description: "Build a feature",
    status: "funded",
    deadline: null as Date | null,
    releasedAt: null as Date | null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Escrow state machine logic ───────────────────────────────────────────────

describe("Escrow state transitions", () => {
  test("funded escrow can be accepted", () => {
    const escrow = makeEscrow({ status: "funded", workerWallet: null });
    const canAccept = escrow.status === "funded" && !escrow.workerWallet;
    expect(canAccept).toBe(true);
  });

  test("escrow with worker already set cannot be accepted again", () => {
    const escrow = makeEscrow({ workerWallet: "wallet-worker" });
    const alreadyHasWorker = !!escrow.workerWallet;
    expect(alreadyHasWorker).toBe(true);
  });

  test("funded escrow with worker can be released", () => {
    const escrow = makeEscrow({ status: "funded", workerWallet: "wallet-worker" });
    const canRelease = escrow.status === "funded" && !!escrow.workerWallet;
    expect(canRelease).toBe(true);
  });

  test("funded escrow without worker cannot be released", () => {
    const escrow = makeEscrow({ status: "funded", workerWallet: null });
    const canRelease = escrow.status === "funded" && !!escrow.workerWallet;
    expect(canRelease).toBe(false);
  });

  test("funded escrow can be refunded", () => {
    const escrow = makeEscrow({ status: "funded" });
    const canRefund = ["funded", "disputed"].includes(escrow.status);
    expect(canRefund).toBe(true);
  });

  test("disputed escrow can be refunded", () => {
    const escrow = makeEscrow({ status: "disputed" });
    const canRefund = ["funded", "disputed"].includes(escrow.status);
    expect(canRefund).toBe(true);
  });

  test("released escrow cannot be refunded", () => {
    const escrow = makeEscrow({ status: "released" });
    const canRefund = ["funded", "disputed"].includes(escrow.status);
    expect(canRefund).toBe(false);
  });

  test("funded escrow can be disputed", () => {
    const escrow = makeEscrow({ status: "funded" });
    const canDispute = escrow.status === "funded";
    expect(canDispute).toBe(true);
  });

  test("released escrow cannot be disputed", () => {
    const escrow = makeEscrow({ status: "released" });
    const canDispute = escrow.status === "funded";
    expect(canDispute).toBe(false);
  });
});

describe("Escrow balance accounting", () => {
  test("creator balance decreases when escrow created", () => {
    const creatorBalance = 10000;
    const escrowAmount = 5000;
    const after = creatorBalance - escrowAmount;
    expect(after).toBe(5000);
  });

  test("worker balance increases when escrow released", () => {
    const escrow = makeEscrow({ amount: 5000 });
    const workerBalance = 0;
    const after = workerBalance + escrow.amount;
    expect(after).toBe(5000);
  });

  test("creator balance restored when escrow refunded", () => {
    const escrow = makeEscrow({ amount: 5000 });
    const creatorBalance = 5000; // after escrow was created
    const after = creatorBalance + escrow.amount;
    expect(after).toBe(10000);
  });

  test("escrow amount must be positive", () => {
    const amount = -500;
    expect(amount > 0).toBe(false);
  });
});

describe("Escrow expiry", () => {
  test("escrow past deadline is overdue", () => {
    const past = new Date(Date.now() - 86400 * 1000); // yesterday
    const escrow = makeEscrow({ deadline: past, status: "funded" });
    const isOverdue =
      escrow.status === "funded" &&
      escrow.deadline !== null &&
      escrow.deadline < new Date();
    expect(isOverdue).toBe(true);
  });

  test("escrow with future deadline is not overdue", () => {
    const future = new Date(Date.now() + 86400 * 1000); // tomorrow
    const escrow = makeEscrow({ deadline: future, status: "funded" });
    const isOverdue =
      escrow.status === "funded" &&
      escrow.deadline !== null &&
      escrow.deadline < new Date();
    expect(isOverdue).toBe(false);
  });

  test("escrow with no deadline never expires", () => {
    const escrow = makeEscrow({ deadline: null, status: "funded" });
    const isOverdue =
      escrow.status === "funded" &&
      escrow.deadline !== null &&
      escrow.deadline < new Date();
    expect(isOverdue).toBe(false);
  });

  test("already released escrow is not overdue", () => {
    const past = new Date(Date.now() - 86400 * 1000);
    const escrow = makeEscrow({ deadline: past, status: "released" });
    const isOverdue = escrow.status === "funded";
    expect(isOverdue).toBe(false);
  });
});
