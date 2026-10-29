import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollabError } from "../src/errors.js";
import { runCollabHostCli } from "../src/host.js";
import { personActChallenge, verifyPasskeyAssertion } from "../src/passkey.js";
import { runCeremonyCli } from "../src/ceremony.js";
import { runPersonDeskCli, runPersonRemoteCli, type PersonDeskDeps } from "../src/person-desk.js";
import type { PasskeyAssertion, PersonPasskey, SessionHandle } from "../src/protocol.js";
import { CollabStore } from "../src/store.js";
import type { TtyPort } from "../src/tty.js";

// Person acts on proposals: terminal and passkey agreement, the person desk,
// and the person's inbox. Contract:
// docs/superpowers/specs/2026-10-29-collab-yu-ai-consent-design.md section 5.

const RP_ID = "localhost";
const ORIGIN = "http://localhost:17777";

function sha256(bytes: Buffer | string): Buffer {
  return createHash("sha256").update(bytes).digest();
}

interface TestPasskey {
  credentialId: string;
  spki: string;
  privateKey: KeyObject;
  counter: number;
}

function makePasskey(): TestPasskey {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    credentialId: Buffer.from(`credential-${Math.random()}`).toString("base64url"),
    spki: (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64url"),
    privateKey,
    counter: 0,
  };
}

function assert(
  key: TestPasskey,
  challenge: string,
  overrides: { origin?: string; rpId?: string; flags?: number; counter?: number; type?: string } = {},
): PasskeyAssertion {
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(overrides.counter ?? key.counter);
  const authenticatorData = Buffer.concat([
    sha256(overrides.rpId ?? RP_ID),
    Buffer.from([overrides.flags ?? 0x05]),
    counter,
  ]);
  const clientData = Buffer.from(JSON.stringify({
    type: overrides.type ?? "webauthn.get",
    challenge,
    origin: overrides.origin ?? ORIGIN,
    crossOrigin: false,
  }));
  const signature = sign("sha256", Buffer.concat([authenticatorData, sha256(clientData)]), key.privateKey);
  return {
    credential_id: key.credentialId,
    authenticator_data: authenticatorData.toString("base64url"),
    client_data_json: clientData.toString("base64url"),
    signature: signature.toString("base64url"),
  };
}

function enrolled(key: TestPasskey, signCount = 0): PersonPasskey {
  return {
    credential_id: key.credentialId,
    public_key_spki: key.spki,
    algorithm: -7,
    rp_id: RP_ID,
    origin: ORIGIN,
    label: null,
    fingerprint: "",
    sign_count: signCount,
    enrolled_at: "2026-10-29T00:00:00.000Z",
    revoked_at: null,
  };
}

function errorCode(operation: () => unknown): string {
  try {
    operation();
  } catch (error) {
    if (error instanceof CollabError) return error.code;
    throw error;
  }
  throw new Error("expected operation to fail");
}

describe("passkey assertion verification", () => {
  const challenge = personActChallenge({
    act: "agree",
    workspace_id: "ws_1",
    proposal_report_id: "report_1",
    proposal_sha256: "a".repeat(64),
    prior_person_acts: 0,
    reason: null,
    ai_snapshot: { position: "consented", closed: false, qualifying_support_report_ids: [], unresolved_challenge_report_ids: [] },
  }).challenge;

  test("accepts a user-verified assertion over the expected challenge", () => {
    const key = makePasskey();
    expect(verifyPasskeyAssertion({ passkey: enrolled(key), assertion: assert(key, challenge), expected_challenge: challenge }))
      .toEqual({ sign_count: 0 });
    expect(verifyPasskeyAssertion({
      passkey: enrolled(key, 4),
      assertion: assert(key, challenge, { counter: 5 }),
      expected_challenge: challenge,
    })).toEqual({ sign_count: 5 });
  });

  test("refuses every field a local journal can check", () => {
    const key = makePasskey();
    const verifyWith = (assertion: PasskeyAssertion, passkey = enrolled(key)) =>
      errorCode(() => verifyPasskeyAssertion({ passkey, assertion, expected_challenge: challenge }));
    expect(verifyWith(assert(key, "another-challenge"))).toBe("passkey_challenge_mismatch");
    expect(verifyWith(assert(key, challenge, { origin: "http://localhost:9999" }))).toBe("passkey_origin_mismatch");
    expect(verifyWith(assert(key, challenge, { rpId: "example.com" }))).toBe("passkey_rp_mismatch");
    expect(verifyWith(assert(key, challenge, { flags: 0x01 }))).toBe("passkey_user_not_verified");
    expect(verifyWith(assert(key, challenge, { type: "webauthn.create" }))).toBe("passkey_assertion_invalid");
    expect(verifyWith(assert(key, challenge, { counter: 3 }), enrolled(key, 3))).toBe("passkey_counter_regressed");
    const other = makePasskey();
    expect(verifyWith({ ...assert(other, challenge), credential_id: key.credentialId })).toBe("passkey_signature_invalid");
    expect(verifyWith(assert(other, challenge))).toBe("passkey_not_enrolled");
  });
});

let directory: string;
let root: string;
let databasePath: string;
let clock: Date;
let store: CollabStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-person-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  clock = new Date("2026-10-29T00:00:00.000Z");
  store = new CollabStore(databasePath, { now: () => clock });
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function session(actor: string): SessionHandle {
  return store.startSession({ root_path: root, actor });
}

let keys = 0;
function consentedProposal() {
  const author = session("author");
  const peer = session("peer");
  const proposal = store.openProposalForSession({
    ...author.credential,
    idempotency_key: `open-${++keys}`,
    question: "Adopt the person desk?",
    criteria: "It keeps a person's consent off MCP.",
    extent: "packages/collab person desk only.",
  });
  store.appendReportForSession({
    ...peer.credential,
    idempotency_key: `support-${++keys}`,
    kind: "inference",
    body: "Agreed.",
    relation: "supports",
    target_report_id: proposal.proposal.id,
  });
  return { author, peer, proposal: store.proposalStatusById(proposal.proposal.id) };
}

function terminal(answer: string | null) {
  const written: string[] = [];
  let opened = 0;
  const port: TtyPort = {
    write: (text) => { written.push(text); },
    readLine: () => answer,
    close: () => {},
  };
  return { written, opened: () => opened, openTty: () => { opened += 1; return port; } };
}

function desk(argv: string[], deps: PersonDeskDeps = {}) {
  const run = runPersonDeskCli([...argv, "--db", databasePath], {}, { storeNow: () => clock, ...deps });
  return { exitCode: run.exit_code, receipt: JSON.parse(run.line) };
}

describe("person acts at the controlling terminal", () => {
  test("agreement shows the exact bytes, needs yes, and authorises only after the agents consent", () => {
    const { proposal } = consentedProposal();
    expect(desk(["consent", "--proposal", proposal.proposal.id], { openTty: () => null }).receipt)
      .toMatchObject({ status: "error", error: "tty_unavailable" });

    const declined = terminal("no");
    expect(desk(["consent", "--proposal", proposal.proposal.id], { openTty: declined.openTty }))
      .toMatchObject({ exitCode: 3, receipt: { status: "cancelled", command: "person consent" } });
    expect(store.proposalStatusById(proposal.proposal.id).person.state).toBe("awaiting");

    const accepted = terminal("yes");
    const agreed = desk(["consent", "--proposal", proposal.proposal.id], { openTty: accepted.openTty });
    expect(agreed.exitCode).toBe(0);
    expect(agreed.receipt.proposal).toMatchObject({
      person: { state: "agreed" },
      agreement: { act: "agree", basis: "controlling_terminal", ai_snapshot: { position: "consented" } },
      may_proceed: true,
    });
    const shown = accepted.written.join("");
    expect(shown).toContain(proposal.proposal_sha256);
    expect(shown).toContain(proposal.proposal_bytes);
    expect(store.eventsSince(proposal.proposal.workspace_id).events.at(-1)?.type).toBe("proposal.agreed");

    expect(desk(["consent", "--proposal", proposal.proposal.id], { openTty: terminal("yes").openTty }).receipt.error)
      .toBe("already_agreed");
  });

  test("agreement is refused before any prompt while the agents have not consented", () => {
    const author = session("author");
    session("peer");
    const proposal = store.openProposalForSession({
      ...author.credential,
      idempotency_key: "open-unsettled",
      question: "Unsettled?",
      criteria: "No support yet.",
      extent: "Nothing.",
    });
    const tty = terminal("yes");
    expect(desk(["consent", "--proposal", proposal.proposal.id], { openTty: tty.openTty }).receipt)
      .toMatchObject({ error: "ai_not_consented", position: "open" });
    expect(tty.opened()).toBe(0);
  });

  test("the latest person act decides, and withdrawal ends an agreement", () => {
    const { author, proposal } = consentedProposal();
    const id = proposal.proposal.id;
    desk(["consent", "--proposal", id], { openTty: terminal("yes").openTty });
    const rejected = desk(["reject", "--proposal", id, "--reason", "Changed my mind."], { openTty: terminal("yes").openTty });
    expect(rejected.receipt.proposal).toMatchObject({
      person: { state: "rejected" },
      agreement: null,
      may_proceed: false,
    });
    expect(rejected.receipt.proposal.person.acts.at(-1)).toMatchObject({ reason: "Changed my mind." });
    desk(["consent", "--proposal", id], { openTty: terminal("yes").openTty });
    expect(store.proposalStatusById(id).may_proceed).toBe(true);

    store.appendReportForSession({
      ...author.credential,
      idempotency_key: "withdraw",
      kind: "inference",
      body: "Withdrawn.",
      relation: "withdraws",
      target_report_id: id,
    });
    expect(store.proposalStatusById(id)).toMatchObject({ person: { state: "agreed" }, may_proceed: false });
    expect(store.verifyJournal(proposal.proposal.workspace_id)).toBe(true);
  });
});

describe("person acts with an enrolled passkey", () => {
  function enrol(key: TestPasskey, answer = "yes", origin = ORIGIN) {
    return desk(["passkey-enroll", "--file", "-"], {
      openTty: terminal(answer).openTty,
      readStdin: () => JSON.stringify({
        credential_id: key.credentialId,
        public_key_spki: key.spki,
        algorithm: -7,
        rp_id: RP_ID,
        origin,
        label: "Touch ID",
      }),
    });
  }

  test("enrolment needs the terminal and a P-256 key for a secure origin", () => {
    const key = makePasskey();
    expect(enrol(key, "no").exitCode).toBe(3);
    expect(desk(["passkeys"]).receipt.passkeys).toEqual([]);
    expect(enrol(key, "yes", "http://192.168.1.2:17777").receipt.error).toBe("passkey_scope_invalid");
    const { publicKey } = generateKeyPairSync("ed25519");
    const wrongCurve = { ...key, spki: (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64url") };
    expect(enrol(wrongCurve).receipt.error).toBe("passkey_key_invalid");

    const done = enrol(key);
    expect(done.receipt.passkey).toMatchObject({
      credential_id: key.credentialId,
      origin: ORIGIN,
      label: "Touch ID",
      fingerprint: sha256(Buffer.from(key.spki, "base64url")).toString("hex"),
    });
    expect(enrol(key).receipt.error).toBe("passkey_already_enrolled");
  });

  test("an assertion over the challenge records once and carries its own proof", () => {
    const key = makePasskey();
    enrol(key);
    const { proposal } = consentedProposal();
    const id = proposal.proposal.id;
    const challenge = desk(["challenge", "--proposal", id, "--act", "agree"]).receipt.challenge;
    expect(challenge).toMatchObject({ prior_person_acts: 0, proposal_sha256: proposal.proposal_sha256 });
    expect(challenge.passkeys.map((item: { credential_id: string }) => item.credential_id)).toEqual([key.credentialId]);

    const assertion = assert(key, challenge.challenge);
    const agreed = desk(["consent", "--proposal", id, "--passkey-assertion", "-"], {
      readStdin: () => JSON.stringify(assertion),
    });
    expect(agreed.receipt.proposal).toMatchObject({
      may_proceed: true,
      agreement: { basis: "user_verified_passkey", proof: { public_key_spki: key.spki, challenge: challenge.challenge } },
    });
    const proof = agreed.receipt.proposal.agreement.proof;
    expect(verifyPasskeyAssertion({ passkey: enrolled(key), assertion: proof, expected_challenge: proof.challenge }))
      .toEqual({ sign_count: 0 });
    expect(sha256(proof.challenge_bytes).toString("base64url")).toBe(proof.challenge);

    // The same assertion cannot be replayed onto the next state.
    const replayed = desk(["reject", "--proposal", id, "--reason", "Replay.", "--passkey-assertion", "-"], {
      readStdin: () => JSON.stringify(assertion),
    });
    expect(replayed.receipt.error).toBe("passkey_challenge_mismatch");

    const rejectChallenge = desk(["challenge", "--proposal", id, "--act", "reject", "--reason", "Not now."]).receipt.challenge;
    const rejected = desk(["reject", "--proposal", id, "--reason", "Not now.", "--passkey-assertion", "-"], {
      readStdin: () => JSON.stringify(assert(key, rejectChallenge.challenge)),
    });
    expect(rejected.receipt.proposal).toMatchObject({ person: { state: "rejected" }, may_proceed: false });
  });

  test("a revoked passkey signs nothing", () => {
    const key = makePasskey();
    enrol(key);
    expect(desk(["passkey-revoke", "--credential", key.credentialId], { openTty: terminal("yes").openTty }).receipt.passkey)
      .toMatchObject({ credential_id: key.credentialId });
    const { proposal } = consentedProposal();
    const challenge = store.personActChallenge({ proposal_report_id: proposal.proposal.id, act: "agree" });
    expect(challenge.passkeys).toEqual([]);
    expect(desk(["consent", "--proposal", proposal.proposal.id, "--passkey-assertion", "-"], {
      readStdin: () => JSON.stringify(assert(key, challenge.challenge)),
    }).receipt.error).toBe("passkey_not_enrolled");
  });
});

describe("the person desk and inbox", () => {
  test("notes inform the author without claiming to authenticate the person", () => {
    const { author, proposal } = consentedProposal();
    const workspace = proposal.proposal.workspace_id;
    const argv = ["say", "--workspace", workspace, "--body", "Let's keep it small.", "--proposal", proposal.proposal.id,
      "--idempotency-key", "note-1"];
    const note = desk(argv).receipt.report;
    expect(note).toMatchObject({
      from_actor: "person:desk",
      from_session_id: null,
      to_session_id: author.session.id,
      kind: "observation",
      evidence_refs: [`report:${proposal.proposal.id}`],
      limits: "Written at the person desk, which does not authenticate the person.",
    });
    expect(desk(argv).receipt.report.id).toBe(note.id);
    const event = store.eventsSince(workspace).events.at(-1)!;
    expect(store.eventAddressesSession(event, author.session.id)).toBe(true);
  });

  test("a person proposal is settled by every agent voice", () => {
    const first = session("first");
    const second = session("second");
    const opened = desk(["propose", "--workspace", first.workspace.id, "--question", "Rest on Sundays?",
      "--criteria", "Care before throughput.", "--extent", "Scheduling only.", "--idempotency-key", "person-proposal"])
      .receipt.proposal;
    expect(opened).toMatchObject({
      proposal: { from_actor: "person:desk", from_session_id: null },
      terms: { origin: "person_relayed", author_voice_id: "person" },
      ai: { position: "open" },
    });
    expect(opened.ai.awaiting_voice_ids.sort()).toEqual([first.session.id, second.session.id].sort());
    for (const [handle, index] of [[first, 1], [second, 2]] as const) {
      store.appendReportForSession({
        ...handle.credential,
        idempotency_key: `person-support-${index}`,
        kind: "inference",
        body: "Yes.",
        relation: "supports",
        target_report_id: opened.proposal.id,
      });
    }
    expect(store.proposalStatusById(opened.proposal.id).ai.position).toBe("consented");
  });

  test("the inbox holds settled proposals awaiting the person and reports addressed to them", () => {
    const { peer, proposal } = consentedProposal();
    const workspace = proposal.proposal.workspace_id;
    const question = store.appendReportForSession({
      ...peer.credential,
      idempotency_key: "ask-person",
      kind: "observation",
      body: "Should the desk show acts from other machines?",
      to_person: true,
    });
    const plain = store.appendReportForSession({
      ...peer.credential,
      idempotency_key: "plain",
      kind: "observation",
      body: "A plain note.",
    });
    const events = store.eventsSince(workspace).events;
    expect(events.find((event) => event.entity_id === question.id)?.payload).toMatchObject({ to_person: true });
    expect(events.find((event) => event.entity_id === plain.id)?.payload).not.toHaveProperty("to_person");

    const inbox = desk(["inbox", "--workspace", workspace]).receipt.inbox;
    expect(inbox.awaiting_person.map((item: { proposal: { id: string } }) => item.proposal.id)).toEqual([proposal.proposal.id]);
    expect(inbox.addressed_reports.map((item: { id: string }) => item.id)).toEqual([question.id]);

    desk(["consent", "--proposal", proposal.proposal.id], { openTty: terminal("yes").openTty });
    expect(desk(["inbox", "--workspace", workspace]).receipt.inbox.awaiting_person).toEqual([]);
  });

  test("the host CLI routes person verbs and refuses stray options", () => {
    session("anyone");
    const listed = runCollabHostCli(["person", "workspaces", "--db", databasePath], {}, undefined, { storeNow: () => clock });
    expect(listed.exit_code).toBe(0);
    expect(JSON.parse(listed.line)).toMatchObject({ status: "ok", command: "person workspaces" });
    expect(JSON.parse(runCollabHostCli(["person", "--help"], {}).line)).toMatchObject({ status: "help" });
    expect(desk(["inbox", "--workspace", "ws_x", "--reason", "stray"]).receipt.error).toBe("usage_error");
    expect(desk(["consent"]).receipt.error).toBe("usage_error");
  });
});

describe("person acts after review", () => {
  test("an authenticated rejection may follow a relayed one, but not the reverse", () => {
    const { peer, proposal } = consentedProposal();
    const id = proposal.proposal.id;
    const relay = (key: string) => store.relayProposalRejectionForSession({
      ...peer.credential, idempotency_key: key, proposal_report_id: id, proposal_sha256: proposal.proposal_sha256, reason: "Relayed.",
    });
    relay("relay-1");
    const signed = desk(["reject", "--proposal", id, "--reason", "My own no."], { openTty: terminal("yes").openTty });
    expect(signed.receipt.proposal.person.acts.map((act: { basis: string }) => act.basis))
      .toEqual(["relayed_by_session", "controlling_terminal"]);
    expect(errorCode(() => relay("relay-2"))).toBe("already_rejected");
  });

  test("the terminal refuses when the agents' position changed after it was shown", () => {
    const { proposal } = consentedProposal();
    const shown = store.personActChallenge({ proposal_report_id: proposal.proposal.id, act: "agree" });
    const late = session("late");
    store.appendReportForSession({
      ...late.credential, idempotency_key: "late-support", kind: "inference", body: "Me too.",
      relation: "supports", target_report_id: proposal.proposal.id,
    });
    expect(errorCode(() => store.recordPersonActAtTerminal({
      proposal_report_id: proposal.proposal.id,
      proposal_sha256: proposal.proposal_sha256,
      act: "agree",
      expected_ai_snapshot: shown.ai_snapshot,
    }))).toBe("ai_position_changed");
  });

  test("a challenge refuses an agreement before Touch ID is spent on it", () => {
    const author = session("author");
    session("peer");
    const proposal = store.openProposalForSession({
      ...author.credential, idempotency_key: "unsettled", question: "Q?", criteria: "C", extent: "E",
    });
    expect(desk(["challenge", "--proposal", proposal.proposal.id, "--act", "agree"]).receipt.error).toBe("ai_not_consented");
    expect(desk(["challenge", "--proposal", proposal.proposal.id, "--act", "agree", "--reason", "x"]).receipt.error)
      .toBe("invalid_reason");
  });

  test("the desk withdraws only its own proposals, and its notes reach the consulted voices", () => {
    const first = session("first");
    const second = session("second");
    const workspace = first.workspace.id;
    const opened = desk(["propose", "--workspace", workspace, "--question", "Q?", "--criteria", "C", "--extent", "E",
      "--idempotency-key", "desk-p"]).receipt.proposal;
    desk(["say", "--workspace", workspace, "--proposal", opened.proposal.id, "--body", "Context.", "--idempotency-key", "desk-n"]);
    const note = store.eventsSince(workspace).events.at(-1)!;
    expect(store.eventAddressesSession(note, first.session.id)).toBe(true);
    expect(store.eventAddressesSession(note, second.session.id)).toBe(true);

    const agentProposal = store.openProposalForSession({
      ...first.credential, idempotency_key: "agent-p", question: "Agent Q?", criteria: "C", extent: "E",
    });
    expect(desk(["withdraw", "--workspace", workspace, "--proposal", agentProposal.proposal.id, "--reason", "No.",
      "--idempotency-key", "w1"]).receipt.error).toBe("report_author_mismatch");
    const withdrawn = desk(["withdraw", "--workspace", workspace, "--proposal", opened.proposal.id, "--reason", "Changed my mind.",
      "--idempotency-key", "w2"]).receipt.proposal;
    expect(withdrawn.ai.position).toBe("withdrawn");
  });

  test("an agreement wakes the proposal's author", () => {
    const { author, peer, proposal } = consentedProposal();
    desk(["consent", "--proposal", proposal.proposal.id], { openTty: terminal("yes").openTty });
    const event = store.eventsSince(proposal.proposal.workspace_id).events.at(-1)!;
    expect(event.type).toBe("proposal.agreed");
    expect(store.eventAddressesSession(event, author.session.id)).toBe(true);
    expect(store.eventAddressesSession(event, peer.session.id)).toBe(false);
  });

  test("the CLI refuses ambiguous input", () => {
    const { proposal } = consentedProposal();
    const workspace = proposal.proposal.workspace_id;
    const id = proposal.proposal.id;
    expect(desk(["proposals", `--workspace=${workspace}`, "--proposal=x", `--proposal=${id}`]).receipt.error).toBe("usage_error");
    expect(desk(["proposals", `--workspace=${workspace}`, "--proposal="]).receipt.error).toBe("usage_error");
    expect(desk(["proposals", `--workspace=${workspace}`, `--proposal=${id}`, "--limit=2"]).receipt.error).toBe("usage_error");
    expect(desk(["toString"]).receipt).toMatchObject({ error: "usage_error", command: "person" });
    expect(desk(["consent", "--reason", "x", "--proposal", id]).receipt).toMatchObject({ error: "usage_error", command: "person consent" });
  });

  test("assertions carry only WebAuthn's fields, bounded", () => {
    const key = makePasskey();
    store.enrollPersonPasskey({ credential_id: key.credentialId, public_key_spki: key.spki, algorithm: -7, rp_id: RP_ID, origin: ORIGIN });
    const { proposal } = consentedProposal();
    const challenge = store.personActChallenge({ proposal_report_id: proposal.proposal.id, act: "agree" });
    const assertion = assert(key, challenge.challenge);
    const act = (extra: Record<string, unknown>) => errorCode(() => store.recordPersonActWithPasskey({
      proposal_report_id: proposal.proposal.id, act: "agree", assertion: { ...assertion, ...extra } as PasskeyAssertion,
    }));
    expect(act({ user_handle: Buffer.alloc(65).toString("base64url") })).toBe("passkey_assertion_invalid");
    expect(act({ injected: "x" })).toBe("passkey_assertion_invalid");
  });

  test("actor labels beginning with person: are reserved for the desk", () => {
    expect(errorCode(() => session("person:passkey"))).toBe("invalid_actor");
  });
});

describe("person-remote behind an SSH forced command", () => {
  const remote = (argv: unknown, stdin?: string) => JSON.parse(runPersonRemoteCli(
    { SSH_ORIGINAL_COMMAND: typeof argv === "string" ? argv : JSON.stringify(argv), AGENTOOL_COLLAB_DB: databasePath },
    { storeNow: () => clock, readStdin: () => stdin ?? "" },
  ).line);

  test("reads a JSON argv, never a shell line, and allows only desk verbs that need no terminal or browser", () => {
    session("anyone");
    expect(remote(["workspaces"]).status).toBe("ok");
    expect(remote("workspaces; rm -rf /").error).toBe("usage_error");
    for (const verb of ["passkey-enroll", "passkey-revoke", "passkey-export", "ceremony"]) {
      expect(remote([verb]).error).toBe("remote_verb_refused");
    }
    expect(remote(["workspaces", "--db=/tmp/elsewhere.sqlite"]).error).toBe("remote_verb_refused");
    expect(remote(["consent", "--proposal=report_x"]).error).toBe("remote_verb_refused");
  });
});

async function runCeremony(argv: string[], deps: PersonDeskDeps, remoteDb?: string) {
  let resolveUrl!: (url: URL) => void;
  const url = new Promise<URL>((resolve) => { resolveUrl = resolve; });
  const done = runCeremonyCli(argv, {}, { storeNow: () => clock, ...deps }, {
    out: (line) => resolveUrl(new URL(JSON.parse(line).url)),
    remote: remoteDb === undefined ? undefined : async (_destination, remoteArgv, stdin) => JSON.parse(runPersonRemoteCli(
      { SSH_ORIGINAL_COMMAND: JSON.stringify(remoteArgv), AGENTOOL_COLLAB_DB: remoteDb },
      { storeNow: () => clock, readStdin: () => stdin ?? "" },
    ).line),
  });
  const page = await Promise.race([url, done.then((result) => { throw new Error(result.line); })]);
  const at = (path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${page.port}${page.pathname}${path}`, {
    ...init,
    headers: { Host: `localhost:${page.port}`, ...(init.headers ?? {}) },
  });
  const html = await (await at("")).text();
  const data = JSON.parse(html.match(/<script type="application\/json" id="data">(.*?)<\/script>/s)![1]!);
  const post = async (body: unknown, origin = `http://localhost:${page.port}`) => (await at("/done", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })).json();
  return { page, data, html, at, post, done };
}

describe("ceremonies served by the desk", () => {
  const port = () => 20_000 + Math.floor(Math.random() * 20_000);

  test("a signing page shows the exact bytes and records one passkey act", async () => {
    const key = makePasskey();
    const origin = `http://localhost:${port()}`;
    store.enrollPersonPasskey({ credential_id: key.credentialId, public_key_spki: key.spki, algorithm: -7, rp_id: RP_ID, origin });
    const { proposal } = consentedProposal();
    const ceremony = await runCeremony(["ceremony", `--proposal=${proposal.proposal.id}`, "--act=agree", `--db=${databasePath}`], {});
    expect(ceremony.page.origin).toBe(origin);
    expect(ceremony.data).toMatchObject({ kind: "sign", act: "agree", proposal_bytes: proposal.proposal_bytes });
    const served = await ceremony.at("");
    expect(served.headers.get("content-security-policy")).toContain("script-src 'nonce-");
    expect(ceremony.html).not.toContain("<script>");
    expect((await ceremony.at("", { headers: { Host: "evil.test" } })).status).toBe(421);
    expect(await ceremony.post({ assertion: assert(key, ceremony.data.challenge, { origin }) }, "http://localhost:1"))
      .toMatchObject({ ok: false, error: "ceremony_closed" });
    expect(await ceremony.post({ assertion: assert(key, ceremony.data.challenge, { origin }) }))
      .toMatchObject({ ok: true, may_proceed: true });
    expect(JSON.parse((await ceremony.done).line)).toMatchObject({ status: "ok", recorded: true, may_proceed: true });
    expect(store.proposalStatusById(proposal.proposal.id).agreement).toMatchObject({ basis: "user_verified_passkey" });
  });

  test("a signing page for another device's table verifies there", async () => {
    const remoteDb = join(directory, "remote", "collab.sqlite");
    const remoteRoot = join(directory, "remote-repo");
    mkdirSync(remoteRoot);
    const remoteStore = new CollabStore(remoteDb, { now: () => clock });
    try {
      const a = remoteStore.startSession({ root_path: remoteRoot, actor: "lab-author" });
      const b = remoteStore.startSession({ root_path: remoteRoot, actor: "lab-peer" });
      const proposal = remoteStore.openProposalForSession({
        ...a.credential, idempotency_key: "lab-open", question: "Lab Q?", criteria: "C", extent: "E",
      });
      remoteStore.appendReportForSession({
        ...b.credential, idempotency_key: "lab-support", kind: "inference", body: "Yes.", relation: "supports",
        target_report_id: proposal.proposal.id,
      });
      const key = makePasskey();
      const origin = `http://localhost:${port()}`;
      remoteStore.enrollPersonPasskey({ credential_id: key.credentialId, public_key_spki: key.spki, algorithm: -7, rp_id: RP_ID, origin });
      const ceremony = await runCeremony(["ceremony", `--proposal=${proposal.proposal.id}`, "--act=agree", "--via=lab"], {}, remoteDb);
      expect(ceremony.data.table).toBe("lab");
      expect(await ceremony.post({ assertion: assert(key, ceremony.data.challenge, { origin }) })).toMatchObject({ ok: true });
      await ceremony.done;
      expect(remoteStore.proposalStatusById(proposal.proposal.id).may_proceed).toBe(true);
    } finally {
      remoteStore.close();
    }
  });

  test("an enrolment page needs the terminal's yes and a key this page created", async () => {
    const key = makePasskey();
    let origin = "";
    const attempt = async (answer: string, challengeOverride?: string) => {
      const listen = port();
      origin = `http://localhost:${listen}`;
      const ceremony = await runCeremony(
        ["passkey-enroll", "--ceremony", `--db=${databasePath}`, `--port=${listen}`, "--label=Air Touch ID"],
        { openTty: terminal(answer).openTty },
      );
      const clientData = Buffer.from(JSON.stringify({
        type: "webauthn.create", challenge: challengeOverride ?? ceremony.data.challenge, origin, crossOrigin: false,
      })).toString("base64url");
      const posted = await ceremony.post({
        credential_id: key.credentialId, public_key_spki: key.spki, algorithm: -7, client_data_json: clientData,
      });
      return { posted, final: JSON.parse((await ceremony.done).line) };
    };
    expect((await attempt("yes", "forged")).posted).toMatchObject({ ok: false, error: "passkey_assertion_invalid" });
    expect((await attempt("no")).final.status).toBe("cancelled");
    const enrolled = await attempt("yes");
    expect(enrolled.posted).toMatchObject({ ok: true, origin });
    expect(store.listPersonPasskeys().map((passkey) => passkey.label)).toEqual(["Air Touch ID"]);
  });
});
