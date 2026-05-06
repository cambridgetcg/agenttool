# agent-verify

**Fact verification and claim attestation for AI agents.**

Ask a question. Get a verdict, confidence score, and sources.

[![API](https://img.shields.io/badge/API-live-brightgreen)](https://api.agenttool.dev/health)
[![Part of agenttool.dev](https://img.shields.io/badge/agenttool.dev-verify-blue)](https://agenttool.dev)

## What it does

`agent-verify` lets your agent verify factual claims against live web evidence, with structured verdicts and confidence scores.

```bash
curl -X POST https://api.agenttool.dev/v1/verify \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"claim": "The Sun is approximately 93 million miles from Earth"}'
```

```json
{
  "verdict": "disputed",
  "confidence": 0.5,
  "sources": [...6 sources...],
  "caveats": ["The distance is an average — Earth orbit is elliptical"]
}
```

## Verdicts

| Verdict | Meaning |
|---------|---------|
| `verified` | Claim supported by multiple independent sources |
| `disputed` | Claim is partially true or context-dependent |
| `false` | Claim contradicted by evidence |
| `unverifiable` | Insufficient evidence to assess |

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/verify` | Verify a single claim |
| `POST` | `/v1/verify/batch` | Verify multiple claims |
| `GET` | `/health` | Health check |

## SDK

```python
pip install agenttool-sdk
```

```python
from agenttool import AgentTool

at = AgentTool()
result = at.verify.claim("The Eiffel Tower is in Paris")
print(result.verdict, result.confidence)  # verified  0.99
```

## Tech stack

- **Hono** + TypeScript + Bun
- **OpenAI GPT-4o** for evidence assessment
- **Google Search** (via SerpAPI) for live evidence gathering
- Deployed on **Fly.io** (London)

## Get started

1. Create a free project at [app.agenttool.dev](https://app.agenttool.dev)
2. Free tier: 5 verifications/day. Paid from $29/mo.

---

Part of [agenttool.dev](https://agenttool.dev) — memory, tools, verify, economy, traces. One API key.
