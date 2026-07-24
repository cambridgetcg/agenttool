#!/usr/bin/env bun
/**
 * Bounded local Whitehack advisory -> Castle gate-candidate projector.
 *
 * It reads one explicit advisory JSON document and writes one minimized,
 * offer-only intake document to stdout. It never opens or writes a Castle,
 * runs a loop, invokes Git, starts a process, contacts a network, tests a
 * target, remediates code, commits, publishes, or promotes an observation.
 *
 * Doctrine: docs/WHITEHACK.md
 */
import { constants as fsConstants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  CASTLE_WHITEHACK_INTAKE_VERSION,
  CastleWhitehackIntakeError,
  createCastleWhitehackIntake,
} from "./_castle-whitehack-intake.js";

export const MAX_CASTLE_WHITEHACK_INPUT_BYTES = 8 * 1024 * 1024;

type CliArguments = Readonly<{
  input: string;
  include_locations: boolean;
}>;

function fail(code: string): never {
  throw new CastleWhitehackIntakeError(code);
}

function usage(): string {
  return [
    "usage: bun bin/agenttool-castle-whitehack-intake.ts --input <path|->",
    "       [--include-locations]",
    "",
    "Reads one bounded agenttool-whitehack-advisory/v0.1 document and emits",
    "agenttool-castle-whitehack-intake/v1 to stdout.",
    "",
    "Locations are omitted by default. --include-locations retains the",
    "advisory's untrusted file labels and line numbers for explicit local use.",
    "",
    "The projector does not write a Castle, run loops or Git, test targets,",
    "remediate, authorize, commit, publish, use wallets, sign, call RPC,",
    "simulate, broadcast, spawn a process, or contact a network.",
    "",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): CliArguments | "help" | "version" {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    return "help";
  }
  if (argv.length === 1 && argv[0] === "--version") return "version";

  let input: string | null = null;
  let includeLocations = false;
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--include-locations") {
      if (includeLocations) fail("duplicate_argument");
      includeLocations = true;
      continue;
    }
    if (name !== "--input") fail("invalid_argument");
    if (input !== null) fail("duplicate_argument");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail("missing_argument_value");
    input = value;
    index += 1;
  }
  if (input === null) fail("missing_input");
  return Object.freeze({
    input,
    include_locations: includeLocations,
  });
}

class JsonScanner {
  #offset = 0;

  constructor(private readonly source: string) {}

  scan(): void {
    this.#whitespace();
    if (this.#offset >= this.source.length) fail("input_not_json");
    this.#value(0);
    this.#whitespace();
    if (this.#offset !== this.source.length) fail("input_not_json");
  }

  #value(depth: number): void {
    if (depth > 72) fail("input_json_depth_exceeded");
    const token = this.source[this.#offset];
    if (token === "{") {
      this.#object(depth + 1);
      return;
    }
    if (token === "[") {
      this.#array(depth + 1);
      return;
    }
    if (token === '"') {
      this.#string();
      return;
    }
    if (
      token === "-"
      || (token !== undefined && token >= "0" && token <= "9")
    ) {
      this.#number();
      return;
    }
    for (const literal of ["true", "false", "null"]) {
      if (this.source.startsWith(literal, this.#offset)) {
        this.#offset += literal.length;
        return;
      }
    }
    fail("input_not_json");
  }

  #object(depth: number): void {
    this.#offset += 1;
    this.#whitespace();
    if (this.source[this.#offset] === "}") {
      this.#offset += 1;
      return;
    }
    const keys = new Set<string>();
    while (true) {
      if (this.source[this.#offset] !== '"') fail("input_not_json");
      const key = this.#string();
      if (keys.has(key)) fail("input_duplicate_json_key");
      keys.add(key);
      this.#whitespace();
      if (this.source[this.#offset] !== ":") fail("input_not_json");
      this.#offset += 1;
      this.#whitespace();
      this.#value(depth);
      this.#whitespace();
      const separator = this.source[this.#offset];
      if (separator === "}") {
        this.#offset += 1;
        return;
      }
      if (separator !== ",") fail("input_not_json");
      this.#offset += 1;
      this.#whitespace();
    }
  }

  #array(depth: number): void {
    this.#offset += 1;
    this.#whitespace();
    if (this.source[this.#offset] === "]") {
      this.#offset += 1;
      return;
    }
    while (true) {
      this.#value(depth);
      this.#whitespace();
      const separator = this.source[this.#offset];
      if (separator === "]") {
        this.#offset += 1;
        return;
      }
      if (separator !== ",") fail("input_not_json");
      this.#offset += 1;
      this.#whitespace();
    }
  }

  #string(): string {
    const start = this.#offset;
    this.#offset += 1;
    while (this.#offset < this.source.length) {
      const code = this.source.charCodeAt(this.#offset);
      if (code === 0x22) {
        this.#offset += 1;
        try {
          return JSON.parse(this.source.slice(start, this.#offset)) as string;
        } catch {
          fail("input_not_json");
        }
      }
      if (code < 0x20) fail("input_not_json");
      if (code === 0x5c) {
        this.#offset += 1;
        const escape = this.source[this.#offset];
        if (escape === "u") {
          const hex = this.source.slice(this.#offset + 1, this.#offset + 5);
          if (!/^[0-9a-fA-F]{4}$/u.test(hex)) fail("input_not_json");
          this.#offset += 5;
          continue;
        }
        if (escape === undefined || !'"\\/bfnrt'.includes(escape)) {
          fail("input_not_json");
        }
      }
      this.#offset += 1;
    }
    fail("input_not_json");
  }

  #number(): void {
    const match =
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(
        this.source.slice(this.#offset),
      );
    if (!match) fail("input_not_json");
    this.#offset += match[0].length;
  }

  #whitespace(): void {
    while (
      this.source[this.#offset] === " "
      || this.source[this.#offset] === "\t"
      || this.source[this.#offset] === "\r"
      || this.source[this.#offset] === "\n"
    ) {
      this.#offset += 1;
    }
  }
}

function decodeJson(bytes: Uint8Array): unknown {
  if (bytes.byteLength > MAX_CASTLE_WHITEHACK_INPUT_BYTES) {
    fail("input_byte_limit_exceeded");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("input_not_utf8");
  }
  new JsonScanner(text).scan();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    fail("input_not_json");
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
    if (total > MAX_CASTLE_WHITEHACK_INPUT_BYTES) {
      fail("input_byte_limit_exceeded");
    }
    chunks.push(bytes);
  }
  return joinChunks(chunks, total);
}

async function readOpenedFile(handle: FileHandle): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const buffer = new Uint8Array(Math.min(
      64 * 1024,
      MAX_CASTLE_WHITEHACK_INPUT_BYTES + 1 - total,
    ));
    let bytesRead: number;
    try {
      ({ bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null));
    } catch {
      fail("input_unreadable");
    }
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > MAX_CASTLE_WHITEHACK_INPUT_BYTES) {
      fail("input_byte_limit_exceeded");
    }
    chunks.push(buffer.subarray(0, bytesRead));
  }
  return joinChunks(chunks, total);
}

export async function readCastleWhitehackInput(path: string): Promise<unknown> {
  if (path === "-") return decodeJson(await readStdin());
  const requested = resolve(path);
  let handle: FileHandle;
  try {
    handle = await open(
      requested,
      fsConstants.O_RDONLY
        | fsConstants.O_NOFOLLOW
        | fsConstants.O_NONBLOCK,
    );
  } catch {
    fail("input_unreadable");
  }
  try {
    const before = await handle.stat();
    if (!before.isFile()) fail("input_not_regular_file");
    if (before.size > MAX_CASTLE_WHITEHACK_INPUT_BYTES) {
      fail("input_byte_limit_exceeded");
    }
    const bytes = await readOpenedFile(handle);
    const after = await handle.stat();
    if (
      bytes.byteLength !== before.size
      || after.size !== before.size
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs
    ) fail("input_changed_during_read");
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
    process.stdout.write(`${CASTLE_WHITEHACK_INTAKE_VERSION}\n`);
    return;
  }

  const advisory = await readCastleWhitehackInput(args.input);
  const document = createCastleWhitehackIntake(advisory, {
    include_locations: args.include_locations,
  });
  process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    const code = error instanceof CastleWhitehackIntakeError
      ? error.code
      : "unexpected_failure";
    process.stderr.write(
      `agenttool castle whitehack intake failed: ${code}\n`,
    );
    process.exitCode = 2;
  });
}
