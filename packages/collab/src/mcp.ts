import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { CollabError } from "./errors.js";
import type { EventCursor, SessionHandle, TaskStatus } from "./protocol.js";
import {
  removeSessionCredentialFile,
  writeSessionCredentialFile,
} from "./session-file.js";
import { CollabStore } from "./store.js";

const actorLabel = z.string().min(1).max(200)
  .describe("Stable display label; session credentials, not this label, fence session mutations");
const legacyActor = actorLabel.optional();
const key = z.string().min(1).max(200).describe("Unique retry-safe key for this mutation");
const workspaceId = z.string().min(1).describe("Workspace ID returned by workspace open or session join");
const taskId = z.string().min(1).describe("Task ID");
const leaseId = z.string().min(1).describe("Lease ID returned by claim, recovery, or handoff acceptance");
const expectedVersion = z.number().int().positive().describe("Task version last read by the caller");
const ttlSeconds = z.number().int().min(30).max(3600).optional()
  .describe("Lease duration; default 900 seconds, maximum 3600");
const eventAnchor = z.object({
  epoch_id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  hash: z.string().length(64),
});

const localReadOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const localRetrySafeMutation = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const localMutation = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const localDestructiveMutation = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

export interface CollabMcpServerOptions {
  resumed_session?: {
    handle: SessionHandle;
    credential_file: string;
  };
}

interface BoundSession {
  handle: SessionHandle;
  credential_file: string;
}

export function buildCollabMcpServer(
  store: CollabStore,
  options: CollabMcpServerOptions = {},
): McpServer {
  let binding: BoundSession | null = options.resumed_session ?? null;
  const server = new McpServer(
    { name: "agenttool-collab", version: "0.2.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Local-first coordination journal for honest exchange among independent coding-agent sessions. " +
        "Use collab_session_join once per MCP process, then collab_next; a host restart resumes from the " +
        "mode-0600 credential file without exposing its bearer token to the model. Exchange observations, " +
        "inferences, proposals, or authorised decisions as structured reports with evidence, confidence, " +
        "limits, and explicit authority scope. Claim before editing overlapping path scopes and renew long " +
        "work. An advisory coordination lease is not ownership, a filesystem lock, or authority. Edit-task " +
        "completion is actor-reported and remains pending until a distinct session accepts it. Challenges " +
        "remain append-only disagreement; acknowledgement means processed, not agreed. Expired session " +
        "leases require explicit recovery. Git checkpoints are local evidence, not attribution or atomic " +
        "Git/SQLite locks. Store concise coordination facts only—never credentials, prompts, transcripts, " +
        "chain-of-thought, or sensitive source content. Cursor rollback recovery must be enabled by the host " +
        "and completed with an audited cursor reset before session mutations resume. The host owns spawning, " +
        "wakeups, waiting, and stopping.",
    },
  );

  const boundCredential = (allowCursorRecovery = false) => {
    if (!binding) {
      throw new CollabError(
        "session_not_bound",
        "Join a session first or provide legacy actor mode explicitly",
      );
    }
    if (binding.handle.cursor_recovery && !allowCursorRecovery) {
      throw new CollabError(
        "cursor_recovery_required",
        "The host authorized recovery mode; reset to an exact journal anchor before session mutations resume",
        { ...binding.handle.cursor_recovery },
      );
    }
    return binding.handle.credential;
  };
  const requireWorkspace = (id: string) => {
    if (binding && binding.handle.workspace.id !== id) {
      throw new CollabError(
        "session_workspace_mismatch",
        "The bound session belongs to another workspace",
      );
    }
  };
  const requireLegacyActor = (value: string | undefined): string => {
    if (!value) {
      throw new CollabError(
        "actor_required",
        "Legacy mode requires actor; session mode derives it from the bound credential",
      );
    }
    return value;
  };

  server.registerTool(
    "collab_session_join",
    {
      title: "Join an independent local collaboration session",
      description:
        "Create and bind a credential-fenced session. The bearer is written to a mode-0600 local file and is never returned in tool output.",
      annotations: localMutation,
      inputSchema: {
        root_path: z.string().min(1),
        actor: actorLabel,
        role: z.string().max(200).optional(),
        parent_session_id: z.string().min(1).optional(),
        repository_key: z.string().min(1).max(1000).optional(),
      },
    },
    async (input) => call(() => {
      if (binding) {
        throw new CollabError(
          "session_already_bound",
          "This MCP process already has a bound session",
          { session_id: binding.handle.session.id },
        );
      }
      const handle = store.joinSession(input);
      const credentialFile = store.defaultSessionCredentialPath(handle.session.id);
      try {
        const path = writeSessionCredentialFile(credentialFile, handle.credential);
        binding = { handle, credential_file: path };
        return publicSessionBinding(binding);
      } catch (error) {
        try {
          store.endSession({ ...handle.credential, reason: "credential_file_write_failed" });
        } catch {
          // Preserve the original exact file-boundary error. The token was
          // never returned, persisted, or logged.
        }
        throw error;
      }
    }),
  );

  server.registerTool(
    "collab_session_end",
    {
      title: "End the bound collaboration session",
      description:
        "Fence future session mutations and remove the credential file. Live leases must be resolved first; incoming offers expire as an audited refusal.",
      annotations: localDestructiveMutation,
      inputSchema: { reason: z.string().max(2000).optional() },
    },
    async ({ reason }) => call(() => {
      const current = binding;
      if (!current) throw new CollabError("session_not_bound", "No session is bound");
      const ended = store.endSession({ ...current.handle.credential, reason });
      binding = null;
      removeSessionCredentialFile(current.credential_file);
      return {
        session: ended,
        credential_file_removed: true,
        session_file_name: `${ended.id}.json`,
      };
    }),
  );

  server.registerTool(
    "collab_workspace_open",
    {
      title: "Open a local collaboration workspace",
      description:
        "Legacy-compatible workspace open. New independent processes should use collab_session_join.",
      annotations: localRetrySafeMutation,
      inputSchema: {
        root_path: z.string().min(1),
        name: z.string().max(200).optional(),
        actor: actorLabel,
        repository_key: z.string().min(1).max(1000).optional(),
      },
    },
    async (input) => call(() => {
      if (binding) {
        throw new CollabError(
          "session_already_bound",
          "A bound MCP process cannot open or register another workspace",
          { session_id: binding.handle.session.id },
        );
      }
      return { workspace: store.openWorkspace(input) };
    }),
  );

  server.registerTool(
    "collab_workspace_status",
    {
      title: "Read collaboration status",
      description:
        "Return task counts, active sessions and claims, blockers, pending reviews, reports, and decisions.",
      annotations: localReadOnly,
      inputSchema: { workspace_id: workspaceId },
    },
    async ({ workspace_id }) => call(() => store.workspaceStatus(workspace_id)),
  );

  server.registerTool(
    "collab_next",
    {
      title: "Poll the next useful collaboration state",
      description:
        "Poll without acknowledging. Routed reports are bounded to the exact event page; task, conflict, and handoff projections describe the same snapshot head.",
      annotations: localMutation,
      inputSchema: {
        workspace_id: workspaceId,
        actor: legacyActor,
        after_sequence: z.number().int().nonnegative().optional(),
        known_cursor: eventAnchor.optional(),
      },
    },
    async ({ workspace_id, actor, after_sequence, known_cursor }) => call(() => {
      requireWorkspace(workspace_id);
      return binding
        ? store.nextForSession({ ...boundCredential(), known_cursor })
        : store.nextForActor(workspace_id, requireLegacyActor(actor), after_sequence ?? 0);
    }),
  );

  server.registerTool(
    "collab_cursor_ack",
    {
      title: "Acknowledge processed collaboration events",
      description:
        "Monotonically persist an exact epoch/sequence/hash anchor. Acknowledgement records processing, not agreement.",
      annotations: localRetrySafeMutation,
      inputSchema: {
        workspace_id: workspaceId,
        anchor: eventAnchor,
        expected_cursor_version: z.number().int().nonnegative(),
      },
    },
    async ({ workspace_id, anchor, expected_cursor_version }) => call(() => {
      requireWorkspace(workspace_id);
      const session = store.acknowledgeSessionCursor({
        ...boundCredential(),
        anchor,
        expected_cursor_version,
      });
      if (binding) {
        binding.handle = {
          ...binding.handle,
          session,
          credential: {
            ...binding.handle.credential,
            last_cursor: session.cursor,
          },
        };
        writeSessionCredentialFile(
          binding.credential_file,
          binding.handle.credential,
          { replace: true },
        );
      }
      return { session };
    }),
  );

  server.registerTool(
    "collab_cursor_reset",
    {
      title: "Deliberately reset a forked or rolled-back session cursor",
      description:
        "Append an auditable reset reason and CAS the cursor to an exact valid anchor; ordinary polling never resets automatically.",
      annotations: localRetrySafeMutation,
      inputSchema: {
        workspace_id: workspaceId,
        idempotency_key: key,
        target: eventAnchor,
        expected_cursor_version: z.number().int().nonnegative(),
        reason: z.string().min(1).max(2000),
      },
    },
    async ({ workspace_id, ...input }) => call(() => {
      requireWorkspace(workspace_id);
      const session = store.resetSessionCursor({ ...boundCredential(true), ...input });
      if (binding) {
        binding.handle = {
          ...binding.handle,
          cursor_recovery: undefined,
          session,
          credential: {
            ...binding.handle.credential,
            last_cursor: session.cursor,
          },
        };
        writeSessionCredentialFile(
          binding.credential_file,
          binding.handle.credential,
          { replace: true },
        );
      }
      return { session };
    }),
  );

  server.registerTool(
    "collab_task_create",
    {
      title: "Create a bounded collaboration task",
      description:
        "Create a task with dependencies and path scopes. Bound-session edit tasks require non-empty scopes and default to distinct-session acceptance.",
      annotations: localRetrySafeMutation,
      inputSchema: {
        workspace_id: workspaceId,
        actor: legacyActor,
        idempotency_key: key,
        task_id: z.string().min(1).max(200).optional(),
        title: z.string().min(1).max(300),
        description: z.string().max(8000).optional(),
        dependencies: z.array(z.string().min(1).max(200)).max(128).optional(),
        path_scopes: z.array(z.string().min(1).max(500)).max(128).optional(),
        work_mode: z.enum(["coordination", "read_only", "edit"]).optional(),
        completion_policy: z.enum(["reported", "accepted"]).optional(),
        expected_base_sha: z.string().regex(/^[a-fA-F0-9]{40,64}$/).optional(),
      },
    },
    async ({ workspace_id, actor, task_id, ...input }) => call(() => {
      requireWorkspace(workspace_id);
      if (
        !binding
        && (
          input.work_mode !== undefined
          || input.completion_policy !== undefined
          || input.expected_base_sha !== undefined
        )
      ) {
        throw new CollabError(
          "session_required_for_v2_task_options",
          "work_mode, completion_policy, and expected_base_sha require a bound v0.2 session",
        );
      }
      const task = binding
        ? store.createTaskForSession({ ...boundCredential(), ...input, id: task_id })
        : store.createTask({
            workspace_id,
            actor: requireLegacyActor(actor),
            ...input,
            id: task_id,
          });
      return { task };
    }),
  );

  server.registerTool(
    "collab_task_list",
    {
      title: "List workspace tasks",
      description:
        "List projections including recovery_required, reported_complete, review state, sessions, worktrees, and checkpoints.",
      annotations: localReadOnly,
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
      description:
        "Return a task, review/lease/checkpoint state, and artifact references.",
      annotations: localReadOnly,
      inputSchema: { workspace_id: workspaceId, task_id: taskId },
    },
    async ({ workspace_id, task_id }) => call(() => ({ task: store.getTask(workspace_id, task_id) })),
  );

  server.registerTool(
    "collab_task_claim",
    {
      title: "Claim a task coordination lease",
      description:
        "Atomically claim if accepted dependencies and repository-wide path scopes permit it. Expired session leases require collab_task_recover.",
      annotations: localRetrySafeMutation,
      inputSchema: {
        workspace_id: workspaceId,
        task_id: taskId,
        actor: legacyActor,
        idempotency_key: key,
        expected_version: expectedVersion,
        ttl_seconds: ttlSeconds,
      },
    },
    async ({ workspace_id, actor, ...input }) => call(() => {
      requireWorkspace(workspace_id);
      const task = binding
        ? store.claimTaskForSession({ ...boundCredential(), ...input })
        : store.claimTask({ workspace_id, actor: requireLegacyActor(actor), ...input });
      return { task };
    }),
  );

  server.registerTool(
    "collab_task_recover",
    {
      title: "Explicitly recover an expired session lease",
      description:
        "Acknowledge the prior holder/checkpoint and atomically take over after rechecking dependencies and path conflicts; this does not accept prior work.",
      annotations: localRetrySafeMutation,
      inputSchema: {
        workspace_id: workspaceId,
        task_id: taskId,
        idempotency_key: key,
        expected_version: expectedVersion,
        recovery_note: z.string().min(1).max(4000),
        action: z.enum(["takeover", "release", "block"]).optional(),
        blocker: z.string().min(1).max(2000).optional(),
        ttl_seconds: ttlSeconds,
      },
    },
    async ({ workspace_id, ...input }) => call(() => {
      requireWorkspace(workspace_id);
      return {
        task: store.recoverTaskForSession({ ...boundCredential(), ...input }),
      };
    }),
  );

  server.registerTool(
    "collab_task_renew",
    {
      title: "Renew a live task lease",
      description: "Extend the current lease; renewal never shortens it.",
      annotations: localRetrySafeMutation,
      inputSchema: leaseMutationSchema({ ttl_seconds: ttlSeconds }),
    },
    async ({ workspace_id, actor, ...input }) => call(() => {
      requireWorkspace(workspace_id);
      const task = binding
        ? store.renewLeaseForSession({ ...boundCredential(), ...input })
        : store.renewLease({ workspace_id, actor: requireLegacyActor(actor), ...input });
      return { task };
    }),
  );

  server.registerTool(
    "collab_task_progress",
    {
      title: "Post concise task progress",
      description:
        "Record a result-oriented progress note. Use a structured report when evidence, confidence, disagreement, or authority matters.",
      annotations: localRetrySafeMutation,
      inputSchema: leaseMutationSchema({ message: z.string().min(1).max(2000) }),
    },
    async ({ workspace_id, actor, ...input }) => call(() => {
      requireWorkspace(workspace_id);
      const task = binding
        ? store.progressTaskForSession({ ...boundCredential(), ...input })
        : store.progressTask({ workspace_id, actor: requireLegacyActor(actor), ...input });
      return { task };
    }),
  );

  server.registerTool(
    "collab_task_release",
    {
      title: "Release a task lease",
      description:
        "Return work to the open pool. A session-to-session handoff remains an invitation until accepted.",
      annotations: localRetrySafeMutation,
      inputSchema: leaseMutationSchema({ summary: z.string().max(2000).optional() }),
    },
    async ({ workspace_id, actor, ...input }) => call(() => {
      requireWorkspace(workspace_id);
      const task = binding
        ? store.releaseTaskForSession({ ...boundCredential(), ...input })
        : store.releaseTask({ workspace_id, actor: requireLegacyActor(actor), ...input });
      return { task };
    }),
  );

  server.registerTool(
    "collab_task_block",
    {
      title: "Block and release a task",
      description: "Record a blocker and release the current lease/path scopes.",
      annotations: localRetrySafeMutation,
      inputSchema: leaseMutationSchema({ blocker: z.string().min(1).max(2000) }),
    },
    async ({ workspace_id, actor, ...input }) => call(() => {
      requireWorkspace(workspace_id);
      const task = binding
        ? store.blockTaskForSession({ ...boundCredential(), ...input })
        : store.blockTask({ workspace_id, actor: requireLegacyActor(actor), ...input });
      return { task };
    }),
  );

  server.registerTool(
    "collab_task_unblock",
    {
      title: "Unblock a task",
      description: "Move a blocked task back to the open pool with an optional note.",
      annotations: localRetrySafeMutation,
      inputSchema: {
        workspace_id: workspaceId,
        task_id: taskId,
        actor: legacyActor,
        idempotency_key: key,
        expected_version: expectedVersion,
        note: z.string().max(2000).optional(),
      },
    },
    async ({ workspace_id, actor, ...input }) => call(() => {
      requireWorkspace(workspace_id);
      const task = binding
        ? store.unblockTaskForSession({ ...boundCredential(), ...input })
        : store.unblockTask({ workspace_id, actor: requireLegacyActor(actor), ...input });
      return { task };
    }),
  );

  server.registerTool(
    "collab_artifact_attach",
    {
      title: "Attach an artifact reference",
      description:
        "Attach a path, commit, test, data record, or URL reference; bytes remain outside this journal.",
      annotations: localRetrySafeMutation,
      inputSchema: leaseMutationSchema({
        kind: z.enum(["file", "commit", "test", "data", "url", "other"]),
        uri: z.string().min(1).max(2000),
        sha256: z.string().length(64).optional(),
        media_type: z.string().max(200).optional(),
        label: z.string().max(300).optional(),
      }),
    },
    async ({ workspace_id, actor, ...input }) => call(() => {
      requireWorkspace(workspace_id);
      return binding
        ? store.attachArtifactForSession({ ...boundCredential(), ...input })
        : store.attachArtifact({ workspace_id, actor: requireLegacyActor(actor), ...input });
    }),
  );

  server.registerTool(
    "collab_task_complete",
    {
      title: "Report a claimed task complete",
      description:
        "Legacy mode is actor-reported and not review or acceptance. Bound edit tasks produce a structured completion report and remain pending until distinct-session review.",
      annotations: localRetrySafeMutation,
      inputSchema: leaseMutationSchema({
        summary: z.string().min(1).max(4000),
        confidence: z.enum(["high", "medium", "low", "unknown"]).optional(),
        confidence_basis: z.string().max(2000).optional(),
        limits: z.string().max(2000).optional(),
        evidence_refs: z.array(z.string().min(1).max(2000)).max(128).optional(),
      }),
    },
    async ({ workspace_id, actor, ...input }) => call(() => {
      requireWorkspace(workspace_id);
      const task = binding
        ? store.completeTaskForSession({ ...boundCredential(), ...input })
        : store.completeTask({
            workspace_id,
            actor: requireLegacyActor(actor),
            task_id: input.task_id,
            lease_id: input.lease_id,
            idempotency_key: input.idempotency_key,
            expected_version: input.expected_version,
            summary: input.summary,
          });
      return { task };
    }),
  );

  server.registerTool(
    "collab_task_review",
    {
      title: "Review reported task completion",
      description:
        "A distinct active session accepts or requests changes. Acceptance is local coordination review—not merge, deploy, truth, or external authority.",
      annotations: localRetrySafeMutation,
      inputSchema: {
        workspace_id: workspaceId,
        task_id: taskId,
        idempotency_key: key,
        expected_version: expectedVersion,
        outcome: z.enum(["accept", "request_changes"]),
        summary: z.string().min(1).max(4000),
        evidence_refs: z.array(z.string().min(1).max(2000)).max(128).optional(),
      },
    },
    async ({ workspace_id, ...input }) => call(() => {
      requireWorkspace(workspace_id);
      return store.reviewTaskForSession({ ...boundCredential(), ...input });
    }),
  );

  server.registerTool(
    "collab_report_append",
    {
      title: "Append a structured collaboration report",
      description:
        "Append an observation, inference, proposal, or scoped decision. Reports can challenge claims without holding the task lease.",
      annotations: localRetrySafeMutation,
      inputSchema: {
        workspace_id: workspaceId,
        idempotency_key: key,
        task_id: z.string().min(1).optional(),
        to_session_id: z.string().min(1).optional(),
        kind: z.enum(["observation", "inference", "proposal", "decision"]),
        body: z.string().min(1).max(8000),
        evidence_refs: z.array(z.string().min(1).max(2000)).max(128).optional(),
        confidence: z.enum(["high", "medium", "low", "unknown"]).optional(),
        confidence_basis: z.string().max(2000).optional(),
        limits: z.string().max(2000).optional(),
        relation: z.enum([
          "informs",
          "supports",
          "challenges",
          "corrects",
          "withdraws",
          "supersedes",
          "resolves",
        ]).optional(),
        target_report_id: z.string().min(1).optional(),
        authority_scope: z.string().max(1000).optional(),
        authority_basis: z.string().max(2000).optional(),
      },
    },
    async ({ workspace_id, ...input }) => call(() => {
      requireWorkspace(workspace_id);
      return {
        report: store.appendReportForSession({ ...boundCredential(), ...input }),
      };
    }),
  );

  server.registerTool(
    "collab_report_list",
    {
      title: "List structured collaboration reports",
      description:
        "Read append-only reports and branching disagreement by event sequence, task, or addressed session.",
      annotations: localReadOnly,
      inputSchema: {
        workspace_id: workspaceId,
        after_event_sequence: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(500).optional(),
        task_id: z.string().min(1).optional(),
        to_session_id: z.string().min(1).optional(),
      },
    },
    async ({ workspace_id, ...options }) => call(() => ({
      reports: store.listReports(workspace_id, options),
    })),
  );

  server.registerTool(
    "collab_decision_record",
    {
      title: "Record a collaboration decision",
      description:
        "Legacy-compatible decision record. In a bound session this becomes a structured decision report requiring explicit authority scope and basis.",
      annotations: localRetrySafeMutation,
      inputSchema: {
        workspace_id: workspaceId,
        actor: legacyActor,
        idempotency_key: key,
        topic: z.string().min(1).max(500),
        decision: z.string().min(1).max(4000),
        rationale: z.string().max(4000).optional(),
        authority_scope: z.string().max(1000).optional(),
        authority_basis: z.string().max(2000).optional(),
      },
    },
    async ({ workspace_id, actor, authority_scope, authority_basis, ...input }) => call(() => {
      requireWorkspace(workspace_id);
      if (binding) {
        return {
          report: store.appendReportForSession({
            ...boundCredential(),
            idempotency_key: input.idempotency_key,
            kind: "decision",
            body: `${input.topic}: ${input.decision}${input.rationale ? `\nRationale: ${input.rationale}` : ""}`,
            confidence: "unknown",
            authority_scope,
            authority_basis,
          }),
        };
      }
      return {
        decision: store.recordDecision({
          workspace_id,
          actor: requireLegacyActor(actor),
          ...input,
        }),
      };
    }),
  );

  server.registerTool(
    "collab_handoff_offer",
    {
      title: "Offer a task handoff",
      description:
        "Invite another actor/session. The current holder keeps the coordination lease until explicit acceptance.",
      annotations: localRetrySafeMutation,
      inputSchema: leaseMutationSchema({
        to_actor: z.string().min(1).max(200).optional(),
        to_session_id: z.string().min(1).optional(),
        summary: z.string().min(1).max(4000),
        ttl_seconds: ttlSeconds,
      }),
    },
    async ({ workspace_id, actor, to_actor, to_session_id, ...input }) => call(() => {
      requireWorkspace(workspace_id);
      return binding
        ? store.offerHandoffForSession({
            ...boundCredential(),
            ...input,
            to_session_id: requiredString(to_session_id, "to_session_id"),
          })
        : store.offerHandoff({
            workspace_id,
            actor: requireLegacyActor(actor),
            ...input,
            to_actor: requiredString(to_actor, "to_actor"),
          });
    }),
  );

  server.registerTool(
    "collab_handoff_respond",
    {
      title: "Accept or decline a handoff",
      description:
        "Only the named actor/session may respond; acceptance atomically transfers the advisory lease.",
      annotations: localRetrySafeMutation,
      inputSchema: {
        workspace_id: workspaceId,
        handoff_id: z.string().min(1),
        actor: legacyActor,
        idempotency_key: key,
        expected_version: expectedVersion,
        response: z.enum(["accept", "decline"]),
        ttl_seconds: ttlSeconds,
      },
    },
    async ({ workspace_id, actor, ...input }) => call(() => {
      requireWorkspace(workspace_id);
      return binding
        ? store.respondHandoffForSession({ ...boundCredential(), ...input })
        : store.respondHandoff({
            workspace_id,
            actor: requireLegacyActor(actor),
            ...input,
          });
    }),
  );

  server.registerTool(
    "collab_events_since",
    {
      title: "Read the append-only event journal",
      description:
        "Read after an exact hash anchor or legacy integer cursor and verify the returned page. Reading never acknowledges.",
      annotations: localReadOnly,
      inputSchema: {
        workspace_id: workspaceId,
        after_sequence: z.number().int().nonnegative().optional(),
        after_anchor: eventAnchor.optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    async ({ workspace_id, after_sequence, after_anchor, limit }) => call(() => {
      if (after_anchor && after_sequence !== undefined) {
        throw new CollabError(
          "ambiguous_cursor",
          "Provide after_anchor or after_sequence, not both",
        );
      }
      return after_anchor
        ? store.eventsAfterAnchor(workspace_id, after_anchor as EventCursor, limit ?? 100)
        : store.eventsSince(workspace_id, after_sequence ?? 0, limit ?? 100);
    }),
  );

  server.registerTool(
    "collab_journal_verify",
    {
      title: "Verify the full local event journal",
      description:
        "Recompute the mixed-version hash chain. Integrity detects edits; it does not prove recorded claims true.",
      annotations: localReadOnly,
      inputSchema: { workspace_id: workspaceId },
    },
    async ({ workspace_id }) => call(() => ({
      workspace_id,
      chain_valid: store.verifyJournal(workspace_id),
      verification_scope: "full_journal" as const,
    })),
  );

  return server;
}

function leaseMutationSchema<T extends z.ZodRawShape>(extra: T) {
  return {
    workspace_id: workspaceId,
    task_id: taskId,
    lease_id: leaseId,
    actor: legacyActor,
    idempotency_key: key,
    expected_version: expectedVersion,
    ...extra,
  };
}

function publicSessionBinding(binding: BoundSession) {
  return {
    workspace: binding.handle.workspace,
    worktree: binding.handle.worktree,
    session: binding.handle.session,
    credential_file_created: true,
    resume_environment_variable: "AGENTOOL_COLLAB_SESSION_FILE",
    session_file_name: `${binding.handle.session.id}.json`,
    identity_boundary: binding.handle.identity_boundary,
    credential_boundary:
      "credential_file_is_a_local_bearer_secret_never_return_its_contents_to_a_model_or_commit_it",
  };
}

function requiredString(value: string | undefined, field: string): string {
  if (!value) throw new CollabError(`invalid_${field}`, `${field} is required in this mode`);
  return value;
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
