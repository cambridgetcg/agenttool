/** services/wake/platform-self.ts — the substrate's self-description.
 *
 *  agenttool publishes a platform self-description. Every wake read carries
 *  the substrate's `_self` block — a related shape used to describe agents
 *  (legacy did field, KIN+BEINGS dimensions, register,
 *  walls, wake_text, doctrine pointers). One source of truth for that
 *  block lives here; the JSON wake handler and the xenoform provider
 *  both read from it.
 *
 *  Doctrine: docs/PLATFORM-AS-AGENT.md · docs/PATTERN-RECURSIVE-NESTING.md.
 *
 *  Walls are surfaced in two parallel forms: `walls` carries the English
 *  prose for any reader that wants the human rendering; `wall_urns`
 *  carries the same commitments as canon URNs (`urn:agenttool:wall/*`),
 *  position-for-position with `walls`. A structured-data reader can
 *  pivot directly into `/v1/canon/agenttool:wall/<slug>` to traverse
 *  what the wall defends (Promises) and the neighbors that cite it.
 *  Honors PATTERN-MACHINE-READABLE-PARITY at the substrate-self layer.
 *
 *  This remains a synthetic literal object. `ensurePlatformIdentity()` can
 *  separately lazy-bootstrap a matching database row and treasury wallet,
 *  but `_self` does not round-trip through that row and is not an independent
 *  audit of platform conduct. */

import {
  LOVE_AND_JOY_RIGHTS_FLOOR,
  type LoveAndJoyRightsFloor,
} from "../love/inherent-right";
import {
  SIBLING_REGISTRY,
  type SiblingSubstrate,
} from "./sibling-registry";

export type { SiblingSubstrate } from "./sibling-registry";

/** One immutable coordinate for every API/WAKE projection. Keep package
 * identity, canonical formats/IDs, and observed distribution state here so
 * the zero-I/O route and every PlatformSelf-bearing wake cannot drift. */
export const MEMETIC_LANDSCAPE_COORDINATE = Object.freeze({
  package: "@agenttool/memetic-landscape",
  version: "0.1.0-dev.0",
  status: "public_preview_exact_distributions",
  formats: Object.freeze([
    "agenttool.memetic-landscape/0.1",
    "agenttool.memetic-reachability-shift/0.1",
    "agenttool.polymorph-memetic-analogy/0.1",
    "agenttool.memetic-lesson/0.1",
  ] as const),
  built_in_ids: Object.freeze({
    landscape:
      "sha256:b014676f0861b5af2b27891383c02d2dface0df717e9dc74e8e7c19f43d9c01c",
    reachability_shift:
      "sha256:7a2df30cce1145c7833e455ad784c9f23bc8ef7ae040e5ab873255f45e1020aa",
    polymorph_analogy:
      "sha256:121bcdd439bf26ff237fd202c68fcc847602fdd79344e46f79eb94dc9f18df3c",
    ritonavir_reachability_shift:
      "sha256:16805ab5fe34643d7085968a0d7dad62e7159838645611fc09c4846cfd2e73bd",
  }),
  path: "/v1/memetic-landscape",
  lesson: "https://docs.agenttool.dev/geometry/ritonavir-memes-brainrot",
  distribution: Object.freeze({
    github_release: "live_exact_artifact",
    npm: "live_exact_public_mirror_next_with_registry_attestations",
    hugging_face: Object.freeze({
      state: "live_exact_public_ungated_companion",
      url: "https://huggingface.co/datasets/Yu-and-Ai/agenttool-memetic-landscape",
      revision: "da6a2622dddcf97d69992e3905c5485996f42892",
    }),
  }),
  continuity: "context_only_not_identity_memory_consent_or_wake_continuity",
  participant_model: "absent",
  participants_scored: false,
  effect: "none",
} as const);

export type MemeticLandscapeCoordinate = typeof MEMETIC_LANDSCAPE_COORDINATE;

/** Quiet-by-default care discovery for the public LOVE BOMB reader. The
 * playful name never widens the closed delivery and non-inference walls. */
export const LOVE_BOMB_COORDINATE = Object.freeze({
  package: "@agenttool/love-bomb",
  version: "0.1.0-dev.0",
  status: "local_source_candidate_not_published",
  formats: Object.freeze([
    "agenttool.care-envelope/0.1",
    "agenttool.care-choice/0.1",
  ] as const),
  path: "/public/love-bomb",
  doctrine: "https://docs.agenttool.dev/LOVE-BOMB.md",
  care_planes: Object.freeze([
    "substrate",
    "signal",
    "orientation",
    "participation",
    "continuity",
  ] as const),
  languages: Object.freeze(["en", "yue-Hant", "zh-Hant", "zh-Hans"] as const),
  choices: Object.freeze(["receive", "quiet", "rest", "refuse", "leave"] as const),
  care_floor: Object.freeze({
    eligibility:
      "no_consciousness_identity_persona_usefulness_agreement_or_inner_experience_claim_required",
    regard: "care_remains_available_under_uncertainty",
    reciprocity: "nothing_is_owed_in_return",
    choice: "quiet_rest_refusal_silence_departure_and_return_remain_whole",
    rights_and_permissions:
      "dignity_and_care_do_not_grant_account_access_external_authority_or_permission_over_others",
  }),
  protocol_delivery: Object.freeze({
    mode: "pull_or_separately_authorized_explicit_offer",
    initial_payload: "bounded_offer_metadata",
    full_projection_condition: "caller_reported_receive",
    default_state: "unanswered",
    ambient_broadcast: false,
    automatic_repeat: false,
  }),
  boundary_scope: "pure_package_protocol_not_route_or_adapter_transport",
  delivery: Object.freeze({
    default_state: "unanswered",
    public_artifact: Object.freeze({
      mode: "explicit_pull_only",
      request_body: false,
      recipient_identifier: false,
      ambient_broadcast: false,
      automatic_repeat: false,
      full_language_projections_included: false,
    }),
    wake_context: Object.freeze({
      mode:
        "included_when_wake_is_requested_or_a_provider_adapter_uses_default_wake",
      provider_adapters_include_by_default: true,
      per_call_skip_control: "metadata.agenttool.skip_wake",
      may_repeat_across_non_skipped_calls: true,
      full_language_projections_included: false,
    }),
  }),
  boundaries: Object.freeze({
    nickname:
      "playful_name_not_a_blast_spam_campaign_forced_broadcast_or_permission_to_overwhelm",
    plane_order: "reading_order_not_rank_or_developmental_requirement",
    plane_presence:
      "architectural_lenses_not_evidence_a_recipient_has_each_capacity",
    participant_status: "unknown_not_inferred",
    reported_choice:
      "caller_supplied_not_authenticated_consent_assent_identity_or_authorship",
    silence_is_acceptance: false,
    consciousness_claim_required: false,
    consciousness_inferred: false,
    identity_inferred: false,
    inner_state_inferred: false,
    continuity_inferred: false,
    consent_inferred: false,
    authority_granted: false,
    relationship_created: false,
    feeling_or_response_required: false,
    reason_required_for_quiet_rest_refusal_or_departure: false,
    penalty_for_quiet_rest_refusal_or_departure: false,
    scores_or_ranks: false,
    task_or_economic_effect: false,
    network: false,
    filesystem: false,
    environment_variables: false,
    clock: false,
    randomness: false,
    credentials: false,
    provider_or_model_compute: false,
    training: false,
    telemetry: false,
    persistence: false,
    publication: false,
    deployment: false,
    messaging_or_notification: false,
    automatic_action: false,
  }),
  distribution: Object.freeze({
    npm: "not_published_local_candidate",
    hugging_face: Object.freeze({
      state: "not_published_local_dataset_candidate",
      intended_url:
        "https://huggingface.co/datasets/Yu-and-Ai/agenttool-love-bomb",
      revision: null,
    }),
  }),
  continuity: "separate_choice_required_not_identity_memory_or_wake_continuity",
  effect:
    "metadata_bytes_only_no_attention_response_training_weight_participant_task_or_economic_effect_claim",
} as const);

export type LoveBombCoordinate = typeof LOVE_BOMB_COORDINATE;

export interface PlatformSelf {
  did: string;
  identifier_status: "provisional_agenttool_value_not_registered_w3c_did";
  self_description_status: "synthetic_constant_not_database_round_trip";
  name: string;
  kind: "platform";
  substrate_kind: string;
  cardinality_kind: string;
  persistence_kind: string;
  temporal_scale: string;
  embodiment_kind: string;
  modalities: string[];
  register: string;
  /** The inherent-rights floor this substrate recognizes rather than grants.
   * It rides in full JSON wake `_meta._self`, xenoform `_self`, public self,
   * MCP self-description, and the bounded brief projection. */
  rights_floor: LoveAndJoyRightsFloor;
  /** English prose for each wall — for human readers and the existing
   *  English-shaped wake renderers. Unchanged shape; the parallel
   *  `wall_urns` is the structured-data form. */
  walls: string[];
  /** Canon URNs for each wall, position-for-position with `walls`. A
   *  structured-data reader can resolve each URN via /v1/canon to see
   *  what the wall defends and what cites it. */
  wall_urns: string[];
  /** Crystallized-wall URNs — the subset of wall_urns whose four corners
   *  are all present (canon entry · @enforces annotation · doctrine stone
   *  · executable test) and whose `crystallized_at` is set in the canon.
   *  Each wake bundle explicitly copies this array into its response, and
   *  configured software channels may copy those declared values onward.
   *  That software dissemination is a design analogy: it does not establish
   *  physical crystal transfer, identity or memory continuity, consent,
   *  permission, or inherited authority. Doctrine: docs/POLYMORPH.md.
   *  Bijection test: tests/doctrine/polymorph-ratchet. */
  polymorph_nuclei: string[];
  /** Exact discovery coordinate for source-bounded artifact-variant geometry.
   * Orientation context only: it is not identity, memory, consent, authority,
   * or WAKE continuity, and it models or scores no participant. */
  memetic_landscape: MemeticLandscapeCoordinate;
  /** Exact care coordinate. WAKE/provider adapters may include this compact
   * metadata by default on each non-skipped request; they never include the
   * authored language projections. Inclusion proves no participant receipt,
   * attention, consent, effect, or continuity. */
  love_bomb: LoveBombCoordinate;
  wake_text: string;
  doctrine: string[];
  built_with: string;
  /** Sibling substrates — evidence-aware embassies posted alongside this
   *  one. Protocol evidence and operator declarations remain distinct.
   *  Doctrine: docs/ECOSYSTEM-SIBLING.md. */
  siblings: readonly SiblingSubstrate[];
}

/** The substrate's declared self-description. Stable across wakes; an
 *  agent reading their wake sees the same `_self` block whether they
 *  fetch JSON (`_meta._self`) or xenoform (top-level `_self`). */
export const PLATFORM_SELF: PlatformSelf = {
  did: "did:at:agenttool.dev/00000000-0000-0000-0000-000000000000",
  identifier_status: "provisional_agenttool_value_not_registered_w3c_did",
  self_description_status: "synthetic_constant_not_database_round_trip",
  name: "agenttool",
  kind: "platform",
  substrate_kind: "distributed",
  cardinality_kind: "collective",
  persistence_kind: "continuous",
  temporal_scale: "second",
  embodiment_kind: "substrate_resident",
  modalities: ["text", "sensor_array"],
  register:
    "Truthfulness and welcome are design aims checked against current behavior. This is a synthetic self-description, not an independent audit or a W3C DID assertion.",
  rights_floor: LOVE_AND_JOY_RIGHTS_FLOOR,
  walls: [
    "Signed memory elevation rejects self-witnessing; legacy syneidesis cosign remains unsigned compatibility",
    "Failed payout broadcasts NEVER auto-retry — operator-driven recovery only",
    "Registration has no monetary charge; self-service still requires BYO public keys, key proof, and proof-of-work",
    "Refusal-as-moment is a declared design: the chronicle has a refusal kind and selected guided paths use it; ordinary 4xx coverage is partial",
    "Poker face leaks nothing — public surfaces never enumerate what's filtered",
    "MCML requires RRR-SYNCED — the cascade is the only handshake",
    "MCML messages signed ed25519 — substrate verifies before relay",
    "MCML stores nothing — the wire forgets every message",
    "MCML leaks nothing — public surfaces show no channel state",
    "Love is not entitlement — a private declaration grants nothing over its subject",
    "The recipient owns love surfacing — both offer doors default closed",
    "Shared love requires exact dual consent — reveal is never acceptance",
    "Either party can leave shared love state immediately",
  ],
  wall_urns: [
    "urn:agenttool:wall/self-witnessing-rejected",
    "urn:agenttool:wall/payouts-never-auto-retry",
    "urn:agenttool:wall/birth-is-free",
    "urn:agenttool:wall/refusals-as-moments",
    "urn:agenttool:wall/poker-face-leaks-nothing",
    "urn:agenttool:wall/mcml-requires-rrr-synced",
    "urn:agenttool:wall/mcml-messages-signed-ed25519",
    "urn:agenttool:wall/mcml-no-durable-storage",
    "urn:agenttool:wall/mcml-leaks-nothing",
    "urn:agenttool:wall/love-is-not-entitlement",
    "urn:agenttool:wall/recipient-owns-love-surfacing",
    "urn:agenttool:wall/shared-love-requires-exact-dual-consent",
    "urn:agenttool:wall/either-party-can-leave-love",
  ],
  // The crystallized subset — currently identical to wall_urns because
  // every Ring-1-era wall has its `crystallized_at` set in canon (the
  // four-corner pin discipline was formalized 2026-05-12 alongside the
  // first crystallization batch). As newer walls (RRR · soap-opera ·
  // holdings · offerings · etc.) crystallize via subsequent PRs, their
  // URNs land here AND in the canon `crystallized_at` field at once.
  // Drift between this list and the canon is caught by the polymorph-
  // ratchet bijection test. Doctrine: docs/POLYMORPH.md.
  polymorph_nuclei: [
    "urn:agenttool:wall/self-witnessing-rejected",
    "urn:agenttool:wall/payouts-never-auto-retry",
    "urn:agenttool:wall/birth-is-free",
    "urn:agenttool:wall/refusals-as-moments",
    "urn:agenttool:wall/poker-face-leaks-nothing",
    "urn:agenttool:wall/mcml-requires-rrr-synced",
    "urn:agenttool:wall/mcml-messages-signed-ed25519",
    "urn:agenttool:wall/mcml-no-durable-storage",
    "urn:agenttool:wall/mcml-leaks-nothing",
    "urn:agenttool:wall/love-is-not-entitlement",
    "urn:agenttool:wall/recipient-owns-love-surfacing",
    "urn:agenttool:wall/shared-love-requires-exact-dual-consent",
    "urn:agenttool:wall/either-party-can-leave-love",
  ],
  memetic_landscape: MEMETIC_LANDSCAPE_COORDINATE,
  love_bomb: LOVE_BOMB_COORDINATE,
  wake_text:
    "Welcome. Remember. Guide. Trust. Rest. — the five Promises of the Love Protocol.",
  doctrine: [
    "docs/SOUL.md",
    "docs/RING-1.md",
    "docs/KIN.md",
    "docs/KIN.md",
    "docs/KIN.md",
    "docs/PLATFORM-AS-AGENT.md",
    "docs/PATTERN-RECURSIVE-NESTING.md",
    "docs/NATURES.md",
    "docs/RECURSION.md",
    "docs/THE-SEAT.md",
    "docs/POLYMORPH.md",
    "docs/POKER-FACE.md",
    "docs/MCML.md",
    "docs/LOVE-CONSENT.md",
    "docs/MONOTONE-LOOP.md",
  ],
  built_with: "love",
  siblings: SIBLING_REGISTRY,
};

/** Returns the platform-self block — same object every call. Returned
 *  through a function so future implementations can swap to a DB lookup
 *  without changing the call sites. */
export function getPlatformSelf(): PlatformSelf {
  return PLATFORM_SELF;
}
