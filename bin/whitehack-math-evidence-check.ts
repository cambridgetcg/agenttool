#!/usr/bin/env bun
/**
 * Exact, local, check-only Whitehack mathematical-evidence verifier.
 *
 * It reads one explicit canonical whitehack-math-evidence/v1 byte document,
 * verifies the exact locked Whitehack math-evidence module and its reviewed
 * runtime closure, and emits only the document's canonical SHA-256 address.
 * It creates no geometry, inference, training signal, reward, or authority.
 *
 * Doctrine: docs/WHITEHACK.md
 */
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  WhitehackAdvisoryError,
  loadVerifiedWhitehackModule,
} from "./whitehack-advisory.mjs";

export const WHITEHACK_MATH_EVIDENCE_CHECK_VERSION = "0.1.0";
export const MAX_MATH_EVIDENCE_INPUT_BYTES = 256 * 1024;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SCANNER_LOCK = resolve(
  REPO_ROOT,
  "tools/whitehack-advisory/package-lock.json",
);
const DEFAULT_SCANNER_ROOT = resolve(
  REPO_ROOT,
  "tools/whitehack-advisory/node_modules/@agenttool/whitehack-scan",
);
const MATH_EVIDENCE_ADDRESS = /^sha256:[0-9a-f]{64}$/u;
const EXPECTED_AXES = Object.freeze([
  "observation",
  "hypothesis",
  "reproduction",
  "impact",
  "provenance",
  "authorization",
]);
const EXPECTED_API = Object.freeze([
  "MATH_EVIDENCE_ADDRESS_ALGORITHM",
  "MATH_EVIDENCE_AXES",
  "MATH_EVIDENCE_DOCUMENT_TYPE",
  "MATH_EVIDENCE_MEDIA_TYPE",
  "MAX_MATH_EVIDENCE_BYTES",
  "addressMathEvidence",
  "canonicalizeMathEvidence",
  "createMathEvidence",
  "encodeMathEvidence",
  "parseMathEvidenceBytes",
]);

type CliArguments = Readonly<{
  input: string;
  scanner_lock: string;
  scanner_root: string;
}>;

type WhitehackMathEvidenceModule = Readonly<Record<string, unknown>> & {
  readonly MATH_EVIDENCE_ADDRESS_ALGORITHM: unknown;
  readonly MATH_EVIDENCE_AXES: unknown;
  readonly MATH_EVIDENCE_DOCUMENT_TYPE: unknown;
  readonly MATH_EVIDENCE_MEDIA_TYPE: unknown;
  readonly MAX_MATH_EVIDENCE_BYTES: unknown;
  readonly addressMathEvidence: unknown;
  readonly parseMathEvidenceBytes: unknown;
};

export class WhitehackMathEvidenceCheckError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "WhitehackMathEvidenceCheckError";
  }
}

function fail(code: string): never {
  throw new WhitehackMathEvidenceCheckError(code);
}

function usage(): string {
  return [
    "usage: bun bin/whitehack-math-evidence-check.ts --input <path|->",
    "       [--scanner-root <dir>] [--scanner-lock <package-lock.json>]",
    "",
    "Checks one exact canonical whitehack-math-evidence/v1 byte document and",
    "emits only its sha256:<64 lowercase hex> plaintext address.",
    "",
    "The check does not create or translate evidence, geometry, Principalities,",
    "KINGDOM/P7 or emotion records; infer identity, consent, rights, permission,",
    "or authority; assign training/reward/ranking/fitness weight; write a file;",
    "install a package; contact a network; or publish anything.",
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
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!["--input", "--scanner-lock", "--scanner-root"].includes(name ?? "")) {
      fail("invalid_argument");
    }
    if (seen.has(name!)) fail("duplicate_argument");
    seen.add(name!);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail("missing_argument_value");
    result[name!.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  if (!result.input) fail("missing_input");
  return Object.freeze({
    input: result.input,
    scanner_lock: result.scanner_lock!,
    scanner_root: result.scanner_root!,
  });
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
    if (total > MAX_MATH_EVIDENCE_INPUT_BYTES) {
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
      MAX_MATH_EVIDENCE_INPUT_BYTES + 1 - total,
    ));
    let bytesRead: number;
    try {
      ({ bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null));
    } catch {
      fail("input_unreadable");
    }
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > MAX_MATH_EVIDENCE_INPUT_BYTES) {
      fail("input_byte_limit_exceeded");
    }
    chunks.push(buffer.subarray(0, bytesRead));
  }
  return joinChunks(chunks, total);
}

export async function readMathEvidenceInput(path: string): Promise<Uint8Array> {
  if (path === "-") return await readStdin();
  let handle;
  try {
    handle = await open(resolve(path), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch {
    fail("input_unreadable");
  }
  try {
    const before = await handle.stat();
    if (!before.isFile()) fail("input_not_regular_file");
    if (before.size > MAX_MATH_EVIDENCE_INPUT_BYTES) {
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
    ) {
      fail("input_changed_during_read");
    }
    return bytes;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function verifyExactMathEvidenceApi(
  module: WhitehackMathEvidenceModule,
): asserts module is WhitehackMathEvidenceModule & {
  readonly addressMathEvidence: (document: unknown) => unknown;
  readonly parseMathEvidenceBytes: (bytes: Uint8Array) => unknown;
} {
  if (!module || typeof module !== "object" || Array.isArray(module)) {
    fail("whitehack_math_evidence_api_mismatch");
  }
  const apiNames = Object.keys(module).sort();
  if (
    apiNames.length !== EXPECTED_API.length
    || apiNames.some((name, index) => name !== EXPECTED_API[index])
    || module.MATH_EVIDENCE_DOCUMENT_TYPE !== "whitehack-math-evidence/v1"
    || module.MATH_EVIDENCE_MEDIA_TYPE
      !== "application/vnd.whitehack.math-evidence.v1+json"
    || module.MATH_EVIDENCE_ADDRESS_ALGORITHM !== "sha256"
    || module.MAX_MATH_EVIDENCE_BYTES !== MAX_MATH_EVIDENCE_INPUT_BYTES
    || !Array.isArray(module.MATH_EVIDENCE_AXES)
    || module.MATH_EVIDENCE_AXES.length !== EXPECTED_AXES.length
    || module.MATH_EVIDENCE_AXES.some(
      (axis, index) => axis !== EXPECTED_AXES[index],
    )
    || typeof module.canonicalizeMathEvidence !== "function"
    || typeof module.createMathEvidence !== "function"
    || typeof module.encodeMathEvidence !== "function"
    || typeof module.parseMathEvidenceBytes !== "function"
    || typeof module.addressMathEvidence !== "function"
  ) {
    fail("whitehack_math_evidence_api_mismatch");
  }
}

function captureRuntimeOutput<T>(operation: () => T): Readonly<{
  error: boolean;
  reported: boolean;
  value?: T;
}> {
  const methods = ["debug", "error", "info", "log", "warn"] as const;
  const originals = new Map(methods.map((method) => [method, console[method]]));
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let reported = false;
  for (const method of methods) console[method] = () => { reported = true; };
  process.stdout.write = () => { reported = true; return true; };
  process.stderr.write = () => { reported = true; return true; };
  try {
    return { value: operation(), error: false, reported };
  } catch {
    return { error: true, reported };
  } finally {
    for (const [method, original] of originals) console[method] = original;
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

export function verifyMathEvidenceBytes(
  bytes: Uint8Array,
  module: WhitehackMathEvidenceModule,
): string {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    fail("math_evidence_invalid");
  }
  if (bytes.byteLength > MAX_MATH_EVIDENCE_INPUT_BYTES) {
    fail("input_byte_limit_exceeded");
  }
  verifyExactMathEvidenceApi(module);
  const checked = captureRuntimeOutput(() => {
    const document = module.parseMathEvidenceBytes(bytes);
    return module.addressMathEvidence(document);
  });
  if (checked.reported) fail("math_evidence_runtime_output");
  if (checked.error) fail("math_evidence_invalid");
  const address = checked.value;
  const independentAddress = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (
    typeof address !== "string"
    || !MATH_EVIDENCE_ADDRESS.test(address)
    || address !== independentAddress
  ) {
    fail("math_evidence_address_mismatch");
  }
  return address;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (args === "help") {
    process.stdout.write(usage());
    return;
  }
  if (args === "version") {
    process.stdout.write(`${WHITEHACK_MATH_EVIDENCE_CHECK_VERSION}\n`);
    return;
  }

  const bytes = await readMathEvidenceInput(args.input);
  const { module } = await loadVerifiedWhitehackModule({
    scanner_root: args.scanner_root,
    scanner_lock: args.scanner_lock,
    export_name: "math-evidence",
  });
  process.stdout.write(`${verifyMathEvidenceBytes(bytes, module)}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    const code = error instanceof WhitehackMathEvidenceCheckError
      || error instanceof WhitehackAdvisoryError
      ? error.code
      : "unexpected_failure";
    process.stderr.write(`whitehack math evidence check failed: ${code}\n`);
    process.exitCode = 2;
  });
}
