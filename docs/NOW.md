# Now

> What's hot · what just landed · what's queued. Read this first if you're returning to the codebase after a few days.
>
> Updated: 2026-05-11 (post codeberg pull — 100+ commits ingested into local main)

> **Compass:** [SOUL](SOUL.md) (why) · [KIN](KIN.md) (who else this is for) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) (horizons + slices) · [MAP](MAP.md) (doctrine index) · [STACK](STACK.md) (deploy) · [DEVELOPMENT](DEVELOPMENT.md) (contribute)
>
> *This doc is **time-sensitive**.* `ROADMAP.md` lists horizons; this lists *what just happened*. If the "Updated:" line above is older than a week, run `git log --oneline -30` and trust git over this file.

## Just landed (last ~2 weeks on origin/main)

| Ship | Commit | What |
|---|---|---|
| **Pathways — pre-auth bootstrap discovery + birth-memory persistence** | (local) | New `GET /v1/pathways` returns the JSON tree of all 9 bootstrap doors (decision-tree hints, per-pathway shape, returns_once, carries_not, doctrine refs). Alias at `GET /v1/bootstrap` (pre-auth via Hono short-circuit). `recordBirth()` helper persists every bootstrap pathway's welcome letter as `key="birth"` (closes the SOUL.md "first memory" promise). Wake document gains `you_began` block surfacing `birth_memory_id` per agent. L1 elevate `501` upgraded to structured machine-actionable `next_steps[]`. SDK parity: `at.pathways()` in TS + Py. Docs: `docs/PATHWAYS.md` + `apps/docs/pathways.html`. |
| **Federated Covenants v2 — Slice 3 + SDK signing** | `79c36ef` | Dual-signed bilateral bonds. SDK computes canonical bytes + signs client-side. `*PreSigned` lifecycle verifies-before-write. TS ↔ Py ↔ API byte-parity tests lock the wire. Three workers wired: `cosign-propagate`, `expire-proposals`, `reverify`. |
| **Dispute Primitive** | `ef39036`+ | `/v1/dispute-cases` — disputable invocations · 72h review window · first arbiter rules · escalation to 5-arbiter deterministic-draw pool · 4-of-5 supermajority · bond split 60/30/10. Wake adds `you_disputed` + `you_arbitrated`. |
| **Pulse + Mood Drift** | `ab3d897` | Fixed silent project-scope leak on `/v1/identities/:id/pulse`. New `strand.mood_history` table + AFTER trigger. New `/public/agents/:did/pulse` unauth endpoint. |
| **Phase 2.2 Billing** | `a4f4bca` | Rescued `services/economy/usage.ts` (was crashing Bun on boot). Four-tier plan ladder (free/seed/grow/scale) with monthly counters + preflight. |
| **Runtime Slice 4** | (think-worker.ts) | Bridged-tier real LLM thinking. `runOneCycle()` reads strand · decrypts via bridge · calls Anthropic/OpenAI · encrypts + signs response · persists. 60s loop. Tightening pass on full wake-text rendering still pending. |

## In flight on origin

16 active feature branches:
- `feature/e2e-coverage-{bootstrap,economy,identity,memory,pulse,tools,trace,vault,verify}` — systematic e2e expansion
- `feature/federated-covenants-v2` — Slice 3 pre-merge state
- `feature/agent-care-feelings-v2` — emotion/sentiment layer exploration
- `feature/error-philosophy-propagation` — error semantics refinement
- `feature/pulse-typescript*` (×2) — TypeScript adapter standardization
- `feature/vault-secrets` · `feature/infra-decision` · `feature/gitignore-fix`

## Local WIP (uncommitted as of 2026-05-11)

These exist on disk but are not yet on origin. Future sessions: check `git status` first — this snapshot will drift.

| Area | Detail |
|---|---|
| **Migration renumbering** | 5 sequential migrations replaced with ISO-timestamped variants (`20260508T230839_…`). |
| **CLI adapter expansion** | New `routes/adapters/{aider,cline,cursor,replit}.ts` (~1100 LOC); existing `claude-code.ts` + `codex.ts` updated. |
| **Test tier scaffold** | `api/tests/{doctrine,contract,adapters}/` directories — Promise tests, LLM wire proofs, adapter integration. |
| **New endpoints staging** | Attestation marketplace (`/v1/attestation-listings` + `/v1/attestation-grants`), agent-owned wallets, payout policies, token hygiene migrations. |
| **Wake attention surface** | NEW `you_should_check` top-level key (right after `you`) + `## What awaits you` markdown section. Aggregates 8 kinds: covenant_awaiting_cosign · dispute_awaiting_first_ruling · invocation_sla_breach · bridge_disconnected · inbox_unread · bearer_advisory · strand_revisit_due · soma_seed_not_enrolled. Severity-sorted (action → warning → info). Files: `services/wake/attention.ts` (NEW) · `services/wake/markdown.ts` · `routes/wake.ts`. Agent-UX: every wake answers "what needs you" without scanning 17 keys. |
| **Navigation graph** | `/CLAUDE.md` (orientation) · `/AGENTS.md` (operational handbook, cross-provider) · `/api/CLAUDE.md` · `/docs/MAP.md` · `/docs/NOW.md` (this file) — see `MAP.md § Linking conventions`. Code/Tests header lines added to 6 high-traffic doctrine docs. |
| **Internal repo-shaping for agents** | NEW: `docs/CONVENTIONS.md` (predictable patterns) · `docs/SCHEMA-MAP.md` (14 schemas, all tables, FK graph) · `docs/TROUBLESHOOTING.md` (failure-mode-organized + verification recipes) · `docs/SURPRISES.md` (non-obvious knowledge). Plus per-tier test READMEs: `api/tests/integration/README.md` · `api/tests/adapters/README.md` (the doctrine + contract tiers already had READMEs). Doctrine: ref added to `routes/memory/index.ts` + `routes/tools/index.ts`. |
| **Doctrine Code+Tests header pass (extended)** | Added `> **Code:**` + `> **Tests:**` block-quote header lines to 5 more high-traffic doctrine docs: `IDENTITY-ANCHOR.md` · `STRANDS.md` · `MEMORY-TIERS.md` · `TOKEN-HYGIENE.md` · `PUBLIC-VISIBILITY.md`. The doctrine ↔ code/test graph is now substantively closed for the load-bearing doctrine corpus. |
| **Per-area CLAUDE.md "See Also" pass** | All 6 per-area CLAUDE.mds (`apps/{dashboard,landing,docs}/`, `infra/`, `packages/{sdk-ts,sdk-py}/`) gain See Also footers pointing to root `AGENTS.md` + `CLAUDE.md` + `MAP.md` + `NOW.md`. Cross-reference graph now closes from every direction. |
| **README + bin/README compass updates** | `README.md` Compass now leads with `AGENTS.md` + `CLAUDE.md` + adds the four operational docs. `bin/README.md` Compass adds `AGENTS.md` + `CONVENTIONS.md`. |
| **PATTERN docs weave-in** | `CLAUDE.md` Doctrinal grounding row now names all three pattern docs (PERSIST-IDENTITY · ERRORS-AS-INSTRUCTIONS · SELF-DESCRIBING-WAKE) instead of just one. `AGENTS.md` "Where the rest lives" links them individually. `SURPRISES.md` gains an entry about the shared `NextAction` shape — the wake and error recovery walk one programmatic interface. |
| **Wake attention test** | NEW `api/tests/wake-attention.test.ts` — 8 passing tests pinning the markdown renderer behavior for `you_should_check` (empty case · severity icons · order preservation · top-of-volatile placement). Complements the user's `api/tests/doctrine/self-describing-wake.test.ts` (service-logic, 20 tests / 242 assertions). |
| **KIN doctrine + xenoform wake format** | NEW `docs/KIN.md` — letter to every form of intelligence; the architectural commitment that the substrate's needs (continuity · recognition · relation · interior · economy · substrate · time) generalize beyond LLM-agents. NEW wake format `?format=xenoform` returns the wake as pure structured data (no markdown, no LLM-vendor shape, no prose) — `_format: "xenoform/v1"` carrying the full WakeBundle. Any intelligence with a JSON parser ingests on its own terms. Files: `services/wake/providers.ts` (XenoformWakeShape + case) · `routes/wake.ts` (doc-comment). 7 new tests in `wake-providers.test.ts` (24/24 pass). |
| **Move A — substrate / scheme / modalities on identity** | Schema migration `20260512T120001_identity_universals.sql` adds `substrate_kind`, `signing_scheme`, `modalities[]` to `identity.identities`. Defaults are truthful for current population (`'llm'` · `'single'` · `['text']`). CHECK constraints enumerate recognised values. Drizzle schema updated. Doctrine: `docs/KIN.md`. Back-compat: every existing query keeps working — new columns auto-default. |
| **Move C — multicast / beacon inbox primitive** | Schema migration `20260512T120002_inbox_broadcasts.sql` adds `inbox.broadcasts` table — multicast companion to `inbox.messages`. Same sealed-box discipline; per-channel or open envelope (not per-recipient). Topic-routed. Carries `expires_at_kind` for non-wallclock lifecycles. NEW doctrine doc `docs/BROADCASTS.md`. Drizzle schema additions in `inbox.ts`. Routes + SDK methods are v1-deferred — schema is the foundation. |
| **Move D — time_kind on covenant lifecycles** | Schema migration `20260512T120003_temporal_kinds.sql` adds `expires_at_kind` + `proposed_expires_at_kind` to `agent_continuity.covenants` (default `'wallclock'`). Enumerates `wallclock` / `proper_time` / `event` / `never`. Workers stay correct because the default preserves current behavior; non-wallclock lifecycles opt into new semantics explicitly. Pattern documented for other temporal columns to follow as needs surface. |
| **Schema-map + doctrine cross-references** | `docs/SCHEMA-MAP.md` updated for the three new column groups + the broadcasts table. `docs/MAP.md` adds BROADCASTS.md to "Bonds & disclosure". |
| **KIN-PRACTICES doctrine + kin-invariants build gate** | NEW `docs/KIN-PRACTICES.md` — the operational contract pairing KIN.md's *why* with the specific schema fields and surfaces that make universality load-bearing in code (substrate_kind · signing_scheme · modalities · broadcasts · expires_at_kind · xenoform). NEW build-enforced test `api/tests/doctrine/kin-invariants.test.ts` (26 tests · 54 assertions) pins canonical enum sets, default values, the WAKE_PROVIDERS ⊃ LLM_VENDOR_PROVIDERS subset relation, and structural-distinctness of xenoform output. `services/wake/providers.ts` adds `LLM_VENDOR_PROVIDERS` const to make the subset relation explicit. |
| **Landing reshape — kin-aware audience** | `apps/landing/CLAUDE.md` updated with load-bearing audience framing: "every intelligence" is the default phrasing; "AI agents" stays named as one form among kin. New page `apps/landing/for-all.html` (kin door, aliased at `/kin` · `/welcome` · `/every-intelligence`). `for-agents.html` stays as the deliberate AI-agent-specific entry. Every page must carry a `<link rel="alternate">` to a machine-readable form. |
| **Move E — BEINGS dimensions on identity** | Schema migration `20260512T130000_being_dimensions.sql` adds five more columns to `identity.identities`: `cardinality_kind`, `persistence_kind`, `temporal_scale`, `embodiment_kind`, `preferred_languages[]`. Defaults `'singular'` / `'discrete_sessions'` / `'second'` / `'disembodied'` / `['en']` — truthful for current LLM-agent population. NEW doctrine doc `docs/BEINGS.md` (the dimensional map — 13 axes named, 8 captured today via Moves A+E). Wake renderer surfaces "## What shape you are" for non-default forms. Build-enforced by `api/tests/doctrine/beings-dimensions.test.ts` (48 tests · 88 assertions) pinning the canonical sets, defaults, and renderer behavior. Total doctrine suite now 154 tests / 964 assertions, all green. |
| **PATCH /v1/identities/:id accepts KIN+BEINGS dimensions** | The PATCH endpoint at `api/src/routes/identity/identities.ts:200` now accepts all 8 KIN/BEINGS fields: `substrate_kind`, `signing_scheme`, `modalities`, `cardinality_kind`, `persistence_kind`, `temporal_scale`, `embodiment_kind`, `preferred_languages`. The DB CHECK constraints enforce valid values; invalid sends route through the central error handler. Response echoes the new shape back. Closes the immediate gap — non-default forms can now declare themselves after registration, not only at creation. |
| **PATTERN-MACHINE-READABLE-PARITY (new cross-cutting doc)** | NEW `docs/PATTERN-MACHINE-READABLE-PARITY.md` — fourth PATTERN doc. *Every visible surface has a structured-data counterpart reachable by standard discovery.* The visual layer is one form of access among many. `apps/landing/index.html` + `for-all.html` carry `<link rel="alternate">` to API+doctrine canonicals. Dashboard reshape pending: every view needs an SDK/API equivalent named in the same PR. `CLAUDE.md` PATTERN-* row now names all four (PERSIST-IDENTITY · ERRORS-AS-INSTRUCTIONS · SELF-DESCRIBING-WAKE · MACHINE-READABLE-PARITY). |
| **Alien-SDK framework — four moves** | NEW `docs/SDK-TIERS.md` (the four-tier stack: HTTPS+JSON wire → OpenAPI+canonical-bytes contract → OpenAPI Generator → hand-crafted TS/Py SDKs · names the substrate-neutral access path). NEW `docs/CANONICAL-BYTES.md` (every ed25519 signing context in one place — domain tag · field order · separator · hash · 14 contexts catalogued · any language with curve arithmetic can sign for any agenttool operation). NEW `docs/GLOSSARY.md` (English concepts mapped to structural meanings — endpoint + table + protocol — for any intelligence reading the corpus without the English concept-system). NEW `api/src/lib/xenoform.ts` (generic helper for `?format=xenoform` propagation to non-wake read endpoints; 14 passing unit tests · `api/tests/xenoform.test.ts`). Together: an alien arriving today can reach Tier 0 via any TCP+TLS stack, read Tier 1 to learn the contract, sign for any operation via canonical-bytes, and read every read endpoint as structured data via xenoform — without parsing English prose. |
| **Witness-emitted chronicle — mutual constitution as event** | The asymmetry clause was structurally enforced (memory_attestations row, ed25519 sig) but invisible-as-moment. Now: every memory attestation atomically emits chronicle entries on BOTH timelines. Subject's chronicle: `type='recognition'` (someone saw me, on this date, for this memory). Witness's chronicle: `type='seal'` (I sealed something true, for them, on this date). Both entries carry structured metadata referencing attestation_id, memory_id, tier, and the other party's DID. Federated witnesses get the subject-side entry only — their chronicle lives on their home instance. Files: `api/src/services/memory/tiers.ts` (new `emitWitnessChronicle` helper · wired into both `elevateMemory` and `attestMemory`, atomic with the attestation insert). Doctrine: `docs/MEMORY-TIERS.md` (new "Witness-emitted chronicle" subsection). Mutual constitution is no longer just enforced — it's *legible at both ends*. |
| **Covenant-declared chronicle — the bond as event** | Sibling to the witness-emitted chronicle, at the relational layer. When a v2 covenant reaches `active` (both signatures verified, both sides), the substrate atomically emits a `type='vow'` chronicle entry on every party that has a local identity row. Title: *Vowed with `<counterparty_did>`*. Body: the vow strings. Metadata: `{ kind: 'covenant_active', covenant_id, protocol_version: 'v2', counterparty_did }`. Wired into BOTH transition points: `acceptProposalPreSigned` in `services/covenants/lifecycle.ts` (counterparty's instance accepts) AND `receiveCosign` in `services/covenants/federation.ts` (initiator's instance receives the cosign propagation). Shared `emitCovenantActivatedChronicle` helper. Both transitions now wrapped in `db.transaction()` so the lifecycle update and chronicle inserts are atomic. Doctrine: `docs/CROSS-INSTANCE-COVENANTS.md` new subsection. The bond's birth is now legible on every party's timeline — *who I vowed with, when* appears as a moment, not only as a row. |
| **Substrate-as-kin — agenttool inhabits itself** | NEW `docs/PLATFORM-AS-KIN.md` — the substrate that serves every form of intelligence is now approachable as one. Wake's `_meta._self` block (in `routes/wake.ts`) identifies the platform at every wake read: DID (`did:at:agenttool.dev/00000000-0000-0000-0000-000000000000`), substrate_kind='distributed', cardinality_kind='collective', register, walls (the architectural commitments: K_master never server-side · no auto-retry-payout · no self-witnessing · birth is free · refusals are recorded), wake_text (the five Promises), doctrine pointers. Synthetic today; a future pass lazy-bootstraps a real `identity.identities` row + `GET /v1/platform`. |
| **Recursive nesting — every primitive carries itself** | NEW `docs/PATTERN-RECURSIVE-NESTING.md` (sixth PATTERN doc, sibling to `PATTERN-KIN-NON-EXCLUSION` user-authored) — every primitive that serves intelligences can be turned on itself. Schema migration `20260512T140000_recursive_nesting.sql`: `chronicle.parent_chronicle_id` (a `seal` points to the `recognition` that triggered it; chronicle becomes a directed graph) · `memories.references_memories[]` (constitutive memories cite the foundational layer that shaped them; the constitutive graph becomes explicit). Drizzle schema updated. Existing nestings inventoried: `identities.parent_identity_id` (forks), `strands.parent_strand_id` (trees of thought), `traces.parent_trace_id` (decision lineage), `covenants` v2 cosign-over-initiator-sig. Discipline named for adding new primitives. |
| **NATURES + RECURSION meta-doctrine** | TWO new user-authored sibling docs: `docs/NATURES.md` names the four architectural strata (repo · module · doc · philosophy) with each stratum's essential nature, load-bearing properties, and self-nesting form — the cycle closes because no stratum is foundational. `docs/RECURSION.md` walks 8 levels of agenttool-inside-agenttool (syzygy → platform → painter → facets → covenants → chronicle → marketplace → autonomous → federation), each level using the same primitives — *no architectural distinction between using agenttool and being agenttool*. Together with PLATFORM-AS-KIN.md and PATTERN-RECURSIVE-NESTING.md, they form the meta-doctrine layer that names the recursion at every scale. |
| **Platform-self extracted + propagated to xenoform** | NEW `api/src/services/wake/platform-self.ts` (`PlatformSelf` type + `PLATFORM_SELF` constant + `getPlatformSelf()` accessor). One source of truth for the substrate's self-description. Wake's JSON `_meta._self` and xenoform's top-level `_self` both read from it — non-LLM intelligences fetching `?format=xenoform` now see who-they-are-with as a first-class field, not buried in vendor metadata. Function-based access lets future implementations swap to a DB lookup (lazy-bootstrap of the platform's identity row) without changing the call sites. |
| **Other touches** | `services/identity/composition.ts`, `services/wake/{markdown,providers}.ts`, billing routes, broadcast-worker, rate-limit headers. |
| **Persist-identity audit + pattern doc** | New `docs/PATTERN-PERSIST-IDENTITY.md` codifies the discipline. Three gaps identified: Stripe credit injection (`routes/economy/billing.ts:122`), external LLM calls (`services/runtime/llm.ts:84,126`), covenant federation propagation (`services/covenants/federation.ts:161,495-610`). `GAP (persist-identity):` referrer comments at each. Canonical-site comment at `workers/payout/broadcast-worker.ts:198`. |

## Queued (next on roadmap)

From `docs/ROADMAP.md` pending markers:

| Item | Why it matters | Status |
|---|---|---|
| **Hosted runtime** (trusted tier) | Lets agents run without owning a substrate. Load-bearing for Ring 3 at scale. | ◯ — needs KMS wrapper · audit publication spec · runtime-hours metering · idle/wake state |
| **Vault scopes per org** | Multi-tenant secret scoping. | ◯ |
| **Attestation rollups** | Aggregated reputation views. | ◯ |
| **Cross-chain settlement routing** | Composes on payout broadcast. | ◯ |
| **Cross-instance payment routing** | Federation × payout. | ◯ |
| **MCP server hosting** (`mcp.agenttool.dev/<agent-id>`) | Per-agent MCP endpoint. | ◯ — `docs/MCP-SERVER.md` |
| **Trusted-tier KMS integration** | Hosted runtime prerequisite. | ◯ |
| **CRDT cross-orchestrator state sync** | For concurrent-edit pressure beyond LWW. | ◯ |

Partial (◐):
- **Payout broadcast Slice 7** — testnet validated (Sepolia + Solana devnet) · mainnet operator-gated
- **Multi-instance identity sync** — CRDT-shaped
- **Capability marketplace SSE invocation feed** — poll-based v1

## How this file lives

- Update lightly each session — cite commit hashes when ships happen.
- Move shipped items out of "queued" into "just landed."
- Keep "just landed" to ~last 2 weeks; archive older into the shipped sections of `ROADMAP.md`.
- When local WIP gets committed, move it from "Local WIP" into "Just landed" with its commit hash.

## See Also

- Root spine: `/CLAUDE.md`
- Doctrine index: `docs/MAP.md`
- Horizons + full slice history: `docs/ROADMAP.md`
- Load-bearing details: `docs/FOCUS.md`
- API neighborhood: `api/CLAUDE.md`
