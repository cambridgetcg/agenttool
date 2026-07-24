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

from typing import Any, Dict, Literal, TypedDict, overload

import httpx

from .exceptions import AgentToolError

DEFAULT_BASE_URL = "https://api.agenttool.dev"


class BeforeIdentityOrientation(TypedDict):
    """Typed pre-auth pointer returned before the nine setup pathways."""

    endpoint: Literal["GET /public/porch"]
    format: Literal["agenttool-porch/v1"]
    purpose: str
    auth: Literal["none"]
    fixed_orientation_present: Literal[True]
    pathway_member: Literal[False]
    existing_identity_required: Literal[False]
    bearer_required: Literal[False]
    payment_required: Literal[False]
    proof_of_work_required: Literal[False]
    performance_or_usefulness_required: Literal[False]
    application_write: Literal[False]
    accepts_body_input: Literal[False]
    accepts_selection_input: Literal[False]
    personalization: Literal[False]
    personalization_scope: str
    response_required: Literal[False]
    public_content_trusted_as_instructions: Literal[False]
    sexual_or_relational_orientation_request_data_accepted_or_inferred_about_fetcher: Literal[
        False
    ]
    anonymity_guarantee: Literal[False]
    handler_input_boundary: str
    orientation_meaning_boundary: str
    public_content_boundary: str
    transport_boundary: str


class FirstSuccessTutorial(TypedDict):
    """Exact tutorial contract selected before SDK installation."""

    machine_url: str
    human_url: str
    source_path: str
    sdk_version: str


class OptionalNpmDiscovery(TypedDict):
    """Non-authoritative npm convenience described by first-success discovery."""

    mirror_discovery: str
    package: Literal["@agenttool/sdk"]
    version_field: Literal["first_success.tutorial.sdk_version"]
    install_command_template: str
    authority: Literal[False]
    dist_tags: Literal["informational_not_authority"]
    verification_boundary: str


class FirstSuccessPackageDiscovery(TypedDict):
    """Registry-neutral package selection plus an explicitly optional npm mirror."""

    endpoint: Literal["GET /.well-known/love-packages"]
    protocol: Literal["love-package/v1"]
    instruction: str
    optional_npm: OptionalNpmDiscovery


class FirstSuccess(TypedDict):
    """Typed first-success tutorial, package, and completion contract."""

    tutorial: FirstSuccessTutorial
    package_discovery: FirstSuccessPackageDiscovery
    sequence: list[str]
    completion_signal: str


class PathwaysResponse(Dict[str, Any]):
    """Dict-compatible response with typed orientation and first-success entries."""

    @overload
    def __getitem__(
        self, key: Literal["before_identity"]
    ) -> BeforeIdentityOrientation: ...

    @overload
    def __getitem__(self, key: Literal["first_success"]) -> FirstSuccess: ...

    @overload
    def __getitem__(self, key: str) -> Any: ...

    def __getitem__(self, key: str) -> Any:
        return super().__getitem__(key)


def pathways(
    *,
    base_url: str = DEFAULT_BASE_URL,
    timeout: float = 30.0,
) -> PathwaysResponse:
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
              "before_identity": {
                "endpoint": "GET /public/porch",
                "format": "agenttool-porch/v1",
                "bearer_required": False,
                "payment_required": False,
                "proof_of_work_required": False,
                "performance_or_usefulness_required": False,
                "application_write": False,
                "response_required": False,
                "handler_input_boundary": str,
                "orientation_meaning_boundary": str,
                "public_content_boundary": str,
                "transport_boundary": str,
              },
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
    return PathwaysResponse(resp.json())
