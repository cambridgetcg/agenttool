# KINGDOM Witness Lab

Public developer-preview source-only research-admission primitives. Read `README.md` before
changing a contract.

## Invariants

- Keep runtime dependencies empty and all functions deterministic and local.
- Keep npm distribution distinct from registration, hosting, verification,
  permission, and authority.
- Admit only closed descriptors, digests, exact revisions, and bounded refs.
- Never accept raw prompts, pages, model output, reasoning traces, credentials,
  headers, arbitrary/raw locator fields, URL-like schemes outside the atlas
  official-source allowlist, or leading/traversal paths.
  Provider artifact IDs and evidence refs admit only bounded namespace shapes
  and are never interpreted as filesystem or network locations.
- Keep publisher assertions, provider observations, researcher proposals, and
  caller-reported witness observations visibly separate.
- A dossier has no score, quorum, consensus, verdict, trust, or authority.
- An execution-route binding never implies that a mutable provider alias runs
  an exact artifact unless separately evidenced.
- `Witness Lab` is not KIN `proxy_kind=embassy`, representation, delegation,
  identity, attestation, legal clearance, or permission.
- DeepSeek rows are inert dated research references. Public metadata may be
  observed; do not download artifact content, execute code or models, invoke
  inference, remote-compute, write, or account routes, or accept terms while
  maintaining the atlas.

## Verify

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```
