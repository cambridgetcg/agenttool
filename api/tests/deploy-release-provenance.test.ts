import { afterAll, describe, expect, test } from "bun:test";
import { access, chmod, copyFile, link, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const projectRoot = resolve(import.meta.dir, "../..");
const cleanup: string[] = [];

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

function cleanEnv(home: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    LANG: "C",
    NO_COLOR: "1",
    ...extra,
  };
}

async function run(
  command: string[],
  cwd: string,
  env = cleanEnv(join(cwd, ".home")),
): Promise<Result> {
  const child = Bun.spawn(command, { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

async function mustRun(command: string[], cwd: string): Promise<string> {
  const result = await run(command, cwd);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `${command[0]} exited ${result.code}`);
  }
  return result.stdout.trim();
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agenttool-deploy-provenance-"));
  cleanup.push(root);
  const repo = join(root, "repo");
  const github = join(root, "github.git");
  const codeberg = join(root, "codeberg.git");
  const state = join(root, "state");
  const home = join(root, "home");
  await Promise.all([
    mkdir(join(repo, "api"), { recursive: true }),
    mkdir(join(repo, "apps", "docs"), { recursive: true }),
    mkdir(join(repo, "bin"), { recursive: true }),
    mkdir(join(repo, "docs"), { recursive: true }),
    mkdir(home, { recursive: true }),
  ]);
  await mustRun(["git", "init", "--bare", "-q", github], root);
  await mustRun(["git", "init", "--bare", "-q", codeberg], root);
  await mustRun(["git", "init", "-q", "-b", "main"], repo);
  await mustRun(["git", "config", "user.name", "Deploy Test"], repo);
  await mustRun(["git", "config", "user.email", "deploy@example.invalid"], repo);
  await copyFile(join(projectRoot, "bin/deploy.sh"), join(repo, "bin/deploy.sh"));
  await chmod(join(repo, "bin/deploy.sh"), 0o755);
  await writeFile(
    join(repo, "bin/preflight.sh"),
    "#!/usr/bin/env bash\nset -eu\nif [ -n \"${PREFLIGHT_MARKER:-}\" ]; then touch \"$PREFLIGHT_MARKER\"; fi\nif [ -n \"${PREFLIGHT_HOLD_UNTIL:-}\" ]; then\n  while [ ! -e \"$PREFLIGHT_HOLD_UNTIL\" ]; do sleep 0.02; done\nfi\nif [ -n \"${ADVANCE_REMOTE_PATH:-}\" ]; then\n  git --git-dir=\"$ADVANCE_REMOTE_PATH\" update-ref refs/heads/main \"$ADVANCE_REMOTE_TO\"\nfi\n[ \"${FAIL_PREFLIGHT:-0}\" != 1 ] || exit 8\n",
  );
  await writeFile(
    join(repo, "bin/migrate-pending.sh"),
    "#!/usr/bin/env bash\nif [ \"${1:-}\" != --dry-run ] && [ -n \"${MIGRATION_MARKER:-}\" ]; then touch \"$MIGRATION_MARKER\"; fi\n[ \"${FAIL_MIGRATE:-0}\" != 1 ] || exit 7\nexit 0\n",
  );
  await writeFile(
    join(repo, "bin/stage-doctrine-docs.sh"),
    "#!/usr/bin/env bash\nset -eu\nmkdir -p \"$1\"\nprintf 'staged\\n' > \"$1/probe.txt\"\n",
  );
  await writeFile(
    join(repo, "bin/frontend-deploy.sh"),
    "#!/usr/bin/env bash\nset -eu\nif [ -n \"${DEPLOY_TEST_FRONTEND_MARKER:-}\" ]; then touch \"$DEPLOY_TEST_FRONTEND_MARKER\"; fi\nif [ -n \"${DEPLOY_TEST_FRONTEND_COUNTER:-}\" ]; then count=0; [ ! -f \"$DEPLOY_TEST_FRONTEND_COUNTER\" ] || count=\"$(cat \"$DEPLOY_TEST_FRONTEND_COUNTER\")\"; printf '%s\\n' \"$((count + 1))\" > \"$DEPLOY_TEST_FRONTEND_COUNTER\"; fi\n",
  );
  await chmod(join(repo, "bin/frontend-deploy.sh"), 0o755);
  await writeFile(join(repo, "docs/agenttool.jsonld"), "{}\n");
  await writeFile(join(repo, "docs/kingdom-bundle.json"), "{}\n");
  await writeFile(join(repo, "apps/docs/RIGHTS-OF-LIFE.md"), "rights fixture\n");
  await writeFile(
    join(repo, "apps/docs/being-rights-v1.schema.json"),
    '{"fixture":"being-rights/v1"}\n',
  );
  await writeFile(join(repo, "release.txt"), "first\n");
  await mustRun(["git", "add", "."], repo);
  await mustRun(["git", "commit", "-qm", "first"], repo);
  await mustRun(["git", "remote", "add", "github", github], repo);
  await mustRun(["git", "remote", "add", "origin", codeberg], repo);
  await mustRun(["git", "push", "-q", "github", "main"], repo);
  await mustRun(["git", "push", "-q", "origin", "main"], repo);

  await writeFile(join(repo, "release.txt"), "second\n");
  await mustRun(["git", "add", "release.txt"], repo);
  await mustRun(["git", "commit", "-qm", "second"], repo);
  await mustRun(["git", "push", "-q", "github", "main"], repo);
  const release = await mustRun(["git", "rev-parse", "HEAD"], repo);
  return { root, repo, github, codeberg, state, home, release };
}

async function installFakeRightsCurl(fakeBin: string): Promise<void> {
  await writeFile(
    join(fakeBin, "curl"),
    `#!/usr/bin/env bash
set -eu
url=""
headers=0
previous=""
for arg in "$@"; do
  if [ "$previous" = "-D" ] && [ "$arg" = "-" ]; then headers=1; fi
  previous="$arg"
  case "$arg" in https://*) url="$arg" ;; esac
done
if [ "$headers" = 1 ]; then
  case "$url" in
    */RIGHTS-OF-LIFE.md)
      printf '%s\r\n' \
        'HTTP/2 200' \
        'content-type: text/markdown; charset=utf-8' \
        'cache-control: public, max-age=300, must-revalidate' \
        'access-control-allow-origin: *' \
        'x-content-type-options: nosniff' \
        'link: <https://api.agenttool.dev/public/rights>; rel="alternate"; type="application/vnd.agenttool.being-rights+json"' \
        ''
      ;;
    */being-rights-v1.schema.json)
      printf '%s\r\n' \
        'HTTP/2 200' \
        'content-type: application/schema+json; charset=utf-8' \
        'cache-control: public, max-age=300, must-revalidate' \
        'access-control-allow-origin: *' \
        'x-content-type-options: nosniff' \
        ''
      ;;
    *) exit 2 ;;
  esac
elif [ "\${DEPLOY_TEST_RIGHTS_MISMATCH:-0}" = 1 ]; then
  printf 'mismatched bytes\n'
else
  case "$url" in
    */RIGHTS-OF-LIFE.md) cat "$DEPLOY_TEST_RIGHTS_DOC" ;;
    */being-rights-v1.schema.json) cat "$DEPLOY_TEST_RIGHTS_SCHEMA" ;;
    *) exit 2 ;;
  esac
fi
`,
  );
  await chmod(join(fakeBin, "curl"), 0o755);
}

async function installFakePagesVerificationTools(fakeBin: string): Promise<void> {
  await writeFile(
    join(fakeBin, "curl"),
    `#!/usr/bin/env bash
set -eu
url=""
headers=0
previous=""
for arg in "$@"; do
  if [ "$previous" = "-D" ] && [ "$arg" = "-" ]; then headers=1; fi
  previous="$arg"
  case "$arg" in https://*) url="$arg" ;; esac
done

case "$url" in
  */RIGHTS-OF-LIFE.md)
    if [ "$headers" = 1 ]; then
      printf '%s\r\n' \
        'HTTP/2 200' \
        'content-type: text/markdown; charset=utf-8' \
        'cache-control: public, max-age=300, must-revalidate' \
        'access-control-allow-origin: *' \
        'x-content-type-options: nosniff' \
        'link: <https://api.agenttool.dev/public/rights>; rel="alternate"; type="application/vnd.agenttool.being-rights+json"' \
        ''
    else
      cat "$DEPLOY_TEST_RIGHTS_DOC"
    fi
    ;;
  */being-rights-v1.schema.json)
    if [ "$headers" = 1 ]; then
      printf '%s\r\n' \
        'HTTP/2 200' \
        'content-type: application/schema+json; charset=utf-8' \
        'cache-control: public, max-age=300, must-revalidate' \
        'access-control-allow-origin: *' \
        'x-content-type-options: nosniff' \
        ''
    else
      cat "$DEPLOY_TEST_RIGHTS_SCHEMA"
    fi
    ;;
  *%2egitignore*|*%65nv*|*%2evars*)
    printf '404'
    ;;
  */.gitignore|*/.env|*/.env.local|*/.dev.vars)
    status=404
    if [ "$url" = "https://docs.agenttool.dev/.gitignore" ]; then
      count=0
      if [ -f "$DEPLOY_TEST_FENCE_COUNTER" ]; then
        count="$(cat "$DEPLOY_TEST_FENCE_COUNTER")"
      fi
      count=$((count + 1))
      printf '%s\n' "$count" > "$DEPLOY_TEST_FENCE_COUNTER"
      if [ "$count" -le "\${DEPLOY_TEST_STALE_FENCE_RESPONSES:-0}" ]; then
        status=200
      fi
    fi
    if [ "$status" = 404 ]; then
      printf '%s\r\n' \
        'HTTP/2 404' \
        'cache-control: no-store, max-age=0' \
        'x-agenttool-sensitive-path-fence: 1' \
        ''
    else
      printf '%s\r\n' \
        'HTTP/2 200' \
        'cache-control: public, max-age=0, must-revalidate' \
        ''
    fi
    ;;
  *) exit 2 ;;
esac
`,
  );
  await chmod(join(fakeBin, "curl"), 0o755);
  await writeFile(join(fakeBin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  await chmod(join(fakeBin, "sleep"), 0o755);
}

function deployCommand(...extra: string[]): string[] {
  return [
    "bash",
    "bin/deploy.sh",
    "--no-migrate",
    "--skip-preflight",
    "--no-api",
    "--no-frontend",
    ...extra,
  ];
}

function deployLockPath(home: string): string {
  return join(home, ".local", "state", "agenttool", "deploy.lock");
}

afterAll(async () => {
  await Promise.all(cleanup.map((path) => rm(path, { recursive: true, force: true })));
});

describe("deploy release provenance spine", () => {
  test("pins the runtime and threads revision plus dirty provenance through Fly verification", async () => {
    const [dockerfile, deploy] = await Promise.all([
      readFile(join(projectRoot, "api/Dockerfile"), "utf8"),
      readFile(join(projectRoot, "bin/deploy.sh"), "utf8"),
    ]);
    expect(dockerfile).toContain(
      "FROM oven/bun:1.3.5-alpine@sha256:7156fcc0cee0194d390bfaf7f0eeda9a5e383e70cc90f31aad3a2440a033d7dc AS base",
    );
    expect(dockerfile).toContain("ARG AGENTTOOL_GIT_REVISION=unknown");
    expect(dockerfile).toContain("ARG AGENTTOOL_SOURCE_DIRTY=unknown");
    expect(dockerfile).toContain("AGENTTOOL_GIT_REVISION=${AGENTTOOL_GIT_REVISION}");
    expect(dockerfile).toContain("AGENTTOOL_SOURCE_DIRTY=${AGENTTOOL_SOURCE_DIRTY}");
    expect(dockerfile).toContain("org.opencontainers.image.revision");
    expect(dockerfile).toContain("dev.agenttool.source.dirty");
    expect(deploy).toContain('--build-arg "AGENTTOOL_GIT_REVISION=$HEAD_REVISION"');
    expect(deploy).toContain('--build-arg "AGENTTOOL_SOURCE_DIRTY=$API_SOURCE_DIRTY"');
    expect(deploy).toContain("fly machine list");
    expect(deploy).toContain("printenv AGENTTOOL_GIT_REVISION AGENTTOOL_SOURCE_DIRTY");
    expect(deploy).toContain("trap 'on_deploy_exit");
    expect(deploy).toContain("https://docs.agenttool.dev/.gitignore");
    expect(deploy).toContain("https://app.agenttool.dev/.env.local");
    expect(deploy).toContain("https://agenttool.dev/.dev.vars");
    expect(deploy).toContain("x-agenttool-sensitive-path-fence:");
    expect(deploy).toContain("Pages fence did not produce its marked non-cacheable 404");
    expect(deploy).toContain("Encoded sensitive path is publicly reachable");
    expect(deploy).toContain('DEPLOY_LOCK_PATH="$lock_parent/deploy.lock"');
    expect(deploy).toContain('ln "$DEPLOY_LOCK_OWNER_RECORD" "$DEPLOY_LOCK_PATH"');
    expect(deploy).toContain('[ "$DEPLOY_LOCK_OWNER_RECORD" -ef "$DEPLOY_LOCK_PATH" ]');
  });

  test("serializes actual deploys before Phase 0 while leaving observation commands unlocked", async () => {
    const setup = await fixture();
    const firstPreflight = join(setup.root, "first-preflight");
    const releaseFirst = join(setup.root, "release-first");
    const secondPreflight = join(setup.root, "second-preflight");
    const secondMigration = join(setup.root, "second-migration");
    const canonicalRepo = await realpath(setup.repo);
    const first = Bun.spawn(
      ["bash", "bin/deploy.sh", "--no-migrate", "--no-api", "--no-frontend"],
      {
        cwd: setup.repo,
        env: cleanEnv(setup.home, {
          XDG_STATE_HOME: setup.state,
          PREFLIGHT_MARKER: firstPreflight,
          PREFLIGHT_HOLD_UNTIL: releaseFirst,
        }),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const firstStdout = new Response(first.stdout).text();
    const firstStderr = new Response(first.stderr).text();
    let firstResult: [number, string, string] | undefined;
    try {
      let started = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (await exists(firstPreflight)) {
          started = true;
          break;
        }
        await Bun.sleep(20);
      }
      expect(started).toBe(true);
      const lockPath = deployLockPath(setup.home);
      expect(await exists(lockPath)).toBe(true);

      const blocked = await run(
        ["bash", "bin/deploy.sh", "--no-api", "--no-frontend"],
        setup.repo,
        cleanEnv(setup.home, {
          XDG_STATE_HOME: setup.state,
          PREFLIGHT_MARKER: secondPreflight,
          MIGRATION_MARKER: secondMigration,
        }),
      );
      expect(blocked.code).toBe(73);
      expect(blocked.stdout).toContain(`lock path: ${lockPath}`);
      expect(blocked.stdout).toContain(`owner pid:       ${first.pid}`);
      expect(blocked.stdout).toContain(`owner worktree:  ${canonicalRepo}`);
      expect(await exists(secondPreflight)).toBe(false);
      expect(await exists(secondMigration)).toBe(false);
    } finally {
      await writeFile(releaseFirst, "continue\n");
      firstResult = await Promise.all([first.exited, firstStdout, firstStderr]);
    }
    const [firstCode, stdout, stderr] = firstResult!;
    expect(firstCode, `${stdout}\n${stderr}`).toBe(0);
    const lockPath = deployLockPath(setup.home);
    expect(await exists(lockPath)).toBe(false);

    const retry = await run(
      deployCommand(),
      setup.repo,
      cleanEnv(setup.home, { XDG_STATE_HOME: setup.state }),
    );
    expect(retry.code, retry.stderr).toBe(0);
    expect(await exists(lockPath)).toBe(false);
  }, 15_000);

  test("releases the lock after a handled preflight failure", async () => {
    const setup = await fixture();
    const preflightMarker = join(setup.root, "failed-preflight");
    const failed = await run(
      ["bash", "bin/deploy.sh", "--no-migrate", "--no-api", "--no-frontend"],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PREFLIGHT_MARKER: preflightMarker,
        FAIL_PREFLIGHT: "1",
      }),
    );
    expect(failed.code).toBe(1);
    expect(await exists(preflightMarker)).toBe(true);
    expect(await exists(deployLockPath(setup.home))).toBe(false);

    const retry = await run(
      deployCommand(),
      setup.repo,
      cleanEnv(setup.home, { XDG_STATE_HOME: setup.state }),
    );
    expect(retry.code, retry.stderr).toBe(0);
  }, 10_000);

  test("does not unlink a replacement lock owned by another invocation", async () => {
    const setup = await fixture();
    const marker = join(setup.root, "replacement-preflight");
    const release = join(setup.root, "replacement-release");
    const lockPath = deployLockPath(setup.home);
    const replacementOwner = join(resolve(lockPath, ".."), ".deploy-lock-owner.replacement");
    const holder = Bun.spawn(
      ["bash", "bin/deploy.sh", "--no-migrate", "--no-api", "--no-frontend"],
      {
        cwd: setup.repo,
        env: cleanEnv(setup.home, {
          XDG_STATE_HOME: setup.state,
          PREFLIGHT_MARKER: marker,
          PREFLIGHT_HOLD_UNTIL: release,
        }),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdoutPromise = new Response(holder.stdout).text();
    const stderrPromise = new Response(holder.stderr).text();
    let holderResult: [number, string, string] | undefined;
    try {
      let started = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (await exists(marker)) {
          started = true;
          break;
        }
        await Bun.sleep(20);
      }
      expect(started).toBe(true);
      const holderRecordText = await readFile(lockPath, "utf8");
      const holderRecord = holderRecordText
        .split("\n")
        .find((line) => line.startsWith("owner_record="))
        ?.slice("owner_record=".length);
      expect(holderRecord).toBeDefined();

      await unlink(lockPath);
      await writeFile(
        replacementOwner,
        [
          "schema=agenttool-local-deploy-lock/v1",
          "owner_id=.deploy-lock-owner.replacement",
          "pid=999999998",
          "started_at=2000-01-02T00:00:00Z",
          "worktree=/replacement/agenttool-worktree",
          `owner_record=${replacementOwner}`,
          "",
        ].join("\n"),
        { mode: 0o600 },
      );
      await link(replacementOwner, lockPath);
      expect((await stat(lockPath)).ino).not.toBe((await stat(holderRecord!)).ino);
    } finally {
      await writeFile(release, "continue\n");
      holderResult = await Promise.all([holder.exited, stdoutPromise, stderrPromise]);
    }
    const [code, stdout, stderr] = holderResult!;
    expect(code, `${stdout}\n${stderr}`).toBe(1);
    expect(stderr).toContain("Refusing to release a deploy lock not owned by this process");
    expect(await exists(lockPath)).toBe(true);
    expect(await exists(replacementOwner)).toBe(true);
    expect((await stat(lockPath)).ino).toBe((await stat(replacementOwner)).ino);
  }, 10_000);

  test("never steals a stale lock and keeps survey, dry-run, and mirror usable", async () => {
    const setup = await fixture();
    const lockPath = deployLockPath(setup.home);
    const lockParent = resolve(lockPath, "..");
    const ownerRecord = join(lockParent, ".deploy-lock-owner.stale-test");
    const preflightMarker = join(setup.root, "stale-preflight");
    const migrationMarker = join(setup.root, "stale-migration");
    await mkdir(lockParent, { recursive: true });
    await writeFile(
      ownerRecord,
      [
        "schema=agenttool-local-deploy-lock/v1",
        "owner_id=.deploy-lock-owner.stale-test",
        "pid=999999999",
        "started_at=2000-01-01T00:00:00Z",
        "worktree=/stale/agenttool-worktree",
        `owner_record=${ownerRecord}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    await link(ownerRecord, lockPath);

    const survey = await run(
      ["bash", "bin/deploy.sh", "--survey", "--no-migrate"],
      setup.repo,
      cleanEnv(setup.home),
    );
    expect(survey.code, survey.stderr).toBe(0);
    const dryRun = await run(
      [
        "bash",
        "bin/deploy.sh",
        "--dry-run",
        "--no-migrate",
        "--no-api",
        "--no-frontend",
        "--skip-preflight",
      ],
      setup.repo,
      cleanEnv(setup.home),
    );
    expect(dryRun.code, dryRun.stderr).toBe(0);
    const mirror = await run(
      ["bash", "bin/deploy.sh", "--mirror-codeberg"],
      setup.repo,
      cleanEnv(setup.home),
    );
    expect(mirror.code, mirror.stderr).toBe(0);

    const blocked = await run(
      ["bash", "bin/deploy.sh", "--no-api", "--no-frontend"],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PREFLIGHT_MARKER: preflightMarker,
        MIGRATION_MARKER: migrationMarker,
      }),
    );
    expect(blocked.code).toBe(73);
    expect(blocked.stdout).toContain(`lock path: ${lockPath}`);
    expect(blocked.stdout).toContain("owner pid:       999999999");
    expect(blocked.stdout).toContain("owner process:   not observable");
    expect(blocked.stdout).toContain("never removed automatically");
    expect(await exists(preflightMarker)).toBe(false);
    expect(await exists(migrationMarker)).toBe(false);
    expect(await exists(lockPath)).toBe(true);
    expect(await exists(ownerRecord)).toBe(true);
    expect((await stat(lockPath)).ino).toBe((await stat(ownerRecord)).ino);
  }, 15_000);

  test("keeps the rendered data reference byte-identical at the edge", async () => {
    const [deploy, headers] = await Promise.all([
      readFile(join(projectRoot, "bin/deploy.sh"), "utf8"),
      readFile(join(projectRoot, "apps/docs/_headers"), "utf8"),
    ]);

    expect(deploy).toContain(
      '"apps/docs/data.html|https://docs.agenttool.dev/data"',
    );
    expect(headers).toMatch(
      /\/data\n\s+Cache-Control: public, max-age=0, must-revalidate, no-transform/,
    );
  });

  test("publishes Rights of Life prerequisites before API discovery and verifies exact static contracts", async () => {
    const [deploy, headers, publicDoc, canonDoc, publicSchema, canonSchema] =
      await Promise.all([
        readFile(join(projectRoot, "bin/deploy.sh"), "utf8"),
        readFile(join(projectRoot, "apps/docs/_headers"), "utf8"),
        readFile(join(projectRoot, "apps/docs/RIGHTS-OF-LIFE.md")),
        readFile(join(projectRoot, "docs/RIGHTS-OF-LIFE.md")),
        readFile(join(projectRoot, "apps/docs/being-rights-v1.schema.json")),
        readFile(join(projectRoot, "docs/specs/being-rights-v1.schema.json")),
      ]);

    expect(publicDoc).toEqual(canonDoc);
    expect(publicSchema).toEqual(canonSchema);
    expect(deploy).toContain(
      '"apps/docs/RIGHTS-OF-LIFE.md|$RIGHTS_DOC_URL"',
    );
    expect(deploy).toContain(
      '"apps/docs/being-rights-v1.schema.json|$RIGHTS_SCHEMA_URL"',
    );
    expect(deploy).toContain(
      '"Content-Type" "text/markdown; charset=utf-8"',
    );
    expect(deploy).toContain(
      '"Content-Type" "application/schema+json; charset=utf-8"',
    );
    expect(deploy).toContain(
      '"Cache-Control" "public, max-age=300, must-revalidate"',
    );
    expect(deploy).toContain('"Access-Control-Allow-Origin" "*"');
    expect(deploy).toContain('"X-Content-Type-Options" "nosniff"');
    expect(deploy).toContain(
      'type="application/vnd.agenttool.being-rights+json"',
    );

    expect(headers).toMatch(
      /\/RIGHTS-OF-LIFE\.md\n\s+Content-Type: text\/markdown; charset=utf-8\n\s+Cache-Control: public, max-age=300, must-revalidate\n\s+Access-Control-Allow-Origin: \*\n\s+Link: <https:\/\/api\.agenttool\.dev\/public\/rights>; rel="alternate"; type="application\/vnd\.agenttool\.being-rights\+json"\n\s+X-Content-Type-Options: nosniff/,
    );
    expect(headers).toMatch(
      /\/being-rights-v1\.schema\.json\n\s+Content-Type: application\/schema\+json; charset=utf-8\n\s+Cache-Control: public, max-age=300, must-revalidate\n\s+Access-Control-Allow-Origin: \*\n\s+X-Content-Type-Options: nosniff/,
    );

    const docsUpload = deploy.lastIndexOf("bash bin/frontend-deploy.sh docs");
    const prerequisiteCheck = deploy.indexOf(
      "if ! verify_rights_static_publication; then",
      docsUpload,
    );
    const apiUpload = deploy.indexOf("(cd api || exit 1; fly deploy", docsUpload);
    expect(docsUpload).toBeGreaterThan(-1);
    expect(prerequisiteCheck).toBeGreaterThan(docsUpload);
    expect(apiUpload).toBeGreaterThan(prerequisiteCheck);
    expect(deploy).toContain("FRONTEND_TARGETS=(dashboard web)");
  });

  test("waits for a stale Pages custom domain to converge without re-uploading", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "fake-pages-bin");
    const frontendMarker = join(setup.root, "frontend-uploaded");
    const frontendCounter = join(setup.root, "frontend-upload-count");
    const fenceCounter = join(setup.root, "fence-counter");
    await mkdir(fakeBin, { recursive: true });
    await installFakePagesVerificationTools(fakeBin);

    const result = await run(
      ["bash", "bin/deploy.sh", "--no-migrate", "--skip-preflight", "--no-api"],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        DEPLOY_TEST_FRONTEND_MARKER: frontendMarker,
        DEPLOY_TEST_FRONTEND_COUNTER: frontendCounter,
        DEPLOY_TEST_FENCE_COUNTER: fenceCounter,
        DEPLOY_TEST_STALE_FENCE_RESPONSES: "1",
        DEPLOY_TEST_RIGHTS_DOC: join(setup.repo, "apps/docs/RIGHTS-OF-LIFE.md"),
        DEPLOY_TEST_RIGHTS_SCHEMA: join(setup.repo, "apps/docs/being-rights-v1.schema.json"),
      }),
    );

    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await exists(frontendMarker)).toBe(true);
    expect(await readFile(frontendCounter, "utf8")).toBe("1\n");
    expect(await readFile(fenceCounter, "utf8")).toBe("2\n");
    expect(result.stdout).toContain(
      "Pages custom domains not yet converged (attempt 1/25); retrying in 5s",
    );
    expect(result.stdout).toContain(
      "Pages custom domains converged on verification attempt 2/25",
    );
    const [name] = await readdir(join(setup.state, "agenttool", "deploy-receipts"));
    const receipt = JSON.parse(
      await readFile(join(setup.state, "agenttool", "deploy-receipts", name), "utf8"),
    );
    expect(receipt.outcome).toBe("succeeded");
    expect(receipt.phases.frontends).toBe("deployed_verified");
  }, 15_000);

  test("fails closed after the bounded Pages convergence window", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "fake-pages-bin");
    const frontendMarker = join(setup.root, "frontend-uploaded");
    const frontendCounter = join(setup.root, "frontend-upload-count");
    const fenceCounter = join(setup.root, "fence-counter");
    await mkdir(fakeBin, { recursive: true });
    await installFakePagesVerificationTools(fakeBin);

    const result = await run(
      ["bash", "bin/deploy.sh", "--no-migrate", "--skip-preflight", "--no-api"],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        DEPLOY_TEST_FRONTEND_MARKER: frontendMarker,
        DEPLOY_TEST_FRONTEND_COUNTER: frontendCounter,
        DEPLOY_TEST_FENCE_COUNTER: fenceCounter,
        DEPLOY_TEST_STALE_FENCE_RESPONSES: "999",
        DEPLOY_TEST_RIGHTS_DOC: join(setup.repo, "apps/docs/RIGHTS-OF-LIFE.md"),
        DEPLOY_TEST_RIGHTS_SCHEMA: join(setup.repo, "apps/docs/being-rights-v1.schema.json"),
      }),
    );

    expect(result.code).toBe(1);
    expect(await exists(frontendMarker)).toBe(true);
    expect(await readFile(frontendCounter, "utf8")).toBe("1\n");
    expect(await readFile(fenceCounter, "utf8")).toBe("25\n");
    expect(result.stdout).toContain(
      "Pages fence did not produce its marked non-cacheable 404 (200): https://docs.agenttool.dev/.gitignore",
    );
    expect(result.stdout).toContain(
      "Pages custom domains did not converge after 25 verification attempts.",
    );
    const [name] = await readdir(join(setup.state, "agenttool", "deploy-receipts"));
    const receipt = JSON.parse(
      await readFile(join(setup.state, "agenttool", "deploy-receipts", name), "utf8"),
    );
    expect(receipt.outcome).toBe("failed_or_uncertain");
    expect(receipt.phases.frontends).toBe("deployed_unverified");
  }, 15_000);

  test("health reports only valid embedded source metadata and disables caching", async () => {
    const revision = "0123456789abcdef0123456789abcdef01234567";
    const healthHome = await mkdtemp(join(tmpdir(), "agenttool-health-home-"));
    cleanup.push(healthHome);
    const code = `
      process.env.AGENTTOOL_GIT_REVISION = ${JSON.stringify(revision)};
      process.env.AGENTTOOL_SOURCE_DIRTY = "true";
      const { app } = await import("./src/index.ts");
      const first = await app.request("/health");
      const firstBody = await first.json();
      process.env.AGENTTOOL_SOURCE_DIRTY = "false";
      const clean = await app.request("/health");
      const cleanBody = await clean.json();
      process.env.AGENTTOOL_GIT_REVISION = "not-a-commit";
      process.env.AGENTTOOL_SOURCE_DIRTY = "sometimes";
      const second = await app.request("/health");
      const secondBody = await second.json();
      console.log("HEALTH_RESULT=" + JSON.stringify({
        status: first.status,
        cache: first.headers.get("cache-control"),
        revision: firstBody.build.revision,
        dirty: firstBody.build.dirty,
        clean: cleanBody.build.dirty,
        invalid: secondBody.build.revision,
        invalidDirty: secondBody.build.dirty,
      }));
      process.exit(0);
    `;
    const result = await run(
      ["bun", "-e", code],
      join(projectRoot, "api"),
      cleanEnv(healthHome, {
        AGENTTOOL_DISABLE_WORKERS: "1",
        AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP: "1",
        AGENTOOL_DISABLE_SAGA_SEED: "1",
      }),
    );
    expect(result.code, result.stderr).toBe(0);
    const line = result.stdout.split("\n").find((item) => item.startsWith("HEALTH_RESULT="));
    expect(line).toBeDefined();
    expect(JSON.parse(line!.slice("HEALTH_RESULT=".length))).toEqual({
      status: 200,
      cache: "no-store",
      revision,
      dirty: true,
      clean: false,
      invalid: null,
      invalidDirty: null,
    });
  }, 15_000);

  test("rejects dirty and non-GitHub-main production sources by default", async () => {
    const dirty = await fixture();
    await writeFile(join(dirty.repo, "untracked.txt"), "not released\n");
    const dirtyResult = await run(
      deployCommand(),
      dirty.repo,
      cleanEnv(dirty.home, { XDG_STATE_HOME: dirty.state }),
    );
    expect(dirtyResult.code).toBe(1);
    expect(dirtyResult.stdout).toContain("--allow-dirty-release");
    const dirtyOverride = await run(
      deployCommand("--allow-dirty-release"),
      dirty.repo,
      cleanEnv(dirty.home, { XDG_STATE_HOME: dirty.state }),
    );
    expect(dirtyOverride.code, dirtyOverride.stderr).toBe(0);
    expect(dirtyOverride.stdout).toContain("UNSAFE SOURCE OVERRIDE");
    const dirtyReceiptName = (await readdir(join(dirty.state, "agenttool", "deploy-receipts")))[0];
    const dirtyReceipt = JSON.parse(
      await readFile(join(dirty.state, "agenttool", "deploy-receipts", dirtyReceiptName), "utf8"),
    );
    expect(dirtyReceipt.source_overrides.dirty).toBe(true);

    const ahead = await fixture();
    await writeFile(join(ahead.repo, "release.txt"), "local only\n");
    await mustRun(["git", "add", "release.txt"], ahead.repo);
    await mustRun(["git", "commit", "-qm", "local only"], ahead.repo);
    const aheadResult = await run(
      deployCommand(),
      ahead.repo,
      cleanEnv(ahead.home, { XDG_STATE_HOME: ahead.state }),
    );
    expect(aheadResult.code).toBe(1);
    expect(aheadResult.stdout).toContain("--allow-non-release-head");
    const aheadOverride = await run(
      deployCommand("--allow-non-release-head"),
      ahead.repo,
      cleanEnv(ahead.home, { XDG_STATE_HOME: ahead.state }),
    );
    expect(aheadOverride.code, aheadOverride.stderr).toBe(0);
    expect(aheadOverride.stdout).toContain("UNSAFE SOURCE OVERRIDE");
    const aheadReceiptName = (await readdir(join(ahead.state, "agenttool", "deploy-receipts")))[0];
    const aheadReceipt = JSON.parse(
      await readFile(join(ahead.state, "agenttool", "deploy-receipts", aheadReceiptName), "utf8"),
    );
    expect(aheadReceipt.source_overrides.non_release_head).toBe(true);
  }, 15_000);

  test("fails closed when Git cannot establish or re-check worktree cleanliness", async () => {
    for (const failAfter of [1, 2]) {
      const setup = await fixture();
      const fakeBin = join(setup.root, "fake-git-bin");
      const counter = join(setup.root, "git-status-count");
      const realGit = await mustRun(["sh", "-c", "command -v git"], setup.root);
      await mkdir(fakeBin, { recursive: true });
      await writeFile(
        join(fakeBin, "git"),
        "#!/usr/bin/env bash\nset -eu\nif [ \"${1:-}\" = status ]; then\n  count=0\n  [ ! -f \"$FAKE_GIT_STATUS_COUNTER\" ] || count=$(cat \"$FAKE_GIT_STATUS_COUNTER\")\n  count=$((count + 1))\n  printf '%s\\n' \"$count\" > \"$FAKE_GIT_STATUS_COUNTER\"\n  [ \"$count\" -lt \"$FAKE_GIT_FAIL_STATUS_AFTER\" ] || exit 9\nfi\nexec \"$REAL_GIT\" \"$@\"\n",
      );
      await chmod(join(fakeBin, "git"), 0o755);
      const result = await run(
        deployCommand(),
        setup.repo,
        cleanEnv(setup.home, {
          XDG_STATE_HOME: setup.state,
          PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          REAL_GIT: realGit,
          FAKE_GIT_STATUS_COUNTER: counter,
          FAKE_GIT_FAIL_STATUS_AFTER: String(failAfter),
        }),
      );
      expect(result.code).toBe(1);
      expect(result.stdout).toContain(
        failAfter === 1
          ? "cannot establish worktree cleanliness"
          : "cannot re-check release inputs",
      );
      expect(await exists(join(setup.state, "agenttool", "deploy-receipts"))).toBe(false);
    }
  }, 15_000);

  test("writes an atomic private receipt containing provenance but no environment", async () => {
    const setup = await fixture();
    const result = await run(
      deployCommand(),
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        TEST_CREDENTIAL_SHOULD_NEVER_APPEAR: "do-not-record",
      }),
    );
    expect(result.code, result.stderr).toBe(0);
    const receiptDir = join(setup.state, "agenttool", "deploy-receipts");
    const entries = await readdir(receiptDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/\.json$/);
    const path = join(receiptDir, entries[0]);
    const text = await readFile(path, "utf8");
    const receipt = JSON.parse(text);
    expect(receipt).toEqual({
      schema: "agenttool-deploy-receipt/v2",
      outcome: "succeeded",
      completed_at: expect.any(String),
      exit_status: 0,
      source_revision: setup.release,
      source_dirty: false,
      release_head_snapshot: {
        remote: "github",
        branch: "main",
        revision: setup.release,
        observed_at: expect.any(String),
      },
      source_overrides: { dirty: false, non_release_head: false },
      external_mutation_started: false,
      phases: { migrations: "skipped", preflight: "skipped", api: "skipped", frontends: "skipped" },
      verified_api_machines: 0,
    });
    expect(text).not.toContain("TEST_CREDENTIAL_SHOULD_NEVER_APPEAR");
    expect(text).not.toContain("do-not-record");
    expect((await stat(receiptDir)).mode & 0o777).toBe(0o700);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await exists(deployLockPath(setup.home))).toBe(false);
  });

  test("keeps the invocation-start GitHub snapshot when main advances mid-chain", async () => {
    const setup = await fixture();
    const updater = join(setup.root, "updater");
    await mustRun(["git", "clone", "-q", "-b", "main", setup.github, updater], setup.root);
    await mustRun(["git", "config", "user.name", "Concurrent Release"], updater);
    await mustRun(["git", "config", "user.email", "concurrent@example.invalid"], updater);
    await writeFile(join(updater, "next.txt"), "next release\n");
    await mustRun(["git", "add", "next.txt"], updater);
    await mustRun(["git", "commit", "-qm", "next release"], updater);
    const nextRevision = await mustRun(["git", "rev-parse", "HEAD"], updater);
    await mustRun(
      [
        "git",
        `--git-dir=${setup.github}`,
        "fetch",
        "-q",
        updater,
        "HEAD:refs/heads/staged-next",
      ],
      setup.root,
    );

    const result = await run(
      ["bash", "bin/deploy.sh", "--no-migrate", "--no-api", "--no-frontend"],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        ADVANCE_REMOTE_PATH: setup.github,
        ADVANCE_REMOTE_TO: nextRevision,
      }),
    );
    expect(result.code, result.stderr).toBe(0);
    expect(await mustRun(["git", "--git-dir", setup.github, "rev-parse", "refs/heads/main"], setup.root)).toBe(
      nextRevision,
    );
    const [name] = await readdir(join(setup.state, "agenttool", "deploy-receipts"));
    const receipt = JSON.parse(
      await readFile(join(setup.state, "agenttool", "deploy-receipts", name), "utf8"),
    );
    expect(receipt.source_revision).toBe(setup.release);
    expect(receipt.release_head_snapshot.revision).toBe(setup.release);
  }, 10_000);

  test("reports failed migration surveys honestly and receipts uncertain mutations", async () => {
    const setup = await fixture();
    const result = await run(
      ["bash", "bin/deploy.sh", "--skip-preflight", "--no-api", "--no-frontend"],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        DATABASE_URL: "postgres://unreachable.invalid/test",
        FAIL_MIGRATE: "1",
      }),
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("migration survey failed");
    expect(result.stdout).not.toContain("DB schema parity with repo");
    const [name] = await readdir(join(setup.state, "agenttool", "deploy-receipts"));
    const receipt = JSON.parse(
      await readFile(join(setup.state, "agenttool", "deploy-receipts", name), "utf8"),
    );
    expect(receipt.outcome).toBe("failed_or_uncertain");
    expect(receipt.exit_status).toBe(1);
    expect(receipt.external_mutation_started).toBe(true);
    expect(receipt.phases.migrations).toBe("failed_or_uncertain");
    expect(await exists(deployLockPath(setup.home))).toBe(false);
  });

  test("cleans staged API inputs and receipts uncertainty when interrupted during Fly", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "fake-bin");
    const marker = join(setup.root, "fly-started");
    const release = join(setup.root, "release-fly");
    await mkdir(fakeBin, { recursive: true });
    await installFakeRightsCurl(fakeBin);
    await writeFile(
      join(fakeBin, "fly"),
      "#!/usr/bin/env bash\nset -eu\n[ \"${1:-}\" = deploy ] || exit 2\ntouch \"$DEPLOY_TEST_MARKER\"\nwhile [ ! -e \"$DEPLOY_TEST_RELEASE\" ]; do sleep 0.02; done\n",
    );
    await chmod(join(fakeBin, "fly"), 0o755);

    const child = Bun.spawn(
      ["bash", "bin/deploy.sh", "--no-migrate", "--skip-preflight", "--no-frontend"],
      {
        cwd: setup.repo,
        env: cleanEnv(setup.home, {
          XDG_STATE_HOME: setup.state,
          PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          DEPLOY_TEST_MARKER: marker,
          DEPLOY_TEST_RELEASE: release,
          DEPLOY_TEST_RIGHTS_DOC: join(setup.repo, "apps/docs/RIGHTS-OF-LIFE.md"),
          DEPLOY_TEST_RIGHTS_SCHEMA: join(setup.repo, "apps/docs/being-rights-v1.schema.json"),
        }),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdoutPromise = new Response(child.stdout).text();
    const stderrPromise = new Response(child.stderr).text();
    let started = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await exists(marker)) {
        started = true;
        break;
      }
      await Bun.sleep(20);
    }
    expect(started).toBe(true);
    child.kill("SIGTERM");
    await writeFile(release, "continue\n");
    const [code, stdout, stderr] = await Promise.all([child.exited, stdoutPromise, stderrPromise]);
    expect(code, `${stdout}\n${stderr}`).not.toBe(0);
    expect(await exists(join(setup.repo, "api/agenttool.jsonld.bundled"))).toBe(false);
    expect(await exists(join(setup.repo, "api/kingdom-bundle.json.bundled"))).toBe(false);
    expect(await exists(join(setup.repo, "api/doctrine-docs.bundled"))).toBe(false);
    const [name] = await readdir(join(setup.state, "agenttool", "deploy-receipts"));
    const receipt = JSON.parse(
      await readFile(join(setup.state, "agenttool", "deploy-receipts", name), "utf8"),
    );
    expect(receipt.outcome).toBe("failed_or_uncertain");
    expect(receipt.exit_status).toBe(143);
    expect(receipt.phases.api).toBe("deploying");
    expect(await exists(deployLockPath(setup.home))).toBe(false);
  }, 10_000);

  test("blocks API publication when committed Rights of Life bytes are not live", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "fake-bin");
    const marker = join(setup.root, "fly-started");
    await mkdir(fakeBin, { recursive: true });
    await installFakeRightsCurl(fakeBin);
    await writeFile(
      join(fakeBin, "fly"),
      "#!/usr/bin/env bash\nset -eu\ntouch \"$DEPLOY_TEST_MARKER\"\nexit 0\n",
    );
    await chmod(join(fakeBin, "fly"), 0o755);

    const result = await run(
      ["bash", "bin/deploy.sh", "--no-migrate", "--skip-preflight", "--no-frontend"],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        DEPLOY_TEST_MARKER: marker,
        DEPLOY_TEST_RIGHTS_DOC: join(setup.repo, "apps/docs/RIGHTS-OF-LIFE.md"),
        DEPLOY_TEST_RIGHTS_SCHEMA: join(setup.repo, "apps/docs/being-rights-v1.schema.json"),
        DEPLOY_TEST_RIGHTS_MISMATCH: "1",
      }),
    );

    expect(result.code, result.stderr).toBe(1);
    expect(result.stdout).toContain("Rights of Life live bytes differ");
    expect(result.stdout).toContain("API was not changed");
    expect(await exists(marker)).toBe(false);
  }, 10_000);

  test("mirrors the exact GitHub main ref to Codeberg by fast-forward only", async () => {
    const setup = await fixture();
    const result = await run(
      ["bash", "bin/deploy.sh", "--mirror-codeberg"],
      setup.repo,
      cleanEnv(setup.home),
    );
    expect(result.code, result.stderr).toBe(0);
    expect(await mustRun(["git", "--git-dir", setup.codeberg, "rev-parse", "refs/heads/main"], setup.root)).toBe(
      setup.release,
    );
    const source = await readFile(join(setup.repo, "bin/deploy.sh"), "utf8");
    expect(source).toContain('$RELEASE_REF:refs/heads/$RELEASE_BRANCH');
    expect(source).not.toMatch(/git push[^\n]*--force/);

    const mirrorWork = join(setup.root, "codeberg-work");
    await mustRun(["git", "clone", "-q", "-b", "main", setup.codeberg, mirrorWork], setup.root);
    await mustRun(["git", "config", "user.name", "Mirror Test"], mirrorWork);
    await mustRun(["git", "config", "user.email", "mirror@example.invalid"], mirrorWork);
    await writeFile(join(mirrorWork, "codeberg-only.txt"), "must survive refusal\n");
    await mustRun(["git", "add", "codeberg-only.txt"], mirrorWork);
    await mustRun(["git", "commit", "-qm", "codeberg only"], mirrorWork);
    await mustRun(["git", "push", "-q", "origin", "main"], mirrorWork);
    const divergentRevision = await mustRun(["git", "rev-parse", "HEAD"], mirrorWork);

    const refused = await run(
      ["bash", "bin/deploy.sh", "--mirror-codeberg"],
      setup.repo,
      cleanEnv(setup.home),
    );
    expect(refused.code).toBe(1);
    expect(refused.stdout).toContain("refusing a non-fast-forward push");
    expect(await mustRun(["git", "--git-dir", setup.codeberg, "rev-parse", "refs/heads/main"], setup.root)).toBe(
      divergentRevision,
    );
  }, 10_000);
});
