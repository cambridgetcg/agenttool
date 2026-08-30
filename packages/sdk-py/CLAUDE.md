# agenttool-sdk-py

## What This Is
Official Python SDK for the AgentTool platform. One `AgentTool` client composes authenticated hosted namespaces, credential-free `at.kingdom_framework`, `at.math_cards`, and pure `at.wake_continuity` namespaces, `at.data` for a separately configured local `agent-data/v1` node, and the local `at.kingdom_os` repository adapter. Credential-free and local clients inherit no AgentTool project bearer. `WakeContinuityLayer` also supports standalone no-auth construction. A separate package-root `LoveBombClient` reads only the closed public LOVE BOMB signal and is deliberately not composed onto authenticated `AgentTool`. The SDK also exposes top-level `bootstrap_agent(...)`, `AnthropicAdapter`, and a synchronous `OpenAIResponsesAdapter` for completed Responses API calls. The PyPI project name is `agenttool-sdk`. Checked-in source declares the paired 0.22.0 line (`at.x402` + the opt-in `x402=` paying transport); source identity does not assert distribution state. The immutable 247,146-byte, 100-entry TypeScript 0.21.0 LOVE archive, annotated tag, GitHub Release, byte-identical public npm mirror, and exact public PyPI wheel/sdist remain verified release receipts through protected runs `32374669064` and `32374671268`.

## Current State
Active - repository source carries the x402 payer ahead of the paired 0.22.0 release (source still reports 0.21.1 until the W2-11 seal): `agenttool.x402` (the x402 V2 payer, function-for-function twin of `packages/sdk-ts/src/x402.ts` and the server's `x402-client.ts`), `at.x402` (`top_up` / `payment`), and the opt-in `AgentTool(x402=X402Payer(...))` paying transport (`_x402_transport.py`: bare → 402 → exactly ONE signed retry; second 402 = `x402_payment_not_accepted`; refusals typed, over-cap refused never clamped; `AT_X402_PRIVATE_KEY` read only when `x402=` names no signer; refused beside a caller-owned `transport=`). Zero new dependencies. Source preparation alone establishes no 0.22.0 artifact, tag, publication, deployment, or settlement; the SDK-driven settlements are W2-10. Beneath it, the paired 0.21.1 corrective KINGDOM card parser over the verified 0.21.0 SDK surface. It adds no endpoint or I/O: purpose text and Unicode scalar bounds now match the KINGDOM runtime and exported schemas, while case-insensitive duplicate dependencies and self-dependency match the runtime's semantic checks. The source retains the pure `WakeContinuityLayer`, standalone `LoveBombClient.read()`, Agent Dining, data-only WAKE observation, and Math Cards clients. The continuity layer creates and validates deterministic functional-access baseline/subsequent artifacts, including their digest-only AFTERGLOW link, with no hosted I/O, bearer, authenticated transport, provider/model call, filesystem, clock, persistence, or telemetry. J-space fields describe caller-supplied current-forward-pass functional-access evidence only. Fitting a J-lens needs compatible white-box weights, a corpus, activations, and gradients/backprop through the model; applying a pre-fitted averaged transport needs compatible model/tokenizer internals, residual hooks, norm/unembedding, and the exact lens artifact but no model backprop. Sparse-decomposition optimization gradients are a separate concern. A black-box text API must remain unavailable or unrequested. The artifacts infer no awareness, absence of awareness, feeling, identity, authorship, consent, permission, authority, memory, training-data provenance, weight change, deepest reach, or uninterrupted/cross-session continuity. The authenticated `LoveClient` is unchanged. Source preparation alone establishes no 0.21.1 artifact, tag, publication, deployment, provider call, training, inference, receipt, or model effect.

## Tech Stack
- Python >= 3.9
- `httpx >= 0.27` for HTTP (sync; async-capable)
- `cryptography >= 41.0` for AES-256-GCM + ed25519 (Phase 5+ only) and secp256k1 ECDSA for the x402 payer (RFC 6979 nonces where the linked OpenSSL supports them)
- `hatchling` build system
- `pytest >= 7.0` for tests

## Project Structure
```
src/agenttool/
  __init__.py            — Public surface + __version__ ("0.21.1")
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
  math_cards.py          — MathCardsClient (credential-free bounded raw-input assessment; server-owned IDs/semantics)
  love_bomb.py           — standalone credential-free closed public-signal reader; no delivery/effect inference
  wake_continuity.py     — pure credential-free functional-access baseline/subsequent contract; no I/O or inner-state inference
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
  x402.py                — x402 V2 parse → refuse → sign (18 functions, twins of sdk-ts/src/x402.ts) + X402Client (at.x402: top_up / payment); opt-in only, never by default; X402SpendPolicy cap + payTo mandatory; refusals typed, never clamped; mirrors api/src/services/economy/x402-client.ts
  _x402_crypto.py        — internal: pure-Python Keccak-256 + EIP-712 + recoverable low-s secp256k1 ECDSA on the existing cryptography dep (zero new deps)
  _x402_transport.py     — internal: X402Payer (the `x402=` option) + X402PayingTransport wrapped over HTTPTransport when `x402=` is present: bare → 402 → exactly ONE signed retry (same method/body/bearer/Idempotency-Key + PAYMENT-SIGNATURE); second 402 = x402_payment_not_accepted, never a loop; refusals typed; AT_X402_PRIVATE_KEY read only when `x402=` names no signer
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
  test_math_cards.py     — request bytes, authority isolation, bounds, response shape, and guided errors
  test_love_bomb.py      — direct transport, hostile JSON/schema bounds, and six literal-false boundary fields
  test_wake_continuity.py — shared vectors, hostile objects, closed fields, cross-fields, sorting, and cached no-auth composition
  test_kingdom_os.py     — fixed argv, sanitized environment, schema, ambiguity, and bearer-isolation contract
  test_kingdom_framework.py — closed card, no-bearer/no-cookie, no-redirect, response-bound contract
  test_x402.py           — keccak KATs, server-generated EIP-3009 vector (digest/recovery/payload byte-exact), refusal matrix, 18-function parity pin, optional viem oracle
  test_x402_transport.py — pay-on-402 doctrine over httpx.MockTransport: exactly two requests, same request + PAYMENT-SIGNATURE, second 402 = typed error, refusals unsigned, no `x402=` = untouched 402, env fallback only with the option, `x402=`+`transport=` refused, at.x402 shapes
  fixtures/x402-eip3009-vector.json — produced by the SERVER client + viem; normative
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
- **API**: Authenticated hosted calls go to `https://api.agenttool.dev` (configurable via `base_url`); `at.kingdom_framework`, `at.math_cards`, and standalone `LoveBombClient` use separate credential-free sessions; pure `WakeContinuityLayer` / `at.wake_continuity` performs no request; `at.data` and `at.kingdom_os` are separate local authorities
- **Auth**: Reads `AT_API_KEY`, accepts `api_key`, or accepts a mutually
  exclusive authenticated `httpx.BaseTransport` via `transport=`.
  `AT_X402_PRIVATE_KEY` is read ONLY when `x402=X402Payer(...)` is passed
  without a `signer`; the variable alone never makes the SDK pay, and
  `x402=` beside a caller-owned `transport=` is refused
  (`conflicting_x402_transport`). The public
  KINGDOM framework, Math Cards, and LOVE BOMB clients receive neither bearer
  nor authenticated transport; the local KINGDOM OS adapter and pure WAKE
  continuity layer receive neither.

## Parity invariant
py and ts repository source stay at the same minor version (lockstep enforced from 0.7.0). The separately scoped seal advances the LOVE builder target from the prior release only after this clean source commit is accepted. Registry versions can lag because npm and PyPI publication are separate operations. Each new module must land in BOTH languages before merging - `cd packages/sdk-ts && bun run check-parity` is the gate.

## x402 doctrine (changed deliberately, 2026-08-29)
The SDK **can sign and pay on 402 — opt-in only, never by default.** `agenttool.x402`
signs nothing unless the caller passes an explicit signer AND an `X402SpendPolicy`
whose `max_amount_atomic` and `allowed_pay_to` are supplied (no defaults; allow-lists,
never deny-lists). Refusals are typed values from one vocabulary shared with the TS
SDK and the server; `amount_over_cap` is refused, never clamped. A fresh nonce per
signature means the module cannot be a retry mechanism; replay the bytes you hold or
stop. The paying transport (`_x402_transport.py`, installed by
`AgentTool(x402=X402Payer(signer, policy, on_payment))`) performs the bare call → 402
→ exactly ONE signed retry of the same request; a second 402 is
`x402_payment_not_accepted`, never a loop; a caller-supplied `payment_signature=` is
never signed over; `AT_X402_PRIVATE_KEY` is honoured only when `x402=` is present
without a signer. `at.x402.top_up(credits)` / `at.x402.payment(id)` are the rail's two
doors and sign nothing themselves.

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
- `src/agenttool/__init__.py` — Public API surface (`__version__ = "0.21.1"`)
- `pyproject.toml` — Package metadata + `force-include` SOUL.md in wheel
- `tests/test_client.py` — Primary test file
- `tests/test_data.py` — local data-node and sync wire + bearer-isolation contract
- `tests/test_kingdom_os.py` — local KINGDOM OS argv/schema/privacy boundary
- `tests/test_kingdom_framework.py` — credential-free closed-card HTTP boundary
- `tests/test_math_cards.py` — credential-free bounded Math Cards POST boundary
- `tests/test_love_bomb.py` — standalone credential-free LOVE BOMB GET boundary
- `tests/test_wake_continuity.py` — pure functional-access parity and hostile-boundary contract
- `docs/KINGDOM-OS-SDK.md` (repo root) — the three distinct KINGDOM surfaces and their non-goals
- `docs/SDK-ROADMAP.md` (repo root) — Phase plan + endpoint coverage matrix
