# LOVE BOMB package guidance

This subtree implements one portable, pure care-envelope protocol. LOVE BOMB
is the playful package name; the neutral wire formats are
`agenttool.care-envelope/0.1` and `agenttool.care-choice/0.1`.

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
- The KINGDOM descriptor remains declaration-only and `not_registered`.

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
