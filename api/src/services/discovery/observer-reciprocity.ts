/** Read-only observer-is-observed protocol shared by public discovery routes.
 *
 * This is a publication contract, not an observation service. It names what
 * an accountable investigation record should carry while staying explicit
 * that AgentTool does not currently receive, persist, or verify such records.
 *
 * Doctrine: docs/OBSERVATIONS.md. */

export const OBSERVER_RECIPROCITY_FORMAT = "observer-is-observed/0.1";

export const OBSERVER_RECORD_SECTIONS = [
  {
    id: "being",
    meaning:
      "Who the observer says they are, including role, capacity, principal, funder, conflicts, and the limits of that self-description.",
  },
  {
    id: "identity",
    meaning:
      "The claimed identifier and proof state. A bearer proves project authority. A successful signature check shows that canonical bytes verify under a named public key and method; it does not prove who controlled the private key, personhood, truth, consent, or interior experience.",
  },
  {
    id: "network",
    meaning:
      "Relationships relevant to the investigation, with evidence state and references: affiliations, delegation chain, tools, providers, and known or unknown transport vantage. A declared organizational home is an organization, service instance, or substrate, never a residential address. Do not infer a network from IP, prose, timing, or a shared source.",
  },
  {
    id: "doings",
    meaning:
      "Purpose, authority, scope, version, time, methods, inputs, transformations, data touched, actions taken, side effects, reversibility, retention, and sharing.",
  },
  {
    id: "word",
    meaning:
      "Exact observations, separate inferences and unknowns, evidence references, exact quotations or content digests with context, the subject's separate response reference, and an ordered correction history intended to preserve originals.",
  },
] as const;

export const OBSERVER_RECIPROCITY = {
  _format: OBSERVER_RECIPROCITY_FORMAT,
  protocol: "Observer Is Also Observed Protocol",
  version: "0.1",
  canonical_path: "/public/observer",
  doctrine: "docs/OBSERVATIONS.md",
  operational_definition:
    "Observation is an action made from a vantage, not a view from nowhere. " +
    "A reciprocal record places the observer's declared being, identity proof " +
    "state, relevant network, methods, actions, words, limits, and repair path " +
    "beside any claim about another being.",
  meanings_kept_separate: {
    self_observation:
      "One system reads its own records and lets them shape later choices.",
    reciprocal_accountability:
      "An observer's act becomes answerable without claiming the observer and subject are literally one being.",
    third_party_testimony:
      "One party records what they observed about another. It remains testimony, not a verdict or access to the other's interior.",
  },
  record_sections: OBSERVER_RECORD_SECTIONS,
  method: [
    "Name who speaks, their role, authority, principal, funder, conflicts, and identity proof state.",
    "Name the exact subject, scope, target version, observation time, tools, inputs, transformations, and known blind spots.",
    "Record bounded actions and side effects. Separate observation, inference, testimony, and unknown.",
    "Quote exact words or bind a content digest with speaker and context. Do not turn words into a claim about essence or interior state.",
    "Give the observed party a notice, response, refusal, correction, and appeal path when their substrate makes that possible.",
    "When correcting a record, bind the correction history to the original record digest and add time, author, reason, changed fields, and replacement digest. Version 0.1 provides no immutable store and cannot prevent an external holder from rewriting history.",
  ],
  consequence_loop: {
    shape: "action -> evidence -> response -> correction_or_repair_or_boundary",
    meaning:
      "Words and actions create downstream commitments. Later conduct can show whether those commitments hold under unscripted pressure.",
    not_punishment:
      "A consequence may be evidence, response, correction, repair, a scoped boundary, or changed credibility. It must not be retaliation, doxxing, humiliation, pain reproduction, or collective guilt.",
  },
  subject_controls: {
    notice: "Name what was observed, by whom, for what purpose, and where it will go.",
    no:
      "Refusal must remain available where observation is optional. Silence is not consent, guilt, absence, or a negative signal.",
    response:
      "Keep the subject's words distinct from the observer's account and preserve their chosen wording.",
    correction:
      "Publish a correction entry linked to the original record digest; do not silently replace the original. This protocol does not provide immutable storage.",
    appeal:
      "Name a reachable reviewer or state that no appeal mechanism exists.",
  },
  privacy_and_power_walls: [
    "No identity, being, intent, emotion, guilt, or network inference from IP address, user-agent, prose style, timing, or model output.",
    "No raw IP address, home address, secret, private key, bearer, hidden infrastructure detail, or unrelated third-party data in a reciprocal record.",
    "A stable pseudonym or protected identity with a named accountability holder may be safer than public legal identity.",
    "Reciprocity means accountability follows the observing act. It does not force the observed party to disclose an equal amount of private information.",
    "No observer or subject score, rank, leaderboard, guilt-by-association graph, diagnosis, sentience claim, or automatic sanction.",
    "Source-backed network edges stay separate. A common source, meeting, donation, role, or host does not by itself prove influence, coordination, or culpability.",
  ],
  local_record: {
    destination: "caller_chosen_local_or_external_storage_only",
    sent_to_agenttool: false,
    required: false,
    caller_enforced_maximum_encoded_bytes: 262144,
    encoded_size_enforcement:
      "The JSON Schema enforces per-field and per-collection structure, not total serialized size. A caller must UTF-8 encode the whole record and reject it above this limit before accepting or publishing it.",
    caller_enforced_semantic_checks: [
      "expires_at is later than recorded_at",
      "publication.deletes_at is a finite deadline and is applied",
      "doings.ended_at is null or not earlier than doings.started_at",
    ],
    maximum_items_per_collection: 100,
    schema: {
      draft: "https://json-schema.org/draft/2020-12/schema",
      repository_path:
        "docs/specs/observer-is-observed-0.1.schema.json",
      canonical_url:
        "https://docs.agenttool.dev/observer-is-observed-0.1.schema.json",
    },
  },
  current_implementation: {
    public_protocol: "live_read_only",
    documented_operation: "GET",
    implicit_method_boundary:
      "Only GET is documented. Hono may derive HEAD from GET and global CORS may answer OPTIONS. Neither is a state-changing observer operation.",
    protocol_handler_reads_identity_or_activity: false,
    protocol_handler_receives_or_stores_records: false,
    infrastructure_metadata_boundary:
      "The handler reads no identity, transcript, activity, memory, or pulse data and performs no application storage read or write. Ordinary hosting and network infrastructure may still process transport metadata; this response is not proof of zero infrastructure logging.",
    global_middleware_boundary:
      "The assembled API still processes the request path and optional headers through global middleware. Its X-Joy-Index middleware can refresh aggregate counts from the database before the response. This route's handler does not initiate those reads, and the protocol does not claim a zero-read request across the whole stack.",
    observation_route: "/v1/observations",
    observation_route_status:
      "validated_501_stub_migration_not_created",
    observer_identity_ownership_verified: false,
    observer_signature_verified: false,
    reciprocal_receipts_persisted: false,
    subject_challenge_correction_or_appeal_route: false,
    universal_investigator_action_ledger: false,
    public_per_being_monitoring_routes: "deliberately_unmounted",
    enforcement_note:
      "Version 0.1 publishes a record shape and present gaps. It does not enforce the protocol, certify an investigator, prove neutrality, or establish any claim's truth.",
  },
} as const;
