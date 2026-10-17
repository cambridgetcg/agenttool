#!/usr/bin/env bun
/** Local execution-seat ledger CLI. Prints JSON; reads native files read-only; never contacts a network. */
import { resolve } from "node:path";
import { SeatError } from "../src/errors.js";
import { resolveSeatHome, SEAT_HOME_ENV } from "../src/home.js";
import { ingestClaudeSession, ingestCodexRollout } from "../src/ingest.js";
import { SeatLedger } from "../src/ledger.js";
import type { Persistence } from "../src/types.js";

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
  agenttool-execution-seat promote <seat_id> <child_ref> [recorded|durable]
  agenttool-execution-seat home

Options:
  --home <dir>   ledger directory (default: $${SEAT_HOME_ENV}, else \${XDG_STATE_HOME:-~/.local/state}/agenttool/execution-seat)

Reads structural fields only. Message content, descriptions, labels and results are never stored.
A binding is a declaration, not a proof; a seat grants nothing.
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

function count(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new SeatError("usage", "counts are non-negative integers");
  return parsed;
}

export function run(argv: string[], io: Io, env: Record<string, string | undefined> = process.env): number {
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
          const [seatId, childRef, level = "recorded"] = rest;
          if (!seatId || !childRef || (level !== "recorded" && level !== "durable")) {
            throw new SeatError("usage", "promote <seat_id> <child_ref> [recorded|durable]");
          }
          print(ledger.promoteChild(seatId, childRef, level as Exclude<Persistence, "ephemeral">));
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
