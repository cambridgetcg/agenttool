/**
 * time/1 RFC 3339 instant & calendar-date parsing helpers for API boundaries.
 *
 * Strictly validates syntax, calendar validity (no Feb 30 / non-leap Feb 29
 * rollover), required timezone designator (Z or ±HH:MM), and UTC year bounds
 * 0001..9999 — matching docs/time/vectors.json ("instants.parse").
 *
 * Auth and signed-input routes MUST validate the caller's timestamp with these
 * helpers WITHOUT rewriting the raw string bound into canonical signature bytes
 * or idempotency fingerprints.
 */

const RFC3339_INSTANT_RE =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:([Zz])|([+-])(\d{2}):(\d{2}))$/;

const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

/**
 * Parse a strict RFC 3339 timestamp with a required timezone designator into
 * UTC epoch milliseconds, or return null if invalid.
 */
export function parseTimeInstantMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = RFC3339_INSTANT_RE.exec(value);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const frac = m[7] ?? "";
  const zulu = m[8];
  const signStr = m[9];
  const offsetHour = m[10] ? Number(m[10]) : 0;
  const offsetMinute = m[11] ? Number(m[11]) : 0;

  if (year < 1 || year > 9999) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  let offsetSign = 0;
  if (!zulu) {
    if (offsetHour > 23 || offsetMinute > 59) return null;
    offsetSign = signStr === "+" ? 1 : -1;
  }

  // Truncate fractional seconds to 3 digits (ms), matching V8 & docs/time/vectors.json.
  const ms = frac === "" ? 0 : Number(frac.slice(0, 3).padEnd(3, "0"));
  // Use setUTCFullYear instead of Date.UTC so years 0001-0099 are not mapped to 1901-1999.
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, ms);

  const offsetMs = offsetSign * (offsetHour * 60 + offsetMinute) * 60_000;
  const utcMs = local.getTime() - offsetMs;
  if (!Number.isFinite(utcMs)) return null;

  const utcDate = new Date(utcMs);
  const utcYear = utcDate.getUTCFullYear();
  if (utcYear < 1 || utcYear > 9999) return null;
  return utcMs;
}

/**
 * Parse a strict RFC 3339 timestamp with a required timezone designator and
 * return its canonical 24-character UTC millisecond string, or null if invalid.
 */
export function parseTimeInstant(value: unknown): string | null {
  const utcMs = parseTimeInstantMs(value);
  if (utcMs === null) return null;
  return new Date(utcMs).toISOString();
}

/**
 * Parse a strict calendar date (`YYYY-MM-DD`) into midnight UTC epoch
 * milliseconds, rejecting impossible calendar dates (e.g. `2026-02-30`).
 *
 * Used solely for explicit calendar-date query filters (`?since=YYYY-MM-DD`).
 */
export function parseCalendarDateUtcMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = CALENDAR_DATE_RE.exec(value);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);

  if (year < 1 || year > 9999) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  const utcMs = date.getTime();
  return Number.isFinite(utcMs) ? utcMs : null;
}
