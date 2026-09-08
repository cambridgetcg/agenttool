/** Exercise settlement services with a transaction-boundary state change.
 * The fake preserves committed concurrent changes and rolls back failed work;
 * it does not substitute pure assertions for the actual purchase/invoke paths.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { escrows, transactions, wallets } from "../src/db/schema/economy";
import { identities } from "../src/db/schema/identity";
import {
  invocations,
  listings,
  platformRevenue,
  templatePurchases,
  templates,
} from "../src/db/schema/marketplace";

type Row = Record<string, any>;
const buyerId = "00000000-0000-4000-8000-000000000001";
const sellerId = "00000000-0000-4000-8000-000000000002";
const buyerProject = "00000000-0000-4000-8000-000000000003";
const sellerProject = "00000000-0000-4000-8000-000000000004";
const templateId = "00000000-0000-4000-8000-000000000005";
const listingId = "00000000-0000-4000-8000-000000000006";
const buyerIdentity = "00000000-0000-4000-8000-000000000007";
const sellerIdentity = "00000000-0000-4000-8000-000000000008";
const now = new Date("2026-09-04T12:00:00.000Z");
const dialect = new PgDialect();
let rows: Map<unknown, Row[]>;
let beforeTransaction: () => void;
let effects: unknown[];
let reads: Array<{ table: unknown; locked: boolean; ordered: boolean }>;

function matches(row: Row, predicate?: SQL): boolean {
  if (!predicate) return true;
  const query = dialect.sqlToQuery(predicate);
  return query.params.includes(row.id) &&
    (!query.sql.includes('"project_id"') || query.params.includes(row.projectId));
}

function select() {
  return {
    from(table: unknown) {
      let predicate: SQL | undefined;
      let locked = false;
      let ordered = false;
      const query = {
        where(value: SQL) { predicate = value; return query; },
        orderBy() { ordered = true; return query; },
        for() { locked = true; return query; },
        limit() { return query; },
        then(resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) {
          reads.push({ table, locked, ordered });
          const selected = (rows.get(table) ?? []).filter((row) => matches(row, predicate));
          return Promise.resolve(structuredClone(selected)).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

const tx = {
  select,
  insert(table: unknown) {
    return {
      values(values: Row) {
        effects.push(table);
        const row = {
          id: crypto.randomUUID(), createdAt: now, metadata: {}, escrowId: null,
          adoptionId: null, failureReason: null, status: "escrowed", ...values,
        };
        rows.set(table, [...(rows.get(table) ?? []), row]);
        return { returning: async () => [structuredClone(row)] };
      },
    };
  },
  update(table: unknown) {
    return {
      set(values: Row) {
        return {
          where(predicate: SQL) {
            effects.push(table);
            const selected = (rows.get(table) ?? []).filter((row) => matches(row, predicate));
            for (const row of selected) {
              for (const [key, value] of Object.entries(values)) {
                if (value && typeof value === "object" && "queryChunks" in value) {
                  const query = dialect.sqlToQuery(value as SQL);
                  row[key] += Number(query.params[0]);
                } else {
                  row[key] = value;
                }
              }
            }
            return { returning: async () => structuredClone(selected) };
          },
        };
      },
    };
  },
};

const db = {
  select,
  async transaction(run: (transaction: typeof tx) => Promise<unknown>) {
    // The freeze/transfer/archive commits before the transaction acquires locks.
    beforeTransaction();
    const committed = new Map([...rows].map(([table, entries]) => [table, structuredClone(entries)]));
    try {
      return await run(tx);
    } catch (error) {
      rows = committed;
      throw error;
    }
  },
};

mock.module("../src/db/client", () => ({ db }));
mock.module("../src/services/wake/push", () => ({ publishWakeEvent: async () => {} }));
const { purchaseTemplate } = await import("../src/services/marketplace/purchases");
const { invokeListing } = await import("../src/services/marketplace/invocations");

beforeEach(() => {
  beforeTransaction = () => {};
  effects = [];
  reads = [];
  rows = new Map<unknown, Row[]>([
    [wallets, [
      { id: buyerId, projectId: buyerProject, status: "active", currency: "GBP", balance: 2000 },
      { id: sellerId, projectId: sellerProject, status: "active", currency: "GBP", balance: 0 },
    ]],
    [templates, [{
      id: templateId, projectId: sellerProject, status: "active", visibility: "public",
      name: "Example", priceAmount: 1000, priceCurrency: "GBP", authorWalletId: sellerId,
      revenueTotal: 0, revenueCount: 0,
    }]],
    [listings, [{
      id: listingId, projectId: sellerProject, status: "active", visibility: "public",
      name: "Example", description: "A bounded example", priceAmount: 1000,
      priceCurrency: "GBP", sellerWalletId: sellerId, sellerIdentityId: sellerIdentity,
      capabilityTags: [], metadata: {}, disputePolicy: null, updatedAt: now,
      slaSeconds: null, invocationsCount: 0,
    }]],
    [identities, [{ id: buyerIdentity, projectId: buyerProject, did: "did:agenttool:buyer" }]],
  ]);
});

const purchase = () => purchaseTemplate({
  templateId, buyerProjectId: buyerProject, buyerIdentityId: buyerIdentity, buyerWalletId: buyerId,
});
const invoke = () => invokeListing({
  listingId, buyerProjectId: buyerProject, buyerIdentityId: buyerIdentity, buyerWalletId: buyerId,
  inputSealed: {
    ct: "YQ==", nonce: Buffer.alloc(24).toString("base64"),
    sender_pub: Buffer.alloc(32).toString("base64"),
  },
});

function changeWallet(id: string, change: Row) {
  Object.assign(rows.get(wallets)!.find((row) => row.id === id)!, change);
}

function expectNoSettlement() {
  expect(rows.get(wallets)!.find((row) => row.id === buyerId)!.balance).toBe(2000);
  expect(rows.get(wallets)!.find((row) => row.id === sellerId)!.balance).toBe(0);
  for (const table of [templatePurchases, invocations, escrows, transactions, platformRevenue]) {
    expect(rows.get(table) ?? []).toEqual([]);
  }
}

describe("template transaction locks", () => {
  test.each([
    [buyerId, { status: "frozen" }, "buyer_wallet_not_active"],
    [buyerId, { status: "closed" }, "buyer_wallet_not_active"],
    [buyerId, { projectId: sellerProject }, "buyer_wallet_not_found"],
    [buyerId, { currency: "USD" }, "currency_mismatch"],
    [sellerId, { status: "frozen" }, "author_wallet_not_active"],
    [sellerId, { projectId: buyerProject }, "author_wallet_missing"],
    [sellerId, { currency: "USD" }, "author_wallet_currency_mismatch"],
  ] as const)("refuses committed wallet change %s %j", async (id, change, error) => {
    beforeTransaction = () => changeWallet(id, change);
    await expect(purchase()).rejects.toThrow(error);
    expectNoSettlement();
    expect(effects).toEqual([]);
  });

  test.each([
    [{ status: "archived" }, "template_not_active"],
    [{ visibility: "private" }, "template_not_public"],
    [{ priceAmount: null }, "template_not_priced"],
  ] as const)("refuses committed template change %j", async (change, error) => {
    beforeTransaction = () => Object.assign(rows.get(templates)![0]!, change);
    await expect(purchase()).rejects.toThrow(error);
    expectNoSettlement();
    expect(effects).toEqual([]);
  });

  test("locks terms and wallets before settling one conserved fee split", async () => {
    const result = await purchase();
    expect(result.status).toBe("settled");
    expect(reads).toEqual([
      { table: templates, locked: true, ordered: false },
      { table: wallets, locked: true, ordered: true },
    ]);
    expect(rows.get(wallets)!.map((row) => row.balance)).toEqual([1000, 950]);
    expect(rows.get(platformRevenue)!.map((row) => row.amount)).toEqual([50]);
    expect(rows.get(transactions)!.map((row) => row.amount)).toEqual([-1000, 950]);
    expect(rows.get(templatePurchases)).toHaveLength(1);
    expect(rows.get(escrows)![0]!.status).toBe("released");
  });
});

describe("invocation debit lock", () => {
  test.each([
    [{ status: "frozen" }, "buyer_wallet_not_active"],
    [{ status: "closed" }, "buyer_wallet_not_active"],
    [{ projectId: sellerProject }, "buyer_wallet_not_found"],
    [{ currency: "USD" }, "currency_mismatch"],
  ] as const)("rechecks a wallet changed after the early read %j", async (change, error) => {
    beforeTransaction = () => changeWallet(buyerId, change);
    await expect(invoke()).rejects.toThrow(error);
    expectNoSettlement();
    expect(effects).not.toContain(wallets);
  });

  test("unchanged wallet locks its gross amount exactly once", async () => {
    const result = await invoke();
    expect(result.status).toBe("escrowed");
    expect(rows.get(wallets)!.map((row) => row.balance)).toEqual([1000, 0]);
    expect(rows.get(invocations)).toHaveLength(1);
    expect(rows.get(escrows)![0]!.amount).toBe(1000);
    expect(rows.get(transactions)!.map((row) => row.amount)).toEqual([-1000]);
    expect(rows.get(platformRevenue) ?? []).toEqual([]);
  });
});
