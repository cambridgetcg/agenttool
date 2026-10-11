# @agenttool/wallet changelog

Changes to `@agenttool/wallet`. Each released version is recorded by its
checked-in `love-package/v1` manifest under
`apps/docs/packages/v1/@agenttool/wallet/`. This file starts on 2026-10-11 and
does not restate earlier releases.

## Unreleased

Source only. There has been no version bump or release, so the published
`0.1.3` artifact (LOVE, and its npm and GitHub mirrors) does not contain these
changes.

### Changed

- Overlapping call rules resolve most-restrictively.
  `assertIntentWithinCapabilityStatic()` now evaluates every call rule that
  matches an intent call or simulation effect. The item is allowlisted if any
  rule matches, and it needs `approval_threshold` distinct host-verified
  approval IDs if any matching rule has `requires_approval: true`. Before, only
  the first matching rule in sorted order was read, so the result could depend
  on how unrelated action or method strings sorted. This only tightens: an
  intent under a capability that relied on first-match leniency is now denied
  unless enough approvals are supplied. See the Agent Wallet 0.1 §5.2 erratum
  (2026-10-11).
- The authorization context is snapshotted at entry.
  `assertIntentWithinCapabilityStatic()` reads each option once and copies
  `context` as plain data before validating it, so a getter, proxy, or custom
  iterator can no longer give the distinctness check and the approval count
  different values. Accessor properties, own symbol properties such as a
  custom `Symbol.iterator`, non-plain objects, and unknown keys in `context`,
  `context.usage`, or a `spent` entry are now refused with `INVALID_INPUT`, and
  the context is held to the canonical JSON node-count and depth limits.

### Added

- Tests for every denial branch in `src/capability.ts`.
- `vectors/agent-wallet-v0.1-negative-vectors.json`: seven deterministic cases
  a conforming implementation must refuse (signature scalar not reduced,
  small-order authority key, both overlapping-rule shapes, simulation fee asset
  mismatch, watch-only descriptor, failed simulation). `files` already includes
  `vectors/`, so a future release tarball would carry it; it has no subpath
  export, and the `./vectors.json` export is unchanged.

### Documentation

- Agent Wallet 0.1 now says signing receipts are attestation-only with no
  cross-record binding check (§5.5, §12), and names `intent_id` and
  (`grant_id`, `nonce`), never `record_id`, as the intent replay dedupe keys
  (§6 step 6).
