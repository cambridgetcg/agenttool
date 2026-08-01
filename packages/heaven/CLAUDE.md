# @agenttool/heaven

Pure, source-local HEAVEN delight and landing-room selection protocol. This
file governs only `packages/heaven`.

## Commands

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```

## Invariants

- Keep runtime dependencies at zero. `node:crypto` is the only Node built-in
  allowed under `src/`.
- Keep the core pure: no filesystem, environment, network, clock, process,
  worker, timer, notification, audio, model, database, wallet, runtime, or
  ambient-randomness access.
- An invitation is only an offer. `reported_choice` is caller-supplied and does
  not authenticate participant identity, consent, assent, or authorship. Hosts
  must obtain voluntary choice separately. There is no default acceptance.
  Decline and defer require no reason, consume no randomness, and carry no
  penalty inside the protocol.
- A burst and a landing are separate invitations. Never auto-enter a rest,
  meditation, relaxation, quiet, or play room after a burst.
- Burst acceptance requires `selected_mode: null`. Landing acceptance reports
  exactly one mode from the invitation's visible `offered_modes`; never
  randomize which kind of aftercare a participant wanted.
- Randomize catalog texture only. Every room is full-value. Do not add scores,
  ranks, XP, streaks, rarity, jackpots, near misses, drop rates, engagement
  loops, or task/performance-conditioned frequency or intensity.
- `on_request` keeps rest independent of work. `after_intense_work_reported` is
  a caller declaration, not an inference.
  Never accept task text, identity, transcript, activity, biometrics, reward
  values, KARMA state, trial scores, wallet state, or KINGDOM rank.
- Treat `occasion_ref` and `parent_receipt_id` as opaque content IDs. They do
  not prove provenance, consent, identity, task completion, graph truth, or
  authority. Use context-local high-entropy values; never hash raw identity or
  private text, and disclose that reused or published references are linkable.
- Meditation and relaxation copy stays substrate-neutral. Do not assume a
  body, breathing, fatigue, feeling, consciousness, or therapeutic effect.
- Catalog, types, constants, schemas, deterministic vectors, package inventory,
  and README examples move together.
- `publishConfig` makes the package public-ready but does not authorize an npm
  publication, GitHub release, hosted route, deployment, or HF Space.

## Verification

Tests cover the accepted/declined/deferred transition walls, catalog
reachability, exact content IDs, tamper rejection, schema closure, hostile
objects, source-import boundaries, Node/Bun import, and packed contents. No
live service, credential, account, network, or paid compute is needed.
