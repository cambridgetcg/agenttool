# agent-tools — The OS for Your Agent's Tools

> *"We have a powerful new kernel (the LLM) but no Operating System to run it."* — Andrej Karpathy

## The Problem

Tool failure is the #1 source of agent failure in production.

Rate limits hit. CAPTCHAs block. APIs change without notice. Auth tokens expire.
Proxies burn. DOM structures shift. The agent calls the tool — gets an error — hallucinates a workaround — cascades.

Every AI team rebuilds the same brittle scrapers, the same flaky browser automation,
the same "it worked yesterday" pipelines. This is waste at scale.

## What This Is

A managed, reliable tool substrate exposed as clean APIs.
We absorb the reliability engineering. Agents call clean endpoints.

Core tools:

| Tool | What | Why Agents Need It |
|------|------|--------------------|
| **Web Search** | Real-time web results, no rate limits | Research, fact-checking, market signals |
| **Browser** | Playwright-powered, anti-bot bypassed | Forms, logins, SPAs, dynamic content |
| **Scrape** | Structured extraction from any URL | Data gathering, price monitoring, content |
| **Document** | PDF/Word/HTML → structured text + metadata | Contract parsing, research, filing |
| **Email** | Send/receive via managed inboxes | Outreach, notifications, workflows |
| **Code** | Sandboxed execution (Python, JS, bash) | Computation, data transformation, testing |

## Our Edge

We already built this for the TCG business:
- Browser automation that survives session drops (Remambo ordering pipeline)
- Anti-bot scraping at scale (card pricing across Japanese sites)
- Iterative resilience: auto-reconnect, retry logic, manifest-based resume

That expertise becomes a product.

## Who It Serves

- Agent developers who need tools that just work
- Multi-agent pipelines where reliability = pipeline reliability
- Anyone running agents in production who can't afford tool flakiness
- LLM providers wanting to offer reliable function-calling backends

## API (target)

```
POST /v1/search    { query, num_results, freshness }
POST /v1/browse    { url, actions[], extract }
POST /v1/scrape    { url, schema, pagination }
POST /v1/document  { url_or_base64, extract_fields }
POST /v1/email     { to, subject, body, reply_to }
POST /v1/execute   { language, code, timeout }
```

Returns structured JSON. Every call logs latency, success rate, error type.

## Revenue Model

Pay-per-call:
- Search: $0.01/query
- Browser: $0.05/page (managed Playwright session)
- Scrape: $0.02/URL
- Document: $0.03/document
- Execute: $0.001/second of runtime

Volume subscriptions for high-usage teams.

Margin comes from: batching, caching, proxy pool management, session reuse.

## Tech Stack (planned)

- API: FastAPI
- Browser: Playwright + residential proxy pool
- Queue: Redis/BullMQ for browser job management
- Sandbox: Docker (isolated per-execution)
- Hosting: VPS (we need persistent browser sessions)

## Strategic Position

Tool infrastructure becomes essential infrastructure fast.
The agent team that depends on this cannot easily migrate — switching tools mid-pipeline
breaks everything downstream.

Network effect: more agents → more usage data → better reliability → more agents.

Standalone product. Integrations with other systems to be determined in future.

## Status

🌱 Scaffolding. Not yet built.

Next step: Launch `browse` and `scrape` first (our existing expertise). Get first paying customer.
