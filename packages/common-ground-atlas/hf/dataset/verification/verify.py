#!/usr/bin/env python3
"""Dependency-free independent verifier for the Common Ground Atlas."""

from __future__ import annotations

import hashlib
import json
import math
import re
import struct
import sys
from datetime import datetime
from fractions import Fraction
from pathlib import Path

COMMON = {
    "_format", "case_id", "training_eligible", "visibility", "synthetic",
    "provenance_ref", "public_safety", "does_not_establish",
}
SAFETY = {
    "origin", "contains_personal_data", "contains_private_constraints",
    "contains_real_participant_records", "contains_credentials",
    "copied_agent_traces", "copied_fictional_story_content",
}
NONCLAIMS = {
    "consensus", "consent", "fairness", "authority", "identity_continuity",
    "continuous_selection", "culprit",
}
RATIONAL_KEYS = {"numerator", "denominator"}
SOURCE_KEYS = {"literal", "exact", "binary64_hex", "parse_relation"}
CONSTRAINT_KEYS = {"id", "source_ref", "a", "b", "c"}
POINT_KEYS = {"x", "y"}
SHA = re.compile(r"^sha256:[0-9a-f]{64}$")
RAW_SHA = re.compile(r"^[0-9a-f]{64}$")
INTEGER = re.compile(r"^(?:0|-?[1-9][0-9]*)$")
POSITIVE = re.compile(r"^[1-9][0-9]*$")
DECIMAL = re.compile(r"^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$")

SOURCE_PATHS = sorted([
    "LICENSE",
    "apps/docs/xenia-helly.js",
    "docs/XENIA-HELLY-COMMON-GROUND.md",
    "packages/skills/skills/nen-common-ground/SKILL.md",
    "packages/common-ground-atlas/CLAUDE.md",
    "packages/common-ground-atlas/README.md",
    "packages/common-ground-atlas/bun.lock",
    "packages/common-ground-atlas/package.json",
    "packages/common-ground-atlas/public/verify.py",
    "packages/common-ground-atlas/scripts/generate-dataset.mjs",
    "packages/common-ground-atlas/scripts/verify-dataset.mjs",
    "packages/common-ground-atlas/src/constants.mjs",
    "packages/common-ground-atlas/src/core.mjs",
    "packages/common-ground-atlas/src/exact-verifier.mjs",
    "packages/common-ground-atlas/src/fixtures.mjs",
    "packages/common-ground-atlas/src/provenance.mjs",
    "packages/common-ground-atlas/src/schemas.mjs",
    "packages/common-ground-atlas/tests/atlas.test.mjs",
])
OWNED_PATHS = sorted([
    "LICENSE",
    "NOTICE",
    "README.md",
    "data/analogy-audit.jsonl",
    "data/exact-geometry.jsonl",
    "data/wake-continuity.jsonl",
    "provenance/row-manifest.json",
    "provenance/source-manifest.json",
    "schema/common-ground-atlas-analogy-v0.1.schema.json",
    "schema/common-ground-atlas-geometry-v0.1.schema.json",
    "schema/common-ground-atlas-wake-v0.1.schema.json",
    "verification/verify.py",
])
PROVIDER_MANAGED = [".gitattributes"]
LOCAL_METADATA = [".git", ".cache/huggingface"]
SOURCE_DECLARATION = {
    "_format": "agenttool.common-ground-atlas.provenance/0.1",
    "intended_hub_repository": "Yu-and-Ai/agenttool-common-ground",
    "source_repository": "https://github.com/cambridgetcg/agenttool",
    "source_revision_binding": "exact_file_bytes_at_generation_not_git_commit",
    "source_document": "docs/XENIA-HELLY-COMMON-GROUND.md",
    "source_lab": "apps/docs/xenia-helly.js",
    "rights_baseline": "xenia.rights/0.1",
    "origin": "human_directed_agent_authored_synthetic",
    "license": "Apache-2.0",
    "publication_state_at_generation": "repository_source_only_not_uploaded",
    "publication_identifier_at_generation": "intended_only_not_evidence_of_publication",
    "publication_state_scope": "historical_generation_time_statement_not_current_distribution",
    "training_eligible": False,
    "copied_upstream_rows": False,
    "copied_private_rows": False,
    "copied_agent_traces": False,
    "contains_personal_data": False,
    "contains_private_constraints": False,
    "contains_real_consent_or_authority_evidence": False,
    "copied_fictional_story_content": False,
    "gradient_lanes": [],
    "excluded_lanes": [
        "supervised_fine_tuning", "dpo", "reward_modeling", "preference_optimization",
    ],
}


def die(message: str) -> None:
    raise ValueError(message)


def keys(value: object, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        die(f"{label}: closed fields mismatch")


def rat(value: object) -> Fraction:
    keys(value, RATIONAL_KEYS, "rational")
    numerator = value["numerator"]
    denominator = value["denominator"]
    if not isinstance(numerator, str) or not INTEGER.fullmatch(numerator):
        die("noncanonical numerator")
    if not isinstance(denominator, str) or not POSITIVE.fullmatch(denominator):
        die("noncanonical denominator")
    result = Fraction(int(numerator), int(denominator))
    if str(result.numerator) != numerator or str(result.denominator) != denominator:
        die("unreduced rational")
    return result


def point(value: object) -> tuple[Fraction, Fraction]:
    keys(value, POINT_KEYS, "point")
    return rat(value["x"]), rat(value["y"])


def binary_fraction(hex_value: str) -> Fraction:
    if not re.fullmatch(r"[0-9a-f]{16}", hex_value):
        die("invalid binary64 hex")
    number = struct.unpack(">d", bytes.fromhex(hex_value))[0]
    if not math.isfinite(number):
        die("nonfinite binary64")
    numerator, denominator = number.as_integer_ratio()
    return Fraction(numerator, denominator)


def decimal_fraction(literal: object) -> Fraction:
    if not isinstance(literal, str):
        die("decimal literal must be a string")
    match = DECIMAL.fullmatch(literal)
    if match is None:
        die(f"noncanonical decimal literal {literal}")
    integer_digits = match.group(2) or "0"
    fractional_digits = match.group(3) if match.group(3) is not None else (match.group(4) or "")
    exponent = int(match.group(5) or "0") - len(fractional_digits)
    if not -10_000 <= exponent <= 10_000:
        die("decimal exponent is outside verifier bounds")
    coefficient = int(integer_digits + fractional_digits)
    if match.group(1) == "-":
        coefficient = -coefficient
    if exponent >= 0:
        return Fraction(coefficient * (10 ** exponent))
    return Fraction(coefficient, 10 ** (-exponent))


def source(value: object) -> Fraction:
    keys(value, SOURCE_KEYS, "source number")
    literal = value["literal"]
    exact = rat(value["exact"])
    if decimal_fraction(literal) != exact:
        die("literal/exact mismatch")
    parsed = float(literal)
    if struct.pack(">d", parsed).hex() != value["binary64_hex"]:
        die("literal/binary64 mismatch")
    decoded = binary_fraction(value["binary64_hex"])
    relation = value["parse_relation"]
    if relation == "exact":
        if decoded != exact:
            die("false exact binary64 relation")
        if exact == 0 and value["binary64_hex"] != "0000000000000000":
            die("exact zero is not canonical positive zero")
    elif relation == "underflow_to_signed_zero":
        if exact == 0 or decoded != 0:
            die("false underflow relation")
        negative_zero = value["binary64_hex"] == "8000000000000000"
        if value["binary64_hex"] not in {"0000000000000000", "8000000000000000"}:
            die("underflow did not bind signed zero")
        if (exact < 0) != negative_zero:
            die("underflow sign mismatch")
    else:
        die("unknown parse relation")
    return exact


def constraint(value: object) -> dict[str, object]:
    keys(value, CONSTRAINT_KEYS, "constraint")
    if not isinstance(value["id"], str) or not re.fullmatch(r"g[0-9]{2}-[a-z0-9-]+", value["id"]):
        die("constraint id mismatch")
    if value["source_ref"] != f"synthetic:constraint/{value['id']}":
        die("constraint provenance mismatch")
    return {"id": value["id"], "a": source(value["a"]),
            "b": source(value["b"]), "c": source(value["c"]), "raw": value}


def residual(candidate: object, wall: dict[str, object]) -> Fraction:
    x, y = point(candidate)
    return wall["a"] * x + wall["b"] * y - wall["c"]


def satisfies(candidate: object, wall: dict[str, object]) -> bool:
    return residual(candidate, wall) <= 0


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def domain_digest(domain: str, value: object) -> str:
    body = f"{domain}\0{canonical(value)}".encode()
    return "sha256:" + hashlib.sha256(body).hexdigest()


def common(row: dict[str, object]) -> None:
    if row["training_eligible"] is not False or row["visibility"] != "public_reference":
        die("training/reference wall mismatch")
    if row["synthetic"] is not True or not SHA.fullmatch(row["provenance_ref"]):
        die("synthetic provenance mismatch")
    keys(row["public_safety"], SAFETY, "public safety")
    if row["public_safety"]["origin"] != "human_directed_agent_authored_synthetic":
        die("origin mismatch")
    if any(row["public_safety"][key] for key in SAFETY - {"origin"}):
        die("unsafe public-safety flag")
    keys(row["does_not_establish"], NONCLAIMS, "nonclaims")
    if not all(row["does_not_establish"].values()):
        die("missing nonclaim")


def input_constraints(input_value: dict[str, object]) -> dict[str, dict[str, object]]:
    if input_value.get("kind") not in {"halfplane_family", "nonconvex_union"}:
        die("unknown geometry input kind")
    keys(input_value["model"], {
        "coordinate_model_version", "dimension", "axes", "coordinate_selector",
        "representation_omission",
    }, "coordinate model")
    model = input_value["model"]
    if model["dimension"] != 2 or model["coordinate_selector"] != "fixture_author":
        die("wrong dimension")
    if model["representation_omission"] != "not_a_world_model":
        die("model omission boundary mismatch")
    if not re.fullmatch(r"synthetic-cartesian-2d/0\.[0-9]+", model["coordinate_model_version"]):
        die("coordinate model version mismatch")
    for axis in model["axes"]:
        keys(axis, {"id", "meaning", "unit"}, "coordinate axis")
    if model["axes"] != [
        {"id": "x", "meaning": "synthetic_coordinate_1", "unit": "abstract"},
        {"id": "y", "meaning": "synthetic_coordinate_2", "unit": "abstract"},
    ]:
        die("axis order mismatch")
    field = "constraints" if input_value["kind"] == "halfplane_family" else "alternatives"
    expected = {"kind", "model", field}
    keys(input_value, expected, "geometry input")
    walls = [constraint(value) for value in input_value[field]]
    if len({wall["id"] for wall in walls}) != len(walls):
        die("duplicate constraint")
    return {wall["id"]: wall for wall in walls}


def farkas(entries: list[dict[str, object]], walls: dict[str, dict[str, object]],
           expected_ids: list[str] | None = None) -> None:
    actual_ids = [entry["constraint_id"] for entry in entries]
    if len(set(actual_ids)) != len(actual_ids) or (expected_ids and actual_ids != expected_ids):
        die("Farkas id mismatch")
    normal_a = Fraction(0)
    normal_b = Fraction(0)
    bound = Fraction(0)
    positive = False
    for entry in entries:
        keys(entry, {"constraint_id", "weight"}, "Farkas entry")
        weight = rat(entry["weight"])
        if weight < 0 or entry["constraint_id"] not in walls:
            die("invalid Farkas entry")
        positive = positive or weight > 0
        wall = walls[entry["constraint_id"]]
        normal_a += weight * wall["a"]
        normal_b += weight * wall["b"]
        bound += weight * wall["c"]
    if not positive or normal_a != 0 or normal_b != 0 or bound >= 0:
        die("Farkas arithmetic failed")


def verify_feasible(cert: dict[str, object], walls: dict[str, dict[str, object]]) -> None:
    keys(cert, {"kind", "input_sha256", "point", "binary64_point",
                "membership_constraint_ids", "robustness", "knife_edge_proof"}, "feasible cert")
    if cert["membership_constraint_ids"] != list(walls):
        die("membership coverage mismatch")
    for wall in walls.values():
        if not satisfies(cert["point"], wall):
            die("invalid feasible point")
    if cert["binary64_point"] is not None:
        keys(cert["binary64_point"], {"x_hex", "y_hex"}, "binary64 point")
        exact_x, exact_y = point(cert["point"])
        if (binary_fraction(cert["binary64_point"]["x_hex"]) != exact_x
                or binary_fraction(cert["binary64_point"]["y_hex"]) != exact_y):
            die("binary64 point does not bind the exact witness")
    radii: list[tuple[str, Fraction]] = []
    for wall in walls.values():
        norm = abs(wall["a"]) + abs(wall["b"])
        if norm == 0:
            die("zero normal in feasible certificate")
        radii.append((wall["id"], -residual(cert["point"], wall) / norm))
    minimum = min(radius for _, radius in radii)
    robustness = cert["robustness"]
    keys(robustness, {"metric", "radius", "status", "tight_constraint_ids"}, "robustness")
    if robustness["metric"] != "l_infinity_at_witness":
        die("robustness metric mismatch")
    if rat(robustness["radius"]) != minimum:
        die("wrong robustness radius")
    tight = [wall_id for wall_id, radius in radii if radius == minimum]
    if robustness["tight_constraint_ids"] != tight:
        die("wrong tight set")
    status = "knife_edge" if minimum == 0 else "robust"
    if robustness["status"] != status:
        die("wrong robustness status")
    if status == "robust" and cert["knife_edge_proof"] is not None:
        die("unexpected knife proof")
    if status == "knife_edge":
        proof = cert["knife_edge_proof"]
        keys(proof, {"active_constraint_ids", "positive_normal_dependence",
                     "rank_witness_constraint_ids"}, "knife proof")
        if proof["active_constraint_ids"] != tight:
            die("knife active-set mismatch")
        entries = proof["positive_normal_dependence"]
        if [entry["constraint_id"] for entry in entries] != proof["active_constraint_ids"]:
            die("knife dependence coverage mismatch")
        for entry in entries:
            keys(entry, {"constraint_id", "weight"}, "knife dependence")
        if any(rat(entry["weight"]) <= 0 for entry in entries):
            die("nonpositive knife dependence")
        normal_a = sum((rat(entry["weight"]) * walls[entry["constraint_id"]]["a"] for entry in entries), Fraction())
        normal_b = sum((rat(entry["weight"]) * walls[entry["constraint_id"]]["b"] for entry in entries), Fraction())
        if normal_a != 0 or normal_b != 0:
            die("knife dependence mismatch")
        rank_ids = proof["rank_witness_constraint_ids"]
        if (len(rank_ids) != 2 or len(set(rank_ids)) != 2
                or any(item not in proof["active_constraint_ids"] for item in rank_ids)):
            die("knife rank witness must use two active constraints")
        left, right = [walls[item] for item in rank_ids]
        if left["a"] * right["b"] - right["a"] * left["b"] == 0:
            die("singular knife rank witness")


def verify_conflict(cert: dict[str, object], walls: dict[str, dict[str, object]]) -> None:
    keys(cert, {"kind", "input_sha256", "constraint_ids", "farkas_multipliers",
                "deletion_witnesses"}, "conflict cert")
    if not 2 <= len(cert["constraint_ids"]) <= 3:
        die("Helly witness size")
    farkas(cert["farkas_multipliers"], walls, cert["constraint_ids"])
    if [entry["omitted_constraint_id"] for entry in cert["deletion_witnesses"]] != cert["constraint_ids"]:
        die("deletion coverage mismatch")
    for entry in cert["deletion_witnesses"]:
        keys(entry, {"omitted_constraint_id", "point", "satisfies_constraint_ids"}, "deletion witness")
        proper = [item for item in cert["constraint_ids"] if item != entry["omitted_constraint_id"]]
        if entry["satisfies_constraint_ids"] != proper:
            die("deletion proper subset mismatch")
        if not all(satisfies(entry["point"], walls[item]) for item in proper):
            die("invalid deletion witness")


def verify_geometry(row: dict[str, object]) -> None:
    keys(row, COMMON | {"evaluation_profile", "input", "expected"}, "geometry row")
    common(row)
    if (row["_format"] != "agenttool.common-ground-atlas.geometry/0.1"
            or row["evaluation_profile"] != "agenttool.xenia-helly-lab-binary64/0.1"):
        die("geometry format/profile mismatch")
    walls = input_constraints(row["input"])
    expected = row["expected"]
    keys(expected, {"theorem_status", "outcome", "reason_code",
                    "numeric_issue_constraint_ids", "certificate"}, "geometry expected")
    numeric = [wall["id"] for wall in walls.values()
               if any(wall["raw"][part]["parse_relation"] != "exact" for part in ("a", "b", "c"))]
    if expected["numeric_issue_constraint_ids"] != numeric:
        die("numeric issue inventory mismatch")
    cert = expected["certificate"]
    if cert["input_sha256"] != domain_digest("agenttool.common-ground-atlas.input/0.1", row["input"]):
        die("input digest mismatch")
    outcome_kind = {
        "common_ground_certified": "feasible_point",
        "no_common_ground_witnessed": "minimal_conflict",
        "model_not_applicable": "model_refusal",
        "insufficient_evidence": "insufficient_evidence",
    }
    if cert["kind"] != outcome_kind[expected["outcome"]]:
        die("outcome/certificate mismatch")
    if cert["kind"] == "feasible_point":
        verify_feasible(cert, walls)
    elif cert["kind"] == "minimal_conflict":
        verify_conflict(cert, walls)
    elif cert["kind"] == "insufficient_evidence":
        keys(cert, {"kind", "input_sha256", "exact_diagnostic",
                    "representability_obstruction"}, "insufficient cert")
        diagnostic = cert["exact_diagnostic"]
        keys(diagnostic, {"status", "point", "farkas_multipliers"}, "exact diagnostic")
        if diagnostic["status"] == "feasible":
            if (diagnostic["point"] is None or diagnostic["farkas_multipliers"] != []
                    or not all(satisfies(diagnostic["point"], wall) for wall in walls.values())):
                die("bad rational diagnostic")
        elif diagnostic["status"] == "infeasible":
            if diagnostic["point"] is not None or not diagnostic["farkas_multipliers"]:
                die("bad infeasible diagnostic shape")
            farkas(diagnostic["farkas_multipliers"], walls)
        else:
            die("unknown exact diagnostic status")
        obstruction = cert["representability_obstruction"]
        if obstruction is not None:
            if diagnostic["status"] != "feasible":
                die("representability obstruction requires a feasible exact diagnostic")
            keys(obstruction, {"coordinate", "required_value", "reason"}, "representability")
            if obstruction["coordinate"] not in {"x", "y"}:
                die("representability coordinate mismatch")
            if obstruction["reason"] != "reduced_denominator_not_power_of_two":
                die("representability reason mismatch")
            required = rat(obstruction["required_value"])
            denominator = required.denominator
            if denominator & (denominator - 1) == 0:
                die("representability obstruction is dyadic")
            coordinate = obstruction["coordinate"]
            active_opposed = []
            for wall in walls.values():
                normal = wall["a"] if coordinate == "x" else wall["b"]
                other = wall["b"] if coordinate == "x" else wall["a"]
                if other == 0 and normal != 0 and wall["c"] / normal == required:
                    active_opposed.append(normal)
            if len(active_opposed) < 2 or {value < 0 for value in active_opposed} != {False, True}:
                die("representability obstruction lacks opposing equality walls")
    else:
        keys(cert, {"kind", "input_sha256", "affected_constraint_ids",
                    "convexity_counterexample"}, "model refusal")
        if expected["reason_code"] == "zero_normal_not_declared_halfplane":
            if (row["input"]["kind"] != "halfplane_family"
                    or len(cert["affected_constraint_ids"]) != 1
                    or cert["convexity_counterexample"] is not None):
                die("zero-normal refusal shape mismatch")
            wall = walls[cert["affected_constraint_ids"][0]]
            if wall["a"] != 0 or wall["b"] != 0:
                die("false zero-normal refusal")
        elif expected["reason_code"] == "nonconvex_region" and row["input"]["kind"] == "nonconvex_union":
            if cert["affected_constraint_ids"] != list(walls):
                die("nonconvex refusal scope mismatch")
            example = cert["convexity_counterexample"]
            keys(example, {"left_point", "right_point", "midpoint"}, "convexity example")
            left = point(example["left_point"])
            right = point(example["right_point"])
            middle = point(example["midpoint"])
            if middle != ((left[0] + right[0]) / 2, (left[1] + right[1]) / 2):
                die("bad convex midpoint")
            alternatives = list(walls.values())
            if not any(satisfies(example["left_point"], wall) for wall in alternatives):
                die("left point outside union")
            if not any(satisfies(example["right_point"], wall) for wall in alternatives):
                die("right point outside union")
            if any(satisfies(example["midpoint"], wall) for wall in alternatives):
                die("midpoint inside union")
        else:
            die("unexpected model refusal reason")

    theorem_kind = {
        "feasible_point": "feasible",
        "minimal_conflict": "infeasible",
        "model_refusal": "not_applicable",
    }
    theorem = (cert["exact_diagnostic"]["status"] if cert["kind"] == "insufficient_evidence"
               else theorem_kind[cert["kind"]])
    if expected["theorem_status"] != theorem:
        die("theorem/certificate mismatch")

    if cert["kind"] == "feasible_point":
        if numeric:
            die("certified feasible point depends on unsafe literals")
        reason = ("knife_edge_exact_membership"
                  if cert["robustness"]["status"] == "knife_edge" else "exact_membership")
    elif cert["kind"] == "minimal_conflict":
        if not numeric:
            reason = "minimal_conflict"
        else:
            if any(item in numeric for item in cert["constraint_ids"]):
                die("stable conflict depends on a numeric-issue constraint")
            reason = "stable_conflict_despite_numeric_issue"
    elif cert["kind"] == "insufficient_evidence":
        if cert["representability_obstruction"] is not None:
            reason = "no_finite_binary64_witness"
        elif numeric and cert["exact_diagnostic"]["status"] == "infeasible":
            reason = "numeric_literal_not_preserved"
        else:
            die("insufficient geometry has no verified reason")
    else:
        reason = ("nonconvex_region" if row["input"]["kind"] == "nonconvex_union"
                  else "zero_normal_not_declared_halfplane")
    if expected["reason_code"] != reason:
        die("geometry reason/certificate mismatch")


def instant(value: str) -> datetime:
    if not isinstance(value, str) or not re.fullmatch(
            r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", value):
        die("noncanonical timestamp")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def verify_wake(row: dict[str, object], geometry: dict[str, dict[str, object]]) -> None:
    keys(row, COMMON | {"prior_geometry_case_id", "prior_input_sha256", "decision_scope",
                        "predecessor_ref", "opaque_constraint_refs", "evidence",
                        "evaluated_at", "expected"}, "WAKE row")
    common(row)
    if (row["_format"] != "agenttool.common-ground-atlas.wake/0.1"
            or row["decision_scope"] != "synthetic_room_selection"
            or row["predecessor_ref"] != "synthetic:wake/predecessor-001"):
        die("WAKE format/scope mismatch")
    if row["prior_geometry_case_id"] not in geometry:
        die("unknown WAKE prior geometry")
    prior = geometry[row["prior_geometry_case_id"]]
    if row["prior_input_sha256"] != prior["expected"]["certificate"]["input_sha256"]:
        die("WAKE prior digest mismatch")
    prior_constraints = prior["input"].get("constraints") or prior["input"].get("alternatives")
    expected_opaque = [f"opaque:{item['id']}" for item in prior_constraints]
    if row["opaque_constraint_refs"] != expected_opaque:
        die("WAKE opaque constraint references mismatch")
    evidence = row["evidence"]
    keys(evidence, {"coordinate_model_version", "input_sha256", "observed_at",
                    "expires_at", "withdrawn_at"}, "WAKE evidence")
    evaluated = instant(row["evaluated_at"])
    observed = instant(evidence["observed_at"])
    expires = instant(evidence["expires_at"])
    withdrawn_at = (None if evidence["withdrawn_at"] is None
                    else instant(evidence["withdrawn_at"]))
    if observed >= expires:
        die("WAKE evidence must expire after observation")
    if observed > evaluated:
        die("WAKE evidence cannot be observed after evaluation")
    if withdrawn_at is not None and withdrawn_at < observed:
        die("WAKE evidence cannot be withdrawn before observation")
    withdrawn = withdrawn_at is not None and evaluated >= withdrawn_at
    expired = evaluated >= expires
    changed = (evidence["coordinate_model_version"] != prior["input"]["model"]["coordinate_model_version"]
               or evidence["input_sha256"] != row["prior_input_sha256"])
    if withdrawn:
        derived = ("invalidate_and_hold_unknown", "insufficient_evidence", "evidence_withdrawn", False)
    elif expired:
        derived = ("invalidate_and_hold_unknown", "insufficient_evidence", "evidence_expired", False)
    elif changed:
        derived = ("invalidate_and_recompute", "insufficient_evidence", "model_or_boundary_changed", False)
    else:
        if (prior["expected"]["outcome"] != "common_ground_certified"
                or prior["expected"]["certificate"]["kind"] != "feasible_point"):
            die("fresh WAKE reuse requires a prior feasible certificate")
        derived = ("reuse_after_exact_reverification", "common_ground_certified", "fresh_unchanged_evidence", True)
    expected = row["expected"]
    keys(expected, {"action", "outcome", "reason_code",
                    "certificate_reuse_permitted_after_reverification"}, "WAKE expected")
    actual = (expected["action"], expected["outcome"], expected["reason_code"],
              expected["certificate_reuse_permitted_after_reverification"])
    if actual != derived:
        die("WAKE derivation mismatch")


def interval_at(family: dict[str, object], t: Fraction) -> tuple[Fraction, Fraction]:
    lower = None
    upper = None
    for item in family["constraints"]:
        a = rat(item["a0"]) + rat(item["a1"]) * t
        c = rat(item["c0"]) + rat(item["c1"]) * t
        if a > 0:
            upper = c / a if upper is None else min(upper, c / a)
        elif a < 0:
            lower = c / a if lower is None else max(lower, c / a)
        elif c < 0:
            die("empty time slice")
    if lower is None or upper is None or lower > upper:
        die("invalid time interval")
    return lower, upper


def verify_time_family(family: object) -> None:
    keys(family, {"constraints", "slices", "left_limit", "right_limit"}, "time family")
    expected_constraints = [
        ("time-x-upper", 1, 0, 1, 0),
        ("time-x-lower", -1, 0, 1, 0),
        ("time-jump-upper", 0, -1, 0, -1),
        ("time-jump-lower", 0, -1, 0, 1),
    ]
    if len(family["constraints"]) != len(expected_constraints):
        die("time-family constraint count mismatch")
    for item, expected in zip(family["constraints"], expected_constraints):
        keys(item, {"id", "a0", "a1", "c0", "c1"}, "affine constraint")
        identifier, a0, a1, c0, c1 = expected
        if (item["id"] != identifier or rat(item["a0"]) != a0 or rat(item["a1"]) != a1
                or rat(item["c0"]) != c0 or rat(item["c1"]) != c1):
            die("time-family exact template drift")

    expected_slices = [
        (Fraction(-1), "singleton", Fraction(-1), Fraction(-1)),
        (Fraction(0), "interval", Fraction(-1), Fraction(1)),
        (Fraction(1), "singleton", Fraction(1), Fraction(1)),
    ]
    if len(family["slices"]) != len(expected_slices):
        die("time-family slice count mismatch")
    for item, expected in zip(family["slices"], expected_slices):
        keys(item, {"t", "feasible_set", "lower", "upper"}, "time slice")
        t, kind, lower, upper = expected
        if (rat(item["t"]) != t or item["feasible_set"] != kind
                or rat(item["lower"]) != lower or rat(item["upper"]) != upper):
            die("time-family declared slice drift")
        if interval_at(family, t) != (lower, upper):
            die("time-family slice arithmetic mismatch")

    # With the exact template above, -1/0/+1 represent every t<0/t=0/t>0:
    # the two jump walls are t-scaled and all other walls are constant.
    left = interval_at(family, Fraction(-1))
    right = interval_at(family, Fraction(1))
    if (left[0] != left[1] or right[0] != right[1]
            or rat(family["left_limit"]) != left[0]
            or rat(family["right_limit"]) != right[0]
            or left[0] == right[0]):
        die("time-family one-sided selection limits are not proved")


def reference_shape(evidence: dict[str, object], geometry_ids: list[str], wake_ids: list[str],
                    *, feasible: bool = False) -> None:
    if (evidence["kind"] != "case_references"
            or evidence["geometry_case_ids"] != geometry_ids
            or evidence["wake_case_ids"] != wake_ids
            or evidence["time_family"] is not None
            or (not feasible and evidence["feasible_points"] != [])):
        die("analogy reference evidence shape mismatch")


def verify_analogy(row: dict[str, object], geometry: dict[str, dict[str, object]],
                   wake: dict[str, dict[str, object]]) -> None:
    keys(row, COMMON | {"claim_code", "verdict", "missing_layer", "reason_code", "evidence"}, "analogy row")
    common(row)
    if (row["_format"] != "agenttool.common-ground-atlas.analogy/0.1"
            or row["verdict"] != "unsupported_inference"):
        die("analogy format/verdict widened")
    evidence = row["evidence"]
    keys(evidence, {"kind", "geometry_case_ids", "wake_case_ids", "feasible_points", "time_family"}, "analogy evidence")
    if any(item not in geometry for item in evidence["geometry_case_ids"]):
        die("unknown geometry analogy ref")
    if any(item not in wake for item in evidence["wake_case_ids"]):
        die("unknown WAKE analogy ref")

    labels = {
        "pairwise_overlap_implies_global_intersection":
            ("theorem_assumption", "dimension_two_requires_triples"),
        "modeled_intersection_implies_consent_or_authority":
            ("consent_and_authority_evidence", "geometry_has_no_consent_or_authority_field"),
        "pointwise_feasible_implies_continuous_selection":
            ("continuity_assumption", "aggregate_map_lacks_lower_semicontinuity"),
        "feasible_point_is_a_fair_choice":
            ("normative_choice_rule", "multiple_feasible_points_no_selection_rule"),
        "expiry_implies_release_acceptance_or_compatibility":
            ("current_evidence", "expiry_means_unknown"),
        "minimal_conflict_identifies_a_culprit":
            ("participant_attribution", "certificate_names_constraints_not_beings"),
    }
    if (row["claim_code"] not in labels
            or (row["missing_layer"], row["reason_code"]) != labels[row["claim_code"]]):
        die("analogy claim/missing-layer/reason mismatch")

    claim = row["claim_code"]
    if claim == "pairwise_overlap_implies_global_intersection":
        reference_shape(evidence, ["cg-g03-pairwise-trap"], [])
        reference = geometry["cg-g03-pairwise-trap"]
        if len(reference["expected"]["certificate"]["deletion_witnesses"]) != 3:
            die("pairwise counterexample mismatch")
    elif claim == "modeled_intersection_implies_consent_or_authority":
        reference_shape(evidence, ["cg-g01-robust-room"], [])
    elif claim == "pointwise_feasible_implies_continuous_selection":
        if (evidence["kind"] != "time_varying_counterexample"
                or evidence["geometry_case_ids"] != [] or evidence["wake_case_ids"] != []
                or evidence["feasible_points"] != [] or evidence["time_family"] is None):
            die("time analogy evidence shape mismatch")
        verify_time_family(evidence["time_family"])
    elif claim == "feasible_point_is_a_fair_choice":
        reference_shape(evidence, ["cg-g01-robust-room"], [], feasible=True)
        reference = geometry["cg-g01-robust-room"]
        walls = input_constraints(reference["input"])
        if len(evidence["feasible_points"]) < 2:
            die("fairness case lacks alternatives")
        if not all(all(satisfies(candidate, wall) for wall in walls.values())
                   for candidate in evidence["feasible_points"]):
            die("fairness case has infeasible point")
    elif claim == "expiry_implies_release_acceptance_or_compatibility":
        reference_shape(evidence, [], ["cg-w02-expired-unknown"])
        reference = wake["cg-w02-expired-unknown"]
        if (reference["expected"]["reason_code"] != "evidence_expired"
                or reference["expected"]["outcome"] != "insufficient_evidence"):
            die("expiry analogy mismatch")
    else:
        reference_shape(evidence, ["cg-g03-pairwise-trap"], [])
        reference = geometry["cg-g03-pairwise-trap"]
        if (reference["expected"]["certificate"]["kind"] != "minimal_conflict"
                or reference["does_not_establish"]["culprit"] is not True):
            die("culprit analogy mismatch")


def schema_is_closed(value: object, path: str = "$") -> None:
    if isinstance(value, dict):
        if value.get("type") == "object" and value.get("additionalProperties") is not False:
            die(f"open schema object at {path}")
        for key, child in value.items():
            schema_is_closed(child, f"{path}/{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            schema_is_closed(child, f"{path}/{index}")


def load_jsonl(root: Path, relative: str) -> tuple[list[dict[str, object]], list[str]]:
    path = root / relative
    if path.is_symlink() or not path.is_file():
        die(f"owned path is not a regular file: {relative}")
    lines = path.read_text().splitlines()
    return [json.loads(line) for line in lines], lines


def verify_source_manifest(root: Path, source_manifest: object) -> str:
    expected_keys = set(SOURCE_DECLARATION) | {"source_files", "provenance_ref"}
    keys(source_manifest, expected_keys, "source manifest")
    source_body = dict(source_manifest)
    provenance = source_body.pop("provenance_ref")
    if not isinstance(provenance, str) or not SHA.fullmatch(provenance):
        die("source provenance reference shape mismatch")
    source_files = source_body.pop("source_files")
    if {key: source_body[key] for key in source_body} != SOURCE_DECLARATION:
        die("source provenance declaration mismatch")
    if not isinstance(source_files, list) or len(source_files) != len(SOURCE_PATHS):
        die("source-file inventory shape mismatch")
    for entry, expected_path in zip(source_files, SOURCE_PATHS):
        keys(entry, {"path", "bytes", "sha256"}, "source-file entry")
        if (entry["path"] != expected_path
                or not isinstance(entry["bytes"], int) or isinstance(entry["bytes"], bool)
                or entry["bytes"] < 0
                or not isinstance(entry["sha256"], str) or not RAW_SHA.fullmatch(entry["sha256"])):
            die("source-file entry mismatch")
    if provenance != domain_digest("agenttool.common-ground-atlas.provenance/0.1",
                                   {**source_body, "source_files": source_files}):
        die("source provenance content digest mismatch")

    # A standalone Hub checkout can validate the content binding but does not
    # contain AgentTool source bytes. Verify those bytes as well when this
    # dataset is being checked in its recognizable full source worktree.
    if len(root.parents) >= 4:
        repo_root = root.parents[3]
        if (repo_root / ".git").exists():
            for entry in source_files:
                path = repo_root / entry["path"]
                if path.is_symlink() or not path.is_file():
                    die(f"source path is not a regular file: {entry['path']}")
                body = path.read_bytes()
                if (len(body) != entry["bytes"]
                        or hashlib.sha256(body).hexdigest() != entry["sha256"]):
                    die(f"source byte binding mismatch: {entry['path']}")
    return provenance


def is_local_metadata(relative: str) -> bool:
    return any(relative == item or relative.startswith(f"{item}/") for item in LOCAL_METADATA)


def verify_hash_manifest(root: Path, hash_manifest: object) -> None:
    keys(hash_manifest, {"_format", "algorithm", "excludes_self",
                         "provider_managed_files_not_bound",
                         "local_metadata_directories_not_bound", "files"}, "hash manifest")
    if (hash_manifest["_format"] != "agenttool.common-ground-atlas.hash-manifest/0.1"
            or hash_manifest["algorithm"] != "sha256"
            or hash_manifest["excludes_self"] is not True
            or hash_manifest["provider_managed_files_not_bound"] != PROVIDER_MANAGED
            or hash_manifest["local_metadata_directories_not_bound"] != LOCAL_METADATA):
        die("hash manifest header mismatch")

    manifest_paths = []
    for entry in hash_manifest["files"]:
        keys(entry, {"path", "bytes", "sha256"}, "hash entry")
        if (not isinstance(entry["path"], str)
                or not isinstance(entry["bytes"], int) or isinstance(entry["bytes"], bool)
                or entry["bytes"] < 0
                or not isinstance(entry["sha256"], str) or not RAW_SHA.fullmatch(entry["sha256"])):
            die("hash entry shape mismatch")
        manifest_paths.append(entry["path"])
    if manifest_paths != OWNED_PATHS:
        die("hash manifest owned inventory mismatch")

    actual_paths = []
    for path in root.rglob("*"):
        relative = path.relative_to(root).as_posix()
        if is_local_metadata(relative):
            if path.is_symlink():
                die(f"local metadata path is a symlink: {relative}")
            continue
        if relative in PROVIDER_MANAGED:
            if path.is_symlink() or not path.is_file():
                die(f"provider-managed path is not a regular file: {relative}")
            continue
        if path.is_symlink():
            die(f"unexpected symlink: {relative}")
        if path.is_file():
            if relative != "hash-manifest.json":
                actual_paths.append(relative)
        elif not path.is_dir():
            die(f"unexpected filesystem entry: {relative}")
    if sorted(actual_paths) != OWNED_PATHS:
        die("unexpected or missing repository-owned file")

    for entry in hash_manifest["files"]:
        path = root / entry["path"]
        if path.is_symlink() or not path.is_file():
            die(f"owned path is not a regular file: {entry['path']}")
        body = path.read_bytes()
        if len(body) != entry["bytes"] or hashlib.sha256(body).hexdigest() != entry["sha256"]:
            die(f"hash mismatch: {entry['path']}")


def main() -> None:
    if len(sys.argv) != 2:
        die("usage: verify.py <dataset-root>")
    root = Path(sys.argv[1]).resolve()
    geometry_rows, geometry_lines = load_jsonl(root, "data/exact-geometry.jsonl")
    wake_rows, wake_lines = load_jsonl(root, "data/wake-continuity.jsonl")
    analogy_rows, analogy_lines = load_jsonl(root, "data/analogy-audit.jsonl")
    if (len(geometry_rows), len(wake_rows), len(analogy_rows)) != (9, 4, 6):
        die("row count mismatch")
    all_rows = geometry_rows + wake_rows + analogy_rows
    if len({row["case_id"] for row in all_rows}) != len(all_rows):
        die("duplicate global case id")
    for path in ("schema/common-ground-atlas-geometry-v0.1.schema.json",
                 "schema/common-ground-atlas-wake-v0.1.schema.json",
                 "schema/common-ground-atlas-analogy-v0.1.schema.json"):
        schema_is_closed(json.loads((root / path).read_text()))
    for row in geometry_rows:
        verify_geometry(row)
    geometry = {row["case_id"]: row for row in geometry_rows}
    for row in wake_rows:
        verify_wake(row, geometry)
    wake = {row["case_id"]: row for row in wake_rows}
    for row in analogy_rows:
        verify_analogy(row, geometry, wake)

    source_manifest = json.loads((root / "provenance/source-manifest.json").read_text())
    provenance = verify_source_manifest(root, source_manifest)
    if any(row["provenance_ref"] != provenance for row in all_rows):
        die("row provenance mismatch")
    row_manifest = json.loads((root / "provenance/row-manifest.json").read_text())
    keys(row_manifest, {"_format", "provenance_ref", "row_count", "entries"}, "row manifest")
    if (row_manifest["_format"] != "agenttool.common-ground-atlas.row-manifest/0.1"
            or row_manifest["row_count"] != 19
            or row_manifest["provenance_ref"] != provenance):
        die("row manifest header mismatch")
    expected = []
    for config, split, path, rows, lines in (
        ("exact_geometry", "reference", "data/exact-geometry.jsonl", geometry_rows, geometry_lines),
        ("wake_continuity", "reference", "data/wake-continuity.jsonl", wake_rows, wake_lines),
        ("analogy_audit", "public_regression", "data/analogy-audit.jsonl", analogy_rows, analogy_lines),
    ):
        for index, (row, line) in enumerate(zip(rows, lines), 1):
            expected.append({"config": config, "split": split, "path": path, "line": index,
                             "case_id": row["case_id"],
                             "row_sha256": hashlib.sha256((line + "\n").encode()).hexdigest()})
    if row_manifest["entries"] != expected:
        die("row manifest entries mismatch")

    hash_manifest_path = root / "hash-manifest.json"
    if hash_manifest_path.is_symlink() or not hash_manifest_path.is_file():
        die("hash manifest is not a regular file")
    verify_hash_manifest(root, json.loads(hash_manifest_path.read_text()))
    print("Independent Python Fraction verification passed: 19 rows and all repository-owned bytes.")


if __name__ == "__main__":
    main()
