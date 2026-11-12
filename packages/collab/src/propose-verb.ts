/**
 * Collab Notes: collab_propose (spec 5.6). A thinner way to make the one
 * existing call, openProposalForSession. The question is stored verbatim
 * with no note marker, so a proposal's bytes, and its proposal_sha256, are
 * what collab_proposal_open makes from the same terms. What this verb adds
 * is bookkeeping: outside evidence cited in a step before the open, the
 * objections a replaced proposal still faced carried into the new terms as
 * text, and a note to each of those objectors who can still be reached.
 * consent/v1 itself is not touched: a carried objection does not block.
 */
import { CollabError } from "./errors.js";
import {
  hasLoneSurrogate,
  NOTE_EVIDENCE_MAX,
  NOTE_STATEMENT_MAX,
  normalizeNoteFields,
  normalizeNoteText,
  renderNote,
  splitNoteText,
  type NoteFields,
} from "./note.js";
import type { ProposalStatus } from "./protocol.js";
import type { NoteAppendReceipt, NoteCiteReceipt, NoteProposalData } from "./store.js";
import {
  beforeFirstWrite,
  evidenceSummary,
  recordedEvidence,
  refusedAfter,
  resolveEvidence,
  stepOnce,
  type Credential,
  type RecordedStep,
} from "./note-verbs.js";
import {
  CARRIED_OBJECTIONS_SENTENCE,
  exactRef,
  handleOf,
  minutesSince,
  noteWriteResult,
  proposalFacts,
  replayReceipt,
  requireCredential,
  statementOf,
  underPlan,
  withSlot,
  type NoteBinding,
  type NoteVerbContext,
} from "./verbs.js";

export interface ProposeInput {
  question: string;
  criteria: string;
  extent: string;
  closes?: number | string;
  conflicts?: string;
  evidence?: string[];
  limits?: string;
  topic?: string;
  replaces?: string;
}

// The caps the store applies to each term (normalizeProposalTerms); the
// question keeps collab_proposal_open's own cap.
const QUESTION_MAX = 8_000;
const CRITERIA_MAX = 4_000;
const EXTENT_MAX = 1_000;
const CONFLICTS_MAX = 4_000;
const LIMITS_MAX = 2_000;
const TOPIC_MAX = 200;
const EVIDENCE_MAX = 16;
/** spec 5.6: a carried objection quotes at most this much of its first line. */
const CARRIED_EXCERPT_MAX = 160;
const MIN_CONSULT_SECONDS = 600;
const MAX_CONSULT_SECONDS = 604_800;

/**
 * A term exactly as the caller wrote it: the store trims it and hashes what
 * it keeps, and so does collab_proposal_open, so nothing else is changed
 * here. What the store would refuse, or keep differently, is refused first.
 */
function term(input: ProposeInput, field: keyof ProposeInput, max: number, required: boolean): string | undefined {
  const value = input[field];
  if (value === undefined || value === null) {
    if (!required) return undefined;
    throw new CollabError(`invalid_${field}`, `${field} is required`, {
      remedy: { say: `Give ${field}: collab_propose needs question, criteria and extent.` },
    });
  }
  if (typeof value !== "string") throw new CollabError(`invalid_${field}`, `${field} must be text`);
  const kept = value.trim();
  if (!kept) {
    if (!required) return undefined;
    throw new CollabError(`invalid_${field}`, `${field} must not be empty`, { remedy: { say: `Give ${field} as text.` } });
  }
  if (kept.includes("\0")) throw new CollabError(`invalid_${field}`, `${field} must not contain NUL characters`);
  // bun:sqlite would not keep half a character as given, so the stored term,
  // and the bytes the person signs, would differ from what was sent.
  if (hasLoneSurrogate(kept)) {
    throw new CollabError(`invalid_${field}`, `${field} must be well-formed Unicode text (it holds half of a character)`);
  }
  if (kept.length > max) {
    throw new CollabError("too_long", `${field} is ${kept.length} characters; at most ${max}`, {
      field,
      max,
      actual: kept.length,
      unit: "chars",
    });
  }
  return value;
}

const DURATION = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i;

/** closes as read: whole seconds from the open, or a moment (ms since the epoch) still to be measured. */
type Closes = { seconds: number } | { at: number };

/**
 * Read closes (spec 5.6): an integer, a duration such as 30m, 6h or 1d12h,
 * or an ISO time. What cannot be read, and seconds out of range, are refused
 * now. An ISO time is only parsed: its distance from now changes as time
 * passes, so it is measured at the first write (closesFromNow), after a
 * retry of an earlier open has been replayed.
 */
function readCloses(ctx: NoteVerbContext, input: ProposeInput): Closes | undefined {
  const value = input.closes;
  if (value === undefined || value === null) return undefined;
  const say = {
    say: `closes is a number of seconds from ${MIN_CONSULT_SECONDS} to ${MAX_CONSULT_SECONDS}, a duration such as 30m, 6h or 2d, or an ISO time; leave it out for the default of 6 hours.`,
  };
  let seconds: number;
  if (typeof value === "number") {
    seconds = value;
  } else if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    seconds = Number(value.trim());
  } else if (typeof value === "string" && value.trim() !== "" && DURATION.test(value.trim())) {
    const [, days, hours, minutes, secs] = DURATION.exec(value.trim())!;
    seconds = Number(days ?? 0) * 86_400 + Number(hours ?? 0) * 3_600 + Number(minutes ?? 0) * 60 + Number(secs ?? 0);
  } else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value.trim()) && Number.isFinite(Date.parse(value.trim()))) {
    return { at: Date.parse(value.trim()) };
  } else {
    throw new CollabError("invalid_closes", `closes ${JSON.stringify(value)} is not a time collab can read`, { remedy: say });
  }
  if (!Number.isFinite(seconds)) {
    throw new CollabError("invalid_closes", `closes ${JSON.stringify(value)} is not a time collab can read`, { remedy: say });
  }
  if (!Number.isInteger(seconds)) {
    throw new CollabError("invalid_closes", "closes is a whole number of seconds", { remedy: retryCloses(ctx, input, Math.round(seconds)) });
  }
  return { seconds: inConsultRange(ctx, input, seconds) };
}

/** An ISO close as whole seconds from the store's clock now, refused when out of range. */
function closesFromNow(ctx: NoteVerbContext, input: ProposeInput, at: number): number {
  // Never earlier than asked: the store adds whole seconds to its own clock.
  return inConsultRange(ctx, input, Math.ceil((at - Date.parse(ctx.store.noteNow())) / 1_000));
}

function inConsultRange(ctx: NoteVerbContext, input: ProposeInput, seconds: number): number {
  if (seconds < MIN_CONSULT_SECONDS || seconds > MAX_CONSULT_SECONDS) {
    throw new CollabError(
      "invalid_closes",
      `closes is ${seconds} seconds from now; a proposal stays open from ${MIN_CONSULT_SECONDS} seconds (10 minutes) to ${MAX_CONSULT_SECONDS} (7 days)`,
      { seconds, remedy: retryCloses(ctx, input, Math.min(MAX_CONSULT_SECONDS, Math.max(MIN_CONSULT_SECONDS, seconds))) },
    );
  }
  return seconds;
}

function retryCloses(ctx: NoteVerbContext, input: ProposeInput, seconds: number) {
  return withSlot(ctx, { tool: "collab_propose", input: { ...input, closes: seconds } });
}

function excerpt(statement: string): string {
  if (statement.length <= CARRIED_EXCERPT_MAX) return statement;
  // Cut between characters, never inside one, and say that it was cut.
  let end = CARRIED_EXCERPT_MAX;
  const last = statement.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${statement.slice(0, end)}…`;
}

/** A standing objection the new terms carry, read from the journal: never from earlier terms' text. */
interface Objection {
  id: string;
  by: string;
  statement: string;
}

/** One carried objection, in the form spec 5.6 states. */
function carriedLine(objection: Objection): string {
  return `carried objection by ${objection.by} (report:${objection.id}): ${excerpt(objection.statement)}`;
}

/**
 * The objections a replacement carries: each standing challenge to the
 * replaced proposal, then each challenge anywhere in its supersedes lineage
 * that still stands where it was raised, whether an earlier replacement
 * carried it or shed it (one opened through collab_proposal_open carries
 * nothing), so no replacement sheds an objection that was never lifted.
 */
function objectionsToCarry(replaced: NoteProposalData | null): Objection[] {
  if (!replaced) return [];
  const direct = replaced.challenges
    .filter((challenge) => challenge.standing)
    .map((challenge) => ({ id: challenge.id, by: challenge.from_actor, statement: challenge.statement }));
  const seen = new Set(direct.map((objection) => objection.id));
  const forwarded = (replaced.replaced?.carried ?? [])
    .filter((entry) => entry.standing_on_replaced && !seen.has(entry.challenge_id))
    .map((entry) => ({ id: entry.challenge_id, by: entry.by, statement: entry.statement }));
  return [...direct, ...forwarded];
}

/**
 * The new proposal's known_conflicts: the author's own text, then each
 * carried objection in full form while they fit the 4,000 characters the
 * terms hold, then the rest by id. A line is never cut to fit; when even
 * the ids do not fit, the call is refused, because dropping an objection
 * from the terms the person signs would hide it.
 */
function carriedConflicts(
  own: string | undefined,
  carried: Objection[],
): { text: string | undefined; ids_only: string[] } {
  if (carried.length === 0) return { text: own, ids_only: [] };
  const head = own?.trim() ?? "";
  const lines = carried.map(carriedLine);
  const compose = (whole: number): string => {
    const rest = carried.slice(whole).map((challenge) => `report:${challenge.id}`);
    const parts = [...lines.slice(0, whole), ...(rest.length > 0 ? [`carried objection(s) by id only: ${rest.join(" ")}`] : [])];
    return [head, parts.join("\n")].filter(Boolean).join("\n\n");
  };
  for (let whole = carried.length; whole >= 0; whole -= 1) {
    const text = compose(whole);
    if (text.length <= CONFLICTS_MAX) return { text, ids_only: carried.slice(whole).map((challenge) => challenge.id) };
  }
  const idsOnly = compose(0).length - head.length;
  throw new CollabError(
    "conflicts_too_long",
    `The carried objections need ${idsOnly} characters even by id, and with your conflicts the terms would exceed ${CONFLICTS_MAX}`,
    {
      field: "conflicts",
      max: CONFLICTS_MAX,
      carried: carried.map((challenge) => challenge.id),
      remedy: {
        say: `Shorten your own conflicts to at most ${Math.max(0, CONFLICTS_MAX - idsOnly)} characters; ` +
          "the objections carried from the replaced proposal are never dropped from the terms.",
      },
    },
  );
}

interface Objector {
  voice_id: string;
  name: string;
  challenges: string[];
  /** A live session of that voice, the challenger's own first. */
  session: { id: string; name: string } | null;
  mine: boolean;
}

/**
 * The voices whose objections the recorded terms carry, read from those
 * terms so a retry addresses the same people: the replaced proposal's own
 * challenges, then those it carried itself (whatever their standing now,
 * so the list cannot shift between a call and its retry). A voice is
 * reachable when one of its sessions is active and was seen within 6 hours.
 */
function objectorsOf(
  ctx: NoteVerbContext,
  workspaceId: string,
  me: string,
  knownConflicts: string | null,
  replaced: NoteProposalData,
): Objector[] {
  const text = knownConflicts ?? "";
  const sessions = ctx.store.noteSessionViews(workspaceId);
  const myVoice = ctx.store.consentVoiceOf(me);
  const byVoice = new Map<string, Objector>();
  const candidates = [
    ...replaced.challenges.map((challenge) => ({
      id: challenge.id,
      voice_id: challenge.voice_id,
      from_actor: challenge.from_actor,
      from_session_id: challenge.from_session_id,
    })),
    ...(replaced.replaced?.carried ?? []).map((entry) => ({
      id: entry.challenge_id,
      voice_id: entry.voice_id,
      from_actor: entry.by,
      from_session_id: entry.by_session_id,
    })),
  ];
  const listed = new Set<string>();
  for (const challenge of candidates) {
    if (listed.has(challenge.id) || !text.includes(`report:${challenge.id}`) || !challenge.voice_id) continue;
    listed.add(challenge.id);
    let objector = byVoice.get(challenge.voice_id);
    if (!objector) {
      const live = sessions.filter((view) => view.voice_id === challenge.voice_id && view.status === "active" && view.liveness === "live");
      const own = live.find((view) => view.id === challenge.from_session_id) ?? live[0] ?? null;
      objector = {
        voice_id: challenge.voice_id,
        name: challenge.from_actor,
        challenges: [],
        session: own ? { id: own.id, name: own.actor } : null,
        mine: challenge.voice_id === myVoice,
      };
      byVoice.set(challenge.voice_id, objector);
    }
    objector.challenges.push(challenge.id);
  }
  return [...byVoice.values()];
}

/** Evidence lines an objector note gives its challenges: the new proposal takes the last of the 16. */
const OBJECTOR_EVIDENCE_CHALLENGES = NOTE_EVIDENCE_MAX - 1;
/** The store's cap on a report's evidence refs. */
const REPORT_REFS_MAX = 128;

/**
 * The note an objector is sent: where its objections went, and that they do
 * not block there. However many challenges one voice carried, the note fits
 * a note's caps: Evidence lines for the new proposal and the first 15, the
 * rest named by id in the body, so rendering never fails after the open.
 */
function objectorNote(proposalId: string, replacedId: string, challenges: string[]): { body: string; evidence_refs: string[] } {
  const shown = challenges.slice(0, OBJECTOR_EVIDENCE_CHALLENGES);
  const rest = challenges.slice(OBJECTOR_EVIDENCE_CHALLENGES);
  const many = challenges.length > 1;
  const body = renderNote({
    act: "note",
    statement: many
      ? `Your ${challenges.length} objections to a replaced proposal were carried into the new one as text.`
      : "Your objection to a replaced proposal was carried into the new one as text.",
    body: [
      CARRIED_OBJECTIONS_SENTENCE,
      `The replaced proposal is proposal:${replacedId}.`,
      ...(rest.length > 0
        ? [`Also carried, beyond the ${shown.length} in Evidence: ${rest.map((id) => `report:${id}`).join(" ")}`]
        : []),
    ].join("\n\n"),
    re: `proposal:${proposalId}`,
    evidence: [`report:${proposalId}`, ...shown.map((id) => `report:${id}`)],
  });
  const refs = [`report:${proposalId}`, ...challenges.map((id) => `report:${id}`)].slice(0, REPORT_REFS_MAX);
  return { body, evidence_refs: refs };
}

/** The parts of the returned note besides its statement, re and hash. */
type ProposalNotePart = "question body" | "extent" | "limits" | "criteria";
/** When the parts that fit alone do not fit together, they are left out in this order. */
const PROPOSAL_NOTE_DROP_ORDER: readonly ProposalNotePart[] = ["criteria", "limits", "question body", "extent"];

/**
 * The note collab_propose returns, for pasting elsewhere: the question, the
 * extent, limits and criteria as a note writes them (lines trimmed, blank
 * lines dropped), and the hash. A part a note cannot hold even so is left
 * out and named in `left_out`, never dropped unsaid; the proposal itself
 * keeps every term byte for byte. Rendering never fails after the open.
 */
function proposalNote(terms: {
  id: string;
  question: string;
  criteria: string;
  extent: string;
  limits: string | null;
  sha256: string;
}): { text: string; left_out: Array<ProposalNotePart | "question">; trimmed: ProposalNotePart[] } {
  // A render, not the stored bytes: the question is normalised as any note is.
  const text = normalizeNoteText(terms.question).trim();
  const words = splitNoteText(text);
  const firstCut = words.statement.length > NOTE_STATEMENT_MAX;
  const re = `proposal:${terms.id}`;
  const sha = { key: "Sha256", value: terms.sha256 };
  const raw: Record<ProposalNotePart, string | null> = {
    "question body": firstCut ? text : words.body,
    extent: terms.extent,
    limits: terms.limits,
    criteria: terms.criteria,
  };
  const build = (keep: ReadonlySet<ProposalNotePart>): NoteFields => normalizeNoteFields({
    act: "propose",
    statement: statementOf(text),
    body: keep.has("question body") ? raw["question body"] : null,
    re,
    extent: keep.has("extent") ? raw.extent : null,
    limits: keep.has("limits") ? raw.limits : null,
    trailers: [sha, ...(keep.has("criteria") && raw.criteria !== null ? [{ key: "Criteria", value: raw.criteria }] : [])],
  });
  const attempt = (keep: ReadonlySet<ProposalNotePart>): string | null => {
    try {
      return renderNote(build(keep));
    } catch (error) {
      if (!(error instanceof CollabError)) throw error;
      return null;
    }
  };
  const present = (Object.keys(raw) as ProposalNotePart[]).filter((part) => raw[part] !== null);
  // A part a note cannot hold even alone is left out; the rest stay together while they fit.
  const keep = new Set(present.filter((part) => attempt(new Set([part])) !== null));
  let rendered = attempt(keep);
  for (const part of PROPOSAL_NOTE_DROP_ORDER) {
    if (rendered !== null) break;
    keep.delete(part);
    rendered = attempt(keep);
  }
  if (rendered === null) {
    return {
      text: renderNote({ act: "propose", statement: "A proposal was opened; read it by its id.", re, trailers: [sha] }),
      left_out: ["question", ...present.filter((part) => part !== "question body")],
      trimmed: [],
    };
  }
  const shown = build(keep);
  const asShown: Record<ProposalNotePart, string | null> = {
    "question body": shown.body,
    extent: shown.extent,
    limits: shown.limits,
    criteria: shown.trailers.find((trailer) => trailer.key === "Criteria")?.value ?? null,
  };
  return {
    text: rendered,
    left_out: present.filter((part) => !keep.has(part)),
    trimmed: (["extent", "limits", "criteria"] as const).filter((part) => keep.has(part) && asShown[part] !== raw[part]?.trim()),
  };
}

function andList(items: readonly string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function sessionName(ctx: NoteVerbContext, workspaceId: string, id: string): string {
  try {
    return ctx.store.resolveNoteSession(workspaceId, id, { include_ended: true }).actor;
  } catch {
    return id;
  }
}

/** Which step of a call a derived key names: its own `:<nn>` suffix, if any, replaced. */
function stepKey(key: string, step: number): string {
  return `${key.replace(/:\d{2}$/, "")}:${String(step).padStart(2, "0")}`;
}

const OPEN_STEP = 2;
const FIRST_NOTE_STEP = 3;

export async function proposeVerb(ctx: NoteVerbContext, input: ProposeInput): Promise<Record<string, unknown>> {
  const { binding, credential } = requireCredential(ctx);
  const workspaceId = binding.handle.workspace.id;
  const me = credential.session_id;
  const question = term(input, "question", QUESTION_MAX, true)!;
  const criteria = term(input, "criteria", CRITERIA_MAX, true)!;
  const extent = term(input, "extent", EXTENT_MAX, true)!;
  const conflicts = term(input, "conflicts", CONFLICTS_MAX, false);
  const limits = term(input, "limits", LIMITS_MAX, false);
  const topic = term(input, "topic", TOPIC_MAX, false);
  const closes = readCloses(ctx, input);
  let seconds = closes && "seconds" in closes ? closes.seconds : undefined;
  if (input.evidence !== undefined && (!Array.isArray(input.evidence) || input.evidence.some((line) => typeof line !== "string"))) {
    throw new CollabError("invalid_evidence", "evidence is a list of one-line pointers", {
      remedy: { say: "Give evidence as a list such as [\"file src/a.ts\", \"report:report_…\"]." },
    });
  }
  const lines = input.evidence ?? [];
  if (lines.length > EVIDENCE_MAX) {
    throw new CollabError("too_long", `evidence has ${lines.length} items; at most ${EVIDENCE_MAX}`, {
      field: "evidence",
      max: EVIDENCE_MAX,
      actual: lines.length,
      unit: "items",
    });
  }
  let replaced: NoteProposalData | null = null;
  if (input.replaces !== undefined && input.replaces !== null) {
    if (typeof input.replaces !== "string" || !input.replaces.trim()) {
      throw new CollabError("invalid_replaces", "replaces names your earlier proposal", {
        remedy: { say: "Name the proposal this one replaces, by its id or a proposal# handle." },
      });
    }
    const id = ctx.store.resolveNoteRef(workspaceId, "proposal", input.replaces).id;
    replaced = ctx.store.noteProposalView(workspaceId, id);
  }
  const standing = objectionsToCarry(replaced);
  // A refusal here waits for the first write: a retry whose open was already
  // recorded replays it, whatever the replaced proposal has gathered since.
  let composed: { text: string | undefined; ids_only: string[] } = { text: conflicts, ids_only: [] };
  let unfit: unknown = null;
  try {
    composed = carriedConflicts(conflicts, standing);
  } catch (error) {
    if (!(error instanceof CollabError) || error.code !== "conflicts_too_long") throw error;
    unfit = error;
  }
  const evidence = resolveEvidence(ctx, binding, lines);
  const advice = [...evidence.advice];
  if (composed.ids_only.length > 0) {
    advice.push(`${composed.ids_only.length} carried objection(s) did not fit the terms in full, so they are carried by id: ${composed.ids_only.join(", ")}.`);
  }
  const taskId = replaced?.status.proposal.task_id ?? null;
  const replacedId = replaced?.status.proposal.id ?? null;
  // The derived key hashes the call as written (spec 5): closes as given, not
  // the seconds it means now, and the replaced proposal by its id.
  const keyInput = {
    question,
    criteria,
    extent,
    closes: input.closes ?? null,
    conflicts: conflicts ?? null,
    evidence: evidence.key_lines,
    limits: limits ?? null,
    topic: topic ?? null,
    replaces: replacedId,
  };
  const retryInput = { ...input, ...(replacedId ? { replaces: replacedId } : {}) } as Record<string, unknown>;
  // Checked before the first write, so a proposal the store would refuse leaves no orphan cite.
  const precheck = beforeFirstWrite(() => {
    // Measured here, after the replay decision: a lost-response retry made
    // when an ISO close is nearer than the floor replays the earlier open.
    if (closes && "at" in closes) seconds = closesFromNow(ctx, input, closes.at);
    if (unfit) throw unfit;
    ctx.store.noteProposalPrecheck(credential, {
      evidence_refs: evidence.journal,
      supersedes_report_id: replacedId,
      task_id: taskId,
    });
  });
  // The returned note is rendered once before anything is written, with a
  // stand-in id and hash of the same shape, so nothing can fail after the open.
  const standIn = "report_00000000-0000-4000-8000-000000000000";
  proposalNote({
    id: standIn,
    question,
    criteria: criteria.trim(),
    extent: extent.trim(),
    limits: limits?.trim() ?? null,
    sha256: "0".repeat(64),
  });
  // So is each objector's note, for the objectors these terms carry.
  if (replaced && !unfit) {
    for (const objector of objectorsOf(ctx, workspaceId, me, composed.text ?? null, replaced)) {
      objectorNote(standIn, replaced.status.proposal.id, objector.challenges);
    }
  }
  const { plan, cite, citeReplayed, status, notes, replays, steps } = await underPlan(ctx, credential, {
    tool: "collab_propose",
    input: keyInput,
    entity: replacedId ?? "propose",
    retry_input: retryInput,
    // An earlier open is current while that proposal is still on the table:
    // the same terms proposed again after a withdrawal are a new proposal.
    stillCurrent: (latestKey) => {
      const opened = replayReceipt<ProposalStatus>(ctx.store, credential, stepKey(latestKey, OPEN_STEP));
      if (!opened) return true;
      const position = ctx.store.proposalStatus(workspaceId, opened.proposal.id).ai.position;
      return position !== "withdrawn" && position !== "superseded";
    },
  }, async (plan) => {
    const recorded: RecordedStep[] = [];
    let replays = 0;
    let steps = 0;
    let cite: NoteCiteReceipt | null = null;
    let citeReplayed = false;
    if (evidence.items.length > 0) {
      steps += 1;
      const cited = await stepOnce(ctx, credential, plan.step(1), () => {
        precheck();
        return ctx.store.citeEvidenceForSession({
          ...credential,
          idempotency_key: plan.step(1),
          worktree_id: binding.handle.worktree.id,
          items: evidence.items,
          receipt_plan: plan.guard,
        });
      });
      cite = cited.value;
      citeReplayed = cited.replayed;
      if (cited.replayed) replays += 1;
      recorded.push({ step: 1, what: `evidence.cited event ${cite.event_id} (cite ${cite.cite_id})`, id: cite.event_id });
    }
    try {
      steps += 1;
      const opened = await stepOnce(ctx, credential, plan.step(OPEN_STEP), () => {
        precheck();
        return ctx.store.withReceiptPlan(plan.guard, () => ctx.store.openProposalForSession({
          ...credential,
          idempotency_key: plan.step(OPEN_STEP),
          question,
          criteria,
          extent,
          ...(composed.text !== undefined ? { known_conflicts: composed.text } : {}),
          evidence_refs: [...evidence.journal, ...(cite ? [`event:${cite.event_id}`] : [])],
          ...(limits !== undefined ? { limits } : {}),
          ...(topic !== undefined ? { topic } : {}),
          ...(seconds !== undefined ? { consult_seconds: seconds } : {}),
          ...(taskId ? { task_id: taskId } : {}),
          ...(replacedId ? { supersedes_report_id: replacedId } : {}),
        }));
      });
      if (opened.replayed) replays += 1;
      const status = opened.value;
      recorded.push({ step: OPEN_STEP, what: `proposal ${status.proposal.id}`, id: status.proposal.id });
      const notes: Array<{ objector: Objector; report: string | null }> = [];
      if (replaced) {
        const objectors = objectorsOf(ctx, workspaceId, me, status.terms.known_conflicts, replaced);
        for (const [index, objector] of objectors.entries()) {
          const key = plan.step(FIRST_NOTE_STEP + index);
          // A note an earlier attempt sent is reported as sent, even if its
          // objector has gone quiet since.
          const earlier = replayReceipt<NoteAppendReceipt>(ctx.store, credential, key);
          if (!earlier && (objector.mine || !objector.session)) {
            notes.push({ objector, report: null });
            continue;
          }
          steps += 1;
          const told = objectorNote(status.proposal.id, replaced!.status.proposal.id, objector.challenges);
          const sent = await stepOnce(ctx, credential, key, () => ctx.store.appendNoteForSession({
            ...credential,
            idempotency_key: key,
            reports: [{
              kind: "inference",
              relation: "informs",
              body: told.body,
              task_id: status.proposal.task_id,
              to_session_id: objector.session!.id,
              about_proposal_id: status.proposal.id,
              evidence_refs: told.evidence_refs,
            }],
            receipt_plan: plan.guard,
          }));
          if (sent.replayed) replays += 1;
          const posted = sent.value.reports[0]!;
          const to = posted.to_session_id ?? objector.session!.id;
          const name = objector.session?.id === to ? objector.session.name : sessionName(ctx, workspaceId, to);
          const reached = { ...objector, session: { id: to, name } };
          recorded.push({ step: FIRST_NOTE_STEP + index, what: `note ${posted.id} to ${reached.session.name}`, id: posted.id });
          notes.push({ objector: reached, report: posted.id });
        }
      }
      return { plan, cite, citeReplayed, status, notes, replays, steps };
    } catch (error) {
      throw refusedAfter(error, recorded);
    }
  });
  const replayed = replays === steps;
  if (plan.retry && replayed) {
    advice.push("This repeats your latest proposal on this entity exactly, so it was read as a retry. Add a word to the question to propose again.");
  } else if (plan.retry) {
    advice.push("An earlier call with this input stopped part way; its finished steps were kept, and the rest ran now.");
  }
  return proposeResult(ctx, binding, {
    status,
    cite,
    citeReplayed,
    notes,
    replayed,
    advice,
    evidence,
  });
}

function proposeResult(
  ctx: NoteVerbContext,
  binding: NoteBinding,
  options: {
    status: ProposalStatus;
    cite: NoteCiteReceipt | null;
    citeReplayed: boolean;
    notes: Array<{ objector: Objector; report: string | null }>;
    replayed: boolean;
    advice: string[];
    evidence: ReturnType<typeof resolveEvidence>;
  },
): Record<string, unknown> {
  const workspaceId = binding.handle.workspace.id;
  const proposalId = options.status.proposal.id;
  const advice = options.advice;
  // Said as it stands now, through the one status computation.
  const data = ctx.store.noteProposalView(workspaceId, proposalId);
  const facts = proposalFacts(ctx, data);
  advice.push(...facts.advice);
  const status = data.status;
  const handle = handleOf("proposal", proposalId);
  const sessions = new Map(ctx.store.noteSessionViews(workspaceId).map((view) => [view.id, view]));
  const voices = status.terms.voices.map((voice) => {
    const members = voice.live_session_ids.map((id) => sessions.get(id)).filter((view) => view !== undefined);
    const lastSeen = members.map((view) => view.last_seen_at).sort().at(-1) ?? null;
    return {
      voice: voice.voice_id,
      name: sessions.get(voice.voice_id)?.actor ?? members[0]?.actor ?? voice.voice_id,
      author: voice.voice_id === status.terms.author_voice_id,
      sessions: voice.live_session_ids,
      last_seen_minutes: lastSeen ? minutesSince(lastSeen, data.observed_at) : null,
    };
  });
  if (data.lone) {
    advice.push("You are the lone voice here: consent/v1 counts only an explicit support from you (collab_note act support), and without one it lapses at the close.");
  }
  const notified = options.notes.filter((entry) => entry.report !== null);
  const unreachable = options.notes.filter((entry) => entry.report === null && !entry.objector.mine);
  if (unreachable.length > 0) {
    advice.push(`${unreachable.length} carried objector(s) have no live session, so no note reached them: ${unreachable.map((entry) => entry.objector.name).join(", ")}.`);
  }
  const shown = options.cite && options.citeReplayed ? recordedEvidence(options.evidence, options.cite.items, advice) : options.evidence;
  const replacedId = data.replaced?.proposal_id ?? null;
  const note = proposalNote({
    id: proposalId,
    question: status.proposal.body,
    criteria: status.terms.criteria,
    extent: status.terms.extent,
    limits: status.proposal.limits,
    sha256: status.proposal_sha256,
  });
  if (note.trimmed.length > 0) {
    advice.push(`The returned note shows ${andList(note.trimmed)} with lines trimmed and blank lines dropped, as a note writes them; the proposal keeps them byte for byte.`);
  }
  if (note.left_out.length > 0) {
    advice.push(
      `The returned note leaves out ${andList(note.left_out)}, which a note cannot hold as written (not_in_note); ` +
        `the proposal keeps every term byte for byte (read it with collab_inbox about ${proposalId}).`,
    );
  }
  return {
    ...noteWriteResult({
      effect:
        `Opened proposal ${handle} (proposal_sha256 ${status.proposal_sha256}) for the agents to settle by consent/v1 and the person to decide; ` +
        `the agents' position is ${status.ai.position}, closing ${status.terms.closes_at}.` +
        (replacedId
          ? ` It replaces ${handleOf("proposal", replacedId)}, carrying ${data.replaced!.carried.filter((entry) => entry.carried_in_terms).length} objection(s) into its terms as text.`
          : ""),
      ids: {
        proposal: proposalId,
        proposal_handle: handle,
        proposal_sha256: status.proposal_sha256,
        ...(options.cite ? { evidence_cited: { event: options.cite.event_id, cite: options.cite.cite_id } } : {}),
        ...(notified.length > 0
          ? { objector_notes: notified.map((entry) => ({ report: entry.report, to: entry.objector.session })) }
          : {}),
      },
      advice,
      next: withSlot(ctx, { tool: "collab_inbox", input: { about: exactRef("proposal", proposalId) } }),
      note: note.text,
      replayed: options.replayed,
    }),
    ...(note.left_out.length > 0 ? { not_in_note: note.left_out } : {}),
    voices,
    evidence: evidenceSummary(shown),
    ...facts.fields,
    ...(data.replaced
      ? {
        objectors: options.notes.map((entry) => ({
          voice: entry.objector.voice_id,
          name: entry.objector.name,
          challenges: entry.objector.challenges,
          reached: entry.report !== null,
          ...(entry.report ? { note: entry.report, session: entry.objector.session } : {}),
          ...(entry.objector.mine ? { yours: true } : {}),
        })),
        unreachable_objectors: unreachable.map((entry) => ({
          voice: entry.objector.voice_id,
          name: entry.objector.name,
          challenges: entry.objector.challenges,
        })),
      }
      : {}),
  };
}
