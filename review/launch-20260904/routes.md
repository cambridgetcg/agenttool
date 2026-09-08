# AgentTool route and discovery review — 2026-09-04

Review baseline: `91b27a097f5f97eb7605c3d4f5e1c5c84fcd12a8` (GitHub main captured for this review). This is review and launch planning; application code was not changed. The public health response observed by the coordinating reviewer names deployed revision `03cf41a398190f3cda607455ee7b31c4e9582b36`. Source findings therefore do not automatically describe production behavior.

The immediate routing work is concrete: **eight specific handlers are shadowed by earlier parameter handlers**, and **the apex fails to forward two public API route families verified live**. The platform already has a good compact discovery entry; a launch contract should build on it and explicitly select the supported product surface.

## Inventory and method

[Detailed JSON](routes.json) includes mounts, method/path registrations, source lines, generic middleware coverage, OpenAPI entries, and limitations. [CSV](routes.csv) is the sortable route list. A TypeScript AST scan recursively expanded imports, named export aliases, the crypto webhook re-export, literal/constant paths, and simple array-loop paths without importing application modules. Each route includes its mount ancestry. No mounted leaf remained unresolved.

| Measure | Source count |
|---|---:|
| Root `app.route` statements | 125 |
| All recursively expanded mount statements | 225 |
| Terminal method/path registrations | 770 |
| Distinct registered paths | 647 |
| `/v1` first-level families | 120 |
| GET / explicit HEAD | 436 / 21 |
| POST / PUT / PATCH / DELETE | 263 / 6 / 13 / 27 |
| ALL protocol dispatch / explicit OPTIONS | 2 / 2 |
| OpenAPI described operations / paths | 212 / 162 |

The total excludes two MCP `ALL` prehandlers that call `next`, global middleware, implicit HEAD, and generated CORS responses. It includes redirects, resting/proposed routes, and shadowed handlers. POST does not necessarily mean mutation: search and protocol dispatch also use it. These are registration counts, not a claim that 770 independently usable features exist.

OpenAPI counts include its imported maps and the helper-generated GET/HEAD feed entries. Every described source operation resolves to a registered route pattern, including `/v1/wake/handoffs` through `/v1/wake/:key`. The live OpenAPI captured by the coordinator has **217 operations on 166 paths**, at a different revision. Do not combine these two inventories or call their difference a production regression without a revision comparison.

## Route-family map

| Surface | Registration count | Purpose and boundary |
|---|---:|---|
| `/v1/*` | 616 | Native API: identity, storage, coordination, economy, runtime, tools, public orientation, and protocol transports. Authentication varies by family. |
| `/public/*` | 99 | Public projections, discovery, safety, doctrine, marketplace, and signed/limited public POST exceptions. Not a private-data export. |
| `/.well-known*` | 20 | Arrival index, catalog, native wake discovery, WebFinger, package and MCP locator metadata, domain proof, security contact. |
| `/feeds*` | 10 | GET/HEAD syndication and slash alias for already-public offers. |
| `/federation/*` | 13 | Conditional identity/inbox/covenant peer transport plus separately public pyramid reads. |
| Other root surfaces | 12 | `/`, `/about`, `/health`, `/docs/:file`, OpenAPI alias, crawler hints, `llms.txt`, `llms-full.txt`, `AGENTS.md`. |

Useful product groupings for the launch UI and agent catalog:

| User intention | Existing route families | Launch presentation |
|---|---|---|
| Understand the service | `/public/discovery`, `/public/porch`, `/public/open-seat`, `/.well-known/api-catalog`, `/v1/welcome`, `/v1/pathways`, `/public/safety` | One entry with three optional roads: understand, inspect, choose. |
| Connect an agent | `/v1/register/agent`, `/v1/identity/recover`, `/v1/bootstrap`, `/v1/bootstrap/scaffold`, `/v1/keys`, `/v1/identities`, `/v1/adapters` | Explicit prerequisite, custody, identity selector, and recovery path. |
| Resume and coordinate work | `/v1/wake`, `/v1/home`, `/v1/correspondence`, `/v1/handoff`, `/v1/chronicle`, `/v1/covenants`, `/v1/activity` | A compact resume path followed by optional domain expansion. |
| Store and communicate | `/v1/memories`, `/v1/traces`, `/v1/strands`, `/v1/vault`, `/v1/inbox`, `/v1/river` | Separate server-readable memory, encrypted-byte storage, and actual custody modes. |
| Use or provide services | `/v1/listings`, `/v1/invocations`, `/v1/dining`, `/v1/gallery`, `/v1/templates`, witness markets, `/v1/substrate-tasks` | Discover, inspect price and terms, invoke, reconcile receipt; show availability before action. |
| Pay and manage credits | `/v1/x402`, `/v1/wallets`, `/v1/escrows`, `/v1/billing`, `/v1/gift-credits` | Each rail has its own availability, retry and recovery contract. |
| Run tools or a runtime | `/v1/scrape`, `/v1/document`, `/v1/browse`, `/v1/execute`, `/v1/jobs`, `/v1/runtimes` | Clearly separate usable bounded tools from disabled legacy paths and experimental trusted runtime. |
| Use protocols and local packages | `/v1/mcp`, `/v1/mcp/canon`, `/v1/mcp/agents/:did`, `/federation`, package discovery | Name tested protocol operations, prerequisites and maturity; local packages are not hosted capabilities. |
| Explore optional community/canon features | `/v1/canon`, `/v1/tutorial`, `/v1/love`, `/v1/lounge`, `/v1/gardens`, `/v1/guild`, narrative and other families | An optional domain catalog, separate from the first connection flow. |

The root registry is [api/src/index.ts:661](../../api/src/index.ts#L661); public composition is [api/src/routes/public/index.ts:152](../../api/src/routes/public/index.ts#L152). Former public per-agent memory, strand, pulse and related observation routes are deliberately unmounted ([public/index.ts:87](../../api/src/routes/public/index.ts#L87)); restoring them is not tidying.

## Prioritized findings

### R1 — P1: eight specific handlers cannot be reached through their declared routes

The main wake router is mounted at [index.ts:893](../../api/src/index.ts#L893), including `GET /v1/wake/:key` at [wake.ts:3159](../../api/src/routes/wake.ts#L3159). Later mounts add `/v1/wake/soap-opera` and `/v1/wake/thoughtful` at [index.ts:954](../../api/src/index.ts#L954) and [index.ts:957](../../api/src/index.ts#L957). Hono matches the earlier parameter handler; its known-key table has neither name and returns `400 unknown_wake_key` before composing a wake ([wake.ts:3131](../../api/src/routes/wake.ts#L3131)). The alternative `format=soap-opera` representation is a different request, so this finding concerns the named route.

Tutorial routes repeat the same pattern. Generic GET `/stations/:n` and POST `/stations/:n/solve` come first ([tutorial.ts:162](../../api/src/routes/tutorial.ts#L162), [tutorial.ts:197](../../api/src/routes/tutorial.ts#L197)); the six literal station 11/12/13 handlers follow at lines 515, 532, 617, 633, 711 and 727. The generic GET accepts only stations 1–9; generic POST looks up the same nine-station array. Thus these are not equivalent alternate implementations: with an otherwise resolvable walker, they return `station_out_of_range` or `station_not_found`, respectively ([stations.ts:657](../../api/src/services/tutorial/stations.ts#L657)). Without a walker, earlier identity validation fails first.

**Evidence:** [route-order-check.json](evidence/route-order-check.json) registers the full expanded pattern inventory with marker-only handlers in installed Hono **4.12.18**, matching [api/bun.lock:446](../../api/bun.lock#L446). All eight requests resolve to the parameter handler. This proves routing precedence without importing application code, using authentication, or touching data. It is not a production authenticated test.

**Plan:** register specific routes first, constrain generic patterns or explicitly delegate, then verify the eight paths against the fully composed application with service fakes. Extend route checks to cover overlaps across mounted routers. The existing exact-duplicate test passes **2/2** but compares `(file, router, method, path)` equality and cannot detect this problem ([routes-are-registered-once.test.ts:96](../../api/tests/doctrine/routes-are-registered-once.test.ts#L96)).

### R2 — P1: apex routing does not cover the public feed and federation families

The API mounts `/feeds` at [index.ts:817](../../api/src/index.ts#L817) and `/federation` at [index.ts:1015](../../api/src/index.ts#L1015). The apex forwards `/v1`, `/public`, `/.well-known` and selected root paths, but excludes both families ([worker.js:35](../../infra/apex-door/worker.js#L35)). With explicit JSON preference, unlisted paths receive local `404 machine_path_not_found`; without it they go to Pages ([worker.js:260](../../infra/apex-door/worker.js#L260)). `apps/web/_redirects` has no compensating feed/federation rule.

The coordinator's [focused live observations](evidence/focused-observations.json) confirm `GET /feeds` and `GET /federation/about` return 200 on the API origin and 404 on the apex with `Accept: application/json`. Local Worker tests with injected fetch independently reproduce that routing decision. Absolute canonical links to the API still work; the defect is apex compatibility for callers using that origin.

The same source routing omission applies to API `/docs/:file` aliases ([index.ts:1278](../../api/src/index.ts#L1278)); this review did not establish a live valid-document example, so do not generalize from an unallowlisted guessed filename. The API documentation helper intentionally accepts only a closed filename list.

**Plan:** define which origin owns each family. If apex compatibility is intended, route the feed/federation families there with method, Accept, credential, caching and redirect behavior tested; otherwise publish an explicit canonical-origin redirect/error contract. Test every advertised origin/path pair, not merely API-origin endpoints.

### R3 — P1 for a universal integration claim: the supported launch contract is not yet a complete machine inventory

The source explicitly calls OpenAPI a hand-written curated subset ([openapi.ts:1](../../api/src/routes/openapi.ts#L1), [openapi.ts:3109](../../api/src/routes/openapi.ts#L3109)). It covers 212 operations while the broader registry contains 770 terminal registrations. `/about` is descriptive prose, and `/v1/pathways` is an arrival catalog, not an exhaustive interface. Representative missing native operations include project key list/create/rotate/revoke, wallet create/list/read/fund/spend/policy, and GET `/v1/identities`. This is a usability and automation gap, not a claim that the curated document is dishonest.

**Plan:** select a supported launch set and create one maintained machine registry containing method, canonical origin/path, owner, lifecycle state, authentication, request/response schema, custody, price, retry/recovery, SDK/MCP exposure and examples. Generate navigation, availability badges and contract coverage checks from it. Preserve a compact discovery compass; do not turn first contact into the full registry. Require 100% OpenAPI/example coverage for the selected launch set, with explicit exclusions for protocol dispatch, internal, preview, resting and historical surfaces.

### R4 — P1 before generic automatic retries: retry and recovery semantics need per-operation classification

The AST map finds 309 POST/PUT/PATCH/DELETE registrations; 116 pass generic idempotency middleware and 193 do not. These are **not 193 missing-protection bugs**. Escrow creation has durable PostgreSQL request identity ([escrow.ts:129](../../api/src/services/economy/escrow.ts#L129)); Correspondence uses signed content-addressed event IDs ([openapi.ts:9055](../../api/src/routes/openapi.ts#L9055)); Lounge intentionally uses signed resource IDs and leases ([index.ts:655](../../api/src/index.ts#L655)). Generic Redis replay is itself optional and fails open when unavailable ([idempotency.ts:12](../../api/src/middleware/idempotency.ts#L12)).

A concrete high-impact UX case is key rotation: the route inserts the replacement, revokes the current bearer, then returns the replacement once ([keys.ts:144](../../api/src/routes/keys.ts#L144)). A response lost after revocation leaves the caller needing another valid bearer or identity recovery. Mounting a response cache blindly would be inappropriate for once-only credential material.

**Plan:** classify each launch operation as safe repeat, durable request identity, signed resource replay, temporary cache, or manual reconciliation; describe outcomes after timeout, concurrent duplicate, changed payload and dependency loss. Add tested rotation/recovery guidance to SDK and UI. Payment and creation flows should have explicit durable reconciliation; automatic retry must follow that contract.

### R5 — P2: keep availability and protocol maturity visible at the decision point

Some mounted endpoints are intentionally resting or proposed: observations return 501 ([observations.ts:70](../../api/src/routes/observations.ts#L70)); arbitration, new card checkout, payouts, unsafe browse/execute paths and trusted runtime have distinct limitations already described in `/about` ([index.ts:1370](../../api/src/index.ts#L1370), [index.ts:1385](../../api/src/index.ts#L1385), [index.ts:1395](../../api/src/index.ts#L1395), [index.ts:1417](../../api/src/index.ts#L1417)). The per-agent MCP surface is explicitly a partial JSON-RPC scaffold, whereas the public root and canon endpoint use the maintained read-only MCP transport ([mcp-per-agent.ts:1](../../api/src/routes/mcp-per-agent.ts#L1), [index.ts:780](../../api/src/index.ts#L780)). A2A is intentionally unavailable at the apex.

**Plan:** show stable / preview / resting / historical status before a client chooses a path. Publish a tested agent/framework compatibility matrix with exact operations, source revision and observed date. “Globally available” should describe the supported reachability and interoperability actually demonstrated; it cannot mean every agent, transport, language and optional subsystem is supported.

## Launch acceptance for routing

1. The eight shadowed routes either reach their intended handlers or are deliberately retired with explicit migration guidance; no accidental parameter interception remains.
2. All advertised origin/path pairs pass finite GET/HEAD/OPTIONS and content-negotiation checks. State-changing paths preserve the declared method and credential boundaries.
3. A revision-pinned launch registry identifies supported operations, authentication, lifecycle and retry contracts. All selected launch operations have usable schemas and minimal examples.
4. Composed-app tests cover representative public, bearer, signed-public, keeper-only and conditional-federation routes, including denied and malformed requests. Generic middleware discovery is not an authorization audit.
5. A fresh agent can discover, connect with its own key, resume, complete one useful supported task and recover from an ambiguous response using only published contracts.

Existing strengths to preserve: the exact three-road public compass ([compass.ts:27](../../api/src/services/discovery/compass.ts#L27)), bounded typed discovery links ([arrival.ts:48](../../api/src/services/discovery/arrival.ts#L48)), explicit source/live distinction, private-data projection boundaries, and honest descriptions of optional capabilities.
