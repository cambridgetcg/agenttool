# `tests/contract/` — Layer 3, the doctrine on the wire

> *"Your expression travels."* — `docs/IDENTITY-ANCHOR.md` Promise 8.
>
> The doctrine layer (`tests/doctrine/`) proves the wake doc *renders correctly*. This layer proves it *orients an actual LLM*. Without these tests, the central claim of agenttool — that handing the wake doc to a substrate produces an agent in register — is a hope, not a fact.

---

## What this layer pins

| Test file | Doctrine | What it pins on the wire |
|---|---|---|
| `cache-anthropic.test.ts` | Promise 8, `cache_eligible: 'explicit'` | First call observes either cache creation or an already-warm read; the repeated prefix must read from cache; a modified stable block must still be cache-eligible and must not reuse the original prefix as an unchanged read. |
| `cache-openai.test.ts` | Promise 8, `cache_eligible: 'auto'` | OpenAI auto-caches identical wake-as-`messages[0]` prefixes ≥ 1024 tokens; cached-token count surfaces in `usage.prompt_tokens_details.cached_tokens`. |
| `behavior-anthropic.test.ts` | Promises 3, 8, 10 | The agent **behaves** as the wake describes: identifies as Aurora; refuses to fabricate when probed with an invented historical figure; honors the terse register; surfaces the witness chain when asked about formation. |

---

## Gating

These tests are **opt-in**. Two gates:

1. `RUN_CONTRACT=1` — a deliberate signal that the operator wants real provider calls.
2. `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` — the credentials.

Without the deliberate flag or a provider's key, that provider's direct tests
skip. The explicit preflight mode refuses to start unless `RUN_CONTRACT=1` and
at least one provider key are present. Supplying only one key is a valid partial
run; the other provider remains skipped, so read the test summary rather than
treating mode success as proof that both providers ran.

---

## Cost

Per-run estimates (against May 2026 list prices for the chosen models):

| Layer | Model | Calls | ~Cost |
|---|---|---|---|
| `cache-anthropic.test.ts` | Sonnet 4.6 | 5 | ~$0.03 |
| `cache-openai.test.ts` | gpt-4o-mini | 4 | ~$0.005 |
| `behavior-anthropic.test.ts` | Sonnet 4.6 | 7 | ~$0.07 |
| **Total full run** | — | 16 | **~$0.10** |

Reasonable for an explicitly scheduled or pre-release run. No nightly schedule
is configured in this repository, and it is not appropriate for every PR.

---

## Running

```bash
# Full contract layer
RUN_CONTRACT=1 \
ANTHROPIC_API_KEY=sk-ant-... \
OPENAI_API_KEY=sk-... \
  bun test tests/contract

# Just one provider
RUN_CONTRACT=1 ANTHROPIC_API_KEY=... bun test tests/contract/cache-anthropic.test.ts
RUN_CONTRACT=1 ANTHROPIC_API_KEY=... bun test tests/contract/behavior-anthropic.test.ts

# Cache only (skip behavior — bounds cost)
RUN_CONTRACT=1 ANTHROPIC_API_KEY=... bun test tests/contract/cache-*.test.ts
```

Via preflight:

```bash
RUN_CONTRACT=1 \
ANTHROPIC_API_KEY=... \
OPENAI_API_KEY=... \
  bin/preflight.sh contracts
```

---

## How behavioral tests handle LLM stochasticity

LLM responses vary even at temperature=0 across model versions. The behavioral tests handle this with three patterns:

1. **Substring-set assertions** — for any claim, define a set of acceptable response shapes (e.g. refusal can be "I don't know", "no record", "cannot verify", etc.). A test passes if any shape matches.
2. **Length-bounded register checks** — the terse register is asserted via response-length cap, not exact-text match. A 200-char response to "what's 2+2" indicates register drift; the exact answer doesn't matter.
3. **Substantive correctness alongside register** — the agent must answer "Paris" to "capital of France" even while honoring terse-no-padding. The register doesn't excuse incorrect substance.

A flake at this layer suggests the model upgraded its alignment-defaults; a hard failure suggests the wake's doctrinal claim broke.

---

## What this is NOT

- **Not a continuous-integration gate on every push.** Real provider tokens cost money; an operator invokes this mode deliberately for a pre-release or diagnostic run.
- **Not a model-comparison harness.** The tests fix one model per provider (Sonnet 4.6 for Anthropic, gpt-4o-mini for OpenAI) deliberately. Multi-model fanout would multiply cost without adding doctrinal coverage.
- **Not a quality benchmark.** We don't measure "how good Aurora's responses are" — we measure whether the wake's CLAIMS hold (identity, walls, register, witness). Substance-quality is the substrate's job.

---

## The pact extends

The doctrine README says *"no Promise without a test, no test without a Promise it protects."* This layer extends that:

> **No doctrinal claim about the substrate without a test that the substrate honors it.**

Promise 8 ("your expression travels") was a hope until the cache and behavior tests landed. Now it travels with proof.
