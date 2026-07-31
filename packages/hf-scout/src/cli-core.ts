import { open } from "node:fs/promises";

import { safeJson } from "./canonical.js";
import { HfScoutError, invariant } from "./errors.js";
import {
  formatFacilities,
  formatModelLockProjection,
  formatScoutReport,
  formatSearchReport,
} from "./format.js";
import { getHfFacilitiesCatalog } from "./facilities.js";
import { projectLoveModelLock } from "./lock.js";
import { createKingdomHfSidecar, projectAgentDataTextRequest } from "./projection.js";
import { createPublicHubReader } from "./public-hub-reader.js";
import {
  formatHfResearchLeads,
  getCuratedHfResearchCatalog,
  selectHfResearchLeads,
} from "./research-leads.js";
import { inspectHfRepository, searchHfRepositories } from "./scout.js";
import type { HfRepoKind, HfResearchPhase, HubReader } from "./types.js";
import { assertRepoKind, normalizeObservedAt } from "./validation.js";
import { escapeTerminalText } from "./terminal.js";

const MAX_LOCK_BYTES = 4_194_304;

export interface HfScoutCliDependencies {
  reader?: HubReader;
  clock?: () => Date;
  read_text_file?: (path: string) => Promise<string>;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

export async function runHfScoutCli(
  argv: readonly string[],
  dependencies: HfScoutCliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = dependencies.stderr ?? ((text: string) => process.stderr.write(text));
  const command = argv[0] ?? "help";

  try {
    if (command === "help" || command === "--help" || command === "-h") {
      stdout(`${HELP}\n`);
      return 0;
    }
    if (command === "facilities") {
      const flags = parseFlags(argv.slice(1), new Set(["json"]), new Set());
      invariant(flags.positionals.length === 0, "invalid_cli", "facilities accepts no positional arguments");
      const catalog = getHfFacilitiesCatalog();
      stdout(`${flags.boolean.has("json") ? safeJson(catalog) : formatFacilities(catalog)}\n`);
      return 0;
    }
    if (command === "research-leads") {
      const flags = parseFlags(argv.slice(1), new Set(["json"]), new Set(["phase"]));
      invariant(flags.positionals.length === 0, "invalid_cli", "research-leads accepts no positional arguments");
      const phaseText = flags.values.get("phase");
      const phase = phaseText === undefined ? undefined : parseResearchPhase(phaseText);
      const leads = selectHfResearchLeads(phase === undefined ? {} : { phase });
      const catalog = getCuratedHfResearchCatalog();
      stdout(`${flags.boolean.has("json")
        ? safeJson({ ...catalog, leads })
        : formatHfResearchLeads(leads)}\n`);
      return 0;
    }
    if (command === "inspect") {
      const flags = parseFlags(
        argv.slice(1),
        new Set(["json", "sidecar", "agent-data"]),
        new Set(["observed-at"]),
      );
      invariant(flags.positionals.length === 2, "invalid_cli", "inspect requires KIND and REPO_ID");
      const kind = parseKind(flags.positionals[0]!);
      const id = flags.positionals[1]!;
      const observedAt = resolveCliTime(flags.values.get("observed-at"), dependencies.clock);
      const outputModes = ["json", "sidecar", "agent-data"].filter((name) => flags.boolean.has(name));
      invariant(outputModes.length <= 1, "invalid_cli", "choose only one inspect output mode");
      const report = await inspectHfRepository(
        { kind, id },
        {
          reader: dependencies.reader ?? createPublicHubReader(),
          observed_at: observedAt,
        },
      );
      let output: string;
      if (flags.boolean.has("sidecar")) {
        output = safeJson(createKingdomHfSidecar({ generated_at: observedAt, reports: [report] }));
      } else if (flags.boolean.has("agent-data")) {
        output = safeJson(projectAgentDataTextRequest(report));
      } else if (flags.boolean.has("json")) {
        output = safeJson(report);
      } else {
        output = formatScoutReport(report);
      }
      stdout(`${output}\n`);
      return 0;
    }
    if (command === "search") {
      const flags = parseFlags(
        argv.slice(1),
        new Set(["json"]),
        new Set(["limit", "observed-at"]),
      );
      invariant(flags.positionals.length === 2, "invalid_cli", "search requires KIND and QUERY");
      const kind = parseKind(flags.positionals[0]!);
      const query = flags.positionals[1]!;
      const limitText = flags.values.get("limit");
      const limit = limitText === undefined ? undefined : parsePositiveInteger(limitText, "limit");
      const observedAt = resolveCliTime(flags.values.get("observed-at"), dependencies.clock);
      const report = await searchHfRepositories(
        {
          kind,
          query,
          ...(limit === undefined ? {} : { limit }),
        },
        {
          reader: dependencies.reader ?? createPublicHubReader(),
          observed_at: observedAt,
        },
      );
      stdout(`${flags.boolean.has("json") ? safeJson(report) : formatSearchReport(report)}\n`);
      return 0;
    }
    if (command === "lock-status") {
      const flags = parseFlags(argv.slice(1), new Set(["json"]), new Set());
      invariant(flags.positionals.length === 1, "invalid_cli", "lock-status requires an explicit FILE path");
      const readText = dependencies.read_text_file ?? readBoundedTextFile;
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readText(flags.positionals[0]!)) as unknown;
      } catch (error) {
        if (error instanceof HfScoutError) throw error;
        throw new HfScoutError("invalid_lock_json", "model lock could not be read as JSON");
      }
      const projection = projectLoveModelLock(parsed);
      stdout(`${flags.boolean.has("json") ? safeJson(projection) : formatModelLockProjection(projection)}\n`);
      return 0;
    }
    throw new HfScoutError("invalid_cli", "unknown command");
  } catch (error) {
    if (error instanceof HfScoutError) {
      stderr(`error[${escapeTerminalText(error.code)}]: ${escapeTerminalText(error.message)}\n`);
      return error.code === "invalid_cli"
        || error.code.startsWith("invalid_")
        || error.code === "unsupported_public_operation"
        ? 2
        : 3;
    }
    stderr("error[unexpected]: operation failed\n");
    return 3;
  }
}

interface ParsedFlags {
  positionals: string[];
  boolean: Set<string>;
  values: Map<string, string>;
}

function parseFlags(
  argv: readonly string[],
  booleanNames: ReadonlySet<string>,
  valueNames: ReadonlySet<string>,
): ParsedFlags {
  const result: ParsedFlags = {
    positionals: [],
    boolean: new Set(),
    values: new Map(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith("--")) {
      result.positionals.push(argument);
      continue;
    }
    const name = argument.slice(2);
    if (booleanNames.has(name)) {
      invariant(!result.boolean.has(name), "invalid_cli", `--${name} may appear only once`);
      result.boolean.add(name);
      continue;
    }
    if (valueNames.has(name)) {
      const value = argv[index + 1];
      invariant(value !== undefined && !value.startsWith("--"), "invalid_cli", `--${name} requires a value`);
      invariant(!result.values.has(name), "invalid_cli", `--${name} may appear only once`);
      result.values.set(name, value);
      index += 1;
      continue;
    }
    throw new HfScoutError("invalid_cli", `unsupported option --${name}`);
  }
  return result;
}

function parseKind(value: string): HfRepoKind {
  assertRepoKind(value);
  return value;
}

function parseResearchPhase(value: string): HfResearchPhase {
  const phase = selectHfResearchLeads()
    .find((lead) => lead.research.phase === value)?.research.phase;
  invariant(phase, "invalid_cli", "research phase is invalid");
  return phase;
}

function parsePositiveInteger(value: string, label: string): number {
  invariant(/^[1-9]\d*$/u.test(value), "invalid_cli", `${label} must be a positive integer`);
  const parsed = Number(value);
  invariant(Number.isSafeInteger(parsed), "invalid_cli", `${label} must be a positive integer`);
  return parsed;
}

function resolveCliTime(value: string | undefined, clock?: () => Date): string {
  if (value !== undefined) return normalizeObservedAt(value);
  const date = clock ? clock() : new Date();
  invariant(date instanceof Date && Number.isFinite(date.getTime()), "invalid_clock", "clock returned an invalid date");
  return normalizeObservedAt(date.toISOString());
}

async function readBoundedTextFile(path: string): Promise<string> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch {
    throw new HfScoutError("invalid_model_lock", "model lock file could not be opened");
  }
  try {
    const info = await handle.stat();
    invariant(info.isFile(), "invalid_model_lock", "model lock path is not a regular file");
    invariant(info.size <= MAX_LOCK_BYTES, "invalid_model_lock", "model lock exceeds the byte limit");
    return await handle.readFile({ encoding: "utf8" });
  } catch (error) {
    if (error instanceof HfScoutError) throw error;
    throw new HfScoutError("invalid_model_lock", "model lock file could not be read");
  } finally {
    await handle.close();
  }
}

const HELP = `agenttool-hf-scout — private read-only HF metadata/provenance prototype

Usage:
  agenttool-hf-scout facilities [--json]
  agenttool-hf-scout research-leads [--phase PHASE] [--json]
  agenttool-hf-scout search KIND QUERY [--limit N] [--observed-at ISO] [--json]
  agenttool-hf-scout inspect KIND REPO_ID [--observed-at ISO] [--json|--sidecar|--agent-data]
  agenttool-hf-scout lock-status FILE [--json]

KIND is model, dataset, space, or paper. The built-in public HTTP reader supports
model, dataset, and space. It sends fixed unauthenticated GET requests only.

This CLI does not upload, download repository files, run models, invoke Spaces,
start Jobs/Sandboxes, publish npm packages, or inherit MCP OAuth.`;
