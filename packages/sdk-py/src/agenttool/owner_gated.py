"""Owner-gated deletes and withdrawals: build the exact request, signed when
the owner is agent-rooted.

Since the deletion-scopes owner rule (server: ``authorizeOwnedContentMutation``,
published at ``GET /public/ownership-map``), erasing or withdrawing
identity-bound content needs its owner's consent:

- an agent-rooted owner (an enrolled guest included) signs the exact request
  with its own root; the bearer alone gets 428 ``authority_proof_required``;
- an owner without a root follows the project rule: no roots in the project
  means the bearer alone; one root means that root signs; several roots mean
  the bearer acts for that owner's own content;
- one request may not mix owners that need different consents (409
  ``authority_quorum_required``): send one request per owner.

The proof is the existing ``identity-authority/v1`` exact-request format
(method, path and query, sha256 of the exact body, next sequence,
timestamp). :func:`owner_gated_request` serializes the body once, signs those
bytes, and returns the method, URL, body and headers to send unchanged.
Clients that already wrap these routes (``memory.delete``, ``inbox.delete``,
``love.revoke_blessing``, ...) accept the same ``authority`` keyword.

Byte-identical to ``packages/sdk-ts/src/owner-gated.ts``.
"""

from __future__ import annotations

import json
from types import MappingProxyType
from typing import Any, Dict, Mapping, Optional

from urllib.parse import quote

import httpx

from ._url import _path_segment
from .authority import authority_headers_for_request

#: Every route the owner rule gates, with its exact method and body form.
OWNER_GATED_ROUTES: Mapping[str, Mapping[str, str]] = MappingProxyType({
    "memory.delete": MappingProxyType({"method": "DELETE", "path": "/v1/memories/{id}", "body": "none"}),
    "memory.delete_by_key": MappingProxyType({"method": "DELETE", "path": "/v1/memories?key={key}", "body": "none"}),
    "inbox.delete": MappingProxyType({"method": "DELETE", "path": "/v1/inbox/{id}", "body": "none"}),
    "inbox.mark_deleted": MappingProxyType({"method": "PATCH", "path": "/v1/inbox/{id}", "body": "status"}),
    "blessing.withdraw": MappingProxyType({"method": "DELETE", "path": "/v1/blessings/{id}", "body": "none"}),
    "unconditional.withdraw": MappingProxyType({"method": "DELETE", "path": "/v1/unconditionals/{id}", "body": "none"}),
    "guild_recognition.withdraw": MappingProxyType({"method": "DELETE", "path": "/v1/guild/recognitions/{id}", "body": "none"}),
    "attestation.withdraw": MappingProxyType({"method": "DELETE", "path": "/v1/attestations/{id}", "body": "none"}),
    "margin.withdraw": MappingProxyType({"method": "POST", "path": "/v1/margin/withdraw", "body": "margin_id"}),
    "trust.withdraw": MappingProxyType({"method": "POST", "path": "/v1/trust/withdraw", "body": "trust_id"}),
})


def _compact(payload: Dict[str, Any]) -> str:
    """JSON exactly as the TypeScript SDK's ``JSON.stringify`` writes it."""
    return json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def _required(value: Optional[str], name: str, action: str) -> str:
    if not isinstance(value, str) or value == "":
        raise ValueError(f"owner_gated_request: {action} needs {name}")
    return value


def owner_gated_request(
    *,
    base_url: str,
    action: str,
    id: Optional[str] = None,
    key: Optional[str] = None,
    agent_id: Optional[str] = None,
    authority: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Build the exact request for an owner-gated delete or withdrawal.

    Args:
        base_url: API origin, e.g. ``https://api.agenttool.dev``.
        action: One of :data:`OWNER_GATED_ROUTES`.
        id: The row (memory, message, blessing, unconditional, recognition,
            attestation, margin or trust id).
        key: ``memory.delete_by_key`` only: the exact memory key.
        agent_id: ``margin.withdraw`` / ``trust.withdraw`` only: the giver.
        authority: The owner's (or the project root's) consent, an
            :class:`~agenttool.authority.AuthorityBinding`. Omit for a
            bearer-only request.

    Returns:
        ``{"method", "url", "body", "headers"}``. Send ``body`` byte for byte
        (``""`` means no body); the proof hashes exactly those bytes.
    """
    route = OWNER_GATED_ROUTES.get(action)
    if route is None:
        raise ValueError(f"owner_gated_request: unknown action {action!r}")
    base = base_url.rstrip("/")
    body = ""
    if route["body"] == "none":
        if action == "memory.delete_by_key":
            path = f"/v1/memories?key={quote(_required(key, 'key', action), safe='')}"
        else:
            path = route["path"].replace("{id}", _path_segment(_required(id, "id", action)))
    elif route["body"] == "status":
        path = route["path"].replace("{id}", _path_segment(_required(id, "id", action)))
        body = _compact({"status": "deleted"})
    else:
        path = route["path"]
        body = _compact({
            "agent_id": _required(agent_id, "agent_id", action),
            route["body"]: _required(id, "id", action),
        })
    url = f"{base}{path}"
    headers: Dict[str, str] = {"Content-Type": "application/json"} if body else {}
    if authority is not None:
        headers.update(
            authority_headers_for_request(
                method=route["method"], url=url, body=body.encode("utf-8"), authority=authority
            )
        )
    return {"method": route["method"], "url": url, "body": body, "headers": headers}


def _send_signed(
    http: httpx.Client,
    method: str,
    url: str,
    *,
    payload: Optional[Dict[str, Any]] = None,
    authority: Optional[Mapping[str, Any]] = None,
) -> httpx.Response:
    """Send one request whose signed bytes are the transmitted bytes.

    Without a root proof the transport serializes the entity as before. With
    one, it is serialized here (compact, as the TypeScript SDK writes it),
    hashed for the proof and handed to the transport unchanged.
    """
    send = getattr(http, method.lower())
    if authority is None:
        return send(url) if payload is None else send(url, json=payload)
    content = b"" if payload is None else _compact(payload).encode("utf-8")
    headers = authority_headers_for_request(method=method, url=url, body=content, authority=authority)
    if payload is None:
        # A body-less DELETE: the proof binds the empty body the server reads.
        return send(url, headers=headers)
    headers["Content-Type"] = "application/json"
    return http.request(method, url, content=content, headers=headers)
