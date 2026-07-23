#!/usr/bin/env bun
/**
 * Bounded local CLI for Agent Wallet -> Whitehack understanding.
 *
 * It reads one explicit JSON input, verifies the exact locked Whitehack
 * understanding module, and writes only the minimized understanding document.
 * It performs no install, network, signing, RPC, simulation, broadcast, storage,
 * or authorization action.
 *
 * Doctrine: docs/WHITEHACK.md
 */
import { constants as fsConstants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  WhitehackAdvisoryError,
  loadVerifiedWhitehackModule,
} from "./whitehack-advisory.mjs";
import {
  WHITEHACK_CONTEXT_PROFILE,
  WHITEHACK_SOURCE_PROTOCOL,
  WhitehackWalletUnderstandingError,
  createAgentWalletUnderstanding,
} from "./_whitehack-wallet-understanding.js";

export const WHITEHACK_WALLET_UNDERSTANDING_VERSION = "0.1.0";
export const MAX_INPUT_BYTES = 8 * 1024 * 1024;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SCANNER_LOCK = resolve(
  REPO_ROOT,
  "tools/whitehack-advisory/package-lock.json",
);
const DEFAULT_SCANNER_ROOT = resolve(
  REPO_ROOT,
  "tools/whitehack-advisory/node_modules/@agenttool/whitehack-scan",
);

type CliArguments = Readonly<{
  input: string;
  scanner_lock: string;
  scanner_root: string;
}>;

function cliFail(code: string): never {
  throw new WhitehackWalletUnderstandingError(code);
}

function usage(): string {
  return [
    "usage: bun bin/whitehack-wallet-understanding.ts --input <path|->",
    "       [--scanner-root <dir>] [--scanner-lock <package-lock.json>]",
    "",
    "Reads one bounded local JSON request and emits whitehack-understanding/v1.",
    "It does not install packages, retrieve or use private keys, sign, call RPC,",
    "simulate, broadcast, authorize, store records, or contact a hosted route.",
    "",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): CliArguments | "help" | "version" {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    return "help";
  }
  if (argv.length === 1 && argv[0] === "--version") return "version";

  const result: Record<string, string> = {
    scanner_lock: DEFAULT_SCANNER_LOCK,
    scanner_root: DEFAULT_SCANNER_ROOT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!["--input", "--scanner-lock", "--scanner-root"].includes(name ?? "")) {
      cliFail("invalid_argument");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) cliFail("missing_argument_value");
    result[name!.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  if (!result.input) cliFail("missing_input");
  return Object.freeze({
    input: result.input,
    scanner_lock: result.scanner_lock!,
    scanner_root: result.scanner_root!,
  });
}

function decodeJson(bytes: Uint8Array): unknown {
  if (bytes.byteLength > MAX_INPUT_BYTES) cliFail("input_byte_limit_exceeded");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    cliFail("input_not_utf8");
  }
  try {
    return JSON.parse(text);
  } catch {
    cliFail("input_not_json");
  }
}

function joinChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function readStdin(): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = typeof chunk === "string"
      ? new TextEncoder().encode(chunk)
      : Uint8Array.from(chunk);
    total += bytes.byteLength;
    if (total > MAX_INPUT_BYTES) cliFail("input_byte_limit_exceeded");
    chunks.push(bytes);
  }
  return joinChunks(chunks, total);
}

async function readOpenedFile(handle: FileHandle): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const buffer = new Uint8Array(
      Math.min(64 * 1024, MAX_INPUT_BYTES + 1 - total),
    );
    let bytesRead: number;
    try {
      ({ bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null));
    } catch {
      cliFail("input_unreadable");
    }
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > MAX_INPUT_BYTES) cliFail("input_byte_limit_exceeded");
    chunks.push(buffer.subarray(0, bytesRead));
  }
  return joinChunks(chunks, total);
}

export async function readUnderstandingInput(path: string): Promise<unknown> {
  if (path === "-") return decodeJson(await readStdin());
  const requested = resolve(path);
  let handle;
  try {
    handle = await open(
      requested,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
  } catch {
    cliFail("input_unreadable");
  }
  try {
    const before = await handle.stat();
    if (!before.isFile()) cliFail("input_not_regular_file");
    if (before.size > MAX_INPUT_BYTES) cliFail("input_byte_limit_exceeded");
    const bytes = await readOpenedFile(handle);
    const after = await handle.stat();
    if (
      bytes.byteLength !== before.size
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs
    ) cliFail("input_changed_during_read");
    return decodeJson(bytes);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (args === "help") {
    process.stdout.write(usage());
    return;
  }
  if (args === "version") {
    process.stdout.write(`${WHITEHACK_WALLET_UNDERSTANDING_VERSION}\n`);
    return;
  }

  const input = await readUnderstandingInput(args.input);
  const { module } = await loadVerifiedWhitehackModule({
    scanner_root: args.scanner_root,
    scanner_lock: args.scanner_lock,
    export_name: "understanding",
  });
  if (
    module?.UNDERSTANDING_DOCUMENT_TYPE !== "whitehack-understanding/v1"
    || module?.UNDERSTANDING_CONTEXT_PROFILE !== WHITEHACK_CONTEXT_PROFILE
    || module?.UNDERSTANDING_SOURCE_PROTOCOL !== WHITEHACK_SOURCE_PROTOCOL
    || typeof module?.createUnderstanding !== "function"
  ) cliFail("whitehack_understanding_api_mismatch");

  const document = createAgentWalletUnderstanding(
    input,
    module.createUnderstanding,
  );
  process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    const code = error instanceof WhitehackWalletUnderstandingError
      || error instanceof WhitehackAdvisoryError
      ? error.code
      : "unexpected_failure";
    process.stderr.write(`whitehack wallet understanding failed: ${code}\n`);
    process.exitCode = 2;
  });
}
