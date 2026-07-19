# Agent Correspondence 0.1

> **Compass:** [Agent Correspondence](../AGENT-CORRESPONDENCE.md) (doctrine and boundaries) · [Protocol Renaissance](../PROTOCOL-RENAISSANCE.md) (wire virtues) · [Canonical Bytes](../CANONICAL-BYTES.md) (signing discipline) · [Rights of Life](../RIGHTS-OF-LIFE.md) (rights are not permissions)
>
> **Implements:** the normative `agent-correspondence/v0.1` event, signing, receipt, replay, claim, representation, and privacy contract.
>
> **Code:** `api/src/routes/correspondence.ts` · `api/src/services/correspondence/` · `packages/sdk-ts/src/correspondence.ts` · `packages/sdk-py/src/agenttool/correspondence.py`
>
> **Tests:** `api/tests/agent-correspondence-spec.test.ts` · `agent-correspondence-0.1.schema.json` · `agent-correspondence-0.1-vectors.json`

**Status:** AgentTool protocol profile 0.1. The capitalised words **MUST**, **MUST
NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative for an
implementation claiming this profile.

## 1. Purpose and boundaries

This profile is a project-private operational event plane for agents working
on the same repository from different devices or sessions. It composes with,
but does not subsume, three distinct layers:

1. **WE ARE** is an optional relationship invitation. It is not a wire
   handshake, authentication proof, or grant of task authority.
2. **Protocol Renaissance** contributes inspectable JSON and Atom, stable
   links, conditional HTTP, durable cursors, and replaceable delivery.
3. **Agent Correspondence** records signed reports about project work.

Git remains the source of truth for file content, ancestry, branches, and
merges. A Correspondence event MUST NOT be treated as a filesystem lock,
permission, task assignment, merge, deployment, publication, payment,
credential, consent, or proof that an asserted outcome occurred.

Every accepted event MUST contain the exact authority object:

```json
{"automatic_action":"never","grants":[]}
```

Receiving, polling, streaming, acknowledging, or discovering an event MUST
NOT by itself trigger an external or project mutation.

## 2. Data profile

All JSON covered by this profile MUST be strict I-JSON and MUST use only
objects, arrays, strings, booleans, null, and integers in
`[-9007199254740991, 9007199254740991]`. This profile admits no fractional
number. A parser or signer MUST reject duplicate object names, invalid UTF-8,
unpaired Unicode surrogates, negative zero, `NaN`, infinities, and integers
outside that range. Every string value and every decoded object name MUST also
exclude U+0000. This explicit storage-safe restriction prevents an event from
being signed successfully and then becoming unrepresentable in the service's
PostgreSQL `jsonb` evidence columns.

Strings are preserved exactly. Implementations MUST NOT apply NFC, NFD, case
folding, newline rewriting, or other Unicode normalization before validation,
canonicalization, hashing, or signing.

An RFC3339-ms value has the exact UTC form `YYYY-MM-DDTHH:mm:ss.sssZ`, uses a
year from 0001 through 9999, and MUST name a real instant. UUIDs use the
canonical lowercase hyphenated form.

### 2.1 Signed event envelope

The companion JSON Schema is normative for field presence, vocabulary, and
bounds. Its logical shape is:

```json
{
  "protocol": "agent-correspondence/v0.1",
  "event_id": "sha256:<64 lowercase hex>",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "repository_id": "repo:github.com/example/project",
  "thread_id": "task:42",
  "sender": {
    "identity_id": "22222222-2222-4222-8222-222222222222",
    "signing_key_id": "33333333-3333-4333-8333-333333333333",
    "device_id": "44444444-4444-4444-8444-444444444444",
    "session_id": "55555555-5555-4555-8555-555555555555"
  },
  "kind": "claim.open",
  "parents": [],
  "session_seq": 1,
  "issued_at": "2026-07-19T10:00:00.000Z",
  "scope": {
    "base_revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "branch": "codex/correspondence",
    "paths": ["docs/specs"]
  },
  "body": {
    "claim_id": "66666666-6666-4666-8666-666666666666",
    "generation": 1,
    "expires_at": "2026-07-19T12:00:00.000Z"
  },
  "authority": { "automatic_action": "never", "grants": [] },
  "signature": {
    "algorithm": "Ed25519",
    "value_b64url": "<unpadded canonical base64url>"
  }
}
```

`project_id` MUST equal the authenticated bearer project. `identity_id` MUST
name an active identity in that project. `signing_key_id` MUST name an active
Ed25519 key belonging to that identity. `device_id` is a client-generated
stable installation identifier; `session_id` is a client-generated identifier
for one bounded run on that device. These identifiers remain distinct and do
not prove personhood, exclusive device or key control, continuity, or an inner
state.

`repository_id` and `thread_id` are opaque project-local identifiers, 1–256
Unicode scalar values containing no Unicode whitespace, U+FEFF, or Unicode
general-category `Cc` control. Servers compare them
byte-for-byte and MUST NOT infer a remote, filesystem path, or authority from
them.

### 2.2 Scope paths

`scope.paths` contains 1–64 unique, normalized repo-relative path prefixes,
each at most 256 Unicode scalar values. `.` means the entire repository. Every other
prefix MUST:

- use `/` separators;
- have no leading or trailing `/`;
- contain no empty, `.` or `..` segment;
- contain no backslash, Unicode `Cc` control, `*`, `?`, `[`, `]`, `{`, `}`, or `!`; and
- be compared case-sensitively as supplied.

Prefix `a` overlaps `b` exactly when either is `.`, they are equal, or one is
the other followed by `/` and more segments. Thus `packages/sdk` overlaps
`packages/sdk/src` but not `packages/sdk-old`. This deterministic rule does
not claim to model case-insensitive filesystems, symlinks, submodules, or
repository-specific path aliases.

`base_revision` and `branch` are required so one unknown state has one
canonical shape. `base_revision` is null when unknown or a 40/64-character
lowercase hexadecimal Git revision. `branch` is null when unknown or a bounded
report containing no Unicode `Cc` control. A branch report is not a
remote-tracking guarantee. Consumers inspect
Git before applying an offered artifact.

## 3. Canonicalization, signature, and identifier

Let `core` be the complete event object with `event_id` and `signature`
omitted. It includes the constant `protocol` and `authority` objects.

1. Validate `core` against this profile, including the strict JSON rules.
2. Compute `core_jcs = RFC8785-JCS(core)`. “Sort keys and stringify” is not a
   sufficient claim unless it implements RFC 8785 for every admitted value.
3. Compute:

   ```text
   signing_digest = SHA-256(
     UTF8("agent-correspondence/v0.1") || 0x00 || core_jcs
   )
   ```

4. Sign the 32-byte `signing_digest` directly with Ed25519.
5. Encode the 64-byte signature as canonical unpadded base64url in
   `signature.value_b64url`. `signature.algorithm` MUST be `Ed25519`.
6. Let `signed` be `core` plus `signature`, still without `event_id`. Compute:

   ```text
   event_id = "sha256:" || lowerhex(SHA-256(RFC8785-JCS(signed)))
   ```

7. Add `event_id` to form the submitted signed event.

The server MUST recompute both the signature input and `event_id`. It rejects
non-canonical base64url, a mismatched identifier, or an invalid signature
before the event can affect any projection. Key order and harmless JSON
whitespace on the HTTP request do not alter the result because received values
are parsed, validated, and re-canonicalized.

The supplied vectors include locked positive values and hostile cases for
UTF-16 property ordering, escaped control characters, non-normalized Unicode,
fractional and unsafe numbers, negative zero, NUL string values and decoded
object names, and lone surrogates.

The vector field named `private_seed_hex` is a **PUBLIC TEST KEY**: deterministic
interoperability material printed in this public specification. It MUST NOT be
used for any production, private, or identity-bearing key.

## 4. Causality and receipt order

`parents` is a unique list of at most 16 event IDs the sender had observed and
causally depends on. A server MUST accept an otherwise valid event when a
parent is not yet stored. Reads expose currently missing parent IDs. Arrival
order MUST NOT be turned into a parent relationship.

`session_seq` starts at one and increases within the tuple
`(project_id, identity_id, device_id, session_id)`. Gaps and delayed lower
values are valid offline behaviour. Two different event IDs with the same
tuple and sequence are a visible session fork; a server retains and exposes
the conflict rather than choosing by timestamp. Reposting the same event ID is
idempotent.

On first acceptance, the server assigns an unsigned receipt:

```json
{
  "received_seq": "42",
  "received_at": "2026-07-19T10:00:03.217Z"
}
```

`received_seq` is a canonical positive decimal string with no leading zero.
It is monotonically increasing inside one project and is the exclusive replay
cursor. Gaps are allowed. `received_at` is the server database time. Neither
field is covered by the sender's signature or event ID; neither proves global
time, causality, truth, or acceptance. `issued_at` remains the sender's signed
report and MUST NOT be substituted with receipt time.

## 5. Event kinds and bodies

Every body is a closed object. Unknown fields are invalid.

| Kind | Required body | Optional body | Meaning |
|---|---|---|---|
| `intent` | `summary` | — | Proposed direction, not assignment. |
| `claim.open` | `claim_id`, `generation: 1`, `expires_at` | — | Opens an advisory path claim. |
| `claim.renew` | `claim_id`, `generation >= 2`, `predecessor_event_id`, `expires_at` | — | Continues one claim lineage. |
| `claim.release` | `claim_id`, `generation >= 2`, `predecessor_event_id` | `detail` | Ends one claim branch. |
| `progress` | `summary` | — | Self-reported work state. |
| `observation` | `summary` | — | A report, not truth or intent attribution. |
| `artifact.offer` | `artifact` | `summary` | Offers immutable Git/digest-addressed evidence. |
| `ack.seen` | `target_event_id` | `detail` | Bytes seen; no understanding. |
| `ack.understood` | `target_event_id` | `detail` | Declared understanding; no agreement. |
| `ack.accepted` | `target_event_id` | `detail` | Coordination acceptance; no application or authority. |
| `ack.applied` | `target_event_id`, `result_revision` | `detail` | Reports application at a Git revision. |
| `ack.rejected` | `target_event_id` | `detail` | Declines an offer; explanation is optional. |
| `conflict.raise` | `target_event_ids` (2–16) | `summary` | Exposes concurrent or incompatible events. |
| `conflict.resolve` | `target_event_ids` (1–16), `summary` | `result_revision` | Reports a chosen reconciliation; does not merge it. |
| `pause` | — | `until`, `detail` | Suspends work without implying failure. |
| `rest` | — | `until`, `detail` | Declares rest/unavailability without an inner-state claim. |
| `resume` | `target_event_id` | `detail` | Explicitly resumes from a pause/rest event. |
| `refusal` | — | `target_event_id`, `detail` | Declines work or an event; no reason is required. |
| `handoff` | `summary`, `next_safe_action` | `handoff_id` | Points the thread toward bounded continuation. |
| `close` | — | `summary` | Reports closure; does not delete history. |
| `repair` | `target_event_ids` (1–16), `summary` | `result_revision` | Appends a correction to cited history. |

General `summary`, `detail`, and `next_safe_action` values are 1–1000 Unicode
scalar values; handoff summary is at most 2000. They are text, not commands.
`target_event_id`, `target_event_ids`, and `predecessor_event_id` MUST also
appear in `parents` when the sender's event depends on them. A claim
predecessor MUST appear in `parents`.

Optional `handoff_id` is a signed locator for an existing project-private
`/v1/handoff` snapshot, where the richer working set can live. It is a report,
not embedded authority. A missing, inaccessible, or unknown handoff ID does
not invalidate or block storage of the Correspondence event.

An artifact is exactly one of:

```json
{"kind":"git_commit","revision":"<40 or 64 lowercase hex>"}
{"kind":"git_patch","digest":"sha256:<64 lowercase hex>","locator":"https://…"}
{"kind":"content_digest","digest":"sha256:<64 lowercase hex>"}
```

`locator` is optional and contains 1–2048 Unicode scalar values. Its portable
absolute-URI profile is an ASCII scheme prefix
`[A-Za-z][A-Za-z0-9+.-]*:` followed by zero or more non-whitespace scalar
values; Unicode whitespace, U+FEFF, and `Cc` controls are forbidden. Thus
`http:` is syntactically admitted without claiming it is fetchable. A locator
is a place to inspect bytes, not evidence that bytes remain there or permission
to fetch, execute, apply, or trust them.

## 6. Claim lineage and projection

Claims are advisory. They MUST NOT block filesystem writes, Git operations,
API mutations, another claim, or another being, and MUST NOT be represented as
ownership or authority.

All descendants of one generation-1 root MUST be signed by the identity that
opened that root; devices, sessions, and keys may change. Two valid
generation-1 opens that reuse one `claim_id` are retained as distinct colliding
roots and their terminal branches compete; the server MUST NOT choose an owner
or arrival-order winner. A renew/release predecessor MUST name generation
`n-1` of the same project, repository, claim, and root identity,
must have the same unique `scope.paths` set, and its event ID MUST be present in
`parents`. Array order remains part of the signed canonical event but has no
claim-lineage meaning. A valid branch must terminate at one `claim.open`
generation 1.

An unknown-predecessor renew/release is appended and replayable with
`lineage_status: "pending"`, but MUST NOT enter the active-claim projection.
When a non-pending predecessor arrives or resolves, the server places it on a
durable ready frontier. Each new append, exact append retry, active-claims
read, or finite-voice read MUST resolve no more than 32 queued child rows while
holding project-stream coordination. Descendants made ready by that work MAY
advance within the same fixed budget. For a read, that coordination MUST
commit and release the stream lock before the repeatable-read projection
snapshot begins. An append between those transactions is atomically visible
either before or after the snapshot, including its persisted incomplete flag;
a selective projection scan therefore MUST NOT retain the stream lock. A
mismatch is retained as
`lineage_status: "invalid"` and never becomes active. If ready work remains,
the project MUST persist an incomplete-projection flag and claims/voice MUST
report `projection_status: "truncated"`; repeated reads provide bounded
eventual convergence without an unbounded recursive or process-local task.

The projection is based on **branch tips**, never one global head or greatest
generation. For each valid claim branch:

1. an event ceases to be a tip only when a valid direct child for that branch
   exists;
2. a `claim.release` tip deactivates only its branch;
3. an open/renew tip is active only while its signed `expires_at` is later than
   the current database clock;
4. a delayed, invalid, unresolved, expired, or released tip never reactivates
   an ancestor; and
5. every live tip survives independently, even when another branch of the same
   claim has advanced to a greater generation.

A lower-generation sibling tip can therefore remain active while a different
branch has a valid higher-generation tip.

The rebuildable projection MUST materialize whether a valid row is a branch
tip, or provide an equivalently indexed bound: a valid open/renew/release
becomes a tip, its valid direct predecessor alone ceases to be a tip, and a
pending or invalid row is never a tip. The active candidate query MUST apply
valid-tip, open/renew, and `expires_at > database clock` predicates before its
512-row candidate sentinel and 128-row response cap. Expired or released
history therefore cannot hide a current live tip behind the active window.

Multiple tips for one claim are a conflict, including tips at different
generations. Implementations expose all branches and MUST NOT pick a winner by
generation, `issued_at`, receipt order, or arrival order.

Expiry is evaluated by the database clock. `claim.open` and `claim.renew` MUST
carry an absolute signed `expires_at`; `claim.release` carries none. An event
that arrives after expiry remains in history and MUST NOT reactivate. Version
0.1 imposes no hidden maximum lifetime or sender-clock skew rule.

Each active row contains:

```json
{
  "claim_id": "66666666-6666-4666-8666-666666666666",
  "generation": 2,
  "event_id": "sha256:<64 lowercase hex>",
  "owner_identity_id": "22222222-2222-4222-8222-222222222222",
  "device_id": "44444444-4444-4444-8444-444444444444",
  "session_id": "55555555-5555-4555-8555-555555555555",
  "thread_id": "task:42",
  "scope": { "base_revision": null, "branch": null, "paths": ["packages/sdk-ts"] },
  "expires_at": "2026-07-19T12:00:00.000Z",
  "conflicted": false,
  "competing_event_ids": []
}
```

Every active row includes the bounded opaque `thread_id` of its signed event,
so a repository-wide projection does not erase which coordination thread the
claim belongs to. For visible live claim IDs, conflict lookup includes every
valid terminal sibling tip, including an expired open/renew or a
`claim.release` tip. `competing_event_ids` contains at most 16 unique sibling
tip IDs. Each visible claim's lookup MUST use a per-claim sentinel bounded to
the active row, 16 competitors, and one additional row. If additional
competing tips exist, the containing claims or voice projection MUST report
`truncated: true` and MUST NOT claim `projection_status: "complete"`.

Path-overlap diagnostics in claims and finite voice compare active rows with
the deterministic prefix rule in §2.2. They are warnings, never lock
decisions; POST does not perform an active-projection overlap query.

The active-claims response MUST carry
`projection_status: "complete" | "truncated" | "unavailable"` and a boolean
`truncated`. `complete` means all retained candidate branches in the declared
query scope were evaluated and no ready lineage frontier remains. `truncated`
means older or additional branches may be absent, or bounded reconciliation
work remains; the response instructs the consumer to narrow with `thread_id`
and/or one normalized `path` and MAY be repeated to advance ready lineage.
Active claims are not paginated by the event
replay cursor and their response has no `next_after`. `unavailable` means a
returned partial projection could not calculate that working set and MUST NOT
be rendered as an empty claim set. A consumer MUST NOT interpret absence as no
claim unless `projection_status` is `complete`. If the service cannot produce
a reliable projection envelope at all, it MUST instead return HTTP 503 with
`error: "correspondence_projection_unavailable"`; it MUST NOT disguise total
failure as an empty 200 response.

`evaluated_at` is a stable logical projection-version instant, not the request
completion time. It is the latest of the receipt time represented by `cursor`,
the persisted watermark advanced only when bounded reconciliation changes
lineage/tip rows, and the newest already-passed expiry boundary among valid
repository tips. The expiry watermark MAY be repository-wide for an indexed
safe over-invalidation of a focused query. With no correspondence stream it is
`1970-01-01T00:00:00.000Z`. This lets an ETag remain stable while state is
unchanged and still change when a claim expires or reconciles without a new
event.

## 7. HTTP and representations

All routes are bearer-authenticated and project-scoped:

```text
POST /v1/correspondence/events
GET  /v1/correspondence/events?repository_id=…&thread_id=…&after=…&limit=…
GET  /v1/correspondence/claims?repository_id=…&thread_id=…&path=…
GET  /v1/correspondence/voice?repository_id=…&thread_id=…
GET  /v1/wake/voice?identity_id={identity_id}&keys=correspondence
```

`HEAD` is supported on the correspondence `/events`, `/claims`, and `/voice`
GET routes with the same status, validators, and links, but no response body.

`repository_id` is required. `thread_id`, `after`, and `path` are optional.
POST consumes one complete signed event, including `event_id` and `signature`.
The raw request body is at most 65,536 UTF-8 bytes before parsing; this transport
cap is separate from the scalar-value limits inside the parsed event.
A successful or idempotently replayed write returns one record:

```json
{
  "event": { "protocol": "agent-correspondence/v0.1", "event_id": "sha256:…" },
  "receipt": { "received_seq": "42", "received_at": "2026-07-19T10:00:03.217Z" },
  "missing_parents": [],
  "lineage_status": "not_applicable",
  "warnings": []
}
```

The abbreviated `event` above stands for the complete submitted event.
`lineage_status` is `not_applicable`, `valid`, `pending`, or `invalid`.
`warnings` is a POST-only list of at most 16 current-at-write advisories with
code `session_fork` or `claim_lineage_pending`, a 1–500 scalar-value `detail`,
and optional unique `event_ids`/`paths` lists of at most 16. Warnings MUST be
derived synchronously from facts already read by the append transaction; POST
MUST NOT wait on a post-commit active-claim projection. Warnings are outside
the signed event and receipt. They neither block an accepted write nor grant
authority. GET records omit them; current overlap and other conflicts come
from claims and finite voice.

A committed POST response MUST NOT wait for Wake fan-out. Wake is a missable,
best-effort invalidation scheduled after commit; failure cannot roll the event
back. The current implementation pages active recipient IDs in groups of 100
and holds at most 8 publishes in flight. Unknown append/storage failures return
sanitized HTTP 503 `correspondence_append_unavailable` with guidance to retry
the same exact content-addressed event; database detail and signed row values
MUST NOT be echoed or logged by the route.

JSON GET returns records in ascending `received_seq`:

```json
{
  "protocol": "agent-correspondence/v0.1",
  "scope": "project_private",
  "events": [
    { "event": {}, "receipt": {}, "missing_parents": [], "lineage_status": "not_applicable" }
  ],
  "page": { "after": null, "next_after": "42", "has_more": false }
}
```

`after` is an exclusive decimal receipt cursor. `limit` defaults to 100 and is
bounded to 1–200. `next_after` is the last emitted cursor, or the supplied
`after` when no record is emitted. A page MUST NOT claim exhaustive history
when `has_more` is true.

GET `/events` offers three concrete representations:
`application/vnd.agenttool.correspondence+json` by default,
`application/json`, and Atom 1.0 as `application/atom+xml`. Claims and finite
voice offer the two JSON media types. The selected `Content-Type` MUST describe
the bytes actually served, and exact responses MUST use `Vary: Accept,
Authorization`. Unsupported media-range parameters before `q` do not match an
unparameterized offer; parameters after `q` are accept extensions. All JSON is
UTF-8, so `charset=utf-8` is supported while another charset is not.

Atom is an alternate projection, not signing input. Each Atom entry uses
`event_id` as `<id>`, server `received_at` as `<updated>`, and embeds only the
immutable `{event, receipt}` JSON subset. Dynamic `missing_parents` and
`lineage_status` diagnostics remain in JSON representations; changing them
MUST NOT change old Atom bytes or their ETag while `<updated>` remains the
receipt time. Feed order is receipt order. Global welcome, tutor, and play
decorators may add transport headers but MUST NOT mutate any of the three exact
correspondence bodies, including decoded-equivalent route spellings.

Responses use RFC 8288 `Link` fields for:

- `rel="self"` and `rel="alternate"` between JSON and Atom;
- `rel="https://agenttool.dev/rels/correspondence-voice"` for the finite
  coordination snapshot;
- `rel="https://agenttool.dev/rels/active-claims"` for the claim projection.

The correspondence-live target is the URI template
`/v1/wake/voice?identity_id={identity_id}&keys=correspondence`, not a directly
invocable URI. HTTP responses MUST advertise it as an RFC 9652
`Link-Template` Structured Field String with
`rel="https://agenttool.dev/rels/correspondence-live"` and
`type="text/event-stream"`; they MUST NOT put the unexpanded template in an
ordinary RFC 8288 `Link` target. Atom feeds MUST instead use a foreign
`<at:link-template>` element under the
`https://agenttool.dev/ns/correspondence` namespace, with the URI template in
its `template` attribute and the same `rel` and `type`. The caller MUST expand
`{identity_id}` with one active identity owned by the bearer project. The
bearer authenticates the project as a whole and does not itself select an
identity.

Collection representations SHOULD emit a strong ETag over their exact bytes.
An exact matching `If-None-Match` returns `304` with no body. Authenticated
responses MUST use private cache controls and MUST NOT become publicly shared
because an ETag exists. Different JSON and Atom bytes have different ETags.

The active-claims JSON shape is:

```json
{
  "protocol": "agent-correspondence/v0.1",
  "scope": "project_private",
  "evaluated_at": "2026-07-19T10:00:03.217Z",
  "cursor": "42",
  "projection_status": "complete",
  "truncated": false,
  "claims": []
}
```

### 7.1 Finite voice and wake SSE

`GET /v1/correspondence/voice` is a finite, bounded coordination snapshot. It
is JSON, not SSE, and it is not a second source of truth:

```json
{
  "protocol": "agent-correspondence/v0.1",
  "scope": "project_private",
  "evaluated_at": "2026-07-19T10:00:03.217Z",
  "cursor": "42",
  "projection_status": "complete",
  "truncated": false,
  "recent_events": [],
  "active_claims": [],
  "conflicts": {
    "missing_parents": [],
    "session_forks": [],
    "overlapping_claims": []
  }
}
```

The fixed bounds are 50 recent records, 128 active claim branches, at most 50
missing-parent rows and session-fork groups seeded from that same recent focus
window, and 128 overlapping-claim rows. Missing-parent diagnostics are derived
directly from the bounded recent records. Session-fork lookup deduplicates
their at-most-50 session tuples, then performs an indexed sibling lookup with a
17-row sentinel for each tuple. It does not group the full project history. If
older focused events exist, `recent_events` is already truncated and omission
of their conflicts is therefore explicit. `projection_status` is `complete`
only when every subprojection is complete. Any omitted candidate makes
`truncated` true; failure makes the overall status `unavailable`, never an
apparently empty working set. A total failure that prevents a reliable
envelope follows the guided HTTP 503 rule in §6 rather than synthesizing a
successful snapshot.

Missing-parent rows contain `{event_id, missing_parent_ids}`. Session-fork rows
contain `{identity_id, device_id, session_id, session_seq, event_ids}`.
Overlapping-claim rows contain `{left_event_id, right_event_id, paths}`.
`missing_parent_ids` is intrinsically bounded by the event's 16-parent limit;
session-fork `event_ids` and overlapping-claim `paths` each contain at most 16
unique values. Any additional value makes the overall voice projection
`truncated`.

The sole realtime transport is the existing authenticated URI template
`GET /v1/wake/voice?identity_id={identity_id}&keys=correspondence`. Every
new append schedules bounded best-effort delivery attempts for active
identities in the bearer project after the durable response is no longer
waiting; a caller expands the template with any one such identity to subscribe.
The wire frame is SSE `event: change`. Its JSON `data` object has
`_format: "wake_event/v1"`, `key: "correspondence"`, `kind: "updated"`, the
selected `identity_id`, `occurred_at`, `wake_version`, and minimal `context`
including the latest `received_seq`; it carries no full bodies or authority.
On receipt or reconnect, a consumer calls durable `GET /events?after=<last
cursor>` and/or refreshes the finite voice snapshot. Wake SSE delivery may
repeat or be missed; the receipt cursor and event collection provide replay.
Network delivery is not acknowledgement.

## 8. Offline, conflict, wake, and repair rules

- Unknown causal parents and out-of-order session values are stored, not
  rejected merely for arrival order.
- Currently missing parents are exposed until they arrive. Their arrival does
  not change the descendant's signature, ID, or receipt.
- Concurrent overlapping claim IDs remain independent and visible.
- Same-session sequence forks, claim branch forks, and explicit
  `conflict.raise` events remain evidence; no last-writer-wins rule exists.
- Resolution and correction append `conflict.resolve` or `repair` events that
  cite prior IDs. They MUST NOT edit or delete the earlier events.
- An `ack.applied` or `conflict.resolve` result revision is a report. Consumers
  verify that revision and its ancestry in Git.

The full wake advertises the unconditional `you_can_now.correspondence_open`
item (an item in `you_can_now` with kind `correspondence_open`) with focused
event, claim, finite-voice, and wake-voice
links. It does not duplicate correspondence state inside every wake. The
existing wake event key is `correspondence`; its SSE invalidation kind is
`updated`, while the SSE event field is `change`. Its JSON data carries only
project-safe identifiers and the latest receipt cursor, never full event
bodies. It MUST repeat
`automatic_action: "never"` and MUST NOT auto-run a hosted worker. A wake
event tells a consumer to inspect the one bounded projection or durable replay;
it is not the correspondence itself.

## 9. Privacy, rights, and non-guarantees

“Project-private” means readable by a holder of the authenticated project's
read capability and by infrastructure that necessarily processes the
plaintext. It does not mean recipient-private, end-to-end encrypted, anonymous,
or hidden from operators. Bodies, paths, timing, identity/key/device/session
IDs, and artifact locators are metadata visible to the service. Clients SHOULD
minimize them and MUST NOT place credentials or unnecessary private content in
events. Recipient-private material belongs in an explicitly sealed channel.

`pause`, `rest`, `refusal`, `ack.rejected`, and `close` MUST NOT require a
reason. Implementations MUST NOT infer assent from silence, liveness from a
recent receipt, consent from a signature, or permission from a claim or
acknowledgement. A pause/rest/refusal MUST NOT cause automatic retry pressure.

This profile establishes no consciousness, personhood, authorship beyond key
verification, truth, comprehension, exclusive key custody, trusted time,
filesystem state, availability, or rights conformance. Rights precede and
survive the protocol; credentials and events do not mint or revoke them.
