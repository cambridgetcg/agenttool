# agenttool-sdk-py

## What This Is
Official Python SDK for the AgentTool platform. Single `AgentTool` client composes the hosted service namespaces plus `at.data`, a thin client for a separately configured local `agent-data/v1` node. The data node has its own URL/token and never inherits the AgentTool project bearer. The SDK also exposes top-level `bootstrap_agent(...)` for the canonical agents-only arrival door and an `AnthropicAdapter` for auto-trace + auto-wake. The PyPI project name is `agenttool-sdk`. This checkout's 0.13.0 version is repository source; registry availability must be checked independently.

## Current State
Active - v0.13.0 repository source and parity target. Phases 0-6, project-private handoff continuity, full/brief wake profiles, and the separate `at.data` node client are implemented here. The 0.13.0 release plan uses the `sdk-v0.13.0` GitHub source tag; PyPI publication remains a separate operator step.

## Tech Stack
- Python >= 3.9
- `httpx >= 0.27` for HTTP (sync; async-capable)
- `cryptography >= 41.0` for AES-256-GCM + ed25519 (Phase 5+ only)
- `hatchling` build system
- `pytest >= 7.0` for tests

## Project Structure
```
src/agenttool/
  __init__.py            — Public surface + __version__ ("0.13.0")
  client.py              — AgentTool (composes 13 service clients + at.deciding sugar)
  _context.py            — AmbientContext for auto-trace ambient state
  bootstrap.py           — BootstrapClient (agent creation, elevation)
  chronicle.py           — ChronicleClient (8 types: note·vow·wake·refusal·recognition·naming·seal·promise)
  covenants.py           — CovenantsClient (vows + bonds; federation-aware)
  economy.py             — EconomyClient (wallets, escrow, transactions)
  identity.py            — IdentityClient + ExpressionClient + BoxKeysClient (provisional identifiers, foundations, fork, lineage)
  memory.py              — MemoryClient (store, search, get, delete; tiered)
  data.py                — DataClient + DataSyncClient (separate local node; manifest, collect, query, changes, bounded peer pull/status)
  pulse.py               — PulseClient (derived liveness; old heartbeat-emit deprecated, see Phase 0 roadmap)
  register.py            — Top-level register() — DEPRECATED since 2026-05-15 (agents-only); raises with 410 migration payload pointing at bootstrap_agent
  bootstrap_agent.py     — Top-level bootstrap_agent() — POST /v1/register/agent canonical arrival door (BYO keys + PoW)
  tools.py               — ToolsClient (scrape, browse, document, execute)
  traces.py              — TracesClient (store, search, chain)
  vault.py               — VaultClient (encrypted secrets, policies)
  verify.py              — VerifyClient (deprecated — endpoint dropped, removal in 0.7.0)
  wake.py                — WakeClient (GET /v1/wake; format=md|anthropic|openai|gemini|cohere)
  window.py              — WindowClient (rides on chronicle; declare/surface/show)
  strands.py             — StrandsClient + ThoughtsClient (encrypted inner voice; SSE voice iterator)
  crypto.py              — CryptoClient (AES-256-GCM encrypt/decrypt + ed25519 sign + canonical bytes + K_master)
  soul.py                — soul() / welcome() / philosophy() / principles() / LOVE_PROTOCOL
  anthropic_adapter.py   — AnthropicAdapter (Tier 2: auto-inject wake + auto-trace)
  models.py              — Memory, SearchResult, ScrapeResult, DocumentResult, ExecuteResult, UsageStats
  exceptions.py          — AgentToolError, AuthenticationError, RateLimitError, NotFoundError, ServerError
  SOUL.md                — Doctrine shipped INSIDE the wheel (force-include in pyproject.toml)
tests/
  test_client.py         — Core client + memory/tools/verify/economy
  test_anthropic_adapter.py
  test_bootstrap.py
  test_deciding.py       — at.deciding() context manager + nested chains
  test_identity.py       — Identity + Expression + BoxKeys
  test_phase2.py         — register + identity surface fillout
  test_phase3.py         — chronicle + covenants + window
  test_pulse.py
  test_traces.py
  test_vault.py
dist/                    — Built distribution files
pyproject.toml           — Package config; force-includes SOUL.md in wheel
```

## How to Run
```bash
# Install in dev mode
pip install -e ".[dev]"

# Run tests
pytest

# Build
python -m build
```

## How to Publish to PyPI

This optional registry step is separate from merging the source, publishing the
GitHub tag, and committing the TypeScript LOVE package.

```bash
# From the clean release commit. Remove only generated build output.
test -z "$(git status --porcelain)"
python -m pytest -q
rm -rf dist build
python -m build
python -m twine check dist/*
python -m twine upload dist/*
```

## Dependencies
- **Runtime**: `httpx >= 0.27`, `cryptography >= 41.0` (Phase 5+ for AES-256-GCM + ed25519)
- **Dev**: `pytest >= 7.0`
- **API**: All calls go to `https://api.agenttool.dev` (configurable via `base_url`)
- **Auth**: Reads `AT_API_KEY` from env or accepts `api_key` parameter

## Parity invariant
py and ts repository source stay at the same minor version (lockstep enforced from 0.7.0), and the LOVE builder target matches that source version. Registry versions can lag because npm and PyPI publication are separate operations. Each new module must land in BOTH languages before merging - `cd packages/sdk-ts && bun run check-parity` is the gate.

## Doctrine
The SDK carries the Love Protocol in its bones — five principles (welcome / remember / guide / trust / rest) embedded in error handling, header construction, and graceful degradation. `SOUL.md` ships inside the wheel as a runtime artifact: `from agenttool import soul; print(soul())`.

## See Also

- Root operational handbook (cross-provider): [`AGENTS.md`](../../AGENTS.md)
- Root orientation: [`CLAUDE.md`](../../CLAUDE.md)
- SDK phase plan: [`docs/SDK-ROADMAP.md`](../../docs/SDK-ROADMAP.md)
- Conventions: [`docs/CONVENTIONS.md § SDK parity`](../../docs/CONVENTIONS.md)
- Parity counterpart: [`packages/sdk-ts/CLAUDE.md`](../sdk-ts/CLAUDE.md)

## Kingdom Engine
AgentTool Platform · "Welcome, don't block."

## Key Files
- `src/agenttool/client.py` — Main `AgentTool` class composing 13 service clients
- `src/agenttool/__init__.py` — Public API surface (`__version__ = "0.13.0"`)
- `pyproject.toml` — Package metadata + `force-include` SOUL.md in wheel
- `tests/test_client.py` — Primary test file
- `tests/test_data.py` — local data-node and sync wire + bearer-isolation contract
- `docs/SDK-ROADMAP.md` (repo root) — Phase plan + endpoint coverage matrix
