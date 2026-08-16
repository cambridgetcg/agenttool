import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

const packageRoot = join(import.meta.dir, "..");

describe("package capability boundary", () => {
  test("runtime imports are local or exact reviewed cryptographic primitives", async () => {
    const sourceDirectory = join(packageRoot, "src");
    const names = (await readdir(sourceDirectory)).filter((name) => name.endsWith(".ts"));
    const allowedExternal = new Set([
      "@noble/ed25519",
      "@noble/hashes/sha2.js",
      "node:util/types",
    ]);
    const allowedSpecifier = (specifier: string): boolean =>
      allowedExternal.has(specifier)
      || (specifier.startsWith("./") && !specifier.includes("..") && specifier.endsWith(".js"));

    for (const name of names) {
      const source = await readFile(join(sourceDirectory, name), "utf8");
      for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/gu)) {
        const specifier = match[1]!;
        expect(
          allowedSpecifier(specifier),
          `${name} imports unreviewed runtime capability ${specifier}`,
        ).toBe(true);
      }
      for (const match of source.matchAll(/\bimport\s+["']([^"']+)["']/gu)) {
        const specifier = match[1]!;
        expect(
          allowedSpecifier(specifier),
          `${name} side-effect imports unreviewed runtime capability ${specifier}`,
        ).toBe(true);
      }
      for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu)) {
        const specifier = match[1]!;
        expect(
          allowedSpecifier(specifier),
          `${name} dynamically imports unreviewed runtime capability ${specifier}`,
        ).toBe(true);
      }
      expect(source, `${name} must not use runtime dynamic import`).not.toMatch(/\bimport\s*\(/u);
      expect(source, `${name} must not use CommonJS require`).not.toMatch(/\brequire\s*\(/u);
      expect(source, `${name} must not use eval or the Function constructor`).not.toMatch(
        /(?:\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\()/u,
      );
      for (const match of source.matchAll(/\bglobalThis\.([A-Za-z_$][A-Za-z0-9_$]*)/gu)) {
        expect(["atob", "btoa"], `${name} uses ambient globalThis.${match[1]}`).toContain(match[1]);
      }
    }
  });

  test("runtime contains no ambient effect or identity-inference seam", async () => {
    const sourceDirectory = join(packageRoot, "src");
    const names = (await readdir(sourceDirectory)).filter((name) => name.endsWith(".ts"));
    const source = (
      await Promise.all(names.map((name) => readFile(join(sourceDirectory, name), "utf8")))
    ).join("\n");

    for (const forbidden of [
      /\bfetch\s*\(/u,
      /\bWebSocket\b/u,
      /\bXMLHttpRequest\b/u,
      /\bprocess\.env\b/u,
      /\bprocess\b/u,
      /\bBun\./u,
      /node:(?:fs|dns|net|http|https|tls|child_process|worker_threads)/u,
      /\b(?:randomBytes|randomUUID|getRandomValues)\s*\(/u,
      /\bMath\.random\s*\(/u,
      /\bDate\.now\s*\(/u,
      /\bnew\s+Date\s*\(\s*\)/u,
      /\bperformance\.now\s*\(/u,
      /\b(?:setTimeout|setInterval|queueMicrotask)\s*\(/u,
      /\b(?:localStorage|sessionStorage|indexedDB|sendBeacon)\b/u,
      /\b(?:navigator|Deno)\b/u,
      /\b(?:globalThis\.)?document\s*(?:\.|\[)/u,
      /@agenttool\/(?:telescope|sdk|data|hf-training-garden)/u,
      /\b(?:ip_address|user_agent|tls_fingerprint|cookie|embedding|behavior_score)\b/u,
      /\b(?:lookupByOrigin|findByOrigin|listBindingsByOrigin|reverseOriginIndex)\b/u,
    ]) {
      expect(source, `runtime matched forbidden capability ${forbidden}`).not.toMatch(forbidden);
    }
  });

  test("package remains private, unlicensed, side-effect-free, and without lifecycle scripts", async () => {
    const packageJson = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(packageJson.private).toBe(true);
    expect(packageJson.license).toBe("UNLICENSED");
    expect(packageJson.sideEffects).toBe(false);
    expect(packageJson.dependencies).toEqual({
      "@noble/ed25519": "2.3.0",
      "@noble/hashes": "2.0.1",
    });
    expect(packageJson.files).toEqual([
      "dist",
      "schema",
      "vectors",
      "kingdom.extension.json",
      "README.md",
      "CLAUDE.md",
    ]);
    expect(packageJson.bin).toBeUndefined();
    expect(packageJson.browser).toBeUndefined();
    const scripts = packageJson.scripts as Record<string, string>;
    for (const hook of ["preinstall", "install", "postinstall", "prepublish", "publish", "postpublish"]) {
      expect(scripts[hook]).toBeUndefined();
    }
  });

  test("KINGDOM descriptor is declaration-only and every capability defaults false", async () => {
    const descriptor = JSON.parse(
      await readFile(join(packageRoot, "kingdom.extension.json"), "utf8"),
    ) as {
      host_contract: string;
      defaults: Record<string, unknown>;
    };
    expect(descriptor.host_contract).toBe("not_registered");
    expect(Object.keys(descriptor.defaults).length).toBeGreaterThan(0);
    expect(Object.values(descriptor.defaults).every((value) => value === false)).toBe(true);
  });
});
