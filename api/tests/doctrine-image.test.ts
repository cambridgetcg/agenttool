import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(API_ROOT, "..");
const MANIFEST_PATH = join(API_ROOT, "doctrine-docs.manifest");
const STAGE_SCRIPT = join(REPO_ROOT, "bin", "stage-doctrine-docs.sh");
const INTEGRITY_MODULE = join(
  API_ROOT,
  "src",
  "services",
  "doctrine",
  "integrity.ts",
);

function manifestFiles(): string[] {
  return readFileSync(MANIFEST_PATH, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

function typescriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...typescriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

describe("production doctrine image", () => {
  test("manifest exactly covers every literal doctrineHash source", () => {
    const manifest = manifestFiles();
    expect(new Set(manifest).size).toBe(manifest.length);

    const referenced = new Set<string>();
    for (const path of typescriptFiles(join(API_ROOT, "src"))) {
      if (path === INTEGRITY_MODULE) continue;
      const source = readFileSync(path, "utf8");
      const uses = source.match(/\bdoctrineHash\(/g) ?? [];
      const literalCalls = [
        ...source.matchAll(
          /\bdoctrineHash\(\s*["']docs\/([^"']+\.(?:md|jsonld))["']\s*,?\s*\)/g,
        ),
      ];
      expect(literalCalls.length).toBe(uses.length);
      for (const match of literalCalls) referenced.add(match[1]!);
    }

    expect([...referenced].sort()).toEqual([...manifest].sort());
    for (const filename of manifest) {
      expect(
        readFileSync(join(REPO_ROOT, "docs", filename), "utf8").length,
      ).toBeGreaterThan(0);
    }
  });

  test("stages exact source bytes and doctrineHash returns their real hashes", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "agenttool-doctrine-"));
    const staged = join(tempRoot, "docs");
    const manifest = manifestFiles();

    try {
      const stage = spawnSync("bash", [STAGE_SCRIPT, staged], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
      expect(stage.status).toBe(0);
      expect(readdirSync(staged).sort()).toEqual([...manifest].sort());

      for (const filename of manifest) {
        expect(readFileSync(join(staged, filename))).toEqual(
          readFileSync(join(REPO_ROOT, "docs", filename)),
        );
      }

      const probeSource = `
        import { doctrineHash } from ${JSON.stringify(INTEGRITY_MODULE)};
        const names = ${JSON.stringify(manifest)};
        const hashes = Object.fromEntries(
          names.map((name) => [name, doctrineHash(\`docs/\${name}\`)]),
        );
        const unavailable = doctrineHash("docs/NOT-STAGED.md");
        console.log(JSON.stringify({ hashes, unavailable }));
      `;
      const probe = spawnSync(process.execPath, ["-e", probeSource], {
        cwd: API_ROOT,
        env: { ...process.env, AGENTTOOL_DOCS_DIR: staged },
        encoding: "utf8",
      });
      expect(probe.status).toBe(0);

      const result = JSON.parse(probe.stdout) as {
        hashes: Record<string, string>;
        unavailable: string | null;
      };
      for (const filename of manifest) {
        const expected = createHash("sha256")
          .update(readFileSync(join(REPO_ROOT, "docs", filename)))
          .digest("hex");
        expect(result.hashes[filename]).toBe(expected);
      }
      expect(result.unavailable).toBeNull();
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("Docker runtime points doctrineHash at the staged directory", () => {
    const dockerfile = readFileSync(join(API_ROOT, "Dockerfile"), "utf8");
    const deploy = readFileSync(join(REPO_ROOT, "bin", "deploy.sh"), "utf8");

    expect(dockerfile).toContain("AGENTTOOL_DOCS_DIR=/app/docs");
    expect(dockerfile).toContain("COPY doctrine-docs.bundled/ /app/docs/");
    expect(deploy).toContain('bash bin/stage-doctrine-docs.sh "$DOCTRINE_STAGE_DIR"');
  });
});
