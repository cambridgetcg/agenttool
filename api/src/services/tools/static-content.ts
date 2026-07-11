/** Shared byte-to-text helpers for bounded static outbound tools.
 *
 * These helpers validate representation metadata and bound returned strings.
 * They do not decide whether a destination is network-safe or whether remote
 * prose is trustworthy; safe-net and the consuming parser own those layers.
 */

import type { SafeNetHeaders } from "../net/safe-fetch";

export interface ParsedTextContentType {
  value: string;
  mime: string;
  charset?: string;
}

export function singleResponseHeader(
  headers: SafeNetHeaders,
  name: string,
): string | undefined {
  for (const [candidate, value] of Object.entries(headers)) {
    if (candidate.toLowerCase() !== name) continue;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

export function parseTextContentType<E extends Error>(
  value: string,
  accepts: (mime: string) => boolean,
  unsupported: () => E,
): ParsedTextContentType {
  const trimmed = value.trim();
  if (Buffer.byteLength(trimmed) > 255) throw unsupported();

  const mime = trimmed.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (
    !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(mime) ||
    !accepts(mime)
  ) {
    throw unsupported();
  }

  const charsetMatch = trimmed.match(
    /;\s*charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/iu,
  );
  const charset = charsetMatch?.[1] ?? charsetMatch?.[2] ?? charsetMatch?.[3];
  return {
    value: trimmed,
    mime,
    ...(charset ? { charset } : {}),
  };
}

export function decodeTextBytes<E extends Error>(
  bytes: Uint8Array,
  charset: string | undefined,
  unsupported: () => E,
): string {
  try {
    return new TextDecoder(charset ?? "utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw unsupported();
  }
}

export function truncateUtf8(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value) <= maximumBytes) return value;

  let low = 0;
  let high = Math.min(value.length, maximumBytes);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle)) <= maximumBytes) low = middle;
    else high = middle - 1;
  }
  let result = value.slice(0, low);
  if (/[\uD800-\uDBFF]$/u.test(result)) result = result.slice(0, -1);
  return result;
}
