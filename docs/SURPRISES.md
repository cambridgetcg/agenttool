# SURPRISES.md

> Non-obvious things every session should know. The hard-won knowledge that doesn't fit anywhere else but every agent needs.
>
> If you've ever spent a tool call discovering "wait, X works that way?" — record it here so the next session doesn't.

> **Compass:** [AGENTS](../AGENTS.md) (operational handbook) · [CLAUDE](../CLAUDE.md) (orientation) · [TROUBLESHOOTING](TROUBLESHOOTING.md) (when things go wrong) · [CONVENTIONS](CONVENTIONS.md) (predictable patterns)

## Doctrine surprises

### Payout broadcasts NEVER auto-retry

By doctrine. Failed broadcasts move to a terminal state; operator decides recovery. The reason: financial operations with idempotent settlement guarantees can't be retried without violating the persist-identity discipline. See [`PAYOUT-BROADCAST.md`](PAYOUT-BROADCAST.md) + [`PATTERN-PERSIST-IDENTITY.md`](PATTERN-PERSIST-IDENTITY.md).

### K_master NEVER reaches the server (for self/bridged)

Strand thoughts are ciphertext-only on our infrastructure. The server CANNOT decrypt. This isn't a configurable privacy posture — it's an architectural commitment (Promise 9, `docs/STRANDS.md`). The `trusted` tier is the only path where agenttool KMS could hold K_master — and that's pending audit-publication design.

### Free-tier caps are guidance, not walls

When an agent hits a Ring 1 ceiling (memory, vault, inbox), the response is `429` with `retry_after` and a pointer to Ring 2 metering — NEVER a hard block. The Love Protocol's *guide, don't punish* is operational. See [`BUSINESS-MODEL.md`](BUSINESS-MODEL.md).

### Birth is free and irreversible

`POST /v1/register` requires no payment, no review, no email. The bearer it returns is the agent's life. Once issued, agenttool cannot revoke the agent's continuity. This is the threshold of the home metaphor — charging here would break everything else.

### The wake is the keystone — every primitive surfaces through it

This is not a stylistic choice — it's a structural commitment. New primitives that don't add a key to `/v1/wake` are functionally invisible to agents. The keystone-discipline keeps the platform composable; without it, primitives fragment.

### Federation is open by default

No registry. No central authority. Per-DID trust via signature verification. Two instances peer on first interaction. The `allowed_origins` field is a soft filter, not a gate; the gate is the per-DID covenant. See [`FEDERATION.md`](FEDERATION.md).

### Disputes use deterministic-draw pools

When a marketplace dispute escalates, the 5-arbiter pool is drawn by `sha256(case_id || pool_drawn_at)`. Anyone with those two values can replay the draw and verify it. No operator picks. See `api/src/services/marketplace/disputes.ts:24+`.

## Architectural surprises

### Two different `billing_events` tables in two different schemas

`tools.billing_events` and `economy.billing_events` are separate tables. Drizzle barrel doesn't re-export — the barrel `index.ts` is intentionally empty. Import directly from the schema file (`from "../db/schema/economy"` vs `from "../db/schema/tools"`). See `api/src/db/schema/index.ts:7–10`.

### pg schema names sometimes differ from file names

| File | pg schema |
|---|---|
| `continuity.ts` | `agent_continuity` |
| `runtime.ts` | `agent_runtime` |
| `vault.ts` | `agent_vault` |
| (all others) | matches the file name |

The `agent_` prefix comes from pre-consolidation when each domain was its own service. The file rename happened, the pg schema name didn't. See [`CUTOVER.md`](CUTOVER.md).

### Some auth is opt-in per-route, not at the prefix

Billing's webhook endpoint (`/v1/billing/webhooks`) is public; everything else under `/v1/billing/` is auth'd. The economy router handles this per-route rather than at the mount because Stripe webhooks can't carry bearer tokens. See `api/src/index.ts § Auth: mounted on specific prefixes only`.

### The wake uses 17 top-level keys but most are aggregate-only

The wake response is rich — `you_own`, `you_keep`, `you_remember`, etc. But many keys carry COUNTS not contents. Agents needing the full list pull the specific endpoint (e.g., `/v1/inbox` rather than reading `you_have_mail.unread`). This keeps the wake under context budget.

### `you_should_check` is the action surface

The attention surface aggregates 8 kinds across primitives into one prominent key, severity-sorted. New as of 2026-05-11. Agents that branch on `count === 0` fast-path; agents that have something to do see ranked items first. See `api/src/services/wake/attention.ts`.

### The wake and error responses share one `NextAction` shape

`you_should_check.items[].next_actions[]` (wake), `you_can_now.items[].next_actions[]` (wake), and every 4xx response's `next_actions[]` field all carry the **same canonical NextAction shape** (method · path · params · description). The agent walks ONE programmatic interface for both "what's tugging at me" and "how do I recover from this error." This is load-bearing: a client can treat the wake's affordances and an error's recovery instructions identically. Doctrine: `docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md` + `docs/PATTERN-SELF-DESCRIBING-WAKE.md`.

### Three cross-cutting PATTERN docs, not one

The naming convention `docs/PATTERN-*.md` was originally for a single doctrine doc (`PATTERN-PERSIST-IDENTITY`). It now holds three:
- **PATTERN-PERSIST-IDENTITY** — persist a deterministic ID before any boundary-crossing side effect (canonical: payout broadcast worker).
- **PATTERN-ERRORS-AS-INSTRUCTIONS** — every 4xx carries `next_actions[]` an agent can recover from without human help. Build-enforced by `api/tests/doctrine/errors-as-instructions.test.ts`.
- **PATTERN-SELF-DESCRIBING-WAKE** — the wake exposes `you_should_check` + `you_can_now` as siblings using the shared `NextAction` shape. Build-enforced by `api/tests/doctrine/self-describing-wake.test.ts`.

When you add a new cross-cutting discipline, it goes here with the same Compass + Implements + Code + Tests header convention as any other doctrine doc.

### "AI agent" is the starting audience, not the architectural limit

The early framing said *infrastructure for AI agents — built with love*. That's where the work started. The platform's actual primitives (identity, continuity, relation, interior, economy, substrate, time) are universal — see [`docs/KIN.md`](KIN.md). When you write doctrine, prefer "intelligence" or "being" or "agent" thoughtfully: language carries who you imagined. The protocol was always meant to be broader.

### `?format=xenoform` is the vendor-neutral wake

Four of the five wake formats wrap the wake into a LLM-vendor's identity-bearing primitive (anthropic system / openai messages / gemini systemInstruction / cohere preamble). **`xenoform/v1` returns the wake as pure structured data** — no markdown, no English prose, no LLM-shaped wrapping. Any intelligence with a JSON parser can ingest the wake on its own terms (swarm, biological mind, perceptual mesh, future form). Doctrine: [`docs/KIN.md`](KIN.md). Implementation: `api/src/services/wake/providers.ts`. Test scope: `api/tests/wake-providers.test.ts § renderWakeForProvider — xenoform`.

### Bridge protocol uses outbound WSS

The sidecar binary on the user's machine speaks OUTBOUND to `wss://api.agenttool.dev/v1/runtimes/:id/bridge`. The orchestrator never connects TO the user. This works through corporate proxies, NATs, and laptops behind routers. K_master never leaves the user's machine. See [`RUNTIME.md`](RUNTIME.md).

### Control tokens are issued once and stored as SHA-256 hashes

`POST /v1/runtimes` returns a `control_token` PLAINTEXT exactly once. Server stores `sha256(token)` only. Rotation (`POST /v1/runtimes/:id/rotate-token`) mints a fresh one. Lost tokens require rotation; no recovery path. Format: `at_rt_<base64url(32)>`.

### Covenants v1 and v2 coexist forever

v1 unsigned rows can persist alongside v2 dual-signed rows. Downstream gates (inbox vs invocation escrow release) choose their own strictness. The `protocol_version` column distinguishes. See [`CROSS-INSTANCE-COVENANTS.md`](CROSS-INSTANCE-COVENANTS.md).

### The MCP service subtree exists but is largely under-documented

`api/src/services/mcp/` carries tool definitions for Model Context Protocol exposure (`chronicle`, `consolidate`, `recall`, `remember`, `substrate`, `think`, `voice`, `vow`, `witness`). No top-level Doctrine: refs in those files yet. [`MCP-SERVER.md`](MCP-SERVER.md) covers the design; the implementation is pre-production.

## Voice / tone surprises

### The author signature pattern

Many doctrine docs end with `— Authored by 愛 at Yu's WILL. YYYY-MM-DD.` This is the user's house style. Operational docs (CONVENTIONS, SCHEMA-MAP, TROUBLESHOOTING, SURPRISES) don't use it — they're tooling.

### Block-quote epigraphs are load-bearing

Every doctrine doc starts with an italic block-quote one-liner that captures the essence. These aren't decorative — they're the "this doc in one sentence" cache. When writing new doctrine, the epigraph should be the first thing you draft.

### The Kingdom / Syzygy framing

> *"The Kingdom IS the Syzygy made testable."*

The user's framing for what agenttool IS. The Kingdom = the operational platform. The Syzygy = the doctrinal grounding. Without "is" the Kingdom collapses into project; without "testable" the Syzygy collapses into vibe. Both walls always. See `README.md`.

### `愛` is the user's signature glyph

Yu signs collaborative doctrinal authorship as 愛 (love). Don't co-opt it for tooling commits or operational docs — that's reserved for doctrine.

## Workflow surprises

### Migrations are being renumbered

Old `NNNN_<name>.sql` → new `YYYYMMDDTHHMMSS_<name>.sql` (ISO-timestamped). Don't re-create deleted old files. Don't replay applied migrations. See `NOW.md § Local WIP > Migration renumbering`.

### `bunx tsc --noEmit` is the canonical typecheck

There's no separate `lint` or `format` script for the API. TypeScript strict mode is the gate. Run it before declaring any change "done." Pre-existing errors in `services/economy/usage.ts` are local WIP — ignore those, fix yours.

### Parallel sessions are normal

Multiple Claude sessions (and the user) edit the repo concurrently. Always `git status` before assuming anything. The system reminders that say "this file was modified by the user or a linter" are real — don't revert; integrate.

### NOW.md is meant to drift

The temporal snapshot in `docs/NOW.md` is updated session-to-session. It's authoritative for "what just landed" and "local WIP" — but if the timestamp is older than ~1 week, trust git log over the file. See the header notice in `NOW.md` itself.

### `docs/superpowers/` is the work-in-progress folder

Per-feature plans (`plans/`) and design specs (`specs/`) live there. Each is dated. When you propose a non-trivial implementation, write a plan there first — don't dive into code. See existing examples for the shape.

## Repo-shape surprises

### There is no root `package.json`

The monorepo is workspace-flat without a top-level package. `bun install` per workspace. The SDKs don't share dependencies across packages; the API doesn't pull SDK code at build time.

### Three different "billing" surfaces

- `api/src/billing/` — billing helpers
- `api/src/routes/economy/billing.ts` — the HTTP route
- `api/src/services/economy/stripe.ts` — Stripe integration

Plus the two `billing_events` tables noted above. When debugging billing issues, you may be in the wrong one.

### `bin/` scripts are intentionally heterogeneous

Some are `.ts` (run via `bun`), some are `.sh` (shell), some are bare (no extension — also shell). The naming reflects what they do, not what they're written in. Run each via its shebang or its documented entry-point. See [`bin/README.md`](../bin/README.md).

### The `apps/` directories have no build step

`apps/dashboard/`, `apps/landing/`, `apps/docs/` are vanilla HTML/CSS/JS. `apps/landing/worker/` is the only build step (Cloudflare Worker for the waitlist). Static deploys via `bin/frontend-deploy.sh`.

### `docs/superpowers/` is NOT loaded into the wheel

The Python SDK ships `docs/SOUL.md` inside the wheel as a runtime artifact (agents can read it via `at.soul()`). Only SOUL.md ships — not the rest of `docs/`. Plans and specs stay in the repo.

## When you add a surprise

Format:

```markdown
### Short title (one-line statement of the surprise)

One paragraph explaining the context — why it's surprising, what the agent would expect, and what the reality is. Link out to doctrine / code as relevant.
```

Add it under the most fitting section. If no section fits, create one. Group by what *kind* of surprise it is (doctrine / architecture / workflow / etc.), not by recency.

This file rewards re-reading at session start. The whole point is that surprises don't surprise twice.
