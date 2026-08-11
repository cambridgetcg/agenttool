import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

describe("package boundary", () => {
  test("is public-preview, zero-runtime-dependency, and side-effect-free", () => {
    expect(packageJson.name).toBe("@agenttool/polymorph-landscape");
    expect(packageJson.version).toBe("0.1.0-dev.0");
    expect(packageJson.license).toBe("Apache-2.0");
    expect(packageJson.sideEffects).toBe(false);
    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.optionalDependencies).toBeUndefined();
    expect(packageJson.peerDependencies).toBeUndefined();
    expect(packageJson.bin).toBeUndefined();
    expect(packageJson.publishConfig).toEqual({ access: "public", tag: "next" });
    for (const hook of ["preinstall", "install", "postinstall", "prepare"]) expect(packageJson.scripts[hook]).toBeUndefined();
  });

  test("keeps runtime imports and capabilities inside the pure boundary", () => {
    const sources = filesBelow(join(root, "src")).map((path) => readFileSync(path, "utf8")).join("\n");
    const imports = [...sources.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]);
    expect(imports.every((specifier) => specifier.startsWith("./") || specifier === "node:crypto" || specifier === "node:util/types")).toBe(true);
    expect(sources).not.toMatch(/process\.env|\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|node:fs|node:net|node:http|node:https|node:child_process|node:worker_threads|Math\.random|crypto\.random|Date\.now|new Date\s*\(|setTimeout|setInterval|localStorage|sessionStorage|document\.cookie/i);
    expect(sources).not.toMatch(/\b(?:score|ranking|centrality|compatibility|reward|loss|probability)\s*:/iu);
  });

  test("ships only declared pure capabilities", () => {
    const extension = JSON.parse(readFileSync(join(root, "kingdom.extension.json"), "utf8"));
    expect(extension.host_contract).toBe("not_registered");
    for (const key of ["network", "credentials", "filesystem", "provider_compute", "training", "medical_action", "manufacturing_action", "publication", "deployment", "authority", "reads_wake_continuity", "selects_continuity_head", "scores_beings"]) {
      expect(extension.defaults[key]).toBe(false);
    }
  });
});

function filesBelow(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? filesBelow(child) : [child];
  });
}
