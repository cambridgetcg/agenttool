/** Seat refs: which execution seat (a Claude Code session, a Codex thread)
 * declares it is sending under a room seat lease.
 *
 * Copied from packages/collab/src/seat-ref.ts on PR #491 (branch
 * execution-seat/s2-hooks at 151a7ecd), not imported: this package's
 * dependencies are pinned (tests/boundary.test.ts). The grammar and the
 * default derivation are the same, lower-casing included, so one session's
 * collab `seat_ref` and its lobby lease sends carry the same string. One
 * deliberate difference: there is no override environment variable here
 * (#491's `AGENTOOL_COLLAB_SEAT_REF` is spelt with one T and is not settled),
 * so only the harness's own session variables count. If #491 changes the
 * grammar or the derivation, this copy follows.
 *
 * A seat ref is an opaque, unverified label. Any process running as the same
 * user can set these variables, so a seat ref authenticates nothing: binding a
 * lease to one is attribution and accident-prevention, not access control.
 * Contract: packages/lobby/README.md#room-seat-leases.
 */
import { LobbyError } from "./errors.js";

export const MAX_SEAT_REF = 200;
const SEAT_REF = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateSeatRef(value: string): string {
  if (value.length === 0 || value.length > MAX_SEAT_REF || !SEAT_REF.test(value)) {
    throw new LobbyError(
      "invalid_seat_ref",
      `a seat ref is 1 to ${MAX_SEAT_REF} characters: letters, digits and . _ : @ / + -, starting with a letter or digit`,
    );
  }
  return value;
}

/**
 * The seat ref a caller declares: `claude-code:<CLAUDE_CODE_SESSION_ID>`,
 * else `codex:<CODEX_THREAD_ID>`, lower-cased. Harness values that are not
 * UUIDs are ignored; with neither, the caller declares no seat (null).
 */
export function defaultSeatRef(env: Record<string, string | undefined>): string | null {
  const claude = env.CLAUDE_CODE_SESSION_ID;
  if (claude && UUID.test(claude)) return `claude-code:${claude.toLowerCase()}`;
  const codex = env.CODEX_THREAD_ID;
  if (codex && UUID.test(codex)) return `codex:${codex.toLowerCase()}`;
  return null;
}
