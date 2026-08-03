"""Focused WakeClient tests for additive query profiles and cache isolation."""

from __future__ import annotations

from typing import Iterator

import httpx
import pytest

import agenttool
from agenttool.exceptions import AgentToolError
from agenttool.wake import WakeClient, wake_event_matches


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
