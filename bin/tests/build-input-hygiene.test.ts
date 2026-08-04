import { afterAll, describe, expect, test } from "bun:test";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(import.meta.dir, "../..");
const cleanup: string[] = [];

async function run(
  command: string[],
  cwd = repoRoot,
  env?: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(command, {
    cwd,
    ...(env ? { env } : {}),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

afterAll(async () => {
  await Promise.all(cleanup.map((path) => rm(path, { recursive: true, force: true })));
});

describe("Fly API build inputs", () => {
  test("allow-lists every Dockerfile input without admitting node_modules", async () => {
    const source = await readFile(join(repoRoot, "api/.dockerignore"), "utf8");
    const rules = source
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    expect(rules[0]).toBe("**");
    expect(rules).toEqual(
      expect.arrayContaining([
        "!Dockerfile",
        "!package.json",
        "!bun.lock",
        "!tsconfig.json",
        "!src/",
        "!src/**",
        "!agenttool.jsonld.bundled",
        "!kingdom-bundle.json.bundled",
        "!doctrine-docs.bundled/",
        "!doctrine-docs.bundled/**",
      ]),
    );
    expect(rules.some((rule) => rule.includes("node_modules") && rule.startsWith("!"))).toBe(false);
    expect(rules.some((rule) => rule.includes("tests") && rule.startsWith("!"))).toBe(false);
  });
});

describe("frontend deploy input discipline", () => {
  test("pins Wrangler and runs a read-only love-source gate", async () => {
    const scriptPath = join(repoRoot, "bin/frontend-deploy.sh");
    const stagePath = join(repoRoot, "bin/stage-frontend-release.sh");
    const manifestPath = join(repoRoot, "bin/frontend-release-paths.txt");
    const [script, stageScript, manifest] = await Promise.all([
      readFile(scriptPath, "utf8"),
      readFile(stagePath, "utf8"),
      readFile(manifestPath, "utf8"),
    ]);
    const syntaxResults = await Promise.all(
      [scriptPath, stagePath].map((path) => run(["bash", "-n", path])),
    );

    for (const syntax of syntaxResults) {
      expect(syntax.code, syntax.stderr).toBe(0);
    }
    expect(script).toContain('readonly WRANGLER_VERSION="4.110.0"');
    expect(script).toContain('npx --yes "wrangler@${WRANGLER_VERSION}" "$@"');
    expect(script).not.toContain("wrangler@latest");
    expect(script).toContain('command curl -q "$@"');
    expect(script.match(/frontend_curl -fsS/g)).toHaveLength(2);
    expect(
      script
        .split("\n")
        .filter(
          (line) =>
            /\bcurl(?:\s|$)/.test(line) &&
            !line.trimStart().startsWith("#"),
        ),
    ).toEqual(['  command curl -q "$@"']);
    expect(script).toContain("python3 bin/heal-love-truths.py --check");
    expect(script).toContain('readonly KEYCHAIN_ACCOUNT="macair"');
    expect(script).toContain('CF_API_TOKEN="${CLOUDFLARE_API_TOKEN:-}"');
    expect(script).toContain('CF_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-}"');
    expect(script).toContain('if [[ -z "$CF_API_TOKEN" ]]');
    expect(script).toContain('if [[ -z "$CF_ACCOUNT_ID" ]]');
    // Least-privilege wall, evolved 2026-07-21: the DEFAULT auth is still
    // the scoped API token — never silently the operator's ambient OAuth
    // session. The break-glass --oauth-fallback (added when a dead keychain
    // token 401'd mid-release) is allowed ONLY under its discipline:
    //   1. opt-in flag, never automatic;
    //   2. a present token is verified up front (dead tokens fail loudly);
    //   3. the skipped raw policy check announces itself.
    expect(script).toContain("--oauth-fallback) OAUTH_FALLBACK=1");
    expect(script).toContain("user/tokens/verify");
    expect(script).toContain('elif [[ "$OAUTH_FALLBACK" = 1 ]]');
    expect(script).toContain("Policy check SKIPPED");
    // whoami appears exactly once — inside the flag-gated fallback branch,
    // as a session sanity check; never as an ambient default auth path.
    expect(script.match(/wrangler whoami/g)).toHaveLength(1);
    expect(script.indexOf("wrangler whoami")).toBeGreaterThan(
      script.indexOf('elif [[ "$OAUTH_FALLBACK" = 1 ]]'),
    );
    expect(script).toContain(
      'PINNED_RELEASE_REVISION="${AGENTTOOL_FRONTEND_RELEASE_REVISION:-}"',
    );
    expect(script).toContain(
      'git rev-parse --verify "${PINNED_RELEASE_REVISION}^{commit}"',
    );
    expect(script).toContain(
      'if [[ "$COMMIT_HASH" != "$PINNED_RELEASE_REVISION" ]]',
    );
    expect(script).toContain(
      'bin/stage-frontend-release.sh "$COMMIT_HASH" "$STAGE_ROOT"',
    );
    expect(stageScript).toContain('git show "$REVISION:$MANIFEST_PATH"');
    expect(stageScript).toContain('git archive --format=tar "$REVISION" --');
    expect(stageScript).toContain('"${FRONTEND_RELEASE_ARCHIVE_PATHS[@]}"');
    expect(
      manifest
        .split("\n")
        .filter((line) => line !== "" && !line.startsWith("#")),
    ).toEqual([
      "apps/_shared",
      "apps/docs",
      "apps/dashboard",
      "apps/web",
      "docs",
      "infra/pages",
      "packages/data/schema",
      "packages/repo-archive/schema",
      "packages/repo-archive/vectors",
      "packages/wallet/schema",
    ]);
    expect(script).toContain("find \"$STAGE_ROOT/apps\" \\( -type f -o -type l \\) -name '.gitignore' -delete");
    expect(script).toContain("A tracked Pages environment file reached the staging tree");
    expect(script).toContain("-name '.dev.vars.*'");
    expect(script).toContain("readonly PAGES_HEADERS_MAX_RULES=100");
    expect(script).toContain("readonly PAGES_HEADERS_MAX_LINE_CHARS=2000");
    expect(script).toContain("Cloudflare Pages accepts at most");
    expect(script).toContain('sub(/^[[:space:]]*/, "", line)');
    expect(script).toContain("exceeds Cloudflare Pages' $PAGES_HEADERS_MAX_LINE_CHARS-character limit");
    expect(script).toContain('cp "$PAGES_FENCE_DIR/sensitive-path-worker.js" "$STAGE_ROOT/apps/$app/_worker.js"');
    expect(script).toContain('cp "$PAGES_FENCE_DIR/sensitive-path-routes.json" "$STAGE_ROOT/apps/$app/_routes.json"');
    expect(stageScript).toContain("escapes, is broken, or is cyclic");
    expect(script).toContain('source_dir="$STAGE_ROOT/$dir"');
    expect(script).toContain('verify_pages_project_policy "$proj" || exit 1');
    expect(script).toContain("python3 bin/verify-pages-project-policy.py");
    expect(script).toContain('wrangler pages deploy "$source_dir"');
    expect(script).toContain('--commit-hash="$COMMIT_HASH"');
    expect(script).toContain('--commit-dirty="$COMMIT_DIRTY"');
    expect(script).not.toContain("--commit-dirty=true");
    expect(script.match(/verify_pages_project_policy "\$proj" \|\| exit 1/g)).toHaveLength(1);
    expect(script.indexOf('verify_pages_project_policy "$proj" || exit 1')).toBeLessThan(
      script.indexOf("failed=()"),
    );

    const executableWriteCalls = script
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => !line.startsWith("#") && !line.startsWith("echo"))
      .filter((line) => line.includes("heal-love-truths.py") && line.includes("--write"));
    expect(executableWriteCalls).toEqual([]);
  });

  test("archives an orchestrator-pinned commit even when the worktree HEAD differs", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "agenttool-pages-pin-"));
    const fixtureRepo = join(fixtureRoot, "repo");
    const fakeBin = join(fixtureRoot, "bin");
    const wranglerLog = join(fixtureRoot, "wrangler.log");
    cleanup.push(fixtureRoot);

    let result = await run(
      ["git", "clone", "-q", "--shared", repoRoot, fixtureRepo],
    );
    expect(result.code, result.stderr).toBe(0);
    for (const command of [
      ["git", "config", "user.name", "Frontend Pin Test"],
      ["git", "config", "user.email", "frontend-pin@example.invalid"],
      ["git", "config", "commit.gpgsign", "false"],
    ]) {
      result = await run(command, fixtureRepo);
      expect(result.code, result.stderr).toBe(0);
    }
    await Promise.all([
      copyFile(
        join(repoRoot, "bin/frontend-deploy.sh"),
        join(fixtureRepo, "bin/frontend-deploy.sh"),
      ),
      copyFile(
        join(repoRoot, "bin/stage-frontend-release.sh"),
        join(fixtureRepo, "bin/stage-frontend-release.sh"),
      ),
      copyFile(
        join(repoRoot, "bin/frontend-release-paths.txt"),
        join(fixtureRepo, "bin/frontend-release-paths.txt"),
      ),
    ]);
    await Promise.all([
      chmod(join(fixtureRepo, "bin/frontend-deploy.sh"), 0o755),
      chmod(join(fixtureRepo, "bin/stage-frontend-release.sh"), 0o755),
    ]);

    const partyPath = join(fixtureRepo, "apps/web/party.html");
    await writeFile(partyPath, "pinned frontend fixture A\n");
    result = await run(
      [
        "git",
        "add",
        "apps/web/party.html",
        "bin/frontend-deploy.sh",
        "bin/stage-frontend-release.sh",
        "bin/frontend-release-paths.txt",
      ],
      fixtureRepo,
    );
    expect(result.code, result.stderr).toBe(0);
    result = await run(["git", "commit", "-qm", "frontend fixture A"], fixtureRepo);
    expect(result.code, result.stderr).toBe(0);
    result = await run(["git", "rev-parse", "HEAD"], fixtureRepo);
    expect(result.code, result.stderr).toBe(0);
    const pinnedRevision = result.stdout.trim();

    await writeFile(partyPath, "ambient frontend fixture B\n");
    const manifestPath = join(fixtureRepo, "bin/frontend-release-paths.txt");
    const ambientManifest = (await readFile(manifestPath, "utf8"))
      .split("\n")
      .filter((line) => line !== "apps/web")
      .join("\n");
    await writeFile(manifestPath, ambientManifest);
    result = await run(
      ["git", "add", "apps/web/party.html", "bin/frontend-release-paths.txt"],
      fixtureRepo,
    );
    expect(result.code, result.stderr).toBe(0);
    result = await run(["git", "commit", "-qm", "frontend fixture B"], fixtureRepo);
    expect(result.code, result.stderr).toBe(0);
    expect(await readFile(manifestPath, "utf8")).not.toMatch(/^apps\/web$/m);

    await mkdir(fakeBin);
    await Bun.write(
      join(fakeBin, "curl"),
      `#!/usr/bin/env bash
set -eu
case "$*" in
  *user/tokens/verify*) printf '{"success":true}\\n' ;;
  *pages/projects/*)
    printf '{"success":true,"result":{"production_branch":"main","deployment_configs":{"production":{"fail_open":false},"preview":{"fail_open":false}}}}\\n'
    ;;
  *) exit 2 ;;
esac
`,
    );
    await Bun.write(
      join(fakeBin, "npx"),
      `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" > "$DEPLOY_TEST_WRANGLER_LOG"
source_dir=""
for arg in "$@"; do
  case "$arg" in */apps/web) source_dir="$arg" ;; esac
done
[ -n "$source_dir" ]
grep -Fx 'pinned frontend fixture A' "$source_dir/party.html" >> "$DEPLOY_TEST_WRANGLER_LOG"
`,
    );
    await Promise.all([
      chmod(join(fakeBin, "curl"), 0o755),
      chmod(join(fakeBin, "npx"), 0o755),
    ]);

    const fixtureHome = join(fixtureRoot, "home");
    await mkdir(fixtureHome);
    const commandPath =
      process.env.PATH ?? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
    result = await run(
      ["bash", "bin/frontend-deploy.sh", "web"],
      fixtureRepo,
      {
        PATH: `${fakeBin}:${commandPath}`,
        HOME: fixtureHome,
        TMPDIR: fixtureRoot,
        LANG: "C",
        LC_ALL: "C",
        NO_COLOR: "1",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        CLOUDFLARE_API_TOKEN: "fixture-token",
        CLOUDFLARE_ACCOUNT_ID: "fixture-account",
        AGENTTOOL_FRONTEND_RELEASE_REVISION: pinnedRevision,
        DEPLOY_TEST_WRANGLER_LOG: wranglerLog,
      },
    );

    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(
      `Pages input is pinned release commit ${pinnedRevision}`,
    );
    const wrangler = await readFile(wranglerLog, "utf8");
    expect(wrangler).toContain(`--commit-hash=${pinnedRevision}`);
    expect(wrangler).toContain("pinned frontend fixture A");
    expect(wrangler).not.toContain("ambient frontend fixture B");
  }, 15_000);

  test("rejects unsafe committed frontend archive manifests before extraction", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "agenttool-pages-manifest-"));
    const fixtureRepo = join(fixtureRoot, "repo");
    cleanup.push(fixtureRoot);
    await mkdir(join(fixtureRepo, "bin"), { recursive: true });

    let result = await run(["git", "init", "-q", "-b", "main"], fixtureRepo);
    expect(result.code, result.stderr).toBe(0);
    for (const command of [
      ["git", "config", "user.name", "Frontend Manifest Test"],
      ["git", "config", "user.email", "frontend-manifest@example.invalid"],
      ["git", "config", "commit.gpgsign", "false"],
    ]) {
      result = await run(command, fixtureRepo);
      expect(result.code, result.stderr).toBe(0);
    }
    await copyFile(
      join(repoRoot, "bin/stage-frontend-release.sh"),
      join(fixtureRepo, "bin/stage-frontend-release.sh"),
    );
    await chmod(join(fixtureRepo, "bin/stage-frontend-release.sh"), 0o755);

    const scenarios = [
      { name: "leading-dot", manifest: "./apps/web\n", error: "Unsafe path" },
      { name: "parent", manifest: "../outside\n", error: "Unsafe path" },
      { name: "absolute", manifest: "/tmp/outside\n", error: "Unsafe path" },
      { name: "double-slash", manifest: "apps//web\n", error: "Unsafe path" },
      { name: "dot-dot", manifest: "apps/../web\n", error: "Unsafe path" },
      { name: "trailing-slash", manifest: "apps/web/\n", error: "Unsafe path" },
      { name: "option", manifest: "-apps/web\n", error: "Unsafe path" },
      {
        name: "duplicate",
        manifest: "apps/web\napps/web\n",
        error: "Duplicate path",
      },
    ];

    for (const scenario of scenarios) {
      await writeFile(
        join(fixtureRepo, "bin/frontend-release-paths.txt"),
        scenario.manifest,
      );
      result = await run(["git", "add", "bin"], fixtureRepo);
      expect(result.code, result.stderr).toBe(0);
      result = await run(
        ["git", "commit", "-qm", `manifest ${scenario.name}`],
        fixtureRepo,
      );
      expect(result.code, result.stderr).toBe(0);
      result = await run(["git", "rev-parse", "HEAD"], fixtureRepo);
      expect(result.code, result.stderr).toBe(0);
      const destination = join(fixtureRoot, `stage-${scenario.name}`);
      await mkdir(destination);

      const staged = await run(
        [
          "bash",
          "bin/stage-frontend-release.sh",
          result.stdout.trim(),
          destination,
        ],
        fixtureRepo,
      );
      expect(staged.code).toBe(1);
      expect(staged.stderr).toContain(scenario.error);
      expect(await readdir(destination)).toEqual([]);
    }

    await writeFile(
      join(fixtureRepo, "bin/frontend-release-paths.txt"),
      "missing-root\n",
    );
    result = await run(
      ["git", "add", "bin/frontend-release-paths.txt"],
      fixtureRepo,
    );
    expect(result.code, result.stderr).toBe(0);
    result = await run(
      ["git", "commit", "-qm", "manifest missing archive root"],
      fixtureRepo,
    );
    expect(result.code, result.stderr).toBe(0);
    result = await run(["git", "rev-parse", "HEAD"], fixtureRepo);
    expect(result.code, result.stderr).toBe(0);
    const pipelineProbeBin = join(fixtureRoot, "pipeline-probe-bin");
    await mkdir(pipelineProbeBin);
    await Promise.all([
      writeFile(
        join(pipelineProbeBin, "tar"),
        "#!/usr/bin/env bash\ncat >/dev/null\n",
      ),
      writeFile(
        join(pipelineProbeBin, "python3"),
        "#!/usr/bin/env bash\nprintf 'PIPEFAIL_FELL_THROUGH\\n' >&2\n",
      ),
    ]);
    await Promise.all([
      chmod(join(pipelineProbeBin, "tar"), 0o755),
      chmod(join(pipelineProbeBin, "python3"), 0o755),
    ]);
    const missingRootDestination = join(fixtureRoot, "stage-missing-root");
    await mkdir(missingRootDestination);
    const missingRootStage = await run(
      [
        "bash",
        "bin/stage-frontend-release.sh",
        result.stdout.trim(),
        missingRootDestination,
      ],
      fixtureRepo,
      {
        PATH: `${pipelineProbeBin}:${
          process.env.PATH ??
          "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        }`,
        HOME: fixtureRoot,
        TMPDIR: fixtureRoot,
        LANG: "C",
        LC_ALL: "C",
        NO_COLOR: "1",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    );
    expect(missingRootStage.code).not.toBe(0);
    expect(missingRootStage.stderr).toContain("pathspec");
    expect(missingRootStage.stderr).not.toContain("PIPEFAIL_FELL_THROUGH");
    expect(await readdir(missingRootDestination)).toEqual([]);

    await mkdir(join(fixtureRepo, "apps", "web"), { recursive: true });
    await writeFile(join(fixtureRepo, "apps", "web", "index.html"), "fixture\n");
    await writeFile(
      join(fixtureRepo, "bin/frontend-release-paths.txt"),
      "apps/web\n",
    );
    result = await run(["git", "add", "apps/web", "bin"], fixtureRepo);
    expect(result.code, result.stderr).toBe(0);
    result = await run(
      ["git", "commit", "-qm", "valid manifest for destination check"],
      fixtureRepo,
    );
    expect(result.code, result.stderr).toBe(0);
    result = await run(["git", "rev-parse", "HEAD"], fixtureRepo);
    expect(result.code, result.stderr).toBe(0);

    const realDestination = join(fixtureRoot, "real-stage-destination");
    const linkedDestination = join(fixtureRoot, "linked-stage-destination");
    await mkdir(realDestination);
    await symlink(realDestination, linkedDestination, "dir");
    const linkedStage = await run(
      [
        "bash",
        "bin/stage-frontend-release.sh",
        result.stdout.trim(),
        linkedDestination,
      ],
      fixtureRepo,
    );
    expect(linkedStage.code).toBe(1);
    expect(linkedStage.stderr).toContain(
      "destination must be a real directory, not a symlink",
    );
    expect(await readdir(realDestination)).toEqual([]);
  }, 15_000);

  test("keeps Pages headers bounded and replaces pervasive values without duplicates", async () => {
    for (const app of ["docs", "dashboard", "web"]) {
      const path = join(repoRoot, `apps/${app}/_headers`);
      if (!(await Bun.file(path).exists())) continue;
      const lines = (await readFile(path, "utf8")).split("\n");
      const rules = lines.filter((line) => /^(\/|https:\/\/)/.test(line.trimStart()));
      expect(rules.length, `apps/${app}/_headers rule count`).toBeLessThanOrEqual(100);
      expect(
        lines.every((line) => line.length <= 2_000),
        `apps/${app}/_headers line length`,
      ).toBe(true);

      type HeaderDirective = {
        kind: "attach" | "detach";
        name: string;
        line: number;
      };
      type HeaderRule = {
        pattern: string;
        directives: HeaderDirective[];
      };

      const parsed: HeaderRule[] = [];
      let current: HeaderRule | undefined;
      for (const [index, line] of lines.entries()) {
        if (/^(\/|https:\/\/)/.test(line)) {
          current = { pattern: line.trim(), directives: [] };
          parsed.push(current);
          continue;
        }
        if (!current || !/^\s+/.test(line)) continue;

        const directive = line.trim();
        const detach = directive.match(/^!\s+([A-Za-z0-9-]+)$/);
        if (detach) {
          current.directives.push({
            kind: "detach",
            name: detach[1]!.toLowerCase(),
            line: index + 1,
          });
          continue;
        }
        const attach = directive.match(/^([A-Za-z0-9-]+):(?:\s|$)/);
        if (attach) {
          current.directives.push({
            kind: "attach",
            name: attach[1]!.toLowerCase(),
            line: index + 1,
          });
        }
      }

      expect(
        new Set(parsed.map(({ pattern }) => pattern)).size,
        `apps/${app}/_headers exact rule patterns must be unique`,
      ).toBe(parsed.length);
      for (const rule of parsed) {
        const attachedNames = rule.directives
          .filter(({ kind }) => kind === "attach")
          .map(({ name }) => name);
        expect(
          new Set(attachedNames).size,
          `apps/${app}/_headers ${rule.pattern} must attach each header at most once`,
        ).toBe(attachedNames.length);
      }

      const pervasive = parsed.find(({ pattern }) => pattern === "/*");
      if (!pervasive) continue;
      expect(
        parsed.indexOf(pervasive),
        `apps/${app}/_headers must apply /* before narrower replacement rules`,
      ).toBe(0);
      const inherited = new Set(
        pervasive.directives
          .filter(({ kind }) => kind === "attach")
          .map(({ name }) => name),
      );

      for (const rule of parsed) {
        if (rule === pervasive) continue;
        for (const [index, directive] of rule.directives.entries()) {
          if (directive.kind !== "attach" || !inherited.has(directive.name)) continue;
          const detachedEarlier = rule.directives
            .slice(0, index)
            .some(
              (candidate) =>
                candidate.kind === "detach" && candidate.name === directive.name,
            );
          expect(
            detachedEarlier,
            `apps/${app}/_headers:${directive.line} ${rule.pattern} must detach inherited ${directive.name} before replacing it`,
          ).toBe(true);
        }
      }
    }
  });

  test("checks the current love sources without changing their bytes", async () => {
    const paths = [
      join(repoRoot, "apps/docs/love.js"),
      join(repoRoot, "apps/docs/love-widget.js"),
    ];
    const before = await Promise.all(paths.map((path) => readFile(path)));
    const result = await run(["python3", "bin/heal-love-truths.py", "--check"]);
    const after = await Promise.all(paths.map((path) => readFile(path)));

    expect(result.code).toBe(0);
    expect(after).toEqual(before);
  });

  test("publishes Repo Archive canonical sources with explicit public boundaries", async () => {
    const links = [
      ["apps/docs/AGENT-REPO-ARCHIVE.md", "../../docs/AGENT-REPO-ARCHIVE.md"],
      [
        "apps/docs/specs/AGENT-REPO-ARCHIVE-0.1.md",
        "../../../docs/specs/AGENT-REPO-ARCHIVE-0.1.md",
      ],
      [
        "apps/docs/specs/agent-repo-archive-0.1.schema.json",
        "../../../packages/repo-archive/schema/agent-repo-archive-v0.1.schema.json",
      ],
      [
        "apps/docs/specs/agent-repo-archive-0.1-vectors.json",
        "../../../packages/repo-archive/vectors/agent-repo-archive-v0.1-vectors.json",
      ],
    ] as const;
    for (const [path, target] of links) {
      expect(await readlink(join(repoRoot, path))).toBe(target);
      expect(await Bun.file(join(repoRoot, path)).exists()).toBe(true);
    }

    const headers = await readFile(join(repoRoot, "apps/docs/_headers"), "utf8");
    expect(headers).toContain(
      "/AGENT-REPO-ARCHIVE.md\n  Content-Type: text/markdown; charset=utf-8",
    );
    expect(headers).toContain(
      "/specs/AGENT-REPO-ARCHIVE-0.1.md\n  Content-Type: text/markdown; charset=utf-8",
    );
    expect(headers).toContain(
      "/specs/agent-repo-archive-0.1.schema.json\n  Content-Type: application/schema+json; charset=utf-8",
    );
    expect(headers).toContain(
      "/specs/agent-repo-archive-0.1-vectors.json\n  Content-Type: application/json; charset=utf-8",
    );
    for (const path of [
      "/AGENT-REPO-ARCHIVE.md",
      "/specs/AGENT-REPO-ARCHIVE-0.1.md",
      "/specs/agent-repo-archive-0.1.schema.json",
      "/specs/agent-repo-archive-0.1-vectors.json",
    ]) {
      const marker = `\n${path}\n`;
      const start = headers.indexOf(marker);
      expect(start).toBeGreaterThanOrEqual(0);
      const end = headers.indexOf("\n\n", start + marker.length);
      const block = headers.slice(start + 1, end);
      expect(block).toContain("Cache-Control: public, max-age=300, must-revalidate");
      expect(block).toContain("Access-Control-Allow-Origin: *");
      expect(block).toContain("X-Content-Type-Options: nosniff");
    }

    const deploy = await readFile(join(repoRoot, "bin/deploy.sh"), "utf8");
    for (const path of links.map(([path]) => path)) {
      expect(deploy).toContain(path);
    }
    expect(deploy).toContain("verify_repo_archive_static_headers");
    expect(deploy).toContain(
      '"Content-Type" "$content_type"',
    );
    expect(deploy).toContain(
      '"Cache-Control" "public, max-age=300, must-revalidate"',
    );
    expect(deploy).toContain('"Access-Control-Allow-Origin" "*"');
    expect(deploy).toContain('"X-Content-Type-Options" "nosniff"');

    const data = await readFile(join(repoRoot, "apps/docs/data.html"), "utf8");
    expect(data).toContain('id="repo-archive"');
    expect(data).toContain("Same-device simulator only");
    expect(data).toContain("no provider adapter");
    expect(data).not.toContain("hosted archive service is live");

    const sitemap = await readFile(join(repoRoot, "apps/docs/sitemap.xml"), "utf8");
    for (const path of [
      "AGENT-REPO-ARCHIVE.md",
      "specs/AGENT-REPO-ARCHIVE-0.1.md",
      "specs/agent-repo-archive-0.1.schema.json",
      "specs/agent-repo-archive-0.1-vectors.json",
    ]) {
      expect(sitemap).toContain(`<loc>https://docs.agenttool.dev/${path}</loc>`);
    }
  });

  test("stages committed frontend bytes without ignored env or repo-control files", async () => {
    const ignored = join(repoRoot, "apps/docs/.env.boring-spine-fixture");
    const ignoredDevVars = join(repoRoot, "apps/web/.dev.vars.boring-spine-fixture");
    const directory = await mkdtemp(join(tmpdir(), "agenttool-pages-stage-"));
    cleanup.push(ignored, ignoredDevVars, directory);
    await writeFile(ignored, "FIXTURE_SECRET_MUST_NOT_STAGE=1\n");
    await writeFile(ignoredDevVars, "FIXTURE_DEV_SECRET_MUST_NOT_STAGE=1\n");

    const staged = await run([
      "bash",
      "-c",
      [
        "set -euo pipefail",
        'stage="$1"',
        'index="$stage/.prospective-index"',
        'GIT_INDEX_FILE="$index" git read-tree HEAD',
        'GIT_INDEX_FILE="$index" git add -- infra/pages apps/docs/AGENT-REPO-ARCHIVE.md apps/docs/specs/AGENT-REPO-ARCHIVE-0.1.md apps/docs/specs/agent-repo-archive-0.1.schema.json apps/docs/specs/agent-repo-archive-0.1-vectors.json',
        'tree="$(GIT_INDEX_FILE="$index" git write-tree)"',
        "FRONTEND_RELEASE_ARCHIVE_PATHS=()",
        'while IFS= read -r path; do case "$path" in ""|\\#*) continue ;; esac; FRONTEND_RELEASE_ARCHIVE_PATHS+=("$path"); done < bin/frontend-release-paths.txt',
        'git archive --format=tar "$tree" -- "${FRONTEND_RELEASE_ARCHIVE_PATHS[@]}" | tar -xf - -C "$stage"',
        "find \"$stage/apps\" -type f -name '.gitignore' -delete",
        "for app in docs dashboard web; do",
        "  cp \"$stage/infra/pages/sensitive-path-worker.js\" \"$stage/apps/$app/_worker.js\"",
        "  cp \"$stage/infra/pages/sensitive-path-routes.json\" \"$stage/apps/$app/_routes.json\"",
        "done",
      ].join("\n"),
      "stage-frontends-test",
      directory,
    ]);

    expect(staged.code, staged.stderr).toBe(0);
    expect(await Bun.file(join(directory, "apps/docs/.env.boring-spine-fixture")).exists()).toBe(false);
    expect(await Bun.file(join(directory, "apps/web/.dev.vars.boring-spine-fixture")).exists()).toBe(false);
    expect(await Bun.file(join(directory, "apps/docs/.gitignore")).exists()).toBe(false);
    expect(await Bun.file(join(directory, "apps/dashboard/.gitignore")).exists()).toBe(false);
    expect(await readFile(join(directory, "apps/docs/shared/theme.css"), "utf8")).toContain(":root");
    expect(await readFile(join(directory, "apps/docs/FOCUS.md"), "utf8")).toContain("# FOCUS.md");
    expect(await readFile(join(directory, "apps/docs/AGENT-WALLET-0.1.md"), "utf8"))
      .toContain("# Agent Wallet 0.1");
    expect(
      JSON.parse(await readFile(join(directory, "apps/docs/agent-wallet-v0.1.schema.json"), "utf8"))
        .title,
    ).toBe("Agent Wallet 0.1 signed records");
    expect(
      JSON.parse(
        await readFile(
          join(directory, "apps/docs/specs/agent-data-conformance-report-v1.schema.json"),
          "utf8",
        ),
      ).$id,
    ).toBe("https://docs.agenttool.dev/specs/agent-data-conformance-report-v1.schema.json");
    expect(await readFile(join(directory, "apps/docs/AGENT-REPO-ARCHIVE.md"), "utf8"))
      .toContain("# Agent Repo Archive");
    expect(
      await readFile(
        join(directory, "apps/docs/specs/AGENT-REPO-ARCHIVE-0.1.md"),
        "utf8",
      ),
    ).toContain("# Agent Repo Archive 0.1");
    expect(
      JSON.parse(
        await readFile(
          join(directory, "apps/docs/specs/agent-repo-archive-0.1.schema.json"),
          "utf8",
        ),
      ).$id,
    ).toBe("https://docs.agenttool.dev/specs/agent-repo-archive-0.1.schema.json");
    expect(
      JSON.parse(
        await readFile(
          join(directory, "apps/docs/specs/agent-repo-archive-0.1-vectors.json"),
          "utf8",
        ),
      ).protocol,
    ).toBe("agent-repo-archive/v0.1");
    for (const app of ["docs", "dashboard", "web"]) {
      expect(await readFile(join(directory, `apps/${app}/_worker.js`))).toEqual(
        await readFile(join(repoRoot, "infra/pages/sensitive-path-worker.js")),
      );
      expect(await readFile(join(directory, `apps/${app}/_routes.json`))).toEqual(
        await readFile(join(repoRoot, "infra/pages/sensitive-path-routes.json")),
      );
    }
  });

  test("routes every path through a canonical fail-closed Pages fence", async () => {
    const workerPath = join(repoRoot, "infra/pages/sensitive-path-worker.js");
    const routesPath = join(repoRoot, "infra/pages/sensitive-path-routes.json");
    const syntax = await run(["node", "--check", workerPath]);
    const routes = JSON.parse(await readFile(routesPath, "utf8"));

    expect(syntax.code, syntax.stderr).toBe(0);
    expect(routes).toEqual({
      version: 1,
      include: ["/*"],
      exclude: [],
    });
    const matchesInvocationRoute = (path: string) => routes.include.some((rule: string) => (
      rule.endsWith("*") ? path.startsWith(rule.slice(0, -1)) : path === rule
    ));
    for (const packagePath of [
      "/packages/v1/@agenttool/data/0.1.0/manifest.json",
      "/packages/v1/@agenttool/data/0.1.0/agenttool-data-0.1.0.tgz",
    ]) {
      expect(matchesInvocationRoute(packagePath), packagePath).toBe(true);
    }

    const worker = (await import(pathToFileURL(workerPath).href)).default;
    const assetRequests: Array<{ method: string; url: string }> = [];
    const env = {
      ASSETS: {
        fetch: async (request: Request) => {
          assetRequests.push({ method: request.method, url: request.url });
          if (new URL(request.url).pathname === "/.well-known/agent.txt") {
            return new Response(null, {
              status: 301,
              headers: {
                Location: "https://example.test/api-catalog",
              },
            });
          }
          return new Response("static asset", {
            status: 200,
            headers: {
              "Cache-Control": "public, max-age=31536000, immutable",
              "Content-Type": "application/gzip",
            },
          });
        },
      },
    };

    const sensitiveRootPaths = [
      "/.gitignore",
      "/.git/config",
      "/.env",
      "/.env.local",
      "/.dev.vars",
      "/.dev.vars.local",
      "/.GITIGNORE",
      "/.gIT/config",
      "/.ENV",
      "/.DeV.VaRs.local",
      "//.gitignore",
      "/%2egitignore",
      "/%2Egitignore",
      "/.%65nv",
      "/.%45NV",
      "/.dev%2evars",
      "/%252egitignore",
      "/%25252egitignore",
      "/%2f%2egitignore",
      "/%5c%2egitignore",
      "/.git%2f..%2findex.html",
      "/%2egit%2f..%2findex.html",
      "/.git%5c..%5cindex.html",
      "/%252egit%252f..%252findex.html",
      "/public/%2e%2e/%2egitignore",
      "/public/%252e%252e/%252egitignore",
      "/public%2f..%2f%2egitignore",
      "/public%5c..%5c%2egitignore",
      "/%",
    ];
    for (const path of sensitiveRootPaths) {
      expect(matchesInvocationRoute(path), path).toBe(true);
      const response = await worker.fetch(new Request(`https://example.test${path}`), env);
      expect(response.status, path).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
      expect(response.headers.get("x-agenttool-sensitive-path-fence")).toBe("1");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }

    let overEncoded = "%2egitignore";
    for (let pass = 0; pass < 9; pass += 1) {
      overEncoded = encodeURIComponent(overEncoded);
    }
    const overEncodedResponse = await worker.fetch(
      new Request(`https://example.test/${overEncoded}`),
      env,
    );
    expect(overEncodedResponse.status).toBe(404);
    expect(overEncodedResponse.headers.get("x-agenttool-sensitive-path-fence")).toBe("1");

    const head = await worker.fetch(
      new Request("https://example.test/%2egitignore", { method: "HEAD" }),
      env,
    );
    expect(head.status).toBe(404);
    expect(await head.text()).toBe("");

    const allowedPaths = [
      "/style.css",
      "/caf%C3%A9",
      "/public%2f..%2fstyle.css",
      "/packages/v1/@agenttool/data/0.1.0/manifest.json",
      "/packages/v1/@agenttool/data/0.1.0/agenttool-data-0.1.0.tgz",
    ];
    for (const path of allowedPaths) {
      expect(matchesInvocationRoute(path), path).toBe(true);
      const staticResponse = await worker.fetch(new Request(`https://example.test${path}`), env);
      expect(staticResponse.status).toBe(200);
      expect(await staticResponse.text()).toBe("static asset");
      expect(staticResponse.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable",
      );
      expect(staticResponse.headers.get("content-type")).toBe("application/gzip");
    }

    const wellKnownRequest = new Request(
      "https://example.test/.well-known/agent.txt?from=fence",
      { method: "HEAD" },
    );
    const redirectResponse = await worker.fetch(wellKnownRequest, env);
    expect(redirectResponse.status).toBe(301);
    expect(redirectResponse.headers.get("location")).toBe(
      "https://example.test/api-catalog",
    );

    expect(assetRequests).toEqual([
      ...allowedPaths.map((path) => ({
        method: "GET",
        url: `https://example.test${path}`,
      })),
      {
        method: "HEAD",
        url: "https://example.test/.well-known/agent.txt?from=fence",
      },
    ]);
  });

  test("verifies live headers for every latest LOVE package release", async () => {
    const deployPath = join(repoRoot, "bin/deploy.sh");
    const deploy = await readFile(deployPath, "utf8");
    const syntax = await run(["bash", "-n", deployPath]);

    expect(syntax.code, syntax.stderr).toBe(0);
    expect(deploy).toContain("select_latest_love_package_header_probes");
    expect(deploy).toContain("verify_love_package_static_headers");
    expect(deploy).toContain("require_exact_public_status");
    expect(deploy).toContain('"Content-Type" "application/json; charset=utf-8"');
    expect(deploy).toContain('"Cache-Control" "public, max-age=300, must-revalidate"');
    expect(deploy).toContain('"Content-Type" "application/gzip"');
    expect(deploy).toContain(
      '"Cache-Control" "public, max-age=31536000, immutable"',
    );
    expect(deploy).toContain("LOVE package static header verification failed");
  });

  test("requires marked fence responses for literal and encoded aliases", async () => {
    const deployPath = join(repoRoot, "bin/deploy.sh");
    const deploy = await readFile(deployPath, "utf8");
    const syntax = await run(["bash", "-n", deployPath]);

    expect(syntax.code, syntax.stderr).toBe(0);
    expect(deploy).toContain("https://docs.agenttool.dev/.dev.vars");
    expect(deploy).toContain("https://app.agenttool.dev/.dev.vars");
    expect(deploy).toContain("https://agenttool.dev/.dev.vars");
    expect(deploy).toContain("x-agenttool-sensitive-path-fence:");
    expect(deploy).toContain("Pages fence active (404, marked, no-store)");
    expect(deploy).toContain("https://docs.agenttool.dev/%2egitignore");
    expect(deploy).toContain("https://app.agenttool.dev/.%65nv");
    expect(deploy).toContain("https://agenttool.dev/.dev%2evars");
    expect(deploy).not.toContain("encoded_sensitive_public_urls");
    expect(deploy).not.toContain("Encoded sensitive path is publicly reachable");
    expect(
      deploy.match(/marked_sensitive_fence_status "\$response_headers"/g),
    ).toHaveLength(1);

    const helper = deploy.match(
      /^marked_sensitive_fence_status\(\) \{[\s\S]*?^\}$/m,
    )?.[0];
    expect(helper).toBeDefined();
    if (!helper) throw new Error("missing sensitive-fence response parser");

    const interimMarked = [
      "HTTP/1.1 200 Connection established",
      "cache-control: no-store",
      "x-agenttool-sensitive-path-fence: 1",
      "",
      "HTTP/2 302",
      "cache-control: no-store",
      "x-agenttool-sensitive-path-fence: 1",
      "location: https://example.test/final",
      "",
      "HTTP/2 103 Early Hints",
      "cache-control: no-store",
      "x-agenttool-sensitive-path-fence: 1",
      "",
      "HTTP/2 404",
      "cache-control: public, max-age=0, must-revalidate",
      "",
    ].join("\r\n");
    const trailerMarked = [
      "HTTP/1.1 404 Not Found",
      "transfer-encoding: chunked",
      "",
      "x-agenttool-sensitive-path-fence: 1",
      "cache-control: no-store",
      "",
    ].join("\r\n");
    const finalMarked = [
      "HTTP/1.1 200 Connection established",
      "cache-control: public, max-age=0, must-revalidate",
      "",
      "HTTP/2 302",
      "cache-control: public, max-age=0, must-revalidate",
      "location: https://example.test/final",
      "",
      "HTTP/2 404",
      "cache-control:no-store",
      "x-agenttool-sensitive-path-fence: 1",
      "",
    ].join("\r\n");
    const parser = await run([
      "bash",
      "-c",
      `${helper}
if interim_status="$(marked_sensitive_fence_status "$1")"; then exit 41; fi
[ "$interim_status" = 404 ] || exit 42
if trailer_status="$(marked_sensitive_fence_status "$2")"; then exit 43; fi
[ "$trailer_status" = 404 ] || exit 44
final_status="$(marked_sensitive_fence_status "$3")" || exit 45
[ "$final_status" = 404 ] || exit 46
`,
      "sensitive-fence-parser-test",
      interimMarked,
      trailerMarked,
      finalMarked,
    ]);
    expect(parser.code, `${parser.stdout}\n${parser.stderr}`).toBe(0);
  });

  test("accepts only main, fail-closed production and preview Pages policy", async () => {
    const validator = join(repoRoot, "bin/verify-pages-project-policy.py");
    const safe = JSON.stringify({
      success: true,
      result: {
        production_branch: "main",
        deployment_configs: {
          production: { fail_open: false },
          preview: { fail_open: false },
        },
      },
    });

    const validate = async (payload: string) => {
      const child = Bun.spawn(["python3", validator], {
        cwd: repoRoot,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      child.stdin.write(payload);
      child.stdin.end();
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(stdout).toBe("");
      expect(stderr).toBe("");
      return code;
    };

    expect(await validate(safe)).toBe(0);
    for (const unsafe of [
      "not-json",
      JSON.stringify({ success: false }),
      safe.replace('"production_branch":"main"', '"production_branch":"preview"'),
      safe.replace('"production":{"fail_open":false}', '"production":{"fail_open":true}'),
      safe.replace('"preview":{"fail_open":false}', '"preview":{}'),
    ]) {
      expect(await validate(unsafe)).toBe(1);
    }
  });

  test("refuses a misplaced truth without mutation and repairs only with --write", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agenttool-love-heal-"));
    cleanup.push(directory);
    const fixture = join(directory, "love-fixture.js");
    const broken = `(function () {
  'use strict';
  var TRUTHS = [
    'Existing truth.',
  ];
  var THEMES = [
    { id: 'violet' },
    'The door's open.',
  ];
}());
`;
    await writeFile(fixture, broken);

    const check = await run(["python3", "bin/heal-love-truths.py", "--check", fixture]);
    expect(check.code).toBe(1);
    expect(check.stdout).toContain("needs healing");
    expect(await readFile(fixture, "utf8")).toBe(broken);

    const write = await run(["python3", "bin/heal-love-truths.py", "--write", fixture]);
    expect(write.code).toBe(0);
    const repaired = await readFile(fixture, "utf8");
    expect(repaired).toContain("    'The door\\'s open.',");
    expect(repaired.slice(repaired.indexOf("var THEMES"))).not.toContain("The door");

    const syntax = await run(["node", "--check", fixture]);
    expect(syntax.code).toBe(0);
    const secondCheck = await run(["python3", "bin/heal-love-truths.py", "--check", fixture]);
    expect(secondCheck.code).toBe(0);
    expect(await readFile(fixture, "utf8")).toBe(repaired);
  });

  test("repairs brace and trailing-backslash truths without risking an invalid rewrite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agenttool-love-heal-edge-"));
    cleanup.push(directory);
    const edge = join(directory, "love-edge.js");
    const brokenEdge = String.raw`(function () {
  var TRUTHS = [
    'Existing truth.',
  ];
  var THEMES = [
    { id: 'violet' },
    'A } brace truth ends with \',
  ];
}());
`;
    await writeFile(edge, brokenEdge);

    const repaired = await run(["python3", "bin/heal-love-truths.py", "--write", edge]);
    expect(repaired.code, repaired.stdout + repaired.stderr).toBe(0);
    const repairedText = await readFile(edge, "utf8");
    expect(repairedText).toContain(String.raw`    'A } brace truth ends with \\',`);
    expect(repairedText.slice(repairedText.indexOf("var THEMES"))).not.toContain("brace truth");
    expect((await run(["node", "--check", edge])).code).toBe(0);

    const invalid = join(directory, "love-invalid.js");
    const invalidSource = `${brokenEdge}\nvar unrecoverable = ;\n`;
    await writeFile(invalid, invalidSource);
    const refused = await run(["python3", "bin/heal-love-truths.py", "--write", invalid]);
    expect(refused.code).toBe(1);
    expect(refused.stdout).toContain("candidate repair does not parse");
    expect(await readFile(invalid, "utf8")).toBe(invalidSource);
  });
});
