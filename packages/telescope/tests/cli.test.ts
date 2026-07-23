import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCli } from "../src/cli-core.js";
import { TOOL_VERSION } from "../src/constants.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function capture() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: {
        write: (value: string | Uint8Array) => (
          (stdout += String(value)),
          true
        ),
      },
      stderr: {
        write: (value: string | Uint8Array) => (
          (stderr += String(value)),
          true
        ),
      },
    },
    output: () => ({ stdout, stderr }),
  };
}

describe("CLI", () => {
  test("prints help and release version without network work", async () => {
    const help = capture();
    expect(await runCli(["--help"], help.io)).toBe(0);
    expect(help.output().stdout).toContain(
      "read-only agent discovery evidence mapper",
    );
    expect(help.output().stdout).toContain("never invokes protocols");
    expect(help.output().stderr).toBe("");

    const version = capture();
    expect(await runCli(["--version"], version.io)).toBe(0);
    expect(version.output()).toEqual({
      stdout: `${TOOL_VERSION}\n`,
      stderr: "",
    });
  });

  test("rejects unsafe targets with usage exit 2", async () => {
    const output = capture();
    expect(await runCli(["scan", "http://example.com"], output.io)).toBe(2);
    expect(output.output().stdout).toBe("");
    expect(output.output().stderr).toContain("public HTTPS origins only");
  });

  test("escapes terminal controls in human usage errors", async () => {
    const output = capture();
    expect(
      await runCli(["scan", "example.com", "--bad\u001b[2Joption"], output.io),
    ).toBe(2);
    expect(output.output().stderr).not.toContain("\u001b");
    expect(output.output().stderr).toContain("\\u001b[2Joption");
  });

  test("emits a single JSON error document in JSON mode", async () => {
    const output = capture();
    expect(
      await runCli(["scan", "https://example.com/path", "--json"], output.io),
    ).toBe(2);
    expect(output.output().stderr).toBe("");
    const parsed = JSON.parse(output.output().stdout) as {
      error: { code: string; message: string };
    };
    expect(parsed.error.code).toBe("origin_required");
  });

  test("streams local verification and reports tampering", async () => {
    const directory = await mkdtemp(join(tmpdir(), "telescope-cli-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "artifact.tgz");
    const bytes = new TextEncoder().encode("fixture artifact bytes");
    await writeFile(path, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    const valid = capture();
    expect(
      await runCli(
        [
          "verify",
          path,
          "--size",
          String(bytes.byteLength),
          "--sha256",
          sha256,
        ],
        valid.io,
      ),
    ).toBe(0);
    expect(valid.output().stdout).toContain("verified");

    const invalid = capture();
    expect(
      await runCli(
        [
          "verify",
          path,
          "--size",
          String(bytes.byteLength + 1),
          "--sha256",
          sha256,
          "--json",
        ],
        invalid.io,
      ),
    ).toBe(1);
    const result = JSON.parse(invalid.output().stdout) as { ok: boolean };
    expect(result.ok).toBe(false);
    expect(invalid.output().stderr).toBe("");
  });

  test("does not echo filesystem exception details", async () => {
    const output = capture();
    const secretLookingPath = "/missing/private/token-value.tgz";
    expect(
      await runCli(
        [
          "verify",
          secretLookingPath,
          "--size",
          "1",
          "--sha256",
          "a".repeat(64),
          "--json",
        ],
        output.io,
      ),
    ).toBe(1);
    expect(output.output().stdout).not.toContain(secretLookingPath);
    expect(output.output().stdout).toContain("operation_failed");
  });
});
