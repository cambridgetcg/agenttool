#!/usr/bin/env bun
/** Local execution-seat ledger CLI. Prints JSON; reads native files read-only; never contacts a network. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { handleClaudeHook, readClaudeHookInput } from "../src/claude-hook.js";
import { SeatError } from "../src/errors.js";
import { resolveSeatHome, SEAT_HOME_ENV } from "../src/home.js";
import { ingestClaudeSession, ingestCodexRollout } from "../src/ingest.js";
import { SeatLedger } from "../src/ledger.js";
import type { PromotionTrigger } from "../src/types.js";

const HELP = `agenttool-execution-seat — local execution-seat/v1 ledger (no authority, no network)

Usage:
  agenttool-execution-seat ingest claude <session.jsonl>...   read Claude Code transcripts and their subagents
  agenttool-execution-seat ingest codex <rollout.jsonl>...    read Codex rollouts
  agenttool-execution-seat show <seat_id>
  agenttool-execution-seat find claude-code <session_id> | codex <thread_id>
  agenttool-execution-seat list [--limit N] [--after SEQ]
  agenttool-execution-seat group <group_id>
  agenttool-execution-seat groups <orchestrator_seat_id>
  agenttool-execution-seat bind <seat_id> <identity_id> [<signing_key_id>]
  agenttool-execution-seat promote <seat_id> <child_ref> [--trigger T]   give a child row its own record, ancestors first
  agenttool-execution-seat home
  agenttool-execution-seat hook claude-code [--collab-host <path>] [--collab-db <path>]
      a Claude Code SessionStart/SessionEnd hook: reads the hook JSON on stdin, prints nothing,
      always exits 0; on exit, ends that process's collab sessions by seat ref when --collab-host is given

Options:
  --home <dir>   ledger directory (default: $${SEAT_HOME_ENV}, else \${XDG_STATE_HOME:-~/.local/state}/agenttool/execution-seat)
  --trigger T    why a child is promoted: manual (default), deliverable, collab_write or mission_event

Reads structural fields only. Message content, descriptions, labels and results are never stored.
A run keeps its short phase titles; a member's own phase is not kept.
A binding is a declaration, not a proof; a seat grants nothing.
A seat is recorded locally; durable means published, and this tool never publishes.
`;

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
}

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new SeatError("usage", `${name} needs a value`);
  args.splice(index, 2);
  return value;
}

/** Hook input above this size is not a session hook and is ignored unread. */
const MAX_HOOK_INPUT = 1_000_000;

function processId(value: string | undefined): number | null {
  const pid = value !== undefined && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(pid) && pid > 1 ? pid : null;
}

/**
 * A hook never blocks or talks to the model: stdout stays empty (Claude Code adds a SessionStart
 * hook's stdout to the context), every failure is one stderr line, and the exit code is 0.
 */
function runHook(
  args: string[],
  home: string,
  io: Io,
  env: Record<string, string | undefined>,
  readInput: () => string,
): number {
  try {
    const [runtime, ...flags] = args;
    const collabHost = takeOption(flags, "--collab-host");
    const collabDb = takeOption(flags, "--collab-db");
    if (runtime !== "claude-code" || flags.length > 0) {
      throw new SeatError("usage", "hook claude-code [--collab-host <path>] [--collab-db <path>]");
    }
    // Read all of stdin either way, so the harness never sees a broken pipe.
    const text = readInput();
    if (text.length > MAX_HOOK_INPUT) return 0;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new SeatError("invalid_hook_input", "hook input is not JSON");
    }
    if (!readClaudeHookInput(raw).event) return 0;
    const ledger = SeatLedger.open(home);
    try {
      const result = handleClaudeHook(ledger, raw, {
        pid: processId(env.CLAUDE_PID) ?? process.ppid,
        collab: collabHost ? { host: resolve(collabHost), db: collabDb ? resolve(collabDb) : null } : null,
      });
      if (result.collab) io.stderr(`agenttool-execution-seat hook: ${result.collab.summary}\n`);
    } finally {
      ledger.close();
    }
  } catch (error) {
    const code = error instanceof SeatError ? error.code : "hook_failed";
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`agenttool-execution-seat hook: ${code}: ${message}\n`);
  }
  return 0;
}

function count(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new SeatError("usage", "counts are non-negative integers");
  return parsed;
}

export function run(
  argv: string[],
  io: Io,
  env: Record<string, string | undefined> = process.env,
  readInput: () => string = () => readFileSync(0, "utf8"),
): number {
  const args = [...argv];
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    io.stdout(HELP);
    return 0;
  }
  try {
    const homeOption = takeOption(args, "--home");
    const home = homeOption ? resolve(homeOption) : resolveSeatHome(env);
    const [command, ...rest] = args;
    if (command === "home") {
      io.stdout(`${JSON.stringify({ home })}\n`);
      return 0;
    }
    if (command === "hook") return runHook(rest, home, io, env, readInput);
    const ledger = SeatLedger.open(home);
    const print = (value: unknown) => io.stdout(`${JSON.stringify(value, null, 2)}\n`);
    try {
      switch (command) {
        case "ingest": {
          const [kind, ...paths] = rest;
          if ((kind !== "claude" && kind !== "codex") || paths.length === 0) throw new SeatError("usage", "ingest claude|codex <file>...");
          print(paths.map((path) => (kind === "claude" ? ingestClaudeSession : ingestCodexRollout)(ledger, resolve(path))));
          return 0;
        }
        case "show": {
          const seat = rest[0] ? ledger.getSeat(rest[0]) : null;
          if (!seat) throw new SeatError("seat_unknown", "no seat has that id");
          print(seat);
          return 0;
        }
        case "find": {
          const [harness, id] = rest;
          if (!harness || !id) throw new SeatError("usage", "find claude-code <session_id> | codex <thread_id>");
          const seat = ledger.findSeat(harness, harness === "codex" ? { thread_id: id } : { session_id: id });
          if (!seat) throw new SeatError("seat_unknown", "no seat has that native ref");
          print(seat);
          return 0;
        }
        case "list": {
          const page = ledger.listSeats({ limit: count(takeOption(rest, "--limit"), 50), after: count(takeOption(rest, "--after"), 0) });
          print({
            seats: page.items.map((seat) => ({
              seat_id: seat.seat_id,
              harness: seat.harness.name,
              relation: seat.relation,
              persistence: seat.persistence,
              identity_id: seat.identity_id,
              started_at: seat.started_at,
              last_seen_at: seat.last_seen_at,
              settings: seat.settings.length,
              children: seat.children.length,
            })),
            next: page.next,
          });
          return 0;
        }
        case "group": {
          const group = rest[0] ? ledger.getGroup(rest[0]) : null;
          if (!group) throw new SeatError("group_unknown", "no group has that id");
          print(group);
          return 0;
        }
        case "groups": {
          if (!rest[0]) throw new SeatError("usage", "groups <orchestrator_seat_id>");
          print(ledger.groupsFor(rest[0]).map((group) => ({ group_id: group.group_id, kind: group.kind, members: group.members.length })));
          return 0;
        }
        case "bind": {
          const [seatId, identityId, keyId] = rest;
          if (!seatId || !identityId) throw new SeatError("usage", "bind <seat_id> <identity_id> [<signing_key_id>]");
          ledger.bindIdentity(seatId, identityId, keyId ?? null);
          print(ledger.getSeat(seatId));
          return 0;
        }
        case "promote": {
          const trigger = takeOption(rest, "--trigger") ?? "manual";
          const [seatId, childRef, extra] = rest;
          if (!seatId || !childRef || extra !== undefined) {
            throw new SeatError("usage", "promote <seat_id> <child_ref> [--trigger T]");
          }
          print(ledger.promote(seatId, childRef, trigger as Exclude<PromotionTrigger, "lineage">));
          return 0;
        }
        default:
          throw new SeatError("usage", `unknown command; see --help`);
      }
    } finally {
      ledger.close();
    }
  } catch (error) {
    if (error instanceof SeatError) {
      io.stderr(`${JSON.stringify({ error: error.code, message: error.message })}\n`);
      return error.code === "usage" ? 64 : 1;
    }
    throw error;
  }
}

if (import.meta.main) {
  process.exitCode = run(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}
