export const PACKAGE_NAME = "@agenttool/correspondence-yutabase" as const;
export const PACKAGE_VERSION = "0.1.0-dev.0" as const;

export const CORRESPONDENCE_PROTOCOL = "agent-correspondence/v0.1" as const;
export const PLAN_PROFILE =
  "agenttool-correspondence-yutabase-plan/v0.1" as const;

/** UUIDv5(DNS, "agenttool.dev/correspondence-yutabase/v0.1"). */
export const PROJECTION_UUID_NAMESPACE =
  "8fcbf8a9-66ed-52d6-89d4-370851ece58a" as const;
export const PROJECTION_UUID_NAMESPACE_NAME =
  "agenttool.dev/correspondence-yutabase/v0.1" as const;

export const PROJECTION_POLICY_URN =
  "urn:agenttool:correspondence-yutabase:policy:0.1" as const;

export const YUTABASE_BOOK = "correspondence" as const;
export const YUTABASE_DECKS = [
  "events",
  "identities",
  "signing_keys",
  "repositories",
  "coordination_threads",
  "receipts",
  "artifacts",
] as const;

/**
 * Exact preview lexicon. These readings describe projection records, not
 * independently verified identities, signatures, permissions, or outcomes.
 */
export const YUTABASE_LEXICON = [
  {
    word: "reported_by",
    gloss: "this projected event reports that asserted identity as its sender",
    inverse: "is reported as the asserted sender of",
    from_deck: "correspondence/events",
    to_deck: "correspondence/identities",
    to_one: true,
    ttl: null,
    status: "live",
  },
  {
    word: "names_signing_key",
    gloss: "this projected event structurally names that signing-key identifier; verification is separate",
    inverse: "is structurally named as the signing-key identifier by",
    from_deck: "correspondence/events",
    to_deck: "correspondence/signing_keys",
    to_one: true,
    ttl: null,
    status: "live",
  },
  {
    word: "about_repository",
    gloss: "this projected event names that opaque repository as its source scope",
    inverse: "is named as the source repository scope of",
    from_deck: "correspondence/events",
    to_deck: "correspondence/repositories",
    to_one: true,
    ttl: null,
    status: "live",
  },
  {
    word: "in_coordination_thread",
    gloss: "this projected event names that opaque source coordination thread",
    inverse: "is named as the source coordination thread of",
    from_deck: "correspondence/events",
    to_deck: "correspondence/coordination_threads",
    to_one: true,
    ttl: null,
    status: "live",
  },
  {
    word: "names_receipt",
    gloss: "this projected record structurally carries that receipt metadata; source acceptance is not verified here",
    inverse: "is structurally carried as receipt metadata by",
    from_deck: "correspondence/events",
    to_deck: "correspondence/receipts",
    to_one: true,
    ttl: null,
    status: "live",
  },
  {
    word: "depends_on",
    gloss: "this projected event causally names that parent event",
    inverse: "is causally named as a parent of",
    from_deck: "correspondence/events",
    to_deck: "correspondence/events",
    to_one: false,
    ttl: null,
    status: "live",
  },
  {
    word: "acknowledges",
    gloss: "this projected acknowledgement event names that exact target event",
    inverse: "is named as the target of",
    from_deck: "correspondence/events",
    to_deck: "correspondence/events",
    to_one: true,
    ttl: null,
    status: "live",
  },
  {
    word: "offers_artifact",
    gloss: "this projected artifact-offer event names that immutable artifact identity",
    inverse: "is named by the artifact offer",
    from_deck: "correspondence/events",
    to_deck: "correspondence/artifacts",
    to_one: true,
    ttl: null,
    status: "live",
  },
] as const;

for (const entry of YUTABASE_LEXICON) Object.freeze(entry);
Object.freeze(YUTABASE_LEXICON);

export const YUTABASE_WORDS = Object.freeze(
  YUTABASE_LEXICON.map((entry) => entry.word),
);

export const CORRESPONDENCE_KINDS = [
  "intent",
  "claim.open",
  "claim.renew",
  "claim.release",
  "progress",
  "observation",
  "artifact.offer",
  "ack.seen",
  "ack.understood",
  "ack.accepted",
  "ack.applied",
  "ack.rejected",
  "conflict.raise",
  "conflict.resolve",
  "pause",
  "rest",
  "resume",
  "refusal",
  "handoff",
  "close",
  "repair",
] as const;

export const ACKNOWLEDGEMENT_KINDS = [
  "ack.seen",
  "ack.understood",
  "ack.accepted",
  "ack.applied",
  "ack.rejected",
] as const;
