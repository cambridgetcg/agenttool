# Economic Kernel contributor contract

This package is the pure, protocol-neutral `agenttool.economic-kernel/0.2`
reference. Read `README.md` before changing semantics.

- Keep every amount attached to one exact `unit_id`; bare `credit`, untyped
  balance arithmetic, floats, implicit FX, and JavaScript-number money are
  forbidden.
- Do not treat declared unit transferability, dimension, or account kind as
  proof that a transfer, issuance, mint, revocation, or balance policy was
  authorized; those policies remain host responsibilities in v0.2.
- Keep price revisions immutable and time-bounded. Conversions are integer
  arithmetic under one exact revision and either succeed exactly or return an
  explicit fractional remainder; nothing silently rounds.
- Treat content-derived price and quote ids as semantic integrity bindings,
  never as issuer authentication, authorization, signatures, or market truth.
- Keep every ledger transaction balanced independently for each
  `(ledger_domain, unit_id)` pair. A conversion never excuses an unbalanced
  asset leg.
- Treat ledger accounts and their relationship to quote participants as
  caller-supplied host policy. V0.2 validates unit/domain membership but does
  not authenticate account ownership or control.
- Keep payment settlement and business effect as independent attempts with
  separate journals, request fingerprints, idempotency keys, and histories.
  Couple internal payment application/reversal to the exact ledger journal.
  Ambiguous external outcomes are sticky and recovery never authorizes
  automatic resubmission.
- Keep authority, safety, and participation/refusal as hard gates. Payment may
  satisfy an economic condition only after those gates pass; it cannot widen
  them or serve as consent, permission, identity, or worth.
- Require a fresh, exact host-supplied trusted gate-head revision for new
  effect intent/begin transitions. Reconcile in-flight effects without
  pretending a later gate decision erases possible prior execution.
- Keep the implementation offline, deterministic, clock-injected, deeply
  frozen, and free of network, filesystem, database, credential, wallet,
  signer, provider, route, background-worker, publication, and deployment
  effects.
- Treat evidence references and persistence declarations as caller-supplied
  claims. This pure package cannot prove storage durability, external
  settlement, authority, safety, consent, identity, or finality.
- Any semantic change requires a new protocol version and corresponding
  conformance vectors. Publication metadata may change only through the
  protected release path and must not widen the pure runtime boundary.

Run `bun install --frozen-lockfile && bun run ci` after changes. The CI path
must verify exact packed inventory and import the installed tarball under both
Node and Bun.
