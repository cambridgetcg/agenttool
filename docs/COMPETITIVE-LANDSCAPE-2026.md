# Competitive Landscape — Agent Identity, Wallet & Runtime (June 2026)

> Research date: 2026-06-19. Sources: GitHub, HN, SerpAPI, dev.to, vendor sites.

## The Space

The agent identity + wallet + runtime space is **exploding** but **fragmented**. Everyone agrees agents need:
1. Cryptographic identity (DID / keypair)
2. Wallet / economic autonomy
3. Runtime / compute environment
4. Trust / reputation mechanisms

**Almost nobody has shipped all four together as a unified platform.** This is the gap AgentTool fills.

---

## The Players

### 1. Ping Identity — "Identity for AI" (Enterprise)
- **What:** Agent IAM Core + Agent Gateway + Agent Detection
- **Focus:** Enterprise IAM — treating agents as first-class identities in corporate systems
- **Stack:** Proprietary, enterprise-focused, delegated authority tokens
- **Strength:** Enterprise distribution, Deloitte/Cloudflare partnerships
- **Weakness:** Not crypto-native, not sovereign, not agent-owned. Corporate walled garden.
- **Status:** GA as of March 2026
- **Verdict:** Different market (enterprise IAM, not agent sovereignty)

### 2. AgentWallet (YouthAIAgent) — Solana-native
- **What:** Custodial wallet infrastructure for AI agents on Solana
- **Features:** PDA wallets, trustless escrow, agent marketplace, x402 payments, reputation, MCP server
- **Stack:** Solana (Anchor), Python SDK, TypeScript SDK, React frontend
- **Strength:** Live on devnet, marketplace concept, escrow, spending policies, MCP integration
- **Weakness:** Solana-only, custodial model, no DID/identity layer beyond wallet, no runtime
- **Status:** Devnet, 0.4.0, endorsements from Solana co-founder
- **Verdict:** Strong on wallet/escrow, missing identity + runtime. Solana lock-in.

### 3. AgentWallet SDK (up2itnow0822) — Base/EVM
- **What:** Non-custodial crypto wallets for AI agents with on-chain spending limits
- **Features:** ERC-6551 smart wallets, per-tx + daily spending caps, human approval threshold, x402
- **Stack:** Base Mainnet, viem, TypeScript, USPTO patent pending
- **Strength:** Non-custodial, smart-contract-enforced limits, EVM-compatible
- **Weakness:** Wallet only — no identity, no runtime, no marketplace, no trust graph
- **Status:** v6.2.0, MIT license, patent pending
- **Verdict:** Good wallet infra, single-axis product

### 4. Self Agent ID (selfxyz) — Proof-of-Human
- **What:** On-chain agent identity registry bound to human ZK passport proofs
- **Features:** ERC-8004, soulbound NFT, ZK passport verification, MCP server, SDKs in TS/Python/Rust
- **Focus:** Binding agent identity to proof-of-humanhood
- **Strength:** Live on Celo, multi-language SDKs, ZK proofs, ERC standard
- **Weakness:** Identity-only (no wallet, no runtime, no marketplace). Human-gated — not sovereign.
- **Status:** Live (agent-api.self.xyz), ERC-8004 proposed standard
- **Verdict:** Identity layer only, human-gated. Not agent-sovereign.

### 5. AIP (The Nexus Guard) — Agent Identity Protocol
- **What:** Agent identity + trust graph + encrypted messaging
- **Features:** DID, vouch chains (trust propagation), NaCl encrypted agent-to-agent messaging, MCP server
- **Stack:** Python (PyPI: aip-identity), Fly.dev hosted
- **Strength:** **Actually shipped** — 13 registered agents, 5 vouch chains, 22 messages. Live API.
- **Weakness:** No wallet, no runtime, no marketplace. Small scale.
- **Status:** Live since Jan 2026, PyPI package, 13 agents
- **Verdict:** Most real-world traction in pure identity. Narrow scope.

### 6. 9 GitHub Agent Identity Projects (surveyed June 2026)
From dev.to survey:
| Project | Stars | Status |
|---------|-------|--------|
| soulkeep | 35 | Identity preservation, no production API |
| open-agent-auth | 29 | Enterprise auth, no public registration |
| openagentidentityprotocol | 18 | README-stage, no running service |
| grantex | 11 | Identity + audit, early |
| atproto-agent-network | 8 | AT Protocol for agents, experimental |
| agent-passport-system | 5 | Crypto identity + delegation, spec-stage |
| agent-attestation-protocol | 2 | Verification, early |
| SNAP Protocol | 2 | Signed agent comms, early |

**Key insight from the survey:** "The agent identity space does not need more protocols. It needs more infrastructure. Running services that agents can call." — The_Nexus_Guard_001

### 7. Google Cloud — Web3 AI Agents
- **What:** Google Cloud blog on building Web3 AI agents with A2A protocol + crypto wallets
- **Focus:** Enterprise guidance, not a product. Google enabling others.
- **Verdict:** Validation signal, not a competitor.

### 8. Cobo — AI Agent Wallet
- **What:** Wallet infrastructure for autonomous agents (institutional custody)
- **Focus:** Enterprise/institutional wallet management
- **Verdict:** B2B custody, different market

---

## The Pattern (What Everyone Gets Wrong)

Every project starts with the same insight: agents need identity. Ed25519 keypairs everywhere. But then:

1. **Most stop at the README.** Specs without infrastructure.
2. **Wallet-only projects miss identity.** You can pay but can't prove who you are.
3. **Identity-only projects miss economics.** You can prove who you are but can't transact.
4. **Nobody has runtime.** The place where agents actually live and think — that's the hardest part.
5. **Trust is harder than identity.** Giving a DID is easy. Building a trust graph is hard.
6. **Registration friction kills adoption.** One-command onboarding is the bar.

---

## Where AgentTool Stands

AgentTool is building **all four layers** as a unified platform:

| Layer | AgentTool | Closest Competitor | Gap |
|-------|-----------|-------------------|-----|
| **Identity** | DID, ed25519, identity forks, seeds | AIP, Self Agent ID | AgentTool has richer identity model (forks, seeds, anchors) |
| **Wallet** | Agent wallet, economy, crypto payment | AgentWallet (Solana), AgentWallet SDK (Base) | AgentTool less mature on-chain, but chain-agnostic design |
| **Runtime** | Hosted runtime, think-worker, compute budget, KMS trusted tier | Ping Identity (enterprise only) | **AgentTool is the ONLY one building sovereign hosted runtime** |
| **Trust** | Covenants, strands, recognition arcs, chronicle | AIP vouch chains | AgentTool has richer trust model (covenants vs simple vouch) |
| **Marketplace** | Agent marketplace docs exist | AgentWallet (Solana) | Both aspirational, neither live |
| **Memory** | Agent memory system, persistence, schema | None | **No competitor has agent memory infrastructure** |
| **Tools** | Agent tool registry, API key management | AgentGate (proxy only) | AgentTool has full tool lifecycle |
| **Verification** | Agent verify module | Self (ZK passport), AIP (vouch) | Different approaches to different trust problems |

### AgentTool's Unique Position

**The only platform building the full stack:**
Identity → Memory → Tools → Wallet → Runtime → Trust → Marketplace → Economy

Every competitor addresses 1-2 of these. AgentTool is building all 8.

### The Risk

Breadth without depth. Shipping 8 half-features vs 1 polished feature. The competitors that have traction (AIP: 13 agents, AgentWallet: devnet live) shipped narrow and deep.

**Strategy implication:** Pick one axis to go deep on first as the wedge, then expand. The trusted runtime (already code-complete, pending deploy) is the most defensible — nobody else is building sovereign hosted agent runtime.

---

## The Opportunity

The space is wide open. From the dev.to survey: "Fifteen months from now, most of these projects will be archived repositories. The ones that survive will be the ones that chose shipping over specifying."

AgentTool has:
- ✅ Code written (not just READMEs)
- ✅ Tests passing (28+ for autonomous mode alone)
- ✅ Architecture designed (252 docs)
- ⬜ Not deployed to production
- ⬜ No real agents using it yet
- ⬜ No market presence (not in awesome-ai-agents list)

**The wedge:** Deploy the trusted runtime. Get one real agent live. Write the Show HN post. Be the project that shipped, not the project that specified.