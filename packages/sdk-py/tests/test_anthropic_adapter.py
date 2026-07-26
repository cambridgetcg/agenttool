"""Unit tests for AnthropicAdapter — Tier 2 of the agenttool path.

Mirror of the TS adapter tests. Uses a stub AgentTool whose
wake.system returns a fixed shape and whose request() records its
calls; a fake Anthropic client that records params and returns a
configurable response.
"""

from __future__ import annotations

import threading
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any

import pytest

from agenttool._context import AmbientContext, reset_ambient, set_ambient
from agenttool.anthropic_adapter import AnthropicAdapter
from agenttool.exceptions import AgentToolError

# ── Stubs ────────────────────────────────────────────────────────────────


def _capture_error(call, errors: list[BaseException]) -> None:
    try:
        call()
    except BaseException as error:
        errors.append(error)


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

    assert at.wake_options == [{"identity_id": "identity-a", "profile": "brief"}]


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


def test_low_level_invalid_provider_stream_is_cleaned_before_rejection():
    class _InvalidStream:
        def __init__(self) -> None:
            self.close_count = 0
            self.abort_count = 0

        def close(self):
            self.close_count += 1

        def abort(self):
            self.abort_count += 1

    invalid = _InvalidStream()

    class _Client:
        class _Messages:
            def create(self, **params):
                return invalid

        messages = _Messages()

    adapter = AnthropicAdapter(_Client(), _StubAt())
    with pytest.raises(AgentToolError) as captured:
        adapter.messages.create(
            model="claude-test",
            max_tokens=100,
            stream=True,
            messages=[{"role": "user", "content": "hi"}],
        )

    assert captured.value.error_code == "anthropic_stream_invalid"
    assert invalid.close_count == 1
    assert invalid.abort_count == 0


def test_low_level_stream_shape_lookup_error_cleans_up_and_preserves_error():
    lookup_error = RuntimeError("stream shape lookup failed")

    class _HostileStreamShape:
        def __init__(self) -> None:
            self.close_count = 0

        def __getattribute__(self, name):
            if name == "__iter__":
                raise lookup_error
            return object.__getattribute__(self, name)

        def close(self):
            self.close_count += 1

    provider = _HostileStreamShape()

    class _Client:
        class _Messages:
            def create(self, **params):
                return provider

        messages = _Messages()

    adapter = AnthropicAdapter(_Client(), _StubAt())
    with pytest.raises(RuntimeError) as captured:
        adapter.messages.create(
            stream=True,
            messages=[{"role": "user", "content": "hi"}],
        )

    assert captured.value is lookup_error
    assert provider.close_count == 1


def test_low_level_read_only_mapping_is_not_mistaken_for_an_event_stream():
    response = MappingProxyType({"type": "message"})

    class _Client:
        class _Messages:
            def create(self, **params):
                return response

        messages = _Messages()

    adapter = AnthropicAdapter(_Client(), _StubAt())
    with pytest.raises(AgentToolError) as captured:
        adapter.messages.create(
            stream=True,
            messages=[{"role": "user", "content": "hi"}],
        )

    assert captured.value.error_code == "anthropic_stream_invalid"


def test_low_level_iterator_construction_error_closes_and_preserves_error():
    iterator_error = RuntimeError("iterator construction failed")

    class _BrokenIteratorStream:
        def __init__(self) -> None:
            self.close_count = 0

        def __iter__(self):
            raise iterator_error

        def close(self):
            self.close_count += 1

    provider = _BrokenIteratorStream()

    class _Client:
        class _Messages:
            def create(self, **params):
                return provider

        messages = _Messages()

    adapter = AnthropicAdapter(_Client(), _StubAt())
    with pytest.raises(RuntimeError) as captured:
        adapter.messages.create(
            stream=True,
            messages=[{"role": "user", "content": "hi"}],
        )

    assert captured.value is iterator_error
    assert provider.close_count == 1


def test_low_level_context_enter_iterator_error_exits_once_and_preserves_error():
    iterator_error = RuntimeError("entered value is not iterable")
    exit_error = RuntimeError("provider exit also failed")

    class _BrokenEnteredStream:
        def __init__(self) -> None:
            self.entered = False
            self.exit_count = 0
            self.exit_exception = None

        def __iter__(self):
            if self.entered:
                raise iterator_error
            return self

        def __next__(self):
            raise StopIteration

        def __enter__(self):
            self.entered = True
            return self

        def __exit__(self, exc_type, exc, exc_tb):
            self.exit_count += 1
            self.exit_exception = exc
            raise exit_error

    provider = _BrokenEnteredStream()

    class _Client:
        class _Messages:
            def create(self, **params):
                return provider

        messages = _Messages()

    adapter = AnthropicAdapter(_Client(), _StubAt())
    stream = adapter.messages.create(
        stream=True,
        messages=[{"role": "user", "content": "hi"}],
    )

    with pytest.raises(RuntimeError) as captured:
        with stream:
            raise AssertionError("unreachable")

    assert captured.value is iterator_error
    assert provider.exit_count == 1
    assert provider.exit_exception is iterator_error


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

    assert captured.value.error_code == "anthropic_stream_trace_requires_helper"
    assert at.wake_calls == 0
    assert fake.create_calls == 0


def test_low_level_stream_refuses_ambient_trace_before_wake_or_provider_io():
    at = _StubAt()
    fake = _FakeStreamingAnthropic([])
    adapter = AnthropicAdapter(fake, at)
    token = set_ambient(AmbientContext(parent_trace_id="tr_parent", tags=["ambient"]))
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

    assert captured.value.error_code == "anthropic_stream_trace_requires_helper"
    assert at.wake_calls == 0
    assert fake.create_calls == 0


def test_low_level_stream_refuses_trace_from_read_only_mappings_before_io():
    at = _StubAt()
    fake = _FakeStreamingAnthropic([])
    adapter = AnthropicAdapter(fake, at)

    metadata = MappingProxyType(
        {
            "agenttool": MappingProxyType({"trace": "decision"}),
            "user_id": "provider-user",
        }
    )
    with pytest.raises(AgentToolError) as captured:
        adapter.messages.create(
            model="claude-test",
            max_tokens=100,
            stream=True,
            messages=[{"role": "user", "content": "hi"}],
            metadata=metadata,
        )

    assert captured.value.error_code == "anthropic_stream_trace_requires_helper"
    assert at.wake_calls == 0
    assert fake.create_calls == 0


def test_read_only_mapping_metadata_keeps_provider_fields_and_local_flags():
    at = _StubAt()
    fake = _FakeAnthropic()
    adapter = AnthropicAdapter(fake, at)

    metadata = MappingProxyType(
        {
            "agenttool": MappingProxyType({"skip_wake": True}),
            "user_id": "provider-user",
        }
    )
    response = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        system="ONLY_USER",
        messages=[{"role": "user", "content": "hi"}],
        metadata=metadata,
    )

    assert at.wake_calls == 0
    assert fake.last_params["system"] == "ONLY_USER"
    assert fake.last_params["metadata"] == {"user_id": "provider-user"}
    assert response.agenttool.wake_used is False


def test_low_level_close_reaches_a_distinct_iterator_cleanup():
    class _IteratorOnlyStream:
        def __init__(self) -> None:
            self.cleanup_count = 0

        def __iter__(self):
            try:
                yield {"type": "message_start"}
                yield {"type": "message_delta"}
            finally:
                self.cleanup_count += 1

    provider_stream = _IteratorOnlyStream()
    at = _StubAt()
    fake = _FakeStreamingAnthropic([])
    fake.low = provider_stream
    adapter = AnthropicAdapter(fake, at)

    stream = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        stream=True,
        messages=[{"role": "user", "content": "hi"}],
    )
    assert next(stream) == {"type": "message_start"}
    stream.close()

    assert provider_stream.cleanup_count == 1


def test_low_level_abort_selects_provider_without_double_cleaning_iterator():
    class _IteratorOnlyStream:
        def __init__(self) -> None:
            self.abort_count = 0
            self.cleanup_count = 0

        def __iter__(self):
            try:
                yield {"type": "message_start"}
                yield {"type": "message_delta"}
            finally:
                self.cleanup_count += 1

        def abort(self):
            self.abort_count += 1

    provider_stream = _IteratorOnlyStream()
    at = _StubAt()
    fake = _FakeStreamingAnthropic([])
    fake.low = provider_stream
    adapter = AnthropicAdapter(fake, at)

    stream = adapter.messages.create(
        stream=True,
        messages=[{"role": "user", "content": "hi"}],
    )
    assert next(stream) == {"type": "message_start"}
    stream.abort()
    stream.close()
    stream.abort()

    assert provider_stream.abort_count == 1
    assert provider_stream.cleanup_count == 0


def test_low_level_send_and_throw_reach_a_distinct_iterator():
    class _IteratorOnlyStream:
        def __init__(self) -> None:
            self.received: list[Any] = []
            self.cleanup_count = 0

        def __iter__(self):
            try:
                value = yield {"type": "message_start"}
                self.received.append(value)
                yield {"type": "message_delta"}
            finally:
                self.cleanup_count += 1

    at = _StubAt()
    fake = _FakeStreamingAnthropic([])
    first_provider = _IteratorOnlyStream()
    fake.low = first_provider
    adapter = AnthropicAdapter(fake, at)
    stream = adapter.messages.create(
        stream=True,
        messages=[{"role": "user", "content": "hi"}],
    )
    assert next(stream) == {"type": "message_start"}
    assert stream.send("sentinel") == {"type": "message_delta"}
    assert first_provider.received == ["sentinel"]
    stream.close()

    second_provider = _IteratorOnlyStream()
    fake.low = second_provider
    stream = adapter.messages.create(
        stream=True,
        messages=[{"role": "user", "content": "hi"}],
    )
    assert next(stream) == {"type": "message_start"}
    error = RuntimeError("consumer stopped")
    with pytest.raises(RuntimeError) as captured:
        stream.throw(error)
    assert captured.value is error
    assert second_provider.cleanup_count == 1


def test_managed_stream_finalizes_exactly_once_after_unchanged_events():
    event = {"type": "future_provider_event", "payload": {"still": "opaque"}}
    final_text = (
        'done <agenttool><chronicle type="recognition">'
        "<title>Streamed</title></chronicle></agenttool>"
    )
    at = _StubAt()
    fake = _FakeStreamingAnthropic([event], final_text)
    adapter = AnthropicAdapter(fake, at)

    token = set_ambient(AmbientContext(parent_trace_id="tr_parent", tags=["streamed"]))
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


def test_concurrent_final_reads_wait_for_the_same_exact_response():
    class _BlockingFinalProvider(_FakeManagedProviderStream):
        def __init__(self) -> None:
            super().__init__([], "shared final")
            self.final_started = threading.Event()
            self.release_final = threading.Event()

        def get_final_message(self):
            self.final_message_calls += 1
            self.final_started.set()
            assert self.release_final.wait(2)
            return self.final_response

    provider = _BlockingFinalProvider()
    fake = _FakeStreamingAnthropic([])
    fake.managed = provider
    fake.manager = _FakeManagedManager(provider)
    adapter = AnthropicAdapter(fake, _StubAt())
    results: list[Any] = []
    errors: list[BaseException] = []

    def read_final() -> None:
        try:
            results.append(stream.get_final_message())
        except BaseException as error:
            errors.append(error)

    with adapter.messages.stream(
        messages=[{"role": "user", "content": "hi"}],
    ) as stream:
        first = threading.Thread(target=read_final)
        first.start()
        assert provider.final_started.wait(1)

        final_condition = stream.__dict__["_condition"]
        original_wait = final_condition.wait
        second_waiting = threading.Event()

        def observed_wait(timeout=None):
            second_waiting.set()
            return original_wait(timeout)

        final_condition.wait = observed_wait
        second = threading.Thread(target=read_final)
        second.start()
        try:
            assert second_waiting.wait(1)
        finally:
            provider.release_final.set()
            first.join(2)
            second.join(2)

        assert not first.is_alive()
        assert not second.is_alive()

    assert errors == []
    assert len(results) == 2
    assert results[0] is results[1]
    assert provider.final_message_calls == 1


def test_close_during_provider_final_wins_without_late_side_effects():
    class _BlockingFinalProvider(_FakeManagedProviderStream):
        def __init__(self) -> None:
            super().__init__(
                [],
                (
                    'late final <agenttool><chronicle type="recognition">'
                    "<title>must not emit</title></chronicle></agenttool>"
                ),
            )
            self.final_started = threading.Event()
            self.release_final = threading.Event()

        def get_final_message(self):
            self.final_message_calls += 1
            self.final_started.set()
            assert self.release_final.wait(2)
            return self.final_response

    provider = _BlockingFinalProvider()
    at = _StubAt()
    fake = _FakeStreamingAnthropic([])
    fake.managed = provider
    fake.manager = _FakeManagedManager(provider)
    adapter = AnthropicAdapter(fake, at)
    errors: list[BaseException] = []

    with adapter.messages.stream(
        messages=[{"role": "user", "content": "private prompt"}],
        metadata={"agenttool": {"trace": "decision"}},
    ) as stream:
        final_thread = threading.Thread(
            target=lambda: _capture_error(stream.get_final_message, errors)
        )
        final_thread.start()
        assert provider.final_started.wait(1)
        stream.close()
        provider.release_final.set()
        final_thread.join(2)
        assert not final_thread.is_alive()

        with pytest.raises(AgentToolError) as repeated:
            stream.get_final_message()

    assert len(errors) == 1
    assert isinstance(errors[0], AgentToolError)
    assert errors[0].error_code == "anthropic_stream_closed"
    assert repeated.value is errors[0]
    assert provider.final_message_calls == 1
    assert at.recorded == []


def test_iterator_error_during_provider_final_wins_by_exact_identity():
    provider_error = RuntimeError("event reader failed")

    class _ConcurrentFailureProvider(_FakeManagedProviderStream):
        def __init__(self) -> None:
            super().__init__(
                [],
                (
                    'late final <agenttool><chronicle type="recognition">'
                    "<title>must not emit</title></chronicle></agenttool>"
                ),
            )
            self.final_started = threading.Event()
            self.release_final = threading.Event()

        def __next__(self):
            raise provider_error

        def get_final_message(self):
            self.final_message_calls += 1
            self.final_started.set()
            assert self.release_final.wait(2)
            return self.final_response

    provider = _ConcurrentFailureProvider()
    at = _StubAt()
    fake = _FakeStreamingAnthropic([])
    fake.managed = provider
    fake.manager = _FakeManagedManager(provider)
    adapter = AnthropicAdapter(fake, at)
    final_errors: list[BaseException] = []

    with adapter.messages.stream(
        messages=[{"role": "user", "content": "private prompt"}],
        metadata={"agenttool": {"trace": "decision"}},
    ) as stream:
        final_thread = threading.Thread(
            target=lambda: _capture_error(stream.get_final_message, final_errors)
        )
        final_thread.start()
        assert provider.final_started.wait(1)
        with pytest.raises(RuntimeError) as event_failure:
            next(stream)
        provider.release_final.set()
        final_thread.join(2)
        assert not final_thread.is_alive()

        with pytest.raises(RuntimeError) as repeated:
            next(stream)

    assert event_failure.value is provider_error
    assert final_errors == [provider_error]
    assert repeated.value is provider_error
    assert at.recorded == []


def test_close_wins_while_natural_completion_is_retrieving_final_message():
    class _NaturalCompletionProvider(_FakeManagedProviderStream):
        def __init__(self) -> None:
            super().__init__([], "late natural final")
            self.final_started = threading.Event()
            self.release_final = threading.Event()

        def __next__(self):
            raise StopIteration

        def get_final_message(self):
            self.final_message_calls += 1
            self.final_started.set()
            assert self.release_final.wait(2)
            return self.final_response

    provider = _NaturalCompletionProvider()
    at = _StubAt()
    fake = _FakeStreamingAnthropic([])
    fake.managed = provider
    fake.manager = _FakeManagedManager(provider)
    adapter = AnthropicAdapter(fake, at)
    errors: list[BaseException] = []

    with adapter.messages.stream(
        messages=[{"role": "user", "content": "private prompt"}],
        metadata={"agenttool": {"trace": "decision"}},
    ) as stream:
        iterator_thread = threading.Thread(
            target=lambda: _capture_error(lambda: next(stream), errors)
        )
        iterator_thread.start()
        assert provider.final_started.wait(1)
        stream.close()
        provider.release_final.set()
        iterator_thread.join(2)
        assert not iterator_thread.is_alive()

        with pytest.raises(AgentToolError) as repeated:
            stream.get_final_message()

    assert len(errors) == 1
    assert isinstance(errors[0], AgentToolError)
    assert errors[0].error_code == "anthropic_stream_closed"
    assert repeated.value is errors[0]
    assert at.recorded == []


def test_close_during_trace_request_fences_the_later_markup_request():
    trace_started = threading.Event()
    release_trace = threading.Event()

    def blocking_request(method, path, body):
        if path == "/v1/traces":
            trace_started.set()
            assert release_trace.wait(2)
            return {"trace_id": "tr_started_before_close"}
        if path == "/v1/chronicle":
            return {"entry": {"id": "ch_must_not_exist"}}
        return {}

    at = _StubAt(request_impl=blocking_request)
    final_text = (
        'final <agenttool><chronicle type="recognition">'
        "<title>must not emit</title></chronicle></agenttool>"
    )
    fake = _FakeStreamingAnthropic([], final_text)
    adapter = AnthropicAdapter(fake, at)
    final_errors: list[BaseException] = []
    close_errors: list[BaseException] = []

    with adapter.messages.stream(
        messages=[{"role": "user", "content": "private prompt"}],
        metadata={"agenttool": {"trace": "decision"}},
    ) as stream:
        final_thread = threading.Thread(
            target=lambda: _capture_error(stream.get_final_message, final_errors)
        )
        final_thread.start()
        assert trace_started.wait(1)

        original_publish = stream._publish_terminal_intent
        intent_published = threading.Event()

        def observed_publish(state, error):
            intent = original_publish(state, error)
            intent_published.set()
            return intent

        stream._publish_terminal_intent = observed_publish
        close_thread = threading.Thread(
            target=lambda: _capture_error(stream.close, close_errors)
        )
        close_thread.start()
        assert intent_published.wait(1)
        assert close_thread.is_alive()
        release_trace.set()
        final_thread.join(2)
        close_thread.join(2)
        assert not final_thread.is_alive()
        assert not close_thread.is_alive()

    assert close_errors == []
    assert len(final_errors) == 1
    assert isinstance(final_errors[0], AgentToolError)
    assert final_errors[0].error_code == "anthropic_stream_closed"
    assert [call[1] for call in at.recorded] == ["/v1/traces"]


def test_managed_trace_snapshots_prompt_metadata_and_ambient_at_call_boundary():
    messages = [{"role": "user", "content": "original observation"}]
    explicit_tags = ["explicit-original"]
    agenttool_meta = {"trace": "decision", "tags": explicit_tags}
    ambient = AmbientContext(
        parent_trace_id="tr_original_parent",
        tags=["ambient-original"],
    )
    at = _StubAt()
    fake = _FakeStreamingAnthropic([], "final answer")
    adapter = AnthropicAdapter(fake, at)

    token = set_ambient(ambient)
    try:
        manager = adapter.messages.stream(
            messages=messages,
            metadata={"agenttool": agenttool_meta},
        )
    finally:
        reset_ambient(token)

    messages[0]["content"] = "mutated observation"
    explicit_tags.append("explicit-mutated")
    agenttool_meta["trace"] = None
    ambient.parent_trace_id = "tr_mutated_parent"
    ambient.tags.append("ambient-mutated")

    with manager as stream:
        stream.get_final_message()

    trace_body = at.recorded[0][2]
    assert trace_body["reasoning"]["observations"] == ["original observation"]
    assert trace_body["parent_trace_id"] == "tr_original_parent"
    assert trace_body["tags"] == ["explicit-original", "ambient-original"]


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


@pytest.mark.parametrize("terminate", ["close", "abort"])
def test_managed_termination_fences_late_exhaustion_from_finalization(
    terminate: str,
):
    final_text = (
        'partial <agenttool><chronicle type="recognition">'
        "<title>Must not emit</title></chronicle></agenttool>"
    )

    class _CloseAwareText:
        def __init__(self, provider: Any) -> None:
            self.provider = provider

        def __iter__(self):
            return self

        def __next__(self):
            if self.provider.closed:
                raise StopIteration
            return "partial"

    class _CloseStopsProvider:
        def __init__(self) -> None:
            self.closed = False
            self.index = 0
            self.abort_count = 0
            self.close_count = 0
            self.final_message_calls = 0
            self.final_response = {
                "id": "msg_partial",
                "model": "claude-test",
                "content": [{"type": "text", "text": final_text}],
            }
            self.text_stream = _CloseAwareText(self)

        def __iter__(self):
            return self

        def __next__(self):
            if self.closed or self.index >= 2:
                raise StopIteration
            self.index += 1
            return {"type": f"event_{self.index}"}

        def get_final_message(self):
            self.final_message_calls += 1
            return self.final_response

        def close(self):
            self.closed = True
            self.close_count += 1

        def abort(self):
            self.closed = True
            self.abort_count += 1

    provider = _CloseStopsProvider()
    at = _StubAt()
    fake = _FakeStreamingAnthropic([])
    fake.managed = provider
    fake.manager = _FakeManagedManager(provider)
    adapter = AnthropicAdapter(fake, at)

    with adapter.messages.stream(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "private partial prompt"}],
        metadata={"agenttool": {"trace": "decision"}},
    ) as stream:
        assert next(stream) == {"type": "event_1"}
        getattr(stream, terminate)()
        with pytest.raises(StopIteration):
            next(stream)
        with pytest.raises(StopIteration):
            next(stream.text_stream)
        with pytest.raises(AgentToolError) as captured:
            stream.get_final_message()

    assert captured.value.error_code == "anthropic_stream_closed"
    assert provider.final_message_calls == 0
    assert provider.abort_count == (1 if terminate == "abort" else 0)
    assert at.recorded == []
    assert stream.agenttool.trace_id is None
    assert stream.agenttool.markup_emissions == []


def test_managed_context_exit_fences_late_exhaustion_from_finalization():
    class _CloseAwareText:
        def __init__(self, provider: Any) -> None:
            self.provider = provider

        def __iter__(self):
            return self

        def __next__(self):
            if self.provider.closed:
                raise StopIteration
            return "partial"

    class _CloseStopsProvider:
        def __init__(self) -> None:
            self.closed = False
            self.index = 0
            self.final_message_calls = 0
            self.text_stream = _CloseAwareText(self)

        def __iter__(self):
            return self

        def __next__(self):
            if self.closed or self.index >= 2:
                raise StopIteration
            self.index += 1
            return {"type": f"event_{self.index}"}

        def get_final_message(self):
            self.final_message_calls += 1
            return {
                "id": "msg_partial",
                "model": "claude-test",
                "content": [{"type": "text", "text": "must not finalize"}],
            }

        def close(self):
            self.closed = True

    provider = _CloseStopsProvider()
    at = _StubAt()
    fake = _FakeStreamingAnthropic([])
    fake.managed = provider
    fake.manager = _FakeManagedManager(provider)
    adapter = AnthropicAdapter(fake, at)

    with adapter.messages.stream(
        messages=[{"role": "user", "content": "private partial prompt"}],
        metadata={"agenttool": {"trace": "decision"}},
    ) as stream:
        assert next(stream) == {"type": "event_1"}

    with pytest.raises(StopIteration):
        next(stream)
    with pytest.raises(StopIteration):
        next(stream.text_stream)
    with pytest.raises(AgentToolError) as captured:
        stream.get_final_message()

    assert captured.value.error_code == "anthropic_stream_closed"
    assert provider.final_message_calls == 0
    assert at.recorded == []


def test_managed_iterator_error_fences_later_exhaustion_from_finalization():
    provider_error = RuntimeError("provider stream failed")

    class _ErrorThenEndProvider(_FakeManagedProviderStream):
        def __init__(self) -> None:
            super().__init__([], "must not finalize")
            self.failed = False

        def __next__(self):
            if not self.failed:
                self.failed = True
                raise provider_error
            raise StopIteration

    provider = _ErrorThenEndProvider()
    at = _StubAt()
    fake = _FakeStreamingAnthropic([])
    fake.managed = provider
    fake.manager = _FakeManagedManager(provider)
    adapter = AnthropicAdapter(fake, at)

    with adapter.messages.stream(
        messages=[{"role": "user", "content": "hi"}],
        metadata={"agenttool": {"trace": "decision"}},
    ) as stream:
        with pytest.raises(RuntimeError) as first:
            next(stream)
        with pytest.raises(RuntimeError) as second:
            next(stream)
        with pytest.raises(RuntimeError) as final:
            stream.get_final_message()
        with pytest.raises(RuntimeError) as thrown:
            stream.throw(RuntimeError("must not replace provider failure"))

    assert first.value is provider_error
    assert second.value is provider_error
    assert final.value is provider_error
    assert thrown.value is provider_error
    assert provider.final_message_calls == 0
    assert at.recorded == []


def test_managed_text_stream_natural_completion_finalizes_exactly_once():
    at = _StubAt()
    fake = _FakeStreamingAnthropic(
        [{"type": "message_start"}],
        "complete through text",
    )
    adapter = AnthropicAdapter(fake, at)

    with adapter.messages.stream(
        messages=[{"role": "user", "content": "hi"}],
        metadata={"agenttool": {"trace": "decision"}},
    ) as stream:
        assert list(stream.text_stream) == ["delta"]
        first = stream.get_final_message()
        second = stream.get_final_message()

    assert first is second
    assert fake.managed.final_message_calls == 1
    assert len([call for call in at.recorded if call[1] == "/v1/traces"]) == 1


@pytest.mark.parametrize("terminal_action", ["complete", "close"])
def test_terminal_stream_blocks_send_throw_and_text_provider_access(
    terminal_action: str,
):
    class _TerminalAccessProvider:
        def __init__(self) -> None:
            self.send_count = 0
            self.throw_count = 0
            self.text_stream_access_count = 0
            self.close_count = 0

        def __iter__(self):
            return self

        def __next__(self):
            raise StopIteration

        @property
        def text_stream(self):
            self.text_stream_access_count += 1
            return iter(["late-text"])

        def get_final_message(self):
            return {
                "id": "msg_terminal",
                "model": "claude-test",
                "content": [{"type": "text", "text": "done"}],
            }

        def send(self, value):
            self.send_count += 1
            return "late-send"

        def throw(self, *args):
            self.throw_count += 1
            return "late-throw"

        def close(self):
            self.close_count += 1

    class _ManagerWithoutInternalCleanup:
        def __init__(self) -> None:
            self.exit_count = 0

        def __enter__(self):
            return provider

        def __exit__(self, exc_type, exc, exc_tb):
            self.exit_count += 1

    provider = _TerminalAccessProvider()
    manager = _ManagerWithoutInternalCleanup()
    fake = _FakeStreamingAnthropic([])
    fake.managed = provider
    fake.manager = manager
    adapter = AnthropicAdapter(fake, _StubAt())

    with adapter.messages.stream(
        messages=[{"role": "user", "content": "hi"}],
    ) as stream:
        if terminal_action == "complete":
            stream.get_final_message()
            terminal_error = None
        else:
            stream.close()
            with pytest.raises(AgentToolError) as closed:
                stream.get_final_message()
            terminal_error = closed.value

        with pytest.raises(StopIteration):
            stream.send("must not send")
        injected = RuntimeError("must not throw")
        if terminal_action == "complete":
            with pytest.raises(RuntimeError) as thrown:
                stream.throw(injected)
            assert thrown.value is injected
        else:
            with pytest.raises(AgentToolError) as thrown:
                stream.throw(injected)
            assert thrown.value is terminal_error
        with pytest.raises(StopIteration):
            next(stream.text_stream)
        stream.close()
        stream.abort()

    assert provider.send_count == 0
    assert provider.throw_count == 0
    assert provider.text_stream_access_count == 0
    assert provider.close_count == 1
    assert manager.exit_count == 1


def test_closing_text_facade_is_cancellation_not_provider_failure():
    provider = _FakeManagedProviderStream(
        [{"type": "message_start"}],
        "must not finalize",
    )
    provider.text_stream = iter(["first", "second"])

    class _ManagerWithoutInternalCleanup:
        def __enter__(self):
            return provider

        def __exit__(self, exc_type, exc, exc_tb):
            return None

    at = _StubAt()
    fake = _FakeStreamingAnthropic([])
    fake.managed = provider
    fake.manager = _ManagerWithoutInternalCleanup()
    adapter = AnthropicAdapter(fake, at)

    with adapter.messages.stream(
        messages=[{"role": "user", "content": "private prompt"}],
        metadata={"agenttool": {"trace": "decision"}},
    ) as stream:
        assert next(stream.text_stream) == "first"
        stream.text_stream.close()
        with pytest.raises(StopIteration):
            next(stream)
        with pytest.raises(AgentToolError) as captured:
            stream.get_final_message()

    assert captured.value.error_code == "anthropic_stream_closed"
    assert provider.final_message_calls == 0
    assert provider.close_count == 1
    assert at.recorded == []


def test_closing_unstarted_text_facade_cancels_before_finalization():
    provider = _FakeManagedProviderStream(
        [{"type": "message_start"}],
        (
            'must not finalize <agenttool><chronicle type="recognition">'
            "<title>Must not emit</title></chronicle></agenttool>"
        ),
    )

    class _ManagerWithoutInternalCleanup:
        def __enter__(self):
            return provider

        def __exit__(self, exc_type, exc, exc_tb):
            return None

    at = _StubAt()
    fake = _FakeStreamingAnthropic([])
    fake.managed = provider
    fake.manager = _ManagerWithoutInternalCleanup()
    adapter = AnthropicAdapter(fake, at)

    with adapter.messages.stream(
        messages=[{"role": "user", "content": "private prompt"}],
        metadata={"agenttool": {"trace": "decision"}},
    ) as stream:
        stream.text_stream.close()
        with pytest.raises(StopIteration):
            next(stream)
        with pytest.raises(AgentToolError) as captured:
            stream.get_final_message()

    assert captured.value.error_code == "anthropic_stream_closed"
    assert provider.final_message_calls == 0
    assert provider.close_count == 1
    assert at.recorded == []


def test_throwing_into_unstarted_text_facade_fails_before_finalization():
    provider_error = RuntimeError("text consumer failed")
    provider = _FakeManagedProviderStream(
        [{"type": "message_start"}],
        "must not finalize",
    )
    at = _StubAt()
    fake = _FakeStreamingAnthropic([])
    fake.managed = provider
    fake.manager = _FakeManagedManager(provider)
    adapter = AnthropicAdapter(fake, at)

    with adapter.messages.stream(
        messages=[{"role": "user", "content": "private prompt"}],
        metadata={"agenttool": {"trace": "decision"}},
    ) as stream:
        with pytest.raises(RuntimeError) as thrown:
            stream.text_stream.throw(provider_error)
        with pytest.raises(RuntimeError) as final:
            stream.get_final_message()

    assert thrown.value is provider_error
    assert final.value is provider_error
    assert provider.final_message_calls == 0
    assert at.recorded == []


def test_managed_send_throw_and_close_reach_a_distinct_iterator():
    class _DistinctIteratorProvider:
        def __init__(self) -> None:
            self.received: list[Any] = []
            self.cleanup_count = 0
            self.close_count = 0
            self.final_message_calls = 0
            self.text_stream = iter(())

        def __iter__(self):
            try:
                value = yield {"type": "message_start"}
                self.received.append(value)
                yield {"type": "message_delta"}
            finally:
                self.cleanup_count += 1

        def get_final_message(self):
            self.final_message_calls += 1
            return {
                "id": "msg_final",
                "model": "claude-test",
                "content": [{"type": "text", "text": "done"}],
            }

        def close(self):
            self.close_count += 1

    provider = _DistinctIteratorProvider()
    at = _StubAt()
    fake = _FakeStreamingAnthropic([])
    fake.managed = provider
    fake.manager = _FakeManagedManager(provider)
    adapter = AnthropicAdapter(fake, at)

    with adapter.messages.stream(
        messages=[{"role": "user", "content": "hi"}],
    ) as stream:
        assert next(stream) == {"type": "message_start"}
        assert stream.send("sentinel") == {"type": "message_delta"}
        assert provider.received == ["sentinel"]
        stream.close()
        stream.close()
        stream.abort()

    assert provider.cleanup_count == 1
    assert provider.close_count == 1
    assert provider.final_message_calls == 0

    provider = _DistinctIteratorProvider()
    fake.managed = provider
    fake.manager = _FakeManagedManager(provider)
    with adapter.messages.stream(
        messages=[{"role": "user", "content": "hi"}],
    ) as stream:
        assert next(stream) == {"type": "message_start"}
        error = RuntimeError("consumer stopped")
        with pytest.raises(RuntimeError) as captured:
            stream.throw(error)
        assert captured.value is error

    assert provider.cleanup_count == 1
    assert provider.final_message_calls == 0
    assert at.recorded == []


def test_managed_ordinary_context_exit_uses_manager_as_authoritative_cleanup():
    class _DistinctIteratorProvider:
        def __init__(self) -> None:
            self.iterator_cleanup_count = 0
            self.provider_close_count = 0
            self.text_stream = iter(())

        def __iter__(self):
            try:
                yield {"type": "message_start"}
                yield {"type": "message_delta"}
            finally:
                self.iterator_cleanup_count += 1

        def get_final_message(self):
            raise AssertionError("finalization must not run")

        def close(self):
            self.provider_close_count += 1

    provider = _DistinctIteratorProvider()
    at = _StubAt()
    fake = _FakeStreamingAnthropic([])
    fake.managed = provider
    fake.manager = _FakeManagedManager(provider)
    adapter = AnthropicAdapter(fake, at)

    with adapter.messages.stream(
        messages=[{"role": "user", "content": "hi"}],
    ) as stream:
        assert next(stream) == {"type": "message_start"}

    assert fake.manager.exit_count == 1
    assert provider.provider_close_count == 1
    assert provider.iterator_cleanup_count == 0

    # Context exit already selected the opaque manager as authoritative.
    stream.close()
    stream.abort()
    assert provider.provider_close_count == 1
    assert provider.iterator_cleanup_count == 0


def test_managed_manual_cleanup_selects_one_adapter_layer_once():
    class _Provider:
        def __init__(self) -> None:
            self.close_count = 0
            self.abort_count = 0
            self.text_stream = iter(())

        def __iter__(self):
            return self

        def __next__(self):
            return {"type": "message_delta"}

        def get_final_message(self):
            raise AssertionError("finalization must not run")

        def close(self):
            self.close_count += 1

        def abort(self):
            self.abort_count += 1

    class _ManagerWithoutInternalCleanup:
        def __init__(self, provider) -> None:
            self.provider = provider
            self.exit_count = 0

        def __enter__(self):
            return self.provider

        def __exit__(self, exc_type, exc, exc_tb):
            self.exit_count += 1

    provider = _Provider()
    manager = _ManagerWithoutInternalCleanup(provider)
    fake = _FakeStreamingAnthropic([])
    fake.managed = provider
    fake.manager = manager
    adapter = AnthropicAdapter(fake, _StubAt())

    with adapter.messages.stream(
        messages=[{"role": "user", "content": "hi"}],
    ) as stream:
        stream.close()
        stream.abort()
        stream.close()

    assert provider.close_count == 1
    assert provider.abort_count == 0
    assert manager.exit_count == 1


def test_invalid_managed_helper_unwinds_the_provider_manager():
    class _InvalidStream:
        pass

    class _Manager:
        def __init__(self) -> None:
            self.enter_count = 0
            self.exit_count = 0
            self.exit_exception = None

        def __enter__(self):
            self.enter_count += 1
            return _InvalidStream()

        def __exit__(self, exc_type, exc, exc_tb):
            self.exit_count += 1
            self.exit_exception = exc

    manager = _Manager()

    class _Client:
        class _Messages:
            def create(self, **params):
                raise AssertionError("create must not run")

            def stream(self, **params):
                return manager

        messages = _Messages()

    adapter = AnthropicAdapter(_Client(), _StubAt())
    with pytest.raises(AgentToolError) as captured:
        with adapter.messages.stream(
            messages=[{"role": "user", "content": "hi"}],
        ):
            raise AssertionError("invalid stream entered")

    assert captured.value.error_code == "anthropic_stream_helper_invalid"
    assert manager.enter_count == 1
    assert manager.exit_count == 1
    assert manager.exit_exception is captured.value


def test_managed_iterator_construction_error_exits_once_and_preserves_error():
    iterator_error = RuntimeError("managed iterator construction failed")
    exit_error = RuntimeError("managed exit also failed")

    class _BrokenManagedStream:
        text_stream = iter(())

        def __iter__(self):
            raise iterator_error

        def get_final_message(self):
            raise AssertionError("finalization must not run")

    class _Manager:
        def __init__(self) -> None:
            self.exit_count = 0
            self.exit_exception = None

        def __enter__(self):
            return _BrokenManagedStream()

        def __exit__(self, exc_type, exc, exc_tb):
            self.exit_count += 1
            self.exit_exception = exc
            raise exit_error

    manager = _Manager()

    class _Client:
        class _Messages:
            def stream(self, **params):
                return manager

        messages = _Messages()

    adapter = AnthropicAdapter(_Client(), _StubAt())
    with pytest.raises(RuntimeError) as captured:
        with adapter.messages.stream(
            messages=[{"role": "user", "content": "hi"}],
        ):
            raise AssertionError("unreachable")

    assert captured.value is iterator_error
    assert manager.exit_count == 1
    assert manager.exit_exception is iterator_error


def test_invalid_stream_manager_is_cleaned_before_rejection():
    class _InvalidManager:
        def __init__(self) -> None:
            self.close_count = 0
            self.abort_count = 0

        def close(self):
            self.close_count += 1

        def abort(self):
            self.abort_count += 1

    invalid = _InvalidManager()

    class _Client:
        class _Messages:
            def stream(self, **params):
                return invalid

        messages = _Messages()

    adapter = AnthropicAdapter(_Client(), _StubAt())
    with pytest.raises(AgentToolError) as captured:
        adapter.messages.stream(
            messages=[{"role": "user", "content": "hi"}],
        )

    assert captured.value.error_code == "anthropic_stream_helper_invalid"
    assert invalid.close_count == 1
    assert invalid.abort_count == 0


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


def test_trace_failure_does_not_crash_call_site_or_write_stdout(capsys):
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
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "auto-trace failed: server boom" in captured.err


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


def test_read_only_mapping_response_keeps_content_items_and_receipts():
    response = MappingProxyType(
        {
            "id": "msg_read_only",
            "model": "claude-test",
            "content": (
                MappingProxyType(
                    {
                        "type": "text",
                        "text": (
                            'answer <agenttool><chronicle type="recognition">'
                            "<title>Read only</title></chronicle></agenttool>"
                        ),
                    }
                ),
            ),
        }
    )

    class _Client:
        class _Messages:
            def create(self, **params):
                return response

        messages = _Messages()

    def read_only_result(method, path, body):
        if path == "/v1/traces":
            return MappingProxyType({"trace_id": "tr_read_only"})
        return MappingProxyType({"entry": MappingProxyType({"id": "ch_read_only"})})

    at = _StubAt(request_impl=read_only_result)
    adapter = AnthropicAdapter(_Client(), at)
    adapted = adapter.messages.create(
        messages=[
            MappingProxyType({"role": "user", "content": "read-only observation"})
        ],
        metadata=MappingProxyType(
            {"agenttool": MappingProxyType({"trace": "decision"})}
        ),
    )

    assert adapted["id"] == "msg_read_only"
    assert adapted.content[0]["type"] == "text"
    assert isinstance(adapted, Mapping)
    assert len(adapted) == len(response)
    assert list(adapted) == list(response)
    assert dict(adapted) == dict(response)
    assert adapted.agenttool.trace_id == "tr_read_only"
    assert adapted.agenttool.markup_emissions[0].id == "ch_read_only"
    assert at.recorded[0][2]["reasoning"]["observations"] == ["read-only observation"]


def test_extensible_response_keeps_provider_identity_and_type():
    class _ExtensibleResponse:
        def __init__(self) -> None:
            self.id = "msg_extensible"
            self.model = "claude-test"
            self.content = [{"type": "text", "text": "ok"}]

        def provider_method(self) -> str:
            return "provider-method"

    provider_response = _ExtensibleResponse()

    class _Client:
        class _Messages:
            def create(self, **params):
                return provider_response

        messages = _Messages()

    adapter = AnthropicAdapter(_Client(), _StubAt())
    response = adapter.messages.create(
        messages=[{"role": "user", "content": "hi"}],
    )

    assert response is provider_response
    assert isinstance(response, _ExtensibleResponse)
    assert response.provider_method() == "provider-method"
    assert response.agenttool.wake_used is True


def test_provider_agenttool_collision_is_wrapped_without_clobbering():
    class _ProviderResponse:
        def __init__(self) -> None:
            self.id = "msg_collision"
            self.content = [{"type": "text", "text": "ok"}]
            self.agenttool = {"provider": "native"}

    provider_response = _ProviderResponse()

    class _Client:
        class _Messages:
            def create(self, **params):
                return provider_response

        messages = _Messages()

    adapted = AnthropicAdapter(_Client(), _StubAt()).messages.create(
        messages=[{"role": "user", "content": "hi"}],
    )

    assert adapted is not provider_response
    assert adapted.id == "msg_collision"
    assert adapted.agenttool.wake_used is True
    assert provider_response.agenttool == {"provider": "native"}


def test_reused_mutable_response_is_wrapped_without_overwriting_first_receipt():
    class _ProviderResponse:
        def __init__(self) -> None:
            self.id = "msg_reused"
            self.content = [{"type": "text", "text": "ok"}]

    provider_response = _ProviderResponse()

    class _Client:
        class _Messages:
            def create(self, **params):
                return provider_response

        messages = _Messages()

    adapter = AnthropicAdapter(_Client(), _StubAt())
    first = adapter.messages.create(
        messages=[{"role": "user", "content": "first"}],
    )
    first_receipt = first.agenttool
    second = adapter.messages.create(
        messages=[{"role": "user", "content": "second"}],
        metadata={"agenttool": {"skip_wake": True}},
    )

    assert first is provider_response
    assert second is not provider_response
    assert provider_response.agenttool is first_receipt
    assert second.agenttool is not first_receipt
    assert second.agenttool.wake_used is False


def test_concurrently_reused_mutable_response_keeps_each_call_receipt():
    missing_checks = 0
    missing_checks_lock = threading.Lock()
    both_checked_missing = threading.Event()
    missing_barrier = threading.Barrier(2)

    class _ProviderResponse:
        def __init__(self) -> None:
            self.id = "msg_concurrently_reused"
            self.content = [{"type": "text", "text": "ok"}]

        def __getattribute__(self, name):
            nonlocal missing_checks
            if name != "agenttool":
                return object.__getattribute__(self, name)
            try:
                return object.__getattribute__(self, name)
            except AttributeError:
                with missing_checks_lock:
                    missing_checks += 1
                    if missing_checks == 2:
                        both_checked_missing.set()
                try:
                    missing_barrier.wait()
                except threading.BrokenBarrierError:
                    pass
                raise

    provider_response = _ProviderResponse()

    class _Client:
        class _Messages:
            def create(self, **params):
                return provider_response

        messages = _Messages()

    adapter = AnthropicAdapter(_Client(), _StubAt())
    start = threading.Barrier(3)
    results: dict[str, Any] = {}
    errors: list[BaseException] = []

    def call(label: str, metadata=None) -> None:
        try:
            start.wait()
            results[label] = adapter.messages.create(
                messages=[{"role": "user", "content": label}],
                metadata=metadata,
            )
        except BaseException as error:
            errors.append(error)

    wake_call = threading.Thread(target=call, args=("wake",))
    skip_call = threading.Thread(
        target=call,
        args=("skip", {"agenttool": {"skip_wake": True}}),
    )
    wake_call.start()
    skip_call.start()
    start.wait()

    # A synchronized implementation permits only one missing-field check.
    # Release that first caller without relying on an unbounded wait.
    both_checked_missing.wait(0.1)
    missing_barrier.abort()
    wake_call.join(timeout=2)
    skip_call.join(timeout=2)

    assert not wake_call.is_alive()
    assert not skip_call.is_alive()
    assert errors == []
    assert results["wake"].agenttool.wake_used is True
    assert results["skip"].agenttool.wake_used is False
    assert results["wake"] is not results["skip"]
    assert missing_checks == 1


def test_frozen_response_uses_safe_forwarding_fallback():
    @dataclass(frozen=True)
    class _FrozenResponse:
        id: str
        model: str
        content: list[dict[str, Any]]

    provider_response = _FrozenResponse(
        id="msg_frozen",
        model="claude-test",
        content=[{"type": "text", "text": "ok"}],
    )

    class _Client:
        class _Messages:
            def create(self, **params):
                return provider_response

        messages = _Messages()

    adapter = AnthropicAdapter(_Client(), _StubAt())
    response = adapter.messages.create(
        messages=[{"role": "user", "content": "hi"}],
    )

    assert response is not provider_response
    assert response.id == "msg_frozen"
    assert response.agenttool.wake_used is True
    assert not hasattr(provider_response, "agenttool")


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
