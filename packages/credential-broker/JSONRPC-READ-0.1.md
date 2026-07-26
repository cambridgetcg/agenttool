# agentcred.evm-jsonrpc-read/0.1

**Status:** experimental negotiated extension

**Base wire:** `agentcred/0.1`

**Scope:** method-aware, read-only EVM JSON-RPC through a local credential
broker without giving the credential, endpoint URL, raw request body, headers,
or JSON-RPC request ID to the agent client

This profile is an explicit extension. It does not add arbitrary JSON-RPC to
`http.fetch`, and it does not change the base `agentcred/0.1` message set for a
connection that did not negotiate it.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are
normative.

## 1. Negotiation

A client offers the exact profile name in its first `hello`:

```json
{
  "clientNonce": "non-authoritative-random-client-nonce",
  "clientName": "example-agent-host",
  "extensions": ["agentcred.evm-jsonrpc-read/0.1"]
}
```

A supporting broker includes the selected name in `hello.ready`:

```json
{
  "sessionId": "opaque-session-id",
  "maxInFlight": 4,
  "extensions": ["agentcred.evm-jsonrpc-read/0.1"]
}
```

Unknown offered names are ignored. A broker MUST reject a `jsonrpc.read` grant
unless this exact profile was selected on the same connection. Base
`agentcred/0.1` clients omit `extensions`; updated brokers continue to serve
their existing `http.fetch` grants. Updated clients treat an absent response
field as an empty selection, so they can still use HTTP with an older broker.

## 2. Grant

The negotiated operation is `jsonrpc.read`:

```json
{
  "alias": "ethereum-observation",
  "credential": "alchemy/read-mainnet",
  "operation": "jsonrpc.read",
  "scope": {
    "profile": "agentcred.evm-jsonrpc-read/0.1",
    "origin": "https://eth-mainnet.g.alchemy.com",
    "chainId": "eip155:1",
    "methods": [
      "eth_chainId",
      "eth_blockNumber",
      "eth_getBalance",
      "eth_getTransactionReceipt"
    ],
    "ttlSeconds": 120,
    "maxUses": 20,
    "maxRequestBytes": 1024,
    "maxResponseBytes": 4096,
    "allowPrivateNetwork": false
  },
  "rationale": "Read bounded Ethereum evidence"
}
```

The profile fixes the HTTPS path to exactly `/v2`. There is no grant path,
query, header, or URL parameter. `origin` MUST be a normalized exact HTTPS
origin and MUST fit an owner-authored policy for the same opaque credential
reference. `chainId` MUST be a canonical, bounded CAIP-2 identifier of the
form `eip155:<positive decimal>`.

The origin-to-chain association is an owner assertion. An `eth_chainId` result
is checked against it when that method is called. The reference implementation
does not perform a hidden chain-ID probe before every other method, so an
incorrect or compromised owner mapping can still point at the wrong chain.

TTL, use count, request bytes, response bytes, and private-network behavior
have the same containment and lifecycle semantics as the base protocol. A
valid in-scope call reserves one use before DNS, credential lookup, or
upstream I/O. A malformed, unknown, wrong-chain, or out-of-grant call does not
reserve a use.

## 3. Closed method and parameter profile

The complete `0.1` method set is:

| Method | Exact params | Result check |
|---|---|---|
| `eth_chainId` | `[]` | canonical hex quantity equal to the grant chain |
| `eth_blockNumber` | `[]` | canonical bounded hex quantity |
| `eth_getBlockByNumber` | `[blockReference, false]` | object with canonical `number`, or `null`; a numeric request must match exactly |
| `eth_getBalance` | `[address, blockReference]` | canonical bounded hex quantity |
| `eth_getCode` | `[address, blockReference]` | even-length hex bytes |
| `eth_getTransactionByHash` | `[32-byte hash]` | object with matching `hash`, or `null` |
| `eth_getTransactionReceipt` | `[32-byte hash]` | object with matching `transactionHash`, or `null` |

An address is exactly `0x` plus 40 hexadecimal digits. A hash is exactly `0x`
plus 64 hexadecimal digits. A block reference is `latest`, `safe`,
`finalized`, or a canonical lower-case hex quantity. Object-form EIP-1898
references, `pending`, full-transaction block responses, and extra or omitted
params are outside this revision.

`eth_sendRawTransaction`, `wallet_sendPreparedCalls`, every signing or wallet
method, simulation, tracing, log filtering, subscriptions, batches, and every
other JSON-RPC method are outside the profile. Adding a read method requires a
new implementation and regression tests; an owner policy cannot invent one.

## 4. Use

The client sends only:

```json
{
  "capability": "opaque-connection-bound-authority",
  "request": {
    "chainId": "eip155:1",
    "method": "eth_getBalance",
    "params": [
      "0x1111111111111111111111111111111111111111",
      "finalized"
    ]
  }
}
```

Both objects are closed: unknown fields are rejected. `request` MUST be one
object, never an array. It has no `url`, `headers`, `body`, `jsonrpc`, or `id`
field. Therefore the caller cannot choose another origin, insert
authentication, submit a raw envelope, request a batch, or omit an ID to form
a notification.

After validation, the broker constructs exactly one upstream request:

```json
{
  "jsonrpc": "2.0",
  "id": "broker-generated-correlation-id",
  "method": "eth_getBalance",
  "params": [
    "0x1111111111111111111111111111111111111111",
    "finalized"
  ]
}
```

It sends that body with `POST` to the grant's exact origin plus `/v2`. The
credential mapping MUST be `kind: "bearer"` and the credential is injected
only into the `Authorization` header inside the broker. A custom credential
header mapping fails before outbound transport. The request URL, body, audit,
errors, grant receipt, and public handle contain no credential value.

The broker validates the call and grant before use reservation, DNS,
credential lookup, or transport. It then applies the base profile's DNS answer
validation, address pinning, TLS hostname and certificate validation, timeout,
no-redirect, no-compression, byte-limit, connection-close cancellation, and
exact-secret redaction controls. It does not retry the request. The reference
client has no per-use abort signal for this profile: a client timeout stops
waiting but does not recall work already dispatched to the broker.

## 5. Response

The upstream HTTP response MUST be successful. When it includes
`Content-Type`, the media type MUST be `application/json` (case-insensitive,
with optional parameters). Header presence is not treated as an Alchemy
compatibility guarantee; the body is always decoded as strict UTF-8 and parsed
as JSON. It is bounded before and after exact-byte redaction. The JSON-RPC
response MUST be one object with:

- `jsonrpc: "2.0"`;
- the exact broker-generated `id`; and
- exactly one `result` field.

Unknown envelope fields, arrays, mismatched IDs, missing results, invalid
method-specific result shapes, and JSON-RPC `error` responses fail with a safe
broker error. Provider error text and data are never reflected to the client
or audit.

Success has wire type `jsonrpc.result`:

```json
{
  "profile": "agentcred.evm-jsonrpc-read/0.1",
  "chainId": "eip155:1",
  "method": "eth_getBalance",
  "result": "0x2a",
  "auditId": "opaque-audit-id",
  "redactions": 0
}
```

The result remains untrusted provider data. Object results receive bounded
JSON depth and node checks. A non-null transaction or receipt must carry the
requested transaction hash, and a non-null block must carry a canonical block
number; a numbered block request must match that number exactly. These are
request/response identity checks, not claims that a receipt, transaction, or
block is canonical, finalized, complete, or independently verified.

## 6. Audit and non-guarantees

Metadata audit MAY contain the opaque credential reference, exact origin,
hash of the fixed `/v2` path, profile operation, allowlisted method, CAIP-2
chain ID, byte counts, status, duration, redaction count, outcome, and safe
reason code. It MUST NOT contain params, addresses, hashes, request/response
bodies, headers, capability strings, provider diagnostics, or credential
values.

This extension inherits every threat boundary and honest non-guarantee in
[`SPEC.md`](./SPEC.md). In particular:

- the portable same-user Node preview is not strong caller authentication or
  fresh human consent;
- exact-byte redaction is not general information-flow control;
- an allowed read can expose private query intent to the provider and consume
  provider quota;
- a client-side timeout stops waiting but cannot recall dispatched work;
- provider data is evidence, not chain consensus or identity proof; and
- this profile grants no signing, simulation, transaction broadcast, wallet
  session, payment, webhook administration, or Alchemy account authority.
