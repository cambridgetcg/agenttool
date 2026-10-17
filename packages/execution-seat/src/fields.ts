/** Allowlisted field shapes. Anything that does not match becomes null, so free text never enters a record. */
import { SeatError } from "./errors.js";
import type { SettingsEntry } from "./types.js";

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:\-\[\]]{0,127}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9_\-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A short identifier-like token such as a model name, effort level or agent type. */
export function token(value: unknown): string | null {
  return typeof value === "string" && TOKEN.test(value) ? value : null;
}

/** A native reference such as an agent id or workflow run id. */
export function ref(value: unknown): string | null {
  return typeof value === "string" && REF.test(value) ? value : null;
}

export function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

export function timestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function nonNegativeInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function requireUuid(value: unknown, what: string): string {
  const checked = uuid(value);
  if (!checked) throw new SeatError("invalid_id", `${what} must be a UUID`);
  return checked;
}

export function sameSettings(a: SettingsEntry | undefined, b: SettingsEntry): boolean {
  return a !== undefined && a.model === b.model && a.effort === b.effort && a.provider === b.provider;
}

/** Append only when model, effort or provider changed. Evidence joins the current entry. */
export function pushSetting(timeline: SettingsEntry[], entry: SettingsEntry): void {
  const last = timeline[timeline.length - 1];
  if (sameSettings(last, entry)) {
    if (last && !last.evidence && entry.evidence) last.evidence = entry.evidence;
    return;
  }
  timeline.push({ ...entry });
}

export function attachEvidence(timeline: SettingsEntry[], reason: string): void {
  const last = timeline[timeline.length - 1];
  if (last && !last.evidence) last.evidence = { thinking_drop: reason };
}

export function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

export function latest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}
