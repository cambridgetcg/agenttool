# Skills to YUTABASE planner guidance

This package is a pure deterministic planner. It consumes only the closed,
minimized metadata contract in `schema/` and returns card/thread intentions.
It does not read an inspection report or skill tree, validate the upstream
report schema, recompute digests, persist data, execute models, or call a
network.

Treat JavaScript inputs as inert JSON-shaped data. The runtime must detach one
snapshot from own enumerable data properties on plain/null-prototype objects
and own enumerable elements on dense standard arrays. Reject Proxies before
reflection, and reject accessors, inheritance, sparse values, symbols, custom
prototypes, and custom array fields without invoking caller behavior. Planning
and direct selection hashing must use only that snapshot; claimant is captured
once through the same boundary.

Keep `agenttool-skills-yutabase-plan/v0.1`, its UUID namespace, two decks, one
word, field allowlist, and identity inputs frozen together after first external
retention. A pre-release contract finalization may retain v0.1 only after
confirming that no public artifact or persisted plan exists and re-pinning the
complete identity vectors. Any later semantic or identity change requires a
new profile and namespace.

`report_digest` always uses
`agenttool.skills/report-stable-json-sha256-v1`. The category invariant is
`file_count = 1 + script_count + resource_count`. `recorded_at`, claimant, and
claim sources never enter IDs or typed card fields; executors retain the first
claim on an exact address/field replay. Every minimized name carries a closed
`name_kind`: `reported` permits only portable lowercase hyphenated names, while
`redacted_alias` permits only exact upstream `<redacted-N>` aliases bounded by
the report redaction ceiling. The kind participates in selection, snapshot,
and evidence identity.

The caller-supplied inspector revision is external to report bytes and remains
part of inspection identity, but the planner validates only its 40/64-hex
shape. Projected fields label it `caller_supplied_unverified`, limitations say
verification was not performed, and no text may imply a Git lookup or an
artifact-to-revision proof.

Never add skill bodies, descriptions, prompts, paths, issue messages,
requirement names, credentials, identities, model output, scores, ranks, XP,
ability/vow interpretations, or permission/consent/truth effects. KAKIN-native
Nen manifests and DeepSeek/Hugging Face proposals are separate evidence lanes;
their digests must not substitute for Agent Skills inspection digests.

The existing Correspondence projector does not support this book. Any durable
adapter must be separately reviewed against `PERSISTENCE-CONTRACT.md`.

Run `bun run ci` before reporting the package complete. Publishing remains a
separate protected workflow and is not authorized by a successful test run.
