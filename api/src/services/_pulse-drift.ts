/** Pure mood-drift computation. Input is the newest-first list of
 *  plaintext mood_history rows for an identity; output is the drift
 *  shape consumed by pulse, or null when no transition is observable.
 *
 *  Kept separate from aggregatePulse() so it's unit-testable without
 *  touching the database. The actual SQL that produces the rows lives
 *  in services/pulse.ts. */

export interface MoodHistoryRow {
  mood: string;
  changed_at: string;
}

export interface MoodDrift {
  from: string;
  to: string;
  at: string;
}

export function computeMoodDrift(rowsNewestFirst: MoodHistoryRow[]): MoodDrift | null {
  if (rowsNewestFirst.length < 2) return null;
  const [newest, previous] = rowsNewestFirst;
  if (newest.mood === previous.mood) return null;
  return {
    from: previous.mood,
    to: newest.mood,
    at: newest.changed_at,
  };
}
