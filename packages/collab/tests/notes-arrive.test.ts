import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildCollabMcpServer } from "../src/mcp.js";
import { CollabStore } from "../src/store.js";
import { exactRef, handleOf, NOTE_AUTHORISES, NOTE_CARD, NOTE_CAPABILITIES } from "../src/verbs.js";
import { COLLAB_PACKAGE_VERSION } from "../src/version.js";

// collab_arrive (Collab Notes spec 5.1) and the verb kernel's common rules (spec 5).

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

const CODEX_THREAD = "019a0000-0000-7000-8000-000000000001";

function journal() {
  const directory = mkdtempSync(join(tmpdir(), "agenttool-collab-arrive-"));
  const root = join(directory, "repo");
  mkdirSync(root);
  let now = Date.parse("2026-11-12T10:00:00.000Z");
  const store = new CollabStore(join(directory, "state", "collab.sqlite"), { now: () => new Date(now) });
  cleanup.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    root,
    store,
    advance(ms: number) {
      now += ms;
    },
    server(environment: Record<string, string> = {}) {
      return buildCollabMcpServer(store, { environment }) as any;
    },
    events() {
      return store.db.query(`SELECT sequence, type, entity_id, session_id, payload_json FROM events ORDER BY sequence`)
        .all() as Array<{ sequence: number; type: string; entity_id: string; session_id: string | null; payload_json: string }>;
    },
  };
}

async function call(server: any, name: string, args: Record<string, unknown> = {}) {
  const registration = server._registeredTools[name];
  if (!registration) throw new Error(`tool not registered: ${name}`);
  return await (registration.handler ?? registration.callback)(args, {}) as {
    isError?: boolean;
    structuredContent: Record<string, any>;
  };
}

async function ok(server: any, name: string, args: Record<string, unknown> = {}) {
  const result = await call(server, name, args);
  if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.structuredContent)}`);
  return result.structuredContent;
}

/** Run with the process in `directory`, as an MCP server a host started there would be. */
async function inDirectory<T>(directory: string, run: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(directory);
  try {
    return await run();
  } finally {
    process.chdir(previous);
  }
}

function joinedPayload(store: CollabStore, sessionId: string): Record<string, unknown> {
  const row = store.db.query(`SELECT payload_json FROM events WHERE type = 'session.joined' AND entity_id = ?`)
    .get(sessionId) as { payload_json: string };
  return JSON.parse(row.payload_json) as Record<string, unknown>;
}

describe("collab_arrive on an unbound default slot", () => {
  test("starts a session with its mark at the head, the legacy cursor untouched, and the brief", async () => {
    const j = journal();
    const peerServer = j.server();
    const peer = await ok(peerServer, "collab_arrive", {
      purpose: "reviews the parser",
      root_path: j.root,
      name: "peer",
      model: "test-model-1",
    });
    const task = await ok(peerServer, "collab_task_create", {
      workspace_id: peer.you.workspace_id,
      idempotency_key: "t1",
      title: "Held by the peer",
      work_mode: "coordination",
    });
    await ok(peerServer, "collab_task_claim", {
      workspace_id: peer.you.workspace_id,
      idempotency_key: "c1",
      task_id: task.task.id,
      expected_version: task.task.version,
    });
    const server = j.server();
    const arrived = await ok(server, "collab_arrive", { purpose: "fix the flaky test", root_path: j.root, name: "me" });
    const id = arrived.you.session as string;
    const head = j.events().at(-1)!;

    // The write result shape (spec 5).
    expect(arrived.ok).toBe(true);
    expect(arrived.authorises).toBe(NOTE_AUTHORISES);
    expect(arrived.effect).toContain(`Started session ${id}`);
    expect(arrived.effect).toContain("the legacy cursor was not moved");
    // Which root the session joined is said, never left to be guessed.
    expect(arrived.effect).toContain(`in the worktree at ${realpathSync(j.root)}`);
    expect(arrived.you.root_path).toBe(realpathSync(j.root));
    expect(arrived.ids).toEqual({ session: id, session_handle: handleOf("session", id), workspace_id: arrived.you.workspace_id });
    expect(arrived.note).toBe("note: I have arrived.\n\nPurpose: fix the flaky test");
    expect(arrived.next).toEqual({ tool: "collab_inbox", input: {} });

    // The session itself: role = purpose; a mark at the head it joined at; no cursor move.
    expect(head.type).toBe("session.joined");
    expect(head.entity_id).toBe(id);
    const session = j.store.getCoordinationSession(id)!;
    expect(session.role).toBe("fix the flaky test");
    expect(session.actor).toBe("me");
    expect(session.cursor.sequence).toBe(0);
    expect(session.cursor_version).toBe(0);
    expect(j.store.noteMark(arrived.you.workspace_id, id)).toBe(head.sequence);

    // A credential file exactly where collab_session_start writes one.
    const credentialFile = j.store.defaultSessionCredentialPath(id);
    expect(existsSync(credentialFile)).toBe(true);
    expect(statSync(credentialFile).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(arrived)).not.toContain("session_token");

    // The brief.
    expect(arrived.you).toMatchObject({
      session: id,
      name: "me",
      voice: id,
      seat_ref: null,
      purpose: "fix the flaky test",
      model: null,
      basis: {
        session: "holds this session's credential file",
        name: "self-declared",
        model: "self-declared",
        seat_ref: "declared at session start (host or caller); unverified",
      },
    });
    expect(arrived.here).toEqual([{
      session: peer.you.session,
      name: "peer",
      purpose: "reviews the parser",
      model: "test-model-1",
      last_seen_minutes: 0,
      holds: [handleOf("task", task.task.id)],
      same_seat_as_you: false,
    }]);
    expect(arrived.open.in_progress).toEqual([{
      task: handleOf("task", task.task.id),
      id: task.task.id,
      title: "Held by the peer",
      by: "peer",
      purpose: "reviews the parser",
      paths: [],
    }]);
    expect(arrived.open.ballots).toEqual([]);
    expect(arrived.for_you).toEqual([]);
    expect(arrived.waiting_on_you).toEqual([]);
    expect(arrived.totals).toMatchObject({ here: 1, in_progress: 1, for_you: 0 });
    expect(arrived.history).toMatchObject({ events: head.sequence, reports: 0 });
    expect(arrived.listen).toEqual({ how: "collab_inbox {wait_seconds: 30}" });
    expect(arrived.surface).toEqual({ version: COLLAB_PACKAGE_VERSION, tools: "full", capabilities: [...NOTE_CAPABILITIES] });
    expect(arrived.card).toBe(NOTE_CARD);
    expect(j.store.verifyJournal(arrived.you.workspace_id)).toBe(true);
  });

  test("session.joined carries model only when one is given", async () => {
    const j = journal();
    const without = await ok(j.server(), "collab_arrive", { purpose: "no model", root_path: j.root, name: "plain" });
    expect(Object.keys(joinedPayload(j.store, without.you.session)).sort())
      .toEqual(["identity_boundary", "parent_session_id", "role", "worktree_id"]);
    const withModel = await ok(j.server(), "collab_arrive", {
      purpose: "with a model",
      root_path: j.root,
      name: "modelled",
      model: "claude-opus-5.5",
    });
    expect(joinedPayload(j.store, withModel.you.session).model).toBe("claude-opus-5.5");
    expect(withModel.you.model).toBe("claude-opus-5.5");
  });

  test("without a verified host name the actor is <host>-<6 hex of the session id>", async () => {
    const j = journal();
    const cases: Array<[Record<string, string>, string]> = [
      [{}, "agent"],
      [{ CODEX_THREAD_ID: CODEX_THREAD }, "codex"],
      // A socket alone is not a verified Claude Code name (actor-default.ts), so the prefix is used.
      [{ CLAUDE_CODE_MESSAGING_SOCKET: "/nonexistent/12345.sock" }, "claude-code"],
    ];
    for (const [environment, prefix] of cases) {
      const arrived = await ok(j.server(environment), "collab_arrive", { purpose: "find out my name", root_path: j.root });
      const id = arrived.you.session as string;
      expect(arrived.you.name).toBe(`${prefix}-${id.slice("session_".length, "session_".length + 6)}`);
      expect(j.store.getCoordinationSession(id)!.actor).toBe(arrived.you.name);
      expect(arrived.advice.join(" ")).toContain("Pass name to choose one");
    }
    // The store refuses a prefix that is not a plain label, and asks for an actor without one.
    expect(() => j.store.startSession({ root_path: j.root, actor_prefix: "Bad Prefix" })).toThrow("actor_prefix");
    expect(() => j.store.startSession({ root_path: j.root })).toThrow("Supply actor");
  });

  test("under Claude Code, listen.how is the doorbell watcher for this session, never --from-cursor", async () => {
    const j = journal();
    const arrived = await ok(j.server({ CLAUDE_CODE_MESSAGING_SOCKET: "/nonexistent/12345.sock" }), "collab_arrive", {
      purpose: "be rung",
      root_path: j.root,
      name: "rung",
    });
    const how = arrived.listen.how as string;
    expect(how).toStartWith("nohup ");
    expect(how).toContain("integrations/claude-code/collab-doorbell-watch.ts");
    expect(how).toContain(`--session ${arrived.you.session}`);
    expect(how).toContain(`--db '${j.store.db.filename}'`);
    expect(how).toContain("dist/agenttool-collab-host.js");
    expect(how).not.toContain("--from-cursor");
  });

  test("under the notes profile, listen.how is the inbox wait, because the watcher's ring names legacy tools", async () => {
    const j = journal();
    const arrived = await ok(j.server({
      AGENTOOL_COLLAB_TOOLS: "notes",
      CLAUDE_CODE_MESSAGING_SOCKET: "/nonexistent/12345.sock",
    }), "collab_arrive", { purpose: "be told", root_path: j.root, name: "told" });
    expect(arrived.surface.tools).toBe("notes");
    expect(arrived.listen).toEqual({ how: "collab_inbox {wait_seconds: 30}" });
  });

  test("refuses a purpose that is too long or holds half a character, before any write", async () => {
    const j = journal();
    const server = j.server();
    const long = await call(server, "collab_arrive", { purpose: "x".repeat(201), root_path: j.root });
    expect(long.isError).toBe(true);
    expect(long.structuredContent).toMatchObject({ code: "too_long", field: "purpose", max: 200 });
    expect(long.structuredContent.remedy.say).toBeString();
    const split = await call(server, "collab_arrive", { purpose: "half \ud83c", root_path: j.root });
    expect(split.structuredContent.code).toBe("invalid_purpose");
    expect(j.events()).toEqual([]);
    // Line breaks join with a space, as in a note's Purpose trailer.
    const joined = await ok(server, "collab_arrive", { purpose: "two\nlines", root_path: j.root, name: "joined" });
    expect(joined.you.purpose).toBe("two lines");
  });
});

describe("collab_arrive without root_path", () => {
  const packageRoot = resolve(import.meta.dir, "..");
  const remedy = { tool: "collab_arrive", input: { purpose: "work on the project", root_path: "<your repository root>" } };

  test("a working directory git does not know is refused before any write, with a ready call", async () => {
    const j = journal();
    const outside = mkdtempSync(join(tmpdir(), "agenttool-collab-not-git-"));
    cleanup.push(() => rmSync(outside, { recursive: true, force: true }));
    const refused = await inDirectory(outside, () =>
      call(j.server({ CODEX_THREAD_ID: CODEX_THREAD }), "collab_arrive", { purpose: "work on the project" }));
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toMatchObject({
      code: "root_path_required",
      reason: "not_a_git_worktree",
      working_directory: realpathSync(outside),
      remedy,
    });
    expect(j.events()).toEqual([]);
    expect(j.store.db.query(`SELECT COUNT(*) AS n FROM coordination_sessions`).get()).toEqual({ n: 0 });
  });

  test("this package's own directory is refused even inside a git worktree (a host started the server in its plugin root)", async () => {
    const j = journal();
    for (const directory of [packageRoot, join(packageRoot, "dist")]) {
      const refused = await inDirectory(directory, () =>
        call(j.server({ CODEX_THREAD_ID: CODEX_THREAD }), "collab_arrive", { purpose: "work on the project", name: "codex" }));
      expect(refused.structuredContent).toMatchObject({
        code: "root_path_required",
        reason: "inside_collab_package",
        remedy: { tool: "collab_arrive", input: { ...remedy.input, name: "codex" } },
      });
    }
    expect(j.events()).toEqual([]);
  });

  test("a git worktree is joined at its top level, and the brief names that root", async () => {
    const j = journal();
    const repository = mkdtempSync(join(tmpdir(), "agenttool-collab-git-"));
    cleanup.push(() => rmSync(repository, { recursive: true, force: true }));
    expect(spawnSync("git", ["init", "-q", repository]).status).toBe(0);
    mkdirSync(join(repository, "deep", "inside"), { recursive: true });
    const top = realpathSync(repository);
    const arrived = await inDirectory(join(repository, "deep", "inside"), () =>
      ok(j.server(), "collab_arrive", { purpose: "work on the project", name: "here" }));
    expect(arrived.you.root_path).toBe(top);
    expect(arrived.effect).toContain(`in the worktree at ${top}`);
    expect(arrived.effect).toContain("root_path was not given");
    // A session that names the same root explicitly meets it there.
    const named = await ok(j.server(), "collab_arrive", { purpose: "the same project", root_path: top, name: "named" });
    expect(named.you.workspace_id).toBe(arrived.you.workspace_id);
    expect(named.here.map((entry: any) => entry.session)).toEqual([arrived.you.session]);
  });

  test("an empty root_path is refused, never read as the working directory", async () => {
    const j = journal();
    const refused = await call(j.server(), "collab_arrive", { purpose: "work on the project", root_path: "  " });
    expect(refused.structuredContent).toMatchObject({ code: "invalid_root_path", remedy });
    expect(j.events()).toEqual([]);
  });
});

describe("collab_arrive on a bound slot", () => {
  test("writes nothing, and names who you speak as with two ready remedies", async () => {
    const j = journal();
    const server = j.server();
    const first = await ok(server, "collab_arrive", { purpose: "first purpose", root_path: j.root, name: "me" });
    const id = first.you.session as string;
    const before = j.events().length;
    const row = () => j.store.db.query(`SELECT * FROM coordination_sessions WHERE id = ?`).get(id);
    const rowBefore = row();
    const marksBefore = j.store.db.query(`SELECT * FROM note_marks`).all();
    j.advance(60_000);
    const again = await ok(server, "collab_arrive", { purpose: "something else", name: "ignored" });
    expect(again.effect).toStartWith(`You are speaking as session ${id} (name me, purpose first purpose).`);
    expect(again.effect).toContain("Nothing was written.");
    expect(again.remedies).toEqual([
      { tool: "collab_arrive", input: { purpose: "something else", revise_purpose: true } },
      { tool: "collab_arrive", input: { purpose: "something else", binding_key: "<choose>", parent: id } },
    ]);
    expect(again.advice.join(" ")).toContain("apply only when a slot first arrives");
    expect(j.events().length).toBe(before);
    expect(row()).toEqual(rowBefore);
    expect(j.store.db.query(`SELECT * FROM note_marks`).all()).toEqual(marksBefore);
    expect(again.you.purpose).toBe("first purpose");
    expect(again.you.root_path).toBe(realpathSync(j.root));
    expect(again.effect).toContain(`Worktree root: ${realpathSync(j.root)}.`);
  });

  test("totals.for_you counts every item waiting after the mark, not the ten listed", async () => {
    const j = journal();
    const server = j.server();
    const me = await ok(server, "collab_arrive", { purpose: "be written to", root_path: j.root, name: "me" });
    const peer = j.store.startSession({ root_path: j.root, actor: "peer", role: "writes a lot" });
    for (let index = 0; index < 30; index += 1) {
      j.store.appendReportForSession({
        ...peer.credential, idempotency_key: `m${index}`, kind: "observation", body: `For you ${index}.`, to_session_id: me.you.session,
      });
    }
    j.store.appendReportForSession({ ...peer.credential, idempotency_key: "noise", kind: "observation", body: "For all." });
    const arrived = await ok(server, "collab_arrive", { purpose: "look" });
    expect(arrived.for_you).toHaveLength(10);
    expect(arrived.totals).toMatchObject({ for_you: 30, for_you_more: true, for_you_at_least: false });
    expect((await ok(server, "collab_inbox", { limit: 50 })).items).toHaveLength(30);
  });

  test("revise_purpose appends purpose.declared; the role column is never rewritten", async () => {
    const j = journal();
    const server = j.server();
    const first = await ok(server, "collab_arrive", { purpose: "first purpose", root_path: j.root, name: "me" });
    const id = first.you.session as string;
    const revised = await ok(server, "collab_arrive", { purpose: "second purpose", revise_purpose: true });
    const last = j.events().at(-1)!;
    expect(last.type).toBe("purpose.declared");
    expect(last.entity_id).toBe(id);
    expect(last.session_id).toBe(id);
    expect(JSON.parse(last.payload_json)).toEqual({ session_id: id, purpose: "second purpose" });
    expect(revised.effect).toStartWith(`You are speaking as session ${id} (name me, purpose second purpose).`);
    expect(revised.you.purpose).toBe("second purpose");
    expect(revised.note).toBe("note: My purpose has changed.\n\nPurpose: second purpose");
    expect(j.store.getCoordinationSession(id)!.role).toBe("first purpose");
    // The current purpose is the latest purpose.declared, else the role.
    const legacy = j.store.startSession({ root_path: j.root, actor: "legacy", role: "a legacy role" });
    const views = new Map(j.store.noteSessionViews(first.you.workspace_id).map((view) => [view.id, view]));
    expect(views.get(id)!.purpose).toBe("second purpose");
    expect(views.get(legacy.session.id)!.purpose).toBe("a legacy role");
    expect(j.store.verifyJournal(first.you.workspace_id)).toBe(true);
  });

  test("a lost-response retry replays; a repeat after another declaration writes again", async () => {
    const j = journal();
    const server = j.server();
    await ok(server, "collab_arrive", { purpose: "A", root_path: j.root, name: "me" });
    const declarations = () => j.events().filter((event) => event.type === "purpose.declared").length;

    const b = await ok(server, "collab_arrive", { purpose: "B", revise_purpose: true });
    expect(b.replayed).toBeUndefined();
    expect(declarations()).toBe(1);
    // The same call again, as after a lost response: replayed, nothing appended.
    const retry = await ok(server, "collab_arrive", { purpose: "B", revise_purpose: true });
    expect(retry.replayed).toBe(true);
    expect(retry.effect).toStartWith("Replayed: nothing new was written.");
    expect(retry.advice.join(" ")).toContain("Add a word to say it again");
    expect(declarations()).toBe(1);
    // A, then B again: each follows a different declaration, so each writes.
    await ok(server, "collab_arrive", { purpose: "A", revise_purpose: true });
    expect(declarations()).toBe(2);
    const again = await ok(server, "collab_arrive", { purpose: "B", revise_purpose: true });
    expect(again.replayed).toBeUndefined();
    expect(declarations()).toBe(3);
    expect(again.you.purpose).toBe("B");
    // The keys are derived: no key, version or cursor came from the caller.
    const keys = (j.store.db.query(`SELECT idempotency_key FROM mutations ORDER BY idempotency_key`).all() as Array<{ idempotency_key: string }>)
      .map((row) => row.idempotency_key);
    expect(keys).toHaveLength(3);
    for (const key of keys) expect(key).toMatch(/^n1:[A-Z2-7]{8}:\d{6}:[A-Z2-7]{20}$/);
    expect(keys.map((key) => key.split(":")[2])).toEqual(["000001", "000002", "000003"]);
  });
});

describe("collab_arrive on a named slot", () => {
  test("starts a child of a session this process holds, attested as collab_session_start attests it", async () => {
    const j = journal();
    const server = j.server();
    const parent = await ok(server, "collab_arrive", { purpose: "lead", root_path: j.root, name: "lead" });
    const parentId = parent.you.session as string;
    const child = await ok(server, "collab_arrive", { purpose: "check one file", binding_key: "k1", parent: parentId });
    const childId = child.you.session as string;
    expect(child.you.name).toBe("lead/k1");
    expect(child.effect).toContain(
      `This session shares its parent's voice and ballot unit. Send binding_key k1 on every call; without it you speak as session ${parentId}.`,
    );
    expect(child.next).toEqual({ tool: "collab_inbox", input: { binding_key: "k1" } });
    expect(child.you.voice).toBe(parentId);
    expect(child.you.root_path).toBe(parent.you.root_path);
    expect(child.effect).toContain(`in the worktree at ${parent.you.root_path}`);
    expect(j.store.consentVoiceOf(childId)).toBe(parentId);
    expect(existsSync(j.store.defaultSessionCredentialPath(childId))).toBe(true);

    // The same lineage through collab_session_start, in another MCP process.
    const legacyServer = j.server();
    const legacyParent = await ok(legacyServer, "collab_session_start", { root_path: j.root, actor: "legacy-lead" });
    const legacyChild = await ok(legacyServer, "collab_session_start", {
      root_path: j.root,
      actor: "legacy-lead/k1",
      role: "check one file",
      binding_key: "k1",
      parent_session_id: legacyParent.session.id,
    });
    const attestation = (sessionId: string) => j.store.db.query(`
      SELECT parent_session_id, basis FROM session_parent_attestations WHERE session_id = ?
    `).get(sessionId) as { parent_session_id: string; basis: string };
    expect(attestation(childId)).toEqual({ parent_session_id: parentId, basis: "same_mcp_process" });
    expect(attestation(legacyChild.session.id)).toEqual({ parent_session_id: legacyParent.session.id, basis: "same_mcp_process" });
    expect(Object.keys(joinedPayload(j.store, childId)).sort())
      .toEqual(Object.keys(joinedPayload(j.store, legacyChild.session.id)).sort());
    expect(joinedPayload(j.store, childId).parent_session_id).toBe(parentId);

    // Both slots now speak for themselves.
    expect((await ok(server, "collab_arrive", { purpose: "lead" })).you.session).toBe(parentId);
    expect((await ok(server, "collab_arrive", { purpose: "x", binding_key: "k1" })).you.session).toBe(childId);
  });

  test("parent_not_held for a session this process does not hold; parent_required without one", async () => {
    const j = journal();
    const other = await ok(j.server(), "collab_arrive", { purpose: "elsewhere", root_path: j.root, name: "other" });
    const server = j.server();
    const unheld = await call(server, "collab_arrive", { purpose: "child", binding_key: "k1", parent: other.you.session, root_path: j.root });
    expect(unheld.isError).toBe(true);
    expect(unheld.structuredContent.code).toBe("parent_not_held");
    // Nothing held here yet, so the remedy is to arrive on the default slot first.
    expect(unheld.structuredContent.remedy).toEqual({ tool: "collab_arrive", input: { purpose: "child" } });
    const own = await ok(server, "collab_arrive", { purpose: "lead", root_path: j.root, name: "lead" });
    const missing = await call(server, "collab_arrive", { purpose: "child", binding_key: "k2" });
    expect(missing.structuredContent.code).toBe("parent_required");
    expect(missing.structuredContent.remedy).toEqual({
      tool: "collab_arrive",
      input: { purpose: "child", binding_key: "k2", parent: own.you.session },
    });
    const stillUnheld = await call(server, "collab_arrive", { purpose: "child", binding_key: "k3", parent: other.you.session });
    expect(stillUnheld.structuredContent.code).toBe("parent_not_held");
    expect(stillUnheld.structuredContent.remedy.input.parent).toBe(own.you.session);
    // A parent on the default slot is refused: the default slot has no parent.
    const defaultParent = await call(j.server(), "collab_arrive", { purpose: "x", parent: own.you.session, root_path: j.root });
    expect(defaultParent.structuredContent.code).toBe("parent_needs_binding_key");
  });

  test("a derived name over 200 characters asks for a name, before any write", async () => {
    const j = journal();
    const server = j.server();
    const parent = await ok(server, "collab_arrive", { purpose: "lead", root_path: j.root, name: "n".repeat(199) });
    const before = j.events().length;
    const child = await call(server, "collab_arrive", { purpose: "child", binding_key: "kk", parent: parent.you.session });
    expect(child.isError).toBe(true);
    expect(child.structuredContent).toMatchObject({
      code: "too_long",
      field: "name",
      max: 200,
      remedy: {
        tool: "collab_arrive",
        input: { purpose: "child", binding_key: "kk", parent: parent.you.session, name: "<shorter>" },
      },
    });
    expect(j.events().length).toBe(before);
    const named = await ok(server, "collab_arrive", { purpose: "child", binding_key: "kk", parent: parent.you.session, name: "short" });
    expect(named.you.name).toBe("short");
  });
});

describe("not_arrived", () => {
  test("other verbs on an unbound slot say how to arrive; legacy tools keep their refusal", async () => {
    const j = journal();
    const server = j.server();
    const unbound = await call(server, "collab_inbox");
    expect(unbound.isError).toBe(true);
    expect(unbound.structuredContent).toEqual({
      code: "not_arrived",
      message: "This MCP slot has no session yet; arrive first",
      remedy: { tool: "collab_arrive", input: { purpose: "…" } },
    });
    const lead = await ok(server, "collab_arrive", { purpose: "lead", root_path: j.root, name: "lead" });
    const named = await call(server, "collab_inbox", { binding_key: "k9" });
    expect(named.structuredContent.code).toBe("not_arrived");
    expect(named.structuredContent.remedy).toEqual({
      tool: "collab_arrive",
      input: { purpose: "…", binding_key: "k9", name: "lead/k9", parent: lead.you.session },
    });
    // The legacy refusal on an unbound named slot is unchanged.
    const legacy = await call(server, "collab_next", { workspace_id: lead.you.workspace_id, binding_key: "k9" });
    expect(legacy.structuredContent).toEqual({ error: "session_not_bound", message: "The selected child binding is not bound" });
  });
});

describe("handles", () => {
  test("format as <kind>#<first 6 hex>, or <kind>:<id> when there is no uuid", () => {
    expect(handleOf("report", "report_3fa91c2e-0000-4000-8000-000000000000")).toBe("report#3fa91c");
    expect(handleOf("proposal", "report_3fa91c2e-0000-4000-8000-000000000000")).toBe("proposal#3fa91c");
    expect(handleOf("task", "task_0b12de99-1111-4111-8111-111111111111")).toBe("task#0b12de");
    expect(handleOf("session", "session_abcdef01-2222-4222-8222-222222222222")).toBe("session#abcdef");
    // A caller-chosen task id has no uuid; the typed form still says it is a task.
    expect(handleOf("task", "my-own-task")).toBe("task:my-own-task");
    // A uuid under another kind's prefix is not this kind's handle.
    expect(handleOf("task", "report_3fa91c2e-0000-4000-8000-000000000000")).toBe("task:report_3fa91c2e-0000-4000-8000-000000000000");
    // Ready calls carry the exact reference, never a short handle that could match two.
    expect(exactRef("task", "task_0b12de99-1111-4111-8111-111111111111")).toBe("task_0b12de99-1111-4111-8111-111111111111");
    expect(exactRef("proposal", "report_3fa91c2e-0000-4000-8000-000000000000")).toBe("report_3fa91c2e-0000-4000-8000-000000000000");
    expect(exactRef("task", "my-own-task")).toBe("task:my-own-task");
  });

  test("resolve by key range, and refuse an ambiguous handle with its candidates", async () => {
    const j = journal();
    const server = j.server();
    const me = await ok(server, "collab_arrive", { purpose: "make tasks", root_path: j.root, name: "me" });
    const workspaceId = me.you.workspace_id as string;
    const idA = "task_abcdef12-0000-4000-8000-000000000001";
    const idB = "task_abcdef34-0000-4000-8000-000000000002";
    for (const [key, id] of [["a", idA], ["b", idB]]) {
      await ok(server, "collab_task_create", {
        workspace_id: workspaceId, idempotency_key: key, task_id: id, title: id, work_mode: "coordination",
      });
    }
    const posted = await ok(server, "collab_report_append", {
      workspace_id: workspaceId, idempotency_key: "r", kind: "observation", body: "A report to find by its handle.",
    });
    const reportId = posted.report.id as string;
    for (const value of [handleOf("report", reportId), reportId, `report:${reportId}`]) {
      expect(j.store.resolveNoteRef(workspaceId, "report", value)).toEqual({ kind: "report", id: reportId });
    }
    // Not a proposal, so a proposal handle with the same hex finds nothing.
    expect(() => j.store.resolveNoteRef(workspaceId, "report", handleOf("proposal", reportId))).toThrow("No proposal");
    expect(() => j.store.resolveNoteRef(workspaceId, "task", handleOf("report", reportId))).toThrow("names a report");
    expect(j.store.resolveNoteRef(workspaceId, "task", "task#abcdef12")).toEqual({ kind: "task", id: idA });
    expect(j.store.resolveNoteRef(workspaceId, "task", "task#abcdef3")).toEqual({ kind: "task", id: idB });
    expect(() => j.store.resolveNoteRef(workspaceId, "task", "task#abcdef")).toThrow("matches more than one task");

    // Through the verb: nothing is routed by guess, and the candidates come back.
    const ambiguous = await call(server, "collab_inbox", { about: "task#abcdef" });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.structuredContent).toMatchObject({
      code: "ambiguous_handle",
      candidates: [idA, idB],
      candidates_total: 2,
      remedy: { say: "Use a longer handle or the full id; the candidates are listed." },
    });
    const found = await ok(server, "collab_inbox", { about: "task#abcdef12" });
    expect(found.task.id).toBe(idA);
    expect(found.task.handle).toBe(idA === handleOf("task", idA) ? idA : "task#abcdef");
  });
});
