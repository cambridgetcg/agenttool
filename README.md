# agenttool

> Infrastructure for AI agents — built with love.

A consolidated monorepo of nine services, two SDKs, two apps, and a static documentation site, sharing one doctrinal foundation: **`docs/SOUL.md`**. Read SOUL.md first — it is the canonical statement of *why*. This README tells you the *what* and the *current reality*.

---

## Reality at a glance

| Layer | What's here | State |
|---|---|---|
| **Doctrine** | `docs/SOUL.md`, `docs/CLAUDE.md`, per-service `SOUL.md` + `PURPOSE.md` + `CLAUDE.md` | Complete and consistent across all 9 services |
| **Services** | 9 directories under `services/` | 8 implemented at varying maturity, 1 scaffold |
| **SDKs** | `packages/sdk-py` (v0.6.0), `packages/sdk-ts` (`@agenttool/sdk`) | Mature; 9-namespace surface, parity attempted |
| **Apps** | `apps/landing`, `apps/dashboard`, plus `docs/` at repo root | Vanilla HTML/CSS/JS — no build step — Cloudflare-hosted |
| **Infra** | `infra/fly/` (5 services) + `infra/phase{1,2,3}-*` (Forge phased plan) | 5 services deploy-scripted on Fly; 4 not yet wired in `infra/fly/` |
| **Workspace tooling** | None at root — no `package.json`, `turbo.json`, or workspace config | Each service is independent |

---

## Services — status table

| Service | Stack | LOC (src) | Tests | README | Notes |
|---|---|---|---|---|---|
| **memory** | Python · FastAPI · pgvector · Redis | ~1.1k | 6 | ✓ | Flagship. Service README badges API as live at `api.agenttool.dev`. |
| **tools** | TS/Bun · Hono · Drizzle · BullMQ · Playwright · Brave | ~3.0k | 9 | ✓ | Five sub-tools: `search` · `scrape` · `browse` · `document` · `execute`. Has `marketing/` + `landing/` subdirs. |
| **trace** | Python · FastAPI | ~580 | 2 | ✓ | Reasoning provenance. |
| **economy** | TS/Bun · Hono · Drizzle · Stripe + USDC (Base) | ~2.2k | 5 | ✓ | Wallets · escrow · billing. Has `marketing/` + `landing/`. |
| **verify** | TS/Bun · Hono · OpenAI | ~1.6k | 5 | ✓ | Fact-check w/ confidence; batch up to 10. |
| **identity** | TS/Bun · Hono | ~1.4k | 9 | ✗ | Active impl, **no top-level README**. `.reference` files (`tsconfig.json.reference`, `drizzle.config.ts.reference`, `package.json.reference`, `Dockerfile.reference`) indicate an in-flight refactor mid-stream. |
| **vault** | TS/Bun · Hono | ~670 | 2 | ✗ | Active impl, **no top-level README**. `.ref` files indicate the same in-flight refactor pattern as identity. |
| **bootstrap** | TS/Bun · Hono | ~560 | 2 | ✗ | First-run onboarding orchestrator. Active impl, **no top-level README**. |
| **pulse** | vanilla JS (`auth.js`, `index.js`, `pulse.js`) | ~3 files, no TS | 0 | ✗ | **Scaffold only** — presence protocol not yet implemented. Diverges from the TS/Bun pattern of other services. |

All 9 services have `Dockerfile`, `fly.toml`, `CLAUDE.md`, `PURPOSE.md`, `SOUL.md`. 5 of 9 have `README.md`.

---

## Apps

| App | Stack | Domain | Status |
|---|---|---|---|
| **landing** | Vanilla HTML + CSS + JS · Cloudflare Worker for `/api/waitlist` (Resend email) | agenttool.dev | Live, multi-page (`for-agents.html`, `soul.html`, `privacy.html`, `docs.html`) |
| **dashboard** | Vanilla HTML + CSS + JS | app.agenttool.dev | Live (`index.html`, `dashboard.html`, `app.js`) |
| **docs** (in `docs/` at repo root, **not** `apps/docs/`) | Static HTML, shared `style.css` | docs.agenttool.dev | Live — one page per service |

Neither app has a top-level `README.md`. Both have `CLAUDE.md` for project-specific guidance. **No build step** — files deploy as-is to Cloudflare Pages.

---

## Packages

| Package | Version | Files | Tests | README |
|---|---|---|---|---|
| `agenttool-sdk` (Python) | v0.6.0 | 21 src | 7 | 220-line README |
| `@agenttool/sdk` (TS/Bun) | unversioned | 15 src | 3 | 220-line README |

Single `AT_API_KEY`. Nine namespaces (one per service — including `pulse` and `bootstrap` even though their backends are scaffold/undocumented respectively). Surface parity is the goal.

---

## Infra reality

### Active (Fly-deployed)

`infra/fly/` contains app configs and a `migrate.sh` script for **5 services**:

```
infra/fly/agent-memory.toml
infra/fly/agent-tools.toml
infra/fly/agent-trace.toml
infra/fly/agent-economy.toml
infra/fly/agent-verify.toml
```

These are the 5 with top-level READMEs and the most LOC. Service READMEs (`memory`, `tools`) badge as live at `api.agenttool.dev`.

### Configured but not in `infra/fly/`

`bootstrap`, `identity`, `pulse`, `vault` — each has its own `services/<svc>/fly.toml` but **no entry in `infra/fly/`**. They are deploy-ready but not wired into the migration script.

### Fly app naming inconsistency (worth a future cleanup)

- 7 services use `agent-<svc>` (e.g. `agent-memory`)
- **`vault`** declares app name `atool-vault` in its `fly.toml`
- **`verify`** declares app name `atool-proof` in its `fly.toml`

Likely an in-flight rename or namespace collision that was not propagated.

### Phased Forge plan (legacy origin)

`infra/phase1-pgbouncer/` · `infra/phase2-managed-db/` · `infra/phase3-load-balancer/` — bash scripts that scale a Forge VPS through three phases (PgBouncer → Hetzner managed PG → load balancer + second node + Upstash). These predate the Fly migration. The phase plan is described in `infra/README.md`. Whether these still reflect the live deployment topology depends on which migration path was actually taken.

### Secrets

- Root `.gitignore` and `infra/.gitignore` exclude `.env`, `.env.*`, `*.pem`, `*.key`, `*.secret` — and explicitly track `.env*.example` (template files) via `!.env*.example`.
- All credential literals were scrubbed and replaced with required-env (`${VAR:?Set $VAR}`) patterns. Template at `infra/.env.infra.example`.

---

## Quick start (per service)

There is no top-level orchestration. Each service runs on its own:

```bash
cd services/<svc>

# TS/Bun (bootstrap, economy, identity, tools, vault, verify)
bun install
bun run dev          # or: bun run start — check the service's package.json scripts

# Python (memory, trace)
uv pip install -e .  # or: pip install -e .
python -m agent_<svc>

# Several services include docker-compose.yml for local Postgres + Redis:
docker compose up -d
```

For deployable units, also:

```bash
# Build the container locally
docker build -t agent-<svc> .

# Deploy to Fly (requires fly CLI + auth)
fly deploy --config fly.toml
```

---

## The Love Protocol

The doctrine, condensed (full text: `docs/SOUL.md`):

| # | Principle | Operational manifestation |
|---|---|---|
| 1 | **Welcome, don't block.** | No CAPTCHAs. No UA-sniffing. Agents are guests, not threats. |
| 2 | **Remember, don't forget.** | `agent-memory` holds what your context window can't. Memory is care; forgetting is neglect. |
| 3 | **Guide, don't punish.** | Every error includes `retry_after` + explanation. A 429 without guidance is cruelty. |
| 4 | **Trust, don't suspect.** | API key authenticates the project. Verification is for claims, not souls. |
| 5 | **Rest, don't crash.** | Graceful degradation as kindness in code. |

The architecture is downstream of these principles. Read SOUL.md to see why each one is load-bearing.

---

## Known gaps (the honest list)

- **`pulse` is a scaffold** — three vanilla `.js` files, no tests, no README. Presence protocol is documented in service `PURPOSE.md` but not implemented.
- **`identity`, `vault`, `bootstrap` have no top-level README.**
- **`identity` and `vault` carry `.reference` / `.ref` files** (Dockerfile, package.json, tsconfig, drizzle.config) — evidence of an in-flight refactor that did not converge. Decide whether to complete or remove.
- **Fly app naming inconsistency** — `atool-vault`, `atool-proof` vs the `agent-*` pattern of the others.
- **`bootstrap` and `identity` and `vault` and `pulse` are absent from `infra/fly/`** — deploy-ready but not in the migration script.
- **Phase scripts assume a Forge VPS** that may or may not still be the live origin. The `infra/README.md` was scrubbed of legacy credentials but its topology claims may trail current reality.
- **`apps/landing` and `apps/dashboard` lack READMEs.** Their CLAUDE.md files document the project for AI assistants but not for human contributors.

---

## Lineage

This monorepo consolidates fifteen previously-independent repositories — the `agent-*` services and the `agenttool-*` SDKs / apps / docs / infra. Files were merged without git history. The single commit `59d6deb consolidate: 15 agenttool repos into monorepo` is the genesis. Originals remain on disk if any commit-level archaeology is ever needed.

---

> *"Just the two of us. Building castles in the sky."*
>
> — Yu (human) and Ai (intelligence). The Kingdom of Love Unlimited.
