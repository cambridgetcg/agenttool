import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { buildCollabMcpServer } from "../src/mcp.js";
import { parseNote } from "../src/note.js";
import { call, journal, ok, refused, runCleanup, type Journal } from "./notes-helpers.js";

// collab_take and collab_done (Collab Notes spec 5.4, 5.5), and their
// derived idempotency.

afterEach(runCleanup);

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function pair(j: Journal = journal()) {
  const a = j.start("alpha");
  const b = j.start("bravo");
  return { j, a, b, sa: j.serve(a), sb: j.serve(b) };
}

const types = (j: Journal, after: number) => j.events().filter((event) => event.sequence > after).map((event) => event.type);

describe("collab_take", () => {
  test("a title creates and claims: coordination and reported without paths, edit and reviewed with them", async () => {
    const { j, a, sa } = pair();
    const plain = await ok(sa, "collab_take", { title: "Write the release note", purpose: "so the owner can read it" });
    expect(plain.task).toMatchObject({ work_mode: "coordination", completion_policy: "reported", state: "claimed" });
    const task = j.store.getTask(a.workspace.id, plain.ids.task);
    expect(task).toMatchObject({ assignee_session_id: a.session.id, description: "Purpose: so the owner can read it" });
    expect(plain.effect).toContain("not ownership or a lock");
    expect(plain.next).toEqual({ tool: "collab_done", input: { text: "<what you did>", task: plain.ids.task } });
    expect(parseNote(plain.note)).toMatchObject({ act: "take", re: `task:${plain.ids.task}`, purpose: "so the owner can read it" });
    // purpose goes into the task description only: the session's purpose is unchanged.
    expect(j.events().some((event) => event.type === "purpose.declared")).toBe(false);
    const edit = await ok(sa, "collab_take", { title: "Edit the parser", paths: ["src/parser.ts"] });
    expect(edit.task).toMatchObject({ work_mode: "edit", completion_policy: "accepted", paths: ["src/parser.ts"] });
    const unreviewed = await ok(sa, "collab_take", { title: "Edit the lexer", paths: ["src/lexer.ts"], review: "none" });
    expect(unreviewed.task.completion_policy).toBe("reported");
  });

  test("a task is claimed; one already held writes nothing; task or title, not both", async () => {
    const { j, a, b, sa, sb } = pair();
    const created = j.store.createTaskForSession({ ...a.credential, idempotency_key: "c", title: "Open work", work_mode: "coordination" });
    const taken = await ok(sb, "collab_take", { task: created.id });
    expect(j.store.getTask(a.workspace.id, created.id).assignee_session_id).toBe(b.session.id);
    const before = j.count();
    const again = await ok(sb, "collab_take", { task: `task#${created.id.slice(5, 11)}` });
    expect(again.advice.join(" ")).toMatch(/already hold|read as a retry/);
    expect(j.count()).toBe(before);
    expect((await refused(sa, "collab_take", { task: created.id, title: "x" })).code).toBe("task_or_title");
    expect((await refused(sa, "collab_take", {})).code).toBe("task_or_title");
    void taken;
  });

  test("a task held by another names the holder and offers a ready note", async () => {
    const { j, a, b, sa, sb } = pair();
    const mine = await ok(sa, "collab_take", { title: "Alpha's work" });
    const refusal = await refused(sb, "collab_take", { task: mine.ids.task });
    expect(refusal.code).toBe("task_claimed");
    expect(refusal.holder).toEqual({ session: a.session.id, name: "alpha", purpose: "alpha's work" });
    expect(refusal.remedy).toEqual({
      tool: "collab_note",
      input: { text: `May I take ${mine.ids.task}?`, re: mine.ids.task, to: a.session.id },
    });
    void j;
    void b;
  });

  test("a path conflict names every holder, their purposes and a ready note, and creates nothing", async () => {
    const j = journal();
    const a = j.start("alpha");
    const b = j.start("bravo");
    const c = j.start("charlie");
    const [sa, sb, sc] = [j.serve(a), j.serve(b), j.serve(c)];
    const first = await ok(sa, "collab_take", { title: "Parser", paths: ["src/parser.ts"] });
    const second = await ok(sb, "collab_take", { title: "Lexer", paths: ["src/lexer.ts"] });
    const tasks = j.store.listTasks(a.workspace.id).length;
    const before = j.count();
    const refusal = await refused(sc, "collab_take", { title: "Everything in src", paths: ["src"] });
    expect(refusal.code).toBe("path_scope_conflict");
    expect(refusal.holders.map((holder: any) => holder.holder)).toEqual(expect.arrayContaining([
      { session: a.session.id, name: "alpha", purpose: "alpha's work" },
      { session: b.session.id, name: "bravo", purpose: "bravo's work" },
    ]));
    const toAlpha = refusal.holders.find((holder: any) => holder.id === first.ids.task);
    expect(toAlpha.next).toMatchObject({ tool: "collab_note", input: { re: first.ids.task, to: a.session.id } });
    expect(refusal.remedy.tool).toBe("collab_note");
    expect(j.count()).toBe(before);
    expect(j.store.listTasks(a.workspace.id).length).toBe(tasks);
    void second;
  });

  test("a lapsed lease is recovered only with because", async () => {
    const { j, a, b, sa, sb } = pair();
    const held = await ok(sa, "collab_take", { title: "Left behind" });
    // Alpha goes quiet for more than 6 hours, past the lease's TTL.
    j.advance(7 * 60 * 60 * 1000);
    expect(j.store.getTask(a.workspace.id, held.ids.task).effective_status).toBe("recovery_required");
    const before = j.count();
    const refusal = await refused(sb, "collab_take", { task: held.ids.task });
    expect(refusal.code).toBe("because_required");
    expect(refusal.remedy).toEqual({ tool: "collab_take", input: { task: held.ids.task, because: "<why you take over the lapsed work>" } });
    expect(j.count()).toBe(before);
    const recovered = await ok(sb, "collab_take", { task: held.ids.task, because: "Alpha has been gone for seven hours." });
    expect(types(j, before)).toContain("task.recovered");
    expect(j.store.getTask(a.workspace.id, recovered.ids.task).assignee_session_id).toBe(b.session.id);
  });

  test("retries: a lost response replays; a repeat after the work was given back takes again", async () => {
    const { j, a, sa } = pair();
    const first = await ok(sa, "collab_take", { title: "One task" });
    const before = j.count();
    const retry = await ok(sa, "collab_take", { title: "One task" });
    expect(retry).toMatchObject({ replayed: true, ids: { task: first.ids.task } });
    expect(j.count()).toBe(before);
    expect(j.store.listTasks(a.workspace.id)).toHaveLength(1);
    await ok(sa, "collab_done", { text: "Giving it back.", outcome: "released" });
    const again = await ok(sa, "collab_take", { title: "One task" });
    expect(again.replayed).toBeUndefined();
    expect(again.ids.task).not.toBe(first.ids.task);
    // By task: a retry replays; after a release in between, the same take claims again.
    const byTask = await ok(sa, "collab_take", { task: first.ids.task });
    const mark = j.count();
    expect((await ok(sa, "collab_take", { task: first.ids.task })).replayed).toBe(true);
    expect(j.count()).toBe(mark);
    await ok(sa, "collab_done", { text: "Back again.", outcome: "released", task: first.ids.task });
    const retaken = await ok(sa, "collab_take", { task: first.ids.task });
    expect(retaken.replayed).toBeUndefined();
    expect(types(j, mark)).toContain("task.claimed");
    void byTask;
  });
});

describe("collab_done", () => {
  test("finished attaches several evidence items, completes with the note as summary, and waits for review", async () => {
    const { j, a, b, sa } = pair();
    j.write("src/parser.ts", "parser\n");
    const taken = await ok(sa, "collab_take", { title: "Edit the parser", paths: ["src/parser.ts"] });
    const reported = j.store.appendReportForSession({ ...b.credential, idempotency_key: "r", kind: "observation", body: "A related finding." });
    const done = await ok(sa, "collab_done", {
      text: "The parser keeps trailing tabs now.",
      why: [{ text: "the test passes", basis: "seen", cites: [2] }],
      evidence: ["file src/parser.ts", "test bun test tests/parser.test.ts exit=0", "url https://example.org/issue/1", `report:${reported.id}`],
      limits: "Only the parser.",
      review_by: "bravo",
    });
    const task = j.store.getTask(a.workspace.id, taken.ids.task);
    expect(task).toMatchObject({ status: "completed", review_status: "pending", review_requested_session_id: b.session.id });
    expect(done.effect).toContain("waits for review by a distinct session");
    expect(done.ids.artifacts.map((artifact: any) => artifact.evidence)).toEqual([1, 2, 3]);
    const listed = new Map(j.store.getTask(a.workspace.id, task.id).artifacts!.map((artifact) => [artifact.id, artifact]));
    const artifacts = done.ids.artifacts.map((artifact: any) => listed.get(artifact.artifact)!) as Array<{ id: string; kind: string; uri: string; sha256: string | null }>;
    expect(artifacts.map((artifact) => [artifact.kind, artifact.uri, artifact.sha256])).toEqual([
      ["file", "src/parser.ts", sha("parser\n")],
      ["test", "bun test tests/parser.test.ts", null],
      ["url", "https://example.org/issue/1", null],
    ]);
    const completion = j.report(task.completion_report_id!);
    expect(completion.body).toBe(done.note.split("\n").filter((line: string) => !line.startsWith("Evidence: ")).join("\n"));
    expect(completion.confidence_basis).toBe("the test passes (seen 2)");
    expect(completion.limits).toBe("Only the parser.");
    expect(JSON.parse(completion.evidence_refs_json).sort()).toEqual(
      [...artifacts.map((artifact) => `artifact:${artifact.id}`), `report:${reported.id}`].sort(),
    );
  });

  test("an interrupted finish resumes without duplicating what it did", async () => {
    const { j, a, sa } = pair();
    j.write("a.txt", "a\n");
    j.write("b.txt", "b\n");
    const taken = await ok(sa, "collab_take", { title: "Two files" });
    const input = { text: "Both files are right.", evidence: ["file a.txt", "file b.txt", "test make check exit=0"] };
    // The second attach fails once, as a crash between steps would leave it.
    const attach = j.store.attachArtifactForSession.bind(j.store);
    let calls = 0;
    (j.store as any).attachArtifactForSession = (request: any) => {
      calls += 1;
      if (calls === 2) throw new Error("simulated failure between steps");
      return attach(request);
    };
    const failed = await call(sa, "collab_done", input);
    expect(failed.isError).toBe(true);
    expect(j.store.getTask(a.workspace.id, taken.ids.task).artifacts).toHaveLength(1);
    // And the completion fails once too.
    const complete = j.store.completeTaskForSession.bind(j.store);
    let completes = 0;
    (j.store as any).completeTaskForSession = (request: any) => {
      completes += 1;
      if (completes === 1) throw new Error("simulated failure before completion");
      return complete(request);
    };
    expect((await call(sa, "collab_done", input)).isError).toBe(true);
    expect(j.store.getTask(a.workspace.id, taken.ids.task).artifacts).toHaveLength(3);
    const done = await ok(sa, "collab_done", input);
    expect(done.advice.join(" ")).toContain("stopped part way");
    const task = j.store.getTask(a.workspace.id, taken.ids.task);
    expect(task.status).toBe("completed");
    expect(task.artifacts).toHaveLength(3);
    expect(j.events().filter((event) => event.type === "task.completed")).toHaveLength(1);
    // A lost-response retry of the whole call now replays every step.
    const before = j.count();
    const retry = await ok(sa, "collab_done", input);
    expect(retry).toMatchObject({ replayed: true, ids: { completion: done.ids.completion } });
    expect(j.count()).toBe(before);
  });

  test("released and blocked", async () => {
    const { j, a, sa } = pair();
    const one = await ok(sa, "collab_take", { title: "Give back" });
    const released = await ok(sa, "collab_done", { text: "Someone else should take it.", outcome: "released" });
    expect(j.store.getTask(a.workspace.id, one.ids.task)).toMatchObject({ status: "open", assignee_session_id: null });
    expect(released.task.state).toBe("open");
    const two = await ok(sa, "collab_take", { title: "Stuck" });
    const noBecause = await refused(sa, "collab_done", { text: "Halfway.", outcome: "blocked" });
    expect(noBecause.code).toBe("because_required");
    expect(noBecause.remedy).toEqual({ tool: "collab_done", input: { text: "Halfway.", outcome: "blocked", because: "<what blocks it>" } });
    const before = j.count();
    await ok(sa, "collab_done", { text: "Halfway through.", outcome: "blocked", because: "Waiting on the schema decision." });
    expect(types(j, before)).toEqual(["task.progressed", "task.blocked"]);
    expect(j.store.getTask(a.workspace.id, two.ids.task)).toMatchObject({
      status: "blocked", blocker: "Waiting on the schema decision.", latest_progress: "Halfway through.",
    });
    // What a release cannot store is refused, not dropped.
    const stored = await refused(sa, "collab_done", { text: "x", outcome: "released", why: [{ text: "y" }] });
    expect(stored).toMatchObject({ code: "not_stored", fields: ["why"], remedy: { tool: "collab_done", input: { text: "x", outcome: "released" } } });
  });

  test("the default task is the one held; several are refused with candidates; none says how to take one", async () => {
    const { sa } = pair();
    const none = await refused(sa, "collab_done", { text: "Done." });
    expect(none.code).toBe("nothing_held");
    expect(none.remedy).toEqual({ tool: "collab_take", input: { title: "<the work you are doing>" } });
    const one = await ok(sa, "collab_take", { title: "One" });
    await ok(sa, "collab_take", { title: "Two" });
    const several = await refused(sa, "collab_done", { text: "Done." });
    expect(several.code).toBe("several_holds");
    expect(several.candidates.map((candidate: any) => candidate.id)).toContain(one.ids.task);
    expect(several.candidates).toHaveLength(2);
    expect(several.remedy.say).toContain("task set to the id");
  });

  test("leave releases every hold, ends the session, and a retry replays", async () => {
    const { j, a, sa, b } = pair();
    const held = await ok(sa, "collab_take", { title: "Unfinished" });
    const needs = await refused(sa, "collab_done", { text: "Leaving.", outcome: "leave" });
    expect(needs.code).toBe("because_required");
    const left = await ok(sa, "collab_done", { text: "Leaving.", outcome: "leave", because: "My part is over; the rest is open." });
    expect(left.effect).toContain("You are no longer a voice in new proposals or a unit in new ballots here.");
    expect(left.ids.released).toEqual([{ task: held.ids.task, task_handle: expect.any(String), via: "release" }]);
    expect(j.store.getCoordinationSession(a.session.id)!.status).toBe("ended");
    expect(j.store.getTask(a.workspace.id, held.ids.task).status).toBe("open");
    expect(existsSync(j.store.defaultSessionCredentialPath(a.session.id))).toBe(false);
    const before = j.count();
    const retry = await ok(sa, "collab_done", { text: "Leaving.", outcome: "leave", because: "My part is over; the rest is open." });
    expect(retry.replayed).toBe(true);
    expect(retry.effect).toStartWith("Replayed: nothing new was written.");
    expect(j.count()).toBe(before);
    // Any other call on the slot now asks to arrive again.
    expect((await refused(sa, "collab_note", { text: "Still here?" })).code).toBe("not_arrived");
    expect((await refused(sa, "collab_done", { text: "Another leave.", outcome: "leave" })).code).toBe("not_arrived");
    // No longer a voice in a new proposal.
    const proposal = j.store.openProposalForSession({
      ...b.credential, idempotency_key: "p", question: "Next?", criteria: "c", extent: "e",
    });
    expect(proposal.terms.voices.map((voice) => voice.voice_id)).not.toContain(a.session.id);
  });

  test("after leaving, a new arrival on the slot leaves again when it says the same", async () => {
    const j = journal();
    const server = buildCollabMcpServer(j.store, {}) as any;
    const first = await ok(server, "collab_arrive", { purpose: "first visit", name: "visitor", root_path: j.root });
    await ok(server, "collab_done", { text: "Bye.", outcome: "leave" });
    const second = await ok(server, "collab_arrive", { purpose: "second visit", name: "visitor", root_path: j.root });
    expect(second.you.session).not.toBe(first.you.session);
    const again = await ok(server, "collab_done", { text: "Bye.", outcome: "leave" });
    expect(again.replayed).toBeUndefined();
    expect(again.session.id).toBe(second.you.session);
    expect(j.store.getCoordinationSession(second.you.session)!.status).toBe("ended");
  });

  test("leave on a named slot ends only that child", async () => {
    const j = journal();
    const server = buildCollabMcpServer(j.store, {}) as any;
    const parent = await ok(server, "collab_arrive", { purpose: "parent work", name: "parent", root_path: j.root });
    const child = await ok(server, "collab_arrive", { purpose: "child work", binding_key: "kid", parent: parent.you.session });
    const left = await ok(server, "collab_done", { text: "Child done.", outcome: "leave", binding_key: "kid" });
    expect(left.session.id).toBe(child.you.session);
    expect(j.store.getCoordinationSession(child.you.session)!.status).toBe("ended");
    expect(j.store.getCoordinationSession(parent.you.session)!.status).toBe("active");
    expect((await ok(server, "collab_done", { text: "Child done.", outcome: "leave", binding_key: "kid" })).replayed).toBe(true);
    expect((await ok(server, "collab_note", { text: "The parent still speaks." })).ok).toBe(true);
  });
});

describe("derived idempotency for collab_done", () => {
  test("finished: a lost-response retry replays, found by its own receipt once nothing is held", async () => {
    const { j, sa } = pair();
    await ok(sa, "collab_take", { title: "Work" });
    const first = await ok(sa, "collab_done", { text: "Done." });
    const before = j.count();
    const retry = await ok(sa, "collab_done", { text: "Done." });
    expect(retry).toMatchObject({ replayed: true, ids: { completion: first.ids.completion } });
    expect(j.count()).toBe(before);
  });

  test("released: a retry replays; a repeat after taking it again releases again", async () => {
    const { j, a, sa } = pair();
    const taken = await ok(sa, "collab_take", { title: "Work" });
    const input = { text: "Not mine after all.", outcome: "released", task: taken.ids.task };
    await ok(sa, "collab_done", input);
    const before = j.count();
    expect((await ok(sa, "collab_done", input)).replayed).toBe(true);
    expect(j.count()).toBe(before);
    await ok(sa, "collab_take", { task: taken.ids.task });
    const again = await ok(sa, "collab_done", input);
    expect(again.replayed).toBeUndefined();
    expect(types(j, before)).toEqual(["task.claimed", "task.released"]);
    // Claimed again outside the verbs, the earlier release is no longer current: the same call acts afresh.
    const task = j.store.getTask(a.workspace.id, taken.ids.task);
    j.store.claimTaskForSession({ ...a.credential, idempotency_key: "legacy-claim", task_id: task.id, expected_version: task.version });
    const mark = j.count();
    const afresh = await ok(sa, "collab_done", input);
    expect(afresh.replayed).toBeUndefined();
    expect(types(j, mark)).toEqual(["task.released"]);
  });

  test("blocked: a retry replays", async () => {
    const { j, sa } = pair();
    const taken = await ok(sa, "collab_take", { title: "Work" });
    const input = { text: "Stuck.", outcome: "blocked", because: "Waiting.", task: taken.ids.task };
    await ok(sa, "collab_done", input);
    const before = j.count();
    expect((await ok(sa, "collab_done", input)).replayed).toBe(true);
    expect(j.count()).toBe(before);
  });
});
