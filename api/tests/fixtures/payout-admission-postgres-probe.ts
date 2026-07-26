/** One-request subprocess probe for the real payout HTTP handler.
 *
 * The parent integration test supplies a dedicated disposable PostgreSQL URL
 * through the child environment. Keeping the route import in this fresh
 * process guarantees that the shared Drizzle client binds to that database,
 * even when Bun runs other database tests in the parent process. */

import { Hono } from "hono";

import type { ProjectContext } from "../../src/auth/middleware";

const databaseUrl =
  process.env.PAYOUT_ADMISSION_TEST_DATABASE_URL?.trim() ?? "";
const projectId = process.env.PAYOUT_ADMISSION_TEST_PROJECT_ID?.trim() ?? "";
const walletId = process.env.PAYOUT_ADMISSION_TEST_WALLET_ID?.trim() ?? "";
const idempotencyKey =
  process.env.PAYOUT_ADMISSION_TEST_IDEMPOTENCY_KEY?.trim() ?? "";

if (!databaseUrl || !projectId || !walletId || !idempotencyKey) {
  throw new Error("payout admission probe configuration is incomplete");
}

// The shared DB client reads these values when the route is imported below.
process.env.DATABASE_URL = databaseUrl;
process.env.DATABASE_SESSION_URL = databaseUrl;
process.env.AGENTTOOL_DISABLE_WORKERS = "1";

const { default: cryptoRouter } =
  await import("../../src/routes/economy/crypto");

const app = new Hono<ProjectContext>();
app.use("*", async (c, next) => {
  c.set("project", { id: projectId } as never);
  await next();
});
app.route("/v1", cryptoRouter);

const response = await app.request(`/v1/wallets/${walletId}/payout`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "Idempotency-Key": idempotencyKey,
  },
  body: JSON.stringify({
    chain: "base",
    token: "USDC",
    amount_base: "1250000",
    destination_address: "0x1111111111111111111111111111111111111111",
    metadata: { reason: "real-postgres resting proof" },
  }),
});

await Bun.write(
  Bun.stdout,
  JSON.stringify({
    status: response.status,
    idempotencySupported: response.headers.get("X-Idempotency-Supported"),
    body: await response.json(),
  }),
);

// The imported singleton owns an idle Postgres pool that is intentionally not
// exported. This one-shot probe has completed all I/O, so terminate instead of
// waiting for its idle timeout.
process.exit(0);
