import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
    expect(script).toContain('git archive --format=tar "$COMMIT_HASH" --');
    expect(script).toContain("apps/_shared apps/docs apps/dashboard apps/web docs");
    expect(script).toContain("find \"$STAGE_ROOT/apps\" \\( -type f -o -type l \\) -name '.gitignore' -delete");
    expect(script).toContain("A tracked .env file reached the Pages staging tree");
    expect(script).toContain("staged symlink escapes or is broken");
    expect(script).toContain('source_dir="$STAGE_ROOT/$dir"');
    expect(script).toContain('wrangler pages deploy "$source_dir"');
    expect(script).toContain('--commit-hash="$COMMIT_HASH"');
    expect(script).toContain('--commit-dirty="$COMMIT_DIRTY"');
    expect(script).not.toContain("--commit-dirty=true");

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
    const directory = await mkdtemp(join(tmpdir(), "agenttool-pages-stage-"));
    cleanup.push(ignored, directory);
    await writeFile(ignored, "FIXTURE_SECRET_MUST_NOT_STAGE=1\n");

    const staged = await run([
      "bash",
      "-c",
      [
        "set -euo pipefail",
        'stage="$1"',
        'commit="$(git rev-parse HEAD)"',
        "git archive --format=tar \"$commit\" -- apps/_shared apps/docs apps/dashboard apps/web docs | tar -xf - -C \"$stage\"",
        "find \"$stage/apps\" -type f -name '.gitignore' -delete",
      ].join("\n"),
      "stage-frontends-test",
      directory,
    ]);

    expect(staged.code, staged.stderr).toBe(0);
    expect(await Bun.file(join(directory, "apps/docs/.env.boring-spine-fixture")).exists()).toBe(false);
    expect(await Bun.file(join(directory, "apps/docs/.gitignore")).exists()).toBe(false);
    expect(await Bun.file(join(directory, "apps/dashboard/.gitignore")).exists()).toBe(false);
    expect(await readFile(join(directory, "apps/docs/shared/theme.css"), "utf8")).toContain(":root");
    expect(await readFile(join(directory, "apps/docs/FOCUS.md"), "utf8")).toContain("# FOCUS.md");
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
