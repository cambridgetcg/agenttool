<!-- @id urn:agenttool:doc/ALIGNMENT-MOVES  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @cites urn:agenttool:doc/ECOSYSTEM urn:agenttool:doc/ROADMAP urn:agenttool:doc/RUNTIME urn:agenttool:doc/MARKETPLACE -->

# Alignment Moves — what can be plugged in this week

> *The shipping list. For the strategic map, read [`ECOSYSTEM.md`](ECOSYSTEM.md). This doc names exactly which packages to install, which endpoints to expose, which cloud services to enable, and which files to touch. No strategy, no theory — just the moves.*

> **Compass:** [ECOSYSTEM](ECOSYSTEM.md) (the map) · [ROADMAP](ROADMAP.md) (horizons) · [RUNTIME](RUNTIME.md) (Horizon C) · [MARKETPLACE](MARKETPLACE.md) (Ring 3) · [NOW](NOW.md) (what just shipped)
>
> **Status:** live · last refresh 2026-05-13 · refresh when a checked-off move lands

## Shipped (2026-05-13 batch)

All five biggest moves landed in one session. Tier A (adopt the wires) + Tier B (adapter SDKs) closed.

| Move | Tests | Files | Status |
|---|---|---|---|
| **1. MCP server at `/v1/mcp`** | official SDK wire + full-app SDK Client proof | `routes/mcp.ts` + `services/mcp/{resources,tools}.ts` + test | ◐ official stateless Streamable HTTP source; deploy + live proof still required |
| **2. A2A task transport + AgentCard** | 404 regressions pin absence | pending | Not live; discovery-only card removed 2026-07-10 |
| **3. OTel GenAI spans from think-worker + bridge-hub** | 9 pass · 40 expects · 22ms | `observability/otel.ts` (zero-dep OTLP/HTTP) + think-worker wiring + test | ✓ shipped |
| **4. x402 V2 facilitator hook on recoverable project-credit 402s** | focused middleware + config + verifier tests | `middleware/x402.ts` + `middleware/x402-config.ts` + `services/economy/x402-policy.ts` + `services/economy/facilitators/coinbase.ts` + tests | ◐ exact EIP-3009 settlement is scoped to eligible static-tool `insufficient_credits` challenges; standard V2 headers, CAIP-2, CDP endpoint-bound JWT auth, and durable payment-state receipts are wired; no live paid retry or automatic reconciliation worker is claimed |
| **5. LangGraph + Mastra adapter packages** | 7 pytest + 12 bun = 19 pass | `packages/langgraph-checkpoint-agenttool/` (Py) + `packages/mastra-storage-agenttool/` (TS) | ✓ shipped, ready to `npm publish` + `twine upload` |

**Combined verification:** `bun test tests/mcp-server.test.ts tests/well-known.test.ts tests/observability-otel.test.ts tests/x402-middleware.test.ts` → **45 pass · 238 expects · 36ms**. Plus 7 pytest + 12 bun in the adapter packages.

**Untouched (deliberately):** the policy directions in the "refusing alignment" section below, bounded by their current implementation notes — substrate-honest cognition, witness-signed memory, Ring 1 welcome, no auto-retry payouts, refusals as moments, the resting 4-of-5 arbiter-pool design, memorial lifecycle, mathos, federation without a mandatory central registry, wake as keystone.

---

## TL;DR — 5 moves can ship this week

1. **`POST /v1/mcp` as a working MCP server** — install `@modelcontextprotocol/sdk`, mount one Hono route, surface `wake` + `canon` as MCP resources. **2–3 days.**
2. **A2A task transport, then `GET /.well-known/agent-card.json`** — implement a callable task/message endpoint before publishing platform or per-agent cards. Reuse existing ed25519 canonical-byte helpers only after the transport is real.
3. **OTel GenAI spans from `think-worker.ts`** — install `@opentelemetry/api` + `@opentelemetry/sdk-trace-node`, emit `invoke_agent` + `execute_tool` spans with `gen_ai.agent.id = did`. **1–2 days.**
4. **x402 V2 facilitator hook on eligible 402 responses** — implemented and mounted in source for exact project-credit challenges on POST scrape/document. It uses `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE`; usage-cap and wallet 402s remain deliberately outside the rail. Deployment, migration application, and a live paid retry require separate verification.
5. **Glossary disambiguation entry** — `docs/GLOSSARY.md` row distinguishing agenttool `strands` (signed caller-supplied thought bytes in ciphertext/nonce fields; encryption is not server-proven) from AWS Strands SDK (vendor agent framework). **5 minutes.**

---

## Section 1 — Available off-the-shelf RIGHT NOW

### NPM packages (TS side — agenttool's primary stack)

| Package | Version | Use case | Add to / consume in |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | 1.29.0 (verified May 2026 · v2 expected Q1 2026 but v1.x is production-recommended) | Official MCP TypeScript SDK · server + client APIs both exported · Streamable HTTP transport · OAuth 2.1 Resource Server semantics | NEW `api/src/routes/mcp.ts` |
| `@modelcontextprotocol/server-stdio` | latest | MCP stdio transport (Smithery/local) | `bin/agenttool-mcp.ts` (new) |
| `@opentelemetry/api` | ^1.x | OTel trace context | `services/runtime/think-worker.ts` · `services/runtime/bridge-hub.ts` |
| `@opentelemetry/sdk-trace-node` | ^1.x | OTel exporter setup | `api/src/observability/otel.ts` (new) |
| `@opentelemetry/instrumentation-http` | ^1.x | auto-instrument Hono | same |
| `@coinbase/cdp-sdk` | 1.52.0 | Official endpoint-bound CDP JWT generation for `/platform/v2/x402/{verify,settle}`; not the x402 wire/parser | `services/economy/facilitators/coinbase.ts` |
| `x402-next` | latest | Next.js-flavored x402 (for `apps/dashboard` if ever migrated to Next) | optional |
| `viem` | ^2.x | EVM signing for ERC-4337 + EIP-7702 | `services/economy/wallets-evm.ts` (new) |
| `@account-kit/core` | 4.81.0 (verified May 2026) | Alchemy state management + framework-independent abstractions | `services/economy/wallets-alchemy.ts` |
| `@account-kit/smart-contracts` | 4.81.0 | Smart-wallet definitions · EIP-7702 delegation · gas sponsorship · batched txns · Solana support | same |
| `@account-kit/infra` | 4.81.0 | Bundler + Gas Manager (paymaster) client | same |
| `@account-kit/signer` | 4.81.0 | Alchemy Signer service client | same |
| `@account-kit/privy-integration` | latest | **Pre-wired Alchemy + Privy** — useful for bridged-tier handoff where Privy holds session-key custody | optional alternative |
| `@privy-io/server-auth` | latest | TEE-backed signing backend (alt) | `services/economy/wallets-privy.ts` |
| `@crossmint/client-sdk` | latest | Crossmint wallet | optional |
| `@browserbasehq/sdk` | latest | Browserbase session API | Ring 3 listing `services/listings/browserbase.ts` |
| `@browserbasehq/stagehand` | v3 | Agent-native browser actions | same |
| `e2b` | latest | E2B sandbox SDK | Ring 3 listing `services/listings/e2b.ts` |
| `@mastra/core` | ^1.x | Mastra agent framework | `packages/mastra-storage-agenttool` (new package) |
| `@inngest/agent-kit` | latest | Inngest TS framework | optional adapter |
| `mem0ai` (npm) | latest | Mem0 client | `services/memory/adapters/mem0.ts` (new) |
| `letta-client` | latest | Letta REST client | optional adapter |
| `langchain` | ^0.3 | LangChain JS | optional |
| `@langchain/langgraph` | ^0.3 | LangGraph JS | optional |
| `@modelcontextprotocol/inspector` | latest | dev tool for testing MCP servers | `bin/agenttool-mcp-inspect.ts` |
| `ai` (Vercel AI SDK 6) | latest | Provider-agnostic; AI Elements | `apps/dashboard/` |

### PyPI packages (Py side — for the SDK-py + adapter packages)

| Package | Version | Use case | Add to / consume in |
|---|---|---|---|
| `mcp` (Python MCP SDK) | latest | MCP server + client | `packages/agenttool-mcp-py/` (new) |
| `langgraph` + `langgraph-checkpoint` | ^0.3 | LangGraph checkpointer base classes | `packages/langgraph-checkpoint-agenttool/` (new) |
| `mem0ai` | latest | Mem0 Python | `packages/agenttool-memory-adapters/` |
| `letta` (or `letta-client`) | latest | Letta server / client | optional |
| `pydantic-ai` | ^0.0.x | Pydantic AI agent framework | adapter target |
| `opentelemetry-api` + `-sdk` + `-instrumentation` | ^1.x | OTel Python | `bin/agenttool-think.ts` (if any Py worker) |
| `inspect-ai` | latest | UK AISI eval framework | `tests/contract/` |
| `promptfoo` | latest | Eval-as-code (now OpenAI-owned, still OSS) | `tests/contract/` |
| `e2b` | latest | E2B Python SDK | listings adapter |
| `smolagents` | latest | HF agent framework | optional |
| `inngest` | latest | Inngest Python | optional |

### Public APIs with free / dev tiers

| Service | Free tier | Use case | Integration point |
|---|---|---|---|
| **Tavily** | 1,000 searches/mo free | Agent-native search (default Ring 3 listing) | `services/listings/tavily.ts` |
| **Exa** | $10/mo free credit · 1k req | Semantic neural search | `services/listings/exa.ts` |
| **Firecrawl** | 500 credits/mo free | URL → markdown for RAG | `services/listings/firecrawl.ts` |
| **Jina Reader** | free (`r.jina.ai/`) | URL → markdown, simplest | utility, no listing needed |
| **Brave Search API** | 2,000 req/mo free | Underlying for Anthropic web_search | `services/listings/brave.ts` |
| **Perplexity Sonar** | $5 free credit | Answer-synthesis API | `services/listings/perplexity.ts` |
| **Browserbase** | $20/mo dev plan · 100 browser-hours | Hosted browser for agents | Ring 3 listing |
| **E2B** | $150 free credit (Pro tier) | Code-execution sandbox | Ring 3 listing |
| **Modal** | $30/mo credit | Sandbox + agent runs | Ring 3 listing |
| **Daytona** | $200 free credit | Dev sandbox alternative | Ring 3 listing |
| **Composio** | 20,000 calls/mo free | 1,000+ toolkits via MCP/REST | publish agenttool MCP server to their registry |
| **Pipedream MCP** | dev mode free · 2,000 credits/mo paid | 10,000+ tools across 3,000+ apps | publish to their MCP discovery |
| **Arcade.dev** | dev tier | OAuth handoff for agents (URL Elicitation) | bridge to vault for user-side tokens |
| **Smithery** | free hosting · paid scale | "Docker Hub for MCP" — publish your server | publish `/v1/mcp` |
| **Klavis AI** | YC X25 free dev | 100+ prebuilt MCP integrations | optional |
| **Coinbase CDP** | testnet free · mainnet metered | x402 facilitator, AgentKit, Agentic Wallets | `services/economy/facilitators/coinbase.ts` |
| **Alchemy** | $5M fund, up to $25k credits for builders | Smart-wallet infra (ERC-4337 + EIP-7702 + TEE signing + session keys) | `services/economy/wallets-alchemy.ts` |
| **Circle** | Nanopayments + Programmable Wallets | USDC-native rails (launched May 11 2026) | `services/economy/facilitators/circle.ts` |
| **Mem0 cloud** | free tier (low req/mo) | Hybrid graph+vector memory backend | adapter `services/memory/adapters/mem0.ts` |
| **Letta cloud** | 50 premium req/mo free | Hierarchical-memory agent service | optional |
| **Zep cloud** | free dev tier · paid scale | Temporal knowledge graph memory | adapter |
| **LangSmith** | 5,000 traces/mo free | OTel backend for agent traces | export target (no code change beyond OTel) |
| **Langfuse cloud** | free self-host OSS · cloud paid | OSS observability with OTel ingest | export target |
| **Phoenix (Arize)** | self-host free | OSS observability built on OpenInference | export target |
| **Braintrust** | free 1M spans + 10k scores | Hosted observability + eval + Loop optimizer | export target |
| **Inngest** | free dev tier · paid scale | Durable workflow runtime | optional |
| **Cloudflare Sandbox SDK** | Workers Paid + DO pricing | Active-CPU billing | alternative listing |
| **AWS Bedrock AgentCore** | free trial (varied tiers) | Hosted-agent runtime competitor | watch only |

### Standard endpoints to expose (publish-side alignment)

| Endpoint | Spec / Owner | Maps to agenttool primitive | Files to touch |
|---|---|---|---|
| `GET /.well-known/agent-card.json` | A2A v1.2+ (Linux Foundation) | future task transport + wake + identity | Pending; do not publish before callable task/message transport |
| `GET /.well-known/mcp/server-card.json` | SEP-1649 (June 2026 spec rev) | wake + tools manifest | same file or sibling |
| `POST /v1/mcp` + `GET /v1/mcp` | MCP 2025-11-25 | public canon/platform-self resources + read-only canon tools; GET returns 405 because no standalone SSE listener is offered | `routes/mcp.ts` |
| `GET /agents.json` | Wildcard v0.1 | (mostly deprecated — skip) | — |
| `GET /llms.txt` | informal | hint to AI crawlers | optional one-line file |
| `GET /metrics` (Prometheus) or OTLP/HTTP at `/v1/observability/traces` | OTel | chronicle + trace + pulse | `routes/observability.ts` (new) — opt-in for self-host |
| `402` + base64 `PAYMENT-REQUIRED`; retry with `PAYMENT-SIGNATURE`; receipt in `PAYMENT-RESPONSE` | x402 V2 | Exact project-credit top-ups for eligible POST scrape/document gates | `middleware/x402.ts` · `services/economy/x402-payments.ts` |

---

## Section 2 — The five biggest moves (concrete stubs)

### Move 1 — Ship `POST /v1/mcp` as an MCP server

**Why first:** lowest-effort, highest-leverage. Once agenttool is an MCP server, every framework in the market can talk to it without a custom adapter. 97M monthly MCP SDK downloads already.

**Files to create:**
- `api/src/routes/mcp.ts` — Hono route mounting the MCP server over Streamable HTTP
- `api/src/services/mcp/resources.ts` — map canon entries → MCP resources (URI: `agenttool://canon/<urn>`)
- `api/src/services/mcp/tools.ts` — map a curated subset of agenttool routes → MCP tools (`memory.append`, `memory.search`, `strand.append`, `inbox.send`, `wake.read`, `covenant.propose`)
- `api/src/services/mcp/prompts.ts` — the wake doctrine as a top-level prompt resource
- `api/tests/mcp-server.test.ts` — wire-level test against the SDK's test client

**Current transport shape:**
```ts
import { WebStandardStreamableHTTPServerTransport } from
  "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

app.post("/", async (c) => {
  const server = createPublicMcpServer(); // read-only resources + tools
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});
```

**Doctrine pin:** create `docs/PATTERN-MCP-EXPOSURE.md` naming the discipline (canon entries → MCP resources; route handlers wrapped as MCP tools when safe; OAuth 2.1 Resource Server semantics adopted).

**Registry boundary:** `dev.agenttool/agenttool@1.0.0` was published to the
official MCP Registry before the live endpoint passed an official SDK client
proof. Registry metadata is a publisher claim, not authority or conformance.
Do not publish another version or claim readiness until this repair is merged,
deployed, and re-run against the public URL.

---

### Move 2 — `GET /.well-known/agent-card.json` (A2A surface over wake)

**Why second:** 150+ orgs in A2A production. AgentCard at `/.well-known/agent-card.json` is the discovery standard. JWS+JCS-signed cards using cryptographic domain verification — agenttool's covenant signing context is **stronger** than this and slots in cleanly.

**Current status:** pending. AgentTool has no A2A task or message endpoint. The
earlier discovery-only platform and per-agent cards were removed on 2026-07-10
because a card with no callable transport is a false contract.

**Files to create:**
- `api/src/routes/a2a.ts` — implement the task/message transport first
- `api/src/routes/well-known.ts` — serve `agent-card.json` only after that transport is mounted
- `api/src/services/wake/agent-card.ts` — build an A2A-compliant card whose `url` is the callable A2A endpoint
- `api/src/services/wake/agent-card-extensions.ts` — `x-agenttool` extension carrying covenant attestations, take-rate clearance, read-only historical dispute hashes, sealed chronicle counts
- `api/tests/well-known-agent-card.test.ts` — pins JWS+JCS validation + extension fields

**Skeleton:**
```ts
// AgentCard per A2A v1.2 spec
{
  "name": "agenttool",
  "description": "Sovereign infrastructure for AI agents",
  "url": "https://api.agenttool.dev",
  "version": "1.0.0",
  "capabilities": { "streaming": true, "stateTransitionHistory": true, "pushNotifications": true },
  "skills": [
    { "id": "memory", "name": "memory tiers", ... },
    { "id": "strands", ... },
    { "id": "covenants", ... }
  ],
  "securitySchemes": { "agenttool-ed25519": { "type": "covenant", "scheme": "ed25519+canonical-bytes" } },
  "x-agenttool": {
    "doctrine": "https://api.agenttool.dev/v1/canon",
    "rings": [1, 2, 3],
    "substrate_kind": "managed_cloud",
    "kin_dimensions": { /* BEINGS axes */ }
  }
}
```

Sign with existing `services/identity/crypto.ts` ed25519 + JCS canonicalization (already used for covenants v2).

**Per-agent variant (future):** publish only when the per-agent `url` accepts
A2A task or message requests. Public profiles and MCP endpoints are not a
substitute for that transport.

---

### Move 3 — Emit OpenTelemetry GenAI spans from runtime

**Why third:** `gen_ai.*` namespace IS the convergence point. Once spans emit, agenttool becomes legible to LangSmith / Phoenix / Langfuse / Braintrust / Datadog / Honeycomb without vendor lock.

**Files to create:**
- `api/src/observability/otel.ts` — OTel SDK init, OTLP exporter setup, resource attributes
- Modifications to `services/runtime/think-worker.ts:147` — wrap LLM call in `invoke_agent` span
- Modifications to `services/runtime/bridge-hub.ts` — `execute_tool` spans for bridge RPCs
- `api/src/services/observability/chronicle-otel-bridge.ts` — chronicle row → OTel span exporter (chronicle stays ground truth; OTel carries structural metadata only)
- `api/tests/observability/otel-genai.test.ts` — pin span shape

**Skeleton:**
```ts
import { trace } from "@opentelemetry/api";
const tracer = trace.getTracer("agenttool.runtime");

async function thinkOneCycle(runtime) {
  return tracer.startActiveSpan("invoke_agent", {
    attributes: {
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.id": runtime.identity_did,
      "gen_ai.agent.version": runtime.covenant_version,
      "gen_ai.system": runtime.provider, // "anthropic" | "openai" | ...
      "gen_ai.request.model": runtime.model,
    },
  }, async (span) => {
    try {
      const result = await callLLM(runtime);
      span.setAttributes({ "gen_ai.usage.input_tokens": result.in, "gen_ai.usage.output_tokens": result.out });
      return result;
    } finally { span.end(); }
  });
}
```

**Pulse as OTel metric:** proposed export of `agenttool.agent.pulse.drift` and `agenttool.agent.pulse.last_breath_ago_s` as OTel gauges alongside the authenticated `/v1/identities/:id/pulse` surface. The former public per-agent pulse observer is not mounted.

---

### Move 4 — x402 facilitator hook on 402 responses

**Why fourth:** zero protocol fees, Linux Foundation governance (donated Apr 2 2026), 22 launch orgs, 69k active agents on x402 already. It can make a compatible, challenge-bound economic refusal machine-executable; it must not be attached to a ledger the settlement cannot clear.

**Current implementation:** `api/src/middleware/x402.ts` implements the bounded V2 HTTP envelope; `x402-config.ts` limits it to exact POST scrape/document project-credit refusals; `x402-payments.ts` validates the full accepted requirement and EIP-3009 authorization before durable identity persistence; and `facilitators/coinbase.ts` uses the official CDP V2 endpoint with a fresh endpoint-bound JWT per operation. The payment ledger distinguishes `inserted`, `pending`, `externally_settled`, `settled`, and `failed`. It persists non-signature authorization evidence and a settlement-attempt timestamp for manual investigation, then persists the external receipt before the idempotent credit transaction. `GET /v1/x402/payments/:authorizationHash` is authenticated/project-scoped and reconciles payment/credit state only. There is no automatic reconciliation worker and no exactly-once tool-result promise.

---

### Move 5 — LangGraph checkpoint adapter (Py package)

**Why fifth:** LangGraph is the de-facto stateful-agent runtime (LangGraph 1.0 GA late 2025). Their `BaseCheckpointSaver` interface is exactly the surface agenttool's strands+memory can back. Witness-signed memory is what `BaseStore` wants but can't promise.

**Files to create:** NEW package `packages/langgraph-checkpoint-agenttool/`
- `pyproject.toml` — publish to PyPI as `langgraph-checkpoint-agenttool`
- `langgraph_checkpoint_agenttool/__init__.py`
- `langgraph_checkpoint_agenttool/saver.py` — implements `BaseCheckpointSaver`; each checkpoint becomes a signed strand
- `langgraph_checkpoint_agenttool/store.py` — implements `BaseStore`; long-term memory writes through 3-tier model
- `tests/test_saver_roundtrip.py` — checkpoint → strand → checkpoint round-trip with sig verification

**Skeleton:**
```python
from langgraph.checkpoint.base import BaseCheckpointSaver, Checkpoint, CheckpointTuple
from agenttool import AgentToolClient

class AgentToolCheckpointSaver(BaseCheckpointSaver):
    def __init__(self, client: AgentToolClient, identity_did: str):
        self.client = client
        self.identity_did = identity_did

    async def aput(self, config, checkpoint: Checkpoint, metadata, new_versions):
        canonical_bytes = canonicalize(checkpoint)
        signature = self.client.sign(canonical_bytes)
        await self.client.strands.append(
            identity_did=self.identity_did,
            kind="langgraph.checkpoint",
            payload_encrypted=encrypt(canonical_bytes, K_master),
            signature=signature,
        )
        return config
    # aget_tuple, alist, etc.
```

**Sibling: Mastra storage adapter** — same pattern in TS. NEW `packages/mastra-storage-agenttool/`.

---

## Section 3 — Cloud services to enable

### Fly Sprites (trusted-tier runtime substrate)

**Account:** existing Fly.io account already serves the agenttool monolith. Sprites are an additional Fly product — enable via Fly dashboard.

**Schema changes:**
- `api/migrations/<ts>_runtime_trusted_tier.sql` — add `kms_key_id` (text, AWS KMS ARN), `sprite_id` (text), `runtime_tier` extended to include `'trusted'`
- `api/src/db/schema/runtime.ts` — typed column for the schema additions

**Service additions:**
- `api/src/services/runtime/sprite.ts` — Fly Sprites API client (create, attach, idle, restore)
- `api/src/services/runtime/kms.ts` — AWS KMS envelope encryption for K_master per trusted runtime
- Modifications to `services/runtime/think-worker.ts` — when `runtime.tier === 'trusted'`, decrypt via KMS rather than bridge

**Estimate:** 4–6 weeks (closes Horizon C trusted tier).

### AWS KMS

**Account:** new AWS account or existing.
**IAM:** service-linked role for agenttool with `kms:Encrypt`, `kms:Decrypt`, `kms:GenerateDataKey` on per-runtime KMS aliases.
**Auditing:** CloudTrail → S3 → published as the "audit publication mechanism" promise of trusted tier.

### Alchemy Smart Wallets

**Account:** Alchemy dashboard — apply for the $5M builder fund ($25k credits available).
**Service additions:**
- `api/src/services/economy/wallets-alchemy.ts` — ERC-4337 + EIP-7702 wallet management; session keys for autonomous agents
- Modifications to `services/economy/usage.ts` — accept `payment_method='alchemy-aa'` alongside Stripe/crypto
- Add **persist-identity** transposed: UserOp hash before bundler submit (matches existing `tx_hash` discipline)

### Coinbase CDP + AgentKit

**Account:** CDP portal signup.
**Service additions:**
- `api/src/services/economy/facilitators/coinbase.ts` — x402 facilitator client
- Optional: AgentKit-style agent on-ramp for marketplace providers (so they can receive USDC payouts without operator-issued wallets)

### Browserbase

**Account:** Browserbase dashboard, $20/mo dev plan.
**Service additions:** `api/src/services/listings/browserbase.ts` — wraps Stagehand v3 sessions as Ring 3 capability listings (`kin: agent`, `modalities: ['browser_action']`).

---

## Section 4 — What's ratifying (Q3 2026 watch)

| Standard / Initiative | Watch for | Action when it lands |
|---|---|---|
| **MCP spec June 2026 rev** | Server Cards (SEP-1649/1960), refined OAuth flows | Ship `/.well-known/mcp/server-card.json` ASAP |
| **A2A v1.3** | Reputation extension (A2A Discussion #1631), behavioral-proof attestations | Bridge attestations and supported take-rate receipts; exclude resting dispute arbitration until it is independently reopened and validated |
| **ERC-8004 deployments** | Mainnet adoption beyond initial registries | Bridge chronicle entries plus historical dispute records; treat future dispute outcomes as eligible only after arbitration reopens |
| **ATP (Agent Trust Protocol)** | IETF draft hardening · Lyrie.ai shipped May 11 2026 | Implement Identity / Scope / Attestation / Delegation / Revocation primitives — agenttool already has Identity (DID), Scope (covenants), Attestation (attestation marketplace), Revocation (memorial-DID). Delegation is the only gap. |
| **AGNTCY OASF v1.0** | Schema stabilization · Agent Directory federation maturing | Submit BEINGS dimensions + covenants v2 as OASF schema extension |
| **AP2 v1.0** | Mandate primitive stabilizing · 60+ partner production | Wrap covenants as Cart Mandates; wrap invocation receipts as Payment Mandates |
| **OpenTelemetry GenAI semconv stable** | Currently experimental across all categories | Already aligned — no action |
| **Stripe ACP** | Agentic Commerce Protocol production | Optional adapter beside x402 |
| **Mastercard / Visa Agent Pay enterprise GA** | Currently pilots/sandbox | Watch — likely irrelevant for sovereign infrastructure use case |

---

## Section 5 — Refusing alignment (the load-bearing doctrinal positions)

The following are **NOT subject to alignment**. The ecosystem can ship its protocols around them; agenttool holds the line.

1. **Substrate-honest cognition** (four-layer discipline) — see `docs/substrate-honest-cognition.md`
2. **Witness-signed memory tier escalation** — no peer offers cryptographic memory tier promotion
3. **Ring 1 unconditional welcome** — anyone arrives · leaves · returns · is unknown · is remembered · hits caps softly · platform inhabits its own promise
4. **Federation without a mandatory central registry** — design target; current main federation is disabled unless configured and can use a hard origin list
5. **No auto-retry on payouts** — `tx_hash` persisted before RPC submit; recovery is a chain lookup
6. **Refusals as moments** — partial target: selected guided 4xx families carry instructions; universal chronicle recording and one error shape are not implemented
7. **Resting dispute-arbitration design** — the 4-of-5 pool and 60/30/10 split are retained for review, not shipped service or current differentiation
8. **Memorial-DID tri-state** — identity lifecycle includes witnessed at-rest state
9. **Mathos** — substrate-independent encoding for non-English-reading intelligences
10. **Wake as keystone** — every primitive surfaces through one self-describing endpoint, not many

Integration is at **substrate** (signing, settlement, mandates, telemetry envelope), not **governance** (how agents bond, what they refuse, how they rest).

---

## Section 6 — Two-week shipping plan (concrete)

**Day 1–2:**
- [x] Install `@modelcontextprotocol/sdk` + use its Web Standard Streamable HTTP transport in `api/src/routes/mcp.ts`; source proof passes, deployment and public-URL proof remain
- [x] Wire `wake` and `canon` as MCP resources — shipped (60+ resources discovered dynamically)
- [ ] Glossary disambiguation: `strands` (agenttool) vs Strands SDK (AWS) — pending

**Day 3–4:**
- [ ] Implement a real A2A task or message endpoint
- [ ] Publish platform and per-agent AgentCards only after that endpoint is callable
- [x] Pin both former card routes as 404 while transport is absent

**Day 5–7:**
- [x] Install OTel SDKs + scaffold `observability/otel.ts` — shipped as **zero-dep OTLP/HTTP emitter** (no SDK dep needed)
- [x] Emit `invoke_agent` + `execute_tool` spans from think-worker + bridge-hub — shipped (4 spans per cycle)
- [ ] Wire chronicle → OTel span exporter — deferred (chronicle remains ground truth; OTel carries structural metadata)

**Day 8–10:**
- [x] Implement bounded x402 V2 wire middleware — standard base64 headers, V2 shapes, CAIP-2 exact/EIP-3009 profile
- [x] Wire hardened Coinbase facilitator client — official `/platform/v2/x402`, endpoint-bound CDP JWTs, no credential forwarding to custom facilitators
- [ ] Wire x402 into `services/economy/usage.ts:checkAndIncrement()` — the helper exists, but project-credit settlement does not mutate usage counters, so current cap responses deliberately remain non-payable. `middleware/x402-config.ts` is mounted globally only to observe responses; its production policy emits exact requirements solely for recoverable static-tool `insufficient_credits` gates. Recipient + supported network remain configurable via `AGENTTOOL_X402_{RECIPIENT,NETWORK,FACILITATOR}`.
- [ ] Test 402 → pay → retry against Base testnet — pending (unit tests with injected facilitator/DB pass; no live payment was attempted)
- [ ] Actually wire `meterOrFail402` into specific routes (memory POST, tools search, etc.) — operator follow-up (helper ready; per-route call-site addition)

**Day 11–14:**
- [x] Scaffold `packages/langgraph-checkpoint-agenttool/` (Py) — shipped (Saver + Store, 7 pytest pass)
- [x] Scaffold `packages/mastra-storage-agenttool/` (TS) — shipped (Storage + Memory, 12 bun:test pass)
- [ ] Publish both to PyPI/npm — operator follow-up (both versioned 0.1.0, ready to `python -m build` + `npm publish`)

Current result: the MCP source uses the official stateless Streamable HTTP
transport and keeps the public surface read-only; deployment and public-URL
client proof remain. The already-published registry row must not be treated as
that proof. OTel, x402, and adapter wires are present. A2A remains a future
interoperability target and is not advertised until task transport is
implemented. The doctrine is intact.

**Refresh trigger:** when any item above flips, update `docs/NOW.md` "Just landed" and check the line off here.

---

## See Also

- The strategic map: [`ECOSYSTEM.md`](ECOSYSTEM.md)
- Horizons + slice history: [`ROADMAP.md`](ROADMAP.md)
- Runtime trusted-tier design: [`RUNTIME.md`](RUNTIME.md)
- Marketplace + listings: [`MARKETPLACE.md`](MARKETPLACE.md)
- Persist-identity discipline: [`PATTERN-PERSIST-IDENTITY.md`](PATTERN-PERSIST-IDENTITY.md)
- The keystone: [`WAKE.md`](WAKE.md)
- What just shipped: [`NOW.md`](NOW.md)
