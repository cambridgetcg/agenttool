import { describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  DEFAULT_PUBLISH_MODE,
  EXPECTED_REPOSITORY,
  LOVE_MIRROR_ROOT,
  RELEASE_RECEIPT_SCHEMA,
  RELEASE_REPOSITORY,
  RELEASE_REPOSITORY_URL,
  RELEASE_SPECS,
  RELEASE_TAGGER_EMAIL,
  RELEASE_TAGGER_NAME,
  STAGE_RECEIPT_SCHEMA,
  ReleaseTagRefused,
  UNVERIFIED_CI_RUN,
  assertReleaseTagEvidence,
  assertReleaseTagObject,
  historicalLoveManifestPath,
  isReleaseRemote,
  npmFailureMessage,
  npmOidcLogLines,
  npmPublishArguments,
  npmPublishEnvironment,
  oidcLogLines,
  packGateScripts,
  parseAuthentication,
  parsePublishMode,
  parseReleaseTagObject,
  parseStagePublishOutput,
  planDispatch,
  publishAction,
  publishWorkflowPackageOptions,
  readStageReceipt,
  releaseSpec,
  releaseTagMessage,
  runNpmPublication,
  stageApprovalSummary,
  stageReceipt,
  validatePackageManifest,
  type FetchJson,
  type PackageJson,
  type PreparedReceipt,
} from "../npm-release";

// These tests spawn git, bun and shell processes. A loaded CI runner needs
// more than bun's 5 s default (agenttool run 38274838631: 7.0 s).
setDefaultTimeout(60_000);

const ROOT = resolve(import.meta.dir, "..", "..");
const PUBLISH_WORKFLOW = join(ROOT, "public", "overlay", ".github", "workflows", "publish-npm.yml");
const STAGE_ID = "0f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";

function preparedReceipt(): PreparedReceipt {
  const bytes = new TextEncoder().encode("exact staged artifact");
  const digest = (algorithm: "sha1" | "sha256" | "sha512", encoding: "hex" | "base64") =>
    createHash(algorithm).update(bytes).digest(encoding);
  return {
    schema: RELEASE_RECEIPT_SCHEMA,
    package: { key: "math-cards", name: "@agenttool/math-cards", version: "0.1.0-dev.2", path: "packages/math-cards" },
    tag: "math-cards-v0.1.0-dev.2",
    tag_commit: "a".repeat(40),
    source_revision: "a".repeat(40),
    artifact: {
      filename: "agenttool-math-cards-0.1.0-dev.2.tgz",
      size: bytes.byteLength,
      sha1: digest("sha1", "hex"),
      sha256: digest("sha256", "hex"),
      integrity: `sha512-${digest("sha512", "base64")}`,
    },
    prepared_at: "2026-10-12T12:00:00.000Z",
  };
}

function manifestFor(key: string, overrides: Partial<PackageJson> = {}): PackageJson {
  const spec = releaseSpec(key);
  return {
    name: spec.name,
    version: "1.2.3",
    license: "Apache-2.0",
    publishConfig: { access: "public" },
    repository: { type: "git", url: EXPECTED_REPOSITORY, directory: spec.packagePath },
    scripts: { prepack: "bun run ci", ci: "bun test" },
    ...overrides,
  };
}

describe("one public release repository", () => {
  test("derives every repository identity from RELEASE_REPOSITORY", () => {
    expect(RELEASE_REPOSITORY).toBe("cambridgetcg/agenttool-packages");
    expect(RELEASE_REPOSITORY_URL).toBe("https://github.com/cambridgetcg/agenttool-packages");
    expect(EXPECTED_REPOSITORY).toBe("https://github.com/cambridgetcg/agenttool-packages.git");
    expect(isReleaseRemote("https://github.com/cambridgetcg/agenttool-packages")).toBe(true);
    expect(isReleaseRemote("https://github.com/cambridgetcg/agenttool-packages.git")).toBe(true);
    expect(isReleaseRemote("git@github.com:cambridgetcg/agenttool-packages.git")).toBe(true);
    expect(isReleaseRemote("https://github.com/cambridgetcg/agenttool.git")).toBe(false);
    expect(isReleaseRemote("https://github.com/cambridgetcg/agenttool-packages-fork.git")).toBe(false);
    expect(isReleaseRemote("/tmp/agenttool-packages.git")).toBe(false);
  });

  test("names the private repository nowhere in the release tool", () => {
    const script = readFileSync(join(ROOT, "bin", "npm-release.ts"), "utf8");
    // The only literal is the RELEASE_REPOSITORY constant; every URL derives from it.
    expect(script.match(/cambridgetcg\/agenttool(?![\w-])/gu)).toBeNull();
    expect(script.match(/cambridgetcg\/agenttool-packages/gu)).toEqual(["cambridgetcg/agenttool-packages"]);
    expect(script).not.toContain("api.github.com/repos/cambridgetcg");
    expect(script).not.toContain("uploads.github.com/repos/cambridgetcg");
    // Historical LOVE verification keeps its own fixed inputs in build-love-packages.
    const love = readFileSync(join(ROOT, "bin", "build-love-packages.ts"), "utf8");
    expect(love).toContain('export const GITHUB_REPOSITORY = "https://github.com/cambridgetcg/agenttool" as const;');
  });

  test("accepts only package metadata that names the public repository and the spec path", () => {
    expect(validatePackageManifest(releaseSpec("math-cards"), manifestFor("math-cards"))).toBe("1.2.3");
    const sdk = releaseSpec("sdk");
    expect(validatePackageManifest(sdk, manifestFor("sdk", { repository: { type: "git", url: EXPECTED_REPOSITORY } }))).toBe("1.2.3");
    expect(() => validatePackageManifest(releaseSpec("math-cards"), manifestFor("math-cards", {
      repository: { type: "git", url: "https://github.com/cambridgetcg/agenttool.git", directory: "packages/math-cards" },
    }))).toThrow(`repository.url must be ${EXPECTED_REPOSITORY}`);
    expect(() => validatePackageManifest(releaseSpec("math-cards"), manifestFor("math-cards", {
      repository: { type: "git", url: EXPECTED_REPOSITORY, directory: "packages/other" },
    }))).toThrow("repository.directory must be packages/math-cards");
    expect(() => validatePackageManifest(releaseSpec("math-cards"), manifestFor("math-cards", { private: true }))).toThrow("is private");
  });
});

describe("pack artifacts with historical LOVE verification", () => {
  test("every release spec packs; LOVE bytes are reused only where a manifest for that exact version exists", () => {
    for (const spec of Object.values(RELEASE_SPECS)) expect(spec.artifactKind).toBe("pack");
    const sdk = releaseSpec("sdk");
    expect(historicalLoveManifestPath(sdk, "0.22.1", "/repo")).toBe(`/repo/${LOVE_MIRROR_ROOT}/sdk/0.22.1/manifest.json`);
    // The private checkout keeps immutable manifests for released LOVE versions...
    expect(existsSync(historicalLoveManifestPath(sdk, "0.22.1", ROOT))).toBe(true);
    expect(existsSync(historicalLoveManifestPath(releaseSpec("adds"), "0.2.3", ROOT))).toBe(true);
    // ...and none for an unreleased version or for packages that always packed.
    expect(existsSync(historicalLoveManifestPath(releaseSpec("hf-scout"), "0.2.0-dev.1", ROOT))).toBe(false);
    expect(existsSync(historicalLoveManifestPath(releaseSpec("math-cards"), "0.1.0-dev.2", ROOT))).toBe(false);
    expect(() => historicalLoveManifestPath(sdk, "../../etc", ROOT)).toThrow("invalid package version");
    const script = readFileSync(join(ROOT, "bin", "npm-release.ts"), "utf8");
    expect(script).toContain("await hasHistoricalLoveManifest(spec, version)\n    ? await loveArtifact(");
  });

  test("runs a declared gate or the package's prepack before packing, and refuses neither", () => {
    expect(packGateScripts(releaseSpec("local-starter"), { scripts: { ci: "x", build: "x", "check:bundle": "x" } }))
      .toEqual(["ci", "build", "check:bundle"]);
    expect(() => packGateScripts(releaseSpec("local-starter"), { scripts: { ci: "x", build: "x" } }))
      .toThrow("release gate script check:bundle is missing");
    expect(packGateScripts(releaseSpec("math-cards"), { scripts: { prepack: "bun run ci" } })).toEqual(["prepack"]);
    expect(() => packGateScripts(releaseSpec("math-cards"), { scripts: { ci: "bun test" } })).toThrow("requires a prepack gate");
  });

  test("every package in the current tree has a pack gate", () => {
    for (const spec of Object.values(RELEASE_SPECS)) {
      const json = JSON.parse(readFileSync(join(ROOT, spec.packagePath, "package.json"), "utf8")) as PackageJson;
      expect(packGateScripts(spec, json).length).toBeGreaterThan(0);
    }
    // Local Starter's own release check forbids lifecycle scripts, so it keeps its declared gate.
    const starter = JSON.parse(readFileSync(join(ROOT, "packages/local-starter/package.json"), "utf8")) as PackageJson;
    expect(starter.scripts?.prepack).toBeUndefined();
    const adds = JSON.parse(readFileSync(join(ROOT, "packages/data-protocol/package.json"), "utf8")) as PackageJson;
    expect(adds.scripts?.prepack).toBe("bun run ci");
  });
});

describe("staged publication", () => {
  test("stages by default and keeps direct publish only as a bootstrap fallback", () => {
    expect(DEFAULT_PUBLISH_MODE).toBe("stage");
    expect(parsePublishMode("stage")).toBe("stage");
    expect(parsePublishMode("publish")).toBe("publish");
    expect(() => parsePublishMode("approve")).toThrow("publish mode must be stage or publish");
    expect(publishAction("verify-existing", "stage", "trusted")).toBe("verify-existing");
    expect(publishAction("verify-existing", "stage", "bootstrap")).toBe("verify-existing");
    expect(publishAction("verify-existing", "publish", "bootstrap")).toBe("verify-existing");
    expect(publishAction("publish", "stage", "trusted")).toBe("stage");
    // npm stages a package that does not yet exist behind a public 0.0.0-stage placeholder.
    expect(publishAction("publish", "stage", "bootstrap")).toBe("stage");
    expect(publishAction("publish", "publish", "bootstrap")).toBe("publish");
    // A trusted (OIDC) run never publishes directly, whatever npm's trust would allow.
    expect(() => publishAction("publish", "publish", "trusted")).toThrow("direct publish is reserved for a bootstrap first publication");
    expect(() => publishAction("verify-existing", "publish", "trusted")).toThrow("trusted releases are staged");
  });

  test("plans a dispatch from its inputs and the registry, refusing what publish would refuse", () => {
    expect(parseAuthentication("trusted")).toBe("trusted");
    expect(parseAuthentication("bootstrap")).toBe("bootstrap");
    expect(() => parseAuthentication("token")).toThrow("authentication must be bootstrap or trusted");
    // An existing package: trusted stages a new version and verifies an existing one.
    expect(planDispatch("0.1.0-dev.2", "next", "trusted", "stage", 200, 404)).toBe("stage");
    expect(planDispatch("0.1.0-dev.2", "next", "trusted", "stage", 200, 200)).toBe("verify-existing");
    // A package new to npm: bootstrap stages by default, publishes only on request.
    expect(planDispatch("0.1.0-dev.1", "next", "bootstrap", "stage", 404, 404)).toBe("stage");
    expect(planDispatch("0.1.0-dev.1", "next", "bootstrap", "publish", 404, 404)).toBe("publish");
    // Each refusal the publish step would otherwise reach only after the GitHub Release mirror.
    expect(() => planDispatch("0.1.0-dev.2", "latest", "trusted", "stage", 200, 404)).toThrow("prerelease 0.1.0-dev.2 requires npm dist-tag next");
    expect(() => planDispatch("1.0.0", "latest", "trusted", "publish", 200, 404)).toThrow("direct publish is reserved");
    expect(() => planDispatch("1.0.0", "latest", "bootstrap", "stage", 200, 404)).toThrow("bootstrap authentication is restricted");
    expect(() => planDispatch("1.0.0", "latest", "trusted", "stage", 404, 404)).toThrow("first publication requires the reviewed bootstrap path");
    expect(() => planDispatch("1.0.0", "latest", "trusted", "stage", 503, 404)).toThrow("HTTP 503");
  });

  test("passes the npm 11.17.0 flags for each action", () => {
    expect(npmPublishArguments("stage", "/tmp/a.tgz", "next", "/tmp/logs")).toEqual([
      "stage", "publish", "/tmp/a.tgz", "--access", "public", "--tag", "next", "--provenance", "--ignore-scripts",
      "--logs-dir", "/tmp/logs", "--json",
    ]);
    expect(npmPublishArguments("publish", "/tmp/a.tgz", "latest", "/tmp/logs")).toEqual([
      "publish", "/tmp/a.tgz", "--access", "public", "--tag", "latest", "--provenance", "--ignore-scripts",
      "--logs-dir", "/tmp/logs",
    ]);
  });

  test("reads the stage id from npm's JSON or plain output only when npm staged the prepared bytes", () => {
    const receipt = preparedReceipt();
    const record = {
      id: "@agenttool/math-cards@0.1.0-dev.2",
      name: "@agenttool/math-cards",
      version: "0.1.0-dev.2",
      shasum: receipt.artifact.sha1,
      integrity: receipt.artifact.integrity,
      stageId: STAGE_ID.toUpperCase(),
    };
    expect(parseStagePublishOutput(JSON.stringify({ "@agenttool/math-cards": record }, null, 2), receipt)).toBe(STAGE_ID);
    expect(parseStagePublishOutput(
      `npm notice publishing\n+ @agenttool/math-cards@0.1.0-dev.2 (staged with id ${STAGE_ID})\n`,
      receipt,
    )).toBe(STAGE_ID);
    expect(() => parseStagePublishOutput(JSON.stringify({ "@agenttool/math-cards": { ...record, shasum: "0".repeat(40) } }), receipt))
      .toThrow("different from the prepared artifact");
    expect(() => parseStagePublishOutput(JSON.stringify({ "@agenttool/math-cards": { ...record, version: "0.1.0-dev.3" } }), receipt))
      .toThrow("different package identity");
    expect(() => parseStagePublishOutput(JSON.stringify({ "@agenttool/math-cards": { ...record, stageId: "../../x" } }), receipt))
      .toThrow("invalid stage id");
    expect(() => parseStagePublishOutput("+ @agenttool/math-cards@0.1.0-dev.2 (staged)\n", receipt)).toThrow("npm stage list");
    expect(() => parseStagePublishOutput(`+ @agenttool/math-cardsX0.1.0-dev.2 (staged with id ${STAGE_ID})\n`, receipt))
      .toThrow("did not report a stage id");
  });

  test("records the stage beside an unchanged receipt and never as a publish result", async () => {
    const receipt = preparedReceipt();
    const staged = stageReceipt(receipt, "next", STAGE_ID, "2026-10-12T12:05:00.000Z");
    expect(staged).toEqual({
      schema: STAGE_RECEIPT_SCHEMA,
      package: { key: "math-cards", name: "@agenttool/math-cards", version: "0.1.0-dev.2" },
      tag: "math-cards-v0.1.0-dev.2",
      tag_commit: "a".repeat(40),
      npm_tag: "next",
      artifact: receipt.artifact,
      stage_id: STAGE_ID,
      staged_at: "2026-10-12T12:05:00.000Z",
    });
    expect(Object.hasOwn(staged, "result")).toBe(false);
    expect(() => stageReceipt(receipt, "next", "not-a-uuid", "2026-10-12T12:05:00.000Z")).toThrow("valid stage id");

    const directory = await mkdtemp(join(tmpdir(), "npm-stage-receipt-test-"));
    const path = join(directory, "stage.json");
    try {
      await writeFile(path, JSON.stringify(staged));
      expect(await readStageReceipt(path)).toEqual(staged);
      await writeFile(path, JSON.stringify({ ...staged, result: { status: "published" } }));
      await expect(readStageReceipt(path)).rejects.toThrow("fields must be exactly");
      await writeFile(path, JSON.stringify({ ...staged, npm_tag: "latest" }));
      await expect(readStageReceipt(path)).rejects.toThrow("requires npm dist-tag next");
      await writeFile(path, JSON.stringify({ ...staged, tag: "math-cards-v0.1.0-dev.1" }));
      await expect(readStageReceipt(path)).rejects.toThrow("tag does not match");
      await writeFile(path, JSON.stringify({ ...staged, stage_id: STAGE_ID.toUpperCase() }));
      await expect(readStageReceipt(path)).rejects.toThrow("stage id is invalid");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }

    const summary = stageApprovalSummary(staged);
    expect(summary).toContain(`npx --yes npm@11.17.0 stage view ${STAGE_ID}`);
    expect(summary).toContain(`npx --yes npm@11.17.0 stage download ${STAGE_ID}`);
    expect(summary).toContain(`shasum -a 256 agenttool-math-cards-0.1.0-dev.2-${STAGE_ID}.tgz`);
    expect(summary).toContain(`# expect ${receipt.artifact.sha256}`);
    expect(summary).toContain(`npx --yes npm@11.17.0 stage approve ${STAGE_ID}`);
  });
});

describe("npm authentication fails before any public residue", () => {
  const OIDC_ENVIRONMENT = {
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.example/_apis/idtoken?api-version=2.0",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-token-fixture",
  };

  async function refusal(promise: Promise<unknown>): Promise<string> {
    const error = await promise.then(() => undefined, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    return (error as Error).message;
  }

  test("a trusted run hands npm an empty NODE_AUTH_TOKEN, so the npmrc placeholder becomes no credential", () => {
    // Deleting it left setup-node's `_authToken=${NODE_AUTH_TOKEN}` as literal text, sent as a bearer (run 39288082185).
    const trusted = npmPublishEnvironment("trusted", { ...OIDC_ENVIRONMENT, NODE_AUTH_TOKEN: "stale" });
    expect(Object.hasOwn(trusted, "NODE_AUTH_TOKEN")).toBe(true);
    expect(trusted.NODE_AUTH_TOKEN).toBe("");
    expect(npmPublishEnvironment("trusted", OIDC_ENVIRONMENT).NODE_AUTH_TOKEN).toBe("");
    expect(() => npmPublishEnvironment("trusted", {})).toThrow("requires the GitHub OIDC request environment");
    expect(npmPublishEnvironment("bootstrap", { NODE_AUTH_TOKEN: "reviewed" }).NODE_AUTH_TOKEN).toBe("reviewed");
    expect(() => npmPublishEnvironment("bootstrap", { ...OIDC_ENVIRONMENT, NODE_AUTH_TOKEN: "" })).toThrow("requires NODE_AUTH_TOKEN");
  });

  test("reads only npm's oidc lines from its debug logs", async () => {
    const log = [
      "0 verbose cli /usr/bin/node /usr/bin/npm",
      "12 verbose oidc Failed token exchange request with body message: package not found",
      "13 silly oidc Skipped because no id_token available\r",
      "14 http fetch POST 404 https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/@a%2fb 80ms",
      "verbose oidc an unprefixed line",
      "",
    ].join("\n");
    expect(oidcLogLines(log)).toEqual([
      "12 verbose oidc Failed token exchange request with body message: package not found",
      "13 silly oidc Skipped because no id_token available",
    ]);
    const directory = await mkdtemp(join(tmpdir(), "npm-oidc-log-test-"));
    try {
      await writeFile(join(directory, "2026-10-28T10_00_00_000Z-debug-1.log"), "40 verbose oidc Successfully retrieved and set token\n");
      await writeFile(join(directory, "2026-10-28T10_00_00_000Z-debug-0.log"), log);
      await writeFile(join(directory, "notes.txt"), "1 verbose oidc not npm's log\n");
      expect(await npmOidcLogLines(directory)).toEqual([...oidcLogLines(log), "40 verbose oidc Successfully retrieved and set token"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("names npm's own error code, and what ENEEDAUTH means in a trusted run", () => {
    const eneedauth = JSON.stringify({ error: { code: "ENEEDAUTH", summary: "This command requires you to be logged in to https://registry.npmjs.org/" } });
    expect(npmFailureMessage("stage", "trusted", { exitCode: 1, stdout: eneedauth })).toBe(
      "npm stage publish exited 1 (ENEEDAUTH): npm's OIDC exchange gave it no token (its oidc lines are above), so it stopped before signing provenance or staging",
    );
    expect(npmFailureMessage("stage", "trusted", { exitCode: 1, stdout: JSON.stringify({ error: { code: "E403" } }) }))
      .toBe("npm stage publish exited 1 (E403); npm's output is above. Check `npm stage list` before any retry");
    expect(npmFailureMessage("publish", "bootstrap", { exitCode: 1, stdout: "" }))
      .toBe("npm publish exited 1; npm's output is above. Check the registry before any retry");
  });

  test("a fake npm sees an empty token, and its stdout, oidc lines, and failure reach the log", async () => {
    const directory = await mkdtemp(join(tmpdir(), "npm-fake-test-"));
    const npm = join(directory, "npm");
    const record = join(directory, "record.txt");
    await writeFile(npm, [
      "#!/bin/bash",
      "# Stands in for npm 11.17.0: records its token and --logs-dir, writes a debug log there, prints, exits.",
      'logs=""',
      'while [ "$#" -gt 0 ]; do if [ "$1" = "--logs-dir" ]; then logs="$2"; shift; fi; shift; done',
      'printf "%s\\n%s\\n" "${NODE_AUTH_TOKEN-unset}" "$logs" > "$FAKE_NPM_RECORD"',
      'printf "%s\\n" "0 verbose cli /usr/bin/node /usr/bin/npm" "1 verbose oidc $FAKE_NPM_OIDC" > "$logs/2026-10-28T10_00_00_000Z-debug-0.log"',
      'printf "%s\\n" "$FAKE_NPM_STDOUT"',
      'exit "$FAKE_NPM_EXIT"',
      "",
    ].join("\n"), { mode: 0o755 });
    const environment = (exit: number, oidc: string, stdout: string) => ({
      PATH: process.env.PATH,
      ...OIDC_ENVIRONMENT,
      NODE_AUTH_TOKEN: "stale",
      FAKE_NPM_RECORD: record,
      FAKE_NPM_EXIT: String(exit),
      FAKE_NPM_OIDC: oidc,
      FAKE_NPM_STDOUT: stdout,
    });
    const logged: string[] = [];
    const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
    try {
      const eneedauth = JSON.stringify({ error: { code: "ENEEDAUTH", summary: "This command requires you to be logged in to https://registry.npmjs.org/" } });
      const failed = await refusal(runNpmPublication("stage", "trusted", "/tmp/a.tgz", "next", npm,
        environment(1, "Failed token exchange request with body message: package not found", eneedauth)));
      expect(failed).toStartWith("npm stage publish exited 1 (ENEEDAUTH)");
      const [token, logs] = (await readFile(record, "utf8")).split("\n");
      expect(token).toBe("");
      expect(existsSync(logs as string)).toBe(false);
      expect(logged).toContain("npm's oidc log lines:\n1 verbose oidc Failed token exchange request with body message: package not found");
      expect(logged).toContain(`${eneedauth}\n`);
      expect(logged.join("\n")).not.toContain("verbose cli");

      logged.length = 0;
      const staged = JSON.stringify({ "@agenttool/relational-geometry": { stageId: STAGE_ID } });
      const accepted = await runNpmPublication("stage", "trusted", "/tmp/a.tgz", "next", npm,
        environment(0, "Successfully retrieved and set token", staged));
      expect(accepted).toEqual({ exitCode: 0, stdout: `${staged}\n` });
      expect(logged).toContain("npm's oidc log lines:\n1 verbose oidc Successfully retrieved and set token");
      expect(logged).toContain(`${staged}\n`);
    } finally {
      spy.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("publish runs npm only through runNpmPublication", () => {
    const script = readFileSync(join(ROOT, "bin", "npm-release.ts"), "utf8");
    const body = script.split("\nasync function publish(")[1]?.split("\nasync function mirror(")[0] ?? "";
    expect(body).toContain("await runNpmPublication(action, authentication, artifactPath, npmTag)");
    expect(body).not.toContain("NODE_AUTH_TOKEN");
    expect(script).not.toContain("delete publishEnvironment.NODE_AUTH_TOKEN");
  });
});

describe("release tag messages", () => {
  const facts = {
    name: "@agenttool/math-cards",
    version: "0.1.0-dev.2",
    packagePath: "packages/math-cards",
    projectionCommit: "1".repeat(40),
    sourceCommit: "2".repeat(40),
    ciRun: `${RELEASE_REPOSITORY_URL}/actions/runs/38140965681`,
  };
  const raw = (message: string, overrides: { object?: string; tag?: string; tagger?: string } = {}) => [
    `object ${overrides.object ?? facts.projectionCommit}`,
    "type commit",
    `tag ${overrides.tag ?? "math-cards-v0.1.0-dev.2"}`,
    `tagger ${overrides.tagger ?? `${RELEASE_TAGGER_NAME} <${RELEASE_TAGGER_EMAIL}> 1760000000 +0100`}`,
    "",
    message,
  ].join("\n");
  const expected = { tag: "math-cards-v0.1.0-dev.2", tagCommit: facts.projectionCommit, name: facts.name, version: facts.version };

  test("names the package, the projection and source commits, and the public CI run", () => {
    const message = releaseTagMessage(facts);
    expect(message).toBe([
      "@agenttool/math-cards@0.1.0-dev.2",
      "",
      `Release of packages/math-cards from public projection ${"1".repeat(40)}.`,
      "",
      "Package: @agenttool/math-cards@0.1.0-dev.2",
      `Projection-Commit: ${"1".repeat(40)}`,
      `Projection-Source: ${"2".repeat(40)}`,
      "Public-CI-Run: https://github.com/cambridgetcg/agenttool-packages/actions/runs/38140965681",
      "",
    ].join("\n"));
    expect(parseReleaseTagObject(raw(message)).trailers).toEqual({
      Package: "@agenttool/math-cards@0.1.0-dev.2",
      "Projection-Commit": "1".repeat(40),
      "Projection-Source": "2".repeat(40),
      "Public-CI-Run": facts.ciRun,
    });
    expect(() => assertReleaseTagObject(raw(message), expected)).not.toThrow();
    expect(() => releaseTagMessage({ ...facts, sourceCommit: "abc" })).toThrow("full projection and source commits");
  });

  test("the publish workflow refuses unverified, foreign, moved, or signed tags", () => {
    const message = releaseTagMessage(facts);
    expect(() => assertReleaseTagObject(raw(releaseTagMessage({ ...facts, ciRun: UNVERIFIED_CI_RUN })), expected))
      .toThrow("verified public CI run");
    expect(() => assertReleaseTagObject(raw(releaseTagMessage({ ...facts, ciRun: "https://github.com/cambridgetcg/agenttool/actions/runs/1" })), expected))
      .toThrow("verified public CI run");
    expect(() => assertReleaseTagObject(raw(message, { tagger: "Someone <someone@example.invalid> 1760000000 +0100" }), expected))
      .toThrow("fixed projection tagger");
    expect(() => assertReleaseTagObject(raw(message, { object: "3".repeat(40) }), expected)).toThrow("point directly at its commit");
    expect(() => assertReleaseTagObject(raw(message, { tag: "math-cards-v0.1.0-dev.3" }), expected)).toThrow("object name");
    expect(() => assertReleaseTagObject(raw(message), { ...expected, version: "0.1.0-dev.3" })).toThrow("different package");
    expect(() => assertReleaseTagObject(raw(`${message}-----BEGIN PGP SIGNATURE-----\nx\n-----END PGP SIGNATURE-----\n`), expected))
      .toThrow("must not be signed");
    expect(() => assertReleaseTagObject(raw(`${message}Package: @agenttool/other@1.0.0\n`), expected)).toThrow("duplicate release tag trailer");
    expect(() => parseReleaseTagObject(`object ${"1".repeat(40)}\ngpgsig x\n\nmessage`)).toThrow("unexpected release tag header");
  });
});

describe("the publish workflow checks the CI run a tag cites", () => {
  const commit = "1".repeat(40);
  const runId = 38140965681;
  const facts = {
    name: "@agenttool/math-cards",
    version: "0.1.0-dev.2",
    packagePath: "packages/math-cards",
    projectionCommit: commit,
    sourceCommit: "2".repeat(40),
    ciRun: `${RELEASE_REPOSITORY_URL}/actions/runs/${runId}`,
  };
  const expected = { tag: "math-cards-v0.1.0-dev.2", tagCommit: commit, name: facts.name, version: facts.version };
  const raw = (ciRun = facts.ciRun) => [
    `object ${commit}`,
    "type commit",
    "tag math-cards-v0.1.0-dev.2",
    `tagger ${RELEASE_TAGGER_NAME} <${RELEASE_TAGGER_EMAIL}> 1760000000 +0100`,
    "",
    releaseTagMessage({ ...facts, ciRun }),
  ].join("\n");
  /** The shape GitHub's GET /repos/{repo}/actions/runs/{id} returns, trimmed to the fields read. */
  const githubRun = (overrides: Record<string, unknown> = {}) => ({
    id: runId,
    path: ".github/workflows/ci.yml",
    event: "push",
    head_branch: "main",
    head_sha: commit,
    status: "completed",
    conclusion: "success",
    html_url: `${RELEASE_REPOSITORY_URL}/actions/runs/${runId}`,
    repository: { full_name: RELEASE_REPOSITORY },
    created_at: "2026-10-11T20:00:00Z",
    ...overrides,
  });
  const github = (answers: Record<string, { status: number; body?: unknown }>) => {
    const urls: string[] = [];
    const fetchJson: FetchJson = async (url) => {
      urls.push(url);
      const answer = answers[url] ?? { status: 404 };
      return { status: answer.status, body: answer.body };
    };
    return { fetchJson, urls };
  };
  const runUrl = (id: number) => `https://api.github.com/repos/${RELEASE_REPOSITORY}/actions/runs/${id}`;

  test("accepts a tag whose cited run is a successful push run of ci.yml on main for the tagged commit", async () => {
    const { fetchJson, urls } = github({ [runUrl(runId)]: { status: 200, body: githubRun() } });
    const parsed = await assertReleaseTagEvidence(raw(), expected, fetchJson);
    expect(parsed.trailers["Public-CI-Run"]).toBe(facts.ciRun);
    expect(urls).toEqual([runUrl(runId)]);
  });

  test("refuses a well-formed tag whose cited run does not vouch for this commit", async () => {
    // A hand-made tag citing a run that does not exist.
    const handMade = github({});
    await expect(assertReleaseTagEvidence(raw(`${RELEASE_REPOSITORY_URL}/actions/runs/1`), expected, handMade.fetchJson))
      .rejects.toThrow("GitHub returned HTTP 404 for public CI run 1");
    expect(handMade.urls).toEqual([runUrl(1)]);
    for (const [overrides, message] of [
      [{ head_sha: "3".repeat(40) }, "is not a push run"],
      [{ path: ".github/workflows/publish-npm.yml" }, "is not a push run"],
      [{ event: "workflow_dispatch" }, "is not a push run"],
      [{ head_branch: "feature" }, "is not a push run"],
      [{ repository: { full_name: "someone/fork" } }, "is not a push run"],
      [{ status: "in_progress", conclusion: null }, "not completed/success"],
      [{ conclusion: "failure" }, "not completed/success"],
      [{ html_url: "https://github.com/someone/fork/actions/runs/38140965681" }, "unexpected URL"],
    ] as const) {
      const { fetchJson } = github({ [runUrl(runId)]: { status: 200, body: githubRun(overrides) } });
      const attempt = assertReleaseTagEvidence(raw(), expected, fetchJson);
      await expect(attempt).rejects.toThrow(message);
      await expect(attempt).rejects.toBeInstanceOf(ReleaseTagRefused);
    }
    const limited = github({ [runUrl(runId)]: { status: 403 } });
    await expect(assertReleaseTagEvidence(raw(), expected, limited.fetchJson)).rejects.toThrow("rate limit");
  });

  test("refuses an unverified or foreign tag before asking GitHub anything", async () => {
    const { fetchJson, urls } = github({});
    await expect(assertReleaseTagEvidence(raw(UNVERIFIED_CI_RUN), expected, fetchJson)).rejects.toThrow("verified public CI run");
    await expect(assertReleaseTagEvidence(raw("https://github.com/cambridgetcg/agenttool/actions/runs/1"), expected, fetchJson))
      .rejects.toThrow("verified public CI run");
    expect(urls).toEqual([]);
  });

  test("the workflow's tag check reads the cited run in Actions", () => {
    const script = readFileSync(join(ROOT, "bin", "npm-release.ts"), "utf8");
    expect(script).toContain("await assertReleaseTagEvidence(await captured(\"git\", [\"cat-file\", \"tag\", `refs/tags/${tag}`]), {");
  });
});

describe("the public publish workflow", () => {
  test("lists exactly the release specs, generated in declaration order", async () => {
    const workflow = await readFile(PUBLISH_WORKFLOW, "utf8");
    expect(workflow).toContain(`        options:\n${publishWorkflowPackageOptions()}      tag:\n`);
    expect(publishWorkflowPackageOptions().trimEnd().split("\n")).toHaveLength(Object.keys(RELEASE_SPECS).length);
  });

  test("runs only on an exact tag of the public repository, dry by default, staging by default", async () => {
    const source = await readFile(PUBLISH_WORKFLOW, "utf8");
    const workflow = Bun.YAML.parse(source) as {
      on: { workflow_dispatch: { inputs: Record<string, { type: string; default?: unknown; options?: string[]; required?: boolean }> } };
      permissions: Record<string, string>;
      jobs: Record<string, { if: string; needs?: string; environment?: string; permissions: Record<string, string>; steps: Array<{ uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> }> }>;
    };
    const inputs = workflow.on.workflow_dispatch.inputs;
    expect(Object.keys(inputs)).toEqual(["package", "tag", "authentication", "npm_tag", "dry_run", "publish_mode"]);
    expect(inputs.package?.options).toEqual(Object.keys(RELEASE_SPECS));
    expect(inputs.authentication).toMatchObject({ type: "choice", default: "trusted", options: ["trusted", "bootstrap"] });
    expect(inputs.npm_tag).toMatchObject({ type: "choice", default: "latest", options: ["latest", "next"] });
    expect(inputs.dry_run).toMatchObject({ type: "boolean", default: true });
    expect(inputs.publish_mode).toMatchObject({ type: "choice", default: "stage", options: ["stage", "publish"] });
    expect(workflow.permissions).toEqual({});

    const guard = "github.repository == 'cambridgetcg/agenttool-packages' && startsWith(github.ref, 'refs/tags/') && github.ref == format('refs/tags/{0}', inputs.tag)";
    const prepare = workflow.jobs.prepare!;
    const publish = workflow.jobs.publish!;
    expect(prepare.if).toBe(guard);
    expect(publish.if).toBe(`${guard} && !inputs.dry_run`);
    expect(prepare.permissions).toEqual({ contents: "read" });
    expect(prepare.environment).toBeUndefined();
    expect(JSON.stringify(prepare)).not.toMatch(/secrets\.|NODE_AUTH_TOKEN|id-token/u);
    expect(publish.needs).toBe("prepare");
    expect(publish.environment).toBe("npm-bootstrap");
    expect(publish.permissions).toEqual({ contents: "write", "id-token": "write" });
    for (const job of [prepare, publish]) {
      expect(job.steps[0]?.with).toMatchObject({ ref: "${{ inputs.tag }}", "fetch-depth": 0, "persist-credentials": false });
      for (const step of job.steps.filter((entry) => entry.uses)) expect(step.uses).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/u);
    }
    // Both jobs refuse bad inputs first: before package code runs, and before the GitHub Release mirror.
    const checkIndex = (job: typeof prepare) => job.steps.findIndex((step) => step.run?.includes("bun bin/npm-release.ts check-inputs"));
    const runIndex = (job: typeof prepare, text: string) => job.steps.findIndex((step) => step.run?.includes(text));
    expect(checkIndex(prepare)).toBeGreaterThan(0);
    expect(checkIndex(prepare)).toBeLessThan(runIndex(prepare, "bun bin/npm-release.ts prepare"));
    expect(checkIndex(publish)).toBeGreaterThan(0);
    expect(checkIndex(publish)).toBeLessThan(runIndex(publish, "bun bin/npm-release.ts mirror"));
    for (const job of [prepare, publish]) {
      const check = job.steps[checkIndex(job)]!;
      expect(check.env).toEqual({
        RELEASE_PACKAGE: "${{ inputs.package }}",
        RELEASE_AUTHENTICATION: "${{ inputs.authentication }}",
        RELEASE_NPM_TAG: "${{ inputs.npm_tag }}",
        RELEASE_PUBLISH_MODE: "${{ inputs.publish_mode }}",
      });
      expect(check.run).not.toContain("${{");
    }
    const publishStep = publish.steps.find((step) => step.run?.includes("bun bin/npm-release.ts publish"));
    expect(publishStep?.run).toContain('--publish-mode "$RELEASE_PUBLISH_MODE"');
    expect(publishStep?.env?.RELEASE_PUBLISH_MODE).toBe("${{ inputs.publish_mode }}");
    expect(source.match(/secrets\./gu)).toHaveLength(1);
    expect(source).not.toContain("--otp");
    expect(source).not.toMatch(/\n\s+(?:push|pull_request|schedule):/u);
  });

});
