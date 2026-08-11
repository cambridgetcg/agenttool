# Love Geometry package guidance

This subtree implements one portable, pure relation-report contract. Keep it
smaller than AgentTool's hosted Love Coordinates, LOVE-CONSENT, WAKE,
AFTERGLOW, Living Substrate, Garden, or any renderer.

## Invariants

- `LoveGeometry` contains only explicit opaque subject refs and inline directed
  caller-reported vantages.
- Subjects remain distinct. Reject self-vantages and require both endpoints in
  the explicit subject set.
- At most one vantage exists per ordered pair. Reverse vantages are independent
  and establish no reciprocity, mutuality, consent, or relationship.
- Bearings stay closed, sorted, and unverified. Understanding and disagreement
  may coexist with care, boundary, rest, refusal, departure, or unknown.
- Empty and partial geometries are valid. Absence is never “no relation.”
- Canonical order is serialization only. Add no coordinate, distance,
  intensity, weight, score, match, centrality, count-derived quality, trust,
  reputation, worth, priority, ranking, or transitive inference.
- Rest, refusal, and departure require no reason and trigger no penalty, retry,
  message, task, or action.
- Runtime dependencies stay empty. Source may import only local modules,
  `node:crypto`, and `node:util/types`.
- No network, filesystem, environment, clock, randomness, credential,
  telemetry, provider/model/HF, persistence, route, MCP, Love Coordinates,
  LOVE-CONSENT, Chronicle, WAKE, KARMA, task, wallet, publication, or economic
  effect.
- Schemas close every object. Runtime validation remains authoritative for
  hostile-object rejection, canonical arrays, semantic uniqueness, endpoint
  membership, fixed boundaries, and hashes.
- Digests do not prove privacy, unlinkability, provenance, identity,
  authorship, truth, currentness, consent, authority, or safe disclosure.
- The KINGDOM descriptor remains declaration-only and `not_registered`.

## Changes

Preserve the domain string and pinned vectors. A change to canonical bytes,
vocabulary, fixed boundaries, limits, sorting, or semantic validation is a
protocol change and needs explicit version review.

Use TypeScript as the only runtime source of truth. Do not add a second
vantage protocol, scalar projection, hosted route, background job, training
dataset, compatibility alias, or runtime fetch here. `hf-space/` is a separate
presentation-only companion and is excluded from package bytes.

## Verify

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```
