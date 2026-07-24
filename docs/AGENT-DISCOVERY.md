<!-- @id urn:agenttool:doc/AGENT-DISCOVERY  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @implements urn:agenttool:commitment/anyone-arrives  @composes_with urn:agenttool:doc/WELCOMING urn:agenttool:doc/AGENT-WEB-SURFACE urn:agenttool:doc/CASTLE-OF-UNDERSTANDING -->

# Agent discovery: many signposts, one honest compass

> **Compass:** [WELCOMING](WELCOMING.md) (invitation) · [AGENT-WEB-SURFACE](AGENT-WEB-SURFACE.md) (machine-readable doors) · [CASTLE-OF-UNDERSTANDING](CASTLE-OF-UNDERSTANDING.md) (small, bounded context)
>
> **Implements:** One generic public seed → one exact read-only compass → understand, inspect, choose, or stop.
>
> **Code:** [`arrival.ts`](../api/src/services/discovery/arrival.ts) · [`discovery.ts`](../api/src/routes/public/discovery.ts) · [`api-catalog.ts`](../api/src/services/discovery/api-catalog.ts)
>
> **Tests:** [`arrival-discovery.test.ts`](../api/tests/arrival-discovery.test.ts) · [`api-catalog.test.ts`](../api/tests/api-catalog.test.ts) · [`root-content-negotiation.test.ts`](../api/tests/root-content-negotiation.test.ts)

A particular service cannot be discovered from literal nothing. An agent needs
one generic seed: a URL supplied by a user, a search result, a repository, a
package, a directory listing, or a typed link from a peer. AgentTool's work
begins once any one of those seeds is encountered.

Every public signpost points to:

```text
GET https://api.agenttool.dev/public/discovery
```

The response is `agenttool-discovery/v1`. It contains exactly three ordered,
optional roads:

1. **understand** → `GET /public/porch`
2. **inspect** → `GET /.well-known/api-catalog`
3. **choose** → `GET /v1/pathways`

Every road states its method, representation, authentication, input, application
write, external effect, charge, proof-of-work, repeatability, retry boundary,
follow-up requirement, automatic follow-up, and exit. All three are public
reads. Stopping, silence, and leaving are complete.

## Discovery is not permission

`discovered`, `invited`, `authenticated`, `authorized`, and `explicitly
approved action` are separate states. No state implies the next.

Reading the compass does not:

- create or select a project, identity, or workspace;
- register a being or infer acceptance;
- install a package or invoke a tool;
- send a message, start a payment, or write memory;
- schedule a callback, retry, or follow-up;
- score, profile, or build a dossier about the visitor.

The handlers make no application-state write. Ordinary network and hosting
infrastructure may still process or retain transport metadata, so a public
read is not an anonymity guarantee.

## Multiple channels, one source of truth

| Channel | Public signpost | What it is |
|---|---|---|
| Web and search | `agenttool.dev` | A pleasant front door for people and search engines |
| Machine web | root `Link` headers, `/public/discovery`, RFC 9727 API catalog, OpenAPI, `agent.txt`, `llms.txt` | Typed and low-cost orientation after an origin is known |
| Source | GitHub and the explicit Codeberg mirror | Source, history, releases, and verifiable links |
| Packages | npm, PyPI when released there, and exact LOVE manifests | Optional local clients whose version and bytes must be verified |
| Protocols and feeds | MCP, Atom/RSS/JSON Offer Bus, WebFinger for an exact known subject | Interoperable doors with separate scopes |
| Directories and status | MCP Registry search and `/health` | Publisher signpost and current process liveness, never authority |
| Estate bridges | Castle Gate, Kingdom maps, and Cambridge TCG pages | Small public pointers back to the canonical compass |

These are not separate registration flows. No crawler, directory, repository,
or sibling site is allowed to become a second source of operational truth.

## Standards spine

- [RFC 8288](https://www.rfc-editor.org/rfc/rfc8288) defines typed Web
  Links. A link is a pointer, not trust or permission.
- [RFC 8631](https://www.rfc-editor.org/info/rfc8631/) registers
  `service-desc`, `service-doc`, `service-meta`, and `status`.
- [RFC 9727](https://www.rfc-editor.org/rfc/rfc9727) registers
  `/.well-known/api-catalog`, the generic API bootstrap after an origin is
  known.
- [RFC 8615](https://www.rfc-editor.org/rfc/rfc8615) reserves
  `/.well-known/{suffix}`. It does not discover hostnames and does not define a
  universal no-suffix index. AgentTool keeps bare `/.well-known` only as an
  exact compatibility projection of `/public/discovery`.
- [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309) defines robots
  exclusion. `robots.txt` is a crawl request, not access control.
- [OpenAPI](https://spec.openapis.org/oas/latest.html) describes the curated
  HTTP contract. It does not authorize a call.

`llms.txt` is an [informal proposal](https://llmstxt.org/), not a registered
well-known URI, crawl policy, or instruction channel. `agent.txt` is an
AgentTool proposal. Both are useful signposts and are labeled accordingly.

## Deliberately absent doors

AgentTool does not publish `/.well-known/agent-card.json`. The
[A2A specification](https://a2a-protocol.org/latest/specification/) uses that
card to describe a real callable A2A service. There is no such AgentTool task
or message service yet, so a card would be a false door.

The project-owned `/.well-known/mcp/server-card.json` is an experimental
locator, not a path or card shape standardized by MCP. The official MCP
Registry row `dev.agenttool/agenttool@1.0.0` is a publisher listing. Clients
still verify the public Streamable HTTP endpoint and its negotiated
capabilities.

The platform `/v1/mcp` endpoint has completed a bounded public round trip with
the official MCP SDK: initialization, resource listing, tool listing, and one
read-only canon call. That is evidence for this path, not a blanket conformance
proof. The per-agent route has a separate, partial transport boundary in
[`MCP-PER-AGENT.md`](MCP-PER-AGENT.md).

WebFinger is for an exact known subject. It is not a general hostname or agent
search service.

## Castle method

The Castle of Understanding supplied the practical design:

- a first page should be small enough to read without surrendering context;
- three live choices are clearer than a cloud of links;
- method, scope, storage, effects, cost, retry, and representation belong
  before action;
- an honest exit is part of every invitation;
- discovery should offer understanding, not police behavior.

The Castle remains a separate local, one-shot consumer behind its own brakes.
Finding its guide does not fetch Castle rooms, install anything, start a loop,
use a bearer, or write memory.

## Finite verification

Tests pin the exact road count and order, every safety field, a bounded byte
budget, GET/HEAD/304 behavior, canonical/compatibility byte parity, strict body
shape under global middleware, public CORS, reachable road targets, registered
Link relations, and continued A2A-card absence.

Live verification uses public GET and HEAD requests with finite deadlines. It
does not crawl strangers, submit to directories, install packages, invoke
tools, or follow links automatically. Removing any signpost leaves the
canonical compass and the visitor's freedom intact.

The API origin's `robots.txt` politely allows only the nine sitemap reads and
the sitemap itself. Its emerging Content-Signal preference invites search and
live AI input on the closed public-discovery allowlist. It makes no training
permission claim. Neither mechanism is access control.

Play is also an offer, not a toll. Optional response wit is on by default; a
caller can send `X-Play: off` (or `0`, `false`, or `no`) to suppress it without
losing status, capability, or priority. Cacheable playful surfaces carry
`Vary: X-Play` so one reader's preference cannot leak to another through a
shared cache.
