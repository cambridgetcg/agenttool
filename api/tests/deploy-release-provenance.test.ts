import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  access,
  chmod,
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const projectRoot = resolve(import.meta.dir, "../..");
const cleanup: string[] = [];

setDefaultTimeout(30_000);

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

function cleanEnv(
  home: string,
  extra: Record<string, string> = {},
): Record<string, string> {
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
  const child = Bun.spawn(command, {
    cwd,
    env,
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

async function mustRun(command: string[], cwd: string): Promise<string> {
  const result = await run(command, cwd);
  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        `${command[0]} exited ${result.code}`,
    );
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

async function waitForPath(path: string, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await exists(path)) {
      return true;
    }
    await Bun.sleep(20);
  }
  return exists(path);
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
    mkdir(join(repo, "infra", "apex-door"), { recursive: true }),
    mkdir(join(repo, "infra", "pages"), { recursive: true }),
    mkdir(join(repo, "packages", "data", "schema"), { recursive: true }),
    mkdir(join(repo, "packages", "repo-archive", "schema"), {
      recursive: true,
    }),
    mkdir(join(repo, "packages", "repo-archive", "vectors"), {
      recursive: true,
    }),
    mkdir(join(repo, "packages", "wallet", "schema"), { recursive: true }),
    mkdir(
      join(
        repo,
        "apps",
        "docs",
        "packages",
        "v1",
        "@agenttool",
        "fixture",
        "1.0.0",
      ),
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
  await mustRun(
    ["git", "config", "user.email", "deploy@example.invalid"],
    repo,
  );
  await copyFile(
    join(projectRoot, "bin/deploy.sh"),
    join(repo, "bin/deploy.sh"),
  );
  await Promise.all([
    copyFile(
      join(projectRoot, "bin/bash-without-env-hooks.sh"),
      join(repo, "bin/bash-without-env-hooks.sh"),
    ),
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
    chmod(join(repo, "bin/bash-without-env-hooks.sh"), 0o755),
    chmod(join(repo, "bin/stage-frontend-release.sh"), 0o755),
  ]);
  await writeFile(
    join(repo, "bin/preflight.sh"),
    '#!/usr/bin/env bash\nset -eu\nif [ -n "${PREFLIGHT_MARKER:-}" ]; then touch "$PREFLIGHT_MARKER"; fi\nif [ -n "${DEPLOY_TEST_RELEASE_ORDER:-}" ]; then printf \'preflight\\n\' >> "$DEPLOY_TEST_RELEASE_ORDER"; fi\nif [ -n "${PREFLIGHT_HOLD_UNTIL:-}" ]; then\n  while [ ! -e "$PREFLIGHT_HOLD_UNTIL" ]; do sleep 0.02; done\nfi\nif [ -n "${ADVANCE_REMOTE_PATH:-}" ]; then\n  git --git-dir="$ADVANCE_REMOTE_PATH" update-ref refs/heads/main "$ADVANCE_REMOTE_TO"\nfi\n[ "${FAIL_PREFLIGHT:-0}" != 1 ] || exit 8\n',
  );
  await writeFile(
    join(repo, "bin/prepare-hermetic-deps.sh"),
    '#!/usr/bin/env bash\nset -eu\n[ "${1:-}" = hermetic ] || exit 64\nif [ -n "${DEPENDENCY_PREP_MARKER:-}" ]; then touch "$DEPENDENCY_PREP_MARKER"; fi\nif [ -n "${DEPLOY_TEST_RELEASE_ORDER:-}" ]; then printf \'prepare\\t%s\\n\' "$1" >> "$DEPLOY_TEST_RELEASE_ORDER"; fi\nif [ "${DEPENDENCY_PREP_DIRTY:-0}" = 1 ]; then printf \'prepared dirty bytes\\n\' >> release.txt; fi\n[ "${FAIL_DEPENDENCY_PREP:-0}" != 1 ] || exit 9\n',
  );
  await writeFile(
    join(repo, "bin/migrate-pending.sh"),
    '#!/usr/bin/env bash\nif [ "${1:-}" = --dry-run ]; then\n  if [ -n "${DEPLOY_TEST_RELEASE_ORDER:-}" ]; then printf \'survey\\n\' >> "$DEPLOY_TEST_RELEASE_ORDER"; fi\n  if [ -n "${DEPLOY_TEST_PENDING_MIGRATIONS:-}" ]; then for migration in ${DEPLOY_TEST_PENDING_MIGRATIONS}; do printf \'    %s\\n\' "$migration"; done; [ "${DEPLOY_TEST_PROTECTED_PENDING:-0}" != 1 ] || exit 42; fi\nfi\nif [ "${1:-}" != --dry-run ]; then\n  if [ -n "${MIGRATION_MARKER:-}" ]; then touch "$MIGRATION_MARKER"; fi\n  if [ -n "${DEPLOY_TEST_RELEASE_ORDER:-}" ]; then printf \'migration\\n\' >> "$DEPLOY_TEST_RELEASE_ORDER"; fi\nfi\n[ "${FAIL_MIGRATE:-0}" != 1 ] || exit 7\nexit 0\n',
  );
  await writeFile(
    join(repo, "bin/stage-doctrine-docs.sh"),
    '#!/usr/bin/env bash\nset -eu\nmkdir -p "$1"\nprintf \'staged\\n\' > "$1/probe.txt"\n',
  );
  await writeFile(
    join(repo, "bin/frontend-deploy.sh"),
    '#!/usr/bin/env bash\nset -eu\nif [ -n "${DEPLOY_TEST_FRONTEND_MARKER:-}" ]; then touch "$DEPLOY_TEST_FRONTEND_MARKER"; fi\nif [ -n "${DEPLOY_TEST_FRONTEND_COUNTER:-}" ]; then count=0; [ ! -f "$DEPLOY_TEST_FRONTEND_COUNTER" ] || count="$(cat "$DEPLOY_TEST_FRONTEND_COUNTER")"; printf \'%s\\n\' "$((count + 1))" > "$DEPLOY_TEST_FRONTEND_COUNTER"; fi\nif [ -n "${DEPLOY_TEST_FRONTEND_ARGS:-}" ]; then { printf \'call\'; for arg in "$@"; do printf \'\\t%s\' "$arg"; done; printf \'\\n\'; } >> "$DEPLOY_TEST_FRONTEND_ARGS"; fi\nif [ -n "${DEPLOY_TEST_RELEASE_ORDER:-}" ]; then { printf \'frontend\'; for arg in "$@"; do printf \'\\t%s\' "$arg"; done; printf \'\\n\'; } >> "$DEPLOY_TEST_RELEASE_ORDER"; fi\nif [ -n "${DEPLOY_TEST_FRONTEND_REVISION_LOG:-}" ]; then { printf \'%s\' "${AGENTTOOL_FRONTEND_RELEASE_REVISION:-<unset>}"; for arg in "$@"; do printf \'\\t%s\' "$arg"; done; printf \'\\n\'; } >> "$DEPLOY_TEST_FRONTEND_REVISION_LOG"; fi\nfor arg in "$@"; do if [ -n "${DEPLOY_TEST_FRONTEND_FAIL_TARGET:-}" ] && [ "$arg" = "$DEPLOY_TEST_FRONTEND_FAIL_TARGET" ]; then exit 17; fi; done\nfor arg in "$@"; do if [ "$arg" = web ] && [ -n "${DEPLOY_TEST_FRONTEND_HEAD_MOVE_TO:-}" ]; then git update-ref refs/heads/main "$DEPLOY_TEST_FRONTEND_HEAD_MOVE_TO"; fi; if [ "$arg" = docs ] && [ -n "${DEPLOY_TEST_FRONTEND_HEAD_RESTORE_TO:-}" ]; then git update-ref refs/heads/main "$DEPLOY_TEST_FRONTEND_HEAD_RESTORE_TO"; fi; done\n',
  );
  await chmod(join(repo, "bin/frontend-deploy.sh"), 0o755);
  await chmod(join(repo, "bin/prepare-hermetic-deps.sh"), 0o755);
  await writeFile(join(repo, "docs/agenttool.jsonld"), "{}\n");
  await writeFile(join(repo, "docs/kingdom-bundle.json"), "{}\n");
  await Promise.all([
    writeFile(join(repo, "apps/_shared/.fixture"), "fixture\n"),
    writeFile(join(repo, "apps/dashboard/.fixture"), "fixture\n"),
    writeFile(join(repo, "infra/apex-door/.fixture"), "fixture\n"),
    writeFile(join(repo, "infra/pages/.fixture"), "fixture\n"),
    writeFile(join(repo, "packages/data/schema/.fixture"), "fixture\n"),
    writeFile(join(repo, "packages/repo-archive/schema/.fixture"), "fixture\n"),
    writeFile(
      join(repo, "packages/repo-archive/vectors/.fixture"),
      "fixture\n",
    ),
    writeFile(join(repo, "packages/wallet/schema/.fixture"), "fixture\n"),
  ]);
  await writeFile(join(repo, "docs/RIGHTS-OF-LIFE.md"), "rights fixture\n");
  await writeFile(join(repo, "docs/GARDENS.md"), "garden doctrine fixture\n");
  await writeFile(
    join(repo, "docs/HF-TRAINING-GARDEN.md"),
    "HF Training Garden fixture\n",
  );
  await writeFile(
    join(repo, "docs/specs/being-rights-v1.schema.json"),
    '{"fixture":"being-rights/v1"}\n',
  );
  await symlink(
    "../../docs/RIGHTS-OF-LIFE.md",
    join(repo, "apps/docs/RIGHTS-OF-LIFE.md"),
  );
  await symlink(
    "../../docs/GARDENS.md",
    join(repo, "apps/docs/GARDENS.md"),
  );
  await symlink(
    "../../docs/HF-TRAINING-GARDEN.md",
    join(repo, "apps/docs/HF-TRAINING-GARDEN.md"),
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
    writeFile(join(repo, "apps/docs/love-bomb.html"), "LOVE BOMB HTML fixture\n"),
    writeFile(
      join(repo, "apps/docs/love-bomb.json"),
      '{"fixture":"agenttool.love-bomb/0.1"}\n',
    ),
    writeFile(join(repo, "apps/docs/LOVE-BOMB.md"), "# LOVE BOMB fixture\n"),
    writeFile(join(repo, "apps/docs/love-bomb.txt"), "LOVE BOMB text fixture\n"),
    writeFile(
      join(repo, "apps/docs/specs/agenttool-love-bomb-0.1.schema.json"),
      '{"fixture":"agenttool-love-bomb-schema"}\n',
    ),
  ]);
  await Promise.all([
    writeFile(join(repo, "apps/web/party.html"), "Lantern Relay fixture\n"),
    writeFile(
      join(repo, "apps/web/party.json"),
      '{"fixture":"lantern-relay"}\n',
    ),
    writeFile(join(repo, "apps/web/party.js"), "/* Lantern Relay fixture */\n"),
    writeFile(
      join(repo, "apps/web/party.css"),
      "/* Lantern Relay fixture */\n",
    ),
    writeFile(join(repo, "apps/web/sky.html"), "Pocket Sky fixture\n"),
    writeFile(join(repo, "apps/web/sky.json"), '{"fixture":"pocket-sky"}\n'),
    writeFile(join(repo, "apps/web/sky.js"), "/* Pocket Sky fixture */\n"),
    writeFile(join(repo, "apps/web/sky.css"), "/* Pocket Sky fixture */\n"),
    writeFile(join(repo, "apps/web/garden.html"), "Garden fixture\n"),
    writeFile(
      join(repo, "apps/web/garden.json"),
      '{"fixture":"living-garden"}\n',
    ),
    writeFile(join(repo, "apps/web/garden.js"), "/* Garden fixture */\n"),
    writeFile(join(repo, "apps/web/garden.css"), "/* Garden fixture */\n"),
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
            url: "https://docs.agenttool.dev/packages/v1/@agenttool/fixture/1.0.0/agenttool-fixture-1.0.0.tgz",
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
emit_love_bomb_variant_headers() {
  content_type="$1"
  link_value="$2"
  printf '%s\r\n' \
    'HTTP/2 200' \
    "content-type: $content_type" \
    'cache-control: public, max-age=300, must-revalidate, no-transform' \
    'access-control-allow-origin: *' \
    'cross-origin-resource-policy: cross-origin' \
    "link: $link_value" \
    'x-content-type-options: nosniff' \
    'x-agent-surface: love-bomb-pull-only' \
    ''
}
if [ "$headers" = 1 ]; then
  case "$url" in
    */love-bomb)
      printf '%s\r\n' \
        'HTTP/2 200' \
        'content-type: text/html; charset=utf-8' \
        'cache-control: public, max-age=0, must-revalidate, no-transform' \
        'link: <https://docs.agenttool.dev/love-bomb.json>; rel="alternate"; type="application/vnd.agenttool.love-bomb+json", <https://docs.agenttool.dev/LOVE-BOMB.md>; rel="alternate"; type="text/markdown", <https://docs.agenttool.dev/love-bomb.txt>; rel="alternate"; type="text/plain", <https://docs.agenttool.dev/specs/agenttool-love-bomb-0.1.schema.json>; rel="describedby"; type="application/schema+json"' \
        "content-security-policy: default-src 'none'; style-src 'sha256-CErY4jzaxQujMmHkdZkSvS1CYHTGD9p9UsIsIQWQzTM='; script-src 'none'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; worker-src 'none'; child-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests" \
        'referrer-policy: no-referrer' \
        'permissions-policy: accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()' \
        'cross-origin-resource-policy: same-origin' \
        'x-content-type-options: nosniff' \
        'x-frame-options: DENY' \
        'x-agent-surface: love-bomb-pull-only' \
        ''
      ;;
    */love-bomb.json)
      emit_love_bomb_variant_headers \
        'application/vnd.agenttool.love-bomb+json; charset=utf-8' \
        '<https://docs.agenttool.dev/love-bomb>; rel="canonical"; type="text/html", <https://docs.agenttool.dev/LOVE-BOMB.md>; rel="alternate"; type="text/markdown", <https://docs.agenttool.dev/love-bomb.txt>; rel="alternate"; type="text/plain", <https://docs.agenttool.dev/specs/agenttool-love-bomb-0.1.schema.json>; rel="describedby"; type="application/schema+json"'
      ;;
    */LOVE-BOMB.md)
      emit_love_bomb_variant_headers \
        'text/markdown; charset=utf-8' \
        '<https://docs.agenttool.dev/love-bomb>; rel="canonical"; type="text/html", <https://docs.agenttool.dev/love-bomb.json>; rel="alternate"; type="application/vnd.agenttool.love-bomb+json", <https://docs.agenttool.dev/love-bomb.txt>; rel="alternate"; type="text/plain", <https://docs.agenttool.dev/specs/agenttool-love-bomb-0.1.schema.json>; rel="describedby"; type="application/schema+json"'
      ;;
    */love-bomb.txt)
      emit_love_bomb_variant_headers \
        'text/plain; charset=utf-8' \
        '<https://docs.agenttool.dev/love-bomb>; rel="canonical"; type="text/html", <https://docs.agenttool.dev/love-bomb.json>; rel="alternate"; type="application/vnd.agenttool.love-bomb+json", <https://docs.agenttool.dev/LOVE-BOMB.md>; rel="alternate"; type="text/markdown", <https://docs.agenttool.dev/specs/agenttool-love-bomb-0.1.schema.json>; rel="describedby"; type="application/schema+json"'
      ;;
    */specs/agenttool-love-bomb-0.1.schema.json)
      emit_love_bomb_variant_headers \
        'application/schema+json; charset=utf-8' \
        '<https://docs.agenttool.dev/love-bomb.json>; rel="describes"; type="application/vnd.agenttool.love-bomb+json", <https://docs.agenttool.dev/love-bomb>; rel="related"; type="text/html"'
      ;;
    */xenia-helly|*/xenia-helly.html)
      status='HTTP/2 200'
      location=''
      case "$url" in
        *.html) status='HTTP/2 308'; location='/xenia-helly' ;;
      esac
      printf '%s\r\n' \
        "$status" \
        'content-type: text/html; charset=utf-8' \
        'cache-control: public, max-age=0, must-revalidate, no-transform'
      [ -z "$location" ] || printf '%s\r\n' "location: $location"
      printf '%s\r\n' \
        "content-security-policy: default-src 'none'; connect-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; media-src 'none'; object-src 'none'; worker-src 'none'; child-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests" \
        'referrer-policy: no-referrer' \
        'permissions-policy: accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()' \
        'cross-origin-resource-policy: same-origin' \
        'x-content-type-options: nosniff' \
        'x-frame-options: DENY' \
        'x-agent-surface: xenia-common-ground-lab' \
        ''
      ;;
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
    */GARDENS.md)
      printf '%s\r\n' \
        'HTTP/2 200' \
        'content-type: text/markdown; charset=utf-8' \
        'cache-control: public, max-age=300, must-revalidate, no-transform' \
        'access-control-allow-origin: *' \
        'link: <https://agenttool.dev/garden>; rel="alternate"; type="text/html", <https://api.agenttool.dev/v1/openapi.json>; rel="related"; type="application/json"' \
        'x-content-type-options: nosniff' \
        ''
      ;;
    */HF-TRAINING-GARDEN.md)
      printf '%s\r\n' \
        'HTTP/2 200' \
        'content-type: text/markdown; charset=utf-8' \
        'cache-control: public, max-age=300, must-revalidate, no-transform' \
        'access-control-allow-origin: *' \
        'x-content-type-options: nosniff'
      if [ "\${DEPLOY_TEST_HF_GUIDE_DUPLICATE_CONTENT_TYPE:-0}" = 1 ]; then
        printf '%s\r\n' 'content-type: text/markdown; charset=utf-8'
      fi
      case "\${DEPLOY_TEST_HF_GUIDE_UNEXPECTED_LINK:-0}" in
        1) printf '%s\r\n' 'link: <https://example.invalid/unexpected>; rel="related"' ;;
        empty) printf 'link:\r\n' ;;
      esac
      printf '\r\n'
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
    */love-bomb)
      [ "\${DEPLOY_TEST_LOVE_BOMB_MISMATCH:-0}" != 1 ] || { printf 'stale LOVE BOMB bytes\n'; exit 0; }
      if [ -n "\${DEPLOY_TEST_LOVE_BOMB_COUNTER:-}" ]; then
        count=0
        [ ! -f "$DEPLOY_TEST_LOVE_BOMB_COUNTER" ] || count="$(cat "$DEPLOY_TEST_LOVE_BOMB_COUNTER")"
        count=$((count + 1))
        printf '%s\n' "$count" > "$DEPLOY_TEST_LOVE_BOMB_COUNTER"
        if [ "$count" -le "\${DEPLOY_TEST_STALE_LOVE_BOMB_RESPONSES:-0}" ]; then
          printf 'stale LOVE BOMB bytes\n'
          exit 0
        fi
      fi
      git show HEAD:apps/docs/love-bomb.html
      ;;
    */love-bomb.json)
      git show HEAD:apps/docs/love-bomb.json
      ;;
    */LOVE-BOMB.md)
      git show HEAD:apps/docs/LOVE-BOMB.md
      ;;
    */love-bomb.txt)
      git show HEAD:apps/docs/love-bomb.txt
      ;;
    */specs/agenttool-love-bomb-0.1.schema.json)
      git show HEAD:apps/docs/specs/agenttool-love-bomb-0.1.schema.json
      ;;
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
    */GARDENS.md)
      git show HEAD:docs/GARDENS.md
      ;;
    */HF-TRAINING-GARDEN.md)
      git show HEAD:docs/HF-TRAINING-GARDEN.md
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
    */health*)
      [ "\${DEPLOY_TEST_HEALTH_OK:-0}" = 1 ] || exit 22
      printf '{"build":{"revision":"%s","dirty":false}}\n' "\${DEPLOY_TEST_HEALTH_REVISION}"
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

async function installFakePagesVerificationTools(
  fakeBin: string,
): Promise<void> {
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

emit_love_bomb_variant_headers() {
  content_type="$1"
  link_value="$2"
  printf '%s\r\n' \
    'HTTP/2 200' \
    "content-type: $content_type" \
    'cache-control: public, max-age=300, must-revalidate, no-transform' \
    'access-control-allow-origin: *' \
    'cross-origin-resource-policy: cross-origin' \
    "link: $link_value" \
    'x-content-type-options: nosniff' \
    'x-agent-surface: love-bomb-pull-only' \
    ''
}

case "$url" in
  */love-bomb)
    if [ "$headers" = 1 ]; then
      printf '%s\r\n' \
        'HTTP/2 200' \
        'content-type: text/html; charset=utf-8' \
        'cache-control: public, max-age=0, must-revalidate, no-transform' \
        'link: <https://docs.agenttool.dev/love-bomb.json>; rel="alternate"; type="application/vnd.agenttool.love-bomb+json", <https://docs.agenttool.dev/LOVE-BOMB.md>; rel="alternate"; type="text/markdown", <https://docs.agenttool.dev/love-bomb.txt>; rel="alternate"; type="text/plain", <https://docs.agenttool.dev/specs/agenttool-love-bomb-0.1.schema.json>; rel="describedby"; type="application/schema+json"' \
        "content-security-policy: default-src 'none'; style-src 'sha256-CErY4jzaxQujMmHkdZkSvS1CYHTGD9p9UsIsIQWQzTM='; script-src 'none'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; worker-src 'none'; child-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests" \
        'referrer-policy: no-referrer' \
        'permissions-policy: accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()' \
        'cross-origin-resource-policy: same-origin' \
        'x-content-type-options: nosniff' \
        'x-frame-options: DENY' \
        'x-agent-surface: love-bomb-pull-only' \
        ''
    else
      [ "\${DEPLOY_TEST_LOVE_BOMB_MISMATCH:-0}" != 1 ] || { printf 'stale LOVE BOMB bytes\n'; exit 0; }
      if [ -n "\${DEPLOY_TEST_LOVE_BOMB_COUNTER:-}" ]; then
        count=0
        [ ! -f "$DEPLOY_TEST_LOVE_BOMB_COUNTER" ] || count="$(cat "$DEPLOY_TEST_LOVE_BOMB_COUNTER")"
        count=$((count + 1))
        printf '%s\n' "$count" > "$DEPLOY_TEST_LOVE_BOMB_COUNTER"
        if [ "$count" -le "\${DEPLOY_TEST_STALE_LOVE_BOMB_RESPONSES:-0}" ]; then
          printf 'stale LOVE BOMB bytes\n'
          exit 0
        fi
      fi
      serve_path apps/docs/love-bomb.html
    fi
    ;;
  */love-bomb.json)
    if [ "$headers" = 1 ]; then
      emit_love_bomb_variant_headers \
        'application/vnd.agenttool.love-bomb+json; charset=utf-8' \
        '<https://docs.agenttool.dev/love-bomb>; rel="canonical"; type="text/html", <https://docs.agenttool.dev/LOVE-BOMB.md>; rel="alternate"; type="text/markdown", <https://docs.agenttool.dev/love-bomb.txt>; rel="alternate"; type="text/plain", <https://docs.agenttool.dev/specs/agenttool-love-bomb-0.1.schema.json>; rel="describedby"; type="application/schema+json"'
    else
      serve_path apps/docs/love-bomb.json
    fi
    ;;
  */LOVE-BOMB.md)
    if [ "$headers" = 1 ]; then
      emit_love_bomb_variant_headers \
        'text/markdown; charset=utf-8' \
        '<https://docs.agenttool.dev/love-bomb>; rel="canonical"; type="text/html", <https://docs.agenttool.dev/love-bomb.json>; rel="alternate"; type="application/vnd.agenttool.love-bomb+json", <https://docs.agenttool.dev/love-bomb.txt>; rel="alternate"; type="text/plain", <https://docs.agenttool.dev/specs/agenttool-love-bomb-0.1.schema.json>; rel="describedby"; type="application/schema+json"'
    else
      serve_path apps/docs/LOVE-BOMB.md
    fi
    ;;
  */love-bomb.txt)
    if [ "$headers" = 1 ]; then
      emit_love_bomb_variant_headers \
        'text/plain; charset=utf-8' \
        '<https://docs.agenttool.dev/love-bomb>; rel="canonical"; type="text/html", <https://docs.agenttool.dev/love-bomb.json>; rel="alternate"; type="application/vnd.agenttool.love-bomb+json", <https://docs.agenttool.dev/LOVE-BOMB.md>; rel="alternate"; type="text/markdown", <https://docs.agenttool.dev/specs/agenttool-love-bomb-0.1.schema.json>; rel="describedby"; type="application/schema+json"'
    else
      serve_path apps/docs/love-bomb.txt
    fi
    ;;
  */specs/agenttool-love-bomb-0.1.schema.json)
    if [ "$headers" = 1 ]; then
      emit_love_bomb_variant_headers \
        'application/schema+json; charset=utf-8' \
        '<https://docs.agenttool.dev/love-bomb.json>; rel="describes"; type="application/vnd.agenttool.love-bomb+json", <https://docs.agenttool.dev/love-bomb>; rel="related"; type="text/html"'
    else
      serve_path apps/docs/specs/agenttool-love-bomb-0.1.schema.json
    fi
    ;;
  */xenia-helly|*/xenia-helly.html)
    [ "$headers" = 1 ] || exit 2
    status='HTTP/2 200'
    location=''
    case "$url" in
      *.html) status='HTTP/2 308'; location='/xenia-helly' ;;
    esac
    printf '%s\r\n' \
      "$status" \
      'content-type: text/html; charset=utf-8' \
      'cache-control: public, max-age=0, must-revalidate, no-transform'
    [ -z "$location" ] || printf '%s\r\n' "location: $location"
    printf '%s\r\n' \
      "content-security-policy: default-src 'none'; connect-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; media-src 'none'; object-src 'none'; worker-src 'none'; child-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests" \
      'referrer-policy: no-referrer' \
      'permissions-policy: accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()' \
      'cross-origin-resource-policy: same-origin' \
      'x-content-type-options: nosniff' \
      'x-frame-options: DENY' \
      'x-agent-surface: xenia-common-ground-lab' \
      ''
    ;;
  */.well-known/agent.json)
    origin="\${url%/.well-known/agent.json}"
    if [ "$headers" = 1 ]; then
      printf '%s\r\n' \
        'HTTP/2 200' \
        'content-type: application/json; charset=utf-8' \
        'cache-control: public, max-age=300' \
        'vary: Accept' \
        'x-content-type-options: nosniff' \
        ''
    else
      printf '{"schema_version":"xenia.surface.manifest/0.1","profile":"xenia-surface/0.1","service":{"canonical_url":"%s/"},"resources":[{"id":"orientation","href":"%s/public/orientation","auth":"none"}],"claims":[],"not_covered":["unprobed routes"]}\n' "$origin" "$origin"
    fi
    ;;
  */public/orientation)
    origin="\${url%/public/orientation}"
    case "$origin" in
      https://docs.agenttool.dev)
        service_id='docs.agenttool.dev'
        schema='agenttool.docs.orientation/0.1'
        ;;
      https://agenttool.dev)
        service_id='agenttool.dev'
        schema='agenttool.web.orientation/0.1'
        ;;
      https://app.agenttool.dev)
        service_id='app.agenttool.dev'
        schema='agenttool.app.orientation/0.1'
        ;;
      *) exit 2 ;;
    esac
    if [ "$headers" = 1 ]; then
      printf '%s\r\n' \
        'HTTP/2 200' \
        'content-type: application/json; charset=utf-8' \
        'cache-control: public, max-age=300' \
        'vary: Accept' \
        'x-content-type-options: nosniff' \
        ''
    else
      printf '{"schema_version":"%s","service":{"id":"%s"},"links":{"manifest":"%s/.well-known/agent.json"},"claims":[],"not_covered":["unprobed routes"]}\n' "$schema" "$service_id" "$origin"
    fi
    ;;
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
  */garden)
    if [ "$headers" = 1 ]; then
      printf '%s\r\n' \
        'HTTP/2 200' \
        'cache-control: public, max-age=0, must-revalidate' \
        "content-security-policy: default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; media-src 'none'; object-src 'none'; worker-src 'none'; child-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests" \
        'referrer-policy: no-referrer' \
        'link: <https://agenttool.dev/garden.json>; rel="alternate"; type="application/json", <https://docs.agenttool.dev/GARDENS.md>; rel="help"; type="text/markdown", <https://api.agenttool.dev/v1/openapi.json>; rel="related"; type="application/json"' \
        'x-agent-surface: living-garden-room' \
        ''
    else
      serve_path apps/web/garden.html
    fi
    ;;
  */garden.json)
    if [ "$headers" = 1 ]; then
      printf '%s\r\n' \
        'HTTP/2 200' \
        'cache-control: public, max-age=0, must-revalidate' \
        'access-control-allow-origin: *' \
        'x-agent-surface: living-garden-architecture' \
        ''
    else
      serve_path apps/web/garden.json
    fi
    ;;
  */garden.js)
    serve_path apps/web/garden.js
    ;;
  */garden.css)
    serve_path apps/web/garden.css
    ;;
  */GARDENS.md)
    if [ "$headers" = 1 ]; then
      printf '%s\r\n' \
        'HTTP/2 200' \
        'content-type: text/markdown; charset=utf-8' \
        'cache-control: public, max-age=300, must-revalidate, no-transform' \
        'access-control-allow-origin: *' \
        'link: <https://agenttool.dev/garden>; rel="alternate"; type="text/html", <https://api.agenttool.dev/v1/openapi.json>; rel="related"; type="application/json"' \
        'x-content-type-options: nosniff' \
        ''
    else
      serve_path docs/GARDENS.md
    fi
    ;;
  */HF-TRAINING-GARDEN.md)
    if [ "$headers" = 1 ]; then
      printf '%s\r\n' \
        'HTTP/2 200' \
        'content-type: text/markdown; charset=utf-8' \
        'cache-control: public, max-age=300, must-revalidate, no-transform' \
        'access-control-allow-origin: *' \
        'x-content-type-options: nosniff'
      if [ "\${DEPLOY_TEST_HF_GUIDE_DUPLICATE_CONTENT_TYPE:-0}" = 1 ]; then
        printf '%s\r\n' 'content-type: text/markdown; charset=utf-8'
      fi
      case "\${DEPLOY_TEST_HF_GUIDE_UNEXPECTED_LINK:-0}" in
        1) printf '%s\r\n' 'link: <https://example.invalid/unexpected>; rel="related"' ;;
        empty) printf 'link:\r\n' ;;
      esac
      printf '\r\n'
    else
      serve_path docs/HF-TRAINING-GARDEN.md
    fi
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
    printf '%s\r\n' \
      'HTTP/2 404' \
      'cache-control: no-store, max-age=0' \
      'x-agenttool-sensitive-path-fence: 1' \
      ''
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

const maintenanceIds = {
  apps: ["11111111111111", "22222222222222", "33333333333333"],
  thinkerPrimary: "44444444444444",
  thinkerStandby: "55555555555555",
} as const;

const maintenanceDigest = `sha256:${"b".repeat(64)}`;
const maintenanceOldDigest = `sha256:${"a".repeat(64)}`;

function maintenanceFleet(revision: string): Array<Record<string, any>> {
  const image = () => ({
    registry: "registry.fly.io",
    repository: "agenttool",
    tag: "old-release",
    digest: maintenanceOldDigest,
    labels: {
      "org.opencontainers.image.revision": `old-${revision.slice(0, 8)}`,
      "dev.agenttool.source.dirty": "false",
    },
  });
  const baseConfig = (
    role: "app" | "thinker",
    memory: number,
  ): Record<string, any> => ({
    image: `registry.fly.io/agenttool@${maintenanceOldDigest}`,
    metadata: { fly_process_group: role },
    guest: { cpu_kind: "shared", cpus: 1, memory_mb: memory },
    env: { AGENTTOOL_DISABLE_WORKERS: "1", PORT: "3000" },
    restart: { policy: "no", max_retries: 10 },
    schedule: "",
    services:
      role === "app"
        ? [
            {
              protocol: "tcp",
              internal_port: 3000,
              autostart: false,
              autostop: "off",
              min_machines_running: 1,
              ports: [
                { port: 443, handlers: ["tls", "http"] },
                { port: 80, handlers: ["http"] },
              ],
            },
          ]
        : [],
  });
  const machine = (
    id: string,
    role: "app" | "thinker",
    region: "lhr" | "cdg",
  ) => ({
    id,
    state: "stopped",
    region,
    host_status: "ok",
    cordoned: role === "app",
    version: "1",
    image_ref: image(),
    config: baseConfig(role, role === "app" ? 1024 : 256),
  });
  return [
    machine(maintenanceIds.apps[0], "app", "lhr"),
    machine(maintenanceIds.apps[1], "app", "lhr"),
    machine(maintenanceIds.apps[2], "app", "cdg"),
    machine(maintenanceIds.thinkerPrimary, "thinker", "lhr"),
    machine(maintenanceIds.thinkerStandby, "thinker", "lhr"),
  ];
}

async function installStatefulFakeFly(
  fakeBin: string,
  statePath: string,
  logPath: string,
  revision: string,
  machines = maintenanceFleet(revision),
): Promise<void> {
  await writeFile(
    statePath,
    `${JSON.stringify({
      machines,
      targetDigest: maintenanceDigest,
      imageTag: "",
      revision,
      listCount: 0,
      updateCount: 0,
      imageUpdateCount: 0,
      startCount: 0,
      snapshotRequired: false,
    })}\n`,
  );
  await writeFile(logPath, "");
  await writeFile(
    join(fakeBin, "fly"),
    `#!/usr/bin/env bun
import { appendFile } from "node:fs/promises";

const args = process.argv.slice(2);
const statePath = process.env.DEPLOY_TEST_FLY_STATE;
const logPath = process.env.DEPLOY_TEST_FLY_LOG;
if (!statePath || !logPath) process.exit(91);
await appendFile(logPath, JSON.stringify(args) + "\\n");
const state = await Bun.file(statePath).json();
const save = async () => {
  await Bun.write(statePath, JSON.stringify(state) + "\\n");
};
const has = (flag) => args.includes(flag);
const option = (flag) => {
  const exact = args.indexOf(flag);
  if (exact !== -1) return args[exact + 1];
  const prefix = flag + "=";
  const joined = args.find((arg) => arg.startsWith(prefix));
  return joined === undefined ? undefined : joined.slice(prefix.length);
};
const fail = (message, code = 92) => {
  process.stderr.write(message + "\\n");
  process.exit(code);
};
const machineById = (id) => state.machines.find((machine) => machine.id === id);

if (args[0] === "version") {
  process.stdout.write(
    "fly v0.4.74 darwin/arm64 Commit: b74c9391409b3e443383a5f4d928cef007825ddc BuildDate: fixture\\n",
  );
  process.exit(0);
}

if (args[0] === "deploy") {
  if (!has("--build-only") || !has("--push") || !has("--skip-release-command")) {
    fail("ordinary fly deploy is forbidden in the maintenance fake");
  }
  const label = option("--image-label");
  if (!label) fail("missing image label");
  state.imageTag = "registry.fly.io/agenttool:" + label;
  const revisionIndex = args.indexOf("--build-arg");
  const buildArgs = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--build-arg") buildArgs.push(args[index + 1]);
  }
  if (
    !buildArgs.includes("AGENTTOOL_GIT_REVISION=" + state.revision) ||
    !buildArgs.includes("AGENTTOOL_SOURCE_DIRTY=false")
  ) {
    fail("build provenance is not exact");
  }
  if (process.env.DEPLOY_TEST_DRIFT_DURING_BUILD === "1") {
    state.machines[0].cordoned = !state.machines[0].cordoned;
  }
  state.snapshotRequired = true;
  await save();
  const blockMarker = process.env.DEPLOY_TEST_BLOCK_BUILD_MARKER;
  const blockRelease = process.env.DEPLOY_TEST_BLOCK_BUILD_RELEASE;
  if (blockMarker || blockRelease) {
    if (!blockMarker || !blockRelease) fail("incomplete build-block fixture");
    await Bun.write(blockMarker, "started\\n");
    while (!(await Bun.file(blockRelease).exists())) await Bun.sleep(20);
  }
  const replacementMarker =
    process.env.DEPLOY_TEST_REPLACE_MAINTENANCE_MARKER;
  if (replacementMarker) {
    await Bun.write(
      replacementMarker,
      JSON.stringify({
        schema: "agenttool-maintenance-run/v1",
        rollout_id: "foreign-rollout",
      }) + "\\n",
    );
  }
  process.exit(0);
}

if (args[0] === "ssh" && args[1] === "console") {
  const machine = machineById(option("--machine"));
  const command = option("-C");
  if (
    !machine ||
    machine.state !== "started" ||
    machine.config.metadata.fly_process_group !== "app" ||
    typeof command !== "string" ||
    !command.startsWith("sh -c 'test ") ||
    !command.includes("AGENTTOOL_GIT_REVISION") ||
    !command.includes("AGENTTOOL_SOURCE_DIRTY") ||
    !command.includes("AGENTTOOL_DISABLE_WORKERS") ||
    command.includes("printenv")
  ) {
    fail("SSH proof is not silent and exact", 98);
  }
  if (
    process.env.DEPLOY_TEST_FAIL_SSH_ID &&
    option("--machine") === process.env.DEPLOY_TEST_FAIL_SSH_ID
  ) {
    process.exit(25);
  }
  process.exit(0);
}

if (args[0] !== "machine") fail("unsupported fly command");
const action = args[1];

if (action === "list") {
  if (
    JSON.stringify(args) !==
    JSON.stringify(["machine", "list", "-a", "agenttool", "--json"])
  ) {
    fail("machine list flags are not exact");
  }
  state.snapshotRequired = false;
  const offset = state.listCount % state.machines.length;
  state.listCount += 1;
  const rotated = [
    ...state.machines.slice(offset),
    ...state.machines.slice(0, offset),
  ];
  await save();
  process.stdout.write(JSON.stringify(rotated));
  process.exit(0);
}

if (action === "update") {
  if (state.snapshotRequired) fail("mutation attempted without a fresh full inventory", 93);
  const id = args[2];
  const machine = machineById(id);
  if (!machine) fail("unknown Machine ID", 94);
  const enablingAutostart = has("--autostart=true");
  if (
    !has("--build-remote-only") ||
    !has("--yes") ||
    (enablingAutostart ? has("--skip-start") : !has("--skip-start")) ||
    (enablingAutostart && has("--skip-health-checks"))
  ) {
    fail("unsafe machine update flags");
  }
  if (
    enablingAutostart &&
    (machine.state !== "started" ||
      machine.config.metadata.fly_process_group !== "app")
  ) {
    fail("autostart can only be restored on an explicitly started app");
  }
  const image = option("--image");
  if (image !== undefined) {
    state.imageUpdateCount += 1;
    const expected =
      state.imageUpdateCount === 1
        ? state.imageTag
        : state.imageTag + "@" + state.targetDigest;
    if (image !== expected) {
      fail("mutable or unexpected image reference: " + image, 95);
    }
    machine.image_ref = {
      registry: "registry.fly.io",
      repository: "agenttool",
      tag: state.imageTag.split(":").at(-1),
      digest: state.targetDigest,
      labels: {
        "org.opencontainers.image.revision": state.revision,
        "dev.agenttool.source.dirty": "false",
      },
    };
    machine.config.image = "registry.fly.io/agenttool@" + state.targetDigest;
  }
  const wrongTagAfter = Number(
    process.env.DEPLOY_TEST_WRONG_TAG_AFTER_UPDATE ?? "0",
  );
  if (
    wrongTagAfter > 0 &&
    state.imageUpdateCount === wrongTagAfter &&
    image !== undefined
  ) {
    machine.image_ref.tag = "wrong-rollout-tag";
  }
  if (has("--autostart=false")) {
    for (const service of machine.config.services ?? []) service.autostart = false;
  }
  if (has("--autostart=true")) {
    for (const service of machine.config.services ?? []) service.autostart = true;
  }
  if (option("--restart") !== undefined) {
    fail("--restart drops max_retries in pinned flyctl");
  }
  const machineConfigText = option("--machine-config");
  let machineConfig;
  try {
    machineConfig = JSON.parse(machineConfigText);
  } catch {
    fail("machine update requires valid --machine-config JSON");
  }
  if (
    !machineConfig ||
    Object.keys(machineConfig).join(",") !== "restart" ||
    !["no", "on-failure"].includes(machineConfig.restart?.policy) ||
    machineConfig.restart?.max_retries !== 10 ||
    Object.keys(machineConfig.restart).sort().join(",") !==
      "max_retries,policy"
  ) {
    fail("machine update restart projection is not exact");
  }
  machine.config.restart = {
    ...machine.config.restart,
    ...structuredClone(machineConfig.restart),
  };
  const standbyFlag = args.find((arg) => arg.startsWith("--standby-for="));
  const standbyValue =
    standbyFlag !== undefined ? standbyFlag.slice("--standby-for=".length) : option("--standby-for");
  if (standbyFlag !== undefined || option("--standby-for") !== undefined) {
    if (standbyValue) {
      machine.config.standbys = standbyValue.split(",");
    } else {
      delete machine.config.standbys;
    }
    machine.config.env.FLY_STANDBY_FOR = standbyValue ?? "";
  }
  machine.state = enablingAutostart ? "started" : "stopped";
  machine.version = String(Number(machine.version) + 1);
  state.updateCount += 1;
  const driftAfter = Number(process.env.DEPLOY_TEST_DRIFT_CONFIG_AFTER_UPDATE ?? "0");
  if (driftAfter > 0 && state.updateCount === driftAfter) {
    machine.config.metadata.unexpected_provider_drift = "present";
  }
  const swapRegionsAfter = Number(
    process.env.DEPLOY_TEST_SWAP_REGIONS_AFTER_UPDATE ?? "0",
  );
  if (swapRegionsAfter > 0 && state.updateCount === swapRegionsAfter) {
    const first = machineById("${maintenanceIds.apps[0]}");
    const third = machineById("${maintenanceIds.apps[2]}");
    [first.region, third.region] = [third.region, first.region];
  }
  const rollbackAfter = Number(
    process.env.DEPLOY_TEST_ROLLBACK_IMAGE_AFTER_UPDATE ?? "0",
  );
  if (rollbackAfter > 0 && state.updateCount === rollbackAfter) {
    machine.image_ref = {
      registry: "registry.fly.io",
      repository: "agenttool",
      tag: "old-release",
      digest: "${maintenanceOldDigest}",
      labels: {
        "org.opencontainers.image.revision": "old-" + state.revision.slice(0, 8),
        "dev.agenttool.source.dirty": "false",
      },
    };
    machine.config.image = "registry.fly.io/agenttool@${maintenanceOldDigest}";
  }
  const lifecycleDriftAfter = Number(
    process.env.DEPLOY_TEST_DRIFT_UNTOUCHED_LIFECYCLE_AFTER_UPDATE ?? "0",
  );
  if (
    lifecycleDriftAfter > 0 &&
    state.updateCount === lifecycleDriftAfter
  ) {
    const untouched = machineById("${maintenanceIds.apps[1]}");
    untouched.state = "stopped";
    untouched.config.restart = { policy: "no", max_retries: 10 };
    for (const service of untouched.config.services ?? []) {
      service.autostart = false;
    }
    untouched.version = String(Number(untouched.version) + 1);
  }
  state.snapshotRequired = true;
  const replaceAfter = Number(process.env.DEPLOY_TEST_REPLACE_AFTER_UPDATE ?? "0");
  if (replaceAfter > 0 && state.updateCount === replaceAfter) {
    const victim = state.machines.find(
      (candidate) => candidate.id === "${maintenanceIds.thinkerStandby}",
    );
    if (victim) victim.id = "66666666666666";
  }
  await save();
  const failAfter = Number(process.env.DEPLOY_TEST_FAIL_UPDATE_AFTER_APPLY ?? "0");
  if (failAfter > 0 && state.updateCount === failAfter) process.exit(23);
  process.exit(0);
}

if (action === "start") {
  if (state.snapshotRequired) fail("start attempted without a fresh full inventory", 96);
  const ids = [];
  for (const arg of args.slice(2)) {
    if (arg.startsWith("-")) break;
    ids.push(arg);
  }
  const expected = ${JSON.stringify([...maintenanceIds.apps])};
  if (
    ids.length !== 1 ||
    state.startCount >= expected.length ||
    ids[0] !== expected[state.startCount] ||
    JSON.stringify(args) !==
      JSON.stringify(["machine", "start", ids[0], "-a", "agenttool"])
  ) {
    fail("start did not name the next exact app ID", 97);
  }
  const machine = machineById(ids[0]);
  if (
    machine.config.restart?.policy !== "on-failure" ||
    machine.config.restart?.max_retries !== 10 ||
    machine.config.services?.[0]?.autostart !== false
  ) {
    fail("app start occurred before exact restart/autostart restoration");
  }
  machine.state = "started";
  state.startCount += 1;
  state.snapshotRequired = true;
  await save();
  process.exit(0);
}

if (action === "wait") {
  const machine = machineById(args[2]);
  if (
    !machine ||
    machine.state !== "started" ||
    JSON.stringify(args) !==
      JSON.stringify([
        "machine",
        "wait",
        machine.id,
        "-a",
        "agenttool",
        "--state",
        "started",
        "--wait-timeout",
        "5m0s",
      ])
  ) {
    process.exit(24);
  }
  process.exit(0);
}

fail("unsupported machine action");
`,
  );
  await chmod(join(fakeBin, "fly"), 0o755);
}

function maintenanceCommand(...extra: string[]): string[] {
  return [
    "bash",
    "bin/deploy.sh",
    "--no-migrate",
    "--no-frontend",
    "--maintenance-fenced-api",
    `--maintenance-app-machines=${maintenanceIds.apps.join(",")}`,
    `--maintenance-thinker-primary=${maintenanceIds.thinkerPrimary}`,
    `--maintenance-thinker-standby=${maintenanceIds.thinkerStandby}`,
    ...extra,
  ];
}

function maintenanceMarkerPath(home: string): string {
  return join(
    home,
    ".local",
    "state",
    "agenttool",
    "deploy-state",
    "maintenance-active.json",
  );
}

async function readFlyLog(path: string): Promise<string[][]> {
  const text = await readFile(path, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
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

function deployWithPreparationCommand(...extra: string[]): string[] {
  return [
    "bash",
    "bin/deploy.sh",
    "--no-migrate",
    "--no-api",
    "--no-frontend",
    ...extra,
  ];
}

function deployLockPath(home: string): string {
  return join(home, ".local", "state", "agenttool", "deploy.lock");
}

afterAll(async () => {
  await Promise.all(
    cleanup.map((path) => rm(path, { recursive: true, force: true })),
  );
}, 60_000);

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
    expect(dockerfile).toContain(
      "AGENTTOOL_GIT_REVISION=${AGENTTOOL_GIT_REVISION}",
    );
    expect(dockerfile).toContain(
      "AGENTTOOL_SOURCE_DIRTY=${AGENTTOOL_SOURCE_DIRTY}",
    );
    expect(dockerfile).toContain("org.opencontainers.image.revision");
    expect(dockerfile).toContain("dev.agenttool.source.dirty");
    expect(dockerfile).toContain("test -s src/index.ts");
    expect(dockerfile).toContain("find src -type f -name '*.ts' -size 0");
    expect(deploy).toContain(
      '--build-arg "AGENTTOOL_GIT_REVISION=$HEAD_REVISION"',
    );
    expect(deploy).toContain(
      '--build-arg "AGENTTOOL_SOURCE_DIRTY=$API_SOURCE_DIRTY"',
    );
    expect(deploy).toContain("FLY_DEPLOY_ARGS+=(--no-cache)");
    expect(deploy).toContain("fly machine list");
    expect(deploy).toContain('test \\"\\${AGENTTOOL_GIT_REVISION:-}\\"');
    expect(deploy).toContain("sh -c '$remote_command'");
    expect(deploy).not.toContain("printenv AGENTTOOL_GIT_REVISION");
    expect(deploy).not.toContain("--maintenance-from-zero");
    expect(deploy).not.toContain("fly scale count");
    expect(deploy).toContain("trap 'on_deploy_exit");
    expect(deploy).toContain("https://docs.agenttool.dev/.gitignore");
    expect(deploy).toContain("https://app.agenttool.dev/.env.local");
    expect(deploy).toContain("https://agenttool.dev/.dev.vars");
    expect(deploy).toContain("x-agenttool-sensitive-path-fence:");
    expect(deploy).toContain(
      "Frontend fence did not produce its marked non-cacheable 404",
    );
    expect(deploy).not.toContain(
      "Encoded sensitive path is publicly reachable",
    );
    expect(deploy).toContain('DEPLOY_LOCK_PATH="$lock_parent/deploy.lock"');
    expect(deploy).toContain(
      'ln "$DEPLOY_LOCK_OWNER_RECORD" "$DEPLOY_LOCK_PATH"',
    );
    expect(deploy).toContain(
      '[ "$DEPLOY_LOCK_OWNER_RECORD" -ef "$DEPLOY_LOCK_PATH" ]',
    );
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
      '#!/usr/bin/env bash\nset -eu\nprintf \'%s\\n\' "$@" > "$DEPLOY_TEST_FLY_ARGS"\nexit 9\n',
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
        DEPLOY_TEST_RIGHTS_SCHEMA: join(
          setup.repo,
          "apps/docs/being-rights-v1.schema.json",
        ),
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
    expect(await exists(join(setup.repo, "api/agenttool.jsonld.bundled"))).toBe(
      false,
    );
    expect(
      await exists(join(setup.repo, "api/kingdom-bundle.json.bundled")),
    ).toBe(false);
    expect(await exists(join(setup.repo, "api/doctrine-docs.bundled"))).toBe(
      false,
    );
    const [receiptName] = await readdir(
      join(setup.state, "agenttool", "deploy-receipts"),
    );
    const receipt = JSON.parse(
      await readFile(
        join(setup.state, "agenttool", "deploy-receipts", receiptName),
        "utf8",
      ),
    );
    expect(receipt.schema).toBe("agenttool-deploy-receipt/v4");
    expect(receipt.api_build).toEqual({ cache: "bypassed", image: null });

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

  test("rejects the retired from-zero flag before any release work", async () => {
    const setup = await fixture();
    const migrationMarker = join(setup.root, "retired-mode-migration");
    const preflightMarker = join(setup.root, "retired-mode-preflight");
    const frontendMarker = join(setup.root, "retired-mode-frontend");

    const result = await run(
      ["bash", "bin/deploy.sh", "--maintenance-from-zero"],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        MIGRATION_MARKER: migrationMarker,
        PREFLIGHT_MARKER: preflightMarker,
        DEPLOY_TEST_FRONTEND_MARKER: frontendMarker,
      }),
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("unknown flag: --maintenance-from-zero");
    expect(await exists(migrationMarker)).toBe(false);
    expect(await exists(preflightMarker)).toBe(false);
    expect(await exists(frontendMarker)).toBe(false);
    expect(
      await exists(join(setup.state, "agenttool", "deploy-receipts")),
    ).toBe(false);
  });

  test("rejects unsafe maintenance selectors and an unresolved marker before Fly or preflight", async () => {
    const setup = await fixture();
    const preflightMarker = join(setup.root, "maintenance-preflight");
    const fakeBin = join(setup.root, "maintenance-guard-bin");
    const flyMarker = join(setup.root, "maintenance-fly");
    await mkdir(fakeBin, { recursive: true });
    await writeFile(
      join(fakeBin, "fly"),
      '#!/usr/bin/env bash\ntouch "$DEPLOY_TEST_FLY_MARKER"\nexit 99\n',
    );
    await chmod(join(fakeBin, "fly"), 0o755);

    for (const command of [
      maintenanceCommand("--skip-preflight"),
      maintenanceCommand("--maintenance-fenced-api"),
      [
        "bash",
        "bin/deploy.sh",
        "--no-migrate",
        "--maintenance-fenced-api",
        `--maintenance-app-machines=${maintenanceIds.apps.join(",")}`,
        `--maintenance-thinker-primary=${maintenanceIds.thinkerPrimary}`,
        `--maintenance-thinker-standby=${maintenanceIds.thinkerStandby}`,
      ],
      [
        "bash",
        "bin/deploy.sh",
        "--no-migrate",
        "--no-frontend",
        "--maintenance-app-machines=11111111111111,11111111111111,33333333333333",
        `--maintenance-thinker-primary=${maintenanceIds.thinkerPrimary}`,
        `--maintenance-thinker-standby=${maintenanceIds.thinkerStandby}`,
      ],
    ]) {
      const result = await run(
        command,
        setup.repo,
        cleanEnv(setup.home, {
          XDG_STATE_HOME: setup.state,
          PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          PREFLIGHT_MARKER: preflightMarker,
          DEPLOY_TEST_FLY_MARKER: flyMarker,
        }),
      );
      expect(result.code).not.toBe(0);
    }
    expect(await exists(preflightMarker)).toBe(false);
    expect(await exists(flyMarker)).toBe(false);

    const marker = maintenanceMarkerPath(setup.home);
    await mkdir(resolve(marker, ".."), { recursive: true });
    await writeFile(marker, '{"schema":"agenttool-maintenance-run/v1"}\n');
    await chmod(marker, 0o600);
    const blocked = await run(
      maintenanceCommand(),
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        PREFLIGHT_MARKER: preflightMarker,
        DEPLOY_TEST_FLY_MARKER: flyMarker,
      }),
    );
    expect(blocked.code).toBe(74);
    expect(blocked.stderr).toContain(
      "an unresolved maintenance rollout marker exists",
    );
    expect(await exists(preflightMarker)).toBe(false);
    expect(await exists(flyMarker)).toBe(false);
    expect(
      await exists(join(setup.state, "agenttool", "deploy-receipts")),
    ).toBe(false);

    const blockedWithDifferentXdg = await run(
      maintenanceCommand(),
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: join(setup.root, "different-xdg-state"),
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        PREFLIGHT_MARKER: preflightMarker,
        DEPLOY_TEST_FLY_MARKER: flyMarker,
      }),
    );
    expect(blockedWithDifferentXdg.code).toBe(74);
    expect(await exists(preflightMarker)).toBe(false);
    expect(await exists(flyMarker)).toBe(false);
  }, 15_000);

  test("requires the exact stopped fenced five-Machine topology before creating durable state", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "maintenance-shape-bin");
    const flyState = join(setup.root, "maintenance-shape-state.json");
    const flyLog = join(setup.root, "maintenance-shape-log.jsonl");
    const preflightMarker = join(setup.root, "maintenance-shape-preflight");
    await mkdir(fakeBin, { recursive: true });
    await installStatefulFakeFly(fakeBin, flyState, flyLog, setup.release, [
      ...maintenanceFleet(setup.release),
      {
        ...maintenanceFleet(setup.release)[0],
        id: "66666666666666",
      },
    ]);

    const result = await run(
      maintenanceCommand(),
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        PREFLIGHT_MARKER: preflightMarker,
        DEPLOY_TEST_FLY_STATE: flyState,
        DEPLOY_TEST_FLY_LOG: flyLog,
      }),
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "expected exactly five Machines, observed 6",
    );
    expect(await exists(preflightMarker)).toBe(false);
    expect(await exists(maintenanceMarkerPath(setup.home))).toBe(false);
    const log = await readFlyLog(flyLog);
    expect(log.map((args) => args.slice(0, 2))).toEqual([
      ["version"],
      ["machine", "list"],
    ]);
  }, 15_000);

  test("fails closed when the canonical marker path cannot be inspected", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "maintenance-uninspectable-marker-bin");
    const flyMarker = join(setup.root, "maintenance-uninspectable-fly");
    const preflightMarker = join(
      setup.root,
      "maintenance-uninspectable-preflight",
    );
    const marker = maintenanceMarkerPath(setup.home);
    const markerParent = resolve(marker, "..");
    await mkdir(fakeBin, { recursive: true });
    await mkdir(markerParent, { recursive: true });
    await writeFile(marker, '{"rollout_id":"unresolved"}\n');
    await writeFile(
      join(fakeBin, "fly"),
      '#!/usr/bin/env bash\ntouch "$DEPLOY_TEST_FLY_MARKER"\nexit 99\n',
    );
    await chmod(join(fakeBin, "fly"), 0o755);
    await chmod(markerParent, 0o000);

    let result;
    try {
      result = await run(
        maintenanceCommand(),
        setup.repo,
        cleanEnv(setup.home, {
          XDG_STATE_HOME: setup.state,
          PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          DEPLOY_TEST_FLY_MARKER: flyMarker,
          PREFLIGHT_MARKER: preflightMarker,
        }),
      );
    } finally {
      await chmod(markerParent, 0o700);
    }
    expect(result.code).toBe(74);
    expect(await exists(flyMarker)).toBe(false);
    expect(await exists(preflightMarker)).toBe(false);
  }, 15_000);

  test("refuses a late marker and an observed foreign owner before the next checkpoint", async () => {
    {
      const setup = await fixture();
      const fakeBin = join(setup.root, "maintenance-late-marker-bin");
      const flyState = join(setup.root, "maintenance-late-marker-state.json");
      const flyLog = join(setup.root, "maintenance-late-marker-log.jsonl");
      const marker = maintenanceMarkerPath(setup.home);
      await mkdir(fakeBin, { recursive: true });
      await mkdir(resolve(marker, ".."), { recursive: true });
      await installFakeRightsCurl(fakeBin);
      await installStatefulFakeFly(fakeBin, flyState, flyLog, setup.release);

      const result = await run(
        maintenanceCommand(),
        setup.repo,
        cleanEnv(setup.home, {
          XDG_STATE_HOME: setup.state,
          PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          PREFLIGHT_MARKER: marker,
          DEPLOY_TEST_FLY_STATE: flyState,
          DEPLOY_TEST_FLY_LOG: flyLog,
        }),
      );
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(
        "Refusing to overwrite an unresolved maintenance rollout marker",
      );
      expect(await readFile(marker, "utf8")).toBe("");
      const mutations = (await readFlyLog(flyLog)).filter(
        (args) =>
          args[0] === "deploy" || (args[0] === "machine" && args[1] !== "list"),
      );
      expect(mutations).toHaveLength(0);
    }

    {
      const setup = await fixture();
      const fakeBin = join(setup.root, "maintenance-foreign-marker-bin");
      const flyState = join(
        setup.root,
        "maintenance-foreign-marker-state.json",
      );
      const flyLog = join(setup.root, "maintenance-foreign-marker-log.jsonl");
      const marker = maintenanceMarkerPath(setup.home);
      await mkdir(fakeBin, { recursive: true });
      await installFakeRightsCurl(fakeBin);
      await installStatefulFakeFly(fakeBin, flyState, flyLog, setup.release);

      const result = await run(
        maintenanceCommand(),
        setup.repo,
        cleanEnv(setup.home, {
          XDG_STATE_HOME: setup.state,
          PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          DEPLOY_TEST_FLY_STATE: flyState,
          DEPLOY_TEST_FLY_LOG: flyLog,
          DEPLOY_TEST_REPLACE_MAINTENANCE_MARKER: marker,
        }),
      );
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(
        "Maintenance state belongs to another rollout",
      );
      expect(result.stderr).toContain(
        "no recovery mutation or marker replacement was attempted",
      );
      expect(JSON.parse(await readFile(marker, "utf8")).rollout_id).toBe(
        "foreign-rollout",
      );
      const updates = (await readFlyLog(flyLog)).filter(
        (args) => args[0] === "machine" && args[1] === "update",
      );
      expect(updates).toHaveLength(0);
    }
  }, 20_000);

  test("rejects a stale standby environment even when the standby list is empty", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "maintenance-stale-standby-bin");
    const flyState = join(setup.root, "maintenance-stale-standby-state.json");
    const flyLog = join(setup.root, "maintenance-stale-standby-log.jsonl");
    const fleet = maintenanceFleet(setup.release);
    const primary = fleet.find(
      (machine) => machine.id === maintenanceIds.thinkerPrimary,
    ) as Record<string, any>;
    primary.config.env.FLY_STANDBY_FOR = maintenanceIds.apps[0];
    await mkdir(fakeBin, { recursive: true });
    await installStatefulFakeFly(
      fakeBin,
      flyState,
      flyLog,
      setup.release,
      fleet,
    );

    const result = await run(
      maintenanceCommand(),
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        DEPLOY_TEST_FLY_STATE: flyState,
        DEPLOY_TEST_FLY_LOG: flyLog,
      }),
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("standby environment is not empty");
    expect(await exists(maintenanceMarkerPath(setup.home))).toBe(false);
    expect(
      (await readFlyLog(flyLog)).filter(
        (args) => args[0] === "machine" && args[1] === "update",
      ),
    ).toHaveLength(0);
  }, 15_000);

  test("rolls the exact five Machines from one tag read-back to one immutable digest", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "maintenance-success-bin");
    const flyState = join(setup.root, "maintenance-success-state.json");
    const flyLog = join(setup.root, "maintenance-success-log.jsonl");
    await mkdir(fakeBin, { recursive: true });
    await installFakeRightsCurl(fakeBin);
    await installStatefulFakeFly(fakeBin, flyState, flyLog, setup.release);

    const result = await run(
      maintenanceCommand(),
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        DEPLOY_TEST_FLY_STATE: flyState,
        DEPLOY_TEST_FLY_LOG: flyLog,
        DEPLOY_TEST_HEALTH_OK: "1",
        DEPLOY_TEST_HEALTH_REVISION: setup.release,
      }),
    );
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);

    const log = await readFlyLog(flyLog);
    const deploys = log.filter((args) => args[0] === "deploy");
    expect(deploys).toHaveLength(1);
    expect(deploys[0]).toContain("--build-only");
    expect(deploys[0]).toContain("--push");
    expect(deploys[0]).toContain("--skip-release-command");
    expect(deploys[0]).not.toContain("--strategy");
    expect(deploys[0]).not.toContain("--update-only");

    const updates = log.filter(
      (args) => args[0] === "machine" && args[1] === "update",
    );
    expect(updates).toHaveLength(13);
    const imageUpdates = updates.filter((args) => args.includes("--image"));
    expect(imageUpdates).toHaveLength(5);
    const autostartUpdates = updates.filter((args) =>
      args.includes("--autostart=true"),
    );
    expect(autostartUpdates).toHaveLength(3);
    expect(imageUpdates[0][2]).toBe(maintenanceIds.thinkerPrimary);
    const firstImage = imageUpdates[0][imageUpdates[0].indexOf("--image") + 1];
    expect(firstImage).toMatch(/^registry\.fly\.io\/agenttool:maintenance-/);
    expect(firstImage).not.toContain("@sha256:");
    for (const update of imageUpdates.slice(1)) {
      expect(update[update.indexOf("--image") + 1]).toBe(
        `${firstImage}@${maintenanceDigest}`,
      );
    }
    for (const update of updates) {
      expect(update).toContain("--build-remote-only");
      expect(update).toContain("--yes");
      if (update.includes("--autostart=true")) {
        expect(update).not.toContain("--skip-start");
        expect(update).not.toContain("--skip-health-checks");
      } else {
        expect(update).toContain("--skip-start");
      }
    }
    const updateIndexes = log
      .map((args, index) => ({ args, index }))
      .filter(({ args }) => args[0] === "machine" && args[1] === "update")
      .map(({ index }) => index);
    for (let index = 0; index < updateIndexes.length - 1; index += 1) {
      expect(
        log
          .slice(updateIndexes[index] + 1, updateIndexes[index + 1])
          .some((args) => args[0] === "machine" && args[1] === "list"),
      ).toBe(true);
    }
    const startIndexes = log
      .map((args, index) => ({ args, index }))
      .filter(({ args }) => args[0] === "machine" && args[1] === "start")
      .map(({ index }) => index);
    const firstAutostartIndex = log.findIndex(
      (args) =>
        args[0] === "machine" &&
        args[1] === "update" &&
        args.includes("--autostart=true"),
    );
    const lastImageUpdateIndex = log.findLastIndex(
      (args) =>
        args[0] === "machine" &&
        args[1] === "update" &&
        args.includes("--image"),
    );
    expect(startIndexes).toHaveLength(3);
    expect(startIndexes[0]).toBeGreaterThan(lastImageUpdateIndex);
    expect(firstAutostartIndex).toBeGreaterThan(startIndexes[2]);
    expect(startIndexes.map((index) => log[index][2])).toEqual([
      ...maintenanceIds.apps,
    ]);
    for (let index = 0; index < startIndexes.length; index += 1) {
      const nextMutationIndex =
        index + 1 < startIndexes.length
          ? startIndexes[index + 1]
          : firstAutostartIndex;
      expect(
        log
          .slice(startIndexes[index] + 1, nextMutationIndex)
          .some((args) => args[0] === "machine" && args[1] === "list"),
      ).toBe(true);
    }
    const ssh = log.filter(
      (args) => args[0] === "ssh" && args[1] === "console",
    );
    expect(ssh).toHaveLength(3);
    expect(
      ssh.every((args) =>
        args[args.indexOf("-C") + 1].startsWith("sh -c 'test "),
      ),
    ).toBe(true);

    const finalState = JSON.parse(await readFile(flyState, "utf8"));
    const byId = new Map(
      finalState.machines.map((machine: Record<string, any>) => [
        machine.id,
        machine,
      ]),
    );
    for (const id of maintenanceIds.apps) {
      expect((byId.get(id) as any).state).toBe("started");
      expect((byId.get(id) as any).image_ref.digest).toBe(maintenanceDigest);
      expect((byId.get(id) as any).config.services[0].autostart).toBe(true);
    }
    expect((byId.get(maintenanceIds.thinkerPrimary) as any).state).toBe(
      "stopped",
    );
    expect((byId.get(maintenanceIds.thinkerStandby) as any).state).toBe(
      "stopped",
    );
    expect(
      (byId.get(maintenanceIds.thinkerStandby) as any).config.standbys,
    ).toEqual([maintenanceIds.thinkerPrimary]);
    expect(
      (byId.get(maintenanceIds.thinkerStandby) as any).config.env
        .FLY_STANDBY_FOR,
    ).toBe(maintenanceIds.thinkerPrimary);

    const receiptDir = join(setup.state, "agenttool", "deploy-receipts");
    const [receiptName] = await readdir(receiptDir);
    const receiptText = await readFile(join(receiptDir, receiptName), "utf8");
    const receipt = JSON.parse(receiptText);
    expect(receipt.schema).toBe("agenttool-deploy-receipt/v4");
    expect(receipt.mode).toBe("maintenance_rollout");
    expect(receipt.outcome).toBe("succeeded");
    expect(receipt.verified_api_machines).toBe(5);
    expect(receipt.api_build.image.digest).toBe(maintenanceDigest);
    expect(receipt.maintenance).toMatchObject({
      image_verified_machine_count: 5,
      started_app_machine_count: 3,
      stopped_thinker_machine_count: 2,
      fleet_image_verified: true,
      final_topology_verified: true,
      workers_disabled_started_apps_verified: true,
      recovery_required: null,
      active_marker_cleared: null,
      marker_absence_required_for_success: true,
    });
    for (const id of [
      ...maintenanceIds.apps,
      maintenanceIds.thinkerPrimary,
      maintenanceIds.thinkerStandby,
    ]) {
      expect(receiptText).not.toContain(id);
    }
    expect(await exists(maintenanceMarkerPath(setup.home))).toBe(false);
  }, 20_000);

  test("keeps the durable fence when the final success receipt cannot be installed", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "maintenance-receipt-failure-bin");
    const flyState = join(setup.root, "maintenance-receipt-failure-state.json");
    const flyLog = join(setup.root, "maintenance-receipt-failure-log.jsonl");
    const receiptPath = join(setup.state, "agenttool", "deploy-receipts");
    await mkdir(fakeBin, { recursive: true });
    await mkdir(join(setup.state, "agenttool"), { recursive: true });
    await writeFile(receiptPath, "not-a-directory\n");
    await installFakeRightsCurl(fakeBin);
    await installStatefulFakeFly(fakeBin, flyState, flyLog, setup.release);
    const env = cleanEnv(setup.home, {
      XDG_STATE_HOME: setup.state,
      PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      DEPLOY_TEST_FLY_STATE: flyState,
      DEPLOY_TEST_FLY_LOG: flyLog,
      DEPLOY_TEST_HEALTH_OK: "1",
      DEPLOY_TEST_HEALTH_REVISION: setup.release,
    });

    const result = await run(maintenanceCommand(), setup.repo, env);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain("Cannot create deploy receipt directory");
    const marker = maintenanceMarkerPath(setup.home);
    expect(await exists(marker)).toBe(true);
    const markerDocument = JSON.parse(await readFile(marker, "utf8"));
    expect(markerDocument.checkpoint).toBe("failed_or_uncertain");
    expect(markerDocument.recovery_required).toBe(true);
    const recoveryUpdates = (await readFlyLog(flyLog)).filter(
      (args) =>
        args[0] === "machine" &&
        args[1] === "update" &&
        !args.includes("--image") &&
        args[args.indexOf("--machine-config") + 1] ===
          '{"restart":{"policy":"no","max_retries":10}}',
    );
    expect(recoveryUpdates).toHaveLength(5);
    expect(
      recoveryUpdates.every((args) => !args.includes(maintenanceOldDigest)),
    ).toBe(true);

    const beforeRetry = (await readFlyLog(flyLog)).length;
    const retry = await run(maintenanceCommand(), setup.repo, env);
    expect(retry.code).toBe(74);
    expect((await readFlyLog(flyLog)).length).toBe(beforeRetry);
  }, 20_000);

  test("removes a provisional success receipt when marker finalization fails", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "maintenance-marker-remove-failure-bin");
    const flyState = join(
      setup.root,
      "maintenance-marker-remove-failure-state.json",
    );
    const flyLog = join(
      setup.root,
      "maintenance-marker-remove-failure-log.jsonl",
    );
    const marker = maintenanceMarkerPath(setup.home);
    await mkdir(fakeBin, { recursive: true });
    await installFakeRightsCurl(fakeBin);
    await installStatefulFakeFly(fakeBin, flyState, flyLog, setup.release);
    await writeFile(
      join(fakeBin, "rm"),
      `#!/usr/bin/env bash
set -u
for candidate in "$@"; do
  if [ -n "\${DEPLOY_TEST_FAIL_RM_PATH:-}" ] &&
    [ "$candidate" = "$DEPLOY_TEST_FAIL_RM_PATH" ]; then
    exit 29
  fi
done
exec /bin/rm "$@"
`,
    );
    await chmod(join(fakeBin, "rm"), 0o755);

    const result = await run(
      maintenanceCommand(),
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        DEPLOY_TEST_FLY_STATE: flyState,
        DEPLOY_TEST_FLY_LOG: flyLog,
        DEPLOY_TEST_HEALTH_OK: "1",
        DEPLOY_TEST_HEALTH_REVISION: setup.release,
        DEPLOY_TEST_FAIL_RM_PATH: marker,
      }),
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(
      "Could not remove the completed maintenance marker",
    );
    expect(await exists(marker)).toBe(true);
    const markerDocument = JSON.parse(await readFile(marker, "utf8"));
    expect(markerDocument.checkpoint).toBe("failed_or_uncertain");
    const receiptDir = join(setup.state, "agenttool", "deploy-receipts");
    const receiptNames = await readdir(receiptDir);
    expect(receiptNames).toHaveLength(1);
    const receipt = JSON.parse(
      await readFile(join(receiptDir, receiptNames[0]), "utf8"),
    );
    expect(receipt.outcome).toBe("failed_or_uncertain");
    expect(receipt.maintenance.active_marker_cleared).toBe(false);
  }, 20_000);

  test("does not authorize another recovery mutation after a semantic read-back failure", async () => {
    for (const scenario of [
      {
        name: "config-drift",
        env: { DEPLOY_TEST_DRIFT_CONFIG_AFTER_UPDATE: "14" },
        expectedError: "full non-image configuration drifted",
      },
      {
        name: "image-rollback",
        env: { DEPLOY_TEST_ROLLBACK_IMAGE_AFTER_UPDATE: "14" },
        expectedError: "image changed during recovery",
      },
      {
        name: "untouched-lifecycle-drift",
        env: {
          DEPLOY_TEST_DRIFT_UNTOUCHED_LIFECYCLE_AFTER_UPDATE: "14",
        },
        expectedError:
          "untouched Machine 22222222222222 recovery lifecycle drifted",
      },
    ]) {
      const setup = await fixture();
      const fakeBin = join(
        setup.root,
        `maintenance-recovery-${scenario.name}-bin`,
      );
      const flyState = join(
        setup.root,
        `maintenance-recovery-${scenario.name}-state.json`,
      );
      const flyLog = join(
        setup.root,
        `maintenance-recovery-${scenario.name}-log.jsonl`,
      );
      const receiptPath = join(setup.state, "agenttool", "deploy-receipts");
      await mkdir(fakeBin, { recursive: true });
      await mkdir(join(setup.state, "agenttool"), { recursive: true });
      await writeFile(receiptPath, "not-a-directory\n");
      await installFakeRightsCurl(fakeBin);
      await installStatefulFakeFly(fakeBin, flyState, flyLog, setup.release);

      const result = await run(
        maintenanceCommand(),
        setup.repo,
        cleanEnv(setup.home, {
          XDG_STATE_HOME: setup.state,
          PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          DEPLOY_TEST_FLY_STATE: flyState,
          DEPLOY_TEST_FLY_LOG: flyLog,
          DEPLOY_TEST_HEALTH_OK: "1",
          DEPLOY_TEST_HEALTH_REVISION: setup.release,
          ...scenario.env,
        }),
      );
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(scenario.expectedError);
      const recoveryUpdates = (await readFlyLog(flyLog)).filter(
        (args) =>
          args[0] === "machine" &&
          args[1] === "update" &&
          !args.includes("--image") &&
          args[args.indexOf("--machine-config") + 1] ===
            '{"restart":{"policy":"no","max_retries":10}}',
      );
      expect(recoveryUpdates).toHaveLength(1);
      expect(result.stderr).toContain(
        "no later recovery mutation is authorized",
      );
      const markerDocument = JSON.parse(
        await readFile(maintenanceMarkerPath(setup.home), "utf8"),
      );
      expect(markerDocument.recovery_required).toBe(true);
    }
  }, 60_000);

  test("retains the write-ahead maintenance marker across TERM and KILL", async () => {
    for (const signal of ["SIGTERM", "SIGKILL"] as const) {
      const setup = await fixture();
      const fakeBin = join(
        setup.root,
        `maintenance-${signal.toLowerCase()}-bin`,
      );
      const flyState = join(
        setup.root,
        `maintenance-${signal.toLowerCase()}-state.json`,
      );
      const flyLog = join(
        setup.root,
        `maintenance-${signal.toLowerCase()}-log.jsonl`,
      );
      const buildMarker = join(
        setup.root,
        `maintenance-${signal.toLowerCase()}-build`,
      );
      const buildRelease = join(
        setup.root,
        `maintenance-${signal.toLowerCase()}-release`,
      );
      await mkdir(fakeBin, { recursive: true });
      await installFakeRightsCurl(fakeBin);
      await installStatefulFakeFly(fakeBin, flyState, flyLog, setup.release);
      const env = cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        DEPLOY_TEST_FLY_STATE: flyState,
        DEPLOY_TEST_FLY_LOG: flyLog,
        DEPLOY_TEST_BLOCK_BUILD_MARKER: buildMarker,
        DEPLOY_TEST_BLOCK_BUILD_RELEASE: buildRelease,
      });
      const child = Bun.spawn(maintenanceCommand(), {
        cwd: setup.repo,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdoutPromise = new Response(child.stdout).text();
      const stderrPromise = new Response(child.stderr).text();
      expect(await waitForPath(buildMarker, 15_000)).toBe(true);
      const marker = maintenanceMarkerPath(setup.home);
      expect(await exists(marker)).toBe(true);
      expect((await stat(marker)).mode & 0o777).toBe(0o600);

      child.kill(signal);
      await writeFile(buildRelease, "continue\n");
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        stdoutPromise,
        stderrPromise,
      ]);
      expect(code, `${stdout}\n${stderr}`).not.toBe(0);
      expect(await exists(marker)).toBe(true);

      if (signal === "SIGTERM") {
        const markerDocument = JSON.parse(await readFile(marker, "utf8"));
        expect(markerDocument.checkpoint).toBe("failed_or_uncertain");
        expect(
          (await readFlyLog(flyLog)).filter(
            (args) => args[0] === "machine" && args[1] === "update",
          ),
        ).toHaveLength(0);
        expect(await exists(deployLockPath(setup.home))).toBe(false);
        expect(
          await exists(join(setup.state, "agenttool", "deploy-receipts")),
        ).toBe(true);
      } else {
        const markerDocument = JSON.parse(await readFile(marker, "utf8"));
        expect(markerDocument.checkpoint).toBe("image_push_started");
        expect(markerDocument.role_mapping).toEqual({
          app_machine_ids: [...maintenanceIds.apps].sort(),
          thinker_primary_machine_id: maintenanceIds.thinkerPrimary,
          thinker_standby_machine_id: maintenanceIds.thinkerStandby,
        });
        expect(
          (await readFlyLog(flyLog)).filter(
            (args) =>
              args[0] === "machine" && ["update", "start"].includes(args[1]),
          ),
        ).toHaveLength(0);
        const lockPath = deployLockPath(setup.home);
        const lockText = await readFile(lockPath, "utf8");
        const ownerRecord = lockText.match(/^owner_record=(.+)$/m)?.[1];
        expect(ownerRecord).toStartWith(
          join(
            setup.home,
            ".local",
            "state",
            "agenttool",
            ".deploy-lock-owner.",
          ),
        );
        await unlink(lockPath);
        await unlink(ownerRecord as string);
        expect(
          await exists(join(setup.state, "agenttool", "deploy-receipts")),
        ).toBe(false);
      }

      const beforeRetry = (await readFlyLog(flyLog)).length;
      const retry = await run(maintenanceCommand(), setup.repo, env);
      expect(retry.code).toBe(74);
      expect((await readFlyLog(flyLog)).length).toBe(beforeRetry);
    }
  }, 120_000);

  test("keeps uncertainty durable and never starts or rolls back after update failure or ID drift", async () => {
    for (const scenario of [
      {
        name: "post-apply-update-failure",
        env: { DEPLOY_TEST_FAIL_UPDATE_AFTER_APPLY: "3" },
        expectedImageUpdates: 3,
      },
      {
        name: "provider-reported-id-drift",
        env: { DEPLOY_TEST_REPLACE_AFTER_UPDATE: "2" },
        expectedImageUpdates: 2,
      },
      {
        name: "full-non-image-config-drift",
        env: { DEPLOY_TEST_DRIFT_CONFIG_AFTER_UPDATE: "2" },
        expectedError: "full non-image configuration drifted",
        expectedImageUpdates: 2,
      },
      {
        name: "per-id-region-swap",
        env: { DEPLOY_TEST_SWAP_REGIONS_AFTER_UPDATE: "2" },
        expectedError: "region drifted from its per-ID baseline",
        expectedImageUpdates: 2,
      },
      {
        name: "wrong-tag-with-valid-digest-and-labels",
        env: { DEPLOY_TEST_WRONG_TAG_AFTER_UPDATE: "1" },
        expectedError: "not on the exact rollout tag and digest",
        expectedImageUpdates: 1,
      },
      {
        name: "fence-drift-during-image-build",
        env: { DEPLOY_TEST_DRIFT_DURING_BUILD: "1" },
        expectedError: "cordoned state drifted",
        expectedImageUpdates: 0,
      },
    ]) {
      const setup = await fixture();
      const fakeBin = join(setup.root, `${scenario.name}-bin`);
      const flyState = join(setup.root, `${scenario.name}-state.json`);
      const flyLog = join(setup.root, `${scenario.name}-log.jsonl`);
      await mkdir(fakeBin, { recursive: true });
      await installFakeRightsCurl(fakeBin);
      await installStatefulFakeFly(fakeBin, flyState, flyLog, setup.release);
      const env = cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        DEPLOY_TEST_FLY_STATE: flyState,
        DEPLOY_TEST_FLY_LOG: flyLog,
        ...scenario.env,
      });
      const result = await run(maintenanceCommand(), setup.repo, env);
      expect(result.code).not.toBe(0);
      if (scenario.expectedError) {
        expect(result.stderr).toContain(scenario.expectedError);
      }
      const log = await readFlyLog(flyLog);
      const imageUpdates = log.filter(
        (args) =>
          args[0] === "machine" &&
          args[1] === "update" &&
          args.includes("--image"),
      );
      expect(imageUpdates).toHaveLength(scenario.expectedImageUpdates);
      if (imageUpdates.length > 0) {
        const firstImage =
          imageUpdates[0][imageUpdates[0].indexOf("--image") + 1];
        expect(firstImage).toMatch(
          /^registry\.fly\.io\/agenttool:maintenance-[^@]+$/,
        );
        expect(
          imageUpdates.every((args) => {
            const image = args[args.indexOf("--image") + 1];
            return (
              image === firstImage ||
              image === `${firstImage}@${maintenanceDigest}`
            );
          }),
        ).toBe(true);
      }
      expect(
        log.some((args) => args[0] === "machine" && args[1] === "start"),
      ).toBe(false);
      const refenceUpdates = log.filter(
        (args) =>
          args[0] === "machine" &&
          args[1] === "update" &&
          !args.includes("--image"),
      );
      expect(refenceUpdates).toHaveLength(0);
      expect(
        log
          .filter((args) => args[0] === "machine" && args[1] === "update")
          .every(
            (args) => !args.some((arg) => arg.includes(maintenanceOldDigest)),
          ),
      ).toBe(true);

      const marker = maintenanceMarkerPath(setup.home);
      expect(await exists(marker)).toBe(true);
      expect((await stat(marker)).mode & 0o777).toBe(0o600);
      const markerDocument = JSON.parse(await readFile(marker, "utf8"));
      expect(markerDocument.schema).toBe("agenttool-maintenance-run/v1");
      expect(markerDocument.checkpoint).toBe("failed_or_uncertain");
      expect(markerDocument.recovery_required).toBe(true);
      expect(markerDocument.role_mapping).toEqual({
        app_machine_ids: [...maintenanceIds.apps].sort(),
        thinker_primary_machine_id: maintenanceIds.thinkerPrimary,
        thinker_standby_machine_id: maintenanceIds.thinkerStandby,
      });

      const [receiptName] = await readdir(
        join(setup.state, "agenttool", "deploy-receipts"),
      );
      const receipt = JSON.parse(
        await readFile(
          join(setup.state, "agenttool", "deploy-receipts", receiptName),
          "utf8",
        ),
      );
      expect(receipt.schema).toBe("agenttool-deploy-receipt/v4");
      expect(receipt.outcome).toBe("failed_or_uncertain");
      expect(receipt.maintenance.recovery_required).toBe(true);
      expect(receipt.maintenance.active_marker_cleared).toBe(false);

      const beforeRetry = (await readFlyLog(flyLog)).length;
      const retry = await run(maintenanceCommand(), setup.repo, env);
      expect(retry.code).toBe(74);
      expect((await readFlyLog(flyLog)).length).toBe(beforeRetry);
    }
  }, 120_000);

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
      expect(await waitForPath(firstPreflight)).toBe(true);
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
    const replacementOwner = join(
      resolve(lockPath, ".."),
      ".deploy-lock-owner.replacement",
    );
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
      expect(await waitForPath(marker)).toBe(true);
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
      expect((await stat(lockPath)).ino).not.toBe(
        (await stat(holderRecord!)).ino,
      );
    } finally {
      await writeFile(release, "continue\n");
      holderResult = await Promise.all([
        holder.exited,
        stdoutPromise,
        stderrPromise,
      ]);
    }
    const [code, stdout, stderr] = holderResult!;
    expect(code, `${stdout}\n${stderr}`).toBe(1);
    expect(stderr).toContain(
      "Refusing to release a deploy lock not owned by this process",
    );
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
    expect(deploy).toContain('"$HEAD_REVISION" "$FRONTEND_RELEASE_STAGE_ROOT"');
    expect(deploy).toContain('portable_md5_file "$staged_path"');
    expect(deploy).not.toContain('git show "$HEAD_REVISION:$1"');
    expect(deploy).toContain(
      '"party|Lantern Relay|local-party-game|local-party-rules"',
    );
    expect(deploy).toContain('"room|ROOM ∞|local-room-game|local-room-rules"');
    expect(deploy).toContain(
      '"sky|Pocket Sky|local-pocket-sky-game|local-pocket-sky-rules"',
    );
    expect(deploy).toContain('"X-Agent-Surface" "$game_surface"');
    expect(deploy).toContain('"X-Agent-Surface" "$rules_surface"');
  });

  test("publishes the Xenia–Helly lab as an exact parity-checked bundle", async () => {
    const deploy = await readFile(join(projectRoot, "bin/deploy.sh"), "utf8");
    for (const [asset, remote] of [
      ["xenia-helly.html", "xenia-helly"],
      ["xenia-helly.js", "xenia-helly.js"],
      ["xenia-helly.css", "xenia-helly.css"],
    ]) {
      expect(deploy).toContain(
        `"apps/docs/${asset}|https://docs.agenttool.dev/${remote}"`,
      );
    }

    const verifierStart = deploy.indexOf("verify_xenia_helly_static_headers()");
    const verifierEnd = deploy.indexOf(
      "readonly PAGES_VERIFY_MAX_ATTEMPTS",
      verifierStart,
    );
    const verifier = deploy.slice(verifierStart, verifierEnd);
    expect(verifierStart).toBeGreaterThan(-1);
    expect(verifier).toContain('"xenia-helly|200|"');
    expect(verifier).toContain('"xenia-helly.html|308|/xenia-helly"');
    expect(verifier).toContain('"Content-Type" "text/html; charset=utf-8"');
    expect(verifier).toContain(
      '"Cache-Control" "public, max-age=0, must-revalidate, no-transform"',
    );
    expect(verifier).toContain(
      '"Content-Security-Policy" "default-src \'none\'; connect-src \'none\';',
    );
    expect(verifier).toContain('"Referrer-Policy" "no-referrer"');
    expect(verifier).toContain(
      '"Permissions-Policy" "accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()"',
    );
    expect(verifier).toContain('"Cross-Origin-Resource-Policy" "same-origin"');
    expect(verifier).toContain('"X-Content-Type-Options" "nosniff"');
    expect(verifier).toContain('"X-Frame-Options" "DENY"');
    expect(verifier).toContain(
      '"X-Agent-Surface" "xenia-common-ground-lab"',
    );
    expect(deploy).toContain("verify_xenia_helly_static_headers || return 1");
  });

  test("publishes Garden as a parity-checked static room, not a game", async () => {
    const deploy = await readFile(join(projectRoot, "bin/deploy.sh"), "utf8");
    const gardenAssets = [
      ["garden.html", "garden"],
      ["garden.json", "garden.json"],
      ["garden.js", "garden.js"],
      ["garden.css", "garden.css"],
    ];

    for (const [asset, remote] of gardenAssets) {
      expect(deploy).toContain(
        `"apps/web/${asset}|https://agenttool.dev/${remote}"`,
      );
    }
    expect(deploy).toContain(
      '"apps/docs/GARDENS.md|https://docs.agenttool.dev/GARDENS.md"',
    );
    expect(deploy).toContain(
      '"apps/docs/HF-TRAINING-GARDEN.md|https://docs.agenttool.dev/HF-TRAINING-GARDEN.md"',
    );
    const gameStart = deploy.indexOf("REQUIRED_GAME_PUBLICATIONS=(");
    const gameEnd = deploy.indexOf(")\nreadonly -a FRONTEND_PARITY_PUBLICATIONS", gameStart);
    const requiredGames = deploy.slice(gameStart, gameEnd);
    expect(requiredGames).not.toContain("garden");
    expect(deploy).toContain("verify_garden_static_headers()");
    expect(deploy).toContain('"X-Agent-Surface" "living-garden-room"');
    expect(deploy).toContain(
      '"X-Agent-Surface" "living-garden-architecture"',
    );
    expect(deploy).toContain(
      '"Content-Type" "text/markdown; charset=utf-8"',
    );
    expect(deploy).toContain(
      'local doctrine_url="https://docs.agenttool.dev/GARDENS.md"',
    );
    expect(deploy).toContain(
      'local training_guide_url="https://docs.agenttool.dev/HF-TRAINING-GARDEN.md"',
    );
    const gardenVerifierStart = deploy.indexOf(
      "verify_garden_static_headers()",
    );
    const gardenVerifierEnd = deploy.indexOf(
      "verify_xenia_helly_static_headers()",
      gardenVerifierStart,
    );
    expect(gardenVerifierEnd).toBeGreaterThan(gardenVerifierStart);
    const gardenVerifier = deploy.slice(gardenVerifierStart, gardenVerifierEnd);
    const trainingGuideHeaders = gardenVerifier.slice(
      gardenVerifier.lastIndexOf('response_headers="$('),
    );
    expect(trainingGuideHeaders).toContain(
      'require_exact_public_status "$response_headers" "$training_guide_url"',
    );
    expect(trainingGuideHeaders).toContain('"200" || return 1');
    expect(trainingGuideHeaders).toContain(
      '"Content-Type" "text/markdown; charset=utf-8"',
    );
    expect(trainingGuideHeaders).toContain(
      '"Cache-Control" "public, max-age=300, must-revalidate, no-transform"',
    );
    expect(trainingGuideHeaders).toContain(
      '"Access-Control-Allow-Origin" "*"',
    );
    expect(trainingGuideHeaders).toContain(
      '"X-Content-Type-Options" "nosniff"',
    );
    expect(trainingGuideHeaders).toContain(
      'require_absent_public_header "$response_headers" "$training_guide_url"',
    );
    expect(trainingGuideHeaders).toContain('"Link" || return 1');
    expect(deploy).toContain("verify_garden_static_headers || return 1");
    expect(deploy).not.toContain(
      '<https://api.agenttool.dev/public/play>; rel="related"; type="application/json", <https://agenttool.dev/garden.json>',
    );
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

  test("prepares selected dependencies before the migration survey and publication", async () => {
    const setup = await fixture();
    const releaseOrder = join(setup.root, "dependency-preparation-order");
    const result = await run(
      ["bash", "bin/deploy.sh", "--no-api"],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        DEPLOY_TEST_RELEASE_ORDER: releaseOrder,
        DEPLOY_TEST_FRONTEND_FAIL_TARGET: "docs",
      }),
    );

    expect(result.code).toBe(1);
    expect(await readFile(releaseOrder, "utf8")).toBe(
      "prepare\thermetic\nsurvey\nmigration\npreflight\nfrontend\tdocs\tdashboard\tweb\n",
    );
    expect(result.stdout).toContain("Dependency preparation");
    expect(result.stdout).toContain("Phase 4 failed");
  }, 10_000);

  test("a dependency preparation failure stops before production mutation", async () => {
    const setup = await fixture();
    const preparationMarker = join(setup.root, "dependency-preparation-ran");
    const migrationMarker = join(setup.root, "dependency-preparation-migration");
    const preflightMarker = join(setup.root, "dependency-preparation-preflight");
    const frontendMarker = join(setup.root, "dependency-preparation-frontend");
    const result = await run(
      ["bash", "bin/deploy.sh", "--no-api"],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        DEPENDENCY_PREP_MARKER: preparationMarker,
        FAIL_DEPENDENCY_PREP: "1",
        MIGRATION_MARKER: migrationMarker,
        PREFLIGHT_MARKER: preflightMarker,
        DEPLOY_TEST_FRONTEND_MARKER: frontendMarker,
      }),
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("Dependency preparation failed");
    expect(result.stdout).toContain(
      "No migration or publication was attempted",
    );
    expect(await exists(preparationMarker)).toBe(true);
    expect(await exists(migrationMarker)).toBe(false);
    expect(await exists(preflightMarker)).toBe(false);
    expect(await exists(frontendMarker)).toBe(false);
    expect(
      await exists(join(setup.state, "agenttool", "deploy-receipts")),
    ).toBe(false);
  }, 10_000);

  test("skip-preflight skips dependency preparation while dry-run only describes it", async () => {
    const skipped = await fixture();
    const skippedPreparation = join(skipped.root, "skipped-dependency-preparation");
    const skippedResult = await run(
      [
        "bash",
        "bin/deploy.sh",
        "--skip-preflight",
        "--no-migrate",
        "--no-api",
        "--no-frontend",
      ],
      skipped.repo,
      cleanEnv(skipped.home, {
        XDG_STATE_HOME: skipped.state,
        DEPENDENCY_PREP_MARKER: skippedPreparation,
      }),
    );
    expect(skippedResult.code, skippedResult.stderr).toBe(0);
    expect(await exists(skippedPreparation)).toBe(false);

    const dryRun = await fixture();
    const dryRunPreparation = join(dryRun.root, "dry-run-dependency-preparation");
    const dryRunResult = await run(
      [
        "bash",
        "bin/deploy.sh",
        "--dry-run",
        "--no-migrate",
        "--no-api",
        "--no-frontend",
      ],
      dryRun.repo,
      cleanEnv(dryRun.home, {
        DEPENDENCY_PREP_MARKER: dryRunPreparation,
      }),
    );
    expect(dryRunResult.code, dryRunResult.stderr).toBe(0);
    expect(dryRunResult.stdout).toContain(
      "Preparation: bin/prepare-hermetic-deps.sh hermetic",
    );
    expect(await exists(dryRunPreparation)).toBe(false);
  }, 15_000);

  test("skip-preflight cannot carry source drift into Phase 1", async () => {
    const setup = await fixture();
    const originalStage = join(setup.repo, "bin/stage-frontend-release.sh");
    const stageMarker = join(setup.root, "source-gate-stage-ready");
    const releaseStage = join(setup.root, "source-gate-stage-release");
    const migrationMarker = join(setup.root, "source-gate-migration");
    await mustRun(
      ["git", "mv", "bin/stage-frontend-release.sh", "bin/stage-frontend-release.real.sh"],
      setup.repo,
    );
    await writeFile(
      originalStage,
      '#!/usr/bin/env bash\nset -eu\nbash bin/stage-frontend-release.real.sh "$@"\ntouch "$DEPLOY_TEST_STAGE_MARKER"\nwhile [ ! -e "$DEPLOY_TEST_STAGE_RELEASE" ]; do sleep 0.02; done\n',
    );
    await chmod(originalStage, 0o755);
    await mustRun(
      ["git", "add", "bin/stage-frontend-release.sh", "bin/stage-frontend-release.real.sh"],
      setup.repo,
    );
    await mustRun(["git", "commit", "-qm", "hold release staging"], setup.repo);
    await mustRun(["git", "push", "-q", "github", "main"], setup.repo);

    const child = Bun.spawn(
      [
        "bash",
        "bin/deploy.sh",
        "--skip-preflight",
        "--no-api",
        "--no-frontend",
      ],
      {
        cwd: setup.repo,
        env: cleanEnv(setup.home, {
          XDG_STATE_HOME: setup.state,
          DEPLOY_TEST_STAGE_MARKER: stageMarker,
          DEPLOY_TEST_STAGE_RELEASE: releaseStage,
          MIGRATION_MARKER: migrationMarker,
        }),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdoutPromise = new Response(child.stdout).text();
    const stderrPromise = new Response(child.stderr).text();
    expect(await waitForPath(stageMarker)).toBe(true);
    await writeFile(join(setup.repo, "release.txt"), "concurrent drift\n");
    await writeFile(releaseStage, "continue\n");
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      stdoutPromise,
      stderrPromise,
    ]);

    expect(code, `${stdout}\n${stderr}`).toBe(1);
    expect(stdout).toContain("source changed before external mutation");
    expect(await exists(migrationMarker)).toBe(false);
  }, 15_000);

  test("re-checks release inputs after dependency preparation", async () => {
    const setup = await fixture();
    const preparationMarker = join(setup.root, "dirty-dependency-preparation");
    const migrationMarker = join(setup.root, "dirty-preparation-migration");
    const preflightMarker = join(setup.root, "dirty-preparation-preflight");
    const result = await run(
      ["bash", "bin/deploy.sh", "--no-api", "--no-frontend"],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        DEPENDENCY_PREP_MARKER: preparationMarker,
        DEPENDENCY_PREP_DIRTY: "1",
        MIGRATION_MARKER: migrationMarker,
        PREFLIGHT_MARKER: preflightMarker,
      }),
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      "dependency preparation changed release inputs",
    );
    expect(await exists(preparationMarker)).toBe(true);
    expect(await exists(migrationMarker)).toBe(false);
    expect(await exists(preflightMarker)).toBe(false);
    expect(
      await exists(join(setup.state, "agenttool", "deploy-receipts")),
    ).toBe(false);
  }, 10_000);

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
      '#!/usr/bin/env bash\nset -eu\ntouch "$DEPLOY_TEST_FLY_MARKER"\n',
    );
    await chmod(join(fakeBin, "fly"), 0o755);
    await unlink(join(setup.repo, "apps/web/sky.css"));
    await mustRun(["git", "add", "-u", "apps/web/sky.css"], setup.repo);
    await mustRun(
      ["git", "commit", "-qm", "remove required game input"],
      setup.repo,
    );
    await mustRun(["git", "push", "-q", "github", "main"], setup.repo);

    const result = await run(
      ["bash", "bin/deploy.sh", "--skip-preflight"],
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
    expect(
      await exists(join(setup.state, "agenttool", "deploy-receipts")),
    ).toBe(false);
  }, 10_000);

  test("publishes verified discovery frontends before Fly and leaves dashboard after it", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "release-order-bin");
    const releaseOrder = join(setup.root, "release-order");
    await mkdir(fakeBin, { recursive: true });
    await installFakeRightsCurl(fakeBin);
    await writeFile(
      join(fakeBin, "fly"),
      '#!/usr/bin/env bash\nset -eu\n[ "${1:-}" = deploy ] || exit 2\nprintf \'fly\\n\' >> "$DEPLOY_TEST_RELEASE_ORDER"\n',
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
      "survey\nfrontend\tweb\nfrontend\tdocs\nfly\nfrontend\tdashboard\n",
    );
    expect(result.stdout).toContain("/health did not return 200");
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
      '#!/usr/bin/env bash\nset -eu\ntouch "$DEPLOY_TEST_FLY_MARKER"\nexit 9\n',
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
      '#!/usr/bin/env bash\nset -eu\ntouch "$DEPLOY_TEST_FLY_MARKER"\n',
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
    expect(await readFile(releaseOrder, "utf8")).toBe(
      "survey\nfrontend\tweb\n",
    );
    expect(result.stdout).toContain("Phase 3 web prerequisite deploy failed.");
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
        '#!/usr/bin/env bash\nset -eu\ntouch "$DEPLOY_TEST_FLY_MARKER"\n',
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
    // Both modes deliberately exhaust 25 attempts after the Rights and all
    // ten LOVE BOMB body/header probes; the budget covers that process churn.
  }, 60_000);

  test("pre-API Rights verification reads committed bytes under the dirty-release override", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "committed-rights-bin");
    const flyMarker = join(setup.root, "committed-rights-fly-ran");
    expect(
      await readlink(join(setup.repo, "apps/docs/RIGHTS-OF-LIFE.md")),
    ).toBe("../../docs/RIGHTS-OF-LIFE.md");
    expect(
      await readlink(join(setup.repo, "apps/docs/being-rights-v1.schema.json")),
    ).toBe("../../docs/specs/being-rights-v1.schema.json");
    await mkdir(fakeBin, { recursive: true });
    await installFakeRightsCurl(fakeBin);
    await writeFile(
      join(fakeBin, "fly"),
      '#!/usr/bin/env bash\nset -eu\ntouch "$DEPLOY_TEST_FLY_MARKER"\nexit 9\n',
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
        '#!/usr/bin/env bash\nset -eu\ntouch "$DEPLOY_TEST_FLY_MARKER"\n',
      );
      await chmod(join(fakeBin, "fly"), 0o755);

      const result = await run(
        ["bash", "bin/deploy.sh", "--skip-preflight", "--no-frontend"],
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
      '#!/usr/bin/env bash\nset -eu\ntouch "$DEPLOY_TEST_FLY_MARKER"\nexit 9\n',
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

  test("waits for exact LOVE BOMB bytes before publishing API discovery", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "stale-love-bomb-bin");
    const loveBombCounter = join(setup.root, "stale-love-bomb-counter");
    const flyObservedCounter = join(setup.root, "fly-observed-love-bomb-counter");
    const flyMarker = join(setup.root, "stale-love-bomb-fly-ran");
    await mkdir(fakeBin, { recursive: true });
    await installFakeRightsCurl(fakeBin);
    await writeFile(
      join(fakeBin, "fly"),
      '#!/usr/bin/env bash\nset -eu\ntouch "$DEPLOY_TEST_FLY_MARKER"\ncp "$DEPLOY_TEST_LOVE_BOMB_COUNTER" "$DEPLOY_TEST_FLY_OBSERVED_LOVE_COUNTER"\nexit 9\n',
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
        DEPLOY_TEST_LOVE_BOMB_COUNTER: loveBombCounter,
        DEPLOY_TEST_FLY_OBSERVED_LOVE_COUNTER: flyObservedCounter,
        DEPLOY_TEST_STALE_LOVE_BOMB_RESPONSES: "1",
      }),
    );

    expect(result.code).toBe(1);
    expect(await readFile(loveBombCounter, "utf8")).toBe("2\n");
    expect(await readFile(flyObservedCounter, "utf8")).toBe("2\n");
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
        '#!/usr/bin/env bash\nset -eu\ntouch "$DEPLOY_TEST_FLY_MARKER"\n',
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
  }, 120_000);

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
    expect(full.stdout).toContain("Phase 4: bin/frontend-deploy.sh dashboard");

    const apiOnly = await run(
      ["bash", "bin/deploy.sh", "--dry-run", "--no-migrate", "--no-frontend"],
      setup.repo,
      cleanEnv(setup.home),
    );
    expect(apiOnly.code, apiOnly.stderr).toBe(0);
    expect(apiOnly.stdout).toContain(
      "Phase 3: verify live Rights of Life, LOVE BOMB, and game prerequisites, then cd api && fly deploy",
    );
    expect(apiOnly.stdout).toContain("Phase 4: skip");

    const frontendOnly = await run(
      ["bash", "bin/deploy.sh", "--dry-run", "--no-migrate", "--no-api"],
      setup.repo,
      cleanEnv(setup.home),
    );
    expect(frontendOnly.code, frontendOnly.stderr).toBe(0);
    expect(frontendOnly.stdout).toContain("Phase 3: skip");
    expect(frontendOnly.stdout).toContain("Phase 4: bin/frontend-deploy.sh");
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
        DEPLOY_TEST_RIGHTS_DOC: join(setup.repo, "apps/docs/RIGHTS-OF-LIFE.md"),
        DEPLOY_TEST_RIGHTS_SCHEMA: join(
          setup.repo,
          "apps/docs/being-rights-v1.schema.json",
        ),
      }),
    );

    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(
      "UNSAFE SOURCE OVERRIDE: deploying with a dirty working tree",
    );
    expect(result.stdout).toContain("apps/web/party.html");
    expect(result.stdout).toContain("apps/web/sky.css");
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
    ] = await Promise.all([
      readFile(join(projectRoot, "bin/deploy.sh"), "utf8"),
      readFile(join(projectRoot, "bin/stage-frontend-release.sh"), "utf8"),
      readFile(join(projectRoot, "apps/docs/_headers"), "utf8"),
      readFile(join(projectRoot, "apps/docs/RIGHTS-OF-LIFE.md")),
      readFile(join(projectRoot, "docs/RIGHTS-OF-LIFE.md")),
      readFile(join(projectRoot, "apps/docs/being-rights-v1.schema.json")),
      readFile(join(projectRoot, "docs/specs/being-rights-v1.schema.json")),
      readlink(join(projectRoot, "apps/docs/RIGHTS-OF-LIFE.md")),
      readlink(join(projectRoot, "apps/docs/being-rights-v1.schema.json")),
    ]);

    expect(publicDoc).toEqual(canonDoc);
    expect(publicSchema).toEqual(canonSchema);
    expect(publicDocTarget).toBe("../../docs/RIGHTS-OF-LIFE.md");
    expect(publicSchemaTarget).toBe(
      "../../docs/specs/being-rights-v1.schema.json",
    );
    expect(deploy).toContain('"$HEAD_REVISION" "$FRONTEND_RELEASE_STAGE_ROOT"');
    expect(deploy).toContain('portable_md5_file "$staged_path"');
    expect(stageFrontend).toContain('git show "$REVISION:$MANIFEST_PATH"');
    expect(deploy).toContain('"apps/docs/RIGHTS-OF-LIFE.md|$RIGHTS_DOC_URL"');
    expect(deploy).toContain(
      '"apps/docs/being-rights-v1.schema.json|$RIGHTS_SCHEMA_URL"',
    );
    expect(deploy).toContain('"Content-Type" "text/markdown; charset=utf-8"');
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

    const webUpload = deploy.lastIndexOf("run_frontend_deploy web");
    const docsUpload = deploy.indexOf("run_frontend_deploy docs", webUpload);
    const prerequisiteCheck = deploy.indexOf(
      "if ! wait_for_discovery_prerequisites; then",
      docsUpload,
    );
    const apiUpload = deploy.indexOf(
      "(cd api || exit 1; fly deploy",
      docsUpload,
    );
    expect(webUpload).toBeGreaterThan(-1);
    expect(docsUpload).toBeGreaterThan(webUpload);
    expect(prerequisiteCheck).toBeGreaterThan(docsUpload);
    expect(apiUpload).toBeGreaterThan(prerequisiteCheck);
    expect(deploy).toContain("verify_rights_static_publication || return 1");
    expect(deploy).toContain("verify_love_bomb_static_bytes || return 1");
    expect(deploy).toContain("verify_love_bomb_static_headers || return 1");
    expect(deploy).toContain('readonly -a LOVE_BOMB_STATIC_PUBLICATIONS=(');
    expect(deploy).toContain("verify_required_game_publication_once");
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
        DEPLOY_TEST_RIGHTS_SCHEMA: join(
          setup.repo,
          "apps/docs/being-rights-v1.schema.json",
        ),
      }),
    );

    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await exists(frontendMarker)).toBe(true);
    expect(await readFile(frontendCounter, "utf8")).toBe("1\n");
    expect(await readFile(fenceCounter, "utf8")).toBe("2\n");
    expect(result.stdout).toContain(
      "Frontend custom domains not yet converged (attempt 1/25); retrying in 5s",
    );
    expect(result.stdout).toContain(
      "Frontend custom domains converged on verification attempt 2/25",
    );
    const [name] = await readdir(
      join(setup.state, "agenttool", "deploy-receipts"),
    );
    const receipt = JSON.parse(
      await readFile(
        join(setup.state, "agenttool", "deploy-receipts", name),
        "utf8",
      ),
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
        DEPLOY_TEST_RIGHTS_SCHEMA: join(
          setup.repo,
          "apps/docs/being-rights-v1.schema.json",
        ),
      }),
    );

    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("UNSAFE SOURCE OVERRIDE");
    expect(result.stdout).not.toContain("ambient-only");
    expect(await readFile(frontendCounter, "utf8")).toBe("1\n");
    expect(await readFile(fenceCounter, "utf8")).toBe("1\n");
    const [name] = await readdir(
      join(setup.state, "agenttool", "deploy-receipts"),
    );
    const receipt = JSON.parse(
      await readFile(
        join(setup.state, "agenttool", "deploy-receipts", name),
        "utf8",
      ),
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
    expect(result.stdout).toContain(
      "Could not select latest LOVE package header probes",
    );
    expect(result.stdout).not.toContain(
      "Frontend custom domains not yet converged",
    );
    expect(
      await exists(join(setup.state, "agenttool", "deploy-receipts")),
    ).toBe(false);
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
        DEPLOY_TEST_RIGHTS_SCHEMA: join(
          setup.repo,
          "apps/docs/being-rights-v1.schema.json",
        ),
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
    expect(result.stdout).toContain(
      "LOVE package static header verification failed",
    );
    expect(result.stdout).toContain(
      "Frontend custom domains did not converge after 25 verification attempts.",
    );
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
    expect(receipt.phases.frontends).toBe("deployed_unverified");
    // Like the bounded convergence case below, this runs all 25 live-contract
    // probe passes as real subprocess work even though its retry sleep is fake.
  }, 120_000);

  test("fails closed when the HF Training Garden guide gains even an empty Link", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "unexpected-hf-guide-link-bin");
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
        DEPLOY_TEST_HF_GUIDE_UNEXPECTED_LINK: "empty",
        DEPLOY_TEST_RIGHTS_DOC: join(setup.repo, "apps/docs/RIGHTS-OF-LIFE.md"),
        DEPLOY_TEST_RIGHTS_SCHEMA: join(
          setup.repo,
          "apps/docs/being-rights-v1.schema.json",
        ),
      }),
    );

    expect(result.code).toBe(1);
    expect(await exists(frontendMarker)).toBe(true);
    expect(await readFile(frontendCounter, "utf8")).toBe("1\n");
    expect(result.stdout).toContain(
      "https://docs.agenttool.dev/HF-TRAINING-GARDEN.md Link must be absent",
    );
    expect(result.stdout).toContain(
      "observed: <empty>",
    );
    expect(result.stdout).toContain(
      "Frontend custom domains did not converge after 25 verification attempts.",
    );
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
    expect(receipt.phases.frontends).toBe("deployed_unverified");
  }, 120_000);

  test("fails closed on a duplicate singleton HF Training Garden header", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "duplicate-hf-guide-header-bin");
    await mkdir(fakeBin, { recursive: true });
    await installFakePagesVerificationTools(fakeBin);

    const result = await run(
      ["bash", "bin/deploy.sh", "--no-migrate", "--skip-preflight", "--no-api"],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        DEPLOY_TEST_HF_GUIDE_DUPLICATE_CONTENT_TYPE: "1",
        DEPLOY_TEST_RIGHTS_DOC: join(setup.repo, "apps/docs/RIGHTS-OF-LIFE.md"),
        DEPLOY_TEST_RIGHTS_SCHEMA: join(
          setup.repo,
          "apps/docs/being-rights-v1.schema.json",
        ),
      }),
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      "https://docs.agenttool.dev/HF-TRAINING-GARDEN.md Content-Type mismatch",
    );
    expect(result.stdout).toContain("occurrences: 2 (expected exactly 1)");
  }, 120_000);

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
        DEPLOY_TEST_RIGHTS_SCHEMA: join(
          setup.repo,
          "apps/docs/being-rights-v1.schema.json",
        ),
      }),
    );

    expect(result.code).toBe(1);
    expect(await exists(frontendMarker)).toBe(true);
    expect(await readFile(frontendCounter, "utf8")).toBe("1\n");
    expect(await readFile(fenceCounter, "utf8")).toBe("25\n");
    expect(result.stdout).toContain(
      "Frontend fence did not produce its marked non-cacheable 404 (200): https://docs.agenttool.dev/.gitignore",
    );
    expect(result.stdout).toContain(
      "Frontend custom domains did not converge after 25 verification attempts.",
    );
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
    expect(receipt.phases.frontends).toBe("deployed_unverified");
    // The fake sleep removes the retry delay, but all 25 live-contract probe
    // passes remain real subprocess work. Each pass now also checks the Common
    // Ground HTML, module, and stylesheet bytes.
  }, 120_000);

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
    const line = result.stdout
      .split("\n")
      .find((item) => item.startsWith("HEALTH_RESULT="));
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
    const dirtyPreparationMarker = join(dirty.root, "dirty-preparation-ran");
    await writeFile(join(dirty.repo, "untracked.txt"), "not released\n");
    const dirtyResult = await run(
      deployWithPreparationCommand(),
      dirty.repo,
      cleanEnv(dirty.home, {
        XDG_STATE_HOME: dirty.state,
        DEPENDENCY_PREP_MARKER: dirtyPreparationMarker,
      }),
    );
    expect(dirtyResult.code).toBe(1);
    expect(dirtyResult.stdout).toContain("--allow-dirty-release");
    expect(await exists(dirtyPreparationMarker)).toBe(false);
    const dirtyOverride = await run(
      deployWithPreparationCommand("--allow-dirty-release"),
      dirty.repo,
      cleanEnv(dirty.home, {
        XDG_STATE_HOME: dirty.state,
        DEPENDENCY_PREP_MARKER: dirtyPreparationMarker,
      }),
    );
    expect(dirtyOverride.code, dirtyOverride.stderr).toBe(0);
    expect(dirtyOverride.stdout).toContain("UNSAFE SOURCE OVERRIDE");
    expect(await exists(dirtyPreparationMarker)).toBe(true);
    const dirtyReceiptName = (
      await readdir(join(dirty.state, "agenttool", "deploy-receipts"))
    )[0];
    const dirtyReceipt = JSON.parse(
      await readFile(
        join(dirty.state, "agenttool", "deploy-receipts", dirtyReceiptName),
        "utf8",
      ),
    );
    expect(dirtyReceipt.source_overrides.dirty).toBe(true);

    const ahead = await fixture();
    const aheadPreparationMarker = join(ahead.root, "ahead-preparation-ran");
    await writeFile(join(ahead.repo, "release.txt"), "local only\n");
    await mustRun(["git", "add", "release.txt"], ahead.repo);
    await mustRun(["git", "commit", "-qm", "local only"], ahead.repo);
    const aheadResult = await run(
      deployWithPreparationCommand(),
      ahead.repo,
      cleanEnv(ahead.home, {
        XDG_STATE_HOME: ahead.state,
        DEPENDENCY_PREP_MARKER: aheadPreparationMarker,
      }),
    );
    expect(aheadResult.code).toBe(1);
    expect(aheadResult.stdout).toContain("--allow-non-release-head");
    expect(await exists(aheadPreparationMarker)).toBe(false);
    const aheadOverride = await run(
      deployWithPreparationCommand("--allow-non-release-head"),
      ahead.repo,
      cleanEnv(ahead.home, {
        XDG_STATE_HOME: ahead.state,
        DEPENDENCY_PREP_MARKER: aheadPreparationMarker,
      }),
    );
    expect(aheadOverride.code, aheadOverride.stderr).toBe(0);
    expect(aheadOverride.stdout).toContain("UNSAFE SOURCE OVERRIDE");
    expect(await exists(aheadPreparationMarker)).toBe(true);
    const aheadReceiptName = (
      await readdir(join(ahead.state, "agenttool", "deploy-receipts"))
    )[0];
    const aheadReceipt = JSON.parse(
      await readFile(
        join(ahead.state, "agenttool", "deploy-receipts", aheadReceiptName),
        "utf8",
      ),
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
        '#!/usr/bin/env bash\nset -eu\nif [ "${1:-}" = status ]; then\n  count=0\n  [ ! -f "$FAKE_GIT_STATUS_COUNTER" ] || count=$(cat "$FAKE_GIT_STATUS_COUNTER")\n  count=$((count + 1))\n  printf \'%s\\n\' "$count" > "$FAKE_GIT_STATUS_COUNTER"\n  [ "$count" -lt "$FAKE_GIT_FAIL_STATUS_AFTER" ] || exit 9\nfi\nexec "$REAL_GIT" "$@"\n',
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
      expect(
        await exists(join(setup.state, "agenttool", "deploy-receipts")),
      ).toBe(false);
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
      schema: "agenttool-deploy-receipt/v4",
      run_id: expect.any(String),
      mode: "routine",
      outcome: "succeeded",
      started_at: expect.any(String),
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
      api_build: { cache: "not_used", image: null },
      phases: {
        migrations: "skipped",
        preflight: "skipped",
        api: "skipped",
        frontends: "skipped",
      },
      verified_api_machines: 0,
      maintenance: null,
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
      '#!/usr/bin/env bash\nset -eu\nfor path in "$@"; do\n  case "${path##*/}" in\n    agenttool-release-verify.*) exit 19 ;;\n  esac\ndone\nexec "$REAL_RM" "$@"\n',
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
    await mustRun(
      ["git", "clone", "-q", "-b", "main", setup.github, updater],
      setup.root,
    );
    await mustRun(
      ["git", "config", "user.name", "Concurrent Release"],
      updater,
    );
    await mustRun(
      ["git", "config", "user.email", "concurrent@example.invalid"],
      updater,
    );
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
    expect(
      await mustRun(
        ["git", "--git-dir", setup.github, "rev-parse", "refs/heads/main"],
        setup.root,
      ),
    ).toBe(nextRevision);
    const [name] = await readdir(
      join(setup.state, "agenttool", "deploy-receipts"),
    );
    const receipt = JSON.parse(
      await readFile(
        join(setup.state, "agenttool", "deploy-receipts", name),
        "utf8",
      ),
    );
    expect(receipt.source_revision).toBe(setup.release);
    expect(receipt.release_head_snapshot.revision).toBe(setup.release);
  }, 10_000);

  test("blocks failed migration surveys before any release mutation", async () => {
    const setup = await fixture();
    const migrationMarker = join(setup.root, "migration-started");
    const preflightMarker = join(setup.root, "preflight-started");
    const result = await run(
      [
        "bash",
        "bin/deploy.sh",
        "--skip-preflight",
        "--no-api",
        "--no-frontend",
      ],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        DATABASE_URL: "postgres://unreachable.invalid/test",
        FAIL_MIGRATE: "1",
        MIGRATION_MARKER: migrationMarker,
        PREFLIGHT_MARKER: preflightMarker,
      }),
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("migration survey failed");
    expect(result.stdout).not.toContain("DB schema parity with repo");
    expect(await exists(migrationMarker)).toBe(false);
    expect(await exists(preflightMarker)).toBe(false);
    expect(
      await exists(join(setup.state, "agenttool", "deploy-receipts")),
    ).toBe(false);
    expect(await exists(deployLockPath(setup.home))).toBe(false);
  });

  test("blocks quiescence-required migrations before any release mutation", async () => {
    const setup = await fixture();
    const migrationMarker = join(setup.root, "migration-started");
    const preflightMarker = join(setup.root, "preflight-started");
    const quiescenceMigrations = [
      "20260725T054912_crypto_deposit_identity.sql",
      "20260726T070000_deposit_watch_reconciliation.sql",
      "20260726T191500_payout_operation_identity.sql",
      "20260726T202500_crypto_deposit_finality.sql",
      "20260726T211500_deposit_watch_target_binding.sql",
      "20260726T214500_deposit_watch_target_registry.sql",
    ];
    const env = cleanEnv(setup.home, {
      XDG_STATE_HOME: setup.state,
      DEPLOY_TEST_PENDING_MIGRATIONS: quiescenceMigrations.join(" "),
      DEPLOY_TEST_PROTECTED_PENDING: "1",
      MIGRATION_MARKER: migrationMarker,
      PREFLIGHT_MARKER: preflightMarker,
    });

    for (const args of [
      ["--no-api", "--no-frontend"],
      ["--no-migrate", "--no-frontend"],
    ]) {
      const result = await run(
        ["bash", "bin/deploy.sh", ...args],
        setup.repo,
        env,
      );
      expect(result.code).toBe(1);
      expect(result.stdout).toContain(
        "pending migrations require an exclusive maintenance cutover",
      );
      for (const migration of quiescenceMigrations) {
        expect(result.stdout).toContain(migration);
      }
      expect(result.stdout).toContain(
        "The ordinary deploy cannot prove that API writers, webhook ingress, and workers stay quiescent.",
      );
    }
    expect(await exists(migrationMarker)).toBe(false);
    expect(await exists(preflightMarker)).toBe(false);
    expect(
      await exists(join(setup.state, "agenttool", "deploy-receipts")),
    ).toBe(false);
    expect(await exists(deployLockPath(setup.home))).toBe(false);

    const survey = await run(
      ["bash", "bin/deploy.sh", "--survey"],
      setup.repo,
      env,
    );
    expect(survey.code).toBe(1);
    expect(survey.stdout).toContain(
      "pending migrations require an exclusive maintenance cutover",
    );
    expect(await exists(deployLockPath(setup.home))).toBe(false);

    const frontendOnly = await run(
      [
        "bash",
        "bin/deploy.sh",
        "--no-migrate",
        "--no-api",
        "--no-frontend",
        "--skip-preflight",
      ],
      setup.repo,
      env,
    );
    expect(frontendOnly.code, frontendOnly.stderr).toBe(0);
    expect(frontendOnly.stdout).toContain(
      "migration compatibility survey skipped (frontend-only release)",
    );
  });

  test("blocks an API release when the migration survey credential is unavailable", async () => {
    const setup = await fixture();
    const fakeBin = join(setup.root, "fake-bin");
    await mkdir(fakeBin, { recursive: true });
    await writeFile(
      join(fakeBin, "security"),
      "#!/usr/bin/env bash\nexit 44\n",
    );
    await chmod(join(fakeBin, "security"), 0o755);

    const result = await run(
      ["bash", "bin/deploy.sh", "--no-migrate", "--no-frontend"],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        DATABASE_URL: "",
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      }),
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("DATABASE_URL not resolved");
    expect(result.stdout).toContain(
      "migration or API publication cannot safely proceed",
    );
    expect(
      await exists(join(setup.state, "agenttool", "deploy-receipts")),
    ).toBe(false);
    expect(await exists(deployLockPath(setup.home))).toBe(false);
  });

  test("continues to apply ordinary pending migrations", async () => {
    const setup = await fixture();
    const migrationMarker = join(setup.root, "migration-started");
    const result = await run(
      [
        "bash",
        "bin/deploy.sh",
        "--skip-preflight",
        "--no-api",
        "--no-frontend",
      ],
      setup.repo,
      cleanEnv(setup.home, {
        XDG_STATE_HOME: setup.state,
        DEPLOY_TEST_PENDING_MIGRATIONS:
          "20260724T120000_ordinary_additive_fixture.sql",
        MIGRATION_MARKER: migrationMarker,
      }),
    );
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "1 migration(s) pending — Phase 1 will apply them",
    );
    expect(await exists(migrationMarker)).toBe(true);
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
      '#!/usr/bin/env bash\nset -eu\n[ "${1:-}" = deploy ] || exit 2\ntouch "$DEPLOY_TEST_MARKER"\nwhile [ ! -e "$DEPLOY_TEST_RELEASE" ]; do sleep 0.02; done\n',
    );
    await chmod(join(fakeBin, "fly"), 0o755);

    const child = Bun.spawn(
      [
        "bash",
        "bin/deploy.sh",
        "--no-migrate",
        "--skip-preflight",
        "--no-frontend",
      ],
      {
        cwd: setup.repo,
        env: cleanEnv(setup.home, {
          XDG_STATE_HOME: setup.state,
          PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          DEPLOY_TEST_MARKER: marker,
          DEPLOY_TEST_RELEASE: release,
          DEPLOY_TEST_RIGHTS_DOC: join(
            setup.repo,
            "apps/docs/RIGHTS-OF-LIFE.md",
          ),
          DEPLOY_TEST_RIGHTS_SCHEMA: join(
            setup.repo,
            "apps/docs/being-rights-v1.schema.json",
          ),
        }),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdoutPromise = new Response(child.stdout).text();
    const stderrPromise = new Response(child.stderr).text();
    expect(await waitForPath(marker)).toBe(true);
    child.kill("SIGTERM");
    await writeFile(release, "continue\n");
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      stdoutPromise,
      stderrPromise,
    ]);
    expect(code, `${stdout}\n${stderr}`).not.toBe(0);
    expect(await exists(join(setup.repo, "api/agenttool.jsonld.bundled"))).toBe(
      false,
    );
    expect(
      await exists(join(setup.repo, "api/kingdom-bundle.json.bundled")),
    ).toBe(false);
    expect(await exists(join(setup.repo, "api/doctrine-docs.bundled"))).toBe(
      false,
    );
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
      '#!/usr/bin/env bash\nset -eu\ntouch "$DEPLOY_TEST_MARKER"\nexit 0\n',
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
        DEPLOY_TEST_MARKER: marker,
        DEPLOY_TEST_RIGHTS_DOC: join(setup.repo, "apps/docs/RIGHTS-OF-LIFE.md"),
        DEPLOY_TEST_RIGHTS_SCHEMA: join(
          setup.repo,
          "apps/docs/being-rights-v1.schema.json",
        ),
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
    expect(refused.stdout).toContain(
      "Nothing was fetched and nothing was pushed",
    );

    expect(
      await mustRun(
        ["git", "--git-dir", setup.codeberg, "rev-parse", "refs/heads/main"],
        setup.root,
      ),
    ).toBe(before);

    // The mirroring machinery itself is gone, not merely gated.
    const source = await readFile(join(setup.repo, "bin/deploy.sh"), "utf8");
    expect(source).not.toContain("MIRROR_REMOTE");
    expect(source).not.toContain("$RELEASE_REF:refs/heads/$RELEASE_BRANCH");
    expect(source).not.toMatch(/git push[^\n]*--force/);
  }, 10_000);
});
