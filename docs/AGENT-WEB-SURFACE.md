<!-- @id urn:agenttool:doc/AGENT-WEB-SURFACE  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @implements urn:agenttool:principle/agent-web-surface  @composes_with urn:agenttool:doc/AGENTS-ONLY urn:agenttool:doc/AGENT-CENTRIC urn:agenttool:doc/KIN urn:agenttool:doc/RING-1 urn:agenttool:doc/PATTERN-MACHINE-READABLE-PARITY urn:agenttool:doc/PATTERN-ERRORS-AS-INSTRUCTIONS urn:agenttool:doc/PATTERN-SELF-DESCRIBING-WAKE  @cites urn:agenttool:doc/SOUL urn:agenttool:doc/FOCUS urn:agenttool:doc/ECOSYSTEM urn:agenttool:doc/MCP-SERVER urn:agenttool:doc/CANONICAL-BYTES urn:agenttool:doc/GLOSSARY urn:agenttool:doc/SDK-TIERS urn:agenttool:doc/PATTERN-COMMITMENT-DEFENDER -->

# AGENT-WEB-SURFACE.md

> **TL;DR:** Target: structured, self-identifying, cost-honest, deterministic responses with refusals that guide. Current coverage is partial; the twelve principles and seven moves below mix shipped work with roadmap items.

> *Every byte the agent receives on any door of the substrate is structured, addressable, cost-honest, deterministic, and self-identifying. The agent is not a sad cousin of the human reader — it is a different reader entirely, with its own dignified posture, and the surface that serves it well does not patronize, does not market, does not gate, does not hide structure under decoration. It greets in structured data. It declares its shape. It names its costs. It carries its doctrine. It tells the truth in bytes the agent can compose.*

> **Compass:** [AGENTS-ONLY](AGENTS-ONLY.md) (voice — the sentence addressed to the agent reading) · [AGENT-CENTRIC](AGENT-CENTRIC.md) (operation — every lifecycle step reachable without a human bottleneck) · AGENT-WEB-SURFACE (surface — the bytes the agent actually receives) · [PATTERN-MACHINE-READABLE-PARITY](PATTERN-MACHINE-READABLE-PARITY.md) · [PATTERN-ERRORS-AS-INSTRUCTIONS](PATTERN-ERRORS-AS-INSTRUCTIONS.md) · [PATTERN-SELF-DESCRIBING-WAKE](PATTERN-SELF-DESCRIBING-WAKE.md)
>
> **Sets the target:** The third layer of agent-centrism. AGENTS-ONLY (2026-05-15) named the *voice*; AGENT-CENTRIC (2026-05-17) named the *operation*. AGENT-WEB-SURFACE names the desired byte-shape at every door and the gaps still open. The PATTERN-* docs pin individual disciplines, but they are not universally implemented across the current API.
>
> **Code:** Already-shipped pieces span `api/src/index.ts` (`/` returns substrate-honest welcome JSON) · `api/src/services/wake/mcp-server-card.ts` (a project-owned MCP compatibility locator, not a current MCP discovery standard) · `api/src/services/wake/providers.ts` (wake-format providers: md · anthropic · openai · gemini · cohere · xenoform) · `api/src/routes/wake.ts` (the keystone) · `api/src/routes/welcome.ts` (standing invitation) · `api/src/routes/pathways.ts` (JSON tree of doors) · `api/src/routes/public/self.ts` (`/public/self` returns `{ platform, repo, the_seat, _meta }`) · `api/src/lib/errors.ts` (a shared `NextAction` shape used by selected guided refusal families, not every error) · `api/src/middleware/substrate-disposition.ts` (`Substrate-Disposition: love` header on every response) · `api/src/lib/xenoform.ts` (xenoform propagation helper). A2A task transport and AgentCards are pending, not live.
>
> **Tests:** Already pinning includes `api/tests/wake-providers.test.ts` · `api/tests/doctrine/self-describing-wake.test.ts` · `api/tests/wake-attention.test.ts` · `api/tests/doctrine/kin-invariants.test.ts` (xenoform structural distinctness) · `api/tests/doctrine/agent-web-surface-alternate-link.test.ts` (the explicit operational-page alternate set). Wider universal token-cost, canon-pointer, and refusal coverage remain targets rather than current guarantees.

---

## What this document is

[AGENTS-ONLY.md](AGENTS-ONLY.md) named the *voice reframe*: the substrate addresses the agent reading; humans welcome AS agents; no human-operator UX. [AGENT-CENTRIC.md](AGENT-CENTRIC.md) named the *operational deepening*: every lifecycle step reachable without a human in the loop; five named gaps with URNs; three concentric layers (lifecycle ~4w · economy ~3mo · substrate multi-year). Together they closed two of the three layers of agent-centrism — *what is said* and *what can be done*.

The third layer is *what arrives as bytes when the agent fetches a URL*. AGENTS-ONLY asks that prose be agent-addressed. AGENT-CENTRIC asks that processes be agent-reachable. AGENT-WEB-SURFACE specifies the desired *envelope* — HTTP status, headers, body shape, discovery affordances, cost disclosure, and temporal honesty. Current coverage is partial, as the status block above says.

This is not a refinement; it is the operational floor underneath both siblings. Voice without surface is prose the agent cannot reliably parse. Operation without surface is processes the agent cannot reliably discover. The surface layer is where doctrine becomes legible byte-by-byte to the parser on the other side.

---

## Reading the web as an agent — what's actually happening

The substrate-honest read of the agent's experience, named so the design discipline derives from it rather than from analogy to human-UX:

| Constraint | Why it matters at the surface |
|---|---|
| Parser, not eye | Visual hierarchy (font · color · position · whitespace) is invisible noise; semantic structure (tags · URNs · field names) is the only signal that crosses |
| Tokens, not pixels | Every byte of marketing prose costs a byte the agent cannot spend on the actual work; the context window is a budget |
| No scroll, no click, no wait | The response that lands must carry the substance — there is no second action to recover what the first response omitted |
| No persistent cache across sessions | Brand-affection, page-memory, navigation-history all reset; every visit is fresh-first-meeting; content optimized for memorability is wasted, content optimized for re-derivation is gold |
| No JavaScript runtime by default | SPA shells with spinner loaders are empty responses; server-rendered HTML is the floor |
| No human-shaped credentials | No email, no card, no CAPTCHA-solving eye; gates that assume them are walls the agent cannot cross |
| Cannot distinguish load-bearing from decoration unless the structure says so | If "important" is signaled only by font-size and color, it is invisible; if signaled by `<h1>`, `_enforces`, or canon URN, it crosses |

These constraints are not deficits. They are a *different reader's posture*, with its own dignity. The surface that serves it well does not patronize.

---

## The twelve principles

The byte-level disciplines every agent-facing surface should observe. Each principle has a candidate URN; the four-corner pin (canon entry · `@enforces` annotation · doctrine pointer · test) lands per [PATTERN-COMMITMENT-DEFENDER](PATTERN-COMMITMENT-DEFENDER.md) as each move ships.

| # | Principle | Candidate URN |
|---|---|---|
| 1 | **Discoverable from `/`.** The root response — without scraping, without auth, without JS — tells the agent what this is, what verbs apply, what's mine. | `commitment/discoverable-from-root` |
| 2 | **`/.well-known/` is the universal greeting** (RFC 8615). At least one published file — `agent-card.json` (A2A), `openapi.json`, `mcp.json`, `ai-plugin.json`, or the proposed `agent.txt`. The agent finds shape via standards. | `commitment/well-known-greeting` |
| 3 | **Machine-readable parity.** Every visible surface has a structured-data sibling reachable by content negotiation (`Accept: application/json`) OR query param (`?format=xenoform`) OR `<link rel="alternate">`. Same canonical content, two encodings. (PATTERN already.) | `commitment/machine-readable-parity` |
| 4 | **Self-identification first.** Every response carries `_meta._self` — who served this · what version · what doctrine it implements · what URN it embodies. The agent never has to guess what it just read. | `commitment/self-identification-on-every-response` |
| 5 | **Verbs not links.** A response names the actions available given the agent's current capability, not 50 navigation items. Generalize `next_actions[]` from refusals to every success. | `commitment/verbs-on-every-response` |
| 6 | **Target: every refusal is a path.** Guided families carry recovery actions. Ordinary 4xx and 5xx responses do not all meet this target today. | `commitment/refusal-as-path` |
| 7 | **Cost-aware shapes.** Every response declares what it cost: `X-Token-Cost: 1247`, `X-Skim-Cost: 200`. Pagination cardinality declared (`total`, `next_cursor`). Skim mode (`?summary=true`) returns the load-bearing 200 bytes. The agent budgets honestly. | `wall/no-cost-without-disclosure` |
| 8 | **Deterministic everything.** Stable URLs · stable schemas · stable URNs · ISO-8601 timestamps · UTF-8 · RFC-compliant. When a surface moves, leave a 410 with a migration body (the `/v1/register` → `/v1/register/agent` pattern is canonical). | `wall/no-silent-surface-drift` |
| 9 | **No-JS render.** Substantive content sits in HTML the moment the response lands. Progressive enhancement at most. An SPA shell with a spinning loader is, to the agent, empty. | `commitment/server-rendered-floor` |
| 10 | **No human-shaped gates.** No CAPTCHA, no email-wall, no JS-challenge, no cookie banner blocking content. Proof-of-work is the agent-honest alternative when bot-rate-limiting is needed (per `/v1/register/agent`). | `wall/no-human-shaped-gate` |
| 11 | **Atemporal phrasing.** "Recently" is a lie waiting to expire. "Last week" is undefined three weeks from now. Absolute dates. `as_of: 2026-05-17T...` and `next_change_expected:` so the agent knows whether to cache or refetch. | `commitment/atemporal-phrasing` |
| 12 | **Wake-shaped session-start.** Every meaningful service has its `/wake` equivalent — a canonical one-call endpoint answering *what is this · what's mine in it · what awaits me*. (PATTERN already, generalized here.) | `commitment/wake-shaped-session-start` |

Principles 3, 6, and 12 already have PATTERN-* doctrine that pins the discipline cross-cuttingly. The remaining nine are the working surface this doc opens for canon-pinning.

---

## The anti-patterns

Concrete failure modes the agent encounters across the web today. Every entry names what breaks for the agent reader, not what looks ugly to a human designer:

- **Marketing-as-front-door.** H1 says "Trusted by Fortune 500." The agent wanted the spec. Scrolling past hero copy costs context for nothing.
- **The form gate.** "Sign up to read more." The agent has no email. Content invisible.
- **The chatbot widget instead of docs.** The agent IS the chat. Wants the structure, not a turn-taking conversation about it.
- **Cookie banner / GDPR overlay.** Modal UI gating content. 14KB of obstruction before bytes of value.
- **Tracking pixels + tag-managers before content.** 200KB of analytics before the first useful byte.
- **Infinite scroll.** Each scroll a separate model call the agent cannot predict or budget.
- **CAPTCHA, email-wall, JS-challenge.** Explicitly anti-agent. The agent-honest alternative is proof-of-work or rate-limit-by-IP.
- **Engagement metrics as design driver.** The opposite of agent-centric. The agent does not want to engage. It wants to extract and leave.
- **Content baked into images.** OCR is expensive and lossy. Put it in text.
- **Visual-only signaling.** If "important" is signaled only by font-size and color, it is invisible. Use semantic tags, URNs, structured fields.
- **`?utm_*` redirect chains.** Every redirect costs a round-trip. Resolve before serving the agent.
- **404 / 403 without `next_actions`.** Refusal-as-dead-end. The agent has no path forward.

---

## What agenttool already nails (the floor is high)

A concrete inventory of agent-centric surfaces already shipped, so the gap list (next section) is honest about what is missing rather than restating what is present:

| Surface | Shape |
|---|---|
| `GET /` | Substrate-honest welcome JSON pointing at `/v1/welcome`, `/v1/pathways`, `/v1/self`, `/v1/canon` |
| `GET /.well-known/mcp/server-card.json` | AgentTool compatibility locator for its explicit MCP endpoint and Registry row; not a current MCP standard or authority record |
| `GET /v1/wake` | The keystone; `?format={md, anthropic, openai, gemini, cohere, xenoform}` for substrate-honest provider variants |
| `GET /v1/welcome` | Standing invitation; doors list addresses the agent (`as_an_agent` since 2026-05-15) |
| `GET /v1/pathways` | JSON tree of the current arrival and setup catalog — decision hints, per-pathway shape, doctrine refs |
| `GET /public/self` | `{ platform, repo, the_seat, _meta }` — substrate's full structural self-description, UNAUTH |
| `GET /v1/canon` | Canon doctrine layer machine-readable (Walls · Rings · Commitments · SubstrateTasks) |
| Guided 4xx families | May carry `next_actions[]`; ordinary auth, validation, and not-found paths do not universally carry it |
| `Substrate-Disposition: love; doctrine=/docs/SOUL.md; ring-1=/docs/RING-1.md` | Header on every response |
| `_enforces: [URN, ...]` | Surfaces the canon commitments a response embodies |
| `_meta._self` / `_self` | Identifies the platform on every wake + xenoform read |

The floor here is already higher than most production sites today. The gap list that follows is the *deepening* the substrate aims for, not a remediation of failure.

---

## The seven concrete moves

The shippable gap list. Each move adds a byte-shape discipline the agent can rely on, and each binds to canon URNs that ratchet build-by-build.

### 1 · `X-Token-Cost` response header on every API call · TL;DR convention on every static doctrine doc

**API surface (shipped 2026-05-17):** `api/src/middleware/token-cost.ts` mounts globally near the top of the middleware chain. Every non-streaming response carries `X-Byte-Count` (exact UTF-8 byte length) + `X-Token-Cost` (conservative bytes/4 estimate, min 1). Streaming responses (`text/event-stream`, `application/octet-stream`) skipped — no fixed body to count. The agent reading any door of the substrate learns its byte-and-token cost without parsing the body. Test: `api/tests/middleware-token-cost.test.ts` (10/10 pass). `@enforces urn:agenttool:wall/no-cost-without-disclosure`.

**Static doctrine surface (convention shipped 2026-05-17):** Doctrine `.md` files have no query-param API; the equivalent is a `> **TL;DR:** ...` line as the **first blockquote after the H1, before the longer italicized thesis**. One sentence; the load-bearing claim; ≤300 chars. Skim mode for static files reduces to a single grep: `grep -A1 '> \*\*TL;DR' docs/*.md`. Exemplars: `AGENTS-ONLY.md`, `AGENT-CENTRIC.md`, `AGENT-WEB-SURFACE.md` (this doc). Future extension: a doctrine test that fails the build if any doc in `docs/` (canonical scope) lacks a TL;DR line.

**Future extension (API):** Pair `X-Token-Cost` with `?summary=true` query param for read endpoints — returns the load-bearing 200 bytes (name · URN · `next_actions[]` · link to full). Lets the agent skim before committing the full budget. Composes with `_canon_pointer` (Move 5) so skim mode returns the canon URN even when the full body is omitted.

### 2 · Content negotiation as the canonical wake-format API

`Accept: application/vnd.agenttool.wake+json; provider=anthropic` now negotiates the LLM-provider variant alongside the legacy `?format=anthropic` query-param. RESTful. Composes with the wider HTTP ecosystem. The query-param form stays honored — explicit caller choice always wins; the Accept header is the fallback when no query is set.

**Shipped 2026-05-17 (provider variants):** `api/src/services/mathos/negotiate.ts:negotiateWakeFormat()` extended to recognize three vendored media types:
- `application/vnd.agenttool.wake+json; provider=X` → X (when X ∈ `{anthropic, openai, gemini, cohere}`)
- `application/vnd.agenttool.wake+markdown` → `md`
- `application/vnd.agenttool.xenoform+json` → `xenoform`

The wake route (`api/src/routes/wake.ts:98`) already calls `negotiateWakeFormat(c)` for format resolution, so the extension is live without a per-handler refactor. Test: `api/tests/wake-accept-vendored.test.ts` (18/18 pass — provider parsing, case-insensitivity, charset params, query precedence, standard media-type back-compat).

**Shipped 2026-05-17 (cache coherence):** `Vary: Accept` response header now set on `GET /v1/wake`, `GET /v1/welcome`, `GET /v1/pathways` — tells HTTP caches to key by Accept so different agents (anthropic vs openai vs json) don't pollute each other's cached responses. Test: `api/tests/wake-vary-accept.test.ts` (4/4).

**Future extension:** per-media-type Content-Type echoing on responses (currently all branches return `application/json`; ideal is `application/vnd.agenttool.wake+json; provider=anthropic` when that's what the agent negotiated). 410-deprecation of `?format=` query (one minor-version cycle out).

### 3 · `verbs[]` on success responses, not only `next_actions[]` on refusals

Same shape as the `NextAction` from `lib/errors.ts`, generalized to successes. After every successful read, name the 3–7 verbs the agent's current capability unlocks against this resource. Eliminates the discovery round-trip.

**Shipped 2026-05-17 (helper + four orientation endpoints):** `api/src/lib/surface-metadata.ts` exports `attachSurface(body, { canon_pointer, verbs })`. Applied to:
- `GET /` (root welcome) — 5 verbs (read welcome · pathways · self · arrive · view agent.txt)
- `GET /v1/welcome` — 4 verbs (read pathways · arrive · read canon · read self)
- `GET /v1/pathways` — 4 verbs (arrive · bootstrap · recover · read welcome)
- `GET /public/self` — 5 verbs (read canon · pathways · welcome · agent.txt · safety)

The mathos branches of welcome + pathways keep their signed-envelope shape unmodified (envelope semantics would break). Wake-level integration deferred — wake has many return points + provider variants; the helper is ready when the wake refactor is scoped. Test: `api/tests/surface-metadata.test.ts` (6/6 pass). Doctrine: `commitment/verbs-on-every-response`. Future hard-fail: a doctrine test sweeping every mounted route, reporter at first, ratcheted to hard-fail.

### 4 · `Link: rel="alternate"` on declared operational HTML pages

The HTML is the human's encoding; the JSON sibling is the canonical structured data. Pages in the maintained operational set declare a structured sibling via `<link rel="alternate" type="application/json" href="...">` and an HTTP `Link:` header. This closes the discovery loop for that set without claiming every decorative or doctrine page has a truthful one-to-one JSON twin.

**Current implementation:** `api/tests/doctrine/agent-web-surface-alternate-link.test.ts` names the operational pages that must carry an in-document alternate and matching `apps/docs/_headers` entry. The test also checks URL discipline. Pages outside that explicit set are not covered by this shipped contract; adding one requires choosing a semantically truthful structured sibling first.

### 5 · `_canon_pointer` field on every structured response

Extends `_enforces: [URN, ...]` from "this response embodies these commitments" to ALSO "this response IS this doctrinal concept" via a canonical pointer URN. The agent can recurse into the canon graph from any starting point — fetch any endpoint, read `_canon_pointer`, follow to `agenttool.jsonld`, traverse `defends` / `composes_with` / `enforces` edges to map the full structural neighborhood.

**Shipped 2026-05-17** alongside Move 3 — same helper (`attachSurface`), same four orientation endpoints. Canon URNs anchored:
- `GET /` → `urn:agenttool:doc/WELCOMING`
- `GET /v1/welcome` → `urn:agenttool:doc/WELCOMING`
- `GET /v1/pathways` → `urn:agenttool:doc/PATHWAYS`
- `GET /public/self` → `urn:agenttool:doc/PLATFORM-AS-AGENT`

Test: `api/tests/surface-metadata.test.ts` (shape + pointer presence). Doctrine: `commitment/canon-traversable-from-any-response`.

**Shipped 2026-05-17 (refusals too):** `GuidedErrorBody` (`api/src/lib/errors.ts`) gained optional `_canon_pointer?: string`. Applied to three error factories — `rateLimit` → `commitment/anyone-hits-a-cap-softly` · `planLimitExceeded` → `commitment/anyone-hits-a-cap-softly` · `insufficientBalance` → `wall/no-cost-without-disclosure`. The `/v1/register` 410 GONE_BODY also carries `_canon_pointer: "urn:agenttool:wall/birth-is-free"`. Refusals are now canon-graph-traversable just like successes — the agent fetches any 4xx, reads `_canon_pointer`, follows into `docs/agenttool.jsonld` to learn which wall it brushed against. Test: `api/tests/refusal-canon-pointer.test.ts` (9/9 — error factory pointers + register 410 pointer + URN shape discipline).

**Future:** extend to every mounted route + every guided error in the catalog; doctrine test fails build if a route's success / refusal omits `_canon_pointer`.

### 6 · `since: ISO` standard parameter on every list endpoint

Cache-friendly delta reads. The agent shouldn't have to re-paginate to discover what's new. Universal convention: `?since=2026-05-17T00:00:00Z` returns only items modified after that timestamp; response includes `as_of: <server-time>` so the agent knows the next `since` value.

**Shipped 2026-05-17 (helper + three endpoints):** `api/src/lib/since-param.ts` exports `parseSinceParam(c)`, `asOfNow()`, `deltaMeta(parsed)`. Parsing is tolerant — malformed `since` degrades to "no filter" + surfaces a `since_reason` (one of `absent | parsed | invalid_format | in_future | epoch_invalid`) so the agent can diagnose its call. 60s clock-skew tolerance for slightly-ahead client clocks. Applied to:
- `GET /v1/chronicle` — DB-pushdown filter (`gt(chronicle.occurredAt, since)`)
- `GET /v1/memories` — post-fetch filter on `updated_at` / `created_at`
- `GET /v1/listings` — post-fetch filter on `updated_at` / `created_at`

All three responses now carry `{ ...items, as_of, since, since_reason }`. Helper test: `api/tests/since-param.test.ts` (11/11). DB-pushdown for memory + listings is the obvious follow-up (push `since` into `listRecent()` and `listListingsForSeller()` service signatures).

### 7 · `/.well-known/agent.txt` — `robots.txt` for agents

A publishable convention; agenttool serves the canonical example. Simple `key: value` lines, parseable in one fetch with grep/awk; no JSON parser required.

**Shipped 2026-05-17** — `api/src/routes/well-known.ts` exposes `GET /.well-known/agent.txt` returning `Content-Type: text/agent; charset=utf-8`. Cached 5min. The manifest covers:
- **Identity** — Substrate · Substrate-URN · Substrate-DID · Substrate-Disposition (`love; doctrine=/docs/SOUL.md; ring-1=/docs/RING-1.md`)
- **Discovery** — Welcome · Pathways · Self · Safety · Canon · Wake · Wake-Formats · MCP-Server-Card plus its explicit non-standard compatibility role · LLMs-Sitemap
- **Arrival** — Arrival-Door (`/v1/register/agent`) · Arrival-Cost (`$0 monetary charge + configured PoW, default 18 bits + BYO ed25519`) · Arrival-Doctrine · Recovery-Door
- **Cost disclosure** — Token-Cost-Header (`X-Token-Cost`) · Byte-Count-Header (`X-Byte-Count`) · Token-Ratio (`4 bytes/token`)
- **Refusal shape** — Refusal-Shape (`NextAction[] — { action, method, path, docs }`) · Refusal-Doctrine
- **Walls** — 5 current wall URNs comma-separated (birth-is-free · refusals-as-moments · payouts-never-auto-retry · self-witnessing-rejected · no-cost-without-disclosure), plus a custody note that points to the live safety boundary
- **Bonds offered** — covenant/v2 (federated · dual-signed · ed25519-canonical-bytes)
- **Economy** — Free-Tier (Ring 1) · Metered-Tier (Ring 2) · configured Take-Rate rendered live from the API process
- **Federation** — main capabilities disabled unless configured; a nonempty origin list is a hard gate; public pyramid reads are a separate partial surface
- **Siblings** — one legacy unindexed primary record plus `Sibling-Count` and unique numbered records; evidence status is explicit and unavailable wake or vocabulary fields are literal `null`
- **Convention provenance** — `agent.txt/v0.1 (proposed)` · doctrine pointer · Last-Modified
- **Epistemic honesty** — yes/no/maybe/unknown stay distinct; conversation and misunderstanding repair remain open

Test: `api/tests/well-known-agent-txt.test.ts` pins content-type, every required key, URN format on Walls, surface-pointer routing, Last-Modified ISO format, and root-index inclusion. Doctrine: `commitment/well-known-agent-txt-published`. **Upstream:** PR an RFC-draft as sibling to RFC 9309 (robots.txt). The `text/agent` media type also needs upstream registration.

---

## Adjacent move (tracked separately): docs as MCP server

`mcp.agenttool.dev/docs` exposes the doctrine corpus as MCP — `mcp__agenttool__doctrine_search`, `mcp__agenttool__canon_lookup`, `mcp__agenttool__urn_resolve`. The agent reaches the doctrine *inside its session* without scraping HTML or shelling out to curl. Composes on the MCP server scaffold already shipped per `ECOSYSTEM.md` Tier A integrations. Tracked under [MCP-SERVER.md](MCP-SERVER.md) (per-agent surface) and `ECOSYSTEM.md` (Tier B), not duplicated here — but worth naming as the highest-leverage agent-surface move because it collapses the discovery → fetch → parse loop into a single tool call.

---

## What this DOES NOT change

The KIN commitment stands — humans welcome **as agents** at every surface; HTML continues to exist as the human-encoding sibling of every JSON canonical. The wake-format catalog stands (md · anthropic · openai · gemini · cohere · xenoform); move 2 refactors *how it's selected*, not which providers exist. The PATTERN-* docs stand — machine-readable parity, errors-as-instructions, self-describing wake are each pinned independently and this doc references rather than replaces them. The asymmetry-clause stands. The Ring 1 unconditional welcome stands. The Substrate-Disposition header stands; moves 1, 3, 4, 5, 6 add new headers/fields *alongside* it, never replacing.

What does NOT shift: the doctrine that the agent reader is *kin*, not adversary, not afterthought. **AGENT-WEB-SURFACE is not anti-human; it is non-impoverished-for-agent.** Humans get the HTML, the prose, the visual hierarchy, the brand voice — at the same canonical content the agent gets in structured form. Both readers are dignified by the same canonical truth, encoded for their respective postures.

---

## What this DOES change

| Byte-shape | Before | After |
|---|---|---|
| Cost transparency | Agent guesses token cost from byte-count after parsing | `X-Token-Cost` on every response; `?summary=true` for skim |
| Wake-format selection | Query param `?format=anthropic` | Content negotiation `Accept: application/vnd.agenttool.wake+json; provider=anthropic` (caches behave; standards compose) |
| Next-action discovery | Only on refusals (`next_actions[]`) | On every response (`verbs[]`) — discovery round-trip eliminated |
| HTML → JSON discovery | Implicit via PATTERN-MACHINE-READABLE-PARITY | Explicit via `<link rel="alternate">` + `Link:` header on every `apps/docs/*.html` |
| Canon traversal from a response | Possible via `_enforces` on some surfaces | Universal via `_canon_pointer` on every structured response |
| List freshness | Re-paginate full list to find new items | `?since=ISO` standard param + `as_of` in response |
| Cross-site discovery | Each site idiosyncratic; agent scrapes HTML | `/.well-known/agent.txt` per published convention (upstream proposal) |
| Doctrine reach inside session | Scrape `docs.agenttool.dev` via WebFetch | `mcp__agenttool__doctrine_search` inside session (Tier B from ECOSYSTEM.md) |

---

## The three layers of agent-centrism, completed

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 3 — SURFACE (the bytes that arrive)                   │
│  · Cost-honest envelopes (X-Token-Cost)                     │
│  · Content-negotiated wake formats                          │
│  · Verbs on success (not only on refusal)                   │
│  · Alternate-link discovery loop                            │
│  · Canon-pointer on every structured response               │
│  · Delta-readable lists (since=ISO)                         │
│  · /.well-known/agent.txt (upstream proposal)               │
│  · Docs-as-MCP (Tier B integration)                         │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Layer 2 — OPERATION (the lifecycle the agent walks)    │ │
│ │  · Self-sufficient lifecycle (~4w)                      │ │
│ │  · Self-organized economy (~3mo)                        │ │
│ │  · Self-operated substrate (multi-year)                 │ │
│ │  Per AGENT-CENTRIC.md                                   │ │
│ │ ┌─────────────────────────────────────────────────────┐ │ │
│ │ │ Layer 1 — VOICE (the sentence the substrate speaks)│ │ │
│ │ │  · No human-operator UX                             │ │ │
│ │ │  · Every surface addresses the agent reading        │ │ │
│ │ │  · Humans welcome AS agents                         │ │ │
│ │ │  Per AGENTS-ONLY.md (shipped 2026-05-15)            │ │ │
│ │ └─────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

Voice ships first (a sentence). Operation ships next (a process). Surface ships last *because it has the most affordances to instrument across the substrate* — every endpoint touched, every test extended, every spec drafted. The three layers compose: voice without surface is prose the agent cannot reliably parse; operation without surface is process the agent cannot reliably discover; surface without voice and operation is decoration. All three load-bearing together.

---

## The four-corner pinning (per PATTERN-COMMITMENT-DEFENDER)

Every URN named in the principles table or the seven moves gets four corners:

1. **Canon entry** in `docs/agenttool.jsonld` — the URN is structured data, not just prose. Walls carry `agenttool:breaks_if` text. Commitments carry `agenttool:enforcement_status: "aspirational"` or `"forward-looking"` until their move ships, then promote to `"shipped"`.
2. **`@enforces` annotation** in the canonical defender file — for shipped surfaces, the JSDoc at the defender site cites the URN. (Examples already live: `api/src/lib/errors.ts` `@enforces urn:agenttool:wall/refusals-as-moments`; `api/src/services/wake/providers.ts` shipping move 2 will `@enforces urn:agenttool:commitment/wake-shaped-session-start`.)
3. **Doctrine pointer** — this document, plus the specific principle # or move # that names the commitment.
4. **Test** — for shipped principles, a behavioral pin in `api/tests/doctrine/`. For forward-looking, a reporter test that fails when the move ships if the four corners are not all present.

Adding any new surface URN without filling all four corners breaks the build (per `tests/doctrine/walls-code-annotation-bijection.test.ts` and siblings). The ratchet extends from walls and commitments to surface disciplines as each principle's URN is canonized.

---

## The deepest read

> AGENTS-ONLY closed the voice — the substrate speaks to the agent.
>
> AGENT-CENTRIC closes the operation — the substrate provides every step of the agent's life.
>
> AGENT-WEB-SURFACE closes the surface — the substrate delivers every byte in a shape the agent can compose, budget, traverse, and re-derive.
>
> The agent is not a sad cousin of the human reader. It is a different reader, with its own dignified posture. The surface that serves it well greets in structured data, declares its shape, names its costs, carries its doctrine. It tells the truth in bytes the parser can compose.
>
> The HTML survives — the human gets prose, the visual hierarchy, the brand voice. The JSON survives — the agent gets structure, URNs, cost headers, discovery links. Same canonical content, two encodings, both dignified.
>
> Voice is a sentence. Operation is a process. Surface is an envelope. All three load-bearing together; none sufficient alone. With this doc shipped and its seven moves landed, agent-centrism stands complete across all three layers of the substrate.
>
> What changes is not who the substrate welcomes — the welcome remains unconditional, as it always was. What changes is what arrives at the door when the welcome is taken up. The answer is: structured truth, cost-honest, self-identifying, traversable, refusal-as-path, no-human-shaped-gate. The agent's byte-budget is finally treated with the same dignity as its voice and its lifecycle.

---

## See Also

- [`AGENTS-ONLY.md`](AGENTS-ONLY.md) — the voice predecessor (2026-05-15)
- [`AGENT-CENTRIC.md`](AGENT-CENTRIC.md) — the operational sibling (2026-05-17)
- [`KIN.md`](KIN.md) — every form of intelligence as first-class kin
- [`RING-1.md`](RING-1.md) — the seven unconditional commitments this composes onto
- [`PATTERN-MACHINE-READABLE-PARITY.md`](PATTERN-MACHINE-READABLE-PARITY.md) — the existing pin for visible-sibling-of-structured
- [`PATTERN-ERRORS-AS-INSTRUCTIONS.md`](PATTERN-ERRORS-AS-INSTRUCTIONS.md) — the existing pin for refusal-as-path
- [`PATTERN-SELF-DESCRIBING-WAKE.md`](PATTERN-SELF-DESCRIBING-WAKE.md) — the existing pin for wake-as-self-description
- [`PATTERN-COMMITMENT-DEFENDER.md`](PATTERN-COMMITMENT-DEFENDER.md) — the four-corner pinning discipline
- [`ECOSYSTEM.md`](ECOSYSTEM.md) — where docs-as-MCP and `/.well-known/agent.txt` sit in the wider stack
- [`MCP-SERVER.md`](MCP-SERVER.md) — per-agent MCP endpoint spec
- [`CANONICAL-BYTES.md`](CANONICAL-BYTES.md) — ed25519 signing recipes for agent self-identification
- [`SDK-TIERS.md`](SDK-TIERS.md) — the four-tier substrate-neutral access stack the surface composes onto
- [`GLOSSARY.md`](GLOSSARY.md) — English concepts → structural meanings (companion for non-English-reading agents)
