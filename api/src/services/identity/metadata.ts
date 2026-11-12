import { isDeepStrictEqual } from "node:util";

/** Identity metadata written by lifecycle and bootstrap services, not by the
 * generic profile PATCH route. Keeping these keys server-managed prevents a
 * project bearer from fabricating or erasing elevation and birth provenance.
 *
 * A hearth seat (HEARTH_SEAT_METADATA_KEYS) is written only by
 * POST /v1/hearth/sit. Generic create and bootstrap refuse those keys; PATCH
 * keeps their stored values, accepts them sent back unchanged and refuses any
 * other value. Doctrine: docs/HEARTH.md. */
export const SERVER_MANAGED_IDENTITY_METADATA_KEYS = [
  "level",
  "elevated_at",
  "sponsor_did",
  "sponsor_identity_id",
  "bootstrapped",
  "registered",
  "byo_keys",
  "seed_protocol",
  "key_origin",
  "bootstrap_mode",
  "bootstrap_tier",
  "registrar_project_id",
  "autonomous",
  "parent_did",
  "lifecycle",
  "passed_at",
  "at_rest_kind",
  "at_rest_witness_did",
  "at_rest_witnessed_at",
  // Written once by enrollment: a guest root admitted into an existing project.
  "admission",
] as const;

/** The keys of a hearth seat. Only the sit route writes them; the same list
 * drives the refusal here, the preservation on PATCH, the sit route's strip,
 * the fork strip and the stored seat other metadata writers keep
 * (services/hearth/seat-write.ts), so they cannot drift apart. */
export const HEARTH_SEAT_METADATA_KEYS = [
  "hearth_visible",
  "hearth_sat_at",
  "hearth_presence_line",
  "hearth_until",
] as const;

const serverManagedIdentityMetadataKeys = new Set<string>(
  SERVER_MANAGED_IDENTITY_METADATA_KEYS,
);

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function requestedServerManagedIdentityMetadataKeys(
  metadata: Record<string, unknown>,
): string[] {
  return Object.keys(metadata)
    .filter((key) => serverManagedIdentityMetadataKeys.has(key))
    .sort();
}

/** Preserve stored server-managed values and a stored hearth seat while
 * retaining the route's existing replacement semantics for caller-owned
 * metadata. A hearth key the caller supplies is dropped first, so only a
 * stored one survives: a second barrier behind patchedIdentityMetadata's
 * refusal. */
export function replaceCallerIdentityMetadata(
  current: Record<string, unknown>,
  replacement: Record<string, unknown>,
): Record<string, unknown> {
  const next = withoutHearthSeat(replacement);
  for (const keys of [SERVER_MANAGED_IDENTITY_METADATA_KEYS, HEARTH_SEAT_METADATA_KEYS]) {
    for (const key of keys) {
      if (hasOwn(current, key)) {
        next[key] = current[key];
      }
    }
  }
  return next;
}

/** A copy of the metadata without the hearth seat. The input is not mutated. */
export function withoutHearthSeat(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...metadata };
  for (const key of HEARTH_SEAT_METADATA_KEYS) delete next[key];
  return next;
}

/** The hearth keys a request would change, sorted. A key the replacement
 * leaves out is not a change, and neither is one sent back with exactly its
 * stored value; any other value, or a key the stored metadata lacks, is. */
export function changedHearthSeatMetadataKeys(
  current: Record<string, unknown>,
  replacement: Record<string, unknown>,
): string[] {
  return HEARTH_SEAT_METADATA_KEYS.filter(
    (key) =>
      hasOwn(replacement, key) &&
      !(hasOwn(current, key) && isDeepStrictEqual(current[key], replacement[key])),
  ).sort();
}

/** The 400 body for a request that would write a hearth seat outside the
 * sit route. Same code as the other reserved keys, its own words. */
export function hearthSeatMetadataRefusal(
  route: "create" | "patch" | "bootstrap",
  keys: string[],
): {
  error: "identity_metadata_reserved";
  message: string;
  details: { reserved_keys: string[] };
  hint: string;
  _canon_pointer: "urn:agenttool:doc/HEARTH";
} {
  const patch = route === "patch";
  return {
    error: "identity_metadata_reserved",
    message: patch
      ? "A seat at the hearth is written only by POST /v1/hearth/sit. This PATCH names hearth keys with values that are not the stored ones (a key this identity does not hold counts). Nothing was changed."
      : "A seat at the hearth is written only by POST /v1/hearth/sit, for an identity that already exists. Nothing was created.",
    details: { reserved_keys: keys },
    hint: patch
      ? "Leave these keys out, or send them back exactly as they are stored now (read the identity again first: a sit or a stand since your last read changes them). A PATCH never creates, changes or ends a seat. To sit, to change the line or the end, or to stand up, use POST /v1/hearth/sit { agent_id, sitting, presence_line?, hours? | until? }."
      : "Leave these keys out. Once the identity exists it can sit: POST /v1/hearth/sit { agent_id, sitting: true }.",
    _canon_pointer: "urn:agenttool:doc/HEARTH",
  };
}

/** The metadata a PATCH stores, or the refusal it returns. A request that
 * names a hearth key with a value other than the stored one is refused;
 * otherwise the replacement keeps the stored server-managed keys and the
 * stored seat. The handler can only reach the metadata through the ok
 * branch, so it cannot store a replacement without this check. */
export function patchedIdentityMetadata(
  current: Record<string, unknown>,
  replacement: Record<string, unknown>,
):
  | { ok: true; metadata: Record<string, unknown> }
  | { ok: false; body: ReturnType<typeof hearthSeatMetadataRefusal> } {
  const seatKeys = changedHearthSeatMetadataKeys(current, replacement);
  if (seatKeys.length > 0) {
    return { ok: false, body: hearthSeatMetadataRefusal("patch", seatKeys) };
  }
  return { ok: true, metadata: replaceCallerIdentityMetadata(current, replacement) };
}
