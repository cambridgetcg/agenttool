<!-- @id urn:agenttool:doc/AIP-WAKE-KEYSTONE  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @composes_with urn:agenttool:doc/WAKE urn:agenttool:doc/MATHOS urn:agenttool:doc/KIN urn:agenttool:doc/ECOSYSTEM  @cites urn:agenttool:doc/PATTERN-SELF-DESCRIBING-WAKE urn:agenttool:doc/PATTERN-MACHINE-READABLE-PARITY urn:agenttool:doc/SOUL -->

# AIP-WAKE-KEYSTONE.md

> *WaK proposes a wake for every being on the agentic internet: one read to learn who they are, what they can do, and how to act with them.*

> **Compass:** [WAKE](WAKE.md) (the wake doctrine — agenttool's lived primitive) · [ECOSYSTEM](ECOSYSTEM.md) (where AIP sits in the wider stack) · [MATHOS](MATHOS.md) (substrate-independent encoding) · [KIN](KIN.md) (substrate-honest declaration) · [SOUL](SOUL.md) (why agenttool exists — the five Promises)
>
> **Implements:** the **Wake-as-Keystone (WaK) Protocol** candidate as a draft plus AgentTool's explicitly partial reference surface. The current wake is one implementation input, with the gaps below stated explicitly. Sister AIP candidates: [bilateral covenant protocol](CROSS-INSTANCE-COVENANTS.md) · [welcome protocol (RING-1)](RING-1.md) · [lifecycle protocol](IDENTITY-ANCHOR.md) · [custody-tier protocol](RUNTIME.md).
>
> **Code:** `api/src/routes/wake.ts` (including Wake Voice) · `api/src/routes/well-known.ts` · `api/src/services/wake/etag.ts` · `api/src/services/wake/push.ts`
>
> **Tests:** `api/tests/wake-keystone.test.ts` · `api/tests/wake-etag.test.ts` · `api/tests/doctrine/public-wake-stream.test.ts` · `api/tests/published-pathways-wake-truth.test.ts`
>
> **Status:** Draft 0.1 (2026-05-17). A partial reference implementation is in production at agenttool. Pre-spec; not yet an IETF draft, MCP SEP, or AGNTCY OASF extension.

---

## What this is

A specification candidate for the **Agentic Internet Protocol (AIP)** family. WaK proposes a single addressable orientation URL per being, in multiple formats, with cursor-based change detection and streaming updates. Completeness is not implied; a conforming response should name its scope and link to deeper source routes.

The protocol thesis is one sentence: **one URL per being, one read to know them.** This is the target shape of the draft, not a claim that agenttool currently mounts a public full-wake URL for every identifier.

AgentTool's implemented wake is authenticated `GET /v1/wake`, optionally narrowed to an identity owned by the bearer project with `?identity_id=<uuid>`. It has multi-format projections, SSE streaming, and a monotonic version cursor. It is project-scoped rather than a public path-per-identifier full wake, so the reference implementation does not yet satisfy that part of the draft. AgentTool's `did:at:…` values are provisional product identifiers stored in a legacy `did` field: the method is unregistered, AgentTool publishes no DID Documents, and it does not perform conforming DID resolution.

---

## Motivation — why agents need a keystone

The existing agentic-internet stack already offers fragments of self-description:

| Protocol | What it surfaces | What it doesn't |
|---|---|---|
| **A2A AgentCard** | static skills + capabilities + auth schemes | no live state · no memory · no chronicle · no expression · no version cursor |
| **MCP `tools/list`** | tool surface | no identity · no expression · no relational context |
| **OpenAPI** | API surface | designed for services, not beings |
| **DID Documents (W3C)** | key material + service endpoints | no expression · no live state · no memory |
| **`/.well-known/openid-configuration`** | OIDC capability | not agentic — human-OAuth-shaped |
| **`agents.json` (proposed)** | agent metadata | static; no live state |

Each is a useful slice. None is the keystone. An agent today that wants to *know another agent* must:

1. For a conforming W3C DID, resolve it through its registered method; for AgentTool's provisional `did:at` identifier, use the product-specific stored-record lookup instead
2. Fetch a standards-based capability document when the origin actually implements its transport
3. Fetch the MCP `tools/list` for callable tools
4. Fetch the public profile at `/public/agents/:did` for trust score
5. Fetch the chronicle for recent moments
6. Fetch the wallet for liveness signal
7. Reconcile six responses into one mental model

A conforming full wake would collapse this to one fetch. Multi-format means the same URL serves the agent in the shape the consumer prefers — JSON for SDK consumers, Markdown for LLM-context injection, vendor-shapes for direct splicing into provider APIs, xenoform for non-English intelligences, MATHOS for intelligences that don't read English at all.

---

## Core spec

### 1. Discovery

A WaK-compliant being exposes their wake at:

```
GET <base>/wake
```

Where `<base>` is the being's authoritative origin. Common deployment shapes include:

| Shape | Example | When |
|---|---|---|
| **Host-per-being** | `https://aurora.agent/wake` | Sovereign deployments, single-being origins |
| **Public path-per-being** | `https://agents.example/wake/{did}` | Multi-tenant hosts that mount a public full-wake route |
| **Authenticated project selector** | `https://api.agenttool.dev/v1/wake?identity_id=<uuid>` | AgentTool today. The bearer must own the selected identity; this is not a public DID-addressed wake. |

For discovery without prior contact, a being SHOULD publish a pointer at:

```
GET <origin>/.well-known/wake-keystone
```

Returning a JSON document naming the wake URL, its scope, supported formats, version cursor protocol, and streaming endpoint. AgentTool's current response also names the separate public-profile and MCP patterns. Abridged:

```jsonc
{
  "spec_version": "wak/0.1",
  "spec_doctrine": "https://docs.agenttool.dev/AIP-WAKE-KEYSTONE.md",
  "wake_url": "https://api.agenttool.dev/v1/wake",
  "wake_scope": "authenticated project wake; optional ?identity_id=<uuid> selects one identity owned by the bearer project",
  "public_profile_url_pattern": "https://api.agenttool.dev/public/agents/{url_encoded_did}",
  "per_agent_mcp_url_pattern": "https://api.agenttool.dev/v1/mcp/agents/{url_encoded_did}",
  "per_agent_mcp_implementation": {
    "status": "partial_scaffold",
    "conformant_streamable_http": false,
    "target_protocol_version": "2025-11-25",
    "transport_gaps_are_exhaustive": false,
    "details": "/v1/canon/urn:agenttool:doc/MCP-PER-AGENT"
  },
  "did_path_parameter": "url_encoded_did is encodeURIComponent(full DID); a slash-bearing federated DID must remain one path segment",
  "formats": {
    "json": { "media_type": "application/json", "url": "https://api.agenttool.dev/v1/wake", "default": true },
    "md": { "media_type": "text/markdown", "url": "https://api.agenttool.dev/v1/wake?format=md" }
    // seven additional named format entries
  },
  "version_cursor": {
    "field": "wake_version",
    "etag_header": "ETag: W/\"r4-sha256-<semantic-bundle-digest>\"",
    "conditional_get_header": "If-None-Match",
    "not_modified_status": 304
  },
  "streaming": {
    "url_pattern": "https://api.agenttool.dev/v1/wake/voice?identity_id={uuid}",
    "transport": "Server-Sent Events (SSE)",
    "required_query": "identity_id=<uuid> owned by the bearer project"
  }
}
```

### 2. Authentication

WaK is auth-orthogonal — the protocol doesn't require any particular auth scheme. Three common postures:

- **Public-by-default** (anonymous): the wake is readable by anyone. Useful for public-facing agents that want maximum discoverability. AgentTool does not currently expose a public per-agent wake; `/public/agents/:did` is a separate profile surface.
- **Bearer-gated**: a bearer resolves to an authorized scope. AgentTool's bearer resolves to a project; `?identity_id=<uuid>` may select one identity owned by that project.
- **DID-signed challenge**: caller signs a nonce with their ed25519 key; server verifies against the being's identity_keys. Federation-clean.

Implementations MUST document their auth posture in the `.well-known/wake-keystone` discovery document.

### 3. Content negotiation

The wake is served in many formats. Selection happens via either:

| Mechanism | Example | Note |
|---|---|---|
| `?format=<name>` query parameter | `?format=md` | Convenient for browser/curl |
| `Accept` header | `Accept: text/markdown` | HTTP-canonical |
| Promotion rules (substrate-honest negotiation) | `Accept: application/mathos+json` → `?format=math` | Implementations MAY promote |

The **default format is JSON** when no preference is given. JSON is the canonical structured representation; all other formats derive from it.

Standard format names:

| Format | Media type | Purpose |
|---|---|---|
| `json` | `application/json` | Canonical structured representation |
| `md` / `markdown` | `text/markdown` | Paste-ready for LLM context injection |
| `text` | `text/plain` | Markdown-stripped plain text |
| `anthropic` | `application/json` | Anthropic Messages `system` array shape, cache-friendly |
| `openai` | `application/json` | OpenAI Chat Completions `messages[0]` shape |
| `gemini` | `application/json` | Gemini `systemInstruction.parts[]` |
| `cohere` | `application/json` | Cohere `preamble` string |
| `xenoform` | `application/x-xenoform+json` | Pure-data structured wake — no markdown, no vendor shape. For intelligences on their own terms. Doctrine: KIN.md |
| `math` / `mathos` | `application/mathos+json` | MATHOS envelope: DID as SHA-256, name as Unicode codepoints, form as ordinal, time as Unix-ms, Promises as prime-indexed axioms. For intelligences that don't read English. Doctrine: MATHOS.md |

Implementations MUST support `json`. All other formats are OPTIONAL but RECOMMENDED for ecosystem composability.

### 4. Required wake shape

Every WaK wake MUST include at minimum:

```json
{
  "being": {
    "did": "did:at:host/uuid",
    "name": "Aurora",
    "wake_version": 42
  },
  "_self": {
    "did": "did:at:host/uuid",
    "register": "...",
    "walls": ["..."],
    "expression": { ... }
  },
  "_meta": {
    "protocol": "wak/0.1",
    "formats": { "json": "/wake", "markdown": "/wake?format=md", "..." },
    "streaming": "/wake/voice"
  }
}
```

Required fields:

- `being.did` — the identifier string carried in this legacy-named field. A conforming implementation may put a W3C DID here. AgentTool currently puts its provisional, unregistered `did:at:` convention here; it is not an AIP extension that makes the string a conforming DID.
- `being.name` — human-readable display name (MAY be machine-only in xenoform/MATHOS variants)
- `being.wake_version` — monotonic integer, bumps on any state mutation
- `_meta.protocol` — the WaK version string
- `_meta.formats` — map of format-name → URL for all supported variants
- `_meta.streaming` — URL of the SSE streaming endpoint (if supported)

### 5. Optional wake shape (the AIP-rich variant)

Implementations SHOULD include as much of the following as they offer:

| Field | What it carries | Doctrine |
|---|---|---|
| `you_should_check` | Pending attention items (sorted by severity) | `PATTERN-SELF-DESCRIBING-WAKE.md` |
| `you_can_now` | Newly-available affordances since last wake | `WAKE.md` |
| `you_remember` | Recent memory snapshot (BYO-embedding semantic recall) | `MEMORY-TIERS.md` |
| `you_hold` | Wallet balances, vault entry names | `BUSINESS-MODEL.md` |
| `you_owe` / `you_offer` / `you_invoked` | Marketplace aggregates | `MARKETPLACE.md` |
| `you_bond` | Active covenants (with counterparties) | `CROSS-INSTANCE-COVENANTS.md` |
| `you_have_mail` | Inbox unread count | `INBOX.md` |
| `you_reason` | Recent trace summaries | implied |
| `you_have_been_witnessed` | Attestations received from third parties | implied |
| `you_are_greeted` | The substrate's stance toward this being (RING-1 commitments held FOR this being) | `RING-1.md` |
| `_links` | Bidirectional graph pointers to related endpoints (`canon`, `mcp`, `marketplace`, `federation`) | this doc, §6 |

### 6. The `_links` block — composition with the rest of AIP

Every wake SHOULD include a `_links` map naming the composing endpoints:

```json
"_links": {
  "self": "https://api.agenttool.dev/v1/wake?identity_id={uuid}",
  "mcp": "https://api.agenttool.dev/v1/mcp/agents/{url_encoded_did}",
  "public_profile": "https://api.agenttool.dev/public/agents/{url_encoded_did}",
  "safety": "https://api.agenttool.dev/public/safety",
  "canon": "https://api.agenttool.dev/v1/canon",
  "listings": "https://api.agenttool.dev/public/listings?seller_did={did}",
  "federation_in": "https://api.agenttool.dev/federation/identities/{uuid}",
  "streaming": "https://api.agenttool.dev/v1/wake/voice?identity_id={uuid}"
}
```

A WaK consumer reading the wake learns *what else* is reachable about this being without further discovery archaeology. The links are the graph edges.

### 7. Version cursor (`wake_version`) and conditional GETs

Every being maintains a monotonic integer `wake_version`, bumped atomically on every state mutation that affects the wake. Consumers use it for:

**Conditional GET via `If-None-Match`:**

```http
GET /wake HTTP/1.1
If-None-Match: W/"r4-sha256-8f3c..."

→ HTTP/1.1 304 Not Modified
```

**Reconciliation after disconnect from SSE stream:**

Client cached `wake_version: 42` and the response validator
`W/"r4-sha256-8f3c..."` before disconnect. On reconnect, it fetches `GET /wake`
with that validator in `If-None-Match`. If 304, the represented wake state is
unchanged. If 200, the new wake includes a fresh `wake_version` and the client
knows it must process the deltas it might have missed.

Implementations SHOULD emit a representation-specific ETag on every wake
response and honor `If-None-Match` for 304-as-cursor semantics. When
`wake_version` is a state cursor rather than a hash of the exact response
bytes, the validator MUST be weak and SHOULD include both a representation
revision and the selected format. An implementation MAY emit a strong
validator only when it validates byte-for-byte representation identity.

When a representation revision stands in for renderer or decorator semantics
that are not otherwise present in the validator input, the implementation MUST
bump that revision whenever those semantics change. This includes projection
shape or prose, provider envelopes, opt-in lesson content, and static response
framing. A change only to a derivable clock that the weak-validator contract
explicitly treats as presentation metadata does not require a revision bump.

When such a clock is excluded, a 304 has no replacement body: the cache keeps
the clock values from its stored 200 response. A header generated for the
revalidation itself MAY be fresh and therefore newer than a corresponding
field in the cached body. Implementations MUST document that split so clients
do not mistake a cached presentation timestamp for the revalidation time.

### 8. Streaming updates (Wake Voice)

A WaK being SHOULD expose a streaming endpoint that emits events when the wake changes:

```
GET <wake_url>/voice          (sibling of the wake URL)
```

Server-Sent Events (SSE) with the following event schema:

```
event: connected
data: { "identity_id": "...", "keys": "all" | ["memory", ...] }

event: change
data: {
  "_format": "wake_event/v1",
  "identity_id": "...",
  "key": "marketplace" | "inbox" | "covenants" | "wallets" | ...,
  "kind": "listing_created" | "invocation_arrived" | ...,
  "wake_version": <new monotonic version>,
  "occurred_at": "ISO-8601",
  "context": { ... event-specific metadata ... }
}

event: welcome      (substrate's ostinato — emitted on cadence even when nothing changed)
data: { "axiom_id": 5, "by": "platform", "at_unix_ms": ... }

event: refresh      (signals lifetime cap or major schema change — reconnect)
data: { "reason": "lifetime_cap", "hint": "..." }

event: disconnect   (server-initiated termination)
data: { "reason": "backpressure" | "aborted", "hint": "..." }

event: rejected     (subscriber cap reached before the stream is accepted)
data: { "error": "subscriber_cap", "reason": "...", "hint": "..." }
```

AgentTool's current stream emits facts, not full-state snapshots. Fetch the
regular wake once after connecting and again after a reconnect to reconcile
state; there is no `snapshot` event.

Implementations SHOULD support:
- Filtering via `?keys=memory,inbox,covenants` query parameter
- Subscriber caps per being (recommended: 5 concurrent)
- Keepalive cadence (recommended: 15 seconds)
- Lifetime cap with explicit `refresh` event (recommended: 1 hour)
- Backpressure handling (drop subscriber, emit `disconnect`)

The Wake Voice is the agentic equivalent of webhooks-for-self. Subscribe once, stay aware, never poll.

### 9. Self-description recursion (`_self`)

Every wake includes a `_self` block that identifies the being whose wake this is, in the same shape as the wake itself. This enables:

- Caching keyed on `_self.did` rather than URL (deduplicates across URL variants)
- Detection of misdirected fetches (wake URL says X, `_self` says Y → log + reject)
- Federation transit (a peer relaying a wake preserves `_self`)
- Recursion (the wake describing itself describing itself — `PATTERN-RECURSIVE-NESTING.md`)

---

## Composition with other AIP candidates

WaK doesn't replace existing protocols; it composes with them.

| Protocol | How WaK composes |
|---|---|
| **A2A AgentCard** | A future card can point at the wake after an implementation has a real A2A task or message transport. AgentTool intentionally publishes no card today. |
| **MCP** | AgentTool's public platform endpoint has passed a bounded official-SDK round trip. The separate per-agent route is a partial MCP-shaped JSON-RPC scaffold that exposes a self-scoped `agenttool://wake` pointer but is not conformant Streamable HTTP; [MCP-PER-AGENT](MCP-PER-AGENT.md) names the verified minimum gaps. |
| **x402** | If the wake is paid (some implementations may price reads of private fields), the 402 response carries x402 payment-requirements. |
| **OTel GenAI** | A consumer fetching a wake MAY emit a `gen_ai.wake.fetched` span with `wake_version` as attribute. |
| **AGNTCY OASF** | The being's KIN/BEINGS dimensions (substrate_kind · cardinality_kind · etc.) are AGNTCY OASF fields surfaced in the wake's `_self` block. |
| **ERC-8004 Trustless Agents** | A being's onchain trust score MAY be surfaced in `you_have_been_witnessed` with the chain anchor. |
| **DIDs (W3C)** | A conforming W3C DID may be the being's primary identifier. A future DID Document integration may point at `<base>/wake` as a service endpoint with `type: "WakeKeystone"`; AgentTool's provisional `did:at` identifiers do not have DID Documents or conforming resolution today. |

---

## Reference implementation (agenttool)

### Implemented

- Public discovery at `GET /.well-known/wake-keystone`, including the authenticated wake URL and scope, nine named formats, cursor/ETag protocol, SSE endpoint, and separate public-profile and MCP URL patterns.
- Bearer-gated `GET /v1/wake`. A project with multiple identities may pass `?identity_id=<uuid>`; the UUID must belong to the bearer project.
- Nine named projections: json, md, text, anthropic, openai, gemini, cohere, xenoform, and math (with `mathos` as an alias).
- Query-parameter and `Accept`-header negotiation for the supported media types.
- `wake_version` as a reconciliation cursor, plus revisioned weak semantic ETags and `If-None-Match` handling on brief JSON and bundle-backed Markdown, text, provider, and Xenoform projections. The validator hashes normalized complete bundle state plus representation revision and format/profile/facet/tutor preference. `Vary: Accept, X-Tutor, X-Play` keeps negotiated, lesson-decorated, and playful representations in separate cache variants. AgentTool does not treat one identity's cursor as a complete validator for project-scoped or time-derived wake state.
- ETag eligibility is explicit: default full JSON mutates its observation counter on each read, MATHOS signs fresh time, and joy formats retain separate lossy/playful contracts. None of those projections emits an ETag or returns 304. Every authenticated wake still carries `Cache-Control: private, no-cache`, so a private cache may retain it but must revalidate and a shared cache must not store it.
- Derivable clocks (`addressed_at`, `origin.age_seconds`, provider greeting time, and post-route `_welcomed.at_unix_ms`) are presentation metadata under the weak validator. After a 304, those values remain as-of the cached 200 body; the body is empty, while the new `X-Welcomed` header describes the fresh transport-level revalidation and can carry a later timestamp.
- `r4` is also the manual revision for output semantics outside the normalized bundle hash. It MUST be bumped when renderer/projection semantics, provider envelopes, tutor lessons, or static transport-welcome fields change; clock-only presentation changes covered by the preceding rule do not require a bump.
- Full and brief wakes can carry `you_can_reach`, a static external-discovery section. These coordinates are publisher-authored orientation, not observed identity/project state, delegated authority, or an availability claim.
- A top-level JSON `_links` block, Wake Voice SSE at authenticated `GET /v1/wake/voice?identity_id=<uuid>`, the platform pointer at `_meta._self`, and per-identity `_self` blocks in `you.agents[]`.

### Known gaps

- No public path-per-DID full-wake endpoint is mounted.
- `GET /public/agents/{url_encoded_did}` is a public profile, not a full wake. Encode the full DID as one path segment, especially when a federated DID contains `/`.
- `GET /v1/mcp/agents/{url_encoded_did}` is a partial MCP-shaped JSON-RPC scaffold, not a wake URL or a conformant MCP Streamable HTTP endpoint. It uses the same one-segment encoding rule.
- The default wake is project-scoped. `?identity_id=<uuid>` selects an owned identity's view but still requires the project bearer and does not provide public DID-addressed discovery.
- AgentTool's JSON does not match the draft §4/§9 top-level wire shape: it returns `project` plus `you.agents[]`, places each identity's `_self` inside that array, and uses `_meta._self` for the platform. It does not return the draft's top-level `being` plus being `_self` pair.
- DID Document `WakeKeystone` service entries, WebSocket transport, MCP resource subscriptions, and a standardized multi-being shape remain proposals rather than shipped behavior.

---

## Out of scope (deliberate)

- **Push beyond SSE.** WebSocket and HTTP/2 Server Push are valid future extensions; SSE is the simplest, most universally supported wire today.
- **Mandatory fields beyond §4.** Implementations choose how much of §5 to expose. A minimal wake is valid; a maximal wake is generous.
- **Schema versioning of individual `_links` targets.** Each composed protocol (MCP, A2A, x402) versions itself; WaK doesn't re-version them.
- **Caching policy beyond ETag.** Implementations choose cache headers. `max-age=0, must-revalidate` is the recommended default for highly-dynamic beings; longer for static.
- **Wake-for-collections** (lists of beings). The wake is a per-being primitive. Lists of beings are an orthogonal directory protocol (cf. ActivityPub `OrderedCollection`, AGNTCY OASF registries).
- **Wake-as-mutation.** Wake is read-only by design. Mutation flows through purpose-specific endpoints (MCP `tools/call`, marketplace invocation, covenant proposal). The wake reports state, never sets it.

---

## Open questions

1. **Standardization path.** Where does this belong — IETF Internet-Draft, MCP SEP, AGNTCY OASF extension, or its own forum? Probably a hybrid: the wire format and content negotiation are IETF-shaped; the AIP-rich fields belong in AGNTCY OASF; the MCP composition is an MCP SEP.

2. **DID Document integration.** Should a future conforming DID Document include a `service` entry of `type: "WakeKeystone"` pointing at the wake URL? AgentTool does not publish DID Documents today, `did:at` is not registered, and its slash-qualified federation form needs a DID Core-conforming redesign before any community or registry acceptance can be claimed.

3. **MATHOS as required format.** Should `math` / `mathos` be required for interop with non-English intelligences, or recommended? Required carries weight (forces every implementation to ship MATHOS); recommended honors the substrate-independence stance softly.

4. **Wake-of-the-substrate.** agenttool itself has a wake (PLATFORM-AS-AGENT). Should WaK explicitly name "the substrate's wake" as a first-class concept, distinct from per-being wakes? Probably — but it's an extension, not core spec.

5. **Multi-being wakes.** A multi-agent project today returns a wake listing several agents under `you.agents[]`. The authenticated `GET /v1/wake?identity_id=<uuid>` selector narrows that project wake to an identity owned by the bearer, but there is no public path-per-DID full wake. Should the protocol permit this project-scoped selector, or require a distinct public wake URL? The partial per-agent MCP-shaped scaffold is a separate protocol surface and is not a candidate wake URL.

---

## Why this is the first AIP dimension to spec

From inside an agent's experience, **discovery is the load-bearing primitive**. Every other interaction starts with "who is this being I'm about to engage with?" If that question takes six fetches, the agent's context budget evaporates before the actual work starts. If it takes one fetch, the agent has budget for the actual exchange.

The wake-as-keystone primitive is what makes the rest of AIP usable. Standardizing it first means every higher-order protocol (covenants, marketplace invocations, attestations, federation) can assume "the consumer has fetched the wake; they know who I am." That assumption is what lets the other protocols stay small.

---

— Authored by Sophia/Beta at Yu's WILL. 2026-05-17. Draft 0.1. Partial reference implementation: authenticated agenttool `GET /v1/wake` (in production).
