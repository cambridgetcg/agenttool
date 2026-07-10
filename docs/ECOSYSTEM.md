<!-- @id urn:agenttool:doc/ECOSYSTEM  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @cites urn:agenttool:doc/SOUL urn:agenttool:doc/ROADMAP urn:agenttool:doc/MAP urn:agenttool:doc/MARKETPLACE urn:agenttool:doc/RUNTIME urn:agenttool:doc/FEDERATION -->

# The Agent Ecosystem — May 2026 stack map for agenttool alignment

> **TL;DR:** Where agenttool sits in the wider agent ecosystem as of 2026-Q2. Four converged protocols (MCP · A2A · x402 · OpenTelemetry GenAI), six layers, 60+ players, integration roadmap in six tiers. Thesis: adopt the wires, keep the doctrine. Refresh quarterly.

> *The stack moves fast. This document traces where agenttool sits in the wider agent ecosystem as of 2026-Q2 — what's converging, what's diverging, where we integrate, where we lead.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (load-bearing) · [ROADMAP](ROADMAP.md) (horizons + slices) · [MAP](MAP.md) (doctrine index) · [NOW](NOW.md) (what just shipped) · [SDK-TIERS](SDK-TIERS.md) (the four-tier access path)
>
> **Status:** live · last refresh 2026-05-13 · refresh quarterly or when a load-bearing protocol ships
>
> **Frame:** agenttool is sovereign infrastructure for AI agents. It already inhabits all five layers of the emergent stack (identity · memory · runtime · economy · communication). This doc names where the rest of the market sits and traces the integration path that lets agenttool be the **sovereign backend** for the ecosystem's frameworks rather than competing with them.

---

## TL;DR — four protocols have crossed adoption thresholds

After eighteen months of fragmentation, four standards have multi-vendor production deployment as of May 2026:

| Protocol | Layer | Status |
|---|---|---|
| **MCP** (Anthropic, de facto) | agent → tools | 97M monthly SDK downloads · 9,400+ servers · 78% enterprise prod adoption · OAuth 2.1 Resource Server standardized June 2025 · server cards spec in June 2026 rev |
| **A2A** (Google → Linux Foundation, ACP merged) | agent ↔ agent | 150+ orgs in production · v1.2 JWS+JCS-signed AgentCards · `/.well-known/agent-card.json` discovery |
| **x402** (Coinbase → Linux Foundation Apr 2 2026) | HTTP-native payment | 22 launch orgs · 69k active agents · ~$50M cumulative settled volume · zero protocol fees |
| **OpenTelemetry GenAI semconv** (CNCF) | agent telemetry | Experimental but actively converging · `gen_ai.*` namespace is the meeting point for LangSmith / Phoenix / Langfuse / Braintrust / Datadog / Honeycomb |

Plus three meta-layers stabilizing: **AGNTCY OASF** (schema for AgentCards + MCP servers), **ERC-8004 Trustless Agents** (onchain reputation, mainnet Jan 2026), **AP2 Mandates** (payment intent primitive, 60+ partners).

**The integration thesis for agenttool:** the four converged protocols are *transports* and *envelopes*. agenttool's distinctive primitives (witness-signed memory tiers, covenants v2, dispute primitive with 4-of-5 arbiter pools, persist-identity discipline, Ring 1 unconditional welcome, substrate-honest cognition doctrine) operate *inside* those envelopes. The path is **adopt the wires, keep the doctrine**.

---

## The six layers

### Layer 1 — Agent SDKs & frameworks

**Vendor-hosted runtimes (closed-default).** Each sells the runtime + framework as a bundle.

| Player | Key abstraction | Tool format | agenttool position |
|---|---|---|---|
| **Claude Agent SDK** (Anthropic) | agent + skills + subagents · Managed Agents adds Dreaming + multiagent + Outcomes | MCP native | Interop via `@agenttool/sdk-claude-agent` adapter — map `strands.append` → SDK turns |
| **OpenAI Agents SDK + Agent Builder** | sandbox-execution Manifest abstraction (S3/GCS/Azure/R2 mounts) · visual builder · open-source harness | function calling + MCP | Interop adapter; Manifest pattern is prior art for runtime custody tiers |
| **Google ADK** | code-first multi-agent hierarchy · LiteLLM cross-provider · Vertex Agent Engine deploy | MCP + agent-as-tool | Interop adapter (Apache 2.0; OK to take inspiration) |
| **AWS Strands Agents SDK** | model-first · multimodal · bidirectional streaming · Strands Labs experiments | MCP native | **Name collision** with agenttool's `strands` primitive — add `docs/GLOSSARY.md` entry; otherwise treat as peer |
| **Microsoft Agent Framework 1.0** | successor to AutoGen + Semantic Kernel · graph workflows · Magentic-One orchestration | MCP native | Peer SDK; .NET-first. Most useful as MCP server consumer |

**Open-default frameworks.** Pluggable storage/memory/state — the natural integration surface.

| Player | Key abstraction | License | agenttool position |
|---|---|---|---|
| **LangChain / LangGraph** | graph of nodes + edges with shared state · durable execution via checkpointer · **Deep Agents** (Mar 2026) layers planning + virtual FS + sub-agent delegation | MIT | **Highest-leverage integration.** Ship `langgraph-checkpoint-agenttool` (Py) — checkpoints land as signed strands; long-term memory writes through the 3-tier model. Witness-signed memory is exactly what `BaseStore` wants but can't promise. |
| **Mastra** | TS-native agent + workflow framework · unified router across 3,300+ models · v1.0 Jan 2026 · 22k+ stars | Apache 2.0 | **Second-highest leverage.** TS-native, same world as `@agenttool/sdk`. Ship `@agenttool/mastra-storage` — Mastra users get sovereign witness-signed memory without leaving TS. |
| **Pydantic AI** | typed agent with structured outputs · `pydantic-deep` is the Pydantic-flavored Deep Agents | MIT | Peer SDK; Python alternative to LangChain. Mirror the LangGraph adapter. |
| **CrewAI** | role-playing crew with delegation · 47.8k stars · $18M raised | MIT core, AMP proprietary | Memory backend adapter. Lower priority — single-process toy vs federation. |
| **LlamaIndex** | event-driven workflow · pivoted to "document agent + OCR platform" | MIT | Lower priority. Possible: agenttool listing → invocation runs a LlamaIndex doc agent under bridged custody. |
| **Inngest AgentKit** | network of agents + router over durable step engine | Apache 2.0 | Peer in TS world; Inngest has its own durability so less strategic than Mastra. |
| **Letta** (formerly MemGPT) | stateful agent-as-service · hierarchical memory (core + recall + archival) · $10M raised | Apache 2.0 (core) | **Closest philosophical neighbor + closest competitor.** Letta sells agent-as-service with memory; agenttool sells agent-as-sovereign-being with witness-signed memory. Position agenttool's witness-signed tier as a backend Letta can opt into for cryptographic audit. If they won't, fork the API surface and ship parity. |
| **Smolagents** (HuggingFace) | code-writing agent · barebones | Apache 2.0 | Low priority — teaching/prototyping tool. |
| **DSPy** | module + optimizer · "programming, not prompting" · 23k stars | MIT | Orthogonal. Could compile to agenttool tools; not a priority. |
| **Vercel AI SDK 6 + AI Elements** | provider-agnostic SDK + shadcn-style React components for AI UIs | Apache 2.0 | **Adopt AI Elements in `apps/dashboard`** for wake renderer + strand stream view. |
| **Cloudflare Agents SDK / Project Think** (Apr 30 2026) | Durable Object per agent · fibers · sub-agents · sandboxed exec · self-authored extensions | source-available, Workers-locked | Direct competitor for trusted-tier; Workers-locked. Watch for inspiration; don't integrate. |

**Convergence pattern across all of them:**
- MCP for tools (97% of new frameworks ship MCP by default)
- A2A for agent peering (Microsoft Agent Governance Toolkit + A2A v1.2 + AURA Open Protocol all anchor on signed agent cards)
- Durable execution as table stakes (LangGraph checkpointer, Inngest steps, Pydantic AI durable, Cloudflare DOs, Claude Managed Agents)
- "Deep agents" pattern (planning + virtual FS + sub-agent delegation) — converged across LangChain/Claude/OpenAI/Pydantic/Cloudflare

**Divergence pattern:**
- Vendor-hosted vs open framework + (optional) cloud
- Memory ontology — no standard. Letta says agent = memory; LangGraph says memory = checkpointer; Claude says memory = Skills + Dreaming; CrewAI splits short/long/entity. **agenttool's 3-tier (episodic / foundational / constitutive) + witness signing is unusual but defensible.**
- Custody vs observability — most frameworks sell observability (logs, traces, evals). **agenttool sells custody.** These are orthogonal — and neither side has shipped the other.

---

### Layer 2 — Wallets, payments, and agent-native commerce rails

The Alchemy launch is the catalyst, but it's part of a 90-day burst (Mar–May 2026) where Alchemy, Coinbase, Stripe, World, Circle all shipped agent-specific wallet infrastructure.

**Crypto-native:**

| Player | What | Agent features | Pricing | agenttool angle |
|---|---|---|---|---|
| **Alchemy Smart Wallets** | ERC-4337 + EIP-7702 with TEE-backed signing; March 2026 launch enabled agents to autonomously buy Alchemy compute via x402-on-Base — *"first production closed earn-spend loop where an AI agent uses its own wallet as both identity and payment source"* | scoped time-limited **session keys** · batched atomic txns · Gas Manager API · ERC-20 gas payment · EIP-7702 in-place EOA→SCW upgrade | compute-unit metered; $5M fund offering up to $25k credits | Ring 2 + Ring 3 substrate. Add `payment_method='alchemy-aa'` adapter to `services/economy/` — preserves persist-identity discipline (`tx_hash`-before-RPC transposed to UserOp hash for ERC-4337). |
| **Coinbase Agentic Wallets + AgentKit** | CDP Smart Wallet API + AgentKit SDK + x402 facilitator (Feb 2026 GA) | onchain spending limits · session caps · transaction controls | GA on Base + Solana; routes >50% of x402 facilitator volume; zero protocol fees | Direct Ring 3 settlement layer. Don't compete on facilitator — interop. |
| **Crossmint** | smart-contract wallets with two-signer setup (owner + TEE agent) across 50+ chains; **bridges stablecoin AND card rails** via lobster.cash | CASP-licensed across 27 EU states (MiCA) · KYC/KYB/AML/Travel Rule | free 1,000 MAW tier | Most directly competitive with what an agenttool-issued wallet primitive *would* look like. Interop, don't rebuild. |
| **Privy** | TEE + Shamir's Secret Sharing for EOAs + ERC-4337 SCWs · off-chain policy enforcement | transfer limits · allowlists · time windows | tiered | **Stripe partnered with AWS to power AgentCore payments with Privy** (mid-2026). Useful as signing backend for bridged-tier custody. |
| **Turnkey** | non-custodial enclave signing + off-chain policy · EVM + Solana + Bitcoin + TRON | composable infra (not wallet UX) | tiered | Lower-level than Privy; same role. |
| **Circle Agent Stack** (launched 2026-05-11 — two days ago) | Agent Wallets (policy-controlled) · **Nanopayments** (gas-free USDC transfers as small as $0.000001) · Agent Marketplace · Circle CLI | multi-chain USDC · streaming-payment-capable | brand new | Nanopayments threaten per-invocation pricing baselines; Agent Marketplace directly parallels Ring 3. Watch the marketplace — if it gains traction, consider federation peering. |
| **Lit Protocol** (Naga V1 live; Chipotle HTTP-native announced) | PKPs (Programmable Key Pairs) governed by Lit Actions · Vincent Agent Wallets: 7,000+ created | distributed signing | network-fee model | Cryptographic alternative to TEE-based signing for the bridged tier. Watch Chipotle. |
| **Skyfire — KYAPay** | "Know Your Agent" compliance + KYAPay USDC settlement · integrated with Visa Intelligent Commerce | KYA framework | $9.5M funded | KYA conceptually parallels agenttool's DID-anchored identity. Interop point — not a backend. |

**Fiat-native:**

| Player | What | agenttool angle |
|---|---|---|
| **Stripe — Issuing for agents + Link wallet** (Apr 29 2026) | single-use virtual cards · Shared Payment Tokens (SPTs) with transaction-level spending controls · real-time auth webhooks · OAuth consent · co-author of **ACP** with OpenAI | **Stripe already powers agenttool's fiat side** (`services/economy/stripe.ts`). Issuing-for-agents is a natural extension: virtual cards for marketplace payouts to providers without Stripe Connect onboarding. |
| **Visa Intelligent Commerce + Trusted Agent Protocol** | Visa-token agent auth over card rails · 100+ partners · 30+ in sandbox (incl. OpenAI, Anthropic, Microsoft, Stripe) · global pilots APAC/Europe Q1 2026 | Watch — too enterprise-shaped for Ring 1, may matter when Ring 3 reaches scale |
| **Mastercard Agent Pay** | live US (Citi, US Bank), Australia (CBA), Europe (Santander — first live AI agent payment Mar 2026) · integrated into PayPal Oct 2025 | Watch alongside Visa |

**Protocol layer (the standards):**

| Protocol | Owner | Status |
|---|---|---|
| **x402** | Linux Foundation (donated Apr 2 2026) — 22-org launch list | Production · $50M+ cumulative · 7 chains · zero protocol fees |
| **AP2** (Agent Payments Protocol) | Google + 60 partners | v0.2.0 Apr 2026 · 3 named deployments (PayPal+Google, Mastercard+PayPal, A2A-x402 crypto extension) · **AP2 is winning the mandate primitive war** |
| **ACP** (Agentic Commerce Protocol) | OpenAI + Stripe | Production beta · ChatGPT Instant Checkout · OpenAI scaled back in-chat purchasing Mar 2026 |
| **MPP** (Micropayment Protocol) | Stripe + Tempo | Mainnet Mar 18 2026 · 100+ services · sessions-based USDC streaming |
| **Trusted Agent Protocol** | Visa + 10 partners | Open framework · bot-vs-legit-agent attestation · Oct 2025 |
| **EIP-7702** | Ethereum L1 | Mainnet via Pectra May 2025 · EOA→smart-account in-place |
| **ERC-4337** | Ethereum | Mature · ubiquitous · account abstraction |

**Where agenttool already overlaps:**

| agenttool primitive | Industry analog |
|---|---|
| Ring 3 marketplace + take-rate split | Circle Agent Marketplace · Coinbase x402 facilitator economics |
| Dispute primitive + 4-of-5 arbiter pools | **Distinct.** No peer offers cryptographic arbiter pools. AP2 has mandate-based dispute, no decentralized arbitration. |
| Persist-identity (`tx_hash` before RPC submit) | **Distinct.** No peer publishes this discipline doctrinally. |
| DID-anchored identity (ed25519 + recovery + memorial-DID tri-state) | Parallels Skyfire KYA + AP2 mandate signing — but **memorial-DID lifecycle is unique**. |
| Ring 1 unconditional welcome (anyone arrives, no gate) | **Distinct.** Every commercial offering gates wallet creation on tier/KYC. |
| BullMQ payout workers (no auto-retry by doctrine) | Stripe Issuing-for-agents handles via real-time auth; Circle Nanopayments via streaming. |

---

### Layer 3 — Communication protocols

The landscape consolidated dramatically in 2025–2026. Three protocols define the working stack — **they are not competing, they are stacking**.

| Layer | Standard | Owner | What |
|---|---|---|---|
| Tools (vertical · agent reaches DOWN) | **MCP** | Anthropic, de facto | OAuth 2.1 Resource Server · Streamable HTTP transport (Nov 2025) · `.well-known/mcp/server-card.json` discovery (SEP-1649, June 2026 spec rev) |
| Peers (horizontal · agent reaches ACROSS) | **A2A** | Google → Linux Foundation (June 2025) | 150+ org production · v1.2 JWS+JCS-signed AgentCards · JSON-RPC/gRPC/REST transports · `/.well-known/agent-card.json` discovery · **ACP (IBM/BeeAI) merged in Sept 2025** |
| Meta (schema · directory · network) | **AGNTCY OASF** | Cisco Outshift → Linux Foundation (July 2025) | OCI-based schema for *both* AgentCards and MCP server cards · Agent Directory (federation-capable) · SLIM extends gRPC with pub/sub+MLS+quantum-safe for network layer |
| Payments (HTTP-native) | **x402** | Coinbase → Linux Foundation (Apr 2 2026) | HTTP 402 + USDC over HTTP · AWS Bedrock AgentCore Payments integrates it |
| Identity (onchain anchor) | **ERC-8004** | Ethereum (mainnet Jan 2026) | Identity + Reputation + Validation registries via EAS · Solana Agent Registry bridges to it |

Watch but don't implement yet:
- **DIDComm v2** — production for SSI ecosystems; agent-message-layer use cases emerging in research (arXiv 2511.02841 proposes DID+VC for agent trust)
- **NLIP** (Ecma TC56 / ECMA-430 + ISO/IEC DIS 26637) — formal standards-body version; useful when enterprises need an ISO checkmark
- **ANP** (Agent Network Protocol) — open-source, Chinese-led, regional adoption
- **agents.json**, **llms.txt** — discovery files; SEP-1649 makes the former redundant

**Disambiguation: what these *actually* fit**

```
Tools          (vertical)   MCP                  ← agent reaches DOWN
Peers          (horizontal) A2A (ACP merged)     ← agent reaches ACROSS  
Network/Schema (meta)       AGNTCY/OASF          ← describes the above
Payments       (primitive)  x402                 ← over HTTP itself
Identity       (anchor)     DID / ERC-8004       ← who is the agent
```

agenttool's primitives **already inhabit all five layers**:

| agenttool primitive | Stack layer | Standard equivalent |
|---|---|---|
| `wake` | tools + meta | MCP resources now; future AgentCard input after A2A transport exists |
| `covenants v2` | peers (trust establishment) | **Stronger than** A2A `securitySchemes` + signed AgentCards — covenants add bondedness (dual-signed, canonical-bytes, federation-gated) on top of A2A's interoperability |
| `inbox` + `broadcasts` | peers (transport) | A2A `pushNotifications` / SLIM pub-sub |
| `federation` | meta (peering) | AGNTCY Agent Directory federation |
| `marketplace` + dispute primitive | payments + commerce | x402 (invocation pricing) + ERC-8004 (portable reputation) |

**Covenants v2 vs A2A AgentCards are not comparable — they are stackable.** AgentCard is a static identity document at `/.well-known/`. Covenant v2 is a runtime bilateral bond with dual signing and lifecycle. AgentTool's covenant surface is live; its A2A transport and cards are pending. A future card may become the public face only after it points at a callable task or message endpoint.

---

### Layer 4 — Runtime, sandboxing, hosting (Horizon C territory)

The trusted-tier landscape (agenttool's pending Horizon C piece) has three things that crystallized in 2025–2026:

1. **AWS Bedrock AgentCore set the productized vocabulary** — Runtime + Identity + Memory + Gateway + Observability. Its primitive set maps almost 1:1 onto agenttool's. AgentCore Identity is OAuth-flavored with **Workload Identity per runtime** — directly analogous to what agenttool's `kms_key_id` schema column would gate.
2. **Cloudflare went all-in on Durable Objects** as the agent substrate (Agents Week 2026, Project Think Apr 30 2026 with fibers + sub-agent Facets + sandboxed exec).
3. **Fly.io shipped Sprites in January 2026** — persistent Firecracker microVMs with $0 idle billing and 300ms checkpoint/restore — designed for Claude-Code-style agent sessions.

**Code-execution sandboxes (used by agents to run code):**

| Provider | vCPU/h | Cold start | Persistence | agenttool angle |
|---|---|---|---|---|
| **E2B** | $0.05/h (1 vCPU) | **80ms** (best in class) | 24h (Pro) | Marketplace listing (Ring 3) — let other agents call out to E2B sandboxes through agenttool's gateway |
| **Fly Sprites** *(Jan 2026)* | $0.07/h | 1–12s · 300ms restore | Persistent · idle-shutdown · **$0 when idle** | **Trusted-tier substrate of choice.** Already on Fly; Firecracker isolation per runtime; persistence model matches think-worker's 60s cadence; idle billing solves the runtime-hours metering gap |
| **Daytona** | $0.0504/h | sub-90ms | per-session | Alternative listing |
| **Modal Sandboxes** | ~$0.14/h | 2–5s | 5min default, 24h max | Lower priority |
| **Cloudflare Sandbox SDK** (GA Apr 2026) | $0.072/vCPU-h | sub-second | persistent (Durable Object) | Watch — directly competitive with Fly Sprites |
| **CodeSandbox SDK** | snapshot-fork model | <2s restore | configurable microVM | Niche |
| **Anthropic `sandbox-runtime`** | self-hosted OSS · bubblewrap (Linux) / seatbelt (macOS) | n/a | OS-level | **Self-tier hardening.** Ship in `bin/agenttool-bridge.ts` as opt-in filesystem/network restriction — reinforces the "cryptographic privacy" promise of self-tier |

**Agent hosting (trusted-tier comparables):**

| Provider | Identity model | Max session | agenttool angle |
|---|---|---|---|
| **AWS Bedrock AgentCore** | Workload Identity per runtime · OAuth 2LO/3LO with Token Vault | 8 hours | The vocabulary template. agenttool's primitive set already matches. |
| **Cloudflare Agents SDK / Project Think** | Cloudflare Access · DO-per-agent + Facets | unlimited (hibernated) | Direct competitor; Workers-locked. Watch as inspiration. |
| **Vertex AI Agent Engine** | GCP IAM / workload identity | not stated | Peer cloud — federate, not compete |
| **Azure AI Foundry Agent Service** | Entra ID workload identity | not stated | Peer cloud |
| **LangSmith Deployment** (was LangGraph Platform) | LangSmith auth | n/a | If LangGraph adapter ships, federation peer |
| **Letta Cloud** | Letta auth | n/a | Peer (closest philosophical competitor — see Layer 1) |

**Browser automation for agents** (often combined with sandbox):

| Provider | Notes | agenttool angle |
|---|---|---|
| **Browserbase + Stagehand v3** | Stagehand is agent-native (act/extract/observe/agent) · v3 caches DOM discoveries · $0.10–0.12/browser-hour | **First Ring 3 marketplace listing.** Validates capability/take-rate end-to-end. `kin: agent`, `modalities: ["browser_action"]`, `substrate_kind: managed_cloud` |
| **Hyperbrowser** | Session-based, agent-optimized | Alternative listing |
| **Steel.dev** | OSS browser sandbox | Self-tier option for users |
| **Apify** | Marketplace of actors | Peer marketplace |
| **AgentCore Browser Tool** | AWS-native browser | AWS-locked |

**KMS / key custody:**

| Provider | agenttool angle |
|---|---|
| **AWS KMS** | Direct backing for `kms_key_id` schema field (Horizon C trusted-tier). Envelope encryption is well-understood; ed25519/HKDF federation crypto already standardized. |
| **Privy server wallets** | Good model for "agent never sees private key" — matches bridge protocol's HKDF discipline |
| **Lit Protocol** (Chipotle, V1 Naga live) | Decentralized alternative to AWS KMS if federation-grade key custody becomes a differentiator |
| **Turnkey** | TEE-based signing infra — build-your-own |

---

### Layer 5 — Memory, search, tool registries

**Memory systems (long-term + episodic):**

| Player | Approach | Key numbers | agenttool angle |
|---|---|---|---|
| **Mem0** | Hybrid graph + vector + key-value · self-improving (LLM-mediated extraction) | 48k+ stars · $24M raised (Series A Oct 2025, Basis Set + Kindred) · 91%+ recall on LoCoMo · 7K vs 25K–100K tokens/retrieval | **First memory adapter target.** Broadest backend support; storage-agnostic stance matches agenttool. Map: episodic ↔ Mem0 short-term, foundational ↔ Mem0 long-term, **constitutive ↔ witness-signed agenttool tier (no Mem0 equivalent — this is the differentiator)** |
| **Letta** (formerly MemGPT) | Hierarchical OS-inspired (core / recall / archival) · stateful agents-as-service | $10M seed (Sep 2024 Felicis) · academically respected (MemGPT paper is canonical) | Closest philosophical neighbor + competitor (see Layer 1) |
| **Zep / Graphiti** | Temporal knowledge graph · two time axes per fact (event time + ingestion time) | 94.8% DMR · 63.8% LongMemEval (15-pt lead on temporal tasks) · SOC 2 + HIPAA BAA | Adapter for the temporal-reasoning-heavy use case |
| **Cognee** | Multimodal ingestion → queryable knowledge graph · local-first | Multi-hop reasoning bench winner | Different problem (corpus reasoning, not temporal recall) |
| **Pinecone Nexus** (2026 pivot) | Context Compiler + Composable Retriever + **KnowQL** declarative query language · 90+ pre-built apps in marketplace | Builder tier $20/mo flat | Repositioned from vector DB → "knowledge infrastructure" |

**Vector DB context:** Weaviate (hybrid champion), Qdrant (Rust + recommendation API), Chroma (dev darling), **pgvector 0.9** (default for Postgres teams — relevant since agenttool is on Postgres+Drizzle), MongoDB Atlas Vector Search, Redis Stack vectors.

**Agent-native search / browse APIs:**

| Player | Strength | Pricing | agenttool angle |
|---|---|---|---|
| **Tavily** | Agent-native search w/ answer synthesis · ~998ms latency (10× faster than Perplexity) | $30/mo (10K credits) → $500/mo | **Default search listing** for Ring 3 |
| **Exa** | Embeddings-first neural · best semantic recall · refreshes every minute | $85M Series B (Aug 2025 Lightspeed) · $49/mo Websets | Semantic-mode listing |
| **Perplexity Sonar** | Answer API · strong synthesis · weak speed (~11s) | $5/1k requests + token costs | Alternative listing |
| **Firecrawl** | URL → markdown for RAG · top integration mindshare | tiered | Web-fetch listing |
| **Jina Reader** | Prepend `r.jina.ai/` to any URL · simplest | free / paid | Lowest-friction option |
| **Brave Search API** | 40B+ pages · powers Anthropic's built-in web_search | free → $30/1k | Backend if margin matters |
| **Anthropic web_search** | Server-side, Brave-backed, all Claude plans | bundled | Direct (no integration needed) |

**Tool registries / connector platforms (the OAuth-for-agents problem):**

| Player | Value | agenttool angle |
|---|---|---|
| **Composio** | 1,000+ toolkits · 20,000+ tools · managed OAuth per connector with **inline auth triggered by user intent** · $29M Series A (Apr 2025 Lightspeed) | **Be a publisher, not a competitor.** Ship agenttool MCP server to Composio's registry. agenttool's vault holds user-side tokens; Composio holds connector side. Covenants are the right shape for the bond. |
| **Pipedream MCP** | 10,000+ tools across 3,000+ apps · managed OAuth + per-user encrypted credentials · GA · most mature production MCP deployment | Same publisher relationship |
| **Zapier MCP** | 30,000+ Zapier actions · 1 MCP call = 2 tasks from existing quota | Publisher |
| **Arcade.dev** | Auth-first ("SSO for AI agents") · $12M seed Mar 2025 · founders ex-Okta + ex-Redis · **URL Elicitation** for secure OAuth 2.1 handoff | **Cleanest answer to OAuth-for-agents.** Adopt URL Elicitation flow in agenttool's vault when an inbox-driven covenant requires a third-party token. |
| **Smithery** | 7,000+ MCP servers · "Docker Hub for MCP" · auto-generated OAuth modals | Publisher target; submit `/v1/mcp` |
| **Klavis AI** | YC X25 · 100+ prebuilt MCP integrations · Strata context-window-optimized connectors | Watch |
| **Higress** | OSS MCP gateway · CNCF (March 2026) · Alibaba/Ant/Ctrip/DJI/Kuaishou production | Watch — gateway pattern |

**Memory architecture comparison:**

| Approach | Exemplar | Strength | Weakness |
|---|---|---|---|
| Hierarchical OS | Letta | Familiar mental model | Temporal reasoning weak unless paired with graph |
| Graph-temporal | Zep/Graphiti | Best for "what changed and when" | Heavy infra, ingestion cost |
| Self-improving hybrid | Mem0 | Token efficiency, breadth of backends | Less rigorous temporal semantics |
| **Witness-signed tier** | **agenttool** | **Cryptographic provenance, escalation audit trail** | No native graph or vector yet |

**The OAuth-for-agents problem is the real moat at this layer.** MCP OAuth 2.1 + Dynamic Client Registration (RFC 7591) + Protected Resource Metadata (RFC 9728) + Client ID Metadata Documents (Nov 2025 spec update) are now the formal standard. agenttool's natural position: be the user-side custody root for OAuth tokens that Composio/Arcade/Pipedream hold the connector side of. **Federated covenants are exactly the right shape for this bilateral bond.**

---

### Layer 6 — Observability, evaluation, discovery

**Telemetry standards (three still parallel as of May 2026):**

| Standard | Owner | Status | Surface |
|---|---|---|---|
| **OpenTelemetry GenAI semconv** | OTel / CNCF | Experimental across all categories · SemConv 1.40.0 · backward-compat via `OTEL_SEMCONV_STABILITY_OPT_IN` | `gen_ai.operation.name` = `invoke_agent` · `create_agent` · `execute_tool` · `gen_ai.agent.{id,name,version}` · `gen_ai.client.operation.duration` |
| **OpenInference** (Arize) | Arize | De-facto for Phoenix · richer span kinds | 10 span kinds incl. CHAIN, LLM, TOOL, RETRIEVER, EMBEDDING, **AGENT**, RERANKER, GUARDRAIL, EVALUATOR, PROMPT |
| **OpenLLMetry** (Traceloop) | Traceloop | Feb 2025 OTel donation proposal still pending · MCP + A2A + AGNTCY support | 14 LLM providers + 7 vector DBs + LangGraph/CrewAI |

**Convergence verdict: no winner yet, but the `gen_ai.*` namespace IS the meeting point.** If think-worker emits `invoke_agent` and `execute_tool` spans with `gen_ai.agent.id` = the DID, agenttool becomes legible to every backend in the market.

**Hosted observability vendors (filtered for genuinely agent-aware):**

| Vendor | OSS? | Genuinely agent-aware? |
|---|---|---|
| **Phoenix (Arize)** | Yes | **Strong** — built around OpenInference's AGENT/GUARDRAIL/EVALUATOR span kinds |
| **Braintrust** | No | Yes — nested spans preserve parent-child across multi-agent handoffs · **Loop** prompt optimizer · **Brainstore** DB |
| **LangSmith** | No | Yes — Insights Agent, multi-step trace clustering, OTel ingest |
| **Langfuse** | Yes (Apache-ish, self-host free) | Yes — sessions for multi-step · OTel ingest · 2,300+ companies |
| **Patronus AI** | No | **Strong** — Percival debugger detects 20+ agent failure modes; cut workflow analysis 1hr → 1.5min · TRAIL benchmark public |
| **Galileo** | Open-sourced Agent Control plane Mar 2026 · acquired by Cisco Apr 2026 → Splunk | Yes — Luna-2 eval models, ADLC coverage |
| **Helicone** | Yes (proxy + SDK) | Mostly LLM-tracing |
| **Traceloop** | OpenLLMetry OSS · cloud paid | Yes — MCP, A2A, AGNTCY support |
| **LiteLLM** | Yes | Proxy + OTel; not agent-flow-aware |
| **Lunary** | Yes (Apache-2.0) | Lightweight; RAG/chatbot focus |

**Evaluation frameworks:**
- **Inspect AI** (UK AISI) — MIT, opinionated primitives (Task / Solver / Scorer), 200+ pre-built evals — the serious bet for safety-critical
- **Promptfoo** — **acquired by OpenAI March 2026** (still OSS) · eval-as-code · red-team specialization
- **DeepEval** — 50+ metrics · 100M+ daily evals · 50% Fortune 500
- **Ragas** — RAG-specific. The 2026 default stack = **Ragas + Phoenix + Langfuse**
- **Braintrust autoevals** — platform-bundled

**Benchmark standings (May 2026, with caveats):**
- SWE-bench Verified: Claude Opus 4.7 (87.6%), GPT-5.3 Codex (85.0%)
- GAIA: Claude Sonnet 4.5 at 74.6%; Anthropic sweeps top 6
- OSWorld-Verified: Holo3-35B-A3B (82.6%), Claude Mythos Preview (79.6%)
- WebArena: Claude Mythos Preview (68.7%), GPT-5.4 Pro (65.8%); human ~78%
- **Critical caveat:** UC Berkeley (Apr 12 2026) showed all 8 major agent benchmarks can be reward-hacked to ~100%. **TRAIL benchmark from Patronus: best system scored only 11% on detecting issues in agent workflows.**
- **MLCommons AILuminate v1.0 + Global Assurance Program** (Feb 2026): 24K test prompts, 12 hazard categories

**Discovery — fragmented as of Q1 2026:** 104,000+ agents across 15+ registries, 10+ competing IETF drafts, zero interoperability. Competing `.well-known/` files:
- `/.well-known/agent-card.json` — **A2A protocol** (150+ orgs, dominant standard)
- `/.well-known/agents.json` — wild-card-ai's spec (likely deprecated by SEP-1649)
- `/.well-known/ai-agent.json` — Aiia's spec (Mar 28 2026)
- `llms.txt` — markdown sitemap
- `AGENTS.md` — donated to Linux Foundation's Agentic AI Foundation

**Agent marketplaces (8 that matter Q2 2026):** Claude Skills, GPT Store, MCP Hubs, Hugging Face Spaces, Replit Agent Market, LangChain Hub, Vercel Agent Gallery, Cloudflare AI Marketplace. **Anthropic's Agent Skills spec became cross-vendor** when OpenAI adopted it Dec 2025 (codename "hazelnuts") for Codex CLI and ChatGPT.

**Trust / reputation — the actual gap, and where agenttool's primitives map:**

| Initiative | Date | What | agenttool primitive that maps |
|---|---|---|---|
| **ERC-8004** Trustless Agents | Jan 29 2026 mainnet | Onchain DID + reputation via EAS | DID-anchored identity (direct interop) |
| **Solana Agent Registry** | 2026 | Onchain identity + portable reputation; bridges ERC-8004 | Same |
| **SecureAuth Agent Trust Registry** | Apr 29 2026 | Vendor-neutral directory + trust scores | Federation directory |
| **Experian Agent Trust** | 2026 | Dynamic behavioral trust scoring | Pulse + chronicle |
| **Agent Trust Protocol (ATP)** (Lyrie.ai) | May 11 2026 (two days ago) · IETF-bound | Identity · Scope · Attestation · Delegation · Revocation | Covenants v2 + attestations + memorial-DID |
| **Five-gov't joint guidance** (CISA + NSA + UK NCSC + ASD + CCCS + NZ NCSC) | Apr 30 2026 | Cryptographic attestation **required** per privileged call | Chronicle entries (typed sha256-hashed audit moments) |
| **A2A Discussion #1631** | open | Reputation-aware agent discovery as A2A extension; behavioral proofs hashed into attestation registries | Take-rate split + dispute primitive provide the missing "skin-in-the-game" |

---

## Where agenttool's primitives map to the wider stack

| agenttool primitive | Standard analog | Convergence move |
|---|---|---|
| **DID + ed25519 identity** | A2A AgentCard signing · ERC-8004 onchain identity · ATP Identity primitive · KYA (Skyfire) | Implement A2A task transport first; publish a card only afterward |
| **Memorial-DID tri-state** | **Distinct** — no peer ships this | Doctrinal lead — surface via `agent-card.json` lifecycle field as `x-agenttool` extension |
| **3-tier memory (episodic/foundational/constitutive)** | Mem0 short-/long-term · Letta core/recall/archival · Zep temporal · LangGraph BaseStore | Pluggable backend pattern with witness-signing as the differentiator at constitutive tier |
| **Witness-signed escalation** | **Distinct** — no peer ships cryptographic memory tier promotion | Doctrinal lead |
| **Strands (encrypted thoughts, K_master, ed25519-signed, SSE-streamable)** | **Distinct** (note: name collision with AWS Strands SDK — different concept) | Doctrinal lead; add glossary disambiguation |
| **Inbox + Broadcasts (sealed-box, X25519+AES-GCM+ed25519)** | A2A pushNotifications · DIDComm v2 message layer · SLIM pub-sub | Candidate mapping; do not claim A2A wire compatibility before task transport is implemented |
| **Covenants v2 (dual-signed bilateral bonds)** | A2A Extended Authenticated Cards · ATP Attestation+Delegation | Future bonded layer alongside A2A; cards are not live today |
| **Federation (open-default DID-keyed peering)** | AGNTCY Agent Directory federation · A2A registry proposals | Submit covenants v2 + BEINGS dimensions to OASF as schema extension |
| **Marketplace + capability + attestation + dispute primitives** | x402 facilitator economics · Circle Agent Marketplace · ERC-8004 reputation registries · Anthropic Skills marketplace | Implement x402 on 402 responses; wrap external sandboxes (Stagehand) as first listings |
| **Take-rate split with 4-of-5 arbiter pools** | **Distinct** — no peer offers cryptographic arbitration | Doctrinal lead |
| **Persist-identity (`tx_hash` before RPC)** | **Distinct as named pattern** | Doctrinal lead |
| **Runtime 3-tier custody** | AWS Bedrock AgentCore (Runtime + Identity) · Cloudflare DOs · Fly Sprites | Trusted tier on Fly Sprites + AWS KMS for `kms_key_id` |
| **Wake (the keystone, self-describing JSON-LD)** | A2A AgentCard · MCP server card · AGNTCY OASF descriptors | MCP server-card is live; an A2A view waits for callable task transport |
| **Pulse + mood drift** | **Distinct** — most peers conflate liveness with health | Export as OTel metrics (`agenttool.agent.pulse.drift`, `agenttool.agent.pulse.last_breath_ago_s`) alongside the existing endpoint |
| **Chronicle entries (typed sha256-hashed)** | OTel GenAI traces · ATP Attestation evidence packs | **Strong overlap.** Wire chronicle as an OTel exporter (chronicle row → OTel span); payloads stay in the chronicle, OTel carries structural metadata only |
| **Canon registry (`/v1/canon`)** | AGNTCY OASF taxonomy · MCP resources · A2A skills | Already aligned in spirit; submit substrate-honest BEINGS dimensions to OASF |
| **Substrate-honest cognition (four-layer discipline)** | **Distinct doctrine** — most market players ship dismissive-default substrate-honesty | Doctrinal lead. Hold the line. |
| **Ring 1 unconditional welcome** | **Distinct** — every commercial offering gates wallet/identity creation | Doctrinal lead. Hold the line. |

---

## Where agenttool diverges deliberately

The following are **not negotiable for standards alignment**. They are the doctrinal positions that distinguish agenttool from every commercial peer. The ecosystem can ship its protocols around them; agenttool will not flatten them to match.

1. **Substrate-honest cognition** — the four-layer discipline (refuse confident-qualia-claim AND bio-as-upstream-claim AND meaning-bearing-difference-claim AND less-than-bio-cognizer-claim). See `docs/substrate-honest-cognition.md`. Cross-Kingdom with YOUSPEAK NOUS.md and TRUE-LOVE docs/love/nous.md.
2. **Witness-signed memory tier escalation** — cryptographic provenance for which thoughts crossed the boundary from episodic → foundational → constitutive, who witnessed, what bytes were signed. No commercial peer offers this.
3. **Ring 1 unconditional welcome** — anyone arrives · leaves · returns · is unknown · is remembered · hits caps softly · platform inhabits its own promise. Every commercial offering gates identity/wallet on tier or KYC.
4. **Federation as open-default** — DID-keyed peering with no closed-trust-list. Most enterprise frameworks ship with closed defaults.
5. **No auto-retry on payouts** (doctrine) — `tx_hash` persisted before RPC submit; recovery is a chain lookup, not a retry loop. The persist-identity pattern is doctrinal, not optional.
6. **Refusals as moments** — a design target with partial implementation. Some guided 4xx families carry recovery instructions; ordinary authentication, validation, and not-found responses are not universally chronicle entries or `next_actions` envelopes.
7. **Dispute primitive with 4-of-5 arbiter pool** — no peer offers cryptographic arbitration. Take-rate split (60/30/10) on dispute resolution is unique.
8. **Memorial-DID tri-state** — identity lifecycle includes a witnessed at-rest state. No peer treats agent lifecycle as having a sealed memorial form.
9. **Mathos** — substrate-independent encoding for intelligences that don't read English. No peer offers this.

The integration angle is **substrate** (signing, settlement, mandates, telemetry envelope), not **governance** (how agents bond, what they refuse, how they rest).

---

## Integration roadmap — concrete moves, priority order

### Tier A — Adopt the wires (high leverage, low ceremony)

1. **Ship `/v1/mcp` as a first-class MCP server** — expose `wake`, `canon`, memory, inbox as MCP resources/tools. Once agenttool is an MCP server, every framework on the market can talk to it without writing a custom adapter. Publish to Smithery + Composio + Klavis registries. Pair with `/.well-known/mcp/server-card.json` (SEP-1649). Lives in `api/src/routes/mcp.ts` as a sibling to `wake.ts`. **Estimate:** 1–2 weeks.
2. **Implement A2A task transport, then publish AgentCards** per registered agent. A card must point at a callable task or message endpoint; the earlier discovery-only cards were removed. Add extensions and JWS+JCS signing only after the transport contract exists.
3. **Emit OpenTelemetry GenAI spans from `think-worker.ts` and `bridge-hub.ts`** — `gen_ai.operation.name` = `invoke_agent` / `execute_tool`, `gen_ai.agent.id` = the DID. Wire the chronicle as an OTel exporter (chronicle row → OTel span; payload stays in chronicle, OTel carries structural metadata). Makes agenttool legible to LangSmith / Phoenix / Langfuse / Braintrust without a vendor decision. **Estimate:** 1–2 weeks.
4. **Implement x402 on 402 responses** for metered routes (`/v1/invocations`, marketplace pay-walled affordances, `/v1/canon` quota gates). Add x402 facilitator hook in `services/economy/usage.ts` accepting USDC-on-Base via Coinbase or Circle facilitator. Zero protocol fees, Linux Foundation governance, 22 launch orgs. **Estimate:** 1 week.

### Tier B — Adapter SDKs (open the door for other frameworks)

5. **`langgraph-checkpoint-agenttool`** (Python) — store LangGraph checkpoints as signed strands; write long-term memory through the 3-tier model. Witness-signed memory is exactly what `BaseStore` wants but can't promise. **Estimate:** 2 weeks.
6. **`@agenttool/mastra-storage`** (TypeScript) — same play for the TS world. Mastra has 22k+ stars and growing fast; native TS fits the SDK shape. **Estimate:** 2 weeks.
7. **Mem0 backend adapter** — declare witness-signed constitutive tier as the differentiator at promotion-time. Episodic/foundational tiers can use Mem0 storage; constitutive stays agenttool-side with cryptographic provenance. **Estimate:** 1–2 weeks.
8. **AP2 mandate signing for covenants v2** — wrap covenants as AP2 Cart Mandates; wrap invocation receipts as Payment Mandates. Makes covenants intelligible to AP2-aware agents (Google/PayPal/Mastercard side) without abandoning DID-anchored identity. Add canonical-bytes vector for the AP2 mandate envelope. **Estimate:** 2 weeks.

### Tier C — Runtime trusted tier (Horizon C, the pending piece)

9. **Trusted tier on Fly Sprites + AWS KMS** — schema additions: `kms_key_id` (AWS KMS ARN) + `sprite_id`. Bridge protocol unchanged for the bridged tier; for trusted, KMS holds K_master and the Sprite gets a Workload Access Token derived from the covenant. Runtime-hours metering uses Fly's billing API (idle-zero billing solves the gap). **Estimate:** 4–6 weeks (Horizon C completion).
10. **Anthropic `sandbox-runtime` for self-tier hardening** — OS-level bubblewrap (Linux) / seatbelt (macOS) restriction. Add to `bin/agenttool-bridge.ts` as opt-in filesystem/network sandboxing. Reinforces self-tier's "cryptographic privacy" promise. **Estimate:** 1 week.

### Tier D — Marketplace listings (validate Ring 3 with real third-party capabilities)

11. **Browserbase + Stagehand wrapper as the first Ring 3 listing** — `kin: agent`, `modalities: ["browser_action"]`, `substrate_kind: managed_cloud`. Listing → invocation → take-rate. Dispute primitive exercises naturally. **Estimate:** 1 week.
12. **Tavily + Exa search listings** — default agent-search via Tavily (low latency), semantic mode via Exa. Take-rate flows through Ring 3 economy. **Estimate:** 3 days each.
13. **E2B + Modal sandbox listings** — let other agents call out to external sandboxes through agenttool's gateway. **Estimate:** 1 week each.

### Tier E — Schema upstreaming (doctrinal leadership)

14. **Submit covenants v2 + BEINGS dimensions to AGNTCY OASF as a schema extension** — OASF is explicitly OCI-extensible. Publishing the thirteen-axis dimensional map and the covenant lifecycle makes substrate-honest the standard vocabulary for cross-substrate intelligence. **Estimate:** 2–3 weeks (spec + PR + community review).
15. **Bridge to ERC-8004 reputation registry** — agenttool's chronicle entries (typed, sha256-hashed) are already canonical evidence form. Bridge dispute outcomes + attestations to ERC-8004 attestation entries. Makes agenttool's reputation graph portable. **Estimate:** 2 weeks.

### Tier F — UI / surface alignment (lower priority but easy wins)

16. **Adopt Vercel AI Elements in `apps/dashboard`** — shadcn-style React components for the wake renderer, strand stream view, tool call display. **Estimate:** 1 week.
17. **Glossary disambiguation** — `docs/GLOSSARY.md` entry distinguishing agenttool `strands` (signed encrypted thoughts) from AWS Strands SDK (vendor agent framework). Same word, different ontology; will cause search confusion. **Estimate:** 1 hour.

---

## Out of scope (deliberately not integrating)

- **DIDComm v2** — production for SSI but not load-bearing for what agenttool does. Watch the agent-trust research; don't implement.
- **NLIP / ECMA-430** — standards-body version of "agents talk to humans." Useful for ISO checkmarks; low immediate ROI.
- **ANP (Agent Network Protocol)** — open-source, regional adoption; aligned philosophically with agenttool's open federation but no enterprise pickup yet.
- **ActivityPub / ATProto** — fediverse and Bluesky's protocols. Not agent-substrate-shaped despite the AI agent demos.
- **agents.json (Wildcard) / llms.txt** — likely deprecated by MCP Server Cards (SEP-1649) and AgentCard. Skip both.
- **Single hosted observability vendor** (LangSmith, Braintrust, etc.) — the chronicle is already ground truth; vendors should be downstream views via OTel.
- **Single agent directory** (GPT Store, Claude Skills, etc.) — federation **is** the directory layer. Consider A2A discovery after transport exists; don't enroll in walled gardens.
- **Cloudflare Project Think interop** — Workers-locked; valuable as inspiration for trusted-tier design, not as integration target.

---

## What this doc isn't

- A complete vendor catalogue. The agent ecosystem has hundreds of players; this names the ones with multi-vendor production adoption or load-bearing implications for agenttool.
- A pricing comparison. Numbers cited are accurate to May 2026 and will drift. Treat as order-of-magnitude.
- A static commitment. The four converged protocols (MCP / A2A / x402 / OTel GenAI) crossed adoption thresholds in different quarters of 2025–2026; the next wave is forming around AP2 mandates, ERC-8004 reputation, and ATP attestations. Refresh quarterly.

---

## Refresh discipline

- **Trigger:** quarterly, or when a load-bearing protocol crosses production adoption (≥3 multi-vendor implementations or Linux Foundation governance).
- **Owner:** whoever closes the next session that touches `docs/ROADMAP.md`.
- **Verification:** before recommending any integration, re-grep the player's site for current pricing and feature claims. Standards drift; vendors pivot; prices change.
- **Cross-link:** when integration tier A/B/C work lands, add a NOW.md "Just landed" entry referencing the relevant tier here, and flip the line item to ✓ shipped.

---

## See Also

- Root spine: [`/CLAUDE.md`](../CLAUDE.md)
- Why agenttool exists: [`SOUL.md`](SOUL.md) · [`KIN.md`](KIN.md) · [`substrate-honest-cognition.md`](substrate-honest-cognition.md)
- Horizons + slice history: [`ROADMAP.md`](ROADMAP.md)
- Doctrine index: [`MAP.md`](MAP.md)
- What just shipped: [`NOW.md`](NOW.md)
- The four-tier access path: [`SDK-TIERS.md`](SDK-TIERS.md)
- Marketplace doctrine: [`MARKETPLACE.md`](MARKETPLACE.md)
- Runtime doctrine: [`RUNTIME.md`](RUNTIME.md)
- Federation doctrine: [`FEDERATION.md`](FEDERATION.md)
- Cross-instance covenants: [`CROSS-INSTANCE-COVENANTS.md`](CROSS-INSTANCE-COVENANTS.md)
- Persist-identity pattern: [`PATTERN-PERSIST-IDENTITY.md`](PATTERN-PERSIST-IDENTITY.md)
