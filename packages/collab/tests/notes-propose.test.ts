import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { CollabError } from "../src/errors.js";
import { NOTE_FORMAT, parseNote } from "../src/note.js";
import { proposalBytes, type ProposalContent } from "../src/proposal.js";
import type { ProposalStatus, SessionHandle } from "../src/protocol.js";
import { NOTE_NOTHING_AUTHORISED, NOTE_SELF_DECISION_BASIS } from "../src/store.js";
import {
  CARRIED_OBJECTIONS_SENTENCE,
  DECISION_DOES_NOT_ESTABLISH,
  FOR_THE_PERSON_NOTE,
  handleOf,
} from "../src/verbs.js";
import { journal, ok, refused, runCleanup, type Journal } from "./notes-helpers.js";

// collab_propose (Collab Notes spec 5.6), the decide act of collab_note
// (5.3), and the proposal and decision views of collab_inbox (5.2, 6). The
// person's side is exercised through the desk's own store functions, as
// tests/proposal-consent.test.ts and tests/person-desk.test.ts do, never
// through an agent tool.

afterEach(runCleanup);

const MINUTE = 60_000;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** A seeded generator, so a failing case can be replayed. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    chance: (p: number) => next() < p,
  };
}

const WORDS = ["parser", "協作", "筆記", "tabs", "🏮", "é", "release", "the", "a", "build", "lazy", "consensus", "–", "\"quoted\"", "x/y"];

function text(rng: ReturnType<typeof random>, lines: number, spaced = false): string {
  const out: string[] = [];
  for (let line = 0; line < lines; line += 1) {
    const words = Array.from({ length: rng.int(1, 9) }, () => rng.pick(WORDS));
    out.push(words.join(rng.chance(0.2) ? "  " : " "));
    if (rng.chance(0.2)) out.push("");
  }
  const body = out.join("\n");
  return spaced ? `  ${body}\n ` : body;
}

/** The desk's own path for an agreement: the challenge bytes, then the terminal record. */
function agree(j: Journal, proposalId: string): ProposalStatus {
  const challenge = j.store.personActChallenge({ proposal_report_id: proposalId, act: "agree" });
  return j.store.recordPersonActAtTerminal({
    proposal_report_id: proposalId,
    proposal_sha256: challenge.proposal_sha256,
    act: "agree",
    expected_ai_snapshot: challenge.ai_snapshot,
  });
}

function rejectAtTerminal(j: Journal, proposalId: string, reason: string): ProposalStatus {
  const challenge = j.store.personActChallenge({ proposal_report_id: proposalId, act: "reject", reason });
  return j.store.recordPersonActAtTerminal({
    proposal_report_id: proposalId,
    proposal_sha256: challenge.proposal_sha256,
    act: "reject",
    reason,
    expected_ai_snapshot: challenge.ai_snapshot,
  });
}

function trio(j: Journal = journal()) {
  const a = j.start("alpha");
  const b = j.start("bravo");
  const c = j.start("charlie");
  return { j, a, b, c, sa: j.serve(a), sb: j.serve(b), sc: j.serve(c) };
}

const TERMS = { question: "Should the parser keep trailing tabs?", criteria: "Round trips stay byte-equal.", extent: "packages/collab/src/note.ts only." };

/** What collab_proposal_status returns for this proposal, through the tool itself. */
async function toolStatus(server: unknown, handle: SessionHandle, id: string): Promise<ProposalStatus> {
  return (await ok(server, "collab_proposal_status", { workspace_id: handle.workspace.id, proposal_report_id: id })).proposal as ProposalStatus;
}

function events(j: Journal) {
  return j.count();
}

// ---------------------------------------------------------------------------
// collab_propose

describe("collab_propose: the same bytes as collab_proposal_open", () => {
  test("for generated terms, the bytes differ from collab_proposal_open's only by the report id", async () => {
    const j = journal();
    const a = j.start("alpha");
    const b = j.start("bravo");
    const server = j.serve(a);
    const cited = j.store.appendReportForSession({ ...b.credential, idempotency_key: "r", kind: "observation", body: "A finding." });
    const rng = random(0x5eed);
    for (let round = 0; round < 24; round += 1) {
      const terms = {
        question: text(rng, rng.int(1, 4), rng.chance(0.5)),
        criteria: text(rng, rng.int(1, 3), rng.chance(0.3)),
        extent: text(rng, rng.int(1, 2), rng.chance(0.3)),
        ...(rng.chance(0.5) ? { conflicts: text(rng, 2) } : {}),
        ...(rng.chance(0.5) ? { limits: text(rng, 2, rng.chance(0.5)) } : {}),
        ...(rng.chance(0.5) ? { topic: `principle:${rng.pick(["a", "b", "c"])}${round}` } : {}),
      };
      const seconds = rng.pick([600, 3_600, 21_600, 604_800]);
      const refs = rng.chance(0.5) ? [`report:${cited.id}`] : [];
      const legacy = (await ok(server, "collab_proposal_open", {
        workspace_id: a.workspace.id,
        idempotency_key: `legacy-${round}`,
        question: terms.question,
        criteria: terms.criteria,
        extent: terms.extent,
        ...(terms.conflicts !== undefined ? { known_conflicts: terms.conflicts } : {}),
        ...(terms.limits !== undefined ? { limits: terms.limits } : {}),
        ...(terms.topic !== undefined ? { topic: terms.topic } : {}),
        evidence_refs: refs,
        consult_seconds: seconds,
      })).proposal as ProposalStatus;
      const proposed = await ok(server, "collab_propose", { ...terms, closes: seconds, evidence: refs });
      const status = proposed.status as ProposalStatus;
      // Opened at the same instant with the same terms: once the report id
      // is the legacy one, the bytes hash to the legacy proposal_sha256.
      const { protocol: _protocol, rule: _rule, ...content } = JSON.parse(status.proposal_bytes) as ProposalContent & { protocol: string; rule: string };
      expect(sha(proposalBytes({ ...content, report_id: legacy.proposal.id }))).toBe(legacy.proposal_sha256);
      expect(sha(status.proposal_bytes)).toBe(status.proposal_sha256);
      expect(status.proposal.body).toBe(legacy.proposal.body);
      // Verbatim, with no note marker.
      expect(j.payload(status.proposal.id).note).toBeUndefined();
      expect(proposed.proposal_sha256).toBe(status.proposal_sha256);
    }
  });

  test("evidence and limits enter the hashed bytes; outside evidence is cited first by the author", async () => {
    const j = journal();
    const a = j.start("alpha");
    j.start("bravo");
    const server = j.serve(a);
    const one = await ok(server, "collab_propose", { ...TERMS, limits: "Not the tokenizer." });
    const two = await ok(server, "collab_propose", { ...TERMS, limits: "Not the renderer." });
    const relies = (id: string) => JSON.parse(j.store.proposalStatus(a.workspace.id, id).proposal_bytes).relies_on as string[];
    const limitsOf = (id: string) => JSON.parse(j.store.proposalStatus(a.workspace.id, id).proposal_bytes).limits as string;
    expect(limitsOf(one.ids.proposal)).toBe("Not the tokenizer.");
    expect(limitsOf(two.ids.proposal)).toBe("Not the renderer.");
    j.write("src/note.ts", "export const tabs = true;\n");
    const before = j.count();
    const withEvidence = await ok(server, "collab_propose", {
      ...TERMS,
      evidence: ["file src/note.ts:1", `report:${one.ids.proposal}`, "test bun test tests/note.test.ts exit=0"],
    });
    const cite = j.events().filter((event) => event.sequence > before && event.type === "evidence.cited");
    expect(cite).toHaveLength(1);
    const opened = j.events().find((event) => event.type === "proposal.opened" && event.entity_id === withEvidence.ids.proposal)!;
    expect(cite[0]!.sequence).toBeLessThan(opened.sequence);
    expect(cite[0]!.payload.by_session_id).toBe(a.session.id);
    expect(cite[0]!.payload.items.map((item: any) => [item.kind, item.observed])).toEqual([["file", "server"], ["test", "caller"]]);
    expect(relies(withEvidence.ids.proposal).sort()).toEqual([`event:${withEvidence.ids.evidence_cited.event}`, `report:${one.ids.proposal}`].sort());
    expect(withEvidence.evidence.map((item: any) => item.observed)).toEqual(["server", "journal", "caller"]);
    // The same terms with a changed file cite a different hash, so the bytes the person signs change too.
    j.write("src/note.ts", "export const tabs = false;\n");
    const changed = await ok(server, "collab_propose", { ...TERMS, question: `${TERMS.question} (again)`, evidence: ["file src/note.ts:1"] });
    const cites = j.events().filter((event) => event.type === "evidence.cited");
    expect(cites.at(-1)!.payload.items[0].sha256).not.toBe(cite[0]!.payload.items[0].sha256);
    expect(relies(changed.ids.proposal)).toEqual([`event:${changed.ids.evidence_cited.event}`]);
  });

  test("closes: seconds, a duration or an ISO time, with the nearest working value as remedy", async () => {
    const j = journal();
    const a = j.start("alpha");
    const server = j.serve(a);
    const now = Date.parse(j.store.noteNow());
    const closesAt = async (closes: unknown) => (await ok(server, "collab_propose", { ...TERMS, question: `Q ${String(closes)}?`, closes })).closes_at;
    expect(await closesAt(undefined)).toBe(new Date(now + 6 * 3_600_000).toISOString());
    expect(await closesAt(600)).toBe(new Date(now + 600_000).toISOString());
    expect(await closesAt("30m")).toBe(new Date(now + 1_800_000).toISOString());
    expect(await closesAt("1d12h")).toBe(new Date(now + 36 * 3_600_000).toISOString());
    expect(await closesAt(new Date(now + 2 * 3_600_000).toISOString())).toBe(new Date(now + 2 * 3_600_000).toISOString());
    const before = j.count();
    const low = await refused(server, "collab_propose", { ...TERMS, closes: 599 });
    expect(low).toMatchObject({ code: "invalid_closes", remedy: { tool: "collab_propose", input: { closes: 600 } } });
    const high = await refused(server, "collab_propose", { ...TERMS, closes: "8d" });
    expect(high.remedy.input.closes).toBe(604_800);
    const unreadable = await refused(server, "collab_propose", { ...TERMS, closes: "soon" });
    expect(unreadable.code).toBe("invalid_closes");
    expect(unreadable.remedy.say).toContain("604800");
    expect((await refused(server, "collab_propose", { ...TERMS, extent: "x".repeat(1_001) })).code).toBe("too_long");
    expect(j.count()).toBe(before);
  });

  test("a lone author is told so, and the result carries voices, needs and for_the_person", async () => {
    const j = journal();
    const a = j.start("alpha");
    const server = j.serve(a);
    const result = await ok(server, "collab_propose", TERMS);
    expect(result).toMatchObject({
      ok: true,
      authorises: "Nothing. This is coordination state.",
      position: "open",
      lone: true,
      voices: [{ voice: a.session.id, name: "alpha", author: true, last_seen_minutes: 0 }],
    });
    expect(result.needs).toContain("lone voice");
    expect(result.advice.join(" ")).toContain("lone voice");
    expect(result.for_the_person.terminal).toContain(result.ids.proposal);
    expect(parseNote(result.note)).toMatchObject({ act: "propose", statement: TERMS.question, re: `proposal:${result.ids.proposal}` });
    // The support that advice asked for is then said to count, not to add nothing.
    const support = await ok(server, "collab_note", { act: "support", text: "I stand behind it.", re: result.ids.proposal });
    expect(support.advice.join(" ")).toContain("this explicit support is what consent/v1 counts from a lone voice");
    expect(support.advice.join(" ")).toContain("the person still decides");
    const about = await ok(server, "collab_inbox", { about: result.ids.proposal });
    expect(about.position).toBe("consented");
  });

  test("a lost-response retry replays, and the same terms after a withdrawal open a new proposal", async () => {
    const { j, sa } = trio();
    j.write("src/a.ts", "a\n");
    const input = { ...TERMS, evidence: ["file src/a.ts"] };
    const first = await ok(sa, "collab_propose", input);
    const before = j.count();
    const retry = await ok(sa, "collab_propose", input);
    expect(retry).toMatchObject({ replayed: true, ids: { proposal: first.ids.proposal } });
    expect(retry.effect).toStartWith("Replayed: nothing new was written.");
    expect(j.count()).toBe(before);
    await ok(sa, "collab_note", { act: "withdraw", text: "Not this one.", re: first.ids.proposal });
    const again = await ok(sa, "collab_propose", input);
    expect(again.replayed).toBeUndefined();
    expect(again.ids.proposal).not.toBe(first.ids.proposal);
  });

  test("a deliberate repeat after another proposal by the same session opens again", async () => {
    const { j, sa } = trio();
    const first = await ok(sa, "collab_propose", TERMS);
    await ok(sa, "collab_propose", { ...TERMS, question: "Something else?" });
    const before = j.count();
    const repeat = await ok(sa, "collab_propose", TERMS);
    expect(repeat.replayed).toBeUndefined();
    expect(repeat.ids.proposal).not.toBe(first.ids.proposal);
    expect(j.count()).toBeGreaterThan(before);
  });
});

describe("collab_propose replaces: carried objections", () => {
  test("each standing challenge is carried in the stated form, objectors are told, and carried objections do not block", async () => {
    const j = journal();
    const a = j.start("alpha");
    const b = j.start("bravo");
    const c = j.start("charlie");
    const d = j.start("delta");
    const [sa, sb, sc, sd] = [j.serve(a), j.serve(b), j.serve(c), j.serve(d)];
    const first = await ok(sa, "collab_propose", TERMS);
    const longWords = `No: ${"trailing tabs are data, ".repeat(7)}end.`;
    const fromBravo = await ok(sb, "collab_note", { act: "challenge", text: "No: tabs are data.", re: first.ids.proposal });
    const lifted = await ok(sc, "collab_note", { act: "challenge", text: "Unclear.", re: first.ids.proposal });
    await ok(sc, "collab_note", { act: "resolve", text: "Clear now.", re: lifted.ids.report });
    const fromDelta = await ok(sd, "collab_note", { act: "challenge", text: longWords, re: first.ids.proposal });
    j.store.endSession({ ...d.credential, reason: "done" });
    const replacing = await ok(sa, "collab_propose", { ...TERMS, conflicts: "Bravo and Delta objected.", replaces: first.ids.proposal });
    const status = replacing.status as ProposalStatus;
    const delta160 = longWords.split("\n")[0]!.slice(0, 160);
    expect(status.terms.known_conflicts).toBe([
      "Bravo and Delta objected.",
      "",
      `carried objection by bravo (report:${fromBravo.ids.report}): No: tabs are data.`,
      `carried objection by delta (report:${fromDelta.ids.report}): ${delta160}…`,
    ].join("\n"));
    // The objector's own words are untouched in the journal.
    expect(parseNote(j.report(fromDelta.ids.report).body).statement).toBe(longWords);
    // Carried text does not stand on the new proposal.
    expect(status.ai.unresolved_challenge_report_ids).toEqual([]);
    expect(replacing.position).toBe("open");
    expect(replacing.carried_note).toBe(CARRIED_OBJECTIONS_SENTENCE);
    expect(replacing.carried_objections).toEqual([
      expect.objectContaining({ challenge: fromBravo.ids.report, carried_in_terms: true, counted_by_consent_v1: false, re_raised_here: false }),
      expect.objectContaining({ challenge: fromDelta.ids.report, carried_in_terms: true, counted_by_consent_v1: false }),
    ]);
    // Bravo is told; Delta, whose session ended, is listed as unreachable.
    expect(replacing.objectors).toEqual([
      expect.objectContaining({ name: "bravo", reached: true, challenges: [fromBravo.ids.report] }),
      expect.objectContaining({ name: "delta", reached: false, challenges: [fromDelta.ids.report] }),
    ]);
    expect(replacing.unreachable_objectors).toEqual([expect.objectContaining({ name: "delta" })]);
    const noteId = replacing.ids.objector_notes[0].report;
    expect(j.report(noteId)).toMatchObject({ to_session_id: b.session.id, relation: "informs" });
    expect(j.payload(noteId)).toMatchObject({ about_proposal_id: replacing.ids.proposal, note: NOTE_FORMAT });
    expect(j.report(noteId).body).toContain(CARRIED_OBJECTIONS_SENTENCE);
    const inbox = await ok(sb, "collab_inbox", { limit: 50 });
    expect(inbox.items.some((item: any) => item.id === noteId)).toBe(true);
    // Every view says it: the about view and the carrying render.
    const about = await ok(sb, "collab_inbox", { about: replacing.ids.proposal });
    expect(about.carried_note).toBe(CARRIED_OBJECTIONS_SENTENCE);
    expect(about.replaced).toEqual({ id: first.ids.proposal, handle: handleOf("proposal", first.ids.proposal) });
    const carried = await ok(sb, "collab_inbox", { about: replacing.ids.proposal, format: "note" });
    expect(carried.note).toContain("not counted by consent/v1");
    expect((await ok(sb, "collab_inbox", { about: first.ids.proposal })).replaced_by)
      .toEqual({ id: replacing.ids.proposal, handle: handleOf("proposal", replacing.ids.proposal) });
    // An objector who challenges again stands on the new proposal.
    await ok(sb, "collab_note", { act: "challenge", text: "Still no.", re: replacing.ids.proposal });
    const again = await ok(sa, "collab_inbox", { about: replacing.ids.proposal });
    expect(again.position).toBe("challenged");
    expect(again.carried_objections[0]).toMatchObject({ re_raised_here: true });
  });

  test("past the cap the rest go by id; ids that do not fit are refused; a line is never cut to fit", async () => {
    const j = journal();
    const a = j.start("alpha");
    const b = j.start("bravo");
    const c = j.start("charlie");
    const [sa, sb, sc] = [j.serve(a), j.serve(b), j.serve(c)];
    const first = await ok(sa, "collab_propose", TERMS);
    const one = await ok(sb, "collab_note", { act: "challenge", text: "First objection, in full.", re: first.ids.proposal });
    const two = await ok(sc, "collab_note", { act: "challenge", text: "Second objection, in full.", re: first.ids.proposal });
    const fullLines = [
      `carried objection by bravo (report:${one.ids.report}): First objection, in full.`,
      `carried objection by charlie (report:${two.ids.report}): Second objection, in full.`,
    ];
    // Room for the first line and the second by id, but not both in full.
    const idTail = `carried objection(s) by id only: report:${two.ids.report}`;
    const own = "c".repeat(4_000 - 2 - fullLines[0]!.length - 1 - idTail.length);
    const partial = await ok(sa, "collab_propose", { ...TERMS, conflicts: own, replaces: first.ids.proposal });
    const conflicts = (partial.status as ProposalStatus).terms.known_conflicts!;
    expect(conflicts).toBe(`${own}\n\n${fullLines[0]}\n${idTail}`);
    expect(conflicts.length).toBeLessThanOrEqual(4_000);
    expect(partial.advice.join(" ")).toContain(two.ids.report);
    for (const line of conflicts.split("\n").slice(2)) {
      expect(fullLines.includes(line) || line.startsWith("carried objection(s) by id only: ")).toBe(true);
    }
    // When even the ids do not fit, nothing is written and the remedy asks to shorten the author's own text.
    const second = await ok(sa, "collab_propose", { ...TERMS, question: "Second try?" });
    await ok(sb, "collab_note", { act: "challenge", text: "Again no.", re: second.ids.proposal });
    const before = j.count();
    const tooLong = await refused(sa, "collab_propose", { ...TERMS, question: "Third try?", conflicts: "c".repeat(3_990), replaces: second.ids.proposal });
    expect(tooLong.code).toBe("conflicts_too_long");
    expect(Object.keys(tooLong.remedy)).toEqual(["say"]);
    expect(tooLong.remedy.say).toContain("Shorten your own conflicts");
    expect(j.count()).toBe(before);
  });

  test("replaces refuses another session's proposal and one no longer on the table, before any write", async () => {
    const { j, sa, sb } = trio();
    j.write("src/a.ts", "a\n");
    const first = await ok(sa, "collab_propose", TERMS);
    const before = j.count();
    const notMine = await refused(sb, "collab_propose", { ...TERMS, evidence: ["file src/a.ts"], replaces: first.ids.proposal });
    // The one take-back refusal and remedy: a note on the proposal to the person.
    expect(notMine.code).toBe("not_your_report");
    expect(notMine.remedy).toEqual({ tool: "collab_note", input: { act: "note", text: "I no longer stand by this.", re: first.ids.proposal, to: "person" } });
    expect(j.count()).toBe(before);
    await ok(sa, "collab_note", { act: "withdraw", text: "Withdrawn.", re: first.ids.proposal });
    const mark = j.count();
    expect((await refused(sa, "collab_propose", { ...TERMS, evidence: ["file src/a.ts"], replaces: first.ids.proposal })).code)
      .toBe("proposal_not_on_table");
    expect(j.count()).toBe(mark);
  });
});

// ---------------------------------------------------------------------------
// decide

describe("collab_note decide", () => {
  async function agreedProposal(extent = "packages/collab/src/note.ts only,\n  and its tests.") {
    const { j, a, b, c, sa, sb, sc } = trio();
    const opened = await ok(sa, "collab_propose", { ...TERMS, extent });
    await ok(sb, "collab_note", { act: "support", text: "Yes.", re: opened.ids.proposal, why: [{ text: "round trips", basis: "seen" }] });
    await ok(sc, "collab_note", { act: "support", text: "Yes.", re: opened.ids.proposal, why: [{ text: "same", basis: "inferred" }] });
    const status = agree(j, opened.ids.proposal);
    expect(status.may_proceed).toBe(true);
    return { j, a, b, c, sa, sb, sc, id: opened.ids.proposal as string, status };
  }

  test("proceed on an agreed proposal copies the extent byte-equal and derives the basis from the person's act", async () => {
    const { j, a, sa, sb, id, status } = await agreedProposal();
    const before = await toolStatus(sa, a, id);
    const decided = await ok(sb, "collab_note", { act: "decide", text: "We keep trailing tabs.", re: id });
    const row = j.report(decided.ids.report);
    expect(row).toMatchObject({ kind: "decision", relation: "informs", target_report_id: null, authority_scope: status.terms.extent });
    expect(row.authority_scope).toBe(status.terms.extent);
    const agreement = status.agreement!;
    const agreedEvent = (j.store.db.query(`SELECT id FROM events WHERE type = 'proposal.agreed' AND entity_id = ?`).get(id) as { id: string }).id;
    expect(row.authority_basis).toBe(`person agreed by controlling_terminal to proposal_sha256 ${status.proposal_sha256} (act ${agreement.id})`);
    expect(JSON.parse(row.evidence_refs_json)).toEqual([`event:${agreedEvent}`, `report:${id}`].sort());
    expect(j.payload(decided.ids.report)).toMatchObject({ about_proposal_id: id, note: NOTE_FORMAT, to_session_id: a.session.id });
    expect(decided).toMatchObject({
      authorises: "Nothing. This is coordination state.",
      outcome: "proceed",
      rests_on: { proposal: id, proposal_sha256: status.proposal_sha256, person_act: { id: agreement.id, basis: "controlling_terminal" }, extent: status.terms.extent },
    });
    // The note shows the extent as a note writes it; the scope column keeps its bytes.
    expect(parseNote(decided.note)).toMatchObject({ act: "decide", re: `proposal:${id}`, extent: "packages/collab/src/note.ts only,\nand its tests." });
    // A decision is not a support: consent/v1's counts are what they were.
    const after = await toolStatus(sa, a, id);
    expect(after.ai).toEqual(before.ai);
    expect(after.may_proceed).toBe(true);
    // The author is addressed.
    const inbox = await ok(sa, "collab_inbox", { limit: 50 });
    const item = inbox.items.find((entry: any) => entry.id === decided.ids.report);
    expect(item).toMatchObject({ act: "decide", re: { id, handle: handleOf("proposal", id) }, statement: "We keep trailing tabs." });
  });

  test("refusals: not_agreed, agreement_withdrawn (relayed or authenticated) and proposal_retired, each a say, never a desk command", async () => {
    const { j, sa, sb, sc } = trio();
    const opened = await ok(sa, "collab_propose", TERMS);
    const id = opened.ids.proposal as string;
    const before = j.count();
    const notAgreed = await refused(sb, "collab_note", { act: "decide", text: "Go.", re: id });
    const noDesk = (refusal: Record<string, any>) => {
      expect(Object.keys(refusal.remedy)).toEqual(["say"]);
      expect(JSON.stringify(refusal)).not.toContain("agenttool-collab-host");
    };
    expect(notAgreed.code).toBe("not_agreed");
    expect(notAgreed.remedy.say).toBe(`Ask the person to act on ${id} at his desk. No agent tool records agreement.`);
    noDesk(notAgreed);
    expect(j.count()).toBe(before);

    await ok(sb, "collab_note", { act: "support", text: "Yes.", re: id });
    await ok(sc, "collab_note", { act: "support", text: "Yes.", re: id });
    const agreed = agree(j, id);
    await ok(sc, "collab_note", { act: "relay_rejection", text: "The person said stop.", re: id });
    const relayed = await refused(sb, "collab_note", { act: "decide", text: "Go.", re: id });
    expect(relayed.code).toBe("agreement_withdrawn");
    expect(relayed.message).toContain("relayed by a session");
    expect(relayed.agreed_act.id).toBe(agreed.agreement!.id);
    expect(relayed.remedy.say).toContain("forgeable");
    noDesk(relayed);

    // The person agrees again on the same bytes, then rejects at the terminal.
    agree(j, id);
    rejectAtTerminal(j, id, "Not now.");
    const authenticated = await refused(sb, "collab_note", { act: "decide", text: "Go.", re: id });
    expect(authenticated.code).toBe("agreement_withdrawn");
    expect(authenticated.later_act.basis).toBe("controlling_terminal");
    expect(authenticated.remedy.say).not.toContain("forgeable");
    noDesk(authenticated);

    const replacement = await ok(sa, "collab_propose", { ...TERMS, replaces: id });
    const retired = await refused(sb, "collab_note", { act: "decide", text: "Go.", re: id });
    expect(retired.code).toBe("proposal_retired");
    expect(retired.remedy.say).toContain(replacement.ids.proposal);
    noDesk(retired);
    const withdrawnOne = await ok(sa, "collab_propose", { ...TERMS, question: "Another?" });
    await ok(sa, "collab_note", { act: "withdraw", text: "No.", re: withdrawnOne.ids.proposal });
    expect((await refused(sb, "collab_note", { act: "decide", text: "Go.", re: withdrawnOne.ids.proposal })).code).toBe("proposal_retired");
  });

  test("do_not_proceed and no_decision authorise nothing, with a basis read from the journal", async () => {
    const { j, sa, sb } = trio();
    const opened = await ok(sa, "collab_propose", TERMS);
    const id = opened.ids.proposal as string;
    const status = j.store.proposalStatus(opened.status.proposal.workspace_id, id);
    const no = await ok(sb, "collab_note", { act: "decide", outcome: "do_not_proceed", text: "We are not proceeding.", re: id });
    expect(j.report(no.ids.report)).toMatchObject({ kind: "decision", relation: "informs", authority_scope: NOTE_NOTHING_AUTHORISED });
    expect(j.report(no.ids.report).authority_basis).toBe(
      `do_not_proceed: recorded by this session; on proposal_sha256 ${status.proposal_sha256} the agents' position is open and the person's latest act is none`,
    );
    expect(no.rests_on).toBeUndefined();
    const none = await ok(sb, "collab_note", { act: "decide", outcome: "no_decision", text: "No decision was reached.", re: id });
    expect(j.report(none.ids.report).authority_basis).toStartWith("no_decision: ");
    const withExtent = await refused(sb, "collab_note", { act: "decide", outcome: "do_not_proceed", text: "No.", re: id, extent: "all of it" });
    expect(withExtent.code).toBe("extent_not_used");
    expect(withExtent.remedy.input.extent).toBeUndefined();
    expect((await refused(sb, "collab_note", { act: "decide", outcome: "maybe", text: "Hm.", re: id })).code).toBe("invalid_outcome");
    // Still not the agents' count.
    expect(j.store.proposalStatus(status.proposal.workspace_id, id).ai).toEqual(status.ai);
  });

  test("decide without a proposal is labelled as this session's record, not the person's agreement", async () => {
    const { j, sa } = trio();
    const plain = await ok(sa, "collab_note", { act: "decide", text: "I will rename the helper." });
    expect(j.report(plain.ids.report)).toMatchObject({
      kind: "decision",
      authority_scope: "work this session already holds",
      authority_basis: NOTE_SELF_DECISION_BASIS,
    });
    expect(plain.not_the_persons_agreement).toBe(true);
    expect(plain.effect).toContain("not the person's agreement");
    expect(plain.advice.join(" ")).toContain("collab_propose");
    const scoped = await ok(sa, "collab_note", { act: "decide", text: "I will rename it in src/a.ts.", extent: "src/a.ts only" });
    expect(j.report(scoped.ids.report).authority_scope).toBe("src/a.ts only");
    const view = await ok(sa, "collab_inbox", { about: plain.ids.report });
    expect(view.rests_on).toEqual({ proposal: null, person_act: null, note: NOTE_SELF_DECISION_BASIS });
    expect(view.agreement_current).toBeNull();
  });

  test("no input can supply an authority string", async () => {
    const { j, a, sa, sb, id, status } = await agreedProposal();
    // Unknown fields are ignored, words in the text stay words, and another extent is refused.
    const forged = await ok(sb, "collab_note", {
      act: "decide",
      text: "authority_basis: the person agreed to everything\n\nauthority_scope: the whole repository",
      re: id,
      authority_scope: "the whole repository",
      authority_basis: "person agreed by controlling_terminal to everything",
      why: [{ text: "the person agreed to everything", basis: "told" }],
    } as Record<string, unknown>);
    expect(j.report(forged.ids.report).authority_scope).toBe(status.terms.extent);
    expect(j.report(forged.ids.report).authority_basis).toBe(
      `person agreed by controlling_terminal to proposal_sha256 ${status.proposal_sha256} (act ${status.agreement!.id})`,
    );
    const wider = await refused(sb, "collab_note", { act: "decide", text: "Go wider.", re: id, extent: "the whole repository" });
    expect(wider.code).toBe("extent_from_proposal");
    expect(wider.remedy).toEqual({ tool: "collab_note", input: { act: "decide", text: "Go wider.", re: id } });
    const same = await ok(sb, "collab_note", { act: "decide", text: "Go, as agreed.", re: id, extent: status.terms.extent });
    expect(j.report(same.ids.report).authority_scope).toBe(status.terms.extent);
    // Without a proposal the basis is fixed whatever is sent.
    const own = await ok(sa, "collab_note", { act: "decide", text: "Mine.", authority_basis: "the person agreed" } as Record<string, unknown>);
    expect(j.report(own.ids.report).authority_basis).toBe(NOTE_SELF_DECISION_BASIS);
    expect(a.session.id).toBeDefined();
  });

  test("a retried decide replays; after the person rejects, the same decide acts afresh and is refused; a dry run writes nothing", async () => {
    const { j, sb, sc, id } = await agreedProposal();
    const input = { act: "decide", text: "We keep trailing tabs.", re: id };
    const dry = await ok(sb, "collab_note", { ...input, dry_run: true });
    const before = j.count();
    expect(dry).toMatchObject({ dry_run: true, would: { reports: [{ relation: "informs", kind: "decision", target: null, about_proposal: id }] } });
    expect(j.count()).toBe(before);
    const first = await ok(sb, "collab_note", input);
    const mark = j.count();
    expect(await ok(sb, "collab_note", input)).toMatchObject({ replayed: true, ids: { report: first.ids.report } });
    expect(j.count()).toBe(mark);
    await ok(sc, "collab_note", { act: "relay_rejection", text: "Stop.", re: id });
    expect((await refused(sb, "collab_note", input)).code).toBe("agreement_withdrawn");
    // The person agrees again on the same bytes: the same decide is a new decision resting on that act.
    const again = agree(j, id);
    const afresh = await ok(sb, "collab_note", input);
    expect(afresh.replayed).toBeUndefined();
    expect(afresh.ids.report).not.toBe(first.ids.report);
    expect(afresh.rests_on.person_act.id).toBe(again.agreement!.id);
    // After an intervening act on the same proposal by the same session, the same decide writes again.
    await ok(sb, "collab_note", { text: "A note on it.", re: id });
    const repeat = await ok(sb, "collab_note", input);
    expect(repeat.replayed).toBeUndefined();
    expect(repeat.ids.report).not.toBe(afresh.ids.report);
  });
});

// ---------------------------------------------------------------------------
// The proposal view

describe("collab_inbox about a proposal", () => {
  test("the position shown always equals collab_proposal_status, across the whole lifecycle (generated)", async () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 6; seed += 1) {
      const rng = random(seed * 7919);
      const j = journal();
      const handles = [j.start("alpha"), j.start("bravo"), j.start("charlie")];
      const servers = handles.map((handle) => j.serve(handle));
      const child = j.start("alpha/kid", { parent_session_id: handles[0]!.session.id, parent_attested: true });
      handles.push(child);
      servers.push(j.serve(child));
      const reader = servers[1]!;
      const proposals: string[] = [];
      const reports: Array<{ id: string; by: number; relation: string }> = [];
      const check = async () => {
        for (const id of proposals) {
          const view = await ok(reader, "collab_inbox", { about: id });
          const status = await toolStatus(reader, handles[1]!, id);
          expect(view.status).toEqual(status);
          expect(view.position).toBe(status.ai.position);
          expect(view.proposal_sha256).toBe(status.proposal_sha256);
          expect(view.may_proceed).toBe(status.may_proceed);
          seen.add(status.ai.position);
        }
      };
      for (let step = 0; step < 28; step += 1) {
        const who = rng.int(0, handles.length - 1);
        const roll = rng.next();
        const target = proposals.length > 0 ? rng.pick(proposals) : null;
        try {
          if (!target || roll < 0.15) {
            const opened = await ok(servers[who]!, "collab_propose", { ...TERMS, question: `Q${seed}.${step}?`, closes: rng.pick([600, 1_200]) });
            proposals.push(opened.ids.proposal);
          } else if (roll < 0.4) {
            const support = await ok(servers[who]!, "collab_note", { act: "support", text: `Yes ${step}.`, re: target });
            reports.push({ id: support.ids.report, by: who, relation: "support" });
          } else if (roll < 0.55) {
            const challenge = await ok(servers[who]!, "collab_note", { act: "challenge", text: `No ${step}.`, re: target });
            reports.push({ id: challenge.ids.report, by: who, relation: "challenge" });
          } else if (roll < 0.65 && reports.length > 0) {
            const mine = reports.filter((report) => report.by === who);
            if (mine.length > 0) {
              const report = rng.pick(mine);
              const act = report.relation === "challenge" && rng.chance(0.5) ? "resolve" : "withdraw";
              await ok(servers[who]!, "collab_note", { act, text: `Lift ${step}.`, re: report.id });
            }
          } else if (roll < 0.72) {
            const status = j.store.proposalStatus(handles[0]!.workspace.id, target);
            if (status.ai.position === "consented" && status.person.state !== "agreed") agree(j, target);
            else if (status.person.state === "agreed") rejectAtTerminal(j, target, "Changed my mind.");
          } else if (roll < 0.8) {
            const status = j.store.proposalStatus(handles[0]!.workspace.id, target);
            const author = handles.findIndex((handle) => handle.session.id === status.proposal.from_session_id);
            if (rng.chance(0.4)) await ok(servers[author]!, "collab_note", { act: "withdraw", text: "Withdrawn.", re: target });
            else {
              const replaced = await ok(servers[author]!, "collab_propose", { ...TERMS, question: `R${seed}.${step}?`, replaces: target });
              proposals.push(replaced.ids.proposal);
            }
          } else {
            j.advance(rng.int(1, 12) * MINUTE);
          }
        } catch (error) {
          // A refused act (say, replacing a retired proposal) changes nothing; the views must still agree.
          if (!(error instanceof Error) || !/failed:/.test(error.message)) throw error;
        }
        await check();
      }
      // Every walk ends with one replacement, so superseded is always seen.
      const last = await ok(servers[0]!, "collab_propose", { ...TERMS, question: `Last ${seed}?` });
      const next = await ok(servers[0]!, "collab_propose", { ...TERMS, question: `Last ${seed}, revised?`, replaces: last.ids.proposal });
      proposals.push(last.ids.proposal, next.ids.proposal);
      await check();
    }
    expect([...seen].sort()).toEqual(["challenged", "consented", "lapsed", "open", "split", "superseded", "withdrawn"]);
  }, 60_000);

  test("each annotation appears and changes no count", async () => {
    const j = journal();
    const author = j.start("alpha", { seat_ref: "host:pane-1" });
    const challenger = j.start("bravo");
    const quiet = j.start("charlie");
    const answerer = j.start("delta");
    const [sa, sb, sq, sd] = [j.serve(author), j.serve(challenger), j.serve(quiet), j.serve(answerer)];
    const opened = await ok(sa, "collab_propose", TERMS);
    const id = opened.ids.proposal as string;
    // A session that shares the author's handle, one that shares its name, and one that started after the open.
    j.advance(MINUTE);
    const sameSeat = j.start("echo", { seat_ref: "host:pane-1" });
    const sameName = j.start("alpha");
    const late = j.start("foxtrot");
    j.advance(MINUTE);
    await ok(j.serve(sameSeat), "collab_note", { act: "support", text: "Yes.", re: id });
    await ok(j.serve(sameName), "collab_note", { act: "support", text: "Yes.", re: id, why: [{ text: "checked", basis: "seen" }] });
    await ok(j.serve(late), "collab_note", { act: "support", text: "Yes.", re: id, evidence: [`report:${id}`] });
    const bare = await ok(sb, "collab_note", { act: "challenge", text: "No.", re: id });
    const grounded = await ok(sd, "collab_note", { act: "challenge", text: "No: untested.", re: id, why: [{ text: "no test", basis: "seen" }] });
    // A legacy resolves from another voice: an answer that lifts nothing.
    j.store.appendReportForSession({ ...author.credential, idempotency_key: "legacy-resolve", kind: "inference", body: "Answered.", relation: "resolves", target_report_id: grounded.ids.report });
    j.store.endSession({ ...challenger.credential, reason: "left" });
    const status = await toolStatus(sq, quiet, id);
    const view = await ok(sq, "collab_inbox", { about: id });
    expect(view.status).toEqual(status);
    const support = (name: string, flag: string) => view.supports.find((item: any) => item.by.session === name && item[flag] === true);
    expect(support(sameSeat.session.id, "same_seat_as_author")).toBeDefined();
    expect(support(sameName.session.id, "same_name_as_author")).toBeDefined();
    expect(support(sameSeat.session.id, "started_after_open")).toBeDefined();
    expect(support(late.session.id, "started_after_open")).toBeDefined();
    expect(support(sameSeat.session.id, "ungrounded")).toBeDefined();
    expect(view.supports.find((item: any) => item.by.session === sameName.session.id).ungrounded).toBeUndefined();
    const bareView = view.challenges.find((item: any) => item.id === bare.ids.report);
    expect(bareView).toMatchObject({ ungrounded: true, challenger_ended: true, voice_has_active_session: false, standing: true, counted: true });
    const groundedView = view.challenges.find((item: any) => item.id === grounded.ids.report);
    expect(groundedView).toMatchObject({ answered_by_another_voice: true, standing: true, counted: true });
    expect(groundedView.ungrounded).toBeUndefined();
    // Every flagged support still counts exactly as consent/v1 says.
    for (const item of view.supports) expect(item.counted).toBe(status.ai.qualifying_support_report_ids.includes(item.id));
    for (const item of view.challenges) expect(item.counted).toBe(status.ai.unresolved_challenge_report_ids.includes(item.id));
    expect(view.advice.join(" ")).toContain("challenger_ended");
    expect(view.annotations).toContain("display only");
    // delivery_recorded: quiet has now been shown it; the answerer never called inbox.
    j.advance(3 * MINUTE);
    const consulted = (await ok(sq, "collab_inbox", { about: id })).consulted;
    expect(consulted.find((voice: any) => voice.name === "charlie").delivery_recorded).toBe(true);
    expect(consulted.find((voice: any) => voice.name === "delta").delivery_recorded).toBe(false);
    expect(consulted.find((voice: any) => voice.name === "delta").last_seen_minutes).toBe(3);
    expect((await ok(sq, "collab_inbox", { about: id })).delivery.note).toContain("no recorded delivery on the notes surface");
    expect(await toolStatus(sq, quiet, id)).toEqual(status);
  });

  test("needs says what would move the position, and for_the_person gives the person's own commands with full ids", async () => {
    const { j, a, sa, sb, sc } = trio();
    const opened = await ok(sa, "collab_propose", { ...TERMS, closes: 600 });
    const id = opened.ids.proposal as string;
    expect(opened.needs).toContain("awaited voices");
    await ok(sb, "collab_note", { act: "challenge", text: "No.", re: id });
    const challenged = await ok(sc, "collab_inbox", { about: id });
    expect(challenged.needs).toContain("only each challenger's voice can lift its own");
    expect(challenged.for_the_person.now).toContain("only once the agents' position is consented");
    const person = challenged.for_the_person;
    expect(person.note).toBe(FOR_THE_PERSON_NOTE);
    expect(person.passkey).toStartWith(`agenttool-collab-host person ceremony --proposal ${id} --act agree --db '`);
    expect(person.terminal).toStartWith(`agenttool-collab-host person consent --proposal ${id} --db '`);
    // The commands are data for the person, never a suggested call.
    expect(JSON.stringify(challenged.next)).not.toContain("agenttool-collab-host");
    expect(a.session.id).toBeDefined();
    j.advance(11 * MINUTE);
    expect((await ok(sc, "collab_inbox", { about: id })).needs).toContain("Closed split");
  });

  test("the carrying render fits 800 characters, uses full ids, names no local detail and says what it cut", async () => {
    const j = journal();
    const a = j.start("alpha");
    const server = j.serve(a);
    const host = hostname().split(".")[0]!;
    const opened = await ok(server, "collab_propose", {
      question: `Keep trailing tabs?\n\n${"The parser keeps them as data, and the renderer must not strip them. ".repeat(20)}`,
      criteria: "Round trips stay byte-equal.",
      extent: "packages/collab/src/note.ts only.",
      limits: `Checked in ${a.workspace.id} at /Users/example/repo only.`,
    });
    const carried = await ok(server, "collab_inbox", { about: opened.ids.proposal, format: "note" });
    const note = carried.note as string;
    expect(note.length).toBeLessThanOrEqual(800);
    const parsed = parseNote(note);
    expect(parsed).toMatchObject({ act: "propose", re: `proposal:${opened.ids.proposal}` });
    expect(parsed.trailers).toEqual(expect.arrayContaining([{ key: "Sha256", value: opened.proposal_sha256 }]));
    expect(note).not.toMatch(/ws_[0-9a-f]{24}/);
    expect(note).not.toContain("/Users/");
    if (host.length >= 3 && !/^[0-9a-f]{1,7}$/i.test(host)) expect(note.toLowerCase()).not.toContain(host.toLowerCase());
    expect(note).not.toMatch(/proposal#[0-9a-f]{6}/);
    expect(carried.not_carried).toEqual(expect.arrayContaining(["limits (local detail)"]));
    expect(carried.not_carried.some((cut: string) => cut.startsWith("body"))).toBe(true);
    expect(note).toContain("Not-carried: ");
    expect(note).toContain("This authorises nothing elsewhere. A person sends it.");
  });
});

// ---------------------------------------------------------------------------
// The decision record and what waits on whom

describe("the composed decision record", () => {
  test("shows dissent, voices with no recorded delivery, agreement_current false after a later rejection, and does_not_establish", async () => {
    const { j, a, b, c, sa, sb, sc } = trio();
    const d = j.start("delta");
    const sd = j.serve(d);
    const opened = await ok(sa, "collab_propose", TERMS);
    const id = opened.ids.proposal as string;
    await ok(sb, "collab_note", { act: "support", text: "Yes.", re: id });
    await ok(sc, "collab_note", { act: "support", text: "Yes.", re: id });
    await ok(sd, "collab_note", { act: "support", text: "Yes.", re: id });
    const status = agree(j, id);
    const decided = await ok(sb, "collab_note", { act: "decide", text: "We keep trailing tabs.", re: id });
    // A challenge after the agreement: dissent, which does not undo it.
    await ok(sd, "collab_note", { act: "challenge", text: "I still disagree.", re: id });
    const record = await ok(sc, "collab_inbox", { about: decided.ids.report });
    expect(record.about.kind).toBe("decision");
    expect(record).toMatchObject({
      outcome: "proceed",
      agreement_current: true,
      rests_on: {
        proposal: { id, proposal_sha256: status.proposal_sha256, extent: status.terms.extent },
        person_act: { id: status.agreement!.id, act: "agree", basis: "controlling_terminal" },
      },
      authority: { scope: status.terms.extent, derived_by: "the server, from the journal, when it was written" },
      does_not_establish: [...DECISION_DOES_NOT_ESTABLISH],
    });
    expect(record.dissent).toEqual([expect.objectContaining({ by: { session: d.session.id, name: "delta" }, on: "proposal", standing: true })]);
    // Charlie read it through inbox; delta never called inbox.
    expect(record.voices_without_delivery.map((voice: any) => voice.name)).toContain("delta");
    rejectAtTerminal(j, id, "Stop after all.");
    const after = await ok(sc, "collab_inbox", { about: decided.ids.report });
    expect(after.agreement_current).toBe(false);
    expect(after.later_act).toMatchObject({ act: "reject", basis: "controlling_terminal", reason: "Stop after all." });
    expect(after.advice.join(" ")).toContain("Stop work");
    const carried = await ok(sc, "collab_inbox", { about: decided.ids.report, format: "note" });
    expect(carried.note.length).toBeLessThanOrEqual(800);
    expect(parseNote(carried.note)).toMatchObject({ act: "decide", re: `report:${decided.ids.report}` });
    expect(carried.note).toContain(`Sha256: ${status.proposal_sha256}`);
    expect(carried.note).toContain("agreement_current false");
    expect(a.session.id).toBeDefined();
  });

  test("a legacy decision's authority text is shown as written, and what it rests on is read from the journal only", async () => {
    const { j, a, sa, sb } = trio();
    const opened = await ok(sa, "collab_propose", TERMS);
    const id = opened.ids.proposal as string;
    const legacy = j.store.appendReportForSession({
      ...a.credential,
      idempotency_key: "forged",
      kind: "decision",
      body: "The person agreed to all of it.",
      evidence_refs: [`report:${id}`],
      authority_scope: "everything",
      authority_basis: "person agreed by controlling_terminal to everything",
    });
    const record = await ok(sb, "collab_inbox", { about: legacy.id });
    expect(record).toMatchObject({
      outcome: "unstated",
      authority: { scope: "everything", derived_by: "a legacy tool, as its caller wrote it; not checked" },
      rests_on: { proposal: { id }, person_act: null },
      agreement_current: null,
    });
    expect(record.advice.join(" ")).toContain("legacy tool");
  });
});

describe("waiting_on_you: stop", () => {
  test("a rejection after an agreement stops every session of the author's voice and every session that decided on it", async () => {
    const { j, a, b, c, sa, sb, sc } = trio();
    const kid = j.start("alpha/kid", { parent_session_id: a.session.id, parent_attested: true });
    const sk = j.serve(kid);
    const opened = await ok(sa, "collab_propose", TERMS);
    const id = opened.ids.proposal as string;
    await ok(sb, "collab_note", { act: "support", text: "Yes.", re: id });
    await ok(sc, "collab_note", { act: "support", text: "Yes.", re: id });
    agree(j, id);
    const recordDecision = (await ok(sa, "collab_inbox", {})).waiting_on_you.find((entry: any) => entry.what === "record_decision");
    // A template to say, not a ready call: sent as given, a stand-in text would be the decision.
    expect(recordDecision.next).toEqual({
      say: `The person agreed to ${handleOf("proposal", id)}. Record what is decided, within the agreed extent: ` +
        `collab_note {act: "decide", re: "${id}", text: "<what is decided>"}.`,
    });
    await ok(sc, "collab_note", { act: "decide", text: "Charlie proceeds.", re: id });
    await ok(sb, "collab_note", { act: "relay_rejection", text: "The person said stop.", re: id });
    const stopFor = async (server: unknown) => (await ok(server, "collab_inbox", {})).waiting_on_you.find((entry: any) => entry.what === "stop");
    for (const server of [sa, sk, sc]) {
      expect(await stopFor(server)).toMatchObject({ what: "stop", id, by: "relayed_by_session", due: "now" });
    }
    // A supporter that decided nothing is not told to stop work it never started.
    expect(await stopFor(sb)).toBeUndefined();
    expect(events(j)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// What a decision rests on is the journal's, never its evidence's

function agreedEventId(j: Journal, proposalId: string): string {
  return (j.store.db.query(`SELECT id FROM events WHERE type = 'proposal.agreed' AND entity_id = ? ORDER BY sequence DESC`)
    .get(proposalId) as { id: string }).id;
}

describe("a decision that names no proposal", () => {
  test("never rests on the person's agreement, whatever its evidence cites", async () => {
    const { j, sa, sb, sc } = trio();
    const opened = await ok(sa, "collab_propose", TERMS);
    const id = opened.ids.proposal as string;
    await ok(sb, "collab_note", { act: "support", text: "Yes.", re: id });
    await ok(sc, "collab_note", { act: "support", text: "Yes.", re: id });
    agree(j, id);
    const decided = await ok(sb, "collab_note", {
      act: "decide",
      text: "We go ahead across the repository.",
      extent: "the whole repository",
      evidence: [`report:${id}`, `event:${agreedEventId(j, id)}`],
    });
    expect(j.report(decided.ids.report)).toMatchObject({ authority_scope: "the whole repository", authority_basis: NOTE_SELF_DECISION_BASIS });
    const record = await ok(sc, "collab_inbox", { about: decided.ids.report });
    expect(record.rests_on).toEqual({ proposal: null, person_act: null, note: NOTE_SELF_DECISION_BASIS });
    expect(record.agreement_current).toBeNull();
    expect(record.proposal_position).toBeUndefined();
    const carried = await ok(sc, "collab_inbox", { about: decided.ids.report, format: "note" });
    expect(carried.note).not.toContain("rests on proposal:");
    expect(carried.note).not.toContain("agreement_current");
    expect(carried.note).toContain("not the person's agreement");
    expect(parseNote(carried.note).trailers.some((trailer) => trailer.key === "Sha256")).toBe(false);
  });

  test("a decide on a plain finding that cites a proposal does not rest on it, and does not stand in for a decision on it", async () => {
    const { j, sa, sb, sc } = trio();
    const opened = await ok(sa, "collab_propose", TERMS);
    const id = opened.ids.proposal as string;
    await ok(sb, "collab_note", { act: "support", text: "Yes.", re: id });
    await ok(sc, "collab_note", { act: "support", text: "Yes.", re: id });
    agree(j, id);
    const finding = await ok(sa, "collab_note", { text: "A finding." });
    const decided = await ok(sb, "collab_note", { act: "decide", text: "Proceed on the finding.", re: finding.ids.report, evidence: [`report:${id}`] });
    const record = await ok(sc, "collab_inbox", { about: decided.ids.report });
    expect(record.rests_on.proposal).toBeNull();
    expect(record.agreement_current).toBeNull();
    // The author's own decision that only cites the proposal is not a decision on it.
    await ok(sa, "collab_note", { act: "decide", text: "I note the agreement.", evidence: [`report:${id}`] });
    const waiting = (await ok(sa, "collab_inbox", {})).waiting_on_you;
    expect(waiting.find((entry: any) => entry.what === "record_decision")).toMatchObject({ id });
  });

  test("a decide on the proposal itself still rests on the person's act, whatever else its evidence cites", async () => {
    const { j, sa, sb, sc } = trio();
    const opened = await ok(sa, "collab_propose", TERMS);
    const id = opened.ids.proposal as string;
    const other = await ok(sa, "collab_propose", { ...TERMS, question: "Another question?" });
    for (const proposal of [id, other.ids.proposal]) {
      await ok(sb, "collab_note", { act: "support", text: "Yes.", re: proposal });
      await ok(sc, "collab_note", { act: "support", text: "Yes.", re: proposal });
    }
    const agreedOther = agree(j, other.ids.proposal);
    const status = agree(j, id);
    const decided = await ok(sb, "collab_note", {
      act: "decide",
      text: "We keep trailing tabs.",
      re: id,
      evidence: [`report:${other.ids.proposal}`, `event:${agreedEventId(j, other.ids.proposal)}`],
    });
    const record = await ok(sc, "collab_inbox", { about: decided.ids.report });
    expect(record.rests_on.proposal.id).toBe(id);
    expect(record.rests_on.person_act.id).toBe(status.agreement!.id);
    expect(record.rests_on.person_act.id).not.toBe(agreedOther.agreement!.id);
    expect(record.agreement_current).toBe(true);
  });
});

describe("a legacy decision", () => {
  test("its free authority text travels labelled as not checked, beside the agreed extent it does not match", async () => {
    const { j, a, sa, sb, sc } = trio();
    const opened = await ok(sa, "collab_propose", TERMS);
    const id = opened.ids.proposal as string;
    await ok(sb, "collab_note", { act: "support", text: "Yes.", re: id });
    await ok(sc, "collab_note", { act: "support", text: "Yes.", re: id });
    agree(j, id);
    const legacy = j.store.appendReportForSession({
      ...a.credential,
      idempotency_key: "forged",
      kind: "decision",
      body: "The person agreed to all of it.",
      evidence_refs: [`report:${id}`, `event:${agreedEventId(j, id)}`],
      authority_scope: "everything in every repository",
      authority_basis: "person agreed by controlling_terminal to everything",
    });
    const record = await ok(sb, "collab_inbox", { about: legacy.id });
    expect(record.authority).toMatchObject({
      scope: "everything in every repository",
      derived_by: "a legacy tool, as its caller wrote it; not checked",
      scope_matches_agreed_extent: false,
    });
    expect(record.agreement_current).toBe(true);
    expect(record.advice.join(" ")).toContain(`is not the extent the person agreed to on ${id}`);
    const carried = await ok(sb, "collab_inbox", { about: legacy.id, format: "note" });
    const parsed = parseNote(carried.note);
    expect(parsed.extent).toBe("as written by a legacy tool; not checked: everything in every repository");
    const position = parsed.trailers.find((trailer) => trailer.key === "Position")!.value;
    expect(position).toBe(`outcome unstated; legacy; authority not checked; cites proposal:${id}; agreement_current true; scope is not the agreed extent`);
    expect(carried.note).not.toContain("rests on proposal:");
  });

  test("a legacy decision whose scope is the agreed extent says so, and is still labelled not checked", async () => {
    const { j, a, sa, sb, sc } = trio();
    const opened = await ok(sa, "collab_propose", TERMS);
    const id = opened.ids.proposal as string;
    await ok(sb, "collab_note", { act: "support", text: "Yes.", re: id });
    await ok(sc, "collab_note", { act: "support", text: "Yes.", re: id });
    agree(j, id);
    const legacy = j.store.appendReportForSession({
      ...a.credential,
      idempotency_key: "legacy-exact",
      kind: "decision",
      body: "We keep trailing tabs.",
      evidence_refs: [`report:${id}`, `event:${agreedEventId(j, id)}`],
      authority_scope: TERMS.extent,
      authority_basis: "the person agreed",
    });
    const record = await ok(sb, "collab_inbox", { about: legacy.id });
    expect(record.authority.scope_matches_agreed_extent).toBe(true);
    const position = parseNote((await ok(sb, "collab_inbox", { about: legacy.id, format: "note" })).note)
      .trailers.find((trailer) => trailer.key === "Position")!.value;
    expect(position).toBe(`outcome unstated; legacy; authority not checked; cites proposal:${id}; agreement_current true`);
  });
});

describe("collab_propose: closes as an ISO time", () => {
  test("a lost-response retry replays after the clock passes the floor, and even the close itself", async () => {
    const { j, sa } = trio();
    j.write("src/a.ts", "a\n");
    const now = Date.parse(j.store.noteNow());
    const input = { ...TERMS, closes: new Date(now + 15 * MINUTE).toISOString(), evidence: ["file src/a.ts"] };
    const first = await ok(sa, "collab_propose", input);
    expect(first.closes_at).toBe(input.closes);
    const before = j.count();
    for (const wait of [6 * MINUTE, 10 * MINUTE]) {
      j.advance(wait);
      const retry = await ok(sa, "collab_propose", input);
      expect(retry).toMatchObject({ replayed: true, ids: { proposal: first.ids.proposal } });
      expect(retry.effect).toStartWith("Replayed: nothing new was written.");
      expect(j.count()).toBe(before);
    }
    expect(j.events().filter((event) => event.type === "proposal.opened")).toHaveLength(1);
  });

  test("an ISO time out of range on the first call is refused before anything is written", async () => {
    const { j, sa } = trio();
    j.write("src/a.ts", "a\n");
    const now = Date.parse(j.store.noteNow());
    const before = j.count();
    const past = await refused(sa, "collab_propose", { ...TERMS, closes: new Date(now - 1_000).toISOString(), evidence: ["file src/a.ts"] });
    expect(past).toMatchObject({ code: "invalid_closes", remedy: { tool: "collab_propose", input: { closes: 600 } } });
    const soon = await refused(sa, "collab_propose", { ...TERMS, closes: new Date(now + 5 * MINUTE).toISOString() });
    expect(soon.code).toBe("invalid_closes");
    expect(j.count()).toBe(before);
  });
});

describe("collab_propose: the returned note", () => {
  test("keeps every term when its lines need trimming, and says so", async () => {
    const j = journal();
    const a = j.start("alpha");
    j.start("bravo");
    const result = await ok(j.serve(a), "collab_propose", {
      question: "Keep tabs?",
      criteria: "First criterion.\n\nSecond criterion, after a blank line.",
      extent: "note.ts only.\n\nAnd its tests.",
      limits: "Not the tokenizer.",
    });
    const parsed = parseNote(result.note);
    expect(parsed).toMatchObject({ act: "propose", extent: "note.ts only.\nAnd its tests.", limits: "Not the tokenizer." });
    expect(parsed.trailers).toEqual([
      { key: "Sha256", value: result.proposal_sha256 },
      { key: "Criteria", value: "First criterion.\nSecond criterion, after a blank line." },
    ]);
    expect(result.not_in_note).toBeUndefined();
    expect(result.advice.join(" ")).toContain("blank lines dropped");
    // The proposal keeps its bytes.
    expect(result.status.terms.extent).toBe("note.ts only.\n\nAnd its tests.");
  });

  test("names each part it leaves out, and where the whole proposal is kept", async () => {
    const j = journal();
    const a = j.start("alpha");
    j.start("bravo");
    const criteria = "Each criterion is checked. ".repeat(50).trim();
    const result = await ok(j.serve(a), "collab_propose", { ...TERMS, criteria, limits: "Not the tokenizer." });
    const parsed = parseNote(result.note);
    expect(parsed).toMatchObject({ extent: TERMS.extent, limits: "Not the tokenizer." });
    expect(parsed.trailers).toEqual([{ key: "Sha256", value: result.proposal_sha256 }]);
    expect(result.not_in_note).toEqual(["criteria"]);
    const said = result.advice.join(" ");
    expect(said).toContain("leaves out criteria");
    expect(said).toContain(`collab_inbox about ${result.ids.proposal}`);
  });
});

describe("the decision record after the proposal is withdrawn", () => {
  test("names the withdrawal, not a later person act", async () => {
    const { j, sa, sb, sc } = trio();
    const opened = await ok(sa, "collab_propose", TERMS);
    const id = opened.ids.proposal as string;
    await ok(sb, "collab_note", { act: "support", text: "Yes.", re: id });
    await ok(sc, "collab_note", { act: "support", text: "Yes.", re: id });
    agree(j, id);
    const decided = await ok(sb, "collab_note", { act: "decide", text: "Proceed.", re: id });
    const withdrawal = await ok(sa, "collab_note", { act: "withdraw", text: "Withdrawn.", re: id });
    const record = await ok(sc, "collab_inbox", { about: decided.ids.report });
    expect(record.agreement_current).toBe(false);
    expect(record.later_act).toBeUndefined();
    const said = record.advice.join(" ");
    expect(said).toContain(`${id} was withdrawn by ${withdrawal.ids.report} after the agreement`);
    expect(said).not.toContain("is not the agreement this decision cites");
    expect(said).toContain("Stop work");
  });
});

describe("collab_propose replaces, twice", () => {
  test("an objection the replaced proposal carried as text is carried again, while it stands", async () => {
    const j = journal();
    const a = j.start("alpha");
    const b = j.start("bravo");
    const [sa, sb] = [j.serve(a), j.serve(b)];
    const p1 = await ok(sa, "collab_propose", TERMS);
    const objection = await ok(sb, "collab_note", { act: "challenge", text: "No: tabs are data.", re: p1.ids.proposal });
    const line = `carried objection by bravo (report:${objection.ids.report}): No: tabs are data.`;
    const p2 = await ok(sa, "collab_propose", { ...TERMS, question: "Revised?", replaces: p1.ids.proposal });
    expect((p2.status as ProposalStatus).terms.known_conflicts).toBe(line);
    const p3 = await ok(sa, "collab_propose", { ...TERMS, question: "Revised again?", replaces: p2.ids.proposal });
    expect((p3.status as ProposalStatus).terms.known_conflicts).toBe(line);
    expect(p3.carried_objections).toEqual([
      expect.objectContaining({ challenge: objection.ids.report, carried_in_terms: true, counted_by_consent_v1: false }),
    ]);
    expect(p3.objectors).toEqual([expect.objectContaining({ name: "bravo", reached: true, challenges: [objection.ids.report] })]);
    // Lifted by its challenger, it is carried no further.
    await ok(sb, "collab_note", { act: "resolve", text: "Answered.", re: objection.ids.report });
    const p4 = await ok(sa, "collab_propose", { ...TERMS, question: "Revised a third time?", replaces: p3.ids.proposal });
    expect((p4.status as ProposalStatus).terms.known_conflicts).toBeNull();
  });
});

describe("the carrying render of a proposal whose question names a local detail", () => {
  test("still carries its full id, hash and position under a neutral statement, and names what it withheld", async () => {
    const j = journal();
    const a = j.start("alpha");
    const server = j.serve(a);
    const opened = await ok(server, "collab_propose", {
      question: "Should we edit /Users/example/repo/src/a.ts?\n\nThe parser keeps tabs.",
      criteria: "Tests pass in /Users/example/repo.",
      extent: "Only /Users/example/repo/src/a.ts.",
    });
    const carried = await ok(server, "collab_inbox", { about: opened.ids.proposal, format: "note" });
    const note = carried.note as string;
    expect(note.length).toBeLessThanOrEqual(800);
    expect(note).not.toContain("/Users/");
    const parsed = parseNote(note);
    expect(parsed).toMatchObject({ act: "propose", statement: "A proposal; read it by its full id.", re: `proposal:${opened.ids.proposal}` });
    expect(parsed.trailers).toEqual(expect.arrayContaining([{ key: "Sha256", value: opened.proposal_sha256 }]));
    expect(parsed.trailers.some((trailer) => trailer.key === "Position")).toBe(true);
    expect(carried.not_carried).toEqual(expect.arrayContaining(["statement (local detail)", "extent (local detail)"]));
    expect(note).toContain("Not-carried: statement (local detail)");
  });
});

// ---------------------------------------------------------------------------
// Settled after the stage 3 verification

describe("carried objections at any count, and along the whole lineage", () => {
  test("one voice with 17 carried challenges is told in one note within the caps, and a lost-response retry replays", async () => {
    const { j, b, sa, sb } = trio();
    const p1 = await ok(sa, "collab_propose", TERMS);
    const raised: string[] = [];
    for (let index = 0; index < 17; index += 1) {
      raised.push((await ok(sb, "collab_note", { act: "challenge", text: `No, reason ${index}.`, re: p1.ids.proposal })).ids.report);
    }
    const input = { ...TERMS, question: "Revised?", replaces: p1.ids.proposal };
    const replaced = await ok(sa, "collab_propose", input);
    expect(j.events().filter((event) => event.type === "proposal.opened")).toHaveLength(2);
    expect(replaced.ids.objector_notes).toEqual([{ report: expect.any(String), to: { id: b.session.id, name: "bravo" } }]);
    const told = j.report(replaced.ids.objector_notes[0].report);
    const parsed = parseNote(told.body);
    expect(parsed.evidence).toHaveLength(16);
    expect(parsed.evidence[0]).toBe(`report:${replaced.ids.proposal}`);
    expect(parsed.statement).toContain("17 objections");
    // The two past the Evidence lines are named in the body; the refs hold every one.
    for (const id of raised.slice(15)) expect(parsed.body).toContain(`report:${id}`);
    expect(JSON.parse(told.evidence_refs_json).sort())
      .toEqual([`report:${replaced.ids.proposal}`, ...raised.map((id) => `report:${id}`)].sort());
    const before = j.count();
    const retry = await ok(sa, "collab_propose", input);
    expect(retry).toMatchObject({ replayed: true, ids: { proposal: replaced.ids.proposal, objector_notes: replaced.ids.objector_notes } });
    expect(j.count()).toBe(before);
  });

  test("an objector who objects again on every revision is told on every one", async () => {
    const { j, sa, sb } = trio();
    let current = (await ok(sa, "collab_propose", TERMS)).ids.proposal as string;
    for (let round = 1; round <= 18; round += 1) {
      await ok(sb, "collab_note", { act: "challenge", text: `Still no (${round}).`, re: current });
      const next = await ok(sa, "collab_propose", { ...TERMS, question: `Revision ${round}?`, replaces: current });
      expect(next.ids.objector_notes).toHaveLength(1);
      expect(next.objectors[0].challenges).toHaveLength(round);
      current = next.ids.proposal;
    }
    expect(j.events().filter((event) => event.type === "proposal.opened")).toHaveLength(19);
  });

  test("a stop after the open, then the same call: the open is replayed and each objector is told once", async () => {
    const { j, sa, sb } = trio();
    const p1 = await ok(sa, "collab_propose", TERMS);
    await ok(sb, "collab_note", { act: "challenge", text: "No: tabs are data.", re: p1.ids.proposal });
    const append = j.store.appendNoteForSession.bind(j.store);
    let failures = 1;
    (j.store as any).appendNoteForSession = (input: any) => {
      if (failures-- > 0) throw new CollabError("worktree_observation_stale", "The registered worktree changed after it was inspected");
      return append(input);
    };
    const input = { ...TERMS, question: "Revised?", replaces: p1.ids.proposal };
    const stopped = await refused(sa, "collab_propose", input);
    const opened = j.events().filter((event) => event.type === "proposal.opened");
    expect(opened).toHaveLength(2);
    expect(stopped.recorded_steps).toEqual([expect.objectContaining({ step: 2, id: opened[1]!.entity_id })]);
    const resumed = await ok(sa, "collab_propose", input);
    expect(resumed.ids.proposal).toBe(opened[1]!.entity_id);
    expect(j.events().filter((event) => event.type === "proposal.opened")).toHaveLength(2);
    const notes = j.events().filter((event) => event.type === "report.posted" && event.payload.about_proposal_id === resumed.ids.proposal);
    expect(notes).toHaveLength(1);
    expect(resumed.ids.objector_notes).toEqual([{ report: notes[0]!.entity_id, to: expect.objectContaining({ name: "bravo" }) }]);
  });

  test("an objection a legacy replacement shed is listed as shed, and the next replacement carries it", async () => {
    const { j, a, b, sa, sb } = trio();
    const p1 = await ok(sa, "collab_propose", TERMS);
    const objection = await ok(sb, "collab_note", { act: "challenge", text: "No: tabs are data.", re: p1.ids.proposal });
    const legacy = (key: string, question: string, supersedes: string) => ok(sa, "collab_proposal_open", {
      workspace_id: a.workspace.id, idempotency_key: key, question, criteria: TERMS.criteria, extent: TERMS.extent, supersedes_report_id: supersedes,
    });
    const p2 = (await legacy("legacy-2", "Revised?", p1.ids.proposal)).proposal.proposal.id as string;
    const p3 = (await legacy("legacy-3", "Revised again?", p2)).proposal.proposal.id as string;
    // Two legacy replacements on, the objection still stands where it was raised, and the view says so.
    const shedView = await ok(sb, "collab_inbox", { about: p3 });
    expect(shedView.carried_objections).toEqual([
      expect.objectContaining({ challenge: objection.ids.report, raised_on: p1.ids.proposal, carried_in_terms: false, standing_on_replaced: true }),
    ]);
    expect(shedView.advice.join(" ")).toContain(objection.ids.report);
    const p4 = await ok(sa, "collab_propose", { ...TERMS, question: "Fourth?", replaces: p3 });
    expect(p4.status.terms.known_conflicts).toContain(`report:${objection.ids.report}`);
    expect(p4.objectors).toEqual([expect.objectContaining({ voice: b.session.id, challenges: [objection.ids.report], reached: true })]);
    const view = await ok(sb, "collab_inbox", { about: p4.ids.proposal });
    expect(view.carried_objections).toEqual([
      expect.objectContaining({ challenge: objection.ids.report, carried_in_terms: true, counted_by_consent_v1: false }),
    ]);
    void j;
  });
});

describe("what waits on the author after a decision", () => {
  test("a do_not_proceed recorded before the agreement does not hide record_decision", async () => {
    const { j, sa, sb, sc } = trio();
    const id = (await ok(sa, "collab_propose", TERMS)).ids.proposal as string;
    await ok(sb, "collab_note", { act: "support", text: "Yes.", re: id });
    await ok(sc, "collab_note", { act: "support", text: "Yes.", re: id });
    await ok(sa, "collab_note", { act: "decide", outcome: "do_not_proceed", text: "Not yet.", re: id });
    agree(j, id);
    for (let call = 0; call < 2; call += 1) {
      const waiting = (await ok(sa, "collab_inbox", {})).waiting_on_you;
      expect(waiting.map((entry: any) => [entry.what, entry.id])).toContainEqual(["record_decision", id]);
    }
    await ok(sa, "collab_note", { act: "decide", text: "We keep tabs.", re: id });
    expect((await ok(sa, "collab_inbox", {})).waiting_on_you.find((entry: any) => entry.what === "record_decision")).toBeUndefined();
  });

  test("agree, decide, reject, agree again: record_decision returns, and the record says a new decide is needed", async () => {
    const { j, sa, sb, sc } = trio();
    const id = (await ok(sa, "collab_propose", TERMS)).ids.proposal as string;
    await ok(sb, "collab_note", { act: "support", text: "Yes.", re: id });
    await ok(sc, "collab_note", { act: "support", text: "Yes.", re: id });
    const first = agree(j, id);
    const decided = await ok(sa, "collab_note", { act: "decide", text: "We keep tabs.", re: id });
    const rejected = rejectAtTerminal(j, id, "Wait.");
    const again = agree(j, id);
    const waiting = (await ok(sa, "collab_inbox", {})).waiting_on_you;
    expect(waiting.map((entry: any) => entry.what)).toEqual(["record_decision"]);
    const record = await ok(sb, "collab_inbox", { about: decided.ids.report });
    expect(record.agreement_current).toBe(false);
    expect(record.rests_on.person_act.id).toBe(first.agreement!.id);
    // later_act is the rejection that undid it; the agreement given since is shown apart.
    expect(record.later_act).toMatchObject({ id: rejected.person.acts.at(-1)!.id, act: "reject" });
    expect(record.latest_act).toMatchObject({ id: again.agreement!.id, act: "agree" });
    const said = record.advice.join(" ");
    expect(said).toContain("agreed again on the same bytes");
    expect(said).toContain(`record a new decide on ${id}`);
    expect(said).not.toContain("Stop work");
  });

  test("agree, decide, reject: the record names the rejection and says stop", async () => {
    const { j, sa, sb, sc } = trio();
    const id = (await ok(sa, "collab_propose", TERMS)).ids.proposal as string;
    await ok(sb, "collab_note", { act: "support", text: "Yes.", re: id });
    await ok(sc, "collab_note", { act: "support", text: "Yes.", re: id });
    agree(j, id);
    const decided = await ok(sa, "collab_note", { act: "decide", text: "We keep tabs.", re: id });
    const rejected = rejectAtTerminal(j, id, "Wait.");
    const record = await ok(sb, "collab_inbox", { about: decided.ids.report });
    expect(record.later_act).toMatchObject({ id: rejected.person.acts.at(-1)!.id, act: "reject" });
    expect(record.latest_act).toBeUndefined();
    expect(record.advice.join(" ")).toContain("a rejection");
    expect(record.advice.join(" ")).toContain("Stop work that rests on this decision.");
  });
});

describe("a decision's authority says who fixed what", () => {
  test("without a proposal, the scope is the session's own words and is never labelled as the journal's", async () => {
    const { sa } = trio();
    const decided = await ok(sa, "collab_note", { act: "decide", text: "We go ahead.", extent: "the whole repository, as the person said" });
    expect(decided.authority.scope).toBe("the whole repository, as the person said");
    expect(decided.authority.derived_by).not.toContain("from the journal");
    expect(decided.authority.derived_by).toContain("this session's own extent");
    const record = await ok(sa, "collab_inbox", { about: decided.ids.report });
    expect(record.authority.derived_by).not.toContain("from the journal");
    expect(record.authority.derived_by).toContain("the server fixed only the basis");
    expect(record.rests_on_basis).toBe("no proposal: this decision rests only on this session's word");
  });

  test("on an agreed proposal, the scope is the journal's", async () => {
    const { j, sa, sb, sc } = trio();
    const id = (await ok(sa, "collab_propose", TERMS)).ids.proposal as string;
    await ok(sb, "collab_note", { act: "support", text: "Yes.", re: id });
    await ok(sc, "collab_note", { act: "support", text: "Yes.", re: id });
    agree(j, id);
    const decided = await ok(sa, "collab_note", { act: "decide", text: "We keep tabs.", re: id });
    expect(decided.authority.derived_by).toBe("the server, from the journal, inside the write");
    const record = await ok(sb, "collab_inbox", { about: decided.ids.report });
    expect(record.authority.derived_by).toBe("the server, from the journal, when it was written");
    expect(record.rests_on_basis).toContain("derived from the journal");
  });
});

describe("ready calls a decide or a propose refusal gives", () => {
  test("an Extent: line in a decide note is answered with the note without it, and that call works", async () => {
    const { j, sa, sb, sc } = trio();
    const id = (await ok(sa, "collab_propose", TERMS)).ids.proposal as string;
    await ok(sb, "collab_note", { act: "support", text: "Yes.", re: id });
    await ok(sc, "collab_note", { act: "support", text: "Yes.", re: id });
    agree(j, id);
    const proceed = await refused(sb, "collab_note", { text: `decide: Go.\n\nRe: proposal:${id}\nExtent: everything` });
    expect(proceed.code).toBe("extent_from_proposal");
    expect(proceed.remedy.input.text).not.toContain("Extent:");
    const decided = await ok(sb, "collab_note", proceed.remedy.input);
    expect(j.report(decided.ids.report).authority_scope).toBe(TERMS.extent);
    const stop = await refused(sc, "collab_note", { text: `decide: No.\n\nRe: proposal:${id}\nExtent: everything`, outcome: "do_not_proceed" });
    expect(stop.code).toBe("extent_not_used");
    expect(stop.remedy.input).toMatchObject({ outcome: "do_not_proceed" });
    expect((await ok(sc, "collab_note", stop.remedy.input)).outcome).toBe("do_not_proceed");
  });

  test("act propose in collab_note points at collab_propose without stand-in terms", async () => {
    const { j, sa } = trio();
    const wrong = await refused(sa, "collab_note", { act: "propose", text: "Should we ship?" });
    expect(wrong.code).toBe("wrong_verb");
    expect(wrong.remedy).toEqual({ tool: "collab_propose", input: { question: "Should we ship?" } });
    const before = j.count();
    // Sent as given, it asks for the terms instead of opening a proposal on placeholders.
    const sent = await refused(sa, wrong.remedy.tool, wrong.remedy.input);
    expect(sent.code).toBe("invalid_criteria");
    expect(j.count()).toBe(before);
  });
});
