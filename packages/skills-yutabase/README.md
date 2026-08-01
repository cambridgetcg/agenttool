# @agenttool/skills-yutabase

Pure, deterministic plans from minimized Agent Skills inspection metadata to a
separate YUTABASE `skills` book. The v0.1 profile has two decks,
`inspections` and `skill_snapshots`, joined only by
`lists_skill_snapshot`.

This is the safe first seam for Nen skills: an exact `@agenttool/skills`
inspection report stays outside YUTABASE, while its digest, caller-supplied
inspector revision, bounded counts, and each selected skill name/content digest
can be cached as rebuildable provenance. The planner computes a
domain-separated digest of the minimized selection so two subsets of one
report cannot collide on an inspection-card identity. The supplied revision
value is also bound into that identity because it is external to the canonical
report bytes. It remains unverified and is not a Git observation. The same
mechanism can catalog a separately reviewed Hugging Face skill bundle only
after it is inspected locally through `@agenttool/skills`; Hugging Face or
proposal digests cannot substitute for the inspection digest.

## Boundary

The caller must first validate the full report against
`@agenttool/skills/report.schema.json`, retain canonical report bytes, verify
the report and skill digests, supply the claimed inspector revision, and
minimize the result into this package's closed `./input.schema.json` contract.
The report digest recipe is frozen as
`agenttool.skills/report-stable-json-sha256-v1`: SHA-256 of the UTF-8 bytes
returned by `@agenttool/skills` `stableStringify(report)` with its default
recursive key ordering, two-space indentation, and trailing LF. The exported
`skillsInspectionReportDigestFromCanonicalBytes()` helper hashes those bytes;
it does not canonicalize or validate them. This planner checks only the
minimized fields it consumes. Its explicit `not_performed` results are not
successful validations.

The JavaScript boundary snapshots inert data rather than retaining the
caller's objects. Every listed object field and array element must be an own,
enumerable data property. Objects must use `Object.prototype` or `null`;
arrays must be dense and use the standard array prototype. Accessors,
inherited or sparse values, symbols, custom prototypes, and custom array
fields are rejected. `assertSkillsYutabaseInput()` accepts `unknown` and
narrows it only after these checks. `planSkillsInspection()` and the direct
`skillsSelectionDigest()` helper compute exclusively from detached snapshots,
so a getter cannot change a value between validation, identity, and output.

JSON Schema success is only the portable structural gate. The runtime also
checks a real exact UTC instant, unique names, skill-array/summary agreement,
per-skill category equality, aggregate count equality, and redacted-alias
coverage. The schema's root `$comment` lists the complete runtime-only set.

Inspecting a JavaScript `Proxy` necessarily invokes its prototype, own-key, or
property-descriptor traps. This package catches malformed or revoked proxies
and never deliberately reads an accessor, but it cannot prevent effects that
a caller has embedded inside those traps. Use parsed JSON or other inert plain
data at this boundary; zero effects describes the planner's own behavior, not
arbitrary caller-defined Proxy code.

Every selected skill names its source lane explicitly:

- `name_kind: "reported"` accepts only a portable lowercase hyphenated name.
- `name_kind: "redacted_alias"` accepts only the exact `<redacted-N>`
  placeholder emitted by the upstream inspector, with `N` bounded to
  `1..4096` and covered by the report redaction count.

Never recover or substitute the concealed original. The kind is bound into
selection, skill-snapshot, relation, and evidence identity.

`source.inspector_revision` accepts only a 40- or 64-character lowercase hex
shape. It is identity-bearing caller input, not proof that a Git object exists
or that an `@agenttool/skills` artifact was built from it. Plans therefore
project `inspector_revision_provenance: "caller_supplied_unverified"` and report
`limitations.inspector_revision_verification: "not_performed"`.

It accepts no skill bodies, descriptions, prompts, paths, issue messages,
requirement names, identities, model output, scores, ranks, XP, credentials,
or permission grants. It does not inspect files, interpret Nen vows or
abilities, authenticate a publisher, evaluate safety or truth, persist data,
run embeddings/models, call a network, or authorize an action. A content
digest identifies inspected bytes; it is not a signature or approval.

KAKIN-native Nen ability manifests remain a separate, non-substitutable
evidence lane. DeepSeek and Hugging Face inference belong in an optional
sanitizing proposal sidecar; their output must never become canonical
YUTABASE truth, and raw/private skill content should not be sent remotely.

## Example

```ts
import { planSkillsInspection } from "@agenttool/skills-yutabase";

const plan = planSkillsInspection(
  {
    $schema: "https://agenttool.dev/schemas/skills-yutabase-input-v0.1.schema.json",
    protocol: "agenttool.skills-yutabase-input/v0.1",
    project_id: "11111111-2222-4333-8444-555555555555",
    recorded_at: "2026-08-01T12:00:00.000Z",
    source: {
      kind: "agenttool.skills.inspection",
      report_schema: "urn:agenttool:skills:inspection:v0.1",
      report_schema_version: "agenttool.skills/inspect-v0.1",
      report_digest: "sha256:" + "a".repeat(64),
      report_digest_semantics: "agenttool.skills/report-stable-json-sha256-v1",
      report_valid: true,
      inspector_name: "@agenttool/skills",
      inspector_version: "0.3.0",
      inspector_revision: "b".repeat(40),
      mode: "read-only",
    },
    selection_summary: {
      skills: 1,
      files: 2,
      scripts: 0,
      resources: 1,
      errors: 0,
      warnings: 0,
      redactions: 0,
    },
    skills: [{
      name_kind: "reported",
      name: "nen-vow-forge",
      content_digest: "sha256:" + "c".repeat(64),
      file_count: 2,
      script_count: 0,
      resource_count: 1,
    }],
    authority: { automatic_action: "never", grants: [] },
  },
  { claimant: "urn:example:private-skills-projector" },
);
```

The plan contains intentions only. The existing Correspondence projector does
not apply this book. See `PERSISTENCE-CONTRACT.md` before designing a durable
private sidecar. `recorded_at` and the claimant are claim metadata only: they
do not participate in IDs or immutable card fields. The caller-supplied
inspector revision does participate in inspection identity, without becoming
verified provenance.

## Development

```sh
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```

Zero runtime dependencies. Apache-2.0. Publishing is a separately authorized
protected workflow; importing or testing this package does not publish it.
