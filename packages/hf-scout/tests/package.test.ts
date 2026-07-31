import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import {
  TOOL_NAME,
  TOOL_VERSION,
} from "../src/index.js";

const ROOT = join(import.meta.dir, "..");

describe("private package boundary", () => {
  test("keeps package identity, exports, and private status aligned", async () => {
    const packageJson = JSON.parse(
      await readFile(join(ROOT, "package.json"), "utf8"),
    ) as {
      name: string;
      version: string;
      private?: boolean;
      license?: string;
      dependencies?: Record<string, string>;
      publishConfig?: unknown;
      exports?: Record<string, unknown>;
      files?: string[];
    };
    expect(packageJson).toMatchObject({
      name: TOOL_NAME,
      version: TOOL_VERSION,
      private: true,
      license: "UNLICENSED",
    });
    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.publishConfig).toBeUndefined();
    expect(Object.hasOwn(packageJson.exports ?? {}, "./facilities")).toBe(true);
    expect(Object.hasOwn(packageJson.exports ?? {}, "./report.schema.json")).toBe(true);
    expect(Object.hasOwn(packageJson.exports ?? {}, "./search.schema.json")).toBe(true);
    expect(Object.hasOwn(packageJson.exports ?? {}, "./sidecar.schema.json")).toBe(true);
    expect(Object.hasOwn(packageJson.exports ?? {}, "./research-catalog.schema.json")).toBe(true);
    expect(Object.hasOwn(packageJson.exports ?? {}, "./research-binding.schema.json")).toBe(true);
    expect(Object.hasOwn(packageJson.exports ?? {}, "./kingdom.extension.json")).toBe(true);
    expect(packageJson.files).not.toContain("tests");
    expect(packageJson.files).not.toContain("node_modules");
  });

  test("keeps runtime source free of ambient credentials and write/compute SDK calls", async () => {
    const sourceFiles = (await readdir(join(ROOT, "src")))
      .filter((name) => name.endsWith(".ts"));
    const source = (
      await Promise.all(sourceFiles.map((name) => readFile(join(ROOT, "src", name), "utf8")))
    ).join("\n");
    expect(source).not.toMatch(/process\.env|authorization|bearer|hf_token|hf_fs_write/u);
    expect(source).not.toMatch(/InferenceClient|snapshotDownload|uploadFile|createRepo|runJob/u);
  });

  test("ships an honest local descriptor and executable shebang", async () => {
    const extension = JSON.parse(
      await readFile(join(ROOT, "kingdom.extension.json"), "utf8"),
    ) as unknown;
    expect(extension).toEqual({
      schema: "kingdom-extension-local/v0.1",
      id: "hf-scout",
      package: TOOL_NAME,
      version: TOOL_VERSION,
      status: "private_local_prototype",
      capabilities: [
        "huggingface:public-metadata-read",
        "huggingface:provenance-project",
        "huggingface:research-lead-curation",
        "love:model-lock-project",
      ],
      defaults: {
        credentials: "none",
        network: "off_until_explicit_command",
        filesystem: "off_until_explicit_lock_path",
        network_write: false,
        remote_compute: false,
        model_execution: false,
      },
      host_contract: "not_registered",
      notes: [
        "This manifest is a local prototype descriptor, not an installed KINGDOM host contract.",
        "MCP OAuth is not inherited by this npm package.",
      ],
    });
    expect(await readFile(join(ROOT, "src", "cli.ts"), "utf8"))
      .toStartWith("#!/usr/bin/env node\n");
  });
});
