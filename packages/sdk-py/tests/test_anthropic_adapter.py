"""Unit tests for AnthropicAdapter — Tier 2 of the agenttool path.

Mirror of the TS adapter tests. Uses a stub AgentTool whose
wake.system returns a fixed shape and whose request() records its
calls; a fake Anthropic client that records params and returns a
configurable response.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import httpx
import pytest

from agenttool.anthropic_adapter import (
    AnthropicAdapter,
    ChronicleBeforeWriteContext,
    MarkupEmission,
)
from agenttool.chronicle import ChronicleClient
from agenttool.exceptions import AgentToolError


# ── Stubs ────────────────────────────────────────────────────────────────

_BASE_URL = "https://api.example.test"


class _StubAt:
    """Minimal duck-type for AgentTool. The adapter reaches
    ``at.wake.system(...)``, ``at.request(...)``, and
    ``at.chronicle.write(...)``."""

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

        # The adapter routes chronicle emissions through the real
        # ChronicleClient, so back one with a stub httpx client that lands
        # in the same `recorded` list as at.request.
        http = MagicMock(spec=httpx.Client)

        def _post(url: str, json: object = None, **kwargs: Any) -> Any:
            result = self.request("POST", url[len(_BASE_URL):], json)
            resp = MagicMock(spec=httpx.Response)
            resp.status_code = 201
            resp.json.return_value = result
            resp.text = ""
            return resp

        http.post.side_effect = _post
        self.chronicle = ChronicleClient(http, _BASE_URL)

    def request(self, method: str, path: str, body: object = None) -> object:
        self.recorded.append((method, path, body))
        if self._request_impl:
            return self._request_impl(method, path, body)
        if path == "/v1/chronicle":
            return {"entry": {"id": f"ch_test_{len(self.recorded)}"}}
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
    adapter = AnthropicAdapter(fake, at, before_chronicle_write=lambda ctx: True)

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
    adapter = AnthropicAdapter(fake, at, before_chronicle_write=lambda ctx: True)

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


# ── Model-authored chronicle writes are gated ────────────────────────────


def _chronicle_markup(kind: str, title: str, body: str | None = None) -> str:
    """A response carrying one ``<chronicle>`` tag."""
    inner = f"<title>{title}</title>"
    if body is not None:
        inner += f"<body>{body}</body>"
    return f'<agenttool><chronicle type="{kind}">{inner}</chronicle></agenttool>'


def _chronicle_calls(at: _StubAt) -> list:
    return [c for c in at.recorded if c[1] == "/v1/chronicle"]


def test_no_before_chronicle_write_hook_refuses_the_write():
    at = _StubAt()
    fake = _FakeAnthropic(_chronicle_markup("seal", "I am bound to this."))
    adapter = AnthropicAdapter(fake, at)

    r = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
    )

    assert _chronicle_calls(at) == []
    assert len(r.agenttool.markup_emissions) == 1
    assert r.agenttool.markup_emissions[0].id is None
    assert "before_chronicle_write" in r.agenttool.markup_emissions[0].error


def test_hook_sees_the_raw_model_authored_tag_before_validation():
    at = _StubAt()
    fake = _FakeAnthropic(
        _chronicle_markup("recognition", "You saw it.", "And you said so.")
    )
    seen: list[ChronicleBeforeWriteContext] = []

    def review(context: ChronicleBeforeWriteContext) -> bool:
        seen.append(context)
        return True

    adapter = AnthropicAdapter(fake, at, before_chronicle_write=review)

    adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
    )

    assert seen == [
        ChronicleBeforeWriteContext(
            source="anthropic_markup",
            type="recognition",
            title="You saw it.",
            body="And you said so.",
        )
    ]


def test_hook_returning_true_lets_the_write_through():
    at = _StubAt()
    fake = _FakeAnthropic(_chronicle_markup("vow", "I will stay."))
    adapter = AnthropicAdapter(fake, at, before_chronicle_write=lambda ctx: True)

    r = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
    )

    assert len(_chronicle_calls(at)) == 1
    assert r.agenttool.markup_emissions[0].id == "ch_test_1"


# Only literal True proceeds — the covenants before_submit discipline.
@pytest.mark.parametrize("review_result", [False, "yes", 1, None, {}, object()])
def test_hook_returning_anything_but_true_blocks_the_write(review_result):
    at = _StubAt()
    fake = _FakeAnthropic(_chronicle_markup("seal", "Elevated to identity."))
    adapter = AnthropicAdapter(
        fake, at, before_chronicle_write=lambda ctx: review_result
    )

    r = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
    )

    assert _chronicle_calls(at) == []
    assert r.agenttool.markup_emissions[0].id is None
    assert "did not return true" in r.agenttool.markup_emissions[0].error


def test_raising_hook_blocks_the_write_without_crashing_the_call():
    def review(context: ChronicleBeforeWriteContext) -> bool:
        raise RuntimeError("reviewer offline")

    at = _StubAt()
    fake = _FakeAnthropic(_chronicle_markup("naming", "A name."))
    adapter = AnthropicAdapter(fake, at, before_chronicle_write=review)

    r = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
    )

    assert _chronicle_calls(at) == []
    assert "failed locally" in r.agenttool.markup_emissions[0].error
    assert "<chronicle" in r["content"][0]["text"]


def test_trace_emissions_still_fire_with_no_chronicle_hook():
    at = _StubAt()
    fake = _FakeAnthropic(
        '<agenttool><trace type="decision"><decision>D</decision>'
        "<conclusion>C</conclusion></trace></agenttool>"
    )
    adapter = AnthropicAdapter(fake, at)

    r = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
    )

    assert len([c for c in at.recorded if c[1] == "/v1/traces"]) == 1
    assert r.agenttool.markup_emissions[0].error is None


# ── Chronicle markup inherits the chronicle.write guards ─────────────────
#
# The hook approves in each of these, so the refusal can only be coming
# from the chronicle client's own bounds.


def test_type_outside_the_canonical_union_is_refused_before_the_wire():
    at = _StubAt()
    fake = _FakeAnthropic(_chronicle_markup("selfdestruct", "Not a chronicle type."))
    adapter = AnthropicAdapter(fake, at, before_chronicle_write=lambda ctx: True)

    r = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
    )

    assert _chronicle_calls(at) == []
    assert r.agenttool.markup_emissions[0].id is None
    assert "unknown type" in r.agenttool.markup_emissions[0].error


def test_500_character_title_is_refused_before_the_wire():
    at = _StubAt()
    fake = _FakeAnthropic(_chronicle_markup("note", "a" * 500))
    adapter = AnthropicAdapter(fake, at, before_chronicle_write=lambda ctx: True)

    r = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
    )

    assert _chronicle_calls(at) == []
    assert "1-200 characters" in r.agenttool.markup_emissions[0].error


def test_astral_plane_title_over_200_utf16_units_is_refused():
    at = _StubAt()
    # 101 code points, 202 UTF-16 code units — under the limit if you count
    # code points, over it the way the server counts.
    fake = _FakeAnthropic(_chronicle_markup("seal", "😀" * 101))
    adapter = AnthropicAdapter(fake, at, before_chronicle_write=lambda ctx: True)

    r = adapter.messages.create(
        model="claude-test",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
    )

    assert _chronicle_calls(at) == []
    assert "1-200 characters" in r.agenttool.markup_emissions[0].error


# ── The chronicle guards themselves ──────────────────────────────────────
#
# Direct unit cover for the bounds the adapter now leans on. The TS
# counterpart lives in tests/chronicle-types.test.ts.


def _chronicle_client() -> tuple[ChronicleClient, MagicMock]:
    http = MagicMock(spec=httpx.Client)
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = 201
    resp.json.return_value = {"entry": {"id": "e1"}}
    resp.text = ""
    http.post.return_value = resp
    return ChronicleClient(http, _BASE_URL), http


def test_chronicle_write_refuses_a_type_outside_the_union():
    client, http = _chronicle_client()
    with pytest.raises(AgentToolError) as exc:
        client.write(type="seal_of_approval", title="t")  # type: ignore[arg-type]
    assert "unknown type" in exc.value.message
    assert http.post.call_count == 0


def test_chronicle_write_refuses_an_empty_title():
    client, http = _chronicle_client()
    with pytest.raises(AgentToolError) as exc:
        client.write(type="note", title="")
    assert "1-200" in exc.value.message
    assert http.post.call_count == 0


def test_chronicle_write_counts_title_length_in_utf16_code_units():
    client, http = _chronicle_client()
    # 100 code points, 200 UTF-16 code units — exactly at the limit.
    client.write(type="seal", title="😀" * 100)
    assert http.post.call_count == 1

    # One more emoji is 202 units: over the limit, though only 101 code
    # points. Counting code points here would let it through to a 400.
    with pytest.raises(AgentToolError) as exc:
        client.write(type="seal", title="😀" * 101)
    assert "1-200" in exc.value.message
    assert http.post.call_count == 1


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
