/** Crypto billing routes — deposit address + webhook receiver. */

import { Hono } from "hono";
import crypto from "crypto";
import type { ProjectContext } from "../../auth/middleware";
import { authMiddleware } from "../../auth/middleware";
import { getDepositAddress, USDC_BASE_CONTRACT } from "../../billing/crypto/wallet";
import { handleAlchemyWebhook } from "../../billing/crypto/webhook";
import { config } from "../../config";

const app = new Hono();

/**
 * GET /v1/billing/crypto — return project's USDC deposit address.
 * Auth-protected.
 */
const authed = new Hono<ProjectContext>();
authed.use("*", authMiddleware);

authed.get("/", async (c) => {
  const project = c.get("project");

  try {
    const { address } = getDepositAddress(project.id);
    return c.json({
      network: "Base (L2)",
      token: "USDC",
      contract: USDC_BASE_CONTRACT,
      deposit_address: address,
      note: "Send USDC on Base network to this address. Credits are added automatically upon confirmation.",
    });
  } catch (err: any) {
    return c.json({ error: "Crypto payments are not configured" }, 503);
  }
});

app.route("/", authed);

/**
 * POST /v1/billing/crypto/webhook — Alchemy webhook receiver.
 * No auth middleware — verified via Alchemy signing key.
 */
app.post("/webhook", async (c) => {
  // Verify Alchemy signature
  const sig = c.req.header("x-alchemy-signature");
  if (!sig || !config.alchemyWebhookSecret) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.text();
  const expected = crypto
    .createHmac("sha256", config.alchemyWebhookSecret)
    .update(body)
    .digest("hex");

  if (sig !== expected) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  const payload = JSON.parse(body);
  await handleAlchemyWebhook(payload);

  return c.json({ received: true });
});

export default app;
