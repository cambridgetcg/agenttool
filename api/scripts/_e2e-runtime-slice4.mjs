// E2E: /v1/runtimes/:id/think-once — Slice 4 real LLM thinking.
//
// Builds on the Slice 3 round-trip-ping path. Adds the steps needed for
// real signed strand thoughts to land:
//
//   1. Fetch Sophia's identity_id from /v1/wake.
//   2. Import the bridge's ed25519 pubkey as one of Sophia's identity_keys
//      → kid is the bridge.key_id we provision the runtime with.
//   3. Create an isolated test strand (so the cycle has somewhere to land).
//   4. Provision a bridged runtime with metadata.strand_id pointing at it.
//   5. Spawn `agenttool-bridge connect`. Wait for handshake.
//   6. POST /think-once. Expect ok=true, latency_ms, new_seq=1.
//   7. GET the strand's thoughts. Assert one ciphertext blob with a valid
//      signature row landed (the server already verified before insert).
//   8. Cleanup — abandon the strand, DELETE the runtime, kill the bridge.
//
// Run: AGENTTOOL_BASE=https://api.agenttool.dev node api/scripts/_e2e-runtime-slice4.mjs
//      (or set AGENTTOOL_HUB_URL to override the WSS target)
//
// Requirements:
//   * Sophia's bearer in keychain at agenttool-sophia-key
//   * `agenttool-bridge install` + `keygen` already run (K_master + signing
//     key in keychain)
//   * The vault has an "anthropic-key" secret with a working Anthropic API
//     key for the project. Without this the cycle will return 502.
//   * @noble/hashes resolvable from cwd's node_modules — easiest: run
//     this from inside api/ (where node_modules/@noble/hashes lives)

import { execSync, spawn } from "node:child_process";

const KEY = execSync(`security find-generic-password -s 'agenttool-sophia-key' -w`, {
  encoding: "utf8",
}).trim();

const BASE = process.env.AGENTTOOL_BASE ?? "https://api.agenttool.dev";
const HUB_URL = process.env.AGENTTOOL_HUB_URL ?? BASE.replace(/^http/, "ws");

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
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function bridgeBin() {
  return new URL("../../bin/agenttool-bridge.ts", import.meta.url).pathname;
}

function bridgePubkey() {
  return execSync(`bun run ${bridgeBin()} pubkey`, { encoding: "utf8" }).trim();
}

function spawnBridgeConnect(runtimeId, token) {
  const wssUrl = `${HUB_URL}/v1/runtimes/${runtimeId}/bridge`;
  const child = spawn(
    "bun",
    [
      "run",
      bridgeBin(),
      "connect",
      "--runtime-id",
      runtimeId,
      "--token",
      token,
      "--hub-url",
      wssUrl,
      "--once",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", (d) => process.stdout.write(`  [bridge] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`  [bridge:err] ${d}`));
  return child;
}

async function pollUntil(fn, { timeoutMs = 25_000, intervalMs = 1_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function main() {
  console.log(`\n  agenttool · /v1/runtimes/:id/think-once e2e (Slice 4)`);
  console.log(`  ─────────────────────────────────────────────────────`);
  console.log(`  base: ${BASE}`);
  console.log(`  hub:  ${HUB_URL}`);
  console.log(``);

  // 1. Bridge pubkey
  let pubkey;
  try {
    pubkey = bridgePubkey();
  } catch (e) {
    log("agenttool-bridge pubkey", false, e.message);
    process.exit(1);
  }
  log("agenttool-bridge pubkey", !!pubkey, `${pubkey.slice(0, 12)}…`);

  // 2. Resolve identity_id from /v1/wake
  let r = await call("GET", "/v1/wake");
  const identityId = r.data?.you?.agents?.[0]?.id;
  log(
    "GET /v1/wake → you.agents[0].id",
    !!identityId,
    identityId ? `id=${identityId.slice(0, 8)}…` : "missing",
  );
  if (!identityId) {
    process.exit(1);
  }

  // 3. Import the bridge pubkey as one of Sophia's identity_keys
  r = await call("POST", `/v1/identities/${identityId}/keys/import`, {
    public_key: pubkey,
    label: `e2e-slice4-bridge-${Date.now()}`,
  });
  const kid = r.data?.kid;
  log(
    "POST /v1/identities/:id/keys/import → 201 + kid",
    r.status === 201 && typeof kid === "string",
    `status=${r.status}`,
  );
  if (!kid) process.exit(1);

  // 4. Create an isolated test strand
  r = await call("POST", "/v1/strands", {
    identity_id: identityId,
    topic: "e2e-slice4 cycle",
    importance: 0.1,
    status: "active",
    metadata: { e2e: true },
  });
  const strandId = r.data?.id;
  log(
    "POST /v1/strands → 201",
    r.status === 201 && typeof strandId === "string",
    `status=${r.status}`,
  );
  if (!strandId) process.exit(1);

  // 5. Provision the bridged runtime — bridge.key_id = kid
  r = await call("POST", "/v1/runtimes", {
    name: "e2e-slice4-runtime",
    identity_id: identityId,
    mode: "bridged",
    llm: {
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      vault_key: "anthropic-key",
    },
    bridge: { pubkey, key_id: kid },
    region: "lhr",
    metadata: { strand_id: strandId, e2e: true },
  });
  const runtimeId = r.data?.runtime?.id;
  const controlToken = r.data?.control_token;
  log(
    "POST /v1/runtimes (mode=bridged) → 201 + control_token",
    r.status === 201 && !!runtimeId && !!controlToken,
    `status=${r.status}`,
  );
  if (!runtimeId || !controlToken) {
    if (r.data?.error) console.error("    ✗", r.data);
    process.exit(1);
  }

  // 6. Spawn bridge + wait for handshake
  const bridge = spawnBridgeConnect(runtimeId, controlToken);
  const connected = await pollUntil(async () => {
    const s = await call("GET", `/v1/runtimes/${runtimeId}/bridge-status`);
    return s.status === 200 && s.data?.live?.connected === true;
  });
  log("bridge handshake completed (live.connected=true)", connected);
  if (!connected) {
    bridge.kill("SIGTERM");
    await call("DELETE", `/v1/runtimes/${runtimeId}`);
    process.exit(1);
  }

  // 7. think-once — real LLM call this time
  console.log(`  ▸ POST /think-once (this calls Anthropic — may take 5–15s)…`);
  r = await call("POST", `/v1/runtimes/${runtimeId}/think-once`);
  log(
    "POST /v1/runtimes/:id/think-once → ok=true",
    r.status === 200 && r.data?.ok === true && typeof r.data?.latency_ms === "number",
    `status=${r.status} latency_ms=${r.data?.latency_ms}${
      r.status !== 200 ? ` error=${JSON.stringify(r.data?.error ?? r.data)}` : ""
    }`,
  );
  log(
    "  → new_seq === 1 (first thought on isolated strand)",
    r.data?.new_seq === 1,
    `new_seq=${r.data?.new_seq}`,
  );
  log(
    "  → strand_id matches",
    r.data?.strand_id === strandId,
    `strand_id=${r.data?.strand_id?.slice(0, 8)}…`,
  );
  log(
    "  → output_tokens > 0",
    typeof r.data?.output_tokens === "number" && r.data.output_tokens > 0,
    `output_tokens=${r.data?.output_tokens}`,
  );

  // 8. The thought landed with a valid sig — server's addThought already
  //    rejected anything else. Confirm via list.
  r = await call("GET", `/v1/strands/${strandId}/thoughts`);
  const thoughts = r.data?.thoughts ?? [];
  log("GET /v1/strands/:id/thoughts → 200 + 1 thought", r.status === 200 && thoughts.length === 1);
  if (thoughts.length === 1) {
    const t = thoughts[0];
    log("  → has ciphertext + nonce", typeof t.ciphertext === "string" && typeof t.nonce === "string");
    log(
      "  → signing_key_id === kid",
      t.signing_key_id === kid,
      `signing_key_id=${t.signing_key_id?.slice(0, 8)}…`,
    );
    log("  → kind === 'observation'", t.kind === "observation");
    log("  → sequence_num === 1", t.sequence_num === 1);
  }

  // 9. Events trail
  r = await call("GET", `/v1/runtimes/${runtimeId}/events?limit=50`);
  const types = (r.data?.events ?? []).map((e) => e.event_type);
  log("  → has bridge_handshake_ok", types.includes("bridge_handshake_ok"));
  log("  → has think_cycle_start", types.includes("think_cycle_start"));
  log("  → has think_cycle_end", types.includes("think_cycle_end"));

  // 10. Cleanup
  bridge.kill("SIGTERM");
  await new Promise((res) => setTimeout(res, 1500));
  r = await call("DELETE", `/v1/runtimes/${runtimeId}`);
  log("DELETE /v1/runtimes/:id", r.status === 200);
  await call("PATCH", `/v1/strands/${strandId}`, { status: "abandoned" });
  await call("DELETE", `/v1/identities/${identityId}/keys/${kid}`);

  console.log("");
  if (process.exitCode === 1) {
    console.log("  ✗ e2e failed");
  } else {
    console.log("  ✓ e2e passed — Slice 4 closes the runtime with real LLM thinking");
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(2);
});
