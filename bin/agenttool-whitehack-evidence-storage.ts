#!/usr/bin/env bun
/**
 * Explicit bounded CLI for encrypted Whitehack evidence storage and retrieval.
 *
 * Credentials and the retrieval private key are accepted only through fixed
 * environment variable names. Provider errors, endpoints, and secret values
 * never cross the CLI error boundary.
 *
 * Doctrine: docs/WHITEHACK.md
 */
import { constants as fsConstants } from "node:fs";
import {
  open,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { S3CompatibleBlockStore } from
  "../packages/data-protocol/src/s3-store.js";
import {
  WHITEHACK_EVIDENCE_STORAGE_VERSION,
  WhitehackEvidenceStorageError,
  canonicalWhitehackEvidenceStorageReceipt,
} from "./_whitehack-evidence-storage.js";
import {
  decodeWhitehackRecipientPrivateKey,
  retrieveWhitehackEvidence,
  storeWhitehackEvidence,
} from "./_whitehack-evidence-storage-service.js";

export const MAX_WHITEHACK_EVIDENCE_STORAGE_INPUT_BYTES = 256 * 1024;

const ACCESS_KEY_ENV = "AGENTTOOL_WHITEHACK_S3_ACCESS_KEY_ID";
const SECRET_KEY_ENV = "AGENTTOOL_WHITEHACK_S3_SECRET_ACCESS_KEY";
const SESSION_TOKEN_ENV = "AGENTTOOL_WHITEHACK_S3_SESSION_TOKEN";
const RECIPIENT_ID_ENV = "AGENTTOOL_WHITEHACK_RECIPIENT_ID";
const RECIPIENT_PRIVATE_KEY_ENV =
  "AGENTTOOL_WHITEHACK_RECIPIENT_X25519_PRIVATE_KEY";

type Command = "store" | "retrieve";
type CliArguments = Readonly<{
  command: Command;
  input: string;
  s3_endpoint: string;
  s3_region: string;
  s3_prefix?: string;
  output?: string;
  allow_insecure_loopback_http_for_tests: boolean;
}>;

function fail(code: string): never {
  throw new WhitehackEvidenceStorageError(code);
}

function usage(): string {
  return [
    "usage:",
    "  bun bin/agenttool-whitehack-evidence-storage.ts store",
    "    --input <path|-> --s3-endpoint <https-url/bucket>",
    "    --s3-region <region> [--s3-prefix <prefix>]",
    "    --output <new-private-path|->",
    "  bun bin/agenttool-whitehack-evidence-storage.ts retrieve",
    "    --input <receipt-path|-> --s3-endpoint <https-url/bucket>",
    "    --s3-region <region> [--s3-prefix <prefix>]",
    "    [--output <new-private-path|->]",
    "",
    "The endpoint includes exactly one path-style bucket segment. The bridge",
    "uses a finite 5-second deadline for each provider call and never retries.",
    "A null grant expiry selects 30 days; explicit finite expiry may be at most",
    "10 years. Publisher custody is discarded, so a receipt cannot be extended.",
    "",
    "Fixed credential environment names:",
    `  ${ACCESS_KEY_ENV}`,
    `  ${SECRET_KEY_ENV}`,
    `  ${SESSION_TOKEN_ENV} (optional)`,
    "",
    "retrieve additionally requires:",
    `  ${RECIPIENT_ID_ENV}`,
    `  ${RECIPIENT_PRIVATE_KEY_ENV}`,
    "",
    "store emits a sensitive local receipt containing recipient/publisher",
    "metadata and a recipient-bound read grant. Before any network request, a",
    "file output is reserved as a new exclusive 0600 file; it never overwrites.",
    "Use --output - only for an explicitly controlled pipe.",
    "The receipt is not safe to publish.",
    "No command scans targets, writes Castle, deletes objects, retries, or",
    "claims durability, permanence, retention, authorization, or publication.",
    "",
    "Test harnesses may add --allow-insecure-loopback-http-for-tests; it only",
    "permits exact loopback HTTP and is not a production transport mode.",
    "",
  ].join("\n");
}

function parseArgs(
  argv: readonly string[],
): CliArguments | "help" | "version" {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    return "help";
  }
  if (argv.length === 1 && argv[0] === "--version") return "version";
  const command = argv[0];
  if (command !== "store" && command !== "retrieve") {
    fail("explicit_command_required");
  }

  const values = new Map<string, string>();
  let allowInsecureLoopback = false;
  for (let index = 1; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--allow-insecure-loopback-http-for-tests") {
      if (allowInsecureLoopback) fail("duplicate_argument");
      allowInsecureLoopback = true;
      continue;
    }
    if (
      name !== "--input"
      && name !== "--s3-endpoint"
      && name !== "--s3-region"
      && name !== "--s3-prefix"
      && name !== "--output"
    ) fail("invalid_argument");
    if (values.has(name)) fail("duplicate_argument");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail("missing_argument_value");
    values.set(name, value);
    index += 1;
  }
  const input = values.get("--input");
  const endpoint = values.get("--s3-endpoint");
  const region = values.get("--s3-region");
  if (input === undefined) fail("missing_input");
  if (endpoint === undefined || region === undefined) {
    fail("missing_s3_configuration");
  }
  if (command === "store" && !values.has("--output")) {
    fail("missing_output");
  }
  return Object.freeze({
    command,
    input,
    s3_endpoint: endpoint,
    s3_region: region,
    ...(values.has("--s3-prefix")
      ? { s3_prefix: values.get("--s3-prefix")! }
      : {}),
    ...(values.has("--output")
      ? { output: values.get("--output")! }
      : {}),
    allow_insecure_loopback_http_for_tests: allowInsecureLoopback,
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
    if (token === "{") return this.#object(depth + 1);
    if (token === "[") return this.#array(depth + 1);
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
          return JSON.parse(
            this.source.slice(start, this.#offset),
          ) as string;
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
    if (match === null) fail("input_not_json");
    this.#offset += match[0].length;
  }

  #whitespace(): void {
    while (
      this.source[this.#offset] === " "
      || this.source[this.#offset] === "\t"
      || this.source[this.#offset] === "\r"
      || this.source[this.#offset] === "\n"
    ) this.#offset += 1;
  }
}

function decodeJson(bytes: Uint8Array): unknown {
  if (bytes.byteLength > MAX_WHITEHACK_EVIDENCE_STORAGE_INPUT_BYTES) {
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
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function readStdin(): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = typeof chunk === "string"
      ? new TextEncoder().encode(chunk)
      : Uint8Array.from(chunk);
    total += bytes.byteLength;
    if (total > MAX_WHITEHACK_EVIDENCE_STORAGE_INPUT_BYTES) {
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
      MAX_WHITEHACK_EVIDENCE_STORAGE_INPUT_BYTES + 1 - total,
    ));
    let bytesRead: number;
    try {
      ({ bytesRead } = await handle.read(
        buffer,
        0,
        buffer.byteLength,
        null,
      ));
    } catch {
      fail("input_unreadable");
    }
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > MAX_WHITEHACK_EVIDENCE_STORAGE_INPUT_BYTES) {
      fail("input_byte_limit_exceeded");
    }
    chunks.push(buffer.subarray(0, bytesRead));
  }
  return joinChunks(chunks, total);
}

export async function readWhitehackEvidenceStorageInput(
  path: string,
  options: Readonly<{ require_private_file?: boolean }> = {},
): Promise<unknown> {
  if (path === "-") return decodeJson(await readStdin());
  let handle: FileHandle;
  try {
    handle = await open(
      resolve(path),
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
    if (
      options.require_private_file === true
      && (before.mode & 0o077) !== 0
    ) fail("input_permissions_too_open");
    if (before.size > MAX_WHITEHACK_EVIDENCE_STORAGE_INPUT_BYTES) {
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
      || (
        options.require_private_file === true
        && (after.mode & 0o077) !== 0
      )
    ) fail("input_changed_during_read");
    return decodeJson(bytes);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

type PreparedOutput = Readonly<{
  write(bytes: Uint8Array): Promise<void>;
  abort(): Promise<void>;
}>;

/**
 * Reserve an exclusive 0600 destination before any provider operation. A
 * caller must explicitly select "-" to accept stdout/pipe custody instead.
 */
export async function prepareWhitehackEvidenceStorageOutput(
  destination: string,
): Promise<PreparedOutput> {
  if (
    typeof destination !== "string"
    || destination.length === 0
  ) fail("output_invalid");
  if (destination === "-") {
    return Object.freeze({
      async write(bytes: Uint8Array): Promise<void> {
        if (!(bytes instanceof Uint8Array)) fail("output_invalid");
        try {
          await new Promise<void>((resolveWrite, rejectWrite) => {
            process.stdout.write(bytes, (error) => {
              if (error) rejectWrite(error);
              else resolveWrite();
            });
          });
        } catch {
          fail("output_write_failed");
        }
      },
      async abort(): Promise<void> {},
    });
  }

  const outputPath = resolve(destination);
  let handle: FileHandle | undefined;
  let completed = false;
  try {
    handle = await open(
      outputPath,
      fsConstants.O_WRONLY
        | fsConstants.O_CREAT
        | fsConstants.O_EXCL
        | fsConstants.O_NOFOLLOW,
      0o600,
    );
    const opened = await handle.stat();
    if (!opened.isFile() || (opened.mode & 0o077) !== 0) {
      fail("output_write_failed");
    }
    return Object.freeze({
      async write(bytes: Uint8Array): Promise<void> {
        if (!(bytes instanceof Uint8Array)) fail("output_invalid");
        if (completed || handle === undefined) fail("output_write_failed");
        try {
          await handle.writeFile(bytes);
          await handle.sync();
          const written = await handle.stat();
          if (
            written.dev !== opened.dev
            || written.ino !== opened.ino
            || written.size !== bytes.byteLength
            || (written.mode & 0o077) !== 0
          ) fail("output_write_failed");
          await handle.close();
          handle = undefined;
          completed = true;
        } catch (error) {
          if (error instanceof WhitehackEvidenceStorageError) throw error;
          fail("output_write_failed");
        }
      },
      async abort(): Promise<void> {
        if (completed) return;
        await handle?.close().catch(() => undefined);
        handle = undefined;
        await unlink(outputPath).catch(() => undefined);
      },
    });
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "EEXIST"
    ) fail("output_already_exists");
    if (error instanceof WhitehackEvidenceStorageError) throw error;
    fail("output_write_failed");
  }
}

export async function writeWhitehackEvidenceStorageOutput(
  destination: string,
  bytes: Uint8Array,
): Promise<void> {
  const output = await prepareWhitehackEvidenceStorageOutput(destination);
  try {
    await output.write(bytes);
  } finally {
    await output.abort();
  }
}

function environmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  code: string,
): string {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) fail(code);
  return value;
}

function createStore(
  args: CliArguments,
  environment: NodeJS.ProcessEnv,
): S3CompatibleBlockStore {
  const accessKeyId = environmentValue(
    environment,
    ACCESS_KEY_ENV,
    "s3_credentials_missing",
  );
  const secretAccessKey = environmentValue(
    environment,
    SECRET_KEY_ENV,
    "s3_credentials_missing",
  );
  try {
    return new S3CompatibleBlockStore({
      endpoint: args.s3_endpoint,
      region: args.s3_region,
      accessKeyId,
      secretAccessKey,
      ...(environment[SESSION_TOKEN_ENV] === undefined
        ? {}
        : { sessionToken: environment[SESSION_TOKEN_ENV] }),
      ...(args.s3_prefix === undefined ? {} : { prefix: args.s3_prefix }),
      allowInsecureLoopbackHttpForTests:
        args.allow_insecure_loopback_http_for_tests,
    });
  } catch {
    fail("s3_configuration_invalid");
  }
}

export async function main(
  argv = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const args = parseArgs(argv);
  if (args === "help") {
    process.stdout.write(usage());
    return;
  }
  if (args === "version") {
    process.stdout.write(`${WHITEHACK_EVIDENCE_STORAGE_VERSION}\n`);
    return;
  }
  const output = await prepareWhitehackEvidenceStorageOutput(
    args.output ?? "-",
  );
  try {
    const input = await readWhitehackEvidenceStorageInput(args.input, {
      require_private_file: args.command === "retrieve",
    });
    const store = createStore(args, environment);
    if (args.command === "store") {
      const receipt = await storeWhitehackEvidence(input, store);
      const bytes = new TextEncoder().encode(
        canonicalWhitehackEvidenceStorageReceipt(receipt),
      );
      try {
        await output.write(bytes);
      } finally {
        bytes.fill(0);
      }
      return;
    }

    const recipientId = environmentValue(
      environment,
      RECIPIENT_ID_ENV,
      "recipient_credentials_missing",
    );
    const privateKeyText = environmentValue(
      environment,
      RECIPIENT_PRIVATE_KEY_ENV,
      "recipient_credentials_missing",
    );
    const privateKey = decodeWhitehackRecipientPrivateKey(privateKeyText);
    let capsule: Uint8Array | undefined;
    try {
      capsule = await retrieveWhitehackEvidence(
        input,
        store,
        recipientId,
        privateKey,
      );
      await output.write(capsule);
    } finally {
      privateKey.fill(0);
      capsule?.fill(0);
    }
  } finally {
    await output.abort();
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    const code = error instanceof WhitehackEvidenceStorageError
      ? error.code
      : "unexpected_failure";
    process.stderr.write(
      `agenttool whitehack evidence storage failed: ${code}\n`,
    );
    process.exitCode = 2;
  });
}
