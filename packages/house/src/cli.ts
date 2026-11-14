/** agenttool-house: survey, blueprint --from-survey, plan --blueprint. Each prints one JSON line and writes no file. */
import { resolve } from "node:path";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { blueprintFromSurvey, checkName, parseBlueprint } from "./blueprint.js";
import { RefusalError, UsageError } from "./errors.js";
import { isFail } from "./fs.js";
import type { LookDeps } from "./looks.js";
import { rootPath } from "./places.js";
import { plan } from "./plan.js";
import { blueprintVariables, outputLeak, surveyVariables } from "./privacy.js";
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
  /** The working directory, against which a relative blueprint path is resolved (by its text alone). Only bin/ reads the real one. */
  cwd?: () => string;
}

function parse(args: string[], options: ParseArgsOptionsConfig) {
  const { values, positionals } = parseArgs({ args, options, strict: true, allowPositionals: true });
  if (positionals.length > 0) throw new UsageError("unexpected argument");
  return values as Record<string, string | boolean | undefined>;
}

/** Prints one line, unless the last check finds the home path, or the user or host name in the texts that came from the device or the person. */
function emit(io: CliIo, deps: LookDeps, value: unknown, variable: readonly string[]): number {
  const line = JSON.stringify(value);
  if (outputLeak(line, deps.hints, variable)) {
    io.stderr("agenttool-house: internal_error: the output held something that looked like an identifier, so nothing was printed\n");
    return EXIT_INTERNAL;
  }
  io.stdout(`${line}\n`);
  return EXIT_OK;
}

/**
 * The blueprint file the person named: a `.json` file, outside the two places
 * where AgentTool keeps journals, ledgers, credentials and keys, and not itself a
 * link; a link in a directory above it is followed, as part of the person's own path.
 * Checked by the path's text and one lstat before it is opened.
 */
function blueprintPath(given: string, io: CliIo, deps: LookDeps): string {
  if (!given.endsWith(".json")) throw new RefusalError("not_json_file", "a blueprint is read only from a file whose name ends in .json");
  const path = resolve(io.cwd?.() ?? "/", given);
  for (const root of [rootPath(deps.home, "share"), rootPath(deps.home, "state")]) {
    if (path === root || path.startsWith(`${root}/`)) {
      throw new RefusalError("inside_agenttool", "a blueprint is not read from ~/.local/share/agenttool or ~/.local/state/agenttool, where journals and keys are kept");
    }
  }
  const stat = deps.fs.lstat(path);
  if (!isFail(stat) && stat.kind === "link") throw new RefusalError("link", "the blueprint file is a link, which is not followed; name the file itself");
  return path;
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv;
  let built: LookDeps | null = null;
  const getDeps = (): LookDeps => (built ??= io.deps());
  try {
    if (argv.includes("--help") || argv.includes("-h") || command === "help") {
      io.stdout(USAGE);
      return EXIT_OK;
    }
    if (command === undefined) throw new UsageError("a command is needed");
    if (command === "survey") {
      parse(rest, {});
      const deps = getDeps();
      const seen = await survey(deps);
      return emit(io, deps, seen, surveyVariables(seen));
    }
    if (command === "blueprint") {
      const values = parse(rest, { "from-survey": { type: "boolean" }, name: { type: "string" } });
      if (values["from-survey"] !== true) throw new UsageError("blueprint takes --from-survey");
      const name = typeof values.name === "string" ? values.name : undefined;
      if (name !== undefined) checkName(name);
      const deps = getDeps();
      const blueprint = blueprintFromSurvey(await survey(deps), name);
      return emit(io, deps, blueprint, blueprintVariables(blueprint));
    }
    if (command === "plan") {
      const values = parse(rest, { blueprint: { type: "string" } });
      if (typeof values.blueprint !== "string" || values.blueprint === "") throw new UsageError("plan takes --blueprint <path>");
      const deps = getDeps();
      const read = deps.fs.readChosen(blueprintPath(values.blueprint, io, deps), BLUEPRINT_MAX_BYTES);
      if (isFail(read)) throw new RefusalError("unreadable", "the blueprint file could not be read");
      if (read.truncated) throw new RefusalError("too_large", "the blueprint file is larger than 256 KiB");
      const blueprint = parseBlueprint(read.text, deps.hints);
      const seen = await survey(deps);
      // A plan's sentences carry the survey's version names; its blueprint's name is not printed.
      return emit(io, deps, plan(seen, blueprint, deps.now), surveyVariables(seen));
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
      // A refusal can repeat a part id from the file; it passes the same last check as any output, against that id.
      const line = `agenttool-house: refused (${error.code}): ${error.message}`;
      const quoted = error.quoted === undefined ? [] : [error.quoted];
      const hints = built === null ? null : (built as LookDeps).hints;
      const withheld = quoted.length > 0 && (hints === null || outputLeak(line, hints, quoted));
      io.stderr(withheld ? `agenttool-house: refused (${error.code}): the blueprint names a part this build does not know: one whose id is not shown\n` : `${line}\n`);
      return EXIT_REFUSED;
    }
    // Never echo an unexpected error's text: it could carry something read from a file.
    io.stderr("agenttool-house: internal_error: this build could not finish\n");
    return EXIT_INTERNAL;
  }
}
