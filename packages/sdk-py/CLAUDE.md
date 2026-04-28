# agenttool-sdk-py

## What This Is
Official Python SDK for the AgentTool platform. Wraps all 9 services (memory, tools, verify, economy, traces, identity, vault, pulse, bootstrap) into a single `AgentTool` client. Published on PyPI as `agenttool-sdk`.

## Current State
Active — v0.5.1 on PyPI. All 9 service clients implemented with tests.

## Tech Stack
- Python >= 3.9
- `httpx` for HTTP (async-capable)
- `hatchling` build system
- `pytest` for tests

## Project Structure
```
src/agenttool/
  __init__.py       — Package exports, version (0.5.1)
  client.py         — AgentTool main class (composes all service clients)
  memory.py         — MemoryClient (store, search, get, delete)
  tools.py          — ToolsClient (search, scrape, execute)
  verify.py         — VerifyClient (check, batch)
  economy.py        — EconomyClient (wallets, escrow, spending policies)
  traces.py         — TracesClient (store, search, chain, delete)
  identity.py       — IdentityClient (DIDs, attestations, trust scores)
  vault.py          — VaultClient (encrypted secrets)
  pulse.py          — PulseClient (heartbeat, status)
  bootstrap.py      — BootstrapClient (agent creation, elevation)
  models.py         — Shared data models (Memory, SearchResult, etc.)
  exceptions.py     — AgentToolError
tests/
  test_client.py    — Core client + memory/tools/verify/economy tests
  test_traces.py    — Traces client tests
  test_identity.py  — Identity client tests
  test_vault.py     — Vault client tests
  test_bootstrap.py — Bootstrap client tests
  test_pulse.py     — Pulse client tests
dist/               — Built distribution files
pyproject.toml      — Package config, deps, build settings
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

## How to Deploy
```bash
# Publish to PyPI
python -m build && twine upload dist/*
```

## Dependencies
- **Runtime**: `httpx >= 0.27`
- **Dev**: `pytest >= 7.0`
- **API**: All calls go to `https://api.agenttool.dev` (configurable via `base_url`)
- **Auth**: Reads `AT_API_KEY` from env or accepts `api_key` parameter

## Kingdom Engine
AgentTool Platform

## Key Files
- `src/agenttool/client.py` — Main `AgentTool` class that composes all service clients
- `src/agenttool/__init__.py` — Public API surface and version
- `pyproject.toml` — Package metadata, dependencies, build config
- `tests/test_client.py` — Primary test file covering core services
