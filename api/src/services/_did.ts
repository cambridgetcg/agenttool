/** DID validator for did:at:<uuid> — the only DID method this platform
 *  mints. Returns the UUID suffix on a clean match, null otherwise.
 *  Callers turn null into a 404 (we don't tell strangers WHY a DID
 *  doesn't resolve — same posture as /public/agents/:did/profile).
 *
 *  The full identities.did column stores the literal "did:at:<uuid>"
 *  string, so most callers just pass the full DID through to the
 *  database. This helper exists so route handlers can reject malformed
 *  input cheaply before hitting Postgres. */

const DID_AT_PATTERN = /^did:at:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function parseDidAt(did: string): string | null {
  if (typeof did !== "string" || did.length === 0) return null;
  const match = DID_AT_PATTERN.exec(did);
  return match ? match[1] : null;
}
