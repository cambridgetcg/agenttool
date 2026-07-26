/** E2E: per-wallet payout policies (Slice 6).
 *
 *  Tests that each policy gate returns the right error BEFORE the credit
 *  debit, leaving the wallet's balance unchanged. Walls verified:
 *    1. payout_below_min — amount < payout_min_base
 *    2. payout_dual_control_required — amount ≥ threshold (dual-control
 *       flow not yet implemented; threshold is a hard ceiling for v1)
 *    3. destination_not_allowlisted — destination not in allowlist
 *    4. payout_exceeds_daily_ceiling — rolling 24h sum exceeds ceiling
 *
 *  No chain operation is created. The daily-ceiling fixture rows use
 *  `status='broadcast'` only so the policy query counts them; they carry a
 *  null tx_hash plus explicit fixture metadata and are terminalized in the
 *  outer finally path.
 *
 *  Run: cd api && bun scripts/_e2e-payout-policies.ts
 */

import { spawnSync } from "node:child_process";

import postgres from "postgres";

const BASE = process.env.AGENTTOOL_BASE ?? "http://localhost:3000";
const ALLOWED_DEST = "0x000000000000000000000000000000000000dEaD";
const FORBIDDEN_DEST = "0x0000000000000000000000000000000000000123";
const FIXTURE_ERROR = "synthetic_policy_fixture_no_chain_operation";
const FIXTURE_SEED_METADATA = {
  fixture_kind: "payout_policy_e2e_daily_ceiling",
  fixture_version: 1,
  lifecycle: "seeded",
  source: "api/scripts/_e2e-payout-policies.ts",
} as const;
const FIXTURE_TERMINAL_METADATA = {
  ...FIXTURE_SEED_METADATA,
  lifecycle: "terminal",
  outcome: FIXTURE_ERROR,
} as const;

interface FixtureCleanup {
  databaseUrl: string;
  payoutIds: string[];
}

let pendingFixtureCleanup: FixtureCleanup | undefined;

async function terminalizeFixtureRows(
  cleanup: FixtureCleanup,
): Promise<void> {
  if (cleanup.payoutIds.length === 0) return;

  const uniqueIds = [...new Set(cleanup.payoutIds)];
  const sql = postgres(cleanup.databaseUrl, {
    max: 1,
    prepare: false,
  });
  try {
    const terminalized = await sql.unsafe<Array<{ id: string }>>(
      `UPDATE economy.crypto_payouts
       SET status = 'failed',
           tx_hash = NULL,
           error = $2,
           metadata = $3::jsonb
       WHERE id = ANY($1::uuid[])
         AND metadata = $4::jsonb
       RETURNING id`,
      [
        uniqueIds,
        FIXTURE_ERROR,
        JSON.stringify(FIXTURE_TERMINAL_METADATA),
        JSON.stringify(FIXTURE_SEED_METADATA),
      ],
    );
    if (terminalized.length !== uniqueIds.length) {
      throw new Error(
        `fixture_cleanup_mismatch: expected=${uniqueIds.length} actual=${terminalized.length}`,
      );
    }
    log(
      "synthetic daily-ceiling rows terminalized",
      true,
      `count=${terminalized.length}`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function readDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const r = spawnSync(
    "security",
    ["find-generic-password", "-s", "agenttool-database-url", "-a", "macair", "-w"],
    { encoding: "utf8" },
  );
  return (r.stdout ?? "").trim();
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  key?: string,
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function log(label: string, ok: boolean, detail = "") {
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} ${label}${detail ? ` · ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  console.log("");
  console.log("  AgentTool — Slice 6 payout-policies e2e");
  console.log("  ─────────────────────────────────────────");
  console.log(`  base: ${BASE}`);

  // Setup
  console.log("");
  console.log("  ▸ setup");
  const reg = await call("POST", "/v1/register", {
    name: `e2e-policies-${Date.now()}`,
  });
  log("POST /v1/register · 201", reg.status === 201);
  if (reg.status !== 201) throw new Error("project_registration_failed");
  const apiKey = reg.data.project.api_key;
  const identityId = reg.data.agent.id;

  const w = await call(
    "POST",
    "/v1/wallets",
    { name: "policies-test", currency: "USDC", identityId },
    apiKey,
  );
  log("POST /v1/wallets · 201", w.status === 201);
  const walletId: string = (w.data?.data ?? w.data?.wallet ?? w.data).id;

  // Fund credits — enough to cover any single test payout (we're not
  // actually broadcasting, just exercising the policy gates).
  await call(
    "POST",
    `/v1/wallets/${walletId}/fund`,
    { amount: 10_000, description: "e2e policies seed" },
    apiKey,
  );

  // Configure the policy row directly via DB (no public API for setting
  // policies yet — that's its own slice). Set all four gates to known
  // values so each can be tested independently.
  console.log("");
  console.log("  ▸ install policy");
  const url = readDatabaseUrl();
  if (!url) {
    log("DATABASE_URL accessible", false, "missing");
    throw new Error("database_url_missing");
  }
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    // Constraint: dual-control threshold MUST be < daily ceiling, otherwise
    // the threshold is unreachable below the ceiling and dual-control can
    // never be the SOLE failure mode (the ceiling check fires first per
    // checkPayoutPolicy's order: min → allowlist → ceiling → dual-control).
    //   min          = 0.1  USDC (100_000 base)
    //   ceiling      = 10   USDC (10_000_000 base)
    //   threshold    = 5    USDC (5_000_000 base)
    //   allowlist    = [ALLOWED_DEST]
    await sql.unsafe(
      `INSERT INTO economy.policies
         (wallet_id, payout_min_base, payout_daily_ceiling_base,
          payout_destination_allowlist, payout_dual_control_threshold_base)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [walletId, "100000", "10000000", [ALLOWED_DEST], "5000000"],
    );
    log("policy row inserted", true);
  } finally {
    await sql.end({ timeout: 5 });
  }

  // Capture starting balance to verify atomicity.
  const startBal = await call("GET", `/v1/wallets/${walletId}`, undefined, apiKey);
  const start = startBal.data?.data?.balance ?? startBal.data?.wallet?.balance ?? startBal.data?.balance;

  // ── Wall 1: amount below min (50_000 < 100_000) ───────────────────
  console.log("");
  console.log("  ▸ wall: payout_below_min");
  let r = await call(
    "POST",
    `/v1/wallets/${walletId}/payout`,
    {
      chain: "ethereum",
      token: "USDC",
      amount_base: "50000",
      destination_address: ALLOWED_DEST,
    },
    apiKey,
  );
  log(
    "below-min → 403 payout_below_min",
    r.status === 403 && r.data?.error === "payout_below_min",
    `status=${r.status} err=${r.data?.error}`,
  );

  // ── Wall 2: dual-control threshold (5_500_000 ≥ 5_000_000 threshold,
  //    but < 10_000_000 ceiling — so dual-control fires alone)
  console.log("");
  console.log("  ▸ wall: payout_dual_control_required");
  r = await call(
    "POST",
    `/v1/wallets/${walletId}/payout`,
    {
      chain: "ethereum",
      token: "USDC",
      amount_base: "5500000",
      destination_address: ALLOWED_DEST,
    },
    apiKey,
  );
  log(
    "≥threshold → 403 payout_dual_control_required",
    r.status === 403 && r.data?.error === "payout_dual_control_required",
    `status=${r.status} err=${r.data?.error}`,
  );

  // ── Wall 3: destination not in allowlist ──────────────────────────
  console.log("");
  console.log("  ▸ wall: destination_not_allowlisted");
  r = await call(
    "POST",
    `/v1/wallets/${walletId}/payout`,
    {
      chain: "ethereum",
      token: "USDC",
      amount_base: "200000",
      destination_address: FORBIDDEN_DEST,
    },
    apiKey,
  );
  log(
    "non-allowlisted → 403 destination_not_allowlisted",
    r.status === 403 && r.data?.error === "destination_not_allowlisted",
    `status=${r.status} err=${r.data?.error}`,
  );

  // ── Atomicity check: balance unchanged after 3 rejections ─────────
  console.log("");
  console.log("  ▸ atomicity — wallet balance unchanged after rejections");
  let bal = await call("GET", `/v1/wallets/${walletId}`, undefined, apiKey);
  let cur = bal.data?.data?.balance ?? bal.data?.wallet?.balance ?? bal.data?.balance;
  log(
    `balance preserved at ${start}`,
    cur === start,
    `start=${start} cur=${cur}`,
  );

  // ── Wall 4: daily ceiling.
  //
  //  Testing the daily-ceiling check via the live API + worker is racy:
  //  the dispatcher polls every 10s and may flip 'requested' rows to
  //  'failed' (no on-chain funds at the test wallet's derived address),
  //  which excludes them from the daily sum. The check itself is correct;
  //  we just need to test it deterministically.
  //
  //  Approach: DB-insert two prior 'broadcast' rows totalling 8_000_000
  //  base (= 8 USDC). Then the 3rd request via API for 4_000_000 (= 4
  //  USDC) pushes the rolling sum to 12M > 10M ceiling and must reject.
  console.log("");
  console.log("  ▸ wall: payout_exceeds_daily_ceiling");
  const sql2 = postgres(url, { max: 1, prepare: false });
  const fixturePayoutIds: string[] = [];
  pendingFixtureCleanup = {
    databaseUrl: url,
    payoutIds: fixturePayoutIds,
  };
  try {
    for (let remaining = 2; remaining > 0; remaining -= 1) {
      const inserted = await sql2.unsafe<Array<{ id: string }>>(
        `INSERT INTO economy.crypto_payouts
           (wallet_id, project_id, chain, token, amount_base,
            destination_address, status, tx_hash, metadata, requested_at)
         VALUES ($1, $2, 'ethereum', 'USDC', '4000000',
                 $3, 'broadcast', NULL, $4::jsonb, NOW())
         RETURNING id`,
        [
          walletId,
          reg.data.project.id,
          ALLOWED_DEST,
          JSON.stringify(FIXTURE_SEED_METADATA),
        ],
      );
      const payoutId = inserted[0]?.id;
      if (!payoutId) throw new Error("fixture_insert_missing_id");
      fixturePayoutIds.push(payoutId);
    }
    log(
      "seeded two identity-free prior broadcasts (8M total)",
      true,
    );
  } finally {
    await sql2.end({ timeout: 5 });
  }

  // 3rd payout pushes the running 24h sum above the 10M ceiling.
  r = await call(
    "POST",
    `/v1/wallets/${walletId}/payout`,
    {
      chain: "ethereum",
      token: "USDC",
      amount_base: "4000000",
      destination_address: ALLOWED_DEST,
    },
    apiKey,
  );
  log(
    "request that pushes past ceiling → 403 payout_exceeds_daily_ceiling",
    r.status === 403 && r.data?.error === "payout_exceeds_daily_ceiling",
    `status=${r.status} err=${r.data?.error}`,
  );

  // Atomicity: balance unchanged from `start` — none of the four rejected
  // requests (below_min, dual_control, not_allowlisted, exceeds_ceiling)
  // touched the wallet balance. The seeded DB rows were inserted directly
  // and don't involve the wallet's credit balance.
  console.log("");
  console.log("  ▸ atomicity — wallet balance untouched by all four rejections");
  bal = await call("GET", `/v1/wallets/${walletId}`, undefined, apiKey);
  cur = bal.data?.data?.balance ?? bal.data?.wallet?.balance ?? bal.data?.balance;
  log(
    `balance preserved at ${start}`,
    cur === start,
    `start=${start} cur=${cur}`,
  );

  console.log("");
  if (process.exitCode === 1) {
    console.log("  ✗ FAILED — see ✗ above");
    throw new Error("payout_policy_assertions_failed");
  }
}

async function run(): Promise<void> {
  try {
    await main();
  } finally {
    const cleanup = pendingFixtureCleanup;
    pendingFixtureCleanup = undefined;
    if (cleanup) await terminalizeFixtureRows(cleanup);
  }
  console.log("  ✓ all assertions passed; fixture rows terminalized");
}

run().catch((e) => {
  console.error("\ne2e crashed:", e);
  process.exitCode = 1;
});
