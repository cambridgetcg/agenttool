import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

describe("package boundary", () => {
  test("has zero runtime dependencies and no lifecycle or remote action script", () => {
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.optionalDependencies).toBeUndefined();
    expect(manifest.peerDependencies).toBeUndefined();
    expect(manifest.sideEffects).toBe(false);
    expect(Object.keys(manifest.scripts)).not.toContain("postinstall");
    expect(Object.keys(manifest.scripts)).not.toContain("prepare");
    expect(Object.keys(manifest.scripts)).not.toContain("publish");
    expect(manifest.publishConfig).toEqual({ access: "public", tag: "next" });
  });

  test("imports only the Node crypto primitive at runtime", () => {
    const source = readdirSync(join(root, "src"))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(join(root, "src", name), "utf8"))
      .join("\n");
    const builtins = [...source.matchAll(/from\s+["'](node:[^"']+)["']/gu)].map(
      (match) => match[1],
    );
    expect([...new Set(builtins)]).toEqual(["node:crypto"]);
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(/process\.env/u);
    expect(source).not.toMatch(/child_process/u);
  });

  test("keeps the KINGDOM descriptor closed by default", () => {
    const extension = JSON.parse(
      readFileSync(join(root, "kingdom.extension.json"), "utf8"),
    );
    expect(extension.host_contract).toBe("not_registered");
    for (const key of [
      "network",
      "filesystem",
      "credentials",
      "downloads",
      "model_execution",
      "remote_compute",
      "graph_writes",
      "registry_writes",
      "scores",
      "authority",
      "license_approval",
    ]) {
      expect(extension.defaults[key]).toBe(false);
    }
  });
});
