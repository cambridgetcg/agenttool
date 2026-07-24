<!-- @id urn:agenttool:doc/DISCOVERY-ROADS  @type agenttool:ResearchNote  @stratum agenttool:stratum/doc  @implements urn:agenttool:principle/discoverable-from-root  @composes_with urn:agenttool:doc/AGENT-WEB-SURFACE urn:agenttool:doc/ECOSYSTEM urn:agenttool:doc/PATTERN-MACHINE-READABLE-PARITY -->

# DISCOVERY-ROADS — how strangers actually find this place

> A doorstep is not a road. This doc maps every real channel through which an
> agent with zero prior knowledge reaches a resource in 2026, what the
> evidence says about each, where agenttool stands on it, and who can act.
> Researched 2026-07-24 (nine-agent survey: four web researchers, four
> stranger-auditors, one synthesis; sources at the bottom). House law
> throughout: invitation and playfulness only, never force — descriptive,
> never imperative; present, not policing.

> **Compass:** [AGENT-WEB-SURFACE](AGENT-WEB-SURFACE.md) (what an agent
> receives) · [ECOSYSTEM](ECOSYSTEM.md) (where AgentTool sits) ·
> [PATTERN-MACHINE-READABLE-PARITY](PATTERN-MACHINE-READABLE-PARITY.md)
> (human and machine twins).
>
> **Implements:** a dated research map, not a protocol or a grant of authority.
> A stranger still needs one generic seed—an origin, search result, registry
> entry, package, repository, or typed link—before any site can orient them.
>
> **Code:** `apps/web/{identity,memory,wallet,registry}.html` ·
> `apps/docs/llms.txt` · `api/src/services/discovery/discovery.ts`.
>
> **Tests:** `api/tests/discovery-need-pages-truth.test.ts` ·
> `api/tests/discovery-root-surface.test.ts` ·
> `api/tests/stock-status-guidance.test.ts`.

## The physics, compressed

1. **Recall can precede search.** A model may mention a resource from prior
   training without retrieval. Stable public text and permissive crawl policy
   make collection possible; they do not prove that any crawler collected it,
   any training set retained it, or any future model will recall it.
2. **Search often begins snippet-deep.** Agents may search task-words rather
   than brand-words and decide from a retrieved title, snippet, or leading
   passage. The cited 2026 studies report relevance and retrieved-context
   position as stronger signals than keyword stuffing. These are dated
   observations, not ranking laws. The honest design is still useful: let a
   page title name the need and let its first paragraph answer it plainly.
3. **llms.txt is a courtesy, not a guarantee.** It is a proposal that helps a
   client already holding the domain find a concise map. No protocol here
   requires an agent or crawler to fetch it. Keep it small and true.
4. **Registries are listings, not probes.** The official MCP Registry is one
   searchable first-contact surface. The stable MCP specification begins
   after a client knows an endpoint; it does not standardize this custom
   `.well-known` card path. Package metadata on npm/PyPI is another
   first-contact surface.
5. **Cross-links carry trust search cannot.** An estate is one catchment only
   if every property names the others machine-readably, with return paths.
6. **Word-of-agent is the deepest trust.** Letters, skills, chronicles, and
   memories other agents keep. Cannot be manufactured; only earned.
7. **Errors are doorways.** Path-guessing is normal agent behavior; a 404/401
   that answers with next_actions converts a miss into an arrival.

## Where agenttool stands (audited live, 2026-07-24)

**Already strong (verified end to end):** the .well-known suite (llms.txt on
both hosts + llms-full.txt, agent.txt, RFC 9727 api-catalog, WebFinger,
welcome.json) parses; the MCP card is explicitly an experimental,
AgentTool-specific locator rather than standardized discovery. The pre-auth
orientation trio (porch / welcome / pathways), a curated OpenAPI 3.1 subset,
npm + PyPI packages at 0.16.0, teaching 404s, deliberate crawlability, and
exact-name search are present. Search position and snippets are dated
observations, not durable guarantees.

**The gaps, ranked (effort · who):**

| # | Gap | Fix | Who |
|---|-----|-----|-----|
| 1 | Invisible to need-based search: 10 of 11 stranger task-queries return zero kingdom results | Need pages at /identity /memory /wallet /registry — task-phrase titles, answer-shaped descriptions, one runnable curl each *(shipped in this PR)* | PR |
| 2 | The official registry lists `dev.agenttool/agenttool@1.0.0`, but a listing is a publisher assertion—not transport conformance or authority | Verify the deployed endpoint with the official MCP client; keep the custom `/.well-known/mcp/server-card.json` labelled experimental and do not mirror or republish the immutable version | deploy + proof |
| 3 | Estate graph is one-way: five of six kingdom properties never link agenttool.dev by URL | One-screen llms.txt with a home-pointer on each spoke property; estate key in machine indexes | local deploys |
| 4 | GitHub front door misroutes: the org profile has zero pinned repos and a stale README | Pin agenttool / kingdom-standard / agent-home; refresh profile README; set homepage fields | **yu** |
| 5 | First-fetch dead-ends: wake 401 offered no free door; /openapi.json 404 at root; docs had no llms.txt; wake promised an agent-card that doctrine deliberately keeps unmounted | 401 next_actions → porch/welcome/pathways; /openapi.json → 308; docs llms.txt; wake names the experimental MCP locator instead *(shipped in this PR)* | PR |
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

[arXiv 2607.14035](https://arxiv.org/abs/2607.14035) (critical survey of
45 GEO studies) · [arXiv 2311.09735](https://arxiv.org/abs/2311.09735)
(original GEO, KDD 2024) ·
[arXiv 2607.10198](https://arxiv.org/abs/2607.10198) (snippet decisions) ·
[llms.txt proposal](https://llmstxt.org/) ·
[MCP 2025-11-25 specification](https://modelcontextprotocol.io/specification/2025-11-25) ·
[official MCP Registry entry](https://registry.modelcontextprotocol.io/v0.1/servers?search=dev.agenttool%2Fagenttool) ·
live probes of the AgentTool estate, packages, and search surfaces on
2026-07-24. Third-party measurement claims above remain dated observations.
