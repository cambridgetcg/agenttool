# Human door — existing-purchase recovery

The paid launch and checkout-activation runbook is retired as of 2026-09-23.
New platform paid sign-ups, upgrades, credit purchases and card checkout are
not an active operation. Do not use historical activation flags, test purchases
or the old commercial plan to reopen them.

## Keep prior obligations reachable

- Keep `POST /v1/billing/webhook` and signature verification available for
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `charge.refunded` and
  `charge.dispute.created`. These can settle or reverse earlier purchases.
- Preserve private checkout-return recovery at `/credits`, existing gift
  redemption, gallery claim recovery, and authenticated payment-status reads.
- Keep the existing seller, tax, privacy, cancellation, refund and support
  records linked from `/terms` and `/privacy`; retirement does not rewrite a
  buyer's contract or statutory rights.
- Do not delete provider credentials needed for webhook verification,
  historical-session lookup or refunds as a side effect of closing new sales.
- Investigate ambiguous payments through stored receipts and the provider's
  records. Do not make a new purchase to test recovery or automatically retry
  a mutation with an unknown outcome.
- Provider account controls and operating-cost budgets remain separate.

## Technical maintenance

Use `docs/DEPLOY-PROCEDURE.md` for an explicitly scoped release. This document
contains no deployment or database-migration instruction. Existing financial
records and migrations remain unchanged.

## Historical launch record

The full superseded activation runbook is retained in Git history at revision
`cbbee104`. The historical routing observation below remains useful evidence;
it is not an instruction to alter DNS or reopen checkout.

## Addendum 2026-07-02 — what actually shipped for §4

The apex went live via a **worker split, not a DNS cutover**: `agenttool-proxy`
(the worker that always fronted `agenttool.dev/*` + `www`, rewriting everything
to `api.agenttool.dev`) now routes API surfaces (`/v1`, `/public`, `/health`,
`/about`, `/.well-known`, and `/` with `Accept: application/json`) to the API
exactly as before, and everything else to the Pages door. Consequences:
- **No DNS was changed.** §4a's record-capture and §4d's DNS rollback were not
  needed; rollback is `infra/apex-door/ROLLBACK.md` (redeploy the original proxy).
- Live well-known documents and all API-at-apex paths are served **natively**
  (200s, no 301s). `/.well-known/agent-card.json` returns 404 because A2A task
  transport and AgentCards are pending.
- `WEB_BASE_URL` is set to `https://agenttool.dev` (checkout returns land on
  the live door). The Pages custom-domain attach for the apex stays harmlessly
  "pending" — see ROLLBACK.md.
