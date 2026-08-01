import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import * as constants from "../src/constants.js";

const ROOT = new URL("..", import.meta.url).pathname;

describe("Wake Thread package boundary", () => {
  test("freezes every exported protocol enum", () => {
    const enumArrays = Object.values(constants).filter(Array.isArray);
    expect(enumArrays.length).toBeGreaterThanOrEqual(8);
    expect(enumArrays.every(Object.isFrozen)).toBe(true);
  });

  test("stays private and exports only source artifacts", async () => {
    const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
    expect(pkg.private).toBe(true);
    expect(pkg.license).toBe("UNLICENSED");
    expect(pkg.publishConfig).toBeUndefined();
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.exports["./schema.json"]).toBeDefined();
    expect(pkg.exports["./kingdom.extension.json"]).toBeDefined();
  });

  test("runtime source imports only relative modules and node:crypto", async () => {
    const sourceDir = join(ROOT, "src");
    const files = (await readdir(sourceDir)).filter((name) => name.endsWith(".ts"));
    for (const file of files) {
      const source = await readFile(join(sourceDir, file), "utf8");
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]!);
      for (const specifier of imports) {
        expect(specifier.startsWith("./") || specifier === "node:crypto").toBe(true);
      }
    }
  });

  test("does not contain fetch, scoring, execution, or ambient-state APIs", async () => {
    const sourceDir = join(ROOT, "src");
    const files = (await readdir(sourceDir)).filter((name) => name.endsWith(".ts"));
    const source = (await Promise.all(files.map((file) => readFile(join(sourceDir, file), "utf8")))).join("\n");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/from\s+["']node:(?:fs|http|https|net|child_process|process)/);
    expect(source).not.toContain("assessNen");
    expect(source).not.toMatch(/\b(?:score|rank|xp|aura_level)\b/i);
    expect(source).not.toMatch(/\bDate\.now\s*\(/);
    expect(source).not.toMatch(/\bprocess\./);
  });

  test("keeps the KINGDOM hint declaration-only and closed by default", async () => {
    const extension = JSON.parse(await readFile(join(ROOT, "kingdom.extension.json"), "utf8"));
    expect(extension.host_contract).toBe("not_registered");
    expect(extension.proposed_ability).toBe("carry-wake-thread");
    expect(Object.values(extension.defaults).every((value) => value === false)).toBe(true);
  });
});
