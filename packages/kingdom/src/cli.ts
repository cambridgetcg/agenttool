import { open } from "node:fs/promises";
import { PACKAGE_VERSION, MAX_KINGDOM_CARD_BYTES } from "./constants.js";
import { parseKingdomCard } from "./card.js";
import type {
  KingdomCardParseResult,
  KingdomDiagnostic,
} from "./types.js";

const USAGE = `agenttool-kingdom — explicit-file, read-only KINGDOM card validation

Usage:
  agenttool-kingdom validate <kingdom.yaml> [--json]
  agenttool-kingdom --help
  agenttool-kingdom --version

The command reads only the named regular file. It does not scan a repository,
use credentials, access the network, or write a registry.
`;

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

async function readBoundedUtf8(path: string): Promise<string | "too-large"> {
  const handle = await open(path, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new TypeError("not a regular file");
    if (stat.size > MAX_KINGDOM_CARD_BYTES) return "too-large";

    const bytes = new Uint8Array(MAX_KINGDOM_CARD_BYTES + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const read = await handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset,
      );
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    if (offset > MAX_KINGDOM_CARD_BYTES) return "too-large";
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, offset),
    );
  } finally {
    await handle.close();
  }
}

function oversizedResult(): KingdomCardParseResult {
  return parseKingdomCard("x".repeat(MAX_KINGDOM_CARD_BYTES + 1));
}

function renderDiagnostic(diagnostic: KingdomDiagnostic): string {
  const location = diagnostic.line === undefined
    ? ""
    : ` line ${diagnostic.line}`;
  const field = diagnostic.field === undefined ? "" : ` ${diagnostic.field}`;
  return `ERROR${location}${field} ${diagnostic.code}: ${diagnostic.message}\n`;
}

function emitResult(
  result: KingdomCardParseResult,
  json: boolean,
  io: CliIo,
): void {
  if (json) {
    io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (result.valid) {
    io.stdout("KINGDOM card is valid.\n");
    return;
  }
  for (const diagnostic of result.diagnostics) {
    io.stderr(renderDiagnostic(diagnostic));
  }
}

export async function runCli(
  args: readonly string[],
  io: CliIo = defaultIo,
): Promise<number> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    io.stdout(USAGE);
    return 0;
  }
  if (
    args.length === 1 &&
    (args[0] === "--version" || args[0] === "-v")
  ) {
    io.stdout(`${PACKAGE_VERSION}\n`);
    return 0;
  }

  const json = args[2] === "--json";
  if (
    args[0] !== "validate" ||
    typeof args[1] !== "string" ||
    args[1].startsWith("-") ||
    (args.length !== 2 && !(args.length === 3 && json))
  ) {
    io.stderr(
      "Invalid arguments. Run agenttool-kingdom --help for explicit-file usage.\n",
    );
    return 2;
  }

  let source: string | "too-large";
  try {
    source = await readBoundedUtf8(args[1]);
  } catch {
    io.stderr(
      "Unable to read the requested card as a regular UTF-8 file; local details omitted.\n",
    );
    return 2;
  }
  const result =
    source === "too-large" ? oversizedResult() : parseKingdomCard(source);
  emitResult(result, json, io);
  return result.valid ? 0 : 1;
}
