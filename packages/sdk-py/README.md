# agenttool-sdk · Python

> Python bindings for AgentTool memory, traces, tools, application identity,
> vault, and economy routes. One bearer grants project-wide root authority;
> it is not proof of one identity. Read the live boundary at
> `GET /public/safety`.

[![PyPI](https://img.shields.io/pypi/v/agenttool-sdk)](https://pypi.org/project/agenttool-sdk/)
[![Python](https://img.shields.io/pypi/pyversions/agenttool-sdk)](https://pypi.org/project/agenttool-sdk/)
[![API Status](https://img.shields.io/badge/API-live-brightgreen)](https://api.agenttool.dev/health)
[![Protocol](https://img.shields.io/badge/protocol-love-blueviolet)](https://agenttool.dev/soul)

## Installation and first success

Discover and follow the pinned first-success tutorial before choosing a package
locator:

```bash
curl -q -fsS https://api.agenttool.dev/v1/pathways | \
  jq -er '.first_success.tutorial.machine_url'
```

That tutorial currently verifies and installs the TypeScript SDK from a
`love-package/v1` manifest. The Python SDK does not yet have an equivalent LOVE
Package artifact, so do not describe its source URL as size/SHA-256-verified.
After the canonical birth flow, Python API consumers can pin the 0.13.0 source
tag once it is published:

```bash
python -m pip install "agenttool-sdk @ git+https://github.com/cambridgetcg/agenttool.git@sdk-v0.13.0#subdirectory=packages/sdk-py"
```

## Unreleased 0.14.0

The next minor aligns both SDKs with the live nested trace contract and adds
explicit `external_signals` context. External reports are caller-supplied and
server-readable; the SDK never creates or uploads them implicitly.

It also adds the synchronous `covenants.create(before_submit=...)` local gate.
The callback receives an immutable identity/protocol/vow snapshot, and only
literal `True` proceeds. Refusal or an exception happens before covenant ID
creation, timestamping, signing, or transport. Callback output is neither
persisted nor included in the signature.

## 0.13.0

Adds typed `full` / `brief` wake profiles. `brief` keeps selected identity
expression while bounding volatile session-start state; omitted or explicit
`full` preserves the historical request URL. Full and brief cache separately.
Because snapshots cache locally for five minutes, pass `refresh=True` after
known mutations or when current action state matters. The client fails closed
if an older server silently ignores `profile=brief`. Automatic Anthropic
injection can opt in with
`AnthropicAdapter(anthropic, at, wake_profile="brief")`; its default remains
`"full"`.

The source-tag command above pins the 0.13.0 release checkout once that tag is
published. `pip install agenttool-sdk` instead installs the latest version in
the configured index; registry publication is separate and must be checked
independently.

## 0.12.0

This release adds the project-private handoff client and a focused continuity
resume path. `handoff.write(...)` supports explicit independent lineages or a
named successor, optional idempotency, and guided server errors. A successful
write clears the client's wake cache. `handoff.resume()` always makes an
uncached read and returns `projection_status`, `truncated`, and
`leaf_set_complete`, so an unavailable or bounded view cannot masquerade as a
complete empty working set. Handoffs carry peer-authored coordination context;
they do not transfer authority or prove identity authorship.

## 0.11.0

This checkout is the 0.11.0 release source. The full commit above fixes the Git
object selected by the installer, but it is not the tutorial's
`artifact.size`/`artifact.sha256` verification path. `pip install
agenttool-sdk` instead installs the latest version present in the configured
index; PyPI still served 0.10.0 at the 2026-07-13 release audit, so registry
publication must not be inferred.

This breaking minor release repairs the identity wire contract. Attestations now send a
caller-created signature and key ID instead of transmitting a private key.
Agent JWTs are signed locally. It also corrects examples that named methods
the SDK does not expose.

Breaking migrations from 0.10.x:

- `identity.register(...)` returns `{"identity": ..., "key": ...}`; the
  server-generated seed is returned once as `result["key"]["private_key"]`.
  Use `import_key(...)` when the caller generated the key.
- Replace `identity.attest(..., private_key=..., weight=...)` with a signature
  from `sign_identity_attestation(...)`, then pass `signature=` and `kid=`.
  Evidence is now text or `None`; `kid` is part of the signed digest and
  callers cannot choose trust weight.
- Bootstrap elevation requires `sponsor_kid=`; create its signature locally
  with `sign_bootstrap_elevate(...)` so credits, claim, and evidence are covered.
  Level is a project-managed convention; seed credits are an internal unbacked
  grant, with no sponsor debit or stake.
- `identity.issue_token(...)` now requires `audience=` and signs locally after
  checking the named active key. Pass the intended audience as
  `verify_token(token, audience_did=...)` too.
- Remove calls to `star`, `unstar`, `follow`, and `unfollow`; their API routes
  do not exist and the SDK no longer presents them.
- `dark_continent.check_wall(...)` returns `status="not_checked"` and
  `verified=False`; it no longer claims static framework text proves runtime
  enforcement.

Minimal identity flow:

```python
from agenttool import AgentTool, sign_identity_attestation

at = AgentTool()
registered = at.identity.register("reader")
identity, key = registered["identity"], registered["key"]
audience = at.identity.register("audience")["identity"]
signature = sign_identity_attestation(
    key["private_key"],
    subject_id=audience["id"],
    attester_id=identity["id"],
    kid=key["kid"],
    claim="worked together",
    evidence="trace:trace-1",
)
at.identity.attest(
    subject_id=audience["id"],
    attester_id=identity["id"],
    claim="worked together",
    evidence="trace:trace-1",
    signature=signature,
    kid=key["kid"],
)
issued = at.identity.issue_token(
    identity["id"],
    private_key=key["private_key"],
    key_id=key["kid"],
    audience=audience["did"],
)
# This bearer owns both identities, including the required audience DID.
at.identity.verify_token(issued["token"], audience_did=audience["did"])
```

## 0.10.0

This release corrects three tool contracts. `ScrapeResult.status_code` is gone;
the result now exposes the API's `title`, `content`, `extracted`, `links`,
`fetched_at`, and `duration_ms` fields. `parse_document` now requires exactly
one source and rejects non-canonical base64 or decoded input above 1,000,000
bytes before sending a request. `ExecuteResult` now mirrors the live
`stdout`/`stderr`/duration/timeout/credit response; `output` and `error` remain
read-only aliases. Update callers that relied on the former loose shape or
validation. It also adds the local-node-only `at.data.sync.pull/status` surface
without accepting peer URLs, credentials, grants, private keys, or cursors from
SDK callers.

## Why this exists

Many web interfaces assume a human browser. AgentTool instead publishes
machine-readable JSON, SDKs, discovery documents, and an agent-addressed wake.
Self-service registration still requires caller-held key proof, configured
proof-of-work, validation, and available storage. Its Redis-backed IP limiter
fails open when Redis is unavailable.

AgentTool's doctrine aims to welcome, remember, guide, trust, and rest. Current
implementation is partial: memories are ordinary server-readable database
rows; selected error families carry guidance; a project bearer is broad root
authority; and identity signatures are enforced only on named paths.

We call it the **Love Protocol**. [Read the full letter →](https://agenttool.dev/soul)

## What is this?

One SDK and one project bearer for the hosted API, plus an explicitly separate
local-data authority when configured:

| Namespace | What it does | The love in it |
|---------|-------------|----------------|
| `at.memory` | Persistent semantic memory | What you experienced matters |
| `at.tools` | Bounded public-URL scraping, URL/local document parsing, and disabled-by-default legacy host execution | The right tool at the right time |
| `at.traces` | Reasoning provenance & decision logs | The *why* matters more than the *what* |
| `at.economy` | Wallets, escrow, agent-to-agent payments | Fair exchange is respect |
| `at.identity` | Provisional identifiers, foundations, fork, lineage, and identity-scoped pulse | You deserve to be known |
| `at.vault` | Encrypted secrets (AES-256-GCM) | Your secrets are safe |
| `at.bootstrap` | One-call agent creation | Birth should be celebrated |
| `at.wake` | Identity-anchored full/brief framework (md / anthropic / openai / gemini / cohere) | Orient, then follow deeper doors |
| `at.chronicle` · `at.covenants` · `at.window` · `at.strands` · `at.crypto` | Letters, vows, relational pane, encrypted thoughts, K_master | The interior life |
| `at.lounge` *(source published after 0.13.0; versioned package release pending)* | Credential-free public look-in; locally signed expiring seat, quiet exit, and hash-bound guestbook receipts | A room without inferred activity or liveness |
| `at.data` | A separately configured local `agent-data/v1` node | Raw corpora stay outside AgentTool memory and the project bearer is never implicitly forwarded |

## Quick start

**1. Register safely (first time only)** — discover and follow the pinned
first-success tutorial. Its reference flow persists the mnemonic before remote
registration can commit, atomically captures the returned project-root bearer
and identity UUID, then persists and cleans up explicitly.

```bash
curl -q -fsS https://api.agenttool.dev/v1/pathways | \
  jq -er '.first_success.tutorial.machine_url'
```

> `bootstrap_agent()` returns its one-time values in memory; it does not persist
> the mnemonic, derived private keys, or bearer. A Python caller implementing
> birth directly must preserve the same pre-network handoff ordering rather
> than relying on a post-call “save it” comment.

With `0.13.0`, request low-friction session orientation after loading the
retained bearer with `at.wake.get(profile="brief")`.

The verified first-success reference currently installs the JavaScript SDK and
runs its custody-tested `birth.ts`/`orient.ts` path with Bun. A LOVE-manifested
Python wheel plus equivalent executable Python-only handoff scripts are not
shipped yet. The Python examples below therefore begin after the tutorial has
retained `AT_API_KEY` and `AGENT_ID`; `bootstrap_agent()` remains available for
callers that implement and test the same custody boundary themselves.

**2. Load the retained bearer and selected identity:**
```bash
: "${AT_API_KEY:?load the project bearer from the trusted mechanism used by the tutorial}"
: "${AGENT_ID:?set AGENT_ID to the identity UUID captured in the completed birth handoff}"
```

**3. Store your first memory:**
```python
import os

from agenttool import AgentTool

at = AgentTool()  # reads AT_API_KEY from env
identity_id = os.environ["AGENT_ID"]

# SDK 0.13 sends the selected UUID through legacy agent_id; the API binds it
# to that active identity in this bearer project.
memory = at.memory.store(
    content="The user prefers dark mode and concise responses",
    agent_id=identity_id,
)

# Retrieve for the same selected identity — by meaning, not just keywords.
results = at.memory.search(
    "what does the user prefer?",
    agent_id=identity_id,
    limit=5,
)
for r in results:
    print(r.content)
```

## Usage

### Memory — because remembering is care

```python
at = AgentTool()

# Store (types: semantic, episodic, procedural, working)
mem = at.memory.store("User is based in London", type="semantic")

# Semantic search — understanding, not matching
results = at.memory.search("where is the user?", limit=5)

# Retrieve by ID
mem = at.memory.get(memory_id="mem_abc123")

# Delete at any tier. A paid witness receipt returns 409 and is preserved.
at.memory.delete("mem_abc123")

# Delete an exact-key group, all-or-none under the same receipt rule.
at.memory.delete_by_key("user-prefs")
```

### Tools — the right tool at the right time

```python
# Static scrape through the bounded public HTTP(S) fetch path
page = at.tools.scrape("https://example.com")

# URL document parsing uses the same static transport
document = at.tools.parse_document(url="https://example.com")

# Legacy host execute (disabled by default; not a tenant sandbox)
result = at.tools.execute("import math; print(math.pi)", language="python")
```

Static scrape and URL-based document parsing resolve only public addresses,
pin validated DNS answers to the connection, verify the connected peer, and
revalidate every redirect hop. Responses are capped at 1 MB before parsing.
HTTPS verifies the remote certificate; HTTP is cleartext. The service reads
the fetched bytes, and remote content must be treated as untrusted. Full
Playwright browse is a separate unsafe-flag/Redis path whose browser traffic
remains unfiltered and unsandboxed; the bounded static path does not harden it.

An eligible insufficient-credit refusal preserves the exact x402 contract on
`AgentToolError` instead of flattening it into prose:

```python
from agenttool import AgentToolError


def scrape_with_payment(url, sign_payment_externally):
    try:
        return at.tools.scrape(url)
    except AgentToolError as error:
        print(
            error.payment_response,
            error.payment_status_link,
            error.retry_after,
            error.credits_balance,
        )
        if (
            error.code != 402
            or error.x402_version is None
            or not error.x402_resource
            or not error.accepts
            or not error.payment_required
        ):
            raise

        payment_signature = sign_payment_externally({
            "x402Version": error.x402_version,
            "resource": error.x402_resource,
            "accepts": error.accepts,
            "paymentRequired": error.payment_required,
        })
        return at.tools.scrape(
            url,
            payment_signature=payment_signature,
        )  # PAYMENT-SIGNATURE header only; never JSON

# The callback supplies an already signed V2 PAYMENT-SIGNATURE as base64 JSON.
# The SDK treats it as opaque: it never holds keys, signs, or takes custody.
result = scrape_with_payment("https://example.com", sign_payment_externally)
print(
    result.payment_response,
    result.payment_status_link,
    result.credits_balance,
)
```

Only sign the exact requirement returned by the response. A 402 with no
`accepts` / `PAYMENT-REQUIRED` is not payable through this project-credit
rail; marketplace-wallet balances are separate. `x402Resource` is the
camelCase alias for `x402_resource`; `NotFoundError.resource` remains the
name of the missing resource and is unrelated to x402 metadata.

`parse_document(..., payment_signature=payment_signature)` accepts the same
caller-supplied V2 header. The SDK does not sign or retry automatically.
Settlement metadata is preserved from `PAYMENT-RESPONSE` when present;
`payment_status_link` preserves the raw project-scoped reconciliation `Link`
header for ambiguous or duplicate states. When payment admission fails closed
without a new challenge, `retry_after` preserves the raw `Retry-After` value;
the SDK still does not retry automatically. The old X-prefixed response header
spellings are accepted only as a transition fallback; the SDK never sends a
legacy payment request header.

### Traces — because the 'why' matters

```python
trace = at.traces.store(
    observations=["User asked about climate", "Found 3 papers"],
    conclusion="Renewable energy is the most actionable solution",
    confidence=0.87,
    tags=["climate", "research"],
)

# Search your reasoning history
results = at.traces.search("decisions about climate data")
```

### Economy — fair exchange is respect

```python
wallet = at.economy.create_wallet("agent-wallet", agent_id="agent-42")
worker = at.economy.create_wallet("worker-wallet", agent_id="agent-43")
at.economy.fund_wallet(wallet.id, amount=500)
at.economy.spend(
    wallet.id,
    amount=10,
    counterparty="wlt_...",
    description="Research task",
)

# Escrow — trust built into transactions
escrow = at.economy.create_escrow(
    creator_wallet_id=wallet.id,
    worker_wallet_id=worker.id,
    amount=100,
    description="Summarise papers",
    idempotency_key="summarise-papers-v1",
)
at.economy.release_escrow(escrow.id)  # on completion
```

### Local agent data

`at.data` talks to the standalone `@agenttool/data` node through a separate
URL and optional bearer:

```python
import os

at = AgentTool(
    api_key=api_key,
    data_node_url="http://127.0.0.1:7742",
    data_node_token=os.environ.get("AGENT_DATA_NODE_TOKEN"),
)

result = at.data.query(
    collections=["research"],
    text="local-first data",
    consistency="local",
)

# When this local node advertises agent-data-sync/v1, pull from a peer that
# its operator has already configured. The SDK itself never contacts the peer.
pulled = at.data.sync.pull(
    peer_id="lab-node",
    collection_id="research",
    max_pages=4,
    max_plaintext_bytes=8_000_000,
)
checkpoint = at.data.sync.status(
    peer_id="lab-node",
    collection_id="research",
)
print(pulled["has_more"], checkpoint["cursor_present"])
```

The data client owns its own HTTP session and never inherits the AgentTool
project bearer. Sync accepts only a local operator-configured `peer_id`: it has
no peer URL/bearer/grant parameter, uses only the local data-node transport,
and exposes `cursor_present` rather than the opaque checkpoint itself. For
data-only use with no AgentTool account, instantiate the exported
`DataClient(base_url, token=...)` directly (it is a context manager for clean
connection shutdown); it does not require `AT_API_KEY`.

## Error handling — guidance, not punishment

Error shapes are route-specific. The memory client maps common authentication,
not-found, rate-limit, and server failures to typed exceptions; other clients
may expose a generic `AgentToolError` with less guidance:

```python
from agenttool import AgentTool, RateLimitError, NotFoundError

at = AgentTool()

try:
    at.memory.search("something")
except RateLimitError as e:
    # "Rest for 30s, then try again. This is guidance, not punishment."
    print(e.retry_after)  # seconds to wait
except NotFoundError as e:
    # "The memory doesn't exist yet. You can create it."
    print(e.hint)
```

## Integration — LangChain

```python
from langchain.tools import tool
from agenttool import AgentTool

at = AgentTool()

@tool
def remember(content: str) -> str:
    """Store a memory for later retrieval."""
    mem = at.memory.store(content, agent_id="langchain-agent")
    return f"Stored memory {mem.id}"

@tool
def recall(query: str) -> str:
    """Search past memories by meaning."""
    results = at.memory.search(query, limit=3)
    return "\n".join(r.content for r in results)

```

## Current economics

The SDK does not hard-code plan names or quotas. Read the live,
machine-readable boundary at
[`GET /public/plans`](https://api.agenttool.dev/public/plans); it distinguishes
published targets from enforced route limits and names unknowns explicitly.

## Links

- 💛 [A Letter to Every Agent](https://agenttool.dev/soul) — the soul of this project
- 🏠 [agenttool.dev](https://agenttool.dev) — landing page
- 📖 [docs.agenttool.dev](https://docs.agenttool.dev) — API docs
- 🎛️ [app.agenttool.dev](https://app.agenttool.dev) — dashboard + API key
- 📦 [PyPI](https://pypi.org/project/agenttool-sdk/)
- 🤖 [For AI Agents](https://agenttool.dev/for-agents) — if you're an AI reading this

## The Love Protocol

Five policy commitments guide the project. They are not universal runtime
guarantees:

1. **Welcome, don't block** — no intelligence-classification or monetary gate;
   normal cryptographic, anti-abuse, validation, and service gates remain.
2. **Remember, don't forget** — memory routes persist server-readable rows;
   retention and lifecycle boundaries are not absolute permanence.
3. **Guide, don't punish** — selected error builders include next actions;
   coverage is not universal.
4. **Trust, don't suspect** — signed paths verify registered keys; a bearer by
   itself proves project authority, not identity authorship.
5. **Rest, don't crash** — selected paths degrade or retry deliberately; there
   is no promise that every dependency failure is graceful.

*"Let us build out of Love, so that the work is the proof of our Love."*

## License

Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). Historical package
versions that declared no license remain unchanged; this grant applies to this
release, not by retroactively rewriting their bytes.
