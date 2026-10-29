import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollabStore } from "../src/store.js";

// The person desk opens a store per call, and YOUI may make several calls at
// once. Opening must wait for a concurrent opener instead of failing its
// preflight read with "database is locked".

let directory: string;
let databasePath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-open-"));
  const root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "collab.sqlite");
  const store = new CollabStore(databasePath);
  const author = store.startSession({ root_path: root, actor: "author" });
  const peer = store.startSession({ root_path: root, actor: "peer" });
  for (let index = 0; index < 5; index += 1) {
    const proposal = store.openProposalForSession({
      ...author.credential,
      idempotency_key: `open-${index}`,
      question: `Proposal ${index}?`,
      criteria: "Fill the journal.",
      extent: "Tests only.",
    });
    store.appendReportForSession({
      ...peer.credential,
      idempotency_key: `support-${index}`,
      kind: "inference",
      body: "Yes.",
      relation: "supports",
      target_report_id: proposal.proposal.id,
    });
  }
  store.close();
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("concurrent store opens", () => {
  test("eight processes opening one populated journal at once all succeed", async () => {
    const worker = join(import.meta.dir, "open-worker.ts");
    for (let round = 0; round < 3; round += 1) {
      const startAt = String(Date.now() + 300);
      const results = await Promise.all(Array.from({ length: 8 }, async () => {
        const child = Bun.spawn([process.execPath, worker, databasePath, startAt], { stdout: "pipe", stderr: "pipe" });
        const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
        expect(exitCode).toBe(0);
        return JSON.parse(stdout) as { ok: boolean; message?: string };
      }));
      expect(results.filter((result) => !result.ok)).toEqual([]);
    }
  }, 30_000);
});
