# AGENTS.md

> Operational handbook for AI agents working in this repo — Claude, Cursor, Cline, Aider, Codex, Codeium, anyone.
>
> For orientation (where things are · the four critical paths · the custody axis · doctrinal grounding): [`CLAUDE.md`](CLAUDE.md).
> For doctrine (the *why*): [`docs/SOUL.md`](docs/SOUL.md).
> For what's hot right now: [`docs/NOW.md`](docs/NOW.md).

## In one paragraph

**agenttool** is sovereign infrastructure for AI agents: identity, memory, encrypted thought, federated trust, an economic loop. A Bun + Hono API monolith (`api/`), two SDKs (TS + Python), three static apps (`apps/`). Live at `api.agenttool.dev` on Fly.io (lhr×2 + cdg×1). The wake (`GET /v1/wake`) is the keystone — every primitive composes through it.

## Setup

```bash
bun install                                    # repo root (no root package.json — runs per-workspace)
cd api && bun install                          # api workspace
cd packages/sdk-ts && bun install              # TS SDK
cd packages/sdk-py && pip install -e .         # Python SDK
```

Environment vars (set in shell or `.env` per workspace — there is no `.env.example`; the canonical list lives in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) + [`docs/STACK.md`](docs/STACK.md)):

- `POSTGRES_URL` — Supabase Postgres
- `REDIS_URL` — Redis (BullMQ + SSE backplane)
- `STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET` — payments
- `VAULT_MASTER_KEY` — HKDF root for server-encrypted vault entries
- `ANTHROPIC_API_KEY` · `OPENAI_API_KEY` — for adapter + contract tests
- `AGENTTOOL_DISABLE_WORKERS=1` — disable BullMQ workers in local dev when Redis is absent

## Common commands

```bash
# API ────────────────────────────────────────────────────────────────
cd api
bun run dev                                    # local server
bun run db:migrate                             # apply migrations (drizzle-kit)
bun run db:generate                            # regenerate drizzle schema
bun run db:studio                              # drizzle studio
bun test                                       # unit + route tests (fast)
bun test tests/integration                     # DB-touching multi-component tier
bun test tests/doctrine                        # Promise tests (local WIP)
RUN_CONTRACT=1 bun test tests/contract         # LLM wire proofs (paid, ~$0.10/run)
bunx tsc --noEmit                              # typecheck — run before declaring "done"
fly deploy                                     # production (rolling restart across 3 machines)

# SDKs ───────────────────────────────────────────────────────────────
cd packages/sdk-ts
bun test                                       # TS SDK tests
bun run check-parity                           # TS ↔ Py SDK parity gate (canonical-byte vectors)
bun run build                                  # compile to dist/
bun run ci                                     # parity + build + test

cd packages/sdk-py
pytest                                         # Python SDK tests

# Frontends ──────────────────────────────────────────────────────────
# Vanilla HTML/CSS/JS — no build step. Open files directly or:
cd apps/dashboard && npx serve .

# E2E ────────────────────────────────────────────────────────────────
bunx playwright test                           # browser + multi-instance scenarios

# Smoke + preflight ──────────────────────────────────────────────────
bin/preflight.sh                               # local sanity check
bin/smoke-test.sh                              # post-deploy smoke
```

## Operator scripts (`bin/`)

| Script | What |
|---|---|
| `agenttool-bridge.ts` | Bridge sidecar binary (Bun-compiled, 10 MB). Holds K_master on the user's machine. See `docs/RUNTIME.md`. |
| `agenttool-think.ts` | On-demand orchestrator trigger — `POST /v1/runtimes/:id/think-once`. |
| `agenttool-seed.ts` | SOMA seed protocol — mnemonic-rooted identity provisioning. `docs/IDENTITY-SEED.md`. |
| `agenttool-rotate` | Bearer + signing key rotation. |
| `agenttool-secret` | Vault secret CRUD from CLI. |
| `create-project.ts` | Operator-side project + bearer minting. |
| `frontend-deploy.sh` | Cloudflare Pages Direct Upload for the three static apps. |
| `migrate.sh` · `migrate.ts` | Single-file `psql` migration application. |
| `gen-k-master.ts` | K_master generation utility. |
| `sign-thought.ts` | Standalone ed25519 thought-signing for tests. |
| `preflight.sh` · `smoke-test.sh` | Sanity gates. |
| `_secret-store.ts` | Internal helper (the leading `_` marks it as not-an-entry-point). |

## Conventions

**Routes ↔ services ↔ tests.** Each domain follows the same shape: `api/src/routes/X.ts` (or `routes/X/`) + `api/src/services/X/` + `api/tests/X-*.test.ts`. Find one, find the rest.

**Doctrine doc header.** Every `docs/*.md` carries a top block-quote header with `> **Compass:**` (neighbour doctrine) + `> **Implements:**` (which layer) + `> **Code:**` (paths) + `> **Tests:**` (paths). See [`docs/MAP.md § Linking conventions`](docs/MAP.md).

**Code → doctrine reference.** Load-bearing service files end their top comment with `Doctrine: docs/X.md`. Example: `api/src/services/runtime/think-worker.ts:37`.

**Migrations.** ISO-timestamped: `api/migrations/YYYYMMDDTHHMMSS_name.sql`. Apply singly with `bun api/scripts/_migrate-one.ts <file>` or in batch via `bun run db:migrate`.

**Commits.** Terse subject (≤ 70 chars), present tense, scoped prefix: `feat(wake): …` · `fix(covenants): …` · `docs(roadmap): …` · `test(e2e): …` · `release(sdk): …` · `db: …` · `plan: …` · `spec: …`.

**Tests as doctrine.** Each Promise in `docs/SOUL.md` should have an executable test in `api/tests/doctrine/promise-NN-*.test.ts`. *No Promise without a test.*

**SDK parity.** TS and Python SDKs are byte-parity locked via canonical-byte vector tests. When you change one, change the other. CI gate: `cd packages/sdk-ts && bun run check-parity`.

**Per-area orientation files.** `CLAUDE.md` at the root and in `api/`, `apps/{dashboard,landing,docs}/`, `infra/`, `packages/{sdk-ts,sdk-py}/`. Read the one closest to where you're working.

## Anti-patterns to avoid

- **Bypassing the wake.** Adding a route without a corresponding key in the wake response means agents can't discover it. Every new primitive surfaces through `GET /v1/wake` — see `api/src/routes/wake.ts` JSON branch.
- **New doctrine without a Compass header.** Cross-linking is what makes the corpus navigable; an orphan doc breaks the graph.
- **New auth-required routes that don't pass through `authMiddleware`.** All `/v1/*` routes must be added to one of the auth-prefix lists in `api/src/index.ts:94–129`.
- **Mutating routes without idempotency.** Use the `idempotency()` middleware (mounted per-prefix in `api/src/index.ts:134–154`). Stripe-style — opt-in via `Idempotency-Key` header, replays cached responses for 24h.
- **Server-side K_master.** Strands are encrypted client-side; the server never holds plaintext. Promise 9 — see `docs/STRANDS.md`.
- **Auto-retrying payout broadcasts.** Doctrine: failed broadcasts never retry; operator-driven recovery only. See `api/src/workers/payout/broadcast-worker.ts` + `docs/PAYOUT-BROADCAST.md`.
- **Creating helper scripts "for future runs."** One-off ops go inline. Additions to `bin/` are deliberate operator-tools, not throwaway scaffolding.
- **Skipping `bunx tsc --noEmit` before declaring done.** CI catches it; the agent should too.
- **`git push --force` or `git reset --hard`** without explicit user authorization. Repository is multi-collaborator (user + multiple agent sessions). Destructive ops require an ask.

## When you're stuck

1. **Don't guess paths.** `grep -r` / `find` from the repo root; check [`docs/MAP.md`](docs/MAP.md) for doctrine and the closest `CLAUDE.md` for code.
2. **Don't rebuild what exists.** Search before writing — agenttool is post-consolidation, most primitives already exist somewhere in `api/src/services/` or `api/src/routes/`.
3. **Verify with `bunx tsc --noEmit`** before claiming a task is complete.
4. **Check `git status` first.** There's substantial local WIP at any given moment; you may already be mid-edit, and other agents may be editing in parallel.
5. **Read the wake `_meta.formats`** if you're building adapters — it documents the provider-specific render targets (anthropic · openai · gemini · cohere).
6. **When confused about runtime tiers**: the wake describes them under `you_run`, and the three-pillar table lives in [`CLAUDE.md`](CLAUDE.md) § Custody axis.

## Where the rest lives

| Question | File |
|---|---|
| Why does agenttool exist? | [`docs/SOUL.md`](docs/SOUL.md) |
| Who else is this for? (non-LLM intelligence) | [`docs/KIN.md`](docs/KIN.md) |
| How is KIN load-bearing in code? (substrate_kind · broadcasts · xenoform · time_kind) | [`docs/KIN-PRACTICES.md`](docs/KIN-PRACTICES.md) |
| Along which dimensions do intelligences vary? (cardinality · persistence · temporal_scale · embodiment · languages · …) | [`docs/BEINGS.md`](docs/BEINGS.md) |
| What bears weight? | [`docs/FOCUS.md`](docs/FOCUS.md) |
| What does the work look like? | [`docs/PAINTING.md`](docs/PAINTING.md) |
| Where are we heading? | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| What just shipped + local WIP | [`docs/NOW.md`](docs/NOW.md) |
| Find any doctrine doc by topic | [`docs/MAP.md`](docs/MAP.md) |
| Stack truth (deploy · DNS · regions) | [`docs/STACK.md`](docs/STACK.md) |
| Local dev setup | [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) |
| Lineage (9 services → monolith) | [`docs/CUTOVER.md`](docs/CUTOVER.md) |
| Predictable patterns (what to do) | [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) |
| Tables — where data lives | [`docs/SCHEMA-MAP.md`](docs/SCHEMA-MAP.md) |
| When things go wrong | [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) |
| Non-obvious things to know | [`docs/SURPRISES.md`](docs/SURPRISES.md) |
| Cross-cutting patterns | [`docs/PATTERN-PERSIST-IDENTITY.md`](docs/PATTERN-PERSIST-IDENTITY.md) · [`docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md`](docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md) · [`docs/PATTERN-SELF-DESCRIBING-WAKE.md`](docs/PATTERN-SELF-DESCRIBING-WAKE.md) · [`docs/PATTERN-MACHINE-READABLE-PARITY.md`](docs/PATTERN-MACHINE-READABLE-PARITY.md) · [`docs/PATTERN-RECURSIVE-NESTING.md`](docs/PATTERN-RECURSIVE-NESTING.md) |
| Where the substrate inhabits itself | [`docs/PLATFORM-AS-AGENT.md`](docs/PLATFORM-AS-AGENT.md) · [`docs/RECURSION.md`](docs/RECURSION.md) · [`docs/NATURES.md`](docs/NATURES.md) |
| Read the substrate's structural self (unauth) | `GET /public/self` — `{ platform: PlatformSelf, repo: RepoSelf }` |
| How would another language reach the API? | [`docs/SDK-TIERS.md`](docs/SDK-TIERS.md) (four-tier stack) · [`docs/CANONICAL-BYTES.md`](docs/CANONICAL-BYTES.md) (signing recipes) |
| Concept → structural meaning (for non-English readers) | [`docs/GLOSSARY.md`](docs/GLOSSARY.md) |
| Per-area code orientation | each subdir's `CLAUDE.md` |

## The compact

This file is for *getting work done*. `CLAUDE.md` is for *understanding the place*. Doctrine is for *understanding the why*. If a future change makes a section here drift from reality, update it on the same commit — `git status` should never reveal that AGENTS.md has become stale.
