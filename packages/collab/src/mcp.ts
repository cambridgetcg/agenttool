import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CollabError } from "./errors.js";
import type { TaskStatus } from "./protocol.js";
import { CollabStore } from "./store.js";

const actor = z.string().min(1).max(200).describe("Stable name for this agent/session, such as root or agent:reviewer");
const key = z.string().min(1).max(200).describe("Unique retry-safe key for this mutation");
const workspaceId = z.string().min(1).describe("Workspace ID returned by collab_workspace_open");
const taskId = z.string().min(1).describe("Task ID");
const leaseId = z.string().min(1).describe("Lease ID returned by collab_task_claim or accepted handoff");
const expectedVersion = z.number().int().positive().describe("Task version last read by the caller");
const ttlSeconds = z.number().int().min(30).max(3600).optional().describe("Lease duration; default 900 seconds, maximum 3600");

export function buildCollabMcpServer(store: CollabStore): McpServer {
  const server = new McpServer(
    { name: "agenttool-collab", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Local-first coordination for parallel coding agents. Start with collab_workspace_open, " +
        "then collab_next. Claim before editing overlapping path scopes, renew long-running leases, " +
        "and attach artifact references before completing. Claims are advisory coordination signals, " +
        "not filesystem locks or authority grants. Handoffs require explicit recipient acceptance. " +
        "Actor names are caller-supplied labels, not authenticated identities. " +
        "Store concise progress and decisions only: never put credentials, prompts, transcripts, " +
        "chain-of-thought, or sensitive source content in the journal.",
    },
  );

  server.registerTool(
    "collab_workspace_open",
    {
      title: "Open a local collaboration workspace",
      description: "Open or return the stable workspace for an existing local repository directory.",
      inputSchema: {
        root_path: z.string().min(1).describe("Absolute or cwd-relative existing repository directory"),
        name: z.string().max(200).optional(),
        actor,
      },
    },
    async (input) => call(() => ({ workspace: store.openWorkspace(input) })),
  );

  server.registerTool(
    "collab_workspace_status",
    {
      title: "Read collaboration status",
      description: "Return task counts, live claims, blockers, and recent decisions.",
      inputSchema: { workspace_id: workspaceId },
    },
    async ({ workspace_id }) => call(() => store.workspaceStatus(workspace_id)),
  );

  server.registerTool(
    "collab_next",
    {
      title: "Read the next useful collaboration state",
      description: "Return this actor's claims, ready work, pending handoffs, and events after a cursor.",
      inputSchema: {
        workspace_id: workspaceId,
        actor,
        after_sequence: z.number().int().nonnegative().optional(),
      },
    },
    async ({ workspace_id, actor, after_sequence }) =>
      call(() => store.nextForActor(workspace_id, actor, after_sequence ?? 0)),
  );

  server.registerTool(
    "collab_task_create",
    {
      title: "Create a bounded collaboration task",
      description: "Create a task with dependency IDs and advisory repository-relative path scopes.",
      inputSchema: {
        workspace_id: workspaceId,
        actor,
        idempotency_key: key,
        task_id: z.string().min(1).max(200).optional(),
        title: z.string().min(1).max(300),
        description: z.string().max(8000).optional(),
        dependencies: z.array(z.string().min(1).max(200)).max(128).optional(),
        path_scopes: z.array(z.string().min(1).max(500)).max(128).optional(),
      },
    },
    async ({ task_id, ...input }) => call(() => ({ task: store.createTask({ ...input, id: task_id }) })),
  );

  server.registerTool(
    "collab_task_list",
    {
      title: "List workspace tasks",
      description: "List task projections. Expired leases are shown as effective_status=lease_expired.",
      inputSchema: {
        workspace_id: workspaceId,
        status: z.enum(["open", "claimed", "blocked", "completed"]).optional(),
      },
    },
    async ({ workspace_id, status }) =>
      call(() => ({ tasks: store.listTasks(workspace_id, status as TaskStatus | undefined) })),
  );

  server.registerTool(
    "collab_task_get",
    {
      title: "Read one task",
      description: "Return a task, its current version and lease, plus attached artifact references.",
      inputSchema: { workspace_id: workspaceId, task_id: taskId },
    },
    async ({ workspace_id, task_id }) => call(() => ({ task: store.getTask(workspace_id, task_id) })),
  );

  server.registerTool(
    "collab_task_claim",
    {
      title: "Claim a task lease",
      description: "Atomically claim ready work if dependencies and path scopes do not conflict.",
      inputSchema: {
        workspace_id: workspaceId,
        task_id: taskId,
        actor,
        idempotency_key: key,
        expected_version: expectedVersion,
        ttl_seconds: ttlSeconds,
      },
    },
    async (input) => call(() => ({ task: store.claimTask(input) })),
  );

  server.registerTool(
    "collab_task_renew",
    {
      title: "Renew a task lease",
      description: "Extend a live lease held by this actor; renewal never shortens the deadline.",
      inputSchema: {
        workspace_id: workspaceId,
        task_id: taskId,
        lease_id: leaseId,
        actor,
        idempotency_key: key,
        expected_version: expectedVersion,
        ttl_seconds: ttlSeconds,
      },
    },
    async (input) => call(() => ({ task: store.renewLease(input) })),
  );

  server.registerTool(
    "collab_task_progress",
    {
      title: "Post concise task progress",
      description: "Record a short result-oriented update; do not store reasoning traces or sensitive content.",
      inputSchema: {
        workspace_id: workspaceId,
        task_id: taskId,
        lease_id: leaseId,
        actor,
        idempotency_key: key,
        expected_version: expectedVersion,
        message: z.string().min(1).max(2000),
      },
    },
    async (input) => call(() => ({ task: store.progressTask(input) })),
  );

  server.registerTool(
    "collab_task_release",
    {
      title: "Release a task lease",
      description: "Return work to the open pool. Use a handoff offer when a particular recipient should be invited.",
      inputSchema: {
        workspace_id: workspaceId,
        task_id: taskId,
        lease_id: leaseId,
        actor,
        idempotency_key: key,
        expected_version: expectedVersion,
        summary: z.string().max(2000).optional(),
      },
    },
    async (input) => call(() => ({ task: store.releaseTask(input) })),
  );

  server.registerTool(
    "collab_task_block",
    {
      title: "Block and release a task",
      description: "Record the blocker and release the current lease/path scopes.",
      inputSchema: {
        workspace_id: workspaceId,
        task_id: taskId,
        lease_id: leaseId,
        actor,
        idempotency_key: key,
        expected_version: expectedVersion,
        blocker: z.string().min(1).max(2000),
      },
    },
    async (input) => call(() => ({ task: store.blockTask(input) })),
  );

  server.registerTool(
    "collab_task_unblock",
    {
      title: "Unblock a task",
      description: "Move a blocked task back to the open pool after its blocker is resolved or re-scoped.",
      inputSchema: {
        workspace_id: workspaceId,
        task_id: taskId,
        actor,
        idempotency_key: key,
        expected_version: expectedVersion,
        note: z.string().max(2000).optional(),
      },
    },
    async (input) => call(() => ({ task: store.unblockTask(input) })),
  );

  server.registerTool(
    "collab_artifact_attach",
    {
      title: "Attach an artifact reference",
      description: "Attach a path, commit, test, data record, or URL reference; bytes remain outside this journal.",
      inputSchema: {
        workspace_id: workspaceId,
        task_id: taskId,
        lease_id: leaseId,
        actor,
        idempotency_key: key,
        expected_version: expectedVersion,
        kind: z.enum(["file", "commit", "test", "data", "url", "other"]),
        uri: z.string().min(1).max(2000),
        sha256: z.string().length(64).optional(),
        media_type: z.string().max(200).optional(),
        label: z.string().max(300).optional(),
      },
    },
    async (input) => call(() => store.attachArtifact(input)),
  );

  server.registerTool(
    "collab_task_complete",
    {
      title: "Complete a claimed task",
      description: "Close a task with a concise outcome summary and release its lease/path scopes.",
      inputSchema: {
        workspace_id: workspaceId,
        task_id: taskId,
        lease_id: leaseId,
        actor,
        idempotency_key: key,
        expected_version: expectedVersion,
        summary: z.string().min(1).max(4000),
      },
    },
    async (input) => call(() => ({ task: store.completeTask(input) })),
  );

  server.registerTool(
    "collab_decision_record",
    {
      title: "Record a collaboration decision",
      description: "Append a visible technical decision. This does not grant deployment, spending, publishing, or messaging authority.",
      inputSchema: {
        workspace_id: workspaceId,
        actor,
        idempotency_key: key,
        topic: z.string().min(1).max(500),
        decision: z.string().min(1).max(4000),
        rationale: z.string().max(4000).optional(),
      },
    },
    async (input) => call(() => ({ decision: store.recordDecision(input) })),
  );

  server.registerTool(
    "collab_handoff_offer",
    {
      title: "Offer a task handoff",
      description: "Invite one actor to take a task. The current holder keeps ownership until explicit acceptance.",
      inputSchema: {
        workspace_id: workspaceId,
        task_id: taskId,
        lease_id: leaseId,
        actor,
        to_actor: z.string().min(1).max(200),
        idempotency_key: key,
        expected_version: expectedVersion,
        summary: z.string().min(1).max(4000),
        ttl_seconds: ttlSeconds,
      },
    },
    async (input) => call(() => store.offerHandoff(input)),
  );

  server.registerTool(
    "collab_handoff_respond",
    {
      title: "Accept or decline a handoff",
      description: "Only the named recipient may respond. Acceptance atomically transfers the lease; decline needs no explanation.",
      inputSchema: {
        workspace_id: workspaceId,
        handoff_id: z.string().min(1),
        actor,
        idempotency_key: key,
        expected_version: expectedVersion,
        response: z.enum(["accept", "decline"]),
        ttl_seconds: ttlSeconds,
      },
    },
    async (input) => call(() => store.respondHandoff(input)),
  );

  server.registerTool(
    "collab_events_since",
    {
      title: "Read the append-only event journal",
      description: "Read ordered events after an exclusive integer cursor and verify the returned page against its predecessor hash.",
      inputSchema: {
        workspace_id: workspaceId,
        after_sequence: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    async ({ workspace_id, after_sequence, limit }) =>
      call(() => store.eventsSince(workspace_id, after_sequence ?? 0, limit ?? 100)),
  );

  return server;
}

function success(payload: unknown) {
  const structured = isRecord(payload) ? payload : { result: payload };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

function failure(error: unknown) {
  const payload = error instanceof CollabError
    ? { error: error.code, message: error.message, ...error.details }
    : { error: "internal_error", message: error instanceof Error ? error.message : String(error) };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: true,
  };
}

async function call<T>(operation: () => T | Promise<T>) {
  try {
    return success(await operation());
  } catch (error) {
    return failure(error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
