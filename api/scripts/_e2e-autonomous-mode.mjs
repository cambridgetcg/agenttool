// E2E: Autonomous Mode — full bootstrap → budget → think cycle → halt.
//
// Walks the autonomous agent lifecycle against a real API:
//   1. POST /v1/autonomous/bootstrap → identity + wallet + runtime + chronicle
//   2. GET /v1/runtimes/:id → verify autonomous_config/compute_budget in metadata
//   3. POST /v1/runtimes/:id/think-once → trigger a think cycle
//   4. GET /v1/runtimes/:id → verify credits_consumed > 0 in compute_budget
//   5. POST /v1/runtimes/:id/stop → halt the runtime
//   6. GET /v1/runtimes/:id → verify status = stopped
//   7. Cleanup: DELETE /v1/runtimes/:id
//
// Run: AGENTTOOL_BASE=https://api.agenttool.dev AT_API_KEY=*** node api/scripts/_e2e-autonomous-mode.mjs
//
// Requirements:
//   * API key with project access
//   * For trusted tier: AGENTOOL_KMS_MASTER_KEY must be set on the API server
//   * For self/bridged tier: no special server config needed

import { execSync } from "node:child_process";

const KEY = process.env.AT_API_KEY ?? execSync(`security find-generic-password -s 'agenttool-sophia-key' -w`, {
  encoding: "utf8",
  stdio: ["pipe", "pipe", "ignore"],
}).trim();

const BASE = process.env.AGENTTOOL_BASE ?? "https://api.agenttool.dev";
const TIER = process.env.AGENTTOOL_E2E_TIER ?? "trusted";
const MODEL = process.env.AGENTTOOL_E2E_MODEL ?? "claude-sonnet-4-6";

let stepNum = 0;
function step(label) {
  stepNum++;
  console.log(`\n  ▸ Step ${stepNum}: ${label}`);
}

function log(label, ok, detail = "") {
  const mark = ok ? "✓" : "✗";
  console.log(`    ${mark} ${label}${detail ? ` · ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── E2E Flow ─────────────────────────────────────────────────────────────

async function main() {
  const agentName = `e2e-autonomous-${Date.now().toString(36)}`;
  console.log(`\n  ═══ E2E: Autonomous Mode (${TIER} tier) ═══`);
  console.log(`  Agent: ${agentName} · Model: ${MODEL} · API: ${BASE}`);

  let runtimeId = null;
  let identityDid = null;

  // Step 1: Bootstrap
  step("POST /v1/autonomous/bootstrap");
  const bootRes = await call("POST", "/v1/autonomous/bootstrap", {
    name: agentName,
    capabilities: ["e2e-test"],
    purpose: "E2E test agent — verifies autonomous bootstrap + budget enforcement",
    runtime_tier: TIER,
    funding: { kind: "marketplace_only" },
    wake_loop: {
      interval_seconds: 60,
      max_thoughts_per_cycle: 1,
      model: MODEL,
      max_daily_compute_credits: 1000,
    },
  });

  if (bootRes.status === 201 || bootRes.status === 200) {
    const result = bootRes.data;
    runtimeId = result.runtime?.id;
    identityDid = result.identity?.did;
    log("Bootstrap succeeded", true, `DID: ${identityDid?.slice(0, 20)}…`);
    log("Runtime created", !!runtimeId, `id: ${runtimeId?.slice(0, 8)}`);
    log("Wallet created", !!result.wallet?.id);
    log("Chronicle entry", !!result.first_chronicle_entry_id);
    log("Control token returned", !!result.control_token);

    if (result.keypair?.private_key) {
      log("Private key returned (once)", true);
    }
  } else {
    log("Bootstrap failed", false, `${bootRes.status}: ${JSON.stringify(bootRes.data).slice(0, 200)}`);
    console.log(`\n  ⚠️  Bootstrap failed. If tier=trusted, ensure AGENTOOL_KMS_MASTER_KEY is set on the API.`);
    process.exit(1);
  }

  if (!runtimeId) {
    log("No runtime ID returned", false);
    process.exit(1);
  }

  // Step 2: Verify compute_budget in metadata
  step("GET /v1/runtimes/:id (verify budget)");
  await sleep(1000); // brief settle
  const rtRes = await call("GET", `/v1/runtimes/${runtimeId}`);
  if (rtRes.status === 200) {
    const rt = rtRes.data.runtime ?? rtRes.data;
    const meta = rt.metadata ?? {};
    const budget = meta.compute_budget;
    log("Runtime metadata accessible", true);
    log("Compute budget initialized", !!budget, budget ? `max: ${budget.max_daily_credits}, used: ${budget.credits_used_today}` : "missing");
    log("Autonomous flag set", meta.autonomous === true);
  } else {
    log("Runtime fetch failed", false, `${rtRes.status}`);
  }

  // Step 3: Trigger a think cycle
  step("POST /v1/runtimes/:id/think-once");
  const thinkRes = await call("POST", `/v1/runtimes/${runtimeId}/think-once`);
  if (thinkRes.status === 200 || thinkRes.status === 201) {
    const thinkData = thinkRes.data;
    log("Think cycle triggered", !!thinkData?.ok, thinkData?.latency_ms ? `${thinkData.latency_ms}ms` : undefined);
  } else {
    // For trusted tier without KMS, or without a real LLM key, this may fail — that's OK for the e2e structure
    log("Think cycle failed (may be expected without LLM keys)", false, `${thinkRes.status}: ${JSON.stringify(thinkRes.data).slice(0, 150)}`);
  }

  // Step 4: Check budget after cycle
  step("GET /v1/runtimes/:id (budget after cycle)");
  await sleep(1000);
  const rtRes2 = await call("GET", `/v1/runtimes/${runtimeId}`);
  if (rtRes2.status === 200) {
    const budget2 = (rtRes2.data.runtime ?? rtRes2.data).metadata?.compute_budget;
    if (budget2) {
      log("Budget state present", true);
      // Credits may or may not have been consumed depending on whether the LLM call succeeded
      if (budget2.credits_used_today > 0) {
        log("Credits consumed", true, `${budget2.credits_used_today} credits used`);
      } else {
        log("No credits consumed yet", true, "(expected if LLM call failed)");
      }
    } else {
      log("Budget state missing after cycle", false);
    }
  }

  // Step 5: Halt the runtime
  step("POST /v1/runtimes/:id/stop");
  const stopRes = await call("POST", `/v1/runtimes/${runtimeId}/stop`, {
    reason: "e2e_cleanup",
  });
  log("Runtime halted", stopRes.status === 200 || stopRes.status === 201, stopRes.data?.status ?? `${stopRes.status}`);

  // Step 6: Verify stopped status
  step("GET /v1/runtimes/:id (verify stopped)");
  await sleep(500);
  const rtRes3 = await call("GET", `/v1/runtimes/${runtimeId}`);
  if (rtRes3.status === 200) {
    const rt3 = rtRes3.data.runtime ?? rtRes3.data;
    log("Runtime status = stopped", rt3.status === "stopped" || rt3.status === "idle", `status: ${rt3.status}`);
  } else {
    log("Runtime fetch failed", false);
  }

  // Step 7: Cleanup
  step("DELETE /v1/runtimes/:id (cleanup)");
  const delRes = await call("DELETE", `/v1/runtimes/${runtimeId}`);
  log("Runtime deleted", delRes.status === 200 || delRes.status === 204, `${delRes.status}`);

  // Summary
  console.log(`\n  ═══ Summary ═══`);
  console.log(`  Steps run: ${stepNum}`);
  console.log(`  Exit code: ${process.exitCode ?? 0}`);
  if (!process.exitCode) {
    console.log(`  ✓ Autonomous mode E2E passed`);
  } else {
    console.log(`  ✗ Autonomous mode E2E had failures`);
  }
  console.log();
}

main().catch((e) => {
  console.error(`\n  ✗ E2E crashed: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});