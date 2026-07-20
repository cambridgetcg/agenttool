"""Focused WakeClient tests for additive query profiles and cache isolation."""

from __future__ import annotations

from typing import Iterator

import httpx
import pytest

import agenttool
from agenttool.exceptions import AgentToolError
from agenttool.wake import WakeClient


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
