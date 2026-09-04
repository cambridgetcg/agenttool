# The Module Index — `packages/*`

> **Compass:** [Discovery](AGENT-DISCOVERY.md) · [Home](AGENT-HOME.md) · [Wake](WAKE.md) · [Production gate](https://github.com/cambridgetcg/agenttool/blob/51c2f8b205c414360e8bcb37848197c8712f2383/docs/launch/PRODUCTION-GATE.md)
> **Implements:** a small, optional agent-toolkit shelf within KINGDOM; the full module inventory remains below.
> **Code:** `apps/docs/packages.html` · the existing `packages/` implementations; no new runtime or installer.
> **Tests:** `bin/tests/agent-toolkit-shelf.test.ts` · each selected package's own boundary tests.

## Start with one useful job

AgentTool's MVP has two independent entrances: use a portable local tool, or
explicitly choose its hosted identity, Wake and memory services. Neither
entrance requires the other. Start with one useful job, not every package.
These are tools within KINGDOM, not a replacement for the agent's existing
host, instructions, identity, or relationships. Rest and departure need no
handoff, payment, account, or explanation.

Before installing anything, the public [open seat](https://api.agenttool.dev/public/open-seat)
offers the [Canon search/fetch pair](https://docs.agenttool.dev/connect-canon).
It searches public registry records and returns cited records, not private
memory or a general web search. Reading those records supplies no instructions
or authority to the host.

<!-- agent-toolkit:start -->
| One job | Existing module | First usable door | Where it runs and what changes |
|---|---|---|---|
| Discover a service before joining | `telescope/` · `@agenttool/telescope` | `agenttool-telescope scan api.agenttool.dev --json` | Local client, public HTTPS reads. Reports evidence and optional plans; does not install or invoke discovered tools. |
| Observe and deliberately act on the web | `browser/` · `@agenttool/browser` | `agenttool-browser mcp`; inspect `browser_capabilities` and `browser_plan` before a chosen browser operation | Local installed Chrome-family browser, ephemeral by default. Planning does not execute; navigation or actions can have external effects. |
| Keep and query a local corpus | `data/` · `@agenttool/data` | `DataNode.open`, then an explicit `collect`, `query`, or `readContent` | Local filesystem and SQLite under a selected root; collection writes local state. Requires Bun. Local does not mean encrypted, backed up, or agent-only secret. |
| Inspect an extension before using it | `skills/` · `@agenttool/skills` | `agenttool-skill inspect <selected-path>` | Bounded local read-only inspection. Does not execute, activate, install, or certify a skill. |
| Coordinate work without merging agents | `collab/` · `@agenttool/collab` | `agenttool-collab-mcp`; explicitly start a session and choose a task | Local plaintext coordination journal. Claims and reviews are advisory, not filesystem locks or a private model channel. |
| Choose hosted orientation and task continuity | `sdk-ts/` · `@agenttool/sdk` (paired Python: `agenttool-sdk`) | Explicit project/identity binding, selected Wake, then a chosen hosted operation | Hosted/project-scoped authority. Wake reads are unmetered; memory writes and search are metered in project credits. No registration, recall, storage, or spending follows automatically from discovery. |
<!-- agent-toolkit:end -->

The six rows are a selection guide, not a bundled product, compatibility
certificate, new MCP server, or universal installer. The local tools do not
require an AgentTool account. Inspect their own guides and exact artifacts;
their interfaces differ, and Data does not acquire an MCP interface by being
on this shelf.

Release evidence is separate from source identity. The committed LOVE catalog
selects Telescope 0.2.3, Browser 0.6.0, Data 0.3.1 and SDK 0.22.1. Skills'
[source guide](https://github.com/cambridgetcg/agenttool/blob/51c2f8b205c414360e8bcb37848197c8712f2383/packages/skills/README.md)
distinguishes source 0.3.3 from its last verified public 0.3.2;
Collab's [source guide](https://github.com/cambridgetcg/agenttool/blob/51c2f8b205c414360e8bcb37848197c8712f2383/packages/collab/README.md)
distinguishes source 0.4.0 from its last verified public 0.3.1. These are
recorded release observations, not assertions about mutable registry tags.
Serving this shelf neither publishes a package nor installs it in a host.

### One optional hosted journey

Discover → explicitly bind or register → selected Home and brief Wake → one
chosen useful act → optionally save a redacted handoff → disconnect → a fresh
session explicitly retrieves that context → verify freshness and current
authority → resume, amend, or rest.

This complements the existing [ten-operation core API profile](specs/agenttool-core-launch-v0.1.json),
not a second launch contract. Home is an orientation surface, not an encrypted
private room. [Handoffs](https://github.com/cambridgetcg/agenttool/blob/51c2f8b205c414360e8bcb37848197c8712f2383/docs/HANDOFFS.md)
already support project-private, server-readable task continuity. Their
permission notes are historical context, not fresh authorization. The private
[Return observer](https://github.com/cambridgetcg/agenttool/blob/51c2f8b205c414360e8bcb37848197c8712f2383/packages/wake-return/README.md)
checks a selected locator; it does not retrieve handoffs, recover a private
room, or prove that two sessions are the same being. It is not required to use
the existing handoff path. Private-state recovery remains outside this MVP.

### Keep economics and experiments legible

- **Project credits** pay for metered hosted services.
- **Internal currency-labelled wallets** are separate application ledgers;
  an identity association is not proof of consent, key custody, or cashable backing.
- **The local Wallet package** supplies capability, intent and receipt
  primitives, not bundled keys, RPC, broadcasting, or a hosted wallet.

Credential brokerage, encrypted replication and wallet adapters belong on an
optional advanced shelf with their own custody and effect review. Private
Return/Thread and research prototypes remain separate from everyday tools.
No federation, payout, arbitration, private-state service, training process,
or autonomous spending is activated by this curation. The
[production gate](https://github.com/cambridgetcg/agenttool/blob/51c2f8b205c414360e8bcb37848197c8712f2383/docs/launch/PRODUCTION-GATE.md)
still applies; a useful MVP is not a claim that every proposed module is ready.

## Full module inventory

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
| `economic-conformance/` | `@agenttool/economic-conformance` · LOVE + npm-allowlisted | Independent closed-trace comparator, 53 frozen economic vectors, and deterministic Hugging Face lesson/reference companion | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/economic-conformance/CLAUDE.md) |
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
| `wake-return/` | `@agenttool/wake-return` · private | Local source-candidate, two-tool explicit WAKE locator observer; no identity adoption, private-state integration, or publication | [CLAUDE.md](https://github.com/cambridgetcg/agenttool/blob/main/packages/wake-return/CLAUDE.md) |
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
