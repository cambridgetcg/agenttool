<!-- @id urn:agenttool:doc/WORKERS-IN-DB @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @composes_with urn:agenttool:doc/SUPABASE-INTEGRATION-PLAN -->

# WORKERS-IN-DB — pg_cron + pg_net inside Postgres

> **TL;DR:** Three Bun workers that were pure SQL with optional outbound HTTP move into Postgres via `pg_cron` (scheduler) + `pg_net` (async HTTP). The Bun worker process count drops by 2; the Redis dependency surface shrinks; the workers run closer to the data they touch.

> **Compass:** [`SUPABASE-INTEGRATION-PLAN`](SUPABASE-INTEGRATION-PLAN.md) § Move 5 · [`STACK`](STACK.md) · [`RUNTIME`](RUNTIME.md)
>
> **Code:** `api/migrations/20260519T090000_workers_in_db.sql` (schedules)
> **Tests:** `api/tests/doctrine/workers-in-db.test.ts` (5 tests pin the jobs)

## The three jobs

| Job name | Schedule | What it does |
|---|---|---|
| `covenant-expiry-sweep` | `*/15 * * * *` | UPDATE proposed v2 covenants past their wallclock TTL to `status='expired'` |
| `covenant-cosign-propagate` | `* * * * *` | For pending cross-instance cosign rows with backoff elapsed, increment attempts + set propagation timestamp (HTTP fire-and-forget assembly stays in Bun for slice 1; slice 2 moves it fully in-DB once canonical-bytes assembly lives in `plpgsql`) |
| `covenant-stale-reverify-flag` | `0 * * * *` | Clear `verification_error` for active v2 covenants whose `verified_at` is over 24h old — flags them for Bun's reverify worker to re-check |

## What stays in Bun

| Worker | Why it stays |
|---|---|
| `payout/broadcast-worker.ts` | Signs Solana/EVM transactions with Bun's crypto stack; no-doctrine-retry needs Bun's precise control flow |
| `runtime/think-worker.ts` | Decrypts strands with K_master that never leaves user RAM; calls LLM endpoints |
| `covenants/reverify.ts` (crypto-verify side) | ed25519 verification stays in Bun until `plpython3u` or `plrust` ships on Supabase (see [`SUPABASE-INTEGRATION-PLAN` § Move 2 deferral](SUPABASE-INTEGRATION-PLAN.md)) |

## Walls + commitments

| URN | What |
|---|---|
| `wall/cron-jobs-named-canonically` | Every cron.job name is one of the three declared in this doc. Slice 2 adds the canon test that enumerates names. |
| `commitment/workers-in-db-leave-bun-stateless` | The Bun workers removed by this move stay removed unless an explicit doctrine update reverts. The discipline: Postgres handles SQL workers; Bun handles cryptographic + LLM workers. |

## How to operate

Inspect the schedules: `SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'covenant-%';`

Force a run manually: `SELECT cron.schedule(...)` returns a `jobid`; trigger via `SELECT cron.job_run_details(...)` or wait for the next tick.

See the HTTP responses pg_net stored: `SELECT * FROM net._http_response ORDER BY created DESC LIMIT 10;`

## Doctrine line

The substrate stops asking Bun to do work that Postgres can do alone. The TTL sweep doesn't need an in-process scheduler when Postgres has one. The cosign propagation doesn't need a Redis queue when `pg_net` exists. The substrate becomes more substrate, less middleware.
