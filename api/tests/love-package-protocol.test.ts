/** love-package/v1 — schema, example, and cross-field protocol checks. */

import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import indexSchema from "../../docs/specs/love-package-index-v1.schema.json";
import manifestSchema from "../../docs/specs/love-package-v1.schema.json";

const ajv = new Ajv2020({ strict: true });
addFormats(ajv);
const validateManifestSchema = ajv.compile(manifestSchema);
const validateIndexSchema = ajv.compile(indexSchema);

function manifest() {
  const primary =
    "https://docs.agenttool.dev/packages/v1/@agenttool/data/0.1.0/agenttool-data-0.1.0.tgz";

  return {
    protocol: "love-package/v1",
    document_type: "package-manifest",
    name: "@agenttool/data",
    version: "0.1.0",
    description: "Local-first reference node for agent-data/v1",
    license: null as string | null,
    artifact: {
      format: "npm-tarball",
      filename: "agenttool-data-0.1.0.tgz",
      sha256:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      size: 18_742,
      media_type: "application/gzip",
      mirrors: [
        { url: primary },
        { url: "https://mirror.example/agenttool-data-0.1.0.tgz" },
      ],
    },
    runtime: {
      kind: "javascript",
      engines: { bun: ">=1.3" },
    },
    install: {
      format: "npm-tarball",
      specifier: primary,
    },
    source: {
      repository: "https://github.com/cambridgetcg/agenttool.git",
      revision: "0123456789abcdef0123456789abcdef01234567",
      path: "packages/data",
    },
    dependency_resolution: {
      mode: "package_manifest",
      self_contained: true,
    },
  };
}

function conforms(value: ReturnType<typeof manifest>): boolean {
  if (!validateManifestSchema(value)) return false;
  const mirrorUrls = value.artifact.mirrors.map((mirror) => mirror.url);
  return (
    new Set(mirrorUrls).size === mirrorUrls.length &&
    mirrorUrls.includes(value.install.specifier)
  );
}

function archiveMetadataConforms(
  value: ReturnType<typeof manifest>,
  packed: { name: string; version: string; paths: string[] },
): boolean {
  const packageJsonCount = packed.paths.filter(
    (path) => path === "package/package.json",
  ).length;
  const safePaths = packed.paths.every((path) => {
    if (path === "package") return true;
    if (!path.startsWith("package/") || path.includes("\\")) return false;
    const segments = path.split("/");
    return segments.every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    );
  });
  return (
    conforms(value) &&
    packed.name === value.name &&
    packed.version === value.version &&
    packageJsonCount === 1 &&
    new Set(packed.paths).size === packed.paths.length &&
    safePaths
  );
}

function indexDocument() {
  return {
    protocol: "love-package/v1",
    document_type: "package-index",
    packages: [
      {
        name: "@agenttool/data",
        latest: "0.1.0",
        versions: [
          {
            version: "0.1.0",
            manifest_url:
              "https://docs.agenttool.dev/packages/v1/@agenttool/data/0.1.0/manifest.json",
          },
        ],
      },
    ],
  };
}

function indexConforms(value: ReturnType<typeof indexDocument>): boolean {
  if (!validateIndexSchema(value)) return false;
  const packageNames = value.packages.map((entry) => entry.name);
  if (new Set(packageNames).size !== packageNames.length) return false;
  return value.packages.every((entry) => {
    const versions = entry.versions.map((item) => item.version);
    return (
      new Set(versions).size === versions.length &&
      versions.includes(entry.latest)
    );
  });
}

describe("love-package/v1 manifest", () => {
  test("is valid Draft 2020-12 and accepts the normative example", () => {
    expect(ajv.validateSchema(manifestSchema)).toBe(true);
    const value = manifest();
    expect(
      validateManifestSchema(value),
      JSON.stringify(validateManifestSchema.errors),
    ).toBe(true);
    expect(conforms(value)).toBe(true);
  });

  test("requires a document discriminator", () => {
    const value = manifest() as Record<string, unknown>;
    delete value.document_type;
    expect(validateManifestSchema(value)).toBe(false);

    const wrongKind = manifest();
    wrongKind.document_type = "package-index";
    expect(validateManifestSchema(wrongKind)).toBe(false);
  });

  test("requires explicit nullable licensing, runtime, install, and source metadata", () => {
    const licensed = manifest();
    licensed.license = "Apache-2.0";
    expect(validateManifestSchema(licensed)).toBe(true);

    for (const field of ["license", "runtime", "install", "source"] as const) {
      const value = manifest() as Record<string, unknown>;
      delete value[field];
      expect(validateManifestSchema(value)).toBe(false);
    }

    const unknownEngines = manifest();
    unknownEngines.runtime.engines = {};
    expect(validateManifestSchema(unknownEngines)).toBe(true);

    const unknownDependencies = manifest() as Record<string, unknown>;
    delete unknownDependencies.dependency_resolution;
    expect(validateManifestSchema(unknownDependencies)).toBe(true);
  });

  test("pins exact lowercase SHA-256 identity and public artifact metadata", () => {
    const uppercaseHash = manifest();
    uppercaseHash.artifact.sha256 = uppercaseHash.artifact.sha256.toUpperCase();
    expect(validateManifestSchema(uppercaseHash)).toBe(false);

    const fractionalSize = manifest();
    fractionalSize.artifact.size = 10.5;
    expect(validateManifestSchema(fractionalSize)).toBe(false);

    const noMirrors = manifest();
    noMirrors.artifact.mirrors = [];
    expect(validateManifestSchema(noMirrors)).toBe(false);

    const relativeInstall = manifest();
    relativeInstall.install.specifier = "./agenttool-data-0.1.0.tgz";
    expect(validateManifestSchema(relativeInstall)).toBe(false);

    const wrongMediaType = manifest();
    wrongMediaType.artifact.media_type = "application/octet-stream";
    expect(validateManifestSchema(wrongMediaType)).toBe(false);
  });

  test("rejects ambiguous or credential-bearing artifact URLs", () => {
    const userinfo = manifest();
    userinfo.artifact.mirrors[0].url =
      "https://user:secret@docs.agenttool.dev/package.tgz";
    expect(validateManifestSchema(userinfo)).toBe(false);

    const fragment = manifest();
    fragment.install.specifier =
      "https://docs.agenttool.dev/package.tgz#different-client-label";
    expect(validateManifestSchema(fragment)).toBe(false);

    const query = manifest();
    query.artifact.mirrors[1].url =
      "https://mirror.example/package.tgz?immutable=1";
    expect(validateManifestSchema(query)).toBe(true);
  });

  test("requires safe tarball filenames and normalized source paths", () => {
    for (const filename of ["../package.tgz", "evil\nname.tgz", "package.zip"]) {
      const value = manifest();
      value.artifact.filename = filename;
      expect(validateManifestSchema(value)).toBe(false);
    }

    for (const path of ["../data", "packages/../data", "/packages/data", "packages\\data", "packages//data"]) {
      const value = manifest();
      value.source.path = path;
      expect(validateManifestSchema(value)).toBe(false);
    }

    const repositoryRoot = manifest();
    repositoryRoot.source.path = ".";
    expect(validateManifestSchema(repositoryRoot)).toBe(true);

    const buildMetadata = manifest();
    buildMetadata.artifact.filename = "agenttool-data-1.0.0+build.7.tgz";
    expect(validateManifestSchema(buildMetadata)).toBe(true);
  });

  test("uses Semantic Versioning 2.0.0 labels without making them identity", () => {
    const prerelease = manifest();
    prerelease.version = "1.0.0-rc.1+build.7";
    expect(validateManifestSchema(prerelease)).toBe(true);

    const leadingZero = manifest();
    leadingZero.version = "1.0.0-01";
    expect(validateManifestSchema(leadingZero)).toBe(false);
  });

  test("requires the install specifier to select one declared mirror", () => {
    const value = manifest();
    value.install.specifier = "https://undeclared.example/package.tgz";

    // JSON Schema cannot express membership in a sibling array. The normative
    // protocol cross-field rule supplies the remaining check.
    expect(validateManifestSchema(value)).toBe(true);
    expect(conforms(value)).toBe(false);
  });

  test("requires mirror uniqueness by URL, not whole mirror object", () => {
    const value = manifest();
    value.artifact.mirrors[1] = {
      url: value.artifact.mirrors[0].url,
      region: "duplicate-with-different-extension",
    } as (typeof value.artifact.mirrors)[number];

    expect(validateManifestSchema(value)).toBe(true);
    expect(conforms(value)).toBe(false);
  });

  test("binds package identity and the normalized-path cross-field subset", () => {
    const value = manifest();
    const packed = {
      name: value.name,
      version: value.version,
      paths: ["package", "package/package.json", "package/dist/index.js"],
    };
    // Entry type, mode, and resource-cap checks require tar headers/bytes and
    // belong to the reference release verifier; this helper pins the protocol
    // rules expressible from expanded package metadata alone.
    expect(archiveMetadataConforms(value, packed)).toBe(true);
    expect(
      archiveMetadataConforms(value, { ...packed, name: "@other/data" }),
    ).toBe(false);
    expect(
      archiveMetadataConforms(value, {
        ...packed,
        paths: ["package/package.json", "package/../../escape"],
      }),
    ).toBe(false);
    expect(
      archiveMetadataConforms(value, {
        ...packed,
        paths: ["package/package.json", "package/dist/index.js", "package/dist/index.js"],
      }),
    ).toBe(false);
  });

  test("accepts unknown fields at every object depth for forward compatibility", () => {
    const value = manifest() as ReturnType<typeof manifest> & {
      future_root?: unknown;
    };
    value.future_root = { profile: "love-package/v1+future" };
    Object.assign(value.artifact, { future_digest: { algorithm: "sha512" } });
    Object.assign(value.artifact.mirrors[0], { region: "global" });
    Object.assign(value.runtime, { abi: ["arm64", "x86_64"] });
    Object.assign(value.install, { integrity_cache: true });
    Object.assign(value.source, { build_recipe: "future-profile" });
    Object.assign(value.dependency_resolution, { cache_policy: "local-first" });

    expect(
      validateManifestSchema(value),
      JSON.stringify(validateManifestSchema.errors),
    ).toBe(true);
    expect(conforms(value)).toBe(true);
  });

  test("does not require or define a publisher signature", () => {
    expect("signature" in manifestSchema.properties).toBe(false);
    expect("publisher" in manifestSchema.properties).toBe(false);
    expect(validateManifestSchema(manifest())).toBe(true);
  });
});

describe("love-package/v1 package index", () => {
  test("has a separate valid schema and document discriminator", () => {
    expect(ajv.validateSchema(indexSchema)).toBe(true);
    const value = indexDocument();
    expect(
      validateIndexSchema(value),
      JSON.stringify(validateIndexSchema.errors),
    ).toBe(true);
    expect(indexConforms(value)).toBe(true);

    const missingKind = indexDocument() as Record<string, unknown>;
    delete missingKind.document_type;
    expect(validateIndexSchema(missingKind)).toBe(false);
  });

  test("requires unique package/version labels and latest membership", () => {
    const duplicatePackage = indexDocument();
    duplicatePackage.packages.push(structuredClone(duplicatePackage.packages[0]));
    expect(validateIndexSchema(duplicatePackage)).toBe(true);
    expect(indexConforms(duplicatePackage)).toBe(false);

    const duplicateVersion = indexDocument();
    duplicateVersion.packages[0].versions.push({
      ...duplicateVersion.packages[0].versions[0],
      manifest_url: "https://mirror.example/duplicate-manifest.json",
    });
    expect(validateIndexSchema(duplicateVersion)).toBe(true);
    expect(indexConforms(duplicateVersion)).toBe(false);

    const missingLatest = indexDocument();
    missingLatest.packages[0].latest = "9.9.9";
    expect(validateIndexSchema(missingLatest)).toBe(true);
    expect(indexConforms(missingLatest)).toBe(false);
  });

  test("rejects manifest locators with userinfo or fragments", () => {
    for (const manifestUrl of [
      "https://user@example.com/manifest.json",
      "https://example.com/manifest.json#alternate",
    ]) {
      const value = indexDocument();
      value.packages[0].versions[0].manifest_url = manifestUrl;
      expect(validateIndexSchema(value)).toBe(false);
    }
  });

  test("accepts unknown index fields recursively", () => {
    const value = indexDocument() as ReturnType<typeof indexDocument> & {
      generated_by?: unknown;
    };
    value.generated_by = { tool: "future-builder" };
    Object.assign(value.packages[0], { summary: "future field" });
    Object.assign(value.packages[0].versions[0], { mirrors_known: 2 });
    expect(validateIndexSchema(value)).toBe(true);
    expect(indexConforms(value)).toBe(true);
  });
});
