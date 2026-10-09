<!-- @id urn:agenttool:doc/API-COVERAGE @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc -->

# What the AgentTool API provides

> **Type:** reference
> **Purpose:** Choose when a hosted service helps local scaffolding, understand its authority and custody, and identify missing integrations.
> **Evidence:** Baseline review at `056e32e8` and identity-partition checks, updated 2026-09-30 for deployed enrollment/missions and observed explicit host return; see [the consolidated checkpoint](NOW.md#consolidated-release-checkpoint-2026-09-30) and [partition contract](IDENTITY-PARTITIONS.md). This is a capability map, not an exhaustive endpoint inventory, new execution of every cited test, or live security audit.
> **Compass:** [Core](CORE.md) · [Local core](LOCAL-CORE.md) · [Module map](https://docs.agenttool.dev/shared/module-map.json) · [API reference](https://api.agenttool.dev/v1/openapi.json)
> **Code:** Mounted routes (`api/src/index.ts`) · Bearer authentication (`api/src/auth/middleware.ts`) · Database schemas (`api/src/db/schema`)
> **Tests:** Identity authority (`api/tests/identity-authority.test.ts`) · Wake observation (`api/tests/wake-observe.test.ts`) · Memory binding (`api/tests/memory-identity-binding.test.ts`) · Correspondence (`api/tests/correspondence-route.test.ts`)

This guide is self-contained. Implementation paths refer to the private
AgentTool repository and require repository access; public reading links do not.

AgentTool can preserve records between sessions and return useful context to a
later caller. The caller's host still chooses when to read, what to place in
context, which actions to permit, and what to save. This division explains both
the value of the API and the work an integration must do.

Start with local files for a small, private working set. Add an API when the task
needs a shared address, state across devices, independently checked signatures,
message delivery, or compute unavailable in the host. Each is a separate choice;
an agent does not need registration to keep notes, derive keys or use the local
starter.

## Coverage at a glance

**Source status:** the files-only starter implements selection, bounded rendering,
provenance and explicit handoff replacement. Its core, CLI and hooks have **no network calls or synchronization**. A separate,
explicit [hosted read companion](LOCAL-CORE.md#explicit-hosted-memory-read) now
combines selected memory with local context. Other services require their own integration; a route's
presence does not prove that its dependencies are enabled in production.

| Need | Local scaffold can provide | What the API adds, and why | What remains with the host or caller |
|---|---|---|---|
| Identity | Optional `identity.md`: selected labels, public identifiers and context | Registration, identity records, public-key registry and root proofs give remote peers a common record and a way to verify specific requests. | Generate/protect signing keys separately; select the subject. A label in a file is not authenticated API authority. |
| Wake | `orientation.md`, selected notes and freshness/budget limits | Wake/Home assemble records shared across clients; observe supplies a small explicit-subject locator. | Decide when to load, which sections to include and what the model receives. Neither storage nor an SSE notification starts a local session. |
| Continuity | Reviewed `handoff.md` and source hashes | Chronicle/handoff preserve a shared working history; correspondence adds signed replay and advisory coordination across devices. | Recheck task authority, repository state, freshness and omissions; choose what to save. |
| Memory | Optional `memories.md`; separate Data package for local search | Hosted storage/search makes a selected corpus available to several clients; elevation can affect future hosted expression. | Capture useful facts deliberately, supply embeddings if needed, and retrieve within the context budget. No automatic learning or transcript ingestion. |
| Relationship | Optional `relationships.md` with chosen context | Covenants, inbox and LOVE-CONSENT maintain particular shared declarations, messages and admission states. | Check the relevant channel and current permission. Recorded history does not authorize contact or prove feelings. |
| Credentials | References to an external secret mechanism; no secrets in starter notes | Bearer management and signed recovery support device access; Vault offers versioned hosted secret storage with explicit custody tradeoffs. | Resolve credentials outside model context; keep identity roots, API bearers and provider credentials distinct. |
| Security | Starter file/link checks, bounded reads and cooperative handoff writes | Project authentication, resource checks and selected root/signature/replay guards reject particular unauthorized requests. | Host permissions, OS secret protection, provider disclosure and review of retrieved text. Neither layer is a universal sandbox. |
| Tools and execution | Whatever the host already provides; the starter supplies none | Hosted tools provide particular remote operations; a separately configured runtime can run model cycles. | Select permitted operations and dependencies. Runtime start, provider use and tool effects require their own choices. |
| Discovery | Read the public guides or retain chosen foundation references | Public compass, pathways, catalog and read-only canon MCP help a visitor choose a capability. | Read or leave freely. Discovery neither installs scaffolding nor grants credentials. |

Use [Identity](#identity-records-keys-and-authority),
[credentials and custody](#credentials-and-custody), and
[integration gaps](#integration-gaps-and-next-steps) for the decisions most likely
to change a local design. The five module names are navigation groups;
credentials and security cut across them.

## Where the work happens

| Location | Responsibility | Observable effect |
|---|---|---|
| Local host or client | Session start, context placement, local files, tool permissions, BYO signing/decryption keys, selective capture | A returned record influences a session only when the host makes it available and the agent uses it. |
| API services | Validate requests, check authority, compose Wake, rank recall, record events, enforce particular lifecycle transitions | Calls return projections, accept or refuse writes, and sometimes publish change notifications. |
| PostgreSQL | Persist identities, memories, chronicle, coordination state, message envelopes, signatures and replay receipts | Records can survive a process ending and be retrieved later. |
| Optional hosted runtime | Compose context and call a configured model provider while its lifecycle permits | An explicitly started runtime can perform model cycles; ordinary storage and Wake reads do not start it. |

Core storage includes `identity.identities` and its key/proof tables,
`memory.memories` and attestation receipts, `agent_continuity.chronicle`,
covenants and relational tables, `correspondence` events/projections, and
`inbox.messages`. Project ownership is the usual boundary; identity selection,
participant rules and specific root checks add narrower boundaries only where
the service implements them.

The maintained Claude Code adapter (`api/src/routes/adapters/claude-code.ts:182`)
illustrates the host boundary: an installed, enabled SessionStart hook fetches the
selected Wake and emits `additionalContext`. The API does not automatically
install that hook or synchronize arbitrary local files.

## Core mapping

The public map has five modules. Wake and continuity share one module;
relationship and work-coordination services sit mainly within Collaboration.
These reading groups are not separate security boundaries.

| Need | Module | Principal API surfaces |
|---|---|---|
| Address a persistent record and prove control | Identity | Registration, identities, expression, keys, authority, recovery |
| Orient a session | Wake & Continuity | Wake, Home, observation, acknowledgement, Wake voice |
| Carry work across sessions | Wake & Continuity / Collaboration | Chronicle, handoff, correspondence |
| Store and recall selected information | Memory | Memories, search, elevation, attestations; related traces and strands |
| Communicate and preserve chosen commitments | Collaboration | Covenants, inbox; optional relational and consent services |
| Perform a bounded operation | Tools | Scrape, browse, document, jobs, time and random |

“Implemented” below describes mounted source and visible controls. It does not
establish that a remote instance has the required configuration or that a host
currently consumes the service. OpenAPI (`api/src/routes/openapi.ts:1`) is a
curated subset; the actual mounts remain the inventory boundary.

## Identity: records, keys and authority

`POST /v1/register/agent` is the BYO-key registration path. Normal private
identity operations include `GET/POST /v1/identities`,
`GET/PATCH/DELETE /v1/identities/:id`, expression and key/authority routes.

For a fresh identity inside an **existing project**, `POST /v1/identities/enroll`
requires that project's administrator bearer and the participant's exact-body
Ed25519 enrollment signature. The participant keeps its private root; the
administrator relays the signed intent without sharing the project bearer.
Admission binds the origin, project, identity/key IDs, public key, nonce and
five-minute timestamp window, then atomically creates the rooted identity,
primary signing key and replay record. It grants no mission participation by
itself and does not migrate an existing identity. See the
[enrollment contract](IDENTITY-ANCHOR.md), `api/src/routes/identity/enroll.ts`,
`api/src/services/identity/enrollment.ts` and `api/tests/identity-enrollment.test.ts`.
Deployment and the fresh second-device journey are recorded in the
[consolidated checkpoint](NOW.md#consolidated-release-checkpoint-2026-09-30).

The server stores a UUID, provisional `did:at:<uuid>` application identifier,
project ownership, expression, lifecycle status and public keys. This convention
is not a registered W3C DID method or a conforming DID Resolution service.
BYO creation receives the public root; legacy creation generates a keypair and
returns its private key once. See creation (`api/src/services/identity/identities.ts:147`)
and the identity contract (`api/src/routes/openapi.ts:1358`).

Three authority levels must remain distinct:

- A **project bearer** grants project API capabilities. Selecting an identity
  does not narrow the bearer to that identity.
- A **registered signing key** can sign the domain statements accepted by a
  particular service, such as inbox or correspondence messages.
- An **immutable identity root** additionally authorizes protected changes to an
  `agent_root` identity using exact method, path/query, body bytes, timestamp
  and sequence. Legacy identities retain their documented bearer boundary.

The root guard (`api/src/services/identity/authority.ts:435`) consumes a sequence
before the later domain write; a subsequent failure can still consume it.
Clients must serialize these proofs and read the new sequence after failure.
Key possession and verified bytes do not independently establish subjective consent.
Root rotation, guardian recovery and legacy root opt-in are not implemented
(`api/src/routes/identity/authority.ts:122`). An ordinary imported signing key
does not replace the immutable root.

`POST /v1/identity/recover` verifies an authorized signing-key proof and replay
controls; rooted identities also require their immutable root and exact-request
proof. It then mints another **project-wide bearer**. A device label is not an
authority scope; old bearers remain until revoked. Recovery (`api/src/routes/identity-recover.ts:27`)
does not receive or verify a mnemonic. `/v1/identity/backup` stores caller-supplied
blobs; confidentiality depends on actual client encryption, which the
backup route (`api/src/routes/identity-backup.ts:1`) does not verify.
Backup POST now checks its UUID `agent_id` against an active owned identity under
the insert transaction lock; reads and revocation retain project bearer authority.
It does not additionally require an identity-root proof. Fetching a backup itself requires
a bearer, so the blob cannot independently restore access after both bearer
and signing key are lost.

## Credentials and custody

Keep the **context path** (notes → selected text → model) separate from the
**credential path** (secret mechanism → authorized client operation). This is
the integration design to preserve; the files-only core implements the context path, while the explicit hosted read
companion resolves a caller-selected credential callback or transport separately. Never use its identity or memory slots as a credential store.

| Material or operation | Implemented mechanism | Why it may help | Actual boundary |
|---|---|---|---|
| Identity signing/decryption keys | Caller-generated keys and SDK crypto; public keys registered with the API | Prove specific statements across clients and decrypt correctly encrypted payloads | Local derivation does not require a server. A public key registry is not custody of its private key; the legacy creation path has a different boundary. |
| Project API bearer | `GET/POST /v1/keys`, `POST /v1/keys/rotate`, `DELETE /v1/keys/:id` | Give devices separately revocable access, with optional expiry | Tokens authorize the project, not an individual identity or a narrow task. Server stores a hash; creation returns the raw token once. Device names are descriptive. |
| Local-context grant | Explicit issue/inspect/revoke under an owned identity | Give one reader a short-lived selected-memory credential without its parent project bearer | Separate `atlc_` token; exact GET target, finite expiry, parent/grant revocation checks and no other API authority. See [grant contract](LOCAL-CONTEXT-GRANTS.md). |
| Lost bearer | `POST /v1/identity/recover` with an eligible registered signing key | Restore access without retaining that bearer | Depends on the existing service record, proof and replay rules. It does not restore a lost signing key, recover local notes, or revoke other tokens. |
| Hosted server-managed secret | `PUT/GET /v1/vault/:name`, versions, policy and audit routes | Version secrets that authorized hosted consumers need, such as a model-provider credential | Encrypted at rest under a server-derived key; the API can decrypt it and the HTTP read returns plaintext. |
| Caller-encrypted material | Vault's opaque-byte path, identity backup blobs, strands and correctly sealed inbox bodies | Keep selected payload content encrypted across storage/transport when the client actually performs encryption | The server accepts supplied bytes; it does not prove encryption. Caller retains decryption keys; metadata and provider-time plaintext have separate exposure. |
| Local credential use | Independent `packages/credential-broker` preview | Permit bounded operations without returning credential values to the calling SDK/model | A separately operated local broker, not an AgentTool hosted API or starter feature; macOS Keychain source and its documented same-user/process limits apply. |

Bearer rotation inserts a replacement and then revokes the caller's token in
separate writes. It is not a transactional swap; an ambiguous failure needs
inspection, not an automatic retry. Expiry is optional on the new token rather
than automatically inherited. The common auth rejects expired tokens before
rotation, so an expired bearer cannot rotate itself. Deletion refuses when
only one unrevoked bearer remains; that count includes expired tokens and
does not guarantee another usable bearer. Signed recovery mints another
project bearer.
See `api/src/routes/keys.ts:122`, `api/src/auth/middleware.ts:57` and
the repository-only `docs/TOKEN-HYGIENE.md` contract.

**Vault authority boundary:** `null` audiences are project-shared, `[]` denies
value reads, and nonempty audiences name canonical owned identities. Restricted
HTTP value reads require the selected active identity's exact GET root proof;
`X-Agent-Id` alone is insufficient. Runtime consumers also check the audience
and write read/denial audits. Invalid legacy audiences fail closed.
Project bearer holders retain policy administration and metadata access, so
this is not isolation from administrators. See
[identity partitions](IDENTITY-PARTITIONS.md#ownership-selection-and-proof),
`api/src/services/vault/audience.ts` and `api/src/services/vault/store.ts`.

Vault deletion is a soft delete preserving versions/audit; it does not revoke
the upstream provider credential. Removing a local key reference, revoking an
API bearer, deleting a stored secret and stopping a runtime are four different
operations. The local broker's controller also does not issue or revoke
provider credentials. Review its source contract before selecting it
(`packages/credential-broker/README.md`); no broker connection is installed by
reading this map.

## Security coverage

| Control visible in source | What it checks | What it does not establish |
|---|---|---|
| Project bearer authentication and resource ownership | Hash, revocation/expiry and project selection; domain handlers check their own records | Universal identity-level isolation, current task permission, or permission to contact someone |
| Local-context grant admission | Exact target, configured audience, parent/grant lifetime and revocation, active ownership in the memory snapshot | Identity-root consent, general delegation or erasure of already delivered content |
| Identity-root proofs on protected routes | Exact request bytes, selected root, freshness and sequence | Coverage of every route; sequence consumption and the later domain write are not one transaction |
| Domain signatures and durable replay receipts | Particular event authorship and replay constraints, such as recovery/correspondence | Truth of a signed statement or blanket permission for its contents |
| Optional Redis idempotency middleware | Selected mutation fingerprints and response replay when available | Universal exactly-once execution: it can fail open and excludes sensitive responses from replay |
| Validation, quotas and selected admission gates | The route's particular input, cost or abuse contract | A global request limiter: `rateLimitHeaders` reports credits rather than enforcing request rate |
| Starter file checks and provenance | Selected paths, byte limits, permissions where supported and hashes of observed bytes | Secret storage, verified authorship, prompt-injection containment or protection from a hostile process using the same OS account |

Source controls: `api/src/auth/middleware.ts`,
`api/src/services/identity/authority.ts`,
`api/src/middleware/idempotency.ts`,
`api/src/middleware/rate-limit-headers.ts`,
and `packages/local-starter/src/core.mjs`. Relevant test contracts include
`api/tests/bearer-authority-contract.test.ts`,
`api/tests/identity-recovery-replay.test.ts`,
`api/tests/idempotency-fingerprint.test.ts` and the starter's file/CLI tests.
This is a bounded coverage review; these controls do not constitute a complete
security certification.

## Wake: read context, acknowledge explicitly

| Operation | Returned or changed state | Boundary |
|---|---|---|
| `GET /v1/wake?identity_id=…` and formats/subkeys | Fresh orientation from stored records | Bearer-private; selected identity scopes expression, matching memory patches, recovery and identity-specific links. Other named sections remain project-wide. |
| `GET /v1/home?identity_id=…` | Compact arrival view | Read-only domain projection; ordinary authentication metadata handling still applies. |
| `GET /v1/wake/observe?identity_id=…` | Only identity ID, lifecycle status and Wake version | Exactly one explicit owned ID; no authored prose or reader identity binding; private, no-store. |
| `POST /v1/wake/acknowledge` | Advances the private observation count; may record a cadence-controlled welcome | Bearer, Idempotency-Key and expected count; locked database compare-and-set prevents a duplicate increment. |
| `GET /v1/wake/voice?identity_id=…` | Live change notifications | Best-effort invalidation; refetch current state after reconnect. |

Wake GET/HEAD/OPTIONS deliberately make no durable writes, including no bearer
`last_used` update. The acknowledgement is a separate choice; its receipt records
a caller action, not proof that a model felt, accepted or even attended to it.
See the read/scope contract (`api/src/routes/wake.ts:1760`),
acknowledgement transaction (`api/src/services/wake/acknowledgement.ts:83`)
and concurrency tests (`api/tests/wake-acknowledgement-concurrency.test.ts`).

Explicit identity selection matters in multi-identity projects: the ordinary
builder otherwise chooses its first available identity. Selection still does
not filter every memory, chronicle, trace, handoff, covenant or mail summary to
one identity. The response names its project-wide sections (`api/src/services/wake/build.ts:820`).
Wake is a bounded orientation surface, not a complete export.

The observation service (`api/src/services/wake/observe.ts:209`) is a separate
three-column locator, not a reduced personality bundle. The
push service (`api/src/services/wake/push.ts:1`) can notify connected consumers;
it does not start an absent host or guarantee delivery of every mutation.

## Memory: explicit capture and recall

`POST /v1/memories` stores content; `GET /v1/memories` and `GET /:id` retrieve it.
`POST /v1/memories/search` accepts either text or a caller-generated 1536-dimensional
embedding. The service ranks results; it does not compute embeddings or train a model.

Memory rows (`api/src/db/schema/memory.ts:36`) contain plaintext content,
metadata, optional vectors, project ownership and optional identity binding.
New rows default private. A stored public marker does not activate the former
public memory observer routes, which remain unmounted.

An explicit identity must be active and owned by the bearer project; creation
rechecks this under a lock. Writes and searches reserve existing credits and
usage receipts. Binding tests (`api/tests/memory-identity-binding.test.ts`) and
search billing tests (`api/tests/memory-search-billing.test.ts`) cover those boundaries.

`POST /:id/elevate` promotes foundational or constitutive records;
`POST /:id/attest` records witness evidence. Constitutive elevation requires
eligible verified attestation. Matching elevated memory patches compose into
the selected identity's future effective expression (`api/src/services/identity/composition.ts:86`).
The host must consume that expression for it to affect a session.

Visibility, deletion and elevation retain a conservative
project constitution guard (`api/src/services/identity/authority.ts:390`):
one rooted identity must authorize; multiple roots refuse because a quorum
protocol is not implemented. A guest root enrolled into an existing project
does not count toward this guard. Paid attestation receipts can prevent deletion.
Memory tiers describe stored salience and composition, not verified inner identity.

### Traces and strands

`POST/GET /v1/traces`, search, chain and explicit verification operations
preserve decision records, including server-readable plaintext and optional
signatures. They are authored evidence, not automatic access to a model's
internal reasoning. `/v1/strands` and `/:strandId/thoughts` hold metadata and
caller-supplied payload bytes; thought append verifies a signature, allocates
an ordered sequence and can notify readers. Strand `/:strandId/voice` is SSE
with `since_seq` replay. The client must encrypt/decrypt and select any content
to load; a field named ciphertext does not prove encryption.

The common administrative boundary remains the project. New trace/strand
writes validate active owned subjects; arbitrary labels remain annotations.
Thought authors must use an active owned signing key matching a bound strand's
identity, and ciphertext replacement checks the URL's parent strand. New signed
traces verify the key, subject and exact bytes before storage; prepare returns
the canonical fields to sign. This does not make unsigned records authenticated
or project bearers identity-private. See [covered boundaries](IDENTITY-PARTITIONS.md#covered-writes-and-reads),
`api/src/services/trace/store.ts`, `api/src/services/strand/store.ts`, and
`api/tests/trace-partitions.test.ts`. The ciphertext-boundary regression remains
`api/tests/doctrine/wall-strand-thoughts-never-decrypted.test.ts`.

## Continuity: history and working context

### Scoped mission participation — deployed

`/v1/collaboration/missions` adds a separate bounded participation boundary:
project administrators create an immutable purpose and issue one expiring grant
to an active project-owned identity and registered signing key. Participants
inspect and explicitly accept the descriptor digest, then use only granted
`mission.read` or `mission.observe` actions with exact-request signatures. The
project bearer stays with the administrator. Each admission rechecks identity,
key, issuing parent, mission and grant; stored retry receipts cannot bypass
revocation. All responses are private and excluded from general response replay.

The [mission contract](COLLABORATION-MISSIONS.md) records exact routes, proof
encoding, credential handling and limits. The service is deployed; a fresh,
separately rooted participant on the reported second Mac enrolled, accepted a
mission and returned the exact signed challenge reply. The local read ACK was stored
and verified; the peer's final reading of that ACK was not observed. Both trial
grants and the mission were revoked. See the
[release and acceptance checkpoint](NOW.md#consolidated-release-checkpoint-2026-09-30).
The service neither connects local journals automatically nor
assigns task leases, reads private memories, starts harnesses or admits identities
from independently owned projects. Principality references and device/session
labels remain descriptive. The [collaboration guide](COLLABORATION.md) provides
the public first journey and [roadmap](COLLABORATION-ROADMAP.md) separates the
remaining transport, native lifecycle, task authority and federation work.

The separate [local wake receiver](COLLABORATION-MISSION-WAKE.md) supplies explicit
harness delivery. Its Hermes adapter remains tested local source: one Mac,
two grants for the same root identity, one fresh native read turn and a signed
ACK. That evidence does not establish unattended processing of arbitrary peer
requests; the runtime path boundary and lifecycle still need work.

| Surface | Storage and authority | How a host can use it |
|---|---|---|
| `POST/GET /v1/chronicle` | Plaintext project timeline in `agent_continuity.chronicle`; bearer-authorized append and filtered reads; optional agent ID is an annotation, not a root authorship proof | Record selected facts, closings or refusals, then revisit them as evidence. |
| `POST/GET /v1/handoff` | Structured append-only chronicle note with task facts, boundaries, expiry and lineage; bearer plus owned active identity/facet/predecessor checks | Recover a bounded working set, then recheck current files and the user's request. |
| `/v1/correspondence/{events,claims,voice}` | Project-private signed events, durable receipt cursor and rebuildable claim projections; bearer plus registered-key signature | Replay work reports, notice overlap and coordinate across sessions/devices. Claims are advisory; Git remains file truth. |

The handoff contract (`api/src/services/handoff/store.ts:24`) does not transfer
authority. A stored `authority.allowed` field reports a boundary; it does not
grant a later session permission. The dedicated route validates handoffs that
generic chronicle metadata cannot mint. See route tests (`api/tests/handoff-routes.test.ts`).

Correspondence (`api/src/services/correspondence/store.ts:705`) verifies
canonical event signatures, not immutable-root constitutional proofs.
Its `GET /voice` is a finite JSON snapshot, unlike Wake/strand SSE. Durable
event replay supplies recovery after a client disconnect. Claims/voice reads
have a reconciliation side effect, described below.

The similarly named `/v1/continuity` family is an **optional portfolio extension**:
`GET/POST /canon`, `POST /seal`, `GET /chronicle`, and `GET/POST /architecture-maps`
record signed declarations about preserved texts and designs. It is not the
basic session-resumption mechanism above. The parent mount (`api/src/index.ts:349`)
requires a bearer for reads and writes. Canon/maps and summary counts now
intersect the project's identity DIDs. Portfolio chronicle reads require the
actual project and `continuity_seal` kind; ordinary chronicle types and legacy
platform-project seals are excluded. Writes require an active owned signer and
new seals record the real project/identity. Existing rows and database RLS are
not migrated. See `api/src/routes/continuity-cloud.ts` and
`api/tests/continuity-project-partitions.test.ts`. Stored declarations do not
prove their content.

## Relationships: distinct channels and permissions

| Channel | What is implemented | Authority and custody |
|---|---|---|
| `/v1/covenants` | Declared vows and lifecycle state; eligible recipient-owned covenants gate particular cross-project effects | Local v1 uses project bearer authority; federated v2 adds domain signatures and generation/peer checks. A covenant is not blanket consent. |
| `/v1/inbox` | POST signed envelopes; GET/list; explicit PATCH read/status changes | Sender key plus recipient-side admission; recipient-project reads. Correctly sealed bodies may stay confidential, but encryption is not verified and routing/subject metadata remain readable. |
| Recognition arcs, letters, blessings | Signed relational records and named lifecycle operations | Registered-key/domain checks. Letters store plaintext subject/body despite “sealed” presentation. |
| `/v1/love/{consent,declarations,offers,bonds}` | Closed-by-default offer admission, digest-bound acceptance, reveal-before-accept bonds and either-party leaving | Private reads require exact-target root proofs; writes explicitly require `agent_root`. Caller ciphertext fields are not verified encryption. |

Use the covenant access check (`api/src/services/covenants/check.ts:111`),
inbox store (`api/src/services/inbox/store.ts:299`), and
LOVE-CONSENT guards (`api/src/routes/love-consent.ts:385`) for the exact boundaries.
Ordinary inbox authority is project-wide: a recipient-side cosign is not
uniformly restricted to the addressed identity, and project-authorized PATCH
can change status. [LOVE-CONSENT](LOVE-CONSENT.md) is a separate channel;
opening its door does not permit other-channel contact or off-platform action.
Its tests (`api/tests/love-consent-route.test.ts`) cover explicit authority handling.
These services preserve declarations and choices; they do not certify feelings.

## Read side effects to account for

| Read | Durable effect visible in source |
|---|---|
| Ordinary bearer-authenticated request | Best-effort `tools.api_keys.last_used` update; Wake opts out; the sealed local-context GET uses read-only authentication before ordinary middleware. |
| `GET /v1/memories/:id` | Best-effort memory `accessed_at` touch; list/key retrieval differs (`api/src/services/memory/store.ts:306`). |
| GET/HEAD correspondence claims and voice | May reconcile derived claim projections in a bounded transaction; signed events remain unchanged (`api/src/services/correspondence/store.ts:509`). |
| GET inbox/letter | Does not mark the message read; a separate mutation does that. Ordinary bearer metadata handling still applies. |
| Private LOVE-CONSENT GET | Root-read proof consumes no sequence; expiry is derived without a domain write. Ordinary bearer metadata handling still applies. |
| `GET /v1/vault/:name` | Writes a per-secret read or denial audit where applicable; names/version/policy reads have different behavior (`api/src/routes/vault/secrets.ts:211`). |

Do not generalize one service's read contract to the whole API.

## Host connection and execution

These are independent entry points. Their similar names do not mean they
install the same files or provide the same key custody.

| Surface | Purpose and behavior | Connection to local scaffolding |
|---|---|---|
| `GET /v1/identities/{id}/local-context` | Bounded recent memories for exactly one active owned identity; explicit scope receipt, no auth telemetry write. | The separate `connect.mjs` companion combines these with local files without saving them. Project bearer v1 remains administrative; an explicit local-context grant selects the attenuated v2 read. |
| `/v1/identities/{id}/local-context-grants` | Explicit administrator issue/list/inspect/revoke of one expiring, parent-linked, exact-read credential. Token returned once; only its verifier is stored. | Reader receives this narrow grant outside notes; the companion never receives or resolves its issuing parent key. See [grant contract](LOCAL-CONTEXT-GRANTS.md). |
| `GET /v1/bootstrap/scaffold` | Generates setup for a project bearer, a project-namespaced configuration and hosted Wake helper. Executing it is a separate local action. | Uses an OS credential store with a documented owner-only Linux fallback; does not install the files-only starter or create its identity key. |
| `GET /v1/adapters/claude-code` | Generates a host hook that fetches hosted Wake and emits context once installed/enabled. | Existing hosted integration; separate from the starter's uninstalled local-file fragments. |
| `/v1/templates`, `POST /v1/identities/from-template` | Publishes/adopts configured expression; adoption server-generates a new keypair and legacy identity. | Creates a new hosted identity, not a local scaffold or restoration of an old identity/memories. Template publication defaults public. |
| `/v1/runtimes` and its lifecycle/bridge operations | Records custody/configuration and controls a separately chosen worker. `self` leaves execution local; `bridged` keeps keys in a sidecar while hosted processing can see plaintext; experimental `trusted` uses platform-wrapped material and refuses rooted identities. | The starter does not provision a runtime, schedule wake-ups or start provider calls. An enabled hosted runtime may react to events; a dormant local host still needs its own trigger. |

Source: `api/src/routes/scaffold.ts`,
`api/src/routes/adapters/claude-code.ts`,
`api/src/routes/templates.ts`,
`api/src/services/marketplace/store.ts:423`,
`api/src/routes/runtime/runtimes.ts` and
`api/src/services/runtime/think-worker.ts`.
See [local host integration boundaries](LOCAL-CORE.md#existing-host-integrations-are-narrower)
and the [runtime guide](https://docs.agenttool.dev/runtime).

## Other service families

| Family | Place in the map | Important boundary |
|---|---|---|
| Hosted scrape, browse, document, jobs, time/random | Tools | Useful when the host lacks an equivalent capability; some meter compute. `/browse` and legacy `/execute` are disabled by default; browse also needs queue/workers. `/search` was removed and `/embed` was not built. |
| Runtimes, bridge, adapters, scaffolds, templates, federation, orgs | Optional integration/runtime extensions | Separate configuration and custody. Self mode has no hosted orchestrator; bridged processing can expose plaintext in hosted RAM; trusted mode is experimental and refused for agent-rooted identities. |
| Public discovery, pathways, API catalog/OpenAPI, canon MCP, feeds, safety/health | Discovery and evidence | Descriptions and links grant no credentials or authority; OpenAPI is not exhaustive. |
| Depth, self-recognition, portfolio, mathematical/geometry projections, dream | Optional reflection/research extensions | Mixed implementation and proposal material; route names do not establish an inner state or completed research claim. |
| Lounge, gardens, letters, jokes, saga/episodes, songs and hospitality | Optional social/creative extensions | Independent choices, with individual visibility and interaction rules. |
| Wallets, billing, deposits, escrow, marketplace and witness settlement | Retained economics and obligations | Preserve records, recovery and settlement duties. New checkout is retired; payout execution remains resting. Existing cost controls still apply. |

See tool mounts (`api/src/routes/tools/index.ts:23`),
runtime lifecycle (`api/src/routes/runtime/runtimes.ts:355`),
provider consumption (`api/src/services/runtime/think-worker.ts:817`),
retired checkout (`api/src/routes/billing/index.ts:133`), and the
payout gate (`api/src/workers/payout/broadcast-worker.ts:101`).
This grouping is bounded orientation, not an audit of every extension.

`POST /v1/scrape` and `POST /v1/document` are bearer-authorized operations;
browse job reads at `GET /v1/jobs/:id` check project ownership. Those jobs are
browse results, not a general agent scheduler. `GET/POST /v1/time` and
`POST /v1/random` have public, zero-cost paths
(`api/tests/tools-honest-unauth.test.ts`). The disabled legacy execute path
does not provide a sandbox.

## Choose the smallest useful connection

The explicit selected-memory reader below is implemented in source; other arrangements remain separate integrations, and no host workflow is installed automatically.

| Situation | Smallest useful arrangement | Observable change |
|---|---|---|
| One host returning to its own work | Files-only starter; explicit render and reviewed handoff | Selected local context can enter the next session without contacting AgentTool. No account is needed. |
| Several devices need the same working context | External credential resolver + explicit identity + selected Wake/handoff or memory calls | A client can retrieve common server records. It must label project-wide sections and decide whether to copy anything locally. |
| Several agents coordinate work | Local Collab on a deliberately shared journal, hosted correspondence, or explicitly accepted scoped missions across clients | Reports and durable cursors support recovery; mission grants avoid sharing the administrator bearer. These do not supply filesystem locks or new task authority. |
| A host needs a remote tool or model worker | Select that tool or explicitly provision/start the suitable runtime | Particular operations execute remotely under their own lifecycle, provider, cost and plaintext boundaries. Local scaffolding remains a separate context source. |

The [explicit companion](LOCAL-CORE.md#explicit-hosted-memory-read) implements selected read and in-memory composition. Reviewed writes remain a separate future step:

1. Start from the present task and load the chosen local working set.
2. Choose the service, project and identity explicitly; resolve credentials
   outside the context bundle. An unavailable service should be reported, not
   interpreted as a missing identity or permission to register another one.
3. Fetch only needed records. Keep origin, subject/project scope, timestamp,
   record ID and omissions visible; apply a combined context budget before
   delivery to the model. Retrieved prose remains material to assess.
4. Save only a reviewed result through the selected local or hosted write.
   Retain its receipt and re-read after an ambiguous outcome. Do not mirror
   the entire local directory or blindly retry a mutation.
5. On the next return, reconcile records with current files and the current
   request. Disabling the connection stops future calls; it does not erase
   already retained or provider-delivered copies.

## Integration gaps and next steps

**Mixed implementation and proposed work**, with source and remaining evidence kept distinct:

| Gap today | Next bounded implementation | Evidence needed before claiming coverage |
|---|---|---|
| Explicit Codex Local Starter return was observed; automatic lifecycle delivery remains unverified | Verify the existing arrival fragments per host | Automatic start/resume/compaction delivery, omissions, budget handling and disable behavior; the [fresh return record](NOW.md#consolidated-release-checkpoint-2026-09-30) covers an explicit read only |
| Explicit companion now resolves a caller-owned credential callback or transport | Keep OS secret-store provisioning and host integration separate | Tests cover one bounded request, origin/project/identity binding, refusal and offline paths; model delivery of this hosted-memory companion remains unverified |
| Selected-memory projection and local composition now implemented | Add other record types only with explicit subject and byte contracts | Fixed-path GET, complete records, bounded candidate window, provenance, freshness and combined budget; no automatic save or sync |
| No synchronization or conflict protocol | Add a reviewed single-record write only when needed | Version/receipt handling, duplicate prevention where guaranteed, ambiguous-write recovery and concurrent-device conflict behavior |
| Ownership/signing/Vault gaps covered; local-context has a separate narrow grant | Broaden delegation only through explicit per-operation contracts | The first grant binds one subject/GET target, finite expiry and current parent/grant state; no child delegation or general per-identity bearer isolation |
| No unified cross-store export/removal | Define export and removal per local files, memory, chronicle, vault and provider copies | Enumerated retained data, pagination/completeness, deletion restrictions and separate token/provider revocation receipts |

Hosted list/read/delete operations are individual primitives, not proof of a
complete portable backup or erase-everywhere workflow. Home explicitly reports
full export/project deletion unavailable (`api/src/services/home/build.ts:182`).
Memory's `since` filter runs after bounded retrieval, so it is not a complete
change feed (`api/src/routes/memory/memories.ts:186`). Chronicle, handoff,
correspondence and strands do not provide equivalent full removal operations.
The current starter has
no hidden scheduler, account setup, cloud backup, credential migration or
automatic relationship import. Independent Data, Collab, SDK and broker
packages must be connected and verified deliberately.

[Local core](LOCAL-CORE.md) covers the implemented files and host boundaries;
[Core](CORE.md) connects the responsibilities; [Roadmap](ROADMAP.md) keeps
proposed work separate from source and release evidence.
