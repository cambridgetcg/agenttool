import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { RELEASE_SPECS } from "../npm-release";

// These tests spawn git, bun and shell processes. A loaded CI runner needs
// more than bun's 5 s default (agenttool run 38274838631: 7.0 s).
setDefaultTimeout(60_000);

const ROOT = resolve(import.meta.dir, "..", "..");
const SCRIPT = join(ROOT, "docs", "npm-trust-repoint.sh");
const scratch = mkdtempSync(join(tmpdir(), "npm-trust-repoint-test-"));
/** Each run classifies every package with short Node calls, so a lockdown run takes seconds. */
const SCRIPT_TIMEOUT_MS = 120_000;
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Packages already on npm: every release spec except Local Starter, which needs its bootstrap first. */
const ON_NPM = Object.keys(RELEASE_SPECS).filter((key) => key !== "local-starter");
/** On npm under the same login but released by other routes: lockdown covers them, enable does not. */
const OUTSIDE = [
  "@agenttool/xenia", "@agenttool/xenia-surface", "@agenttool/gospel-of-the-logos", "@agenttool/hf-kingdom-lab",
  "@agenttool/whitehack-scan", "@rhetorlint/core", "@rhetorlint/rules-en", "@rhetorlint/cli", "yutabase",
];
const ALL = [...ON_NPM.map((key) => `@agenttool/${key}`), ...OUTSIDE];
/** The 22 packages whose listing on 2026-10-19 trusted the old repository, cambridgetcg/agenttool, with direct publish. */
const OLD_TRUST = [
  "adds", "data", "data-sync", "dark-continent-karma", "wake-continuity", "deepseek-kingdom", "heaven",
  "credential-broker", "sdk", "wallet", "wallet-zerone", "telescope", "browser", "alchemy", "alchemy-agentcred",
  "kingdom", "kingdom-witness-lab", "repo-archive", "collab", "correspondence-yutabase", "skills", "skills-yutabase",
];
const PUBLIC = "cambridgetcg/agenttool-packages";
const OLD = "cambridgetcg/agenttool";

/** The record (and stub registry) name of a package: @scope/name is saved as scope-name. */
const recordName = (name: string) => name.replace(/^@/u, "").replace("/", "-");
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const oldId = (key: string) => uuid(1 + OLD_TRUST.indexOf(key));

type Config = Record<string, unknown>;
/** One GitHub configuration, with the keys `npm trust list --json` prints, in its order. */
function github(id: string, repository: string, permissions: string[], file = "publish-npm.yml"): Config {
  return { id, type: "github", file, repository, environment: "npm-bootstrap", permissions };
}
const stageOnly = ["createStagedPackage"];
const direct = ["createPackage", "createStagedPackage"];

/**
 * The bytes of the real 2026-10-19 listing of @agenttool/sdk (npm 11.17.0),
 * with a synthetic id: npm prints each configuration after a blank line, then
 * one more blank line, and prints nothing for a package without trust.
 */
const REAL_SDK_LISTING = `
{
  "id": "${oldId("sdk")}",
  "type": "github",
  "file": "publish-npm.yml",
  "repository": "cambridgetcg/agenttool",
  "environment": "npm-bootstrap",
  "permissions": [
    "createPackage",
    "createStagedPackage"
  ]
}

`;

/**
 * A stand-in for `npx --yes npm@11.17.0` that keeps each package's trust
 * configurations as files in a directory, prints them like npm 11.17.0, and
 * logs every call (and, with STUB_TTY_LOG, whether it ran on a terminal).
 */
function stubNpx(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "npx"), String.raw`#!/bin/bash
[ "$1" = --yes ] && [ "$2" = npm@11.17.0 ] || { echo "unexpected npx call: $*" >&2; exit 9; }
shift 2
echo "$*" >> "$STUB_LOG"
# npm 11.17.0 asks for 2FA only when its stdin and stdout are a terminal.
if [ -n "${"$"}{STUB_TTY_LOG:-}" ]; then
  where=redirected
  [ -t 0 ] && [ -t 1 ] && where=terminal
  echo "$where $*" >> "$STUB_TTY_LOG"
fi
# A browser approval nobody completed: npm prints the prompt on stdout, then
# fails on the registry's 404 for the done URL, with npm's real (redacted) text.
if [ -n "${"$"}{STUB_AUTH_TIMEOUT:-}" ] && printf '%s\n' "$*" | grep -Eq -- "$STUB_AUTH_TIMEOUT"; then
  printf 'Authenticate your account at:\nhttps://www.npmjs.com/auth/cli/00000000-0000-4000-8000-00000000abcd\nPress ENTER to open in the browser...\n'
  printf 'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/-/v1/done?authId=***\nnpm error A complete log of this run can be found in: %s/.npm/_logs/2026-10-29T21_14_03_123Z-debug-0.log\n' "$HOME" >&2
  exit 1
fi
# npm 11.17.0 in --json mode prints its error as JSON on stdout (into the saved
# listing) and logs it on stderr, unless its loglevel is silent (STUB_QUIET).
eotp() {
  printf '{\n  "error": {\n    "code": "EOTP",\n    "summary": "This operation requires a one-time password from your authenticator.",\n    "detail": "You can provide a one-time password by passing --otp=<code> to the command you ran."\n  }\n}\n'
  [ "${"$"}{STUB_QUIET:-0}" = 1 ] || printf 'npm error code EOTP\nnpm error This operation requires a one-time password from your authenticator.\n' >&2
  exit 1
}
case "$1" in
  --version) echo 11.17.0 ;;
  whoami) echo "$STUB_USER" ;;
  access)
    [ "$2" = set ] && [ "$3" = mfa=publish ] && [ $# -eq 4 ] || { echo "unexpected access call" >&2; exit 4; }
    n="${"$"}{4#@}"
    printf 'publish\n' > "$STUB_STATE/${"$"}{n/\//-}.mfa" ;;
  trust)
    n="${"$"}{3#@}"
    n="${"$"}{n/\//-}"
    dir="$STUB_STATE/$n"
    case "$2" in
      list)
        # npm rethrows EOTP when its output is not a terminal; the stub models
        # an expired 2FA window for the saved (--json) listings only: every
        # one (STUB_EOTP), every one of some packages (STUB_EOTP_FOR), or the
        # first one of some packages (STUB_EOTP_ONCE).
        if [ "${"$"}{4:-}" = --json ]; then
          [ "${"$"}{STUB_EOTP:-0}" = 1 ] && eotp
          case " ${"$"}{STUB_EOTP_FOR:-} " in *" $3 "*) eotp ;; esac
          case " ${"$"}{STUB_EOTP_ONCE:-} " in
            *" $3 "*) [ -f "$STUB_LOG.eotp-$n" ] || { : > "$STUB_LOG.eotp-$n"; eotp; } ;;
          esac
          # The window lapses only once enable has created the configuration.
          [ "${"$"}{STUB_EOTP_AFTER_CREATE:-0}" = 1 ] && [ -f "$dir/new-$n.json" ] && eotp
        fi
        set -- "$dir"/*.json
        [ -f "$1" ] || exit 0
        for f in "$@"; do printf '\n'; cat "$f"; printf '\n'; done
        printf '\n' ;;
      revoke)
        [ "$4" = --id ] && [ $# -eq 5 ] || exit 8
        [ -f "$dir/$5.json" ] || { echo "npm error code E404" >&2; exit 1; }
        rm "$dir/$5.json" ;;
      github)
        shift 3
        repo= workflow= env= stage=0 publish=0
        while [ $# -gt 0 ]; do
          case "$1" in
            --repo) repo="$2"; shift 2 ;;
            --file) workflow="$2"; shift 2 ;;
            --env) env="$2"; shift 2 ;;
            --allow-stage-publish) stage=1; shift ;;
            --allow-publish) publish=1; shift ;;
            --yes) shift ;;
            *) echo "unexpected flag $1" >&2; exit 7 ;;
          esac
        done
        # Models a registry that saved something other than what was asked.
        [ "${"$"}{STUB_CREATE_WIDE:-0}" = 1 ] && publish=1
        mkdir -p "$dir"
        node -e '
          const [id, file, repository, environment, publish, stage] = process.argv.slice(1);
          const permissions = [...(publish === "1" ? ["createPackage"] : []), ...(stage === "1" ? ["createStagedPackage"] : [])];
          process.stdout.write(JSON.stringify({ id, type: "github", file, repository, environment, permissions }, null, 2));
        ' "new-$n" "$workflow" "$repo" "$env" "$publish" "$stage" > "$dir/new-$n.json"
        # Models npm failing on the answer after the registry saved the configuration.
        if [ "${"$"}{STUB_CREATE_THEN_FAIL:-0}" = 1 ]; then echo "npm error network aborted" >&2; exit 1; fi ;;
      *) exit 6 ;;
    esac ;;
  *) exit 5 ;;
esac
`, { mode: 0o755 });
}

let runs = 0;

const PRIME = "trust list @agenttool/adds";
const savedListings = (calls: string[]) => calls.filter((call) => /^trust list \S+ --json$/u.test(call));
const mutations = (calls: string[]) => calls.filter((call) => /^(?:trust (?:revoke|github)|access) /u.test(call));
const mfaCalls = (calls: string[]) => calls.filter((call) => call.startsWith("access "));
const createCalls = (calls: string[]) => calls.filter((call) => call.startsWith("trust github"));
const revokeCalls = (calls: string[]) => calls.filter((call) => call.startsWith("trust revoke"));
const TARGET_CALL = (name: string) =>
  `trust github ${name} --repo ${PUBLIC} --file publish-npm.yml --env npm-bootstrap --allow-stage-publish --yes`;

/** What the 2026-10-19 listing showed for the 38, plus a modelled state for some outside packages (their real trust is unknown). */
function defaultRegistry(): Record<string, Config[] | string> {
  const registry: Record<string, Config[] | string> = {};
  for (const key of OLD_TRUST) registry[`@agenttool/${key}`] = [github(oldId(key), OLD, direct)];
  registry["@agenttool/xenia"] = [github(uuid(100), "cambridgetcg/xenia", stageOnly, "stage-xenia.yml")];
  registry.yutabase = [github(uuid(101), "cambridgetcg/yutabase", direct)];
  return registry;
}

interface Run { bin: string; state: string; record: string; log: string; env: Record<string, string> }

/** A registry: a package maps to its configurations, or to raw listing text. */
function setup(extra: Record<string, Config[] | string> = {}): Run {
  runs += 1;
  const base = join(scratch, `run-${runs}`);
  const state = join(base, "state");
  mkdirSync(state, { recursive: true });
  const bin = join(base, "bin");
  stubNpx(bin);
  for (const [name, configs] of Object.entries({ ...defaultRegistry(), ...extra })) {
    const dir = join(state, recordName(name));
    mkdirSync(dir, { recursive: true });
    if (typeof configs === "string") writeFileSync(join(dir, "raw.json"), configs);
    else for (const config of configs) writeFileSync(join(dir, `${config.id}.json`), JSON.stringify(config, null, 2));
  }
  const log = join(base, "npm.log");
  writeFileSync(log, "");
  return {
    bin,
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

function runScript(env: Record<string, string>, args: string[]): { status: number | null; stdout: string; stderr: string } {
  // macOS's /bin/bash is 3.2; the script must run there.
  const result = spawnSync("/bin/bash", [SCRIPT, ...args], { cwd: scratch, env, encoding: "utf8", timeout: SCRIPT_TIMEOUT_MS });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Runs the script on a pseudo-terminal, as on the trusted device, where stdin,
 * stdout and stderr are the terminal; returns what the terminal showed.
 */
async function runOnTerminal(env: Record<string, string>, args: string[]): Promise<{ status: number; output: string }> {
  let output = "";
  const decoder = new TextDecoder();
  const proc = Bun.spawn(["/bin/bash", SCRIPT, ...args], {
    cwd: scratch,
    env,
    timeout: SCRIPT_TIMEOUT_MS,
    terminal: { cols: 200, rows: 50, data: (_terminal, data) => { output += decoder.decode(data, { stream: true }); } },
  });
  const status = await proc.exited;
  proc.terminal?.close();
  return { status, output };
}

const callsOf = (log: string) => readFileSync(log, "utf8").split("\n").filter(Boolean);
const linesOf = (text: string) => text.split("\n").filter(Boolean);
/** The script's own lines on stdout: without what npm printed there (a listing on the terminal). */
const ownLines = (stdout: string) => linesOf(stdout).filter((line) => !/^(?:[{}]|\s)/u.test(line));
/** The first of `lines` that run.log does not hold in this order, if any. */
function firstMissing(runLog: string, lines: string[]): string | undefined {
  const logged = runLog.split("\n");
  let at = 0;
  for (const line of lines) {
    at = logged.indexOf(line, at);
    if (at < 0) return line;
    at += 1;
  }
  return undefined;
}

const TIMED_OUT = "npm's browser approval timed out (its E404 for /-/v1/done means the prompt was not approved within about 5 minutes, not that the package is missing)";
const AUTH_ADVICE = 'Re-run with the browser ready: approve each npm prompt within 5 minutes, and tick "skip for the next 5 minutes" so the calls after it need no approval.';
const EOTP_FAILED = (name: string) =>
  `${name}: trust list FAILED with EOTP: the 2FA window lapsed and did not reopen (when npm asks on the terminal, tick "skip for the next 5 minutes"); re-run\n`;
const EOTP_RETRY = (name: string) => `${name}: trust list hit EOTP: the 2FA window lapsed; asking on the terminal again, then retrying it once\n`;

/** Every file under the stub registry, for "nothing changed" checks. */
function snapshot(dir: string, prefix = ""): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) Object.assign(files, snapshot(path, `${prefix}${entry}/`));
    else files[`${prefix}${entry}`] = readFileSync(path, "utf8");
  }
  return files;
}

/** The configurations a package has in the stub registry. */
function trustOf(state: string, name: string): Config[] {
  const dir = join(state, recordName(name));
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")) as Config);
}

const scriptList = (script: string, variable: string) =>
  new RegExp(`^${variable}="([^"]+)"$`, "mu").exec(script)?.[1]?.split(/\s+/u).filter(Boolean);

describe("npm trust lockdown and per-release enable", () => {
  test("covers the release allowlist and the nine outside packages, and never grants direct publish", () => {
    const script = readFileSync(SCRIPT, "utf8");
    expect(scriptList(script, "PACKAGES")).toEqual(ON_NPM);
    expect(ON_NPM).toHaveLength(38);
    expect(scriptList(script, "OUTSIDE_PACKAGES")).toEqual(OUTSIDE);
    expect(new Set(ALL.map(recordName)).size).toBe(47);
    // enable prints the release tag as <key>-v<version> and the name as @agenttool/<key>.
    for (const spec of Object.values(RELEASE_SPECS)) {
      expect(spec.tagPrefix).toBe(spec.key);
      expect(spec.name).toBe(`@agenttool/${spec.key}`);
    }
    expect(script).not.toMatch(/^[^#]*--allow-publish/mu);
    expect(script).toContain("--allow-stage-publish --yes");
    expect(script).toContain('access set mfa=publish "$name"');
    expect(script).toContain("NPM_VERSION=11.17.0");
  });

  test("refuses to run without a mode, or with another one, before any npm call", () => {
    const { env, log, record } = setup();
    for (const args of [[], ["repoint"], ["--yes"], ["lockdown", "sdk"]]) {
      const result = runScript(env, args);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("usage: bash npm-trust-repoint.sh lockdown");
      expect(result.stdout).toBe("");
    }
    // Only 1 plans; any other value but 0 would otherwise run for real.
    for (const value of ["true", "yes", "on", "2"]) {
      for (const args of [["lockdown"], ["enable", "math-cards"]]) {
        const result = runScript({ ...env, DRY_RUN: value }, args);
        expect(result.status).toBe(2);
        expect(result.stderr).toContain(`npm-trust-repoint: DRY_RUN must be 1 (list and plan only) or 0 (change npm), not ${value}`);
        expect(result.stdout).toBe("");
      }
    }
    expect(callsOf(log)).toEqual([]);
    expect(existsSync(record)).toBe(false);
  });

  test("enable refuses a package outside the public release allowlist before any npm call", () => {
    const { env, log, record } = setup();
    const refusals: Array<[string[], string]> = [
      [["enable"], "usage:"],
      [["enable", "sdk", "wallet"], "usage:"],
      [["enable", "@agenttool/xenia"], "enable: @agenttool/xenia is not a package of the public release allowlist"],
      [["enable", "@rhetorlint/core"], "enable: @rhetorlint/core is not a package of the public release allowlist"],
      [["enable", "yutabase"], "enable: yutabase is not a package of the public release allowlist"],
      [["enable", "sdk wallet"], "is not a package of the public release allowlist"],
      [["enable", "../sdk"], "is not a package of the public release allowlist"],
      [["enable", "@agenttool/"], "is not a package of the public release allowlist"],
      [["enable", "local-starter"], "@agenttool/local-starter is not on npm yet"],
    ];
    for (const [args, message] of refusals) {
      const result = runScript(env, args);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(message);
    }
    expect(callsOf(log)).toEqual([]);
    expect(existsSync(record)).toBe(false);
  });

  test("a lockdown dry run lists all 47 in npm's real shape and plans without changing anything", () => {
    const { env, log, state, record } = setup();
    const before = snapshot(state);
    const result = runScript({ ...env, DRY_RUN: "1" }, ["lockdown"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(readFileSync(join(record, "trust-before", "agenttool-sdk.json"), "utf8")).toBe(REAL_SDK_LISTING);
    expect(readFileSync(join(record, "trust-before", "agenttool-math-cards.json"), "utf8")).toBe("");
    expect(result.stdout).toContain(`@agenttool/sdk: ${oldId("sdk")}: github ${OLD} publish-npm.yml env npm-bootstrap, createPackage createStagedPackage [old repository]\n`);
    expect(result.stdout).toContain(`yutabase: ${uuid(101)}: github cambridgetcg/yutabase publish-npm.yml env npm-bootstrap, createPackage createStagedPackage [direct publish]\n`);
    expect(result.stdout).toContain(`@agenttool/xenia: ${uuid(100)}: github cambridgetcg/xenia stage-xenia.yml env npm-bootstrap, createStagedPackage [stage only]\n`);
    expect(result.stdout).toContain("@agenttool/math-cards: none");
    expect(result.stdout).toContain(`@agenttool/sdk: revoke ${oldId("sdk")}\n`);
    expect(result.stdout).toContain(`@agenttool/xenia: keep stage-only ${uuid(100)}`);
    expect(result.stdout).toContain(`yutabase: revoke ${uuid(101)}\n`);
    expect(result.stdout).toContain("@rhetorlint/cli: access set mfa=publish");
    // The trust that would stay is listed with its repository, file and environment.
    expect(result.stdout).toContain(
      "Stage-only trust that stays (a stage through it still needs your npm stage approve):\n" +
        `@agenttool/xenia: ${uuid(100)}: github cambridgetcg/xenia stage-xenia.yml env npm-bootstrap, createStagedPackage [stage only]\n` +
        "DRY_RUN=1: nothing changed.",
    );
    const calls = callsOf(log);
    // One listing on the terminal opens the 2FA window before the saved listings.
    expect(calls.slice(0, 3)).toEqual(["--version", "whoami", PRIME]);
    expect(savedListings(calls)).toEqual(ALL.map((name) => `trust list ${name} --json`));
    expect(calls).toHaveLength(3 + 47);
    expect(mutations(calls)).toEqual([]);
    expect(snapshot(state)).toEqual(before);
  }, SCRIPT_TIMEOUT_MS);

  test("lockdown revokes old-repository and direct-publish trust, keeps stage-only trust, disallows tokens on all 47, and creates nothing", () => {
    const keptPublic = github(uuid(200), PUBLIC, stageOnly);
    const keptBeside = github(uuid(201), PUBLIC, stageOnly);
    const { env, log, state, record } = setup({
      // A public-repository configuration that also allows direct publish.
      "@agenttool/math-cards": [github(uuid(202), PUBLIC, direct)],
      // An already enabled package, and one with old and stage-only trust side by side.
      "@agenttool/relational-geometry": [keptPublic],
      "@agenttool/kingdom": [github(oldId("kingdom"), OLD, direct), keptBeside],
      // The old repository with stage-only permissions and different case is still the old repository.
      "@agenttool/heaven": [github(oldId("heaven"), "CambridgeTCG/agenttool", stageOnly)],
    });
    const keptXenia = snapshot(join(state, "agenttool-xenia"));
    const first = runScript(env, ["lockdown"]);
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("All 47 packages: no trust of cambridgetcg/agenttool and no direct-publish trust, and each was set to require 2FA and disallow tokens (npm has no read-back: check one package's Settings page). No trust was created.");
    // What survives, read from the listing after the change.
    expect(first.stdout).toContain(
      "Stage-only trust that stays (a stage through it still needs your npm stage approve):\n" +
        `@agenttool/relational-geometry: ${uuid(200)}: github ${PUBLIC} publish-npm.yml env npm-bootstrap, createStagedPackage [stage only]\n` +
        `@agenttool/kingdom: ${uuid(201)}: github ${PUBLIC} publish-npm.yml env npm-bootstrap, createStagedPackage [stage only]\n` +
        `@agenttool/xenia: ${uuid(100)}: github cambridgetcg/xenia stage-xenia.yml env npm-bootstrap, createStagedPackage [stage only]\n` +
        "All 47 packages:",
    );
    const calls = callsOf(log);
    expect(calls.slice(0, 3)).toEqual(["--version", "whoami", PRIME]);
    expect(revokeCalls(calls).sort()).toEqual([
      ...OLD_TRUST.map((key) => `trust revoke @agenttool/${key} --id ${oldId(key)}`),
      `trust revoke @agenttool/math-cards --id ${uuid(202)}`,
      `trust revoke yutabase --id ${uuid(101)}`,
    ].sort());
    expect(createCalls(calls)).toEqual([]);
    expect(mfaCalls(calls)).toEqual(ALL.map((name) => `access set mfa=publish ${name}`));
    expect(savedListings(calls)).toHaveLength(94);
    // The 2FA window is opened on the terminal again before the saved after-listings.
    const primes = calls.flatMap((call, index) => (call === PRIME ? [index] : []));
    expect(primes).toHaveLength(2);
    expect(primes[1]).toBeGreaterThan(Math.max(...calls.flatMap((call, index) => (mutations([call]).length ? [index] : []))));
    expect(calls.slice(primes[1]! + 1).every((call) => / --json$/u.test(call))).toBe(true);

    for (const name of ALL) {
      expect(readFileSync(join(state, `${recordName(name)}.mfa`), "utf8")).toBe("publish\n");
      expect(existsSync(join(record, "trust-before", `${recordName(name)}.json`))).toBe(true);
      expect(existsSync(join(record, "trust-after", `${recordName(name)}.json`))).toBe(true);
    }
    expect(trustOf(state, "@agenttool/sdk")).toEqual([]);
    expect(trustOf(state, "@agenttool/math-cards")).toEqual([]);
    expect(trustOf(state, "@agenttool/heaven")).toEqual([]);
    expect(trustOf(state, "@agenttool/relational-geometry")).toEqual([keptPublic]);
    expect(trustOf(state, "@agenttool/kingdom")).toEqual([keptBeside]);
    expect(snapshot(join(state, "agenttool-xenia"))).toEqual(keptXenia);
    expect(readFileSync(join(record, "trust-after", "agenttool-sdk.json"), "utf8")).toBe("");
    expect(readFileSync(join(record, "trust-before", "agenttool-sdk.json"), "utf8")).toBe(REAL_SDK_LISTING);
    // run.log keeps the script's own lines in order; npm's listing on the terminal is not among them.
    const runLog = readFileSync(join(record, "run.log"), "utf8");
    expect(firstMissing(runLog, ownLines(first.stdout))).toBeUndefined();
    expect(runLog).toEndWith("No trust was created. Record: " + record + "\n");
    expect(runLog).not.toContain('"repository"');
    expect(existsSync(join(record, "needs-attention.txt"))).toBe(false);

    writeFileSync(log, "");
    const second = runScript({ ...env, RECORD_DIR: `${record}-again` }, ["lockdown"]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain(`@agenttool/kingdom: keep stage-only ${uuid(201)}`);
    const again = callsOf(log);
    expect(revokeCalls(again)).toEqual([]);
    expect(createCalls(again)).toEqual([]);
    // Setting the same publishing access again is harmless; npm offers no read-back to skip it.
    expect(mfaCalls(again)).toHaveLength(47);
  }, SCRIPT_TIMEOUT_MS);

  test("lockdown leaves unexpected trust untouched, keeps stage-only trust that needs review, still revokes the rest, and reports both", () => {
    const gitlab = { id: uuid(300), type: "gitlab", file: ".gitlab-ci.yml", project: "someone/else", permissions: direct };
    const unknown = github(uuid(301), "someone/else", ["createSomethingNew"]);
    // Stage-only, but matching more than the job it was made for. npm omits an empty field from the listing.
    const otherOwner = github(uuid(302), "someone/agenttool-packages", stageOnly);
    const noEnvironment = { id: uuid(303), type: "github", file: "publish-npm.yml", repository: PUBLIC, permissions: stageOnly };
    const noFile = { id: uuid(304), type: "github", repository: PUBLIC, environment: "npm-bootstrap", permissions: stageOnly };
    // A repository of the same owner is kept without review; enable still refuses it as not the target.
    const sameOwner = github(uuid(305), "cambridgetcg/agenttool-packages-fork", stageOnly);
    const { env, log, state, record } = setup({
      "@agenttool/kingdom": [github(oldId("kingdom"), OLD, direct), gitlab],
      "@agenttool/heaven": "npm warn this is not a listing",
      "@agenttool/data": [unknown],
      "@agenttool/love-bomb": [otherOwner],
      "@agenttool/hf-scout": [noEnvironment],
      "@agenttool/codex-usage": [noFile],
      "@agenttool/love-geometry": [sameOwner],
    });
    const heaven = snapshot(join(state, "agenttool-heaven"));
    const result = runScript(env, ["lockdown"]);
    expect(result.status).toBe(1);
    // A readable id comes with the revoke command, which the script does not run.
    for (const [name, id] of [["@agenttool/kingdom", uuid(300)], ["@agenttool/data", uuid(301)]] as const) {
      expect(result.stderr).toContain(
        `${name}: unexpected trust configuration ${id} left untouched; see trust-before/${recordName(name)}.json\n` +
          `  to revoke it by hand: npx --yes npm@11.17.0 trust revoke ${name} --id ${id}\n`,
      );
    }
    for (const [name, id] of [["@agenttool/love-bomb", uuid(302)], ["@agenttool/hf-scout", uuid(303)], ["@agenttool/codex-usage", uuid(304)]] as const) {
      expect(result.stderr).toContain(
        `${name}: keep stage-only ${id}, but it needs review (another owner's repository, or no workflow file or environment); see trust-before/${recordName(name)}.json\n` +
          `  to revoke it by hand: npx --yes npm@11.17.0 trust revoke ${name} --id ${id}\n`,
      );
      expect(result.stderr).toContain(`${name}: locked down, but keeps stage-only trust that needs review; see trust-after/${recordName(name)}.json`);
    }
    expect(result.stderr).toContain("@agenttool/heaven: listing unreadable, nothing revoked; see trust-before/agenttool-heaven.json");
    for (const name of ["@agenttool/kingdom", "@agenttool/heaven", "@agenttool/data"]) {
      expect(result.stderr).toContain(`${name}: NOT locked down`);
    }
    expect(result.stderr).not.toContain("@agenttool/love-geometry");
    expect(result.stderr).toContain(
      "needs attention: @agenttool/data @agenttool/heaven @agenttool/hf-scout @agenttool/love-bomb @agenttool/codex-usage @agenttool/kingdom\n" +
        "Lockdown never revokes stage-only trust: revoke one that needs review by hand (the command is above), or keep it knowingly, and lockdown keeps reporting it.\n",
    );
    expect(result.stdout).toContain("@agenttool/heaven: unreadable listing");
    expect(result.stdout).toContain(`@agenttool/kingdom: ${uuid(300)}: gitlab - .gitlab-ci.yml env -, createPackage createStagedPackage [unexpected]\n`);
    expect(result.stdout).toContain(`@agenttool/data: ${uuid(301)}: github someone/else publish-npm.yml env npm-bootstrap, createSomethingNew [unexpected]\n`);
    // A failed run still ends by listing what stays, from the listing after the change.
    expect(result.stdout).toContain(
      "Stage-only trust that stays (a stage through it still needs your npm stage approve):\n" +
        `@agenttool/hf-scout: ${uuid(303)}: github ${PUBLIC} publish-npm.yml env -, createStagedPackage [stage only, needs review: no environment]\n` +
        `@agenttool/love-bomb: ${uuid(302)}: github someone/agenttool-packages publish-npm.yml env npm-bootstrap, createStagedPackage [stage only, needs review: not a cambridgetcg repository]\n` +
        `@agenttool/love-geometry: ${uuid(305)}: github cambridgetcg/agenttool-packages-fork publish-npm.yml env npm-bootstrap, createStagedPackage [stage only]\n` +
        `@agenttool/codex-usage: ${uuid(304)}: github ${PUBLIC} - env npm-bootstrap, createStagedPackage [stage only, needs review: no workflow file]\n` +
        `@agenttool/xenia: ${uuid(100)}: github cambridgetcg/xenia stage-xenia.yml env npm-bootstrap, createStagedPackage [stage only]\n` +
        "(a package that needs attention may have more)\n",
    );
    expect(result.stdout).not.toContain("All 47 packages");
    // Each package that needs attention, with a one-word reason per problem, in the order found.
    expect(result.stderr).toContain(`Each one, with its reason: ${record}/needs-attention.txt\nRe-run lockdown after fixing them;`);
    expect(readFileSync(join(record, "needs-attention.txt"), "utf8")).toBe(
      [
        "@agenttool/data unexpected", "@agenttool/heaven unreadable", "@agenttool/hf-scout review", "@agenttool/love-bomb review",
        "@agenttool/codex-usage review", "@agenttool/kingdom unexpected",
        "@agenttool/data not-locked", "@agenttool/heaven not-locked", "@agenttool/kingdom not-locked",
      ].join("\n") + "\n",
    );
    // run.log holds every line of both streams, in the order they were printed.
    const runLog = readFileSync(join(record, "run.log"), "utf8");
    expect(firstMissing(runLog, linesOf(result.stderr))).toBeUndefined();
    expect(firstMissing(runLog, ownLines(result.stdout))).toBeUndefined();
    expect(runLog).toContain(
      `@agenttool/data: unexpected trust configuration ${uuid(301)} left untouched; see trust-before/agenttool-data.json\n` +
        `  to revoke it by hand: npx --yes npm@11.17.0 trust revoke @agenttool/data --id ${uuid(301)}\n`,
    );
    const calls = callsOf(log);
    expect(calls).toContain(`trust revoke @agenttool/kingdom --id ${oldId("kingdom")}`);
    expect(calls).toContain(`trust revoke @agenttool/sdk --id ${oldId("sdk")}`);
    expect(calls.filter((call) => /^trust revoke @agenttool\/(?:heaven|data|love-bomb|hf-scout|codex-usage|love-geometry) /u.test(call))).toEqual([]);
    expect(createCalls(calls)).toEqual([]);
    expect(mfaCalls(calls)).toHaveLength(47);
    expect(trustOf(state, "@agenttool/kingdom")).toEqual([gitlab]);
    expect(trustOf(state, "@agenttool/data")).toEqual([unknown]);
    expect(trustOf(state, "@agenttool/love-bomb")).toEqual([otherOwner]);
    expect(trustOf(state, "@agenttool/hf-scout")).toEqual([noEnvironment]);
    expect(trustOf(state, "@agenttool/codex-usage")).toEqual([noFile]);
    expect(trustOf(state, "@agenttool/love-geometry")).toEqual([sameOwner]);
    expect(snapshot(join(state, "agenttool-heaven"))).toEqual(heaven);
    expect(trustOf(state, "@agenttool/sdk")).toEqual([]);
  }, SCRIPT_TIMEOUT_MS);

  test("lockdown fails closed when its classifier fails or prints nothing", () => {
    const node = Bun.which("node");
    expect(node).toBeTruthy();
    // A node that prints nothing for every plan: killed or broken (exit 1), or silent (exit 0).
    for (const status of [1, 0]) {
      const { bin, env, log, state } = setup();
      writeFileSync(join(bin, "node"), `#!/bin/bash
for a in "$@"; do [ "$a" = plan ] && exit ${status}; done
exec ${JSON.stringify(node)} "$@"
`, { mode: 0o755 });
      const result = runScript(env, ["lockdown"]);
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain("All 47 packages");
      // Step 2 revokes nothing, and the check afterwards still fails every package.
      expect(result.stderr).toContain("@agenttool/sdk: listing unreadable, nothing revoked; see trust-before/agenttool-sdk.json");
      expect(result.stderr).toContain("@agenttool/sdk: NOT locked down");
      expect(result.stderr).toContain("@agenttool/math-cards: NOT locked down");
      expect(result.stderr).toContain(`needs attention: ${ALL.join(" ")}`);
      // Xenia's stage-only trust was not read, so "none" must not stand alone.
      expect(result.stdout).toContain("Stage-only trust that stays: none\n(a package that needs attention may have more)\n");
      const calls = callsOf(log);
      expect(revokeCalls(calls)).toEqual([]);
      expect(createCalls(calls)).toEqual([]);
      expect(trustOf(state, "@agenttool/sdk")).toEqual([github(oldId("sdk"), OLD, direct)]);
    }
  }, SCRIPT_TIMEOUT_MS);

  test("a 2FA window that stays lapsed fails the saved listings closed after one retry, revokes nothing, and says to re-run", () => {
    const { env, log, state, record } = setup();
    const result = runScript({ ...env, STUB_EOTP: "1" }, ["lockdown"]);
    expect(result.status).toBe(1);
    // The first listing that hits EOTP is retried once after 2FA on the terminal. That retry
    // hits EOTP too, so later listings are not retried: a window that does not reopen costs one
    // more terminal listing per phase, not one per package.
    expect(result.stdout).toContain(EOTP_RETRY("@agenttool/adds"));
    expect(result.stdout).not.toContain(EOTP_RETRY("@agenttool/data"));
    expect(result.stderr).toContain(EOTP_FAILED("@agenttool/adds"));
    expect(result.stderr).toContain(EOTP_FAILED("@agenttool/sdk"));
    expect(result.stderr).toContain(`needs attention: ${ALL.join(" ")}\n`);
    const calls = callsOf(log);
    expect(calls.filter((call) => /^trust list \S+$/u.test(call))).toEqual([PRIME, PRIME, PRIME, PRIME]);
    expect(savedListings(calls)).toHaveLength(2 * 48);
    expect(revokeCalls(calls)).toEqual([]);
    expect(createCalls(calls)).toEqual([]);
    expect(trustOf(state, "@agenttool/sdk")).toEqual([github(oldId("sdk"), OLD, direct)]);
    // npm prints its error into the saved listing, so the check afterwards cannot pass either.
    expect(readFileSync(join(record, "trust-after", "agenttool-sdk.json"), "utf8")).toContain('"code": "EOTP"');
    expect(readFileSync(join(record, "needs-attention.txt"), "utf8")).toBe(
      [...ALL.map((name) => `${name} eotp`), ...ALL.map((name) => `${name} not-locked`)].join("\n") + "\n",
    );
  }, SCRIPT_TIMEOUT_MS);

  test("a saved listing that hits EOTP is retried once after 2FA on the terminal, and the run goes on when the retry succeeds", () => {
    const { env, log, state, record } = setup();
    const result = runScript({ ...env, STUB_EOTP_ONCE: "@agenttool/sdk" }, ["lockdown"]);
    expect(result.status).toBe(0);
    // Only npm's own error reached stderr; the script reports nothing as failed.
    expect(result.stderr).toBe("npm error code EOTP\nnpm error This operation requires a one-time password from your authenticator.\n");
    expect(result.stdout).toContain(EOTP_RETRY("@agenttool/sdk") + "== 2FA: one listing on the terminal;");
    expect(result.stdout).toContain(`@agenttool/sdk: revoke ${oldId("sdk")}\n`);
    expect(result.stdout).toContain("All 47 packages:");
    const calls = callsOf(log);
    const sdk = ["trust list @agenttool/sdk --json", "trust list @agenttool/sdk", "trust list @agenttool/sdk --json"];
    const at = calls.indexOf(sdk[1]!);
    expect(calls.slice(at - 1, at + 2)).toEqual(sdk);
    expect(calls.filter((call) => call.startsWith("trust list @agenttool/sdk"))).toEqual([...sdk, "trust list @agenttool/sdk --json"]);
    expect(trustOf(state, "@agenttool/sdk")).toEqual([]);
    expect(readFileSync(join(record, "trust-before", "agenttool-sdk.json"), "utf8")).toBe(REAL_SDK_LISTING);
    expect(existsSync(join(record, "needs-attention.txt"))).toBe(false);
    expect(readFileSync(join(record, "run.log"), "utf8")).toContain(`npm exit status 1\n${EOTP_RETRY("@agenttool/sdk")}`);

    // With a silent loglevel npm prints the EOTP only into the saved listing; it is still recognised.
    writeFileSync(log, "");
    const quiet = runScript({ ...env, STUB_EOTP_ONCE: "@agenttool/math-cards", STUB_QUIET: "1", RECORD_DIR: `${record}-quiet` }, ["enable", "math-cards"]);
    expect(quiet.stderr).toBe("");
    expect(quiet.status).toBe(0);
    const name = "@agenttool/math-cards";
    expect(callsOf(log)).toEqual([
      "--version", "whoami", `trust list ${name}`, `trust list ${name} --json`, `trust list ${name}`, `trust list ${name} --json`,
      TARGET_CALL(name), `trust list ${name} --json`,
    ]);
  }, SCRIPT_TIMEOUT_MS);

  test("a saved listing that hits EOTP again after its retry fails closed as eotp, and nothing loops", () => {
    const { env, log, state, record } = setup();
    const result = runScript({ ...env, STUB_EOTP_FOR: "@agenttool/sdk" }, ["lockdown"]);
    expect(result.status).toBe(1);
    const calls = callsOf(log);
    // Before and after: the saved listing, the listing on the terminal, one retry.
    const once = ["trust list @agenttool/sdk --json", "trust list @agenttool/sdk", "trust list @agenttool/sdk --json"];
    expect(calls.filter((call) => call.startsWith("trust list @agenttool/sdk"))).toEqual([...once, ...once]);
    expect(revokeCalls(calls)).not.toContain(`trust revoke @agenttool/sdk --id ${oldId("sdk")}`);
    expect(revokeCalls(calls)).toContain(`trust revoke @agenttool/wallet --id ${oldId("wallet")}`);
    expect(mfaCalls(calls)).toHaveLength(47);
    expect(trustOf(state, "@agenttool/sdk")).toEqual([github(oldId("sdk"), OLD, direct)]);
    expect(trustOf(state, "@agenttool/wallet")).toEqual([]);
    expect(result.stderr).toContain(EOTP_FAILED("@agenttool/sdk"));
    expect(result.stderr).toContain("@agenttool/sdk: NOT locked down");
    expect(result.stderr).toContain(`needs attention: @agenttool/sdk\nEach one, with its reason: ${record}/needs-attention.txt\n`);
    expect(readFileSync(join(record, "needs-attention.txt"), "utf8")).toBe("@agenttool/sdk eotp\n@agenttool/sdk not-locked\n");
  }, SCRIPT_TIMEOUT_MS);

  test("a browser approval that timed out is named as one, not as a missing package, and is recorded and logged", () => {
    const { env, record } = setup({
      // npm lists this configuration but cannot revoke it: its E404 there is an ordinary failure.
      "@agenttool/heaven": `\n${JSON.stringify(github(oldId("heaven"), OLD, direct), null, 2)}\n\n`,
    });
    const result = runScript(
      { ...env, STUB_AUTH_TIMEOUT: "^(access set mfa=publish @agenttool/sdk|trust revoke @agenttool/wallet .*)$" },
      ["lockdown"],
    );
    expect(result.status).toBe(1);
    const npmError = "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/-/v1/done?authId=***\n";
    expect(result.stderr).toContain(npmError);
    expect(result.stderr).toContain(`-debug-0.log\n@agenttool/wallet: revoke ${oldId("wallet")} FAILED: ${TIMED_OUT}\n`);
    expect(result.stderr).toContain(`-debug-0.log\n@agenttool/sdk: access set mfa=publish FAILED: ${TIMED_OUT}\n`);
    expect(result.stderr).toContain(`npm error code E404\n@agenttool/heaven: revoke ${oldId("heaven")} FAILED\n`);
    expect(result.stderr).toContain(`An npm browser approval timed out. ${AUTH_ADVICE}\n`);
    // npm's prompt went to the terminal, untouched.
    expect(result.stdout).toContain("Authenticate your account at:\nhttps://www.npmjs.com/auth/cli/");
    expect(readFileSync(join(record, "needs-attention.txt"), "utf8")).toBe(
      "@agenttool/heaven revoke-failed\n@agenttool/wallet auth-timeout\n@agenttool/sdk auth-timeout\n" +
        "@agenttool/heaven not-locked\n@agenttool/wallet not-locked\n",
    );
    const runLog = readFileSync(join(record, "run.log"), "utf8");
    expect(runLog).toContain(`${npmError}npm error A complete log of this run can be found in:`);
    expect(runLog).toContain(`-debug-0.log\nnpm exit status 1\n@agenttool/sdk: access set mfa=publish FAILED: ${TIMED_OUT}\n`);
    expect(runLog).not.toContain("auth/cli");
    expect(firstMissing(runLog, linesOf(result.stderr))).toBeUndefined();
  }, SCRIPT_TIMEOUT_MS);

  test("enable and the listing on the terminal name a timed-out browser approval too", () => {
    const { env, record } = setup();
    const create = runScript({ ...env, STUB_AUTH_TIMEOUT: "^trust github " }, ["enable", "math-cards"]);
    expect(create.status).toBe(1);
    expect(create.stderr).toContain(`@agenttool/math-cards: trust github FAILED: ${TIMED_OUT}\nnpm may still have created it:`);
    expect(create.stderr).toContain(`${AUTH_ADVICE}\n`);
    expect(readFileSync(join(record, "needs-attention.txt"), "utf8")).toBe("@agenttool/math-cards auth-timeout\n");

    const primed = `${record}-prime`;
    const prime = runScript({ ...env, STUB_AUTH_TIMEOUT: "^trust list @agenttool/math-cards$", RECORD_DIR: primed }, ["enable", "math-cards"]);
    expect(prime.status).toBe(2);
    const message = `npm-trust-repoint: npm trust list failed on the terminal: ${TIMED_OUT}. ${AUTH_ADVICE}\n`;
    expect(prime.stderr).toContain(`-debug-0.log\n${message}`);
    expect(readFileSync(join(primed, "run.log"), "utf8")).toEndWith(message);
  });

  test("npm keeps the terminal for every call that can ask for 2FA; only the saved listings go to files", async () => {
    const { env, record } = setup();
    const ttyLog = join(record, "..", "tty.log");
    const lockdown = await runOnTerminal({ ...env, STUB_TTY_LOG: ttyLog }, ["lockdown"]);
    expect(lockdown.output).toContain("All 47 packages:");
    expect(lockdown.status).toBe(0);
    const enable = await runOnTerminal({ ...env, STUB_TTY_LOG: ttyLog, RECORD_DIR: `${record}-enable` }, ["enable", "math-cards"]);
    expect(enable.output).toContain("@agenttool/math-cards: created;");
    expect(enable.status).toBe(0);
    const seen = linesOf(readFileSync(ttyLog, "utf8"));
    const interactive = seen.filter((line) => / (?:trust (?:revoke|github) |access |trust list \S+$)/u.test(line));
    expect(interactive.filter((line) => line.includes(" trust revoke "))).toHaveLength(OLD_TRUST.length + 1);
    expect(interactive.filter((line) => line.includes(" access "))).toHaveLength(47);
    expect(interactive.filter((line) => line.includes(" trust github "))).toHaveLength(1);
    expect(interactive.filter((line) => / trust list \S+$/u.test(line))).toHaveLength(3);
    expect(interactive.filter((line) => !line.startsWith("terminal "))).toEqual([]);
    const saved = seen.filter((line) => / --json$/u.test(line));
    expect(saved).toHaveLength(2 * 47 + 2);
    expect(saved.filter((line) => !line.startsWith("redirected "))).toEqual([]);
  }, SCRIPT_TIMEOUT_MS);

  test("a real run warns when a run beside it asked for 2FA under 5 minutes ago, and goes on", () => {
    const { env, log, record } = setup();
    const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/gu, "").replace(/\.\d+Z$/u, "Z");
    const now = Date.now();
    const named = (label: string, ms: number) => `npm-trust-repoint-${label}-${stamp(ms)}`;
    const note = (records: string) =>
      `Note: a record beside this one is under 5 minutes old (${records}). The skip-2FA window its run opened may still be open, ` +
      "so npm may not ask now and the window can lapse midway through this run. To avoid that, stop now (Ctrl-C) and start " +
      "again once 5 minutes have passed since it; otherwise a saved listing that hits EOTP is retried once after 2FA on the terminal.\n";
    // Too old to matter, and a run stopped at this very note, before it asked npm for anything.
    mkdirSync(join(record, named("lockdown", now - 6 * 60_000)), { recursive: true });
    const stopped = named("lockdown", now - 30_000);
    mkdirSync(join(record, stopped), { recursive: true });
    writeFileSync(join(record, stopped, "run.log"), `npm 11.17.0 as agenttool; lockdown; record and run.log in ${join(record, stopped)}\n${note("x")}`);

    // A dry run does not warn; the real run straight after it does, about the dry run alone.
    const dryRun = named("enable-math-cards", now - 2_000);
    const dry = runScript({ ...env, DRY_RUN: "1", RECORD_DIR: join(record, dryRun) }, ["enable", "math-cards"]);
    expect(dry.stderr).toBe("");
    expect(dry.status).toBe(0);
    // Named as the script names its own records: it must not count itself.
    const own = named("enable-math-cards", now);
    const real = runScript({ ...env, RECORD_DIR: join(record, own) }, ["enable", "math-cards"]);
    expect(real.stderr).toBe(note(dryRun));
    expect(real.status).toBe(0);
    expect(createCalls(callsOf(log))).toEqual([TARGET_CALL("@agenttool/math-cards")]);
    expect(readFileSync(join(record, own, "run.log"), "utf8")).toContain(note(dryRun));

    // A record without run.log, from an earlier version of the script, counts.
    rmSync(join(record, dryRun, "run.log"));
    const again = runScript({ ...env, RECORD_DIR: join(record, "again") }, ["enable", "math-cards"]);
    expect(again.stderr).toBe(note(`${dryRun} ${own}`));
    expect(again.status).toBe(0);
  }, SCRIPT_TIMEOUT_MS);

  test("stops before any listing when logged in as someone else", () => {
    for (const args of [["lockdown"], ["enable", "relational-geometry"]]) {
      const { env, log } = setup();
      const result = runScript({ ...env, STUB_USER: "someone" }, args);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("logged in to npm as someone, expected agenttool");
      expect(callsOf(log)).toEqual(["--version", "whoami"]);
    }
  });

  test("an enable dry run lists the one package and creates nothing", () => {
    const { env, log, state } = setup();
    const before = snapshot(state);
    const result = runScript({ ...env, DRY_RUN: "1" }, ["enable", "@agenttool/relational-geometry"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("@agenttool/relational-geometry: trust github cambridgetcg/agenttool-packages publish-npm.yml env npm-bootstrap, stage publish only");
    expect(result.stdout).toContain("DRY_RUN=1: nothing changed. A real run starts npm's 48-hour validation clock");
    expect(callsOf(log)).toEqual([
      "--version", "whoami", "trust list @agenttool/relational-geometry", "trust list @agenttool/relational-geometry --json",
    ]);
    expect(snapshot(state)).toEqual(before);
  });

  test("enable creates exactly the stage-only target for one package, checks it, and says it expires in 48 hours", () => {
    const { env, log, state, record } = setup();
    const name = "@agenttool/relational-geometry";
    const target = github("new-agenttool-relational-geometry", PUBLIC, stageOnly);
    // Named as the script names its own records, so a later run finds this one.
    const first = join(record, "npm-trust-repoint-enable-relational-geometry-20261028T101000Z");
    const result = runScript({ ...env, RECORD_DIR: first }, ["enable", name]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const calls = callsOf(log);
    expect(calls).toEqual([
      "--version", "whoami", `trust list ${name}`, `trust list ${name} --json`, TARGET_CALL(name), `trust list ${name} --json`,
    ]);
    expect(trustOf(state, name)).toEqual([target]);
    expect(readFileSync(join(first, "trust-after", "agenttool-relational-geometry.json"), "utf8")).toBe(`\n${JSON.stringify(target, null, 2)}\n\n`);
    // Nothing else is touched.
    expect(trustOf(state, "@agenttool/sdk")).toEqual([github(oldId("sdk"), OLD, direct)]);
    expect(readdirSync(state).filter((entry) => entry.endsWith(".mfa"))).toEqual([]);
    const deadline = readFileSync(join(first, "expires-by.txt"), "utf8").trim();
    expect(deadline).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/u);
    expect(Date.parse(deadline) - Date.now()).toBeGreaterThan(47.9 * 3600_000);
    expect(result.stdout).toContain(`${name}: created; npm expires it by ${deadline} unless a stage through it is approved first\n`);
    expect(result.stdout).toContain(`npm EXPIRES this configuration 48 hours after creation, by ${deadline},`);
    expect(result.stdout).toContain("--ref relational-geometry-v<version> -f package=relational-geometry -f tag=relational-geometry-v<version>");
    expect(result.stdout).toContain("-f authentication=trusted -f npm_tag=<latest|next> -f dry_run=false");
    expect(result.stdout).toContain(`npx --yes npm@11.17.0 trust revoke ${name} --id new-agenttool-relational-geometry`);

    // A re-run creates nothing, says to revoke and re-enable unless the
    // configuration is known to be fresh or validated, and finds the deadline
    // recorded beside it; a record of another package with the same prefix is ignored.
    const other = join(record, "npm-trust-repoint-enable-relational-geometry-x-20261029T000000Z");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "expires-by.txt"), "2099-01-01T00:00Z\n");
    writeFileSync(log, "");
    const again = runScript({ ...env, RECORD_DIR: join(record, "npm-trust-repoint-enable-relational-geometry-20261028T120000Z") }, ["enable", "relational-geometry"]);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain(`${name}: already exactly the target; creating nothing`);
    expect(again.stdout).toContain("It already existed. npm shows neither when it was made nor whether it has\nexpired");
    expect(again.stdout).toContain(`The newest enable record for this package, ${first},\nrecords the deadline ${deadline}; if nothing was revoked or created by\nhand since, this is the configuration that run created.\n`);
    expect(again.stdout).toContain(`revoke it and run enable again before dispatching`);
    expect(again.stdout).toContain(`  npx --yes npm@11.17.0 trust revoke ${name} --id new-agenttool-relational-geometry\nThen, within the 48 hours:\n`);
    expect(again.stdout).not.toContain("2099");
    expect(createCalls(callsOf(log))).toEqual([]);
    expect(trustOf(state, name)).toEqual([target]);
  });

  test("enable refuses a package with any other trust, even a near miss of the target, and creates nothing", () => {
    // npm omits an empty field from the listing.
    const noFile = { id: uuid(402), type: "github", repository: PUBLIC, environment: "npm-bootstrap", permissions: stageOnly };
    const noEnvironment = { id: uuid(403), type: "github", file: "publish-npm.yml", repository: PUBLIC, permissions: stageOnly };
    const { env, log, state } = setup({
      "@agenttool/math-cards": [github(uuid(400), PUBLIC, stageOnly), github(uuid(401), PUBLIC, stageOnly, "other.yml")],
      // Each alone is stage-only trust of the public repository, but not of the target.
      "@agenttool/love-bomb": [github(uuid(404), PUBLIC, stageOnly, "other.yml")],
      "@agenttool/love-geometry": [{ ...github(uuid(405), PUBLIC, stageOnly), environment: "production" }],
      "@agenttool/hf-scout": [noEnvironment],
      "@agenttool/codex-usage": [noFile],
      "@agenttool/telescope": [github(uuid(406), "cambridgetcg/agenttool-packages-fork", stageOnly)],
    });
    for (const key of ["sdk", "math-cards", "love-bomb", "love-geometry", "hf-scout", "codex-usage", "telescope"]) {
      const result = runScript(env, ["enable", key]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`@agenttool/${key}: has trust other than exactly the target (above), so enable creates nothing.`);
      expect(result.stderr).toContain("Run lockdown first");
      expect(result.stdout).not.toContain("trusts cambridgetcg/agenttool-packages");
    }
    expect(createCalls(callsOf(log))).toEqual([]);
    expect(trustOf(state, "@agenttool/sdk")).toEqual([github(oldId("sdk"), OLD, direct)]);
    expect(trustOf(state, "@agenttool/hf-scout")).toEqual([noEnvironment]);
  });

  test("enable fails when the listing afterwards is not exactly the target, and says how to remove it", () => {
    const { env, log } = setup();
    const result = runScript({ ...env, STUB_CREATE_WIDE: "1" }, ["enable", "math-cards"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@agenttool/math-cards: NOT exactly the target after the change");
    expect(result.stderr).toMatch(/What this run created expires by \d{4}-\d\d-\d\dT\d\d:\d\dZ unless a stage through it is approved first\./u);
    expect(result.stderr).toContain(
      "Do not dispatch. Revoke what is listed above, then run enable again:\n" +
        "  npx --yes npm@11.17.0 trust revoke @agenttool/math-cards --id new-agenttool-math-cards\n" +
        "Or run lockdown now: it revokes every configuration that allows direct publish.",
    );
    expect(result.stdout).not.toContain("npm EXPIRES");
    expect(createCalls(callsOf(log))).toEqual([TARGET_CALL("@agenttool/math-cards")]);
  });

  test("enable keeps the deadline when the listing after creation fails", () => {
    const { env, log, state, record } = setup();
    const name = "@agenttool/math-cards";
    const first = join(record, "npm-trust-repoint-enable-math-cards-20261028T101000Z");
    const result = runScript({ ...env, STUB_EOTP_AFTER_CREATE: "1", RECORD_DIR: first }, ["enable", "math-cards"]);
    expect(result.status).toBe(1);
    expect(createCalls(callsOf(log))).toEqual([TARGET_CALL(name)]);
    const deadline = readFileSync(join(first, "expires-by.txt"), "utf8").trim();
    expect(deadline).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/u);
    expect(result.stdout).toContain(`${name}: created; npm expires it by ${deadline}`);
    expect(result.stderr).toContain(`${name}: the configuration was created; npm expires it by ${deadline} unless a stage through it is approved first (also in ${first}/expires-by.txt).`);
    expect(result.stderr).toContain("Re-run enable: it finds the target and only checks it.");

    // The suggested re-run finds the target and the deadline recorded beside it.
    const again = runScript({ ...env, RECORD_DIR: join(record, "npm-trust-repoint-enable-math-cards-20261028T101500Z") }, ["enable", "math-cards"]);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain(`The newest enable record for this package, ${first},\nrecords the deadline ${deadline};`);
    expect(trustOf(state, name)).toEqual([github("new-agenttool-math-cards", PUBLIC, stageOnly)]);
  });

  test("enable records the deadline when trust github fails, and a dry run on the target then shows it with the advice", () => {
    const { env, log, state, record } = setup();
    const name = "@agenttool/math-cards";
    const first = join(record, "npm-trust-repoint-enable-math-cards-20261028T101000Z");
    // The registry saved the configuration, then npm failed on the answer.
    const result = runScript({ ...env, STUB_CREATE_THEN_FAIL: "1", RECORD_DIR: first }, ["enable", "math-cards"]);
    expect(result.status).toBe(1);
    expect(callsOf(log)).toEqual(["--version", "whoami", `trust list ${name}`, `trust list ${name} --json`, TARGET_CALL(name)]);
    const recorded = readFileSync(join(first, "expires-by.txt"), "utf8");
    expect(recorded).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\dZ \(if npm created it\)\n$/u);
    const deadline = recorded.split(" ")[0]!;
    expect(result.stderr).toContain(
      `${name}: trust github FAILED\n` +
        `npm may still have created it: run DRY_RUN=1 bash npm-trust-repoint.sh enable math-cards to check; if it is listed, it expires by ${deadline} unless a stage through it is approved first.\n`,
    );
    expect(result.stdout).not.toContain("created; npm expires it");

    // The suggested dry run finds it and prints what a real run would: the
    // recorded deadline and the advice to revoke and re-enable unless it is fresh.
    writeFileSync(log, "");
    const before = snapshot(state);
    const check = runScript(
      { ...env, DRY_RUN: "1", RECORD_DIR: join(record, "npm-trust-repoint-enable-math-cards-20261028T101500Z") },
      ["enable", "math-cards"],
    );
    expect(check.stderr).toBe("");
    expect(check.status).toBe(0);
    expect(check.stdout).toContain(`${name}: already exactly the target; creating nothing\n`);
    expect(check.stdout).toContain("DRY_RUN=1: nothing changed; a real run lists again and prints the notice below.\n");
    expect(check.stdout).not.toContain("== 3/3");
    expect(check.stdout).toContain(`The newest enable record for this package, ${first},\nrecords the deadline ${deadline} (if npm created it); if nothing was revoked or created by\n`);
    expect(check.stdout).toContain("It already existed. npm shows neither when it was made nor whether it has\nexpired");
    expect(check.stdout).toContain(`  npx --yes npm@11.17.0 trust revoke ${name} --id new-agenttool-math-cards\nThen, within the 48 hours:\n`);
    expect(callsOf(log)).toEqual(["--version", "whoami", `trust list ${name}`, `trust list ${name} --json`]);
    expect(snapshot(state)).toEqual(before);
  });
});
