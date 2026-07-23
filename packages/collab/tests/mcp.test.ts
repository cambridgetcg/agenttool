import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCollabMcpServer } from "../src/mcp.js";
import { CollabStore } from "../src/store.js";

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

function node() {
  const directory = mkdtempSync(join(tmpdir(), "agenttool-collab-mcp-"));
  const root = join(directory, "repo");
  mkdirSync(root);
  const store = new CollabStore(join(directory, "collab.sqlite"));
  const server = buildCollabMcpServer(store);
  cleanup.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { root, store, server };
}

async function callTool(server: any, name: string, args: Record<string, unknown> = {}) {
  const registration = server._registeredTools[name];
  if (!registration) throw new Error(`tool not registered: ${name}`);
  return await (registration.handler ?? registration.callback)(args, {});
}

describe("MCP surface", () => {
  test("registers the complete local coordination surface", () => {
    const { server } = node();
    expect(Object.keys((server as any)._registeredTools).sort()).toEqual([
      "collab_artifact_attach",
      "collab_decision_record",
      "collab_events_since",
      "collab_handoff_offer",
      "collab_handoff_respond",
      "collab_journal_verify",
      "collab_next",
      "collab_session_heartbeat",
      "collab_session_join",
      "collab_session_leave",
      "collab_session_list",
      "collab_task_block",
      "collab_task_claim",
      "collab_task_complete",
      "collab_task_create",
      "collab_task_get",
      "collab_task_list",
      "collab_task_progress",
      "collab_task_release",
      "collab_task_renew",
      "collab_task_unblock",
      "collab_workspace_open",
      "collab_workspace_status",
    ]);
  });

  test("declares local side effects and read-only tools accurately", () => {
    const { server } = node();
    const tools = (server as any)._registeredTools;
    const readOnly = [
      "collab_events_since",
      "collab_journal_verify",
      "collab_session_list",
      "collab_task_get",
      "collab_task_list",
      "collab_workspace_status",
    ];

    for (const registration of Object.values(tools) as any[]) {
      expect(registration.annotations.openWorldHint).toBe(false);
      expect(registration.annotations.destructiveHint).toBe(false);
    }
    for (const name of readOnly) {
      expect(tools[name].annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }

    expect(tools.collab_next.annotations.readOnlyHint).toBe(false);
    expect(tools.collab_next.annotations.idempotentHint).toBe(false);
    expect(tools.collab_task_complete.annotations.readOnlyHint).toBe(false);
    expect(tools.collab_task_complete.annotations.idempotentHint).toBe(true);
  });

  test("states the honest exchange, lease, and actor-reported completion boundaries", () => {
    const { server } = node();
    const internal = server as any;
    const instructions = internal.server._instructions as string;
    const tools = internal._registeredTools;

    expect(instructions).toContain("observations, inferences, proposals, or authorised decisions");
    expect(instructions).toContain("advisory coordination lease");
    expect(instructions).toContain("Completion is actor-reported");
    expect(instructions).toContain("use the returned actor_key");
    expect(instructions).toContain("never renews or releases a task lease");
    expect(tools.collab_task_complete.description).toContain("not review or acceptance");
    expect(tools.collab_handoff_offer.description).toContain("keeps the coordination lease");
    expect(tools.collab_session_join.description).toContain("does not authenticate");
    expect(tools.collab_session_heartbeat.description).toContain("never renews a task lease");
  });

  test("runs workspace → task → claim → next through tool handlers", async () => {
    const { root, server } = node();
    const opened = await callTool(server, "collab_workspace_open", { root_path: root, actor: "root" });
    const workspaceId = opened.structuredContent.workspace.id;
    const created = await callTool(server, "collab_task_create", {
      workspace_id: workspaceId,
      actor: "root",
      idempotency_key: "mcp-create",
      title: "MCP roundtrip",
      path_scopes: ["src/mcp.ts"],
    });
    const task = created.structuredContent.task;
    const claimed = await callTool(server, "collab_task_claim", {
      workspace_id: workspaceId,
      task_id: task.id,
      actor: "agent-a",
      idempotency_key: "mcp-claim",
      expected_version: task.version,
    });
    const next = await callTool(server, "collab_next", {
      workspace_id: workspaceId,
      actor: "agent-a",
    });

    expect(claimed.isError).toBeUndefined();
    expect(claimed.structuredContent.task.assignee).toBe("agent-a");
    expect(next.structuredContent.own_claims[0].id).toBe(task.id);
    expect(next.structuredContent.events.chain_valid).toBe(true);
  });

  test("returns typed conflicts as MCP errors", async () => {
    const { root, server } = node();
    const opened = await callTool(server, "collab_workspace_open", { root_path: root, actor: "root" });
    const result = await callTool(server, "collab_task_get", {
      workspace_id: opened.structuredContent.workspace.id,
      task_id: "missing",
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toBe("task_not_found");
  });

  test("joins distinct host sessions and uses their actor keys on existing tools", async () => {
    const { root, server } = node();
    const opened = await callTool(server, "collab_workspace_open", {
      root_path: root,
      actor: "root",
    });
    const workspaceId = opened.structuredContent.workspace.id;
    const codex = await callTool(server, "collab_session_join", {
      workspace_id: workspaceId,
      client_instance_id: "codex-process",
      actor_label: "worker",
      runtime_kind: "codex",
      declared_capabilities: ["edit"],
      ttl_seconds: 30,
    });
    const hermes = await callTool(server, "collab_session_join", {
      workspace_id: workspaceId,
      client_instance_id: "hermes-process",
      actor_label: "worker",
      runtime_kind: "hermes",
      declared_capabilities: ["review"],
      ttl_seconds: 30,
    });
    expect(codex.structuredContent.session.actor_key)
      .not.toBe(hermes.structuredContent.session.actor_key);

    const listed = await callTool(server, "collab_session_list", {
      workspace_id: workspaceId,
      presence: "live",
    });
    expect(listed.structuredContent.sessions).toHaveLength(2);

    const created = await callTool(server, "collab_task_create", {
      workspace_id: workspaceId,
      actor: "root",
      idempotency_key: "create-session-task",
      title: "Session task",
    });
    const claimed = await callTool(server, "collab_task_claim", {
      workspace_id: workspaceId,
      task_id: created.structuredContent.task.id,
      actor: codex.structuredContent.session.actor_key,
      idempotency_key: "claim-session-task",
      expected_version: created.structuredContent.task.version,
    });
    expect(claimed.structuredContent.task.assignee)
      .toBe(codex.structuredContent.session.actor_key);
  });

  test("verifies the full journal and labels the verification scope", async () => {
    const { root, store, server } = node();
    const opened = await callTool(server, "collab_workspace_open", { root_path: root, actor: "root" });
    const workspaceId = opened.structuredContent.workspace.id;

    const valid = await callTool(server, "collab_journal_verify", { workspace_id: workspaceId });
    expect(valid.isError).toBeUndefined();
    expect(valid.structuredContent).toEqual({
      workspace_id: workspaceId,
      chain_valid: true,
      verification_scope: "full_journal",
    });

    store.db.query(`UPDATE events SET payload_json = ? WHERE workspace_id = ? AND sequence = 1`)
      .run('{"changed":true}', workspaceId);
    const tampered = await callTool(server, "collab_journal_verify", { workspace_id: workspaceId });
    expect(tampered.structuredContent.chain_valid).toBe(false);
    expect(tampered.structuredContent.verification_scope).toBe("full_journal");
  });
});
