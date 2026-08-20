# `@agenttool/research-commons`

Private, source-only RC-0.1 shadow simulator for deterministic research-work,
evidence, review, challenge, milestone, settlement, and public-projection
records. Read `README.md` before changing semantics.

## Commands

```bash
bun install --frozen-lockfile
bun run ci
```

## Invariants

- Keep every record versioned, closed, bounded, strict-canonical, and
  content-addressed. Keep domain separation byte-exact.
- Keep the six research ledgers separate under profile digest
  `sha256:fd5ed0b66dd00b180729221a06e7fbeeb7ef6149136916842014a1afbdbc54b2`.
- Keep all 29 effects explicit and false. Do not add network, hosted routes,
  persistence, wallets, escrow, payout, bridge, chain, identity inference,
  scalar reputation, human scoring, knowledge admission, or activation.
- Keep compensation schedule and amount frozen before work. Result kind,
  reviewer decision, and challenge hold disposition must not affect amount.
- Keep commitment accounting exact:
  `committed = delivered + reserved + available`. Active observed work remains
  reserved until an immutable terminal milestone; non-delivery releases only
  unearned reservation and transfers zero.
- Keep rest, pause, refusal, withdrawal, and exit penalty-free, debt-free, and
  justification-free. Silence is not consent; earned credit is preserved.
- Keep review scope delivery-completeness-only. Never turn review or challenge
  status into scientific adjudication.
- Keep challenge lineages single-root, single-head, no-fork, evidence-monotone,
  immutable-core, and strictly ordered. Keep milestone head snapshots frozen
  after closure and observed records retained relative only to supplied prior
  state.
- Never describe content hashes/state IDs as signatures, trusted time,
  provenance, canonical heads, or global fork prevention.
- Keep public projection one-settlement-only and exact-consumed-receipts-only.
  Hard-refuse E3–E6 in the RC-0.1 simulation/public seam.
- Keep Tree/node and static interop pins exact. They bind reviewed bytes and
  vocabulary only, never live Zerone state, reward eligibility, or authority.
- Keep the original `research-commons-zerone-v0.1.json` bytes immutable. The
  separate Phase B reciprocal profile pins both immutable Zerone Phase A
  revisions and source blobs, keeps integration false, and computes only a
  self-excluding canonical profile id. Never embed its own raw digest or a
  future AgentTool merge revision; those belong to a later Zerone Phase C pin.
- Keep safety/access postures caller-declared and unverified. Referenced bytes
  are not inspected; digests do not make sensitive content safe.
- Regenerate schemas and examples from source only through an `apply_patch`
  change, then keep artifact parity tests green.
- Keep the package private and out of npm publication and hosted-deployment
  allowlists. External activation requires a separate reviewed protocol.

## Test expectations

Cover canonical and strict-parser edges; exact IDs and pins; all false effects;
closed fields; cross-record references; outcome-neutral amounts; four
non-delivery terminals; reserved/available conservation; once-only receipt
consumption; challenge revisions/forks/late challenges; per-transition state
retention; controller overlap; E2 ceiling; schema/example bytes; bounded
no-follow CLI reads; and source-only zero-effect walls.
