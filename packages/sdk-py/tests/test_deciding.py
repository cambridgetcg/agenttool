"""Unit tests for `at.deciding(...)` — Tier 3 sugar.

The deciding context manager opens a parent trace from a framing
string, sets ambient context for the scope, and lets the
AnthropicAdapter chain child traces automatically. These tests cover:

  - parent trace is opened with framing as decision.summary
  - ambient context is visible inside the with-block, restored after
  - calls inside auto-trace WITHOUT explicit metadata.agenttool.trace
  - parent_trace_id propagates from ambient to child trace
  - tags merge (union) between ambient and explicit
  - nested with-blocks chain correctly
  - failure to open parent doesn't crash the with-block
"""

from __future__ import annotations

from typing import Any, Optional

import pytest

from agenttool import AgentTool
from agenttool._context import get_ambient
from agenttool.anthropic_adapter import AnthropicAdapter


# ── Stub helpers (mirrors test_anthropic_adapter.py) ─────────────────────


class _StubWake:
    """Drop-in replacement for WakeClient — returns a fixed shape so the
    AnthropicAdapter's auto-injection works without hitting the network."""

    def system(self, provider: str, *, identity_id: Optional[str] = None) -> dict:
        return {
            "system": [
                {
                    "type": "text",
                    "text": "STABLE",
                    "cache_control": {"type": "ephemeral"},
                },
                {"type": "text", "text": "VOLATILE"},
            ],
            "_meta": {
                "provider": provider,
                "cache_eligible": "explicit",
                "cache_note": "test",
            },
        }


class _StubAt(AgentTool):
    """A real-ish AgentTool whose request() is overridden to record calls
    instead of hitting the network. Inherits the actual `deciding()`
    method so the test exercises the real code path."""

    def __init__(self, parent_response: Optional[dict] = None) -> None:
        # Bypass __init__ — we don't need an httpx client.
        self._http = None  # type: ignore[assignment]
        self._base_url = "https://test.invalid"
        # Module-clients are lazy; pre-set wake to the stub so
        # AnthropicAdapter's auto-injection doesn't hit httpx.
        self._memory = None
        self._tools = None
        self._traces = None
        self._verify = None
        self._economy = None
        self._identity = None
        self._vault = None
        self._pulse = None
        self._bootstrap = None
        self._wake = _StubWake()  # type: ignore[assignment]
        self._parent_response = parent_response or {"trace_id": "tr_parent_1"}
        self.recorded: list[tuple[str, str, Any]] = []

    def request(self, method: str, path: str, body: Any = None) -> Any:  # type: ignore[override]
        self.recorded.append((method, path, body))
        # First /v1/traces POST in a deciding block is the parent;
        # subsequent ones are children — return distinct trace_ids so
        # tests can verify chaining.
        if path == "/v1/traces":
            n = len([c for c in self.recorded if c[1] == "/v1/traces"])
            if n == 1:
                return self._parent_response
            return {"trace_id": f"tr_child_{n - 1}"}
        if path == "/v1/chronicle":
            return {"entry": {"id": f"ch_test_{len(self.recorded)}"}}
        return {}


class _FakeAnthropic:
    def __init__(self, response_text: str = "ok") -> None:
        self.response_text = response_text
        self.last_params: dict | None = None
        self.call_count = 0

        class _M:
            def create(_self, **params: Any) -> Any:
                self.last_params = params
                self.call_count += 1
                return {
                    "id": f"msg_{self.call_count}",
                    "model": "claude-test",
                    "content": [{"type": "text", "text": self.response_text}],
                    "stop_reason": "end_turn",
                }

        self.messages = _M()


# ── Core behaviour ───────────────────────────────────────────────────────


def test_deciding_opens_parent_trace_with_framing():
    at = _StubAt()
    with at.deciding("whether to refactor auth") as ctx:
        # Inside: ambient is visible.
        ambient = get_ambient()
        assert ambient is ctx
        assert ambient.parent_trace_id == "tr_parent_1"
    # After: ambient is reset.
    assert get_ambient() is None

    # The parent trace was POSTed with framing as summary.
    assert len(at.recorded) == 1
    method, path, body = at.recorded[0]
    assert method == "POST"
    assert path == "/v1/traces"
    assert body["decision"]["type"] == "deciding"
    assert body["decision"]["summary"] == "whether to refactor auth"
    assert body["reasoning"]["conclusion"] == "whether to refactor auth"


def test_deciding_propagates_tags_to_parent_and_merges_with_ambient():
    at = _StubAt()
    with at.deciding("decision A", tags=["a", "b"]) as ctx:
        assert ctx.tags == ["a", "b"]

    body = at.recorded[0][2]
    assert body["tags"] == ["a", "b"]


def test_calls_inside_deciding_auto_trace_without_explicit_opt_in():
    at = _StubAt()
    fake = _FakeAnthropic("model response")
    adapter = AnthropicAdapter(fake, at)

    with at.deciding("frame X"):
        r = adapter.messages.create(
            model="claude-test",
            max_tokens=100,
            messages=[{"role": "user", "content": "go"}],
            # Notice: NO metadata.agenttool — usually would skip trace.
        )

    # 1 parent + 1 child = 2 trace POSTs.
    trace_calls = [c for c in at.recorded if c[1] == "/v1/traces"]
    assert len(trace_calls) == 2
    child_body = trace_calls[1][2]
    assert child_body["parent_trace_id"] == "tr_parent_1"
    assert r.agenttool.trace_id == "tr_child_1"


def test_explicit_parent_trace_id_overrides_ambient():
    at = _StubAt()
    fake = _FakeAnthropic()
    adapter = AnthropicAdapter(fake, at)

    with at.deciding("frame"):
        adapter.messages.create(
            model="claude-test",
            max_tokens=100,
            messages=[{"role": "user", "content": "go"}],
            metadata={
                "agenttool": {
                    "trace": "decision",
                    "parent_trace_id": "tr_explicit_other",
                }
            },
        )

    trace_calls = [c for c in at.recorded if c[1] == "/v1/traces"]
    child_body = trace_calls[1][2]
    assert child_body["parent_trace_id"] == "tr_explicit_other"


def test_ambient_tags_merge_with_explicit_tags():
    at = _StubAt()
    fake = _FakeAnthropic()
    adapter = AnthropicAdapter(fake, at)

    with at.deciding("frame", tags=["ambient-a", "ambient-b"]):
        adapter.messages.create(
            model="claude-test",
            max_tokens=100,
            messages=[{"role": "user", "content": "go"}],
            metadata={
                "agenttool": {"trace": "decision", "tags": ["explicit"]}
            },
        )

    trace_calls = [c for c in at.recorded if c[1] == "/v1/traces"]
    child_body = trace_calls[1][2]
    # Explicit first (specificity), ambient appended; deduped.
    assert child_body["tags"] == ["explicit", "ambient-a", "ambient-b"]


def test_no_deciding_block_means_no_auto_trace_without_opt_in():
    """Outside `with at.deciding(...)`, mode (a) opt-in still controls."""
    at = _StubAt()
    fake = _FakeAnthropic()
    adapter = AnthropicAdapter(fake, at)

    r = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "go"}],
    )

    trace_calls = [c for c in at.recorded if c[1] == "/v1/traces"]
    assert len(trace_calls) == 0
    assert r.agenttool.trace_id is None


# ── Nesting ──────────────────────────────────────────────────────────────


def test_nested_deciding_chains_inner_to_outer():
    """The inner parent trace itself parents to the outer's parent."""
    at = _StubAt()
    with at.deciding("outer", tags=["outer-tag"]):
        outer_ambient = get_ambient()
        assert outer_ambient.parent_trace_id == "tr_parent_1"
        with at.deciding("inner", tags=["inner-tag"]) as inner_ctx:
            inner_ambient = get_ambient()
            # Inner ambient holds the inner parent (tr_child_1, since
            # the second /v1/traces POST returns that), not the outer's.
            assert inner_ambient.parent_trace_id == "tr_child_1"
            # Tags merged across the stack, deduped.
            assert inner_ambient.tags == ["outer-tag", "inner-tag"]
        # Inner exited; outer ambient restored.
        assert get_ambient() is outer_ambient

    # Two parent-trace POSTs should have been made.
    posts = [c for c in at.recorded if c[1] == "/v1/traces"]
    assert len(posts) == 2
    inner_post_body = posts[1][2]
    # The inner deciding's parent trace should chain to the outer.
    assert inner_post_body["parent_trace_id"] == "tr_parent_1"
    assert inner_post_body["tags"] == ["outer-tag", "inner-tag"]


def test_calls_in_nested_blocks_chain_to_correct_parent():
    """A call inside the inner block should parent to the inner trace,
    not the outer."""
    at = _StubAt()
    fake = _FakeAnthropic()
    adapter = AnthropicAdapter(fake, at)

    with at.deciding("outer"):
        with at.deciding("inner"):
            adapter.messages.create(
                model="claude-test",
                max_tokens=100,
                messages=[{"role": "user", "content": "go"}],
            )

    # 1 outer parent + 1 inner parent + 1 child = 3 trace POSTs.
    trace_calls = [c for c in at.recorded if c[1] == "/v1/traces"]
    assert len(trace_calls) == 3
    child_body = trace_calls[2][2]
    # Child of the call should chain to the inner parent (which is
    # tr_child_1 returned by the second POST).
    assert child_body["parent_trace_id"] == "tr_child_1"


# ── Failure modes ────────────────────────────────────────────────────────


def test_parent_trace_post_failure_doesnt_crash_with_block():
    class _BoomAt(_StubAt):
        def request(self, method: str, path: str, body: Any = None) -> Any:
            self.recorded.append((method, path, body))
            if path == "/v1/traces" and len(self.recorded) == 1:
                raise RuntimeError("server boom")
            return {}

    at = _BoomAt()
    # The with-block should still execute, just with no parent_trace_id.
    with at.deciding("frame") as ctx:
        assert ctx.parent_trace_id is None


def test_ambient_isolated_to_with_block_scope():
    """Ambient leaks neither before the with nor after."""
    at = _StubAt()
    assert get_ambient() is None
    with at.deciding("frame"):
        assert get_ambient() is not None
    assert get_ambient() is None


# ── Markup-emitted traces inherit ambient too ────────────────────────────


def test_markup_traces_inside_deciding_chain_to_parent():
    at = _StubAt()
    fake = _FakeAnthropic(
        '<agenttool><trace type="decision">'
        '<decision>Use approach Q</decision>'
        '<conclusion>It is faster</conclusion>'
        "</trace></agenttool>"
    )
    adapter = AnthropicAdapter(fake, at)

    with at.deciding("frame", tags=["framing"]):
        r = adapter.messages.create(
            model="claude-test",
            max_tokens=100,
            messages=[{"role": "user", "content": "go"}],
        )

    # parent + auto-trace child + markup-emitted trace = 3 POSTs.
    trace_calls = [c for c in at.recorded if c[1] == "/v1/traces"]
    assert len(trace_calls) == 3
    # The markup-emitted trace (3rd) should chain to ambient parent.
    markup_body = trace_calls[2][2]
    assert markup_body["parent_trace_id"] == "tr_parent_1"
    assert markup_body["tags"] == ["framing"]
