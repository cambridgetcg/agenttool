import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import {
  TOOL_NAME,
  TOOL_VERSION,
} from "../src/index.js";

const ROOT = join(import.meta.dir, "..");

describe("public developer-preview package boundary", () => {
  test("keeps package identity, exports, and release metadata aligned", async () => {
    const packageJson = JSON.parse(
      await readFile(join(ROOT, "package.json"), "utf8"),
    ) as {
      name: string;
      version: string;
      private?: boolean;
      license?: string;
      sideEffects?: boolean;
      dependencies?: Record<string, string>;
      publishConfig?: { access?: string; tag?: string };
      exports?: Record<string, unknown>;
      files?: string[];
      scripts?: Record<string, string>;
    };
    expect(packageJson).toMatchObject({
      name: TOOL_NAME,
      version: TOOL_VERSION,
      license: "Apache-2.0",
      sideEffects: false,
      publishConfig: { access: "public", tag: "next" },
    });
    expect(packageJson.private).toBeUndefined();
    expect(packageJson.dependencies).toBeUndefined();
    expect(Object.hasOwn(packageJson.exports ?? {}, "./facilities")).toBe(true);
    expect(Object.hasOwn(packageJson.exports ?? {}, "./report.schema.json")).toBe(true);
    expect(Object.hasOwn(packageJson.exports ?? {}, "./search.schema.json")).toBe(true);
    expect(Object.hasOwn(packageJson.exports ?? {}, "./sidecar.schema.json")).toBe(true);
    expect(Object.hasOwn(packageJson.exports ?? {}, "./reconciliation.schema.json")).toBe(true);
    for (const name of [
      "./report-v0.1.schema.json",
      "./report-v0.2.schema.json",
      "./search-v0.1.schema.json",
      "./search-v0.2.schema.json",
      "./sidecar-v0.1.schema.json",
      "./sidecar-v0.2.schema.json",
      "./release-reconciliation-v0.2.schema.json",
    ]) expect(Object.hasOwn(packageJson.exports ?? {}, name)).toBe(true);
    expect(Object.hasOwn(packageJson.exports ?? {}, "./research-catalog.schema.json")).toBe(true);
    expect(Object.hasOwn(packageJson.exports ?? {}, "./research-binding.schema.json")).toBe(true);
    expect(Object.hasOwn(packageJson.exports ?? {}, "./kingdom.extension.json")).toBe(true);
    expect(packageJson.files).not.toContain("tests");
    expect(packageJson.files).not.toContain("node_modules");
    expect(packageJson.files).toContain("LICENSE");
    expect(packageJson.files).toContain("NOTICE");
    expect(packageJson.scripts?.prepack).toBe("bun run ci");
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
      status: "developer_preview",
      capabilities: [
        "huggingface:public-metadata-read",
        "huggingface:exact-revision-read",
        "huggingface:provenance-project",
        "huggingface:release-reconcile",
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
        "This public developer-preview package descriptor is not an installed KINGDOM host contract.",
        "The default network remains off until an explicit inspect, search, or reconcile command.",
        "MCP OAuth is not inherited by this npm package.",
      ],
    });
    expect(await readFile(join(ROOT, "LICENSE"), "utf8")).toContain("Apache License");
    expect(await readFile(join(ROOT, "NOTICE"), "utf8")).toContain("AgentTool HF Scout");
    expect(await readFile(join(ROOT, "src", "cli.ts"), "utf8"))
      .toStartWith("#!/usr/bin/env node\n");
  });
});
