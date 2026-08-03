import {
  canonicalJson,
  domainSeparatedId,
  type Sha256Id,
} from "@agenttool/wake-continuity";

export type DataPrimitive = string | number | boolean | null;
export type DataValue =
  | DataPrimitive
  | DataValue[]
  | { [key: string]: DataValue };

export function snapshotData(value: unknown): DataValue {
  return JSON.parse(canonicalJson(value)) as DataValue;
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value as Record<string, unknown>)) {
      deepFreeze(item);
    }
    Object.freeze(value);
  }
  return value;
}

export function contentId(domain: string, value: unknown): Sha256Id {
  return domainSeparatedId(domain, value);
}

export function canonicalString(value: unknown): string {
  return canonicalJson(value);
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new Uint8Array(Buffer.from(canonicalJson(value), "utf8"));
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
