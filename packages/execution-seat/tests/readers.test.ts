import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readClaudeSession, readClaudeTranscript } from "../src/claude-code.js";
import { readCodexRollout } from "../src/codex.js";
import {
  CLAUDE_NEXT,
  CLAUDE_SESSION,
  CODEX_CHILD,
  CODEX_ROOT,
  CODEX_TURN_A,
  expectNoMarkers,
  PHASES,
  writeClaudeProject,
  writeCodexSessions,
} from "./fixtures.js";

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "execution-seat-readers-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("Claude Code reader", () => {
  test("keeps the session id across model and effort changes and records each change once", () => {
    const session = readClaudeSession(writeClaudeProject(directory));
    expect(session.session_id).toBe(CLAUDE_SESSION);
    expect(session.transcript.session_id).toBe(CLAUDE_SESSION);
    expect(session.transcript.version).toBe("2.1.302");
    expect(session.transcript.started_at).toBe("2026-10-17T09:00:00.000Z");
    expect(session.transcript.last_at).toBe("2026-10-17T09:04:00.000Z");
    expect(session.transcript.continued_in).toBe(CLAUDE_NEXT);
    expect(session.transcript.settings.map((entry) => [entry.model, entry.effort, entry.evidence?.thinking_drop ?? null])).toEqual([
      ["claude-opus-5-5", "xhigh", null],
      ["gpt-6-astra", "high", "model_mismatch"],
      ["claude-opus-5-5", "xhigh", null],
    ]);
    // Provider is never inferred from the harness.
    expect(session.transcript.settings.every((entry) => entry.provider === null && entry.basis === "transcript")).toBe(true);
  });

  test("reads children and workflow members as structure only, and a run's short phase titles", () => {
    const session = readClaudeSession(writeClaudeProject(directory));
    // The over-long and path-like phases are dropped; labels and a member's own phase are never read.
    expect(session.workflow_runs).toEqual([{ run_id: "wf_run0001-abc", phases: [...PHASES] }]);
    const byId = Object.fromEntries(session.children.map((child) => [child.agent_id, child]));
    expect(byId.aplain01).toMatchObject({ workflow_run_id: null, depth: 1, agent_type: "general-purpose", end_state: "result" });
    expect(byId.anested02).toMatchObject({ parent_agent_id: "aplain01", depth: 2, end_state: "unknown" });
    expect(byId.awfok01).toMatchObject({ workflow_run_id: "wf_run0001-abc", end_state: "result" });
    expect(byId.awffail02?.end_state).toBe("failed");
    expect(byId.awfopen03?.end_state).toBe("unknown");
    expect(byId.aplain01?.settings[0]).toMatchObject({ model: "claude-sonnet-5-5", effort: "high" });
    expect(expectNoMarkers(JSON.stringify(session))).toEqual([]);
  });

  test("refuses a symlinked transcript and an unrecognised file name", () => {
    const transcript = writeClaudeProject(directory);
    const link = join(directory, `${CLAUDE_NEXT}.jsonl`);
    symlinkSync(transcript, link);
    expect(() => readClaudeTranscript(link)).toThrow("cannot be opened");
    expect(() => readClaudeSession(join(directory, "agent-x.jsonl"))).toThrow("named <session uuid>.jsonl");
  });
});

describe("Codex reader", () => {
  test("keeps the thread id across effort changes and reads provider from the rollout", () => {
    const rollout = readCodexRollout(writeCodexSessions(directory).root);
    expect(rollout).toMatchObject({
      thread_id: CODEX_ROOT, session_id: CODEX_ROOT, parent_thread_id: null, forked_from_id: null, spawn_turn: null,
      version: "0.162.1", provider: "openai", started_at: "2026-10-17T10:00:00.000Z", last_at: "2026-10-17T10:09:30.000Z",
    });
    expect(rollout.settings.map((entry) => [entry.at, entry.effort, entry.provider, entry.basis])).toEqual([
      ["2026-10-17T10:00:02.000Z", "max", "openai", "rollout"],
      ["2026-10-17T10:06:00.000Z", "ultra", "openai", "rollout"],
      ["2026-10-17T10:09:00.000Z", "max", "openai", "rollout"],
    ]);
    expect(expectNoMarkers(JSON.stringify(rollout))).toEqual([]);
  });

  test("reads thread_spawn lineage without nicknames, paths or account ids", () => {
    const paths = writeCodexSessions(directory);
    const child = readCodexRollout(paths.child);
    // The spawn turn is the first turn's root turn, even though a later turn sits under another.
    expect(child).toMatchObject({
      thread_id: CODEX_CHILD, session_id: CODEX_ROOT, parent_thread_id: CODEX_ROOT, depth: 1, agent_role: "explorer", spawn_turn: CODEX_TURN_A,
    });
    const fork = readCodexRollout(paths.fork);
    expect(fork.forked_from_id).toBe(CODEX_ROOT);
    expect(expectNoMarkers(JSON.stringify([child, fork, readCodexRollout(paths.grandchild)]))).toEqual([]);
  });
});
