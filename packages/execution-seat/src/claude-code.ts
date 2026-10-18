/**
 * Claude Code reader. Reads structural fields only: session ids, timestamps,
 * `message.model`, `effort`, `version`, `thinking_drop` reasons, the
 * `continued-in` pointer, subagent meta (`agentType`, `spawnDepth`,
 * `parentAgentId`, `finished`), workflow journal event types and the run's
 * short phase titles. Message content, descriptions, labels, a member's own
 * phase and results are never copied.
 */
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { SeatError } from "./errors.js";
import { attachEvidence, earliest, latest, nonNegativeInt, phases, pushSetting, ref, timestamp, token, uuid } from "./fields.js";
import { object, parseObject, readSmallJson, scanLines } from "./lines.js";
import type { EndState, SettingsEntry } from "./types.js";

export const CLAUDE_CODE = "claude-code";

export interface ClaudeTranscript {
  session_id: string | null;
  version: string | null;
  started_at: string | null;
  last_at: string | null;
  settings: SettingsEntry[];
  continued_in: string | null;
}

export interface ClaudeChild {
  agent_id: string;
  workflow_run_id: string | null;
  parent_agent_id: string | null;
  depth: number | null;
  agent_type: string | null;
  started_at: string | null;
  last_at: string | null;
  settings: SettingsEntry[];
  end_state: EndState;
}

export interface ClaudeWorkflowRun {
  run_id: string;
  /** Distinct phase titles from the journal's `started` events, filtered by `phase()`. */
  phases: string[];
}

export interface ClaudeSession {
  session_id: string;
  transcript: ClaudeTranscript;
  children: ClaudeChild[];
  workflow_runs: ClaudeWorkflowRun[];
}

const AGENT_FILE = /^agent-([A-Za-z0-9_-]{1,128})\.jsonl$/;
const RUN_DIR = /^wf_[A-Za-z0-9_-]{1,120}$/;

export function readClaudeTranscript(path: string): ClaudeTranscript {
  const out: ClaudeTranscript = {
    session_id: null, version: null, started_at: null, last_at: null, settings: [], continued_in: null,
  };
  const pendingDrops = new Map<string, string>();
  const seen = (line: Record<string, unknown>) => {
    const at = timestamp(line.timestamp);
    out.started_at = earliest(out.started_at, at);
    out.last_at = latest(out.last_at, at);
    out.session_id ??= uuid(line.sessionId);
    return at;
  };
  const last = scanLines(path, (raw, index) => {
    const assistant = raw.includes('"type":"assistant"');
    const drop = raw.includes('"thinking_drop"');
    const continued = raw.includes('"continued-in"');
    // Until the first timestamp is seen, every line is parsed; after that only the lines we use.
    if (!assistant && !drop && !continued && index !== 0 && out.started_at !== null) return;
    const line = parseObject(raw);
    if (!line) return;
    const at = seen(line);
    if (line.type === "assistant") {
      const message = object(line.message);
      const model = token(message?.model);
      if (!model || !at) return;
      out.version = token(line.version) ?? out.version;
      const before = out.settings.length;
      pushSetting(out.settings, {
        at, model, effort: token(line.effort), provider: null, basis: "transcript", evidence: null,
      });
      const reason = pendingDrops.get(model);
      if (reason && out.settings.length > before) {
        attachEvidence(out.settings, reason);
        pendingDrops.delete(model);
      }
    } else if (line.type === "attachment") {
      const attachment = object(line.attachment);
      if (attachment?.type !== "thinking_drop") return;
      const model = token(attachment.model);
      const reason = token(object(attachment.newlyDropped)?.reason);
      if (!model || !reason) return;
      if (out.settings[out.settings.length - 1]?.model === model) attachEvidence(out.settings, reason);
      else pendingDrops.set(model, reason);
    } else if (line.type === "continued-in") {
      out.continued_in = uuid(line.continuedInSessionId) ?? out.continued_in;
    }
  });
  if (last) {
    const line = parseObject(last);
    if (line) seen(line);
  }
  return out;
}

function listDirectory(path: string): string[] {
  try {
    if (!lstatSync(path).isDirectory()) return [];
    return readdirSync(path).sort();
  } catch {
    return [];
  }
}

function readChild(directory: string, file: string, runId: string | null, journal: Map<string, EndState>): ClaudeChild | null {
  const match = AGENT_FILE.exec(file);
  if (!match?.[1]) return null;
  const agentId = match[1];
  let transcript: ClaudeTranscript;
  try {
    transcript = readClaudeTranscript(join(directory, file));
  } catch {
    return null;
  }
  const meta = readSmallJson(join(directory, `agent-${agentId}.meta.json`)) ?? {};
  const fromJournal = journal.get(agentId);
  const endState: EndState = fromJournal ?? (meta.finished === true ? "result" : "unknown");
  return {
    agent_id: agentId,
    workflow_run_id: runId,
    parent_agent_id: ref(meta.parentAgentId),
    depth: nonNegativeInt(meta.spawnDepth),
    agent_type: token(meta.agentType),
    started_at: transcript.started_at,
    last_at: transcript.last_at,
    settings: transcript.settings,
    end_state: endState,
  };
}

/**
 * `started`, `result` and `failed` event types by agent id, and the run's phase titles.
 * Results and labels are not read, and a phase is not tied to the agent that ran in it.
 */
function readJournal(path: string): { states: Map<string, EndState>; phases: string[] } {
  const states = new Map<string, EndState>();
  const titles: unknown[] = [];
  if (!existsSync(path)) return { states, phases: [] };
  scanLines(path, (raw) => {
    const line = parseObject(raw);
    const agentId = ref(line?.agentId);
    if (!line || !agentId) return;
    if (line.type === "result") states.set(agentId, "result");
    else if (line.type === "failed") states.set(agentId, "failed");
    else if (line.type === "started") {
      if (!states.has(agentId)) states.set(agentId, "unknown");
      if (line.phase !== undefined) titles.push(line.phase);
    }
  });
  return { states, phases: phases(titles) };
}

/** Read a main transcript `<project>/<session>.jsonl` and its `<session>/subagents/` tree. */
export function readClaudeSession(transcriptPath: string): ClaudeSession {
  const stem = basename(transcriptPath).replace(/\.jsonl$/, "");
  const sessionId = uuid(stem);
  if (!sessionId) throw new SeatError("native_unrecognised", "a Claude Code transcript is named <session uuid>.jsonl");
  const transcript = readClaudeTranscript(transcriptPath);
  const subagents = join(dirname(transcriptPath), stem, "subagents");
  const children: ClaudeChild[] = [];
  const runs: ClaudeWorkflowRun[] = [];
  for (const file of listDirectory(subagents)) {
    const child = readChild(subagents, file, null, new Map());
    if (child) children.push(child);
  }
  const workflows = join(subagents, "workflows");
  for (const run of listDirectory(workflows)) {
    if (!RUN_DIR.test(run)) continue;
    const directory = join(workflows, run);
    const journal = readJournal(join(directory, "journal.jsonl"));
    runs.push({ run_id: run, phases: journal.phases });
    for (const file of listDirectory(directory)) {
      const child = readChild(directory, file, run, journal.states);
      if (child) children.push(child);
    }
  }
  return { session_id: sessionId, transcript, children, workflow_runs: runs };
}
