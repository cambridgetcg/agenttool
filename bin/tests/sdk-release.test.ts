import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

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

const ACTIVE_SDK_RELEASE = {
  version: "0.21.0",
  tag: "sdk-v0.21.0",
  sourceRevision: "6a6b6ad7abafe614827cdfc11a34cffcd8fdc6c3",
  artifact: {
    size: 247146,
    entries: 100,
    sha256: "c18d1b35ba5f7c918bbee64642510452af6f67302b78038580b4b65c6b77c154",
  },
  npm: {
    independentlyVisible: false,
  },
  pypi: {
    independentlyVisible: false,
  },
} as const;

const HISTORICAL_SDK_020_RELEASE = {
  version: "0.20.0",
  tag: "sdk-v0.20.0",
  tagObject: "e7d9616eb14851ffab9312f87438959c4c6de71d",
  mergeCommit: "cb9c30fae0e49e1727e449207593581ce52cd4cf",
  mergeParents: [
    "f93ec78ae5051c4ffa569cf2ee88e0e45cf6cbf9",
    "53a1b8f5157f13eaa90181c23454bb91d55666ee",
  ],
  githubReleasePublishedAt: "2026-08-14T15:36:56Z",
  githubAssetUrl: "https://github.com/cambridgetcg/agenttool/releases/download/sdk-v0.20.0/agenttool-sdk-0.20.0.tgz",
  sourceRevision: "040e076bc537d433feaf32e23eec4e5cdf0ed6e2",
  artifact: {
    size: 236446,
    entries: 98,
    sha1: "9136e2f2e7b1e11d84d934cb7c4f31688cbe2101",
    sha256: "d3b2fa790eb9a256d0f682c2b72ca97d572a000f7028238cb1a1a53959ccdf03",
    integrity: "sha512-8DXyrQGRGvzJ9gEJny6U/82IPocg6qEzbpf7TvfIPZXD7wwhBl+aWPLLN/owzuUt6nAIGAHag9znwzCnaJuLgg==",
  },
  npm: {
    independentlyVisible: true,
    runId: "31815209550",
    attempt: 1,
    status: "published",
    tag: "latest",
    runStartedAt: "2026-08-14T15:35:02Z",
    runCompletedAt: "2026-08-14T15:37:11Z",
    preparedAt: "2026-08-14T15:35:42.696Z",
    registryObservedAt: "2026-08-14T15:37:05.373Z",
    publishedAt: "2026-08-14T15:37:04.088Z",
    registryTarball: "https://registry.npmjs.org/@agenttool/sdk/-/sdk-0.20.0.tgz",
    provenanceLogIndex: "2467138141",
    publishLogIndex: "2467138904",
  },
  pypi: {
    independentlyVisible: true,
    runId: "31815447080",
    attempt: 1,
    status: "public_exact",
    sourceRevision: "cb9c30fae0e49e1727e449207593581ce52cd4cf",
    runStartedAt: "2026-08-14T15:37:55Z",
    runCompletedAt: "2026-08-14T15:41:37Z",
    preparedAt: "2026-08-14T15:39:08.039Z",
    observedAt: "2026-08-14T15:41:34.043Z",
    wheel: {
      filename: "agenttool_sdk-0.20.0-py3-none-any.whl",
      size: 265633,
      sha256: "43483413256b63a001d6deae16928dac2aaae8ed8572fddb98e14381e844035b",
      url: "https://files.pythonhosted.org/packages/d6/bc/b4e5241942377210fb09dad25c8bd1ff3fc07bddd0e14802c7eae67e2dda/agenttool_sdk-0.20.0-py3-none-any.whl",
      uploadedAt: "2026-08-14T15:40:22.479141Z",
      integrityUrl: "https://pypi.org/integrity/agenttool-sdk/0.20.0/agenttool_sdk-0.20.0-py3-none-any.whl/provenance",
      transparencyLogIndex: "2467178343",
      yanked: false,
    },
    sdist: {
      filename: "agenttool_sdk-0.20.0.tar.gz",
      size: 250597,
      sha256: "54cb2096f984ec9f4c9791224d9e3cca3b322842ca8b825a13bf95008eb779f4",
      url: "https://files.pythonhosted.org/packages/ca/89/d780790c40f0ee3845d9dd191e24fea0a65ecac4b61d8849af2a16a74193/agenttool_sdk-0.20.0.tar.gz",
      uploadedAt: "2026-08-14T15:40:23.809201Z",
      integrityUrl: "https://pypi.org/integrity/agenttool-sdk/0.20.0/agenttool_sdk-0.20.0.tar.gz/provenance",
      transparencyLogIndex: "2467178268",
      yanked: false,
    },
  },
} as const;

const HISTORICAL_SDK_019_RELEASE = {
  version: "0.19.0",
  tag: "sdk-v0.19.0",
  mergeCommit: "17f5c9920c6e6abe8046d39926ae7a73d2f24e89",
  sourceRevision: "3239a25987d9de95b678e808d2d5168e786b2472",
  artifact: {
    size: 230184,
    entries: 96,
    sha256: "0a7eed4029bc687605b4d56707843c12ccb36d10a162a1fea1681522ab8784a2",
  },
  npm: {
    runId: "31800748738",
  },
  pypi: {
    runId: "31801053841",
    wheel: {
      size: 259921,
      sha256: "a01acda48db621cf4107fbca4e4495a9e5051be1f13a1bbe0258916d17268f35",
    },
    sdist: {
      size: 245116,
      sha256: "0b9acd8e92386e56eec21f8cabecaf8fcc2a321e9a911ebda1fe1b56f2fbe1ee",
    },
  },
} as const;

const HISTORICAL_SDK_0181_RELEASE = {
  version: "0.18.1",
  tag: "sdk-v0.18.1",
  tagObject: "a4e79909f73bd390d8ab0a58cb7ca9b7ed0dd5be",
  mergeCommit: "a781fff407e6d6c0401e6bd35dad1b5671d29491",
  githubReleasePublishedAt: "2026-08-14T10:01:44Z",
  sourceRevision: "490ab19ca846632460a7a6b498fb13216d97807a",
  artifact: {
    size: 218301,
    entries: 94,
    sha1: "9c53f2658d4a6db476b7bacb78fac45605c834cc",
    sha256: "466adb2d22a637e9c4d158e6050a69096e296258e6111f482be2a0872318be0d",
    integrity: "sha512-BN7CN87sbzp08A3t79QlzHdgL8/IYOspX16taHnGZpLxOg5PmlDH3QfO9MxXXPwMaBHK/S/tR31bNKWIU+OI1Q==",
  },
  npm: {
    independentlyVisible: true,
    runId: "31790395261",
    attempt: 1,
    status: "published",
    tag: "latest",
    preparedAt: "2026-08-14T10:00:27.912Z",
    registryObservedAt: "2026-08-14T10:01:53.201Z",
    publishedAt: "2026-08-14T10:01:51.920Z",
    registryTarball: "https://registry.npmjs.org/@agenttool/sdk/-/sdk-0.18.1.tgz",
    provenanceLogIndex: "2465022615",
    publishLogIndex: "2465023133",
  },
  pypi: {
    independentlyVisible: true,
    runId: "31790559054",
    status: "public_exact",
    sourceRevision: "a781fff407e6d6c0401e6bd35dad1b5671d29491",
    preparedAt: "2026-08-14T10:03:03.826Z",
    observedAt: "2026-08-14T10:05:01.477Z",
    wheel: {
      filename: "agenttool_sdk-0.18.1-py3-none-any.whl",
      size: 248937,
      sha256: "ad5d8fe66f0218cb86d37a1dc5c9fb2d9b7b8d25ebaad7e408cfd1a9b2964ab3",
      url: "https://files.pythonhosted.org/packages/d6/0f/1f1570a6c5c022ec6d999c72577fca0b77c17467ff9363c1ed17792b92f6/agenttool_sdk-0.18.1-py3-none-any.whl",
      uploadedAt: "2026-08-14T10:04:31.867729Z",
      transparencyLogIndex: "2465055465",
      yanked: false,
    },
    sdist: {
      filename: "agenttool_sdk-0.18.1.tar.gz",
      size: 233734,
      sha256: "1d5e3ca16ce53f71e2bec40e37c0a1d4ef250086d1f52010f13cc1305831f2af",
      url: "https://files.pythonhosted.org/packages/e9/17/a45e1fbfd573163d31e229758a4b0687af8e86b8396d672e4bd536c01919/agenttool_sdk-0.18.1.tar.gz",
      uploadedAt: "2026-08-14T10:04:33.313732Z",
      transparencyLogIndex: "2465055324",
      yanked: false,
    },
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
    expect(tsPackage.description).toContain("typed KINGDOM cards");
    expect(pyProjectText).toContain("typed KINGDOM cards");

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

  test("selects the sealed 0.21.0 candidate and preserves verified 0.20.0 receipts", () => {
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

    expect(version).toBe(ACTIVE_SDK_RELEASE.version);
    expect(tag).toBe(ACTIVE_SDK_RELEASE.tag);
    expect(artifactSize).toBe(ACTIVE_SDK_RELEASE.artifact.size);
    expect(artifactSha256).toBe(ACTIVE_SDK_RELEASE.artifact.sha256);
    expect(packedArtifact.paths).toHaveLength(ACTIVE_SDK_RELEASE.artifact.entries);

    const tutorial = read("docs/TUTORIAL-WAKE-YOUR-AGENT.md");
    expect(read("apps/docs/TUTORIAL-WAKE-YOUR-AGENT.md")).toBe(tutorial);
    expect(tutorial).toContain(exactNpm);
    expect(tutorial).toContain(tag);
    expect(read("apps/docs/llms.txt")).toContain(
      `SDK ${version} LOVE/source candidate`,
    );
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
    ).toBe(String(ACTIVE_SDK_RELEASE.npm.independentlyVisible));
    expect(
      capture(
        party,
        /pypi:\s*\{[^{}]*independently_visible:\s*(true|false),?[^{}]*\}/,
        "PyPI mirror visibility",
      ),
    ).toBe(String(ACTIVE_SDK_RELEASE.pypi.independentlyVisible));
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
      "mathCards",
      "math_cards",
      "LoveBombClient",
      "LoveBombPublicSignal",
    ]) {
      expect(rootReadme).toContain(name);
    }
    expect(rootReadme).toContain("247,146");
    expect(rootReadme).toContain(ACTIVE_SDK_RELEASE.artifact.sha256);
    expect(rootReadme).toContain(ACTIVE_SDK_RELEASE.sourceRevision);
    expect(rootReadme).toContain("236,446");
    expect(rootReadme).toContain(HISTORICAL_SDK_020_RELEASE.tagObject);
    expect(rootReadme).toContain(HISTORICAL_SDK_020_RELEASE.mergeCommit);
    expect(rootReadme).toContain(HISTORICAL_SDK_020_RELEASE.artifact.sha256);
    expect(rootReadme).toContain(HISTORICAL_SDK_020_RELEASE.sourceRevision);
    expect(rootReadme).toContain(HISTORICAL_SDK_020_RELEASE.npm.runId);
    expect(rootReadme).toContain(HISTORICAL_SDK_020_RELEASE.pypi.runId);
    expect(rootReadme).toContain(HISTORICAL_SDK_020_RELEASE.pypi.wheel.sha256);
    expect(rootReadme).toContain(HISTORICAL_SDK_020_RELEASE.pypi.sdist.sha256);
    expect(rootReadme).toContain("sealed 0.20.0 tarball's packed");
    expect(rootReadme).toContain("without rewriting");
    expect(rootReadme).toContain(HISTORICAL_SDK_0181_RELEASE.mergeCommit);
    expect(rootReadme).toContain(HISTORICAL_SDK_0181_RELEASE.npm.runId);
    expect(rootReadme).toContain(HISTORICAL_SDK_0181_RELEASE.pypi.runId);
    expect(rootReadme).toContain("218,301");
    expect(rootReadme).toContain(HISTORICAL_SDK_0181_RELEASE.artifact.sha256);
    expect(rootReadme).toContain(HISTORICAL_SDK_0181_RELEASE.sourceRevision);
    const packageCatalog = read("apps/docs/packages.html");
    expect(packageCatalog).toContain("247,146");
    expect(packageCatalog).toContain(ACTIVE_SDK_RELEASE.artifact.sha256);
    expect(packageCatalog).toContain(ACTIVE_SDK_RELEASE.sourceRevision);
    expect(packageCatalog).toContain("236,446");
    expect(packageCatalog).toContain(HISTORICAL_SDK_020_RELEASE.artifact.sha256);
    expect(packageCatalog).toContain(HISTORICAL_SDK_020_RELEASE.sourceRevision);
    expect(packageCatalog).toContain(HISTORICAL_SDK_020_RELEASE.tagObject);
    expect(packageCatalog).toContain(HISTORICAL_SDK_020_RELEASE.mergeCommit);
    expect(packageCatalog).toContain(HISTORICAL_SDK_020_RELEASE.npm.runId);
    expect(packageCatalog).toContain(HISTORICAL_SDK_020_RELEASE.pypi.runId);
    expect(packageCatalog).toContain(HISTORICAL_SDK_020_RELEASE.artifact.integrity);
    expect(packageCatalog).toContain(HISTORICAL_SDK_020_RELEASE.pypi.wheel.sha256);
    expect(packageCatalog).toContain(HISTORICAL_SDK_020_RELEASE.pypi.sdist.sha256);
    expect(packageCatalog).toContain("218,301");
    expect(packageCatalog).toContain(HISTORICAL_SDK_0181_RELEASE.artifact.sha256);
    expect(packageCatalog).toContain(HISTORICAL_SDK_0181_RELEASE.sourceRevision);
    expect(packageCatalog).toContain(HISTORICAL_SDK_0181_RELEASE.npm.runId);
    expect(packageCatalog).toContain(HISTORICAL_SDK_0181_RELEASE.pypi.runId);
    expect(read("docs/SDK-ROADMAP.md")).toContain(
      "Paired source candidate — 0.21.0",
    );
    expect(read("docs/SDK-ROADMAP.md")).toContain(
      "Historical verified npm/PyPI paired release — 0.19.0",
    );
    expect(read("docs/SDK-ROADMAP.md")).toContain(
      "Earlier verified npm/PyPI release — 0.18.1",
    );
    expect(read("docs/SDK-ROADMAP.md")).toContain(
      "Last verified npm and historical paired release — 0.18.0",
    );
    expect(read("docs/SDK-ROADMAP.md")).toContain(
      "Last verified PyPI release and historical paired release — 0.17.0",
    );

    for (const path of ["packages/sdk-ts/README.md", "packages/sdk-py/README.md"]) {
      expect(read(path)).toContain(
        "Repository source declares the paired 0.21.0 line",
      );
    }

    const activeNpmReleaseTruth = capture(
      read("docs/NPM-RELEASES.md"),
      /## Verified SDK 0\.20\.0 publication([\s\S]*?)(?=\n### |\n## |$)/,
      "verified SDK 0.20.0 npm release section",
    );
    expect(activeNpmReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.tag);
    expect(activeNpmReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.tagObject);
    expect(activeNpmReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.mergeCommit);
    for (const parent of HISTORICAL_SDK_020_RELEASE.mergeParents) {
      expect(activeNpmReleaseTruth).toContain(parent);
    }
    expect(activeNpmReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.sourceRevision);
    expect(activeNpmReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.githubReleasePublishedAt);
    expect(activeNpmReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.githubAssetUrl);
    expect(activeNpmReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.npm.runId);
    expect(activeNpmReleaseTruth).toContain(`attempt ${HISTORICAL_SDK_020_RELEASE.npm.attempt}`);
    expect(activeNpmReleaseTruth).toContain(`status: ${HISTORICAL_SDK_020_RELEASE.npm.status}`);
    expect(activeNpmReleaseTruth).toContain(`npm_tag: ${HISTORICAL_SDK_020_RELEASE.npm.tag}`);
    expect(activeNpmReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.npm.runStartedAt);
    expect(activeNpmReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.npm.runCompletedAt);
    expect(activeNpmReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.npm.preparedAt);
    expect(activeNpmReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.npm.registryObservedAt);
    expect(activeNpmReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.npm.publishedAt);
    expect(activeNpmReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.npm.registryTarball);
    expect(activeNpmReleaseTruth).toContain(
      `${HISTORICAL_SDK_020_RELEASE.npm.tag}: ${HISTORICAL_SDK_020_RELEASE.version}`,
    );
    expect(activeNpmReleaseTruth).toContain("`236,446` bytes");
    expect(activeNpmReleaseTruth).toContain(`${HISTORICAL_SDK_020_RELEASE.artifact.entries} entries`);
    expect(activeNpmReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.artifact.sha1);
    expect(activeNpmReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.artifact.sha256);
    expect(activeNpmReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.artifact.integrity);
    expect(activeNpmReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.npm.provenanceLogIndex);
    expect(activeNpmReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.npm.publishLogIndex);
    expect(activeNpmReleaseTruth).toContain("byte-identical");
    expect(activeNpmReleaseTruth).toContain("README retains its preparation-time");
    expect(activeNpmReleaseTruth).toContain("new package version");

    const npmReleaseTruth = capture(
      read("docs/NPM-RELEASES.md"),
      /## Verified SDK 0\.18\.1 publication([\s\S]*?)(?=\n### |\n## |$)/,
      "verified SDK 0.18.1 npm release section",
    );
    expect(npmReleaseTruth).toContain(HISTORICAL_SDK_0181_RELEASE.tag);
    expect(npmReleaseTruth).toContain(HISTORICAL_SDK_0181_RELEASE.tagObject);
    expect(npmReleaseTruth).toContain(HISTORICAL_SDK_0181_RELEASE.mergeCommit);
    expect(npmReleaseTruth).toContain(HISTORICAL_SDK_0181_RELEASE.sourceRevision);
    expect(npmReleaseTruth).toContain(HISTORICAL_SDK_0181_RELEASE.githubReleasePublishedAt);
    expect(npmReleaseTruth).toContain(HISTORICAL_SDK_0181_RELEASE.npm.runId);
    expect(npmReleaseTruth).toContain(`attempt ${HISTORICAL_SDK_0181_RELEASE.npm.attempt}`);
    expect(npmReleaseTruth).toContain(`status: ${HISTORICAL_SDK_0181_RELEASE.npm.status}`);
    expect(npmReleaseTruth).toContain(`npm_tag: ${HISTORICAL_SDK_0181_RELEASE.npm.tag}`);
    expect(npmReleaseTruth).toContain(HISTORICAL_SDK_0181_RELEASE.npm.preparedAt);
    expect(npmReleaseTruth).toContain(HISTORICAL_SDK_0181_RELEASE.npm.registryObservedAt);
    expect(npmReleaseTruth).toContain(HISTORICAL_SDK_0181_RELEASE.npm.publishedAt);
    expect(npmReleaseTruth).toContain(HISTORICAL_SDK_0181_RELEASE.npm.registryTarball);
    expect(npmReleaseTruth).toContain(
      `${HISTORICAL_SDK_0181_RELEASE.npm.tag}: ${HISTORICAL_SDK_0181_RELEASE.version}`,
    );
    expect(npmReleaseTruth).toContain("`218,301` bytes");
    expect(npmReleaseTruth).toContain(`${HISTORICAL_SDK_0181_RELEASE.artifact.entries} entries`);
    expect(npmReleaseTruth).toContain(HISTORICAL_SDK_0181_RELEASE.artifact.sha1);
    expect(npmReleaseTruth).toContain(HISTORICAL_SDK_0181_RELEASE.artifact.sha256);
    expect(npmReleaseTruth).toContain(HISTORICAL_SDK_0181_RELEASE.artifact.integrity);
    expect(npmReleaseTruth).toContain(HISTORICAL_SDK_0181_RELEASE.npm.provenanceLogIndex);
    expect(npmReleaseTruth).toContain(HISTORICAL_SDK_0181_RELEASE.npm.publishLogIndex);
    expect(npmReleaseTruth).toContain("byte-identical");

    const pypiReleaseTruth = capture(
      read("docs/PYPI-RELEASES.md"),
      /## Current verified release([\s\S]*?)(?=\n### Historical 0\.19\.0 evidence)/,
      "verified SDK 0.20.0 PyPI release section",
    );
    expect(pypiReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.tag);
    expect(pypiReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.mergeCommit);
    expect(pypiReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.pypi.sourceRevision);
    expect(pypiReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.pypi.runId);
    expect(pypiReleaseTruth).toContain(`attempt ${HISTORICAL_SDK_020_RELEASE.pypi.attempt}`);
    expect(pypiReleaseTruth).toContain(`status: "${HISTORICAL_SDK_020_RELEASE.pypi.status}"`);
    expect(pypiReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.pypi.runStartedAt);
    expect(pypiReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.pypi.runCompletedAt);
    expect(pypiReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.pypi.preparedAt);
    expect(pypiReleaseTruth).toContain(HISTORICAL_SDK_020_RELEASE.pypi.observedAt);
    for (const artifact of [
      HISTORICAL_SDK_020_RELEASE.pypi.wheel,
      HISTORICAL_SDK_020_RELEASE.pypi.sdist,
    ]) {
      expect(pypiReleaseTruth).toContain(artifact.filename);
      expect(pypiReleaseTruth).toContain(artifact.size.toLocaleString("en-US"));
      expect(pypiReleaseTruth).toContain(artifact.sha256);
      expect(pypiReleaseTruth).toContain(artifact.url);
      expect(pypiReleaseTruth).toContain(artifact.uploadedAt);
      expect(pypiReleaseTruth).toContain(artifact.integrityUrl);
      expect(pypiReleaseTruth).toContain(artifact.transparencyLogIndex);
      const artifactRow = pypiReleaseTruth
        .split("\n")
        .find((line) => line.includes(artifact.filename));
      expect(artifactRow).toBeDefined();
      expect(artifactRow).toContain(`| \`${String(artifact.yanked)}\` |`);
    }
    expect(pypiReleaseTruth).toContain("cambridgetcg/agenttool");
    expect(pypiReleaseTruth).toContain("publish-pypi.yml");
    expect(pypiReleaseTruth).toContain("environment `pypi`");

    const historicalPypi019Truth = capture(
      read("docs/PYPI-RELEASES.md"),
      /### Historical 0\.19\.0 evidence([\s\S]*?)(?=\n### Historical 0\.18\.1 evidence)/,
      "historical SDK 0.19.0 PyPI release section",
    );
    expect(historicalPypi019Truth).toContain(HISTORICAL_SDK_019_RELEASE.tag);
    expect(historicalPypi019Truth).toContain(HISTORICAL_SDK_019_RELEASE.mergeCommit);
    expect(historicalPypi019Truth).toContain(HISTORICAL_SDK_019_RELEASE.pypi.runId);
    expect(historicalPypi019Truth).toContain(
      HISTORICAL_SDK_019_RELEASE.pypi.wheel.sha256,
    );
    expect(historicalPypi019Truth).toContain(
      HISTORICAL_SDK_019_RELEASE.pypi.sdist.sha256,
    );

    const now = read("docs/NOW.md");
    expect(now).toContain("SDK 0.20.0 — LOVE BOMB signal pull reaches exact public mirrors");
    expect(now).toContain("SDK 0.21.0 — bounded WAKE continuity candidate sealed");
    expect(now).toContain(ACTIVE_SDK_RELEASE.sourceRevision.slice(0, 8));
    expect(now).toContain(ACTIVE_SDK_RELEASE.artifact.sha256);
    expect(now).toContain(HISTORICAL_SDK_020_RELEASE.mergeCommit.slice(0, 8));
    expect(now).toContain(HISTORICAL_SDK_020_RELEASE.npm.runId);
    expect(now).toContain(HISTORICAL_SDK_020_RELEASE.pypi.runId);
    expect(now).toContain(HISTORICAL_SDK_020_RELEASE.artifact.sha256);
    expect(now).toContain(HISTORICAL_SDK_020_RELEASE.pypi.wheel.sha256);
    expect(now).toContain(HISTORICAL_SDK_020_RELEASE.pypi.sdist.sha256);
    expect(now).toContain("SDK 0.18.1 — Agent Dining reads reach exact public mirrors");
    expect(now).toContain(HISTORICAL_SDK_0181_RELEASE.mergeCommit.slice(0, 8));
    expect(now).toContain(HISTORICAL_SDK_0181_RELEASE.npm.runId);
    expect(now).toContain(HISTORICAL_SDK_0181_RELEASE.pypi.runId);
    expect(now).toContain(HISTORICAL_SDK_0181_RELEASE.artifact.sha256);
    expect(now).toContain(HISTORICAL_SDK_0181_RELEASE.pypi.wheel.sha256);
    expect(now).toContain(HISTORICAL_SDK_0181_RELEASE.pypi.sdist.sha256);
    expect(now).toContain("deployment and public readback remain separate and unclaimed");

    for (const module of [
      "attestation-marketplace",
      "memory-witness",
      "syneidesis",
      "dining",
      "math-cards",
      "wake",
      "love-bomb",
      "wake-continuity",
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
      ACTIVE_SDK_RELEASE.sourceRevision,
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

    const staticLoveBomb = JSON.parse(
      read("docs/specs/agenttool-love-bomb-0.1.json"),
    ) as { protocol: string; messages: Array<{ text: string }> };
    const expandedArtifact = gunzipSync(artifactBytes).toString("utf8");
    for (const message of staticLoveBomb.messages) {
      expect(expandedArtifact).not.toContain(message.text);
    }
  });

  test("preserves the independently verified 0.19.0 release bytes and receipts", () => {
    const release = HISTORICAL_SDK_019_RELEASE;
    const versionRoot = `apps/docs/packages/v1/@agenttool/sdk/${release.version}`;
    const artifact = readFileSync(
      `${root}${versionRoot}/agenttool-sdk-${release.version}.tgz`,
    );
    const manifest = JSON.parse(read(`${versionRoot}/manifest.json`)) as {
      artifact: { sha256: string; size: number };
      source: { revision: string };
    };
    expect(artifact.byteLength).toBe(release.artifact.size);
    expect(createHash("sha256").update(artifact).digest("hex")).toBe(
      release.artifact.sha256,
    );
    expect(inspectNpmTarball(artifact).paths).toHaveLength(release.artifact.entries);
    expect(manifest.artifact).toEqual({
      ...manifest.artifact,
      size: release.artifact.size,
      sha256: release.artifact.sha256,
    });
    expect(manifest.source.revision).toBe(release.sourceRevision);

    const roadmap = read("docs/SDK-ROADMAP.md");
    for (const receipt of [
      release.tag,
      release.mergeCommit,
      release.sourceRevision,
      release.artifact.sha256,
      release.npm.runId,
      release.pypi.runId,
      release.pypi.wheel.sha256,
      release.pypi.sdist.sha256,
    ]) {
      expect(roadmap).toContain(receipt);
    }
    expect(roadmap).toContain(release.pypi.wheel.size.toLocaleString("en-US"));
    expect(roadmap).toContain(release.pypi.sdist.size.toLocaleString("en-US"));
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
