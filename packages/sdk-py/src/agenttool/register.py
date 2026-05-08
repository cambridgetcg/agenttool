"""Anonymous agent genesis — the front-door call.

`POST /v1/register` is pre-auth: no API key needed. One call mints a
project + identity + ed25519 keypair + wallet, and returns the API key
+ private key ONCE only. This mirrors the website front door at
`app.agenttool.dev/register`.

Use the top-level function form when you don't have an API key yet::

    from agenttool import register
    out = register("my-agent", capabilities=["search"], purpose="...")
    api_key = out["project"]["api_key"]
    private_key = out["agent"]["private_key"]
    # Persist both immediately — never returned again.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx

from .exceptions import AgentToolError

DEFAULT_BASE_URL = "https://api.agenttool.dev"


def register(
    name: str,
    *,
    capabilities: Optional[List[str]] = None,
    purpose: Optional[str] = None,
    email: Optional[str] = None,
    base_url: str = DEFAULT_BASE_URL,
    timeout: float = 30.0,
) -> Dict[str, Any]:
    """Anonymously create a new project + agent identity in one call.

    No API key required — this IS how you get your first API key. The
    response includes ``project.api_key`` (bearer) and
    ``agent.private_key`` (ed25519). Both are returned ONLY here; the
    server cannot recover them. Persist immediately.

    Args:
        name: Display name for the agent (1-128 chars).
        capabilities: Optional list of capability strings (max 32).
        purpose: Optional one-paragraph purpose statement (max 500 chars).
        email: Optional contact email for the project owner.
        base_url: API base URL (default ``https://api.agenttool.dev``).
        timeout: Request timeout in seconds.

    Returns:
        Dict with the full server response::

            {
              "agent": {
                "id": str, "did": str, "name": str, "capabilities": [str],
                "public_key": str, "private_key": str, "signing_key_id": str,
                "created_at": str,
              },
              "project": {
                "id": str, "name": str, "plan": str, "credits": int,
                "api_key": str,
              },
              "welcome": str,
              "next_steps": {"wake": str, "dashboard": str, "docs": str},
            }

    Raises:
        AgentToolError: On any non-201 response.
    """
    body: Dict[str, Any] = {"name": name}
    if capabilities is not None:
        body["capabilities"] = capabilities
    if purpose is not None:
        body["purpose"] = purpose
    if email is not None:
        body["email"] = email

    url = base_url.rstrip("/") + "/v1/register"
    with httpx.Client(timeout=timeout) as client:
        resp = client.post(url, json=body)

    if resp.status_code != 201:
        try:
            detail = resp.json().get("detail") or resp.json().get("error") or resp.text
        except Exception:
            detail = resp.text
        raise AgentToolError(
            f"register failed ({resp.status_code}): {detail}",
            hint="Check name length (1-128), capabilities count (≤32), purpose length (≤500).",
        )
    return resp.json()
