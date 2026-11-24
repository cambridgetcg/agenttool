import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { buildCollabMcpServer } from "../src/mcp.js";
import { readSessionCredentialFile, writeSessionCredentialFile } from "../src/session-file.js";
import { call, journal, ok, refused, runCleanup } from "./notes-helpers.js";

// A slot whose session was ended, or resumed, outside this MCP process is
// freed by its next call refused with session_auth_failed, and by nothing else.
// Until a new session starts there, calls that would write are refused.

afterEach(runCleanup);

describe("a slot whose session ended or was resumed elsewhere", () => {
  test("default slot, ended outside: the refusal frees the slot and a new session can start", async () => {
    const j = journal();
    const a = j.start("alpha");
    const server = j.serve(a);
    j.store.endSession({ ...a.credential, reason: "ended by the host CLI" });
    const failed = await call(server, "collab_next", { workspace_id: a.workspace.id });
    expect(failed.isError).toBe(true);
    expect(failed.structuredContent).toMatchObject({
      error: "session_auth_failed",
      slot_freed: true,
      bound_session: { id: a.session.id, state: "ended" },
    });
    expect(failed.structuredContent.remedy).toContain("the slot is free, and collab_session_start starts a new session");
    // Freed once, and closed: the next call is neither an auth failure nor legacy mode.
    expect((await call(server, "collab_next", { workspace_id: a.workspace.id, actor: "alpha" })).structuredContent).toMatchObject({
      error: "session_not_bound",
      slot_freed: true,
      bound_session: { id: a.session.id, state: "ended" },
      remedy: failed.structuredContent.remedy,
    });
    const started = await ok(server, "collab_session_start", { root_path: j.root, actor: "alpha-again" });
    expect(started.session.id).not.toBe(a.session.id);
    await server.close();
  });

  test("default slot, resumed by another process: freed, and the credential file is left for that process", async () => {
    const j = journal();
    const a = j.start("alpha");
    const server = j.serve(a);
    const file = j.store.defaultSessionCredentialPath(a.session.id);
    j.store.resumeSession(readSessionCredentialFile(file));
    const failed = await call(server, "collab_inbox", {});
    expect(failed.structuredContent).toMatchObject({
      code: "session_auth_failed",
      slot_freed: true,
      bound_session: { id: a.session.id, state: "resumed_elsewhere" },
    });
    expect(failed.structuredContent.remedy.say).toContain("resumed by another process");
    expect(failed.structuredContent.remedy.say).toContain("the slot is free, and collab_arrive starts a new session");
    expect(existsSync(file)).toBe(true);
    expect(j.store.getCoordinationSession(a.session.id)!.status).toBe("active");
    const arrived = await ok(server, "collab_arrive", { purpose: "start again", root_path: j.root });
    expect(arrived.you.session).not.toBe(a.session.id);
    await server.close();
  });

  test("collab_arrive on such a slot is refused once, frees it, and the same call then starts a session", async () => {
    const j = journal();
    const a = j.start("alpha");
    const server = j.serve(a);
    j.store.endSession({ ...a.credential, reason: "ended by the host CLI" });
    const again = { purpose: "start again", root_path: j.root };
    expect(await refused(server, "collab_arrive", again)).toMatchObject({ code: "session_auth_failed", slot_freed: true });
    expect((await ok(server, "collab_arrive", again)).you.session).not.toBe(a.session.id);
    await server.close();
  });

  test("named slot: only that slot is freed, and it can start again with its binding_key", async () => {
    const j = journal();
    const server = buildCollabMcpServer(j.store);
    const parent = await ok(server, "collab_session_start", { root_path: j.root, actor: "parent" });
    const child = await ok(server, "collab_session_start", {
      root_path: j.root,
      actor: "child",
      binding_key: "kid",
      parent_session_id: parent.session.id,
    });
    const credential = readSessionCredentialFile(j.store.defaultSessionCredentialPath(child.session.id));
    j.store.endSession({ ...credential, reason: "ended elsewhere" });
    const failed = await call(server, "collab_next", { workspace_id: parent.workspace.id, binding_key: "kid" });
    expect(failed.structuredContent).toMatchObject({
      error: "session_auth_failed",
      slot_freed: true,
      bound_session: { id: child.session.id, state: "ended" },
    });
    // The remedy is complete: what it names is what the tool asks for.
    expect(failed.structuredContent.remedy).toContain(
      `collab_session_start with root_path, binding_key kid, parent_session_id ${parent.session.id} and its own actor starts a new session`,
    );
    // Every call on the freed named slot says the same until it has a session again.
    for (const tool of ["collab_next", "collab_task_list"]) {
      expect((await call(server, tool, { workspace_id: parent.workspace.id, binding_key: "kid" })).structuredContent)
        .toMatchObject({ error: "session_not_bound", slot_freed: true, remedy: failed.structuredContent.remedy });
    }
    expect((await call(server, "collab_next", { workspace_id: parent.workspace.id, binding_key: "never" })).structuredContent.slot_freed)
      .toBeUndefined();
    // The default slot keeps its session.
    expect((await call(server, "collab_next", { workspace_id: parent.workspace.id })).isError).toBeUndefined();
    const again = await ok(server, "collab_session_start", {
      root_path: j.root,
      actor: "child-again",
      binding_key: "kid",
      parent_session_id: parent.session.id,
    });
    expect(again.session.id).not.toBe(child.session.id);
    await server.close();
  });

  test("named note slot: the verb's remedy names collab_arrive with its binding_key", async () => {
    const j = journal();
    const a = j.start("alpha");
    const server = j.serve(a);
    const kid = await ok(server, "collab_arrive", { purpose: "a child", binding_key: "kid", parent: a.session.id });
    const credential = readSessionCredentialFile(j.store.defaultSessionCredentialPath(kid.you.session));
    j.store.resumeSession(credential);
    const failed = await call(server, "collab_inbox", { binding_key: "kid" });
    expect(failed.structuredContent).toMatchObject({ code: "session_auth_failed", slot_freed: true });
    expect(failed.structuredContent.remedy.say).toContain(
      `collab_arrive with purpose, binding_key kid and parent ${a.session.id} starts a new session`,
    );
    expect((await call(server, "collab_inbox", {})).isError).toBeUndefined();
    const again = await ok(server, "collab_arrive", { purpose: "a child again", binding_key: "kid", parent: a.session.id });
    expect(again.you.session).not.toBe(kid.you.session);
    await server.close();
  });

  test("any other error, or an auth failure the store does not confirm, keeps the binding", async () => {
    const j = journal();
    const a = j.start("alpha");
    const server = j.serve(a);
    const missing = await call(server, "collab_task_get", { workspace_id: a.workspace.id, task_id: "task_missing" });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent.slot_freed).toBeUndefined();
    expect((await call(server, "collab_next", { workspace_id: a.workspace.id })).isError).toBeUndefined();

    // A wrong token for a live session at its current generation: refused,
    // but nothing shows the session cannot act, so the slot keeps it.
    const b = j.start("bravo");
    const wrong = { ...b, credential: { ...b.credential, session_token: "x".repeat(43) } };
    const file = writeSessionCredentialFile(`${j.store.defaultSessionCredentialPath(b.session.id)}.wrong`, wrong.credential);
    const tampered = buildCollabMcpServer(j.store, { resumed_session: { handle: wrong, credential_file: file } });
    const failed = await call(tampered, "collab_next", { workspace_id: b.workspace.id });
    expect(failed.structuredContent.error).toBe("session_auth_failed");
    expect(failed.structuredContent.slot_freed).toBeUndefined();
    expect((await call(tampered, "collab_session_start", { root_path: j.root, actor: "bravo-2" })).structuredContent.error)
      .toBe("session_already_bound");
    await server.close();
    await tampered.close();
  });

  test("default slot: a verbatim retry is refused, not written in legacy mode, until a new session starts", async () => {
    const j = journal();
    const a = j.start("alpha");
    const server = j.serve(a);
    j.store.endSession({ ...a.credential, reason: "ended by the host CLI" });
    const workspace_id = a.workspace.id;
    const create = { workspace_id, actor: "alpha", idempotency_key: "retry", title: "Edit the parser", path_scopes: ["src"] };
    expect((await call(server, "collab_task_create", create)).structuredContent).toMatchObject({ error: "session_auth_failed", slot_freed: true });
    const before = j.count();
    for (const [tool, input] of [
      ["collab_task_create", create],
      ["collab_task_create", { ...create, work_mode: "edit" }],
      ["collab_decision_record", { workspace_id, actor: "alpha", idempotency_key: "d", topic: "t", decision: "d" }],
      ["collab_workspace_open", { root_path: j.root, actor: "alpha" }],
      ["collab_report_append", { workspace_id, idempotency_key: "r", kind: "observation", body: "b" }],
      ["collab_session_end", {}],
      // Read-only, but of the session's own anchored page.
      ["collab_events_wait", { workspace_id, after_anchor: { epoch_id: "e", sequence: 0, hash: "0".repeat(64) }, wait_ms: 0 }],
    ] as const) {
      const refusal = (await call(server, tool, input)).structuredContent;
      expect(refusal).toMatchObject({ error: "session_not_bound", slot_freed: true, bound_session: { id: a.session.id, state: "ended" } });
      expect(refusal.remedy).toContain("collab_session_start starts a new session");
      expect(refusal.remedy).toContain("does not fall back to legacy actor mode");
    }
    expect((await refused(server, "collab_note", { text: "Anything." })).code).toBe("not_arrived");
    expect(j.count()).toBe(before);
    // Reads that use no session, and the separate presence plane, still answer.
    expect((await ok(server, "collab_task_list", { workspace_id })).tasks).toEqual([]);
    await ok(server, "collab_session_join", { workspace_id, client_instance_id: "c1", actor_label: "alpha", runtime_kind: "test" });
    // The same call after a new start is a bound, reviewed edit task.
    await ok(server, "collab_session_start", { root_path: j.root, actor: "alpha" });
    expect((await ok(server, "collab_task_create", { ...create, work_mode: "edit" })).task)
      .toMatchObject({ work_mode: "edit", completion_policy: "accepted" });
    // A session this process ends itself leaves the slot open to legacy mode, as before.
    await ok(server, "collab_session_end", {});
    expect((await ok(server, "collab_task_create", { ...create, idempotency_key: "legacy", path_scopes: ["docs"] })).task.completion_policy)
      .toBe("reported");
    await server.close();
  });

  test("session_already_bound frees nothing and names the call that does", async () => {
    const j = journal();
    const a = j.start("alpha");
    const server = j.serve(a);
    j.store.endSession({ ...a.credential, reason: "ended by the host CLI" });
    for (const tool of ["collab_session_start", "collab_workspace_open"]) {
      for (let repeat = 0; repeat < 2; repeat += 1) {
        const bound = (await call(server, tool, { root_path: j.root, actor: "alpha" })).structuredContent;
        expect(bound).toMatchObject({ error: "session_already_bound", session_id: a.session.id });
        expect(bound.slot_freed).toBeUndefined();
        expect(bound.remedy).toContain("call collab_arrive or collab_next on this slot");
      }
    }
    // Reads that use no session succeed and free nothing either.
    await ok(server, "collab_task_list", { workspace_id: a.workspace.id });
    expect((await call(server, "collab_session_start", { root_path: j.root, actor: "alpha" })).structuredContent.error).toBe("session_already_bound");
    // collab_session_end authenticates, so it frees the slot too.
    expect((await call(server, "collab_session_end", {})).structuredContent).toMatchObject({ error: "session_auth_failed", slot_freed: true });
    await ok(server, "collab_session_start", { root_path: j.root, actor: "alpha-again" });
    await server.close();
  });

  test("a named slot's remedy prefers the last parent this process holds, and says so when it holds none", async () => {
    const j = journal();
    const a = j.start("alpha");
    const server = j.serve(a);
    const mid = await ok(server, "collab_arrive", { purpose: "a child", binding_key: "mid", parent: a.session.id });
    const leaf = await ok(server, "collab_arrive", { purpose: "a grandchild", binding_key: "leaf", parent: mid.you.session });
    const end = (id: string) => j.store.endSession({
      ...readSessionCredentialFile(j.store.defaultSessionCredentialPath(id)), reason: "ended elsewhere",
    });
    end(leaf.you.session);
    expect((await refused(server, "collab_inbox", { binding_key: "leaf" })).remedy.say).toContain(`and parent ${mid.you.session} starts`);
    await server.close();

    const lone = buildCollabMcpServer(j.store);
    const elsewhere = j.start("elsewhere");
    const kid = await ok(lone, "collab_session_start", {
      root_path: j.root, actor: "kid", binding_key: "kid", parent_session_id: elsewhere.session.id,
    });
    end(kid.session.id);
    expect((await refused(lone, "collab_inbox", { binding_key: "kid" })).remedy.say)
      .toContain("and parent (a session this MCP process holds: arrive on the default slot first)");
    await lone.close();
  });

  test("host binding: forgotten when the session ended, kept when another process resumed it", async () => {
    for (const state of ["ended", "resumed_elsewhere"] as const) {
      const j = journal();
      const a = j.start("alpha");
      const recorded: string[] = [];
      const forgotten: string[] = [];
      const file = writeSessionCredentialFile(j.store.defaultSessionCredentialPath(a.session.id), a.credential);
      const server = buildCollabMcpServer(j.store, {
        environment: {},
        resumed_session: { handle: a, credential_file: file },
        host_binding: {
          record: (id) => { recorded.push(id); return true; },
          forget: (id) => { forgotten.push(id); },
        },
      });
      if (state === "ended") j.store.endSession({ ...a.credential, reason: "ended elsewhere" });
      else j.store.resumeSession(readSessionCredentialFile(file));
      expect((await call(server, "collab_next", { workspace_id: a.workspace.id })).structuredContent)
        .toMatchObject({ slot_freed: true, bound_session: { state } });
      await call(server, "collab_next", { workspace_id: a.workspace.id });
      expect(forgotten).toEqual(state === "ended" ? [a.session.id] : []);
      const started = await ok(server, "collab_session_start", { root_path: j.root, actor: "alpha-again" });
      expect(recorded).toEqual([started.session.id]);
      await server.close();
    }
  });

  test("concurrent calls: the one that lost the race gets the same remedy, and a rebound slot keeps its new session", async () => {
    const j = journal();
    const a = j.start("alpha");
    const server = j.serve(a);
    const workspace_id = a.workspace.id;
    const anchor = j.store.eventsSince(workspace_id, 0, 500).next_anchor;
    const waiting = call(server, "collab_events_wait", { workspace_id, after_anchor: anchor, wait_ms: 5000 });
    j.store.endSession({ ...a.credential, reason: "ended elsewhere" });
    const [first, second] = await Promise.all([
      call(server, "collab_next", { workspace_id }),
      call(server, "collab_next", { workspace_id }),
    ]);
    expect(first!.structuredContent).toMatchObject({ error: "session_auth_failed", slot_freed: true });
    expect(second!.structuredContent).toMatchObject({
      error: "session_auth_failed", slot_freed: true, remedy: first!.structuredContent.remedy,
    });
    const started = await ok(server, "collab_session_start", { root_path: j.root, actor: "alpha-again" });
    // The wait ran with the old binding and fails after the slot was rebound.
    const late = (await waiting).structuredContent;
    expect(late.error).toBe("session_auth_failed");
    expect(late.slot_freed).toBeUndefined();
    const bound = await call(server, "collab_session_start", { root_path: j.root, actor: "third" });
    expect(bound.structuredContent).toMatchObject({ error: "session_already_bound", session_id: started.session.id });
    expect((await call(server, "collab_next", { workspace_id })).isError).toBeUndefined();
    await server.close();
  });

  test("a session ended during a collab_inbox wait: the result's next call frees the slot", async () => {
    const j = journal();
    const a = j.start("alpha");
    const server = j.serve(a);
    const waiting = call(server, "collab_inbox", { wait_seconds: 10 });
    j.store.endSession({ ...a.credential, reason: "ended mid-wait" });
    const result = (await waiting).structuredContent;
    expect(result.waited).toMatchObject({ ended_by: "error", code: "session_auth_failed" });
    expect(result.next.say).toContain("Call collab_arrive on this slot");
    const again = { purpose: "start again", root_path: j.root };
    expect(await refused(server, "collab_arrive", again)).toMatchObject({ code: "session_auth_failed", slot_freed: true });
    expect((await ok(server, "collab_arrive", again)).you.session).not.toBe(a.session.id);
    await server.close();
  });

  test("a freed slot keeps no memo of an earlier leave", async () => {
    const j = journal();
    const server = buildCollabMcpServer(j.store, { environment: {} });
    await ok(server, "collab_arrive", { purpose: "first", root_path: j.root });
    const leave = { text: "Done for today.", outcome: "leave" };
    await ok(server, "collab_done", leave);
    expect((await ok(server, "collab_done", leave)).replayed).toBe(true);
    const second = await ok(server, "collab_session_start", { root_path: j.root, actor: "second" });
    const credential = readSessionCredentialFile(j.store.defaultSessionCredentialPath(second.session.id));
    j.store.endSession({ ...credential, reason: "ended elsewhere" });
    expect(await refused(server, "collab_inbox", {})).toMatchObject({ slot_freed: true });
    expect((await refused(server, "collab_done", leave)).code).toBe("not_arrived");
    await server.close();
  });
});
