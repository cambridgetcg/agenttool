"""Antigravity dynamic workflow implementing agenttool.repo-discovery/v1.

Run via `run_workflow(ScriptPath="<path-to-this-file>", Args={...})`.

Expected Args:
- topic (str, required): technical domain or algorithm family to discover on GitHub.
- target_domain (str, optional): local codebase/engine context for integration hypotheses.
- max_candidates (int, optional, default 10): cap on deduplicated repos harvested and verified.
- output_dir (str, optional): relative path inside primary workspace for outputs (default:
  "research/discovery/<slug>").
- reviewed_on (str, optional): YYYY-MM-DD override (defaults to today UTC).
"""

from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import sys


VALIDATOR = str(Path(__file__).resolve().parent / "validate_discovery_registry.py")

topic = args.get("topic")
if not isinstance(topic, str) or len(topic.strip()) < 3:
    raise ValueError("Args['topic'] must be a non-empty string (min 3 chars)")

target_domain = args.get("target_domain") or "our local research and engineering codebase"
max_candidates = int(args.get("max_candidates", 10))
if max_candidates < 1 or max_candidates > 30:
    raise ValueError("Args['max_candidates'] must be between 1 and 30")

reviewed_on = args.get("reviewed_on") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
slug = re.sub(r"[^a-z0-9]+", "-", topic.lower()).strip("-")[:48] or "discovery"
out_rel = args.get("output_dir") or f"research/discovery/{slug}"
out_dir = Path(WORKSPACES[0]) / out_rel if WORKSPACES else Path(out_rel)

# ---------------------------------------------------------------------------
# Phase 1: Multi-channel fan-out discovery

phase("1. Fan-Out Discovery")

CHANNELS = [
    (
        "github_search_api",
        "Core Libraries & Math Primitives",
        f"Search GitHub for open-source libraries, packages, and mathematical primitives implementing: {topic}. "
        "Prefer well-maintained repos with actual algorithms/solvers (not empty wrappers or hype). "
        "Return up to 6 verified GitHub repositories (owner/name) with exact https://github.com/owner/name URLs.",
    ),
    (
        "github_code_search",
        "Engines, Simulators & Reference Implementations",
        f"Search GitHub for working simulators, execution frameworks, agent-based models, or pricing/trading engines related to: {topic}. "
        "Return up to 6 verified GitHub repositories (owner/name) with exact https://github.com/owner/name URLs.",
    ),
    (
        "academic_index",
        "Academic Paper-to-Code Replications",
        f"Search for peer-reviewed papers, arXiv replications, and academic repositories on GitHub addressing: {topic}. "
        "Also collect up to 6 foundational peer-reviewed citations explaining the underlying mechanisms and biases.",
    ),
    (
        "ecosystems_api",
        "Ecosystem Packages, MCP Servers & Tooling",
        f"Search ecosystems (PyPI, CRAN, Cargo, npm, ecosyste.ms, MCP Registry) for canonical open-source packages "
        f"or tools backed by GitHub repositories related to: {topic}. Return up to 6 verified GitHub repos.",
    ),
]

DISCOVERY_SCHEMA = {
    "type": "object",
    "required": ["queries_used", "candidates", "academic_references"],
    "properties": {
        "queries_used": {"type": "array", "items": {"type": "string"}},
        "candidates": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["repo", "url", "category", "why_relevant"],
                "properties": {
                    "repo": {"type": "string"},
                    "url": {"type": "string"},
                    "category": {"type": "string"},
                    "why_relevant": {"type": "string"},
                },
            },
        },
        "academic_references": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["citation", "mechanism", "limitations"],
                "properties": {
                    "citation": {"type": "string"},
                    "doi_or_url": {"type": ["string", "null"]},
                    "mechanism": {"type": "string"},
                    "limitations": {"type": "string"},
                },
            },
        },
    },
}

raw_batches = await parallel(
    CHANNELS,
    lambda ch: agent(
        f"{ch[2]}\n\nOnly include real GitHub repositories you directly verified via search. "
        "Never guess or invent URLs. Return JSON matching the schema.",
        schema=DISCOVERY_SCHEMA,
        role=f"Discover: {ch[1]}",
        type_name="research",
    ),
)

# Deduplicate candidates by lowercase owner/repo
search_queries = []
dedup = {}
academic_raw = []
for (source_kind, _, _), batch in zip(CHANNELS, raw_batches):
    for q in batch.get("queries_used", []):
        if isinstance(q, str) and q.strip():
            search_queries.append({"source": source_kind, "query": q.strip(), "executed_on": reviewed_on})
    for c in batch.get("candidates", []):
        repo = (c.get("repo") or "").strip().strip("/")
        if "/" not in repo:
            continue
        key = repo.lower()
        if key not in dedup:
            dedup[key] = {
                "repo": repo,
                "url": f"https://github.com/{repo}",
                "category": c.get("category") or "general",
                "why_relevant": c.get("why_relevant") or "",
            }
    academic_raw.extend(batch.get("academic_references", []))

candidates = list(dedup.values())[:max_candidates]
log(f"Deduplicated {len(dedup)} repos -> keeping {len(candidates)} candidates")

# ---------------------------------------------------------------------------
# Phase 2: Standard manifest & trust harvesting

phase("2. Manifest & Trust Harvesting")

HARVEST_SCHEMA = {
    "type": "object",
    "required": [
        "repo", "url", "language", "category", "spdx_license", "purl",
        "last_pushed_on", "manifests_detected", "trust_signals",
        "models_or_capabilities", "commercial_interest", "raw_notes",
    ],
    "properties": {
        "repo": {"type": "string"},
        "url": {"type": "string"},
        "commit_sha": {"type": ["string", "null"]},
        "language": {"type": "string"},
        "category": {"type": "string"},
        "spdx_license": {"type": ["string", "null"]},
        "purl": {"type": ["string", "null"]},
        "last_pushed_on": {"type": ["string", "null"]},
        "manifests_detected": {
            "type": "array",
            "items": {
                "enum": [
                    "CITATION.cff", "codemeta.json", "publiccode.yml",
                    "AGENTS.md", "SKILL.md", "llms.txt", "server.json", "agent.json",
                ]
            },
        },
        "trust_signals": {
            "type": "object",
            "properties": {
                "openssf_scorecard": {"type": ["number", "null"]},
                "stars": {"type": ["integer", "null"]},
                "ecosystems_dependents": {"type": ["integer", "null"]},
                "has_tests": {"type": ["boolean", "null"]},
                "archived": {"type": ["boolean", "null"]},
            },
        },
        "models_or_capabilities": {"type": "array", "items": {"type": "string"}},
        "commercial_interest": {"type": "string"},
        "raw_notes": {"type": "string"},
    },
}

harvested = await parallel(
    candidates,
    lambda c: agent(
        f"Inspect GitHub repository {c['repo']} ({c['url']}) for topic '{topic}'.\n"
        f"Context: {c['why_relevant']}\n"
        "Check standard root manifests (CITATION.cff, codemeta.json, publiccode.yml, AGENTS.md, "
        "SKILL.md, llms.txt, server.json, agent.json), SPDX license, primary language, package URL (purl), "
        "maintenance status, OpenSSF Scorecard (if visible; otherwise null), commercial interest, and "
        "concrete algorithms/models actually implemented. Never guess unknown numbers—return null.",
        schema=HARVEST_SCHEMA,
        role=f"Harvest {c['repo']}",
        type_name="research",
    ),
)

# ---------------------------------------------------------------------------
# Phase 3: Adversarial verification & epistemic grading

phase("3. Adversarial Verification")

VERIFY_SCHEMA = {
    "type": "object",
    "required": [
        "evidence_type", "verification_status", "verified_code_vs_readme",
        "commercial_interest", "what_it_gets_right", "what_it_gets_wrong_or_misses", "limitations",
    ],
    "properties": {
        "evidence_type": {
            "enum": [
                "peer_reviewed_replication",
                "open_source_math_or_library",
                "open_source_framework",
                "academic_simulator",
                "competition_or_hackathon_sim",
                "vendor_tutorial_or_sdk",
                "community_bot_unverified",
            ]
        },
        "verification_status": {
            "enum": [
                "code_inspected",
                "readme_and_api_verified",
                "metadata_only",
                "disputed_or_mismatch",
            ]
        },
        "verified_code_vs_readme": {"type": ["string", "null"]},
        "commercial_interest": {"type": "string"},
        "what_it_gets_right": {"type": "array", "items": {"type": "string"}},
        "what_it_gets_wrong_or_misses": {"type": "array", "items": {"type": "string"}},
        "limitations": {"type": "string"},
    },
}

verifications = await parallel(
    harvested,
    lambda h: agent(
        f"Adversarially verify harvested metadata for {h['repo']} ({h['url']}) regarding '{topic}'.\n"
        f"Harvested summary: {json.dumps(h, ensure_ascii=False)}\n"
        "Be skeptical: separate working mathematical primitives from README marketing, toy simulations, "
        "or unverified profitability claims. State honestly whether you inspected source files vs README/API only, "
        "what the repo/model gets right, what it gets wrong or misses, any vendor/commercial bias, and concrete limitations.",
        schema=VERIFY_SCHEMA,
        role=f"Verify {h['repo']}",
        type_name="research",
    ),
)

# ---------------------------------------------------------------------------
# Phase 4: Synthesis, hypotheses, deterministic validation & export

phase("4. Synthesize & Validate")

repo_cards = []
for idx, (h, v) in enumerate(zip(harvested, verifications), start=1):
    repo_name = h["repo"].strip().strip("/")
    repo_cards.append({
        "id": f"G{idx:02d}",
        "repo": repo_name,
        "url": f"https://github.com/{repo_name}",
        "commit_sha": h.get("commit_sha"),
        "purl": h.get("purl"),
        "accessed_on": reviewed_on,
        "last_pushed_on": h.get("last_pushed_on"),
        "spdx_license": h.get("spdx_license"),
        "language": h.get("language") or "Unknown",
        "category": h.get("category") or "general",
        "manifests_detected": sorted(set(h.get("manifests_detected") or [])),
        "trust_signals": h.get("trust_signals") or {},
        "evidence_type": v["evidence_type"],
        "verification_status": v["verification_status"],
        "verified_code_vs_readme": v.get("verified_code_vs_readme"),
        "commercial_interest": v["commercial_interest"],
        "models_or_capabilities": h.get("models_or_capabilities") or ["unspecified"],
        "what_it_gets_right": v.get("what_it_gets_right") or [],
        "what_it_gets_wrong_or_misses": v.get("what_it_gets_wrong_or_misses") or [],
        "limitations": v["limitations"],
    })

acad_cards = []
seen_citations = set()
for item in academic_raw:
    cit = (item.get("citation") or "").strip()
    if len(cit) < 10 or cit.lower() in seen_citations:
        continue
    seen_citations.add(cit.lower())
    acad_cards.append({
        "id": f"A{len(acad_cards) + 1:02d}",
        "citation": cit,
        "doi_or_url": item.get("doi_or_url"),
        "mechanism": item.get("mechanism") or "See citation.",
        "limitations": item.get("limitations") or "Scope limited to cited empirical sample.",
    })

SYNTHESIS_SCHEMA = {
    "type": "object",
    "required": ["scope", "verification_summary", "proposed_hypotheses"],
    "properties": {
        "scope": {"type": "string"},
        "verification_summary": {"type": "string"},
        "proposed_hypotheses": {
            "type": "array",
            "minItems": 2,
            "items": {
                "type": "object",
                "required": ["id", "status", "question", "falsification"],
                "properties": {
                    "id": {"type": "string"},
                    "status": {"const": "proposed_not_tested"},
                    "extends": {"type": "array", "items": {"type": "string"}},
                    "question": {"type": "string"},
                    "falsification": {"type": "string"},
                },
            },
        },
    },
}

synth = await agent(
    f"Synthesize verified discovery results for topic '{topic}' targeting '{target_domain}'.\n"
    f"Verified repos: {json.dumps(repo_cards, ensure_ascii=False)}\n"
    f"Academic refs: {json.dumps(acad_cards, ensure_ascii=False)}\n"
    "Write a concise scope statement, an honest verification_summary (never claiming unproven profitability), "
    "and 3 to 5 falsifiable proposed_not_tested hypotheses (IDs D01, D02, ...) translating the strongest "
    "verified insights into testable experiments for the target domain.",
    schema=SYNTHESIS_SCHEMA,
    role="Synthesize Hypotheses",
    type_name="research",
)

registry = {
    "schema_version": 1,
    "protocol": "agenttool.repo-discovery/v1",
    "topic": topic,
    "reviewed_on": reviewed_on,
    "scope": synth["scope"],
    "verification_summary": synth["verification_summary"],
    "search_queries": search_queries,
    "repositories": repo_cards,
    "academic_references": acad_cards,
    "proposed_hypotheses": synth["proposed_hypotheses"],
}

out_dir.mkdir(parents=True, exist_ok=True)
reg_path = out_dir / "discovery-registry.json"
md_path = out_dir / "discovery-report.md"
cm_path = out_dir / "codemeta-export.jsonld"
reg_path.write_text(json.dumps(registry, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

proc = subprocess.run(
    [
        sys.executable, VALIDATOR,
        "--input", str(reg_path),
        "--markdown-out", str(md_path),
        "--codemeta-out", str(cm_path),
    ],
    capture_output=True,
    text=True,
)
if proc.returncode != 0:
    raise RuntimeError(f"Discovery registry failed validation:\n{proc.stderr}")

receipt = json.loads(proc.stdout)
log(f"Validated {receipt['repositories']} repos, canonical_sha256={receipt['canonical_sha256']}")
print(json.dumps({
    "status": "ok",
    "output_dir": str(out_dir),
    "registry": str(reg_path),
    "markdown": str(md_path),
    "codemeta": str(cm_path),
    "receipt": receipt,
}, indent=2))
