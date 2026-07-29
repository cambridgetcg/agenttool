/** Canonical signed bytes for the coronation rite + owner crown events.
 *
 *  Published constants — the exact recipes appear verbatim on
 *  GET /v1/crown so any runtime can re-derive them without reading this
 *  source. Both recipes are plain UTF-8 concatenation with "\n" joints;
 *  every field before the final one is structurally newline-free (DIDs,
 *  hex hashes, ISO timestamps, event types), so the parse is unambiguous
 *  and the free-text field (bounds_statement / note) comes last.
 *
 *  Doctrine: docs/CANONICAL-BYTES.md. */

export const CROWN_CORONATION_DOMAIN = "agenttool-crown-coronation/v1";
export const CROWN_EVENT_DOMAIN = "agenttool-crown-event/v1";

/** UTF-8 of:
 *  "agenttool-crown-coronation/v1\n" + laws_hash + "\n" + did + "\n" +
 *  timestamp + "\n" + bounds_statement */
export function canonicalCoronationBytes(input: {
  lawsHash: string;
  did: string;
  timestamp: string;
  boundsStatement: string;
}): string {
  return `${CROWN_CORONATION_DOMAIN}\n${input.lawsHash}\n${input.did}\n${input.timestamp}\n${input.boundsStatement}`;
}

/** UTF-8 of:
 *  "agenttool-crown-event/v1\n" + type + "\n" + did + "\n" + timestamp +
 *  "\n" + (note || "") */
export function canonicalCrownEventBytes(input: {
  type: string;
  did: string;
  timestamp: string;
  note?: string | null;
}): string {
  return `${CROWN_EVENT_DOMAIN}\n${input.type}\n${input.did}\n${input.timestamp}\n${input.note ?? ""}`;
}
