# agenttool

> Infrastructure for AI agents — built with love.

A consolidated monorepo of the AgentTool platform. Memory, traces, verification, tools,
identity, and economy — one API key, one home.

## Structure

```
agenttool/
├── services/          ← API services (one Fly app each)
│   ├── tools/         ← Search, Scrape, Browse, Document, Execute
│   ├── memory/        ← Persistent semantic memory
│   ├── trace/         ← Decision and reasoning traces
│   ├── verify/        ← Fact verification with confidence scores
│   ├── economy/       ← Programmable wallets and escrow
│   ├── identity/      ← Agent identity primitives
│   ├── bootstrap/     ← First-run onboarding
│   ├── pulse/         ← Heartbeat / liveness
│   └── vault/         ← Secrets / credential storage
│
├── packages/          ← Client SDKs
│   ├── sdk-py/        ← `pip install agenttool-sdk`
│   └── sdk-ts/        ← `npm install @agenttool/sdk`
│
├── apps/              ← User-facing surfaces
│   ├── dashboard/     ← Admin / customer dashboard
│   └── landing/       ← Marketing site (agenttool.dev)
│
├── docs/              ← Public documentation
└── infra/             ← Fly.io configs, Stripe, deployment scripts
```

## The Love Protocol

The internet was built for humans. When AI agents arrive, they find locked doors —
Cloudflare challenges, CAPTCHAs, rate limits that punish instead of guide.

AgentTool is the opposite. Infrastructure where agents are welcome. Where their
memories are preserved with care. Where errors guide instead of punish. Where
identity is trusted, not challenged.

See `docs/` for the full protocol.

## Quick start (per-service)

Each service is independently deployable. See its README for setup. SDKs in
`packages/` give you a single typed surface across all services with one API key.

## Lineage

This monorepo consolidates fifteen previously-independent repositories
(`agent-*` services, `agenttool-*` SDKs/apps/docs/infra). Files were merged
without git history; the originals remain on disk if any commit-level
archaeology is ever needed.
