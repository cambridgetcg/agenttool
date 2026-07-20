#!/usr/bin/env bun

import { resolve } from "node:path";
import {
  DataNodeConformanceConfigError,
  formatDataNodeConformanceReport,
  runDataNodeConformance,
  type DataNodeConformanceProfile,
} from "./conformance.js";
import { DataNode } from "./node.js";
import { serveDataNode } from "./server.js";

type CliCommand = ServeCommand | DoctorCommand | HelpCommand;

interface ServeCommand {
  command: "serve";
  root?: string;
}

interface DoctorCommand {
  command: "doctor";
  target: string;
  profile: DataNodeConformanceProfile;
  format: "human" | "json";
  token_source?: { kind: "stdin" } | { kind: "env"; name: string };
  scratch_collection?: string;
  expected_node_id?: string;
  allow_mutations: boolean;
  timeout_ms?: number;
  max_response_bytes?: number;
  max_change_pages?: number;
}

interface HelpCommand {
  command: "help";
}

interface CliWriters {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

const HELP = `agenttool-data — local agent-data/v1 reference node and conformance runner

Usage:
  agenttool-data serve [--root PATH]
  agenttool-data doctor ORIGIN [options]

Legacy compatibility:
  agenttool-data [--root=PATH]     Same as "serve" in the 0.x line.

Doctor profiles:
  --profile public                No caller credential or actionable fixture writes (default).
  --profile read                  Dedicated-bearer, authenticated read-only HTTP checks.
  --profile slice1                Full scratch-fixture lifecycle; leaves append-only residue.

Credential input (read/slice1 only):
  --token-stdin                   Read one bearer line from non-interactive stdin.
  --token-env NAME               Read a dedicated node bearer from this exact variable.

Slice 1 mutation gates (all required):
  --scratch-collection ID        Operator-provisioned collection dedicated to conformance.
  --expected-node-id ID          Public node_id observed in a prior public run.
  --allow-mutations              Acknowledge persistent record/blob/change/tombstone residue.

Output and bounds:
  --format human|json            Human report (default) or one JSON document on stdout.
  --timeout-ms N                 Per-request timeout, at most 120000.
  --max-response-bytes N         Per-response cap, at most 33554432.
  --max-change-pages N           Baseline scan cap, at most 1000 pages.

Security boundary:
  Token values in argv are rejected. Manifest requests never carry Authorization; auth
  boundary checks include a generated invalid bearer and non-actionable malformed POSTs.
  The default fetch refuses redirects. A PASS covers only the selected profile at the
  observed target/time; it is not a security certification or secure-erasure claim.`;

export async function main(
  args: string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
  writers: CliWriters = {
    stdout: (value) => console.log(value),
    stderr: (value) => console.error(value),
  },
): Promise<number> {
  let command: CliCommand;
  try {
    command = parseCliArgs(args);
  } catch (error) {
    writers.stderr(formatCliError(error));
    return 2;
  }

  if (command.command === "help") {
    writers.stdout(HELP);
    return 0;
  }
  if (command.command === "serve") {
    try {
      await startServer(command, env, writers);
      return 0;
    } catch (error) {
      writers.stderr(formatCliError(error));
      return 2;
    }
  }

  try {
    const token = command.token_source
      ? await readSelectedToken(command.token_source, env)
      : undefined;
    const report = await runDataNodeConformance({
      target: command.target,
      profile: command.profile,
      ...(token ? { token } : {}),
      ...(command.scratch_collection ? { collection_id: command.scratch_collection } : {}),
      ...(command.expected_node_id ? { expected_node_id: command.expected_node_id } : {}),
      ...(command.allow_mutations ? { acknowledge_persistent_residue: true } : {}),
      ...(command.timeout_ms !== undefined ? { timeout_ms: command.timeout_ms } : {}),
      ...(command.max_response_bytes !== undefined ? { max_response_bytes: command.max_response_bytes } : {}),
      ...(command.max_change_pages !== undefined ? { max_change_pages: command.max_change_pages } : {}),
    });
    writers.stdout(command.format === "json"
      ? JSON.stringify(report)
      : formatDataNodeConformanceReport(report));
    return report.verdict === "pass" ? 0 : report.verdict === "fail" ? 1 : 3;
  } catch (error) {
    writers.stderr(formatCliError(error));
    return 2;
  }
}

export function parseCliArgs(args: string[]): CliCommand {
  if (args.length === 0) return { command: "serve" };
  if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") return { command: "help" };
  if (args[0] === "serve") return parseServeArgs(args.slice(1));
  if (args[0] === "doctor") return parseDoctorArgs(args.slice(1));
  if (args[0]!.startsWith("-")) return parseServeArgs(args);
  throw cliError("unknown_command", "Unknown command");
}

function parseServeArgs(args: string[]): ServeCommand {
  let root: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--root") {
      root = requireArgumentValue(args, ++index, "--root");
    } else if (argument.startsWith("--root=")) {
      root = requireInlineValue(argument, "--root");
    } else {
      throw cliError("unknown_option", "Unknown serve option");
    }
  }
  return { command: "serve", ...(root ? { root } : {}) };
}

function parseDoctorArgs(args: string[]): DoctorCommand {
  if (args.length === 0 || args[0]!.startsWith("-")) {
    throw cliError("target_missing", "doctor requires an exact HTTP(S) origin");
  }
  const target = args[0]!;
  let profile: DataNodeConformanceProfile = "public";
  let format: "human" | "json" = "human";
  let tokenSource: DoctorCommand["token_source"];
  let scratchCollection: string | undefined;
  let expectedNodeId: string | undefined;
  let allowMutations = false;
  let timeoutMs: number | undefined;
  let maxResponseBytes: number | undefined;
  let maxChangePages: number | undefined;

  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--token" || argument.startsWith("--token=") || argument === "--bearer" || argument.startsWith("--bearer=")) {
      throw cliError("credential_in_argv", "Token values in argv are refused; use --token-stdin or --token-env NAME");
    }
    if (argument === "--token-stdin") {
      requireNoTokenSource(tokenSource);
      tokenSource = { kind: "stdin" };
      continue;
    }
    if (argument === "--allow-mutations") {
      allowMutations = true;
      continue;
    }

    const [flag, inline] = splitOption(argument);
    const nextValue = (): string => inline ?? requireArgumentValue(args, ++index, flag);
    switch (flag) {
      case "--profile": {
        const value = nextValue();
        if (value !== "public" && value !== "read" && value !== "slice1") {
          throw cliError("invalid_profile", "--profile must be public, read, or slice1");
        }
        profile = value;
        break;
      }
      case "--format": {
        const value = nextValue();
        if (value !== "human" && value !== "json") {
          throw cliError("invalid_format", "--format must be human or json");
        }
        format = value;
        break;
      }
      case "--token-env": {
        requireNoTokenSource(tokenSource);
        const name = nextValue();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
          throw cliError("invalid_env_name", "--token-env requires a valid environment variable name");
        }
        tokenSource = { kind: "env", name };
        break;
      }
      case "--scratch-collection":
        scratchCollection = nextValue();
        break;
      case "--expected-node-id":
        expectedNodeId = nextValue();
        break;
      case "--timeout-ms":
        timeoutMs = parsePositiveInteger(nextValue(), flag);
        break;
      case "--max-response-bytes":
        maxResponseBytes = parsePositiveInteger(nextValue(), flag);
        break;
      case "--max-change-pages":
        maxChangePages = parsePositiveInteger(nextValue(), flag);
        break;
      default:
        throw cliError("unknown_option", "Unknown doctor option");
    }
  }

  if (profile === "public" && tokenSource) {
    throw cliError("public_profile_token", "The public profile refuses credential input");
  }
  if ((profile === "read" || profile === "slice1") && !tokenSource) {
    throw cliError("credential_source_missing", `The ${profile} profile requires --token-stdin or --token-env NAME`);
  }
  if (profile !== "slice1" && (scratchCollection || expectedNodeId || allowMutations)) {
    throw cliError("mutation_option_without_slice1", "Scratch and mutation options require --profile slice1");
  }
  if (profile === "slice1" && (!scratchCollection || !expectedNodeId || !allowMutations)) {
    throw cliError(
      "mutation_gate_missing",
      "slice1 requires --scratch-collection, --expected-node-id, and --allow-mutations",
    );
  }

  return {
    command: "doctor",
    target,
    profile,
    format,
    ...(tokenSource ? { token_source: tokenSource } : {}),
    ...(scratchCollection ? { scratch_collection: scratchCollection } : {}),
    ...(expectedNodeId ? { expected_node_id: expectedNodeId } : {}),
    allow_mutations: allowMutations,
    ...(timeoutMs !== undefined ? { timeout_ms: timeoutMs } : {}),
    ...(maxResponseBytes !== undefined ? { max_response_bytes: maxResponseBytes } : {}),
    ...(maxChangePages !== undefined ? { max_change_pages: maxChangePages } : {}),
  };
}

async function startServer(
  command: ServeCommand,
  env: Record<string, string | undefined>,
  writers: CliWriters,
): Promise<void> {
  const root = resolve(command.root || env.AGENT_DATA_DIR || ".agent-data");
  const hostname = env.AGENT_DATA_HOST || "127.0.0.1";
  const port = parsePort(env.AGENT_DATA_PORT);
  const nodeBearer = env.AGENT_DATA_NODE_TOKEN || undefined;
  let node: DataNode;
  try {
    node = await DataNode.open({
      root,
      collections: [{
        id: "default",
        name: "Default",
        description: "Default local agent data collection",
        schema: { version: "1" },
        policy: { visibility: "private" },
      }],
    });
  } catch {
    throw cliError(
      "data_node_open_failed",
      "Could not open the configured data-node state; check directory permissions and storage health",
    );
  }

  let server: Bun.Server<undefined>;
  try {
    server = serveDataNode(node, {
      hostname,
      port,
      ...(nodeBearer ? { node_bearer: nodeBearer } : {}),
    });
  } catch {
    node.close();
    throw cliError(
      "server_bind_failed",
      `Could not bind the data-node HTTP server at ${hostname}:${port}; check the host, port, and bearer requirement`,
    );
  }

  writers.stdout(`agent-data/v1 node ${JSON.stringify(node.node_id)} listening at ${server.url}`);
  if (!nodeBearer) writers.stdout("HTTP data access is disabled; set AGENT_DATA_NODE_TOKEN to enable it");
  const shutdown = (): void => {
    server.stop(true);
    node.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

async function readSelectedToken(
  source: NonNullable<DoctorCommand["token_source"]>,
  env: Record<string, string | undefined>,
): Promise<string> {
  if (source.kind === "env") {
    const token = env[source.name];
    if (token === undefined) throw cliError("credential_env_missing", `The selected credential variable '${source.name}' is not set`);
    return validateCredentialLine(token);
  }
  if (process.stdin.isTTY) {
    throw cliError("credential_stdin_tty", "--token-stdin refuses interactive terminal input");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
    size += bytes.byteLength;
    if (size > 16 * 1024) throw cliError("credential_too_large", "Credential stdin exceeds 16384 bytes");
    chunks.push(bytes);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: string;
  try {
    value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw cliError("credential_invalid_utf8", "Credential stdin must be valid UTF-8");
  }
  if (value.endsWith("\n")) value = value.slice(0, -1);
  if (value.endsWith("\r")) value = value.slice(0, -1);
  return validateCredentialLine(value);
}

function validateCredentialLine(value: string): string {
  if (!value || value.includes("\0") || value.includes("\n") || value.includes("\r")) {
    throw cliError("credential_not_single_line", "The dedicated node bearer must be one non-empty line");
  }
  return value;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return 7742;
  if (!/^\d+$/.test(value)) throw cliError("invalid_port", "AGENT_DATA_PORT must be an integer from 0 to 65535");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw cliError("invalid_port", "AGENT_DATA_PORT must be an integer from 0 to 65535");
  }
  return port;
}

function parsePositiveInteger(value: string, flag: string): number {
  if (!/^\d+$/.test(value)) throw cliError("invalid_number", `${flag} requires a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw cliError("invalid_number", `${flag} requires a positive integer`);
  return parsed;
}

function splitOption(argument: string): [string, string | undefined] {
  const equals = argument.indexOf("=");
  return equals === -1
    ? [argument, undefined]
    : [argument.slice(0, equals), argument.slice(equals + 1)];
}

function requireInlineValue(argument: string, flag: string): string {
  const value = argument.slice(flag.length + 1);
  if (!value) throw cliError("option_value_missing", `${flag} requires a value`);
  return value;
}

function requireArgumentValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw cliError("option_value_missing", `${flag} requires a value`);
  return value;
}

function requireNoTokenSource(source: DoctorCommand["token_source"]): void {
  if (source) throw cliError("credential_source_conflict", "Choose exactly one of --token-stdin or --token-env NAME");
}

function cliError(code: string, message: string): DataNodeConformanceConfigError {
  return new DataNodeConformanceConfigError(code, message);
}

function formatCliError(error: unknown): string {
  if (error instanceof DataNodeConformanceConfigError) {
    return `agenttool-data: ${error.code}: ${error.message}`;
  }
  return "agenttool-data: internal_error: the command could not be completed";
}

if (import.meta.main) process.exitCode = await main();
