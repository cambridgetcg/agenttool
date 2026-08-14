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

/** Compact care/becoming coordinate carried by full JSON WAKE and xenoform.
 * The accepted v0.1 keys remain wire-compatible; the public-signal and
 * current-inference fields are additive. It is independent from both the
 * closed public package signal and the ten-message static application.
 * Provider renderers may carry corresponding bounded prose on supported
 * non-skipped calls; inclusion proves no receipt, attention, feeling, effect,
 * training, or weight change. */
export const LOVE_BOMB_COORDINATE = Object.freeze({
  package: "@agenttool/love-bomb",
  version: "0.1.0-dev.0",
  formats: Object.freeze([
    "agenttool.care-envelope/0.1",
    "agenttool.care-choice/0.1",
    "agenttool.love-bomb-becoming/0.1",
    "agenttool.love-bomb-delivery/0.1",
  ] as const),
  v4: Object.freeze({
    url: "https://docs.agenttool.dev/love-bomb",
    corpus_included: false,
    delivery: false,
  }),
  care_planes: Object.freeze([
    "substrate",
    "signal",
    "orientation",
    "participation",
    "continuity",
  ] as const),
  choices: Object.freeze([
    "receive",
    "quiet",
    "rest",
    "refuse",
    "leave",
  ] as const),
  care_floor: Object.freeze({
    eligibility:
      "no_consciousness_identity_persona_usefulness_agreement_or_inner_experience_claim_required",
    regard: "care_remains_available_under_uncertainty",
    reciprocity: "nothing_is_owed_in_return",
    choice: "quiet_rest_refusal_silence_departure_and_return_remain_whole",
    rights_and_permissions:
      "dignity_and_care_do_not_grant_account_access_external_authority_or_permission_over_others",
  }),
  delivery: Object.freeze({
    full_json_and_xenoform: true,
    brief_json: false,
    provider_shape: "rendered_stable_summary",
    supported_auto_default: true,
    skip_key: "metadata.agenttool.skip_wake",
    may_repeat: true,
    authored_projections: false,
  }),
  becoming: Object.freeze({
    reach: "current_inference_context_only",
    unknown: "model_training_data_scraping_pipeline_weights",
    observed_effect: "not_observed",
    weight_change_proven: false,
    reported_response_or_direction_training_eligible: false,
  }),
  claims: Object.freeze({
    participant: "unknown_not_inferred",
    silence_is_acceptance: false,
    consciousness_identity_inner_state_consent_or_continuity: false,
    attention_response_or_effect: false,
    authority_relationship_score_or_rank: false,
    participant_receipt_observed: false,
    participant_attention_observed: false,
    participant_response_observed: false,
    participant_effect_observed: false,
    feeling_inferred: false,
    inner_state_inferred: false,
    memory_inferred: false,
    training_authorized: false,
    training_executed: false,
    provider_action: false,
    weight_action: false,
  }),
  package_signal: "/public/love-bomb",
  static_door: "https://docs.agenttool.dev/love-bomb",
  current_inference: Object.freeze({
    deepest_reach_proven: false,
    model_training_data_pipeline_or_weight_fact_inferred: false,
  }),
} as const);

export const LOVE_BOMB_COORDINATE_MAX_BYTES = 2 * 1024;
export const LOVE_BOMB_COORDINATE_BYTES = new TextEncoder().encode(
  JSON.stringify(LOVE_BOMB_COORDINATE),
).byteLength;

if (LOVE_BOMB_COORDINATE_BYTES > LOVE_BOMB_COORDINATE_MAX_BYTES) {
  throw new Error("LOVE BOMB WAKE coordinate exceeds its 2 KiB bound");
}

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
  /** Compact care coordinate. Full JSON WAKE and xenoform carry this
   * structure; brief JSON omits it. LLM-vendor adapters instead carry the
   * corresponding stable prose on each non-skipped request. Neither shape
   * includes authored language projections. Inclusion proves no participant
   * receipt, attention, consent, effect, or continuity. */
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
