"""Offline contract tests for the synchronous OpenAI Responses adapter."""

from __future__ import annotations

from typing import Any, Optional

import pytest

from agenttool import OpenAIResponsesAdapter
from agenttool._context import AmbientContext, reset_ambient, set_ambient


class _StubAt:
    def __init__(self, request_impl=None) -> None:
        self.wake_calls = 0
        self.wake_options: list[dict[str, Any]] = []
        self.requests: list[tuple[str, str, Any]] = []
        self._request_impl = request_impl

        class _Wake:
            def system(
                _self,
                provider: str,
                *,
                identity_id: Optional[str] = None,
                profile: str = "full",
            ) -> dict[str, Any]:
                self.wake_calls += 1
                self.wake_options.append(
                    {"identity_id": identity_id, "profile": profile}
                )
                return {
                    "messages": [
                        {"role": "system", "content": "STABLE_WAKE"},
                        {"role": "system", "content": "VOLATILE_WAKE"},
                    ],
                    "_meta": {
                        "provider": provider,
                        "cache_eligible": "auto",
                        "cache_note": "test",
                    },
                }

        self.wake = _Wake()

    def request(self, method: str, path: str, body: Any = None) -> Any:
        self.requests.append((method, path, body))
        if self._request_impl is not None:
            return self._request_impl(method, path, body)
        return {"trace_id": "tr_openai_test"} if path == "/v1/traces" else {}


class _FakeOpenAI:
    def __init__(self, response: Optional[Any] = None) -> None:
        self.response = response or {
            "id": "resp_test",
            "model": "gpt-test",
            "output_text": "provider answer",
            "output": [],
            "usage": {"input_tokens": 10, "output_tokens": 4},
        }
        self.calls = 0
        self.last_params: Optional[dict[str, Any]] = None

        class _Responses:
            def create(_self, **params: Any) -> dict[str, Any]:
                self.calls += 1
                self.last_params = params
                return self.response

        self.responses = _Responses()


def test_rejects_unknown_wake_profile():
    with pytest.raises(ValueError, match="Unknown wake profile"):
        OpenAIResponsesAdapter(
            _FakeOpenAI(),
            _StubAt(),
            wake_profile="tiny",  # type: ignore[arg-type]
        )


def test_rejects_async_client_before_wake_or_provider_io():
    class _AsyncOpenAI:
        class _Responses:
            async def create(self, **params: Any) -> dict[str, Any]:
                return {"id": "never"}

        responses = _Responses()

    at = _StubAt()
    with pytest.raises(Exception, match="requires the synchronous"):
        OpenAIResponsesAdapter(_AsyncOpenAI(), at)
    assert at.wake_calls == 0


def test_rejects_client_without_responses_create():
    with pytest.raises(Exception, match=r"requires responses\.create"):
        OpenAIResponsesAdapter(object(), _StubAt())  # type: ignore[arg-type]


def test_prepends_wake_before_caller_instructions_and_preserves_fields():
    at = _StubAt()
    fake = _FakeOpenAI()
    adapter = OpenAIResponsesAdapter(fake, at)

    adapter.responses.create(
        model="gpt-test",
        instructions="CALLER_INSTRUCTIONS",
        input="hello",
        previous_response_id="resp_previous",
        tools=[{"type": "function", "name": "look"}],
    )

    assert fake.last_params is not None
    assert (
        fake.last_params["instructions"]
        == "STABLE_WAKE\n\nVOLATILE_WAKE\n\nCALLER_INSTRUCTIONS"
    )
    assert fake.last_params["previous_response_id"] == "resp_previous"
    assert fake.last_params["tools"] == [{"type": "function", "name": "look"}]


def test_wake_alone_when_caller_instructions_are_absent():
    at = _StubAt()
    fake = _FakeOpenAI()
    adapter = OpenAIResponsesAdapter(fake, at)

    adapter.responses.create(model="gpt-test", input="hello")

    assert fake.last_params is not None
    assert fake.last_params["instructions"] == "STABLE_WAKE\n\nVOLATILE_WAKE"
    assert fake.last_params["store"] is False


def test_preserves_explicit_provider_storage_choice():
    at = _StubAt()
    fake = _FakeOpenAI()
    adapter = OpenAIResponsesAdapter(fake, at)

    adapter.responses.create(model="gpt-test", input="hello", store=True)

    assert fake.last_params is not None
    assert fake.last_params["store"] is True


def test_skip_wake_preserves_instructions_and_avoids_wake_io():
    at = _StubAt()
    fake = _FakeOpenAI()
    adapter = OpenAIResponsesAdapter(fake, at)

    response = adapter.responses.create(
        model="gpt-test",
        instructions="CALLER_ONLY",
        input="hello",
        metadata={"agenttool": {"skip_wake": True}},
    )

    assert at.wake_calls == 0
    assert fake.last_params is not None
    assert fake.last_params["instructions"] == "CALLER_ONLY"
    assert response.agenttool.wake_used is False
    assert response.agenttool.cache_eligible is None


def test_forwards_explicit_brief_wake_profile():
    at = _StubAt()
    fake = _FakeOpenAI()
    adapter = OpenAIResponsesAdapter(
        fake,
        at,
        identity_id="identity-a",
        wake_profile="brief",
    )

    adapter.responses.create(model="gpt-test", input="hello")

    assert at.wake_options == [
        {"identity_id": "identity-a", "profile": "brief"}
    ]


def test_rejects_non_string_instructions_before_provider_call():
    at = _StubAt()
    fake = _FakeOpenAI()
    adapter = OpenAIResponsesAdapter(fake, at)

    with pytest.raises(Exception, match="instructions must be a string"):
        adapter.responses.create(
            model="gpt-test",
            input="hello",
            instructions=[{"type": "text", "text": "invalid here"}],
        )

    assert at.wake_calls == 0
    assert fake.calls == 0


def test_strips_agenttool_metadata_and_preserves_ordinary_metadata():
    at = _StubAt()
    fake = _FakeOpenAI()
    adapter = OpenAIResponsesAdapter(fake, at)

    adapter.responses.create(
        model="gpt-test",
        input="hello",
        metadata={
            "agenttool": {"trace": False},
            "tenant": "public-demo",
        },
    )

    assert fake.last_params is not None
    assert fake.last_params["metadata"] == {"tenant": "public-demo"}


def test_removes_metadata_when_only_adapter_controls_remain():
    at = _StubAt()
    fake = _FakeOpenAI()
    adapter = OpenAIResponsesAdapter(fake, at)

    adapter.responses.create(
        model="gpt-test",
        input="hello",
        metadata={"agenttool": {"trace": False}},
    )

    assert fake.last_params is not None
    assert "metadata" not in fake.last_params


@pytest.mark.parametrize("bad_value", ["decision", None, [], 42])
def test_rejects_malformed_agenttool_metadata_before_io(bad_value):
    at = _StubAt()
    fake = _FakeOpenAI()
    adapter = OpenAIResponsesAdapter(fake, at)

    with pytest.raises(Exception, match="metadata.agenttool must be an object"):
        adapter.responses.create(
            model="gpt-test",
            input="hello",
            metadata={"agenttool": bad_value},
        )

    assert at.wake_calls == 0
    assert fake.calls == 0


@pytest.mark.parametrize(
    "controls",
    [
        {"trace": True},
        {"skip_wake": "false"},
        {"parent_trace_id": 42},
        {"decision_type": False},
        {"agent_id": []},
        {"trace": "decision", "tags": 42},
        {"tags": ["valid", 7]},
        {"parent_trace_id": ""},
        {"parent_trace_id": "trace_parent"},
        {"decision_type": ""},
        {"decision_type": "x" * 65},
        {"decision_type": "😀" * 33},
        {"agent_id": "x" * 256},
        {"agent_id": "😀" * 128},
        {"tags": ["tag"] * 33},
        {"tags": ["x" * 65]},
    ],
)
def test_validates_every_adapter_control_before_provider_io(controls):
    at = _StubAt()
    fake = _FakeOpenAI()
    adapter = OpenAIResponsesAdapter(fake, at)

    with pytest.raises(Exception, match=r"metadata\.agenttool\..* is invalid"):
        adapter.responses.create(
            model="gpt-test",
            input="hello",
            metadata={"agenttool": controls},
        )

    assert at.wake_calls == 0
    assert fake.calls == 0


def test_validates_merged_ambient_and_explicit_tags_before_provider_io():
    at = _StubAt()
    fake = _FakeOpenAI()
    adapter = OpenAIResponsesAdapter(fake, at)
    token = set_ambient(
        AmbientContext(
            parent_trace_id="tr_a11b1e",
            tags=[f"ambient-{index}" for index in range(32)],
        )
    )
    try:
        with pytest.raises(Exception, match="too many tags"):
            adapter.responses.create(
                model="gpt-test",
                input="hello",
                metadata={"agenttool": {"tags": ["explicit"]}},
            )
    finally:
        reset_ambient(token)

    assert at.wake_calls == 0
    assert fake.calls == 0


def test_refuses_streaming_before_wake_or_provider_io():
    at = _StubAt()
    fake = _FakeOpenAI()
    adapter = OpenAIResponsesAdapter(fake, at)

    with pytest.raises(Exception, match="does not wrap streaming"):
        adapter.responses.create(
            model="gpt-test",
            input="hello",
            stream=True,
        )

    assert at.wake_calls == 0
    assert fake.calls == 0


def test_refuses_background_before_wake_or_provider_io():
    at = _StubAt()
    fake = _FakeOpenAI()
    adapter = OpenAIResponsesAdapter(fake, at)

    with pytest.raises(Exception, match="does not wrap background"):
        adapter.responses.create(
            model="gpt-test",
            input="hello",
            background=True,
        )

    assert at.wake_calls == 0
    assert fake.calls == 0


def test_records_explicit_trace_from_input_and_output_text():
    at = _StubAt()
    fake = _FakeOpenAI()
    adapter = OpenAIResponsesAdapter(fake, at)

    response = adapter.responses.create(
        model="gpt-test",
        input="Which path?",
        metadata={
            "agenttool": {
                "trace": "decision",
                "decision_type": "architecture",
                "parent_trace_id": "tr_deadbeef",
                "tags": ["openai", "responses"],
                "agent_id": "agent-a",
            }
        },
    )

    assert len(at.requests) == 1
    body = at.requests[0][2]
    assert body["decision"] == {
        "type": "architecture",
        "summary": "provider answer",
    }
    assert body["reasoning"]["observations"] == ["Which path?"]
    assert body["reasoning"]["conclusion"] == "provider answer"
    assert body["parent_trace_id"] == "tr_deadbeef"
    assert body["tags"] == ["openai", "responses"]
    assert body["agent_id"] == "agent-a"
    assert response.agenttool.trace_id == "tr_openai_test"
    assert response.agenttool.wake_used is True
    assert response.agenttool.cache_eligible == "auto"
    assert response.id == "resp_test"
    assert response["output_text"] == "provider answer"


def test_preserves_extensible_sdk_response_type_and_mapping_behavior():
    class _SDKResponseLike:
        def __init__(self) -> None:
            self.id = "resp_sdk"
            self.model = "gpt-test"
            self.status = "completed"
            self.output_text = "answer"
            self.output: list[Any] = []

        def __iter__(self):
            return iter({"id": self.id, "model": self.model}.items())

        def model_dump(self) -> dict[str, Any]:
            return {"id": self.id, "model": self.model}

    raw = _SDKResponseLike()
    adapter = OpenAIResponsesAdapter(_FakeOpenAI(raw), _StubAt())

    response = adapter.responses.create(
        model="gpt-test",
        input="hello",
        metadata={"agenttool": {"skip_wake": True}},
    )

    assert response is raw
    assert isinstance(response, _SDKResponseLike)
    assert dict(response) == {"id": "resp_sdk", "model": "gpt-test"}
    assert response.model_dump()["id"] == "resp_sdk"
    assert response.agenttool.wake_used is False


def test_truncates_trace_excerpts_on_whole_utf16_characters():
    at = _StubAt()
    conclusion = ("a" * 199) + "😀" + ("b" * 3800)
    user_input = ("u" * 999) + "😀tail"
    fake = _FakeOpenAI(
        {
            "id": "resp_unicode",
            "output_text": conclusion,
            "output": [],
        }
    )
    adapter = OpenAIResponsesAdapter(fake, at)

    adapter.responses.create(
        model="gpt-test",
        input=user_input,
        metadata={"agenttool": {"trace": "decision", "skip_wake": True}},
    )

    body = at.requests[0][2]
    assert body["decision"]["summary"] == "a" * 199
    assert body["reasoning"]["observations"] == ["u" * 999]
    assert body["reasoning"]["conclusion"] == (
        ("a" * 199) + "😀" + ("b" * 3799)
    )
    assert len(body["reasoning"]["conclusion"].encode("utf-16-le")) // 2 == 4000


def test_reads_wire_output_items_and_latest_user_input_blocks():
    at = _StubAt()
    fake = _FakeOpenAI(
        {
            "id": "resp_wire",
            "output": [
                {
                    "type": "message",
                    "content": [
                        {"type": "output_text", "text": "first"},
                        {"type": "refusal", "refusal": "unused"},
                        {"type": "output_text", "text": "second"},
                    ],
                }
            ],
        }
    )
    adapter = OpenAIResponsesAdapter(fake, at)

    adapter.responses.create(
        model="gpt-test",
        input=[
            {"role": "user", "content": "older"},
            {"role": "assistant", "content": "middle"},
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": "latest A"},
                    {
                        "type": "input_image",
                        "image_url": "https://example.test/a.png",
                    },
                    {"type": "input_text", "text": "latest B"},
                ],
            },
        ],
        metadata={"agenttool": {"trace": "decision"}},
    )

    body = at.requests[0][2]
    assert body["decision"]["summary"] == "first\nsecond"
    assert body["reasoning"]["observations"] == ["latest A\nlatest B"]


def test_records_pure_provider_refusal_without_calling_it_empty():
    at = _StubAt()
    fake = _FakeOpenAI(
        {
            "id": "resp_refusal",
            "status": "completed",
            "output_text": "",
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "refusal",
                            "refusal": "I cannot perform that action.",
                        }
                    ],
                }
            ],
        }
    )
    adapter = OpenAIResponsesAdapter(fake, at)

    adapter.responses.create(
        model="gpt-test",
        input="do the action",
        metadata={"agenttool": {"trace": "decision"}},
    )

    body = at.requests[0][2]
    assert body["decision"]["summary"] == (
        "Refusal: I cannot perform that action."
    )
    assert body["reasoning"]["conclusion"] == (
        "Refusal: I cannot perform that action."
    )


@pytest.mark.parametrize(
    "status",
    ["failed", "incomplete", "in_progress", "queued", "cancelled"],
)
def test_does_not_trace_non_completed_responses(status):
    at = _StubAt()
    fake = _FakeOpenAI(
        {
            "id": f"resp_{status}",
            "status": status,
            "output_text": "not a completed decision",
        }
    )
    adapter = OpenAIResponsesAdapter(fake, at)

    response = adapter.responses.create(
        model="gpt-test",
        input="hello",
        metadata={"agenttool": {"trace": "decision"}},
    )

    assert at.requests == []
    assert response.agenttool.trace_id is None
    assert response.status == status


def test_ambient_deciding_context_triggers_and_parents_trace():
    at = _StubAt()
    fake = _FakeOpenAI()
    adapter = OpenAIResponsesAdapter(fake, at)
    token = set_ambient(
        AmbientContext(
            parent_trace_id="tr_a11b1e",
            tags=["ambient"],
        )
    )
    try:
        response = adapter.responses.create(
            model="gpt-test",
            input="hello",
            metadata={"agenttool": {"tags": ["explicit", "ambient"]}},
        )
    finally:
        reset_ambient(token)

    body = at.requests[0][2]
    assert body["parent_trace_id"] == "tr_a11b1e"
    assert body["tags"] == ["explicit", "ambient"]
    assert response.agenttool.trace_id == "tr_openai_test"


def test_trace_failure_keeps_completed_provider_response(capsys):
    def fail_trace(method: str, path: str, body: Any) -> Any:
        raise RuntimeError("trace store unavailable")

    at = _StubAt(request_impl=fail_trace)
    fake = _FakeOpenAI()
    adapter = OpenAIResponsesAdapter(fake, at)

    response = adapter.responses.create(
        model="gpt-test",
        input="hello",
        metadata={"agenttool": {"trace": "decision"}},
    )

    assert response.id == "resp_test"
    assert response.output_text == "provider answer"
    assert response.agenttool.trace_id is None
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "auto-trace failed: trace store unavailable" in captured.err
