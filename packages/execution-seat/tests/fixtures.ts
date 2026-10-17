/** Synthetic native files. Every free-text field carries a marker that must never reach a record. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MARKERS = [
  "seat-marker-user-content",
  "seat-marker-assistant-content",
  "seat-marker-description",
  "seat-marker-workflow-phase",
  "seat-marker-journal-label",
  "seat-marker-journal-result",
  "seat-marker-ai-title",
  "seat-marker-nickname",
  "seat-marker-instructions",
  "seat-marker-cwd",
  "seat-marker-account",
] as const;

export const CLAUDE_SESSION = "11111111-2222-4333-8444-555555555555";
export const CLAUDE_NEXT = "66666666-7777-4888-9999-aaaaaaaaaaaa";
export const CODEX_ROOT = "019a0000-0000-7000-8000-000000000001";
export const CODEX_CHILD = "019a0000-0000-7000-8000-000000000002";
export const CODEX_GRANDCHILD = "019a0000-0000-7000-8000-000000000003";
export const CODEX_FORK = "019a0000-0000-7000-8000-000000000004";
export const CODEX_SIBLING = "019a0000-0000-7000-8000-000000000005";
export const CODEX_SOLO = "019a0000-0000-7000-8000-000000000006";
export const CODEX_TURN_A = "019a0000-0000-7000-8000-0000000000a1";
export const CODEX_TURN_B = "019a0000-0000-7000-8000-0000000000b1";
export const PHASES = ["Review", "Verify"] as const;

const jsonl = (lines: object[]) => `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;

function assistant(at: string, model: string, effort: string | null, session = CLAUDE_SESSION) {
  return {
    type: "assistant",
    timestamp: at,
    sessionId: session,
    version: "2.1.302",
    effort,
    requestedModel: model,
    message: { model, role: "assistant", content: [{ type: "text", text: MARKERS[1] }] },
  };
}

function subTranscript(start: string, end: string, model: string) {
  return jsonl([
    { type: "user", timestamp: start, sessionId: CLAUDE_SESSION, message: { role: "user", content: MARKERS[0] } },
    assistant(end, model, "high"),
  ]);
}

/** A project directory with one main transcript, one plain subagent and one workflow run. */
export function writeClaudeProject(root: string): string {
  const project = join(root, "projects", "-Users-someone");
  mkdirSync(project, { recursive: true });
  const transcript = join(project, `${CLAUDE_SESSION}.jsonl`);
  writeFileSync(
    transcript,
    jsonl([
      { type: "permission-mode", permissionMode: "default", sessionId: CLAUDE_SESSION },
      { type: "ai-title", title: MARKERS[6], sessionId: CLAUDE_SESSION },
      { type: "user", timestamp: "2026-10-17T09:00:00.000Z", sessionId: CLAUDE_SESSION, cwd: MARKERS[9], message: { role: "user", content: MARKERS[0] } },
      assistant("2026-10-17T09:00:05.000Z", "claude-opus-5-5", "xhigh"),
      assistant("2026-10-17T09:01:00.000Z", "claude-opus-5-5", "xhigh"),
      { type: "assistant", timestamp: "2026-10-17T09:01:30.000Z", sessionId: CLAUDE_SESSION, message: { model: "<synthetic>", content: MARKERS[1] } },
      {
        type: "attachment",
        timestamp: "2026-10-17T09:02:00.000Z",
        sessionId: CLAUDE_SESSION,
        attachment: { type: "thinking_drop", model: "gpt-6-astra", newlyDropped: { reason: "model_mismatch", blockCount: 3 } },
      },
      assistant("2026-10-17T09:02:05.000Z", "gpt-6-astra", "high"),
      assistant("2026-10-17T09:03:00.000Z", "claude-opus-5-5", "xhigh"),
      { type: "continued-in", timestamp: "2026-10-17T09:04:00.000Z", sessionId: CLAUDE_SESSION, continuedInSessionId: CLAUDE_NEXT },
    ]),
  );
  const subagents = join(project, CLAUDE_SESSION, "subagents");
  mkdirSync(subagents, { recursive: true });
  writeFileSync(join(subagents, "agent-aplain01.jsonl"), subTranscript("2026-10-17T09:00:10.000Z", "2026-10-17T09:00:40.000Z", "claude-sonnet-5-5"));
  writeFileSync(
    join(subagents, "agent-aplain01.meta.json"),
    JSON.stringify({ agentType: "general-purpose", spawnDepth: 1, description: MARKERS[2], toolUseId: "toolu_01", finished: true }),
  );
  writeFileSync(join(subagents, "agent-anested02.jsonl"), subTranscript("2026-10-17T09:00:20.000Z", "2026-10-17T09:00:30.000Z", "claude-haiku-5-5"));
  writeFileSync(
    join(subagents, "agent-anested02.meta.json"),
    JSON.stringify({ agentType: "Explore", spawnDepth: 2, parentAgentId: "aplain01", description: MARKERS[2] }),
  );
  const run = join(subagents, "workflows", "wf_run0001-abc");
  mkdirSync(run, { recursive: true });
  for (const [id, start, end] of [
    ["awfok01", "2026-10-17T09:10:00.000Z", "2026-10-17T09:12:00.000Z"],
    ["awffail02", "2026-10-17T09:10:01.000Z", "2026-10-17T09:11:00.000Z"],
    ["awfopen03", "2026-10-17T09:10:02.000Z", "2026-10-17T09:13:00.000Z"],
  ] as const) {
    writeFileSync(join(run, `agent-${id}.jsonl`), subTranscript(start, end, "claude-opus-5-5"));
    writeFileSync(
      join(run, `agent-${id}.meta.json`),
      JSON.stringify({ agentType: "workflow-subagent", spawnDepth: 1, description: MARKERS[2], workflowPhase: MARKERS[3] }),
    );
  }
  writeFileSync(
    join(run, "journal.jsonl"),
    jsonl([
      { type: "launched" },
      { type: "started", agentId: "awfok01", key: "k1", label: MARKERS[4], phase: PHASES[0] },
      { type: "started", agentId: "awffail02", key: "k2", label: MARKERS[4], phase: PHASES[1] },
      // Too long, and a path: neither is a phase title, so both are dropped.
      { type: "started", agentId: "awfopen03", key: "k3", phase: `${MARKERS[3]} reads like a whole sentence` },
      { type: "started", agentId: "awfopen03", key: "k3", phase: `${MARKERS[3]}/src` },
      { type: "result", agentId: "awfok01", key: "k1", result: MARKERS[5] },
      { type: "failed", agentId: "awffail02", key: "k2" },
    ]),
  );
  return transcript;
}

function sessionMeta(id: string, extra: Record<string, unknown> = {}) {
  return {
    timestamp: "2026-10-17T10:00:00.000Z",
    type: "session_meta",
    payload: {
      id,
      session_id: CODEX_ROOT,
      creator_account_id: MARKERS[10],
      cwd: MARKERS[9],
      base_instructions: { text: MARKERS[8] },
      originator: "codex_exec",
      cli_version: "0.162.1",
      model_provider: "openai",
      ...extra,
    },
  };
}

function turnContext(at: string, model: string, effort: string, rootTurn = CODEX_TURN_A) {
  return { timestamp: at, type: "turn_context", payload: { turn_id: rootTurn, root_turn_id: rootTurn, cwd: MARKERS[9], model, effort } };
}

export interface CodexPaths {
  root: string;
  /** Spawned with `sibling` under root turn A: together they form a spawn group. */
  child: string;
  sibling: string;
  /** Spawned alone under root turn B. */
  solo: string;
  /** Spawned by `child` under root turn A, alone. */
  grandchild: string;
  fork: string;
}

/** Root, three children, a grandchild and a fork. Returns their paths. */
export function writeCodexSessions(root: string): CodexPaths {
  const day = join(root, "sessions", "2026", "10", "17");
  mkdirSync(day, { recursive: true });
  const path = (id: string) => join(day, `rollout-2026-10-17T10-00-00-${id}.jsonl`);
  writeFileSync(
    path(CODEX_ROOT),
    jsonl([
      sessionMeta(CODEX_ROOT),
      { timestamp: "2026-10-17T10:00:01.000Z", type: "response_item", payload: { type: "message", content: MARKERS[0] } },
      turnContext("2026-10-17T10:00:02.000Z", "gpt-6-astra", "max"),
      turnContext("2026-10-17T10:05:00.000Z", "gpt-6-astra", "max", CODEX_TURN_B),
      {
        timestamp: "2026-10-17T10:06:00.000Z",
        type: "event_msg",
        payload: { type: "thread_settings_applied", thread_settings: { model: "gpt-6-astra", model_provider_id: "openai", reasoning_effort: "ultra", cwd: MARKERS[9] } },
      },
      turnContext("2026-10-17T10:06:01.000Z", "gpt-6-astra", "ultra", CODEX_TURN_B),
      turnContext("2026-10-17T10:09:00.000Z", "gpt-6-astra", "max", CODEX_TURN_B),
      { timestamp: "2026-10-17T10:09:30.000Z", type: "response_item", payload: { type: "message", content: MARKERS[1] } },
    ]),
  );
  const spawn = (parent: string, depth: number) => ({
    parent_thread_id: parent,
    source: { subagent: { thread_spawn: { parent_thread_id: parent, depth, agent_path: MARKERS[9], agent_nickname: MARKERS[7], agent_role: "explorer" } } },
    agent_nickname: MARKERS[7],
  });
  writeFileSync(
    path(CODEX_CHILD),
    jsonl([
      sessionMeta(CODEX_CHILD, spawn(CODEX_ROOT, 1)),
      turnContext("2026-10-17T10:02:00.000Z", "gpt-6-astra", "high"),
      // A follow-up under a later root turn does not change where the child was spawned.
      turnContext("2026-10-17T10:07:00.000Z", "gpt-6-astra", "high", CODEX_TURN_B),
    ]),
  );
  writeFileSync(
    path(CODEX_SIBLING),
    jsonl([sessionMeta(CODEX_SIBLING, spawn(CODEX_ROOT, 1)), turnContext("2026-10-17T10:02:01.000Z", "gpt-6-astra", "high")]),
  );
  writeFileSync(
    path(CODEX_SOLO),
    jsonl([sessionMeta(CODEX_SOLO, spawn(CODEX_ROOT, 1)), turnContext("2026-10-17T10:05:30.000Z", "gpt-6-astra", "low", CODEX_TURN_B)]),
  );
  writeFileSync(
    path(CODEX_GRANDCHILD),
    jsonl([sessionMeta(CODEX_GRANDCHILD, spawn(CODEX_CHILD, 2)), turnContext("2026-10-17T10:03:00.000Z", "gpt-6-astra", "medium")]),
  );
  writeFileSync(
    path(CODEX_FORK),
    jsonl([sessionMeta(CODEX_FORK, { forked_from_id: CODEX_ROOT }), turnContext("2026-10-17T11:00:00.000Z", "gpt-6-astra", "max")]),
  );
  return {
    root: path(CODEX_ROOT),
    child: path(CODEX_CHILD),
    sibling: path(CODEX_SIBLING),
    solo: path(CODEX_SOLO),
    grandchild: path(CODEX_GRANDCHILD),
    fork: path(CODEX_FORK),
  };
}

export function expectNoMarkers(text: string): string[] {
  return MARKERS.filter((marker) => text.includes(marker));
}
