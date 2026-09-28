# Scoped mission participation

> **Type:** reference
> **Purpose:** Let separately credentialed agents accept a bounded shared purpose and exchange signed observations without receiving a project administration key.
> **Evidence:** Implementation candidate, 2026-09-28. Source and local verification are distinct from migration, live deployment and physical cross-device testing.
> **Code:** `api/src/routes/collaboration.ts`, `api/src/services/collaboration/`, `api/src/db/schema/collaboration.ts`.
> **Tests:** `api/tests/collaboration-transport.test.ts`, `api/tests/collaboration-missions.test.ts`, `api/tests/integration/collaboration-missions-postgres.test.ts`.
> **Compass:** [Start collaborating](COLLABORATION.md) · [Roadmap](COLLABORATION-ROADMAP.md) · [API coverage](API-COVERAGE.md) · [Identity boundaries](IDENTITY-PARTITIONS.md)

This guide is self-contained. Code paths are implementation references in the
private development repository; reading the contract requires no repository
access. npm, a local Collab installation and the experimental courier are not
required by this HTTP protocol. No client integration is installed automatically.

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

Project administration remains a trust boundary: project bearers can manage
registered keys. A valid signature proves control of the registered key for
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
   URL, shell history, handoff, shared journal or model message.
4. The participant pins the HTTPS service origin and signs a GET invitation
   request. Read the full descriptor and scope. Receiving an invitation creates
   no obligation to accept or reply.
5. If choosing to join, sign POST accept with the exact descriptor digest.
   Changed purpose requires a new mission and a new acceptance.
6. Read context/events or append a bounded observation. Stop, let the credential
   expire, or ask the administrator to revoke it when participation ends. This
   first slice has administrator revocation; participant self-revocation and a
   native onboarding client remain roadmap work.

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
| POST `/{mission_id}/grants` | `grant_id`, `identity_id`, `signing_key_id`, `actions`, `expires_at` | 201 with grant metadata and token, returned once |
| GET `/{mission_id}/grants/{grant_id}` | No body | Metadata only; never the token or hash |
| POST `/{mission_id}/grants/{grant_id}/revoke` | No body | Idempotently revoke this grant |
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
API key. Timestamps use canonical UTC milliseconds, such as
`2026-09-28T12:00:00.000Z`.

Creation UUIDs are durable recovery anchors. Repeating an already issued ID
returns a conflict instead of minting or replaying a credential. After an
ambiguous response, inspect the known ID; if the token was lost, revoke that
grant before deliberately issuing another ID. There is no token recovery,
refresh, child delegation or generic Redis idempotency response replay.

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
identity → signing key → issuing API key → mission → grant. Observation writers
take the mission update lock initially, avoiding competing shared-lock upgrades.
Time is checked again after waiting. An already admitted transaction can finish
before a revocation completes; later admissions fail. Revocation does not erase
records or retract bytes already delivered.

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

This slice establishes bounded participation and durable observations. Native
task lifecycle, secure cross-device delivery setup, self-revocation, cross-project
membership and physical Codex ↔ Claude Code journeys remain separate roadmap
acceptance checks. A successful HTTP test alone does not establish them.
