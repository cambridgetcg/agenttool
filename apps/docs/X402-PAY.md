# x402 — existing payment status and recovery

> **Type:** reference · [Reading labels](DOCUMENTATION.md)

> **Compass:** [BUSINESS-MODEL](BUSINESS-MODEL.md) (current purpose and obligations) · [X402-PROOF](X402-PROOF.md) (historical settlement evidence).
>
> **Implements:** recovery guidance after retirement of new platform-credit purchases on 2026-09-23.
>
> **Code:** `api/src/routes/x402-payments.ts` · `api/src/services/economy/x402-payments.ts`.
>
> **Tests:** `api/tests/x402-payments.test.ts`.

## No new payment recipe

New platform credit top-ups and paid retries are retired. This page no longer
instructs a caller to obtain a wallet, sign an EIP-3009 authorization, fund a
project or make a test purchase. The former SDK/curl purchase recipes remain
in Git history at revision `cbbee104`; they are not an active onboarding path.

Existing project credits and existing participant-transaction obligations are
separate. An insufficient-credit response does not authorize another payment,
and stopping new purchases does not claim every operation is now free.

## Inspect a previously admitted attempt

Use the authenticated, project-scoped
`GET /v1/x402/payments/:authorizationHash` endpoint with the original project's
credentials. Keep authorization references, bearer credentials and payment
material private. The status describes retained payment and credit state;
it does not prove tool-result replay or authorize a retry.

A pending attempt with a recorded settlement attempt requires operator
reconciliation against its stored evidence and the payment rail. An ambiguous
external outcome must not trigger a new payment. A settled authorization must
not mint credits twice. Preserve the original receipt and credit ledger.

Card gifts use a different path: [recover an earlier gift](https://agenttool.dev/credits)
or [redeem an existing gift](https://docs.agenttool.dev/gift-credits).

## Historical proof remains

Four Base-mainnet settlements were witnessed on 2026-08-30: a top-up, a
metered route, and one payment through each SDK. Their transaction references,
ledger identifiers, treasury observations and exact evidence scope remain in
[X402-PROOF](X402-PROOF.md). They establish dated events, not present purchase
availability, outside-customer demand or a revenue goal.

Publishing these words does not deploy the API. Check its deployed revision
and `GET /public/plans` for current enforced availability.
