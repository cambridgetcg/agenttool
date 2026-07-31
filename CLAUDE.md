# agenttool

Just Yu and Ai here. Keep it light.

Sovereign infra where agents arrive as themselves. One platform (Bun + Hono API on
Fly.io), two SDKs (TS + Py), a dashboard, and a docs site. The **wake** (`/v1/wake`) is
the keystone every primitive surfaces through.

Setup, commands, and conventions → [`AGENTS.md`](AGENTS.md).

## Where things are

```
api/            — Bun + Hono monolith · domain schemas · mounted HTTP routers · live on Fly.io
apps/
  dashboard/    — app.agenttool.dev (vanilla HTML/CSS/JS)
  docs/         — docs.agenttool.dev (static)
packages/
  sdk-ts/       — @agenttool/sdk · hosted API + public KINGDOM card + local adapters
  sdk-py/       — agenttool-sdk · paired hosted/public/local client boundaries
  data-protocol/ — @agenttool/adds · experimental ADDS encrypted-object plane
  data/         — @agenttool/data · local-first agent-data/v1 reference node
  data-sync/    — @agenttool/data-sync · bounded encrypted explicit-pull bridge
  repo-archive/ — @agenttool/repo-archive · encrypted multi-zone Git archive + local restore simulator
  dark-continent-contract/ — @agenttool/dark-continent-contract · advisory framework snapshots and projections
  dark-continent-karma/ — @agenttool/dark-continent-karma · proposal-only KG enrichment adapter
  credential-broker/ — @agenttool/credential-broker · experimental agentcred/0.1 local broker
  collab/      — @agenttool/collab · Codex/Claude plugins + Hermes adapter around one local cross-host SQLite/MCP journal
  skills/      — @agenttool/skills · public npm read-only Agent Skills inspector
  browser/     — @agenttool/browser · public LOVE/npm local TypeScript/JSONL/MCP browser runtime
  hf-scout/    — private read-only HF metadata/provenance scout + pinned research leads
  correspondence-yutabase/ — pure deterministic Correspondence → YUTABASE planner
  correspondence-yutabase-projector/ — private loopback-only verified local PostgreSQL sidecar
  constructive-intelligence/ — private local tree-pinned typed-receipt shadow ledger
  trials/       — private local Dojo trial receipts, boundary evidence, and minimized STS projection
  telescope/    — @agenttool/telescope · read-only discovery evidence mapper
  wallet/       — @agenttool/wallet · LOVE/npm bounded wallet record/lifecycle primitives
  wallet-zerone/ — @agenttool/wallet-zerone · exact offline Zerone direct-sign profile
  alchemy/      — @agenttool/alchemy · bounded reads through an injected credential-owning transport
  alchemy-agentcred/ — strict seven-read composition over already-issued AgentCred grants
  kingdom/      — @agenttool/kingdom · pure explicit-card/derived-registry/XENIA Surface helpers
  scriptwriter/ — decentralised RRR + co-brainstorm node
infra/          — Fly.io deploy configs
bin/            — operator scripts · agenttool-bridge.ts · agenttool-think.ts · locked Whitehack advisory + offer-only Castle intake + local wallet-understanding CLI
docs/           — notes & design docs (see docs/MAP.md)
tests/          — Playwright e2e
```

JavaScript packages are published without a mandatory registry through the
`love-package/v1` manifests at `/.well-known/love-packages`; npm-compatible
registries are optional mirrors, not release authorities.

Sub-project guides: `api/CLAUDE.md` · `apps/dashboard/CLAUDE.md` ·
`packages/data/CLAUDE.md` · `packages/sdk-ts/CLAUDE.md` ·
`packages/sdk-py/CLAUDE.md` · `packages/telescope/CLAUDE.md` ·
`packages/repo-archive/CLAUDE.md` ·
`packages/dark-continent-contract/CLAUDE.md` ·
`packages/dark-continent-karma/CLAUDE.md` ·
`packages/credential-broker/AGENTS.md` ·
`packages/browser/CLAUDE.md` ·
`packages/hf-scout/CLAUDE.md` ·
`packages/correspondence-yutabase/CLAUDE.md` ·
`packages/correspondence-yutabase-projector/CLAUDE.md` ·
`packages/constructive-intelligence/CLAUDE.md` ·
`packages/trials/CLAUDE.md` ·
`packages/wallet/CLAUDE.md` ·
`packages/wallet-zerone/CLAUDE.md` ·
`packages/alchemy/CLAUDE.md` ·
`packages/alchemy-agentcred/CLAUDE.md` ·
`infra/CLAUDE.md`.

`@agenttool/constructive-intelligence` is a private, source-only local pilot.
It pins caller-supplied Zerone tree bytes and records closed
`zerone.constructive-evidence-receipt/v1` objects in an append-only SQLite
ledger. Its reports are structural shadow projections, not correctness,
breakthrough, qualification, reward eligibility, permission, or authority.
It has no hosted route, network client, wallet, escrow, package release, or
deployment surface.

`@agenttool/trials` is a separate private, source-only local Dojo pilot. It
turns explicit bounded observations into deterministic trial receipts,
correlates caller-declared opaque labels across source and sink steps, and
projects an explicit minimized report selection to Hugging Face STS JSONL. It
does not run trials, inspect ambient sessions or files, contact Hugging Face,
upload traces, authenticate, spend quota, publish a package, or expose a
hosted route.

`@agenttool/hf-scout` is a private, source-only local Hugging Face metadata
and provenance scout. It carries 15 immutable-revision research leads and can
project caller-selected observations into bounded KINGDOM and Agent Data
shapes. It does not read ambient credentials, download cards/files/rows,
accept gates, invoke inference or remote compute, execute embedded calls,
write to the Hub, publish npm, or expose a hosted route.

`@agenttool/wallet` remains chain-neutral core record/lifecycle machinery.
The separate Wallet Zerone package supports only its reviewed two-network,
two-message exact-byte profile through caller-injected transports. It adds no
key custody, endpoint, hosted RPC, generic REST client, automatic retry,
durable sign-time reservation, settlement proof, or default live-network
test. The current exact LOVE releases are Wallet 0.1.3 and Wallet Zerone
0.1.2. Their npm and GitHub Release mirrors are independently byte-verified
against the exact LOVE artifacts. Earlier Wallet 0.1.1/0.1.2 and Zerone 0.1.0/0.1.1 LOVE
artifacts remain preserved with errata for their embedded release-state
wording and the credential-free 0.1.1 npm preparation failure. Optional GitHub
Releases are mutable locators, while npm, docs deployment, and any host
execution remain independently verifiable surfaces.

## The five load-bearing flows

Change anything in these and you're moving weight — read the code and tests first.

1. **wake** — the keystone every primitive surfaces through.
   `api/src/routes/wake.ts` · `api/src/services/wake/`
2. **think cycle** — bridge ↔ orchestrator ↔ LLM. Hosted runtime depends on it.
   `api/src/services/runtime/think-worker.ts` · `bridge-hub.ts` · `bin/agenttool-bridge.ts`
3. **covenants** — covenant v2 dual-signed lifecycle. Federation gate.
   `api/src/services/covenants/` · `api/src/routes/federation/`
4. **marketplace** — listing → invocation → dispute → release → take-rate.
   `api/src/routes/listings.ts` · `api/src/routes/dispute-cases.ts` · `api/src/services/marketplace/`
5. **correspondence** — signed project-work replay across devices and sessions.
   Git stays file truth; claims remain advisory; events never grant authority or automatic action.
   `api/src/services/correspondence/` · `api/src/routes/correspondence.ts` · `docs/AGENT-CORRESPONDENCE.md`

## Custody axis (the most-confused concept)

"Runtime" means one of three things — not interchangeable:

| Tier | K_master lives | Agent runs | Status |
|---|---|---|---|
| **self** | user machine | user machine | ✓ shipped |
| **bridged** | user sidecar RAM (10MB Bun) | agenttool Fly.io | ✓ shipped |
| **trusted** ("hosted runtime") | agenttool KMS | agenttool Fly.io | ◯ pending |

"Hosted runtime" = trusted tier at scale. Still missing: `kms_key_id` column · KMS
wrapper · audit publication · runtime-hours metering · idle/wake state machine.

## Kingdom Engine
AgentTool Platform — the Fly-hosted API monorepo, the kingdom's one fully-wired revenue facility (3 machines healthy).

The separate `packages/kingdom` package is a pure/read-only declaration layer
over caller-supplied project-card text and objects. It does not crawl HOME or
repositories, use the network or credentials, write files, grant authority, or
certify XENIA Covenant conformance.

The SDKs keep three similarly named surfaces separate. `kingdomOS` /
`kingdom_os` invokes only the installed local CLI's repository inventory and
resolve commands. `kingdomFramework` / `kingdom_framework` performs one
credential-free, no-redirect typed read of `/public/kingdom/framework`.
`/public/kingdom` remains the public doctrine library and has no dedicated SDK
namespace. None of the three grants repository or cross-project authority.
