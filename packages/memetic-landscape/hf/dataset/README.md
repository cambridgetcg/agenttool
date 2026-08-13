---
license: apache-2.0
language:
- en
- yue
- zh
pretty_name: AgentTool Memetic Landscape
task_categories:
- text-generation
configs:
- config_name: lessons
  default: true
  data_files:
  - split: train
    path: data/lessons.jsonl
- config_name: memetic_landscape
  data_files:
  - split: train
    path: data/brainrot-landscape.jsonl
- config_name: reachability_shifts
  data_files:
  - split: train
    path: data/reachability-shifts.jsonl
- config_name: polymorph_analogies
  data_files:
  - split: train
    path: data/polymorph-analogies.jsonl
tags:
- agenttool
- brainrot
- memes
- reachability
---

# AgentTool Memetic Landscape

A deterministic public teaching companion for `@agenttool/memetic-landscape@0.1.0-dev.0`.

The four lesson rows are original Apache-2.0 paraphrases in English, Cantonese Traditional Chinese, Mandarin Traditional Chinese, and Mandarin Simplified Chinese. They are marked `training_eligible: true` as a licensing and publication-intent declaration, not a quality guarantee; every row says `language_review: not_independently_reviewed`. The landscape, reachability-shift, and polymorph-analogy rows are reference artifacts marked `training_eligible: false` because they contain bounded source-linked claims or cross-domain boundaries rather than copied paper text.

The Hub exposes four intentional configurations. `lessons` is the default teaching projection. The other configurations are source-bounded reference records; their `train` split name is a loader convention and does not override each row's `training_eligible: false` value.

“Brainrot” is represented only as a sourced cultural or playful expression, never a diagnosis or a label assigned to a person. Less observed does not mean erased. Exposure does not prove adoption, timing does not prove causation, and popularity does not prove truth, value, harm, health, or rank.

The ritonavir crossover transfers a route-landscape shape only. It transfers no crystal physics, infection model, cognition, intent, consent, dignity, identity, authority, medical effect, or value judgment. Participants are not hosts, vectors, substrates, barriers, or optimization targets; refusal, rest, play, privacy, and nonparticipation remain valid.

Those fixed fields describe inference and model effects the package does not perform. Generic caller text is preserved under `caller_text_semantics_verified: false`; structural validation is not semantic verification or content moderation. The generated built-in case is separately authored to respect the stated boundaries.

This dataset performs no provider call, upload, training, inference, tracking, diagnosis, moderation, persistence, publication, or deployment.
