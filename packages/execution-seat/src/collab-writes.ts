/**
 * Collab tools whose call leaves something another party cites: a task, report, decision,
 * handoff or artifact. Reads, cursors, presence and session lifecycle are left out.
 */
export const COLLAB_WRITES: ReadonlySet<string> = new Set([
  "collab_task_create",
  "collab_task_claim",
  "collab_task_recover",
  "collab_task_renew",
  "collab_task_progress",
  "collab_task_release",
  "collab_task_block",
  "collab_task_unblock",
  "collab_task_complete",
  "collab_task_review",
  "collab_artifact_attach",
  "collab_report_append",
  "collab_decision_record",
  "collab_handoff_offer",
  "collab_handoff_respond",
]);

/**
 * An MCP tool name, `mcp__<server>__<tool>`, whatever the server is called. Claude Code keeps the
 * server name as configured; Codex 0.162.1 writes `-` in it as `_` (observed 2026-10-18).
 */
const MCP_TOOL = /^mcp__.{1,128}__(collab_[a-z_]{1,64})$/;

/** The collab write a hook's `tool_name` names, or null for any other tool. */
export function collabWrite(toolName: unknown): string | null {
  const tool = typeof toolName === "string" ? MCP_TOOL.exec(toolName)?.[1] : undefined;
  return tool && COLLAB_WRITES.has(tool) ? tool : null;
}
