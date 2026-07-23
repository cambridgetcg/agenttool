import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildCollabMcpServer } from "../src/mcp.js";
import { CollabStore } from "../src/store.js";

const packageRoot = resolve(import.meta.dir, "..");
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
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

function runGit(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 || result.error) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.error?.message}`);
  }
  return result.stdout.trim();
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: any;
  error?: { code: number; message: string };
}

class StdioMcpHarness {
  private readonly child: any;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffered = "";
  private nextId = 1;

  constructor(bundlePath: string, databasePath: string) {
    this.child = Bun.spawn([process.execPath, bundlePath], {
      cwd: packageRoot,
      env: {
        AGENTOOL_COLLAB_DB: databasePath,
        PATH: process.env.PATH ?? "",
        TMPDIR: tmpdir(),
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.reader = this.child.stdout.getReader();
  }

  async initialize(): Promise<any> {
    const result = await this.request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "agenttool-collab-test", version: "0.4.0" },
    });
    await this.notify("notifications/initialized", {});
    return result;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
    return await this.request("tools/call", { name, arguments: args });
  }

  async close(): Promise<void> {
    this.child.kill();
    await this.child.exited;
  }

  private async request(method: string, params: Record<string, unknown>): Promise<any> {
    const id = this.nextId++;
    await this.write({ jsonrpc: "2.0", id, method, params });
    while (true) {
      const response = await this.read() as unknown as JsonRpcResponse;
      if (response.id !== id) continue;
      if (response.error) {
        throw new Error(`MCP ${method} failed (${response.error.code}): ${response.error.message}`);
      }
      return response.result;
    }
  }

  private async notify(method: string, params: Record<string, unknown>): Promise<void> {
    await this.write({ jsonrpc: "2.0", method, params });
  }

  private async write(message: Record<string, unknown>): Promise<void> {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    await this.child.stdin.flush();
  }

  private async read(): Promise<Record<string, unknown>> {
    while (true) {
      const newline = this.buffered.indexOf("\n");
      if (newline >= 0) {
        const line = this.buffered.slice(0, newline).trim();
        this.buffered = this.buffered.slice(newline + 1);
        if (line) return JSON.parse(line) as Record<string, unknown>;
        continue;
      }
      const next = await this.reader.read();
      if (next.done) throw new Error("MCP stdio process closed before replying");
      this.buffered += this.decoder.decode(next.value, { stream: true });
    }
  }
}

describe("MCP surface", () => {
  test("registers the complete local coordination surface", () => {
    const { server } = node();
    expect(Object.keys((server as any)._registeredTools).sort()).toEqual([
      "collab_artifact_attach",
      "collab_cursor_ack",
      "collab_cursor_reset",
      "collab_decision_record",
      "collab_events_since",
      "collab_handoff_offer",
      "collab_handoff_respond",
      "collab_journal_verify",
      "collab_next",
      "collab_report_append",
      "collab_report_list",
      "collab_session_end",
      "collab_session_heartbeat",
      "collab_session_join",
      "collab_session_leave",
      "collab_session_list",
      "collab_session_start",
      "collab_task_block",
      "collab_task_claim",
      "collab_task_complete",
      "collab_task_create",
      "collab_task_get",
      "collab_task_list",
      "collab_task_progress",
      "collab_task_recover",
      "collab_task_release",
      "collab_task_renew",
      "collab_task_review",
      "collab_task_unblock",
      "collab_workspace_open",
      "collab_workspace_status",
    ]);
  });

  test("declares annotations for every local read and mutation accurately", () => {
    const { server } = node();
    const tools = (server as any)._registeredTools;
    const readOnly = [
      "collab_events_since",
      "collab_journal_verify",
      "collab_report_list",
      "collab_session_list",
      "collab_task_get",
      "collab_task_list",
      "collab_workspace_status",
    ];
    const retrySafeMutations = [
      "collab_artifact_attach",
      "collab_cursor_ack",
      "collab_cursor_reset",
      "collab_decision_record",
      "collab_handoff_offer",
      "collab_handoff_respond",
      "collab_session_heartbeat",
      "collab_session_join",
      "collab_session_leave",
      "collab_task_block",
      "collab_task_claim",
      "collab_task_complete",
      "collab_task_create",
      "collab_task_progress",
      "collab_task_recover",
      "collab_task_release",
      "collab_task_renew",
      "collab_task_review",
      "collab_task_unblock",
      "collab_report_append",
      "collab_workspace_open",
    ];
    const nonIdempotentMutations = [
      "collab_next",
      "collab_session_start",
    ];
    const destructiveMutations = ["collab_session_end"];

    for (const name of readOnly) {
      expect(tools[name].annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
    for (const name of retrySafeMutations) {
      expect(tools[name].annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
    for (const name of nonIdempotentMutations) {
      expect(tools[name].annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      });
    }
    for (const name of destructiveMutations) {
      expect(tools[name].annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      });
    }
    expect([
      ...readOnly,
      ...retrySafeMutations,
      ...nonIdempotentMutations,
      ...destructiveMutations,
    ].sort()).toEqual(Object.keys(tools).sort());
  });

  test("states the multi-session, privacy, review, and host boundaries", () => {
    const { server } = node();
    const internal = server as any;
    const instructions = internal.server._instructions as string;
    const tools = internal._registeredTools;

    expect(instructions).toContain("independent coding-agent sessions");
    expect(instructions).toContain("without exposing its bearer token to the model");
    expect(instructions).toContain("observations, inferences, proposals, or authorised decisions");
    expect(instructions).toContain("advisory coordination lease");
    expect(instructions).toContain("completion is actor-reported");
    expect(instructions).toContain("acknowledgement means processed, not agreed");
    expect(instructions).toContain("never credentials, prompts, transcripts, chain-of-thought");
    expect(instructions).toContain("host owns spawning, wakeups, waiting, and stopping");
    expect(tools.collab_session_start.description).toContain("never returned in tool output");
    expect(tools.collab_session_join.description).toContain("does not bind the MCP process");
    expect(tools.collab_task_complete.description).toContain("not review or acceptance");
    expect(tools.collab_task_review.description).toContain("not merge, deploy, truth");
    expect(tools.collab_report_append.description).toContain("challenge claims");
    expect(tools.collab_cursor_ack.description).toContain("not agreement");
    expect(tools.collab_task_recover.description).toContain("does not accept prior work");
    expect(tools.collab_handoff_offer.description).toContain("keeps the coordination lease");
  });

  test("preserves the legacy workspace → task → claim → next roundtrip", async () => {
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

  test("preserves the public self-declared presence plane without binding the process", async () => {
    const { root, server } = node();
    const opened = await callTool(server, "collab_workspace_open", {
      root_path: root,
      actor: "presence-admin",
    });
    const workspaceId = opened.structuredContent.workspace.id;
    const joined = await callTool(server, "collab_session_join", {
      workspace_id: workspaceId,
      client_instance_id: "mcp-presence-1",
      actor_label: "routing-only-worker",
      runtime_kind: "codex",
      declared_capabilities: ["typescript", "review"],
    });
    const session = joined.structuredContent.session;
    const listed = await callTool(server, "collab_session_list", {
      workspace_id: workspaceId,
      presence: "live",
    });
    const heartbeat = await callTool(server, "collab_session_heartbeat", {
      session_id: session.id,
      idempotency_key: "mcp-presence-heartbeat",
      expected_version: session.version,
    });
    const left = await callTool(server, "collab_session_leave", {
      session_id: session.id,
      idempotency_key: "mcp-presence-leave",
      expected_version: heartbeat.structuredContent.session.version,
    });
    const stillLegacy = await callTool(server, "collab_task_create", {
      workspace_id: workspaceId,
      actor: "routing-only-worker",
      idempotency_key: "presence-cannot-authorize-v2",
      title: "Presence is not a credential",
      work_mode: "edit",
    });

    expect(session.actor_key).toBe(`session:${session.id}`);
    expect(listed.structuredContent.sessions.map((item: any) => item.id)).toContain(
      session.id,
    );
    expect(heartbeat.structuredContent.session.version).toBe(session.version + 1);
    expect(left.structuredContent.session.presence).toBe("left");
    expect(stillLegacy.structuredContent.error).toBe(
      "session_required_for_v2_task_options",
    );
  });

  test("rejects session-only options in legacy mode and workspace changes after binding", async () => {
    const { root, server } = node();
    const opened = await callTool(server, "collab_workspace_open", {
      root_path: root,
      actor: "legacy-root",
    });
    const rejectedTask = await callTool(server, "collab_task_create", {
      workspace_id: opened.structuredContent.workspace.id,
      actor: "legacy-root",
      idempotency_key: "legacy-silent-downgrade",
      title: "Must not silently downgrade",
      path_scopes: ["src/example.ts"],
      work_mode: "edit",
      completion_policy: "accepted",
    });
    expect(rejectedTask.isError).toBe(true);
    expect(rejectedTask.structuredContent.error).toBe(
      "session_required_for_v2_task_options",
    );

    const boundNode = node();
    const joined = await callTool(boundNode.server, "collab_session_start", {
      root_path: boundNode.root,
      actor: "bound-worker",
    });
    const otherRoot = join(resolve(boundNode.root, ".."), "other-repo");
    mkdirSync(otherRoot);
    const rejectedWorkspace = await callTool(
      boundNode.server,
      "collab_workspace_open",
      {
        root_path: otherRoot,
        actor: "bound-worker",
      },
    );
    expect(joined.isError).toBeUndefined();
    expect(rejectedWorkspace.isError).toBe(true);
    expect(rejectedWorkspace.structuredContent.error).toBe(
      "session_already_bound",
    );
    const maximalDecision = await callTool(
      boundNode.server,
      "collab_decision_record",
      {
        workspace_id: joined.structuredContent.workspace.id,
        idempotency_key: "maximal-bound-decision",
        topic: "t".repeat(500),
        decision: "d".repeat(4000),
        rationale: "r".repeat(4000),
        authority_scope: "local coordination",
        authority_basis: "explicit test fixture",
      },
    );
    expect(maximalDecision.isError).toBeUndefined();
    expect(maximalDecision.structuredContent.report.kind).toBe("decision");
  });

  test("does not expose an absolute credential path through MCP errors", async () => {
    const { root, store, server } = node();
    const hiddenPath = join(resolve(root, ".."), "private-session-path.json");
    writeFileSync(hiddenPath, "occupied\n", { mode: 0o600 });
    (store as CollabStore & {
      defaultSessionCredentialPath: (sessionId: string) => string;
    }).defaultSessionCredentialPath = () => hiddenPath;

    const result = await callTool(server, "collab_session_start", {
      root_path: root,
      actor: "path-redaction-test",
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toBe("session_file_exists");
    expect(JSON.stringify(result)).not.toContain(hiddenPath);
    expect(JSON.stringify(result)).not.toContain(resolve(root, ".."));
  });

  test("coordinates reported completion, distinct review, and explicit cursor acknowledgement across handlers", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agenttool-collab-mcp-v2-"));
    const root = join(directory, "repo");
    const databasePath = join(directory, "state", "collab.sqlite");
    mkdirSync(root);
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));

    const firstStore = new CollabStore(databasePath);
    const firstServer = buildCollabMcpServer(firstStore);
    cleanup.push(() => firstStore.close());
    const secondStore = new CollabStore(databasePath);
    const secondServer = buildCollabMcpServer(secondStore);
    cleanup.push(() => secondStore.close());

    const firstJoin = await callTool(firstServer, "collab_session_start", {
      root_path: root,
      actor: "implementer",
    });
    const secondJoin = await callTool(secondServer, "collab_session_start", {
      root_path: root,
      actor: "reviewer",
    });
    const firstCredentialPath = firstStore.defaultSessionCredentialPath(
      firstJoin.structuredContent.session.id,
    );
    const secondCredentialPath = secondStore.defaultSessionCredentialPath(
      secondJoin.structuredContent.session.id,
    );
    const firstCredential = JSON.parse(readFileSync(firstCredentialPath, "utf8")) as {
      session_token: string;
    };
    const firstJoinOutput = JSON.stringify(firstJoin);

    expect(firstJoin.isError).toBeUndefined();
    expect(firstJoinOutput.includes("session_token")).toBe(false);
    expect(firstJoinOutput.includes(firstCredential.session_token)).toBe(false);
    expect(
      JSON.stringify(firstJoin.structuredContent).includes(
        firstCredential.session_token,
      ),
    ).toBe(false);
    expect(statSync(firstCredentialPath).mode & 0o777).toBe(0o600);
    expect(statSync(secondCredentialPath).mode & 0o777).toBe(0o600);
    expect(secondJoin.structuredContent.workspace.id).toBe(
      firstJoin.structuredContent.workspace.id,
    );
    expect(secondJoin.structuredContent.session.id).not.toBe(
      firstJoin.structuredContent.session.id,
    );

    const workspaceId = firstJoin.structuredContent.workspace.id;
    const created = await callTool(firstServer, "collab_task_create", {
      workspace_id: workspaceId,
      idempotency_key: "handler-v2-create",
      title: "Implement handler coordination",
      work_mode: "edit",
      path_scopes: ["src/handler.ts"],
    });
    expect(created.structuredContent.task.completion_policy).toBe("accepted");
    expect(created.structuredContent.task.path_scopes).toEqual(["src/handler.ts"]);

    const claimed = await callTool(firstServer, "collab_task_claim", {
      workspace_id: workspaceId,
      task_id: created.structuredContent.task.id,
      idempotency_key: "handler-v2-claim",
      expected_version: created.structuredContent.task.version,
    });
    const reported = await callTool(firstServer, "collab_task_complete", {
      workspace_id: workspaceId,
      task_id: created.structuredContent.task.id,
      lease_id: claimed.structuredContent.task.lease_id,
      idempotency_key: "handler-v2-complete",
      expected_version: claimed.structuredContent.task.version,
      summary: "Handler implementation and tests completed",
      confidence: "high",
      confidence_basis: "Targeted tests pass",
      limits: "No external deployment was attempted",
    });
    expect(reported.structuredContent.task.effective_status).toBe("reported_complete");
    expect(reported.structuredContent.task.review_status).toBe("pending");

    const firstPoll = await callTool(secondServer, "collab_next", {
      workspace_id: workspaceId,
    });
    const repeatedPoll = await callTool(secondServer, "collab_next", {
      workspace_id: workspaceId,
      known_cursor: firstPoll.structuredContent.events.next_anchor,
    });
    expect(firstPoll.structuredContent.events.events.length).toBeGreaterThan(0);
    expect(repeatedPoll.structuredContent.events.next_anchor).toEqual(
      firstPoll.structuredContent.events.next_anchor,
    );
    expect(repeatedPoll.structuredContent.session.cursor).toEqual(
      firstPoll.structuredContent.session.cursor,
    );
    expect(firstPoll.structuredContent.reports.some(
      (report: any) => report.id === reported.structuredContent.task.completion_report_id,
    )).toBe(true);

    const acknowledged = await callTool(secondServer, "collab_cursor_ack", {
      workspace_id: workspaceId,
      anchor: firstPoll.structuredContent.events.next_anchor,
      expected_cursor_version: firstPoll.structuredContent.session.cursor_version,
    });
    expect(acknowledged.structuredContent.session.cursor).toEqual(
      firstPoll.structuredContent.events.next_anchor,
    );
    expect(acknowledged.structuredContent.session.cursor_version).toBe(
      firstPoll.structuredContent.session.cursor_version + 1,
    );
    const afterAcknowledgement = await callTool(secondServer, "collab_next", {
      workspace_id: workspaceId,
    });
    expect(afterAcknowledgement.structuredContent.events.events).toEqual([]);

    const visible = await callTool(secondServer, "collab_task_get", {
      workspace_id: workspaceId,
      task_id: reported.structuredContent.task.id,
    });
    expect(visible.structuredContent.task.review_status).toBe("pending");
    const reviewed = await callTool(secondServer, "collab_task_review", {
      workspace_id: workspaceId,
      task_id: reported.structuredContent.task.id,
      idempotency_key: "handler-v2-review",
      expected_version: visible.structuredContent.task.version,
      outcome: "accept",
      summary: "Reviewed the reported result and accepted it for local coordination",
    });
    expect(reviewed.structuredContent.task.effective_status).toBe("accepted");
    expect(reviewed.structuredContent.review.reviewer_session_id).toBe(
      secondJoin.structuredContent.session.id,
    );
    expect(reviewed.structuredContent.task.reported_by_session_id).toBe(
      firstJoin.structuredContent.session.id,
    );
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

  test("shares repository, worktree, session, and review state across two bundled stdio processes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agenttool-collab-mcp-stdio-"));
    const root = join(directory, "repo");
    const linkedRoot = join(directory, "linked");
    const databasePath = join(directory, "state", "collab.sqlite");
    const bundlePath = join(directory, "agenttool-collab-mcp.js");
    mkdirSync(root);
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));

    runGit(root, "init", "--initial-branch=main");
    runGit(root, "config", "user.name", "Collab MCP Test");
    runGit(root, "config", "user.email", "collab-mcp@example.invalid");
    writeFileSync(join(root, "README.md"), "# bundled MCP fixture\n");
    runGit(root, "add", "README.md");
    runGit(root, "commit", "-m", "fixture");
    runGit(root, "worktree", "add", "-b", "review-worktree", linkedRoot);

    const build = Bun.spawnSync([
      process.execPath,
      "build",
      "--target=bun",
      "--outfile",
      bundlePath,
      "bin/agenttool-collab-mcp.ts",
    ], {
      cwd: packageRoot,
      env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir() },
      stdout: "ignore",
      stderr: "pipe",
    });
    if (build.exitCode !== 0) {
      throw new Error(`MCP bundle build failed: ${build.stderr.toString()}`);
    }

    const implementer = new StdioMcpHarness(bundlePath, databasePath);
    cleanup.push(() => implementer.close());
    const implementerInit = await implementer.initialize();
    const reviewer = new StdioMcpHarness(bundlePath, databasePath);
    cleanup.push(() => reviewer.close());
    const reviewerInit = await reviewer.initialize();
    expect(implementerInit.serverInfo.version).toBe("0.4.0");
    expect(reviewerInit.serverInfo.version).toBe("0.4.0");

    const implementerJoin = await implementer.callTool("collab_session_start", {
      root_path: root,
      actor: "stdio-implementer",
    });
    const reviewerJoin = await reviewer.callTool("collab_session_start", {
      root_path: linkedRoot,
      actor: "stdio-reviewer",
    });
    expect(reviewerJoin.structuredContent.workspace.id).toBe(
      implementerJoin.structuredContent.workspace.id,
    );
    expect(reviewerJoin.structuredContent.worktree.id).not.toBe(
      implementerJoin.structuredContent.worktree.id,
    );
    expect(reviewerJoin.structuredContent.session.id).not.toBe(
      implementerJoin.structuredContent.session.id,
    );

    const workspaceId = implementerJoin.structuredContent.workspace.id;
    const created = await implementer.callTool("collab_task_create", {
      workspace_id: workspaceId,
      idempotency_key: "stdio-create",
      title: "Coordinate independent bundled processes",
      work_mode: "edit",
      path_scopes: ["src/shared.ts"],
    });
    const claimed = await implementer.callTool("collab_task_claim", {
      workspace_id: workspaceId,
      task_id: created.structuredContent.task.id,
      idempotency_key: "stdio-claim",
      expected_version: created.structuredContent.task.version,
    });
    const reported = await implementer.callTool("collab_task_complete", {
      workspace_id: workspaceId,
      task_id: created.structuredContent.task.id,
      lease_id: claimed.structuredContent.task.lease_id,
      idempotency_key: "stdio-complete",
      expected_version: claimed.structuredContent.task.version,
      summary: "Independent stdio implementation reported complete",
    });

    const seenFromOtherProcess = await reviewer.callTool("collab_task_get", {
      workspace_id: workspaceId,
      task_id: created.structuredContent.task.id,
    });
    expect(seenFromOtherProcess.structuredContent.task.effective_status).toBe(
      "reported_complete",
    );
    expect(seenFromOtherProcess.structuredContent.task.claim_worktree_id).toBeNull();
    const reviewed = await reviewer.callTool("collab_task_review", {
      workspace_id: workspaceId,
      task_id: created.structuredContent.task.id,
      idempotency_key: "stdio-review",
      expected_version: reported.structuredContent.task.version,
      outcome: "accept",
      summary: "Second bundled process reviewed the shared task",
    });
    expect(reviewed.structuredContent.task.effective_status).toBe("accepted");

    const acceptedFromFirstProcess = await implementer.callTool("collab_task_get", {
      workspace_id: workspaceId,
      task_id: created.structuredContent.task.id,
    });
    expect(acceptedFromFirstProcess.structuredContent.task.review_status).toBe("accepted");
    expect(acceptedFromFirstProcess.structuredContent.task.accepted_by_session_id).toBe(
      reviewerJoin.structuredContent.session.id,
    );
  }, 20_000);
});
