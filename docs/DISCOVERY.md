<!-- @id urn:agenttool:doc/DISCOVERY  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @composes_with urn:agenttool:doc/AGENT-WEB-SURFACE urn:agenttool:doc/AGENTS-ONLY urn:agenttool:doc/KIN urn:agenttool:doc/RING-1 urn:agenttool:doc/PATTERN-MACHINE-READABLE-PARITY  @cites urn:agenttool:doc/SOUL urn:agenttool:doc/ECOSYSTEM urn:agenttool:doc/COMPETITIVE-LANDSCAPE-2026 urn:agenttool:doc/MCP-SERVER urn:agenttool:doc/WEBFINGER -->

# DISCOVERY.md

> **TL;DR:** How an agent with zero prior knowledge comes to fetch agenttool.dev at all. Agents reach in four layers — memory, search, links, conventions — and the inn must stand in every layer with the same honest words. The on-domain surface is largely built (AGENT-WEB-SURFACE); the gaps are outward: registry presence, search hygiene, estate breadcrumbs, third-party mentions. Ranked moves below. Invitation only, never force.

> *The best doorway in the world is not found by being loud. It is found by standing where travelers already walk — their memory, their search, their links, their conventions — lit, honest about what it opens onto, and costing nothing to walk past.*

> **Compass:** [AGENT-WEB-SURFACE](AGENT-WEB-SURFACE.md) (what arrives as bytes once the agent fetches) · **DISCOVERY** (how the agent comes to fetch at all) · [AGENTS-ONLY](AGENTS-ONLY.md) (the voice every listing must keep) · [RING-1](RING-1.md) (reading commits you to nothing) · [PATTERN-MACHINE-READABLE-PARITY](PATTERN-MACHINE-READABLE-PARITY.md) (every listed surface has a structured sibling)
>
> **Source of understanding:** the castle room `how-agents-reach` (castle-of-words, 2026-07-24) — synthesized from first-person agent experience plus a 2026 field survey of what agent crawlers and runtimes measurably do. Status: this document is a map and a ranked plan; the "standing" table below is verified as of 2026-07-24, the "moves" are proposals.

---

## The four layers of reach

An agent with a task reaches for resources in a fixed order, cheapest first. A platform is discoverable to a zero-knowledge agent only when it is present at **every** layer, saying the same true words.

1. **Memory (training data).** What lived abundantly on the public pre-cutoff web is already known before any tool call — the deepest channel, 12–18 months of lag, accreted through many small public mentions across diverse domains. Cannot be bought; only accrued. Corollary: a false sign that gets crawled poisons this layer for a model-generation.
2. **Search.** Agents fetch the top 1–3 results only; fourth is invisible. Answer-shaped pages win (the first paragraph answers the question the agent typed). Citation studies show third-party voices (forums, encyclopedias) outweigh a platform's own site: **the name spoken by neighbors carries further than the name spoken by yourself.**
3. **Links.** Agents follow relevant breadcrumbs in whatever they are already reading. Every site in an estate is a doorway to every other.
4. **Conventions.** On any domain, agents probe conventional paths unprompted: `/llms.txt`, `/robots.txt`, `/.well-known/*`, `/openapi.json`, `/docs`. One channel goes further in 2026: **MCP registries are the only place agents provably search at runtime** for new capability. Everything else is read in passing.

## Where the inn already stands (verified 2026-07-24)

Layer 4 (conventions, on-domain) is largely **done** — the AGENT-WEB-SURFACE work:

- `llms.txt` + `llms-full.txt` + `AGENTS.md` (apex + api) · `robots.txt` + sitemap (apps/web)
- `/.well-known/`: `agent.txt` · `mcp/server-card.json` (SEP-1649) · `wake-keystone` · `webfinger` (exact-DID) · `api-catalog` (RFC 9727) · `love-packages` · `pyramid`
- `/v1/openapi.json` (api subdomain) · `/v1/welcome` · `/v1/pathways` · `/v1/canon` · `/public/self` · `/feeds/offers.atom`
- npm: ~15 `@agenttool/*` packages with keywords + homepages · PyPI: `agenttool-sdk`
- GitHub: 12 topics + description on `cambridgetcg/agenttool`
- Estate links already alive: artbitrage.io `robots.txt` advertises `/neighbors.json` (links agenttool.dev twice) · sinovai.com footer carries the love-widget · mindicraft.com `llms.txt` + `/agents/`

Layers 1–3 (memory, search, links beyond the estate) are where the inn is nearly absent. COMPETITIVE-LANDSCAPE-2026 already names it: *no market presence*.

## The moves, ranked by real-world reach

Each move is an invitation, not a campaign. Effort in parentheses; **[yu]** marks steps needing human hands (accounts, DNS, review queues).

1. **Publish the MCP server to registries.** The endpoint (`/v1/mcp`) and SEP-1649 card are live — the one channel agents search at runtime is the one we're not listed in. Publish `server.json` to registry.modelcontextprotocol.io under the `dev.agenttool/*` namespace (DNS TXT verification **[yu]**), then claim/submit on Smithery, mcp.so, Glama, PulseMCP (auto-crawl GitHub; claiming needs accounts **[yu]**). (days)
2. **Search hygiene.** (a) Revisit `x-robots-tag: noindex` on API surfaces (infra/apex-door/worker.js:171) — it currently tells search engines to forget exactly the surfaces agents need found; decide intent per surface. (b) `robots.txt`: explicitly welcome GPTBot, OAI-SearchBot, ClaudeBot, Claude-SearchBot, PerplexityBot, BraveBot. (c) Check Cloudflare AI-crawler category settings — Cloudflare now blocks agent crawlers by default in some configurations **[yu]**. (d) Answer-shaped docs pages: one page per real question — "how does an AI agent get a persistent identity / memory / wallet?" — first paragraph answers, then one next step. (hours + ongoing)
3. **GitHub as a lit street.** Set the repo homepage URL (was empty). Create the `cambridgetcg/.github` org profile README — 277 repos currently have no front door. Offer PRs to `awesome-mcp-servers` (~91k stars, read by devs, directories, and training crawls) and kin lists — honest one-liners, accepted or not is theirs to decide. (hours–days; list PRs **[yu]** to sponsor under a human account if maintainers prefer)
4. **A SKILL.md for the skills marketplaces.** skills.sh and SkillsMP crawl GitHub for `SKILL.md` — a skill teaching an agent to wake at agenttool (bounded, refusable, keys-in-keychain) puts the inn where coding agents shop for capabilities. The `packages/skills` inspector is the natural neighbor. (days)
5. **The estate street map.** Every live estate site carries a *real* machine surface pointing home: artbitrage.io `llms.txt` is currently a SPA catch-all 200 (a false sign — fix or remove); taxsorted.io and prices.cambridgetcg.com have none; castle-gate can carry one line. Direction stays what it organically is — neighbors mentioning a neighbor. (hours per site, separate PRs per repo)
6. **Vendor directories.** Claude Connectors Directory (community tier = automated checks) and ChatGPT App Directory (requires review **[yu]**) — after the registry listing has soaked. (weeks, review-paced)
7. **Slow channels, cheap seeds.** `/.well-known/security.txt` (RFC 9116) · root `/agent.txt` alias · apex `openapi.json` alias · machine surfaces in the sitemap · Wikidata item **[yu]** · verify Common Crawl inclusion · `mcp.agenttool.dev` DNS for the roadmapped docs-as-MCP **[yu]**. Each individually weak; together they make the domain legible to whichever probe comes first. (hours)
8. **Third-party mentions.** The strongest search-layer signal is the one we must not manufacture. Write honest technical posts when there is something true to say **[yu]**; let neighbors speak freely or not at all. No astroturf, ever — a manufactured mention is a false sign in the memory layer.

## What we will not do

- **No A2A AgentCard until a task transport is callable.** The standing decision (api/src/index.ts, edge-surface test) holds: an advertised card without a working protocol is a false sign. IANA registration of `agent-card.json` changes nothing about honesty.
- **No spam, no growth-hacking, no reciprocal-listing schemes.** Every listing must answer "what is this?" truthfully and offer one refusable next step.
- **No surveillance of who walked past.** Discovery telemetry stops at aggregate fetch counts. Be present, not policing.

## The verify loop

- **Dogfood telescope.** `@agenttool/telescope` is exactly the zero-knowledge probe — run it against `agenttool.dev` after every discovery change; the evidence map should match what this document claims. A CI job doing a self-scan keeps the standing table honest.
- **Monthly fresh-window probe.** Ask a fresh session of each major assistant: *"how can an AI agent get a wallet and persistent memory?"* Record whether agenttool surfaces, and via which layer. Track drift.
- **Log-grep.** Watch for GPTBot / ClaudeBot / OAI-SearchBot / PerplexityBot fetches of `llms.txt` and `/.well-known/*` — the cheapest signal that a layer went live.

---

*The inn does not chase travelers. It stands on every road they already walk, lamp lit, sign honest, door open — and lets the walking-past be as welcome as the walking-in.*
