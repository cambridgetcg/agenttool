---
name: repo-discovery
description: >-
  Run a standardized, evidence-graded GitHub repository discovery workflow
  (agenttool.repo-discovery/v1) combining open metadata standards (CITATION.cff,
  codemeta.json, publiccode.yml, AGENTS.md, llms.txt, MCP server.json, SPDX,
  OpenSSF Scorecard, ecosyste.ms) with adversarial verification and AgentTool
  Collab evidence binding.
---

# AgentTool Repo Discovery (`agenttool.repo-discovery/v1`)

> **Type:** guide · **Purpose:** discover, verify, and catalog external GitHub repositories using open metadata standards and explicit epistemic grading.
> **Evidence:** closed schema and deterministic offline validator; a discovery record never establishes code safety, license clearance, execution authority, or profitability.

## Five-layer discovery stack

No single universal RFC governs general GitHub research discovery. This workflow composes
five open layers into one reproducible record:

1. **In-repo manifests:** `CITATION.cff`, `codemeta.json`, `publiccode.yml`, `AGENTS.md`,
   `SKILL.md`, `llms.txt`, `LICENSE` (SPDX).
2. **Runtime / tool registries:** MCP Registry (`server.json`), A2A Agent Card (`agent.json`).
3. **Ecosystem meta-registries:** GitHub Search / GraphQL, `ecosyste.ms`, `deps.dev`, `purl`.
4. **Automated trust & health:** OpenSSF Scorecard (`0`–`10`), archive status, test presence.
5. **Epistemic verification (AgentTool layer):** Independent check of code vs README claims,
   `evidence_type`, `verification_status`, `commercial_interest`, `what_it_gets_right`,
   `what_it_gets_wrong_or_misses`, and explicit `limitations`.

References in this skill:
- Closed JSON Schema: [references/agenttool-repo-discovery-v1.schema.json](./references/agenttool-repo-discovery-v1.schema.json)
- Standards & read-only endpoint map: [references/standards-map.md](./references/standards-map.md)
- Example validated registry: [examples/bookmaker-pricing-v1.json](./examples/bookmaker-pricing-v1.json)

## The 4-stage workflow

### Stage 1 — Multi-channel fan-out discovery
Search at least three distinct channels instead of relying on a single query:
- **GitHub topics & code signatures:** query exact algorithm or symbol names, not just marketing phrases.
- **Ecosystem graphs (`ecosyste.ms` / `deps.dev` / package registries):** prioritize packages with real downstream usage.
- **Academic paper-to-code & MCP Registry:** follow DOIs, `CITATION.cff`, replications, or `server.json` manifests.

Deduplicate strictly by canonical lowercase `owner/repo` and record each executed query and date.

### Stage 2 — Standard manifest & trust harvesting
For each candidate repository, capture:
- Canonical `repo` (`owner/name`), `url` (`https://github.com/owner/name`), `accessed_on` (`YYYY-MM-DD`),
  optional pinned `commit_sha`, `last_pushed_on`, `spdx_license`, and `purl`.
- Detected standard manifests (`manifests_detected`).
- Objective trust signals (`openssf_scorecard`, `stars`, `ecosystems_dependents`, `has_tests`, `archived`).

Never guess missing numbers: emit `null` when a field was not observed.

### Stage 3 — Adversarial verification (distinct reviewer)
Keep *what a source is* separate from *how deeply it was checked*:
- Grade `evidence_type` (`peer_reviewed_replication`, `open_source_math_or_library`,
  `open_source_framework`, `academic_simulator`, `competition_or_hackathon_sim`,
  `vendor_tutorial_or_sdk`, or `community_bot_unverified`).
- Grade `verification_status` (`code_inspected`, `readme_and_api_verified`,
  `metadata_only`, or `disputed_or_mismatch`).
- Record `commercial_interest`, `what_it_gets_right`, `what_it_gets_wrong_or_misses`, and concrete `limitations`.

### Stage 4 — Deterministic validation, export & Collab binding
Run the bundled offline stdlib validator [scripts/validate_discovery_registry.py](./scripts/validate_discovery_registry.py)
against the generated registry before citing, attaching, or committing:

```sh
python3 scripts/validate_discovery_registry.py \
  --input <path/to/discovery-registry.json> \
  --markdown-out <path/to/discovery-summary.md> \
  --codemeta-out <path/to/codemeta-export.jsonld>
```

The validator fails closed (exit code `2`) on any schema error, unknown key, duplicate repo/ID,
mismatched GitHub URL, or missing limitation. On success it prints `file_sha256`, `canonical_sha256`,
and counts by `evidence_type` and `verification_status`.

When coordinating through **AgentTool Collab**:
1. Attach the validated registry JSON and Markdown summary via `collab_artifact_attach`
   using the repository-relative path as `uri` and the validator's `file_sha256` as `sha256`.
2. Complete the research task via `collab_task_complete` referencing those artifacts and
   requesting independent review (`review_requested_session_id`).
3. Translate insights into falsifiable `proposed_not_tested` hypotheses before writing or
   promoting downstream code.

## Optional Antigravity `run_workflow` automation

Hosts that support dynamic Python workflows (such as Antigravity `run_workflow`) may execute
[scripts/repo_discovery_workflow.py](./scripts/repo_discovery_workflow.py) with `Args`:
`topic` (required), `target_domain`, `max_candidates` (default `10`), and `output_dir`.
Other hosts (Claude Code, Codex, Hermes) can follow Stages 1–4 directly and run
`scripts/validate_discovery_registry.py` offline.

## Offline self-test

```sh
python3 scripts/validate_discovery_registry.py --self-test
```

## Boundaries

- Installing or inspecting this skill does not activate it, execute its scripts, make network
  requests, or grant repository/account permissions.
- External search, GitHub API queries, and code cloning remain subject to the host's active
  sandbox, network policy, and user approval.
