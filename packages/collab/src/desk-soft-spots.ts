/**
 * The soft spots of consent/v1 that the agents' proposal views already show
 * (Collab Notes spec section 6), written for the person desk. The owner was
 * asked (spec 13 q4) whether the desk may show them before the person agrees
 * and said yes on 2026-11-12, as display only. Every line names the
 * proposal's own rule; on a consent/v2 proposal each set-aside has a line of
 * its own, since a set-aside challenge stays in what the person is shown.
 *
 * Display only means: these facts go in one new optional JSON key and in the
 * text the person reads, never in the act bytes, the ai_snapshot, the
 * proposal bytes or anything else a person signs or a store hashes, and they
 * change nothing the desk accepts or refuses.
 *
 * The facts are noteProposalData's (src/store-notes.ts), the read every
 * agent-facing proposal view makes, so the desk and the agents see the same
 * ones. This module only selects and words them; it reads nothing itself.
 */
import { CONSENT_RULE, CONSENT_RULE_V2, type ConsentRule, type ProposalSetAside, type ProposalStatus } from "./protocol.js";
import type { NoteProposalData, NoteStanceView } from "./store-notes.js";

/** Beside carried objections in every view, agents' and the desk's (spec 5.6), naming the proposal's rule. */
export function carriedObjectionsSentence(rule: ConsentRule = CONSENT_RULE): string {
  return `Carried objections are text in the terms the person signs. Under ${rule} they do not block this proposal. Each objector may challenge again.`;
}

/** The consent/v1 wording, which every consent/v1 view keeps. */
export const CARRIED_OBJECTIONS_SENTENCE = carriedObjectionsSentence(CONSENT_RULE);

/** Beside every set-aside, agents' views and the desk's (consent/v2). */
export const SET_ASIDE_SENTENCE =
  "A challenge the person set aside no longer blocks the position. It stays on the record and in what the person is shown; any voice, its own included, may challenge again, and a new challenge stands as usual.";

export const SOFT_SPOTS_DISPLAY_ONLY =
  "Display only: these lines are not in the bytes the person signs or in any hash, they change no count, and the desk accepts and refuses exactly as it would without them.";

/** The heading the terminal and the signing page put above the lines. */
export const SOFT_SPOTS_HEADING =
  "Soft spots the agents' views show on this proposal. Display only: not in the bytes you sign; they change no count and nothing the desk accepts or refuses.";

export function softSpotsDeliveryNote(rule: ConsentRule = CONSENT_RULE): string {
  return `Under ${rule} silence from an awaited voice does not stop the position settling at the close. A delivery is recorded only when collab_arrive or collab_inbox returned the question; reads through legacy tools or host messages are not recorded.`;
}

export const SOFT_SPOTS_DELIVERY_NOTE = softSpotsDeliveryNote(CONSENT_RULE);

export const SOFT_SPOTS_NOT_REPORTED =
  "The other device's desk reported no soft spots (an older build does not compute them). None are shown here, which does not mean there are none.";

/** Lines of one kind shown before the rest are counted; the JSON lists every one. */
export const SOFT_SPOT_LINES_PER_KIND = 10;
const EXCERPT_MAX = 160;
// Bounds on what another device's desk may put on this device's signing page.
const MAX_REMOTE_LINES = 64;
const MAX_REMOTE_LINE = 2_000;

type Who = { session: string | null; name: string };

export interface DeskSoftSpots {
  /** The proposal and the agents' position these facts were read with (a read apart from the status shown). */
  proposal_sha256: string;
  position: string;
  observed_at: string;
  /** Voices the proposal awaits that collab_arrive or collab_inbox never returned it to. */
  awaited_without_delivery: Array<{ voice: string; name: string; last_seen_minutes: number | null }>;
  /** Standing supports whose session shares the author's handle or name, or started after the open. */
  flagged_supports: Array<{
    report: string;
    by: Who;
    voice: string | null;
    counted: boolean;
    flags: Array<"same_seat_as_author" | "same_name_as_author" | "started_after_open">;
  }>;
  /** Standing challenges whose challenger's session has ended. */
  ended_challengers: Array<{ report: string; by: Who; voice: string | null; voice_has_active_session: boolean; statement: string }>;
  /** Standing supports and challenges with no reason and no evidence. */
  ungrounded: Array<{ report: string; relation: "supports" | "challenges"; by: Who; counted: boolean; basis: string }>;
  /** The proposal this one replaced, when it replaced one. */
  replaced: string | null;
  /** Objections raised on the replaced lineage that these terms carry or that still stand where raised. */
  carried_objections: Array<{
    challenge: string;
    by: Who;
    voice: string | null;
    raised_on: string;
    carried_in_terms: boolean;
    standing_on_replaced: boolean;
    re_raised_here: boolean;
    counted_by_consent_v1: false;
    statement: string;
  }>;
  /** carriedObjectionsSentence(rule), present when carried_objections is not empty. */
  carried_note?: string;
  /** consent/v2 only: the proposal's rule, and each challenge the person set aside. */
  rule?: ConsentRule;
  set_asides?: Array<{
    challenge: string;
    by: Who;
    set_aside: string;
    at: string;
    basis: ProposalSetAside["basis"];
    reason: string;
    statement: string;
  }>;
  /** How many items the lists above hold together; a stance may be in two lists. */
  count: number;
  /** The same facts as text, empty when there are none. */
  lines: string[];
  display_only: string;
}

/** A proposal whose soft spots could not be read: said plainly, never shown as none. */
export interface DeskSoftSpotsUnavailable {
  unavailable: string;
  lines: string[];
  display_only: string;
}

export type DeskSoftSpotsEntry = DeskSoftSpots | DeskSoftSpotsUnavailable;

/** What the terminal and the page need from an entry, local or from another device's desk. */
export interface SoftSpotsShown {
  lines: string[];
  position?: string;
  proposal_sha256?: string;
}

/**
 * Agent-written text inside a desk line, as JSON so it cannot pose as a line
 * of its own, with format characters escaped as the terminal shows them, so
 * bidirectional controls cannot reorder a line on the signing page either.
 */
function quoted(text: string): string {
  return JSON.stringify(text).replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029]/gu, (char) =>
    `\\u{${char.codePointAt(0)!.toString(16).toUpperCase()}}`
  );
}

function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  // Cut between characters, never inside one, and say that it was cut.
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}

function excerpt(statement: string): string {
  return cut(statement, EXCERPT_MAX);
}

function minutesSince(at: string, observedAt: string): number | null {
  const age = Date.parse(observedAt) - Date.parse(at);
  return Number.isFinite(age) ? Math.max(0, Math.floor(age / 60_000)) : null;
}

function who(stance: NoteStanceView): Who {
  return { session: stance.from_session_id, name: stance.from_actor };
}

function counted(value: boolean, rule: ConsentRule): string {
  return value ? `counted by ${rule}` : `not counted by ${rule}`;
}

const FLAG_WORDS = {
  same_seat_as_author: "its session declares the author's host handle (same_seat_as_author; the handle is unverified)",
  same_name_as_author: "it has the author's name (same_name_as_author)",
  started_after_open: "its session started after the proposal opened (started_after_open)",
} as const;

/** At most SOFT_SPOT_LINES_PER_KIND lines of one kind, then how many more the JSON holds. */
function capped(lines: string[], kind: string): string[] {
  if (lines.length <= SOFT_SPOT_LINES_PER_KIND) return lines;
  const rest = lines.length - SOFT_SPOT_LINES_PER_KIND;
  return [
    ...lines.slice(0, SOFT_SPOT_LINES_PER_KIND),
    `…and ${rest} more ${kind}; the JSON key soft_spots of person proposals --proposal lists every one.`,
  ];
}

/** Select and word one proposal's soft spots from the agents' own view of it. */
export function deskSoftSpots(data: NoteProposalData): DeskSoftSpots {
  const { status } = data;
  const rule = status.rule;
  const v2 = rule === CONSENT_RULE_V2;
  const awaited = data.consulted
    .filter((voice) => voice.awaited && !voice.delivery_recorded)
    .map((voice) => ({
      voice: voice.voice_id,
      name: voice.name,
      last_seen_minutes: voice.last_seen_at ? minutesSince(voice.last_seen_at, data.observed_at) : null,
    }));
  const flagged = data.supports
    .filter((stance) => stance.standing)
    .map((stance) => ({
      stance,
      flags: (["same_seat_as_author", "same_name_as_author", "started_after_open"] as const)
        .filter((flag) => stance.flags[flag] === true),
    }))
    .filter((entry) => entry.flags.length > 0);
  const ended = data.challenges.filter((stance) => stance.standing && stance.flags.challenger_ended === true);
  const ungrounded = [...data.supports, ...data.challenges]
    .filter((stance) => stance.standing && stance.flags.ungrounded === true);
  const carried = data.replaced?.carried ?? [];
  const setAside = v2 ? data.challenges.filter((stance) => stance.set_aside !== undefined) : [];

  const lines: string[] = [];
  const awaitedLines = awaited.map((voice) =>
    `Awaited voice ${quoted(voice.name)} (voice ${voice.voice}) has no recorded delivery on the notes surface, `
      + (voice.last_seen_minutes === null ? "and no session of it is listed here" : `last seen ${voice.last_seen_minutes} min ago`)
      + ": it may never have been shown this question."
  );
  lines.push(...capped(awaitedLines, "awaited voices"));
  if (awaited.length > 0) lines.push(softSpotsDeliveryNote(rule));
  lines.push(...capped(flagged.map(({ stance, flags }) => {
    const maybeAuthor = flags.includes("same_seat_as_author") || flags.includes("same_name_as_author");
    return `Support ${stance.id} by ${quoted(stance.from_actor)} (${counted(stance.counted, rule)}): `
      + `${flags.map((flag) => FLAG_WORDS[flag]).join("; ")}.`
      + (maybeAuthor ? " It may be the author's own voice in another session." : "");
  }), "flagged supports"));
  lines.push(...capped(ended.map((stance) =>
    `Challenge ${stance.id} by ${quoted(stance.from_actor)} still stands, but its challenger's session has ended`
      + (stance.voice_has_active_session
        ? "; another session of the same voice is active and can lift it."
        : ", and no session of its voice is active to lift it.")
      + ` While it stands the position cannot be consented.`
      + (v2 && stance.voice_has_live_session === false
        ? " Under consent/v2 the person can set it aside at the desk, with a reason, while no session of its voice is live."
        : "")
      + ` It said: ${quoted(excerpt(stance.statement))}`
  ), "challenges whose challenger's session has ended"));
  lines.push(...capped(ungrounded.map((stance) =>
    `${stance.relation === "supports" ? "Support" : "Challenge"} ${stance.id} by ${quoted(stance.from_actor)} `
      + `(${counted(stance.counted, rule)}) gives no reason and no evidence: `
      + (stance.grounded_by === "note"
        ? "the note has no Why and no Evidence lines."
        : "it has no evidence_refs and no confidence_basis (a legacy report's body is not read for reasons, so its text may still argue a case).")
  ), "stances with no reason or evidence"));
  lines.push(...capped(carried.map((entry) =>
    (entry.carried_in_terms
      ? `Objection ${entry.challenge_id} by ${quoted(entry.by)}, raised on ${entry.raised_on}, is carried as text in these terms`
        + (entry.standing_on_replaced ? " and still stands where it was raised" : " and no longer stands where it was raised")
      : `Objection ${entry.challenge_id} by ${quoted(entry.by)} still stands on ${entry.raised_on}, which this proposal replaces, `
        + "but is not in these terms")
      + (entry.re_raised_here ? "; the same voice also challenges this proposal, and that challenge is counted" : "")
      + `. It said: ${quoted(excerpt(entry.statement))}`
  ), "carried objections"));
  if (carried.length > 0) lines.push(carriedObjectionsSentence(rule));
  lines.push(...capped(setAside.map((stance) => {
    const entry = stance.set_aside!;
    return `Challenge ${stance.id} by ${quoted(stance.from_actor)} was set aside by the person at ${entry.created_at} `
      + `(${entry.basis}), while no session of its voice was live`
      + (entry.challenger.last_seen_at ? ` (last seen ${entry.challenger.last_seen_at})` : "")
      + `. Reason: ${quoted(entry.reason)}. It no longer blocks the position. It said: ${quoted(excerpt(stance.statement))}`;
  }), "set-aside challenges"));
  if (setAside.length > 0) lines.push(SET_ASIDE_SENTENCE);

  return {
    proposal_sha256: status.proposal_sha256,
    position: status.ai.position,
    observed_at: data.observed_at,
    awaited_without_delivery: awaited,
    flagged_supports: flagged.map(({ stance, flags }) => ({
      report: stance.id,
      by: who(stance),
      voice: stance.voice_id,
      counted: stance.counted,
      flags,
    })),
    ended_challengers: ended.map((stance) => ({
      report: stance.id,
      by: who(stance),
      voice: stance.voice_id,
      voice_has_active_session: stance.voice_has_active_session,
      statement: stance.statement,
    })),
    ungrounded: ungrounded.map((stance) => ({
      report: stance.id,
      relation: stance.relation,
      by: who(stance),
      counted: stance.counted,
      basis: stance.grounded_by === "note"
        ? "no Why and no Evidence lines"
        : "no evidence_refs and no confidence_basis (a legacy report's body is not read for reasons)",
    })),
    replaced: data.replaced?.proposal_id ?? null,
    carried_objections: carried.map((entry) => ({
      challenge: entry.challenge_id,
      by: { session: entry.by_session_id, name: entry.by },
      voice: entry.voice_id,
      raised_on: entry.raised_on,
      carried_in_terms: entry.carried_in_terms,
      standing_on_replaced: entry.standing_on_replaced,
      re_raised_here: entry.re_raised_here,
      counted_by_consent_v1: false,
      statement: entry.statement,
    })),
    ...(carried.length > 0 ? { carried_note: carriedObjectionsSentence(rule) } : {}),
    ...(v2
      ? {
        rule,
        set_asides: setAside.map((stance) => ({
          challenge: stance.id,
          by: who(stance),
          set_aside: stance.set_aside!.id,
          at: stance.set_aside!.created_at,
          basis: stance.set_aside!.basis,
          reason: stance.set_aside!.reason,
          statement: stance.statement,
        })),
      }
      : {}),
    count: awaited.length + flagged.length + ended.length + ungrounded.length + carried.length + setAside.length,
    lines,
    display_only: SOFT_SPOTS_DISPLAY_ONLY,
  };
}

export function softSpotsUnavailable(code: string): DeskSoftSpotsUnavailable {
  return {
    unavailable: code,
    lines: [`The soft spots could not be read (${code}). None are shown, which does not mean there are none.`],
    display_only: SOFT_SPOTS_DISPLAY_ONLY,
  };
}

/**
 * What the terminal and the signing page show above the exact bytes, or
 * null when there is nothing to show. `entry` is undefined when no soft
 * spots came back: from another device's desk, an older build; here, never.
 */
export function softSpotDisplay(
  entry: SoftSpotsShown | undefined,
  shown: ProposalStatus,
  table: "local" | "remote",
): { note: string; lines: string[] } | null {
  if (entry === undefined) {
    return {
      note: SOFT_SPOTS_HEADING,
      lines: [table === "remote" ? SOFT_SPOTS_NOT_REPORTED : softSpotsUnavailable("soft_spots_missing").lines[0]!],
    };
  }
  const lines = [...entry.lines];
  const position = entry.position !== undefined && entry.position !== shown.ai.position;
  const bytes = entry.proposal_sha256 !== undefined && entry.proposal_sha256 !== shown.proposal_sha256;
  if (position || bytes) {
    lines.push(
      `These lines were read with the agents' position ${quoted(entry.position ?? "unknown")} and proposal_sha256 `
        + `${entry.proposal_sha256 ?? "unknown"}; the summary shows ${shown.ai.position} and ${shown.proposal_sha256}. `
        + "The journal changed between the two reads; read it again before acting.",
    );
  }
  return lines.length > 0 ? { note: SOFT_SPOTS_HEADING, lines } : null;
}

/** The display as terminal summary lines: the heading, then one item per line. */
export function softSpotSummaryLines(display: { note: string; lines: string[] } | null): string[] {
  return display ? [display.note, ...display.lines.map((line) => `- ${line}`)] : [];
}

/**
 * A soft-spot entry another device's desk returned for one proposal, taken
 * only in the shape this desk writes; anything else is said to be unreadable.
 */
export function remoteSoftSpots(receipt: Record<string, unknown>, proposalId: string): SoftSpotsShown | undefined {
  const map = receipt.soft_spots;
  if (map === undefined) return undefined;
  const entry = map !== null && typeof map === "object" && !Array.isArray(map) && Object.hasOwn(map, proposalId)
    ? (map as Record<string, unknown>)[proposalId]
    : undefined;
  if (
    entry === null || typeof entry !== "object" || Array.isArray(entry)
    || !Array.isArray((entry as { lines?: unknown }).lines)
    || !((entry as { lines: unknown[] }).lines).every((line) => typeof line === "string")
  ) {
    return { lines: softSpotsUnavailable("remote_soft_spots_unreadable").lines };
  }
  const record = entry as { lines: string[]; position?: unknown; proposal_sha256?: unknown };
  const lines = record.lines.slice(0, MAX_REMOTE_LINES).map((line) => cut(line, MAX_REMOTE_LINE));
  if (record.lines.length > MAX_REMOTE_LINES) {
    lines.push(`…and ${record.lines.length - MAX_REMOTE_LINES} more lines from the other device's desk, not shown here.`);
  }
  return {
    lines,
    ...(typeof record.position === "string" ? { position: record.position } : {}),
    ...(typeof record.proposal_sha256 === "string" ? { proposal_sha256: record.proposal_sha256 } : {}),
  };
}
