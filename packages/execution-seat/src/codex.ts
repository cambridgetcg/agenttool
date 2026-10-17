/**
 * Codex reader. Reads structural fields only: the first `session_meta`
 * (`id`, `session_id`, `parent_thread_id`, `forked_from_id`, `cli_version`,
 * `model_provider`, and `thread_spawn` depth and role), `turn_context` model
 * and effort, a child's first `root_turn_id`, `thread_settings_applied` model
 * and effort, and timestamps.
 * Account ids, nicknames, paths, instructions and message content are never copied.
 */
import { SeatError } from "./errors.js";
import { earliest, latest, nonNegativeInt, pushSetting, timestamp, token, uuid } from "./fields.js";
import { object, parseObject, scanLines } from "./lines.js";
import type { SettingsEntry } from "./types.js";

export const CODEX = "codex";

export interface CodexRollout {
  thread_id: string;
  session_id: string;
  parent_thread_id: string | null;
  forked_from_id: string | null;
  depth: number | null;
  agent_role: string | null;
  /** For a spawned thread: `root_turn_id` of its first turn, the root thread's turn it was spawned under. */
  spawn_turn: string | null;
  version: string | null;
  provider: string | null;
  started_at: string | null;
  last_at: string | null;
  settings: SettingsEntry[];
}

export function readCodexRollout(path: string): CodexRollout {
  const state: {
    meta: Omit<CodexRollout, "spawn_turn" | "started_at" | "last_at" | "settings"> | null;
    spawnTurn: string | null;
    turns: number;
    provider: string | null;
    started: string | null;
    last: string | null;
  } = { meta: null, spawnTurn: null, turns: 0, provider: null, started: null, last: null };
  const settings: SettingsEntry[] = [];
  const seen = (line: Record<string, unknown>) => {
    const at = timestamp(line.timestamp);
    state.started = earliest(state.started, at);
    state.last = latest(state.last, at);
    return at;
  };
  const tail = scanLines(path, (raw, index) => {
    const context = raw.includes('"turn_context"');
    const applied = raw.includes('"thread_settings_applied"');
    if (index !== 0 && !context && !applied && state.started !== null) return;
    const line = parseObject(raw);
    if (!line) return;
    const at = seen(line);
    const payload = object(line.payload);
    if (index === 0) {
      if (line.type !== "session_meta" || !payload) return;
      const threadId = uuid(payload.id);
      if (!threadId) return;
      const spawn = object(object(object(payload.source)?.subagent)?.thread_spawn);
      state.meta = {
        thread_id: threadId,
        session_id: uuid(payload.session_id) ?? threadId,
        parent_thread_id: uuid(payload.parent_thread_id) ?? uuid(spawn?.parent_thread_id),
        forked_from_id: uuid(payload.forked_from_id),
        depth: nonNegativeInt(spawn?.depth),
        agent_role: token(spawn?.agent_role),
        version: token(payload.cli_version),
        provider: token(payload.model_provider),
      };
      state.provider = state.meta.provider;
      return;
    }
    if (!at || !payload) return;
    if (line.type === "turn_context") {
      // Later turns of a child can sit under other root turns; only the first one says where it was spawned.
      if (state.turns++ === 0 && state.meta?.parent_thread_id) state.spawnTurn = uuid(payload.root_turn_id);
      const model = token(payload.model);
      if (!model) return;
      pushSetting(settings, {
        at, model, effort: token(payload.effort), provider: state.provider, basis: "rollout", evidence: null,
      });
    } else if (line.type === "event_msg" && payload.type === "thread_settings_applied") {
      const applied = object(payload.thread_settings);
      const model = token(applied?.model);
      if (!model) return;
      // Later turn contexts carry no provider; they inherit the one applied here.
      state.provider = token(applied?.model_provider_id) ?? state.provider;
      pushSetting(settings, {
        at,
        model,
        effort: token(applied?.reasoning_effort),
        provider: state.provider,
        basis: "rollout",
        evidence: null,
      });
    }
  });
  if (tail) {
    const line = parseObject(tail);
    if (line) seen(line);
  }
  if (!state.meta) throw new SeatError("native_unrecognised", "a Codex rollout starts with a session_meta line");
  return { ...state.meta, spawn_turn: state.spawnTurn, started_at: state.started, last_at: state.last, settings };
}
