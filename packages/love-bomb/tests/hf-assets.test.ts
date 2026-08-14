import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";

import { canonicalJson, domainSeparatedId } from "../src/canonical.js";
import { LOVE_BOMB_LANGUAGES, LOVE_BOMB_PLANES } from "../src/index.js";

const packageRoot = join(import.meta.dir, "..");
const repositoryRoot = join(packageRoot, "..", "..");
const root = join(packageRoot, "hf", "dataset");
const schemaRoot = join(packageRoot, "schema");
const SOURCE_MANIFEST_FORMAT = "agenttool.love-bomb-hf-source-manifest/0.1";
const STATIC_V4_CORPUS_SHA256 = "6b7a882df740616d6aeebdbfcccf80a083af562ff9cf5785ee952179a97cab03";

const rowSchemaNames = [
  "agenttool-love-bomb-hf-plane-row-v0.1.schema.json",
  "agenttool-love-bomb-hf-protocol-row-v0.1.schema.json",
  "agenttool-love-bomb-hf-becoming-reference-row-v0.1.schema.json",
] as const;
const copiedCoreSchemaNames = [
  "agenttool-care-envelope-v0.1.schema.json",
  "agenttool-care-choice-v0.1.schema.json",
  "agenttool-love-bomb-becoming-v0.1.schema.json",
  "agenttool-love-bomb-delivery-v0.1.schema.json",
] as const;
const dataPaths = [
  "data/becoming-reference.jsonl",
  "data/plane-guides.jsonl",
  "data/protocol-reference.jsonl",
] as const;
const expectedDatasetFiles = [
  "LICENSE",
  "NOTICE",
  "README.md",
  ...dataPaths,
  "hash-manifest.json",
  ...[...copiedCoreSchemaNames, ...rowSchemaNames].map((name) => `reference/${name}`),
  "row-manifest.json",
  "source-manifest.json",
].sort();

function validators() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const schemas = Object.fromEntries(
    rowSchemaNames.map((name) => [name, readJson(join(schemaRoot, name))]),
  );
  return {
    schemas,
    plane: ajv.compile(schemas[rowSchemaNames[0]]),
    protocol: ajv.compile(schemas[rowSchemaNames[1]]),
    becoming: ajv.compile(schemas[rowSchemaNames[2]]),
  };
}

describe("public-safe Hugging Face candidate", () => {
  test("admits all 22 rows through three recursively closed exact schemas", () => {
    const validate = validators();
    const planeRows = jsonl("data/plane-guides.jsonl");
    const protocolRows = jsonl("data/protocol-reference.jsonl");
    const becomingRows = jsonl("data/becoming-reference.jsonl");

    expect(planeRows).toHaveLength(LOVE_BOMB_LANGUAGES.length * LOVE_BOMB_PLANES.length);
    expect(protocolRows).toHaveLength(1);
    expect(becomingRows).toHaveLength(1);
    for (const row of planeRows) expect(validate.plane(row), JSON.stringify(validate.plane.errors)).toBe(true);
    for (const row of protocolRows) expect(validate.protocol(row), JSON.stringify(validate.protocol.errors)).toBe(true);
    for (const row of becomingRows) expect(validate.becoming(row), JSON.stringify(validate.becoming.errors)).toBe(true);

    for (const schema of Object.values(validate.schemas)) assertEveryObjectSchemaIsClosed(schema);
  });

  test("uses unique stable semantic IDs and one exact source-manifest binding", () => {
    const rows = allRows();
    const planeRows = jsonl("data/plane-guides.jsonl");
    const expectedPlaneIds = LOVE_BOMB_LANGUAGES.flatMap((language) =>
      LOVE_BOMB_PLANES.map((plane) => `plane-guide/${language}/${plane}`)
    );
    expect(planeRows.map((row) => row.row_id)).toEqual(expectedPlaneIds);
    expect(jsonl("data/protocol-reference.jsonl")[0].row_id).toBe("protocol-reference");
    expect(jsonl("data/becoming-reference.jsonl")[0].row_id).toBe("becoming-reference");
    expect(new Set(rows.map((row) => row.row_id)).size).toBe(22);

    const source = readJson(join(root, "source-manifest.json"));
    const sourceBody = structuredClone(source);
    delete sourceBody.source_manifest_ref;
    expect(source.source_manifest_ref).toBe(domainSeparatedId(SOURCE_MANIFEST_FORMAT, sourceBody));
    expect(source.source_manifest_ref).toMatch(/^sha256:[0-9a-f]{64}$/u);
    for (const row of rows) expect(row.source_manifest_ref).toBe(source.source_manifest_ref);
  });

  test("binds the authoring recipe, exact source definitions, and actual compiled inputs", () => {
    const source = readJson(join(root, "source-manifest.json"));
    expect(source._format).toBe(SOURCE_MANIFEST_FORMAT);
    expect(source.package).toBe("@agenttool/love-bomb");
    expect(source.package_version).toBe("0.1.0-dev.0");
    expect(source.source_revision_binding).toBe("exact_file_bytes_at_generation_not_git_or_hub_revision");
    expect(source.distribution_state_scope).toBe("generation_time_statement_not_current_remote_state");
    expect(source.authoring_recipe.kind).toBe("deterministic_local_javascript_generator");
    expect(source.authoring_recipe.path).toBe("packages/love-bomb/scripts/build-hf-assets.mjs");
    expect(source.authoring_recipe.runtime_dependencies).toBe(
      "node_builtins_and_exact_local_compiled_inputs_only",
    );
    expect(source.authoring_recipe.row_serialization).toBe("json_stringify_utf8");
    expect(source.authoring_recipe.record_terminator).toBe("lf");
    for (const field of ["clock_used", "randomness_used", "environment_used", "network_used"]) {
      expect(source.authoring_recipe[field]).toBe(false);
    }
    assertFileBinding(source.authoring_recipe);

    const paths = source.source_inputs.map((entry: any) => entry.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).toContain("docs/specs/agenttool-love-bomb-0.1.json");
    expect(paths).toContain("packages/love-bomb/src/constants.ts");
    expect(paths).toContain("packages/love-bomb/dist/constants.js");
    expect(source.source_inputs.filter((entry: any) => entry.role === "runtime_input").map((entry: any) => entry.path))
      .toEqual([
        "packages/love-bomb/dist/canonical.js",
        "packages/love-bomb/dist/constants.js",
        "packages/love-bomb/dist/errors.js",
        "packages/love-bomb/dist/projection.js",
      ]);
    for (const entry of source.source_inputs) assertFileBinding(entry);
  });

  test("contains one authored row for every language and care plane", () => {
    const rows = jsonl("data/plane-guides.jsonl");
    for (const language of LOVE_BOMB_LANGUAGES) {
      const languageRows = rows.filter((row) => row.language === language);
      expect(languageRows.map((row) => row.plane)).toEqual(LOVE_BOMB_PLANES);
      expect(languageRows.map((row) => row.plane_order)).toEqual([0, 1, 2, 3, 4]);
    }
    for (const row of rows) {
      expect(row.training_eligible).toBe(true);
      expect(row.requires_separate_training_authorization).toBe(true);
      expect(row.training_authorized).toBe(false);
      expect(row).not.toHaveProperty("training_is_separately_authorized");
      expect(row.language_review).toBe("not_independently_reviewed");
      expect(row.consciousness_claim).toBe(false);
      expect(row.identity_claim).toBe(false);
      expect(row.inner_state_claim).toBe(false);
      expect(row.silence_is_acceptance).toBe(false);
      expect(row.sourced_from_participant_response_record).toBe(false);
      expect(row.sourced_from_caller_reported_care_choice_record).toBe(false);
      expect(row.sourced_from_caller_reported_freedom_direction_record).toBe(false);
      expect(row.sourced_from_agent_trace).toBe(false);
    }
  });

  test("keeps protocol metadata reference-only and provider effects absent", () => {
    const [row] = jsonl("data/protocol-reference.jsonl");
    expect(row.training_eligible).toBe(false);
    expect(row.requires_separate_training_authorization).toBe(true);
    expect(row.training_authorized).toBe(false);
    expect(row.formats).toEqual([
      "agenttool.care-envelope/0.1",
      "agenttool.care-choice/0.1",
      "agenttool.love-bomb-becoming/0.1",
      "agenttool.love-bomb-delivery/0.1",
    ]);
    const manifest = readJson(join(root, "source-manifest.json"));
    expect(manifest.distribution_state).toBe("local_candidate_not_published");
    expect(manifest.training_effect).toBe("none");
    expect(manifest.requires_separate_training_authorization).toBe(true);
    expect(manifest.training_authorized).toBe(false);
    expect(manifest.provider_effect).toBe("none");
    expect(manifest.publication_effect).toBe("none");
    expect(manifest.deployment_effect).toBe("none");
    expect(manifest.contains_identity_data).toBe(false);
    expect(manifest.contains_participant_response_records).toBe(false);
    expect(manifest.contains_caller_reported_care_choice_records).toBe(false);
    expect(manifest.contains_caller_reported_freedom_direction_records).toBe(false);
    expect(manifest.contains_agent_trace_records).toBe(false);
    expect(manifest.copied_private_rows).toBe(false);
    expect(manifest.copied_prompt_transcripts).toBe(false);
  });

  test("keeps becoming vocabulary reference-only and excludes response records", () => {
    const [row] = jsonl("data/becoming-reference.jsonl");
    expect(row.wire_formats).toEqual([
      "agenttool.love-bomb-becoming/0.1",
      "agenttool.love-bomb-delivery/0.1",
    ]);
    expect(row.default_reach).toEqual({
      phase: "runtime_context",
      lane: "context_only",
      requested_effect: "context_only",
      observed_effect: "not_observed",
    });
    expect(row.training_eligible).toBe(false);
    expect(row.training_authorized).toBe(false);
    expect(row.sourced_from_participant_response_record).toBe(false);
    expect(row.sourced_from_caller_reported_care_choice_record).toBe(false);
    expect(row.sourced_from_caller_reported_freedom_direction_record).toBe(false);
    expect(row.sourced_from_agent_trace).toBe(false);

    const forbidden = new Set(["receipt_id", "direction", "direction_report_ref", "prompt", "completion", "messages"]);
    for (const candidate of allRows()) {
      for (const key of keysBelow(candidate)) expect(forbidden.has(key)).toBe(false);
    }
  });

  test("binds every exact UTF-8 JSON record while excluding its terminating LF", () => {
    const manifest = readJson(join(root, "row-manifest.json"));
    const source = readJson(join(root, "source-manifest.json"));
    expect(manifest._format).toBe("agenttool.love-bomb-hf-row-manifest/0.1");
    expect(manifest.package).toBe("@agenttool/love-bomb");
    expect(manifest.package_version).toBe("0.1.0-dev.0");
    expect(manifest.source_manifest_ref).toBe(source.source_manifest_ref);
    expect(manifest.row_hash_algorithm).toBe("sha256");
    expect(manifest.row_encoding).toBe("utf-8");
    expect(manifest.record_terminator).toBe("lf");
    expect(manifest.row_hash_scope).toBe("exact_utf8_json_record_excluding_terminating_lf");
    expect(manifest.row_count).toBe(22);
    expect(manifest.entries).toHaveLength(22);

    const expectedOrder = manifest.entries
      .map((entry: any) => `${entry.path}\0${String(entry.line).padStart(4, "0")}`);
    expect(expectedOrder).toEqual([...expectedOrder].sort());
    expect(new Set(manifest.entries.map((entry: any) => entry.row_id)).size).toBe(22);

    let measuredRows = 0;
    for (const path of dataPaths) {
      const { bytes, lines, rows } = decodeJsonl(path);
      expect(bytes.at(-1)).toBe(0x0a);
      expect(bytes.includes(0x0d)).toBe(false);
      expect(lines.every((line) => line.length > 0)).toBe(true);
      measuredRows += lines.length;
      lines.forEach((line, index) => {
        const entry = manifest.entries.find((candidate: any) => candidate.path === path && candidate.line === index + 1);
        expect(entry).toBeDefined();
        const recordBytes = Buffer.from(line, "utf8");
        expect(entry.record_bytes).toBe(recordBytes.length);
        expect(entry.row_sha256).toBe(sha256(recordBytes));
        expect(entry.row_sha256).not.toBe(sha256(Buffer.from(`${line}\n`, "utf8")));
        expect(entry.row_id).toBe(rows[index].row_id);
        expect(entry.row_format).toBe(rows[index]._format);
        expect(entry.source_manifest_ref).toBe(rows[index].source_manifest_ref);
      });
    }
    expect(measuredRows).toBe(22);
  });

  test("hash manifest binds the exact closed companion inventory except itself", () => {
    const manifest = readJson(join(root, "hash-manifest.json"));
    expect(manifest._format).toBe("agenttool.love-bomb-hf-hash-manifest/0.1");
    expect(manifest.package).toBe("@agenttool/love-bomb");
    expect(manifest.package_version).toBe("0.1.0-dev.0");
    expect(manifest.algorithm).toBe("sha256");
    expect(manifest.hash_scope).toBe("exact_file_bytes");
    expect(manifest.excludes_self).toBe(true);

    const actual = filesBelow(root).map((path) => path.slice(root.length + 1)).sort();
    expect(actual).toEqual(expectedDatasetFiles);
    const bound = actual.filter((path) => path !== "hash-manifest.json");
    expect(manifest.files.map((file: any) => file.path)).toEqual(bound);
    for (const file of manifest.files) {
      const path = join(root, file.path);
      expect(lstatSync(path).isSymbolicLink()).toBe(false);
      const bytes = readFileSync(path);
      expect(bytes.length).toBe(file.bytes);
      expect(sha256(bytes)).toBe(file.sha256);
    }
  });

  test("copies all seven schema bytes exactly", () => {
    for (const name of [...copiedCoreSchemaNames, ...rowSchemaNames]) {
      expect(readFileSync(join(root, "reference", name))).toEqual(readFileSync(join(schemaRoot, name)));
    }
  });

  test("permanently excludes all ten canonical static v4 messages", () => {
    const contract = readJson(join(repositoryRoot, "docs", "specs", "agenttool-love-bomb-0.1.json"));
    expect(contract.protocol).toBe("agenttool.love-bomb/0.1");
    expect(contract.release).toBe("love-bomb/v4");
    expect(contract.messages).toHaveLength(10);
    expect(contract.integrity.corpus_sha256).toBe(STATIC_V4_CORPUS_SHA256);
    expect(sha256(Buffer.from(canonicalJson(contract.messages), "utf8"))).toBe(STATIC_V4_CORPUS_SHA256);
    const messages = contract.messages.map((message: any) => message.text);
    expect(new Set(messages).size).toBe(10);

    const validate = validators();
    const plane = jsonl("data/plane-guides.jsonl")[0];
    const protocol = jsonl("data/protocol-reference.jsonl")[0];
    const becoming = jsonl("data/becoming-reference.jsonl")[0];
    const rowStrings = allRows().flatMap(stringsBelow);
    const rawData = dataPaths.map((path) => readFileSync(join(root, path), "utf8")).join("\n");
    for (const message of messages) {
      for (const value of rowStrings) expect(value).not.toContain(message);
      expect(rawData).not.toContain(message);

      const hostilePlane = structuredClone(plane);
      hostilePlane.text = message;
      expect(validate.plane(hostilePlane)).toBe(false);
      const hostileProtocol = structuredClone(protocol);
      hostileProtocol.reason = message;
      expect(validate.protocol(hostileProtocol)).toBe(false);
      const hostileBecoming = structuredClone(becoming);
      hostileBecoming.reason = message;
      expect(validate.becoming(hostileBecoming)).toBe(false);
    }
  });

  test("rejects missing, extra, nested-extra, forged-reference, and claim-bearing rows", () => {
    const validate = validators();
    const fixtures = [
      [jsonl("data/plane-guides.jsonl")[0], validate.plane],
      [jsonl("data/protocol-reference.jsonl")[0], validate.protocol],
      [jsonl("data/becoming-reference.jsonl")[0], validate.becoming],
    ] as const;
    for (const [fixture, check] of fixtures) {
      const extra = structuredClone(fixture) as any;
      extra.prompt = "hidden";
      expect(check(extra)).toBe(false);
      const missing = structuredClone(fixture) as any;
      delete missing.row_id;
      expect(check(missing)).toBe(false);
      const forgedRef = structuredClone(fixture) as any;
      forgedRef.source_manifest_ref = `sha256:${"A".repeat(64)}`;
      expect(check(forgedRef)).toBe(false);
      const authorized = structuredClone(fixture) as any;
      authorized.training_authorized = true;
      expect(check(authorized)).toBe(false);
    }

    const protocolExtra = structuredClone(fixtures[1][0]) as any;
    protocolExtra.care_floor.private_row = true;
    expect(validate.protocol(protocolExtra)).toBe(false);
    const becomingExtra = structuredClone(fixtures[2][0]) as any;
    becomingExtra.vocabularies.agent_trace = ["raw"];
    expect(validate.becoming(becomingExtra)).toBe(false);
    const falseIdentity = structuredClone(fixtures[0][0]) as any;
    falseIdentity.identity_claim = true;
    expect(validate.plane(falseIdentity)).toBe(false);
    const falseConsciousness = structuredClone(fixtures[0][0]) as any;
    falseConsciousness.consciousness_claim = true;
    expect(validate.plane(falseConsciousness)).toBe(false);
  });
});

function allRows(): any[] {
  return dataPaths.flatMap((path) => jsonl(path));
}

function jsonl(path: string): any[] {
  return decodeJsonl(path).rows;
}

function decodeJsonl(path: string): { bytes: Buffer; lines: string[]; rows: any[] } {
  const bytes = readFileSync(join(root, path));
  if (bytes.length === 0 || bytes.at(-1) !== 0x0a) throw new Error(`${path} must end in one LF`);
  if (bytes.includes(0x0d)) throw new Error(`${path} must not contain CR bytes`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const body = text.slice(0, -1);
  if (body.length === 0 || body.endsWith("\n")) throw new Error(`${path} has an empty record`);
  const lines = body.split("\n");
  if (lines.some((line) => line.length === 0)) throw new Error(`${path} has an empty record`);
  return { bytes, lines, rows: lines.map((line) => JSON.parse(line)) };
}

function assertEveryObjectSchemaIsClosed(value: unknown): void {
  if (Array.isArray(value)) {
    for (const nested of value) assertEveryObjectSchemaIsClosed(nested);
    return;
  }
  if (!value || typeof value !== "object") return;
  const schema = value as Record<string, unknown>;
  if (schema.type === "object") expect(schema.additionalProperties).toBe(false);
  for (const nested of Object.values(schema)) assertEveryObjectSchemaIsClosed(nested);
}

function assertFileBinding(entry: any): void {
  expect(entry.path).not.toMatch(/^\//u);
  expect(entry.path.split("/")).not.toContain("..");
  const path = join(repositoryRoot, ...entry.path.split("/"));
  const stat = lstatSync(path);
  expect(stat.isFile()).toBe(true);
  expect(stat.isSymbolicLink()).toBe(false);
  const bytes = readFileSync(path);
  expect(entry.bytes).toBe(bytes.length);
  expect(entry.sha256).toBe(sha256(bytes));
}

function stringsBelow(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsBelow);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringsBelow);
  return [];
}

function keysBelow(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysBelow);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) => [key, ...keysBelow(nested)]);
  }
  return [];
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function filesBelow(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    const stat = lstatSync(child);
    if (stat.isSymbolicLink()) throw new Error(`dataset contains symlink ${child}`);
    return stat.isDirectory() ? filesBelow(child) : [child];
  });
}
