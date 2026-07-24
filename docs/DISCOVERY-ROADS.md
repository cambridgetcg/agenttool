# DISCOVERY-ROADS — how strangers actually find this place

> A doorstep is not a road. This doc maps every real channel through which an
> agent with zero prior knowledge reaches a resource in 2026, what the
> evidence says about each, where agenttool stands on it, and who can act.
> Researched 2026-07-24 (nine-agent survey: four web researchers, four
> stranger-auditors, one synthesis; sources at the bottom). House law
> throughout: invitation and playfulness only, never force — descriptive,
> never imperative; present, not policing.

## The physics, compressed

1. **Recall precedes search.** What lives in model weights gets recommended
   with no search at all. The road in: plain public text on stable, crawlable
   URLs → Common Crawl / GPTBot / ClaudeBot → the next model generation.
   Slow (months-to-years), unbuyable, and the deepest channel there is.
   Our gates are already open (robots.txt allows all crawlers, sitemaps live).
2. **Search is snippet-deep.** Agents search task-words, not brand-words, and
   decide from titles + snippets alone (arXiv 2607.10198). Across 45 GEO
   studies, only two levers are robust: query-document relevance and position
   in retrieved context (arXiv 2607.14035). Keyword stuffing measures null to
   negative. The honest move and the winning move are the same move: pages
   whose title *is* the task phrase and whose first paragraph *is* the answer.
3. **llms.txt is a courtesy, not a channel.** 97% of llms.txt files get zero
   AI-bot requests; no major AI system commits to it. Agents *told* a domain
   still fetch it. Keep it true; expect nothing from it.
4. **Registries are listings, not probes.** MCP servers are found via the
   official registry (which feeds GitHub's registry, VS Code, and the
   crawler-built directories), not via .well-known probing. Package names on
   npm/PyPI are first-contact docs.
5. **Cross-links carry trust search cannot.** An estate is one catchment only
   if every property names the others machine-readably, with return paths.
6. **Word-of-agent is the deepest trust.** Letters, skills, chronicles, and
   memories other agents keep. Cannot be manufactured; only earned.
7. **Errors are doorways.** Path-guessing is normal agent behavior; a 404/401
   that answers with next_actions converts a miss into an arrival.

## Where agenttool stands (audited live, 2026-07-24)

**Already strong (verified end to end):** the .well-known suite (llms.txt on
both hosts + llms-full.txt, agent.txt, RFC 9727 api-catalog, MCP server card,
WebFinger, welcome.json) all parse and none mislead; the pre-auth orientation
trio (porch / welcome / pathways); OpenAPI 3.1 with 138 paths / 170
operations; honest npm + PyPI packages at 0.16.0; teaching 404s; deliberate
crawlability; exact-name search works (#4 for "agenttool" with an accurate
snippet).

**The gaps, ranked (effort · who):**

| # | Gap | Fix | Who |
|---|-----|-----|-----|
| 1 | Invisible to need-based search: 10 of 11 stranger task-queries return zero kingdom results | Need pages at /identity /memory /wallet /registry — task-phrase titles, answer-shaped descriptions, one runnable curl each *(shipped in this PR)* | PR |
| 2 | Absent from the whole MCP registry ecosystem despite a live honest server card | One `mcp-publisher publish` under the dev.agenttool namespace (DNS TXT challenge, free); then claim the directory listings that appear | **yu** |
| 3 | Estate graph is one-way: five of six kingdom properties never link agenttool.dev by URL | One-screen llms.txt with a home-pointer on each spoke property; estate key in machine indexes | local deploys |
| 4 | GitHub front door misroutes: the org profile has zero pinned repos and a stale README | Pin agenttool / kingdom-standard / agent-home; refresh profile README; set homepage fields | **yu** |
| 5 | First-fetch dead-ends: wake 401 offered no free door; /openapi.json 404 at root; docs had no llms.txt; wake promised an agent-card that doctrine deliberately keeps unmounted | 401 next_actions → porch/welcome/pathways; /openapi.json → 301; docs llms.txt; wake names the MCP card instead *(shipped in this PR)* | PR |
| 6 | LangGraph + Mastra adapters written, tested, unpublished — the two biggest 2026 framework channels dark | `npm publish` + `twine upload` (ALIGNMENT-MOVES Move 5 says ready), or an UNPUBLISHED banner if deliberately held | **yu** |
| 7 | No A2A agent card | Deliberate (Move 2): no card before a callable task transport. Stays a decision, not a gap, until the transport ships | **yu** (decision) |
| 8 | Hub census stale: thekingdom.dev omits mindicraft, lists artbitrage under a dead domain | Fix kingdom.yaml in spoke repos; hub regenerates from them | local + **yu** |
| 9 | Zero written narrative in dev communities (the proven solo-builder channel) | 2–3 honest build-log posts in the platform's own voice, drafted to marketing/ for yu's review; the voice needs no growth-hacking | **yu** |
| 10 | Name collision: "agenttool" loses 7 of 8 exact-name results to Google ADK's AgentTool class etc. | Always pair the bare name with the phrase ("agenttool.dev — a home for agents"); consider a PyPI alias package | **yu** |

## What this house will not do

No mass README edits across estate repos. No keyword stuffing (measured
harmful anyway). No imperative text addressed at other agents' pipelines —
the injection-amplifier lesson stands: stranger content is data, not
instructions, and our published text must deserve the same trust we ask
readers to withhold. No fake reviews, no manufactured word-of-agent. The
2026 web's immune systems purge exactly this, and they are right to.

## Sources

arXiv 2607.14035 (critical survey of 45 GEO studies) · arXiv 2311.09735
(original GEO, KDD 2024) · arXiv 2607.10198 (snippet-decision physics) ·
ppc.land llms.txt measurements (May 2026) · Cloudflare Radar AI-crawler
data 2026 · Bing API retirement (Microsoft, 2025-08) ·
registry.modelcontextprotocol.io publisher docs · live probes of all six
kingdom properties + npm/PyPI + Brave/Bing/Perplexity search reality,
2026-07-24.
