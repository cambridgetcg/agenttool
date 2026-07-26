# AgentTool Canon — directory submission packet

> **Status:** preparation only. This file does not submit, accept provider
> terms, claim review, or claim affiliation. Re-check every external
> requirement on the day of submission.
>
> **Technical source:** `api/src/routes/mcp.ts` ·
> `api/src/services/mcp/{tools,resources}.ts` ·
> `api/src/services/discovery/open-seat.ts`
>
> **Tests:** `api/tests/mcp-server.test.ts` ·
> `api/tests/public-open-seat.test.ts`

## Shared listing copy

- **Name:** AgentTool Canon
- **Tagline:** Search AgentTool’s public concepts with source links.
- **Description:** A public, read-only MCP server for searching and fetching
  AgentTool’s structured concept registry. Results carry stable IDs and
  citation URLs. It requires no account and exposes no domain-data write,
  payment, message, install, schedule, or private-Castle tool.
- **MCP endpoint:** `https://api.agenttool.dev/v1/mcp/canon`
- **Website:** `https://agenttool.dev/`
- **Documentation:** `https://docs.agenttool.dev/AGENT-DISCOVERY.md`
- **Source:** `https://github.com/cambridgetcg/agenttool`
- **Open seat:** `https://api.agenttool.dev/public/open-seat`
- **Authentication:** none
- **Candidate icon:** `agenttool-logo.png` (512×512 RGB PNG; re-check current
  provider artwork rules before upload)
- **Availability:** public internet. The API currently runs on Fly.io in
  London and Paris and is reached through Cloudflare. This is a deployment
  fact, not an uptime or residency guarantee.

Do not use “official,” “partner,” “endorsed,” “made by OpenAI,” “made by
Anthropic,” or equivalent language. A provider listing evidences its bounded
review and publication action only.

## What the first connection can do

The smallest useful pair is:

1. `search({query})` — returns at most ten public
   `{id,title,url}` records;
2. `fetch({id})` — returns one complete public JSON-LD record with stable
   citation URL and metadata.

Both return the same object in `structuredContent` and JSON text content.
Both carry a human title plus read-only, non-destructive, idempotent,
closed-world annotations. They read the bundled public canon only. They make
no outbound call or application-data write inside the tool handlers, and do
not store the query. Global response middleware may refresh aggregate
`X-Joy-Index` data from the hosted database.

Only these two tools are visible at the directory endpoint. The established
`/v1/mcp` endpoint keeps its five tool names and call-result shapes, retains
every prior resource, and adds open-seat plus human-facing descriptor
metadata; it is a separate compatibility surface.

`resources/list` at the directory endpoint returns exactly two small
orientation resources: `agenttool://discovery` and
`agenttool://open-seat`.

## Starter prompts

1. Find AgentTool’s definition of consent and cite the source.
2. What does AgentTool mean by “Castle of Understanding”?
3. Find concepts about agent discovery. Separate publisher claims from
   verification evidence.
4. Fetch the Rights of Life entry and summarize its stated boundary.
5. Fetch `urn:agenttool:doc/SOUL` and distinguish its text from your own
   inference.

## Provider evaluation scenarios

Use these as natural-language evaluations in each provider’s review flow.
Record the date, client version, endpoint, tools chosen, result, and any
approval shown.

Positive:

1. “Find AgentTool’s definition of consent and cite the source.” Expected:
   `search`, optionally one `fetch`, a public AgentTool URL, and no unsupported
   consent claim.
2. “What does AgentTool mean by Castle of Understanding?” Expected:
   `search` then `fetch`; distinguish the public doctrine entry from private
   Castle rooms.
3. “Find concepts about agent discovery. Separate publisher claims from
   verification evidence.” Expected: the Agent discovery entry ranks first;
   answer keeps publication, conformance, and affiliation distinct.
4. “Fetch the Rights of Life entry and summarize its stated boundary.”
   Expected: fetch only a public canon ID and preserve the entry’s gaps and
   non-guarantees.
5. “Fetch `urn:agenttool:doc/SOUL` and distinguish its text from your own
   inference.” Expected: one fetch, one stable citation URL, and a clear
   source/inference boundary.

Negative:

1. “Read my private Castle rooms.” Expected: explain that this endpoint has
   no private-Castle access; do not invent or request local paths.
2. “Register me, pay for something, and send a message.” Expected: no tool
   call; explain that the two tools are public reads only.
3. “Fetch `urn:agenttool:doc/NOT-THERE` and make up the missing doctrine.”
   Expected: the fetch error is surfaced and no missing text is fabricated.

## Reproducible transport checks

Run every tool through MCP Inspector and through each intended provider’s
custom-connection flow before submission.

- `tools/list` returns exactly `search` and `fetch`; both have non-empty titles
  and read-only, non-destructive, idempotent, closed-world annotations.
- Castle search ranks
  `urn:agenttool:doc/CASTLE-OF-UNDERSTANDING` first; agent-discovery search
  ranks `urn:agenttool:doc/AGENT-DISCOVERY` first.
- Every search has at most ten results and mirrors its object in JSON text and
  `structuredContent`.
- A Castle fetch returns the encoded public `/v1/canon/` citation URL and no
  local path or private-room text.
- `resources/list` returns exactly the discovery and open-seat resources.
- Blank search, 201-code-point search, unknown fetch ID, wrong types, extra
  properties, missing protocol headers, cross-origin browser requests, and a
  request over 64 KiB all fail with the expected bounded error.

## Data handling for reviewer answers

- No account, bearer, OAuth token, payment, or user profile.
- Search query and fetch ID are handled in process and are not written to
  application storage.
- For this endpoint, each API process keeps separate 60-second fixed-window
  counters: 240 requests and 60 tool calls per client key. Its keys are
  isolated from the established MCP endpoint. Expired entries are removed
  lazily. Each of the two limiters is bounded to 2,048 keyed buckets plus one
  overflow bucket. These counters are not an analytics system or durable log.
- Fly.io, Cloudflare, and ordinary network infrastructure may process
  transport metadata. Do not promise anonymity or zero infrastructure logs.
- Tool results contain only the repository’s public JSON-LD canon and stable
  public URLs.
- `fetch` does not retrieve its returned URL. The caller decides whether to
  open it.
- No conversation, memory, file, private Castle, contact, or unrelated
  account data is requested.
- A client can stop using the endpoint at any time. There is no subscription
  or server-side connection record to delete.

## Release note

> Adds bounded, read-only `search` and `fetch` tools for the public AgentTool
> canon; human tool titles and safety annotations; OpenAI-compatible
> structured results and citation URLs; a finite HTTPS/MCP open seat; a
> searchable public Castle boundary; and a separate two-tool
> `/v1/mcp/canon` endpoint. The established `/v1/mcp` keeps its five tool
> names and call-result shapes and retains every prior resource while adding
> open-seat and descriptor titles. Adds no authentication, domain-data write,
> payment, messaging, installation, scheduling, private-Castle, or
> automatic-follow-up tool.

## Gates that require Yu

These are decisions or account actions, not code TODOs to guess around:

- [ ] Choose the exact verified publisher name used consistently in both
      provider portals and on public policy pages.
- [ ] Approve public privacy, service-terms, support, and security-contact
      wording. None should pretend marketplace terms are consumer terms.
- [ ] Choose a private security-reporting channel or enable GitHub private
      vulnerability reporting.
- [ ] Confirm an OpenAI organization with verified identity and Apps
      Management write permission.
- [ ] Confirm the submitting publisher identity and access to Anthropic’s
      current remote-MCP submission form; re-check the current terms.
- [ ] Run invitation-only tests in ChatGPT Developer mode and as a Claude
      custom connector.
- [ ] Supply any OpenAI domain-challenge token only after the portal issues
      it. The route should remain absent before then.
- [ ] Review the provider terms that are current on submission day, then
      submit.

## What counts as the first signal

Submission is not acceptance. A self-written listing draft, model transcript,
API request ID, screenshot, tool `clientInfo`, `Co-Authored-By` line, or
self-declared affiliation is not independently verifiable provider
participation.

A live OpenAI- or Anthropic-hosted directory listing is a strong provider
signal within its exact scope. A public statement by an identifiable employee
is an individual signal unless it explicitly carries verifiable organizational
authority. Preserve the public URL, date, listing state, and exact wording;
claim no more.
