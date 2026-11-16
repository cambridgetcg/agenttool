import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doorbellScan, runCollabHostCli } from "../src/host.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { CollabStore } from "../src/store-notes.js";

// Ending outranks rest, and a host's exit is an end. `end --seat-ref` is what
// a host runs for a process that is exiting or gone (the execution-seat hook
// runs it when Claude Code exits). A session that process held is ended even
// if it had declared a rest: the household doorbell wakes a Claude seat only
// while its process lives, so a rest left standing there could never be
// answered, and its senders would be told a wake that cannot happen.
let directory: string;
let root: string;
let databasePath: string;
let store: CollabStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-rest-seat-end-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  store = new CollabStore(databasePath);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function seated(actor: string, seatRef: string) {
  const handle = store.startSession({ root_path: root, actor, seat_ref: seatRef });
  const file = writeSessionCredentialFile(store.defaultSessionCredentialPath(handle.session.id), handle.credential);
  return { handle, file };
}

describe("a host's exit and a declared rest", () => {
  test("end --seat-ref ends a resting session, whether or not it asked to be woken", () => {
    const asked = seated("rests-and-asks", "run:exiting");
    const quiet = seated("rests-quietly", "run:exiting");
    const sender = store.startSession({ root_path: root, actor: "sender" });
    store.restSessionForSession({ ...asked.handle.credential, idempotency_key: "rest-asked", mode: "resting", wake_on: ["addressed"] });
    store.restSessionForSession({ ...quiet.handle.credential, idempotency_key: "rest-quiet", mode: "resting" });
    store.appendReportForSession({
      ...sender.credential, idempotency_key: "to-asked", kind: "observation", body: "for the one that asked",
      to_session_id: asked.handle.session.id,
    });
    expect(doorbellScan(databasePath).sessions.map((session) => session.session_id)).toEqual([asked.handle.session.id]);

    const run = runCollabHostCli(["end", "--seat-ref", "run:exiting", "--reason", "host exit", "--db", databasePath], {});
    expect(run.exit_code).toBe(0);
    const receipt = JSON.parse(run.line!) as { sessions: Array<{ session_id: string; status: string }> };
    expect(receipt.sessions.map((session) => session.status)).toEqual(["ended", "ended"]);
    for (const { handle, file } of [asked, quiet]) {
      expect(store.getCoordinationSession(handle.session.id)).toMatchObject({ status: "ended", liveness: "ended", rest: null });
      expect(existsSync(file)).toBe(false);
    }
    // Nothing is left for a doorbell to wake, and a later sender reads the truth.
    expect(doorbellScan(databasePath).sessions).toEqual([]);
    expect(store.addresseeHint(sender.workspace.id, asked.handle.session.id)).toMatchObject({ liveness: "ended", delivery: "none" });
  });
});
