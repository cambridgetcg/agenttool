import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  DISCOVERY_PATH,
  INDEX_PATH,
  LOVE_PACKAGES,
  LOVE_PACKAGE_PROTOCOL,
  buildLovePackages,
  inspectNpmTarball,
  verifyLovePackages,
  type LovePackageSpec,
} from "../build-love-packages";

const cleanup: string[] = [];
const REPO_ROOT = join(import.meta.dir, "../..");

async function run(command: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(stderr.trim() || stdout.trim() || `${command[0]} exited ${code}`);
}

async function fixture(dependencyFields: Record<string, unknown> = {}): Promise<{
  repoRoot: string;
  spec: LovePackageSpec;
  firstOutput: string;
  secondOutput: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "love-package-test-"));
  cleanup.push(root);
  const repoRoot = join(root, "repo");
  const packageRoot = join(repoRoot, "packages", "data");
  await mkdir(join(packageRoot, "src"), { recursive: true });
  await writeFile(join(repoRoot, ".gitignore"), "dist/\n");
  await writeFile(
    join(packageRoot, "package.json"),
    `${JSON.stringify({
      name: "@agenttool/data",
      version: "0.1.0",
      description: "Fixture LOVE package",
      type: "module",
      main: "dist/index.js",
      files: ["dist"],
      engines: { bun: ">=1.3" },
      repository: { type: "git", url: "https://github.com/cambridgetcg/agenttool.git" },
      ...dependencyFields,
    }, null, 2)}\n`,
  );
  await writeFile(join(packageRoot, "src", "index.ts"), "export const love = true;\n");
  await run(["git", "init", "-q", "-b", "main"], repoRoot);
  await run(["git", "add", "."], repoRoot);
  await run(
    [
      "git",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=LOVE Test",
      "-c",
      "user.email=love@example.invalid",
      "commit",
      "-qm",
      "test: fixture",
    ],
    repoRoot,
  );
  return {
    repoRoot,
    spec: {
      name: "@agenttool/data",
      version: "0.1.0",
      packagePath: "packages/data",
      releaseTag: "data-v0.1.0",
      buildCommands: [["bun", "build", "src/index.ts", "--outdir", "dist", "--target", "bun"]],
    },
    firstOutput: join(root, "first"),
    secondOutput: join(root, "second"),
  };
}

async function fileMap(root: string, relative = ""): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) {
      for (const [nestedPath, bytes] of await fileMap(root, path)) result.set(nestedPath, bytes);
    } else {
      result.set(path, await readFile(join(root, path)));
    }
  }
  return result;
}

afterAll(async () => {
  await Promise.all(cleanup.map((path) => rm(path, { recursive: true, force: true })));
});

describe("LOVE Package release inventory", () => {
  test("pins the current immutable package release batch", () => {
    expect(LOVE_PACKAGE_PROTOCOL).toBe("love-package/v1");
    expect(LOVE_PACKAGES.map(({ name, version, releaseTag }) => ({ name, version, releaseTag }))).toEqual([
      { name: "@agenttool/adds", version: "0.2.2", releaseTag: "adds-v0.2.2" },
      { name: "@agenttool/data", version: "0.3.1", releaseTag: "data-v0.3.1" },
      { name: "@agenttool/data-sync", version: "0.1.1", releaseTag: "data-sync-v0.1.1" },
      { name: "@agenttool/credential-broker", version: "0.1.0", releaseTag: "credential-broker-v0.1.0" },
      { name: "@agenttool/sdk", version: "0.16.3", releaseTag: "sdk-v0.16.3" },
      { name: "@agenttool/wallet", version: "0.1.0", releaseTag: "wallet-v0.1.0" },
      { name: "@agenttool/telescope", version: "0.2.2", releaseTag: "telescope-v0.2.2" },
      { name: "@agenttool/browser", version: "0.2.0", releaseTag: "browser-v0.2.0" },
    ]);
  });

  test("current releases carry their declared Apache-2.0 terms", async () => {
    const canonicalLicense = await readFile(join(REPO_ROOT, "LICENSE"));

    for (const spec of LOVE_PACKAGES) {
      const packageNotice = await readFile(join(REPO_ROOT, spec.packagePath, "NOTICE"));
      const slug = spec.name.slice("@agenttool/".length);
      const releaseRoot = join(
        REPO_ROOT,
        "apps/docs/packages/v1/@agenttool",
        slug,
        spec.version,
      );
      const manifest = JSON.parse(
        await readFile(join(releaseRoot, "manifest.json"), "utf8"),
      ) as {
        artifact: { filename: string };
        license: string | null;
      };
      const archive = inspectNpmTarball(
        await readFile(join(releaseRoot, manifest.artifact.filename)),
      );

      expect(manifest.license, `${spec.name}@${spec.version} manifest`).toBe("Apache-2.0");
      expect(archive.packageJson.license, `${spec.name}@${spec.version} package.json`).toBe(
        "Apache-2.0",
      );
      expect(archive.paths, `${spec.name}@${spec.version} LICENSE`).toContain("package/LICENSE");
      expect(archive.paths, `${spec.name}@${spec.version} NOTICE`).toContain("package/NOTICE");
      expect(archive.legalFiles.license, `${spec.name}@${spec.version} LICENSE bytes`).toEqual(
        canonicalLicense,
      );
      expect(archive.legalFiles.notice, `${spec.name}@${spec.version} NOTICE bytes`).toEqual(
        packageNotice,
      );
      expect(await readFile(join(REPO_ROOT, spec.packagePath, "LICENSE"))).toEqual(
        canonicalLicense,
      );
    }
  });

  test("covers every published manifest and artifact with two stable header rules", async () => {
    const headers = await readFile(join(REPO_ROOT, "apps/docs/_headers"), "utf8");
    const manifestRoute = "/packages/v1/@agenttool/:package/:version/manifest.json";
    const artifactRoute = "/packages/v1/@agenttool/:package/:version/*.tgz";
    const manifestPathPattern = /^\/packages\/v1\/@agenttool\/[^/]+\/[^/]+\/manifest\.json$/;
    // Cloudflare's one splat is greedy (including "/"); package and version
    // stay segment-bounded by named placeholders.
    const artifactPathPattern = /^\/packages\/v1\/@agenttool\/[^/]+\/[^/]+\/.*\.tgz$/;

    expect(headers).toContain(
      [
        manifestRoute,
        "  Content-Type: application/json; charset=utf-8",
        "  Cache-Control: public, max-age=300, must-revalidate",
        "  Access-Control-Allow-Origin: *",
        "  X-Content-Type-Options: nosniff",
      ].join("\n"),
    );
    expect(headers).toContain(
      [
        artifactRoute,
        "  Content-Type: application/gzip",
        "  Cache-Control: public, max-age=31536000, immutable",
        "  Access-Control-Allow-Origin: *",
        "  X-Content-Type-Options: nosniff",
      ].join("\n"),
    );

    const packageRules = headers
      .split("\n")
      .filter((line) => line.startsWith("/packages/v1/@agenttool/"));
    expect(packageRules).toEqual([manifestRoute, artifactRoute]);

    const index = JSON.parse(
      await readFile(join(REPO_ROOT, "apps/docs/packages/v1/index.json"), "utf8"),
    ) as {
      packages: Array<{
        versions: Array<{ manifest_url: string }>;
      }>;
    };
    for (const packageEntry of index.packages) {
      for (const release of packageEntry.versions) {
        const manifestUrl = new URL(release.manifest_url);
        expect(manifestUrl.origin).toBe("https://docs.agenttool.dev");
        expect(manifestUrl.pathname).toMatch(manifestPathPattern);

        const manifestPath = join(
          REPO_ROOT,
          "apps/docs",
          decodeURIComponent(manifestUrl.pathname).slice(1),
        );
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
          artifact: {
            filename: string;
            mirrors: Array<{ url: string }>;
          };
        };
        const artifactUrl = new URL(
          manifest.artifact.mirrors.find(({ url }) => (
            new URL(url).origin === "https://docs.agenttool.dev"
          ))?.url ?? "",
        );
        expect(artifactUrl.pathname).toMatch(artifactPathPattern);
        expect(artifactUrl.pathname.endsWith(`/${manifest.artifact.filename}`)).toBe(true);
        expect(
          await Bun.file(
            join(REPO_ROOT, "apps/docs", decodeURIComponent(artifactUrl.pathname).slice(1)),
          ).exists(),
        ).toBe(true);
      }
    }

    expect(manifestPathPattern.test("/packages/v1/@agenttool/data/manifest.json")).toBe(false);
    expect(manifestPathPattern.test("/packages/v1/other/data/0.1.0/manifest.json")).toBe(false);
    expect(artifactPathPattern.test("/packages/v1/@agenttool/data/0.1.0/manifest.json")).toBe(false);
    expect(artifactPathPattern.test("/packages/v1/@agenttool/data/0.1.0/package.zip")).toBe(false);
  });
});

describe("LOVE Package builder and verifier", () => {
  test("builds a deterministic static mirror and detects tampering", async () => {
    const setup = await fixture();
    const common = { repoRoot: setup.repoRoot, packages: [setup.spec] };
    await buildLovePackages({ ...common, outputRoot: setup.firstOutput });
    await verifyLovePackages({ ...common, outputRoot: setup.firstOutput });
    await buildLovePackages({ ...common, outputRoot: setup.secondOutput });
    await verifyLovePackages({ ...common, outputRoot: setup.secondOutput });

    const first = await fileMap(setup.firstOutput);
    const second = await fileMap(setup.secondOutput);
    expect([...first.keys()].sort()).toEqual([...second.keys()].sort());
    for (const [path, bytes] of first) expect(second.get(path)).toEqual(bytes);

    const discovery = JSON.parse((await readFile(join(setup.firstOutput, DISCOVERY_PATH.slice(1)))).toString());
    expect(discovery).toEqual({
      protocol: "love-package/v1",
      doctrine: "https://docs.agenttool.dev/LOVE-PACKAGE-PROTOCOL.md",
      index_url: "https://docs.agenttool.dev/packages/v1/index.json",
      access: "public_read",
      registry_role: "mirror_index_not_authority",
      registry_mirrors: [
        {
          ecosystem: "npm",
          registry_url: "https://registry.npmjs.org/",
          authority: false,
        },
      ],
    });
    const index = JSON.parse((await readFile(join(setup.firstOutput, INDEX_PATH.slice(1)))).toString());
    expect(index.document_type).toBe("package-index");
    expect(index.packages[0].versions[0].manifest_url).toBe(
      "https://docs.agenttool.dev/packages/v1/@agenttool/data/0.1.0/manifest.json",
    );

    const versionRoot = join(setup.firstOutput, "packages/v1/@agenttool/data/0.1.0");
    const artifactPath = join(versionRoot, "agenttool-data-0.1.0.tgz");
    const artifact = await readFile(artifactPath);
    const contents = inspectNpmTarball(artifact);
    expect(contents.paths).toContain("package/package.json");
    expect(contents.paths).toContain("package/dist/index.js");
    expect(contents.sizes["package/package.json"]).toBeGreaterThan(0);
    expect(contents.paths.some((path) => path.startsWith("package/src/"))).toBe(false);
    expect(contents.paths.some((path) => path.startsWith("package/node_modules/"))).toBe(false);

    const manifest = JSON.parse(await readFile(join(versionRoot, "manifest.json"), "utf8"));
    expect(manifest.document_type).toBe("package-manifest");
    expect(manifest.artifact.sha256).toBe(createHash("sha256").update(artifact).digest("hex"));
    expect(manifest.artifact.size).toBe(artifact.byteLength);
    expect(manifest.artifact.mirrors).toEqual([
      { url: "https://docs.agenttool.dev/packages/v1/@agenttool/data/0.1.0/agenttool-data-0.1.0.tgz" },
      {
        url: "https://github.com/cambridgetcg/agenttool/releases/download/data-v0.1.0/agenttool-data-0.1.0.tgz",
      },
    ]);
    expect(manifest.install).toEqual({
      format: "npm-tarball",
      specifier: "https://docs.agenttool.dev/packages/v1/@agenttool/data/0.1.0/agenttool-data-0.1.0.tgz",
    });
    expect(manifest.dependency_resolution).toEqual({ mode: "package_manifest", self_contained: true });

    const unindexed = join(setup.firstOutput, "packages/v1/@agenttool/data/9.9.9");
    await mkdir(unindexed, { recursive: true });
    await writeFile(join(unindexed, "unindexed.tgz"), "not indexed\n");
    await expect(verifyLovePackages({ ...common, outputRoot: setup.firstOutput })).rejects.toThrow(
      "registry tree does not exactly match its index",
    );
    await rm(unindexed, { recursive: true, force: true });
    await verifyLovePackages({ ...common, outputRoot: setup.firstOutput });

    artifact[artifact.byteLength - 16] ^= 1;
    await writeFile(artifactPath, artifact);
    await expect(verifyLovePackages({ ...common, outputRoot: setup.firstOutput })).rejects.toThrow();
  });

  test("checks raw artifact size and digest before parsing an archive", async () => {
    const setup = await fixture();
    const options = { repoRoot: setup.repoRoot, outputRoot: setup.firstOutput, packages: [setup.spec] };
    await buildLovePackages(options);
    const artifactPath = join(
      setup.firstOutput,
      "packages/v1/@agenttool/data/0.1.0/agenttool-data-0.1.0.tgz",
    );
    const original = await readFile(artifactPath);

    await writeFile(artifactPath, Buffer.alloc(original.byteLength, 0x41));
    await expect(verifyLovePackages(options)).rejects.toThrow(
      "artifact sha256 mismatch before archive inspection",
    );

    await writeFile(artifactPath, "not a gzip stream\n");
    await expect(verifyLovePackages(options)).rejects.toThrow(
      "artifact size mismatch before archive inspection",
    );
  });

  test("refuses dirty tracked source and release version drift", async () => {
    const setup = await fixture();
    const options = { repoRoot: setup.repoRoot, outputRoot: setup.firstOutput, packages: [setup.spec] };
    await writeFile(join(setup.repoRoot, "packages/data/src/index.ts"), "export const love = false;\n");
    await expect(buildLovePackages(options)).rejects.toThrow("tracked worktree is dirty");

    await writeFile(join(setup.repoRoot, "packages/data/src/index.ts"), "export const love = true;\n");
    await expect(
      buildLovePackages({
        ...options,
        packages: [{ ...setup.spec, version: "9.9.9", releaseTag: "data-v9.9.9" }],
      }),
    ).rejects.toThrow("expected release version 9.9.9");
  });

  test("refuses untracked package source and build-time source mutation", async () => {
    const untracked = await fixture();
    await writeFile(join(untracked.repoRoot, "packages/data/src/untracked.ts"), "export {};\n");
    await expect(
      buildLovePackages({
        repoRoot: untracked.repoRoot,
        outputRoot: untracked.firstOutput,
        packages: [untracked.spec],
      }),
    ).rejects.toThrow("package source contains untracked or dirty files");

    const mutated = await fixture();
    const mutation = {
      ...mutated.spec,
      buildCommands: [
        [
          "bun",
          "-e",
          "await Bun.write('src/index.ts', 'export const love = false;\\n')",
        ],
      ],
    } satisfies LovePackageSpec;
    await expect(
      buildLovePackages({
        repoRoot: mutated.repoRoot,
        outputRoot: mutated.firstOutput,
        packages: [mutation],
      }),
    ).rejects.toThrow("tracked worktree is dirty");
  });

  test("does not call optional or peer-dependent artifacts self-contained", async () => {
    const setup = await fixture({
      optionalDependencies: { optional: "1.0.0" },
      peerDependencies: { peer: "1.0.0" },
    });
    await buildLovePackages({
      repoRoot: setup.repoRoot,
      outputRoot: setup.firstOutput,
      packages: [setup.spec],
    });
    const manifest = JSON.parse(
      await readFile(
        join(setup.firstOutput, "packages/v1/@agenttool/data/0.1.0/manifest.json"),
        "utf8",
      ),
    );
    expect(manifest.dependency_resolution).toEqual({ mode: "package_manifest", self_contained: false });
  });

  test("verifies and preserves indexed releases while appending a mixed inventory", async () => {
    const setup = await fixture();
    const oldOptions = { repoRoot: setup.repoRoot, outputRoot: setup.firstOutput, packages: [setup.spec] };
    await buildLovePackages(oldOptions);
    const oldArtifactPath = join(
      setup.firstOutput,
      "packages/v1/@agenttool/data/0.1.0/agenttool-data-0.1.0.tgz",
    );
    const oldManifestPath = join(
      setup.firstOutput,
      "packages/v1/@agenttool/data/0.1.0/manifest.json",
    );
    const oldArtifact = await readFile(oldArtifactPath);
    const oldManifest = await readFile(oldManifestPath);

    const packageJsonPath = join(setup.repoRoot, "packages/data/package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    packageJson.version = "0.2.0";
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
    await writeFile(join(setup.repoRoot, "packages/data/src/index.ts"), "export const love = 'v2';\n");
    await run(["git", "add", "packages/data"], setup.repoRoot);
    await run(
      [
        "git",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=LOVE Test",
        "-c",
        "user.email=love@example.invalid",
        "commit",
        "-qm",
        "test: v0.2.0",
      ],
      setup.repoRoot,
    );
    const nextSpec = { ...setup.spec, version: "0.2.0", releaseTag: "data-v0.2.0" };
    const indexedSpec = {
      ...setup.spec,
      buildCommands: [["bun", "-e", "process.exit(91)"]],
    } satisfies LovePackageSpec;
    const nextOptions = { ...oldOptions, packages: [indexedSpec, nextSpec] };

    const tamperedArtifact = Buffer.from(oldArtifact);
    tamperedArtifact[tamperedArtifact.byteLength - 16] ^= 1;
    await writeFile(oldArtifactPath, tamperedArtifact);
    await expect(buildLovePackages(nextOptions)).rejects.toThrow(
      "artifact sha256 mismatch before archive inspection",
    );
    await writeFile(oldArtifactPath, oldArtifact);

    await buildLovePackages(nextOptions);
    await verifyLovePackages(nextOptions);

    expect(await readFile(oldArtifactPath)).toEqual(oldArtifact);
    expect(await readFile(oldManifestPath)).toEqual(oldManifest);
    const index = JSON.parse(await readFile(join(setup.firstOutput, INDEX_PATH.slice(1)), "utf8"));
    expect(index.packages).toHaveLength(1);
    expect(index.packages[0].latest).toBe("0.2.0");
    expect(index.packages[0].versions.map((item: { version: string }) => item.version)).toEqual([
      "0.1.0",
      "0.2.0",
    ]);
    const newArtifactPath = join(
      setup.firstOutput,
      "packages/v1/@agenttool/data/0.2.0/agenttool-data-0.2.0.tgz",
    );
    const newManifestPath = join(
      setup.firstOutput,
      "packages/v1/@agenttool/data/0.2.0/manifest.json",
    );
    const newArtifact = await readFile(newArtifactPath);
    const newManifest = await readFile(newManifestPath);

    await writeFile(join(setup.repoRoot, "packages/data/src/index.ts"), "export const love = 'changed';\n");
    await run(["git", "add", "packages/data/src/index.ts"], setup.repoRoot);
    await run(
      [
        "git",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=LOVE Test",
        "-c",
        "user.email=love@example.invalid",
        "commit",
        "-qm",
        "test: conflicting bytes",
      ],
      setup.repoRoot,
    );
    await buildLovePackages(nextOptions);
    await verifyLovePackages(nextOptions);
    expect(await readFile(oldArtifactPath)).toEqual(oldArtifact);
    expect(await readFile(oldManifestPath)).toEqual(oldManifest);
    expect(await readFile(newArtifactPath)).toEqual(newArtifact);
    expect(await readFile(newManifestPath)).toEqual(newManifest);
  });

  test("rejects unsafe or ambiguous custom release inputs", async () => {
    const setup = await fixture();
    await expect(
      buildLovePackages({
        repoRoot: setup.repoRoot,
        outputRoot: setup.firstOutput,
        packages: [{ ...setup.spec, packagePath: "../outside" }],
      }),
    ).rejects.toThrow("safe repository-relative path");
    await expect(
      buildLovePackages({
        repoRoot: setup.repoRoot,
        outputRoot: setup.firstOutput,
        packages: [setup.spec, { ...setup.spec }],
      }),
    ).rejects.toThrow("duplicate LOVE Package release");
    await expect(
      buildLovePackages({
        repoRoot: setup.repoRoot,
        outputRoot: setup.firstOutput,
        packages: [setup.spec],
        primaryOrigin: "https://user:secret@example.com",
      }),
    ).rejects.toThrow("credential-free HTTPS URL");
  });
});
