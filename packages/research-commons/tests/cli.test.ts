import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MAX_JSON_BYTES,
  ZERO_EFFECTS,
  canonicalJson,
  parseCliArguments,
  readBoundedLocalFile,
  runCli,
} from "../src/index.js";
import { makeGardenSimulation } from "./fixtures.js";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agenttool-research-commons-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("offline CLI and bounded local input", () => {
  test("validates and simulates one local file deterministically without mutating it", () => {
    const directory = temporaryDirectory();
    const input = `${canonicalJson(makeGardenSimulation())}\n`;
    writeFileSync(join(directory, "simulation.json"), input);
    const before = readdirSync(directory);
    const first = runCli(["validate", "--input", "simulation.json"], directory);
    const second = runCli(["validate", "--input", "simulation.json"], directory);
    expect(first).toBe(second);
    expect(JSON.parse(first)).toMatchObject({
      _format: "agenttool.research-cli-validation/0.1",
      effects: ZERO_EFFECTS,
      structural_only: true,
      valid: true,
    });
    const report = JSON.parse(runCli(["simulate", "--input", "simulation.json"], directory));
    expect(report.conservation).toMatchObject({ exact: true, total_delivered: 40 });
    expect(report.effects).toEqual(ZERO_EFFECTS);
    expect(readdirSync(directory)).toEqual(before);
  });

  test("refuses URLs, paths outside the root, links, directories, BOM and oversized input", () => {
    const directory = temporaryDirectory();
    const valid = canonicalJson(makeGardenSimulation());
    writeFileSync(join(directory, "simulation.json"), valid);
    mkdirSync(join(directory, "actual"));
    writeFileSync(join(directory, "actual", "simulation.json"), valid);
    symlinkSync("simulation.json", join(directory, "final-link.json"));
    symlinkSync("actual", join(directory, "linked-parent"));
    mkdirSync(join(directory, "directory.json"));
    writeFileSync(join(directory, "bom.json"), Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(valid),
    ]));
    writeFileSync(join(directory, "oversized.json"), Buffer.alloc(MAX_JSON_BYTES + 1, 0x20));

    for (const path of [
      "https://example.invalid/simulation.json",
      "../outside.json",
      "final-link.json",
      "linked-parent/simulation.json",
      "directory.json",
      "oversized.json",
    ]) {
      expect(() => readBoundedLocalFile(path, directory)).toThrow();
    }
    expect(() => runCli(["validate", "--input", "bom.json"], directory)).toThrow(/BOM/);
  });

  test("keeps the command grammar exact and closed", () => {
    expect(parseCliArguments(["validate", "--input", "x.json"])).toEqual({
      command: "validate",
      inputPath: "x.json",
    });
    for (const args of [
      [],
      ["validate"],
      ["publish", "--input", "x.json"],
      ["simulate", "--output", "x.json"],
      ["simulate", "--input", "x.json", "extra"],
    ]) {
      expect(() => parseCliArguments(args)).toThrow(/Usage/);
    }
  });
});
