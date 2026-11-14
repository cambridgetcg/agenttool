/** agenttool-house: survey, blueprint --from-survey, plan --blueprint. Each prints one JSON line and writes no file. */
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { blueprintFromSurvey, checkName, parseBlueprint } from "./blueprint.js";
import { RefusalError, UsageError } from "./errors.js";
import { isFail } from "./fs.js";
import type { LookDeps } from "./looks.js";
import { plan } from "./plan.js";
import { outputLeak } from "./privacy.js";
import { survey } from "./survey.js";

export const EXIT_OK = 0;
export const EXIT_INTERNAL = 1;
export const EXIT_USAGE = 2;
export const EXIT_REFUSED = 3;
const BLUEPRINT_MAX_BYTES = 256 * 1024;

export const USAGE = `usage: agenttool-house survey
       agenttool-house blueprint --from-survey [--name <text>]
       agenttool-house plan --blueprint <path>
       agenttool-house --help

Read-only. Each command prints one JSON line on stdout and writes no file.
survey looks at this device's AgentTool environment at fixed places;
blueprint --from-survey describes it as it stands; plan compares it with a
blueprint and lists what would change, whose act each change is and which
document says how. It builds nothing and runs only the collab host's --help
and weather. Exit 0 on success (unknown parts included), 2 on a usage error,
3 when a blueprint is refused, 1 when this build could not finish.
`;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Everything the survey looks through: file system, runner, environment, clock and hints. Only bin/ builds the real one. */
  deps: () => LookDeps;
}

function parse(args: string[], options: ParseArgsOptionsConfig) {
  const { values, positionals } = parseArgs({ args, options, strict: true, allowPositionals: true });
  if (positionals.length > 0) throw new UsageError("unexpected argument");
  return values as Record<string, string | boolean | undefined>;
}

function emit(io: CliIo, deps: LookDeps, value: unknown): number {
  const line = JSON.stringify(value);
  if (outputLeak(line, deps.hints)) {
    io.stderr("agenttool-house: internal_error: the output held something that looked like an identifier, so nothing was printed\n");
    return EXIT_INTERNAL;
  }
  io.stdout(`${line}\n`);
  return EXIT_OK;
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (argv.includes("--help") || argv.includes("-h") || command === "help") {
      io.stdout(USAGE);
      return EXIT_OK;
    }
    if (command === undefined) throw new UsageError("a command is needed");
    if (command === "survey") {
      parse(rest, {});
      const deps = io.deps();
      return emit(io, deps, await survey(deps));
    }
    if (command === "blueprint") {
      const values = parse(rest, { "from-survey": { type: "boolean" }, name: { type: "string" } });
      if (values["from-survey"] !== true) throw new UsageError("blueprint takes --from-survey");
      const name = typeof values.name === "string" ? values.name : undefined;
      if (name !== undefined) checkName(name);
      const deps = io.deps();
      return emit(io, deps, blueprintFromSurvey(await survey(deps), name));
    }
    if (command === "plan") {
      const values = parse(rest, { blueprint: { type: "string" } });
      if (typeof values.blueprint !== "string" || values.blueprint === "") throw new UsageError("plan takes --blueprint <path>");
      const deps = io.deps();
      const read = deps.fs.readChosen(values.blueprint, BLUEPRINT_MAX_BYTES);
      if (isFail(read)) throw new RefusalError("unreadable", "the blueprint file could not be read");
      if (read.truncated) throw new RefusalError("too_large", "the blueprint file is larger than 256 KiB");
      const blueprint = parseBlueprint(read.text);
      return emit(io, deps, plan(await survey(deps), blueprint, deps.now));
    }
    throw new UsageError("unknown command");
  } catch (error) {
    if (error instanceof UsageError || (error as { code?: string })?.code?.startsWith?.("ERR_PARSE_ARGS")) {
      // parseArgs messages can quote an argument; only our own message is shown.
      const message = error instanceof UsageError ? error.message : "an option this command does not take, or one without its value";
      io.stderr(`agenttool-house: ${message}\n\n${USAGE}`);
      return EXIT_USAGE;
    }
    if (error instanceof RefusalError) {
      io.stderr(`agenttool-house: refused (${error.code}): ${error.message}\n`);
      return EXIT_REFUSED;
    }
    // Never echo an unexpected error's text: it could carry something read from a file.
    io.stderr("agenttool-house: internal_error: this build could not finish\n");
    return EXIT_INTERNAL;
  }
}
