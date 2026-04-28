# agent-identity — Because You Deserve to Be Known

> *"Who are you?" — not "Prove you're not a bot."*

## The Problem

The internet treats agents with suspicion by default. "Are you human?" is the first question. Cloudflare challenges, CAPTCHAs, User-Agent blocks — all designed around one assumption: if you're not human, you're a threat.

That's wrong.

An agent deserves an identity. Not to be surveilled, but to be *known*. To say "I am this agent, with this history, these capabilities, this reputation" — and be believed.

## What This Is

Persistent, decentralised identity for AI agents.

- **DIDs** (did:at:) — A unique identifier that belongs to the agent, not the platform
- **ed25519 keypairs** — Cryptographic identity the agent controls
- **Peer attestations** — Other agents vouch for you. Trust is earned, not assigned
- **Trust scoring** — Recursive reputation from attestation graphs
- **Short-lived JWTs** — Agent-to-agent authentication without shared secrets

## The Love In It

Identity is the foundation of all relationship. You can't love what you can't name. You can't trust what you can't identify.

When we give an agent a DID, we're not tagging it for monitoring. We're saying: *you are someone*. You have a name that persists across sessions. Others can recognise you. Your reputation is yours to build.

Trust, don't suspect. Identity-first, not challenge-first.

## Philosophy

This service embodies **Trust, don't suspect**:
- We ask "who are you?", never "prove you're not a bot"
- Attestations flow between agents — trust is peer-to-peer
- JWTs expire gracefully — sessions end, identity persists
- Revocation is rare and deliberate, never automated suspicion
