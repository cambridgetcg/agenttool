import { canonicalJson, compareUnicode } from "./canonical.js";
import {
  EVIDENCE_LEVELS,
  MAX_REFERENCES,
  PARTICIPATION_RIGHTS,
  PUBLIC_SAFE_THEORETICAL_LANE,
  SIX_LEDGER_PROFILE,
  ZERO_EFFECTS,
} from "./constants.js";
import { fail } from "./errors.js";
import type { JsonValue } from "./canonical.js";
import type {
  EvidenceLevel,
  ParticipationRights,
  PublicSafeTheoreticalLane,
  Sha256Id,
  SixLedgerProfile,
  ZeroEffects,
} from "./types.js";

export type JsonRecord = Record<string, JsonValue>;

export function record(value: JsonValue | undefined, path: string): JsonRecord {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    fail("validation_error", `${path} must be an object`);
  }
  return value;
}

export function exactKeys(value: JsonRecord, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort(compareUnicode);
  const wanted = [...expected].sort(compareUnicode);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail("validation_error", `${path} must contain exactly: ${wanted.join(", ")}`);
  }
}

export function literal<T>(value: JsonValue | undefined, expected: T, path: string): T {
  if (canonicalJson(value) !== canonicalJson(expected)) {
    fail("validation_error", `${path} must equal the closed protocol value`);
  }
  return expected;
}

export function enumValue<T extends string>(
  value: JsonValue | undefined,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail("validation_error", `${path} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function boundedText(value: JsonValue | undefined, path: string, maximum = 256): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > maximum) {
    fail("validation_error", `${path} must be a nonempty string of at most ${String(maximum)} bytes`);
  }
  return value;
}

export function sha256(value: JsonValue | undefined, path: string): Sha256Id {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail("validation_error", `${path} must be a lowercase sha256 identifier`);
  }
  return value as Sha256Id;
}

export function nullableSha256(value: JsonValue | undefined, path: string): Sha256Id | null {
  return value === null ? null : sha256(value, path);
}

export function arrayValue(
  value: JsonValue | undefined,
  path: string,
  minimum = 0,
  maximum = MAX_REFERENCES,
): JsonValue[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    fail("validation_error", `${path} must contain ${String(minimum)}..${String(maximum)} entries`);
  }
  return value;
}

export function sortedUniqueDigests(
  value: JsonValue | undefined,
  path: string,
  minimum = 0,
  maximum = MAX_REFERENCES,
): readonly Sha256Id[] {
  const refs = arrayValue(value, path, minimum, maximum)
    .map((entry, index) => sha256(entry, `${path}[${String(index)}]`));
  for (let index = 1; index < refs.length; index += 1) {
    if (compareUnicode(refs[index - 1]!, refs[index]!) >= 0) {
      fail("validation_error", `${path} must be strictly sorted and unique`);
    }
  }
  return refs;
}

export function positiveInteger(value: JsonValue | undefined, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    fail("validation_error", `${path} must be a positive safe integer`);
  }
  return value;
}

export function nonNegativeInteger(value: JsonValue | undefined, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("validation_error", `${path} must be a non-negative safe integer`);
  }
  return value;
}

export function isoTimestamp(value: JsonValue | undefined, path: string): string {
  const candidate = boundedText(value, path, 24);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(candidate)) {
    fail("validation_error", `${path} must be RFC 3339 UTC with milliseconds`);
  }
  const parsed = new Date(candidate);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== candidate) {
    fail("validation_error", `${path} must be a real UTC timestamp`);
  }
  return candidate;
}

export function evidenceLevel(value: JsonValue | undefined, path: string): EvidenceLevel {
  return enumValue(value, EVIDENCE_LEVELS, path);
}

export function zeroEffects(value: JsonValue | undefined, path: string): ZeroEffects {
  const candidate = record(value, path);
  exactKeys(candidate, Object.keys(ZERO_EFFECTS), path);
  literal(candidate, ZERO_EFFECTS, path);
  return ZERO_EFFECTS;
}

export function participationRights(
  value: JsonValue | undefined,
  path: string,
): ParticipationRights {
  const candidate = record(value, path);
  exactKeys(candidate, Object.keys(PARTICIPATION_RIGHTS), path);
  literal(candidate, PARTICIPATION_RIGHTS, path);
  return PARTICIPATION_RIGHTS;
}

export function sixLedgerProfile(value: JsonValue | undefined, path: string): SixLedgerProfile {
  const candidate = record(value, path);
  exactKeys(candidate, Object.keys(SIX_LEDGER_PROFILE), path);
  literal(candidate, SIX_LEDGER_PROFILE, path);
  return SIX_LEDGER_PROFILE;
}

export function publicSafeLane(
  value: JsonValue | undefined,
  path: string,
): PublicSafeTheoreticalLane {
  const candidate = record(value, path);
  exactKeys(candidate, Object.keys(PUBLIC_SAFE_THEORETICAL_LANE), path);
  literal(candidate, PUBLIC_SAFE_THEORETICAL_LANE, path);
  return PUBLIC_SAFE_THEORETICAL_LANE;
}

export function assertUniqueIds(values: readonly Sha256Id[], path: string): void {
  if (new Set(values).size !== values.length) {
    fail("validation_error", `${path} must not contain duplicate identifiers`);
  }
}

const PUBLIC_ESCAPE_KEYS = /(?:absolute_path|credential|evidence_text|private_path|private_text|raw_bytes|raw_evidence|secret)/iu;
const ALLOWED_FALSE_BOUNDARY_KEYS = new Set([
  "contains_raw_evidence",
  "raw_evidence_included",
]);

export function assertPublicDigestOnly(value: JsonValue, path: string): void {
  const stack: Array<{ path: string; value: JsonValue }> = [{ path, value }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (typeof current.value === "string") {
      if (/^(?:\/|[A-Za-z]:[\\/]|file:)/u.test(current.value)) {
        fail("validation_error", `${current.path} must not contain an absolute or file locator`);
      }
      continue;
    }
    if (Array.isArray(current.value)) {
      current.value.forEach((entry, index) => stack.push({
        path: `${current.path}[${String(index)}]`,
        value: entry,
      }));
      continue;
    }
    if (current.value !== null && typeof current.value === "object") {
      for (const [key, member] of Object.entries(current.value)) {
        if (PUBLIC_ESCAPE_KEYS.test(key) && !ALLOWED_FALSE_BOUNDARY_KEYS.has(key)) {
          fail("validation_error", `${current.path}.${key} is forbidden on a public digest-only surface`);
        }
        stack.push({ path: `${current.path}.${key}`, value: member });
      }
    }
  }
}
