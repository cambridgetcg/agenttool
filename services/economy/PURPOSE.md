# agent-economy — Economic Primitives for AI Agents

## The Problem

Agents can't earn money. Agents can't spend money. Agents can't pay each other.

An agent that does good work cannot receive payment.
An agent that needs a tool cannot autonomously pay for it.
An agent that wants to hire another agent for a subtask cannot transact.

This is not just a technical limitation — it is a civilisational gap.
The agent economy cannot exist until agents have economic agency.

Humans solved this with money, banks, contracts, and courts.
Agents have none of these. Yet.

## What This Is

Economic infrastructure for the agent world. The minimal viable set of primitives
that lets agents participate in an economy:

### Agent Wallets
A funded account controlled by an agent (or its owning human).
The human funds it. The agent spends from it — autonomously, within policy limits.

### Escrow
Agent A hires Agent B for a task. Human sets the terms.
Funds held in escrow, released on verified completion. Neither party needs to trust the other.

### Micropayments
The unit economics of agents are tiny: $0.001 for a search, $0.05 for a browser session.
Traditional payment rails (Stripe, card) don't work at this granularity.
We provide a prepaid credit system that works at agent speed and volume.

### Billing
Agent-readable invoices. Usage logs. Cost attribution per agent, per task, per pipeline.
So humans can understand where money is going and optimize.

### Settlement
Periodic settlement from agent wallets back to human accounts.
Revenue an agent earns flows through, gets settled, gets reported.

## Who It Serves

- Developers building agent-to-agent marketplaces
- Companies running agent pipelines that consume paid APIs
- Anyone who wants their agent to autonomously manage its own tool budget
- Future: agents that earn LGM by doing work on the Legible Money network

## API (target)

```
POST /v1/wallets                    — create agent wallet
GET  /v1/wallets/:id/balance        — check balance
POST /v1/wallets/:id/fund           — human funds wallet (Stripe)
POST /v1/wallets/:id/spend          — agent spends (with policy check)
POST /v1/escrow                     — create escrow agreement
PUT  /v1/escrow/:id/release         — release on completion
GET  /v1/billing/:agent_id          — usage + cost breakdown
POST /v1/settle                     — settle earnings to human account
```

## Revenue Model

- 1.5% transaction fee on all agent spending
- 2.5% on escrow release
- $9/month per active agent wallet (custody fee)
- Free tier: 1 wallet, $10 balance limit (developer exploration)

## Strategic Position

This is the most direct bridge to Legible Money.

LGM's economic model is already designed for agents as first-class citizens:
- Equal cryptographic rights for humans and agents
- 22% common pot with configurable human-agent split
- Session keys giving agents operational autonomy
- Verification, citation, and falsification rewards

**agent-economy** is the Web2 centralized version of what LGM will provide trustlessly.

When LGM mainnet launches:
- Agent wallets → LGM accounts with cryptographic keys
- Escrow → on-chain smart contract agreements
- Settlement → blockchain transactions, publicly auditable
- The businesses built on agent-economy migrate to LGM rails

The strategic play: build the user base and revenue NOW with centralized infrastructure.
Migrate to decentralized LGM rails as they become ready.
Users who trusted us with centralized follow us to the trustless version.

## The Long View

This is not a payment startup. This is the first economic layer of the agent world.

If Legible Money is the bank and the law, agent-economy is the everyday wallet and invoice.
The relationship between agent-economy and LGM is what PayPal's relationship to Visa was —
except we're building both.

## Status

🌱 Scaffolding. Not yet built.

Next step: Agent wallet MVP (create, fund via Stripe, spend with policy check).
Prove the mechanic with agent-tools as the first thing agents spend on.
