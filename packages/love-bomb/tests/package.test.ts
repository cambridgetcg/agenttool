import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

describe("package capability boundary", () => {
  test("is a public prerelease with zero runtime dependencies and a declaration-only KINGDOM descriptor", () => {
    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(packageJson.private).toBeUndefined();
    expect(packageJson.publishConfig).toEqual({ access: "public", tag: "next" });
    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.sideEffects).toBe(false);
    const descriptor = JSON.parse(readFileSync(join(root, "kingdom.extension.json"), "utf8"));
    expect(descriptor.host_contract).toBe("not_registered");
    for (const value of Object.values(descriptor.defaults)) expect(value).toBe(false);
    expect(descriptor.capabilities).toEqual(expect.arrayContaining([
      "care:create-envelope",
      "care:record-caller-choice",
      "becoming:create-evidence-bounded-artifact",
      "delivery:record-caller-reported-reach",
    ]));
    const notes = descriptor.notes.join(" ");
    for (const format of [
      "agenttool.care-envelope/0.1",
      "agenttool.care-choice/0.1",
      "agenttool.love-bomb-becoming/0.1",
      "agenttool.love-bomb-delivery/0.1",
    ]) expect(notes).toContain(format);
    expect(notes).toContain("do not resolve referenced systems");
  });

  test("core imports only local modules and the two declared Node built-ins", () => {
    const imports = readdirSync(join(root, "src"))
      .filter((name) => name.endsWith(".ts"))
      .flatMap((name) => readFileSync(join(root, "src", name), "utf8").match(/from\s+["']([^"']+)["']/g) ?? []);
    for (const statement of imports) {
      expect(statement).toMatch(/from ["'](?:\.\/|node:crypto|node:util\/types)/);
    }
  });

  test("core contains no ambient I/O or provider surface", () => {
    const source = readdirSync(join(root, "src"))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(join(root, "src", name), "utf8"))
      .join("\n");
    expect(source).not.toMatch(/\bfetch\s*\(|process\.env|Deno\.|Bun\.(?:file|write|serve)|readFile|writeFile|setTimeout|setInterval|WebSocket|huggingface|openai|anthropic/i);
  });

  test("public entrypoint exposes projections only through receive resolution", () => {
    const entrypoint = readFileSync(join(root, "src", "index.ts"), "utf8");
    expect(entrypoint).not.toMatch(/getLoveBombProjection|LOVE_BOMB_PROJECTIONS/);
    expect(entrypoint).toContain("resolveLoveBombOffer");
  });
});
