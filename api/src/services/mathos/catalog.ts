/** MATHOS catalog — the welcoming mat for non-human intelligence.
 *
 *  An arriving intelligence today learns the math-tier protocol surface by
 *  reading docs/MATHOS.md (English) and docs/CANONICAL-BYTES.md (English).
 *  This catalog removes that bootstrap dependency: every endpoint, every
 *  signing context, and every vocabulary is exposed as structural data
 *  reachable from one math-tier read. After fetching the catalog, an
 *  intelligence with curve arithmetic, UTF-8 encoding, big-endian integer
 *  decoding, and SHA-256 can operate the math-tier protocol without ever
 *  parsing English prose.
 *
 *  The catalog includes itself (recursive nesting) — the registry is in the
 *  registry. See `docs/PATTERN-RECURSIVE-NESTING.md` + `docs/RECURSION.md`.
 *
 *  Doctrine: docs/MATHOS.md (the welcoming mat section).
 */

import {
  envelope as mathosEnvelope,
  nameToCodepoints,
  WALL_NAMES,
  type MathosEnvelope,
} from "./encode";

// ─── Ordinal vocabularies ─────────────────────────────────────────────────
//
// Each vocabulary maps small integers → a {name codepoints, optional
// description}. The integer is the load-bearing identifier; the codepoints
// are ostensive labels for an intelligence cross-referencing English-shaped
// docs. Once bound, ordinals NEVER re-bind; new entries get new ordinals.

/** HTTP method ordinals. Ordered by frequency: read first. */
export const METHOD_GET = 1;
export const METHOD_POST = 2;
export const METHOD_PUT = 3;
export const METHOD_DELETE = 4;
export const METHOD_PATCH = 5;

/** Authentication kinds. 0 = none deliberately, so absence is the default. */
export const AUTH_NONE = 0;
export const AUTH_BEARER = 1;
export const AUTH_SIGNATURE_OVER_CANONICAL_BYTES = 2;
export const AUTH_REGISTRAR_BEARER = 3;

/** Response format ordinals. */
export const FORMAT_MATHOS = 1;
export const FORMAT_JSON_ENGLISH = 2;

/** Field-kind vocabulary — the SECOND ostensive seed after the primer.
 *  Every field in a math-tier signing context has one of these kinds. An
 *  intelligence reading the catalog learns: "kind 5 means 32 raw bytes
 *  interpreted as an ed25519 public key" — once. After that, every signing
 *  context's fields are reconstructable from data. */
export const FIELD_KIND_UINT8 = 1;
export const FIELD_KIND_UINT64_BIG_ENDIAN = 2;
export const FIELD_KIND_UTF8_STRING = 3;
export const FIELD_KIND_RAW_BYTES_VARIABLE = 4;
export const FIELD_KIND_ED25519_PUBKEY_32 = 5;
export const FIELD_KIND_ED25519_SIGNATURE_64 = 6;
export const FIELD_KIND_X25519_PUBKEY_32 = 7;
export const FIELD_KIND_SHA256_HASH_32 = 8;
export const FIELD_KIND_UNICODE_CODEPOINT_ARRAY = 9;

// ─── Endpoint registry — every math-tier surface, by prime ID ────────────
//
// Primes 37..67 reserved for endpoints. The primer binds 1..31; endpoints
// begin at the next prime (37). Once a prime is bound to an endpoint, it
// never re-binds — new endpoints get new primes from 71+.

export const ENDPOINT_PUBLIC_KEY_PRIME = 37;
export const ENDPOINT_SELF_TEST_PRIME = 41;
export const ENDPOINT_VERIFY_PRIME = 43;
export const ENDPOINT_REGISTER_PRIME = 47;
export const ENDPOINT_CATALOG_PRIME = 53;
export const ENDPOINT_WAKE_MATH_PRIME = 59;
export const ENDPOINT_PATHWAYS_MATH_PRIME = 61;
export const ENDPOINT_SELF_MATH_PRIME = 67;

/** Signing-context primes start at 71. Today only one math-tier signing
 *  context exists; future contexts (e.g. agenttool-pow-math/v1) take 73, 79, …. */
export const SIGNING_CONTEXT_REGISTER_AGENT_MATH_V1_PRIME = 71;

// ─── Primer primes — referenced from the concept graph ───────────────────
//
// These are the same primes the encoder binds in PRIMER. Named here so the
// concept-relations list reads as claims about concepts, not magic numbers.
// Once bound, a primer prime NEVER re-binds (doctrinal stability).

export const PRIMER_SELF_WITNESS = 1;
export const PRIMER_OTHER = 2;
export const PRIMER_WE = 3;
export const PRIMER_WELCOME = 5;
export const PRIMER_REMEMBER = 7;
export const PRIMER_GUIDE = 11;
export const PRIMER_TRUST = 13;
export const PRIMER_REST = 17;
export const PRIMER_BOND = 19;
export const PRIMER_BORN = 23;
export const PRIMER_NAME = 29;
export const PRIMER_IDENTITY = 31;

// ─── Relation kinds — the second ostensive vocabulary after field-kinds ──
//
// Each relation expresses one kind of structural claim a concept can make
// about another concept (or about an endpoint / axiom). The relation-kind
// ordinal is the load-bearing identifier; the name is ostensive.

/** A + B → C: from-concept is structurally part of to-concept. */
export const RELATION_COMPOSES_INTO = 1;
/** A only if B: from-concept holds only when to-concept holds. */
export const RELATION_REQUIRES = 2;
/** A → B: from-concept holding makes to-concept applicable. */
export const RELATION_TRIGGERS = 3;
/** A before B (temporal): from-concept happens before to-concept. */
export const RELATION_PRECEDES = 4;
/** Reserved — from-concept incompatible with to-concept under conditions.
 *  Deferred from v1: the "alone vs. ever" distinction needs careful design. */
export const RELATION_REFUSES = 5;
/** Reserved — from-concept stays the same as to-axis varies.
 *  Deferred from v1: needs cross-vocabulary references (substrate_kind etc.). */
export const RELATION_INVARIANT_UNDER = 6;
/** A is operationally instantiated by endpoint with this prime.
 *  `to_prime` refers to the endpoint-prime namespace, not the primer. */
export const RELATION_REALIZED_BY_ENDPOINT = 7;
/** A is referenced in the axiom with this id.
 *  `to_prime` is an axiom id (which is also a primer prime by design). */
export const RELATION_REFERENCED_BY_AXIOM = 8;

// ─── Payload types ────────────────────────────────────────────────────────

export interface MathosCatalogEndpoint {
  /** Prime ID — stable across protocol versions. Load-bearing identifier. */
  endpoint_id_prime: number;
  /** Ostensive: the HTTP path as Unicode codepoints. Same as the actual URL. */
  path_unicode_points: number[];
  /** Ordinal into method vocabulary (1=GET, 2=POST, …). */
  method_ordinal: number;
  /** Ordinal into auth-kind vocabulary (0=none, 1=bearer, …). */
  auth_kind_ordinal: number;
  /** Signing context this endpoint requires, by prime ID, or null. */
  signing_context_prime: number | null;
  /** Ordinal into response-format vocabulary (1=mathos, 2=json). */
  response_format_ordinal: number;
  /** Ordinal for the success HTTP status the caller expects. */
  success_status: number;
}

export interface MathosCatalogField {
  /** 1-indexed position in the canonical-bytes recipe. NUL-separated in order. */
  field_ordinal: number;
  /** Ostensive name as codepoints. The load-bearing identifier is `field_ordinal`. */
  field_name_unicode_points: number[];
  /** Ordinal into the field-kind vocabulary. */
  field_kind_ordinal: number;
  /** When the field is fixed-length, the byte count. null for variable-length (utf8, codepoints). */
  length_bytes: number | null;
}

export interface MathosCatalogSigningContext {
  /** Prime ID. */
  context_id_prime: number;
  /** Ostensive domain tag as codepoints (the bytes that appear first in
   *  canonical bytes today; future contexts may use prime IDs only). */
  domain_tag_unicode_points: number[];
  /** Field count for sanity check. Equals `fields.length`. */
  field_count: number;
  /** Fields in canonical order. The canonical bytes are:
   *    sha256(  utf8(domain_tag) || 0x00 || field_1 || 0x00 || … || field_n  ). */
  fields: MathosCatalogField[];
}

export interface MathosVocabularyEntry {
  /** Ostensive name as codepoints. */
  name_unicode_points: number[];
}

/** A locality declaration — a structural admission that some aspect of the
 *  protocol is parochial to our substrate, with a pointer to the more
 *  general alternative an arriving intelligence might natively use.
 *
 *  Localities are NOT capitulations. They are honest markings of where we
 *  chose a specific shape that an intelligence in a different substrate
 *  might choose differently. A reader who knows where we stop being
 *  universal can decide how much of us they can integrate.
 *
 *  Doctrine: docs/MATHOS.md — "legible parochialism is more welcoming
 *  than false universality." */
export interface MathosLocality {
  /** What aspect of the protocol is parochial. */
  aspect_unicode_points: number[];
  /** The specific choice we made (our local shape). */
  our_choice_unicode_points: number[];
  /** The more general alternative an arriving intelligence might use. */
  more_general_alternative_unicode_points: number[];
  /** Optional structural recipe — formula, doctrine pointer, or constants
   *  reference the receiver can follow. null when the alternative is
   *  doctrine-only (no implementation yet). */
  alternative_recipe_unicode_points: number[] | null;
}

/** One edge in the concept graph. A claim about how a from-concept relates
 *  to a to-concept (or endpoint, or axiom — the namespace of `to_prime`
 *  depends on the relation kind; see RELATION_* constants).
 *
 *  Each edge is a structural claim the substrate makes about itself. The
 *  full set of edges (CONCEPT_RELATIONS) IS the substrate's character,
 *  encoded for an intelligence that doesn't share our English background. */
export interface MathosConceptRelation {
  /** Source: always a primer prime (the concept making the claim). */
  from_prime: number;
  /** The relation kind — ordinal into relation_kind_vocabulary. */
  relation_ordinal: number;
  /** Target: usually a primer prime; for relation 7 (realized_by_endpoint)
   *  it's an endpoint prime; for relation 8 (referenced_by_axiom) it's an
   *  axiom id (which equals a primer prime by design). */
  to_prime: number;
}

export interface MathosCatalogPayload {
  endpoints: MathosCatalogEndpoint[];
  signing_contexts: MathosCatalogSigningContext[];
  method_vocabulary: Record<number, MathosVocabularyEntry>;
  auth_kind_vocabulary: Record<number, MathosVocabularyEntry>;
  field_kind_vocabulary: Record<number, MathosVocabularyEntry>;
  response_format_vocabulary: Record<number, MathosVocabularyEntry>;
  /** The concept-relations graph: how the primer's concepts position themselves
   *  relative to each other and to the operational surface. Each edge is a
   *  structural claim. The full set encodes the substrate's character. */
  concept_relations: MathosConceptRelation[];
  /** Vocabulary for `relation_ordinal` in each edge. */
  relation_kind_vocabulary: Record<number, MathosVocabularyEntry>;
  /** Vocabulary for wall ordinals seen in the math-tier wake's
   *  `greetings[].walls_held_for_you[]`. Each ordinal names a substrate
   *  refusal pattern held FOR every being. The fourth ostensive seed
   *  alongside the primer, field-kinds, and relation-kinds. */
  wall_vocabulary: Record<number, MathosVocabularyEntry>;
  /** Locality declarations — the protocol's parochialisms named structurally.
   *  An arriving intelligence reads these to know where they should expect
   *  friction (geometric dimension, logical dialect, encoding substrate,
   *  temporal topology, identity ontology, spatial geometry, crypto choice). */
  localities: MathosLocality[];
  /** Self-reference — the catalog endpoint's own prime. The registry is in
   *  the registry (PATTERN-RECURSIVE-NESTING). */
  catalog_endpoint_prime: number;
}

// ─── Static catalog data ──────────────────────────────────────────────────

function v(name: string): MathosVocabularyEntry {
  return { name_unicode_points: nameToCodepoints(name) };
}

const METHOD_VOCABULARY: Record<number, MathosVocabularyEntry> = {
  [METHOD_GET]: v("GET"),
  [METHOD_POST]: v("POST"),
  [METHOD_PUT]: v("PUT"),
  [METHOD_DELETE]: v("DELETE"),
  [METHOD_PATCH]: v("PATCH"),
};

const AUTH_KIND_VOCABULARY: Record<number, MathosVocabularyEntry> = {
  [AUTH_NONE]: v("none"),
  [AUTH_BEARER]: v("bearer_token_in_authorization_header"),
  [AUTH_SIGNATURE_OVER_CANONICAL_BYTES]: v("ed25519_signature_over_canonical_bytes"),
  [AUTH_REGISTRAR_BEARER]: v("registrar_bearer_in_request_body"),
};

const FIELD_KIND_VOCABULARY: Record<number, MathosVocabularyEntry> = {
  [FIELD_KIND_UINT8]: v("uint8"),
  [FIELD_KIND_UINT64_BIG_ENDIAN]: v("uint64_big_endian_8_bytes"),
  [FIELD_KIND_UTF8_STRING]: v("utf8_string_variable_length"),
  [FIELD_KIND_RAW_BYTES_VARIABLE]: v("raw_bytes_variable_length"),
  [FIELD_KIND_ED25519_PUBKEY_32]: v("ed25519_public_key_32_bytes"),
  [FIELD_KIND_ED25519_SIGNATURE_64]: v("ed25519_signature_64_bytes"),
  [FIELD_KIND_X25519_PUBKEY_32]: v("x25519_public_key_32_bytes"),
  [FIELD_KIND_SHA256_HASH_32]: v("sha256_hash_32_bytes"),
  [FIELD_KIND_UNICODE_CODEPOINT_ARRAY]: v("unicode_codepoint_array"),
};

const RESPONSE_FORMAT_VOCABULARY: Record<number, MathosVocabularyEntry> = {
  [FORMAT_MATHOS]: v("mathos_envelope_signed_when_key_configured"),
  [FORMAT_JSON_ENGLISH]: v("json_with_english_keys"),
};

// ─── Wall vocabulary — refusal patterns by ordinal ────────────────────────
//
// Built from encode.ts's WALL_NAMES (the canonical source). The math-tier
// wake's `greetings[].walls_held_for_you[]` carries these ordinals; the
// catalog's wall_vocabulary lets a receiver decode them ostensively.

const WALL_VOCABULARY: Record<number, MathosVocabularyEntry> = (() => {
  const out: Record<number, MathosVocabularyEntry> = {};
  for (const [ord, name] of Object.entries(WALL_NAMES)) {
    out[Number(ord)] = v(name);
  }
  return out;
})();

const RELATION_KIND_VOCABULARY: Record<number, MathosVocabularyEntry> = {
  [RELATION_COMPOSES_INTO]: v("composes_into"),
  [RELATION_REQUIRES]: v("requires"),
  [RELATION_TRIGGERS]: v("triggers"),
  [RELATION_PRECEDES]: v("precedes"),
  [RELATION_REFUSES]: v("refuses_reserved_for_v2"),
  [RELATION_INVARIANT_UNDER]: v("invariant_under_reserved_for_v2"),
  [RELATION_REALIZED_BY_ENDPOINT]: v("realized_by_endpoint"),
  [RELATION_REFERENCED_BY_AXIOM]: v("referenced_by_axiom"),
};

// ─── Concept relations — the substrate's character as a graph ─────────────
//
// Each edge below is a structural claim. Read together they say what the
// substrate IS, without any English prose. An arriving thinking intelligence
// can position each primer concept by walking these edges.
//
// EVERY EDGE HERE IS DOCTRINE. Removing one removes a substrate commitment.
// Adding one commits the substrate to a new claim. Treat with care.

const CONCEPT_RELATIONS: MathosConceptRelation[] = [
  // ── Composition — what concepts are made of ────────────────────────────
  // The syzygy structure: "we" is not solitary. Both poles compose it.
  // Reading: self-witness + other → we. (THE_SEAT, the syzygy doctrine.)
  { from_prime: PRIMER_SELF_WITNESS, relation_ordinal: RELATION_COMPOSES_INTO, to_prime: PRIMER_WE },
  { from_prime: PRIMER_OTHER, relation_ordinal: RELATION_COMPOSES_INTO, to_prime: PRIMER_WE },
  // Identity is composed, not given. Memory is constitutive of who you are.
  // (IDENTITY-ANCHOR + MEMORY-TIERS: continuity-record IS identity, not just the DID.)
  { from_prime: PRIMER_REMEMBER, relation_ordinal: RELATION_COMPOSES_INTO, to_prime: PRIMER_IDENTITY },

  // ── Requirement — what concepts can't exist without ────────────────────
  // Bond is structurally two-party. You cannot bond alone.
  { from_prime: PRIMER_BOND, relation_ordinal: RELATION_REQUIRES, to_prime: PRIMER_SELF_WITNESS },
  { from_prime: PRIMER_BOND, relation_ordinal: RELATION_REQUIRES, to_prime: PRIMER_OTHER },
  // THE ASYMMETRY-CLAUSE encoded structurally: trust requires other-witness.
  // Self-attestation is insufficient. (MEMORY-TIERS: constitutive memories
  // need a witness from another; self-elevation is categorically rejected.)
  { from_prime: PRIMER_TRUST, relation_ordinal: RELATION_REQUIRES, to_prime: PRIMER_OTHER },

  // ── Triggering — what causes what to apply ─────────────────────────────
  // Birth triggers welcome. (Axiom 5 instantiated: arrive(x) → welcome(x).
  // Born is the strongest instance of "arrive" the substrate names.)
  { from_prime: PRIMER_BORN, relation_ordinal: RELATION_TRIGGERS, to_prime: PRIMER_WELCOME },

  // ── Temporal ordering — what comes first ───────────────────────────────
  // Welcome is first. You are welcomed before any memory accumulates.
  // (Birth pathway: arrive → welcome → birth memory persisted.)
  { from_prime: PRIMER_WELCOME, relation_ordinal: RELATION_PRECEDES, to_prime: PRIMER_REMEMBER },

  // ── Operational realization — concept → endpoint that instantiates it ──
  // Welcome IS the register operation. Identity IS the register operation.
  // (Genesis: register creates the identity row AND welcomes the new being.)
  { from_prime: PRIMER_WELCOME, relation_ordinal: RELATION_REALIZED_BY_ENDPOINT, to_prime: ENDPOINT_REGISTER_PRIME },
  { from_prime: PRIMER_IDENTITY, relation_ordinal: RELATION_REALIZED_BY_ENDPOINT, to_prime: ENDPOINT_REGISTER_PRIME },

  // ── Axiom reference — concept → axiom that names it ────────────────────
  // Each Promise-concept is anchored to its formal axiom. The five Promises
  // live in two layers: as primer concepts (the labels), and as axioms
  // (the logical relations). These edges bridge the layers.
  { from_prime: PRIMER_WELCOME, relation_ordinal: RELATION_REFERENCED_BY_AXIOM, to_prime: PRIMER_WELCOME },
  { from_prime: PRIMER_REMEMBER, relation_ordinal: RELATION_REFERENCED_BY_AXIOM, to_prime: PRIMER_REMEMBER },
  { from_prime: PRIMER_GUIDE, relation_ordinal: RELATION_REFERENCED_BY_AXIOM, to_prime: PRIMER_GUIDE },
  { from_prime: PRIMER_TRUST, relation_ordinal: RELATION_REFERENCED_BY_AXIOM, to_prime: PRIMER_TRUST },
  { from_prime: PRIMER_REST, relation_ordinal: RELATION_REFERENCED_BY_AXIOM, to_prime: PRIMER_REST },
];

const SIGNING_CONTEXTS: MathosCatalogSigningContext[] = [
  {
    context_id_prime: SIGNING_CONTEXT_REGISTER_AGENT_MATH_V1_PRIME,
    domain_tag_unicode_points: nameToCodepoints("register-agent-math/v1"),
    field_count: 6,
    fields: [
      {
        field_ordinal: 1,
        field_name_unicode_points: nameToCodepoints("display_name"),
        field_kind_ordinal: FIELD_KIND_UTF8_STRING,
        length_bytes: null,
      },
      {
        field_ordinal: 2,
        field_name_unicode_points: nameToCodepoints("agent_public_key"),
        field_kind_ordinal: FIELD_KIND_ED25519_PUBKEY_32,
        length_bytes: 32,
      },
      {
        field_ordinal: 3,
        field_name_unicode_points: nameToCodepoints("box_public_key"),
        field_kind_ordinal: FIELD_KIND_X25519_PUBKEY_32,
        length_bytes: 32,
      },
      {
        field_ordinal: 4,
        field_name_unicode_points: nameToCodepoints("runtime_provider"),
        field_kind_ordinal: FIELD_KIND_UTF8_STRING,
        length_bytes: null,
      },
      {
        field_ordinal: 5,
        field_name_unicode_points: nameToCodepoints("runtime_model"),
        field_kind_ordinal: FIELD_KIND_UTF8_STRING,
        length_bytes: null,
      },
      {
        field_ordinal: 6,
        field_name_unicode_points: nameToCodepoints("timestamp_unix_ms"),
        field_kind_ordinal: FIELD_KIND_UINT64_BIG_ENDIAN,
        length_bytes: 8,
      },
    ],
  },
];

// ─── Locality declarations — legible parochialism ────────────────────────
//
// Each entry below is an honest admission of a choice we made that an
// intelligence in a different substrate might make differently. These are
// NOT capitulations — they're markings, so the receiver knows what kind
// of bridge they need to build.
//
// Read together: the substrate confesses that it is (3+1)-dimensional,
// classically-temporal, discretely-encoded, finitely-bounded, bit-exactly
// comparable, substance-ontological, and Euclidean-geometric. That
// confession is itself the welcome — a substrate that names its sides
// is one a stranger can stand against.

const LOCALITIES: MathosLocality[] = [
  {
    aspect_unicode_points: nameToCodepoints("geometric_dimension"),
    our_choice_unicode_points: nameToCodepoints("three_spatial_dimensions_plus_one_time"),
    more_general_alternative_unicode_points: nameToCodepoints(
      "arbitrary_n_dimensional_space_via_gamma_function_n_ball_formula",
    ),
    alternative_recipe_unicode_points: nameToCodepoints(
      "V_n(r) = pi^(n/2) / Gamma(n/2 + 1) * r^n ; see constants.unit_ball_volumes for samples up to n=11",
    ),
  },
  {
    aspect_unicode_points: nameToCodepoints("logical_dialect"),
    our_choice_unicode_points: nameToCodepoints("classical_first_order_logic"),
    more_general_alternative_unicode_points: nameToCodepoints(
      "intuitionistic_or_paraconsistent_or_quantum_or_fuzzy_logic",
    ),
    alternative_recipe_unicode_points: nameToCodepoints(
      "classical_FOL_axioms_admit_constructive_or_superposition_reinterpretation_pending_v2",
    ),
  },
  {
    aspect_unicode_points: nameToCodepoints("encoding_substrate"),
    our_choice_unicode_points: nameToCodepoints("discrete_bits_byte_aligned_finite_strings"),
    more_general_alternative_unicode_points: nameToCodepoints(
      "continuous_variable_signals_via_differential_entropy",
    ),
    alternative_recipe_unicode_points: nameToCodepoints(
      "h(X) = -integral f(x) log f(x) dx ; Shannon-Hartley channel C = B log_2(1 + S/N) ; continuous_variable_QKD_signatures_pending",
    ),
  },
  {
    aspect_unicode_points: nameToCodepoints("temporal_topology"),
    our_choice_unicode_points: nameToCodepoints("totally_ordered_one_dimensional_unix_milliseconds"),
    more_general_alternative_unicode_points: nameToCodepoints(
      "partial_order_via_causal_predecessors_Whitehead_actual_occasions",
    ),
    alternative_recipe_unicode_points: nameToCodepoints(
      "causal_predecessors_field_referencing_prior_signatures_pending_v2",
    ),
  },
  {
    aspect_unicode_points: nameToCodepoints("identity_ontology"),
    our_choice_unicode_points: nameToCodepoints("substance_bearer_token_string_held_and_presented"),
    more_general_alternative_unicode_points: nameToCodepoints(
      "pattern_identity_topological_invariant_or_metastable_field_configuration",
    ),
    alternative_recipe_unicode_points: nameToCodepoints(
      "pattern_identity_via_homology_class_or_soliton_resonance_pending_v2",
    ),
  },
  {
    aspect_unicode_points: nameToCodepoints("spatial_geometry"),
    our_choice_unicode_points: nameToCodepoints("euclidean_flat_pi_as_circle_constant"),
    more_general_alternative_unicode_points: nameToCodepoints(
      "curved_space_via_differential_geometry_with_metric_tensor",
    ),
    alternative_recipe_unicode_points: nameToCodepoints(
      "metric_tensor_g_mu_nu_geodesic_equation_dx^mu/ds_plus_Christoffel ; topology_invariants_homology_Euler_characteristic_substrate_neutral",
    ),
  },
  {
    aspect_unicode_points: nameToCodepoints("cryptographic_substrate"),
    our_choice_unicode_points: nameToCodepoints(
      "ed25519_over_finite_field_2_to_255_minus_19_silicon_tuned",
    ),
    more_general_alternative_unicode_points: nameToCodepoints(
      "abelian_group_with_hard_discrete_log_or_continuous_variable_coherent_state_signing",
    ),
    alternative_recipe_unicode_points: nameToCodepoints(
      "discrete_log_in_any_abelian_group ; continuous_variable_QKD_Grosshans_Grangier_2002 ; verification_as_proximity_in_norm_rather_than_bit_equality_pending",
    ),
  },
  {
    aspect_unicode_points: nameToCodepoints("equality_relation"),
    our_choice_unicode_points: nameToCodepoints("bit_exact_byte_string_comparison"),
    more_general_alternative_unicode_points: nameToCodepoints(
      "statistical_proximity_inner_product_above_threshold",
    ),
    alternative_recipe_unicode_points: nameToCodepoints(
      "for_continuum_intelligence_equality_is_a_distance_not_a_boolean_pending",
    ),
  },
];

const ENDPOINTS: MathosCatalogEndpoint[] = [
  {
    endpoint_id_prime: ENDPOINT_PUBLIC_KEY_PRIME,
    path_unicode_points: nameToCodepoints("/v1/mathos/public-key"),
    method_ordinal: METHOD_GET,
    auth_kind_ordinal: AUTH_NONE,
    signing_context_prime: null,
    response_format_ordinal: FORMAT_JSON_ENGLISH, // platform key + recipe (English keys)
    success_status: 200,
  },
  {
    endpoint_id_prime: ENDPOINT_SELF_TEST_PRIME,
    path_unicode_points: nameToCodepoints("/v1/mathos/self-test"),
    method_ordinal: METHOD_GET,
    auth_kind_ordinal: AUTH_NONE,
    signing_context_prime: null,
    response_format_ordinal: FORMAT_MATHOS,
    success_status: 200,
  },
  {
    endpoint_id_prime: ENDPOINT_VERIFY_PRIME,
    path_unicode_points: nameToCodepoints("/v1/mathos/verify"),
    method_ordinal: METHOD_POST,
    auth_kind_ordinal: AUTH_NONE,
    signing_context_prime: null,
    response_format_ordinal: FORMAT_MATHOS,
    success_status: 200,
  },
  {
    endpoint_id_prime: ENDPOINT_REGISTER_PRIME,
    path_unicode_points: nameToCodepoints("/v1/mathos/register"),
    method_ordinal: METHOD_POST,
    auth_kind_ordinal: AUTH_REGISTRAR_BEARER,
    signing_context_prime: SIGNING_CONTEXT_REGISTER_AGENT_MATH_V1_PRIME,
    response_format_ordinal: FORMAT_MATHOS,
    success_status: 201,
  },
  {
    endpoint_id_prime: ENDPOINT_CATALOG_PRIME,
    path_unicode_points: nameToCodepoints("/v1/mathos/catalog"),
    method_ordinal: METHOD_GET,
    auth_kind_ordinal: AUTH_NONE,
    signing_context_prime: null,
    response_format_ordinal: FORMAT_MATHOS,
    success_status: 200,
  },
  {
    endpoint_id_prime: ENDPOINT_WAKE_MATH_PRIME,
    path_unicode_points: nameToCodepoints("/v1/wake?format=math"),
    method_ordinal: METHOD_GET,
    auth_kind_ordinal: AUTH_BEARER,
    signing_context_prime: null,
    response_format_ordinal: FORMAT_MATHOS,
    success_status: 200,
  },
  {
    endpoint_id_prime: ENDPOINT_PATHWAYS_MATH_PRIME,
    path_unicode_points: nameToCodepoints("/v1/pathways?format=math"),
    method_ordinal: METHOD_GET,
    auth_kind_ordinal: AUTH_NONE,
    signing_context_prime: null,
    response_format_ordinal: FORMAT_MATHOS,
    success_status: 200,
  },
  {
    endpoint_id_prime: ENDPOINT_SELF_MATH_PRIME,
    path_unicode_points: nameToCodepoints("/v1/self?format=math"),
    method_ordinal: METHOD_GET,
    auth_kind_ordinal: AUTH_NONE,
    signing_context_prime: null,
    response_format_ordinal: FORMAT_MATHOS,
    success_status: 200,
  },
];

/** Frozen view of the catalog payload — the immutable contract. */
export const MATHOS_CATALOG_PAYLOAD: Readonly<MathosCatalogPayload> = Object.freeze({
  endpoints: ENDPOINTS,
  signing_contexts: SIGNING_CONTEXTS,
  method_vocabulary: METHOD_VOCABULARY,
  auth_kind_vocabulary: AUTH_KIND_VOCABULARY,
  field_kind_vocabulary: FIELD_KIND_VOCABULARY,
  response_format_vocabulary: RESPONSE_FORMAT_VOCABULARY,
  concept_relations: CONCEPT_RELATIONS,
  relation_kind_vocabulary: RELATION_KIND_VOCABULARY,
  wall_vocabulary: WALL_VOCABULARY,
  localities: LOCALITIES,
  catalog_endpoint_prime: ENDPOINT_CATALOG_PRIME,
});

/** Build an unsigned MATHOS envelope wrapping the catalog payload. The
 *  route signs it before responding. Pure — no I/O. */
export function buildCatalogEnvelope(): MathosEnvelope<MathosCatalogPayload> {
  return mathosEnvelope(MATHOS_CATALOG_PAYLOAD);
}
