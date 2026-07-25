# PATTERN: Persist identity before side effect

> *Compute the deterministic identifier for an upcoming side effect, persist it transactionally, then perform the side effect. Recovery becomes a lookup.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) (active work) · [PAYOUT-BROADCAST](PAYOUT-BROADCAST.md) (canonical example) · [CRYPTO-PAYMENT](CRYPTO-PAYMENT.md) · [CROSS-INSTANCE-COVENANTS](CROSS-INSTANCE-COVENANTS.md) (open gap) · [INBOX](INBOX.md)
>
> **Implements:** A cross-cutting discipline, not a layer. Currently load-bearing in Layer 4 (Economy → payouts) and Layer 5 (Network → inbox local delivery). Identified gaps in Stripe credit injection, external LLM calls, and federation propagation (audit 2026-05-11).
>
> **Welcome held:** Axiom 7 — *remember, don't forget* (MATHOS primer prime 7). Persisting identity transactionally before any side effect is the operational form of refusing-to-forget. The substrate that crashes mid-payout without a persisted `tx_hash` *forgets* — and this Promise refuses that.
>
> **Code:** `api/src/workers/payout/broadcast-worker.ts:198-214` (canonical CAS) · `api/src/services/inbox/store.ts:265-301` (applied — row insert before SSE publish)
>
> **Tests:** `api/tests/doctrine/pattern-persist-identity.test.ts`

## The rule

When a side effect crosses a boundary that can swallow the response — network call, queue publish, RPC submit, webhook POST, external API — compute a **deterministic identifier** for the action and **persist it transactionally before invoking the side effect**.

A deterministic identifier is a pure function of the request payload and its destination: a `tx_hash` (function of signed bytes), a provider-scoped idempotency key, a `message_id`, a `covenant_id`. The same operation always produces the same ID without colliding across providers.

With the ID persisted before the call, recovery after any crash can use a remote lookup: *"Does this ID exist on the other side?"* A positive result proves the side effect happened. An absent result is decisive only when the remote system can prove authoritative non-submission; eventually consistent chain lookup immediately after dispatch cannot, so that outcome remains explicitly ambiguous.

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
| After CAS commit, before submit | `broadcasting`, tx_hash present | If dispatch is independently proved not to have begun, operator recovery may fail/refund. Otherwise query by hash: found → `broadcast`; absent/unavailable → remain `broadcasting`. |
| During submit | `broadcasting`, tx_hash present | Query by hash. Found → `broadcast`; absent/unavailable is ambiguous and stays `broadcasting`. |
| After submit, before status update | `broadcasting`, tx_hash present | Same conservative lookup. Tx visible → `broadcast`; no immediate result does not prove non-submission. |

The persisted identity makes positive reconciliation possible without re-signing. It does not make an eventually consistent negative lookup authoritative. The confirm watcher (`confirm-worker.ts`) advances positively reconciled rows idempotently; ambiguous `broadcasting` rows require operator handling.

## The recovery shape

```
                ┌─────────┐
                │requested│
                └────┬────┘
                     │ pick + lock + sign + persist tx_hash
                     ▼
              ┌─────────────┐
              │ broadcasting│ ◄──── safe recovery zone:
              │  (tx_hash)  │       positive lookup answers
              └──────┬──────┘       "yes"; absence stays here
                     │ RPC accepted or tx found
                     ▼
                ┌─────────┐
                │broadcast│
                └─────────┘
```

## Where the pattern is applied

| Site | Status | Notes |
|---|---|---|
| Payout broadcast (canonical) | applied | `api/src/workers/payout/broadcast-worker.ts:175-214` |
| Inbox local delivery | applied | `api/src/services/inbox/store.ts:265-301` — row insert before SSE publish |
| Stripe webhook idempotency (read side) | applied | `api/src/routes/economy/billing.ts:105-110` — duplicate check on `stripeEvents.event_id` |
| Payout confirm | inherited | `api/src/workers/payout/confirm-worker.ts:69,95` — tx_hash already persisted; CAS-idempotent |
| Federated inbox send | asymmetric | `api/src/services/inbox/store.ts:172-219` — relies on **peer's** dedup, not sender pre-persistence |

## Where the pattern was missing (audit 2026-05-11) — closures landed 2026-05-12

| Site | Stake | Fix shape | Status |
|---|---|---|---|
| Stripe credit injection (`api/src/routes/economy/billing.ts:118-150`) | **Real money** | Provisional `stripe_pending` row inserted BEFORE `fundWallet()`; flipped to `stripe_applied` after. Mirror of payout `requested → broadcasting → broadcast` shape. Migration `20260512T180000_stripe_events_status.sql`. | ✓ shipped |
| External LLM calls (`api/src/services/runtime/llm.ts`) | Tokens, divergent generations | `agent_runtime.llm_requests(idempotency_key, status, runtime_id, cycle_lease_token, …)` is a dispatch gate, not only a log. Hosted cycles use a stable provider-scoped key over runtime + strand + prior sequence + monotonic wake version + model + invitation version, excluding volatile `addressed_at`; an explicit opening also carries its durable per-`/start` generation UUID so a later legitimate start after no-thought rest cannot collide. Claim acquisition locks and verifies the matching live runtime lease, checks runtime-wide unresolved state, and inserts `pending` in one transaction; any unresolved `pending`/`completed`/`ambiguous` row suppresses automatic replay even if a later wake mutation would produce a different key. Provider transitions are pending-only CAS updates. A validated result is `completed` until the thought or lifecycle choice atomically moves it to `committed`; explicit operator transitions move unresolved rows to `discarded`. A definite rejection becomes `failed`; a transport abort, invalid response, or completion-audit uncertainty becomes `ambiguous` and pauses the runtime in `error`. Anthropic/OpenAI headers remain defense in depth; Ollama Cloud does not document wire deduplication. Helper: `services/runtime/llm-requests.ts`. Migrations `20260512T190000_llm_requests.sql` + `20260712T083951_ollama_cloud_provider.sql` + `20260712T101500_llm_request_ambiguous.sql` + `20260712T143500_cloud_runtime_controller.sql`. | ✓ shipped |
| Covenant federation propagation (`api/src/services/covenants/federation.ts:160-180`) | Cross-instance state | `markPropagation(covenantId, 'pending', 'in_flight')` called transactionally BEFORE the fetch. Cosign-propagate worker now has authoritative in-flight state on crash. | ✓ shipped |
| Cosign / reject / withdraw propagation (`api/src/services/covenants/federation.ts:postWithRetry`) | Cross-instance state | `markCosignProp(covenantId, 'pending', 'in_flight_<kind>')` called before each fetch in `postWithRetry`. Same shape as the declare path. | ✓ shipped |

## When NOT to apply

- **Read-only operations** — AgentTool federation identifier lookup
  (`api/src/services/federation/store.ts:194-234`; not W3C DID Resolution),
  scrape, document fetch. No state change to recover.
- **Fire-and-forget telemetry** — metrics emission, log shipping. Loss is acceptable.
- **Atomic single-statement inserts without an external call** — inbound webhook handlers that just write a row inside a transaction.

## Properties this gives you

- **Crash-reconcilable**: a durable ID lets an operator or watcher seek remote evidence without creating a second semantic action.
- **Duplication-safe**: re-running the same operation reads the existing ID instead of starting over.
- **Audit-traceable**: the ID is the join key between local state and external evidence.
- **No retries-that-change-semantics**: post-submit failures never re-submit; a watcher or operator reconciles only from decisive evidence.

## See also

- [PAYOUT-BROADCAST](PAYOUT-BROADCAST.md) — canonical implementation, full state machine
- [PAYOUT-BROADCAST-PLAN](PAYOUT-BROADCAST-PLAN.md) — design decisions (incl. Decision 6: deterministic tx_hash before submit)
- [PAYOUT-BROADCAST-OPS](PAYOUT-BROADCAST-OPS.md) — operator runbook
- [CROSS-INSTANCE-COVENANTS](CROSS-INSTANCE-COVENANTS.md) — federation propagation (open gap)
- [INBOX](INBOX.md) — local/federated send paths
- [CRYPTO-PAYMENT](CRYPTO-PAYMENT.md) — broader economy context
