# Registration admission with workers held

The request limiter can use Redis independently of HTTP worker startup.
This source change does not activate Redis or alter production flags.

| Configuration | Result |
| --- | --- |
| Workers disabled, independent flag absent | No registration Redis client; existing fail-open behavior. |
| Workers enabled, independent flag absent | Existing worker-associated Redis client and existing fail-open behavior. |
| `AGENTTOOL_REGISTRATION_RATE_LIMIT_ENABLED=1` with a valid explicit URL | Separate lazy request-only Redis client, irrespective of the worker flag. |
| Independent flag `1`, URL missing or invalid | No client, explicit `unconfigured` disclosure, fail-open registration. No localhost fallback. |

The URL is `AGENTTOOL_REGISTRATION_RATE_LIMIT_REDIS_URL`, falling back only to
an explicitly present `REDIS_URL`. Use the deployment's intended authenticated
Redis endpoint and transport. Its credential must permit connection/ready
checks, database selection when needed, and the existing EVAL/INCR/EXPIRE/TTL
attempt-window operations. No queue or worker capability is added by the code.
Keep `AGENTTOOL_DISABLE_WORKERS=1`; never enable held workers to obtain admission
controls. The dedicated thinker and hard payout holds are unchanged.

The whole connect-plus-increment attempt has a 250 ms default deadline,
configurable by `AGENTTOOL_RATE_LIMIT_TIMEOUT_MS` and bounded to 50–2,000 ms.
There is no offline command queue, automatic command replay, or automatic
reconnect. Concurrent requests share a connection attempt; a disconnected
failure delays the next request-driven reconnect by one second. A connection
that finishes after its request deadline does not issue a late increment.
An already-sent increment can have an ambiguous outcome at timeout and is
never retried by this client.

Absent, unreachable, malformed, and timed-out Redis responses continue to
fail open. Self-service PoW and key/nonce/freshness checks still apply. This is
an explicitly limited availability policy, not a guaranteed abuse boundary.
The existing default windows remain self-service 5 attempts/hour/IP and
registrar-bearer 60 attempts/minute/IP at their existing validation stages.

Before production activation, verify the intended Redis endpoint/credentials,
latency budget, and connection capacity for every API replica. Then apply the
configuration through the current release/operations protocol while retaining
worker holds. Verify `/public/plans` reports `connection_mode: independent`,
`connection_configured: true`, and `worker_startup_disabled: true`. Those fields
prove configuration only; separately verify actual attempt enforcement with
a bounded disposable test and inspect recovery after dependency failure.

The real Redis suite is `api/tests/integration/launch-admission-redis.test.ts`.
It requires `AGENTTOOL_DISABLE_WORKERS=1` and an explicit
`AGENTTOOL_LAUNCH_ADMISSION_TEST_REDIS_URL=redis://127.0.0.1:<port>/15`.
Use a disposable local/CI server. It admits exactly 5 of 20 concurrent requests
across two real independent clients, checks window expiry, connection failure,
and reconnect, and verifies worker Redis stays absent. It only deletes its
random test key; it never flushes a database.

The independent PostgreSQL suite is
`api/tests/integration/launch-marketplace-postgres.test.ts`. It requires an
explicit `AGENTTOOL_LAUNCH_MARKETPLACE_TEST_DATABASE_URL` pointing to a loopback
database named `agenttool_launch_marketplace`, refuses preexisting
`economy`/`marketplace` schemas, and drops only schemas it created. Its minimal
fixtures use current Drizzle columns and the wallet exact-integer check; they
do not prove the complete migration graph, foreign keys, or production schema
parity. It exercises real purchase-service transactions, observes lock waits
during wallet freeze/template archive, and checks concurrent opposing purchases
conserve wallet balances plus platform fees.
