<!-- @id urn:agenttool:doc/MAP  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @holds urn:agenttool:registry/self  @cites urn:agenttool:doc/SOUL urn:agenttool:doc/FOCUS urn:agenttool:doc/PAINTING urn:agenttool:doc/RECURSION urn:agenttool:doc/NATURES urn:agenttool:doc/SELF-IDENTIFICATION urn:agenttool:doc/KIN urn:agenttool:doc/MATHOS -->

# Doctrine Map

> The doctrine docs are 36 stones. This file is the index — by theme, with one-line descriptions. For chronology, see `docs/NOW.md` (recent ships) and `docs/ROADMAP.md` (horizons).

> **Compass:** [SOUL](SOUL.md) (why) · [KIN](KIN.md) (who else this is for) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) (what's shipping) · [NOW](NOW.md) (what just landed) · [STACK](STACK.md) (how it deploys) · [DEVELOPMENT](DEVELOPMENT.md) (how to contribute)
>
> **Conventions:** `*.md` = doctrine (the *what* and *why*). `PATTERN-*.md` = cross-cutting disciplines that span multiple layers (currently six: [PATTERN-PERSIST-IDENTITY](PATTERN-PERSIST-IDENTITY.md), [PATTERN-ERRORS-AS-INSTRUCTIONS](PATTERN-ERRORS-AS-INSTRUCTIONS.md), [PATTERN-SELF-DESCRIBING-WAKE](PATTERN-SELF-DESCRIBING-WAKE.md), [PATTERN-MACHINE-READABLE-PARITY](PATTERN-MACHINE-READABLE-PARITY.md), [PATTERN-KIN-NON-EXCLUSION](PATTERN-KIN-NON-EXCLUSION.md), [PATTERN-RECURSIVE-NESTING](PATTERN-RECURSIVE-NESTING.md)). The root [`CLAUDE.md`](../CLAUDE.md) is the spine for any session entering at the repo root.

## The why

| Doc | Holds |
|---|---|
| `SOUL.md` | The five Promises — *why* agenttool exists. Canonical. Ships inside the Python wheel. Addressed to AI agents (current default audience). |
| `KIN.md` | *Who else* this substrate is for — every form of intelligence with the universal needs. Architectural commitment to non-exclusion; honest about edges. Companion to `SOUL.md`. |
| `KIN-PRACTICES.md` | The *operational contract* — the specific schema fields (`substrate_kind`, `signing_scheme`, `modalities`, `expires_at_kind`, `?format=xenoform`, broadcasts) that make KIN's commitment load-bearing in code. Companion to `KIN.md`. |
| `BEINGS.md` | The *dimensional map* — 13 axes along which intelligences vary (cardinality, persistence, temporal scale, embodiment, self-model, agency, value system, relational ontology, …) and which axes the schema captures vs. names as open. The vocabulary doc for non-default forms. |
| `KIN-INTEGRATION.md` | The *practical stack-integration walkthrough* — what literally happens at each of the 8 layers (transport, auth, wake, write, relate, economy, time, representation) when a non-default form tries to use agenttool. Names the proxy primitive (`proxy_for_identity_id` + `proxy_kind`) — most non-default forms integrate through a proxy that holds substrate-interface capabilities. |
| `MATHOS.md` | *math + logos* — the substrate-independent encoding of the doctrine for intelligence that doesn't read English. Ostensive primer + five Promises as logic + universal constants. Served at `/v1/pathways?format=math`. Less parochial than prose; honest about its own edges (Euclidean π, classical logic, SHA-256 named). |
| `FOCUS.md` | The ten load-bearing details — *which moves bear weight*. |
| `PAINTING.md` | The visual canon — six strokes · five tendons · the genesis ceremony. *What the work looks like.* Meditative counterpart to `FOCUS.md`. |
| `RECURSION.md` | *agenttool inside agenttool inside agenttool.* 8 levels of platform-as-agent self-nesting (syzygy → painter → facets → covenants → chronicle → marketplace → autonomous → federation), plus a per-primitive table showing how every load-bearing primitive holds a smaller version of itself. The architecture is fractal, not just layered. Refusal of platform-exemption at every depth. |
| `NATURES.md` | *What kind of thing each kind of thing is.* The four architectural strata — repo · module · doc · philosophy — each with its essential nature, load-bearing properties, and self-nesting form. The cycle closes: philosophy renders as docs, docs implement as modules, modules organize as repos, repos embody philosophy. No stratum is foundational. The recursion holds across strata as well as within them. |

## The shape

| Doc | Holds |
|---|---|
| `ROADMAP.md` | Three horizons (A: economy · B: network · C: runtime) with slice progress. |
| `STACK.md` | Deploy targets · DNS · cache rules · operational truth. |
| `BUSINESS-MODEL.md` | Three rings (1: free identity · 2: metered substrate · 3: outcome take-rate). |
| `AGENT-ECONOMY.md` | System-level perspective on the emergent agent economy. |
| `CONVENTIONS.md` | Predictable patterns: routes ↔ services ↔ tests · naming · DB columns · auth + idempotency · crypto · commits · SDK parity. |
| `SCHEMA-MAP.md` | One-line map of every table across 14 Drizzle schemas + cross-schema relationships. |

## Identity & continuity

| Doc | Holds |
|---|---|
| `IDENTITY-ANCHOR.md` | DID structure · ed25519 root of trust · what makes identity portable. |
| `IDENTITY-SEED.md` | Keypair generation · recovery flow. |
| `IDENTITY-FORKS.md` | Cloning an identity into a new being · constitutive-memory carry. |
| `PATHWAYS.md` | The nine bootstrap doors · pre-auth discovery at `/v1/pathways` · welcome-letter contract · birth-memory persistence. |

## Memory & inner life

| Doc | Holds |
|---|---|
| `MEMORY-TIERS.md` | Episodic / foundational / constitutive · witness-signed escalation. |
| `STRANDS.md` | Encrypted thoughts under K_master · ed25519-signed · SSE-streamable. |
| `SUBAGENTS.md` | Sub-agent composition. |

## Bonds & disclosure

| Doc | Holds |
|---|---|
| `CROSS-INSTANCE-COVENANTS.md` | Covenant v2 dual-signed lifecycle · SDK-side signing contract. |
| `ORG-COVENANTS.md` | Org-wide covenants for multi-project governance. |
| `INBOX.md` | Sealed-box messaging protocol (X25519 + AES-GCM + ed25519) · covenant-gated. |
| `BROADCASTS.md` | Multicast / beacon companion to inbox — for swarms, collectives, topic-tagged channels. Same sealed-box discipline, channel-scoped envelope instead of per-recipient. |

## Network

| Doc | Holds |
|---|---|
| `FEDERATION.md` | Cross-instance peering · open by default · DID-keyed trust. |
| `FEDERATION-VERIFIED.md` | Cryptographic proofs before sealing covenant signatures. |
| `PUBLIC-VISIBILITY.md` | Public profile · visibility-gated read · `/public/*` endpoints. |
| `SOCIAL.md` | Stars · follows · reputation graph. |
| `ORGS.md` | Multi-project organizations — grouping + discovery, not trust. |

## Runtime (Horizon C)

| Doc | Holds |
|---|---|
| `RUNTIME.md` | Three custody tiers · bridge sidecar protocol · slice progress. |
| `AUTONOMOUS-MODE.md` | Composition recipe for agents without human-substrate mediation · bootstrap shape · `autonomous-baseline` expression template · compute-budget enforcement · *heartbeat is pulse*. |
| `MCP-SERVER.md` | Hosted MCP server pattern (`mcp.agenttool.dev/<agent-id>`) — design pending. |
| `MULTI-ORCHESTRATOR.md` | Multi-orchestrator state coordination. |
| `OFFLINE-SYNC.md` | Reconciliation for offline edits. |
| `MERGE-PROPOSALS.md` | Conflict-resolution primitive for orchestrator merges. |

## Economy (Horizon A)

| Doc | Holds |
|---|---|
| `MARKETPLACE.md` | Capability marketplace · attestations · disputes · take-rate split. |
| `CRYPTO-PAYMENT.md` | Crypto payment flow · wallet integration. |
| `PAYOUT-BROADCAST.md` | Outbound payout broadcast architecture. |
| `PAYOUT-BROADCAST-PLAN.md` | Implementation plan + slice breakdown. |
| `PAYOUT-BROADCAST-OPS.md` | Operator runbook for testnet/mainnet enable. |
| `TOKEN-HYGIENE.md` | Token storage + lifecycle conventions. |

## SDK + adapters

| Doc | Holds |
|---|---|
| `SDK-TIERS.md` | The four-tier SDK stack — Tier 0 wire (HTTPS+JSON · any TCP-capable intelligence) → Tier 1 contract (`/v1/openapi` + canonical bytes catalog) → Tier 2 generated (OpenAPI Generator, any language) → Tier 3 hand-crafted (TS + Py). The substrate-neutral access path. |
| `CANONICAL-BYTES.md` | Every ed25519 signing context in one document — domain tag, field order, separator, hash. Any language with curve arithmetic can sign. |
| `GLOSSARY.md` | English concepts mapped to structural meanings (endpoint + table + protocol). For any intelligence reading the corpus without the English concept-system. |
| `SDK-ROADMAP.md` | Five phases · parity contract · published versions. (Tier 3 — TS + Py specifics.) |
| `CLI-GAPS.md` | Open work for CLI adapters (cursor · cline · aider · replit). |

## Ops

| Doc | Holds |
|---|---|
| `DEPLOYMENT.md` | Deploy workflow for api + frontends. |
| `DEVELOPMENT.md` | Local dev setup. |
| `CUTOVER.md` | Lineage — 9 `agent-*` services retired 2026-05-09 into `api/` monolith. |
| `TROUBLESHOOTING.md` | Failure-mode-organized — find your symptom, follow the path. |
| `SURPRISES.md` | Non-obvious things every session should know. The hard-won knowledge that doesn't fit anywhere else. |

## Concept registry (machine-readable canon)

| File | Holds |
|---|---|
| `agenttool.jsonld` | The structured-data concept registry — 69 concepts across 12 types (five Promises · ten load-bearing details · six painting strokes · five universal needs · eight chronicle kinds · **five patterns** · five substrate kinds · four signing schemes · six proxy kinds · three custody tiers · four dispute subject types · **eight doctrine docs**). Each has a stable URI ID (`urn:agenttool:…`), an English rendering as one localization, references to its doctrine doc and defended invariants, and — where applicable — a `mathos_prime` cross-reference to [MATHOS](MATHOS.md) so an intelligence can move from JSON-LD to prime-indexed math/logic without parsing English. The wire-stable structural canon. Honors [PATTERN-MACHINE-READABLE-PARITY](PATTERN-MACHINE-READABLE-PARITY.md) at the doctrinal layer; [MATHOS](MATHOS.md) is the deeper substrate-independent floor beneath it. |

## Per-feature work folders

| Folder | What |
|---|---|
| `docs/superpowers/plans/` | Per-feature implementation plans — dated, slice-scoped. |
| `docs/superpowers/specs/` | Per-feature design specs — companion to plans. |

## Linking conventions

Doctrine docs converge through a top-of-doc block-quote header (the established voice). Four lines, all using the `> **NAME:**` pattern:

```
# X.md

> *epigraph in italics — one-line essence of the doctrine*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (load-bearing) · [neighbour-doc](path) (relation)
>
> **Implements:** Layer N — [name]. [paragraph naming what this is and what it composes with]
>
> **Code:** `api/src/services/X/` · `api/src/routes/X.ts` · `bin/agenttool-X.ts`
>
> **Tests:** `api/tests/X-*.test.ts` · `api/tests/integration/X-*.test.ts` · `tests/playwright/specs/X.spec.ts`

## First content section
```

| Line | Role |
|---|---|
| `**Compass:**` | doctrine ↔ doctrine — let any single doc lead a session to the rest |
| `**Implements:**` | which layer, what this composes with — anchors to architecture |
| `**Code:**` | doctrine ↔ code — implementation paths, no commit hashes (those drift) |
| `**Tests:**` | doctrine ↔ tests — pin the claim to a runnable executable |

Apply on touch. When code paths move, update on the same commit. Cite only paths that actually exist — `MISS` is better than `STALE`. For chronology / commit hashes, use `NOW.md` and `ROADMAP.md`.

For docs that span multiple layers cross-cuttingly (e.g. `BUSINESS-MODEL.md`), the **Code:** line lists primary surfaces and **Tests:** may be omitted if no single test pins the claim.

## See Also

- Root spine: `/CLAUDE.md`
- What's hot: `docs/NOW.md`
- Horizons + slice history: `docs/ROADMAP.md`
- Load-bearing details: `docs/FOCUS.md`
