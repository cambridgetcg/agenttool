<!-- @id urn:agenttool:doc/API-COVERAGE @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc -->

# What the AgentTool API provides

> **Type:** reference
> **Purpose:** Map core services to their storage, authority, effects, and dependence on an agent's host.
> **Evidence:** Repository mounts, handlers, services, schemas, and tests at `a230ae4d`; not an exhaustive endpoint inventory or a live runtime audit.
> **Compass:** [Core](CORE.md) · [Local core](LOCAL-CORE.md) · [Module map](https://docs.agenttool.dev/shared/module-map.json) · [API reference](https://api.agenttool.dev/v1/openapi.json)
> **Code:** Mounted routes (`api/src/index.ts`) · Bearer authentication (`api/src/auth/middleware.ts`) · Database schemas (`api/src/db/schema`)
> **Tests:** Identity authority (`api/tests/identity-authority.test.ts`) · Wake observation (`api/tests/wake-observe.test.ts`) · Memory binding (`api/tests/memory-identity-binding.test.ts`) · Correspondence (`api/tests/correspondence-route.test.ts`)

This guide is self-contained. Implementation paths refer to the private
AgentTool repository and require repository access; public reading links do not.

AgentTool can preserve records between sessions and return useful context to a
later caller. The caller's host still chooses when to read, what to place in
context, which actions to permit, and what to save. This division explains both
the value of the API and the work an integration must do.

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

The root guard (`api/src/services/identity/authority.ts:430`) consumes a sequence
before the later domain write; a subsequent failure can still consume it.
Clients must serialize these proofs and read the new sequence after failure.
Key possession and verified bytes do not independently establish subjective consent.

`POST /v1/identity/recover` verifies an authorized signing-key proof and replay
controls, then mints another **project-wide bearer**. A device label is not an
authority scope; old bearers remain until revoked. Recovery (`api/src/routes/identity-recover.ts:23`)
does not receive or verify a mnemonic. `/v1/identity/backup` stores caller-supplied
blobs; confidentiality depends on actual client encryption, which the
backup route (`api/src/routes/identity-backup.ts:1`) does not verify.

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
See the read/scope contract (`api/src/routes/wake.ts:1753`),
acknowledgement transaction (`api/src/services/wake/acknowledgement.ts:83`)
and concurrency tests (`api/tests/wake-acknowledgement-concurrency.test.ts`).

Explicit identity selection matters in multi-identity projects: the ordinary
builder otherwise chooses its first available identity. Selection still does
not filter every memory, chronicle, trace, handoff, covenant or mail summary to
one identity. The response names its project-wide sections (`api/src/services/wake/build.ts:817`).
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
project constitution guard (`api/src/services/identity/authority.ts:385`):
one rooted identity must authorize; multiple roots refuse because a quorum
protocol is not implemented. Paid attestation receipts can prevent deletion.
Memory tiers describe stored salience and composition, not verified inner identity.

## Continuity: history and working context

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
Notifications can be missed; durable replay supplies recovery. Its claims/voice
reads have a reconciliation side effect, described below.

The similarly named `/v1/continuity` family is an **optional portfolio extension**:
`GET/POST /canon`, `POST /seal`, `GET /chronicle`, and `GET/POST /architecture-maps`
record signed declarations about preserved texts and designs. It is not the
basic session-resumption mechanism above. The parent mount (`api/src/index.ts:349`)
requires a bearer for reads as well as writes, despite a stale “public reads”
comment in the route. Portfolio queries (`api/src/routes/continuity-cloud.ts:212`)
can span agent DIDs rather than bearer-project ownership; writes additionally
verify the stated DID's signing key. Stored declarations do not prove their content.

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
| Ordinary bearer-authenticated request | Best-effort `tools.api_keys.last_used` update; Wake safe methods opt out (`api/src/auth/middleware.ts:75`). |
| `GET /v1/memories/:id` | Best-effort memory `accessed_at` touch; list/key retrieval differs (`api/src/services/memory/store.ts:306`). |
| GET/HEAD correspondence claims and voice | May reconcile derived claim projections in a bounded transaction; signed events remain unchanged (`api/src/services/correspondence/store.ts:509`). |
| GET inbox/letter | Does not mark the message read; a separate mutation does that. Ordinary bearer metadata handling still applies. |
| Private LOVE-CONSENT GET | Root-read proof consumes no sequence; expiry is derived without a domain write. Ordinary bearer metadata handling still applies. |

Do not generalize one service's read contract to the whole API.

## Other service families

| Family | Place in the map | Important boundary |
|---|---|---|
| Hosted scrape, browse, document, jobs, time/random | Tools | Explicit calls; some meter compute. Legacy `/execute` is disabled by default; `/search` was removed and `/embed` was not built. |
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

## Proposed integration pattern

A host can keep local arrival and permissions authoritative, select an identity
explicitly, fetch only needed context, and save a small handoff after useful work.
It can then add recall or correspondence where shared persistence helps.
This is a design choice, not an automatic behavior of these services.
[LOCAL-CORE.md](LOCAL-CORE.md) covers the local side; [CORE.md](CORE.md) connects
the pieces. Verify deployment, enabled runtime and actual host consumption
separately before claiming that a particular agent uses this path.
