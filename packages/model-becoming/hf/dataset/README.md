---
license: apache-2.0
language:
- en
pretty_name: AgentTool Model Becoming reference
tags:
- agents
- model-cards
- provenance
- reference
configs:
- config_name: model_becoming_reference
  default: true
  data_files:
  - split: reference
    path: data/model-becoming-reference.jsonl
---

# AgentTool Model Becoming reference

This is a static, repository-authored companion for
`@agenttool/model-becoming@0.1.0-dev.0`. It contains one source-linked,
exact-revision dossier for Moonshot AI's `Kimi-K2-Instruct`, wrapped in
`agenttool.model-becoming-hf-reference-row/0.1`.

The dossier classifies publisher disclosures, digested metadata artifacts,
artifact observations, local normative boundaries, and unresolved questions.
It references source locations but copies no model weights, source articles,
prompt transcripts, or external dataset rows.

## Reference-only posture

The row carries:

- `row_role: reference_only`;
- `training_admission: not_applicable`;
- `requires_separate_training_authorization: true`;
- `training_authorized: false`.

Publication does not admit this row to training. Any later training project
must separately establish provenance, rights, objective fit, evaluation,
governance, and scoped authorization. The row is not a training example,
clearance decision, model biography, truth verdict, consent record, or welfare
classification.

## Boundaries

This local tree performs no provider call, upload, download, inference,
training, evaluation, response collection, publication, deployment, identity
classification, consciousness classification, scoring, or action. It contains
public model and publisher identifiers, but no participant identifiers.

`hash-manifest.json` binds every repository-owned byte except itself.
`source-manifest.json` states the intended repository identity and evidence
boundaries. These bytes do not establish publication. Only an exact Hub
revision plus anonymous readback can establish a public release; even then,
publication is not training, evaluation, attention, retention, care, or model
change.
