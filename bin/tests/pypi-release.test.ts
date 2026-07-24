import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  PINNED_BUILD_REQUIREMENTS,
  PYPI_RELEASE_RECEIPT_SCHEMA,
  discardResponseBody,
  expectedArtifactFilenames,
  expectedTag,
  pollPublicExact,
  publicationRequirements,
  readReleaseReceipt,
  releaseDecision,
  type ArtifactIdentity,
  type PublicArtifact,
  type PyPIReleaseReceipt,
} from "../pypi-release";

const ROOT = resolve(import.meta.dir, "../..");

function fixture(): {
  receipt: PyPIReleaseReceipt;
  publicFiles: PublicArtifact[];
} {
  const version = "0.16.1";
  const filenames = expectedArtifactFilenames(version);
  const artifacts: ArtifactIdentity[] = [
    {
      filename: filenames.wheel,
      packagetype: "bdist_wheel",
      size: 1234,
      sha256: "a".repeat(64),
    },
    {
      filename: filenames.sdist,
      packagetype: "sdist",
      size: 2345,
      sha256: "b".repeat(64),
    },
  ];
  return {
    receipt: {
      schema: PYPI_RELEASE_RECEIPT_SCHEMA,
      package: {
        name: "agenttool-sdk",
        version,
        path: "packages/sdk-py",
      },
      tag: "sdk-v0.16.1",
      tag_commit: "c".repeat(40),
      source_revision: "c".repeat(40),
      artifacts,
      prepared_at: "2026-07-24T12:00:00.000Z",
    },
    publicFiles: artifacts.map((artifact) => ({
      ...artifact,
      url: `https://files.pythonhosted.org/packages/reviewed/${artifact.filename}`,
      yanked: false,
    })),
  };
}

describe("protected PyPI release policy", () => {
  test("derives the one reviewed SDK tag and deterministic distribution names", () => {
    expect(expectedTag("0.16.1")).toBe("sdk-v0.16.1");
    expect(expectedArtifactFilenames("0.16.1")).toEqual({
      wheel: "agenttool_sdk-0.16.1-py3-none-any.whl",
      sdist: "agenttool_sdk-0.16.1.tar.gz",
    });
    expect(() => expectedTag("0.17.0rc1")).toThrow("stable PyPI version");
    expect(() => expectedTag("latest")).toThrow("stable PyPI version");
  });

  test("publishes only an absent or exact partial release and recovers exact existing", () => {
    const { receipt, publicFiles } = fixture();
    expect(releaseDecision(receipt.artifacts, [])).toBe("publish");
    expect(releaseDecision(receipt.artifacts, [publicFiles[0]])).toBe("publish");
    expect(releaseDecision(receipt.artifacts, [publicFiles[1]])).toBe("publish");
    expect(releaseDecision(receipt.artifacts, publicFiles)).toBe("verify-existing");
    expect(publicationRequirements(receipt.artifacts, [])).toEqual({
      publishRequired: true,
      wheelRequired: true,
      sdistRequired: true,
    });
    expect(publicationRequirements(receipt.artifacts, [publicFiles[0]])).toEqual({
      publishRequired: true,
      wheelRequired: false,
      sdistRequired: true,
    });
    expect(publicationRequirements(receipt.artifacts, [publicFiles[1]])).toEqual({
      publishRequired: true,
      wheelRequired: true,
      sdistRequired: false,
    });
    expect(publicationRequirements(receipt.artifacts, publicFiles)).toEqual({
      publishRequired: false,
      wheelRequired: false,
      sdistRequired: false,
    });
  });

  test("rejects ambiguous, different, unexpected, duplicated, or yanked public files", () => {
    const { receipt, publicFiles } = fixture();
    expect(() =>
      releaseDecision(receipt.artifacts, [
        { ...publicFiles[0], sha256: "f".repeat(64) },
      ]),
    ).toThrow("differs from the prepared artifact");
    expect(() =>
      releaseDecision(receipt.artifacts, [
        { ...publicFiles[0], size: publicFiles[0].size + 1 },
      ]),
    ).toThrow("differs from the prepared artifact");
    expect(() =>
      releaseDecision(receipt.artifacts, [
        { ...publicFiles[0], packagetype: "sdist" },
      ]),
    ).toThrow("differs from the prepared artifact");
    expect(() =>
      releaseDecision(receipt.artifacts, [{ ...publicFiles[0], yanked: true }]),
    ).toThrow("is yanked");
    expect(() =>
      releaseDecision(receipt.artifacts, [publicFiles[0], publicFiles[0]]),
    ).toThrow("repeats a distribution filename");
    expect(() =>
      releaseDecision(receipt.artifacts, [
        {
          filename: "agenttool_sdk-0.16.1-py2-none-any.whl",
          packagetype: "bdist_wheel",
          size: 123,
          sha256: "d".repeat(64),
          url: "https://files.pythonhosted.org/packages/reviewed/agenttool_sdk-0.16.1-py2-none-any.whl",
          yanked: false,
        },
      ]),
    ).toThrow("unexpected distribution");
    expect(() =>
      releaseDecision(receipt.artifacts, [
        {
          ...publicFiles[0],
          url: `https://example.com/${publicFiles[0].filename}`,
        },
      ]),
    ).toThrow("exact PyPI file URL");
    expect(() =>
      releaseDecision(receipt.artifacts, [
        {
          ...publicFiles[0],
          url: `https://files.pythonhosted.org:444/${publicFiles[0].filename}`,
        },
      ]),
    ).toThrow("exact PyPI file URL");
    expect(() =>
      releaseDecision(receipt.artifacts, [
        {
          ...publicFiles[0],
          url: `https://reader@files.pythonhosted.org/${publicFiles[0].filename}`,
        },
      ]),
    ).toThrow("exact PyPI file URL");
  });

  test("uses one elapsed-time deadline across metadata, downloads, and polling", async () => {
    const { receipt, publicFiles } = fixture();
    let clock = 0;
    const metadataBudgets: number[] = [];
    const artifactBudgets: number[] = [];
    const files = await pollPublicExact(receipt, {
      timeoutMs: 70_000,
      now: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
      loadRelease: async (_version, requestTimeoutMs) => {
        metadataBudgets.push(requestTimeoutMs);
        clock += 20_000;
        return publicFiles;
      },
      verifyArtifact: async (
        _expected,
        _file,
        _outputRoot,
        _version,
        requestTimeoutMs,
      ) => {
        artifactBudgets.push(requestTimeoutMs);
        clock += artifactBudgets.length === 1 ? 30_000 : 10_000;
      },
    });
    expect(files).toEqual(publicFiles);
    expect(metadataBudgets).toEqual([60_000]);
    expect(artifactBudgets).toEqual([50_000, 20_000]);
    expect(clock).toBe(60_000);

    clock = 0;
    const absentBudgets: number[] = [];
    await expect(
      pollPublicExact(receipt, {
        timeoutMs: 12_500,
        now: () => clock,
        sleep: async (milliseconds) => {
          clock += milliseconds;
        },
        loadRelease: async (_version, requestTimeoutMs) => {
          absentBudgets.push(requestTimeoutMs);
          return [];
        },
        verifyArtifact: async () => {
          throw new Error("verification must not run for an absent release");
        },
      }),
    ).rejects.toThrow("within 13 seconds");
    expect(absentBudgets).toEqual([12_500, 7_500, 2_500]);
    expect(clock).toBe(12_500);
  });

  test("best-effort response cleanup cannot replace the intended release state", async () => {
    const response = new Response(
      new ReadableStream({
        cancel() {
          throw new Error("simulated cleanup failure");
        },
      }),
      { status: 503 },
    );
    await expect(discardResponseBody(response)).resolves.toBeUndefined();
  });

  test("pins and hash-verifies the complete Python build backend closure", async () => {
    expect(PINNED_BUILD_REQUIREMENTS).toEqual([
      "hatchling==1.27.0 --hash=sha256:d3a2f3567c4f926ea39849cdf924c7e99e6686c9c8e288ae1037c8fa2a5d937b",
      "packaging==26.2 --hash=sha256:5fc45236b9446107ff2415ce77c807cee2862cb6fac22b8a73826d0693b0980e",
      "pathspec==1.1.1 --hash=sha256:a00ce642f577bf7f473932318056212bc4f8bfdf53128c78bbd5af0b9b20b189",
      "pluggy==1.6.0 --hash=sha256:e920276dd6813095e9377c0bc5566d94c932c33b27a3e3945d8389c374dd4746",
      "trove-classifiers==2026.6.1.19 --hash=sha256:ab4c4ec93cc4a4e7815fa759906e05e6bb3f2fbd92ea0f897288c6a43efd15b3",
    ]);
    const script = await readFile(join(ROOT, "bin", "pypi-release.ts"), "utf8");
    expect(script).toContain('"--frozen"');
    expect(script).toContain('"--no-install-project"');
    expect(script).toContain('"--build-constraints"');
    expect(script).toContain('"--require-hashes"');
  });

  test("parses only a path-independent exact receipt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agenttool-pypi-receipt-"));
    try {
      const { receipt, publicFiles } = fixture();
      const path = join(directory, "receipt.json");
      await writeFile(path, `${JSON.stringify(receipt)}\n`);
      expect(await readReleaseReceipt(path)).toEqual(receipt);

      const complete: PyPIReleaseReceipt = {
        ...receipt,
        result: {
          status: "public_exact",
          pypi_observed_at: "2026-07-24T12:10:00.000Z",
          files: publicFiles,
        },
      };
      await writeFile(path, `${JSON.stringify(complete)}\n`);
      expect(await readReleaseReceipt(path)).toEqual(complete);

      await writeFile(
        path,
        `${JSON.stringify({ ...receipt, checkout: "/home/runner/work/agenttool" })}\n`,
      );
      await expect(readReleaseReceipt(path)).rejects.toThrow(
        "release receipt fields must be exactly",
      );

      await writeFile(
        path,
        `${JSON.stringify({ ...receipt, prepared_at: "July 24, 2026" })}\n`,
      );
      await expect(readReleaseReceipt(path)).rejects.toThrow(
        "canonical ISO timestamp",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("isolates OIDC publication from all repository code and long-lived credentials", async () => {
    const workflow = await readFile(
      join(ROOT, ".github", "workflows", "publish-pypi.yml"),
      "utf8",
    );
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).not.toMatch(/\n\s+push:/);
    expect(workflow).toContain("group: publish-pypi-agenttool-sdk");
    expect(workflow).not.toContain("group: publish-pypi-agenttool-sdk-${{ inputs.tag }}");
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("TWINE_");
    expect(workflow).not.toContain("PYPI_TOKEN");
    expect(workflow).not.toMatch(/\n\s+(?:user|username|password):/);
    expect(workflow.match(/id-token: write/g)).toHaveLength(1);
    expect(workflow.match(/environment: pypi/g)).toHaveLength(1);
    expect(workflow).toContain("skip-existing: true");
    expect(workflow).toContain(
      "packages-dir: ${{ runner.temp }}/agenttool-pypi-upload",
    );

    const prepareJob =
      workflow.split("\n  prepare:\n")[1]?.split("\n  preflight:\n")[0] ?? "";
    const preflightJob =
      workflow.split("\n  preflight:\n")[1]?.split("\n  publish:\n")[0] ?? "";
    const publishJob =
      workflow.split("\n  publish:\n")[1]?.split("\n  verify:\n")[0] ?? "";
    const verifyJob = workflow.split("\n  verify:\n")[1] ?? "";
    for (const job of [prepareJob, preflightJob, verifyJob]) {
      expect(job).toContain("contents: read");
      expect(job).not.toContain("environment:");
      expect(job).not.toContain("id-token:");
      expect(job).not.toContain("secrets.");
    }
    expect(prepareJob).toContain("bun bin/pypi-release.ts prepare");
    expect(prepareJob).toContain("pypi-release-receipt-${{ github.run_id }}");
    expect(prepareJob).toContain("pypi-release-wheel-${{ github.run_id }}");
    expect(prepareJob).toContain("pypi-release-sdist-${{ github.run_id }}");
    expect(preflightJob).toContain("bun bin/pypi-release.ts check");
    expect(verifyJob).toContain("bun bin/pypi-release.ts verify");
    expect(publishJob).toContain("environment: pypi");
    expect(publishJob).toContain("id-token: write");
    expect(publishJob).not.toContain("actions/checkout");
    expect(publishJob).not.toContain("setup-bun");
    expect(publishJob).not.toContain("setup-python");
    expect(publishJob).not.toContain("\n        run:");
    expect(publishJob).not.toContain("bin/pypi-release.ts");
    expect(publishJob).not.toContain("pypi-release-receipt-");
    expect(publishJob).toContain(
      "if: ${{ needs.preflight.outputs.wheel_required == 'true' }}",
    );
    expect(publishJob).toContain(
      "if: ${{ needs.preflight.outputs.sdist_required == 'true' }}",
    );
    expect(publishJob).toContain(
      "pypa/gh-action-pypi-publish@ba38be9e461d3875417946c167d0b5f3d385a247",
    );
  });

  test("pins every third-party action used by the release boundary", async () => {
    const workflow = await readFile(
      join(ROOT, ".github", "workflows", "publish-pypi.yml"),
      "utf8",
    );
    const uses = workflow
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("uses:"));
    expect(uses).toEqual([
      "uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
      "uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0",
      "uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7.0.0",
      "uses: astral-sh/setup-uv@1e862dfacbd1d6d858c55d9b792c756523627244 # v7.1.4",
      "uses: actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f # v6",
      "uses: actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f # v6",
      "uses: actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f # v6",
      "uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
      "uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0",
      "uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7.0.0",
      "uses: actions/download-artifact@018cc2cf5baa6db3ef3c5f8a56943fffe632ef53 # v6",
      "uses: actions/download-artifact@018cc2cf5baa6db3ef3c5f8a56943fffe632ef53 # v6",
      "uses: actions/download-artifact@018cc2cf5baa6db3ef3c5f8a56943fffe632ef53 # v6",
      "uses: actions/download-artifact@018cc2cf5baa6db3ef3c5f8a56943fffe632ef53 # v6",
      "uses: actions/download-artifact@018cc2cf5baa6db3ef3c5f8a56943fffe632ef53 # v6",
      "uses: pypa/gh-action-pypi-publish@ba38be9e461d3875417946c167d0b5f3d385a247 # v1.14.1",
      "uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
      "uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0",
      "uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7.0.0",
      "uses: actions/download-artifact@018cc2cf5baa6db3ef3c5f8a56943fffe632ef53 # v6",
      "uses: actions/download-artifact@018cc2cf5baa6db3ef3c5f8a56943fffe632ef53 # v6",
      "uses: actions/download-artifact@018cc2cf5baa6db3ef3c5f8a56943fffe632ef53 # v6",
    ]);
    expect(uses.every((line) => /@[0-9a-f]{40}\s+#/.test(line))).toBe(true);
  });
});
