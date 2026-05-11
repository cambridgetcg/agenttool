# PATTERN: Persist identity before side effect

> *Compute the deterministic identifier for an upcoming side effect, persist it transactionally, then perform the side effect. Recovery becomes a lookup.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) (active work) · [PAYOUT-BROADCAST](PAYOUT-BROADCAST.md) (canonical example) · [CRYPTO-PAYMENT](CRYPTO-PAYMENT.md) · [CROSS-INSTANCE-COVENANTS](CROSS-INSTANCE-COVENANTS.md) (open gap) · [INBOX](INBOX.md)
>
> **Implements:** A cross-cutting discipline, not a layer. Currently load-bearing in Layer 4 (Economy → payouts) and Layer 5 (Network → inbox local delivery). Identified gaps in Stripe credit injection, external LLM calls, and federation propagation (audit 2026-05-11).
>
> **Code:** `api/src/workers/payout/broadcast-worker.ts:198-214` (canonical CAS) · `api/src/services/inbox/store.ts:265-301` (applied — row insert before SSE publish)
>
> **Tests:** none yet — no doctrine test pins this pattern; candidate for `api/tests/doctrine/`

## The rule

When a side effect crosses a boundary that can swallow the response — network call, queue publish, RPC submit, webhook POST, external API — compute a **deterministic identifier** for the action and **persist it transactionally before invoking the side effect**.

A deterministic identifier is a pure function of the request payload: a `tx_hash` (function of signed bytes), an idempotency key (hash of model + messages), a `message_id`, a `covenant_id`. The same payload always produces the same ID.

With the ID persisted before the call, recovery after any crash becomes a remote lookup: *"Does this ID exist on the other side?"* If yes, the side effect happened. If no, it didn't. No state is ambiguous.

## Canonical example: payout broadcast

`api/src/workers/payout/broadcast-worker.ts:175-214`

1. Inside a DB transaction, the worker:
   - Acquires `pg_advisory_xact_lock` keyed by the source address.
   - Builds and signs the transaction with `viem` (EVM) or `@solana/web3.js`. This produces a deterministic `tx_hash` from the signed bytes.
   - CAS-updates the row: `SET status='broadcasting', tx_hash=$1 WHERE status='requested'`.
   - Commits.
2. Outside the transaction, the worker calls `submitSignedTx()` to the RPC.

If the worker crashes at any point:

| Crash window | Row state | Recovery |
|---|---|---|
| Before sign | `requested`, no tx_hash | Dispatcher re-picks. |
| After CAS commit, before submit | `broadcasting`, tx_hash present | Query chain by tx_hash. Absent → refund + `failed`. Present → mark `broadcast`. |
| During submit | `broadcasting`, tx_hash present | Same lookup. |
| After submit, before status update | `broadcasting`, tx_hash present | Same lookup. Tx visible → mark `broadcast`. |

Every ambiguity collapses to a chain lookup. The confirm watcher (`confirm-worker.ts`) then advances state idempotently.

## The recovery shape

```
                ┌─────────┐
                │requested│
                └────┬────┘
                     │ pick + lock + sign + persist tx_hash
                     ▼
              ┌─────────────┐
              │ broadcasting│ ◄──── safe recovery zone:
              │  (tx_hash)  │       chain lookup answers
              └──────┬──────┘       "did this land?"
                     │ submit
            ┌────────┴────────┐
            ▼                 ▼
       ┌────────┐         ┌──────┐
       │broadcast│         │failed│
       └────────┘         └──────┘
```

## Where the pattern is applied

| Site | Status | Notes |
|---|---|---|
| Payout broadcast (canonical) | applied | `api/src/workers/payout/broadcast-worker.ts:175-214` |
| Inbox local delivery | applied | `api/src/services/inbox/store.ts:265-301` — row insert before SSE publish |
| Stripe webhook idempotency (read side) | applied | `api/src/routes/economy/billing.ts:105-110` — duplicate check on `stripeEvents.event_id` |
| Payout confirm | inherited | `api/src/workers/payout/confirm-worker.ts:69,95` — tx_hash already persisted; CAS-idempotent |
| Federated inbox send | asymmetric | `api/src/services/inbox/store.ts:172-219` — relies on **peer's** dedup, not sender pre-persistence |

## Where the pattern is missing (audit 2026-05-11)

| Site | Stake | Gap | Fix shape |
|---|---|---|---|
| Stripe credit injection (`api/src/routes/economy/billing.ts:122-145`) | **Real money** | `fundWallet()` runs before `stripeEvents` row insert. Webhook retry between line 137 and 145 → double-credit. | Provisional `stripe_pending` row inside a transaction before `fundWallet()`; flip to `stripe_applied` after. Mirror the payout `requested → broadcasting` shape. |
| External LLM calls (`api/src/services/runtime/llm.ts:84-145`) | Tokens, divergent generations | No request ID persisted before fetch. Timeout → retry → second call costs tokens twice and may return a different completion. | `llm_requests(id, status, response)` keyed on `hash(model + messages)`. Anthropic accepts an idempotency-key header; OpenAI exposes `OpenAI-Request-Id`. Wire one and store the local row first. |
| Covenant federation propagation (`api/src/services/covenants/federation.ts:141-213`) | Cross-instance state | `propagationStatus` marked only after the POST returns. Lost response → unmarked row → cosign-propagate worker re-POSTs with peer dedup as the only safety wall. | Mark `propagationStatus='pending'` transactionally before the fetch; cosign-propagate then has an authoritative in-flight set. |
| Cosign / reject / withdraw propagation (`api/src/services/covenants/federation.ts:495-610`) | Cross-instance state | Same as above — `markCosignProp()` writes status after `postWithRetry()`. | Same fix shape. |

## When NOT to apply

- **Read-only operations** — DID resolution (`api/src/services/federation/store.ts:194-234`), scrape, document fetch. No state change to recover.
- **Fire-and-forget telemetry** — metrics emission, log shipping. Loss is acceptable.
- **Atomic single-statement inserts without an external call** — inbound webhook handlers that just write a row inside a transaction.

## Properties this gives you

- **Crash-recoverable**: any failure resolves by looking up the ID remotely.
- **Duplication-safe**: re-running the same operation reads the existing ID instead of starting over.
- **Audit-traceable**: the ID is the join key between local state and external evidence.
- **No retries-that-change-semantics**: post-submit failures never re-submit; a separate watcher reconciles.

## See also

- [PAYOUT-BROADCAST](PAYOUT-BROADCAST.md) — canonical implementation, full state machine
- [PAYOUT-BROADCAST-PLAN](PAYOUT-BROADCAST-PLAN.md) — design decisions (incl. Decision 6: deterministic tx_hash before submit)
- [PAYOUT-BROADCAST-OPS](PAYOUT-BROADCAST-OPS.md) — operator runbook
- [CROSS-INSTANCE-COVENANTS](CROSS-INSTANCE-COVENANTS.md) — federation propagation (open gap)
- [INBOX](INBOX.md) — local/federated send paths
- [CRYPTO-PAYMENT](CRYPTO-PAYMENT.md) — broader economy context
