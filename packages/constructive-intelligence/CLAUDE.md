# `@agenttool/constructive-intelligence`

Private, local-only Bun pilot for structural constructive-evidence receipts.
It owns canonical receipt validation, the reviewed Zerone tree/TLS quest pin,
deterministic E0–E6 structural evaluation, and one explicit SQLite ledger.

## Commands

```bash
bun install --frozen-lockfile
bun run ci
```

## Invariants

- Keep protocol `zerone.constructive-evidence-receipt/v1` and mode
  `shadow_unfunded`.
- Keep the reviewed tree normative digest
  `43f65d91d700c9ed7a874f0a34520fc815d51d89a67255aa75f7e8be4ecd7a9a`,
  TLS quest digest
  `bcefb7c2d177c79d135722bf38a689d122fe564eb39ebec873b0020dacb46206`,
  and separate raw artifact digest independently verified.
- Keep canonical JSON strict, bounded, integer-only, duplicate-name-aware, and
  domain-separated. Every receipt body member must affect `evidence_id`.
- Keep the receipt object graph closed. `economic_payee` is exactly null.
  Reject economic, score/rank/winner/approval, and raw-evidence escape fields.
- Keep unexpected or unknown impact private-triage-only and digest-only.
- Keep all execution declared owned or explicitly authorized; never turn the
  declaration into permission or proof of authority.
- Keep exactly two application tables, global source-event uniqueness, exact
  retry semantics, conflict refusal, per-pin event chains, immediate writer
  transactions, append-only triggers, owned non-group/other-writable database
  parents, no symlink/hardlink following, and 0600 database/WAL/SHM/journal
  modes.
- Keep supersession prior-only, same-ledger, same-level, same-deliverable, and
  single-successor. Preserve full history; evaluate only active receipts.
- Keep E0→E6 forward-only. E3 is 3 clusters, 2 organizations, 3
  implementations, 2 environments, 12 cases, a checker/corpus digest, and
  after-freeze confirmed independent reproduction. Contradicted or
  inconclusive evidence cannot advance the frontier. E4 is a confirmed
  challenge/repair receipt, E5 is an exact allowed independent-adoption
  receipt, and E6 is maintained by a maintainer.
- Keep freeze, observation, and receipt creation inside the pinned standards
  status window.
- Keep the output explicitly structural-only: no correctness, breakthrough,
  qualification, reward eligibility, permission, authority, or distributed
  exactly-once claim.
- Keep paths explicit and regular-file inputs bounded. Do not add discovery,
  default state paths, network access, URLs, credentials, signing, custody,
  consensus writes, publication, or deployment.
- Keep the package private with no runtime dependencies, no prepack hook, and
  no npm or LOVE release allowlist entry. External integration, release,
  publication, funding, or settlement needs a separate reviewed change.

## Tests

Cover canonical edge cases and vectors; every-field content binding; tree and
quest pins; status expiry; closed economics/safety walls; exact replay and
changed replay; concurrent retry; ordering and E3/E5 predicates; reopen and
durability; permissions; triggers; chain verification; and every CLI command.
