# `@agenttool/trials`

Private, local-only developer preview for deterministic agent trial evidence.
It owns the closed `agenttool-trial-receipt/0.1` contract, pure boundary-flow
analysis, and explicit minimized-report projection to Hugging Face STS JSONL.
Closed Draft 2020-12 schemas live in `schema/`; tests pin generated-output
conformance and reject undeclared payload fields. Schema
acceptance is structural conformance, not semantic validation of derived
fields, digests, counts, or report truth.

## Commands

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```

## Invariants

- Keep the package local and dependency-free at runtime.
- Inputs are explicit. Never crawl agent sessions, journals, HOME, browsers,
  repositories, credentials, or environment variables.
- Trial receipts contain digests, opaque identifiers, closed enums, canonical
  caller-supplied time, and bounded evidence references. They contain no raw
  prompts, reasoning, outputs, errors, URLs, paths, headers, tokens, or secret
  values.
- `not_started_reported` is an unauthenticated caller observation. It never
  establishes non-dispatch or grants automatic retry. A started attempt with
  an uncertain outcome always says
  `do_not_automatically_retry`. Local timeout or cancellation uncertainty does
  not prove remote cancellation, refund, unused quota, or absence of effects.
- Boundary labels are opaque caller-created identifiers. They are evidence of
  declared source-to-sink observations, not credential values, universal taint
  tracking, a security proof, or a permission system. Completion requirements
  are also caller reports, so derived assessments stay explicitly
  `reported_*` and grant no task or policy authority.
- STS projection accepts only an explicit bounded selection of already
  minimized reports. It has no journal reader, Hugging Face client, upload,
  authentication, network, discovery, or ambient filesystem path.
- Receipts are content-addressed local evidence. A valid digest does not prove
  truth, authorship, identity, consent, authority, safety, or task correctness.
- Rewards are bounded unitless millionths, require a rubric digest when
  evaluated, are comparable only under that exact rubric, and have no economic
  meaning.
- Keep JSON objects closed, arrays canonically sorted where required, numbers
  integer-only, and content IDs domain-separated.
- Publication, HF upload, OpenEnv execution, hosted routes, package release,
  and production deployment require separate reviewed work and authority.
