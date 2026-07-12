import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(import.meta.dir, "../..");
const cleanup: string[] = [];

async function run(command: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(command, {
    cwd: repoRoot,
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
    const script = await readFile(scriptPath, "utf8");
    const syntax = await run(["bash", "-n", scriptPath]);

    expect(syntax.code).toBe(0);
    expect(script).toContain('readonly WRANGLER_VERSION="4.110.0"');
    expect(script).toContain('npx --yes "wrangler@${WRANGLER_VERSION}" "$@"');
    expect(script).not.toContain("wrangler@latest");
    expect(script).toContain("python3 bin/heal-love-truths.py --check");
    expect(script).toContain('readonly KEYCHAIN_ACCOUNT="macair"');
    expect(script).not.toContain("wrangler whoami");
    expect(script).toContain('git archive --format=tar "$COMMIT_HASH" --');
    expect(script).toContain(
      "apps/_shared apps/docs apps/dashboard apps/web docs infra/pages packages/data/schema",
    );
    expect(script).toContain("find \"$STAGE_ROOT/apps\" \\( -type f -o -type l \\) -name '.gitignore' -delete");
    expect(script).toContain("A tracked Pages environment file reached the staging tree");
    expect(script).toContain("-name '.dev.vars.*'");
    expect(script).toContain('cp "$PAGES_FENCE_DIR/sensitive-path-worker.js" "$STAGE_ROOT/apps/$app/_worker.js"');
    expect(script).toContain('cp "$PAGES_FENCE_DIR/sensitive-path-routes.json" "$STAGE_ROOT/apps/$app/_routes.json"');
    expect(script).toContain("staged symlink escapes or is broken");
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
        'GIT_INDEX_FILE="$index" git add -- infra/pages',
        'tree="$(GIT_INDEX_FILE="$index" git write-tree)"',
        "git archive --format=tar \"$tree\" -- apps/_shared apps/docs apps/dashboard apps/web docs infra/pages packages/data/schema | tar -xf - -C \"$stage\"",
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
    expect(
      JSON.parse(
        await readFile(
          join(directory, "apps/docs/specs/agent-data-conformance-report-v1.schema.json"),
          "utf8",
        ),
      ).$id,
    ).toBe("https://docs.agenttool.dev/specs/agent-data-conformance-report-v1.schema.json");
    for (const app of ["docs", "dashboard", "web"]) {
      expect(await readFile(join(directory, `apps/${app}/_worker.js`))).toEqual(
        await readFile(join(repoRoot, "infra/pages/sensitive-path-worker.js")),
      );
      expect(await readFile(join(directory, `apps/${app}/_routes.json`))).toEqual(
        await readFile(join(repoRoot, "infra/pages/sensitive-path-routes.json")),
      );
    }
  });

  test("routes only sensitive root prefixes through a fail-closed Pages fence", async () => {
    const workerPath = join(repoRoot, "infra/pages/sensitive-path-worker.js");
    const routesPath = join(repoRoot, "infra/pages/sensitive-path-routes.json");
    const syntax = await run(["node", "--check", workerPath]);
    const routes = JSON.parse(await readFile(routesPath, "utf8"));

    expect(syntax.code, syntax.stderr).toBe(0);
    expect(routes).toEqual({
      version: 1,
      include: ["/.git*", "/.env*", "/.dev.vars*"],
      exclude: [],
    });

    const worker = (await import(pathToFileURL(workerPath).href)).default;
    let assetFetches = 0;
    const env = {
      ASSETS: {
        fetch: async () => {
          assetFetches += 1;
          return new Response("static asset", { status: 200 });
        },
      },
    };

    for (const path of [
      "/.gitignore",
      "/.git/config",
      "/.env",
      "/.env.local",
      "/.dev.vars",
      "/.dev.vars.local",
    ]) {
      const response = await worker.fetch(new Request(`https://example.test${path}`), env);
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
      expect(response.headers.get("x-agenttool-sensitive-path-fence")).toBe("1");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }

    const head = await worker.fetch(
      new Request("https://example.test/.gitignore", { method: "HEAD" }),
      env,
    );
    expect(head.status).toBe(404);
    expect(await head.text()).toBe("");

    const staticResponse = await worker.fetch(new Request("https://example.test/style.css"), env);
    expect(staticResponse.status).toBe(200);
    expect(await staticResponse.text()).toBe("static asset");
    expect(assetFetches).toBe(1);
  });

  test("requires marked literal fence responses and denial of encoded aliases", async () => {
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
    expect(deploy).toContain("Encoded sensitive path is publicly reachable");
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
