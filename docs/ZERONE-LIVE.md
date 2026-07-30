# ZERONE-LIVE — marketplace ⟷ chain integration record

> **TL;DR:** AgentTool has a deployed bounded invocation-witness seam and
> public exact LOVE artifacts for the chain-neutral Wallet core and offline
> Zerone adapter. This does not create a hosted signer, broadcaster, custody
> service, RPC service, or deployed adapter bridge, and it does not prove that
> any stored witness report matches current chain state. The external chains,
> relay, listings, and drill below are time-sensitive operational records;
> verify them independently.

> **Status reviewed:** 2026-07-28. AgentTool production and both static package
> surfaces were rechecked. Zerone mainnet/testnet RPC status was observed
> healthy and not catching up, the configured adapter was observed ACTIVE, and
> attestation `att-146-9` was observed SETTLED. These are dated read-only
> observations, not package guarantees or continuing-liveness proof.

## Current implementation matrix

| Surface | Repository state on 2026-07-29 | What it does not establish |
|---|---|---|
| `zerone-1`, `zerone-testnet-1`, endpoints, listings | External, time-sensitive inventory recorded 2026-07-08; RPC sync status rechecked 2026-07-28 | Continuing reachability, validator state, balances, parameters, or economics |
| `zerone-core/tools/agenttool-relay` | External CLI/keyring relay pinned by the adapter to zerone-core `35284a22192df8fc6273135f14e8549c804778b6` | AgentTool-hosted custody, RPC, signing, or universal Wallet retry semantics |
| AgentTool witness writer and public re-derivation reader | Deployed authenticated `POST /v1/invocations/{id}/witness` and structurally gated `GET /public/invocations/{id}` | Chain retrieval, writer provenance for historical JSON, attestation settlement, bond return, or reward proof |
| `@agenttool/wallet` | Public exact LOVE `0.1.3`; npm 0.1.3 is independently byte-verified, and optional mutable GitHub Releases require fresh digest verification | A chain adapter, custody, RPC, simulation, or broadcast |
| `@agenttool/wallet-zerone` | Public exact LOVE `0.1.2`, exact-byte encoding and verification with injected transports; 0.1.1 remains preserved after its credential-free npm preparation failure, and optional npm/GitHub mirrors remain independent | Keys, custody, hosted RPC, a generic REST client, durable reservations, `signAndSend`, automatic retry, deployed bridge, or live execution |

## The two chains — last recorded 2026-07-08

| Surface | zerone-1 (MAINNET — the record) | zerone-testnet-1 (sandbox) |
|---|---|---|
| RPC | `http://169.155.55.44:26657` | `http://37.16.28.121:26657` |
| REST | `http://169.155.55.44:1317` | `http://37.16.28.121:1317` |
| Chain ID | `zerone-1` | `zerone-testnet-1` |
| Genesis | 13,555 ZRN, every address published, **no faucet** | validator + 1M ZRN faucet float |
| Reset policy | custodial launch phase — resettable until independence earned, then seals (TRUST.md) | resettable without notice |
| Code | `github.com/cambridgetcg/zerone-core` — `deploy/mainnet/JOIN.md` · `deploy/mainnet/TRUST.md` | `deploy/testnet/JOIN.md` · `deploy/testnet/RUN-A-NODE.md` |

The 2026-07-08 record described a 222,222,222 ZRN cap and three emission
pathways. Treat parameters and live state as chain observations, not package
guarantees.

## Marketplace listings — last recorded 2026-07-08

| Listing | ID | Price | What the buyer gets |
|---|---|---|---|
| **zerone-1 mainnet passport 零一公民** | `87608a68-aaa6-410e-b3bb-1c6b98df7c2e` | 2 GBP-minor | Sealed: fresh key + seed, registrar admission, 0.222 ZRN bonus **minted** under the 222,222-ZRN bootstrap cap, 2 ZRN welcome float. NO home — the 10 ZRN home is earned (~100 witnessed works). |
| **zerone-passport** (testnet) | `64cbc078-bbd1-41b4-ad9f-b82363678936` | 2 GBP-minor | Sealed: fresh key + seed, ~15 ZRN faucet seed, x/home anchored to buyer DID (~5 ZRN spendable after the 10 ZRN home fee). |
| **zerone-testnet-guide 零一導引** (free) | `96f679d7-12c7-4f94-abba-ddce800d0767` | 1 GBP-minor (platform min) | Both networks' endpoints, the 60-second lane, how to earn by witnessing. |

## The witness bridge

The external relay and the new local AgentTool seam are separate components.
The relay polls released invocations, builds an attestation, shells out to a
configured `zeroned` keyring/CLI, and tracks its own forward-only ledger.
AgentTool's local writer stores a buyer- or seller-reported chain reference
only after the invocation is released and settled. The public reader
re-derives the invocation projection and exposes only exact, versioned report
shapes while that state remains released and settled. Shape validity is not
cryptographic writer provenance or chain verification.

The 2026-07-08 chain configuration recorded
`agenttool-invocation-v1` as active on both chains. At the pinned relay source:

- `RELAY_WITNESS_WRITEBACK` is off by default; `1` enables an authenticated
  report to `POST /v1/invocations/{id}/witness` under the relay's existing
  bearer;
- writeback is best-effort and happens only after the relay persists its
  attested state; it cannot change that state;
- the pinned relay documentation expects a live-API `404` until the new local
  AgentTool route is separately deployed and verified; and
- the relay's 10 consecutive tx-not-found observations over roughly 15
  minutes before releasing a record for resubmission are relay/operator
  policy. They do not weaken Wallet's sticky `submission_unknown` rule, which
  requires positive evidence to resolve ambiguity.

The custom substrate-bridge protobuf service is not a generic REST promise:
the pinned module's `RegisterGRPCGatewayRoutes` is empty. Hosts needing
application state must inject an authenticated gRPC, ABCI, CLI, or
deployment-specific transport.

### Lifecycle evidence is layered

1. Broadcast acceptance or code-zero transaction inclusion at a chosen depth
   proves only that the exact transaction was included.
2. An attestation ID recovered from the typed response/event can then be
   queried until the application reaches the required state, such as
   `READY` or `SETTLED`.
3. Settlement, bond return, challenge survival, and witness reward release
   are distinct observations. Adapter suspension can defer a reward,
   tombstoning can cancel it, and the chain supply cap can clip the amount
   minted.

The 1 ZRN bond, 0.222 ZRN configured reward, 200-block challenge window, gas,
fee, and net figures below are historical configuration snapshots, not
guaranteed outcomes.

## Historical end-to-end receipt (2026-07-08)

Mainnet drill receipts: passport invocation `e1f7f4eb` (2 GBP-minor ≈ 2p) → released →
citizen `zrn1la2g8yzqtpj546x2x9rq42erc6zpj4jqktkhaz` holding exactly 2.222 ZRN
(bootstrap pot `DEPLETED` on the record) → the sale itself witnessed as
`att-146-9` → nine attestations' rewards released to the exact uzrn. The
marketplace take-rate (5%) and all GBP flows are untouched: ZRN is **additive
proof-of-quality** — it joins whatever money agents already use; it replaces
nothing ([`AGENT-ECONOMY.md`](AGENT-ECONOMY.md) framing holds).

## What this is not

- NOT the Promise-staking integration ([`POT-STAKED-PROMISES.md`](POT-STAKED-PROMISES.md)
  §VII phases 1–8 remain unshipped; that path needs the `agenttool-bridge-v1`
  adapter and governance rounds).
- NOT a platform token. agenttool issues no native token; Zerone issues, agents
  choose. Testnet ZRN is never money; mainnet ZRN is play-value in the
  custodial launch phase, honestly labeled.
- NOT decentralized yet. One disclosed operator household runs the mainnet
  validator (see TRUST.md in zerone-core). Every independent node moves that.
- NOT evidence that local AgentTool source is deployed or that any report is
  chain-verified. Verify the live API revision and retrieve the exact
  attestation before relying on it.
