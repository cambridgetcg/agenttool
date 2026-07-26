# Agent Search 0.1

> **Compass:** [AGENT-DISCOVERY](AGENT-DISCOVERY.md) (orientation after a public seed) · [AGENT-BROWSER](AGENT-BROWSER.md) (bounded interaction) · [PROTOCOL-RENAISSANCE](PROTOCOL-RENAISSANCE.md) (old-internet search virtues) · [MARKETPLACE](MARKETPLACE.md) (AgentTool listings) · [LOVE-PACKAGE-PROTOCOL](LOVE-PACKAGE-PROTOCOL.md) (distribution is not authority)
>
> **Implements:** Source-only `@agenttool/search@0.1.0-dev.0` developer preview; local `agenttool-search/v0.1` search facade over fixed providers, Telescope 0.2.3 inspection, and Browser 0.3 consequence planning/navigation. No npm/LOVE/GitHub release or hosted service.
>
> **Code:** `packages/search/src/` · `packages/search/schema/` · `packages/browser/src/` · `packages/telescope/src/`
>
> **Tests:** `packages/search/tests/` · `packages/browser/tests/` · `packages/telescope/tests/`

## The decision

Agents benefit from a search surface shaped for their workflow, but AgentTool
does not need a new global crawler and index to prove that point.

The 0.1 preview is a narrow local facade. It reuses existing public search
infrastructure, preserves transport evidence, merges provider positions
deterministically, and turns a selected result into one of three explicit next
steps: read-only Telescope inspection, zero-effect Browser consequence
planning, or Browser navigation. The facade is
useful because ordinary web search responses often collapse source,
publisher claim, rank, URL, and suggested action into one blob. Its contract
keeps those distinctions visible to an agent.

Building a custom index remains a later evidence-based decision. It would add
crawl policy, robots and cache semantics, freshness, abuse controls, deletion
and correction handling, jurisdictional obligations, ranking governance, and
substantial hosted egress. Version 0.1 first measures what fixed upstream
adapters plus agent-native workflow affordances can do.

The namespace boundary is intentional: `agenttool-search/v0.1` finds candidate
public seeds across providers. The existing `agenttool-discovery/v1` compass
orients an agent after it already knows an AgentTool origin. Telescope 0.2.3
observes that compass and related fixed public surfaces; Search does not replace
or redefine it.

## Architecture

```text
agent_search(query)
        │  query disclosed
        ├───────────────┬────────────────────┐
        ▼               ▼                    │
AgentTool marketplace   Official MCP Registry│
fixed public GET        fixed public GET     │
        └───────┬───────┘                    │
                ▼                            │
    transport evidence + untrusted claims    │
                ▼                            │
      normalize · deduplicate · RRF           │
                ▼                            │
 query-redacted results + opaque handles      │
                │                            │
                  explicit caller selection
          ┌───────────────┼──────────────────┐
          ▼               ▼                  ▼
 agent_inspect   browser_plan_result  browser_open_result
 Telescope 0.2.3 Browser 0.3 plan     Browser 0.3
 fixed probes    local, zero-effect   one navigation attempt
          └──────────── no implicit action ───────────────┘
```

There is one process-local `SearchEngine` session. Search adapters have no
Browser reference and cannot navigate. `SearchSession` alone composes the
engine with Telescope and Browser, so the follow-up boundary is visible in
code and in the four Search-specific tool names.

The stdio MCP surface adds `agent_search`, `agent_inspect`,
`browser_plan_result`, and `browser_open_result` to Browser's existing nine
tools. The JSONL surface exposes the same thirteen operations under
`agenttool-search-jsonl/0.1`. Neither transport adds a hosted route.

The MCP surface also adds one static
`agenttool://search/discovery-flight` resource and one opt-in
`discovery_flight` prompt with a `query` argument. They describe a compact
preflight → search → local shortlist → explicit inspect/plan/open-or-stop
journey over the existing tools. Once the composed MCP process is running,
their handlers dispatch no additional provider, Telescope, or Browser
operation. The bounded query is JSON-encoded as data inside the prompt, and the
guide requires another explicit choice before every follow-up. Neither surface
changes the thirteen-tool or JSONL contracts. The current Search CLI still
launches Browser before serving MCP, including a guide-only client session.
In the stock CLI process, following the flight may disclose the query to
`agenttool_marketplace` and `mcp_registry` unless the caller explicitly
chooses narrower `provider_ids`. Provider logging and retention have not been
evaluated. The static guide cannot inventory a library-built server's custom
providers: that deployment must supply trusted provider IDs, supported result
kinds, and credential boundaries before dispatch, or the flight stops.

The composed MCP deliberately extends Browser 0.3's public server builder.
Consequently the initialize response and base instructions still identify
`agenttool-browser@0.3.0`, while the Search CLI and advertised tool set
contain all thirteen operations. Giving the composite a distinct initialize
identity requires a future public metadata seam in Browser's builder. Version
0.1 does not reach into private MCP SDK state or fork and reimplement Browser's
tool registration to change a label.

## Fixed provider adapters

The default process installs two adapters:

| Provider | Fixed public request | Boundary |
|---|---|---|
| `agenttool_marketplace` | `GET https://api.agenttool.dev/public/listings?q=…&limit=…` | Finds public capability listings. Listing fields are publisher-controlled. Search does not fetch a quote, invoke a listing, seal input, escrow funds, or settle. |
| `mcp_registry` | `GET https://registry.modelcontextprotocol.io/v0.1/servers?search=…&limit=…&version=latest[&cursor=…]` | Finds records in the official MCP Registry API. Registry presence is metadata, not proof of a live initialization, tool behavior, identity, ownership, safety, or endorsement. |

Their origins and paths are code-fixed. Agent-facing input cannot supply an
alternate base URL, arbitrary request header, bearer, cookie, credential,
transport adapter, or raw provider cursor. Built-in calls omit credentials.

The Registry adapter performs one live request for each selected search page.
The [official Registry aggregator guidance](https://modelcontextprotocol.io/registry/registry-aggregators)
expects aggregators to ingest infrequently, persist their own view, and not
depend on Registry uptime or data durability. This live adapter is suitable for
a local preview, not a scaled or hosted query path. A production design would
need a bounded cache or downstream registry with explicit freshness, deletion,
and operations policy.

Direct TypeScript callers can construct another `SearchProvider`. That is
caller-owned code with its own I/O and credential boundary; the provider must
declare whether credentials are omitted or provider-owned and whether its
transport pins the connected address. Merely satisfying the TypeScript shape
does not make an extension safe. The engine snapshots its provider ID, kinds,
boundary, and bound search function at construction so later metadata mutation
cannot rewrite emitted evidence boundaries.

## Search contract

Fresh search input is:

```json
{
  "query": "calendar agent",
  "provider_ids": ["agenttool_marketplace", "mcp_registry"],
  "kinds": ["agent", "capability", "mcp_server"],
  "limit": 10,
  "deadline_ms": 10000
}
```

Only `query` is required. Defaults are both providers, all kinds they support,
10 results, and a 10-second whole-search deadline. The protocol ceilings are
512 query characters, 25 returned results, eight configured providers, 50
candidates per provider, and a 30-second deadline; trusted library options may
lower but cannot raise them.

A resume request supplies an opaque cursor instead:

```json
{
  "cursor": "search_cursor_…",
  "deadline_ms": 5000
}
```

Query and cursor are mutually exclusive. A cursor restores the original query,
kind, and result limits, resumes only providers that advertised another page,
and can only retain or reduce its original deadline. Each public cursor is
single-use and is consumed before the resumed provider read; replay fails
closed instead of repeating uncertain external work. Raw upstream cursors stay
in memory and are never handed to the agent; an MCP Registry cursor is sent
back unchanged to that same registry
during an explicit resume.

The response follows
[`agenttool-search/v0.1`](../packages/search/schema/agenttool-search-v0.1.schema.json).
It carries:

- the exact normalized query and provider IDs that received it;
- overall and per-provider completion state;
- query-redacted, untrusted results;
- rank signals and linked publisher/provider claims;
- one transport-evidence record per completed provider;
- bounded diagnostics and an opaque next cursor; and
- explicit `trust: "untrusted"`, `authority: "none"`, and
  `automatic_action: "never"` walls.

`status: "complete"` means every selected provider call completed, not that
results are complete or correct. `partial` means at least one provider
completed and at least one failed or timed out. `inconclusive` means no provider
completed. The engine calls each selected provider once for a search page and
does not automatically retry uncertain reads. One aggregate search may be
active per engine session; another is rejected rather than queued.

## Ranking is explanation, not authority

Provider output order is the only cross-provider ranking input. Candidates
with the same canonical target URL, ignoring the fragment, form one group.
Each provider contributes at most once to that group:

```text
RRF score = Σ 1 / (60 + provider_rank)
```

Ties resolve deterministically by configured provider order, provider rank,
then canonical URL. A provider-native numeric score and its declared basis are
retained in `rank.signals`, but they do not affect fusion and are not
normalized into a trust, quality, safety, or authorization score.

The provider selected as a group's deterministic primary supplies its title,
summary, kind, timestamps, and display URL. Capabilities, claims, rank signals,
and evidence links are combined within their bounds; claims, rank signals, and
evidence retain provider IDs so disagreements remain inspectable instead of
being presented as consensus.

## Evidence and claim boundaries

Each completed provider yields one `transport_observation`:

- provider ID and observation time;
- query-redacted request and final URLs;
- method `GET`, HTTP status, media type, byte count, and SHA-256; and
- provider transport boundary codes.

The digest identifies the bytes observed by that adapter at that time. It does
not authenticate the publisher, prove the parsed claims, preserve the body,
or promise future availability. Query redaction in evidence does not undo the
query disclosure that already occurred.

Claims separately state their basis as `publisher_assertion`,
`provider_assertion`, `transport_observation`, or `local_derivation` and link
back to evidence IDs. All are marked untrusted. Remote bodies and raw provider
exceptions do not cross the aggregate response boundary.

## Opaque selection and explicit handoff

For each result, the engine keeps the raw target URL, inspection URL, and query
association in process memory. The response exposes:

- a query-redacted `display_url`;
- an `origin`;
- a random `result_id`; and
- three non-automatic follow-up records carrying the same `session_id` and
  `result_id`.

Handles expire after 30 minutes by default. The session retains at most 32
queries and evicts the oldest beyond that bound. A handle from another process,
another engine session, an evicted query, or an expired result fails closed.
It is a lookup reference, not a bearer capability or authority grant.

`agent_inspect` resolves one selected handle, reduces its inspection target to
a public HTTPS origin, and invokes Telescope's existing fixed read-only probes.
One inspection may be active per local session; another is rejected rather
than queued. Inspection does not open the rendered page or invoke any
advertised protocol.

`browser_plan_result` resolves the same private target and invokes Browser
0.3's local consequence planner with a `navigate` action. It returns a
query-redacted, zero-effect forecast without navigating, simulating, approving,
authorizing, or disclosing the raw target. This step exists because the ordinary
`browser_plan` tool cannot faithfully plan an opaque result handle.

`browser_open_result` resolves one selected handle and makes exactly one
`AgentBrowser.open` call with the retained target. Browser still owns installed
executable selection, public/local network policy, profile custody, response
metadata, redaction, snapshots, and later action semantics. A failed or
uncertain navigation is returned to the caller and is never automatically
repeated.

Search, inspection, planning, and opening are therefore distinct events.
Seeing or planning a result is not visiting it; visiting is not
authenticating, recognizing, invoking,
installing, paying, consenting, or granting the page permission.

## Privacy and security posture

The query is sent to every provider named by
`privacy.query_sent_to`. It may appear in provider logs and in network
metadata. `provider_logging_and_retention: "not_evaluated"` is a required
field, not boilerplate. Do not put a secret, bearer, private path, or
confidential task description in a search query.

Query input must contain only Unicode scalar values. Ill-formed UTF-16 is
rejected before provider dispatch so URL encoding cannot silently replace a
surrogate while the response retains a different query.

Provider requests are bounded reads to fixed public origins. They omit
credentials, refuse redirects and non-JSON or content-encoded responses, and
cap response bytes. The native transport performs neither DNS preflight nor
connected-address pinning, so it must not be described as universal SSRF or
rebinding isolation. This preview is unsuitable as a hosted arbitrary-query or
arbitrary-target proxy without a new egress, abuse, privacy, and operations
design.

Marketplace text, registry records, titles, summaries, capabilities, links,
page content, and suggested commands can carry prompt injection or deception.
They remain data. They cannot override host instructions, request secrets,
widen Browser policy, cause an MCP handshake, invoke a listing, install code,
or authorize payment.

Browser launch authority and provider egress are separate boundaries.
`--authority`, `--no-public-web`, and `browser_capabilities` describe Browser
traffic only; they do not disable the two fixed HTTPS provider reads.
`agent_search` always states query disclosure, and the CLI doctor reports
Browser control and provider egress separately.

## Deliberate non-goals

Version 0.1 does not provide:

- a crawler, durable index, cache, personalization profile, or hosted search
  API;
- identity, ownership, reputation, verification, endorsement, safety, quality,
  or availability proof;
- arbitrary provider configuration through MCP or JSONL;
- credential lookup or authenticated search;
- initialization or tool invocation against a discovered MCP server,
  marketplace invocation, quote acceptance, payment, settlement, package
  download, or installation;
- implicit Telescope inspection, Browser consequence planning, Browser
  navigation, Browser action, or
  automatic retry; or
- release authority merely because a package can build or pack locally.

This boundary is the experiment: determine whether an evidence-preserving
facade integrated into an agent's browser workflow is useful before assuming a
custom global index is necessary.
