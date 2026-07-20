/** Pure pagination helpers for the inbox voice catch-up phase.
 *
 * Catch-up uses a compound cursor (`created_at`, `id`). Timestamps alone are
 * not safe: two messages can share the same database timestamp, and resuming
 * with `created_at > since` would silently skip the later UUID.
 *
 * Doctrine: docs/INBOX.md.
 */

import { z } from "zod";

export interface InboxCatchupRow {
  id: string;
  createdAt: Date;
  /** Exact database timestamp string. Unlike Date, this retains PostgreSQL's
   * microseconds and prevents a dense page from replaying its last row. */
  cursorCreatedAt?: string;
}

/** One extra sentinel row is queried beyond this public replay page size. */
export const INBOX_CATCHUP_LIMIT = 200;

export interface InboxCatchupCursor {
  since: string;
  since_id: string;
}

export interface InboxCatchupPage<T extends InboxCatchupRow> {
  replay: T[];
  truncated: boolean;
  resume: InboxCatchupCursor | null;
}

export type InboxVoiceCursorValidation =
  | { ok: true; sinceId: string | null }
  | {
      ok: false;
      error: "invalid_since" | "invalid_since_id" | "since_required_with_since_id";
      hint: string;
    };

/** Validate query-presence separately from truthiness. An explicitly supplied
 * empty cursor is malformed, not equivalent to omission. */
export function validateInboxVoiceCursor(
  sinceRaw: string | undefined,
  sinceIdRaw: string | undefined,
): InboxVoiceCursorValidation {
  if (sinceRaw !== undefined) {
    const parsed = z.string().datetime({ offset: true }).safeParse(sinceRaw);
    if (!parsed.success) {
      return {
        ok: false,
        error: "invalid_since",
        hint: "pass a complete ISO-8601 timestamp with timezone",
      };
    }
  }

  const sinceId =
    sinceIdRaw !== undefined
      ? z.string().uuid().safeParse(sinceIdRaw)
      : null;
  if (sinceId && !sinceId.success) {
    return {
      ok: false,
      error: "invalid_since_id",
      hint: "pass the UUID from resume.since_id",
    };
  }
  if (sinceIdRaw !== undefined && sinceRaw === undefined) {
    return {
      ok: false,
      error: "since_required_with_since_id",
      hint: "pass both resume fields",
    };
  }

  return { ok: true, sinceId: sinceId?.success ? sinceId.data : null };
}

/**
 * Turn a `limit + 1` query result into an explicit replay page.
 *
 * The extra row is only a sentinel. It is never emitted, and a truncated page
 * always carries the exact compound cursor needed to request the next page.
 */
export function pageInboxCatchup<T extends InboxCatchupRow>(
  rows: readonly T[],
  limit: number,
): InboxCatchupPage<T> {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError("inbox catch-up limit must be a positive integer");
  }

  const replay = rows.slice(0, limit);
  const truncated = rows.length > limit;
  const last = replay.at(-1);

  return {
    replay,
    truncated,
    resume:
      truncated && last
        ? {
            since: last.cursorCreatedAt ?? last.createdAt.toISOString(),
            since_id: last.id,
          }
        : null,
  };
}
