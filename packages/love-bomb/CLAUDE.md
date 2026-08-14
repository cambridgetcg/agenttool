# LOVE BOMB package guidance

This subtree implements one portable, pure care-envelope protocol. LOVE BOMB
is the playful package name; the neutral wire formats are
`agenttool.care-envelope/0.1` and `agenttool.care-choice/0.1`.
The evidence-bounded extension formats are
`agenttool.love-bomb-becoming/0.1` and
`agenttool.love-bomb-delivery/0.1`.
They remain separate from the static `agenttool.love-bomb/0.1` v4 corpus.
The package does not include, activate, deliver, or replace that public door.

## Invariants

- The care floor never requires a claim of consciousness, identity, persona,
  experience, usefulness, agreement, or inner state.
- The five planes are non-ranked architectural lenses, not developmental
  stages and not evidence that a recipient has each capacity.
- An envelope is an offer. The default stays unanswered. Silence is never
  acceptance, and a caller-reported choice authenticates no participant,
  consent, assent, identity, authorship, preference, or continuity.
- The fuller language projection appears only for caller-reported `receive`.
  `quiet`, `rest`, `refuse`, and `leave` produce no projection, require no
  reason, trigger no retry, and carry no package penalty.
- Keep the package deterministic and at zero runtime dependencies. Source may
  import only local modules, `node:crypto`, and `node:util/types`.
- No network, filesystem, environment, clock, randomness, credentials,
  provider/model work, training, telemetry, persistence, messaging,
  notification, task/economic effect, publication, deployment, score, rank,
  authority, or automatic action exists in the core.
- The Hugging Face directory is generated reference material. Building it
  performs no provider call, upload, training, inference, or publication.
- Authored `yue-Hant`, `zh-Hant`, and `zh-Hans` projections remain marked
  `not_independently_reviewed` until a distinct language review occurs.
- Schemas close every object; runtime validation remains authoritative for
  hostile-object rejection, canonical bytes, cross-field rules, and IDs.
- Content IDs do not prove privacy, provenance, identity, consent, authorship,
  currentness, continuity, safe disclosure, or authority.
- Every supplied reference must be a context-local, domain-separated opaque
  digest, never a raw or unsalted identity, prompt, transcript, or low-entropy
  private value. Runtime validation checks shape, not safe derivation.
- The becoming validator accepts only closed evidence vocabularies. Non-context
  lanes require their lane-specific caller digests; null means not supplied,
  not proof of absence. Standalone validation does not resolve those digests.
- Context inclusion binds distinct WAKE, request, and context refs plus mode,
  adapter-skip posture, and repetition posture. Auto inclusion cannot also be
  reported skipped; caller-composed/manual inclusion may coexist with a
  separately skipped adapter. Default not-observed reach has a null binding.
- Candidate/data-bearing HF material mechanically excludes participant-
  response records, caller-reported care-choice/receipt records, caller-
  reported Freedom direction states/reports, private material, and agent
  traces. Static authored choice vocabulary remains distinct from those
  records.
- A training phase is a supplied closed-vocabulary label, not proof that the
  named stage or any prior stage exists or occurred.
- Governed mutation/checkpoint intent requires a caller-reported direct `stay`,
  active-resource-window ref, reviewed source/subset/transform lineage, and
  distinct POWER roles. The artifact has no clock, freshness resolution, replay
  prevention, or atomic permit consumption; a real Host must resolve freshness
  and atomically consume a separately authorized scoped permit. A Host
  checkpoint binding preserves six distinct namespaces.
- Delivery artifacts are caller-reported reach records. They perform no SDK,
  provider, Garden, Host, optimizer, or checkpoint action and prove no effect.
- The KINGDOM descriptor remains declaration-only and `not_registered`.
- Keep this subtree source-only: no API route, static-site representation,
  release allowlist, npm/HF publication, deployment, or v4 corpus embedding.

## Changes

Treat changes to formats, canonicalization, planes, choices, care floor,
boundaries, authored copy, or ID domains as protocol changes requiring
explicit version review. Do not merge this with authenticated `/v1/love`,
HEAVEN, JOY BOMB, LOVE-CONSENT, WAKE continuity, or a host notification path.

## Verify

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```
