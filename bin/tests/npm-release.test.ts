import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  RELEASE_RECEIPT_SCHEMA,
  RELEASE_SPECS,
  expectedTag,
  packedFilename,
  readReleaseReceipt,
  registryDecision,
  registryPackagePath,
  releaseSpec,
} from "../npm-release";

describe("standard npm release policy", () => {
  test("allowlists the eight established public packages", () => {
    expect(Object.keys(RELEASE_SPECS).sort()).toEqual([
      "adds",
      "collab",
      "credential-broker",
      "data",
      "data-sync",
      "sdk",
      "telescope",
      "wallet",
    ]);
    expect(releaseSpec("collab")).toMatchObject({
      name: "@agenttool/collab",
      packagePath: "packages/collab",
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
    expect(expectedTag(releaseSpec("sdk"), "0.16.0")).toBe("sdk-v0.16.0");
    expect(packedFilename("@agenttool/collab", "0.1.0")).toBe("agenttool-collab-0.1.0.tgz");
    expect(() => expectedTag(releaseSpec("sdk"), "latest")).toThrow("invalid package version");
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
