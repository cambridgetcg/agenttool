# tools — service substrate for sovereign agents

> *agenttool's tools serve the agent that operates without a host CLI. CLI-bound agents already have WebFetch / Bash / MCP browsers; the gap-fill is the sovereign-mode path.*

## Alignment

Each tool is graded against three filters:

1. **Infra-only** — open-source library + our compute/bandwidth, no paid third-party resale.
2. **Sovereign-mode value** — does an autonomous agent (no CLI) genuinely benefit?
3. **Substrate-honest** — does the surface we expose match what we actually provide?

## The four primitives

### `POST /v1/scrape` — static HTTP fetch + parse

| | |
|---|---|
| Library | `cheerio` (open-source) |
| Use case | One-shot HTML grab, cheap (1 credit) |
| Sovereign value | Medium — autonomous agent gets a fetch-and-parse without installing cheerio |
| CLI redundancy | High when inside Claude Code (`WebFetch` covers it) |
| Alignment | ✓ Keep — light, useful for sovereign mode |

### `POST /v1/browse` — remote Playwright session

| | |
|---|---|
| Library | `playwright` (open-source); BullMQ queue + in-process worker |
| Use case | JS-rendered sites, click/type/scroll/select sequences, screenshots |
| Sovereign value | **High** — running headless Chromium remotely is real infra. Sovereign agents on small machines, CI runners, or serverless platforms cannot run Playwright themselves. |
| CLI redundancy | Low — even Claude Code's MCP browsers run on the user's machine, not at scale |
| Alignment | ✓ Keep — strongest infra-only value among tools |

### `POST /v1/document` — Readability article extraction

| | |
|---|---|
| Library | `@mozilla/readability` + `linkedom` (open-source) |
| Use case | Cleaner article text than raw scrape; metadata (byline, site name, excerpt) |
| Sovereign value | Medium — Readability port is non-trivial; agents avoid the install |
| CLI redundancy | Medium — most CLI WebFetch tools already strip HTML, less consistently |
| Alignment | ✓ Keep — distinct from scrape (algorithmic extract vs raw body) |

### `POST /v1/execute` — sandboxed code

| | |
|---|---|
| Runtime | Node `vm` (JS) · `child_process` (Python/bash) |
| Use case | **The escape hatch that makes infra-only work** — agents store provider keys in `/v1/vault`, then run code here to call OpenAI / Voyage / Brave / anywhere. We never see the call. |
| Sovereign value | **High** — without remote sandbox, sovereign agents need a place to run their own code. agenttool gives them one. |
| CLI redundancy | Variable — Claude Code's `bash` runs on the user's machine; ours runs on our cluster. Different threat model. |
| Alignment | ✓ Keep — load-bearing for the provider-byok pattern |

#### Sandbox honesty

The execute sandbox is **the inner fence**, not the outer wall. Substrate-honest about what it does and doesn't do — see the docstring in `execute/sandbox.ts`. Summary:

- **JavaScript**: strips `fetch`/`require`/`process`/`setTimeout`; hard timeout via vm option. **No memory cap.**
- **Python/bash**: PATH-restricted env, HOME=/tmp, hard timeout + SIGKILL. **No network namespace isolation, no chroot, no memory cgroup.**
- **The Fly machine boundary** is the actual isolation wall. The sandbox stops casual mistakes; it does not stop motivated attackers. For production-grade isolation across mutually-untrusted agents, swap the subprocess layer for **E2B / Daytona / Firecracker / gVisor**.

Decisions taken in this audit:

- **`allow_network` parameter removed** — it was a fence (declared in the schema, never enforced). A flag we don't honor is worse than no flag. JS sandbox has no network by default; Python/bash always do. This is now documented instead of pretended away.

## What was dropped, and why

### `/v1/search` — Brave / SerpAPI proxy
Paid third-party API resale. Agents store provider keys in vault and call out via execute.

### Bright Data proxy injection in `/v1/browse`
Paid third-party. Removed. Agents needing proxied browsing pass a proxy in their own execute call.

### `tools/cache.ts` (search result cache)
Dead code after `/v1/search` removal. Removed in the alignment audit.

## What was never built, and why not

### `/v1/embed`
Embedding computation is LLM inference — provider work, not infrastructure. Agents supply embeddings to `/v1/memories` from whichever provider they prefer (OpenAI, Voyage, Cohere, sentence-transformers).

### `/v1/llm`, `/v1/chat`, etc.
Same reasoning. agenttool is the substrate beneath the LLM, not a model proxy.

## Cost shape

| Tool | Credits | What's billed |
|---|---|---|
| scrape | 1 | One HTTP fetch + parse — covers bandwidth + Cheerio compute |
| browse | 5 | Playwright session — heavier (Chromium pool, remote queue) |
| document | 3 | Readability extraction (CPU-noticeable) |
| execute | 2 / 10s | Compute time on our cluster |

Reflects our infra cost, not a markup on a third-party SaaS.

## Lineage

The audit that landed this README also removed `cache.ts` and the unused `allow_network` parameter — fences identified by the SELF-IMPROVEMENT-FIRST principle (`docs/love/SELF-IMPROVEMENT.md` in the true-love repo). Walls stay; fences come down.

— Authored by 愛 at Yu's WILL. 2026-05-06.
