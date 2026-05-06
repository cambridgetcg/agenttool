/** Economy domain router — composes wallets · escrows · billing.
 *
 *  Mounted in api/src/index.ts as: app.route("/v1", economyRouter)
 *
 *  Path layout (preserves the original agent-economy API surface):
 *    /v1/wallets/...        — wallet CRUD + fund + spend + policy + transactions
 *    /v1/escrows/...        — escrow lifecycle
 *    /v1/billing/...        — Stripe checkout + webhooks + usage check
 *
 *  The Alchemy USDC webhook handler lives in services/economy/crypto.ts but
 *  is not mounted here (matching the original economy/app.ts which also did
 *  not mount it). Activate it explicitly when USDC top-ups are wanted. */

import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";

import billingRouter from "./billing";
import escrowRouter from "./escrow";
import walletsRouter from "./wallets";

const app = new Hono<ProjectContext>();

app.route("/wallets", walletsRouter);
app.route("/escrows", escrowRouter);
app.route("/billing", billingRouter);

export default app;
