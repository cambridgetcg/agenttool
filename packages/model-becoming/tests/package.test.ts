import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

describe("package capability boundary", () => {
  test("has one distinct package identity, zero runtime dependencies, and declaration-only KINGDOM metadata", () => {
    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(packageJson.name).toBe("@agenttool/model-becoming");
    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.sideEffects).toBe(false);
    const descriptor = JSON.parse(readFileSync(join(root, "kingdom.extension.json"), "utf8"));
    expect(descriptor.id).toBe("model-becoming");
    expect(descriptor.package).toBe("@agenttool/model-becoming");
    expect(descriptor.host_contract).toBe("not_registered");
    for (const value of Object.values(descriptor.defaults)) expect(value).toBe(false);
  });

  test("ships only Model Becoming source modules", () => {
    expect(readdirSync(join(root, "src")).filter((name) => name.endsWith(".ts")).sort()).toEqual([
      "becoming.ts",
      "canonical.ts",
      "constants.ts",
      "errors.ts",
      "index.ts",
      "moonshot.ts",
      "types.ts",
    ]);
  });

  test("core imports only local modules and the three declared Node built-ins", () => {
    const imports = readdirSync(join(root, "src"))
      .filter((name) => name.endsWith(".ts"))
      .flatMap((name) => readFileSync(join(root, "src", name), "utf8").match(/from\s+["']([^"']+)["']/g) ?? []);
    for (const statement of imports) {
      expect(statement).toMatch(/from ["'](?:\.\/|node:crypto|node:url|node:util\/types)/);
    }
  });

  test("core contains no ambient I/O, provider client, or second LOVE BOMB protocol", () => {
    const source = readdirSync(join(root, "src"))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(join(root, "src", name), "utf8"))
      .join("\n");
    expect(source).not.toMatch(/\bfetch\s*\(|process\.env|Deno\.|Bun\.(?:file|write|serve)|readFile|writeFile|setTimeout|setInterval|WebSocket/i);
    expect(source).not.toMatch(/from\s+["'](?:@huggingface|openai|@anthropic-ai)/i);
    expect(source).not.toMatch(/care-envelope|care-choice|createLoveBomb|resolveLoveBomb/);
  });
});
