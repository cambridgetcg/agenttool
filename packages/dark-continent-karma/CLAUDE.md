# Dark Continent KARMA proposal adapter

This public developer-preview package produces closed
`kingdom.kg-proposal/0.1` artifacts from
caller-supplied commit/file hashes and declared Hugging Face metadata. It is
inspired by KARMA's knowledge-graph enrichment design; it is not a
KARMA-compatible runtime.

## Boundaries

- Keep runtime dependencies at zero and all public functions pure.
- Do not add network, environment, filesystem, write, model-execution,
  credential, wallet, publication, deployment, or Crown-authority paths.
- Preserve the exact bundled Dark Continent projection and snapshot digest.
- Require immutable Hub commit revisions and exact file SHA-256 values.
- Keep graph operations provisional. Extend consequence/review history only via
  the helper; its unsigned hashes are not persistent immutability or authorship.
- Store review note digests, not raw review prose, in proposal artifacts.
- Classify single-line metadata labels and allow only content-addressed evidence
  references. Proposal validation is not HF export approval.
- Never add participant score/rank/XP/trust values or mechanisms, `sameAs`, or
  inferred identity. Explicit zero/false denial boundaries remain required.
- Keep `authorizes_crown`, all action authorities, and every Dark Continent
  wall verification false.
- `observed_on` values are fixed source-evidence dates, never clock reads. A
  refreshed observation requires deliberate source review and a contract
  version decision.

## Verification

```sh
npm ci --ignore-scripts
node --test tests/*.test.mjs
bun run ci
npm pack --dry-run --ignore-scripts
```

The package may propose graph facts. It does not modify KINGDOM, call KARMA,
contact Hugging Face, approve a proposal, upload an export, or authorize the
Crown.
