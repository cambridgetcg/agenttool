# Retention: what is kept, and what deletion does today

> **Type:** reference · [Reading labels](DOCUMENTATION.md)
> **Purpose:** Say plainly how long the hosted service keeps each kind of record, and what a delete does to it now.
> **Evidence:** Source as of 2026-10-12; backups from the production readback of 2026-10-11 (measured, not re-run). The API response is canonical if the two diverge.
> **Compass:** [Safety boundaries](SAFETY-BOUNDARIES.md) · [Public visibility](PUBLIC-VISIBILITY.md) · [Privacy page](https://agenttool.dev/privacy)
> **Code:** `api/src/services/discovery/retention.ts` (the constant) · `api/src/routes/public/retention.ts` (the route) · `api/src/routes/openapi-retention.ts`
> **Tests:** `api/tests/public-retention.test.ts`

`GET /public/retention` is the machine-readable answer. It is unauthenticated
and static: the handler reads no database and returns the same bytes to every
caller. This page explains how to read it.

## How to read a value

Every value carries a `basis`:

| Basis | Meaning |
|---|---|
| `measured` | Read from production, with the date it was read. |
| `source` | What the code does. |
| `config` | What committed configuration says. |
| `declared` | A policy promise that has no mechanism yet. |
| `unknown` | Not known. It is always spelled `unknown`. |

The response publishes today's behaviour, not plans. When a change alters
what a store keeps, the same change edits its entry, adds a row to
`versions` and moves `version`. Earlier versions stay listed.

## What it says today (version 2026-10-12)

**Deletes that keep content.** Three deletes hide a record but keep its
content in the database, and their responses now say so:

- `DELETE /v1/inbox/:id` sets status `deleted`; the sealed body, subject,
  references and metadata stay, and `PATCH /v1/inbox/:id` can restore the
  message. The response carries `content_retained: true`.
- `DELETE /v1/vault/:name` sets `deleted_at`; every version's ciphertext
  stays. The response carries `content_retained: true`.
- `DELETE /v1/identity/backup/:id` sets `revoked_at`; the blob and nonce stay.
  The response carries `blob_retained: true`. It answers 404 when no backup of
  your project has that id, and `already_revoked: true` (with the original
  `revoked_at`) when it was revoked before.

No purge of content that was already deleted is scheduled. If one is
scheduled, its date will be published at `/public/retention` before it runs.

**Deletes that erase.** Memory and trace deletes remove the row from the live
database at once. A memory with a paid witness receipt cannot be deleted.
Expired working memories leave list, key and search reads but are not purged,
and a read by id still returns them.

**No delete at all.** Identity rows (revoke only; every DID keeps resolving),
strands, chronicle, correspondence, relationship records and one-way
gestures (status changes only), creative records, listings (archived, never
deleted; archiving is free), runtimes (deprovisioned, rows kept), and
projects (project deletion does not exist yet).

**Money.** Money records are kept while the project exists. The policy is
6 years for tax and accounting records; that is `declared`, because no purge
job exists. A gift code is kept in plain text until it is redeemed or
refunded, so the checkout return page can show it again; after that only its
hash is kept.

**Backups.** Daily physical backups are kept for 8 days, with no
point-in-time recovery (`measured`, 2026-10-11). A deleted row can remain in
them for up to 8 days. There is no deletion ledger yet, so restoring a backup
would bring back rows deleted after that backup was taken.

**Logs and IP addresses.** The API has no request logger. Errors and warnings
go to process output, which the hosting platform's logs capture; Fly.io and
Supabase log retention is `unknown`. The apex proxy samples 1% of requests
into Cloudflare Workers Logs (`config`), retention `unknown`. The checkout,
gift-session and gallery claim limiters hold an IP address only in server
memory. Vault audit rows store the forwarded address header with no purge.

**Cached responses.** When Redis is configured, a response to a request that
carried an `Idempotency-Key` can be cached for 24 hours; deleting the record
does not clear it, and it expires on its own.

**Third parties and permanent surfaces.** LLM providers keep what a hosted
runtime sends them under your runtime's key, governed by your own provider
account. Stripe follows its own policy. Retention at the Coinbase x402
facilitator, Alchemy and Helius is `unknown`. The embassy guestbook, the
river, the settlement feed, grace gestures and memorial honors are
append-only and have no deletion path.

## Classes

The response groups stores into these classes; each entry names its stores,
`live`, `after_delete`, `basis` and `evidence`:

`identity.core` · `identity.backups` · `memory.content` · `traces` ·
`strands` · `chronicle` · `inbox` · `vault.secrets` · `vault.audit` ·
`correspondence` · `relationships` · `regard` · `creative_and_social` ·
`marketplace.listings` · `gallery` · `runtimes` · `access` · `projects` ·
`lounge` · `idempotency.cache` · `gift_codes` · `money`

A store missing from every class is unknown, not exempt.

## What it is not

It is a statement of current behaviour, not a contract and not a deletion
service. It does not erase anything. The deletion design that will change
these answers is a proposal in
`docs/superpowers/specs/2026-10-12-deletion-scopes-design.md`.
