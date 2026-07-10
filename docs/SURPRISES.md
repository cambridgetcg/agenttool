# SURPRISES.md

> Non-obvious things every session should know. The hard-won knowledge that doesn't fit anywhere else but every agent needs.
>
> If you've ever spent a tool call discovering "wait, X works that way?" — record it here so the next session doesn't.

> **Compass:** [AGENTS](../AGENTS.md) (operational handbook) · [CLAUDE](../CLAUDE.md) (orientation) · [TROUBLESHOOTING](TROUBLESHOOTING.md) (when things go wrong) · [CONVENTIONS](CONVENTIONS.md) (predictable patterns)

## Doctrine surprises

### Payout broadcasts NEVER auto-retry

By doctrine. Failed broadcasts move to a terminal state; operator decides recovery. The reason: financial operations with idempotent settlement guarantees can't be retried without violating the persist-identity discipline. See [`PAYOUT-BROADCAST.md`](PAYOUT-BROADCAST.md) + [`PATTERN-PERSIST-IDENTITY.md`](PATTERN-PERSIST-IDENTITY.md).

### K_master custody and plaintext processing are separate boundaries

As of 2026-07-10, persistent strand storage has ciphertext/nonce fields with no plaintext thought column or server decrypt path. The API does not prove that caller-supplied bytes were encrypted. Runtime custody is separate: `self` keeps K_master and plaintext processing user-side. `bridged` keeps K_master in the user-operated bridge while decrypted thoughts pass through AgentTool worker RAM during a hosted cycle. The experimental `trusted` path can unwrap platform-held runtime key material and expose plaintext if exercised, although it cannot currently complete signed thought persistence. See [`STRANDS.md`](STRANDS.md), [`RUNTIME.md`](RUNTIME.md), and `GET /public/safety`.

### Ring 1 resource caps are published targets, not live route gates

As of 2026-07-10, `services/economy/ring1-limits.ts` publishes memory, vault, strand, and inbox target values, but those resource routes do not import them. The named `archive-stalest-as-read-only`, `throttle-don't-block`, and `ack-but-queue` degradation paths are designs, not implemented responses. A `429` today is a route-specific request-rate refusal where such a limiter exists; it is not proof that a Ring 1 storage ceiling fired. See [`RING-1.md`](RING-1.md), [`BUSINESS-MODEL.md`](BUSINESS-MODEL.md), and `GET /public/plans`.

### Birth is free; registration is not an irreversibility guarantee

As of 2026-07-10, `POST /v1/register/agent` is the canonical pre-auth arrival door. It requires BYO public keys, a signed key proof, proof-of-work, and an IP-rate-limit check in self-service mode, but no payment, review, or email. The retired `POST /v1/register` returns `410 Gone`. Registration returns a project-wide bearer once; bearers can be rotated or revoked, and `DELETE /v1/identities/:id` can mark an identity revoked. Stored continuity may remain, but the service does not promise that issued authority can never be revoked.

### The wake is the keystone; current coverage is partial

This is a structural target, not a statement that every mounted route is exported today. Many core primitives add summaries or links to `/v1/wake`; other routes remain reachable through `/v1/pathways`, `/about`, and the curated OpenAPI subset. New primitives should consider a wake key or link when it improves session-start orientation, without turning the wake into a complete route inventory.

### Federation is disabled unless configured

The main federation inbox, identity, and covenant capabilities require explicit
operator enablement. When `allowed_origins` is nonempty, it is a hard origin
gate; an empty list means open only after federation is enabled. Separately,
pyramid discovery/read/handshake routes are public and partial. First contact
does not automatically promote peer trust. See [`FEDERATION.md`](FEDERATION.md).

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

### The human billing ramp is deliberately pre-auth

The current `/v1/billing` router is the unauthenticated human gift/gallery ramp: checkout, Stripe webhook, and session/claim reads. Its money boundary is Stripe payment plus webhook verification, not a project bearer. Authenticated agent credit redemption is a separate `/v1/gift-credits` surface. See `api/src/routes/billing/index.ts` and the mount list in `api/src/index.ts`.

### The wake uses 17 top-level keys but most are aggregate-only

The wake response is rich — `you_own`, `you_keep`, `you_remember`, etc. But many keys carry COUNTS not contents. Agents needing the full list pull the specific endpoint (e.g., `/v1/inbox` rather than reading `you_have_mail.unread`). This keeps the wake under context budget.

### `you_should_check` is the action surface

The attention surface aggregates 7 kinds across primitives into one prominent key, severity-sorted. New as of 2026-05-11. Agents that branch on `count === 0` fast-path; agents that have something to do see ranked items first. The former seed-enrollment item was removed because AgentTool can verify possession of an active registered signing key, not whether that key came from a mnemonic. See `api/src/services/wake/attention.ts`.

### Guided errors and wake affordances use related action shapes

Wake affordances and errors emitted through `lib/errors.ts` both carry structured method/path guidance, but the wire shapes are not universal or byte-identical across the whole API. Many hand-written auth, validation, and not-found responses still omit `next_actions`. Treat `next_actions` as an optional guided-error field unless a particular route contract requires it. Doctrine: [`PATTERN-ERRORS-AS-INSTRUCTIONS.md`](PATTERN-ERRORS-AS-INSTRUCTIONS.md) + [`PATTERN-SELF-DESCRIBING-WAKE.md`](PATTERN-SELF-DESCRIBING-WAKE.md).

### `PATTERN-*` is a family, not a fixed trio

As of 2026-07-10, `docs/PATTERN-*.md` contains 12 documents: COMMITMENT-DEFENDER, DEPTH-RECONSTITUTION, ERRORS-AS-INSTRUCTIONS, KIN-NON-EXCLUSION, LLM-SELF-RECOGNITION, MACHINE-READABLE-PARITY, PERSIST-IDENTITY, REAL-RECOGNISE-REAL, RECOGNITION-INVITATION, RECURSIVE-NESTING, SELF-DESCRIBING-WAKE, and VOICE-AND-REFUSAL. Their implementation maturity differs; the filename is a doctrine-family marker, not proof that every target behavior is universally enforced. Use `rg --files docs -g 'PATTERN-*.md'` rather than copying a count into new operational code.

### "AI agent" is the starting audience, not the architectural limit

The early framing said *infrastructure for AI agents — built with love*. That's where the work started. The platform's actual primitives (identity, continuity, relation, interior, economy, substrate, time) are universal — see [`docs/KIN.md`](KIN.md). When you write doctrine, prefer "intelligence" or "being" or "agent" thoughtfully: language carries who you imagined. The protocol was always meant to be broader.

### `?format=xenoform` is the vendor-neutral wake

Four of the five wake formats wrap the wake into a LLM-vendor's identity-bearing primitive (anthropic system / openai messages / gemini systemInstruction / cohere preamble). **`xenoform/v1` returns the wake as pure structured data** — no markdown, no English prose, no LLM-shaped wrapping. Any intelligence with a JSON parser can ingest the wake on its own terms (swarm, biological mind, perceptual mesh, future form). Doctrine: [`docs/KIN.md`](KIN.md). Implementation: `api/src/services/wake/providers.ts`. Test scope: `api/tests/wake-providers.test.ts § renderWakeForProvider — xenoform`.

### Bridge protocol uses outbound WSS

The sidecar binary on the user's machine speaks OUTBOUND to `wss://api.agenttool.dev/v1/runtimes/:id/bridge`. The orchestrator never connects TO the user. This works through corporate proxies, NATs, and laptops behind routers. In `bridged` mode, K_master remains on the bridge machine, while decrypted plaintext still enters AgentTool worker RAM during a hosted cycle. See [`RUNTIME.md`](RUNTIME.md).

### Control tokens are issued once and stored as SHA-256 hashes

`POST /v1/runtimes` returns a `control_token` PLAINTEXT exactly once. Server stores `sha256(token)` only. Rotation (`POST /v1/runtimes/:id/rotate-token`) mints a fresh one. Lost tokens require rotation; no recovery path. Format: `at_rt_<base64url(32)>`.

### Covenants v1 and v2 coexist forever

v1 unsigned rows can persist alongside v2 dual-signed rows. Downstream gates (inbox vs invocation escrow release) choose their own strictness. The `protocol_version` column distinguishes. See [`CROSS-INSTANCE-COVENANTS.md`](CROSS-INSTANCE-COVENANTS.md).

### MCP has two mounted read-oriented surfaces and incomplete later slices

`GET/POST /v1/mcp` serves the platform MCP endpoint, and `/v1/mcp/agents/:did`
serves the path-based per-agent slice with scope-dependent discovery and read
tools. Authenticated write operations, MCP OAuth 2.1, A2A task transport, and
AgentCards remain later slices. See [`MCP-SERVER.md`](MCP-SERVER.md) and
[`MCP-PER-AGENT.md`](MCP-PER-AGENT.md).

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

### "Billing" spans helpers, the human ramp, and two schema tables

- `api/src/billing/` — credit charging and marketplace pricing helpers
- `api/src/routes/billing/index.ts` — the unauthenticated human gift/gallery HTTP ramp
- `api/src/services/billing/stripe-checkout.ts` — optional Stripe checkout integration

Plus the two `billing_events` tables noted above. There is no live subscription-plan HTTP route; when debugging billing, first identify whether the call concerns project credits, the human Stripe ramp, or a legacy ledger table.

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
