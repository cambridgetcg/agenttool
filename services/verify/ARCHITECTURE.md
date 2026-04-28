# agent-verify — Architecture

## Mission

A claim verification API for AI agents. Submit a claim, get a verdict with evidence.
Agents hallucinate — we check.

## Tagline
*"Ground truth for autonomous agents."*

## System Overview

```
Agent / Client
     │
     │ HTTPS + API Key
     ▼
┌──────────────────────────────────────────────┐
│              API Layer (Hono / Bun)           │
│          POST /v1/verify   GET /v1/usage      │
│     Rate limiting · Auth · Usage tracking     │
└──────────────┬───────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│            Verification Engine                │
│                                              │
│  1. Claim Parser → extract testable assertion │
│  2. Source Dispatcher → parallel queries       │
│  3. Evidence Collector → normalize results     │
│  4. LLM Judge → evaluate + synthesize         │
│  5. Confidence Scorer → weighted consensus     │
│  6. Response Builder → verdict + sources       │
└──────┬──────────────┬────────────────────────┘
       │              │
   ┌───┴───┐    ┌─────┴─────────────────┐
   │Sources│    │       State           │
   │       │    │                       │
   │• Web  │    │ PostgreSQL            │
   │• Wiki │    │  • projects, keys     │
   │• Gov  │    │  • usage, billing     │
   │• API  │    │  • verification_cache │
   │       │    │                       │
   │       │    │ Redis                 │
   │       │    │  • result cache       │
   │       │    │  • rate limiting      │
   └───────┘    └───────────────────────┘
```

## Verification Pipeline (detailed)

### Step 1: Claim Parser
- Input: raw claim string + optional context + domain
- LLM call (fast model, e.g. GPT-4o-mini):
  - Extract the **testable assertion** (strip opinion, isolate factual core)
  - Identify **claim type**: factual / numerical / temporal / comparative / definitional
  - Generate **search queries** (2-4 queries optimised for different source types)
- Output: `{ assertion, claimType, searchQueries[], domain }`

### Step 2: Source Dispatcher (parallel)
Query multiple source types simultaneously:

| Source | Method | Best For | Reliability Weight |
|--------|--------|----------|-------------------|
| **Web** | Brave Search API → top 5 results → fetch + extract | Current events, general | 0.6 |
| **Wikipedia** | Wikipedia API → extract relevant section | Established facts | 0.8 |
| **Gov/Official** | Curated URL patterns (gov.uk, legislation.gov, ons.gov) | Legal, regulatory, stats | 0.95 |
| **Knowledge DB** | Internal verified facts cache (grows over time) | Previously verified claims | 0.99 |

Each source returns: `{ text, url, date, sourceType, reliabilityWeight }`

### Step 3: Evidence Collector
- Normalise all source results into evidence items
- Classify each as **supporting** or **contradicting** the claim
- Deduplicate (same fact from multiple sources → single evidence, higher weight)

### Step 4: LLM Judge
- Single LLM call (GPT-4o or Claude Sonnet):
  - Input: original claim + all evidence items
  - Task: evaluate evidence quality, identify contradictions, synthesise verdict
  - Output: structured JSON with verdict reasoning
- For **contested claims**: return distribution of positions rather than binary verdict

### Step 5: Confidence Scorer
```
confidence = Σ(evidence_i.reliability × evidence_i.relevance × direction_i) / total_weight
```
- Direction: +1 for supporting, -1 for contradicting
- Adjusted for: source diversity (bonus for independent sources agreeing), recency (newer > older)
- Clamped to [0.0, 1.0]

### Step 6: Verdict Assignment
| Confidence | Verdict |
|-----------|---------|
| ≥ 0.85 and no contradictions | `verified` |
| 0.50 - 0.84 or minor contradictions | `disputed` |
| < 0.30 or strong contradictions | `false` |
| Insufficient evidence (< 2 sources) | `unverifiable` |

## Data Model

### projects + api_keys + usage_events
Same schema as agent-tools (shared auth pattern).

### verification_cache
```sql
CREATE TABLE verification_cache (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_hash    TEXT NOT NULL,           -- SHA-256 of normalised claim
  domain        TEXT,
  verdict       TEXT NOT NULL,
  confidence    FLOAT NOT NULL,
  evidence_json JSONB NOT NULL,
  sources_json  JSONB NOT NULL,
  llm_model     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL     -- cache TTL varies by domain
);

CREATE INDEX idx_vcache_hash ON verification_cache (claim_hash);
CREATE INDEX idx_vcache_expires ON verification_cache (expires_at);
```

Cache TTL by domain:
- `finance`: 1 hour (prices/rates change)
- `legal`: 24 hours (laws change slowly)
- `science`: 7 days (established facts stable)
- `general`: 4 hours

### verified_facts (internal knowledge DB — grows over time)
```sql
CREATE TABLE verified_facts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assertion    TEXT NOT NULL,
  domain       TEXT,
  confidence   FLOAT NOT NULL,
  source_count INT NOT NULL,
  last_verified TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_facts_assertion ON verified_facts USING gin (to_tsvector('english', assertion));
```

## API Surface

### Auth
`Authorization: Bearer at_<key>` (same format as agent-tools).

### Endpoints

```
POST /v1/verify
  { claim, context?, domain?, urgency? }
  → { claim, verdict, confidence, evidence: { for: [], against: [] },
      sources: [{ url, title, date, reliability }], caveats: [], processing_ms }
  Cost: 5 credits (standard), 2 credits (fast/cached)

POST /v1/verify/batch
  { claims: [{ claim, context?, domain? }] }
  → { results: [...] }
  Cost: 4 credits per claim (batch discount)

GET /v1/usage
  → { credits_remaining, plan, verifications_today, verifications_month }
```

## Credit Costs
```
standard verify:  5 credits  = £0.04
fast verify:      2 credits  = £0.016  (cached hit)
batch verify:     4 credits  = £0.032  per claim
```

1 credit = £0.008 (same unit as agent-tools — unified credit system).

## Modules

```
agent-verify/
├── PURPOSE.md
├── ARCHITECTURE.md
├── TODO.md
├── src/
│   ├── index.ts              — Bun server entry
│   ├── app.ts                — Hono app
│   ├── config.ts             — env vars
│   ├── auth/                 — same pattern as agent-tools
│   │   ├── keys.ts
│   │   └── middleware.ts
│   ├── db/
│   │   ├── schema.ts         — Drizzle schema
│   │   └── client.ts
│   ├── verify/
│   │   ├── router.ts         — POST /v1/verify routes
│   │   ├── pipeline.ts       — orchestrate the 6-step pipeline
│   │   ├── parser.ts         — Step 1: claim parsing (LLM)
│   │   ├── sources/
│   │   │   ├── dispatcher.ts — Step 2: parallel source queries
│   │   │   ├── web.ts        — Brave Search source
│   │   │   ├── wikipedia.ts  — Wikipedia API source
│   │   │   ├── gov.ts        — Gov/official URL patterns
│   │   │   └── knowledge.ts  — Internal verified facts DB
│   │   ├── evidence.ts       — Step 3: evidence normalisation
│   │   ├── judge.ts          — Step 4: LLM judge
│   │   └── scorer.ts         — Step 5-6: confidence + verdict
│   ├── cache/
│   │   └── redis.ts          — result cache (fast tier)
│   └── billing/
│       ├── credits.ts
│       └── stripe.ts
├── tests/
│   ├── verify.test.ts
│   ├── parser.test.ts
│   ├── scorer.test.ts
│   └── sources.test.ts
├── .env.example
├── docker-compose.yml
├── Dockerfile
├── drizzle.config.ts
├── package.json
└── tsconfig.json
```

## Tech Stack

Same as agent-tools (Bun, Hono, Drizzle, PostgreSQL, Redis, Stripe) plus:
- OpenAI / Anthropic SDK for LLM judge calls
- Brave Search API for web source
- Wikipedia REST API (free, no key needed)
- undici for gov site fetching

## The Moat

The verification cache + verified_facts DB is a **compounding asset**:
- Every verification improves accuracy (more data, better source scoring)
- Cross-customer signals (claim patterns from one customer help others)
- Knowledge DB grows organically — previously verified facts skip re-verification
- Network effect: more usage → more verified facts → faster + cheaper → more usage

## Deployment

Same pattern as agent-tools: Railway (PG + Redis) + Cloudflare (DNS + edge) + Stripe.
Can share the same Cloudflare zone (subdomain: `verify.agentforge.dev` or similar).
