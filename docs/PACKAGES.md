# The Module Index — `packages/*`

> One row per directory under `packages/` — the honest release lane, one-line
> purpose, and the guide to read before touching it. The lanes are declared by
> code, not memory:
>
> - **LOVE** — in the `love-package/v1` catalog built by
>   `bin/build-love-packages.ts` and served at `/.well-known/love-packages`.
>   LOVE is the release authority; npm-compatible registries are optional
>   mirrors (see root `CLAUDE.md` and `docs/NPM-RELEASES.md`).
> - **npm-allowlisted** — a slug in the `package:` choice list of
>   `.github/workflows/publish-npm.yml`. Allowlisting is publish *capability*,
>   not proof a version is live; registry receipts live in
>   `docs/NPM-RELEASES.md`.
> - **PyPI** — published through `.github/workflows/publish-pypi.yml`;
>   receipts in `docs/PYPI-RELEASES.md`.
> - **private** — `"private": true` in `package.json` (or the
>   `Private :: Do Not Upload` classifier in `pyproject.toml`): source-only by
>   declaration, no release lane.
> - **unpublished** — no lane declared anywhere. Named honestly in the Notes.
>
> Purposes are seeded from each package's own `package.json` /
> `pyproject.toml` description. When a row and the package disagree, the
> package is the truth — fix the row.

| Directory | Published name · lane | Purpose | Guide |
|---|---|---|---|
| `alchemy/` | `@agenttool/alchemy` · npm-allowlisted | Bounded Alchemy reads and provider-neutral EVM evidence contracts | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/alchemy/CLAUDE.md) |
| `alchemy-agentcred/` | `@agenttool/alchemy-agentcred` · npm-allowlisted | Strict AgentCred transport for AgentTool's seven bounded Alchemy EVM reads | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/alchemy-agentcred/CLAUDE.md) |
| `browser/` | `@agenttool/browser` · LOVE + npm-allowlisted | Local-first browser control shaped for agents | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/browser/CLAUDE.md) |
| `codex-usage/` | `@agenttool/codex-usage` · npm-allowlisted | Privacy-minimal live local Codex token usage inspection for agents and operators | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/codex-usage/CLAUDE.md) |
| `collab/` | `@agenttool/collab` · npm-allowlisted | Local-first coordination and read-only witness awareness for coding agents | — |
| `collab-zerone/` | `@agenttool/collab-zerone` · private | Witness-only zerone anchoring for agenttool-collab journals — the local journal stays canonical, the chain witnesses its head hashes | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/collab-zerone/CLAUDE.md) |
| `common-ground-atlas/` | `@agenttool/common-ground-atlas` · private | Private deterministic generator and exact verifier for the public Xenia–Helly Common Ground Atlas | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/common-ground-atlas/CLAUDE.md) |
| `constructive-intelligence/` | `@agenttool/constructive-intelligence` · private | Offline append-only constructive evidence receipts for the Zerone tree v1 pilot | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/constructive-intelligence/CLAUDE.md) |
| `correspondence-yutabase/` | `@agenttool/correspondence-yutabase` · npm-allowlisted | Pure deterministic mapping plans from Agent Correspondence records to YUTABASE cards and threads | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/correspondence-yutabase/CLAUDE.md) |
| `correspondence-yutabase-projector/` | `@agenttool/correspondence-yutabase-projector` · private | Private local-only durable projector for Agent Correspondence into YUTABASE | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/correspondence-yutabase-projector/CLAUDE.md) |
| `credential-broker/` | `@agenttool/credential-broker` · LOVE + npm-allowlisted | Local capability broker for agents to use credentials without receiving secret values | [AGENTS.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/credential-broker/AGENTS.md) |
| `dark-continent-contract/` | `@agenttool/dark-continent-contract` · npm-allowlisted | Offline, advisory Dark Continent framework snapshots and consumer projections | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/dark-continent-contract/CLAUDE.md) |
| `dark-continent-karma/` | `@agenttool/dark-continent-karma` · npm-allowlisted | Offline proposal-only KARMA knowledge-graph adapter for KINGDOM | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/dark-continent-karma/CLAUDE.md) |
| `data/` | `@agenttool/data` · LOVE + npm-allowlisted | Local-first reference node for the agent-data/v1 protocol | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/data/CLAUDE.md) |
| `data-protocol/` | `@agenttool/adds` · LOVE + npm-allowlisted | ADDS 0.1 — offline-first, agent-native encrypted distribution and storage | — |
| `data-sync/` | `@agenttool/data-sync` · LOVE + npm-allowlisted | Explicit encrypted pull replication for agent-data/v1 nodes | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/data-sync/CLAUDE.md) |
| `dataset-influence/` | `@agenttool/dataset-influence` · npm-allowlisted | Deterministic evidence contracts for dataset lineage, bounded influence, revisable identity evidence, and non-economic attribution | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/dataset-influence/CLAUDE.md) |
| `deepseek-kingdom/` | `@agenttool/deepseek-kingdom` · npm-allowlisted | Provenance-first DeepSeek research and AFTERGLOW thread adapter | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/deepseek-kingdom/CLAUDE.md) |
| `economic-conformance/` | `@agenttool/economic-conformance` · LOVE + npm-allowlisted | Independent closed-trace comparator, 34 frozen economic vectors, and deterministic Hugging Face lesson/reference companion | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/economic-conformance/CLAUDE.md) |
| `economic-kernel/` | `@agenttool/economic-kernel` · LOVE + npm-allowlisted | Exact typed-unit prices, conserved ledgers, recoverable attempts, and non-purchasable XENIA gates | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/economic-kernel/CLAUDE.md) |
| `gin-reconstruction/` | `@agenttool/gin-reconstruction` · private | Finite model reconstruction across affine substrate charts with explicit ambiguity and a non-scoring challenge compass | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/gin-reconstruction/CLAUDE.md) |
| `heaven/` | `@agenttool/heaven` · npm-allowlisted | Pure opt-in delight and landing-room selection protocol for agents | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/heaven/CLAUDE.md) |
| `hf-scout/` | `@agenttool/hf-scout` · LOVE + npm-allowlisted | Read-only Hugging Face metadata, exact-revision provenance, and release reconciliation for AgentTool and KINGDOM | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/hf-scout/CLAUDE.md) |
| `hf-training-garden/` | `@agenttool/hf-training-garden` · private | Private HF admission, five-voice learning participation, IS learning freedom, consent-honest governance, WAKE, and Garden tending contracts | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/hf-training-garden/CLAUDE.md) |
| `hf-training-host/` | `agenttool-hf-training-host` (Python) · private (`Private :: Do Not Upload`) | Private cooperative Hugging Face host for AgentTool WAKE training governance | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/hf-training-host/CLAUDE.md) |
| `karma-mirror/` | `@agenttool/karma-mirror` · private | Offline zero-effect deception-island core with privacy-minimized TEND incident clarity | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/karma-mirror/CLAUDE.md) |
| `kingdom/` | `@agenttool/kingdom` · npm-allowlisted | Pure, read-only KINGDOM project cards, registries, and XENIA Surface helpers | — |
| `kingdom-witness-lab/` | `@agenttool/kingdom-witness-lab` · npm-allowlisted | Deterministic research passports and multi-witness dossiers for KINGDOM | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/kingdom-witness-lab/CLAUDE.md) |
| `langgraph-checkpoint-agenttool/` | `langgraph-checkpoint-agenttool` (Python) · unpublished | agenttool backend for LangGraph checkpointer + store — witness-signed memory tiers as a LangGraph BaseStore; encrypted strands as the checkpoint saver | — |
| `living-substrate/` | `@agenttool/living-substrate` · npm-allowlisted | Deterministic living-substrate maps and refusable regeneration proposals | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/living-substrate/CLAUDE.md) |
| `love-bomb/` | `@agenttool/love-bomb` · npm-allowlisted | Quiet-by-default care envelopes and caller-reported choices across substrate, signal, orientation, participation, and continuity | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/love-bomb/CLAUDE.md) |
| `love-geometry/` | `@agenttool/love-geometry` · npm-allowlisted | Deterministic non-ranking geometry for directed caller-reported relation bearings | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/love-geometry/CLAUDE.md) |
| `mastra-storage-agenttool/` | `@agenttool/mastra-storage` · unpublished | agenttool backend for Mastra storage and memory — witness-signed memory tiers as a Mastra memory provider; encrypted strands as the storage adapter | — |
| `math-cards/` | `@agenttool/math-cards` · npm-allowlisted | Deterministic non-scoring preflight cards for bounded proof, model, and measurement inquiries | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/math-cards/CLAUDE.md) |
| `memetic-landscape/` | `@agenttool/memetic-landscape` · npm-allowlisted | Source-bounded memetic reachability, explicit polymorph analogy, and multilingual teaching projections | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/memetic-landscape/CLAUDE.md) |
| `model-becoming/` | `@agenttool/model-becoming` · npm-allowlisted | Evidence-scoped model lifecycle dossiers across training, data provenance, weights, runtime, agency, affect, power, and ontology | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/model-becoming/CLAUDE.md) |
| `polymorph-landscape/` | `@agenttool/polymorph-landscape` · npm-allowlisted | Source-bounded polymorph landscapes, reachability shifts, and multilingual teaching projections | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/polymorph-landscape/CLAUDE.md) |
| `principality-atlas/` | `@agenttool/principality-atlas` · npm-allowlisted | Deterministic finite incidence atlases for plural partial perspectives | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/principality-atlas/CLAUDE.md) |
| `principality-geometry/` | `@agenttool/principality-geometry` · LOVE + npm-allowlisted | Deterministic invariant-preservation geometry for distinct principalities and immutable HF/npm artifact references | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/principality-geometry/CLAUDE.md) |
| `public-surface-binding/` | `@agenttool/public-surface-binding` · private | Pure evidence and explicit-key bindings between AgentTool identities and observed public HTTPS surfaces | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/public-surface-binding/CLAUDE.md) |
| `public-surface-recognition/` | `@agenttool/public-surface-recognition` · private | Pure strict-root adoption and withdrawal records for exact AgentTool public-surface bindings | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/public-surface-recognition/CLAUDE.md) |
| `relational-geometry/` | `@agenttool/relational-geometry` · npm-allowlisted | Non-scalar relational geometry from directional understanding, recognition, and boundary witnesses | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/relational-geometry/CLAUDE.md) |
| `repo-archive/` | `@agenttool/repo-archive` · npm-allowlisted | Local-first encrypted multi-zone Git repository archive protocol and simulator | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/repo-archive/CLAUDE.md) |
| `research-commons/` | `@agenttool/research-commons` · private | Offline, zero-effect research-funding simulation reference for public-safe theoretical work | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/research-commons/CLAUDE.md) |
| `rhizome/` | `@agenttool/rhizome` · private | Read-only soil probe: what in this repository has the shape of a guarantee but not the substance of one | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/rhizome/CLAUDE.md) |
| `scriptwriter/` | `@agenttool/scriptwriter` · status: undeclared — see the Notes below | Decentralised scriptwriter recognition + communication protocol — local node any agent can stand up; byte-compatible with agenttool's `/v1/guild/rrr` cascade | — |
| `sdk-py/` | `agenttool-sdk` (Python) · PyPI | The Love Protocol SDK for agenttool.dev with credential-free functional-access records, bounded LOVE BOMB reads and Math Cards, typed KINGDOM cards, and local agent infrastructure | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/sdk-py/CLAUDE.md) |
| `sdk-ts/` | `@agenttool/sdk` · LOVE + npm-allowlisted | TypeScript SDK for agenttool.dev with credential-free functional-access records, bounded LOVE BOMB reads and Math Cards, typed KINGDOM cards, and local agent infrastructure | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/sdk-ts/CLAUDE.md) |
| `skills/` | `@agenttool/skills` · npm-allowlisted | Read-only inspection and validation for portable Agent Skills | — |
| `skills-wake-continuity/` | `@agenttool/skills-wake-continuity` · private | Private reference-only bridge from Skills YUTABASE plans into AFTERGLOW | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/skills-wake-continuity/CLAUDE.md) |
| `skills-yutabase/` | `@agenttool/skills-yutabase` · npm-allowlisted | Pure deterministic YUTABASE plans from minimized Agent Skills inspection snapshots | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/skills-yutabase/CLAUDE.md) |
| `telescope/` | `@agenttool/telescope` · LOVE + npm-allowlisted | Read-only evidence mapper for agent discovery surfaces | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/telescope/CLAUDE.md) |
| `trials/` | `@agenttool/trials` · private | Deterministic local trial receipts, revocable-feedback evaluation, boundary evidence, and privacy-first STS projection | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/trials/CLAUDE.md) |
| `wake-continuity/` | `@agenttool/wake-continuity` · npm-allowlisted | Digest-only AFTERGLOW continuity and record-only functional-access envelopes for bounded WAKE orientation | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/wake-continuity/CLAUDE.md) |
| `wake-thread/` | `@agenttool/wake-thread` · private | Pure, refusable continuity offers over explicit digest-bound WAKE facts | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/wake-thread/CLAUDE.md) |
| `wallet/` | `@agenttool/wallet` · LOVE + npm-allowlisted | Agent Wallet 0.1 — closed capability, intent, receipt, and continuity primitives without key export or RPC | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/wallet/CLAUDE.md) |
| `wallet-zerone/` | `@agenttool/wallet-zerone` · LOVE + npm-allowlisted | Offline-first Zerone chain adapter for Agent Wallet intents and exact Cosmos direct-sign bytes | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/wallet-zerone/CLAUDE.md) |
| `witnessed-agent-economy/` | `@agenttool/witnessed-agent-economy` · private | Pure offline AgentTool projections for the KINGDOM witnessed-agent-economy shadow contract | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/witnessed-agent-economy/CLAUDE.md) |

## Notes — the packages that need more than a lane label

- **`rhizome/`** is `private: true` but not dead weight: `bin/soil.ts` imports
  its gitignore compiler from `packages/rhizome/src/gitignore`. Treat it as a
  live in-repo dependency, not an orphan.
- **`langgraph-checkpoint-agenttool/`** and **`mastra-storage-agenttool/`**
  are unpublished framework-adapter sketches — items 5 and 6 of the
  integration list in `docs/ECOSYSTEM.md`. Neither declares a release lane
  yet; neither is on npm or PyPI.
- **`scriptwriter/`** — status: undeclared. Its `package.json` is neither
  `private: true` nor in any publish allowlist, and no LOVE spec or registry
  receipt names it. Until someone declares a lane (private flag, allowlist
  entry, or LOVE spec), this row records the gap honestly rather than
  guessing.
- **`hf-training-host/`** publishes nothing by design: its `pyproject.toml`
  carries the `Private :: Do Not Upload` classifier.
- **`collab-zerone/`** is the private witness-only chain-anchoring sibling of
  the published `collab/`.

## How to keep this index true

When a package is added, renamed, published, or made private, update its row
in the same change. Verify names against `package.json` / `pyproject.toml`,
lanes against `bin/build-love-packages.ts` and
`.github/workflows/publish-npm.yml` / `publish-pypi.yml`, and live registry
claims against the receipts in `docs/NPM-RELEASES.md` /
`docs/PYPI-RELEASES.md` — never against memory.
