import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

describe("package boundary", () => {
  test("is public-preview, zero-runtime-dependency, and side-effect-free", () => {
    expect(packageJson.name).toBe("@agenttool/memetic-landscape");
    expect(packageJson.version).toBe("0.1.0-dev.0");
    expect(packageJson.license).toBe("Apache-2.0");
    expect(packageJson.sideEffects).toBe(false);
    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.optionalDependencies).toBeUndefined();
    expect(packageJson.peerDependencies).toBeUndefined();
    expect(packageJson.bin).toBeUndefined();
    expect(packageJson.publishConfig).toEqual({ access: "public", tag: "next" });
    for (const hook of ["preinstall", "install", "postinstall", "prepare"]) {
      expect(packageJson.scripts[hook]).toBeUndefined();
    }
  });

  test("keeps runtime imports and effects inside the pure boundary", () => {
    const sources = filesBelow(join(root, "src"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const imports = [...sources.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]);
    expect(imports.every((specifier) => (
      specifier.startsWith("./")
      || specifier === "node:crypto"
      || specifier === "node:util/types"
    ))).toBe(true);
    expect(sources).not.toMatch(/process\.env|\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|node:fs|node:net|node:http|node:https|node:child_process|node:worker_threads|Math\.random|crypto\.random|Date\.now|new Date\s*\(|setTimeout|setInterval|localStorage|sessionStorage|document\.cookie/i);
  });

  test("ships only declaration-only, non-effectful KINGDOM capabilities", () => {
    const extension = JSON.parse(readFileSync(join(root, "kingdom.extension.json"), "utf8"));
    expect(extension.host_contract).toBe("not_registered");
    expect(extension.capabilities).toEqual([
      "memetic:compile-landscape",
      "memetic:compile-reachability-shift",
      "memetic:compile-polymorph-analogy",
      "memetic:project-authored-lesson",
    ]);
    for (const key of [
      "network",
      "credentials",
      "filesystem",
      "provider_compute",
      "artifact_download",
      "artifact_execution",
      "persistence",
      "model_inference",
      "training",
      "diagnosis",
      "moderation",
      "spread_optimization",
      "publication",
      "deployment",
      "authority",
      "task_state_effect",
      "automatic_retry",
      "automatic_carry",
      "penalty_for_refusal_or_rest",
      "reads_wake_continuity",
      "selects_continuity_head",
      "scores_beings",
      "proves_science",
      "proves_identity",
      "proves_consciousness",
      "proves_consent",
      "proves_dignity",
    ]) {
      expect(extension.defaults[key], key).toBe(false);
    }
  });

  test("declares every schema and built-in example through package exports", () => {
    expect(Object.keys(packageJson.exports).sort()).toEqual([
      ".",
      "./analogy.schema.json",
      "./examples/brainrot.json",
      "./landscape.schema.json",
      "./lesson.schema.json",
      "./reachability-shift.schema.json",
    ].sort());
  });
});

function filesBelow(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? filesBelow(child) : [child];
  });
}
