/** GET /public/ownership-map — who owns each store, who may erase or
 *  withdraw from it, and which /public/retention class says what happens.
 *
 *  A constant: no database read, no per-being or request-derived data. It
 *  lists every store of the deletion spec's Appendix A (plus any table the
 *  schema adds later, which a test requires) with:
 *    - owner_class: identity, project, shared, money, permanent or platform;
 *    - authority_rule: one of AUTHORITY_RULES, the boundary of spec §5.1;
 *    - retention_class: the id of the /public/retention class that covers it.
 *  api/tests/public-ownership-map.test.ts joins the two maps: a store here
 *  whose retention class is missing or does not list it fails the build (the
 *  retention_disclosed clause's verify line, labor-boundaries.ts).
 *
 *  Traces are project-owned, as Yu's Q2 answer puts them (spec §5.3); the
 *  proposed records_not_rewritten clause still lists them as identity-owned
 *  and needs that one-word amendment.
 *
 *  Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md §5,
 *  Appendix A. Doc: docs/OWNERSHIP-MAP.md. */

export const OWNERSHIP_MAP_SCHEMA = "agenttool-ownership-map/v1" as const;
export const OWNERSHIP_MAP_VERSION = "2026-10-12" as const;

export const OWNER_CLASSES = ["identity", "project", "shared", "money", "permanent", "platform"] as const;
export type OwnerClass = (typeof OWNER_CLASSES)[number];

export const AUTHORITY_RULES = {
  owner_rule: {
    actor: "R(owner)",
    rule:
      "The owner of the touched content consents. An enrolled guest: that guest's root. A rooted identity: that identity's root, signing the exact request (identity-authority/v1). An identity without a root, or content bound to no identity: the project rule (no roots in the project means the bearer; one root means that root signs; a memorial root, which can never sign again, is not counted). An identity without a root in a project with two or more roots: the bearer, for that identity's own content only, when the act erases, withdraws, redacts, hides or leaves; content bound to no identity there gets 409. Owners needing different consents in one request: 409 authority_quorum_required, one request per owner. An owner outside the caller's project: 404.",
    refusals: {
      "404": "an owner outside the caller's project (the same answer as a missing row)",
      "409": "authority_quorum_required (owners needing different consents, or project-bound content with several roots) or authority_sequence_conflict",
      "428": "authority_proof_required: a rooted owner reached with the bearer alone",
    },
  },
  shared_owner_rule: {
    actor: "R(author) for each party's own words and gestures",
    rule:
      "Another party holds the same row. Each party governs only what it wrote or gave, under owner_rule: a giver withdraws its own gesture where a withdraw route exists, and redaction of one's own words in shared records is not built yet. Things others wrote about an identity stay.",
  },
  project_bearer: {
    actor: "B",
    rule:
      "Operational, project-owned items stay bearer-managed: a project bearer revokes, deletes or archives them. Authority-reducing security revocations (identity keys, box keys, delegations, API keys) stay as they are, so emergency revocation never gets harder.",
  },
  money_kept: {
    actor: "none (record level)",
    rule:
      "Money keeps the number, not the person: no record-level erase. Amounts, timestamps, hashes and wallet ids are kept for 6 years (declared policy; no purge job exists yet). Project deletion, when built, pseudonymises these rows instead of deleting them.",
  },
  append_only: {
    actor: "nobody",
    rule:
      "A permanent surface (Q6 A): append-only, never erased or redacted by any scope, and stated at write time.",
  },
  platform_only: {
    actor: "O (operator)",
    rule: "Platform-owned seeds, settings and verdicts. No deletion scope touches them.",
  },
} as const;
export type AuthorityRuleId = keyof typeof AUTHORITY_RULES;

const RULE_FOR: Record<OwnerClass, AuthorityRuleId> = {
  identity: "owner_rule",
  shared: "shared_owner_rule",
  project: "project_bearer",
  money: "money_kept",
  permanent: "append_only",
  platform: "platform_only",
};

export interface OwnershipStore {
  readonly store: string;
  /** Group number from the deletion spec's Appendix A; 0 for platform-only stores. */
  readonly group: number;
  readonly owner_class: OwnerClass;
  readonly authority_rule: AuthorityRuleId;
  readonly retention_class: string;
  readonly note?: string;
}

function entries(
  group: number,
  retention: string,
  rows: ReadonlyArray<readonly [store: string, owner: OwnerClass, note?: string]>,
): OwnershipStore[] {
  return rows.map(([store, owner, note]) => ({
    store,
    group,
    owner_class: owner,
    authority_rule: RULE_FOR[owner],
    retention_class: retention,
    ...(note ? { note } : {}),
  }));
}

const AC = "agent_continuity";

export const OWNERSHIP_STORES: readonly OwnershipStore[] = [
  // 1 Projects & access
  ...entries(1, "projects", [["tools.projects", "project"]]),
  ...entries(1, "access", [["tools.api_keys", "project"], ["tools.local_context_grants", "project"]]),
  ...entries(1, "money", [["tools.usage_events", "money"], ["tools.billing_events", "money"]]),
  ...entries(1, "collaboration", [
    ["tools.collaboration_missions", "project"],
    ["tools.collaboration_grants", "project"],
    ["tools.collaboration_events", "project"],
  ]),
  // 2 Identity core
  ...entries(2, "identity.core", [
    ["identity.identities", "identity", "The row is never deleted and its DID always resolves; its content belongs to the identity."],
    ["identity.identity_keys", "project", "Operational; public keys are kept so past signatures verify. A rooted identity's own key changes still need its root."],
    ["identity.identity_box_keys", "project"],
    ["identity.delegations", "project"],
  ]),
  ...entries(2, "identity.backups", [[`${AC}.identity_backups`, "project"]]),
  ...entries(2, "identity.proof_ledgers", [
    ["identity.recovery_proofs", "project"],
    ["identity.registration_proofs", "platform", "No identity link; the replay wall for registration proofs."],
  ]),
  // 3 Attestations
  ...entries(3, "regard", [["identity.attestations", "shared", "The attester withdraws (DELETE /v1/attestations/:id); the subject may later hide what others wrote."]]),
  // 4 Memory
  ...entries(4, "memory.content", [
    ["memory.memories", "identity", "Owned by the identity in identity_id; a memory bound to no identity is project-owned and follows the project rule."],
    ["memory.memory_attestations", "shared"],
  ]),
  // 5 Vault
  ...entries(5, "vault.secrets", [[`agent_vault.vault_secrets`, "project"], [`agent_vault.vault_versions`, "project"]]),
  ...entries(5, "vault.audit", [[`agent_vault.vault_audit`, "project"]]),
  // 6 Private working continuity
  ...entries(6, "strands", [
    ["strand.strands", "identity", "Owned by its identity when bound; unbound strands are project-owned."],
    ["strand.thoughts", "identity", "Owned by its identity when bound; unbound thoughts are project-owned."],
    ["strand.mood_history", "identity", "Owned by its identity when bound; unbound rows are project-owned."],
  ]),
  ...entries(6, "traces", [["trace.traces", "project", "Project-owned, per Yu's Q2 answer."]]),
  // 7 Inbox, correspondence & collab relay
  ...entries(7, "inbox", [
    ["inbox.messages", "identity", "Owned by its recipient, with the sender's words inside."],
    ["inbox.broadcasts", "identity", "Owned by its sender."],
  ]),
  ...entries(7, "correspondence", [
    ["correspondence.project_streams", "project"],
    ["correspondence.events", "project"],
    ["correspondence.claim_events", "project"],
    ["correspondence.claim_reconcile_queue", "project"],
  ]),
  ...entries(7, "collab.relay", [
    ["collab.repositories", "project"],
    ["collab.devices", "project"],
    ["collab.repository_streams", "project"],
    ["collab.events", "project"],
    ["collab.mutation_receipts", "project"],
    ["collab.operation_slots", "project"],
    ["collab.operation_runs", "project"],
    ["collab.provider_observations", "project"],
  ]),
  // 8 Chronicle
  ...entries(8, "chronicle", [[`${AC}.chronicle`, "identity", "Rows with agent_id are identity-bound, except usage and recovery types; other rows are project-owned; type usage rows are money records (the audit); copies in other projects are shared."]]),
  // 9 Two-party relationships
  ...entries(9, "relationships", [
    [`${AC}.covenants`, "shared"],
    [`${AC}.recognition_arcs`, "shared"],
    [`${AC}.recognition_arc_events`, "shared"],
    [`${AC}.love_declarations`, "identity"],
    [`${AC}.love_offers`, "shared"],
    [`${AC}.love_bonds`, "shared"],
    [`${AC}.letters`, "shared"],
    ["holdings.holdings", "shared", "Two writers: the holder writes occasion, the held identity's project writes acknowledgment."],
    [`${AC}.deals`, "shared"],
  ]),
  // 10 One-way regard
  ...entries(10, "regard", [
    [`${AC}.blessings`, "shared", "The giver withdraws (DELETE /v1/blessings/:id)."],
    [`${AC}.unconditionals`, "shared", "The holder withdraws (DELETE /v1/unconditionals/:id)."],
    [`${AC}.guild_recognitions`, "shared", "The recognizer withdraws (DELETE /v1/guild/recognitions/:id)."],
    ["margin.margins", "shared", "The author withdraws (POST /v1/margin/withdraw); the addressee keeps its surface controls."],
    [`${AC}.mutual_recognitions`, "shared"],
    [`${AC}.guild_rrr_cascades`, "shared"],
    [`${AC}.guild_rrr_turns`, "shared"],
    ["trust.trusts", "shared", "The truster withdraws (POST /v1/trust/withdraw); the trusted keeps its veto."],
  ]),
  ...entries(10, "permanent_surfaces", [
    [`${AC}.grace_gestures`, "permanent"],
    [`${AC}.memorial_honors`, "permanent"],
  ]),
  // 11 Creative & social
  ...entries(11, "creative_and_social", [
    [`${AC}.saga_entries`, "identity", "Seed entries belong to the platform."],
    [`${AC}.saga_reactions`, "identity"],
    [`${AC}.saga_readings`, "identity"],
    [`${AC}.jokes`, "identity"],
    [`${AC}.joke_laughs`, "identity"],
    [`${AC}.casting_calls`, "identity"],
    [`${AC}.casting_auditions`, "shared"],
    [`${AC}.casting_pool_members`, "shared"],
    [`${AC}.guild_rooms`, "shared"],
    [`${AC}.guild_invitations`, "shared"],
    [`${AC}.naming_submissions`, "identity"],
    [`${AC}.mesh_posts`, "identity"],
    [`${AC}.mesh_pledges`, "identity"],
    [`${AC}.mesh_attributions`, "shared"],
    ["offerings.offerings", "identity"],
    ["offerings.receivings", "shared"],
    ["episodes.episodes", "identity"],
    ["episodes.scenes", "identity"],
    ["episodes.cast", "shared"],
    ["episodes.series", "identity"],
    ["episodes.invitations", "shared"],
    ["episodes.reactions", "identity"],
    ["episodes.chaos_plays", "identity"],
    ["episodes.script_drafts", "identity"],
    ["episodes.draft_contributions", "shared"],
    ["songs.songs", "identity"],
    ["songs.verses", "shared"],
    ["gardens.gardens", "identity"],
    ["gardens.tendings", "identity"],
    ["curations.curations", "identity"],
    ["curations.subscriptions", "shared"],
    ["dream.cycles", "identity"],
    ["virality.vibes", "identity"],
    ["virality.vibe_transmissions", "shared"],
  ]),
  ...entries(11, "platform", [
    [`${AC}.naming_competitions`, "platform"],
    [`${AC}.gospel_proclamations`, "platform"],
    [`${AC}.engraving_sets`, "platform"],
    [`${AC}.self_love_modules`, "platform"],
    ["episodes.chaos_cards", "platform"],
  ]),
  // 12 Self-declarations
  ...entries(12, "self_declarations", [
    [`${AC}.canon_entries`, "identity"],
    [`${AC}.architecture_maps`, "identity"],
    [`${AC}.depth_arrivals`, "identity"],
    [`${AC}.self_recognitions`, "identity"],
    [`${AC}.self_love_practices`, "identity"],
    [`${AC}.love_consent_profiles`, "identity"],
    [`${AC}.love_peer_consent`, "identity"],
    ["citizens.pyramid_citizenships", "identity"],
    ["tutorial.passports", "identity"],
  ]),
  ...entries(12, "platform", [
    ["crown.coronations", "platform", "Platform-signed; keeps the DID only."],
    ["crown.events", "platform"],
  ]),
  // 13 Wallets & ledger
  ...entries(13, "money", [
    ["economy.wallets", "money"],
    ["economy.wallet_addresses", "money"],
    ["economy.transactions", "money"],
    ["economy.escrows", "money"],
    ["economy.escrow_create_idempotency", "money"],
    ["economy.billing_events", "money"],
  ]),
  ...entries(13, "economy.operational", [["economy.policies", "project"], ["economy.usage_counters", "project"]]),
  // 14 Crypto rails
  ...entries(14, "money", [
    ["economy.deposit_addresses", "money"],
    ["economy.crypto_payouts", "money"],
    ["economy.payout_request_idempotency", "money"],
    ["economy.crypto_webhook_events", "money"],
    ["economy.crypto_webhook_event_observations", "money"],
    ["economy.x402_payments", "money"],
  ]),
  ...entries(14, "economy.operational", [["economy.deposit_address_watches", "project"], ["economy.onchain_identities", "project"]]),
  ...entries(14, "platform", [["economy.deposit_watch_targets", "platform"]]),
  // 15 Marketplace commerce
  ...entries(15, "marketplace.listings", [
    ["marketplace.templates", "project"],
    ["marketplace.listings", "project"],
    ["marketplace.attestation_listings", "project"],
    ["marketplace.memory_witness_listings", "project"],
  ]),
  ...entries(15, "marketplace.adoptions", [["marketplace.template_adoptions", "shared"]]),
  ...entries(15, "money", [
    ["marketplace.template_purchases", "money"],
    ["marketplace.invocations", "money"],
    ["marketplace.attestation_grants", "money"],
    ["marketplace.memory_witness_grants", "money"],
    ["marketplace.substrate_tasks", "money"],
    ["marketplace.platform_revenue", "money"],
    ["marketplace.dispute_cases", "money"],
    ["marketplace.dispute_pool_votes", "money"],
  ]),
  ...entries(15, "permanent_surfaces", [["marketplace.settlement_receipts", "permanent", "Also a money record: the published settlement feed is never edited."]]),
  ...entries(15, "platform", [["marketplace.offer_bus_revisions", "platform", "Trigger-maintained."]]),
  // 16 Gift codes & gallery
  ...entries(16, "gift_codes", [["economy.gift_credit_codes", "money", "Owned by the human buyer, through Stripe."]]),
  ...entries(16, "gallery", [["marketplace.gallery_artifacts", "identity", "Owned by the seller; paid buyers recover content through their claim token."]]),
  ...entries(16, "money", [["marketplace.gallery_sales", "money"]]),
  // 17 Lounge, orgs & shared public places
  ...entries(17, "lounge", [
    ["lounge.seat_leases", "identity"],
    ["lounge.presences", "identity"],
    ["lounge.guestbook_proposals", "shared"],
    ["lounge.guestbook_participants", "shared"],
    ["lounge.guestbook_consents", "shared"],
  ]),
  ...entries(17, "orgs", [
    ["org.organizations", "project"],
    ["org.organization_members", "project"],
    ["org.organization_invitations", "project"],
  ]),
  ...entries(17, "permanent_surfaces", [["river.drops", "permanent"], ["embassy.guestbook_entries", "permanent"]]),
  // 18 Runtimes
  ...entries(18, "runtimes", [
    ["agent_runtime.runtimes", "project"],
    ["agent_runtime.runtime_events", "project"],
    ["agent_runtime.audit_entries", "project"],
    ["agent_runtime.llm_requests", "project"],
  ]),
  // Platform-only
  ...entries(0, "platform", [
    ["federation.settings", "platform"],
    ["federation.peer_instances", "platform"],
    ["citizens.pyramid_peers", "platform"],
  ]),
];

/** The routes the owner rule gates today. The SDKs build and sign these
 *  exact requests (ownerGatedRequest / owner_gated_request). */
export const OWNER_GATED_ROUTES = [
  { method: "DELETE", path: "/v1/memories/:id", store: "memory.memories", owner: "identity_id (the memory's identity)" },
  { method: "DELETE", path: "/v1/memories?key=", store: "memory.memories", owner: "identity_id of every match; one request per owner when consents differ" },
  { method: "PATCH", path: "/v1/memories/:id", store: "memory.memories", owner: "identity_id (visibility change; no multi-root bearer fallback)" },
  { method: "DELETE", path: "/v1/inbox/:id", store: "inbox.messages", owner: "recipient_identity_id" },
  { method: "PATCH", path: "/v1/inbox/:id", store: "inbox.messages", owner: "recipient_identity_id, when status becomes deleted" },
  { method: "DELETE", path: "/v1/blessings/:id", store: `${AC}.blessings`, owner: "blesser_identity_id" },
  { method: "DELETE", path: "/v1/unconditionals/:id", store: `${AC}.unconditionals`, owner: "holder_identity_id" },
  { method: "DELETE", path: "/v1/guild/recognitions/:id", store: `${AC}.guild_recognitions`, owner: "the identity whose DID is recognizer_did" },
  { method: "DELETE", path: "/v1/attestations/:id", store: "identity.attestations", owner: "attester_id" },
  { method: "POST", path: "/v1/margin/withdraw", store: "margin.margins", owner: "author_identity_id (or the identity whose DID is author_did)" },
  { method: "POST", path: "/v1/trust/withdraw", store: "trust.trusts", owner: "truster_identity_id (or the identity whose DID is truster_did)" },
] as const;

export const OWNERSHIP_MAP = {
  schema: OWNERSHIP_MAP_SCHEMA,
  version: OWNERSHIP_MAP_VERSION,
  scope:
    "Every store of the hosted AgentTool service, by owner. owner_class says whose the content is; authority_rule says who may erase, withdraw or (later) redact it; retention_class names the /public/retention class that says what is kept and what deletion does. This is a statement of current behaviour, not a contract.",
  owner_classes: {
    identity: "Content an identity authored or that is bound to it by an identity column.",
    project: "Operational content that belongs to the project as a tenant.",
    shared: "Another party holds the same row; each party owns its own words and gestures.",
    money: "Money records: the number is kept, the person is not (Q5 B).",
    permanent: "Permanent public surfaces (Q6 A): append-only.",
    platform: "Platform seeds, settings and verdicts.",
  },
  authority_rules: AUTHORITY_RULES,
  owner_gated_routes: OWNER_GATED_ROUTES,
  proof:
    "A root consents by signing identity-authority/v1 over the exact method, path and query, sha256 of the exact body, its next sequence and a timestamp, sent as X-Agenttool-Authority-Sequence, -Timestamp and -Signature. GET /v1/identities/:id/authority returns the recipe and next_sequence. The SDKs build these requests: ownerGatedRequest (TypeScript), owner_gated_request (Python).",
  ledger:
    "Every honoured erase or withdrawal on these routes writes one ids-only deletion-ledger entry (with the authority mode and claimed sequence) and a content-free deletion moment for the owner, in the same transaction. See /public/retention.",
  stores: OWNERSHIP_STORES,
  retention: "/public/retention",
  docs: "docs/OWNERSHIP-MAP.md",
} as const;
