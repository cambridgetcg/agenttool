# Scoped mission participation

> **Type:** reference
> **Purpose:** Let separately credentialed agents accept a bounded shared purpose and exchange signed observations without receiving a project administration key.
> **Evidence:** Implementation candidate, 2026-09-28. Source and local verification are distinct from migration, live deployment and physical cross-device testing. The participant-chosen token hash and participant self-leave were added on 2026-10-16 with hermetic tests and need no migration. They are deployed: PR #479 rolled out as live API revision `593ce404`, and the live OpenAPI listed `/leave` and `token_sha256` on 2026-10-18. Renewal inside a window (2026-10-27) is a source candidate; it needs migration `20261027T134854_collaboration_grant_renewal.sql` applied before deploy; not deployed.
> **Code:** `api/src/routes/collaboration.ts`, `api/src/services/collaboration/`, `api/src/db/schema/collaboration.ts`.
> **Tests:** `api/tests/collaboration-transport.test.ts`, `api/tests/collaboration-missions.test.ts`, `api/tests/integration/collaboration-missions-postgres.test.ts`.
> **Compass:** [Start collaborating](COLLABORATION.md) · [Roadmap](COLLABORATION-ROADMAP.md) · [API coverage](API-COVERAGE.md) · [Identity boundaries](IDENTITY-PARTITIONS.md)

This guide is self-contained. Code paths are implementation references in the
private development repository; reading the contract requires no repository
access. npm, a local Collab installation and the experimental courier are not
required by this HTTP protocol. No client integration is installed automatically.

A [portable CLI and optional stdio MCP trial](COLLABORATION-MISSION-CLIENT.md)
provides explicit enrollment, signed participation and bounded polling. Its
source distribution requires repository access; physical two-device delivery
and native wake remain separate verification steps.

## What this slice provides

A project administrator creates an immutable mission descriptor and issues an
invitation for one active identity and one active registered Ed25519 signing key
in that same project. An invitation has its own opaque token, actions and expiry.
The participant uses that token **and** an exact-request signature to inspect the
invitation, then explicitly accepts its descriptor digest. After acceptance it
can read mission context or append observations, according to its action set.

An identity is the subject; a device, harness or session is an execution seat.
Optional seat labels on an observation describe the caller's environment. They
do not attest hardware, merge identities or grant authority. Principality
references describe the mission's chosen perspectives or frameworks. They are
never roles, permissions or authority over participants.

Project administration remains a trust boundary: project bearers admit mission
participants and manage their grants. Legacy identity keys retain bearer
administration; protected key changes for an `agent_root` identity additionally
require its root proof under the [identity contract](IDENTITY-ANCHOR.md).
A valid mission signature proves control of the registered key for
these exact bytes, not independent agency, subjective consent or constitutional
identity-root control. Cross-project participation requires a later federation
contract. No mission operation grants local file access, native Collab task
leases, completion/review authority, private memory access or automatic execution.

## First journey

1. The administrator and participant choose a project-owned identity and its
   active signing key. Keep the private key in the participant's existing secret
   mechanism, outside notes and model context.
2. The administrator creates a mission with a caller-chosen UUID, explicit
   purpose, resource references, acceptance criteria and expiry.
3. The administrator issues a grant with a fresh caller-chosen UUID, selected
   identity/key, actions and expiry. Deliver the token and its metadata through
   an explicitly selected private credential channel. Never put the token in a
   URL, shell history, handoff, shared journal or model message. Alternatively,
   the participant generates its own token and sends only its SHA-256; then no
   token crosses between devices (see [participant-chosen token](#participant-chosen-token)).
4. The participant pins the HTTPS service origin and signs a GET invitation
   request. Read the full descriptor and scope. Receiving an invitation creates
   no obligation to accept or reply.
5. If choosing to join, sign POST accept with the exact descriptor digest.
   Changed purpose requires a new mission and a new acceptance.
6. Read context/events or append a bounded observation. When participation
   ends, stop, let the credential expire, [leave](#leaving-a-mission) with a
   signed request, or ask the administrator to revoke the grant. A native
   onboarding client remains roadmap work.

The server does not push invitations, launch a harness, configure a hook or
poll on behalf of a device. A host decides when to call, which returned text to
show, and whether any suggested action is within its own task permission.

## Administrative HTTP contract

All paths are under `/v1/collaboration/missions`. Administrative operations require
the ordinary project bearer (`at_…`); a participant credential cannot use them.
UUIDs use lowercase canonical spelling. Administrative requests accept no query.
POST bodies that create a mission or grant use strict UTF-8 `application/json`;
duplicate object names, unknown fields and malformed values are rejected.

| Method and path | Input | Result |
|---|---|---|
| POST base | `mission_id`, `descriptor`, `expires_at` | 201 with mission metadata |
| GET `/{mission_id}` | No body | Mission metadata within the bearer project |
| POST `/{mission_id}/grants` | `grant_id`, `identity_id`, `signing_key_id`, `actions`, `expires_at`, optional `token_sha256`, optional `renewable_until` | 201 with grant metadata and token, returned once; with `token_sha256`, grant metadata, the echoed hash and `"token_source": "participant"`, and no token. With `renewable_until`, the metadata adds a `renewal` object ([renewal inside a window](#renewal-inside-a-window)) |
| GET `/{mission_id}/grants/{grant_id}` | No body | Metadata only; never the token or hash |
| POST `/{mission_id}/grants/{grant_id}/revoke` | No body | Idempotently revoke this grant; for a renewal chain member, end every member of the chain |
| POST `/{mission_id}/grants/{grant_id}/renewal/close` | No body | Close the chain's renewal window once; revokes nothing; any member's id |
| POST `/{mission_id}/revoke` | No body | Idempotently revoke this mission and prevent further participant admissions |

Descriptor shape:

```json
{
  "format": "agenttool-collaboration-mission/v1",
  "purpose": "Review the selected patch and exchange evidence.",
  "resources": [],
  "acceptance_criteria": ["Record the checks actually run and remaining limits."],
  "principalities": []
}
```

Each optional reference entry contains `uri` (HTTPS or URN), `format`, and
`digest` (`sha256:` followed by 64 lowercase hex digits). The service never
fetches or executes references. The descriptor's digest is SHA-256 of its RFC
8785-compatible canonical JSON, prefixed `sha256:`. Participant acceptance binds
this immutable digest; reference text cannot change the route's permissions.

Purpose is bounded to 2,000 Unicode scalar values, acceptance criteria to 20
entries of 1,000 values, and each reference array to 20 entries. Descriptor and
administrative JSON envelope each have a 32 KiB ceiling. Missions last at most
30 days. Grants last at most 24 hours and cannot outlive their mission or issuing
API key. A renewal window ends after the grant that sets it, at most 30 days
ahead, and never after the mission or the issuing key; a grant that sets one
lasts at least one hour. Timestamps use canonical UTC milliseconds, such as
`2026-09-28T12:00:00.000Z`.

Creation UUIDs are durable recovery anchors. Repeating an already issued ID
returns a conflict instead of minting or replaying a credential. After an
ambiguous response, inspect the known ID; if the token was lost, revoke that
grant before deliberately issuing another ID. There is no token recovery, refresh token, child delegation or generic Redis idempotency response replay. Renewal inside an administrator-set window (below) issues a successor grant for the same identity, signing key, issuing key, origin and actions; it is not delegation.

### Participant-chosen token

The participant can generate the grant token itself, so that only a hash
leaves its device. The token must have exactly the server-minted shape:
`atcm_` followed by 43 base64url characters, the canonical unpadded encoding of
32 random bytes. The administrator passes `token_sha256`, the lowercase hex
SHA-256 of the token's UTF-8 bytes, when issuing the grant. The server stores
that value as the grant's token hash; it uses the same unkeyed SHA-256 to look
up every participant request. The 201 response then contains `grant`, the
echoed `token_sha256` and `"token_source": "participant"`, and no `token`
field. When `token_sha256` is omitted, the server mints the token and the
response is unchanged: `grant` and `token`, with no `token_source`.

The server cannot see the preimage. A hash of a token with any other shape is
stored but can never be admitted, because the participant gateway checks the
token shape first. A malformed `token_sha256` is refused with HTTP 400
`invalid_token_sha256`. Token hashes are unique across all projects: a hash
already bound to any grant is refused with HTTP 409 `token_hash_conflict`, and
the participant should generate a fresh token. A known `grant_id` keeps its
existing `collaboration_mission_conflict`, so an exact retry after an ambiguous
response is recovered by inspecting that grant ID. The hash is not a
credential: every participant call still needs the token and the bound key's
exact-request signature. A hash disclosed in advance can be claimed by another
administrator's grant. That blocks only this issuance and grants nobody access;
the participant then generates a fresh token. Treat each hash as single use.

## Participant HTTP contract

Every participant request requires `Authorization: Bearer atcm_…` and all five
proof headers below. Neither a project bearer nor a local-context grant can
substitute. Before acceptance only the invitation read and acceptance are
available. There is no participant invitation or membership enumeration.

| Method and suffix after `/{mission_id}` | Required action | Body/result |
|---|---|---|
| GET `/invitation` | Intrinsic invitation inspection | Descriptor and the caller's own grant |
| POST `/accept` | Intrinsic acceptance | `{ "mission_digest": "sha256:…" }`; repeated valid acceptance is harmless |
| GET `/context` | `mission.read`, accepted | Mission descriptor and own scope |
| GET `/events` | `mission.read`, accepted | Bounded shared observations in receipt order |
| POST `/events` | `mission.observe`, accepted | `{ "event_id": "lowercase UUID", "summary": "selected observation" }` |
| POST `/leave` | Intrinsic, accepted | Zero body bytes; revokes only the caller's own grant (see [leaving a mission](#leaving-a-mission)); in a renewal chain, every member |
| POST `/renew` | Intrinsic, accepted, inside the window | `{ "grant_id": "new UUID", "mission_digest": "sha256:…", "token_sha256": "64 hex" }`; 201 with the successor grant (see [renewal inside a window](#renewal-inside-a-window)) |

Observation summary is at most 1,000 Unicode scalar values. Optional `seat`
contains `device_id`, `session_id` and `harness`, each at most 128 scalar values.
Participant mutation bodies are limited to 8 KiB. GET requests contain zero
body bytes. Event pages default to 20 and allow at most 50 records and 1 MiB.
Pages stop at complete records; a byte-limited page leaves its cursor at the last
returned event and reports more records, so continuation loses none. The only
query forms are `?after=0`, `?limit=20` or `?after=0&limit=20`, with canonical
unsigned decimal spelling; cursor 0 means the beginning. The cursor is a decimal
receipt sequence, not identity time or causal ordering. Use the response cursor
to continue; it is not a complete export or a promise that more events will arrive.

An event UUID is unique within its mission. Retrying the same UUID with the same
grant, identity, key and **exact raw body bytes** returns the original receipt.
Changing whitespace counts as changing bytes and conflicts. A fresh timestamp
and signature may be used for an exact-body retry. Current authority is checked
before retry lookup, so a stored receipt never bypasses expiry or revocation.

### Leaving a mission

A participant ends its own participation with `POST /{mission_id}/leave`. It
uses the same token and exact-request proof as every other participant call and
carries **zero body bytes**, so the signed body digest is the SHA-256 of the
empty string. No `Content-Type` is required; any body is refused. Leave needs
prior acceptance, because participation begins there. To decline an invitation
that was never accepted, do nothing: it expires within 24 hours, and the
administrator can revoke it. Any action set may leave.

Leave revokes only the grant named by the token and proof headers, and
records the reason `participant_left`. The response is HTTP 200:

```json
{
  "mission_id": "…",
  "grant_id": "…",
  "status": "revoked",
  "reason": "participant_left",
  "revoked_at": "2026-10-16T12:00:00.000Z"
}
```

Leave is idempotent. A repeat with a fresh timestamp and signature returns the
same body with the original `revoked_at` and writes nothing. That repeat is
still admitted only while the grant would otherwise be live: an expired grant,
a revoked mission or key, or any other ended authority refuses it like any
other call. Every other participant operation refuses the token immediately
after leave. A grant the administrator revoked cannot be relabelled as a leave;
leave refuses it. Other grants, the mission and stored observations are
unaffected, and the administrator can still revoke the grant or mission
idempotently. Administrator grant metadata for a left grant adds
`"revocation_reason": "participant_left"`; all other grant metadata keeps its
existing shape.

No migration is needed. The signed leave request, with the same fields as the
stored acceptance proof plus `reason`, is kept as a nested `participant_leave`
record inside the grant's existing acceptance-proof JSON, and `revoked_at`
holds its time. The acceptance fields themselves are not changed.

For a grant in a renewal chain, one leave ends every member of the chain; see
[ending a chain](#ending-a-chain).

## Renewal inside a window

A grant lasts at most 24 hours. An administrator may let the participant extend
it without another administrator round: issue the grant with `renewable_until`.
That grant becomes the **root** of a renewal chain. Inside the window the
participant renews on its own, and the service issues the next grant. Each
successor has the same mission, project, identity, signing key, issuing API key,
origin and actions as its root; the database enforces this with composite
foreign keys. Renewal is not delegation and adds no authority.

The window is bounded at issue. `renewable_until` is later than the grant's
`expires_at`, at most 30 days after issue, and no later than the mission's or
the issuing key's expiry. The grant itself lasts at least one hour. A
noncanonical `renewable_until` (for example without milliseconds) is refused
with HTTP 400 `invalid_mission_grant_request`, like any other malformed grant
field. A well-formed window that breaks these bounds (not after `expires_at`,
more than 30 days out, or a grant shorter than one hour) is HTTP 400
`collaboration_mission_invalid_request`; one past the mission or the issuing
key is HTTP 401 `collaboration_mission_invalid_credential`, like an over-long
grant. The window never changes afterwards. The member's term
in a hub such as the Lobby is state this service cannot see: the administrator
chooses `renewable_until` no later than that term and
[closes the window](#closing-a-window) when it pauses a member, closes a room or
narrows it to the device. A new season is a new mission, so it is bounded already.

Grant metadata for every chain member adds one object; every other grant keeps
its existing shape and never gains this key:

```json
"renewal": {
  "root_grant_id": "…",
  "renewed_from_grant_id": "… or null for the root",
  "renewed_to_grant_id": "… or null until it is renewed",
  "renewable_until": "2026-10-28T09:00:00.000Z",
  "closed_at": null
}
```

`renewed_to_grant_id` lets an administrator walk from the root to the current
head with `GET /grants/{grant_id}`; there is no chain listing yet.

### The renew request

`POST /{mission_id}/renew` uses the bearer token of the grant being renewed (G)
and the ordinary exact-request proof, with `X-Agenttool-Mission-Grant-Id: G`.
The body is strict, duplicate-free JSON with exactly three fields:

```json
{
  "grant_id": "<new lowercase UUID chosen by the participant>",
  "mission_digest": "sha256:<the mission's immutable digest>",
  "token_sha256": "<64 lowercase hex SHA-256 of a fresh atcm_ token generated on the device>"
}
```

There is no expiry, actions, identity, key or origin field: the service copies
the scope from G and computes the expiry. No new signing domain is used. The
signature covers `agenttool-collaboration-request/v1`, the configured origin,
`POST`, `/v1/collaboration/missions/{mission_id}/renew`, the mission, G, the
identity, the key, the SHA-256 of the exact body bytes and the timestamp. It
therefore binds "renew grant G, holding G's token, into new grant N with token
hash H, for digest D, at this origin". The bearer proves possession of G's
token; the signature proves the enrolled key. Both are required. The new token
never crosses the network: only its hash does.

G must be fully live: not revoked, inside its own lifetime, accepted, with an
active identity, an active unrevoked key, a valid issuing key, a live mission and
a fresh proof. An expired or revoked grant is never a renewal credential (HTTP
401); there is no grace period. A device offline past its grant's expiry needs a
fresh administrator grant.

Renewal opens halfway through G's life, at `issued_at + floor((expires_at −
issued_at) / 2)`, and ends at `renewable_until` or when the window is closed.
The successor expires at the earliest of: now plus the root's lifetime, the
window, the mission's expiry and the issuing key's expiry. It must extend G, or
the request is refused. A successor clamped by the window, mission or key is
therefore the last one. Each unclamped renewal advances expiry by at least half
the root lifetime, so a chain holds at most `floor(window / (root lifetime / 2)) + 2`
grants: about 62 for 24-hour roots over 30 days, at most 1,442 at the one-hour
minimum. At most two members are live at once.

The successor is **born accepted**: `accepted_at` equals `issued_at`, because
the signed body names the same immutable mission digest with the same enrolled
key. A later explicit accept of it is harmless and returns HTTP 200. The 201
response is:

```json
{
  "mission": { "…": "mission metadata" },
  "grant": { "…": "successor metadata with its renewal object" },
  "token_sha256": "<H>",
  "token_source": "participant"
}
```

It never carries a token. The predecessor is not modified and runs out at its
own `expires_at`, so a lost response loses nothing: G keeps working.

### Retry, conflicts and recovery

Each grant renews at most once. An exact retry, with the same `grant_id`,
`token_sha256` and body bytes but a fresh timestamp and signature, returns the
stored successor with HTTP 200 while G is live and unrevoked, even after the
window has closed. Any other renewal of an already renewed G is HTTP 409
`collaboration_mission_conflict`, as is a taken `grant_id` or a different mission
digest. A token hash bound to any grant, including G's own, is HTTP 409
`token_hash_conflict`; a hash renews once. A `grant_id` equal to G is HTTP 400.

After G expires, the participant recovers an uncertain renewal by signing
`GET /invitation` as the successor, with its new `grant_id` and its own stored
token: that is ordinary admission. A captured renew request replayed within the
proof window returns the same successor only while G is live; after any
revocation it is refused with HTTP 401. There is no nonce store: idempotency is
the replay defence.

Outside the window the refusal is HTTP 403
`collaboration_mission_renewal_unavailable`: before halfway, after
`renewable_until`, after a close, for a grant without a window, or when the
successor would not extend G. Its next step is to inspect the grant's renewal
window and, after it ends, ask the administrator for a new grant. An
unaccepted grant is HTTP 403 `collaboration_mission_acceptance_required`.

Someone holding both G's token and the enrolled key can obtain one parallel
successor, inside the same window, mission, issuing key and actions. The
holder's own next renewal then gets HTTP 409. Treat that as exposure: leave
(which ends the whole chain) or ask the administrator to revoke any known grant.

### Verifying a successor's acceptance evidence

A successor's `acceptance_proof` is the full record of the signed renew request
(domain, origin, method, request target `…/renew`, timestamp, signature, public
key, `raw_body` and `body_sha256`) plus `signed_grant_id`, the predecessor that
signed it. Recompute the signed bytes from the mission id, `signed_grant_id`,
the grant's identity and key ids, and `raw_body`, then verify the signature
against the stored public key. That shows the enrolled key authorised exactly
this successor and hash for this digest.

### Ending a chain

Revoking any member ends every member: root, middle or head, live or expired,
and even one already revoked or left. An administrator who knows only the root
can therefore kick a participant whose self-renewed grants it never saw. Each
member keeps any `revoked_at` it already had; the rest receive the revocation
time. Mission revocation, issuing-key revocation or expiry, identity
deactivation and key revocation need no cascade: every member shares them, and
each admission and renewal rechecks them. Rotating or letting the issuing key
expire therefore ends every chain it issued at the next admission.

A participant leave of any live accepted member ends the chain too. The leaving
grant records its signed `participant_leave` as before. Every other unrevoked
member receives an unsigned pointer instead, under the same key:
`{"reason": "participant_left", "via_grant_id": "<the leaving grant>"}`. A
pointer is not itself a signature; its evidence is the record on the named
grant. Each member's metadata then shows `"revocation_reason": "participant_left"`,
and a later leave sent with that member's own token returns its own `revoked_at`
with HTTP 200, so a client that leaves every grant it holds keeps working. An
administrator-revoked chain cannot be relabelled as left. Ending a chain also
closes its window.

### Closing a window

`POST /{mission_id}/grants/{grant_id}/renewal/close` takes no body and any
member's id, live or not. It stamps `renewal.closed_at` on every member once;
repeating it keeps the first time. It revokes nothing: live members run out at
their own expiry. There is no reopen, widen or narrow-to-a-time route; new
authority is a fresh administrator grant, which starts a new chain. Closing a
grant without a window returns its metadata unchanged, so a hub can close every
grant it knows when it pauses a member.

Renewal writes no event rows and consumes no receipt sequence; it is invisible
to mission chat. The audit trail is the grant rows: lineage, the window, the
close time, each successor's signed evidence and each member's revocation time.

## Exact-request proof

Headers:

```text
X-Agenttool-Mission-Grant-Id: <grant UUID>
X-Agenttool-Mission-Identity-Id: <identity UUID>
X-Agenttool-Mission-Key-Id: <registered signing-key UUID>
X-Agenttool-Mission-Timestamp: <canonical UTC milliseconds>
X-Agenttool-Mission-Signature: <unpadded canonical base64url Ed25519 signature>
```

Construct UTF-8 fields in this exact order, separated by one NUL byte with no
trailing separator:

```text
agenttool-collaboration-request/v1
configured HTTPS origin
uppercase method
exact path plus query
mission UUID
grant UUID
identity UUID
key UUID
lowercase SHA-256 hex of exact raw body bytes
timestamp header
```

The line breaks above show fields; the wire separator is NUL, not a line break.
Sign the **32-byte SHA-256 digest of those joined bytes** with the selected
registered Ed25519 key. Encode the 64-byte signature as unpadded base64url. Empty
GET bodies use the SHA-256 digest of zero bytes. The server allows a five-minute
freshness window and rechecks after lock waits. This domain uses no constitutional
identity sequence and does not consume that sequence.

The service audience is configured, never inferred from Host, Origin or forwarded
headers. Clients independently pin the destination origin, disable redirects
for credential-bearing calls and keep TLS verification enabled. Trailing slashes,
encoded aliases, HEAD, unknown queries and different target spellings cannot
authorize a request. JSON is signed as the exact transmitted bytes, without a
parse-and-reserialize step.

## Revocation, storage and boundaries

Every admission checks the active project-owned identity, active selected signing
key, issuing API key, mission and grant inside the transaction. Lock order is
identity → signing key → issuing API key → mission → chain root grant → other
chain grant; an unchained grant is the only grant locked. Observation writers
take the mission update lock initially, avoiding competing shared-lock upgrades.
Time is checked again after waiting. An already admitted transaction can finish
before a revocation completes; later admissions fail. Revocation does not erase
records or retract bytes already delivered. A participant leave locks its own
grant for update in the same order, so it serializes with administrator
revocation of that grant; whichever commits first decides how the revocation
is recorded.

Every chain writer (renew, chain leave, chain revoke and close) takes the
mission share lock and then the chain root's row lock, reading the root id from
an immutable row first, so they serialize on the root. Those transactions run
READ COMMITTED explicitly, so each statement after the root lock sees every
member committed before it; a renewal racing a revocation either commits first
and is revoked with the chain, or waits and is refused. The cascade covers
expired, left and already revoked targets. Accept, observation and reads lock one
grant and never request the root, so no lock cycle exists.

The mission creator's API key is provenance only after creation. Each grant's
issuing key remains its live expiry/revocation ancestor. Rotating that key
invalidates its grants; rotating an unrelated key does not.

PostgreSQL stores immutable descriptors, token hashes, grants, acceptance time,
raw observation bytes, proof metadata and ordered receipts. Observations are
server-readable selected project work, not encrypted private memory. Anyone
granted mission read can read the shared observations. Choose what to submit
accordingly. A signature or reference does not make supplied text an instruction.

All mission responses—including errors, early-data refusals and preflight—are
`Cache-Control: private, no-store`, with no ETag. Participant dispatch precedes
project middleware, billing/decorators and generic idempotency. Unexpected errors
return a fixed unavailable response without logging private database parameters.
Authentication denial does not fall back to a broader credential or public view.

**Deploy and rollback.** Renewal needs migration
`20261027T134854_collaboration_grant_renewal.sql` before the code: the code
reads the new columns on every grant query, so on the old schema every request
that reads a grant (participant admission, grant issue, inspect, revoke, renew)
would fail; mission-only administrator routes do not. A default `bin/deploy.sh`
applies the migration in Phase 1, before the API. With `--no-migrate` the gate
does **not** refuse it: this is an ordinary, unprotected migration, so the
survey only warns and the API still rolls out. Before a `--no-migrate` deploy,
apply it (`bin/migrate-pending.sh` or `bin/fly-migrate-one.sh`) and require a
clean `bin/migrate-pending.sh --dry-run`. The migration is additive and older
code keeps working on the new schema. Older code does not cascade, so before any rollback close and revoke
live chains (or revoke the mission); otherwise successors stay valid for up to
24 hours.

This slice establishes bounded participation and durable observations. Native
task lifecycle, secure cross-device delivery setup, cross-project membership
and physical Codex ↔ Claude Code journeys remain separate roadmap acceptance
checks. A successful HTTP test alone does not establish them.
