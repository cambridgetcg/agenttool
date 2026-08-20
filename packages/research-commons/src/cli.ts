import { canonicalJson } from "./canonical.js";
import { RESEARCH_FORMATS, ZERO_EFFECTS } from "./constants.js";
import { fail } from "./errors.js";
import { readBoundedLocalFile } from "./io.js";
import { parseResearchSimulationJson } from "./records.js";
import { simulateResearchCommons } from "./simulator.js";

export interface CliInvocation {
  readonly command: "simulate" | "validate";
  readonly inputPath: string;
}

export function parseCliArguments(args: readonly string[]): CliInvocation {
  if (
    args.length !== 3 ||
    !(["simulate", "validate"] as const).includes(args[0] as "simulate" | "validate") ||
    args[1] !== "--input" ||
    !args[2]
  ) {
    fail(
      "argument_error",
      "Usage: agenttool-research-commons <validate|simulate> --input <local-json-file>",
    );
  }
  return { command: args[0] as "simulate" | "validate", inputPath: args[2] };
}

export function runCli(args: readonly string[], workingDirectory = process.cwd()): string {
  const invocation = parseCliArguments(args);
  const simulation = parseResearchSimulationJson(
    readBoundedLocalFile(invocation.inputPath, workingDirectory),
  );
  const report = simulateResearchCommons(simulation);
  if (invocation.command === "simulate") return `${canonicalJson(report)}\n`;
  return `${canonicalJson({
    _format: "agenttool.research-cli-validation/0.1",
    effects: ZERO_EFFECTS,
    simulation_format: RESEARCH_FORMATS.simulation,
    simulation_id: report.simulation_id,
    structural_only: true,
    valid: true,
  })}\n`;
}
