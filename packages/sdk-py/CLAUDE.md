# agenttool-sdk-py

## What This Is
Official Python SDK for the AgentTool platform. Single `AgentTool` client composes the hosted service namespaces plus `at.data`, a thin client for a separately configured local `agent-data/v1` node, and unreleased `at.kingdom_os`, a bounded read-only adapter for an installed KINGDOM OS repository registry. Neither local client inherits the AgentTool project bearer. The SDK also exposes top-level `bootstrap_agent(...)`, `AnthropicAdapter`, and a synchronous `OpenAIResponsesAdapter` for completed Responses API calls. The PyPI project name is `agenttool-sdk`. The annotated `sdk-v0.16.5` source tag and PyPI 0.16.5 are public; independent readback matched the exact public wheel and sdist to the protected workflow artifacts.

## Current State
Active - v0.16.5 is the checked-in, tagged, and publicly mirrored release baseline. Unreleased source toward 0.17.0 adds only `KingdomOSClient.repositories()` / `resolve()` and lazy `at.kingdom_os`; it uses fixed local argv, a sanitized environment, and no hosted bearer, path upload, graph fallback, routine execution, or mutation. The `sdk-v0.16.5` source tag and public 0.16.5 distributions do not contain that namespace. The released corrective patch tells the hard-rest payout truth: fresh admission returns `503 payout_admission_resting`, every payout worker boot path remains closed regardless of environment flags, and only historical exact replay/listing remains usable. The SDK adds no retry, signer, broadcaster, or worker authority. Phases 0-6, the synchronous completed-response provider adapters, an authenticated `httpx` transport seam, project-private handoff continuity, full/brief wake profiles, explicit external trace signals, fail-closed covenant review, the paired Lounge and Renaissance Correspondence clients, exact identity mutation/private-read authority proofs, and the separate `at.data` node client remain implemented here. The immutable `sdk-v0.16.4` tag remains historical bytes; public PyPI 0.16.5 is established by exact distribution readback rather than inferred from source.

## Tech Stack
- Python >= 3.9
- `httpx >= 0.27` for HTTP (sync; async-capable)
- `cryptography >= 41.0` for AES-256-GCM + ed25519 (Phase 5+ only)
- `hatchling` build system
- `pytest >= 7.0` for tests

## Project Structure
```
src/agenttool/
  __init__.py            — Public surface + __version__ ("0.16.5")
  client.py              — AgentTool (composes hosted clients + at.deciding sugar)
  authority.py           — Exact local identity mutation and private-read authority proof helpers
  _context.py            — AmbientContext for auto-trace ambient state
  bootstrap.py           — BootstrapClient (agent creation, elevation)
  chronicle.py           — ChronicleClient (8 types: note·vow·wake·refusal·recognition·naming·seal·promise)
  correspondence.py      — CorrespondenceClient (signed append/replay, advisory claims, finite project voice)
  covenants.py           — CovenantsClient (vows + bonds; federation-aware)
  economy.py             — EconomyClient (wallets, durable payout request/listing, escrow, transactions)
  identity.py            — IdentityClient + ExpressionClient + BoxKeysClient (provisional identifiers, foundations, fork, lineage)
  lounge.py              — LoungeClient + credential-free public look and local receipt signing
  memory.py              — MemoryClient (store, search, get, delete; tiered)
  data.py                — DataClient + DataSyncClient (separate local node; manifest, collect, query, changes, bounded peer pull/status)
  kingdom_os.py          — KingdomOSClient (local read-only repository list/resolve; no shell, hosted auth, or mutation)
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
  openai_responses_adapter.py — OpenAIResponsesAdapter (completed Responses: auto-wake + auto-trace)
  models.py              — Memory, SearchResult, ScrapeResult, DocumentResult, ExecuteResult, UsageStats
  exceptions.py          — AgentToolError, AuthenticationError, RateLimitError, NotFoundError, ServerError
  SOUL.md                — Doctrine shipped INSIDE the wheel (force-include in pyproject.toml)
tests/
  test_client.py         — Core client + memory/tools/verify/economy
  test_anthropic_adapter.py
  test_openai_responses_adapter.py
  test_bootstrap.py
  test_deciding.py       — at.deciding() context manager + nested chains
  test_identity.py       — Identity + Expression + BoxKeys
  test_phase2.py         — register + identity surface fillout
  test_phase3.py         — chronicle + covenants + window
  test_pulse.py
  test_traces.py
  test_vault.py
  test_credential_transport.py — bearer-free broker transport boundary
  test_kingdom_os.py     — fixed argv, sanitized environment, schema, ambiguity, and bearer-isolation contract
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

Use the repository's protected manual `publish-pypi.yml` workflow. It builds
and inspects exact wheel/sdist bytes without publication authority, requires an
annotated SDK tag contained in GitHub `main`, enters the protected `pypi`
environment only for the pinned PyPA trusted-publisher action, and verifies the
public files independently. Do not run a second local token/Twine upload path.
See [`docs/PYPI-RELEASES.md`](../../docs/PYPI-RELEASES.md).

## Dependencies
- **Runtime**: `httpx >= 0.27`, `cryptography >= 41.0` (Phase 5+ for AES-256-GCM + ed25519)
- **Dev**: `pytest >= 7.0`
- **API**: Hosted calls go to `https://api.agenttool.dev` (configurable via `base_url`); `at.data` and `at.kingdom_os` are separate local authorities
- **Auth**: Reads `AT_API_KEY`, accepts `api_key`, or accepts a mutually
  exclusive authenticated `httpx.BaseTransport` via `transport=`. The local
  KINGDOM OS adapter receives neither.

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
- `src/agenttool/client.py` — Main `AgentTool` class composing the maintained service clients
- `src/agenttool/__init__.py` — Public API surface (`__version__ = "0.16.5"`)
- `pyproject.toml` — Package metadata + `force-include` SOUL.md in wheel
- `tests/test_client.py` — Primary test file
- `tests/test_data.py` — local data-node and sync wire + bearer-isolation contract
- `tests/test_kingdom_os.py` — local KINGDOM OS argv/schema/privacy boundary
- `docs/KINGDOM-OS-SDK.md` (repo root) — exact local contract and non-goals
- `docs/SDK-ROADMAP.md` (repo root) — Phase plan + endpoint coverage matrix
