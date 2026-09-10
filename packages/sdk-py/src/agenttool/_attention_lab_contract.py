"""FOMOengine attention-lab v1 嘅結構同引用界線；唔重算 brief／comparison。

欄位同上限對應 producer lib/attention/contract.ts、workspace-schema.ts。
字串按 Zod 嘅 UTF-16 units 計；歷史 artifact 只驗自身快照，唔查現行 registry。
"""

from __future__ import annotations

import math
import re
from urllib.parse import unquote, urlsplit

_SAFE = 9_007_199_254_740_991
_TRIM = "".join(chr(cp) for cp in (
    9, 10, 11, 12, 13, 32, 160, 5760, *range(8192, 8203),
    8232, 8233, 8239, 8287, 12288, 65279,
))


def _require(condition):
    if not condition:
        raise ValueError()


def _string(maximum, minimum=0, pattern=None):
    def check(value):
        _require(type(value) is str)
        _require(len(value) <= maximum)
        _require(minimum <= len(value.encode("utf-16-le")) // 2 <= maximum)
        if pattern is not None:
            _require(re.fullmatch(pattern, value) is not None)
    return check


def _enum(*values):
    def check(value):
        _require(type(value) is str and value in values)
    return check


def _boolean(value):
    _require(type(value) is bool)


def _number(minimum, maximum):
    def check(value):
        _require(type(value) in (int, float) and minimum <= value <= maximum and math.isfinite(value))
    return check


def _nullable(check):
    def validate(value):
        if value is not None:
            check(value)
    return validate


def _array(check, maximum, minimum=0):
    def validate(value):
        _require(type(value) is list and minimum <= len(value) <= maximum)
        for item in value:
            check(item)
    return validate


def _record(fields):
    def check(value):
        _require(type(value) is dict and len(value) == len(fields) and set(value) == set(fields))
        for key, validator in fields.items():
            validator(value[key])
    return check


_id = _string(128, 1, r"[a-zA-Z0-9][a-zA-Z0-9._:-]*")
_ids = _array(_id, 64, 1)
_text = _string(4000, 1)
_lines = _array(_text, 30)
_long = _string(12000)
_version = _string(64, 1, r"[a-zA-Z0-9][a-zA-Z0-9._+-]*")


def _date(value):
    _string(10, 10, r"[0-9]{4}-[0-9]{2}-[0-9]{2}")(value)
    year, month, day = map(int, value.split("-"))
    # JavaScript 接受公曆 year 0000；唔用 datetime 1..9999 界線改寫契約。
    leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
    days = (31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
    _require(1 <= month <= 12 and 1 <= day <= days[month - 1])


def _optional_date(value):
    if value != "":
        _date(value)


def _published(value):
    if value is not None:
        _string(10, 4, r"[0-9]{4}(?:-[0-9]{2}(?:-[0-9]{2})?)?")(value)
        _date(value + ("-01-01" if len(value) == 4 else "-01" if len(value) == 7 else ""))


def _source_url(value):
    _string(2048, 1)(value)
    _require(re.match(r"^https?://", value) is not None)
    parsed = urlsplit(value)
    _require(bool(parsed.hostname) and parsed.username is None and parsed.password is None)
    host = unquote(parsed.hostname, errors="strict")
    _require(not re.search(r"[\s\x00-\x20\x7f%/?#@<>\[\]^|\\]", host))
    _require(parsed.port is None or 0 <= parsed.port <= 65535)


_metric = _record({"name": _string(300), "numerator": _string(1600), "denominator": _string(1600), "caveat": _string(3000)})
_source = _record({
    "id": _id, "title": _string(1000, 1), "url": _source_url, "publisher": _string(1000, 1),
    "publishedAt": _published, "reviewedAt": _date, "context": _text, "retrievalLimitations": _text,
})
_claim = _record({
    "id": _id, "text": _text, "kind": _enum("official-disclosure", "experimental", "observational", "hypothesis"),
    "sourceIds": _ids, "context": _text, "limitations": _array(_text, 30, 1),
})
_mechanism = _record({
    "id": _id, "name": _string(300, 1), "summary": _text, "emotion": _text, "howItWorks": _lines,
    "example": _record({"honest": _text, "pressure": _text, "distinction": _text}),
    "claims": _array(_claim, 30, 1), "honestUse": _lines, "countermeasure": _text, "tradeoffs": _lines,
    "experiment": _record({
        "question": _text, "variable": _text, "control": _text, "treatment": _text,
        "holdConstant": _lines, "readout": _text, "limitations": _text,
    }),
    "compatiblePlatformIds": _ids, "sourceIds": _ids,
})
_platform = _record({
    "id": _id, "name": _string(300, 1), "channel": _enum("social", "search", "email", "offer"),
    "surface": _string(300, 1), "kind": _enum("ranked-surface", "strategy-channel"),
    "summary": _text, "rankingDisclosure": _text, "signals": _array(_claim, 30, 1),
    "practicalChoices": _lines, "metric": _metric, "qualityGuardrails": _lines, "confounders": _lines, "sourceIds": _ids,
})
_brief_input_fields = {
    "topic": _string(200), "audience": _string(600), "platformId": _id,
    "objective": _enum("surface-response", "useful-action", "understanding"), "mechanismId": _id,
    "takeaway": _string(1000), "action": _string(300), "evidenceStatus": _enum("missing", "provided"),
    "evidence": _string(4000), "constraints": _string(2000), "verifiedProof": _string(2000),
    "realLimit": _string(500), "limitReason": _string(500), "terms": _string(2000), "nonpoliticalConfirmed": _boolean,
}


def _brief_input(value):
    _record(_brief_input_fields)(value)
    _require(bool(value["topic"].strip(_TRIM)) and bool(value["audience"].strip(_TRIM)))
    _require(value["nonpoliticalConfirmed"] is True)
    _require(value["evidenceStatus"] != "provided" or bool(value["evidence"].strip(_TRIM)))


_brief = _record({
    "input": _brief_input, "title": _string(500),
    "sections": _array(_record({"heading": _string(200), "body": _long}), 20),
    "experiment": _record({
        "question": _long, "variable": _string(500), "control": _long, "treatment": _long,
        "shared": _array(_long, 20), "blocked": _boolean, "limitations": _array(_long, 30),
    }),
    "metric": _metric, "guardrails": _array(_long, 20), "confounders": _array(_long, 20), "sourceIds": _ids,
})
_selected = _record({"id": _id, "name": _string(300, 1), "claimIds": _ids})


def _counts(value):
    _record({key: _string(32, 0, r"[0-9]*") for key in ("aOutcomes", "aEligible", "bOutcomes", "bEligible")})(value)
    for count in value.values():
        _require(count == "" or int(count) <= _SAFE)
    for group in ("a", "b"):
        outcomes, eligible = value[group + "Outcomes"], value[group + "Eligible"]
        _require(outcomes == "" or eligible == "" or int(outcomes) <= int(eligible))


def _plan(value):
    _record({
        "design": _enum("observational", "randomized"), "allocation": _string(2000), "eligibility": _string(2000),
        "startDate": _optional_date, "endDate": _optional_date, "stoppingRule": _string(2000),
        "guardrailPlan": _string(3000), "guardrailResults": _string(4000),
    })(value)
    _require(not value["startDate"] or not value["endDate"] or value["startDate"] <= value["endDate"])


def _schema_version(value):
    _require(type(value) in (int, float) and value == 1)


_common = {
    "schemaVersion": _schema_version, "engineVersion": _version, "catalogueVersion": _version,
    "catalogueDigest": _string(71, 71, r"sha256:[0-9a-f]{64}"),
}
_comparison_fields = {"counts": _counts, "plan": _plan, "metric": _metric}
_comparison = _record({
    "aRate": _nullable(_number(0, 1)), "bRate": _nullable(_number(0, 1)),
    "percentagePointDifference": _nullable(_number(-100, 100)), "relativeLift": _nullable(_number(-1, _SAFE)),
})


def _unique(values):
    result = set(values)
    _require(len(result) == len(values))
    return result


def _references(values, known):
    _require(_unique(values) <= known)


def _claims_closed(claims, sources):
    _unique([claim["id"] for claim in claims])
    for claim in claims:
        _references(claim["sourceIds"], sources)


def _catalogue(value):
    _record({**_common, "mechanisms": _array(_mechanism, 32, 1), "platforms": _array(_platform, 32, 1), "sources": _array(_source, 64, 1)})(value)
    sources = _unique([source["id"] for source in value["sources"]])
    platforms = _unique([entry["id"] for entry in value["platforms"]])
    _unique([entry["id"] for entry in value["mechanisms"]])
    claims = []
    for entry in value["mechanisms"]:
        _references(entry["compatiblePlatformIds"], platforms)
        _references(entry["sourceIds"], sources)
        _claims_closed(entry["claims"], set(entry["sourceIds"]))
        claims.extend(entry["claims"])
    for entry in value["platforms"]:
        _references(entry["sourceIds"], sources)
        _claims_closed(entry["signals"], set(entry["sourceIds"]))
        claims.extend(entry["signals"])
    _unique([claim["id"] for claim in claims])


def _brief_artifact(value):
    _record({
        **_common, "brief": _brief, "mechanism": _selected, "platform": _selected,
        "sources": _array(_source, 64, 1), "claims": _array(_claim, 60, 1), "markdown": _string(90000, 1),
    })(value)
    sources = _unique([source["id"] for source in value["sources"]])
    _require(_unique(value["brief"]["sourceIds"]) == sources)
    _claims_closed(value["claims"], sources)
    claims = set(claim["id"] for claim in value["claims"])
    selected = set()
    for field in ("mechanism", "platform"):
        _references(value[field]["claimIds"], claims)
        selected.update(value[field]["claimIds"])
        _require(value["brief"]["input"][field + "Id"] == value[field]["id"])
    _require(selected == claims)


def _comparison_artifact(value):
    _record({
        **_common, **_comparison_fields, "comparison": _nullable(_comparison), "designDescription": _text,
        "missingRequirements": _array(_text, 20), "interpretation": _text,
    })(value)
    incomplete = any(count == "" for count in value["counts"].values())
    result = value["comparison"]
    _require(incomplete == (result is None))
    if result is not None:
        a_unknown = int(value["counts"]["aEligible"]) == 0
        b_unknown = int(value["counts"]["bEligible"]) == 0
        baseline_zero = int(value["counts"]["aOutcomes"]) == 0
        # 只驗 null 代表嘅未知，唔複製 server 計算或推斷顯著性。
        expected = {"aRate": a_unknown, "bRate": b_unknown,
                    "percentagePointDifference": a_unknown or b_unknown,
                    "relativeLift": a_unknown or b_unknown or baseline_zero}
        for key, unknown in expected.items():
            _require((result[key] is None) == unknown)


def validate_input(operation: str, value: object) -> None:
    if operation == "briefs":
        # current registry／compatibility 由 server 驗，唔新增 catalogue preflight 網絡呼叫。
        _brief_input(value)
    else:
        _record(_comparison_fields)(value)


def validate_result(operation: str, value: object) -> None:
    {"catalogue": _catalogue, "briefs": _brief_artifact, "comparisons": _comparison_artifact}[operation](value)
