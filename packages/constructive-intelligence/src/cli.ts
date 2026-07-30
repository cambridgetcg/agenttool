import { MAX_ARTIFACT_BYTES, MAX_JSON_BYTES } from "./constants.js";
import { canonicalJson, parseStrictJson, sha256Id } from "./canonical.js";
import { ConstructiveError, fail } from "./errors.js";
import { readBoundedRegularFile } from "./io.js";
import { ConstructiveStore } from "./store.js";
import { createPin, inspectTreeBytes } from "./tree.js";

export interface CliStreams {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const DEFAULT_STREAMS: CliStreams = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

const HELP = `agenttool-constructive (offline shadow pilot)

Commands:
  init   --db PATH --tree PATH --as-of YYYY-MM-DD --quest QUEST_ID
  record --db PATH --receipt PATH [--artifact PATH]
  show   --db PATH --id EVIDENCE_ID
  report --db PATH --pin PIN_ID
  verify --db PATH
  export --db PATH

All paths are explicit. Inputs are bounded local regular files. The CLI does
not discover defaults, fetch URLs, contact networks, move value, or confer
correctness, qualification, permission, authority, or reward eligibility.
`;

function options(tokens: string[], allowed: readonly string[]): Record<string, string> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (let index = 0; index < tokens.length; index += 2) {
    const name = tokens[index];
    const value = tokens[index + 1];
    if (
      name === undefined
      || value === undefined
      || !name.startsWith("--")
      || value.startsWith("--")
      || !allowed.includes(name)
    ) {
      fail("argument_error", "Malformed or unknown command option");
    }
    if (Object.hasOwn(result, name)) fail("argument_error", `Repeated option: ${name}`);
    result[name] = value;
  }
  return result;
}

function required(value: string | undefined, name: string): string {
  if (!value) fail("argument_error", `${name} is required`);
  return value;
}

function emit(streams: CliStreams, value: unknown): void {
  streams.stdout(`${canonicalJson(value)}\n`);
}

export async function runCli(
  argv: readonly string[],
  streams: CliStreams = DEFAULT_STREAMS,
): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    streams.stdout(HELP);
    return 0;
  }
  const command = argv[0] as string;
  let store: ConstructiveStore | undefined;
  try {
    if (command === "init") {
      const parsed = options(argv.slice(1), ["--db", "--tree", "--as-of", "--quest"]);
      const dbPath = required(parsed["--db"], "--db");
      const treePath = required(parsed["--tree"], "--tree");
      const asOf = required(parsed["--as-of"], "--as-of");
      const quest = required(parsed["--quest"], "--quest");
      const inspected = inspectTreeBytes(
        readBoundedRegularFile(treePath, MAX_JSON_BYTES),
        quest,
        asOf,
      );
      const pin = createPin(inspected, asOf, `${asOf}T00:00:00.000Z`);
      store = new ConstructiveStore(dbPath, { create: true });
      store.initialize();
      const status = store.putPin(pin);
      emit(streams, { status, pin, structural_only: true });
      return 0;
    }

    if (command === "record") {
      const parsed = options(argv.slice(1), ["--db", "--receipt", "--artifact"]);
      const dbPath = required(parsed["--db"], "--db");
      const receiptPath = required(parsed["--receipt"], "--receipt");
      const body = parseStrictJson(readBoundedRegularFile(receiptPath, MAX_JSON_BYTES));
      const artifactPath = parsed["--artifact"];
      const artifactDigest = artifactPath === undefined
        ? undefined
        : sha256Id(readBoundedRegularFile(artifactPath, MAX_ARTIFACT_BYTES));
      store = new ConstructiveStore(dbPath, { create: false });
      const result = store.record(body, artifactDigest);
      emit(streams, { ...result, structural_only: true });
      return 0;
    }

    if (command === "show") {
      const parsed = options(argv.slice(1), ["--db", "--id"]);
      store = new ConstructiveStore(required(parsed["--db"], "--db"), { create: false });
      const receipt = store.getReceipt(required(parsed["--id"], "--id"));
      if (!receipt) fail("not_found", "Evidence receipt was not found");
      emit(streams, { ...receipt, structural_only: true });
      return 0;
    }

    if (command === "report") {
      const parsed = options(argv.slice(1), ["--db", "--pin"]);
      store = new ConstructiveStore(required(parsed["--db"], "--db"), { create: false });
      emit(streams, store.report(required(parsed["--pin"], "--pin")));
      return 0;
    }

    if (command === "verify") {
      const parsed = options(argv.slice(1), ["--db"]);
      store = new ConstructiveStore(required(parsed["--db"], "--db"), { create: false });
      emit(streams, store.verify());
      return 0;
    }

    if (command === "export") {
      const parsed = options(argv.slice(1), ["--db"]);
      store = new ConstructiveStore(required(parsed["--db"], "--db"), { create: false });
      emit(streams, store.exportAll());
      return 0;
    }

    return fail("argument_error", `Unknown command: ${command}`);
  } catch (error) {
    if (error instanceof ConstructiveError) {
      streams.stderr(`${canonicalJson({ error: error.code, message: error.message })}\n`);
      return error.code === "not_found" ? 4 : error.code === "conflict" ? 3 : 2;
    }
    streams.stderr(`${canonicalJson({
      error: "internal_error",
      message: error instanceof Error ? error.message : "Unknown error",
    })}\n`);
    return 1;
  } finally {
    store?.close();
  }
}
