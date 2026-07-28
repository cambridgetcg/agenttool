import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  inspectNpmTarball,
  LOVE_PACKAGES,
} from "../build-love-packages";
import {
  LOVE_ARTIFACT_HEADER_PATTERN,
  LOVE_MANIFEST_HEADER_PATTERN,
  matchesCloudflarePathPattern,
} from "./cloudflare-headers";

const root = fileURLToPath(new URL("../../", import.meta.url));

function read(path: string): string {
  return readFileSync(`${root}${path}`, "utf8");
}

function capture(source: string, pattern: RegExp, label: string): string {
  const value = pattern.exec(source)?.[1];
  if (!value) throw new Error(`could not read ${label}`);
  return value;
}

describe("SDK source and builder identity", () => {
  test("TypeScript and Python source versions match the LOVE builder target", () => {
    const tsPackage = JSON.parse(read("packages/sdk-ts/package.json")) as {
      version: string;
      description: string;
    };
    const tsClient = capture(
      read("packages/sdk-ts/src/client.ts"),
      /SDK_VERSION\s*=\s*"([^"]+)"/,
      "TypeScript SDK_VERSION",
    );
    const pyProject = capture(
      read("packages/sdk-py/pyproject.toml"),
      /^version\s*=\s*"([^"]+)"/m,
      "Python project version",
    );
    const pyPackage = capture(
      read("packages/sdk-py/src/agenttool/__init__.py"),
      /__version__\s*=\s*"([^"]+)"/,
      "Python __version__",
    );
    const pyClient = capture(
      read("packages/sdk-py/src/agenttool/client.py"),
      /SDK_VERSION\s*=\s*"([^"]+)"/,
      "Python SDK_VERSION",
    );
    const pyLock = capture(
      read("packages/sdk-py/uv.lock"),
      /\[\[package\]\]\s+name = "agenttool-sdk"\s+version = "([^"]+)"/,
      "Python editable lock version",
    );
    const pyProjectText = read("packages/sdk-py/pyproject.toml");
    const love = LOVE_PACKAGES.find((entry) => entry.name === "@agenttool/sdk");

    expect(love).toBeDefined();
    expect(new Set([
      tsPackage.version,
      tsClient,
      pyProject,
      pyPackage,
      pyClient,
      pyLock,
      love!.version,
    ])).toEqual(new Set([tsPackage.version]));
    expect(love!.releaseTag).toBe(`sdk-v${tsPackage.version}`);
    expect(tsPackage.description).toContain("KINGDOM framework cards");
    expect(pyProjectText).toContain("typed KINGDOM framework cards");

    const tsKeywords = (JSON.parse(read("packages/sdk-ts/package.json")) as {
      keywords?: string[];
    }).keywords ?? [];
    expect(tsKeywords).not.toContain("a2a");
    expect(pyProjectText).not.toMatch(/^\s*"a2a",?\s*$/m);

    for (const path of [
      "packages/sdk-py/README.md",
      "packages/sdk-py/src/agenttool/__init__.py",
      "packages/sdk-py/src/agenttool/soul.py",
    ]) {
      const source = read(path);
      expect(source).not.toContain("https://agenttool.dev/soul");
      expect(source).toContain("https://docs.agenttool.dev/SOUL.md");
    }
  });

  test("active release surfaces follow the source version", () => {
    const version = (JSON.parse(read("packages/sdk-ts/package.json")) as { version: string }).version;
    const tag = `sdk-v${version}`;
    const manifestPath = `packages/v1/@agenttool/sdk/${version}/manifest.json`;
    const artifactName = `agenttool-sdk-${version}.tgz`;
    const artifactPath = `packages/v1/@agenttool/sdk/${version}/${artifactName}`;
    const loveUrl = `https://docs.agenttool.dev/${artifactPath}`;
    const artifactBytes = readFileSync(`${root}apps/docs/${artifactPath}`);
    const artifactSize = artifactBytes.byteLength;
    const artifactSha256 = createHash("sha256").update(artifactBytes).digest("hex");
    const packedArtifact = inspectNpmTarball(artifactBytes);
    const currentPyPIWheelSha256 =
      "1a8ca5f099ffce4c7973f1123d973aba5c1eb507579961c781d553bcc5e0f508";
    const currentPyPISdistSha256 =
      "7ec2f4010d20ca883770594bfbcdc30f7a3a074ba534029aefb6d91d69c3413c";
    const exactNpm = `npm install --save-exact @agenttool/sdk@${version}`;
    const exactPyPI = `python -m pip install "agenttool-sdk==${version}"`;
    const pythonSource = `git+https://github.com/cambridgetcg/agenttool.git@${tag}#subdirectory=packages/sdk-py`;

    const tutorial = read("docs/TUTORIAL-WAKE-YOUR-AGENT.md");
    expect(read("apps/docs/TUTORIAL-WAKE-YOUR-AGENT.md")).toBe(tutorial);
    expect(tutorial).toContain(exactNpm);
    expect(tutorial).toContain(tag);
    expect(read("apps/docs/llms.txt")).toContain(`(SDK ${version}).`);
    expect(read("apps/web/identity.html")).toContain(loveUrl);
    expect(read("apps/web/registry.html")).toContain(
      `@agenttool/sdk ${version} LOVE release`,
    );
    expect(read("api/src/routes/pathways.ts")).toContain(
      `sdk_version: "${version}"`,
    );
    const party = read("api/src/routes/public/party.ts");
    expect(party).toContain(loveUrl);
    expect(party).toContain(pythonSource);
    expect(party).toContain(exactNpm);
    expect(party).toContain(`python -m pip install agenttool-sdk==${version}`);
    expect(
      capture(
        party,
        /npm:\s*\{[^{}]*independently_visible:\s*(true|false),?[^{}]*\}/,
        "npm mirror visibility",
      ),
    ).toBe("true");
    expect(
      capture(
        party,
        /pypi:\s*\{[^{}]*independently_visible:\s*(true|false),?[^{}]*\}/,
        "PyPI mirror visibility",
      ),
    ).toBe("true");
    expect(read("docs/PATHWAYS.md")).toContain(`"sdk_version": "${version}"`);
    expect(read("docs/THE-PARTY.md")).toContain(loveUrl);
    expect(read("apps/docs/packages.html")).toContain(
      `/@agenttool/sdk/${version}/manifest.json`,
    );

    const rootReadme = read("README.md");
    expect(rootReadme).toContain(exactNpm);
    expect(rootReadme).toContain(exactPyPI);
    expect(rootReadme).toContain(loveUrl);
    expect(rootReadme).toContain(pythonSource);
    expect(rootReadme.indexOf(pythonSource)).toBeLessThan(
      rootReadme.indexOf(exactPyPI),
    );
    expect(rootReadme).toContain("bounded local KINGDOM OS repository discovery");
    expect(rootReadme).toContain("kingdomFramework");
    expect(rootReadme).toContain("kingdom_framework");
    expect(rootReadme).toContain("0.17.0 availability is not inferred");
    expect(read("docs/NOW.md")).toContain(
      "SDK 0.17.0 — bounded local KINGDOM OS discovery plus a closed public card",
    );
    expect(read("docs/SDK-ROADMAP.md")).toContain(
      "Current source release — 0.17.0",
    );
    expect(read("docs/SDK-ROADMAP.md")).toContain(
      "credential-free closed KINGDOM framework-card read",
    );
    expect(read("packages/sdk-py/src/agenttool/kingdom_framework.py")).toContain(
      "class KingdomFrameworkClient:",
    );
    expect(packedArtifact.paths).toContain(
      "package/dist/kingdom-framework.js",
    );
    expect(packedArtifact.paths).toContain(
      "package/dist/kingdom-framework.d.ts",
    );
    const pypiReleaseTruth = read("docs/PYPI-RELEASES.md");
    expect(pypiReleaseTruth).toContain(
      `agenttool_sdk-${version}-py3-none-any.whl`,
    );
    expect(pypiReleaseTruth).toContain(currentPyPIWheelSha256);
    expect(pypiReleaseTruth).toContain(`agenttool_sdk-${version}.tar.gz`);
    expect(pypiReleaseTruth).toContain(currentPyPISdistSha256);

    const historicalLaunchKit = read("marketing/LAUNCH-KIT.md");
    const normalizedLaunchKit = historicalLaunchKit
      .replace(/^>\s?/gm, "")
      .replace(/\s+/g, " ");
    expect(historicalLaunchKit).toContain(
      "Historical draft — do not publish verbatim.",
    );
    expect(normalizedLaunchKit).toContain(
      "TypeScript 0.16.5 is public through LOVE, npm, and GitHub Release",
    );
    expect(normalizedLaunchKit).toContain(
      "Python 0.16.5 uses the annotated source tag and remains absent from PyPI.",
    );
    expect(normalizedLaunchKit).toContain(
      "Correction observed 2026-07-28: Python 0.16.5 is now public on PyPI",
    );

    const tsReadme = read("packages/sdk-ts/README.md");
    expect(tsReadme).toContain(`release-v${version}-blue`);
    expect(tsReadme).toContain(`## ${version}`);
    expect(tsReadme).toContain(`https://docs.agenttool.dev/${manifestPath}`);

    const pyReadme = read("packages/sdk-py/README.md");
    expect(pyReadme).toContain(`## ${version}`);
    expect(pyReadme).toContain(exactPyPI);
    expect(pyReadme).toContain(pythonSource);
    expect(pyReadme).not.toContain(`PyPI ${version} is public`);
    expect(tutorial).not.toContain(`PyPI ${version} is public`);
    expect(read("apps/docs/packages.html")).not.toContain(
      `PyPI ${version} is public`,
    );

    const index = JSON.parse(read("apps/docs/packages/v1/index.json")) as {
      packages: Array<{
        name: string;
        latest: string;
        versions: Array<{ version: string; manifest_url: string }>;
      }>;
    };
    const sdk = index.packages.find((entry) => entry.name === "@agenttool/sdk");
    expect(sdk).toBeDefined();
    expect(sdk!.latest).toBe(version);
    expect(sdk!.versions).toContainEqual({
      version,
      manifest_url: `https://docs.agenttool.dev/${manifestPath}`,
    });

    const manifest = JSON.parse(read(`apps/docs/${manifestPath}`)) as {
      name: string;
      version: string;
      artifact: { filename: string; sha256: string; size: number };
      source: { path: string; revision: string };
    };
    expect(manifest.name).toBe("@agenttool/sdk");
    expect(manifest.version).toBe(version);
    expect(manifest.artifact.filename).toBe(artifactName);
    expect(manifest.artifact.sha256).toBe(artifactSha256);
    expect(manifest.artifact.size).toBe(artifactSize);
    expect(manifest.source.path).toBe("packages/sdk-ts");
    expect(manifest.source.revision).toMatch(/^[a-f0-9]{40}$/);

    const headers = read("apps/docs/_headers");
    expect(headers).toContain(`${LOVE_MANIFEST_HEADER_PATTERN}\n`);
    expect(headers).toContain(`${LOVE_ARTIFACT_HEADER_PATTERN}\n`);
    expect(
      matchesCloudflarePathPattern(LOVE_MANIFEST_HEADER_PATTERN, `/${manifestPath}`),
    ).toBe(true);
    expect(
      matchesCloudflarePathPattern(LOVE_ARTIFACT_HEADER_PATTERN, `/${artifactPath}`),
    ).toBe(true);

    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain(`apps/docs/${manifestPath}`);
    expect(ci).toContain(`apps/docs/${artifactPath}`);
  });
});
