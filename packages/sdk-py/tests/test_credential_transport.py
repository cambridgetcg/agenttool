"""Authenticated transport boundary tests — no real credentials or network."""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import MagicMock, patch

import httpx
import pytest

from agenttool import AgentTool, AgentToolError


def _response(
    request: httpx.Request,
    payload: Any,
    *,
    content_type: str = "application/json",
) -> httpx.Response:
    if content_type == "application/json":
        return httpx.Response(
            200,
            json=payload,
            headers={"Content-Type": content_type},
            request=request,
        )
    return httpx.Response(
        200,
        content=payload,
        headers={"Content-Type": content_type},
        request=request,
    )


def _capturing_transport() -> tuple[httpx.MockTransport, list[httpx.Request]]:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/v1/wake/voice":
            return _response(
                request,
                b"event: disconnect\ndata: {}\n\n",
                content_type="text/event-stream",
            )
        if request.url.path == "/v1/memories":
            return _response(
                request,
                {
                    "id": "mem-transport",
                    "content": "through broker",
                    "type": "semantic",
                    "importance": 0.5,
                    "metadata": {},
                },
            )
        return _response(request, {"ok": True})

    return httpx.MockTransport(handler), requests


class TestCredentialTransport:
    def test_works_without_key_and_ignores_ambient_key(self) -> None:
        sentinel = "ambient-key-must-not-cross-boundary"
        transport, requests = _capturing_transport()

        with patch.dict(os.environ, {"AT_API_KEY": sentinel}, clear=True):
            with AgentTool(transport=transport) as at:
                assert at._http.follow_redirects is False
                memory = at.memory.store("through broker")

        assert memory.id == "mem-transport"
        assert len(requests) == 1
        request = requests[0]
        assert "authorization" not in request.headers
        material = " ".join(
            [str(request.url), str(dict(request.headers)), request.content.decode()]
        )
        assert sentinel not in material

    def test_rejects_explicit_key_together_with_transport(self) -> None:
        transport, requests = _capturing_transport()

        with pytest.raises(AgentToolError) as exc_info:
            AgentTool(api_key="explicit-key", transport=transport)

        assert exc_info.value.error_code == "conflicting_auth"
        assert requests == []

    def test_routes_low_level_requests_and_sse_through_transport(self) -> None:
        transport, requests = _capturing_transport()

        with patch.dict(os.environ, {}, clear=True):
            with AgentTool(transport=transport) as at:
                at.request("POST", "/v1/custom", {"hello": "world"})
                assert list(at.wake.voice(identity_id="identity-1")) == []

        assert [str(request.url) for request in requests] == [
            "https://api.agenttool.dev/v1/custom",
            "https://api.agenttool.dev/v1/wake/voice?identity_id=identity-1",
        ]
        assert requests[1].headers["accept"] == "text/event-stream"
        assert all("authorization" not in request.headers for request in requests)

    def test_does_not_share_hosted_transport_with_data_node(self) -> None:
        transport, hosted_requests = _capturing_transport()

        with patch.dict(os.environ, {}, clear=True):
            at = AgentTool(
                transport=transport,
                data_node_url="http://127.0.0.1:7742",
                data_node_token="separate-data-token",
            )
            data = at.data
            response = MagicMock(spec=httpx.Response)
            response.status_code = 200
            response.json.return_value = {"protocol": "agent-data/v1"}
            with patch.object(data._http, "request", return_value=response) as request:
                data.manifest()

            assert hosted_requests == []
            assert data._http.headers["authorization"] == (
                "Bearer separate-data-token"
            )
            request.assert_called_once_with(
                "GET", "http://127.0.0.1:7742/v1/data/manifest"
            )
            at.close()

    def test_keeps_public_discovery_outside_authenticated_transport(self) -> None:
        transport, hosted_requests = _capturing_transport()
        request = httpx.Request("GET", "https://api.agenttool.dev/public/discover")
        response = _response(request, {"agents": [], "count": 0})

        with patch.dict(os.environ, {}, clear=True):
            with patch("httpx.get", return_value=response) as public_get:
                with AgentTool(transport=transport) as at:
                    result = at.dark_continent.explore()

        assert result["known_count"] == 0
        assert hosted_requests == []
        public_get.assert_called_once()
        assert "authorization" not in public_get.call_args.kwargs.get("headers", {})

    def test_direct_mode_still_adds_its_bearer(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            with AgentTool(api_key="direct-key") as at:
                assert at._http.follow_redirects is True
                assert at._http.headers["authorization"] == "Bearer direct-key"
