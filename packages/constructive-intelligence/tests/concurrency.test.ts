import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
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
  const processes = [Bun.spawn(command, { cwd: root, stdout: "pipe", stderr: "pipe" }),
    Bun.spawn(command, { cwd: root, stdout: "pipe", stderr: "pipe" })];
  const results = await Promise.all(processes.map(async (process) => ({
    exit: await process.exited,
    stdout: await new Response(process.stdout).text(),
    stderr: await new Response(process.stderr).text(),
  })));
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
