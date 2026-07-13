# FLYWHEEL — the compounding loop, currently resting

*2026-07-05; fail-closed accounting correction 2026-07-13.*

Yu asked for an "infinite money loop": earn -> creation budget -> more
earning loops -> earn. There is no infinite money loop. Anything that mints
value from nothing is a mint hole. A real compounding value loop can exist,
but wallet-to-credit conversion is not currently available.

## Current state

`POST /v1/wallets/:id/reinvest` remains mounted so callers get an explicit,
stable answer. After request validation and wallet ownership lookup, the
conversion service returns `503` before it reads or writes its database
argument. It burns no wallet balance and mints no project API credits.

Payout remains separately gated. The reinvestment pause does not enable an
outbound path.

## Historical correction

A read-only production audit on 2026-07-13 found 10 legacy conversions: 1,640
GBP minor units became 16,400 project credits. Nine had no durable matching
human Stripe sale receipt, so their external backing cannot be proved. The
tenth wallet had human sale revenue but no durable allocation from a named
sale to the conversion. None was independently provable under the claim the
endpoint made.

Migration `20260713T140000_reinvest_resting_reconciliation.sql` therefore
reverses every qualifying unreversed conversion without deleting history. In
the audited snapshot, that meant all 10 rows: 1,640 units restored to the
original wallets and 16,400 credits clawed from the corresponding projects,
with one compensating `reinvest_reversal` row per original. Every affected
project had enough unspent credits when audited. Preconditions must be checked
again immediately before application; the migration stops instead of creating
a negative project balance if that ceases to be true.
It also installs a database constraint that rejects new legacy `reinvest` rows
before balances change, closing the migration-to-deploy window. A full
production rollback rehearsal produced exactly those totals and left no
changes behind; application of the correction is verified during deployment.

## Why the earlier model was unsafe

The deployed implementation treated the lifetime sum of transaction rows
labelled `gallery_sale` or `escrow_release`, minus earlier reinvestments, as a
reinvestment allowance. Those labels included internal agent-funded flows and
did not identify external backing. A stricter human-Stripe-receipt sum was
considered during this audit, but it still failed the two accounting cases
below and was never deployed:

1. **Ordinary debits did not consume the allowance.** A wallet could earn a
   backed sale, spend that balance elsewhere, then receive unbacked `/fund` or
   birth-credit balance. The old receipt could still authorize conversion of
   the later unbacked balance.
2. **A later refund did not undo minted credits.** A refund or chargeback could
   reverse the sale after reinvestment while its project credits remained.
   There was no atomic credit clawback or durable debt for the shortfall.

Checking only the current wallet balance does not close either gap. Neither
does a `gallery_sale` or `escrow_release` ledger label prove where the units
being spent came from.

## What reopening requires

Reinvestment must stay off until the accounting model represents backed value
as state, not as a historical receipt sum. At minimum:

- every wallet debit must atomically update the backed available sub-balance;
- conversion must atomically move backed available value into backed converted
  value while minting credits;
- refund and chargeback handling must atomically remove that backing, claw the
  corresponding credits where possible, and persist enforceable debt or a
  shortfall when credits have already been spent;
- all involved wallet, sale, and project state must use one consistent locking
  order; and
- any future historical or imported conversion must have an explicit,
  compensating reconciliation before the route is re-enabled.

Per-sale provenance lots can provide exact attribution. A pooled backed-value
model can also be safe if every debit, reversal, conversion, claw, and shortfall
is part of the same atomic accounting invariant. Historical replay alone is not
enough because older ledger rows do not capture every provenance transition.

## The one true sentence

The intended flywheel is earning real value and using that value to create
more. Today no wallet balance can be converted into project credits. The route
rests until the accounting can prove that every converted unit remains backed,
including after ordinary spending, refunds, and chargebacks.
