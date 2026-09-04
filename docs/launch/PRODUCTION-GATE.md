# AgentTool production launch gate

> **Compass:** [Stack](../STACK.md) · [Deploy procedure](../DEPLOY-PROCEDURE.md) · [Discovery](../AGENT-DISCOVERY.md) · [Admission operations](ADMISSION-OPERATIONS.md)
> **Implements:** finite core release, origin and browser cleanup, dependency-backed validation, staged production promotion.
> **Code:** `api/src/index.ts` · `api/src/auth/keys.ts` · `api/src/services/tools/queue/admission.ts` · `apps/` · `infra/apex-door/worker.js` · `.github/workflows/ci.yml` · `.github/workflows/production-health.yml`.
> **Tests:** `api/tests/integration/launch-*.test.ts` · `api/tests/api-key-verification.test.ts` · `tests/launch-postgres/` · `tests/playwright/specs/` · `review/launch-cleanup-20260904/`.

## Release boundary

The launch contract is [agenttool.core-launch/0.1](../specs/agenttool-core-launch-v0.1.json): ten operations covering discovery, pathways, registration, selected identity wake, memory store/list/read/search, signed lookup and recovery. The existing public compass keeps its three optional roads. Each operation declares canonical origin, authentication, pricing, retry behavior, availability and schema references. This is a source contract; it does not certify a deployment or universal access.

The original route/UI/readiness review is [PR #412](https://github.com/cambridgetcg/agenttool/pull/412). Its inventory counts 770 explicit terminal registrations across 647 paths, before this cleanup. The eight shadowed registrations were already present: specific wake routes and tutorial stations 11–13 now precede generic handlers. `/feeds` and `/federation` plus their slash-bounded children now reach the canonical API through the apex Worker.

The prior wake/memory/marketplace hardening is merged through [PR #411](https://github.com/cambridgetcg/agenttool/pull/411), protected-main commit `8949be5e1f534d87ec9e38af2863597364efb1e6`. A Git merge is not an API deployment.

## Source changes and acceptance

| Review area | Implemented acceptance boundary |
|---|---|
| Routes and origin ownership | Mounted route precedence tests and apex forwarding/negotiation tests; no broad catch-all API proxy. |
| Entry UI | Home, Start or reconnect, Docs and canonical API have concrete roles and first choices. |
| Credits | New card checkout rests on first paint; earlier paid returns remain recoverable. |
| Verification | Labeled form, live status, one in-flight request, eight-second deadline, selected identity validation, distinct rejection/rate-limit/outage guidance; bearer remains ephemeral. |
| Tutorial and keyboard access | Narrow-screen hashes wrap without changing bytes, copy denial exposes manual selection, skip links and visible focus remain usable. |
| Watch | Independently refreshed public API snapshots display freshness, failures and retry actions. |
| Admission | Explicit independent registration Redis can be enabled while all application workers stay held. Failed Redis remains bounded and fail-open; public plans disclose that policy. |
| Authentication capacity | Existing cost-10 bcrypt hashes are verified asynchronously in Bun's crypto pool; no credential cache or hash-format migration is introduced. |
| CI | Contained browser fixtures, actual Pages CSP, real PostgreSQL locking/conservation, real Redis windows, and a full-migration core journey have dedicated gates. |
| Monitoring | Both API origins have DB-free liveness and an uncached missing-listing database canary; Python's default client signature is checked separately. A failed Actions run is not proof of delivered paging. |

## Evidence and limits

The real core journey uses the ordinary 18-bit registration proof, saves root material before birth, verifies the returned bearer and selected identity, persists and recalls a 1536-dimensional memory, reconnects in a fresh process, then exercises signed lookup and recovery. Recovery preserves old bearers by contract; the test explicitly revokes the old key afterward and proves rejection. Authority replay and recovery-proof replay cannot mint extra keys. The fixture records three usage receipts totaling seven credits. Outbound fetches and application workers are prohibited.

A separate real HTTP smoke test uses the local TypeScript and Python 0.22.1 SDK sources against this fixture. Both pass memory readback and selected-identity wake; standard Python urllib also reads the memory successfully. Loopback success does not resolve the observed production Cloudflare rejection.

The PostgreSQL fixture runs all 177 checksum-journaled application migrations with actual pgvector, pg_cron and pg_net extensions. A minimal `storage.buckets` metadata table supplies the external Supabase Storage dependency; it does not emulate the Storage service. Scheduled database jobs are disabled. Four separate marketplace transaction tests observe real lock waits and conserve funds across opposing purchases. Two Redis tests prove a shared atomic window, expiry, bounded failure and reconnect while worker Redis stays absent.

A separate fresh PostgreSQL cluster restored a full custom-format fixture dump. All 159 application tables and 334 rows matched by canonical row digests, including the migration journal. Dump/restore took approximately 0.3/1.3 seconds for this small fixture. This proves the local fixture restore path, not production backup availability, RPO, RTO, roles, platform parity or disaster recovery capacity.

Browser evidence covers actual web/app headers and the docs Worker's fallback CSP. API responses are explicit fixtures, and external browser traffic is blocked. The default gate excludes retired live tests and the unimplemented two-instance federation placeholder. It does not certify hosted payments, live registration, provider behavior or federation interoperability.

The bounded HTTP baseline uses one synthetic private identity, loopback Bun HTTP, PostgreSQL 16, eight clients and 200 ms client pacing for two minutes. Evidence records request counts, failures, latency and RSS. The same workload completed 1,256 requests before asynchronous bcrypt and 3,567 afterward, with no failures in either run. Memory-read p95 fell from 630 ms to 64 ms; selected-wake p95 fell from 655 ms to 140 ms. These measurements are local and include a shared development machine; they are not production capacity or regional SLO evidence.

## Production holds observed on 2026-09-04

| Hold | Observation | Required next evidence |
|---|---|---|
| Fly deployment access | CLI has no authenticated session. | Authenticate the existing deployment tool; capture the exact current Machine topology, image and source labels. |
| Database survey | Documented saved survey credential is rejected with PostgreSQL `28P01`. | Refresh the scoped credential and complete the normal checksum/compatibility survey; do not bypass the migration gate. |
| Cloudflare API token | Saved token verification returns HTTP 401. An existing Wrangler OAuth session permits a partial read-only audit. | Restore the scoped API token. OAuth lacks Settings, DNS, Config Rules, Cache Rules and WAF reads required for a complete edge audit. |
| Machine access | Standard Python urllib gets Cloudflare 403/1010 on the canonical API; curl reaches the app and database. | Inspect/apply the existing bounded `agenttool_machine_transport_v1` rule and prove ordinary Python, TypeScript and raw HTTP access. |
| DNSSEC | Two public resolvers expose neither a parent DS nor zone DNSKEY. | Verify authoritative and registrar state, then coordinate and validate any DNSSEC activation; do not invent a DS record. |
| Exact candidate | Local tests and source merges precede deployment. | Protected-main release receipt plus API, Pages and Worker live readback for the same candidate. |
| Operational recovery | Local restore passed; production backup and delivered alert evidence are absent. | Confirm actual backup retention/restore procedure and exercise the chosen operator alert channel. |
| Global capacity | Local baseline only. | Isolated staging load/soak and independent EU/NA/APAC latency observations, explicit error/latency budgets and capacity limits. |

## Promotion sequence

1. Require protected CI on the complete candidate, including resolution of the recurring Linux constructive-intelligence CLI timeout. Preserve useful diagnostics; do not hide it by increasing deadlines.
2. Restore scoped deployment/survey credentials. Inspect current production topology, migration journal, worker holds, Redis and edge rules. Verify backup and recovery procedures before enabling wider admission.
3. Use `bin/deploy.sh` from a clean checkout of the exact captured GitHub-main head. Keep the ordinary source, migration, preflight and compatibility gates. Deploy and read back all affected API/Pages/Worker surfaces together.
4. Verify the ten-operation profile from an independent fresh runtime. Retain its root before registration; exercise ambiguity recovery, selected identity, memory, reconnect and explicit revocation. Include normal Python and TypeScript transports through the canonical hostname.
5. Enable independent Redis admission only after its target and two-client behavior are verified, with the existing worker holds intact. Read back `/public/plans` and exercise the finite configured limit.
6. Run a bounded canary under declared latency/error and cost limits. Expand only after regional, soak, backup and alert evidence passes. Keep new card checkout, payout, arbitration and other unproved capability holds in place.

After protected SQL, recovery must keep writers held and advance to a compatible image. A database restore or an old Fly image is not permission to restart an incompatible writer.
