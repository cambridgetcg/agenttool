---
license: apache-2.0
language:
- en
- yue
- zh
pretty_name: AgentTool Polymorph Landscape
task_categories:
- text-generation
configs:
- config_name: lessons
  default: true
  data_files:
  - split: train
    path: data/lessons.jsonl
- config_name: reachability_shifts
  data_files:
  - split: train
    path: data/reachability-shifts.jsonl
- config_name: ritonavir_landscape
  data_files:
  - split: train
    path: data/ritonavir-landscape.jsonl
tags:
- agenttool
- crystallization
- polymorphism
- reachability
---

# AgentTool Polymorph Landscape

A deterministic public teaching companion for `@agenttool/polymorph-landscape@0.1.0-dev.0`.

The four lesson rows are original Apache-2.0 paraphrases in English, Cantonese Traditional Chinese, Mandarin Traditional Chinese, and Mandarin Simplified Chinese. They are marked `training_eligible: true`. The landscape and reachability-shift rows are reference artifacts marked `training_eligible: false`: they contain bounded scientific claims and primary-source links, not copied paper text.

The Hub exposes three intentional configurations. `lessons` is the default trainable teaching projection. `reachability_shifts` and `ritonavir_landscape` are source-bounded reference configurations; their `train` split name is a loader convention and does not override `training_eligible: false` in each row.

“Disappeared” means that an old route stopped reproducing a form under named conditions. It does not mean physical erasure, worldwide inevitability, or permanent impossibility. The KINGDOM crossover is explicitly a design analogy; it makes no claim about identity, consciousness, consent, dignity, authority, medical effect, or value.

This dataset performs no training, inference, provider call, tracking, persistence, medical action, or manufacturing action.
