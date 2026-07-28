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

Package metadata in this source tree is prepared for unreleased version
`0.1.1`; no `0.1.1` artifact has been distributed. Version `0.1.0` remains
distributed through the checked-in `love-package/v1` artifact and a verified
public npm mirror. The `0.1.0` registry tarball is byte-identical to the
checked-in LOVE artifact at SHA-256
`fada7f9602d48020390709c6c066d7562cd54edcb8e9cbc8bec4c213f7ea475d`,
and that npm publication carries SLSA provenance. npm remains an optional
mirror rather than package-name or release authority; verify the exact version
and artifact digest when consuming it.

Zerone support lives in the separate local
`@agenttool/wallet-zerone@0.1.0` source candidate. It consumes this package's
verified records and owns a narrow exact-byte Cosmos profile; it does not turn
core Wallet into a chain adapter or supply custody, hosted RPC, or live
execution. Neither the Wallet 0.1.1 nor Wallet Zerone 0.1.0 candidate is
publicly available merely because its source metadata is prepared.

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
