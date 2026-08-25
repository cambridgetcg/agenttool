import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json";
import cardSchema from "../schema/agenttool-kingdom-card-v0.1.schema.json";
import registrySchema from "../schema/agenttool-kingdom-registry-v0.1.schema.json";

const packageRoot = join(import.meta.dir, "..");

describe("publishable package boundary", () => {
  test("pins XENIA exactly and publishes compiled code, schemas, and legal files only", () => {
    expect(packageJson.name).toBe("@agenttool/kingdom");
    expect(packageJson.version).toBe("0.1.2");
    expect(packageJson.dependencies).toEqual({
      "@agenttool/xenia": "0.1.0-beta.7",
    });
    expect(packageJson.engines.node).toBe(">=22");
    expect(packageJson.files).toEqual([
      "dist",
      "schema",
      "README.md",
      "LICENSE",
      "NOTICE",
      "THIRD_PARTY_LICENSES",
    ]);
    expect(packageJson.files).not.toContain("src");
    expect(packageJson.files).not.toContain("tests");
    expect(packageJson.bin).toEqual({
      "agenttool-kingdom": "dist/bin.js",
    });
    expect(packageJson.exports["./card.schema.json"].default).toBe(
      "./schema/agenttool-kingdom-card-v0.1.schema.json",
    );
    expect(packageJson.exports["./registry.schema.json"].default).toBe(
      "./schema/agenttool-kingdom-registry-v0.1.schema.json",
    );
    expect(cardSchema.$id).toBe("urn:agenttool:kingdom:card:v0.1");
    expect(registrySchema.$id).toBe("urn:agenttool:kingdom:registry:v0.1");
  });

  test("documents the independent KINGDOM-OS compatibility and rights boundaries", async () => {
    const readme = await readFile(join(packageRoot, "README.md"), "utf8");
    expect(readme).toContain(
      "independently written compatibility implementation",
    );
    expect(readme).toContain("No KINGDOM-OS implementation code");
    expect(readme).toMatch(
      /compatibility facts, not a claim to\s+relicense/,
    );
    expect(readme).toContain("does not carry a root software license");
    expect(readme).toContain("Rights and permissions remain distinct");

    const sourceFiles = [
      "src/card.ts",
      "src/registry.ts",
      "src/surface.ts",
      "src/constants.ts",
    ];
    const source = (
      await Promise.all(
        sourceFiles.map((path) => readFile(join(packageRoot, path), "utf8")),
      )
    ).join("\n");
    expect(source).not.toContain("/Users/");
    expect(source).not.toContain("KINGDOM-OS/bin");
  });

  test("compiled ESM imports under Node and exposes the expected public API", async () => {
    const child = Bun.spawn(
      [
        "node",
        "--input-type=module",
        "--eval",
        `import("./dist/index.js").then((m) => {
          const expected = [
            "buildKingdomRegistry",
            "createKingdomSurfaceManifest",
            "encodeKingdomRegistry",
            "parseKingdomCard",
            "stringifyKingdomRegistry",
            "validateKingdomCard"
          ];
          if (!expected.every((name) => typeof m[name] === "function")) process.exit(1);
        })`,
      ],
      {
        cwd: packageRoot,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("packed archive contains no source, tests, lockfile, local paths, or credential signatures", async () => {
    const packDirectory = await mkdtemp(
      join(tmpdir(), "agenttool-kingdom-pack-"),
    );
    try {
      const child = Bun.spawn(
        [
          "npm",
          "pack",
          "--json",
          "--ignore-scripts",
          "--pack-destination",
          packDirectory,
        ],
        {
          cwd: packageRoot,
          env: {
            ...process.env,
            npm_config_userconfig: "/dev/null",
          },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(exitCode, stderr).toBe(0);
      const output = JSON.parse(stdout) as Array<{
        filename: string;
        files: Array<{ path: string }>;
      }>;
      const packed = output[0];
      const files = packed?.files.map(({ path }) => path) ?? [];

      expect(files).toContain("dist/index.js");
      expect(files).toContain(
        "schema/agenttool-kingdom-card-v0.1.schema.json",
      );
      expect(files).toContain(
        "schema/agenttool-kingdom-registry-v0.1.schema.json",
      );
      expect(files).toContain("LICENSE");
      expect(files).toContain("NOTICE");
      expect(files).toContain("THIRD_PARTY_LICENSES");
      expect(
        files.some(
          (path) =>
            path.startsWith("src/") ||
            path.startsWith("tests/") ||
            path.includes("node_modules") ||
            path === "bun.lock",
        ),
      ).toBe(false);

      expect(packed?.filename).toBe("agenttool-kingdom-0.1.2.tgz");
      const artifact = join(packDirectory, packed!.filename);
      const textEntries = files
        .filter((path) =>
          /(?:^|\/)(?:LICENSE|NOTICE|THIRD_PARTY_LICENSES)$|\.(?:d\.ts|js|json|map|md)$/i.test(
            path,
          ),
        )
        .map((path) => `package/${path}`);
      const extract = Bun.spawn(
        ["tar", "-xOzf", artifact, ...textEntries],
        {
          cwd: packageRoot,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [extractExit, archiveText, extractError] = await Promise.all([
        extract.exited,
        new Response(extract.stdout).text(),
        new Response(extract.stderr).text(),
      ]);
      expect(extractExit, extractError).toBe(0);
      expect(archiveText).not.toMatch(/(?:file:\/\/)?\/Users\//i);
      expect(archiveText).not.toMatch(/(?:file:\/\/)?\/home\/[^/\s]+\//i);
      expect(archiveText).not.toMatch(/[A-Z]:\\Users\\/i);
      expect(archiveText).not.toMatch(
        /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/,
      );
      expect(archiveText).not.toMatch(/\bAKIA[0-9A-Z]{16}\b/);
      expect(archiveText).not.toMatch(/\bgh[pousr]_[A-Za-z0-9]{36,}\b/);
      expect(archiveText).not.toMatch(/\bnpm_[A-Za-z0-9]{36,}\b/);
    } finally {
      await rm(packDirectory, { recursive: true, force: true });
    }
  });
});
