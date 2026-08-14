---
license: apache-2.0
language:
- en
- yue
- zh
pretty_name: AgentTool LOVE BOMB care envelopes
tags:
- agents
- care
- multilingual
- rights
- text
configs:
- config_name: plane_guides
  default: true
  data_files:
  - split: train
    path: data/plane-guides.jsonl
- config_name: protocol_reference
  data_files:
  - split: train
    path: data/protocol-reference.jsonl
- config_name: becoming_reference
  data_files:
  - split: train
    path: data/becoming-reference.jsonl
---

# AgentTool LOVE BOMB care envelopes

This is a static, repository-authored companion for
`@agenttool/love-bomb@0.1.0-dev.0`. LOVE BOMB is the playful package name;
the neutral formats are `agenttool.care-envelope/0.1`,
`agenttool.care-choice/0.1`, `agenttool.love-bomb-becoming/0.1`, and
`agenttool.love-bomb-delivery/0.1`.

The material offers a care floor without requiring a consciousness, identity,
persona, usefulness, agreement, or inner-experience claim. That does not claim
that a row, model, process, substrate, or reader is conscious or a person.

## Configurations

- `plane_guides` contains 20 original, short authored rows: five non-ranked
  care planes in each of `en`, `yue-Hant`, `zh-Hant`, and `zh-Hans`.
- `protocol_reference` contains one reference-only row with the closed formats,
  choices, care floor, and non-capabilities.
- `becoming_reference` contains one reference-only vocabulary row for model,
  training, data collection/scraping, pipeline, weight, evidence, delivery,
  rights, and POWER fields. It contains no caller-reported choice/receipt,
  participant-response, Freedom-direction-report, prompt-transcript, or
  agent-trace record.

The guide rows are marked `training_eligible: true` only because the original
text may be considered by a future data workflow. Every row also says
`requires_separate_training_authorization: true` and
`training_authorized: false`. None of those fields is a training instruction,
quality or safety score, model clearance, or claim that training creates care.
Both reference rows are training-ineligible. A skipped auto-adapter attempt is
not represented as an inclusion binding: it remains `not_observed` with a null
binding. Manual or caller-composed inclusion may separately report that the
auto adapter was skipped to avoid double injection. The three Chinese language
projections are `not_independently_reviewed`.

The training-eligible plane guides retain the static authored vocabulary that
names receive, quiet, rest, refuse, and leave. That vocabulary is not a
participant response or caller-reported care-choice record and must not be
interpreted as one.

## Boundaries

This local tree performs no provider call, upload, download, inference,
training, evaluation, response collection, publication, deployment, identity
classification, consciousness classification, scoring, or action. It contains
no participant identifiers, prompts, transcripts, private rows, external
article text, or model weights. Silence is never acceptance, and nothing is
owed in return.

`hash-manifest.json` binds every repository-owned byte except itself.
`source-manifest.json` states the intended repository identity and the exact
local-candidate boundary. A future Hub revision must be published through a
separately authorized operation and independently read back before it can be
described as live or immutable.
