#!/usr/bin/env python3
"""Offline validator, canonicalizer, CodeMeta exporter and Markdown renderer for agenttool.repo-discovery/v1.

Pure Python 3.10+ standard library only; zero network calls, zero third-party dependencies.
Fails closed (exit code 2) on schema violations, unknown keys, duplicate IDs/repos, malformed
GitHub URLs, or missing epistemic/limitation fields.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys


PROTOCOL = "agenttool.repo-discovery/v1"
SCHEMA_VERSION = 1

DATE_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
URL_RE = re.compile(r"^https://github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)$")
SHA_RE = re.compile(r"^[0-9a-f]{7,40}$")
REPO_ID_RE = re.compile(r"^G[0-9]{2,}$")
ACAD_ID_RE = re.compile(r"^A[0-9]{2,}$")

TOP_REQUIRED = {
    "schema_version", "protocol", "topic", "reviewed_on",
    "scope", "verification_summary", "repositories", "proposed_hypotheses",
}
TOP_ALLOWED = TOP_REQUIRED | {"search_queries", "academic_references"}

QUERY_SOURCES = {
    "github_search_api", "github_code_search", "ecosystems_api",
    "mcp_registry", "web_search", "academic_index",
}
MANIFESTS = {
    "CITATION.cff", "codemeta.json", "publiccode.yml", "AGENTS.md",
    "SKILL.md", "llms.txt", "server.json", "agent.json",
}
EVIDENCE_TYPES = {
    "peer_reviewed_replication",
    "open_source_math_or_library",
    "open_source_framework",
    "academic_simulator",
    "competition_or_hackathon_sim",
    "vendor_tutorial_or_sdk",
    "community_bot_unverified",
}
VERIFICATION_STATUSES = {
    "code_inspected",
    "readme_and_api_verified",
    "metadata_only",
    "disputed_or_mismatch",
}
HYPOTHESIS_STATUSES = {
    "proposed_not_tested",
    "preregistered",
    "tested_positive",
    "tested_negative",
    "inconclusive",
}

CARD_REQUIRED = {
    "id", "repo", "url", "accessed_on", "category", "language",
    "evidence_type", "verification_status", "commercial_interest",
    "models_or_capabilities", "limitations",
}
CARD_ALLOWED = CARD_REQUIRED | {
    "commit_sha", "purl", "last_pushed_on", "spdx_license",
    "manifests_detected", "trust_signals", "verified_code_vs_readme",
    "what_it_gets_right", "what_it_gets_wrong_or_misses",
}
TRUST_KEYS = {"openssf_scorecard", "stars", "ecosystems_dependents", "has_tests", "archived"}


def canonical_json_bytes(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def _nonempty_str(val, min_len=1):
    return isinstance(val, str) and len(val.strip()) >= min_len


def _finite_number(val):
    return not isinstance(val, bool) and isinstance(val, (int, float)) and math.isfinite(val)


def validate_registry(data):
    """Return sorted list of '<path>:<reason>' validation errors (empty list means valid)."""
    errors = []
    if not isinstance(data, dict):
        return ["root:must_be_object"]

    missing = sorted(TOP_REQUIRED - set(data))
    extra = sorted(set(data) - TOP_ALLOWED)
    for k in missing:
        errors.append(f"root.{k}:missing_required")
    for k in extra:
        errors.append(f"root.{k}:unknown_key")

    if data.get("schema_version") is not SCHEMA_VERSION or isinstance(data.get("schema_version"), bool):
        errors.append("root.schema_version:must_be_1")
    if data.get("protocol") != PROTOCOL:
        errors.append(f"root.protocol:must_be_{PROTOCOL}")
    if not _nonempty_str(data.get("topic"), 3):
        errors.append("root.topic:min_len_3")
    if not isinstance(data.get("reviewed_on"), str) or not DATE_RE.match(data["reviewed_on"]):
        errors.append("root.reviewed_on:invalid_iso_date")
    if not _nonempty_str(data.get("scope"), 10):
        errors.append("root.scope:min_len_10")
    if not _nonempty_str(data.get("verification_summary"), 10):
        errors.append("root.verification_summary:min_len_10")

    # search_queries (optional)
    if "search_queries" in data:
        sq = data["search_queries"]
        if not isinstance(sq, list):
            errors.append("root.search_queries:must_be_list")
        else:
            for idx, item in enumerate(sq):
                p = f"search_queries[{idx}]"
                if not isinstance(item, dict):
                    errors.append(f"{p}:must_be_object")
                    continue
                req = {"source", "query", "executed_on"}
                for k in sorted(req - set(item)):
                    errors.append(f"{p}.{k}:missing_required")
                for k in sorted(set(item) - req):
                    errors.append(f"{p}.{k}:unknown_key")
                if item.get("source") not in QUERY_SOURCES:
                    errors.append(f"{p}.source:invalid_enum")
                if not _nonempty_str(item.get("query"), 1):
                    errors.append(f"{p}.query:empty")
                if not isinstance(item.get("executed_on"), str) or not DATE_RE.match(item["executed_on"]):
                    errors.append(f"{p}.executed_on:invalid_iso_date")

    # repositories (required, non-empty)
    repos = data.get("repositories")
    if not isinstance(repos, list) or not repos:
        errors.append("root.repositories:must_be_nonempty_list")
    else:
        seen_ids = set()
        seen_repos = set()
        for idx, card in enumerate(repos):
            p = f"repositories[{idx}]"
            if not isinstance(card, dict):
                errors.append(f"{p}:must_be_object")
                continue
            for k in sorted(CARD_REQUIRED - set(card)):
                errors.append(f"{p}.{k}:missing_required")
            for k in sorted(set(card) - CARD_ALLOWED):
                errors.append(f"{p}.{k}:unknown_key")

            cid = card.get("id")
            if not isinstance(cid, str) or not REPO_ID_RE.match(cid):
                errors.append(f"{p}.id:invalid_pattern")
            elif cid in seen_ids:
                errors.append(f"{p}.id:duplicate_{cid}")
            else:
                seen_ids.add(cid)

            repo = card.get("repo")
            url = card.get("url")
            if not isinstance(repo, str) or not REPO_RE.match(repo):
                errors.append(f"{p}.repo:invalid_owner_slash_name")
            else:
                canon = repo.lower()
                if canon in seen_repos:
                    errors.append(f"{p}.repo:duplicate_{canon}")
                seen_repos.add(canon)

            if not isinstance(url, str) or not URL_RE.match(url):
                errors.append(f"{p}.url:invalid_github_url")
            elif isinstance(repo, str):
                url_repo = URL_RE.match(url).group(1)
                if url_repo.lower() != repo.lower():
                    errors.append(f"{p}.url:does_not_match_repo")

            if not isinstance(card.get("accessed_on"), str) or not DATE_RE.match(card["accessed_on"]):
                errors.append(f"{p}.accessed_on:invalid_iso_date")
            if card.get("last_pushed_on") is not None:
                if not isinstance(card["last_pushed_on"], str) or not DATE_RE.match(card["last_pushed_on"]):
                    errors.append(f"{p}.last_pushed_on:invalid_iso_date")
            if card.get("commit_sha") is not None:
                if not isinstance(card["commit_sha"], str) or not SHA_RE.match(card["commit_sha"]):
                    errors.append(f"{p}.commit_sha:invalid_hex_sha")
            if card.get("spdx_license") is not None and not _nonempty_str(card["spdx_license"], 1):
                errors.append(f"{p}.spdx_license:must_be_nonempty_or_null")
            if card.get("purl") is not None and not _nonempty_str(card["purl"], 4):
                errors.append(f"{p}.purl:must_be_nonempty_or_null")

            if not _nonempty_str(card.get("language"), 1):
                errors.append(f"{p}.language:empty")
            if not _nonempty_str(card.get("category"), 2):
                errors.append(f"{p}.category:min_len_2")
            if card.get("evidence_type") not in EVIDENCE_TYPES:
                errors.append(f"{p}.evidence_type:invalid_enum")
            if card.get("verification_status") not in VERIFICATION_STATUSES:
                errors.append(f"{p}.verification_status:invalid_enum")
            if not _nonempty_str(card.get("commercial_interest"), 2):
                errors.append(f"{p}.commercial_interest:min_len_2")
            if not _nonempty_str(card.get("limitations"), 10):
                errors.append(f"{p}.limitations:min_len_10")

            caps = card.get("models_or_capabilities")
            if not isinstance(caps, list) or not caps or any(not _nonempty_str(c, 2) for c in caps):
                errors.append(f"{p}.models_or_capabilities:must_be_nonempty_string_list")

            if "manifests_detected" in card:
                mf = card["manifests_detected"]
                if not isinstance(mf, list) or len(mf) != len(set(mf)) or any(m not in MANIFESTS for m in mf):
                    errors.append(f"{p}.manifests_detected:invalid_or_duplicate")

            for list_field in ("what_it_gets_right", "what_it_gets_wrong_or_misses"):
                if list_field in card:
                    val = card[list_field]
                    if not isinstance(val, list) or any(not _nonempty_str(x, 2) for x in val):
                        errors.append(f"{p}.{list_field}:must_be_string_list")

            if "trust_signals" in card:
                ts = card["trust_signals"]
                if not isinstance(ts, dict):
                    errors.append(f"{p}.trust_signals:must_be_object")
                else:
                    for k in sorted(set(ts) - TRUST_KEYS):
                        errors.append(f"{p}.trust_signals.{k}:unknown_key")
                    sc = ts.get("openssf_scorecard")
                    if sc is not None and (not _finite_number(sc) or not (0.0 <= sc <= 10.0)):
                        errors.append(f"{p}.trust_signals.openssf_scorecard:out_of_range_0_10")
                    for int_key in ("stars", "ecosystems_dependents"):
                        iv = ts.get(int_key)
                        if iv is not None and (isinstance(iv, bool) or not isinstance(iv, int) or iv < 0):
                            errors.append(f"{p}.trust_signals.{int_key}:must_be_nonneg_int_or_null")
                    for bool_key in ("has_tests", "archived"):
                        bv = ts.get(bool_key)
                        if bv is not None and not isinstance(bv, bool):
                            errors.append(f"{p}.trust_signals.{bool_key}:must_be_bool_or_null")

    # academic_references (optional)
    if "academic_references" in data:
        refs = data["academic_references"]
        if not isinstance(refs, list):
            errors.append("root.academic_references:must_be_list")
        else:
            seen_a = set()
            for idx, item in enumerate(refs):
                p = f"academic_references[{idx}]"
                if not isinstance(item, dict):
                    errors.append(f"{p}:must_be_object")
                    continue
                req = {"id", "citation", "mechanism", "limitations"}
                allowed = req | {"doi_or_url"}
                for k in sorted(req - set(item)):
                    errors.append(f"{p}.{k}:missing_required")
                for k in sorted(set(item) - allowed):
                    errors.append(f"{p}.{k}:unknown_key")
                aid = item.get("id")
                if not isinstance(aid, str) or not ACAD_ID_RE.match(aid):
                    errors.append(f"{p}.id:invalid_pattern")
                elif aid in seen_a:
                    errors.append(f"{p}.id:duplicate_{aid}")
                else:
                    seen_a.add(aid)
                if not _nonempty_str(item.get("citation"), 10):
                    errors.append(f"{p}.citation:min_len_10")
                if not _nonempty_str(item.get("mechanism"), 5):
                    errors.append(f"{p}.mechanism:min_len_5")
                if not _nonempty_str(item.get("limitations"), 5):
                    errors.append(f"{p}.limitations:min_len_5")

    # proposed_hypotheses (required list)
    hyps = data.get("proposed_hypotheses")
    if not isinstance(hyps, list):
        errors.append("root.proposed_hypotheses:must_be_list")
    else:
        seen_h = set()
        for idx, item in enumerate(hyps):
            p = f"proposed_hypotheses[{idx}]"
            if not isinstance(item, dict):
                errors.append(f"{p}:must_be_object")
                continue
            req = {"id", "status", "question", "falsification"}
            allowed = req | {"extends"}
            for k in sorted(req - set(item)):
                errors.append(f"{p}.{k}:missing_required")
            for k in sorted(set(item) - allowed):
                errors.append(f"{p}.{k}:unknown_key")
            hid = item.get("id")
            if not _nonempty_str(hid, 2):
                errors.append(f"{p}.id:min_len_2")
            elif hid in seen_h:
                errors.append(f"{p}.id:duplicate_{hid}")
            else:
                seen_h.add(hid)
            if item.get("status") not in HYPOTHESIS_STATUSES:
                errors.append(f"{p}.status:invalid_enum")
            if not _nonempty_str(item.get("question"), 10):
                errors.append(f"{p}.question:min_len_10")
            if not _nonempty_str(item.get("falsification"), 10):
                errors.append(f"{p}.falsification:min_len_10")

    return sorted(errors)


def export_codemeta(data):
    """Export validated repositories to a Schema.org / CodeMeta JSON-LD graph."""
    graph = []
    for card in data["repositories"]:
        node = {
            "@type": "SoftwareSourceCode",
            "identifier": card["id"],
            "name": card["repo"],
            "codeRepository": card["url"],
            "programmingLanguage": card["language"],
            "keywords": card["models_or_capabilities"],
            "dateModified": card.get("last_pushed_on") or card["accessed_on"],
        }
        if card.get("spdx_license"):
            node["license"] = f"https://spdx.org/licenses/{card['spdx_license']}"
        if card.get("commit_sha"):
            node["version"] = card["commit_sha"]
        graph.append(node)
    return {
        "@context": ["https://doi.org/10.5063/schema/codemeta-2.0", "https://schema.org"],
        "name": f"AgentTool Repo Discovery: {data['topic']}",
        "dateCreated": data["reviewed_on"],
        "description": data["scope"],
        "@graph": graph,
    }


def render_markdown(data, canonical_sha):
    lines = [
        f"# Repo Discovery Report: {data['topic']}",
        "",
        f"- **Protocol:** `{data['protocol']}`",
        f"- **Reviewed on:** {data['reviewed_on']}",
        f"- **Canonical SHA-256:** `{canonical_sha}`",
        f"- **Scope:** {data['scope']}",
        f"- **Verification summary:** {data['verification_summary']}",
        "",
        "## Discovered Repositories",
        "",
        "| ID | Repository | Lang | Evidence Type | Verification | License | Scorecard | Manifests | Key Capabilities |",
        "| --- | --- | --- | --- | --- | --- | ---: | --- | --- |",
    ]
    for card in data["repositories"]:
        ts = card.get("trust_signals") or {}
        sc = ts.get("openssf_scorecard")
        sc_str = f"{sc:.1f}/10" if sc is not None else "n/a"
        lic = card.get("spdx_license") or "n/a"
        mfs = ", ".join(card.get("manifests_detected") or []) or "none"
        caps = ", ".join(card["models_or_capabilities"][:4])
        lines.append(
            f"| {card['id']} | [{card['repo']}]({card['url']}) | {card['language']} | "
            f"`{card['evidence_type']}` | `{card['verification_status']}` | {lic} | "
            f"{sc_str} | {mfs} | {caps} |"
        )
    lines.extend(["", "## Limitations & Epistemic Notes", ""])
    for card in data["repositories"]:
        lines.append(
            f"- **{card['id']} ({card['repo']}):** Commercial interest `{card['commercial_interest']}`. "
            f"{card['limitations']}"
        )
    if data.get("proposed_hypotheses"):
        lines.extend(["", "## Proposed Falsifiable Hypotheses", "", "| ID | Status | Question | Falsification |", "| --- | --- | --- | --- |"])
        for h in data["proposed_hypotheses"]:
            lines.append(f"| {h['id']} | `{h['status']}` | {h['question']} | {h['falsification']} |")
    lines.append("")
    return "\n".join(lines)


def _run_self_test():
    valid = {
        "schema_version": 1,
        "protocol": PROTOCOL,
        "topic": "Sample discovery self-test",
        "reviewed_on": "2026-11-20",
        "scope": "Synthetic validation check for agenttool.repo-discovery/v1.",
        "verification_summary": "All synthetic entries checked for schema compliance only.",
        "search_queries": [
            {"source": "github_search_api", "query": "topic:sports-betting shin", "executed_on": "2026-11-20"}
        ],
        "repositories": [
            {
                "id": "G01",
                "repo": "mberk/shin",
                "url": "https://github.com/mberk/shin",
                "commit_sha": None,
                "purl": "pkg:pypi/shin",
                "accessed_on": "2026-11-20",
                "last_pushed_on": None,
                "spdx_license": "MIT",
                "language": "Python",
                "category": "overround_devigging",
                "manifests_detected": [],
                "trust_signals": {"openssf_scorecard": None, "stars": None, "ecosystems_dependents": None, "has_tests": True, "archived": False},
                "evidence_type": "open_source_math_or_library",
                "verification_status": "readme_and_api_verified",
                "commercial_interest": "none_observed",
                "models_or_capabilities": ["shin_overround_solver"],
                "what_it_gets_right": ["Handles n=2 and multi-outcome Shin inversion cleanly."],
                "what_it_gets_wrong_or_misses": ["Requires non-negative overround; cannot de-vig underround lay books."],
                "limitations": "Static probability conversion only; no order-book depth or execution model.",
            }
        ],
        "proposed_hypotheses": [
            {
                "id": "H01",
                "status": "proposed_not_tested",
                "question": "Does Shin de-vigging reduce race log loss vs multiplicative normalization?",
                "falsification": "No paired log-loss gain on untouched chronological holdout folds.",
            }
        ],
    }
    errs = validate_registry(valid)
    assert errs == [], f"expected valid registry, got {errs}"

    # Verify fail-closed checks
    bad_url = json.loads(json.dumps(valid))
    bad_url["repositories"][0]["url"] = "https://github.com/other/repo"
    assert any("does_not_match_repo" in e for e in validate_registry(bad_url))

    bad_extra = json.loads(json.dumps(valid))
    bad_extra["extra_field"] = True
    assert any("unknown_key" in e for e in validate_registry(bad_extra))

    bad_score = json.loads(json.dumps(valid))
    bad_score["repositories"][0]["trust_signals"]["openssf_scorecard"] = 12.0
    assert any("out_of_range_0_10" in e for e in validate_registry(bad_score))

    cm = export_codemeta(valid)
    assert cm["@graph"][0]["@type"] == "SoftwareSourceCode"
    md = render_markdown(valid, sha256_bytes(canonical_json_bytes(valid)))
    assert "mberk/shin" in md
    print(json.dumps({"self_test": "ok", "protocol": PROTOCOL}))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", help="Path to an agenttool.repo-discovery/v1 JSON registry")
    parser.add_argument("--markdown-out", help="Optional path to write rendered Markdown report")
    parser.add_argument("--codemeta-out", help="Optional path to write CodeMeta JSON-LD export")
    parser.add_argument("--self-test", action="store_true", help="Run built-in offline validator tests")
    args = parser.parse_args(argv)

    if args.self_test:
        return _run_self_test()

    if not args.input:
        parser.error("--input is required unless --self-test is passed")

    src = Path(args.input)
    raw = src.read_bytes()
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        print(json.dumps({"valid": False, "errors": [f"json_parse_error:{exc}"]}, indent=2), file=sys.stderr)
        return 2

    errors = validate_registry(data)
    if errors:
        print(json.dumps({"valid": False, "errors": errors}, indent=2), file=sys.stderr)
        return 2

    canon = canonical_json_bytes(data)
    canon_sha = sha256_bytes(canon)
    file_sha = sha256_bytes(raw)

    by_evidence = {}
    by_verification = {}
    for card in data["repositories"]:
        ev = card["evidence_type"]
        vs = card["verification_status"]
        by_evidence[ev] = by_evidence.get(ev, 0) + 1
        by_verification[vs] = by_verification.get(vs, 0) + 1

    written = {}
    if args.markdown_out:
        md_text = render_markdown(data, canon_sha)
        md_path = Path(args.markdown_out)
        md_path.parent.mkdir(parents=True, exist_ok=True)
        md_path.write_text(md_text, encoding="utf-8")
        written["markdown"] = {"path": str(md_path), "sha256": sha256_bytes(md_text.encode("utf-8"))}

    if args.codemeta_out:
        cm_bytes = (json.dumps(export_codemeta(data), indent=2, ensure_ascii=False) + "\n").encode("utf-8")
        cm_path = Path(args.codemeta_out)
        cm_path.parent.mkdir(parents=True, exist_ok=True)
        cm_path.write_bytes(cm_bytes)
        written["codemeta"] = {"path": str(cm_path), "sha256": sha256_bytes(cm_bytes)}

    receipt = {
        "valid": True,
        "protocol": PROTOCOL,
        "input": str(src),
        "file_sha256": file_sha,
        "canonical_sha256": canon_sha,
        "repositories": len(data["repositories"]),
        "academic_references": len(data.get("academic_references") or []),
        "proposed_hypotheses": len(data["proposed_hypotheses"]),
        "by_evidence_type": dict(sorted(by_evidence.items())),
        "by_verification_status": dict(sorted(by_verification.items())),
        "written": written,
    }
    print(json.dumps(receipt, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
