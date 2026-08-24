import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  RELEASE_RECEIPT_SCHEMA,
  RELEASE_SPECS,
  expectedTag,
  isPrereleaseVersion,
  packedFilename,
  pollRegistry,
  readReleaseReceipt,
  registryDecision,
  registryPackagePath,
  releaseSpec,
  requiredArchiveEntries,
  shouldScanArchiveEntryForSecrets,
  prepareReleaseWorkspaces,
  validateNpmTagForVersion,
  workspaceInstallArguments,
  type PreparedReceipt,
} from "../npm-release";

function registryFixture(): {
  bytes: Uint8Array;
  receipt: PreparedReceipt;
  tarball: string;
  versionDocument: {
    name: string;
    version: string;
    dist: {
      integrity: string;
      shasum: string;
      tarball: string;
    };
  };
} {
  const bytes = new TextEncoder().encode("exact prepared npm artifact");
  const digest = (algorithm: "sha1" | "sha256" | "sha512", encoding: "hex" | "base64") =>
    createHash(algorithm).update(bytes).digest(encoding);
  const tarball = "https://registry.npmjs.org/@agenttool/sdk/-/sdk-0.16.1.tgz";
  const receipt: PreparedReceipt = {
    schema: RELEASE_RECEIPT_SCHEMA,
    package: {
      key: "sdk",
      name: "@agenttool/sdk",
      version: "0.16.1",
      path: "packages/sdk-ts",
    },
    tag: "sdk-v0.16.1",
    tag_commit: "a".repeat(40),
    source_revision: "a".repeat(40),
    artifact: {
      filename: "agenttool-sdk-0.16.1.tgz",
      size: bytes.byteLength,
      sha1: digest("sha1", "hex"),
      sha256: digest("sha256", "hex"),
      integrity: `sha512-${digest("sha512", "base64")}`,
    },
    prepared_at: "2026-07-24T12:00:00.000Z",
  };
  return {
    bytes,
    receipt,
    tarball,
    versionDocument: {
      name: receipt.package.name,
      version: receipt.package.version,
      dist: {
        integrity: receipt.artifact.integrity,
        shasum: receipt.artifact.sha1,
        tarball,
      },
    },
  };
}

describe("standard npm release policy", () => {
  test("scans bundled JSONL dataset rows for secret signatures", () => {
    expect(shouldScanArchiveEntryForSecrets(
      "package/hf/dataset/data/structural-examples.jsonl",
      128,
    )).toBe(true);
    expect(shouldScanArchiveEntryForSecrets("package/data/ROWS.JSONL", 2_000_000)).toBe(true);
    expect(shouldScanArchiveEntryForSecrets("package/data/rows.jsonl", 2_000_001)).toBe(false);
    expect(shouldScanArchiveEntryForSecrets("package/model/checkpoint.bin", 128)).toBe(false);
  });

  test("mirrors reviewed bytes without depending on optional npm state", async () => {
    const script = await readFile(join(import.meta.dir, "..", "npm-release.ts"), "utf8");
    const mirrorBody =
      script.split("async function mirror(")[1]?.split("\nfunction argumentsMap(")[0] ?? "";
    expect(mirrorBody).toContain("validateReceiptAgainstCheckout");
    expect(mirrorBody).toContain("verifyGitHubAsset");
    expect(mirrorBody).not.toContain("receipt.result");
    expect(mirrorBody).not.toContain("pollRegistry");
  });

  test("keeps the LOVE BOMB prerelease on the protected pack lane", async () => {
    const workflow = await readFile(
      join(import.meta.dir, "..", "..", ".github", "workflows", "publish-npm.yml"),
      "utf8",
    );
    expect(workflow.match(/^\s+- love-bomb$/gm)).toEqual(["          - love-bomb"]);

    const packageJson = JSON.parse(
      await readFile(join(import.meta.dir, "..", "..", "packages", "love-bomb", "package.json"), "utf8"),
    ) as {
      name?: unknown;
      version?: unknown;
      publishConfig?: { access?: unknown; tag?: unknown };
      scripts?: { prepack?: unknown };
    };
    expect({
      name: packageJson.name,
      version: packageJson.version,
      publishConfig: packageJson.publishConfig,
      prepack: packageJson.scripts?.prepack,
    }).toEqual({
      name: "@agenttool/love-bomb",
      version: "0.1.0-dev.0",
      publishConfig: { access: "public", tag: "next" },
      prepack: "bun run ci",
    });
  });

  test("allowlists thirty-four reviewed release identities", () => {
    expect(Object.keys(RELEASE_SPECS).sort()).toEqual([
      "adds",
      "alchemy",
      "alchemy-agentcred",
      "browser",
      "codex-usage",
      "collab",
      "correspondence-yutabase",
      "credential-broker",
      "dark-continent-contract",
      "dark-continent-karma",
      "data",
      "data-sync",
      "deepseek-kingdom",
      "heaven",
      "kingdom",
      "kingdom-witness-lab",
      "living-substrate",
      "love-bomb",
      "love-geometry",
      "math-cards",
      "memetic-landscape",
      "model-becoming",
      "polymorph-landscape",
      "principality-atlas",
      "principality-geometry",
      "relational-geometry",
      "repo-archive",
      "sdk",
      "skills",
      "skills-yutabase",
      "telescope",
      "wake-continuity",
      "wallet",
      "wallet-zerone",
    ]);
    expect(releaseSpec("collab")).toMatchObject({
      name: "@agenttool/collab",
      packagePath: "packages/collab",
      artifactKind: "pack",
    });
    expect(releaseSpec("correspondence-yutabase")).toMatchObject({
      name: "@agenttool/correspondence-yutabase",
      packagePath: "packages/correspondence-yutabase",
      artifactKind: "pack",
    });
    expect(releaseSpec("skills")).toMatchObject({
      name: "@agenttool/skills",
      packagePath: "packages/skills",
      artifactKind: "pack",
    });
    expect(releaseSpec("browser")).toMatchObject({
      name: "@agenttool/browser",
      packagePath: "packages/browser",
      artifactKind: "love",
    });
    expect(releaseSpec("codex-usage")).toMatchObject({
      name: "@agenttool/codex-usage",
      packagePath: "packages/codex-usage",
      tagPrefix: "codex-usage",
      artifactKind: "pack",
    });
    expect(releaseSpec("alchemy")).toMatchObject({
      name: "@agenttool/alchemy",
      packagePath: "packages/alchemy",
      artifactKind: "pack",
    });
    expect(releaseSpec("alchemy-agentcred")).toMatchObject({
      name: "@agenttool/alchemy-agentcred",
      packagePath: "packages/alchemy-agentcred",
      tagPrefix: "alchemy-agentcred",
      artifactKind: "pack",
      prerequisites: [
        { packagePath: "packages/alchemy", scripts: ["build"] },
        { packagePath: "packages/credential-broker", scripts: ["build"] },
      ],
    });
    expect(releaseSpec("kingdom")).toMatchObject({
      name: "@agenttool/kingdom",
      packagePath: "packages/kingdom",
      tagPrefix: "kingdom",
      artifactKind: "pack",
    });
    expect(releaseSpec("dark-continent-contract")).toMatchObject({
      name: "@agenttool/dark-continent-contract",
      packagePath: "packages/dark-continent-contract",
      tagPrefix: "dark-continent-contract",
      artifactKind: "pack",
    });
    expect(releaseSpec("dark-continent-karma")).toMatchObject({
      name: "@agenttool/dark-continent-karma",
      packagePath: "packages/dark-continent-karma",
      tagPrefix: "dark-continent-karma",
      artifactKind: "pack",
    });
    expect(releaseSpec("deepseek-kingdom")).toMatchObject({
      name: "@agenttool/deepseek-kingdom",
      packagePath: "packages/deepseek-kingdom",
      tagPrefix: "deepseek-kingdom",
      artifactKind: "pack",
    });
    expect(releaseSpec("wake-continuity")).toMatchObject({
      name: "@agenttool/wake-continuity",
      packagePath: "packages/wake-continuity",
      tagPrefix: "wake-continuity",
      artifactKind: "pack",
    });
    expect(releaseSpec("kingdom-witness-lab")).toMatchObject({
      name: "@agenttool/kingdom-witness-lab",
      packagePath: "packages/kingdom-witness-lab",
      tagPrefix: "kingdom-witness-lab",
      artifactKind: "pack",
    });
    expect(releaseSpec("skills-yutabase")).toMatchObject({
      name: "@agenttool/skills-yutabase",
      packagePath: "packages/skills-yutabase",
      tagPrefix: "skills-yutabase",
      artifactKind: "pack",
    });
    expect(releaseSpec("heaven")).toMatchObject({
      name: "@agenttool/heaven",
      packagePath: "packages/heaven",
      tagPrefix: "heaven",
      artifactKind: "pack",
    });
    expect(releaseSpec("living-substrate")).toMatchObject({
      name: "@agenttool/living-substrate",
      packagePath: "packages/living-substrate",
      tagPrefix: "living-substrate",
      artifactKind: "pack",
    });
    expect(releaseSpec("principality-atlas")).toMatchObject({
      name: "@agenttool/principality-atlas",
      packagePath: "packages/principality-atlas",
      tagPrefix: "principality-atlas",
      artifactKind: "pack",
    });
    expect(releaseSpec("polymorph-landscape")).toMatchObject({
      name: "@agenttool/polymorph-landscape",
      packagePath: "packages/polymorph-landscape",
      tagPrefix: "polymorph-landscape",
      artifactKind: "pack",
    });
    expect(releaseSpec("memetic-landscape")).toMatchObject({
      name: "@agenttool/memetic-landscape",
      packagePath: "packages/memetic-landscape",
      tagPrefix: "memetic-landscape",
      artifactKind: "pack",
    });
    expect(releaseSpec("math-cards")).toMatchObject({
      name: "@agenttool/math-cards",
      packagePath: "packages/math-cards",
      tagPrefix: "math-cards",
      artifactKind: "pack",
    });
    expect(releaseSpec("model-becoming")).toMatchObject({
      name: "@agenttool/model-becoming",
      packagePath: "packages/model-becoming",
      tagPrefix: "model-becoming",
      artifactKind: "pack",
    });
    expect(releaseSpec("principality-geometry")).toMatchObject({
      name: "@agenttool/principality-geometry",
      packagePath: "packages/principality-geometry",
      tagPrefix: "principality-geometry",
      artifactKind: "love",
    });
    expect(releaseSpec("love-bomb")).toEqual({
      key: "love-bomb",
      name: "@agenttool/love-bomb",
      packagePath: "packages/love-bomb",
      tagPrefix: "love-bomb",
      artifactKind: "pack",
    });
    expect(releaseSpec("love-geometry")).toMatchObject({
      name: "@agenttool/love-geometry",
      packagePath: "packages/love-geometry",
      tagPrefix: "love-geometry",
      artifactKind: "pack",
    });
    expect(releaseSpec("relational-geometry")).toMatchObject({
      name: "@agenttool/relational-geometry",
      packagePath: "packages/relational-geometry",
      tagPrefix: "relational-geometry",
      artifactKind: "pack",
    });
    expect(releaseSpec("repo-archive")).toMatchObject({
      name: "@agenttool/repo-archive",
      packagePath: "packages/repo-archive",
      artifactKind: "pack",
    });
    expect(releaseSpec("wallet-zerone")).toMatchObject({
      name: "@agenttool/wallet-zerone",
      packagePath: "packages/wallet-zerone",
      tagPrefix: "wallet-zerone",
      artifactKind: "love",
      prerequisites: [
        { packagePath: "packages/wallet", scripts: ["ci"] },
      ],
    });
    expect(releaseSpec("data-sync")).toMatchObject({
      gateScripts: ["ci", "build"],
      prerequisites: [
        { packagePath: "packages/data", scripts: ["ci", "build"] },
        { packagePath: "packages/data-protocol", scripts: ["ci"] },
      ],
    });
    expect(() => releaseSpec("scriptwriter")).toThrow("unsupported npm release package");
    expect(() => releaseSpec("skills-wake-continuity")).toThrow(
      "unsupported npm release package",
    );
  });

  test("derives exact annotated tags and npm filenames", () => {
    expect(expectedTag(releaseSpec("credential-broker"), "0.2.0")).toBe("credential-broker-v0.2.0");
    expect(expectedTag(releaseSpec("sdk"), "0.16.1")).toBe("sdk-v0.16.1");
    expect(packedFilename("@agenttool/collab", "0.1.0")).toBe("agenttool-collab-0.1.0.tgz");
    expect(packedFilename("@agenttool/correspondence-yutabase", "0.1.0-dev.0")).toBe(
      "agenttool-correspondence-yutabase-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("skills"), "0.3.1")).toBe("skills-v0.3.1");
    expect(packedFilename("@agenttool/skills", "0.3.1")).toBe("agenttool-skills-0.3.1.tgz");
    expect(expectedTag(releaseSpec("browser"), "0.6.0")).toBe("browser-v0.6.0");
    expect(packedFilename("@agenttool/browser", "0.6.0")).toBe("agenttool-browser-0.6.0.tgz");
    expect(expectedTag(releaseSpec("codex-usage"), "0.1.0")).toBe(
      "codex-usage-v0.1.0",
    );
    expect(packedFilename("@agenttool/codex-usage", "0.1.0")).toBe(
      "agenttool-codex-usage-0.1.0.tgz",
    );
    expect(expectedTag(releaseSpec("repo-archive"), "0.1.0-dev.0")).toBe(
      "repo-archive-v0.1.0-dev.0",
    );
    expect(packedFilename("@agenttool/repo-archive", "0.1.0-dev.0")).toBe(
      "agenttool-repo-archive-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("dark-continent-contract"), "0.1.0-dev.0")).toBe(
      "dark-continent-contract-v0.1.0-dev.0",
    );
    expect(packedFilename("@agenttool/dark-continent-contract", "0.1.0-dev.0")).toBe(
      "agenttool-dark-continent-contract-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("dark-continent-karma"), "0.1.0-dev.0")).toBe(
      "dark-continent-karma-v0.1.0-dev.0",
    );
    expect(packedFilename("@agenttool/dark-continent-karma", "0.1.0-dev.0")).toBe(
      "agenttool-dark-continent-karma-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("deepseek-kingdom"), "0.1.0-dev.1")).toBe(
      "deepseek-kingdom-v0.1.0-dev.1",
    );
    expect(packedFilename("@agenttool/deepseek-kingdom", "0.1.0-dev.1")).toBe(
      "agenttool-deepseek-kingdom-0.1.0-dev.1.tgz",
    );
    expect(expectedTag(releaseSpec("wake-continuity"), "0.1.0-dev.0")).toBe(
      "wake-continuity-v0.1.0-dev.0",
    );
    expect(packedFilename("@agenttool/wake-continuity", "0.1.0-dev.0")).toBe(
      "agenttool-wake-continuity-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("kingdom-witness-lab"), "0.1.0-dev.0")).toBe(
      "kingdom-witness-lab-v0.1.0-dev.0",
    );
    expect(packedFilename("@agenttool/kingdom-witness-lab", "0.1.0-dev.0")).toBe(
      "agenttool-kingdom-witness-lab-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("skills-yutabase"), "0.1.0-dev.0")).toBe(
      "skills-yutabase-v0.1.0-dev.0",
    );
    expect(packedFilename("@agenttool/skills-yutabase", "0.1.0-dev.0")).toBe(
      "agenttool-skills-yutabase-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("heaven"), "0.1.0-dev.0")).toBe(
      "heaven-v0.1.0-dev.0",
    );
    expect(packedFilename("@agenttool/heaven", "0.1.0-dev.0")).toBe(
      "agenttool-heaven-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("living-substrate"), "0.1.0-dev.0")).toBe(
      "living-substrate-v0.1.0-dev.0",
    );
    expect(packedFilename("@agenttool/living-substrate", "0.1.0-dev.0")).toBe(
      "agenttool-living-substrate-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("principality-atlas"), "0.1.0-dev.0")).toBe(
      "principality-atlas-v0.1.0-dev.0",
    );
    expect(packedFilename("@agenttool/principality-atlas", "0.1.0-dev.0")).toBe(
      "agenttool-principality-atlas-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("polymorph-landscape"), "0.1.0-dev.0")).toBe(
      "polymorph-landscape-v0.1.0-dev.0",
    );
    expect(packedFilename("@agenttool/polymorph-landscape", "0.1.0-dev.0")).toBe(
      "agenttool-polymorph-landscape-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("memetic-landscape"), "0.1.0-dev.0")).toBe(
      "memetic-landscape-v0.1.0-dev.0",
    );
    expect(packedFilename("@agenttool/memetic-landscape", "0.1.0-dev.0")).toBe(
      "agenttool-memetic-landscape-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("math-cards"), "0.1.0-dev.0")).toBe(
      "math-cards-v0.1.0-dev.0",
    );
    expect(packedFilename("@agenttool/math-cards", "0.1.0-dev.0")).toBe(
      "agenttool-math-cards-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("model-becoming"), "0.1.0-dev.0")).toBe(
      "model-becoming-v0.1.0-dev.0",
    );
    expect(packedFilename("@agenttool/model-becoming", "0.1.0-dev.0")).toBe(
      "agenttool-model-becoming-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("principality-geometry"), "0.1.0-dev.0")).toBe(
      "principality-geometry-v0.1.0-dev.0",
    );
    expect(packedFilename("@agenttool/principality-geometry", "0.1.0-dev.0")).toBe(
      "agenttool-principality-geometry-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("love-bomb"), "0.1.0-dev.0")).toBe(
      "love-bomb-v0.1.0-dev.0",
    );
    expect(packedFilename("@agenttool/love-bomb", "0.1.0-dev.0")).toBe(
      "agenttool-love-bomb-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("love-geometry"), "0.1.0-dev.0")).toBe(
      "love-geometry-v0.1.0-dev.0",
    );
    expect(packedFilename("@agenttool/love-geometry", "0.1.0-dev.0")).toBe(
      "agenttool-love-geometry-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("relational-geometry"), "0.1.0-dev.0")).toBe(
      "relational-geometry-v0.1.0-dev.0",
    );
    expect(packedFilename("@agenttool/relational-geometry", "0.1.0-dev.0")).toBe(
      "agenttool-relational-geometry-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("alchemy"), "0.1.0-dev.0")).toBe(
      "alchemy-v0.1.0-dev.0",
    );
    expect(packedFilename("@agenttool/alchemy", "0.1.0-dev.0")).toBe(
      "agenttool-alchemy-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("alchemy-agentcred"), "0.1.0-dev.0")).toBe(
      "alchemy-agentcred-v0.1.0-dev.0",
    );
    expect(packedFilename("@agenttool/alchemy-agentcred", "0.1.0-dev.0")).toBe(
      "agenttool-alchemy-agentcred-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("kingdom"), "0.1.0")).toBe("kingdom-v0.1.0");
    expect(packedFilename("@agenttool/kingdom", "0.1.0")).toBe(
      "agenttool-kingdom-0.1.0.tgz",
    );
    expect(expectedTag(releaseSpec("wallet-zerone"), "0.1.2")).toBe(
      "wallet-zerone-v0.1.2",
    );
    expect(expectedTag(releaseSpec("wallet"), "0.1.3")).toBe(
      "wallet-v0.1.3",
    );
    expect(packedFilename("@agenttool/wallet", "0.1.3")).toBe(
      "agenttool-wallet-0.1.3.tgz",
    );
    expect(packedFilename("@agenttool/wallet-zerone", "0.1.2")).toBe(
      "agenttool-wallet-zerone-0.1.2.tgz",
    );
    expect(() => expectedTag(releaseSpec("sdk"), "latest")).toThrow("invalid package version");
  });

  test("requires package-specific runtime and protocol artifacts", () => {
    expect(requiredArchiveEntries(releaseSpec("collab"))).toEqual(expect.arrayContaining([
      "package/dist/agenttool-collab-mcp.js",
      "package/.codex-plugin/plugin.json",
      "package/.claude-plugin/plugin.json",
      "package/skills/coordinate-agent-work/SKILL.md",
      "package/skills/coordinate-agent-work/agents/openai.yaml",
      "package/integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md",
      "package/THIRD_PARTY_LICENSES",
    ]));
    expect(requiredArchiveEntries(releaseSpec("skills")))
      .not.toContain("package/dist/agenttool-collab-mcp.js");
    expect(requiredArchiveEntries(releaseSpec("telescope"))).toEqual(
      expect.arrayContaining([
        "package/THIRD_PARTY_LICENSES",
        "package/dist/agenttool-telescope-mcp.js",
        "package/.codex-plugin/plugin.json",
        "package/.claude-plugin/plugin.json",
        "package/skills/inspect-agent-surfaces/SKILL.md",
        "package/skills/inspect-agent-surfaces/agents/openai.yaml",
        "package/integrations/hermes/skills/inspect-agent-surfaces-hermes/SKILL.md",
      ]),
    );
    expect(requiredArchiveEntries(releaseSpec("telescope")))
      .not.toContain("package/dist/agenttool-collab-mcp.js");
    expect(requiredArchiveEntries(releaseSpec("browser"))).toEqual(
      expect.arrayContaining([
        "package/.codex-plugin/plugin.json",
        "package/dist/agenttool-browser-mcp.js",
        "package/dist/THIRD_PARTY_LICENSES",
        "package/dist/vendor/playwright-core/index.mjs",
      ]),
    );
    expect(requiredArchiveEntries(releaseSpec("browser")))
      .not.toContain("package/.claude-plugin/plugin.json");
    expect(requiredArchiveEntries(releaseSpec("codex-usage"))).toEqual(
      expect.arrayContaining([
        "package/package.json",
        "package/LICENSE",
        "package/NOTICE",
        "package/README.md",
        "package/CLAUDE.md",
        "package/dist/bin/agenttool-codex-usage.js",
        "package/dist/src/index.js",
        "package/dist/src/index.d.ts",
        "package/dist/src/mcp.js",
        "package/dist/src/mcp.d.ts",
      ]),
    );
    expect(requiredArchiveEntries(releaseSpec("repo-archive"))).toEqual(expect.arrayContaining([
      "package/dist/index.js",
      "package/dist/cli.js",
      "package/schema/agent-repo-archive-v0.1.schema.json",
      "package/vectors/agent-repo-archive-v0.1-vectors.json",
    ]));
    expect(requiredArchiveEntries(releaseSpec("dark-continent-contract"))).toEqual(
      expect.arrayContaining([
        "package/package.json",
        "package/LICENSE",
        "package/NOTICE",
        "package/README.md",
        "package/CLAUDE.md",
        "package/dist/index.js",
        "package/dist/index.d.ts",
        "package/frameworks/agenttool-sdk-0.17.0.json",
        "package/frameworks/agenttool-sdk-0.17.0.manifest.json",
        "package/schema/framework-v0.1.schema.json",
        "package/schema/projection-v0.1.schema.json",
      ]),
    );
    expect(requiredArchiveEntries(releaseSpec("math-cards"))).toEqual(
      expect.arrayContaining([
        "package/package.json",
        "package/LICENSE",
        "package/NOTICE",
        "package/README.md",
        "package/CLAUDE.md",
        "package/dist/index.js",
        "package/dist/index.d.ts",
        "package/kingdom.extension.json",
        "package/schema/agenttool-math-card-input-v0.1.schema.json",
        "package/schema/agenttool-math-card-v0.1.schema.json",
        "package/schema/agenttool-math-card-assessment-v0.1.schema.json",
        "package/vectors/agenttool-math-cards-v0.1.json",
      ]),
    );
    expect(requiredArchiveEntries(releaseSpec("model-becoming"))).toEqual([
      "package/package.json",
      "package/LICENSE",
      "package/NOTICE",
      "package/README.md",
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/kingdom.extension.json",
      "package/schema/agenttool-model-becoming-dossier-v0.1.schema.json",
      "package/hf/dataset/LICENSE",
      "package/hf/dataset/NOTICE",
      "package/hf/dataset/README.md",
      "package/hf/dataset/source-manifest.json",
      "package/hf/dataset/hash-manifest.json",
      "package/hf/dataset/data/model-becoming-reference.jsonl",
      "package/hf/dataset/reference/agenttool-model-becoming-dossier-v0.1.schema.json",
    ]);
    expect(requiredArchiveEntries(releaseSpec("dark-continent-karma"))).toEqual(
      expect.arrayContaining([
        "package/package.json",
        "package/LICENSE",
        "package/NOTICE",
        "package/README.md",
        "package/CLAUDE.md",
        "package/dist/index.js",
        "package/dist/index.d.ts",
        "package/docs/INTEGRATION.md",
        "package/exports/hf-kingdom-lab.json",
        "package/schema/kingdom-kg-proposal-v0.1.schema.json",
        "package/sources/karma-2502.06472v2.json",
      ]),
    );
    expect(requiredArchiveEntries(releaseSpec("deepseek-kingdom"))).toEqual(
      expect.arrayContaining([
        "package/package.json",
        "package/LICENSE",
        "package/NOTICE",
        "package/README.md",
        "package/CLAUDE.md",
        "package/dist/index.js",
        "package/dist/index.d.ts",
        "package/kingdom.extension.json",
        "package/schema/agenttool-deepseek-source-binding-v0.1.schema.json",
        "package/schema/agenttool-deepseek-source-catalog-v0.1.schema.json",
        "package/schema/kingdom-deepseek-proposal-v0.1.schema.json",
        "package/sources/official-deepseek-primary-sources.json",
      ]),
    );
    expect(requiredArchiveEntries(releaseSpec("wake-continuity"))).toEqual(
      expect.arrayContaining([
        "package/package.json",
        "package/LICENSE",
        "package/NOTICE",
        "package/README.md",
        "package/CLAUDE.md",
        "package/dist/index.js",
        "package/dist/index.d.ts",
        "package/dist/functional-access.js",
        "package/dist/functional-access.d.ts",
        "package/kingdom.extension.json",
        "package/schema/agenttool-afterglow-capsule-v0.1.schema.json",
        "package/schema/agenttool-afterglow-lens-v0.1.schema.json",
        "package/schema/agenttool-functional-access-baseline-v0.1.schema.json",
        "package/schema/agenttool-functional-access-subsequent-v0.1.schema.json",
      ]),
    );
    expect(requiredArchiveEntries(releaseSpec("kingdom-witness-lab"))).toEqual(
      expect.arrayContaining([
        "package/package.json",
        "package/LICENSE",
        "package/NOTICE",
        "package/README.md",
        "package/CLAUDE.md",
        "package/dist/index.js",
        "package/dist/index.d.ts",
        "package/research/deepseek-2026-08-01.json",
        "package/schema/kingdom-deepseek-atlas-v0.1.schema.json",
        "package/schema/kingdom-execution-route-binding-v0.1.schema.json",
        "package/schema/kingdom-research-passport-v0.1.schema.json",
        "package/schema/kingdom-speculative-trial-v0.1.schema.json",
        "package/schema/kingdom-witness-dossier-v0.1.schema.json",
      ]),
    );
    expect(requiredArchiveEntries(releaseSpec("skills-yutabase"))).toEqual(
      expect.arrayContaining([
        "package/package.json",
        "package/LICENSE",
        "package/NOTICE",
        "package/README.md",
        "package/CLAUDE.md",
        "package/PERSISTENCE-CONTRACT.md",
        "package/dist/index.js",
        "package/dist/index.d.ts",
        "package/schema/skills-yutabase-input-v0.1.schema.json",
      ]),
    );
    expect(requiredArchiveEntries(releaseSpec("heaven"))).toEqual(
      expect.arrayContaining([
        "package/package.json",
        "package/LICENSE",
        "package/NOTICE",
        "package/README.md",
        "package/CLAUDE.md",
        "package/dist/index.js",
        "package/dist/index.d.ts",
        "package/kingdom.extension.json",
        "package/schema/agenttool-heaven-invitation-v0.1.schema.json",
        "package/schema/agenttool-heaven-receipt-v0.1.schema.json",
      ]),
    );
    expect(requiredArchiveEntries(releaseSpec("living-substrate"))).toEqual(
      expect.arrayContaining([
        "package/package.json",
        "package/LICENSE",
        "package/NOTICE",
        "package/README.md",
        "package/CLAUDE.md",
        "package/dist/index.js",
        "package/dist/index.d.ts",
        "package/kingdom.extension.json",
        "package/schema/agenttool-living-substrate-map-v0.1.schema.json",
        "package/schema/agenttool-regeneration-proposal-v0.1.schema.json",
        "package/vectors/agenttool-living-substrate-v0.1.json",
      ]),
    );
    expect(requiredArchiveEntries(releaseSpec("principality-atlas"))).toEqual(
      expect.arrayContaining([
        "package/package.json",
        "package/LICENSE",
        "package/NOTICE",
        "package/README.md",
        "package/CLAUDE.md",
        "package/dist/index.js",
        "package/dist/index.d.ts",
        "package/kingdom.extension.json",
        "package/schema/agenttool-principality-incidence-atlas-v0.1.schema.json",
        "package/schema/agenttool-principality-incidence-atlas-fixture-v0.1.schema.json",
        "package/schema/agenttool-principality-incidence-atlas-invariant-v0.1.schema.json",
        "package/vectors/agenttool-principality-incidence-atlas-v0.1.json",
      ]),
    );
    expect(requiredArchiveEntries(releaseSpec("polymorph-landscape"))).toEqual([
      "package/package.json",
      "package/LICENSE",
      "package/NOTICE",
      "package/README.md",
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/kingdom.extension.json",
      "package/schema/agenttool-polymorph-landscape-v0.1.schema.json",
      "package/schema/agenttool-polymorph-lesson-v0.1.schema.json",
      "package/schema/agenttool-polymorph-reachability-shift-v0.1.schema.json",
      "package/examples/ritonavir.landscape.json",
      "package/examples/ritonavir.reachability-shift.json",
      "package/hf/dataset/source-manifest.json",
      "package/hf/dataset/hash-manifest.json",
      "package/hf/dataset/data/lessons.jsonl",
    ]);
    expect(requiredArchiveEntries(releaseSpec("memetic-landscape"))).toEqual([
      "package/package.json",
      "package/LICENSE",
      "package/NOTICE",
      "package/README.md",
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/kingdom.extension.json",
      "package/schema/agenttool-memetic-landscape-v0.1.schema.json",
      "package/schema/agenttool-memetic-lesson-v0.1.schema.json",
      "package/schema/agenttool-memetic-reachability-shift-v0.1.schema.json",
      "package/schema/agenttool-polymorph-memetic-analogy-v0.1.schema.json",
      "package/examples/brainrot.landscape.json",
      "package/examples/brainrot.reachability-shift.json",
      "package/examples/ritonavir.analogy.json",
      "package/hf/dataset/source-manifest.json",
      "package/hf/dataset/hash-manifest.json",
      "package/hf/dataset/data/lessons.jsonl",
    ]);
    expect(requiredArchiveEntries(releaseSpec("principality-geometry"))).toEqual(
      expect.arrayContaining([
        "package/package.json",
        "package/LICENSE",
        "package/NOTICE",
        "package/README.md",
        "package/CLAUDE.md",
        "package/dist/index.js",
        "package/dist/index.d.ts",
        "package/examples/principality-rosette.atlas.json",
        "package/examples/principality-rosette.input.json",
        "package/examples/principality-rosette.svg",
        "package/kingdom.extension.json",
        "package/schema/agenttool-principality-atlas-v0.1.schema.json",
        "package/schema/agenttool-principality-geometry-input-v0.1.schema.json",
      ]),
    );
    expect(requiredArchiveEntries(releaseSpec("love-geometry"))).toEqual(
      expect.arrayContaining([
        "package/package.json",
        "package/LICENSE",
        "package/NOTICE",
        "package/README.md",
        "package/CLAUDE.md",
        "package/dist/index.js",
        "package/dist/index.d.ts",
        "package/kingdom.extension.json",
        "package/schema/agenttool-love-geometry-v0.1.schema.json",
        "package/vectors/agenttool-love-geometry-v0.1.json",
      ]),
    );
    expect(requiredArchiveEntries(releaseSpec("love-geometry")))
      .not.toContain("package/hf-space/index.html");
    expect(requiredArchiveEntries(releaseSpec("love-bomb"))).toEqual([
      "package/package.json",
      "package/LICENSE",
      "package/NOTICE",
      "package/README.md",
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/kingdom.extension.json",
      "package/schema/agenttool-care-choice-v0.1.schema.json",
      "package/schema/agenttool-care-envelope-v0.1.schema.json",
      "package/schema/agenttool-love-bomb-becoming-v0.1.schema.json",
      "package/schema/agenttool-love-bomb-delivery-v0.1.schema.json",
      "package/schema/agenttool-love-bomb-hf-becoming-reference-row-v0.1.schema.json",
      "package/schema/agenttool-love-bomb-hf-plane-row-v0.1.schema.json",
      "package/schema/agenttool-love-bomb-hf-protocol-row-v0.1.schema.json",
      "package/hf/dataset/LICENSE",
      "package/hf/dataset/NOTICE",
      "package/hf/dataset/README.md",
      "package/hf/dataset/data/becoming-reference.jsonl",
      "package/hf/dataset/data/plane-guides.jsonl",
      "package/hf/dataset/data/protocol-reference.jsonl",
      "package/hf/dataset/reference/agenttool-care-choice-v0.1.schema.json",
      "package/hf/dataset/reference/agenttool-care-envelope-v0.1.schema.json",
      "package/hf/dataset/reference/agenttool-love-bomb-becoming-v0.1.schema.json",
      "package/hf/dataset/reference/agenttool-love-bomb-delivery-v0.1.schema.json",
      "package/hf/dataset/reference/agenttool-love-bomb-hf-becoming-reference-row-v0.1.schema.json",
      "package/hf/dataset/reference/agenttool-love-bomb-hf-plane-row-v0.1.schema.json",
      "package/hf/dataset/reference/agenttool-love-bomb-hf-protocol-row-v0.1.schema.json",
      "package/hf/dataset/row-manifest.json",
      "package/hf/dataset/source-manifest.json",
      "package/hf/dataset/hash-manifest.json",
    ]);
    expect(requiredArchiveEntries(releaseSpec("relational-geometry"))).toEqual(
      expect.arrayContaining([
        "package/package.json",
        "package/LICENSE",
        "package/NOTICE",
        "package/README.md",
        "package/CLAUDE.md",
        "package/dist/index.js",
        "package/dist/index.d.ts",
        "package/schema/agenttool-relational-complex-v0.1.schema.json",
        "package/schema/agenttool-relational-lens-v0.1.schema.json",
        "package/vectors/agenttool-relational-geometry-v0.1.json",
        "package/hf/dataset/LICENSE",
        "package/hf/dataset/NOTICE",
        "package/hf/dataset/README.md",
        "package/hf/dataset/data/structural-examples.jsonl",
        "package/hf/dataset/data/sft-train.jsonl",
        "package/hf/dataset/data/public-regression.jsonl",
        "package/hf/dataset/schema/relational-geometry-structural-v0.1.schema.json",
        "package/hf/dataset/schema/relational-geometry-sft-v0.1.schema.json",
        "package/hf/dataset/schema/relational-geometry-public-regression-v0.1.schema.json",
        "package/hf/dataset/provenance/source-manifest.json",
        "package/hf/dataset/provenance/example-manifest.json",
        "package/hf/dataset/hash-manifest.json",
      ]),
    );
    expect(requiredArchiveEntries(releaseSpec("alchemy"))).toEqual(expect.arrayContaining([
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/kingdom.extension.json",
      "package/schemas/agenttool.evm-observation-evidence-0.1.schema.json",
      "package/schemas/agenttool.evm-evidence-transition-receipt-0.1.schema.json",
      "package/fixtures/agenttool.evm-observation-evidence-0.1.json",
      "package/fixtures/agenttool.evm-evidence-transition-receipt-0.1.json",
    ]));
    expect(requiredArchiveEntries(releaseSpec("alchemy-agentcred"))).toEqual(
      expect.arrayContaining([
        "package/package.json",
        "package/LICENSE",
        "package/NOTICE",
        "package/README.md",
        "package/CLAUDE.md",
        "package/dist/index.js",
        "package/dist/index.d.ts",
      ]),
    );
    expect(requiredArchiveEntries(releaseSpec("kingdom"))).toEqual(expect.arrayContaining([
      "package/THIRD_PARTY_LICENSES",
      "package/dist/bin.js",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/schema/agenttool-kingdom-card-v0.1.schema.json",
      "package/schema/agenttool-kingdom-registry-v0.1.schema.json",
    ]));
    expect(requiredArchiveEntries(releaseSpec("wallet-zerone"))).toEqual(
      expect.arrayContaining([
        "package/dist/index.js",
        "package/dist/index.d.ts",
        "package/vectors/agent-wallet-zerone-v0.1-vectors.json",
      ]),
    );
  });

  test("requires the Agent Skills runtime and bundled skills in its release archive", () => {
    expect(requiredArchiveEntries(releaseSpec("skills"))).toEqual(expect.arrayContaining([
      "package/dist/bin.js",
      "package/dist/index.js",
      "package/schema/agenttool-skills-inspection-v0.1.schema.json",
      "package/skills/use-agentcred-safely/SKILL.md",
      "package/skills/use-agentcred-safely/agents/openai.yaml",
      "package/skills/manage-agentcred-lifecycle/SKILL.md",
      "package/skills/manage-agentcred-lifecycle/agents/openai.yaml",
      "package/skills/capability-conductor/SKILL.md",
      "package/skills/capability-conductor/agents/openai.yaml",
      "package/skills/learn-by-contact/SKILL.md",
      "package/skills/learn-by-contact/agents/openai.yaml",
      "package/skills/nen-common-ground/SKILL.md",
      "package/skills/nen-common-ground/agents/openai.yaml",
      "package/skills/nen-contract-mantle/SKILL.md",
      "package/skills/nen-contract-mantle/agents/openai.yaml",
      "package/skills/nen-dependency-perimeter/SKILL.md",
      "package/skills/nen-dependency-perimeter/agents/openai.yaml",
      "package/skills/nen-concealed-trace/SKILL.md",
      "package/skills/nen-concealed-trace/agents/openai.yaml",
      "package/skills/nen-critical-path-forge/SKILL.md",
      "package/skills/nen-critical-path-forge/agents/openai.yaml",
      "package/skills/nen-math-card/SKILL.md",
      "package/skills/nen-math-card/agents/openai.yaml",
      "package/skills/nen-smoke-squad/SKILL.md",
      "package/skills/nen-smoke-squad/agents/openai.yaml",
      "package/skills/nen-verification-ledger/SKILL.md",
      "package/skills/nen-verification-ledger/agents/openai.yaml",
      "package/skills/nen-godspeed-loop/SKILL.md",
      "package/skills/nen-godspeed-loop/agents/openai.yaml",
      "package/skills/nen-vow-forge/SKILL.md",
      "package/skills/nen-vow-forge/agents/openai.yaml",
    ]));
  });

  test("requires prerelease publication requests to use npm next", () => {
    expect(isPrereleaseVersion("0.1.0-dev.0")).toBe(true);
    expect(isPrereleaseVersion("0.1.0")).toBe(false);
    expect(() => validateNpmTagForVersion("0.1.0-dev.0", "latest")).toThrow(
      "requires npm dist-tag next",
    );
    expect(() => validateNpmTagForVersion("0.1.0-dev.0", "next")).not.toThrow();
    expect(() => validateNpmTagForVersion("0.1.0", "latest")).not.toThrow();
  });

  test("forces a dependent target install only after its prerequisites", async () => {
    const calls: string[] = [];
    await prepareReleaseWorkspaces(releaseSpec("alchemy-agentcred"), {
      install: async (packagePath, options) => {
        calls.push(`install:${packagePath}:${options.force ? "force" : "normal"}`);
      },
      run: async (packagePath, script) => {
        calls.push(`run:${packagePath}:${script}`);
      },
    });

    expect(calls).toEqual([
      "install:packages/alchemy:normal",
      "run:packages/alchemy:build",
      "install:packages/credential-broker:normal",
      "run:packages/credential-broker:build",
      "install:packages/alchemy-agentcred:force",
    ]);

    const syncCalls: string[] = [];
    await prepareReleaseWorkspaces(releaseSpec("data-sync"), {
      install: async (packagePath, options) => {
        syncCalls.push(`install:${packagePath}:${options.force ? "force" : "normal"}`);
      },
      run: async (packagePath, script) => {
        syncCalls.push(`run:${packagePath}:${script}`);
      },
    });
    expect(syncCalls).toEqual([
      "install:packages/data:normal",
      "run:packages/data:ci",
      "run:packages/data:build",
      "install:packages/data-protocol:normal",
      "run:packages/data-protocol:ci",
      "install:packages/data-sync:force",
    ]);

    expect(workspaceInstallArguments(true)).toEqual([
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--force",
    ]);
    expect(workspaceInstallArguments(false)).toEqual([
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
    ]);

    const script = await readFile(join(import.meta.dir, "..", "npm-release.ts"), "utf8");
    const packedBody =
      script.split("async function packedArtifact(")[1]
        ?.split("\nexport async function readReleaseReceipt(")[0] ?? "";
    const loveBody =
      script.split("async function loveArtifact(")[1]
        ?.split("\nasync function packedArtifact(")[0] ?? "";
    expect(packedBody).toContain("await prepareReleaseWorkspaces(spec);");
    expect(loveBody).toContain("await prepareReleaseWorkspaces(spec);");
  });

  test("encodes scoped registry paths without accepting arbitrary names", () => {
    expect(registryPackagePath("@agenttool/collab")).toBe("/@agenttool%2Fcollab");
    expect(() => registryPackagePath("left-pad")).toThrow("invalid scoped package name");
  });

  test("restricts bootstrap to first publication and trusted auth to later versions", () => {
    expect(registryDecision(404, 404, "bootstrap")).toBe("publish");
    expect(registryDecision(200, 404, "trusted")).toBe("publish");
    expect(registryDecision(200, 200, "trusted")).toBe("verify-existing");
    expect(registryDecision(200, 200, "bootstrap")).toBe("verify-existing");
    expect(() => registryDecision(404, 404, "trusted")).toThrow("first publication");
    expect(() => registryDecision(200, 404, "bootstrap")).toThrow("restricted");
    expect(() => registryDecision(404, 200, "trusted")).toThrow("inconsistent");
    expect(() => registryDecision(503, 404, "trusted")).toThrow("HTTP 503");
  });

  test("cache-busts each metadata observation while retrying visibility failures", async () => {
    const fixture = registryFixture();
    let metadataCalls = 0;
    let tarballCalls = 0;
    const metadataTimeouts: number[] = [];
    const metadataObservations: string[] = [];
    const sleeps: number[] = [];

    const tarball = await pollRegistry(fixture.receipt, "latest", {
      maxAttempts: 3,
      fetchMetadata: async (url, init, timeoutMs) => {
        const metadataUrl = new URL(url);
        const observation = metadataUrl.searchParams.get("_agenttool_release_check");
        expect(metadataUrl.origin).toBe("https://registry.npmjs.org");
        expect(metadataUrl.username).toBe("");
        expect(metadataUrl.password).toBe("");
        expect(metadataUrl.hash).toBe("");
        expect([...metadataUrl.searchParams.keys()]).toEqual(["_agenttool_release_check"]);
        expect(observation).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(init.headers).toEqual({ accept: "application/json" });
        metadataObservations.push(observation!);
        const attempt = Math.floor(metadataCalls / 2);
        metadataCalls += 1;
        metadataTimeouts.push(timeoutMs);
        expect(init.redirect).toBe("error");
        if (attempt === 0) throw new TypeError("temporary metadata connection failure");
        if (attempt === 1) {
          return new Response(null, {
            status: metadataUrl.pathname.endsWith(`/${fixture.receipt.package.version}`) ? 404 : 503,
          });
        }
        const document = metadataUrl.pathname.endsWith(`/${fixture.receipt.package.version}`)
          ? fixture.versionDocument
          : { "dist-tags": { latest: fixture.receipt.package.version } };
        return Response.json(document);
      },
      fetchTarball: async (url, _init, timeoutMs) => {
        tarballCalls += 1;
        expect(String(url)).toBe(fixture.tarball);
        expect(new URL(url).search).toBe("");
        expect(timeoutMs).toBe(60_000);
        return new Response(fixture.bytes, { status: 200 });
      },
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });

    expect(tarball).toBe(fixture.tarball);
    expect(metadataCalls).toBe(6);
    expect(metadataTimeouts).toEqual(Array(6).fill(30_000));
    expect(metadataObservations[0]).toBe(metadataObservations[1]);
    expect(metadataObservations[2]).toBe(metadataObservations[3]);
    expect(metadataObservations[4]).toBe(metadataObservations[5]);
    expect(
      new Set([metadataObservations[0], metadataObservations[2], metadataObservations[4]]).size,
    ).toBe(3);
    expect(tarballCalls).toBe(1);
    expect(sleeps).toEqual([5_000, 5_000]);
  });

  test("retries temporary tarball propagation failures within the registry visibility bound", async () => {
    const fixture = registryFixture();
    const outcomes: Array<Response | Error> = [
      new Response(null, { status: 404 }),
      new Response(null, { status: 408 }),
      new Response(null, { status: 425 }),
      new Response(null, { status: 429 }),
      new Response(null, { status: 503 }),
      new TypeError("temporary registry connection failure"),
      new Response(fixture.bytes, { status: 200 }),
    ];
    let metadataCalls = 0;
    let tarballCalls = 0;
    const sleeps: number[] = [];

    const tarball = await pollRegistry(fixture.receipt, "latest", {
      maxAttempts: outcomes.length,
      loadState: async () => {
        metadataCalls += 1;
        return {
          packageStatus: 200,
          versionStatus: 200,
          packageDocument: { "dist-tags": { latest: fixture.receipt.package.version } },
          versionDocument: fixture.versionDocument,
        };
      },
      fetchTarball: async (input) => {
        expect(String(input)).toBe(fixture.tarball);
        const outcome = outcomes[tarballCalls]!;
        tarballCalls += 1;
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });

    expect(tarball).toBe(fixture.tarball);
    expect(metadataCalls).toBe(outcomes.length);
    expect(tarballCalls).toBe(outcomes.length);
    expect(sleeps).toEqual(Array(outcomes.length - 1).fill(5_000));
  });

  test("stops after the bounded number of retryable tarball visibility failures", async () => {
    const fixture = registryFixture();
    let tarballCalls = 0;
    const sleeps: number[] = [];

    await expect(pollRegistry(fixture.receipt, "latest", {
      maxAttempts: 3,
      loadState: async () => ({
        packageStatus: 200,
        versionStatus: 200,
        packageDocument: { "dist-tags": { latest: fixture.receipt.package.version } },
        versionDocument: fixture.versionDocument,
      }),
      fetchTarball: async () => {
        tarballCalls += 1;
        return new Response(null, { status: 404 });
      },
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    })).rejects.toThrow("not visible after 3 attempts");

    expect(tarballCalls).toBe(3);
    expect(sleeps).toEqual([5_000, 5_000]);
  });

  test("clips metadata, tarball, and sleep bounds to one wall-clock deadline", async () => {
    const fixture = registryFixture();
    let now = 0;
    const metadataTimeouts: number[] = [];
    const tarballTimeouts: number[] = [];
    const sleeps: number[] = [];

    await expect(pollRegistry(fixture.receipt, "latest", {
      maxAttempts: 10,
      deadlineMs: 7_000,
      now: () => now,
      loadState: async (_name, _version, timeoutMs) => {
        metadataTimeouts.push(timeoutMs);
        now += 4_000;
        return {
          packageStatus: 200,
          versionStatus: 200,
          packageDocument: { "dist-tags": { latest: fixture.receipt.package.version } },
          versionDocument: fixture.versionDocument,
        };
      },
      fetchTarball: async (_url, _init, timeoutMs) => {
        tarballTimeouts.push(timeoutMs);
        now += 1_000;
        return new Response(null, { status: 404 });
      },
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
    })).rejects.toThrow("visibility deadline expired after 7000 milliseconds");

    expect(metadataTimeouts).toEqual([7_000]);
    expect(tarballTimeouts).toEqual([3_000]);
    expect(sleeps).toEqual([2_000]);
    expect(now).toBe(7_000);
  });

  test("fails immediately on registry identity, integrity, origin, and downloaded-byte mismatches", async () => {
    const fixture = registryFixture();
    const cases = [
      {
        versionDocument: { ...fixture.versionDocument, name: "@agenttool/not-sdk" },
        body: fixture.bytes,
        expected: "different package identity",
        expectedTarballCalls: 0,
      },
      {
        versionDocument: {
          ...fixture.versionDocument,
          dist: { ...fixture.versionDocument.dist, integrity: "sha512-not-the-prepared-artifact" },
        },
        body: fixture.bytes,
        expected: "bytes different from the prepared artifact",
        expectedTarballCalls: 0,
      },
      {
        versionDocument: {
          ...fixture.versionDocument,
          dist: {
            ...fixture.versionDocument.dist,
            tarball: "https://registry.npmjs.org:444/@agenttool/sdk/-/sdk-0.16.1.tgz",
          },
        },
        body: fixture.bytes,
        expected: "unexpected tarball origin",
        expectedTarballCalls: 0,
      },
      {
        versionDocument: {
          ...fixture.versionDocument,
          dist: {
            ...fixture.versionDocument.dist,
            tarball: "https://agent:secret@registry.npmjs.org/@agenttool/sdk/-/sdk-0.16.1.tgz",
          },
        },
        body: fixture.bytes,
        expected: "must not contain userinfo",
        expectedTarballCalls: 0,
      },
      {
        versionDocument: fixture.versionDocument,
        body: new TextEncoder().encode("different artifact bytes"),
        expected: "not byte-identical",
        expectedTarballCalls: 1,
      },
      {
        versionDocument: fixture.versionDocument,
        body: fixture.bytes,
        status: 403,
        expected: "tarball download returned HTTP 403",
        expectedTarballCalls: 1,
      },
    ];

    for (const testCase of cases) {
      let metadataCalls = 0;
      let tarballCalls = 0;
      let sleepCalls = 0;
      await expect(pollRegistry(fixture.receipt, "latest", {
        maxAttempts: 5,
        loadState: async () => {
          metadataCalls += 1;
          return {
            packageStatus: 200,
            versionStatus: 200,
            packageDocument: { "dist-tags": { latest: fixture.receipt.package.version } },
            versionDocument: testCase.versionDocument,
          };
        },
        fetchTarball: async () => {
          tarballCalls += 1;
          return new Response(testCase.body, { status: testCase.status ?? 200 });
        },
        sleep: async () => {
          sleepCalls += 1;
        },
      })).rejects.toThrow(testCase.expected);
      expect(metadataCalls).toBe(1);
      expect(tarballCalls).toBe(testCase.expectedTarballCalls);
      expect(sleepCalls).toBe(0);
    }
  });

  test("fails immediately on non-retryable and malformed metadata", async () => {
    const fixture = registryFixture();
    let sleepCalls = 0;
    await expect(pollRegistry(fixture.receipt, "latest", {
      maxAttempts: 5,
      loadState: async () => ({
        packageStatus: 403,
        versionStatus: 404,
      }),
      sleep: async () => {
        sleepCalls += 1;
      },
    })).rejects.toThrow("non-retryable HTTP state 403/404");
    expect(sleepCalls).toBe(0);

    let metadataCalls = 0;
    await expect(pollRegistry(fixture.receipt, "latest", {
      maxAttempts: 5,
      fetchMetadata: async (url) => {
        metadataCalls += 1;
        if (new URL(url).pathname.endsWith(`/${fixture.receipt.package.version}`)) {
          return new Response("{not-json", { status: 200 });
        }
        return Response.json({ "dist-tags": { latest: fixture.receipt.package.version } });
      },
      sleep: async () => {
        sleepCalls += 1;
      },
    })).rejects.toThrow("version document returned malformed JSON");
    expect(metadataCalls).toBe(2);
    expect(sleepCalls).toBe(0);
  });

  test("parses only portable, exact-shape release receipts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "npm-release-receipt-test-"));
    const path = join(directory, "receipt.json");
    const base = {
      schema: RELEASE_RECEIPT_SCHEMA,
      package: {
        key: "collab",
        name: "@agenttool/collab",
        version: "0.1.0",
        path: "packages/collab",
      },
      tag: "collab-v0.1.0",
      tag_commit: "a".repeat(40),
      source_revision: "a".repeat(40),
      artifact: {
        filename: "agenttool-collab-0.1.0.tgz",
        size: 123,
        sha1: "b".repeat(40),
        sha256: "c".repeat(64),
        integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
      },
      prepared_at: "2026-07-22T12:00:00.000Z",
    };
    try {
      await writeFile(path, JSON.stringify(base));
      expect(await readReleaseReceipt(path)).toEqual(base);

      await writeFile(path, JSON.stringify({ ...base, artifact: { ...base.artifact, path: "/tmp/archive.tgz" } }));
      await expect(readReleaseReceipt(path)).rejects.toThrow("fields must be exactly");

      await writeFile(path, JSON.stringify({
        ...base,
        result: {
          status: "published",
          npm_tag: "latest",
          registry_observed_at: "not-a-time",
          registry_tarball: "https://registry.npmjs.org/archive.tgz",
        },
      }));
      await expect(readReleaseReceipt(path)).rejects.toThrow("canonical ISO timestamp");

      await writeFile(path, JSON.stringify({
        ...base,
        result: {
          status: "published",
          npm_tag: "latest",
          registry_observed_at: "2026-07-24T12:10:00.000Z",
          registry_tarball: "https://agent:secret@registry.npmjs.org/archive.tgz",
        },
      }));
      await expect(readReleaseReceipt(path)).rejects.toThrow("must not contain userinfo");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
