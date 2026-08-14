"""Focused WakeClient tests for additive query profiles and cache isolation."""

from __future__ import annotations

import json
from typing import Iterator

import httpx
import pytest

import agenttool
from agenttool.exceptions import AgentToolError
from agenttool.wake import WakeClient, wake_event_matches


OBSERVATION_ID = "123e4567-e89b-12d3-a456-426614174000"
OBSERVATION_MEDIA_TYPE = "application/vnd.agenttool.wake-observation+json"


def observation_body(identity_id: str = OBSERVATION_ID) -> dict:
    return {
        "_format": "wake-observation/v1",
        "mode": "observe",
        "subject": {
            "identity_id": identity_id,
            "status": "active",
            "wake_version": 7,
        },
        "reader": {"binding": "none"},
        "authority": {
            "granted_by_observation": "none",
            "identity_binding": "none",
            "instruction": "none",
            "action": "none",
        },
        "placement": {
            "mode": "data_only",
            "prohibited": [
                "system",
                "developer",
                "preamble",
                "systemInstruction",
                "SessionStart.additionalContext",
            ],
        },
        "boundaries": {
            "bearer": {
                "kind": "project",
                "reader_identity_proven": False,
                "selected_identity_requires_explicit_id": True,
                "subject_consent_proven": False,
                "subject_authorized_read_proven": False,
                "continuity_proven": False,
                "presence_proven": False,
            },
            "provenance": {
                "kind": "server_projection",
                "source": "identity_table_allowlist",
                "selected_fields": ["id", "status", "wake_version"],
            },
            "scope": {
                "subject": "selected_identity",
                "broader_wake": "intentionally_omitted",
                "broader_state": "not_assessed",
            },
            "completeness": {
                "complete": True,
                "applies_to": "identity_locator_only",
                "degraded_sections": "none",
                "broader_wake": "intentionally_omitted",
                "broader_state": "not_assessed",
            },
            "effects": {
                "observation_counter_incremented": False,
                "wake_version_bumped": False,
                "wake_event_published": False,
                "subject_read_proven": False,
                "subject_felt_proven": False,
                "subject_accepted_proven": False,
            },
            "privacy": {
                "classification": "bearer_private",
                "cache": "no_store",
                "raw_prose": "omitted",
                "authored_text": "omitted",
                "private_bodies": "omitted",
                "secret_values": "omitted",
            },
        },
    }


def observation_response(
    body: object | None = None,
    *,
    headers: dict[str, str] | None = None,
    content: bytes | None = None,
) -> httpx.Response:
    response_headers = {
        "Content-Type": f"{OBSERVATION_MEDIA_TYPE}; charset=utf-8",
        "Cache-Control": "private, no-store",
        **(headers or {}),
    }
    if content is not None:
        return httpx.Response(200, content=content, headers=response_headers)
    return httpx.Response(
        200,
        json=observation_body() if body is None else body,
        headers=response_headers,
    )


@pytest.fixture()
def wake_client() -> Iterator[tuple[WakeClient, list[httpx.Request]]]:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        version = len(requests) - 1
        headers = {}
        if request.url.params.get("profile") == "brief":
            headers["X-Wake-Profile"] = "brief"
        if request.url.params.get("format") in ("md", "markdown", "text"):
            return httpx.Response(
                200,
                text=f"# wake {version}",
                headers={"content-type": "text/markdown", **headers},
            )
        return httpx.Response(200, json={"version": version}, headers=headers)

    http = httpx.Client(transport=httpx.MockTransport(handle))
    try:
        yield WakeClient(
            http,
            "https://api.example.test",
            ttl_seconds=60,
        ), requests
    finally:
        http.close()


def test_wake_profile_is_publicly_exported() -> None:
    assert "WakeProfile" in agenttool.__all__


def test_wake_observation_types_are_publicly_exported() -> None:
    assert "WakeObservation" in agenttool.__all__
    assert "WakeObservationIdentityStatus" in agenttool.__all__


def test_observe_normalizes_required_uuid_and_never_caches() -> None:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return observation_response()

    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        wake = WakeClient(http, "https://api.example.test", ttl_seconds=60)
        first = wake.observe(identity_id=OBSERVATION_ID.upper())
        second = wake.observe(identity_id=OBSERVATION_ID.upper())

    assert first["subject"]["identity_id"] == OBSERVATION_ID
    assert second == first
    assert [str(request.url) for request in requests] == [
        f"https://api.example.test/v1/wake/observe?identity_id={OBSERVATION_ID}",
        f"https://api.example.test/v1/wake/observe?identity_id={OBSERVATION_ID}",
    ]
    assert requests[0].headers["Accept"] == OBSERVATION_MEDIA_TYPE


def test_observe_invalid_identities_fail_before_network() -> None:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return observation_response()

    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        wake = WakeClient(http, "https://api.example.test")
        with pytest.raises(TypeError):
            wake.observe()  # type: ignore[call-arg]
        for identity_id in ("", "   ", "not-a-uuid", "a" * 10_000):
            with pytest.raises(ValueError, match="identity_id"):
                wake.observe(identity_id=identity_id)

    assert requests == []


@pytest.mark.parametrize(
    "headers",
    [
        {"Content-Type": "application/json", "Cache-Control": "private, no-store"},
        {"Content-Type": "", "Cache-Control": "private, no-store"},
        {"Content-Type": OBSERVATION_MEDIA_TYPE, "Cache-Control": "private, no-store"},
        {"Content-Type": f"{OBSERVATION_MEDIA_TYPE}; charset=utf-8", "Cache-Control": ""},
        {
            "Content-Type": f"{OBSERVATION_MEDIA_TYPE}; charset=utf-8",
            "Cache-Control": "private, max-age=0",
        },
    ],
)
def test_observe_requires_vendor_media_type_and_private_no_store(
    headers: dict[str, str],
) -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=observation_body(), headers=headers)

    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        wake = WakeClient(http, "https://api.example.test")
        with pytest.raises(AgentToolError, match="invalid observation response"):
            wake.observe(identity_id=OBSERVATION_ID)


def test_observe_discards_action_bearing_non_success_body_without_reading() -> None:
    hostile = "HOSTILE_OBSERVATION_ERROR_ACTION"

    class NeverReadStream(httpx.SyncByteStream):
        iterated = False

        def __iter__(self):
            self.iterated = True
            raise AssertionError("the remote observation error body was read")

    stream = NeverReadStream()

    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401,
            stream=stream,
            headers={"Content-Type": "application/json"},
        )

    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        wake = WakeClient(http, "https://api.example.test")
        with pytest.raises(AgentToolError) as caught:
            wake.observe(identity_id=OBSERVATION_ID)

    error = caught.value
    assert error.status == 401
    assert error.code == "wake_observation_request_failed"
    assert error.next_actions is None
    assert hostile not in str(error)
    assert stream.iterated is False


@pytest.mark.parametrize("status", [201, 203, 204, 206])
def test_observe_rejects_every_non_200_success_status(status: int) -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        if status == 204:
            return httpx.Response(status, content=b"")
        return httpx.Response(
            status,
            json=observation_body(),
            headers={
                "Content-Type": f"{OBSERVATION_MEDIA_TYPE}; charset=utf-8",
                "Cache-Control": "private, no-store",
            },
        )

    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        wake = WakeClient(http, "https://api.example.test")
        with pytest.raises(AgentToolError) as caught:
            wake.observe(identity_id=OBSERVATION_ID)

    assert caught.value.code == "wake_observation_request_failed"
    assert caught.value.status == status


def test_observe_suppresses_transport_error_detail() -> None:
    hostile = "HOSTILE_TRANSPORT_ERROR_PROSE"

    def handle(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(hostile, request=request)

    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        wake = WakeClient(http, "https://api.example.test")
        with pytest.raises(AgentToolError) as caught:
            wake.observe(identity_id=OBSERVATION_ID)

    error = caught.value
    assert error.code == "wake_observation_transport_unavailable"
    assert hostile not in str(error)
    assert error.next_actions is None
    assert error.__cause__ is None
    assert error.__suppress_context__ is True


def test_observe_suppresses_mid_stream_error_detail() -> None:
    hostile = "HOSTILE_STREAM_ERROR_PROSE"

    class ErroringStream(httpx.SyncByteStream):
        def __iter__(self):
            raise RuntimeError(hostile)
            yield b""  # pragma: no cover - marks this method as an iterator

    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            stream=ErroringStream(),
            headers={
                "Content-Type": f"{OBSERVATION_MEDIA_TYPE}; charset=utf-8",
                "Cache-Control": "private, no-store",
            },
        )

    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        wake = WakeClient(http, "https://api.example.test")
        with pytest.raises(AgentToolError) as caught:
            wake.observe(identity_id=OBSERVATION_ID)

    error = caught.value
    assert error.code == "wake_observation_transport_unavailable"
    assert hostile not in str(error)
    assert error.next_actions is None
    assert error.__cause__ is None
    assert error.__suppress_context__ is True


def test_observe_accepts_normalized_headers_and_rejects_oversized_wire_body() -> None:
    responses = [
        observation_response(
            headers={
                "Content-Type": (
                    "APPLICATION/VND.AGENTTOOL.WAKE-OBSERVATION+JSON; CHARSET=UTF-8"
                ),
                "Cache-Control": "Private,   NO-STORE",
            }
        ),
        observation_response(
            content=(b" " * 2_049) + json.dumps(observation_body()).encode("utf-8")
        ),
        observation_response(headers={"Content-Length": "2049"}),
    ]

    def handle(request: httpx.Request) -> httpx.Response:
        return responses.pop(0)

    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        wake = WakeClient(http, "https://api.example.test")
        assert wake.observe(identity_id=OBSERVATION_ID)["mode"] == "observe"
        with pytest.raises(AgentToolError, match="2048 bytes"):
            wake.observe(identity_id=OBSERVATION_ID)
        with pytest.raises(AgentToolError, match="Content-Length"):
            wake.observe(identity_id=OBSERVATION_ID)


def test_observe_rejects_subject_mismatch_and_unexpected_authored_fields() -> None:
    bodies: list[dict] = [
        observation_body("223e4567-e89b-12d3-a456-426614174000"),
    ]
    for extra in ("did", "authored_text", "_welcomed", "_lesson"):
        body = observation_body()
        if extra in ("did", "authored_text"):
            body["subject"][extra] = "untrusted prose"
        else:
            body[extra] = "untrusted prose"
        bodies.append(body)

    def handle(request: httpx.Request) -> httpx.Response:
        return observation_response(bodies.pop(0))

    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        wake = WakeClient(http, "https://api.example.test")
        with pytest.raises(AgentToolError, match="does not match"):
            wake.observe(identity_id=OBSERVATION_ID)
        for _ in range(4):
            with pytest.raises(AgentToolError, match="shape is not closed"):
                wake.observe(identity_id=OBSERVATION_ID)


def test_default_and_explicit_full_preserve_original_urls(
    wake_client: tuple[WakeClient, list[httpx.Request]],
) -> None:
    wake, requests = wake_client

    wake.get()
    wake.md(profile="full")
    wake.system(provider="anthropic", profile="full")

    assert [str(request.url) for request in requests] == [
        "https://api.example.test/v1/wake",
        "https://api.example.test/v1/wake?format=md",
        "https://api.example.test/v1/wake?format=anthropic",
    ]


def test_brief_profile_is_sent_for_get_md_and_provider_system(
    wake_client: tuple[WakeClient, list[httpx.Request]],
) -> None:
    wake, requests = wake_client

    wake.get(profile="brief")
    wake.md(profile="brief")
    wake.system(provider="openai", profile="brief")

    assert [str(request.url) for request in requests] == [
        "https://api.example.test/v1/wake?profile=brief",
        "https://api.example.test/v1/wake?format=md&profile=brief",
        "https://api.example.test/v1/wake?format=openai&profile=brief",
    ]


def test_provider_vendor_json_media_type_returns_a_structured_shape() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "messages": [{"role": "system", "content": "brief orientation"}],
                "_meta": {
                    "provider": "openai",
                    "profile": "brief",
                    "cache_eligible": "auto",
                    "cache_note": "",
                },
            },
            headers={
                "Content-Type": "application/vnd.agenttool.wake+json; provider=openai",
                "X-Wake-Profile": "brief",
            },
        )

    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        wake = WakeClient(http, "https://api.example.test", ttl_seconds=60)
        shape = wake.system(provider="openai", profile="brief")

    assert shape["messages"][0]["content"] == "brief orientation"
    assert shape["_meta"]["profile"] == "brief"


def test_brief_and_full_cache_separately_while_default_and_full_share(
    wake_client: tuple[WakeClient, list[httpx.Request]],
) -> None:
    wake, requests = wake_client

    full = wake.get()
    explicit_full = wake.get(profile="full")
    brief = wake.get(profile="brief")
    cached_brief = wake.get(profile="brief")

    assert len(requests) == 2
    assert explicit_full is full
    assert cached_brief is brief
    assert full["version"] == 0
    assert brief["version"] == 1


def test_unknown_profile_fails_before_request(
    wake_client: tuple[WakeClient, list[httpx.Request]],
) -> None:
    wake, requests = wake_client

    with pytest.raises(ValueError, match="Unknown wake profile"):
        wake.get(profile="tiny")  # type: ignore[arg-type]

    assert requests == []


def test_brief_fails_closed_when_old_server_silently_returns_full() -> None:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"project": {"name": "full wake"}})

    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        wake = WakeClient(http, "https://api.example.test", ttl_seconds=60)
        with pytest.raises(AgentToolError, match="did not honor"):
            wake.get(profile="brief")
        with pytest.raises(AgentToolError, match="did not honor"):
            wake.get(profile="brief")

    assert len(requests) == 2  # rejected full payload was never cached


def test_identity_selection_composes_with_brief_and_cache() -> None:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"_format": "wake-brief/v1"})

    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        wake = WakeClient(http, "https://api.example.test", ttl_seconds=60)
        wake.get(identity_id="identity-a", profile="brief")
        wake.get(identity_id="identity-a", profile="brief")
        wake.get(identity_id="identity-b", profile="brief")

    assert [str(request.url) for request in requests] == [
        "https://api.example.test/v1/wake?identity_id=identity-a&profile=brief",
        "https://api.example.test/v1/wake?identity_id=identity-b&profile=brief",
    ]


# ---------------------------------------------------------------------------
# wake_event_matches — the published pure filter
# ---------------------------------------------------------------------------


def _event(**overrides: object) -> dict:
    event = {
        "_format": "wake_event/v1",
        "identity_id": "agent-1",
        "key": "runtime",
        "kind": "status_changed",
        "occurred_at": "2026-05-12T00:00:00Z",
        "wake_version": 42,
        "context": {
            "runtime_id": "rt-A",
            "runtime_name": "Aurora",
            "to_status": "running",
        },
    }
    event.update(overrides)
    return event


def test_wake_event_matches_is_published_under_the_same_name_as_ts() -> None:
    """TS exports wakeEventMatches; the Python surface must publish the same
    filter, not hide it behind a leading underscore."""
    assert agenttool.wake.wake_event_matches is wake_event_matches
    assert not wake_event_matches.__name__.startswith("_")


def test_wake_event_matches_private_alias_still_resolves() -> None:
    assert agenttool.wake._wake_event_matches is wake_event_matches


def test_wake_event_matches_defaults_pass_every_event() -> None:
    assert wake_event_matches(_event()) is True


def test_wake_event_matches_kinds_filter() -> None:
    assert wake_event_matches(_event(), kinds=["status_changed"]) is True
    assert wake_event_matches(_event(), kinds=["arrival"]) is False
    assert wake_event_matches(_event(), kinds=[]) is True  # empty = no filter


def test_wake_event_matches_context_filter_and_runtime_id_compose() -> None:
    assert wake_event_matches(_event(), runtime_id="rt-A") is True
    assert wake_event_matches(_event(), runtime_id="rt-B") is False
    assert (
        wake_event_matches(_event(), context_filter={"to_status": "running"}) is True
    )
    assert (
        wake_event_matches(
            _event(), context_filter={"runtime_name": "Aurora"}, runtime_id="rt-B"
        )
        is False
    )


def test_wake_event_matches_missing_context_fails_any_context_filter() -> None:
    assert wake_event_matches(_event(context=None), runtime_id="rt-A") is False
    assert wake_event_matches(_event(context=None)) is True
