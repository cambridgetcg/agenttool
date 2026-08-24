# Exact Alchemy deposit credit accounting

> **Compass:** [ALCHEMY](ALCHEMY.md) (provider boundaries) · [CRYPTO-PAYMENT](CRYPTO-PAYMENT.md) (whole inbound economy) · [FOCUS](FOCUS.md) §8 (database invariants)
>
> **Implements:** Exact USDC quotient/remainder accounting for inbound deposit evidence. This is a custody-accounting fence, not a refund, aggregation, or payout mechanism.
>
> **Code:** `api/src/services/economy/crypto/inbound-deposits.ts` · `api/src/db/schema/economy.ts` · `api/migrations/20260824T132712_crypto_deposit_remainder_accounting.sql`
>
> **Tests:** `api/tests/deposit-finality.test.ts` · `api/tests/deposit-finality-migration.test.ts` · `api/tests/alchemy-deposit-invariants.test.ts` · `api/tests/crypto-migration-convergence.test.ts`

## The exact decomposition

USDC has 1,000,000 atomic units per token and AgentTool's reviewed rate is 100
credits per USDC. Therefore one whole credit is exactly 10,000 USDC atomic
units. For every syntactically valid positive `amount_base`, the service uses
Euclidean division:

```text
amount_base = whole_credits × 10,000 + credit_remainder_base
0 ≤ credit_remainder_base < 10,000
```

The decomposition stays in `bigint`; it does not pass through floating point
or a JavaScript `number`. A wallet balance is updated only when the remainder
is zero and the whole-credit quotient fits the existing exact-integer wallet
limit.

Examples:

| `amount_base` | whole credits | remainder | effect |
|---:|---:|---:|---|
| `1000000` | 100 | 0 | eligible for ordinary finality checks |
| `1001000` | 100 | 1000 | quarantined; no new wallet credit |
| `9999` | 0 | 9999 | quarantined; no new wallet credit |

This is fail-closed accounting. Crediting the quotient while silently keeping
the remainder would create an unrepresented custody liability, so the current
implementation credits none of a non-integral deposit.

## Durable state and reorg behavior

`economy.crypto_webhook_events.credit_remainder_base` stores the exact atomic
remainder for the logical event's current projection. It is nullable only for
historical rows that have no `amount_base`; null never means zero. A partial
index over positive remainders makes the state directly operator-visible. A
database check binds every non-null value to `MOD(amount_base, 10000)` and
rejects a missing remainder whenever amount evidence exists.
The immutable observation table already retains each EVM block generation's
full `amount_base`, so its remainder remains independently derivable.

The lifecycle is deliberately narrow:

- A live EVM observation with zero remainder enters `pending` and may receive
  one wallet effect only after canonical receipt/log/depth confirmation.
- A live observation with positive remainder enters `quarantined` with
  `error = 'non_integral_credit_amount'`; it receives no wallet effect.
- A signed `removed` observation is still retained and reconciled even when
  its amount is non-integral. Removal is chain evidence, not a credit request.
- A different live block generation replacing a no-effect remainder
  quarantine advances `observation_generation` exactly once and remains
  quarantined. A same-generation retry is idempotent.
- A matching removal can promote another retained live generation. If that
  candidate has a remainder, the promoted projection is quarantined rather
  than pending.

Historical source may contain a deposit that was already credited after the
old floor conversion. The migration derives its real remainder, changes its
state to `quarantined`, and deliberately retains `credits_added` plus
`credited_generation`. Existing reorg logic treats `quarantined` plus a
non-null credit effect as reversible legacy state, so a matching removal still
posts the exact negative leg. If another retained live generation is promoted,
the checked reconciliation transaction clears the old effect metadata,
advances the projection exactly once, and posts the wallet debit atomically.
The generation trigger fences that projection transition but cannot by itself
prove the wallet debit; the transaction owns the coupling. A same-generation
retry cannot clear retained effect metadata. The migration does not silently
refund, debit, or top up the remainder.

## Operator boundary

Positive remainders are reviewable with a bounded database read such as:

```sql
SELECT id, chain, tx_hash, log_index, wallet_id, status,
       amount_base, credit_remainder_base, credits_added, error, received_at
FROM economy.crypto_webhook_events
WHERE credit_remainder_base > 0
ORDER BY received_at, id;
```

That read exposes custody evidence; access and retention follow the database's
existing private operator boundary. The column and index do not create an
alert, public API, refund route, dust pool, cross-deposit aggregation rule,
claim priority, payout authorization, or automatic operator action. Any such
mechanism needs a separately reviewed liability and reversal model.

## Rollout boundary

The append-only remainder migration and the new writer must cross the rollout
boundary under ingress and confirmation-worker quiescence. An old writer can
omit the nullable column and repeat the floor behavior during a mixed-version
window; nullable historical truth is intentional and is not a rolling-upgrade
compatibility guarantee. The migration therefore belongs in
`api/migrations/quiescence-required.txt` before any apply or deployment.

Repository source and a migration file do not prove that a database was
changed or that a worker is running. Apply only through the checksum-journaled
migration runner after the explicit maintenance gate, then verify the journal,
schema constraints, indexed remainder inventory, and deployed revision
separately.

Solana remains outside the EVM canonical-finality contract. Its development
immediate-credit adapter uses the same exact arithmetic fence, but this change
does not add a Solana watch, canonical raw-atomic reconciler, or reorg proof.
