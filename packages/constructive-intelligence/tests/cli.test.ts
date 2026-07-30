import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalJson } from "../src/canonical.js";
import { runCli } from "../src/cli.js";
import { createReceiptEnvelope } from "../src/contracts.js";
import { ConstructiveStore } from "../src/store.js";
import { makeBody, makePin } from "./helpers.js";

function capture() {
  let stdout = "";
  let stderr = "";
  return {
    streams: {
      stdout: (text: string) => { stdout += text; },
      stderr: (text: string) => { stderr += text; },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

describe("offline CLI", () => {
  test("requires explicit paths and advertises the non-authoritative boundary", async () => {
    const help = capture();
    expect(await runCli(["--help"], help.streams)).toBe(0);
    expect(help.stdout()).toContain("All paths are explicit");
    expect(help.stdout()).toContain("not discover defaults");
    expect(help.stdout()).toContain("reward eligibility");

    const missing = capture();
    expect(await runCli(["init"], missing.streams)).toBe(2);
    expect(missing.stderr()).toContain("argument_error");
  });

  test("records with optional local artifact verification, then shows, reports, verifies, and exports", async () => {
    const directory = mkdtempSync(join(tmpdir(), "constructive-cli-"));
    const db = join(directory, "pilot.sqlite");
    const receiptPath = join(directory, "receipt.json");
    const artifactPath = join(directory, "artifact.bin");
    const pin = makePin();
    const store = new ConstructiveStore(db, { create: true });
    store.initialize();
    store.putPin(pin);
    store.close();
    const receipt = makeBody(pin, "E0");
    writeFileSync(receiptPath, `${canonicalJson(receipt)}\n`, { mode: 0o600 });
    writeFileSync(artifactPath, "artifact", { mode: 0o600 });

    const recorded = capture();
    expect(await runCli([
      "record",
      "--db", db,
      "--receipt", receiptPath,
      "--artifact", artifactPath,
    ], recorded.streams)).toBe(0);
    expect(recorded.stdout()).toContain('"status":"inserted"');

    const evidenceId = createReceiptEnvelope(receipt).evidence_id;
    for (const [args, needle] of [
      [["show", "--db", db, "--id", evidenceId], evidenceId],
      [["report", "--db", db, "--pin", pin.pin_id], '"highest_contiguous_level":"E0"'],
      [["verify", "--db", db], '"ok":true'],
      [["export", "--db", db], '"structural_only":true'],
    ] as const) {
      const output = capture();
      expect(await runCli(args, output.streams)).toBe(0);
      expect(output.stdout()).toContain(needle);
    }

    writeFileSync(artifactPath, "different", { mode: 0o600 });
    const mismatch = capture();
    expect(await runCli([
      "record",
      "--db", db,
      "--receipt", receiptPath,
      "--artifact", artifactPath,
    ], mismatch.streams)).toBe(2);
    expect(mismatch.stderr()).toContain("do not match");
  });
});
