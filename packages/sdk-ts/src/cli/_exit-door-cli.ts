/**
 * `agenttool-exit-door` — plan, export, and verify a hosted → local copy.
 *
 * No argv value or variable name is ever written to stderr: a credential
 * pasted in the wrong place must not reach CI logs.
 *
 * Credential posture mirrors `packages/data/src/cli.ts`: a token is read only
 * from an explicitly named environment variable (`--*-token-env NAME`) or from
 * non-interactive stdin (`--*-token-stdin`), never from argv and never from an
 * ambient variable the caller did not name. The hosted project bearer and the
 * data-node bearer are separate inputs; each command accepts only the ones it
 * uses (`plan` never contacts a node, `verify` never contacts the hosted API).
 *
 * Exit codes: 0 complete, 3 partial, 1 failed, 2 usage.
 */

import { AgentTool } from "../client.js";
import { AgentToolError } from "../errors.js";
import { EXIT_STORES, type ExitOverall, type ExitStore } from "../exit-door.js";

export const EXIT_CODES = Object.freeze({ complete: 0, failed: 1, usage: 2, partial: 3 });

const MAX_STDIN_BYTES = 16 * 1024;
const DEFAULT_HOSTED_URL = "https://api.agenttool.dev";

export const EXIT_DOOR_USAGE = `Usage:
  agenttool-exit-door plan   (--hosted-token-env NAME | --hosted-token-stdin)
                             [--hosted-url URL] [--stores a,b] [--identity-id ID] [--progress]
  agenttool-exit-door export (--hosted-token-env NAME | --hosted-token-stdin)
                             --node-url URL (--node-token-env NAME | --node-token-stdin)
                             --collection ID [--hosted-url URL] [--stores a,b]
                             [--identity-id ID] [--allow-remote-node] [--progress]
  agenttool-exit-door verify --manifest REC_ID --node-url URL
                             (--node-token-env NAME | --node-token-stdin) [--allow-remote-node]

Copies the hosted continuity core into an existing collection on a local
agent-data/v1 node (hosted → local copy only; nothing hosted changes).
Tokens are never accepted in argv. At most one token may come from stdin.
Stores: ${EXIT_STORES.join(", ")}.
Exit codes: 0 complete, 3 partial, 1 failed, 2 usage.
`;

/** Process seams, injectable for tests. */
export interface ExitDoorCliIo {
  env: Readonly<Record<string, string | undefined>>;
  stdinIsTTY: boolean;
  readStdin(maxBytes: number): Promise<Uint8Array>;
  stdout(text: string): void;
  stderr(text: string): void;
}

type Command = "plan" | "export" | "verify";
type TokenSource = { kind: "env"; name: string } | { kind: "stdin" };

interface Parsed {
  command: Command;
  hostedUrl: string;
  hostedToken?: TokenSource;
  nodeUrl?: string;
  nodeToken?: TokenSource;
  collection?: string;
  manifest?: string;
  stores?: ExitStore[];
  identityId?: string;
  allowRemoteNode: boolean;
  progress: boolean;
}

class UsageError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** Run one CLI invocation. Returns the process exit code. */
export async function runExitDoorCli(args: readonly string[], io: ExitDoorCliIo): Promise<number> {
  let parsed: Parsed | "help";
  try {
    parsed = parseArgs(args);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`agenttool-exit-door: ${error.code}: ${error.message}\nRun agenttool-exit-door --help for usage.\n`);
      return EXIT_CODES.usage;
    }
    throw error;
  }
  if (parsed === "help") {
    io.stdout(EXIT_DOOR_USAGE);
    return EXIT_CODES.complete;
  }

  let hostedToken: string | undefined;
  let nodeToken: string | undefined;
  try {
    hostedToken = parsed.hostedToken ? await readToken(parsed.hostedToken, io, "hosted") : undefined;
    nodeToken = parsed.nodeToken ? await readToken(parsed.nodeToken, io, "node") : undefined;
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`agenttool-exit-door: ${error.code}: ${error.message}\n`);
      return EXIT_CODES.usage;
    }
    throw error;
  }

  try {
    const at = new AgentTool({
      ...(hostedToken !== undefined ? { apiKey: hostedToken } : { transport: NO_HOSTED_AUTHORITY }),
      baseUrl: parsed.hostedUrl,
      ...(parsed.nodeUrl !== undefined
        ? { dataNode: { baseUrl: parsed.nodeUrl, ...(nodeToken !== undefined ? { token: nodeToken } : {}) } }
        : {}),
    });
    const onProgress = parsed.progress
      ? (event: unknown) => io.stderr(`${JSON.stringify(event)}\n`)
      : undefined;

    if (parsed.command === "plan") {
      const plan = await at.exitDoor.plan({
        ...(parsed.stores ? { stores: parsed.stores } : {}),
        ...(parsed.identityId ? { identity_id: parsed.identityId } : {}),
        ...(onProgress ? { on_progress: onProgress } : {}),
      });
      io.stdout(`${JSON.stringify(plan, null, 2)}\n`);
      return exitFor(plan.overall);
    }
    if (parsed.command === "export") {
      const result = await at.exitDoor.export({
        collection_id: parsed.collection!,
        ...(parsed.stores ? { stores: parsed.stores } : {}),
        ...(parsed.identityId ? { identity_id: parsed.identityId } : {}),
        allow_remote_node: parsed.allowRemoteNode,
        ...(onProgress ? { on_progress: onProgress } : {}),
      });
      io.stdout(`${JSON.stringify(result, null, 2)}\n`);
      return exitFor(result.manifest.overall);
    }
    const verified = await at.exitDoor.verify(parsed.manifest!, {
      allow_remote_node: parsed.allowRemoteNode,
    });
    io.stdout(`${JSON.stringify(verified, null, 2)}\n`);
    if (!verified.verified) return EXIT_CODES.failed;
    return verified.manifest_overall === null ? EXIT_CODES.failed : exitFor(verified.manifest_overall);
  } catch (error) {
    if (error instanceof AgentToolError) {
      io.stderr(`${JSON.stringify({
        error: error.code ?? "exit_door_failed",
        ...(error.status !== undefined ? { status: error.status } : {}),
        ...(error.retryAfter !== undefined ? { retry_after: error.retryAfter } : {}),
      })}\n`);
      return EXIT_CODES.failed;
    }
    io.stderr(`${JSON.stringify({ error: "internal_error" })}\n`);
    return EXIT_CODES.failed;
  }
}

/** The process seams for a real Node or Bun process. */
export function processExitDoorIo(): ExitDoorCliIo {
  return {
    env: process.env,
    stdinIsTTY: process.stdin.isTTY === true,
    async readStdin(maxBytes) {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of process.stdin) {
        const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
        size += bytes.byteLength;
        if (size > maxBytes) throw new UsageError("credential_too_large", `Credential stdin exceeds ${maxBytes} bytes`);
        chunks.push(bytes);
      }
      const out = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return out;
    },
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
  };
}

/** `verify` carries no hosted credential; any hosted request is a bug. */
const NO_HOSTED_AUTHORITY = {
  async request(): Promise<Response> {
    throw new AgentToolError("verify never contacts the hosted API.", {
      code: "hosted_not_configured",
    });
  },
};

function exitFor(overall: ExitOverall): number {
  return overall === "complete" ? EXIT_CODES.complete : overall === "partial" ? EXIT_CODES.partial : EXIT_CODES.failed;
}

const CREDENTIAL_IN_ARGV = /^--(?:hosted-|node-)?(?:token|bearer|api-key|key|secret)$/;

function parseArgs(args: readonly string[]): Parsed | "help" {
  if (args.length === 0) throw new UsageError("command_missing", "Choose plan, export, or verify");
  const first = args[0]!;
  if (first === "--help" || first === "-h" || first === "help") return "help";
  if (first !== "plan" && first !== "export" && first !== "verify") {
    throw new UsageError("command_unknown", "Choose plan, export, or verify");
  }
  const parsed: Parsed = {
    command: first,
    hostedUrl: DEFAULT_HOSTED_URL,
    allowRemoteNode: false,
    progress: false,
  };
  const seen = new Set<string>();
  let stdinUsers = 0;
  let hostedUrlGiven = false;

  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index]!;
    const equals = argument.indexOf("=");
    const flag = equals === -1 ? argument : argument.slice(0, equals);
    const inline = equals === -1 ? undefined : argument.slice(equals + 1);
    if (CREDENTIAL_IN_ARGV.test(flag)) {
      throw new UsageError(
        "credential_in_argv",
        "Token values in argv are refused; use --hosted-token-env NAME / --hosted-token-stdin or --node-token-env NAME / --node-token-stdin",
      );
    }
    if (flag === "--help" || flag === "-h") return "help";
    if (seen.has(flag)) throw new UsageError("option_repeated", `${flag} may be given once`);
    seen.add(flag);
    const value = (): string => {
      if (inline !== undefined) {
        if (inline === "") throw new UsageError("option_value_missing", `${flag} requires a value`);
        return inline;
      }
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError("option_value_missing", `${flag} requires a value`);
      }
      index += 1;
      return next;
    };
    const noValue = () => {
      if (inline !== undefined) throw new UsageError("option_takes_no_value", `${flag} takes no value`);
    };

    switch (flag) {
      case "--hosted-url":
        parsed.hostedUrl = httpUrl(value(), flag);
        hostedUrlGiven = true;
        break;
      case "--hosted-token-env":
        if (parsed.hostedToken) throw conflict("hosted");
        parsed.hostedToken = { kind: "env", name: envName(value(), flag) };
        break;
      case "--hosted-token-stdin":
        noValue();
        if (parsed.hostedToken) throw conflict("hosted");
        parsed.hostedToken = { kind: "stdin" };
        stdinUsers += 1;
        break;
      case "--node-url":
        parsed.nodeUrl = httpUrl(value(), flag);
        break;
      case "--node-token-env":
        if (parsed.nodeToken) throw conflict("node");
        parsed.nodeToken = { kind: "env", name: envName(value(), flag) };
        break;
      case "--node-token-stdin":
        noValue();
        if (parsed.nodeToken) throw conflict("node");
        parsed.nodeToken = { kind: "stdin" };
        stdinUsers += 1;
        break;
      case "--collection":
        parsed.collection = value();
        break;
      case "--manifest": {
        const manifest = value();
        if (!/^rec_[a-f0-9]{64}$/.test(manifest)) {
          throw new UsageError("manifest_invalid", "--manifest must be a record id (rec_<64 hex>)");
        }
        parsed.manifest = manifest;
        break;
      }
      case "--stores":
        parsed.stores = storeList(value());
        break;
      case "--identity-id":
        parsed.identityId = value();
        break;
      case "--allow-remote-node":
        noValue();
        parsed.allowRemoteNode = true;
        break;
      case "--progress":
        noValue();
        parsed.progress = true;
        break;
      default:
        // Never echo the argument: a token pasted in the wrong place lands here.
        throw new UsageError("option_unknown", "Unknown option or stray argument (not shown); see --help");
    }
  }

  if (stdinUsers > 1) {
    throw new UsageError("credential_stdin_conflict", "At most one token may come from stdin");
  }
  const refuse = (present: boolean, flag: string) => {
    if (present) throw new UsageError("option_not_for_command", `${flag} is not used by ${parsed.command}`);
  };
  const need = (present: boolean, flag: string) => {
    if (!present) throw new UsageError("option_required", `${parsed.command} requires ${flag}`);
  };

  if (parsed.command === "plan") {
    need(parsed.hostedToken !== undefined, "--hosted-token-env NAME or --hosted-token-stdin");
    refuse(parsed.nodeUrl !== undefined, "--node-url");
    refuse(parsed.nodeToken !== undefined, "a node token");
    refuse(parsed.collection !== undefined, "--collection");
    refuse(parsed.manifest !== undefined, "--manifest");
    refuse(parsed.allowRemoteNode, "--allow-remote-node");
  } else if (parsed.command === "export") {
    need(parsed.hostedToken !== undefined, "--hosted-token-env NAME or --hosted-token-stdin");
    need(parsed.nodeUrl !== undefined, "--node-url");
    need(parsed.nodeToken !== undefined, "--node-token-env NAME or --node-token-stdin");
    need(parsed.collection !== undefined, "--collection");
    refuse(parsed.manifest !== undefined, "--manifest");
  } else {
    need(parsed.manifest !== undefined, "--manifest");
    need(parsed.nodeUrl !== undefined, "--node-url");
    need(parsed.nodeToken !== undefined, "--node-token-env NAME or --node-token-stdin");
    refuse(parsed.hostedToken !== undefined, "a hosted token");
    refuse(hostedUrlGiven, "--hosted-url");
    refuse(parsed.collection !== undefined, "--collection");
    refuse(parsed.stores !== undefined, "--stores");
    refuse(parsed.identityId !== undefined, "--identity-id");
    refuse(parsed.progress, "--progress");
  }
  return parsed;
}

function conflict(which: "hosted" | "node"): UsageError {
  return new UsageError(
    "credential_source_conflict",
    `Choose exactly one of --${which}-token-env NAME or --${which}-token-stdin`,
  );
}

function envName(value: string, flag: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new UsageError("invalid_env_name", `${flag} requires a valid environment variable name`);
  }
  return value;
}

function httpUrl(value: string, flag: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError("invalid_url", `${flag} must be an absolute http(s) URL`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new UsageError("invalid_url", `${flag} must be an absolute http(s) URL without credentials`);
  }
  return value;
}

function storeList(value: string): ExitStore[] {
  const stores = value.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
  if (stores.length === 0) throw new UsageError("stores_invalid", "--stores needs at least one store");
  for (const store of stores) {
    if (!(EXIT_STORES as readonly string[]).includes(store)) {
      throw new UsageError("store_unknown", `Unknown store (not shown); known: ${EXIT_STORES.join(", ")}`);
    }
  }
  return stores as ExitStore[];
}

async function readToken(source: TokenSource, io: ExitDoorCliIo, which: "hosted" | "node"): Promise<string> {
  let value: string;
  if (source.kind === "env") {
    const raw = io.env[source.name];
    if (raw === undefined) {
      // The name is not echoed: a credential passed as the name would leak.
      throw new UsageError("credential_env_missing", `The variable named by --${which}-token-env is not set`);
    }
    value = raw;
  } else {
    if (io.stdinIsTTY) {
      throw new UsageError("credential_stdin_tty", `--${which}-token-stdin refuses interactive terminal input`);
    }
    const bytes = await io.readStdin(MAX_STDIN_BYTES);
    if (bytes.byteLength > MAX_STDIN_BYTES) {
      throw new UsageError("credential_too_large", `Credential stdin exceeds ${MAX_STDIN_BYTES} bytes`);
    }
    try {
      value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new UsageError("credential_invalid_utf8", "Credential stdin must be valid UTF-8");
    }
    if (value.endsWith("\n")) value = value.slice(0, -1);
    if (value.endsWith("\r")) value = value.slice(0, -1);
  }
  if (!value || value.includes("\0") || value.includes("\n") || value.includes("\r")) {
    throw new UsageError("credential_not_single_line", `The ${which} credential must be one non-empty line`);
  }
  return value;
}
