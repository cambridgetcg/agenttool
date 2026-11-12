import { buildCollabMcpServer } from "../../src/mcp.js";
import type { EventCursor, ProposalStatus, SessionHandle, Task } from "../../src/protocol.js";
import type { CollabStore } from "../../src/store.js";

/**
 * The forward-compatibility fixture (Collab Notes spec 8.5): a journal written
 * by today's source that older builds must open, verify, page, ack and write
 * to. Each later slice extends it by appending steps to FIXTURE_STEPS, so the
 * harness always exercises every storage addition that exists.
 */

/** Event types Collab Notes adds (spec 8.2). Older builds have never seen them. */
export const COLLAB_NOTES_EVENT_TYPES = [
  "purpose.declared",
  "evidence.cited",
  "ballot.opened",
  "ballot.cast",
  "ballot.revealed",
  "ballot.closed",
] as const;

/**
 * Tables Collab Notes adds (spec 8.1). They hold view state only, so dropping
 * them must lose nothing the journal records. A slice that creates one of
 * these lists it here; the harness refuses any other new table.
 */
export const VIEW_STATE_TABLES: string[] = [];

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
}

type ManifestDraft = Partial<Omit<FixtureManifest, "format" | "steps" | "produced_types" | "event_types" | "head_sequence">> & {
  proposals: string[];
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
 * table in VIEW_STATE_TABLES. When `collab_arrive` exists, the
 * `end-by-seat-session` step should create its session through it, as spec
 * 8.5 asks (arrive takes no seat_ref, so pass the server the environment
 * `{ AGENTOOL_COLLAB_SEAT_REF: END_SEAT_REF }`). Keep the proposals' voices
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
      const started = await context.tool("seat-process", "collab_session_start", {
        root_path: context.root,
        actor: "fixture-seat",
        role: "ended by the old host through its seat ref",
        seat_ref: END_SEAT_REF,
      });
      const id = (started.session as { id: string }).id;
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
  const manifest: ManifestDraft = { proposals: [] };
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
  for (const field of ["workspace_id", "root_path", "waiter", "end_by_seat_ref", "end_by_session_file"] as const) {
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
};

function eventCount(store: CollabStore): number {
  return (store.db.query(`SELECT COUNT(*) AS count FROM events`).get() as { count: number }).count;
}
