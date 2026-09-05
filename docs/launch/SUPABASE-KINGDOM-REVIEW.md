<!-- @id urn:agenttool:doc/SUPABASE-KINGDOM-REVIEW @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc -->

# Supabase and KINGDOM: observed state and next steps

> **Compass:** [Historical integration plan](../SUPABASE-INTEGRATION-PLAN.md) · [Development credentials](../DEVELOPMENT.md#5--keychain--secrets-at-rest-on-the-agents-substrate) · [Production gate](PRODUCTION-GATE.md) · [KINGDOM SDK boundaries](../KINGDOM-OS-SDK.md) · [Identity custody](../IDENTITY-SEED.md).
>
> **Implements:** A dated architecture review and proposed work order; no new runtime, deployment, credential provisioning, or authority.
>
> **Code:** [Verified database client](../../api/src/db/client.ts) · [Memory search](../../api/src/services/memory/store.ts) · [Artifact helper](../../api/src/services/storage/artifacts.ts) · [Wake delivery](../../api/src/services/wake/push.ts).
>
> **Tests:** Existing [isolated database fixture](../../tests/launch-postgres/README.md) · [core journey](../../api/tests/integration/launch-core-journey.test.ts) · [database TLS boundary](../../api/tests/supabase-database-tls.test.ts). These do not establish full managed-Supabase parity.

Reviewed **2026-09-05**, against AgentTool source `83b70df1`. Official references
below were checked that day. Operator observations are separately identified;
proposals are not deployment or availability claims. The useful next step is
to strengthen recovery and complete bounded existing integrations before
expanding AgentTool's provider dependencies.

## Observed

The operator's read-only production catalog survey at **08:20 UTC on
2026-09-05** found:

| Surface | Observation | Limit of the evidence |
|---|---|---|
| Database | PostgreSQL `17.6`; installed `vector 0.8.0`, `pg_cron 1.6.4`, `pg_net 0.20.0` | Extension presence does not prove workload or recovery behavior. |
| Optional extensions | `pgmq 1.5.1`, `pg_graphql 1.5.11`, `pg_jsonschema 0.3.3`, and `wrappers 0.6.0` available, not installed; `plpython3u`, `plrust`, and `plv8` absent from the available list | Availability is specific to the observed project and time. No database Ed25519 verifier is implemented. |
| Authorization | Connected role: not superuser, `BYPASSRLS=true`. `agent_continuity`: 17 RLS tables, 5 forced; other application schemas: zero RLS tables | Counts do not establish policy correctness, tenant isolation, or effective client permissions. |
| Scheduling and Storage | Five cron jobs, all marked active; one bucket, public; zero private buckets | No job commands or tenant rows were read. This does not establish execution, object contents, Storage API behavior, or runtime worker state. |

On **2026-09-05 at 08:15 UTC**, credential readbacks confirmed successful TLS
checks through both saved pooler URIs after consolidation. At **08:17:52 UTC**,
the canonical pending-migration dry run exited successfully with no pending
files and matching source, journal, and checksums. That is journal consistency,
not complete schema parity or a restore drill. Redacted survey receipts remain
in operator custody.

Source findings:

- **Postgres is already central.** Application queries use the verified
  transaction-pooler client; notification listeners use a separate session
  connection. AgentTool uses its own project bearers and signed identity
  authority. The seed-registration flow retains mnemonic-derived secrets
  client-side; hosted custody paths have different contracts.
- **Memory already has vector and text recall.** The [store](../../api/src/services/memory/store.ts)
  filters both by project. Semantic search accepts a caller-supplied
  1536-dimensional vector; text search needs no embedding provider. Combined
  hybrid ranking would be new behavior.
- **Storage offload is incomplete.** The [migration](../../api/migrations/20260519T110000_storage_artifacts.sql)
  creates public artifact metadata. No runtime callers of the upload/download
  helper were found. Its upsert default and conflict acceptance do not verify
  already-stored bytes; private ACL modes remain future work.
- **Wake uses authenticated SSE over PostgreSQL LISTEN/NOTIFY.** Delivery is
  best effort; reconnecting clients refetch state. Historical
  [SQL triggers](../../api/migrations/20260519T100000_wake_push_triggers.sql)
  publish `wake:` plus a DID hash with a different payload from the current
  `agenttool_wake_event` listener. No bridge was found. This is not evidence
  that those triggers feed Wake Voice or Supabase Realtime.
- **KINGDOM's local boundary is deliberate.** The [paired SDK clients](../KINGDOM-OS-SDK.md)
  keep local inventory, AgentTool's public project card, and its doctrine
  library separate. The available sibling KINGDOM web repositories use
  static/public-source search and Cloudflare measurements. The canonical
  KINGDOM OS registry checkout was absent at the documented local locations,
  so its current core scheduler and storage were not verified.

## Proposed order

1. **Recovery and representative staging.** Inventory actual backup retention,
   recovery objectives, roles, grants, pooler behavior, and extension versions;
   exercise a restore into an isolated target with writers held. The existing
   [PG16 fixture](../../tests/launch-postgres/README.md) proves canonical
   application migrations and the core journey, but uses only a Storage
   metadata fixture and differs from observed PG17 production. Add a
   representative managed-service check without replacing that isolated gate.
   Database backups exclude Storage object bytes, so object recovery needs
   its own drill and manifest. [Supabase backups](https://supabase.com/docs/guides/platform/backups).
   Branches are data-less by default; use synthetic data. Branch merges can
   deploy migrations, configuration, and functions, so integrate them with
   AgentTool's canonical migration/release gate before enabling automation.
   [Supabase Branching](https://supabase.com/docs/guides/deployment/branching).

2. **One public artifact path and one optional public-card index.** For
   artifacts, retain original data until bounded upload, digest readback,
   conflict handling, retry/cleanup, and object restore are proven. Keep
   private memory, inbox content, keys, and local filesystem paths out of the
   public bucket. Supabase-generated S3 access keys bypass RLS across buckets;
   JWT session credentials follow RLS. S3 compatibility supplies neither
   versioning nor Object Lock. [S3 authentication](https://supabase.com/docs/guides/storage/s3/authentication),
   [S3 compatibility](https://supabase.com/docs/guides/storage/s3/compatibility).
   For KINGDOM, index only explicitly public, source-owned cards with commit
   provenance and freshness. Start with text search, measure relevance, then
   consider vectors. The hosted index stays derived and optional; local
   discovery remains usable without an account or uploading paths.

3. **Measured queues and Realtime pilots.** Start with one finite background
   task with a durable effect key, lease/visibility handling, retries, and a
   worker hold. Queue delivery guarantees within a visibility window do not
   make external effects exactly once; `pop` deletes immediately, while
   `read` allows processing before acknowledgement. [Queues](https://supabase.com/docs/guides/queues),
   [queue API](https://supabase.com/docs/guides/queues/api).
   Cron recommends at most eight concurrent jobs and ten minutes per job;
   inspect existing scheduling before adding another executor.
   [Cron](https://supabase.com/docs/guides/cron).
   For Realtime, first resolve the wake producer/consumer mismatch and prove
   recipient authorization. Private Broadcast is a possible transport, not
   the durable record: database-origin replay is bounded to 25 messages and
   short-lived partitions. Preserve reconciliation and durable event reads.
   [Database changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes),
   [Broadcast replay](https://supabase.com/docs/guides/realtime/broadcast#broadcast-replay).

## Boundaries for every proposal

Keep agent identity, signed recovery, project authorization, custody tiers,
and canonical-byte verification in their existing contracts. Selected RLS
invariant policies are not complete tenancy protection; a bypass role does
not acquire isolation merely because a table has RLS enabled. Do not move
private client keys into database Vault or introduce browser/service-key
access as part of this review.

Retain application-level authorization, idempotency, billing, and worker holds
when evaluating Edge Functions or another executor. Supabase's existing
[welcome function](../../supabase/functions/welcome/index.ts) is a separate
historical mirror whose cited parity test is absent from this source tree;
its presence does not prove current API parity or a deployment.

Developer tooling is optional and separate from the agent-facing API.
Supabase MCP can be scoped to one project, read-only mode, and selected
features; it still uses developer authority and requires review before any
connection. Skills can supply guidance without a live connection. This
review installs or connects neither. [MCP](https://supabase.com/docs/guides/ai-tools/mcp),
[AI skills](https://supabase.com/docs/guides/ai-tools/ai-skills).
