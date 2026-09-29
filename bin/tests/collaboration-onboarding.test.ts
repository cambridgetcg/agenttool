/** Public onboarding is committed static content, not a hosted mission or host activation. */
import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { cloudflareHeaderRulePaths, matchesCloudflarePathPattern } from "./cloudflare-headers";

const root = resolve(import.meta.dir, "../..");
const read = (name: string) => readFileSync(join(root, name), "utf8");
const guides = ["COLLABORATION.md", "COLLABORATION-ROADMAP.md", "COLLABORATION-MISSIONS.md", "COLLABORATION-MISSION-CLIENT.md", "LOCAL-CORE.md", "API-COVERAGE.md"];
const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("collaboration public onboarding", () => {
  test("canonical guide mirrors and phase boundaries remain explicit", () => {
    for (const name of guides) expect(realpathSync(join(root, "apps/docs", name))).toBe(join(root, "docs", name));
    const guide = read("docs/COLLABORATION.md");
    expect(guide).toContain("**Published 0.4.0**");
    expect(guide).toContain("**Source candidate 0.5.0**");
    expect(guide).toContain("**Private source candidate 0.1.0-dev.0**");
    expect(guide).toContain("Bun 1.3 or newer");
    expect(guide).toContain("AGENTOOL_COLLAB_DB");
    expect(guide).toContain("AGENTOOL_COLLAB_SESSION_FILE");
    expect(guide).not.toContain("github.com/cambridgetcg/agenttool/");
    const roadmap = read("docs/COLLABORATION-ROADMAP.md");
    for (const phase of ["0 · Usable onboarding", "1 · Scoped mission participants", "2 · Transport and native lifecycle", "3 · Cross-device task authority", "4 · Cross-project membership and federation"]) expect(roadmap).toContain(phase);
    expect(roadmap).toContain("Principality references never mint");
    expect(roadmap).toContain("registered identities already owned by that project");
  });

  test("Markdown headers stay within the Pages rule budget without duplicate N-guide rules", () => {
    const headers = read("apps/docs/_headers");
    const rules = cloudflareHeaderRulePaths(headers);
    expect(rules.length).toBeLessThanOrEqual(100);
    expect(rules).toContain("/COLLABORATION*.md");
    for (const name of ["COLLABORATION.md", "COLLABORATION-ROADMAP.md", "COLLABORATION-MISSIONS.md", "COLLABORATION-MISSION-CLIENT.md"]) {
      expect(matchesCloudflarePathPattern("/COLLABORATION*.md", `/${name}`)).toBe(true);
      expect(read("apps/docs/sitemap.xml")).toContain(`https://docs.agenttool.dev/${name}`);
    }
    const policy = headers.split("/COLLABORATION*.md\n")[1]!.split("\n\n")[0]!;
    expect(policy).toContain("Content-Type: text/markdown; charset=utf-8");
    expect(policy).toContain("no-transform");
    expect(policy).toContain("X-Content-Type-Options: nosniff");
    for (const name of ["NOW.md", "NPM-RELEASES.md", "NATURES.md", "NEN.md"]) {
      expect(rules.filter(rule => rule !== "/*" && matchesCloudflarePathPattern(rule, `/${name}`))).toEqual(["/N*.md"]);
    }
  });

  test("the real committed frontend stager includes canonical guide bytes and the legacy URL alias", () => {
    const temporaryRoot = realpathSync(mkdtempSync(join(tmpdir(), "collaboration-stage-")));
    temporary.push(temporaryRoot);
    const fixture = join(temporaryRoot, "repo"), stage = join(temporaryRoot, "stage");
    for (const dir of ["bin", "docs", "apps/docs", "apps/web", "apps/dashboard"]) mkdirSync(join(fixture, dir), { recursive: true });
    mkdirSync(stage);
    for (const app of ["web", "dashboard"]) writeFileSync(join(fixture, "apps", app, "index.html"), "<p>Fixture</p>\n");
    for (const name of guides) {
      copyFileSync(join(root, "docs", name), join(fixture, "docs", name));
      symlinkSync(`../../docs/${name}`, join(fixture, "apps/docs", name));
    }
    copyFileSync(join(root, "apps/docs/_redirects"), join(fixture, "apps/docs/_redirects"));
    copyFileSync(join(root, "bin/stage-frontend-release.sh"), join(fixture, "bin/stage-frontend-release.sh"));
    const sourceRoots = read("bin/frontend-release-paths.txt").split(/\r?\n/);
    for (const name of ["apps/docs", "docs"]) expect(sourceRoots).toContain(name);
    writeFileSync(join(fixture, "bin/frontend-release-paths.txt"), "apps/docs\napps/web\napps/dashboard\ndocs\n");
    const run = (command: string, args: string[]) => {
      const result = spawnSync(command, args, { cwd: fixture, encoding: "utf8", env: {
        PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      } });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    run("git", ["init", "-q"]);
    run("git", ["add", "."]);
    run("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-qm", "Fixture source"]);
    const commit = run("git", ["rev-parse", "HEAD"]);
    writeFileSync(join(fixture, "docs/COLLABORATION.md"), "Uncommitted replacement must not ship.\n");
    run("bash", ["bin/stage-frontend-release.sh", commit, stage]);
    for (const name of guides) expect(readFileSync(join(stage, "apps/docs", name), "utf8")).toBe(read(`docs/${name}`));
    expect(readFileSync(join(stage, "apps/docs/_redirects"), "utf8")).toMatch(/^\/COLLABORATION-CHANNELS\.md\s+\/COLLABORATION\.md\s+301$/m);
  });
});
