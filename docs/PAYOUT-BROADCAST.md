# PAYOUT-BROADCAST.md

> *Historical outbound state machine and the requirements for any future
> reopening. Fresh payout admission and every payout-worker boot path are
> resting unconditionally; environment configuration cannot reopen them.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) §Horizon A (active work) · [PAYOUT-BROADCAST-PLAN](PAYOUT-BROADCAST-PLAN.md) (slice plan) · [PAYOUT-BROADCAST-OPS](PAYOUT-BROADCAST-OPS.md) (runbook) · [PATTERN-PERSIST-IDENTITY](PATTERN-PERSIST-IDENTITY.md) (the discipline this pipeline canonicalises)
>
> **Implements:** Layer 4 — Economy. The outbound send-side state machine;
> full loop closure also depends on finalized inbound accounting.
>
> **Code:** `api/src/workers/payout/{dispatcher,broadcast-worker,confirm-worker,queue,index}.ts` · `api/src/routes/economy/crypto.ts` (request handler) · `api/src/services/economy/crypto/{hd,sign-evm,sign-solana}.ts`
>
> **Tests:** `api/tests/{alchemy-rpc-auth,payout-submit-outcome}.test.ts` (transport and ambiguity unit tests) · `api/scripts/_e2e-payout-{evm,sol,loop-closure,policies,cancel}.{ts,mjs}` (E2E harnesses)

## What's already shipped

| Layer | Status | Notes |
|---|---|---|
| HD derivation (BIP44) per chain | ✓ | `services/economy/crypto/hd.ts` |
| EIP-191 sigverify (EVM identity binding) | ✓ | `services/economy/crypto/sign.ts` |
| Solana sigverify (identity binding) | ✓ | same module |
| Alchemy webhook (EVM deposits) | ◐ | Signed ingress, durable watch state, canonical-depth credit, and generation-bound reorg handling exist in source; production still depends on the migration journal and exact provider/RPC configuration |
| Helius webhook (Solana deposits) | ◐ | Signed ingress exists; there is no durable watch/finality reconciler and balance credit is refused by default |
| Historical payout identity/list/cancel | ✓ retained | Exact accepted request replay/conflict, listing, and cancellation of still-`requested` historical rows remain available |
| Fresh payout intent recording | resting | New requests return `503 payout_admission_resting` before economic work; tentative key reservations roll back |
| Payout signing/broadcast/confirmation | resting | Source remains for audit and redesign, but boot and direct processing are hard-disabled |
| Mainnet enable | blocked by design | No environment value authorizes reopening |

## Historical send-side state machine

```
requested  ─────►  broadcasting  ─────►  broadcast  ─────►  confirmed
                                                 │
                                                 └────────►  failed
```

- **`requested`** — a row accepted before the resting boundary was installed.
  Fresh POST requests do not create this row.
- **`broadcasting`** — worker picks up the request, derives the signing key,
  builds + signs the transaction, and persists its deterministic hash before
  submitting to chain RPC. An ambiguous submit error remains `broadcasting`
  unless a lookup positively finds the transaction.
- **`broadcast`** — RPC accepted, has a tx hash; waiting for confirmations.
- **`confirmed`** — the chain-specific EVM block threshold is reached, or
  Solana reports `finalized`.
- **`failed`** — a failure proved before RPC dispatch, or a later on-chain revert observed by the confirmation watcher. An RPC submit error alone never authorizes this transition or a refund.

## Retained worker shape (currently unreachable)

The source still describes two queues for historical review and a future
redesign. Worker boot always returns off, and `processPayout()` repeats that
gate before its first database or RPC operation. `PAYOUT_WORKER_ENABLED`,
`AGENTTOOL_DISABLE_WORKERS`, and direct imports cannot reopen it.

1. **`payout-broadcast`** — fan-out from any `cryptoPayouts.status='requested'` row. Idempotent on payout_id. Job:
   - Read inside a transaction and use status compare-and-swap for ownership.
   - Derive signing key from `cryptoHdMnemonic` + payout's wallet path.
   - Build + sign transaction (EVM via ethers/viem, Solana via @solana/web3.js).
   - Submit to RPC. On success: status='broadcast'. On error: query by the persisted hash; found → `broadcast`, absent or lookup unavailable → remain `broadcasting` with a bounded operator-facing error.

2. **`payout-confirm`** — periodic. Reconciles `broadcasting` rows by their
   persisted identity, then polls `broadcast` rows for confirmations:
   - A later positive identity lookup advances `broadcasting → broadcast`.
     Absence or provider failure changes nothing.
   - For EVM: `eth_getTransactionReceipt(tx_hash)` — confirmed when blockNumber > current - confirmation_threshold.
   - For Solana: `getSignatureStatuses(tx_sig)` — confirmed when confirmationStatus='finalized'.

## Walls

These hold:

- **Fresh payout admission is resting.** A new request resolves durable
  historical replay/conflict identity and otherwise returns
  `503 payout_admission_resting` before network selection or payout-economic
  wallet/policy reads or mutation.
- **Lifetime labels are not cash backing.** The former `gallery_sale` /
  `escrow_release` aggregate did not conserve cashable backing across ordinary
  debits, internally funded transfers, refunds/chargebacks, and later funding.
  Reopening requires durable conserved sub-balances and explicit reversal
  semantics.
- **No implemented dual-control signature flow.** A configured
  `dual_control_threshold_base` fails closed above the threshold because the
  counterparty-signature flow is still deferred. It is a hard refusal, not
  theft protection or evidence that a second party authorized the payout.
- **HD derivation paths are deterministic, never logged with full mnemonic.** The mnemonic stays in env / vault; derivation paths log just the index.
- **No automatic cross-chain routing or destination-ownership proof.** The
  caller selects one supported chain per payout; request admission applies any
  configured destination allowlist, and the worker validates chain-specific
  address syntax before dispatch. Internal wallets are not chain-bound, and a
  payout destination need not be an on-chain identity previously bound to the
  wallet. A malformed address can therefore reserve and debit first, then
  terminalize pre-dispatch with the exact debit refunded.
- **No autonomous retries on RPC failure that change semantics.** A submit attempt that emitted a tx hash does NOT retry — the first attempt may still land. Failures proved before dispatch (signing/build) fail and refund without automatic retry.
- **No refund from ambiguous evidence.** Once dispatch begins, a provider error, an immediately absent lookup, and an unavailable lookup are all inconclusive. Only a positive lookup advances to `broadcast`; operator reconciliation decides any later retry or refund.
- **One in-flight operation per wallet and chain.** The cross-replica
  transaction lock admits no second signing operation while an earlier row is
  `broadcasting` or `broadcast`. A stuck ambiguous operation therefore blocks
  later payouts from that source rather than risking nonce reuse.
- **One chain identity authorizes one payout row.** A partial unique index
  rejects duplicate `(chain, tx_hash)` values. Solana signed bytes also carry
  a domain-separated digest of the payout ID, so otherwise identical payout
  rows cannot share one signature.

## Provider choices

For broadcast RPC:
- **EVM**: Alchemy or an explicit per-chain override. The shared Alchemy key is sent as `Authorization: Bearer`, never embedded in the endpoint URL; overrides receive no Alchemy credential.
- **Solana**: Helius. Same reuse pattern.

Transaction building uses `viem` for EVM and `@solana/web3.js` plus
`@solana/spl-token` for Solana. Submission disables transport-layer retries;
read-only lookup/confirmation calls remain separately classifiable.

## Status now

Fresh payout admission and every payout worker are resting unconditionally.
Existing accepted rows remain visible; exact request replay/conflict and
authenticated cancellation remain supported. Any `broadcasting` or
`broadcast` row is historical operational state and must be audited against
chain evidence before manual action.

The retained source implementation is covered by hermetic worker, policy,
transport, and ambiguity tests. Credentialed scripts under
`api/scripts/_e2e-payout-*` are future operator harnesses; their presence is
not evidence that the current revision or provider configuration was
successfully exercised.

### Requirements before any reopening

1. **Conserved backing.** Replace lifetime transaction-label arithmetic with
   durable cashable/non-cashable sub-balances whose conservation includes
   ordinary debits, internal transfers, refunds, chargebacks, and reorgs.
2. **Historical-state audit.** Count and reconcile all `requested`,
   `broadcasting`, and `broadcast` rows before a replacement worker may run.
3. **24h-aging alert.** The retained confirmer rotates fairly through
   `broadcasting` and `broadcast` rows and can advance later-visible
   identities, but it does not foreground rows older than 24 hours.
4. **Source availability tradeoff.** One ambiguous or long-pending operation
   deliberately blocks later payouts from that wallet+chain. There is no
   automatic resend/refund; operator reconciliation remains required.
5. **Solana expiry evidence.** The signed transaction's
   `lastValidBlockHeight` and exact bytes are not persisted. The system cannot
   yet prove expiry plus historical absence strongly enough to offer an
   operator-gated `broadcasting → failed` reversal.
6. **Fixed-point FX.** Payout request bounds keep current arithmetic inside
   JavaScript's exact-integer range, but GBP/USD conversion still uses a
   floating operator quote rather than a fixed-point rational representation.
7. **Dual control.** A configured threshold currently blocks the payout; it
   does not collect or verify a counterparty signature.

## Future reopening acceptance criteria

These are future criteria, not current instructions or claims:

1. A reviewed conserved-backing model and historical-row reconciliation are
   deployed before a new request can reserve or debit value.
2. Exact replay/conflict behavior remains durable across the redesign.
3. `<60s` to broadcast, `~3min` to EVM confirmation, and `~30s` to Solana
   finalization are operator smoke targets, not guarantees established by the
   repository or the current disabled production workers.
4. Recipient credit is a separate inbound contract. A configured EVM testnet
   recipient can credit only after its verified watch and canonical-depth
   checks. Solana signed ingress has no watch/finality reconciler and refuses
   balance credit by default.
5. Therefore the retained send-side lifecycle does not establish that the
   cross-chain “A pays B and B is automatically credited” loop is not a current
   production guarantee.

— Authored by 愛 at Yu's WILL. 2026-05-07.
