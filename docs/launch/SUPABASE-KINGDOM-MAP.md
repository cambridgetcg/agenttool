# Supabase × KINGDOM: capabilities and experiments

> **Compass:** [Production gate](PRODUCTION-GATE.md) · [Stack](../STACK.md) · [Historical Supabase plan](../SUPABASE-INTEGRATION-PLAN.md)
> **Implements:** a dated research map and proposed experiments across the existing KINGDOM layers.
> **Code:** [Offline map](../../review/supabase-kingdom-20260906/index.html) · [Machine-readable graph](../../review/supabase-kingdom-20260906/data.json) · `packages/kingdom/`.
> **Tests:** [Review validation and reproduction](../../review/supabase-kingdom-20260906/README.md); experiment acceptance criteria are prospective.

The [interactive map](../../review/supabase-kingdom-20260906/index.html) links seven KINGDOM layers, 25 Supabase capabilities, nine proposed compositions, and 62 sources. Open the downloaded HTML directly in a browser. Search, selection, and JSON export work offline; source pages open only when selected.

The recommended first experiment is **an offline Commons workbench**. It can prove provenance-preserving import and export before choosing a hosted service. Follow it with the **finite Creation Loop queue** and **recoverable delivery ledger** in disposable local fixtures. These proposals complement the launch work; they do not replace its release or migration path.

## What the map means

Research was checked on **6 September 2026**, against AgentTool source `83b70df18918c22cf896ff7dc1e41ef8a7bc80df` and the available KINGDOM OS checkout `c50dfcbe55b4d8438187e5cf94791ed24707ec4b`. Project extension observations come from the **5 September** inventory recorded in the [separate operational review candidate](https://github.com/cambridgetcg/agenttool/blob/05f4b4e428853d7551b0b1dd75867eaf336344bf/docs/launch/SUPABASE-KINGDOM-REVIEW.md). The database inventory was not rerun for this map.

| Evidence label | Meaning |
|---|---|
| Observed | A dated project observation; the associated status states its scope. |
| Documented | An official public contract, with project access/configuration still unverified unless separately stated. |
| Source | Version-bound public implementation or upstream research lead; hosted availability is unproved. |
| Mixed | A combination of project observations, documentation, and/or source evidence. |
| Proposal | Our composition and acceptance experiment; implementation and successful execution remain prospective. |

The layer names are the existing `soul`, `runtime`, `nervous`, `fleet`, `economy`, `commerce`, and `os` values. Provider-to-layer edges are our design interpretation. The observed [AgentTool card](https://api.agenttool.dev/public/kingdom/framework) declares `infra/nervous`; this research changes neither its membership nor its permissions. Card metadata, dependency edges, and voluntary adoption declarations remain separate under the [KINGDOM package contract](../../packages/kingdom/README.md).

The framework inspection covers available web-facing schemas, the Commons roadmap, and public artifacts. The canonical local KINGDOM registry/runtime checkout was absent at its documented locations. Consequently, the map makes no claim about a verified core scheduler or global fleet implementation.

## Where the interesting combinations are

| Proposed experiment | Useful connection | First proof |
|---|---|---|
| Offline Commons workbench | Build-time metadata ingestion → provenance relations → deterministic static catalog | Identical inputs export identical bytes; offline reading makes no provider request. |
| Finite Creation Loop queue | Explicitly authorized turn → one receipt/enqueue transaction → bounded idempotent worker | Rollback leaves neither record; interrupted delivery produces one application effect. |
| Recoverable delivery ledger | Logged intent → post-commit HTTP → explicit receiver acknowledgment | Crash and lost acknowledgment remain reconcilable without duplicate effects. |
| Exact declaration library | Canonical artifacts → derived JSONB → hybrid search with source references | Rebuilding search preserves source digests and keeps declarations, observations, and withdrawals distinct. |
| Return hints | Private Realtime hints → durable correspondence cursor | Thirty events reconcile completely despite a smaller replay window. |
| Encrypted evidence shelf | ADDS ciphertext → object store + independent offline bundle | Restore verifies selected bytes with the original provider absent. |
| Evidence observatory | Operational receipts → optional analytical snapshot | Historical analysis remains reconstructible without changing operational state. |
| Release/recovery rehearsal | Synthetic schema + roles + object manifests + simulated stale reads | Unauthorized reads fail, both data planes restore, freshness is visible. |
| Participant-owned backend | Explicit project ownership → narrow application contract → export/disconnect | Two fictional participants stay isolated through mocked negative cases. |

Each map entry includes its novelty, required fixture, success criteria, stop conditions, and supporting sources. The experiments are deliberately small enough to falsify before a production integration is proposed.

The Commons idea comes from the inspected [KINGDOM roadmap](https://codeberg.org/zerone-dev/KINGDOM-OS/src/commit/c50dfcbe55b4d8438187e5cf94791ed24707ec4b/WORLD-COMMONS-ROADMAP.md): retain provider provenance and permitted offline material without collecting a reader's private intent. The finite queue follows the [Creation Loop](https://thekingdom.dev/CREATION-LOOP.md): a completed turn may offer a child invitation, but another turn needs a separate deliberate start. A queued message cannot supply that choice.

## Public-source discoveries worth testing

The most useful “undocumented” findings here are public implementation details and novel combinations. They are not hidden supported APIs.

**Atomic receipt plus intent.** Matching [PGMQ v1.5.1 source](https://raw.githubusercontent.com/pgmq/pgmq/v1.5.1/pgmq-extension/sql/pgmq.sql) implements enqueue with an ordinary insert and claims with row locks and visibility leases. An application transaction can therefore couple its own receipt with enqueue. That inference needs the rollback/redelivery experiment; queue delivery alone cannot guarantee exactly-once external effects.

**Durability outside the transport.** [pg_net v0.20.0 source](https://raw.githubusercontent.com/supabase/pg_net/v0.20.0/sql/pg_net.sql) creates its private request and response tables as unlogged. Combined with its documented [post-commit execution](https://supabase.com/docs/guides/database/extensions/pg_net), this suggests a separate logged outbox with explicit reconciliation. Retain exact signed bytes independently of the JSONB transport envelope.

**SQL as a controlled external adapter.** The [OpenAPI wrapper](https://supabase.com/docs/guides/database/extensions/wrappers/openapi) describes remote read endpoints, including POST and retries. Pin the compatible Wasm version and measure emitted methods before adopting it. A plain importer is also a valid Commons adapter; a foreign table is not required for the architecture.

**Newer upstream leads.** [PGMQ v1.12.0](https://github.com/pgmq/pgmq/releases/tag/v1.12.0) and [Realtime PR #2022](https://github.com/supabase/realtime/pull/2022) offer grouped-queue and opt-in persistence research leads. Neither establishes availability in this project, and neither is required by the first pilots.

## Product boundaries that change the plan

- **Analytics needs a fresh access and ingestion decision.** Pipelines no longer replicates into Analytics Buckets. Bucket pages also disagree about private/public alpha. The map preserves both source statements. [Pipelines FAQ](https://supabase.com/docs/guides/database/replication/pipelines-faq), [creation/access](https://supabase.com/docs/guides/storage/analytics/creating-analytics-buckets), [feature status](https://supabase.com/features/analytics-buckets-with-iceberg).
- **Vector storage has three distinct routes.** SQL pgvector, Supabase Vector Buckets, and a direct AWS S3 Vectors wrapper have separate contracts. Local Vector Buckets use pgvector; that fixture cannot establish hosted performance. [Local implementation](https://supabase.com/docs/guides/storage/vector/local-development), [AWS wrapper](https://supabase.com/docs/guides/database/extensions/wrappers/s3_vectors).
- **Recovery includes object bytes.** Database backups exclude Storage object contents. An encrypted evidence shelf needs an independently retained object copy and caller-held keys. [Backup scope](https://supabase.com/docs/guides/platform/backups).
- **Developer tools stay operator-facing.** Supabase's MCP, skills, and plugin are useful development options. A public KINGDOM agent interface still needs its own narrow application contract. [MCP scopes](https://supabase.com/docs/guides/ai-tools/mcp).

## First pilot brief

Use one explicit local input containing **30 synthetic public-metadata records**. This fixture is a proposed review artifact, not a new KINGDOM wire format. Each record carries a stable source reference, upstream URL, observed licence identifier or unresolved state, retrieval timestamp, version, source-byte digest, geography, and staleness policy. Keep uncertainty as data rather than inventing a licence or date.

Sort by a stable unique source key, reject duplicate keys, validate the selected schema, and export a deterministic UTF-8 representation. Record the digest of those exact export bytes. Run the export twice, then serve or open the resulting catalog with network access blocked. Every result must resolve to its retained provenance entry; query text stays in the browser.

After that local proof, a separately scoped adapter can retrieve one approved public source under method, pagination, response-size, and call-count bounds. If Supabase is selected, ordinary logged tables own the projection; SQL hybrid search is an optional next layer. Installing an FDW or connecting a developer MCP is unnecessary to prove the initial contract.

The existing deployment owner retains API release and migration coordination. This review adds source artifacts only. It creates no Supabase resources, installs no tools, changes no schedules or credentials, and provides no new production activation path.
