#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { compareSnapshot, sampleSnapshot, type UsageSample } from "../src/delta.js";
import { buildCodexUsageMcpServer } from "../src/mcp.js";
import { CodexUsageError, CodexUsageReader, publicError } from "../src/reader.js";
import type { UsageDelta, UsageSession, UsageSnapshot } from "../src/types.js";

interface CliOptions {
  command: "snapshot" | "sessions" | "self" | "watch" | "doctor" | "mcp" | "help";
  json: boolean;
  jsonl: boolean;
  activeWindowSeconds: number;
  sessionLimit: number;
  intervalMs: number;
  includeBreakdown: boolean;
  includeInactive: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "help") {
    process.stdout.write(help());
    return;
  }
  if (options.command === "mcp") {
    await runMcp();
    return;
  }

  const reader = new CodexUsageReader();
  if (options.command === "doctor") {
    const report = reader.doctor();
    process.stdout.write(`${JSON.stringify(report, null, options.json ? 2 : 2)}\n`);
    process.exitCode = report.ok ? 0 : 1;
    return;
  }
  if (options.command === "self") {
    const session = reader.self({ includeBreakdown: options.includeBreakdown });
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ session }, null, 2)}\n`);
    } else if (session) {
      process.stdout.write(renderSession(session));
    } else {
      process.stdout.write("No current Codex thread was detectable in this command's environment.\n");
      process.exitCode = 1;
    }
    return;
  }
  if (options.command === "watch") {
    await watch(reader, options);
    return;
  }

  const snapshot = reader.snapshot({
    activeWindowSeconds: options.activeWindowSeconds,
    sessionLimit: options.sessionLimit,
    includeBreakdown: options.includeBreakdown,
    includeInactive: options.command === "sessions" ? options.includeInactive : false,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(
      options.command === "sessions" ? { ...snapshot, totals: undefined } : snapshot,
      null,
      2,
    )}\n`);
  } else {
    process.stdout.write(renderSnapshot(snapshot));
  }
}

async function runMcp(): Promise<void> {
  const server = buildCodexUsageMcpServer();
  const transport = new StdioServerTransport();
  let shuttingDown = false;
  const shutdown = async (exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    await server.close();
    process.exit(exitCode);
  };
  process.once("SIGINT", () => void shutdown(0));
  process.once("SIGTERM", () => void shutdown(0));
  await server.connect(transport);
  process.stderr.write("· agenttool Codex usage MCP ready (local read-only polling; no transcript text)\n");
}

async function watch(reader: CodexUsageReader, options: CliOptions): Promise<void> {
  let stopped = false;
  process.once("SIGINT", () => { stopped = true; });
  process.once("SIGTERM", () => { stopped = true; });
  let previous: UsageSample | null = null;
  while (!stopped) {
    const snapshot = reader.snapshot({
      activeWindowSeconds: options.activeWindowSeconds,
      sessionLimit: options.sessionLimit,
      includeBreakdown: options.includeBreakdown,
    });
    const delta = previous ? compareSnapshot(snapshot, previous) : null;
    if (options.jsonl || !process.stdout.isTTY) {
      process.stdout.write(`${JSON.stringify({ ...snapshot, delta_since_previous_sample: delta })}\n`);
    } else {
      process.stdout.write("\u001b[2J\u001b[H");
      process.stdout.write(renderSnapshot(snapshot, delta));
    }
    previous = sampleSnapshot(snapshot);
    await Bun.sleep(options.intervalMs);
  }
}

function renderSnapshot(
  snapshot: UsageSnapshot,
  delta: UsageDelta | null = null,
): string {
  const lines = [
    "KINGDOM · CODEX TOKEN PULSE",
    `${snapshot.observed_at} · poll-on-read · recent ≤ ${snapshot.scope.active_window_seconds}s`,
    "",
    `${formatTokens(snapshot.totals.cumulative_tokens)} cumulative tokens · ${snapshot.totals.sessions_observed.toLocaleString()} sessions`,
    `${snapshot.totals.recently_active_sessions.toLocaleString()} recently updated · ${formatTokens(snapshot.totals.recently_active_cumulative_tokens)} cumulative in those sessions`,
  ];
  if (delta) {
    if (delta.comparison === "comparable" && delta.cumulative_tokens_delta !== null) {
      const seconds = Math.max(0.001, delta.elapsed_ms / 1000);
      lines.push(`+${formatTokens(delta.cumulative_tokens_delta)} since prior sample · ${formatTokens(Math.round(delta.cumulative_tokens_delta / seconds))}/s`);
    } else {
      lines.push("counter reset or local state source change · no comparable delta");
    }
  }
  lines.push("", "REF             SOURCE         TOKENS       AGE   REPORTED LAST EVENT / MODEL WINDOW");
  for (const session of snapshot.sessions) {
    const source = session.is_self ? "self" : session.source_kind;
    const context = session.token_event?.model_context_window
      ? `${formatTokens(session.token_event.last.total_tokens)} / ${formatTokens(session.token_event.model_context_window)}`
      : "—";
    lines.push([
      pad(session.session_ref, 15),
      pad(source, 14),
      pad(formatTokens(session.cumulative_tokens), 12),
      pad(formatAge(session.activity_age_seconds), 5),
      context,
    ].join(" "));
  }
  if (snapshot.sessions.length === 0) lines.push("(no sessions matched this activity window)");
  lines.push(
    "",
    "Recent is an update-time heuristic, not proof a process is alive. Counters are not billing, credits, or remaining quota.",
    "No prompts, replies, reasoning, cwd, paths, raw IDs, credentials, or network calls are included.",
    "",
  );
  return lines.join("\n");
}

function renderSession(session: UsageSession): string {
  return [
    `Codex session ${session.session_ref}${session.is_self ? " (self)" : ""}`,
    `source: ${session.source_kind}`,
    `cumulative tokens: ${session.cumulative_tokens.toLocaleString()}`,
    `updated: ${session.updated_at} (${formatAge(session.activity_age_seconds)} ago)`,
    session.token_event
      ? `reported last event: ${session.token_event.last.total_tokens.toLocaleString()} tokens (not a delta); model window reported ${session.token_event.model_context_window?.toLocaleString() ?? "unknown"}`
      : "last event: unavailable inside the bounded rollout tail",
    "",
    "This record excludes transcript content and does not represent billing or remaining quota.",
    "",
  ].join("\n");
}

function parseArgs(args: string[]): CliOptions {
  let command: CliOptions["command"] = "snapshot";
  let json = false;
  let jsonl = false;
  let activeWindowSeconds = 300;
  let sessionLimit = 20;
  let intervalMs = 1000;
  let includeBreakdown = false;
  let includeInactive = false;

  const first = args[0];
  if (first && !first.startsWith("-")) {
    if (["snapshot", "sessions", "self", "watch", "doctor", "mcp", "help"].includes(first)) {
      command = first as CliOptions["command"];
      args = args.slice(1);
    } else {
      throw new CodexUsageError("invalid_cli_usage", `unknown command: ${first}`);
    }
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--json") json = true;
    else if (arg === "--jsonl") jsonl = true;
    else if (arg === "--all") includeInactive = true;
    else if (arg === "--breakdown") includeBreakdown = true;
    else if (arg === "--no-breakdown") includeBreakdown = false;
    else if (arg === "--help" || arg === "-h") command = "help";
    else if (arg === "--active-window") activeWindowSeconds = numericArg(args[++index], arg, 15, 86_400);
    else if (arg === "--limit") sessionLimit = numericArg(args[++index], arg, 0, 200);
    else if (arg === "--interval") intervalMs = numericArg(args[++index], arg, 250, 60_000);
    else throw new CodexUsageError("invalid_cli_usage", `unknown option: ${arg}`);
  }
  if (json && jsonl) {
    throw new CodexUsageError("invalid_cli_usage", "--json and --jsonl are mutually exclusive");
  }
  return {
    command,
    json,
    jsonl,
    activeWindowSeconds,
    sessionLimit,
    intervalMs,
    includeBreakdown,
    includeInactive,
  };
}

function numericArg(value: string | undefined, option: string, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new CodexUsageError(
      "invalid_cli_usage",
      `${option} requires an integer from ${min} through ${max}`,
    );
  }
  return number;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return `${trim(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trim(value / 1_000)}K`;
  return value.toLocaleString();
}

function trim(value: number): string {
  return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2).replace(/\.0+$/, "");
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

function pad(value: string, width: number): string {
  const compact = value.length > width ? `${value.slice(0, Math.max(0, width - 1))}…` : value;
  return compact.padEnd(width);
}

function help(): string {
  return `agenttool-codex-usage — live, local, privacy-minimal Codex token counters

Usage:
  agenttool-codex-usage [snapshot] [--json] [--breakdown] [--active-window SEC] [--limit N]
  agenttool-codex-usage sessions [--all] [--json] [--breakdown]
  agenttool-codex-usage self [--json] [--breakdown]
  agenttool-codex-usage watch [--interval MS] [--jsonl] [--breakdown]
  agenttool-codex-usage doctor [--json]
  agenttool-codex-usage mcp

Reads Codex's local SQLite numeric counters on every sample. Breakdown is
opt-in and reads only validated token_count records from a bounded rollout tail.
It does not return transcript text, credentials, cost, billing, or quota truth,
and it performs no network call.
`;
}

main().catch((error) => {
  const detail = publicError(error);
  process.stderr.write(`✖ ${detail.code}: ${detail.message}\n`);
  process.exit(1);
});
