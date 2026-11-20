/**
 * time/1, people's time (docs/TIME.md section 4). Apart from time.ts because it
 * reads this machine's time zone when none is given, so pure modules (the
 * ballot) never load it.
 */

/**
 * A moment for a person at this machine: their wall time with its zone, and
 * UTC beside it (docs/TIME.md section 4): "15:45 GMT (15:45Z)".
 */
export function wallTimeWithUtc(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  // Some ICU builds write "GMT+0" where others write "GMT".
  const zone = part("timeZoneName") === "GMT+0" ? "GMT" : part("timeZoneName");
  return `${part("hour")}:${part("minute")} ${zone} (${date.toISOString().slice(11, 16)}Z)`;
}
