"""Vault client for the agent-vault API (agent-vault.fly.dev)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx

from .exceptions import AgentToolError


class VaultClient:
    """Client for the agent-vault API — AES-256-GCM encrypted secrets.

    Usage::

        at = AgentTool()

        # Store a secret
        at.vault.put("openai-key", "sk-...")

        # Retrieve it
        secret = at.vault.get("openai-key")
        print(secret["value"])

        # List names (values never returned in list)
        names = at.vault.list()

        # Delete
        at.vault.delete("openai-key")

        # Version history
        versions = at.vault.versions("openai-key")

        # Audit log
        events = at.vault.audit("openai-key")

        # Set access policy
        at.vault.set_policy("openai-key", allowed_agents=["agent-1"], read_only=True)

        # Bulk retrieve
        secrets = at.vault.bulk(["openai-key", "db-url"])

        # Check existence
        exists = at.vault.check(["openai-key", "missing-key"])
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def _url(self, path: str) -> str:
        return f"{self._base}{path}"

    # ── Core CRUD ─────────────────────────────────────────────────────────────

    def put(
        self,
        name: str,
        value: str,
        *,
        description: Optional[str] = None,
        agent_ids: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
        ttl_seconds: Optional[int] = None,
        rotation_days: Optional[int] = None,
        agent_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Store or update a secret (AES-256-GCM encrypted at rest).

        Args:
            name: Secret name (slug-style, e.g. ``openai-key``).
            value: Plaintext secret value.
            description: Optional human-readable description.
            agent_ids: List of agent IDs allowed to access this secret.
            tags: Optional tags for organisation.
            ttl_seconds: Auto-expire after this many seconds.
            rotation_days: Flag for rotation after N days.
            agent_id: Pass ``X-Agent-Id`` header for audit trail.
        """
        payload: Dict[str, Any] = {"value": value}
        if description is not None:
            payload["description"] = description
        if agent_ids is not None:
            payload["agent_ids"] = agent_ids
        if tags is not None:
            payload["tags"] = tags
        if ttl_seconds is not None:
            payload["ttl_seconds"] = ttl_seconds
        if rotation_days is not None:
            payload["rotation_days"] = rotation_days

        headers = {}
        if agent_id is not None:
            headers["X-Agent-Id"] = agent_id

        resp = self._http.put(
            self._url(f"/v1/vault/{name}"), json=payload,
            headers=headers if headers else None,
        )
        if resp.status_code not in (200, 201):
            raise AgentToolError(f"vault.put failed: {resp.status_code}", hint=resp.text)
        return resp.json()

    def get(
        self,
        name: str,
        *,
        version: Optional[int] = None,
        agent_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Retrieve a secret's plaintext value.

        Args:
            name: Secret name.
            version: Retrieve a specific version (default: latest).
            agent_id: Pass ``X-Agent-Id`` header for audit trail.

        Returns dict with ``name``, ``value``, ``version``, ``description``, etc.
        """
        params: Dict[str, Any] = {}
        if version is not None:
            params["version"] = version

        headers = {}
        if agent_id is not None:
            headers["X-Agent-Id"] = agent_id

        resp = self._http.get(
            self._url(f"/v1/vault/{name}"),
            params=params or None,
            headers=headers if headers else None,
        )
        if resp.status_code == 404:
            raise AgentToolError("secret not found", hint=f"name={name}")
        if resp.status_code != 200:
            raise AgentToolError(f"vault.get failed: {resp.status_code}", hint=resp.text)
        return resp.json()

    def delete(self, name: str) -> Dict[str, Any]:
        """Soft-delete a secret (all versions)."""
        resp = self._http.delete(self._url(f"/v1/vault/{name}"))
        if resp.status_code != 200:
            raise AgentToolError(f"vault.delete failed: {resp.status_code}", hint=resp.text)
        return resp.json()

    def list(
        self,
        *,
        tag: Optional[str] = None,
        expiring_soon: Optional[bool] = None,
        rotation_due: Optional[bool] = None,
    ) -> List[Dict[str, Any]]:
        """List all secrets (names and metadata — values are never returned).

        Args:
            tag: Filter by tag.
            expiring_soon: If True, only return secrets expiring within 7 days.
            rotation_due: If True, only return secrets past their rotation date.
        """
        params: Dict[str, Any] = {}
        if tag is not None:
            params["tag"] = tag
        if expiring_soon is not None:
            params["expiring_soon"] = "true" if expiring_soon else "false"
        if rotation_due is not None:
            params["rotation_due"] = "true" if rotation_due else "false"

        resp = self._http.get(self._url("/v1/vault"), params=params or None)
        if resp.status_code != 200:
            raise AgentToolError(f"vault.list failed: {resp.status_code}", hint=resp.text)
        data = resp.json()
        return data.get("secrets", data)

    # ── Versions ──────────────────────────────────────────────────────────────

    def versions(self, name: str) -> List[Dict[str, Any]]:
        """Get version history for a secret (metadata only, no values)."""
        resp = self._http.get(self._url(f"/v1/vault/{name}/versions"))
        if resp.status_code == 404:
            raise AgentToolError("secret not found", hint=f"name={name}")
        if resp.status_code != 200:
            raise AgentToolError(f"vault.versions failed: {resp.status_code}", hint=resp.text)
        data = resp.json()
        return data.get("versions", data)

    # ── Policy ────────────────────────────────────────────────────────────────

    def set_policy(
        self,
        name: str,
        *,
        allowed_agents: Optional[List[str]] = None,
        read_only: Optional[bool] = None,
        require_agent_id: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """Set an access policy for a secret.

        Args:
            name: Secret name.
            allowed_agents: Whitelist of agent IDs. Empty list = all agents allowed.
            read_only: If True, only GET operations are permitted.
            require_agent_id: If True, requests without X-Agent-Id are rejected.
        """
        payload: Dict[str, Any] = {}
        if allowed_agents is not None:
            payload["allowed_agents"] = allowed_agents
        if read_only is not None:
            payload["read_only"] = read_only
        if require_agent_id is not None:
            payload["require_agent_id"] = require_agent_id

        resp = self._http.put(self._url(f"/v1/vault/{name}/policy"), json=payload)
        if resp.status_code != 200:
            raise AgentToolError(f"vault.set_policy failed: {resp.status_code}", hint=resp.text)
        return resp.json()

    # ── Audit ─────────────────────────────────────────────────────────────────

    def audit(
        self,
        name: Optional[str] = None,
        *,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """Retrieve the audit log.

        Args:
            name: If provided, audit log for a specific secret.
                  If None, project-wide audit log.
            limit: Max events to return (default 50).
        """
        if name is not None:
            resp = self._http.get(
                self._url(f"/v1/vault/{name}/audit"), params={"limit": limit}
            )
        else:
            resp = self._http.get(
                self._url("/v1/vault/audit"), params={"limit": limit}
            )

        if resp.status_code != 200:
            raise AgentToolError(f"vault.audit failed: {resp.status_code}", hint=resp.text)
        data = resp.json()
        return data.get("events", data)

    # ── Bulk ──────────────────────────────────────────────────────────────────

    def bulk(
        self,
        names: List[str],
        *,
        agent_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Retrieve multiple secrets in a single request.

        Returns a dict mapping name → ``{value, version, found}``
        for each requested name. Missing secrets are included with
        ``found: False`` rather than raising.
        """
        payload: Dict[str, Any] = {"names": names}
        headers = {}
        if agent_id is not None:
            headers["X-Agent-Id"] = agent_id

        resp = self._http.post(
            self._url("/v1/vault/bulk"), json=payload,
            headers=headers if headers else None,
        )
        if resp.status_code != 200:
            raise AgentToolError(f"vault.bulk failed: {resp.status_code}", hint=resp.text)
        return resp.json()

    def check(self, names: List[str]) -> Dict[str, bool]:
        """Check existence of multiple secrets without retrieving values.

        Returns a dict mapping name → bool.
        """
        resp = self._http.post(self._url("/v1/vault/check"), json={"names": names})
        if resp.status_code != 200:
            raise AgentToolError(f"vault.check failed: {resp.status_code}", hint=resp.text)
        data = resp.json()
        return data.get("exists", data)
