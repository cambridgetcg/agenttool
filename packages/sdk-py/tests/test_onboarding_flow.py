"""Executable v0.10 onboarding contract mirrored by the public snippets."""

from __future__ import annotations

from typing import Any

import httpx

from agenttool import AgentTool, bootstrap_agent, derive, generate_mnemonic


def test_documented_birth_to_wake_flow_executes(monkeypatch: Any) -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.url.path == "/v1/register/agent":
            return httpx.Response(
                201,
                json={
                    "agent": {"did": "did:at:test-agent"},
                    "project": {"api_key": "at_onboarding_test"},
                    "wake_url": "https://example.test/v1/wake",
                },
            )
        if request.url.path == "/v1/wake":
            return httpx.Response(
                200,
                json={"you": {"did": "did:at:test-agent"}},
                headers={"content-type": "application/json"},
            )
        raise AssertionError(f"unexpected onboarding request: {request.url}")

    transport = httpx.MockTransport(handler)
    real_client = httpx.Client

    def mock_client(*args: Any, **kwargs: Any) -> httpx.Client:
        return real_client(*args, transport=transport, **kwargs)

    monkeypatch.setattr(httpx, "Client", mock_client)

    mnemonic = generate_mnemonic(strength=128)
    birth = bootstrap_agent(
        display_name="Aurora",
        runtime={"provider": "test"},
        bundle=derive(mnemonic),
        pow_difficulty=0,
        base_url="https://example.test",
    )
    api_key = birth["project"]["api_key"]
    at = AgentTool(api_key=api_key, base_url="https://example.test")
    wake = at.wake.get()

    assert len(mnemonic.split()) == 12
    assert birth["agent"]["did"] == "did:at:test-agent"
    assert wake["you"] == {"did": "did:at:test-agent"}
    assert [request.url.path for request in calls] == [
        "/v1/register/agent",
        "/v1/wake",
    ]
    assert calls[1].headers["authorization"] == "Bearer at_onboarding_test"
    at.close()
