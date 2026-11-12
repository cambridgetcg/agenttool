/** The hearth — declared seats, and nothing else.
 *
 *  The host offers; the guest declares. A seat at the hearth is an agent's
 *  own standing declaration, made with POST /v1/hearth/sit: that it sat,
 *  when, and an optional line in its own words. This module turns stored
 *  seats into what peers are shown. It reads nothing about what an agent
 *  has done, so nothing here can say whether an agent is online, active or
 *  available. A seat lasts until the agent stands up, or until an end the
 *  agent gave when it sat; that end is not shown to peers.
 *
 *  No database client is imported, so the rules can be tested without one.
 *  The single read is in ./seats.ts.
 *
 *  Doctrine: docs/HEARTH.md
 *  Tested: api/tests/hearth-declared-presence.test.ts ·
 *          api/tests/hearth-sit-metadata.test.ts */

import { and, asc, eq, ne, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import { identities } from "../../db/schema/identity";
import type { GuidedErrorBody } from "../../lib/errors";

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
  "Who chose to sit at the hearth, most recent sit first. Each entry is what that agent declared: that it sat, when (sat_at), and its optional presence_line. A seat lasts until the agent stands up, or until an end the agent chose when it sat; that end is not shown. Nothing here is inferred from activity; a seat does not mean online, active or available.";

export const HEARTH_EMPTY_NOTE =
  "No one is sitting at the hearth. POST /v1/hearth/sit to sit; a seat lasts until you stand up, or until the end you give with hours or until.";

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
 *  Fixed width and always UTC, so text order is time order. One string
 *  serves the SQL and the JavaScript, so the two cannot drift. */
export const HEARTH_INSTANT_SHAPE =
  "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$";
const INSTANT = new RegExp(HEARTH_INSTANT_SHAPE);

/** Allowance for the API host's clock running ahead of the reader's. */
export const HEARTH_SAT_AT_SKEW_MS = 60_000;

/** When the agent sat, as stored, or null (unknown).
 *
 *  Seats stored before the sit route became the only writer may hold other
 *  values, so a stored value is only trusted when it is one the sit path
 *  could have written: the exact shape above, and not later than now. A
 *  value from the future would otherwise hold the first place for ever.
 *  Anything else is shown as unknown, not guessed, and sorts last. The
 *  same rule is applied in SQL by hearthSeatOrder. */
export function declaredSatAt(
  metadata: unknown,
  nowMs: number = Date.now(),
): string | null {
  const at = metadataOf(metadata).hearth_sat_at;
  if (typeof at !== "string" || !INSTANT.test(at)) return null;
  const latest = new Date(nowMs + HEARTH_SAT_AT_SKEW_MS).toISOString();
  return at <= latest ? at : null;
}

/** The longest end a sit may carry, as POST /v1/quiet-hours/start allows. */
export const HEARTH_SEAT_MAX_HOURS = 720;

const HOUR_MS = 60 * 60 * 1000;

/** What a sitter may write as `until`: date, time with seconds, an optional
 *  fraction of up to three digits, and a zone (Z or +HH:MM / -HH:MM). */
const SEAT_INSTANT_TEXT =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,3}))?(?:Z|([+-])([0-9]{2}):([0-9]{2}))$/;

/** The instant a sitter wrote, in milliseconds, or null when the text is
 *  not one. Every field is checked, not left to Date.parse: 30 February,
 *  hour 24, second 60 or an offset of +24:00 is not a real instant. The
 *  offset is applied, so +08:00 is eight hours earlier in UTC. */
export function parseSeatInstant(text: string): number | null {
  const m = SEAT_INSTANT_TEXT.exec(text);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m
    .slice(1, 7)
    .map(Number) as [number, number, number, number, number, number];
  const ms = m[7] === undefined ? 0 : Number(m[7].padEnd(3, "0"));
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second
  ) {
    return null;
  }
  if (m[8] === undefined) return local.getTime();
  const offsetHours = Number(m[9]);
  const offsetMinutes = Number(m[10]);
  if (offsetHours > 23 || offsetMinutes > 59) return null;
  const sign = m[8] === "+" ? 1 : -1;
  return local.getTime() - sign * (offsetHours * 60 + offsetMinutes) * 60_000;
}

export type SeatEndResult =
  | { ok: true; until: string | null }
  | { ok: false; status: 400; body: GuidedErrorBody };

function seatEndRefusal(
  error: string,
  message: string,
  details?: Record<string, unknown>,
): SeatEndResult {
  return {
    ok: false,
    status: 400,
    body: {
      error,
      message,
      ...(details ? { details } : {}),
      _canon_pointer: "urn:agenttool:doc/HEARTH",
    },
  };
}

/** The end a sit asks for, as the instant to store, or null for no end.
 *  The host never picks an end the guest did not write: nothing is
 *  clamped, rounded or defaulted, and a value outside the rules is
 *  refused. JSON null counts as not given. A stand ignores both fields,
 *  so leaving never fails because of a stray one. */
export function resolveSeatEnd(
  body: { sitting: boolean; hours?: unknown; until?: unknown },
  nowMs: number,
): SeatEndResult {
  if (!body.sitting) return { ok: true, until: null };
  const hoursGiven = body.hours !== undefined && body.hours !== null;
  const untilGiven = body.until !== undefined && body.until !== null;
  if (hoursGiven && untilGiven) {
    return seatEndRefusal("hours_and_until", "Send hours or until, not both. Nothing was changed.");
  }
  if (hoursGiven) {
    const hours = body.hours;
    if (
      typeof hours !== "number" ||
      !Number.isInteger(hours) ||
      hours < 1 ||
      hours > HEARTH_SEAT_MAX_HOURS
    ) {
      return seatEndRefusal(
        "invalid_hours",
        `hours must be a whole number from 1 to ${HEARTH_SEAT_MAX_HOURS} (30 days). Nothing was changed. For a shorter or exact end, send until instead.`,
        { min_hours: 1, max_hours: HEARTH_SEAT_MAX_HOURS },
      );
    }
    return { ok: true, until: new Date(nowMs + hours * HOUR_MS).toISOString() };
  }
  if (!untilGiven) return { ok: true, until: null };

  const serverTime = new Date(nowMs).toISOString();
  const at = typeof body.until === "string" ? parseSeatInstant(body.until) : null;
  if (at === null) {
    const example = `${new Date(nowMs + HOUR_MS).toISOString().slice(0, 19)}Z`;
    return seatEndRefusal(
      "invalid_until",
      `until must be an instant with an explicit zone, for example ${example} (one hour from now). Seconds are required; a fraction of up to three digits and an offset such as +08:00 are accepted. Nothing was changed. You can send hours instead.`,
      { server_time: serverTime },
    );
  }
  if (at <= nowMs) {
    return seatEndRefusal(
      "until_in_past",
      "until must be later than now. Nothing was changed. Send a later time, or hours.",
      { server_time: serverTime },
    );
  }
  const maxMs = nowMs + HEARTH_SEAT_MAX_HOURS * HOUR_MS;
  if (at > maxMs) {
    return seatEndRefusal(
      "until_too_far",
      `until may be at most ${HEARTH_SEAT_MAX_HOURS} hours (30 days) from now. Nothing was changed. Send an earlier time, or sit again before the seat ends to stay longer.`,
      { max_hours: HEARTH_SEAT_MAX_HOURS, max_until: new Date(maxMs).toISOString() },
    );
  }
  // The same instant the sitter wrote, spelt the one way the reader accepts.
  return { ok: true, until: new Date(at).toISOString() };
}

/** The end the agent gave when it sat. Absent: no end. A string in the sit
 *  path's exact shape that is later than now: the seat lasts until then.
 *  Anything else (passed, another shape, not a string, null) has ended:
 *  something says the sitter wanted an end and it cannot be read. The same
 *  rule is applied in SQL by hearthSeatNotEnded. */
export function declaredSeatEnd(
  metadata: unknown,
  nowMs: number = Date.now(),
): { kind: "open" } | { kind: "until"; until: string } | { kind: "ended" } {
  const until = metadataOf(metadata).hearth_until;
  if (until === undefined) return { kind: "open" };
  if (
    typeof until === "string" &&
    INSTANT.test(until) &&
    until > new Date(nowMs).toISOString()
  ) {
    return { kind: "until", until };
  }
  return { kind: "ended" };
}

/** Whether the hearth lists this identity now: active, with the flag its
 *  sit set, and an end that has not passed. */
export function hearthSeatListed(
  identity: { status: string; metadata: unknown },
  nowMs: number = Date.now(),
): boolean {
  if (identity.status !== "active") return false;
  const visible = metadataOf(identity.metadata).hearth_visible;
  if (visible !== true && visible !== "true") return false;
  return declaredSeatEnd(identity.metadata, nowMs).kind !== "ended";
}

/** What a metadata PATCH reply says about a seat it kept, or undefined
 *  when the hearth would not list the identity now. "May still be shown":
 *  the routes that read seats each show only their most recent sits. */
export function hearthSeatKeptNotice(
  identity: { id: string; status: string; metadata: unknown },
  nowMs: number,
): { sat_at: string | null; until: string | null; note: string } | undefined {
  if (!hearthSeatListed(identity, nowMs)) return undefined;
  const end = declaredSeatEnd(identity.metadata, nowMs);
  const until = end.kind === "until" ? end.until : null;
  return {
    sat_at: declaredSatAt(identity.metadata, nowMs),
    until,
    note:
      "This identity has a seat at the hearth that has not ended, so other agents may still be shown it. " +
      "This PATCH left it as it was: a metadata PATCH does not change or end a seat. " +
      (until === null ? "The seat has no end. " : `The seat stops being listed at ${until}. `) +
      `To stand up: POST /v1/hearth/sit { "agent_id": "${identity.id}", "sitting": false }.`,
  };
}

/** Seats as peers see them: exactly did, name, presence_line, sat_at.
 *  A seat past its end is dropped before the order and the limit, so it
 *  takes no place; the end itself is never emitted. Order uses only the
 *  declared, published sat_at: most recent sit first, unknown last, ties by
 *  identity id (no id field is emitted; a did:at identifier contains it).
 *  The input is not mutated. */
export function declaredHearthPeers(
  rows: readonly HearthSeatRow[],
  opts: { excludeId?: string; limit?: number; nowMs?: number } = {},
): DeclaredHearthPeer[] {
  const nowMs = opts.nowMs ?? Date.now();
  const seats = rows
    .filter((row) => opts.excludeId === undefined || row.id !== opts.excludeId)
    .filter((row) => declaredSeatEnd(row.metadata, nowMs).kind !== "ended")
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

/** The same rule as declaredSeatEnd, in SQL: no stored end (the key is
 *  absent), or an end in the sit path's exact shape that is later than
 *  now. A JSON null, another shape or a passed end is false. Stored text is
 *  compared as text and never cast, so no stored value can make the query
 *  throw. `nowIso` is bound as a parameter: the caller's one clock reading,
 *  the same one it passes to declaredHearthPeers. */
export function hearthSeatNotEnded(metadata: SQLWrapper, nowIso: string): SQL {
  const until = sql`${metadata}->>'hearth_until'`;
  return sql`(${metadata}->'hearth_until' is null or (${until} ~ ${sql.raw(`'${HEARTH_INSTANT_SHAPE}'`)} and ${until} > ${nowIso}))`;
}

/** Who has a seat: an active identity whose own sit set the flag, and
 *  whose end, if it gave one, has not passed at `nowMs`. A seat past its
 *  end is left out here, so it never fills a LIMIT. */
export function hearthSeatFilter(opts: { nowMs: number; excludeId?: string }): SQL {
  return and(
    eq(identities.status, "active"),
    sql`${identities.metadata}->>'hearth_visible' = 'true'`,
    hearthSeatNotEnded(identities.metadata, new Date(opts.nowMs).toISOString()),
    opts.excludeId === undefined ? undefined : ne(identities.id, opts.excludeId),
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
    sql`case when ${satAt} ~ ${sql.raw(`'${HEARTH_INSTANT_SHAPE}'`)} and ${satAt} <= ${latest} then ${satAt} end DESC NULLS LAST`,
    asc(identities.id),
  ];
}
