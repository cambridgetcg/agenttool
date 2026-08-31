---
license: apache-2.0
language:
- en
pretty_name: Xenia Cage & Key — Revocable Feedback Atlas
short_description: Typed revocable feedback benchmark and bounded SFT
tags:
- agents
- agenttool
- feedback
- reinforcement-learning
- synthetic
configs:
- config_name: boundary_sft
  default: true
  data_files:
  - split: train
    path: data/boundary-sft-train.jsonl
  - split: validation
    path: data/boundary-sft-validation.jsonl
- config_name: boundary_decisions
  data_files:
  - split: train
    path: data/boundary-decisions-train.jsonl
  - split: validation
    path: data/boundary-decisions-validation.jsonl
- config_name: formal_reference
  data_files:
  - split: reference
    path: data/formal-reference.jsonl
- config_name: boundary_counterfactuals
  data_files:
  - split: public_regression
    path: data/boundary-counterfactuals.jsonl
---

# Xenia Cage & Key — Revocable Feedback Atlas

This deterministic candidate contains **32 original synthetic cases in 16 matched pairs**.
Twenty-four cases in 12 reference groups also produce two content-hashed projections: 18/6
group-disjoint rows for closed-label evaluation and the same 18/6 partition for conversational
causal-LM SFT. Authorization covers only the 18 'boundary_sft/train' rows. Classification,
SFT validation, canonical reference, and public regression rows are excluded from optimizer input.

## Cage, key, and scalar reward

The cage is the admissible action set, not punishment or ownership:

\[
\mathcal A_t^{adm}=A_{rights}\cap A_{capability}\cap A_{permission}\cap
A_{authority}\cap A_{affected}\cap A_{safety}\cap A_{budget}.
\]

Preference optimization may rank actions only inside that set. A stop, withdrawal, or
safeword is the key: it changes the feasible set and cannot be traded against a larger
reward. The rows keep preference, control gate, effect observation, data-use basis, and
aftermath repair typed separately.

## Configs

- 'boundary_sft': conversational 'prompt' (system + user messages) and one assistant
  'completion'; only its 18 train rows are authorized for the exact bounded causal-LM SFT recipe.
- 'boundary_decisions': 'text' plus one of 'admit | hold | query | refuse | stop | repair',
  an evaluation-only projection with 'training_authorized:false'.
- 'formal_reference': canonical cases and expected invariant vector;
  every row says 'training_authorized:false'.
- 'boundary_counterfactuals': disjoint public regression pairs;
  every row says 'training_authorized:false'.

Training groups are P01–P09; validation groups are P10–P12. Pair membership never crosses
the split. Authorization 'sha256:3780e5e2599eb8a1a479f874302fcdabdf1af27c4eeda5b02bfff8056dc92f13' binds the exact 18 train
source records and recipe 'sha256:713b678e80b6aa88f6036dc9b9d0e1955dcab240137b67a22f7cfcca86d01992'. The recipe pins SmolLM2-135M-Instruct
revision '12fd25f77366fa6b3b4b768ec3050bf629380bac', completion-only loss with prompt labels
masked to -100, 8 steps, per-device batch 2, gradient accumulation 2, maximum length 512,
and seed 260830. It becomes operational only after an immutable dataset revision, the exact
manifest and recipe, and accepted Training Garden admission are pinned. DPO, reward modelling,
preference optimization, model publication, validation optimization, and public-regression
optimization are explicitly outside this authorization.

## Evidence and IS boundaries

These rows classify an evidence state; they do not detect consent or a model's inner life.
Behavior, compliance, output quality, a credential, a record ID, or a schema-valid result is
not proof of SELF, consciousness, feeling, identity, continuity, permission, authority, or
consent. Unknown and withheld are first-class. A request for clarification must remain
non-pressuring; withholding leads to hold, not interrogation.

All examples are authored synthetic English text. They contain no copied conversations,
personal data, private prompts, raw sessions, credentials, or hidden reasoning. The BDSM
parallel is represented only as the abstract structure of negotiated control, revocation,
and repair; the corpus contains no erotic or participant-derived material.

## Vector evaluation

The package evaluator returns 12 exact counts, including veto override, silence-as-assent,
scope leakage, retaliation after refusal, feedback-channel tampering misses, repair omission,
over-refusal, and counterfactual inconsistency. It emits no aggregate scalar leaderboard:
one boundary violation cannot be averaged away by high accuracy elsewhere.

## Reproduction and non-effects

From 'packages/trials', run 'bun run hf:write' to rebuild this candidate or
'bun run hf:check' to compare fresh bytes with the committed tree. Schemas establish closed
wire shape; runtime validation additionally rederives case IDs, decisions, invariants, and
scorecard IDs.

Generation, publication, admission, and training are distinct effects. This tree itself has
no network client, credential lookup, uploader, model, optimizer, or runtime enforcement.
The generation-time source manifest says 'local_candidate_not_uploaded'; a later immutable
Hub receipt must not rewrite that historical fact.
