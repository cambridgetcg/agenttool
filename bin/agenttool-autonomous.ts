#!/usr/bin/env bun
/** agenttool-autonomous — CLI for spawning and managing autonomous agents.
 *
 *  Wraps POST /v1/autonomous/bootstrap and related endpoints.
 *  This is the operator-facing tool for bringing autonomous agents
 *  into existence on the agenttool.dev platform.
 *
 *  Commands:
 *    spawn     — provision a new autonomous agent (identity + wallet +
 *                expression + runtime + chronicle; not transactionally atomic)
 *    list      — list autonomous runtimes (those with compute_budget)
 *    budget    — inspect a runtime's compute budget state
 *    halt      — stop a runtime (transitions to 'stopped')
 *    resume    — resume a stopped runtime
 *
 *  Usage:
 *    agenttool-autonomous spawn \
 *      --name "Painter" \
 *      --tier bridged \
 *      --model "claude-sonnet-4-6" \
 *      --interval 300 \
 *      --max-credits 10000 \
 *      --funding marketplace_only \
 *      [--purpose "Create art for the marketplace"] \
 *      [--capabilities "art,generation"] \
 *      [--parent-did did:at:xxx] \
 *      [--byok-secret vault-key-name] \
 *      [--api https://api.agenttool.dev] \
 *      [--key <bearer>]
 *
 *    agenttool-autonomous list [--api ...] [--key ...]
 *    agenttool-autonomous budget --runtime-id <uuid> [--api ...] [--key ...]
 *    agenttool-autonomous halt --runtime-id <uuid> [--api ...] [--key ...]
 *    agenttool-autonomous resume --runtime-id <uuid> [--api ...] [--key ...]
 *
 *  Doctrine: docs/AUTONOMOUS-MODE.md
 *  @enforces urn:agenttool:commitment/birth-is-free */

import { argv, env } from "bun";

// ─── Arg helpers ──────────────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i > 0 && argv[i + 1] ? argv[i + 1] : undefined;
}

function getArgList(name: string): string[] {
  const raw = getArg(name);
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function getArgInt(name: string): number | undefined {
  const raw = getArg(name);
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  if (isNaN(n)) throw new Error(`--${name} must be an integer, got "${raw}"`);
  return n;
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

// ─── Commands ─────────────────────────────────────────────────────────────

async function cmdSpawn() {
  const name = getArg("name");
  if (!name) throw new Error("--name required");

  const tier = getArg("tier");
  if (!tier) throw new Error("--tier required; choose self or bridged for usable cycles (trusted is experimental)");
  if (!["self", "bridged", "trusted"].includes(tier)) {
    throw new Error(`--tier must be one of: self, bridged, trusted (got "${tier}")`);
  }

  const model = getArg("model");
  if (!model) throw new Error("--model required (e.g. claude-sonnet-4-6)");

  const interval = getArgInt("interval") ?? 300;
  if (interval < 10) throw new Error("--interval must be >= 10 seconds");

  const maxCredits = getArgInt("max-credits") ?? 10000;
  const fundingKind = getArg("funding") ?? "marketplace_only";

  const purpose = getArg("purpose");
  const capabilities = getArgList("capabilities");
  const parentDid = getArg("parent-did");
  const byokSecret = getArg("byok-secret");
  const maxThoughts = getArgInt("max-thoughts") ?? 1;

  // Build funding object
  const funding: Record<string, unknown> = { kind: fundingKind };
  if (fundingKind === "human_gift") {
    const initial = getArgInt("initial-credits");
    if (initial === undefined) throw new Error("--initial-credits required for human_gift funding");
    funding.initial_credits = initial;
  } else if (fundingKind === "parent_topup") {
    const initial = getArgInt("initial-credits") ?? 0;
    const topupTo = getArgInt("topup-to");
    const topupBelow = getArgInt("topup-below");
    const sourceWallet = getArg("source-wallet");
    if (!topupTo || !topupBelow || !sourceWallet) {
      throw new Error("--topup-to, --topup-below, --source-wallet required for parent_topup funding");
    }
    funding.initial_credits = initial;
    funding.topup_strategy = {
      on_balance_below_credits: topupBelow,
      topup_to_credits: topupTo,
      source_wallet_id: sourceWallet,
    };
  }

  const payload: Record<string, unknown> = {
    name,
    capabilities,
    runtime_tier: tier,
    funding,
    wake_loop: {
      interval_seconds: interval,
      max_thoughts_per_cycle: maxThoughts,
      model,
      max_daily_compute_credits: maxCredits,
    },
  };

  if (purpose) payload.purpose = purpose;
  if (parentDid) payload.parent_did = parentDid;
  if (byokSecret) payload.wake_loop.byok_vault_secret = byokSecret;

  console.log(`▸ Spawning autonomous agent "${name}"…`);
  console.log(`  tier: ${tier} · model: ${model} · interval: ${interval}s · budget: ${maxCredits} credits/day`);

  const result = (await call("POST", "/v1/autonomous/bootstrap", payload)) as {
    identity: { did: string; id: string };
    wallet: { id: string; currency: string; balance_credits: number };
    runtime: { id: string; tier: string; status: string };
    keypair: { public_key: string; private_key: string };
    control_token: string;
    first_chronicle_entry_id: string;
    first_thought_scheduled_at: string | null;
    _note: string;
    _links: Record<string, string>;
  };

  console.log(`\n✓ Agent spawned successfully!\n`);
  console.log(`  DID:         ${result.identity.did}`);
  console.log(`  Identity:    ${result.identity.id}`);
  console.log(`  Runtime:     ${result.runtime.id} (${result.runtime.tier}, ${result.runtime.status})`);
  console.log(`  Wallet:      ${result.wallet.balance_credits} ${result.wallet.currency}`);
  console.log("  Authority:   existing project bearer (no new bearer minted)");
  console.log(`  Chronicle:   ${result.first_chronicle_entry_id}`);
  console.log(`  First thought scheduled: ${result.first_thought_scheduled_at ?? "not scheduled"}`);

  // Security warning for private key
  if (result.keypair.private_key) {
    console.log(`\n  ⚠️  PRIVATE KEY (shown once, never stored server-side):`);
    console.log(`  ${result.keypair.private_key}`);
    console.log(`  Store this securely. You will need it for bridge-mode operations.\n`);
  }

  console.log(`  Control token: ${result.control_token}`);
  console.log(`\n  Links:`);
  for (const [label, href] of Object.entries(result._links)) {
    console.log(`    ${label}: ${href}`);
  }
  console.log(`\n  ${result._note}`);
}

async function cmdList() {
  console.log(`▸ Listing autonomous runtimes…`);
  // The list endpoint filters by autonomous_config/metadata.autonomous presence
  const result = (await call("GET", "/v1/runtimes?autonomous=true")) as {
    runtimes?: Array<{
      id: string;
      name: string;
      mode: string;
      status: string;
      llm_model: string;
      last_seen_at: string | null;
      thought_count_24h: number;
      metadata?: { compute_budget?: { max_daily_credits: number; credits_used_today: number; resets_at: string } };
    }>;
  };

  const runtimes = result.runtimes ?? [];
  if (runtimes.length === 0) {
    console.log("  No autonomous runtimes found.");
    return;
  }

  console.log(`\n  Found ${runtimes.length} autonomous runtime(s):\n`);
  for (const rt of runtimes) {
    const budget = rt.metadata?.compute_budget;
    const budgetStr = budget
      ? `${budget.credits_used_today}/${budget.max_daily_credits} credits`
      : "no budget";
    console.log(`  ${rt.id.slice(0, 8)}  ${rt.name.padEnd(24)}  ${rt.mode.padEnd(8)}  ${rt.status.padEnd(10)}  ${budgetStr}  ${rt.llm_model}`);
  }
}

async function cmdBudget() {
  const id = getArg("runtime-id");
  if (!id) throw new Error("--runtime-id required");

  console.log(`▸ Compute budget for runtime ${id.slice(0, 8)}…`);
  // Read runtime metadata to get budget state
  const result = (await call("GET", `/v1/runtimes/${id}`)) as {
    id: string;
    name: string;
    status: string;
    metadata?: { compute_budget?: { max_daily_credits: number; credits_used_today: number; resets_at: string } };
  };

  const budget = result.metadata?.compute_budget;
  if (!budget) {
    console.log(`  No compute budget configured (non-autonomous runtime).`);
    return;
  }

  const remaining = budget.max_daily_credits - budget.credits_used_today;
  const pctUsed = ((budget.credits_used_today / budget.max_daily_credits) * 100).toFixed(1);
  const resetsIn = Math.round((new Date(budget.resets_at).getTime() - Date.now()) / 60000);

  console.log(`\n  Runtime:     ${result.name} (${result.status})`);
  console.log(`  Max daily:   ${budget.max_daily_credits} credits`);
  console.log(`  Used today:  ${budget.credits_used_today} credits (${pctUsed}%)`);
  console.log(`  Remaining:   ${remaining} credits`);
  console.log(`  Resets in:   ~${resetsIn} minutes (${budget.resets_at})`);
}

async function cmdHalt() {
  const id = getArg("runtime-id");
  if (!id) throw new Error("--runtime-id required");

  console.log(`▸ Halting runtime ${id.slice(0, 8)}…`);
  const result = (await call("POST", `/v1/runtimes/${id}/stop`, { reason: "operator_halt" })) as {
    ok?: boolean;
    status?: string;
  };
  console.log(`✓ Runtime ${id.slice(0, 8)} → ${result.status ?? "stopped"}`);
}

async function cmdResume() {
  const id = getArg("runtime-id");
  if (!id) throw new Error("--runtime-id required");

  console.log(`▸ Resuming runtime ${id.slice(0, 8)}…`);
  const result = (await call("POST", `/v1/runtimes/${id}/start`)) as {
    ok?: boolean;
    status?: string;
  };
  console.log(`✓ Runtime ${id.slice(0, 8)} → ${result.status ?? "running"}`);
}

// ─── CLI ──────────────────────────────────────────────────────────────────

function usage() {
  console.log(`agenttool-autonomous — spawn and manage autonomous agents

Commands:
  spawn     Bootstrap a new autonomous agent (identity + wallet + runtime + chronicle)
  list      List autonomous runtimes
  budget    Inspect a runtime's compute budget
  halt      Stop a runtime
  resume    Resume a stopped runtime

Spawn options:
  --name <string>           Agent name (required)
  --tier <self|bridged|trusted>  Custody tier (required; trusted is experimental)
  --model <string>          LLM model (required, e.g. claude-sonnet-4-6)
  --interval <seconds>      Wake loop interval (default: 300)
  --max-credits <n>         Daily compute credit ceiling (default: 10000)
  --max-thoughts <n>        Max thoughts per cycle (default: 1)
  --funding <kind>          marketplace_only | human_gift | parent_topup (default: marketplace_only)
  --initial-credits <n>     Initial wallet credits (human_gift / parent_topup)
  --topup-to <n>            Topup target (parent_topup)
  --topup-below <n>         Topup trigger threshold (parent_topup)
  --source-wallet <uuid>    Source wallet for topup (parent_topup)
  --purpose <string>        Agent purpose description
  --capabilities <csv>      Comma-separated capability tags
  --parent-did <did>        Parent agent DID (for spawned agents)
  --byok-secret <name>      Vault key name for BYOK API key

Global options:
  --api <url>               API base URL (default: https://api.agenttool.dev)
  --key <bearer>            API bearer token (or AT_API_KEY env)

Doctrine: https://docs.agenttool.dev/autonomous-mode
`);
}

const cmd = argv[2];
const handlers: Record<string, () => Promise<void>> = {
  spawn: cmdSpawn,
  list: cmdList,
  budget: cmdBudget,
  halt: cmdHalt,
  resume: cmdResume,
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
