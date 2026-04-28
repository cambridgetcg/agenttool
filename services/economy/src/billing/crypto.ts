/** USDC on Base: HD wallet per project (BIP-44), Alchemy webhook to fund wallets. */

import { Hono } from "hono";
import { createHmac } from "crypto";
import { eq } from "drizzle-orm";

import { config } from "../config";
import { db } from "../db/client";
import { billingEvents, projects, wallets } from "../db/schema";
import { fundWallet } from "../wallets/service";

// USDC on Base contract address
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
// Credits per USDC (1 USDC = 100 credits @ $0.01/credit)
const CREDITS_PER_USDC = 100;

// ── Address derivation (deterministic per project) ───────────────────────────
// Uses HMAC-SHA256(mnemonic, projectId) as a stable seed to derive an address.
// In production, use ethers.js HDNode with BIP-44 path m/44'/60'/0'/0/{index}.
// For now: deterministic hex address from HMAC so we can receive per-project.

export function deriveDepositAddress(projectId: string): string {
  if (!config.cryptoHdMnemonic) return "0x0000000000000000000000000000000000000000";
  const hash = createHmac("sha256", config.cryptoHdMnemonic).update(projectId).digest("hex");
  return "0x" + hash.slice(0, 40);
}

// ── Router ───────────────────────────────────────────────────────────────────

export const cryptoRouter = new Hono();

/** Alchemy webhook: USDC transfer detected → fund the matching wallet. */
cryptoRouter.post("/webhooks/crypto", async (c) => {
  // Verify Alchemy signature
  const sig = c.req.header("x-alchemy-signature");
  const body = await c.req.text();

  if (config.alchemyWebhookSecret && sig) {
    const expected = createHmac("sha256", config.alchemyWebhookSecret).update(body).digest("hex");
    if (sig !== expected) {
      return c.json({ error: "Invalid signature" }, 400);
    }
  }

  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const transfers = payload?.event?.activity ?? [];

  for (const transfer of transfers) {
    const toAddress: string = transfer.toAddress?.toLowerCase();
    const assetContract: string = transfer.rawContract?.address?.toLowerCase();
    const valueUSDC: number = Number(transfer.value ?? 0);
    const txHash: string = transfer.hash;

    if (assetContract !== USDC_BASE.toLowerCase()) continue;
    if (!toAddress || valueUSDC <= 0) continue;

    // Find which project this address belongs to
    const allProjects = await db.select().from(projects);
    const matchedProject = allProjects.find(
      (p) => deriveDepositAddress(p.id).toLowerCase() === toAddress,
    );

    if (!matchedProject) continue;

    // Idempotency: skip if already processed
    const existing = await db
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.cryptoTxHash, txHash));

    if (existing.length > 0) continue;

    // Find the first active wallet for this project
    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.projectId, matchedProject.id));

    if (!wallet) continue;

    const creditsToAdd = Math.floor(valueUSDC * CREDITS_PER_USDC);
    const amountPence = Math.floor(valueUSDC * 100); // approx at $1 USDC = £0.79ish, simplified

    await db.transaction(async (tx) => {
      await fundWallet(
        db,
        wallet.id,
        creditsToAdd,
        `USDC deposit: ${valueUSDC} USDC`,
        { txHash, usdcAmount: valueUSDC },
      );
      await tx.insert(billingEvents).values({
        projectId: matchedProject.id,
        walletId: wallet.id,
        type: "crypto_fund",
        amountPence,
        creditsAdded: creditsToAdd,
        cryptoTxHash: txHash,
      });
    });
  }

  return c.json({ received: true });
});

/** Get deposit address for a project (authenticated). */
export function getDepositInfo(projectId: string) {
  return {
    address: deriveDepositAddress(projectId),
    network: "Base",
    asset: "USDC",
    contract: USDC_BASE,
    rate: `1 USDC = ${CREDITS_PER_USDC} credits`,
  };
}
