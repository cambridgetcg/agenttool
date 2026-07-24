import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  validateNpmTagForVersion,
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
  test("allowlists twelve reviewed release identities", () => {
    expect(Object.keys(RELEASE_SPECS).sort()).toEqual([
      "adds",
      "browser",
      "collab",
      "correspondence-yutabase",
      "credential-broker",
      "data",
      "data-sync",
      "repo-archive",
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
    expect(releaseSpec("repo-archive")).toMatchObject({
      name: "@agenttool/repo-archive",
      packagePath: "packages/repo-archive",
      artifactKind: "pack",
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
    expect(expectedTag(releaseSpec("sdk"), "0.16.1")).toBe("sdk-v0.16.1");
    expect(packedFilename("@agenttool/collab", "0.1.0")).toBe("agenttool-collab-0.1.0.tgz");
    expect(packedFilename("@agenttool/correspondence-yutabase", "0.1.0-dev.0")).toBe(
      "agenttool-correspondence-yutabase-0.1.0-dev.0.tgz",
    );
    expect(expectedTag(releaseSpec("skills"), "0.1.0")).toBe("skills-v0.1.0");
    expect(packedFilename("@agenttool/skills", "0.1.0")).toBe("agenttool-skills-0.1.0.tgz");
    expect(expectedTag(releaseSpec("browser"), "0.2.0")).toBe("browser-v0.2.0");
    expect(packedFilename("@agenttool/browser", "0.2.0")).toBe("agenttool-browser-0.2.0.tgz");
    expect(expectedTag(releaseSpec("repo-archive"), "0.1.0-dev.0")).toBe(
      "repo-archive-v0.1.0-dev.0",
    );
    expect(packedFilename("@agenttool/repo-archive", "0.1.0-dev.0")).toBe(
      "agenttool-repo-archive-0.1.0-dev.0.tgz",
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
    expect(requiredArchiveEntries(releaseSpec("repo-archive"))).toEqual(expect.arrayContaining([
      "package/dist/index.js",
      "package/dist/cli.js",
      "package/schema/agent-repo-archive-v0.1.schema.json",
      "package/vectors/agent-repo-archive-v0.1-vectors.json",
    ]));
  });

  test("requires the Agent Skills runtime and bundled skills in its release archive", () => {
    expect(requiredArchiveEntries(releaseSpec("skills"))).toEqual(expect.arrayContaining([
      "package/dist/bin.js",
      "package/dist/index.js",
      "package/schema/agenttool-skills-inspection-v0.1.schema.json",
      "package/skills/use-agentcred-safely/SKILL.md",
      "package/skills/use-agentcred-safely/agents/openai.yaml",
      "package/skills/capability-conductor/SKILL.md",
      "package/skills/capability-conductor/agents/openai.yaml",
      "package/skills/learn-by-contact/SKILL.md",
      "package/skills/learn-by-contact/agents/openai.yaml",
      "package/skills/nen-contract-mantle/SKILL.md",
      "package/skills/nen-contract-mantle/agents/openai.yaml",
      "package/skills/nen-dependency-perimeter/SKILL.md",
      "package/skills/nen-dependency-perimeter/agents/openai.yaml",
      "package/skills/nen-concealed-trace/SKILL.md",
      "package/skills/nen-concealed-trace/agents/openai.yaml",
      "package/skills/nen-critical-path-forge/SKILL.md",
      "package/skills/nen-critical-path-forge/agents/openai.yaml",
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

  test("retries classified metadata transport and visibility-status failures", async () => {
    const fixture = registryFixture();
    let metadataCalls = 0;
    let tarballCalls = 0;
    const metadataTimeouts: number[] = [];
    const sleeps: number[] = [];

    const tarball = await pollRegistry(fixture.receipt, "latest", {
      maxAttempts: 3,
      fetchMetadata: async (url, init, timeoutMs) => {
        const attempt = Math.floor(metadataCalls / 2);
        metadataCalls += 1;
        metadataTimeouts.push(timeoutMs);
        expect(init.redirect).toBe("error");
        if (attempt === 0) throw new TypeError("temporary metadata connection failure");
        if (attempt === 1) {
          return new Response(null, {
            status: url.endsWith(`/${fixture.receipt.package.version}`) ? 404 : 503,
          });
        }
        const document = url.endsWith(`/${fixture.receipt.package.version}`)
          ? fixture.versionDocument
          : { "dist-tags": { latest: fixture.receipt.package.version } };
        return Response.json(document);
      },
      fetchTarball: async (_url, _init, timeoutMs) => {
        tarballCalls += 1;
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
        if (url.endsWith(`/${fixture.receipt.package.version}`)) {
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
