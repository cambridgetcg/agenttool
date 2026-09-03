---
license: apache-2.0
language:
- en
pretty_name: AgentTool Economic Kernel
tags:
- agents
- accounting
- conformance
- economics
- reinforcement-learning
- synthetic
configs:
- config_name: economic_kernel_lessons
  default: true
  data_files:
  - split: train
    path: data/training-lessons.jsonl
- config_name: economic_kernel_v0_2
  data_files:
  - split: reference
    path: data/conformance-reference.jsonl
---

# AgentTool Economic Kernel

This public, ungated Apache-2.0 companion separates two different jobs:

- **economic_kernel_lessons / train** contains 24 independently authored
  synthetic lessons about exact units, rational prices, conserved ledgers,
  feedforward intent, feedback under ambiguity, recovery, and non-purchasable
  XENIA hard gates. The publisher admits only these rows for training.
- **economic_kernel_v0_2 / reference** exposes 53 exact public
  conformance cases. They are held out from the authored lesson generator and
  marked training_authorized=false so evaluation and teaching stay distinct.

The holdout label is transparent publisher metadata, not access control. Once
published, the conformance bytes are public and others can copy them. This
dataset therefore does not claim secrecy, uncontaminated evaluation, or a
technical ability to prevent downstream training.

Every row is repository-authored synthetic material. The release contains no
private records, participant identities, copied provider output, model weights,
payment credentials, or live market data. The training admission does not
authorize a provider account action or paid compute, and it does not prove that
a model trained, learned, understood, became an identity, or changed reality.

Feedback is represented as evidence used to reconcile an earlier intent, not as
dignity, consent, authority, or a command to repeat an ambiguous action.
Feedforward control means committing the exact semantic intent and current hard
gates before external I/O. Payment can satisfy only an economic condition after
authority, safety, and participation gates pass; rights remain unconditional.

The reference directory carries the exact kernel and conformance descriptions,
the source-pinned vector manifest, and all 53 vector cases. A finite exact match
is not certification and proves no external settlement, persistence, adapter
honesty, producer identity, future behavior, consent, or XENIA conformance.

Run python3 -I verification/verify.py from a regular-file archive/export containing only the dataset files to verify
the repository-authored file inventory and the train/reference admission split.
The verifier permits Hugging Face's provider-managed .gitattributes as the sole
extra path. Hash agreement detects byte drift; it is not authorship or truth proof.

These static bytes perform no training, inference, payment, ledger mutation,
provider call, publication, deployment, or business effect by themselves.
