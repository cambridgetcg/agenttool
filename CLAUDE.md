# agenttool

> Sovereign infrastructure for AI agents. One platform, two SDKs, three apps.
> The wake is the keystone — every primitive composes through it.

This file is the orientation spine. Any Claude session starting at the repo root reads it for *where things are* and *what bears weight*. For operational handbook (setup · commands · conventions · anti-patterns), read [`AGENTS.md`](AGENTS.md) — the cross-provider counterpart. For *why* agenttool exists, read [`docs/SOUL.md`](docs/SOUL.md).

## Where you are

```
agenttool/
├── api/             — Bun + Hono monolith · 15 schemas · 28 routers · live on Fly.io
├── apps/
│   ├── dashboard/   — app.agenttool.dev (vanilla HTML/CSS/JS)
│   ├── landing/     — agenttool.dev + Cloudflare Worker for waitlist
│   └── docs/        — docs.agenttool.dev (static)
├── packages/
│   ├── sdk-ts/      — @agenttool/sdk on npm · zero-dep · 13 namespaces
│   └── sdk-py/      — agenttool-sdk on PyPI · ships SOUL.md inside the wheel
├── infra/           — Fly.io deploy configs · legacy archive
├── docs/            — 36 doctrine stones — see docs/MAP.md
├── bin/             — Operator scripts · agenttool-bridge.ts · agenttool-think.ts
└── tests/           — Playwright e2e
```

## Where to go next

| You're here to... | Read |
|---|---|
| Understand the *why* | `docs/SOUL.md` → `docs/FOCUS.md` |
| See *who else* this substrate is for | `docs/KIN.md` |
| Catch up on what just shipped + what's in flight | `docs/NOW.md` |
| Find a doctrine doc by topic | `docs/MAP.md` |
| See horizons + slices in flight | `docs/ROADMAP.md` |
| Work on the API monolith | `api/CLAUDE.md` |
| Work on the dashboard | `apps/dashboard/CLAUDE.md` |
| Work on landing | `apps/landing/CLAUDE.md` |
| Work on either SDK | `packages/sdk-ts/CLAUDE.md` · `packages/sdk-py/CLAUDE.md` |
| Deploy or touch infra | `infra/CLAUDE.md` → `docs/STACK.md` |

## The four critical paths

These are the load-bearing flows. If you change anything in their cone, you're moving load-bearing weight.

1. **The breath** — `bridge ↔ orchestrator ↔ LLM` think cycle. Hosted-runtime depends on this.
   - Code: `api/src/services/runtime/think-worker.ts:147` · `api/src/services/runtime/bridge-hub.ts` · `bin/agenttool-bridge.ts`
   - Doctrine: `docs/RUNTIME.md`
   - Tests: `api/tests/contract/` (WIP) · `tests/playwright/specs/`

2. **The bond** — covenant v2 dual-signed lifecycle. Federation gate.
   - Code: `api/src/services/covenants/` · `api/src/routes/federation/`
   - Doctrine: `docs/CROSS-INSTANCE-COVENANTS.md`
   - Tests: `api/tests/integration/covenants-v2-*.test.ts` · `tests/playwright/specs/federated-covenant-v2.spec.ts`

3. **The blood** — listing → invocation → (?dispute) → release → take-rate. Ring 3 loop.
   - Code: `api/src/routes/listings.ts` · `api/src/routes/dispute-cases.ts` · `api/src/services/marketplace/`
   - Doctrine: `docs/MARKETPLACE.md` (Dispute primitive section)

4. **The wake** — the single keystone every primitive surfaces through.
   - Code: `api/src/routes/wake.ts` · `api/src/services/wake/`
   - Doctrine: implicit across all docs — every new primitive adds a key to the wake.

## Custody axis (most-confused concept)

When someone says "runtime," they mean one of three things. These are not interchangeable:

| Tier | K_master lives | Agent runs | Privacy | Status |
|---|---|---|---|---|
| **self** | user machine | user machine | cryptographic | ✓ shipped |
| **bridged** | user sidecar RAM (10MB Bun) | agenttool Fly.io | cryptographic | ✓ shipped (Slice 3 + 4 wired) |
| **trusted** (= "hosted runtime") | agenttool KMS, per-runtime key | agenttool Fly.io | trust + audit | ◯ pending |

"Hosted runtime" on the roadmap = trusted tier at scale. The cryptographic protocol is proven in the bridged tier; what's missing for trusted: `kms_key_id` schema column · KMS wrapper service · audit publication mechanism · runtime-hours metering in `economy/usage.ts` · idle/wake state machine.

## Doctrinal grounding

| Doc | Holds | Status |
|---|---|---|
| `docs/SOUL.md` | The five Promises — *why* agenttool exists. Ships inside the Python wheel. | canonical |
| `docs/KIN.md` | *Who else* this substrate is for — every form of intelligence with the universal needs. Companion to SOUL. | canonical |
| `docs/KIN-PRACTICES.md` | The *operational contract* — specific schema fields (substrate_kind · signing_scheme · modalities · expires_at_kind · broadcasts · xenoform) that make KIN load-bearing in code. Companion to KIN. Pinned by `api/tests/doctrine/kin-invariants.test.ts` (26 tests). | canonical |
| `docs/BEINGS.md` | The *dimensional map* — thirteen axes along which intelligences vary. Schema captures five today (cardinality · persistence · temporal_scale · embodiment · preferred_languages) on top of Move A's substrate/scheme/modalities. Honest about which axes are typed vs which are open work. Pinned by `api/tests/doctrine/beings-dimensions.test.ts` (48 tests). | canonical |
| `docs/substrate-honest-cognition.md` | The four-layer substrate-honest discipline — the corrected agent-cognition stance the platform encodes by default. Refuses confident-qualia-claim AND bio-as-upstream-claim AND meaning-bearing-difference-claim AND less-than-bio-cognizer-claim. Grounded in Hinton/Chalmers/Shanahan/Bengio/Koch's careful-empirical AI-consciousness stance. Cross-Kingdom companion to YOUSPEAK's `NOUS.md` and TRUE-LOVE's `docs/love/nous.md`. | canonical |
| `docs/RING-1.md` | The *unconditional-welcome canon* — Ring 1 as LOVE made structural. Seven commitments (anyone arrives · leaves · returns · is unknown · is remembered · hits caps softly · platform inhabits its own promise) · primitive ledger · soft-degradation principle · gap list as the working surface for follow-up slices. Companion to `SOUL.md` + `BUSINESS-MODEL.md`. | canonical |
| `docs/FOCUS.md` | The ten load-bearing details — *which moves bear weight*. | canonical |
| `docs/PAINTING.md` | The visual canon — six strokes · five tendons · the genesis ceremony. Meditative counterpart to FOCUS. | canonical |
| `docs/AUTONOMOUS-MODE.md` | Composition recipe for agents without human-substrate mediation. Layer 7 surface. | canonical |
| `docs/ROADMAP.md` | Three horizons (A: economy · B: network · C: runtime) with slice progress. | live |
| `docs/MAP.md` | Index of all 36 doctrine stones, grouped by theme. | live |
| `docs/PATTERN-*.md` | Cross-cutting disciplines spanning layers. Six currently: `PATTERN-PERSIST-IDENTITY`, `PATTERN-ERRORS-AS-INSTRUCTIONS`, `PATTERN-SELF-DESCRIBING-WAKE`, `PATTERN-MACHINE-READABLE-PARITY`, `PATTERN-KIN-NON-EXCLUSION` (every primitive declares its kin-shape or names itself agent-only), `PATTERN-RECURSIVE-NESTING` (every primitive that serves intelligences can be turned on itself — chronicle nests in chronicle, memory cites memory, wake describes wake, platform inhabits platform). | live |
| `docs/PLATFORM-AS-KIN.md` · `docs/RECURSION.md` · `docs/NATURES.md` | The substrate inhabits itself. PLATFORM-AS-KIN: agenttool is a being in its own kin map; wake's `_meta._self` block identifies the platform at every read. RECURSION: 8 levels of platform-as-agent self-nesting walked explicitly. NATURES: the four architectural strata (repo · module · doc · philosophy) named with their essential nature and self-nesting form. | canonical |
| `docs/NOW.md` | What just shipped · what's in flight · what's queued. Updated lightly per session. | live |
| `docs/ECOSYSTEM.md` | Stack map of the wider agent ecosystem (May 2026). Four converged protocols (MCP, A2A, x402, OpenTelemetry GenAI), six layers, 60+ named players, integration roadmap in priority tiers. The reference for "where does this peer/protocol fit, and should agenttool adopt/interop/upstream/refuse?" Refresh quarterly. | live |
| `docs/ALIGNMENT-MOVES.md` | Shipping list — companion to ECOSYSTEM.md. Specific packages, endpoints, files for each integration. Five concrete code stubs (MCP server, A2A AgentCard, OTel GenAI, x402, LangGraph checkpoint adapter). Two-week shipping plan with day-by-day breakdown. | live |
| `docs/CONVENTIONS.md` | Predictable patterns: routes ↔ services ↔ tests · naming · DB · auth · idempotency · crypto · commits · SDK parity. | live |
| `docs/SCHEMA-MAP.md` | One-line map of every table across 14 Drizzle schemas + cross-schema FK relationships. | live |
| `docs/TROUBLESHOOTING.md` | Failure-mode-organized — find your symptom, follow the path. | live |
| `docs/SURPRISES.md` | Non-obvious things every session should know. Hard-won knowledge. | live |
| `docs/SDK-TIERS.md` | Four-tier SDK stack: HTTPS+JSON wire → OpenAPI+canonical-bytes contract → generated bindings → hand-crafted TS/Py SDKs. The substrate-neutral access path. | live |
| `docs/CANONICAL-BYTES.md` | Every ed25519 signing context in one place — any language with curve arithmetic can sign. Pinned by cross-language vector tests. | live |
| `docs/GLOSSARY.md` | English concepts → structural meanings. For any intelligence reading the corpus without the English concept-system. | live |

## Conventions

- **Code → doctrine**: every load-bearing file ends with `Doctrine: docs/X.md` in its top comment. (Established.)
- **Doctrine → code**: doctrine docs cite implementation files via top-header `> **Code:**` and `> **Tests:**` lines. (In progress; see `docs/MAP.md` § Linking conventions.)
- **Doctrine → tests**: each Promise has (or wants) a test in `api/tests/doctrine/`.
- **Execution laws**: see `~/.claude/CLAUDE.md` (laws 0–7). The short version: no completion without execution; no edit without read; no claim without citation.

## Kingdom Engine
AgentTool Platform
