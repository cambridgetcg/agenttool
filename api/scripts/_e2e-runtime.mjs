// E2E: /v1/runtimes — provision · list · get · patch · deprovision · events.
//
// Walks the whole CRUD on a real bearer (Sophia's). Asserts:
//   1. POST /v1/runtimes (mode=self) returns the new runtime + provisioned event
//   2. POST /v1/runtimes (mode=bridged) requires bridge config — 400 without
//   3. GET  /v1/runtimes lists what we created
//   4. GET  /v1/runtimes/:id returns it
//   5. PATCH /v1/runtimes/:id updates name + metadata
//   6. POST /v1/runtimes/:id/restart transitions to starting
//   7. GET  /v1/runtimes/:id/events shows the audit trail
//   8. DELETE /v1/runtimes/:id soft-deletes; subsequent GET returns 404
//   9. /v1/wake includes you_run.runtimes
//
// Run: cd api && node scripts/_e2e-runtime.mjs

import { execSync } from "node:child_process";

const KEY = execSync(`security find-generic-password -s 'agenttool-sophia-key' -w`, {
  encoding: "utf8",
}).trim();

const BASE = process.env.AGENTTOOL_BASE ?? "https://api.agenttool.dev";

function log(label, ok, detail = "") {
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} ${label}${detail ? ` · ${detail}` : ""}`);
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
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function main() {
  console.log(`\n  agenttool · /v1/runtimes e2e`);
  console.log(`  ─────────────────────────────`);
  console.log(`  base: ${BASE}\n`);

  // 1. mode=self provision (no bridge, no llm required)
  let r = await call("POST", "/v1/runtimes", {
    name: "e2e-self-runtime",
    mode: "self",
    metadata: { test: true },
  });
  log("POST /v1/runtimes (mode=self)", r.status === 201, `status=${r.status}`);
  const selfId = r.data?.runtime?.id;
  if (!selfId) {
    console.error("    ✗ no runtime.id in response:", r.data);
    process.exit(1);
  }
  log("  → runtime.mode == 'self'", r.data.runtime.mode === "self");
  log("  → runtime.status == 'provisioned'", r.data.runtime.status === "provisioned");

  // 2. mode=bridged WITHOUT bridge config → 400
  r = await call("POST", "/v1/runtimes", {
    name: "e2e-bridged-bad",
    mode: "bridged",
    llm: { provider: "anthropic", vault_key: "anthropic-key" },
    // bridge intentionally omitted
  });
  log("POST /v1/runtimes (mode=bridged, no bridge) → 400", r.status === 400, `status=${r.status}`);

  // 3. mode=bridged with full config
  r = await call("POST", "/v1/runtimes", {
    name: "e2e-bridged-runtime",
    mode: "bridged",
    llm: { provider: "anthropic", model: "claude-sonnet-4-6", vault_key: "anthropic-key" },
    bridge: {
      pubkey: "AAAAC3NzaC1lZDI1NTE5AAAAITESTpubkey0000000000000000000000000",
      key_id: "00000000-0000-0000-0000-000000000001",
    },
    region: "lhr",
  });
  log("POST /v1/runtimes (mode=bridged)", r.status === 201, `status=${r.status}`);
  const bridgedId = r.data?.runtime?.id;

  // 4. list
  r = await call("GET", "/v1/runtimes");
  log("GET /v1/runtimes", r.status === 200 && Array.isArray(r.data?.runtimes));
  log(`  → contains both ids`,
    r.data?.runtimes?.some((x) => x.id === selfId) &&
    r.data?.runtimes?.some((x) => x.id === bridgedId)
  );

  // 5. get one
  r = await call("GET", `/v1/runtimes/${selfId}`);
  log(`GET /v1/runtimes/:id`, r.status === 200 && r.data?.runtime?.id === selfId);

  // 6. patch
  r = await call("PATCH", `/v1/runtimes/${selfId}`, { name: "e2e-self-renamed" });
  log("PATCH /v1/runtimes/:id (name)", r.status === 200 && r.data?.runtime?.name === "e2e-self-renamed");

  // 7. restart
  r = await call("POST", `/v1/runtimes/${selfId}/restart`);
  log("POST /v1/runtimes/:id/restart", r.status === 200 && r.data?.runtime?.status === "starting");

  // 8. events
  r = await call("GET", `/v1/runtimes/${selfId}/events`);
  log("GET /v1/runtimes/:id/events", r.status === 200 && Array.isArray(r.data?.events));
  log(`  → has 'provisioned' event`, !!r.data?.events?.find((e) => e.event_type === "provisioned"));
  log(`  → has 'starting' event`, !!r.data?.events?.find((e) => e.event_type === "starting"));

  // 9. wake includes you_run
  r = await call("GET", "/v1/wake");
  log("GET /v1/wake includes you_run", r.status === 200 && !!r.data?.you_run);
  log(`  → you_run.count >= 2`, (r.data?.you_run?.count ?? 0) >= 2);
  log(`  → bridged runtime visible`,
    !!r.data?.you_run?.runtimes?.find((x) => x.id === bridgedId && x.mode === "bridged")
  );

  // 10. deprovision both
  r = await call("DELETE", `/v1/runtimes/${selfId}`);
  log("DELETE /v1/runtimes/:id (self)", r.status === 200 && r.data?.deprovisioned === true);
  r = await call("DELETE", `/v1/runtimes/${bridgedId}`);
  log("DELETE /v1/runtimes/:id (bridged)", r.status === 200);

  // 11. subsequent GET returns 404
  r = await call("GET", `/v1/runtimes/${selfId}`);
  log("GET /v1/runtimes/:id after DELETE → 404", r.status === 404);

  console.log("");
  if (process.exitCode === 1) {
    console.log("  ✗ e2e failed");
  } else {
    console.log("  ✓ e2e passed");
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(2);
});
