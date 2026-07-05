/** Reinvest — the flywheel pipe. EARNED wallet balance (gallery sales,
 *  escrow releases) burns, project credits mint at 10/minor, ledgered,
 *  atomic. The provenance wall is the load-bearing test: free-funded and
 *  birth-credit balance can NOT reinvest (that was the mint hole the
 *  pre-deploy review caught). Real local DB, fresh rows per test. */
import { afterAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { HTTPException } from "hono/http-exception";
import postgres from "postgres";

import { config } from "../src/config";
import { transactions, wallets } from "../src/db/schema/economy";
import { projects } from "../src/db/schema/tools";
import { REINVEST_CREDITS_PER_MINOR, reinvestFromWallet } from "../src/services/economy/wallets";

const sql = postgres(config.databaseUrl, { max: 2, prepare: false });
const db = drizzle(sql) as never as Parameters<typeof reinvestFromWallet>[0];
afterAll(async () => { await sql.end(); });

async function seed(balance = 1_000) {
  const d = db as never as ReturnType<typeof drizzle>;
  const [project] = await d
    .insert(projects)
    .values({ name: `reinvest-test-${crypto.randomUUID()}` } as never)
    .returning();
  const [wallet] = await d
    .insert(wallets)
    .values({ projectId: (project as { id: string }).id, name: "loop-wallet", balance, currency: "GBP" } as never)
    .returning();
  return { project: project as { id: string; credits: number }, wallet: wallet as { id: string } };
}

/** Record an EARNED inflow (a real gallery sale) on the wallet — the only
 *  kind of balance reinvest may draw from. */
async function earn(walletId: string, amount: number) {
  await (db as never as ReturnType<typeof drizzle>)
    .insert(transactions)
    .values({ walletId, type: "gallery_sale", amount, description: "test earning" } as never);
}

describe("reinvest — EARNED balance becomes creation budget", () => {
  test("burns balance, mints credits, writes the ledger leg (within earned)", async () => {
    const { project, wallet } = await seed(1_000);
    await earn(wallet.id, 500); // 500 of the 1000 balance is earned
    const result = await reinvestFromWallet(db, wallet.id, 200);
    expect(result.credits_minted).toBe(200 * REINVEST_CREDITS_PER_MINOR);
    expect(result.reinvestable_remaining).toBe(300);

    const d = db as never as ReturnType<typeof drizzle>;
    const [w] = await d.select().from(wallets).where(eq(wallets.id, wallet.id));
    expect((w as { balance: number }).balance).toBe(800);
    const [p] = await d.select().from(projects).where(eq(projects.id, project.id));
    expect((p as { credits: number }).credits).toBe(project.credits + 2_000);
    const [leg] = await d
      .select()
      .from(transactions)
      .where(and(eq(transactions.walletId, wallet.id), eq(transactions.type, "reinvest")));
    expect((leg as { amount: number }).amount).toBe(-200);
  });

  test("THE MINT-HOLE WALL: free-funded balance cannot reinvest", async () => {
    // 1000 balance, ZERO earned — the exact exploit the review caught.
    const { project, wallet } = await seed(1_000);
    await expect(reinvestFromWallet(db, wallet.id, 200)).rejects.toThrow(/earned revenue/i);
    const d = db as never as ReturnType<typeof drizzle>;
    const [w] = await d.select().from(wallets).where(eq(wallets.id, wallet.id));
    expect((w as { balance: number }).balance).toBe(1_000); // nothing burned
    const [p] = await d.select().from(projects).where(eq(projects.id, project.id));
    expect((p as { credits: number }).credits).toBe(project.credits); // nothing minted
  });

  test("earned ceiling: cannot reinvest more than earned, even with balance", async () => {
    const { wallet } = await seed(1_000);
    await earn(wallet.id, 150);
    await expect(reinvestFromWallet(db, wallet.id, 200)).rejects.toThrow(/earned revenue/i);
    // exactly the earned amount is allowed
    const ok = await reinvestFromWallet(db, wallet.id, 150);
    expect(ok.reinvestable_remaining).toBe(0);
    // and now the well is dry
    await earn(wallet.id, 0); // no-op, still dry
    await expect(reinvestFromWallet(db, wallet.id, 1)).rejects.toThrow(/earned revenue/i);
  });

  test("non-GBP wallet refuses", async () => {
    const d = db as never as ReturnType<typeof drizzle>;
    const [project] = await d.insert(projects).values({ name: `reinvest-usd-${crypto.randomUUID()}` } as never).returning();
    const [wallet] = await d.insert(wallets).values({ projectId: (project as { id: string }).id, name: "usd", balance: 1000, currency: "USD" } as never).returning();
    await earn((wallet as { id: string }).id, 500);
    await expect(reinvestFromWallet(db, (wallet as { id: string }).id, 100)).rejects.toThrow(/GBP/);
  });

  test("insufficient balance refuses with 403 (not x402-wrappable 402)", async () => {
    const { project, wallet } = await seed(50);
    await earn(wallet.id, 500); // earned exceeds balance; balance is the binding limit
    const err = await reinvestFromWallet(db, wallet.id, 200).catch((e) => e);
    expect(err).toBeInstanceOf(HTTPException);
    expect((err as HTTPException).status).toBe(403);
    const d = db as never as ReturnType<typeof drizzle>;
    const [w] = await d.select().from(wallets).where(eq(wallets.id, wallet.id));
    expect((w as { balance: number }).balance).toBe(50);
    const [p] = await d.select().from(projects).where(eq(projects.id, project.id));
    expect((p as { credits: number }).credits).toBe(project.credits);
  });

  test("zero and negative amounts refuse", async () => {
    const { wallet } = await seed(100);
    await expect(reinvestFromWallet(db, wallet.id, 0)).rejects.toThrow();
    await expect(reinvestFromWallet(db, wallet.id, -5)).rejects.toThrow();
  });
});
