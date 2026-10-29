import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
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
import { EVIDENCE_REF_PREFIXES, EVIDENCE_REFS_DESCRIPTION } from "../src/protocol.js";
import { CollabStore } from "../src/store.js";
import { COLLAB_PACKAGE_VERSION } from "../src/version.js";

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

  constructor(bundlePath: string, databasePath: string, hostEnv: Record<string, string> = {}) {
    this.child = Bun.spawn([process.execPath, bundlePath], {
      cwd: packageRoot,
      env: {
        AGENTOOL_COLLAB_DB: databasePath,
        PATH: process.env.PATH ?? "",
        TMPDIR: tmpdir(),
        GIT_CEILING_DIRECTORIES: tmpdir(),
        ...hostEnv,
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
      clientInfo: { name: "agenttool-collab-test", version: "0.3.0" },
    });
    await this.notify("notifications/initialized", {});
    return result;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
    return await this.request("tools/call", { name, arguments: args });
  }

  async listTools(): Promise<any> {
    return await this.request("tools/list", {});
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
      "collab_anchor_status",
      "collab_artifact_attach",
      "collab_cursor_ack",
      "collab_cursor_reset",
      "collab_decision_record",
      "collab_events_since",
      "collab_events_wait",
      "collab_handoff_offer",
      "collab_handoff_respond",
      "collab_journal_verify",
      "collab_next",
      "collab_proposal_open",
      "collab_proposal_relay_rejection",
      "collab_proposal_status",
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

  test("carries actor defaults and child binding selectors over real bundled stdio", async () => {
    const directory = mkdtempSync(join(tmpdir(), "collab-fit-stdio-"));
    const root = join(directory, "repo");
    const config = join(directory, "claude");
    mkdirSync(root);
    mkdirSync(join(config, "sessions"), { recursive: true });
    const pid = process.pid;
    const socket = `/fixture/${pid}.sock`;
    const procStart = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C", TZ: "UTC" } }).stdout.trim();
    writeFileSync(join(config, `sessions/${pid}.json`), JSON.stringify({ pid, name: "host-name", procStart, messagingSocketPath: socket, extra: "metadata-not-for-output" }));
    const client = new StdioMcpHarness(join(packageRoot, "dist/agenttool-collab-mcp.js"), join(directory, "collab.sqlite"), {
      HOME: directory, CLAUDE_CONFIG_DIR: config, AGENTOOL_COLLAB_CLAUDE_PID: String(pid), CLAUDE_CODE_MESSAGING_SOCKET: socket,
    });
    cleanup.push(async () => { await client.close(); rmSync(directory, { recursive: true, force: true }); });
    await client.initialize();
    const tools = (await client.listTools()).tools;
    expect(tools.find((item: any) => item.name === "collab_session_start").inputSchema.required).not.toContain("actor");
    expect(tools.find((item: any) => item.name === "collab_task_renew").inputSchema.required).not.toContain("expected_version");
    const parent = (await client.callTool("collab_session_start", { root_path: root })).structuredContent;
    expect(parent.session.actor).toBe("host-name");
    expect((await client.callTool("collab_session_start", {
      root_path: root, binding_key: "child", parent_session_id: parent.session.id,
    })).structuredContent.error).toBe("actor_required");
    const child = (await client.callTool("collab_session_start", {
      root_path: root, actor: "explicit-child", binding_key: "child", parent_session_id: parent.session.id,
    })).structuredContent;
    expect(child.session.actor).toBe("explicit-child");
    expect(child.session.id).not.toBe(parent.session.id);
    const workspace_id = parent.workspace.id;
    const task = (await client.callTool("collab_task_create", {
      workspace_id, binding_key: "child", idempotency_key: "create", title: "child", work_mode: "coordination",
    })).structuredContent.task;
    const claim = (await client.callTool("collab_task_claim", {
      workspace_id, binding_key: "child", idempotency_key: "claim", task_id: task.id, expected_version: task.version,
    })).structuredContent.task;
    const renewed = await client.callTool("collab_task_renew", {
      workspace_id, binding_key: "child", idempotency_key: "renew", task_id: task.id, lease_id: claim.lease_id,
    });
    expect(renewed.isError).toBeUndefined();
    expect(renewed.structuredContent.task.version).toBe(claim.version);
    expect((await client.callTool("collab_next", { workspace_id })).structuredContent.session.id).toBe(parent.session.id);
    expect((await client.callTool("collab_session_end", { binding_key: "child", release_leases: true })).isError).toBeUndefined();
    expect((await client.callTool("collab_session_end", { release_leases: true })).isError).toBeUndefined();
    expect(JSON.stringify([parent, child])).not.toContain("session_token");
    expect(JSON.stringify([parent, child])).not.toContain("metadata-not-for-output");
  });

  test("keeps anchor ledger path selection host-only", () => {
    const { server } = node();
    const tool = (server as any)._registeredTools.collab_anchor_status;
    expect(Object.keys(tool.inputSchema.shape)).toEqual(["workspace_id", "binding_key"]);
    expect(tool.description).toContain("Local file read only");
    expect(tool.description).toContain("cannot choose or discover it");
  });

  test("declares annotations for every local read and mutation accurately", () => {
    const { server } = node();
    const tools = (server as any)._registeredTools;
    const readOnly = [
      "collab_anchor_status",
      "collab_events_since",
      "collab_events_wait",
      "collab_journal_verify",
      "collab_proposal_status",
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
      "collab_proposal_open",
      "collab_proposal_relay_rejection",
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

  test("bounds legacy collab_next MCP pages and paginates them losslessly", async () => {
    const { root, store, server } = node();
    const opened = await callTool(server, "collab_workspace_open", {
      root_path: root,
      actor: "legacy-coordinator",
    });
    const workspaceId = opened.structuredContent.workspace.id;
    for (let index = 0; index < 55; index += 1) {
      store.createTask({
        workspace_id: workspaceId,
        actor: "legacy-coordinator",
        idempotency_key: `legacy-page-task-${index}`,
        title: `Legacy page task ${index}`,
      });
    }

    const fullPage = store.eventsSince(workspaceId, 0, 500);
    expect(fullPage.events.length).toBeGreaterThan(55);
    expect(store.nextForActor(workspaceId, "legacy-reader").events.events).toHaveLength(50);

    const inputSchema = (server as any)._registeredTools.collab_next.inputSchema;
    expect(inputSchema.safeParse({
      workspace_id: workspaceId,
      actor: "legacy-reader",
      event_limit: 1,
    }).success).toBe(true);
    expect(inputSchema.safeParse({
      workspace_id: workspaceId,
      actor: "legacy-reader",
      event_limit: 50,
    }).success).toBe(true);
    for (const eventLimit of [0, 51, 1.5]) {
      expect(inputSchema.safeParse({
        workspace_id: workspaceId,
        actor: "legacy-reader",
        event_limit: eventLimit,
      }).success).toBe(false);
      const rejected = await callTool(server, "collab_next", {
        workspace_id: workspaceId,
        actor: "legacy-reader",
        event_limit: eventLimit,
      });
      expect(rejected.isError).toBe(true);
      expect(rejected.structuredContent.error).toBe("invalid_event_limit");
    }

    const defaultPage = await callTool(server, "collab_next", {
      workspace_id: workspaceId,
      actor: "legacy-reader",
    });
    const singleEventPage = await callTool(server, "collab_next", {
      workspace_id: workspaceId,
      actor: "legacy-reader",
      event_limit: 1,
    });
    const maximumPage = await callTool(server, "collab_next", {
      workspace_id: workspaceId,
      actor: "legacy-reader",
      event_limit: 50,
    });
    expect(defaultPage.structuredContent.events.events).toHaveLength(10);
    expect(singleEventPage.structuredContent.events.events).toHaveLength(1);
    expect(maximumPage.structuredContent.events.events).toHaveLength(50);
    expect(defaultPage.structuredContent.events.has_more).toBe(true);
    expect(maximumPage.structuredContent.events.has_more).toBe(true);
    expect(defaultPage.structuredContent.events.head_hash).toBe(fullPage.head_hash);
    expect(singleEventPage.structuredContent.events.next_anchor.hash).toBe(
      singleEventPage.structuredContent.events.events[0].hash,
    );

    const seenSequences: number[] = [];
    let afterSequence = 0;
    while (true) {
      const result = await callTool(server, "collab_next", {
        workspace_id: workspaceId,
        actor: "legacy-reader",
        after_sequence: afterSequence,
      });
      const page = result.structuredContent.events;
      expect(page.cursor.sequence).toBe(afterSequence);
      expect(page.events.length).toBeLessThanOrEqual(10);
      expect(page.chain_valid).toBe(true);
      expect(page.verification_scope).toBe("returned_page");
      seenSequences.push(...page.events.map((event: any) => event.sequence));
      afterSequence = page.next_anchor.sequence;
      if (!page.has_more) break;
    }
    expect(seenSequences).toEqual(fullPage.events.map((event) => event.sequence));
  });

  test("bounds credential-bound collab_next pages without changing cursor authority", async () => {
    const { root, store, server } = node();
    const joined = await callTool(server, "collab_session_start", {
      root_path: root,
      actor: "bound-reader",
    });
    const workspaceId = joined.structuredContent.workspace.id;
    for (let index = 0; index < 55; index += 1) {
      store.createTask({
        workspace_id: workspaceId,
        actor: "fixture-writer",
        idempotency_key: `bound-page-task-${index}`,
        title: `Bound page task ${index}`,
      });
    }

    const defaultPage = await callTool(server, "collab_next", {
      workspace_id: workspaceId,
      actor: "spoofed-reader",
    });
    const singleEventPage = await callTool(server, "collab_next", {
      workspace_id: workspaceId,
      event_limit: 1,
    });
    const maximumPage = await callTool(server, "collab_next", {
      workspace_id: workspaceId,
      event_limit: 50,
    });
    expect(defaultPage.structuredContent.actor).toBe("bound-reader");
    expect(defaultPage.structuredContent.events.events).toHaveLength(10);
    expect(singleEventPage.structuredContent.events.events).toHaveLength(1);
    expect(maximumPage.structuredContent.events.events).toHaveLength(50);

    for (const eventLimit of [0, 51, 1.5]) {
      const rejected = await callTool(server, "collab_next", {
        workspace_id: workspaceId,
        event_limit: eventLimit,
      });
      expect(rejected.isError).toBe(true);
      expect(rejected.structuredContent.error).toBe("invalid_event_limit");
    }

    const repeatedFromPersistedCursor = await callTool(server, "collab_next", {
      workspace_id: workspaceId,
      known_cursor: defaultPage.structuredContent.events.next_anchor,
      event_limit: 1,
    });
    expect(repeatedFromPersistedCursor.structuredContent.events.cursor).toEqual(
      defaultPage.structuredContent.events.cursor,
    );
    expect(repeatedFromPersistedCursor.structuredContent.events.events[0].sequence).toBe(
      defaultPage.structuredContent.events.events[0].sequence,
    );

    const acknowledged = await callTool(server, "collab_cursor_ack", {
      workspace_id: workspaceId,
      anchor: defaultPage.structuredContent.events.next_anchor,
      expected_cursor_version: defaultPage.structuredContent.session.cursor_version,
    });
    const afterAcknowledgement = await callTool(server, "collab_next", {
      workspace_id: workspaceId,
      event_limit: 1,
    });
    expect(acknowledged.structuredContent.session.cursor).toEqual(
      defaultPage.structuredContent.events.next_anchor,
    );
    expect(afterAcknowledgement.structuredContent.events.cursor).toEqual(
      acknowledged.structuredContent.session.cursor,
    );
    expect(afterAcknowledgement.structuredContent.events.events[0].sequence).toBe(
      acknowledged.structuredContent.session.cursor.sequence + 1,
    );
  });

  test("refuses a bound collab_next after_sequence that is not the acknowledged cursor", async () => {
    const { root, store, server } = node();
    const nextTool = (server as any)._registeredTools.collab_next;
    expect(nextTool.inputSchema.shape.after_sequence.description).toContain(
      "after_sequence_unsupported_in_bound_session",
    );
    expect(nextTool.description).toContain("collab_cursor_ack");
    const joined = await callTool(server, "collab_session_start", {
      root_path: root,
      actor: "bound-pager",
    });
    const workspaceId = joined.structuredContent.workspace.id;
    for (let index = 0; index < 3; index += 1) {
      store.createTask({
        workspace_id: workspaceId,
        actor: "fixture-writer",
        idempotency_key: `after-sequence-task-${index}`,
        title: `After-sequence task ${index}`,
      });
    }

    const first = await callTool(server, "collab_next", { workspace_id: workspaceId });
    expect(first.isError).toBeUndefined();
    const cursor = first.structuredContent.session.cursor;
    expect(cursor.sequence).toBe(0);

    const tolerated = await callTool(server, "collab_next", {
      workspace_id: workspaceId,
      actor: "spoofed-pager",
      after_sequence: cursor.sequence,
    });
    expect(tolerated.isError).toBeUndefined();
    expect(tolerated.structuredContent.actor).toBe("bound-pager");
    expect(tolerated.structuredContent.events.cursor).toEqual(cursor);

    const skipAhead = first.structuredContent.events.next_anchor.sequence;
    const refused = await callTool(server, "collab_next", {
      workspace_id: workspaceId,
      after_sequence: skipAhead,
    });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toMatchObject({
      error: "after_sequence_unsupported_in_bound_session",
      after_sequence: skipAhead,
      cursor,
      cursor_version: 0,
    });
    expect(refused.structuredContent.message).toContain("collab_cursor_ack");
    expect(refused.structuredContent.message).toContain("collab_events_since");
    expect(refused.structuredContent.remedy).toContain("collab_cursor_ack");
    expect(refused.structuredContent.remedy).toContain("collab_events_since");

    const acknowledged = await callTool(server, "collab_cursor_ack", {
      workspace_id: workspaceId,
      anchor: first.structuredContent.events.next_anchor,
      expected_cursor_version: first.structuredContent.session.cursor_version,
    });
    const staleAfterAck = await callTool(server, "collab_next", {
      workspace_id: workspaceId,
      after_sequence: 0,
    });
    expect(staleAfterAck.isError).toBe(true);
    expect(staleAfterAck.structuredContent.error).toBe(
      "after_sequence_unsupported_in_bound_session",
    );
    expect(staleAfterAck.structuredContent.cursor).toEqual(
      acknowledged.structuredContent.session.cursor,
    );
    const matchingAfterAck = await callTool(server, "collab_next", {
      workspace_id: workspaceId,
      after_sequence: acknowledged.structuredContent.session.cursor.sequence,
    });
    expect(matchingAfterAck.isError).toBeUndefined();
    expect(matchingAfterAck.structuredContent.events.cursor).toEqual(
      acknowledged.structuredContent.session.cursor,
    );

    const legacy = node();
    const opened = await callTool(legacy.server, "collab_workspace_open", {
      root_path: legacy.root,
      actor: "legacy-pager",
    });
    const legacyPage = await callTool(legacy.server, "collab_next", {
      workspace_id: opened.structuredContent.workspace.id,
      actor: "legacy-pager",
      after_sequence: 1,
    });
    expect(legacyPage.isError).toBeUndefined();
    expect(legacyPage.structuredContent.events.cursor.sequence).toBe(1);
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

  test("ends a bound session with release_leases and names the flag when refusing", async () => {
    const { root, store, server } = node();
    const endTool = (server as any)._registeredTools.collab_session_end;
    expect(Object.keys(endTool.inputSchema.shape).sort()).toEqual([
      "binding_key",
      "reason",
      "release_leases",
      "release_summary",
    ]);
    expect(endTool.description).toContain("release_leases");
    expect(
      endTool.inputSchema.safeParse({
        reason: "parse check",
        release_leases: true,
        release_summary: "parse check summary",
      }).data,
    ).toEqual({
      reason: "parse check",
      release_leases: true,
      release_summary: "parse check summary",
    });
    expect(endTool.inputSchema.safeParse({ release_leases: "yes" }).success).toBe(false);

    const joined = await callTool(server, "collab_session_start", {
      root_path: root,
      actor: "mcp-release-on-end",
    });
    const workspaceId = joined.structuredContent.workspace.id;
    const credentialPath = store.defaultSessionCredentialPath(
      joined.structuredContent.session.id,
    );
    const created = await callTool(server, "collab_task_create", {
      workspace_id: workspaceId,
      idempotency_key: "mcp-end-create",
      title: "Release on end",
      work_mode: "edit",
      path_scopes: ["src/mcp-end.ts"],
    });
    const taskId = created.structuredContent.task.id;
    const claimed = await callTool(server, "collab_task_claim", {
      workspace_id: workspaceId,
      task_id: taskId,
      idempotency_key: "mcp-end-claim",
      expected_version: created.structuredContent.task.version,
    });

    const refused = await callTool(server, "collab_session_end", {
      reason: "Trying to leave with a live lease",
    });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent.error).toBe("session_has_active_leases");
    expect(refused.structuredContent.task_ids).toEqual([taskId]);
    expect(refused.structuredContent.leases).toEqual([
      {
        task_id: taskId,
        lease_id: claimed.structuredContent.task.lease_id,
        expires_at: claimed.structuredContent.task.lease_expires_at,
      },
    ]);
    expect(refused.structuredContent.remedy).toContain("release_leases: true");
    const blankSummary = await callTool(server, "collab_session_end", {
      reason: "Summary without the flag",
      release_summary: "",
    });
    expect(blankSummary.isError).toBe(true);
    expect(blankSummary.structuredContent.error).toBe("invalid_release_summary");
    expect(existsSync(credentialPath)).toBe(true);

    const ended = await callTool(server, "collab_session_end", {
      reason: "Leaving cleanly",
      release_leases: true,
      release_summary: "Returned to the pool by the leaving session.",
    });
    expect(ended.isError).toBeUndefined();
    expect(ended.structuredContent.session.status).toBe("ended");
    expect(ended.structuredContent.released_leases).toEqual([
      {
        task_id: taskId,
        lease_id: claimed.structuredContent.task.lease_id,
        via: "release",
      },
    ]);
    expect(ended.structuredContent.credential_file_removed).toBe(true);
    expect(existsSync(credentialPath)).toBe(false);
    expect(store.getTask(workspaceId, taskId)).toMatchObject({
      status: "open",
      assignee_session_id: null,
      lease_id: null,
    });
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

  test("describes every evidence_refs input with the allowed prefixes", () => {
    const { server } = node();
    const tools = (server as any)._registeredTools;
    const withEvidence = Object.keys(tools)
      .filter((name) => tools[name].inputSchema?.shape?.evidence_refs !== undefined)
      .sort();
    expect(withEvidence).toEqual([
      "collab_proposal_open",
      "collab_report_append",
      "collab_task_complete",
      "collab_task_review",
    ]);
    for (const name of withEvidence) {
      expect(tools[name].inputSchema.shape.evidence_refs.description).toBe(
        EVIDENCE_REFS_DESCRIPTION,
      );
    }
    for (const prefix of EVIDENCE_REF_PREFIXES) {
      expect(EVIDENCE_REFS_DESCRIPTION).toContain(prefix);
    }
    expect(EVIDENCE_REFS_DESCRIPTION).toContain("artifact:artifact_<id>");
  });

  test("flattens allowed evidence prefixes into MCP evidence errors", async () => {
    const { root, server } = node();
    const joined = await callTool(server, "collab_session_start", {
      root_path: root,
      actor: "evidence-reporter",
    });
    const workspaceId = joined.structuredContent.workspace.id;
    const unsupported = await callTool(server, "collab_report_append", {
      workspace_id: workspaceId,
      idempotency_key: "mcp-unsupported-evidence",
      kind: "observation",
      body: "Cites an unsupported evidence kind.",
      evidence_refs: ["commit:abc123"],
    });
    expect(unsupported.isError).toBe(true);
    expect(unsupported.structuredContent.error).toBe("invalid_evidence_ref");
    expect(unsupported.structuredContent.allowed_prefixes).toEqual([...EVIDENCE_REF_PREFIXES]);
    expect(unsupported.structuredContent.message).toContain(EVIDENCE_REFS_DESCRIPTION);

    const missing = await callTool(server, "collab_report_append", {
      workspace_id: workspaceId,
      idempotency_key: "mcp-missing-evidence",
      kind: "observation",
      body: "Cites an artifact that does not exist.",
      evidence_refs: ["artifact:artifact_missing"],
    });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent.error).toBe("evidence_not_found");
    expect(missing.structuredContent.reference).toBe("artifact:artifact_missing");
    expect(missing.structuredContent.allowed_prefixes).toEqual([...EVIDENCE_REF_PREFIXES]);
  });

  test("carries review confidence, basis and limits through collab_task_review", async () => {
    const { root, store, server } = node();
    const implementer = store.startSession({
      root_path: root,
      actor: "mcp-confidence-implementer",
    });
    const task = store.createTaskForSession({
      ...implementer.credential,
      idempotency_key: "mcp-confidence-create",
      title: "Confidence review",
      work_mode: "edit",
      completion_policy: "accepted",
      path_scopes: ["src/confidence.ts"],
    });
    const claim = store.claimTaskForSession({
      ...implementer.credential,
      idempotency_key: "mcp-confidence-claim",
      task_id: task.id,
      expected_version: task.version,
    });
    const reported = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "mcp-confidence-complete",
      task_id: task.id,
      lease_id: claim.lease_id!,
      expected_version: claim.version,
      summary: "Ready for an MCP review.",
    });
    await callTool(server, "collab_session_start", {
      root_path: root,
      actor: "mcp-confidence-reviewer",
    });

    const review = {
      workspace_id: reported.workspace_id,
      task_id: reported.id,
      idempotency_key: "mcp-confidence-review",
      expected_version: reported.version,
      outcome: "accept",
      summary: "Reviewed through MCP.",
      confidence: "medium",
      confidence_basis: "Read the change; did not rerun tests.",
      limits: "No full-suite run.",
    };
    const inputSchema = (server as any)._registeredTools.collab_task_review.inputSchema;
    expect(inputSchema.safeParse(review).success).toBe(true);
    expect(inputSchema.safeParse({ ...review, confidence_basis: "" }).success).toBe(true);
    expect(inputSchema.safeParse({ ...review, confidence: "certain" }).success).toBe(false);
    expect(inputSchema.safeParse({ ...review, confidence_basis: "b".repeat(2_001) }).success)
      .toBe(false);
    expect(inputSchema.safeParse({ ...review, limits: "l".repeat(2_001) }).success).toBe(false);

    const reviewed = await callTool(server, "collab_task_review", review);
    expect(reviewed.isError).toBeUndefined();
    expect(reviewed.structuredContent.report).toMatchObject({
      confidence: "medium",
      confidence_basis: "Read the change; did not rerun tests.",
      limits: "No full-suite run.",
    });
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
    expect(implementerInit.serverInfo.version).toBe(COLLAB_PACKAGE_VERSION);
    expect(reviewerInit.serverInfo.version).toBe(COLLAB_PACKAGE_VERSION);

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

  test("carries every new optional input over stdio through the checked-in bundles", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agenttool-collab-mcp-inputs-"));
    const root = join(directory, "repo");
    const databasePath = join(directory, "state", "collab.sqlite");
    const mcpBundle = join(packageRoot, "dist", "agenttool-collab-mcp.js");
    const hostBundle = join(packageRoot, "dist", "agenttool-collab-host.js");
    mkdirSync(root);
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));

    const implementer = new StdioMcpHarness(mcpBundle, databasePath);
    cleanup.push(() => implementer.close());
    await implementer.initialize();
    const reviewer = new StdioMcpHarness(mcpBundle, databasePath);
    cleanup.push(() => reviewer.close());
    await reviewer.initialize();

    // The shipped bundle must advertise every new input; a stale bundle fails here.
    const tools = new Map<string, any>(
      (await implementer.listTools()).tools.map((tool: any) => [tool.name, tool]),
    );
    const properties = (name: string) => Object.keys(tools.get(name).inputSchema.properties);
    expect(properties("collab_session_end")).toEqual(
      expect.arrayContaining(["reason", "release_leases", "release_summary"]),
    );
    expect(tools.get("collab_session_end").inputSchema.properties.release_leases.type).toBe("boolean");
    expect(properties("collab_task_complete")).toContain("review_requested_session_id");
    expect(properties("collab_task_review")).toEqual(
      expect.arrayContaining(["confidence", "confidence_basis", "limits"]),
    );
    expect(tools.get("collab_task_review").inputSchema.properties.confidence.enum).toEqual([
      "high",
      "medium",
      "low",
      "unknown",
    ]);
    expect(properties("collab_next")).toContain("after_sequence");

    const implementerJoin = await implementer.callTool("collab_session_start", {
      root_path: root,
      actor: "stdio-inputs-implementer",
    });
    const reviewerJoin = await reviewer.callTool("collab_session_start", {
      root_path: root,
      actor: "stdio-inputs-reviewer",
    });
    const workspaceId = implementerJoin.structuredContent.workspace.id;
    const reviewerSessionId = reviewerJoin.structuredContent.session.id;

    // review_requested_session_id (collab_task_complete)
    const created = await implementer.callTool("collab_task_create", {
      workspace_id: workspaceId,
      idempotency_key: "stdio-inputs-create",
      title: "Requested review over stdio",
      work_mode: "edit",
      path_scopes: ["src/stdio-inputs.ts"],
    });
    const claimed = await implementer.callTool("collab_task_claim", {
      workspace_id: workspaceId,
      task_id: created.structuredContent.task.id,
      idempotency_key: "stdio-inputs-claim",
      expected_version: created.structuredContent.task.version,
    });
    const reported = await implementer.callTool("collab_task_complete", {
      workspace_id: workspaceId,
      task_id: claimed.structuredContent.task.id,
      lease_id: claimed.structuredContent.task.lease_id,
      idempotency_key: "stdio-inputs-complete",
      expected_version: claimed.structuredContent.task.version,
      summary: "Ready for the requested reviewer",
      review_requested_session_id: reviewerSessionId,
    });
    expect(reported.isError).toBeUndefined();
    expect(reported.structuredContent.task.review_requested_session_id).toBe(reviewerSessionId);

    // bound after_sequence (collab_next): the acknowledged cursor is tolerated, anything else refused
    const cursorSequence = reviewerJoin.structuredContent.session.cursor.sequence;
    const routed = await reviewer.callTool("collab_next", {
      workspace_id: workspaceId,
      after_sequence: cursorSequence,
      event_limit: 50,
    });
    expect(routed.isError).toBeUndefined();
    expect(routed.structuredContent.reports.some(
      (report: any) => report.to_session_id === reviewerSessionId,
    )).toBe(true);
    const skipped = await reviewer.callTool("collab_next", {
      workspace_id: workspaceId,
      after_sequence: cursorSequence + 1,
    });
    expect(skipped.isError).toBe(true);
    expect(skipped.structuredContent.error).toBe("after_sequence_unsupported_in_bound_session");

    // confidence, confidence_basis, limits (collab_task_review)
    const reviewed = await reviewer.callTool("collab_task_review", {
      workspace_id: workspaceId,
      task_id: created.structuredContent.task.id,
      idempotency_key: "stdio-inputs-review",
      expected_version: reported.structuredContent.task.version,
      outcome: "accept",
      summary: "Requested reviewer accepts over stdio",
      confidence: "medium",
      confidence_basis: "Read the reported change.",
      limits: "Ran no tests.",
    });
    expect(reviewed.isError).toBeUndefined();
    expect(reviewed.structuredContent.report).toMatchObject({
      confidence: "medium",
      confidence_basis: "Read the reported change.",
      limits: "Ran no tests.",
    });

    // release_leases + release_summary (collab_session_end)
    const second = await implementer.callTool("collab_task_create", {
      workspace_id: workspaceId,
      idempotency_key: "stdio-inputs-create-second",
      title: "Released on end over stdio",
      work_mode: "edit",
      path_scopes: ["src/stdio-release.ts"],
    });
    const secondClaim = await implementer.callTool("collab_task_claim", {
      workspace_id: workspaceId,
      task_id: second.structuredContent.task.id,
      idempotency_key: "stdio-inputs-claim-second",
      expected_version: second.structuredContent.task.version,
    });
    const blankSummary = await implementer.callTool("collab_session_end", {
      reason: "A blank summary without the flag",
      release_summary: "",
    });
    expect(blankSummary.isError).toBe(true);
    expect(blankSummary.structuredContent.error).toBe("invalid_release_summary");
    const ended = await implementer.callTool("collab_session_end", {
      reason: "Leaving over stdio",
      release_leases: true,
      release_summary: "Released by the stdio implementer on exit",
    });
    expect(ended.isError).toBeUndefined();
    expect(ended.structuredContent.released_leases).toEqual([
      {
        task_id: second.structuredContent.task.id,
        lease_id: secondClaim.structuredContent.task.lease_id,
        via: "release",
      },
    ]);

    // Host exit without collab_session_end: the host CLI bundle ends the
    // reviewer from the credential file its MCP process wrote.
    const third = await reviewer.callTool("collab_task_create", {
      workspace_id: workspaceId,
      idempotency_key: "stdio-inputs-create-third",
      title: "Held when the reviewer host exits",
      work_mode: "edit",
      path_scopes: ["src/stdio-host-exit.ts"],
    });
    const thirdClaim = await reviewer.callTool("collab_task_claim", {
      workspace_id: workspaceId,
      task_id: third.structuredContent.task.id,
      idempotency_key: "stdio-inputs-claim-third",
      expected_version: third.structuredContent.task.version,
    });
    await reviewer.close();
    const reviewerFile = join(directory, "state", "collab-sessions", `${reviewerSessionId}.json`);
    expect(existsSync(reviewerFile)).toBe(true);
    const host = Bun.spawnSync([
      process.execPath,
      hostBundle,
      "end",
      "--session-file",
      reviewerFile,
      "--reason",
      "host exit sweep: stdio reviewer exited",
      "--release-leases",
      "--db",
      databasePath,
    ], {
      cwd: packageRoot,
      env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir() },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(host.exitCode).toBe(0);
    expect(JSON.parse(host.stdout.toString())).toMatchObject({
      protocol: "agenttool.collab-host/1",
      status: "ended",
      session_id: reviewerSessionId,
      released: [{
        task_id: third.structuredContent.task.id,
        lease_id: thirdClaim.structuredContent.task.lease_id,
        via: "release",
      }],
    });
    expect(existsSync(reviewerFile)).toBe(false);

    const verified = await implementer.callTool("collab_journal_verify", {
      workspace_id: workspaceId,
    });
    expect(verified.structuredContent.chain_valid).toBe(true);
    const observer = new CollabStore(databasePath);
    cleanup.push(() => observer.close());
    expect(observer.getCoordinationSession(reviewerSessionId)?.status).toBe("ended");
    expect(observer.getTask(workspaceId, third.structuredContent.task.id)).toMatchObject({
      status: "open",
      lease_id: null,
    });
  }, 30_000);
});
