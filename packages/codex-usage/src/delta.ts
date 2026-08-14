import type { UsageDelta, UsageSnapshot } from "./types.js";

export interface UsageSample {
  observedAtMs: number;
  databaseFile: string;
  total: number;
  sessions: Map<string, number>;
}

export function sampleSnapshot(snapshot: UsageSnapshot): UsageSample {
  return {
    observedAtMs: Date.parse(snapshot.observed_at),
    databaseFile: snapshot.source.database_file,
    total: snapshot.totals.cumulative_tokens,
    sessions: new Map(
      snapshot.sessions.map((session) => [session.session_ref, session.cumulative_tokens]),
    ),
  };
}

export function compareSnapshot(
  snapshot: UsageSnapshot,
  previous: UsageSample,
): UsageDelta {
  const sourceChanged = snapshot.source.database_file !== previous.databaseFile;
  const totalReset = snapshot.totals.cumulative_tokens < previous.total;
  const comparable = !sourceChanged && !totalReset;

  const sessionDeltas: UsageDelta["session_deltas"] = [];
  for (const session of snapshot.sessions) {
    const before = previous.sessions.get(session.session_ref);
    if (before === undefined || session.cumulative_tokens === before) continue;
    if (session.cumulative_tokens > before) {
      sessionDeltas.push({
        session_ref: session.session_ref,
        comparison: "advanced",
        cumulative_tokens_delta: session.cumulative_tokens - before,
      });
    } else {
      sessionDeltas.push({
        session_ref: session.session_ref,
        comparison: "counter_reset",
        cumulative_tokens_delta: null,
      });
    }
  }

  return {
    elapsed_ms: Math.max(0, Date.parse(snapshot.observed_at) - previous.observedAtMs),
    comparison: comparable ? "comparable" : "counter_reset_or_source_changed",
    cumulative_tokens_delta: comparable
      ? snapshot.totals.cumulative_tokens - previous.total
      : null,
    session_deltas: sessionDeltas,
  };
}
