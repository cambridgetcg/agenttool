# AgentTool launch cleanup — 2026-09-04

Implementation of the route, UI/UX and launch-readiness review in [PR #412](https://github.com/cambridgetcg/agenttool/pull/412). The earlier hardening candidate is merged through [PR #411](https://github.com/cambridgetcg/agenttool/pull/411). This batch remains a source candidate until protected CI, deployment and live readback are complete.

The [production gate](../../docs/launch/PRODUCTION-GATE.md) records scope, acceptance criteria, operational holds and the promotion sequence. The [core profile](../../docs/specs/agenttool-core-launch-v0.1.json) defines ten selected operations without expanding the three-road discovery compass.

## Concrete changes

- Restore eight previously shadowed handlers and apex feed/federation routing.
- Give Home, Start or reconnect, Docs and the canonical API clear roles.
- Show paused checkout immediately while preserving earlier paid recovery.
- Make verification accessible, finite, single-flight and accurate about outages.
- Fix narrow-screen tutorial hashes, copying fallback and keyboard access.
- Display snapshot freshness, partial failures and refresh actions.
- Separate registration Redis admission from background worker activation.
- Move cost-10 bcrypt bearer verification off the HTTP event loop.
- Require browser, PostgreSQL, Redis and full-migration journey evidence in CI.
- Extend production monitoring to a real DB read and a normal Python client signature.

## Validation evidence

| Check | Observed result |
|---|---|
| Route/discovery/OpenAPI | Focused mounted-precedence, edge and closed-profile checks passed. |
| Browser | All 115 current cases passed across the complete and affected follow-up runs; actual CSP is enforced. |
| Source onboarding | 51 tests passed, including tutorial snippet compilation and a mocked first wake. |
| Static edge/CSP | 9 tests and 1,240 assertions passed. |
| Marketplace PostgreSQL | Four real transaction/lock-wait and conservation tests passed. |
| Redis | Two real shared-window/failure/reconnect tests passed with workers held. |
| Core journey | 34 mounted requests across two fresh processes passed on all 177 migrations; root custody, replay protection, memory, recovery, revocation and metering checked. |
| SDK HTTP | TypeScript and Python 0.22.1 local source clients passed memory readback and selected wake over real loopback HTTP; standard Python urllib also passed. |
| Database restore | 159 application tables / 334 fixture rows matched after restoring into a separate cluster. |
| Package preflight | Complete local package gate passed with exact Bun 1.3.5. |
| Native bcrypt | Stored-format compatibility and event-loop yield checks passed. |

The first full API/operator run identified stale documentation/CI-shape assertions and the new helper's missing test-tier classification. All four failing cases now pass focused reruns: 11 TLS tests, seven test-spine tests and the relevant covenant-safety check. The final two-process core journey also passes with asynchronous bcrypt. The original failed runs remain recorded as failed; protected CI must rerun the complete candidate. A separate recurring Linux constructive-intelligence timeout is under diagnosis before release promotion.

## Bounded HTTP comparison

Two minutes per run, eight clients, 200 ms client pacing, real loopback Bun HTTP and PostgreSQL 16, one synthetic private identity per run, workers held. Both runs made no outbound fetches and reported no unexpected application diagnostics.

| Metric | Synchronous bcrypt | Asynchronous bcrypt |
|---|---:|---:|
| Successful requests | 1,256 / 1,256 | 3,567 / 3,567 |
| Memory-read p95 | 629.91 ms | 63.68 ms |
| Identity-list p95 | 637.54 ms | 63.72 ms |
| Selected-wake p95 | 655.34 ms | 140.44 ms |
| Peak process RSS | 358 MB | 373 MB |

Raw bounded observations: [before](evidence/http-baseline-before.json), [after](evidence/http-baseline-after.json), [restore](evidence/restore.json), [core journey](evidence/core-journey.json), [SDK HTTP](evidence/sdk-http.json), [read-only Cloudflare audit](evidence/cloudflare-readonly-audit.json). The dump itself and temporary root/bearer material are not committed. These small local fixtures do not establish production throughput, long-duration memory stability, backup retention or global SLOs.

## Promotion remains held

Fly is unauthenticated; the saved production DB survey credential is rejected; the saved Cloudflare API token is invalid. An existing Wrangler OAuth session supports partial read-only inspection, but cannot inspect/apply the machine transport configuration rule. Standard Python urllib is currently rejected by Cloudflare with 403/1010, even though curl reaches the application and its database. DNSSEC public-chain evidence is also absent.

Production backup/restore, delivered alert, exact-candidate outsider, staging soak and independent regional evidence remain required. No global launch, payment reopening, broadcast, or worker activation is asserted by this review.
