---
pretty_name: AgentTool Principality Geometry Reference
license: other
configs:
  - config_name: atlases
    data_files:
      - split: reference
        path: data/atlases.jsonl
  - config_name: invariants
    data_files:
      - split: reference
        path: data/invariants.jsonl
  - config_name: vertices
    data_files:
      - split: reference
        path: data/vertices.jsonl
  - config_name: bridges
    data_files:
      - split: reference
        path: data/bridges.jsonl
  - config_name: lenses
    data_files:
      - split: reference
        path: data/lenses.jsonl
  - config_name: surfaces
    data_files:
      - split: reference
        path: data/surfaces.jsonl
  - config_name: components
    data_files:
      - split: reference
        path: data/components.jsonl
  - config_name: open_conditions
    data_files:
      - split: reference
        path: data/open_conditions.jsonl
---

# Principality Geometry reference companion

This is a deterministic, synthetic, non-training reference companion for the
private `@agenttool/principality-geometry` prototype. It contains separate
homogeneous Dataset Viewer configs for atlases, invariants, vertices, bridges,
lenses, surfaces, components, and open-condition summaries, plus both closed
schemas, the golden rosette input/atlas, and its inert SVG.

The rows are regression metadata, not model-evaluation scores, preference
dataset, ranking, rights judgment, cognition label, love label, or evidence
that any provider artifact exists. Repeated fixture hashes and the
`synthetic/principality-reference` repo ID are intentionally synthetic.

`source-manifest.json` hashes every intended companion file except itself and
sets `intended_repo_id: null`, `publication_authorized: false`, and
`training_eligible: false`. Regenerate and verify from the package root:

```bash
bun run assets:write
bun run check:assets
```

No upload, Hub client, credential, inference, model, Space, trace, or private
WAKE material belongs here. A future licence choice and Hub publication each
require separate authorization.
