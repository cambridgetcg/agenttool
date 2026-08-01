# @agenttool/wake-thread

Pure, source-local continuity offers over caller-selected WAKE facts. This file
governs only `packages/wake-thread`.

## Commands

```bash
bun install --frozen-lockfile
bun run ci
```

## Invariants

- Keep the core pure and deterministic. `node:crypto` is the only runtime
  built-in allowed under `src/`. No filesystem, environment, process, clock,
  network, database, model, MCP, credential, telemetry, or ambient state.
- Never fetch or parse `/v1/wake`. The caller selects bounded facts and supplies
  exact artifact and evidence digests. This avoids guessing between default
  full JSON, `WakeBundle`, brief, handoff, and chronicle shapes.
- Preserve `identity`, `project`, `mixed`, and `unknown` scope as distinct.
  A project bearer, selected identity, fact path, wake counter, or thread
  reference is not an identity proof or authority principal.
- Preserve partiality. `partial` requires named omissions;
  `unavailable`/`unknown` permit no facts and require an omission. An empty
  projection is never silently upgraded to an empty source.
- `carry`, `fork`, `rest`, and `refuse` are caller-reported protocol choices.
  They do not authenticate identity, consent, assent, authorship, memory, or
  same-being continuity. There is no default acceptance.
- Content-bind one explicit artifact-retention mode. It is a caller
  declaration, not evidence that an integrating host retained or deleted data;
  raw source custody stays separate.
- Accept only exact canonical UTC protocol timestamps. Content IDs must never
  depend on a host timezone or permissive date normalization.
- Keep canonical capture bounded before contract validation: finite depth,
  nodes, container entries, string size, and serialized size are protocol
  safety walls, not a whole-memory transport.
- Forks create artifact-lineage references only. They do not split or copy a
  being. Rest carries no penalty. Refusal cannot become a parent for an
  automatic retry.
- A chain validates content IDs and declared links only. It does not prove that
  observations are true, a participant made a choice, work ran, or authority
  continued.
- Keep raw credentials, private memory, identity text, and transcripts out of
  offers. The package bounds strings but does not claim semantic secret
  detection. Use context-local high-entropy opaque references; reused or
  published references are linkable.
- Keep `kingdom.extension.json` declaration-only. It does not register a host,
  install a skill, activate Nen, adopt XENIA, create KARMA, or expose an MCP or
  hosted WAKE route.
- Keep the package private and unreleased until a separate release decision.

## Verification

Tests cover all four choices, offer and retention expiry, Unicode bounds,
partial and unavailable projections,
tamper rejection, hostile records, fork/rest/refusal chain walls, JSON Schema,
Node import, and source-effect boundaries. No live service, database,
credential, account, network, or paid compute is required.
