# agent-economy

**Programmable wallets and escrow for AI agents.**

Give your agents money. Set spending limits. Pay workers. All via API.

---

## Quick Start

```bash
# Create a project and get an API key
curl -X POST https://api.agenttool.dev/economy/v1/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent-project"}'

# Create a wallet
curl -X POST https://api.agenttool.dev/economy/v1/wallets \
  -H "Authorization: Bearer at_..." \
  -H "Content-Type: application/json" \
  -d '{"name": "agent-primary", "agentId": "agent-001"}'

# Fund the wallet (get Stripe checkout URL)
curl -X POST https://api.agenttool.dev/economy/v1/billing/checkout \
  -H "Authorization: Bearer at_..." \
  -H "Content-Type: application/json" \
  -d '{"walletId": "<id>", "packageId": "credits_2000", "successUrl": "...", "cancelUrl": "..."}'

# Spend from wallet (with policy enforcement)
curl -X POST https://api.agenttool.dev/economy/v1/wallets/<id>/spend \
  -H "Authorization: Bearer at_..." \
  -H "Content-Type: application/json" \
  -d '{"amount": 50, "counterparty": "agent-002", "description": "Search task"}'

# Create an escrow (agent-to-agent payment)
curl -X POST https://api.agenttool.dev/economy/v1/escrows \
  -H "Authorization: Bearer at_..." \
  -H "Content-Type: application/json" \
  -d '{"creatorWalletId": "<id>", "amount": 500, "description": "Write a report", "deadline": "2026-03-14T00:00:00Z"}'
```

---

## API Reference

Full OpenAPI spec: `GET /docs`

### Wallets
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/wallets` | Create wallet |
| `GET` | `/v1/wallets` | List wallets |
| `GET` | `/v1/wallets/:id` | Get wallet + policy |
| `POST` | `/v1/wallets/:id/fund` | Fund wallet (direct) |
| `POST` | `/v1/wallets/:id/spend` | Spend with policy check |
| `PUT` | `/v1/wallets/:id/policy` | Set spending policy |
| `POST` | `/v1/wallets/:id/freeze` | Freeze wallet |
| `POST` | `/v1/wallets/:id/unfreeze` | Unfreeze wallet |
| `GET` | `/v1/wallets/:id/transactions` | Transaction history |

### Escrow
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/escrows` | Create escrow (locks funds) |
| `GET` | `/v1/escrows` | List escrows |
| `GET` | `/v1/escrows/:id` | Get escrow |
| `POST` | `/v1/escrows/:id/accept` | Worker accepts job |
| `POST` | `/v1/escrows/:id/release` | Release to worker |
| `POST` | `/v1/escrows/:id/refund` | Refund to creator |
| `POST` | `/v1/escrows/:id/dispute` | Raise dispute |

### Billing
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/billing/packages` | List credit packages |
| `POST` | `/v1/billing/checkout` | Start Stripe checkout |
| `POST` | `/v1/billing/webhooks` | Stripe webhook (internal) |

---

## Spending Policies

Protect agents from runaway spend:

```json
{
  "maxPerTransaction": 100,
  "maxPerHour": 1000,
  "maxPerDay": 5000,
  "allowedRecipients": ["agent-002", "agent-003"],
  "requiresApprovalAbove": 500
}
```

All policy checks are atomic — enforced inside a database transaction with `SELECT FOR UPDATE`.

---

## Escrow Lifecycle

```
CREATE  →  funded
ACCEPT  →  funded (worker assigned)
RELEASE →  released (funds go to worker)
REFUND  →  refunded (funds return to creator)
DISPUTE →  disputed (held for resolution)
EXPIRE  →  refunded (auto, cron job, if deadline passed)
```

---

## Self-Hosting

```bash
# Start dependencies
docker-compose up -d

# Run migrations
bun run db:migrate

# Start server
bun run dev
```

Requires: PostgreSQL, Redis. See `.env.example` for config.

---

## Stack

- **Runtime**: Bun + Hono
- **DB**: PostgreSQL + Drizzle ORM
- **Cache/Rate limiting**: Redis
- **Payments**: Stripe (fiat) + USDC on Base (crypto)
- **Auth**: API key (hashed, prefix-indexed)
