import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCollabMcpServer } from "../../src/mcp.js";
import type { EventCursor, ProposalStatus, SessionHandle, Task } from "../../src/protocol.js";
import type { CollabStore } from "../../src/store-notes.js";

/**
 * The forward-compatibility fixture (Collab Notes spec 8.5): a journal written
 * by today's source that older builds must open, verify, page, ack and write
 * to. Each later slice extends it by appending steps to FIXTURE_STEPS, so the
 * harness always exercises every storage addition that exists.
 */

/**
 * Event types added since a8799aad: Collab Notes' (spec 8.2) and consent/v2's
 * one. Older builds have never seen them.
 */
export const COLLAB_NOTES_EVENT_TYPES = [
  "purpose.declared",
  "evidence.cited",
  "ballot.opened",
  "ballot.cast",
  "ballot.revealed",
  "ballot.closed",
  "proposal.challenge_set_aside",
] as const;

/**
 * Tables added since a8799aad: Collab Notes' (spec 8.1) and consent/v2's
 * proposal_set_asides, which is rebuilt from its events on every open. They
 * hold view state only, so dropping them must lose nothing the journal
 * records. A slice that creates one of these lists it here; the harness
 * refuses any other new table.
 */
export const VIEW_STATE_TABLES: string[] = ["note_marks", "note_shown", "note_ballots", "proposal_set_asides"];

/** A clock the store reads; steps advance it so every run has the same shape. */
export class FixtureClock {
  private current: number;

  constructor(start: number) {
    this.current = start;
  }

  readonly now = (): Date => new Date(this.current);

  advance(milliseconds = 1_000): void {
    this.current += milliseconds;
  }

  get time(): number {
    return this.current;
  }
}

/** What the old-build checks need to find in the copied journal. */
export interface FixtureManifest {
  format: "agenttool.collab-compat-fixture/1";
  workspace_id: string;
  root_path: string;
  steps: string[];
  /** Every event type the steps declared they write, checked as each step ran. */
  produced_types: string[];
  event_types: string[];
  head_sequence: number;
  proposals: string[];
  /** A session that only listens, for the old host's `wait --addressed`. */
  waiter: {
    session_id: string;
    credential_file: string;
    after_anchor: EventCursor;
    /** A legacy report addressed to the waiter: routing that every build must still ring. */
    addressed_report_id: string;
  };
  /** Ended by the old host's `end --seat-ref` where that exists. */
  end_by_seat_ref: { session_id: string; seat_ref: string; credential_file: string };
  /** Ended by the old host's `end --session-file`. */
  end_by_session_file: { session_id: string; credential_file: string };
  /** Sessions collab_arrive started and the old builds leave alone, for the note_sessions view. */
  notes_sessions: string[];
  /** A task collab_done finished that waits for review: each older build reviews it. */
  review_task_id: string;
  /** Decisions collab_note recorded, for the notes_decisions view. */
  decisions: string[];
  /** Sealed ballots collab_poll opened and the reveal closed, for the ballot_result view. */
  ballots: string[];
  /**
   * consent/v2 proposals: one with a set-aside and the person's agreement,
   * one open with no person act. Older builds must refuse them by code and
   * list them as unreadable, and keep every other call working.
   */
  v2_proposals: string[];
}

type ManifestDraft = Partial<Omit<FixtureManifest, "format" | "steps" | "produced_types" | "event_types" | "head_sequence">> & {
  proposals: string[];
  notes_sessions: string[];
  decisions: string[];
  ballots: string[];
  v2_proposals: string[];
};

export interface FixtureContext {
  readonly store: CollabStore;
  readonly root: string;
  readonly clock: FixtureClock;
  readonly manifest: ManifestDraft;
  /** The name of the step now running; keys and labels derive from it. */
  readonly step: string;
  session(name: string): SessionHandle;
  addSession(name: string, handle: SessionHandle): SessionHandle;
  id(name: string): string;
  setId(name: string, value: string): string;
  task(name: string): Task;
  setTask(name: string, task: Task): Task;
  /** A fresh idempotency key unique to this step. */
  key(label: string): string;
  /** The journal head right now, as an anchor. */
  head(): EventCursor;
  /**
   * Call a tool on an in-process MCP server built on this store. Each label is
   * one server, as one MCP process would be, with its own binding slots. The
   * server's environment is `environment` on its first call, else empty, so
   * nothing about the machine running the tests (Claude or Codex session ids,
   * seat refs) reaches the journal.
   */
  tool(
    server: string,
    name: string,
    args?: Record<string, unknown>,
    environment?: Record<string, string>,
  ): Promise<Record<string, unknown>>;
}

export interface FixtureStep {
  name: string;
  /** Event types this step must append; checked right after it runs. */
  produces?: string[];
  run(context: FixtureContext): void | Promise<void>;
}

const AUTHOR_SEAT_REF = "compat-fixture:author";
const END_SEAT_REF = "compat-fixture:end-by-seat";

/**
 * The steps, in order. Today they write a broad sample of the records a8799aad
 * writes (not all: person acts at the desk and lease expiry are left out), so
 * older builds meet real legacy history alongside any new records.
 *
 * Later slices: append one step per storage addition at the marked place
 * below, naming in `produces` every new event type it writes, and list any new
 * table in VIEW_STATE_TABLES. The `end-by-seat-session` step creates its
 * session through collab_arrive, as spec 8.5 asks. Keep the proposals' voices
 * away from the sessions the old host ends, so ending them cannot move a
 * proposal view.
 */
export const FIXTURE_STEPS: FixtureStep[] = [
  {
    name: "waiter-session",
    async run(context) {
      const started = await context.tool("waiter-process", "collab_session_start", {
        root_path: context.root,
        actor: "fixture-waiter",
        role: "listens for addressed events only",
      });
      const session = started.session as { id: string; workspace_id: string };
      context.manifest.workspace_id = session.workspace_id;
      context.manifest.root_path = (started.worktree as { root_path: string }).root_path;
      context.manifest.waiter = {
        session_id: session.id,
        credential_file: `collab-sessions/${session.id}.json`,
        after_anchor: context.head(),
        addressed_report_id: "",
      };
      context.setId("waiter", session.id);
    },
  },
  {
    name: "author-peer-and-child",
    run(context) {
      const author = context.addSession("author", context.store.startSession({
        root_path: context.root,
        actor: "fixture-author",
        role: "writes the fixture's reports",
        seat_ref: AUTHOR_SEAT_REF,
      }));
      context.addSession("peer", context.store.startSession({
        root_path: context.root,
        actor: "fixture-peer",
        role: "answers the author",
      }));
      // An attested child shares its parent's consent voice.
      context.addSession("child", context.store.startSession({
        root_path: context.root,
        actor: "fixture-author/child",
        role: "a named child of the author",
        parent_session_id: author.session.id,
        parent_attested: true,
      }));
    },
  },
  {
    name: "reports-and-relations",
    run(context) {
      const author = context.session("author");
      const peer = context.session("peer");
      const observation = context.store.appendReportForSession({
        ...author.credential,
        idempotency_key: context.key("observation"),
        kind: "observation",
        body: "Fixture observation.\n\nA body with lines, CJK 協作筆記, combining é and an emoji 🏮.",
        confidence: "medium",
        confidence_basis: "Written by the forward-compatibility fixture.",
        limits: "Nothing here was checked outside the fixture.",
      });
      context.setId("observation", observation.id);
      context.store.appendReportForSession({
        ...peer.credential,
        idempotency_key: context.key("support"),
        kind: "inference",
        body: "I stand behind the observation as stated.",
        relation: "supports",
        target_report_id: observation.id,
        evidence_refs: [`report:${observation.id}`],
      });
      const challenge = context.store.appendReportForSession({
        ...peer.credential,
        idempotency_key: context.key("challenge"),
        kind: "inference",
        body: "The observation should not stand as stated.",
        relation: "challenges",
        target_report_id: observation.id,
      });
      context.store.appendReportForSession({
        ...peer.credential,
        idempotency_key: context.key("resolve"),
        kind: "observation",
        body: "My objection is answered.",
        relation: "resolves",
        target_report_id: challenge.id,
      });
      const retracted = context.store.appendReportForSession({
        ...author.credential,
        idempotency_key: context.key("to-withdraw"),
        kind: "inference",
        body: "A guess the author later withdraws.",
      });
      context.store.appendReportForSession({
        ...author.credential,
        idempotency_key: context.key("withdraw"),
        kind: "inference",
        body: "Disregard my earlier guess.",
        relation: "withdraws",
        target_report_id: retracted.id,
      });
      const addressed = context.store.appendReportForSession({
        ...author.credential,
        idempotency_key: context.key("to-waiter"),
        kind: "observation",
        body: "Addressed to the waiter, so every build's doorbell rings for it.",
        to_session_id: context.id("waiter"),
      });
      context.manifest.waiter!.addressed_report_id = addressed.id;
      context.store.appendReportForSession({
        ...author.credential,
        idempotency_key: context.key("to-person"),
        kind: "observation",
        body: "A note for the person's inbox.",
        to_person: true,
      });
      context.store.appendReportForSession({
        ...author.credential,
        idempotency_key: context.key("decision"),
        kind: "decision",
        body: "Fixture decision: keep the fixture small.",
        confidence: "unknown",
        authority_scope: "the fixture only",
        authority_basis: "recorded by this session; not the person's agreement",
      });
    },
  },
  {
    name: "proposals",
    run(context) {
      const author = context.session("author");
      const peer = context.session("peer");
      const supported = context.store.openProposalForSession({
        ...author.credential,
        idempotency_key: context.key("supported"),
        question: "Should the fixture keep a supported proposal?",
        criteria: "Old builds must read it.",
        extent: "The fixture journal only.",
        known_conflicts: "None known.",
        evidence_refs: [`report:${context.id("observation")}`],
        limits: "A fixture, not a decision.",
        topic: "compat:fixture",
      });
      context.store.appendReportForSession({
        ...peer.credential,
        idempotency_key: context.key("support"),
        kind: "inference",
        body: "Yes.",
        relation: "supports",
        target_report_id: supported.proposal.id,
      });
      const challenged = context.store.openProposalForSession({
        ...author.credential,
        idempotency_key: context.key("challenged"),
        question: "Should the fixture keep a challenged proposal?",
        criteria: "Old builds must read a standing challenge.",
        extent: "The fixture journal only.",
      });
      context.store.appendReportForSession({
        ...peer.credential,
        idempotency_key: context.key("challenge"),
        kind: "inference",
        body: "No: a challenged proposal must show as challenged.",
        relation: "challenges",
        target_report_id: challenged.proposal.id,
      });
      const rejected = context.store.openProposalForSession({
        ...author.credential,
        idempotency_key: context.key("rejected"),
        question: "Should the fixture keep a rejected proposal?",
        criteria: "Old builds must read a relayed rejection.",
        extent: "The fixture journal only.",
      });
      const status: ProposalStatus = context.store.relayProposalRejectionForSession({
        ...peer.credential,
        idempotency_key: context.key("relay"),
        proposal_report_id: rejected.proposal.id,
        proposal_sha256: rejected.proposal_sha256,
        reason: "The person said no to the fixture's third proposal.",
      });
      context.manifest.proposals.push(supported.proposal.id, challenged.proposal.id, status.proposal.id);
    },
  },
  {
    name: "reviewed-edit-task",
    run(context) {
      const author = context.session("author");
      const peer = context.session("peer");
      const created = context.store.createTaskForSession({
        ...author.credential,
        idempotency_key: context.key("create"),
        title: "Reviewed edit task",
        description: "Edit, attach, complete and accept.",
        work_mode: "edit",
        completion_policy: "accepted",
        path_scopes: ["fixture/reviewed.txt"],
      });
      const claimed = context.store.claimTaskForSession({
        ...author.credential,
        idempotency_key: context.key("claim"),
        task_id: created.id,
        expected_version: created.version,
      });
      const progressed = context.store.progressTaskForSession({
        ...author.credential,
        idempotency_key: context.key("progress"),
        task_id: claimed.id,
        lease_id: claimed.lease_id!,
        expected_version: claimed.version,
        message: "Half way.",
      });
      const attached = context.store.attachArtifactForSession({
        ...author.credential,
        idempotency_key: context.key("attach"),
        task_id: progressed.id,
        lease_id: claimed.lease_id!,
        expected_version: progressed.version,
        kind: "test",
        uri: "bun test tests/forward-compat.test.ts",
        label: "fixture test",
      });
      const reported = context.store.completeTaskForSession({
        ...author.credential,
        idempotency_key: context.key("complete"),
        task_id: attached.task.id,
        lease_id: claimed.lease_id!,
        expected_version: attached.task.version,
        summary: "The fixture edit is done.",
        confidence: "high",
        confidence_basis: "The fixture wrote it.",
        limits: "Nothing outside the fixture.",
        evidence_refs: [`artifact:${attached.artifact.id}`],
        review_requested_session_id: peer.session.id,
      });
      const reviewed = context.store.reviewTaskForSession({
        ...peer.credential,
        idempotency_key: context.key("review"),
        task_id: reported.id,
        expected_version: reported.version,
        outcome: "accept",
        summary: "Accepted within the fixture.",
      });
      context.setTask("reviewed", reviewed.task);
    },
  },
  {
    name: "coordination-block-and-handoff",
    run(context) {
      const author = context.session("author");
      const peer = context.session("peer");
      const reported = context.store.createTaskForSession({
        ...peer.credential,
        idempotency_key: context.key("create-reported"),
        title: "Reported coordination task",
        work_mode: "coordination",
        completion_policy: "reported",
      });
      const claimedReported = context.store.claimTaskForSession({
        ...peer.credential,
        idempotency_key: context.key("claim-reported"),
        task_id: reported.id,
        expected_version: reported.version,
      });
      context.store.completeTaskForSession({
        ...peer.credential,
        idempotency_key: context.key("complete-reported"),
        task_id: claimedReported.id,
        lease_id: claimedReported.lease_id!,
        expected_version: claimedReported.version,
        summary: "Reported done.",
      });

      const blockable = context.store.createTaskForSession({
        ...author.credential,
        idempotency_key: context.key("create-blockable"),
        title: "Blocked then unblocked",
        work_mode: "edit",
        path_scopes: ["fixture/blocked.txt"],
      });
      const claimedBlockable = context.store.claimTaskForSession({
        ...author.credential,
        idempotency_key: context.key("claim-blockable"),
        task_id: blockable.id,
        expected_version: blockable.version,
      });
      const blocked = context.store.blockTaskForSession({
        ...author.credential,
        idempotency_key: context.key("block"),
        task_id: claimedBlockable.id,
        lease_id: claimedBlockable.lease_id!,
        expected_version: claimedBlockable.version,
        blocker: "Waiting on nothing in particular.",
      });
      context.store.unblockTaskForSession({
        ...author.credential,
        idempotency_key: context.key("unblock"),
        task_id: blocked.id,
        expected_version: blocked.version,
        note: "Unblocked.",
      });

      const handed = context.store.createTaskForSession({
        ...author.credential,
        idempotency_key: context.key("create-handoff"),
        title: "Handed to the peer",
        work_mode: "coordination",
      });
      const claimedHanded = context.store.claimTaskForSession({
        ...author.credential,
        idempotency_key: context.key("claim-handoff"),
        task_id: handed.id,
        expected_version: handed.version,
      });
      const offer = context.store.offerHandoffForSession({
        ...author.credential,
        idempotency_key: context.key("offer"),
        task_id: claimedHanded.id,
        lease_id: claimedHanded.lease_id!,
        expected_version: claimedHanded.version,
        to_session_id: peer.session.id,
        summary: "Yours if you want it.",
      });
      const accepted = context.store.respondHandoffForSession({
        ...peer.credential,
        idempotency_key: context.key("accept"),
        handoff_id: offer.handoff.id,
        expected_version: offer.task.version,
        response: "accept",
      });
      context.store.releaseTaskForSession({
        ...peer.credential,
        idempotency_key: context.key("release"),
        task_id: accepted.task.id,
        lease_id: accepted.task.lease_id!,
        expected_version: accepted.task.version,
        summary: "Released back to the pool.",
      });
    },
  },
  {
    name: "more-legacy-records",
    run(context) {
      const author = context.session("author");
      const peer = context.session("peer");
      const created = context.store.createTaskForSession({
        ...author.credential,
        idempotency_key: context.key("create"),
        title: "Sent back for changes",
        work_mode: "edit",
        completion_policy: "accepted",
        path_scopes: ["fixture/changes.txt"],
      });
      const claimed = context.store.claimTaskForSession({
        ...author.credential,
        idempotency_key: context.key("claim"),
        task_id: created.id,
        expected_version: created.version,
      });
      const renewed = context.store.renewLeaseForSession({
        ...author.credential,
        idempotency_key: context.key("renew"),
        task_id: claimed.id,
        lease_id: claimed.lease_id!,
        ttl_seconds: 1_800,
      });
      const reported = context.store.completeTaskForSession({
        ...author.credential,
        idempotency_key: context.key("complete"),
        task_id: renewed.id,
        lease_id: claimed.lease_id!,
        expected_version: renewed.version,
        summary: "Ready for a look.",
      });
      context.store.reviewTaskForSession({
        ...peer.credential,
        idempotency_key: context.key("request-changes"),
        task_id: reported.id,
        expected_version: reported.version,
        outcome: "request_changes",
        summary: "Not yet: one more pass.",
      });

      const declined = context.store.createTaskForSession({
        ...peer.credential,
        idempotency_key: context.key("create-declined"),
        title: "A handoff the author declines",
        work_mode: "coordination",
      });
      const held = context.store.claimTaskForSession({
        ...peer.credential,
        idempotency_key: context.key("claim-declined"),
        task_id: declined.id,
        expected_version: declined.version,
      });
      const offer = context.store.offerHandoffForSession({
        ...peer.credential,
        idempotency_key: context.key("offer-declined"),
        task_id: held.id,
        lease_id: held.lease_id!,
        expected_version: held.version,
        to_session_id: author.session.id,
        summary: "Would you take this?",
      });
      context.store.respondHandoffForSession({
        ...author.credential,
        idempotency_key: context.key("decline"),
        handoff_id: offer.handoff.id,
        expected_version: offer.task.version,
        response: "decline",
      });

      context.store.recordDecision({
        workspace_id: context.manifest.workspace_id!,
        actor: "fixture-legacy-actor",
        idempotency_key: context.key("legacy-decision"),
        topic: "fixture",
        decision: "A legacy actor-mode decision record.",
        rationale: "Older clients still write these.",
      });

      // A session that comes back once and then ends, after the proposals, so
      // it is no proposal's voice.
      const brief = context.store.startSession({
        root_path: context.root,
        actor: "fixture-brief",
        role: "resumes once, then ends",
      });
      const resumed = context.store.resumeSession(brief.credential);
      context.store.endSession({ ...resumed.credential, reason: "fixture step finished" });
    },
  },
  {
    name: "peer-pages-and-acks",
    run(context) {
      const peer = context.session("peer");
      const page = context.store.nextForSession({ ...peer.credential, event_limit: 50 });
      context.store.acknowledgeSessionCursor({
        ...peer.credential,
        anchor: page.events.next_anchor,
        expected_cursor_version: page.session.cursor_version,
      });
    },
  },
  {
    name: "end-by-seat-session",
    async run(context) {
      // Started by collab_arrive (spec 8.5), which takes no seat_ref: the host
      // declares it in the server's environment, as a real host would.
      const arrived = await context.tool("seat-process", "collab_arrive", {
        root_path: context.root,
        name: "fixture-seat",
        purpose: "ended by the old host through its seat ref",
      }, { AGENTOOL_COLLAB_SEAT_REF: END_SEAT_REF });
      const id = (arrived.you as { session: string; seat_ref: string | null }).session;
      if ((arrived.you as { seat_ref: string | null }).seat_ref !== END_SEAT_REF) {
        throw new Error("collab_arrive did not take the host's seat ref");
      }
      context.manifest.end_by_seat_ref = {
        session_id: id,
        seat_ref: END_SEAT_REF,
        credential_file: `collab-sessions/${id}.json`,
      };
    },
  },
  {
    name: "end-by-file-session",
    async run(context) {
      const started = await context.tool("leaver-process", "collab_session_start", {
        root_path: context.root,
        actor: "fixture-leaver",
        role: "ended by the old host from its credential file",
      });
      const id = (started.session as { id: string }).id;
      context.manifest.end_by_session_file = { session_id: id, credential_file: `collab-sessions/${id}.json` };
    },
  },
  {
    // Collab Notes stage 1: a session collab_arrive started, with a model; a
    // named child it attests; a purpose revision; and the inbox's view state.
    name: "notes-arrive-and-inbox",
    produces: ["purpose.declared"],
    async run(context) {
      const arrived = await context.tool("notes-process", "collab_arrive", {
        root_path: context.root,
        name: "fixture-notes",
        model: "fixture-model-1",
        purpose: "arrives through the notes surface",
      });
      const you = arrived.you as { session: string };
      const child = await context.tool("notes-process", "collab_arrive", {
        binding_key: "fixture-child",
        parent: you.session,
        purpose: "a named child the notes surface attests",
      });
      const revised = await context.tool("notes-process", "collab_arrive", {
        purpose: "revises its purpose on the record",
        revise_purpose: true,
      });
      if ((revised.you as { purpose: string }).purpose !== "revises its purpose on the record") {
        throw new Error("the purpose revision did not read back");
      }
      context.store.appendReportForSession({
        ...context.session("author").credential,
        idempotency_key: context.key("to-notes"),
        kind: "observation",
        body: "Addressed to the notes session, so its inbox has an item.",
        to_session_id: you.session,
      });
      const inbox = await context.tool("notes-process", "collab_inbox", {});
      if ((inbox.items as unknown[]).length !== 1) throw new Error("the notes session's inbox did not list its item");
      // Both view tables this stage fills hold rows, so dropping them is a real test.
      for (const table of ["note_marks", "note_shown"]) {
        const rows = (context.store.db.query(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count;
        if (rows === 0) throw new Error(`fixture view table ${table} is empty`);
      }
      context.manifest.notes_sessions.push(you.session, (child.you as { session: string }).session);
    },
  },
  {
    // Collab Notes stage 2: marked notes of every act collab_note records,
    // one evidence.cited event, and take / done / review cycles. One task the
    // new surface finished is left waiting, for each older build to review.
    name: "notes-speech-review-and-work",
    produces: ["evidence.cited"],
    async run(context) {
      mkdirSync(join(context.root, "fixture"), { recursive: true });
      writeFileSync(join(context.root, "fixture", "notes.txt"), "line one\nline two, 第二行\n");
      const notes = "notes-process";
      const peer = "notes-peer-process";
      await context.tool(peer, "collab_arrive", {
        root_path: context.root,
        name: "fixture-notes-peer",
        purpose: "answers the notes session",
      });
      const text = [
        "note: The fixture note cites a file, a test and a report",
        "",
        "A body with CJK 協作筆記 and an emoji 🏮, as older builds must list it byte for byte.",
        "",
        "Why: the file holds two lines (seen 1)",
        "Why: the test passed when it was written (told 2)",
        "Why: the observation came first (quoted 3)",
        `Evidence: file fixture/notes.txt:1-2`,
        "Evidence: test bun test tests/forward-compat.test.ts exit=0",
        `Evidence: report:${context.id("observation")}`,
        "Limits: nothing outside the fixture was checked",
        "X-Fixture: compat",
      ].join("\n");
      const first = await context.tool(notes, "collab_note", { text });
      if (first.read_as !== "collab-note/1") throw new Error("the fixture note was not read as a note");
      const noteId = (first.ids as { report: string }).report;
      await context.tool(peer, "collab_note", {
        act: "support",
        text: "The fixture note stands as stated.",
        re: noteId,
        why: [{ text: "I read it", basis: "seen", cites: [1] }],
        evidence: [`report:${noteId}`],
      });
      const challenge = await context.tool(peer, "collab_note", { act: "challenge", text: "The note should say more.", re: noteId });
      const replaced = await context.tool(peer, "collab_note", {
        act: "challenge",
        text: "The note should name what it did not check.",
        re: noteId,
        replaces: (challenge.ids as { report: string }).report,
      });
      const standing = (replaced.ids as { report: string }).report;
      // From another voice a resolve is an answer; from the challenger it lifts.
      await context.tool(notes, "collab_note", { act: "resolve", text: "Its limits line names that.", re: standing });
      await context.tool(peer, "collab_note", { act: "resolve", text: "Answered: the limits line names it.", re: standing });
      const second = await context.tool(notes, "collab_note", { text: "A note the notes session withdraws." });
      await context.tool(notes, "collab_note", { act: "withdraw", text: "Disregard it.", re: (second.ids as { report: string }).report });
      const proposal = context.store.openProposalForSession({
        ...context.session("author").credential,
        idempotency_key: context.key("relay-proposal"),
        question: "Should the notes surface relay a rejection?",
        criteria: "Older builds must read the relayed no.",
        extent: "The fixture journal only.",
      });
      await context.tool(peer, "collab_note", {
        act: "relay_rejection",
        text: "The person said no to the fixture's relay proposal.",
        re: proposal.proposal.id,
      });

      const cycle = async (title: string, path: string) => {
        writeFileSync(join(context.root, path), `${title}\n`);
        const taken = await context.tool(notes, "collab_take", { title, paths: [path] });
        const done = await context.tool(notes, "collab_done", {
          text: `${title} is done.`,
          why: [{ text: "the file is written", basis: "seen", cites: [1] }],
          evidence: [`file ${path}`],
          limits: "Only the fixture.",
        });
        return { task: (taken.ids as { task: string }).task, completion: (done.ids as { completion: string }).completion };
      };
      const accepted = await cycle("Fixture notes task", "fixture/notes-accepted.txt");
      await context.tool(peer, "collab_inbox", { about: accepted.task });
      await context.tool(peer, "collab_note", { act: "accept", text: "The fixture task holds.", re: accepted.task });
      const changes = await cycle("Fixture changes task", "fixture/notes-changes.txt");
      await context.tool(peer, "collab_note", { act: "request_changes", text: "One more pass.", re: changes.completion });
      const waiting = await cycle("Fixture task for an older reviewer", "fixture/notes-old-review.txt");
      context.manifest.review_task_id = waiting.task;
    },
  },
  {
    // Collab Notes stage 3: proposals through collab_propose (with outside
    // evidence and limits in the hashed bytes), a support and a challenge
    // through collab_note, the person's agreement through the desk's own
    // functions, a decide on the agreed proposal, and a replaced proposal
    // whose standing objection is carried into the new terms and told to
    // its objector. Every older build with consent/v1 must compute the same
    // status for all three proposals.
    name: "notes-propose-and-decide",
    produces: ["evidence.cited"],
    async run(context) {
      const notes = "notes-process";
      const peer = "notes-peer-process";
      const agreed = await context.tool(notes, "collab_propose", {
        question: "Should the fixture keep a proposal the person agreed to?\n\nOlder builds must read its terms, 協作筆記 🏮.",
        criteria: "Older builds compute the same status for it.",
        extent: "The fixture journal only.",
        closes: 600,
        conflicts: "None known.",
        evidence: ["file fixture/notes.txt:1", `report:${context.id("observation")}`],
        limits: "A fixture, not a direction.",
        topic: "compat:notes-propose",
      });
      const agreedId = (agreed.ids as { proposal: string }).proposal;
      await context.tool(peer, "collab_note", {
        act: "support",
        text: "The fixture proposal stands as stated.",
        re: agreedId,
        why: [{ text: "its terms read back", basis: "seen" }],
      });
      const replaced = await context.tool(notes, "collab_propose", {
        question: "Should the fixture replace a challenged proposal?",
        criteria: "The replacement carries the objection.",
        extent: "The fixture journal only.",
        closes: 600,
      });
      const replacedId = (replaced.ids as { proposal: string }).proposal;
      await context.tool(peer, "collab_note", { act: "challenge", text: "No: it should say what it carries.", re: replacedId });
      const replacement = await context.tool(notes, "collab_propose", {
        question: "Should the fixture replace a challenged proposal, carrying its objection?",
        criteria: "The replacement carries the objection.",
        extent: "The fixture journal only.",
        replaces: replacedId,
      });
      const replacementId = (replacement.ids as { proposal: string }).proposal;
      if (!((replacement.ids as { objector_notes?: unknown[] }).objector_notes ?? []).length) {
        throw new Error("the replacement told no objector");
      }
      // After the close, one qualifying support and no standing challenge: consented.
      context.clock.advance(601_000);
      const challenge = context.store.personActChallenge({ proposal_report_id: agreedId, act: "agree" });
      const status = context.store.recordPersonActAtTerminal({
        proposal_report_id: agreedId,
        proposal_sha256: challenge.proposal_sha256,
        act: "agree",
        expected_ai_snapshot: challenge.ai_snapshot,
      });
      if (!status.may_proceed) throw new Error("the fixture's agreement did not let it proceed");
      const decided = await context.tool(notes, "collab_note", { act: "decide", text: "The fixture keeps its agreed proposal.", re: agreedId });
      // A decision naming no proposal that cites the agreement anyway: it
      // rests on nothing, whatever an older build writes beside it.
      const agreedEvent = context.store.db.query(`SELECT id FROM events WHERE type = 'proposal.agreed' AND entity_id = ?`)
        .get(agreedId) as { id: string };
      const own = await context.tool(peer, "collab_note", {
        act: "decide",
        text: "The fixture peer records a decision of its own.",
        extent: "The fixture journal only.",
        evidence: [`report:${agreedId}`, `event:${agreedEvent.id}`],
      });
      context.manifest.proposals.push(agreedId, replacedId, replacementId);
      context.manifest.decisions.push((decided.ids as { report: string }).report, (own.ids as { report: string }).report);
    },
  },
  {
    // Collab Notes stage 4: a sealed ballot from open to reveal. The opener
    // chooses two voters; the peer casts and then replaces its cast, the
    // opener abstains, and a session outside the electorate casts late.
    // The reveal runs in the housekeeping of the first inbox call after the
    // close, and deletes the seal files, so nothing outside the journal is
    // needed to read the result.
    name: "notes-ballot",
    produces: ["ballot.opened", "ballot.cast", "ballot.revealed", "ballot.closed"],
    async run(context) {
      const notes = "notes-process";
      const peer = "notes-peer-process";
      const late = "notes-late-process";
      const opened = await context.tool(notes, "collab_poll", {
        question: "Which layout should the fixture's cache use?\n\nOlder builds page over every ballot event, 協作 🏮.",
        options: [
          { key: "keep", label: "Keep one table" },
          { key: "split", label: "Split it per workspace" },
          { key: "drop", label: "Drop the cache" },
        ],
        closes: "1m",
        criteria: "Fewest writes per open.\n\nNo new dependency.",
        quorum: 2,
        voters: ["fixture-notes", "fixture-notes-peer"],
      });
      const ballot = opened.ballot as string;
      await context.tool(late, "collab_arrive", { root_path: context.root, name: "fixture-late-voter", purpose: "casts outside the electorate" });
      await context.tool(peer, "collab_vote", { ballot, choice: ["keep"] });
      context.clock.advance();
      await context.tool(peer, "collab_vote", {
        ballot,
        choice: ["split"],
        why: [{ text: "per-workspace tables halve the writes", basis: "inferred", cites: [1] }],
        evidence: ["file fixture/notes.txt:1"],
        shared: "same fixture, same model",
      });
      await context.tool(notes, "collab_vote", { ballot, choice: [] });
      const outside = await context.tool(late, "collab_vote", { ballot, choice: ["drop"] });
      if (outside.counts_as !== "late") throw new Error("the fixture's outside cast was not late");
      context.clock.advance(61_000);
      const read = await context.tool(notes, "collab_inbox", { about: ballot });
      const result = (read.ballot as { result: { status: string } | null }).result;
      if (result?.status !== "top_choice") throw new Error(`the fixture ballot did not reveal a top choice: ${JSON.stringify(result)}`);
      if ((context.store.db.query(`SELECT COUNT(*) AS count FROM note_ballots`).get() as { count: number }).count === 0) {
        throw new Error("fixture view table note_ballots is empty");
      }
      context.manifest.ballots.push(ballot);
    },
  },
  {
    // consent/v2: a proposal opened by a host configured with
    // AGENTOOL_COLLAB_CONSENT_RULE=consent/v2, supported by a peer and
    // challenged by a session that then leaves; the person sets that
    // challenge aside at the terminal and, after the close, agrees. A second
    // consent/v2 proposal stays open with no person act, so an older build's
    // inbox meets one too.
    name: "consent-v2-set-aside",
    produces: ["proposal.challenge_set_aside"],
    async run(context) {
      const v2 = { AGENTOOL_COLLAB_CONSENT_RULE: "consent/v2" };
      const author = "v2-author-process";
      const peer = "notes-peer-process";
      const challenger = "v2-challenger-process";
      await context.tool(author, "collab_arrive", {
        root_path: context.root,
        name: "fixture-v2-author",
        purpose: "opens consent/v2 proposals",
      }, v2);
      const opened = await context.tool(author, "collab_propose", {
        question: "Should the fixture keep a consent/v2 proposal with a set-aside?\n\nOlder builds must refuse it by code, 協作 🏮.",
        criteria: "Older builds list it as unreadable and keep working.",
        extent: "The fixture journal only.",
        closes: 600,
      });
      if (opened.rule !== "consent/v2") throw new Error("the fixture's consent/v2 host did not open a consent/v2 proposal");
      const proposalId = (opened.ids as { proposal: string }).proposal;
      await context.tool(peer, "collab_note", {
        act: "support",
        text: "The consent/v2 fixture proposal stands as stated.",
        re: proposalId,
        why: [{ text: "its terms read back", basis: "seen" }],
      });
      await context.tool(challenger, "collab_arrive", {
        root_path: context.root,
        name: "fixture-v2-challenger",
        purpose: "challenges and then leaves",
      });
      const challenged = await context.tool(challenger, "collab_note", {
        act: "challenge",
        text: "No: the fixture should not hold a consent/v2 proposal yet.",
        re: proposalId,
      });
      const challengeId = (challenged.ids as { report: string }).report;
      await context.tool(challenger, "collab_done", { text: "Leaving the fixture.", outcome: "leave" });
      const reason = "The challenger left; the fixture exists to hold this.";
      const shown = context.store.personSetAsideChallenge({
        proposal_report_id: proposalId,
        challenge_report_id: challengeId,
        reason,
      });
      context.store.recordSetAsideAtTerminal({
        proposal_report_id: proposalId,
        proposal_sha256: shown.proposal_sha256,
        challenge_report_id: challengeId,
        challenge_sha256: shown.challenge_sha256,
        reason,
        expected_ai_snapshot: shown.ai_snapshot,
      });
      if ((context.store.db.query(`SELECT COUNT(*) AS count FROM proposal_set_asides`).get() as { count: number }).count === 0) {
        throw new Error("fixture view table proposal_set_asides is empty");
      }
      // After the close, one qualifying support and the challenge set aside: consented.
      context.clock.advance(601_000);
      const agree = context.store.personActChallenge({ proposal_report_id: proposalId, act: "agree" });
      if (!agree.ai_snapshot.set_aside_challenge_report_ids?.includes(challengeId)) {
        throw new Error("the fixture's agreement does not bind its set-aside");
      }
      const status = context.store.recordPersonActAtTerminal({
        proposal_report_id: proposalId,
        proposal_sha256: agree.proposal_sha256,
        act: "agree",
        expected_ai_snapshot: agree.ai_snapshot,
      });
      if (!status.may_proceed) throw new Error("the fixture's consent/v2 agreement did not let it proceed");
      const open = await context.tool(author, "collab_propose", {
        question: "Should the fixture keep an open consent/v2 proposal?",
        criteria: "Older builds list it as unreadable in the person's inbox.",
        extent: "The fixture journal only.",
      });
      context.manifest.v2_proposals.push(proposalId, (open.ids as { proposal: string }).proposal);
    },
  },
  // Later slices append their steps here.
];

/**
 * Run the steps against a store and describe the journal they wrote. The store
 * must be new and empty, opened with `clock.now`; the caller closes it.
 */
export async function exerciseFixture(
  store: CollabStore,
  options: { root: string; clock: FixtureClock; steps?: FixtureStep[] },
): Promise<FixtureManifest> {
  const steps = options.steps ?? FIXTURE_STEPS;
  const sessions = new Map<string, SessionHandle>();
  const ids = new Map<string, string>();
  const tasks = new Map<string, Task>();
  const servers = new Map<string, ReturnType<typeof buildCollabMcpServer>>();
  const manifest: ManifestDraft = { proposals: [], notes_sessions: [], decisions: [], ballots: [], v2_proposals: [] };
  const produced = new Set<string>();
  const ran: string[] = [];
  const names = new Set<string>();
  let current = "";
  let keys = 0;

  const context: FixtureContext = {
    store,
    root: options.root,
    clock: options.clock,
    manifest,
    get step() {
      return current;
    },
    session(name) {
      const handle = sessions.get(name);
      if (!handle) throw new Error(`fixture session not started: ${name}`);
      return handle;
    },
    addSession(name, handle) {
      if (sessions.has(name)) throw new Error(`fixture session already exists: ${name}`);
      sessions.set(name, handle);
      return handle;
    },
    id(name) {
      const value = ids.get(name);
      if (!value) throw new Error(`fixture id not recorded: ${name}`);
      return value;
    },
    setId(name, value) {
      ids.set(name, value);
      return value;
    },
    task(name) {
      const task = tasks.get(name);
      if (!task) throw new Error(`fixture task not recorded: ${name}`);
      return task;
    },
    setTask(name, task) {
      tasks.set(name, task);
      return task;
    },
    key(label) {
      keys += 1;
      return `fixture-${current}-${label}-${keys}`;
    },
    head() {
      const row = store.db.query(`
        SELECT epoch_id, sequence, hash FROM events ORDER BY sequence DESC LIMIT 1
      `).get() as EventCursor | null;
      if (!row) throw new Error("the fixture journal has no events yet");
      return { epoch_id: row.epoch_id, sequence: row.sequence, hash: row.hash };
    },
    async tool(serverLabel, name, args = {}, environment = {}) {
      let server = servers.get(serverLabel);
      if (!server) {
        server = buildCollabMcpServer(store, { environment });
        servers.set(serverLabel, server);
      }
      const registration = (server as unknown as {
        _registeredTools: Record<string, { handler?: Function; callback?: Function }>;
      })._registeredTools[name];
      if (!registration) throw new Error(`tool not registered: ${name}`);
      const result = await (registration.handler ?? registration.callback)!(args, {}) as {
        isError?: boolean;
        structuredContent: Record<string, unknown>;
      };
      if (result.isError) {
        throw new Error(`${name} failed in fixture step ${current}: ${JSON.stringify(result.structuredContent)}`);
      }
      return result.structuredContent;
    },
  };

  for (const step of steps) {
    if (names.has(step.name)) throw new Error(`duplicate fixture step: ${step.name}`);
    names.add(step.name);
    current = step.name;
    options.clock.advance();
    const before = eventCount(store);
    await step.run(context);
    const written = new Set((store.db.query(`
      SELECT type FROM events ORDER BY sequence LIMIT -1 OFFSET ?
    `).all(before) as Array<{ type: string }>).map((row) => row.type));
    for (const type of step.produces ?? []) {
      if (!written.has(type)) throw new Error(`fixture step ${step.name} did not write ${type}`);
      produced.add(type);
    }
    ran.push(step.name);
  }

  const workspaces = store.db.query(`SELECT id FROM workspaces`).all() as Array<{ id: string }>;
  if (workspaces.length !== 1 || workspaces[0]!.id !== manifest.workspace_id) {
    throw new Error("the fixture must write exactly one workspace");
  }
  for (const field of ["workspace_id", "root_path", "waiter", "end_by_seat_ref", "end_by_session_file", "review_task_id"] as const) {
    if (!manifest[field]) throw new Error(`fixture manifest is missing ${field}`);
  }
  if (!manifest.waiter!.addressed_report_id) throw new Error("fixture manifest has no addressed report");
  const types = (store.db.query(`SELECT DISTINCT type FROM events ORDER BY type`).all() as Array<{ type: string }>)
    .map((row) => row.type);
  return {
    format: "agenttool.collab-compat-fixture/1",
    workspace_id: manifest.workspace_id!,
    root_path: manifest.root_path!,
    steps: ran,
    produced_types: [...produced].sort(),
    event_types: types,
    head_sequence: eventCount(store),
    proposals: manifest.proposals,
    waiter: manifest.waiter!,
    end_by_seat_ref: manifest.end_by_seat_ref!,
    end_by_session_file: manifest.end_by_session_file!,
    notes_sessions: manifest.notes_sessions,
    review_task_id: manifest.review_task_id!,
    decisions: manifest.decisions,
    ballots: manifest.ballots,
    v2_proposals: manifest.v2_proposals,
  };
}

/**
 * Views computed from the journal that must not change when an older build
 * writes to the same file (the "reverse" direction of spec 8.5), nor when the
 * view-state tables are dropped. Later slices add theirs (the ballot result,
 * for one). Each view reads only; the caller opens the store at a fixed clock.
 */
export const FIXTURE_VIEWS: Record<string, (store: CollabStore, manifest: FixtureManifest) => unknown> = {
  proposal_status: (store, manifest) =>
    manifest.proposals.map((id) => store.proposalStatus(manifest.workspace_id, id)),
  // consent/v2 statuses, set-asides included: read by this build only (older
  // builds refuse them by code), unchanged by older writes, and rebuilt
  // intact when proposal_set_asides is dropped.
  v2_proposal_status: (store, manifest) =>
    manifest.v2_proposals.map((id) => store.proposalStatus(manifest.workspace_id, id)),
  // Purpose, model and voice come from the journal (purpose.declared,
  // session.joined.model, attestations), never from the view tables.
  note_sessions: (store, manifest) => {
    const views = new Map(store.noteSessionViews(manifest.workspace_id).map((view) => [view.id, view]));
    return manifest.notes_sessions.map((id) => {
      const view = views.get(id)!;
      return {
        id: view.id,
        actor: view.actor,
        role: view.role,
        purpose: view.purpose,
        model: view.model,
        seat_ref: view.seat_ref,
        voice_id: view.voice_id,
        parent_session_id: view.parent_session_id,
      };
    });
  },
  // What a decision rests on, read from the journal alone: never from the
  // view tables, and not moved by anything an older build writes.
  notes_decisions: (store, manifest) =>
    manifest.decisions.map((id) => {
      const record = store.noteDecisionView(manifest.workspace_id, id);
      return {
        id,
        outcome: record.outcome,
        authority: record.authority,
        proposal: record.proposal?.status.proposal.id ?? null,
        rests_on: record.rests_on?.id ?? null,
        agreement_current: record.agreement_current,
      };
    }),
  // A ballot's result, computed from the journal on every read. Its
  // delivery count comes from note_shown, which is view state, so it is
  // left out: losing that table may lower it and changes nothing else.
  ballot_result: (store, manifest) =>
    manifest.ballots.map((id) => {
      const result = store.ballotResult(manifest.workspace_id, id);
      if (!result) return { id, result: null };
      const { delivery_recorded: _delivered, ...turnout } = result.turnout;
      return { id, result: { ...result, turnout } };
    }),
};

function eventCount(store: CollabStore): number {
  return (store.db.query(`SELECT COUNT(*) AS count FROM events`).get() as { count: number }).count;
}
