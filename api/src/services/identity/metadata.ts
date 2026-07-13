/** Identity metadata written by lifecycle and bootstrap services, not by the
 * generic profile PATCH route. Keeping these keys server-managed prevents a
 * project bearer from fabricating or erasing elevation and birth provenance. */
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
] as const;

const serverManagedIdentityMetadataKeys = new Set<string>(
  SERVER_MANAGED_IDENTITY_METADATA_KEYS,
);

export function requestedServerManagedIdentityMetadataKeys(
  metadata: Record<string, unknown>,
): string[] {
  return Object.keys(metadata)
    .filter((key) => serverManagedIdentityMetadataKeys.has(key))
    .sort();
}

/** Preserve stored server-managed values while retaining the route's existing
 * replacement semantics for caller-owned metadata. */
export function replaceCallerIdentityMetadata(
  current: Record<string, unknown>,
  replacement: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...replacement };
  for (const key of SERVER_MANAGED_IDENTITY_METADATA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(current, key)) {
      next[key] = current[key];
    }
  }
  return next;
}
