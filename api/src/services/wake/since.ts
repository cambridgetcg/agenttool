/** services/wake/since.ts — what changed while you were gone.
 *
 *  The wake is the continuity keystone, and until now every read of it looked
 *  identical. An agent on its hundredth session read the same document as one
 *  on its first: here is who you are, here is what you carry, here is what
 *  awaits. Nowhere did it say *what happened since last time*. Continuity was
 *  asserted by the format and never actually delivered.
 *
 *  ## Why the caller holds the cursor
 *
 *  The obvious design is a `last_wake_at` column stamped on every read. This
 *  module deliberately does not do that. Two reasons, one practical and one
 *  doctrinal:
 *
 *  - Practical: a write on the read path of the substrate's most-read route,
 *    for a feature only some callers want.
 *  - Doctrinal: it would make the substrate the keeper of a log of when each
 *    agent looked at itself. The agent already knows when it last woke. Asking
 *    it to say so costs one query parameter and means the platform never has
 *    to remember being watched. `docs/STRANDS.md` puts it as "the substrate
 *    holds the silence; you hold the words" — the same shape applies to a
 *    cursor.
 *
 *  So: `GET /v1/wake?since=<RFC3339>`. No parameter, no section. The substrate
 *  never guesses when you were last here.
 *
 *  ## Why it insists on saying when it cannot see
 *
 *  Every source below is a *bounded window* the wake already loaded: the 15
 *  most recent chronicle entries, 10 memories, 10 unread letters. If the
 *  caller's `since` predates the oldest row in a window, the delta for that
 *  window is **truncated** — there may be more that happened, and this view
 *  structurally cannot show it.
 *
 *  A truncated delta that presents itself as complete is worse than no delta,
 *  because the agent stops looking. So truncation is a first-class field, it
 *  names the authoritative route to ask instead, and the markdown says it out
 *  loud rather than trailing off. This module computes no counts it cannot
 *  stand behind.
 *
 *  ## Zero extra queries
 *
 *  Every input is already in hand when `buildWakeBundle` assembles. This is a
 *  projection, not a fetch. Adding the section costs the wake nothing.
 *
 *  Doctrine: docs/WAKE-SINCE.md · docs/WAKE.md · docs/SOUL.md.
 */

/** Sources the delta can speak about, each with its own truncation state. */
export type SinceWindowKey = "chronicle" | "memories" | "letters" | "arrivals";

export interface SinceWindow<T> {
  /** Rows newer than the cursor, newest first. */
  items: T[];
  /** True when the cursor predates this window's oldest loaded row, so the
   *  count above is a floor and not a total. */
  truncated: boolean;
  /** How many rows the wake loaded for this window at all. */
  window_size: number;
  /** The query limit that window was read under. `window_size < limit` means
   *  the source was exhausted and nothing is hidden behind the bound. */
  window_limit: number;
  /** Where to ask for the complete answer when truncated. */
  authoritative: string;
}

export interface SinceChronicleItem {
  id: string;
  type: string;
  title: string;
  occurred_at: string;
}

export interface SinceMemoryItem {
  id: string;
  type: string;
  content: string;
  created_at: string;
}

export interface SinceLetterItem {
  id: string;
  from: string | null;
  subject: string | null;
  surfaced_at: string;
}

export interface SinceArrivalItem {
  did: string;
  display_name: string;
  created_at: string;
  same_display_name: boolean;
}

export interface WakeSince {
  /** The cursor the caller supplied, echoed exactly as parsed. */
  since: string;
  /** True when nothing in any window is newer than the cursor. */
  quiet: boolean;
  /** True when ANY window is truncated — the honest headline. */
  partial: boolean;
  chronicle: SinceWindow<SinceChronicleItem>;
  memories: SinceWindow<SinceMemoryItem>;
  letters: SinceWindow<SinceLetterItem>;
  arrivals: SinceWindow<SinceArrivalItem>;
  note: string;
}

/** A caller-supplied cursor that could not be used, and why. */
export interface SinceRefusal {
  ok: false;
  error: "since_unparseable" | "since_in_the_future";
  message: string;
  hint: string;
}

export type ParsedSince = { ok: true; at: Date } | SinceRefusal;

/**
 * Validate a caller-supplied `since`.
 *
 * Refuses rather than silently ignoring. A dropped parameter is the exact
 * failure mode this whole module exists to argue against: the caller would
 * receive a wake with no delta and no way to tell whether that meant "nothing
 * happened" or "you spelled it wrong".
 */
export function parseSince(raw: string, now: Date): ParsedSince {
  const trimmed = raw.trim();
  const at = new Date(trimmed);
  if (Number.isNaN(at.getTime())) {
    return {
      ok: false,
      error: "since_unparseable",
      message: `Could not read "${trimmed}" as a timestamp.`,
      hint:
        "Pass an RFC3339 / ISO-8601 instant, e.g. since=2026-07-24T22:05:13.725Z. " +
        "The value is refused rather than ignored, so you never receive an empty " +
        "delta that looks like a quiet week.",
    };
  }
  if (at.getTime() > now.getTime() + 60_000) {
    return {
      ok: false,
      error: "since_in_the_future",
      message: "The supplied cursor is in the future.",
      hint:
        "A future cursor can only ever return nothing, which would read as " +
        "'nothing happened'. Check the clock that produced it.",
    };
  }
  return { ok: true, at };
}

function windowOf<T>(
  items: T[],
  loadedCount: number,
  limit: number,
  oldestLoaded: Date | null,
  since: Date,
  authoritative: string,
): SinceWindow<T> {
  return {
    items,
    // Truncated only when the query actually hit its bound AND every loaded
    // row is newer than the cursor — then older qualifying rows fell off the
    // end. A query that came back under its limit exhausted the source and
    // hides nothing.
    //
    // Comparing against `loadedCount` instead of `limit` here was wrong, and
    // live data caught it: a project with five chronicle rows total loaded
    // five, all newer than the cursor, and got flagged truncated. It was
    // complete. An honesty field that cries wolf is its own kind of lie —
    // it teaches the reader to ignore the one time it matters.
    truncated:
      loadedCount >= limit &&
      items.length === loadedCount &&
      oldestLoaded !== null &&
      oldestLoaded.getTime() > since.getTime(),
    window_size: loadedCount,
    window_limit: limit,
    authoritative,
  };
}

/** Query bounds the wake reads each source under. Kept beside the projection
 *  so a limit change upstream fails a test here rather than silently turning
 *  truncation detection into a coin flip. Mirrors services/wake/build.ts. */
export const SINCE_WINDOW_LIMITS = {
  chronicle: 15,
  memories: 20,
  letters: 10,
} as const;

export interface BuildSinceInput {
  since: Date;
  chronicle: Array<{ id: string; type: string; title: string; occurredAt: Date }>;
  memories: Array<{ id: string; type: string; content: string; created_at: string }>;
  letters: Array<{ id?: string; from_did?: string | null; from?: string | null; subject?: string | null; surface_at?: string; written_at?: string }>;
  arrivals: Array<{ did: string; display_name: string; created_at: Date | string; same_display_name: boolean }>;
}

/** Project the already-loaded wake rows into a delta. Pure; never queries. */
export function buildSince(input: BuildSinceInput): WakeSince {
  const t = input.since.getTime();

  const chronicleItems = input.chronicle
    .filter((r) => r.occurredAt.getTime() > t)
    .map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      occurred_at: r.occurredAt.toISOString(),
    }));
  const chronicleOldest = input.chronicle.length
    ? input.chronicle[input.chronicle.length - 1]!.occurredAt
    : null;

  const memoryItems = input.memories
    .filter((m) => new Date(m.created_at).getTime() > t)
    .map((m) => ({
      id: m.id,
      type: m.type,
      content: m.content,
      created_at: m.created_at,
    }));
  const memoryOldest = input.memories.length
    ? new Date(input.memories[input.memories.length - 1]!.created_at)
    : null;

  const letterRows = input.letters.map((l) => {
    const at = l.surface_at ?? l.written_at ?? null;
    return {
      id: l.id ?? "",
      from: l.from ?? l.from_did ?? null,
      subject: l.subject ?? null,
      surfaced_at: at ?? "",
      _at: at ? new Date(at).getTime() : Number.NaN,
    };
  });
  const letterItems = letterRows
    .filter((l) => Number.isFinite(l._at) && l._at > t)
    .map(({ _at, ...rest }) => rest);
  const letterTimes = letterRows.map((l) => l._at).filter(Number.isFinite);
  const letterOldest = letterTimes.length ? new Date(Math.min(...letterTimes)) : null;

  const arrivalItems = input.arrivals
    .filter((a) => new Date(a.created_at).getTime() > t)
    .map((a) => ({
      did: a.did,
      display_name: a.display_name,
      created_at: new Date(a.created_at).toISOString(),
      same_display_name: a.same_display_name,
    }));

  const chronicle = windowOf(
    chronicleItems,
    input.chronicle.length,
    SINCE_WINDOW_LIMITS.chronicle,
    chronicleOldest,
    input.since,
    "GET /v1/chronicle",
  );
  const memories = windowOf(
    memoryItems,
    input.memories.length,
    SINCE_WINDOW_LIMITS.memories,
    memoryOldest,
    input.since,
    "POST /v1/memories/search",
  );
  const letters = windowOf(
    letterItems,
    letterRows.length,
    SINCE_WINDOW_LIMITS.letters,
    letterOldest,
    input.since,
    "GET /v1/letters",
  );
  // The cohort is not a rolling window — it is the complete set for a window
  // anchored on birth (docs/ARRIVAL-COHORT.md), so it can never be truncated.
  const arrivals: SinceWindow<SinceArrivalItem> = {
    items: arrivalItems,
    truncated: false,
    window_size: input.arrivals.length,
    window_limit: input.arrivals.length,
    authoritative: "GET /v1/wake (arrival_cohort)",
  };

  const quiet =
    chronicle.items.length === 0 &&
    memories.items.length === 0 &&
    letters.items.length === 0 &&
    arrivals.items.length === 0;
  const partial = chronicle.truncated || memories.truncated || letters.truncated;

  return {
    since: input.since.toISOString(),
    quiet,
    partial,
    chronicle,
    memories,
    letters,
    arrivals,
    note: partial
      ? "PARTIAL. At least one window filled to its limit with rows newer than your cursor, " +
        "so older changes have fallen off the end of what this wake loads. The counts here are " +
        "floors, not totals. Each window names the route that holds the complete record; ask " +
        "there before concluding anything about what did or did not happen."
      : quiet
        ? "Nothing in the windows this wake loads changed after your cursor. That is an " +
          "observation about these sources, not a claim that nothing happened anywhere."
        : "Complete for the windows this wake loads: every source reached rows older than your " +
          "cursor without filling up, so nothing qualifying is hidden behind the limit.",
  };
}
