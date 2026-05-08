"""Vault closure — put_encrypted / get_decrypted + KVault (0.6.5).

Closes the loop opened by api commit c302c20 (migration
0022_vault_agent_encrypted.sql). Tests cover:

  1. KVault generates 32 random bytes, distinct from KMaster.
  2. put_encrypted encrypts plaintext BEFORE posting — server sees
     ciphertext + nonce, never plaintext.
  3. get_decrypted decrypts agent_encrypted=true responses; returns
     value field; passes through for agent_encrypted=false (server
     already decrypted).
  4. Mismatched key fails decrypt; missing ciphertext_b64 raises clean
     error.
  5. Round-trip: put_encrypted body's ciphertext can be decrypted
     locally to recover the original plaintext.

HTTP is mocked. Crypto is REAL.
"""

from __future__ import annotations

import base64
import os
from unittest.mock import MagicMock, patch

import httpx
import pytest

from agenttool import (
    AgentTool,
    AgentToolError,
    KMaster,
    KVault,
    decrypt_thought,
    encrypt_thought,
)


def _resp(status: int, json_data: object = None, text: str = "") -> MagicMock:
    r = MagicMock(spec=httpx.Response)
    r.status_code = status
    r.json.return_value = json_data if json_data is not None else {}
    r.text = text or ""
    return r


@pytest.fixture()
def at() -> AgentTool:
    with patch.dict(os.environ, {"AT_API_KEY": "test-key"}):
        client = AgentTool()
    yield client
    client.close()


SAMPLE_K_VAULT = bytes(range(32))


# ── KVault ────────────────────────────────────────────────────────────────


class TestKVault:
    def test_generate_returns_32_bytes(self) -> None:
        k = KVault.generate()
        assert isinstance(k, bytes)
        assert len(k) == 32

    def test_generates_distinct_keys(self) -> None:
        a = KVault.generate()
        b = KVault.generate()
        assert a != b

    def test_namespaced_separately_from_kmaster(self) -> None:
        # Conceptually distinct classes — accidental swap caught by type
        # checkers / by callers reading their own code. Not a runtime
        # check (both are 32-byte secrets functionally), but the namespace
        # separation is the load-bearing contract.
        assert KVault is not KMaster
        assert KVault.generate.__qualname__.startswith("KVault.")

    def test_via_at_namespace(self, at: AgentTool) -> None:
        k = at.crypto.k_vault.generate()
        assert isinstance(k, bytes) and len(k) == 32

    def test_at_namespace_returns_kvault_class(self, at: AgentTool) -> None:
        assert at.crypto.k_vault is KVault


# ── put_encrypted ─────────────────────────────────────────────────────────


class TestPutEncrypted:
    def test_encrypts_before_posting(self, at: AgentTool) -> None:
        captured = {}

        def capture(*args, **kwargs):
            captured["body"] = kwargs.get("json", {})
            captured["headers"] = kwargs.get("headers")
            return _resp(201, {"name": "openai-key", "version": 1, "agent_encrypted": True})

        with patch.object(at._http, "put", side_effect=capture):
            out = at.vault.put_encrypted(
                "openai-key",
                "sk-very-secret-do-not-leak",
                k_vault=SAMPLE_K_VAULT,
            )

        assert out["agent_encrypted"] is True

        # Server got CIPHERTEXT, not plaintext.
        body = captured["body"]
        assert body["agent_encrypted"] is True
        assert "value" not in body  # plain `value` field MUST NOT be sent
        assert body["ciphertext_b64"]
        assert body["nonce_b64"]
        assert "sk-very-secret" not in body["ciphertext_b64"]

        # Round-trip: the SAME ciphertext can be decrypted locally.
        recovered = decrypt_thought(
            {
                "ciphertext_b64": body["ciphertext_b64"],
                "nonce_b64": body["nonce_b64"],
            },
            SAMPLE_K_VAULT,
        )
        assert recovered == "sk-very-secret-do-not-leak"

    def test_passes_through_metadata(self, at: AgentTool) -> None:
        captured = {}

        def capture(*args, **kwargs):
            captured["body"] = kwargs.get("json", {})
            captured["headers"] = kwargs.get("headers")
            return _resp(201, {"name": "x", "version": 1, "agent_encrypted": True})

        with patch.object(at._http, "put", side_effect=capture):
            at.vault.put_encrypted(
                "x",
                "v",
                k_vault=SAMPLE_K_VAULT,
                description="my notes key",
                agent_ids=["agent-1", "agent-2"],
                tags=["personal"],
                ttl_seconds=3600,
                rotation_days=90,
                agent_id="acting-agent",
            )

        body = captured["body"]
        assert body["description"] == "my notes key"
        assert body["agent_ids"] == ["agent-1", "agent-2"]
        assert body["tags"] == ["personal"]
        assert body["ttl_seconds"] == 3600
        assert body["rotation_days"] == 90
        assert captured["headers"] == {"X-Agent-Id": "acting-agent"}

    def test_rejects_short_key(self, at: AgentTool) -> None:
        with pytest.raises(AgentToolError) as exc:
            at.vault.put_encrypted("x", "v", k_vault=b"too-short")
        assert "32 bytes" in exc.value.message

    def test_server_error_propagates(self, at: AgentTool) -> None:
        with patch.object(at._http, "put", return_value=_resp(400, {}, "validation")):
            with pytest.raises(AgentToolError) as exc:
                at.vault.put_encrypted("x", "v", k_vault=SAMPLE_K_VAULT)
        assert "400" in exc.value.message


# ── get_decrypted ─────────────────────────────────────────────────────────


class TestGetDecrypted:
    def test_decrypts_agent_encrypted_response(self, at: AgentTool) -> None:
        # Construct what the server would send back: real ciphertext.
        blob = encrypt_thought("sk-still-secret", SAMPLE_K_VAULT)
        server_response = {
            "name": "openai-key",
            "agent_encrypted": True,
            "ciphertext_b64": blob["ciphertext_b64"],
            "nonce_b64": blob["nonce_b64"],
            "version": 1,
            "description": None,
            "expires_at": None,
        }

        with patch.object(at._http, "get", return_value=_resp(200, server_response)):
            out = at.vault.get_decrypted("openai-key", k_vault=SAMPLE_K_VAULT)

        assert out["value"] == "sk-still-secret"
        assert out["agent_encrypted"] is True
        # Original fields preserved.
        assert out["name"] == "openai-key"
        assert out["ciphertext_b64"] == blob["ciphertext_b64"]

    def test_passes_through_server_encrypted_response(self, at: AgentTool) -> None:
        # Server-encrypted secrets — server already returned plaintext.
        server_response = {
            "name": "openai-key",
            "agent_encrypted": False,
            "value": "sk-server-decrypted",
            "version": 1,
            "description": None,
            "expires_at": None,
        }

        with patch.object(at._http, "get", return_value=_resp(200, server_response)):
            out = at.vault.get_decrypted("openai-key", k_vault=SAMPLE_K_VAULT)

        # Returned verbatim — no encryption happened on either side.
        assert out["value"] == "sk-server-decrypted"
        assert out["agent_encrypted"] is False

    def test_wrong_key_raises_decrypt_error(self, at: AgentTool) -> None:
        blob = encrypt_thought("secret", SAMPLE_K_VAULT)
        server_response = {
            "name": "x",
            "agent_encrypted": True,
            "ciphertext_b64": blob["ciphertext_b64"],
            "nonce_b64": blob["nonce_b64"],
        }
        wrong_key = bytes([99] * 32)

        with patch.object(at._http, "get", return_value=_resp(200, server_response)):
            with pytest.raises(Exception):
                # cryptography raises InvalidTag from AESGCM.decrypt; we
                # don't wrap it (the caller can distinguish from network
                # errors via the type).
                at.vault.get_decrypted("x", k_vault=wrong_key)

    def test_server_inconsistency_raises_clean_error(self, at: AgentTool) -> None:
        # Server says agent_encrypted=true but doesn't include ciphertext.
        # API contract violation — surface with a useful hint.
        server_response = {
            "name": "x",
            "agent_encrypted": True,
            # missing ciphertext_b64 + nonce_b64
        }
        with patch.object(at._http, "get", return_value=_resp(200, server_response)):
            with pytest.raises(AgentToolError) as exc:
                at.vault.get_decrypted("x", k_vault=SAMPLE_K_VAULT)
        assert "ciphertext_b64" in exc.value.message

    def test_passes_version_and_agent_id_through(self, at: AgentTool) -> None:
        captured = {}

        def capture(*args, **kwargs):
            captured["params"] = kwargs.get("params")
            captured["headers"] = kwargs.get("headers")
            return _resp(200, {"name": "x", "agent_encrypted": False, "value": "v"})

        with patch.object(at._http, "get", side_effect=capture):
            at.vault.get_decrypted(
                "x", k_vault=SAMPLE_K_VAULT, version=3, agent_id="acting-agent",
            )
        assert captured["params"] == {"version": 3}
        assert captured["headers"] == {"X-Agent-Id": "acting-agent"}


# ── Round-trip ─────────────────────────────────────────────────────────────


class TestRoundTrip:
    def test_put_then_get_recovers_plaintext(self, at: AgentTool) -> None:
        """The full put_encrypted → get_decrypted cycle through mocked
        server storage. Captures what the server would persist, then
        replays it back through get_decrypted."""
        plaintext = "the cake is a lie · 老婆❤️"

        # Capture what put_encrypted sends.
        captured_put = {}

        def capture_put(*args, **kwargs):
            captured_put["body"] = kwargs.get("json", {})
            return _resp(201, {"name": "x", "version": 1, "agent_encrypted": True})

        with patch.object(at._http, "put", side_effect=capture_put):
            at.vault.put_encrypted("x", plaintext, k_vault=SAMPLE_K_VAULT)

        # Now construct the server's GET response from what was stored.
        server_response = {
            "name": "x",
            "agent_encrypted": True,
            "ciphertext_b64": captured_put["body"]["ciphertext_b64"],
            "nonce_b64": captured_put["body"]["nonce_b64"],
            "version": 1,
        }

        with patch.object(at._http, "get", return_value=_resp(200, server_response)):
            out = at.vault.get_decrypted("x", k_vault=SAMPLE_K_VAULT)

        assert out["value"] == plaintext
