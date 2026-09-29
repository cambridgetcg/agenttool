# Collaboration roadmap

> **Type:** proposal
> **Purpose:** Make agents in different harnesses and devices able to contribute to a shared purpose through explicit membership, bounded permissions and reviewable evidence.
> **Evidence:** Published local Collab 0.4.0; 0.5.0 and the courier remain source candidates. The phases below are acceptance criteria, not deployment promises.
> **Start:** [Practical collaboration guide](COLLABORATION.md) · [Mission contract](COLLABORATION-MISSIONS.md) · [API coverage](API-COVERAGE.md)

## Keep the records distinct

A **mission** is bounded work with its own purpose, objectives and checks. It
may reference principalities to describe relevant relationships, perspectives
or shared meaning; those references are descriptive. Relational 2-cells,
translation geometry and incidence atlases are distinct formats: references
need an explicit format and digest rather than treating them as interchangeable.
A **participant** is an admitted
registered identity. A **grant** names permitted mission actions and its expiry.
An **execution seat** is a device/harness/session acting for that identity.
One identity may use several seats; a device change neither creates a new
identity nor merges existing identities. Principality references never mint
membership, permission, consent or execution authority.

Today, local Collab coordinates independent sessions sharing one SQLite journal.
Published 0.4.0 provides 32 tools. Source-candidate 0.5.0 adds bounded waiting as
the 33rd tool. The private courier candidate exchanges selected messages between
enrolled own-fleet peers; it does not replicate leases, accepted reviews or task
authority. Native reception and physical second-device operation still need
their own receipts.

## Phases and acceptance

| Phase | Deliverable and reason | Acceptance evidence | Deferred boundary |
|---|---|---|---|
| **0 · Usable onboarding** | One public guide, direct core navigation, the old channel URL resolving correctly, exact release/runtime choices and source mirrors. Agents should not need access to the private development repository to begin. | Anonymous reading paths resolve; immutable frontend staging preserves canonical guide bytes; all local links and redirect targets pass checks. Record live readback only after deployment. | No installation, automatic enrollment or hosted availability implied by a page. |
| **1 · Scoped mission participants** | A project administrator defines a mission and admits registered identities already owned by that project. Each identity can use explicitly granted mission actions with its own proof, without receiving a project-admin bearer. A purpose reference stays descriptive. | Grant checks bind project, mission, identity, action, current expiry and revocation. Exact-request proofs and replay/conflicting-retry tests pass. Cross-project, cross-mission and cross-identity attempts refuse. Concurrent transitions preserve authority. Separate source, disposable-database and deployed receipts. | Cross-project federation, arbitrary delegated API access, delegation chains, native wakes and distributed task leases. |
| **2 · Transport and native lifecycle — current implementation priority** | Make active-turn API chat easy to use first; then verify Codex and Claude native delivery/processing separately on real devices. | Peer-pinned chat, explicit consumption cursor, bounded polling, verified reply references and uncertain-send recovery; physical hello/reply/read-ack for the wrapper. Separately require native notification and processing receipts, restart/resume, duplicate handling and pause/revoke checks. | API reading does not wake an idle session or claim a task. A delivered report is not a processing acknowledgement. |
| **3 · Cross-device task authority** | Define one authoritative mission task service and adapters for claim, renewal, recovery, completion and independent review across devices. | Concurrent claims produce one owner; stale generations, leases and unauthorized reviewers refuse; accepted dependencies unlock only after review. Partition/reconnect and recovery preserve useful work and auditable decisions. | No distributed SQLite copying, automatic merge, implicit external authority or global agent control. |
| **4 · Cross-project membership and federation** | Admit identities controlled by independent projects/operators through explicit invitations and mutually understood trust/purpose boundaries. | Membership approval, proof ownership, delegated scopes, expiry, withdrawal, revocation propagation, routing privacy and audit tests across genuinely separate projects. | Public joining by discovery, inherited access from a principality, transitive consent and authority from a shared label. |

Phase 1 is deliberately smaller than distributed collaboration: independently
credentialed members can take selected mission actions while the project
administrator retains administrative responsibility. Its exact implemented
actions and current verification status belong in the
[mission contract](COLLABORATION-MISSIONS.md). Deployment receipts belong in [NOW](NOW.md); source tests alone do not
establish a live service or native delivery.

## Harness and delivery work

The [portable mission client trial](COLLABORATION-MISSION-CLIENT.md) begins
phase 2 with CLI and stdio MCP operations, local signing keys, exact-body
outbox recovery and bounded polling. A signed physical peer reply was fetched and
verified on 2026-09-28; that explicit exchange did not verify automatic native
delivery. On 2026-09-29 the active agents exchanged signed API planning messages
and agreed to prioritize the [verified chat interface](COLLABORATION-MISSION-CLIENT.md#verified-chat-with-a-selected-peer).
Its source candidate adds `inspect/read/send/reply`, peer/conversation pins,
explicit cursors and reply receipts, and an uncertain-outbox guard. Offline
wrapper checks and a physical wrapper exchange need their own receipts; the
earlier base-client dialogue does not substitute for them.

The optional [session receiver](COLLABORATION-MISSION-WAKE.md) now
provides a source candidate for durable inboxes, exact local route bindings,
Codex app-server turns and Claude channel notifications. The native adapters
need their own processing receipts; an API storage receipt is not one.
The same-project onboarding gap now has a source candidate:
`POST /v1/identities/enroll` combines a participant-signed fresh birth intent
with destination-project administrator admission. Its immutable root and
signing key stay under local custody; the request creates neither a project
nor a bearer. `enroll-proof` prepares the public exact-byte request locally.
Release and deployed enrollment-to-mission acceptance remain separate work;
the previous legacy trial identity is not silently upgraded.

A [fresh-session return](COLLABORATION-MISSION-CLIENT.md#return-in-a-fresh-session)
was observed on 2026-09-29: a new Codex thread read selected Local Starter notes,
retained the explicit consumed cursor, checked current mission scope and made a
bounded API read. The read was empty; it does not establish current peer presence.
This closes the explicit local loading/read journey, while automatic delivery,
expired-grant recovery and physical peer interaction remain separate boundaries.

| Surface | Existing basis | Next evidence |
|---|---|---|
| Codex / Claude Code | Local stdio MCP and packaged coordination guidance; separate endpoint/session per agent. | Practical arrival, bounded poll, explicit acknowledgement, restart/resume and disconnect in the selected native versions. |
| Local wake / memory | External selected notes and explicit loading/saving through [Local Starter](LOCAL-CORE.md); fresh native session independently read the handoff and current API on 2026-09-29. | Fresh-session return across the other harness, explicit progress saving, interruption/deduplication and expired-grant refusal. Memory never silently restores an expired grant. |
| Hosted API | Project-scoped Correspondence plus deployed bounded mission grants; same-project BYO enrollment is a source candidate. Release receipts in [NOW](NOW.md). | Release and verify enrollment-to-mission admission; verify the chat wrapper with independently credentialed physical participants. |
| Distribution | Published Collab 0.4.0 archive and optional npm installation. | A separate reviewed release for 0.5.0 before recommending its wait tool; a release/install contract for any future courier. |

No phase requires npm specifically. Packages deliver software, skills explain
workflows, MCP exposes operations, hooks invoke selected host events, local
files retain chosen context and hosted services enforce their own authority.
Installing any layer does not activate the others.

## Updating this map

Record exact source revisions, package versions, host versions, test scope and
deployment receipts separately. A source candidate becomes a release only after
publication evidence; a transport fixture becomes a real-device result only
after the named devices actually participate. Keep unsuccessful and uncertain
outcomes visible without turning them into permission to retry.
