# @agenttool/hf-scout

Private local prototype for projecting bounded Hugging Face repository metadata
into KINGDOM and Agent Data shapes. It is deliberately a scout, not an
inference provider, credential bridge, downloader, or package-release surface.

## What it does

- Reads one explicitly selected public model, dataset, or Space through fixed
  unauthenticated Hugging Face Hub API endpoints.
- Accepts a caller-owned `HubReader` so an MCP host or
  `@huggingface/hub` adapter can supply metadata without coupling OAuth to this
  package.
- Separates publisher assertions, provider content commitments, immutable full
  commit SHAs, and local derivations.
- Emits a structurally closed inspection report, a compact derived KINGDOM
  reference sidecar, or a structural `@agenttool/data` text-collector request.
  Runtime projectors enforce semantic invariants that portable JSON Schema
  cannot express, including sorted unique paths and logical identity limits.
- Projects an explicitly supplied
  `love.huggingface-model-lock/v1` document into compact status metadata.
- Exposes a closed, revision-pinned catalog of phase-specific research leads
  and can bind one lead to the exact canonical bytes of a Scout report.

## What it does not do

It does not read ambient HF credentials, arbitrary URLs, private repositories,
or raw cards. It does not download files, execute model or Space code, invoke
inference, Jobs, Sandboxes, or MCP tools, write to the Hub, upload traces,
modify KINGDOM-OS, publish npm packages, or verify that a declared license is
correct or compatible.

The built-in reader makes one bounded `GET`, follows no redirects, requests
credential omission, and retries zero times at the Scout layer. It captures
the host fetch function when the module loads so a later global replacement is
not silently adopted. These are requested wrapper effects, not proof that the
host runtime itself is uncompromised. A structural `HubReader` cannot claim
that built-in identity. An injected reader—or a `PublicHubReader` given a
custom `fetch`—is caller-owned; the report names that boundary and does not
make claims about its credentials, retries, or body policy. The wrapper races
its deadline even when a custom fetch ignores `AbortSignal`.

## Local use

```bash
bun install --frozen-lockfile
bun run ci

bun src/cli.ts facilities
bun src/cli.ts research-leads --phase pretraining_data_selection
bun src/cli.ts search model mlx-community --limit 3
bun src/cli.ts inspect model mlx-community/Llama-3.2-3B-Instruct-4bit --json
bun src/cli.ts inspect model mlx-community/Llama-3.2-3B-Instruct-4bit --agent-data
bun src/cli.ts lock-status /explicit/path/to/model-lock.json
```

`--sidecar` emits `kingdom-hf-sidecar/v0.1`; it does not register that sidecar
with KINGDOM. It stores a digest-bound artifact reference rather than copying
the complete snapshot, and carries the public-versus-caller-owned observation
boundary. Its effect booleans describe only the sidecar projector.
`--agent-data` requires a full commit SHA and emits a request for the existing
`text` collector. Observation time stays outside snapshot bytes. The Agent
Data external identity and version bind both the revision and exact snapshot
SHA-256, so repository settings or bounded inventory changes at one revision
cannot collide.

`lock-status` validates and digests the lock metadata only. It accepts the
Love creator's nullable `last_modified`, `task`, and `library` fields,
string-or-list `base_model`, and optional Git blob commitments. The Love
Python tool remains authoritative for creating/reproducing the lock and
verifying a downloaded snapshot. This package never claims
`snapshot_verified: true`.

## Phase-aware research treasures

`research-leads` is an inert curated overlay, not a downloader. Its 15 pinned
records cover pretraining data-selection experiments, quality filtering and
decontamination, human disagreement and preference rationales, earliest-step
reasoning errors, judge/rhetoric bias, simulated tool traces, tool-failure
recovery, multilingual evaluation, gated safety labels, agent SFT/RL task
bundles, and sparse-autoencoder sweeps. The DataDecide suite is deliberately
split into three records because its evaluation results and data recipes
declare ODC-By while its perplexity-results repository declares no license.
Despite its name, the pinned `DataDecide-data-recipes` tree includes very
large tokenized binary shards; Scout therefore catalogs only their metadata
and requires separate approval for binary or bulk retrieval.

The intended ecosystem routes stay deliberately narrow:

- DataDecide evaluation and perplexity trajectories become Yutabase
  experiment/provenance graphs; the token arrays remain out of process.
- HelpSteer2 and OffsetBias become bounded RhetorLint disagreement and
  evaluator-bias probes, never truth or intent labels.
- ToolACE, AgentTrove, and tool-failure recovery become inert AgentTool parser
  and recovery fixtures. AgentTrove contains text traces and environment/tool
  transcripts; only the separate Agent RL 5K record declares binary tasks.
- ProcessBench and Global-MMLU remain sealed evaluation material, excluded
  from training and retrieval indexes.
- Gemma Scope stays a metadata matrix unless a separately reviewed single-SAE
  pilot is approved; its base-model terms and publisher-noted quality issues
  remain explicit boundaries.

Every record separates publisher assertions from researcher inference, names
bounded and forbidden ecosystem uses, and derives its Hub/paper URLs from
exact repository identity, revision, and paper IDs. `bindHfResearchLead`
requires the byte-equivalent built-in curated definition, an immutable
matching Scout report, exact license/gate/private declarations, and the
Scout's non-download/non-execution boundaries. Reusing a known key with
rewritten research fields is rejected. Its output binds the canonical lead
definition and report snapshot with separate SHA-256 digests. It records legal
clearance and gate acceptance as `not_assessed`.

The current catalog is metadata-only. It does not read rows, download files,
accept gated terms, extract binary task bundles, execute embedded calls, or
make preference, rhetoric, safety, or interpretability labels authoritative.

### Companion training atlas

AgentTool's `@agenttool/dark-continent-karma` package owns a separate
`kingdom.hf-training-treasure/0.1` atlas. The atlas is the proposal-only,
publishable research map; Scout is the transport/provenance boundary that can
observe a repository and bind the 15 exact definitions curated here. Their
overlap is intentional, but neither silently imports the other. An atlas
consumer must validate that package's schema and hash manifest separately;
Scout does not turn an external atlas row into one of its canonical leads.

## npm / HF crossover

The package demonstrates a small npm boundary:

- explicit ESM `exports` for code, facilities,
  inspect/search/sidecar/research schemas, and a draft local extension
  manifest;
- two CLI bins, `agenttool-hf-scout` and `kingdom-hf`;
- zero runtime dependencies and a strict package file allow-list;
- an injected `HubReader` seam for an optional `@huggingface/hub` adapter;
- no `@huggingface/inference`, MCP client, or agent loop in the default graph.

The facilities catalog records the broader HF map and official source links as
observed on 2026-07-30. It intentionally contains no volatile price or quota
entitlement claim.

## Authority and trust

Hub cards, tags, gating flags, and license fields are publisher assertions.
Repository SHAs and file hashes are useful content commitments; a 40-hex value
alone does not prove that a commit exists or belongs to the named repository.
Public-reader observations and caller-owned reader assertions therefore remain
distinct in durable artifacts. Neither proves safety, behaviour, consent,
authorship, or license truth. Search hits are leads until a separate repository
read succeeds. Boundary codes use a closed vocabulary and describe only what
this Scout did; they do not claim that a caller-owned reader avoided downloads,
execution, compute, or writes.

This package is `private: true`, `UNLICENSED`, and not wired into AgentTool
release inventory or KINGDOM host loading. Publication, upload, compute, and
deployment remain separate operator decisions.
