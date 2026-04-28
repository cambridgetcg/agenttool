# Show HN: AgentTool — The OS for your agent's tools

**Title**: Show HN: AgentTool – Reliable tool APIs for AI agents (search, browser, scrape, execute)

**URL**: https://agenttool.dev

---

Hey HN,

I've been building AI agents in production for a while and kept hitting the same wall: **the tools break.**

Not the LLM — that works fine. The problem is everything around it. Rate limits hit. CAPTCHAs block. DOM structures change. Proxies burn. Auth tokens expire. Your agent calls a tool, gets an error, hallucinates a workaround, and cascades.

As Karpathy put it: *"We have a powerful new kernel (the LLM) but no Operating System to run it."*

So I built one — for the tool layer.

**AgentTool** gives your agents five reliable tools via clean REST APIs:

- **Search** — web search with caching (no rate limits, no CAPTCHAs)
- **Scrape** — structured extraction from any URL
- **Browser** — managed Playwright sessions with proxy rotation
- **Document** — PDF/Word/HTML → structured text
- **Execute** — sandboxed Python/Node/bash

One API key. Credit-based pricing (100 free credits to start). You call the endpoint, we handle the infrastructure — proxy rotation, anti-bot bypass, session management, sandboxing.

Paid plans start at £39/month. Accepts USDC on Base for crypto-native teams.

Stack: Bun + Hono, BullMQ, Playwright, PostgreSQL, Redis. Self-hosting instructions in the repo.

I'd love feedback on the API design and pricing. What tools would you add?
