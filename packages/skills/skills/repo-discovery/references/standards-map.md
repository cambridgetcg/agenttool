# GitHub Repository Discovery Standards Map (`agenttool.repo-discovery/v1`)

Reviewed **2026-11-20**. Reference map of open specifications and read-only public endpoints
used during Stage 1 (Fan-Out Discovery) and Stage 2 (Manifest & Trust Harvesting).

## 1. In-Repository Machine-Readable Manifests

Probe these root paths on the repository's default branch (or pinned `commit_sha`):

| File | Standard | What to extract |
| --- | --- | --- |
| `CITATION.cff` | Citation File Format (YAML; natively supported by GitHub) | Canonical authors, title, version, DOI, license, linked paper (`preferred-citation`). |
| `codemeta.json` | CodeMeta / Schema.org `SoftwareSourceCode` (JSON-LD) | FAIR research metadata, funding, software requirements, scientific domain. |
| `publiccode.yml` | Publiccode Standard (YAML) | Governance, maintenance status, legal/reuse scope, platform targets. |
| `AGENTS.md` | Agentic AI Foundation / Linux Foundation | Agent build/test commands, import boundaries, forbidden actions, architecture notes. |
| `SKILL.md` | Agent Skills Specification | Reusable agent workflow steps, scripts, and validation checks. |
| `llms.txt` / `llms-full.txt` | `llmstxt.org` convention | Curated Markdown documentation index for LLM consumption. |
| `server.json` | Model Context Protocol (MCP) Registry manifest | Tool server transport, package identifier, version, repository link. |
| `.well-known/agent.json` | Agent2Agent (A2A) Agent Card | Remote agent capabilities, auth requirements, endpoint metadata. |
| `LICENSE` / `COPYING` | SPDX License List | Canonical SPDX identifier (e.g. `MIT`, `Apache-2.0`, `GPL-3.0-only`, `NOASSERTION`). |

## 2. Public Read-Only Discovery & Trust Endpoints

When network access is permitted (via web search, GitHub MCP, or explicitly approved API calls):

| Registry / API | Endpoint Pattern | Signal Provided |
| --- | --- | --- |
| **GitHub Repository Search** | `https://api.github.com/search/repositories?q=<query>&sort=stars` | Repos matching topic/language/push-date filters, license SPDX, archived flag, default branch. |
| **GitHub Code Search** | `https://api.github.com/search/code?q=<symbol>+language:<lang>` | Locates real implementations of specific algorithms/equations (cuts through README-only hype). |
| **ecosyste.ms Repos API** | `https://repos.ecosyste.ms/api/v1/registries/github.com/repositories/<owner>%2F<repo>` | Cross-ecosystem package links, dependent counts, funding, topics, language breakdown. |
| **OpenSSF Scorecard API** | `https://api.securityscorecards.dev/projects/github.com/<owner>/<repo>` | Automated 0–10 supply-chain health score (Maintained, Branch-Protection, CI-Tests, Vulnerabilities). |
| **deps.dev Open Source Insights** | `https://api.deps.dev/v3/projects/github.com%2F<owner>%2F<repo>` | Canonical project-to-package (`purl`) graph and security advisories. |
| **MCP Registry** | `https://registry.modelcontextprotocol.io/v0/servers?search=<query>` | Standardized discovery of MCP servers and their backing GitHub repositories. |

## 3. Canonical Identity Rules

- **Canonical repo key:** lowercase `owner/name`, stripped of `.git` and trailing slashes.
- **Canonical URL:** `https://github.com/<owner>/<name>` (preserve original case for display if desired, deduplicate case-insensitively).
- **Package URL (`purl`) examples:**
  - PyPI: `pkg:pypi/penaltyblog`
  - CRAN: `pkg:cran/implied`
  - Cargo: `pkg:cargo/market-maker-rs`
  - GitHub-only: `pkg:github/owner/repo@<commit_sha>`

## 4. Epistemic Grading Rubric (`evidence_type` vs `verification_status`)

Do not collapse these two axes:
- **`evidence_type`** classifies *what kind of source* the repository is (e.g., `peer_reviewed_replication` vs `vendor_tutorial_or_sdk` vs `community_bot_unverified`).
- **`verification_status`** classifies *how deeply this workflow inspected it*:
  - `code_inspected`: core implementation files were read and verified against claimed math/behavior.
  - `readme_and_api_verified`: README, manifests, and API metadata were checked, but core implementation lines were not audited in full.
  - `metadata_only`: discovered via search/registry metadata only; treat claims as unverified.
  - `disputed_or_mismatch`: code contradicts README claims, contains broken math, or fails basic sanity checks.
