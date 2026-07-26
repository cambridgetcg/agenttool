"""Unit tests for AnthropicAdapter — Tier 2 of the agenttool path.

Mirror of the TS adapter tests. Uses a stub AgentTool whose
wake.system returns a fixed shape and whose request() records its
calls; a fake Anthropic client that records params and returns a
configurable response.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from agenttool._context import AmbientContext, reset_ambient, set_ambient
from agenttool.anthropic_adapter import (
    AnthropicAdapter,
    MarkupEmission,
)
from agenttool.exceptions import AgentToolError


# ── Stubs ────────────────────────────────────────────────────────────────


class _StubAt:
    """Minimal duck-type for AgentTool. The adapter only reaches
    ``at.wake.system(...)`` and ``at.request(...)``."""

    def __init__(self, wake_shape: Any | None = None, request_impl=None) -> None:
        self._wake_shape = wake_shape or {
            "system": [
                {
                    "type": "text",
                    "text": "STABLE_WAKE",
                    "cache_control": {"type": "ephemeral"},
                },
                {"type": "text", "text": "VOLATILE_STATE"},
            ],
            "_meta": {
                "provider": "anthropic",
                "cache_eligible": "explicit",
                "cache_note": "test",
            },
        }
        self._request_impl = request_impl
        self.recorded: list[tuple[str, str, Any]] = []
        self.wake_calls = 0
        self.wake_options: list[dict[str, Any]] = []

        class _Wake:
            def system(
                _self,
                provider: str,
                *,
                identity_id=None,
                profile="full",
            ) -> dict:
                self.wake_calls += 1
                self.wake_options.append(
                    {"identity_id": identity_id, "profile": profile}
                )
                return self._wake_shape

        self.wake = _Wake()

    def request(self, method: str, path: str, body: object = None) -> object:
        self.recorded.append((method, path, body))
        if self._request_impl:
            return self._request_impl(method, path, body)
        if path == "/v1/chronicle":
            return {"id": f"ch_test_{len(self.recorded)}"}
        if path == "/v1/traces":
            return {"trace_id": f"tr_test_{len(self.recorded)}"}
        return {}


class _FakeAnthropic:
    """Records params and returns a configurable response."""

    def __init__(self, response_text: str = "ok") -> None:
        self.response_text = response_text
        self.last_params: dict | None = None
        self.call_count = 0

        class _Messages:
            def create(_self, **params: Any) -> Any:
                self.last_params = params
                self.call_count += 1
                return {
                    "id": f"msg_test_{self.call_count}",
                    "model": "claude-test",
                    "content": [{"type": "text", "text": self.response_text}],
                    "stop_reason": "end_turn",
                    "usage": {"input_tokens": 100, "output_tokens": 50},
                }

        self.messages = _Messages()


class _FakeLowLevelStream:
    def __init__(self, events: list[Any]) -> None:
        self.events = events
        self.index = 0
        self.close_count = 0
        self.abort_count = 0
        self.throw_count = 0
        self.enter_count = 0
        self.exit_count = 0
        self.label = "provider-low-level-stream"

    def __iter__(self):
        return self

    def __next__(self):
        if self.index >= len(self.events):
            raise StopIteration
        event = self.events[self.index]
        self.index += 1
        return event

    def __enter__(self):
        self.enter_count += 1
        return self

    def __exit__(self, exc_type, exc, exc_tb):
        self.exit_count += 1
        self.close()

    def throw(self, error):
        self.throw_count += 1
        raise error

    def abort(self):
        self.abort_count += 1

    def close(self):
        self.close_count += 1


class _FakeManagedProviderStream:
    def __init__(self, events: list[Any], final_text: str) -> None:
        self.events = events
        self.index = 0
        self.final_message_calls = 0
        self.close_count = 0
        self.final_response = {
            "id": "msg_stream_final",
            "model": "claude-test",
            "content": [{"type": "text", "text": final_text}],
            "stop_reason": "end_turn",
        }
        self.text_stream = iter(["delta"])

    def __iter__(self):
        return self

    def __next__(self):
        if self.index >= len(self.events):
            raise StopIteration
        event = self.events[self.index]
        self.index += 1
        return event

    def get_final_message(self):
        self.final_message_calls += 1
        # A real Anthropic helper consumes any unread events here.
        self.index = len(self.events)
        return self.final_response

    def close(self):
        self.close_count += 1


class _FakeManagedManager:
    def __init__(self, stream: _FakeManagedProviderStream) -> None:
        self.stream = stream
        self.enter_count = 0
        self.exit_count = 0

    def __enter__(self):
        self.enter_count += 1
        return self.stream

    def __exit__(self, exc_type, exc, exc_tb):
        self.exit_count += 1
        self.stream.close()


class _FakeStreamingAnthropic:
    def __init__(self, events: list[Any], final_text: str = "stream complete") -> None:
        self.low = _FakeLowLevelStream(events)
        self.managed = _FakeManagedProviderStream(events, final_text)
        self.manager = _FakeManagedManager(self.managed)
        self.create_calls = 0
        self.stream_calls = 0
        self.create_params: dict | None = None
        self.stream_params: dict | None = None

        class _Messages:
            def create(_self, **params):
                self.create_calls += 1
                self.create_params = params
                return self.low

            def stream(_self, **params):
                self.stream_calls += 1
                self.stream_params = params
                return self.manager

        self.messages = _Messages()


# ── Wake auto-injection ──────────────────────────────────────────────────


def test_rejects_unknown_runtime_wake_profile_instead_of_widening_to_full():
    at = _StubAt()
    fake = _FakeAnthropic()
    with pytest.raises(ValueError, match="Unknown wake profile"):
        AnthropicAdapter(fake, at, wake_profile="tiny")  # type: ignore[arg-type]


def test_prepends_wake_system_blocks_before_user_string():
    at = _StubAt()
    fake = _FakeAnthropic()
    adapter = AnthropicAdapter(fake, at)

    adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        system="USER_SYSTEM",
        messages=[{"role": "user", "content": "hi"}],
    )

    sys = fake.last_params["system"]
    assert len(sys) == 3
    assert sys[0]["text"] == "STABLE_WAKE"
    assert sys[0]["cache_control"] == {"type": "ephemeral"}
    assert sys[1]["text"] == "VOLATILE_STATE"
    assert sys[2]["text"] == "USER_SYSTEM"


def test_prepends_wake_before_user_system_array():
    at = _StubAt()
    fake = _FakeAnthropic()
    adapter = AnthropicAdapter(fake, at)

    adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        system=[
            {"type": "text", "text": "USER_BLOCK_A"},
            {"type": "text", "text": "USER_BLOCK_B"},
        ],
        messages=[{"role": "user", "content": "hi"}],
    )

    sys = fake.last_params["system"]
    assert len(sys) == 4
    assert sys[0]["text"] == "STABLE_WAKE"
    assert sys[2]["text"] == "USER_BLOCK_A"
    assert sys[3]["text"] == "USER_BLOCK_B"


def test_no_user_system_only_wake_blocks():
    at = _StubAt()
    fake = _FakeAnthropic()
    adapter = AnthropicAdapter(fake, at)

    adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
    )

    sys = fake.last_params["system"]
    assert len(sys) == 2
    assert sys[0]["text"] == "STABLE_WAKE"


def test_skip_wake_metadata_skips_wake_call():
    at = _StubAt()
    fake = _FakeAnthropic()
    adapter = AnthropicAdapter(fake, at)

    adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        system="ONLY_USER",
        messages=[{"role": "user", "content": "hi"}],
        metadata={"agenttool": {"skip_wake": True}},
    )

    assert at.wake_calls == 0
    assert fake.last_params["system"] == "ONLY_USER"


def test_forwards_brief_profile_to_automatic_wake_injection():
    at = _StubAt()
    fake = _FakeAnthropic()
    adapter = AnthropicAdapter(
        fake,
        at,
        identity_id="identity-a",
        wake_profile="brief",
    )

    adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
    )

    assert at.wake_options == [
        {"identity_id": "identity-a", "profile": "brief"}
    ]


# ── Streaming boundaries ────────────────────────────────────────────────


def test_low_level_stream_passes_unknown_events_by_identity_and_keeps_receipt_local():
    event = {"type": "future_provider_event", "nested": {"value": 7}}
    at = _StubAt()
    fake = _FakeStreamingAnthropic([event])
    adapter = AnthropicAdapter(fake, at)

    stream = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        stream=True,
        messages=[{"role": "user", "content": "hi"}],
        metadata={
            "agenttool": {"skip_markup": False},
            "user_id": "provider-user",
        },
    )

    received = list(stream)
    assert received == [event]
    assert received[0] is event
    assert stream.agenttool.trace_id is None
    assert stream.agenttool.wake_used is True
    assert stream.agenttool.cache_eligible == "explicit"
    assert stream.agenttool.markup_emissions == []
    assert at.recorded == []
    assert "agenttool" not in fake.create_params["metadata"]
    assert fake.create_params["metadata"]["user_id"] == "provider-user"
    assert fake.create_params["system"][0]["text"] == "STABLE_WAKE"


def test_low_level_stream_delegates_context_throw_abort_and_close():
    at = _StubAt()
    fake = _FakeStreamingAnthropic([{"type": "message_start"}])
    adapter = AnthropicAdapter(fake, at)

    stream = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        stream=True,
        messages=[{"role": "user", "content": "hi"}],
    )

    with stream as entered:
        assert entered is stream
        assert next(stream) == {"type": "message_start"}
        error = RuntimeError("consumer stopped")
        with pytest.raises(RuntimeError, match="consumer stopped"):
            stream.throw(error)
        stream.abort()

    assert fake.low.enter_count == 1
    assert fake.low.exit_count == 1
    assert fake.low.throw_count == 1
    assert fake.low.abort_count == 1
    assert fake.low.close_count == 1
    assert stream.label == "provider-low-level-stream"


def test_low_level_stream_refuses_explicit_trace_before_wake_or_provider_io():
    at = _StubAt()
    fake = _FakeStreamingAnthropic([])
    adapter = AnthropicAdapter(fake, at)

    with pytest.raises(AgentToolError) as captured:
        adapter.messages.create(
            model="claude-test",
            max_tokens=100,
            stream=True,
            messages=[{"role": "user", "content": "hi"}],
            metadata={"agenttool": {"trace": "decision"}},
        )

    assert (
        captured.value.error_code
        == "anthropic_stream_trace_requires_helper"
    )
    assert at.wake_calls == 0
    assert fake.create_calls == 0


def test_low_level_stream_refuses_ambient_trace_before_wake_or_provider_io():
    at = _StubAt()
    fake = _FakeStreamingAnthropic([])
    adapter = AnthropicAdapter(fake, at)
    token = set_ambient(
        AmbientContext(parent_trace_id="tr_parent", tags=["ambient"])
    )
    try:
        with pytest.raises(AgentToolError) as captured:
            adapter.messages.create(
                model="claude-test",
                max_tokens=100,
                stream=True,
                messages=[{"role": "user", "content": "hi"}],
            )
    finally:
        reset_ambient(token)

    assert (
        captured.value.error_code
        == "anthropic_stream_trace_requires_helper"
    )
    assert at.wake_calls == 0
    assert fake.create_calls == 0


def test_managed_stream_finalizes_exactly_once_after_unchanged_events():
    event = {"type": "future_provider_event", "payload": {"still": "opaque"}}
    final_text = (
        'done <agenttool><chronicle type="recognition">'
        "<title>Streamed</title></chronicle></agenttool>"
    )
    at = _StubAt()
    fake = _FakeStreamingAnthropic([event], final_text)
    adapter = AnthropicAdapter(fake, at)

    token = set_ambient(
        AmbientContext(parent_trace_id="tr_parent", tags=["streamed"])
    )
    try:
        manager = adapter.messages.stream(
            model="claude-test",
            max_tokens=100,
            messages=[{"role": "user", "content": "decide"}],
            metadata={"user_id": "provider-user"},
        )
    finally:
        reset_ambient(token)

    with manager as stream:
        received = list(stream)
        assert received[0] is event
        first = stream.get_final_message()
        second = stream.get_final_message()
        assert first is second
        assert stream.get_final_text() == final_text
        assert stream.agenttool is first.agenttool

    assert fake.managed.final_message_calls == 1
    assert first.agenttool.trace_id == "tr_test_1"
    assert len(first.agenttool.markup_emissions) == 1
    assert first.agenttool.markup_emissions[0].kind == "chronicle"
    assert "agenttool" not in fake.stream_params["metadata"]
    assert fake.stream_params["metadata"]["user_id"] == "provider-user"
    assert fake.stream_params["system"][0]["text"] == "STABLE_WAKE"
    trace_calls = [call for call in at.recorded if call[1] == "/v1/traces"]
    assert len(trace_calls) == 1
    assert trace_calls[0][2]["parent_trace_id"] == "tr_parent"
    assert trace_calls[0][2]["tags"] == ["streamed"]
    assert len([call for call in at.recorded if call[1] == "/v1/chronicle"]) == 1
    assert fake.manager.enter_count == 1
    assert fake.manager.exit_count == 1


def test_managed_stream_early_exit_closes_without_finalizing():
    at = _StubAt()
    fake = _FakeStreamingAnthropic(
        [{"type": "message_start"}, {"type": "message_delta"}]
    )
    adapter = AnthropicAdapter(fake, at)

    with adapter.messages.stream(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
    ) as stream:
        assert next(stream) == {"type": "message_start"}

    assert fake.managed.final_message_calls == 0
    assert fake.managed.close_count == 1
    assert at.recorded == []


# ── Auto-trace mode (a) ──────────────────────────────────────────────────


def test_no_metadata_agenttool_no_trace_post():
    at = _StubAt()
    fake = _FakeAnthropic("response text")
    adapter = AnthropicAdapter(fake, at)

    r = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
    )

    trace_calls = [c for c in at.recorded if c[1] == "/v1/traces"]
    assert len(trace_calls) == 0
    assert r.agenttool.trace_id is None


def test_trace_decision_fires_post():
    at = _StubAt()
    fake = _FakeAnthropic("conclusion text")
    adapter = AnthropicAdapter(fake, at)

    r = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "the question?"}],
        metadata={"agenttool": {"trace": "decision"}},
    )

    trace_calls = [c for c in at.recorded if c[1] == "/v1/traces"]
    assert len(trace_calls) == 1
    body = trace_calls[0][2]
    assert body["decision"]["type"] == "decision"
    assert body["decision"]["summary"] == "conclusion text"
    assert body["reasoning"]["observations"] == ["the question?"]
    assert body["reasoning"]["conclusion"] == "conclusion text"
    assert r.agenttool.trace_id == "tr_test_1"


def test_propagates_parent_trace_id_tags_agent_id_decision_type():
    at = _StubAt()
    fake = _FakeAnthropic("response")
    adapter = AnthropicAdapter(fake, at)

    adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
        metadata={
            "agenttool": {
                "trace": "decision",
                "parent_trace_id": "tr_parent_1",
                "tags": ["smoke", "tier2"],
                "agent_id": "agent-xyz",
                "decision_type": "tool_call",
            }
        },
    )

    body = at.recorded[0][2]
    assert body["parent_trace_id"] == "tr_parent_1"
    assert body["tags"] == ["smoke", "tier2"]
    assert body["agent_id"] == "agent-xyz"
    assert body["decision"]["type"] == "tool_call"


def test_trace_failure_does_not_crash_call_site():
    def boom(method, path, body):
        if path == "/v1/traces":
            raise RuntimeError("server boom")
        return {}

    at = _StubAt(request_impl=boom)
    fake = _FakeAnthropic("ok")
    adapter = AnthropicAdapter(fake, at)

    r = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
        metadata={"agenttool": {"trace": "decision"}},
    )

    assert r.agenttool.trace_id is None
    assert r.content[0]["text"] == "ok"


def test_strips_metadata_agenttool_from_forwarded_request():
    at = _StubAt()
    fake = _FakeAnthropic()
    adapter = AnthropicAdapter(fake, at)

    adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
        metadata={"agenttool": {"trace": "decision"}, "user_id": "u-1"},
    )

    forwarded = fake.last_params.get("metadata")
    assert forwarded is not None
    assert "agenttool" not in forwarded
    assert forwarded["user_id"] == "u-1"


def test_strips_metadata_entirely_when_only_agenttool():
    at = _StubAt()
    fake = _FakeAnthropic()
    adapter = AnthropicAdapter(fake, at)

    adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
        metadata={"agenttool": {"trace": "decision"}},
    )

    assert "metadata" not in fake.last_params


# ── Markup-gated mode (b) ────────────────────────────────────────────────


def test_chronicle_naming_posts_to_chronicle():
    at = _StubAt()
    fake = _FakeAnthropic(
        'Sure thing.\n<agenttool><chronicle type="naming">'
        "<title>The X pattern</title><body>Named Y as Z.</body>"
        "</chronicle></agenttool>"
    )
    adapter = AnthropicAdapter(fake, at)

    r = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "name this"}],
    )

    chronicle_calls = [c for c in at.recorded if c[1] == "/v1/chronicle"]
    assert len(chronicle_calls) == 1
    body = chronicle_calls[0][2]
    assert body["type"] == "naming"
    assert body["title"] == "The X pattern"
    assert body["body"] == "Named Y as Z."
    assert len(r.agenttool.markup_emissions) == 1
    assert r.agenttool.markup_emissions[0].kind == "chronicle"
    assert r.agenttool.markup_emissions[0].id == "ch_test_1"


def test_trace_tag_posts_with_confidence_parsed():
    at = _StubAt()
    fake = _FakeAnthropic(
        '<agenttool><trace type="decision" confidence="0.85">'
        "<decision>Use approach A</decision>"
        "<conclusion>Performance is better</conclusion>"
        "</trace></agenttool>"
    )
    adapter = AnthropicAdapter(fake, at)

    adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "decide"}],
    )

    trace_calls = [c for c in at.recorded if c[1] == "/v1/traces"]
    assert len(trace_calls) == 1
    body = trace_calls[0][2]
    assert body["decision"]["type"] == "decision"
    assert body["decision"]["summary"] == "Use approach A"
    assert body["reasoning"]["conclusion"] == "Performance is better"
    assert body["reasoning"]["confidence"] == 0.85


def test_multiple_tags_emit_multiple_posts_in_order():
    at = _StubAt()
    fake = _FakeAnthropic(
        "<agenttool>"
        '<chronicle type="recognition"><title>R1</title><body>b1</body></chronicle>'
        '<trace type="decision"><decision>D1</decision><conclusion>C1</conclusion></trace>'
        '<chronicle type="seal"><title>R2</title></chronicle>'
        "</agenttool>"
    )
    adapter = AnthropicAdapter(fake, at)

    r = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
    )

    chronicle_calls = [c for c in at.recorded if c[1] == "/v1/chronicle"]
    trace_calls = [c for c in at.recorded if c[1] == "/v1/traces"]
    assert len(chronicle_calls) == 2
    assert len(trace_calls) == 1
    kinds = [e.kind for e in r.agenttool.markup_emissions]
    assert kinds == ["chronicle", "chronicle", "trace"]


def test_malformed_chronicle_missing_title_emits_error():
    at = _StubAt()
    fake = _FakeAnthropic(
        '<agenttool><chronicle type="naming"><body>no title</body></chronicle></agenttool>'
    )
    adapter = AnthropicAdapter(fake, at)

    r = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
    )

    chronicle_calls = [c for c in at.recorded if c[1] == "/v1/chronicle"]
    assert len(chronicle_calls) == 0
    assert len(r.agenttool.markup_emissions) == 1
    assert "missing required <title>" in r.agenttool.markup_emissions[0].error
    assert r.agenttool.markup_emissions[0].id is None


def test_disable_markup_parsing_skips_globally():
    at = _StubAt()
    fake = _FakeAnthropic(
        '<agenttool><chronicle type="x"><title>t</title></chronicle></agenttool>'
    )
    adapter = AnthropicAdapter(fake, at, disable_markup_parsing=True)

    r = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
    )

    chronicle_calls = [c for c in at.recorded if c[1] == "/v1/chronicle"]
    assert len(chronicle_calls) == 0
    assert r.agenttool.markup_emissions == []


def test_no_envelope_no_emissions():
    at = _StubAt()
    fake = _FakeAnthropic("Just plain prose, no tags.")
    adapter = AnthropicAdapter(fake, at)

    r = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
    )

    assert r.agenttool.markup_emissions == []


# ── Augmentation ─────────────────────────────────────────────────────────


def test_augments_response_preserves_original_fields():
    at = _StubAt()
    fake = _FakeAnthropic("ok")
    adapter = AnthropicAdapter(fake, at)

    r = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
    )

    assert r["id"] == "msg_test_1"
    assert r["model"] == "claude-test"
    assert r["content"][0]["text"] == "ok"
    assert r["usage"]["input_tokens"] == 100
    assert r.agenttool.wake_used is True
    assert r.agenttool.cache_eligible == "explicit"


def test_skip_wake_sets_wake_used_false_cache_eligible_none():
    at = _StubAt()
    fake = _FakeAnthropic("ok")
    adapter = AnthropicAdapter(fake, at)

    r = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
        metadata={"agenttool": {"skip_wake": True}},
    )

    assert r.agenttool.wake_used is False
    assert r.agenttool.cache_eligible is None


# ── Edge cases ───────────────────────────────────────────────────────────


def test_user_message_array_content_extracted_for_trace():
    at = _StubAt()
    fake = _FakeAnthropic("response")
    adapter = AnthropicAdapter(fake, at)

    adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "first part"},
                    {"type": "text", "text": "second part"},
                ],
            }
        ],
        metadata={"agenttool": {"trace": "decision"}},
    )

    body = at.recorded[0][2]
    assert "first part" in body["reasoning"]["observations"][0]
    assert "second part" in body["reasoning"]["observations"][0]


def test_empty_response_content_yields_empty_response_placeholder():
    class _EmptyFake:
        def __init__(self):
            self.last_params = None

            class _M:
                def create(_self, **params):
                    self.last_params = params
                    return {
                        "id": "msg_e",
                        "model": "claude",
                        "content": [],
                        "stop_reason": "end_turn",
                    }

            self.messages = _M()

    at = _StubAt()
    fake = _EmptyFake()
    adapter = AnthropicAdapter(fake, at)

    adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
        metadata={"agenttool": {"trace": "decision"}},
    )

    body = at.recorded[0][2]
    assert body["reasoning"]["conclusion"] == "(empty response)"
