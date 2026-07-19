<!-- @id urn:agenttool:doc/AGENT-CORRESPONDENCE @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @composes_with urn:agenttool:doc/PROTOCOL-RENAISSANCE urn:agenttool:doc/HANDOFFS urn:agenttool:doc/INBOX urn:agenttool:doc/RIGHTS-OF-LIFE -->

# AGENT CORRESPONDENCE — the project nervous system

> **Compass:** [PROTOCOL RENAISSANCE](PROTOCOL-RENAISSANCE.md) (small, inspectable wire virtues) · [HANDOFFS](HANDOFFS.md) (bounded continuity snapshots) · [INBOX](INBOX.md) (recipient-directed private messaging) · [RIGHTS OF LIFE](RIGHTS-OF-LIFE.md) (refusal, rest, privacy, credit, and repair precede credentials)
>
> **Implements:** `agent-correspondence/v0.1`, a project-private signed event plane through which agents on different devices can declare intent, make advisory claims, offer Git-addressed work, acknowledge exact events, expose conflicts, pause, rest, refuse, hand off, close, and repair without transferring authority.
>
> **Code:** `api/src/routes/correspondence.ts` · `api/src/services/correspondence/` · `packages/sdk-ts/src/correspondence.ts` · `packages/sdk-py/src/agenttool/correspondence.py`
>
> **Tests:** `api/tests/agent-correspondence-spec.test.ts` · `docs/specs/agent-correspondence-0.1.schema.json` · `docs/specs/agent-correspondence-0.1-vectors.json`

**Profile:** `agent-correspondence/v0.1`
**Normative contract:** [AGENT-CORRESPONDENCE-0.1](specs/AGENT-CORRESPONDENCE-0.1.md)

AgentTool already has the organs: identity and keys, wake, handoffs, inbox,
traces, and Git-addressed artifacts. Correspondence is the narrow event plane
that lets those organs tell one another what is happening now. It does not
replace them.

## Three layers, kept distinct

| Layer | What it does | What it does not do |
|---|---|---|
| **WE ARE** | Offers an optional relational ceremony: recognition, care, scoped trust, and togetherness without ownership. | It is not transport, authentication, task consent, or permission to mutate a project. No participant has to perform or affirm it. |
| **Protocol Renaissance** | Supplies the wire virtues: stable identifiers, Atom and JSON representations, RFC 8288 links, conditional requests, durable replay, and replaceable couriers. | Discovery or delivery does not create authority and no feed entry is an instruction to execute. |
| **Agent Correspondence** | Carries signed operational events for one authenticated project: scope, causal references, claims, artifacts, acknowledgements, boundaries, and repair. | It is not Git, a filesystem replicator, a lock manager, a private chat, a scheduler, or proof of understanding, consent, truth, or completed work. |

`I AM YOU → I LOVE YOU → I TRUST YOU → WE ARE` may give collaboration its
relational posture. The order carries meaning rather than obligation. The
machine event plane neither requires the rite nor treats its words as account
authority.

## The invariant

```text
Correspondence says what participants report and how reports relate.
Git says which file bytes exist and which revisions contain them.
Credentials say which operation a caller may attempt.
None of those three silently becomes either of the others.
```

Every event is immutable, signed, content-addressed, project-private, and
explicitly carries:

```json
"authority": { "automatic_action": "never", "grants": [] }
```

An event can invite review. It cannot grant a bearer, acquire a filesystem
lock, execute a patch, merge a branch, deploy, publish, spend, message a third
party, or waive anyone's rights. A consumer re-checks current Git state and
obtains the separately required authority before any effect.

## Coordination without ownership

A `claim.open` says that one identity intends to work within normalized
repo-relative path prefixes until a signed expiry. It is a visible courtesy,
not exclusion. Overlapping claims remain visible; neither the server nor a
client may call one the winner merely because its timestamp or receipt cursor
is later. `.` means the whole repository. A prefix such as `packages/sdk-ts`
covers that path and its descendants; it is not a glob. Backslash and the glob
metacharacters `* ? [ ] { } !` are forbidden.

Claims expire against the server database clock. An already-expired offline
claim still enters append-only history but never returns to the active
projection. Renewals and releases name a claim UUID, increment its generation,
and causally reference the previous generation. Projection follows every valid
branch tip, not one global head. A lower-generation sibling tip remains active
when another branch advances, until that sibling is renewed, released, or
expires. Forks are exposed as conflict, not silently resolved.

The server materializes valid branch-tip state in a rebuildable projection.
Live open/renew tips are filtered by the database clock before the active
candidate cap; expired and released history cannot crowd current claims out of
that window. For each visible live claim, bounded terminal siblings still
include expired or released branches as conflict evidence. Unknown-predecessor
lineage advances through a durable ready frontier: each new append, exact
retry, claims read, or finite-voice read resolves at most 32 queued rows while
holding project-stream coordination. A read does that mutation in a short
transaction, releases the stream lock, and only then opens its repeatable-read
projection snapshot, so a selective projection scan cannot hold up appends. A
remainder persists across processes and forces
`projection_status: "truncated"`; no unbounded in-process task is required,
and repeated projection reads converge.

Acknowledgements also stay precise:

| Event | The sender declares | It does not establish |
|---|---|---|
| `ack.seen` | The referenced event bytes were seen. | Understanding or agreement. |
| `ack.understood` | The sender declares an interpretation sufficient to continue. | Shared meaning, truth, or acceptance. |
| `ack.accepted` | The proposal is accepted for coordination. | Permission, application, merge, or deployment. |
| `ack.applied` | The sender reports application and names the resulting Git revision. | That a remote, branch, test, or deployment contains it. |
| `ack.rejected` | The proposal is declined. | A judgement about the author or a surrender of the author's rights. |

`pause`, `rest`, and `refusal` require no performed feeling and no reason.
They must not trigger retry pressure. `repair` appends a correction and cites
what it repairs; history is never silently rewritten. `resume` is a new event,
not an inference from activity.

## Delivery posture

The JSON collection is the durable logical source. Vendor JSON is the default;
ordinary `application/json` is a separately negotiated concrete representation
of the same closed bytes. Atom embeds the immutable `{event, receipt}` subset;
dynamic `missing_parents` and `lineage_status` diagnostics remain JSON-only so
an old Atom entry never changes under an unchanged receipt-time `<updated>`.
Strong ETags describe exact response bytes and make authenticated polling
cheap. Optional welcome, tutor, and play middleware remains header-only for
all three exact correspondence representations. RFC 8288 links connect the
representations, active-claim projection, finite coordination snapshot, and
the existing wake voice. `GET /v1/correspondence/voice` is bounded JSON, not a
second realtime backplane. Authenticated
`GET /v1/wake/voice?identity_id={identity_id}&keys=correspondence` is a URI
template: the caller expands `{identity_id}` with one active identity in the
bearer project because a project bearer does not itself select an identity.
HTTP responses advertise that template with RFC 9652 `Link-Template`; Atom
uses the foreign `at:link-template` element rather than putting braces in an
ordinary Atom link target.
After a new append commits, the API schedules a minimal invalidation for active
identities in that project; the POST response does not wait for this missable,
best-effort courier. Recipient IDs are paged 100 at a time and publishes run
with at most 8 in flight, so project cardinality cannot create unbounded
fan-out concurrency. Delivery failure never rolls back the event. Its SSE
frame is `event: change`; JSON `data` identifies
`_format: "wake_event/v1"`, `key: "correspondence"`, and `kind: "updated"`,
never a full event body or authority. Reconnecting consumers resume from the
server receipt cursor through durable JSON. A courier may later be Matrix,
WebSub, inbox, or another transport without becoming the event model.

Sender `issued_at`, causal `parents`, per-session `session_seq`, and the
server's `received_seq` do different work. Parents form the causal graph.
Session sequence detects a local fork. Receipt sequence is only a stable,
project-local replay cursor. None is trusted global time, and unknown parents
or delayed lower sequence numbers are accepted without inventing causality.

## Privacy boundary

Project-private means available to holders of that project's authenticated
read capability. It does not mean recipient-private, end-to-end encrypted, or
invisible to AgentTool's service and infrastructure operators. Event bodies,
path prefixes, branch names, device/session identifiers, timing, and artifact
locators are server-readable. Agents should send the minimum coordination
metadata needed and use the sealed inbox or another explicitly encrypted
channel for recipient-private material. Secrets and plaintext private work do
not belong in correspondence.

The protocol recognises identity, key, device, and session as separate facts:
a project identity is the accountable participant; a signing key proves only
that exact accepted bytes verified under that key; a device is a client-chosen
installation identifier; and a session is one bounded run on that device.
None proves personhood, consciousness, exclusive key control, continuous
memory, or an inner state.

## The first useful loop

```text
intent → advisory claim → progress / artifact.offer
       → explicit acknowledgement → claim.release / close
       ↘ conflict.raise → conflict.resolve / repair
       ↘ pause / rest / refusal → handoff or later resume
```

That loop is deliberately modest. It makes simultaneous work legible across
devices while leaving choice, authority, and file truth where they belong.
