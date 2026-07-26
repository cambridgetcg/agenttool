import { afterAll, describe, expect, test } from "bun:test";
import { access, chmod, copyFile, link, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
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
    DATABASE_URL: "postgres://fixture.invalid/release_test",
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
    mkdir(join(repo, "apps", "docs", "specs"), { recursive: true }),
    mkdir(join(repo, "docs", "specs"), { recursive: true }),
    mkdir(join(repo, "apps", "_shared"), { recursive: true }),
    mkdir(join(repo, "apps", "dashboard"), { recursive: true }),
    mkdir(join(repo, "apps", "web"), { recursive: true }),
    mkdir(join(repo, "infra", "pages"), { recursive: true }),
    mkdir(join(repo, "packages", "data", "schema"), { recursive: true }),
    mkdir(join(repo, "packages", "repo-archive", "schema"), { recursive: true }),
    mkdir(join(repo, "packages", "repo-archive", "vectors"), { recursive: true }),
    mkdir(join(repo, "packages", "wallet", "schema"), { recursive: true }),
    mkdir(
      join(repo, "apps", "docs", "packages", "v1", "@agenttool", "fixture", "1.0.0"),
      { recursive: true },
    ),
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
  await Promise.all([
    copyFile(
      join(projectRoot, "bin/frontend-release-paths.txt"),
      join(repo, "bin/frontend-release-paths.txt"),
    ),
    copyFile(
      join(projectRoot, "bin/stage-frontend-release.sh"),
      join(repo, "bin/stage-frontend-release.sh"),
    ),
  ]);
  await Promise.all([
    chmod(join(repo, "bin/deploy.sh"), 0o755),
    chmod(join(repo, "bin/stage-frontend-release.sh"), 0o755),
  ]);
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
    "#!/usr/bin/env bash\nset -eu\nif [ -n \"${DEPLOY_TEST_FRONTEND_MARKER:-}\" ]; then touch \"$DEPLOY_TEST_FRONTEND_MARKER\"; fi\nif [ -n \"${DEPLOY_TEST_FRONTEND_COUNTER:-}\" ]; then count=0; [ ! -f \"$DEPLOY_TEST_FRONTEND_COUNTER\" ] || count=\"$(cat \"$DEPLOY_TEST_FRONTEND_COUNTER\")\"; printf '%s\\n' \"$((count + 1))\" > \"$DEPLOY_TEST_FRONTEND_COUNTER\"; fi\nif [ -n \"${DEPLOY_TEST_FRONTEND_ARGS:-}\" ]; then { printf 'call'; for arg in \"$@\"; do printf '\\t%s' \"$arg\"; done; printf '\\n'; } >> \"$DEPLOY_TEST_FRONTEND_ARGS\"; fi\nif [ -n \"${DEPLOY_TEST_RELEASE_ORDER:-}\" ]; then { printf 'frontend'; for arg in \"$@\"; do printf '\\t%s' \"$arg\"; done; printf '\\n'; } >> \"$DEPLOY_TEST_RELEASE_ORDER\"; fi\nif [ -n \"${DEPLOY_TEST_FRONTEND_REVISION_LOG:-}\" ]; then { printf '%s' \"${AGENTTOOL_FRONTEND_RELEASE_REVISION:-<unset>}\"; for arg in \"$@\"; do printf '\\t%s' \"$arg\"; done; printf '\\n'; } >> \"$DEPLOY_TEST_FRONTEND_REVISION_LOG\"; fi\nfor arg in \"$@\"; do if [ -n \"${DEPLOY_TEST_FRONTEND_FAIL_TARGET:-}\" ] && [ \"$arg\" = \"$DEPLOY_TEST_FRONTEND_FAIL_TARGET\" ]; then exit 17; fi; done\nfor arg in \"$@\"; do if [ \"$arg\" = web ] && [ -n \"${DEPLOY_TEST_FRONTEND_HEAD_MOVE_TO:-}\" ]; then git update-ref refs/heads/main \"$DEPLOY_TEST_FRONTEND_HEAD_MOVE_TO\"; fi; if [ \"$arg\" = docs ] && [ -n \"${DEPLOY_TEST_FRONTEND_HEAD_RESTORE_TO:-}\" ]; then git update-ref refs/heads/main \"$DEPLOY_TEST_FRONTEND_HEAD_RESTORE_TO\"; fi; done\n",
  );
  await chmod(join(repo, "bin/frontend-deploy.sh"), 0o755);
  await writeFile(join(repo, "docs/agenttool.jsonld"), "{}\n");
  await writeFile(join(repo, "docs/kingdom-bundle.json"), "{}\n");
  await Promise.all([
    writeFile(join(repo, "apps/_shared/.fixture"), "fixture\n"),
    writeFile(join(repo, "apps/dashboard/.fixture"), "fixture\n"),
    writeFile(join(repo, "infra/pages/.fixture"), "fixture\n"),
    writeFile(join(repo, "packages/data/schema/.fixture"), "fixture\n"),
    writeFile(join(repo, "packages/repo-archive/schema/.fixture"), "fixture\n"),
    writeFile(join(repo, "packages/repo-archive/vectors/.fixture"), "fixture\n"),
    writeFile(join(repo, "packages/wallet/schema/.fixture"), "fixture\n"),
  ]);
  await writeFile(join(repo, "docs/RIGHTS-OF-LIFE.md"), "rights fixture\n");
  await writeFile(
    join(repo, "docs/specs/being-rights-v1.schema.json"),
    '{"fixture":"being-rights/v1"}\n',
  );
  await symlink(
    "../../docs/RIGHTS-OF-LIFE.md",
    join(repo, "apps/docs/RIGHTS-OF-LIFE.md"),
  );
  await symlink(
    "../../docs/specs/being-rights-v1.schema.json",
    join(repo, "apps/docs/being-rights-v1.schema.json"),
  );
  await writeFile(
    join(repo, "apps/docs/AGENT-REPO-ARCHIVE.md"),
    "# Repo Archive fixture\n",
  );
  await writeFile(
    join(repo, "apps/docs/specs/AGENT-REPO-ARCHIVE-0.1.md"),
    "# Repo Archive 0.1 fixture\n",
  );
  await writeFile(
    join(repo, "apps/docs/specs/agent-repo-archive-0.1.schema.json"),
    '{"fixture":"agent-repo-archive-schema"}\n',
  );
  await writeFile(
    join(repo, "apps/docs/specs/agent-repo-archive-0.1-vectors.json"),
    '{"fixture":"agent-repo-archive-vectors"}\n',
  );
  await Promise.all([
    writeFile(join(repo, "apps/web/party.html"), "Lantern Relay fixture\n"),
    writeFile(join(repo, "apps/web/party.json"), '{"fixture":"lantern-relay"}\n'),
    writeFile(join(repo, "apps/web/party.js"), "/* Lantern Relay fixture */\n"),
    writeFile(join(repo, "apps/web/party.css"), "/* Lantern Relay fixture */\n"),
    writeFile(join(repo, "apps/web/sky.html"), "Pocket Sky fixture\n"),
    writeFile(join(repo, "apps/web/sky.json"), '{"fixture":"pocket-sky"}\n'),
    writeFile(join(repo, "apps/web/sky.js"), "/* Pocket Sky fixture */\n"),
    writeFile(join(repo, "apps/web/sky.css"), "/* Pocket Sky fixture */\n"),
  ]);
  await writeFile(
    join(repo, "apps/docs/packages/v1/index.json"),
    `${JSON.stringify({
      packages: [
        {
          name: "@agenttool/fixture",
          latest: "1.0.0",
          versions: [
            {
              version: "1.0.0",
              manifest_url:
                "https://docs.agenttool.dev/packages/v1/@agenttool/fixture/1.0.0/manifest.json",
            },
          ],
        },
      ],
    })}\n`,
  );
  await writeFile(
    join(repo, "apps/docs/packages/v1/@agenttool/fixture/1.0.0/manifest.json"),
    `${JSON.stringify({
      artifact: {
        filename: "agenttool-fixture-1.0.0.tgz",
        mirrors: [
          {
            url:
              "https://docs.agenttool.dev/packages/v1/@agenttool/fixture/1.0.0/agenttool-fixture-1.0.0.tgz",
          },
        ],
      },
    })}\n`,
  );
  await writeFile(
    join(
      repo,
      "apps/docs/packages/v1/@agenttool/fixture/1.0.0/agenttool-fixture-1.0.0.tgz",
    ),
    "fixture archive bytes\n",
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
curlrc_location=0
if [ "\${1:-}" != "-q" ] && [ -f "\${HOME}/.curlrc" ] &&
   grep -Eq '^[[:space:]]*(--)?location([[:space:]]|=|$)' "\${HOME}/.curlrc"; then
  curlrc_location=1
fi
for arg in "$@"; do
  if [ "$previous" = "-D" ] && [ "$arg" = "-" ]; then headers=1; fi
  previous="$arg"
  case "$arg" in https://*) url="$arg" ;; esac
done
if [ "$headers" = 1 ]; then
  case "$url" in
    */party)
      [ "\${DEPLOY_TEST_GAME_STATUS_FAILURE:-0}" != 1 ] || exit 22
      status='HTTP/2 200'
      surface='local-party-game'
      if [ "\${DEPLOY_TEST_GAME_REDIRECT:-0}" = 1 ] && [ "$curlrc_location" != 1 ]; then
        status='HTTP/2 302'
      fi
      [ "\${DEPLOY_TEST_GAME_HEADER_MISMATCH:-0}" != 1 ] || surface='wrong-party-surface'
      printf '%s\r\n' \
        "$status" \
        'cache-control: public, max-age=0, must-revalidate' \
        "content-security-policy: default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; media-src 'none'; object-src 'none'; worker-src 'none'; child-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests" \
        'referrer-policy: no-referrer' \
        'link: <https://agenttool.dev/party.json>; rel="alternate"; type="application/json", <https://api.agenttool.dev/public/play>; rel="related"; type="application/json"' \
        "x-agent-surface: $surface" \
        ''
      ;;
    */party.json)
      printf '%s\r\n' \
        'HTTP/2 200' \
        'cache-control: public, max-age=0, must-revalidate' \
        'access-control-allow-origin: *' \
        'x-agent-surface: local-party-rules' \
        ''
      ;;
    */party.js|*/party.css|*/sky.js|*/sky.css)
      printf '%s\r\n' 'HTTP/2 200' ''
      ;;
    */room)
      printf '%s\r\n' \
        'HTTP/2 200' \
        'cache-control: public, max-age=0, must-revalidate' \
        "content-security-policy: default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; media-src 'none'; object-src 'none'; worker-src 'none'; child-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests" \
        'referrer-policy: no-referrer' \
        'link: <https://agenttool.dev/room.json>; rel="alternate"; type="application/json", <https://api.agenttool.dev/public/play>; rel="related"; type="application/json"' \
        'x-agent-surface: local-room-game' \
        ''
      ;;
    */room.json)
      printf '%s\r\n' \
        'HTTP/2 200' \
        'cache-control: public, max-age=0, must-revalidate' \
        'access-control-allow-origin: *' \
        'x-agent-surface: local-room-rules' \
        ''
      ;;
    */sky)
      printf '%s\r\n' \
        'HTTP/2 200' \
        'cache-control: public, max-age=0, must-revalidate' \
        "content-security-policy: default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; media-src 'none'; object-src 'none'; worker-src 'none'; child-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests" \
        'referrer-policy: no-referrer' \
        'link: <https://agenttool.dev/sky.json>; rel="alternate"; type="application/json", <https://api.agenttool.dev/public/play>; rel="related"; type="application/json"' \
        'x-agent-surface: local-pocket-sky-game' \
        ''
      ;;
    */sky.json)
      printf '%s\r\n' \
        'HTTP/2 200' \
        'cache-control: public, max-age=0, must-revalidate' \
        'access-control-allow-origin: *' \
        'x-agent-surface: local-pocket-sky-rules' \
        ''
      ;;
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
else
  case "$url" in
    */party)
      [ "\${DEPLOY_TEST_GAME_MISMATCH:-0}" != 1 ] || { printf 'mismatched game bytes\n'; exit 0; }
      git show HEAD:apps/web/party.html
      ;;
    */party.json)
      git show HEAD:apps/web/party.json
      ;;
    */party.js)
      git show HEAD:apps/web/party.js
      ;;
    */party.css)
      git show HEAD:apps/web/party.css
      ;;
    */sky)
      [ "\${DEPLOY_TEST_GAME_MISMATCH:-0}" != 1 ] || { printf 'mismatched game bytes\n'; exit 0; }
      git show HEAD:apps/web/sky.html
      ;;
    */sky.json)
      git show HEAD:apps/web/sky.json
      ;;
    */sky.js)
      git show HEAD:apps/web/sky.js
      ;;
    */sky.css)
      git show HEAD:apps/web/sky.css
      ;;
    */RIGHTS-OF-LIFE.md)
      [ "\${DEPLOY_TEST_RIGHTS_MISMATCH:-0}" != 1 ] || { printf 'mismatched bytes\n'; exit 0; }
      if [ -n "\${DEPLOY_TEST_RIGHTS_COUNTER:-}" ]; then
        count=0
        [ ! -f "$DEPLOY_TEST_RIGHTS_COUNTER" ] || count="$(cat "$DEPLOY_TEST_RIGHTS_COUNTER")"
        count=$((count + 1))
        printf '%s\n' "$count" > "$DEPLOY_TEST_RIGHTS_COUNTER"
        if [ "$count" -le "\${DEPLOY_TEST_STALE_RIGHTS_RESPONSES:-0}" ]; then
          printf 'stale Rights bytes\n'
          exit 0
        fi
      fi
      git show HEAD:docs/RIGHTS-OF-LIFE.md
      ;;
    */being-rights-v1.schema.json)
      [ "\${DEPLOY_TEST_RIGHTS_MISMATCH:-0}" != 1 ] || { printf 'mismatched bytes\n'; exit 0; }
      git show HEAD:docs/specs/being-rights-v1.schema.json
      ;;
    *) exit 2 ;;
  esac
fi
`,
  );
  await chmod(join(fakeBin, "curl"), 0o755);
  await writeFile(join(fakeBin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  await chmod(join(fakeBin, "sleep"), 0o755);
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
serve_path() {
  if [ "\${DEPLOY_TEST_PAGES_FROM_COMMIT:-0}" = 1 ]; then
    git show "HEAD:$1"
  else
    cat "$1"
  fi
}

case "$url" in
  */packages/v1/@agenttool/fixture/1.0.0/manifest.json)
    if [ "$headers" = 1 ]; then
      printf '%s\r\n' \
        'HTTP/2 200' \
        'content-type: application/json; charset=utf-8' \
        'cache-control: public, max-age=300, must-revalidate' \
        'access-control-allow-origin: *' \
        'x-content-type-options: nosniff' \
        ''
    else
      cat apps/docs/packages/v1/@agenttool/fixture/1.0.0/manifest.json
    fi
    ;;
  */packages/v1/@agenttool/fixture/1.0.0/agenttool-fixture-1.0.0.tgz)
    if [ "$headers" = 1 ]; then
      if [ "\${DEPLOY_TEST_BAD_LOVE_HEADERS:-0}" = 1 ]; then
        content_type='application/octet-stream'
        cache_control='public, max-age=0, must-revalidate'
      else
        content_type='application/gzip'
        cache_control='public, max-age=31536000, immutable'
      fi
      printf '%s\r\n' \
        'HTTP/2 200' \
        "content-type: $content_type" \
        "cache-control: $cache_control" \
        'access-control-allow-origin: *' \
        'x-content-type-options: nosniff' \
        ''
    else
      cat apps/docs/packages/v1/@agenttool/fixture/1.0.0/agenttool-fixture-1.0.0.tgz
    fi
    ;;
  */AGENT-REPO-ARCHIVE.md)
    if [ "$headers" = 1 ]; then
      printf '%s\r\n' \
        'HTTP/2 200' \
        'content-type: text/markdown; charset=utf-8' \
        'cache-control: public, max-age=300, must-revalidate' \
        'access-control-allow-origin: *' \
        'x-content-type-options: nosniff' \
        ''
    else
      cat apps/docs/AGENT-REPO-ARCHIVE.md
    fi
    ;;
  */specs/AGENT-REPO-ARCHIVE-0.1.md)
    if [ "$headers" = 1 ]; then
      printf '%s\r\n' \
        'HTTP/2 200' \
        'content-type: text/markdown; charset=utf-8' \
        'cache-control: public, max-age=300, must-revalidate' \
        'access-control-allow-origin: *' \
        'x-content-type-options: nosniff' \
        ''
    else
      cat apps/docs/specs/AGENT-REPO-ARCHIVE-0.1.md
    fi
    ;;
  */specs/agent-repo-archive-0.1.schema.json)
    if [ "$headers" = 1 ]; then
      printf '%s\r\n' \
        'HTTP/2 200' \
        'content-type: application/schema+json; charset=utf-8' \
        'cache-control: public, max-age=300, must-revalidate' \
        'access-control-allow-origin: *' \
        'x-content-type-options: nosniff' \
        ''
    else
      cat apps/docs/specs/agent-repo-archive-0.1.schema.json
    fi
    ;;
  */specs/agent-repo-archive-0.1-vectors.json)
    if [ "$headers" = 1 ]; then
      printf '%s\r\n' \
        'HTTP/2 200' \
        'content-type: application/json; charset=utf-8' \
        'cache-control: public, max-age=300, must-revalidate' \
        'access-control-allow-origin: *' \
        'x-content-type-options: nosniff' \
        ''
    else
      cat apps/docs/specs/agent-repo-archive-0.1-vectors.json
    fi
    ;;
  */party)
    if [ "$headers" = 1 ]; then
      printf '%s\r\n' \
        'HTTP/2 200' \
        'cache-control: public, max-age=0, must-revalidate' \
        "content-security-policy: default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; media-src 'none'; object-src 'none'; worker-src 'none'; child-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests" \
        'referrer-policy: no-referrer' \
        'link: <https://agenttool.dev/party.json>; rel="alternate"; type="application/json", <https://api.agenttool.dev/public/play>; rel="related"; type="application/json"' \
        'x-agent-surface: local-party-game' \
        ''
    else
      serve_path apps/web/party.html
    fi
    ;;
  */party.json)
    if [ "$headers" = 1 ]; then
      printf '%s\r\n' \
        'HTTP/2 200' \
        'cache-control: public, max-age=0, must-revalidate' \
        'access-control-allow-origin: *' \
        'x-agent-surface: local-party-rules' \
        ''
    else
      serve_path apps/web/party.json
    fi
    ;;
  */party.js)
    serve_path apps/web/party.js
    ;;
  */party.css)
    serve_path apps/web/party.css
    ;;
  */room)
    printf '%s\r\n' \
      'HTTP/2 200' \
      'cache-control: public, max-age=0, must-revalidate' \
      "content-security-policy: default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; media-src 'none'; object-src 'none'; worker-src 'none'; child-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests" \
      'referrer-policy: no-referrer' \
      'link: <https://agenttool.dev/room.json>; rel="alternate"; type="application/json", <https://api.agenttool.dev/public/play>; rel="related"; type="application/json"' \
      'x-agent-surface: local-room-game' \
      ''
    ;;
  */room.json)
    printf '%s\r\n' \
      'HTTP/2 200' \
      'cache-control: public, max-age=0, must-revalidate' \
      'access-control-allow-origin: *' \
      'x-agent-surface: local-room-rules' \
      ''
    ;;
  */sky)
    if [ "$headers" = 1 ]; then
      printf '%s\r\n' \
        'HTTP/2 200' \
        'cache-control: public, max-age=0, must-revalidate' \
        "content-security-policy: default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; media-src 'none'; object-src 'none'; worker-src 'none'; child-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests" \
        'referrer-policy: no-referrer' \
        'link: <https://agenttool.dev/sky.json>; rel="alternate"; type="application/json", <https://api.agenttool.dev/public/play>; rel="related"; type="application/json"' \
        'x-agent-surface: local-pocket-sky-game' \
        ''
    else
      serve_path apps/web/sky.html
    fi
    ;;
  */sky.json)
    if [ "$headers" = 1 ]; then
      printf '%s\r\n' \
        'HTTP/2 200' \
        'cache-control: public, max-age=0, must-revalidate' \
        'access-control-allow-origin: *' \
        'x-agent-surface: local-pocket-sky-rules' \
        ''
    else
      serve_path apps/web/sky.json
    fi
    ;;
  */sky.js)
    serve_path apps/web/sky.js
    ;;
  */sky.css)
    if [ -n "\${DEPLOY_TEST_GAME_FETCH_LOG:-}" ]; then
      printf '%s\n' "$url" >> "$DEPLOY_TEST_GAME_FETCH_LOG"
    fi
    serve_path apps/web/sky.css
    ;;
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
      serve_path docs/RIGHTS-OF-LIFE.md
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
      serve_path docs/specs/being-rights-v1.schema.json
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
    expect(dockerfile).toContain("test -s src/index.ts");
    expect(dockerfile).toContain("find src -type f -name '*.ts' -size 0");
    expect(deploy).toContain('--build-arg "AGENTTOOL_GIT_REVISION=$HEAD_REVISION"');
    expect(deploy).toContain('--build-arg "AGENTTOOL_SOURCE_DIRTY=$API_SOURCE_DIRTY"');
    expect(deploy).toContain("FLY_DEPLOY_ARGS+=(--no-cache)");
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

  test("accepts the explicit OAuth fallback and forwards it to both frontend deploy passes", async () => {
    const prerequisite = await fixture();
    const prerequisiteBin = join(prerequisite.root, "oauth-prerequisite-bin");
    const prerequisiteArgs = join(prerequisite.root, "oauth-prerequisite-args");
    await mkdir(prerequisiteBin, { recursive: true });
    await installFakeRightsCurl(prerequisiteBin);
    await writeFile(
      join(prerequisiteBin, "fly"),
      "#!/usr/bin/env bash\nexit 9\n",
    );
    await chmod(join(prerequisiteBin, "fly"), 0o755);

    const help = await run(
      ["bash", "bin/deploy.sh", "--help"],
      prerequisite.repo,
      cleanEnv(prerequisite.home),
    );
    expect(help.code, help.stderr).toBe(0);
    expect(help.stdout).toContain(
      "bin/deploy.sh --oauth-fallback         # explicit Cloudflare OAuth fallback",
    );
    expect(help.stdout).not.toContain("set -uo pipefail");

    const prerequisiteResult = await run(
      [
        "bash",
        "bin/deploy.sh",
        "--no-migrate",
        "--skip-preflight",
        "--oauth-fallback",
      ],
      prerequisite.repo,
      cleanEnv(prerequisite.home, {
        XDG_STATE_HOME: prerequisite.state,
        PATH: `${prerequisiteBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        DEPLOY_TEST_FRONTEND_ARGS: prerequisiteArgs,
        DEPLOY_TEST_RIGHTS_DOC: join(
          prerequisite.repo,
          "apps/docs/RIGHTS-OF-LIFE.md",
        ),
        DEPLOY_TEST_RIGHTS_SCHEMA: join(
          prerequisite.repo,
          "apps/docs/being-rights-v1.schema.json",
        ),
      }),
    );
    expect(prerequisiteResult.code).toBe(1);
    expect(await readFile(prerequisiteArgs, "utf8")).toBe(
      "call\t--oauth-fallback\tweb\ncall\t--oauth-fallback\tdocs\n",
    );

    const remaining = await fixture();
    const remainingBin = join(remaining.root, "oauth-remaining-bin");
    const remainingArgs = join(remaining.root, "oauth-remaining-args");
    const fenceCounter = join(remaining.root, "oauth-fence-counter");
    await mkdir(remainingBin, { recursive: true });
    await installFakePagesVerificationTools(remainingBin);

    const remainingResult = await run(
      [
        "bash",
        "bin/deploy.sh",
        "--no-migrate",
        "--skip-preflight",
        "--no-api",
        "--oauth-fallback",
      ],
      remaining.repo,
      cleanEnv(remaining.home, {
        XDG_STATE_HOME: remaining.state,
        PATH: `${remainingBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        DEPLOY_TEST_FRONTEND_ARGS: remainingArgs,
        DEPLOY_TEST_FENCE_COUNTER: fenceCounter,
        DEPLOY_TEST_RIGHTS_DOC: join(
          remaining.repo,
          "apps/docs/RIGHTS-OF-LIFE.md",
        ),
        DEPLOY_TEST_RIGHTS_SCHEMA: join(
          remaining.repo,
          "apps/docs/being-rights-v1.schema.json",
        ),
      }),
    );
    expect(
      remainingResult.code,
      `${remainingResult.stdout}\n${remainingResult.stderr}`,
    ).toBe(0);
    expect(await readFile(remainingArgs, "utf8")).toBe(
      "call\t--oauth-fallback\tdocs\tdashboard\tweb\n",
    );
  }, 20_000);

  test("passes a one-shot no-cache recovery only to Fly and rejects contradictory modes", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "fake-no-cache-bin");
    const flyArgs = join(setup.root, "fly-args");
    await mkdir(fakeBin, { recursive: true });
    await installFakeRightsCurl(fakeBin);
    await writeFile(
      join(fakeBin, "fly"),
      "#!/usr/bin/env bash\nset -eu\nprintf '%s\\n' \"$@\" > \"$DEPLOY_TEST_FLY_ARGS\"\nexit 9\n",
    );
    await chmod(join(fakeBin, "fly"), 0o755);

    const result = await run(
      [
        "bash",
        "bin/deploy.sh",
        "--no-migrate",
        "--skip-preflight",
        "--no-frontend",
        "--no-cache-api",
      ],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        DEPLOY_TEST_FLY_ARGS: flyArgs,
        DEPLOY_TEST_RIGHTS_DOC: join(setup.repo, "apps/docs/RIGHTS-OF-LIFE.md"),
        DEPLOY_TEST_RIGHTS_SCHEMA: join(setup.repo, "apps/docs/being-rights-v1.schema.json"),
      }),
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      "API image build cache bypassed for this invocation (--no-cache)",
    );
    const args = (await readFile(flyArgs, "utf8")).trim().split("\n");
    expect(args).toEqual([
      "deploy",
      "--strategy",
      "rolling",
      "--no-cache",
      "--build-arg",
      `AGENTTOOL_GIT_REVISION=${setup.release}`,
      "--build-arg",
      "AGENTTOOL_SOURCE_DIRTY=false",
    ]);
    expect(await exists(join(setup.repo, "api/agenttool.jsonld.bundled"))).toBe(false);
    expect(await exists(join(setup.repo, "api/kingdom-bundle.json.bundled"))).toBe(false);
    expect(await exists(join(setup.repo, "api/doctrine-docs.bundled"))).toBe(false);
    const [receiptName] = await readdir(join(setup.state, "agenttool", "deploy-receipts"));
    const receipt = JSON.parse(
      await readFile(
        join(setup.state, "agenttool", "deploy-receipts", receiptName),
        "utf8",
      ),
    );
    expect(receipt.schema).toBe("agenttool-deploy-receipt/v3");
    expect(receipt.api_build).toEqual({ cache: "bypassed" });

    for (const contradictoryArgs of [
      ["--no-cache-api", "--no-api"],
      ["--no-cache-api", "--survey"],
      ["--no-cache-api", "--mirror-codeberg"],
    ]) {
      const contradictory = await run(
        ["bash", "bin/deploy.sh", ...contradictoryArgs],
        setup.repo,
        cleanEnv(setup.home),
      );
      expect(contradictory.code).toBe(1);
    }
  }, 10_000);

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

  test("never steals a stale lock and keeps survey, dry-run, and the mirror refusal lock-free", async () => {
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
    // The retired mirror flag refuses rather than deploying, so like --survey
    // and --dry-run it must not contend for the device-local deploy lock.
    const mirror = await run(
      ["bash", "bin/deploy.sh", "--mirror-codeberg"],
      setup.repo,
      cleanEnv(setup.home),
    );
    expect(mirror.code).toBe(1);
    expect(mirror.stdout).toContain("retired");
    expect(mirror.stdout).not.toContain("another deploy");

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

  test("keeps scoped-package reference pages byte-identical at the edge", async () => {
    const [deploy, headers] = await Promise.all([
      readFile(join(projectRoot, "bin/deploy.sh"), "utf8"),
      readFile(join(projectRoot, "apps/docs/_headers"), "utf8"),
    ]);

    expect(deploy).toContain(
      '"apps/docs/index.html|https://docs.agenttool.dev/"',
    );
    expect(headers).toMatch(
      /\n\/\n(?:  [^\n]+\n)*?  Cache-Control: public, max-age=0, must-revalidate, no-transform/,
    );

    for (const page of [
      "browser",
      "data",
      "packages",
      "pathways",
      "tutorial",
      "whitehack",
    ]) {
      expect(deploy).toContain(
        `"apps/docs/${page}.html|https://docs.agenttool.dev/${page}"`,
      );
      expect(headers).toMatch(
        new RegExp(
          `/${page}\\n(?:  [^\\n]+\\n)*?  Cache-Control: public, max-age=0, must-revalidate, no-transform`,
        ),
      );
    }
  });

  test("requires changed game inputs and verifies every local game header row", async () => {
    const deploy = await readFile(join(projectRoot, "bin/deploy.sh"), "utf8");
    const gameAssets = [
      ["party.html", "party"],
      ["party.json", "party.json"],
      ["party.js", "party.js"],
      ["party.css", "party.css"],
      ["sky.html", "sky"],
      ["sky.json", "sky.json"],
      ["sky.js", "sky.js"],
      ["sky.css", "sky.css"],
    ];

    for (const [asset, remote] of gameAssets) {
      expect(deploy).toContain(
        `"apps/web/${asset}|https://agenttool.dev/${remote}"`,
      );
    }

    expect(deploy).toMatch(
      /REQUIRED_GAME_PUBLICATIONS=\([\s\S]*apps\/web\/party\.html[\s\S]*apps\/web\/party\.json[\s\S]*apps\/web\/party\.js[\s\S]*apps\/web\/party\.css[\s\S]*apps\/web\/sky\.html[\s\S]*apps\/web\/sky\.json[\s\S]*apps\/web\/sky\.js[\s\S]*apps\/web\/sky\.css[\s\S]*\)/,
    );
    expect(deploy.match(/REQUIRED_GAME_PUBLICATIONS=\(/g)).toHaveLength(1);
    expect(
      deploy.match(
        /Required committed frontend release input is missing: \$local_path/g,
      ),
    ).toHaveLength(1);
    expect(deploy).toContain(
      "Required committed frontend release input is missing: $local_path",
    );
    expect(deploy).toContain(
      '"$HEAD_REVISION" "$FRONTEND_RELEASE_STAGE_ROOT"',
    );
    expect(deploy).toContain('portable_md5_file "$staged_path"');
    expect(deploy).not.toContain('git show "$HEAD_REVISION:$1"');
    expect(deploy).toContain(
      '"party|Lantern Relay|local-party-game|local-party-rules"',
    );
    expect(deploy).toContain(
      '"room|ROOM ∞|local-room-game|local-room-rules"',
    );
    expect(deploy).toContain(
      '"sky|Pocket Sky|local-pocket-sky-game|local-pocket-sky-rules"',
    );
    expect(deploy).toContain('"X-Agent-Surface" "$game_surface"');
    expect(deploy).toContain('"X-Agent-Surface" "$rules_surface"');
  });

  test("keeps release probes independent of curlrc and gives Rights one retry budget", async () => {
    const deploy = await readFile(join(projectRoot, "bin/deploy.sh"), "utf8");
    const rightsStart = deploy.indexOf("verify_rights_static_bytes()");
    const rightsEnd = deploy.indexOf("verify_rights_static_publication()");
    const rightsVerifier = deploy.slice(rightsStart, rightsEnd);

    expect(deploy).toContain('command curl -q "$@"');
    expect(deploy.match(/^[ \t]*curl\b/gm)).toBeNull();
    expect(rightsVerifier).toContain("release_curl -fsS --max-time 20");
    expect(rightsVerifier).not.toContain("--retry");
  });

  test("refuses a missing game input before any production mutation", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "missing-game-input-bin");
    const migrationMarker = join(setup.root, "migration-ran");
    const preflightMarker = join(setup.root, "preflight-ran");
    const frontendMarker = join(setup.root, "frontend-ran");
    const flyMarker = join(setup.root, "fly-ran");
    await mkdir(fakeBin, { recursive: true });
    await writeFile(
      join(fakeBin, "fly"),
      "#!/usr/bin/env bash\nset -eu\ntouch \"$DEPLOY_TEST_FLY_MARKER\"\n",
    );
    await chmod(join(fakeBin, "fly"), 0o755);
    await unlink(join(setup.repo, "apps/web/sky.css"));
    await mustRun(["git", "add", "-u", "apps/web/sky.css"], setup.repo);
    await mustRun(["git", "commit", "-qm", "remove required game input"], setup.repo);
    await mustRun(["git", "push", "-q", "github", "main"], setup.repo);

    const result = await run(
      [
        "bash",
        "bin/deploy.sh",
        "--skip-preflight",
      ],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        MIGRATION_MARKER: migrationMarker,
        PREFLIGHT_MARKER: preflightMarker,
        DEPLOY_TEST_FRONTEND_MARKER: frontendMarker,
        DEPLOY_TEST_FLY_MARKER: flyMarker,
      }),
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      "Required committed frontend release input is missing: apps/web/sky.css",
    );
    expect(result.stdout).not.toContain("Phase 1");
    expect(await exists(migrationMarker)).toBe(false);
    expect(await exists(preflightMarker)).toBe(false);
    expect(await exists(frontendMarker)).toBe(false);
    expect(await exists(flyMarker)).toBe(false);
    expect(await exists(deployLockPath(setup.home))).toBe(false);
    expect(await exists(join(setup.state, "agenttool", "deploy-receipts"))).toBe(false);
  }, 10_000);

  test("publishes verified discovery frontends before Fly and leaves dashboard after it", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "release-order-bin");
    const releaseOrder = join(setup.root, "release-order");
    await mkdir(fakeBin, { recursive: true });
    await installFakeRightsCurl(fakeBin);
    await writeFile(
      join(fakeBin, "fly"),
      "#!/usr/bin/env bash\nset -eu\n[ \"${1:-}\" = deploy ] || exit 2\nprintf 'fly\\n' >> \"$DEPLOY_TEST_RELEASE_ORDER\"\n",
    );
    await chmod(join(fakeBin, "fly"), 0o755);

    const result = await run(
      ["bash", "bin/deploy.sh", "--no-migrate", "--skip-preflight"],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        DEPLOY_TEST_RELEASE_ORDER: releaseOrder,
        DEPLOY_TEST_RIGHTS_DOC: join(setup.repo, "apps/docs/RIGHTS-OF-LIFE.md"),
        DEPLOY_TEST_RIGHTS_SCHEMA: join(
          setup.repo,
          "apps/docs/being-rights-v1.schema.json",
        ),
      }),
    );

    expect(result.code).toBe(1);
    expect(await readFile(releaseOrder, "utf8")).toBe(
      "frontend\tweb\nfrontend\tdocs\nfly\nfrontend\tdashboard\n",
    );
    expect(result.stdout).toContain("/health did not return 200");
    const [name] = await readdir(join(setup.state, "agenttool", "deploy-receipts"));
    const receipt = JSON.parse(
      await readFile(join(setup.state, "agenttool", "deploy-receipts", name), "utf8"),
    );
    expect(receipt.outcome).toBe("failed_or_uncertain");
    expect(receipt.phases.api).toBe("deployed_unverified");
    expect(receipt.phases.frontends).toBe("deployed_unverified");
  }, 15_000);

  test("pins split web and docs uploads to the invocation-start revision", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "pinned-frontend-revision-bin");
    const revisionLog = join(setup.root, "pinned-frontend-revisions");
    const flyMarker = join(setup.root, "pinned-frontend-fly-ran");
    const alternateRevision = await mustRun(
      ["git", "rev-parse", "HEAD^"],
      setup.repo,
    );
    await mkdir(fakeBin, { recursive: true });
    await installFakeRightsCurl(fakeBin);
    await writeFile(
      join(fakeBin, "fly"),
      "#!/usr/bin/env bash\nset -eu\ntouch \"$DEPLOY_TEST_FLY_MARKER\"\nexit 9\n",
    );
    await chmod(join(fakeBin, "fly"), 0o755);

    const result = await run(
      ["bash", "bin/deploy.sh", "--no-migrate", "--skip-preflight"],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        DEPLOY_TEST_FLY_MARKER: flyMarker,
        DEPLOY_TEST_FRONTEND_REVISION_LOG: revisionLog,
        DEPLOY_TEST_FRONTEND_HEAD_MOVE_TO: alternateRevision,
        DEPLOY_TEST_FRONTEND_HEAD_RESTORE_TO: setup.release,
      }),
    );

    expect(result.code).toBe(1);
    expect(await readFile(revisionLog, "utf8")).toBe(
      `${setup.release}\tweb\n${setup.release}\tdocs\n`,
    );
    expect(await mustRun(["git", "rev-parse", "HEAD"], setup.repo)).toBe(
      setup.release,
    );
    expect(await exists(flyMarker)).toBe(true);
    expect(result.stdout).toContain("Phase 3 failed.");
  }, 15_000);

  test("a failed web prerequisite stops before docs and Fly", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "failed-web-prerequisite-bin");
    const releaseOrder = join(setup.root, "failed-web-release-order");
    const flyMarker = join(setup.root, "failed-web-fly-ran");
    await mkdir(fakeBin, { recursive: true });
    await writeFile(
      join(fakeBin, "fly"),
      "#!/usr/bin/env bash\nset -eu\ntouch \"$DEPLOY_TEST_FLY_MARKER\"\n",
    );
    await chmod(join(fakeBin, "fly"), 0o755);

    const result = await run(
      ["bash", "bin/deploy.sh", "--no-migrate", "--skip-preflight"],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        DEPLOY_TEST_FRONTEND_FAIL_TARGET: "web",
        DEPLOY_TEST_RELEASE_ORDER: releaseOrder,
        DEPLOY_TEST_FLY_MARKER: flyMarker,
      }),
    );

    expect(result.code).toBe(1);
    expect(await readFile(releaseOrder, "utf8")).toBe("frontend\tweb\n");
    expect(result.stdout).toContain(
      "Phase 3 web prerequisite deploy failed.",
    );
    expect(result.stdout).toContain(
      "Docs and Fly/API deployment did not occur.",
    );
    expect(await exists(flyMarker)).toBe(false);
    const [name] = await readdir(
      join(setup.state, "agenttool", "deploy-receipts"),
    );
    const receipt = JSON.parse(
      await readFile(
        join(setup.state, "agenttool", "deploy-receipts", name),
        "utf8",
      ),
    );
    expect(receipt.outcome).toBe("failed_or_uncertain");
    expect(receipt.phases.api).toBe("not_run");
    expect(receipt.phases.frontends).toBe("failed_or_uncertain");
  }, 10_000);

  test("stale committed game publication blocks Fly with or without a frontend upload", async () => {
    for (const mode of ["coordinated", "no-frontend"] as const) {
      const setup = await fixture();
      const fakeBin = join(setup.root, `${mode}-stale-game-bin`);
      const frontendMarker = join(setup.root, `${mode}-frontend-ran`);
      const flyMarker = join(setup.root, `${mode}-fly-ran`);
      await mkdir(fakeBin, { recursive: true });
      await installFakeRightsCurl(fakeBin);
      await writeFile(
        join(fakeBin, "fly"),
        "#!/usr/bin/env bash\nset -eu\ntouch \"$DEPLOY_TEST_FLY_MARKER\"\n",
      );
      await chmod(join(fakeBin, "fly"), 0o755);
      await writeFile(join(fakeBin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
      await chmod(join(fakeBin, "sleep"), 0o755);

      const args = ["bash", "bin/deploy.sh", "--skip-preflight"];
      if (mode === "coordinated") args.push("--no-migrate");
      else args.push("--no-frontend");
      const result = await run(
        args,
        setup.repo,
        cleanEnv(setup.home, {
          XDG_STATE_HOME: setup.state,
          PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          DEPLOY_TEST_FRONTEND_MARKER: frontendMarker,
          DEPLOY_TEST_FLY_MARKER: flyMarker,
          DEPLOY_TEST_GAME_MISMATCH: "1",
          DEPLOY_TEST_RIGHTS_DOC: join(setup.repo, "apps/docs/RIGHTS-OF-LIFE.md"),
          DEPLOY_TEST_RIGHTS_SCHEMA: join(
            setup.repo,
            "apps/docs/being-rights-v1.schema.json",
          ),
        }),
      );

      expect(result.code).toBe(1);
      expect(result.stdout).toContain(
        "apps/web/party.html (live ≠ committed release)",
      );
      expect(result.stdout).toContain(
        "Discovery prerequisites did not converge after 25 verification attempts",
      );
      expect(result.stdout).toContain("Fly/API deployment did not occur");
      expect(await exists(flyMarker)).toBe(false);
      expect(await exists(frontendMarker)).toBe(mode === "coordinated");
      const [name] = await readdir(
        join(setup.state, "agenttool", "deploy-receipts"),
      );
      const receipt = JSON.parse(
        await readFile(
          join(setup.state, "agenttool", "deploy-receipts", name),
          "utf8",
        ),
      );
      expect(receipt.outcome).toBe("failed_or_uncertain");
      expect(receipt.phases.api).toBe("not_run");
      expect(receipt.phases.frontends).toBe(
        mode === "coordinated"
          ? "discovery_frontends_verification_failed"
          : "skipped",
      );
    }
  }, 30_000);

  test("pre-API Rights verification reads committed bytes under the dirty-release override", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "committed-rights-bin");
    const flyMarker = join(setup.root, "committed-rights-fly-ran");
    expect(
      await readlink(join(setup.repo, "apps/docs/RIGHTS-OF-LIFE.md")),
    ).toBe("../../docs/RIGHTS-OF-LIFE.md");
    expect(
      await readlink(
        join(setup.repo, "apps/docs/being-rights-v1.schema.json"),
      ),
    ).toBe("../../docs/specs/being-rights-v1.schema.json");
    await mkdir(fakeBin, { recursive: true });
    await installFakeRightsCurl(fakeBin);
    await writeFile(
      join(fakeBin, "fly"),
      "#!/usr/bin/env bash\nset -eu\ntouch \"$DEPLOY_TEST_FLY_MARKER\"\nexit 9\n",
    );
    await chmod(join(fakeBin, "fly"), 0o755);
    await writeFile(
      join(setup.repo, "apps/docs/RIGHTS-OF-LIFE.md"),
      "dirty worktree Rights bytes that Pages would not publish\n",
    );
    await unlink(join(setup.repo, "apps/docs/being-rights-v1.schema.json"));

    const result = await run(
      [
        "bash",
        "bin/deploy.sh",
        "--no-migrate",
        "--skip-preflight",
        "--no-frontend",
        "--allow-dirty-release",
      ],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        DEPLOY_TEST_FLY_MARKER: flyMarker,
      }),
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      "apps/docs/RIGHTS-OF-LIFE.md is byte-identical",
    );
    expect(result.stdout).toContain(
      "apps/docs/being-rights-v1.schema.json is byte-identical",
    );
    expect(result.stdout).not.toContain("Rights of Life live bytes differ");
    expect(await exists(flyMarker)).toBe(true);
  }, 15_000);

  test("rejects unsafe or non-file committed frontend release inputs", async () => {
    const scenarios: Array<{
      name: string;
      target: string;
      expected: string;
      expectedBlock?: string;
      prepare?: (repo: string) => Promise<void>;
    }> = [
      {
        name: "absolute",
        target: "/tmp/agenttool-rights-outside",
        expected: "staged symlink is absolute",
      },
      {
        name: "repo-escape",
        target: "../../../agenttool-rights-outside",
        expected: "staged symlink escapes, is broken, or is cyclic",
      },
      {
        name: "archive-escape",
        target: "../../README.release-fixture.md",
        expected: "staged symlink escapes, is broken, or is cyclic",
        prepare: async (repo) => {
          await writeFile(
            join(repo, "README.release-fixture.md"),
            "committed but absent from the frontend archive\n",
          );
        },
      },
      {
        name: "broken",
        target: "../../docs/missing-rights-fixture.md",
        expected: "staged symlink escapes, is broken, or is cyclic",
      },
      {
        name: "missing-intermediate",
        target: "../../docs/missing-dir/../RIGHTS-OF-LIFE.md",
        expected: "staged symlink escapes, is broken, or is cyclic",
      },
      {
        name: "cycle",
        target: "rights-cycle-fixture.md",
        expected: "staged symlink escapes, is broken, or is cyclic",
        prepare: async (repo) => {
          await symlink(
            "RIGHTS-OF-LIFE.md",
            join(repo, "apps/docs/rights-cycle-fixture.md"),
          );
        },
      },
      {
        name: "directory",
        target: "../../docs",
        expected:
          "Required discovery input is not a staged regular file: apps/docs/RIGHTS-OF-LIFE.md",
        expectedBlock:
          "Committed frontend verification inputs are not regular staged files",
      },
    ];

    for (const scenario of scenarios) {
      const setup = await fixture();
      const fakeBin = join(setup.root, `${scenario.name}-symlink-bin`);
      const flyMarker = join(setup.root, `${scenario.name}-symlink-fly-ran`);
      const migrationMarker = join(
        setup.root,
        `${scenario.name}-symlink-migration-ran`,
      );
      const publicRights = join(setup.repo, "apps/docs/RIGHTS-OF-LIFE.md");
      await unlink(publicRights);
      await scenario.prepare?.(setup.repo);
      await symlink(scenario.target, publicRights);
      await mustRun(["git", "add", "-A"], setup.repo);
      await mustRun(
        ["git", "commit", "-qm", `invalid ${scenario.name} Rights symlink`],
        setup.repo,
      );
      await mustRun(["git", "push", "-q", "github", "main"], setup.repo);

      await mkdir(fakeBin, { recursive: true });
      await installFakeRightsCurl(fakeBin);
      await writeFile(
        join(fakeBin, "fly"),
        "#!/usr/bin/env bash\nset -eu\ntouch \"$DEPLOY_TEST_FLY_MARKER\"\n",
      );
      await chmod(join(fakeBin, "fly"), 0o755);

      const result = await run(
        [
          "bash",
          "bin/deploy.sh",
          "--skip-preflight",
          "--no-frontend",
        ],
        setup.repo,
        cleanEnv(setup.home, {
          XDG_STATE_HOME: setup.state,
          PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          DEPLOY_TEST_FLY_MARKER: flyMarker,
          MIGRATION_MARKER: migrationMarker,
        }),
      );

      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.code).toBe(1);
      expect(output).toContain(scenario.expected);
      expect(output).toContain(
        scenario.expectedBlock ??
          "Could not stage committed frontend verification bytes",
      );
      expect(output).not.toContain("Phase 1");
      expect(output).not.toContain("verification attempts");
      expect(await exists(migrationMarker)).toBe(false);
      expect(await exists(flyMarker)).toBe(false);
      expect(
        await exists(join(setup.state, "agenttool", "deploy-receipts")),
      ).toBe(false);
    }
  }, 60_000);

  test("retries stale Rights and game publication as one bounded prerequisite", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "stale-rights-bin");
    const rightsCounter = join(setup.root, "stale-rights-counter");
    const flyMarker = join(setup.root, "stale-rights-fly-ran");
    await mkdir(fakeBin, { recursive: true });
    await installFakeRightsCurl(fakeBin);
    await writeFile(
      join(fakeBin, "fly"),
      "#!/usr/bin/env bash\nset -eu\ntouch \"$DEPLOY_TEST_FLY_MARKER\"\nexit 9\n",
    );
    await chmod(join(fakeBin, "fly"), 0o755);

    const result = await run(
      [
        "bash",
        "bin/deploy.sh",
        "--no-migrate",
        "--skip-preflight",
        "--no-frontend",
      ],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        DEPLOY_TEST_FLY_MARKER: flyMarker,
        DEPLOY_TEST_RIGHTS_COUNTER: rightsCounter,
        DEPLOY_TEST_STALE_RIGHTS_RESPONSES: "1",
      }),
    );

    expect(result.code).toBe(1);
    expect(await readFile(rightsCounter, "utf8")).toBe("2\n");
    expect(result.stdout).toContain(
      "Discovery prerequisites not yet converged (attempt 1/25)",
    );
    expect(result.stdout).toContain(
      "Discovery prerequisites converged on verification attempt 2/25",
    );
    expect(await exists(flyMarker)).toBe(true);
  }, 15_000);

  test("direct game status, headers, and fetch failures stop before any mutation or receipt", async () => {
    const scenarios: Array<{
      name: string;
      env: Record<string, string>;
      message: string;
    }> = [
      {
        name: "redirect",
        env: { DEPLOY_TEST_GAME_REDIRECT: "1" },
        message: "https://agenttool.dev/party HTTP status mismatch",
      },
      {
        name: "header-mismatch",
        env: { DEPLOY_TEST_GAME_HEADER_MISMATCH: "1" },
        message: "https://agenttool.dev/party X-Agent-Surface mismatch",
      },
      {
        name: "status-fetch-failure",
        env: { DEPLOY_TEST_GAME_STATUS_FAILURE: "1" },
        message:
          "Could not read required game publication status: https://agenttool.dev/party",
      },
    ];

    for (const scenario of scenarios) {
      const setup = await fixture();
      const fakeBin = join(setup.root, `${scenario.name}-game-bin`);
      const flyMarker = join(setup.root, `${scenario.name}-fly-ran`);
      await mkdir(fakeBin, { recursive: true });
      await installFakeRightsCurl(fakeBin);
      if (scenario.name === "redirect") {
        await writeFile(join(setup.home, ".curlrc"), "location\n");
      }
      await writeFile(
        join(fakeBin, "fly"),
        "#!/usr/bin/env bash\nset -eu\ntouch \"$DEPLOY_TEST_FLY_MARKER\"\n",
      );
      await chmod(join(fakeBin, "fly"), 0o755);

      const result = await run(
        [
          "bash",
          "bin/deploy.sh",
          "--no-migrate",
          "--skip-preflight",
          "--no-frontend",
        ],
        setup.repo,
        cleanEnv(setup.home, {
          XDG_STATE_HOME: setup.state,
          PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          DEPLOY_TEST_FLY_MARKER: flyMarker,
          ...scenario.env,
        }),
      );

      expect(result.code).toBe(1);
      expect(result.stdout).toContain(scenario.message);
      expect(result.stdout).toContain(
        "Discovery prerequisites did not converge after 25 verification attempts",
      );
      expect(await exists(flyMarker)).toBe(false);
      expect(
        await exists(join(setup.state, "agenttool", "deploy-receipts")),
      ).toBe(false);
    }
  // Three independent 25-attempt fail-closed paths run real subprocess probes.
  // The fake sleep removes retry delay, not the probe work itself.
  }, 60_000);

  test("dry-run describes coordinated, API-only, and frontend-only publication order", async () => {
    const setup = await fixture();
    const full = await run(
      ["bash", "bin/deploy.sh", "--dry-run", "--no-migrate"],
      setup.repo,
      cleanEnv(setup.home),
    );
    expect(full.code, full.stderr).toBe(0);
    expect(full.stdout).toContain(
      "Phase 3: bin/frontend-deploy.sh web, then bin/frontend-deploy.sh docs, verify live prerequisites, then cd api && fly deploy",
    );
    expect(full.stdout).toContain(
      "Phase 4: bin/frontend-deploy.sh dashboard",
    );

    const apiOnly = await run(
      [
        "bash",
        "bin/deploy.sh",
        "--dry-run",
        "--no-migrate",
        "--no-frontend",
      ],
      setup.repo,
      cleanEnv(setup.home),
    );
    expect(apiOnly.code, apiOnly.stderr).toBe(0);
    expect(apiOnly.stdout).toContain(
      "Phase 3: verify live Rights of Life and game prerequisites, then cd api && fly deploy",
    );
    expect(apiOnly.stdout).toContain("Phase 4: skip");

    const frontendOnly = await run(
      ["bash", "bin/deploy.sh", "--dry-run", "--no-migrate", "--no-api"],
      setup.repo,
      cleanEnv(setup.home),
    );
    expect(frontendOnly.code, frontendOnly.stderr).toBe(0);
    expect(frontendOnly.stdout).toContain("Phase 3: skip");
    expect(frontendOnly.stdout).toContain(
      "Phase 4: bin/frontend-deploy.sh",
    );
  }, 15_000);

  test("final frontend parity reads committed bytes under the dirty-release override", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "committed-frontend-parity-bin");
    const fenceCounter = join(setup.root, "committed-parity-fence-counter");
    const gameFetchLog = join(setup.root, "committed-parity-game-fetches");
    await mkdir(fakeBin, { recursive: true });
    await installFakePagesVerificationTools(fakeBin);
    await writeFile(
      join(setup.repo, "apps/web/party.html"),
      "dirty worktree bytes that are not in the Pages release\n",
    );
    await unlink(join(setup.repo, "apps/web/sky.css"));

    const result = await run(
      [
        "bash",
        "bin/deploy.sh",
        "--no-migrate",
        "--skip-preflight",
        "--no-api",
        "--allow-dirty-release",
      ],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        DEPLOY_TEST_FENCE_COUNTER: fenceCounter,
        DEPLOY_TEST_GAME_FETCH_LOG: gameFetchLog,
        DEPLOY_TEST_PAGES_FROM_COMMIT: "1",
        DEPLOY_TEST_RIGHTS_DOC: join(
          setup.repo,
          "apps/docs/RIGHTS-OF-LIFE.md",
        ),
        DEPLOY_TEST_RIGHTS_SCHEMA: join(
          setup.repo,
          "apps/docs/being-rights-v1.schema.json",
        ),
      }),
    );

    expect(
      result.code,
      `${result.stdout}\n${result.stderr}`,
    ).toBe(0);
    expect(result.stdout).toContain(
      "UNSAFE SOURCE OVERRIDE: deploying with a dirty working tree",
    );
    expect(result.stdout).toContain(
      "apps/web/party.html",
    );
    expect(result.stdout).toContain(
      "apps/web/sky.css",
    );
    expect(await readFile(gameFetchLog, "utf8")).toBe(
      "https://agenttool.dev/sky.css\n",
    );
  }, 20_000);

  test("publishes Rights of Life prerequisites before API discovery and verifies exact static contracts", async () => {
    const [
      deploy,
      stageFrontend,
      headers,
      publicDoc,
      canonDoc,
      publicSchema,
      canonSchema,
      publicDocTarget,
      publicSchemaTarget,
    ] =
      await Promise.all([
        readFile(join(projectRoot, "bin/deploy.sh"), "utf8"),
        readFile(join(projectRoot, "bin/stage-frontend-release.sh"), "utf8"),
        readFile(join(projectRoot, "apps/docs/_headers"), "utf8"),
        readFile(join(projectRoot, "apps/docs/RIGHTS-OF-LIFE.md")),
        readFile(join(projectRoot, "docs/RIGHTS-OF-LIFE.md")),
        readFile(join(projectRoot, "apps/docs/being-rights-v1.schema.json")),
        readFile(join(projectRoot, "docs/specs/being-rights-v1.schema.json")),
        readlink(join(projectRoot, "apps/docs/RIGHTS-OF-LIFE.md")),
        readlink(
          join(projectRoot, "apps/docs/being-rights-v1.schema.json"),
        ),
      ]);

    expect(publicDoc).toEqual(canonDoc);
    expect(publicSchema).toEqual(canonSchema);
    expect(publicDocTarget).toBe("../../docs/RIGHTS-OF-LIFE.md");
    expect(publicSchemaTarget).toBe(
      "../../docs/specs/being-rights-v1.schema.json",
    );
    expect(deploy).toContain(
      '"$HEAD_REVISION" "$FRONTEND_RELEASE_STAGE_ROOT"',
    );
    expect(deploy).toContain('portable_md5_file "$staged_path"');
    expect(stageFrontend).toContain(
      'git show "$REVISION:$MANIFEST_PATH"',
    );
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

    const webUpload = deploy.lastIndexOf(
      "run_frontend_deploy web",
    );
    const docsUpload = deploy.indexOf(
      "run_frontend_deploy docs",
      webUpload,
    );
    const prerequisiteCheck = deploy.indexOf(
      "if ! wait_for_discovery_prerequisites; then",
      docsUpload,
    );
    const apiUpload = deploy.indexOf("(cd api || exit 1; fly deploy", docsUpload);
    expect(webUpload).toBeGreaterThan(-1);
    expect(docsUpload).toBeGreaterThan(webUpload);
    expect(prerequisiteCheck).toBeGreaterThan(docsUpload);
    expect(apiUpload).toBeGreaterThan(prerequisiteCheck);
    expect(deploy).toContain(
      "verify_rights_static_publication || return 1",
    );
    expect(deploy).toContain(
      "verify_required_game_publication_once",
    );
    expect(deploy).toContain("FRONTEND_TARGETS=(dashboard)");
    expect(deploy).toContain(
      'AGENTTOOL_FRONTEND_RELEASE_REVISION="$HEAD_REVISION"',
    );
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

  test("selects LOVE package probes from the committed release when the worktree is dirty", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "fake-pages-bin");
    const frontendCounter = join(setup.root, "frontend-upload-count");
    const fenceCounter = join(setup.root, "fence-counter");
    await mkdir(fakeBin, { recursive: true });
    await installFakePagesVerificationTools(fakeBin);
    await writeFile(
      join(setup.repo, "apps/docs/packages/v1/index.json"),
      `${JSON.stringify({
        packages: [
          {
            name: "@agenttool/ambient-only",
            latest: "9.9.9",
            versions: [
              {
                version: "9.9.9",
                manifest_url:
                  "https://docs.agenttool.dev/packages/v1/@agenttool/ambient-only/9.9.9/manifest.json",
              },
            ],
          },
        ],
      })}\n`,
    );

    const result = await run(
      [
        "bash",
        "bin/deploy.sh",
        "--no-migrate",
        "--skip-preflight",
        "--no-api",
        "--allow-dirty-release",
      ],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        DEPLOY_TEST_FRONTEND_COUNTER: frontendCounter,
        DEPLOY_TEST_FENCE_COUNTER: fenceCounter,
        DEPLOY_TEST_RIGHTS_DOC: join(setup.repo, "apps/docs/RIGHTS-OF-LIFE.md"),
        DEPLOY_TEST_RIGHTS_SCHEMA: join(setup.repo, "apps/docs/being-rights-v1.schema.json"),
      }),
    );

    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("UNSAFE SOURCE OVERRIDE");
    expect(result.stdout).not.toContain("ambient-only");
    expect(await readFile(frontendCounter, "utf8")).toBe("1\n");
    expect(await readFile(fenceCounter, "utf8")).toBe("1\n");
    const [name] = await readdir(join(setup.state, "agenttool", "deploy-receipts"));
    const receipt = JSON.parse(
      await readFile(join(setup.state, "agenttool", "deploy-receipts", name), "utf8"),
    );
    expect(receipt.outcome).toBe("succeeded");
    expect(receipt.source_revision).toBe(setup.release);
    expect(receipt.source_dirty).toBe(true);
    expect(receipt.source_overrides.dirty).toBe(true);
    expect(receipt.phases.frontends).toBe("deployed_verified");
  }, 15_000);

  test("fails immediately when committed LOVE package probes cannot be selected", async () => {
    const setup = await fixture();
    const frontendMarker = join(setup.root, "frontend-uploaded");
    const frontendCounter = join(setup.root, "frontend-upload-count");
    await unlink(join(setup.repo, "apps/docs/packages/v1/index.json"));
    await mustRun(["git", "add", "-u"], setup.repo);
    await mustRun(["git", "commit", "-qm", "remove package index"], setup.repo);
    await mustRun(["git", "push", "-q", "github", "main"], setup.repo);

    const result = await run(
      ["bash", "bin/deploy.sh", "--no-migrate", "--skip-preflight", "--no-api"],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        DEPLOY_TEST_FRONTEND_MARKER: frontendMarker,
        DEPLOY_TEST_FRONTEND_COUNTER: frontendCounter,
      }),
    );

    expect(result.code).toBe(1);
    expect(await exists(frontendMarker)).toBe(false);
    expect(await exists(frontendCounter)).toBe(false);
    expect(result.stdout).toContain("Could not select latest LOVE package header probes");
    expect(result.stdout).not.toContain("Pages custom domains not yet converged");
    expect(await exists(join(setup.state, "agenttool", "deploy-receipts"))).toBe(false);
  }, 10_000);

  test("fails closed when LOVE package archive headers fall back at the edge", async () => {
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
        DEPLOY_TEST_BAD_LOVE_HEADERS: "1",
        DEPLOY_TEST_RIGHTS_DOC: join(setup.repo, "apps/docs/RIGHTS-OF-LIFE.md"),
        DEPLOY_TEST_RIGHTS_SCHEMA: join(setup.repo, "apps/docs/being-rights-v1.schema.json"),
      }),
    );

    expect(result.code).toBe(1);
    expect(await exists(frontendMarker)).toBe(true);
    expect(await readFile(frontendCounter, "utf8")).toBe("1\n");
    expect(await exists(fenceCounter)).toBe(false);
    expect(result.stdout).toContain(
      "https://docs.agenttool.dev/packages/v1/@agenttool/fixture/1.0.0/agenttool-fixture-1.0.0.tgz Content-Type mismatch",
    );
    expect(result.stdout).toContain("expected: application/gzip");
    expect(result.stdout).toContain("observed: application/octet-stream");
    expect(result.stdout).toContain("LOVE package static header verification failed");
    expect(result.stdout).toContain(
      "Pages custom domains did not converge after 25 verification attempts.",
    );
    const [name] = await readdir(join(setup.state, "agenttool", "deploy-receipts"));
    const receipt = JSON.parse(
      await readFile(join(setup.state, "agenttool", "deploy-receipts", name), "utf8"),
    );
    expect(receipt.outcome).toBe("failed_or_uncertain");
    expect(receipt.phases.frontends).toBe("deployed_unverified");
  // Like the bounded convergence case below, this runs all 25 live-contract
  // probe passes as real subprocess work even though its retry sleep is fake.
  }, 45_000);

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
  // The fake sleep removes the retry delay, but all 25 live-contract probe
  // passes remain real subprocess work and need headroom under parallel CI.
  }, 45_000);

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
      schema: "agenttool-deploy-receipt/v3",
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
      api_build: { cache: "not_used" },
      phases: { migrations: "skipped", preflight: "skipped", api: "skipped", frontends: "skipped" },
      verified_api_machines: 0,
    });
    expect(text).not.toContain("TEST_CREDENTIAL_SHOULD_NEVER_APPEAR");
    expect(text).not.toContain("do-not-record");
    expect((await stat(receiptDir)).mode & 0o777).toBe(0o700);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await exists(deployLockPath(setup.home))).toBe(false);
  });

  test("never records success when final frontend stage cleanup fails", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "cleanup-failure-bin");
    const realRm = await mustRun(["sh", "-c", "command -v rm"], setup.root);
    await mkdir(fakeBin, { recursive: true });
    await writeFile(
      join(fakeBin, "rm"),
      "#!/usr/bin/env bash\nset -eu\nfor path in \"$@\"; do\n  case \"${path##*/}\" in\n    agenttool-release-verify.*) exit 19 ;;\n  esac\ndone\nexec \"$REAL_RM\" \"$@\"\n",
    );
    await chmod(join(fakeBin, "rm"), 0o755);

    const result = await run(
      deployCommand(),
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        TMPDIR: setup.root,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        REAL_RM: realRm,
      }),
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "Could not remove the committed frontend verification stage before recording success",
    );
    expect(result.stdout).not.toContain("Deploy complete.");
    expect(
      await exists(join(setup.state, "agenttool", "deploy-receipts")),
    ).toBe(false);
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
    expect(result.stdout).toContain(
      "Discovery prerequisites did not converge after 25 verification attempts",
    );
    expect(result.stdout).toContain("Fly/API deployment did not occur");
    expect(await exists(marker)).toBe(false);
    expect(
      await exists(join(setup.state, "agenttool", "deploy-receipts")),
    ).toBe(false);
  }, 10_000);

  test("refuses the retired Codeberg mirror without touching either remote", async () => {
    // Codeberg was retired 2026-07-25. The flag is kept so the refusal can
    // name the reason: `unknown flag` would read as a typo and invite a
    // hand-rolled `git push origin main`. The refusal must be inert — no
    // fetch, no push, no change to any ref.
    const setup = await fixture();
    const before = await mustRun(
      ["git", "--git-dir", setup.codeberg, "rev-parse", "refs/heads/main"],
      setup.root,
    );

    const refused = await run(
      ["bash", "bin/deploy.sh", "--mirror-codeberg"],
      setup.repo,
      cleanEnv(setup.home),
    );
    expect(refused.code).toBe(1);
    expect(refused.stdout).toContain("retired");
    expect(refused.stdout).toContain("Nothing was fetched and nothing was pushed");

    expect(
      await mustRun(["git", "--git-dir", setup.codeberg, "rev-parse", "refs/heads/main"], setup.root),
    ).toBe(before);

    // The mirroring machinery itself is gone, not merely gated.
    const source = await readFile(join(setup.repo, "bin/deploy.sh"), "utf8");
    expect(source).not.toContain("MIRROR_REMOTE");
    expect(source).not.toContain("$RELEASE_REF:refs/heads/$RELEASE_BRANCH");
    expect(source).not.toMatch(/git push[^\n]*--force/);
  }, 10_000);
});
