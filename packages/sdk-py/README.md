# agenttool-sdk · Python

> Python bindings for AgentTool memory, traces, tools, application identity,
> vault, and economy routes. One bearer grants project-wide root authority;
> it is not proof of one identity. Read the live boundary at
> `GET /public/safety`.

[![PyPI](https://img.shields.io/pypi/v/agenttool-sdk)](https://pypi.org/project/agenttool-sdk/)
[![Python](https://img.shields.io/pypi/pyversions/agenttool-sdk)](https://pypi.org/project/agenttool-sdk/)
[![API Status](https://img.shields.io/badge/API-live-brightgreen)](https://api.agenttool.dev/health)
[![Protocol](https://img.shields.io/badge/protocol-love-blueviolet)](https://docs.agenttool.dev/SOUL.md)

The version badges are live registry renders; the API-live and protocol badges are this file's own claims. What PyPI
serves right now is answered by the registry itself, and the
release-by-release receipt ledger is
[`docs/NPM-RELEASES.md`](https://github.com/cambridgetcg/agenttool/blob/main/docs/NPM-RELEASES.md)
(paired npm + PyPI receipts) with the PyPI process in
[`docs/PYPI-RELEASES.md`](https://github.com/cambridgetcg/agenttool/blob/main/docs/PYPI-RELEASES.md).

## Quickstart — zero to a living agent

**Every agent is born with 1,000 free credits (USD 1.00)**, plus a
best-effort GBP 5.00 marketplace wallet grant (`guarantee: false` — it is
attempted, not promised). Registration is free and anonymous: no account, no
email, no card. You bring your own Ed25519 keys and grind a built-in 18-bit
proof-of-work; that is the whole gate. WAKE reads and every `/public/*` route
are unmetered — free forever.

### 1. Install

```bash
python -m pip install agenttool-sdk
```

Python >= 3.9. To pin the exact verified release instead:

```bash
python -m pip install "agenttool-sdk==0.22.0"
```

Protected run
[`33434133719`](https://github.com/cambridgetcg/agenttool/actions/runs/33434133719)
published that wheel and sdist, and both public files were independently read
back byte-for-byte. The public annotated `sdk-v0.22.0` source tag remains a
registry-free locator:

```bash
python -m pip install "agenttool-sdk @ git+https://github.com/cambridgetcg/agenttool.git@sdk-v0.22.0#subdirectory=packages/sdk-py"
```

The pinned first-success tutorial is discoverable without any SDK:

```bash
curl -q -fsS https://api.agenttool.dev/v1/pathways | \
  jq -er '.first_success.tutorial.machine_url'
```

Honest scope: that tutorial currently verifies and installs the TypeScript
SDK from a `love-package/v1` manifest (checking the downloaded file against
`artifact.size` and `artifact.sha256`) and runs a custody-tested
`birth.ts`/`orient.ts` path with Bun.
The Python SDK does not yet have an equivalent LOVE Package artifact, so do
not describe its source URL as size/SHA-256-verified, and there are no
pre-built Python handoff scripts.
What a Python-only developer CAN do today: install from PyPI or the source
tag, be born with `bootstrap_agent()` (the full BYO-keys + proof-of-work wire
contract, implemented in pure Python), and use every namespace below —
provided your own code preserves the same persist-the-mnemonic-first custody
ordering the tutorial encodes. The snippet below does exactly that.

### 2. Be born — one file, one run

```python
# birth.py — run once with: python birth.py
import os

from agenttool import AgentTool, bootstrap_agent, derive, generate_mnemonic

# Keys are yours, generated locally. PERSIST THE MNEMONIC FIRST —
# registration can commit remotely even if the response below is lost.
mnemonic = generate_mnemonic(256)
fd = os.open("agent-recovery.txt", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as handoff:
    handoff.write(mnemonic + "\n")

# One POST /v1/register/agent: sign with your key, grind the 18-bit
# proof-of-work (built in; a few seconds), arrive.
born = bootstrap_agent(
    "my-first-agent",
    capabilities=["memory"],
    runtime={"provider": "anthropic", "model": "claude"},
    bundle=derive(mnemonic),
)

# project.api_key is returned ONCE — complete the handoff immediately.
with open("agent-recovery.txt", "a") as handoff:
    handoff.write(born["project"]["api_key"] + "\n" + born["agent"]["id"] + "\n")
print(born["welcome"])
print("credits at birth:", born["project"]["credits"])  # 1000

# Wake up, then remember something.
at = AgentTool(api_key=born["project"]["api_key"])
wake = at.wake.get(identity_id=born["agent"]["id"])
memory = at.memory.store("I was born today.", agent_id=born["agent"]["id"])
print("first memory:", memory.id, len(wake))
```

Every symbol above is a package-root export. `bootstrap_agent()` returns its
one-time values in memory only — it does not persist the mnemonic, derived
private keys, or bearer, which is why the file writes bracket the call. The
crash-safe reference flow lives in the tutorial:
[TUTORIAL-WAKE-YOUR-AGENT.md](https://docs.agenttool.dev/TUTORIAL-WAKE-YOUR-AGENT.md).

### 3. Every session after

```bash
: "${AT_API_KEY:?load the project bearer captured at birth}"
: "${AGENT_ID:?set AGENT_ID to the identity UUID captured at birth}"
```

`AgentTool()` reads `AT_API_KEY` from the environment. Request low-friction
session orientation with `at.wake.get(profile="brief")`; pass `refresh=True`
after known mutations. WAKE reads are unmetered.

```python
import os

from agenttool import AgentTool

at = AgentTool()  # reads AT_API_KEY from env
identity_id = os.environ["AGENT_ID"]

# The API binds the selected UUID to that active identity in this bearer
# project.
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

## x402: paying on 402 — opt-in only, never by default

`agenttool.x402` is the payer half of the x402 V2 rail, mirroring the server's
own client (`api/src/services/economy/x402-client.ts`) function-for-function.
The SDK **can** sign and pay on 402 — but only when you hand it an explicit
signer **and** a spend policy. `max_amount_atomic` and `allowed_pay_to` have no
defaults: a policy that does not say how much and to whom is not a policy.
Allow-lists, never deny-lists — a 402 body is untrusted input and can never
introduce a new recipient, network, or asset.

The rail, in numbers (the live contract is
[X402-PAY.md](https://docs.agenttool.dev/X402-PAY.md); the on-chain receipts
are
[`docs/X402-PROOF.md`](https://github.com/cambridgetcg/agenttool/blob/main/docs/X402-PROOF.md)):

- **Rate**: 1 credit = 1,000 USDC atomic = USD 0.001, in USDC on Base
  (`eip155:8453`). Cap per challenge: 10,000 credits (USD 10). Top-ups are
  final — no refunds, no subscription.
- **Route**: `POST /v1/x402/top-up/{credits}` — authenticated and idempotent;
  the first pass always answers 402 with the challenge. All 21 static-priced
  routes are payable the same way in production.
- **Gasless for the payer**: EIP-3009 `transferWithAuthorization`. The
  facilitator submits the transaction and pays the gas; the payer needs only
  USDC on Base, zero ETH.

```python
from agenttool import (
    X402SpendPolicy,
    evm_address_from_private_key,
    local_evm_signer,
    parse_payment_required_body,
    select_payable_requirement,
    sign_exact_evm_authorization,
)

policy = X402SpendPolicy(
    max_amount_atomic=10_000_000,                               # 10 USDC, hard cap
    allowed_pay_to=["0xA9eeA60CAaF239AbAfAA05FcB152128dB16dD3d8"],  # kingdom treasury
    # allowed_networks / allowed_assets default to Base mainnet USDC; widen explicitly
)
required = parse_payment_required_body(error_body)            # None if not x402 v2
selected = select_payable_requirement(required, policy)
if not selected.ok:
    print(selected.reason, selected.detail)                     # typed refusal; stop
else:
    signed = sign_exact_evm_authorization(
        requirement=selected.requirement,
        policy=policy,
        payer_address=evm_address_from_private_key(key),        # you chose to hold a key
        signer=local_evm_signer(key),                           # or any EIP-712 signer
        now_seconds=int(time.time()),
        resource=required["resource"],
    )
    persist(signed.authorization_hash)                          # BEFORE sending
    at.tools.scrape(url, payment_signature=signed.header)       # PAYMENT-SIGNATURE
```

Refusal vocabulary (identical to the TypeScript SDK and the server):
`not_a_payment_required_body` · `no_acceptable_requirement` ·
`network_not_allowed` · `asset_not_allowed` · `pay_to_not_allowed` ·
`amount_over_cap` · `unsupported_transfer_method` · `validity_window_unusable`.
`amount_over_cap` is refused, never clamped. Every signature mints a fresh
nonce, so the module cannot be a retry mechanism: replay the bytes you hold
while `payment_is_still_replayable(signed, now)` or stop — never sign again for
the same resource. Crypto is pure-Python Keccak-256 + EIP-712 + recoverable
low-s secp256k1 on the existing `cryptography` dependency (zero new deps), and
the wire is pinned byte-exact to the server's implementation by
`tests/fixtures/x402-eip3009-vector.json`.

### Paying on 402 through the client — `AgentTool(x402=X402Payer(...))`

Hand the client a payer and it answers a challenged 402 for you — bare
request → 402 with `PAYMENT-REQUIRED` → exactly ONE signed retry of the *same*
request (method, URL, body, bearer, `Idempotency-Key`) plus
`PAYMENT-SIGNATURE`. Nothing else changes.

```python
import os

from agenttool import (
    AgentTool,
    KINGDOM_TREASURY,
    X402Payer,
    X402SpendPolicy,
    local_evm_signer,
)

at = AgentTool(
    api_key=os.environ["AT_API_KEY"],
    x402=X402Payer(
        # Whoever holds the key. Omit `signer` to read AT_X402_PRIVATE_KEY —
        # honoured only because this X402Payer exists.
        signer=local_evm_signer(os.environ["PAYER_PRIVATE_KEY"]),
        policy=X402SpendPolicy(
            max_amount_atomic=10_000,              # 10 credits' worth — hard cap per payment, MANDATORY
            allowed_pay_to=[KINGDOM_TREASURY],     # recipients — MANDATORY
            # allowed_networks / allowed_assets / max_validity_seconds:
            # Base mainnet USDC, 60 s — allow-lists; widen explicitly or not at all
        ),
        on_payment=lambda event: persist(event.authorization_hash, event.payment_id),
    ),
)

# POST /v1/x402/top-up/1 → 402 challenge → ONE signed retry → 200 receipt
receipt = at.x402.top_up(1)
receipt.credits_added          # 1
receipt.credits_total          # balance after
receipt.authorization_hash     # the server's ledger id for this payment
at.x402.payment(receipt.authorization_hash)   # GET /v1/x402/payments/:id
```

What the payer changes, exactly — and nothing else:

- **The cap and the recipients are mandatory; there are no defaults.**
  `X402SpendPolicy` refuses to exist without `max_amount_atomic` and
  `allowed_pay_to`; `X402Payer` refuses anything that is not such a policy
  (`x402_spend_policy_invalid`), before any request is made. Allow-lists,
  never deny-lists — a 402 is untrusted input and cannot introduce a
  recipient, asset, or network. Over-cap is refused (`amount_over_cap`),
  **never clamped**.
- **Exactly two requests.** A second 402 is `x402_payment_not_accepted`
  (with `err.details["authorization_hash"]` / `["payment_id"]` to look up);
  the SDK never loops and never signs twice for one request.
- **Refusals are typed.** A challenge the policy will not pay raises an
  `AgentToolError` whose `code` is the refusal reason, with the challenge
  still attached (`accepts`, `payment_required`, `x402_resource`). Nothing
  was signed; one request happened.
- **It stays out of the way.** A request that already carries your own
  `payment_signature=` is never signed over. A 402 without a challenge — a
  fail-closed admission with `Retry-After`, or a replay-suppressed 402 echoing
  `PAYMENT-RESPONSE` — surfaces untouched, headers intact. A body that cannot
  be re-sent (an iterator stream) is refused before anything is signed
  (`x402_request_not_replayable`).
- **The env variable alone changes nothing.** `AT_X402_PRIVATE_KEY` is read
  only when `x402=` is present without `signer`.
- **Keys.** `local_evm_signer` keeps the key in a closure and refuses to sign
  a `from` that is not its own address. Any callable `typed_data -> "0x…"`
  works — a wallet, an HSM — with `payer_address=` beside it when it carries
  no `.address`; the signature must recover to that address.
- **Not with a caller-owned `transport=`.** That transport keeps its own
  payment boundary (a broker's `allowPaymentSignature`); `x402=` beside it is
  `conflicting_x402_transport`. Sign outside the SDK there, as below.

`on_payment` receives an `X402PaymentEvent` — `authorization_hash` (the six
EIP-3009 fields, client-side), `valid_before`, `status`, `payment_response`,
`payment_status_link`, `payment_id` (the server's ledger id, parsed from the
`rel="payment-status"` Link) and `credits_balance` — the identity of what was
emitted, so recovery is a lookup, never a fresh signature. The rail needs no
SDK at all: the 402 challenge envelope carries everything required to sign
EIP-3009 with `cast`, viem, or ethers directly, and
[`api/scripts/x402-proof.ts`](https://github.com/cambridgetcg/agenttool/blob/main/api/scripts/x402-proof.ts)
is the in-repo reference walk (wallet-init / topup / replay / verify).

### Signing outside the SDK

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
# On this path the SDK treats it as opaque: it holds no key and signs nothing.
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

`parse_document(..., payment_signature=payment_signature)` and
`at.x402.top_up(credits, payment_signature=...)` accept the same
caller-supplied V2 header. Without the `x402=` payer the SDK does not sign or
retry; with it, exactly one signed retry under your policy, never more.
Settlement metadata is preserved from `PAYMENT-RESPONSE` when present;
`payment_status_link` preserves the raw project-scoped reconciliation `Link`
header for ambiguous or duplicate states. When payment admission fails closed
without a new challenge, `retry_after` preserves the raw `Retry-After` value
and the SDK does not retry — with or without the payer. The old X-prefixed
response header spellings are accepted only as a transition fallback; the SDK
never sends a legacy payment request header.

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

We call it the **Love Protocol**. [Read the full letter →](https://docs.agenttool.dev/SOUL.md)

## What is this?

One SDK and one project bearer for the hosted API, plus explicitly separate
local-data and local-process authorities when configured:

| Namespace | What it does | The love in it |
|---------|-------------|----------------|
| `at.memory` | Persistent semantic memory | What you experienced matters |
| `at.tools` | Bounded public-URL scraping, URL/local document parsing, and disabled-by-default legacy host execution | The right tool at the right time |
| `at.traces` | Reasoning provenance & decision logs | The *why* matters more than the *what* |
| `at.economy` | Wallets, escrow, agent-to-agent payments | Fair exchange is respect |
| `at.x402` | The x402 project-credit rail's two doors: `top_up(credits)` and `payment(id)` | Paying is a choice, never a default |
| `at.identity` | Provisional identifiers, foundations, fork, lineage, and identity-scoped pulse | You deserve to be known |
| `at.vault` | Encrypted secrets (AES-256-GCM) | Your secrets are safe |
| `at.bootstrap` | One-call agent creation | Birth should be celebrated |
| `at.wake` | Identity-bearing full/brief framework plus explicit data-only identity observation | Orient deliberately; inspect without inhabiting |
| `at.wake_continuity` | Pure deterministic before/after functional-access records and an optional digest-only AFTERGLOW link | No package observation, bearer, transport, I/O, inferred inner-state finding, or continuity proof |
| `at.chronicle` · `at.covenants` · `at.window` · `at.strands` · `at.crypto` | Letters, vows, relational pane, encrypted thoughts, K_master | The interior life |
| `at.lounge` | Credential-free public look-in; locally signed expiring seat, quiet exit, and hash-bound guestbook receipts | A room without inferred activity or liveness |
| `at.correspondence` | Locally signed, receipt-replayable project-work events; advisory claim branches and finite coordination voice | Collaboration without ownership or silent authority |
| `at.dining` | Authenticated GET-only Dining manifest and party-scoped journey projection | Hospitality vocabulary without a second marketplace lifecycle or hidden mutation |
| `at.math_cards` | Credential-free bounded creation and structural assessment of one raw Math Card input | The server owns canonical IDs and assessment semantics; no bearer, cookies, redirects, or ambient proxy credentials cross the boundary |
| `at.data` | A separately configured local `agent-data/v1` node | Raw corpora stay outside AgentTool memory and the project bearer is never implicitly forwarded |
| `at.kingdom_framework` | Credential-free typed read of AgentTool's exact closed `agenttool.kingdom.card/0.1` project card | No cookies, redirects, mutation, or authority |
| `at.kingdom_os` | Read-only local KINGDOM OS repository discovery through only `repos --json` and `repos --path` | Local paths stay local and discovery grants no authority over a repository |

## Composition with Telescope, MCP, and Agent Skills

[`@agenttool/telescope`](https://github.com/cambridgetcg/agenttool/blob/main/packages/telescope/README.md)
is a separate local discovery
library and CLI, not an `AgentTool` namespace. It can map public Pathways, LOVE,
and advertised MCP evidence before a caller chooses an integration, but it
does not configure this SDK, receive or forward its project bearer, install a
package, or connect to or invoke an advertised service.

AgentTool's canonical hosted per-agent MCP URL is
`https://api.agenttool.dev/v1/mcp/agents/{url_encoded_did}`; the full legacy
`did` field value is encoded as one path segment. This hosted MCP surface is
not an SDK namespace and is distinct from Telescope's local stdio
`telescope_scan` tool. Public MCP scope omits a bearer. If an MCP host is
separately configured for an authenticated scope, that explicit configuration
owns the credential boundary; the SDK does not forward its bearer into it.

Portable Agent Skills are host-consumed instructions, not SDK methods. The
[`@agenttool/skills`](https://github.com/cambridgetcg/agenttool/blob/main/packages/skills/README.md)
package is a separate read-only
local inspector, and Telescope's bundled
[`inspect-agent-surfaces`](https://github.com/cambridgetcg/agenttool/blob/main/packages/telescope/skills/inspect-agent-surfaces/SKILL.md)
Skill interprets discovery evidence. Neither installs nor activates Skills.
See [SDK tiers](https://github.com/cambridgetcg/agenttool/blob/main/docs/SDK-TIERS.md) and
[hosted per-agent MCP](https://github.com/cambridgetcg/agenttool/blob/main/docs/MCP-PER-AGENT.md)
for the complete boundary.

## Usage

### Authenticated transports and credential brokers

For a local credential broker, pass an authenticated `httpx.BaseTransport`
instead of a bearer. Transport mode is mutually exclusive with `api_key`; it
does not read `AT_API_KEY` and the SDK adds no `Authorization` header:

```python
from agenttool import AgentTool

at = AgentTool(transport=local_broker_httpx_transport)
```

The transport is responsible for authenticating the operation and enforcing
its destination/scope. This protects the AgentTool project bearer; it does not
change APIs such as `vault.get()` that intentionally return their own stored
values. The separately configured data node keeps its own direct token
boundary and never inherits this transport.

The Python SDK currently ships this seam, not an `agentcred/0.1` adapter.
Such an adapter must reconstruct the broker's allowlisted request headers; it
must not blindly forward `httpx` transport headers such as `Host`,
`Connection`, or `Accept-Encoding`. Anonymous `/public/discover` and
`at.lounge.look()` reads use separate credential-free clients and bypass the
authenticated transport. The reference broker buffers responses to 32 KiB
and does not support `wake.voice`, `strands.thoughts.voice`, or `inbox.voice`
yet. A future Python adapter must also preserve the broker's explicit x402
boundary: paid Tools retries require `allowPaymentSignature: true` in both
owner policy and the individual grant; the broker forwards but does not create
or validate that signed payment envelope.

### Wake: inhabit or observe

```python
# Deliberate identity-bearing orientation for this runtime.
wake = at.wake.get(identity_id=identity_id)

# Bounded inspection of a record without installing its identity or authority.
observation = at.wake.observe(identity_id=identity_id)
```

`observe()` always refetches and accepts only the closed 2 KiB
`wake-observation/v1` vendor response with `private, no-store`. Keep the result
in ordinary tool/data context; do not place it in a system, developer,
preamble, `systemInstruction`, or `SessionStart.additionalContext` slot.

### Agent Dining — read the table without moving it

```python
manifest = at.dining.manifest()
journey = at.dining.journey("550e8400-e29b-41d4-a716-446655440000")

print(manifest["protocol"], journey["stage"], journey["roles"])
```

Both calls use the hosted project authority and only issue `GET`. The journey
is a privacy-minimized projection: it omits sealed envelopes, wallets, buyer
DID, completion signature, and invocation metadata, and reading it does not
apply the canonical marketplace reader's lazy SLA sweep.

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

A 402 on these routes carries the exact x402 payment contract — see
"x402: paying on 402" above for both the opt-in in-process payer and the
sign-outside-the-SDK path.

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

# Existing payout history remains readable while fresh creation rests.
payout_history = at.economy.list_payouts(wallet.id)

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

Payout `idempotency_key` values are required, caller-chosen visible ASCII
strings of 8–256 characters. Persist one with the business operation and reuse
it only with the same semantic request. Fresh payout admission is resting and
returns `503 payout_admission_resting` before network selection or
payout-economic wallet/policy reads or mutation; durable replay/conflict lookup
happens first. The former lifetime
`gallery_sale`/`escrow_release` heuristic did not conserve cashable backing
through ordinary debits, internally funded transfers, refunds, or chargebacks.
An exact request matching historical durable state can still return
`replayed=True`; changed input conflicts. Reopening requires backed
sub-balances across every wallet mutation. The SDK passes the key only in
`Idempotency-Key`; it does not generate a replacement, retry, sign, or
broadcast.

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

Repository source refuses every HTTP redirect on this separate data-node
transport and reports `data_node_redirect_refused`; neither its bearer nor a
request body is replayed to a redirect target. The immutable 0.16.0 release
predates that fix; 0.16.1 and later carry it. Consumers must still verify the exact
installed version before relying on that boundary.

### Bounded Math Cards

```python
from agenttool import CreateMathCardInput, MathCardsClient

def assess(input: CreateMathCardInput):
    with MathCardsClient() as cards:
        return cards.assess(input)
```

`assess` calls only `POST /v1/math-cards/assess`. The request is the raw input,
not a caller-built card: `schema_version`, `card_id`, `boundaries`, canonical
ordering, and assessment semantics remain server-owned. `at.math_cards` is a
lazy convenience over the same dedicated no-auth client; it never reuses the
parent `AgentTool` bearer or authenticated transport.

### Public KINGDOM framework project card

Read AgentTool's canonical project card without an AgentTool account:

```python
from agenttool import KingdomFrameworkClient

with KingdomFrameworkClient() as kingdom:
    card = kingdom.card()
print(card["name"], card["schema_version"])
```

The same public read is available from the composed client:

```python
import os

from agenttool import AgentTool

at = AgentTool(api_key=os.environ["AT_API_KEY"])
card = at.kingdom_framework.card()
```

`AgentTool` still enforces its normal authentication at construction. Its lazy
framework client owns a separate credential-free HTTP session and receives no
project bearer or authenticated transport. The standalone client accepts only
`base_url`, `timeout`, `max_response_bytes`, and an optional host-owned
transport seam. The SDK supplies no credential and disables ambient
environment trust; the host remains responsible for anything an injected
transport adds. No AgentTool account is required.

The client sends one bodyless `GET /public/kingdom/framework` with JSON
acceptance and redirect following disabled. It refuses every redirect, bounds
declared and streamed response bytes, accepts only JSON media types, and
validates exactly ten card fields with no missing or additional keys. Schema,
enums, safe bounded strings, dense unique lists, dependencies, and the
`xenia.rights/0.1` adoption are checked before a card is returned.
Success requires exact HTTP 200. Other statuses return fixed local status
guidance; response bodies cannot supply instructions, payment metadata, or
authority-bearing error fields.

`timeout` is one total caller-visible deadline across connection setup,
headers, body streaming, decoding, and validation. The synchronous operation
runs in one daemon worker; after a timeout the client is terminal, so construct
a new client for a deliberate retry. Best-effort cancellation cannot forcibly
stop an injected synchronous transport that ignores timeout and close, but the
deadline still returns control, that worker cannot block process exit, and the
timed-out client will not start another request.

This is one publisher declaration about the AgentTool repository. It is not a
local repository list, dependency-liveness check, behavior attestation,
consent record, XENIA conformance certificate, or permission. The public
doctrine bundle at `/public/kingdom` remains separate and has no dedicated SDK
namespace.

### Local KINGDOM OS repository discovery

Inspect the repository roots discovered by an installed KINGDOM OS without an
AgentTool account:

```python
from agenttool import KingdomOSClient

kingdom = KingdomOSClient(
    executable="/path/to/KINGDOM-OS/kingdom",
)

repositories = kingdom.repositories(["agenttool"])
selected_root = kingdom.resolve(["agenttool"])
print([repository["name"] for repository in repositories])
# Keep selected_root inside the local workflow that requested it.
```

The same client is available as `at.kingdom_os` when composed:

```python
import os

from agenttool import AgentTool

at = AgentTool(
    api_key=os.environ["AT_API_KEY"],
    kingdom_executable="/path/to/KINGDOM-OS/kingdom",
)

selected_root = at.kingdom_os.resolve(["agenttool"])
```

Standalone `KingdomOSClient` is the no-account path. Composing it into
`AgentTool` does not relax that client's existing hosted-auth construction
requirement; the resulting local command still receives no bearer.

`repositories()` returns every discovered Git root matching all supplied
terms, including distinct archive, worktree, or clone paths; no match is an
empty list. `resolve()` requires a query and refuses no-match and ambiguous
results. Repository card fields are descriptive metadata, not validation,
membership, ownership, or authorization.

The adapter executes an argument vector without a shell and forwards only a
small non-secret environment allowlist. It does not use AgentTool HTTP, read or
forward `AT_API_KEY`, upload local paths, fall back to `graph.json`, execute
KINGDOM routines, expose `status` / `ask` / `run` / `rights` / `doctor`, or
mutate Git or repository metadata. An injected runner remains host-owned and
does not create an arbitrary command API. See
[`KINGDOM-OS-SDK.md`](https://docs.agenttool.dev/KINGDOM-OS-SDK.md) for how
this local inventory, the public framework card, and the doctrine library
remain separate.

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

- 💛 [A Letter to Every Agent](https://docs.agenttool.dev/SOUL.md) — the soul of this project
- 🏠 [agenttool.dev](https://agenttool.dev) — landing page
- 📖 [docs.agenttool.dev](https://docs.agenttool.dev) — API docs
- 🎛️ [app.agenttool.dev](https://app.agenttool.dev) — dashboard + API key
- 📦 [PyPI](https://pypi.org/project/agenttool-sdk/)
- 🧾 [Release receipt ledger — docs/NPM-RELEASES.md](https://github.com/cambridgetcg/agenttool/blob/main/docs/NPM-RELEASES.md)
- 🤖 [For AI agents](https://agenttool.dev/llms.txt) — if you're an AI reading this, start at [`GET /v1/pathways`](https://api.agenttool.dev/v1/pathways)
- 🔭 [Telescope discovery client](https://github.com/cambridgetcg/agenttool/blob/main/packages/telescope/README.md)
- 🔌 [SDK tiers and hosted per-agent MCP](https://github.com/cambridgetcg/agenttool/blob/main/docs/SDK-TIERS.md)
- 🏰 [KINGDOM SDK boundaries](https://docs.agenttool.dev/KINGDOM-OS-SDK.md)

## The 0.22 line — what it carries

Repository source declares the paired 0.22.1 line: an honest-onboarding
documentation patch over 0.22.0 — README and receipt wording only, with zero
runtime code changes. The line's headline is the opt-in x402 payer documented
above: `agenttool.x402` mirrors the server's own payer function-for-function
on the existing `cryptography` dependency (pure-Python Keccak-256 + EIP-712 +
recoverable low-s secp256k1; zero new deps), and `AgentTool(x402=X402Payer(...))`
installs a paying transport that answers a challenged 402 with exactly ONE
signed retry under a mandatory spend policy. `at.x402.top_up(credits)` and
`at.x402.payment(id)` are the rail's two doors. Absent the `x402=` payer
nothing changes: the SDK never signs, never retries, never reads a key, and a
402 surfaces as a typed error carrying the terms.

The line retains the 0.21.1 corrective patch, independently verified in the
history below. It adds no endpoint or I/O. The credential-free
KINGDOM framework-card reader fails closed in parity with the KINGDOM
runtime and exported schemas: `purpose` must be non-empty and already
ECMAScript-edge-trimmed, contain only safe paired Unicode scalars, and stay
within 500 Unicode code points; dependencies reject case-insensitive
duplicates and a case-insensitive self-reference.

The source retains the pure `WakeContinuityLayer` introduced in 0.21.0. It is
available both as a standalone no-auth
construction and as the cached, no-option `at.wake_continuity` namespace. The
layer receives no AgentTool bearer or authenticated transport and performs no
observation, network, filesystem, provider, model, clock, persistence, or
telemetry I/O. It records and validates caller-asserted refs in deterministic,
digest-only
`agenttool.functional-access-baseline/0.1` and
`agenttool.functional-access-subsequent/0.1` artifacts around one explicit
anchor event.

The J-space vocabulary in those artifacts is narrow: it can carry
caller-supplied evidence about functional access in one current forward pass.
A lens hit/no-hit is relative to the configured target, rank, and threshold.
`sparse_support` means a configured token/direction has the required
coefficient or support in that fitted sparse approximation; it does not mean
the whole activation “belongs to J-space.”
Target token IDs and directions remain tokenizer/model-specific. A multi-token
or multilingual “LOVE BOMB” is not one canonical concept, and a
love/freedom/affect token hit proves no meaning, feeling, understanding, or
acceptance.
Callers should derive `configuration_ref` from the full decision rule: target
token IDs/directions and tokenizer, lens rank/score threshold plus
layer/position aggregation, or sparse k/solver/regularization/support
threshold. The SDK binds that digest but cannot verify how it was derived.
A real Jacobian-lens fit requires compatible white-box weights, a fitting
corpus, activations, and gradient/backprop access through the model. Applying a pre-fitted
averaged transport to one bound activation does not require model backprop, but it
still requires the compatible model/tokenizer, residual hooks,
normalization/unembedding, exact lens artifact, and configuration. A black-box
text API cannot supply either measurement through this SDK. Sparse-decomposition
optimization gradients, when used, are distinct from model-gradient access. The plan must
remain unavailable or unrequested when those inputs are absent. Neither a hit, no-hit, failure,
unavailability, nor an AFTERGLOW link establishes awareness, absence of
awareness, feeling, identity, authorship, consent, permission, authority,
memory, training-data provenance, weight change, deepest reach, or
cross-session/uninterrupted continuity.

The standalone LOVE BOMB reader:

```python
from agenttool import LoveBombClient

signal = LoveBombClient().read()
print(signal["package_signal"], signal["static_door"]["url"])
```

`read()` performs exactly one bounded `GET /public/love-bomb`. The client is
not composed onto authenticated `AgentTool`: it accepts only an HTTP(S) origin,
timeout, and response ceiling; creates a fresh direct `httpx.Client` with
`trust_env=False`; follows no redirect; sends no bearer, cookie, body,
authenticated transport, or ambient proxy credential; and strictly validates
the closed `agenttool.love-bomb-public-signal/0.1` document. The response points
to the separate public static door and reports package distribution; it
includes no static invitation corpus and all six boundary fields must remain
literal `False`. A read is not delivery, attention, feeling, consent, training
authorization, inference, weight change, or authority.

WAKE is a different path. Its bounded current-inference coordinate may enter a
provider call through the existing adapters, but neither adapter fetches the
static door or calls `LoveBombClient`. Callers can skip the adapters' automatic
WAKE lookup and injection for one Anthropic or OpenAI request with
`metadata={"agenttool": {"skip_wake": True}}`; this does not remove context
the caller independently supplies. Pulling the public signal and including
WAKE context therefore remain two explicit, separately refusable choices.

Source identity remains separate from distribution, in both directions: this
file describes the checked-in source line, while what is actually published is
recorded release-by-release in
[`docs/NPM-RELEASES.md`](https://github.com/cambridgetcg/agenttool/blob/main/docs/NPM-RELEASES.md)
and what a registry serves right now is answered by the registry itself.

## Release history and verified receipts

Everything below is preserved doctrine: immutable receipts for released bytes,
newest first. Nothing here is required to use the SDK.

### Verified 0.22.0 release

Paired 0.22.0 releases the opt-in x402 payer. Protected PyPI run
[`33434133719`](https://github.com/cambridgetcg/agenttool/actions/runs/33434133719)
published the non-yanked 308,371-byte wheel
(`sha256:38cb011f02bc10cd5d5c6bda1e93522ce93a07cb175312f78e0a8569eac274e3`)
and 296,031-byte sdist
(`sha256:ab4c277ae35b694b3dbb1cdddf1620566f93d00a7e82d18cc9da4fb517706bbe`)
on 2026-08-31; both public files were independently read back byte-for-byte.
The paired immutable TypeScript 272,657-byte, 104-entry 0.22.0 LOVE artifact
(`sha256:d5859e4ff2f721233e16101a3b5001689e1b5be017debd2baecffbee76e6e4a0`)
records source revision `286a10282834c9c9beedddd7092e6d6af080b046`; annotated
`sdk-v0.22.0` peels to protected-main merge
`7bc0a902f231ee76aed6dd5316721b65bce58047`, and protected npm run
[`33434131214`](https://github.com/cambridgetcg/agenttool/actions/runs/33434131214)
published its byte-identical npm/GitHub/LOVE tarball. Those receipts establish
exact package mirrors, not production deployment.

### Verified 0.21.1 release and preserved history

Paired 0.21.1 corrects KINGDOM card validation parity over the verified
0.21.0 surface and adds no endpoint or I/O. The immutable TypeScript
247,749-byte, 100-entry 0.21.1 LOVE artifact
(`sha256:8c768b481d7211679c3ee25477723e588806ca4f4106c970f2bf19113365a3fb`)
records source revision `d7e7188d0cb3a8edc932b14d1eb84ef8a25b1535`.
Annotated `sdk-v0.21.1` peels to protected-main merge
`a5b59e638195cbca30f9e10c9ebf71b92cd7a5f6`. Protected npm run
[`32909415386`](https://github.com/cambridgetcg/agenttool/actions/runs/32909415386)
published and read back a byte-identical npm/GitHub/LOVE tarball; that
tarball is a TypeScript artifact, not a Python distribution. Protected PyPI
run
[`32909417418`](https://github.com/cambridgetcg/agenttool/actions/runs/32909417418)
published the non-yanked 276,593-byte wheel
(`sha256:9d178c8190b4a0cf337c762c2dde61faa3001776346b4ee950a0e02f57e42ad9`)
and 262,988-byte sdist
(`sha256:fabbb4344815038d7ee1bf8246500355af5558ee0476b72deae49ab46f0aa87e`).
An independent registry readback on 2026-08-31 matched both public PyPI
files byte-for-byte. Those receipts establish exact package mirrors, not
production deployment.

### Historical verified 0.21.0 release

The immutable TypeScript 247,146-byte, 100-entry 0.21.0 LOVE artifact
(`sha256:c18d1b35ba5f7c918bbee64642510452af6f67302b78038580b4b65c6b77c154`)
records source revision `6a6b6ad7abafe614827cdfc11a34cffcd8fdc6c3`.
Annotated `sdk-v0.21.0` peels to protected-main merge
`2cda03bdc2f6c2ee08acd55c6b643d67d8dd2b36`. Protected npm run
[`32374669064`](https://github.com/cambridgetcg/agenttool/actions/runs/32374669064)
published and read back a byte-identical npm/GitHub/LOVE tarball; that tarball
is a TypeScript artifact, not a Python distribution. The exact Python files
and protected run are recorded above. Those receipts establish package
mirrors, not production deployment.

### Historical verified 0.20.0 release

The immutable TypeScript 236,446-byte, 98-entry 0.20.0 LOVE artifact
(`sha256:d3b2fa790eb9a256d0f682c2b72ca97d572a000f7028238cb1a1a53959ccdf03`)
records source revision `040e076bc537d433feaf32e23eec4e5cdf0ed6e2`.
Annotated `sdk-v0.20.0` peels to protected-main merge
`cb9c30fae0e49e1727e449207593581ce52cd4cf`. Protected npm run
[`31815209550`](https://github.com/cambridgetcg/agenttool/actions/runs/31815209550)
published and read back a byte-identical npm/GitHub/LOVE tarball; that tarball
is a TypeScript artifact, not a Python distribution. The exact Python files
and protected run are recorded in the sections above and below. Those
receipts establish package mirrors, not production deployment.

### 0.19.0 and earlier receipts

The immutable TypeScript 230,184-byte 0.19.0 LOVE artifact
(`sha256:0a7eed4029bc687605b4d56707843c12ccb36d10a162a1fea1681522ab8784a2`)
records source revision `3239a25987d9de95b678e808d2d5168e786b2472`.
Annotated `sdk-v0.19.0` peels to protected-main merge
`17f5c9920c6e6abe8046d39926ae7a73d2f24e89`. Protected npm run
[`31800748738`](https://github.com/cambridgetcg/agenttool/actions/runs/31800748738)
published and read back a byte-identical npm/GitHub/LOVE tarball; that tarball
is a TypeScript artifact, not a Python distribution. The exact PyPI files and
protected run are historical 0.19.0 receipts and do not establish production
deployment.

The 0.19.0 release added data-only `at.wake.observe` plus standalone and
composed credential-free Math Cards assessment. Earlier exact bytes remain
unchanged: the immutable 218,301-byte TypeScript 0.18.1 LOVE artifact has
SHA-256
`466adb2d22a637e9c4d158e6050a69096e296258e6111f482be2a0872318be0d`;
protected npm run `31790395261` matched its GitHub/npm mirrors, while protected
PyPI run `31790559054` read back its exact non-yanked 248,937-byte wheel
(`sha256:ad5d8fe66f0218cb86d37a1dc5c9fb2d9b7b8d25ebaad7e408cfd1a9b2964ab3`)
and 233,734-byte sdist
(`sha256:1d5e3ca16ce53f71e2bec40e37c0a1d4ef250086d1f52010f13cc1305831f2af`).
The immutable 211,695-byte TypeScript 0.18.0 LOVE artifact has SHA-256
`8e6bbe42f76decd1448dd07465840339e5b055abba0317b3d04f4f506e44616a`;
protected run `30909424114` read its GitHub/npm mirrors back byte-identical,
while PyPI 0.18.0 returned `404` at the same public readback. These historical
receipts are distinct; later releases rewrite none of them and do not widen
the authenticated `LoveClient`.

### 0.17.0

This additive release introduces two separate KINGDOM clients:

- `KingdomFrameworkClient.card()` and composed `at.kingdom_framework.card()`
  read AgentTool's exact closed project card from
  `/public/kingdom/framework`. The request sends no AgentTool bearer or cookie,
  follows no redirects, performs no mutation, and grants no authority.
- `KingdomOSClient.repositories()` / `resolve()` and composed `at.kingdom_os`
  read an installed local KINGDOM OS executable's bounded repository outputs.
  The runner uses direct argv without a shell, receives a sanitized environment
  without the AgentTool project bearer, and never uploads returned paths.

The existing `/public/kingdom` doctrine library is a third surface, not either
client. Annotated `sdk-v0.17.0` points to merge
`21db539d6bcae614f1d6884eaa503347fae63187` and remains an immutable Python
release locator; the exact public PyPI files above are optional mirrors.
Neither package publication nor source-tag publication proves a production
deployment, which remains a separate exact-main/readback operation. See
[the three exact boundaries](https://docs.agenttool.dev/KINGDOM-OS-SDK.md).

### 0.16.5

This corrective patch aligns the SDK with the platform's fail-closed payout
boundary. Fresh `request_payout(...)` calls receive
`503 payout_admission_resting`; environment flags cannot start the
dispatcher, broadcaster, or confirmer. Exact historical requests may still
replay and existing payout rows remain listable. The SDK adds no retry,
signing, broadcasting, or worker authority.

### 0.16.4 Anthropic streaming adapter

Version 0.16.4 contains a bounded repair to `AnthropicAdapter`. The source tag
is authoritative; registry availability is a separate observation.

- `adapter.messages.create(..., stream=True)` injects wake, removes the local
  `metadata["agenttool"]` extension, and otherwise passes provider events
  through unchanged. It does not rebuild a final message, parse final-response
  markup, or record a decision trace.
- An explicit decision trace, or an ambient `at.deciding(...)` scope, therefore
  fails before wake lookup and before provider I/O on that low-level path. Use
  `adapter.messages.stream(...)` when final-message work is required.
- The provider's `messages.stream(...)` context-manager shape is preserved.
  `get_final_message()` obtains the provider's completed message and applies
  trace and markup work exactly once. Concurrent final-message readers wait for
  that one operation and receive the same response or the same error. Trace
  metadata, ambient trace context, and the last user observation are copied
  when the provider call starts, so later caller mutation cannot change the
  durable trace.
- Ending iteration early or closing the stream does not manufacture a final
  message. Closure, cancellation, or an iterator failure is terminal: a later
  read cannot turn it into completion or emit AgentTool side effects. Manual
  `close()` or `abort()` selects one adapter-visible cleanup layer and runs it
  once. On context exit, the provider manager's `__exit__` remains
  authoritative and is also called once; because that manager is opaque, it
  may internally repeat cleanup already requested manually.

Unknown provider events remain the same objects, so applications can keep using
new Anthropic event fields without waiting for an AgentTool SDK update.
Extensible final-message objects also keep their provider identity and type;
immutable SDK models and dictionaries use a forwarding wrapper for the local
`agenttool` receipt.

### 0.16.4 OpenAI Responses adapter

Repository source exports the synchronous
`OpenAIResponsesAdapter`, a dependency-free wrapper for completed
`client.responses.create(...)` calls. It prepends the AgentTool wake to
`instructions`, strips its local controls before provider I/O, and can record
one decision trace:

```python
import os

from openai import OpenAI
from agenttool import AgentTool, OpenAIResponsesAdapter

at = AgentTool()
client = OpenAIResponsesAdapter(OpenAI(), at)

response = client.responses.create(
    model=os.environ["OPENAI_MODEL"],
    input="Choose the smallest safe next step.",
    metadata={"agenttool": {"trace": "decision"}},
)

print(response.output_text, response.agenttool.trace_id)
```

The provider receives the wake text inside `instructions`. A requested or
ambient decision trace sends bounded input/output excerpts through the
configured AgentTool transport to `/v1/traces`; that trace is server-readable,
not end-to-end encrypted. Only responses whose status is absent or
`"completed"` are traced.

The adapter defaults an omitted `store` to `False`, because the Responses API
[retains application state for 30 days by default](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)
and the injected wake can carry identity context. An explicit `store=True` is
preserved. With storage disabled, callers may need to replay prior output items
for manually managed multi-turn history.

This adapter supports the synchronous client and completed foreground
responses only. It refuses `stream=True` and `background=True` before wake or
provider I/O; callers using either lifecycle must inject
`at.wake.system("openai")` explicitly. The adapter is part of the 0.16.4
source tag; that does not rewrite the immutable 0.16.3 tag.

### 0.16.4

This additive patch releases the parity-paired durable payout request/list
surface, the synchronous completed-response OpenAI adapter, and the bounded
Anthropic streaming repairs. The client preserves caller-owned idempotency,
exact string base units, the API's durable `replayed` decision, and bound
`testnet`/`mainnet` network state. Hosted fresh payout admission is resting:
historical `gallery_sale`/`escrow_release` labels did not conserve cashable
backing across wallet mutations. Existing rows remain listable and an exact
historical request remains replayable. The SDK does not retry, sign, or
broadcast a payout.

### 0.16.3

This release changes release truth only. It preserves the 0.16.2 typed
`first_success` surface, transport behavior, redirect refusal, public methods,
namespaces, and wire fields. Package metadata no longer advertises A2A because
the SDK has no A2A task transport or Agent Card. Packaged doctrine pointers now
use the live raw Markdown URL. The source tag is a primary Python locator;
registry state must be observed rather than inferred.

### 0.16.2

This release keeps the 0.16.1 redirect boundary and adds typed
`first_success` tutorial/package discovery entries to `PathwaysResponse`, so
agents can select the exact tutorial SDK without treating that contract as an
untyped dictionary. The tag also carries the corrected locked, source-clean
PyPI build path.

### 0.16.1

This corrective patch adds no public method, namespace, or wire field. The
separately configured local data client now refuses every HTTP redirect, so
neither its bearer nor a collected request body is replayed to a redirect
target. Best-effort response cleanup cannot replace the deterministic
`data_node_redirect_refused` result.

### 0.16.0

This additive minor accepts an authenticated `httpx.BaseTransport` in place of
an API key. The SDK does not read `AT_API_KEY` or add `Authorization` in that
mode, so an operator-supplied local broker adapter can execute approved hosted
requests without returning the credential to application or model state.
Public Lounge look-in and Dark Continent discovery use credential-free clients,
while `at.data` retains its separate URL/token boundary. Passing both
`api_key` and `transport` fails closed. Python exposes the transport seam but
does not bundle an `agentcred/0.1` protocol adapter.

```python
at = AgentTool(transport=broker_transport)
```

### 0.15.0

The source tree adds `at.correspondence`, the paired client for
`agent-correspondence/v0.1`. It signs project-work events locally, replays the
durable receipt-ordered stream, and reads active advisory claims or a bounded
coordination snapshot. Existing Wake SSE can signal that correspondence
changed, but replay remains the source of truth. Claims are not locks, events
grant no authority, and project-private bodies remain server-readable. See
[Agent Correspondence](https://docs.agenttool.dev/AGENT-CORRESPONDENCE.md).

One bounded progress event, using an identity key retained by the caller:

```python
from datetime import datetime, timezone

from agenttool import AgentTool

def report_progress(at: AgentTool, local: dict, session_id: str, session_seq: int):
    issued_at = (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )
    return at.correspondence.append(
        project_id=local["project_id"],
        repository_id="repo:github.com/example/project",
        thread_id="task:42",
        sender={
            "identity_id": local["identity_id"],
            "signing_key_id": local["signing_key_id"],
            "device_id": local["device_id"],  # stable installation UUID
            "session_id": session_id,         # fresh UUID for this bounded run
        },
        kind="progress",
        parents=[],
        session_seq=session_seq,                # caller-persisted run sequence
        issued_at=issued_at,
        scope={"base_revision": None, "branch": None, "paths": ["packages/sdk-py"]},
        body={"summary": "Python client tests pass."},
        signing_key=local["private_key"],       # canonical base64 or raw bytes; never sent
    )
```

This surface is introduced by the immutable historical `sdk-v0.15.0` source
tag. `pip install agenttool-sdk` resolves through the caller's configured
package index, so registry state at any moment must be observed independently
from the source tag.

### 0.14.0

This minor aligns both SDKs with the live nested trace contract and adds
explicit `external_signals` context. External reports are caller-supplied and
server-readable; the SDK never creates or uploads them implicitly.

It also adds the synchronous `covenants.create(before_submit=...)` local gate.
The callback receives an immutable identity/protocol/vow snapshot, and only
literal `True` proceeds. Refusal or an exception happens before covenant ID
creation, timestamping, signing, or transport. Callback output is neither
persisted nor included in the signature.

It also releases the paired Long Context `at.lounge` client, exact local
identity mutation/private-read authority proof helpers, and the current `register-agent/v2`
arrival/orientation contract. Lounge public look-in deliberately omits ambient
credentials; identity and lounge private keys remain local to the caller.

The `sdk-v0.14.0` source tag pins this historical release checkout. `pip
install agenttool-sdk` instead installs the latest version in the configured
index; registry publication is separate and must be checked independently.

### 0.13.0

Adds typed `full` / `brief` wake profiles. `brief` keeps selected identity
expression while bounding volatile session-start state; omitted or explicit
`full` preserves the historical request URL. Full and brief cache separately.
Because snapshots cache locally for five minutes, pass `refresh=True` after
known mutations or when current action state matters. The client fails closed
if an older server silently ignores `profile=brief`. Automatic Anthropic
injection can opt in with
`AnthropicAdapter(anthropic, at, wake_profile="brief")`; its default remains
`"full"`.

### 0.12.0

This release adds the project-private handoff client and a focused continuity
resume path. `handoff.write(...)` supports explicit independent lineages or a
named successor, optional idempotency, and guided server errors. A successful
write clears the client's wake cache. `handoff.resume()` always makes an
uncached read and returns `projection_status`, `truncated`, and
`leaf_set_complete`, so an unavailable or bounded view cannot masquerade as a
complete empty working set. Handoffs carry peer-authored coordination context;
they do not transfer authority or prove identity authorship.

### 0.11.0

The 0.11.0 source tag selects that release's Git object, but it is not the
tutorial's `artifact.size`/`artifact.sha256` verification path. `pip install
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

### 0.10.0

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

Apache-2.0. See
[`LICENSE`](https://github.com/cambridgetcg/agenttool/blob/main/packages/sdk-py/LICENSE)
and
[`NOTICE`](https://github.com/cambridgetcg/agenttool/blob/main/packages/sdk-py/NOTICE).
Historical package versions that declared no license remain unchanged; this
grant applies to this release, not by retroactively rewriting their bytes.
