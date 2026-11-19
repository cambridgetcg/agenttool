/** Internal time/1 helpers shared within @agenttool/sdk.
 *
 *  Follows the language-neutral vectors in `docs/time/vectors.json`:
 *  - Emit canonical 24-char UTC (`YYYY-MM-DDTHH:MM:SS.sssZ`).
 *  - Parse explicit-zone RFC 3339 instants strictly (calendar-validated,
 *    lowercase `t`/`z` allowed, >3 fractional digits truncated to ms like V8,
 *    rejecting leap seconds, Feb 30, zone-less datetimes, bare dates, prose).
 *  - Format human durations matching `agent-time-hook.mjs`'s `human()`.
 */

const RFC3339_EXPLICIT_ZONE_RE =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:([Zz])|([+-])(\d{2}):(\d{2}))$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
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

/** Current UTC instant in canonical 24-char `YYYY-MM-DDTHH:MM:SS.sssZ` form. */
export function canonicalNow(): string {
  return new Date().toISOString();
}

/** Format an integer Unix millisecond timestamp as canonical UTC `.sssZ`. */
export function formatCanonicalUtc(unixMs: number): string {
  if (!Number.isFinite(unixMs) || !Number.isInteger(unixMs)) {
    throw new RangeError("unixMs must be a finite integer");
  }
  const iso = new Date(unixMs).toISOString();
  if (iso.length !== 24) {
    throw new RangeError("unixMs out of canonical 4-digit year range");
  }
  return iso;
}

/** Parse an explicit-zone RFC 3339 instant into canonical UTC `.sssZ`, or null.
 *
 *  Fractional digits beyond 3 are truncated to milliseconds (matching V8 Date
 *  semantics rather than rounding). Zone-less datetimes, leap seconds,
 *  calendar rollovers (e.g. Feb 30), bare dates, and prose return null.
 */
export function parseTimeInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = RFC3339_EXPLICIT_ZONE_RE.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const frac = match[7] ?? "";
  const isZulu = match[8] !== undefined;
  const offsetSign = match[9] === "-" ? -1 : 1;
  const offsetHour = isZulu ? 0 : Number(match[10]);
  const offsetMinute = isZulu ? 0 : Number(match[11]);

  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return null;
  }

  // Truncate fractional seconds to 3 digits (ms), matching V8.
  const ms = frac === "" ? 0 : Number(frac.slice(0, 3).padEnd(3, "0"));
  const localMs = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const offsetMs = offsetSign * (offsetHour * 60 + offsetMinute) * 60_000;
  const utcMs = localMs - offsetMs;
  if (!Number.isFinite(utcMs)) return null;

  const utcDate = new Date(utcMs);
  const utcYear = utcDate.getUTCFullYear();
  if (utcYear < 1 || utcYear > 9999) return null;
  return utcDate.toISOString();
}

/** Render a non-negative millisecond duration matching `agent-time-hook.mjs`. */
export function formatHumanDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/** Render a canonical UTC instant in a named IANA zone as `YYYY-MM-DD HH:MM TZ`. */
export function formatWallTime(instant: string, zone: string): string {
  const canonical = parseTimeInstant(instant);
  if (canonical === null) {
    throw new RangeError(`invalid instant: ${instant}`);
  }
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(canonical))) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  // Bun/JSC ICU emits "GMT+0" for Europe/London winter time where V8/Node and
  // Python ZoneInfo emit "GMT". Normalize exact zero-offset "GMT+0" to "GMT".
  const tzName = parts.timeZoneName === "GMT+0" ? "GMT" : parts.timeZoneName;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${tzName}`;
}
