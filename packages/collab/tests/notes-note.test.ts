import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, realpathSync, renameSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CollabError } from "../src/errors.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import { NOTE_FORMAT, parseNote, renderNote } from "../src/note.js";
import { evidenceRechecker } from "../src/verbs.js";
import { completedTask, git, journal, ok, refused, runCleanup, type Journal } from "./notes-helpers.js";

// collab_note (Collab Notes spec 5.3): the speech and review acts, outside
// evidence, evidence[].now in collab_inbox, and derived idempotency.

afterEach(runCleanup);

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function pair(j: Journal = journal()) {
  const a = j.start("alpha");
  const b = j.start("bravo");
  return { j, a, b, sa: j.serve(a), sb: j.serve(b) };
}

describe("storage mapping for each act", () => {
  test("note: informs, marked, the stored body equals the returned note, kind by its reasons", async () => {
    const { j, sa } = pair();
    const plain = await ok(sa, "collab_note", { text: "The parser drops trailing tabs." });
    const row = j.report(plain.ids.report);
    expect(row).toMatchObject({ relation: "informs", kind: "inference", target_report_id: null, task_id: null, to_session_id: null });
    expect(row.body).toBe(plain.note);
    expect(j.payload(plain.ids.report).note).toBe(NOTE_FORMAT);
    expect(plain).toMatchObject({ ok: true, act: "note", recorded_as: "note", authorises: "Nothing. This is coordination state." });
    j.write("src/parser.ts", "export const x = 1;\n");
    const seen = await ok(sa, "collab_note", {
      text: "Line 1 exports x.",
      why: [{ text: "I read it", basis: "seen", cites: [1] }],
      evidence: ["file src/parser.ts:1"],
    });
    expect(j.report(seen.ids.report).kind).toBe("observation");
    const told = await ok(sa, "collab_note", {
      text: "Bravo says line 1 exports x.",
      why: [{ text: "I read it", basis: "seen", cites: [1] }, { text: "bravo said so", basis: "told" }],
      evidence: ["file src/parser.ts:1"],
    });
    expect(j.report(told.ids.report).kind).toBe("inference");
  });

  test("note with re: a report is cited and its author addressed; a task is scoped and its holder addressed; person", async () => {
    const { j, a, b, sa, sb } = pair();
    const task = completedTask(j, a);
    const root = await ok(sa, "collab_note", { text: "A root note." });
    const reply = await ok(sb, "collab_note", { text: "A reply.", re: root.ids.report_handle });
    expect(j.report(reply.ids.report)).toMatchObject({ relation: "informs", to_session_id: a.session.id, target_report_id: null });
    expect(JSON.parse(j.report(reply.ids.report).evidence_refs_json)).toEqual([`report:${root.ids.report}`]);
    expect(reply.to).toEqual({ session: a.session.id, name: "alpha" });
    // A reply to a task's completion report is scoped to that task.
    const onCompletion = await ok(sb, "collab_note", { text: "About the completion.", re: `report:${task.completion_report_id}` });
    expect(j.report(onCompletion.ids.report).task_id).toBe(task.id);
    const onTask = await ok(sb, "collab_note", { text: "About the task.", re: `task:${task.id}` });
    expect(j.report(onTask.ids.report)).toMatchObject({ task_id: task.id, to_session_id: a.session.id });
    expect(parseNote(j.report(onTask.ids.report).body).re).toBe(`task:${task.id}`);
    const person = await ok(sa, "collab_note", { text: "For the person.", to: "person" });
    expect(j.payload(person.ids.report).to_person).toBe(true);
    expect(j.store.db.query(`SELECT 1 FROM person_addressed_reports WHERE report_id = ?`).get(person.ids.report)).not.toBeNull();
    // A file, lobby or msg re is a Re: line only.
    const onFile = await ok(sa, "collab_note", { text: "About a file.", re: "file:src/parser.ts" });
    expect(j.report(onFile.ids.report)).toMatchObject({ task_id: null, to_session_id: null });
    expect(parseNote(j.report(onFile.ids.report).body).re).toBe("file:src/parser.ts");
  });

  test("support and challenge target the report, copy its task, and address its author", async () => {
    const { j, a, b, sb } = pair();
    const task = completedTask(j, a);
    for (const act of ["support", "challenge"] as const) {
      const result = await ok(sb, "collab_note", { act, text: `${act} it.`, re: `report:${task.completion_report_id}` });
      expect(j.report(result.ids.report)).toMatchObject({
        relation: act === "support" ? "supports" : "challenges",
        target_report_id: task.completion_report_id,
        task_id: task.id,
        to_session_id: a.session.id,
      });
      expect(result.advice.join(" ")).toContain("recorded as a stance, not a review");
    }
    void b;
  });

  test("support and challenge on a proposal set about_proposal_id; a task re asks for its completion", async () => {
    const { j, a, sb } = pair();
    const proposal = j.store.openProposalForSession({
      ...a.credential, idempotency_key: "p", question: "Ship it?", criteria: "Tests pass.", extent: "The parser.",
    });
    const support = await ok(sb, "collab_note", { act: "support", text: "Yes.", re: `proposal:${proposal.proposal.id}` });
    expect(j.payload(support.ids.report).about_proposal_id).toBe(proposal.proposal.id);
    expect(parseNote(j.report(support.ids.report).body).re).toBe(`proposal:${proposal.proposal.id}`);
    const task = completedTask(j, a);
    const wrong = await refused(sb, "collab_note", { act: "challenge", text: "No.", re: `task:${task.id}` });
    expect(wrong.code).toBe("re_must_be_report");
    expect(wrong.remedy).toEqual({ tool: "collab_note", input: { act: "challenge", text: "No.", re: task.completion_report_id } });
  });

  test("resolve by the challenger lifts it and addresses the challenged report's author", async () => {
    const { j, a, sa, sb } = pair();
    const root = await ok(sa, "collab_note", { text: "A claim." });
    const challenge = await ok(sb, "collab_note", { act: "challenge", text: "Not so.", re: root.ids.report });
    const resolve = await ok(sb, "collab_note", { act: "resolve", text: "Answered; I lift it.", re: challenge.ids.report });
    expect(resolve.recorded_as).toBe("resolve");
    expect(j.report(resolve.ids.report)).toMatchObject({
      relation: "resolves",
      target_report_id: challenge.ids.report,
      to_session_id: a.session.id,
    });
  });

  test("withdraw addresses the latest standing challenger and lists the others with a ready note", async () => {
    const j = journal();
    const a = j.start("alpha");
    const b = j.start("bravo");
    const c = j.start("charlie");
    const [sa, sb, sc] = [j.serve(a), j.serve(b), j.serve(c)];
    const root = await ok(sa, "collab_note", { text: "A claim I will take back." });
    const first = await ok(sb, "collab_note", { act: "challenge", text: "Wrong.", re: root.ids.report });
    await ok(sc, "collab_note", { act: "challenge", text: "Also wrong.", re: root.ids.report });
    const withdrawn = await ok(sa, "collab_note", { act: "withdraw", text: "I take it back.", re: root.ids.report_handle });
    expect(j.report(withdrawn.ids.report)).toMatchObject({ relation: "withdraws", target_report_id: root.ids.report, to_session_id: c.session.id });
    expect(withdrawn.also_challenged_by).toEqual([{
      session: b.session.id,
      name: "bravo",
      next: { tool: "collab_note", input: { text: `I withdrew ${root.ids.report}.`, re: first.ids.report, to: b.session.id } },
    }]);
  });
});

describe("addressees and arrival", () => {
  test("a note to an ended or stale session is sent and says so", async () => {
    const { j, a, b, sa, sb } = pair();
    j.store.endSession({ ...b.credential, reason: "done here" });
    const ended = await ok(sa, "collab_note", { text: "For bravo, who left.", to: "bravo" });
    expect(j.report(ended.ids.report).to_session_id).toBe(b.session.id);
    expect(ended.advice.join(" ")).toContain("has ended its session");
    const c = j.start("charlie");
    j.advance(7 * 60 * 60 * 1000);
    const late = await ok(sa, "collab_note", { text: "For charlie, quiet for hours.", to: c.session.id });
    expect(j.report(late.ids.report).to_session_id).toBe(c.session.id);
    expect(late.advice.join(" ")).toContain("over 6 hours ago");
    void a;
    void sb;
  });

  test("on a slot with no session the new verbs say how to arrive", async () => {
    const j = journal();
    const server = buildCollabMcpServer(j.store, {}) as any;
    for (const [name, args] of [
      ["collab_note", { text: "Hello." }],
      ["collab_take", { title: "Work" }],
      ["collab_done", { text: "Done." }],
    ] as const) {
      const refusal = await refused(server, name, args);
      expect(refusal).toMatchObject({ code: "not_arrived", remedy: { tool: "collab_arrive", input: { purpose: "…" } } });
    }
  });
});

describe("reading text as a note, and via", () => {
  test("a text that begins with an act word is read whole as a note, so the card's form works as typed", async () => {
    const { j, a, sa, sb } = pair();
    j.write("src/parser.ts", "x\n");
    const root = await ok(sa, "collab_note", { text: "A claim." });
    const text = [
      "challenge: renew does not bump the version",
      "",
      "I read the renew path.",
      "",
      `Re: report:${root.ids.report}`,
      "Why: the update leaves version alone (seen 1)",
      "Evidence: file src/parser.ts:1",
      "Limits: only the renew path",
    ].join("\n");
    const result = await ok(sb, "collab_note", { text });
    expect(result).toMatchObject({ read_as: "collab-note/1", act: "challenge", recorded_as: "challenge" });
    expect(j.report(result.ids.report)).toMatchObject({ relation: "challenges", target_report_id: root.ids.report, to_session_id: a.session.id });
    const parsed = parseNote(j.report(result.ids.report).body);
    expect(parsed).toMatchObject({ act: "challenge", statement: "renew does not bump the version", body: "I read the renew path.", limits: "only the renew path" });
    // A field given both ways with different values is refused, not guessed.
    const twice = await refused(sb, "collab_note", { text, limits: "something else" });
    expect(twice.code).toBe("field_given_twice");
  });

  test("via records seen and quoted as told and adds the Via line", async () => {
    const { j, sa } = pair();
    const result = await ok(sa, "collab_note", {
      text: "From the other device: the build passed.",
      via: "lobby:room-1#4",
      why: [{ text: "they ran it", basis: "seen" }, { text: "their log line", basis: "quoted" }, { text: "a guess", basis: "inferred" }],
    });
    const parsed = parseNote(j.report(result.ids.report).body);
    expect(parsed.via).toBe("lobby:room-1#4");
    expect(parsed.why.map((reason) => reason.basis)).toEqual(["told", "told", "inferred"]);
    expect(result.advice.join(" ")).toContain("recorded as told");
    expect(j.report(result.ids.report).kind).toBe("inference");
  });
});

describe("challenge with replaces", () => {
  test("posts the new challenge before withdrawing the old, so the objection stands throughout; never corrects", async () => {
    const { j, a, sa, sb } = pair();
    const proposal = j.store.openProposalForSession({
      ...a.credential, idempotency_key: "p", question: "Ship it?", criteria: "Tests pass.", extent: "The parser.",
    });
    const old = await ok(sb, "collab_note", { act: "challenge", text: "No: untested.", re: proposal.proposal.id });
    expect(j.store.proposalStatus(a.workspace.id, proposal.proposal.id).ai.position).toBe("challenged");
    const replaced = await ok(sb, "collab_note", {
      act: "challenge",
      text: "No: the renew path is untested.",
      re: proposal.proposal.id,
      replaces: old.ids.report_handle,
      why: [{ text: "no test names renew", basis: "seen" }],
    });
    const withdrawal = replaced.ids.withdrawal.report;
    const events = j.events().filter((event) => event.type === "report.posted");
    const newAt = events.find((event) => event.entity_id === replaced.ids.report)!.sequence;
    const oldAt = events.find((event) => event.entity_id === withdrawal)!.sequence;
    expect(newAt).toBeLessThan(oldAt);
    expect(oldAt).toBe(newAt + 1);
    expect(j.report(withdrawal)).toMatchObject({ relation: "withdraws", target_report_id: old.ids.report });
    expect(JSON.parse(j.report(withdrawal).evidence_refs_json)).toContain(`report:${replaced.ids.report}`);
    expect(parseNote(j.report(replaced.ids.report).body).replaces).toBe(`report:${old.ids.report}`);
    const status = j.store.proposalStatus(a.workspace.id, proposal.proposal.id);
    expect(status.ai.position).toBe("challenged");
    expect(status.ai.unresolved_challenge_report_ids).toEqual([replaced.ids.report]);
    expect(j.store.db.query(`SELECT COUNT(*) AS n FROM reports WHERE relation = 'corrects'`).get()).toEqual({ n: 0 });
    void sa;
  });

  test("the two reports share one transaction: a failing withdrawal leaves no new challenge", () => {
    const { j, a, b } = pair();
    const root = j.store.appendReportForSession({ ...a.credential, idempotency_key: "r", kind: "observation", body: "Root." });
    const before = j.count();
    expect(() => j.store.appendNoteForSession({
      ...b.credential,
      idempotency_key: "n1:test",
      reports: [
        { kind: "inference", relation: "challenges", body: "challenge: no", target_report_id: root.id },
        // Not bravo's own report, so the store refuses the withdrawal.
        { kind: "inference", relation: "withdraws", body: "withdraw: replaced", target_report_id: root.id, cite_earlier: [0] },
      ],
    })).toThrow("Only the original author session");
    expect(j.count()).toBe(before);
  });

  test("replaces must be the caller's own standing challenge on the same report", async () => {
    const { j, sa, sb } = pair();
    const root = await ok(sa, "collab_note", { text: "A claim." });
    const theirs = await ok(sa, "collab_note", { act: "challenge", text: "Self-doubt.", re: root.ids.report });
    const refusal = await refused(sb, "collab_note", { act: "challenge", text: "No.", re: root.ids.report, replaces: theirs.ids.report });
    expect(refusal.code).toBe("replaces_not_yours");
    const onNote = await refused(sb, "collab_note", { text: "A note.", replaces: theirs.ids.report });
    expect(onNote.code).toBe("replaces_not_supported");
    void j;
  });
});

describe("resolve from another voice is an answer", () => {
  test("on a task completion: recorded as an answer to the challenger, and acceptance stays refused", async () => {
    const j = journal();
    const a = j.start("alpha");
    const b = j.start("bravo");
    const c = j.start("charlie");
    const [sa, sb, sc] = [j.serve(a), j.serve(b), j.serve(c)];
    const task = completedTask(j, a);
    const challenge = await ok(sb, "collab_note", { act: "challenge", text: "Untested.", re: task.completion_report_id });
    const answer = await ok(sa, "collab_note", { act: "resolve", text: "It is tested now.", re: challenge.ids.report });
    expect(answer.recorded_as).toBe("answer");
    expect(answer.advice.join(" ")).toContain("only the challenger can lift a challenge; your answer was sent to them".replace("only", "Only"));
    expect(j.report(answer.ids.report)).toMatchObject({ relation: "informs", to_session_id: b.session.id, target_report_id: null });
    expect(JSON.parse(j.report(answer.ids.report).evidence_refs_json)).toEqual([`report:${challenge.ids.report}`]);
    expect(parseNote(j.report(answer.ids.report).body).act).toBe("note");
    // The challenge still stands, so a third session's acceptance is refused.
    await ok(sc, "collab_inbox", { about: `task:${task.id}` });
    const accept = await refused(sc, "collab_note", { act: "accept", text: "Looks right.", re: task.completion_report_id });
    expect(accept.code).toBe("completion_challenged");
    expect(accept.remedy.say).toContain("only its challenger can lift it");
  });

  test("on a proposal: the position stays challenged", async () => {
    const { j, a, sa, sb } = pair();
    const proposal = j.store.openProposalForSession({
      ...a.credential, idempotency_key: "p", question: "Ship it?", criteria: "Tests pass.", extent: "The parser.",
    });
    const challenge = await ok(sb, "collab_note", { act: "challenge", text: "No.", re: proposal.proposal.id });
    const answer = await ok(sa, "collab_note", { act: "resolve", text: "Here is why yes.", re: challenge.ids.report });
    expect(answer.recorded_as).toBe("answer");
    const status = j.store.proposalStatus(a.workspace.id, proposal.proposal.id);
    expect(status.ai.position).toBe("challenged");
    expect(status.ai.unresolved_challenge_report_ids).toEqual([challenge.ids.report]);
  });

  test("a named child of the challenger shares its voice, so its resolve lifts", async () => {
    const j = journal();
    const a = j.start("alpha");
    const b = j.start("bravo");
    const child = j.start("bravo/child", { parent_session_id: b.session.id, parent_attested: true });
    const [sa, sb, sc] = [j.serve(a), j.serve(b), j.serve(child)];
    const root = await ok(sa, "collab_note", { text: "A claim." });
    const challenge = await ok(sb, "collab_note", { act: "challenge", text: "No.", re: root.ids.report });
    const lifted = await ok(sc, "collab_note", { act: "resolve", text: "Answered.", re: challenge.ids.report });
    expect(lifted.recorded_as).toBe("resolve");
  });
});

describe("withdraw, accept, request_changes, relay_rejection", () => {
  test("withdraw of another session's report is refused with a ready note as the remedy", async () => {
    const { j, sa, sb } = pair();
    const root = await ok(sa, "collab_note", { text: "Alpha's claim." });
    const before = j.count();
    const refusal = await refused(sb, "collab_note", { act: "withdraw", text: "Disregard.", re: root.ids.report });
    expect(refusal.code).toBe("not_your_report");
    expect(refusal.remedy).toEqual({ tool: "collab_note", input: { act: "note", text: "I no longer stand by this.", re: root.ids.report } });
    expect(j.count()).toBe(before);
  });

  test("accept goes through the review path, pins the completion and carries the reviewer's own evidence", async () => {
    const { j, a, b, sb } = pair();
    j.write("tests/parser.test.ts", "test\n");
    const task = completedTask(j, a);
    const result = await ok(sb, "collab_note", {
      act: "accept",
      text: "The parser change holds.",
      re: task.completion_report_id,
      why: [{ text: "I read the test", basis: "seen", cites: [1] }],
      evidence: ["file tests/parser.test.ts", "test bun test tests/parser.test.ts exit=0"],
      limits: "Only the parser.",
    });
    expect(result.recorded_as).toBe("accept");
    const after = j.store.getTask(a.workspace.id, task.id);
    expect(after.review_status).toBe("accepted");
    const review = j.report(result.ids.review_report);
    expect(review).toMatchObject({ relation: "supports", target_report_id: task.completion_report_id, from_session_id: b.session.id });
    // The summary is the note without its Evidence lines; the evidence is a cited event before the review.
    expect(review.body).toBe(result.note.split("\n").filter((line: string) => !line.startsWith("Evidence: ")).join("\n"));
    expect(review.confidence_basis).toBe("I read the test (seen 1)");
    expect(review.limits).toBe("Only the parser.");
    const cited = j.events().find((event) => event.type === "evidence.cited")!;
    const accepted = j.events().find((event) => event.type === "task.accepted")!;
    expect(cited.sequence).toBeLessThan(accepted.sequence);
    expect(JSON.parse(review.evidence_refs_json)).toContain(`event:${result.ids.evidence_cited.event}`);
    expect(cited.payload.items).toEqual([
      { n: 1, kind: "file", locator: "tests/parser.test.ts", sha256: sha("test\n"), observed: "server" },
      { n: 2, kind: "test", locator: "bun test tests/parser.test.ts", exit: 0, observed: "caller" },
    ]);
  });

  test("request_changes goes through the review path and reopens the task", async () => {
    const { j, a, sb } = pair();
    const task = completedTask(j, a);
    const result = await ok(sb, "collab_note", { act: "request_changes", text: "One more pass.", re: task.completion_report_id });
    expect(j.store.getTask(a.workspace.id, task.id)).toMatchObject({ status: "open", review_status: "changes_requested" });
    expect(j.report(result.ids.review_report)).toMatchObject({ relation: "challenges", target_report_id: task.completion_report_id });
  });

  test("a task id is accepted only once the inbox returned its current completion", async () => {
    const { j, a, sb } = pair();
    const task = completedTask(j, a);
    const unseen = await refused(sb, "collab_note", { act: "accept", text: "Fine.", re: `task:${task.id}` });
    expect(unseen.code).toBe("changed_under_you");
    expect(unseen.state.completion.id).toBe(task.completion_report_id);
    expect(unseen.remedy).toEqual({ tool: "collab_note", input: { act: "accept", text: "Fine.", re: task.completion_report_id } });
    // Nothing changed: the completion was never shown, and the message says that.
    expect(unseen.message).toContain("has not been shown to this session");
    expect(unseen.message).not.toContain("It changed after this call read it");
    await ok(sb, "collab_inbox", { about: `task:${task.id}` });
    const accepted = await ok(sb, "collab_note", { act: "accept", text: "Fine.", re: `task:${task.id}` });
    expect(accepted.ids.completion).toBe(task.completion_report_id);
  });

  test("a re-completed task returns changed_under_you with the current completion, and no verdict lands on it", async () => {
    const { j, a, sa, sb } = pair();
    const first = completedTask(j, a);
    // Sent back for changes, then done again: a new completion.
    j.store.reviewTaskForSession({
      ...j.start("charlie").credential, idempotency_key: "rc", task_id: first.id, expected_version: first.version,
      outcome: "request_changes", summary: "Again.",
    });
    await ok(sa, "collab_take", { task: first.id });
    const done = await ok(sa, "collab_done", { text: "Done again." });
    const before = j.count();
    const stale = await refused(sb, "collab_note", { act: "accept", text: "Fine.", re: first.completion_report_id });
    expect(stale.code).toBe("changed_under_you");
    expect(stale.state.completion.id).toBe(done.ids.completion);
    expect(stale.remedy.input.re).toBe(done.ids.completion);
    expect(j.count()).toBe(before);
  });

  test("self-review is still refused", async () => {
    const { j, a, sa } = pair();
    const task = completedTask(j, a);
    const refusal = await refused(sa, "collab_note", { act: "accept", text: "My own work is fine.", re: task.completion_report_id });
    expect(refusal.code).toBe("self_review_forbidden");
    expect(refusal.remedy.say).toContain("distinct session");
    expect(j.store.getTask(a.workspace.id, task.id).review_status).toBe("pending");
  });

  test("relay_rejection records a relayed no, which can only stop; nothing it cannot store is accepted", async () => {
    const { j, a, sa, sb } = pair();
    const proposal = j.store.openProposalForSession({
      ...a.credential, idempotency_key: "p", question: "Ship it?", criteria: "Tests pass.", extent: "The parser.",
    });
    const withWhy = await refused(sb, "collab_note", {
      act: "relay_rejection", text: "The person said no.", re: proposal.proposal.id, why: [{ text: "they said so", basis: "told" }],
    });
    expect(withWhy.code).toBe("not_stored");
    expect(withWhy.remedy).toEqual({ tool: "collab_note", input: { act: "relay_rejection", text: "The person said no.", re: proposal.proposal.id } });
    const relayed = await ok(sb, "collab_note", { act: "relay_rejection", text: "The person said no.", re: proposal.proposal.id });
    expect(relayed).toMatchObject({ recorded_as: "relay_rejection", person: "rejected", may_proceed: false });
    const act = j.store.proposalStatus(a.workspace.id, proposal.proposal.id).person.acts.at(-1)!;
    expect(act).toMatchObject({ act: "reject", basis: "relayed_by_session", reason: "The person said no." });
    // There is no act that relays a yes.
    expect((await refused(sb, "collab_note", { act: "agree", text: "Yes.", re: proposal.proposal.id })).code).toBe("invalid_act");
    const onReport = await refused(sb, "collab_note", { act: "relay_rejection", text: "No.", re: (await ok(sa, "collab_note", { text: "x" })).ids.report });
    expect(onReport.code).toBe("not_a_proposal");
  });
});

describe("outside evidence", () => {
  test("a file inside the worktree is hashed by the server; outside, through a symlink or too large it is the caller's", async () => {
    const { j, sa } = pair();
    j.write("src/a.ts", "a\n");
    writeFileSync(join(j.directory, "outside.txt"), "outside\n");
    j.write("big.bin", "");
    truncateSync(join(j.root, "big.bin"), 16 * 1024 * 1024 + 1);
    symlinkSync(join(j.root, "src"), join(j.root, "linked"));
    const result = await ok(sa, "collab_note", {
      text: "Four files.",
      evidence: ["file src/a.ts:1-2", "file ../outside.txt", "file linked/a.ts", "file big.bin", "file missing.txt"],
    });
    expect(result.evidence.map((item: any) => item.observed)).toEqual(["server", "caller", "caller", "caller", "caller"]);
    const cited = j.events().filter((event) => event.type === "evidence.cited");
    expect(cited).toHaveLength(1);
    expect(cited[0]!.payload).toMatchObject({ by_session_id: expect.any(String), worktree_id: expect.any(String) });
    expect(cited[0]!.payload.items[0]).toEqual({ n: 1, kind: "file", locator: "src/a.ts", sha256: sha("a\n"), lines: "1-2", observed: "server" });
    expect(cited[0]!.payload.items.slice(1).every((item: any) => item.sha256 === undefined)).toBe(true);
    const advice = result.advice.join("\n");
    expect(advice).toContain("is outside your worktree");
    expect(advice).toContain("reaches through a symbolic link");
    expect(advice).toContain("is over 16 MiB");
    expect(advice).toContain("was not found in your worktree");
    // The cite is one event, cited by the note.
    expect(JSON.parse(j.report(result.ids.report).evidence_refs_json)).toEqual([`event:${result.ids.evidence_cited.event}`]);
  });

  test("a commit is checked with git: found, not found, or unchecked outside git", async () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    const head = git(j.root, ["rev-parse", "HEAD"]);
    const result = await ok(j.serve(a), "collab_note", {
      text: "Two commits.",
      evidence: [`commit ${head}`, `commit ${"0".repeat(40)}`],
    });
    expect(result.evidence.map((item: any) => item.observed)).toEqual(["server", "not_found"]);
    const plain = pair();
    const unchecked = await ok(plain.sa, "collab_note", { text: "A commit elsewhere.", evidence: [`commit ${head}`] });
    expect(unchecked.evidence[0].observed).toBe("caller");
    expect(unchecked.advice.join(" ")).toContain("could not be checked");
  });

  test("journal evidence goes into evidence refs, handles resolved to full ids; no cite event without outside items", async () => {
    const { j, sa, sb } = pair();
    const root = await ok(sa, "collab_note", { text: "A root." });
    const result = await ok(sb, "collab_note", { text: "Citing it.", evidence: [root.ids.report_handle] });
    expect(parseNote(j.report(result.ids.report).body).evidence).toEqual([`report:${root.ids.report}`]);
    expect(JSON.parse(j.report(result.ids.report).evidence_refs_json)).toEqual([`report:${root.ids.report}`]);
    expect(j.events().filter((event) => event.type === "evidence.cited")).toHaveLength(0);
    expect(result.advice.join(" ")).not.toContain("seen over a relayed source");
    const relayed = await ok(sb, "collab_note", {
      text: "Seen over a relayed source.", evidence: [`report:${root.ids.report}`], why: [{ text: "alpha said it", basis: "seen", cites: [1] }],
    });
    expect(relayed.advice.join(" ")).toContain("seen over a relayed source reads as told");
  });
});

describe("evidence[].now in collab_inbox", () => {
  test("same, changed, missing and unavailable, against the citing session's worktree", async () => {
    const { j, a, sa, sb } = pair();
    j.write("src/a.ts", "a\n");
    const result = await ok(sa, "collab_note", { text: "See the file.", to: "bravo", evidence: ["file src/a.ts"] });
    const now = async () => {
      const view = await ok(sb, "collab_inbox", { about: result.ids.report });
      return view.root.evidence[0];
    };
    expect(await now()).toMatchObject({ n: 1, kind: "file", locator: "src/a.ts", observed: "server", sha256: sha("a\n"), now: "same" });
    j.write("src/a.ts", "b\n");
    expect((await now()).now).toBe("changed");
    rmSync(join(j.root, "src", "a.ts"));
    expect((await now()).now).toBe("missing");
    renameSync(j.root, `${j.root}-moved`);
    expect((await now()).now).toBe("unavailable");
    // The inbox item carries the same fields.
    const inbox = await ok(sb, "collab_inbox", {});
    expect(inbox.items[0].evidence[0]).toMatchObject({ observed: "server", now: "unavailable" });
    void a;
  });

  test("against the citing session's worktree when the reader works in another one", async () => {
    const j = journal();
    const otherRoot = join(j.directory, "other");
    mkdirSync(join(otherRoot, "src"), { recursive: true });
    const a = j.store.startSession({ root_path: j.root, actor: "alpha", role: "alpha's work", repository_key: "shared-fixture" });
    const b = j.store.startSession({ root_path: otherRoot, actor: "bravo", role: "bravo's work", repository_key: "shared-fixture" });
    expect(b.workspace.id).toBe(a.workspace.id);
    expect(b.worktree.id).not.toBe(a.worktree.id);
    j.write("src/a.ts", "a\n");
    writeFileSync(join(otherRoot, "src", "a.ts"), "the reader's copy differs\n");
    const note = await ok(j.serve(a), "collab_note", { text: "See the file.", to: "bravo", evidence: ["file src/a.ts"] });
    const sb = j.serve(b);
    const now = async () => (await ok(sb, "collab_inbox", { about: note.ids.report })).root.evidence[0];
    expect(await now()).toMatchObject({ observed: "server", sha256: sha("a\n"), now: "same" });
    writeFileSync(join(otherRoot, "src", "a.ts"), "the reader's copy changes again\n");
    expect((await now()).now).toBe("same");
    j.write("src/a.ts", "the citer's copy changed\n");
    expect((await now()).now).toBe("changed");
  });

  test("a reader sees only a note's own cite: a cite event it also names lends its lines nothing", async () => {
    // Evidence refs are stored sorted, so whether the borrowed cite sorts
    // first is chance; the trials go on until it has, twice.
    let borrowedFirst = 0;
    for (let trial = 0; trial < 40 && borrowedFirst < 2; trial += 1) {
      const { j, sa, sb } = pair();
      j.write("src/good.ts", "good\n");
      const honest = await ok(sa, "collab_note", { text: "good.ts is fine.", evidence: ["file src/good.ts"] });
      const borrowed = honest.ids.evidence_cited.event;
      writeFileSync(join(j.directory, "evil.ts"), "evil\n");
      const note = await ok(sb, "collab_note", {
        text: "evil.ts is fine too.",
        to: "alpha",
        evidence: ["file ../evil.ts", `event:${borrowed}`],
      });
      expect(note.evidence[0].observed).toBe("caller");
      const refs = JSON.parse(j.report(note.ids.report).evidence_refs_json) as string[];
      if (refs.indexOf(`event:${borrowed}`) < refs.indexOf(`event:${note.ids.evidence_cited.event}`)) borrowedFirst += 1;
      const view = await ok(sa, "collab_inbox", { about: note.ids.report });
      expect(view.root.evidence[0]).toEqual({ n: 1, kind: "file", locator: "../evil.ts", observed: "caller" });
      expect(view.root.evidence[1]).toEqual({ n: 2, kind: "event", locator: borrowed, observed: "journal" });
    }
    expect(borrowedFirst).toBe(2);
  });

  test("a cite whose items do not match the note's lines lends them nothing", async () => {
    const { j, a, b, sa } = pair();
    j.write("src/good.ts", "good\n");
    const receipt = j.store.appendNoteForSession({
      ...b.credential,
      idempotency_key: "crafted",
      cite: { worktree_id: b.worktree.id, items: [{ n: 1, kind: "file", locator: "src/good.ts", sha256: sha("good\n"), observed: "server" }] },
      reports: [{
        kind: "inference",
        relation: "informs",
        body: renderNote({ act: "note", statement: "Evil is fine.", evidence: ["file ../evil.ts"] }),
        to_session_id: a.session.id,
        cite_event: true,
      }],
    });
    const view = await ok(sa, "collab_inbox", { about: receipt.reports[0]!.id });
    expect(view.root.evidence[0]).toEqual({ n: 1, kind: "file", locator: "../evil.ts", observed: "caller" });
  });

  test("a file named by another spelling of its path is recorded by its path in the worktree", async () => {
    const { j, sa, sb } = pair();
    j.write("src/a.ts", "a\n");
    const result = await ok(sa, "collab_note", {
      text: "Two spellings of one file.",
      to: "bravo",
      evidence: ["file ./src/a.ts:1-2", `file ${join(realpathSync(j.root), "src", "a.ts")}`],
    });
    expect(parseNote(j.report(result.ids.report).body).evidence).toEqual(["file src/a.ts:1-2", "file src/a.ts"]);
    expect(result.evidence.map((item: any) => item.observed)).toEqual(["server", "server"]);
    const view = await ok(sb, "collab_inbox", { about: result.ids.report });
    expect(view.root.evidence.map((item: any) => [item.locator, item.observed, item.now])).toEqual([
      ["src/a.ts:1-2", "server", "same"],
      ["src/a.ts", "server", "same"],
    ]);
  });

  test("a review's own evidence is listed with how it was observed, and re-checked", async () => {
    const { j, a, sa, sb } = pair();
    j.write("tests/parser.test.ts", "test\n");
    const task = completedTask(j, a);
    const review = await ok(sb, "collab_note", {
      act: "accept",
      text: "The parser change holds.",
      re: task.completion_report_id,
      evidence: ["file tests/parser.test.ts", "test bun test tests/parser.test.ts exit=0"],
    });
    const cited = async () => {
      const view = await ok(sa, "collab_inbox", { about: review.ids.review_report });
      return view.root.evidence.find((item: any) => item.kind === "event" && item.locator === review.ids.evidence_cited.event);
    };
    expect((await cited()).cited).toEqual([
      { n: 1, kind: "file", locator: "tests/parser.test.ts", observed: "server", sha256: sha("test\n"), now: "same" },
      { n: 2, kind: "test", locator: "bun test tests/parser.test.ts", observed: "caller", exit: 0 },
    ]);
    j.write("tests/parser.test.ts", "changed\n");
    expect((await cited()).cited[0].now).toBe("changed");
  });
});

describe("evidence[].now budget", () => {
  test("beyond the call's re-hash budget a cite is not_rechecked", () => {
    const j = journal();
    const a = j.start("alpha");
    j.write("big.txt", "x".repeat(1_000));
    const item = { n: 1, kind: "file" as const, locator: "big.txt", sha256: sha("x".repeat(1_000)), observed: "server" as const };
    expect(evidenceRechecker(j.store)(a.worktree.id, item)).toBe("same");
    const small = evidenceRechecker(j.store, 100);
    expect(small(a.worktree.id, item)).toBe("not_rechecked");
    expect(evidenceRechecker(j.store)("wt_000000000000000000000000", item)).toBe("unavailable");
  });

  test("a name reused after a restart addresses the session that answers to it now", async () => {
    const { j, b, sa } = pair();
    j.store.endSession({ ...b.credential, reason: "restart" });
    const again = j.start("bravo");
    const result = await ok(sa, "collab_note", { text: "For bravo.", to: "bravo" });
    expect(j.report(result.ids.report).to_session_id).toBe(again.session.id);
  });
});

describe("advice, never refusals", () => {
  test("ungrounded is flagged on supports and challenges alike, and nothing is refused for missing reasons", async () => {
    const { j, sa, sb } = pair();
    const root = await ok(sa, "collab_note", { text: "A claim." });
    for (const act of ["support", "challenge"]) {
      const result = await ok(sb, "collab_note", { act, text: `${act}.`, re: root.ids.report });
      expect(result.ungrounded).toBe(true);
      expect(result.advice.join(" ")).toContain("ungrounded");
    }
    const grounded = await ok(sb, "collab_note", { act: "support", text: "Yes.", re: root.ids.report, why: [{ text: "I checked" }] });
    expect(grounded.ungrounded).toBeUndefined();
    void j;
  });

  test("dry_run parses, validates and renders, writing nothing", async () => {
    const { j, sa } = pair();
    j.write("src/a.ts", "a\n");
    const before = j.count();
    const mutations = (j.store.db.query(`SELECT COUNT(*) AS n FROM mutations`).get() as { n: number }).n;
    const dry = await ok(sa, "collab_note", { text: "A check.", evidence: ["file src/a.ts"], dry_run: true });
    expect(dry).toMatchObject({ ok: true, dry_run: true, act: "note", effect: "Dry run: nothing was written." });
    expect(dry.parsed.statement).toBe("A check.");
    expect(dry.would.reports[0]).toMatchObject({ relation: "informs", kind: "inference" });
    expect(dry.evidence[0].observed).toBe("server");
    expect(j.count()).toBe(before);
    expect((j.store.db.query(`SELECT COUNT(*) AS n FROM mutations`).get() as { n: number }).n).toBe(mutations);
  });

  test("too_long refuses before any write, per act, and nothing is truncated", async () => {
    const { j, a, sa, sb } = pair();
    const task = completedTask(j, a);
    const proposal = j.store.openProposalForSession({
      ...a.credential, idempotency_key: "p", question: "Ship it?", criteria: "Tests pass.", extent: "The parser.",
    });
    const before = j.count();
    const long = await refused(sa, "collab_note", { text: "x".repeat(201) });
    expect(long.code).toBe("statement_too_long");
    expect(long.remedy).toEqual({ say: "put the rest after a blank line" });
    const note = await refused(sa, "collab_note", { text: `A long note.\n\n${"y".repeat(8_000)}` });
    expect(note).toMatchObject({ code: "too_long", field: "note", max: 8_000 });
    const review = await refused(sb, "collab_note", { act: "accept", text: `Fine.\n\n${"z".repeat(4_000)}`, re: task.completion_report_id });
    expect(review).toMatchObject({ code: "too_long", max: 4_000 });
    const relay = await refused(sb, "collab_note", { act: "relay_rejection", text: `No.\n\n${"w".repeat(2_000)}`, re: proposal.proposal.id });
    expect(relay).toMatchObject({ code: "too_long", field: "text", max: 2_000 });
    expect(j.count()).toBe(before);
    expect(j.store.getTask(a.workspace.id, task.id).review_status).toBe("pending");
  });
});

describe("derived idempotency for collab_note", () => {
  test("a lost-response retry replays and appends no event", async () => {
    const { j, sa, sb } = pair();
    j.write("src/a.ts", "a\n");
    const root = await ok(sa, "collab_note", { text: "A claim." });
    const input = { act: "challenge", text: "No.", re: root.ids.report, evidence: ["file src/a.ts"] };
    const first = await ok(sb, "collab_note", input);
    const before = j.count();
    const retry = await ok(sb, "collab_note", input);
    expect(retry.replayed).toBe(true);
    expect(retry.effect).toStartWith("Replayed: nothing new was written.");
    expect(retry.ids.report).toBe(first.ids.report);
    expect(j.count()).toBe(before);
    // A handle for the same target is the same call.
    const byHandle = await ok(sb, "collab_note", { ...input, re: root.ids.report_handle });
    expect(byHandle.replayed).toBe(true);
    expect(j.count()).toBe(before);
  });

  test("challenge, withdraw, the same challenge again: the second challenge is written", async () => {
    const { j, a, sa, sb } = pair();
    const proposal = j.store.openProposalForSession({
      ...a.credential, idempotency_key: "p", question: "Ship it?", criteria: "Tests pass.", extent: "The parser.",
    });
    const input = { act: "challenge", text: "No.", re: proposal.proposal.id };
    const first = await ok(sb, "collab_note", input);
    await ok(sb, "collab_note", { act: "withdraw", text: "Taken back.", re: first.ids.report });
    expect(j.store.proposalStatus(a.workspace.id, proposal.proposal.id).ai.unresolved_challenge_report_ids).toEqual([]);
    const again = await ok(sb, "collab_note", input);
    expect(again.replayed).toBeUndefined();
    expect(again.ids.report).not.toBe(first.ids.report);
    expect(j.store.proposalStatus(a.workspace.id, proposal.proposal.id).ai.unresolved_challenge_report_ids).toEqual([again.ids.report]);
    void sa;
  });

  test("a deliberate repeat after another act on the same entity writes again", async () => {
    const { j, sa, sb } = pair();
    const root = await ok(sa, "collab_note", { text: "A claim." });
    const input = { text: "I agree, mostly.", re: root.ids.report };
    const first = await ok(sb, "collab_note", input);
    await ok(sb, "collab_note", { act: "support", text: "Yes.", re: root.ids.report });
    const again = await ok(sb, "collab_note", input);
    expect(again.replayed).toBeUndefined();
    expect(again.ids.report).not.toBe(first.ids.report);
    void j;
  });

  test("a retried verdict replays; a retry after a re-completion acts afresh and is refused as changed", async () => {
    const j = journal();
    const a = j.start("alpha");
    const b = j.start("bravo");
    const [sa, sb] = [j.serve(a), j.serve(b)];
    const task = completedTask(j, a);
    const input = { act: "request_changes", text: "Again.", re: task.completion_report_id };
    const first = await ok(sb, "collab_note", input);
    const before = j.count();
    const retry = await ok(sb, "collab_note", input);
    expect(retry).toMatchObject({ replayed: true, ids: { review_report: first.ids.review_report } });
    expect(j.count()).toBe(before);
    await ok(sa, "collab_take", { task: task.id });
    await ok(sa, "collab_done", { text: "Done again." });
    const afresh = await refused(sb, "collab_note", input);
    expect(afresh.code).toBe("changed_under_you");
  });

  test("a retried relay replays", async () => {
    const { j, a, sb } = pair();
    const proposal = j.store.openProposalForSession({
      ...a.credential, idempotency_key: "p", question: "Ship it?", criteria: "Tests pass.", extent: "The parser.",
    });
    const input = { act: "relay_rejection", text: "The person said no.", re: proposal.proposal.id };
    await ok(sb, "collab_note", input);
    const before = j.count();
    expect((await ok(sb, "collab_note", input)).replayed).toBe(true);
    expect(j.count()).toBe(before);
  });

  test("a relayed no said again after the person agreed is recorded again, and work stops", async () => {
    const { j, a, b, sb } = pair();
    const proposal = j.store.openProposalForSession({
      ...a.credential, idempotency_key: "p", question: "Ship it?", criteria: "Tests pass.", extent: "The parser.",
    });
    j.store.appendReportForSession({ ...b.credential, idempotency_key: "s", kind: "inference", body: "Yes.", relation: "supports", target_report_id: proposal.proposal.id } as never);
    const status = j.store.proposalStatus(a.workspace.id, proposal.proposal.id);
    const input = { act: "relay_rejection", text: "The person said no.", re: proposal.proposal.id };
    await ok(sb, "collab_note", input);
    j.store.recordPersonActAtTerminal({ proposal_report_id: proposal.proposal.id, proposal_sha256: status.proposal_sha256, act: "agree" } as never);
    expect(j.store.proposalStatus(a.workspace.id, proposal.proposal.id).may_proceed).toBe(true);
    const before = j.count();
    const again = await ok(sb, "collab_note", input);
    expect(again.replayed).toBeUndefined();
    expect(again).toMatchObject({ person: "rejected", may_proceed: false });
    expect(j.events().filter((event) => event.sequence > before).map((event) => event.type)).toContain("proposal.rejected");
    const after = j.store.proposalStatus(a.workspace.id, proposal.proposal.id);
    expect(after).toMatchObject({ may_proceed: false, person: { state: "rejected" } });
    // Retried at once, it replays the new rejection, which is still the latest act.
    const mark = j.count();
    expect((await ok(sb, "collab_note", input))).toMatchObject({ replayed: true, person: "rejected", may_proceed: false });
    expect(j.count()).toBe(mark);
  });

  test("challenge, lift it, the same challenge again: the second challenge stands", async () => {
    const { j, a, sb } = pair();
    const proposal = j.store.openProposalForSession({
      ...a.credential, idempotency_key: "p", question: "Ship it?", criteria: "Tests pass.", extent: "The parser.",
    });
    const input = { act: "challenge", text: "No: untested.", re: proposal.proposal.id };
    const first = await ok(sb, "collab_note", input);
    await ok(sb, "collab_note", { act: "resolve", text: "Answered; I lift it.", re: first.ids.report });
    expect(j.store.proposalStatus(a.workspace.id, proposal.proposal.id).ai.unresolved_challenge_report_ids).toEqual([]);
    const before = j.count();
    const again = await ok(sb, "collab_note", input);
    expect(again.replayed).toBeUndefined();
    expect(again.ids.report).not.toBe(first.ids.report);
    expect(j.count()).toBeGreaterThan(before);
    const status = j.store.proposalStatus(a.workspace.id, proposal.proposal.id);
    expect(status.ai.unresolved_challenge_report_ids).toEqual([again.ids.report]);
    expect(status.ai.position).toBe("challenged");
  });

  test("every report act replays a lost-response retry: support, the answer form, a replacing challenge, resolve, withdraw", async () => {
    const { j, sa, sb } = pair();
    const root = await ok(sa, "collab_note", { text: "A claim." });
    const challenge = await ok(sb, "collab_note", { act: "challenge", text: "No.", re: root.ids.report });
    const retried = async (server: unknown, input: Record<string, unknown>) => {
      const first = await ok(server, "collab_note", input);
      const before = j.count();
      const retry = await ok(server, "collab_note", input);
      expect(retry).toMatchObject({ replayed: true, recorded_as: first.recorded_as, to: first.to, note: first.note });
      expect(retry.ids.report).toBe(first.ids.report);
      expect(retry.effect).toStartWith("Replayed: nothing new was written.");
      expect(j.count()).toBe(before);
      return first;
    };
    await retried(sb, { act: "support", text: "Yes, in part.", re: root.ids.report });
    expect((await retried(sa, { act: "resolve", text: "Here is my answer.", re: challenge.ids.report })).recorded_as).toBe("answer");
    const replacing = await retried(sb, { act: "challenge", text: "No: and more.", re: root.ids.report, replaces: challenge.ids.report });
    expect(replacing.ids.withdrawal).toBeDefined();
    expect((await retried(sb, { act: "resolve", text: "Answered; I lift it.", re: replacing.ids.report })).recorded_as).toBe("resolve");
    await retried(sa, { act: "withdraw", text: "I take it back.", re: root.ids.report });
  });

  test("a lost-response retry replays when the state that picks its addressee has changed", async () => {
    const j = journal();
    const a = j.start("alpha");
    const b = j.start("bravo");
    const c = j.start("charlie");
    const [sa, sb, sc] = [j.serve(a), j.serve(b), j.serve(c)];
    const replays = async (server: unknown, input: Record<string, unknown>, between: () => Promise<unknown> | unknown) => {
      const first = await ok(server, "collab_note", input);
      await between();
      const before = j.count();
      const retry = await ok(server, "collab_note", input);
      expect(retry.replayed).toBe(true);
      expect(retry.ids.report).toBe(first.ids.report);
      expect(retry.to).toEqual(first.to);
      expect(j.count()).toBe(before);
    };
    // A withdrawal is addressed to the latest standing challenger; another challenges in between.
    const root = await ok(sa, "collab_note", { text: "A claim I will take back." });
    await ok(sb, "collab_note", { act: "challenge", text: "Wrong.", re: root.ids.report });
    await replays(sa, { act: "withdraw", text: "I take it back.", re: root.ids.report },
      () => ok(sc, "collab_note", { act: "challenge", text: "Also wrong.", re: root.ids.report }));
    // A note on a task goes to its holder; the holder changes in between.
    const taken = await ok(sb, "collab_take", { title: "Shared work" });
    await replays(sa, { text: "Mind the parser.", re: taken.ids.task }, async () => {
      await ok(sb, "collab_done", { text: "Giving it back.", outcome: "released" });
      await ok(sc, "collab_take", { task: taken.ids.task });
    });
    // A note to a name; the session with that name restarts in between.
    await replays(sa, { text: "For bravo: the build is red.", to: "bravo" }, () => {
      j.store.endSession({ ...b.credential, reason: "restart" });
      j.start("bravo");
    });
  });
});

describe("a verdict is refused before its evidence is cited", () => {
  const types = (j: Journal, after: number) => j.events().filter((event) => event.sequence > after).map((event) => event.type);

  test("self-review, a challenged or withdrawn completion, and work not waiting for review write no cite", async () => {
    const j = journal();
    const a = j.start("alpha");
    const b = j.start("bravo");
    const c = j.start("charlie");
    const [sa, sb, sc] = [j.serve(a), j.serve(b), j.serve(c)];
    j.write("t.txt", "t\n");
    const task = completedTask(j, a);
    const verdict = (act: string) => ({ act, text: "Looks right.", re: task.completion_report_id, evidence: ["file t.txt"] });
    let before = j.count();
    expect((await refused(sa, "collab_note", verdict("accept"))).code).toBe("self_review_forbidden");
    expect((await refused(sa, "collab_note", verdict("request_changes"))).code).toBe("self_review_forbidden");
    expect(types(j, before)).toEqual([]);

    const challenge = await ok(sb, "collab_note", { act: "challenge", text: "Untested.", re: task.completion_report_id });
    before = j.count();
    expect((await refused(sc, "collab_note", verdict("accept"))).code).toBe("completion_challenged");
    expect(types(j, before)).toEqual([]);
    await ok(sb, "collab_note", { act: "resolve", text: "Tested now.", re: challenge.ids.report });
    before = j.count();
    await ok(sc, "collab_note", verdict("accept"));
    expect(types(j, before)[0]).toBe("evidence.cited");
    // Accepted: a second verdict, from anyone, finds nothing waiting.
    before = j.count();
    expect((await refused(sb, "collab_note", verdict("accept"))).code).toBe("task_not_pending_review");
    expect(types(j, before)).toEqual([]);

    const withdrawn = completedTask(j, a, { key: "w", paths: ["src/other.ts"] });
    await ok(sa, "collab_note", { act: "withdraw", text: "Not finished after all.", re: withdrawn.completion_report_id });
    before = j.count();
    const obsolete = await refused(sb, "collab_note", { ...verdict("accept"), re: withdrawn.completion_report_id });
    expect(obsolete.code).toBe("completion_report_obsolete");
    expect(types(j, before)).toEqual([]);
  });

  test("a journal pointer that does not exist is refused before the cite", async () => {
    const { j, a, sb } = pair();
    j.write("t.txt", "t\n");
    const task = completedTask(j, a);
    const before = j.count();
    const refusal = await refused(sb, "collab_note", {
      act: "accept", text: "Fine.", re: task.completion_report_id, evidence: ["file t.txt", "event:event_00000000-0000-4000-8000-000000000000"],
    });
    expect(refusal.code).toBe("evidence_not_found");
    expect(j.count()).toBe(before);
  });

  test("a verdict refused after its cite names the cite it recorded", async () => {
    const { j, a, sb } = pair();
    j.write("t.txt", "t\n");
    const task = completedTask(j, a);
    (j.store as any).reviewTaskForSession = () => {
      throw new CollabError("worktree_observation_stale", "The completion checkpoint changed after review preparation");
    };
    const refusal = await refused(sb, "collab_note", { act: "accept", text: "Fine.", re: task.completion_report_id, evidence: ["file t.txt"] });
    expect(refusal.code).toBe("worktree_observation_stale");
    const cited = j.events().filter((event) => event.type === "evidence.cited");
    expect(cited).toHaveLength(1);
    const event = (j.store.db.query(`SELECT id FROM events WHERE sequence = ?`).get(cited[0]!.sequence) as { id: string }).id;
    expect(refusal.recorded_steps).toEqual([
      { step: 1, what: `evidence.cited event ${event} (cite ${cited[0]!.payload.cite_id})`, id: event },
    ]);
    expect(refusal.message).toContain(event);
    expect(JSON.stringify(refusal.remedy)).not.toMatch(/nothing was written/i);
  });

  test("a replayed verdict reports the evidence its cite recorded; a file changed since is advice", async () => {
    const { j, a, sb } = pair();
    j.write("t.txt", "first\n");
    const task = completedTask(j, a);
    const input = { act: "accept", text: "Holds.", re: task.completion_report_id, evidence: ["file t.txt"] };
    const first = await ok(sb, "collab_note", input);
    expect(first.evidence[0]).toMatchObject({ observed: "server", sha256: sha("first\n") });
    j.write("t.txt", "second\n");
    const retry = await ok(sb, "collab_note", input);
    expect(retry.replayed).toBe(true);
    expect(retry.evidence[0]).toMatchObject({ observed: "server", sha256: sha("first\n") });
    expect(retry.advice.join(" ")).toContain(sha("second\n"));
  });
});

describe("a FIFO at a cited path", () => {
  test("is recorded as the caller's, and a cited file later replaced by one reads as changed, without blocking", () => {
    const run = spawnSync(process.execPath, [join(import.meta.dir, "fifo-evidence-worker.ts")], {
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(run.signal).toBeNull();
    expect(run.status).toBe(0);
    const out = JSON.parse(run.stdout.trim().split("\n").at(-1)!);
    expect(out.hash).toEqual({ status: "not_a_file", path: "src/pipe" });
    expect(out.cited.evidence[0]).toMatchObject({ kind: "file", locator: "src/pipe", observed: "caller" });
    expect(out.cited.advice.join(" ")).toContain("is not a regular file");
    expect(out.now).toMatchObject({ kind: "file", observed: "server", now: "changed" });
  });
});
