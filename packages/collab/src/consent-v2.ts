/**
 * consent/v2: consent/v1 with one added clause. Contract: PROTOCOL.md
 * "consent/v2" and section 11 of
 * docs/superpowers/specs/2026-10-29-collab-yu-ai-consent-design.md in the
 * AgentTool source repository.
 *
 *   Set-aside. The person may set aside a standing challenge when no session
 *   of the challenger's voice is live, giving a reason. A challenge that was
 *   set aside no longer blocks the position. It is not removed: it stays in
 *   the journal, in every view, and in what the person is shown before
 *   agreeing. Any voice, including the challenger's when it returns, may
 *   challenge again, and a new challenge stands as usual.
 *
 * Why: a voice is the root of a session's attested lineage and a new host
 * process is a new session, so under consent/v1 nobody can lift a challenge
 * whose session has gone. The person, one of the two consenting parties, is
 * the only one given a way to judge such an objection; no credential or
 * voice passes between processes. A present objector can answer and lift its
 * own challenge, so a set-aside is refused while any session of its voice is
 * live: letting the person override a present objector would end two-party
 * consent.
 *
 * This module holds the pure parts: which rule a host opens proposals under,
 * the bytes a person signs to set a challenge aside, the hash that binds the
 * objection's text, and the refusals with their remedies. The store
 * (src/store.ts) applies the rule and records the act.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical.js";
import { CollabError } from "./errors.js";
import {
  CONSENT_RULE,
  CONSENT_RULES,
  PERSON_SET_ASIDE_PROTOCOL,
  type AiSnapshot,
  type CollabReport,
  type ConsentRule,
} from "./protocol.js";

/** Both spellings are read, as for the tools profile, since both have been used for this package's variables. */
export const CONSENT_RULE_VARIABLES = ["AGENTOOL_COLLAB_CONSENT_RULE", "AGENTTOOL_COLLAB_CONSENT_RULE"] as const;

/** The longest reason a set-aside takes: the same limit as a rejection's. */
export const MAX_SET_ASIDE_REASON = 2_000;

export const CHALLENGE_CONTENT_PROTOCOL = "agenttool.collab-challenge-content/1" as const;

export function isConsentRule(value: unknown): value is ConsentRule {
  return (CONSENT_RULES as readonly unknown[]).includes(value);
}

export function validateConsentRule(value: unknown): ConsentRule {
  if (!isConsentRule(value)) {
    throw new CollabError("invalid_consent_rule", `The consent rule must be ${CONSENT_RULES.join(" | ")}`);
  }
  return value;
}

/**
 * The rule new proposals open under, from the host's environment. Unset or
 * empty is consent/v1. An unknown value, or two spellings that disagree,
 * refuses to start rather than guess: a host must not state a position
 * under a rule it was not configured for, and readers on a device are to be
 * upgraded before any writer opens a consent/v2 proposal.
 */
export function consentRuleFromEnvironment(environment: Record<string, string | undefined>): ConsentRule {
  const values = CONSENT_RULE_VARIABLES
    .map((name) => ({ name, value: environment[name] }))
    .filter((entry): entry is { name: (typeof CONSENT_RULE_VARIABLES)[number]; value: string } =>
      entry.value !== undefined && entry.value !== "");
  for (const { name, value } of values) {
    if (!isConsentRule(value)) {
      throw new CollabError(
        "invalid_consent_rule",
        `${name} must be ${CONSENT_RULES.join(" | ")}, not ${JSON.stringify(value)}`,
      );
    }
  }
  if (values.length === 2 && values[0]!.value !== values[1]!.value) {
    throw new CollabError(
      "conflicting_consent_rule",
      `AGENTOOL_COLLAB_CONSENT_RULE and AGENTTOOL_COLLAB_CONSENT_RULE disagree; set one of them to ${CONSENT_RULES.join(" | ")}`,
    );
  }
  return (values[0]?.value as ConsentRule | undefined) ?? CONSENT_RULE;
}

/**
 * The canonical content of a challenge report, by a fixed list of fields,
 * so a later build that adds a field to reports still computes the same
 * hash. Reports are append-only, so this never changes for one report.
 */
export function challengeContentBytes(report: CollabReport): string {
  return canonicalJson({
    protocol: CHALLENGE_CONTENT_PROTOCOL,
    id: report.id,
    workspace_id: report.workspace_id,
    task_id: report.task_id,
    from_session_id: report.from_session_id,
    from_actor: report.from_actor,
    to_session_id: report.to_session_id,
    kind: report.kind,
    body: report.body,
    evidence_refs: report.evidence_refs,
    confidence: report.confidence,
    confidence_basis: report.confidence_basis,
    limits: report.limits,
    relation: report.relation,
    target_report_id: report.target_report_id,
    created_at: report.created_at,
  });
}

export function challengeContentSha256(report: CollabReport): string {
  return createHash("sha256").update(challengeContentBytes(report)).digest("hex");
}

export interface SetAsideChallengeInput {
  workspace_id: string;
  proposal_report_id: string;
  proposal_sha256: string;
  challenge_report_id: string;
  /** challengeContentSha256 of the challenge report: the objection's text is the text shown. */
  challenge_sha256: string;
  reason: string;
  /** Person acts and set-asides on the proposal before this one, so one assertion records one act once. */
  prior_person_acts: number;
  prior_set_asides: number;
  /** The agents' position as the person sees it; a change makes the assertion stale. */
  ai_snapshot: AiSnapshot;
}

/** The canonical bytes a person signs to set one challenge aside, and the base64url WebAuthn challenge over them. */
export function setAsideChallenge(input: SetAsideChallengeInput): { challenge_bytes: string; challenge: string } {
  const challenge_bytes = canonicalJson({ protocol: PERSON_SET_ASIDE_PROTOCOL, act: "set_aside", ...input });
  return { challenge_bytes, challenge: createHash("sha256").update(challenge_bytes).digest("base64url") };
}

/** A set-aside needs a reason, signed with it and shown wherever the challenge is shown. */
export function normalizeSetAsideReason(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > MAX_SET_ASIDE_REASON || text.includes("\0")) {
    throw setAsideRefusal("invalid_reason", {});
  }
  return text;
}

export type SetAsideRefusal =
  | "rule_has_no_set_aside"
  | "proposal_not_on_table"
  | "challenge_not_standing"
  | "already_set_aside"
  | "challenger_present"
  | "invalid_reason"
  | "proposal_hash_mismatch"
  | "challenge_hash_mismatch"
  | "ai_position_changed";

/** Each refusal's message and remedy. A remedy says what the person can do instead; it never asks an agent to act for the person. */
const REFUSALS: Record<SetAsideRefusal, { message: string; remedy: string }> = {
  rule_has_no_set_aside: {
    message: "This proposal opened under consent/v1, which has no set-aside: only each challenge's own voice can lift it",
    remedy: "Reject it at the desk if it should not go ahead. A proposal opened by a host configured with "
      + "AGENTOOL_COLLAB_CONSENT_RULE=consent/v2 can have an absent voice's challenge set aside; a proposal keeps the rule it opened under.",
  },
  proposal_not_on_table: {
    message: "A withdrawn or superseded proposal is no longer on the table",
    remedy: "Read the proposal that replaced it, if any, and act there.",
  },
  challenge_not_standing: {
    message: "That report is not a standing challenge to this proposal",
    remedy: "Only a challenge that still stands can be set aside; `person proposals --workspace <id> --proposal <id>` lists them under set_aside_options.",
  },
  already_set_aside: {
    message: "This challenge was already set aside; a set-aside is final and applies to one challenge once",
    remedy: "Nothing more is needed for it. A new challenge on the proposal stands as usual and is judged on its own.",
  },
  challenger_present: {
    message: "A session of the challenger's voice is live, so it can answer and lift its own challenge",
    remedy: "Ask that session to resolve or withdraw it (a desk note: `person say --workspace <id> --proposal <id> --body <text>`), "
      + "or reject the proposal. A session stops being live 6 hours after its last activity, or when it ends.",
  },
  invalid_reason: {
    message: `A set-aside needs a reason of 1 to ${MAX_SET_ASIDE_REASON} characters`,
    remedy: "Give --reason with why this objection should no longer block; it is signed with the act and shown beside the challenge.",
  },
  proposal_hash_mismatch: {
    message: "The act names different proposal bytes; read the proposal status again",
    remedy: "Run the command again, so the current bytes are shown before you confirm.",
  },
  challenge_hash_mismatch: {
    message: "The act names a challenge text other than the one in the journal",
    remedy: "Run the command again, so the objection is shown as the journal holds it.",
  },
  ai_position_changed: {
    message: "The agents' position changed since it was shown; read the proposal status again",
    remedy: "Run the command again, so the current position is shown before you confirm.",
  },
};

export function setAsideRefusal(code: SetAsideRefusal, details: Record<string, unknown>, message?: string): CollabError {
  const refusal = REFUSALS[code];
  return new CollabError(code, message ?? refusal.message, { ...details, remedy: refusal.remedy });
}
