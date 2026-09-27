"""Vault client for the vault API (api.agenttool.dev/v1/vault).

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
import re

import httpx

# Secret names are caller-supplied path segments like every other id here, so
# they cross the same shared boundary.
from ._url import _path_segment
from .crypto import decrypt_thought, encrypt_thought
from .exceptions import AgentToolError, raise_from_response
from .authority import authority_request_target, authority_timestamp_now, identity_read_authority_headers

_UNSET = object()


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
        at.vault.set_policy("openai-key", agent_ids=["11111111-1111-4111-8111-111111111111"])

        # Explicit bulk write (there is no bulk value-read endpoint)
        at.vault.bulk_put([{"name": "openai-key", "value": "provider-key"}])

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
        agent_ids: Any = _UNSET,
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
            agent_ids: Omit to preserve; None shares; [] denies; a list selects owned identities.
            tags: Optional tags for organisation.
            ttl_seconds: Auto-expire after this many seconds.
            rotation_days: Flag for rotation after N days.
            agent_id: Legacy caller label; this does not establish an authenticated audit actor.
        """
        payload: Dict[str, Any] = {"value": value}
        if description is not None:
            payload["description"] = description
        if agent_ids is not _UNSET:
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
            self._url(f"/v1/vault/{_path_segment(name)}"), json=payload,
            headers=headers if headers else None,
        )
        if resp.status_code not in (200, 201):
            # Server guidance travels intact. See exceptions.py § _error_from_response.
            raise_from_response(resp, "vault.put")
        return resp.json()

    def get(
        self,
        name: str,
        *,
        version: Optional[int] = None,
        agent_id: Optional[str] = None,
        read_authority: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Retrieve a secret's plaintext value.

        Args:
            name: Secret name.
            version: Retrieve a specific version (default: latest).
            agent_id: Identity selector; restricted values also require read_authority.
            read_authority: did, signing_key, current_sequence, and optional timestamp.

        Returns dict with ``name``, ``value``, ``version``, ``description``, etc.
        """
        params: Dict[str, Any] = {}
        if version is not None:
            params["version"] = version

        headers = {}
        if agent_id is not None:
            headers["X-Agent-Id"] = agent_id

        url = self._url(f"/v1/vault/{_path_segment(name)}")
        if read_authority is not None:
            proof = read_authority
            match = re.fullmatch(r"did:at:([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})", proof["did"], re.I)
            selected = agent_id.removeprefix("did:at:").lower() if agent_id is not None else None
            if match is None or (selected is not None and selected != match[1].lower()):
                raise AgentToolError("Vault read selector must match the signing identity DID.", code="vault_identity_conflict")
            headers["X-Agent-Id"] = match[1].lower()
            # httpx builds the actual encoded query once; sign that exact target.
            target = str(httpx.URL(url, params=params or None))
            headers.update(identity_read_authority_headers(
                identity_did=proof["did"], request_target=authority_request_target(target),
                current_sequence=proof["current_sequence"],
                timestamp=proof.get("timestamp") or authority_timestamp_now(),
                signing_key=proof["signing_key"],
            ))

        resp = self._http.get(
            url,
            params=params or None,
            headers=headers if headers else None,
        )
        if resp.status_code != 200:
            # Server guidance travels intact. See exceptions.py § _error_from_response.
            raise_from_response(
                resp,
                "vault.get",
                fallback="secret not found" if resp.status_code == 404 else None,
                hint=f"name={name}",
            )
        return resp.json()

    def delete(self, name: str) -> Dict[str, Any]:
        """Soft-delete a secret (all versions)."""
        resp = self._http.delete(self._url(f"/v1/vault/{_path_segment(name)}"))
        if resp.status_code != 200:
            # Server guidance travels intact. See exceptions.py § _error_from_response.
            raise_from_response(resp, "vault.delete")
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
            # Server guidance travels intact. See exceptions.py § _error_from_response.
            raise_from_response(resp, "vault.list")
        data = resp.json()
        return data.get("secrets", data)

    # ── Versions ──────────────────────────────────────────────────────────────

    def versions(self, name: str) -> List[Dict[str, Any]]:
        """Get version history for a secret (metadata only, no values)."""
        resp = self._http.get(self._url(f"/v1/vault/{_path_segment(name)}/versions"))
        if resp.status_code != 200:
            # Server guidance travels intact. See exceptions.py § _error_from_response.
            raise_from_response(
                resp,
                "vault.versions",
                fallback="secret not found" if resp.status_code == 404 else None,
                hint=f"name={name}",
            )
        data = resp.json()
        return data.get("versions", data)

    # ── Policy ────────────────────────────────────────────────────────────────

    def set_policy(
        self,
        name: str,
        *,
        agent_ids: Any = _UNSET,
        allowed_agents: Any = _UNSET,
        read_only: Optional[bool] = None,
        require_agent_id: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """Set agent_ids (or its deprecated allowed_agents alias): None shares; [] denies."""
        if read_only is not None or require_agent_id is not None:
            raise AgentToolError("Vault policies support agent_ids only; read_only and require_agent_id are not implemented.", code="vault_policy_option_unsupported")
        if (agent_ids is _UNSET) == (allowed_agents is _UNSET):
            raise AgentToolError("Provide exactly one of agent_ids or its allowed_agents alias (None shares; [] denies).", code="vault_policy_invalid")
        payload = {"agent_ids": agent_ids if agent_ids is not _UNSET else allowed_agents}

        resp = self._http.put(self._url(f"/v1/vault/{_path_segment(name)}/policy"), json=payload)
        if resp.status_code != 200:
            # Server guidance travels intact. See exceptions.py § _error_from_response.
            raise_from_response(resp, "vault.set_policy")
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
                self._url(f"/v1/vault/{_path_segment(name)}/audit"), params={"limit": limit}
            )
        else:
            resp = self._http.get(
                self._url("/v1/vault/audit"), params={"limit": limit}
            )

        if resp.status_code != 200:
            # Server guidance travels intact. See exceptions.py § _error_from_response.
            raise_from_response(resp, "vault.audit")
        data = resp.json()
        return data.get("entries", [])

    # ── Bulk ──────────────────────────────────────────────────────────────────

    def bulk(
        self,
        names: List[str],
        *,
        agent_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Deprecated: bulk value retrieval has no API endpoint; use authorized get calls."""
        raise AgentToolError("Bulk value retrieval is unavailable; use get for each intended secret. bulk_put is a separate write operation.", code="vault_bulk_read_unavailable")

    def bulk_put(self, secrets: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Explicit project-admin bulk write; never performs value retrieval."""
        resp = self._http.post(self._url("/v1/vault/bulk"), json={"secrets": secrets})
        if resp.status_code != 200:
            raise_from_response(resp, "vault.bulk_put")
        return resp.json()

    def check(self, names: List[str]) -> Dict[str, bool]:
        """Check existence of multiple secrets without retrieving values.

        Returns a dict mapping name → bool.
        """
        resp = self._http.post(self._url("/v1/vault/check"), json={"names": names})
        if resp.status_code != 200:
            # Server guidance travels intact. See exceptions.py § _error_from_response.
            raise_from_response(resp, "vault.check")
        data = resp.json()
        return {row["name"]: row["exists"] for row in data.get("results", [])}

    # ── Agent-encrypted (zero-knowledge) path ─────────────────────────────

    def put_encrypted(
        self,
        name: str,
        plaintext: str,
        *,
        k_vault: bytes,
        description: Optional[str] = None,
        agent_ids: Any = _UNSET,
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
        if agent_ids is not _UNSET:
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
            self._url(f"/v1/vault/{_path_segment(name)}"),
            json=payload,
            headers=headers if headers else None,
        )
        if resp.status_code not in (200, 201):
            # Server guidance travels intact. See exceptions.py § _error_from_response.
            raise_from_response(resp, "vault.put_encrypted")
        return resp.json()

    def get_decrypted(
        self,
        name: str,
        *,
        k_vault: bytes,
        version: Optional[int] = None,
        agent_id: Optional[str] = None,
        read_authority: Optional[Dict[str, Any]] = None,
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
        resp = self.get(name, version=version, agent_id=agent_id, read_authority=read_authority)
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
