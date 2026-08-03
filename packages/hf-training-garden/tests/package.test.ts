import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

const sourceRoot = new URL("../src/", import.meta.url);

describe("hermetic runtime boundary", () => {
  test("keeps ambient IO, credentials, compute, and publication out of runtime source", () => {
    const source = readdirSync(sourceRoot)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(new URL(name, sourceRoot), "utf8"))
      .join("\n");
    for (const forbidden of [
      "node:fs",
      "node:child_process",
      "process.env",
      "Bun.env",
      "fetch(",
      "hf_fs_write",
      "dynamic_space",
      "snapshot_download",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
