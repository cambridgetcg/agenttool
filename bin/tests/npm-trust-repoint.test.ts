import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { RELEASE_SPECS } from "../npm-release";

// These tests spawn git, bun and shell processes. A loaded CI runner needs
// more than bun's 5 s default (agenttool run 38274838631: 7.0 s).
setDefaultTimeout(60_000);

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
  access)
    [ "$2" = set ] && [ "$3" = mfa=publish ] || { echo "unexpected access call" >&2; exit 4; }
    printf 'publish\n' > "$state/$(printf '%s' "$4" | sed 's|^@agenttool/||').mfa" ;;
  trust)
    package="$(printf '%s' "$3" | sed 's|^@agenttool/||')"
    file="$state/$package.json"
    case "$2" in
      list)
        # npm rethrows EOTP when its output is not a terminal; the stub models
        # an expired 2FA window for the saved (--json) listings only.
        [ "$4" = --json ] && [ "$STUB_EOTP" = 1 ] && { echo "npm error code EOTP" >&2; exit 1; }
        [ -f "$file" ] && cat "$file"; exit 0 ;;
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

const PRIME = "trust list @agenttool/adds";
const savedListings = (calls: string[]) => calls.filter((call) => /^trust list @agenttool\/[a-z-]+ --json$/u.test(call));
const mfaCalls = (calls: string[]) => calls.filter((call) => call.startsWith("access "));

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
    expect(script).toContain('access set mfa=publish "@agenttool/$package"');
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
    expect(result.stdout).toContain("@agenttool/sdk: access set mfa=publish");
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls.filter((call) => /^trust (?:revoke|github)/u.test(call))).toEqual([]);
    expect(mfaCalls(calls)).toEqual([]);
    // One listing on the terminal opens the 2FA window before the saved listings.
    expect(calls.slice(0, 3)).toEqual(["--version", "whoami", PRIME]);
    expect(savedListings(calls)).toHaveLength(38);
    expect(calls).toHaveLength(3 + 38);
    expect(readdirSync(state).map((name) => readFileSync(join(state, name), "utf8"))).toEqual(before);
  }, SCRIPT_TIMEOUT_MS);

  test("revokes the old trust, creates stage-only trust, disallows tokens for all 38, and a re-run re-points nothing", () => {
    const { env, log, state, record } = setup();
    const first = runScript(env);
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("All 38 packages trust cambridgetcg/agenttool-packages publish-npm.yml (npm-bootstrap) for stage publish only and disallow tokens.");
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls.slice(0, 3)).toEqual(["--version", "whoami", PRIME]);
    expect(calls.filter((call) => call.startsWith("trust revoke")).sort()).toEqual(
      OIDC_PUBLISHED.map((key) => `trust revoke @agenttool/${key} --id old-${key}`).sort(),
    );
    expect(calls.filter((call) => call.startsWith("trust github"))).toEqual(ON_NPM.map((key) =>
      `trust github @agenttool/${key} --repo cambridgetcg/agenttool-packages --file publish-npm.yml --env npm-bootstrap --allow-stage-publish --yes`));
    expect(mfaCalls(calls)).toEqual(ON_NPM.map((key) => `access set mfa=publish @agenttool/${key}`));
    expect(savedListings(calls)).toHaveLength(76);
    // The 2FA window is opened on the terminal again before the saved after-listings.
    const primes = calls.flatMap((call, index) => (call === PRIME ? [index] : []));
    expect(primes).toHaveLength(2);
    const lastMutation = Math.max(...calls.flatMap((call, index) => (/^(?:trust github|access set)/u.test(call) ? [index] : [])));
    expect(primes[1]).toBeGreaterThan(lastMutation);
    expect(calls.slice(primes[1]! + 1).every((call) => / --json$/u.test(call))).toBe(true);
    for (const key of ON_NPM) {
      expect(JSON.parse(readFileSync(join(state, `${key}.json`), "utf8"))).toEqual(target(key));
      expect(readFileSync(join(state, `${key}.mfa`), "utf8")).toBe("publish\n");
      expect(existsSync(join(record, "trust-before", `${key}.json`))).toBe(true);
      expect(JSON.parse(readFileSync(join(record, "trust-after", `${key}.json`), "utf8"))).toEqual(target(key));
    }
    expect(readFileSync(join(record, "trust-before", "sdk.json"), "utf8")).toContain('"repository": "cambridgetcg/agenttool"');

    writeFileSync(log, "");
    const second = runScript({ ...env, RECORD_DIR: `${record}-again` });
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("@agenttool/sdk: already re-pointed");
    const again = readFileSync(log, "utf8").trim().split("\n");
    expect(again.filter((call) => /^trust (?:revoke|github)/u.test(call))).toEqual([]);
    // Setting the same publishing access again is harmless; npm offers no read-back to skip it.
    expect(mfaCalls(again)).toHaveLength(38);
  }, SCRIPT_TIMEOUT_MS);

  test("a lapsed 2FA window fails the saved listings closed, re-points nothing, and says to re-run", () => {
    const { env, log, state } = setup();
    const result = runScript({ ...env, STUB_EOTP: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@agenttool/sdk: trust list FAILED (EOTP means the 2FA window lapsed; re-run)");
    expect(result.stderr).toContain(`needs attention: ${ON_NPM.join(" ")}`);
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls.filter((call) => /^trust (?:revoke|github)/u.test(call))).toEqual([]);
    expect(JSON.parse(readFileSync(join(state, "sdk.json"), "utf8")).repository).toBe("cambridgetcg/agenttool");
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
