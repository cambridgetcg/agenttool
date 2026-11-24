import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { buildCollabMcpServer } from "../src/mcp.js";
import { readSessionCredentialFile, writeSessionCredentialFile } from "../src/session-file.js";
import { call, journal, ok, refused, runCleanup } from "./notes-helpers.js";

// A slot whose session was ended, or resumed, outside this MCP process is
// freed by its next call refused with session_auth_failed, and by nothing else.

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
    // Freed once: the slot is unbound now, so the next call is legacy mode, not an auth failure.
    expect((await call(server, "collab_next", { workspace_id: a.workspace.id })).structuredContent.error).toBe("actor_required");
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
    expect(failed.structuredContent.remedy).toContain("collab_session_start with binding_key kid starts a new session");
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
    expect(failed.structuredContent.remedy.say).toContain("collab_arrive with binding_key kid starts a new session");
    expect((await call(server, "collab_inbox", {})).isError).toBeUndefined();
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
});
