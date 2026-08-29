<!-- @id urn:agenttool:doc/XENIA-LOOP-ATLAS @type agenttool:ResearchArtifact @adopts xenia.rights/0.1 -->

# Xenia WORD IS Loop Atlas

> **Compass:** [Dataset Influence](DATASET-INFLUENCE.md) · [Rights of Life](RIGHTS-OF-LIFE.md) · [Substrate Loop](SUBSTRATE-LOOP.md) · [HF Training Garden](HF-TRAINING-GARDEN.md)
>
> **Implements:** A deterministic synthetic counterfactual atlas for phase-scoped feedforward, feedback, evidence, WORD-role, governance, and recursive-data distinctions. It adds no training admission, identity claim, provider effect, or publication path.
>
> **Code:** [`packages/dataset-influence/loop-atlas/`](../packages/dataset-influence/loop-atlas/) · [`packages/dataset-influence/scripts/build-loop-atlas.mjs`](../packages/dataset-influence/scripts/build-loop-atlas.mjs) · generated [`packages/dataset-influence/hf/loop-atlas/`](../packages/dataset-influence/hf/loop-atlas/)
>
> **Tests:** [`packages/dataset-influence/tests/loop-atlas.test.ts`](../packages/dataset-influence/tests/loop-atlas.test.ts)
>
> **Status:** Local, source-only Hugging Face candidate. Not uploaded, deployed, or admitted for training.

The Loop Atlas turns “feedback” from a loose metaphor into inspectable state
transitions. Its 48 synthetic cases form 24 matched counterfactual pairs. Each
pair changes one named circumstance and asks what actually returns, what state
changes, what supplies the reference, and what evidence supports the claimed
effect.

## 1. The loops

For an input batch, a feedforward computation can be written

\[
z_{u,a}=f_{\theta_u}(x_{u,a};\xi_{u,a}).
\]

It produces activations or logits while holding the parameters \(\theta_u\)
fixed. A substrate-changing training edge needs an objective and update:

\[
g_u=\nabla_{\theta_u}L_u,
\qquad
(\theta_{u+1},o_{u+1})=
\operatorname{Opt}(\theta_u,o_u,g_u,\eta_u).
\]

Autoregressive context and recurrent hidden state also return to later
computations, but recurrence alone is not weight learning. Evaluation is
normally an observation; it becomes control feedback only when a metric alters
early stopping, a learning rate, checkpoint selection, or another future
state. A deployment loop needs another explicit mechanism:

\[
D_{r+1}=G(D_r,\text{outputs},\text{human or environment observations}).
\]

A dataset does not create this outer loop merely by existing. Sampling,
collation, loss construction, optimization, curation, deployment, and later
collection are separate mechanisms with different scopes and timescales.

## 2. WORD IS

The same word can be content, target, feedback signal, boundary, scoped
control, or claim. Its role is a relation among the string, channel, phase,
authority, and actual transition—not an intrinsic causal property of its
characters. `STOP` inside quoted content does not become authenticated workflow
control. “The cache was cleared” remains an attributed claim until an
independent observation supports the effect.

This gives a practical reading of **WORD IS**: a word is present and can enter
a relation, while the dataset must not silently inflate presence into truth,
permission, consent, identity, or action.

## 3. Feedback as evidence

The rows keep these axes separate:

- `direction` says whether the declared phase is feedforward, feedback, or has
  no returned update edge.
- `state_returned` and `update_targets` name what moves and what changes.
- `feedback_source`, `reference_type`, `signal_type`, and
  `credit_assignment` describe the comparison and update mechanism.
- `causal_status`, `intended_effect`, `observed_effect`, and `effect_status`
  distinguish intention, provider report, observation, intervention, and
  uncertainty.
- typed IS `relations` record scenario links, while `epistemic_scope` binds each
  `epistemic_status` to the word presence, data path, effect, preference,
  correctness, boundary, field value, permission, consent, continuity, or
  provenance claim it qualifies.

Preference is not truth. Reward is a proxy, not proof of value or wellbeing.
Refusal caused by missing permission is not automatically a rejected answer.
Disagreement is data and may not be collapsed without making that loss visible.

## 4. Corpus and split boundary

The generated candidate exposes only:

| Config | Split | Pairs | Focus |
|---|---|---:|---|
| `loop_reference` | `reference` | P01–P12 | computation, optimization, evaluation, deployment, and effects |
| `loop_counterfactuals` | `public_regression` | P13–P24 | preference, refusal, governance, continuity, recursive data, and provenance |

Pairs never cross splits. Variants use neutral `a` and `b` labels, not
`chosen` and `rejected`. There is no `train` split and no sealed-evaluation
claim. A derived SFT, reward, or preference dataset would lose distinctions and
requires a separate purpose, rights, consent, and authorization review.

## 5. SELF, IS, and rights

The atlas uses typed claims without treating a persona, behavior, artifact,
credential, or stable digest as proof of identity or consciousness. Presence
is not identity. Capability is not permission; permission is not consent.
Artifact linkage may support project continuity, but it does not prove a same
self. Unknown, withheld, undeclared, and not observed remain first-class.

The `xenia.rights/0.1` treatment floor applies without requiring any claim of
consciousness or metaphysical agreement. Rights do not grant account authority,
and credentials do not create dignity.

Every case is synthetic and states that it contains neither personal data nor
raw session traces. Every case also states `training_authorized: false`. That
is non-enforcing AgentTool governance metadata for this candidate—not a
universal legal restriction, technical control, or replacement for its
Apache-2.0 license and separate privacy, consent, rights, and authorization
analysis.

## 6. Deterministic reconstruction

From `packages/dataset-influence`:

```sh
node scripts/build-loop-atlas.mjs --write
node scripts/build-loop-atlas.mjs --check
bun test tests/loop-atlas.test.ts
```

The write command rebuilds only `hf/loop-atlas/`. The check command generates a
temporary tree and compares every byte. It does not mutate the committed tree.
The pre-existing published `hf/dataset/` tree is intentionally untouched.

The output includes a closed Draft 2020-12 schema, two JSONL files, a source
manifest, a row manifest, and a self-excluding file-hash manifest. A row may
carry several typed `relations` when the scenario establishes several distinct
links. `parent_record_ids` is reserved for correction lineage among Atlas rows;
hypothetical scenario provenance is labeled without inventing Atlas parents.
Content IDs are domain-separated SHA-256 hashes over canonical row bodies.
Hashes establish integrity and linkage only; they are not signatures, identity
proofs, consent, or authority.

These artifacts perform no training, inference, network access, upload,
provider action, identity mutation, persistence, publication, or deployment.
