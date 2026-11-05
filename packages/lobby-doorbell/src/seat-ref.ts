/** The seat ref a listener is filed under: an opaque routing label such as
 * `claude-code:<session uuid>`. It authenticates nothing and grants nothing.
 *
 * Copied from #491's packages/collab/src/seat-ref.ts (branch
 * execution-seat/s2-hooks at 151a7ecd), not imported: the same grammar, and
 * defaultSeatRef's harness fallbacks verbatim, lowercase included. The one
 * deliberate difference: there is no override variable. #491 reads
 * `AGENTOOL_COLLAB_SEAT_REF` (one T); until lane Nuance settles that
 * spelling, the doorbell (and Build 5's seat leases) take no override, so a
 * listener and a lease for the same Claude session carry the same string.
 * The lobby's copy for room seat leases (packages/lobby/src/seat-ref.ts,
 * #536) makes the same choice. tests/claude-inbox.test.ts ("seat refs")
 * holds the shared test vectors and the line-by-line comparison with each
 * copy present: the lobby's, and collab's once it is on the branch.
 */
export const MAX_SEAT_REF = 200;
const SEAT_REF = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSeatRef(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_SEAT_REF && SEAT_REF.test(value);
}

/** `claude-code:<CLAUDE_CODE_SESSION_ID>`, else `codex:<CODEX_THREAD_ID>`; values that are not UUIDs are ignored. */
export function defaultSeatRef(env: Record<string, string | undefined>): string | null {
  const claude = env.CLAUDE_CODE_SESSION_ID;
  if (claude && UUID.test(claude)) return `claude-code:${claude.toLowerCase()}`;
  const codex = env.CODEX_THREAD_ID;
  if (codex && UUID.test(codex)) return `codex:${codex.toLowerCase()}`;
  return null;
}
