import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { verifyNpmTarballFile } from "../src/archive.js";
import { buildLoveActions, buildNpmAction, shellQuote } from "../src/plans.js";
import type { ParsedLoveManifest } from "../src/parsers/love.js";
import { verifyArtifact, verifyArtifactFile } from "../src/verify.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agenttool-telescope-test-"));
  roots.push(root);
  return root;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function tarEntry(
  path: string,
  body: Uint8Array,
  type = "0",
  mode = 0o644,
): Buffer {
  const header = Buffer.alloc(512);
  header.write(path, 0, 100, "utf8");
  header.write(`${mode.toString(8).padStart(7, "0")}\0`, 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(
    `${body.byteLength.toString(8).padStart(11, "0")}\0`,
    124,
    12,
    "ascii",
  );
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  const padding = Buffer.alloc((512 - (body.byteLength % 512)) % 512);
  return Buffer.concat([header, body, padding]);
}

function npmTarball(
  input: {
    name?: string;
    version?: string;
    extra?: Array<{
      path: string;
      body?: Uint8Array;
      type?: string;
      mode?: number;
    }>;
    corrupt_checksum?: boolean;
  } = {},
): Uint8Array {
  const packageJson = new TextEncoder().encode(
    JSON.stringify({
      name: input.name ?? "@agenttool/sdk",
      version: input.version ?? "0.13.0",
      scripts: { postinstall: "must remain disabled" },
    }),
  );
  const raw = Buffer.concat([
    tarEntry("package/package.json", packageJson),
    ...(input.extra ?? []).map((entry) =>
      tarEntry(
        entry.path,
        entry.body ?? new Uint8Array(),
        entry.type,
        entry.mode,
      ),
    ),
    Buffer.alloc(1024),
  ]);
  if (input.corrupt_checksum) raw[0] = raw[0] === 0x70 ? 0x71 : 0x70;
  return gzipSync(raw);
}

function manifestFor(
  bytes: Uint8Array,
  filename = "agenttool-sdk-0.13.0.tgz",
): ParsedLoveManifest {
  return {
    name: "@agenttool/sdk",
    version: "0.13.0",
    artifact: {
      filename,
      sha256: digest(bytes),
      size: bytes.byteLength,
      mirrors: ["https://packages.example/agenttool-sdk-0.13.0.tgz"],
    },
    dependency_self_contained: false,
  };
}

async function run(
  executable: string,
  argv: readonly string[],
  cwd?: string,
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const process = Bun.spawn([executable, ...argv], {
    ...(cwd ? { cwd } : {}),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { exit, stdout, stderr };
}

describe("shell-safe, non-automatic action plans", () => {
  test("quotes a hostile value as one inert POSIX-shell argument", async () => {
    const root = await temporaryRoot();
    const marker = join(root, "injection-ran");
    const payload = `safe'; touch '${marker}'; printf 'owned $(id) ${"`uname`"}`;
    const quoted = shellQuote(payload);

    expect(shellQuote("https://agenttool.dev/path:a,b")).toBe(
      "https://agenttool.dev/path:a,b",
    );
    expect(shellQuote("")).toBe("''");
    expect(quoted).toContain(`'\"'\"'`);

    const result = await run("/bin/sh", ["-c", `printf '%s' ${quoted}`]);
    expect(result.exit).toBe(0);
    expect(result.stdout).toBe(payload);
    expect(result.stderr).toBe("");
    expect(await Bun.file(marker).exists()).toBe(false);
  });

  test("keeps npm input in structured argv and labels npm as convenience", () => {
    const normal = buildNpmAction({
      package_name: "@agenttool/sdk",
      version: "0.13.0",
      evidence_ids: ["pathways"],
    });
    expect(normal).toMatchObject({
      id: "npm_install",
      kind: "npm_convenience",
      executable: "npm",
      argv: [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--save-exact",
        "@agenttool/sdk@0.13.0",
      ],
      display:
        "npm install --ignore-scripts --no-audit --no-fund --save-exact @agenttool/sdk@0.13.0",
      automatic: false,
      requires_explicit_consent: true,
      evidence_ids: ["pathways"],
    });
    expect(normal.boundary_codes).toContain("npm_declared_non_authoritative");
    expect(normal.boundary_codes).toContain(
      "npm_skips_independent_love_size_sha256_check",
    );
    expect(normal.boundary_codes).toContain(
      "package_manager_may_use_configured_registry_credentials",
    );
    expect(normal.boundary_codes).toContain("command_not_executed");

    const hostile = buildNpmAction({
      package_name: "@agenttool/sdk; touch /tmp/telescope-nope",
      version: "0.13.0",
      evidence_ids: ["pathways"],
    });
    expect(hostile.argv).toEqual([
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--save-exact",
      "@agenttool/sdk; touch /tmp/telescope-nope@0.13.0",
    ]);
    expect(hostile.display).toBe(
      "npm install --ignore-scripts --no-audit --no-fund --save-exact '@agenttool/sdk; touch /tmp/telescope-nope@0.13.0'",
    );
  });

  test("builds an ordered download, exact verification, then local install plan", async () => {
    const root = await temporaryRoot();
    const marker = join(root, "query-was-executed");
    const bytes = new TextEncoder().encode("verified package bytes");
    const manifest = manifestFor(bytes);
    const mirror = `https://packages.example/sdk.tgz?next=$(touch ${marker})`;
    const actions = buildLoveActions({
      manifest,
      mirror_url: mirror,
      evidence_ids: ["love_sdk_manifest"],
    });

    expect(actions.map((action) => action.id)).toEqual([
      "love_download",
      "love_verify",
      "love_install",
    ]);
    expect(actions.every((action) => action.automatic === false)).toBe(true);
    expect(actions.every((action) => action.display_shell === "posix")).toBe(
      true,
    );
    expect(
      actions.every((action) => action.requires_explicit_consent === true),
    ).toBe(true);
    expect(
      actions.every((action) =>
        action.boundary_codes.includes("command_not_executed"),
      ),
    ).toBe(true);

    const [download, verify, install] = actions;
    expect(download).toBeDefined();
    expect(verify).toBeDefined();
    expect(install).toBeDefined();
    if (!download || !verify || !install) return;

    expect(download.executable).toBe("node");
    expect(download.argv.slice(0, 2)).toEqual([
      "--input-type=module",
      "--eval",
    ]);
    expect(download.argv[2]).toContain("open(temporary,'wx',0o600)");
    expect(download.argv[2]).toContain("link(temporary,file)");
    expect(download.argv[2]).toContain("redirect:'manual'");
    expect(download.argv[2]).toContain("AbortSignal.timeout(120000)");
    expect(download.argv[2]).toContain("if(created)await unlink(temporary)");
    expect(download.argv.slice(-3)).toEqual([
      mirror,
      manifest.artifact.filename,
      String(manifest.artifact.size),
    ]);
    expect(download.display).toContain(`'${mirror}'`);
    expect(download.boundary_codes).toContain("redirects_not_followed");
    expect(download.boundary_codes).toContain(
      "generated_network_deadline_120_seconds",
    );
    const refused = await run(download.executable, download.argv, root);
    expect(refused).toEqual({
      exit: 1,
      stdout: "",
      stderr: "download failed\n",
    });
    expect(await Bun.file(marker).exists()).toBe(false);
    expect(await readdir(root)).toEqual([]);

    expect(verify.executable).toBe("agenttool-telescope");
    expect(verify.argv).toEqual([
      "verify-package",
      manifest.artifact.filename,
      "--size",
      String(manifest.artifact.size),
      "--sha256",
      manifest.artifact.sha256,
      "--name",
      manifest.name,
      "--version",
      manifest.version,
    ]);
    expect(verify.boundary_codes).toContain(
      "checks_exact_local_file_size_and_sha256",
    );

    expect(install.executable).toBe("npm");
    expect(install.argv).toEqual([
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `./${manifest.artifact.filename}`,
    ]);
    expect(install.boundary_codes).toContain(
      "install_only_after_local_verification",
    );
    expect(install.boundary_codes).toContain(
      "package_manager_may_use_configured_registry_credentials",
    );
  });
});

describe("artifact verification", () => {
  test("reports exact bytes and SHA-256 without treating a mismatch as success", () => {
    const bytes = new TextEncoder().encode("artifact contents");
    const expected = { size: bytes.byteLength, sha256: digest(bytes) };

    expect(verifyArtifact(bytes, expected)).toEqual({
      ok: true,
      expected,
      actual: expected,
    });
    expect(
      verifyArtifact(bytes, { ...expected, size: expected.size + 1 }),
    ).toMatchObject({ ok: false, actual: expected });
    expect(
      verifyArtifact(bytes, { ...expected, sha256: "0".repeat(64) }),
    ).toMatchObject({ ok: false, actual: expected });
  });

  test("rejects malformed verification expectations", () => {
    const bytes = new Uint8Array();
    expect(() =>
      verifyArtifact(bytes, { size: -1, sha256: "0".repeat(64) }),
    ).toThrow("Expected size and lowercase SHA-256 must be valid");
    expect(() =>
      verifyArtifact(bytes, { size: 0, sha256: "A".repeat(64) }),
    ).toThrow("Expected size and lowercase SHA-256 must be valid");
  });

  test("streams a local file and returns both expected and observed commitments", async () => {
    const root = await temporaryRoot();
    const path = join(root, "artifact.tgz");
    const bytes = new TextEncoder().encode("streamed artifact bytes");
    await writeFile(path, bytes);
    const expected = { size: bytes.byteLength, sha256: digest(bytes) };

    expect(await verifyArtifactFile(path, expected)).toEqual({
      ok: true,
      expected,
      actual: expected,
    });
    expect(
      await verifyArtifactFile(path, { ...expected, size: expected.size + 1 }),
    ).toMatchObject({ ok: false, actual: expected });
  });

  test("the generated package verification plan inspects identity and fails tampering", async () => {
    const root = await temporaryRoot();
    const bytes = npmTarball();
    const manifest = manifestFor(bytes, "release.tgz");
    const path = join(root, manifest.artifact.filename);
    await writeFile(path, bytes);

    const verify = buildLoveActions({
      manifest,
      mirror_url: manifest.artifact.mirrors[0]!,
      evidence_ids: ["love_sdk_manifest"],
    }).find((action) => action.id === "love_verify");
    expect(verify).toBeDefined();
    if (!verify) return;

    const cliPath = join(import.meta.dir, "../src/cli.ts");
    const exact = await run("bun", [cliPath, ...verify.argv], root);
    expect(exact.exit).toBe(0);
    expect(exact.stdout).toContain("verified npm tarball release.tgz");
    expect(exact.stderr).toBe("");

    await writeFile(path, new TextEncoder().encode("tampered artifact bytes"));
    const tampered = await run("bun", [cliPath, ...verify.argv], root);
    expect(tampered.exit).toBe(1);
    expect(tampered.stdout).toContain("npm tarball verification failed");
  });

  test("rejects unsafe tar structure and embedded identity drift", async () => {
    const root = await temporaryRoot();
    for (const [label, bytes, expectedCode] of [
      [
        "identity",
        npmTarball({ name: "@agenttool/not-sdk" }),
        "embedded_package_identity_mismatch",
      ],
      [
        "traversal",
        npmTarball({
          extra: [{ path: "package/../escape", body: new Uint8Array([1]) }],
        }),
        "invalid_or_unsupported_npm_tarball",
      ],
      [
        "symlink",
        npmTarball({ extra: [{ path: "package/link", type: "2" }] }),
        "invalid_or_unsupported_npm_tarball",
      ],
      [
        "portable collision",
        npmTarball({
          extra: [
            {
              path: "package/PACKAGE.JSON",
              body: new TextEncoder().encode("{}"),
            },
          ],
        }),
        "invalid_or_unsupported_npm_tarball",
      ],
      [
        "Windows drive path",
        npmTarball({ extra: [{ path: "package/C:/evil" }] }),
        "invalid_or_unsupported_npm_tarball",
      ],
      [
        "regular package root",
        npmTarball({ extra: [{ path: "package" }] }),
        "invalid_or_unsupported_npm_tarball",
      ],
      [
        "setuid mode",
        npmTarball({ extra: [{ path: "package/tool", mode: 0o4755 }] }),
        "invalid_or_unsupported_npm_tarball",
      ],
      [
        "trailing slash",
        npmTarball({ extra: [{ path: "package/slashy/", type: "5" }] }),
        "invalid_or_unsupported_npm_tarball",
      ],
      [
        "path depth",
        npmTarball({
          extra: [
            {
              path: `package/${Array.from({ length: 31 }, () => "a").join("/")}/file`,
            },
          ],
        }),
        "invalid_or_unsupported_npm_tarball",
      ],
      [
        "checksum",
        npmTarball({ corrupt_checksum: true }),
        "invalid_or_unsupported_npm_tarball",
      ],
    ] as const) {
      const path = join(root, `${label}.tgz`);
      await writeFile(path, bytes);
      const result = await verifyNpmTarballFile(path, {
        size: bytes.byteLength,
        sha256: digest(bytes),
        name: "@agenttool/sdk",
        version: "0.13.0",
      });
      expect(result.code, label).toBe(expectedCode);
      expect(result.ok, label).toBe(false);
    }
  });

  test("reports embedded lifecycle scripts while binding a valid npm tarball", async () => {
    const root = await temporaryRoot();
    const bytes = npmTarball();
    const path = join(root, "valid.tgz");
    await writeFile(path, bytes);
    const result = await verifyNpmTarballFile(path, {
      size: bytes.byteLength,
      sha256: digest(bytes),
      name: "@agenttool/sdk",
      version: "0.13.0",
    });
    expect(result).toMatchObject({
      ok: true,
      code: "verified_npm_tarball",
      archive: {
        package_name: "@agenttool/sdk",
        package_version: "0.13.0",
        install_lifecycle_scripts_present: true,
      },
    });
    await expect(
      verifyNpmTarballFile(path, {
        size: -1,
        sha256: "A".repeat(64),
        name: "@agenttool/sdk",
        version: "0.13.0",
      }),
    ).rejects.toThrow("must fit Telescope's verifier limits");
  });
});
