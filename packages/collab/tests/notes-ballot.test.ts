import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  BALLOT_AUTHORISES,
  BALLOT_SAME_FAMILY_NOTE,
  BALLOT_SEALING,
  BALLOT_SPLIT_NOTE,
  BALLOT_TIE_NEXT,
  MAX_REVEALED_ENTRY_BYTES,
  revealedEntryBytes,
  type RevealedEntry,
} from "../src/ballot.js";
import { writeSealFile } from "../src/ballot-seal.js";
import { pollNote } from "../src/ballot-verbs.js";
import { canonicalJson } from "../src/canonical.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import { parseNote } from "../src/note.js";
import type { SessionHandle } from "../src/protocol.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { CollabStore } from "../src/store.js";
import { base32, FOLDED_LINE, NOTE_CAPABILITIES } from "../src/verbs.js";
import { cleanup, journal, ok, refused, runCleanup, type Journal } from "./notes-helpers.js";

// collab_poll and collab_vote (Collab Notes spec 5.7, 5.8 and 7): the
// electorate, units, sealing, the lazy reveal, the result, and the ballot
// parts of collab_inbox and collab_arrive.

afterEach(runCleanup);

const MINUTE = 60_000;
const OPTIONS = [
  { key: "keep", label: "Keep one table" },
  { key: "split", label: "Split it per workspace" },
  { key: "drop", label: "Drop the cache" },
];

type Voter = { handle: SessionHandle; server: any; name: string };

/** Sessions that have used the notes surface (a read mark), each served by its own MCP process. */
async function voters(j: Journal, names: string[], extra: (name: string) => Record<string, unknown> = () => ({})): Promise<Voter[]> {
  const out: Voter[] = [];
  for (const name of names) {
    const handle = j.start(name, extra(name));
    const server = j.serve(handle);
    await ok(server, "collab_inbox");
    out.push({ handle, server, name });
  }
  return out;
}

async function poll(opener: Voter, extra: Record<string, unknown> = {}) {
  return ok(opener.server, "collab_poll", { question: "Which cache layout should the store use?", options: OPTIONS, closes: "30m", criteria: "Fewest writes per open.", ...extra });
}

function sealDir(j: Journal, ballotId: string): string {
  return join(realpathSync(join(j.directory, "state")), "collab-ballots", ballotId);
}

function sealFiles(j: Journal, ballotId: string): string[] {
  const dir = sealDir(j, ballotId);
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function revealed(j: Journal, ballotId: string): RevealedEntry[] {
  return j.events().filter((event) => event.type === "ballot.revealed" && event.entity_id === ballotId).map((event) => event.payload as RevealedEntry);
}

function closedCount(j: Journal, ballotId: string): number {
  return j.events().filter((event) => event.type === "ballot.closed" && event.entity_id === ballotId).length;
}

async function about(voter: Voter, ballotId: string) {
  return ok(voter.server, "collab_inbox", { about: ballotId });
}

/** Every row of every table, as text, keyed by table. */
function dump(store: CollabStore): Map<string, Set<string>> {
  const tables = (store.db.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>)
    .map((row) => row.name);
  return new Map(tables.map((table) => [table, new Set((store.db.query(`SELECT * FROM "${table}"`).all() as unknown[]).map((row) => JSON.stringify(row)))]));
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const shaB32 = (text: string) => base32(createHash("sha256").update(text).digest());

describe("collab_poll: the electorate (spec 7)", () => {
  test("by default: active sessions seen in 30 minutes with a read mark, plus the opener; left_out lists the rest that are live", async () => {
    const j = journal();
    const stale = j.start("seen-7h-ago");
    j.advance(6 * 60 * MINUTE + 20 * MINUTE);
    const [quiet] = await voters(j, ["seen-40m-ago"]);
    j.advance(40 * MINUTE);
    const [opener, peer] = await voters(j, ["opener", "peer"]);
    const unmarked = j.start("no-read-mark");
    const ended = await voters(j, ["ended"]);
    j.store.endSessionWithReleases({ ...ended[0]!.handle.credential, reason: "done", release_leases: true });
    // The opener has a read mark too, but is listed whatever it has.
    const opened = await poll(opener!);
    expect(opened.chosen_by).toBe("default");
    expect(opened.electorate.map((unit: any) => unit.names[0]).sort()).toEqual(["opener", "peer"]);
    expect(opened.left_out.map((entry: any) => [entry.name, entry.last_seen_minutes]).sort()).toEqual([
      ["no-read-mark", 0],
      ["seen-40m-ago", 40],
    ]);
    expect(opened.left_out.map((entry: any) => entry.session_id)).not.toContain(stale.session.id);
    expect(opened.left_out.map((entry: any) => entry.session_id)).toContain(unmarked.session.id);
    expect(opened.left_out.map((entry: any) => entry.session_id)).toContain(quiet!.handle.session.id);
    // The same lists are in ballot.opened, with the electorate's hash.
    const event = j.events().find((row) => row.type === "ballot.opened")!;
    expect(event.entity_id).toBe(opened.ballot);
    expect(event.payload.chosen_by).toBe("default");
    expect(event.payload.left_out).toEqual(opened.left_out);
    expect(event.payload.electorate_sha256).toBe(sha(canonicalJson(event.payload.electorate)));
    expect(event.payload.opener_session_id).toBe(opener!.handle.session.id);
    // The poll report: an observation that informs, marked, whose body is the poll note of the same terms.
    const report = j.report(opened.ballot);
    expect([report.kind, report.relation, report.target_report_id]).toEqual(["observation", "informs", null]);
    expect(j.payload(opened.ballot).note).toBe("collab-note/1");
    expect(report.body).toBe(opened.note);
    expect(report.body).toBe(pollNote({
      question: event.payload.question,
      options: event.payload.options,
      criteria: event.payload.criteria,
      method: event.payload.method,
      quorum: event.payload.quorum,
      closes_at: event.payload.closes_at,
      close_when_all_cast: event.payload.close_when_all_cast,
    }));
    const parsed = parseNote(report.body);
    expect(parsed.act).toBe("poll");
    expect(parsed.trailers.filter((trailer) => trailer.key === "Option").map((trailer) => trailer.value))
      .toEqual(OPTIONS.map((option) => `${option.key} — ${option.label}`));
    expect(parsed.trailers.find((trailer) => trailer.key === "Closes")!.value).toBe(event.payload.closes_at);
    expect(parsed.body).toContain("Criteria:\nFewest writes per open.");
    // Every ballot view lists left_out.
    expect((await about(opener!, opened.ballot)).ballot.left_out).toEqual(opened.left_out);
    expect(opened.unit_basis).toContain("2 of 2 units declared no handle and are counted per lineage");
    expect(opened.sealing).toBe(BALLOT_SEALING);
  });

  test("voters chosen by the opener are exactly those sessions, recorded as chosen_by opener", async () => {
    const j = journal();
    const [opener, b, c] = await voters(j, ["opener", "b", "c"]);
    const opened = await poll(opener!, { voters: ["b", c!.handle.session.id] });
    expect(opened.chosen_by).toBe("opener");
    expect(opened.electorate.map((unit: any) => unit.names[0]).sort()).toEqual(["b", "c"]);
    expect(opened.left_out.map((entry: any) => entry.name)).toEqual(["opener"]);
    expect(j.events().find((row) => row.type === "ballot.opened")!.payload.chosen_by).toBe("opener");
    // The opener is not listed, so its cast is revealed and never counted.
    const cast = await ok(opener!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    expect(cast.counts_as).toBe("late");
    const unknown = await refused(opener!.server, "collab_poll", {
      question: "Which?", options: OPTIONS, closes: "30m", voters: ["nobody-here"],
    });
    expect(unknown.code).toBe("session_not_found");
    expect(unknown.remedy.say).toContain("Name each voter");
    expect(b).toBeDefined();
  });

  test("fewer than 2 units is electorate_too_small; more than 16 is electorate_too_large with a ready call", async () => {
    const j = journal();
    const [alone] = await voters(j, ["alone"]);
    const small = await refused(alone!.server, "collab_poll", { question: "Which?", options: OPTIONS, closes: "30m" });
    expect(small.code).toBe("electorate_too_small");
    // An agent alone is told the electorate is fixed at the open, so it does not wait inside a poll that cannot start.
    expect(small.message).toContain("fixed when the ballot opens");
    expect(small.remedy.say).toContain("once another agent has arrived");
    expect(small.remedy.say).toContain("collab_note");
    expect(small.remedy.say).toContain("collab_propose");
    const others = Array.from({ length: 16 }, (_, index) => j.start(`voter-${index}`));
    for (const [index, other] of others.entries()) {
      j.advance(1_000);
      j.store.initNoteMark(other.credential, 0);
      j.store.db.query(`UPDATE coordination_sessions SET last_seen_at = ? WHERE id = ?`).run(new Date(Date.parse(j.now()) - index * 1_000).toISOString(), other.session.id);
    }
    const before = j.count();
    const large = await refused(alone!.server, "collab_poll", { question: "Which?", options: OPTIONS, closes: "30m" });
    expect(large.code).toBe("electorate_too_large");
    expect(j.count()).toBe(before);
    expect(large.remedy.tool).toBe("collab_poll");
    expect(large.remedy.input.question).toBe("Which?");
    expect(large.remedy.input.voters).toHaveLength(16);
    // The remedy works as given.
    const opened = await ok(alone!.server, large.remedy.tool, large.remedy.input);
    expect(opened.chosen_by).toBe("opener");
    expect(opened.electorate).toHaveLength(16);
  });

  test("a store with no file path refuses collab_poll", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agenttool-collab-ballot-memory-"));
    mkdirSync(join(directory, "repo"));
    const store = new CollabStore(":memory:");
    cleanup.push(() => {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    });
    const serve = (actor: string) => {
      const handle = store.startSession({ root_path: join(directory, "repo"), actor });
      const file = writeSessionCredentialFile(join(directory, "sessions", `${handle.session.id}.json`), handle.credential);
      return buildCollabMcpServer(store, { environment: {}, resumed_session: { handle, credential_file: file } });
    };
    const a = serve("a");
    await ok(serve("b"), "collab_inbox");
    const before = (store.db.query(`SELECT COUNT(*) AS count FROM events`).get() as { count: number }).count;
    const refusal = await refused(a, "collab_poll", { question: "Which?", options: OPTIONS, closes: "30m" });
    expect(refusal.code).toBe("ballots_need_a_file_journal");
    expect((store.db.query(`SELECT COUNT(*) AS count FROM events`).get() as { count: number }).count).toBe(before);
  });

  test("a lost-response retry of a poll replays; the same poll after a withdrawal opens a new ballot", async () => {
    const j = journal();
    const [opener] = await voters(j, ["opener", "peer"]);
    const first = await poll(opener!);
    const before = j.count();
    const again = await poll(opener!);
    expect(again.replayed).toBe(true);
    expect(again.ballot).toBe(first.ballot);
    expect(j.count()).toBe(before);
    await ok(opener!.server, "collab_note", { act: "withdraw", re: first.ballot, text: "Withdrawn: wrong options." });
    const fresh = await poll(opener!);
    expect(fresh.replayed).toBeUndefined();
    expect(fresh.ballot).not.toBe(first.ballot);
  });

  test("the same poll after its ballot has closed opens a new ballot, not a replay of the closed one", async () => {
    const j = journal();
    const [opener, peer] = await voters(j, ["opener", "peer"]);
    const first = await poll(opener!);
    j.advance(2 * 60 * MINUTE);
    await ok(peer!.server, "collab_inbox");
    expect((await about(opener!, first.ballot)).ballot.state).toBe("revealed");
    const again = await poll(opener!);
    expect(again.replayed).toBeUndefined();
    expect(again.ballot).not.toBe(first.ballot);
    expect(again.state).toBe("open");
    expect(Date.parse(again.closes_at)).toBeGreaterThan(Date.parse(j.now()));
    expect(again.effect).not.toContain("Replayed");
  });
});

describe("collab_vote: units and casts (spec 7)", () => {
  test("a late session's cast is revealed and never counted, flagged same_handle_as when it shares a unit's handle", async () => {
    const j = journal();
    const [opener, peer] = await voters(j, ["opener", "peer"], (name) => (name === "peer" ? { seat_ref: "claude-code:seat-1" } : {}));
    const opened = await poll(opener!);
    // Joins after the open, declaring the peer's handle: it does not join the peer's unit.
    const [late] = await voters(j, ["late-joiner"], () => ({ seat_ref: "claude-code:seat-1" }));
    const peerUnit = opened.electorate.find((unit: any) => unit.names[0] === "peer").unit;
    const cast = await ok(late!.server, "collab_vote", { ballot: opened.ballot, choice: ["drop"] });
    expect(cast.counts_as).toBe("late");
    expect(cast.same_handle_as).toBe(peerUnit);
    expect(cast.advice.join(" ")).toContain("never counted");
    await ok(opener!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    await ok(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    j.advance(31 * MINUTE);
    const result = (await about(opener!, opened.ballot)).ballot.result;
    expect(result.late).toEqual([expect.objectContaining({ name: "late-joiner", choice: ["drop"], same_handle_as: peerUnit })]);
    expect(result.options.find((option: any) => option.key === "drop").units).toBe(0);
    expect(result.turnout.cast).toBe(2);
    expect(result.top).toEqual(["keep"]);
  });

  test("only the voice that cast replaces its cast, a session casts at most 3 times, then cast_limit", async () => {
    const j = journal();
    const [opener, peer] = await voters(j, ["opener", "peer"]);
    const opened = await poll(opener!);
    const child = j.start("peer/child", { parent_session_id: peer!.handle.session.id, parent_attested: true });
    const childServer = j.serve(child);
    const one = await ok(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    const two = await ok(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["split"] });
    expect([one.cast_seq, two.cast_seq]).toEqual([1, 2]);
    expect(two.advice.join(" ")).toContain("This replaces your earlier cast");
    const three = await ok(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["drop"] });
    expect(three.cast_seq).toBe(3);
    const before = j.count();
    const limit = await refused(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep", "split"] });
    expect(limit.code).toBe("cast_limit");
    expect(j.count()).toBe(before);
    // The tool says the same: three casts, which is two replacements.
    expect(peer!.server._registeredTools.collab_vote.description).toContain("You may cast up to 3 times in one ballot; only your latest counts.");
    // The child shares the peer's voice, so its cast is that voice's latest, not a second voice.
    const fromChild = await ok(childServer, "collab_vote", { ballot: opened.ballot, choice: ["split"] });
    expect(fromChild.counts_as).toBe("counted");
    expect(fromChild.advice.join(" ")).not.toContain("unit_conflict");
    await ok(opener!.server, "collab_vote", { ballot: opened.ballot, choice: ["split"] });
    j.advance(31 * MINUTE);
    const result = (await about(opener!, opened.ballot)).ballot.result;
    expect(result.replaced.map((entry: any) => entry.cast_seq)).toEqual([1, 2, 3]);
    expect(result.unit_conflicts).toEqual([]);
    expect(result.options.find((option: any) => option.key === "split").voters.sort()).toEqual(["opener", "peer/child"]);
    expect(result.status).toBe("top_choice");
  });

  test("two listed voices of one unit give unit_conflict: not counted, and not toward quorum", async () => {
    const j = journal();
    const [opener, b, c] = await voters(j, ["opener", "b", "c"], (name) => (name === "opener" ? {} : { seat_ref: "codex:shared-host" }));
    const opened = await poll(opener!, { quorum: 2 });
    expect(opened.electorate).toHaveLength(2);
    expect(opened.electorate.find((unit: any) => unit.names.length === 2).names.sort()).toEqual(["b", "c"]);
    await ok(b!.server, "collab_vote", { ballot: opened.ballot, choice: ["drop"] });
    const second = await ok(c!.server, "collab_vote", { ballot: opened.ballot, choice: ["drop"] });
    expect(second.advice.join(" ")).toContain("unit_conflict");
    await ok(opener!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    j.advance(31 * MINUTE);
    const result = (await about(opener!, opened.ballot)).ballot.result;
    expect(result.unit_conflicts.map((entry: any) => entry.name).sort()).toEqual(["b", "c"]);
    expect(result.options.find((option: any) => option.key === "drop").units).toBe(0);
    expect(result.quorum).toEqual({ needed: 2, met: false, counted: 1 });
    expect(result.status).toBe("inconclusive");
    expect(result.turnout.cast).toBe(2);
    expect(opened.unit_basis).toContain("1 of 2 units declared no handle");
  });

  test("a retry of the same vote replays without a second cast", async () => {
    const j = journal();
    const [opener, peer] = await voters(j, ["opener", "peer"]);
    const opened = await poll(opener!);
    const vote = { ballot: opened.ballot, choice: ["split", "keep"], why: [{ text: "fewer writes", basis: "inferred" }] };
    const first = await ok(peer!.server, "collab_vote", vote);
    const before = j.count();
    // The same vote, its choice listed in another order: the same input once normalised.
    const again = await ok(peer!.server, "collab_vote", { ...vote, choice: ["keep", "split"] });
    expect(again.replayed).toBe(true);
    expect(again.effect).toStartWith("Replayed: nothing new was written.");
    expect([again.cast_seq, again.commitment, again.counts_as]).toEqual([first.cast_seq, first.commitment, first.counts_as]);
    expect(j.count()).toBe(before);
    expect(sealFiles(j, opened.ballot)).toHaveLength(1);
    // A different vote casts again.
    const changed = await ok(peer!.server, "collab_vote", { ...vote, why: [{ text: "fewer writes, measured", basis: "seen" }] });
    expect(changed.replayed).toBe(false);
    expect(changed.cast_seq).toBe(2);
  });

  test("a lost-response retry after the close replays, whether this call or an earlier one revealed the ballot", async () => {
    const j = journal();
    const [opener, peer] = await voters(j, ["opener", "peer"]);
    const opened = await poll(opener!);
    const vote = { ballot: opened.ballot, choice: ["keep"], why: [{ text: "simplest", basis: "inferred" }] };
    const first = await ok(peer!.server, "collab_vote", vote);
    const casts = () => j.events().filter((event) => event.type === "ballot.cast").length;
    j.advance(31 * MINUTE);
    // No call in between: this call's own reveal runs first and removes the seal.
    const again = await ok(peer!.server, "collab_vote", vote);
    expect(closedCount(j, opened.ballot)).toBe(1);
    expect(sealFiles(j, opened.ballot)).toEqual([]);
    expect(again.replayed).toBe(true);
    expect([again.cast_seq, again.commitment, again.counts_as]).toEqual([first.cast_seq, first.commitment, first.counts_as]);
    expect(again.effect).toBe(`Replayed: nothing new was written. Your vote in ${first.ballot_handle} (cast 1) was recorded before the close and revealed at the close as counted.`);
    expect(casts()).toBe(1);
    // After another session's call revealed it, the same.
    await ok(opener!.server, "collab_inbox");
    expect((await ok(peer!.server, "collab_vote", vote)).replayed).toBe(true);
    expect(casts()).toBe(1);
    // A different vote after the close is refused, naming the true close.
    const late = await refused(peer!.server, "collab_vote", { ...vote, choice: ["split"] });
    expect(late.code).toBe("ballot_closed");
    expect(late.message).toContain(`closed at ${opened.closes_at}`);
    expect(casts()).toBe(1);
  });

  test("two processes holding one session cast one vote once: the overtaken one is told to send it again, and that replays", async () => {
    const j = journal();
    const [opener, peer] = await voters(j, ["opener", "peer"]);
    const opened = await poll(opener!);
    const second = buildCollabMcpServer(j.store, {
      environment: {},
      resumed_session: { handle: peer!.handle, credential_file: j.store.defaultSessionCredentialPath(peer!.handle.session.id) },
    });
    const vote = { ballot: opened.ballot, choice: ["keep"] };
    const original = j.store.castBallotForSession.bind(j.store);
    let inner: Promise<Record<string, any>> | null = null;
    // The first call has passed its retry check and written its seal; the
    // other process casts the same vote before the first call's transaction.
    j.store.castBallotForSession = ((input: Parameters<typeof original>[0]) => {
      j.store.castBallotForSession = original;
      inner = ok(second, "collab_vote", vote);
      return original(input);
    }) as typeof original;
    const overtaken = await refused(peer!.server, "collab_vote", vote);
    const other = await inner!;
    expect(other).toMatchObject({ replayed: false, cast_seq: 1 });
    expect(overtaken.code).toBe("changed_under_you");
    expect(overtaken.remedy).toEqual({ tool: "collab_vote", input: vote });
    expect(j.events().filter((event) => event.type === "ballot.cast")).toHaveLength(1);
    expect(sealFiles(j, opened.ballot)).toHaveLength(1);
    const resent = await ok(peer!.server, "collab_vote", overtaken.remedy.input);
    expect(resent).toMatchObject({ replayed: true, cast_seq: 1, commitment: other.commitment });
    await ok(opener!.server, "collab_vote", { ballot: opened.ballot, choice: ["split"] });
    j.advance(31 * MINUTE);
    const result = (await about(opener!, opened.ballot)).ballot.result;
    expect(result.replaced).toEqual([]);
    expect(result.options.find((option: any) => option.key === "keep").voters).toEqual(["peer"]);
  });

  test("a cast sealed for another unit is refused in the store, an outsider sharing a voter's handle included", async () => {
    const j = journal();
    const [opener, peer] = await voters(j, ["opener", "peer"], (name) => (name === "peer" ? { seat_ref: "claude-code:seat-1" } : {}));
    const opened = await poll(opener!);
    const [outsider] = await voters(j, ["outsider"], () => ({ seat_ref: "claude-code:seat-1" }));
    const unitOf = (name: string) => opened.electorate.find((unit: any) => unit.names[0] === name).unit;
    const attempt = (voter: Voter, unitId: string) => {
      try {
        j.store.castBallotForSession({ ...voter.handle.credential, ballot_id: opened.ballot, cast_id: crypto.randomUUID(), unit_id: unitId, commitment: "0".repeat(64) });
        return "recorded";
      } catch (error: any) {
        return error.code as string;
      }
    };
    expect(attempt(peer!, unitOf("opener"))).toBe("ballot_unit_changed");
    expect(attempt(outsider!, unitOf("peer"))).toBe("ballot_unit_changed");
    expect(j.events().filter((event) => event.type === "ballot.cast")).toEqual([]);
  });

  test("a linked seal directory is refused before any cast; a loose one is tightened to 0700", async () => {
    const j = journal();
    const [opener, peer] = await voters(j, ["opener", "peer"]);
    const opened = await poll(opener!);
    const state = realpathSync(join(j.directory, "state"));
    const elsewhere = mkdtempSync(join(tmpdir(), "agenttool-collab-ballot-elsewhere-"));
    cleanup.push(() => rmSync(elsewhere, { recursive: true, force: true }));
    const vote = { ballot: opened.ballot, choice: ["keep"] };
    const casts = () => j.events().filter((event) => event.type === "ballot.cast").length;
    // The seal root is a link.
    symlinkSync(elsewhere, join(state, "collab-ballots"));
    expect((await refused(peer!.server, "collab_vote", vote)).code).toBe("seal_directory_unsafe");
    expect(casts()).toBe(0);
    expect(readdirSync(elsewhere)).toEqual([]);
    // The ballot's own directory is a link.
    unlinkSync(join(state, "collab-ballots"));
    mkdirSync(join(state, "collab-ballots"), { mode: 0o700 });
    symlinkSync(elsewhere, join(state, "collab-ballots", opened.ballot));
    expect((await refused(peer!.server, "collab_vote", vote)).code).toBe("seal_directory_unsafe");
    expect(casts()).toBe(0);
    expect(readdirSync(elsewhere)).toEqual([]);
    // A real directory others can read is made private, and the cast goes ahead.
    unlinkSync(join(state, "collab-ballots", opened.ballot));
    chmodSync(join(state, "collab-ballots"), 0o755);
    await ok(peer!.server, "collab_vote", vote);
    expect(statSync(join(state, "collab-ballots")).mode & 0o777).toBe(0o700);
    expect(casts()).toBe(1);
  });

  test("a cast refused at the close or after a withdrawal leaves no seal file", async () => {
    const j = journal();
    const [opener, peer, third] = await voters(j, ["opener", "peer", "third"]);
    const opened = await poll(opener!);
    await ok(third!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    expect(sealFiles(j, opened.ballot)).toHaveLength(1);
    // The close falls between the seal and the cast's transaction.
    const original = j.store.castBallotForSession.bind(j.store);
    j.store.castBallotForSession = ((input: Parameters<typeof original>[0]) => {
      j.advance(31 * MINUTE);
      return original(input);
    }) as typeof original;
    const late = await refused(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["drop"] });
    j.store.castBallotForSession = original;
    expect(late.code).toBe("ballot_closed");
    expect(late.remedy).toEqual({ tool: "collab_inbox", input: { about: opened.ballot } });
    expect(j.events().filter((event) => event.type === "ballot.cast")).toHaveLength(1);
    // The only seal left is the earlier cast's (until the reveal deletes it).
    expect(sealFiles(j, opened.ballot)).toHaveLength(1);
    // After the close, refused before any seal is written.
    expect((await refused(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["drop"] })).code).toBe("ballot_closed");

    // Seen again, so the default electorate of the next poll has them.
    await ok(peer!.server, "collab_inbox");
    const second = await poll(opener!, { question: "Which index should the store keep?" });
    const withdraw = j.store.castBallotForSession.bind(j.store);
    j.store.castBallotForSession = ((input: Parameters<typeof withdraw>[0]) => {
      j.store.appendReportForSession({
        ...opener!.handle.credential, idempotency_key: "withdraw-poll", kind: "observation",
        body: "withdrawn", relation: "withdraws", target_report_id: second.ballot,
      });
      return withdraw(input);
    }) as typeof withdraw;
    const after = await refused(peer!.server, "collab_vote", { ballot: second.ballot, choice: ["keep"] });
    j.store.castBallotForSession = withdraw;
    expect(after.code).toBe("ballot_withdrawn");
    expect(sealFiles(j, second.ballot)).toEqual([]);
    expect((await refused(peer!.server, "collab_vote", { ballot: second.ballot, choice: ["keep"] })).code).toBe("ballot_withdrawn");
  });

  test("seal files sit beside the journal's real path: directories 0700, files 0600", async () => {
    const base = mkdtempSync(join(tmpdir(), "agenttool-collab-ballot-link-"));
    cleanup.push(() => rmSync(base, { recursive: true, force: true }));
    mkdirSync(join(base, "real"));
    mkdirSync(join(base, "repo"));
    symlinkSync(join(base, "real"), join(base, "linked"));
    const store = new CollabStore(join(base, "linked", "collab.sqlite"));
    cleanup.push(() => store.close());
    const serve = (actor: string) => {
      const handle = store.startSession({ root_path: join(base, "repo"), actor });
      const file = writeSessionCredentialFile(store.defaultSessionCredentialPath(handle.session.id), handle.credential);
      return buildCollabMcpServer(store, { environment: {}, resumed_session: { handle, credential_file: file } });
    };
    const opener = serve("opener");
    const peer = serve("peer");
    await ok(peer, "collab_inbox");
    const opened = await ok(opener, "collab_poll", { question: "Which?", options: OPTIONS, closes: "30m" });
    await ok(peer, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    const real = realpathSync(join(base, "real"));
    const root = join(real, "collab-ballots");
    const dir = join(root, opened.ballot);
    expect(store.journalRealpath()).toBe(join(real, "collab.sqlite"));
    expect(statSync(root).mode & 0o777).toBe(0o700);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f-]{36}\.json$/);
    expect(statSync(join(dir, files[0]!)).mode & 0o777).toBe(0o600);
    const seal = JSON.parse(await Bun.file(join(dir, files[0]!)).text());
    expect(Object.keys(seal).sort()).toEqual(["cast_id", "journal_realpath", "salt", "session_id", "unit_id", "vote"]);
    expect(seal.journal_realpath).toBe(join(real, "collab.sqlite"));
    expect(seal.salt).toMatch(/^[0-9a-f]{64}$/);
    expect(resolve(dirname(dirname(dir)))).toBe(real);
  });
});

describe("sealing: nothing of a vote before the reveal (spec 7)", () => {
  test("the vote's result and every row and event before the reveal hold nothing of the vote", async () => {
    const j = journal({ git: true });
    j.write("docs/cache.md", "measurements\n");
    const [opener, peer, third] = await voters(j, ["opener", "peer", "third"], () => ({ model: "claude-opus-5.5" }));
    const opened = await ok(opener!.server, "collab_poll", {
      question: "Which layout?",
      options: [{ key: "optkzq", label: "Layout K" }, { key: "optwyx", label: "Layout W" }, { key: "optmno", label: "Layout M" }],
      closes: "30m",
    });
    const before = dump(j.store);
    const votes = [
      { server: peer!.server, choice: ["optwyx"], why: [{ text: "reason-marker-alpha halves the writes", basis: "inferred", cites: [1] }], evidence: ["file docs/cache.md:1", "test bun test probe-marker-beta exit=0"], shared: "shared-marker-gamma" },
      { server: third!.server, choice: ["optmno", "optwyx"], why: [{ text: "reason-marker-delta", basis: "seen" }], evidence: [] as string[], shared: undefined },
      // The third session replaces its cast.
      { server: third!.server, choice: ["optkzq"], why: [{ text: "reason-marker-epsilon", basis: "seen" }], evidence: [] as string[], shared: "shared-marker-zeta" },
    ];
    const results: Array<Record<string, any>> = [];
    for (const vote of votes) {
      results.push(await ok(vote.server, "collab_vote", {
        ballot: opened.ballot, choice: vote.choice, why: vote.why, evidence: vote.evidence, ...(vote.shared ? { shared: vote.shared } : {}),
      }));
    }
    // A replacement and an abstention, each as sealed as the rest.
    results.push(await ok(opener!.server, "collab_vote", { ballot: opened.ballot, choice: [] }));
    expect(results[2]!.cast_seq).toBe(2);
    const seals = sealFiles(j, opened.ballot).map((name) => JSON.parse(readFileSync(join(sealDir(j, opened.ballot), name), "utf8")));
    expect(seals).toHaveLength(4);
    const needles = new Set<string>([
      "reason-marker-alpha", "probe-marker-beta", "shared-marker-gamma", "reason-marker-delta", "docs/cache.md:1",
      "reason-marker-epsilon", "shared-marker-zeta",
      JSON.stringify(["optwyx"]), JSON.stringify(["optwyx", "optmno"]), JSON.stringify(["optmno", "optwyx"]), JSON.stringify(["optkzq"]), '"choice"',
    ]);
    for (const seal of seals) {
      for (const value of [seal.vote, seal.vote.choice, { ballot_id: opened.ballot, vote: seal.vote }, { choice: seal.vote.choice, why: seal.vote.why }]) {
        needles.add(sha(canonicalJson(value)));
        needles.add(shaB32(canonicalJson(value)));
        needles.add(shaB32(canonicalJson(value)).slice(0, 20));
      }
      for (const reason of seal.vote.why) needles.add(sha(reason.text));
      needles.add(seal.salt);
    }
    const choiceKeys = ["optkzq", "optwyx", "optmno"];
    for (const result of results) {
      const text = JSON.stringify(result);
      for (const needle of needles) expect(text).not.toContain(needle);
      for (const key of choiceKeys) expect(text).not.toContain(key);
      expect(result.note).toBeUndefined();
    }
    const after = dump(j.store);
    for (const [table, rows] of after) {
      for (const row of rows) {
        if (before.get(table)?.has(row)) continue;
        // Rows the votes added or changed, the mutation receipts and the events included.
        for (const needle of needles) expect(`${table}: ${row}`).not.toContain(needle);
        for (const key of choiceKeys) expect(`${table}: ${row}`).not.toContain(key);
      }
    }
    expect(after.get("mutations")!.size).toBeGreaterThan(before.get("mutations")!.size);
    for (const event of j.events()) {
      const text = JSON.stringify(event.payload);
      for (const needle of needles) expect(text).not.toContain(needle);
      if (event.type === "ballot.cast") {
        expect(Object.keys(event.payload).sort()).toEqual(["ballot_id", "cast_id", "cast_seq", "commitment", "session_id", "unit_id"]);
      }
    }
    // The peer's own inbox and the opener's view show turnout, never a vote.
    const view = JSON.stringify(await about(opener!, opened.ballot));
    for (const needle of ["reason-marker-alpha", "shared-marker-gamma", JSON.stringify(["optwyx"])]) expect(view).not.toContain(needle);
    // After the close, the reveal shows each vote, verifiably.
    j.advance(31 * MINUTE);
    const result = (await about(opener!, opened.ballot)).ballot.result;
    expect(result.options.find((option: any) => option.key === "optwyx").reasons[0].text).toBe("reason-marker-alpha halves the writes");
    expect(result.replaced).toEqual([expect.objectContaining({ name: "third", cast_seq: 1 })]);
    expect([...result.replaced[0].choice].sort()).toEqual(["optmno", "optwyx"]);
    expect(result.options.find((option: any) => option.key === "optkzq").voters).toEqual(["third"]);
    for (const entry of revealed(j, opened.ballot)) {
      const seal = seals.find((candidate) => candidate.cast_id === entry.cast_id)!;
      expect(entry.salt).toBe(seal.salt);
      expect(entry.vote).toEqual(seal.vote);
    }
    // The peer's file evidence was hashed when it voted, and sealed with the vote.
    const peerEntry = revealed(j, opened.ballot).find((entry) => entry.session_id === peer!.handle.session.id)!;
    expect(peerEntry.vote!.evidence[0]).toMatchObject({ text: "file docs/cache.md:1", kind: "file", locator: "docs/cache.md", lines: "1", observed: "server", sha256: sha("measurements\n") });
    expect(peerEntry.vote!.model).toBe("claude-opus-5.5");
  });
});

describe("the reveal (spec 7, Close and reveal)", () => {
  test("only at closes_at; without close_when_all_cast every unit casting closes nothing", async () => {
    const j = journal();
    const [opener, peer] = await voters(j, ["opener", "peer"]);
    const opened = await poll(opener!);
    expect(opened.close_when_all_cast).toBe(false);
    await ok(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    await ok(opener!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    j.advance(29 * MINUTE);
    await ok(opener!.server, "collab_inbox");
    expect(revealed(j, opened.ballot)).toEqual([]);
    expect((await about(opener!, opened.ballot)).ballot.state).toBe("open");
    j.advance(MINUTE);
    // The deadline instant itself is the close; any notes verb reveals.
    await ok(peer!.server, "collab_note", { text: "Just a note." });
    expect(revealed(j, opened.ballot)).toHaveLength(2);
    expect(closedCount(j, opened.ballot)).toBe(1);
    const closed = j.events().find((event) => event.type === "ballot.closed")!;
    expect(closed.payload.entry_count).toBe(2);
    expect(closed.payload.entries_sha256).toBe(sha(canonicalJson(revealed(j, opened.ballot))));
    expect((j.store.db.query(`SELECT DISTINCT actor FROM events WHERE type IN ('ballot.revealed', 'ballot.closed')`).all() as Array<{ actor: string }>).map((row) => row.actor)).toEqual(["system:clock"]);
    expect(sealFiles(j, opened.ballot)).toEqual([]);
    expect(existsSync(sealDir(j, opened.ballot))).toBe(false);
    // A second pass does nothing.
    await ok(opener!.server, "collab_inbox");
    expect(closedCount(j, opened.ballot)).toBe(1);
  });

  test("early only when close_when_all_cast was set and every unit has cast", async () => {
    const j = journal();
    const [opener, peer, third] = await voters(j, ["opener", "peer", "third"]);
    const opened = await poll(opener!, { close_when_all_cast: true });
    expect(opened.note).toContain("or when every unit has cast");
    expect((await about(peer!, opened.ballot)).ballot.terms.close_when_all_cast).toBe(true);
    await ok(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    await ok(opener!.server, "collab_vote", { ballot: opened.ballot, choice: ["split"] });
    await ok(opener!.server, "collab_inbox");
    expect(revealed(j, opened.ballot)).toEqual([]);
    const last = await ok(third!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    expect(last.advice.join(" ")).toContain("Every unit has now cast");
    expect(revealed(j, opened.ballot)).toHaveLength(3);
    const view = (await about(opener!, opened.ballot)).ballot;
    expect(view.closed_by).toBe("all_cast");
    expect(view.result.status).toBe("top_choice");
    // A late cast after the close is refused.
    expect((await refused(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["split"] })).code).toBe("ballot_closed");
    // Once the deadline has passed too, it still closed when every unit had cast.
    j.advance(31 * MINUTE);
    expect((await about(opener!, opened.ballot)).ballot.closed_by).toBe("all_cast");
    const after = await refused(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["split"] });
    expect(after.code).toBe("ballot_closed");
    expect(after.message).toContain("closed when every unit had cast");
    expect(after.message).not.toContain(opened.closes_at);
  });

  test("a withdrawn ballot is revealed only at its original close, with no top choice", async () => {
    const j = journal();
    const [opener, peer] = await voters(j, ["opener", "peer"]);
    const opened = await poll(opener!, { close_when_all_cast: true });
    await ok(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"], why: [{ text: "simplest", basis: "inferred" }] });
    await ok(opener!.server, "collab_note", { act: "withdraw", re: opened.ballot, text: "Withdrawn: the question was wrong." });
    const view = (await about(peer!, opened.ballot)).ballot;
    expect(view.state).toBe("withdrawn");
    expect((await about(peer!, opened.ballot)).advice.join(" ")).toContain("revealed at the original close");
    expect((await refused(opener!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] })).code).toBe("ballot_withdrawn");
    j.advance(29 * MINUTE);
    await ok(peer!.server, "collab_inbox");
    expect(revealed(j, opened.ballot)).toEqual([]);
    j.advance(2 * MINUTE);
    const result = (await about(peer!, opened.ballot)).ballot.result;
    expect(result.status).toBe("withdrawn");
    expect(result.top).toEqual([]);
    expect(result.options.find((option: any) => option.key === "keep").units).toBe(1);
    expect(result.options.find((option: any) => option.key === "keep").reasons[0].text).toBe("simplest");
  });

  test("a withdrawal is final: withdrawing it after the reveal does not turn the result into a top choice", async () => {
    const j = journal();
    const [opener, peer, third] = await voters(j, ["opener", "peer", "third"]);
    const opened = await poll(opener!);
    await ok(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    await ok(opener!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    const withdrawal = await ok(opener!.server, "collab_note", { act: "withdraw", re: opened.ballot, text: "Withdrawn." });
    expect(withdrawal.advice.join(" ")).toContain("withdrawing this withdrawal later does not reopen it");
    expect((await refused(third!.server, "collab_vote", { ballot: opened.ballot, choice: ["split"] })).code).toBe("ballot_withdrawn");
    j.advance(31 * MINUTE);
    expect((await about(opener!, opened.ballot)).ballot.result.status).toBe("withdrawn");
    const undo = await ok(opener!.server, "collab_note", { act: "withdraw", re: withdrawal.ids.report, text: "I take back my withdrawal." });
    expect(undo.advice.join(" ")).toContain(`This does not reopen ${opened.ids.ballot_handle}`);
    const view = (await about(peer!, opened.ballot)).ballot;
    expect(view.state).toBe("revealed");
    expect(view.withdrawn).toEqual({ report: withdrawal.ids.report, at: expect.any(String) });
    expect(view.result.status).toBe("withdrawn");
    expect(view.result.top).toEqual([]);
    expect(j.store.ballotResult(opener!.handle.workspace.id, opened.ballot)).toMatchObject({ status: "withdrawn", top: [] });
  });

  test("a withdrawal withdrawn before the close does not reopen the ballot", async () => {
    const j = journal();
    const [opener, peer] = await voters(j, ["opener", "peer"]);
    const opened = await poll(opener!);
    const withdrawal = await ok(opener!.server, "collab_note", { act: "withdraw", re: opened.ballot, text: "Withdrawn." });
    await ok(opener!.server, "collab_note", { act: "withdraw", re: withdrawal.ids.report, text: "I take it back." });
    const view = (await about(peer!, opened.ballot)).ballot;
    expect(view.state).toBe("withdrawn");
    expect(view.withdrawn.report).toBe(withdrawal.ids.report);
    expect((await refused(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] })).code).toBe("ballot_withdrawn");
    // Polling the same question again opens a new ballot.
    const fresh = await poll(opener!);
    expect(fresh.ballot).not.toBe(opened.ballot);
    expect(fresh.state).toBe("open");
    j.advance(31 * MINUTE);
    expect((await about(peer!, opened.ballot)).ballot.result.status).toBe("withdrawn");
  });

  test("two store instances racing to reveal append exactly one ballot.closed", async () => {
    const j = journal();
    const [opener, peer, third] = await voters(j, ["opener", "peer", "third"]);
    const opened = await poll(opener!);
    for (const voter of [peer!, third!, opener!]) await ok(voter.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    j.advance(31 * MINUTE);
    j.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const path = join(j.directory, "state", "collab.sqlite");
    const startAt = Date.now() + 1_500;
    const worker = join(import.meta.dir, "ballot-reveal-worker.ts");
    const workspaceId = opener!.handle.workspace.id;
    const runs = [0, 1].map(() => Bun.spawn([process.execPath, worker, path, workspaceId, j.now(), String(startAt)], { stdout: "pipe", stderr: "pipe" }));
    const outputs = await Promise.all(runs.map(async (run) => {
      const [stdout] = await Promise.all([new Response(run.stdout).text(), run.exited]);
      return JSON.parse(stdout) as { ok: boolean; revealed: string[]; pending: unknown[] };
    }));
    expect(outputs.every((output) => output.ok)).toBe(true);
    expect(outputs.flatMap((output) => output.revealed)).toEqual([opened.ballot]);
    expect(closedCount(j, opened.ballot)).toBe(1);
    expect(revealed(j, opened.ballot)).toHaveLength(3);
    expect(j.store.verifyJournal(workspaceId)).toBe(true);
    // A third instance, later, finds it revealed and writes nothing.
    const before = j.count();
    expect(j.store.revealDueBallots(workspaceId)).toEqual({ revealed: [], pending: [] });
    expect(j.count()).toBe(before);
  }, 30_000);

  test("seal files are deleted only after the reveal commits; a failed reveal stays sealed, never fails the verb, and is retried", async () => {
    let failures = 2;
    const seen: Array<{ step: string; files: number; closed: number }> = [];
    let j!: Journal;
    j = journal({
      store: {
        reveal_failpoint: (step, ballotId) => {
          seen.push({ step, files: sealFiles(j, ballotId).length, closed: closedCount(j, ballotId) });
          if (step === "appended" && failures > 0) {
            failures -= 1;
            throw new Error("injected reveal failure");
          }
        },
      },
    });
    const [opener, peer] = await voters(j, ["opener", "peer"]);
    const opened = await poll(opener!);
    await ok(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    await ok(opener!.server, "collab_vote", { ballot: opened.ballot, choice: ["split"] });
    j.advance(31 * MINUTE);
    // The verb that triggers the reveal still does its own work.
    const noted = await ok(opener!.server, "collab_note", { text: "A note after the close." });
    expect(noted.ok).toBe(true);
    expect(noted.reveal_pending).toBe("reveal_failed");
    expect(j.report(noted.ids.report).body).toContain("A note after the close.");
    const failed = await ok(peer!.server, "collab_inbox");
    expect(failed.ok).toBe(true);
    expect(failed.reveal_pending).toBe("reveal_failed");
    // Inside the transaction the events were appended while every seal was still there.
    expect(seen[1]).toEqual({ step: "appended", files: 2, closed: 1 });
    expect(closedCount(j, opened.ballot)).toBe(0);
    expect(revealed(j, opened.ballot)).toEqual([]);
    expect(sealFiles(j, opened.ballot)).toHaveLength(2);
    expect((await about(peer!, opened.ballot)).ballot.result).not.toBeNull();
    expect(closedCount(j, opened.ballot)).toBe(1);
    expect(sealFiles(j, opened.ballot)).toEqual([]);
    const after = await ok(peer!.server, "collab_inbox");
    expect(after.reveal_pending).toBeUndefined();
  });

  test("a missing, unreadable or mismatching seal costs that one entry, is listed, and an earlier cast never stands in", async () => {
    const j = journal();
    const [opener, b, c, d] = await voters(j, ["opener", "b", "c", "d"]);
    const opened = await poll(opener!, { quorum: 2 });
    const castFile = (voter: Voter) => {
      const casts = j.events().filter((event) => event.type === "ballot.cast" && event.payload.session_id === voter.handle.session.id);
      return join(sealDir(j, opened.ballot), `${casts.at(-1)!.payload.cast_id}.json`);
    };
    await ok(b!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    await ok(b!.server, "collab_vote", { ballot: opened.ballot, choice: ["drop"] });
    rmSync(castFile(b!));
    await ok(c!.server, "collab_vote", { ballot: opened.ballot, choice: ["drop"] });
    writeFileSync(castFile(c!), "not json");
    await ok(d!.server, "collab_vote", { ballot: opened.ballot, choice: ["drop"] });
    const tampered = JSON.parse(readFileSync(castFile(d!), "utf8"));
    tampered.vote.choice = ["keep"];
    writeFileSync(castFile(d!), JSON.stringify(tampered));
    await ok(opener!.server, "collab_vote", { ballot: opened.ballot, choice: ["split"] });
    j.advance(31 * MINUTE);
    const result = (await about(opener!, opened.ballot)).ballot.result;
    expect(result.seal_missing.map((entry: any) => entry.name)).toEqual(["b"]);
    expect(result.seal_unreadable.map((entry: any) => entry.name)).toEqual(["c"]);
    expect(result.seal_mismatch.map((entry: any) => entry.name)).toEqual(["d"]);
    // b's first cast is revealed as replaced and is not counted in place of the lost one.
    expect(result.replaced).toEqual([expect.objectContaining({ name: "b", cast_seq: 1, choice: ["keep"] })]);
    expect(result.options.find((option: any) => option.key === "keep").units).toBe(0);
    expect(result.options.find((option: any) => option.key === "drop").units).toBe(0);
    expect(result.turnout.cast).toBe(4);
    expect(result.quorum).toEqual({ needed: 2, met: false, counted: 1 });
    expect(result.status).toBe("inconclusive");
    for (const entry of revealed(j, opened.ballot)) expect(revealedEntryBytes(entry)).toBeLessThanOrEqual(MAX_REVEALED_ENTRY_BYTES);
  });

  /** A seal whose cast never committed, as a process that died between the seal write and the cast leaves it. */
  function orphanSeal(j: Journal, opened: Record<string, any>, voter: Voter): string {
    const castId = crypto.randomUUID();
    writeSealFile(j.store.ballotSealPath(opened.ballot, castId), {
      cast_id: castId,
      journal_realpath: j.store.journalRealpath()!,
      session_id: voter.handle.session.id,
      unit_id: opened.electorate.find((unit: any) => unit.names[0] === voter.name).unit,
      salt: "a".repeat(64),
      vote: { choice: ["drop"], why: [{ text: "orphan-marker", cites: [] }], evidence: [] },
    });
    return castId;
  }

  test("a seal whose cast never committed is never revealed, and the reveal removes it", async () => {
    const j = journal();
    const [opener, peer] = await voters(j, ["opener", "peer"]);
    const opened = await poll(opener!);
    await ok(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    const orphan = orphanSeal(j, opened, opener!);
    expect(sealFiles(j, opened.ballot)).toHaveLength(2);
    j.advance(31 * MINUTE);
    await ok(peer!.server, "collab_inbox");
    expect(revealed(j, opened.ballot).map((entry) => entry.session_id)).toEqual([peer!.handle.session.id]);
    expect(revealed(j, opened.ballot).some((entry) => entry.cast_id === orphan)).toBe(false);
    expect(JSON.stringify(j.events())).not.toContain("orphan-marker");
    expect(sealFiles(j, opened.ballot)).toEqual([]);
    expect(existsSync(sealDir(j, opened.ballot))).toBe(false);
  });

  test("a temporary seal a dead process left is never revealed, and the reveal removes it", async () => {
    const j = journal();
    const [opener, peer] = await voters(j, ["opener", "peer"]);
    const opened = await poll(opener!);
    await ok(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    // A process died between a seal's write and its rename: one whole, one torn.
    const whole = join(sealDir(j, opened.ballot), `.${crypto.randomUUID()}.tmp`);
    writeFileSync(whole, JSON.stringify({
      journal_realpath: j.store.journalRealpath(),
      vote: { choice: ["drop"], why: [{ text: "temporary-marker", cites: [] }], evidence: [] },
    }), { mode: 0o600 });
    const torn = join(sealDir(j, opened.ballot), `.${crypto.randomUUID()}.tmp`);
    writeFileSync(torn, '{"vote":{"choice":["dr', { mode: 0o600 });
    // Something else's file in the directory is not collab's to remove.
    const foreign = join(sealDir(j, opened.ballot), "notes.txt");
    writeFileSync(foreign, "kept");
    j.advance(31 * MINUTE);
    await ok(peer!.server, "collab_inbox");
    expect(revealed(j, opened.ballot).map((entry) => entry.session_id)).toEqual([peer!.handle.session.id]);
    expect(JSON.stringify(j.events())).not.toContain("temporary-marker");
    expect(existsSync(whole)).toBe(false);
    expect(existsSync(torn)).toBe(false);
    expect(readFileSync(foreign, "utf8")).toBe("kept");
  });

  test("seals a process left when it died after the reveal committed are removed at the next open; an open ballot's stay", async () => {
    const j = journal();
    const [opener, peer] = await voters(j, ["opener", "peer"]);
    const done = await poll(opener!, { closes: "2m" });
    await ok(peer!.server, "collab_vote", { ballot: done.ballot, choice: ["keep"] });
    orphanSeal(j, done, opener!);
    // The process dies after the commit, before cleanSeals.
    const store = j.store as unknown as { cleanSeals: (ids: readonly string[]) => void };
    const clean = store.cleanSeals;
    store.cleanSeals = () => {};
    j.advance(3 * MINUTE);
    await ok(peer!.server, "collab_inbox");
    store.cleanSeals = clean;
    expect(closedCount(j, done.ballot)).toBe(1);
    expect(sealFiles(j, done.ballot)).toHaveLength(2);
    await ok(opener!.server, "collab_inbox");
    const open = await poll(opener!);
    await ok(peer!.server, "collab_vote", { ballot: open.ballot, choice: ["split"] });
    const next = new CollabStore(join(j.directory, "state", "collab.sqlite"), { now: () => new Date(j.now()) });
    cleanup.push(() => next.close());
    expect(sealFiles(j, done.ballot)).toEqual([]);
    expect(existsSync(sealDir(j, done.ballot))).toBe(false);
    expect(sealFiles(j, open.ballot)).toHaveLength(1);
  });

  test("each revealed entry stays within its 8 KiB bound; a vote over it is refused before any seal", async () => {
    const j = journal();
    const [opener, peer] = await voters(j, ["opener", "peer"]);
    const opened = await poll(opener!);
    const why = Array.from({ length: 4 }, (_, index) => ({ text: `${"協作".repeat(140)} ${index}`, basis: "inferred" as const, cites: [1, 2, 3, 4] }));
    const evidence = Array.from({ length: 4 }, (_, index) => `url https://example.org/${"x".repeat(200)}/${index}`);
    await ok(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep", "split", "drop"], why, evidence, shared: "s".repeat(200) });
    const tooBig = await refused(opener!.server, "collab_vote", {
      ballot: opened.ballot, choice: ["keep"], evidence: [`url https://example.org/${"y".repeat(9_000)}`],
    });
    expect(tooBig.code).toBe("too_long");
    expect(sealFiles(j, opened.ballot)).toHaveLength(1);
    j.advance(31 * MINUTE);
    await ok(opener!.server, "collab_inbox");
    const entries = revealed(j, opened.ballot);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe("counted");
    expect(revealedEntryBytes(entries[0]!)).toBeGreaterThan(4 * 1024);
    expect(revealedEntryBytes(entries[0]!)).toBeLessThanOrEqual(MAX_REVEALED_ENTRY_BYTES);
  });
});

describe("the result (spec 7, Result)", () => {
  async function run(choices: Record<string, string[] | null>, extra: Record<string, unknown> = {}, models?: Record<string, string>) {
    const j = journal();
    const names = Object.keys(choices);
    const people = await voters(j, names, (name) => (models?.[name] ? { model: models[name] } : {}));
    const opened = await poll(people[0]!, extra);
    for (const person of people) {
      const choice = choices[person.name];
      if (choice === null) continue;
      await ok(person.server, "collab_vote", {
        ballot: opened.ballot,
        choice,
        ...(person.name === "minority" ? { why: [{ text: "the trace shows it", basis: "seen", cites: [1] }], evidence: ["data open-trace sha256=" + "a".repeat(64)] } : {}),
      });
    }
    j.advance(31 * MINUTE);
    return { j, people, opened, result: (await about(people[0]!, opened.ballot)).ballot.result };
  }

  test("top_choice, with split, turnout, quorum, unique_evidence, lineages, notes and the fixed sentences", async () => {
    const { result } = await run(
      { opener: ["keep"], second: ["keep"], minority: ["drop"], quiet: null },
      {},
      { opener: "claude-opus-5.5", second: "claude-sonnet-5", minority: "gpt-6" },
    );
    expect(result.status).toBe("top_choice");
    expect(result.top).toEqual(["keep"]);
    expect(result.split).toBe(true);
    expect(result.notes).toContain(BALLOT_SPLIT_NOTE);
    expect(result.turnout).toEqual({ cast: 3, electorate: 4, delivery_recorded: expect.any(Number) });
    expect(result.quorum).toEqual({ needed: 2, met: true, counted: 3 });
    expect(result.options.find((option: any) => option.key === "drop").unique_evidence)
      .toEqual([{ evidence: expect.objectContaining({ text: "data open-trace sha256=" + "a".repeat(64) }), cited_by: ["minority"] }]);
    expect(result.options.find((option: any) => option.key === "keep").no_reason_given.sort()).toEqual(["opener", "second"]);
    expect(result.lineages).toEqual({ "claude-opus-5.5": 1, "claude-sonnet-5": 1, "gpt-6": 1 });
    expect(result.notes.join(" ")).toContain("every unit approving keep declares the same model family (claude)");
    expect(result.unit_basis).toContain("4 of 4 units declared no handle");
    expect(result.sealing).toBe(BALLOT_SEALING);
    expect(result.authorises).toBe(BALLOT_AUTHORISES);
    expect(result.next).toBeUndefined();
  });

  test("tied, with the next step; and every counted unit of one family is noted", async () => {
    const { result } = await run(
      { opener: ["keep"], second: ["split"] },
      {},
      { opener: "claude-opus-5.5", second: "claude-haiku-5" },
    );
    expect(result.status).toBe("tied");
    expect(result.top).toEqual(["keep", "split"]);
    expect(result.next).toEqual(BALLOT_TIE_NEXT);
    expect(result.notes).toContain(BALLOT_SAME_FAMILY_NOTE);
  });

  test("no_approval when quorum is met and every unit abstains; inconclusive when quorum is not met", async () => {
    const none = await run({ opener: [], second: [] });
    expect(none.result.status).toBe("no_approval");
    expect(none.result.abstained.sort()).toEqual(["opener", "second"]);
    expect(none.result.quorum.met).toBe(true);
    const short = await run({ opener: ["keep"], second: null, third: null }, { quorum: 2 });
    expect(short.result.status).toBe("inconclusive");
    expect(short.result.quorum).toEqual({ needed: 2, met: false, counted: 1 });
    expect(short.result.top).toEqual([]);
  });

  test("the result is computed on read and never stored; the closed item reaches the opener and the voters only", async () => {
    const { j, people, opened } = await run({ opener: ["keep"], second: ["keep"], silent: null });
    for (const table of ["note_ballots", "note_shown", "note_marks"]) {
      for (const row of dump(j.store).get(table)!) expect(row).not.toContain("top_choice");
    }
    const closed = j.events().find((event) => event.type === "ballot.closed")!;
    const asEvent = { ...closed, workspace_id: people[0]!.handle.workspace.id, session_id: null } as any;
    expect(j.store.eventAddressesSession(asEvent, people[0]!.handle.session.id)).toBe(true);
    expect(j.store.eventAddressesSession(asEvent, people[1]!.handle.session.id)).toBe(true);
    expect(j.store.eventAddressesSession(asEvent, people[2]!.handle.session.id)).toBe(false);
    for (const type of ["ballot.cast", "ballot.revealed"]) {
      const event = j.events().find((row) => row.type === type)!;
      for (const person of people) {
        expect(j.store.eventAddressesSession({ ...event, workspace_id: person.handle.workspace.id, session_id: null } as any, person.handle.session.id)).toBe(false);
      }
    }
    const inbox = await ok(people[1]!.server, "collab_inbox");
    const item = inbox.items.find((entry: any) => entry.act === "poll" && entry.result);
    expect(item.statement).toContain("closed: top_choice (keep). It authorises nothing.");
    expect(item.next).toEqual({ tool: "collab_inbox", input: { about: opened.ballot } });
    const silent = await ok(people[2]!.server, "collab_inbox");
    expect(silent.items.some((entry: any) => entry.result)).toBe(false);
    // Carried as a note: the question, the state and the result, with full ids and no vote.
    const carried = await ok(people[0]!.server, "collab_inbox", { about: opened.ballot, format: "note" });
    expect(carried.note).toStartWith("poll: Which cache layout should the store use?");
    expect(carried.note).toContain(`Re: ballot:${opened.ballot}`);
    expect(carried.note).toContain("Result: top_choice: keep; authorises nothing");
    expect(carried.note.length).toBeLessThanOrEqual(800);
  });
});

describe("ballots in collab_inbox and collab_arrive (spec 5.1, 5.2)", () => {
  test("the opened item carries the terms and a ready collab_vote; arrive lists it; waiting_on_you holds it until the unit casts", async () => {
    const j = journal();
    const [opener, peer] = await voters(j, ["opener", "peer"]);
    const outsider = j.start("outsider-no-mark");
    const outsiderServer = j.serve(outsider);
    const opened = await poll(opener!);
    const inbox = await ok(peer!.server, "collab_inbox");
    const item = inbox.items.find((entry: any) => entry.id === opened.ballot && entry.act === "poll" && entry.terms);
    expect(item.handle).toMatch(/^ballot#[0-9a-f]{6}$/);
    expect(item.why_you).toBe("in_electorate");
    expect(item.terms).toEqual({
      question: "Which cache layout should the store use?",
      criteria: "Fewest writes per open.",
      options: OPTIONS,
      method: "approval/1",
      quorum: 2,
      closes_at: opened.closes_at,
      close_when_all_cast: false,
    });
    expect(item.you_may_vote).toBe(true);
    expect(item.you_have_cast).toBe(false);
    expect(item.sealing).toBe(BALLOT_SEALING);
    expect(item.next).toEqual({ tool: "collab_vote", input: { ballot: opened.ballot } });
    // The ready call casts nothing as given: it asks for a choice.
    expect((await refused(peer!.server, "collab_vote", item.next.input)).code).toBe("invalid_choice");
    const waiting = inbox.waiting_on_you.find((entry: any) => entry.what === "vote");
    expect(waiting).toMatchObject({ id: opened.ballot, due: opened.closes_at, next: { tool: "collab_inbox", input: { about: opened.ballot } } });
    // Delivery is recorded for the turnout's delivery_recorded.
    expect(j.store.noteShownAt(opener!.handle.workspace.id, peer!.handle.session.id, opened.ballot)).not.toBeNull();
    const arrived = await ok(peer!.server, "collab_arrive", { purpose: "look around" });
    expect(arrived.open.ballots).toEqual([expect.objectContaining({
      id: opened.ballot, question: "Which cache layout should the store use?", criteria: "Fewest writes per open.",
      options: OPTIONS, pick: null, closes_at: opened.closes_at, close_when_all_cast: false, you_may_vote: true, you_have_cast: false,
    })]);
    expect(arrived.totals.ballots).toBe(1);
    expect(arrived.surface.capabilities).toEqual([...NOTE_CAPABILITIES]);
    expect(NOTE_CAPABILITIES).toContain("ballot/1");
    // Not in the electorate: not for it, nothing waits, and it may not vote (its cast would be late).
    const other = await ok(outsiderServer, "collab_inbox");
    expect(other.items.some((entry: any) => entry.id === opened.ballot)).toBe(false);
    expect(other.waiting_on_you.some((entry: any) => entry.what === "vote")).toBe(false);
    expect((await ok(outsiderServer, "collab_arrive", { purpose: "look" })).open.ballots[0].you_may_vote).toBe(false);
    await ok(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    const after = await ok(peer!.server, "collab_inbox");
    expect(after.waiting_on_you.some((entry: any) => entry.what === "vote")).toBe(false);
    expect((await ok(peer!.server, "collab_arrive", { purpose: "look" })).open.ballots[0].you_have_cast).toBe(true);
  });

  test("a session whose unit-mate cast is told so, not that it cast, and warned that its own cast would conflict", async () => {
    const j = journal();
    const [opener, b, c] = await voters(j, ["opener", "b", "c"], (name) => (name === "opener" ? {} : { seat_ref: "codex:shared-host" }));
    const opened = await poll(opener!);
    await ok(b!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    const warning = "Another lineage of your unit has cast in this ballot; a cast by you makes the unit unit_conflict, and then neither is counted.";
    const inbox = await ok(c!.server, "collab_inbox");
    const item = inbox.items.find((entry: any) => entry.id === opened.ballot && entry.terms);
    expect(item).toMatchObject({ you_may_vote: true, you_have_cast: false, unit_has_cast: true });
    expect(inbox.advice).toContain(warning);
    const view = await about(c!, opened.ballot);
    expect(view.ballot.you).toMatchObject({ you_may_vote: true, you_have_cast: false, unit_has_cast: true, your_casts: 0 });
    expect(view.advice).toContain(warning);
    const arrived = await ok(c!.server, "collab_arrive", { purpose: "look" });
    expect(arrived.open.ballots[0]).toMatchObject({ you_may_vote: true, you_have_cast: false, unit_has_cast: true });
    expect(arrived.advice).toContain(`${opened.ids.ballot_handle}: ${warning}`);
    // The session that cast is told it cast.
    expect((await about(b!, opened.ballot)).ballot.you).toMatchObject({ you_have_cast: true, unit_has_cast: true, your_casts: 1 });
    expect((await about(b!, opened.ballot)).advice).not.toContain(warning);
  });

  test("notes in an open ballot's thread are folded for an elector that has not cast, the read mark moves past them, and legacy tools show them", async () => {
    const j = journal();
    const [opener, peer, talker] = await voters(j, ["opener", "peer", "talker"]);
    const opened = await poll(opener!);
    await ok(peer!.server, "collab_inbox");
    const lean = await ok(opener!.server, "collab_note", { text: "I lean keep: lean-marker-one.", re: opened.ballot, to: "peer" });
    const reply = await ok(talker!.server, "collab_note", { text: "Split wins: lean-marker-two.", re: lean.ids.report, to: "peer" });
    const inbox = await ok(peer!.server, "collab_inbox");
    const folded = inbox.items.filter((entry: any) => entry.folded);
    expect(folded.map((entry: any) => entry.id)).toEqual([lean.ids.report, reply.ids.report]);
    for (const entry of folded) {
      expect(Object.keys(entry).sort()).toEqual(["act", "at", "ballot", "folded", "for_me", "from", "handle", "id", "sequence", "why_folded", "why_you"]);
      expect(entry.why_folded).toBe(FOLDED_LINE);
    }
    expect(JSON.stringify(inbox.items)).not.toContain("lean-marker");
    expect(inbox.advice).toContain(FOLDED_LINE);
    // The mark moved past the folded notes; the ready call points at the ballot, not at a folded note.
    expect(inbox.read_through.sequence).toBe(inbox.read_through.head);
    expect(inbox.next).toEqual({ tool: "collab_inbox", input: { about: opened.ballot } });
    const thread = await about(peer!, opened.ballot);
    expect(thread.answers.every((entry: any) => entry.folded === true)).toBe(true);
    expect(JSON.stringify(thread.answers)).not.toContain("lean-marker");
    expect(thread.next).toEqual({ tool: "collab_vote", input: { ballot: opened.ballot } });
    // Folding is a default, not a gate: about on the note shows it.
    expect((await about(peer!, lean.ids.report)).root.statement).toBe("I lean keep: lean-marker-one.");
    const mark = j.store.noteMark(opener!.handle.workspace.id, peer!.handle.session.id);
    expect(mark).toBe(inbox.read_through.sequence);
    // Legacy reads show them whole, and every ballot view says so.
    const legacy = j.store.listReports(opener!.handle.workspace.id, { limit: 50 }).map((report) => report.body);
    expect(legacy.some((body) => body.includes("lean-marker-one"))).toBe(true);
    expect(thread.ballot.sealing).toContain("Notes on an open ballot are folded by collab_inbox only; legacy tools and older builds show them.");
    // Once the peer's unit has cast, nothing is folded.
    await ok(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    const unfolded = await about(peer!, opened.ballot);
    expect(unfolded.answers.some((entry: any) => entry.folded)).toBe(false);
    expect(JSON.stringify(unfolded.answers)).toContain("lean-marker-one");
    // The opener has not cast either: its own note is shown to it, the reply is folded.
    const own = (await about(opener!, opened.ballot)).answers;
    expect(own.find((entry: any) => entry.id === lean.ids.report).folded).toBeUndefined();
    const lines = (await ok(opener!.server, "collab_inbox", { include: "all" })).items;
    expect(lines.find((entry: any) => entry.id === reply.ids.report)).toMatchObject({ folded: true, for_me: false });
    expect(JSON.stringify(lines)).not.toContain("lean-marker-two");
  });

  test("a support on an open ballot gets advice, not a refusal; poll and vote are their own verbs in collab_note", async () => {
    const j = journal();
    const [opener, peer] = await voters(j, ["opener", "peer"]);
    const opened = await poll(opener!);
    const support = await ok(peer!.server, "collab_note", { act: "support", re: opened.ballot, text: "Keep is right." });
    expect(support.advice).toContain("This is public and unsealed; to vote, use collab_vote.");
    const vote = await refused(peer!.server, "collab_note", { act: "vote", re: opened.ballot, text: "keep" });
    expect(vote.code).toBe("wrong_verb");
    expect(vote.remedy).toEqual({ tool: "collab_vote", input: { ballot: opened.ballot } });
    const pollAct = await refused(peer!.server, "collab_note", { act: "poll", text: "Which index?" });
    expect(pollAct.code).toBe("wrong_verb");
    expect(pollAct.remedy).toEqual({ tool: "collab_poll", input: { question: "Which index?" } });
    j.advance(31 * MINUTE);
    const closed = await ok(peer!.server, "collab_note", { act: "support", re: opened.ballot, text: "Still keep." });
    expect(closed.advice).not.toContain("This is public and unsealed; to vote, use collab_vote.");
  });

  test("ballot.opened rings the electorate, by session or by voice, and no one else", async () => {
    const j = journal();
    const [opener, peer] = await voters(j, ["opener", "peer"]);
    const outsider = j.start("outsider");
    const opened = await poll(opener!);
    const child = j.start("peer/child", { parent_session_id: peer!.handle.session.id, parent_attested: true });
    const event = j.events().find((row) => row.type === "ballot.opened")!;
    const asEvent = { ...event, workspace_id: opener!.handle.workspace.id, session_id: opener!.handle.session.id } as any;
    expect(j.store.eventAddressesSession(asEvent, peer!.handle.session.id)).toBe(true);
    expect(j.store.eventAddressesSession(asEvent, child.session.id)).toBe(true);
    expect(j.store.eventAddressesSession(asEvent, outsider.session.id)).toBe(false);
    expect(opened.ballot).toBe(event.entity_id);
  });
});

describe("note_ballots (spec 8.1)", () => {
  test("is rebuilt from the journal when dropped or a row is lost", async () => {
    const j = journal();
    const [opener, peer] = await voters(j, ["opener", "peer"]);
    const open = await poll(opener!);
    const done = await poll(opener!, { question: "Which index?", closes: "2m" });
    await ok(peer!.server, "collab_vote", { ballot: done.ballot, choice: ["keep"] });
    j.advance(3 * MINUTE);
    await ok(peer!.server, "collab_inbox");
    const rows = () => j.store.db.query(`SELECT ballot_id, closes_at, state FROM note_ballots ORDER BY ballot_id`).all();
    const before = rows();
    expect(before).toEqual([
      { ballot_id: open.ballot, closes_at: open.closes_at, state: "open" },
      { ballot_id: done.ballot, closes_at: done.closes_at, state: "closed" },
    ].sort((left, right) => left.ballot_id.localeCompare(right.ballot_id)));
    const path = join(j.directory, "state", "collab.sqlite");
    j.store.db.exec("DROP TABLE note_ballots");
    const reopened = new CollabStore(path, { now: () => new Date(j.now()) });
    try {
      expect(reopened.db.query(`SELECT ballot_id, closes_at, state FROM note_ballots ORDER BY ballot_id`).all()).toEqual(before);
      reopened.db.query(`DELETE FROM note_ballots WHERE ballot_id = ?`).run(open.ballot);
    } finally {
      reopened.close();
    }
    const again = new CollabStore(path, { now: () => new Date(j.now()) });
    try {
      expect(again.db.query(`SELECT ballot_id, closes_at, state FROM note_ballots ORDER BY ballot_id`).all()).toEqual(before);
    } finally {
      again.close();
    }
  });
});

describe("a wait across a ballot's close", () => {
  test("wakes at the close, reveals as any call does, and returns the closed item; read-only until then", async () => {
    const j = journal();
    const [opener, peer, third] = await voters(j, ["opener", "peer", "third"]);
    const opened = await poll(opener!);
    await ok(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    await ok(opener!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    // An outsider, not in the electorate, is not woken by this ballot.
    const outsider = j.start("outsider");
    const outsiderServer = j.serve(outsider);
    for (const voter of [opener!, peer!, third!]) await ok(voter.server, "collab_inbox", { limit: 50 });
    await ok(outsiderServer, "collab_inbox", { limit: 50 });
    const started = performance.now();
    const waits = [opener!, third!].map((voter) => ok(voter.server, "collab_inbox", { wait_seconds: 20 }));
    const outsiderWait = ok(outsiderServer, "collab_inbox", { wait_seconds: 2 });
    await new Promise((done) => setTimeout(done, 400));
    // Nothing is revealed while the ballot is open.
    expect(revealed(j, opened.ballot)).toEqual([]);
    j.advance(31 * MINUTE);
    const [openerResult, thirdResult] = await Promise.all(waits);
    expect(performance.now() - started).toBeLessThan(5_000);
    for (const result of [openerResult!, thirdResult!]) {
      expect(result.waited).toMatchObject({ ended_by: "ballot_closed", ballot: { id: opened.ballot } });
      expect(result.advice.join(" ")).toContain("closed while you waited");
      const closed = result.items.find((item: any) => item.id === opened.ballot && item.act === "poll" && item.result);
      expect(closed.result.status).toBe("top_choice");
      expect(result.next).toEqual({ tool: "collab_inbox", input: { about: opened.ballot } });
    }
    // The opener is rung by the close; a voter who had not cast is shown it unaddressed.
    expect(openerResult!.items.find((item: any) => item.result).for_me).toBe(true);
    expect(thirdResult!.items.find((item: any) => item.result)).toMatchObject({ for_me: false, to: "all" });
    expect(revealed(j, opened.ballot)).toHaveLength(2);
    expect(closedCount(j, opened.ballot)).toBe(1);
    expect((await outsiderWait).waited.ended_by).toBe("timeout");
  });

  test("a reveal that fails at the close is reveal_pending and never fails the call", async () => {
    let fail = false;
    let j!: Journal;
    j = journal({
      store: {
        reveal_failpoint: (step) => {
          if (fail && step === "appended") throw new Error("injected reveal failure");
        },
      },
    });
    const [opener, peer] = await voters(j, ["opener", "peer"]);
    const opened = await poll(opener!);
    await ok(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    await ok(opener!.server, "collab_inbox", { limit: 50 });
    const waiting = ok(opener!.server, "collab_inbox", { wait_seconds: 20 });
    await new Promise((done) => setTimeout(done, 300));
    fail = true;
    j.advance(31 * MINUTE);
    const result = await waiting;
    expect(result.ok).toBe(true);
    expect(result.waited.ended_by).toBe("ballot_closed");
    expect(result.reveal_pending).toBe("reveal_failed");
    expect(result.advice.join(" ")).toContain("did not finish");
    expect(closedCount(j, opened.ballot)).toBe(0);
    fail = false;
    await ok(opener!.server, "collab_inbox");
    expect(closedCount(j, opened.ballot)).toBe(1);
  });
});

describe("a look-back on an open ballot", () => {
  test("folds as a pass does for a voter who has not cast, and shows no vote", async () => {
    const j = journal();
    const [opener, peer, talker] = await voters(j, ["opener", "peer", "talker"]);
    const opened = await poll(opener!);
    const lean = await ok(opener!.server, "collab_note", { text: "I lean keep: lean-marker-one.", re: opened.ballot, to: "peer" });
    const reply = await ok(talker!.server, "collab_note", { text: "Split wins: lean-marker-two.", re: lean.ids.report });
    await ok(talker!.server, "collab_vote", {
      ballot: opened.ballot, choice: ["split"], why: [{ text: "reason-marker-lookback", basis: "inferred" }], shared: "shared-marker-lookback",
    });
    const marks = j.store.db.query(`SELECT * FROM note_marks ORDER BY session_id`).all();
    for (const include of ["for_me", "all"] as const) {
      const look = await ok(peer!.server, "collab_inbox", { since: 0, include });
      const text = JSON.stringify(look);
      for (const needle of ["lean-marker", "reason-marker-lookback", "shared-marker-lookback"]) expect(text).not.toContain(needle);
      const folded = (look.items as Array<Record<string, any>>).filter((item) => item.folded);
      expect(folded.map((item) => item.id)).toEqual(include === "all" ? [lean.ids.report, reply.ids.report] : [lean.ids.report]);
      expect(look.advice).toContain(FOLDED_LINE);
      if (include === "all") {
        const cast = look.items.find((item: any) => item.act === "vote");
        expect(Object.keys(cast).sort()).toEqual(["act", "at", "for_me", "from", "handle", "id", "sequence", "statement"]);
      }
    }
    expect(j.store.db.query(`SELECT * FROM note_marks ORDER BY session_id`).all()).toEqual(marks);
    // Once the peer's unit has cast, the look-back shows the notes, still no vote.
    await ok(peer!.server, "collab_vote", { ballot: opened.ballot, choice: ["keep"] });
    const after = JSON.stringify(await ok(peer!.server, "collab_inbox", { since: 0 }));
    expect(after).toContain("lean-marker-one");
    expect(after).not.toContain("reason-marker-lookback");
  });
});
