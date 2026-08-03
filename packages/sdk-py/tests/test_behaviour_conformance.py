"""Shared behaviour-conformance fixture — the Python SDK's side.

This suite reads ``docs/specs/behaviour-conformance.json``, the SAME file read
by ``packages/sdk-ts/tests/behaviour-conformance.test.ts``. It is the third and
last cross-language gate:

  1. canonical bytes     → docs/specs/canonical-bytes-vectors.json
  2. identifier spelling → packages/sdk-ts/scripts/check-parity.ts
  3. BEHAVIOUR           → this file

Layers 1 and 2 both pass green while ``nen.assess`` classifies the same wake
JSON as a different Nen type in each language, while a memory parse drops the
asymmetry-clause field, while ``collect.batch([])`` raises in a module whose
contract is that it never throws, and while one SDK follows a redirect the
other refuses. Same method name, same canonical bytes, different answer.

Each case pins input → stubbed HTTP exchange → observable outcome. A case this
SDK cannot satisfy is an EXPLICIT NAMED SKIP carrying the reason from the
fixture — never a silent omission. A silent omission is how this bug class
survived in the first place.

Doctrine: docs/specs/BEHAVIOUR-CONFORMANCE.md.
"""

from __future__ import annotations

import base64
import contextlib
import dataclasses
import json
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Mapping, Optional, Tuple
from unittest.mock import patch
from urllib.parse import parse_qsl

import httpx
import pytest

from agenttool._url import _path_segment
from agenttool.client import AgentTool
from agenttool.exceptions import AgentToolError
from agenttool.nen import assess_nen

# ── fixture ────────────────────────────────────────────────────────────

FIXTURE_PATH = (
    Path(__file__).resolve().parents[3] / "docs" / "specs" / "behaviour-conformance.json"
)
FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

Input = Mapping[str, Any]


# ── normalisation ──────────────────────────────────────────────────────
#
# The two languages hand back different containers for the same answer: a
# dataclass here, a decoded JSON object there. Both loaders flatten to the same
# JSON-shaped value first, and both read a missing field as None, so an absent
# Python attribute and TypeScript ``undefined`` compare equal.


def _normalise(value: Any) -> Any:
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return {
            field.name: _normalise(getattr(value, field.name))
            for field in dataclasses.fields(value)
        }
    if isinstance(value, (bytes, bytearray)):
        return base64.b64encode(bytes(value)).decode("ascii")
    if isinstance(value, (list, tuple)):
        return [_normalise(item) for item in value]
    if isinstance(value, dict):
        return {key: _normalise(inner) for key, inner in value.items()}
    if isinstance(value, str):
        # ``_StableCode`` is a str subclass; compare as the plain string it is.
        return str(value)
    return value


def _project(expected: Any, actual: Any) -> Any:
    """Project the actual value down to the shape the fixture names.

    Only the keys a case pins are compared — that is what lets one fixture
    describe a nine-field dataclass and a decoded JSON object at once — but
    everything it does pin is compared exactly.
    """
    if expected is None:
        return actual
    if isinstance(expected, bool) or isinstance(actual, bool):
        # ``True == 1`` in Python; keep a bool expectation from matching an int.
        if isinstance(expected, bool) != isinstance(actual, bool):
            return repr(actual)
        return actual
    if isinstance(expected, list):
        if not isinstance(actual, list):
            return actual
        return [
            _project(expected[index], item) if index < len(expected) else item
            for index, item in enumerate(actual)
        ]
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return actual
        return {
            key: _project(inner, actual.get(key)) for key, inner in expected.items()
        }
    return actual


def _assert_matches(expected: Any, actual: Any, label: str) -> None:
    assert _project(expected, _normalise(actual)) == expected, label


ERROR_FIELDS: Tuple[Tuple[str, str], ...] = (
    # (fixture spelling, sdk-py attribute) — the whole camelCase/snake_case
    # mapping for errors lives here and nowhere else.
    ("message", "message"),
    ("code", "code"),
    ("status", "status"),
    ("hint", "hint"),
    ("docs", "docs"),
    ("safety", "safety"),
    ("details", "details"),
    ("next_actions", "next_actions"),
    ("x402_version", "x402_version"),
    ("accepts", "accepts"),
    ("resource", "x402_resource"),
    ("extensions", "extensions"),
    ("payment_required", "payment_required"),
    ("payment_response", "payment_response"),
    ("payment_status_link", "payment_status_link"),
    ("retry_after", "retry_after"),
    ("credits_balance", "credits_balance"),
)


def _normalise_error(error: BaseException) -> Optional[Dict[str, Any]]:
    if not isinstance(error, AgentToolError):
        return None
    shape: Dict[str, Any] = {"type": "agenttool_error"}
    for wire_name, attribute in ERROR_FIELDS:
        shape[wire_name] = _normalise(getattr(error, attribute, None))
    return shape


# ── stub transport ─────────────────────────────────────────────────────


@dataclasses.dataclass
class Captured:
    method: str
    path: str
    query: Dict[str, str]
    raw_query: str
    body: Any
    headers: httpx.Headers


def _capture(request: httpx.Request) -> Captured:
    raw_path, _, raw_query = request.url.raw_path.decode("ascii").partition("?")
    content = request.content
    return Captured(
        method=request.method,
        path=raw_path,
        query=dict(parse_qsl(raw_query, keep_blank_values=True)),
        raw_query=raw_query,
        body=json.loads(content) if content else None,
        headers=request.headers,
    )


@contextlib.contextmanager
def _stubbed(exchange: Optional[Mapping[str, Any]]) -> Iterator[Tuple[AgentTool, List[Captured]]]:
    """Install the case's single stubbed exchange and record what was sent.

    ``lounge.look`` deliberately builds its own credential-free ``httpx.Client``
    rather than reusing the authenticated one, so the same mock transport is
    injected there too — otherwise that read would escape the stub entirely.
    """
    captured: List[Captured] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(_capture(request))
        if exchange is None:
            # A case with no `exchange` must never reach the transport. Answer
            # with something no assertion could accidentally accept.
            return httpx.Response(599, json={"unreachable": True})
        headers = dict(exchange.get("headers") or {})
        if "json" in exchange:
            return httpx.Response(exchange["status"], json=exchange["json"], headers=headers)
        if "text" in exchange:
            return httpx.Response(exchange["status"], text=exchange["text"], headers=headers)
        return httpx.Response(exchange["status"], headers=headers)

    transport = httpx.MockTransport(handler)
    real_client = httpx.Client

    def public_client(**kwargs: Any) -> httpx.Client:
        kwargs["transport"] = transport
        return real_client(**kwargs)

    client = AgentTool(transport=transport, base_url="https://example.test")
    try:
        with patch("agenttool.lounge.httpx.Client", public_client):
            yield client, captured
    finally:
        client.close()


# ── one adapter per operation ──────────────────────────────────────────
#
# The fixture speaks wire spelling (snake_case), which this SDK happens to
# share; the adapter table is still the only place argument mapping lives, as
# in tests/test_canonical_vectors.py. A key ABSENT from ``input`` means the
# argument is not passed at all.


def _optional(source: Input, *names: str) -> Dict[str, Any]:
    return {name: source[name] for name in names if name in source}


def _b64(value: str) -> bytes:
    """Any field ending ``_b64`` is standard base64 of raw bytes."""
    return base64.b64decode(value)


def _raise_from_response_body(i: Input) -> Any:
    """Builds the error and RAISES it, so every case reads through expect.error."""
    kwargs: Dict[str, Any] = {}
    if "fallback" in i:
        kwargs["fallback"] = i["fallback"]
    if "headers" in i:
        kwargs["headers"] = i["headers"]
    raise AgentToolError.from_response_body(i["body"], i["status"], **kwargs)


def _guided_http_boundary(at: AgentTool, i: Input) -> Any:
    """One client call per ``surface``, so the fixture can assert that every
    client reaches the same parser rather than hand-rolling a lossier one.

    Arguments are the least a surface accepts — the case is about the error.
    """
    surface = i["surface"]
    if surface == "chronicle.write":
        return at.chronicle.write(type="note", title="a title")
    if surface == "covenants.create":
        return at.covenants.create(
            agent_id="identity-1",
            counterparty_did="did:at:other",
            vows=["I will witness you."],
        )
    if surface == "grace.list":
        return at.grace.list()
    if surface == "identity.get":
        return at.identity.get("identity-1")
    if surface == "inbox.list":
        return at.inbox.list()
    if surface == "wake.get":
        return at.wake.get()
    raise AssertionError(f"unknown surface: {surface}")


ADAPTERS: Dict[str, Callable[[AgentTool, Input], Any]] = {
    # The shared path-segment boundary, called directly.
    #
    # Not routed through a client on purpose: a client call would only prove the
    # two SDKs agree on one route, and this operation is about the bytes the
    # encoder produces for every id, everywhere. ``memory.get`` drives the same
    # characters through the transport so both halves are pinned.
    "url.encode_path_segment": lambda at, i: _path_segment(i["value"]),
    "error.guided_http_boundary": _guided_http_boundary,
    "memory.get": lambda at, i: at.memory.get(i["memory_id"]),
    "memory.search": lambda at, i: at.memory.search(
        i["query"], **_optional(i, "limit", "type", "agent_id")
    ),
    "memory.store": lambda at, i: at.memory.store(
        i["content"], **_optional(i, "type", "importance", "key", "agent_id", "metadata")
    ),
    "memory.delete_by_key": lambda at, i: at.memory.delete_by_key(i["key"]),
    "chronicle.write": lambda at, i: at.chronicle.write(
        type=i["type"],
        title=i["title"],
        **_optional(i, "body", "agent_id", "occurred_at", "metadata"),
    ),
    "chronicle.list": lambda at, i: at.chronicle.list(
        **_optional(i, "agent_id", "type", "limit")
    ),
    "nen.assess_wake": lambda at, i: assess_nen(i["wake"]),
    "nen.assess": lambda at, i: (
        at.nen.assess(i["identity_id"]) if "identity_id" in i else at.nen.assess()
    ),
    "collect.batch": lambda at, i: at.collect.batch(urls=list(i["urls"])),
    "lounge.look": lambda at, i: at.lounge.look(),
    "love.self_recognize": lambda at, i: at.love.self_recognize(
        agent_did=i["agent_did"],
        recognition_kind=i["recognition_kind"],
        claim_summary=i["claim_summary"],
        claim_body=i["claim_body"],
        signing_key=_b64(i["signing_key_b64"]),
        signing_key_id=i["signing_key_id"],
        declared_at=i["declared_at"],
        **_optional(
            i, "empirical_anchors", "substrate_honest_caveats", "math_content", "session_id"
        ),
    ),
    "error.from_response_body": lambda at, i: _raise_from_response_body(i),
}


# ── running one case ───────────────────────────────────────────────────


def _assert_requests(captured: List[Captured], expect: Mapping[str, Any], label: str) -> None:
    if expect.get("no_request"):
        assert [f"{sent.method} {sent.path}" for sent in captured] == [], (
            f"{label}: the transport must not be touched"
        )
        return
    wanted = expect.get("request")
    if wanted is None:
        return

    assert len(captured) == 1, f"{label}: expected exactly one request, got {len(captured)}"
    sent = captured[0]
    assert sent.method == wanted["method"], f"{label}: method"
    assert sent.path == wanted["path"], f"{label}: path"
    if "query" in wanted:
        assert sent.query == wanted["query"], f"{label}: query"
    if "raw_query" in wanted:
        assert sent.raw_query == wanted["raw_query"], f"{label}: raw query"
    _assert_matches(wanted["body"], sent.body, f"{label}: body")
    for header in wanted.get("headers_absent", []):
        assert header not in sent.headers, f"{label}: {header} must be absent"


def _run_case(operation: str, case: Mapping[str, Any], label: str) -> None:
    adapter = ADAPTERS[operation]
    with _stubbed(case.get("exchange")) as (client, captured):
        outcome: Any = None
        raised: Optional[BaseException] = None
        try:
            outcome = adapter(client, case["input"])
        except BaseException as error:  # noqa: BLE001 — the outcome under test
            raised = error

        expect = case["expect"]
        if "error" in expect:
            assert raised is not None, (
                f"{label}: expected a raise, got {_normalise(outcome)!r}"
            )
            actual = _normalise_error(raised)
            if actual is None:
                raise raised
            wanted = dict(expect["error"])
            contains = wanted.pop("message_contains", None)
            if contains is not None:
                assert contains in str(actual["message"]), f"{label}: message contains"
            _assert_matches(wanted, actual, f"{label}: error")
        else:
            if raised is not None:
                raise raised
            _assert_matches(expect.get("result"), outcome, f"{label}: result")

        _assert_requests(captured, expect, label)


# ── parameter expansion ────────────────────────────────────────────────


def _params():
    params = []
    for group in FIXTURE["operations"]:
        operation = group["operation"]
        group_skip = group.get("sdk_py_skip")
        for case in group["cases"]:
            reason = group_skip or case.get("sdk_py_skip")
            marks = [pytest.mark.skip(reason=f"{operation}: {reason}")] if reason else []
            params.append(
                pytest.param(
                    operation, case, id=f"{operation}::{case['name']}", marks=marks
                )
            )
    return params


def test_fixture_is_loadable_and_every_case_carries_one_disposition():
    assert FIXTURE_PATH.is_file(), f"shared fixture missing at {FIXTURE_PATH}"
    assert FIXTURE["operations"], "the shared fixture pins no operations"
    for group in FIXTURE["operations"]:
        assert group["cases"], f"{group['operation']} pins no cases"
        for case in group["cases"]:
            label = f"{group['operation']}::{case['name']}"
            assert case.get("category", group["category"]) in FIXTURE["categories"], (
                f"{label} carries an unknown category"
            )
            dispositions = ["result" in case["expect"], "error" in case["expect"]]
            assert sum(dispositions) == 1, (
                f"{label} needs exactly one of expect.result / expect.error"
            )


def test_every_operation_is_either_adapted_or_explicitly_skipped():
    """Loud, never silent: an operation the fixture pins but this suite forgot
    to wire is the exact failure mode the fixture exists to prevent."""
    missing = [
        group["operation"]
        for group in FIXTURE["operations"]
        if not group.get("sdk_py_skip") and group["operation"] not in ADAPTERS
    ]
    assert missing == [], (
        f"no sdk-py adapter for {missing} — add one, or record an sdk_py_skip "
        f"reason in docs/specs/behaviour-conformance.json"
    )


@pytest.mark.parametrize("operation,case", _params())
def test_behaviour_case(operation, case):
    _run_case(operation, case, f"{operation}::{case['name']}")
