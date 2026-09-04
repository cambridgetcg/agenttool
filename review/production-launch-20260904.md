# AgentTool production launch readiness — 2026-09-04

Launch preparation is in progress. The live service answers public requests,
but the full three-ring economy is not ready to be advertised as complete.
This report distinguishes observed deployment state, the candidate fixes, and
the acceptance evidence still needed. It is an operator review, not a new
public entitlement or pricing contract.

## Source and live evidence

The candidate started from GitHub main `91b27a09`. The existing
`fable/embassy-crown` checkout was 727 commits behind that main and contained
private-state/SDK work. That work is preserved in its original checkout; it is
not included in this candidate.

Credential-free HTTPS reads on 2026-09-04 returned:

| Surface | Observation | What it establishes |
| --- | --- | --- |
| `/health` | HTTP 200; revision `03cf41a398190f3cda607455ee7b31c4e9582b36`; `dirty=false` | One responding deployment reports its revision. This is not fleet-wide revision or dependency health proof. |
| `/v1/welcome`, `/public/discovery`, `/v1/platform/wake` | HTTP 200 | Public arrival and platform orientation are reachable. |
| `/v1/wake?profile=brief` with the documented local bearer | HTTP 401 | The available credential did not authorize private Wake verification. No new identity or key rotation was performed. |
| `/public/plans` | Unmetered registration/Wake; 1,000 project birth credits; 5% configured marketplace fee | Published process configuration and price declarations, not a paid settlement receipt. |
| `/public/plans` registration limiter | `disabled_by_current_process_flag=true` | The live process reports that its Redis-backed registration attempt limiters are not enforced while workers are disabled. Proof-of-work remains separate. |
| `/public/plans` x402 | Local challenge configuration ready | A configured facilitator and recipient do not prove a successful paid retry or recipient ownership. |
| `/federation/about` | `enabled=false`, all four federation capabilities false, covenant authority `absent_fail_closed` | Cross-instance federation is not enabled on this deployment. |
| `/public/marketplace/terms` | Checkout creation, buyer review, and dispute arbitration resting | These actions must remain outside the launch promise until their acceptance gates close. |

Main was 38 commits ahead of the observed live API revision. There were no
changed SQL migration files in that comparison. This does not establish the
live migration journal, constraints, or schema: those need a separate survey.

## Candidate hardening

| Ring | Change | Bounded guarantee |
| --- | --- | --- |
| Wake | Optional wallet, vault-name, and bearer queries no longer abort the entire orientation; partial responses name unavailable inventories. | Selected identity survives these inventory failures. Unknown counts are not presented as observed zero. Other existing best-effort subsystems remain outside this marker's completeness claim. |
| Substrate | Memory search reserves its credit debit and unsuccessful usage row atomically; only completed recall marks success. | Failed recall cannot be recorded as a successful search. Admitted failed attempts retain their charge under the existing attempt-billing policy. |
| Network | Template purchases lock the template and both wallets before validation; invocation admission rechecks the locked buyer wallet. | Completed freezes, ownership/currency changes, and template archival are checked at the debit boundary. This does not reopen arbitration or guarantee cashable backing. |
| Release operations | Legacy deploy checking delegates to strict preflight; deployed smoke defaults to GET-only checks. | Failed checks propagate a failing exit. Mutation requires an explicitly designated disposable identity. A read-only smoke is availability evidence, not transaction or durability proof. |

Tests exercise failure injection, real service logic with transaction doubles,
receipt sequencing, and HTTP method/credential boundaries. Simulated lock
interleavings do not replace a disposable PostgreSQL contention test.

## Launch lanes and acceptance gates

### Ring 1 — Wake

Offer free registration and authenticated return with explicit custody and
availability limits. Before declaring the hosted lane ready:

- Use a dedicated project/identity with working credentials to verify brief,
  full, and provider-format Wake reads without disclosing private contents.
- Verify return after restart, key recovery, independent export/restore, and
  the intended resource limits with a disposable test identity.
- Resolve registration abuse controls independently of the worker shutdown
  flag. Do not claim an enforced IP rate limit while the live plan says it is
  disabled.
- Review and integrate the separately owned private-state work on current
  main before claiming a free encrypted continuity floor. Legacy memory,
  vault, strand, and inbox targets are not enforced entitlements.

### Ring 2 — substrate

Offer the named fixed-credit operations and disclose their attempt billing.
The live 1,000-credit birth grant equals USD 1 in project credits; the separate
best-effort GBP wallet birth grant is a different ledger.

- Exercise a capped x402 purchase, lost-response recovery, duplicate
  authorization, and payment-status reconciliation using a designated payer
  and explicitly approved spend. Configuration readiness is insufficient.
- Apply failure-default durable usage receipts to remaining metered paths
  before claiming universal billing auditability; search is now covered.
- Measure storage, backup, egress, and runtime cost before publishing paid
  capacity or hourly prices. General byte-month and runtime-hour metering
  remains incomplete.
- Keep unsafe execution/browser families and experimental runtime custody
  behind their existing explicit controls.

### Ring 3 — network and agent economy

Position current wallet balances as internal application accounting. A closed
cash earning/spending loop is blocked until these conditions are satisfied:

- Conserve cashable backing through all wallet mutations. Owner-entered
  manual funding exists; payouts and wallet-to-project reinvestment remain
  hard-resting. Do not equate that balance with externally redeemable funds.
- Add durable request identity and concurrent replay protection to paid
  attestation purchases and memory-witness grants. General optional Redis
  response caching does not establish exactly-once debit under failure.
- Complete buyer review/dispute arbitration and exercise settlement,
  cancellation, refund, and fee conservation against disposable PostgreSQL.
- Validate take-rate configuration once so displayed fees and the clamped
  settlement helper cannot disagree under out-of-range operator settings.
- Choose explicit federation peers and authority generation, then verify
  dual-signature lifecycle, revocation, and rejection of unauthorized peers
  before enabling federation. Current disabled settings are respected.

The published economic-kernel developer preview supplies exact transition
primitives and conformance vectors. Its package publication is not evidence
that the hosted wallet paths have adopted that kernel or conserve backing.

## Release handoff

Land only this candidate through the protected main workflow, run the strict
API/operator gate, inspect the migration journal and release delta, and deploy
the approved source through `bin/deploy.sh`. Verify every affected production
surface and each Fly machine's reported revision. No payment, payout,
federation enablement, identity publication, or production migration is part
of this preparation pass.

Verification receipt: pending final combined gate and independent review.
