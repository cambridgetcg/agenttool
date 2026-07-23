import { afterEach, describe, expect, test } from "bun:test";
import { chmod, lstat, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlAuditSink } from "../src/index.js";

const roots: string[] = [];

async function secureTempDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentcred-audit-"));
  roots.push(root);
  await chmod(root, 0o700);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("owner-only JSONL audit", () => {
  test("creates and writes through an owner-only file handle", async () => {
    const root = await secureTempDirectory();
    const path = join(root, "audit.jsonl");
    const sink = new JsonlAuditSink(path);
    await sink.open();
    await sink.record({
      auditId: "audit-test",
      at: new Date(0).toISOString(),
      sessionId: "session-test",
      event: "grant.denied",
      outcome: "denied",
      reasonCode: "test",
    });
    await sink.close();

    expect((await lstat(path)).mode & 0o777).toBe(0o600);
  });

  test("refuses a symlink audit path", async () => {
    const root = await secureTempDirectory();
    const target = join(root, "target.jsonl");
    const path = join(root, "audit.jsonl");
    await writeFile(target, "", { mode: 0o600 });
    await symlink(target, path);

    const sink = new JsonlAuditSink(path);
    await expect(sink.open()).rejects.toMatchObject({ code: "network_denied" });
  });
});
