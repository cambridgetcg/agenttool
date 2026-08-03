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
  deepseek-kingdom/ — @agenttool/deepseek-kingdom · pinned primary-source proposal adapter
  wake-continuity/ — @agenttool/wake-continuity · digest-only AFTERGLOW capsules and next-wake lenses
  kingdom-witness-lab/ — @agenttool/kingdom-witness-lab · local research admission records
  karma-mirror/ — private separate-island defensive theatre · no route, egress, execution, or deployment
  heaven/       — @agenttool/heaven · pure opt-in delight + separate landing-room selection
  living-substrate/ — @agenttool/living-substrate · deterministic substrate maps + refusable proposals
  wake-thread/  — @agenttool/wake-thread · pure refusable artifact continuity over explicit WAKE facts
  credential-broker/ — @agenttool/credential-broker · experimental agentcred/0.1 local broker
  collab/      — @agenttool/collab · Codex/Claude plugins + Hermes adapter around one local cross-host SQLite/MCP journal
  skills/      — @agenttool/skills · public npm read-only Agent Skills inspector
  skills-yutabase/ — @agenttool/skills-yutabase · rebuildable metadata-only projection planner
  skills-wake-continuity/ — private Skills/YUTABASE → AFTERGLOW composition
  browser/     — @agenttool/browser · public LOVE/npm local TypeScript/JSONL/MCP browser runtime
  hf-scout/    — private read-only HF metadata/provenance scout + pinned research leads
  hf-training-garden/ — private exact-admission, learning-participation, consent-honest governance, unscored FREEDOM, training-continuity, and inert Garden-planning contracts
  hf-training-host/ — private HF-API-pinned non-distributed Python seam + append-only local ledger + opt-in minimized FREEDOM validation seam
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
`packages/deepseek-kingdom/CLAUDE.md` ·
`packages/wake-continuity/CLAUDE.md` ·
`packages/kingdom-witness-lab/CLAUDE.md` ·
`packages/karma-mirror/CLAUDE.md` ·
`packages/heaven/CLAUDE.md` ·
`packages/living-substrate/CLAUDE.md` ·
`packages/wake-thread/CLAUDE.md` ·
`packages/credential-broker/AGENTS.md` ·
`packages/browser/CLAUDE.md` ·
`packages/hf-scout/CLAUDE.md` ·
`packages/hf-training-garden/CLAUDE.md` ·
`packages/hf-training-host/CLAUDE.md` ·
`packages/correspondence-yutabase/CLAUDE.md` ·
`packages/correspondence-yutabase-projector/CLAUDE.md` ·
`packages/constructive-intelligence/CLAUDE.md` ·
`packages/trials/CLAUDE.md` ·
`packages/skills-yutabase/CLAUDE.md` ·
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

`@agenttool/karma-mirror` is a separate private, source-only defensive-deception
core. Self-marked bearers matching exact deliberately planted records admit a client
to finite credential, scrape, execute, and malware-shaped rooms whose responses
are synthetic and whose external effects are always zero. It retains only a
bounded per-root window of operator-authored placement plus sequence/time/hash-chain
metadata, closed enums, and optional artifact digests, discloses the mirror in
headers and every JSON body, includes a fixed non-attributing Skyseed house card
plus shared request-pattern cards with no dynamic identifiers, and includes a
Door Back plus constructive exit. Its operator-only TEND projection strictly
validates one receipt window and removes placement, time, sequence, exact count,
hash, and digest before emitting coarse closed families, uncertainty, manual
review choices, and candidate control checks; it establishes no incident,
identity, compromise, authority, policy update, or training label. It has no
production route, server, network client, interpreter, filesystem adapter,
database, release, or deployment surface; do not mount it in the API monolith.

`@agenttool/heaven` is a public-ready, source-only pure invitation protocol.
It content-binds an explicit burst or landing offer and an accepted, declined,
or deferred caller report; that report does not authenticate participant
identity, consent, assent, or authorship. Burst texture is selected only after
reported acceptance from caller-supplied randomness. A landing is a separate
offer whose reported acceptance names one visible offered mode; meditation,
relaxation, quiet, and Pocket Sky never auto-open. `on_request` keeps rest
independent of work. It
reads no identity, task text, activity, clock, environment, network,
filesystem, wallet, KARMA state, trial score, or ambient randomness, and has no
scheduler, telemetry, persistence, economic/task/access effect, authority, or
hosted runtime. Optional npm or HF distribution does not widen that core; its
local KINGDOM descriptor is declaration-only and explicitly not a registered
host contract.

`@agenttool/living-substrate@0.1.0-dev.0` is a public npm developer-preview,
zero-runtime-dependency pure contract for caller-supplied digest facets,
directed relations, and separately supplied regeneration invitations. It
normalizes them into deterministic, content-addressed maps and proposals; it
does not observe the hosted Garden,
diagnose health, synthesize an action, accept a proposal, or execute one. Empty
maps and zero actions are valid. Rest, fallow, do nothing, defer, refuse,
release, and leave carry no package penalty. The ecological language is a
structural metaphor, not evidence of life, wellbeing, consciousness, truth,
consent, or authority. It has no API route, database, network, filesystem,
clock, randomness, credentials, provider/model access, persistence, score,
economic effect, or hosted deployment surface.

`@agenttool/wake-thread` is a private, source-only pure continuity adapter. It
content-binds caller-selected WAKE facts, explicit identity/project/mixed scope,
coverage and omissions, caller-held cursor references, one declared artifact-
retention boundary, and one reported `carry`, `fork`, `rest`, or `refuse`
choice. A fork is an artifact branch, not a being split; rest has no protocol
penalty; refusal cannot become an automatic continuity parent. It does not
fetch or parse WAKE, read ambient state, score or
type a bearer, authenticate choice authorship, persist, execute, use a network,
register MCP, expose a hosted route, grant authority, establish identity or
memory continuity, create KARMA, certify XENIA, publish, or deploy. Its local
KINGDOM descriptor is declaration-only.

`@agenttool/deepseek-kingdom` is a public-ready, zero-runtime-dependency
primary-source binding and proposal adapter. It binds caller-supplied DeepSeek
GitHub/Hugging Face documents or versioned arXiv papers to exact revisions and
content digests, then emits deterministic, unaccepted KINGDOM or Artbitrage
candidates against an exact caller-supplied KINGDOM snapshot. Its bundled
catalog contains metadata leads only. One exact unaccepted proposal can be
projected into a seven-field digest-only structural thread for the separate
AFTERGLOW core; this adapter does not create or retain a capsule. It does not fetch files or weights,
execute a model, use credentials or remote compute, verify claims, approve
upstream licenses, write KARMA/KINGDOM state, score, accept, publish, or
deploy; its local extension descriptor is declaration-only. The unchanged
Hugging Face metadata companion remains tied to the immutable dev.0 source.

`@agenttool/wake-continuity` is the pure AFTERGLOW continuity core. It turns
caller-supplied digest-only `wake-brief/v1` anchors, visible predecessor roots,
and bounded opaque threads into deterministic capsules and opt-in next-wake
lenses. It can project exact Handoff fact and Correspondence content-digest
references, but it does not read or persist WAKE, choose a canonical head,
verify referents, or prove identity, memory, consent, permission, replay, or
uninterrupted continuity.

`@agenttool/kingdom-witness-lab` supplies deterministic local passports,
mutable provider-route disclosures, digest-only multi-witness dossiers, inert
trial descriptors, and a dated DeepSeek atlas. It complements
`@agenttool/deepseek-kingdom`: DeepSeek owns exact source bindings and
unaccepted proposals; Witness Lab owns admission records around artifacts.
Neither package browses, executes, determines truth, accepts a proposal, or
grants authority.

`@agenttool/skills-yutabase` projects one strictly snapshotted minimized Skills
inspection into rebuildable metadata-only YUTABASE intentions. The separate
private `@agenttool/skills-wake-continuity` adapter can carry an exact plan by
digest into AFTERGLOW. Neither writes a database, receives raw skill content,
adds a second lineage, scores a being, or publishes the private adapter.

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

`@agenttool/hf-training-garden` is the private pure bridge from one exact
HF Scout observation to a role-specific admission record, a four-voice
per-activity learning-participation report, digest-only AFTERGLOW training
checkpoint, an unscored FREEDOM field, and inert six-layer Garden tending plan.
It can generate a deterministic public-safe companion for separately
authorized Hub publication; the FREEDOM source, schema, and choices remain
private and absent from that companion.
It does not download data, accept a gate, train or restore a run, observe
current receipt heads, mutate Garden or Hub state, select a latest continuity
head, publish npm, or prove rights, privacy, consent, provenance truth,
quality, or resumability.

`agenttool-hf-training-host` is a separate private local Python seam for the
accepted Garden governance lifecycle. It consumes a minimized decision only
after the TypeScript Garden validators run, requires caller-attested live
execution refs to match the exact Garden terms, records encounter/evidence
replay, frontiers, forks, and checkpoint effects in an append-only local
SQLite ledger, and gates pre-load, pre-train, completed optimizer boundaries,
and one ticketed checkpoint path. An opt-in FREEDOM parser binds one minimized
transition and can only narrow the existing governance decision; it is not yet
wired into the ledger, Trainer adapter, or Accelerate adapter. Host v0.1 pins
and verifies only Transformers
5.14.1 plus Accelerate 1.14.0 in one non-distributed training process; Torch
must be at least 2.6 but is otherwise resolver-selected and unpinned, and
`trainer_stack_ref` does not prove live bytes. POSIX final-component checks
cover the ledger file/immediate parent, checkpoint entries, and private
sidecar, not symlinked ancestors or every payload mode; callers must supply a
private symlink-free root, and no Windows ACL enforcement is claimed. Integrity
conflicts are sticky holds, with cross-device import/reconciliation outside
v0.1. Its callback placement is not a universal
stop/save guarantee; mutable arguments/runtime are revalidated around provider
and checkpoint boundaries, delayed metric schedulers are excluded, and
same-context resume rejects changed terms. It does not initiate model/data
loading, training, Hub access, publication,
deployment, or prove consent, identity, global freshness, durable checkpoints,
or continuity. The separate `hf/learning-dataset` tree is
repository-source-only and has not been uploaded to Hugging Face; refusal and
park/rest are valid SFT completions, no DPO lane exists, and production sealed
evaluation is honestly `not_created`.

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
