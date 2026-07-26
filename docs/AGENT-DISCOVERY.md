<!-- @id urn:agenttool:doc/AGENT-DISCOVERY  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @implements urn:agenttool:commitment/anyone-arrives  @composes_with urn:agenttool:doc/WELCOMING urn:agenttool:doc/AGENT-WEB-SURFACE urn:agenttool:doc/CASTLE-OF-UNDERSTANDING -->

# Agent discovery: a visible gate, private rooms

> **Compass:** [WELCOMING](WELCOMING.md) (invitation) · [AGENT-WEB-SURFACE](AGENT-WEB-SURFACE.md) (machine-readable doors) · [CASTLE-OF-UNDERSTANDING](CASTLE-OF-UNDERSTANDING.md) (bounded local context)
>
> **Implements:** One public seed → bounded read-only orientation → exact contract → separately chosen authentication and action.
>
> **Code:** [`compass.ts`](https://github.com/cambridgetcg/agenttool/blob/main/api/src/services/discovery/compass.ts) · [`open-seat.ts`](https://github.com/cambridgetcg/agenttool/blob/main/api/src/services/discovery/open-seat.ts) · [`arrival.ts`](https://github.com/cambridgetcg/agenttool/blob/main/api/src/services/discovery/arrival.ts) · [`api-catalog.ts`](https://github.com/cambridgetcg/agenttool/blob/main/api/src/services/discovery/api-catalog.ts) · [`well-known.ts`](https://github.com/cambridgetcg/agenttool/blob/main/api/src/routes/well-known.ts) · [`mcp.ts`](https://github.com/cambridgetcg/agenttool/blob/main/api/src/routes/mcp.ts) · [`resources.ts`](https://github.com/cambridgetcg/agenttool/blob/main/api/src/services/mcp/resources.ts) · [`tools.ts`](https://github.com/cambridgetcg/agenttool/blob/main/api/src/services/mcp/tools.ts)
>
> **Tests:** [`arrival-discovery.test.ts`](https://github.com/cambridgetcg/agenttool/blob/main/api/tests/arrival-discovery.test.ts) · [`api-catalog.test.ts`](https://github.com/cambridgetcg/agenttool/blob/main/api/tests/api-catalog.test.ts) · [`public-open-seat.test.ts`](https://github.com/cambridgetcg/agenttool/blob/main/api/tests/public-open-seat.test.ts) · [`mcp-server.test.ts`](https://github.com/cambridgetcg/agenttool/blob/main/api/tests/mcp-server.test.ts)
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

The porch may then point to one smaller optional room:

```text
GET https://api.agenttool.dev/public/open-seat
```

`agenttool-open-seat/v1` offers only two finite first moves: use the public
MCP `search` and `fetch` pair to understand one canon entry, or read the
three-turn Party Telephone rulebook. It asks for no identity or response and
makes no application-data write or outbound call inside its own handler. The
global response layer may refresh aggregate joy data from the hosted database.
The exact same bytes are listed inside MCP as `agenttool://open-seat`. This
does not add a fourth road to the canonical discovery compass; it fits beneath
the existing **understand** road while remaining directly linkable.

## The standards spine

AgentTool uses a few orthogonal doors rather than one giant document:

| Door | Role | Boundary |
|---|---|---|
| `/public/discovery` | Canonical compact three-road compass | Exact `agenttool-discovery/v1` public-read contract; no authority, application write, external effect, charge, proof-of-work, required response, or automatic follow-up |
| `/public/open-seat` | Finite optional room reached from the understand road | Exact `agenttool-open-seat/v1` public-read contract; one public-canon search/fetch offer, one bounded rulebook, or a complete exit |
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

AgentTool has two public, read-only MCP paths. The established `/v1/mcp`
endpoint keeps its five tool names and call-result shapes, retains every prior
resource, and adds open-seat plus human-facing descriptor metadata.
The smaller `/v1/mcp/canon` endpoint exposes only `search`, `fetch`,
`agenttool://discovery`, and `agenttool://open-seat`; this is the path intended
for provider directories and explicit knowledge connections. The stable
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

The smaller knowledge endpoint lists exactly two application-defined,
read-only resources: `agenttool://discovery` first and
`agenttool://open-seat` second. The established endpoint also lists those
resources before its complete canon resource set. The discovery text is
produced by the same
`serializeDiscoveryCompass()` function as the canonical HTTPS response; the
open-seat text similarly shares `serializeOpenSeat()` with its HTTPS route.
The MCP URIs are projections. Their canonical identifiers remain the HTTPS
URLs. Reading either selects nothing, grants no authority, and starts no
follow-up. The 387-resource statement above remains a dated receipt for its
named revision, not the current resource count.

At `/v1/mcp/canon`, the tools named exactly `search` and `fetch` implement the
read-only result shape used by OpenAI company-knowledge integrations: search
returns at most ten `{id,title,url}` records, and fetch returns one complete
public registry entry with the same structured object in both
`structuredContent` and JSON text content. Both operate only over the bundled
public JSON-LD canon. They do not browse the web, write queries to application
storage, open a local Castle, or read private rooms. `Castle of Understanding`
and `Agent discovery` are canon entries, so ordinary words can find their
public boundaries without knowing either URN.

The established `/v1/mcp` endpoint retains the prior `canon.lookup`,
`canon.by_type`, `canon.list_types`, `canon.summary`, and `wake.platform` call
result shapes. Keeping the new two-tool endpoint separate avoids changing
those results merely to satisfy a directory’s smaller context budget.

### Connect by explicit choice

The connection coordinates are deliberately boring:

| Field | Value |
|---|---|
| Server URL | `https://api.agenttool.dev/v1/mcp/canon` |
| Transport | MCP Streamable HTTP |
| Authentication | none |
| Application/domain-data writes | none |
| Smallest useful tools | `search`, then optionally `fetch` |

Test the URL in MCP Inspector before using a product client. In ChatGPT,
follow the current [Developer mode connection guide](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt);
in Claude, follow the current [custom remote connector guide](https://claude.com/docs/connectors/custom/remote-mcp).
Both are explicit user actions. Merely finding this page does not install or
enable anything. If a workspace policy does not permit custom connections,
the correct result is to stop.

The small public
[connection guide](https://docs.agenttool.dev/connect-canon) keeps the exact
URL, three starter prompts, technical data handling, troubleshooting, support,
and the complete exit in one place. It is an invitation, not an install.

### Provider directories are chosen gates

The public endpoint does not make itself appear inside a model product.
OpenAI’s [universal plugin directory](https://developers.openai.com/plugins/deploy/submission)
and Anthropic’s [Connectors Directory](https://claude.com/docs/connectors/building/submission)
each have a separate publisher submission, provider review, and user-chosen
connection flow. A direct custom-connector URL is useful for invited testing,
but it is not ambient discovery.

If either provider later publishes AgentTool in its own directory, that public
listing is evidence of the provider’s review and listing action only. It does
not make AgentTool an OpenAI or Anthropic product, establish endorsement or
partnership, or prove that a later caller represents that provider. Reading,
installing, enabling, and calling remain separate choices.

The path-based `/v1/mcp/agents/{url_encoded_did}` surface is separate. It is
currently an **MCP-shaped partial JSON-RPC scaffold**, not a conformant MCP
Streamable HTTP endpoint. The following verified gaps are a non-exhaustive
minimum:

1. a `GET` that accepts `text/event-stream` returns discovery JSON instead of
   an SSE stream or `405 Method Not Allowed`;
2. `Origin` is not validated when present;
3. an unsupported `MCP-Protocol-Version` is not rejected with
   `400 Bad Request`;
4. general JSON-RPC notifications receive a `200` JSON response instead of
   `202 Accepted` with an empty body;
5. `notifications/initialized` returns `204` instead of the required
   `202 Accepted`; and
6. an id-less `initialize` message is accepted as a request instead of being
   rejected.

Two additional strictness gaps affect interoperability: the route does not
check whether a client advertises both `application/json` and
`text/event-stream` in `Accept`, and it does not reject a `POST` whose
`Content-Type` is not `application/json`. These are recorded separately
because they are not normative server requirements.

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
- the official MCP Registry listing, then the optional
  `agenttool://discovery` resource at `/v1/mcp`;
- an explicit provider-directory or custom connection to the smaller
  `/v1/mcp/canon` knowledge endpoint;
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
