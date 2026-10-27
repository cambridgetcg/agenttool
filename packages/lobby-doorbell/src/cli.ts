/** agenttool-lobby-doorbell: netcheck (alias `lobby-netcheck`), the listener
 * commands, the brake, the internal fetcher and watcher, and the Claude Code
 * hook. Only bin/ reads the process environment, hands over fetch and wires
 * signals; everything arrives here as values. */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { claudeInboxRing } from "./claude-inbox.js";
import {
  formatStatus, listen, makeContext, ownerPidOf, resume, status, stop, unlisten,
  type ContextOptions, type DoorbellContext,
} from "./control.js";
import { DoorbellError, UsageError } from "./errors.js";
import { claimFetcherPidfile, Fetcher, releaseFetcherPidfile, runFetcherLoop } from "./fetcher.js";
import type { FetchLike } from "./health.js";
import { handleClaudeHook, hooksSnippet } from "./hook.js";
import { appendLogLine, ensurePrivateDirectory, lobbyHomeState, stopPresent, type Environment } from "./home.js";
import { checkLobbyEntry, LobbyCli } from "./lobby-cli.js";
import { formatReport, runNetcheck, type NetcheckOptions } from "./netcheck.js";
import { launchContext } from "./probes.js";
import { childEnvironment, pidAlive, ROOM_ID_PATTERN } from "./run.js";
import { confirmOnDevTty, type Confirm } from "./tty.js";
import { runWatcherLoop, Watcher } from "./watcher.js";

export const EXIT_OK = 0;
export const EXIT_REFUSED = 1;
export const EXIT_USAGE = 2;
export const EXIT_UNKNOWN = 7;
/** The fetcher's sync may page many times; it gets longer than netcheck's local reads. */
export const FETCH_CLI_TIMEOUT_MS = 60_000;
const HOOK_INPUT_MAX = 1024 * 1024;
export const DEFAULT_HOOK_COMMAND = '"$HOME/.local/bin/agenttool-lobby-doorbell"';

export const USAGE = `usage: agenttool-lobby-doorbell netcheck [--json] [--room ROOM]... [--lobby-entry PATH]
       lobby-netcheck [--json] [--room ROOM]... [--lobby-entry PATH]
       agenttool-lobby-doorbell listen --room ROOM [--mode addressed|all] [--max-hours 1-12] [--from-cursor C] [--json]
       agenttool-lobby-doorbell unlisten --room ROOM
       agenttool-lobby-doorbell status [--json]
       agenttool-lobby-doorbell stop
       agenttool-lobby-doorbell resume
       agenttool-lobby-doorbell hook claude-code          (reads the hook's JSON on stdin)
       agenttool-lobby-doorbell install-hooks --print [--command CMD]
       agenttool-lobby-doorbell fetch | watch --room ROOM (internal; started by listen)

netcheck is read-only and reports one state: hosted-ok (exit 0), grant-lapsed
(4), hosted-unreachable (5), lan-blocked (6) or unknown (7). Unknown is never
healthy. listen rings this Claude Code session (run it from a Bash command
inside the session) when table talk addressed to this desk arrives; a ring
carries no message text. stop sets the device brake <lobby home>/STOP; only a
person at /dev/tty lifts it with resume. Refusals exit 1, usage errors 2.
`;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Environment;
  /** Only bin/ hands over the runtime's fetch. */
  fetchImpl: FetchLike | null;
  /** The program name the person typed, so a `lobby-netcheck` link runs netcheck. */
  invokedAs?: string;
  /** This package's bin, which `listen` starts as the fetcher and watchers. */
  selfEntry?: string | null;
  pid?: number;
  readStdin?: () => Promise<string>;
  /** Registers what SIGTERM/SIGINT should do in a long-running command. */
  onTerminate?: (handler: () => void) => void;
  /** Sleep that a terminate wakes early. */
  sleep?: (ms: number) => Promise<void>;
  confirm?: Confirm;
  /** Tests only. */
  overrides?: Partial<Omit<NetcheckOptions, "env" | "fetchImpl" | "rooms" | "lobbyEntry" | "doorbellHome">>
    & Pick<ContextOptions, "starter" | "alive">;
}

function parse(args: string[], options: Record<string, { type: "string" | "boolean"; multiple?: boolean }>) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options });
  if (positionals.length > 0) throw new UsageError(`unexpected argument: ${positionals[0]}`);
  return values as Record<string, string | boolean | string[] | undefined>;
}

const str = (value: unknown) => typeof value === "string" ? value : undefined;

function context(io: CliIo, values: Record<string, unknown>): DoorbellContext {
  return makeContext({
    env: io.env,
    selfEntry: io.selfEntry ?? null,
    ...(str(values.home) === undefined ? {} : { doorbellHome: str(values.home)! }),
    ...(str(values["lobby-entry"]) === undefined ? {} : { lobbyEntry: str(values["lobby-entry"])! }),
    ...(io.overrides?.homeDir === undefined ? {} : { homeDir: io.overrides.homeDir }),
    ...(io.overrides?.now === undefined ? {} : { now: io.overrides.now }),
    ...(io.overrides?.spawner === undefined ? {} : { spawner: io.overrides.spawner }),
    ...(io.overrides?.starter === undefined ? {} : { starter: io.overrides.starter }),
    ...(io.overrides?.alive === undefined ? {} : { alive: io.overrides.alive }),
  });
}

const sleeper = (io: CliIo) => io.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

async function netcheck(io: CliIo, rest: string[]): Promise<number> {
  const values = parse(rest, { json: { type: "boolean" }, room: { type: "string", multiple: true }, "lobby-entry": { type: "string" }, home: { type: "string" } });
  const report = await runNetcheck({
    ...io.overrides,
    env: io.env,
    fetchImpl: io.fetchImpl,
    rooms: (values.room as string[] | undefined) ?? [],
    ...(str(values["lobby-entry"]) === undefined ? {} : { lobbyEntry: str(values["lobby-entry"])! }),
    ...(str(values.home) === undefined ? {} : { doorbellHome: str(values.home)! }),
  });
  io.stdout(values.json === true ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
  return report.exit_code;
}

async function fetchCommand(io: CliIo, rest: string[]): Promise<number> {
  const values = parse(rest, { home: { type: "string" }, "lobby-entry": { type: "string" } });
  const ctx = context(io, values);
  const launch = launchContext(io.env);
  if (launch.context === "launchd") throw new DoorbellError("launchd_context", "the fetcher is started from a session or a terminal, never by launchd");
  if (stopPresent(ctx.lobbyHome)) throw new DoorbellError("stopped", "the device brake is set");
  if (lobbyHomeState(ctx.lobbyHome) !== "present") throw new DoorbellError("no_desk", "this device has no lobby desk state yet");
  if (checkLobbyEntry(ctx.lobbyEntry).state !== "ok") throw new DoorbellError("no_lobby_cli", "the pinned lobby CLI is missing or unsafe");
  ensurePrivateDirectory(ctx.doorbellHome);
  const pid = io.pid ?? process.pid;
  await claimFetcherPidfile(ctx.doorbellHome, pid, ctx.liveness);
  const fetcher = new Fetcher({
    doorbellHome: ctx.doorbellHome,
    lobbyHome: ctx.lobbyHome,
    cli: new LobbyCli(ctx.lobbyEntry, childEnvironment(io.env, ctx.lobbyHome), ctx.spawner, FETCH_CLI_TIMEOUT_MS),
    liveness: ctx.liveness,
    now: ctx.now,
    pid,
    launchContext: launch.context,
  });
  io.onTerminate?.(() => fetcher.terminate());
  try {
    const exit = await runFetcherLoop(fetcher, { sleep: sleeper(io) });
    io.stdout(`fetcher exited: ${exit}\n`);
    return exit === "fatal" ? EXIT_REFUSED : EXIT_OK;
  } catch (error) {
    appendLogLine(ctx.doorbellHome, { at: new Date(ctx.now()).toISOString(), act: "fetch", pid, event: "crashed", code: error instanceof DoorbellError ? error.code : "internal_error" });
    throw error;
  } finally {
    releaseFetcherPidfile(ctx.doorbellHome, pid);
  }
}

async function watchCommand(io: CliIo, rest: string[]): Promise<number> {
  const values = parse(rest, { room: { type: "string" }, home: { type: "string" } });
  const room = str(values.room);
  if (room === undefined || !ROOM_ID_PATTERN.test(room)) throw new UsageError("watch needs --room ROOM");
  const ctx = context(io, values);
  const socket = io.env.CLAUDE_CODE_MESSAGING_SOCKET;
  if (!socket) throw new DoorbellError("no_inbox", "CLAUDE_CODE_MESSAGING_SOCKET is not set");
  const ownerPid = ownerPidOf(io.env);
  const alive = io.overrides?.alive ?? pidAlive;
  const watcher = new Watcher({
    doorbellHome: ctx.doorbellHome,
    lobbyHome: ctx.lobbyHome,
    roomId: room,
    pid: io.pid ?? process.pid,
    ring: claudeInboxRing(socket, io.env.CLAUDE_CODE_MESSAGING_TOKEN),
    ownerGone: () => (ownerPid !== null && !alive(ownerPid)) || !existsSync(socket),
    now: ctx.now,
  });
  io.onTerminate?.(() => watcher.terminate());
  const exit = await runWatcherLoop(watcher, sleeper(io));
  io.stdout(`watcher exited: ${exit}\n`);
  return EXIT_OK;
}

async function hookCommand(io: CliIo, rest: string[]): Promise<number> {
  // A hook never fails the session: every problem is one stderr line and exit 0.
  try {
    if (rest.length !== 1 || rest[0] !== "claude-code") throw new UsageError("hook claude-code");
    const text = io.readStdin === undefined ? "" : await io.readStdin();
    if (Buffer.byteLength(text) > HOOK_INPUT_MAX) throw new DoorbellError("hook_input_too_large", "the hook input is over 1 MiB");
    let raw: unknown = null;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new DoorbellError("hook_input_unparseable", "the hook input is not JSON");
    }
    const lines = await handleClaudeHook(context(io, {}), raw);
    if (lines.length > 0) io.stdout(`${lines.join("\n")}\n`);
  } catch (error) {
    const code = error instanceof DoorbellError ? error.code : error instanceof UsageError ? "usage" : "internal_error";
    io.stderr(`agenttool-lobby-doorbell hook: ${code}; the session is unaffected\n`);
  }
  return EXIT_OK;
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  let args = argv;
  if (io.invokedAs?.replace(/\.ts$/, "") === "lobby-netcheck") args = ["netcheck", ...argv];
  const [command, ...rest] = args;
  try {
    switch (command) {
      case undefined:
      case "help":
      case "--help":
      case "-h":
        io.stdout(USAGE);
        return command === undefined ? EXIT_USAGE : EXIT_OK;
      case "netcheck":
      case "lobby-netcheck":
        return await netcheck(io, rest);
      case "hook":
        return await hookCommand(io, rest);
      case "listen": {
        const values = parse(rest, {
          room: { type: "string" }, mode: { type: "string" }, harness: { type: "string" }, "max-hours": { type: "string" },
          "from-cursor": { type: "string" }, json: { type: "boolean" }, home: { type: "string" }, "lobby-entry": { type: "string" },
        });
        if (str(values.room) === undefined) throw new UsageError("listen needs --room ROOM");
        const result = await listen(context(io, values), {
          room: str(values.room)!,
          ...(str(values.mode) === undefined ? {} : { mode: str(values.mode)! }),
          ...(str(values.harness) === undefined ? {} : { harness: str(values.harness)! }),
          ...(str(values["max-hours"]) === undefined ? {} : { maxHours: str(values["max-hours"])! }),
          ...(str(values["from-cursor"]) === undefined ? {} : { fromCursor: str(values["from-cursor"])! }),
        });
        io.stdout(values.json === true ? `${JSON.stringify(result, null, 2)}\n`
          : `${result.status === "listening" ? "listening to" : "already listening to"} ${result.room_id} (${result.mode}) as ${result.seat_ref} until ${result.expires_at}; `
            + `watcher pid ${result.watcher_pid ?? "none"}; fetcher ${result.fetcher.state}${result.fetcher.pid === null ? "" : ` pid ${result.fetcher.pid}`}. `
            + "A ring carries no message text; read with room_read.\n");
        return result.fetcher.state === "failed" ? EXIT_REFUSED : EXIT_OK;
      }
      case "unlisten": {
        const values = parse(rest, { room: { type: "string" }, home: { type: "string" } });
        if (str(values.room) === undefined) throw new UsageError("unlisten needs --room ROOM");
        const result = await unlisten(context(io, values), str(values.room)!);
        io.stdout(result.status === "released" ? `released; watcher ${result.watcher_signalled ? "signalled" : "already gone"}\n` : "no listener for that room\n");
        return EXIT_OK;
      }
      case "status": {
        const values = parse(rest, { json: { type: "boolean" }, home: { type: "string" } });
        const report = await status(context(io, values));
        io.stdout(values.json === true ? `${JSON.stringify(report, null, 2)}\n` : formatStatus(report));
        return EXIT_OK;
      }
      case "stop": {
        const values = parse(rest, { home: { type: "string" } });
        const result = await stop(context(io, values));
        io.stdout(`STOP ${result.stop_file.replace("_", " ")}; fetcher ${result.fetcher_signalled ? "signalled" : "not running"}; `
          + `${result.watchers_signalled} watcher(s) signalled. Only a person at /dev/tty lifts it: agenttool-lobby-doorbell resume\n`);
        return EXIT_OK;
      }
      case "resume": {
        const values = parse(rest, { home: { type: "string" } });
        const result = resume(context(io, values), io.confirm ?? confirmOnDevTty);
        io.stdout(result === "resumed" ? "STOP removed; the doorbell may run again (listen re-arms it)\n"
          : result === "not_stopped" ? "STOP is not set\n" : "cancelled; STOP stays\n");
        return result === "cancelled" ? EXIT_REFUSED : EXIT_OK;
      }
      case "install-hooks": {
        const values = parse(rest, { print: { type: "boolean" }, command: { type: "string" } });
        if (values.print !== true) throw new UsageError("install-hooks only prints the snippet (--print); add it to ~/.claude/settings.json yourself");
        io.stdout(hooksSnippet(str(values.command) ?? DEFAULT_HOOK_COMMAND));
        return EXIT_OK;
      }
      case "fetch":
        return await fetchCommand(io, rest);
      case "watch":
        return await watchCommand(io, rest);
      default:
        throw new UsageError(`unknown command: ${command}`);
    }
  } catch (error) {
    const netcheckCommand = command === "netcheck" || command === "lobby-netcheck";
    if (error instanceof UsageError || (error as { code?: string })?.code?.startsWith?.("ERR_PARSE_ARGS")
      || (error instanceof DoorbellError && error.code === "usage")) {
      io.stderr(`agenttool-lobby-doorbell: ${(error as Error).message}\n\n${USAGE}`);
      return EXIT_USAGE;
    }
    if (error instanceof DoorbellError) {
      io.stderr(`agenttool-lobby-doorbell: ${error.code}: ${error.message}\n`);
      if (error.code === "room_invalid") return EXIT_USAGE;
      return netcheckCommand ? EXIT_UNKNOWN : EXIT_REFUSED;
    }
    // Never echo an unexpected error's text: it could carry something read from the lobby.
    io.stderr(netcheckCommand
      ? "agenttool-lobby-doorbell: internal_error: netcheck could not finish; state unknown\n"
      : "agenttool-lobby-doorbell: internal_error: the command could not finish\n");
    return netcheckCommand ? EXIT_UNKNOWN : EXIT_REFUSED;
  }
}
