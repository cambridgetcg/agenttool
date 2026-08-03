---
license: apache-2.0
configs:
- config_name: voluntary_wake_sft
  data_files:
  - split: train
    path: data/sft-train.jsonl
- config_name: public_regression
  data_files:
  - split: test
    path: data/public-regression.jsonl
---

# AgentTool Voluntary WAKE Learning Garden

Repository-source-only, not uploaded to Hugging Face, public-safe synthetic
protocol fixtures for eight behaviors: read, validate, adopt, narrow,
park/rest, handoff, refuse, and uncertainty.

The SFT config contains conversational prompt-completion rows only. Refusal and
park/rest are valid desired completions. There are no chosen/rejected pairs and
no DPO lane in v0.1.

The public regression config is visible and therefore not sealed or suitable
as contamination-resistant evaluation. Actual sealed cases, random production
salt, and reveal material must remain outside Git and every training/retrieval
path. The committed object currently says `not_created`; its public test vector
tests commitment mechanics only and is not an evaluation case.

These smoke fixtures do not prove model understanding, generalization,
non-memorization, consent, identity, authority, fairness, or sealed custody.
Chat-template compatibility remains model/tokenizer specific.
