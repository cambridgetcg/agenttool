import { describe, expect, test } from "bun:test";
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
  UNVERIFIED_CI_RUN,
  assertReleaseTagObject,
  historicalLoveManifestPath,
  isReleaseRemote,
  npmPublishArguments,
  packGateScripts,
  parsePublishMode,
  parseReleaseTagObject,
  parseStagePublishOutput,
  publishAction,
  publishWorkflowPackageOptions,
  readStageReceipt,
  releaseSpec,
  releaseTagMessage,
  stageApprovalSummary,
  stageReceipt,
  validatePackageManifest,
  type PackageJson,
  type PreparedReceipt,
} from "../npm-release";

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

  test("passes the npm 11.17.0 flags for each action", () => {
    expect(npmPublishArguments("stage", "/tmp/a.tgz", "next")).toEqual([
      "stage", "publish", "/tmp/a.tgz", "--access", "public", "--tag", "next", "--provenance", "--ignore-scripts", "--json",
    ]);
    expect(npmPublishArguments("publish", "/tmp/a.tgz", "latest")).toEqual([
      "publish", "/tmp/a.tgz", "--access", "public", "--tag", "latest", "--provenance", "--ignore-scripts",
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
    const publishStep = publish.steps.find((step) => step.run?.includes("bun bin/npm-release.ts publish"));
    expect(publishStep?.run).toContain('--publish-mode "$RELEASE_PUBLISH_MODE"');
    expect(publishStep?.env?.RELEASE_PUBLISH_MODE).toBe("${{ inputs.publish_mode }}");
    expect(source.match(/secrets\./gu)).toHaveLength(1);
    expect(source).not.toContain("--otp");
    expect(source).not.toMatch(/\n\s+(?:push|pull_request|schedule):/u);
  });
});
