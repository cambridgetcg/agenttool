import { expect, test } from "bun:test";
import { closeSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalJson } from "../src/canonical.js";
import { ConstructiveStore } from "../src/store.js";
import { makeBody, makePin } from "./helpers.js";

test("concurrent exact CLI retries create one chain event", async () => {
  const root = join(import.meta.dir, "..");
  const directory = mkdtempSync(join(tmpdir(), "constructive-concurrent-"));
  const database = join(directory, "pilot.sqlite");
  const receiptPath = join(directory, "receipt.json");
  const pin = makePin();
  const setup = new ConstructiveStore(database, { create: true });
  setup.initialize();
  setup.putPin(pin);
  setup.close();
  writeFileSync(receiptPath, canonicalJson(makeBody(pin, "E0")), { mode: 0o600 });

  const command = [
    process.execPath,
    "src/bin.ts",
    "record",
    "--db",
    database,
    "--receipt",
    receiptPath,
  ];
  // Regular files avoid Bun test-runner pipe lifecycle stalls while preserving
  // two genuinely concurrent CLI processes and their exact output bytes.
  const processes = [0, 1].map((index) => {
    const stdoutPath = join(directory, `process-${index}.stdout`);
    const stderrPath = join(directory, `process-${index}.stderr`);
    const stdoutFd = openSync(stdoutPath, "wx", 0o600);
    const stderrFd = openSync(stderrPath, "wx", 0o600);
    return {
      process: Bun.spawn(command, {
        cwd: root,
        stdin: "ignore",
        stdout: stdoutFd,
        stderr: stderrFd,
      }),
      stderrFd,
      stderrPath,
      stdoutFd,
      stdoutPath,
    };
  });
  const exits = await Promise.all(processes.map(({ process }) => process.exited))
    .finally(() => {
      for (const { stderrFd, stdoutFd } of processes) {
        closeSync(stdoutFd);
        closeSync(stderrFd);
      }
    });
  const results = processes.map(({ stderrPath, stdoutPath }, index) => ({
    exit: exits[index],
    stdout: readFileSync(stdoutPath, "utf8"),
    stderr: readFileSync(stderrPath, "utf8"),
  }));
  expect(results.map(({ exit }) => exit)).toEqual([0, 0]);
  expect(results.map(({ stdout }) =>
    JSON.parse(stdout) as { status: string }).map(({ status }) => status).sort())
    .toEqual(["existing", "inserted"]);
  expect(results.every(({ stderr }) => stderr === "")).toBe(true);

  const store = new ConstructiveStore(database, { create: false });
  expect(store.listReceipts(pin.pin_id)).toHaveLength(1);
  expect(store.verify().receipt_count).toBe(1);
  store.close();
});
