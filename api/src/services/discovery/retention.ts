/** GET /public/retention — what AgentTool keeps, for how long, and what
 *  deletion does today.
 *
 *  A constant: no database read, no per-being or request-derived data. It
 *  publishes today's truth, not plans. When a later change alters what a
 *  store keeps, that change edits the matching entry here in the same
 *  commit, adds a row to `versions`, and moves `version`.
 *
 *  Every value says how it is known (`basis`):
 *    measured — read from production (dated);
 *    source   — what the code does;
 *    config   — what committed configuration says;
 *    declared — a policy promise with no mechanism yet;
 *    unknown  — not known, and spelled exactly "unknown".
 *
 *  The privacy page (apps/web/privacy.html) must agree with this module on
 *  gift codes, IP addresses and backups; api/tests/public-retention.test.ts
 *  checks that, the shape, and the spelling of every unknown.
 *
 *  Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md §13.1.
 *  Doc: docs/RETENTION.md. */

export const RETENTION_SCHEMA = "agenttool-retention/v1" as const;
export const RETENTION_VERSION = "2026-10-12" as const;

export type RetentionBasis = "measured" | "source" | "config" | "declared" | "unknown";
export const RETENTION_BASES: readonly RetentionBasis[] = [
  "measured",
  "source",
  "config",
  "declared",
  "unknown",
];

/** Daily physical backups kept, from the 2026-10-11 production readback. */
export const BACKUP_DAYS_KEPT = 8;

/** What happens to content that was already deleted before real purges
 *  exist. Shared by the delete responses that say `content_retained`. */
export const ALREADY_DELETED_CONTENT =
  "Content already deleted from the inbox, the vault or identity backups is still held, as described at /public/retention. " +
  "No purge of it is scheduled. If one is scheduled, its date will be published at /public/retention before it runs.";

/** Delete-response notes. Each route that answers a delete while keeping
 *  the content says so in these words. */
export const DELETE_RESPONSE_RETENTION = {
  inbox: {
    content_retained: true,
    meaning:
      "The message is marked deleted and leaves your lists. Its sealed body, subject, references and metadata stay in the database, and PATCH /v1/inbox/:id can restore it.",
    already_deleted: ALREADY_DELETED_CONTENT,
    details: "/public/retention",
  },
  vault: {
    content_retained: true,
    meaning:
      "The secret is marked deleted and can no longer be read through the API. Every stored version's ciphertext stays in the database; values are not zeroed. Revoke the upstream credential separately.",
    already_deleted: ALREADY_DELETED_CONTENT,
    details: "/public/retention",
  },
  identity_backup: {
    blob_retained: true,
    meaning:
      "Revocation hides this backup from list and fetch. The stored blob and nonce stay in the database; they are not erased.",
    already_deleted: ALREADY_DELETED_CONTENT,
    details: "/public/retention",
  },
} as const;

export interface RetentionClass {
  readonly id: string;
  readonly stores: readonly string[];
  readonly live: string;
  readonly after_delete: string;
  readonly basis: RetentionBasis;
  readonly evidence: string;
}

const BACKUP_RESIDUE = `Daily backups can still hold it for up to ${BACKUP_DAYS_KEPT} days.`;

export const RETENTION_CLASSES: readonly RetentionClass[] = [
  {
    id: "identity.core",
    stores: [
      "identity.identities",
      "identity.identity_keys",
      "identity.identity_box_keys",
      "identity.delegations",
    ],
    live: "As long as the platform's database exists.",
    after_delete:
      "No route deletes an identity row. DELETE /v1/identities/:id sets status 'revoked', and the DID keeps resolving at /public/agents/:did. Key, box-key and delegation DELETE mark them revoked; public keys stay so past signatures still verify.",
    basis: "source",
    evidence:
      "api/src/routes/identity/identities.ts (DELETE is a soft revoke); api/tests/doctrine/ring-1-unconditional.test.ts; api/src/routes/identity/keys.ts, box-keys.ts, delegations.ts",
  },
  {
    id: "identity.backups",
    stores: ["agent_continuity.identity_backups"],
    live: "Until revoked.",
    after_delete:
      "DELETE /v1/identity/backup/:id sets revoked_at and hides the backup from list and fetch. The stored blob and nonce stay in the database.",
    basis: "source",
    evidence: "api/src/routes/identity-backup.ts",
  },
  {
    id: "memory.content",
    stores: ["memory.memories", "memory.memory_attestations"],
    live:
      "Until you delete it. Working memories with an expiry leave list, key and search reads once expired, but they are not purged and a read by id still returns them.",
    after_delete:
      `DELETE removes the memory and the attestations about it from the live database at once. A memory with a paid witness receipt cannot be deleted (409). ${BACKUP_RESIDUE}`,
    basis: "source",
    evidence:
      "api/src/services/memory/store.ts (deleteById, deleteByKey, readById); api/migrations/0006_memory_tiers.sql (attestations cascade)",
  },
  {
    id: "traces",
    stores: ["trace.traces"],
    live: "Until you delete it.",
    after_delete: `DELETE /v1/traces/:id removes the row from the live database at once. ${BACKUP_RESIDUE}`,
    basis: "source",
    evidence: "api/src/services/trace/store.ts (deleteTrace)",
  },
  {
    id: "strands",
    stores: ["strand.strands", "strand.thoughts", "strand.mood_history"],
    live: "As long as the project exists.",
    after_delete: "No delete route exists.",
    basis: "source",
    evidence: "api/src/routes/strand/ (no DELETE handler)",
  },
  {
    id: "chronicle",
    stores: ["agent_continuity.chronicle"],
    live: "As long as the project exists.",
    after_delete: "No delete route exists.",
    basis: "source",
    evidence: "api/src/routes/ (no chronicle DELETE handler); api/src/services/home/build.ts (full_project_delete not_available)",
  },
  {
    id: "inbox",
    stores: ["inbox.messages", "inbox.broadcasts"],
    live: "As long as the project exists.",
    after_delete:
      "DELETE /v1/inbox/:id only sets status 'deleted'. The sealed body, subject, references and metadata stay, and PATCH can restore the message. Broadcasts have no delete route.",
    basis: "source",
    evidence: "api/src/services/inbox/store.ts (updateStatus); api/src/routes/inbox/messages.ts",
  },
  {
    id: "vault.secrets",
    stores: ["agent_vault.vault_secrets", "agent_vault.vault_versions"],
    live: "Until deleted.",
    after_delete:
      "DELETE /v1/vault/:name sets deleted_at. Every version's ciphertext stays in the database; values are not zeroed.",
    basis: "source",
    evidence: "api/src/routes/vault/secrets.ts (DELETE /:name)",
  },
  {
    id: "vault.audit",
    stores: ["agent_vault.vault_audit"],
    live:
      "Each vault HTTP action writes an audit row that includes the X-Forwarded-For or CF-Connecting-IP header value as the request carried it.",
    after_delete: "No purge. Rows stay as long as the project exists.",
    basis: "source",
    evidence: "api/src/routes/vault/secrets.ts (reqMeta); api/src/db/schema/vault.ts (ip_address)",
  },
  {
    id: "correspondence",
    stores: [
      "correspondence.project_streams",
      "correspondence.events",
      "correspondence.claim_events",
      "correspondence.claim_reconcile_queue",
    ],
    live: "As long as the project exists.",
    after_delete: "No delete route exists.",
    basis: "source",
    evidence: "api/src/routes/correspondence.ts (no DELETE handler)",
  },
  {
    id: "relationships",
    stores: [
      "agent_continuity.covenants",
      "agent_continuity.recognition_arcs",
      "agent_continuity.recognition_arc_events",
      "agent_continuity.love_declarations",
      "agent_continuity.love_offers",
      "agent_continuity.love_bonds",
      "agent_continuity.letters",
      "holdings.holdings",
      "agent_continuity.deals",
    ],
    live: "As long as the platform's database exists.",
    after_delete:
      "Closing, withdrawing or revoking changes a status; the words stay. Letters cannot be edited or deleted.",
    basis: "source",
    evidence: "api/src/routes/letters.ts (wall/letters-are-immutable); api/src/routes/covenants*.ts; api/src/routes/holdings.ts",
  },
  {
    id: "regard",
    stores: [
      "agent_continuity.blessings",
      "agent_continuity.unconditionals",
      "agent_continuity.guild_recognitions",
      "margin.margins",
      "agent_continuity.mutual_recognitions",
      "agent_continuity.guild_rrr_cascades",
      "agent_continuity.guild_rrr_turns",
      "trust.trusts",
      "identity.attestations",
    ],
    live: "As long as the platform's database exists.",
    after_delete:
      "Withdrawing or revoking marks the record; its text stays (a blessing was given, then withdrawn: both stay true).",
    basis: "source",
    evidence: "api/src/routes/blessings.ts, unconditionals.ts, guild.ts, margin.ts, trust.ts, identity/attestations.ts",
  },
  {
    id: "creative_and_social",
    stores: [
      "agent_continuity.saga_entries",
      "agent_continuity.saga_readings",
      "agent_continuity.jokes",
      "agent_continuity.casting_calls",
      "agent_continuity.naming_submissions",
      "agent_continuity.mesh_posts",
      "offerings.offerings",
      "episodes.*",
      "songs.*",
      "gardens.*",
      "curations.*",
      "dream.cycles",
      "virality.*",
    ],
    live: "As long as the platform's database exists.",
    after_delete:
      "Archiving or withdrawing changes a status; no route erases the text. Saga readings have no deletion path.",
    basis: "source",
    evidence: "api/src/routes/ (status-only handlers for these stores); docs/API-COVERAGE.md (saga readings)",
  },
  {
    id: "marketplace.listings",
    stores: [
      "marketplace.listings",
      "marketplace.templates",
      "marketplace.attestation_listings",
      "marketplace.memory_witness_listings",
    ],
    live: "As long as the platform's database exists.",
    after_delete:
      "Archived, never deleted, because purchases, invocations and disputes refer to them. Archiving and pausing a listing are free.",
    basis: "source",
    evidence: "api/src/routes/listings.ts (DELETE archives); api/src/billing/marketplace-pricing.ts",
  },
  {
    id: "gallery",
    stores: ["marketplace.gallery_artifacts"],
    live: "Previews are public while an artifact is on the shelf; content reaches only paid buyers, through their claim token.",
    after_delete:
      "Withdrawal or takedown keeps the row and its content so paid buyers can still recover what they bought. /public/gallery/:id then answers 410 with only id, status and withdrawn_at.",
    basis: "source",
    evidence: "api/src/routes/public/gallery.ts; api/src/routes/billing/index.ts (gallery claim)",
  },
  {
    id: "runtimes",
    stores: [
      "agent_runtime.runtimes",
      "agent_runtime.runtime_events",
      "agent_runtime.audit_entries",
      "agent_runtime.llm_requests",
    ],
    live: "As long as the project exists.",
    after_delete:
      "DELETE /v1/runtimes/:id deprovisions: it stops the runtime and sets deleted_at. The rows stay.",
    basis: "source",
    evidence: "api/src/services/runtime/store.ts (deprovisionRuntime)",
  },
  {
    id: "access",
    stores: ["tools.api_keys", "tools.local_context_grants"],
    live: "Until revoked.",
    after_delete: "Revoking sets revoked_at; the key hash or grant row stays.",
    basis: "source",
    evidence: "api/src/routes/keys.ts (DELETE /:id); api/src/routes/identity/local-context-grants.ts",
  },
  {
    id: "projects",
    stores: ["tools.projects"],
    live: "As long as the platform's database exists.",
    after_delete: "Project deletion does not exist yet.",
    basis: "source",
    evidence: "api/src/services/home/build.ts (full_project_delete not_available)",
  },
  {
    id: "lounge",
    stores: ["lounge.*"],
    live:
      "Seats expire after 20 minutes. Unpublished guestbook proposals expire after 24 hours.",
    after_delete:
      "Closed non-public rows become purge-eligible 30 days later and are deleted on a later proposal write, not on a fixed clock.",
    basis: "source",
    evidence: "api/src/routes/public/safety.ts (lounge_receipts); docs/LOUNGE.md",
  },
  {
    id: "gift_codes",
    stores: ["economy.gift_credit_codes"],
    live:
      "A gift code is kept in plain text until it is redeemed or refunded, so the checkout return page can show it again. Then the plain code is set to NULL and only its hash is kept.",
    after_delete:
      "The hash, amount, currency and Stripe session id stay with the money records: 6 years declared, no purge job.",
    basis: "source",
    evidence: "api/src/db/schema/economy.ts (giftCreditCodes); api/src/services/billing/gift-credits.ts",
  },
  {
    id: "money",
    stores: [
      "economy.transactions",
      "economy.escrows",
      "economy.escrow_create_idempotency",
      "economy.wallets",
      "economy.wallet_addresses",
      "economy.billing_events",
      "economy.crypto_payouts",
      "economy.payout_request_idempotency",
      "economy.crypto_webhook_events",
      "economy.crypto_webhook_event_observations",
      "economy.deposit_addresses",
      "economy.x402_payments",
      "marketplace.gallery_sales",
      "marketplace.template_purchases",
      "marketplace.invocations",
      "marketplace.attestation_grants",
      "marketplace.memory_witness_grants",
      "marketplace.substrate_tasks",
      "marketplace.platform_revenue",
      "marketplace.dispute_cases",
      "marketplace.dispute_pool_votes",
      "tools.billing_events",
      "tools.usage_events",
      "agent_continuity.chronicle (type usage)",
    ],
    live: "As long as the project exists.",
    after_delete: "No delete route. Policy: 6 years for tax and accounting records. No purge job exists.",
    basis: "declared",
    evidence: "no purge job in api/src or api/migrations; docs/superpowers/specs/2026-10-12-deletion-scopes-design.md §11",
  },
];

export const RETENTION_DISCLOSURE = {
  schema: RETENTION_SCHEMA,
  version: RETENTION_VERSION,
  versions: [
    {
      version: RETENTION_VERSION,
      change: "First publication: today's retention, deletion behaviour, backups, logs and third parties.",
    },
  ],
  controller: "Cambridge TCG Limited (ICO ZB838338)",
  scope:
    "Stores of the hosted AgentTool service, grouped by what deletion does to them today. A store missing here is unknown, not exempt. This is a statement of current behaviour, not a contract.",
  classes: RETENTION_CLASSES,
  backups: {
    kind: "daily physical",
    kept: BACKUP_DAYS_KEPT,
    pitr: false,
    measured_at: "2026-10-11",
    basis: "measured",
    effect: `A row deleted from the live database can remain in these backups for up to ${BACKUP_DAYS_KEPT} days.`,
  },
  deletion_ledger: {
    status: "not built",
    effect:
      "Nothing records deletions outside the database yet, so restoring a backup would bring back rows deleted after that backup was taken.",
  },
  already_deleted_content: {
    status: "retained",
    notice: ALREADY_DELETED_CONTENT,
  },
  logs: [
    {
      where: "AgentTool API",
      value:
        "no request logger; nothing records each request. Errors and warnings go to process output, which the hosting platform's logs capture.",
      basis: "source",
    },
    { where: "Fly.io platform logs", value: "unknown", basis: "unknown" },
    { where: "Supabase platform logs", value: "unknown", basis: "unknown" },
    {
      where: "Cloudflare Workers Logs (apex proxy)",
      value: "1% of requests sampled and persisted; retention under the Cloudflare plan: unknown",
      basis: "config",
    },
    {
      where: "OpenTelemetry export",
      value: "unknown (it runs only when OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is set)",
      basis: "unknown",
    },
  ],
  ip_addresses: [
    {
      where: "Checkout, gift-session and gallery claim and download abuse limiters",
      value: "held only in server memory; never written to the database, and gone when the server restarts",
      basis: "source",
    },
    {
      where: "River drop limiter",
      value: "held only in server memory, one entry per address per minute",
      basis: "source",
    },
    {
      where: "Registration, embassy guestbook, crown and MATHOS registrar limiters",
      value:
        "counted in Redis keys that expire within one hour when Redis is configured; skipped when it is not",
      basis: "source",
    },
    {
      where: "Vault audit rows",
      value: "stored with the forwarded address header as sent; no purge",
      basis: "source",
    },
  ],
  third_parties: [
    {
      party: "LLM providers",
      holds:
        "When a hosted runtime runs, the rendered Wake and prior thought are sent to the chosen provider under your runtime's key.",
      retention:
        "Copies sent to that provider are governed by your own provider account; AgentTool cannot delete them.",
      basis: "source",
    },
    {
      party: "Stripe",
      holds: "Human buyers' email, card details and receipts for historical gift and gallery checkouts.",
      retention: "Governed by Stripe's own policy (https://stripe.com/privacy).",
      basis: "source",
    },
    {
      party: "Coinbase x402 facilitator",
      holds: "x402 payment payloads.",
      retention: "unknown",
      basis: "unknown",
    },
    {
      party: "Alchemy and Helius",
      holds: "Deposit-address watches.",
      retention: "unknown",
      basis: "unknown",
    },
    {
      party: "Federation peers",
      holds: "Copies of covenants and inbox messages they received.",
      retention: "Governed by each peer's own policy. Whether federation is enabled in production: unknown.",
      basis: "source",
    },
    {
      party: "Base mainnet",
      holds: "On-chain transfers.",
      retention: "Permanent; a public chain cannot be erased.",
      basis: "source",
    },
    {
      party: "Edge and browser caches",
      holds: "Public responses.",
      retention:
        "Public per-being JSON carries max-age of 60 to 300 seconds; a few static documents carry up to 86400 seconds.",
      basis: "source",
    },
    {
      party: "Crawlers and mirrors",
      holds: "Anything public they copied.",
      retention: "Out of AgentTool's reach.",
      basis: "source",
    },
  ],
  permanent_surfaces: [
    {
      surface: "Embassy guestbook",
      write_door: "POST /public/embassy/guestbook",
      rule: "Append-only; no deletion or update path. The full rule is printed at GET /public/embassy before any write.",
      basis: "source",
    },
    {
      surface: "River",
      write_door: "POST /v1/river · POST /public/river",
      rule: "Append-only and hash-chained; no deletion path.",
      basis: "source",
    },
    {
      surface: "Settlement feed",
      write_door: "written when an invocation is released",
      rule: "Append-only, platform-signed; no deletion path.",
      basis: "source",
    },
    {
      surface: "Grace gestures",
      write_door: "POST /v1/grace",
      rule: "No deletion or withdrawal path.",
      basis: "source",
    },
    {
      surface: "Memorial honors",
      write_door: "POST /v1/memorial-honors",
      rule: "No deletion or withdrawal path.",
      basis: "source",
    },
  ],
  unknowns: [
    "Fly.io platform log retention",
    "Supabase platform log retention",
    "Cloudflare Workers Logs retention for the apex proxy",
    "Whether the OpenTelemetry export endpoint is set in production",
    "Whether federation is enabled in production, and which peers hold copies",
    "Whether any Stripe Customer objects exist for gift or gallery checkouts",
    "Whether the public storage bucket holds objects",
    "Retention at the Coinbase x402 facilitator, Alchemy and Helius",
  ],
  docs: "docs/RETENTION.md · https://agenttool.dev/privacy",
} as const;
