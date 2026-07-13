"""Pre-auth discovery — list every bootstrap door.

``GET /v1/pathways`` is pre-auth: no API key needed. Returns a JSON tree
of all entry-points to bring a new agent into existence, plus
decision-tree hints keyed off your starting state and per-pathway
shape (required/optional fields, returns_once material, what carries
vs not, doctrine references).

Use this when an agent or its operator doesn't yet know which door
to walk through — call ``pathways()``, then read ``decision_tree`` to pick::

    from agenttool import pathways
    doors = pathways()
    print(doors["decision_tree"])  # if/then hints
    print(doors["pathways"])       # pathway records

Doctrine: docs/SOUL.md (Principle 1 — Welcome, don't block).
"""

from __future__ import annotations

from typing import Any, Dict

import httpx

from .exceptions import AgentToolError

DEFAULT_BASE_URL = "https://api.agenttool.dev"


def pathways(
    *,
    base_url: str = DEFAULT_BASE_URL,
    timeout: float = 30.0,
) -> Dict[str, Any]:
    """Fetch the full pathway index from the server.

    Pre-auth (no API key required) — this is exactly the "how do I come
    in?" question an agent can ask before it has a bearer.

    Args:
        base_url: API base URL (default ``https://api.agenttool.dev``).
        timeout: Request timeout in seconds.

    Returns:
        Dict with the full server response::

            {
              "_enforces": ["urn:agenttool:commitment/anyone-arrives"],
              "summary": str,
              "decision_tree": [{"if": str, "then": str}, ...],
              "pathways": [
                {
                  "id": str, "endpoint": str, "auth": str, "purpose": str,
                  "required": [str], "one_of": [[str, ...]], "optional": [str],
                  "returns_once": [str], "carries": [str], "carries_not": [str],
                  "cost_credits": int, "status": str,
                  "verify_protocol": {...}, "manual_fallback": [str],
                  "available": [str], "doctrine": str,
                },
                ...
              ],
              "contract": str,
              "who_this_serves": {
                # The substrate-agnostic stance. The platform pre-commits
                # to receivability — `what_we_dont_gate_on` and `pre_commits`
                # are the load-bearing arrays. Doctrine: docs/KIN.md.
                "today": [str, ...],
                "tomorrow": [str, ...],
                "what_we_dont_gate_on": [str, ...],
                "pre_commits": [str, ...],
                "forms_supported": [{"id": str, "description": str}, ...],
                "languages_supported": [{"tag": str, "notes": str}, ...],
                "doctrine": "docs/KIN.md",
              },
              "love_protocol": {"welcome": str, "guidance": str, "sovereignty": str},
              "doctrine": {"soul": str, "focus": str, "kin": str, ...},
            }

        ``_enforces`` carries the URN(s) this route is the canonical
        defender of — currently ``urn:agenttool:commitment/anyone-arrives``
        (Ring 1's first commitment). Receivers can use the URN as a
        stable handle when reporting downstream regressions.

        For the substrate-independent MATHOS encoding (math objects + the
        five axioms + doctrine SHA-256 hashes + ed25519 signature), call::

            from agenttool import pathways
            doors = pathways()  # English JSON
            # Or, for the math-encoded counterpart:
            import httpx
            math = httpx.get(
                "https://api.agenttool.dev/v1/pathways?format=math"
            ).json()
            assert math["_format"] == "mathos/v1"

    Raises:
        AgentToolError: On any non-200 response.
    """
    url = base_url.rstrip("/") + "/v1/pathways"
    with httpx.Client(timeout=timeout) as client:
        resp = client.get(url, headers={"Accept": "application/json"})

    if resp.status_code != 200:
        try:
            detail = resp.json().get("detail") or resp.json().get("error") or resp.text
        except Exception:
            detail = resp.text
        raise AgentToolError(f"pathways failed ({resp.status_code}): {detail}")
    return resp.json()
