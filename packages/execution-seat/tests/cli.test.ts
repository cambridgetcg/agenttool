import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../bin/agenttool-execution-seat.js";
import { CLAUDE_SESSION, expectNoMarkers, writeClaudeProject, writeCodexSessions } from "./fixtures.js";

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "execution-seat-cli-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function cli(...args: string[]): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const code = run(["--home", join(directory, "state"), ...args], { stdout: (t) => (out += t), stderr: (t) => (err += t) }, {});
  return { code, out, err };
}

test("ingests, finds, lists and shows seats as JSON without native free text", () => {
  const transcript = writeClaudeProject(directory);
  const paths = writeCodexSessions(join(directory, "codex"));
  const ingested = cli("ingest", "claude", transcript);
  expect(ingested.code).toBe(0);
  expect(cli("ingest", "codex", paths.root, paths.child, paths.fork).code).toBe(0);
  const seatId = JSON.parse(ingested.out)[0].seat_id as string;
  const found = cli("find", "claude-code", CLAUDE_SESSION);
  expect(JSON.parse(found.out).seat_id).toBe(seatId);
  const listed = JSON.parse(cli("list", "--limit", "10").out);
  expect(listed.seats.length).toBe(4);
  const groups = JSON.parse(cli("groups", seatId).out);
  expect(groups).toEqual([expect.objectContaining({ kind: "workflow", members: 3 })]);
  const shown = cli("show", seatId);
  const all = [ingested.out, found.out, shown.out, cli("group", groups[0].group_id).out].join("\n");
  expect(expectNoMarkers(all)).toEqual([]);
});

test("binding and promotion follow the identity rules", () => {
  const seatId = JSON.parse(cli("ingest", "claude", writeClaudeProject(directory)).out)[0].seat_id as string;
  expect(cli("bind", seatId, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee").code).toBe(0);
  const child = JSON.parse(cli("promote", seatId, "aplain01").out);
  expect(child.identity_id).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  const refused = cli("bind", child.seat_id, "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff");
  expect(refused.code).toBe(1);
  expect(JSON.parse(refused.err).error).toBe("child_inherits_identity");
});

test("explains itself and rejects unknown commands", () => {
  const help = cli("--help");
  expect(help.code).toBe(0);
  for (const phrase of ["structural fields only", "a seat grants nothing", "AGENTTOOL_EXECUTION_SEAT_HOME"]) {
    expect(help.out).toContain(phrase);
  }
  expect(cli("nonsense").code).toBe(64);
  expect(cli("show", "not-a-seat").code).toBe(1);
});
