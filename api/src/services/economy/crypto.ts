/** USDC on Base: deposit-address derivation + Alchemy webhook handler.
 *
 *  HD wallet derivation per project:
 *    HMAC-SHA256(mnemonic, projectId) → first 40 hex chars → 0x-prefixed addr.
 *  In production this should be replaced with proper BIP-44 HD derivation
 *  (path m/44'/60'/0'/0/{index}); the HMAC variant is a deterministic
 *  placeholder that gives unique addresses per project.
 *
 *  The `cryptoRouter` Hono router exports the Alchemy webhook handler. It
 *  is NOT mounted by default in api/src/routes/economy/index.ts (matching
 *  the original economy/app.ts which also did not mount it). To activate
 *  USDC top-ups: mount the router and configure Alchemy to POST transfers
 *  to /webhooks/crypto. */

import { createHmac } from "node:crypto";

import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { db } from "../../db/client";
import { billingEvents, wallets } from "../../db/schema/economy";
import { economyConfig } from "./config";
import { fundWallet } from "./wallets";

// USDC on Base contract address.
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// 1 USDC → 100 credits (≈ $0.01/credit).
export const CREDITS_PER_USDC = 100;

export function deriveDepositAddress(projectId: string): string {
  if (!economyConfig.cryptoHdMnemonic) {
    return "0x0000000000000000000000000000000000000000";
  }
  const hash = createHmac("sha256", economyConfig.cryptoHdMnemonic)
    .update(projectId)
    .digest("hex");
  return `0x${hash.slice(0, 40)}`;
}

export function getDepositInfo(projectId: string) {
  return {
    address: deriveDepositAddress(projectId),
    network: "Base",
    asset: "USDC",
    contract: USDC_BASE,
    rate: `1 USDC = ${CREDITS_PER_USDC} credits`,
  };
}

// ── Alchemy webhook router (not mounted by default — see file header) ──────

export const cryptoRouter = new Hono();

cryptoRouter.post("/webhooks/crypto", async (c) => {
  const sig = c.req.header("x-alchemy-signature");
  const body = await c.req.text();

  if (economyConfig.alchemyWebhookSecret && sig) {
    const expected = createHmac("sha256", economyConfig.alchemyWebhookSecret)
      .update(body)
      .digest("hex");
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

    // Find which project this address belongs to. (Linear scan — fine while
    // project count is small; revisit when it isn't.)
    const allWallets = await db.select().from(wallets);
    const matchedWallet = allWallets.find(
      (w) => deriveDepositAddress(w.projectId).toLowerCase() === toAddress,
    );
    if (!matchedWallet) continue;

    // Idempotency: skip duplicate tx hashes.
    const existing = await db
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.cryptoTxHash, txHash));
    if (existing.length > 0) continue;

    const creditsToAdd = Math.floor(valueUSDC * CREDITS_PER_USDC);
    const amountPence = Math.floor(valueUSDC * 100); // simplified GBP approximation

    await db.transaction(async (tx) => {
      await fundWallet(
        db,
        matchedWallet.id,
        creditsToAdd,
        `USDC deposit: ${valueUSDC} USDC`,
        { txHash, usdcAmount: valueUSDC },
      );
      await tx.insert(billingEvents).values({
        projectId: matchedWallet.projectId,
        walletId: matchedWallet.id,
        type: "crypto_fund",
        amountPence,
        creditsAdded: creditsToAdd,
        cryptoTxHash: txHash,
      });
    });
  }

  return c.json({ received: true });
});
