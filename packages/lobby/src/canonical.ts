/** Sorted-key, whitespace-free JSON: the exact bytes the desk shows on the
 * terminal before a consequential act and then records in the audit log. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, sortValue(child)]);
    return Object.fromEntries(entries);
  }
  return value;
}

export function sha256Hex(text: string | Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(text);
  return hasher.digest("hex");
}
