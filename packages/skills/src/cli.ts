import { PACKAGE_VERSION } from "./constants.js";
import { inspectLocalSkills } from "./inspect.js";
import { stableStringify } from "./stable-json.js";

const USAGE = `agenttool-skill — bounded, read-only Agent Skill inspection

Usage:
  agenttool-skill inspect [local-path]
  agenttool-skill validate [local-path]
  agenttool-skill --help
  agenttool-skill --version

inspect emits a stable JSON report and does not install or execute anything.
validate emits the same report and exits 1 when validation errors are present.
`;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

export async function runCli(args: string[], io: CliIo = defaultIo): Promise<number> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    io.stdout(USAGE);
    return 0;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    io.stdout(`${PACKAGE_VERSION}\n`);
    return 0;
  }

  const command = args[0];
  if ((command !== "inspect" && command !== "validate") || args.length > 2 || args[1]?.startsWith("-") === true) {
    io.stderr("Invalid arguments. Run agenttool-skill --help for local-only usage.\n");
    return 2;
  }

  try {
    const report = await inspectLocalSkills(args[1] ?? ".");
    io.stdout(stableStringify(report));
    return command === "validate" && !report.valid ? 1 : 0;
  } catch {
    io.stderr("Inspection failed without exposing the underlying local error.\n");
    return 2;
  }
}
