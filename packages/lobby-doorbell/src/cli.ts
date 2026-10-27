/** agenttool-lobby-doorbell: PR 1 has one command, `netcheck` (alias `lobby-netcheck`). */
import { parseArgs } from "node:util";
import { DoorbellError, UsageError } from "./errors.js";
import type { FetchLike } from "./health.js";
import type { Environment } from "./home.js";
import { formatReport, runNetcheck, type NetcheckOptions } from "./netcheck.js";

export const EXIT_USAGE = 2;
export const EXIT_UNKNOWN = 7;

export const USAGE = `usage: agenttool-lobby-doorbell netcheck [--json] [--room ROOM]... [--lobby-entry PATH]
       lobby-netcheck [--json] [--room ROOM]... [--lobby-entry PATH]

Read-only. Reports one state: hosted-ok (exit 0), grant-lapsed (4),
hosted-unreachable (5), lan-blocked (6) or unknown (7); usage errors exit 2.
Unknown is never healthy. It sends one credential-free GET /health to the
pinned origin and runs only read commands of the pinned lobby CLI.
`;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Environment;
  /** Only bin/ hands over the runtime's fetch. */
  fetchImpl: FetchLike | null;
  /** The program name the person typed, so a `lobby-netcheck` link runs netcheck. */
  invokedAs?: string;
  /** Tests only. */
  overrides?: Partial<Omit<NetcheckOptions, "env" | "fetchImpl" | "rooms" | "lobbyEntry" | "doorbellHome">>;
}

function parseNetcheck(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean" },
      room: { type: "string", multiple: true },
      "lobby-entry": { type: "string" },
      home: { type: "string" },
    },
  });
  if (positionals.length > 0) throw new UsageError(`unexpected argument: ${positionals[0]}`);
  return values;
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  let args = argv;
  if (io.invokedAs?.replace(/\.ts$/, "") === "lobby-netcheck") args = ["netcheck", ...argv];
  const [command, ...rest] = args;
  try {
    if (command === undefined || command === "help" || command === "--help" || command === "-h") {
      io.stdout(USAGE);
      return command === undefined ? EXIT_USAGE : 0;
    }
    if (command !== "netcheck" && command !== "lobby-netcheck") throw new UsageError(`unknown command: ${command}`);
    const values = parseNetcheck(rest);
    const report = await runNetcheck({
      ...io.overrides,
      env: io.env,
      fetchImpl: io.fetchImpl,
      rooms: values.room ?? [],
      ...(values["lobby-entry"] === undefined ? {} : { lobbyEntry: values["lobby-entry"] }),
      ...(values.home === undefined ? {} : { doorbellHome: values.home }),
    });
    io.stdout(values.json === true ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
    return report.exit_code;
  } catch (error) {
    if (error instanceof UsageError || (error as { code?: string })?.code?.startsWith?.("ERR_PARSE_ARGS")) {
      io.stderr(`agenttool-lobby-doorbell: ${(error as Error).message}\n\n${USAGE}`);
      return EXIT_USAGE;
    }
    if (error instanceof DoorbellError) {
      io.stderr(`agenttool-lobby-doorbell: ${error.code}: ${error.message}\n`);
      return error.code === "room_invalid" ? EXIT_USAGE : EXIT_UNKNOWN;
    }
    // Never echo an unexpected error's text: it could carry something read from the lobby.
    io.stderr("agenttool-lobby-doorbell: internal_error: netcheck could not finish; state unknown\n");
    return EXIT_UNKNOWN;
  }
}
