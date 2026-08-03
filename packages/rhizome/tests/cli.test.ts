/** CLI surface: human report, --json, per-probe selection, and exit codes. */

import { expect, test } from "bun:test";

import { runCli, type CliIo } from "../src/cli.js";
import { PACKAGE_VERSION } from "../src/constants.js";
import { probeIds } from "../src/registry.js";

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) }, out, err };
}

test("--help and --version answer without touching the tree", async () => {
  const help = capture();
  expect(await runCli(["--help"], help.io)).toBe(0);
  expect(help.out.join("")).toContain("read-only soil report");

  const version = capture();
  expect(await runCli(["--version"], version.io)).toBe(0);
  expect(version.out.join("")).toBe(`${PACKAGE_VERSION}\n`);
});

test("--list names every registered probe and its question", async () => {
  const { io, out } = capture();
  expect(await runCli(["--list"], io)).toBe(0);
  for (const id of probeIds()) expect(out.join("")).toContain(id);
});

test("--json emits a stable, sorted report", async () => {
  const { io, out } = capture();
  expect(await runCli(["--json", "--probe", "scope"], io)).toBe(0);
  const report = JSON.parse(out.join(""));
  expect(report.tool).toBe("@agenttool/rhizome");
  expect(report.probes.map((probe: { id: string }) => probe.id)).toEqual(["scope"]);
  expect(report.scope.derivations.length).toBe(2);
  expect(Object.keys(report.counts).sort()).toEqual(["gap", "limit", "sound"]);
  for (const finding of report.findings) {
    expect(finding.probe).toBe("scope");
    expect(typeof finding.evidence).toBe("string");
    expect(["gap", "sound", "limit"]).toContain(finding.verdict);
  }
});

test("an unknown probe is refused, and the known ids are named", async () => {
  const { io, err } = capture();
  expect(await runCli(["--probe", "nope"], io)).toBe(2);
  expect(err.join("")).toContain("registered:");
});

test("an unknown option is refused rather than ignored", async () => {
  const { io, err } = capture();
  expect(await runCli(["--everything"], io)).toBe(2);
  expect(err.join("")).toContain("unknown option");
});

test("the human report is exit 0 with gaps present, and 1 only when asked", async () => {
  const plain = capture();
  expect(await runCli(["--probe", "edge"], plain.io)).toBe(0);
  expect(plain.out.join("")).toContain("rhizome reports. It does not fix, and it is not a gate.");

  const gated = capture();
  expect(await runCli(["--probe", "edge", "--fail-on-gap"], gated.io)).toBe(1);
});
