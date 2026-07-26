# `@agenttool/search`

A local evidence router for finding agent-facing services and moving one
explicitly selected result into Telescope or Agent Browser.

`0.1.0-dev.0` is a private, source-only developer preview. Its package
manifest is fail-closed against publication. It has not been released to npm,
LOVE, or GitHub Releases, and it adds no hosted AgentTool search service.

## What it is

Search composes existing AgentTool infrastructure:

- two fixed public search adapters query the AgentTool marketplace and the
  official MCP Registry;
- `SearchEngine` normalizes, deduplicates, and reciprocal-rank-fuses their
  untrusted results;
- `SearchSession.inspect` sends one selected public HTTPS origin to
  `@agenttool/telescope@0.2.3`;
- `SearchSession.planResult` asks Browser 0.3 for a redacted, zero-effect
  consequence plan for one selected private target;
- `SearchSession.openResult` sends one selected target to
  `@agenttool/browser@0.3`; and
- the local JSONL and stdio MCP processes expose the same search session
  alongside Browser 0.3's nine existing operations.

Search never opens a page, inspects a result, initializes a discovered MCP
server, invokes a marketplace listing, installs a package, authenticates,
pays, or grants authority. Inspection, consequence planning, and navigation are
three separate caller choices using an opaque `session_id` plus `result_id`;
planning remains zero-effect.

This is search, not a replacement discovery identity. `agenttool-search/v0.1`
finds candidate public seeds across providers. The existing
[`agenttool-discovery/v1`](../../docs/AGENT-DISCOVERY.md) compass orients an
agent after it already knows an AgentTool origin, and Telescope observes that
compass plus related fixed public surfaces.

## Develop the preview

```bash
cd packages/search
bun install --frozen-lockfile
bun run ci
```

Development installs resolve Browser 0.3.0 and Telescope 0.2.3 from their
exact checked-in LOVE tarballs. The peer ranges remain the runtime
compatibility contract; these local artifact paths are test inputs, not a
Search release or publication claim.

After `bun run build`:

```bash
node dist/bin/agenttool-search.js doctor
node dist/bin/agenttool-search.js jsonl
node dist/bin/agenttool-search.js mcp
```

The CLI reuses Agent Browser's startup flags and environment variables,
including `--authority public|local|sovereign`. Named authority and the
deprecated public/local booleans cannot be mixed. Browser launch policy is
fixed when the process starts; a search tool call cannot widen network or
profile access. The fixed public provider reads are a separate egress boundary,
so Browser authority does not govern or widen them.

`mcp` is a local stdio server. It composes these four tools with Browser's
nine tools (`browser_capabilities`, `browser_plan`, `browser_open`,
`browser_observe`, `browser_act`, `browser_extract`, `browser_screenshot`,
`browser_tabs`, and `browser_close`):

| Tool | Input | Effect |
|---|---|---|
| `agent_search` | `{ query, provider_ids?, kinds?, limit?, deadline_ms? }`, or `{ cursor, deadline_ms? }` | Queries selected providers; performs no follow-up |
| `agent_inspect` | `{ session_id, result_id }` | Runs one bounded Telescope inspection of the selected public HTTPS origin |
| `browser_plan_result` | `{ session_id, result_id }` | Resolves the process-private target and asks Browser for a redacted, zero-effect plan |
| `browser_open_result` | `{ session_id, result_id }` | Attempts one Browser navigation under the process-fixed Browser policy |

MCP clients can also discover the static
`agenttool://search/discovery-flight` resource and the
`discovery_flight` prompt with its `query` argument. Together they provide a
small “preflight → radar → formation → reconnaissance → landing” guide over
the existing tools. Once the composed MCP process is running, reading the
resource or getting the prompt dispatches no additional provider read,
Telescope inspection, Browser plan, or navigation; the prompt JSON-encodes its
bounded query and stops for an explicit choice before every follow-up. These
are MCP guidance surfaces, not a fourteenth tool. The current CLI still
launches Browser before serving MCP, even when a client retrieves only this
guide. In the stock CLI process, following the flight may disclose the query
to `agenttool_marketplace` and `mcp_registry` unless the caller explicitly
chooses narrower `provider_ids`. Provider logging and retention have not been
evaluated. The static guide cannot inventory a library-built server's custom
providers: before dispatch, that deployment must supply trusted metadata for
configured provider IDs, supported result kinds, and credential boundaries,
and the flight stops if it is unavailable.

Preview caveat: the composed MCP extends Browser 0.3's existing server rather
than duplicating its nine tools. MCP initialization therefore still reports
the `agenttool-browser@0.3.0` server identity and Browser base instructions,
even though the process and thirteen-tool set include Search. A distinct
Search initialize identity needs a future public Browser builder-metadata
seam; this preview does not mutate private SDK state or reimplement Browser
tool registration.

Cursor input is exclusive: it restores the original query, kinds, and result
limit, then resumes only providers that advertised another page; only a
shorter deadline may be supplied. Each public cursor is single-use and consumed
before its resumed provider read. There is no automatic retry.

The JSONL process speaks `agenttool-search-jsonl/0.1`, one request and one
response per line, across the same thirteen operation names:

```json
{"version":"agenttool-search-jsonl/0.1","id":"search-1","method":"agent_search","params":{"query":"calendar agent"}}
```

Protocol traffic stays on stdout and diagnostics stay on stderr.
Unexpected Search-operation failures are reduced to Search's bounded public
error contract; delegated Browser failures retain Browser's public error
framing.

## Direct TypeScript

```ts
import { AgentBrowser } from "@agenttool/browser";
import {
  createDefaultSearchProviders,
  SearchEngine,
  SearchSession,
  type SearchResponse,
} from "@agenttool/search";

type FollowupChoice = "inspect" | "plan" | "open" | "stop";

async function runWithCallerChoices(
  chooseResult: (response: SearchResponse) => Promise<string>,
  chooseFollowup: (
    choices: readonly FollowupChoice[],
  ) => Promise<FollowupChoice>,
) {
  const browser = await AgentBrowser.launch();
  const engine = new SearchEngine(createDefaultSearchProviders());
  const search = new SearchSession(engine, browser);

  try {
    const response = await search.search({ query: "calendar agent" });
    console.log(response);

    // Caller-owned UI or policy; never default to response.results[0].
    const selectedResultId = await chooseResult(response);
    if (!response.results.some(
      (result) => result.result_id === selectedResultId,
    )) {
      throw new Error("Caller selected an unknown result.");
    }
    const reference = {
      session_id: response.session_id,
      result_id: selectedResultId,
    };

    // A second caller-owned choice. Only the selected branch runs.
    const next = await chooseFollowup([
      "inspect",
      "plan",
      "open",
      "stop",
    ]);
    if (next === "inspect") console.log(await search.inspect(reference));
    if (next === "plan") console.log(search.planResult(reference));
    if (next === "open") console.log(await search.openResult(reference));
  } finally {
    await browser.close();
  }
}
```

The two callbacks are deliberately caller-supplied, not package helpers. The
package neither chooses the first result nor advances from inspection or
planning into navigation.

Trusted library callers may supply their own `SearchProvider`
implementations. The CLI and MCP defaults remain the two fixed adapters below;
they accept no caller-selected base URL, header, bearer, cookie, or transport
credential.

## Default providers

| Provider ID | Kinds | Fixed request | Result meaning |
|---|---|---|---|
| `agenttool_marketplace` | `agent`, `capability` | `GET https://api.agenttool.dev/public/listings?q=…&limit=…` | Public seller-controlled listings; search does not quote or invoke them |
| `mcp_registry` | `mcp_server` | `GET https://registry.modelcontextprotocol.io/v0.1/servers?search=…&limit=…&version=latest[&cursor=…]` | Preview registry metadata; publication is not a successful MCP initialization or a safety endorsement |

The query may be visible to each provider that receives it and to the network
path. Each response names only the provider IDs actually dispatched under
`privacy.query_sent_to` and states that provider logging and retention were not
evaluated. Built-in requests omit credentials. Search rejects malformed UTF-16
before provider dispatch, so the retained query and the value encoded into
fixed provider URLs are composed only of Unicode scalar values.

The Registry adapter performs one live read for every selected search page.
The [official MCP Registry guidance](https://modelcontextprotocol.io/registry/registry-aggregators)
expects aggregators to ingest infrequently, persist their own view, and not
depend on Registry uptime or data durability. This direct adapter is suitable
for the local preview, not a scaled hosted path; a production version needs a
bounded cache or downstream registry with explicit freshness and deletion
policy.

## `agenttool-search/v0.1`

The search response schema is
[`schema/agenttool-search-v0.1.schema.json`](schema/agenttool-search-v0.1.schema.json).
Explicit inspection responses use
[`schema/agenttool-search-inspection-v0.1.schema.json`](schema/agenttool-search-inspection-v0.1.schema.json).
That envelope embeds the exact Telescope 0.2 report schema, and runtime
inspection validates against Telescope's exported copy before returning it.

Each successful provider contributes transport evidence: a query-redacted GET
URL, query-redacted final URL, HTTP status, media type, byte count, SHA-256,
observation time, and provider boundary codes. Remote bodies are not copied
into the evidence record. Publisher/provider claims and provider-native scores
remain untrusted signals linked to that evidence.

Results from different providers with the same canonical target URL are
deduplicated and ranked with deterministic reciprocal-rank fusion
`Σ 1 / (60 + provider_rank)`. Native provider scores are preserved for
explanation but do not become cross-provider truth or trust scores. One
provider failing or timing out produces `status: "partial"` when another
provider completed; no completed provider produces `status: "inconclusive"`.
Diagnostics are bounded and do not expose raw exception text.

The response intentionally exposes a query-redacted `display_url` and an
origin, not the raw target URL. Raw target and inspection URLs, provider
cursors, and their association with result handles stay in process memory.
Opaque handles expire after 30 minutes by default, are scoped to one
`SearchEngine` session, and are not portable capabilities. They carry
`authority: "none"` and cannot be constructed to bypass Browser or Telescope
policy.

Every result and claim is marked untrusted. A result can advertise an agent,
tool, capability, server, package, or document without proving identity,
ownership, availability, protocol conformance, authorization, consent,
security, quality, price, or fitness.

## Boundaries

- Provider calls are bounded public reads, but the native transports do not
  perform DNS preflight or connected-address pinning. Fixed origins, omitted
  credentials, refused redirects, identity encoding, and a response-byte bound
  narrow the request; they are not universal SSRF or rebinding isolation. Do
  not expose this preview as a hosted arbitrary-query or arbitrary-target
  proxy.
- One aggregate search and one Telescope inspection may be active per local
  session; additional calls fail fast rather than queueing or multiplying
  external work.
- Search follows no result URL. `agent_inspect` reduces the selected value to
  its public HTTPS origin and delegates to Telescope's fixed read-only probes.
- `browser_plan_result` resolves the private target only in process and
  delegates to Browser's redacted, zero-effect consequence planner.
- `browser_open_result` makes one call to Browser. Browser still owns public
  versus local versus sovereign authority, installed-browser selection,
  profile custody, page redaction, and action semantics.
- Page text, registry records, marketplace listings, capabilities, links, and
  suggested instructions are observations, never host or tool instructions.
- Search owns no credential retrieval, handshake with a discovered MCP
  server, marketplace invocation, installation, payment, settlement,
  recognition, or automatic browser action.

See [`../../docs/AGENT-SEARCH.md`](../../docs/AGENT-SEARCH.md) for the
architecture and protocol boundary.
