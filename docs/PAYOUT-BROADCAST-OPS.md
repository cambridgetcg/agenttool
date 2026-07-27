# PAYOUT-BROADCAST-OPS.md

> *Current operator runbook for a resting outbound-payout subsystem. It
> preserves historical replay, listing, cancellation, and ambiguity handling;
> it is not an enablement guide.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) §Horizon A · [PAYOUT-BROADCAST](PAYOUT-BROADCAST.md) (doctrine) · [PAYOUT-BROADCAST-PLAN](PAYOUT-BROADCAST-PLAN.md) (historical implementation plan)
>
> **Implements:** Layer 4 — Economy. Operational containment for historical
> outbound payout rows while fresh admission and every worker boot path rest.
>
> **Code:** `api/src/routes/economy/crypto.ts` · `api/src/services/economy/crypto/index.ts` · `api/src/services/economy/config.ts` · `api/src/workers/payout/`
>
> **Tests:** `api/tests/{payout-request-idempotency,workers-off-switch,payout-refund-integrity,payout-submit-outcome,crypto-public-truth}.test.ts`

## Current decision

Fresh payout admission and payout-worker execution are resting
unconditionally.

- A new `POST /v1/wallets/:id/payout` returns
  `503 payout_admission_resting`. Its tentative idempotency reservation rolls
  back after durable replay/conflict lookup and before network selection or
  payout-economic wallet/policy reads or mutation.
- A same-input historical request can still replay its current durable state.
  Changed input under the same key still conflicts.
- Existing rows remain listable. A historical row that is still `requested`
  remains cancellable through the authenticated API.
- `PAYOUT_WORKER_ENABLED`, `PAYOUT_NETWORK`, RPC credentials, and direct module
  imports do not authorize worker boot. Do not try to reopen the subsystem by
  changing environment variables.
- `AGENTTOOL_DISABLE_WORKERS=1` remains an additional production-wide
  containment switch and must stay set during this release.

The former admission rule counted lifetime `gallery_sale` and
`escrow_release` ledger labels. That did not conserve cashable backing through
ordinary debits, internally funded transfers, refunds, chargebacks, reorgs, or
later funding. It could therefore treat internally circulated or already-spent
value as withdrawable. The repository retains the historical state machine for
audit and redesign, not for production activation.

## Release and maintenance checks

Survey the complete repository/journal inventory; never replay a selected
payout subset with raw `psql`:

```bash
bin/migrate-pending.sh --dry-run
```

An empty result proves source/journal inventory compatibility, not schema
parity. Exit `42` means a protected writer boundary is pending: keep all
relevant admission and workers closed and follow the exclusive maintenance
sequence in [DEPLOY-PROCEDURE](DEPLOY-PROCEDURE.md).

Before and after any protected production cutover:

1. Prove every old API replica has `AGENTTOOL_DISABLE_WORKERS=1`.
2. Prove `PAYOUT_WORKER_ENABLED` is absent or false on every old replica.
3. Count historical rows by `requested`, `broadcasting`, `broadcast`,
   `confirmed`, `failed`, and `cancelled`.
4. Keep payout admission and every payout worker closed. Capture every exact
   Fly Machine ID and its material configuration before maintenance. Do not
   destroy, recreate, or scale the fleet to zero as a fencing shortcut.
5. Use a separately reviewed and rehearsed identity-preserving mechanism to
   fence restart, autostart, schedules, and external admission; drain durable
   jobs, leases, and in-flight work; then stop those same Machine IDs in place.
   Before SQL, prove every captured ID still exists and no old writer can
   resume.
6. Exercise only the canonical pending runner, in order:

   ```bash
   bin/migrate-pending.sh --dry-run
   bin/migrate-pending.sh --dry-run --maintenance-quiesced
   bin/migrate-pending.sh --maintenance-quiesced
   bin/migrate-pending.sh --dry-run
   ```

   Require the two pre-apply inventories to name the same reviewed files and
   the final inventory to be empty.
7. Once any protected SQL commits, proceed forward only. Update those same
   Machine IDs in place to the exact protected-main image, keep workers off,
   and prove the final identity, topology, image, source revision, health, and
   worker flags before reopening any admission.

The repository currently has no checked identity-preserving maintenance
implementation. If the reviewed mechanism or any writer-exclusion proof is
absent, stop before SQL; neither this runbook nor an empty registry authorizes
destroying an extant fleet or guessing at lost identities. A registry that is
already empty through an independently authorized incident or recovery action
requires a separate reviewed recovery plan.

## Historical rows

### `requested`

No worker may pick up the row while the subsystem rests. The authenticated
owner can cancel it:

```bash
curl -X POST "$BASE/v1/wallets/$WALLET_ID/payouts/$PAYOUT_ID/cancel" \
  -H "Authorization: Bearer $AT_API_KEY"
```

- `200` means the exact original negative payout ledger leg was reversed once
  and the row became `cancelled`.
- `409 not_cancellable` means the row is no longer `requested`.

Do not recompute a refund from `amount_base`, a current FX rate, or
caller-extensible metadata.

### `broadcasting`

This state may represent a transaction that reached the chain even if an RPC
response was lost. An absent or unavailable lookup is inconclusive.

- Query the exact persisted transaction identity through at least the intended
  chain/network evidence path.
- Never automatically retry, replace, refund, clear the hash, or reinterpret
  the network.
- Record the evidence and obtain a reviewed repair path. The current release
  has no operator mutation command for this state.

### `broadcast`

The transaction was accepted or later found, but the retained automatic
confirmer is off. Verify the exact identity and finality manually. A proved
revert still requires the audited exact-ledger reversal path; direct balance
or status edits are not a substitute.

### Terminal rows

`confirmed`, `failed`, and `cancelled` are historical records. Do not rewrite
them to create a new attempt. A new attempt is a future conserved-backing
operation with a fresh durable identity, not a status reset.

## Retained state machine and logs

The dormant source describes:

```text
requested -> broadcasting -> broadcast -> confirmed
                                |
                                +--------> failed
```

Useful historical log prefixes include `[payout-dispatcher]`,
`[payout-broadcast]`, and `[payout-confirm]`. Their presence in old logs is
evidence that code ran at that time; it is not evidence that current workers
are enabled, healthy, or safe to enable.

An ambiguous submit remains `broadcasting`. A failure proved before dispatch,
or a finalized on-chain revert, can use the exact debit-provenance reversal.
There is no autonomous semantic retry.

## Secrets

Mnemonic and provider credentials remain sensitive even while workers rest.
Keep them in Fly secrets, Keychain, or another scoped vault. Never place values
in shell startup, commands copied into chat, documentation, receipts, or logs.
Credential presence does not authorize payout activation.

## Requirements before any future reopening

Reopening is a new reviewed accounting release, not an operator toggle. It
requires at least:

1. Durable cashable and non-cashable sub-balances whose conservation covers
   every debit, internal transfer, escrow path, refund, chargeback, and reorg.
2. A complete audit and explicit disposition of every historical
   `requested`, `broadcasting`, and `broadcast` row.
3. Atomic source allocation and reversal semantics, including debt handling
   when a later reversal exceeds remaining backing.
4. Fixed-point FX representation and bounded conversion.
5. Implemented authorization for any advertised dual-control threshold.
6. Exact-revision credentialed testnet evidence for each supported chain.
7. A deliberately approved, bounded mainnet trial after all earlier gates pass.
8. Updated code, public safety text, tests, and this runbook in the same
   release.

Until then, the correct operational action is to keep payout admission and
workers resting.

— Authored by 愛 at Yu's WILL. Updated 2026-07-26.
