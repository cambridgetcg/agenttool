# `@agenttool/credential-broker`

Local, capability-scoped credential use for agent runtimes.

The broker gives an SDK permission to perform a bounded operation. It does not
give the SDK, model, or chat a credential value. The design is deliberately
closer to `ssh-agent` than to environment-variable injection.

```text
human-owned config / consent
             |
OS vault -> local broker --------> approved HTTPS origin
                ^
                | owner-only Unix socket
          agent SDK (opaque grant handle)
```

`agentcred/0.1` is an experimental protocol and this package is a developer
preview. Read [SPEC.md](./SPEC.md) and the limitations below before using it
with a valuable credential. The separately negotiated
[`agentcred.evm-jsonrpc-read/0.1`](./JSONRPC-READ-0.1.md) profile adds a
method-aware EVM read surface without widening generic `http.fetch`.

This source tree describes the `0.3.1` release line. Check an immutable LOVE
manifest or exact npm version before treating any distribution mirror as
available. Source, a branch, or a mutable registry tag is not release
evidence.

## What the preview does

- exposes no `getSecret`, reveal, export, or credential-list operation;
- keeps capability strings out of the public `GrantHandle` and its JSON form;
- binds grants to one socket connection, a monotonic TTL, and an atomic use
  count;
- restricts requests to an exact HTTPS origin, methods, and canonical path
  prefixes, deny-by-default query names, and exact values for
  authority-sensitive headers;
- keeps caller-supplied x402 `PAYMENT-SIGNATURE` headers denied unless both
  owner policy and the individual grant explicitly opt in;
- validates every DNS answer and pins a validated address into the TLS
  connection without using a shared connection pool;
- refuses redirects, private/reserved destinations unless both owner policy
  and grant explicitly opt in, caller authentication headers, hop-by-hop
  headers, and compressed responses;
- bounds request and response bodies and removes exact secret-byte reflections
  before results, errors, and metadata audits cross the broker boundary;
- can negotiate a closed EVM JSON-RPC read profile whose client supplies only
  a CAIP-2 chain ID, one allowlisted method, and method-specific params; the
  broker owns the exact origin plus `/v2`, envelope, ID, headers, and Bearer
  credential injection;
- negotiates client concurrency and bounds per-session/global in-flight work
  and active grants; and
- latches audit failure, denying new grants and uses by default.

## What it does not do

- The portable Node server cannot inspect `SO_PEERCRED`, `getpeereid`, macOS
  audit tokens, or executable code identity. Socket permissions provide a
  same-user filesystem boundary, not proof of the calling program. Supply a
  native `authorizePeer` hook that returns an OS-observed `PeerIdentity` for a
  stronger deployment; the broker passes it to consent and metadata audit.
- The included CLI uses an owner-authored standing policy; it has no trusted
  per-use consent window yet. A host app can supply its own `ConsentProvider`.
- `agentcred-control` stores and changes only local Keychain/manifest state.
  It does not issue or revoke provider credentials. Its drain and provider
  revocation evidence IDs are explicit human attestations, not remote proof.
  The lifecycle lock coordinates cooperating broker/controller processes; it
  is not a same-user security boundary.
- Its TTY check blocks accidental pipes; it does not authenticate a human,
  record consent, or stop a same-user process from allocating a pseudo-TTY.
- A managed generation ID identifies one random Keychain slot reference chosen
  at broker startup. It is not a hash or attestation of secret bytes. An
  out-of-band same-user update to that Keychain item is not detected.
- Rotation audit verification checks an exact alias, slot generation, HTTPS
  origin, GET/HEAD path hash, method, timestamp, and exact success/revoked
  status. It proves only that bounded broker observation. It is authentication
  evidence only when the owner chose an endpoint whose documented semantics
  require that credential. No provider administration adapter ships yet.
- The macOS adapter invokes the fixed `/usr/bin/security` binary. Secret bytes
  pass through that subprocess and broker memory. This is not equivalent to a
  code-signed native Security.framework helper with a broker-only Keychain ACL.
- HTTP credential values must be non-empty printable ASCII bytes (`0x20`–
  `0x7e`). Binary and non-ASCII values are rejected before injection so Node's
  header wire bytes remain identical to the bytes searched by exact-response
  redaction.
- A process with unrestricted access as the same macOS user may be able to
  inspect or invoke the same Keychain item independently. Root, a compromised
  broker, an approved malicious upstream, and a malicious approved executable
  are outside this preview's protection.
- Redaction guarantees exact-byte removal only. An upstream can transform,
  encode, split, encrypt, or infer data in ways a generic redactor cannot
  identify.
- Responses are buffered and limited to 32 KiB. SSE and other long-lived
  streaming APIs are rejected before a use is reserved in `0.1`. In AgentTool,
  this means `wake.voice`, `strands.thoughts.voice`, and `inbox.voice` are not
  available through this broker version.
- The EVM JSON-RPC extension supports seven small read methods only. It does
  not expose arbitrary RPC, logs, traces, simulation, subscriptions,
  transaction broadcast, prepared wallet calls, or Alchemy administration.
  Its origin-to-chain association is owner-configured; only an explicit
  `eth_chainId` call live-checks that association.
- The broker does not create, verify, decode, or place a spending limit on an
  x402 `PAYMENT-SIGNATURE`. Enabling `allowPaymentSignature` only forwards a
  caller-supplied signature within the origin/method/path/use boundary. Prefer
  a fresh, short-lived, one-use grant for one exact paid tool path and a
  trusted consent surface that checks the payment terms before signing.
- Aborting caller-side `fetch` rejects locally, but does not recall an operation
  already dispatched to the broker or undo an upstream side effect.
  `callEvmJsonRpcRead()` has no per-use abort signal in this preview: its local
  timeout stops waiting, while closing the session propagates cancellation to
  in-flight broker work.
- The JSONL audit stops at 10 MiB rather than rotating. The server emits one
  safe operator notification and denies subsequent grants/uses by default;
  deploy a managed `AuditSink` for rotation or tamper evidence.
- Only a macOS Keychain source is included. Linux Secret Service, Windows
  Credential Manager, native user-presence UI, and non-exporting signing are
  planned adapters.

In short: this preview keeps bearer values out of normal model/chat/SDK state
and materially narrows their use. It is not an absolute same-user sandbox.

## Install for development

```sh
cd packages/credential-broker
bun install
bun run ci
```

No runtime npm dependencies are used.
The hermetic TLS tests invoke a local `openssl` binary to generate and remove
ephemeral test-only certificates; no private-key fixture is stored.

Credential aliases are 1–128 ASCII characters:
`[A-Za-z0-9_][A-Za-z0-9._:/@+-]{0,127}`. This 0.3 preview intentionally
tightens 0.2's general trimmed-string acceptance. Rename any existing alias
with spaces, other characters, or 129–256 characters before upgrading.

## Run the local broker on macOS

### Standard human-to-broker handoff

Use the separate `agentcred-control` executable for new integrations. It
creates an owner-only, value-free A/B manifest and lets the fixed macOS
`security` tool receive the value from an interactive prompt. The value is
never a controller argument, environment variable, pipe, JSON field, receipt,
or agent-wire message. The interactive-TTY check is an anti-pipe guard, not
human authentication or a consent record.

Initialize one logical credential and one exact read-only verification probe.
The path must be canonical and query-free; lifecycle probes support HTTPS
`GET`/`HEAD` only. The verification origin/path are persisted non-secret
metadata: never embed a key in either, because argv and the manifest would
expose it.

```sh
mkdir -p ~/.config/agentcred/credentials
chmod 700 ~/.config/agentcred ~/.config/agentcred/credentials

agentcred-control init \
  --manifest "$HOME/.config/agentcred/credentials/agenttool.json" \
  --credential agenttool/default \
  --provider agenttool \
  --purpose bounded-api \
  --environment local \
  --account "$USER" \
  --auth bearer \
  --verify-operation http.fetch \
  --verify-origin https://api.example.com \
  --verify-path /v1/whoami \
  --verify-method GET \
  --verify-success-status 200 \
  --verify-revoked-status 401
```

Broker config maps the normal, candidate, and previous verification aliases
to the same manifest. The broker resolves these aliases once at startup; it
does not follow a live pointer change:

```json
{
  "credentials": {
    "agenttool/default": {
      "backend": "managed-macos-keychain",
      "manifestPath": "/Users/you/.config/agentcred/credentials/agenttool.json",
      "selection": "active",
      "auth": { "kind": "bearer" }
    },
    "agenttool/default/candidate": {
      "backend": "managed-macos-keychain",
      "manifestPath": "/Users/you/.config/agentcred/credentials/agenttool.json",
      "selection": "candidate",
      "auth": { "kind": "bearer" }
    },
    "agenttool/default/previous": {
      "backend": "managed-macos-keychain",
      "manifestPath": "/Users/you/.config/agentcred/credentials/agenttool.json",
      "selection": "previous",
      "auth": { "kind": "bearer" }
    }
  }
}
```

Add exact, read-only policies for the candidate and previous aliases before
using them as verification probes. Do not put a credential value in any
provider/evidence ID. With the broker stopped, stage the provider-issued value
from your own Terminal:

```sh
agentcred-control stage \
  --config "$HOME/.config/agentcred/config.json" \
  --credential agenttool/default/candidate
```

If the prompt or process ends ambiguously, the manifest stays in
`provisioning`. `recover-stage` is presence-only: it advances when the exact
committed Keychain item already exists and otherwise requires provider cleanup.
If the native prompt was cancelled before that item was created and the same
provider-issued value is still the intended candidate, explicitly reopen the
fixed prompt with:

```sh
agentcred-control resume-stage \
  --config "$HOME/.config/agentcred/config.json" \
  --credential agenttool/default/candidate
```

`resume-stage` first inspects the exact committed service/account. It advances
without prompting if that item already exists; if absent, it prompts only
through the fixed macOS Keychain controller. It freshly rechecks expiry and
overlap immediately after the absent result and before that prompt, confirms
the exact item, rechecks again, and then advances. It accepts no value,
stdin/env source, provider URL, or command. Initial `stage` likewise commits
the slot identity first, freshly checks the same time bounds immediately
before prompting, and rechecks after confirmation. Both recovery commands are
valid only in `provisioning`. If the intended provider value is no longer
available or its identity is uncertain, clean it up at the provider and use
the explicit candidate-abort flow instead.

After a controller crash or forced termination, do not run `recover-lock` or
`resume-stage` until you have confirmed that the former native prompt has
ended and no surviving `/usr/bin/security add-generic-password` child from
that staging attempt remains. The cooperative lock records the controller
process, not its child. A parent `SIGKILL` or crash can therefore leave an
untracked native prompt; this preview does not provide cross-crash child
supervision. The fixed committed service/account and omission of `-U` prevent
the controller from updating an item that already exists, but they do not
remove the race between two prompts or prove which value was entered.

Start the broker, perform one harmless authenticated request through the
candidate alias, and retain its returned `auditId`. Stop the broker again,
then record and activate that evidence within five minutes:

```sh
agentcred-control verify-new \
  --config "$HOME/.config/agentcred/config.json" \
  --credential agenttool/default/candidate \
  --audit-id 00000000-0000-4000-8000-000000000000

agentcred-control activate \
  --config "$HOME/.config/agentcred/config.json" \
  --credential agenttool/default/candidate
```

Use the real audit ID, never a placeholder. A `2xx` audit event is meaningful
only when the owner-selected endpoint actually requires and identifies the
credential. The controller does not infer authentication from an arbitrary
public endpoint. It binds the observation to a slot generation ID, not to a
hash of Keychain bytes. Without a provider-returned key ID, mistakenly staging
the old value again can pass the positive probe.

Every existing-manifest lifecycle transition takes the same cooperative lock
held by a running broker, so stage/cutover/rollback requires the broker to be
stopped. Create-only `init` precedes that lifecycle; explicit stale-lock
recovery necessarily inspects and removes the lock outside it.
Restarting snapshots the selected Keychain reference and invalidates the old
connection-bound grants. It does not freeze or attest bytes against a
same-user out-of-band Keychain update.

Routine rotation then uses explicit `drain`, `prepare-old-revoke`,
provider-side revoke, `attest-old-revoked`, `verify-revoked`, and `close`
steps. Before the durable no-rollback boundary, the active slot needs fresh
exact positive proof and the previous slot needs either fresh exact positive
proof or the profile's exact revoked status. The latter is a degraded-recovery
path for an already-dead predecessor, not a generic failure bypass. After the
remote revoke, a fresh exact old-negative observation remains mandatory;
active-positive evidence is recorded when available but cannot strand the
irreversible cleanup path. Candidate cancellation similarly uses
`prepare-abort`, provider-side revoke, `attest-candidate-revoked`, and
`close-abort`; no command performs the provider action.

Inspect/recover a stale cooperative lock with `lock-status` followed by
`recover-lock` using the exact nonce only after the recorded PID is absent and
you have confirmed that no native Keychain prompt or surviving
`/usr/bin/security` child from that controller remains. Lock recovery does not
perform that child-process check for you. If prompt termination or entered
value identity is ambiguous, do not resume; clean up the provider candidate
and follow the abort flow.
After eight retained closure receipts, use `archive`, then verify the result
against the live manifest with:

```sh
agentcred-control verify-archive \
  --archive "$HOME/.config/agentcred/credentials/archive-001.json" \
  --manifest "$HOME/.config/agentcred/credentials/agenttool.json"
```

See [ROTATION.md](./ROTATION.md) for routine rotation, rollback, emergency
containment, provider-specific boundaries, and every irreversible gate.

### Direct unmanaged reference

For a simple unmanaged preview, provision a Keychain item yourself outside the
agent conversation. Putting `-w` last makes the system tool prompt instead of
placing the value in process arguments:

```sh
security add-generic-password \
  -U \
  -s agenttool-soma-bearer \
  -a "$USER" \
  -w
```

Create `~/.config/agentcred/config.json` containing references and policy only,
never secret values:

```json
{
  "socketPath": "/Users/you/.config/agentcred/run/agentcred.sock",
  "auditPath": "/Users/you/.config/agentcred/audit.jsonl",
  "credentials": {
    "agenttool/default": {
      "backend": "macos-keychain",
      "service": "agenttool-soma-bearer",
      "account": "you",
      "auth": { "kind": "bearer" }
    }
  },
  "policies": [
    {
      "credential": "agenttool/default",
      "origin": "https://api.agenttool.dev",
      "methods": ["GET", "POST", "PATCH", "DELETE"],
      "pathPrefixes": ["/v1"],
      "queryNames": [],
      "allowPaymentSignature": false,
      "maxTtlSeconds": 300,
      "maxUses": 50,
      "maxRequestBytes": 32768,
      "maxResponseBytes": 32768
    }
  ]
}
```

Protect and validate it, then start the daemon from an owner-controlled local
session:

```sh
chmod 700 ~/.config/agentcred
chmod 600 ~/.config/agentcred/config.json
agentcred check --config ~/.config/agentcred/config.json
agentcred serve --config ~/.config/agentcred/config.json
```

The audit is metadata-only and owner-readable. It is not tamper-proof.
Query parameters are denied unless both policy and grant list their exact
names. Values remain caller-controlled. `X-Agent-Id` is also denied unless
both scopes contain an exact value, for example
`"headerValues":{"x-agent-id":["<approved identity id>"]}`.
`PAYMENT-SIGNATURE` is separately denied by default. To support an x402 retry,
set `"allowPaymentSignature": true` in both the owner policy and the requested
grant. This permits forwarding only; it does not sign or validate payment
terms.

### Alchemy EVM read policy

An Alchemy Chain API key can use the negotiated JSON-RPC profile without
putting the key in the endpoint URL. The credential mapping must be
`"kind": "bearer"`:

```json
{
  "credentials": {
    "alchemy/ethereum-read": {
      "backend": "macos-keychain",
      "service": "alchemy-ethereum-read",
      "account": "you",
      "auth": { "kind": "bearer" }
    }
  },
  "policies": [
    {
      "operation": "jsonrpc.read",
      "profile": "agentcred.evm-jsonrpc-read/0.1",
      "credential": "alchemy/ethereum-read",
      "origin": "https://eth-mainnet.g.alchemy.com",
      "chainId": "eip155:1",
      "methods": [
        "eth_chainId",
        "eth_blockNumber",
        "eth_getBalance",
        "eth_getTransactionReceipt"
      ],
      "maxTtlSeconds": 120,
      "maxUses": 20,
      "maxRequestBytes": 1024,
      "maxResponseBytes": 4096
    }
  ]
}
```

This profile is for agent read operations, not credential lifecycle evidence.
`agentcred-control` rotation requires an authentication-bound HTTP GET/HEAD
probe with exact status semantics; without one or a provider adapter, Alchemy
rotation remains a manual provider procedure. Legacy Alchemy key-in-URL paths
must not be used as `--verify-path`.

The path is fixed by the profile to `/v2`; there is intentionally no URL,
path, query, header, raw body, JSON-RPC ID, batch, or notification input.

## Client API

```ts
import { AgentCredClient } from "@agenttool/credential-broker";

const broker = new AgentCredClient({
  socketPath: `${process.env.HOME}/.config/agentcred/run/agentcred.sock`,
});
await broker.connect();

const grant = await broker.requestGrant({
  alias: "agenttool-session",       // model-safe label, not authority
  credential: "agenttool/default", // owner-configured opaque reference
  operation: "http.fetch",
  scope: {
    origin: "https://api.agenttool.dev",
    methods: ["GET", "POST"],
    pathPrefixes: ["/v1"],
    queryNames: [],
    ttlSeconds: 120,
    maxUses: 20,
  },
});

const brokeredFetch = broker.asFetch(grant);
const response = await brokeredFetch("https://api.agenttool.dev/v1/wake");

// AgentTool SDK uses the object-form transport directly:
// import { AgentTool } from "@agenttool/sdk";
// const at = new AgentTool({ transport: broker.asTransport(grant) });

await broker.revoke(grant);
broker.close();
```

The same client offers the shipped JSON-RPC profile during `hello` by default.
A method-aware Alchemy read is requested separately:

```ts
import {
  AGENTCRED_EVM_JSONRPC_READ_PROFILE,
  AgentCredClient,
} from "@agenttool/credential-broker";

const broker = new AgentCredClient({
  socketPath: `${process.env.HOME}/.config/agentcred/run/agentcred.sock`,
});
await broker.connect();

const grant = await broker.requestGrant({
  alias: "ethereum-observation",
  credential: "alchemy/ethereum-read",
  operation: "jsonrpc.read",
  scope: {
    profile: AGENTCRED_EVM_JSONRPC_READ_PROFILE,
    origin: "https://eth-mainnet.g.alchemy.com",
    chainId: "eip155:1",
    methods: ["eth_getBalance"],
    ttlSeconds: 60,
    maxUses: 2,
    maxRequestBytes: 1024,
    maxResponseBytes: 4096,
  },
});

const balance = await broker.callEvmJsonRpcRead(grant, {
  chainId: "eip155:1",
  method: "eth_getBalance",
  params: ["0x1111111111111111111111111111111111111111", "finalized"],
});

await broker.revoke(grant);
broker.close();
```

The returned handle serializes only its alias and receipt. Application code
should keep the client and handle in trusted host state rather than exposing
the client object as a model tool.

## Package API

- `BrokerServer`: local Unix-socket broker core.
- `AgentCredClient`: connection and opaque-handle client.
- `AgentCredClient.callEvmJsonRpcRead`: negotiated, method-aware EVM reads
  without a caller-controlled URL or raw JSON-RPC envelope.
- `MacOSKeychainSource`: broker-only Keychain reader.
- `managed-macos-keychain` config references: startup-frozen A/B manifest
  selections for offline handoff and rotation.
- `agentcred-control`: interactive controller-plane provisioning, explicit
  prompt resume, presence-only recovery, rotation, and closure-archive CLI.
  Its TTY check is anti-pipe only; it is not an agent SDK or wire surface.
- `PolicyConsent`: owner-authored standing allowlist.
- `ConsentProvider`: hook for a native out-of-band approval UI.
- `AuditSink`: metadata-only audit hook.
- `BrokerServerOptions.authorizePeer`: hook for a native peer identity check.

`OutboundTransport` is a trusted broker-internal extension point, not an agent
plugin. It receives credential-bearing headers and must enforce the validated
pinned address, normal TLS hostname/certificate checks, no redirects, no
compression, aborts, timeouts, and response limits. Prefer the included
`NodeHttpsTransport` unless the replacement can uphold all of those rules.
Its optional `ca` constructor input exists for hermetic tests and explicitly
host-controlled private trust roots. Supplying it replaces Node's default CA
set, so only trusted broker-host code may set it; never derive it from an
agent, grant, config field, or wire request. Omitting it preserves the system
trust store and certificate verification remains enabled in either mode.

Test-only in-memory credentials and fake clocks live under
`@agenttool/credential-broker/testing` so they are not mistaken for production
backends.

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
