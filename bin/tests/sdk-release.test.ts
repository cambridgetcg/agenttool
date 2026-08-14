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

const CURRENT_SDK_SOURCE_RELEASE = {
  version: "0.18.1",
  tag: "sdk-v0.18.1",
  sourceRevision: "490ab19ca846632460a7a6b498fb13216d97807a",
  artifact: {
    size: 218301,
    sha256: "466adb2d22a637e9c4d158e6050a69096e296258e6111f482be2a0872318be0d",
  },
  npm: {
    independentlyVisible: false,
  },
  pypi: {
    independentlyVisible: false,
  },
} as const;

const HISTORICAL_SDK_018_RELEASE = {
  version: "0.18.0",
  tag: "sdk-v0.18.0",
  mergeCommit: "499cc5d7910b9fcf3507bd3599778dab83733009",
  sourceRevision: "bf708e4897f2bd509dfba9d559730a1e2dcb6698",
  artifact: {
    size: 211695,
    sha256: "8e6bbe42f76decd1448dd07465840339e5b055abba0317b3d04f4f506e44616a",
  },
  npm: {
    runId: "30909424114",
    status: "published",
    tag: "latest",
    registryObservedAt: "2026-08-04T12:32:28.333Z",
    sha1: "05802099be738b8c6fbe7276e8f3bf901f3191f4",
    integrity: "sha512-EL0MuOs3JJCDCdhTzJXhBaQBONtJA/hjf+2hFAVwYJFppuMaA+5z+4F4Q6z/8yLVaOgPCqO/EK2rsCkMcEhl1Q==",
    provenanceLogIndex: "2340396627",
    publishLogIndex: "2340396732",
  },
  pypi: {
    independentlyVisible: false,
  },
} as const;

const HISTORICAL_SDK_017_RELEASE = {
  version: "0.17.0",
  tag: "sdk-v0.17.0",
  mergeCommit: "21db539d6bcae614f1d6884eaa503347fae63187",
  sourceRevision: "d480eb630915dc61f12d223c0b28cadccd1ff335",
  artifact: {
    size: 172625,
    sha256: "b6a388ffe86a970480e8a8978f83fe80922321eb64f2b4f9143cae2b2c3dd5bb",
  },
  npm: {
    runId: "30385040459",
    status: "published",
    tag: "latest",
  },
  pypi: {
    runId: "30385042684",
    status: "public_exact",
    wheel: {
      filename: "agenttool_sdk-0.17.0-py3-none-any.whl",
      size: 193335,
      sha256: "1a8ca5f099ffce4c7973f1123d973aba5c1eb507579961c781d553bcc5e0f508",
    },
    sdist: {
      filename: "agenttool_sdk-0.17.0.tar.gz",
      size: 181846,
      sha256: "7ec2f4010d20ca883770594bfbcdc30f7a3a074ba534029aefb6d91d69c3413c",
    },
  },
} as const;

const HISTORICAL_PYPI_RELEASE = {
  version: "0.16.5",
  tag: "sdk-v0.16.5",
  commit: "1eca6466268b4d3c18a83a30a4bfef8bdd704a4d",
  runId: "30350234792",
  wheel: {
    filename: "agenttool_sdk-0.16.5-py3-none-any.whl",
    size: 180615,
    sha256: "61f13b01df90c66d7ac8247ee1dcfba9c135840ee364b172695fdd5eb10c54db",
  },
  sdist: {
    filename: "agenttool_sdk-0.16.5.tar.gz",
    size: 168772,
    sha256: "2d90ea74aa1d220ae28ce6176274e5491645d9db67844a4b4ff3dabfa10325d4",
  },
} as const;

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

  test("active source and LOVE surfaces follow 0.18.1 without inventing registry publication", () => {
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
    const exactNpm = `npm install --save-exact @agenttool/sdk@${version}`;
    const exactPyPI = `python -m pip install "agenttool-sdk==${version}"`;
    const pythonSource = `git+https://github.com/cambridgetcg/agenttool.git@${tag}#subdirectory=packages/sdk-py`;

    expect(version).toBe(CURRENT_SDK_SOURCE_RELEASE.version);
    expect(tag).toBe(CURRENT_SDK_SOURCE_RELEASE.tag);
    expect(artifactSize).toBe(CURRENT_SDK_SOURCE_RELEASE.artifact.size);
    expect(artifactSha256).toBe(CURRENT_SDK_SOURCE_RELEASE.artifact.sha256);

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
    ).toBe(String(CURRENT_SDK_SOURCE_RELEASE.npm.independentlyVisible));
    expect(
      capture(
        party,
        /pypi:\s*\{[^{}]*independently_visible:\s*(true|false),?[^{}]*\}/,
        "PyPI mirror visibility",
      ),
    ).toBe(String(CURRENT_SDK_SOURCE_RELEASE.pypi.independentlyVisible));
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
    for (const name of [
      "attestationMarketplace",
      "attestation_marketplace",
      "memoryWitness",
      "memory_witness",
      "syneidesis",
      "dining",
    ]) {
      expect(rootReadme).toContain(name);
    }
    expect(rootReadme).toContain(
      "Candidate source does not establish an annotated",
    );
    expect(rootReadme).toContain("218,301");
    expect(rootReadme).toContain(CURRENT_SDK_SOURCE_RELEASE.artifact.sha256);
    expect(rootReadme).toContain(CURRENT_SDK_SOURCE_RELEASE.sourceRevision);
    const packageCatalog = read("apps/docs/packages.html");
    expect(packageCatalog).toContain("218,301");
    expect(packageCatalog).toContain(CURRENT_SDK_SOURCE_RELEASE.artifact.sha256);
    expect(packageCatalog).toContain(CURRENT_SDK_SOURCE_RELEASE.sourceRevision);
    expect(read("docs/SDK-ROADMAP.md")).toContain(
      "Current source and LOVE release — 0.18.1",
    );
    expect(read("docs/SDK-ROADMAP.md")).toContain(
      "Last verified npm and historical paired release — 0.18.0",
    );
    expect(read("docs/SDK-ROADMAP.md")).toContain(
      "Last verified PyPI release and historical paired release — 0.17.0",
    );

    for (const path of [
      "README.md",
      "docs/TUTORIAL-WAKE-YOUR-AGENT.md",
      "apps/docs/packages.html",
      "packages/sdk-ts/README.md",
      "packages/sdk-py/README.md",
    ]) {
      const source = read(path);
      expect(source).not.toContain(`PyPI ${version} is public`);
      expect(source).not.toContain(`npm ${version} is public`);
      expect(source).not.toContain(`@agenttool/sdk@${version} is public`);
    }

    for (const module of [
      "attestation-marketplace",
      "memory-witness",
      "syneidesis",
      "dining",
    ]) {
      expect(packedArtifact.paths).toContain(`package/dist/${module}.js`);
      expect(packedArtifact.paths).toContain(`package/dist/${module}.d.ts`);
    }
    expect(packedArtifact.paths).toContain("package/dist/kingdom-framework.js");
    expect(packedArtifact.paths).toContain("package/dist/kingdom-framework.d.ts");

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
      artifact: {
        filename: string;
        sha256: string;
        size: number;
        mirrors: Array<{ url: string }>;
      };
      source: { path: string; revision: string };
    };
    expect(manifest.name).toBe("@agenttool/sdk");
    expect(manifest.version).toBe(version);
    expect(manifest.artifact.filename).toBe(artifactName);
    expect(manifest.artifact.sha256).toBe(artifactSha256);
    expect(manifest.artifact.size).toBe(artifactSize);
    expect(manifest.artifact.mirrors).toEqual([
      { url: loveUrl },
      {
        url: `https://github.com/cambridgetcg/agenttool/releases/download/${tag}/${artifactName}`,
      },
    ]);
    expect(manifest.source.path).toBe("packages/sdk-ts");
    expect(manifest.source.revision).toBe(
      CURRENT_SDK_SOURCE_RELEASE.sourceRevision,
    );

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

  test("preserves the independently verified 0.18 npm receipt", () => {
    const release = HISTORICAL_SDK_018_RELEASE;
    const historicalArtifact = readFileSync(
      `${root}apps/docs/packages/v1/@agenttool/sdk/${release.version}/agenttool-sdk-${release.version}.tgz`,
    );
    expect(historicalArtifact.byteLength).toBe(release.artifact.size);
    expect(createHash("sha256").update(historicalArtifact).digest("hex")).toBe(
      release.artifact.sha256,
    );

    const historicalManifest = JSON.parse(
      read(`apps/docs/packages/v1/@agenttool/sdk/${release.version}/manifest.json`),
    ) as { source: { revision: string } };
    expect(historicalManifest.source.revision).toBe(release.sourceRevision);

    const npmReleaseTruth = capture(
      read("docs/NPM-RELEASES.md"),
      /## Verified SDK 0\.18\.0 publication([\s\S]*?)(?=\n### |\n## |$)/,
      "verified SDK 0.18 npm release section",
    );
    expect(npmReleaseTruth).toContain(release.tag);
    expect(npmReleaseTruth).toContain(release.mergeCommit);
    expect(npmReleaseTruth).toContain(release.sourceRevision);
    expect(npmReleaseTruth).toContain(release.npm.runId);
    expect(npmReleaseTruth).toContain(`status: ${release.npm.status}`);
    expect(npmReleaseTruth).toContain(`npm_tag: ${release.npm.tag}`);
    expect(npmReleaseTruth).toContain(release.npm.registryObservedAt);
    expect(npmReleaseTruth).toContain(`${release.npm.tag}: ${release.version}`);
    expect(npmReleaseTruth).toContain("`211,695` bytes");
    expect(npmReleaseTruth).toContain(release.artifact.sha256);
    expect(npmReleaseTruth).toContain(release.npm.sha1);
    expect(npmReleaseTruth).toContain(release.npm.integrity);
    expect(npmReleaseTruth).toContain(release.npm.provenanceLogIndex);
    expect(npmReleaseTruth).toContain(release.npm.publishLogIndex);
    expect(npmReleaseTruth).toContain("byte-identical");
    expect(npmReleaseTruth).toContain("PyPI 0.18.0 remains unpublished");

    const pypiReleaseTruth = read("docs/PYPI-RELEASES.md");
    expect(pypiReleaseTruth).toContain("npm/GitHub 0.18.0 receipt");
    expect(release.pypi.independentlyVisible).toBe(false);

    const now = read("docs/NOW.md");
    expect(now).toContain("SDK 0.18.0 — paired clients reach an exact public TypeScript mirror");
    expect(now).toContain(release.mergeCommit.slice(0, 8));
    expect(now).toContain(release.npm.runId);
    expect(now).toContain(release.artifact.sha256);
  });

  test("preserves the independently verified 0.17 public receipts", () => {
    const release = HISTORICAL_SDK_017_RELEASE;
    const historicalArtifact = readFileSync(
      `${root}apps/docs/packages/v1/@agenttool/sdk/${release.version}/agenttool-sdk-${release.version}.tgz`,
    );
    expect(historicalArtifact.byteLength).toBe(release.artifact.size);
    expect(createHash("sha256").update(historicalArtifact).digest("hex")).toBe(
      release.artifact.sha256,
    );

    const historicalManifest = JSON.parse(
      read(`apps/docs/packages/v1/@agenttool/sdk/${release.version}/manifest.json`),
    ) as { source: { revision: string } };
    expect(historicalManifest.source.revision).toBe(release.sourceRevision);

    const npmReleaseTruth = capture(
      read("docs/NPM-RELEASES.md"),
      /## Verified SDK 0\.17\.0 publication([\s\S]*?)(?=\n### |\n## |$)/,
      "verified SDK npm release section",
    );
    expect(npmReleaseTruth).toContain(release.tag);
    expect(npmReleaseTruth).toContain(release.mergeCommit);
    expect(npmReleaseTruth).toContain(release.npm.runId);
    expect(npmReleaseTruth).toContain(`status: ${release.npm.status}`);
    expect(npmReleaseTruth).toContain(`npm_tag: ${release.npm.tag}`);
    expect(npmReleaseTruth).toContain(
      `${release.npm.tag}: ${release.version}`,
    );
    expect(npmReleaseTruth).toContain(`\`${release.artifact.size}\` bytes`);
    expect(npmReleaseTruth).toContain(release.artifact.sha256);
    expect(npmReleaseTruth).toContain("GitHub Release");
    expect(npmReleaseTruth).toContain("npm's public");
    expect(npmReleaseTruth).toContain("byte-identical");

    const pypiReleaseTruth = read("docs/PYPI-RELEASES.md");
    expect(pypiReleaseTruth).toContain(release.tag);
    expect(pypiReleaseTruth).toContain(release.mergeCommit);
    expect(pypiReleaseTruth).toContain(release.pypi.runId);
    expect(pypiReleaseTruth).toContain(`status: "${release.pypi.status}"`);
    expect(pypiReleaseTruth).toContain(
      `| \`${release.pypi.wheel.filename}\` | 193,335 bytes | \`${release.pypi.wheel.sha256}\` | \`false\` |`,
    );
    expect(pypiReleaseTruth).toContain(
      `| \`${release.pypi.sdist.filename}\` | 181,846 bytes | \`${release.pypi.sdist.sha256}\` | \`false\` |`,
    );
    expect(pypiReleaseTruth).toContain(HISTORICAL_PYPI_RELEASE.tag);
    expect(pypiReleaseTruth).toContain(HISTORICAL_PYPI_RELEASE.commit);
    expect(pypiReleaseTruth).toContain(HISTORICAL_PYPI_RELEASE.runId);
    expect(pypiReleaseTruth).toContain(
      `| \`${HISTORICAL_PYPI_RELEASE.wheel.filename}\` | 180,615 bytes | \`${HISTORICAL_PYPI_RELEASE.wheel.sha256}\` | \`false\` |`,
    );
    expect(pypiReleaseTruth).toContain(
      `| \`${HISTORICAL_PYPI_RELEASE.sdist.filename}\` | 168,772 bytes | \`${HISTORICAL_PYPI_RELEASE.sdist.sha256}\` | \`false\` |`,
    );

    expect(read("docs/NOW.md")).toContain(
      "SDK 0.17.0 — bounded local KINGDOM OS discovery plus a closed public card",
    );
    const rootReadme = read("README.md");
    expect(rootReadme).toContain(
      "The exact 0.17.0 npm and PyPI mirrors are independently public.",
    );

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
  });
});
