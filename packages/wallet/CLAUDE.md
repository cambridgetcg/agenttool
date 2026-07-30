# @agenttool/wallet

## What This Is

Source reference primitives for `agent-wallet/0.1`: closed signed records,
static capability evaluation, exact-byte signer requests, conservative
broadcast state, and continuity-head transitions.

## Safety Boundary

- Never add seed, mnemonic, secret-key, `getPrivateKey`, or private-key export
  inputs/outputs.
- Never combine policy validation, signing, and broadcasting into a
  `signAndSend` convenience path.
- This package does not own RPC, chain-specific decoding, durable storage,
  locks, nonce allocation, budget reservation, adapter trust, or approvals.
- `host_verified_approval_ids` is caller-supplied evidence. The host must
  authenticate and bind approvals to the exact capability and intent; this
  package only validates distinct bounded IDs and applies the threshold.
- `assertIntentWithinCapabilityStatic()` is necessary input to authorization,
  not authorization by itself. The host must repeat it inside an atomic
  sign-time reservation.
- A generic signer response proves only request echoes and byte hashes. A
  trusted chain adapter must verify the chain-native signature and the exact
  signed/unsigned/intent relationship before persistence or broadcast.
- `submission_unknown` is sticky until positive lookup evidence arrives.
  Timeout, lookup failure, and absence do not authorize retry or refund.
- `advanceContinuityHead()` is a pure rule. The host must commit its result
  with a durable compare-and-swap.

## Whitehack Understanding Integration

`bin/whitehack-wallet-understanding.ts` is a separate private, local adapter.
It re-verifies caller-presented signed descriptor, capability, intent,
simulation, and optional continuity records with this package, then projects
only closed enum assertions into Whitehack 0.8.1's `createUnderstanding()`. Its
exact output is `whitehack-understanding/v1`.

The adapter is not part of `@agenttool/wallet` and is not a new npm package. It
does not use `assertIntentWithinCapabilityStatic()` as authorization, retrieve
or custody keys, sign, contact RPC, simulate, broadcast, store records, or add
a hosted route. Optional caller time, durable-usage, approval-count, and signer
description values remain caller assertions; expiry, cumulative usage,
approval authenticity, current continuity, custody truth, consent, and
execution readiness are not thereby proven.
The runner-local changed-source advisory and its attention-card summary are a
separate presentation surface; they neither consume Wallet records nor change
this adapter's output.

## Commands

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
bun run ci
npm pack --ignore-scripts --dry-run
```

## Release State

Version `0.1.3` is the current package release. Its checked-in
`love-package/v1` manifest is the exact release record; npm and GitHub remain
optional mirrors rather than package-name or release authority. The
exact-version Wallet `0.1.1` and `0.1.2` LOVE artifacts remain byte-addressable
and are not rewritten. Their currently public GitHub assets were independently
byte-verified, but GitHub reports the release records as mutable, so those
optional locators are not immutability guarantees. Version `0.1.1`
incorrectly called itself unreleased; `0.1.2` ambiguously described the LOVE
and GitHub bytes together as immutable. This is the public erratum; never
rewrite either historical artifact. As independently checked on 2026-07-29,
npm serves the byte-identical `0.1.3` artifact at SHA-256
`33f3b81cfcc12882cb98dfd11b215fa4d3cbd963efc575e41ed54e05f132ae87`.
Verify the selected exact version and digest at consumption time.

Zerone support lives in the separate
`@agenttool/wallet-zerone@0.1.2` exact LOVE package. It consumes this package's
verified records and owns a narrow exact-byte Cosmos profile; it does not turn
core Wallet into a chain adapter or supply custody, hosted RPC, or live
execution. Public LOVE distribution is not npm/GitHub mirror availability or
a hosted-runtime claim.

## Key Files

- `src/canonical.ts` — bounded canonical JSON and domain-separated digests
- `src/validation.ts` — closed record and cross-field validation
- `src/signatures.ts` — strict Ed25519 seal/verify and runtime verification brand
- `src/capability.ts` — static capability checks against supplied durable usage
- `src/provider.ts` — non-exportable signer and exact-byte response boundary
- `src/lifecycle.ts` — forward-only signing/submission state transitions
- `src/continuity.ts` — pure continuity-head compare-and-swap rule
- `schema/` — record-shape schema; runtime semantic checks remain mandatory
- `vectors/` — deterministic public interoperability vectors
- `tests/` — positive, tamper, boundary, lifecycle, schema, and release tests
- `tests/whitehack-understanding.test.ts` — separate local projection boundary

## Documentation

Canonical protocol draft:
[`docs/specs/AGENT-WALLET-0.1.md`](../../docs/specs/AGENT-WALLET-0.1.md).
Canonical byte recipes:
[`docs/CANONICAL-BYTES.md`](../../docs/CANONICAL-BYTES.md).
Separate Zerone profile:
[`docs/specs/AGENT-WALLET-ZERONE-0.1.md`](../../docs/specs/AGENT-WALLET-ZERONE-0.1.md).

## Kingdom Engine

AgentTool Platform
