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
/** The 22 packages whose listing on 2026-10-19 trusted the private repository, with direct publish. */
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
 * logs every call.
 */
function stubNpx(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "npx"), String.raw`#!/bin/bash
[ "$1" = --yes ] && [ "$2" = npm@11.17.0 ] || { echo "unexpected npx call: $*" >&2; exit 9; }
shift 2
echo "$*" >> "$STUB_LOG"
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
        # an expired 2FA window for the saved (--json) listings only.
        [ "${"$"}{4:-}" = --json ] && [ "${"$"}{STUB_EOTP:-0}" = 1 ] && { echo "npm error code EOTP" >&2; exit 1; }
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
        ' "new-$n" "$workflow" "$repo" "$env" "$publish" "$stage" > "$dir/new-$n.json" ;;
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

interface Run { state: string; record: string; log: string; env: Record<string, string> }

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

const callsOf = (log: string) => readFileSync(log, "utf8").split("\n").filter(Boolean);

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
    expect(result.stdout).toContain("DRY_RUN=1: nothing changed.");
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

  test("lockdown leaves unexpected trust untouched, still revokes the rest, and reports it", () => {
    const gitlab = { id: uuid(300), type: "gitlab", file: ".gitlab-ci.yml", project: "someone/else", permissions: direct };
    const unknown = github(uuid(301), "someone/else", ["createSomethingNew"]);
    const { env, log, state } = setup({
      "@agenttool/kingdom": [github(oldId("kingdom"), OLD, direct), gitlab],
      "@agenttool/heaven": "npm warn this is not a listing",
      "@agenttool/data": [unknown],
    });
    const heaven = snapshot(join(state, "agenttool-heaven"));
    const result = runScript(env, ["lockdown"]);
    expect(result.status).toBe(1);
    for (const name of ["@agenttool/kingdom", "@agenttool/heaven", "@agenttool/data"]) {
      expect(result.stderr).toContain(`${name}: unexpected trust configuration left untouched; see trust-before/${recordName(name)}.json`);
      expect(result.stderr).toContain(`${name}: NOT locked down`);
    }
    expect(result.stderr).toContain("needs attention: @agenttool/data @agenttool/heaven @agenttool/kingdom");
    expect(result.stdout).toContain("@agenttool/heaven: unreadable listing");
    expect(result.stdout).toContain(`@agenttool/kingdom: ${uuid(300)}: gitlab - .gitlab-ci.yml env -, createPackage createStagedPackage [unexpected]\n`);
    expect(result.stdout).toContain(`@agenttool/data: ${uuid(301)}: github someone/else publish-npm.yml env npm-bootstrap, createSomethingNew [unexpected]\n`);
    const calls = callsOf(log);
    expect(calls).toContain(`trust revoke @agenttool/kingdom --id ${oldId("kingdom")}`);
    expect(calls).toContain(`trust revoke @agenttool/sdk --id ${oldId("sdk")}`);
    expect(calls.filter((call) => /^trust revoke @agenttool\/(?:heaven|data) /u.test(call))).toEqual([]);
    expect(createCalls(calls)).toEqual([]);
    expect(trustOf(state, "@agenttool/kingdom")).toEqual([gitlab]);
    expect(trustOf(state, "@agenttool/data")).toEqual([unknown]);
    expect(snapshot(join(state, "agenttool-heaven"))).toEqual(heaven);
    expect(trustOf(state, "@agenttool/sdk")).toEqual([]);
  }, SCRIPT_TIMEOUT_MS);

  test("a lapsed 2FA window fails the saved listings closed, revokes nothing, and says to re-run", () => {
    const { env, log, state } = setup();
    const result = runScript({ ...env, STUB_EOTP: "1" }, ["lockdown"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@agenttool/sdk: trust list FAILED (EOTP means the 2FA window lapsed; re-run)");
    expect(result.stderr).toContain(`needs attention: ${ALL.join(" ")}`);
    const calls = callsOf(log);
    expect(revokeCalls(calls)).toEqual([]);
    expect(createCalls(calls)).toEqual([]);
    expect(trustOf(state, "@agenttool/sdk")).toEqual([github(oldId("sdk"), OLD, direct)]);
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
    const result = runScript(env, ["enable", name]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const calls = callsOf(log);
    expect(calls).toEqual([
      "--version", "whoami", `trust list ${name}`, `trust list ${name} --json`, TARGET_CALL(name), `trust list ${name} --json`,
    ]);
    expect(trustOf(state, name)).toEqual([target]);
    expect(readFileSync(join(record, "trust-after", "agenttool-relational-geometry.json"), "utf8")).toBe(`\n${JSON.stringify(target, null, 2)}\n\n`);
    // Nothing else is touched.
    expect(trustOf(state, "@agenttool/sdk")).toEqual([github(oldId("sdk"), OLD, direct)]);
    expect(readdirSync(state).filter((entry) => entry.endsWith(".mfa"))).toEqual([]);
    expect(result.stdout).toMatch(/npm EXPIRES this configuration 48 hours after creation, by \d{4}-\d\d-\d\dT\d\d:\d\dZ,/u);
    expect(result.stdout).toContain("--ref relational-geometry-v<version> -f package=relational-geometry -f tag=relational-geometry-v<version>");
    expect(result.stdout).toContain("-f authentication=trusted -f npm_tag=<latest|next> -f dry_run=false");
    expect(result.stdout).toContain(`npx --yes npm@11.17.0 trust revoke ${name} --id new-agenttool-relational-geometry`);

    writeFileSync(log, "");
    const again = runScript({ ...env, RECORD_DIR: `${record}-again` }, ["enable", "relational-geometry"]);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain(`${name}: already exactly the target; creating nothing`);
    expect(again.stdout).toContain("It already existed, and npm does not show when it was made.");
    expect(createCalls(callsOf(log))).toEqual([]);
    expect(trustOf(state, name)).toEqual([target]);
  });

  test("enable refuses a package with any other trust and creates nothing", () => {
    const { env, log, state } = setup({
      "@agenttool/math-cards": [github(uuid(400), PUBLIC, stageOnly), github(uuid(401), PUBLIC, stageOnly, "other.yml")],
    });
    for (const key of ["sdk", "math-cards"]) {
      const result = runScript(env, ["enable", key]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`@agenttool/${key}: has trust other than exactly the target (above), so enable creates nothing.`);
      expect(result.stderr).toContain("Run lockdown first");
    }
    expect(createCalls(callsOf(log))).toEqual([]);
    expect(trustOf(state, "@agenttool/sdk")).toEqual([github(oldId("sdk"), OLD, direct)]);
  });

  test("enable fails when the listing afterwards is not exactly the target", () => {
    const { env, log } = setup();
    const result = runScript({ ...env, STUB_CREATE_WIDE: "1" }, ["enable", "math-cards"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@agenttool/math-cards: NOT exactly the target after the change");
    expect(result.stdout).not.toContain("npm EXPIRES");
    expect(createCalls(callsOf(log))).toEqual([TARGET_CALL("@agenttool/math-cards")]);
  });
});
