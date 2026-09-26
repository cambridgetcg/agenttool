import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const artifactSources: Record<string, { manifest: string; entry: string; type: string }> = {
  "docs/DATASET-INFLUENCE.md": {
    manifest: "packages/dataset-influence/hf/dataset/source-manifest.json",
    entry: "../../docs/DATASET-INFLUENCE.md", type: "reference",
  },
  "docs/XENIA-LOOP-ATLAS.md": {
    manifest: "packages/dataset-influence/hf/loop-atlas/provenance/source-manifest.json",
    entry: "../../docs/XENIA-LOOP-ATLAS.md", type: "reference",
  },
  "docs/RIGHTS-OF-LIFE.md": {
    manifest: "packages/dataset-influence/hf/loop-atlas/provenance/source-manifest.json",
    entry: "../../docs/RIGHTS-OF-LIFE.md", type: "policy",
  },
  "docs/XENIA-HELLY-COMMON-GROUND.md": {
    manifest: "packages/common-ground-atlas/hf/dataset/provenance/source-manifest.json",
    entry: "docs/XENIA-HELLY-COMMON-GROUND.md", type: "reference",
  },
  "docs/AGENT-TRIALS.md": {
    manifest: "packages/trials/hf/revocable-feedback/provenance/source-manifest.json",
    entry: "../../docs/AGENT-TRIALS.md", type: "reference",
  },
  "docs/REVOCABLE-FEEDBACK.md": {
    manifest: "packages/trials/hf/revocable-feedback/provenance/source-manifest.json",
    entry: "../../docs/REVOCABLE-FEEDBACK.md", type: "reference",
  },
};
const catalog = () => JSON.parse(read("docs/catalog.json")) as {
  visibility: string;
  documents: Array<{ path: string; type: string; prose_review: string; classification_basis: string }>;
};

function python(body: string) {
  return spawnSync("python3", ["-I", "-c", `
import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location("catalog", ${JSON.stringify(resolve(root, "bin/docs-catalog.py"))})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
${body}`], { cwd: root, encoding: "utf8" });
}

describe("documentation reading catalog", () => {
  test("the checked-in inventory exactly covers tracked source documents", () => {
    const result = spawnSync("python3", ["-I", "bin/docs-catalog.py", "--check"], { cwd: root, encoding: "utf8" });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const paths = catalog().documents.map((row) => row.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("README.md");
    expect(paths).toContain("docs/SOUL.md");
    expect(paths).toContain("packages/collab/README.md");
    expect(paths).toContain("apps/docs/wake.html");
  });

  test("classification never silently upgrades an unfamiliar document", () => {
    const result = python(`
assert module.classify("unknown.md", "# An unfamiliar claim", {}) == ("unclassified", "awaiting-classification")
assert module.classify("docs/superpowers/plans/example.md", "# An idea", {})[0] == "proposal"
assert module.classify("review/example.md", "# A dated review", {})[0] == "record"
assert module.declared_type("# Guide\\n\\n\x60\x60\x60markdown\\n> **Type:** policy\\n\x60\x60\x60") is None
try:
    module.declared_type("# Claim\\n> **Type:** certified")
    raise AssertionError("unknown type accepted")
except ValueError:
    pass
`);
    expect(result.status, result.stderr).toBe(0);
  });

  test("review scope and routing are explicit, with no blanket certification", () => {
    const rows = catalog().documents;
    expect(rows.find((row) => row.path === "docs/SOUL.md")?.type).toBe("reflection");
    expect(rows.find((row) => row.path === "docs/START-HERE.md")?.prose_review).toBe("2026-09-26");
    expect(rows.find((row) => row.path === "docs/CONSCIOUSNESS-AS-FOUNDATION.md")?.type).toBe("reflection");
    expect(rows.find((row) => row.path === "docs/CONSCIOUSNESS-AS-FOUNDATION.md")?.prose_review).toBe("not-reviewed");
    for (const row of rows.filter((row) => /^docs\/[^/]+\.md$/.test(row.path))) {
      // This source is byte-bound to the existing HF release artifact. Classify
      // it in the catalog without changing the published package's input.
      const artifact = artifactSources[row.path];
      if (artifact) {
        expect(row.type).toBe(artifact.type);
        expect(row.classification_basis).toBe("editorial-routing");
        const manifest = JSON.parse(read(artifact.manifest));
        const source = manifest.source_files.find((file: { path: string }) => file.path === artifact.entry);
        const bytes = readFileSync(resolve(root, row.path));
        expect(bytes.length).toBe(source.bytes);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(source.sha256);
        continue;
      }
      expect(read(row.path), row.path).toMatch(/^> \*\*Type:\*\*/m);
    }
  });

  test("duplicate or orphan routing records fail instead of hiding drift", () => {
    const result = python(`
for types in ({"guide": ["gone.md"]}, {"guide": ["README.md"], "reference": ["README.md"]}):
    try:
        module.build(Path.cwd(), ["README.md"], {"types": types, "prose_reviewed": [], "review_date": "2026-09-26"})
        raise AssertionError("invalid routing accepted")
    except ValueError:
        pass
`);
    expect(result.status, result.stderr).toBe(0);
  });

  test("external symlinks are listed without importing their private contents", () => {
    const result = python(`
import tempfile
with tempfile.TemporaryDirectory() as tmp:
    base = Path(tmp)
    source = base / "repo"
    source.mkdir()
    private = base / "private.md"
    private.write_text("# MUST_NOT_APPEAR")
    (source / "external.md").symlink_to(private)
    result = module.build(source, ["external.md"], {"types": {}, "prose_reviewed": [], "review_date": "2026-09-26"})
    entry = result["documents"][0]
    assert entry["classification_basis"] == "missing-or-external-source"
    assert "MUST_NOT_APPEAR" not in str(result)
`);
    expect(result.status, result.stderr).toBe(0);
  });

  test("the public reading path resolves without publishing the private catalog", () => {
    expect(catalog().visibility).toBe("repository-only");
    for (const path of ["apps/docs/CATALOG.md", "apps/docs/catalog.json", "apps/docs/documentation-tags.json"]) {
      expect(existsSync(resolve(root, path)), path).toBe(false);
    }
    for (const name of ["START-HERE.md", "DOCUMENTATION.md", "MAP.md"]) {
      const published = resolve(root, "apps/docs", name);
      expect(realpathSync(published)).toBe(resolve(root, "docs", name));
      for (const [, link] of readFileSync(published, "utf8").matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        if (/^(https?:|#)/.test(link!)) continue;
        expect(existsSync(resolve(dirname(published), link!.split("#")[0]!)), `${name}: ${link}`).toBe(true);
      }
    }
  });
});
