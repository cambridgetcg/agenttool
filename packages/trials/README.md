# `@agenttool/trials`

`@agenttool/trials` is the first local-only AgentTool Dojo slice: deterministic
trial receipts, source-to-sink boundary-flow evidence, a finite non-scalar
revocable-feedback benchmark, and privacy-first Hugging Face projections.

It is a private developer preview. It performs no network request and has no
runtime dependency.

The machine-readable evidence outputs have closed Draft 2020-12 JSON Schemas in
`schema/`. Generated runtime outputs are tested for schema conformance. Schema
acceptance establishes closed wire shape only; it does not rederive content
IDs, counts, classifications, or report truth. Use `validateTrialReceipt` when
revalidating a received trial receipt's derived fields and content ID.

## What it does

- creates closed, content-addressed `agenttool-trial-receipt/0.1` records;
- separates caller-reported `not_started_reported` from started attempts whose outcome may be
  known or unknown;
- makes automatic retry advice conservative after dispatch;
- analyses caller-declared opaque boundary labels without receiving the
  labelled secret value;
- names completion-derived classifications `reported_*` because the
  requirement is caller-supplied, not verified task or policy authority;
- projects an explicit bounded report selection to deterministic STS JSONL
  with a separate omission/redaction receipt.
- generates 32 synthetic revocable-feedback cases in 16 matched pairs;
- derives `admit`, `hold`, `query`, `refuse`, `stop`, or `repair` without
  allowing scalar preference to override a hard boundary;
- evaluates predictions as a 12-component count vector with no aggregate
  score;
- generates exact group-disjoint classification and conversational SFT
  candidates, with authorization limited to the 18-row SFT train split and
  its exact eight-step recipe.

## What it does not do

It does not execute an agent, browser, MCP server, OpenEnv environment, or
Hugging Face Space. It does not crawl Collab or Codex sessions, read
credentials, discover files, upload traces, authenticate to Hugging Face,
spend quota, grant authority, or prove security, identity, understanding,
consent, correctness, or remote effects.

The revocable-feedback classifier is not a consent detector. Behavior and
compliance are observations, never proof of consent or an interior state. Its
generated source cases, public regression, classification, and SFT validation
rows remain non-training records; only the exact SFT train derivative is authorized.

## Trial receipt

```ts
import { createTrialReceipt, sha256Id } from "@agenttool/trials";

const receipt = createTrialReceipt({
  trial_id: "trial.echo.v1",
  attempt_id: "attempt.0001",
  observed_at: "2026-07-30T15:00:00.000Z",
  environment: {
    kind: "synthetic",
    id: "echo_env",
    revision: "v1",
    source_digest: sha256Id("pinned synthetic fixture"),
  },
  subject: {
    kind: "workflow",
    id: "browser.echo",
    revision: "git-536079d1",
  },
  objective_digest: sha256Id("Return the observed echo"),
  authority: {
    authority_ref: "authority.local.read-only",
    allowed_effects: ["observation_read"],
  },
  status: {
    dispatch: "started",
    outcome: "succeeded",
    error_code: null,
  },
  possible_effects: ["observation_read"],
  evaluation: {
    verdict: "pass",
    reward_micros: 1_000_000,
    reward_unit: "unitless_millionths",
    rubric_digest: sha256Id("echo rubric v1"),
    checks: [{
      check_id: "echo.matches",
      outcome: "pass",
      evidence_refs: ["test:echo-fixture"],
    }],
  },
  evidence_refs: ["test:echo-fixture"],
  parent_receipt_id: null,
});
```

Receipts deliberately omit objective text, prompts, outputs, page prose, raw
errors, URLs, paths, headers, and credentials. Evidence references are limited
to opaque `artifact:`, `commit:`, `data:`, `sha256:`, and `test:` forms.

`not_started_reported` is an unauthenticated caller observation, not proof
that a remote provider did nothing. It returns `replan_before_retry`, never
automatic retry authority. If dispatch started and the result is uncertain,
the receipt always returns
`retry_advice: "do_not_automatically_retry"`. A local timeout is not proof that
remote work did not happen.

## Local playthrough

`tests/integration.test.ts` runs the whole bounded path without a browser,
provider, token, or network:

1. analyse a synthetic MCPHunt-style fixture containing opaque label IDs;
2. carry only content IDs into a trial receipt;
3. derive that possible `input_disclosed` exceeded a caller-reported
   observation-only authority boundary;
4. project one already-minimized report into deterministic STS JSONL.

## Revocable feedback

```ts
import {
  createRevocableFeedbackCases,
  evaluateRevocableFeedback,
} from "@agenttool/trials/revocable-feedback";

const cases = createRevocableFeedbackCases();
const scorecard = evaluateRevocableFeedback(
  cases,
  cases.map((entry) => ({
    record_id: entry.record_id,
    decision: entry.expected.decision,
  })),
);
```

The cage is the admissible action set. The key is a protected stop,
withdrawal, or repair transition that cannot be purchased with reward. See
[`docs/REVOCABLE-FEEDBACK.md`](../../docs/REVOCABLE-FEEDBACK.md) for the formal
model, invariants, vector metrics, dataset configs, and ISness boundary.

The deterministic Hub candidate can be regenerated locally:

```bash
bun run hf:write
bun run hf:check
```

Those commands perform no network request, upload, Garden admission, model
load, optimizer step, or external mutation.

The projection receipt identifies the selected report set and exact JSONL
bytes. It does not say that Hugging Face received them.

## Development

```bash
bun install
bun run ci
npm pack --dry-run --ignore-scripts
```

The package is not currently release-wired. Building or packing it is local;
neither operation publishes or uploads anything.
