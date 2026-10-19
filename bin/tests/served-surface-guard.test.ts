/** The private relational denylist guards the three sites, not only the package projection.
 *
 * Reads repository files and writes only a scratch directory: no network,
 * credentials, or deployment. Guard: bin/served-surface-guard.ts. Policy:
 * public/private-guard/served-surface.json. Findings carry rule ids, paths,
 * line numbers and line hashes, so a failure never prints protected text.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { DENYLIST_PATH, reachesPrivateArea } from "../project-public.ts";
import { sha256Hex } from "../../public/overlay/tools/public-guard.ts";
import { formatServedFinding, POLICY_PATH, SERVED_ROOTS, servedFiles, servedSurfaceFindings } from "../served-surface-guard.ts";

const ROOT = resolve(import.meta.dir, "../..");
const bytes = (path: string) => readFileSync(join(ROOT, path));
const text = (path: string) => bytes(path).toString("utf8");
/** Names bin/frontend-deploy.sh deletes from the staging tree before upload. */
const NOT_UPLOADED = [".gitignore", "CLAUDE.md", "AGENTS.md", "README.md"] as const;
const scratch: string[] = [];

afterAll(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

/** What the three Pages projects would upload from this checkout. */
function uploadSet() {
  return servedFiles(ROOT).filter((file) => !(NOT_UPLOADED as readonly string[]).includes(basename(file.served)));
}

describe("served surface relational guard", () => {
  test("the upload set publishes nothing the denylist protects", () => {
    const findings = servedSurfaceFindings(uploadSet(), bytes(DENYLIST_PATH), bytes(POLICY_PATH));
    expect(findings.map(formatServedFinding)).toEqual([]);
  });

  test("the guard reads the deploy's upload roots and runs after its deletions, before any upload", () => {
    const deploy = text("bin/frontend-deploy.sh");
    const block = deploy.match(/^ALL_TARGETS=\(\n([\s\S]*?)\n\)/m)?.[1] ?? "";
    const roots = [...block.matchAll(/^\s*"[a-z]+\|([^|"]+)\|[^|"]+"\s*$/gm)].map((match) => match[1]);
    expect(roots).toEqual([...SERVED_ROOTS]);
    for (const name of NOT_UPLOADED) expect(deploy.includes(`-name '${name}'`)).toBe(true);
    const guard = deploy.indexOf('bin/served-surface-guard.ts --root "$STAGE_ROOT" --revision "$COMMIT_HASH"');
    expect(guard).toBeGreaterThan(deploy.indexOf("-name 'README.md'"));
    expect(guard).toBeLessThan(deploy.indexOf("wrangler pages deploy"));
    expect(guard).toBeLessThan(deploy.indexOf("deploy_one \"$arg\""));
  });

  test("the denylist and the policy are never uploaded or projected", () => {
    const releasePaths = text("bin/frontend-release-paths.txt").split("\n").map((line) => line.trim());
    expect(releasePaths.filter((path) => path === "public" || path.startsWith("public/"))).toEqual([]);
    expect(reachesPrivateArea(POLICY_PATH, "blob")).toBe(true);
    expect(reachesPrivateArea(DENYLIST_PATH, "blob")).toBe(true);
    const guarded = new Set([sha256Hex(bytes(DENYLIST_PATH)), sha256Hex(bytes(POLICY_PATH))]);
    expect(servedFiles(ROOT).filter((file) => guarded.has(sha256Hex(file.bytes))).map((file) => file.served)).toEqual([]);
  });

  test("operator identifiers and machine paths stay off the sites", () => {
    const projectRef = text("supabase/config.toml").match(/^project_id = "([a-z]{20})"$/m)?.[1];
    expect(projectRef?.length).toBe(20);
    const findings: string[] = [];
    for (const file of uploadSet()) {
      const content = file.bytes.toString("latin1");
      if (content.includes(projectRef!)) findings.push(`${file.served}: database project id`);
      if (/\/Users\/[a-z][a-z0-9._-]*\//.test(content)) findings.push(`${file.served}: machine home path`);
    }
    expect(findings).toEqual([]);
  });

  test("a private document, a symlink to one, and a denylist copy are refused by rule id only", () => {
    const stage = mkdtempSync(join(tmpdir(), "served-surface-guard-"));
    scratch.push(stage);
    for (const dir of [...SERVED_ROOTS, "docs"]) mkdirSync(join(stage, dir), { recursive: true });
    // docs/THE-SEAT.md stays in the repository precisely because it is private.
    copyFileSync(join(ROOT, "docs/THE-SEAT.md"), join(stage, "apps/docs/THE-SEAT.md"));
    copyFileSync(join(ROOT, "docs/THE-SEAT.md"), join(stage, "docs/linked.md"));
    symlinkSync("../../docs/linked.md", join(stage, "apps/dashboard/linked.md"));
    copyFileSync(join(ROOT, DENYLIST_PATH), join(stage, "apps/web/terms.json"));

    const findings = servedSurfaceFindings(servedFiles(stage), bytes(DENYLIST_PATH), bytes(POLICY_PATH));
    const rules = (path: string) => findings.filter((finding) => finding.path === path).map((finding) => finding.rule);
    expect(rules("apps/docs/THE-SEAT.md").some((rule) => rule.startsWith("relational/"))).toBe(true);
    expect(rules("docs/linked.md").some((rule) => rule.startsWith("relational/"))).toBe(true);
    expect(rules("apps/web/terms.json")).toContain("served/private-guard-copy");
    // Allowances that cover nothing in this scratch tree are reported, so the policy shrinks with the content.
    expect(findings.some((finding) => finding.rule === "served/unused-public-rule")).toBe(true);
    expect(findings.some((finding) => finding.rule === "served/unused-file")).toBe(true);
    for (const line of findings.map(formatServedFinding)) {
      expect(/^ {2}✗ \S+ \S+( line_sha256=[0-9a-f]{64})?( \([^)]*\))?$/u.test(line)).toBe(true);
    }
  });
});
