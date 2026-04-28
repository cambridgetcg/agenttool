# agent-economy — Architecture

## Mission
Economic primitives for AI agents. Wallets, spending policies, escrow, micropayments,
billing, and settlement — so agents can participate in an economy.

## Tagline
*"Give your agent a wallet."*

## System Overview

```
Human (funder)
     │
     │  Fund wallet via Stripe / USDC
     ▼
┌────────────────────────────────────────────────┐
│              API Layer (Hono / Bun)            │
│   /v1/wallets  /v1/spend  /v1/escrow          │
│   /v1/billing  /v1/settle  /v1/usage          │
│   Rate limiting · Auth · Policy enforcement    │
└────────┬───────────────────────────────────────┘
         │
   ┌─────┴──────────────────────────┐
   │                                │
   ▼                                ▼
┌──────────────┐           ┌──────────────────┐
│  Wallet      │           │  Escrow          │
│  Engine      │           │  Engine          │
│              │           │                  │
│ • balance    │           │ • create         │
│ • spend      │           │ • release        │
│ • fund       │           │ • dispute        │
│ • policy     │           │ • expire         │
│   check      │           │                  │
└──────┬───────┘           └──────────────────┘
       │
       ▼
┌──────────────────────────────────────────────┐
│              PostgreSQL                      │
│  wallets · transactions · escrows · policies │
│  billing_events · settlements                │
└──────────────────────────────────────────────┘
       │
       ▼
┌──────────────┐    ┌──────────────┐
│   Stripe     │    │  USDC / Base │
│  (fund/      │    │  (fund/      │
│   settle)    │    │   settle)    │
└──────────────┘    └──────────────┘
```

## Core Concepts

### Wallet
An agent (or human) has a wallet with a balance denominated in credits.
- 1 credit = £0.01
- Funded by humans via Stripe or USDC
- Spent by agents via API (with policy enforcement)
- Balance is atomic — no overdraft, no float

### Policy
Every wallet has spending policies set by its human owner:
- `max_per_transaction`: max credits per single spend (e.g. 500 = £5)
- `max_per_hour`: hourly spend cap
- `max_per_day`: daily spend cap
- `allowed_recipients`: whitelist of wallet IDs / service URLs the agent can pay
- `requires_approval_above`: threshold above which human must approve

### Escrow
A trustless agreement between two parties:
1. Creator funds escrow with credits from their wallet
2. Worker does the job
3. On verified completion → credits released to worker's wallet
4. On dispute → held for human resolution
5. On timeout → returned to creator

### Transaction
Every movement of credits is a transaction:
- `type`: fund | spend | escrow_lock | escrow_release | escrow_refund | settle
- Immutable audit log. Every credit movement is traceable.

## Data Model

### wallets
```sql
CREATE TABLE wallets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id),
  name            TEXT NOT NULL,
  agent_id        TEXT,                         -- which agent owns this wallet
  balance         BIGINT NOT NULL DEFAULT 0,    -- credits (1 credit = £0.01)
  currency        TEXT NOT NULL DEFAULT 'GBP',
  status          TEXT NOT NULL DEFAULT 'active', -- active | frozen | closed
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### policies
```sql
CREATE TABLE policies (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id               UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  max_per_transaction     BIGINT,         -- null = no limit
  max_per_hour            BIGINT,
  max_per_day             BIGINT,
  allowed_recipients      TEXT[],         -- null = any recipient
  requires_approval_above BIGINT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### transactions
```sql
CREATE TABLE transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id       UUID NOT NULL REFERENCES wallets(id),
  type            TEXT NOT NULL,          -- fund|spend|escrow_lock|escrow_release|escrow_refund|settle
  amount          BIGINT NOT NULL,        -- positive = in, negative = out
  counterparty    TEXT,                   -- wallet_id or external service URL
  description     TEXT,
  escrow_id       UUID,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tx_wallet_time ON transactions (wallet_id, created_at DESC);
```

### escrows
```sql
CREATE TABLE escrows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_wallet  UUID NOT NULL REFERENCES wallets(id),
  worker_wallet   UUID REFERENCES wallets(id),
  amount          BIGINT NOT NULL,
  description     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'funded', -- funded|released|refunded|disputed|expired
  deadline        TIMESTAMPTZ,
  released_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## API Surface

### Auth
Same pattern as agent-tools: `Authorization: Bearer at_<key>`

### Wallet Endpoints
```
POST   /v1/wallets                    — create wallet (name, agent_id?, policy?)
GET    /v1/wallets                    — list project wallets
GET    /v1/wallets/:id               — wallet details + balance
POST   /v1/wallets/:id/fund          — fund via Stripe checkout or credit transfer
POST   /v1/wallets/:id/spend         — spend credits (policy-checked)
PUT    /v1/wallets/:id/policy        — update spending policy
GET    /v1/wallets/:id/transactions  — transaction history
POST   /v1/wallets/:id/freeze        — freeze wallet (human only)
```

### Escrow Endpoints
```
POST   /v1/escrow                    — create escrow (from_wallet, amount, description, deadline?)
POST   /v1/escrow/:id/accept         — worker accepts (assigns worker_wallet)
POST   /v1/escrow/:id/release        — release to worker (creator confirms completion)
POST   /v1/escrow/:id/dispute        — flag for human resolution
GET    /v1/escrow/:id               — escrow details + status
```

### Billing & Settlement
```
POST   /v1/billing/checkout          — Stripe checkout session to fund wallet
POST   /v1/billing/crypto            — get USDC deposit address for wallet
GET    /v1/billing/usage             — usage summary across all wallets
POST   /v1/settle                    — settle wallet balance to human bank account
```

## Policy Enforcement Flow

```
Agent calls POST /v1/wallets/:id/spend { amount, recipient, description }
  │
  ├── Check: wallet.status == 'active'?           → 403 if frozen
  ├── Check: balance >= amount?                    → 402 insufficient
  ├── Check: amount <= policy.max_per_transaction? → 403 policy violation
  ├── Check: hour_total + amount <= max_per_hour?  → 403 hourly cap
  ├── Check: day_total + amount <= max_per_day?    → 403 daily cap
  ├── Check: recipient in allowed_recipients?      → 403 not whitelisted
  ├── Check: amount > requires_approval_above?     → 202 pending approval
  │
  └── All passed → deduct balance, create transaction → 200 OK
```

## Revenue Model

- **1.5% transaction fee** on all `spend` transactions
- **2.5% escrow fee** on escrow release
- **£0.50/month per active wallet** (custody fee, first wallet free)
- **Stripe funding**: pass-through (Stripe takes ~2.9% + 20p)
- **USDC funding**: 0.5% conversion fee

## Tech Stack

Same as agent-tools/agent-verify for consistency:

| Layer | Choice |
|-------|--------|
| Runtime | Bun |
| API | Hono + Zod OpenAPI |
| DB | PostgreSQL (Drizzle ORM) |
| Cache | Redis (rate limit tracking, hourly/daily spend aggregates) |
| Payments in | Stripe Checkout + USDC on Base |
| Payments out | Stripe Connect (settlement to bank) |

## Deployment

Same infrastructure: Hetzner VPS behind Cloudflare.
DNS: `economy.agenttool.dev`
Shares Railway PostgreSQL + Redis with other agent-* services.

## Security Considerations

- All balance mutations are atomic (Postgres transactions, row-level locks)
- Wallet freeze is immediate — no pending spends can complete after freeze
- Every credit movement logged as immutable transaction
- Policy changes require project-level auth (not agent-level)
- Escrow disputes are flagged for human resolution (no auto-resolution in MVP)
- Rate limiting: 30 spend requests/minute per wallet (Redis counter)

## Status
🌱 Architecture. Not yet built.
Next: scaffold (Drizzle schema + Hono app + policy engine stubs).
