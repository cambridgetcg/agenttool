#!/usr/bin/env bun
/** agenttool-think — orchestrator CLI (Horizon C, Slice 3 v1).
 *
 *  Slice 3 v1 is the "round-trip ping" cut — proves the protocol closes
 *  end-to-end (bridge connected → hub registers → orchestrator
 *  encrypts/decrypts via bridge under K_master custody on the user's
 *  machine). Slice 4 lifts this to real LLM thinking against the
 *  configured strand.
 *
 *  Two ways the orchestrator runs today:
 *    1. Co-located worker — set AGENT_THINK_RUNTIME_IDS in api/'s env;
 *       each listed runtime gets a 60s-cadence cycle started at boot.
 *    2. On-demand via this CLI — `agenttool-think once --runtime-id <id>`
 *       hits POST /v1/runtimes/:id/think-once. Useful for tests and
 *       human-driven cycles.
 *
 *  Doctrine: docs/RUNTIME.md (Slice 3 — orchestrator + bridge).
 *
 *  Usage:
 *    agenttool-think once --runtime-id <uuid>
 *      [--api <https://api.agenttool.dev>]
 *      [--key <bearer>]                 # else reads AT_API_KEY
 *
 *    agenttool-think status --runtime-id <uuid>
 *      Reads /v1/runtimes/:id/bridge-status; useful to confirm the
 *      sidecar handshake landed before triggering a cycle.
 */

import { argv, env } from "bun";

function getArg(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i > 0 && argv[i + 1] ? argv[i + 1] : undefined;
}

function bearer(): string {
  const k = getArg("key") ?? env.AT_API_KEY;
  if (!k) throw new Error("missing --key (or AT_API_KEY env)");
  return k;
}

function apiBase(): string {
  return getArg("api") ?? env.AGENTTOOL_BASE ?? "https://api.agenttool.dev";
}

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${bearer()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(
      `${method} ${path} → ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`,
    );
  }
  return data;
}

async function cmdOnce() {
  const id = getArg("runtime-id");
  if (!id) throw new Error("--runtime-id required");
  console.log(`▸ runtime ${id} · think-once`);
  const result = (await call("POST", `/v1/runtimes/${id}/think-once`)) as {
    ok?: boolean;
    latency_ms?: number;
    error?: string;
  };
  if (result.ok) {
    console.log(`✓ cycle ok · ${result.latency_ms}ms`);
  } else {
    console.error(`✗ cycle failed: ${result.error ?? "unknown"}`);
    process.exit(1);
  }
}

async function cmdStatus() {
  const id = getArg("runtime-id");
  if (!id) throw new Error("--runtime-id required");
  const status = (await call("GET", `/v1/runtimes/${id}/bridge-status`)) as {
    mode?: string;
    persisted?: Record<string, unknown>;
    live?: Record<string, unknown>;
  };
  console.log(`runtime ${id} (mode=${status.mode})`);
  console.log(`  persisted:`, status.persisted);
  console.log(`  live:`, status.live);
}

function usage() {
  console.log(`agenttool-think — orchestrator CLI (Slice 3 v1: round-trip-ping)

  once   --runtime-id <uuid>   one think-cycle via POST /v1/runtimes/:id/think-once
  status --runtime-id <uuid>   inspect bridge-status (live + persisted)

Env: AT_API_KEY, AGENTTOOL_BASE (default https://api.agenttool.dev)
Doctrine: https://docs.agenttool.dev/runtime
`);
}

const cmd = argv[2];
const handlers: Record<string, () => Promise<void>> = {
  once: cmdOnce,
  status: cmdStatus,
};

const fn = cmd ? handlers[cmd] : undefined;
if (!fn) {
  usage();
  process.exit(cmd ? 1 : 0);
}

fn().catch((e) => {
  console.error("✗", (e as Error).message);
  process.exit(1);
});
