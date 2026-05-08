"""Vault client for the agent-vault API (agent-vault.fly.dev).

Two encryption paths (per migration 0022_vault_agent_encrypted.sql):

  Default (server-encrypted at rest):
    .put(name, value, ...) — server encrypts; in-process runtime can read.

  Opt-in (zero-knowledge):
    .put_encrypted(name, plaintext, k_vault=, ...) — SDK encrypts before
    send; agenttool stores ciphertext only.
    .get_decrypted(name, k_vault=, ...) — fetches and decrypts locally
    (transparently falls through to plaintext if the secret was stored
    via the default path).

Use put_encrypted for secrets agenttool itself shouldn't be able to read
(personal data, sensitive credentials you don't want the runtime to use).
Use put for secrets the hosted runtime needs to consume server-side
(e.g. LLM provider API keys).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx

from .crypto import decrypt_thought, encrypt_thought
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

    # ── Agent-encrypted (zero-knowledge) path ─────────────────────────────

    def put_encrypted(
        self,
        name: str,
        plaintext: str,
        *,
        k_vault: bytes,
        description: Optional[str] = None,
        agent_ids: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
        ttl_seconds: Optional[int] = None,
        rotation_days: Optional[int] = None,
        agent_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Encrypt locally with K_vault, then PUT as ``agent_encrypted=true``.

        agenttool stores ciphertext + nonce verbatim and CANNOT decrypt.
        The hosted runtime (think-worker etc.) cannot read these secrets
        either — use :meth:`put` for secrets the server-side runtime
        needs to consume.

        Args:
            name: Secret name (slug-style).
            plaintext: Value to encrypt before sending.
            k_vault: 32-byte AES-256 secret. Generate via
                ``at.crypto.k_vault.generate()`` and persist securely.
            description, agent_ids, tags, ttl_seconds, rotation_days,
            agent_id: Same as :meth:`put`.

        Returns the server's ``{name, version, agent_encrypted: true,
        created_at, expires_at, rotation_due, agent_ids}`` row.
        """
        blob = encrypt_thought(plaintext, k_vault)
        payload: Dict[str, Any] = {
            "agent_encrypted": True,
            "ciphertext_b64": blob["ciphertext_b64"],
            "nonce_b64": blob["nonce_b64"],
        }
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
            self._url(f"/v1/vault/{name}"),
            json=payload,
            headers=headers if headers else None,
        )
        if resp.status_code not in (200, 201):
            raise AgentToolError(
                f"vault.put_encrypted failed: {resp.status_code}",
                hint=resp.text[:200],
            )
        return resp.json()

    def get_decrypted(
        self,
        name: str,
        *,
        k_vault: bytes,
        version: Optional[int] = None,
        agent_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fetch a secret; decrypt locally if it was stored agent-encrypted.

        Transparently handles both paths:
          - Server response with ``agent_encrypted=true`` → decrypt
            locally with k_vault, return ``{value: <plaintext>, ...}``.
          - Server response with ``agent_encrypted=false`` → server
            already returned plaintext; pass through verbatim.

        The returned dict always has ``value`` populated. ``agent_encrypted``
        is preserved so the caller can introspect which path the secret
        was stored under.

        Args:
            name: Secret name.
            k_vault: 32-byte AES-256 secret used to decrypt the
                agent-encrypted path. Ignored when the secret was
                stored via the server-encrypted path.
            version, agent_id: Same as :meth:`get`.
        """
        resp = self.get(name, version=version, agent_id=agent_id)
        if resp.get("agent_encrypted") is True:
            ct = resp.get("ciphertext_b64")
            nonce = resp.get("nonce_b64")
            if not ct or not nonce:
                raise AgentToolError(
                    "vault.get_decrypted: server marked agent_encrypted=true "
                    "but did not return ciphertext_b64 + nonce_b64.",
                    hint="API contract violation; check server version.",
                )
            plaintext = decrypt_thought(
                {"ciphertext_b64": ct, "nonce_b64": nonce}, k_vault,
            )
            out = dict(resp)
            out["value"] = plaintext
            return out
        return resp
