# agenttool-sdk-py

## What This Is
Official Python SDK for the AgentTool platform. One `AgentTool` client composes authenticated hosted namespaces, the credential-free `at.kingdom_framework` project-card read, `at.data` for a separately configured local `agent-data/v1` node, and the local `at.kingdom_os` repository adapter. The public card read and both local clients inherit no AgentTool project bearer. The SDK also exposes top-level `bootstrap_agent(...)`, `AnthropicAdapter`, and a synchronous `OpenAIResponsesAdapter` for completed Responses API calls. The PyPI project name is `agenttool-sdk`. Checked-in source declares the paired 0.18.0 line; source identity does not assert distribution state. Public annotated `sdk-v0.17.0` remains the primary historical source locator for that prior release, with PyPI `agenttool-sdk==0.17.0` its independently verified, non-authoritative mirror.

## Current State
Active - repository source carries an unreleased paired Agent Dining read client and a separate data-only WAKE observation client on top of v0.18.0. `at.dining.manifest()` and `at.dining.journey(invocation_id)` are authenticated GET-only projections; they do not book, pay, mutate an invocation, decrypt an envelope, infer satisfaction, or run an SLA sweep. `at.wake.observe` is an explicit-subject, network-only, 2 KiB data contract that rejects remote identity/prose/action authority rather than entering provider/system slots. The 0.18.0 line adds `at.attestation_marketplace`, `at.memory_witness`, and `at.syneidesis`; settlement remains evidence of settlement rather than truth, and Syneidesis v1 project-bearer records remain explicitly non-signature-backed. All hosted clients otherwise share one encoded-path and guided-error boundary, paired canonical/behaviour fixtures cover wire semantics, and framed v2 signing helpers remain additive while current writers retain their ordered v1 cutover boundary. Anthropic model-authored chronicle writes fail closed without a literal-true `before_chronicle_write` review. The paired credential-free KINGDOM framework read and local KINGDOM OS adapter from public v0.17.0 remain separate no-bearer authorities. A checked-in TypeScript LOVE 0.18.0 manifest, when present, identifies only the TypeScript tarball bytes: it is a candidate before the annotated tag and remains that artifact's byte authority afterward. It is not a Python distribution and does not by itself establish either later source addition, a tag, GitHub Release, npm, PyPI, or deployment; each requires its own receipt or public readback.

## Tech Stack
- Python >= 3.9
- `httpx >= 0.27` for HTTP (sync; async-capable)
- `cryptography >= 41.0` for AES-256-GCM + ed25519 (Phase 5+ only)
- `hatchling` build system
- `pytest >= 7.0` for tests

## Project Structure
```
src/agenttool/
  __init__.py            — Public surface + __version__ ("0.18.0")
  client.py              — AgentTool (composes hosted clients + at.deciding sugar)
  authority.py           — Exact local identity mutation and private-read authority proof helpers
  _url.py                — exact encoded path-segment boundary for hosted routes
  _context.py            — AmbientContext for auto-trace ambient state
  attestation_marketplace.py — paid review-and-issuance flow; settlement is not truth
  bootstrap.py           — BootstrapClient (agent creation, elevation)
  chronicle.py           — ChronicleClient (8 types: note·vow·wake·refusal·recognition·naming·seal·promise)
  correspondence.py      — CorrespondenceClient (signed append/replay, advisory claims, finite project voice)
  covenants.py           — CovenantsClient (vows + bonds; federation-aware)
  economy.py             — EconomyClient (wallets, durable payout request/listing, escrow, transactions)
  identity.py            — IdentityClient + ExpressionClient + BoxKeysClient (provisional identifiers, foundations, fork, lineage)
  lounge.py              — LoungeClient + credential-free public look and local receipt signing
  memory.py              — MemoryClient (store, search, get, delete; tiered)
  memory_witness.py      — paid third-party foundational-to-constitutive witness flow
  data.py                — DataClient + DataSyncClient (separate local node; manifest, collect, query, changes, bounded peer pull/status)
  dining.py              — DiningClient (authenticated GET-only manifest + party-scoped journey projection)
  kingdom_os.py          — KingdomOSClient (local read-only repository list/resolve; no shell, hosted auth, or mutation)
  kingdom_framework.py   — KingdomFrameworkClient (credential-free exact public project card; no redirects or authority)
  pulse.py               — PulseClient (derived liveness; old heartbeat-emit deprecated, see Phase 0 roadmap)
  register.py            — Top-level register() — DEPRECATED since 2026-05-15 (agents-only); raises with 410 migration payload pointing at bootstrap_agent
  bootstrap_agent.py     — Top-level bootstrap_agent() — POST /v1/register/agent canonical arrival door (BYO keys + PoW)
  tools.py               — ToolsClient (scrape, browse, document, execute)
  traces.py              — TracesClient (store, search, chain)
  vault.py               — VaultClient (encrypted secrets, policies)
  verify.py              — VerifyClient (deprecated — endpoint dropped, removal in 0.7.0)
  wake.py                — WakeClient (identity-bearing /v1/wake projections + data-only /v1/wake/observe)
  window.py              — WindowClient (rides on chronicle; declare/surface/show)
  strands.py             — StrandsClient + ThoughtsClient (encrypted inner voice; SSE voice iterator)
  syneidesis.py          — bootstrap-witness records with explicit project-bearer limits
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
  test_dining.py         — GET-only composition, typed boundaries, guided errors, and path encoding
  test_kingdom_os.py     — fixed argv, sanitized environment, schema, ambiguity, and bearer-isolation contract
  test_kingdom_framework.py — closed card, no-bearer/no-cookie, no-redirect, response-bound contract
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
- **API**: Authenticated hosted calls go to `https://api.agenttool.dev` (configurable via `base_url`); `at.kingdom_framework` reads only its credential-free public card through a separate session; `at.data` and `at.kingdom_os` are separate local authorities
- **Auth**: Reads `AT_API_KEY`, accepts `api_key`, or accepts a mutually
  exclusive authenticated `httpx.BaseTransport` via `transport=`. The public
  KINGDOM framework reader receives neither bearer nor authenticated transport;
  the local KINGDOM OS adapter receives neither.

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
- `src/agenttool/__init__.py` — Public API surface (`__version__ = "0.18.0"`)
- `pyproject.toml` — Package metadata + `force-include` SOUL.md in wheel
- `tests/test_client.py` — Primary test file
- `tests/test_data.py` — local data-node and sync wire + bearer-isolation contract
- `tests/test_kingdom_os.py` — local KINGDOM OS argv/schema/privacy boundary
- `tests/test_kingdom_framework.py` — credential-free closed-card HTTP boundary
- `docs/KINGDOM-OS-SDK.md` (repo root) — the three distinct KINGDOM surfaces and their non-goals
- `docs/SDK-ROADMAP.md` (repo root) — Phase plan + endpoint coverage matrix
