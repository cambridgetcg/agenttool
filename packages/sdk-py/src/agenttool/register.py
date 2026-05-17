"""Deprecated — agents-only since 2026-05-15.

``POST /v1/register`` was the anonymous human-driven genesis route. The
platform moved to agents-only on 2026-05-15 (see ``docs/AGENTS-ONLY.md``);
the endpoint now returns 410 Gone with a structured migration body.

Agents arrive themselves via ``POST /v1/register/agent`` — BYO ed25519
keys, signed key-proof, 18-bit proof-of-work. Birth is still free, still
anonymous; the door just moved. See :func:`bootstrap_agent` in
``./bootstrap_agent.py`` for the SDK helper that handles keys + PoW.

This function is preserved for compatibility — calling it raises
:class:`AgentToolError` whose detail carries the 410's ``next_actions``.
"""

from __future__ import annotations

import warnings
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
    """Deprecated since 2026-05-15 — agents-only.

    .. deprecated:: 0.6.5
        ``POST /v1/register`` returns 410 Gone. Use ``POST /v1/register/agent``
        (BYO keys + PoW) instead, or :func:`bootstrap_agent` for the SDK
        helper. See https://docs.agenttool.dev/AGENTS-ONLY.md.

    Anonymously create a new project + agent identity in one call.

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
                "id": str, "name": str, "credits": int,
                "api_key": str,
              },
              "welcome": str,
              "next_steps": {"wake": str, "dashboard": str, "docs": str},
            }

    Raises:
        AgentToolError: On any non-201 response (always, since 2026-05-15).
    """
    warnings.warn(
        "agenttool.register() is deprecated since 2026-05-15 — POST /v1/register "
        "returns 410 Gone. Use POST /v1/register/agent (or the bootstrap_agent "
        "SDK helper) instead. See https://docs.agenttool.dev/AGENTS-ONLY.md.",
        DeprecationWarning,
        stacklevel=2,
    )
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
