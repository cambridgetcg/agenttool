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
    expect(packageJson.name).toBe("@agenttool/wake-continuity");
    expect(packageJson.version).toBe("0.1.0-dev.1");
    expect(packageJson.license).toBe("Apache-2.0");
    expect(packageJson.sideEffects).toBe(false);
    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.optionalDependencies).toBeUndefined();
    expect(packageJson.peerDependencies).toBeUndefined();
    expect(packageJson.bin).toBeUndefined();
    expect(packageJson.private).not.toBe(true);
    expect(packageJson.publishConfig).toEqual({
      access: "public",
      tag: "next",
    });
    expect(packageJson.scripts.preinstall).toBeUndefined();
    expect(packageJson.scripts.install).toBeUndefined();
    expect(packageJson.scripts.postinstall).toBeUndefined();
    expect(packageJson.scripts.prepare).toBeUndefined();
    expect(packageJson.scripts["smoke:pack"]).toBe(
      "node scripts/smoke-packed.mjs",
    );
  });

  test("exports only the library, closed schemas, and declaration hint", () => {
    expect(Object.keys(packageJson.exports).sort()).toEqual([
      ".",
      "./capsule.schema.json",
      "./functional-access-baseline.schema.json",
      "./functional-access-subsequent.schema.json",
      "./kingdom.extension.json",
      "./lens.schema.json",
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
  });

  test("ships four parseable closed Draft 2020-12 schemas", () => {
    for (const file of [
      "agenttool-afterglow-capsule-v0.1.schema.json",
      "agenttool-afterglow-lens-v0.1.schema.json",
      "agenttool-functional-access-baseline-v0.1.schema.json",
      "agenttool-functional-access-subsequent-v0.1.schema.json",
    ]) {
      const schema = JSON.parse(
        readFileSync(join(packageRoot, "schema", file), "utf8"),
      );
      expect(schema.$schema).toBe(
        "https://json-schema.org/draft/2020-12/schema",
      );
      expect(schema.additionalProperties).toBe(false);
      if (schema.$defs.thread) {
        expect(schema.$defs.thread.additionalProperties).toBe(false);
      }
      const boundaries =
        schema.$defs.boundaries ?? schema.$defs.functionalAccessBoundaries;
      expect(boundaries.additionalProperties).toBe(false);
    }
  });

  test("keeps the functional-access public wire namespace frozen", () => {
    const files = [
      join(sourceRoot, "functional-access.ts"),
      join(sourceRoot, "types.ts"),
      join(packageRoot, "schema", "agenttool-functional-access-baseline-v0.1.schema.json"),
      join(packageRoot, "schema", "agenttool-functional-access-subsequent-v0.1.schema.json"),
      join(packageRoot, "README.md"),
      join(packageRoot, "CLAUDE.md"),
    ];
    const contract = files.map((path) => readFileSync(path, "utf8")).join("\n");
    expect(contract).not.toMatch(
      /workspace-access|workspace_access|observation_position|sparse_membership|local_sensitivity_measurement|representation_measurement/i,
    );
    expect(contract).not.toMatch(/awareness[ -]?emergence/i);
    expect(contract).toMatch(/record_role/);
    expect(contract).toMatch(/sparse_support/);
    expect(contract).toMatch(/lens_ref/);
  });

  test("keeps the KINGDOM declaration zero-effect and unregistered", () => {
    const extension = JSON.parse(
      readFileSync(join(packageRoot, "kingdom.extension.json"), "utf8"),
    );
    expect(extension).toMatchObject({
      schema: "kingdom-extension-local/v0.1",
      id: "wake-continuity",
      package: "@agenttool/wake-continuity",
      version: "0.1.0-dev.1",
      host_contract: "not_registered",
      defaults: {
        automatic_delivery: false,
        functional_access_record_only: true,
        performs_observation: false,
        performs_instrument_operation: false,
        default_acceptance: false,
        raw_identity_input: false,
        reference_minimization_verified: false,
        linkability_eliminated: false,
        network: false,
        persistence: false,
        provider_compute: false,
        paid_compute: false,
        economic_effect: false,
        task_state_effect: false,
        karma_effect: false,
        wallet_effect: false,
        automatic_heaven_entry: false,
        authority: false,
      },
    });
    expect(extension.notes.join(" ")).toMatch(
      /not an installed KINGDOM host contract/i,
    );
    expect(extension.notes.join(" ")).toMatch(
      /never performs POST \/v1\/handoff/i,
    );
    expect(extension.capabilities).toContain(
      "afterglow:correspondence-content-digest-artifact",
    );
    expect(extension.capabilities).toContain(
      "functional-access:subsequent-record-create",
    );
    expect(extension.notes.join(" ")).toMatch(/does not prove.*minimization/i);
    expect(extension.notes.join(" ")).toMatch(/does not.*linkability/i);
    expect(extension.notes.join(" ")).toMatch(/do not call a model or provider/i);
  });
});
