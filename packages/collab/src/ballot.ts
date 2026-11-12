/**
 * The sealed approval ballot (ballot/1), as arithmetic: counting units, the
 * cast commitment, the caps on a poll and a vote, how revealed casts resolve,
 * and the result. Contract: Collab Notes build spec, revision 2, section 7.
 *
 * Pure: no store, no filesystem, no clock (callers pass `now`) and no
 * randomness (callers pass the salt and the cast id). A result is the agents'
 * recorded preference and authorises nothing. Declared model and confidence
 * never weight a count; they only change what a reader is shown.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical.js";
import { CollabError } from "./errors.js";
import { hasLoneSurrogate, NOTE_BASES, normalizeNoteText, parseEvidence, type NoteBasis } from "./note.js";

export const BALLOT_COMMITMENT_PROTOCOL = "agenttool.collab-ballot/1";
export const BALLOT_METHOD = "approval/1";

export const MIN_BALLOT_OPTIONS = 2;
export const MAX_BALLOT_OPTIONS = 9;
export const MAX_BALLOT_OPTION_KEY = 32;
export const MAX_BALLOT_OPTION_LABEL = 120;
export const MAX_BALLOT_QUESTION = 500;
export const MAX_BALLOT_CRITERIA = 2_000;
export const MIN_BALLOT_CLOSE_SECONDS = 60;
export const MAX_BALLOT_CLOSE_SECONDS = 7 * 24 * 60 * 60;
export const MIN_ELECTORATE_UNITS = 2;
export const MAX_ELECTORATE_UNITS = 16;
export const MIN_BALLOT_QUORUM = 2;
export const DEFAULT_BALLOT_QUORUM = 2;
export const MAX_VOTE_REASONS = 4;
export const MAX_VOTE_REASON = 300;
export const MAX_VOTE_EVIDENCE = 4;
export const MAX_VOTE_SHARED = 200;
export const MAX_REVEALED_ENTRY_BYTES = 8 * 1024;
export const MAX_CASTS_PER_SESSION = 3;

export const BALLOT_SEALING =
  "Sealed means no collab tool, event or doorbell shows a vote before the close. It does not hide a vote from a process running as the same user that reads the seal files, from the voter's own host transcript, or from agents who message each other outside collab. Turnout, timing and the size of each seal file are visible. Any process that can read a session's credential file can cast for that session's unit. Notes on an open ballot are folded by collab_inbox only; legacy tools and older builds show them.";

export const BALLOT_AUTHORISES =
  "Nothing. A top choice is the agents' recorded preference: not a decision and not agreement. It adds nothing to what you were already allowed to do. A direction-level choice goes to collab_propose, where every voice may still object and the person decides.";

export const BALLOT_SPLIT_NOTE = "A split among agents is not agreement.";

export const BALLOT_SAME_FAMILY_NOTE =
  "all counted units declare the same model family: shared support is not independent confirmation";

export const BALLOT_TIE_NEXT: { readonly say: string } = {
  say: "the opener may poll again on the tied options or put one to collab_propose",
};

// A vote's reasons are marked with the note's basis words, so one list serves both.
export const BALLOT_BASES = NOTE_BASES;
export type BallotBasis = NoteBasis;

export type BallotRemedy = { say: string } | { tool: string; input: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Electorate and units

/** One session the store chose for the electorate (or one that casts). */
export interface ElectorateSession {
  session_id: string;
  /** The root of the session's attested lineage (the consent/v1 voice). */
  voice_id: string;
  seat_ref: string | null;
  name: string;
  model?: string | null;
  /** Used only to choose the most recently seen units for an electorate_too_large remedy. */
  last_seen_at?: string | null;
}

/** One counting unit, exactly as written into `ballot.opened`. */
export interface ElectorateUnit {
  unit_id: string;
  voice_ids: string[];
  session_ids: string[];
  seat_refs: string[];
  names: string[];
  /** Present when the unit's sessions declare exactly one model. */
  model?: string;
  /** Present instead of `model` when they declare several. */
  models?: string[];
}

export interface Electorate {
  units: ElectorateUnit[];
  electorate_sha256: string;
}

/** `unit_` + the first 32 hex of sha256(canonicalJson(sorted voice ids)). */
export function ballotUnitId(voiceIds: readonly string[]): string {
  return `unit_${sha256(canonicalJson(sortedUnique(voiceIds))).slice(0, 32)}`;
}

export function electorateSha256(units: readonly ElectorateUnit[]): string {
  return sha256(canonicalJson(units));
}

/**
 * Units are the connected components of the electorate's voices, two voices
 * joined when any of their sessions share a non-null seat_ref. The merge is
 * transitive; sessions with no seat_ref never join anything.
 */
export function buildElectorate(sessions: readonly ElectorateSession[]): Electorate {
  const byId = new Map<string, ElectorateSession>();
  for (const session of sessions) {
    if (!nonEmptyString(session.session_id) || !nonEmptyString(session.voice_id) || typeof session.name !== "string") {
      throw new CollabError("invalid_electorate", "every electorate session needs a session_id, a voice_id and a name");
    }
    const seatRef = nonEmptyString(session.seat_ref) ? session.seat_ref : null;
    const prior = byId.get(session.session_id);
    if (prior) {
      if (prior.voice_id !== session.voice_id || prior.seat_ref !== seatRef) {
        throw new CollabError("invalid_electorate", `session ${session.session_id} is listed twice with different lineage or seat`);
      }
      continue;
    }
    byId.set(session.session_id, { ...session, seat_ref: seatRef });
  }

  const parent = new Map<string, string>();
  const find = (voice: string): string => {
    let root = voice;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    let next = voice;
    while (next !== root) {
      const up = parent.get(next) as string;
      parent.set(next, root);
      next = up;
    }
    return root;
  };
  const union = (left: string, right: string) => {
    const a = find(left);
    const b = find(right);
    if (a === b) return;
    if (a < b) parent.set(b, a);
    else parent.set(a, b);
  };
  const firstVoiceBySeat = new Map<string, string>();
  for (const session of byId.values()) {
    if (!parent.has(session.voice_id)) parent.set(session.voice_id, session.voice_id);
    if (session.seat_ref === null) continue;
    const first = firstVoiceBySeat.get(session.seat_ref);
    if (first === undefined) firstVoiceBySeat.set(session.seat_ref, session.voice_id);
    else union(first, session.voice_id);
  }

  const groups = new Map<string, ElectorateSession[]>();
  for (const session of byId.values()) {
    const root = find(session.voice_id);
    const group = groups.get(root);
    if (group) group.push(session);
    else groups.set(root, [session]);
  }

  const units = [...groups.values()].map((group): ElectorateUnit => {
    const voiceIds = sortedUnique(group.map((session) => session.voice_id));
    const unit: ElectorateUnit = {
      unit_id: ballotUnitId(voiceIds),
      voice_ids: voiceIds,
      session_ids: sortedUnique(group.map((session) => session.session_id)),
      seat_refs: sortedUnique(group.flatMap((session) => session.seat_ref === null ? [] : [session.seat_ref])),
      names: sortedUnique(group.map((session) => session.name)),
    };
    const models = sortedUnique(group.flatMap((session) => {
      const model = typeof session.model === "string" ? session.model.trim() : "";
      return model ? [model] : [];
    }));
    if (models.length === 1) unit.model = models[0];
    else if (models.length > 1) unit.models = models;
    return unit;
  }).sort((left, right) => compare(left.unit_id, right.unit_id));

  return { units, electorate_sha256: electorateSha256(units) };
}

export type CasterClass =
  | { counts_as: "counted"; unit_id: string }
  | { counts_as: "late"; unit_id: string; same_handle_as?: string };

/**
 * A caster belongs to the electorate unit that lists its voice. Anyone else is
 * late: revealed, never counted, and given a unit of its own voice alone. A
 * matching seat_ref is shown, never used to join, so a session that declares a
 * peer's handle after the open cannot cancel that peer's vote.
 */
export function classifyCaster(
  units: readonly ElectorateUnit[],
  caster: { voice_id: string; seat_ref?: string | null },
): CasterClass {
  const listed = units.find((unit) => unit.voice_ids.includes(caster.voice_id));
  if (listed) return { counts_as: "counted", unit_id: listed.unit_id };
  const late: CasterClass = { counts_as: "late", unit_id: ballotUnitId([caster.voice_id]) };
  const seatRef = caster.seat_ref;
  if (nonEmptyString(seatRef)) {
    const sameHandle = units.find((unit) => unit.seat_refs.includes(seatRef));
    if (sameHandle) late.same_handle_as = sameHandle.unit_id;
  }
  return late;
}

export function unitBasis(units: readonly ElectorateUnit[]): string {
  const unhandled = units.filter((unit) => unit.seat_refs.length === 0).length;
  return `A unit is one attested session lineage, or several lineages that declared the same unverified host handle. ${unhandled} of ${units.length} units declared no handle and are counted per lineage. This does not show one mind, one model or one operator. A process can hold several sessions; sessions started through the legacy session tool without attestation are separate units.`;
}

// ---------------------------------------------------------------------------
// Poll terms

export interface BallotOption {
  key: string;
  label: string;
}

/** The terms every voter sees, as written into `ballot.opened`. */
export interface BallotTerms {
  question: string;
  options: BallotOption[];
  criteria?: string;
  method: typeof BALLOT_METHOD;
  pick?: number;
  quorum: number;
  closes_at: string;
  close_when_all_cast: boolean;
}

export interface PollTermsInput {
  question?: unknown;
  options?: unknown;
  closes?: unknown;
  criteria?: unknown;
  pick?: unknown;
  quorum?: unknown;
  close_when_all_cast?: unknown;
  voters?: unknown;
  [key: string]: unknown;
}

export interface PollTermsContext {
  /** ISO time the poll opens; the caller reads the clock. */
  now: string;
  units: readonly ElectorateUnit[];
  /** The sessions the units were built from, for an electorate_too_large remedy. */
  sessions?: readonly ElectorateSession[];
}

const OPTION_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Checks a poll's terms in the order a reader would fix them: the question
 * and options, the close, then the electorate and the quorum it bounds.
 */
export function validatePollTerms(
  input: PollTermsInput,
  context: PollTermsContext,
): { terms: BallotTerms; advice: string[] } {
  const advice: string[] = [];
  const question = textField(input.question, "question", MAX_BALLOT_QUESTION, { required: true, multiline: true }) as string;
  const options = pollOptions(input.options);
  const criteria = textField(input.criteria, "criteria", MAX_BALLOT_CRITERIA, { required: false, multiline: true });
  if (criteria === null) {
    advice.push("No criteria given: say what makes an option acceptable, so every voter judges the same question.");
  }

  let pick: number | undefined;
  if (input.pick !== undefined && input.pick !== null) {
    if (!Number.isInteger(input.pick) || (input.pick as number) < 1 || (input.pick as number) > options.length) {
      refuse("invalid_pick", `pick is an integer from 1 to ${options.length}, the number of options`, {
        field: "pick", min: 1, max: options.length,
      }, { say: `Set pick from 1 to ${options.length}, or leave it out to let voters approve any number of options.` });
    }
    pick = input.pick as number;
    if (pick === 1) advice.push("pick 1 makes this a plurality vote: no voter can say that either of two options would do.");
  }

  const closesAt = ballotClosesAt(input.closes, context.now);

  let closeWhenAllCast = false;
  if (input.close_when_all_cast !== undefined && input.close_when_all_cast !== null) {
    if (typeof input.close_when_all_cast !== "boolean") {
      refuse("invalid_close_when_all_cast", "close_when_all_cast is true or false", { field: "close_when_all_cast" }, {
        say: "Leave close_when_all_cast out to keep the ballot sealed until its deadline.",
      });
    }
    closeWhenAllCast = input.close_when_all_cast;
  }

  checkElectorateSize(context.units, { poll_input: input, sessions: context.sessions });
  const quorum = ballotQuorum(input.quorum, context.units.length);

  const terms: BallotTerms = {
    question,
    options,
    method: BALLOT_METHOD,
    quorum,
    closes_at: closesAt,
    close_when_all_cast: closeWhenAllCast,
  };
  if (criteria !== null) terms.criteria = criteria;
  if (pick !== undefined) terms.pick = pick;
  return { terms, advice };
}

/** An electorate holds 2 to 16 units. */
export function checkElectorateSize(
  units: readonly ElectorateUnit[],
  context: { poll_input?: PollTermsInput; sessions?: readonly ElectorateSession[] } = {},
): void {
  if (units.length < MIN_ELECTORATE_UNITS) {
    refuse("electorate_too_small", `A ballot needs at least ${MIN_ELECTORATE_UNITS} units in its electorate; this one has ${units.length}`, {
      units: units.length, min: MIN_ELECTORATE_UNITS,
    }, {
      say: "There is no one else to poll. Say it with collab_note, or put a direction-level question to collab_propose.",
    });
  }
  if (units.length > MAX_ELECTORATE_UNITS) {
    const voters = mostRecentlySeenVoters(units, context.sessions ?? []);
    const remedy: BallotRemedy = voters && context.poll_input
      ? { tool: "collab_poll", input: { ...definedEntries(context.poll_input), voters } }
      : { say: `Name at most ${MAX_ELECTORATE_UNITS} voters with voters.` };
    refuse("electorate_too_large", `A ballot counts at most ${MAX_ELECTORATE_UNITS} units; this electorate has ${units.length}`, {
      units: units.length, max: MAX_ELECTORATE_UNITS,
    }, remedy);
  }
}

/** Quorum counts units, abstentions included; from 2 to the electorate size, default 2. */
export function ballotQuorum(value: unknown, electorateSize: number): number {
  if (value === undefined || value === null) return DEFAULT_BALLOT_QUORUM;
  if (!Number.isInteger(value) || (value as number) < MIN_BALLOT_QUORUM || (value as number) > electorateSize) {
    refuse("invalid_quorum", `quorum is an integer from ${MIN_BALLOT_QUORUM} to ${electorateSize}, the number of units in the electorate`, {
      field: "quorum", min: MIN_BALLOT_QUORUM, max: electorateSize,
    }, { say: `Set quorum from ${MIN_BALLOT_QUORUM} to ${electorateSize}, or leave it out for ${DEFAULT_BALLOT_QUORUM}.` });
  }
  return value as number;
}

const DURATION = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * `closes` is whole seconds, a duration such as "30m", "2h" or "1d12h", or an
 * ISO instant with a zone. It must fall 1 minute to 7 days after `now`.
 */
export function ballotClosesAt(closes: unknown, now: string): string {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new CollabError("invalid_now", "now must be an ISO time");
  let closesMs: number | null = null;
  if (typeof closes === "number" && Number.isInteger(closes)) {
    closesMs = nowMs + closes * 1_000;
  } else if (typeof closes === "string") {
    const text = closes.trim().toLowerCase();
    const duration = DURATION.exec(text);
    if (/^\d+$/.test(text)) {
      closesMs = nowMs + Number(text) * 1_000;
    } else if (text !== "" && duration) {
      const [days, hours, minutes, seconds] = duration.slice(1).map((part) => Number(part ?? 0)) as [number, number, number, number];
      closesMs = nowMs + (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1_000;
    } else if (ISO_INSTANT.test(closes.trim())) {
      const parsed = Date.parse(closes.trim());
      if (Number.isFinite(parsed)) closesMs = parsed;
    }
  }
  const window = closesMs === null ? null : closesMs - nowMs;
  if (
    closesMs === null
    || window === null
    || window < MIN_BALLOT_CLOSE_SECONDS * 1_000
    || window > MAX_BALLOT_CLOSE_SECONDS * 1_000
  ) {
    refuse("invalid_closes", "closes is a duration from 1 minute to 7 days, or an ISO time inside that window", {
      field: "closes", min_seconds: MIN_BALLOT_CLOSE_SECONDS, max_seconds: MAX_BALLOT_CLOSE_SECONDS,
    }, { say: 'Set closes to a duration such as "30m", "2h" or "1d", from 1 minute to 7 days.' });
  }
  return new Date(closesMs).toISOString();
}

function pollOptions(value: unknown): BallotOption[] {
  const bounds = { field: "options", min: MIN_BALLOT_OPTIONS, max: MAX_BALLOT_OPTIONS };
  if (!Array.isArray(value) || value.length < MIN_BALLOT_OPTIONS || value.length > MAX_BALLOT_OPTIONS) {
    refuse("invalid_options", `options is a list of ${MIN_BALLOT_OPTIONS} to ${MAX_BALLOT_OPTIONS} {key, label}`, bounds, {
      say: `Give ${MIN_BALLOT_OPTIONS} to ${MAX_BALLOT_OPTIONS} options. A yes-or-no question about proceeding belongs to collab_propose.`,
    });
  }
  const seen = new Set<string>();
  return value.map((option, index): BallotOption => {
    const field = `options[${index}]`;
    if (option === null || typeof option !== "object" || Array.isArray(option)) {
      refuse("invalid_options", `${field} must be {key, label}`, { field }, { say: "Give each option as {key, label}." });
    }
    const record = option as Record<string, unknown>;
    const key = typeof record.key === "string" ? record.key.trim() : "";
    if (!key || key.length > MAX_BALLOT_OPTION_KEY || !OPTION_KEY.test(key)) {
      refuse("invalid_options", `${field}.key is 1 to ${MAX_BALLOT_OPTION_KEY} letters, digits, _ or -, starting with a letter or digit`, {
        field: `${field}.key`, max: MAX_BALLOT_OPTION_KEY,
      }, { say: 'Use short option keys such as "a", "b", "keep" or "split-2".' });
    }
    const folded = key.toLowerCase();
    if (seen.has(folded)) {
      refuse("invalid_options", `option key "${key}" is used twice (keys are compared without case)`, { field: `${field}.key` }, {
        say: "Give every option a different key.",
      });
    }
    seen.add(folded);
    const label = textField(record.label, `${field}.label`, MAX_BALLOT_OPTION_LABEL, {
      required: true, multiline: false, code: "invalid_options",
    }) as string;
    return { key, label };
  });
}

function mostRecentlySeenVoters(units: readonly ElectorateUnit[], sessions: readonly ElectorateSession[]): string[] | null {
  const seenAt = (session: ElectorateSession) => {
    const parsed = typeof session.last_seen_at === "string" ? Date.parse(session.last_seen_at) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
  };
  const latest = units.map((unit) => {
    let best: { session_id: string; at: number } | null = null;
    for (const session of sessions) {
      if (!unit.session_ids.includes(session.session_id)) continue;
      const at = seenAt(session);
      if (at === null) continue;
      if (best === null || at > best.at || (at === best.at && session.session_id < best.session_id)) {
        best = { session_id: session.session_id, at };
      }
    }
    return best;
  });
  if (latest.some((entry) => entry === null)) return null;
  return (latest as { session_id: string; at: number }[])
    .sort((left, right) => right.at - left.at || compare(left.session_id, right.session_id))
    .slice(0, MAX_ELECTORATE_UNITS)
    .map((entry) => entry.session_id);
}

/**
 * `voters` names sessions by id or display name; the store resolves them.
 * This only checks the shape and removes repeats.
 */
export function normalizeBallotVoters(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0 || value.some((voter) => !nonEmptyString(voter) || voter.trim() !== voter)) {
    refuse("invalid_voters", "voters is a non-empty list of session ids or names", { field: "voters" }, {
      say: "Leave voters out for the default electorate, or list the sessions to poll.",
    });
  }
  return [...new Set(value as string[])];
}

/** Why a ballot is closed at `now`, or null while it is open. */
export function ballotClosedBy(
  terms: Pick<BallotTerms, "closes_at" | "close_when_all_cast">,
  units: readonly ElectorateUnit[],
  castUnitIds: readonly string[],
  now: string,
): "time" | "all_cast" | null {
  // The deadline instant itself counts as closed, as in consent/v1.
  if (Date.parse(now) >= Date.parse(terms.closes_at)) return "time";
  if (!terms.close_when_all_cast) return null;
  const cast = new Set(castUnitIds);
  return units.length > 0 && units.every((unit) => cast.has(unit.unit_id)) ? "all_cast" : null;
}

// ---------------------------------------------------------------------------
// Votes

export interface VoteReason {
  text: string;
  basis?: BallotBasis;
  /** 1-based positions in the vote's evidence list. */
  cites: number[];
}

/**
 * Evidence as kept with a sealed vote: the line the voter wrote, or that line
 * resolved at cast time (file and commit cites hashed by the server). The
 * resolved form keeps the original line in `text`.
 */
export type VoteEvidence = string | ResolvedVoteEvidence;

export interface ResolvedVoteEvidence {
  text: string;
  kind?: string;
  locator?: string;
  lines?: string;
  sha256?: string;
  exit?: number;
  observed?: string;
  worktree_id?: string;
}

export interface SealedVote {
  choice: string[];
  why: VoteReason[];
  evidence: VoteEvidence[];
  shared?: string;
  model?: string;
}

export interface VoteInput {
  choice?: unknown;
  why?: unknown;
  evidence?: unknown;
  shared?: unknown;
  [key: string]: unknown;
}

/** Ids at their full length, so a size check made before the cast is never looser than the reveal. */
const PLACEHOLDER_ENTRY_IDS = {
  ballot_id: "report_00000000-0000-0000-0000-000000000000",
  cast_id: "00000000-0000-0000-0000-000000000000",
  unit_id: `unit_${"0".repeat(32)}`,
  session_id: "session_00000000-0000-0000-0000-000000000000",
};

/**
 * Validates a vote and returns it in the one form it is sealed and compared
 * in: choice in option order without repeats, reasons and evidence trimmed.
 * Advice and errors here go to the voter alone; storing them anywhere would
 * leak the vote before the close.
 */
export function validateVote(
  input: VoteInput,
  terms: Pick<BallotTerms, "options" | "pick">,
): { vote: SealedVote; advice: string[] } {
  const advice: string[] = [];
  const keys = terms.options.map((option) => option.key);
  const choiceRemedy = { say: `Choose from the option keys ${keys.join(", ")}, or [] to abstain.` };
  if (!Array.isArray(input.choice) || input.choice.some((key) => typeof key !== "string")) {
    refuse("invalid_choice", "choice is a list of option keys, or [] to abstain", { field: "choice", options: keys }, choiceRemedy);
  }
  const chosen = new Set(input.choice as string[]);
  const unknown = [...chosen].filter((key) => !keys.includes(key));
  if (unknown.length > 0) {
    refuse("invalid_choice", `choice names keys this ballot does not have: ${unknown.join(", ")}`, {
      field: "choice", unknown, options: keys,
    }, choiceRemedy);
  }
  if (chosen.size < (input.choice as string[]).length) advice.push("choice repeated a key; each option is approved once.");
  const choice = keys.filter((key) => chosen.has(key));
  if (terms.pick !== undefined && choice.length > terms.pick) {
    refuse("invalid_choice", `this ballot lets a unit approve at most ${terms.pick} options`, {
      field: "choice", pick: terms.pick,
    }, { say: `Approve at most ${terms.pick} of ${keys.join(", ")}.` });
  }

  const evidence = voteEvidence(input.evidence);
  const why = voteReasons(input.why, evidence.length);
  const shared = textField(input.shared, "shared", MAX_VOTE_SHARED, { required: false, multiline: true });

  const vote: SealedVote = { choice, why, evidence };
  if (shared !== null) vote.shared = shared;
  checkVoteSize(vote, PLACEHOLDER_ENTRY_IDS);
  if (why.length === 0) advice.push('No reason given: the vote is counted and shown as "no reason given".');
  return { vote, advice };
}

/**
 * The vote as sealed: evidence replaced by its resolved form (same lines, same
 * order) and the session's declared model added when it has one.
 */
export function sealVote(
  vote: SealedVote,
  extra: { evidence?: readonly VoteEvidence[]; model?: string | null } = {},
): SealedVote {
  const sealed: SealedVote = { choice: [...vote.choice], why: vote.why.map((reason) => ({ ...reason, cites: [...reason.cites] })), evidence: [...vote.evidence] };
  if (vote.shared !== undefined) sealed.shared = vote.shared;
  if (extra.evidence !== undefined) {
    const lines = vote.evidence.map(evidenceText);
    const resolved = extra.evidence.map(evidenceText);
    if (canonicalJson(lines) !== canonicalJson(resolved)) {
      throw new CollabError("invalid_vote_evidence", "resolved evidence must keep the voter's lines in the same order");
    }
    sealed.evidence = [...extra.evidence];
  }
  const model = typeof extra.model === "string" ? extra.model.trim() : "";
  if (model) sealed.model = model;
  return sealed;
}

/** True when two votes carry the same input: what a retry compares, ignoring resolution and model. */
export function sameVoteInput(left: SealedVote, right: SealedVote): boolean {
  const input = (vote: SealedVote) => canonicalJson({
    choice: vote.choice,
    why: vote.why.map((reason) => ({ text: reason.text, basis: reason.basis ?? null, cites: reason.cites })),
    evidence: vote.evidence.map(evidenceText),
    shared: vote.shared ?? null,
  });
  return input(left) === input(right);
}

/** Refuses a vote whose revealed entry would exceed 8 KiB of canonical UTF-8. */
export function checkVoteSize(
  vote: SealedVote,
  ids: { ballot_id: string; cast_id: string; unit_id: string; session_id: string },
): void {
  const bytes = revealedEntryBytes({
    ...ids,
    cast_seq: MAX_CASTS_PER_SESSION,
    commitment: "0".repeat(64),
    salt: "0".repeat(64),
    status: "seal_unreadable",
    vote,
  });
  if (bytes > MAX_REVEALED_ENTRY_BYTES) {
    refuse("too_long", `the vote takes ${bytes} bytes when revealed; the limit is ${MAX_REVEALED_ENTRY_BYTES}`, {
      field: "vote", max: MAX_REVEALED_ENTRY_BYTES, bytes,
    }, { say: "Shorten the reasons, the evidence lines or shared." });
  }
}

/**
 * The next cast_seq for a session that has already cast `previousCasts` times
 * in this ballot. cast_seq counts per session.
 */
export function nextCastSeq(previousCasts: number): number {
  if (previousCasts >= MAX_CASTS_PER_SESSION) {
    refuse("cast_limit", `A session may cast at most ${MAX_CASTS_PER_SESSION} times in one ballot`, {
      max: MAX_CASTS_PER_SESSION,
    }, { say: "Your latest cast stands; it is revealed at the close." });
  }
  return previousCasts + 1;
}

function voteEvidence(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    refuse("invalid_evidence", "evidence is a list of one-line pointers", { field: "evidence" }, {
      say: 'Give evidence as lines such as "file src/a.ts:10-20" or "commit <sha>".',
    });
  }
  if (value.length > MAX_VOTE_EVIDENCE) {
    refuse("too_long", `evidence holds at most ${MAX_VOTE_EVIDENCE} lines on a vote`, { field: "evidence", max: MAX_VOTE_EVIDENCE }, {
      say: `Keep the ${MAX_VOTE_EVIDENCE} pointers that matter most.`,
    });
  }
  return value.map((line, index) => {
    const field = `evidence[${index}]`;
    const text = textField(line, field, Number.MAX_SAFE_INTEGER, {
      required: true, multiline: false, code: "invalid_evidence",
    }) as string;
    // The same grammar as a note's Evidence lines (spec 5.3), so the store can
    // resolve file and commit cites at cast time and a reader can follow each one.
    try {
      parseEvidence(text);
    } catch (error) {
      if (!(error instanceof CollabError)) throw error;
      refuse("invalid_evidence", error.message, { ...error.details, field }, {
        say: 'Give evidence as lines such as "file src/a.ts:10-20", "commit <sha>" or "test bun test exit=0".',
      });
    }
    return text;
  });
}

function voteReasons(value: unknown, evidenceCount: number): VoteReason[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    refuse("invalid_why", "why is a list of {text, basis?, cites?}", { field: "why" }, { say: "Give each reason as {text, basis, cites}." });
  }
  if (value.length > MAX_VOTE_REASONS) {
    refuse("too_long", `why holds at most ${MAX_VOTE_REASONS} reasons on a vote`, { field: "why", max: MAX_VOTE_REASONS }, {
      say: `Keep the ${MAX_VOTE_REASONS} reasons that matter most.`,
    });
  }
  return value.map((reason, index): VoteReason => {
    const field = `why[${index}]`;
    if (reason === null || typeof reason !== "object" || Array.isArray(reason)) {
      refuse("invalid_why", `${field} must be {text, basis?, cites?}`, { field }, { say: "Give each reason as {text, basis, cites}." });
    }
    const record = reason as Record<string, unknown>;
    const text = textField(record.text, `${field}.text`, MAX_VOTE_REASON, { required: true, multiline: true, code: "invalid_why" }) as string;
    const result: VoteReason = { text, cites: [] };
    if (record.basis !== undefined && record.basis !== null) {
      if (!(BALLOT_BASES as readonly unknown[]).includes(record.basis)) {
        refuse("invalid_why", `${field}.basis is one of ${BALLOT_BASES.join(", ")}`, { field: `${field}.basis`, bases: [...BALLOT_BASES] }, {
          say: "Say how you know it: seen, told, inferred or quoted.",
        });
      }
      result.basis = record.basis as BallotBasis;
    }
    if (record.cites !== undefined && record.cites !== null) {
      const cites = record.cites;
      if (!Array.isArray(cites) || cites.some((cite) => !Number.isInteger(cite) || cite < 1 || cite > evidenceCount)) {
        refuse("invalid_why", `${field}.cites are 1-based positions in evidence (1 to ${evidenceCount})`, {
          field: `${field}.cites`, min: 1, max: evidenceCount,
        }, { say: evidenceCount === 0 ? "Add the evidence lines the reason cites, or drop cites." : `Cite evidence lines 1 to ${evidenceCount}.` });
      }
      result.cites = [...new Set(cites as number[])].sort((left, right) => left - right);
    }
    return result;
  });
}

// ---------------------------------------------------------------------------
// Commitment and seals

export interface CommitmentInput {
  workspace_id: string;
  ballot_id: string;
  cast_id: string;
  unit_id: string;
  session_id: string;
  vote: SealedVote;
  /** 32 random bytes as 64 lowercase hex characters. */
  salt: string;
}

const SALT = /^[0-9a-f]{64}$/;

/** sha256(canonicalJson({protocol, workspace_id, ballot_id, cast_id, unit_id, session_id, vote, salt})), as hex. */
export function ballotCommitment(input: CommitmentInput): string {
  if (!SALT.test(input.salt)) {
    throw new CollabError("invalid_salt", "a ballot salt is 32 random bytes as 64 lowercase hex characters");
  }
  return sha256(canonicalJson({
    protocol: BALLOT_COMMITMENT_PROTOCOL,
    workspace_id: input.workspace_id,
    ballot_id: input.ballot_id,
    cast_id: input.cast_id,
    unit_id: input.unit_id,
    session_id: input.session_id,
    vote: input.vote,
    salt: input.salt,
  }));
}

/** What a `ballot.cast` event records. */
export interface BallotCastEvent {
  cast_id: string;
  unit_id: string;
  session_id: string;
  commitment: string;
  cast_seq: number;
}

/** The seal file a cast writes beside the journal. */
export interface SealFile {
  cast_id: string;
  journal_realpath: string;
  session_id: string;
  unit_id: string;
  salt: string;
  vote: SealedVote;
}

export type BrokenSeal = "seal_missing" | "seal_unreadable" | "seal_mismatch";

export type SealOutcome =
  | {
    state: "ok";
    /** Exactly the committed vote, so anyone can re-verify the revealed entry. */
    vote: SealedVote;
    salt: string;
    /** False when another journal wrote the file; the caller must then leave it in place. */
    owned: boolean;
  }
  | { state: BrokenSeal };

/**
 * Checks a parsed seal file against its `ballot.cast` event. A file that is
 * not a seal is unreadable; one whose ids or commitment disagree with the
 * event is a mismatch. The caller reports an absent file as seal_missing.
 */
export function openSeal(
  file: unknown,
  cast: BallotCastEvent,
  context: { workspace_id: string; ballot_id: string; journal_realpath?: string },
): SealOutcome {
  if (!isPlainObject(file)) return { state: "seal_unreadable" };
  const { cast_id, journal_realpath, session_id, unit_id, salt, vote } = file;
  if (
    typeof cast_id !== "string"
    || typeof journal_realpath !== "string"
    || typeof session_id !== "string"
    || typeof unit_id !== "string"
    || typeof salt !== "string"
    || !SALT.test(salt)
    || !isSealedVote(vote)
  ) {
    return { state: "seal_unreadable" };
  }
  if (cast_id !== cast.cast_id || session_id !== cast.session_id || unit_id !== cast.unit_id) return { state: "seal_mismatch" };
  const commitment = ballotCommitment({
    workspace_id: context.workspace_id,
    ballot_id: context.ballot_id,
    cast_id,
    unit_id,
    session_id,
    vote,
    salt,
  });
  if (commitment !== cast.commitment) return { state: "seal_mismatch" };
  return {
    state: "ok",
    vote,
    salt,
    owned: context.journal_realpath === undefined || context.journal_realpath === journal_realpath,
  };
}

// ---------------------------------------------------------------------------
// Reveal

export type RevealedStatus =
  | "counted"
  | "replaced"
  | "late"
  | "unit_conflict"
  | "seal_missing"
  | "seal_unreadable"
  | "seal_mismatch";

/** One `ballot.revealed` payload. `salt` and `vote` are present only when the seal verified. */
export interface RevealedEntry {
  ballot_id: string;
  cast_id: string;
  unit_id: string;
  session_id: string;
  cast_seq: number;
  commitment: string;
  status: RevealedStatus;
  salt?: string;
  vote?: SealedVote;
}

export interface CastToResolve extends BallotCastEvent {
  /** The caster's voice, from its attested lineage. */
  voice_id: string;
  seal: SealOutcome;
}

/**
 * Gives every cast its revealed status. `casts` must be in journal order.
 *
 * - A cast whose voice is not listed in the unit it recorded is late.
 * - Within a unit, each voice's latest cast stands and its earlier ones are
 *   replaced; a broken latest seal is never covered by an earlier cast.
 * - Latest casts from two different listed voices of one unit are a
 *   unit_conflict: neither is counted.
 * - Otherwise the latest cast is counted when its seal verified.
 */
export function resolveCasts(
  units: readonly ElectorateUnit[],
  casts: readonly CastToResolve[],
  context: { ballot_id: string },
): RevealedEntry[] {
  const unitById = new Map(units.map((unit) => [unit.unit_id, unit]));
  const listed = casts.map((cast) => unitById.get(cast.unit_id)?.voice_ids.includes(cast.voice_id) === true);
  const latestByVoice = new Map<string, number>();
  const castingVoices = new Map<string, Set<string>>();
  casts.forEach((cast, index) => {
    if (!listed[index]) return;
    latestByVoice.set(voiceKey(cast), index);
    const voices = castingVoices.get(cast.unit_id) ?? new Set<string>();
    voices.add(cast.voice_id);
    castingVoices.set(cast.unit_id, voices);
  });

  return casts.map((cast, index): RevealedEntry => {
    let status: RevealedStatus;
    if (!listed[index]) status = "late";
    else if (latestByVoice.get(voiceKey(cast)) !== index) status = "replaced";
    else if ((castingVoices.get(cast.unit_id)?.size ?? 0) > 1) status = "unit_conflict";
    else if (cast.seal.state !== "ok") status = cast.seal.state;
    else status = "counted";
    const entry: RevealedEntry = {
      ballot_id: context.ballot_id,
      cast_id: cast.cast_id,
      unit_id: cast.unit_id,
      session_id: cast.session_id,
      cast_seq: cast.cast_seq,
      commitment: cast.commitment,
      status,
    };
    if (cast.seal.state !== "ok") return entry;
    const revealed: RevealedEntry = { ...entry, salt: cast.seal.salt, vote: cast.seal.vote };
    if (revealedEntryBytes(revealed) <= MAX_REVEALED_ENTRY_BYTES) return revealed;
    // A verified seal over the bound was not cast through this build's checks.
    // Revealing it would fail the payload guard and strand the ballot sealed,
    // so its content is left out and it is never counted.
    return status === "counted" ? { ...entry, status: "seal_unreadable" } : entry;
  });
}

export function revealedEntryBytes(entry: RevealedEntry): number {
  return Buffer.byteLength(canonicalJson(entry), "utf8");
}

/** For `ballot.closed`: sha256 of the canonical list of revealed entries, in journal order. */
export function revealedEntriesSha256(entries: readonly RevealedEntry[]): string {
  return sha256(canonicalJson(entries));
}

export type UnitOutcome =
  | { unit_id: string; state: "not_cast" }
  | { unit_id: string; state: "counted"; entry: RevealedEntry & { vote: SealedVote }; abstained: boolean }
  | { unit_id: string; state: "unit_conflict"; entries: RevealedEntry[] }
  | { unit_id: string; state: BrokenSeal; entry: RevealedEntry };

/**
 * One outcome per electorate unit, from recorded statuses. Every outcome but
 * not_cast counts toward turnout; only counted counts toward quorum, and only
 * a counted unit's approvals count toward an option.
 */
export function unitOutcomes(units: readonly ElectorateUnit[], entries: readonly RevealedEntry[]): UnitOutcome[] {
  return units.map((unit): UnitOutcome => {
    const own = entries.filter((entry) => entry.unit_id === unit.unit_id && entry.status !== "late");
    if (own.length === 0) return { unit_id: unit.unit_id, state: "not_cast" };
    const counted = own.filter((entry) => entry.status === "counted");
    const conflicts = own.filter((entry) => entry.status === "unit_conflict");
    // Two counted entries in one unit can only come from a damaged record;
    // treat them as the conflict they are rather than pick one.
    if (conflicts.length > 0 || counted.length > 1) {
      return { unit_id: unit.unit_id, state: "unit_conflict", entries: [...conflicts, ...counted] };
    }
    const only = counted[0];
    if (only !== undefined) {
      if (only.vote === undefined) return { unit_id: unit.unit_id, state: "seal_unreadable", entry: only };
      const entry = only as RevealedEntry & { vote: SealedVote };
      return { unit_id: unit.unit_id, state: "counted", entry, abstained: entry.vote.choice.length === 0 };
    }
    const latest = own[own.length - 1] as RevealedEntry;
    const state: BrokenSeal = latest.status === "seal_unreadable" || latest.status === "seal_mismatch"
      ? latest.status
      : "seal_missing";
    return { unit_id: unit.unit_id, state, entry: latest };
  });
}

// ---------------------------------------------------------------------------
// Result

export type BallotStatus = "top_choice" | "tied" | "no_approval" | "inconclusive" | "withdrawn";

export interface SessionLabel {
  name: string;
  seat_ref?: string | null;
  model?: string | null;
}

export interface LeftOutSession {
  session_id: string;
  name: string;
  last_seen_minutes: number;
}

export interface BallotResultInput {
  terms: Pick<BallotTerms, "options" | "quorum">;
  units: readonly ElectorateUnit[];
  /** The ballot's `ballot.revealed` payloads, in journal order. */
  entries: readonly RevealedEntry[];
  /** True when the opener's withdraws report targets the poll report. */
  withdrawn: boolean;
  /** Display labels for casting sessions; an unknown session shows its id. */
  sessions?: Readonly<Record<string, SessionLabel>>;
  /** Sessions a ballot.opened item was returned to by collab_arrive or collab_inbox. */
  delivered_session_ids?: readonly string[];
  left_out?: readonly LeftOutSession[];
}

export interface BallotReasonView {
  by: string;
  text: string;
  basis: BallotBasis | null;
  cites: number[];
  /** The evidence lines the reason cites, from the same vote. */
  cited: VoteEvidence[];
}

export interface BallotEvidenceView {
  evidence: VoteEvidence;
  cited_by: string[];
}

export interface BallotOptionView {
  key: string;
  label: string;
  units: number;
  voters: string[];
  reasons: BallotReasonView[];
  no_reason_given: string[];
  /** Evidence its voters cited that no voter for a top option cited. */
  unique_evidence: BallotEvidenceView[];
}

export interface BallotEntryView {
  cast_id: string;
  unit_id: string;
  session_id: string;
  name: string;
  cast_seq: number;
  /** Present when the seal verified. */
  choice?: string[];
  same_handle_as?: string;
}

export interface BallotResult {
  status: BallotStatus;
  split: boolean;
  turnout: { cast: number; electorate: number; delivery_recorded: number };
  quorum: { needed: number; met: boolean; counted: number };
  options: BallotOptionView[];
  top: string[];
  abstained: string[];
  late: BallotEntryView[];
  replaced: BallotEntryView[];
  unit_conflicts: BallotEntryView[];
  seal_missing: BallotEntryView[];
  seal_unreadable: BallotEntryView[];
  seal_mismatch: BallotEntryView[];
  left_out: LeftOutSession[];
  lineages: Record<string, number>;
  notes: string[];
  unit_basis: string;
  sealing: string;
  authorises: string;
  next?: { say: string };
}

/**
 * The result, computed from the journal on every read and never stored.
 * There is no tie-break, and nothing here weights a unit by its model,
 * confidence or reasons.
 */
export function ballotResult(input: BallotResultInput): BallotResult {
  const sessions = input.sessions ?? {};
  const nameOf = (sessionId: string) => sessions[sessionId]?.name ?? sessionId;
  const keys = input.terms.options.map((option) => option.key);
  const unitIds = new Set(input.units.map((unit) => unit.unit_id));
  const outcomes = unitOutcomes(input.units, input.entries);
  const counted = outcomes.filter((outcome): outcome is Extract<UnitOutcome, { state: "counted" }> => outcome.state === "counted");
  // Listed by name, so neither the cast order nor a hash decides who reads first.
  const approvals = counted.map((outcome) => ({
    entry: outcome.entry,
    name: nameOf(outcome.entry.session_id),
    keys: keys.filter((key) => outcome.entry.vote.choice.includes(key)),
    lineage: lineageOf(outcome.entry, sessions, input.units),
  })).sort((left, right) => compare(left.name, right.name) || compare(left.entry.unit_id, right.entry.unit_id));

  const quorum = { needed: input.terms.quorum, met: counted.length >= input.terms.quorum, counted: counted.length };
  const tallies = keys.map((key) => approvals.filter((approval) => approval.keys.includes(key)).length);
  const most = Math.max(0, ...tallies);
  let status: BallotStatus;
  let top: string[] = [];
  if (input.withdrawn) status = "withdrawn";
  else if (!quorum.met) status = "inconclusive";
  else if (most === 0) status = "no_approval";
  else {
    top = keys.filter((_, index) => tallies[index] === most);
    status = top.length > 1 ? "tied" : "top_choice";
  }

  const topSet = new Set(top);
  const answered = new Set(approvals
    .filter((approval) => approval.keys.some((key) => topSet.has(key)))
    .flatMap((approval) => approval.entry.vote.evidence.map(evidenceKey)));

  const options = input.terms.options.map((option): BallotOptionView => {
    const voters = approvals.filter((approval) => approval.keys.includes(option.key));
    const unique = new Map<string, BallotEvidenceView>();
    for (const voter of voters) {
      for (const item of voter.entry.vote.evidence) {
        const key = evidenceKey(item);
        if (answered.has(key)) continue;
        const view = unique.get(key);
        if (view === undefined) unique.set(key, { evidence: item, cited_by: [voter.name] });
        else if (!view.cited_by.includes(voter.name)) view.cited_by.push(voter.name);
      }
    }
    return {
      key: option.key,
      label: option.label,
      units: voters.length,
      voters: voters.map((voter) => voter.name),
      reasons: voters.flatMap((voter) => voter.entry.vote.why.map((reason): BallotReasonView => ({
        by: voter.name,
        text: reason.text,
        basis: reason.basis ?? null,
        cites: [...reason.cites],
        cited: reason.cites.flatMap((cite) => {
          const item = voter.entry.vote.evidence[cite - 1];
          return item === undefined ? [] : [item];
        }),
      }))),
      no_reason_given: voters.filter((voter) => voter.entry.vote.why.length === 0).map((voter) => voter.name),
      unique_evidence: [...unique.values()],
    };
  });

  const approvalSets = new Set(approvals.filter((approval) => approval.keys.length > 0).map((approval) => approval.keys.join("\n")));
  const split = approvalSets.size > 1;

  const lineages: Record<string, number> = {};
  for (const label of sortedUnique(approvals.map((approval) => approval.lineage.label))) {
    lineages[label] = approvals.filter((approval) => approval.lineage.label === label).length;
  }

  const notes: string[] = [];
  const oneFamily = (values: readonly (string | null)[]) =>
    values.length >= 2 && values.every((family) => family !== null && family === values[0]);
  if (oneFamily(approvals.map((approval) => approval.lineage.family))) {
    notes.push(BALLOT_SAME_FAMILY_NOTE);
  } else {
    for (const key of top) {
      const supporting = approvals
        .filter((approval) => approval.keys.includes(key))
        .map((approval) => approval.lineage.family);
      if (oneFamily(supporting)) {
        notes.push(`every unit approving ${key} declares the same model family (${supporting[0]}): their agreement is not independent confirmation`);
      }
    }
  }
  if (split) notes.push(BALLOT_SPLIT_NOTE);

  const view = (entry: RevealedEntry): BallotEntryView => {
    const result: BallotEntryView = {
      cast_id: entry.cast_id,
      unit_id: entry.unit_id,
      session_id: entry.session_id,
      name: nameOf(entry.session_id),
      cast_seq: entry.cast_seq,
    };
    if (entry.vote !== undefined) result.choice = [...entry.vote.choice];
    return result;
  };
  const late = input.entries
    .filter((entry) => entry.status === "late" || !unitIds.has(entry.unit_id))
    .map((entry) => {
      const result = view(entry);
      const seatRef = sessions[entry.session_id]?.seat_ref;
      if (nonEmptyString(seatRef)) {
        const sameHandle = input.units.find((unit) => unit.seat_refs.includes(seatRef));
        if (sameHandle) result.same_handle_as = sameHandle.unit_id;
      }
      return result;
    });
  const listedWith = (status: RevealedStatus) =>
    input.entries.filter((entry) => entry.status === status && unitIds.has(entry.unit_id)).map(view);

  const delivered = new Set(input.delivered_session_ids ?? []);
  const result: BallotResult = {
    status,
    split,
    turnout: {
      cast: outcomes.filter((outcome) => outcome.state !== "not_cast").length,
      electorate: input.units.length,
      delivery_recorded: input.units.filter((unit) => unit.session_ids.some((id) => delivered.has(id))).length,
    },
    quorum,
    options,
    top,
    abstained: approvals.filter((approval) => approval.keys.length === 0).map((approval) => approval.name),
    late,
    replaced: listedWith("replaced"),
    unit_conflicts: listedWith("unit_conflict"),
    seal_missing: listedWith("seal_missing"),
    seal_unreadable: listedWith("seal_unreadable"),
    seal_mismatch: listedWith("seal_mismatch"),
    left_out: [...(input.left_out ?? [])],
    lineages,
    notes,
    unit_basis: unitBasis(input.units),
    sealing: BALLOT_SEALING,
    authorises: BALLOT_AUTHORISES,
  };
  if (status === "tied") result.next = { ...BALLOT_TIE_NEXT };
  return result;
}

/**
 * The family of a model or host label: its first word, lower-cased
 * ("claude-opus-5.5" and "claude-code" are both "claude"). A heuristic for a
 * display note; it never changes a count.
 */
export function modelFamily(label: string): string | null {
  const head = label.trim().toLowerCase().split(/[\s\-_/:.@]/)[0];
  return head ? head : null;
}

/** A unit's lineage: its declared model, else the host family in its seat_ref prefix. */
function lineageOf(
  entry: RevealedEntry & { vote: SealedVote },
  sessions: Readonly<Record<string, SessionLabel>>,
  units: readonly ElectorateUnit[],
): { label: string; family: string | null } {
  const session = sessions[entry.session_id];
  const declared = (entry.vote.model ?? session?.model ?? "").trim();
  if (declared) return { label: declared, family: modelFamily(declared) };
  const seatRefs = nonEmptyString(session?.seat_ref)
    ? [session.seat_ref]
    : units.find((unit) => unit.unit_id === entry.unit_id)?.seat_refs ?? [];
  const prefixes = sortedUnique(seatRefs.flatMap((seatRef) => {
    const colon = seatRef.indexOf(":");
    return colon > 0 ? [seatRef.slice(0, colon)] : [];
  }));
  const prefix = prefixes.length === 1 ? prefixes[0] : undefined;
  if (prefix !== undefined) return { label: `host:${prefix}`, family: modelFamily(prefix) };
  return { label: "undeclared", family: null };
}

// ---------------------------------------------------------------------------
// Helpers

export function evidenceText(item: VoteEvidence): string {
  return typeof item === "string" ? item : item.text;
}

/**
 * Two cites are the same evidence when they point at the same thing with the
 * same observed content; how it was observed does not matter.
 */
export function evidenceKey(item: VoteEvidence): string {
  if (typeof item !== "string" && nonEmptyString(item.kind) && nonEmptyString(item.locator)) {
    return `ref:${canonicalJson({
      kind: item.kind,
      locator: item.locator,
      lines: item.lines ?? null,
      sha256: item.sha256 ?? null,
      exit: item.exit ?? null,
    })}`;
  }
  return `text:${evidenceText(item).replace(/\s+/g, " ").trim()}`;
}

function textField(
  value: unknown,
  field: string,
  max: number,
  options: { required: boolean; multiline: boolean; code?: string },
): string | null {
  const code = options.code ?? `invalid_${field}`;
  const fix = { say: `Give ${field} as plain text${options.multiline ? "" : " on one line"}.` };
  if (value === undefined || value === null) {
    if (options.required) refuse(code, `${field} is required`, { field }, fix);
    return null;
  }
  if (typeof value !== "string") refuse(code, `${field} must be text`, { field }, fix);
  // Section 4's rule, shared with notes, so a poll's terms and a vote's
  // reasons normalise exactly as the note that carries them.
  const text = normalizeNoteText(value);
  if (!text) {
    if (options.required) refuse(code, `${field} must not be empty`, { field }, fix);
    return null;
  }
  if (text.includes("\0")) refuse(code, `${field} must not contain NUL characters`, { field }, fix);
  // Half of a character, as when a host cuts an emoji at a UTF-16 boundary:
  // the store would not keep it as given, as note.ts explains.
  if (hasLoneSurrogate(text)) {
    refuse(code, `${field} must be well-formed Unicode text (it holds half of a character, as when an emoji is cut in two)`, { field }, {
      say: `Send ${field} again with every character whole.`,
    });
  }
  if (!options.multiline && text.includes("\n")) refuse(code, `${field} must be one line`, { field }, fix);
  if (text.length > max) {
    refuse("too_long", `${field} exceeds ${max} characters`, { field, max }, {
      say: `Shorten ${field} to at most ${max} characters.`,
    });
  }
  return text;
}

function isSealedVote(value: unknown): value is SealedVote {
  if (!isPlainObject(value) || !jsonClean(value)) return false;
  const { choice, why, evidence, shared, model } = value;
  if (!Array.isArray(choice) || choice.some((key) => typeof key !== "string")) return false;
  if (!Array.isArray(evidence) || evidence.some((item) => typeof item !== "string" && !(isPlainObject(item) && typeof item.text === "string"))) {
    return false;
  }
  if (!Array.isArray(why) || why.some((reason) =>
    !isPlainObject(reason)
    || typeof reason.text !== "string"
    || !(reason.basis === undefined || (BALLOT_BASES as readonly unknown[]).includes(reason.basis))
    || !Array.isArray(reason.cites)
    || reason.cites.some((cite) => !Number.isInteger(cite))
  )) {
    return false;
  }
  return (shared === undefined || typeof shared === "string") && (model === undefined || typeof model === "string");
}

/** The payload guard's shape rules (spec 8.3): no undefined, no non-integer numbers, no integer-like keys. */
function jsonClean(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isSafeInteger(value);
  if (Array.isArray(value)) return value.every(jsonClean);
  if (isPlainObject(value)) {
    return Object.entries(value).every(([key, child]) => !/^(0|[1-9]\d*)$/.test(key) && jsonClean(child));
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function voiceKey(cast: { unit_id: string; voice_id: string }): string {
  return `${cast.unit_id}\n${cast.voice_id}`;
}

function definedEntries(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compare);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function refuse(code: string, message: string, details: Record<string, unknown>, remedy: BallotRemedy): never {
  throw new CollabError(code, message, { ...details, remedy });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
