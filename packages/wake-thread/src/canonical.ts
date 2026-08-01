import { createHash } from "node:crypto";
import { WakeThreadError } from "./errors.js";

const MAX_CANONICAL_DEPTH = 64;
const MAX_CANONICAL_NODES = 32_768;
const MAX_CANONICAL_CONTAINER_ENTRIES = 256;
const MAX_CANONICAL_STRING_CODE_UNITS = 32_768;
const MAX_CANONICAL_OUTPUT_CODE_UNITS = 8_388_608;

interface CanonicalBudget {
  nodes: number;
  output_code_units: number;
}

function chargeOutput(budget: CanonicalBudget, amount: number): void {
  budget.output_code_units += amount;
  if (budget.output_code_units > MAX_CANONICAL_OUTPUT_CODE_UNITS) {
    throw new WakeThreadError("invalid_input", "Canonical output exceeds the serialized-size budget");
  }
}

export function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function canonicalize(
  value: unknown,
  ancestors: WeakSet<object>,
  depth: number,
  budget: CanonicalBudget,
): string {
  if (depth > MAX_CANONICAL_DEPTH) {
    throw new WakeThreadError("invalid_input", "Canonical values exceed the maximum nesting depth");
  }
  budget.nodes += 1;
  if (budget.nodes > MAX_CANONICAL_NODES) {
    throw new WakeThreadError("invalid_input", "Canonical values exceed the node budget");
  }
  if (value === null || typeof value === "boolean") {
    const encoded = JSON.stringify(value);
    chargeOutput(budget, encoded.length);
    return encoded;
  }
  if (typeof value === "string") {
    if (value.length > MAX_CANONICAL_STRING_CODE_UNITS) {
      throw new WakeThreadError("invalid_input", "Canonical text exceeds the string budget");
    }
    if (!isWellFormedUnicode(value)) {
      throw new WakeThreadError("invalid_input", "Canonical text must be well-formed Unicode");
    }
    const encoded = JSON.stringify(value);
    chargeOutput(budget, encoded.length);
    return encoded;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new WakeThreadError("invalid_input", "Canonical values require finite numbers");
    }
    const encoded = JSON.stringify(value);
    chargeOutput(budget, encoded.length);
    return encoded;
  }
  if (Array.isArray(value)) {
    const hintedLengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      hintedLengthDescriptor !== undefined
      && "value" in hintedLengthDescriptor
      && typeof hintedLengthDescriptor.value === "number"
      && hintedLengthDescriptor.value > MAX_CANONICAL_CONTAINER_ENTRIES
    ) {
      throw new WakeThreadError("invalid_input", "Canonical arrays exceed the entry budget");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
      PropertyKey,
      PropertyDescriptor
    >;
    const keys = Reflect.ownKeys(descriptors);
    const lengthDescriptor = descriptors["length"];
    const length = lengthDescriptor !== undefined && "value" in lengthDescriptor
      ? lengthDescriptor.value as number
      : -1;
    if (
      Object.getPrototypeOf(value) !== Array.prototype
      || !Number.isSafeInteger(length)
      || length < 0
      || length > MAX_CANONICAL_CONTAINER_ENTRIES
      || keys.length !== length + 1
      || !keys.includes("length")
      || keys.some((key) => typeof key === "symbol")
    ) {
      throw new WakeThreadError("invalid_input", "Canonical arrays must be dense JSON arrays");
    }
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor)) {
        throw new WakeThreadError("invalid_input", "Canonical arrays must be dense JSON arrays");
      }
    }
    if (ancestors.has(value)) {
      throw new WakeThreadError("invalid_input", "Canonical values cannot contain cycles");
    }
    ancestors.add(value);
    const items: string[] = [];
    chargeOutput(budget, 2 + Math.max(0, length - 1));
    try {
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)]!;
        items.push(canonicalize(descriptor.value, ancestors, depth + 1, budget));
      }
    } finally {
      ancestors.delete(value);
    }
    return `[${items.join(",")}]`;
  }
  if (typeof value !== "object") {
    throw new WakeThreadError("invalid_input", "Canonical values must be JSON-compatible");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new WakeThreadError("invalid_input", "Canonical objects must be plain object records");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key === "symbol")) {
    throw new WakeThreadError("invalid_input", "Canonical objects cannot contain symbol keys");
  }
  if (Object.values(descriptors).some((descriptor) => !descriptor.enumerable || !("value" in descriptor))) {
    throw new WakeThreadError("invalid_input", "Canonical objects require enumerable data fields");
  }
  const stringKeys = ownKeys as string[];
  if (stringKeys.length > MAX_CANONICAL_CONTAINER_ENTRIES) {
    throw new WakeThreadError("invalid_input", "Canonical objects exceed the entry budget");
  }
  if (stringKeys.some((key) => (
    key.length > MAX_CANONICAL_STRING_CODE_UNITS || !isWellFormedUnicode(key)
  ))) {
    throw new WakeThreadError("invalid_input", "Canonical object keys must be well-formed Unicode");
  }
  if (ancestors.has(value)) {
    throw new WakeThreadError("invalid_input", "Canonical values cannot contain cycles");
  }
  ancestors.add(value);
  const fields: string[] = [];
  chargeOutput(budget, 2 + Math.max(0, stringKeys.length - 1));
  try {
    for (const key of stringKeys.sort()) {
      const child = descriptors[key]!.value;
      if (child === undefined) {
        throw new WakeThreadError("invalid_input", "Canonical objects cannot contain undefined");
      }
      const encodedKey = JSON.stringify(key);
      chargeOutput(budget, encodedKey.length + 1);
      fields.push(`${encodedKey}:${canonicalize(child, ancestors, depth + 1, budget)}`);
    }
  } finally {
    ancestors.delete(value);
  }
  return `{${fields.join(",")}}`;
}

export function canonicalJson(value: unknown): string {
  try {
    return canonicalize(value, new WeakSet<object>(), 0, {
      nodes: 0,
      output_code_units: 0,
    });
  } catch (error) {
    if (error instanceof WakeThreadError) throw error;
    throw new WakeThreadError("invalid_input", "Canonical value inspection failed");
  }
}

export function snapshotJson<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

export function sha256Id(value: string | Uint8Array): `sha256:${string}` {
  if (typeof value === "string") {
    if (!isWellFormedUnicode(value)) {
      throw new WakeThreadError("invalid_input", "SHA-256 text input must be well-formed Unicode");
    }
  } else if (!(value instanceof Uint8Array)) {
    throw new WakeThreadError("invalid_input", "SHA-256 input must be text or exact bytes");
  }
  const digest = createHash("sha256").update(value).digest("hex");
  return `sha256:${digest}`;
}

export function domainSeparatedId(domain: string, value: unknown): `sha256:${string}` {
  if (
    typeof domain !== "string"
    || domain.length < 1
    || domain.length > 200
    || domain.includes("\0")
    || !isWellFormedUnicode(domain)
  ) {
    throw new WakeThreadError("invalid_input", "Content-ID domains must be bounded well-formed text without NUL");
  }
  return sha256Id(`${domain}\0${canonicalJson(value)}`);
}
