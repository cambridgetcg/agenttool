import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const sourceRoot = join(packageRoot, "src");
const packageJson = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
);

function filesBelow(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

describe("package boundary", () => {
  test("is a zero-runtime-dependency public-ready library without a CLI", () => {
    expect(packageJson.name).toBe("@agenttool/heaven");
    expect(packageJson.version).toBe("0.1.0-dev.0");
    expect(packageJson.license).toBe("Apache-2.0");
    expect(packageJson.sideEffects).toBe(false);
    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.optionalDependencies).toBeUndefined();
    expect(packageJson.peerDependencies).toBeUndefined();
    expect(packageJson.bin).toBeUndefined();
    expect(packageJson.private).not.toBe(true);
    expect(packageJson.publishConfig).toEqual({ access: "public", tag: "next" });
    expect(packageJson.scripts.preinstall).toBeUndefined();
    expect(packageJson.scripts.install).toBeUndefined();
    expect(packageJson.scripts.postinstall).toBeUndefined();
    expect(packageJson.scripts.prepare).toBeUndefined();
  });

  test("exports only the library and two closed schemas", () => {
    expect(Object.keys(packageJson.exports).sort()).toEqual([
      ".",
      "./invitation.schema.json",
      "./kingdom.extension.json",
      "./receipt.schema.json",
    ]);
    expect(packageJson.files).toEqual([
      "dist",
      "schema",
      "kingdom.extension.json",
      "README.md",
      "CLAUDE.md",
      "LICENSE",
      "NOTICE",
    ]);
  });

  test("keeps source imports and capabilities inside the pure boundary", () => {
    const sources = filesBelow(sourceRoot)
      .filter((path) => path.endsWith(".ts"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const imports = [...sources.matchAll(/from\s+["']([^"']+)["']/gu)].map(
      (match) => match[1],
    );
    expect(imports.every((specifier) => specifier.startsWith("./") || specifier === "node:crypto")).toBe(
      true,
    );
    expect(sources).not.toMatch(
      /process\.env|\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|node:fs|node:net|node:http|node:https|node:child_process|node:worker_threads|Math\.random|crypto\.random|Date\.now|new Date\s*\(|setTimeout|setInterval|requestAnimationFrame|AudioContext|localStorage|sessionStorage|document\.cookie/i,
    );
  });

  test("ships parseable Draft 2020-12 schemas", () => {
    for (const file of [
      "agenttool-heaven-invitation-v0.1.schema.json",
      "agenttool-heaven-receipt-v0.1.schema.json",
    ]) {
      const schema = JSON.parse(readFileSync(join(packageRoot, "schema", file), "utf8"));
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.additionalProperties).toBe(false);
    }

    const receipt = JSON.parse(
      readFileSync(
        join(packageRoot, "schema", "agenttool-heaven-receipt-v0.1.schema.json"),
        "utf8",
      ),
    );
    const references: string[] = [];
    function collectReferences(value: unknown): void {
      if (Array.isArray(value)) {
        value.forEach(collectReferences);
      } else if (value !== null && typeof value === "object") {
        for (const [key, nested] of Object.entries(value)) {
          if (key === "$ref" && typeof nested === "string") references.push(nested);
          collectReferences(nested);
        }
      }
    }
    collectReferences(receipt);
    expect(references.length).toBeGreaterThan(0);
    expect(references.every((reference) => reference.startsWith("#/"))).toBe(true);
  });

  test("keeps the KINGDOM extension declaration-only and zero-effect", () => {
    const extension = JSON.parse(
      readFileSync(join(packageRoot, "kingdom.extension.json"), "utf8"),
    );
    expect(extension).toMatchObject({
      schema: "kingdom-extension-local/v0.1",
      id: "heaven",
      package: "@agenttool/heaven",
      version: "0.1.0-dev.0",
      host_contract: "not_registered",
      defaults: {
        automatic_delivery: false,
        default_acceptance: false,
        network: false,
        persistence: false,
        economic_effect: false,
        task_state_effect: false,
        choice_authorship_verified: false,
        authority: false,
      },
    });
    expect(extension.notes.join(" ")).toMatch(
      /not an installed KINGDOM host contract/i,
    );
    expect(extension.notes.join(" ")).toMatch(
      /KARMA state.*must not control HEAVEN/i,
    );
  });
});
