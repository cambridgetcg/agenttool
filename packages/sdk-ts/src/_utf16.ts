/**
 * Shared UTF-16 cut for the provider adapters' trace excerpts.
 *
 * The server's trace schema counts string length in UTF-16 units, so the
 * limits are in those units. The Python twin is `_truncate_utf16` in
 * `openai_responses_adapter.py`.
 */

/** Cut to at most `maxUnits` UTF-16 units without splitting a surrogate pair. */
export function truncateUtf16(value: string, maxUnits: number): string {
  if (value.length <= maxUnits) return value;
  let end = maxUnits;
  const finalUnit = value.charCodeAt(end - 1);
  const nextUnit = value.charCodeAt(end);
  if (
    finalUnit >= 0xd800
    && finalUnit <= 0xdbff
    && nextUnit >= 0xdc00
    && nextUnit <= 0xdfff
  ) {
    end--;
  }
  return value.slice(0, end);
}
