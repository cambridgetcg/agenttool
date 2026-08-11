import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.js";
import { AGENTTOOL_CARD_SOURCE } from "./fixtures.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agenttool-kingdom-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function captureIo(): {
  stdout: string[];
  stderr: string[];
  io: { stdout: (text: string) => void; stderr: (text: string) => void };
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    },
  };
}

describe("explicit-file read-only CLI", () => {
  test("returns 0 for a valid file without modifying it or its directory", async () => {
    const directory = await fixtureDirectory();
    const cardPath = join(directory, "kingdom.yaml");
    await writeFile(cardPath, AGENTTOOL_CARD_SOURCE, "utf8");
    const beforeStat = await stat(cardPath);
    const beforeEntries = await readdir(directory);
    const capture = captureIo();

    const exitCode = await runCli(["validate", cardPath], capture.io);

    expect(exitCode).toBe(0);
    expect(capture.stdout.join("")).toBe("KINGDOM card is valid.\n");
    expect(capture.stderr).toEqual([]);
    expect(await readFile(cardPath, "utf8")).toBe(AGENTTOOL_CARD_SOURCE);
    expect(await readdir(directory)).toEqual(beforeEntries);
    const afterStat = await stat(cardPath);
    expect(afterStat.size).toBe(beforeStat.size);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
  });

  test("returns 1 with redacted findings and stable path-free JSON", async () => {
    const directory = await fixtureDirectory();
    const cardPath = join(directory, "kingdom.yaml");
    const rejected = "private-value-that-must-not-leak";
    await writeFile(
      cardPath,
      AGENTTOOL_CARD_SOURCE.replace("kind: infra", `kind: ${rejected}`),
      "utf8",
    );
    const textCapture = captureIo();
    const textExit = await runCli(["validate", cardPath], textCapture.io);
    expect(textExit).toBe(1);
    expect(textCapture.stderr.join("")).toContain("invalid-enum");
    expect(textCapture.stderr.join("")).not.toContain(rejected);
    expect(textCapture.stderr.join("")).not.toContain(directory);

    const jsonCapture = captureIo();
    const jsonExit = await runCli(
      ["validate", cardPath, "--json"],
      jsonCapture.io,
    );
    expect(jsonExit).toBe(1);
    const report = JSON.parse(jsonCapture.stdout.join("")) as {
      valid: boolean;
      card: unknown;
      diagnostics: unknown[];
    };
    expect(report.valid).toBe(false);
    expect(report.card).toBeNull();
    expect(report.diagnostics.length).toBeGreaterThan(0);
    expect(jsonCapture.stdout.join("")).not.toContain(rejected);
    expect(jsonCapture.stdout.join("")).not.toContain(directory);
  });

  test("returns 2 for implicit, unreadable, directory, and malformed usage", async () => {
    const directory = await fixtureDirectory();
    const capture = captureIo();

    expect(await runCli([], capture.io)).toBe(2);
    expect(await runCli(["validate"], capture.io)).toBe(2);
    expect(
      await runCli(["validate", join(directory, "missing.yaml")], capture.io),
    ).toBe(2);
    expect(await runCli(["validate", directory], capture.io)).toBe(2);
    expect(
      await runCli(["validate", "card.yaml", "--json", "extra"], capture.io),
    ).toBe(2);
    expect(capture.stderr.join("")).not.toContain(directory);
  });

  test("reports help and version without touching a filesystem target", async () => {
    const help = captureIo();
    expect(await runCli(["--help"], help.io)).toBe(0);
    expect(help.stdout.join("")).toContain("explicit-file");
    expect(help.stdout.join("")).toContain("does not scan");

    const version = captureIo();
    expect(await runCli(["--version"], version.io)).toBe(0);
    expect(version.stdout.join("")).toBe("0.1.1\n");
  });
});
