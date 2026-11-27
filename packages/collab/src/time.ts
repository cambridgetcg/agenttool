/**
 * time/1 for Collab (docs/TIME.md): one strict reader for instants given at an
 * input boundary, and the two renderings of a duration for people. The
 * conformance rows are docs/time/vectors.json; tests/time-vectors.test.ts
 * checks every one of them, so this file and the SDKs cannot drift apart.
 */

const ZONED_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:([Zz])|([+-])(\d{2}):(\d{2}))$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * An RFC 3339 instant with a zone (`Z`, `z` or `±HH:MM`), as epoch milliseconds,
 * or null. It refuses a time with no zone, a bare date, prose, a leap second,
 * hour 24 and any date the calendar does not have (30 February), where a bare
 * `Date.parse` would roll it into the next month. Fraction digits past three
 * are cut, as V8 does, never rounded. `seconds: "optional"` also reads
 * `HH:MMZ`, for inputs that took it before time/1; it is off by default.
 */
export function parseZonedInstant(
  value: unknown,
  options: { seconds?: "required" | "optional" } = {},
): number | null {
  if (typeof value !== "string") return null;
  const match = ZONED_INSTANT.exec(value);
  if (!match) return null;
  if (match[6] === undefined && options.seconds !== "optional") return null;
  if (match[6] === undefined && match[7] !== undefined) return null;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number) as [number, number, number, number, number];
  const second = Number(match[6] ?? 0);
  const zulu = match[8] !== undefined;
  const offsetHours = zulu ? 0 : Number(match[10]);
  const offsetMinutes = zulu ? 0 : Number(match[11]);
  if (
    year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)
    || hour > 23 || minute > 59 || second > 59 || offsetHours > 23 || offsetMinutes > 59
  ) {
    return null;
  }
  const millis = Number((match[7] ?? "").slice(0, 3).padEnd(3, "0"));
  // setUTCFullYear, not Date.UTC: Date.UTC reads years 0-99 as 1900-1999.
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, millis);
  const sign = match[9] === "-" ? -1 : 1;
  const instant = local.getTime() - sign * (offsetHours * 60 + offsetMinutes) * 60_000;
  const utcYear = new Date(instant).getUTCFullYear();
  return Number.isFinite(instant) && utcYear >= 1 && utcYear <= 9999 ? instant : null;
}

/** Whole minutes from `at` to `observedAt`, never negative; null when either is not a time. */
export function minutesSince(at: string, observedAt: string): number | null {
  const age = Date.parse(observedAt) - Date.parse(at);
  return Number.isFinite(age) ? Math.max(0, Math.floor(age / 60_000)) : null;
}

/**
 * time/1: an elapsed duration for people, in at most two units and rounded
 * down, as the harness time line and docs/time/vectors.json ("elapsed") write
 * it: 45s, 19m 55s, 1h 2m, 2d 3h. Never parsed back.
 */
export function durationSince(ms: number): string {
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

/**
 * time/1: time left for people (docs/time/vectors.json, "left"): rounded up to
 * the minute so 30 seconds reads 1m, hours and minutes only, and "closed" at
 * or past the moment.
 */
export function durationUntil(at: string, observedAt: string): string {
  const left = Date.parse(at) - Date.parse(observedAt);
  if (!Number.isFinite(left) || left <= 0) return "closed";
  const minutes = Math.ceil(left / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/** time/1 §6 minimum grace added after an ETA before it reads overdue: 10 minutes. */
export const ETA_MIN_GRACE_MS = 10 * 60 * 1000;

/**
 * Parse a strict time/1 zoned RFC 3339 instant (seconds and zone required) and
 * return its canonical UTC ISO-8601 form, or null when invalid.
 */
export function parseCanonicalInstant(value: unknown): string | null {
  const ms = parseZonedInstant(value);
  return ms === null ? null : new Date(ms).toISOString();
}

/**
 * time/1 §6 grace window: the larger of 10 minutes and half the stated estimate
 * (`eta_at - set_at`, floored to whole milliseconds, clamped at 0 when the
 * stated ETA is at or before `set_at`).
 */
export function computeEtaGraceMs(setAtMs: number, etaAtMs: number): number {
  const estimateMs = Number.isFinite(setAtMs) && Number.isFinite(etaAtMs)
    ? Math.max(0, etaAtMs - setAtMs)
    : 0;
  return Math.max(ETA_MIN_GRACE_MS, Math.floor(estimateMs / 2));
}

export interface EtaOverdueStatus {
  overdue: boolean;
  overdue_at: string | null;
}

/**
 * time/1 §6 derived overdue state at `observed_at`.
 *
 * - Without `eta_at`: `{ overdue: false, overdue_at: null }`.
 * - With `eta_at`: `overdue_at = eta_at + max(10 minutes, floor(max(0, eta_at - set_at) / 2))`.
 * - `overdue` is true once `observed_at >= overdue_at` and `active` is true
 *   (completed tasks are never overdue).
 */
export function computeEtaOverdue(input: {
  set_at: string;
  eta_at: string | null;
  observed_at: string;
  active?: boolean;
}): EtaOverdueStatus {
  if (!input.eta_at) return { overdue: false, overdue_at: null };
  const etaMs = parseZonedInstant(input.eta_at) ?? Date.parse(input.eta_at);
  const setMs = parseZonedInstant(input.set_at) ?? Date.parse(input.set_at);
  const observedMs = parseZonedInstant(input.observed_at) ?? Date.parse(input.observed_at);
  if (!Number.isFinite(etaMs)) return { overdue: false, overdue_at: null };
  const graceMs = computeEtaGraceMs(setMs, etaMs);
  const overdueAtMs = etaMs + graceMs;
  const overdueAt = new Date(overdueAtMs).toISOString();
  const active = input.active ?? true;
  return {
    overdue: active && Number.isFinite(observedMs) && observedMs >= overdueAtMs,
    overdue_at: overdueAt,
  };
}
