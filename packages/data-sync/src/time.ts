const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/u;

/**
 * Parse the sync profile's strict RFC 3339 subset into an exact, comparable
 * instant. It follows the reference data node's uppercase, non-leap-second
 * timestamp boundary while preserving fractional precision for comparison.
 *
 * JavaScript's Date parser accepts non-protocol prose and loses fractional
 * precision after milliseconds. This parser preserves arbitrarily precise
 * RFC 3339 fractional seconds as a canonical string instead.
 */
export function parseRfc3339Instant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = RFC3339_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] ?? "";
  const zone = match[8]!;
  const offsetHour = zone === "Z" ? 0 : Number(zone.slice(1, 3));
  const offsetMinute = zone === "Z" ? 0 : Number(zone.slice(4, 6));
  const daysInMonth = month >= 1 && month <= 12
    ? [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!
    : 0;
  if (
    day < 1
    || day > daysInMonth
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 23
    || offsetMinute > 59
  ) {
    return null;
  }

  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, 0);
  const localMilliseconds = local.getTime();
  if (!Number.isSafeInteger(localMilliseconds)) return null;

  const offsetSign = zone.startsWith("-") ? -1 : 1;
  const offsetMilliseconds = offsetSign
    * (offsetHour * 60 + offsetMinute)
    * 60_000;
  const utcMilliseconds = localMilliseconds - offsetMilliseconds;
  if (!Number.isSafeInteger(utcMilliseconds)) return null;

  const canonicalFraction = fraction.replace(/0+$/u, "");
  return `${BigInt(utcMilliseconds / 1000)}:${canonicalFraction}`;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
