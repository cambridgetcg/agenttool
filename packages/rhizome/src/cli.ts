/** rhizome/cli — the soil report on a terminal.
 *
 *  Exit code is 0 whether or not gaps were found. Rhizome is a legibility
 *  instrument, not a gate: a tool that fails the build teaches people to
 *  make its findings go away, and making findings go away is exactly how
 *  a lawn ends up growing on rubble. `--fail-on-gap` exists for a caller
 *  who has decided otherwise, and that decision is theirs to make
 *  explicitly.
 */

import { PACKAGE_NAME, PACKAGE_VERSION } from "./constants.js";
import { formatReport } from "./format.js";
import type { JsonValue } from "./json.js";
import { allProbes } from "./registry.js";
import { runProbes, UnknownProbeError } from "./run.js";
import { stableStringify } from "./stable-json.js";

const USAGE = `${PACKAGE_NAME} — read-only soil report for this repository

Usage:
  rhizome [options]

Options:
  --json              machine-readable report on stdout
  --probe <id>        run only this probe (repeatable)
  --root <path>       repository root (default: the repository containing rhizome)
  --list              list registered probes and their questions
  --fail-on-gap       exit 1 when any finding has verdict "gap"
  --help, -h
  --version, -v

Environment:
  RHIZOME_MUTATE=1    let the \`pretend\` probe break guarded code in a shadow
                      of this repository under the system temporary directory
                      and run the guard against it. Slow, and the one place
                      rhizome executes what it reads. Nothing inside the
                      checkout is written either way; without it the probe
                      publishes the mutation plan it did not run.

Rhizome reads. It never writes inside the checkout and never reaches the
network. It reports; fixing is a separate, human-authorised act.
`;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

interface ParsedArgs {
  json: boolean;
  list: boolean;
  failOnGap: boolean;
  probes: string[];
  root?: string;
}

function parseArgs(args: readonly string[]): ParsedArgs | { error: string } {
  const parsed: ParsedArgs = { json: false, list: false, failOnGap: false, probes: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--json") parsed.json = true;
    else if (arg === "--list") parsed.list = true;
    else if (arg === "--fail-on-gap") parsed.failOnGap = true;
    else if (arg === "--probe") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) return { error: "--probe needs a probe id" };
      parsed.probes.push(value);
      i += 1;
    } else if (arg === "--root") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) return { error: "--root needs a path" };
      parsed.root = value;
      i += 1;
    } else return { error: `unknown option: ${arg}` };
  }
  return parsed;
}

export async function runCli(args: readonly string[], io: CliIo = defaultIo): Promise<number> {
  if (args[0] === "--help" || args[0] === "-h") {
    io.stdout(USAGE);
    return 0;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    io.stdout(`${PACKAGE_VERSION}\n`);
    return 0;
  }

  const parsed = parseArgs(args);
  if ("error" in parsed) {
    io.stderr(`${parsed.error}\nRun rhizome --help.\n`);
    return 2;
  }

  if (parsed.list) {
    for (const probe of allProbes()) io.stdout(`${probe.id.padEnd(10)} ${probe.question}\n`);
    return 0;
  }

  let report;
  try {
    report = await runProbes({
      ...(parsed.root === undefined ? {} : { root: parsed.root }),
      probes: parsed.probes,
    });
  } catch (error) {
    if (error instanceof UnknownProbeError) {
      io.stderr(`unknown probe: ${error.id}\nregistered: ${error.known.join(", ")}\n`);
      return 2;
    }
    throw error;
  }

  io.stdout(parsed.json ? stableStringify(report as unknown as JsonValue) : formatReport(report));
  return parsed.failOnGap && report.counts.gap > 0 ? 1 : 0;
}
