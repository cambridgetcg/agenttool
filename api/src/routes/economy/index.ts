/** Economy domain router — composes wallets · escrows · billing · crypto.
 *
 *  Mounted in api/src/index.ts as: app.route("/v1", economyRouter)
 *
 *  Path layout (preserves the original agent-economy API surface):
 *    /v1/wallets/...                       — wallet CRUD + fund + spend + policy + transactions
 *    /v1/wallets/:id/deposit-address       — derive multi-chain crypto deposit addr
 *    /v1/wallets/:id/onchain/{challenge,verify} — sovereign wallet binding (EIP-191)
 *    /v1/wallets/:id/{payout,payouts}      — outgoing crypto transfers
 *    /v1/escrows/...                        — escrow lifecycle
 *    /v1/billing/...                        — Stripe checkout + webhooks + usage check
 *    /v1/billing/crypto-webhook/:chain      — public, signature-verified inbound
 *                                             transfer ingestion (mounted at parent)
 *
 *  Doctrine: docs/CRYPTO-PAYMENT.md. */

import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";

import billingRouter from "./billing";
import cryptoRouter from "./crypto";
import escrowRouter from "./escrow";
import walletsRouter from "./wallets";

const app = new Hono<ProjectContext>();

app.route("/wallets", walletsRouter);
app.route("/", cryptoRouter); // mounts /v1/wallets/:id/{deposit-address,onchain,payout,payouts}
app.route("/escrows", escrowRouter);
app.route("/billing", billingRouter);

export default app;

// Public webhook router — caller mounts at /v1/billing/crypto-webhook so it
// is NOT auth-gated. Imported from the same crypto routes file.
export { cryptoWebhookRouter } from "./crypto";
