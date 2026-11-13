import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCeremonyCli } from "../src/ceremony.js";
import {
  CARRIED_OBJECTIONS_SENTENCE,
  deskSoftSpots,
  remoteSoftSpots,
  SOFT_SPOTS_HEADING,
  SOFT_SPOTS_NOT_REPORTED,
} from "../src/desk-soft-spots.js";
import { runPersonDeskCli, runPersonRemoteCli, type PersonDeskDeps } from "../src/person-desk.js";
import type { PasskeyAssertion, SessionHandle } from "../src/protocol.js";
import { CollabStore } from "../src/store.js";
import type { TtyPort } from "../src/tty.js";
import { CARRIED_OBJECTIONS_SENTENCE as VIEW_SENTENCE } from "../src/verbs.js";

// The person desk shows the soft spots the agents' proposal views show, as
// display only (Collab Notes spec 6 and 13 q4; the owner's yes of
// 2026-11-12). Nothing a person signs or a store hashes may change, and
// nothing the desk accepts or refuses.

let directory: string;
let root: string;
let otherRoot: string;
let databasePath: string;
let clock: Date;
let store: CollabStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-soft-spots-"));
  root = join(directory, "repo");
  otherRoot = join(directory, "clean-repo");
  mkdirSync(root);
  mkdirSync(otherRoot);
  databasePath = join(directory, "state", "collab.sqlite");
  clock = new Date("2026-11-12T10:00:00.000Z");
  store = new CollabStore(databasePath, { now: () => clock });
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function advance(ms: number): void {
  clock = new Date(clock.getTime() + ms);
}

function desk(argv: string[], deps: PersonDeskDeps = {}) {
  const run = runPersonDeskCli([...argv, "--db", databasePath], {}, { storeNow: () => clock, ...deps });
  return { exitCode: run.exit_code, receipt: JSON.parse(run.line) };
}

function terminal(answer: string | null) {
  const written: string[] = [];
  const port: TtyPort = { write: (text) => { written.push(text); }, readLine: () => answer, close: () => {} };
  return { text: () => written.join(""), openTty: () => port };
}

let keys = 0;
const key = (label: string) => `${label}-${++keys}`;

function start(actor: string, extra: { seat_ref?: string; root_path?: string } = {}): SessionHandle {
  return store.startSession({ root_path: extra.root_path ?? root, actor, ...(extra.seat_ref ? { seat_ref: extra.seat_ref } : {}) });
}

function support(by: SessionHandle, proposalId: string, extra: { confidence_basis?: string } = {}) {
  return store.appendReportForSession({
    ...by.credential, idempotency_key: key("support"), kind: "inference", body: "Yes.",
    relation: "supports", target_report_id: proposalId, ...extra,
  });
}

/**
 * One workspace holding every soft spot, and a second with none:
 * - B replaced A and carries peer's objection to A in its terms; ghost was
 *   consulted and never shown it; peer's support gives no reason; the author
 *   restarted and supports B from a new session with its handle and name;
 *   B closed consented.
 * - C stands challenged by a critic whose session has ended.
 * - D, in another workspace, has a grounded support from its one other voice.
 */
function fixture() {
  const author = start("author", { seat_ref: "host:pane-1" });
  const peer = start("peer");
  const ghost = start("ghost");
  const terms = { criteria: "The desk shows what agents see.", extent: "packages/collab person desk only.", consult_seconds: 600 };
  const a = store.openProposalForSession({ ...author.credential, idempotency_key: key("open"), question: "Show soft spots?", ...terms });
  const objection = store.appendReportForSession({
    ...peer.credential, idempotency_key: key("challenge"), kind: "inference", body: "This hides who was asked.",
    relation: "challenges", target_report_id: a.proposal.id, confidence_basis: "read the view",
  });
  const b = store.openProposalForSession({
    ...author.credential, idempotency_key: key("open"), question: "Show soft spots, revised?", ...terms,
    known_conflicts: `carried objection by peer (report:${objection.id}): This hides who was asked.`,
    supersedes_report_id: a.proposal.id,
  });
  const ungrounded = support(peer, b.proposal.id);
  advance(60_000);
  const again = start("author", { seat_ref: "host:pane-1" });
  const restarted = support(again, b.proposal.id, { confidence_basis: "read the diff" });
  const critic = start("critic");
  const c = store.openProposalForSession({ ...author.credential, idempotency_key: key("open"), question: "Rename the desk?", ...terms });
  const orphan = store.appendReportForSession({
    ...critic.credential, idempotency_key: key("challenge"), kind: "inference", body: "Not without asking the person.",
    relation: "challenges", target_report_id: c.proposal.id,
  });
  store.endSession({ ...critic.credential, reason: "finished" });
  const cleanAuthor = start("clean-author", { root_path: otherRoot });
  const cleanPeer = start("clean-peer", { root_path: otherRoot });
  const d = store.openProposalForSession({ ...cleanAuthor.credential, idempotency_key: key("open"), question: "Keep the clean desk?", ...terms });
  support(cleanPeer, d.proposal.id, { confidence_basis: "ran the tests" });
  // Past B's close: consented on peer's and the restarted author's support, while ghost is still awaited.
  advance(601_000);
  return {
    workspace: author.workspace.id,
    cleanWorkspace: cleanAuthor.workspace.id,
    a: a.proposal.id, b: b.proposal.id, c: c.proposal.id, d: d.proposal.id,
    author, peer, ghost, again, critic, objection, ungrounded, restarted, orphan,
  };
}

describe("soft spots at the person desk", () => {
  test("each soft spot appears in the new JSON key and in the text, read from the agents' own view", () => {
    const f = fixture();
    expect(store.proposalStatus(f.workspace, f.b).ai).toMatchObject({ position: "consented", closed: true, awaiting_voice_ids: [f.ghost.session.id] });

    const shown = desk(["proposals", "--workspace", f.workspace, "--proposal", f.b]).receipt;
    const spots = shown.soft_spots[f.b];
    // The same facts the agents' proposal views read (noteProposalView), selected and worded for the person.
    expect(spots).toEqual(JSON.parse(JSON.stringify(deskSoftSpots(store.noteProposalView(f.workspace, f.b)))));
    expect(spots.awaited_without_delivery).toEqual([{ voice: f.ghost.session.id, name: "ghost", last_seen_minutes: 11 }]);
    expect(spots.flagged_supports).toEqual([{
      report: f.restarted.id,
      by: { session: f.again.session.id, name: "author" },
      voice: f.again.session.id,
      counted: true,
      flags: ["same_seat_as_author", "same_name_as_author", "started_after_open"],
    }]);
    expect(spots.ungrounded).toEqual([{
      report: f.ungrounded.id, relation: "supports", by: { session: f.peer.session.id, name: "peer" }, counted: true,
      basis: "no evidence_refs and no confidence_basis (a legacy report's body is not read for reasons)",
    }]);
    expect(spots.ended_challengers).toEqual([]);
    expect(spots.replaced).toBe(f.a);
    expect(spots.carried_objections).toEqual([{
      challenge: f.objection.id, by: { session: f.peer.session.id, name: "peer" }, voice: f.peer.session.id, raised_on: f.a,
      carried_in_terms: true, standing_on_replaced: true, re_raised_here: false, counted_by_consent_v1: false,
      statement: "This hides who was asked.",
    }]);
    expect(spots.carried_note).toBe(CARRIED_OBJECTIONS_SENTENCE);
    expect(CARRIED_OBJECTIONS_SENTENCE).toBe(VIEW_SENTENCE);
    expect(spots.count).toBe(4);
    expect(spots.display_only).toContain("Display only");
    const lines = spots.lines.join("\n");
    expect(lines).toContain(`Awaited voice "ghost" (voice ${f.ghost.session.id}) has no recorded delivery on the notes surface, last seen 11 min ago`);
    expect(lines).toContain(`Support ${f.restarted.id} by "author" (counted by consent/v1): its session declares the author's host handle`);
    expect(lines).toContain("It may be the author's own voice in another session.");
    expect(lines).toContain(`Support ${f.ungrounded.id} by "peer" (counted by consent/v1) gives no reason and no evidence`);
    expect(lines).toContain(`Objection ${f.objection.id} by "peer", raised on ${f.a}, is carried as text in these terms`);
    expect(lines).toContain('It said: "This hides who was asked."');
    expect(spots.lines.at(-1)).toBe(CARRIED_OBJECTIONS_SENTENCE);

    const challenged = desk(["proposals", "--workspace", f.workspace, "--proposal", f.c]).receipt.soft_spots[f.c];
    expect(challenged.ended_challengers).toEqual([{
      report: f.orphan.id, by: { session: f.critic.session.id, name: "critic" }, voice: f.critic.session.id,
      voice_has_active_session: false, statement: "Not without asking the person.",
    }]);
    expect(challenged.ungrounded.map((item: { report: string }) => item.report)).toEqual([f.orphan.id]);
    expect(challenged.lines.join("\n")).toContain(
      `Challenge ${f.orphan.id} by "critic" still stands, but its challenger's session has ended, and no session of its voice is active to lift it.`,
    );

    // Listing and the inbox carry an entry for every proposal they show.
    const listed = desk(["proposals", "--workspace", f.workspace]).receipt;
    expect(Object.keys(listed.soft_spots).sort()).toEqual(listed.proposals.map((s: { proposal: { id: string } }) => s.proposal.id).sort());
    expect(listed.soft_spots[f.b]).toEqual(spots);
    const inbox = desk(["inbox", "--workspace", f.workspace]).receipt;
    // C closed split and B consented, so both await the person, newest first.
    expect(inbox.inbox.awaiting_person.map((s: { proposal: { id: string } }) => s.proposal.id)).toEqual([f.c, f.b]);
    expect(Object.keys(inbox.soft_spots)).toEqual([f.c, f.b]);
    expect(inbox.soft_spots[f.b]).toEqual(spots);
    expect(inbox.soft_spots[f.c]).toEqual(challenged);
  });

  test("a proposal with none shows none", () => {
    const f = fixture();
    const clean = desk(["proposals", "--workspace", f.cleanWorkspace, "--proposal", f.d]).receipt.soft_spots[f.d];
    expect(clean).toMatchObject({
      position: "consented", awaited_without_delivery: [], flagged_supports: [], ended_challengers: [], ungrounded: [],
      replaced: null, carried_objections: [], count: 0, lines: [],
    });
    expect(clean).not.toHaveProperty("carried_note");
    const tty = terminal("no");
    expect(desk(["consent", "--proposal", f.d], { openTty: tty.openTty }).exitCode).toBe(3);
    expect(tty.text()).not.toContain(SOFT_SPOTS_HEADING);
    expect(tty.text()).not.toContain("\n  - ");
  });

  test("existing keys and values are exactly what the unchanged reads return", () => {
    const f = fixture();
    const roundTrip = (value: unknown) => JSON.parse(JSON.stringify(value));
    const one = desk(["proposals", "--workspace", f.workspace, "--proposal", f.b]).receipt;
    expect(Object.keys(one)).toEqual(["protocol", "command", "status", "proposal", "soft_spots"]);
    expect(one.proposal).toEqual(roundTrip(store.proposalStatus(f.workspace, f.b)));
    const listed = desk(["proposals", "--workspace", f.workspace, "--limit", "10"]).receipt;
    expect(Object.keys(listed)).toEqual(["protocol", "command", "status", "proposals", "unreadable", "soft_spots"]);
    expect({ proposals: listed.proposals, unreadable: listed.unreadable })
      .toEqual(roundTrip(store.listProposalStatuses(f.workspace, { limit: 10 })));
    const inbox = desk(["inbox", "--workspace", f.workspace]).receipt;
    expect(Object.keys(inbox)).toEqual(["protocol", "command", "status", "inbox", "soft_spots"]);
    expect(inbox.inbox).toEqual(roundTrip(store.personInbox(f.workspace)));
    // Verbs that show no proposal are untouched.
    expect(desk(["inbox"]).receipt).not.toHaveProperty("soft_spots");
    expect(desk(["challenge", "--proposal", f.b, "--act", "agree"]).receipt).not.toHaveProperty("soft_spots");
  });

  test("the terminal shows the lines outside the exact bytes, which stay byte-identical", () => {
    const f = fixture();
    // The unchanged code path: what the desk showed and checked before soft spots existed.
    const challenge = store.personActChallenge({ proposal_report_id: f.b, act: "agree" });
    const status = store.proposalStatusById(f.b);
    const bytes = `${challenge.challenge_bytes}\n${status.proposal_bytes}`;
    const sha = createHash("sha256").update(bytes).digest("hex");
    expect(desk(["challenge", "--proposal", f.b, "--act", "agree"]).receipt.challenge).toEqual(JSON.parse(JSON.stringify(challenge)));

    const declined = terminal("no");
    expect(desk(["consent", "--proposal", f.b], { openTty: declined.openTty }).exitCode).toBe(3);
    const text = declined.text();
    const parts = text.split(`exact bytes (${Buffer.byteLength(bytes, "utf8")} bytes, sha256 ${sha}):\n`);
    expect(parts).toHaveLength(2);
    const [summary, shownBytes] = parts as [string, string];
    expect(shownBytes).toBe(`${bytes}\nType yes to record exactly these bytes; anything else cancels: cancelled; nothing was written\n`);
    expect(summary).toContain(`  ${SOFT_SPOTS_HEADING}\n`);
    expect(summary).toContain(`  - Awaited voice "ghost"`);
    expect(summary).toContain(`  - ${CARRIED_OBJECTIONS_SENTENCE}`);
    // Every soft-spot line comes after the existing summary, never inside the bytes.
    expect(summary.indexOf(SOFT_SPOTS_HEADING)).toBeGreaterThan(summary.indexOf("Agreeing authorises only this extent."));
    expect(shownBytes).not.toContain("Awaited voice");

    // A desk that cannot read the soft spots says so; the bytes and the act are unchanged.
    const failing = spyOn(CollabStore.prototype, "personDeskProposalViews").mockImplementation(() => {
      throw new Error("soft spots unavailable in this test");
    });
    try {
      const without = terminal("no");
      desk(["consent", "--proposal", f.b], { openTty: without.openTty });
      expect(without.text().split("exact bytes (")[1]).toBe(text.split("exact bytes (")[1]);
      expect(without.text()).toContain("The soft spots could not be read (internal_error). None are shown, which does not mean there are none.");
      expect(without.text()).not.toContain("Awaited voice");
      expect(desk(["proposals", "--workspace", f.workspace, "--proposal", f.b]).receipt).toMatchObject({
        status: "ok",
        proposal: JSON.parse(JSON.stringify(status)),
        soft_spots: { [f.b]: { unavailable: "internal_error" } },
      });
    } finally {
      failing.mockRestore();
    }

    const agreed = desk(["consent", "--proposal", f.b], { openTty: terminal("yes").openTty }).receipt.proposal;
    expect(agreed.agreement).toMatchObject({ act: "agree", basis: "controlling_terminal" });
    expect(agreed.agreement.ai_snapshot).toEqual(JSON.parse(JSON.stringify(challenge.ai_snapshot)));
    expect(agreed.proposal_sha256).toBe(status.proposal_sha256);
    const event = store.eventsSince(f.workspace).events.at(-1)!;
    expect(event.type).toBe("proposal.agreed");
    expect(event.payload).toMatchObject({
      person_act: { proposal_sha256: status.proposal_sha256, ai_snapshot: JSON.parse(JSON.stringify(challenge.ai_snapshot)) },
    });
    expect(store.verifyJournal(f.workspace)).toBe(true);
  });

  test("the lines change nothing the desk refuses", () => {
    const f = fixture();
    const tty = terminal("yes");
    expect(desk(["consent", "--proposal", f.c], { openTty: tty.openTty }).receipt).toMatchObject({ error: "ai_not_consented" });
    expect(tty.text()).toBe("");
    expect(desk(["challenge", "--proposal", f.c, "--act", "agree"]).receipt.error).toBe("ai_not_consented");
  });

  test("each kind shows ten lines, then how many more the JSON lists", () => {
    const author = start("author");
    const voices = Array.from({ length: 11 }, (_, index) => start(`voice-${index}`));
    const opened = store.openProposalForSession({
      ...author.credential, idempotency_key: key("open"), question: "Many?", criteria: "C", extent: "E",
    });
    for (const voice of voices) support(voice, opened.proposal.id);
    const spots = desk(["proposals", "--workspace", author.workspace.id, "--proposal", opened.proposal.id]).receipt.soft_spots[opened.proposal.id];
    expect(spots.ungrounded).toHaveLength(11);
    expect(spots.lines).toHaveLength(11);
    expect(spots.lines.at(-1)).toBe(
      "…and 1 more stances with no reason or evidence; the JSON key soft_spots of person proposals --proposal lists every one.",
    );
  });
});

describe("soft spots on the signing page", () => {
  const RP_ID = "localhost";
  const port = () => 20_000 + Math.floor(Math.random() * 20_000);
  const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest();

  function makeKey(): { credentialId: string; spki: string; privateKey: KeyObject } {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    return {
      credentialId: Buffer.from(`credential-${Math.random()}`).toString("base64url"),
      spki: (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64url"),
      privateKey,
    };
  }

  function assertion(passkey: ReturnType<typeof makeKey>, challenge: string, origin: string): PasskeyAssertion {
    const authenticatorData = Buffer.concat([sha(RP_ID), Buffer.from([0x05]), Buffer.alloc(4)]);
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin, crossOrigin: false }));
    return {
      credential_id: passkey.credentialId,
      authenticator_data: authenticatorData.toString("base64url"),
      client_data_json: clientData.toString("base64url"),
      signature: sign("sha256", Buffer.concat([authenticatorData, sha(clientData)]), passkey.privateKey).toString("base64url"),
    };
  }

  async function ceremony(argv: string[], remote?: (receipt: Record<string, unknown>) => Record<string, unknown>) {
    let resolveUrl!: (url: URL) => void;
    const url = new Promise<URL>((resolve) => { resolveUrl = resolve; });
    const done = runCeremonyCli(argv, {}, { storeNow: () => clock, openTty: () => null }, {
      out: (line) => resolveUrl(new URL(JSON.parse(line).url)),
      open: () => true,
      note: () => {},
      remote: remote === undefined ? undefined : async (_destination, remoteArgv, stdin) => remote(JSON.parse(runPersonRemoteCli(
        { SSH_ORIGINAL_COMMAND: JSON.stringify(remoteArgv), AGENTOOL_COLLAB_DB: databasePath },
        { storeNow: () => clock, readStdin: () => stdin ?? "" },
      ).line)),
    });
    const page = await Promise.race([url, done.then((result) => { throw new Error(result.line); })]);
    const at = (path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${page.port}${page.pathname}${path}`, {
      ...init,
      headers: { Host: `localhost:${page.port}`, ...(init.headers ?? {}) },
    });
    const html = await (await at("")).text();
    const data = JSON.parse(html.match(/<script type="application\/json" id="data">(.*?)<\/script>/s)![1]!);
    const post = async (body: unknown) => (await at("/done", {
      method: "POST",
      headers: { Origin: `http://localhost:${page.port}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })).json();
    return { data, html, post, done };
  }

  test("the page shows the lines beside the exact bytes, and Touch ID signs the unchanged challenge", async () => {
    const f = fixture();
    const passkey = makeKey();
    const origin = `http://localhost:${port()}`;
    store.enrollPersonPasskey({ credential_id: passkey.credentialId, public_key_spki: passkey.spki, algorithm: -7, rp_id: RP_ID, origin });
    const challenge = store.personActChallenge({ proposal_report_id: f.b, act: "agree" });
    const status = store.proposalStatusById(f.b);
    const page = await ceremony(["ceremony", `--proposal=${f.b}`, "--act=agree", `--db=${databasePath}`]);
    expect(page.data).toMatchObject({
      challenge: challenge.challenge,
      challenge_bytes: challenge.challenge_bytes,
      proposal_bytes: status.proposal_bytes,
      proposal_sha256: status.proposal_sha256,
      position: "consented",
    });
    expect(page.data.soft_spots.note).toBe(SOFT_SPOTS_HEADING);
    expect(page.data.soft_spots.lines).toEqual(deskSoftSpots(store.noteProposalView(f.workspace, f.b)).lines);
    expect(page.html).toContain('<section id="soft" hidden>');
    expect(await page.post({ assertion: assertion(passkey, page.data.challenge, origin) })).toMatchObject({ ok: true, may_proceed: true });
    await page.done;
    const agreed = store.proposalStatusById(f.b);
    expect(agreed.agreement).toMatchObject({ basis: "user_verified_passkey", ai_snapshot: challenge.ai_snapshot });
    expect(agreed.proposal_sha256).toBe(status.proposal_sha256);
    expect(store.verifyJournal(f.workspace)).toBe(true);
  });

  test("a clean proposal's page has no soft-spot section", async () => {
    const f = fixture();
    const passkey = makeKey();
    const origin = `http://localhost:${port()}`;
    store.enrollPersonPasskey({ credential_id: passkey.credentialId, public_key_spki: passkey.spki, algorithm: -7, rp_id: RP_ID, origin });
    const page = await ceremony(["ceremony", `--proposal=${f.d}`, "--act=agree", `--db=${databasePath}`]);
    expect(page.data.soft_spots).toBeNull();
    await page.post({ assertion: assertion(passkey, page.data.challenge, origin) });
    await page.done;
  });

  test("another device's desk: its lines are shown, and an older desk that sends none is said to", async () => {
    const f = fixture();
    const passkey = makeKey();
    const origin = `http://localhost:${port()}`;
    store.enrollPersonPasskey({ credential_id: passkey.credentialId, public_key_spki: passkey.spki, algorithm: -7, rp_id: RP_ID, origin });
    const current = await ceremony(["ceremony", `--proposal=${f.b}`, "--act=agree", "--via=lab"], (receipt) => receipt);
    expect(current.data.soft_spots.lines).toEqual(deskSoftSpots(store.noteProposalView(f.workspace, f.b)).lines);
    await current.post({ assertion: { ...assertion(passkey, current.data.challenge, origin), signature: "AA" } });
    await current.done;
    // The page's listener lingers briefly so the page can read its answer.
    await Bun.sleep(400);
    const older = await ceremony(["ceremony", `--proposal=${f.b}`, "--act=agree", "--via=lab"], (receipt) => {
      const { soft_spots: _dropped, ...rest } = receipt;
      return rest;
    });
    expect(older.data.soft_spots).toEqual({ note: SOFT_SPOTS_HEADING, lines: [SOFT_SPOTS_NOT_REPORTED] });
    expect(older.data.challenge).toBe(store.personActChallenge({ proposal_report_id: f.b, act: "agree" }).challenge);
    expect(await older.post({ assertion: assertion(passkey, older.data.challenge, origin) })).toMatchObject({ ok: true });
    await older.done;
  });

  test("another desk's entry is taken only in the shape this desk writes", () => {
    expect(remoteSoftSpots({}, "report_1")).toBeUndefined();
    expect(remoteSoftSpots({ soft_spots: { report_1: { lines: [1] } } }, "report_1")?.lines[0]).toContain("remote_soft_spots_unreadable");
    expect(remoteSoftSpots({ soft_spots: { report_2: { lines: [] } } }, "report_1")?.lines[0]).toContain("remote_soft_spots_unreadable");
    const many = remoteSoftSpots({ soft_spots: { report_1: { lines: Array.from({ length: 70 }, () => "x".repeat(3_000)), position: "open" } } }, "report_1")!;
    expect(many.lines).toHaveLength(65);
    expect(many.lines[0]).toHaveLength(2_001);
    expect(many.lines.at(-1)).toBe("…and 6 more lines from the other device's desk, not shown here.");
    expect(many.position).toBe("open");
  });
});
