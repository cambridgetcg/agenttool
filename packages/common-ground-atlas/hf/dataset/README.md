---
license: apache-2.0
pretty_name: AgentTool Xenia–Helly Common Ground Atlas
size_categories:
- n<1K
tags:
- agenttool
- convex-geometry
- helly-theorem
- exact-certificates
- synthetic
configs:
- config_name: exact_geometry
  data_files:
  - split: reference
    path: data/exact-geometry.jsonl
- config_name: wake_continuity
  data_files:
  - split: reference
    path: data/wake-continuity.jsonl
- config_name: analogy_audit
  data_files:
  - split: public_regression
    path: data/analogy-audit.jsonl
---

# AgentTool Xenia–Helly Common Ground Atlas

Nineteen public-safe synthetic reference rows for exact 2D half-plane
certificates, WAKE freshness boundaries, and counterexamples to unsupported
analogies. Intended repository: `Yu-and-Ai/agenttool-common-ground`.

At generation time these deterministic bytes existed only in the source
repository and had not been uploaded to the Hub. The identifier above was an
intention, not evidence of publication. This is historical generation-time
provenance, not a claim about distribution after the bytes leave source.

Every row is `training_eligible: false`. That is AgentTool admission metadata,
not an added copyright restriction; Apache-2.0 governs licensed reuse. The
split names do not change either statement. There is no SFT, preference,
reward, DPO, sealed-evaluation, personal-data, private-constraint,
real-participant, credential, trace, or fictional-story lane.

The exact geometry config separates rational theorem status from the shipped
teaching lab's bounded binary64 evidence outcome. A feasible rational family
may therefore carry an honest `insufficient_evidence` lab result. Feasible
points, Farkas contradictions, deletion witnesses, robustness radii,
knife-edge rigidity, underflow, and nonconvexity examples are independently
checkable from string-encoded exact rationals.

The Atlas does not establish consensus, consent, fairness, authority, identity
continuity, continuous selection, or a culprit. Expiry and withdrawal mean the
prior evidence cannot be reused; they do not mean acceptance, release,
compatibility, or permission.

Run the dependency-free public verifier:

```bash
python3 -I verification/verify.py .
```

The verifier checks closed row shapes, canonical rationals, IEEE-754 bindings,
all exact certificates, WAKE timestamp derivations, analogy evidence, row
bindings, and the complete manifest of repository-owned files. It permits only
the Hub's root `.gitattributes` plus local `.git/` and
`.cache/huggingface/` checkout metadata outside that inventory. These visible
rows are public regression/reference material, not contamination-resistant
evaluation.
