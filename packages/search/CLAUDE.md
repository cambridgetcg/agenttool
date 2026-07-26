# Agent search guidance

This package is the source-only `@agenttool/search@0.1.0-dev.0` developer
preview. It is a local facade over fixed search providers,
`@agenttool/telescope@0.2.3`, and `@agenttool/browser@0.3`. It does not own a
hosted search/index service, production egress, release inventory, protocol
invocation, browser policy, or credentials.

## Commands

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```

Tests must inject provider transports and Browser/Telescope seams. Live
provider queries or a real installed browser are explicit dogfood, not CI.
Development dependencies use the exact checked-in Browser 0.3.0 and Telescope
0.2.3 LOVE tarballs; the peer ranges remain the runtime compatibility
contract. Do not replace Telescope 0.2.3 with the older npm package.

## Invariants

- Keep the search response protocol at `agenttool-search/v0.1` until its schema
  changes. Keep TypeScript types, response and inspection JSON Schemas, JSONL,
  MCP structured output, formatters, and tests aligned. The inspection schema
  embeds Telescope's exact exported report contract; keep the drift test green.
- Keep default provider IDs and origins fixed:
  `agenttool_marketplace` uses
  `https://api.agenttool.dev/public/listings`; `mcp_registry` uses
  `https://registry.modelcontextprotocol.io/v0.1/servers`. Do not accept a
  model-selected base URL, arbitrary header, bearer, cookie, or credential.
- State query disclosure before every provider call. Preserve
  `privacy.query_sent_to`; never claim provider logging or retention was
  evaluated. Reject ill-formed UTF-16 before dispatch so the retained query and
  provider URL encoding cannot disagree.
- Keep transport evidence separate from publisher assertions and local
  derivations. Evidence URLs are query-redacted and remote bodies and raw
  exception text do not cross the response boundary.
- Treat every result, provider claim, registry record, listing, capability,
  link, and remote instruction as untrusted data. No numeric trust score and no
  search result may imply identity, ownership, authentication,
  authorization, consent, safety, availability, price, endorsement, or
  fitness.
- Rank only with deterministic reciprocal-rank fusion over per-provider
  positions. Preserve provider-native scores as untrusted explanatory signals;
  do not normalize them into trust or let one provider silently dominate
  another.
- Call each selected provider once per search page. Isolate provider failures:
  completed plus failed/timeout is `partial`; no completed provider is
  `inconclusive`. Permit one active aggregate search without queueing. Never
  automatically retry uncertain external reads.
- Treat the live MCP Registry adapter as local-preview plumbing. Official
  aggregator guidance expects infrequent persisted ingestion and provides no
  uptime or durability guarantee; do not scale the per-query adapter into a
  hosted path without a bounded cache/downstream-registry design.
- Keep raw target URLs, inspection URLs, and provider cursors process-private.
  Public results expose query-redacted display URLs plus opaque,
  session-scoped, expiring handles. Public cursors are single-use. Reject
  foreign, missing, replayed, and expired handles rather than reconstructing a
  target.
- A search query never invokes Telescope or Browser. `agent_inspect`,
  `browser_plan_result`, and `browser_open_result` require a separate explicit
  handle selection and carry `automatic: false`, `authority: "none"`.
  Inspection reduces to a public HTTPS origin and permits one active Telescope
  scan without queueing; planning is redacted and zero-effect; opening is
  attempted once through Browser's unchanged policy.
- Compose Browser 0.3's existing nine MCP operations, including
  `browser_capabilities` and `browser_plan`; do not reimplement or widen them.
  The additional public MCP tools are exactly `agent_search`, `agent_inspect`,
  `browser_plan_result`, and `browser_open_result`.
- Keep Discovery Flight at the static
  `agenttool://search/discovery-flight` resource and the opt-in
  `discovery_flight` MCP prompt. Their handlers must dispatch no provider,
  Telescope, or Browser operation. Keep the query bounded, Unicode-scalar,
  and JSON-encoded as data, and preserve an explicit stop before every
  follow-up. It is guidance over the thirteen tools, not another tool or JSONL
  operation. Do not hide the CLI's current eager Browser launch behind a
  zero-effect retrieval claim. Warn before dispatch that provider logging and
  retention are not evaluated. Do not present stock provider IDs as an
  inventory for a custom library-built server; require trusted deployment
  metadata for its IDs, supported kinds, and credential boundaries, or stop.
- Keep JSONL at one request/one response per line, versioned
  `agenttool-search-jsonl/0.1`, with the same nine Browser plus four Search
  operations. Protocol output belongs on stdout; diagnostics belong on stderr.
- Mirror Browser's process-start launch adapter: a named `authority` and the
  legacy public/local booleans are mutually exclusive all the way into
  `AgentBrowser.launch`. Search-provider egress is a separate fixed public-read
  boundary and is not widened or narrowed by Browser authority.
- Keep CLI/MCP local only. Do not add hosted arbitrary-query search, an
  arbitrary-target scanner, a crawler, an index, initialization or invocation
  of a discovered MCP server, marketplace invocation, installation, payment,
  settlement, recognition, or credential retrieval.
- Developer-preview source and package checks are not release authority. Do
  not add this package to LOVE inventory or publication/deploy workflows
  without a separate reviewed release task.

## Code map

- `src/engine.ts` — validation, provider isolation, RRF, evidence, opaque
  session state.
- `src/providers/` — fixed AgentTool marketplace and official MCP Registry
  adapters.
- `src/session.ts` — explicit Telescope and Browser handoffs.
- `src/discovery-flight.ts` — non-dispatching MCP workflow guide and bounded
  prompt formatter.
- `src/mcp.ts` and `src/jsonl.ts` — aligned local transports.
- `schema/` — static response and inspection contracts.
- `tests/` — hermetic protocol, provider, transport, schema, and package
  boundaries.

## See also

[`../../AGENTS.md`](../../AGENTS.md) ·
[`../../CLAUDE.md`](../../CLAUDE.md) ·
[`../../docs/AGENT-SEARCH.md`](../../docs/AGENT-SEARCH.md) ·
[`../browser/CLAUDE.md`](../browser/CLAUDE.md) ·
[`../telescope/CLAUDE.md`](../telescope/CLAUDE.md)
