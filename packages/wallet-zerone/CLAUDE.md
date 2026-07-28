# @agenttool/wallet-zerone

## Purpose

Offline-first Zerone chain adapter for verified `@agenttool/wallet` intents.
It owns the exact supported protobuf subset, Cosmos direct-sign bytes,
chain-native verification, injected transport validation, and independent
Go/Cosmos vectors.

## Non-negotiable boundary

- Never accept, derive, export, log, or persist a seed, mnemonic, private key,
  bearer credential, or production signed transaction.
- Never add a `signAndSend` path or an automatic broadcast retry.
- Do not bundle RPC URLs, REST assumptions, credentials, custody, durable
  state, nonce locks, spend reservations, approval verification, or
  qualification proofs.
- Keep the allowlist to canonical one-coin native `MsgSend` and the exact
  witness-only AgentTool `MsgSubmitExternalAttestation` subset unless a new
  reviewed protocol version expands it.
- Wallet method identifiers omit the leading slash; protobuf `Any.type_url`
  values include it.
- Require `createAgentToolInvocationWitnessLink()` for the safe released-work
  path. Low-level link helpers do not make an invocation attestable.
- Preserve private in-process identity bindings for plan, verified simulation,
  simulation binding, and adapter-created SigningRequest. Durable hosts must
  additionally persist and recheck explicit hashes and IDs.
- Require an unset account key or the exact same registered Cosmos
  secp256k1 key. Do not silently accept Ed25519, unknown, or rotated keys.
- Preserve compact 64-byte lower-S signature verification over exact
  `SIGN_MODE_DIRECT` bytes.
- Compute the pinned per-message `ZRNGasDecorator` floor. Simulation skips
  that decorator and cannot substitute for the local check.
- Once the broadcast closure is invoked, every error or malformed response is
  ambiguous with the precomputed hash. Before invocation, local validation and
  pre-abort errors must remain distinguishable.
- Lookup absence/unavailability never authorizes retry or refund. Transaction
  inclusion is not attestation settlement.
- Do not claim custom substrate-bridge REST availability: the pinned module's
  `RegisterGRPCGatewayRoutes` is empty.

## Pinned live values

- zerone-core: `35284a22192df8fc6273135f14e8549c804778b6`
- Cosmos SDK: `v0.50.15`
- adapter: `agenttool-invocation-v1`
- work class: `agenttool.invocation`
- denom: `uzrn`
- account HRP: `zrn`
- minimum gas: `22,222`
- MsgSend gas: `21,000` each
- unmapped attestation gas: `22,222` each
- per-transaction gas cap: `11,111,111`
- consensus minimum gas price: `1 uzrn/gas`

## Commands

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
bun run smoke:node
bun run ci
npm pack --ignore-scripts --dry-run
./scripts/regenerate-go-cosmos-vector.sh --check
```

The last command checks a fixture made by pinned Go chain code; it is not a
TypeScript self-roundtrip. For offline reproduction set
`ZERONE_CORE_CHECKOUT` to a local checkout and disable `GOPROXY`/`GOSUMDB`
after ensuring dependencies are cached.

## Key files

- `src/messages.ts` — strict canonical protobuf subset and keeper link hash
- `src/invocation.ts` — exact relay JSON projection and safe witness helper
- `src/transactions.ts` — intent binding, gas/fee rules, SignDoc/TxRaw verify
- `src/client.ts` — injected bounded transports and ambiguity semantics
- `vectors/` — independently generated public Go/Cosmos fixture
- `scripts/go-cosmos-fixture/` — generator run inside pinned zerone-core
- `tests/` — parity, substitution, wire, signer, policy, and transport attacks

## Release state

Version `0.1.0` is a locally prepared release candidate after independent
wire/package review. Its `@agenttool/wallet ^0.1.1` peer must be released
first. Do not claim npm publication, public artifact availability, deployment,
or live-chain execution from source metadata alone.

## Kingdom Engine

AgentTool Platform
