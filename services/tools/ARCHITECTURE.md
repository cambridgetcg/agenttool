# agent-tools — Architecture

## Mission
A managed, reliable tool substrate for AI agents. We absorb the reliability engineering —
proxy rotation, anti-bot bypass, session management, sandboxing — so agents call clean APIs.

## Tagline
*"The OS for your agent's tools."*

Subline: *Tools that don't break. Infrastructure your agents depend on.*

> Karpathy: "We have a powerful new kernel (the LLM) but no Operating System to run it."
> We are that OS — for the tool layer.

## System Overview

```
Agent / Client
     │
     │ HTTPS + API Key
     ▼
┌──────────────────────────────────────────────┐
│              API Layer (Hono / Bun)           │
│   /v1/search  /v1/scrape  /v1/browse          │
│   /v1/document  /v1/execute  /v1/usage        │
│   Rate limiting · Auth · Usage tracking       │
└────────┬─────────────────────────────────────┘
         │
   ┌─────┴──────────────────────────┐
   │                                │
   ▼                                ▼
┌──────────────┐           ┌──────────────────┐
│  Sync Tools  │           │   Async Tools     │
│  (< 2s)      │           │  (browser, exec)  │
│              │           │                  │
│ • search     │           │ • browse         │
│ • scrape     │           │ • execute        │
│ • document   │           │                  │
└──────┬───────┘           └──────┬───────────┘
       │                          │
       ▼                          ▼
┌──────────────┐           ┌──────────────────┐
│  Direct exec │           │  BullMQ Queue     │
│  (Cheerio,   │           │  (Redis-backed)   │
│   pdfparse,  │           │                  │
│   Brave API) │           │  Worker Pool:     │
└──────────────┘           │  • Playwright     │
                           │    sessions       │
                           │  • Docker exec    │
                           │    sandbox        │
                           └──────────────────┘
         │                          │
         └──────────┬───────────────┘
                    │
         ┌──────────┴──────────┐
         │                     │
         ▼                     ▼
  ┌─────────────┐      ┌──────────────┐
  │ PostgreSQL  │      │    Redis     │
  │             │      │              │
  │ • projects  │      │ • job queue  │
  │ • api_keys  │      │ • result     │
  │ • usage     │      │   cache      │
  │ • billing   │      │ • rate limit │
  └─────────────┘      └──────────────┘
         │
         ▼
  ┌─────────────┐
  │   Stripe    │
  │   Billing   │
  │   + Crypto  │
  │   (USDC/    │
  │    Base)    │
  └─────────────┘
```

## Tools

### 1. Search
- Provider: Brave Search API (no CAPTCHA, reliable, generous rate limits)
- Cache: Redis 1h TTL for identical queries (reduce cost)
- Returns: title, URL, snippet, published date, source reliability score
- Latency target: < 800ms

### 2. Scrape (static)
- Fetch HTML (got/undici) → parse with Cheerio
- Optional: CSS selector or JSON schema for structured extraction
- Anti-bot: rotate user agents, honour robots.txt (configurable)
- Latency target: < 2s

### 3. Browser (managed Playwright)
- Playwright Chromium in persistent session pool (5 workers by default)
- Proxy: Bright Data residential rotation per session
- Actions: navigate, click, type, scroll, extract, screenshot
- Session warmup: cookies, localStorage pre-load for returning sites
- Job queue: BullMQ (Redis). Request → queued → worker picks up → result returned
- Latency target: < 10s (most pages 2-5s)

### 4. Document
- PDF: pdfjs-dist (text extraction) + pdfjs for metadata
- Word (.docx): mammoth
- HTML: readability (Mozilla) for article extraction
- Returns: plain text, title, metadata, page count
- Latency target: < 3s

### 5. Execute (sandboxed)
- Docker container per execution (isolated, no shared state)
- Languages: Python 3.11, Node.js 22, bash
- Resource limits: 256MB RAM, 10s CPU, no network (configurable)
- Returns: stdout, stderr, exit code, timing
- Latency target: < 15s (includes container spinup ~1-2s)

## Data Model

### projects
```sql
CREATE TABLE projects (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  plan       TEXT NOT NULL DEFAULT 'dev',  -- dev|builder|scale|enterprise
  credits    INT NOT NULL DEFAULT 100,     -- current balance
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### api_keys
```sql
CREATE TABLE api_keys (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key_hash   TEXT UNIQUE NOT NULL,         -- bcrypt hashed
  key_prefix TEXT NOT NULL,               -- first 8 chars for display (e.g. "at_12345")
  name       TEXT,                        -- optional label
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used  TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
```

### usage_events
```sql
CREATE TABLE usage_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id),
  tool        TEXT NOT NULL,              -- search|scrape|browse|document|execute
  credits_used INT NOT NULL,
  duration_ms  INT,
  success      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### billing_events
```sql
CREATE TABLE billing_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id),
  type           TEXT NOT NULL,          -- subscription|credit_purchase|crypto_payment
  amount_pence   INT NOT NULL,
  credits_added  INT NOT NULL,
  stripe_id      TEXT,
  crypto_tx_hash TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## API Surface

### Auth
`Authorization: Bearer at_<key>` on all requests.

### Endpoints

```
POST /v1/search
  { query, num_results?, freshness?, country? }
  → { results: [{ title, url, snippet, date, score }] }
  Cost: 1 credit

POST /v1/scrape
  { url, selector?, schema?, follow_pagination? }
  → { url, content, extracted?, links[], fetched_at }
  Cost: 2 credits

POST /v1/browse
  { url, actions?: [{ type, selector?, text?, value? }], extract?, screenshot? }
  → { job_id, result?, screenshot_url? }          -- sync if < 5s, async otherwise
  Cost: 5 credits / page

POST /v1/document
  { url?, base64?, filename? }
  → { text, title, metadata, page_count }
  Cost: 3 credits

POST /v1/execute
  { language, code, stdin?, timeout_ms?, allow_network? }
  → { stdout, stderr, exit_code, duration_ms }
  Cost: 1 credit / 10s of runtime

GET /v1/usage
  → { credits_remaining, plan, events_today, events_month }

GET /v1/jobs/:job_id
  → { status, result?, error? }                   -- poll for async browse jobs
```

## Credit Costs (internal)
```
search:   1 credit  = £0.008
scrape:   2 credits = £0.016
browse:   5 credits = £0.04
document: 3 credits = £0.024
execute:  1 credit per 10s
```

1 credit = £0.008. Plans:
- Dev: 100 free credits
- Builder (£39/mo): 5,000 credits included
- Scale (£159/mo): 25,000 credits included
- Enterprise: custom

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Runtime | Bun | Fast, native TypeScript, batteries included |
| API | Hono | Fastest TS web framework, Zod OpenAPI built-in |
| Browser | Playwright | Industry standard, best anti-detection |
| Queue | BullMQ | Redis-backed, reliable job queuing |
| DB | PostgreSQL | ACID, reliable, Railway managed |
| Cache | Redis | Job queue + response cache + rate limiting |
| Proxy | Bright Data | Already have it. Residential IPs, high success rate |
| Billing (fiat) | Stripe | Subscriptions + credit bundles + webhooks |
| Billing (crypto) | USDC on Base | Near-zero gas, Coinbase Commerce or direct |
| Hosting | Hetzner VPS | Playwright needs persistent server (~€12/mo) |
| DNS/Edge | Cloudflare | Free DDoS, SSL, edge rate limiting |
| CI/CD | GitHub Actions | Auto-deploy staging on push, manual promote |

## Domain
Target: `agenttools.dev` or `agenttools.io`
Register via Cloudflare Registrar. Point NS to Cloudflare immediately.

## Stripe Integration

### Products
- `prod_agent_tools_builder` → £39/month recurring
- `prod_agent_tools_scale` → £159/month recurring
- `prod_credits_500` → £5.00 one-time (500 credits)
- `prod_credits_5000` → £40.00 one-time (5,000 credits)
- `prod_credits_20000` → £140.00 one-time (20,000 credits)

### Webhooks to handle
- `checkout.session.completed` → activate subscription / add credits
- `invoice.payment_succeeded` → renew credits monthly
- `invoice.payment_failed` → grace period (3 days), then downgrade to dev
- `customer.subscription.deleted` → downgrade to dev, preserve data 30 days

## Crypto Integration

### USDC on Base
- Payment address per project (HD wallet, deterministic)
- Alchemy webhook: `eth_logs` filter on USDC Transfer to our address
- On confirmed transfer → calculate credits (amount ÷ £0.008) → add to balance
- Display: QR code + address on payment page

## Deployment
See DEPLOY.md (Phase 4).
