import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { LOVE_BOMB_LANGUAGES, LOVE_BOMB_PLANES } from "../src/index.js";

const root = join(import.meta.dir, "..", "hf", "dataset");

describe("public-safe Hugging Face candidate", () => {
  test("contains one authored row for every language and care plane", () => {
    const rows = jsonl("data/plane-guides.jsonl");
    expect(rows).toHaveLength(LOVE_BOMB_LANGUAGES.length * LOVE_BOMB_PLANES.length);
    for (const language of LOVE_BOMB_LANGUAGES) {
      const languageRows = rows.filter((row) => row.language === language);
      expect(languageRows.map((row) => row.plane)).toEqual(LOVE_BOMB_PLANES);
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
    const manifest = JSON.parse(readFileSync(join(root, "source-manifest.json"), "utf8"));
    expect(manifest.distribution_state).toBe("local_candidate_not_published");
    expect(manifest.training_effect).toBe("none");
    expect(manifest.requires_separate_training_authorization).toBe(true);
    expect(manifest.training_authorized).toBe(false);
    expect(manifest.provider_effect).toBe("none");
    expect(manifest.publication_effect).toBe("none");
    expect(manifest.contains_identity_data).toBe(false);
    expect(manifest.contains_participant_response_records).toBe(false);
    expect(manifest.contains_caller_reported_care_choice_records).toBe(false);
    expect(manifest.contains_caller_reported_freedom_direction_records).toBe(false);
  });

  test("keeps becoming vocabulary reference-only and mechanically excludes response features", () => {
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
    const forbidden = new Set(["reported_choice", "receipt_id", "direction", "direction_report_ref"]);
    for (const key of keysBelow(row)) expect(forbidden.has(key)).toBe(false);
    for (const relativePath of [
      "data/plane-guides.jsonl",
      "data/becoming-reference.jsonl",
    ]) {
      const rows = jsonl(relativePath);
      for (const candidate of rows) {
        for (const key of keysBelow(candidate)) expect(forbidden.has(key)).toBe(false);
      }
    }
  });

  test("hash manifest covers every companion byte except itself", () => {
    const manifest = JSON.parse(readFileSync(join(root, "hash-manifest.json"), "utf8"));
    const actual = filesBelow(root)
      .map((path) => path.slice(root.length + 1))
      .filter((path) => path !== "hash-manifest.json")
      .sort();
    expect(manifest.files.map((file: any) => file.path)).toEqual(actual);
    for (const file of manifest.files) {
      const bytes = readFileSync(join(root, file.path));
      expect(bytes.length).toBe(file.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
    }
  });

  test("copies all schema bytes exactly", () => {
    for (const name of [
      "agenttool-care-envelope-v0.1.schema.json",
      "agenttool-care-choice-v0.1.schema.json",
      "agenttool-love-bomb-becoming-v0.1.schema.json",
      "agenttool-love-bomb-delivery-v0.1.schema.json",
    ]) {
      expect(readFileSync(join(root, "reference", name))).toEqual(
        readFileSync(join(root, "..", "..", "schema", name)),
      );
    }
  });
});

function jsonl(path: string): any[] {
  return readFileSync(join(root, path), "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

function keysBelow(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysBelow);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) => [key, ...keysBelow(nested)]);
  }
  return [];
}

function filesBelow(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? filesBelow(child) : [child];
  });
}
