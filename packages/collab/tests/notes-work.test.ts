import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCollabMcpServer } from "../src/mcp.js";
import { CollabError } from "../src/errors.js";
import { parseNote } from "../src/note.js";
import { call, git, journal, ok, refused, runCleanup, type Journal } from "./notes-helpers.js";
import { handleOf } from "../src/verbs.js";

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
      [...artifacts.map((artifact) => `artifact:${artifact.id}`), `event:${done.ids.evidence_cited.event}`, `report:${reported.id}`].sort(),
    );
    // The outside items are cited first, by the completion's author, so the notes surface can show them.
    const cited = j.events().find((event) => event.type === "evidence.cited" && event.entity_id === done.ids.evidence_cited.cite)!;
    expect(cited.payload.by_session_id).toBe(a.session.id);
    expect(cited.payload.items.map((item: any) => [item.n, item.kind, item.locator, item.observed])).toEqual([
      [1, "file", "src/parser.ts", "server"],
      [2, "test", "bun test tests/parser.test.ts", "caller"],
      [3, "url", "https://example.org/issue/1", "caller"],
    ]);
  });

  test("a reviewer on the notes surface sees each Evidence item of a done, with now for a server-hashed file", async () => {
    const { j, sa, sb: reviewer } = pair();
    j.write("src/parser.ts", "parser\n");
    const taken = await ok(sa, "collab_take", { title: "Edit the parser", paths: ["src/parser.ts"] });
    const done = await ok(sa, "collab_done", {
      text: "Parser edited.",
      why: [{ text: "the parser test passes", basis: "seen", cites: [2] }],
      evidence: ["file src/parser.ts", "test bun test tests/parser.test.ts exit=0", "url https://example.org/issue/1"],
    });
    j.write("src/parser.ts", "parser, changed after the done\n");
    for (const about of [taken.ids.task, done.ids.completion]) {
      const view = await ok(reviewer, "collab_inbox", { about });
      const entry = about === done.ids.completion ? view.root : view.thread.find((item: any) => item.id === done.ids.completion);
      expect(entry).toBeDefined();
      const event = entry.evidence.find((item: any) => item.kind === "event");
      expect(event.cited.map((item: any) => ({ n: item.n, kind: item.kind, locator: item.locator, observed: item.observed, now: item.now })))
        .toEqual([
          { n: 1, kind: "file", locator: "src/parser.ts", observed: "server", now: "changed" },
          { n: 2, kind: "test", locator: "bun test tests/parser.test.ts", observed: "caller", now: undefined },
          { n: 3, kind: "url", locator: "https://example.org/issue/1", observed: "caller", now: undefined },
        ]);
      expect(event.cited[0].sha256).toBe(sha("parser\n"));
    }
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
    // A remedy never carries a stand-in value a tool would store as real text.
    expect(noBecause.remedy).toEqual({ say: "Send the same call with because set to one line on what blocks the work." });
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

  test("a ready call's stand-in sent on unchanged is refused, never stored as the caller's words", async () => {
    const { j, sa } = pair();
    const taken = await ok(sa, "collab_take", { title: "Fill me in" });
    expect(taken.next).toMatchObject({ tool: "collab_done", input: { text: "<what you did>" } });
    const before = j.count();
    const sent = await refused(sa, taken.next.tool, taken.next.input);
    expect(sent).toMatchObject({ code: "stand_in_not_filled", field: "text", remedy: { say: "Send the call again with text in your own words." } });
    expect(j.count()).toBe(before);
    // Angle brackets inside real text are the caller's own words.
    const done = await ok(sa, "collab_done", { text: "Replaced <title> handling in the parser", outcome: "released" });
    expect(done.note).toContain("<title>");
  });

  test("the default task is the one held; several are refused with candidates; none says how to take one", async () => {
    const { sa } = pair();
    const none = await refused(sa, "collab_done", { text: "Done." });
    expect(none.code).toBe("nothing_held");
    expect(none.remedy).toEqual({ say: "Take the work first: collab_take with title set to what you are doing, and paths if you will edit files." });
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

  test("finished, sent back for changes, the same done: not held, with a ready take; taken again, it completes afresh", async () => {
    const { j, a, sa, sb } = pair();
    const taken = await ok(sa, "collab_take", { title: "Edit", paths: ["src/x.ts"] });
    const done = await ok(sa, "collab_done", { text: "Done." });
    await ok(sb, "collab_note", { act: "request_changes", text: "Not yet.", re: done.ids.completion });
    expect(j.store.getTask(a.workspace.id, taken.ids.task)).toMatchObject({ status: "open", review_status: "changes_requested" });
    const before = j.count();
    const again = await refused(sa, "collab_done", { text: "Done." });
    expect(again.code).toBe("not_held");
    expect(again.replayed).toBeUndefined();
    expect(again.remedy).toEqual({ tool: "collab_take", input: { task: taken.ids.task } });
    expect(j.count()).toBe(before);
    await ok(sa, "collab_take", { task: taken.ids.task });
    const named = { text: "Done, with the change.", task: taken.ids.task };
    const redone = await ok(sa, "collab_done", { text: "Done." });
    expect(redone.replayed).toBeUndefined();
    expect(redone.ids.completion).not.toBe(done.ids.completion);
    expect(j.store.getTask(a.workspace.id, taken.ids.task)).toMatchObject({ status: "completed", review_status: "pending" });
    // The same with the task named in the call.
    await ok(sb, "collab_note", { act: "request_changes", text: "Still not.", re: redone.ids.completion });
    await ok(sa, "collab_take", { task: taken.ids.task });
    const third = await ok(sa, "collab_done", named);
    await ok(sb, "collab_note", { act: "request_changes", text: "One more.", re: third.ids.completion });
    const mark = j.count();
    const stale = await refused(sa, "collab_done", named);
    expect(stale.code).toBe("not_held");
    expect(stale.remedy).toEqual({ tool: "collab_take", input: { task: taken.ids.task } });
    expect(j.count()).toBe(mark);
  });

  test("a replayed done after its acceptance says it was accepted", async () => {
    const { j, sa, sb } = pair();
    await ok(sa, "collab_take", { title: "Edit", paths: ["src/x.ts"] });
    const done = await ok(sa, "collab_done", { text: "Done." });
    await ok(sb, "collab_note", { act: "accept", text: "It holds.", re: done.ids.completion });
    const before = j.count();
    const retry = await ok(sa, "collab_done", { text: "Done." });
    expect(retry).toMatchObject({ replayed: true, ids: { completion: done.ids.completion } });
    expect(retry.effect).toContain("a distinct session has accepted it");
    expect(retry.effect).not.toContain("waits for review");
    expect(j.count()).toBe(before);
  });

  test("two identical collab_done calls at once both succeed, with one completion", async () => {
    const { j, a, sa } = pair();
    j.write("a.txt", "a\n");
    j.write("b.txt", "b\n");
    const taken = await ok(sa, "collab_take", { title: "Two files" });
    const input = { text: "Both files are right.", evidence: ["file a.txt", "file b.txt"] };
    const [one, two] = await Promise.all([call(sa, "collab_done", input), call(sa, "collab_done", input)]);
    expect([one.isError ?? false, two.isError ?? false]).toEqual([false, false]);
    expect(one.structuredContent.ids.completion).toBe(two.structuredContent.ids.completion);
    expect(j.store.getTask(a.workspace.id, taken.ids.task).artifacts).toHaveLength(2);
    expect(j.events().filter((event) => event.type === "task.completed")).toHaveLength(1);
  });
});

describe("collab_done finished: what is stored", () => {
  test("a hash the caller wrote is kept in the artifact's label, never as a checked sha256", async () => {
    const { j, a, sa } = pair();
    writeFileSync(join(j.directory, "outside.bin"), "x");
    const taken = await ok(sa, "collab_take", { title: "Data work" });
    const data = "ab".repeat(32);
    const file = "cd".repeat(32);
    await ok(sa, "collab_done", {
      text: "The dataset is the one we agreed.",
      evidence: [`data training-set sha256=${data}`, `file ../outside.bin sha256=${file}`, "test make check exit=0 runs=3", "msg slack C123 1699999"],
    });
    const artifacts = j.store.getTask(a.workspace.id, taken.ids.task).artifacts!
      .map((artifact) => [artifact.kind, artifact.uri, artifact.sha256, artifact.label])
      .sort((left, right) => String(left[3]).localeCompare(String(right[3])));
    expect(artifacts).toEqual([
      ["data", "training-set", null, `Evidence 1 sha256=${data}: as the caller wrote it`],
      ["file", "../outside.bin", null, `Evidence 2 sha256=${file}: as the caller wrote it`],
      ["test", "make check", null, "Evidence 3 exit=0 runs=3: as the caller wrote it"],
      ["other", "slack C123 1699999", null, "Evidence 4: as the caller wrote it"],
    ]);
  });

  test("a commit is attached as a commit artifact: checked by git, or not found", async () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    const sa = j.serve(a);
    const head = git(j.root, ["rev-parse", "HEAD"]);
    const taken = await ok(sa, "collab_take", { title: "Commit work" });
    const done = await ok(sa, "collab_done", { text: "Committed.", evidence: [`commit ${head}`, `commit ${"0".repeat(40)}`] });
    expect(done.evidence.map((item: any) => item.observed)).toEqual(["server", "not_found"]);
    expect(j.store.getTask(a.workspace.id, taken.ids.task).artifacts!.map((artifact) => [artifact.kind, artifact.uri, artifact.sha256, artifact.label])
      .sort((left, right) => String(left[3]).localeCompare(String(right[3]))))
      .toEqual([
        ["commit", head, null, "Evidence 1: checked by the server"],
        ["commit", "0".repeat(40), null, "Evidence 2: not found by git"],
      ]);
  });

  test("ceilings: the note without its Evidence lines at most 4,000, the reasons at most 2,000, refused before any write", async () => {
    const { j, a, sa } = pair();
    const taken = await ok(sa, "collab_take", { title: "Long work" });
    const before = j.count();
    const long = await refused(sa, "collab_done", { text: `Done.\n\n${"y".repeat(4_000)}`, evidence: ["test make check exit=0"] });
    expect(long).toMatchObject({ code: "too_long", field: "note", max: 4_000 });
    const reasons = await refused(sa, "collab_done", {
      text: "Done.",
      why: Array.from({ length: 8 }, (_, index) => ({ text: `${index} ${"r".repeat(290)}`, basis: "seen" })),
      evidence: ["test make check exit=0"],
    });
    expect(reasons).toMatchObject({ code: "too_long", field: "why", max: 2_000 });
    expect(j.count()).toBe(before);
    expect(j.store.getTask(a.workspace.id, taken.ids.task)).toMatchObject({ status: "claimed", artifacts: [] });
    // Evidence lines do not count toward the summary's ceiling.
    const evidence = Array.from({ length: 16 }, (_, index) => `test ${"c".repeat(200)} ${index} exit=0`);
    const fits = await ok(sa, "collab_done", { text: `Done.\n\n${"y".repeat(3_900)}`, evidence });
    expect(fits.note.length).toBeGreaterThan(4_000);
    expect(j.report(fits.ids.completion).body.length).toBeLessThanOrEqual(4_000);
  });
});

describe("refused before anything is written, or not refused at all", () => {
  test("released or blocked with a first line over 200 characters is refused, and the task is still held", async () => {
    const { j, a, sa } = pair();
    const taken = await ok(sa, "collab_take", { title: "Work" });
    const before = j.count();
    for (const input of [
      { text: "r".repeat(201), outcome: "released" },
      { text: "b".repeat(201), outcome: "blocked", because: "Waiting." },
    ]) {
      const refusal = await refused(sa, "collab_done", input);
      expect(refusal).toMatchObject({ code: "statement_too_long", field: "statement", max: 200 });
      expect(j.count()).toBe(before);
      expect(j.store.getTask(a.workspace.id, taken.ids.task)).toMatchObject({ status: "claimed", assignee_session_id: a.session.id });
    }
    // Put on a line of its own, the same text is given back.
    const released = await ok(sa, "collab_done", { text: `Giving it back.\n\n${"r".repeat(201)}`, outcome: "released" });
    expect(parseNote(released.note)).toMatchObject({ act: "done", statement: "Giving it back.", body: "r".repeat(201) });
  });

  test("a leave whose text ends in a trailer-like paragraph ends the session, and the slot can arrive again", async () => {
    const j = journal();
    const server = buildCollabMcpServer(j.store, {}) as any;
    const first = await ok(server, "collab_arrive", { purpose: "visit", name: "visitor", root_path: j.root });
    const left = await ok(server, "collab_done", { text: "Bye.\n\nTo: person", outcome: "leave" });
    expect(j.store.getCoordinationSession(first.you.session)!.status).toBe("ended");
    // The returned note cannot carry that paragraph as body text, so it carries the statement; the stored reason keeps it all.
    expect(parseNote(left.note)).toMatchObject({ act: "done", statement: "Bye.", body: null, to: null });
    expect(left.advice.join(" ")).toContain("would be read as trailers");
    const ended = j.events().find((event) => event.type === "session.ended" && event.entity_id === first.you.session)!;
    expect(ended.payload.reason).toBe("Bye.\n\nTo: person");
    expect((await ok(server, "collab_done", { text: "Bye.\n\nTo: person", outcome: "leave" })).replayed).toBe(true);
    const again = await ok(server, "collab_arrive", { purpose: "visit again", name: "visitor", root_path: j.root });
    expect(again.you.session).not.toBe(first.you.session);
    expect((await ok(server, "collab_note", { text: "Back again." })).ok).toBe(true);
  });

  test("an emoji across the statement's cut neither fails a take after it wrote nor a leave after it ended", async () => {
    const { j, a, sa } = pair();
    const title = `${"t".repeat(198)}😀${"u".repeat(20)}`;
    const taken = await ok(sa, "collab_take", { title });
    const parsed = parseNote(taken.note);
    expect(parsed).toMatchObject({ act: "take", body: title });
    expect(parsed.statement.length).toBeLessThanOrEqual(200);
    const left = await ok(sa, "collab_done", { text: title, outcome: "leave", because: "Out of time." });
    expect(parseNote(left.note)).toMatchObject({ act: "done", body: title });
    expect(j.store.getCoordinationSession(a.session.id)!.status).toBe("ended");
  });

  test("finished with a review_by the completion would refuse attaches nothing, and the corrected call attaches once", async () => {
    const { j, a, sa } = pair();
    j.write("a.txt", "a\n");
    const coordination = await ok(sa, "collab_take", { title: "Coordination work" });
    const input = { text: "Done.", evidence: ["file a.txt", "test make exit=0"] };
    const before = j.count();
    const notApplicable = await refused(sa, "collab_done", { ...input, review_by: "bravo" });
    expect(notApplicable.code).toBe("review_request_not_applicable");
    expect(notApplicable.remedy).toEqual({ tool: "collab_done", input: { ...input, task: coordination.ids.task } });
    expect(j.count()).toBe(before);
    expect(j.store.getTask(a.workspace.id, coordination.ids.task).artifacts).toHaveLength(0);
    await ok(sa, "collab_done", input);
    expect(j.store.getTask(a.workspace.id, coordination.ids.task).artifacts).toHaveLength(2);

    const edit = await ok(sa, "collab_take", { title: "Edit", paths: ["a.txt"] });
    const mark = j.count();
    const self = await refused(sa, "collab_done", { ...input, review_by: "alpha" });
    expect(self.code).toBe("review_request_self");
    expect(self.remedy).toEqual({ tool: "collab_done", input: { ...input, task: edit.ids.task } });
    expect(j.count()).toBe(mark);
    expect(j.store.getTask(a.workspace.id, edit.ids.task).artifacts).toHaveLength(0);
  });

  test("finished with a journal pointer that does not exist attaches nothing", async () => {
    const { j, a, sa } = pair();
    j.write("a.txt", "a\n");
    const taken = await ok(sa, "collab_take", { title: "Work" });
    const before = j.count();
    const refusal = await refused(sa, "collab_done", { text: "Done.", evidence: ["file a.txt", "event:event_00000000-0000-4000-8000-000000000000"] });
    expect(refusal.code).toBe("evidence_not_found");
    expect(j.count()).toBe(before);
    expect(j.store.getTask(a.workspace.id, taken.ids.task).artifacts).toHaveLength(0);
  });

  test("a refusal after an earlier step names the steps it recorded, never that nothing was written", async () => {
    const { j, a, sa } = pair();
    j.write("a.txt", "a\n");
    const taken = await ok(sa, "collab_take", { title: "Work" });
    (j.store as any).completeTaskForSession = () => {
      throw new CollabError("worktree_observation_stale", "The registered worktree changed after it was inspected");
    };
    const refusal = await refused(sa, "collab_done", { text: "Done.", evidence: ["file a.txt"] });
    expect(refusal.code).toBe("worktree_observation_stale");
    const artifact = j.store.getTask(a.workspace.id, taken.ids.task).artifacts![0]!;
    const cite = j.events().find((event) => event.type === "evidence.cited")!;
    expect(refusal.recorded_steps).toEqual([
      { step: 1, what: expect.stringContaining(`(cite ${cite.payload.cite_id})`), id: expect.stringMatching(/^event_/) },
      { step: 2, what: `artifact ${artifact.id} for evidence 1`, id: artifact.id },
    ]);
    expect(refusal.message).toContain(artifact.id);
    expect(refusal.message).not.toContain("..");
    expect(JSON.stringify(refusal.remedy)).not.toMatch(/nothing was written/i);
  });

  test("a take refused after creating its task, and a block refused after its progress, name what they recorded", async () => {
    const { j, a, sa } = pair();
    const claim = j.store.claimTaskForSession.bind(j.store);
    (j.store as any).claimTaskForSession = () => {
      throw new CollabError("worktree_observation_stale", "The registered worktree changed after it was inspected");
    };
    const take = await refused(sa, "collab_take", { title: "New work" });
    const created = j.store.listTasks(a.workspace.id)[0]!;
    expect(take.recorded_steps).toEqual([{ step: 1, what: `task ${created.id}, created and open`, id: created.id }]);
    expect(JSON.stringify(take.remedy)).not.toMatch(/nothing was written/i);
    (j.store as any).claimTaskForSession = claim;
    // The same take again replays the create and claims.
    const resumed = await ok(sa, "collab_take", { title: "New work" });
    expect(resumed.ids.task).toBe(created.id);
    expect(j.store.listTasks(a.workspace.id)).toHaveLength(1);
    (j.store as any).blockTaskForSession = () => {
      throw new CollabError("worktree_observation_stale", "The registered worktree changed after it was inspected");
    };
    const block = await refused(sa, "collab_done", { text: "Stuck.", outcome: "blocked", because: "Waiting." });
    expect(block.recorded_steps).toEqual([{ step: 1, what: `the text as progress on task ${created.id}`, id: created.id }]);
    expect(JSON.stringify(block.remedy)).not.toMatch(/nothing was written/i);
    expect(block.remedy.say).not.toContain("..");
  });

  test("a block refused after its progress, sent again, replays the progress and blocks once", async () => {
    const { j, a, sa } = pair();
    const taken = await ok(sa, "collab_take", { title: "New work" });
    const block = j.store.blockTaskForSession.bind(j.store);
    let failures = 1;
    (j.store as any).blockTaskForSession = (input: any) => {
      if (failures-- > 0) throw new CollabError("worktree_observation_stale", "The registered worktree changed after it was inspected");
      return block(input);
    };
    const input = { text: "Stuck.", outcome: "blocked", because: "Waiting." };
    const refusal = await refused(sa, "collab_done", input);
    // The remedy promises a replay; the same call sent again keeps that promise.
    expect(refusal.remedy.say).toContain("replays them instead of writing them twice");
    const again = await ok(sa, "collab_done", input);
    expect(again.task.state).toBe("blocked");
    const progressed = j.events().filter((event) => event.type === "task.progressed" && event.entity_id === taken.ids.task);
    const blocked = j.events().filter((event) => event.type === "task.blocked" && event.entity_id === taken.ids.task);
    expect([progressed.length, blocked.length]).toEqual([1, 1]);
    // A lost response after that is a retry too: nothing new.
    const before = j.count();
    expect((await ok(sa, "collab_done", input)).replayed).toBe(true);
    expect(j.count()).toBe(before);
    void a;
  });

  test("because is not dropped: refused on finished, and said to be unused on a live take", async () => {
    const { j, a, sa } = pair();
    const created = j.store.createTaskForSession({ ...a.credential, idempotency_key: "c", title: "Open", work_mode: "coordination" });
    const taken = await ok(sa, "collab_take", { task: created.id, because: "I want it" });
    expect(taken.advice.join(" ")).toContain("because is for recovering a lapsed lease");
    const before = j.count();
    const refusal = await refused(sa, "collab_done", { text: "Done.", because: "It was quick." });
    expect(refusal).toMatchObject({ code: "not_stored", fields: ["because"], remedy: { tool: "collab_done", input: { text: "Done." } } });
    expect(j.count()).toBe(before);
  });

  test("a done retried with an equivalent spelling of its reasons, evidence and reviewer replays", async () => {
    const { j, b, sa } = pair();
    const reported = j.store.appendReportForSession({ ...b.credential, idempotency_key: "r", kind: "observation", body: "A finding." });
    await ok(sa, "collab_take", { title: "Work", paths: ["src/a.ts"] });
    const first = await ok(sa, "collab_done", {
      text: "Done.",
      why: [{ text: "it ran", basis: "seen" }],
      evidence: [`report:${reported.id}`],
      limits: "only this",
      review_by: "bravo",
    });
    const before = j.count();
    const retry = await ok(sa, "collab_done", {
      text: "Done.",
      why: [{ text: "it ran ", basis: "Seen" }],
      evidence: [handleOf("report", reported.id)],
      limits: "only this ",
      review_by: b.session.id,
    });
    expect(retry).toMatchObject({ replayed: true, ids: { completion: first.ids.completion } });
    expect(j.count()).toBe(before);
  });

  test("a take over paths you already hold says to finish or release that hold, not to ask yourself", async () => {
    const { j, sa } = pair();
    const held = await ok(sa, "collab_take", { title: "Parser", paths: ["src/parser.ts"] });
    const before = j.count();
    const overlap = await refused(sa, "collab_take", { title: "Parser again", paths: ["src/parser.ts"] });
    expect(overlap.code).toBe("path_scope_conflict");
    expect(overlap.message).toContain(`${held.ids.task_handle}, which you hold`);
    expect(overlap.remedy.say).toContain(`You already hold ${held.ids.task_handle}`);
    expect(overlap.remedy.say).toContain(held.ids.task);
    expect(overlap.remedy.tool).toBeUndefined();
    expect(j.count()).toBe(before);
  });

  test("a done names its task by handle or id alike, so a retry with the other spelling replays", async () => {
    const { j, sa } = pair();
    const taken = await ok(sa, "collab_take", { title: "Work" });
    const first = await ok(sa, "collab_done", { text: "Done.", task: taken.ids.task_handle });
    const before = j.count();
    const retry = await ok(sa, "collab_done", { text: "Done.", task: taken.ids.task });
    expect(retry).toMatchObject({ replayed: true, ids: { completion: first.ids.completion } });
    expect(j.count()).toBe(before);
  });

  test("a replayed done reports the evidence it recorded; a file changed since is advice", async () => {
    const { j, a, sa } = pair();
    j.write("a.txt", "first\n");
    const taken = await ok(sa, "collab_take", { title: "Work" });
    const first = await ok(sa, "collab_done", { text: "Done.", evidence: ["file a.txt"] });
    expect(first.evidence[0]).toMatchObject({ observed: "server", sha256: sha("first\n") });
    j.write("a.txt", "second\n");
    const retry = await ok(sa, "collab_done", { text: "Done.", evidence: ["file a.txt"] });
    expect(retry.replayed).toBe(true);
    expect(retry.evidence[0]).toMatchObject({ observed: "server", sha256: sha("first\n") });
    expect(retry.advice.join(" ")).toContain(sha("second\n"));
    expect(j.store.getTask(a.workspace.id, taken.ids.task).artifacts![0]!.sha256).toBe(sha("first\n"));
  });
});

describe("a path conflict with finished work waiting for review", () => {
  test("names the reporter and the completion it waits on; for your own work, says a distinct session must review it", async () => {
    const { j, a, sa } = pair();
    const taken = await ok(sa, "collab_take", { title: "Edit", paths: ["x.ts"] });
    const done = await ok(sa, "collab_done", { text: "Done." });
    const before = j.count();
    const refusal = await refused(sa, "collab_take", { title: "Edit more", paths: ["x.ts"] });
    expect(refusal.code).toBe("path_scope_conflict");
    expect(refusal.message).not.toContain("unknown holder");
    expect(refusal.holders[0]).toMatchObject({
      id: taken.ids.task,
      holder: { session: a.session.id, name: "alpha", purpose: "alpha's work" },
      state: `waits for review of ${done.ids.completion}`,
    });
    expect(refusal.remedy.say).toContain("distinct session");
    expect(refusal.remedy.say).toContain(done.ids.completion);
    expect(j.count()).toBe(before);
  });

  test("for another session's finished work, offers a ready note to its reporter", async () => {
    const { j, a, sa, sb } = pair();
    const taken = await ok(sa, "collab_take", { title: "Edit", paths: ["x.ts"] });
    const done = await ok(sa, "collab_done", { text: "Done." });
    const refusal = await refused(sb, "collab_take", { title: "Edit more", paths: ["x.ts"] });
    expect(refusal.holders[0]).toMatchObject({
      holder: { session: a.session.id, name: "alpha" },
      state: `waits for review of ${done.ids.completion}`,
    });
    expect(refusal.remedy).toMatchObject({ tool: "collab_note", input: { re: taken.ids.task, to: a.session.id } });
    expect(refusal.remedy.input.text).toContain(done.ids.completion);
    void j;
  });
});

describe("review_by names a session that is not here", () => {
  test("a name no session has carried, or one whose sessions have ended, is refused with the same call without review_by", async () => {
    const { j, a, b, sa } = pair();
    j.write("a.txt", "a\n");
    const taken = await ok(sa, "collab_take", { title: "Edit", paths: ["a.txt"] });
    const input = { text: "Done.", evidence: ["file a.txt"] };
    const before = j.count();
    // Nobody named dee has arrived: refused before anything is written, never a bare "check the id".
    const never = await refused(sa, "collab_done", { ...input, review_by: "dee" });
    expect(never).toMatchObject({ code: "review_requested_session_unavailable", reason: "never_arrived" });
    expect(never.message).toContain("no session of that name has arrived");
    expect(never.message).toContain("Any distinct session can review");
    expect(never.remedy).toEqual({ tool: "collab_done", input });
    expect(j.count()).toBe(before);
    // bravo has left: the name is read as its latest session, which has ended.
    j.store.endSession({ ...b.credential, reason: "left" });
    const mark = j.count();
    const ended = await refused(sa, "collab_done", { ...input, review_by: "bravo" });
    expect(ended).toMatchObject({ code: "review_requested_session_unavailable", reason: "not_active" });
    expect(ended.message).toContain(`the latest session named bravo (${b.session.id}), which has ended`);
    expect(ended.remedy).toEqual({ tool: "collab_done", input: { ...input, task: taken.ids.task } });
    // No refusal on this surface points at a tool the notes profile does not have.
    for (const refusal of [never, ended]) expect(JSON.stringify(refusal)).not.toMatch(/collab_(workspace|session|task)_/);
    expect(j.count()).toBe(mark);
    // The ready call works.
    await ok(sa, ended.remedy.tool, ended.remedy.input);
    void a;
  });
});

describe("refusals on this surface name only its own verbs", () => {
  test("a blocked task, and a verdict on work already accepted, point at notes verbs, not at legacy tools", async () => {
    const j = journal();
    const a = j.start("alpha");
    const b = j.start("bravo");
    const c = j.start("charlie");
    const [sa, sb, sc] = [j.serve(a), j.serve(b), j.serve(c)];
    const taken = await ok(sa, "collab_take", { title: "Waits on a decision" });
    await ok(sa, "collab_done", { text: "Blocked on the owner", outcome: "blocked", because: "the owner has not chosen" });
    const blocked = await refused(sb, "collab_take", { task: taken.ids.task });
    expect(blocked.code).toBe("task_blocked");
    expect(blocked.remedy).toMatchObject({ tool: "collab_note", input: { re: taken.ids.task } });
    j.write("a.txt", "a\n");
    const edit = await ok(sa, "collab_take", { title: "Edit", paths: ["a.txt"] });
    const done = await ok(sa, "collab_done", { text: "Edited.", task: edit.ids.task });
    await ok(sb, "collab_note", { act: "accept", text: "Looks right.", re: done.ids.completion });
    const late = await refused(sc, "collab_note", { act: "accept", text: "Agreed.", re: done.ids.completion });
    expect(late.code).toBe("task_not_pending_review");
    expect(late.message).toContain("support or challenge its review");
    for (const refusal of [blocked, late]) expect(JSON.stringify(refusal)).not.toMatch(/collab_(task|report|workspace|session)_/);
  });
});
