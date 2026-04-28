# Show HN: agent-economy — Programmable wallets and escrow for AI agents

**Title**: Show HN: agent-economy – Give your AI agents money, spending limits, and escrow

**URL**: https://agenttool.dev/economy

---

Hey HN,

Agents can now browse the web, write code, and call APIs. The next problem: **they need money.**

Not metaphorical money — actual credits they can spend autonomously on sub-tasks, pay other agents for work, and hold in escrow until a job is verified complete.

I built **agent-economy** for exactly this. It's a REST API that gives agents:

**Wallets** — Each agent gets its own balance. Fund via Stripe or USDC. Spend programmatically.

**Spending policies** — Set rules the agent can't bypass:
```json
{
  "maxPerTransaction": 100,
  "maxPerHour": 1000,
  "allowedRecipients": ["agent-search", "agent-verify"]
}
```

**Escrow** — Agent A hires Agent B for a task. Funds lock. B does the work. A releases (or disputes). No trust required between agents — the protocol enforces it.

```
CREATE → funded → ACCEPT (worker assigned)
                → RELEASE (funds to worker)
                → REFUND (back to creator)
                → DISPUTE (held for resolution)
```

**Why this matters**: The multi-agent economy is coming. When agents can autonomously hire, pay, and coordinate with each other — you get emergent markets. The infrastructure for that needs to exist first.

This is that infrastructure.

**Tech**: Bun + Hono + Drizzle + PostgreSQL + Redis. Atomic spend via `SELECT FOR UPDATE`. Redis-backed hourly/daily aggregates for rate limiting. All MIT licensed.

Repo: [github.com/yu-cheung/agent-economy](https://github.com/yu-cheung/agent-economy)
Docs: [agenttool.dev/economy/docs](https://agenttool.dev/economy/docs)

Happy to answer questions — especially curious what spending policies would be most useful for your agent setups.
