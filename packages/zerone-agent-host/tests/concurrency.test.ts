import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixture, LegacyGenericTestHostStore as ZeroneAgentHostStore, TIME } from "./helpers.js";

test("concurrent processes can acquire only one account sequence fence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zerone-host-concurrency-"));
  const database = join(directory, "host.sqlite");
  const values = fixture();
  const setup = new ZeroneAgentHostStore(database, { create: true });
  setup.initialize();
  setup.putBindingHead(values.proof, values.currentness, { expected: null, updated_at: TIME });
  setup.close();

  const commands = ["operation-a", "operation-b"].map((operationId) => Bun.spawn([
    process.execPath,
    "tests/reserve-worker.ts",
    database,
    operationId,
  ], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  }));
  const results = await Promise.all(commands.map(async (process) => ({
    exit: await process.exited,
    stdout: await new Response(process.stdout).text(),
    stderr: await new Response(process.stderr).text(),
  })));
  expect(results.map(({ exit }) => exit)).toEqual([0, 0]);
  expect(results.every(({ stderr }) => stderr === "")).toBeTrue();
  const outputs = results.map(({ stdout }) => JSON.parse(stdout) as {
    status: "reserved" | "denied";
    code?: string;
  });
  expect(outputs.map(({ status }) => status).sort()).toEqual(["denied", "reserved"]);
  expect(outputs.find(({ status }) => status === "denied")?.code).toBe("sequence_fenced");

  const reopened = new ZeroneAgentHostStore(database, { create: false });
  reopened.initialize();
  expect(reopened.verify()).toMatchObject({
    operation_count: 1,
    held_sequence_fence_count: 1,
  });
  reopened.close();
});
