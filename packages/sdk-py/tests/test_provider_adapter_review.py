"""Offline replay gate for the shared provider-adapter review packet."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
from typing import Any

import pytest

from agenttool import AnthropicAdapter, OpenAIResponsesAdapter
from agenttool.exceptions import AgentToolError


_REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
_EVIDENCE_PATH = (
    _REPOSITORY_ROOT / "review/provider-adapters/v1/evidence.json"
)

_VOCABULARY = {
    "providers": ["openai", "anthropic"],
    "languages": ["typescript", "python"],
    "lifecycles": [
        "completed",
        "low-level-stream",
        "managed-stream",
        "refused",
    ],
    "boundaries": [
        "agenttool.wake",
        "agenttool.write",
        "provider.openai.responses",
        "provider.anthropic.messages",
        "provider.anthropic.stream",
        "adapter",
    ],
    "operations": [
        "system",
        "create",
        "stream",
        "final-message",
        "abort",
        "result",
        "refuse",
    ],
    "dataClasses": [
        "wake-text",
        "caller-instructions",
        "caller-prompt",
        "provider-metadata",
        "provider-response",
        "provider-stream-event",
        "prompt-excerpt",
        "response-excerpt",
        "parsed-chronicle",
        "parsed-trace",
        "local-receipt",
    ],
    "flowEndpoints": [
        "provider-client",
        "agenttool-wake",
        "agenttool-traces",
        "agenttool-chronicle",
        "caller-process",
        "adapter-process",
    ],
    "controlKinds": ["enforced-local", "requested-upstream"],
}

_SOURCE_BINDINGS = {
    "openai-typescript": (
        "openai",
        "typescript",
        "packages/sdk-ts/src/openai-responses-adapter.ts",
    ),
    "openai-python": (
        "openai",
        "python",
        "packages/sdk-py/src/agenttool/openai_responses_adapter.py",
    ),
    "anthropic-typescript": (
        "anthropic",
        "typescript",
        "packages/sdk-ts/src/anthropic-adapter.ts",
    ),
    "anthropic-python": (
        "anthropic",
        "python",
        "packages/sdk-py/src/agenttool/anthropic_adapter.py",
    ),
}

_FLOW_IDS = {
    "wake-to-provider",
    "caller-request-to-provider",
    "provider-response-to-caller",
    "provider-stream-event-to-caller",
    "local-receipt-to-caller",
    "opt-in-trace-to-agenttool",
    "anthropic-chronicle-markup-to-agenttool",
    "anthropic-trace-markup-to-agenttool",
}

_CONTROL_IDS = {
    "local-agenttool-metadata-stripped",
    "openai-omitted-store-false",
    "openai-explicit-store-preserved",
    "openai-stream-background-refused",
    "anthropic-wake-block-order",
    "anthropic-ephemeral-cache-request",
    "anthropic-low-level-no-final-effects",
    "anthropic-managed-terminal-fence",
}

_CASE_BINDINGS = {
    "openai-completed-default-store-trace": (
        "openai",
        "completed",
        "openai.completed.default-store-trace",
        (
            "local-agenttool-metadata-stripped",
            "openai-omitted-store-false",
        ),
    ),
    "openai-completed-explicit-store-skip-wake": (
        "openai",
        "completed",
        "openai.completed.explicit-store-skip-wake",
        (
            "local-agenttool-metadata-stripped",
            "openai-explicit-store-preserved",
        ),
    ),
    "openai-stream-refused-before-io": (
        "openai",
        "refused",
        "openai.refused.stream",
        ("openai-stream-background-refused",),
    ),
    "openai-background-refused-before-io": (
        "openai",
        "refused",
        "openai.refused.background",
        ("openai-stream-background-refused",),
    ),
    "anthropic-completed-trace-and-markup": (
        "anthropic",
        "completed",
        "anthropic.completed.trace-and-markup",
        (
            "local-agenttool-metadata-stripped",
            "anthropic-wake-block-order",
            "anthropic-ephemeral-cache-request",
        ),
    ),
    "anthropic-low-level-no-final-effects": (
        "anthropic",
        "low-level-stream",
        "anthropic.low-level.no-final-effects",
        (
            "local-agenttool-metadata-stripped",
            "anthropic-low-level-no-final-effects",
        ),
    ),
    "anthropic-low-level-trace-refused-before-io": (
        "anthropic",
        "refused",
        "anthropic.low-level.trace-refused",
        ("anthropic-low-level-no-final-effects",),
    ),
    "anthropic-managed-completed-exact-once": (
        "anthropic",
        "managed-stream",
        "anthropic.managed.completed-exact-once",
        (
            "local-agenttool-metadata-stripped",
            "anthropic-managed-terminal-fence",
        ),
    ),
    "anthropic-managed-cancelled-no-effects": (
        "anthropic",
        "managed-stream",
        "anthropic.managed.cancelled-no-effects",
        (
            "local-agenttool-metadata-stripped",
            "anthropic-managed-terminal-fence",
        ),
    ),
}

_CREDENTIAL_SHAPE = re.compile(
    r"(?:\bBearer\s+[A-Za-z0-9._~+/=-]{12,}"
    r"|-----BEGIN [A-Z ]*PRIVATE KEY-----"
    r"|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}"
    r"|\bAKIA[0-9A-Z]{16}\b"
    r"|\b(?:ghp|github_pat|xox[baprs])_[A-Za-z0-9_-]{12,})",
    re.IGNORECASE,
)

_CREDENTIAL_KEY_NAMES = {
    "authorization",
    "token",
    "secret",
    "password",
}


def _object(value: Any, label: str) -> dict[str, Any]:
    assert type(value) is dict, f"{label} must be a plain object"
    return value


def _array(value: Any, label: str) -> list[Any]:
    assert type(value) is list, f"{label} must be an array"
    return value


def _text(value: Any, label: str) -> str:
    assert type(value) is str and value, f"{label} must be non-empty text"
    return value


def _exact_keys(
    value: dict[str, Any], expected: set[str], label: str
) -> None:
    assert set(value) == expected, f"{label} fields are not closed"


def _unique(values: list[Any], label: str) -> None:
    canonical = [
        json.dumps(value, sort_keys=True, separators=(",", ":"))
        for value in values
    ]
    assert len(canonical) == len(set(canonical)), f"{label} must be unique"


def _closed_array(
    value: Any,
    allowed: list[str],
    label: str,
    *,
    minimum: int = 1,
) -> list[str]:
    values = _array(value, label)
    assert len(values) >= minimum, f"{label} is too short"
    assert all(type(item) is str and item in allowed for item in values), (
        f"{label} is outside the closed vocabulary"
    )
    _unique(values, label)
    return values


def _assert_no_credential_shaped_value(
    value: Any, label: str = "fixture"
) -> None:
    if isinstance(value, str):
        assert _CREDENTIAL_SHAPE.search(value) is None, (
            f"{label} contains credential-shaped text"
        )
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _assert_no_credential_shaped_value(item, f"{label}[{index}]")
    elif isinstance(value, dict):
        for key, item in value.items():
            normalized_key = re.sub(r"[^a-z0-9]", "", key.lower())
            assert (
                normalized_key not in _CREDENTIAL_KEY_NAMES
                and not normalized_key.endswith(
                    (
                        "apikey",
                        "accesstoken",
                        "authtoken",
                        "apitoken",
                        "bearertoken",
                        "clientsecret",
                        "privatekey",
                        "secretkey",
                        "secretaccesskey",
                        "sessiontoken",
                        "accesstoken",
                        "refreshtoken",
                        "accesskeyid",
                        "signingkey",
                    )
                )
            ), f"{label} contains credential-shaped key {key!r}"
            _assert_no_credential_shaped_value(item, f"{label}.{key}")


def _read_source(relative_path: str) -> bytes:
    relative = PurePosixPath(relative_path)
    assert not relative.is_absolute() and ".." not in relative.parts
    absolute = (_REPOSITORY_ROOT / relative).resolve()
    absolute.relative_to(_REPOSITORY_ROOT)
    assert absolute.is_file()
    return absolute.read_bytes()


def _validate_packet(packet_value: Any) -> list[dict[str, Any]]:
    packet = _object(packet_value, "evidence packet")
    _exact_keys(
        packet,
        {
            "$schema",
            "format",
            "asOf",
            "repository",
            "sources",
            "vocabulary",
            "normalization",
            "flows",
            "controls",
            "cases",
            "proofLimits",
        },
        "evidence packet",
    )
    assert packet["$schema"] == "./evidence.schema.json"
    assert packet["format"] == "agenttool-provider-adapter-evidence/v1"
    assert packet["asOf"] == "2026-07-26"

    repository = _object(packet["repository"], "repository")
    _exact_keys(
        repository, {"url", "commit", "digestAlgorithm"}, "repository"
    )
    assert repository == {
        "url": "https://github.com/cambridgetcg/agenttool",
        "commit": "7fd454919c9803b3ae41294cfd976137c5137504",
        "digestAlgorithm": "sha256",
    }

    sources = _array(packet["sources"], "sources")
    assert len(sources) == len(_SOURCE_BINDINGS)
    source_ids: list[str] = []
    for index, source_value in enumerate(sources):
        label = f"sources[{index}]"
        source = _object(source_value, label)
        _exact_keys(
            source, {"id", "provider", "language", "path", "sha256"}, label
        )
        source_id = _text(source["id"], f"{label}.id")
        assert source_id in _SOURCE_BINDINGS
        assert (
            source["provider"],
            source["language"],
            source["path"],
        ) == _SOURCE_BINDINGS[source_id]
        digest = _text(source["sha256"], f"{label}.sha256")
        assert re.fullmatch(r"[0-9a-f]{64}", digest)
        assert hashlib.sha256(_read_source(source["path"])).hexdigest() == digest
        source_ids.append(source_id)
    assert set(source_ids) == set(_SOURCE_BINDINGS)
    _unique(source_ids, "source ids")

    vocabulary = _object(packet["vocabulary"], "vocabulary")
    _exact_keys(vocabulary, set(_VOCABULARY), "vocabulary")
    assert vocabulary == _VOCABULARY

    normalization = _object(packet["normalization"], "normalization")
    _exact_keys(
        normalization,
        {
            "fieldNames",
            "omittedIdentityId",
            "omittedWakeProfile",
            "payloadRule",
            "resultRule",
        },
        "normalization",
    )
    assert normalization["fieldNames"] == "camelCase"
    assert normalization["omittedIdentityId"] is None
    assert normalization["omittedWakeProfile"] == "full"
    _text(normalization["payloadRule"], "normalization.payloadRule")
    _text(normalization["resultRule"], "normalization.resultRule")

    flows = _array(packet["flows"], "flows")
    assert len(flows) == len(_FLOW_IDS)
    flow_ids: list[str] = []
    for index, flow_value in enumerate(flows):
        label = f"flows[{index}]"
        flow = _object(flow_value, label)
        _exact_keys(
            flow,
            {
                "id",
                "providers",
                "lifecycles",
                "when",
                "dataClasses",
                "source",
                "destination",
            },
            label,
        )
        flow_id = _text(flow["id"], f"{label}.id")
        assert flow_id in _FLOW_IDS
        _closed_array(
            flow["providers"], _VOCABULARY["providers"], f"{label}.providers"
        )
        _closed_array(
            flow["lifecycles"],
            _VOCABULARY["lifecycles"],
            f"{label}.lifecycles",
        )
        _text(flow["when"], f"{label}.when")
        _closed_array(
            flow["dataClasses"],
            _VOCABULARY["dataClasses"],
            f"{label}.dataClasses",
        )
        assert flow["source"] in _VOCABULARY["flowEndpoints"]
        assert flow["destination"] in _VOCABULARY["flowEndpoints"]
        flow_ids.append(flow_id)
    assert set(flow_ids) == _FLOW_IDS
    _unique(flow_ids, "flow ids")

    controls = _array(packet["controls"], "controls")
    assert len(controls) == len(_CONTROL_IDS)
    control_ids: list[str] = []
    for index, control_value in enumerate(controls):
        label = f"controls[{index}]"
        control = _object(control_value, label)
        _exact_keys(
            control, {"id", "providers", "kind", "statement"}, label
        )
        control_id = _text(control["id"], f"{label}.id")
        assert control_id in _CONTROL_IDS
        _closed_array(
            control["providers"],
            _VOCABULARY["providers"],
            f"{label}.providers",
        )
        assert control["kind"] in _VOCABULARY["controlKinds"]
        _text(control["statement"], f"{label}.statement")
        control_ids.append(control_id)
    assert set(control_ids) == _CONTROL_IDS
    _unique(control_ids, "control ids")

    cases = _array(packet["cases"], "cases")
    assert len(cases) == len(_CASE_BINDINGS)
    case_ids: list[str] = []
    for index, case_value in enumerate(cases):
        label = f"cases[{index}]"
        case = _object(case_value, label)
        _exact_keys(
            case,
            {
                "id",
                "provider",
                "lifecycle",
                "fixture",
                "proves",
                "expectedTranscript",
            },
            label,
        )
        case_id = _text(case["id"], f"{label}.id")
        assert case_id in _CASE_BINDINGS
        provider, lifecycle, fixture, proves = _CASE_BINDINGS[case_id]
        assert (
            case["provider"],
            case["lifecycle"],
            case["fixture"],
            tuple(case["proves"]),
        ) == (provider, lifecycle, fixture, proves)

        transcript = _array(
            case["expectedTranscript"], f"{label}.expectedTranscript"
        )
        assert transcript
        for event_index, event_value in enumerate(transcript):
            event_label = f"{label}.expectedTranscript[{event_index}]"
            event = _object(event_value, event_label)
            _exact_keys(
                event, {"boundary", "operation", "payload"}, event_label
            )
            assert event["boundary"] in _VOCABULARY["boundaries"]
            assert event["operation"] in _VOCABULARY["operations"]
            _object(event["payload"], f"{event_label}.payload")
        case_ids.append(case_id)
    assert set(case_ids) == set(_CASE_BINDINGS)
    _unique(case_ids, "case ids")

    proof_limits = _array(packet["proofLimits"], "proofLimits")
    assert len(proof_limits) == 5
    for index, statement in enumerate(proof_limits):
        _text(statement, f"proofLimits[{index}]")
    _unique(proof_limits, "proofLimits")
    return cases


def _copy_json(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False))


class _Recorder:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []
        self.wake_calls = 0
        self.provider_calls = 0
        self.agenttool_writes = 0
        self.final_message_calls = 0
        self.abort_calls = 0

    def add(self, boundary: str, operation: str, payload: Any) -> None:
        self.events.append(
            {
                "boundary": boundary,
                "operation": operation,
                "payload": _copy_json(payload),
            }
        )


class _RecordingWake:
    def __init__(self, recorder: _Recorder) -> None:
        self._recorder = recorder

    def system(
        self,
        provider: str,
        *,
        identity_id: Any = None,
        profile: str = "full",
    ) -> dict[str, Any]:
        self._recorder.wake_calls += 1
        self._recorder.add(
            "agenttool.wake",
            "system",
            {
                "provider": provider,
                "identityId": identity_id,
                "profile": profile,
            },
        )
        if provider == "openai":
            return {
                "messages": [
                    {"role": "system", "content": "OPENAI_STABLE_WAKE"},
                    {"role": "system", "content": "OPENAI_VOLATILE_WAKE"},
                ],
                "_meta": {"cache_eligible": "review-fixture"},
            }
        return {
            "system": [
                {
                    "type": "text",
                    "text": "ANTHROPIC_STABLE_WAKE",
                    "cache_control": {"type": "ephemeral"},
                },
                {"type": "text", "text": "ANTHROPIC_VOLATILE_WAKE"},
            ],
            "_meta": {"cache_eligible": "review-fixture"},
        }


class _RecordingAgentTool:
    def __init__(self, recorder: _Recorder) -> None:
        self._recorder = recorder
        self.wake = _RecordingWake(recorder)
        self._trace_count = 0
        self._chronicle_count = 0

    def request(self, method: str, path: str, body: Any = None) -> Any:
        self._recorder.agenttool_writes += 1
        self._recorder.add(
            "agenttool.write",
            "create",
            {"method": method, "path": path, "body": body},
        )
        if path == "/v1/traces":
            self._trace_count += 1
            return {"trace_id": f"tr_review_{self._trace_count}"}
        if path == "/v1/chronicle":
            self._chronicle_count += 1
            return {"entry": {"id": f"ch_review_{self._chronicle_count}"}}
        return {}


class _RecordingOpenAI:
    def __init__(self, recorder: _Recorder) -> None:
        self._recorder = recorder
        self.responses = SimpleNamespace(create=self._create)

    def _create(self, **params: Any) -> dict[str, Any]:
        self._recorder.provider_calls += 1
        self._recorder.add(
            "provider.openai.responses", "create", params
        )
        return {
            "id": "resp_review_fixture",
            "status": "completed",
            "output_text": "Bridge accepted.",
            "output": [],
        }


class _LowLevelStream:
    def __init__(self) -> None:
        self._events = iter(["delta"])
        self.close_calls = 0

    def __iter__(self) -> "_LowLevelStream":
        return self

    def __next__(self) -> str:
        return next(self._events)

    def close(self) -> None:
        self.close_calls += 1


class _ManagedProviderStream:
    def __init__(self, recorder: _Recorder) -> None:
        self._recorder = recorder
        self.text_stream = iter(())
        self.closed = False
        self.close_calls = 0

    def __iter__(self) -> "_ManagedProviderStream":
        return self

    def __next__(self) -> Any:
        raise StopIteration

    def get_final_message(self) -> dict[str, Any]:
        self._recorder.final_message_calls += 1
        self._recorder.add(
            "provider.anthropic.stream",
            "final-message",
            {"call": self._recorder.final_message_calls},
        )
        return {
            "id": "msg_review_managed",
            "model": "claude-review-fixture",
            "content": [{"type": "text", "text": "Managed complete."}],
            "stop_reason": "end_turn",
        }

    def abort(self) -> None:
        self._recorder.abort_calls += 1
        self.closed = True
        self._recorder.add(
            "provider.anthropic.stream",
            "abort",
            {"call": self._recorder.abort_calls},
        )

    def close(self) -> None:
        self.close_calls += 1
        self.closed = True


class _ManagedManager:
    def __init__(self, stream: _ManagedProviderStream) -> None:
        self._stream = stream

    def __enter__(self) -> _ManagedProviderStream:
        return self._stream

    def __exit__(self, exc_type: Any, exc: Any, exc_tb: Any) -> None:
        if not self._stream.closed:
            self._stream.close()


class _RecordingAnthropic:
    _COMPLETED_TEXT = (
        "Bridge accepted.\n"
        '<agenttool><chronicle type="recognition">'
        "<title>Bridge reviewed</title><body>Offline fixture.</body>"
        "</chronicle></agenttool>"
    )

    def __init__(self, recorder: _Recorder) -> None:
        self._recorder = recorder
        self.managed = _ManagedProviderStream(recorder)
        self._manager = _ManagedManager(self.managed)
        self.messages = SimpleNamespace(
            create=self._create,
            stream=self._stream,
        )

    def _create(self, **params: Any) -> Any:
        self._recorder.provider_calls += 1
        self._recorder.add(
            "provider.anthropic.messages", "create", params
        )
        if params.get("stream") is True:
            return _LowLevelStream()
        return {
            "id": "msg_review_completed",
            "model": "claude-review-fixture",
            "content": [{"type": "text", "text": self._COMPLETED_TEXT}],
            "stop_reason": "end_turn",
        }

    def _stream(self, **params: Any) -> _ManagedManager:
        self._recorder.provider_calls += 1
        self._recorder.add(
            "provider.anthropic.stream", "stream", params
        )
        return self._manager


def _adapter_result(
    recorder: _Recorder, payload: dict[str, Any]
) -> list[dict[str, Any]]:
    recorder.add("adapter", "result", payload)
    return recorder.events


def _replay_openai(fixture: str) -> list[dict[str, Any]]:
    recorder = _Recorder()
    agenttool = _RecordingAgentTool(recorder)
    provider = _RecordingOpenAI(recorder)
    adapter = OpenAIResponsesAdapter(provider, agenttool)  # type: ignore[arg-type]

    if fixture == "openai.completed.default-store-trace":
        response = adapter.responses.create(
            model="gpt-review-fixture",
            input="Review this bridge.",
            instructions="Stay concise.",
            metadata={
                "agenttool": {
                    "trace": "decision",
                    "decision_type": "review",
                    "tags": ["evidence"],
                },
                "tenant": "review-fixture",
            },
        )
        return _adapter_result(
            recorder,
            {
                "status": response.status,
                "traceId": response.agenttool.trace_id,
                "wakeUsed": response.agenttool.wake_used,
                "cacheEligible": response.agenttool.cache_eligible,
            },
        )

    if fixture == "openai.completed.explicit-store-skip-wake":
        response = adapter.responses.create(
            model="gpt-review-fixture",
            input="Keep this private choice.",
            instructions="Caller only.",
            metadata={
                "agenttool": {"skip_wake": True},
                "tenant": "review-fixture",
            },
            store=True,
        )
        return _adapter_result(
            recorder,
            {
                "status": response.status,
                "traceId": response.agenttool.trace_id,
                "wakeUsed": response.agenttool.wake_used,
                "cacheEligible": response.agenttool.cache_eligible,
            },
        )

    if fixture == "openai.refused.stream":
        with pytest.raises(AgentToolError, match="streaming"):
            adapter.responses.create(
                model="gpt-review-fixture",
                input="Do not send.",
                stream=True,
            )
        assert recorder.events == []
        recorder.add(
            "adapter",
            "refuse",
            {
                "reason": "streaming-unsupported",
                "wakeCalls": recorder.wake_calls,
                "providerCalls": recorder.provider_calls,
            },
        )
        return recorder.events

    if fixture == "openai.refused.background":
        with pytest.raises(AgentToolError, match="background"):
            adapter.responses.create(
                model="gpt-review-fixture",
                input="Do not send.",
                background=True,
            )
        assert recorder.events == []
        recorder.add(
            "adapter",
            "refuse",
            {
                "reason": "background-unsupported",
                "wakeCalls": recorder.wake_calls,
                "providerCalls": recorder.provider_calls,
            },
        )
        return recorder.events

    raise AssertionError(f"unknown OpenAI fixture: {fixture}")


def _replay_anthropic(fixture: str) -> list[dict[str, Any]]:
    recorder = _Recorder()
    agenttool = _RecordingAgentTool(recorder)
    provider = _RecordingAnthropic(recorder)
    adapter = AnthropicAdapter(provider, agenttool)  # type: ignore[arg-type]

    if fixture == "anthropic.completed.trace-and-markup":
        response = adapter.messages.create(
            model="claude-review-fixture",
            max_tokens=64,
            messages=[{"role": "user", "content": "Record this result."}],
            system="Caller system.",
            metadata={
                "agenttool": {
                    "trace": "decision",
                    "decision_type": "review",
                },
                "tenant": "review-fixture",
            },
        )
        return _adapter_result(
            recorder,
            {
                "status": "completed",
                "traceId": response.agenttool.trace_id,
                "wakeUsed": response.agenttool.wake_used,
                "cacheEligible": response.agenttool.cache_eligible,
                "markupCount": len(response.agenttool.markup_emissions),
            },
        )

    if fixture == "anthropic.low-level.no-final-effects":
        stream = adapter.messages.create(
            model="claude-review-fixture",
            max_tokens=64,
            messages=[{"role": "user", "content": "Pass one event."}],
            stream=True,
            metadata={
                "agenttool": {"trace": False},
                "tenant": "review-fixture",
            },
        )
        events = list(stream)
        stream.close()
        return _adapter_result(
            recorder,
            {
                "status": "passed-through",
                "events": events,
                "traceId": stream.agenttool.trace_id,
                "markupCount": len(stream.agenttool.markup_emissions),
                "agenttoolWriteCount": recorder.agenttool_writes,
            },
        )

    if fixture == "anthropic.low-level.trace-refused":
        with pytest.raises(AgentToolError) as captured:
            adapter.messages.create(
                model="claude-review-fixture",
                max_tokens=64,
                messages=[{"role": "user", "content": "Do not send."}],
                stream=True,
                metadata={"agenttool": {"trace": "decision"}},
            )
        assert (
            captured.value.error_code
            == "anthropic_stream_trace_requires_helper"
        )
        assert recorder.events == []
        recorder.add(
            "adapter",
            "refuse",
            {
                "reason": "decision-trace-requires-managed-stream",
                "wakeCalls": recorder.wake_calls,
                "providerCalls": recorder.provider_calls,
            },
        )
        return recorder.events

    if fixture == "anthropic.managed.completed-exact-once":
        with adapter.messages.stream(
            model="claude-review-fixture",
            max_tokens=64,
            messages=[{"role": "user", "content": "Finish once."}],
            metadata={
                "agenttool": {
                    "trace": "decision",
                    "decision_type": "review",
                },
                "tenant": "review-fixture",
            },
        ) as stream:
            first = stream.get_final_message()
            second = stream.get_final_message()
            assert first is second
        assert recorder.final_message_calls == 1
        assert recorder.agenttool_writes == 1
        return _adapter_result(
            recorder,
            {
                "status": "completed",
                "traceId": first.agenttool.trace_id,
                "finalizationCount": recorder.final_message_calls,
                "agenttoolWriteCount": recorder.agenttool_writes,
            },
        )

    if fixture == "anthropic.managed.cancelled-no-effects":
        with adapter.messages.stream(
            model="claude-review-fixture",
            max_tokens=64,
            messages=[
                {"role": "user", "content": "Cancel before effects."}
            ],
            metadata={
                "agenttool": {
                    "trace": "decision",
                    "decision_type": "review",
                },
                "tenant": "review-fixture",
            },
        ) as stream:
            stream.abort()
            stream.abort()
            for _ in range(2):
                with pytest.raises(AgentToolError) as captured:
                    stream.get_final_message()
                assert captured.value.error_code == "anthropic_stream_closed"
        assert recorder.abort_calls == 1
        assert recorder.final_message_calls == 0
        assert recorder.agenttool_writes == 0
        return _adapter_result(
            recorder,
            {
                "status": "cancelled",
                "finalizationCount": recorder.final_message_calls,
                "agenttoolWriteCount": recorder.agenttool_writes,
            },
        )

    raise AssertionError(f"unknown Anthropic fixture: {fixture}")


def _replay(case: dict[str, Any]) -> list[dict[str, Any]]:
    fixture = case["fixture"]
    if case["provider"] == "openai":
        return _replay_openai(fixture)
    if case["provider"] == "anthropic":
        return _replay_anthropic(fixture)
    raise AssertionError(f"unknown provider: {case['provider']}")


def test_shared_provider_adapter_review_packet_is_replayable_offline() -> None:
    packet = json.loads(_EVIDENCE_PATH.read_text(encoding="utf-8"))
    _assert_no_credential_shaped_value(packet)
    cases = _validate_packet(packet)

    for case in cases:
        actual = _replay(case)
        _assert_no_credential_shaped_value(actual)
        assert actual == case["expectedTranscript"], case["id"]
