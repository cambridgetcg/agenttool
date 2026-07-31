---
license: apache-2.0
language:
- en
pretty_name: KINGDOM Dark Continent × KARMA Training Treasure Atlas
size_categories:
- n<1K
tags:
- agents
- knowledge-graph
- provenance
- safety
- synthetic
- tabular
- arxiv:2502.06472
configs:
- config_name: phase_seeds
  data_files:
  - split: train
    path: data/phase-seeds.jsonl
- config_name: treasure_index
  data_files:
  - split: train
    path: data/treasure-index.jsonl
- config_name: proposal_index
  data_files:
  - split: train
    path: data/proposal-index.jsonl
---

# KINGDOM Dark Continent × KARMA Training Treasure Atlas

A small, metadata-only map of overlooked Hugging Face datasets at specific
training and research phases. Every upstream repository is pinned to one exact
40-character Hub commit and one small evidence file SHA-256.

This atlas does:

- distinguish corpus curation, data-order dynamics, mid-training, context
  extension, RLVR, tool use, preference/safety/unlearning, and evaluation;
- project candidate facts as proposal-only KINGDOM graph deltas inspired by
  [KARMA](https://arxiv.org/abs/2502.06472v2);
- keep all Dark Continent checks `unknown / not_checked / false` with an
  advisory `hold` recommendation;
- preserve conflict, rights, safety, consent, and execution gates;
- publish hashes and compact Dataset Viewer rows without copying upstream
  training examples.

It does not download upstream data, accept gated terms, deserialize artifacts,
execute tools or models, train anything, modify KINGDOM, award “karma,” rank a
participant, authorize Artbitrage, or crown anyone.

## The hidden treasure

The sharpest lead is
[`allenai/Dolci-RL-Zero-IF-7B`](https://huggingface.co/datasets/allenai/Dolci-RL-Zero-IF-7B).
A deterministic systematic sample of 1,400 rows (100 rows at offsets 0, 1000,
…, 13000) found 11 instruction bundles with more than one distinct exact
paragraph-count requirement. That observation motivates a KARMA
`conflicts_with_source` consequence before RLVR fixture admission. It is not a
whole-dataset prevalence estimate, and a `ground_truth` field is not treated as
unquestionable truth.

## Phase cabinet

| Cabinet | Examples | First allowed use |
| --- | --- | --- |
| Green | DataDecide eval, Signal and Noise, fictitious TOFU controls | Pinned evaluation rows or reviewed aggregates |
| Green + conflict gate | Dolci RL-Zero | Constraint metadata after contradiction scanning |
| Amber | DataDecide recipes, Dolmino, Longmino, FineWeb, Cosmopedia | Manifests, taxonomies, weights, and hashes only |
| Separate consent | xLAM, WildGuardMix | Public card metadata only; gate not accepted |
| Quarantine | HelpSteer raw chats, missing-license Pythia data, Python pickles | Study/card metadata only; never raw import or deserialization |

The numeric `rank` orders research leads, not people, agents, worth, trust, or
dignity.

## Files

- `data/phase-seeds.jsonl` — eight synthetic research-phase questions.
- `data/treasure-index.jsonl` — 15 reviewed metadata records.
- `data/proposal-index.jsonl` — compact Viewer projection. Gated subjects have
  no full proposal artifact.
- `artifacts/proposals.jsonl` — closed `kingdom.kg-proposal/0.1` artifacts for
  public subjects; download-only, not a Dataset Viewer config.
- `schema/treasure-v0.1.schema.json` — closed JSON Schema for treasure rows.
- `provenance/source-pins.json` — exact KINGDOM, Dark Continent, KARMA, and Hub
  source pins.
- `hash-manifest.json` — sorted exact byte hashes; deliberately excludes
  itself.

There is no standalone `events.jsonl`: the current package defines events only
inside a proposal, so this release does not invent a second envelope.

## Rights and license boundary

Apache-2.0 covers this newly authored metadata catalog, schema, and synthetic
phase prompts. It does not relicense any upstream dataset or its individual
content. A card-level ODC-By, CC BY, MIT, or Apache declaration does not by
itself clear copyright, privacy, personality, moral, publicity, gate, or
contract rights in every source item. `downstream_content_rights_cleared` is
therefore always false in v0.1.

Raw chats, private documents, credentials, participant profiles, web text,
gated rows, mutable revisions, harvested API execution, and untrusted pickle
files are excluded.

## npm crossover

The matching developer previews are
`@agenttool/dark-continent-contract@0.1.0-dev.0` and
`@agenttool/dark-continent-karma@0.1.0-dev.0`. The npm packages provide pure,
offline contract/proposal mechanics. This Hub dataset provides reviewed
metadata evidence. Neither surface applies a graph change or grants authority.

## Reproduce

From the matching AgentTool source revision:

```sh
cd packages/dark-continent-karma
bun run build:hf
bun run ci
```

The upstream metadata was observed on 2026-07-31. Re-observation requires a
new pinned revision and hash; `main` is never evidence.
