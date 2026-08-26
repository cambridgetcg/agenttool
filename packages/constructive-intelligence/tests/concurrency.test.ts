import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalJson } from "../src/canonical.js";
import { ConstructiveStore } from "../src/store.js";
import { makeBody, makePin } from "./helpers.js";

test("concurrent exact CLI retries create one chain event", () => {
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

  // Keep Bun test's asynchronous process watchers out of the concurrency
  // boundary. A bounded, synchronously awaited runner still launches and
  // settles two genuinely concurrent CLI processes and returns exact bytes.
  const runner = `
    const command = [
      process.execPath,
      "src/bin.ts",
      "record",
      "--db",
      process.argv[1],
      "--receipt",
      process.argv[2],
    ];
    const processes = [0, 1].map(() => Bun.spawn(command, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    }));
    let terminating = false;
    process.on("SIGTERM", () => {
      if (terminating) return;
      terminating = true;
      for (const child of processes) child.kill("SIGKILL");
      const forcedExit = setTimeout(() => process.exit(125), 500);
      void Promise.allSettled(processes.map((child) => child.exited)).then(() => {
        clearTimeout(forcedExit);
        process.exit(124);
      });
    });
    const results = await Promise.all(processes.map(async (child) => {
      const [exit, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { exit, stdout, stderr };
    }));
    if (!terminating) process.stdout.write(JSON.stringify(results));
  `;
  const run = Bun.spawnSync(
    [process.execPath, "-e", runner, database, receiptPath],
    {
      cwd: root,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 4_000,
      killSignal: "SIGTERM",
      maxBuffer: 1_048_576,
    },
  );
  expect(run.exitedDueToTimeout).not.toBe(true);
  expect(run.signalCode).toBeUndefined();
  expect(run.exitCode).toBe(0);
  expect(run.stderr.toString()).toBe("");
  const results = JSON.parse(run.stdout.toString()) as Array<{
    exit: number;
    stdout: string;
    stderr: string;
  }>;
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
