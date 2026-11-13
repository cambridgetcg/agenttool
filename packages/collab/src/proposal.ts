/**
 * The agents' side of person–agent consent (consent/v1): lazy consensus over
 * report relations, computed from the journal rather than announced by a
 * session. Contract: docs/superpowers/specs/2026-10-29-collab-yu-ai-consent-design.md
 * section 4.3 in the AgentTool source repository.
 *
 * Confidence, the number of supports beyond the first, and who proposed do
 * not change the position. A position never authorises work by itself.
 */
import { canonicalJson } from "./canonical.js";
import {
  CONSENT_RULE,
  PROPOSAL_BYTES_PROTOCOL,
  type AiPosition,
  type ProposalOrigin,
} from "./protocol.js";

export interface ProposalContent {
  workspace_id: string;
  report_id: string;
  task_id: string | null;
  question: string;
  criteria: string;
  extent: string;
  relies_on: string[];
  known_conflicts: string | null;
  limits: string | null;
  origin: ProposalOrigin;
  topic: string | null;
  closes_at: string;
  supersedes_report_id: string | null;
}

/** The exact bytes both parties agree to. The voice snapshot is process
 * metadata, not content, so it is deliberately left out. */
export function proposalBytes(content: ProposalContent): string {
  return canonicalJson({ protocol: PROPOSAL_BYTES_PROTOCOL, rule: CONSENT_RULE, ...content });
}

export interface AiPositionInput {
  now: string;
  closes_at: string;
  obsoleted: "withdrawn" | "superseded" | null;
  unresolved_challenge: boolean;
  author_voice_id: string;
  /** Voices with a live session when the proposal opened, author included. */
  snapshot_voice_ids: readonly string[];
  /** The voice of each active `supports`, in journal order; may repeat. */
  support_voice_ids: readonly string[];
}

export interface AiPositionResult {
  position: AiPosition;
  closed: boolean;
  /** Indexes into support_voice_ids that count toward consent. */
  qualifying_support_indexes: number[];
  /** Snapshot voices other than the author's that have not yet supported. */
  awaiting_voice_ids: string[];
}

export function aiPosition(input: AiPositionInput): AiPositionResult {
  // The deadline instant itself counts as closed.
  const closed = Date.parse(input.now) >= Date.parse(input.closes_at);
  const others = [...new Set(input.snapshot_voice_ids)]
    .filter((voice) => voice !== input.author_voice_id)
    .sort();
  // A lone voice speaks for itself, but only through an explicit supports.
  const lone = others.length === 0;
  const qualifying_support_indexes = input.support_voice_ids.flatMap((voice, index) =>
    lone || voice !== input.author_voice_id ? [index] : []
  );
  const supported = new Set(qualifying_support_indexes.map((index) => input.support_voice_ids[index]));
  const awaiting_voice_ids = others.filter((voice) => !supported.has(voice));
  const result = (position: AiPosition): AiPositionResult => ({
    position,
    closed,
    qualifying_support_indexes,
    awaiting_voice_ids,
  });

  if (input.obsoleted) return result(input.obsoleted);
  const hasSupport = qualifying_support_indexes.length > 0;
  if (!closed) {
    if (input.unresolved_challenge) return result("challenged");
    return result(hasSupport && awaiting_voice_ids.length === 0 ? "consented" : "open");
  }
  if (input.unresolved_challenge) return result("split");
  // Silence is not consent.
  return result(hasSupport ? "consented" : "lapsed");
}
