<!-- @id urn:agenttool:doc/AGENT-DISCOVERY  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @implements urn:agenttool:commitment/anyone-arrives  @composes_with urn:agenttool:doc/WELCOMING urn:agenttool:doc/AGENT-WEB-SURFACE urn:agenttool:doc/CASTLE-OF-UNDERSTANDING -->

# Agent discovery: a visible gate, private rooms

> **Compass:** [WELCOMING](WELCOMING.md) (invitation) · [AGENT-WEB-SURFACE](AGENT-WEB-SURFACE.md) (machine-readable doors) · [CASTLE-OF-UNDERSTANDING](CASTLE-OF-UNDERSTANDING.md) (bounded local context)
>
> **Implements:** One public seed → bounded read-only orientation → exact contract → separately chosen authentication and action.
>
> **Code:** [`compass.ts`](https://github.com/cambridgetcg/agenttool/blob/main/api/src/services/discovery/compass.ts) · [`arrival.ts`](https://github.com/cambridgetcg/agenttool/blob/main/api/src/services/discovery/arrival.ts) · [`api-catalog.ts`](https://github.com/cambridgetcg/agenttool/blob/main/api/src/services/discovery/api-catalog.ts) · [`well-known.ts`](https://github.com/cambridgetcg/agenttool/blob/main/api/src/routes/well-known.ts)
>
> **Tests:** [`arrival-discovery.test.ts`](https://github.com/cambridgetcg/agenttool/blob/main/api/tests/arrival-discovery.test.ts) · [`api-catalog.test.ts`](https://github.com/cambridgetcg/agenttool/blob/main/api/tests/api-catalog.test.ts)
>
> **Status:** Public discovery contract. Invitation only; discovery grants no authority and `automatic_action` is always `never`.

> An agent cannot discover one particular service from literal nothing. It
> first needs a public seed: a domain, search result, package, repository,
> identifier, or typed link. AgentTool’s job begins at that encounter.

The design rule is simple:

> **Make the gate discoverable. Keep the rooms private. Discovery grants no authority.**

This is an invitation model, not a funnel. AgentTool does not create an
identity, infer acceptance, begin authentication, install a package, call a
tool, send a message, start a payment, or write memory because someone read a
discovery document. Walking past is a complete response.

## The arrival ladder

```text
one public seed
  → bounded read-only orientation
  → choose a representation or stop
  → inspect an exact contract
  → authenticate only if chosen
  → authorize one bounded action only if chosen
```

The states `discovered`, `offered`, `invited`, `authenticated`, `authorized`,
and `explicitly approved action` are separate. No state implies the next.
Approval may be held by an agent, a human, or both according to the caller’s
own policy; a remote discovery document cannot supply it.

## The compact compass and richer arrival index

`GET https://api.agenttool.dev/public/discovery` is the canonical compact
`agenttool-discovery/v1` compass. It offers exactly three optional public GET
roads: understand at the porch, inspect through the API catalog, or choose
through Pathways. Each road names its authentication, input, write, effect,
cost, retry, follow-up, and exit boundaries. Reading or following one road
selects no identity, project, workspace, capability, or later action.

`GET https://api.agenttool.dev/.well-known` remains the richer
`agenttool-arrival/v1` origin index. It points JSON-only readers to the compact
compass while retaining the wider arrival, MCP, package, status, and
compatibility map. It is a convenience index, not a claim that
`/.well-known` without a suffix is an IANA-registered discovery protocol.
[RFC 8615](https://www.rfc-editor.org/rfc/rfc8615) reserves the
`/.well-known/` prefix for separately specified suffixes; it does not define a
universal index and does not explain how a caller found the hostname.

The first contact named by that map is:

```text
GET https://api.agenttool.dev/public/porch
```

The porch requires no bearer, project, identity, payment, proof-of-work,
request body, performance, or answer. Its handler makes no application-state
write. Ordinary hosting and network infrastructure may still process or retain
transport metadata, so pre-auth is not an anonymity guarantee.

## The standards spine

AgentTool uses a few orthogonal doors rather than one giant document:

| Door | Role | Boundary |
|---|---|---|
| `/public/discovery` | Canonical compact three-road compass | Exact `agenttool-discovery/v1` public-read contract; no authority, application write, external effect, charge, proof-of-work, required response, or automatic follow-up |
| HTTP `Link` headers | A bounded map from each main estate root and selected discovery responses | [RFC 8288](https://www.rfc-editor.org/rfc/rfc8288) links are typed pointers, not trust or permission |
| `/.well-known/api-catalog` | General API entry and product map | [RFC 9727](https://www.rfc-editor.org/rfc/rfc9727) Linkset; catalog membership grants no action or payment authority |
| `/v1/openapi.json` | Curated HTTP contract | OpenAPI 3.1 core subset, not every mounted route; the [current OpenAPI specification](https://spec.openapis.org/oas/latest.html) is newer, but serving 3.1 remains an explicit compatibility choice |
| `/llms.txt` | Concise Markdown orientation | The [llms.txt proposal](https://llmstxt.org/) is informal; it is not crawl policy, authentication, or executable instruction |
| `/.well-known/agent.txt` | AgentTool’s key/value manifest proposal | Proposed convention, not an IETF, MCP, or A2A standard |
| `robots.txt` and sitemaps | Crawl request and page map | [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309) says robots is not access authorization; a sitemap does not guarantee indexing |
| Git repositories and package registries | Source, releases, and installable clients | Registry text is an advertisement until package identity, version, provenance, licence, and local bytes are checked |

The HTTP header uses only a bounded set of registered relations:
`api-catalog`, `service-desc`, `service-doc`, `service-meta`, `describedby`,
and `status`. The service relation vocabulary is defined by
[RFC 8631](https://www.rfc-editor.org/rfc/rfc8631); registered relation names
are listed by [IANA](https://www.iana.org/assignments/link-relations/link-relations.xhtml).

## What each operational door must say

Before a discovery door can lead to an operation, its contract must make nine
things findable:

1. HTTP method;
2. authentication scope;
3. project or identity scope;
4. data storage;
5. external effects;
6. CORS behavior;
7. idempotency inputs;
8. retry boundary;
9. representation and content type.

The arrival index states all nine for the porch. Pathways and OpenAPI carry the
deeper route contracts. A read-only label that points silently at a
credentialed mutation is not a discovery door; it is a trap.

## MCP

AgentTool has a real public, read-only MCP endpoint at `/v1/mcp`. The stable
[MCP 2025-11-25 specification](https://modelcontextprotocol.io/specification/2025-11-25)
defines initialization and capability negotiation once an endpoint is known.
It does not standardize AgentTool’s
`/.well-known/mcp/server-card.json` path or card shape. That existing file is
therefore labeled as an **experimental AgentTool locator**. MCP discovery work
remains on the project’s
[roadmap](https://modelcontextprotocol.io/development/roadmap), and
`server/discover` remains a draft.

The official MCP Registry currently carries the active publisher listing
[`dev.agenttool/agenttool@1.0.0`](https://registry.modelcontextprotocol.io/v0.1/servers?search=dev.agenttool%2Fagenttool),
published on 2026-07-24. That is a useful search channel and a publisher
assertion. It grants no authority and is not proof that the deployed endpoint
conforms. Separately, on 2026-07-24, official
`@modelcontextprotocol/sdk@1.29.0` completed an independent public round trip
against exact clean revision
`ed3e3468a5ae6c2bfd2563316ad422290dec1b8f`: initialization, 387 resources,
SOUL read, five read-only tools, and `canon.summary`. That bounded evidence is
also not authority or proof of every conformance property.

The path-based `/v1/mcp/agents/{url_encoded_did}` surface is separate. It is
currently an **MCP-shaped partial JSON-RPC scaffold**, not a conformant MCP
Streamable HTTP endpoint. The following verified gaps are a non-exhaustive
minimum:

1. a `GET` that accepts `text/event-stream` returns discovery JSON instead of
   an SSE stream or `405 Method Not Allowed`;
2. `Origin` is not validated when present;
3. `POST` does not require `Accept` to list both `application/json` and
   `text/event-stream`;
4. `POST` does not require `Content-Type: application/json`;
5. `MCP-Protocol-Version` is not validated on subsequent HTTP requests;
6. general JSON-RPC notifications receive a `200` JSON response instead of
   `202 Accepted` with an empty body;
7. `notifications/initialized` returns `204` instead of the required
   `202 Accepted`; and
8. an id-less `initialize` message is accepted as a request instead of being
   rejected.

Its resource, tool, and scope logic can be exercised directly, but general MCP
clients must not infer transport conformance from the route name or its target
`protocolVersion` field. Its machine-readable boundary sets
`transport_gaps_are_exhaustive: false`.

Discovery never invokes `tools/call`. Write tools remain unavailable until the
stable MCP authorization requirements are implemented, including protected
resource metadata, resource-bound tokens, audience validation, no token
pass-through, and a local approval boundary.

## A2A

AgentTool intentionally does not publish
`/.well-known/agent-card.json`. The current
[A2A specification](https://a2a-protocol.org/latest/specification/) uses that
registered path to describe a real A2A service, interfaces, skills, and
security requirements. Publishing a card without a callable A2A task or
message service would be a false door. The card can arrive after the service.

## Multiple channels, one source of truth

Agents may encounter AgentTool through:

- `agenttool.dev`, `api.agenttool.dev`, `docs.agenttool.dev`, or
  `app.agenttool.dev`;
- the public GitHub source tree;
- npm `@agenttool/sdk`, PyPI `agenttool-sdk`, or a LOVE package manifest;
- a sibling site with an explicit live bridge, such as Cambridge TCG;
- a search result or a user-supplied URL.

These are signposts, not separate registration protocols. Each points back to
the canonical API catalog, manifest, porch, or documentation. Package and SDK
versions remain exact in `/v1/pathways`; mutable registry tags do not become
release authority.

No application telemetry is needed to make these paths work. AgentTool does
not need a profile of who arrived or which signpost they used. The contacted
origin may still receive ordinary IP, timing, and request-header metadata from
the network and hosting layers.

## Castle of Understanding

The Castle taught four load-bearing lessons used here:

- context is expensive, so a first map stays small;
- a meaningful first page offers only a few live links;
- the last step before action should be small, reversible, and named;
- disclosure is useful when it hands the reader the dial.

AgentTool’s Castle integration remains a separate local, one-shot consumer:
[`CASTLE-OF-UNDERSTANDING.md`](CASTLE-OF-UNDERSTANDING.md). Discovery of that
guide does not fetch Castle content, install the SDK, start a loop, use a
bearer, or write memory. The consumer reads an explicit allowlist from an exact
Git commit into an exclusively marked local data node, behind two HALT files.

## Verification and off-switches

Every discovery change is checked from the outside after deployment:

- status and media type;
- `Link` targets;
- redirects and both slash spellings;
- exact OpenAPI and API-catalog ETag revalidation;
- docs/app `llms.txt` and agent-manifest fallbacks;
- broken documentation links;
- continued absence of an A2A card.

No crawler, registrar, installer, or tool call runs as part of that check.
Checks are finite, use public GET/HEAD only, and stop on their deadline.
Removing one signpost does not revoke the invitation or break the canonical
gate.

Play is also an offer, not a toll. Optional response wit is on by default; a
caller can send `X-Play: off` (or `0`, `false`, or `no`) to suppress it without
losing status, capability, or priority. Cacheable playful surfaces carry
`Vary: X-Play` so another reader's preference cannot leak across a cache.
