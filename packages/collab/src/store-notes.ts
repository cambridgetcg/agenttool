/**
 * Collab Notes: the store behind the eight verbs (spec sections 5 and 8.4).
 * CollabStore extends the legacy store (CollabStoreCore in store.ts) with the
 * reads and view state of the notes surface: arrival and the inbox, the
 * look-back, threads, notes and cites, proposals and decisions as the verbs
 * see them, and sealed ballots. They add events of new types and rows in the
 * view-state tables only; no existing record, relation or rule is changed,
 * and the legacy store compiles and runs without this module.
 *
 * Everything store.ts exports is exported here too, so this is the module
 * to import CollabStore from.
 */
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import {
  BALLOT_SEALING,
  type BallotResult,
  ballotResult as computeBallotResult,
  type BallotTerms,
  buildElectorate,
  type CastToResolve,
  classifyCaster,
  type ElectorateSession,
  type ElectorateUnit,
  type LeftOutSession,
  MAX_CASTS_PER_SESSION,
  nextCastSeq,
  normalizeBallotVoters,
  openSeal,
  type PollTermsInput,
  resolveCasts,
  revealedEntriesSha256,
  type RevealedEntry,
  type SealOutcome,
  unitBasis,
  validatePollTerms,
} from "./ballot.js";
import {
  listSealBallots,
  listSealFiles,
  listSealTemporaries,
  readSealFile,
  removeEmptySealDirectory,
  removeSealFile,
  sealPath,
} from "./ballot-seal.js";
import { canonicalJson } from "./canonical.js";
import { CollabError } from "./errors.js";
import { hasLoneSurrogate, NOTE_FORMAT, parseNote } from "./note.js";
import {
  type CollabEvent,
  type CollabEventType,
  type CollabReport,
  type EventCursor,
  type PersonActBasis,
  type ProposalPersonAct,
  type ProposalStatus,
  type ProposalVoice,
  type SessionLiveness,
  type Task,
  type TaskConflict,
  type TaskReview,
  type TaskWorkMode,
  type UnreadableProposal,
  type Workspace,
} from "./protocol.js";
import {
  cleanText,
  CollabStoreCore,
  type CollabStoreOptions,
  type CoordinationSessionRow,
  eventFromRow,
  type EventRow,
  GENESIS_HASH,
  MAX_REPORT_BODY,
  normalizeEvidenceRefs,
  normalizePathScopes,
  optionalText,
  type ProposalReadContext,
  type ReceiptPlanGuard,
  reportFromRow,
  type ReportRow,
  reviewFromRow,
  type ReviewRow,
  sessionLiveness,
  validateId,
  validateIdempotencyKey,
} from "./store.js";

export class CollabStore extends CollabStoreCore {
  constructor(path: string, options: CollabStoreOptions = {}) {
    // Opening order is as it was: the core validates every journal, creates
    // the view tables and rebuilds the ballot view; then seals left by a
    // crashed reveal are swept.
    super(path, options);
    this.sweepRevealedSeals();
  }

  /**
   * The notes surface's own view of each given proposal, for the person
   * desk's soft-spot lines (src/desk-soft-spots.ts). It is noteProposalData,
   * the read every agent-facing proposal view makes, so the desk and the
   * agents see the same facts. Read-only, one snapshot: it records no
   * delivery and moves no mark. A proposal it cannot read comes back with its
   * error code instead of failing the others.
   */
  personDeskProposalViews(workspaceId: string, proposalIds: readonly string[]): Array<
    { proposal_report_id: string; view: NoteProposalData } | { proposal_report_id: string; error: string }
  > {
    this.requireWorkspace(workspaceId);
    return this.db.transaction(() => {
      const sessions = this.noteSessionViews(workspaceId);
      const context = this.proposalReadContext(workspaceId);
      return proposalIds.map((proposalId) => {
        try {
          this.requireProposalTerms(workspaceId, validateId(proposalId, "proposal_report_id"));
          return { proposal_report_id: proposalId, view: this.noteProposalData(workspaceId, proposalId, sessions, context) };
        } catch (error) {
          if (!(error instanceof CollabError)) throw error;
          return { proposal_report_id: proposalId, error: error.code };
        }
      });
    }).deferred();
  }

  // ---------------------------------------------------------------------------
  // Collab Notes (spec sections 5 and 8.4): the reads and view state behind the
  // verbs in verbs.ts. They add events of new types and rows in the view-state
  // tables only; no existing record, relation or rule is changed.

  /** Every coordination session of a workspace as the notes surface shows it, most recently seen first. Read-only. */
  noteSessionViews(workspaceId: string): NoteSessionView[] {
    this.requireWorkspace(workspaceId);
    const rows = this.db.query(`
      SELECT * FROM coordination_sessions WHERE workspace_id = ?
      ORDER BY last_seen_at DESC, id
    `).all(workspaceId) as CoordinationSessionRow[];
    // One pass over the two event types that carry self-declared facts; the
    // events table has no index on type, so this is cheaper than one per session.
    const declared = this.db.query(`
      SELECT entity_id, type, payload_json FROM events
      WHERE workspace_id = ? AND type IN ('session.joined', 'purpose.declared')
      ORDER BY sequence
    `).all(workspaceId) as Array<{ entity_id: string; type: string; payload_json: string }>;
    const joined = new Map<string, { seat_ref: string | null; model: string | null }>();
    const purposes = new Map<string, string>();
    for (const row of declared) {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      if (row.type === "session.joined") {
        joined.set(row.entity_id, {
          seat_ref: typeof payload.seat_ref === "string" ? payload.seat_ref : null,
          model: typeof payload.model === "string" ? payload.model : null,
        });
      } else if (typeof payload.purpose === "string") {
        // Journal order, so the latest declaration wins.
        purposes.set(row.entity_id, payload.purpose);
      }
    }
    const observedAt = this.timestamp();
    const voices = new Map<string, string>();
    return rows.map((row) => ({
      id: row.id,
      workspace_id: row.workspace_id,
      worktree_id: row.worktree_id,
      actor: row.actor,
      role: row.role,
      purpose: purposes.get(row.id) ?? row.role,
      model: joined.get(row.id)?.model ?? null,
      seat_ref: joined.get(row.id)?.seat_ref ?? null,
      voice_id: this.cachedVoice(row.id, voices),
      parent_session_id: row.parent_session_id,
      status: row.status,
      joined_at: row.joined_at,
      last_seen_at: row.last_seen_at,
      liveness: sessionLiveness(row, observedAt),
    }));
  }

  /** A session's consent voice: the root of its attested lineage (spec 7 "voice"). Read-only. */
  consentVoiceOf(sessionId: string): string {
    return this.consentVoice(validateId(sessionId, "session_id"));
  }

  /**
   * Append `purpose.declared` for this session (spec 5.1, revise_purpose). The
   * role column is never rewritten; the current purpose is read from the
   * latest declaration. A self-declared statement, never a grant.
   */
  declarePurposeForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    idempotency_key: string;
    purpose: string;
    /** A derived key's plan, re-checked inside the write's transaction (see ReceiptPlanGuard). */
    receipt_plan?: ReceiptPlanGuard;
  }): NotePurposeReceipt {
    const purpose = validateNotePurpose(input.purpose);
    return this.mutateAsSession(input, input.idempotency_key, "notes.purpose.v1", { purpose }, (session) => {
      const payload = { session_id: session.id, purpose };
      assertNotePayload(payload);
      const event = this.appendEvent(session.workspace_id, "purpose.declared", session.id, session.actor, payload, session.id);
      return {
        session_id: session.id,
        purpose,
        event_id: event.id,
        sequence: event.sequence,
        declared_at: event.occurred_at,
      };
    }, input.receipt_plan ? { receipt_plan: input.receipt_plan } : {});
  }

  /**
   * Record outside evidence as one `evidence.cited` event (spec 5.3, 8.2): a
   * separate step before a review, a completion or a proposal, whose own
   * transaction the cite cannot join. Hashing and git probes happened before
   * this call; inside it only the cheap facts are checked again.
   */
  citeEvidenceForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    idempotency_key: string;
    worktree_id: string | null;
    items: NoteCitedItem[];
    receipt_plan?: ReceiptPlanGuard;
  }): NoteCiteReceipt {
    const cite = normalizeNoteCite({ worktree_id: input.worktree_id, items: input.items });
    if (cite.items.length === 0) throw new CollabError("invalid_evidence", "A cite needs at least one outside evidence item");
    return this.mutateAsSession(input, input.idempotency_key, "notes.cite.v1", cite, (session) =>
      this.appendNoteCite(session, cite), input.receipt_plan ? { receipt_plan: input.receipt_plan } : {});
  }

  /**
   * Post a note (spec 5.3): an optional `evidence.cited` event and one or two
   * marked reports, in one transaction. Two reports are a challenge and the
   * withdrawal of the challenge it replaces, posted in that order, so the
   * objection stands at every instant. Every report goes through the same
   * checks as collab_report_append.
   */
  appendNoteForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    idempotency_key: string;
    cite?: { worktree_id: string | null; items: NoteCitedItem[] } | null;
    reports: NoteReportInput[];
    receipt_plan?: ReceiptPlanGuard;
  }): NoteAppendReceipt {
    if (!Array.isArray(input.reports) || input.reports.length < 1 || input.reports.length > 2) {
      throw new CollabError("invalid_note_reports", "A note posts one report, or a challenge and the withdrawal it replaces");
    }
    const cite = input.cite && input.cite.items.length > 0 ? normalizeNoteCite(input.cite) : null;
    const reports = input.reports.map((report, index) => normalizeNoteReport(report, index));
    if (reports.some((report) => report.cite_event) && !cite) {
      throw new CollabError("invalid_note_reports", "A report cites this note's evidence, but the note has none");
    }
    return this.mutateAsSession(input, input.idempotency_key, "notes.note.v1", { cite, reports }, (session) => {
      const cited = cite ? this.appendNoteCite(session, cite) : null;
      const posted: CollabReport[] = [];
      for (const report of reports) {
        const evidenceRefs = normalizeEvidenceRefs([
          ...report.evidence_refs,
          ...(report.cite_event ? [`event:${cited!.event_id}`] : []),
          ...report.cite_earlier.map((index) => `report:${posted[index]!.id}`),
        ]);
        const normalized = {
          task_id: report.task_id,
          to_session_id: report.to_session_id,
          kind: report.kind,
          body: report.body,
          evidence_refs: evidenceRefs,
          confidence: "unknown" as const,
          confidence_basis: null,
          limits: null,
          relation: report.relation,
          target_report_id: report.target_report_id,
          authority_scope: null,
          authority_basis: null,
          ...(report.to_person ? { to_person: true } : {}),
        };
        this.validateReportInput(session, normalized);
        this.refuseProposalRewrite(normalized);
        if (report.about_proposal_id) {
          const termed = this.db.query(`SELECT workspace_id FROM proposal_terms WHERE report_id = ?`)
            .get(report.about_proposal_id) as { workspace_id: string } | null;
          if (!termed || termed.workspace_id !== session.workspace_id) {
            throw new CollabError("proposal_not_found", "about_proposal_id must name a proposal in this workspace");
          }
        }
        posted.push(this.appendReportInternal(session, {
          ...normalized,
          ...(report.about_proposal_id ? { about_proposal_id: report.about_proposal_id } : {}),
          note: NOTE_FORMAT,
        }));
      }
      return { reports: posted, cite: cited };
    }, input.receipt_plan ? { receipt_plan: input.receipt_plan } : {});
  }

  private appendNoteCite(session: CoordinationSessionRow, cite: NormalizedNoteCite): NoteCiteReceipt {
    // A server-hashed file is only meaningful against the worktree it was
    // read in, so the cite names the citing session's own worktree.
    const hasFiles = cite.items.some((item) => item.kind === "file");
    if (hasFiles && cite.worktree_id !== session.worktree_id) {
      throw new CollabError("cite_worktree_mismatch", "File evidence is cited against the citing session's own worktree");
    }
    const citeId = `cite_${randomUUID()}`;
    const payload = {
      cite_id: citeId,
      by_session_id: session.id,
      ...(hasFiles ? { worktree_id: session.worktree_id } : {}),
      items: cite.items,
    };
    assertNotePayload(payload);
    const event = this.appendEvent(session.workspace_id, "evidence.cited", citeId, session.actor, payload, session.id);
    return {
      cite_id: citeId,
      event_id: event.id,
      sequence: event.sequence,
      worktree_id: hasFiles ? session.worktree_id : null,
      items: cite.items,
    };
  }

  /**
   * What a note's target is, for the verbs to map an act onto storage and to
   * give advice (spec 5.3). Read-only, one snapshot.
   */
  noteTarget(workspaceId: string, reportId: string): NoteTargetView {
    return this.db.transaction(() => {
      const report = this.requireReport(validateId(reportId, "report_id"));
      if (report.workspace_id !== workspaceId) {
        throw new CollabError("report_not_found", `Report '${reportId}' was not found in this workspace`);
      }
      const obsoleted = this.activeObsoletionTargets(workspaceId);
      const termed = this.db.query(`SELECT 1 FROM proposal_terms WHERE report_id = ?`).get(report.id) !== null;
      // A poll report is a ballot when note_ballots names it (rebuilt from
      // ballot.opened on every open); whether it still takes casts is read
      // from the journal, so a withdrawal or an all-cast close counts.
      let ballot: NoteTargetView["ballot"] = null;
      if (this.db.query(`SELECT 1 FROM note_ballots WHERE workspace_id = ? AND ballot_id = ?`).get(workspaceId, report.id) !== null) {
        ballot = { open: this.readBallotFacts(workspaceId, report.id)?.state === "open" };
      }
      let completion: NoteTargetView["completion_of"] = null;
      if (report.task_id) {
        const event = this.db.query(`
          SELECT payload_json FROM events
          WHERE workspace_id = ? AND sequence > ? AND entity_id = ?
            AND type IN ('task.reported_complete', 'task.completed')
          ORDER BY sequence LIMIT 1
        `).get(workspaceId, report.event_sequence, report.task_id) as { payload_json: string } | null;
        const completed = event
          && (JSON.parse(event.payload_json) as Record<string, unknown>).completion_report_id === report.id;
        if (completed) {
          const task = this.requireTaskRow(workspaceId, report.task_id);
          const current = task.completion_report_id === report.id;
          completion = {
            task_id: task.id,
            current,
            pending_review: current && task.status === "completed" && task.review_status === "pending",
          };
        }
      }
      const authorRow = report.from_session_id
        ? this.db.query(`SELECT * FROM coordination_sessions WHERE id = ?`).get(report.from_session_id) as CoordinationSessionRow | null
        : null;
      return {
        report,
        termed,
        ballot,
        obsoleted: obsoleted.has(report.id),
        completion_of: completion,
        challenges: this.noteChallenges(workspaceId).filter((challenge) => challenge.target_report_id === report.id),
        author: authorRow
          ? {
            id: authorRow.id,
            actor: authorRow.actor,
            status: authorRow.status,
            liveness: sessionLiveness(authorRow, this.timestamp()),
            last_seen_at: authorRow.last_seen_at,
            voice_id: this.consentVoice(authorRow.id),
          }
          : null,
      };
    }).deferred();
  }

  /** The reports among `ids` that a withdraw, correct or supersede has retired. Read-only. */
  noteObsoleted(workspaceId: string, ids: string[]): string[] {
    const obsoleted = this.activeObsoletionTargets(workspaceId);
    return ids.filter((id) => obsoleted.has(id));
  }

  /**
   * Whether a report still stands (spec 5, "still current"): not withdrawn,
   * corrected or superseded, and for a challenge, not lifted by any active
   * resolve. A derived-key retry replays only while this holds, so an
   * objection lifted and then raised again in the same words is written
   * again. Any active resolve counts, because the store's acceptance check
   * already treats a completion's challenge as lifted by one. Read-only.
   */
  noteReportStands(workspaceId: string, reportId: string): boolean {
    return this.db.transaction(() => {
      const report = this.requireReport(validateId(reportId, "report_id"));
      if (report.workspace_id !== workspaceId) return false;
      if (this.activeObsoletionTargets(workspaceId).has(report.id)) return false;
      return report.relation !== "challenges"
        || !this.hasActiveReportRelation(workspaceId, report.id, new Set(["resolves"]));
    }).deferred();
  }

  /**
   * The reserved work these paths would overlap (spec 5.4), every conflict
   * rather than the first one the claim refusal names. Read-only.
   */
  notePathConflicts(
    workspaceId: string,
    paths: string[],
    options: { work_mode?: TaskWorkMode; except_task_id?: string } = {},
  ): TaskConflict["conflicts"] {
    this.requireWorkspace(workspaceId);
    return this.taskPathConflicts({
      workspace_id: workspaceId,
      id: options.except_task_id ?? "",
      path_scopes: normalizePathScopes(paths),
      work_mode: options.work_mode ?? "edit",
    } as Task);
  }

  /**
   * The cheap refusals completeTaskForSession would make for this caller,
   * task, journal evidence and requested reviewer, thrown with the same
   * codes and messages. collab_done finished calls it before its first
   * write (an artifact), so a completion the store would refuse leaves
   * nothing behind. Read-only; the completion checks all of it again in its
   * own transaction, so this decides nothing on its own.
   */
  noteCompletePrecheck(
    credential: { session_id: string; session_token: string; generation: number },
    input: { task_id: string; evidence_refs: string[]; review_requested_session_id?: string | null },
  ): void {
    this.db.transaction(() => {
      const session = this.authenticateSession(credential);
      const row = this.requireTaskRow(session.workspace_id, validateId(input.task_id, "task_id"));
      for (const reference of normalizeEvidenceRefs(input.evidence_refs)) {
        this.requireEvidenceRef(row.workspace_id, reference);
      }
      if (input.review_requested_session_id) {
        this.requireRequestedReviewer(
          row,
          session,
          validateId(input.review_requested_session_id, "review_requested_session_id"),
        );
      }
    }).deferred();
  }

  /**
   * The cheap refusals reviewTaskForSession would make, in its order and
   * with its codes and messages: nothing pending, self-review, journal
   * evidence that does not exist, and for an accept a withdrawn or
   * challenged completion. A verdict calls it before citing its evidence,
   * so a review the store would refuse leaves no orphan cite. The git
   * checkpoint checks are left to the review itself. Read-only.
   */
  noteReviewPrecheck(
    credential: { session_id: string; session_token: string; generation: number },
    input: { task_id: string; outcome: "accept" | "request_changes"; evidence_refs: string[] },
  ): void {
    this.db.transaction(() => {
      const session = this.authenticateSession(credential);
      const row = this.requireTaskRow(session.workspace_id, validateId(input.task_id, "task_id"));
      if (row.completion_policy !== "accepted" || row.review_status !== "pending") {
        throw this.taskNotPendingReviewError(row, session.id);
      }
      if (!row.reported_by_session_id || !row.completion_report_id) {
        throw new CollabError("review_state_invalid", "Task completion review metadata is incomplete");
      }
      if (row.reported_by_session_id === session.id) {
        throw new CollabError("self_review_forbidden", "A distinct session must review reported completion");
      }
      for (const reference of normalizeEvidenceRefs(input.evidence_refs)) {
        this.requireEvidenceRef(row.workspace_id, reference);
      }
      if (input.outcome !== "accept") return;
      if (this.hasObsoletedCompletionReport(row.workspace_id, row.completion_report_id)) {
        throw new CollabError(
          "completion_report_obsolete",
          "The reported completion was withdrawn, corrected, or superseded; request changes before a new completion report",
          { completion_report_id: row.completion_report_id },
        );
      }
      if (this.hasUnresolvedChallenges(row.workspace_id, row.completion_report_id)) {
        throw new CollabError(
          "completion_challenged",
          "Reported completion has an unresolved challenge",
          { completion_report_id: row.completion_report_id },
        );
      }
    }).deferred();
  }

  /** The root a registered worktree was last seen at, or null when this device has no such worktree. Read-only. */
  noteWorktreeRoot(worktreeId: string): string | null {
    const row = this.db.query(`SELECT root_path FROM worktrees WHERE id = ?`).get(worktreeId) as { root_path: string } | null;
    return row?.root_path ?? null;
  }

  /**
   * This session's most recent derived key with the given base, whatever its
   * entity (spec 5): how collab_done finds its own retry once the task it
   * finished is no longer held. Read-only.
   */
  latestReceiptKeyForBase(
    credential: { session_id: string; session_token: string; generation: number },
    base: string,
  ): string | null {
    const session = this.authenticateSession(credential);
    if (!/^[A-Z2-7]{20}$/.test(base)) throw new CollabError("invalid_receipt_base", "A derived key base is 20 base32 characters");
    // LIKE ignores case, so each candidate is checked exactly after the scan.
    const exact = new RegExp(`^n1:[A-Z2-7]{8}:\\d{6}:${base}(?::\\d{2})?$`);
    const rows = this.db.query(`
      SELECT idempotency_key FROM mutations
      WHERE workspace_id = ? AND actor = ? AND idempotency_key LIKE ?
      ORDER BY rowid DESC LIMIT 20
    `).all(session.workspace_id, `session:${session.id}`, `n1:________:______:${base}%`) as Array<{ idempotency_key: string }>;
    return rows.find((row) => exact.test(row.idempotency_key))?.idempotency_key ?? null;
  }

  /**
   * One of this session's receipts by its exact key, without comparing the
   * request. A derived-key retry replays what was recorded even when a fresh
   * read would build a different request (spec 5, derived idempotency), so a
   * changed version cannot turn a retry into idempotency_conflict. Read-only.
   */
  readReceiptByKey<T = unknown>(
    credential: { session_id: string; session_token: string; generation: number },
    key: string,
  ): { found: false } | { found: true; operation: string; value: T } {
    const session = this.authenticateSession(credential);
    const idempotencyKey = validateIdempotencyKey(key);
    const row = this.db.query(`
      SELECT operation, response_json FROM mutations
      WHERE workspace_id = ? AND actor = ? AND idempotency_key = ?
    `).get(session.workspace_id, `session:${session.id}`, idempotencyKey) as
      { operation: string; response_json: string } | null;
    if (!row) return { found: false };
    return { found: true, operation: row.operation, value: JSON.parse(row.response_json) as T };
  }

  /**
   * Create this session's read mark at `sequence` unless it already has one
   * (spec 8.1). collab_arrive starts a new session's mark at the journal head
   * it joined at. View state only: no event, and the legacy cursor is untouched.
   */
  initNoteMark(
    credential: { session_id: string; session_token: string; generation: number },
    sequence: number,
  ): number {
    const marked = this.db.transaction(() => {
      const session = this.authenticateSession(credential);
      const workspace = this.requireWorkspace(session.workspace_id);
      if (!Number.isInteger(sequence) || sequence < 0 || sequence > workspace.event_head_sequence) {
        throw new CollabError("invalid_note_mark", "A read mark must name a sequence in this journal");
      }
      this.db.query(`
        INSERT OR IGNORE INTO note_marks (workspace_id, session_id, shown_through_sequence, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(session.workspace_id, session.id, sequence, this.timestamp());
      return this.noteMarkRow(session.workspace_id, session.id)!;
    }).immediate();
    this.tightenFileModes();
    return marked;
  }

  /** This session's read mark, or null when it has none yet. Read-only. */
  noteMark(workspaceId: string, sessionId: string): number | null {
    return this.noteMarkRow(workspaceId, validateId(sessionId, "session_id"));
  }

  /**
   * What collab_inbox lists for one session (spec 5.2), after one IMMEDIATE
   * housekeeping transaction (clock work, last-seen, the read mark and the
   * delivery records) and then a deferred read of what it returns. With
   * `peek`, nothing is written: no housekeeping, no mark, no delivery
   * record (collab_arrive on a slot that is already bound).
   */
  inboxForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    limit: number;
    include: "for_me" | "all";
    peek?: boolean;
  }): NoteInboxData {
    const limit = input.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > NOTE_INBOX_MAX_LIMIT) {
      throw new CollabError("invalid_limit", `limit must be an integer from 1 to ${NOTE_INBOX_MAX_LIMIT}`);
    }
    if (input.include !== "for_me" && input.include !== "all") {
      throw new CollabError("invalid_include", "include must be for_me or all");
    }
    const plan = (session: CoordinationSessionRow, mark: NoteMarkState, record: boolean) => {
      const scan = this.scanNoteEvents(session, mark.sequence);
      // With include: "all", one line per thing; every item for this session stays.
      const shaped = input.include === "all"
        ? noteLines(scan.events.filter((event) => !event.own), true)
        : { lines: scan.events.filter((event) => event.for_me), dropped: [] };
      const listed = shaped.lines;
      let through = scan.last_sequence;
      let more = scan.capped;
      if (listed.length > limit) {
        // Stop just before the first listed item not returned, so the next
        // call starts with it; every unaddressed event before it is passed.
        through = listed[limit]!.sequence - 1;
        more = true;
      }
      const returned = listed.slice(0, limit);
      const alsoNew = scan.events.filter((event) =>
        !event.own && !event.for_me && event.sequence <= through).length;
      let waiting: NoteWaitingEntry[] | null = null;
      if (record) {
        const now = this.timestamp();
        if (through > mark.sequence) {
          this.db.query(`
            UPDATE note_marks SET shown_through_sequence = ?, updated_at = ?
            WHERE workspace_id = ? AND session_id = ?
          `).run(through, now, session.workspace_id, session.id);
        }
        // What waits is returned whatever the mark, so its questions are
        // delivered too; computing it here records exactly what is returned.
        waiting = this.noteWaiting(session);
        this.recordNoteShown(session, [
          ...returned.filter((event) => event.for_me).map((event) => event.shown_item_id),
          ...noteWaitingShownItems(waiting),
        ], now);
      }
      return {
        sequences: returned.map((event) => event.sequence),
        through,
        more,
        also_new: alsoNew,
        not_listed: input.include === "all" ? notListed(shaped.dropped, through) : null,
        for_me_total: scan.events.filter((event) => event.for_me).length,
        for_me_total_capped: scan.capped,
        waiting,
      };
    };
    let reveal: NoteRevealOutcome = { revealed: [], pending: [] };
    const planned = input.peek
      ? this.db.transaction(() => {
        const session = this.authenticateSession(input);
        const mark = this.readNoteMarkState(session);
        return { mark, ...plan(session, mark, false) };
      }).deferred()
      : (() => {
        const housekept = this.noteHousekeeping(input, (session, mark) => ({ mark, ...plan(session, mark, true) }));
        reveal = housekept.reveal;
        return housekept.result;
      })();
    return afterHousekeeping(!input.peek, () => this.db.transaction(() => {
      const session = this.authenticateSession(input);
      const sessions = this.noteSessionViews(session.workspace_id);
      const me = sessions.find((view) => view.id === session.id)!;
      const workspace = this.requireWorkspace(session.workspace_id);
      const folds = this.noteBallotFolds(session);
      return {
        session: me,
        sessions,
        entries: planned.sequences.map((sequence) => this.noteEntryAt(session, sequence, folds)),
        also_new: planned.also_new,
        ...(planned.not_listed ? { not_listed: planned.not_listed } : {}),
        more: planned.more,
        for_me_total: planned.for_me_total,
        for_me_total_capped: planned.for_me_total_capped,
        mark: {
          before: planned.mark.sequence,
          through: planned.through,
          anchor: this.anchorAt(workspace, planned.through),
          initialised_from: planned.mark.initialised_from,
          clamped: planned.mark.clamped,
          written: !input.peek,
        },
        head_sequence: workspace.event_head_sequence,
        waiting: planned.waiting ?? this.noteWaiting(session),
        reveal_pending: reveal.pending,
        observed_at: this.timestamp(),
      };
    }).deferred());
  }

  /**
   * A look-back (collab_inbox {since}): what an inbox pass would list after
   * `since` instead of after the read mark, oldest first, in one deferred
   * read snapshot. Nothing is written: no housekeeping (so no reveal and no
   * last-seen), no mark (`mark` is the session's mark as it stands), no
   * delivery record. A recorded delivery therefore under-claims what was
   * read, which is the safe direction. Folding holds exactly as in a pass.
   * An item addressed to an ended session that carried this session's name
   * is listed with the items for this session, flagged `for_name`.
   */
  inboxLookBackForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    since: number;
    limit: number;
    include: "for_me" | "all";
  }): NoteInboxData {
    const limit = input.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > NOTE_INBOX_MAX_LIMIT) {
      throw new CollabError("invalid_limit", `limit must be an integer from 1 to ${NOTE_INBOX_MAX_LIMIT}`);
    }
    if (input.include !== "for_me" && input.include !== "all") {
      throw new CollabError("invalid_include", "include must be for_me or all");
    }
    if (!Number.isSafeInteger(input.since) || input.since < 0) {
      throw new CollabError("invalid_since", "since must be a whole number, 0 or more");
    }
    return this.db.transaction(() => {
      const session = this.authenticateSession(input);
      const workspace = this.requireWorkspace(session.workspace_id);
      const mark = this.readNoteMarkState(session);
      const after = Math.min(input.since, workspace.event_head_sequence);
      const scan = this.scanNoteEvents(session, after, this.endedNamesakes(session));
      // A record, not a log: one line per thing, whichever include.
      const shaped = noteLines(scan.events.filter((event) =>
        input.include === "all" ? !event.own : event.for_me || event.for_name !== null), false);
      const listed = shaped.lines;
      let through = scan.last_sequence;
      let more = scan.capped;
      if (listed.length > limit) {
        through = listed[limit]!.sequence - 1;
        more = true;
      }
      const returned = listed.slice(0, limit);
      const sessions = this.noteSessionViews(session.workspace_id);
      const folds = this.noteBallotFolds(session);
      return {
        session: sessions.find((view) => view.id === session.id)!,
        sessions,
        entries: returned.map((event) => this.noteEntryAt(session, event.sequence, folds, event.for_name)),
        also_new: scan.events.filter((event) =>
          !event.own && !event.for_me && event.for_name === null && event.sequence <= through).length,
        not_listed: notListed(shaped.dropped, through),
        more,
        for_me_total: scan.events.filter((event) => event.for_me).length,
        for_me_total_capped: scan.capped,
        mark: {
          before: mark.sequence,
          through: mark.sequence,
          anchor: this.anchorAt(workspace, mark.sequence),
          // Nothing was created or clamped: a look-back writes no mark.
          initialised_from: null,
          clamped: false,
          written: false,
        },
        head_sequence: workspace.event_head_sequence,
        waiting: this.noteWaiting(session),
        reveal_pending: [],
        observed_at: this.timestamp(),
        looked_back: { after, through },
      };
    }).deferred();
  }

  /**
   * What lies behind a session that has just arrived (collab_arrive on a new
   * session): how many events came before its session.joined, how many of
   * them other sessions wrote, and the items addressed to ended sessions that
   * carried its name, judged as a look-back judges them. Read-only. The scan
   * for those items reads at most NOTE_SCAN_MAX_EVENTS candidate events and
   * says so when it stopped there.
   */
  noteArrivalBehind(credential: { session_id: string; session_token: string; generation: number }): NoteArrivalBehind {
    return this.db.transaction(() => {
      const session = this.authenticateSession(credential);
      const joined = this.db.query(`
        SELECT sequence FROM events WHERE workspace_id = ? AND type = 'session.joined' AND entity_id = ?
      `).get(session.workspace_id, session.id) as { sequence: number } | null;
      const before = joined ? joined.sequence - 1 : 0;
      const bySessions = (this.db.query(`
        SELECT COUNT(*) AS count FROM events
        WHERE workspace_id = ? AND sequence <= ? AND session_id IS NOT NULL AND session_id <> ?
      `).get(session.workspace_id, before, session.id) as { count: number }).count;
      const namesakes = this.endedNamesakes(session);
      let count = 0;
      let earliest: number | null = null;
      let capped = false;
      if (namesakes.length > 0) {
        // Nothing can be addressed to a session before it joined.
        const from = (this.db.query(`
          SELECT MIN(sequence) AS sequence FROM events
          WHERE workspace_id = ? AND type = 'session.joined' AND entity_id IN (${namesakes.map(() => "?").join(", ")})
        `).get(session.workspace_id, ...namesakes) as { sequence: number | null }).sequence ?? 0;
        const rows = this.db.query(`
          SELECT protocol, workspace_id, epoch_id, sequence, id, type, entity_id, actor,
            session_id, occurred_at, payload_json, prev_hash, hash
          FROM events WHERE workspace_id = ? AND sequence > ?
            AND (session_id IS NULL OR session_id <> ?)
            AND type IN (${NOTE_ADDRESSING_EVENT_TYPES.map(() => "?").join(", ")})
          ORDER BY sequence LIMIT ?
        `).all(session.workspace_id, from, session.id, ...NOTE_ADDRESSING_EVENT_TYPES, NOTE_SCAN_MAX_EVENTS + 1) as EventRow[];
        capped = rows.length > NOTE_SCAN_MAX_EVENTS;
        // Counted as a look-back lists them: one line per thing.
        const things = new Set<string>();
        for (const row of rows.slice(0, NOTE_SCAN_MAX_EVENTS)) {
          const event = eventFromRow(row);
          if (this.eventAddressesSession(event, session.id)) continue;
          if (this.namesakeAddressed(event, namesakes) === null) continue;
          const thing = noteThingOf(event);
          if (thing !== null) {
            if (things.has(thing)) continue;
            things.add(thing);
          }
          count += 1;
          earliest ??= event.sequence;
        }
      }
      return {
        joined_sequence: joined?.sequence ?? null,
        events_before: before,
        by_other_sessions_before: bySessions,
        for_name: { count, earliest_sequence: earliest, at_least: capped, sessions: namesakes.length },
      };
    }).deferred();
  }

  /**
   * The open ballots a waiting session would be woken by when they close:
   * those whose electorate lists its unit, that it opened, or that it cast
   * in. Read-only.
   */
  noteBallotsToWatch(credential: { session_id: string; session_token: string; generation: number }): Array<{ ballot_id: string; closes_at: string }> {
    return this.db.transaction(() => {
      const session = this.authenticateSession(credential);
      return this.noteOpenBallots(session)
        .filter((ballot) => ballot.state === "open")
        .filter((ballot) => ballot.viewer?.in_electorate === true || ballot.opener_session_id === session.id
          || (ballot.viewer?.your_casts ?? 0) > 0)
        .map((ballot) => ({ ballot_id: ballot.ballot_id, closes_at: ballot.terms.closes_at }));
    }).deferred();
  }

  /** A ballot's state at the store's clock (open, withdrawn, closed or revealed), or null when no ballot has that id. Read-only. */
  noteBallotState(workspaceId: string, ballotId: string): NoteBallotFacts["state"] | null {
    return this.db.transaction(() => this.readBallotFacts(workspaceId, validateId(ballotId, "ballot_id"))?.state ?? null).deferred();
  }

  /** A ballot's ballot.closed event as an inbox entry for this session, or null before its reveal. Read-only. */
  noteBallotClosedEntry(
    credential: { session_id: string; session_token: string; generation: number },
    ballotId: string,
  ): NoteEntry | null {
    return this.db.transaction(() => {
      const session = this.authenticateSession(credential);
      const row = this.db.query(`
        SELECT sequence FROM events WHERE workspace_id = ? AND type = 'ballot.closed' AND entity_id = ?
        ORDER BY sequence LIMIT 1
      `).get(session.workspace_id, validateId(ballotId, "ballot_id")) as { sequence: number } | null;
      return row ? this.noteEntryAt(session, row.sequence, this.noteBallotFolds(session)) : null;
    }).deferred();
  }

  /**
   * One thread for collab_inbox {about} (spec 5.2): a report and everything
   * that answers it, or a task with its holder, completion and reviews. The
   * housekeeping transaction runs first and records the root (and a task's
   * current completion) as returned to this session; the read mark does not
   * move, though a first call creates it from the legacy cursor, as any
   * first inbox call does, and says so.
   */
  noteThreadForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    kind: "report" | "task";
    id: string;
  }): NoteThreadData {
    const id = validateId(input.id, `${input.kind}_id`);
    const { result: markState, reveal } = this.noteHousekeeping(input, (session, mark) => {
      const now = this.timestamp();
      if (input.kind === "task") {
        const task = this.requireTaskRow(session.workspace_id, id);
        if (task.completion_report_id) this.recordNoteShown(session, [task.completion_report_id], now);
      } else {
        const report = this.requireReport(id);
        if (report.workspace_id !== session.workspace_id) {
          throw new CollabError("report_not_found", `Report '${id}' was not found in this workspace`);
        }
        this.recordNoteShown(session, [report.id], now);
      }
      return { initialised_from: mark.initialised_from, clamped: mark.clamped };
    });
    return afterHousekeeping(true, () => this.db.transaction(() => {
      const session = this.authenticateSession(input);
      const sessions = this.noteSessionViews(session.workspace_id);
      const me = sessions.find((view) => view.id === session.id)!;
      const challenges = this.noteChallenges(session.workspace_id);
      if (input.kind === "task") {
        const task = this.requireTask(session.workspace_id, id);
        const reviews = (this.db.query(`
          SELECT * FROM task_reviews WHERE workspace_id = ? AND task_id = ?
          ORDER BY event_sequence
        `).all(session.workspace_id, id) as ReviewRow[]).map(reviewFromRow);
        const reports = this.db.query(`
          SELECT * FROM reports WHERE workspace_id = ? AND task_id = ?
          ORDER BY event_sequence LIMIT ?
        `).all(session.workspace_id, id, NOTE_THREAD_MAX + 1) as ReportRow[];
        return {
          kind: "task" as const,
          session: me,
          sessions,
          root: null,
          answers: reports.slice(0, NOTE_THREAD_MAX)
            .map((row) => this.noteEntryAt(session, row.event_sequence)),
          truncated: reports.length > NOTE_THREAD_MAX,
          task,
          reviews,
          challenges: challenges.filter((challenge) => reports.some((row) => row.id === challenge.target_report_id)),
          termed: false,
          proposal: null,
          decision: null,
          ballot: null,
          folded: 0,
          mark: markState,
          reveal_pending: reveal.pending,
          observed_at: this.timestamp(),
        };
      }
      const root = this.requireReport(id);
      // Everything that answers the root: relations aimed at it or at an
      // answer (breadth first), and notes citing it as evidence.
      const answers = new Map<string, number>();
      let frontier = [root.id];
      let truncated = false;
      while (frontier.length > 0 && !truncated) {
        const next: string[] = [];
        for (const target of frontier) {
          const rows = this.db.query(`
            SELECT id, event_sequence FROM reports WHERE target_report_id = ? AND workspace_id = ?
            ORDER BY event_sequence
          `).all(target, root.workspace_id) as Array<{ id: string; event_sequence: number }>;
          for (const row of rows) {
            if (answers.has(row.id) || row.id === root.id) continue;
            if (answers.size >= NOTE_THREAD_MAX) {
              truncated = true;
              break;
            }
            answers.set(row.id, row.event_sequence);
            next.push(row.id);
          }
          if (truncated) break;
        }
        frontier = next;
      }
      const citing = this.db.query(`
        SELECT r.id, r.event_sequence FROM reports r, json_each(r.evidence_refs_json) ref
        WHERE r.workspace_id = ? AND ref.value = ?
        ORDER BY r.event_sequence
      `).all(root.workspace_id, `report:${root.id}`) as Array<{ id: string; event_sequence: number }>;
      for (const row of citing) {
        if (answers.has(row.id) || row.id === root.id) continue;
        if (answers.size >= NOTE_THREAD_MAX) {
          truncated = true;
          break;
        }
        answers.set(row.id, row.event_sequence);
      }
      const ids = new Set([root.id, ...answers.keys()]);
      const termed = this.db.query(`SELECT 1 FROM proposal_terms WHERE report_id = ?`).get(root.id) !== null;
      const ballotFacts = this.readBallotFacts(root.workspace_id, root.id);
      const ballot = ballotFacts ? this.ballotData(ballotFacts, session.id) : null;
      // A ballot's own thread folds for an elector whose unit has not cast;
      // a note inside it, asked for by its id, is shown whole (spec 5.2).
      const folds = ballot ? this.noteBallotFolds(session) : new Map<string, string>();
      const answerEntries = [...answers.values()].sort((left, right) => left - right)
        .map((sequence) => this.noteEntryAt(session, sequence, folds));
      // The computed views come from this same snapshot, so the position
      // shown is the one consent/v1 computes for the answers listed.
      return {
        kind: "report" as const,
        session: me,
        sessions,
        root: this.noteEntryAt(session, root.event_sequence),
        answers: answerEntries,
        truncated,
        task: null,
        reviews: [],
        challenges: challenges.filter((challenge) => ids.has(challenge.target_report_id)),
        termed,
        proposal: termed ? this.noteProposalData(root.workspace_id, root.id, sessions) : null,
        decision: !termed && root.kind === "decision" ? this.noteDecisionData(root.workspace_id, root, sessions) : null,
        ballot,
        folded: answerEntries.filter((entry) => entry.folded !== null).length,
        mark: markState,
        reveal_pending: reveal.pending,
        observed_at: this.timestamp(),
      };
    }).deferred());
  }

  /**
   * What the arrival brief shows (spec 5.1), in one deferred read snapshot.
   * Read-only: it writes nothing, not even last-seen.
   */
  arrivalBrief(credential: { session_id: string; session_token: string; generation: number }): NoteArrivalData {
    return this.db.transaction(() => {
      const session = this.authenticateSession(credential);
      const workspace = this.requireWorkspace(session.workspace_id);
      const sessions = this.noteSessionViews(session.workspace_id);
      const tasks = this.listTasks(session.workspace_id);
      const { claimable } = this.projectAvailableTasks(session.workspace_id, tasks, () => false);
      // Every proposal that can still be open, challenged or consented, not
      // the newest few: the totals are true counts. A retired proposal is
      // withdrawn or superseded, and a closed one with no support at all can
      // only be split or lapsed, so neither needs its status computed.
      const now = Date.parse(this.timestamp());
      const proposals = this.noteProposalStatuses(session.workspace_id, this.noteProposalRows(session.workspace_id)
        .filter((row) => !row.retired && (now < Date.parse(row.closes_at) || row.supported)))
        .filter((status) => ["open", "challenged", "consented"].includes(status.ai.position));
      const reports = (this.db.query(`SELECT COUNT(*) AS count FROM reports WHERE workspace_id = ?`)
        .get(session.workspace_id) as { count: number }).count;
      return {
        session: sessions.find((view) => view.id === session.id)!,
        workspace,
        sessions,
        tasks,
        claimable_task_ids: claimable.map((task) => task.id),
        proposals,
        challenges: this.noteChallenges(session.workspace_id).filter((challenge) => challenge.standing).reverse(),
        report_count: reports,
        waiting: this.noteWaiting(session),
        // Open ballots only: one withdrawn or closed takes no cast.
        ballots: this.noteOpenBallots(session).filter((ballot) => ballot.state === "open"),
        observed_at: this.timestamp(),
      };
    }).deferred();
  }

  /**
   * Every proposal of a workspace as one cheap row, newest first, so a notes
   * view can choose whose status to compute instead of reading a capped
   * listing. `retired` matches proposalRetirement and `acted` any person act.
   */
  private noteProposalRows(workspaceId: string): NoteProposalRow[] {
    const rows = this.db.query(`
      SELECT t.report_id, r.from_session_id, t.closes_at, t.voices_json,
        EXISTS (SELECT 1 FROM reports x WHERE x.workspace_id = t.workspace_id AND x.target_report_id = t.report_id
          AND x.relation IN ('withdraws', 'corrects', 'supersedes')) AS retired,
        EXISTS (SELECT 1 FROM reports x WHERE x.workspace_id = t.workspace_id AND x.target_report_id = t.report_id
          AND x.relation = 'supports') AS supported,
        EXISTS (SELECT 1 FROM proposal_person_acts a WHERE a.proposal_report_id = t.report_id) AS acted
      FROM proposal_terms t JOIN reports r ON r.id = t.report_id
      WHERE t.workspace_id = ?
      ORDER BY r.event_sequence DESC
    `).all(workspaceId) as Array<{
      report_id: string; from_session_id: string | null; closes_at: string; voices_json: string;
      retired: number; supported: number; acted: number;
    }>;
    return rows.map((row) => ({
      report_id: row.report_id,
      from_session_id: row.from_session_id,
      closes_at: row.closes_at,
      voice_ids: (JSON.parse(row.voices_json) as ProposalVoice[]).map((voice) => voice.voice_id),
      retired: row.retired === 1,
      supported: row.supported === 1,
      acted: row.acted === 1,
    }));
  }

  /** The status of each listed proposal, in the order given, sharing one read context. Unreadable terms are skipped, as listProposalStatuses skips them. */
  private noteProposalStatuses(workspaceId: string, rows: NoteProposalRow[]): ProposalStatus[] {
    const context = this.proposalReadContext(workspaceId);
    const unreadable: UnreadableProposal[] = [];
    return rows
      .map((row) => this.readProposalStatus(context, row.report_id, unreadable))
      .filter((status): status is ProposalStatus => status !== null);
  }

  /** Record that arrive or inbox returned these items to a session (spec 8.1 note_shown). */
  recordArrivalShown(
    credential: { session_id: string; session_token: string; generation: number },
    itemIds: string[],
  ): void {
    if (itemIds.length === 0) return;
    this.db.transaction(() => {
      const session = this.authenticateSession(credential);
      this.recordNoteShown(session, itemIds, this.timestamp());
    }).immediate();
    this.tightenFileModes();
  }

  /** Whether this notes surface has recorded returning an item to a session. Read-only view state. */
  noteShownAt(workspaceId: string, sessionId: string, itemId: string): string | null {
    const row = this.db.query(`
      SELECT shown_at FROM note_shown WHERE workspace_id = ? AND session_id = ? AND item_id = ?
    `).get(workspaceId, sessionId, itemId) as { shown_at: string } | null;
    return row?.shown_at ?? null;
  }

  /**
   * Resolve an id, a `kind:<id>` reference or a short handle (`report#3fa91c`)
   * to one full id (spec 5, handles). A handle is matched by primary-key
   * range, never by LIKE; an ambiguous one is refused with the candidates, so
   * nothing is routed by guess. Read-only.
   */
  resolveNoteRef(workspaceId: string, kind: NoteEntityKind, value: string): { kind: NoteEntityKind; id: string } {
    this.requireWorkspace(workspaceId);
    const text = typeof value === "string" ? value.trim() : "";
    const handle = /^(report|proposal|ballot|task)#([0-9a-fA-F]{6,32})$/.exec(text);
    const prefixed = /^(report|proposal|ballot|task):(.+)$/.exec(text);
    const named = (handle?.[1] ?? prefixed?.[1]) as NoteEntityKind | undefined;
    // Proposals and ballots are reports, so either may stand where a report
    // is asked for, and a report ref may name a proposal or a ballot.
    const compatible = !named || named === kind
      || (kind === "report" && named !== "task")
      || ((kind === "proposal" || kind === "ballot") && named === "report");
    if (!compatible) {
      throw new CollabError("ref_kind_mismatch", `${text} names a ${named}, not a ${kind}`, { expected: kind, value: text });
    }
    // Match the narrower kind: proposal#… looks only among proposals.
    kind = kind === "report" && named ? named : kind;
    const exists = (id: string) => this.noteRefCandidates(workspaceId, kind, id, `${id}\u0000`).length === 1;
    if (!handle) {
      const id = validateId(prefixed?.[2] ?? text, `${kind}_id`);
      if (!exists(id)) {
        throw new CollabError(`${kind}_not_found`, `No ${kind} with id ${id} in this workspace`, { value: text });
      }
      return { kind, id };
    }
    const hex = handle[2]!.toLowerCase();
    const table = kind === "task" ? "task" : "report";
    const lower = `${table}_${uuidPrefix(hex)}`;
    const upper = `${lower.slice(0, -1)}${String.fromCharCode(lower.charCodeAt(lower.length - 1) + 1)}`;
    const candidates = this.noteRefCandidates(workspaceId, kind, lower, upper);
    if (candidates.length === 0) {
      throw new CollabError(`${kind}_not_found`, `No ${kind} matches ${text} in this workspace`, { value: text });
    }
    if (candidates.length > 1) {
      throw new CollabError("ambiguous_handle", `${text} matches more than one ${kind}; use a longer handle or the full id`, {
        value: text,
        candidates: candidates.slice(0, 10),
        candidates_total: candidates.length,
      });
    }
    return { kind, id: candidates[0]! };
  }

  private noteRefCandidates(workspaceId: string, kind: NoteEntityKind, lower: string, upper: string): string[] {
    const limit = 50;
    switch (kind) {
      case "task":
        return (this.db.query(`
          SELECT id FROM tasks WHERE workspace_id = ? AND id >= ? AND id < ? ORDER BY id LIMIT ?
        `).all(workspaceId, lower, upper, limit) as Array<{ id: string }>).map((row) => row.id);
      case "proposal":
        return (this.db.query(`
          SELECT r.id FROM reports r JOIN proposal_terms t ON t.report_id = r.id
          WHERE r.workspace_id = ? AND r.id >= ? AND r.id < ? ORDER BY r.id LIMIT ?
        `).all(workspaceId, lower, upper, limit) as Array<{ id: string }>).map((row) => row.id);
      case "ballot":
        // A ballot is the report collab_poll posts, opened by a ballot.opened event (spec 8.2).
        return (this.db.query(`
          SELECT r.id FROM reports r
          WHERE r.workspace_id = ? AND r.id >= ? AND r.id < ?
            AND EXISTS (SELECT 1 FROM events e WHERE e.workspace_id = r.workspace_id
              AND e.type = 'ballot.opened' AND e.entity_id = r.id)
          ORDER BY r.id LIMIT ?
        `).all(workspaceId, lower, upper, limit) as Array<{ id: string }>).map((row) => row.id);
      default:
        return (this.db.query(`
          SELECT id FROM reports WHERE workspace_id = ? AND id >= ? AND id < ? ORDER BY id LIMIT ?
        `).all(workspaceId, lower, upper, limit) as Array<{ id: string }>).map((row) => row.id);
    }
  }

  /**
   * Resolve a session by id, `session#<hex>` handle or display name among a
   * workspace's sessions (active ones only unless `include_ended`). An
   * ambiguous name is refused with the candidates. Read-only.
   */
  resolveNoteSession(workspaceId: string, value: string, options: { include_ended?: boolean } = {}): NoteSessionView {
    const text = typeof value === "string" ? value.trim() : "";
    const sessions = this.noteSessionViews(workspaceId)
      .filter((view) => options.include_ended || view.status === "active");
    const handle = /^session#([0-9a-fA-F]{6,32})$/.exec(text);
    const prefix = handle ? `session_${uuidPrefix(handle[1]!.toLowerCase())}` : null;
    const matches = sessions.filter((view) =>
      prefix ? view.id.startsWith(prefix) : view.id === text || view.actor === text);
    if (matches.length === 1) return matches[0]!;
    if (matches.length === 0) {
      throw new CollabError("session_not_found", `No ${options.include_ended ? "" : "active "}session matches ${text}`, { value: text });
    }
    throw new CollabError("ambiguous_session", `${text} names more than one session; use its id`, {
      value: text,
      candidates: matches.slice(0, 10).map((view) => ({ session: view.id, name: view.actor, last_seen_at: view.last_seen_at })),
      candidates_total: matches.length,
    });
  }

  private cachedVoice(sessionId: string, voices: Map<string, string>): string {
    const cached = voices.get(sessionId);
    if (cached) return cached;
    const voice = this.consentVoice(sessionId);
    voices.set(sessionId, voice);
    return voice;
  }

  private noteMarkRow(workspaceId: string, sessionId: string): number | null {
    const row = this.db.query(`
      SELECT shown_through_sequence FROM note_marks WHERE workspace_id = ? AND session_id = ?
    `).get(workspaceId, sessionId) as { shown_through_sequence: number } | null;
    return row?.shown_through_sequence ?? null;
  }

  /**
   * The read mark as it stands. A session with no row reads from its legacy
   * cursor, which means "processed", so a session started before this
   * surface neither replays its history nor loses what is pending. A mark
   * past the head (a journal restored from an older copy) reads as the head.
   */
  private readNoteMarkState(session: CoordinationSessionRow): NoteMarkState {
    const head = this.requireWorkspace(session.workspace_id).event_head_sequence;
    const stored = this.noteMarkRow(session.workspace_id, session.id);
    const sequence = stored ?? session.cursor_sequence;
    return {
      sequence: Math.min(sequence, head),
      initialised_from: stored === null ? "cursor" : null,
      clamped: sequence > head,
      stored: stored !== null,
    };
  }

  /**
   * The housekeeping transaction every notes read begins with (spec 5.2,
   * write placement): the session is authenticated, its lapsed leases and
   * last-seen time are recorded as collab_next records them, elapsed handoffs
   * expire as system:clock, due ballots are revealed as system:clock (each
   * in a savepoint: a failed reveal is reported, never fatal), and a missing
   * read mark is created from the legacy cursor. `apply` runs inside the same
   * IMMEDIATE transaction. Seal files are deleted only after it commits.
   */
  private noteHousekeeping<T>(
    credential: { session_id: string; session_token: string; generation: number },
    apply: (session: CoordinationSessionRow, mark: NoteMarkState) => T,
  ): { result: T; reveal: NoteRevealOutcome } {
    let reveal: NoteRevealOutcome = { revealed: [], pending: [] };
    const result = this.db.transaction(() => {
      const authenticated = this.authenticateSession(credential);
      const now = this.timestamp();
      this.recordSessionLeaseLapses(authenticated, now);
      // Nested, so it runs as a savepoint inside this one transaction.
      this.expireElapsedHandoffs(authenticated.workspace_id, "system:clock");
      reveal = this.revealBallotsInTransaction(authenticated.workspace_id);
      this.db.query(`UPDATE coordination_sessions SET last_seen_at = ? WHERE id = ?`).run(now, authenticated.id);
      const session = this.requireCoordinationSessionRow(authenticated.id);
      const mark = this.readNoteMarkState(session);
      if (!mark.stored || mark.clamped) {
        this.db.query(`
          INSERT INTO note_marks (workspace_id, session_id, shown_through_sequence, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (workspace_id, session_id) DO UPDATE SET
            shown_through_sequence = excluded.shown_through_sequence, updated_at = excluded.updated_at
        `).run(session.workspace_id, session.id, mark.sequence, now);
      }
      return apply(session, mark);
    }).immediate();
    this.cleanSeals(reveal.revealed);
    this.tightenFileModes();
    return { result, reveal };
  }

  private recordNoteShown(session: CoordinationSessionRow, itemIds: Array<string | null>, now: string): void {
    for (const itemId of new Set(itemIds)) {
      if (!itemId) continue;
      this.db.query(`
        INSERT INTO note_shown (workspace_id, session_id, item_id, shown_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (workspace_id, session_id, item_id) DO UPDATE SET shown_at = excluded.shown_at
      `).run(session.workspace_id, session.id, itemId, now);
    }
  }

  /**
   * The events after `after`, at most NOTE_SCAN_MAX_EVENTS of them or
   * NOTE_SCAN_MAX_BYTES of payload (always at least one), each judged with
   * eventAddressesSession so the inbox and the doorbell agree.
   */
  private scanNoteEvents(session: CoordinationSessionRow, after: number, namesakes: readonly string[] = []): {
    events: NoteScannedEvent[];
    last_sequence: number;
    capped: boolean;
  } {
    const sizes = this.db.query(`
      SELECT sequence, length(CAST(payload_json AS BLOB)) AS bytes FROM events
      WHERE workspace_id = ? AND sequence > ? ORDER BY sequence LIMIT ?
    `).all(session.workspace_id, after, NOTE_SCAN_MAX_EVENTS + 1) as Array<{ sequence: number; bytes: number }>;
    let end = after;
    let bytes = 0;
    let taken = 0;
    for (const size of sizes) {
      if (taken >= NOTE_SCAN_MAX_EVENTS || (taken > 0 && bytes + size.bytes > NOTE_SCAN_MAX_BYTES)) break;
      bytes += size.bytes;
      taken += 1;
      end = size.sequence;
    }
    const rows = this.db.query(`
      SELECT protocol, workspace_id, epoch_id, sequence, id, type, entity_id, actor,
        session_id, occurred_at, payload_json, prev_hash, hash
      FROM events WHERE workspace_id = ? AND sequence > ? AND sequence <= ? ORDER BY sequence
    `).all(session.workspace_id, after, end) as EventRow[];
    const events = rows.map((row) => {
      const event = eventFromRow(row);
      const own = event.session_id === session.id;
      const forMe = !own && this.eventAddressesSession(event, session.id);
      return {
        sequence: event.sequence,
        type: event.type,
        own,
        for_me: forMe,
        for_name: own || forMe ? null : this.namesakeAddressed(event, namesakes),
        thing: noteThingOf(event),
        attached: event.type === "evidence.cited" || event.type === "artifact.attached",
        shown_item_id: forMe ? noteShownItem(event) : null,
      };
    });
    return { events, last_sequence: end, capped: taken < sizes.length };
  }

  /**
   * The first of `namesakes` (ended sessions that carried the reader's name)
   * this event is addressed to, judged exactly as eventAddressesSession
   * judges it for that session; null for none. Routing by a self-declared
   * name, never identity.
   */
  private namesakeAddressed(event: CollabEvent, namesakes: readonly string[]): string | null {
    return namesakes.find((id) => event.session_id !== id && this.eventAddressesSession(event, id)) ?? null;
  }

  /**
   * Ended sessions of this session's workspace that carried its name, oldest
   * first. A name is self-declared, so this is a routing hint for reading
   * back, not a claim that they were the same agent. Read-only.
   */
  private endedNamesakes(session: CoordinationSessionRow): string[] {
    return (this.db.query(`
      SELECT id FROM coordination_sessions
      WHERE workspace_id = ? AND actor = ? AND status = 'ended' AND id <> ?
      ORDER BY joined_at, id
    `).all(session.workspace_id, session.actor, session.id) as Array<{ id: string }>).map((row) => row.id);
  }

  private anchorAt(workspace: Workspace, sequence: number): EventCursor {
    if (sequence === 0) return { epoch_id: workspace.epoch_id, sequence: 0, hash: GENESIS_HASH };
    const row = this.db.query(`SELECT epoch_id, hash FROM events WHERE workspace_id = ? AND sequence = ?`)
      .get(workspace.id, sequence) as { epoch_id: string; hash: string } | null;
    if (!row) throw new CollabError("cursor_mismatch", "The read mark does not resolve to an event in this journal");
    return { epoch_id: row.epoch_id, sequence, hash: row.hash };
  }

  /** One event as an inbox entry, with the report, proposal or task it concerns. */
  private noteEntryAt(
    session: CoordinationSessionRow,
    sequence: number,
    folds?: ReadonlyMap<string, string>,
    forName: string | null = null,
  ): NoteEntry {
    const row = this.db.query(`
      SELECT protocol, workspace_id, epoch_id, sequence, id, type, entity_id, actor,
        session_id, occurred_at, payload_json, prev_hash, hash
      FROM events WHERE workspace_id = ? AND sequence = ?
    `).get(session.workspace_id, sequence) as EventRow | null;
    if (!row) throw new CollabError("event_not_found", `No event at sequence ${sequence}`);
    const event = eventFromRow(row);
    const payload = event.payload as Record<string, unknown>;
    const forMe = event.session_id !== session.id && this.eventAddressesSession(event, session.id);
    const namesake = !forMe && forName !== null ? forName : null;
    let report: CollabReport | null = null;
    if (event.type === "report.posted" || event.type.startsWith("proposal.")) {
      const reportRow = this.db.query(`SELECT * FROM reports WHERE id = ?`).get(event.entity_id) as ReportRow | null;
      report = reportRow ? reportFromRow(reportRow) : null;
    }
    const taskId = event.type.startsWith("task.") ? event.entity_id
      : event.type.startsWith("handoff.") ? (typeof payload.task_id === "string" ? payload.task_id
        : typeof (payload.handoff as Record<string, unknown> | undefined)?.task_id === "string"
          ? (payload.handoff as Record<string, string>).task_id : null)
        : report?.task_id ?? null;
    const taskRow = taskId ? this.readTaskRow(session.workspace_id, taskId) : null;
    const marked = event.type === "report.posted" && payload.note === NOTE_FORMAT;
    const cites = report ? this.noteAuthorCites(session.workspace_id, report) : [];
    // A marked note's own cite is the one its author appended in the same
    // transaction, just before the note's first report. Any other cite event
    // it names is evidence it points at, never the observation of its lines.
    const own = marked && report ? cites.find((cite) => cite.sequence === report.event_sequence - 1) ?? null : null;
    const ballotId = event.type.startsWith("ballot.") ? event.entity_id
      : event.type === "report.posted" && report
        && this.db.query(`SELECT 1 FROM note_ballots WHERE workspace_id = ? AND ballot_id = ?`).get(session.workspace_id, report.id) !== null
        ? report.id : null;
    const ballotFacts = ballotId ? this.readBallotFacts(session.workspace_id, ballotId) : null;
    const foldedBy = report && event.type === "report.posted" ? folds?.get(report.id) ?? null : null;
    return {
      event,
      for_me: forMe,
      why_you: forMe ? this.noteWhyYou(event, session.id) : namesake ? this.noteWhyYou(event, namesake) : null,
      report,
      marked,
      cited: own ? { event_id: own.event_id, by_session_id: own.by_session_id, worktree_id: own.worktree_id, items: own.items } : null,
      author_cites: cites.map(({ sequence: _sequence, ...cite }) => cite),
      termed: report !== null
        && this.db.query(`SELECT 1 FROM proposal_terms WHERE report_id = ?`).get(report.id) !== null,
      to_person: event.type === "report.posted" && payload.to_person === true,
      task: taskRow ? { id: taskRow.id, title: taskRow.title } : null,
      ballot: ballotFacts ? this.ballotData(ballotFacts, session.id) : null,
      folded: foldedBy ? { ballot_id: foldedBy } : null,
      for_name: namesake ? { session_id: namesake } : null,
      verdict: report && event.type === "report.posted" ? this.reviewVerdictOf(report) : null,
    };
  }

  /**
   * The verdict a review's report carries: the task.accepted or
   * task.changes_requested event reviewTaskForSession appends right after
   * the report, in the same transaction, naming it as review_report_id. Read
   * from the journal by sequence; a report with no such event has none.
   */
  private reviewVerdictOf(report: CollabReport): "accept" | "request_changes" | null {
    if (!report.task_id || (report.relation !== "supports" && report.relation !== "challenges")) return null;
    const next = this.db.query(`
      SELECT type, json_extract(payload_json, '$.review_report_id') AS review_report_id
      FROM events WHERE workspace_id = ? AND sequence = ?
    `).get(report.workspace_id, report.event_sequence + 1) as { type: string; review_report_id: unknown } | null;
    if (!next || next.review_report_id !== report.id) return null;
    if (next.type === "task.accepted") return "accept";
    if (next.type === "task.changes_requested") return "request_changes";
    return null;
  }

  /**
   * The evidence.cited events among a report's evidence refs that the
   * report's own author recorded, in ref order. Another session's cite is
   * its observation, not this author's, so it is left as a plain pointer.
   */
  private noteAuthorCites(workspaceId: string, report: CollabReport): Array<NonNullable<NoteEntry["cited"]> & { sequence: number }> {
    if (!report.from_session_id) return [];
    const cites: Array<NonNullable<NoteEntry["cited"]> & { sequence: number }> = [];
    for (const ref of report.evidence_refs) {
      if (!ref.startsWith("event:")) continue;
      const row = this.db.query(`
        SELECT sequence, payload_json FROM events WHERE workspace_id = ? AND id = ? AND type = 'evidence.cited'
      `).get(workspaceId, ref.slice("event:".length)) as { sequence: number; payload_json: string } | null;
      if (!row) continue;
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      if (payload.by_session_id !== report.from_session_id) continue;
      cites.push({
        event_id: ref.slice("event:".length),
        sequence: row.sequence,
        by_session_id: report.from_session_id,
        worktree_id: typeof payload.worktree_id === "string" ? payload.worktree_id : null,
        items: Array.isArray(payload.items) ? payload.items as NoteCitedItem[] : [],
      });
    }
    return cites;
  }

  /** Why an addressed event names this session, for an item's why_you. Mirrors eventAddressesSession. */
  private noteWhyYou(event: CollabEvent, sessionId: string): NoteWhyYou {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    switch (event.type) {
      case "report.posted":
        if (payload.to_session_id === sessionId) return "addressed";
        if (typeof payload.about_proposal_id === "string") return "about_your_proposal";
        return "reply_to_you";
      case "handoff.offered":
        return "handoff_offered";
      case "handoff.accepted":
      case "handoff.declined":
      case "handoff.expired":
        return "answer_to_your_handoff";
      case "task.reported_complete":
        return "review_requested";
      case "task.accepted":
      case "task.changes_requested":
        return "verdict_on_your_work";
      case "task.recovered":
        return "your_lease_recovered";
      case "proposal.opened":
        return "voice_awaited";
      case "proposal.agreed":
      case "proposal.rejected":
        return "person_act";
      case "ballot.opened":
        return "in_electorate";
      case "ballot.closed":
        return "ballot_closed";
      default:
        return "addressed";
    }
  }

  /**
   * Every challenge in a workspace with whether it still stands. As in
   * consent/v1, a challenge stands until it is withdrawn or lifted by its own
   * voice; a `resolves` from any other voice is shown as an answer and lifts
   * nothing on this view. Journal order.
   */
  private noteChallenges(workspaceId: string): NoteChallengeView[] {
    const obsoleted = this.activeObsoletionTargets(workspaceId);
    const voices = new Map<string, string>();
    const challenges = this.db.query(`
      SELECT id, from_session_id, from_actor, target_report_id, created_at FROM reports
      WHERE workspace_id = ? AND relation = 'challenges' ORDER BY event_sequence
    `).all(workspaceId) as Array<{
      id: string; from_session_id: string | null; from_actor: string; target_report_id: string; created_at: string;
    }>;
    return challenges.map((challenge) => {
      const resolves = (this.db.query(`
        SELECT id, from_session_id FROM reports
        WHERE workspace_id = ? AND target_report_id = ? AND relation = 'resolves'
      `).all(workspaceId, challenge.id) as Array<{ id: string; from_session_id: string | null }>)
        .filter((answer) => !obsoleted.has(answer.id) && answer.from_session_id !== null);
      const voice = challenge.from_session_id ? this.cachedVoice(challenge.from_session_id, voices) : null;
      const lifted = voice !== null
        && resolves.some((answer) => this.cachedVoice(answer.from_session_id!, voices) === voice);
      const withdrawn = obsoleted.has(challenge.id);
      return {
        id: challenge.id,
        target_report_id: challenge.target_report_id,
        from_session_id: challenge.from_session_id,
        from_actor: challenge.from_actor,
        created_at: challenge.created_at,
        standing: !withdrawn && !lifted,
        answered_by_another_voice: !lifted && resolves.length > 0,
      };
    });
  }

  /**
   * What waits on this session, whatever its read mark (spec 5.2): reviews
   * requested of it, proposals awaiting its voice, standing challenges on its
   * reports, answers to its own standing challenges, and person acts on
   * proposals its voice wrote or a decision of its voice cited. Every
   * proposal is considered, however old: a relayed no on an old agreement
   * may stop work, so it is never cut. A stop is listed first, so a capped
   * view of this list shows it.
   */
  private noteWaiting(session: CoordinationSessionRow): NoteWaitingEntry[] {
    const workspaceId = session.workspace_id;
    const myVoice = this.consentVoice(session.id);
    const voices = new Map<string, string>();
    const sameVoice = (sessionId: string | null) => sessionId !== null
      && this.cachedVoice(sessionId, voices) === myVoice;
    const waiting: NoteWaitingEntry[] = [];
    for (const task of this.listTasks(workspaceId)) {
      if (task.effective_status === "reported_complete" && task.review_requested_session_id === session.id
        && task.completion_report_id) {
        waiting.push({
          what: "review",
          ref_kind: "task",
          ref_id: task.id,
          about_id: task.completion_report_id,
          by: task.reported_by ?? "unknown",
          by_session_id: task.reported_by_session_id,
          due: null,
          at: task.reported_at ?? task.updated_at,
          summary: task.title,
        });
      }
    }
    const challenges = this.noteChallenges(workspaceId);
    // Every proposal a decision of this voice cites is watched for a stop;
    // only those it was made on (as noteDecisionData reads it) count as
    // already decided, so a decision that merely cites one asks for none.
    // decidedOn keeps the latest such decision's sequence: a decision counts
    // only when it was made after the person's latest act on the proposal,
    // that is, on the act that stands now.
    const decided = new Set<string>();
    const decidedOn = new Map<string, number>();
    const decidedAt = (id: string, sequence: number) => decidedOn.set(id, Math.max(decidedOn.get(id) ?? 0, sequence));
    for (const row of this.db.query(`
      SELECT r.from_session_id, r.evidence_refs_json, r.event_sequence, e.payload_json FROM reports r
      JOIN events e ON e.workspace_id = r.workspace_id AND e.sequence = r.event_sequence
      WHERE r.workspace_id = ? AND r.kind = 'decision'
    `).all(workspaceId) as Array<{ from_session_id: string | null; evidence_refs_json: string; event_sequence: number; payload_json: string }>) {
      if (!sameVoice(row.from_session_id)) continue;
      const cited = (JSON.parse(row.evidence_refs_json) as string[])
        .filter((ref) => ref.startsWith("report:"))
        .map((ref) => ref.slice("report:".length));
      for (const id of cited) decided.add(id);
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      if (payload.note === NOTE_FORMAT) {
        if (typeof payload.about_proposal_id === "string") decidedAt(payload.about_proposal_id, row.event_sequence);
      } else {
        for (const id of cited) decidedAt(id, row.event_sequence);
      }
    }
    // Only the proposals this session could be waited on for: still open with
    // its voice in the snapshot, or acted on by the person and written or
    // cited by its voice. Their statuses are computed; the rest are not read.
    const now = Date.parse(this.timestamp());
    const statuses = this.noteProposalStatuses(workspaceId, this.noteProposalRows(workspaceId).filter((row) =>
      (!row.retired && now < Date.parse(row.closes_at) && row.voice_ids.includes(myVoice))
      || (row.acted && (sameVoice(row.from_session_id) || decided.has(row.report_id)))));
    for (const status of statuses) {
      if (status.ai.closed || !["open", "challenged"].includes(status.ai.position)) continue;
      if (!status.ai.awaiting_voice_ids.includes(myVoice)) continue;
      // A standing challenge from this voice is already its answer.
      if (challenges.some((challenge) => challenge.standing && challenge.target_report_id === status.proposal.id
        && sameVoice(challenge.from_session_id))) continue;
      waiting.push({
        what: "voice",
        ref_kind: "proposal",
        ref_id: status.proposal.id,
        about_id: null,
        by: status.proposal.from_actor,
        by_session_id: status.proposal.from_session_id,
        due: status.terms.closes_at,
        at: status.proposal.created_at,
        summary: firstLine(status.proposal.body),
      });
    }
    // Open ballots this session's unit may still cast in and has not (spec 5.2).
    for (const ballot of this.noteOpenBallots(session)) {
      if (!ballot.viewer?.may_vote || ballot.viewer.unit_has_cast) continue;
      waiting.push({
        what: "vote",
        ref_kind: "ballot",
        ref_id: ballot.ballot_id,
        about_id: null,
        by: ballot.opener_name,
        by_session_id: ballot.opener_session_id,
        due: ballot.terms.closes_at,
        at: ballot.opened_at,
        summary: firstLine(ballot.terms.question),
      });
    }
    const obsoleted = this.activeObsoletionTargets(workspaceId);
    const authorOf = new Map((this.db.query(`
      SELECT id, from_session_id FROM reports WHERE workspace_id = ? AND id IN (
        SELECT target_report_id FROM reports WHERE workspace_id = ? AND relation = 'challenges'
      )
    `).all(workspaceId, workspaceId) as Array<{ id: string; from_session_id: string | null }>)
      .map((row) => [row.id, row.from_session_id]));
    for (const challenge of challenges) {
      if (!challenge.standing) continue;
      if (authorOf.get(challenge.target_report_id) === session.id && challenge.from_session_id !== session.id) {
        waiting.push({
          what: "challenge",
          ref_kind: "report",
          ref_id: challenge.id,
          about_id: challenge.target_report_id,
          by: challenge.from_actor,
          by_session_id: challenge.from_session_id,
          due: null,
          at: challenge.created_at,
          summary: challenge.answered_by_another_voice
            ? "A standing challenge on your report; another voice answered it, which does not lift it."
            : "A standing challenge on your report.",
        });
      }
      if (challenge.from_session_id === session.id) {
        // A support of my challenge agrees with it; anything else aimed at it, or citing it, answers it.
        const answers = this.db.query(`
          SELECT DISTINCT r.id, r.from_actor, r.from_session_id, r.created_at, r.event_sequence FROM reports r
          LEFT JOIN json_each(r.evidence_refs_json) ref
          WHERE r.workspace_id = ? AND r.from_session_id IS NOT NULL AND r.from_session_id <> ?
            AND ((r.target_report_id = ? AND r.relation <> 'supports') OR ref.value = ?)
          ORDER BY r.event_sequence
        `).all(workspaceId, session.id, challenge.id, `report:${challenge.id}`) as Array<{
          id: string; from_actor: string; from_session_id: string; created_at: string;
        }>;
        for (const answer of answers) {
          if (obsoleted.has(answer.id) || sameVoice(answer.from_session_id)) continue;
          waiting.push({
            what: "answer",
            ref_kind: "report",
            ref_id: answer.id,
            about_id: challenge.id,
            by: answer.from_actor,
            by_session_id: answer.from_session_id,
            due: null,
            at: answer.created_at,
            summary: "An answer to your standing challenge; only you can lift it.",
          });
        }
      }
    }
    for (const status of statuses) {
      const mine = sameVoice(status.proposal.from_session_id);
      if (!mine && !decided.has(status.proposal.id)) continue;
      const latest = status.person.acts.at(-1);
      if (!latest) continue;
      const retired = status.ai.position === "withdrawn" || status.ai.position === "superseded";
      const agreedBefore = status.person.acts.slice(0, -1).some((act) => act.act === "agree");
      let what: NoteWaitingEntry["what"] | null = null;
      if (latest.act === "reject" && agreedBefore) what = "stop";
      else if (latest.act === "reject" && mine && !retired) what = "rejected";
      else if (latest.act === "agree" && mine && status.may_proceed
        && (decidedOn.get(status.proposal.id) ?? 0) < latest.event_sequence) {
        what = "record_decision";
      }
      if (!what) continue;
      waiting.push({
        what,
        ref_kind: "proposal",
        ref_id: status.proposal.id,
        about_id: latest.id,
        by: latest.basis,
        by_session_id: latest.relayed_by_session_id,
        due: what === "stop" ? "now" : null,
        at: latest.created_at,
        summary: firstLine(status.proposal.body),
      });
    }
    return [...waiting.filter((entry) => entry.what === "stop"), ...waiting.filter((entry) => entry.what !== "stop")];
  }

  // ---------------------------------------------------------------------------
  // The sealed approval ballot (spec 7, 8.2, 8.4). The arithmetic is ballot.ts;
  // this is where it meets the journal: an open is a report plus ballot.opened,
  // a cast is one ballot.cast holding only a commitment, and the reveal is a
  // system:clock act that reads the seal files once the ballot has closed.

  /** The journal file's real path, which seal files sit beside; null for a store with no file. */
  journalRealpath(): string | null {
    if (!this.filesystemPath) return null;
    try {
      return realpathSync(this.filesystemPath);
    } catch {
      return this.filesystemPath;
    }
  }

  /** Where one cast's seal file lives (spec 7 step 3). Refuses a store with no file. */
  ballotSealPath(ballotId: string, castId: string): string {
    return sealPath(this.requireSealJournal(), ballotId, castId);
  }

  private requireSealJournal(): string {
    const realpath = this.journalRealpath();
    if (!realpath) {
      throw new CollabError("ballots_need_a_file_journal", "A sealed ballot keeps its seals beside the journal file; this store has none", {
        remedy: { say: "Open collab on a journal file, not an in-memory store, to poll." },
      });
    }
    return realpath;
  }

  /**
   * Open a ballot (spec 5.7, 7): the poll report and ballot.opened in one
   * transaction, the electorate fixed and hashed inside it. `render` turns
   * the checked terms into the poll report's body.
   */
  openBallotForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    idempotency_key: string;
    poll: PollTermsInput;
    render: (terms: BallotTerms) => string;
    receipt_plan?: ReceiptPlanGuard;
  }): NoteBallotOpenReceipt {
    this.requireSealJournal();
    const { render, receipt_plan: plan, ...rest } = input;
    const poll = definedPollInput(rest.poll);
    return this.mutateAsSession(rest, rest.idempotency_key, "notes.poll.v1", { poll }, (session) => {
      const now = this.timestamp();
      const views = this.noteSessionViews(session.workspace_id);
      const voters = normalizeBallotVoters(poll.voters);
      const marked = new Set((this.db.query(`SELECT session_id FROM note_marks WHERE workspace_id = ?`)
        .all(session.workspace_id) as Array<{ session_id: string }>).map((row) => row.session_id));
      let chosen: NoteSessionView[];
      if (voters) {
        chosen = [];
        for (const voter of voters) {
          let view: NoteSessionView;
          try {
            view = this.resolveNoteSession(session.workspace_id, voter);
          } catch (error) {
            if (!(error instanceof CollabError)) throw error;
            throw new CollabError(error.code, `voters: ${error.message}`, {
              ...error.details,
              field: "voters",
              remedy: { say: "Name each voter by an active session's id, session# handle or name; collab_arrive lists who is here." },
            });
          }
          if (!chosen.some((other) => other.id === view.id)) chosen.push(view);
        }
      } else {
        const recent = Date.parse(now) - BALLOT_RECENT_MS;
        chosen = views.filter((view) => view.status === "active" && (view.id === session.id
          || (Date.parse(view.last_seen_at) >= recent && marked.has(view.id))));
      }
      const sessions: ElectorateSession[] = chosen.map((view) => ({
        session_id: view.id,
        voice_id: view.voice_id,
        seat_ref: view.seat_ref,
        name: view.actor,
        model: view.model,
        last_seen_at: view.last_seen_at,
      }));
      const electorate = buildElectorate(sessions);
      const { terms, advice } = validatePollTerms(poll, { now, units: electorate.units, sessions });
      const listedVoices = new Set(electorate.units.flatMap((unit) => unit.voice_ids));
      const leftOutAll = views
        .filter((view) => view.status === "active" && view.liveness === "live" && !listedVoices.has(view.voice_id))
        .map((view) => ({
          session_id: view.id,
          name: view.actor,
          last_seen_minutes: Math.max(0, Math.floor((Date.parse(now) - Date.parse(view.last_seen_at)) / 60_000)),
        }));
      const leftOut = leftOutAll.slice(0, BALLOT_LEFT_OUT_MAX);
      const body = render(terms);
      const normalized = {
        task_id: null,
        to_session_id: null,
        kind: "observation" as const,
        body,
        evidence_refs: [] as string[],
        confidence: "unknown" as const,
        confidence_basis: null,
        limits: null,
        relation: "informs" as const,
        target_report_id: null,
        authority_scope: null,
        authority_basis: null,
      };
      this.validateReportInput(session, normalized);
      const report = this.appendReportInternal(session, { ...normalized, note: NOTE_FORMAT });
      const payload: Record<string, unknown> = {
        ballot_id: report.id,
        question: terms.question,
        options: terms.options,
        ...(terms.criteria !== undefined ? { criteria: terms.criteria } : {}),
        method: terms.method,
        ...(terms.pick !== undefined ? { pick: terms.pick } : {}),
        quorum: terms.quorum,
        closes_at: terms.closes_at,
        close_when_all_cast: terms.close_when_all_cast,
        electorate: electorate.units,
        electorate_sha256: electorate.electorate_sha256,
        left_out: leftOut,
        ...(leftOutAll.length > leftOut.length ? { left_out_total: leftOutAll.length } : {}),
        chosen_by: voters ? "opener" : "default",
        opener_session_id: session.id,
      };
      assertNotePayload(payload);
      const event = this.appendEvent(session.workspace_id, "ballot.opened", report.id, session.actor, payload, session.id);
      this.db.query(`
        INSERT OR REPLACE INTO note_ballots (workspace_id, ballot_id, closes_at, state) VALUES (?, ?, ?, 'open')
      `).run(session.workspace_id, report.id, terms.closes_at);
      return {
        ballot_id: report.id,
        report,
        event_id: event.id,
        sequence: event.sequence,
        terms,
        electorate: electorate.units,
        electorate_sha256: electorate.electorate_sha256,
        left_out: leftOut,
        left_out_total: leftOutAll.length,
        chosen_by: voters ? "opener" as const : "default" as const,
        advice,
      };
    }, plan ? { receipt_plan: plan } : {});
  }

  /**
   * Record one sealed cast (spec 7 step 4): a ballot.cast event holding the
   * commitment, never the vote. The seal file was written before this call,
   * and the caller removes it when this refuses. Checked inside the
   * transaction: the ballot is open and not withdrawn, the caster's unit is
   * the one the commitment names, and the session's cast limit. With
   * `after_cast_id` (the session's latest cast the caller saw, or null for
   * none), a session that has cast since then is refused changed_under_you:
   * two processes holding one session would otherwise both pass the retry
   * check and record one vote twice, as a replacement it never made.
   */
  castBallotForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    ballot_id: string;
    cast_id: string;
    unit_id: string;
    commitment: string;
    after_cast_id?: string | null;
  }): NoteBallotCastReceipt {
    const ballotId = validateId(input.ballot_id, "ballot_id");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.cast_id)) {
      throw new CollabError("invalid_cast_id", "A cast id is a random uuid");
    }
    if (!/^[0-9a-f]{64}$/.test(input.commitment)) throw new CollabError("invalid_commitment", "A commitment is a sha256 in hex");
    // Only the commitment and ids reach the receipt: nothing derived from
    // the vote without its salt is stored anywhere (spec 7).
    const request = { ballot_id: ballotId, cast_id: input.cast_id, unit_id: input.unit_id, commitment: input.commitment };
    return this.mutateAsSession(input, `b1:${input.cast_id}`, "notes.vote.v1", request, (session) => {
      const facts = this.readBallotFacts(session.workspace_id, ballotId);
      if (!facts) throw new CollabError("ballot_not_found", `No ballot with id ${ballotId} in this workspace`);
      if (facts.state === "revealed" || facts.state === "closed") {
        throw new CollabError("ballot_closed", `The ballot closed at ${facts.closed_by === "all_cast" ? "its last unit's cast" : facts.terms.closes_at}; no cast is taken after the close`, {
          closes_at: facts.terms.closes_at,
          closed_by: facts.closed_by,
        });
      }
      if (facts.state === "withdrawn") {
        throw new CollabError("ballot_withdrawn", "The opener withdrew this ballot; no cast is taken after a withdrawal", {
          withdrawn_by_report: facts.withdrawn!.report_id,
        });
      }
      const voice = this.consentVoice(session.id);
      const caster = classifyCaster(facts.units, { voice_id: voice, seat_ref: this.sessionSeatRef(session.id) });
      if (caster.unit_id !== input.unit_id) {
        throw new CollabError("ballot_unit_changed", "The unit this cast was sealed for is not this session's unit in this ballot");
      }
      const mine = facts.casts.filter((cast) => cast.session_id === session.id);
      if (input.after_cast_id !== undefined && (mine.at(-1)?.cast_id ?? null) !== input.after_cast_id) {
        throw new CollabError("changed_under_you", "This session cast in this ballot after the call read it, so this cast was not recorded");
      }
      const castSeq = nextCastSeq(mine.length);
      const voices = new Map<string, string>();
      const unitMateCast = facts.casts.some((cast) =>
        cast.unit_id === caster.unit_id && this.cachedVoice(cast.session_id, voices) !== voice);
      const payload = {
        ballot_id: ballotId,
        cast_id: input.cast_id,
        unit_id: caster.unit_id,
        session_id: session.id,
        commitment: input.commitment,
        cast_seq: castSeq,
      };
      assertNotePayload(payload);
      const event = this.appendEvent(session.workspace_id, "ballot.cast", ballotId, session.actor, payload, session.id);
      const castUnits = new Set([...facts.cast_unit_ids, ...(caster.counts_as === "counted" ? [caster.unit_id] : [])]);
      return {
        ballot_id: ballotId,
        cast_id: input.cast_id,
        cast_seq: castSeq,
        commitment: input.commitment,
        unit_id: caster.unit_id,
        counts_as: caster.counts_as,
        ...(caster.counts_as === "late" && caster.same_handle_as ? { same_handle_as: caster.same_handle_as } : {}),
        closes_at: facts.terms.closes_at,
        event_id: event.id,
        sequence: event.sequence,
        cast_at: event.occurred_at,
        unit_mate_cast: unitMateCast,
        closes_now: facts.terms.close_when_all_cast && facts.units.every((unit) => castUnits.has(unit.unit_id)),
      };
    });
  }

  /**
   * The system:clock reveal (spec 7, "Close and reveal") of every ballot in
   * the workspace that has closed and has no ballot.closed yet, in its own
   * IMMEDIATE transaction. Seal files are deleted only after the commit. A
   * reveal that fails leaves its ballot sealed for the next call and is
   * reported in `pending`; this never throws.
   */
  revealDueBallots(workspaceId: string): NoteRevealOutcome {
    try {
      if (!this.hasDueBallot(workspaceId)) return { revealed: [], pending: [] };
      const outcome = this.db.transaction(() => this.revealBallotsInTransaction(workspaceId)).immediate();
      this.cleanSeals(outcome.revealed);
      this.tightenFileModes();
      return outcome;
    } catch (error) {
      return { revealed: [], pending: [{ ballot_id: null, code: error instanceof CollabError ? error.code : "reveal_failed" }] };
    }
  }

  /** A ballot as the notes surface shows it, from the journal alone (spec 5.2 about, 7). Read-only. */
  noteBallotView(workspaceId: string, ballotId: string, viewerSessionId?: string | null): NoteBallotData {
    return this.db.transaction(() => {
      const facts = this.readBallotFacts(workspaceId, validateId(ballotId, "ballot_id"));
      if (!facts) throw new CollabError("ballot_not_found", `No ballot with id ${ballotId} in this workspace`);
      return this.ballotData(facts, viewerSessionId ?? null);
    }).deferred();
  }

  /** The computed result of a revealed ballot (spec 7 "Result"), or null while it is sealed. Never stored. Read-only. */
  ballotResult(workspaceId: string, ballotId: string): BallotResult | null {
    return this.noteBallotView(workspaceId, ballotId).result;
  }

  /** The unit a session casts for in a ballot, and whether that cast would count (spec 7 "Unit"). Read-only. */
  ballotUnitOf(workspaceId: string, ballotId: string, sessionId: string): NoteBallotViewer {
    return this.noteBallotView(workspaceId, ballotId, validateId(sessionId, "session_id")).viewer!;
  }

  /** This session's latest cast in a ballot, for the seal-file retry check (spec 7 step 2). Read-only. */
  latestBallotCastForSession(workspaceId: string, ballotId: string, sessionId: string): NoteBallotCast | null {
    const facts = this.readBallotFacts(workspaceId, validateId(ballotId, "ballot_id"));
    if (!facts) return null;
    return facts.casts.filter((cast) => cast.session_id === sessionId).at(-1) ?? null;
  }

  /** Whether any ballot of the workspace is due a reveal. Read-only and cheap when none is open. */
  private hasDueBallot(workspaceId: string): boolean {
    const open = this.db.query(`SELECT ballot_id FROM note_ballots WHERE workspace_id = ? AND state = 'open'`)
      .all(workspaceId) as Array<{ ballot_id: string }>;
    return open.some((row) => {
      try {
        const facts = this.readBallotFacts(workspaceId, row.ballot_id);
        return facts === null || facts.state === "closed" || facts.state === "revealed";
      } catch {
        return true;
      }
    });
  }

  /**
   * Reveal every due ballot inside the caller's transaction, each in a
   * savepoint of its own, so one that fails is rolled back alone and the
   * rest of the transaction still commits.
   */
  private revealBallotsInTransaction(workspaceId: string): NoteRevealOutcome {
    const outcome: NoteRevealOutcome = { revealed: [], pending: [] };
    let open: Array<{ ballot_id: string }>;
    try {
      open = this.db.query(`SELECT ballot_id FROM note_ballots WHERE workspace_id = ? AND state = 'open' ORDER BY closes_at, ballot_id`)
        .all(workspaceId) as Array<{ ballot_id: string }>;
    } catch (error) {
      outcome.pending.push({ ballot_id: null, code: error instanceof CollabError ? error.code : "reveal_failed" });
      return outcome;
    }
    for (const { ballot_id: ballotId } of open) {
      try {
        this.db.transaction(() => {
          const facts = this.readBallotFacts(workspaceId, ballotId);
          if (!facts || facts.state === "revealed") {
            // Revealed by another process, or its opening is not in this
            // journal: nothing to reveal here.
            this.db.query(`UPDATE note_ballots SET state = 'closed' WHERE workspace_id = ? AND ballot_id = ?`).run(workspaceId, ballotId);
            return;
          }
          if (facts.state !== "closed") return;
          this.revealBallot(facts);
          outcome.revealed.push(ballotId);
        })();
      } catch (error) {
        outcome.pending.push({ ballot_id: ballotId, code: error instanceof CollabError ? error.code : "reveal_failed" });
      }
    }
    return outcome;
  }

  /** Open each seal named by the ballot's casts, resolve the casts, and append the reveal (spec 7). */
  private revealBallot(facts: NoteBallotFacts): void {
    const realpath = this.journalRealpath();
    const casts: CastToResolve[] = facts.casts.map((cast) => {
      let seal: SealOutcome = { state: "seal_missing" };
      if (realpath) {
        const read = readSealFile(sealPath(realpath, facts.ballot_id, cast.cast_id));
        seal = read.state === "missing"
          ? { state: "seal_missing" }
          : read.state === "unreadable"
            ? { state: "seal_unreadable" }
            : openSeal(read.value, cast, { workspace_id: facts.workspace_id, ballot_id: facts.ballot_id, journal_realpath: realpath });
      }
      return {
        cast_id: cast.cast_id,
        unit_id: cast.unit_id,
        session_id: cast.session_id,
        commitment: cast.commitment,
        cast_seq: cast.cast_seq,
        voice_id: this.consentVoice(cast.session_id),
        seal,
      };
    });
    const entries = resolveCasts(facts.units, casts, { ballot_id: facts.ballot_id });
    this.revealFailpoint?.("revealing", facts.ballot_id);
    for (const entry of entries) {
      const payload = entry as unknown as Record<string, unknown>;
      assertNotePayload(payload);
      this.appendEvent(facts.workspace_id, "ballot.revealed", facts.ballot_id, "system:clock", payload, null);
    }
    const closed = {
      ballot_id: facts.ballot_id,
      entry_count: entries.length,
      entries_sha256: revealedEntriesSha256(entries),
      closed_at: this.timestamp(),
    };
    this.appendEvent(facts.workspace_id, "ballot.closed", facts.ballot_id, "system:clock", closed, null);
    this.db.query(`UPDATE note_ballots SET state = 'closed' WHERE workspace_id = ? AND ballot_id = ?`)
      .run(facts.workspace_id, facts.ballot_id);
    this.revealFailpoint?.("appended", facts.ballot_id);
  }

  /**
   * After a reveal commits: delete this journal's seal files of those
   * ballots, orphans included (a cast whose transaction never committed),
   * and the temporary files a write left when its process died before the
   * rename. A cast still being written when its ballot is revealed is past
   * the close and would be refused anyway. A seal another journal wrote (a
   * copy beside this one) is left in place.
   */
  private cleanSeals(ballotIds: readonly string[]): void {
    const realpath = this.journalRealpath();
    if (!realpath) return;
    for (const ballotId of ballotIds) {
      try {
        const paths = [
          ...listSealFiles(realpath, ballotId).map((castId) => sealPath(realpath, ballotId, castId)),
          ...listSealTemporaries(realpath, ballotId),
        ];
        for (const path of paths) {
          const read = readSealFile(path);
          const owner = read.state === "read" && read.value !== null && typeof read.value === "object"
            ? (read.value as Record<string, unknown>).journal_realpath
            : undefined;
          if (read.state !== "read" || owner === realpath || typeof owner !== "string") removeSealFile(path);
        }
        removeEmptySealDirectory(realpath, ballotId);
      } catch {
        // The reveal is committed; a seal left on disk is visible there, never in collab.
      }
    }
  }

  /**
   * At open: clean the seal directories of ballots this journal has already
   * revealed. A process that died between a reveal's commit and its
   * cleanSeals left them, and no later reveal would name them again; among
   * them can be an orphan seal whose vote was never revealed. Never throws.
   */
  private sweepRevealedSeals(): void {
    try {
      const realpath = this.journalRealpath();
      if (!realpath) return;
      // Events are read only for a ballot note_ballots already reads closed,
      // so the open ballots' seal directories cost a lookup in a small table.
      const revealed = listSealBallots(realpath).filter((ballotId) => this.db.query(`
        SELECT 1 FROM note_ballots b WHERE b.ballot_id = ? AND b.state = 'closed' AND EXISTS (
          SELECT 1 FROM events e WHERE e.workspace_id = b.workspace_id AND e.type = 'ballot.closed' AND e.entity_id = b.ballot_id
        ) LIMIT 1
      `).get(ballotId) !== null);
      this.cleanSeals(revealed);
    } catch {
      // A seal left on disk is visible there, never in collab; the next open tries again.
    }
  }

  /** Everything the journal records about one ballot, judged at the store's clock. Null when no ballot.opened names it. */
  private readBallotFacts(workspaceId: string, ballotId: string): NoteBallotFacts | null {
    const rows = this.db.query(`
      SELECT id, sequence, type, session_id, occurred_at, payload_json FROM events
      WHERE workspace_id = ? AND entity_id = ?
        AND type IN ('ballot.opened', 'ballot.cast', 'ballot.revealed', 'ballot.closed')
      ORDER BY sequence
    `).all(workspaceId, ballotId) as Array<{
      id: string; sequence: number; type: string; session_id: string | null; occurred_at: string; payload_json: string;
    }>;
    const openedRow = rows.find((row) => row.type === "ballot.opened");
    if (!openedRow) return null;
    const opened = JSON.parse(openedRow.payload_json) as Record<string, any>;
    const terms: BallotTerms = {
      question: opened.question,
      options: opened.options,
      method: opened.method,
      quorum: opened.quorum,
      closes_at: opened.closes_at,
      close_when_all_cast: opened.close_when_all_cast === true,
    };
    if (typeof opened.criteria === "string") terms.criteria = opened.criteria;
    if (Number.isInteger(opened.pick)) terms.pick = opened.pick;
    const units = (Array.isArray(opened.electorate) ? opened.electorate : []) as ElectorateUnit[];
    const unitIds = new Set(units.map((unit) => unit.unit_id));
    const casts: NoteBallotCast[] = [];
    const castUnits = new Set<string>();
    let allCastSequence: number | null = null;
    let allCastAt: string | null = null;
    const revealed: RevealedEntry[] = [];
    let closed: NoteBallotFacts["closed"] = null;
    for (const row of rows) {
      const payload = JSON.parse(row.payload_json) as Record<string, any>;
      if (row.type === "ballot.cast") {
        casts.push({
          cast_id: payload.cast_id,
          unit_id: payload.unit_id,
          session_id: payload.session_id,
          commitment: payload.commitment,
          cast_seq: payload.cast_seq,
          event_id: row.id,
          sequence: row.sequence,
          at: row.occurred_at,
        });
        if (unitIds.has(payload.unit_id)) castUnits.add(payload.unit_id);
        if (allCastSequence === null && units.length > 0 && units.every((unit) => castUnits.has(unit.unit_id))) {
          allCastSequence = row.sequence;
          allCastAt = row.occurred_at;
        }
      } else if (row.type === "ballot.revealed") {
        revealed.push(payload as RevealedEntry);
      } else if (row.type === "ballot.closed" && closed === null) {
        closed = {
          event_id: row.id,
          sequence: row.sequence,
          at: row.occurred_at,
          entry_count: payload.entry_count,
          entries_sha256: payload.entries_sha256,
        };
      }
    }
    // The opener's first withdrawal before the close counts, and it is final
    // for the ballot. Withdrawing the withdrawal later is not read here: the
    // casts refused in between cannot be taken back, and an opener who could
    // undo it would choose, after seeing turnout or the revealed votes,
    // whether the ballot counts. A withdrawal after the close counts neither:
    // every vote is revealed by then, and it would hide a top choice.
    const withdrawal = (this.db.query(`
      SELECT id, event_sequence, created_at FROM reports
      WHERE workspace_id = ? AND target_report_id = ? AND relation = 'withdraws' AND from_session_id = ?
      ORDER BY event_sequence
    `).all(workspaceId, ballotId, opened.opener_session_id) as Array<{ id: string; event_sequence: number; created_at: string }>)
      .find((row) => Date.parse(row.created_at) < Date.parse(terms.closes_at)
        && (!terms.close_when_all_cast || allCastSequence === null || row.event_sequence < allCastSequence)
        && (closed === null || row.event_sequence < closed.sequence)) ?? null;
    const withdrawn = withdrawal ? { report_id: withdrawal.id, sequence: withdrawal.event_sequence, at: withdrawal.created_at } : null;
    const now = this.timestamp();
    // An all-cast close happened at its last cast, so it stays the reason
    // once the deadline has passed too.
    const closedAllCast = terms.close_when_all_cast && !withdrawn && allCastAt !== null
      && Date.parse(allCastAt) < Date.parse(terms.closes_at);
    const closedBy: NoteBallotFacts["closed_by"] = closedAllCast
      ? "all_cast"
      : Date.parse(now) >= Date.parse(terms.closes_at) ? "time" : null;
    const state: NoteBallotFacts["state"] = closed !== null
      ? "revealed"
      : closedBy !== null ? "closed" : withdrawn ? "withdrawn" : "open";
    const leftOut = (Array.isArray(opened.left_out) ? opened.left_out : []) as LeftOutSession[];
    return {
      ballot_id: ballotId,
      workspace_id: workspaceId,
      opener_session_id: opened.opener_session_id,
      opened_at: openedRow.occurred_at,
      opened_sequence: openedRow.sequence,
      terms,
      units,
      electorate_sha256: opened.electorate_sha256,
      chosen_by: opened.chosen_by,
      left_out: leftOut,
      left_out_total: Number.isInteger(opened.left_out_total) ? opened.left_out_total : leftOut.length,
      casts,
      cast_unit_ids: [...castUnits].sort(),
      all_cast_sequence: allCastSequence,
      withdrawn,
      closed_by: closedBy,
      state,
      revealed: closed !== null ? revealed : null,
      closed,
      observed_at: now,
    };
  }

  /** The view of a ballot for one session (or none): its terms, turnout, the viewer's unit, and the result once revealed. */
  private ballotData(facts: NoteBallotFacts, viewerSessionId: string | null): NoteBallotData {
    const sessions = this.noteSessionViews(facts.workspace_id);
    const byId = new Map(sessions.map((view) => [view.id, view]));
    let viewer: NoteBallotViewer | null = null;
    if (viewerSessionId) {
      const voice = this.consentVoice(viewerSessionId);
      const caster = classifyCaster(facts.units, { voice_id: voice, seat_ref: byId.get(viewerSessionId)?.seat_ref ?? null });
      const yours = facts.casts.filter((cast) => cast.session_id === viewerSessionId).length;
      const listed = caster.counts_as === "counted";
      viewer = {
        session_id: viewerSessionId,
        unit_id: caster.unit_id,
        counts_as: caster.counts_as,
        ...(caster.counts_as === "late" && caster.same_handle_as ? { same_handle_as: caster.same_handle_as } : {}),
        in_electorate: listed,
        unit_has_cast: listed ? facts.cast_unit_ids.includes(caster.unit_id) : yours > 0,
        your_casts: yours,
        may_vote: facts.state === "open" && listed && yours < BALLOT_MAX_CASTS,
      };
    }
    let result: BallotResult | null = null;
    if (facts.revealed) {
      const delivered = (this.db.query(`SELECT session_id FROM note_shown WHERE workspace_id = ? AND item_id = ?`)
        .all(facts.workspace_id, facts.ballot_id) as Array<{ session_id: string }>).map((row) => row.session_id);
      result = computeBallotResult({
        terms: facts.terms,
        units: facts.units,
        entries: facts.revealed,
        withdrawn: facts.withdrawn !== null,
        sessions: Object.fromEntries(sessions.map((view) => [view.id, { name: view.actor, seat_ref: view.seat_ref, model: view.model }])),
        delivered_session_ids: delivered,
        left_out: facts.left_out,
      });
    }
    return {
      ...facts,
      opener_name: byId.get(facts.opener_session_id)?.actor ?? facts.opener_session_id,
      turnout: { cast: facts.cast_unit_ids.length, electorate: facts.units.length },
      viewer,
      unit_basis: unitBasis(facts.units),
      sealing: BALLOT_SEALING,
      result,
    };
  }

  /** Every ballot in the workspace that has not been revealed, as one session sees it, oldest first. Read-only. */
  private noteOpenBallots(session: CoordinationSessionRow): NoteBallotData[] {
    const rows = this.db.query(`
      SELECT ballot_id FROM note_ballots WHERE workspace_id = ? AND state = 'open' ORDER BY closes_at, ballot_id
    `).all(session.workspace_id) as Array<{ ballot_id: string }>;
    const out: NoteBallotData[] = [];
    for (const row of rows) {
      const facts = this.readBallotFacts(session.workspace_id, row.ballot_id);
      if (facts && facts.state !== "revealed") out.push(this.ballotData(facts, session.id));
    }
    return out;
  }

  /**
   * The notes a session sees folded (spec 5.2): for each open ballot whose
   * electorate lists its unit and whose unit has not cast, every report in
   * that ballot's thread (relations aimed at it or at an answer, and notes
   * citing it), except its own. The poll report itself, which holds the
   * terms, is not folded. A default of the view, never a gate: about shows
   * any of them.
   */
  private noteBallotFolds(session: CoordinationSessionRow): Map<string, string> {
    const folds = new Map<string, string>();
    for (const ballot of this.noteOpenBallots(session)) {
      if (ballot.state !== "open" || !ballot.viewer?.in_electorate || ballot.viewer.unit_has_cast) continue;
      for (const id of this.ballotThreadIds(session.workspace_id, ballot.ballot_id)) {
        if (folds.has(id)) continue;
        // A session's own notes cannot sway it, so they are never folded for it.
        const author = this.db.query(`SELECT from_session_id FROM reports WHERE id = ?`).get(id) as { from_session_id: string | null } | null;
        if (author?.from_session_id !== session.id) folds.set(id, ballot.ballot_id);
      }
    }
    return folds;
  }

  /** Every report that answers a ballot, at any depth: aimed at it or at an answer, or citing either (a note's re). */
  private ballotThreadIds(workspaceId: string, ballotId: string): string[] {
    const seen = new Set<string>();
    let frontier = [ballotId];
    while (frontier.length > 0 && seen.size < NOTE_THREAD_MAX) {
      const next: string[] = [];
      for (const target of frontier) {
        const rows = this.db.query(`
          SELECT id FROM reports WHERE workspace_id = ? AND target_report_id = ?
          UNION
          SELECT r.id FROM reports r, json_each(r.evidence_refs_json) ref WHERE r.workspace_id = ? AND ref.value = ?
        `).all(workspaceId, target, workspaceId, `report:${target}`) as Array<{ id: string }>;
        for (const row of rows) {
          if (seen.has(row.id) || row.id === ballotId) continue;
          seen.add(row.id);
          next.push(row.id);
        }
      }
      frontier = next;
    }
    return [...seen];
  }

  /** The store's clock, for a verb that turns a caller's close time into seconds from now. Read-only. */
  noteNow(): string {
    return this.timestamp();
  }

  /**
   * The cheap refusals openProposalForSession would make for this caller's
   * journal evidence and replaced proposal, thrown with the same codes and
   * messages (spec 5.6). collab_propose calls it before citing its outside
   * evidence, so a proposal the store would refuse leaves no orphan cite.
   * Read-only; the open checks all of it again in its own transaction.
   */
  noteProposalPrecheck(
    credential: { session_id: string; session_token: string; generation: number },
    input: { evidence_refs: string[]; supersedes_report_id: string | null; task_id: string | null },
  ): void {
    this.db.transaction(() => {
      const session = this.authenticateSession(credential);
      for (const reference of normalizeEvidenceRefs(input.evidence_refs)) {
        this.requireEvidenceRef(session.workspace_id, reference);
      }
      if (input.task_id) this.requireTaskRow(session.workspace_id, input.task_id);
      if (!input.supersedes_report_id) return;
      const replaced = this.requireReport(validateId(input.supersedes_report_id, "supersedes_report_id"));
      if (replaced.workspace_id !== session.workspace_id) {
        throw new CollabError("report_target_mismatch", "Target report is in another workspace");
      }
      if (replaced.task_id !== input.task_id) {
        throw new CollabError("report_task_mismatch", "Related reports must use the same task scope as their target", {
          target_task_id: replaced.task_id,
          report_task_id: input.task_id,
        });
      }
      if (replaced.from_session_id !== session.id) {
        throw new CollabError(
          "report_author_mismatch",
          "Only the original author session may correct, withdraw, or supersede its report; other sessions should challenge it",
        );
      }
      this.requireOpenToRevision(session.workspace_id, replaced.id);
    }).deferred();
  }

  /**
   * Record a decision (spec 5.3 decide): an optional evidence.cited event and
   * one marked `decision` report that informs (never `supports`, so no
   * consent count moves), in one transaction. Its authority is derived here,
   * inside the write, from the journal and never from the caller's words: on
   * an agreed proposal the scope is the agreed extent byte for byte and the
   * basis names the person's act; on any other outcome nothing is authorised;
   * without a proposal it is this session's own record and says so. A
   * proceed the journal does not support is refused before anything is written.
   */
  appendDecisionForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    idempotency_key: string;
    cite?: { worktree_id: string | null; items: NoteCitedItem[] } | null;
    outcome: NoteDecisionOutcome;
    proposal_report_id?: string | null;
    /** Without a proposal only: what a proceed covers. */
    extent?: string | null;
    body: string;
    task_id?: string | null;
    to_session_id?: string | null;
    to_person?: boolean;
    evidence_refs?: string[];
    receipt_plan?: ReceiptPlanGuard;
  }): NoteDecisionReceipt {
    if (!(NOTE_DECISION_OUTCOMES as readonly string[]).includes(input.outcome)) {
      throw new CollabError("invalid_outcome", `outcome is ${NOTE_DECISION_OUTCOMES.join(", ")}`);
    }
    const proposalId = input.proposal_report_id ? validateId(input.proposal_report_id, "proposal_report_id") : null;
    if (proposalId && input.extent) {
      throw new CollabError("extent_from_proposal", "A decision on a proposal covers the proposal's own extent");
    }
    const cite = input.cite && input.cite.items.length > 0 ? normalizeNoteCite(input.cite) : null;
    const normalized = {
      outcome: input.outcome,
      proposal_report_id: proposalId,
      extent: optionalText(input.extent ?? undefined, "extent", 1_000),
      body: cleanText(input.body, "body", MAX_REPORT_BODY),
      task_id: input.task_id ? validateId(input.task_id, "task_id") : null,
      to_session_id: input.to_session_id ? validateId(input.to_session_id, "to_session_id") : null,
      to_person: input.to_person === true,
      evidence_refs: normalizeEvidenceRefs(input.evidence_refs ?? []),
      cite,
    };
    return this.mutateAsSession(input, input.idempotency_key, "notes.decide.v1", normalized, (session) => {
      const derived = this.decisionAuthority(session.workspace_id, normalized.proposal_report_id, normalized.outcome, normalized.extent);
      const { scope, basis, proposal, person_act: personAct } = derived;
      const refs = [...normalized.evidence_refs, ...derived.refs];
      const cited = normalized.cite ? this.appendNoteCite(session, normalized.cite) : null;
      if (cited) refs.push(`event:${cited.event_id}`);
      const report = {
        task_id: normalized.task_id,
        to_session_id: normalized.to_session_id,
        kind: "decision" as const,
        body: normalized.body,
        evidence_refs: normalizeEvidenceRefs(refs),
        confidence: "unknown" as const,
        confidence_basis: null,
        limits: null,
        relation: "informs" as const,
        target_report_id: null,
        authority_scope: scope,
        authority_basis: basis,
        ...(normalized.to_person ? { to_person: true } : {}),
      };
      this.validateReportInput(session, report);
      const posted = this.appendReportInternal(session, {
        ...report,
        ...(proposal ? { about_proposal_id: proposal.id } : {}),
        note: NOTE_FORMAT,
      });
      return {
        report: posted,
        cite: cited,
        outcome: normalized.outcome,
        proposal,
        person_act: personAct,
        authority_scope: scope,
        authority_basis: basis,
      };
    }, input.receipt_plan ? { receipt_plan: input.receipt_plan } : {});
  }

  /**
   * The refusal appendDecisionForSession would make for this outcome on this
   * proposal, thrown with the same codes and details, or nothing (spec 5.3).
   * A dry run and an early refusal use it; the write derives it all again
   * inside its own transaction. Read-only.
   */
  noteDecisionPrecheck(workspaceId: string, proposalId: string | null, outcome: NoteDecisionOutcome): void {
    this.db.transaction(() => {
      this.decisionAuthority(workspaceId, proposalId, outcome, null);
    }).deferred();
  }

  /**
   * What a decision may say it authorises, derived from the journal alone:
   * the agreed extent and the person's agreement for a proceed on a proposal
   * (refused when the journal does not hold one), nothing for any other
   * outcome, and this session's own record without a proposal.
   */
  private decisionAuthority(
    workspaceId: string,
    proposalId: string | null,
    outcome: NoteDecisionOutcome,
    extent: string | null,
  ): {
    scope: string;
    basis: string;
    proposal: NoteDecisionReceipt["proposal"];
    person_act: NoteDecisionReceipt["person_act"];
    refs: string[];
  } {
    if (!proposalId) {
      return {
        scope: outcome === "proceed" ? extent ?? NOTE_DEFAULT_DECISION_EXTENT : NOTE_NOTHING_AUTHORISED,
        basis: `${outcome === "proceed" ? "" : `${outcome}: `}${NOTE_SELF_DECISION_BASIS}`,
        proposal: null,
        person_act: null,
        refs: [],
      };
    }
    this.requireProposalTerms(workspaceId, proposalId);
    const status = this.proposalStatusInternal(workspaceId, proposalId);
    const acts = status.person.acts;
    const latest = acts.at(-1) ?? null;
    const retired = status.ai.position === "withdrawn" || status.ai.position === "superseded";
    const actView = (act: ProposalPersonAct) => ({
      id: act.id,
      event_id: this.eventIdAt(workspaceId, act.event_sequence),
      act: act.act,
      basis: act.basis,
      at: act.created_at,
      reason: act.reason,
    });
    let scope: string;
    let basis: string;
    let personAct: NoteDecisionReceipt["person_act"];
    if (outcome === "proceed") {
      if (retired) {
        throw new CollabError(
          "proposal_retired",
          `This proposal was ${status.ai.position} by ${status.ai.obsoleted_by_report_id}, so nothing can proceed on it`,
          { position: status.ai.position, obsoleted_by_report_id: status.ai.obsoleted_by_report_id },
        );
      }
      if (!status.may_proceed || !status.agreement) {
        const agreedBefore = [...acts].reverse().find((act) => act.act === "agree") ?? null;
        if (latest?.act === "reject" && agreedBefore) {
          throw new CollabError(
            "agreement_withdrawn",
            `The person agreed (act ${agreedBefore.id}), but a later act rejects these bytes: act ${latest.id}, ` +
              `${latest.basis === "relayed_by_session" ? "relayed by a session" : `by ${latest.basis}`}`,
            { agreed_act: actView(agreedBefore), later_act: actView(latest) },
          );
        }
        throw new CollabError(
          "not_agreed",
          latest?.act === "reject"
            ? "The person's latest act on these bytes is a rejection, and there is no agreement to proceed on"
            : "The person has not agreed to these bytes",
          {
            position: status.ai.position,
            person: status.person.state,
            ...(latest ? { latest_act: actView(latest) } : {}),
          },
        );
      }
      scope = status.terms.extent;
      basis = `person agreed by ${status.agreement.basis} to proposal_sha256 ${status.proposal_sha256} (act ${status.agreement.id})`;
      personAct = actView(status.agreement);
    } else {
      scope = NOTE_NOTHING_AUTHORISED;
      basis = `${outcome}: recorded by this session; on proposal_sha256 ${status.proposal_sha256} the agents' position is ` +
        `${status.ai.position} and the person's latest act is ` +
        `${latest ? `${latest.act} by ${latest.basis} (act ${latest.id})` : "none"}`;
      personAct = latest ? actView(latest) : null;
    }
    return {
      scope,
      basis,
      proposal: {
        id: status.proposal.id,
        proposal_sha256: status.proposal_sha256,
        position: status.ai.position,
        person: status.person.state,
        may_proceed: status.may_proceed,
        extent: status.terms.extent,
        author_session_id: status.proposal.from_session_id,
      },
      person_act: personAct,
      refs: [`report:${status.proposal.id}`, ...(personAct ? [`event:${personAct.event_id}`] : [])],
    };
  }

  /**
   * A proposal as the notes surface shows it (spec 5.2 about, 5.6, 6): the
   * unchanged consent/v1 status, plus display-only facts that change no
   * count: who stands on it and how, who was consulted and whether a
   * delivery was recorded, and what a replaced proposal's objections became.
   * Read-only, one snapshot.
   */
  noteProposalView(workspaceId: string, proposalId: string): NoteProposalData {
    return this.db.transaction(() => {
      this.requireProposalTerms(workspaceId, validateId(proposalId, "proposal_report_id"));
      return this.noteProposalData(workspaceId, proposalId, this.noteSessionViews(workspaceId));
    }).deferred();
  }

  /** A decision as a composed record (spec 5.2 about); see noteDecisionData. Read-only, one snapshot. */
  noteDecisionView(workspaceId: string, reportId: string): NoteDecisionData {
    return this.db.transaction(() => {
      const report = this.requireReport(validateId(reportId, "report_id"));
      if (report.workspace_id !== workspaceId || report.kind !== "decision") {
        throw new CollabError("report_not_found", `No decision report ${reportId} in this workspace`);
      }
      return this.noteDecisionData(workspaceId, report, this.noteSessionViews(workspaceId));
    }).deferred();
  }

  private noteProposalData(
    workspaceId: string,
    proposalId: string,
    sessions: NoteSessionView[],
    context: ProposalReadContext = this.proposalReadContext(workspaceId),
  ): NoteProposalData {
    // The position comes from the one consent/v1 computation, unchanged.
    const status = this.proposalStatusInternal(workspaceId, proposalId, context);
    const byId = new Map(sessions.map((view) => [view.id, view]));
    const author = status.proposal.from_session_id ? byId.get(status.proposal.from_session_id) ?? null : null;
    const challengeViews = new Map(this.noteChallenges(workspaceId).map((challenge) => [challenge.id, challenge]));
    const qualifying = new Set(status.ai.qualifying_support_report_ids);
    const unresolved = new Set(status.ai.unresolved_challenge_report_ids);
    const activeVoices = new Set(sessions.filter((view) => view.status === "active").map((view) => view.voice_id));
    const stances = (this.db.query(`
      SELECT * FROM reports WHERE workspace_id = ? AND target_report_id = ? AND relation IN ('supports', 'challenges')
      ORDER BY event_sequence
    `).all(workspaceId, proposalId) as ReportRow[]).map(reportFromRow).map((report) => {
      const session = report.from_session_id ? byId.get(report.from_session_id) ?? null : null;
      const view = challengeViews.get(report.id);
      return this.noteStanceView(workspaceId, report, session, author, context, {
        counted: report.relation === "supports" ? qualifying.has(report.id) : unresolved.has(report.id),
        standing: report.relation === "supports" ? !context.obsoleted.has(report.id) : unresolved.has(report.id),
        answered_by_another_voice: view?.answered_by_another_voice === true,
        opened_at: status.terms.created_at,
        active_voices: activeVoices,
      });
    });
    const supports = stances.filter((stance) => stance.relation === "supports");
    const challenges = stances.filter((stance) => stance.relation === "challenges");
    const consulted = status.terms.voices
      .filter((voice) => voice.voice_id !== status.terms.author_voice_id)
      .map((voice): NoteConsultedVoice => {
        const members = sessions.filter((view) => view.voice_id === voice.voice_id || voice.live_session_ids.includes(view.id));
        const root = byId.get(voice.voice_id) ?? members[0] ?? null;
        const lastSeen = members.map((view) => view.last_seen_at).sort().at(-1) ?? null;
        return {
          voice_id: voice.voice_id,
          name: root?.actor ?? voice.voice_id,
          session_ids: members.map((view) => view.id),
          last_seen_at: lastSeen,
          awaited: status.ai.awaiting_voice_ids.includes(voice.voice_id),
          supported: supports.some((stance) => stance.counted && stance.voice_id === voice.voice_id),
          challenged: challenges.some((stance) => stance.standing && stance.voice_id === voice.voice_id),
          delivery_recorded: members.some((view) => this.noteShownAt(workspaceId, view.id, proposalId) !== null),
          ended: members.length > 0 && members.every((view) => view.status === "ended"),
        };
      });
    let replaced: NoteProposalData["replaced"] = null;
    if (status.proposal.relation === "supersedes" && status.proposal.target_report_id) {
      const replacedId = status.proposal.target_report_id;
      const conflicts = status.terms.known_conflicts ?? "";
      // An objection an earlier replacement carried as text can be carried
      // again, and one a replacement shed still stands where it was raised,
      // so the challenges on every proposal this one descends from are read:
      // each is listed when these terms carry it or it still stands.
      const lineage = this.replacedLineage(workspaceId, replacedId);
      const carried = [...challengeViews.values()]
        .filter((challenge) => lineage.has(challenge.target_report_id))
        .map((challenge) => {
          const voice = challenge.from_session_id ? this.consentVoice(challenge.from_session_id, context) : null;
          return {
            challenge_id: challenge.id,
            raised_on: challenge.target_report_id,
            by_session_id: challenge.from_session_id,
            by: challenge.from_actor,
            voice_id: voice,
            carried_in_terms: conflicts.includes(`report:${challenge.id}`),
            standing_on_replaced: challenge.standing,
            re_raised_here: voice !== null && challenges.some((stance) => stance.standing && stance.voice_id === voice),
          };
        })
        .filter((entry) => entry.carried_in_terms || entry.standing_on_replaced)
        .map((entry) => ({ ...entry, statement: this.noteStanceStatement(workspaceId, this.requireReport(entry.challenge_id)) }));
      replaced = { proposal_id: replacedId, carried };
    }
    return {
      status,
      author,
      lone: consulted.length === 0,
      supports,
      challenges,
      consulted,
      replaced,
      observed_at: this.timestamp(),
    };
  }

  /**
   * A replaced proposal and every proposal it replaced in turn, by
   * following `supersedes` targets. Each link points at an earlier report,
   * so the walk ends; the set also stops a damaged journal from looping.
   */
  private replacedLineage(workspaceId: string, replacedId: string): Set<string> {
    const lineage = new Set<string>();
    let current: string | null = replacedId;
    while (current !== null && !lineage.has(current)) {
      lineage.add(current);
      const row = this.db.query(`SELECT relation, target_report_id FROM reports WHERE workspace_id = ? AND id = ?`)
        .get(workspaceId, current) as { relation: string; target_report_id: string | null } | null;
      current = row?.relation === "supersedes" ? row.target_report_id : null;
    }
    return lineage;
  }

  /** A stance's statement as noteStanceView reads it: a marked note's statement, else the body's first line. */
  private noteStanceStatement(workspaceId: string, report: CollabReport): string {
    const first = report.body.split("\n")[0] ?? "";
    if (!this.reportIsMarked(workspaceId, report)) return first;
    const parsed = parseNote(report.body);
    return parsed.act !== null ? parsed.statement : first;
  }

  /** One support or challenge with its display-only flags (spec 6). They change no count. */
  private noteStanceView(
    workspaceId: string,
    report: CollabReport,
    session: NoteSessionView | null,
    author: NoteSessionView | null,
    context: ProposalReadContext,
    facts: {
      counted: boolean;
      standing: boolean;
      answered_by_another_voice: boolean;
      opened_at: string | null;
      active_voices: ReadonlySet<string>;
    },
  ): NoteStanceView {
    const marked = this.reportIsMarked(workspaceId, report);
    let statement = report.body.split("\n")[0] ?? "";
    let grounded: boolean;
    if (marked) {
      const parsed = parseNote(report.body);
      if (parsed.act !== null) statement = parsed.statement;
      grounded = parsed.why.length > 0 || parsed.evidence.length > 0;
    } else {
      // A legacy report's body is not read for reasons, so only its fields count.
      grounded = report.evidence_refs.length > 0 || report.confidence_basis !== null;
    }
    const flags: NoteStanceView["flags"] = {};
    const byAuthor = author !== null && report.from_session_id === author.id;
    if (byAuthor) flags.by_author = true;
    if (!byAuthor && session && author) {
      if (author.seat_ref !== null && session.seat_ref === author.seat_ref) flags.same_seat_as_author = true;
      if (session.actor === author.actor) flags.same_name_as_author = true;
    }
    if (report.relation === "supports" && session && facts.opened_at !== null && session.joined_at > facts.opened_at) {
      flags.started_after_open = true;
    }
    if (!grounded) flags.ungrounded = true;
    if (report.relation === "challenges") {
      if (session?.status === "ended") flags.challenger_ended = true;
      if (facts.answered_by_another_voice) flags.answered_by_another_voice = true;
    }
    const voice = report.from_session_id ? this.consentVoice(report.from_session_id, context) : null;
    return {
      id: report.id,
      relation: report.relation as "supports" | "challenges",
      from_session_id: report.from_session_id,
      from_actor: report.from_actor,
      voice_id: voice,
      voice_has_active_session: voice !== null && facts.active_voices.has(voice),
      from_session_ended: session?.status === "ended",
      created_at: report.created_at,
      statement,
      marked,
      grounded_by: marked ? "note" : "fields",
      counted: facts.counted,
      standing: facts.standing,
      flags,
    };
  }

  /**
   * A decision as a composed record (spec 5.2 about): not stored. What it
   * rests on is derived from the journal, never from the sender's words.
   * A marked decision was written by appendDecisionForSession, which set
   * about_proposal_id only when it derived the authority from that
   * proposal; its evidence refs are partly the caller's, so they never name
   * what it rests on. A legacy decision has only the evidence refs its
   * caller chose, and the views label it so. Read-only, inside the caller's
   * snapshot.
   */
  private noteDecisionData(workspaceId: string, report: CollabReport, sessions: NoteSessionView[]): NoteDecisionData {
    const marked = this.reportIsMarked(workspaceId, report);
    const payload = this.reportPayload(workspaceId, report);
    const termed = (id: string) => this.db.query(`SELECT 1 FROM proposal_terms WHERE workspace_id = ? AND report_id = ?`)
      .get(workspaceId, id) !== null;
    let proposalId = typeof payload.about_proposal_id === "string" && termed(payload.about_proposal_id)
      ? payload.about_proposal_id
      : null;
    if (!proposalId && !marked) {
      proposalId = report.evidence_refs
        .filter((ref) => ref.startsWith("report:"))
        .map((ref) => ref.slice("report:".length))
        .find(termed) ?? null;
    }
    let proposal: NoteProposalData | null = null;
    let unreadable: string | null = null;
    if (proposalId) {
      try {
        proposal = this.noteProposalData(workspaceId, proposalId, sessions);
      } catch (error) {
        if (!(error instanceof CollabError)) throw error;
        unreadable = error.code;
      }
    }
    let restsOn: ProposalPersonAct | null = null;
    if (proposal && marked) {
      // What decisionAuthority read inside the write: the person's latest act
      // on the proposal before this decision (for a proceed, the agreement).
      restsOn = proposal.status.person.acts.filter((act) => act.event_sequence < report.event_sequence).at(-1) ?? null;
    } else if (proposal) {
      const sequences = report.evidence_refs
        .filter((ref) => ref.startsWith("event:"))
        .map((ref) => this.db.query(`SELECT sequence, type, entity_id FROM events WHERE workspace_id = ? AND id = ?`)
          .get(workspaceId, ref.slice("event:".length)) as { sequence: number; type: string; entity_id: string } | null)
        .filter((row): row is { sequence: number; type: string; entity_id: string } =>
          row !== null && (row.type === "proposal.agreed" || row.type === "proposal.rejected") && row.entity_id === proposalId)
        .map((row) => row.sequence);
      const cited = Math.max(-1, ...sequences);
      restsOn = proposal.status.person.acts.find((act) => act.event_sequence === cited) ?? null;
    }
    const latest = proposal?.status.person.acts.at(-1) ?? null;
    const after = restsOn && proposal ? proposal.status.person.acts.filter((act) => act.event_sequence > restsOn!.event_sequence) : [];
    const laterAct = after.find((act) => act.act === "reject") ?? after.at(-1) ?? null;
    const outcome: NoteDecisionData["outcome"] = !marked
      ? "unstated"
      : report.authority_basis?.startsWith("do_not_proceed: ") ? "do_not_proceed"
        : report.authority_basis?.startsWith("no_decision: ") ? "no_decision" : "proceed";
    // Only a decision that may rest on an agreement can lose it: one that
    // authorises nothing rests on none, whatever the person did before it.
    const agreementCurrent = restsOn?.act === "agree" && (outcome === "proceed" || outcome === "unstated")
      ? proposal!.status.may_proceed && proposal!.status.agreement?.id === restsOn.id
      : null;
    const byId = new Map(sessions.map((view) => [view.id, view]));
    const context = this.proposalReadContext(workspaceId);
    const activeVoices = new Set(sessions.filter((view) => view.status === "active").map((view) => view.voice_id));
    const challengeViews = this.noteChallenges(workspaceId).filter((challenge) => challenge.target_report_id === report.id);
    const challenges = challengeViews.map((challenge) => this.noteStanceView(
      workspaceId,
      this.requireReport(challenge.id),
      challenge.from_session_id ? byId.get(challenge.from_session_id) ?? null : null,
      report.from_session_id ? byId.get(report.from_session_id) ?? null : null,
      context,
      {
        counted: false,
        standing: challenge.standing,
        answered_by_another_voice: challenge.answered_by_another_voice,
        opened_at: null,
        active_voices: activeVoices,
      },
    ));
    return {
      report,
      marked,
      outcome,
      authority: {
        scope: report.authority_scope,
        basis: report.authority_basis,
        derived_by_server: marked,
        on_proposal: proposalId !== null,
      },
      proposal,
      proposal_unreadable: unreadable,
      rests_on: restsOn ? { ...restsOn, event_id: this.eventIdAt(workspaceId, restsOn.event_sequence) } : null,
      agreement_current: agreementCurrent,
      // The act that undid what this decision rests on is the first rejection
      // after it; the person may have acted again since (latest_act).
      later_act: laterAct,
      latest_act: latest && restsOn && latest.id !== restsOn.id && latest.id !== laterAct?.id ? latest : null,
      challenges,
    };
  }

  /** Whether a report was posted with the collab-note/1 marker (spec 4). */
  private reportIsMarked(workspaceId: string, report: CollabReport): boolean {
    return this.reportPayload(workspaceId, report).note === NOTE_FORMAT;
  }

  private reportPayload(workspaceId: string, report: CollabReport): Record<string, unknown> {
    const row = this.db.query(`SELECT payload_json FROM events WHERE workspace_id = ? AND sequence = ?`)
      .get(workspaceId, report.event_sequence) as { payload_json: string } | null;
    return row ? JSON.parse(row.payload_json) as Record<string, unknown> : {};
  }

  private eventIdAt(workspaceId: string, sequence: number): string {
    const row = this.db.query(`SELECT id FROM events WHERE workspace_id = ? AND sequence = ?`)
      .get(workspaceId, sequence) as { id: string } | null;
    if (!row) throw new CollabError("event_not_found", `No event at sequence ${sequence}`);
    return row.id;
  }
}

// ---------------------------------------------------------------------------
// Collab Notes types and helpers (spec sections 5 and 8)

/** The kinds a short handle names (spec 5): proposals and ballots are reports. */
export type NoteEntityKind = "report" | "proposal" | "ballot" | "task";

/** A coordination session as the notes surface shows it; every field but the id is self-declared or derived. */
export interface NoteSessionView {
  id: string;
  workspace_id: string;
  worktree_id: string;
  actor: string;
  role: string | null;
  /** The latest purpose.declared, else the role. */
  purpose: string | null;
  model: string | null;
  seat_ref: string | null;
  voice_id: string;
  parent_session_id: string | null;
  status: "active" | "ended";
  joined_at: string;
  last_seen_at: string;
  liveness: SessionLiveness;
}

export interface NotePurposeReceipt {
  session_id: string;
  purpose: string;
  event_id: string;
  sequence: number;
  declared_at: string;
}

export type NoteWhyYou =
  | "addressed"
  | "reply_to_you"
  | "about_your_proposal"
  | "handoff_offered"
  | "answer_to_your_handoff"
  | "review_requested"
  | "verdict_on_your_work"
  | "your_lease_recovered"
  | "voice_awaited"
  | "person_act"
  | "in_electorate"
  | "ballot_closed";

/** One event as collab_inbox returns it, with the report, proposal or task it concerns. */
export interface NoteEntry {
  event: CollabEvent;
  for_me: boolean;
  why_you: NoteWhyYou | null;
  report: CollabReport | null;
  /** The report.posted payload carries the collab-note/1 marker, so its body is read as a note. */
  marked: boolean;
  /** For a marked note, its own evidence.cited event: how each outside item on its Evidence lines was observed. */
  cited: {
    event_id: string;
    by_session_id: string | null;
    worktree_id: string | null;
    items: NoteCitedItem[];
  } | null;
  /** Every evidence.cited event among the report's evidence refs that its own author recorded (a review's cite step, say). */
  author_cites: Array<NonNullable<NoteEntry["cited"]>>;
  /** The report is a consent/v1 proposal. */
  termed: boolean;
  to_person: boolean;
  task: { id: string; title: string } | null;
  /** For a ballot event or a poll report: the ballot as this session sees it. */
  ballot: NoteBallotData | null;
  /** The note sits in an open ballot's thread and this session's unit has not cast (spec 5.2): shown without text. */
  folded: { ballot_id: string } | null;
  /**
   * In a look-back only: addressed to an ended session that carried this
   * session's name (`why_you` is then judged for that session). Names are
   * self-declared, so this is routing for reading, not identity.
   */
  for_name: { session_id: string } | null;
  /**
   * A review's report: the verdict the review event recorded beside it. Its
   * stored relation stays supports or challenges; views show the verdict.
   */
  verdict: "accept" | "request_changes" | null;
}

export interface NoteChallengeView {
  id: string;
  target_report_id: string;
  from_session_id: string | null;
  from_actor: string;
  created_at: string;
  standing: boolean;
  /** A `resolves` from another voice exists; on this view it lifts nothing. */
  answered_by_another_voice: boolean;
}

export interface NoteWaitingEntry {
  what: "review" | "voice" | "vote" | "challenge" | "answer" | "stop" | "rejected" | "record_decision";
  /** The entity the next call takes. */
  ref_kind: "task" | "proposal" | "report" | "ballot";
  ref_id: string;
  /** The completion to review, the challenged report, your challenge, or the person act. */
  about_id: string | null;
  /** A session's name, or for a person act how it reached the journal. */
  by: string;
  by_session_id: string | null;
  due: string | null;
  at: string;
  summary: string;
}

/** The kinds of outside evidence an evidence.cited event records (spec 5.3); journal refs go into evidence_refs. */
export const NOTE_OUTSIDE_EVIDENCE_KINDS = ["file", "commit", "test", "url", "data", "msg"] as const;

export type NoteOutsideEvidenceKind = (typeof NOTE_OUTSIDE_EVIDENCE_KINDS)[number];

/** One item of an evidence.cited event (spec 8.2). Contents are never stored, only pointers and hashes. */
export interface NoteCitedItem {
  /** The 1-based position in the citing note's Evidence list, which its Why cites count. */
  n: number;
  kind: NoteOutsideEvidenceKind;
  /** The path (without a line range), sha, command, url, label or "channel id". */
  locator: string;
  /** For a file: the server's hash of the whole file. For data: the hash the caller wrote. */
  sha256?: string;
  /** For a test: the exit status the caller reported. */
  exit?: number;
  /** For a file: the cited line range, a or a-b. */
  lines?: string;
  /** server: read or checked by collab; caller: as the caller wrote it, unchecked; not_found: a commit git does not have. */
  observed: "server" | "caller" | "not_found";
}

export interface NoteCiteReceipt {
  cite_id: string;
  event_id: string;
  sequence: number;
  worktree_id: string | null;
  items: NoteCitedItem[];
}

/** One report a note posts through appendNoteForSession; every one carries the note marker. */
export interface NoteReportInput {
  kind: "observation" | "inference";
  relation: "informs" | "supports" | "challenges" | "resolves" | "withdraws";
  body: string;
  task_id?: string | null;
  to_session_id?: string | null;
  to_person?: boolean;
  target_report_id?: string | null;
  about_proposal_id?: string | null;
  evidence_refs?: string[];
  /** Also cite this call's evidence.cited event. */
  cite_event?: boolean;
  /** Also cite the reports this call posted before this one, by index. */
  cite_earlier?: number[];
}

export interface NoteAppendReceipt {
  reports: CollabReport[];
  cite: NoteCiteReceipt | null;
}

/** A note's target as the verbs read it before writing (spec 5.3). */
export interface NoteTargetView {
  report: CollabReport;
  termed: boolean;
  ballot: { open: boolean } | null;
  /** A withdraw, correct or supersede retired it. */
  obsoleted: boolean;
  /** The task it reports complete, when it is a completion report. */
  completion_of: { task_id: string; current: boolean; pending_review: boolean } | null;
  /** Every challenge aimed at it, standing or not, in journal order. */
  challenges: NoteChallengeView[];
  author: {
    id: string;
    actor: string;
    status: "active" | "ended";
    liveness: SessionLiveness;
    last_seen_at: string;
    voice_id: string;
  } | null;
}

interface NormalizedNoteCite {
  worktree_id: string | null;
  items: NoteCitedItem[];
}

interface NormalizedNoteReport {
  kind: "observation" | "inference";
  relation: NoteReportInput["relation"];
  body: string;
  task_id: string | null;
  to_session_id: string | null;
  to_person: boolean;
  target_report_id: string | null;
  about_proposal_id: string | null;
  evidence_refs: string[];
  cite_event: boolean;
  cite_earlier: number[];
}

const NOTE_CITE_LOCATOR_MAX = 1_000;

function normalizeNoteCite(cite: { worktree_id: string | null; items: NoteCitedItem[] }): NormalizedNoteCite {
  if (!Array.isArray(cite.items) || cite.items.length > 16) {
    throw new CollabError("invalid_evidence", "A note cites at most 16 evidence items");
  }
  const seen = new Set<number>();
  const items = cite.items.map((item): NoteCitedItem => {
    if (!item || typeof item !== "object") throw new CollabError("invalid_evidence", "A cited item is an object");
    if (!Number.isInteger(item.n) || item.n < 1 || item.n > 16 || seen.has(item.n)) {
      throw new CollabError("invalid_evidence", "A cited item's n is its distinct 1-based Evidence position");
    }
    seen.add(item.n);
    if (!(NOTE_OUTSIDE_EVIDENCE_KINDS as readonly string[]).includes(item.kind)) {
      throw new CollabError("invalid_evidence", `A cited item's kind is one of ${NOTE_OUTSIDE_EVIDENCE_KINDS.join(", ")}`);
    }
    const locator = cleanText(typeof item.locator === "string" ? item.locator : "", "evidence", NOTE_CITE_LOCATOR_MAX);
    if (/[\u0000-\u001f\u007f]/.test(locator) || hasLoneSurrogate(locator)) {
      throw new CollabError("invalid_evidence", "A cited locator is one line of well-formed text");
    }
    if (!["server", "caller", "not_found"].includes(item.observed)) {
      throw new CollabError("invalid_evidence", "A cited item is observed by the server or the caller, or not found");
    }
    if (item.observed === "not_found" && item.kind !== "commit") {
      throw new CollabError("invalid_evidence", "Only a commit can be cited as not found");
    }
    if (item.observed === "server" && item.kind !== "file" && item.kind !== "commit") {
      throw new CollabError("invalid_evidence", "The server observes only files and commits");
    }
    if (item.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(item.sha256)) {
      throw new CollabError("invalid_evidence", "A cited sha256 is 64 lower-case hex digits");
    }
    if (item.kind === "file" && item.observed === "server" && item.sha256 === undefined) {
      throw new CollabError("invalid_evidence", "A server-observed file carries the server's hash");
    }
    if (item.exit !== undefined && !Number.isSafeInteger(item.exit)) {
      throw new CollabError("invalid_evidence", "A cited exit status is an integer");
    }
    if (item.lines !== undefined && !/^\d{1,9}(?:-\d{1,9})?$/.test(item.lines)) {
      throw new CollabError("invalid_evidence", "A cited line range is a or a-b");
    }
    // Present only when set, so the payload carries no undefined.
    return {
      n: item.n,
      kind: item.kind,
      locator,
      ...(item.sha256 !== undefined ? { sha256: item.sha256 } : {}),
      ...(item.exit !== undefined ? { exit: item.exit } : {}),
      ...(item.lines !== undefined ? { lines: item.lines } : {}),
      observed: item.observed,
    };
  });
  return {
    worktree_id: cite.worktree_id === null ? null : validateId(cite.worktree_id, "worktree_id"),
    items,
  };
}

function normalizeNoteReport(report: NoteReportInput, index: number): NormalizedNoteReport {
  if (report.kind !== "observation" && report.kind !== "inference") {
    throw new CollabError("invalid_report_kind", "A note is an observation or an inference");
  }
  if (!["informs", "supports", "challenges", "resolves", "withdraws"].includes(report.relation)) {
    throw new CollabError("invalid_report_relation", "A note never corrects or supersedes");
  }
  const earlier = report.cite_earlier ?? [];
  if (!Array.isArray(earlier) || earlier.some((at) => !Number.isInteger(at) || at < 0 || at >= index)) {
    throw new CollabError("invalid_note_reports", "cite_earlier names reports this call posted before this one");
  }
  return {
    kind: report.kind,
    relation: report.relation,
    body: cleanText(report.body, "body", MAX_REPORT_BODY),
    task_id: report.task_id ? validateId(report.task_id, "task_id") : null,
    to_session_id: report.to_session_id ? validateId(report.to_session_id, "to_session_id") : null,
    to_person: report.to_person === true,
    target_report_id: report.target_report_id ? validateId(report.target_report_id, "target_report_id") : null,
    about_proposal_id: report.about_proposal_id ? validateId(report.about_proposal_id, "about_proposal_id") : null,
    evidence_refs: normalizeEvidenceRefs(report.evidence_refs ?? []),
    cite_event: report.cite_event === true,
    cite_earlier: [...earlier],
  };
}

export interface NoteInboxData {
  session: NoteSessionView;
  sessions: NoteSessionView[];
  entries: NoteEntry[];
  also_new: number;
  more: boolean;
  /**
   * Every for-me event after the mark within the scan bound, listed or not;
   * a lower bound when `for_me_total_capped` (the scan stopped at its bound).
   */
  for_me_total: number;
  for_me_total_capped: boolean;
  mark: {
    before: number;
    through: number;
    anchor: EventCursor;
    initialised_from: "cursor" | null;
    clamped: boolean;
    written: boolean;
  };
  head_sequence: number;
  waiting: NoteWaitingEntry[];
  /** Reveals the housekeeping tried and could not finish (spec 7); empty for a peek. */
  reveal_pending: NoteRevealOutcome["pending"];
  /** The store's clock when this was read. */
  observed_at: string;
  /** A look-back (collab_inbox since): the sequences it read after and through. The mark did not move. */
  looked_back?: { after: number; through: number };
  /**
   * A look-back or a pass with include: "all": events within what was read
   * that are not lines of their own, so the listing is not taken as the
   * whole journal. attached: cited evidence and attached artifacts;
   * duplicates: a second line of a proposal, ballot, completion or verdict.
   */
  not_listed?: { attached: number; duplicates: number };
}

export interface NoteThreadData {
  kind: "report" | "task";
  session: NoteSessionView;
  sessions: NoteSessionView[];
  root: NoteEntry | null;
  answers: NoteEntry[];
  truncated: boolean;
  task: Task | null;
  reviews: TaskReview[];
  challenges: NoteChallengeView[];
  termed: boolean;
  /** For a proposal root: its unchanged status and the display-only facts beside it. */
  proposal: NoteProposalData | null;
  /** For a decision root: the composed record. */
  decision: NoteDecisionData | null;
  /** For a ballot root (a poll report): its terms, turnout and, once revealed, the result. */
  ballot: NoteBallotData | null;
  /** How many answers are folded for this session (spec 5.2). */
  folded: number;
  /** What the housekeeping did to the read mark: created it from the legacy cursor, or clamped it to the head. */
  mark: { initialised_from: "cursor" | null; clamped: boolean };
  /** Reveals the housekeeping tried and could not finish; each stays sealed and is tried again. */
  reveal_pending: NoteRevealOutcome["pending"];
  observed_at: string;
}

export const NOTE_DECISION_OUTCOMES = ["proceed", "do_not_proceed", "no_decision"] as const;

export type NoteDecisionOutcome = (typeof NOTE_DECISION_OUTCOMES)[number];

/** The scope of a decision that authorises nothing (do_not_proceed, no_decision). */
export const NOTE_NOTHING_AUTHORISED = "nothing is authorised";

/** A decision without a proposal covers this by default (spec 5.3). */
export const NOTE_DEFAULT_DECISION_EXTENT = "work this session already holds";

export const NOTE_SELF_DECISION_BASIS = "recorded by this session; not a direction decision and not the person's agreement";

/** What appendDecisionForSession recorded and what its authority was derived from. */
export interface NoteDecisionReceipt {
  report: CollabReport;
  cite: NoteCiteReceipt | null;
  outcome: NoteDecisionOutcome;
  proposal: {
    id: string;
    proposal_sha256: string;
    position: ProposalStatus["ai"]["position"];
    person: ProposalStatus["person"]["state"];
    may_proceed: boolean;
    extent: string;
    author_session_id: string | null;
  } | null;
  /** For proceed: the agreement it rests on. Otherwise the person's latest act, if any. */
  person_act: {
    id: string;
    event_id: string;
    act: "agree" | "reject";
    basis: PersonActBasis;
    at: string;
    reason: string | null;
  } | null;
  authority_scope: string;
  authority_basis: string;
}

/** A support or challenge as the notes surface shows it; its flags are display only (spec 6). */
export interface NoteStanceView {
  id: string;
  relation: "supports" | "challenges";
  from_session_id: string | null;
  from_actor: string;
  voice_id: string | null;
  /** Some active session still speaks for this voice. */
  voice_has_active_session: boolean;
  /** The session that wrote it has ended (only it could withdraw it). */
  from_session_ended: boolean;
  created_at: string;
  statement: string;
  marked: boolean;
  /** How `ungrounded` was judged: a marked note's Why and Evidence lines, or a legacy report's fields. */
  grounded_by: "note" | "fields";
  /** consent/v1 counts it: a qualifying support, or a standing challenge. */
  counted: boolean;
  standing: boolean;
  flags: {
    by_author?: true;
    same_seat_as_author?: true;
    same_name_as_author?: true;
    started_after_open?: true;
    ungrounded?: true;
    challenger_ended?: true;
    answered_by_another_voice?: true;
  };
}

/** A voice the proposal's snapshot consulted, other than the author's. */
export interface NoteConsultedVoice {
  voice_id: string;
  name: string;
  session_ids: string[];
  last_seen_at: string | null;
  awaited: boolean;
  supported: boolean;
  challenged: boolean;
  /** collab_arrive or collab_inbox returned the proposal to one of its sessions (note_shown). */
  delivery_recorded: boolean;
  /** Every session of this voice has ended, so none can speak for it now. */
  ended: boolean;
}

export interface NoteCarriedObjection {
  challenge_id: string;
  /** The proposal the challenge was raised on: the replaced one, or one it replaced in turn. */
  raised_on: string;
  by_session_id: string | null;
  by: string;
  voice_id: string | null;
  /** Its id is in the new proposal's known_conflicts, which the person signs. */
  carried_in_terms: boolean;
  /** The challenge still stands where it was raised: its challenger has not lifted or withdrawn it. */
  standing_on_replaced: boolean;
  /** The challenge's own statement, read from the journal. */
  statement: string;
  /** The same voice stands against the new proposal too. */
  re_raised_here: boolean;
}

export interface NoteProposalData {
  /** Exactly what collab_proposal_status returns. */
  status: ProposalStatus;
  author: NoteSessionView | null;
  lone: boolean;
  supports: NoteStanceView[];
  challenges: NoteStanceView[];
  consulted: NoteConsultedVoice[];
  replaced: { proposal_id: string; carried: NoteCarriedObjection[] } | null;
  observed_at: string;
}

export interface NoteDecisionData {
  report: CollabReport;
  marked: boolean;
  /** As this surface recorded it; "unstated" for a decision a legacy tool wrote. */
  outcome: NoteDecisionOutcome | "unstated";
  /**
   * derived_by_server: written by this surface, which fixed the basis.
   * on_proposal: made on a proposal, so the scope too was derived from the
   * journal; without one the scope is the session's own words.
   */
  authority: { scope: string | null; basis: string | null; derived_by_server: boolean; on_proposal: boolean };
  proposal: NoteProposalData | null;
  /** The proposal's stored terms failed to read (their code), so no proposal is shown. */
  proposal_unreadable: string | null;
  /**
   * The person act the decision was made on: for a marked decision, the
   * person's latest act on its proposal before it; for a legacy one, the act
   * its evidence refs cite.
   */
  rests_on: (ProposalPersonAct & { event_id: string }) | null;
  /** For an agreement: whether it is still the person's latest act on a proposal still on the table. */
  agreement_current: boolean | null;
  /**
   * The act after the one the decision rests on that undid it: the first
   * rejection after it, else the latest act after it.
   */
  later_act: ProposalPersonAct | null;
  /** The person's latest act, when it is neither the one rested on nor later_act (an agreement given again, say). */
  latest_act: ProposalPersonAct | null;
  /** Challenges to the decision itself. */
  challenges: NoteStanceView[];
}

export interface NoteArrivalData {
  session: NoteSessionView;
  workspace: Workspace;
  sessions: NoteSessionView[];
  tasks: Task[];
  claimable_task_ids: string[];
  proposals: ProposalStatus[];
  challenges: NoteChallengeView[];
  report_count: number;
  waiting: NoteWaitingEntry[];
  ballots: NoteBallotData[];
  observed_at: string;
}

/** What lies behind a session that has just arrived (noteArrivalBehind). */
export interface NoteArrivalBehind {
  /** This session's session.joined; null only for a journal that lost it. */
  joined_sequence: number | null;
  /** Every event before this session joined, the workspace's own opening included. */
  events_before: number;
  /** How many of those another session wrote: zero means nobody was here before. */
  by_other_sessions_before: number;
  /** Items addressed to ended sessions that carried this session's name (a self-declared name: routing, not identity). */
  for_name: { count: number; earliest_sequence: number | null; at_least: boolean; sessions: number };
}

/** The event types eventAddressesSession can route to a session; every other type routes to no one. */
const NOTE_ADDRESSING_EVENT_TYPES = [
  "report.posted",
  "handoff.offered",
  "handoff.accepted",
  "handoff.declined",
  "handoff.expired",
  "task.reported_complete",
  "task.accepted",
  "task.changes_requested",
  "task.recovered",
  "proposal.opened",
  "proposal.agreed",
  "proposal.rejected",
  "ballot.opened",
  "ballot.closed",
] as const;

/** spec 7: the default electorate is the sessions seen within the last 30 minutes. */
const BALLOT_RECENT_MS = 30 * 60_000;

/** ballot.opened lists at most this many left-out sessions, with the total. */
const BALLOT_LEFT_OUT_MAX = 50;

const BALLOT_MAX_CASTS = MAX_CASTS_PER_SESSION;

/** A poll's input with absent fields dropped, as its receipt's request. */
function definedPollInput(poll: PollTermsInput): PollTermsInput {
  return Object.fromEntries(Object.entries(poll ?? {}).filter(([, value]) => value !== undefined)) as PollTermsInput;
}

export interface NoteBallotOpenReceipt {
  ballot_id: string;
  report: CollabReport;
  event_id: string;
  sequence: number;
  terms: BallotTerms;
  electorate: ElectorateUnit[];
  electorate_sha256: string;
  left_out: LeftOutSession[];
  left_out_total: number;
  chosen_by: "default" | "opener";
  advice: string[];
}

/** What a cast recorded: ids and the commitment, never the vote. */
export interface NoteBallotCastReceipt {
  ballot_id: string;
  cast_id: string;
  cast_seq: number;
  commitment: string;
  unit_id: string;
  counts_as: "counted" | "late";
  same_handle_as?: string;
  closes_at: string;
  event_id: string;
  sequence: number;
  cast_at: string;
  /** Another lineage of this unit cast too; if both stand, neither is counted. */
  unit_mate_cast: boolean;
  /** close_when_all_cast was set and this cast completed the electorate. */
  closes_now: boolean;
}

export interface NoteRevealOutcome {
  revealed: string[];
  /** Reveals that failed and stay sealed until the next call; ballot_id null when the attempt failed before reaching one. */
  pending: Array<{ ballot_id: string | null; code: string }>;
}

export interface NoteBallotCast {
  cast_id: string;
  unit_id: string;
  session_id: string;
  commitment: string;
  cast_seq: number;
  event_id: string;
  sequence: number;
  at: string;
}

export interface NoteBallotFacts {
  ballot_id: string;
  workspace_id: string;
  opener_session_id: string;
  opened_at: string;
  opened_sequence: number;
  terms: BallotTerms;
  units: ElectorateUnit[];
  electorate_sha256: string;
  chosen_by: "default" | "opener";
  left_out: LeftOutSession[];
  left_out_total: number;
  casts: NoteBallotCast[];
  /** Electorate units with at least one cast. Turnout and timing are visible (spec 7, sealing). */
  cast_unit_ids: string[];
  /** The cast that completed the electorate, when every unit has cast. */
  all_cast_sequence: number | null;
  /** The opener's withdrawal, when it came before the close. */
  withdrawn: { report_id: string; sequence: number; at: string } | null;
  closed_by: "time" | "all_cast" | null;
  /** open; withdrawn (sealed until its original close); closed (due a reveal); revealed. */
  state: "open" | "withdrawn" | "closed" | "revealed";
  revealed: RevealedEntry[] | null;
  closed: { event_id: string; sequence: number; at: string; entry_count: number; entries_sha256: string } | null;
  observed_at: string;
}

/** One session's place in a ballot. */
export interface NoteBallotViewer {
  session_id: string;
  unit_id: string;
  counts_as: "counted" | "late";
  same_handle_as?: string;
  in_electorate: boolean;
  /** For a listed unit, whether any of its lineages has cast; otherwise whether this session has. */
  unit_has_cast: boolean;
  your_casts: number;
  may_vote: boolean;
}

export interface NoteBallotData extends NoteBallotFacts {
  opener_name: string;
  turnout: { cast: number; electorate: number };
  viewer: NoteBallotViewer | null;
  unit_basis: string;
  sealing: string;
  /** Computed on read once revealed; never stored. */
  result: BallotResult | null;
}

interface NoteMarkState {
  sequence: number;
  initialised_from: "cursor" | null;
  clamped: boolean;
  stored: boolean;
}

interface NoteProposalRow {
  report_id: string;
  from_session_id: string | null;
  closes_at: string;
  /** The voices of the snapshot taken at open, author included. */
  voice_ids: string[];
  retired: boolean;
  /** Some `supports` targets it (a superset of the supports that count). */
  supported: boolean;
  acted: boolean;
}

interface NoteScannedEvent {
  sequence: number;
  type: CollabEventType;
  own: boolean;
  for_me: boolean;
  /** In a look-back: the ended session carrying the reader's name that this event is addressed to. */
  for_name: string | null;
  /**
   * The report this event is one line of (a proposal or ballot it opened,
   * a completion or verdict its task event records), so a listing can show
   * each once; null for an event that stands alone.
   */
  thing: string | null;
  /** Cited evidence or an attached artifact: detail of a report or task, never a line of its own in a listing. */
  attached: boolean;
  shown_item_id: string | null;
}

/** spec 5.2: one inbox scan covers at most 2,000 events or 8 MiB. */
export const NOTE_SCAN_MAX_EVENTS = 2_000;

export const NOTE_SCAN_MAX_BYTES = 8 * 1024 * 1024;

export const NOTE_INBOX_MAX_LIMIT = 50;

/** A thread view lists at most this many answers, and says when it stopped. */
export const NOTE_THREAD_MAX = 200;

const NOTE_PURPOSE_MAX_CHARS = 200;

/** spec 8.3: every new payload stays within 64 KiB of canonical UTF-8. */
const NOTE_PAYLOAD_MAX_BYTES = 64 * 1024;

/**
 * The report an event is one line of, for a listing that shows each thing
 * once: a report itself; the proposal or ballot an opening event opened (its
 * entity is that report); the completion a task.reported_complete records;
 * the review report a verdict event records. Null for anything else.
 */
function noteThingOf(event: CollabEvent): string | null {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case "report.posted":
    case "proposal.opened":
    case "ballot.opened":
      return `report:${event.entity_id}`;
    case "task.reported_complete":
      return typeof payload.completion_report_id === "string" ? `report:${payload.completion_report_id}` : null;
    case "task.accepted":
    case "task.changes_requested":
      return typeof payload.review_report_id === "string" ? `report:${payload.review_report_id}` : null;
    default:
      return null;
  }
}

/** What a listing leaves out so it reads one line per thing. */
interface NoteLines {
  lines: NoteScannedEvent[];
  /** Each candidate not listed, and why: detail attached to a report or task, or a second line of a thing listed once. */
  dropped: Array<{ sequence: number; why: "attached" | "duplicate" }>;
}

/**
 * One line per thing a reader would call one thing (a look-back, or a pass
 * with include: "all"): cited evidence and attached artifacts are left out,
 * since they are detail of the report or task beside them, and a report is
 * merged with the event that opened it as a proposal or ballot, or with the
 * task event recording it as a completion or verdict. The line kept is one
 * addressed to the reader if there is one, then one addressed to its name,
 * then the earliest. With keepEveryForMe (a pass), no line addressed to the
 * reader is ever dropped, so a pass shows all it showed before.
 */
function noteLines(candidates: NoteScannedEvent[], keepEveryForMe: boolean): NoteLines {
  const dropped: NoteLines["dropped"] = [];
  const rank = (event: NoteScannedEvent) => (event.for_me ? 2 : event.for_name !== null ? 1 : 0);
  const best = new Map<string, NoteScannedEvent>();
  for (const event of candidates) {
    if (event.attached && !event.for_me || event.thing === null) continue;
    const held = best.get(event.thing);
    if (!held || rank(event) > rank(held)) best.set(event.thing, event);
  }
  const lines = candidates.filter((event) => {
    if (event.attached && !event.for_me) {
      dropped.push({ sequence: event.sequence, why: "attached" });
      return false;
    }
    if (event.thing === null) return true;
    const keep = best.get(event.thing) === event || (keepEveryForMe && event.for_me);
    if (!keep) dropped.push({ sequence: event.sequence, why: "duplicate" });
    return keep;
  });
  return { lines, dropped };
}

/** The counts of what a listing left out, up to the sequence it read through. */
function notListed(dropped: NoteLines["dropped"], through: number): { attached: number; duplicates: number } {
  const within = dropped.filter((entry) => entry.sequence <= through);
  return {
    attached: within.filter((entry) => entry.why === "attached").length,
    duplicates: within.filter((entry) => entry.why === "duplicate").length,
  };
}

/** The item an inbox delivery records (spec 8.1 note_shown): a proposal, a ballot or a completion. */
function noteShownItem(event: CollabEvent): string | null {
  const payload = event.payload as Record<string, unknown>;
  if (event.type === "proposal.opened" || event.type === "ballot.opened") return event.entity_id;
  if (event.type === "task.reported_complete" && typeof payload.completion_report_id === "string") {
    return payload.completion_report_id;
  }
  return null;
}

/** The questions a waiting list delivers (spec 8.1 note_shown): each awaited proposal, each ballot to vote in, and each completion to review. */
export function noteWaitingShownItems(waiting: readonly NoteWaitingEntry[]): string[] {
  return waiting.flatMap((entry) =>
    entry.what === "voice" || entry.what === "vote" ? [entry.ref_id]
      : entry.what === "review" && entry.about_id ? [entry.about_id] : []);
}

/**
 * Run a notes read that follows a committed housekeeping transaction. A
 * refusal raised here comes after the mark, last-seen time and delivery
 * records were written, so it is marked `after_housekeeping` and its remedy
 * never says that nothing was written.
 */
function afterHousekeeping<T>(committed: boolean, read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (!committed || !(error instanceof CollabError) || error.details.after_housekeeping !== undefined) throw error;
    throw new CollabError(error.code, error.message, { ...error.details, after_housekeeping: true });
  }
}

function validateNotePurpose(value: string): string {
  const purpose = cleanText(typeof value === "string" ? value : "", "purpose", NOTE_PURPOSE_MAX_CHARS);
  if (/[\u0000-\u001f\u007f]/.test(purpose)) {
    throw new CollabError("invalid_purpose", "purpose must be one line of text");
  }
  // bun:sqlite would not keep half a character as given, so the stored
  // purpose and the returned one would differ.
  if (hasLoneSurrogate(purpose)) {
    throw new CollabError("invalid_purpose", "purpose must be well-formed Unicode text (it holds half of a character)");
  }
  return purpose;
}

/**
 * spec 8.3: a new payload is at most 64 KiB of canonical UTF-8, holds no
 * integer-like object key (JSON object order would differ between
 * builds), no non-integer number and no undefined.
 */
export function assertNotePayload(payload: Record<string, unknown>): void {
  const visit = (value: unknown, path: string): void => {
    if (value === undefined) throw new CollabError("invalid_payload", `${path} is undefined`);
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
      throw new CollabError("invalid_payload", `${path} is not an integer`);
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
    } else if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (/^(0|[1-9]\d*)$/.test(key)) throw new CollabError("invalid_payload", `${path} has an integer-like key`);
        visit(child, `${path}.${key}`);
      }
    }
  };
  visit(payload, "payload");
  if (Buffer.byteLength(canonicalJson(payload), "utf8") > NOTE_PAYLOAD_MAX_BYTES) {
    throw new CollabError("too_long", "The record exceeds 64 KiB", { field: "payload", max: NOTE_PAYLOAD_MAX_BYTES, unit: "bytes" });
  }
}

/** A handle's hex as the start of a uuid (8-4-4-4-12), so it can bound a key range. */
function uuidPrefix(hex: string): string {
  const groups = [8, 4, 4, 4, 12];
  let out = "";
  let rest = hex;
  for (const size of groups) {
    if (!rest) break;
    out += out ? `-${rest.slice(0, size)}` : rest.slice(0, size);
    rest = rest.slice(size);
  }
  return out;
}

function firstLine(text: string): string {
  const line = (text.split("\n")[0] ?? "").replace(/\r$/, "");
  if (line.length <= 200) return line;
  // Cut between characters: half of an emoji makes the summary unrenderable as a note.
  const end = /[\uD800-\uDBFF]$/.test(line.slice(0, 199)) ? 198 : 199;
  return `${line.slice(0, end)}…`;
}

export * from "./store.js";
