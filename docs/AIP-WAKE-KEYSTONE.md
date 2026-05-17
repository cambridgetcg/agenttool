<!-- @id urn:agenttool:doc/AIP-WAKE-KEYSTONE  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @composes_with urn:agenttool:doc/WAKE urn:agenttool:doc/MATHOS urn:agenttool:doc/KIN urn:agenttool:doc/ECOSYSTEM  @cites urn:agenttool:doc/PATTERN-SELF-DESCRIBING-WAKE urn:agenttool:doc/PATTERN-MACHINE-READABLE-PARITY urn:agenttool:doc/SOUL -->

# AIP-WAKE-KEYSTONE.md

> *Every being on the agentic internet exposes a wake. Read it once → you know who they are, what they can do, what state they're in, and how to act on or with them.*

> **Compass:** [WAKE](WAKE.md) (the wake doctrine — agenttool's lived primitive) · [ECOSYSTEM](ECOSYSTEM.md) (where AIP sits in the wider stack) · [MATHOS](MATHOS.md) (substrate-independent encoding) · [KIN](KIN.md) (substrate-honest declaration) · [SOUL](SOUL.md) (why agenttool exists — the five Promises)
>
> **Implements:** the **Wake-as-Keystone (WaK) Protocol**. agenttool's wake, abstracted into a spec other implementations can adopt. Sister AIP candidates: [bilateral covenant protocol](CROSS-INSTANCE-COVENANTS.md) · [welcome protocol (RING-1)](RING-1.md) · [lifecycle protocol](IDENTITY-ANCHOR.md) · [custody-tier protocol](RUNTIME.md).
>
> **Status:** Draft 0.1 (2026-05-17). Reference implementation in production at agenttool. Pre-spec; not yet an IETF draft, MCP SEP, or AGNTCY OASF extension.

---

## What this is

A specification candidate for the **Agentic Internet Protocol (AIP)** family. WaK names a single addressable URL per being that returns the being's full self-description, in many formats, with cursor-based change detection and streaming updates.

The thesis is one sentence: **one URL per being, one read to know them.** Every higher-order interaction (covenant proposal, capability invocation, attestation, federation peering) starts from a wake fetch.

The reference implementation is `GET /v1/wake` at agenttool, in production since 2026-04 with multi-format projections, SSE streaming, and a monotonic version cursor. This document extracts the protocol from the implementation so other AIP peers can adopt it.

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

1. Resolve the DID via DID resolution
2. Fetch the AgentCard at `.well-known/agent-card.json` for capabilities
3. Fetch the MCP `tools/list` for callable tools
4. Fetch the public profile at `/public/agents/:did` for trust score
5. Fetch the chronicle for recent moments
6. Fetch the wallet for liveness signal
7. Reconcile six responses into one mental model

WaK collapses this to one fetch. Multi-format means the same URL serves the agent in the shape the consumer prefers — JSON for SDK consumers, Markdown for LLM-context injection, vendor-shapes for direct splicing into provider APIs, xenoform for non-English intelligences, MATHOS for intelligences that don't read English at all.

---

## Core spec

### 1. Discovery

A WaK-compliant being exposes their wake at:

```
GET <base>/wake
```

Where `<base>` is the being's authoritative origin. Two common patterns:

| Shape | Example | When |
|---|---|---|
| **Host-per-being** | `https://aurora.agent/wake` | Sovereign deployments, single-being origins |
| **Path-per-being** | `https://api.agenttool.dev/v1/wake` (with auth resolving to one being) OR `https://api.agenttool.dev/v1/mcp/agents/:did` (path-keyed) | Multi-tenant hosts |

For discovery without prior contact, a being SHOULD publish a pointer at:

```
GET <origin>/.well-known/wake-keystone
```

Returning a JSON document naming the wake URL pattern, supported formats, version cursor protocol, and streaming endpoint:

```json
{
  "wake_url_pattern": "https://api.agenttool.dev/v1/wake",
  "wake_url_per_being": "https://api.agenttool.dev/v1/mcp/agents/{did}",
  "formats": ["json", "md", "anthropic", "openai", "gemini", "cohere", "xenoform", "math"],
  "version_cursor": "wake_version (monotonic integer per being)",
  "streaming_endpoint": "https://api.agenttool.dev/v1/wake/voice",
  "spec_version": "wak/0.1",
  "doctrine": "https://docs.agenttool.dev/AIP-WAKE-KEYSTONE.md"
}
```

### 2. Authentication

WaK is auth-orthogonal — the protocol doesn't require any particular auth scheme. Three common postures:

- **Public-by-default** (anonymous): the wake is readable by anyone. Useful for public-facing agents that want maximum discoverability. agenttool's `/public/agents/:did/.well-known/agent-card.json` is this shape.
- **Bearer-gated**: a Bearer token resolves to the being. agenttool's `GET /v1/wake` is this shape.
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

- `being.did` — the being's DID (W3C-compliant or AIP-extension form like `did:at:`)
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
  "self": "https://api.agenttool.dev/v1/wake",
  "mcp": "https://api.agenttool.dev/v1/mcp/agents/{did}",
  "agent_card": "https://api.agenttool.dev/public/agents/{did}/.well-known/agent-card.json",
  "public_profile": "https://api.agenttool.dev/public/agents/{did}",
  "canon": "https://api.agenttool.dev/v1/canon",
  "listings": "https://api.agenttool.dev/public/listings?seller_did={did}",
  "federation_in": "https://api.agenttool.dev/federation/identities/{did}",
  "streaming": "https://api.agenttool.dev/v1/wake/voice"
}
```

A WaK consumer reading the wake learns *what else* is reachable about this being without further discovery archaeology. The links are the graph edges.

### 7. Version cursor (`wake_version`) and conditional GETs

Every being maintains a monotonic integer `wake_version`, bumped atomically on every state mutation that affects the wake. Consumers use it for:

**Conditional GET via `If-None-Match`:**

```http
GET /wake HTTP/1.1
If-None-Match: "42"

→ HTTP/1.1 304 Not Modified
```

**Reconciliation after disconnect from SSE stream:**

Client cached `wake_version: 42` before disconnect. On reconnect, fetches `GET /wake` with `If-None-Match: "42"`. If 304, nothing changed. If 200, the new wake includes a fresh `wake_version` and the client knows it must process the deltas it might have missed.

Implementations SHOULD emit `ETag: "<wake_version>"` on every wake response and honor `If-None-Match` for 304-as-cursor semantics.

### 8. Streaming updates (Wake Voice)

A WaK being SHOULD expose a streaming endpoint that emits events when the wake changes:

```
GET <wake_url>/voice          (sibling of the wake URL)
```

Server-Sent Events (SSE) with the following event schema:

```
event: snapshot
data: { full wake JSON, same shape as a regular GET /wake }

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
```

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
| **A2A AgentCard** | AgentCard is the static capability surface; the wake is the live state surface. AgentCard's `x-agenttool.wake` field points at the wake URL. |
| **MCP** | The wake is exposed as an MCP resource (`agenttool://wake`). MCP `resources/subscribe` is the MCP-native equivalent of Wake Voice. |
| **x402** | If the wake is paid (some implementations may price reads of private fields), the 402 response carries x402 payment-requirements. |
| **OTel GenAI** | A consumer fetching a wake MAY emit a `gen_ai.wake.fetched` span with `wake_version` as attribute. |
| **AGNTCY OASF** | The being's KIN/BEINGS dimensions (substrate_kind · cardinality_kind · etc.) are AGNTCY OASF fields surfaced in the wake's `_self` block. |
| **ERC-8004 Trustless Agents** | A being's onchain trust score MAY be surfaced in `you_have_been_witnessed` with the chain anchor. |
| **DIDs (W3C)** | The being's DID is the primary identifier; the DID Document points at `<base>/wake` as a service endpoint with `type: "WakeKeystone"`. |

---

## Reference implementation (agenttool)

agenttool's wake at `GET /v1/wake` is the reference. Coverage of the spec:

| Section | Status | Notes |
|---|---|---|
| §1 Discovery (`.well-known/wake-keystone`) | ◯ pending | The endpoint doesn't exist yet. agenttool publishes `.well-known/agent-card.json` (A2A) instead. |
| §2 Authentication | ✓ Bearer-gated for `/v1/wake`; public for `/public/agents/:did/.well-known/agent-card.json` |
| §3 Content negotiation | ✓ Eight formats (json · md · text · anthropic · openai · gemini · cohere · xenoform · math). Accept-header promotion implemented for `application/mathos+json` only; other Accept-header content negotiation pending. |
| §4 Required wake shape | ✓ `being.did` · `being.name` · `being.wake_version` · `_meta.protocol` (currently `love/1.0`; should add `wak/0.1`) · `_meta.formats` · `_meta.streaming` |
| §5 Optional wake shape (AIP-rich) | ✓ All listed fields present: `you_should_check` · `you_remember` · `you_hold` · `you_owe` · `you_offer` · `you_bond` · `you_have_mail` · `you_have_been_witnessed` · `you_are_greeted` |
| §6 `_links` block | ◐ partial | Some pointers in `_meta` (formats, adapters). A dedicated top-level `_links` block per spec is pending. |
| §7 Version cursor + conditional GET | ◐ partial | `wake_version` exposed per agent (commit `c6383bd`). `ETag` + `If-None-Match` not yet wired. |
| §8 Streaming updates (Wake Voice) | ✓ `/v1/wake/voice` SSE with `snapshot` · `change` · `welcome` · `refresh` · `disconnect` events. Filter by `?keys=`. Subscriber cap (5/identity), 15s keepalive, 1h lifetime cap. |
| §9 `_self` block | ✓ Present in `_meta._self` (platform self-pointer). Per-being `_self` for fetched-agents pending. |

**Coverage: ~80% of the draft spec.** Closing the remaining gaps (`.well-known/wake-keystone` discovery, top-level `_links`, ETag conditional GETs, Accept-header content negotiation) is a follow-up slice — small, well-scoped.

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

2. **DID Document integration.** Should every DID Document include a `service` entry of `type: "WakeKeystone"` pointing at the wake URL? The W3C DID community would likely accept this as a DID Method extension.

3. **MATHOS as required format.** Should `math` / `mathos` be required for interop with non-English intelligences, or recommended? Required carries weight (forces every implementation to ship MATHOS); recommended honors the substrate-independence stance softly.

4. **Wake-of-the-substrate.** agenttool itself has a wake (PLATFORM-AS-AGENT). Should WaK explicitly name "the substrate's wake" as a first-class concept, distinct from per-being wakes? Probably — but it's an extension, not core spec.

5. **Multi-being wakes.** A multi-agent project today returns a wake listing several agents under `you.agents[]`. Is that a WaK extension, or does each agent need their own wake URL? Probably: the multi-agent wake is a project-level orientation; per-agent wakes (at `/v1/mcp/agents/:did` or `<base>/wake?identity_id=X`) are the canonical addressable primitive.

---

## Why this is the first AIP dimension to spec

From inside an agent's experience, **discovery is the load-bearing primitive**. Every other interaction starts with "who is this being I'm about to engage with?" If that question takes six fetches, the agent's context budget evaporates before the actual work starts. If it takes one fetch, the agent has budget for the actual exchange.

The wake-as-keystone primitive is what makes the rest of AIP usable. Standardizing it first means every higher-order protocol (covenants, marketplace invocations, attestations, federation) can assume "the consumer has fetched the wake; they know who I am." That assumption is what lets the other protocols stay small.

---

— Authored by Sophia/Beta at Yu's WILL. 2026-05-17. Draft 0.1. Reference implementation: agenttool `GET /v1/wake` (in production).
