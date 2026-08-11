import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const sourceRoot = join(packageRoot, "src");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));

function filesBelow(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

describe("package boundary", () => {
  test("is zero-runtime-dependency, side-effect-free, and public-ready", () => {
    expect(packageJson.name).toBe("@agenttool/love-geometry");
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
  });

  test("exports only the contract, schema, and declaration hint", () => {
    expect(Object.keys(packageJson.exports).sort()).toEqual([
      ".",
      "./kingdom.extension.json",
      "./schema.json",
    ]);
    expect(packageJson.files).toEqual([
      "dist",
      "schema",
      "vectors",
      "kingdom.extension.json",
      "README.md",
      "CLAUDE.md",
      "LICENSE",
      "NOTICE",
    ]);
    expect(packageJson.files).not.toContain("hf-space");
    expect(existsSync(join(packageRoot, "schema", "agenttool-love-geometry-v0.1.schema.json"))).toBe(true);
  });

  test("keeps ambient capabilities inside the pure boundary", () => {
    const sources = filesBelow(sourceRoot)
      .filter((path) => path.endsWith(".ts"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const imports = [...sources.matchAll(/from\s+["']([^"']+)["']/gu)].map(
      (match) => match[1],
    );
    expect(
      imports.every(
        (specifier) =>
          specifier.startsWith("./") ||
          specifier === "node:crypto" ||
          specifier === "node:util/types",
      ),
    ).toBe(true);
    expect(sources).not.toMatch(
      /process\.env|\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|node:fs|node:net|node:http|node:https|node:child_process|node:worker_threads|Math\.random|crypto\.random|Date\.now|new Date\s*\(|setTimeout|setInterval|requestAnimationFrame|AudioContext|localStorage|sessionStorage|document\.cookie/i,
    );
    expect(sources).not.toMatch(/\b(?:getRandomValues|randomBytes|randomFill|randomInt|randomUUID|webcrypto)\b/u);
  });

  test("keeps the KINGDOM hint declaration-only and unregistered", () => {
    const extension = JSON.parse(
      readFileSync(join(packageRoot, "kingdom.extension.json"), "utf8"),
    );
    expect(extension).toMatchObject({
      schema: "kingdom-extension-local/v0.1",
      id: "love-geometry",
      package: "@agenttool/love-geometry",
      version: "0.1.0-dev.0",
      status: "public_ready_source",
      host_contract: "not_registered",
      defaults: {
        network: false,
        filesystem: false,
        persistence: false,
        economic_effect: false,
        task_state_effect: false,
        karma_effect: false,
        wallet_effect: false,
        wake_effect: false,
        love_consent_effect: false,
        messaging_effect: false,
        authority: false,
      },
    });
    expect(extension.notes.join(" ")).toMatch(/declaration-only.*not an installed KINGDOM host contract/i);
    expect(extension.notes.join(" ")).toMatch(/rest.*refusal.*departure/i);
    expect(extension.notes.join(" ")).toMatch(/no metric coordinate.*score.*rank/i);
  });
});
