import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  RELEASE_RECEIPT_SCHEMA,
  RELEASE_SPECS,
  expectedTag,
  isPrereleaseVersion,
  packedFilename,
  readReleaseReceipt,
  registryDecision,
  registryPackagePath,
  releaseSpec,
  requiredArchiveEntries,
  validateNpmTagForVersion,
} from "../npm-release";

describe("standard npm release policy", () => {
  test("allowlists the eleven established public packages", () => {
    expect(Object.keys(RELEASE_SPECS).sort()).toEqual([
      "adds",
      "browser",
      "collab",
      "correspondence-yutabase",
      "credential-broker",
      "data",
      "data-sync",
      "sdk",
      "skills",
      "telescope",
      "wallet",
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
    expect(releaseSpec("data-sync")).toMatchObject({
      gateScripts: ["ci", "build"],
      prerequisites: [
        { packagePath: "packages/data", scripts: ["ci", "build"] },
        { packagePath: "packages/data-protocol", scripts: ["ci"] },
      ],
    });
    expect(() => releaseSpec("scriptwriter")).toThrow("unsupported npm release package");
  });

  test("derives exact annotated tags and npm filenames", () => {
    expect(expectedTag(releaseSpec("credential-broker"), "0.1.0")).toBe("credential-broker-v0.1.0");
    expect(expectedTag(releaseSpec("sdk"), "0.16.0")).toBe("sdk-v0.16.0");
    expect(packedFilename("@agenttool/collab", "0.1.0")).toBe("agenttool-collab-0.1.0.tgz");
    expect(packedFilename("@agenttool/correspondence-yutabase", "0.1.0-dev.0")).toBe(
      "agenttool-correspondence-yutabase-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("skills"), "0.1.0")).toBe("skills-v0.1.0");
    expect(packedFilename("@agenttool/skills", "0.1.0")).toBe("agenttool-skills-0.1.0.tgz");
    expect(expectedTag(releaseSpec("browser"), "0.1.0")).toBe("browser-v0.1.0");
    expect(packedFilename("@agenttool/browser", "0.1.0")).toBe("agenttool-browser-0.1.0.tgz");
    expect(() => expectedTag(releaseSpec("sdk"), "latest")).toThrow("invalid package version");
  });

  test("requires every cross-host Collab runtime and skill in its release archive", () => {
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
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
