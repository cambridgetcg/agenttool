import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOST_BINDING_FORMAT, hostBindingPath, readHostBindings, writeHostBinding } from "../src/host-binding.js";
import { PROCESS_TABLE_PS_ENV, readProcessTable } from "../src/process-tree.js";

// The identifiers a host process is known by, and the form each is compared
// in. Host wiring outside this package compares the same strings, so these
// pins fail here before they can fail there.
let directory: string;
let databasePath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-host-identifiers-"));
  mkdirSync(join(directory, "state"), { mode: 0o700 });
  databasePath = join(directory, "state", "collab.sqlite");
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("host identifiers", () => {
  test("the process table is read in local time: ps runs with no TZ", () => {
    // The cause, which holds on every machine: where local time is UTC the
    // output below cannot tell the two apart.
    expect(Object.keys(PROCESS_TABLE_PS_ENV).sort()).toEqual(["LC_ALL", "PATH"]);
    expect(PROCESS_TABLE_PS_ENV.LC_ALL).toBe("C");

    // The effect: host_started_at is what a plain local-time ps prints, spaces collapsed.
    const own = readProcessTable()?.get(process.pid);
    const { TZ: _zone, ...environment } = process.env;
    const local = execFileSync("/bin/ps", ["-o", "lstart=", "-p", String(process.pid)], {
      encoding: "utf8",
      env: { ...environment, LC_ALL: "C" },
    }).trim().replace(/\s+/g, " ");
    expect(own?.started_at).toBe(local);
  });

  test("a host binding from a newer build is still read, by its eight known keys", () => {
    const sessionId = "session_00000000-0000-4000-8000-000000000001";
    const known = {
      format: HOST_BINDING_FORMAT,
      session_id: sessionId,
      host_kind: "claude-code" as const,
      host_pid: 4100,
      host_started_at: "Fri Oct 9 10:00:00 2026",
      mcp_pid: 4101,
      credential_file_path: join(directory, "state", "collab-sessions", `${sessionId}.json`),
      written_at: "2026-10-09T10:00:05.000Z",
    };
    writeHostBinding(databasePath, known);
    // Another line may add keys to the same /1 file; readers here ignore them.
    writeFileSync(
      hostBindingPath(databasePath, sessionId),
      JSON.stringify({ ...known, x_future: "a key this build does not know" }),
      { mode: 0o600 },
    );
    expect(readHostBindings(databasePath)).toEqual([known]);
  });
});
