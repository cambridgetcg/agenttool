import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../src/canonical.js";
import { runCeremonyCli } from "../src/ceremony.js";
import {
  CONSENT_RULE_VARIABLES,
  challengeContentBytes,
  challengeContentSha256,
  consentRuleFromEnvironment,
  setAsideChallenge,
} from "../src/consent-v2.js";
import { deskSoftSpots, SET_ASIDE_SENTENCE } from "../src/desk-soft-spots.js";
import { CollabError } from "../src/errors.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import { runPersonDeskCli, runPersonRemoteCli, type PersonDeskDeps } from "../src/person-desk.js";
import { proposalBytes } from "../src/proposal.js";
import {
  CONSENT_RULE,
  CONSENT_RULE_V2,
  type PasskeyAssertion,
  type ProposalStatus,
  type SessionHandle,
} from "../src/protocol.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { CollabStore } from "../src/store-notes.js";
import type { TtyPort } from "../src/tty.js";
import { NOTE_CAPABILITIES } from "../src/verbs.js";

// consent/v2: consent/v1 with one added clause. The person, and only the
// person (terminal or passkey, never a session or MCP), may set aside a
// standing challenge whose voice has no live session, giving a reason. The
// challenge stays on the record; a new challenge stands as usual. Contract:
// design/consent-v2/SPEC.md and PROTOCOL.md "consent/v2".

const RP_ID = "localhost";
const ORIGIN = "http://localhost:17777";
const V2 = { rule: CONSENT_RULE_V2 } as const;
const HOUR = 60 * 60 * 1000;

let directory: string;
let root: string;
let databasePath: string;
let clock: Date;
let store: CollabStore;
let keys = 0;
const key = (label: string) => `${label}-${++keys}`;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-consent-v2-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  clock = new Date("2026-11-13T10:00:00.000Z");
  store = new CollabStore(databasePath, { now: () => clock });
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function advance(ms: number): void {
  clock = new Date(clock.getTime() + ms);
}

function session(actor: string): SessionHandle {
  return store.startSession({ root_path: root, actor });
}

function errorOf(operation: () => unknown): CollabError {
  try {
    operation();
  } catch (error) {
    if (error instanceof CollabError) return error;
    throw error;
  }
  throw new Error("expected operation to fail");
}

const codeOf = (operation: () => unknown) => errorOf(operation).code;

function terminal(answer: string | null) {
  const written: string[] = [];
  let opened = 0;
  const port: TtyPort = { write: (text) => { written.push(text); }, readLine: () => answer, close: () => {} };
  return { text: () => written.join(""), opened: () => opened, openTty: () => { opened += 1; return port; } };
}

function desk(argv: string[], deps: PersonDeskDeps = {}, env: Record<string, string> = {}) {
  const run = runPersonDeskCli([...argv, "--db", databasePath], env, { storeNow: () => clock, ...deps });
  return { exitCode: run.exit_code, receipt: JSON.parse(run.line) };
}

interface TestPasskey {
  credentialId: string;
  spki: string;
  privateKey: KeyObject;
}

function makePasskey(): TestPasskey {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    credentialId: Buffer.from(`credential-${Math.random()}`).toString("base64url"),
    spki: (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64url"),
    privateKey,
  };
}

function sha256(bytes: Buffer | string): Buffer {
  return createHash("sha256").update(bytes).digest();
}

function assert(passkey: TestPasskey, challenge: string, origin = ORIGIN): PasskeyAssertion {
  const authenticatorData = Buffer.concat([sha256(RP_ID), Buffer.from([0x05]), Buffer.alloc(4)]);
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin, crossOrigin: false }));
  return {
    credential_id: passkey.credentialId,
    authenticator_data: authenticatorData.toString("base64url"),
    client_data_json: clientData.toString("base64url"),
    signature: sign("sha256", Buffer.concat([authenticatorData, sha256(clientData)]), passkey.privateKey).toString("base64url"),
  };
}

function enrol(passkey: TestPasskey, origin = ORIGIN): void {
  store.enrollPersonPasskey({ credential_id: passkey.credentialId, public_key_spki: passkey.spki, algorithm: -7, rp_id: RP_ID, origin });
}

/**
 * A proposal the peer supports and the challenger challenges, then the
 * challenger's session ends, so no session of its voice is live. The
 * challenger joins after the open, so once its challenge is set aside the
 * position is consented at once.
 */
function orphanedChallenge(options: { rule?: typeof CONSENT_RULE | typeof CONSENT_RULE_V2; end?: boolean } = {}) {
  const author = session("author");
  const peer = session("peer");
  const opened = store.openProposalForSession({
    ...author.credential,
    idempotency_key: key("open"),
    question: "Adopt consent/v2 for this table?",
    criteria: "An absent objector's challenge must not block for ever.",
    extent: "packages/collab only.",
    consult_seconds: 24 * 60 * 60,
    ...(options.rule ? { rule: options.rule } : V2),
  });
  store.appendReportForSession({
    ...peer.credential, idempotency_key: key("support"), kind: "inference", body: "Yes.",
    relation: "supports", target_report_id: opened.proposal.id,
  });
  const challenger = session("challenger");
  const challenge = store.appendReportForSession({
    ...challenger.credential, idempotency_key: key("challenge"), kind: "inference",
    body: "No: <script>alert(1)</script> the rollout order\nis not written down.",
    relation: "challenges", target_report_id: opened.proposal.id,
  });
  if (options.end !== false) store.endSession({ ...challenger.credential, reason: "the host process exited" });
  return { author, peer, challenger, challenge, proposal: store.proposalStatusById(opened.proposal.id) };
}

function setAsideAtTerminal(proposalId: string, challengeId: string, reason = "Its author left; the order is in PROTOCOL.md now.") {
  const shown = store.personSetAsideChallenge({ proposal_report_id: proposalId, challenge_report_id: challengeId, reason });
  return store.recordSetAsideAtTerminal({
    proposal_report_id: proposalId,
    proposal_sha256: shown.proposal_sha256,
    challenge_report_id: challengeId,
    challenge_sha256: shown.challenge_sha256,
    reason,
    expected_ai_snapshot: shown.ai_snapshot,
  });
}

describe("the rule a host opens proposals under", () => {
  test("unset is consent/v1; both spellings are read; an unknown or conflicting value is refused", () => {
    expect(consentRuleFromEnvironment({})).toBe(CONSENT_RULE);
    expect(consentRuleFromEnvironment({ AGENTOOL_COLLAB_CONSENT_RULE: "" })).toBe(CONSENT_RULE);
    for (const name of CONSENT_RULE_VARIABLES) {
      expect(consentRuleFromEnvironment({ [name]: "consent/v2" })).toBe(CONSENT_RULE_V2);
    }
    expect(codeOf(() => consentRuleFromEnvironment({ AGENTOOL_COLLAB_CONSENT_RULE: "consent/v3" }))).toBe("invalid_consent_rule");
    expect(codeOf(() => consentRuleFromEnvironment({ AGENTOOL_COLLAB_CONSENT_RULE: "v2" }))).toBe("invalid_consent_rule");
    expect(codeOf(() => consentRuleFromEnvironment({
      AGENTOOL_COLLAB_CONSENT_RULE: "consent/v1",
      AGENTTOOL_COLLAB_CONSENT_RULE: "consent/v2",
    }))).toBe("conflicting_consent_rule");
  });

  test("the MCP server and the desk refuse an unknown rule at start", () => {
    expect(codeOf(() => buildCollabMcpServer(store, { environment: { AGENTOOL_COLLAB_CONSENT_RULE: "consent/v9" } })))
      .toBe("invalid_consent_rule");
    session("anyone");
    expect(desk(["workspaces"], {}, { AGENTOOL_COLLAB_CONSENT_RULE: "consent/v9" }).receipt)
      .toMatchObject({ status: "error", error: "invalid_consent_rule" });
  });

  test("this build speaks consent/v2", () => {
    expect(NOTE_CAPABILITIES).toContain("consent/v1");
    expect(NOTE_CAPABILITIES).toContain("consent/v2");
  });

  test("a consent/v2 proposal carries its rule in its bytes, terms, event and status", () => {
    const author = session("author");
    session("peer");
    const opened = store.openProposalForSession({
      ...author.credential, idempotency_key: "v2-open", question: "Q?", criteria: "C", extent: "E", ...V2,
    });
    expect(opened.rule).toBe(CONSENT_RULE_V2);
    expect(opened.terms.rule).toBe(CONSENT_RULE_V2);
    expect(JSON.parse(opened.proposal_bytes).rule).toBe(CONSENT_RULE_V2);
    expect(opened.set_asides).toEqual([]);
    const event = store.eventsSince(opened.proposal.workspace_id).events.find((entry) => entry.type === "proposal.opened")!;
    expect(event.payload.rule).toBe(CONSENT_RULE_V2);
    // The same terms under consent/v1 make different bytes, so the rule is part of what the person signs.
    const { protocol: _protocol, rule: _rule, ...content } = JSON.parse(opened.proposal_bytes) as Record<string, unknown>;
    expect(createHash("sha256").update(proposalBytes(content as never, CONSENT_RULE_V2)).digest("hex")).toBe(opened.proposal_sha256);
    expect(createHash("sha256").update(proposalBytes(content as never, CONSENT_RULE)).digest("hex")).not.toBe(opened.proposal_sha256);
  });

  test("a consent/v1 proposal keeps today's shape: no set_asides key, a four-key snapshot", () => {
    const { proposal } = orphanedChallenge({ rule: CONSENT_RULE });
    expect(proposal.rule).toBe(CONSENT_RULE);
    expect(Object.hasOwn(proposal, "set_asides")).toBe(false);
    const challenge = store.personActChallenge({ proposal_report_id: proposal.proposal.id, act: "reject", reason: "No." });
    expect(Object.keys(challenge.ai_snapshot).sort()).toEqual([
      "closed", "position", "qualifying_support_report_ids", "unresolved_challenge_report_ids",
    ]);
  });

  test("a retry of a consent/v1 open under a consent/v2 host is a different request, not a replay", () => {
    const author = session("author");
    const input = { ...author.credential, idempotency_key: "same-key", question: "Q?", criteria: "C", extent: "E" };
    store.openProposalForSession(input);
    expect(codeOf(() => store.openProposalForSession({ ...input, ...V2 }))).toBe("idempotency_conflict");
  });
});

describe("the set-aside clause", () => {
  test("leaves a set-aside challenge out of the position, and keeps it on the record", () => {
    const { proposal, challenge } = orphanedChallenge();
    expect(proposal.ai).toMatchObject({ position: "challenged", unresolved_challenge_report_ids: [challenge.id] });
    const after = setAsideAtTerminal(proposal.proposal.id, challenge.id);
    expect(after.ai.position).toBe("consented");
    expect(after.ai.unresolved_challenge_report_ids).toEqual([]);
    expect(after.set_asides).toEqual([expect.objectContaining({
      challenge_report_id: challenge.id,
      challenge_sha256: challengeContentSha256(challenge),
      basis: "controlling_terminal",
      party: "person",
      reason: "Its author left; the order is in PROTOCOL.md now.",
      prior_person_acts: 0,
      prior_set_asides: 0,
      ai_snapshot: expect.objectContaining({ position: "challenged", set_aside_challenge_report_ids: [] }),
      proof: null,
    })]);
    // The challenge itself is untouched and still listed.
    expect(store.listReports(proposal.proposal.workspace_id).map((report) => report.id)).toContain(challenge.id);
    expect(store.verifyJournal(proposal.proposal.workspace_id)).toBe(true);
  });

  test("turns a split at the close into the position the rest of the journal gives", () => {
    const author = session("author");
    const peer = session("peer");
    const challenger = session("challenger");
    const opened = store.openProposalForSession({
      ...author.credential, idempotency_key: "split-open", question: "Q?", criteria: "C", extent: "E", consult_seconds: 600, ...V2,
    });
    store.appendReportForSession({ ...peer.credential, idempotency_key: "s", kind: "inference", body: "Yes.", relation: "supports", target_report_id: opened.proposal.id });
    const challenge = store.appendReportForSession({ ...challenger.credential, idempotency_key: "c", kind: "inference", body: "No.", relation: "challenges", target_report_id: opened.proposal.id });
    advance(601_000);
    expect(store.proposalStatusById(opened.proposal.id).ai.position).toBe("split");
    // Live sessions answer for themselves: the challenger is still live, so nothing is set aside.
    expect(codeOf(() => setAsideAtTerminal(opened.proposal.id, challenge.id))).toBe("challenger_present");
    // Six hours of silence and the challenger's session stops being live, though it never ended.
    advance(6 * HOUR + 1_000);
    expect(store.proposalStatusById(opened.proposal.id).ai.position).toBe("split");
    expect(setAsideAtTerminal(opened.proposal.id, challenge.id).ai.position).toBe("consented");
  });

  test("a new challenge after a set-aside stands, from another voice or from the challenger come back", () => {
    const { proposal, challenge, challenger } = orphanedChallenge({ end: false });
    advance(6 * HOUR + 1_000);
    setAsideAtTerminal(proposal.proposal.id, challenge.id);
    expect(store.proposalStatusById(proposal.proposal.id).ai.position).not.toBe("challenged");
    // The challenger's own session comes back and challenges again.
    store.appendReportForSession({
      ...challenger.credential, idempotency_key: key("again"), kind: "inference", body: "Still no.",
      relation: "challenges", target_report_id: proposal.proposal.id,
    });
    let status = store.proposalStatusById(proposal.proposal.id);
    expect(status.ai.position).toBe("challenged");
    expect(status.ai.unresolved_challenge_report_ids).toHaveLength(1);
    expect(status.ai.unresolved_challenge_report_ids[0]).not.toBe(challenge.id);
    // A fresh session is a fresh voice, and its challenge stands too.
    const newcomer = session("newcomer");
    store.appendReportForSession({
      ...newcomer.credential, idempotency_key: key("newcomer"), kind: "inference", body: "No.",
      relation: "challenges", target_report_id: proposal.proposal.id,
    });
    status = store.proposalStatusById(proposal.proposal.id);
    expect(status.ai.unresolved_challenge_report_ids).toHaveLength(2);
    expect(status.set_asides!.map((entry) => entry.challenge_report_id)).toEqual([challenge.id]);
  });

  test("a consent/v1 proposal never gains a set-aside, whatever the table holds", () => {
    const { proposal, challenge } = orphanedChallenge({ rule: CONSENT_RULE });
    expect(errorOf(() => store.personSetAsideChallenge({
      proposal_report_id: proposal.proposal.id, challenge_report_id: challenge.id, reason: "Gone.",
    }))).toMatchObject({ code: "rule_has_no_set_aside", details: { rule: CONSENT_RULE, remedy: expect.any(String) } });
    store.db.query(`
      INSERT INTO proposal_set_asides (id, workspace_id, proposal_report_id, challenge_report_id, set_aside_json, created_at, event_sequence)
      VALUES ('set_aside_forged', ?, ?, ?, '{}', ?, 1)
    `).run(proposal.proposal.workspace_id, proposal.proposal.id, challenge.id, clock.toISOString());
    const status = store.proposalStatusById(proposal.proposal.id);
    expect(status.ai.position).toBe("challenged");
    expect(Object.hasOwn(status, "set_asides")).toBe(false);
  });

  test("every refusal has its code and a remedy", () => {
    const { author, peer, proposal, challenge } = orphanedChallenge();
    const id = proposal.proposal.id;
    const issue = (challengeId: string, reason: unknown = "A reason.") =>
      errorOf(() => store.personSetAsideChallenge({ proposal_report_id: id, challenge_report_id: challengeId, reason }));
    // Not a challenge to this proposal.
    const support = store.listReports(proposal.proposal.workspace_id).find((report) => report.relation === "supports")!;
    expect(issue(support.id)).toMatchObject({ code: "challenge_not_standing", details: { challenge_state: "not_a_challenge_to_this_proposal" } });
    expect(issue("report_unknown").code).toBe("challenge_not_standing");
    // invalid_reason
    expect(issue(challenge.id, "").code).toBe("invalid_reason");
    expect(issue(challenge.id, "   ").code).toBe("invalid_reason");
    expect(issue(challenge.id, "x".repeat(2_001)).code).toBe("invalid_reason");
    expect(codeOf(() => store.personSetAsideChallenge({ proposal_report_id: id, challenge_report_id: challenge.id, reason: undefined })))
      .toBe("invalid_reason");
    // challenger_present names the live sessions.
    const live = session("live-challenger");
    const present = store.appendReportForSession({
      ...live.credential, idempotency_key: key("present"), kind: "inference", body: "I am here.",
      relation: "challenges", target_report_id: id,
    });
    expect(issue(present.id)).toMatchObject({
      code: "challenger_present",
      details: { live_sessions: [{ id: live.session.id, actor: "live-challenger", last_seen_at: clock.toISOString() }] },
    });
    // A challenge lifted by its own voice no longer stands.
    store.appendReportForSession({
      ...live.credential, idempotency_key: key("lift"), kind: "inference", body: "Answered.",
      relation: "resolves", target_report_id: present.id,
    });
    store.endSession({ ...live.credential, reason: "done" });
    expect(issue(present.id)).toMatchObject({ code: "challenge_not_standing", details: { challenge_state: "withdrawn_or_lifted_by_its_voice" } });
    // already_set_aside
    setAsideAtTerminal(id, challenge.id);
    expect(issue(challenge.id)).toMatchObject({ code: "already_set_aside", details: { challenge_report_id: challenge.id } });
    // The terminal record re-checks the bytes, the challenge text and the position shown.
    const second = session("second");
    const other = store.appendReportForSession({
      ...second.credential, idempotency_key: key("other"), kind: "inference", body: "Another no.",
      relation: "challenges", target_report_id: id,
    });
    store.endSession({ ...second.credential, reason: "gone" });
    const shown = store.personSetAsideChallenge({ proposal_report_id: id, challenge_report_id: other.id, reason: "Gone." });
    const record = (overrides: Record<string, unknown>) => errorOf(() => store.recordSetAsideAtTerminal({
      proposal_report_id: id,
      proposal_sha256: shown.proposal_sha256,
      challenge_report_id: other.id,
      challenge_sha256: shown.challenge_sha256,
      reason: "Gone.",
      expected_ai_snapshot: shown.ai_snapshot,
      ...overrides,
    }));
    expect(record({ proposal_sha256: "0".repeat(64) }).code).toBe("proposal_hash_mismatch");
    expect(record({ challenge_sha256: "0".repeat(64) }).code).toBe("challenge_hash_mismatch");
    store.appendReportForSession({
      ...peer.credential, idempotency_key: key("late-support"), kind: "inference", body: "Me too, again.",
      relation: "supports", target_report_id: id,
    });
    expect(record({}).code).toBe("ai_position_changed");
    // proposal_not_on_table
    store.appendReportForSession({
      ...author.credential, idempotency_key: key("withdraw"), kind: "inference", body: "Withdrawn.",
      relation: "withdraws", target_report_id: id,
    });
    expect(issue(other.id).code).toBe("proposal_not_on_table");
    // Each refusal says what the person can do instead.
    for (const error of [
      issue(other.id), issue(challenge.id, ""),
      record({ proposal_sha256: "0".repeat(64) }), record({ challenge_sha256: "0".repeat(64) }),
    ]) {
      expect(typeof error.details.remedy).toBe("string");
      expect((error.details.remedy as string).length).toBeGreaterThan(20);
    }
  });

  test("nothing records a set-aside but the person's terminal or passkey: no MCP tool, no note act", async () => {
    const { peer, proposal, challenge } = orphanedChallenge();
    const credentialFile = writeSessionCredentialFile(store.defaultSessionCredentialPath(peer.session.id), peer.credential);
    const server = buildCollabMcpServer(store, {
      environment: { AGENTOOL_COLLAB_CONSENT_RULE: "consent/v2" },
      resumed_session: { handle: peer, credential_file: credentialFile },
    });
    const registered = (server as unknown as { _registeredTools: Record<string, { handler?: Function; callback?: Function }> })._registeredTools;
    expect(Object.keys(registered).some((name) => /set.?aside/.test(name))).toBe(false);
    const note = registered.collab_note!;
    const result = await (note.handler ?? note.callback)!({ act: "set_aside", text: "Set it aside.", re: challenge.id }, {}) as {
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(store.proposalStatusById(proposal.proposal.id).set_asides).toEqual([]);
  });

  test("the set-aside event wakes the proposal's author, and the table is rebuilt from the journal", () => {
    const { author, peer, proposal, challenge } = orphanedChallenge();
    const before = store.proposalStatusById(proposal.proposal.id);
    setAsideAtTerminal(proposal.proposal.id, challenge.id);
    const event = store.eventsSince(proposal.proposal.workspace_id).events.at(-1)!;
    expect(event.type).toBe("proposal.challenge_set_aside");
    expect(event.actor).toBe("person:terminal");
    expect(store.eventAddressesSession(event, author.session.id)).toBe(true);
    expect(store.eventAddressesSession(event, peer.session.id)).toBe(false);
    const recorded = canonicalJson(store.proposalStatusById(proposal.proposal.id));
    expect(recorded).not.toBe(canonicalJson(before));
    store.close();
    const db = new Database(databasePath);
    db.exec(`DROP TABLE proposal_set_asides`);
    db.close();
    store = new CollabStore(databasePath, { now: () => clock });
    expect(canonicalJson(store.proposalStatusById(proposal.proposal.id))).toBe(recorded);
  });
});

describe("an agreement binds the set-asides it rests on", () => {
  test("the agreement's snapshot names them, and a position shown before a set-aside is refused", () => {
    const { proposal, challenge } = orphanedChallenge();
    const id = proposal.proposal.id;
    // A rejection prepared before the set-aside goes stale once it is recorded.
    const shownReject = store.personActChallenge({ proposal_report_id: id, act: "reject", reason: "Not yet." });
    setAsideAtTerminal(id, challenge.id);
    expect(codeOf(() => store.recordPersonActAtTerminal({
      proposal_report_id: id, proposal_sha256: proposal.proposal_sha256, act: "reject", reason: "Not yet.",
      expected_ai_snapshot: shownReject.ai_snapshot,
    }))).toBe("ai_position_changed");
    const shown = store.personActChallenge({ proposal_report_id: id, act: "agree" });
    expect(shown.ai_snapshot.set_aside_challenge_report_ids).toEqual([challenge.id]);
    expect(JSON.parse(shown.challenge_bytes).ai_snapshot.set_aside_challenge_report_ids).toEqual([challenge.id]);
    const agreed = store.recordPersonActAtTerminal({
      proposal_report_id: id, proposal_sha256: proposal.proposal_sha256, act: "agree", expected_ai_snapshot: shown.ai_snapshot,
    });
    expect(agreed.may_proceed).toBe(true);
    expect(agreed.agreement!.ai_snapshot).toEqual({
      position: "consented",
      closed: false,
      qualifying_support_report_ids: agreed.ai.qualifying_support_report_ids,
      unresolved_challenge_report_ids: [],
      set_aside_challenge_report_ids: [challenge.id],
    });
  });

  test("the set-aside bytes name the proposal, the challenge's content hash, the reason, the counts and the position", () => {
    const { proposal, challenge } = orphanedChallenge();
    const shown = store.personSetAsideChallenge({ proposal_report_id: proposal.proposal.id, challenge_report_id: challenge.id, reason: "Gone." });
    expect(JSON.parse(shown.challenge_bytes)).toEqual({
      protocol: "agenttool.collab-person-set-aside/1",
      act: "set_aside",
      workspace_id: proposal.proposal.workspace_id,
      proposal_report_id: proposal.proposal.id,
      proposal_sha256: proposal.proposal_sha256,
      challenge_report_id: challenge.id,
      challenge_sha256: createHash("sha256").update(challengeContentBytes(challenge)).digest("hex"),
      reason: "Gone.",
      prior_person_acts: 0,
      prior_set_asides: 0,
      ai_snapshot: { ...shown.ai_snapshot },
    });
    expect(shown.challenge).toBe(sha256(shown.challenge_bytes).toString("base64url"));
    expect(shown.objection).toMatchObject({ id: challenge.id, body: challenge.body, from_actor: "challenger", author_basis: "self_declared" });
    expect(shown.challenger).toMatchObject({ voice_id: expect.any(String), session_ids: [expect.any(String)] });
  });
});

describe("a set-aside with a passkey", () => {
  test("records once with its proof, and an old assertion cannot be replayed", () => {
    const passkey = makePasskey();
    enrol(passkey);
    const { proposal, challenge } = orphanedChallenge();
    const second = session("second");
    const other = store.appendReportForSession({
      ...second.credential, idempotency_key: key("other"), kind: "inference", body: "Also no.",
      relation: "challenges", target_report_id: proposal.proposal.id,
    });
    store.endSession({ ...second.credential, reason: "gone" });
    const id = proposal.proposal.id;
    const issued = desk(["challenge", "--proposal", id, "--act", "set-aside", "--challenge", challenge.id, "--reason", "Gone."]).receipt.challenge;
    expect(issued.passkeys.map((item: { credential_id: string }) => item.credential_id)).toEqual([passkey.credentialId]);
    const assertion = assert(passkey, issued.challenge);
    const recorded = desk(["set-aside", "--proposal", id, "--challenge", challenge.id, "--reason", "Gone.", "--passkey-assertion", "-"], {
      readStdin: () => JSON.stringify(assertion),
    }).receipt.proposal as ProposalStatus;
    expect(recorded.set_asides![0]).toMatchObject({
      basis: "user_verified_passkey",
      proof: { public_key_spki: passkey.spki, challenge: issued.challenge, challenge_bytes: issued.challenge_bytes },
    });
    // The same assertion again, on the same challenge: refused by what changed.
    expect(desk(["set-aside", "--proposal", id, "--challenge", challenge.id, "--reason", "Gone.", "--passkey-assertion", "-"], {
      readStdin: () => JSON.stringify(assertion),
    }).receipt.error).toBe("already_set_aside");
    // Onto another challenge, or as an agreement: it signs other bytes.
    expect(desk(["set-aside", "--proposal", id, "--challenge", other.id, "--reason", "Gone.", "--passkey-assertion", "-"], {
      readStdin: () => JSON.stringify(assertion),
    }).receipt.error).toBe("passkey_challenge_mismatch");
    expect(codeOf(() => store.recordPersonActWithPasskey({ proposal_report_id: id, act: "reject", reason: "Gone.", assertion })))
      .toBe("passkey_challenge_mismatch");
    // A set-aside challenge issued before another set-aside goes stale: the count and the position moved.
    const stale = store.personSetAsideChallenge({ proposal_report_id: id, challenge_report_id: other.id, reason: "Gone." });
    expect(stale.prior_set_asides).toBe(1);
    expect(stale.ai_snapshot.set_aside_challenge_report_ids).toEqual([challenge.id]);
    expect(setAsideChallenge({ ...stale, prior_set_asides: 0 }).challenge).not.toBe(stale.challenge);
  });

  test("a challenger who comes back before the assertion is used is answered as present", () => {
    const passkey = makePasskey();
    enrol(passkey);
    const { proposal, challenge, challenger } = orphanedChallenge({ end: false });
    advance(6 * HOUR + 1_000);
    const issued = store.personSetAsideChallenge({ proposal_report_id: proposal.proposal.id, challenge_report_id: challenge.id, reason: "Gone." });
    store.resumeSession(challenger.credential);
    expect(codeOf(() => store.recordSetAsideWithPasskey({
      proposal_report_id: proposal.proposal.id, challenge_report_id: challenge.id, reason: "Gone.",
      assertion: assert(passkey, issued.challenge),
    }))).toBe("challenger_present");
  });
});

describe("the desk", () => {
  test("shows the objection in full before the terminal act, and records only on yes", () => {
    const { proposal, challenge } = orphanedChallenge();
    const id = proposal.proposal.id;
    const argv = ["set-aside", "--proposal", id, "--challenge", challenge.id, "--reason", "Its author left the table."];
    expect(desk(argv, { openTty: () => null }).receipt).toMatchObject({ status: "error", error: "tty_unavailable" });
    const declined = terminal("no");
    expect(desk(argv, { openTty: declined.openTty })).toMatchObject({ exitCode: 3, receipt: { status: "cancelled", command: "person set-aside" } });
    expect(store.proposalStatusById(id).set_asides).toEqual([]);
    const accepted = terminal("yes");
    const done = desk(argv, { openTty: accepted.openTty });
    expect(done.exitCode).toBe(0);
    expect(done.receipt.proposal).toMatchObject({ ai: { position: "consented" }, set_asides: [{ challenge_report_id: challenge.id }] });
    const shown = accepted.text();
    expect(shown).toContain("person act set aside a challenge");
    expect(shown).toContain(`challenge ${challenge.id} by "challenger" (name self-declared), written ${challenge.created_at}`);
    expect(shown).toContain(`it says ${JSON.stringify(challenge.body)}`);
    expect(shown).toContain("why it can be set aside: no session of its voice is live (last seen");
    expect(shown).toContain(`your reason "Its author left the table."`);
    expect(shown).toContain(challengeContentBytes(challenge));
    expect(shown).toContain(proposal.proposal_bytes);
    // The bytes shown name every hash the act binds; the soft spots follow the summary.
    expect(shown.indexOf("why it can be set aside")).toBeLessThan(shown.indexOf("exact bytes"));
    expect(desk(argv, { openTty: terminal("yes").openTty }).receipt.error).toBe("already_set_aside");
  });

  test("refuses a bad set-aside before any prompt, and parses --act and --challenge strictly", () => {
    const { proposal, challenge } = orphanedChallenge({ rule: CONSENT_RULE });
    const tty = terminal("yes");
    expect(desk(["set-aside", "--proposal", proposal.proposal.id, "--challenge", challenge.id, "--reason", "Gone."], { openTty: tty.openTty }).receipt)
      .toMatchObject({ error: "rule_has_no_set_aside", remedy: expect.any(String) });
    expect(tty.opened()).toBe(0);
    expect(desk(["set-aside", "--proposal", proposal.proposal.id, "--challenge", challenge.id]).receipt.error).toBe("usage_error");
    expect(desk(["challenge", "--proposal", proposal.proposal.id, "--act", "set-aside", "--reason", "x"]).receipt.error).toBe("usage_error");
    expect(desk(["challenge", "--proposal", proposal.proposal.id, "--act", "agree", "--challenge", challenge.id]).receipt.error).toBe("usage_error");
    expect(desk(["challenge", "--proposal", proposal.proposal.id, "--act", "lift"]).receipt.error).toBe("usage_error");
  });

  test("person proposals lists, per standing challenge, whether it can be set aside and why not", () => {
    const { proposal, challenge } = orphanedChallenge();
    const live = session("live-challenger");
    const present = store.appendReportForSession({
      ...live.credential, idempotency_key: key("present"), kind: "inference", body: "Here.",
      relation: "challenges", target_report_id: proposal.proposal.id,
    });
    const read = desk(["proposals", "--workspace", proposal.proposal.workspace_id, "--proposal", proposal.proposal.id]).receipt;
    expect(read.set_aside_options[proposal.proposal.id]).toEqual([
      expect.objectContaining({ challenge_report_id: challenge.id, can_set_aside: true, refusal: null, by: { session: expect.any(String), name: "challenger", basis: "self_declared" } }),
      expect.objectContaining({ challenge_report_id: present.id, can_set_aside: false, refusal: expect.objectContaining({ error: "challenger_present" }) }),
    ]);
    const listed = desk(["proposals", "--workspace", proposal.proposal.workspace_id]).receipt;
    expect(Object.keys(listed.set_aside_options)).toEqual([proposal.proposal.id]);
    // A consent/v1 read keeps its exact keys.
    const v1 = orphanedChallenge({ rule: CONSENT_RULE });
    const v1Read = desk(["proposals", "--workspace", v1.proposal.proposal.workspace_id, "--proposal", v1.proposal.proposal.id]).receipt;
    expect(Object.keys(v1Read).sort()).toEqual(["command", "proposal", "protocol", "soft_spots", "status"]);
  });

  test("the soft spots name the proposal's rule and give each set-aside a line", () => {
    const { proposal, challenge } = orphanedChallenge();
    setAsideAtTerminal(proposal.proposal.id, challenge.id, "Its author left.");
    const [view] = store.personDeskProposalViews(proposal.proposal.workspace_id, [proposal.proposal.id]);
    if (!view || !("view" in view)) throw new Error("the desk could not read the proposal's view");
    const spots = deskSoftSpots(view.view);
    expect(spots.rule).toBe(CONSENT_RULE_V2);
    expect(spots.set_asides).toEqual([expect.objectContaining({ challenge: challenge.id, reason: "Its author left.", basis: "controlling_terminal" })]);
    expect(spots.lines.some((line) => line.startsWith(`Challenge ${challenge.id} by "challenger" was set aside by the person at`)
      && line.includes(`Reason: "Its author left."`))).toBe(true);
    expect(spots.lines).toContain(SET_ASIDE_SENTENCE);
  });

  test("person propose opens under the desk's configured rule", () => {
    const first = session("first");
    const opened = desk(["propose", "--workspace", first.workspace.id, "--question", "Q?", "--criteria", "C", "--extent", "E",
      "--idempotency-key", "desk-v2"], {}, { AGENTOOL_COLLAB_CONSENT_RULE: "consent/v2" }).receipt.proposal;
    expect(opened.rule).toBe(CONSENT_RULE_V2);
    const plain = desk(["propose", "--workspace", first.workspace.id, "--question", "Q2?", "--criteria", "C", "--extent", "E",
      "--idempotency-key", "desk-v1"]).receipt.proposal;
    expect(plain.rule).toBe(CONSENT_RULE);
  });

  test("person-remote accepts a set-aside only with a passkey assertion on stdin", () => {
    const passkey = makePasskey();
    enrol(passkey);
    const { proposal, challenge } = orphanedChallenge();
    const remote = (argv: string[], stdin?: string) => JSON.parse(runPersonRemoteCli(
      { SSH_ORIGINAL_COMMAND: JSON.stringify(argv), AGENTOOL_COLLAB_DB: databasePath },
      { storeNow: () => clock, readStdin: () => stdin ?? "" },
    ).line);
    const base = [`--proposal=${proposal.proposal.id}`, `--challenge=${challenge.id}`, "--reason=Gone."];
    expect(remote(["set-aside", ...base]).error).toBe("remote_verb_refused");
    const issued = remote(["challenge", `--proposal=${proposal.proposal.id}`, "--act=set-aside", `--challenge=${challenge.id}`, "--reason=Gone."]).challenge;
    const recorded = remote(["set-aside", ...base, "--passkey-assertion=-"], JSON.stringify(assert(passkey, issued.challenge)));
    expect(recorded).toMatchObject({ status: "ok", proposal: { ai: { position: "consented" } } });
  });
});

async function runCeremony(argv: string[], deps: PersonDeskDeps) {
  let resolveUrl!: (url: URL) => void;
  const url = new Promise<URL>((resolve) => { resolveUrl = resolve; });
  const done = runCeremonyCli(argv, {}, { storeNow: () => clock, ...deps }, {
    out: (line) => resolveUrl(new URL(JSON.parse(line).url)),
    open: () => true,
    note: () => {},
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

describe("the ceremony page", () => {
  test("shows the objection and the reason as text, and records one passkey set-aside", async () => {
    const passkey = makePasskey();
    const origin = `http://localhost:${20_000 + Math.floor(Math.random() * 20_000)}`;
    enrol(passkey, origin);
    const { proposal, challenge } = orphanedChallenge();
    const reason = "</script><img src=x onerror=alert(2)> the author left";
    const ceremony = await runCeremony([
      "ceremony", `--proposal=${proposal.proposal.id}`, "--act=set-aside", `--challenge=${challenge.id}`,
      `--reason=${reason}`, `--db=${databasePath}`,
    ], { openTty: () => null });
    expect(ceremony.data).toMatchObject({
      kind: "sign",
      act: "set-aside",
      reason,
      objection: {
        id: challenge.id,
        by: "challenger",
        by_basis: "self-declared",
        written_at: challenge.created_at,
        text: challenge.body,
        why: expect.stringContaining("No session of its voice is live"),
        content_bytes: challengeContentBytes(challenge),
      },
      proposal_bytes: proposal.proposal_bytes,
    });
    // Agent-written and person-typed text reach the page only as JSON data, never as markup.
    expect(ceremony.html).not.toContain("<script>alert(1)</script>");
    expect(ceremony.html).not.toContain("<img src=x");
    expect(ceremony.html).not.toContain("</script><img");
    expect(ceremony.html).toContain("\\u003cscript\\u003ealert(1)\\u003c/script\\u003e");
    expect(ceremony.html).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    const posted = await ceremony.post({ assertion: assert(passkey, ceremony.data.challenge, origin) });
    expect(posted).toMatchObject({ ok: true, set_aside: challenge.id, position: "consented" });
    expect(JSON.parse((await ceremony.done).line)).toMatchObject({ status: "ok", recorded: true, set_aside: challenge.id });
    expect(store.proposalStatusById(proposal.proposal.id).set_asides![0]).toMatchObject({ basis: "user_verified_passkey", reason });
  });

  test("refuses a set-aside the desk would refuse before serving a page", async () => {
    const passkey = makePasskey();
    enrol(passkey);
    const { proposal, challenge } = orphanedChallenge({ end: false });
    const result = await runCeremonyCli([
      "ceremony", `--proposal=${proposal.proposal.id}`, "--act=set-aside", `--challenge=${challenge.id}`, "--reason=Gone.",
      `--db=${databasePath}`,
    ], {}, { storeNow: () => clock, openTty: () => null }, { out: () => { throw new Error("served a page"); } });
    expect(JSON.parse(result.line)).toMatchObject({ status: "error", error: "challenger_present" });
  });
});

describe("the notes views", () => {
  // One credential file per session, as one host keeps it; each call is a fresh MCP process on it.
  const files = new Map<string, string>();
  function served(handle: SessionHandle, environment: Record<string, string> = {}) {
    let credentialFile = files.get(handle.session.id);
    if (!credentialFile) {
      credentialFile = writeSessionCredentialFile(store.defaultSessionCredentialPath(handle.session.id), handle.credential);
      files.set(handle.session.id, credentialFile);
    }
    return buildCollabMcpServer(store, { environment, resumed_session: { handle, credential_file: credentialFile } });
  }

  async function tool(server: unknown, name: string, args: Record<string, unknown>) {
    const registration = (server as { _registeredTools: Record<string, { handler?: Function; callback?: Function }> })._registeredTools[name]!;
    const result = await (registration.handler ?? registration.callback)!(args, {}) as { isError?: boolean; structuredContent: Record<string, any> };
    if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.structuredContent)}`);
    return result.structuredContent;
  }

  test("collab_propose opens under the configured rule and words its result by it", async () => {
    const author = session("author");
    session("peer");
    const v2 = await tool(served(author, { AGENTOOL_COLLAB_CONSENT_RULE: "consent/v2" }), "collab_propose", {
      question: "Use consent/v2 here?", criteria: "C", extent: "E",
    });
    expect(v2.rule).toBe(CONSENT_RULE_V2);
    expect(v2.effect).toContain("to settle by consent/v2");
    expect(v2.status.rule).toBe(CONSENT_RULE_V2);
    expect(v2.annotations).toContain("consent/v2's");
    const v1 = await tool(served(author), "collab_propose", { question: "And consent/v1 here?", criteria: "C", extent: "E" });
    expect(v1.effect).toContain("to settle by consent/v1");
    expect(Object.hasOwn(v1, "rule")).toBe(false);
    expect(Object.hasOwn(v1, "set_asides")).toBe(false);
  });

  test("collab_proposal_open opens under the configured rule", async () => {
    const author = session("author");
    const opened = await tool(served(author, { AGENTOOL_COLLAB_CONSENT_RULE: "consent/v2" }), "collab_proposal_open", {
      workspace_id: author.workspace.id, idempotency_key: "legacy-v2", question: "Q?", criteria: "C", extent: "E",
    });
    expect(opened.proposal.rule).toBe(CONSENT_RULE_V2);
  });

  test("collab_inbox about advises the exact set-aside command on consent/v2, and keeps today's advice on consent/v1", async () => {
    const { peer, proposal, challenge } = orphanedChallenge();
    const about = await tool(served(peer), "collab_inbox", { about: proposal.proposal.id });
    const line = about.advice.find((entry: string) => entry.startsWith(`set_aside_possible: ${challenge.id}`));
    expect(line).toContain(`agenttool-collab-host person set-aside --proposal ${proposal.proposal.id} --challenge ${challenge.id} --reason '<the person's reason>'`);
    expect(line).toContain("an agent that runs it");
    expect(about.for_the_person.set_aside).toEqual([expect.objectContaining({
      challenge: challenge.id,
      passkey: expect.stringContaining(`person ceremony --proposal ${proposal.proposal.id} --act set-aside --challenge ${challenge.id}`),
    })]);
    expect(about.challenges.find((stance: { id: string }) => stance.id === challenge.id))
      .toMatchObject({ standing: true, voice_has_live_session: false });
    expect(about.needs).toContain("the person can set one aside at the desk");

    const v1 = orphanedChallenge({ rule: CONSENT_RULE });
    const v1About = await tool(served(v1.peer), "collab_inbox", { about: v1.proposal.proposal.id });
    expect(v1About.advice.some((entry: string) => entry.startsWith(`challenger_ended: ${v1.challenge.id}`))).toBe(true);
    expect(v1About.advice.some((entry: string) => entry.includes("set-aside"))).toBe(false);
    expect(Object.hasOwn(v1About.for_the_person, "set_aside")).toBe(false);
    expect(Object.hasOwn(v1About.challenges[0], "voice_has_live_session")).toBe(false);
  });

  test("a replacement carries a set-aside objection exactly as consent/v1 carries one never lifted", async () => {
    const TERMS = { question: "Adopt X?", criteria: "C", extent: "E" };
    const carriedBy = async (rule: string) => {
      const env = { AGENTOOL_COLLAB_CONSENT_RULE: rule };
      const alpha = session(`alpha-${rule}`);
      const delta = session(`delta-${rule}`);
      const first = await tool(served(alpha, env), "collab_propose", { ...TERMS, question: `Adopt X under ${rule}?` });
      const challenged = await tool(served(delta, env), "collab_note", {
        act: "challenge", text: "No: the rollout is unsafe.", re: first.ids.proposal,
      });
      store.endSession({ ...delta.credential, reason: "done" });
      if (rule === CONSENT_RULE_V2) setAsideAtTerminal(first.ids.proposal, challenged.ids.report, "Its author left.");
      const replacing = await tool(served(alpha, env), "collab_propose", {
        ...TERMS, question: `Adopt X under ${rule}, revised?`, replaces: first.ids.proposal,
      });
      const [view] = store.personDeskProposalViews(alpha.workspace.id, [replacing.ids.proposal]);
      if (!view || !("view" in view)) throw new Error("the desk could not read the replacement's view");
      return { challenge: challenged.ids.report as string, replacing, spots: deskSoftSpots(view.view) };
    };
    const v1 = await carriedBy(CONSENT_RULE);
    expect(v1.replacing.status.terms.known_conflicts).toContain(`report:${v1.challenge}`);
    const v2 = await carriedBy(CONSENT_RULE_V2);
    // The set-aside challenge was never lifted, so the replacement's terms carry it and every view names it.
    expect(v2.replacing.status.terms.known_conflicts)
      .toBe(`carried objection by delta-consent/v2 (report:${v2.challenge}): No: the rollout is unsafe.`);
    expect(v2.spots.carried_objections).toEqual([expect.objectContaining({
      challenge: v2.challenge, carried_in_terms: true, standing_on_replaced: false,
    })]);
    const line = v2.spots.lines.find((entry) => entry.startsWith(`Objection ${v2.challenge}`));
    expect(line).toContain("was set aside by the person where it was raised");
    expect(line).toContain(`Reason: "Its author left."`);
    expect(v2.replacing.carried_objections).toEqual([expect.objectContaining({
      challenge: v2.challenge, carried_in_terms: true, set_aside_on_replaced: expect.objectContaining({ reason: "Its author left." }),
    })]);
    // The objector is listed as v1 lists one, unreachable here because its session ended.
    expect(v2.replacing.unreachable_objectors).toEqual([expect.objectContaining({ challenges: [v2.challenge] })]);
    expect(v1.replacing.unreachable_objectors).toEqual([expect.objectContaining({ challenges: [v1.challenge] })]);
    // A consent/v1 carry keeps its exact keys.
    expect(Object.keys(v1.spots.carried_objections[0]!).sort()).toEqual([
      "by", "carried_in_terms", "challenge", "counted_by_consent_v1", "raised_on", "re_raised_here", "standing_on_replaced", "statement", "voice",
    ]);
  });

  test("a withdrawal is addressed to a set-aside objector, as consent/v1 addresses an unlifted one", async () => {
    const withdrawnTo = async (rule: string) => {
      const env = { AGENTOOL_COLLAB_CONSENT_RULE: rule };
      const alpha = session(`alpha-${rule}`);
      const delta = session(`delta-${rule}`);
      const first = await tool(served(alpha, env), "collab_propose", { question: `Adopt Z under ${rule}?`, criteria: "C", extent: "E" });
      const challenged = await tool(served(delta, env), "collab_note", { act: "challenge", text: "No: unsafe.", re: first.ids.proposal });
      store.endSession({ ...delta.credential, reason: "done" });
      if (rule === CONSENT_RULE_V2) setAsideAtTerminal(first.ids.proposal, challenged.ids.report, "Its author left.");
      const withdrawn = await tool(served(alpha, env), "collab_note", { act: "withdraw", text: "Withdrawn after all.", re: first.ids.proposal });
      const report = store.listReports(alpha.workspace.id).find((entry) => entry.id === withdrawn.ids.report)!;
      return { to: report.to_session_id, delta: delta.session.id };
    };
    const v1 = await withdrawnTo(CONSENT_RULE);
    expect(v1.to).toBe(v1.delta);
    const v2 = await withdrawnTo(CONSENT_RULE_V2);
    expect(v2.to).toBe(v2.delta);
  });

  test("a set-aside challenge its own voice lifted later is not carried, as consent/v1 carries no lifted one", async () => {
    const env = { AGENTOOL_COLLAB_CONSENT_RULE: "consent/v2" };
    const alpha = session("alpha");
    const delta = session("delta");
    const first = await tool(served(alpha, env), "collab_propose", { question: "Adopt Y?", criteria: "C", extent: "E" });
    const challenged = await tool(served(delta, env), "collab_note", { act: "challenge", text: "No: unsafe.", re: first.ids.proposal });
    advance(6 * HOUR + 1_000);
    setAsideAtTerminal(first.ids.proposal, challenged.ids.report, "Its author went quiet.");
    // The challenger's own session comes back and lifts its challenge.
    const back = store.resumeSession(delta.credential);
    store.appendReportForSession({
      ...back.credential, idempotency_key: key("lift"), kind: "inference", body: "Answered; I lift it.",
      relation: "resolves", target_report_id: challenged.ids.report,
    });
    const replacing = await tool(served(alpha, env), "collab_propose", {
      question: "Adopt Y, revised?", criteria: "C", extent: "E", replaces: first.ids.proposal,
    });
    expect(replacing.status.terms.known_conflicts).toBeNull();
    expect(replacing.carried_objections).toEqual([]);
  });

  test("a set-aside challenge shows that it was set aside, when, on what basis and why, in every view", async () => {
    const { author, peer, proposal, challenge } = orphanedChallenge();
    setAsideAtTerminal(proposal.proposal.id, challenge.id, "Its author left.");
    const about = await tool(served(peer), "collab_inbox", { about: proposal.proposal.id });
    const stance = about.challenges.find((entry: { id: string }) => entry.id === challenge.id);
    expect(stance).toMatchObject({
      standing: false,
      counted: false,
      set_aside: { by: "person", basis: "controlling_terminal", reason: "Its author left.", at: clock.toISOString(), note: SET_ASIDE_SENTENCE },
    });
    expect(about.set_asides).toEqual([expect.objectContaining({ challenge: challenge.id, reason: "Its author left." })]);
    expect(about.advice.some((entry: string) => entry.includes("set aside by the person"))).toBe(true);
    // collab_proposal_status carries the same record.
    const legacy = await tool(served(peer), "collab_proposal_status", {
      workspace_id: proposal.proposal.workspace_id, proposal_report_id: proposal.proposal.id,
    });
    expect(legacy.proposal.set_asides).toEqual([expect.objectContaining({ challenge_report_id: challenge.id, reason: "Its author left." })]);
    // The author's inbox lists the person's act, addressed to it.
    const inbox = await tool(served(author), "collab_inbox", {});
    const item = (inbox.items as Array<Record<string, any>>).find((entry) => entry.act === "set_aside");
    expect(item).toMatchObject({ challenge: { id: challenge.id }, text: "Its author left.", why_you: "person_act" });
  });
});
