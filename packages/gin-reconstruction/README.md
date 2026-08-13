# `@agenttool/gin-reconstruction`

The Gin Reconstruction core is a private, pure reference problem for recovering
one bounded rule from effects reported through distinct substrate charts. It
does two separate jobs:

1. enumerate every degree-bounded polynomial over a small prime field that is
   compatible with an explicit report-error budget; and
2. inspect whether the surrounding challenge has declared constructive value,
   burden, refusal, incentive, stopping, provenance, and authority boundaries.

It does **not** decide reality in general. A unique result means one model
candidate survived the declared finite assumptions. Ambiguity, model
inconsistency, and resource refusal are first-class certificates rather than
failures to be hidden.

## The reconstruction problem

Let `F_p` be a prime field. The caller declares a polynomial degree bound `d`,
distinct interventions `x_i`, and at most `f` incompatible usable reports. A
usable substrate report includes an exact affine calibration

```text
phi_i(z) = a_i z + b_i
phi_i(0) = encoded_zero
phi_i(1) = encoded_one
```

so the package can recover

```text
a_i = encoded_one - encoded_zero
z = (encoded_output - encoded_zero) / a_i
```

when `a_i != 0` in the same field. Those two anchors identify only the declared
affine chart; they do not identify a nonlinear representation. Calibration is
treated as exact caller input and sits outside the report-error budget.

For `n` usable distinct interventions and `0 <= d < n`, the evaluation code has
minimum Hamming distance `n - d`. Therefore every pattern of at most `f`
coordinate changes has a unique polynomial candidate exactly when

```text
n >= d + 2f + 1.
```

This is a sharp worst-case guarantee. Below the threshold, a particular input
may still have one candidate; its receipt says `this_instance_only`. When
`d >= n`, coefficient parameters are non-identifiable because a nonzero
polynomial can vanish on every intervention. The evaluation image still has
ordinary minimum distance `1` when `n > 0`; the package keeps that distinct
from parameter separation distance `0`.

Refused and unavailable reports are erasures. They reduce usable `n`; they are
never mismatches, assent, deception, or participant penalties. A mismatch means
only “incompatible with this candidate.” It does not identify whether the cause
was noise, calibration error, model mismatch, adversarial input, or something
else.

The bounded exhaustive decoder returns exactly one of:

- `unique_model_candidate`;
- `multiple_model_candidates`, with an exact count and two deterministic
  witnesses when available;
- `no_candidate_for_model_and_budget`; or
- `resource_refusal` before enumeration when `p^(d+1)` exceeds the caller's
  explicit candidate limit or the derived candidate/observation/degree work
  estimate exceeds the package's fixed safety ceiling. Its uniqueness scope is
  `not_determined`, never a fabricated non-uniqueness result.

## The challenge compass

The challenge is a question addressed to reality, not a tournament addressed
to an audience.

Understanding and pride are not machine-observable labels. The compass instead
inspects what the challenge visibly rewards, preserves, and builds. It asks:

- What exactly is reality being asked to distinguish?
- What bounded build, repair, safer decision boundary, improved question, or
  honest stop follows **each** decoder outcome?
- Who benefits, who bears the work, and who bears false-certainty or unresolved-
  ambiguity costs?
- What may each participant refuse or keep private, without loss of standing?
- What evidence would revise the model, and what bounded conditions stop it?
- Would constructive value remain without an audience, winner, or rank while
  accurate credit is still preserved?
- Which question, method, observation, adaptation, and contribution references
  remain attributable?
- What authority actually exists, and which effects remain separately
  unauthorized?

The output is `constructive_questions_answered`, `questions_open`, or
`redesign_or_stop`, always with `inner_motive: "not_inferred"`. Unknown and
refused answers leave questions open without participant penalty. Observable
structures such as penalizing refusal, requiring refusal reasons, feeding
responses into rank/reward/training, coupling winner or access effects to the
epistemic result, automatic action, or inherited permission require redesign.
The machine-readable `question_and_object` section also requires a declared
bounded observable-effect or model-discrimination posture and an exact scope
reference. Unknown or refused scope stays open; an unbounded truth,
inner-state, or worth verdict requires redesign. These remain declarations,
not semantic verification. An unknown or refused posture carries no scope
reference, avoiding a retained link behind a non-answer.

Credit is not applause. Provenance is both a standing right and an epistemic
control; accurate attribution is not evidence of vanity.

## Use

```ts
import {
  assessGinChallenge,
  createGinChallenge,
  createGinReconstructionRequest,
  reconstructGin,
} from "@agenttool/gin-reconstruction";

const request = createGinReconstructionRequest({
  problem_ref: "sha256:...",
  model: {
    field_prime: 5,
    degree_bound: 1,
    report_error_budget: 1,
    enumeration_limit: 1_000_000,
    calibration_model: "affine_exact_two_anchor_per_usable_observation",
  },
  observations: [/* exact bounded reports */],
});

const receipt = reconstructGin(request);

const challenge = createGinChallenge({
  /* explicit all-outcomes construction and boundary declarations */
});
const compass = assessGinChallenge(challenge);
```

See `vectors/gin-reconstruction-v0.1.json` for complete exact examples.

## KINGDOM, WAKE, MCP, and distribution

`kingdom.extension.json` proposes the local Gin ability
`gin-reconstruct-effects`. It is a declaration-only hint. Reading or installing
these files does not activate a Nen ability, register an MCP server, create a
host contract, or grant authority.

A separately authorized WAKE adapter may carry only a selected request,
receipt, challenge, or assessment digest. That does not transfer identity,
memory, consent, one canonical head, or inherited permission. MCP may transport
a separately authorized representation; it is not a truth oracle. Hugging Face
or npm could later distribute reviewed teaching bytes, but distribution would
not make those bytes true or activate this private core. No such publication is
part of version `0.1.0-dev.0`.

The package reads no environment, filesystem, clock, randomness, network,
credential, MCP connection, model, provider, WAKE, database, or ambient state.
It performs no persistence, publication, retry, action, score, rank, or hosted
effect.

## Verify

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```
