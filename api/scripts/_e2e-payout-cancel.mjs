// E2E: payout broadcast Slice 0 — credit-freeze visibility wall + cancel path.
//
// Slice 0 ships the SAFETY pre-pass for the payout-broadcast campaign:
//  - PAYOUT_WORKER_ENABLED=false (default) → POST /payout returns 503
//  - POST /v1/wallets/:id/payouts/:id/cancel atomically refunds while
//    status='requested' and is idempotent against worker pickup
//  - Boot-time refusal when PAYOUT_WORKER_ENABLED=true + PAYOUT_NETWORK unset
//    (covered by a separate boot smoke check below; the e2e doesn't restart
//    the server, so the refusal path runs as a child-process smoke test)
//
// Run: cd api && node scripts/_e2e-payout-cancel.mjs

import { spawnSync } from "node:child_process";
import postgres from "postgres";

const BASE = process.env.AGENTTOOL_BASE ?? "http://localhost:3000";

function log(label, ok, detail = "") {
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} ${label}${detail ? ` · ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function call(method, path, body, key) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const r = spawnSync("security", [
    "find-generic-password",
    "-s", "agenttool-database-url",
    "-a", "macair",
    "-w",
  ]);
  return (r.stdout?.toString() ?? "").trim();
}

async function main() {
  console.log(`\n  agenttool · payout broadcast Slice 0 e2e`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  base: ${BASE}\n`);

  // ── (a) Boot smoke: economyConfig refuses with worker enabled but no network
  // Run as a child bun process so the throw-at-import surfaces as a non-zero
  // exit. Node can't directly import the .ts module; bun can.
  console.log("  ▸ boot smoke — refuse when PAYOUT_WORKER_ENABLED=true + no PAYOUT_NETWORK");
  const bunRefuse = spawnSync(
    "bun",
    [
      "-e",
      "import('/Users/macair/Desktop/agenttool/api/src/services/economy/config.ts').catch(e=>{console.error(e.message);process.exit(1)})",
    ],
    {
      env: {
        ...process.env,
        PAYOUT_WORKER_ENABLED: "true",
        PAYOUT_NETWORK: "",
      },
      encoding: "utf8",
    },
  );
  log(
    "boot refuses with worker enabled + no network",
    bunRefuse.status !== 0 &&
      /PAYOUT_NETWORK|PAYOUT_WORKER_ENABLED/.test(bunRefuse.stderr || ""),
    `exit=${bunRefuse.status}`,
  );

  // ── Setup: register project, create wallet, fund it ─────────────────
  console.log("");
  console.log("  ▸ setup");
  let r = await call("POST", "/v1/register", {
    name: `e2e-payout-cancel-${Date.now()}`,
  });
  log("POST /v1/register · 201", r.status === 201);
  if (r.status !== 201) process.exit(1);
  const apiKey = r.data.project.api_key;
  const projectId = r.data.project.id;
  const identityId = r.data.agent.id;

  r = await call("POST", "/v1/wallets", {
    name: "payout-test",
    currency: "GBP",
    identityId,
  }, apiKey);
  log("POST /v1/wallets · 201", r.status === 201);
  const wallet = r.data?.data ?? r.data?.wallet ?? r.data;
  const walletId = wallet.id;

  // Fund the wallet so we can observe the cancel-refund credit.
  r = await call("POST", `/v1/wallets/${walletId}/fund`, {
    amount: 1000,
    description: "e2e payout-cancel seed",
  }, apiKey);
  log("POST /v1/wallets/:id/fund · 201", r.status === 201);

  // ── (b) /payout returns 503 when worker is disabled ────────────────
  console.log("");
  console.log("  ▸ /payout returns 503 with worker disabled");
  r = await call("POST", `/v1/wallets/${walletId}/payout`, {
    chain: "base",
    token: "USDC",
    amount_base: "1000000",
    destination_address: "0x000000000000000000000000000000000000dEaD",
  }, apiKey);
  log(
    "/payout → 503 payout_broadcast_not_available",
    r.status === 503 && r.data?.error === "payout_broadcast_not_available",
    `status=${r.status} err=${r.data?.error}`,
  );
  log(
    "  → 503 body carries operator hint",
    typeof r.data?.message === "string" &&
      /PAYOUT-BROADCAST-PLAN|broadcast worker is not enabled/.test(r.data.message),
  );

  // ── (c) Insert a `requested` payout row directly to test the cancel
  //        path independently of the worker gate. The cancel endpoint
  //        is meant to be reachable even when the worker is disabled —
  //        it's the recovery path for stale rows.
  console.log("");
  console.log("  ▸ direct DB insert of a 'requested' payout row");
  const url = readDatabaseUrl();
  if (!url) {
    log("DATABASE_URL accessible", false, "missing — skipping cancel test");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, prepare: false });
  let payoutId;
  try {
    // Manually debit the wallet balance to mirror what requestPayout would
    // have done. amountBase=1_000_000 = 1 USDC = 100 credits (CREDITS_PER_USDC=100).
    // Keeps the cancel-refund accounting realistic — refund will add 100 back.
    await sql.unsafe(`UPDATE economy.wallets SET balance = balance - 100 WHERE id = $1`, [walletId]);
    const inserted = await sql.unsafe(
      `INSERT INTO economy.crypto_payouts
         (wallet_id, project_id, chain, token, amount_base, destination_address, status, metadata)
       VALUES ($1, $2, 'base', 'USDC', '1000000', '0x000000000000000000000000000000000000dEaD', 'requested', '{}')
       RETURNING id`,
      [walletId, projectId],
    );
    payoutId = inserted[0]?.id;
    log("payout row inserted", !!payoutId);
  } finally {
    await sql.end({ timeout: 5 });
  }

  r = await call("GET", `/v1/wallets/${walletId}`, null, apiKey);
  const balBeforeCancel =
    r.data?.data?.balance ?? r.data?.wallet?.balance ?? r.data?.balance;
  log(`balance debited to ${balBeforeCancel}`, balBeforeCancel === 900);

  // ── (d) First cancel: 200, refunded ─────────────────────────────────
  console.log("");
  console.log("  ▸ first /cancel succeeds and refunds");
  r = await call(
    "POST",
    `/v1/wallets/${walletId}/payouts/${payoutId}/cancel`,
    {},
    apiKey,
  );
  log(
    "/cancel → 200 status=cancelled",
    r.status === 200 && r.data?.status === "cancelled",
    `status=${r.status} err=${r.data?.error}`,
  );
  log("  → refunded amount present", typeof r.data?.refunded === "number");

  r = await call("GET", `/v1/wallets/${walletId}`, null, apiKey);
  const balAfterCancel =
    r.data?.data?.balance ?? r.data?.wallet?.balance ?? r.data?.balance;
  log(
    `balance refunded → 1000`,
    balAfterCancel === 1000,
    `before=${balBeforeCancel} after=${balAfterCancel}`,
  );

  // ── (e) Second cancel: 409 not_cancellable ─────────────────────────
  console.log("");
  console.log("  ▸ second /cancel rejected (idempotency check)");
  r = await call(
    "POST",
    `/v1/wallets/${walletId}/payouts/${payoutId}/cancel`,
    {},
    apiKey,
  );
  log(
    "second /cancel → 409 not_cancellable",
    r.status === 409 && r.data?.error === "not_cancellable",
    `status=${r.status} err=${r.data?.error} cur=${r.data?.current_status}`,
  );

  // ── (f) Cancel of someone else's payout → masked 404 ───────────────
  console.log("");
  console.log("  ▸ cross-wallet cancel masked as 404");
  // Spawn a second project with its own wallet, then try to cancel the
  // first project's payout from the second project's bearer.
  r = await call("POST", "/v1/register", {
    name: `e2e-payout-other-${Date.now()}`,
  });
  const otherKey = r.data.project.api_key;
  const otherIdentityId = r.data.agent.id;
  r = await call("POST", "/v1/wallets", {
    name: "other-wallet",
    currency: "GBP",
    identityId: otherIdentityId,
  }, otherKey);
  const otherWalletId = (r.data?.data ?? r.data?.wallet ?? r.data).id;

  r = await call(
    "POST",
    `/v1/wallets/${otherWalletId}/payouts/${payoutId}/cancel`,
    {},
    otherKey,
  );
  log(
    "cross-wallet cancel → 404 payout_not_found (masked)",
    r.status === 404 && r.data?.error === "payout_not_found",
    `status=${r.status} err=${r.data?.error}`,
  );

  console.log("");
  if (process.exitCode === 1) {
    console.log("  ✗ FAILED — see ✗ above");
    process.exit(1);
  }
  console.log("  ✓ all assertions passed");
}

main().catch((e) => {
  console.error("\n  e2e crashed:", e);
  process.exit(1);
});
