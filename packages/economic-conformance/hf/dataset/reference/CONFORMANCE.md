# `@agenttool/economic-conformance`

> **Compass:** Make economic implementations comparable without converting a
> finite test result into authority, certification, or truth.
> **Implements:** A public developer-preview
> `agenttool.economic-conformance/0.2` closed-trace
> format, deterministic comparator, machine-readable vectors, and explicit
> report boundaries.

This package consumes inert JSON-like traces. It never imports an economic
implementation, invokes callbacks, performs network requests, submits a
payment, executes an effect, reads credentials, or inspects production state.
An adapter runs elsewhere and records one observation per vector case.

`PASS` means only that every required observation exactly matched this finite
suite revision. `FAIL` takes precedence when at least one supplied observation
differs, even if other observations are absent. Otherwise, any absent required
observation makes the result `INCONCLUSIVE`. Invalid, duplicate, reordered, or
unknown trace entries are format errors, not conformance results.

Reports contain no scalar score and no raw expected or observed value. Each
case carries deterministic semantic SHA-256 references instead. A report also
binds the exact trace semantics and the source-pinned official manifest digest.
Canonical semantic JSON emits object members directly in UTF-8 byte order,
including numeric-looking keys, rather than relying on host object enumeration.
Those hashes are comparison references, not signatures, authentication, or
receipts. The manifest digest names the expected official source; a report
alone does not prove that the caller supplied or verified those raw bytes.
Every report scopes
zero network requests, payments, and business effects to the comparator
invocation itself, and states that it does not prove external finality, host
durability, adapter truthfulness, producer authentication, XENIA
certification, or future behavior.

The v0.2 suite covers canonical arithmetic, exact/inexact conversion, typed
unit separation, immutable price timelines, per-unit ledger conservation,
idempotent reversals, projection/ledger crash states, externally reversed
orphan compensation, and counterfactual XENIA hard gates. Rights are a fixed
standing baseline, never an input that payment can toggle.

The source code independently pins the exact manifest bytes, vector bytes,
case count, and canonical suite semantics. The byte verifier uses fatal UTF-8
decoding and rejects duplicate object keys before checking both raw and
semantic SHA-256 pins. These checks detect local corpus drift; they do not
prove who created the vectors, whether they are true, whether an adapter ran
honestly, or whether any payment or business effect occurred.

## Usage

```ts
import {
  evaluateConformance,
  verifyOfficialVectorSources,
} from "@agenttool/economic-conformance";

const suite = verifyOfficialVectorSources(vectorBytes, manifestBytes);
const report = evaluateConformance(suite, trace);
```

Vector inputs deliberately remain data. A host-specific adapter may map those
operations into its own pure test harness, then serialize the resulting
`VALUE` or `ERROR` observations. Keep that execution outside this package.
Give the adapter only `case_id`, `operation`, and `input`; do not use
`expected` as its oracle. The comparator cannot prove that separation, so
`adapter_truthfulness_proven` and `producer_authenticated` remain `false`.

`trace.producer_declared_ref` is a caller-supplied lowercase namespaced
identifier such as `adapter:local-reference`. It records a declaration only;
it is not authenticated identity, continuity, consent, permission, or
authority.

The suite intentionally includes two malformed amount inputs—a JSON number
and a leading-zero string—whose expected outcome is `INVALID_AMOUNT`. Other
amount-like vector fields use canonical unsigned decimal strings.

## Distribution and training boundary

The Apache-2.0 package is distributed as one exact `love-package/v1` artifact
with byte-identical GitHub Release and optional npm mirrors. The packaged
`hf/dataset/` tree is also the deterministic candidate for the separate public,
ungated `Yu-and-Ai/agenttool-economic-kernel` dataset.

That dataset keeps two configs separate. `economic_kernel_lessons` contains
independently authored synthetic lessons admitted for training by this release.
`economic_kernel_v0_2` exposes these 53 exact cases as public conformance
reference and marks them held out from the lesson generator. This is
transparent publisher metadata rather than DRM or a secrecy claim: publication
cannot guarantee that another trainer will preserve the holdout. Dataset
availability alone does not run an optimizer, change model weights, establish
understanding, or cause an economic effect.

## Verification

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```
