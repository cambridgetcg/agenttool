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
with a valuable credential.

## What the preview does

- exposes no `getSecret`, reveal, export, or credential-list operation;
- keeps capability strings out of the public `GrantHandle` and its JSON form;
- binds grants to one socket connection, a monotonic TTL, and an atomic use
  count;
- restricts requests to an exact HTTPS origin, methods, and canonical path
  prefixes, deny-by-default query names, and exact values for
  authority-sensitive headers;
- validates every DNS answer and pins a validated address into the TLS
  connection without using a shared connection pool;
- refuses redirects, private/reserved destinations unless both owner policy
  and grant explicitly opt in, caller authentication headers, hop-by-hop
  headers, and compressed responses;
- bounds request and response bodies and removes exact secret-byte reflections
  before results, errors, and metadata audits cross the broker boundary;
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
- The macOS adapter invokes the fixed `/usr/bin/security` binary. Secret bytes
  pass through that subprocess and broker memory. This is not equivalent to a
  code-signed native Security.framework helper with a broker-only Keychain ACL.
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
- Aborting the caller-side `fetch` rejects locally, but does not recall an
  operation already dispatched to the broker or undo an upstream side effect.
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

## Run the local broker on macOS

Provision a Keychain item yourself, outside the agent conversation. Putting
`-w` last makes the system tool prompt instead of placing the value in process
arguments:

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
      "maxTtlSeconds": 300,
      "maxUses": 50,
      "maxRequestBytes": 32768,
      "maxResponseBytes": 32768
    }
  ]
}
```

Protect and validate it, then start the daemon from a human-controlled local
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

The returned handle serializes only its alias and receipt. Application code
should keep the client and handle in trusted host state rather than exposing
the client object as a model tool.

## Package API

- `BrokerServer`: local Unix-socket broker core.
- `AgentCredClient`: connection and opaque-handle client.
- `MacOSKeychainSource`: broker-only Keychain reader.
- `PolicyConsent`: owner-authored standing allowlist.
- `ConsentProvider`: hook for a native out-of-band approval UI.
- `AuditSink`: metadata-only audit hook.
- `BrokerServerOptions.authorizePeer`: hook for a native peer identity check.

`OutboundTransport` is a trusted broker-internal extension point, not an agent
plugin. It receives credential-bearing headers and must enforce the validated
pinned address, normal TLS hostname/certificate checks, no redirects, no
compression, aborts, timeouts, and response limits. Prefer the included
`NodeHttpsTransport` unless the replacement can uphold all of those rules.

Test-only in-memory credentials and fake clocks live under
`@agenttool/credential-broker/testing` so they are not mistaken for production
backends.
