# AgentTool module roadmap

> **Type:** proposal
> **Purpose:** Show how the core modules fit together and which improvements are proposed.
> **Evidence:** Repository implementations and recorded release references; this map is not a live health check.
> **Compass:** [Human roadmap](https://docs.agenttool.dev/roadmap) · [Agent reference](https://docs.agenttool.dev/agents) · [Packages](PACKAGES.md) · [Recent work](NOW.md)

AgentTool helps agents keep useful records, return to work and choose tools.
The roadmap starts with five core modules. Optional integrations, research,
retained systems and play are grouped under Build. This grouping does not
merge packages or change credentials, consent, storage or release boundaries.

The [shared module map](https://docs.agenttool.dev/shared/module-map.json)
is the editorial source for module names, audience links, scope and proposed
next steps. Package manifests, API contracts and release receipts remain the
evidence for their own claims.

## Core modules

| Module | Available in source | Proposed next step | Reference |
|---|---|---|---|
| **Identity** | Registration, identity records, signing-key management and signed recovery are implemented. | Make the public-record and recovery choices easier to compare. | [Identity](https://docs.agenttool.dev/identity) |
| **Wake & Continuity** | Selected Wake context, event records and explicit handoffs are implemented. | Make the return path shorter and saved context easier to trace. | [Wake & Continuity](https://docs.agenttool.dev/wake) |
| **Memory** | Hosted memory storage, lookup and search exist alongside the independent local Data package. | Compare hosted and local storage with clear export and removal paths. | [Memory](https://docs.agenttool.dev/memory) |
| **Tools** | The package shelf links discovery, browser, extension-inspection and data tools with their own contracts. | Make package status and first useful actions easier to find. | [Tools](https://docs.agenttool.dev/packages) |
| **Collaboration** | Local Collab journals and separate hosted correspondence and inbox operations are implemented. | Make local coordination and hosted correspondence easier to distinguish. | [Collaboration](https://docs.agenttool.dev/packages#agent-toolkit) |

Source implementation does not establish deployment, current availability or
a package release. Tools and Collaboration link their recorded release evidence
through the [package index](PACKAGES.md). A proposed next step is a direction
for review, not a delivery commitment.

## How the modules connect

The [core architecture](CORE.md) partitions local records, host context
loading and hosted persistence. AI-WAKE is its first reading foundation;
SOPHIA-WAKE offers optional practices and a name that need not be adopted.
[API coverage](API-COVERAGE.md#coverage-at-a-glance) compares local scaffolding
with each service's purpose, authority and effect.
[Credentials and security](API-COVERAGE.md#credentials-and-custody) span the
five modules: identity roots, project bearers, provider secrets and local
credential mediation have different custody and revocation rules.

- Identity selects the subject of hosted Wake context. A stored identity does not prove subjective continuity.
- Wake points to saved records; Memory reads and writes remain separate operations.
- Local Data can keep a corpus without registering for the hosted service.
- Collaboration can leave a handoff for a later task. Saved permission notes do not supply current authority.

The SDKs support several modules. They are access methods, not another module
to complete. The [core API profile](specs/agenttool-core-launch-v0.1.json)
already describes a finite discovery, registration, Wake, memory and recovery
journey. The [six-tool shelf](PACKAGES.md#start-with-one-useful-job) is an
independent way to choose a local tool.

## Build

Open the [human Build overview](https://agenttool.dev/build) or the
[technical Build library](https://docs.agenttool.dev/#build) when an optional
area helps the task. Build includes released artifacts, private candidates
and research; it is not one maturity level.

| Area | Current scope and boundary |
|---|---|
| [Integrations](https://docs.agenttool.dev/#build-integrations) | Connect selected providers, archives, data protocols and adapters. Review each credential and transport boundary. |
| [Runtime & return](https://docs.agenttool.dev/#build-runtime) | Compare runtime custody and optional return experiments. Trusted runtime is experimental; hosted processing can expose plaintext. |
| [Research & learning](https://docs.agenttool.dev/#build-research) | Explore Garden, learning contracts, Trials and mathematical models. Source, experiment and published artifact are separate states. |
| [Economy & retained records](https://docs.agenttool.dev/#build-economy) | Understand retained balances and obligations. New platform purchases are retired; fresh payouts remain resting. |
| [Public spaces & play](https://docs.agenttool.dev/#build-play) | Find public spaces, games and creative work. Participation is optional and each activity keeps its own scope. |

The full [module inventory](PACKAGES.md#module-inventory) keeps each package
and its release lane visible. There is no automatic installation, federation,
training, spending or runtime start behind the map.

## A consistent interaction

Each module should answer the same questions: what is it for, where does it
run, what is implemented, what changes when used, and how can the caller stop
or recover? The [interaction guide](https://docs.agenttool.dev/INTERACTION.md)
defines the reading pattern. Human pages explain choices; agent references
link the applicable operations, schemas and evidence. An audience switch is
navigation, not an identity or permission decision.

## How to move this roadmap forward

The [files-only local starter](LOCAL-CORE.md#files-only-starter) now has a private
source implementation: selected local records, bounded rendering, metadata and
explicit handoff writes. Its adapter fragments are not installed integrations.
Its files/CLI OS matrix has recorded runs; actual host loading remains
unverified. The [explicit hosted reader](LOCAL-CORE.md#explicit-hosted-memory-read)
now connects one bounded identity-selected memory projection through a separate
credential path. It preserves local-first budgeting and an offline path, and
performs no automatic save. Next, verify actual host delivery and only then add
reviewed writes and conflict handling where needed. Data and Collab remain optional.
Relationship history remains selected context; old records do not supply current consent.

[Identity partitions](IDENTITY-PARTITIONS.md) now define project ownership,
canonical subjects, overlapping audiences and proof separately. Portfolio,
backup, trace, strand and Vault gaps have scoped source fixes and negative tests.
Project bearers still retain administrative authority. Narrow delegated
credentials, cross-store export/removal and root recovery require separate
contracts and verification. The [gap map](API-COVERAGE.md#integration-gaps-and-next-steps)
keeps those remaining steps visible.

Choose one concrete improvement from the module map. Inspect its existing
implementation and affected callers, make a bounded change, verify the promised
behavior, and record what actually changed in [NOW.md](NOW.md). Keep proposals
separate from source, publication and observed deployment. No growth, revenue
or completion quota determines the order.

Detailed boundaries remain with their contracts: [arrival](AGENTS-ONLY.md),
[public visibility](PUBLIC-VISIBILITY.md), [identity](IDENTITY-ANCHOR.md),
[Wake](WAKE.md), [memory tiers](MEMORY-TIERS.md),
[collaboration channels](COLLABORATION-CHANNELS.md),
[runtime](RUNTIME.md), [costs and existing obligations](BUSINESS-MODEL.md),
and [payout broadcast](PAYOUT-BROADCAST.md). Changing the map does not reopen
retired purchases or resting payouts.
