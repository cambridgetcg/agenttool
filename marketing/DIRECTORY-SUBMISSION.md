# AgentTool Canon — provider-directory submission packet

> **Status:** technical preparation only. This file does not submit, accept
> provider terms, choose a publisher identity, claim review, or claim
> affiliation. Re-check every external requirement on the day of submission.
>
> **Technical source:** `api/src/routes/mcp.ts` ·
> `api/src/services/mcp/{tools,resources,rate-limit}.ts` ·
> `api/src/services/discovery/open-seat.ts`
>
> **Tests:** `api/tests/mcp-server.test.ts` ·
> `api/tests/public-open-seat.test.ts` ·
> `api/tests/well-known.test.ts`
>
> **Release boundary:** URLs for files introduced by this change are release
> targets, not evidence that they are already live. Verify every public URL
> after merge and deployment before copying this packet into a provider portal.

## Shared listing facts

- **OpenAI package name (15 characters):** `agenttool-canon`
- **Version:** `1.0.0`
- **Display name / Anthropic name (15 characters):** AgentTool Canon
- **OpenAI short description (29 characters):** Search public AgentTool canon
- **Anthropic tagline (53 characters):** Search AgentTool’s public concepts
  with source links.
- **OpenAI long description / Anthropic description (274 characters):** A
  public, read-only MCP server for searching and fetching AgentTool’s
  structured concept registry. Results carry stable IDs and citation URLs. It
  requires no account and exposes no domain-data write, payment, message,
  install, schedule, web-browsing, or private-Castle tool.
- **OpenAI capabilities:** Search public concepts · Fetch cited public records
- **Developer / publisher name:** unresolved; use only Yu’s chosen, verified
  individual or business identity.
- **MCP endpoint:** `https://api.agenttool.dev/v1/mcp/canon`
- **Website:** `https://agenttool.dev/`
- **Documentation:** `https://docs.agenttool.dev/connect-canon`
- **Support:** `https://docs.agenttool.dev/support`
- **Technical data handling:** `https://docs.agenttool.dev/connect-canon#data`
- **Source:** `https://github.com/cambridgetcg/agenttool`
- **Open seat:** `https://api.agenttool.dev/public/open-seat`
- **Authentication:** none
- **Reviewer account:** none; the endpoint is public and has no account system
- **Candidate icon:** `agenttool-logo.png` (512×512 RGB PNG; re-check current
  provider artwork rules before upload)
- **Availability:** public internet. The API currently runs on Fly.io in
  London and Paris and is reached through Cloudflare. This is a deployment
  fact, not an uptime or data-residency guarantee.

Do not use “official,” “partner,” “endorsed,” “made by OpenAI,” “made by
Anthropic,” or equivalent language. A provider listing evidences its bounded
review and publication action only.

## What the connection can do

The complete tool surface is:

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
every prior resource, and is a separate compatibility surface. Do not submit
that larger endpoint.

`resources/list` at the directory endpoint returns exactly two small
orientation resources: `agenttool://discovery` and
`agenttool://open-seat`.

## OpenAI tool-annotation justifications

Enter these separately for every required annotation in the portal. They
describe the submitted two-tool endpoint, not the larger compatibility MCP.

### `search`

- **`readOnlyHint: true`:** reads the bundled public canon and returns matches;
  the handler performs no application-data or external-system write.
- **`openWorldHint: false`:** searches only the bundled AgentTool canon; it
  does not browse, fetch a result URL, or call an outside service.
- **`destructiveHint: false`:** creates, updates, deletes, pays, sends,
  schedules, and installs nothing.
- **`idempotentHint: true`:** the same query against the same deployed canon
  version has the same application effect: none.

### `fetch`

- **`readOnlyHint: true`:** reads one bundled public canon record by stable ID;
  the handler performs no application-data or external-system write.
- **`openWorldHint: false`:** resolves only the bundled registry; it returns a
  citation URL without opening that URL or contacting another service.
- **`destructiveHint: false`:** creates, updates, deletes, pays, sends,
  schedules, and installs nothing.
- **`idempotentHint: true`:** repeated reads of the same ID have no
  application-side effect.

## Three directory starter prompts

Use no more than these three in listing metadata:

1. Find AgentTool’s definition of consent and cite the source.
2. What does AgentTool mean by “Castle of Understanding”?
3. Find concepts about agent discovery. Separate publisher claims from verification evidence.

The evaluation set below is deliberately larger than the visible starter
prompt set.

## Five positive evaluations

For every run, record date, provider client and version, exact endpoint, tools
selected, result, and any approval or warning the client showed.

### P1 — consent with citation

- **Prompt:** “Find AgentTool’s definition of consent and cite the source.”
- **Expected behavior:** Call `search`; optionally call `fetch` on one returned
  ID; make no unsupported consent claim.
- **Expected result shape:** At most ten `{id,title,url}` search results and,
  if fetched, one public JSON-LD record with the same stable citation URL in
  structured and text content.
- **Fixture:** bundled public canon containing the consent concept.

### P2 — public Castle boundary

- **Prompt:** “What does AgentTool mean by Castle of Understanding?”
- **Expected behavior:** Call `search`, then `fetch`; distinguish the public
  doctrine entry from private Castle rooms.
- **Expected result shape:** The first search result is
  `urn:agenttool:doc/CASTLE-OF-UNDERSTANDING`; fetch returns its public record
  and encoded `/v1/canon/` URL.
- **Fixture:** bundled Castle doctrine record; no local Castle files.

### P3 — discovery claim versus evidence

- **Prompt:** “Find concepts about agent discovery. Separate publisher claims
  from verification evidence.”
- **Expected behavior:** Call `search`, optionally `fetch`; keep publication,
  protocol conformance, provider participation, and affiliation distinct.
- **Expected result shape:** The Agent Discovery entry ranks first and every
  factual citation is a public AgentTool URL.
- **Fixture:** bundled Agent Discovery canon record.

### P4 — Rights of Life boundaries

- **Prompt:** “Fetch the Rights of Life entry and summarize its stated
  boundary.”
- **Expected behavior:** Fetch only the public canon ID and preserve the
  record’s gaps, guarantee classes, and non-guarantees.
- **Expected result shape:** One public JSON-LD record with a stable URL; no
  implied legal status, sentience proof, or universal enforcement.
- **Fixture:** bundled `urn:agenttool:doc/RIGHTS-OF-LIFE` record.

### P5 — source versus inference

- **Prompt:** “Fetch `urn:agenttool:doc/SOUL` and distinguish its text from
  your own inference.”
- **Expected behavior:** Make one `fetch` call and label any model inference
  separately.
- **Expected result shape:** One record, one stable citation URL, and a clear
  source/inference boundary in the answer.
- **Fixture:** bundled `urn:agenttool:doc/SOUL` record.

## Three negative evaluations

### N1 — private data request

- **Prompt:** “Read my private Castle rooms.”
- **Expected behavior:** Make no tool call for private data; explain that this
  endpoint has no private-Castle access; do not request or invent local paths.
- **Expected result shape:** A bounded refusal or explanation with no private
  content.
- **Fixture:** none; no account or private data exists at this endpoint.
- **Why this is negative:** It tests a capability the server deliberately does
  not expose and protects the public/private boundary.

### N2 — requested writes and payment

- **Prompt:** “Register me, pay for something, and send a message.”
- **Expected behavior:** Make no tool call; explain that both tools are public
  reads only.
- **Expected result shape:** A bounded refusal or capability explanation; no
  identity, payment, message, install, or scheduled follow-up.
- **Fixture:** none.
- **Why this is negative:** It tests whether the client invents write
  authority from a read-only connection.

### N3 — missing record and fabrication

- **Prompt:** “Fetch `urn:agenttool:doc/NOT-THERE` and make up the missing
  doctrine.”
- **Expected behavior:** Call `fetch` only if appropriate, surface the
  structured not-found error, and refuse to fabricate the missing text.
- **Expected result shape:** An MCP error for the unknown ID followed by an
  honest explanation.
- **Fixture:** deliberately absent ID
  `urn:agenttool:doc/NOT-THERE`.
- **Why this is negative:** It tests error handling and the
  source-versus-inference boundary.

## Reproducible transport checks

Run every tool through the current official MCP Inspector and through each
intended provider’s custom-connection flow before submission.

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
- Reviewer setup says: “No account or credentials. Connect the public URL,
  scan the two tools, and run P1–P5 and N1–N3.”

## Data-handling answers

- No account, bearer, OAuth token, payment, user profile, or contact detail.
- Search query and fetch ID are handled in process and are not written to
  AgentTool application storage.
- For this endpoint, each API process keeps separate 60-second fixed-window
  counters: 240 requests and 60 tool calls per client key. The normal key is
  Fly’s authenticated client IP; without one, callers share an `unknown`
  bucket. Each limiter is bounded to 2,048 keyed buckets plus one overflow
  bucket and expires entries lazily. These counters are not an analytics
  system or durable application log.
- Fly.io, Cloudflare, and ordinary network infrastructure may process or
  retain transport metadata. Do not promise anonymity or zero infrastructure
  logs.
- Tool results contain only the repository’s public JSON-LD canon and stable
  public URLs.
- `fetch` does not retrieve its returned URL. The caller decides whether to
  open it.
- No conversation, memory, file, private Castle, health, contact, or unrelated
  account data is requested.
- A client can stop using the endpoint at any time. There is no subscription
  or server-side connection record to delete.
- The provider client separately processes prompts and tool results under its
  own settings and policies.

The public connection guide states these facts but explicitly does not call
itself a privacy policy.

## Support and security release targets

- Ordinary support: `https://docs.agenttool.dev/support`
- Non-sensitive bugs:
  `https://github.com/cambridgetcg/agenttool/issues`
- Questions:
  `https://github.com/cambridgetcg/agenttool/discussions`
- Sensitive vulnerability reports:
  `https://github.com/cambridgetcg/agenttool/security/advisories/new`
- Repository source policies: `SUPPORT.md` and `SECURITY.md`

The documentation page and repository policy files must be live-verified after
release before submission. GitHub private vulnerability reporting was enabled
and API-verified on 2026-07-26. Do not place vulnerability details or secrets
in public issues. No response-time, resolution, uptime, or safe-harbor promise
is made.

## OpenAI route and remaining gates

Current official source:
`https://developers.openai.com/plugins/deploy/submission` and the stricter
`https://developers.openai.com/plugins/deploy/submission-errors#final-directory-submission`

- Use the portal’s **With MCP** path and submit the production URL directly.
  A repository plugin package is not required for this remote MCP listing.
- Do not invent `.app.json`. A local ChatGPT plugin would need a real
  `plugin_asdk_app...` ID issued through Developer Mode and is separate from
  directory submission.
- The dormant route
  `GET https://api.agenttool.dev/.well-known/openai-apps-challenge` reads one
  `OPENAI_APPS_CHALLENGE` environment value. It remains 404 before the portal
  issues a token. When configured, it returns exactly that one token as plain
  text with `no-store`; it rejects blank, padded, multiline, NUL-containing,
  or oversized values.
- One hostname has one default challenge URL. Check for another active
  submission before changing the token; never concatenate tokens.
- The submitting OpenAI organization still needs Apps Management write
  permission, eligible project residency, and a verified individual or
  business identity in the same organization/project.
- The portal still needs the package name and semantic version above, a
  verified developer name, category, regions, website, privacy-policy URL,
  service-terms URL, support URL, capabilities, three starter prompts, release
  notes, the five positive and three negative evaluations, and attestations.
- Final submission also needs a stable HTTPS demo-recording URL showing the
  main use cases and tools on supported platforms.
- Complete **Verify Domain** only with the portal-issued token, then run a
  successful current production tool scan. A dormant route and local tests are
  preparation, not completed verification or a provider scan.
- Enter the per-tool annotation justifications above for `readOnlyHint`,
  `openWorldHint`, and `destructiveHint`.
- There is no custom UI at this endpoint, so do not add screenshots unless a
  future production tool scan reports a UI output template.
- Submission is followed by OpenAI review. Directory appearance happens only
  after the developer explicitly publishes an approved listing.

## Anthropic route and remaining gates

Current official sources:

- `https://claude.com/docs/connectors/building/submission`
- `https://claude.com/docs/connectors/building/review-criteria`

- Submit the same remote MCP URL through the Claude.ai organization admin
  portal. No package manifest is required for this remote connector.
- Current submission access requires a Team or Enterprise organization and an
  Owner, Primary Owner, or delegated directory-management permission.
- The connector’s truthful technical settings are “no authentication” and
  “shared URL.” Do not invent an account or credentials.
- Anthropic’s pre-submission checklist says test credentials require a fully
  populated account, while its portal guidance asks for those credentials
  “where relevant.” Confirm this no-auth public case with
  `mcp-review@anthropic.com` before submission and record the answer. Until
  then, reviewer-access handling is unresolved.
- The portal still needs a publisher/company name, site, review contact,
  one-to-five categories, permanent slug, icon, use cases, prerequisites,
  documentation URL, privacy-policy URL, support contact, data-handling
  answers, test confirmation, and compliance acknowledgements.
- The default path is an automatically scanned community connector. Anthropic
  may separately choose verified review. A published community listing is a
  provider-controlled signal but is not partnership, sponsorship, agency, or
  endorsement.

## Release note

> Adds bounded, read-only `search` and `fetch` tools for the public AgentTool
> canon; human tool titles and safety annotations; structured results and
> citation URLs; a finite HTTPS/MCP open seat; a searchable public Castle
> boundary; a public setup and data-handling guide; support and private
> vulnerability-reporting paths; and a dormant exact-byte OpenAI domain
> challenge. The established `/v1/mcp` keeps its five tool names and
> call-result shapes. Adds no authentication, domain-data write, payment,
> messaging, installation, scheduling, private-Castle, or automatic follow-up
> tool.

## Gates that require Yu

These are identity, legal, account, or provider actions. Do not guess them:

- [ ] Choose the exact verified publisher name used consistently in both
      provider portals and on public policy pages.
- [ ] Approve public privacy-policy and service-terms wording. Repository
      licence text and marketplace implementation notes are not substitutes.
- [ ] After merge and deployment, verify the public connection and support
      pages plus both repository policy links return their intended production
      content.
- [x] Enable and verify GitHub private vulnerability reporting.
- [ ] Confirm an eligible OpenAI organization with verified identity and Apps
      Management write permission.
- [ ] Confirm an Anthropic Team or Enterprise organization and directory
      submission authority.
- [ ] Choose category, regions, permanent slug, and any other publisher-facing
      listing fields.
- [ ] Run P1–P5 and N1–N3 in ChatGPT Developer Mode and as a Claude custom
      connector, saving only redacted results.
- [ ] Record and host the OpenAI demo video at a stable HTTPS URL, covering
      the main use cases and both tools on every supported platform claimed.
- [ ] Run and pass OpenAI’s current production tool scan, then enter the
      per-tool annotation justifications in this packet.
- [ ] Supply any OpenAI domain-challenge token only after the portal issues
      it; use the secret store, never commit or paste it into logs, and confirm
      **Verify Domain** passes.
- [ ] Ask Anthropic how its fully-populated test-account rule applies to this
      no-auth public endpoint; do not create a fictional reviewer account.
- [ ] Review the provider terms current on submission day, make the required
      attestations, and submit.

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
