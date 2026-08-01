import { fail, type WitnessLabErrorCode } from "./errors.js";
import type { ResearchArtifactRef, Sha256Id } from "./types.js";

export type ObjectValue = Record<string, unknown>;

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._+@-]{0,255}$/u;
const OPAQUE_DESCRIPTOR = /^[A-Za-z0-9][A-Za-z0-9._+@-]{0,159}$/u;
const OPAQUE_SOURCE_SUFFIX = /^(?=.{1,256}$)[A-Za-z0-9][A-Za-z0-9._+@-]*(?:\/[A-Za-z0-9][A-Za-z0-9._+@-]*)*$/u;
const NAMESPACED_ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const ARXIV_ARTIFACT_ID = /^(?:[0-9]{4}\.[0-9]{4,5}|[A-Za-z][A-Za-z0-9.-]*\/[0-9]{7})$/u;
const SOURCE_REF_PREFIXES = new Set([
  "artifact",
  "collab",
  "data",
  "paper",
  "passport",
  "report",
  "test",
]);
const COMMIT_REF = /^commit:(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;
const GIT_COMMIT_REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const ARXIV_VERSION = /^v[1-9][0-9]*$/u;
const CANONICAL_TIME = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;
const byteLength = Buffer.byteLength.bind(Buffer);
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const numberIsSafeInteger = Number.isSafeInteger;

function decimalPart(value: string, start: number, end: number): number {
  let output = 0;
  for (let index = start; index < end; index += 1) {
    output = (output * 10) + value.charCodeAt(index) - 48;
  }
  return output;
}

function isGregorianDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1]!;
}

function isOpaqueIdentifier(candidate: string): boolean {
  return OPAQUE_ID.test(candidate) && !candidate.includes("..");
}

function isOpaqueSourceSuffix(candidate: string): boolean {
  return OPAQUE_SOURCE_SUFFIX.test(candidate)
    && !candidate.includes("..")
    && !candidate.startsWith("/");
}

export function object(value: unknown, path: string, code: WitnessLabErrorCode): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code, `${path} must be an object`);
  }
  return value as ObjectValue;
}

export function exactKeys(
  value: ObjectValue,
  expected: readonly string[],
  path: string,
  code: WitnessLabErrorCode,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code, `${path} must contain exactly: ${wanted.join(", ")}`);
  }
}

export function boundedString(
  value: unknown,
  path: string,
  code: WitnessLabErrorCode,
  maximum = 256,
): string {
  if (typeof value !== "string" || value.length === 0 || byteLength(value, "utf8") > maximum) {
    fail(code, `${path} must be a non-empty string of at most ${maximum} UTF-8 bytes`);
  }
  return value;
}

export function enumeration<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  code: WitnessLabErrorCode,
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(code, `${path} is not an allowed value`);
  }
  return value as T;
}

export function opaqueId(
  value: unknown,
  path: string,
  code: WitnessLabErrorCode,
  maximum = 256,
): string {
  const candidate = boundedString(value, path, code, maximum);
  if (!isOpaqueIdentifier(candidate)) {
    fail(code, `${path} must be a bounded opaque token without colon or path separators`);
  }
  return candidate;
}

export function revision(value: unknown, path: string, code: WitnessLabErrorCode): string {
  const candidate = boundedString(value, path, code, 160);
  if (!OPAQUE_DESCRIPTOR.test(candidate)) {
    fail(code, `${path} must be a bounded opaque revision descriptor`);
  }
  return candidate;
}

export function gitCommitRevision(
  value: unknown,
  path: string,
  code: WitnessLabErrorCode,
): string {
  const candidate = boundedString(value, path, code, 64);
  if (!GIT_COMMIT_REVISION.test(candidate)) {
    fail(code, `${path} must be a full lowercase Git commit digest`);
  }
  return candidate;
}

export function nullableDescriptor(
  value: unknown,
  path: string,
  code: WitnessLabErrorCode,
): string | null {
  return value === null ? null : revision(value, path, code);
}

function immutableArtifactRevision(
  value: unknown,
  provider: ResearchArtifactRef["provider"],
  path: string,
  code: WitnessLabErrorCode,
): string {
  const candidate = boundedString(value, path, code, 160);
  const valid = provider === "arxiv"
    ? ARXIV_VERSION.test(candidate)
    : GIT_COMMIT_REVISION.test(candidate);
  if (!valid) {
    fail(
      code,
      provider === "arxiv"
        ? `${path} must be an explicit immutable arXiv version such as v2`
        : `${path} must be a full lowercase Git/Hugging Face commit digest`,
    );
  }
  return candidate;
}

function artifactIdentifier(
  value: unknown,
  provider: ResearchArtifactRef["provider"],
  path: string,
  code: WitnessLabErrorCode,
): string {
  const candidate = boundedString(value, path, code, 256);
  const valid = provider === "arxiv"
    ? ARXIV_ARTIFACT_ID.test(candidate)
    : NAMESPACED_ARTIFACT_ID.test(candidate);
  if (!valid || candidate.includes("..")) {
    fail(
      code,
      provider === "arxiv"
        ? `${path} must be a versionless arXiv identifier`
        : `${path} must be one provider namespace/name identifier, not a locator`,
    );
  }
  return candidate;
}

export function sha256(value: unknown, path: string, code: WitnessLabErrorCode): Sha256Id {
  if (typeof value !== "string" || !SHA256_ID.test(value)) {
    fail(code, `${path} must be a lowercase sha256 content ID`);
  }
  return value as Sha256Id;
}

export function canonicalTime(value: unknown, path: string, code: WitnessLabErrorCode): string {
  const candidate = boundedString(value, path, code, 24);
  const valid = CANONICAL_TIME.test(candidate)
    && isGregorianDate(
      decimalPart(candidate, 0, 4),
      decimalPart(candidate, 5, 7),
      decimalPart(candidate, 8, 10),
    );
  if (!valid) {
    fail(code, `${path} must be a canonical UTC timestamp with millisecond precision`);
  }
  return candidate;
}

export function dateOnly(value: unknown, path: string, code: WitnessLabErrorCode): string {
  const candidate = boundedString(value, path, code, 10);
  const valid = DATE_ONLY.test(candidate) && isGregorianDate(
    decimalPart(candidate, 0, 4),
    decimalPart(candidate, 5, 7),
    decimalPart(candidate, 8, 10),
  );
  if (!valid) {
    fail(code, `${path} must be an ISO calendar date`);
  }
  return candidate;
}

export function boolean(value: unknown, path: string, code: WitnessLabErrorCode): boolean {
  if (typeof value !== "boolean") fail(code, `${path} must be a boolean`);
  return value;
}

export function safeInteger(
  value: unknown,
  path: string,
  code: WitnessLabErrorCode,
  minimum = 0,
  maximum = MAX_SAFE_INTEGER,
): number {
  if (!numberIsSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail(code, `${path} must be a safe integer from ${minimum} through ${maximum}`);
  }
  return value as number;
}

export function nullableSafeInteger(
  value: unknown,
  path: string,
  code: WitnessLabErrorCode,
): number | null {
  return value === null ? null : safeInteger(value, path, code);
}

export function sortedUnique<T extends string>(
  value: unknown,
  path: string,
  parse: (entry: unknown, entryPath: string) => T,
  maximum: number,
  code: WitnessLabErrorCode,
): T[] {
  if (!Array.isArray(value) || value.length > maximum) {
    fail(code, `${path} must be an array with at most ${maximum} entries`);
  }
  const output = value.map((entry, index) => parse(entry, `${path}[${index}]`));
  const sorted = [...output].sort();
  if (new Set(output).size !== output.length || output.some((entry, index) => entry !== sorted[index])) {
    fail(code, `${path} must be canonically sorted and unique`);
  }
  return output;
}

export function sourceRefs(value: unknown, path: string, code: WitnessLabErrorCode): string[] {
  return sortedUnique(
    value,
    path,
    (entry, entryPath) => {
      const candidate = boundedString(entry, entryPath, code, 272);
      if (SHA256_ID.test(candidate) || COMMIT_REF.test(candidate)) return candidate;
      const separator = candidate.indexOf(":");
      const prefix = separator === -1 ? "" : candidate.slice(0, separator);
      const suffix = separator === -1 ? "" : candidate.slice(separator + 1);
      if (!SOURCE_REF_PREFIXES.has(prefix) || !isOpaqueSourceSuffix(suffix)) {
        fail(
          code,
          `${entryPath} must be an opaque source reference, not raw content, a leading/traversal path, or a URL-like scheme`,
        );
      }
      return candidate;
    },
    64,
    code,
  );
}

export function artifactRef(
  value: unknown,
  path: string,
  code: WitnessLabErrorCode,
  providers: readonly string[],
  kinds: readonly string[],
): ResearchArtifactRef {
  const input = object(value, path, code);
  exactKeys(input, ["provider", "kind", "id", "revision"], path, code);
  const provider = enumeration(
    input.provider,
    providers,
    `${path}.provider`,
    code,
  ) as ResearchArtifactRef["provider"];
  const kind = enumeration(
    input.kind,
    kinds,
    `${path}.kind`,
    code,
  ) as ResearchArtifactRef["kind"];
  if (provider === "arxiv" && kind !== "paper") {
    fail(code, `${path} arXiv artifacts must have kind=paper`);
  }
  return {
    provider,
    kind,
    id: artifactIdentifier(input.id, provider, `${path}.id`, code),
    revision: immutableArtifactRevision(input.revision, provider, `${path}.revision`, code),
  };
}
