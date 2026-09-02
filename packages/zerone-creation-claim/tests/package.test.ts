import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

describe("private source-only package boundary", () => {
  test("has no runtime dependency, executable, publication, or lifecycle surface", () => {
    expect(packageJson).toMatchObject({
      name: "@agenttool/zerone-creation-claim",
      version: "0.1.0-dev.0",
      private: true,
      license: "UNLICENSED",
      sideEffects: false,
    });
    for (const key of ["dependencies", "optionalDependencies", "peerDependencies", "publishConfig", "bin"]) {
      expect(packageJson[key]).toBeUndefined();
    }
    for (const hook of ["preinstall", "install", "postinstall", "prepack", "publish", "postpublish"]) {
      expect(packageJson.scripts[hook]).toBeUndefined();
    }
  });

  test("runtime source has no ambient I/O, signer, RPC, clock, randomness, or process hooks", () => {
    const source = readdirSync(join(root, "src"))
      .filter((name) => name.endsWith(".ts"))
      .sort()
      .map((name) => readFileSync(join(root, "src", name), "utf8"))
      .join("\n");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]!);
    for (const specifier of imports) {
      expect(specifier.startsWith("./") || specifier === "node:crypto" || specifier === "node:util/types")
        .toBe(true);
    }
    expect(source).not.toMatch(
      /process\.env|\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|node:fs|node:net|node:http|node:https|node:child_process|node:worker_threads|Math\.random|crypto\.random|Date\.now|new Date\s*\(|setTimeout|setInterval|localStorage|sessionStorage|document\.cookie/iu,
    );
  });

  test("passes the independent source and npm pack dry-run inventory check", () => {
    expect(() => execFileSync("node", ["scripts/check-package-inventory.mjs"], { cwd: root }))
      .not.toThrow();
  });
});
