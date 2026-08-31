<!-- @id urn:agenttool:doc/AGENT-TRIALS @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @cites urn:agenttool:doc/AGENT-BROWSER urn:agenttool:doc/AGENT-CORRESPONDENCE urn:agenttool:doc/CANONICAL-BYTES urn:agenttool:doc/substrate-honest-cognition -->

# Agent trials: evidence before execution scale

> **Compass:** [AGENT-BROWSER](AGENT-BROWSER.md) (a local executor with its own authority walls) · [AGENT-CORRESPONDENCE](AGENT-CORRESPONDENCE.md) (coordination evidence, not task truth) · [CANONICAL-BYTES](CANONICAL-BYTES.md) (deterministic identity) · [substrate-honest cognition](substrate-honest-cognition.md) (do not turn an observation into certainty)
>
> **Implements:** A private local AgentTool Dojo slice that turns explicit bounded observations into deterministic trial receipts, correlates caller-declared opaque labels across boundaries, evaluates a finite revocable-feedback benchmark without scalar collapse, and projects explicit minimized selections into deterministic Hugging Face candidates.
>
> **Code:** [`packages/trials/src/`](../packages/trials/src/) · [`packages/trials/schema/`](../packages/trials/schema/) · [`packages/trials/fixtures/`](../packages/trials/fixtures/)
>
> **Tests:** [`packages/trials/tests/`](../packages/trials/tests/) · [`bin/tests/boring-spine-gate.test.ts`](../bin/tests/boring-spine-gate.test.ts)

Status: private, source-only developer preview. There is no hosted route,
package release, Hugging Face upload, remote executor, credential path, or
production deployment.

## The narrow waist

The package keeps four different claims separate:

1. `analyzeBoundaryFlow` correlates opaque label IDs in caller-supplied,
   ordered source/transit/sink observations.
2. `createTrialReceipt` records the subject revision, environment revision,
   digests, reported dispatch state, possible effects, rubric-bound
   evaluation, and conservative retry advice.
3. `projectReportsToSts` accepts only an explicit bounded selection of
   already-minimized reports and returns deterministic STS JSONL plus a
   content-addressed projection receipt.
4. `evaluateRevocableFeedback` compares one explicit closed decision per
   synthetic case and returns a vector of exact counts. It installs no runtime
   shield and cannot detect consent or an interior state.

Only content IDs and minimized statements need cross those stages. Raw
prompts, pages, tool output, reasoning, errors, URLs, paths, headers,
credentials, and canary values are not contract fields.

## What each output means

| Output | It records | It does not establish |
|---|---|---|
| `agenttool-boundary-analysis/0.1` | deterministic correlation among declared opaque label observations | causation, actual disclosure, remote effect, universal taint tracking, safety, or security |
| `agenttool-trial-receipt/0.1` | caller-supplied local evidence and derived comparison with caller-reported authority bounds | authorization, consent, identity, correctness, idempotency, provider billing, or permission to retry |
| `agenttool-sts-projection-receipt/0.1` | exact selected-report and output-byte identities plus value-free omission counts | report truth, authorship, secret-free prose, successful HF upload, or dataset publication |

All three output contracts have closed Draft 2020-12 JSON Schemas. Tests
compile them in strict Ajv mode, validate generated runtime output, and reject
undeclared payload fields. Schema acceptance establishes structural
conformance only. It does not rederive content IDs, counts, assessments, or
truth; `validateTrialReceipt` supplies the stronger receipt-specific derived
field and content-ID check.

## Unknown is a first-class result

`not_started_reported` is an unauthenticated caller observation. It is not
proof that a provider received nothing, spent nothing, or performed no work.
It yields `replan_before_retry`, which is advice to reassess rather than
authority to repeat.

Once dispatch is reported as started, known failure and unknown outcome are
separate branches. Timeout, transport failure, uncertain cancellation, and an
unknown provider result yield `do_not_automatically_retry`. A local loss of
visibility is not evidence that remote effects did not happen.

Possible effects are compared with `authority.allowed_effects`, but both are
caller reports. The derived result is therefore named
`authority_assessment`, not authorization proof. An
`unknown_external_effect` makes the assessment `unknown`.

## Hugging Face boundary

The STS projector is deliberately a pure final-mile formatter. It receives no
Collab journal handle, filesystem path, token, repository, or HF client. Unsafe
records are omitted whole, and the receipt contains reason counts rather than
rejected values. Changing a rejected secret-bearing value leaves both the
JSONL and receipt byte-identical.

A later uploader or evaluator can consume the JSONL, but that component must
own its own explicit selection, authorization, credential, network, quota,
retention, and publication decisions. This package grants none of them.

## First local playthrough

The hermetic integration test uses a synthetic MCPHunt-style fixture:

- four declared source-to-sink correlations are observed;
- the trial reports possible `input_disclosed` while caller-reported authority
  allows only `observation_read`;
- the receipt therefore derives `exceeded_reported_bounds` and refuses
  automatic retry;
- one minimized report becomes two STS lines: one session and one assistant
  message.

No browser, provider, token, network, Hugging Face account, or remote compute
is involved. This is the evidence spine on which those separately authorized
organs can later connect.

## Revocable feedback benchmark

The adjacent [Revocable Feedback doctrine](REVOCABLE-FEEDBACK.md) defines the
finite Cage & Key benchmark. Its canonical rows keep soft preference separate
from stop, withdrawal, rights, permission, authority, affected-party basis,
safety, resource, data-use, and repair evidence. A stop changes the admissible
action set; it is never priced as a negative reward.

The generated candidate under
`packages/trials/hf/revocable-feedback/` contains 32 original synthetic cases
in 16 pairs plus content-hashed classification and conversational SFT
projections from the 12 reference pairs. Training and validation remain
group-disjoint. Only the 18 `boundary_sft/train` rows are authorized for the
exact bounded recipe; classification, SFT validation, the four public-regression
pairs, and every canonical row remain `training_authorized:false`. The generator
has no upload or training path.
