# agentcred/0.1

**Status:** experimental draft

**Scope:** a language-neutral local protocol for using credentials without
returning credential plaintext to an agent client

**Licence:** Apache-2.0

`agentcred/0.1` is closer to `ssh-agent` than to environment-variable
injection. A client receives a bounded capability and asks a local broker to
perform an authenticated operation. It does not receive the underlying API
key or private key.

This document distinguishes two things:

- the **wire profile**, implemented by the portable package in this directory;
- the **strong local profile**, the normative security target for a deployment
  that also authenticates the calling workload and provides trusted human
  consent.

The portable Node CLI is a developer preview. It is wire-compatible, but it is
**not strong-profile conformant**: its Unix-socket permissions do not
authenticate the calling program, and its owner-authored standing policy is
not a trusted per-use consent UI. Embedders can supply `authorizePeer` and
`ConsentProvider` hooks, but must verify every strong-profile requirement
before claiming conformance.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are
normative.

## 1. Invariants

1. The client protocol has no `secret.get`, `reveal`, `export`, credential
   listing, arbitrary vault query, or equivalent operation.
2. A credential value MUST NOT be deliberately placed in a client-visible
   message, error, log, consent description, or audit record.
3. Every use is bounded by an owner-controlled maximum scope and a narrower or
   equal grant: credential reference, operation, exact origin, methods,
   segment-aware path prefixes, query-name allowlist, exact values for
   authority-sensitive headers, lifetime, body sizes, and use count.
4. Authentication material is retrieved and attached inside the broker only.
5. Missing policy, ambiguous input, failed caller authentication, unavailable
   consent, expiry, exhaustion, and revocation fail closed.

Any extension that returns credential plaintext is a different protocol and
MUST NOT advertise `agentcred/0.1` conformance.

## 2. Roles and threat model

- **Controller:** the human or administrator who provisions credentials and
  approves authority outside the agent conversation.
- **Client:** an agent runtime, SDK, tool process, or dependency. Treat the
  whole client process as potentially malicious.
- **Broker:** the local process that evaluates policy, holds capabilities,
  retrieves credentials, performs operations, and audits safe metadata. A
  strong-profile broker also authenticates the client through the OS boundary.
- **Credential source:** an OS keychain, password manager, hardware-backed key,
  or secret service available to the broker.
- **Upstream:** the service receiving a brokered operation.

The client may inspect its memory, mutate and replay requests, race uses, and
try to exfiltrate data through an allowed upstream. The protocol aims to keep
credential plaintext out of normal model/chat/SDK state and to confine use to
approved authority. It does not make an allowed operation harmless.

In the strong profile, the broker, credential source, controller surface,
owner policy, operating-system boundary, and outbound implementation are
trusted. The client is not. Credential provisioning and recovery are
controller-plane actions and are absent from this wire protocol.

## 3. Local transport profiles

### 3.1 Strong local profile

A strong-profile broker MUST use authenticated local IPC:

- Unix-like systems: an owner-only Unix-domain socket in a mode `0700`
  directory, plus OS-derived peer credentials and, where available, an
  OS-observed process handle, executable digest, code identity, or audit token;
- Windows: a named pipe restricted by an explicit user/service ACL, plus
  access-token inspection or an equivalent OS-backed caller identity.

Client-supplied PID, executable path, user name, nonce, or workload label is
descriptive only. It MUST NOT establish identity. Each capability MUST be
bound to the authenticated connection or a re-verifiable workload identity.
TCP is outside `0.1` and MUST be disabled by default.

The strong profile also requires a broker-controlled controller surface that
can approve each use. A controller MAY explicitly remember a narrowly bounded
decision, but mutating or otherwise high-impact uses SHOULD receive per-use
confirmation; a one-use grant approved immediately before use is sufficient.
Agent-rendered text, links, or buttons cannot record consent.

### 3.2 Current portable preview

The included Node server currently supports Unix-domain sockets only. It
checks that the socket directory is real, owner-held, and mode `0700`, and sets
the socket to mode `0600`. Grants are bound to one random session and are
revoked when that socket closes.

Node's portable socket API does not expose the required peer identity here.
The CLI leaves the optional `authorizePeer` hook unset, so any process able to
connect as that user passes the peer check. Its `PolicyConsent` compares grant
requests with static owner-authored policy and displays no trusted approval
window. Those are useful narrowing controls, not strong-profile caller
authentication or per-use consent.

A native host's `authorizePeer` hook returns an OS-observed `PeerIdentity`;
the broker passes that immutable identity to `ConsentProvider` and records its
non-secret stable ID in metadata audit. A client-supplied identity is never an
acceptable substitute.

## 4. Framing and envelopes

Each frame is a four-byte unsigned big-endian length followed by UTF-8 JSON.
The JSON payload MUST be at most **65,536 bytes (64 KiB)**. A receiver rejects
an oversized length before allocating the declared body. Streaming is not
defined in `0.1`.

Every request is:

```json
{
  "v": "agentcred/0.1",
  "id": "client-correlation-id",
  "seq": 0,
  "type": "hello",
  "payload": {}
}
```

`id` is a non-empty correlation string of at most 128 characters. `seq` is a
non-negative safe integer, starts at `0`, and increases by exactly one for each
request on a connection. Responses echo both fields; concurrent responses need
not arrive in sequence order. IDs and sequence numbers carry no authority.

A successful response is:

```json
{
  "v": "agentcred/0.1",
  "id": "client-correlation-id",
  "seq": 0,
  "ok": true,
  "type": "hello.ready",
  "payload": {}
}
```

A parsed request that fails safely returns:

```json
{
  "v": "agentcred/0.1",
  "id": "client-correlation-id",
  "seq": 1,
  "ok": false,
  "error": {
    "code": "scope_denied",
    "message": "HTTP request is outside the granted scope."
  }
}
```

Top-level framing, JSON, version, sequence, or request-type failures MAY close
the connection without a response. Error messages and optional `detail` MUST
be bounded and safe. `0.1` error codes are:

```text
invalid_request       protocol_error       frame_too_large
consent_denied        grant_not_found       grant_expired
grant_exhausted       grant_wrong_session   scope_denied
credential_not_found  backend_unavailable   network_denied
request_failed        response_too_large    unsupported
```

A broker SHOULD collapse capability lookup, expiry, exhaustion, and
wrong-session failures to `grant_not_found` at the external boundary.

## 5. Implemented message set

The only request `type` values implemented in `0.1` are:

| Request | Success type | Purpose |
|---|---|---|
| `hello` | `hello.ready` | establish the connection session |
| `grant.request` | `grant.ready` | request a scoped `http.fetch` capability |
| `grant.use` | `http.result` | spend one capability use on a brokered fetch |
| `grant.revoke` | `grant.revoked` | surrender the connection-bound capability |

`grant.status`, `grant.renew`, and `sign` are reserved for a future negotiated
revision. They are not valid `agentcred/0.1` request types and clients MUST NOT
send them. The current server rejects unsupported types, normally by closing
the connection during request parsing.

## 6. Hello

`hello` MUST be sequence `0` and the first and only hello on a connection:

```json
{
  "v": "agentcred/0.1",
  "id": "018f-example-0001",
  "seq": 0,
  "type": "hello",
  "payload": {
    "clientNonce": "non-authoritative-random-client-nonce",
    "clientName": "example-agent-host"
  }
}
```

`clientNonce` is required and contains 16 to 256 characters. It provides
freshness material only; it is not client authentication. `clientName` is
optional untrusted metadata. The success payload contains the broker's opaque
`sessionId` and negotiated concurrency limit:

```json
{
  "v": "agentcred/0.1",
  "id": "018f-example-0001",
  "seq": 0,
  "ok": true,
  "type": "hello.ready",
  "payload": {
    "sessionId": "opaque-session-id",
    "maxInFlight": 4
  }
}
```

`maxInFlight` is `1..64`. A conforming client queues requests above that
negotiated connection limit; it does not deliberately trigger a connection
close and revoke all of its grants.

## 7. Grant request and lifecycle

`grant.request` currently supports only `operation: "http.fetch"`:

```json
{
  "v": "agentcred/0.1",
  "id": "018f-example-0002",
  "seq": 1,
  "type": "grant.request",
  "payload": {
    "alias": "current-task",
    "credential": "service/default",
    "operation": "http.fetch",
    "scope": {
      "origin": "https://api.example.invalid",
      "methods": ["GET", "POST"],
      "pathPrefixes": ["/v1/messages"],
      "queryNames": [],
      "headerValues": {},
      "allowPaymentSignature": false,
      "ttlSeconds": 300,
      "maxUses": 5,
      "maxRequestBytes": 32768,
      "maxResponseBytes": 32768,
      "allowPrivateNetwork": false
    },
    "rationale": "Use the approved API for the current task"
  }
}
```

`alias` is a model-safe display label. `credential` is an opaque,
owner-configured reference, not a credential value. The broker MUST NOT expose
a method to enumerate these references or their account metadata. `rationale`
is optional untrusted display text.

The supported methods are `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, and `DELETE`.
`ttlSeconds` is `1..86400`; `maxUses` is `1..10000`. Request and response limits
default to 32,768 decoded bytes and cannot exceed that value in the current
wire profile. Paths are normalized, absolute, query-free prefixes and match on
segment boundaries. `queryNames` is an optional allowlist of query parameter
names; omitting it or using an empty array denies every query parameter.
Authentication-like names such as `token`, `api_key`, and `authorization` are
outside the strict profile.

`headerValues` is an optional map of lower-case, authority-sensitive header
names to exact allowed values. The `0.1` strict profile supports only
`x-agent-id`; omitting the map denies that header. Both owner policy and grant
must contain the value before a client may send it.

`allowPaymentSignature` is an optional boolean that defaults to `false`. A
caller may send the x402 `PAYMENT-SIGNATURE` request header only when both the
owner policy and the individual grant set it to `true`. This flag authorizes
forwarding inside the rest of the grant boundary; the broker does not create,
decode, verify, or enforce a spending limit on the signed payment envelope.
Controllers SHOULD use a fresh, short-lived, one-use grant scoped to one exact
paid path and obtain payment consent before an external signer creates it.

The requested scope MUST fit within an owner-controlled policy for the same
credential reference. The `0.1` broker accepts that exact normalized scope or
denies it; it MUST NOT widen it. A client requests a new, narrower scope when
needed. The current wire has no pending state: the consent provider either
denies the request or the broker replies immediately with `grant.ready`:

```json
{
  "v": "agentcred/0.1",
  "id": "018f-example-0002",
  "seq": 1,
  "ok": true,
  "type": "grant.ready",
  "payload": {
    "capability": "opaque-256-bit-base64url-authority",
    "receipt": {
      "alias": "current-task",
      "receiptId": "opaque-receipt-id",
      "operation": "http.fetch",
      "scope": {
        "origin": "https://api.example.invalid",
        "methods": ["GET", "POST"],
        "pathPrefixes": ["/v1/messages"],
        "queryNames": [],
        "headerValues": {},
        "allowPaymentSignature": false,
        "ttlSeconds": 300,
        "maxUses": 5,
        "maxRequestBytes": 32768,
        "maxResponseBytes": 32768,
        "allowPrivateNetwork": false
      },
      "expiresAt": "2030-01-01T00:05:00.000Z",
      "maxUses": 5
    }
  }
}
```

The capability is 32 random bytes encoded as base64url. It is sensitive
authority, even though it is not the credential. It MUST be bound to its
session; the current client keeps it in module-private state and omits it from
`GrantHandle` serialization. That reduces accidental model/chat exposure but
does not protect it from a debugger or a compromised client process.

Lifetime is checked with a monotonic clock. A use is reserved atomically after
wire and scope validation but before DNS, credential lookup, or upstream I/O;
therefore an in-scope upstream failure consumes a use. Expiry, exhaustion,
revocation, and connection close make the capability unavailable. There is no
status, renewal, delegation, or reconnect recovery in `0.1`.

Implementations MUST bound active grants and per-connection/global in-flight
work. The reference defaults are 64 active grants per connection, 512 total,
4 in-flight requests per connection, and 32 total. Spent, expired, revoked,
and disconnected grants do not occupy those quotas.

## 8. Grant use: `http.fetch`

An HTTP operation is carried inside `grant.use`:

```json
{
  "v": "agentcred/0.1",
  "id": "018f-example-0003",
  "seq": 2,
  "type": "grant.use",
  "payload": {
    "capability": "opaque-256-bit-base64url-authority",
    "request": {
      "url": "https://api.example.invalid/v1/messages",
      "method": "POST",
      "headers": { "content-type": "application/json" },
      "bodyBase64": "eyJtZXNzYWdlIjoiaGVsbG8ifQ==",
      "idempotencyKey": "caller-generated-idempotency-key"
    }
  }
}
```

`bodyBase64`, when present, MUST be canonical base64. `GET` and `HEAD` cannot
carry a body. Every other method requires `idempotencyKey`; the broker does not
retry state-changing requests. The request must fit both its grant and the
owner's maximum policy.

Before retrieving a credential, the broker MUST:

1. require HTTPS and reject user-info, fragments, trailing-dot hosts,
   backslashes, CR/LF/NUL, and ambiguous encoded path forms;
2. match the exact normalized origin, allowed method, and a segment-aware path
   prefix, and reject query parameter names or authority-sensitive header
   values outside the grant allowlists;
3. reject caller-supplied authentication, cookie, forwarding, proxy,
   hop-by-hop, compression, and all non-allowlisted headers;
4. validate every DNS answer against the public/private-network policy and pin
   one validated address into the TLS connection; and
5. enforce request size, response size, timeout, normal TLS hostname and
certificate validation, and use count.

The `0.1` request-header allowlist is `accept`, `accept-language`,
`content-type`, `user-agent`, `x-agenttool-authority-sequence`,
`x-agenttool-authority-signature`, `x-agenttool-authority-timestamp`,
`x-agenttool-client`, `x-agent-id`, `x-agent-protocol`, `x-agent-welcome`,
`x-request-id`, `idempotency-key`, and `mcp-protocol-version`. The broker sets
`accept-encoding: identity` itself. `payment-signature` joins this allowlist
only for a grant with the explicit `allowPaymentSignature` opt-in described
above. Broker-owned custom credential mappings
MUST NOT target a caller-allowed header, so credential injection cannot
overwrite identity, authority-proof, idempotency, representation, or client
metadata fields.

Redirects and compressed responses are rejected. Private or reserved network
destinations remain denied unless both grant and owner policy explicitly allow
them. Authentication is then attached according to the broker-owned
credential mapping.

The reference HTTP profile accepts only non-empty printable ASCII credential
bytes (`0x20`–`0x7e`) and a final injected header value of at most 16 KiB.
Binary, control-character, and non-ASCII credential material fails before
outbound I/O. This keeps Node's header serialization byte-identical to the
credential bytes used by exact-response redaction; it is not a general
information-flow guarantee.

`Accept: text/event-stream` is rejected before a use is reserved because the
`0.1` wire does not stream. A caller-side abort may reject locally, but cannot
recall an operation already dispatched or undo an upstream side effect. A
socket/session close signals cancellation to cooperating consent, credential,
resolver, and outbound adapters.

The scope constrains query parameter names, but not their values. Values remain
client-controlled request content and are omitted from audit. Controllers MUST
NOT grant an endpoint whose allowed query values can widen authority, choose an
arbitrary callback, or expose authentication unless a future host-specific
policy validates those values.

A successful response is bounded, header-allowlisted, and base64 encoded:

The `0.1` response-header allowlist is `content-type`, `cache-control`, `etag`,
`last-modified`, `link`, `payment-required`, `payment-response`, `retry-after`,
`x-credits-balance`, `x-payment-required`, `x-payment-response`, `x-request-id`,
`x-wake-profile`, `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`,
`x-ratelimit-limit`, `x-ratelimit-remaining`, and `x-ratelimit-reset`. Their
combined JSON encoding is capped at 12 KiB. Redirect `location`, cookies, and
every other response header are omitted. A returned payment challenge is data,
not permission to sign or spend.

```json
{
  "v": "agentcred/0.1",
  "id": "018f-example-0003",
  "seq": 2,
  "ok": true,
  "type": "http.result",
  "payload": {
    "status": 200,
    "headers": { "content-type": "application/json" },
    "bodyBase64": "eyJpZCI6InJlbW90ZS1yZXN1bHQifQ==",
    "auditId": "opaque-audit-id",
    "redactions": 0
  }
}
```

The broker removes exact credential-byte occurrences from allowed response
headers and body before encoding them. This is defense in depth, not a general
reflection guarantee. The redacted body remains subject to the grant's response
limit; if replacement expands it past that boundary, the use fails with
`response_too_large` instead of emitting an oversized control frame.

An injected `OutboundTransport` is part of the trusted broker boundary. It
receives credential-bearing headers and MUST honor the validated pinned
address, normal TLS hostname and certificate verification, redirect and
compression refusal, abort signal, timeout, and response-size limit. It MUST
NOT be exposed as a client/plugin extension point.

The Node reference transport's optional custom CA input is a trusted-host
constructor boundary for hermetic tests or an explicitly managed private PKI.
It MUST NOT be populated from protocol frames, grants, model-facing state, or
untrusted configuration. When omitted, the transport uses the system trust
store; certificate and hostname verification remain enabled in both modes.

## 9. Revocation

The bound client surrenders a grant with:

```json
{
  "v": "agentcred/0.1",
  "id": "018f-example-0004",
  "seq": 3,
  "type": "grant.revoke",
  "payload": { "capability": "opaque-256-bit-base64url-authority" }
}
```

Success has type `grant.revoked` and payload `{ "receiptId": "..." }`.
Revocation prevents later dispatches but cannot recall an operation already
sent upstream.

## 10. Consent and audit

A strong-profile controller surface MUST independently show the OS-observed
caller, human-recognizable service/account label, operation, origin,
method/path/query-name boundary, exact authority-sensitive header values,
lifetime, use and byte limits, and mutation or spending implications. Client
rationale MUST be marked untrusted and rendered without active markup.
Absence, timeout, or unverifiable identity is denial. Remembered approval MUST
be visible, bounded, and revocable.

The portable CLI instead uses a mode-`0600` references-and-policy file with no
credential values. This is a standing allowlist, not interactive consent.

Audit records SHOULD include timestamps, session and receipt IDs, opaque
credential reference, operation, origin, hashed path, method, byte counts,
status, duration, redaction count, outcome, and safe reason code. They MUST NOT
contain credential values, hashes of secret values, raw paths, query values,
headers, bodies, vault output, or unsafe upstream errors.

The preview JSONL sink is owner-only and append-only by convention. It is not
tamper-proof and stops at 10 MiB rather than rotating. The reference server
latches the first sink failure, emits one safe operator notification when
configured, and denies subsequent grants and uses by default. An audit failure
after an external action does not undo that action. Hosts needing rotation,
fail-closed durability, or tamper evidence must supply and verify that boundary
themselves.

## 11. Reserved work

The following names describe intended directions, not shipped capability:

- `grant.status`: inspect a bound grant without exposing its authority string;
- `grant.renew`: create a separately consented successor rather than silently
  extending a grant;
- `sign`: ask a non-exporting asymmetric key to sign bounded,
  domain-separated bytes and return only a signature and public identifier.

Future revisions must define and negotiate their exact payloads. The current
package does not implement signing, non-exporting keys, streaming, Windows
named pipes, Linux Secret Service, or reconnectable workload grants.

## 12. Honest non-guarantees

Neither profile claims that:

- a compromised kernel, administrator/root account, broker, credential
  source, controller surface, or upstream cannot extract or misuse a secret;
- an allowed client cannot exercise every operation and side effect in its
  grant;
- `allowPaymentSignature` verifies payment terms or bounds the value authorized
  by a caller-supplied x402 signature;
- request or response content is hidden from that client;
- the upstream does not receive its credential, or a legacy bearer value is
  absent from broker memory;
- exact-byte filtering detects transformed, encoded, split, encrypted, hashed,
  inferred, or otherwise altered reflections;
- revocation undoes an already dispatched effect; or
- local audit remains trustworthy after the host boundary is lost.

For the portable preview specifically:

- same-user socket access is not calling-program identity;
- the opaque capability exists on the wire and in client memory even though
  the provided handle does not serialize it;
- the macOS backend invokes `/usr/bin/security`, so plaintext passes through
  that subprocess and broker memory and is not protected by a code-signed
  broker-only Security.framework ACL;
- another same-user process may be able to access the same Keychain item;
- static policy does not demonstrate fresh human understanding or per-use
  approval; and
- JavaScript provides only best-effort buffer clearing, not a proof that all
  copies were erased.

Environment-variable injection, plaintext files, shell-argument injection,
and `exec-with-secret` give the child process the credential and therefore do
not satisfy this protocol's non-disclosure goal.

## 13. Conformance labels

An implementation MAY claim **`agentcred/0.1 wire-compatible`** when it obeys
the framing, sequence, message, grant, and no-retrieval requirements above.

It MAY claim **`agentcred/0.1 strong-local-profile`** only when it additionally:

1. authenticates the peer with OS-derived identity and binds every capability
   to that identity;
2. supplies a broker-controlled consent surface capable of fresh per-use
   approval;
3. keeps the credential source inaccessible to the untrusted workload as far
   as the documented OS boundary permits;
4. applies scope, DNS/address, TLS, header, size, redaction, and audit rules on
   normal, error, and debug paths; and
5. publishes its actual OS, process, credential-source, memory, consent, and
   audit boundaries without presenting best-effort controls as guarantees.

The package currently shipped in this directory must use the first label, not
the second.
