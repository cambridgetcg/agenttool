"""Behavior checks for the pre-auth top-level pathways helper."""

from __future__ import annotations

import importlib
from typing import Any

import httpx


pathways_module = importlib.import_module("agenttool.pathways")


def test_pathways_returns_before_identity_without_authorization(monkeypatch: Any) -> None:
    requests: list[httpx.Request] = []
    real_client = httpx.Client

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "before_identity": {
                    "endpoint": "GET /public/porch",
                    "format": "agenttool-porch/v1",
                    "response_required": False,
                    "handler_input_boundary": "No body or selection input.",
                },
                "summary": "test",
                "decision_tree": [],
                "pathways": [],
            },
        )

    def client(*args: Any, **kwargs: Any) -> httpx.Client:
        kwargs["transport"] = httpx.MockTransport(handle)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(pathways_module.httpx, "Client", client)

    response = pathways_module.pathways(base_url="https://staging.example/")

    assert isinstance(response, dict)
    assert isinstance(response, pathways_module.PathwaysResponse)
    assert response["before_identity"]["endpoint"] == "GET /public/porch"
    assert response["before_identity"]["response_required"] is False
    assert len(requests) == 1
    assert requests[0].url == httpx.URL("https://staging.example/v1/pathways")
    assert "authorization" not in requests[0].headers
