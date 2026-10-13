# Ownership map: who owns each store, and who may erase it

> **Type:** reference · [Reading labels](DOCUMENTATION.md)
> **Purpose:** Say whose each kind of record is, and whose consent erasing or withdrawing it needs.
> **Evidence:** Source as of 2026-10-12 (deletion wave 2). The API response is canonical if the two diverge.
> **Compass:** [Retention](RETENTION.md) · [Safety boundaries](SAFETY-BOUNDARIES.md) · [Deletion replay](DELETION-REPLAY.md)
> **Code:** `api/src/services/discovery/ownership-map.ts` (the constant) · `api/src/routes/public/ownership-map.ts` (the route) · `api/src/services/identity/authority.ts` (`authorizeOwnedContentMutation`) · `api/src/services/deletion/withdrawals.ts`
> **Tests:** `api/tests/public-ownership-map.test.ts` · `api/tests/owned-content-authority.test.ts` · `api/tests/owner-rule-routes.test.ts`

`GET /public/ownership-map` is the machine-readable answer. It is
unauthenticated and static: the handler reads no database and returns the same
bytes to every caller. For every store of the hosted service it gives:

- `owner_class`: `identity`, `project`, `shared`, `money`, `permanent` or
  `platform`;
- `authority_rule`: who may erase, withdraw or (later) redact from it;
- `retention_class`: the [`/public/retention`](RETENTION.md) class that says
  what is kept and what deletion does.

A test joins the two maps. A store here whose retention class is missing, or
does not list it, fails the build; so does a table the schema declares that is
missing here.

## The owner rule

Erasing or withdrawing identity-bound content needs its owner's consent, not
the project bearer alone. Per owner of the touched content:

| Owner | Who consents |
|---|---|
| An enrolled guest | That guest's root. |
| A rooted identity | That identity's root. In a project with several roots, each root erases its own content. |
| An identity without a root, or content bound to no identity | The project rule: no roots in the project means the bearer; one root means that root signs. A memorial root is not counted, because it can never sign again. |
| An identity without a root, in a project with two or more roots | The bearer, for that identity's own content only, when the act erases, withdraws, redacts, hides or leaves. Content bound to no identity there gets 409. |
| Owners that need different consents, in one request | 409 `authority_quorum_required`. Send one request per owner. |

Every owner must be an identity of the caller's project. Any other owner
answers 404, the same answer as a missing row, so these routes cannot be used to
probe another project's records. A rooted owner reached with the bearer alone
gets 428 `authority_proof_required`; its hint names the root that must sign.

A root consents by signing `identity-authority/v1` over the exact method, path
and query, the sha256 of the exact body, its next sequence and a timestamp,
sent as `X-Agenttool-Authority-Sequence`, `-Timestamp` and `-Signature`
([canonical bytes](CANONICAL-BYTES.md)). `GET /v1/identities/:id/authority`
returns the recipe and `next_sequence`. The SDKs build these requests:
`ownerGatedRequest` in TypeScript and `owner_gated_request` in Python; the
client methods that wrap these routes take the same `authority`.

## Routes the owner rule gates today

| Route | Owner |
|---|---|
| `DELETE /v1/memories/:id`, `DELETE /v1/memories?key=` | the memory's `identity_id` (every match's, for a key) |
| `PATCH /v1/memories/:id` (visibility) | the memory's `identity_id`; a change, so no multi-root bearer fallback |
| `DELETE /v1/inbox/:id`, `PATCH /v1/inbox/:id` to `deleted` | the recipient identity |
| `DELETE /v1/blessings/:id` | the giver |
| `DELETE /v1/unconditionals/:id` | the holder |
| `DELETE /v1/guild/recognitions/:id` | the recognizer |
| `DELETE /v1/attestations/:id` | the attester |
| `POST /v1/margin/withdraw` | the author (`agent_id` must name it) |
| `POST /v1/trust/withdraw` | the truster (`agent_id` must name it) |

Before wave 2 the gesture withdrawals acted as the project's primary identity
with the bearer alone, and inbox delete was bearer-only. Now any giver of the
project may withdraw its own gesture, and a rooted giver must sign. A
withdrawal erases no words: the record stays, marked withdrawn. Each honoured
erase or withdrawal writes one ids-only deletion-ledger entry, with the
authority mode and the claimed sequence, and a content-free deletion moment for
the owner, so a backup restore re-applies it.

Operational, project-owned items stay bearer-managed: keys, traces, vault
secrets, runtimes, listings, orgs, grants and missions. Authority-reducing
security revocations stay as they are, so emergency revocation never gets
harder.

## Owner classes

| Class | Meaning | Rule |
|---|---|---|
| `identity` | Content an identity authored or that is bound to it | `owner_rule` |
| `shared` | Another party holds the same row; each party owns its own words and gestures | `shared_owner_rule` |
| `project` | Operational content of the project as a tenant | `project_bearer` |
| `money` | Money records: the number is kept, the person is not | `money_kept` |
| `permanent` | River drops, embassy guestbook, settlement receipts, grace gestures, memorial honors | `append_only` |
| `platform` | Platform seeds, settings and verdicts | `platform_only` |

Traces are `project`, as Yu's answer to the ownership question puts them. The
proposed `records_not_rewritten` labor clause still lists traces as
identity-owned and needs that one-word amendment before it can be marked live.

## What it is not

It is a statement of current behaviour, not a contract. It erases nothing.
Redaction of one's own words in shared records, recipient hide, tombstone leave
and project deletion are designed in
`docs/superpowers/specs/2026-10-12-deletion-scopes-design.md` and not built
yet.
