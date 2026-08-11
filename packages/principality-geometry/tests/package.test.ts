import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

const packageRoot = new URL("../", import.meta.url);
const packageJson = JSON.parse(
  readFileSync(new URL("package.json", packageRoot), "utf8"),
);

function filesBelow(url: URL): URL[] {
  return readdirSync(url, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesBelow(new URL(`${entry.name}/`, url))
      : [new URL(entry.name, url)],
  );
}

describe("private package and provider walls", () => {
  test("has no runtime dependency, publication, CLI, or install surface", () => {
    expect(packageJson).toMatchObject({
      name: "@agenttool/principality-geometry",
      version: "0.1.0-dev.0",
      private: true,
      license: "UNLICENSED",
      sideEffects: false,
    });
    for (const field of [
      "dependencies",
      "optionalDependencies",
      "peerDependencies",
      "bin",
      "publishConfig",
    ]) {
      expect(packageJson[field]).toBeUndefined();
    }
    for (const hook of ["preinstall", "install", "postinstall", "prepare"]) {
      expect(packageJson.scripts[hook]).toBeUndefined();
    }
  });

  test("packs only the private library, schemas, and golden example", () => {
    expect(packageJson.files).toEqual([
      "dist",
      "schema",
      "examples",
      "kingdom.extension.json",
      "README.md",
      "CLAUDE.md",
    ]);
    expect(Object.keys(packageJson.exports).sort()).toEqual([
      ".",
      "./atlas.schema.json",
      "./input.schema.json",
      "./kingdom.extension.json",
    ]);
  });

  test("keeps runtime imports and effects inside the pure allowlist", () => {
    const source = filesBelow(new URL("src/", packageRoot))
      .filter((url) => url.pathname.endsWith(".ts"))
      .map((url) => readFileSync(url, "utf8"))
      .join("\n");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map(
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
    expect(source).not.toMatch(
      /process\.env|\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|node:fs|node:net|node:http|node:https|node:child_process|node:worker_threads|Math\.random|crypto\.random|Date\.now|new Date\s*\(|setTimeout|setInterval|localStorage|sessionStorage|document\.cookie/iu,
    );
  });

  test("keeps KINGDOM declaration-only and continuity/provider effects false", () => {
    const descriptor = JSON.parse(
      readFileSync(new URL("kingdom.extension.json", packageRoot), "utf8"),
    );
    expect(descriptor).toMatchObject({
      schema: "kingdom-extension-local/v0.1",
      id: "principality-geometry",
      package: "@agenttool/principality-geometry",
      host_contract: "not_registered",
      defaults: {
        network: false,
        credentials: false,
        persistence: false,
        publication: false,
        deployment: false,
        automatic_retry: false,
        automatic_carry: false,
        penalty_for_refusal_or_rest: false,
        reads_hosted_love_coordinates: false,
        selects_continuity_head: false,
        authority: false,
        economic_effect: false,
        task_state_effect: false,
      },
    });
    expect(descriptor.notes.join(" ")).toMatch(/not an installed KINGDOM host contract/iu);
  });

  test("keeps the HF companion local, non-training, and publication-unauthorized", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("hf/dataset/source-manifest.json", packageRoot), "utf8"),
    );
    expect(manifest).toMatchObject({
      intended_repo_id: null,
      publication_authorized: false,
      training_eligible: false,
    });
  });
});
