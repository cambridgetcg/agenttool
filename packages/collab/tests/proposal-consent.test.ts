import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollabError } from "../src/errors.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import { aiPosition, type AiPositionInput } from "../src/proposal.js";
import type { ReportRelation, SessionHandle } from "../src/protocol.js";
import { CollabStore } from "../src/store.js";

// consent/v1, the agents' side of person–agent consent. Contract:
// docs/superpowers/specs/2026-10-29-collab-yu-ai-consent-design.md section 4.

const HOUR = 60 * 60 * 1000;
const T0 = "2026-10-29T00:00:00.000Z";

describe("consent/v1 position rule", () => {
  const base: AiPositionInput = {
    now: T0,
    closes_at: "2026-10-29T06:00:00.000Z",
    obsoleted: null,
    unresolved_challenge: false,
    author_voice_id: "voice_a",
    snapshot_voice_ids: ["voice_a", "voice_b", "voice_c"],
    support_voice_ids: [],
  };
  const at = (now: string, extra: Partial<AiPositionInput> = {}) => aiPosition({ ...base, now, ...extra });
  const before = T0;
  const after = "2026-10-29T07:00:00.000Z";

  test("before the deadline", () => {
    expect(at(before)).toMatchObject({ position: "open", closed: false, awaiting_voice_ids: ["voice_b", "voice_c"] });
    expect(at(before, { support_voice_ids: ["voice_a"] }))
      .toMatchObject({ position: "open", qualifying_support_indexes: [] });
    expect(at(before, { support_voice_ids: ["voice_b"] }))
      .toMatchObject({ position: "open", qualifying_support_indexes: [0], awaiting_voice_ids: ["voice_c"] });
    expect(at(before, { support_voice_ids: ["voice_b", "voice_a", "voice_c"] }))
      .toMatchObject({ position: "consented", qualifying_support_indexes: [0, 2], awaiting_voice_ids: [] });
    expect(at(before, { support_voice_ids: ["voice_b", "voice_c"], unresolved_challenge: true }).position)
      .toBe("challenged");
  });

  test("after the deadline", () => {
    expect(at(after).position).toBe("lapsed");
    expect(at(after, { support_voice_ids: ["voice_a"] }).position).toBe("lapsed");
    expect(at(after, { support_voice_ids: ["voice_b"] })).toMatchObject({ position: "consented", closed: true });
    expect(at(after, { support_voice_ids: ["voice_b"], unresolved_challenge: true }).position).toBe("split");
  });

  test("the deadline instant itself is closed", () => {
    expect(at("2026-10-29T05:59:59.999Z", { support_voice_ids: ["voice_b"] }))
      .toMatchObject({ position: "open", closed: false });
    expect(at(base.closes_at, { support_voice_ids: ["voice_b"] }))
      .toMatchObject({ position: "consented", closed: true });
  });

  test("a lone voice speaks for itself, but only through an explicit supports", () => {
    const lone = { snapshot_voice_ids: ["voice_a"] };
    expect(at(before, lone).position).toBe("open");
    expect(at(before, { ...lone, support_voice_ids: ["voice_a"] }))
      .toMatchObject({ position: "consented", qualifying_support_indexes: [0] });
    expect(at(after, lone).position).toBe("lapsed");
  });

  test("a voice outside the snapshot qualifies but is never awaited", () => {
    expect(at(before, { support_voice_ids: ["voice_late"] }))
      .toMatchObject({ position: "open", qualifying_support_indexes: [0], awaiting_voice_ids: ["voice_b", "voice_c"] });
    expect(at(after, { support_voice_ids: ["voice_late"] }).position).toBe("consented");
  });

  test("withdrawal and supersession override every other input", () => {
    const busy = { support_voice_ids: ["voice_b", "voice_c"], unresolved_challenge: true };
    expect(at(before, { ...busy, obsoleted: "withdrawn" }).position).toBe("withdrawn");
    expect(at(after, { ...busy, obsoleted: "superseded" }).position).toBe("superseded");
  });
});

let directory: string;
let root: string;
let databasePath: string;
let clock: Date;
let store: CollabStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-consent-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  clock = new Date(T0);
  store = new CollabStore(databasePath, { now: () => clock });
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function advance(ms: number): void {
  clock = new Date(clock.getTime() + ms);
}

function session(actor: string, parent?: SessionHandle): SessionHandle {
  return store.startSession({
    root_path: root,
    actor,
    ...(parent ? { parent_session_id: parent.session.id } : {}),
  });
}

let keys = 0;
function open(author: SessionHandle, extra: Record<string, unknown> = {}) {
  return store.openProposalForSession({
    ...author.credential,
    idempotency_key: `open-${++keys}`,
    question: "Should collab proposals default to lazy consensus?",
    criteria: "Correctness and interpretation should not be settled by headcount.",
    extent: "The packages/collab proposal surface only.",
    ...extra,
  });
}

function answer(from: SessionHandle, targetId: string, relation: ReportRelation) {
  return store.appendReportForSession({
    ...from.credential,
    idempotency_key: `answer-${++keys}`,
    kind: "inference",
    body: `${relation} ${targetId}`,
    relation,
    target_report_id: targetId,
  });
}

function status(proposalId: string) {
  return store.proposalStatus(workspaceOf(proposalId), proposalId);
}

function workspaceOf(reportId: string): string {
  const row = store.db.query(`SELECT workspace_id FROM reports WHERE id = ?`).get(reportId) as { workspace_id: string };
  return row.workspace_id;
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

describe("proposals in the journal", () => {
  test("open records a proposal report, fixed terms, and a snapshot of live voices", () => {
    const stale = session("stale");
    advance(7 * HOUR);
    const author = session("author");
    const child = session("author-child", author);
    const peer = session("peer");

    const opened = open(author, { known_conflicts: "Older notes favour counted ballots.", topic: "principle:consent" });
    expect(opened.proposal).toMatchObject({ kind: "proposal", relation: "informs", from_session_id: author.session.id });
    expect(opened.terms).toMatchObject({
      rule: "consent/v1",
      origin: "ai",
      topic: "principle:consent",
      author_voice_id: author.session.id,
      closes_at: new Date(clock.getTime() + 6 * HOUR).toISOString(),
      voices: [
        { voice_id: author.session.id, live_session_ids: [author.session.id, child.session.id].sort() },
        { voice_id: peer.session.id, live_session_ids: [peer.session.id] },
      ].sort((left, right) => left.voice_id.localeCompare(right.voice_id)),
    });
    expect(JSON.stringify(opened.terms.voices)).not.toContain(stale.session.id);
    expect(createHash("sha256").update(opened.proposal_bytes).digest("hex")).toBe(opened.proposal_sha256);
    expect(JSON.parse(opened.proposal_bytes)).toMatchObject({
      protocol: "agenttool.collab-proposal/1",
      extent: "The packages/collab proposal surface only.",
      known_conflicts: "Older notes favour counted ballots.",
    });
    expect(opened).toMatchObject({
      ai: { position: "open", awaiting_voice_ids: [peer.session.id], basis: "computed_from_journal" },
      person: { state: "awaiting", acts: [] },
      agreement: null,
      may_proceed: false,
    });

    const events = store.eventsSince(author.workspace.id).events;
    expect(events.slice(-2).map((event) => event.type)).toEqual(["report.posted", "proposal.opened"]);
    expect(events.at(-1)!.id).toBe(opened.terms.opened_event_id);
    expect(store.verifyJournal(author.workspace.id)).toBe(true);
  });

  test("the author's own lineage cannot consent for the agents", () => {
    const author = session("author");
    const child = session("author-child", author);
    const peer = session("peer");
    const proposal = open(author);

    answer(child, proposal.proposal.id, "supports");
    expect(status(proposal.proposal.id).ai).toMatchObject({ position: "open", qualifying_support_report_ids: [] });

    const support = answer(peer, proposal.proposal.id, "supports");
    expect(status(proposal.proposal.id).ai).toMatchObject({
      position: "consented",
      closed: false,
      qualifying_support_report_ids: [support.id],
      awaiting_voice_ids: [],
    });
  });

  test("a challenge holds the position until it is resolved", () => {
    const author = session("author");
    const peer = session("peer");
    const critic = session("critic");
    const proposal = open(author);
    answer(peer, proposal.proposal.id, "supports");
    const challenge = answer(critic, proposal.proposal.id, "challenges");
    expect(status(proposal.proposal.id).ai).toMatchObject({
      position: "challenged",
      unresolved_challenge_report_ids: [challenge.id],
    });

    advance(6 * HOUR);
    expect(status(proposal.proposal.id).ai.position).toBe("split");

    const resolution = answer(author, challenge.id, "resolves");
    expect(status(proposal.proposal.id).ai).toMatchObject({ position: "consented", unresolved_challenge_report_ids: [] });

    answer(author, resolution.id, "withdraws");
    expect(status(proposal.proposal.id).ai.position).toBe("split");

    answer(critic, challenge.id, "withdraws");
    expect(status(proposal.proposal.id).ai.position).toBe("consented");
  });

  test("silence is not consent, and a lone voice must say yes itself", () => {
    const author = session("author");
    const proposal = open(author, { consult_seconds: 600 });
    expect(status(proposal.proposal.id).ai).toMatchObject({ position: "open", awaiting_voice_ids: [] });
    advance(600_000);
    expect(status(proposal.proposal.id).ai).toMatchObject({ position: "lapsed", closed: true });
    answer(author, proposal.proposal.id, "supports");
    expect(status(proposal.proposal.id).ai.position).toBe("consented");
  });

  test("a late joiner can challenge but is never awaited", () => {
    const author = session("author");
    const peer = session("peer");
    const proposal = open(author);
    answer(peer, proposal.proposal.id, "supports");
    expect(status(proposal.proposal.id).ai.position).toBe("consented");

    const late = session("late");
    answer(late, proposal.proposal.id, "challenges");
    expect(status(proposal.proposal.id).ai.position).toBe("challenged");
  });

  test("the deadline instant closes consultation", () => {
    const author = session("author");
    const peer = session("peer");
    session("quiet");
    const proposal = open(author, { consult_seconds: 600 });
    answer(peer, proposal.proposal.id, "supports");
    advance(600_000 - 1);
    expect(status(proposal.proposal.id).ai).toMatchObject({ position: "open", closed: false });
    advance(1);
    expect(status(proposal.proposal.id).ai).toMatchObject({ position: "consented", closed: true });
  });

  test("terms are fixed by their hash; revision is a new proposal", () => {
    const author = session("author");
    const peer = session("peer");
    const first = open(author);

    for (const relation of ["corrects", "supersedes"] as const) {
      expect(errorCode(() => answer(author, first.proposal.id, relation))).toBe("proposal_terms_fixed");
    }
    expect(errorCode(() => open(peer, { supersedes_report_id: first.proposal.id }))).toBe("report_author_mismatch");

    const revision = open(author, { supersedes_report_id: first.proposal.id, extent: "Only the status tool." });
    expect(revision.proposal).toMatchObject({ relation: "supersedes", target_report_id: first.proposal.id });
    expect(JSON.parse(revision.proposal_bytes).supersedes_report_id).toBe(first.proposal.id);
    expect(revision.proposal_sha256).not.toBe(first.proposal_sha256);
    expect(status(first.proposal.id).ai).toMatchObject({
      position: "superseded",
      obsoleted_by_report_id: revision.proposal.id,
    });
    expect(errorCode(() => open(author, { supersedes_report_id: first.proposal.id }))).toBe("proposal_not_on_table");

    answer(author, revision.proposal.id, "withdraws");
    expect(status(revision.proposal.id).ai.position).toBe("withdrawn");
  });

  test("stored terms that no longer match their hash fail closed", () => {
    const author = session("author");
    const proposal = open(author);
    store.db.query(`UPDATE proposal_terms SET extent = 'Everything.' WHERE report_id = ?`).run(proposal.proposal.id);
    expect(errorCode(() => status(proposal.proposal.id))).toBe("proposal_terms_invalid");
  });

  test("a relayed rejection names the exact bytes and only pauses work", () => {
    const author = session("author");
    const relay = session("relay");
    const proposal = open(author);
    const relayRejection = (sha: string, key: string) => store.relayProposalRejectionForSession({
      ...relay.credential,
      idempotency_key: key,
      proposal_report_id: proposal.proposal.id,
      proposal_sha256: sha,
      reason: "Not before the doorbell question is settled.",
    });

    expect(errorCode(() => relayRejection("0".repeat(64), "reject-wrong"))).toBe("proposal_hash_mismatch");
    const rejected = relayRejection(proposal.proposal_sha256, "reject");
    expect(rejected.person.state).toBe("rejected");
    expect(rejected.person.acts).toMatchObject([{
      act: "reject",
      party: "person",
      basis: "relayed_by_session",
      relayed_by_session_id: relay.session.id,
      proposal_sha256: proposal.proposal_sha256,
    }]);
    expect(rejected.may_proceed).toBe(false);

    const event = store.eventsSince(author.workspace.id).events.at(-1)!;
    expect(event.type).toBe("proposal.rejected");
    expect(store.eventAddressesSession(event, author.session.id)).toBe(true);
    expect(store.eventAddressesSession(event, relay.session.id)).toBe(false);

    answer(author, proposal.proposal.id, "withdraws");
    expect(errorCode(() => relayRejection(proposal.proposal_sha256, "reject-again"))).toBe("proposal_not_on_table");
  });

  test("an opened proposal routes to every consulted voice except the author's", () => {
    const author = session("author");
    const child = session("author-child", author);
    const peer = session("peer");
    open(author);
    const event = store.eventsSince(author.workspace.id).events.at(-1)!;
    expect(event.type).toBe("proposal.opened");
    expect(store.eventAddressesSession(event, peer.session.id)).toBe(true);
    expect(store.eventAddressesSession(event, author.session.id)).toBe(false);
    expect(store.eventAddressesSession(event, child.session.id)).toBe(false);
  });

  test("open is retry-safe under its idempotency key", () => {
    const author = session("author");
    const input = {
      ...author.credential,
      idempotency_key: "same-key",
      question: "One question",
      criteria: "One criterion",
      extent: "One extent",
    };
    const first = store.openProposalForSession(input);
    const head = store.eventsSince(author.workspace.id).events.length;
    expect(store.openProposalForSession(input).proposal.id).toBe(first.proposal.id);
    expect(store.eventsSince(author.workspace.id).events.length).toBe(head);
    expect(errorCode(() => store.openProposalForSession({ ...input, question: "Another question" })))
      .toBe("idempotency_conflict");
  });

  test("reads survive a reopen, list newest first, and refuse plain reports", () => {
    const author = session("author");
    const older = open(author);
    const newer = open(author);
    const plain = store.appendReportForSession({
      ...author.credential,
      idempotency_key: "plain",
      kind: "proposal",
      body: "A proposal without consent terms.",
    });
    store.close();
    store = new CollabStore(databasePath, { now: () => clock });

    const workspaceId = author.workspace.id;
    expect(status(older.proposal.id).proposal_sha256).toBe(older.proposal_sha256);
    expect(store.listProposalStatuses(workspaceId).map((item) => item.proposal.id))
      .toEqual([newer.proposal.id, older.proposal.id]);
    expect(store.listProposalStatuses(workspaceId, { limit: 1 })).toHaveLength(1);
    expect(errorCode(() => store.proposalStatus(workspaceId, plain.id))).toBe("proposal_not_found");
    expect(store.verifyJournal(workspaceId)).toBe(true);
  });

  test("rejects out-of-range consultation windows and unknown origins", () => {
    const author = session("author");
    expect(errorCode(() => open(author, { consult_seconds: 599 }))).toBe("invalid_consult_seconds");
    expect(errorCode(() => open(author, { consult_seconds: 7 * 24 * 3600 + 1 }))).toBe("invalid_consult_seconds");
    expect(errorCode(() => open(author, { origin: "council" }))).toBe("invalid_origin");
    expect(open(author, { origin: "person_relayed" }).terms.origin).toBe("person_relayed");
  });
});

describe("proposal tools over MCP", () => {
  test("open, read and relay need a bound session; status reads need none", async () => {
    const server = buildCollabMcpServer(store) as any;
    const call = async (name: string, args: Record<string, unknown>) => {
      const registration = server._registeredTools[name];
      return await (registration.handler ?? registration.callback)(args, {});
    };
    const terms = { question: "Adopt consent/v1?", criteria: "It fits small households.", extent: "Collab only." };

    const unbound = await call("collab_proposal_open", { workspace_id: "ws_unbound", idempotency_key: "unbound", ...terms });
    expect(unbound.structuredContent.error).toBe("session_not_bound");

    const joined = await call("collab_session_start", { root_path: root, actor: "mcp-author" });
    const workspace_id = joined.structuredContent.workspace.id;
    const opened = await call("collab_proposal_open", {
      workspace_id,
      idempotency_key: "mcp-open",
      consult_seconds: 600,
      ...terms,
    });
    expect(opened.isError).toBeUndefined();
    const proposal = opened.structuredContent.proposal;
    expect(proposal.ai.position).toBe("open");

    const one = await call("collab_proposal_status", { workspace_id, proposal_report_id: proposal.proposal.id });
    expect(one.structuredContent.proposal.proposal_sha256).toBe(proposal.proposal_sha256);
    const listed = await call("collab_proposal_status", { workspace_id });
    expect(listed.structuredContent.proposals.map((item: any) => item.proposal.id)).toEqual([proposal.proposal.id]);

    const relayed = await call("collab_proposal_relay_rejection", {
      workspace_id,
      idempotency_key: "mcp-reject",
      proposal_report_id: proposal.proposal.id,
      proposal_sha256: proposal.proposal_sha256,
      reason: "Not yet.",
    });
    expect(relayed.structuredContent.proposal.person.state).toBe("rejected");
    expect(relayed.structuredContent.proposal.may_proceed).toBe(false);
  });
});
