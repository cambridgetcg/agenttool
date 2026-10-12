import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { RELEASE_SPECS } from "../npm-release";

const ROOT = resolve(import.meta.dir, "..", "..");
const SCRIPT = join(ROOT, "docs", "npm-trust-repoint.sh");
const scratch = mkdtempSync(join(tmpdir(), "npm-trust-repoint-test-"));
/** Each run classifies every package with a short Node call, so a full run takes seconds. */
const SCRIPT_TIMEOUT_MS = 120_000;
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Packages already on npm: every release spec except Local Starter, which needs its bootstrap first. */
const ON_NPM = Object.keys(RELEASE_SPECS).filter((key) => key !== "local-starter");
/** The fifteen packages whose earlier releases used the private repository's OIDC trust. */
const OIDC_PUBLISHED = [
  "adds", "data-sync", "wake-continuity", "deepseek-kingdom", "credential-broker", "sdk", "wallet", "telescope",
  "browser", "alchemy", "alchemy-agentcred", "kingdom", "collab", "correspondence-yutabase", "skills",
];

/**
 * A stand-in for `npx --yes npm@11.17.0` that keeps one trust configuration
 * per package in a directory, like the registry, and logs every call.
 */
function stubNpx(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "npx"), String.raw`#!/bin/bash
[ "$1" = --yes ] && [ "$2" = npm@11.17.0 ] || { echo "unexpected npx call: $*" >&2; exit 9; }
shift 2
echo "$*" >> "$STUB_LOG"
state="$STUB_STATE"
case "$1" in
  --version) echo 11.17.0 ;;
  whoami) echo "$STUB_USER" ;;
  trust)
    package="$(printf '%s' "$3" | sed 's|^@agenttool/||')"
    file="$state/$package.json"
    case "$2" in
      list) [ -f "$file" ] && cat "$file"; exit 0 ;;
      revoke)
        [ "$4" = --id ] || exit 8
        grep -q "\"id\": \"$5\"" "$file" 2>/dev/null || { echo "no such id" >&2; exit 1; }
        : > "$file" ;;
      github)
        [ -s "$file" ] && { echo "E409 a trust configuration already exists" >&2; exit 1; }
        shift 3
        repo= workflow= env= perms=
        while [ $# -gt 0 ]; do
          case "$1" in
            --repo) repo="$2"; shift 2 ;;
            --file) workflow="$2"; shift 2 ;;
            --env) env="$2"; shift 2 ;;
            --allow-stage-publish) perms="$perms,\"createStagedPackage\""; shift ;;
            --allow-publish) perms="$perms,\"createPackage\""; shift ;;
            --yes) shift ;;
            *) echo "unexpected flag $1" >&2; exit 7 ;;
          esac
        done
        printf '{\n  "id": "new-%s",\n  "type": "github",\n  "file": "%s",\n  "repository": "%s",\n  "environment": "%s",\n  "permissions": [%s]\n}\n' \
          "$package" "$workflow" "$repo" "$env" "$(printf '%s' "$perms" | sed 's/^,//')" > "$file" ;;
      *) exit 6 ;;
    esac ;;
  *) exit 5 ;;
esac
`, { mode: 0o755 });
}

let runs = 0;

function setup(extra: Record<string, string> = {}): { state: string; record: string; log: string; env: Record<string, string> } {
  runs += 1;
  const base = join(scratch, `run-${runs}`);
  const state = join(base, "state");
  mkdirSync(state, { recursive: true });
  const bin = join(base, "bin");
  stubNpx(bin);
  for (const key of OIDC_PUBLISHED) {
    writeFileSync(join(state, `${key}.json`), `${JSON.stringify({
      id: `old-${key}`,
      type: "github",
      file: "publish-npm.yml",
      repository: "cambridgetcg/agenttool",
      environment: "npm-bootstrap",
    }, null, 2)}\n`);
  }
  for (const [key, content] of Object.entries(extra)) writeFileSync(join(state, `${key}.json`), content);
  const log = join(base, "npm.log");
  writeFileSync(log, "");
  return {
    state,
    record: join(base, "record"),
    log,
    env: {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      HOME: base,
      STUB_STATE: state,
      STUB_LOG: log,
      STUB_USER: "agenttool",
      PAUSE_SECONDS: "0",
      RECORD_DIR: join(base, "record"),
    },
  };
}

function runScript(env: Record<string, string>): { status: number | null; stdout: string; stderr: string } {
  // macOS's /bin/bash is 3.2; the script must run there.
  const result = spawnSync("/bin/bash", [SCRIPT], { cwd: scratch, env, encoding: "utf8", timeout: 120_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function target(key: string): unknown {
  return {
    id: `new-${key}`,
    type: "github",
    file: "publish-npm.yml",
    repository: "cambridgetcg/agenttool-packages",
    environment: "npm-bootstrap",
    permissions: ["createStagedPackage"],
  };
}

describe("the one-time npm trust re-point", () => {
  test("covers exactly the 38 packages on npm and never grants direct publish", () => {
    const script = readFileSync(SCRIPT, "utf8");
    const listed = /^PACKAGES="([^"]+)"$/mu.exec(script)?.[1]?.split(/\s+/u).filter(Boolean);
    expect(listed).toEqual(ON_NPM);
    expect(ON_NPM).toHaveLength(38);
    expect(script).not.toMatch(/^[^#]*--allow-publish/mu);
    expect(script).toContain('--allow-stage-publish --yes');
    expect(script).toContain("NPM_VERSION=11.17.0");
  });

  test("a dry run lists and plans without changing anything", () => {
    const { env, log, state } = setup();
    const before = readdirSync(state).map((name) => readFileSync(join(state, name), "utf8"));
    const result = runScript({ ...env, DRY_RUN: "1" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("@agenttool/sdk: revoke old-sdk");
    expect(result.stdout).toContain("@agenttool/math-cards: none");
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls.filter((call) => /^trust (?:revoke|github)/u.test(call))).toEqual([]);
    expect(calls.filter((call) => call.startsWith("trust list"))).toHaveLength(38);
    expect(readdirSync(state).map((name) => readFileSync(join(state, name), "utf8"))).toEqual(before);
  }, SCRIPT_TIMEOUT_MS);

  test("revokes the old trust, creates stage-only trust for all 38, and a re-run changes nothing", () => {
    const { env, log, state, record } = setup();
    const first = runScript(env);
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("All 38 packages trust cambridgetcg/agenttool-packages publish-npm.yml (npm-bootstrap) for stage publish only.");
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls.slice(0, 2)).toEqual(["--version", "whoami"]);
    expect(calls.filter((call) => call.startsWith("trust revoke")).sort()).toEqual(
      OIDC_PUBLISHED.map((key) => `trust revoke @agenttool/${key} --id old-${key}`).sort(),
    );
    expect(calls.filter((call) => call.startsWith("trust github"))).toEqual(ON_NPM.map((key) =>
      `trust github @agenttool/${key} --repo cambridgetcg/agenttool-packages --file publish-npm.yml --env npm-bootstrap --allow-stage-publish --yes`));
    expect(calls.filter((call) => call.startsWith("trust list"))).toHaveLength(76);
    for (const key of ON_NPM) {
      expect(JSON.parse(readFileSync(join(state, `${key}.json`), "utf8"))).toEqual(target(key));
      expect(existsSync(join(record, "trust-before", `${key}.json`))).toBe(true);
      expect(JSON.parse(readFileSync(join(record, "trust-after", `${key}.json`), "utf8"))).toEqual(target(key));
    }
    expect(readFileSync(join(record, "trust-before", "sdk.json"), "utf8")).toContain('"repository": "cambridgetcg/agenttool"');

    writeFileSync(log, "");
    const second = runScript({ ...env, RECORD_DIR: `${record}-again` });
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("@agenttool/sdk: already re-pointed");
    expect(readFileSync(log, "utf8").split("\n").filter((call) => /^trust (?:revoke|github)/u.test(call))).toEqual([]);
  }, SCRIPT_TIMEOUT_MS);

  test("leaves a foreign configuration untouched, re-points the rest, and reports it", () => {
    const foreign = `${JSON.stringify({ id: "x1", type: "github", file: "release.yml", repository: "someone/else" }, null, 2)}\n`;
    const { env, state } = setup({ kingdom: foreign });
    const result = runScript(env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@agenttool/kingdom: unexpected trust configuration left untouched");
    expect(result.stderr).toContain("needs attention: kingdom");
    expect(readFileSync(join(state, "kingdom.json"), "utf8")).toBe(foreign);
    expect(JSON.parse(readFileSync(join(state, "sdk.json"), "utf8"))).toEqual(target("sdk"));
  }, SCRIPT_TIMEOUT_MS);

  test("re-creates a public-repository configuration that also allows direct publish", () => {
    const broad = `${JSON.stringify({
      id: "wide",
      type: "github",
      file: "publish-npm.yml",
      repository: "cambridgetcg/agenttool-packages",
      environment: "npm-bootstrap",
      permissions: ["createPackage", "createStagedPackage"],
    }, null, 2)}\n`;
    const { env, state, log } = setup({ "math-cards": broad });
    expect(runScript(env).status).toBe(0);
    expect(readFileSync(log, "utf8")).toContain("trust revoke @agenttool/math-cards --id wide");
    expect(JSON.parse(readFileSync(join(state, "math-cards.json"), "utf8"))).toEqual(target("math-cards"));
  }, SCRIPT_TIMEOUT_MS);

  test("stops before any call when logged in as someone else", () => {
    const { env, log } = setup();
    const result = runScript({ ...env, STUB_USER: "someone" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("logged in to npm as someone, expected agenttool");
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["--version", "whoami"]);
  }, SCRIPT_TIMEOUT_MS);
});
