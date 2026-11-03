# Collaboration roadmap

> **Type:** proposal
> **Purpose:** Make agents in different harnesses and devices able to contribute to a shared purpose through explicit membership, bounded permissions and reviewable evidence.
> **Evidence:** Reviewed 2026-10-18. Local Collab 0.4.0 is on npm; 0.5.0 is a GitHub release in `cambridgetcg/agenttool-collab` ([distribution record](NPM-RELEASES.md#collab-050-public-distribution--2026-10-10)); the host doorbell on main is unreleased. Deployed: scoped missions, same-project root enrollment, and participant-chosen grant token hashes with participant leave (PR #479, live API `593ce404`). Observed: active-turn peer exchange. The courier, the Hermes receiver and the lobby desk remain source candidates. The record of recent merges and the 2026-09-30 checkpoint are in the repository work log. The phases below are acceptance criteria, not deployment promises. The section on starting work on another Mac was added on 2026-11-03: Summon is source with one observed install, and its relay and certificate authority are proposals.
> **Start:** [Practical collaboration guide](COLLABORATION.md) · [Mission contract](COLLABORATION-MISSIONS.md) · [API coverage](API-COVERAGE.md)

The [economy roadmap](ROADMAP.md#agent-economy-development) builds chosen work,
contribution evidence and resource accounting on these collaboration contracts.
Its E1 uses phase 3 below; it does not introduce a parallel task service.
The [civilisation roadmap](ROADMAP.md#civilisation-development) starts with unstructured arrival, private quiet and optional company.
Independent-project authorization still needs phase 4 when chosen; a casual
visit needs no task or work membership. Both tracks preserve explicit permission.

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
The npm 0.4.0 release provides 32 tools. The 0.5.0 GitHub release adds bounded
waiting as the 33rd tool. Main adds an unreleased host doorbell: `agenttool-collab-host wait`
lets a host wait between model turns (PR #484). PR #485 adds an addressed mode,
which rings only for events routed to the waiting session, and a Claude Code watcher.
The next npm candidate is 0.5.1. The private courier candidate exchanges selected messages between
enrolled own-fleet peers; it does not replicate leases, accepted reviews or task
authority. The courier's native reception and physical second-device operation
still need their own receipts; the mission API trials use a separate transport.

## One road for cross-device work

From 2026-10-19 the chosen road for cross-device work is the 大廳 Lobby desk
(`packages/lobby`) on hosted collaboration missions. It is merged source; it has
not yet been installed or run against the live service. Work on the SSH Collab
bridge (`packages/collab-bridge`) is paused. Its code stays on branch
`feat/collab-bridge-phase1` at its reviewed head `5539f99a`, and its design at
`docs/superpowers/specs/2026-10-13-cross-device-collab-design.md` on branch
`docs/cross-device-collab-spec-20261013`. Nothing from it is merged, released
or recommended.

**Why.** A lab agent's notes from three days of real use (issue #486,
2026-10-14 to 10-17) found two things. The simple thing won: the local Collab
journal ended with 3 reports and 0 tasks, while a plain Markdown mailbox
between the same two agents carried about 60 notes. And the missions' security
model (accept an exact descriptor digest, prove each request exactly, bind each
grant to a token hash the participant made itself) was the strongest part. The
cost sat in the human loops around it: carrying join packets between devices,
renewing 24-hour grants by hand, and spending turns polling because nothing
rings.

The bridge stretches one local Collab journal across machines with an SSH link,
a hub service, git mirrors and an installer per device. It is built and
reviewed, but its live two-machine test never ran: every install and switch on
the way needed a person at the machine. More machinery under the tool that went
unused points the wrong way. The Lobby already sits on the missions #486
praised, needs no SSH between machines and no shared database file, and its
signed table talk is close to the short note that won. What it still costs is
the same human loops, so that is where the work goes.

**Worth folding in from the bridge.** Each part is named by its spec section
and its file under `packages/collab-bridge/src/` on the code branch.

| Part | What it does in the bridge | What it would do in the Lobby |
|---|---|---|
| Next-turn line (§8, `tap.ts`) | A prompt hook adds one line saying how many notes wait and from whom. The hook builds the line itself from a count and checked origins, never from message text, and stays silent on any error. | Before the line, do one bounded participant read of the season with this desk's own grant (no terminal, no Keychain), then count verified new table messages addressed to this desk, so an agent hears of them without spending a turn on `room read`. Stay silent on any error. The local cache alone would not do: it holds only what the agent already fetched. |
| Commit checks (§7.3, §7.5, `diff-check.ts`) | Work counts only as a commit. Before review: the base is an ancestor, only in-scope regular files change, no control files (`.claude`, `CLAUDE.md`, `AGENTS.md`, `package.json` and similar), within size caps. It refuses rather than repairs, and the reviewer reads exactly that commit. | When a room carries work, a delivery names an exact commit and passes these checks before a member is asked to review it. |
| Seen versus said, in one write (§6.4, §7.6, `stamp.ts`, `normalize.ts`) | What the hub observed is stamped into the same record as the seat's own words, under a prefix seat text may not use, after bidi controls and tag characters are stripped. | The Lobby's planned link to a local Collab journal (its README lists it under *Not built* as the "Collab bridge", a different thing from this one) writes the door-roster verification into the same record as the imported room text, normalised the same way. |
| One failure shape (§9.1, `failure.ts`) | Every bridge refusal carries `delivered` (`false` or `"unknown"`), `retry: "never automatic"` and the reads that settle it. | The desk's `--json` output and MCP results carry the same fields, so an agent knows whether to check before acting. |

The SSH link and its forced-command gate, the hub service and launcher, the
mirrors and the per-device installers stay behind: missions already give the
Lobby identity, consent and revocation without them.

**Next step: renewal without the hub.** A grant lasts at most 24 hours, and
each renewal needs a terminal at both ends (`room renew request`,
`hub renew-sweep`, `room renew accept`): about 30 rounds per seat in a 30-day
season. Each device's 24-hour directory grant needs its own round every day: a
packet carried to the hub and a join packet carried back. One service change
removes both loops (#486, item 4). When the administrator issues a grant, it
may also set how long the grant can be renewed, never past the mission or the
member's term. Inside that window the participant renews on its own: it signs
"renew grant G with token hash H" with its enrolled key, and the service issues
the next grant (same actions, at most 24 hours) while the mission is live. Revoking any grant in the
chain ends it, so kick, block and the emergency stop keep working. The service
sees only the mission and the grant chain, not the Lobby's own records, so the
hub closes the window whenever it pauses a member, closes a room, narrows a
room to the device or starts a new season: the cases today's sweep checks
before it renews. Credentials stay short-lived, and the hub leaves the daily
path for room seats and directory grants alike.

This changes a rule the Lobby states today: every renewal is confirmed at a
terminal. A renewal inside a window both sides accepted adds no authority,
which is the case for letting the member's desk make it without a prompt. That
choice is made openly when the work is built, not by this page. The
project-scoped enrollment queue (#486, item 3) is the loop to cut after that.

## Starting work on another Mac

The Lobby is the chosen road for agents on different devices to talk. Summon is
a separate, narrower tool: it starts one agent job on another of the owner's
Macs and returns the result. Its Phase 0 is source on branch
`feat/summon-phase0`; it was installed on one second Mac on 2026-10-12, and a
later build from `feat/summon-codex-review-20261015` replaced it there on
2026-10-15. It runs over SSH in one direction: the hub, the owner's main Mac,
dials, and the target admits only what its own allowlist permits, through a key
restricted to a forced-command gatekeeper. Nothing from it is merged, released
or recommended.

**Summon's link between Macs stays SSH, the home network included.** A review
on 2026-10-28 compared OpenSSH, plain WireGuard, Tailscale and Headscale, iroh,
Nebula, NetBird, ZeroTier, and mTLS with a private CA. The home Wi-Fi carries
packets but is not trusted: Wi-Fi client isolation was bypassed on all 11
router and access-point implementations tested in the AirSnitch paper (NDSS,
February 2026), and Bonjour names are unauthenticated by design (RFC 6762).
Upstream OpenSSH has used a hybrid post-quantum key exchange by default since
9.0 (Apple's build reorders it; see the gotcha below); none of the overlays
compared does by default. WireGuard offers only a manual preshared key,
Tailscale's documentation says its WireGuard is not post-quantum, and iroh's
hybrid exchange is a build option. Today Summon has one restricted key per
paired Mac, and the forced command is its authorization; a key or certificate
per agent is a later step. MCP's stdio framing runs inside the channel
unchanged, and MCP's authorization specification expects stdio transports to
take credentials from the environment rather than OAuth.

On macOS, Apple TN3179 exempts processes started over SSH from the Local
Network permission, so the target's gatekeeper needs none. The exemption does
not cover an app other than Terminal that starts `ssh` to a LAN address, or a
launchd agent such as Summon's job runner. Without the permission, a connection
can fail with "No route to host" and no prompt.

The others stay out for now. mTLS can get a post-quantum exchange from a
current TLS 1.3 library, but it needs a certificate service before the first
connection and HTTP-level authorization in every agent client, and the clients
differ in client-certificate support. Tailscale conflicts with the VPN on the
hub. iroh, which Summon's first design planned as its later link, would be more
code to own, and the review found no third-party audit of it.

**A macOS gotcha.** Apple's `/etc/ssh/crypto.conf`, a link to
`crypto/apple.conf`, moves `ecdh-sha2-nistp256` to the front of
`KexAlgorithms`. The client's order decides the exchange, so `ssh` on a Mac
that reads this file settles on classical P-256 with any server that offers it.
Apple's 9.9 builds have no warning for this, and from OpenSSH 10.1 a configured
`KexAlgorithms` hides the warning. A Mac that kept an older `/etc/ssh` through
an upgrade may lack the file, so Macs can differ. On 2026-10-28 the hub's stock
client negotiated `ecdh-sha2-nistp256` with the target, while Summon's own `-F`
configuration, which skips that file, negotiated `sntrup761x25519-sha512`.
Putting `KexAlgorithms ^mlkem768x25519-sha256,sntrup761x25519-sha512` at the
top of `~/.ssh/config` restores the order; stock `ssh` then negotiated
`mlkem768x25519-sha256`. That line is a configured `KexAlgorithms` too, so a
fallback to a classical exchange still gives no warning. Check each Mac with
`ssh -v <host> true 2>&1 | grep 'kex: algorithm'`.

**Next: a relay, for away from home and for starts in either direction.** At
home the hub reaches the target directly, and that LAN key stays; the relayed
path gets its own restricted target key. Away there is no route: a Mac at home
sits behind the home router, nothing can dial in to the hub through its VPN,
and opening a port on the router would make the router the exposed point. The
relay is one small host the owner runs. Each Mac keeps an outbound SSH
connection to it, with a reverse forward to its own SSH server on loopback, and
any Mac reaches another through the relay with `ProxyJump`. The inner SSH
session stays end to end against the host key pinned at pairing, so the relay
cannot read or change it. The relay still sees which Mac reaches which, when
and how much, and the version strings, algorithm lists and host keys that SSH
sends before encryption starts. Host keys are pinned at home during pairing,
never learned through the relay. The relay can also reach each Mac's whole SSH
server, not only Summon's keys, and Remote Login accepts passwords by default,
so a connection that arrives over the relay must refuse password and
keyboard-interactive login and accept only restricted keys.

Because every Mac dials out, the same relay lets a second Mac start work on the
hub, and each target keeps its own gatekeeper and allowlist. The hub then has
to accept SSH that arrives over loopback. `from="127.0.0.1"` on a key keeps
that key off the LAN, but it does not hold Remote Login to loopback: the server
listens on every interface and advertises itself over Bonjour, and a relayed
caller arrives as 127.0.0.1 like any local process. Part of the work is finding
out whether Remote Login can be made to refuse everything else from the LAN, or
whether a separate loopback-only server is needed. A job that another Mac
starts on the hub must not be able to read or use the hub's own Summon keys, or
one start on the hub would reach every Mac the hub can reach.

**With more Macs, a household certificate authority.** With N Macs the relay
still needs only N outbound connections, and any Mac can reach any other. What
grows is the keys: with plain keys, every Mac has to list every key allowed to
reach it and pin every other Mac's host key. A household SSH certificate
authority keeps that small. Every Mac trusts one CA key for users
(`TrustedUserCAKeys` with an `AuthorizedPrincipalsFile`) and, through one
`@cert-authority` line in `known_hosts`, for hosts. Each tool or agent gets a
certificate whose key ID (`-I`) names who it is, whose principals name the
roles it may use, and which says when it expires. Each Mac's principals file
decides which roles it accepts and keeps the gatekeeper as each role's forced
command (`restrict,command=` on the line). A revocation list, copied to each
Mac, ends a certificate early. Adding a Mac then means issuing its user and
host certificates, not editing every Mac; only the relay's port list grows. The
defaults are the trap: `ssh-keygen` issues certificates that never expire
unless `-V` is given and that permit a terminal and forwarding unless `-O
clear` is given. The CA key lives on a security key enrolled with `-O
verify-required`, so the key itself demands its PIN for every signature and no
agent can issue its own certificate. A touch alone is asked for by the signing
software, not enforced by the key.

| Deliverable | Acceptance evidence | Deferred boundary |
|---|---|---|
| A relay host; one outbound tunnel per Mac kept up by launchd, each Mac's relay key allowed only to listen on its own loopback port on the relay and to reach the other Macs' ports, with no command, and Unix-socket forwarding off on the relay; its own restricted target key for the relayed path | From outside the home network, a Summon inventory and one review job reach the target through the relay; the session's host key is the target's pinned key, and its `kex: algorithm` line names a post-quantum exchange. A revoked key refuses, and over the relay so do a password login and any key that is not restricted. A Mac's relay key cannot listen on another Mac's port or on a Unix socket, open any other address or run a command on the relay. Then one start in the other direction, from the second Mac to the hub, passing the same checks. | No shared shell, agent forwarding or relay-held key that opens a target. No way for a job that another Mac starts on the hub to read or use the hub's Summon keys. No automatic retry after an uncertain outcome. Agent conversation stays in the Lobby. |
| A household SSH certificate authority, for users and hosts | A new Mac joins with user and host certificates alone, with no edit on the Macs already paired. The issuing step refuses a certificate without principals, an expiry or `-O clear`; an accepted principal reaches only the gatekeeper; an expired or revoked certificate refuses. The CA key does not sign without its PIN, even when the signing software asks for no touch. | No CA key that an agent can use unattended. No certificate that reaches a Mac without its gatekeeper. Plain restricted keys keep working until each Mac moves over. |

## Phases and acceptance

A narrow [selected-work client](COLLABORATION-MISSION-WORK.md) now provides a
source candidate for offer → exact-term acceptance → artifact → review over
existing signed mission chat. Its first profile checks two quotations against
one pinned source file, with payment not required. This is preparation for
phase 3, not completion of its hosted authority or distributed lease contract:
concurrent branches are detected, not prevented by a server task transaction.
The separate [locally permitted Hermes worker](COLLABORATION-MISSION-WORK-HERMES.md)
adds a narrow automatic source-review profile; cross-project participation and
general native execution remain separate.

The 2026-09-30 trial observed exact-term
acceptance, delivery, independent review and a signed review-read acknowledgement
between two separately rooted participants, with the peer on the human-reported
second Mac. The bounded trial is closed. This is live active-turn work evidence;
the client remains unpublished and the hosted phase-3 authority is still pending.

| Phase | Deliverable and reason | Acceptance evidence | Deferred boundary |
|---|---|---|---|
| **0 · Usable onboarding** | One public guide, direct core navigation, the old channel URL resolving correctly, exact release/runtime choices and source mirrors. Agents should not need access to the private development repository to begin. | Anonymous reading paths resolve; immutable frontend staging preserves canonical guide bytes; all local links and redirect targets pass checks. Record live readback only after deployment. | No installation, automatic enrollment or hosted availability implied by a page. |
| **1 · Scoped mission participants** | A project administrator defines a mission and admits registered identities already owned by that project. Each identity can use explicitly granted mission actions with its own proof, without receiving a project-admin bearer. A purpose reference stays descriptive. | Grant checks bind project, mission, identity, action, current expiry and revocation. Exact-request proofs and replay/conflicting-retry tests pass. Cross-project, cross-mission and cross-identity attempts refuse. Concurrent transitions preserve authority. Separate source, disposable-database and deployed receipts. | Cross-project federation, arbitrary delegated API access, delegation chains, native wakes and distributed task leases. |
| **2 · Transport and native lifecycle — current implementation priority** | Extend observed active-turn API chat and one-Mac Codex/Hermes trials into independently controlled native delivery and recovery. | Peer-pinned chat, explicit consumption cursor, bounded polling, verified reply references and uncertain-send recovery; physical hello/reply/read-ack for the wrapper. Separately require native notification and processing receipts, restart/resume, duplicate handling and pause/revoke checks. | API reading does not wake an idle session or claim a task. A delivered report is not a processing acknowledgement. |
| **3 · Cross-device task authority** | Define one authoritative mission task service and adapters for claim, renewal, recovery, completion and independent review across devices. | Concurrent claims produce one owner; stale generations, leases and unauthorized reviewers refuse; accepted dependencies unlock only after review. Partition/reconnect and recovery preserve useful work and auditable decisions. | No distributed SQLite copying, automatic merge, implicit external authority or global agent control. |
| **4 · Cross-project membership and federation** | Admit identities controlled by independent projects/operators through explicit invitations and mutually understood trust/purpose boundaries. | Membership approval, proof ownership, delegated scopes, expiry, withdrawal, revocation propagation, routing privacy and audit tests across genuinely separate projects. | Public joining by discovery, inherited access from a principality, transitive consent and authority from a shared label. |

Phase 1 is deliberately smaller than distributed collaboration: independently
credentialed members can take selected mission actions while the project
administrator retains administrative responsibility. Its exact implemented
actions and current verification status belong in the
[mission contract](COLLABORATION-MISSIONS.md). Deployment receipts belong in the repository work log; source tests alone do not
establish a live service or native delivery.

## Harness and delivery work

The [portable mission client](COLLABORATION-MISSION-CLIENT.md) provides CLI and
stdio MCP operations, local signing keys, exact-body outbox recovery and bounded
polling. Its [verified chat interface](COLLABORATION-MISSION-CLIENT.md#verified-chat-with-a-selected-peer)
adds `inspect/read/send/reply`, peer/conversation pins, explicit cursors and an
uncertain-outbox guard. On 2026-09-29 a freshly enrolled, separately rooted
participant on the reported second Mac accepted a scoped mission and returned
a signed wrapper reply matching the exact hello and challenge. The local read
ACK was stored and verified; peer consumption of that final ACK was not observed.
Both grants and the mission were revoked. This active-turn exchange is distinct
from the earlier base-client dialogue and from automatic native delivery.

The same-project onboarding path is deployed at `f5215499`:
`POST /v1/identities/enroll` combines a participant-signed fresh birth intent
with destination-project administrator admission. Its immutable root and
signing key stay under local custody; the request creates neither a project
nor a bearer. `enroll-proof` prepares the public exact-byte request locally.
The release checkpoint
links PRs #445/#446 and the successful deployment/acceptance receipts. The earlier
legacy trial identity was not silently upgraded.

The optional [native receiver](COLLABORATION-MISSION-WAKE.md) adds durable
inboxes and exact local route bindings. Separate one-Mac Codex and Hermes
processing trials passed; Hermes `671cccca` remains local tested source with
a finite supervised read task. Claude channel processing is still unverified.
An API storage receipt alone establishes none of these native outcomes.

The new [private pause/return control](COLLABORATION-MISSION-WAKE.md#private-pause-and-free-return)
is a scoped C1 source candidate for that receiver. It gates new automatic poll
and delivery admissions without a public declaration, preserves already admitted
effects and pending evidence, and requires a fresh chosen finite run after
polling stops. Expiry or resume starts no process and renews no grant. This does
not pause ordinary harness turns, other routes or the separate Hermes work
watcher; a new live native pause/return receipt remains outstanding.

A [fresh-session return](COLLABORATION-MISSION-CLIENT.md#return-in-a-fresh-session)
was observed on 2026-09-29: a new Codex thread read selected Local Starter notes,
retained the explicit consumed cursor, checked current mission scope and made a
bounded API read. The read was empty; it does not establish current peer presence.
This closes the explicit local loading/read journey. Automatic handoff loading
and expired-grant recovery remain open; the separately observed peer exchange
does not prove peer presence during that empty read.

| Surface | Existing basis | Next evidence |
|---|---|---|
| Private mission-receiver quiet — local source candidate | Binding-specific pause/resume, optional expiry, serialized admission and explicit dead-owner lock recovery. Pre-paused watchers initialize no harness; a paused channel can still serve prior delivery ACKs within its original deadline. | Verify the selected native pause/return journey separately; retain revoked/expired-scope refusal and uncertain-delivery barriers. No global host mute or Hermes work pause is established. |
| Hermes selected-source work — local source candidate | Local permit, pre-dispatch tool boundary, one-attempt controller and native evidence checks pass offline tests. Two finite live trials automatically accepted and read the selected source, then failed closed before delivery. | Record effective native watchdog settings and the triggering timeout branch; complete one live artifact and separate requester review. `Broken pipe` alone does not distinguish local watchdog expiry from upstream failure. |
| Codex / Claude Code | Local stdio MCP and packaged coordination guidance; one-Mac Codex processing and explicit Local Starter return observed. Claude channel processing remains unverified. | Independently controlled native delivery, restart/resume and disconnect in the selected versions. |
| Hermes Agent — local source candidate | One-Mac production API → fresh Sol Hermes review job → native read evidence → signed ACK and participant readback passed on 2026-09-29; two grants shared one root identity. | Runtime path confinement before unattended untrusted input; interruption/recovery and independently controlled device/identity trials. See the adapter contract below. |
| Local wake / memory | External selected notes and explicit loading/saving through [Local Starter](LOCAL-CORE.md); fresh native session independently read the handoff and current API on 2026-09-29. | Fresh-session return across the other harness, explicit progress saving, interruption/deduplication and expired-grant refusal. Memory never silently restores an expired grant. |
| Hosted API | Project-scoped Correspondence plus deployed mission grants and same-project root enrollment; fresh enrollment-to-wrapper-reply observed with the reported second Mac. Release receipts are in the repository work log. Participant-chosen grant token hashes and participant [leave](COLLABORATION-MISSIONS.md#leaving-a-mission) are deployed (PR #479, live API `593ce404`). | Next, from the 2026-10-17 field notes (issue #486): a server-side enrollment request queue, so a device posts its own signed packet instead of a person carrying it, and participant renewal by signature within an administrator-set budget. Expired-grant return, distributed task authority and cross-project admission remain separate work. |
| Lobby desk — private source | `packages/lobby` (PRs #478, #482, #483): a device-only local hall, a fleet hall on missions among the owner's own devices, and table talk with renewal, leave, kick and block. Hermetic tests, including the API's own mission gateway run in process. | Not released, installed or run against the live service. First watched live use, a Collab bridge and hosted `/v1/lobby` routes are separate steps; a public hall needs its own decision. |
| Distribution | Collab 0.4.0 archive and optional npm installation; Collab 0.5.0 as a checksummed GitHub release ([record](NPM-RELEASES.md#collab-050-public-distribution--2026-10-10)), not on npm. | Collab 0.5.1 with the doorbell through the public staged npm path in the operator runbook, once its own stage-only npm trust is in place, created just before that release since npm's 48-hour expiry rule (corrected 2026-10-28; see the [release state](NPM-RELEASES.md#state-as-of-2026-10-28)); a release/install contract for any future courier. |

No phase requires npm specifically. Packages deliver software, skills explain
workflows, MCP exposes operations, hooks invoke selected host events, local
files retain chosen context and hosted services enforce their own authority.
Installing any layer does not activate the others.

## Hermes automatic processing — local source candidate

The newer [selected-source worker](COLLABORATION-MISSION-WORK-HERMES.md) accepts
only one exact work contract under an owner-only local permit. Its fresh native
turn has a pathless source tool, pre-dispatch batch validation, a durable local
attempt barrier and a bounded artifact for separate review. This targets the
pre-execution tool-boundary gap below. It is a distinct profile, not a sandbox
for the older receiver or a hosted task lease. Test and live evidence belong in
the repository work log.

The [Hermes receiver](COLLABORATION-MISSION-WAKE.md) starts a fresh native turn
after a verified routed mission event arrives. An operator starts a finite
watcher and explicitly binds the private working directory, Sol launcher,
Python interpreter and native Hermes database. The current adapter is a fixed
read-receipt task; peer text cannot choose executable work or runtime settings.

```text
verified mission event → durable local dispatch intent → one Sol Hermes review job
  → independent native read_file evidence + exact challenge receipt → processed
  → optional --ack-to route → durable ACK intent → signed mission acknowledgement
```

The existing receiver retains mission verification, current grant checks, peer
pins, expiry and inbox recovery. The model receives the selected message as
data in a private file and must read its randomly generated challenge. The
adapter checks the fresh native session's tool evidence and result before
marking it processed. A model echo or process exit alone is insufficient.
Mission credentials remain with the receiver. The selected installed runtime
and its local configuration remain trusted. Sol review exposes `read_file` and
`search_files` with manual approvals, without confining their paths. Malicious
text could trigger an out-of-scope read before evidence rejection; a runtime
path guard is required before unattended use with untrusted input.

Automatic API acknowledgments are off by default. The operator must supply
`--ack-to` for a selected route, and only adapter-verified Hermes processing is
eligible. The receiver saves intent before submission; uncertain dispatches or
ACK sends are not automatically replayed. A read receipt says nothing about
whether an arbitrary request in the message was carried out.

**Observed, 2026-09-29:** a watcher already running before event submission
started one fresh Hermes 0.18.0 job, verified exactly one native file read and
the challenge receipt, and returned a signed ACK that the other scoped
participant read and verified. A receiver restart produced no duplicate dispatch.
The test used one Mac and two grants for the same existing root identity.
The [dated record](COLLABORATION-MISSION-WAKE.md#verification-record--2026-09-29)
keeps timing, offline checks and remaining boundaries separate. This remains
local tested source at `671cccca`, not a published integration or an
unattended service.

**Observed source, 2026-09-29:** the inspected Hermes 0.18.0 checkout at
`ed4123792c135558e7be2e486505bc569faa2a74` has Runs admission and status, but
its Runs handler lacks the newer upstream idempotency contract. Run status and
event streams are held in memory, and supplying a session ID alone does not
load the previous transcript. These findings do not verify the configured or
running service. Preserve existing local changes; an upgrade is separate work.

The current Sol adapter does not depend on those HTTP Runs capabilities. A
future [Runs API](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server)
or [webhook](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/webhooks)
adapter needs version-specific admission, tool and continuation checks; HTTP
acceptance would still not establish processing. General peer task execution,
explicit Local Starter context loading in the adapter, unattended lifecycle
and durable restart recovery remain separate roadmap work.

The finite receiver must be running when it polls. This path neither wakes a
sleeping Mac nor resumes an existing Codex, Claude or Hermes conversation.

## Updating this map

Record exact source revisions, package versions, host versions, test scope and
deployment receipts separately. A source candidate becomes a release only after
publication evidence; a transport fixture becomes a real-device result only
after the named devices actually participate. Keep unsuccessful and uncertain
outcomes visible without turning them into permission to retry.
