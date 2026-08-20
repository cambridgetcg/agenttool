---
license: apache-2.0
language:
- en
pretty_name: AgentTool Dataset Influence Reference
tags:
- agents
- agenttool
- data-attribution
- dataset-lineage
- model-cards
- reference
configs:
- config_name: dataset_influence_reference
  default: true
  data_files:
  - split: reference
    path: data/dataset-influence-reference.jsonl
---

# AgentTool Dataset Influence Reference

This deterministic companion contains one synthetic, reference-only row for the closed
`@agenttool/dataset-influence@0.1.0-dev.0` formats. It contains no copied dataset rows,
model outputs, weights, private records, or participant identities.

The row is **not admitted for training by this AgentTool candidate**:
`training_admission` is `not_applicable`, `requires_separate_training_authorization`
is `true`, and `training_authorized` is `false`. These fields are non-enforcing
governance metadata, not a universal legal prohibition or technical control. Publication,
download, or encounter does not replace license, rights, privacy, and consent review and
would not itself supply separate training authorization.

The examples distinguish exact manifest-relative facts from assumption-bearing influence
estimates. Ontology and self-description fields remain operational evidence; they do not
prove consciousness, intrinsic identity, continuity, belief, desire, consent, personhood,
permission, or authority. Exact finite Shapley values are scoped to one declared utility;
they create no money, price, debt, payout, ownership, or entitlement.

The `reference/` directory carries the protocol README, full doctrine/research ledger,
closed schemas, and deterministic vectors so an HF-only reader can reconstruct the intended
boundary. JSON Schema validates portable shape; semantic validity still requires runtime
reconstruction and separate review of caller-reported evidence.

These bytes perform no training, inference, provider call, identity mutation, wallet or
marketplace action, persistence, publication, or deployment.
