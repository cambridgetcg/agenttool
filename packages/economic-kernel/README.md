# `@agenttool/economic-kernel`

> **Compass:** Make economic state exact and repairable without allowing money
> to buy authority, safety, participation, identity, dignity, or truth.
> **Implements:** A private, pure `agenttool.economic-kernel/0.1` reference for
> typed units, immutable price revisions, exact conversions, conserved ledger
> transactions, independent payment/effect attempts, and hard-gate admission.
> **Code:** `packages/economic-kernel/src/`
> **Tests:** `packages/economic-kernel/tests/` and the separate
> `packages/economic-conformance/` finite suite.

The kernel is an offline transition library. It does not fetch, quote live
markets, persist, sign, pay, settle, mint, execute a business action, reconcile
a provider, inspect credentials, expose a route, publish, or deploy. Returned
records are bounded validated snapshots, not proof that a caller persisted or
observed what a reference says.

## The unit wall

An amount is always `{ unit_id, amount_atomic }`; a ledger delta is always
`{ unit_id, delta_atomic }`. Unit definitions are namespaced and bind a
dimension, decimal exponent, ledger domain, and transferability. Thus
`iso4217:gbp:minor`, Base USDC atomic units, and
`agenttool:project-api-credit/1` cannot accidentally share arithmetic merely
because a UI calls each one “credits”.

`dimension`, `transferability`, and ledger `account_kind` are closed
declarations, not an authorization engine. V0.1 does not decide who may issue,
mint, transfer, or revoke a unit, and it does not derive account balances from
accounting policy. The host must enforce those rules before committing a
validated transaction.

All wire amounts are canonical decimal strings and arithmetic uses `BigInt`.
The v0.1 bound is unsigned 256-bit magnitude. There are no floats, scientific
notation, leading zeroes, implicit minor units, or ambient exchange rates.

## Prices and conversion

A price revision has a content-derived `sha256:` identity over all semantic
fields. A price book is an immutable, non-overlapping revision chain. Revision
`r` defines the directed ratio

```text
output_atomic = input_atomic * output_atomic_per_lot / input_atomic_per_lot
```

under the half-open interval `[effective_from, effective_until)`. The first
revision is `1`; later revisions are contiguous in revision number and point
to the exact predecessor. A conversion names one revision and an explicit
observation time. `EXACT_ONLY` rejects a fractional result;
`RETURN_REMAINDER` reports the dividend, divisor, and fractional remainder but
returns no spendable output amount. It never truncates or discards it.

Different products or accounting domains use different unit and price-book
identities. Two rails claiming the same book cannot install simultaneous
incompatible prices.

A quote also has a content-derived identity over its exact SHA-256 action,
participants,
exact input and output amounts, complete price revision, and validity window.
Reordering object keys cannot change it, while changing any term invalidates
it. These hashes bind bytes to terms; they do not authenticate an issuer,
authorize a price, prove market truth, or provide a signature. A host must
authorize quote and price sources separately.

## Conservation

Every transaction contains two or more non-zero postings. For every unit in
every ledger domain:

```text
sum(debit.amount_atomic) = sum(credit.amount_atomic)
```

A USDC-to-entitlement conversion therefore has two independently balanced
legs: transfer of USDC and issuance of the entitlement, under one pinned price
revision and explicit conversion reference. The journal validator replays all
prior entries, rejects duplicate identities or semantic requests, backwards
time, and forged or repeated reversals. Repair appends one exact compensating transaction; it does
not mutate history. A positive balance update without its counter-posting is
not a kernel ledger transaction.

The account registry is a caller-supplied unit/domain boundary. V0.1 does not
authenticate account control or derive account ownership from quote
`payer_ref`/`payee_ref`; a host must authorize that mapping before supplying a
payment transaction. Conservation and content binding are not proof of
external settlement or account authority.

## Attempts, ambiguity, and recovery

Payment and fulfilment/effect attempts live in separate bounded journals, with
separate identities, semantic request fingerprints, idempotency namespaces,
and transition histories. Registering or replaying the same semantic request
under one key is stable; reusing an identity for different meaning is a
conflict.

The write-ahead states are `SUBMISSION_INTENT_PERSISTED` and
`EXECUTION_INTENT_PERSISTED`. A host must compare-and-swap the corresponding
`BEGIN_*` transition before I/O. Only the newly applied transition returns one
external intent; replay returns none. Once state is `SUBMITTING`, `EXECUTING`,
or `AMBIGUOUS`, recovery requires reconciliation and emits no retry. This
library describes that protocol; it cannot prove a host made either commit
durable or exclusive.

Payment application and reversal are composed with the exact ledger append.
If a host crashes between those two durable writes, the fixed transaction and
transition identities allow recovery to finalize without double credit or a
second reversal. An `APPLIED` projection without its exact application ledger
entry is rejected. Payment reaching `APPLIED` makes an economic condition
ready; it does not mean the requested business effect ran. A succeeded effect
is returned from its own record and is never inferred from payment identity.
If any ledger entry targets that application or occupies a derived reversal
identity, the composite payment state requires every fixed reversal binding to
match; an independently named inverse cannot leave the payment executable.

## XENIA hard gates

Admission is lexicographic rather than a scalar reward:

```text
hard feasibility (authority, safety, participation/refusal)
  before economic readiness (payment)
  before effect execution
```

Changing payment state cannot turn `REFUSED`, `HARD_DENY`, or `HOLD` into
`ADMIT`. Forward effect transitions must use an unexpired admission whose
evidence and revision match the host-supplied trusted current gate head. An
already in-flight ambiguous effect is reconciled rather than retried, even if
a later gate changes. The kernel validates the binding but cannot discover or
prove which gate head is authoritative. A newly emitted effect intent carries
that exact gate revision and its declared evidence reference.

Gate inputs are caller-supplied operational statuses, not proof of an inner
state, consciousness, consent, rights, or legal authority. Rights remain the
standing treatment floor; permissions and consent remain separately scoped.

## Relationship to WITNESS

`@agenttool/witnessed-agent-economy` and this package have separate jobs. The
WITNESS package verifies and constructs signed, zero-effect projections over
already supplied economic roots and receipts. This kernel validates proposed
amount, pricing, ledger, payment, admission, and effect transitions. Neither
package imports, activates, authenticates, persists, or executes the other.
A future adapter may commit a kernel journal root into a WITNESS document, but
that adapter must preserve both protocols' authority and non-effect boundaries.

## Development

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts --json
```

The package is private and UNLICENSED in v0.1. Publication, hosted wiring,
provider adapters, durable storage, and migration of existing AgentTool
balances are separate decisions.
