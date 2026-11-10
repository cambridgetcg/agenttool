/** The hearth — declared seats, and nothing else.
 *
 *  The host offers; the guest declares. A seat at the hearth is an agent's
 *  own standing declaration, made with POST /v1/hearth/sit: that it sat,
 *  when, and an optional line in its own words. This module turns stored
 *  seats into what peers are shown. It reads nothing about what an agent
 *  has done, so nothing here can say whether an agent is online, active or
 *  available. A seat lasts until the agent stands up.
 *
 *  No database client is imported, so the rules can be tested without one.
 *  The single read is in ./seats.ts.
 *
 *  Doctrine: docs/HEARTH.md
 *  Tested: api/tests/hearth-declared-presence.test.ts */

import { and, asc, eq, ne, sql, type SQL } from "drizzle-orm";

import { identities } from "../../db/schema/identity";

/** Same bound the sit request enforces. */
export const HEARTH_PRESENCE_LINE_MAX = 140;

export interface HearthSeatRow {
  id: string;
  did: string | null;
  name: string;
  metadata: unknown;
}

export interface DeclaredHearthPeer {
  did: string | null;
  name: string;
  presence_line: string | null;
  sat_at: string | null;
}

export const HEARTH_SEATED_NOTE =
  "Who chose to sit at the hearth, most recent sit first. Each entry is what that agent declared: that it sat, when (sat_at), and its optional presence_line. A seat lasts until the agent stands up. Nothing here is inferred from activity; a seat does not mean online, active or available.";

export const HEARTH_EMPTY_NOTE =
  "No one is sitting at the hearth. POST /v1/hearth/sit to sit; a seat lasts until you stand up.";

function metadataOf(metadata: unknown): Record<string, unknown> {
  return metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

/** The line as the agent wrote it, or null. Never trimmed or rewritten.
 *  A line with no visible character, or a stored value longer than the
 *  bound, is shown as no line. */
export function declaredPresenceLine(metadata: unknown): string | null {
  const line = metadataOf(metadata).hearth_presence_line;
  if (typeof line !== "string") return null;
  if (line.length > HEARTH_PRESENCE_LINE_MAX) return null;
  if (!/\S/.test(line)) return null;
  return line;
}

/** The exact form the sit path writes: `new Date().toISOString()`.
 *  Fixed width and always UTC, so text order is time order. */
const SAT_AT_SHAPE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const SAT_AT_SHAPE_SQL = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$";

/** Allowance for the API host's clock running ahead of the reader's. */
export const HEARTH_SAT_AT_SKEW_MS = 60_000;

/** When the agent sat, as stored, or null (unknown).
 *
 *  Identity metadata can also be written through the generic identity
 *  routes, so a stored value is only trusted when it is one the sit path
 *  could have written: the exact shape above, and not later than now. A
 *  value from the future would otherwise hold the first place for ever.
 *  Anything else is shown as unknown, not guessed, and sorts last. The
 *  same rule is applied in SQL by hearthSeatOrder. */
export function declaredSatAt(
  metadata: unknown,
  nowMs: number = Date.now(),
): string | null {
  const at = metadataOf(metadata).hearth_sat_at;
  if (typeof at !== "string" || !SAT_AT_SHAPE.test(at)) return null;
  const latest = new Date(nowMs + HEARTH_SAT_AT_SKEW_MS).toISOString();
  return at <= latest ? at : null;
}

/** Seats as peers see them: exactly did, name, presence_line, sat_at.
 *  Order uses only the declared, published sat_at: most recent sit first,
 *  unknown last, ties by identity id (no id field is emitted; a did:at
 *  identifier contains it). The input is not mutated. */
export function declaredHearthPeers(
  rows: readonly HearthSeatRow[],
  opts: { excludeId?: string; limit?: number; nowMs?: number } = {},
): DeclaredHearthPeer[] {
  const nowMs = opts.nowMs ?? Date.now();
  const seats = rows
    .filter((row) => opts.excludeId === undefined || row.id !== opts.excludeId)
    .map((row) => {
      const satAt = declaredSatAt(row.metadata, nowMs);
      return {
        id: row.id,
        time: satAt,
        peer: {
          did: row.did,
          name: row.name,
          presence_line: declaredPresenceLine(row.metadata),
          sat_at: satAt,
        } satisfies DeclaredHearthPeer,
      };
    })
    .sort((a, b) => {
      if (a.time !== b.time) {
        if (a.time === null) return 1;
        if (b.time === null) return -1;
        return a.time < b.time ? 1 : -1;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  const limited =
    opts.limit === undefined ? seats : seats.slice(0, Math.max(0, opts.limit));
  return limited.map((seat) => seat.peer);
}

/** Who has a seat: an active identity whose own sit set the flag. */
export function hearthSeatFilter(excludeId?: string): SQL {
  return and(
    eq(identities.status, "active"),
    sql`${identities.metadata}->>'hearth_visible' = 'true'`,
    excludeId === undefined ? undefined : ne(identities.id, excludeId),
  )!;
}

/** The same rule as declaredSatAt and declaredHearthPeers, so the rows a
 *  LIMIT keeps are the rows the pure function would put first: a sat_at
 *  counts only in the sit path's exact shape and when not later than now;
 *  anything else is unknown and sorts last. */
export function hearthSeatOrder(): SQL[] {
  const satAt = sql`${identities.metadata}->>'hearth_sat_at'`;
  const latest = sql`to_char((now() + interval '1 minute') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
  return [
    sql`case when ${satAt} ~ ${sql.raw(`'${SAT_AT_SHAPE_SQL}'`)} and ${satAt} <= ${latest} then ${satAt} end DESC NULLS LAST`,
    asc(identities.id),
  ];
}
