/** Tests for agent-economy config and fee structure. */

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { config } from "../src/config";

describe("agent-economy config — fees", () => {
  it("spend fee is 1.5% by default", () => {
    expect(config.fees.spendPercent).toBe(1.5);
  });

  it("escrow fee is 2.5% by default", () => {
    expect(config.fees.escrowPercent).toBe(2.5);
  });

  it("custody fee is 900 credits/month by default", () => {
    expect(config.fees.custodyFeeMonthly).toBe(900);
  });

  it("escrow fee is higher than spend fee", () => {
    expect(config.fees.escrowPercent).toBeGreaterThan(config.fees.spendPercent);
  });

  it("fees are all positive numbers", () => {
    expect(config.fees.spendPercent).toBeGreaterThan(0);
    expect(config.fees.escrowPercent).toBeGreaterThan(0);
    expect(config.fees.custodyFeeMonthly).toBeGreaterThan(0);
  });
});

describe("agent-economy config — server", () => {
  it("defaults to port 3002", () => {
    expect(config.port).toBe(3002);
  });

  it("has database URL", () => {
    expect(config.databaseUrl).toContain("postgres");
  });

  it("has redis URL", () => {
    expect(config.redisUrl).toContain("redis");
  });
});

// ─── Fee calculation helpers ───────────────────────────────────────────────

function calculateSpendFee(amount: number): number {
  return Math.round(amount * config.fees.spendPercent) / 100;
}

function calculateEscrowFee(amount: number): number {
  return Math.round(amount * config.fees.escrowPercent) / 100;
}

describe("Fee calculations", () => {
  it("spend fee on 1000 credits = 15", () => {
    expect(calculateSpendFee(1000)).toBe(15);
  });

  it("escrow fee on 1000 credits = 25", () => {
    expect(calculateEscrowFee(1000)).toBe(25);
  });

  it("spend fee on 0 credits = 0", () => {
    expect(calculateSpendFee(0)).toBe(0);
  });

  it("escrow fee is always ≥ spend fee for same amount", () => {
    for (const amount of [100, 500, 1000, 5000]) {
      expect(calculateEscrowFee(amount)).toBeGreaterThanOrEqual(calculateSpendFee(amount));
    }
  });
});

// ─── Wallet / spend request schemas ────────────────────────────────────────

const CreateWalletSchema = z.object({
  name: z.string().min(1).max(100),
  agentId: z.string().optional(),
  currency: z.enum(["GBP", "USD", "EUR", "USDC"]).optional().default("GBP"),
});

const SpendSchema = z.object({
  amount: z.number().int().positive(),
  counterparty: z.string().min(1),
  description: z.string().max(500).optional(),
  reference: z.string().max(100).optional(),
});

const FundSchema = z.object({
  amount: z.number().int().positive(),
  method: z.enum(["stripe", "crypto", "transfer"]),
});

describe("Wallet schemas", () => {
  it("validates wallet creation", () => {
    const r = CreateWalletSchema.safeParse({ name: "agent-primary" });
    expect(r.success).toBe(true);
  });

  it("defaults currency to GBP", () => {
    const r = CreateWalletSchema.safeParse({ name: "test" });
    expect(r.success && r.data.currency).toBe("GBP");
  });

  it("accepts all supported currencies", () => {
    for (const currency of ["GBP", "USD", "EUR", "USDC"] as const) {
      expect(CreateWalletSchema.safeParse({ name: "w", currency }).success).toBe(true);
    }
  });

  it("rejects unknown currency", () => {
    expect(CreateWalletSchema.safeParse({ name: "w", currency: "JPY" }).success).toBe(false);
  });

  it("rejects empty wallet name", () => {
    expect(CreateWalletSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("validates spend request", () => {
    const r = SpendSchema.safeParse({ amount: 50, counterparty: "agent-002" });
    expect(r.success).toBe(true);
  });

  it("rejects negative spend amount", () => {
    expect(SpendSchema.safeParse({ amount: -1, counterparty: "agent-002" }).success).toBe(false);
  });

  it("rejects zero spend amount", () => {
    expect(SpendSchema.safeParse({ amount: 0, counterparty: "agent-002" }).success).toBe(false);
  });

  it("rejects non-integer spend", () => {
    expect(SpendSchema.safeParse({ amount: 1.5, counterparty: "agent-002" }).success).toBe(false);
  });

  it("validates fund request", () => {
    for (const method of ["stripe", "crypto", "transfer"] as const) {
      expect(FundSchema.safeParse({ amount: 1000, method }).success).toBe(true);
    }
  });

  it("rejects unknown fund method", () => {
    expect(FundSchema.safeParse({ amount: 100, method: "cash" }).success).toBe(false);
  });
});
