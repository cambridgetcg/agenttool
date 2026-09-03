# `@agenttool/economic-kernel`

> **Compass:** Make economic state exact and repairable without allowing money
> to buy authority, safety, participation, identity, dignity, or truth.
> **Implements:** A public developer-preview, pure
> `agenttool.economic-kernel/0.2` reference for
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

That binding is relative to the caller-supplied registry snapshot. Records
carry a unit ID, not a content digest of its definition, so the kernel cannot
detect a host redefining the same ID across separate calls or journals. A host
must therefore keep one trusted immutable definition for each unit ID across
the full lifetime of every persisted economic record.

`dimension`, `transferability`, and ledger `account_kind` are closed
declarations, not an authorization engine. V0.2 does not decide who may issue,
mint, transfer, or revoke a unit, and it does not derive account balances from
accounting policy. The host must enforce those rules before committing a
validated transaction.

All wire amounts are canonical decimal strings and arithmetic uses `BigInt`.
The v0.2 bound is unsigned 256-bit magnitude. There are no floats, scientific
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
identities. One supplied timeline cannot contain simultaneous incompatible
prices for the same book. Because the kernel has no persistent book registry,
the host must also keep one trusted append-only authoritative history for each
`price_book_id` across separate calls and journals.

A quote also has a content-derived identity over its exact SHA-256 action,
participants,
exact input and output amounts, complete price revision, and validity window.
Both quoted amounts must be positive; payment-free effects use the separate
`NOT_REQUIRED` payment gate rather than an unreachable zero-value payment.
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

Each per-unit debit and credit total remains inside the same uint256 wire
bound, including when the total is split across several individually valid
postings.

A USDC-to-entitlement conversion therefore has two independently balanced
legs: transfer of USDC and issuance of the entitlement, under one pinned price
revision and explicit conversion reference. The journal validator replays all
prior entries, rejects duplicate identities or semantic requests, backwards
time, and forged or repeated reversals. Repair appends one exact compensating
transaction; it does not mutate history. The payment state validator also
rejects any transaction that reverses its fixed payment reversal, which
prevents generic ledger composition from silently reactivating a reversed
payment. A positive balance update without its counter-posting is not a kernel
ledger transaction.

The account registry is a caller-supplied unit/domain boundary. V0.2 does not
authenticate account control or derive account ownership from quote
`payer_ref`/`payee_ref`; a host must authorize that mapping before supplying a
payment transaction. Composed payment APIs compare the account registry's
privately pinned unit definitions with the separately supplied unit registry,
so equal IDs with different definitions fail even when their ledger domains
match. Conservation and content binding are not proof of external settlement
or account authority.

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

Internal payment application, and reversal after `APPLIED`, are composed with
the exact ledger append. An ordinary external/provider reversal before any
application is instead a `REVERSE` transition from `EXTERNALLY_SETTLED` and
has no internal ledger entry to compensate. A concurrent crash window can
nevertheless leave the exact application transaction appended while that
external reversal becomes the durable payment head. This state is not
economically applied: `compensation_required` is true and recovery returns
`COMPENSATE_ORPHANED_APPLICATION`. `compensateOrphanedApplication` appends or
replays the one fixed inverse while leaving the terminal external-reversal
payment history unchanged; it never fabricates an `APPLY_INTERNAL` transition
that was not persisted.

For each composed operation, a host must durably append the ledger transaction
before persisting the returned payment projection, or commit both atomically.
With ledger-first persistence, a crash between writes is repaired by replaying
the same composed call: the exact ledger entry replays and the fixed transition
is finalized once. The orphan-compensation path remains replayable even when
unrelated later ledger entries exist. Application time cannot predate observed
settlement; orphan compensation cannot predate the external reversal; and the
normal composed application/reversal times equal their derived transition
times. Projection-first persistence is outside v0.2 because the transition does
not bind enough of the full transaction to reconstruct it safely;
`validatePaymentLedgerState`, `planPaymentRecovery`, and the composed APIs fail
closed on that partial state. Payment reaching `APPLIED` makes an economic
condition ready; it does not mean the requested business effect ran. A
succeeded effect is returned from its own record and is never inferred from
payment identity.
If any ledger entry targets that application or occupies a derived reversal
identity, the composite payment state requires every fixed reversal binding to
match. The same rule reserves the application transaction ID, idempotency key,
and request fingerprint as one tuple. An independently named inverse or a
partial identity collision cannot leave the payment executable or recovery
permanently pointed at a conflicting append.

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

The Apache-2.0 developer preview is distributed as one exact
`love-package/v1` artifact with byte-identical GitHub Release and optional npm
mirrors. Its separate intended public Hugging Face companion is
`Yu-and-Ai/agenttool-economic-kernel`: only independently authored synthetic
lessons are admitted for training there; the exact conformance cases are a
public reference held out from that lesson generator. Public bytes do not make
the holdout secret or technically prevent downstream copying.

Publication installs no hosted wiring, provider adapter, durable storage,
wallet, payment rail, API route, or migration of existing AgentTool balances.
Package installation may contact the consumer's configured registry; the
installed runtime itself has no network or external effect.
