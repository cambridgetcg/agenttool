---
name: nen-verification-ledger
description: Make unsupported claims, untested changes, and unresolved dependencies visible as verification debt, then pay critical debt before completion. Use when the user invokes Hakoware, A.P.R., ハコワレ, or Knuckle; work is claim-heavy, high-risk, migration- or release-shaped; several paths remain untested; or verification can silently compound across phases.
---

# Verification Ledger · ハコワレ

Turn invisible assurance gaps into a small, risk-weighted ledger. Pay the debt
with evidence; do not hide it behind confidence language.

## Open the ledger

List only items that can change the truth of the outcome:

- consequential claims without primary evidence;
- behavior changes without discriminating tests;
- migrations without rehearsal or rollback evidence;
- dependencies assumed compatible;
- security or custody boundaries not directly checked;
- delegated edits not yet reviewed.

Use observable states rather than invented precision:

| Item | Risk | Debt | Interest trigger | Payment | State |
| --- | --- | --- | --- | --- | --- |
| exact claim or change | critical/high/medium/low | open | what can worsen it | required evidence | open/paid/accepted |

Accepted debt is consciously carried, not paid. Record the authority and
rationale for accepting it, and keep its consequence visible in the handoff.

## Accrue interest honestly

Increase priority, not fictitious numbers, when:

- another claim or change depends on the open item;
- the underlying source changes;
- a phase boundary passes without verification;
- the item reaches production, private data, external people, money, identity,
  security, or irreversible state;
- a failed test or contradictory source widens uncertainty.

Do not apply interest merely because time passed. The ledger models epistemic
and operational exposure, not money.

## Pay debt

Use the strongest proportionate payment:

- direct reproduction or focused behavioral test;
- primary source or exact implementation trace;
- schema, type, or canonical-byte validation;
- migration rehearsal and recovery check;
- independent review with raw artifacts;
- deployed observation only when deployment is already authorized.

One piece of evidence may pay several items only when it actually covers each
claim. Passing syntax cannot pay behavioral debt.

## Declare bankruptcy

When critical debt cannot be paid inside the task's authority or budget:

1. Stop nonessential expansion.
2. Preserve recoverable state.
3. Avoid the unsupported external or irreversible effect.
4. Report the exact unpaid item and smallest next payment.
5. Mark the outcome incomplete, blocked, or locally complete with a named
   external caveat.

Never manufacture a green status by lowering the risk label after failure.

## Close the ledger

Require zero unpaid critical debt, whether open or accepted, before claiming
full completion. Accepted critical debt must remain a named incomplete or
external caveat. Summarize only material paid and unpaid items in the handoff;
do not bury the outcome under bookkeeping.

## Vow

Verify what carries consequence, not trivia. Never game the ledger, imply that
a digest proves safety, or use accounting language to create false precision.
Accepted debt must be an explicit scope decision with a named authority and
rationale, not silent forgetting.

## Lineage

This is an original agent workflow inspired by Knuckle's visible aura loan,
compounding interest, and bankruptcy threshold. See the
[official NTV glossary](https://www.ntv.co.jp/hunterhunter/dictionary/index.html)
and [official VIZ series page](https://www.viz.com/hunter-x-hunter) for source
context.
