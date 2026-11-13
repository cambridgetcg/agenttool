import { CollabError } from "./errors.js";

/**
 * A seat ref is an opaque, unverified routing hint naming the execution seat
 * that started a coordination session, such as `claude-code:<session uuid>`.
 * Collab stores it and matches it exactly; it never parses, resolves or
 * trusts it, and it authenticates nothing.
 */
export const MAX_SEAT_REF = 200;
const SEAT_REF = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SEAT_REF_ENVIRONMENT_VARIABLE = "AGENTOOL_COLLAB_SEAT_REF";

export function validateSeatRef(value: string): string {
  if (value.length === 0 || value.length > MAX_SEAT_REF || !SEAT_REF.test(value)) {
    throw new CollabError(
      "invalid_seat_ref",
      `seat_ref is 1 to ${MAX_SEAT_REF} characters: letters, digits and . _ : @ / + -, starting with a letter or digit`,
    );
  }
  return value;
}

/**
 * The seat ref an MCP process declares when the caller passes none:
 * `AGENTOOL_COLLAB_SEAT_REF` as set by the host (refused if invalid), else
 * `claude-code:<CLAUDE_CODE_SESSION_ID>`, which Claude Code sets for stdio MCP
 * servers to the session ID current when it spawned them, else
 * `codex:<CODEX_THREAD_ID>`, which Codex sets for shell commands (not
 * observed for MCP servers). Harness values that are not UUIDs are ignored.
 */
export function defaultSeatRef(env: Record<string, string | undefined>): string | null {
  const declared = env[SEAT_REF_ENVIRONMENT_VARIABLE];
  if (declared !== undefined && declared !== "") return validateSeatRef(declared);
  const claude = env.CLAUDE_CODE_SESSION_ID;
  if (claude && UUID.test(claude)) return `claude-code:${claude.toLowerCase()}`;
  const codex = env.CODEX_THREAD_ID;
  if (codex && UUID.test(codex)) return `codex:${codex.toLowerCase()}`;
  return null;
}
