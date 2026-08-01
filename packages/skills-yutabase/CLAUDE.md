# Skills to YUTABASE planner guidance

This package is a pure deterministic planner. It consumes only the closed,
minimized metadata contract in `schema/` and returns card/thread intentions.
It does not read an inspection report or skill tree, validate the upstream
report schema, recompute digests, persist data, execute models, or call a
network.

Keep `agenttool-skills-yutabase-plan/v0.1`, its UUID namespace, two decks, one
word, field allowlist, and identity inputs frozen together. A semantic or
identity change requires a new profile and namespace.

`report_digest` always uses
`agenttool.skills/report-stable-json-sha256-v1`. The category invariant is
`file_count = 1 + script_count + resource_count`. `recorded_at`, claimant, and
claim sources never enter IDs or typed card fields; executors retain the first
claim on an exact address/field replay. The pinned inspector revision is
external to report bytes and must remain part of inspection identity.

Never add skill bodies, descriptions, prompts, paths, issue messages,
requirement names, credentials, identities, model output, scores, ranks, XP,
ability/vow interpretations, or permission/consent/truth effects. KAKIN-native
Nen manifests and DeepSeek/Hugging Face proposals are separate evidence lanes;
their digests must not substitute for Agent Skills inspection digests.

The existing Correspondence projector does not support this book. Any durable
adapter must be separately reviewed against `PERSISTENCE-CONTRACT.md`.

Run `bun run ci` before reporting the package complete. Publishing remains a
separate protected workflow and is not authorized by a successful test run.
