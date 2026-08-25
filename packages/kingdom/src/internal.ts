import type { KingdomDiagnostic } from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export function makeDiagnostic(
  code: KingdomDiagnostic["code"],
  message: string,
  details: {
    readonly field?: string;
    readonly line?: number;
    readonly card_index?: number;
  } = {},
): KingdomDiagnostic {
  return Object.freeze({
    code,
    message,
    ...(details.field === undefined ? {} : { field: details.field }),
    ...(details.line === undefined ? {} : { line: details.line }),
    ...(details.card_index === undefined
      ? {}
      : { card_index: details.card_index }),
  });
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortDiagnostics(
  diagnostics: readonly KingdomDiagnostic[],
): readonly KingdomDiagnostic[] {
  return Object.freeze(
    [...diagnostics].sort((left, right) => {
      const cardOrder =
        (left.card_index ?? Number.MAX_SAFE_INTEGER) -
        (right.card_index ?? Number.MAX_SAFE_INTEGER);
      if (cardOrder !== 0) return cardOrder;
      const lineOrder =
        (left.line ?? Number.MAX_SAFE_INTEGER) -
        (right.line ?? Number.MAX_SAFE_INTEGER);
      if (lineOrder !== 0) return lineOrder;
      const fieldOrder = compareText(left.field ?? "", right.field ?? "");
      if (fieldOrder !== 0) return fieldOrder;
      const codeOrder = compareText(left.code, right.code);
      return codeOrder !== 0
        ? codeOrder
        : compareText(left.message, right.message);
    }),
  );
}

export const SAFE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
export const UNSAFE_TEXT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

function codePointLength(value: string): number | null {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return null;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return null;
    }
    length += 1;
  }
  return length;
}

export function isSafeBoundedText(
  value: unknown,
  maximum: number,
): value is string {
  if (typeof value !== "string") return false;
  const length = codePointLength(value);
  return (
    length !== null &&
    length >= 1 &&
    length <= maximum &&
    value.trim() === value &&
    !UNSAFE_TEXT_PATTERN.test(value)
  );
}
