/**
 * Collab Notes: collab_poll and collab_vote (spec 5.7, 5.8 and 7), the
 * sealed approval ballot. The arithmetic is ballot.ts and the journal side is
 * the store; this is the order the spec gives them. A vote's content goes to
 * its seal file and nowhere else: not into an event, a receipt, a key, an
 * advice line or the result returned to the voter.
 */
import { randomBytes, randomUUID } from "node:crypto";
import {
  ballotCommitment,
  checkVoteSize,
  nextCastSeq,
  openSeal,
  sameVoteInput,
  sealVote,
  validateVote,
  type BallotTerms,
  type ResolvedVoteEvidence,
} from "./ballot.js";
import { readSealFile, removeSealFile, writeSealFile } from "./ballot-seal.js";
import { CollabError } from "./errors.js";
import { NOTE_JOURNAL_EVIDENCE_KINDS, renderNote } from "./note.js";
import { resolveEvidence, stepOnce } from "./note-verbs.js";
import type { NoteBallotCastReceipt, NoteBallotData, NoteBallotOpenReceipt } from "./store.js";
import {
  ballotTermsView,
  ballotUnitView,
  exactRef,
  handleOf,
  noteWriteResult,
  NOTE_AUTHORISES,
  replayReceipt,
  requireCredential,
  revealDue,
  statementOf,
  underPlan,
  withSlot,
  type NoteBinding,
  type NoteVerbContext,
} from "./verbs.js";

// ---------------------------------------------------------------------------
// The poll note (spec 8.2: the poll report's body is the rendered poll note)

const POLL_STAND_IN_STATEMENT = "A sealed ballot; read its terms with collab_inbox about.";

/**
 * The poll report's body. The question's first line is the statement; the
 * whole question and the criteria go in the body as written, because a
 * trailer can hold neither a long question nor criteria with blank lines;
 * each option and the one-line terms are trailers. Rendering never fails:
 * terms a note cannot hold fall back to the trailers alone, which the
 * ballot.opened event repeats in full.
 */
export function pollNote(terms: BallotTerms): string {
  const first = terms.question.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
  const statement = first ? statementOf(first) : POLL_STAND_IN_STATEMENT;
  const parts: string[] = [];
  if (terms.question !== statement) parts.push(terms.question);
  if (terms.criteria !== undefined) parts.push(`Criteria:\n${terms.criteria}`);
  const trailers = [
    ...terms.options.map((option) => ({ key: "Option", value: `${option.key} — ${option.label}` })),
    ...(terms.pick !== undefined ? [{ key: "Pick", value: String(terms.pick) }] : []),
    { key: "Quorum", value: String(terms.quorum) },
    { key: "Closes", value: terms.close_when_all_cast ? `${terms.closes_at}, or when every unit has cast` : terms.closes_at },
  ];
  try {
    return renderNote({ act: "poll", statement, body: parts.length > 0 ? parts.join("\n\n") : null, trailers });
  } catch (error) {
    if (!(error instanceof CollabError)) throw error;
    return renderNote({ act: "poll", statement: POLL_STAND_IN_STATEMENT, trailers });
  }
}

// ---------------------------------------------------------------------------
// collab_poll (spec 5.7)

export interface PollInput {
  question?: unknown;
  options?: unknown;
  closes?: unknown;
  criteria?: unknown;
  pick?: unknown;
  quorum?: unknown;
  voters?: unknown;
  close_when_all_cast?: unknown;
}

const POLL_FIELDS = ["question", "options", "closes", "criteria", "pick", "quorum", "voters", "close_when_all_cast"] as const;

/** The poll as the caller sent it, absent fields dropped: what the store checks and the derived key hashes. */
function pollInput(input: PollInput): Record<string, unknown> {
  const poll: Record<string, unknown> = {};
  for (const field of POLL_FIELDS) {
    if (input[field] !== undefined && input[field] !== null) poll[field] = input[field];
  }
  return poll;
}

export async function pollVerb(ctx: NoteVerbContext, input: PollInput): Promise<Record<string, unknown>> {
  const { binding, credential } = requireCredential(ctx);
  const workspaceId = binding.handle.workspace.id;
  const pending = revealDue(ctx, workspaceId);
  if (ctx.store.journalRealpath() === null) {
    throw new CollabError("ballots_need_a_file_journal", "A sealed ballot keeps its seals beside the journal file; this store has none", {
      remedy: { say: "Open collab on a journal file, not an in-memory store, to poll; or say it with collab_note." },
    });
  }
  const poll = pollInput(input);
  const { plan, receipt, replayed } = await underPlan(ctx, credential, {
    tool: "collab_poll",
    input: poll,
    entity: "poll",
    // An earlier poll is current while it still stands: the same poll
    // opened again after a withdrawal is a new ballot.
    stillCurrent: (latestKey) => {
      const found = replayReceipt<NoteBallotOpenReceipt>(ctx.store, credential, latestKey);
      return !found || ctx.store.noteReportStands(workspaceId, found.ballot_id);
    },
  }, async (plan) => {
    const step = await stepOnce(ctx, credential, plan.key, () => ctx.store.openBallotForSession({
      ...credential,
      idempotency_key: plan.key,
      poll: poll as Parameters<typeof ctx.store.openBallotForSession>[0]["poll"],
      render: pollNote,
      receipt_plan: plan.guard,
    }));
    return { plan, receipt: step.value, replayed: step.replayed };
  });
  const view = ctx.store.noteBallotView(workspaceId, receipt.ballot_id, credential.session_id);
  const handle = handleOf("ballot", receipt.ballot_id);
  const advice = [...receipt.advice];
  if (plan.retry && replayed) {
    advice.push("This repeats your latest poll exactly, so it was read as a retry. Change a word of the question to open another.");
  }
  if (receipt.left_out_total > 0) {
    advice.push(`${receipt.left_out_total} live session(s) are left out of the electorate (left_out); their casts would be revealed and never counted.`);
  }
  advice.push("Do not announce the result yourself: it is computed at the close, and it authorises nothing.");
  return {
    ...noteWriteResult({
      effect:
        `Opened sealed ballot ${handle} for ${receipt.electorate.length} unit(s), closing ${receipt.terms.closes_at}` +
        `${receipt.terms.close_when_all_cast ? " or once every unit has cast" : ""}. No vote is shown before the close.`,
      ids: { ballot: receipt.ballot_id, ballot_handle: handle, report: receipt.report.id, event: receipt.event_id },
      advice,
      next: withSlot(ctx, { tool: "collab_inbox", input: { about: exactRef("ballot", receipt.ballot_id) } }),
      note: receipt.report.body,
      replayed,
    }),
    ballot: receipt.ballot_id,
    terms: ballotTermsView(receipt.terms),
    electorate: receipt.electorate.map(ballotUnitView),
    left_out: receipt.left_out,
    ...(receipt.left_out_total > receipt.left_out.length ? { left_out_total: receipt.left_out_total } : {}),
    chosen_by: receipt.chosen_by,
    closes_at: receipt.terms.closes_at,
    close_when_all_cast: receipt.terms.close_when_all_cast,
    quorum: receipt.terms.quorum,
    state: view.state,
    unit_basis: view.unit_basis,
    sealing: view.sealing,
    ...(pending ? { reveal_pending: pending } : {}),
  };
}

// ---------------------------------------------------------------------------
// collab_vote (spec 5.8, 7 "Sealing")

export interface VoteVerbInput {
  ballot?: unknown;
  choice?: unknown;
  why?: unknown;
  evidence?: unknown;
  shared?: unknown;
}

/**
 * A vote's evidence resolved now, as a note's is (spec 7 step 1): files
 * inside the worktree hashed by the server, commits checked with git,
 * journal handles named by full id. Each line is kept as the voter wrote it.
 * The advice names positions only, never a line, because it is returned
 * beside a sealed vote.
 */
function resolveVoteEvidence(ctx: NoteVerbContext, binding: NoteBinding, lines: string[]): {
  evidence: ResolvedVoteEvidence[];
  advice: string[];
} {
  if (lines.length === 0) return { evidence: [], advice: [] };
  let resolved;
  try {
    resolved = resolveEvidence(ctx, binding, lines);
  } catch (error) {
    if (!(error instanceof CollabError)) throw error;
    throw new CollabError(error.code, error.message, {
      ...error.details,
      remedy: { say: "Correct that evidence line and cast again; nothing was written and no seal was made." },
    });
  }
  const items = new Map(resolved.items.map((item) => [item.n, item]));
  const advice: string[] = [];
  const evidence = lines.map((line, index): ResolvedVoteEvidence => {
    const n = index + 1;
    const item = items.get(n);
    if (!item) {
      const ref = resolved.lines[index] ?? line;
      const colon = ref.indexOf(":");
      const kind = colon > 0 ? ref.slice(0, colon) : "report";
      return {
        text: line,
        ...((NOTE_JOURNAL_EVIDENCE_KINDS as readonly string[]).includes(kind) ? { kind, locator: ref.slice(colon + 1) } : {}),
        observed: "journal",
      };
    }
    if (item.kind === "file" && item.observed !== "server") {
      advice.push(`Evidence ${n} could not be hashed in your worktree, so it is sealed as you wrote it (observed: caller).`);
    } else if (item.kind === "commit" && item.observed === "not_found") {
      advice.push(`Evidence ${n}: git in your worktree has no such commit; it is sealed as not found.`);
    } else if (item.kind === "commit" && item.observed === "caller") {
      advice.push(`Evidence ${n}: the commit could not be checked here; it is sealed as you wrote it.`);
    }
    return {
      text: line,
      kind: item.kind,
      locator: item.locator,
      ...(item.lines ? { lines: item.lines } : {}),
      ...(item.sha256 ? { sha256: item.sha256 } : {}),
      ...(item.exit !== undefined ? { exit: item.exit } : {}),
      observed: item.observed,
      ...(item.kind === "file" && item.observed === "server" ? { worktree_id: binding.handle.worktree.id } : {}),
    };
  });
  return { evidence, advice };
}

function aboutBallot(ctx: NoteVerbContext, ballotId: string) {
  return withSlot(ctx, { tool: "collab_inbox", input: { about: exactRef("ballot", ballotId) } });
}

function closedRefusal(ctx: NoteVerbContext, ballot: NoteBallotData): CollabError {
  if (ballot.state === "withdrawn") {
    return new CollabError("ballot_withdrawn", "The opener withdrew this ballot; no cast is taken after a withdrawal, and nothing was written", {
      remedy: aboutBallot(ctx, ballot.ballot_id),
    });
  }
  return new CollabError("ballot_closed", `This ballot closed${ballot.closed_by === "all_cast" ? " when every unit had cast" : ` at ${ballot.terms.closes_at}`}; no cast is taken after the close, and nothing was written`, {
    closes_at: ballot.terms.closes_at,
    remedy: aboutBallot(ctx, ballot.ballot_id),
  });
}

export async function voteVerb(ctx: NoteVerbContext, input: VoteVerbInput): Promise<Record<string, unknown>> {
  const { binding, credential } = requireCredential(ctx);
  const workspaceId = binding.handle.workspace.id;
  const me = credential.session_id;
  const pending = revealDue(ctx, workspaceId);
  if (typeof input.ballot !== "string" || !input.ballot.trim()) {
    throw new CollabError("invalid_ballot", "ballot names the ballot to vote in", {
      remedy: { say: "Pass the ballot's id or ballot# handle, as collab_inbox lists it." },
    });
  }
  if (ctx.store.journalRealpath() === null) {
    throw new CollabError("ballots_need_a_file_journal", "A sealed ballot keeps its seals beside the journal file; this store has none");
  }
  const ballotId = ctx.store.resolveNoteRef(workspaceId, "ballot", input.ballot).id;
  const ballot = ctx.store.noteBallotView(workspaceId, ballotId, me);
  const handle = handleOf("ballot", ballotId);
  // 1. Validate, and resolve file and commit evidence now.
  const { vote, advice } = validateVote(
    { choice: input.choice, why: input.why, evidence: input.evidence, shared: input.shared },
    ballot.terms,
  );
  const resolved = resolveVoteEvidence(ctx, binding, vote.evidence.map((item) => typeof item === "string" ? item : item.text));
  advice.push(...resolved.advice);
  const model = ctx.store.resolveNoteSession(workspaceId, me, { include_ended: true }).model;
  const sealed = sealVote(vote, { evidence: resolved.evidence, model });

  // 2. A retry: this session's latest seal holds the same vote.
  const latest = ctx.store.latestBallotCastForSession(workspaceId, ballotId, me);
  if (latest) {
    const read = readSealFile(ctx.store.ballotSealPath(ballotId, latest.cast_id));
    const opened = read.state === "read"
      ? openSeal(read.value, latest, { workspace_id: workspaceId, ballot_id: ballotId })
      : null;
    if (opened?.state === "ok" && sameVoteInput(opened.vote, sealed)) {
      const earlier = replayReceipt<NoteBallotCastReceipt>(ctx.store, credential, `b1:${latest.cast_id}`);
      return voteResult(ctx, {
        handle,
        ballot,
        cast_seq: latest.cast_seq,
        commitment: latest.commitment,
        counts_as: earlier?.counts_as ?? ballot.viewer!.counts_as,
        same_handle_as: earlier?.same_handle_as,
        replayed: true,
        advice: ["Your latest sealed vote in this ballot is this same vote, so nothing new was cast."],
        pending,
      });
    }
  }

  if (ballot.state !== "open") throw closedRefusal(ctx, ballot);
  const viewer = ballot.viewer!;
  nextCastSeq(viewer.your_casts);
  if (viewer.counts_as === "late") {
    advice.push(
      "Your unit is not in this ballot's electorate, so this cast is revealed at the close and never counted (late)." +
        (viewer.same_handle_as ? ` Your declared handle matches unit ${viewer.same_handle_as}, which does not join you to it.` : ""),
    );
  }
  if (viewer.your_casts > 0) {
    advice.push("This replaces your earlier cast: only your latest counts, and a session may cast at most 3 times in one ballot.");
  }

  // 3. The seal file, before anything enters the journal.
  const castId = randomUUID();
  const salt = randomBytes(32).toString("hex");
  checkVoteSize(sealed, { ballot_id: ballotId, cast_id: castId, unit_id: viewer.unit_id, session_id: me });
  const commitment = ballotCommitment({
    workspace_id: workspaceId,
    ballot_id: ballotId,
    cast_id: castId,
    unit_id: viewer.unit_id,
    session_id: me,
    vote: sealed,
    salt,
  });
  const path = ctx.store.ballotSealPath(ballotId, castId);
  writeSealFile(path, {
    cast_id: castId,
    journal_realpath: ctx.store.journalRealpath()!,
    session_id: me,
    unit_id: viewer.unit_id,
    salt,
    vote: sealed,
  });

  // 4. The cast itself; a refused one leaves no seal behind.
  let receipt: NoteBallotCastReceipt;
  try {
    receipt = ctx.store.castBallotForSession({
      ...credential,
      ballot_id: ballotId,
      cast_id: castId,
      unit_id: viewer.unit_id,
      commitment,
    });
  } catch (error) {
    if (ctx.store.latestBallotCastForSession(workspaceId, ballotId, me)?.cast_id !== castId) removeSealFile(path);
    if (error instanceof CollabError && (error.code === "ballot_closed" || error.code === "ballot_withdrawn")) {
      throw closedRefusal(ctx, ctx.store.noteBallotView(workspaceId, ballotId, me));
    }
    throw error;
  }
  if (receipt.unit_mate_cast) {
    advice.push("Another lineage of your unit has cast in this ballot too. If both casts stand at the close, the unit is not counted (unit_conflict).");
  }
  let revealPending = pending;
  if (receipt.closes_now) {
    advice.push("Every unit has now cast and this ballot closes when that happens, so it is revealed now; read the result with collab_inbox about.");
    revealPending = revealDue(ctx, workspaceId) ?? pending;
  }
  return voteResult(ctx, {
    handle,
    ballot,
    cast_seq: receipt.cast_seq,
    commitment: receipt.commitment,
    counts_as: receipt.counts_as,
    same_handle_as: receipt.same_handle_as,
    replayed: false,
    advice,
    pending: revealPending,
  });
}

/** The vote's result: the receipt and nothing of the vote (spec 5.8). */
function voteResult(
  ctx: NoteVerbContext,
  options: {
    handle: string;
    ballot: NoteBallotData;
    cast_seq: number;
    commitment: string;
    counts_as: "counted" | "late";
    same_handle_as?: string;
    replayed: boolean;
    advice: string[];
    pending: string | null;
  },
): Record<string, unknown> {
  const effect = `Sealed vote recorded for ${options.handle} (cast ${options.cast_seq}).`;
  return {
    ok: true,
    effect: options.replayed ? `Replayed: nothing new was written. ${effect}` : effect,
    authorises: NOTE_AUTHORISES,
    ballot: options.ballot.ballot_id,
    ballot_handle: options.handle,
    cast_seq: options.cast_seq,
    commitment: options.commitment,
    counts_as: options.counts_as,
    ...(options.same_handle_as ? { same_handle_as: options.same_handle_as } : {}),
    closes_at: options.ballot.terms.closes_at,
    replayed: options.replayed,
    advice: options.advice,
    next: aboutBallot(ctx, options.ballot.ballot_id),
    ...(options.pending ? { reveal_pending: options.pending } : {}),
  };
}
