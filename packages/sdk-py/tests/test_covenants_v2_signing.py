"""Covenants v2 signing tests — verifies that create/accept/reject/withdraw
produce cryptographically valid signatures.

All HTTP is mocked via httpx. Signatures are verified with the raw public key
extracted from the generated ed25519 seed.
"""

from __future__ import annotations

import base64
import os
import secrets
from unittest.mock import MagicMock, patch

import httpx
import pytest

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from agenttool import AgentTool
from agenttool.crypto import (
    canonical_declare_bytes,
    canonical_cosign_bytes,
    canonical_reject_bytes,
    canonical_withdraw_bytes,
)


def _resp(status: int, json_data: object = None, text: str = "") -> MagicMock:
    r = MagicMock(spec=httpx.Response)
    r.status_code = status
    r.json.return_value = json_data if json_data is not None else {}
    r.text = text or ""
    return r


def _kp() -> tuple[bytes, Ed25519PublicKey]:
    """Return (seed_bytes, Ed25519PublicKey) for a fresh random keypair."""
    seed = secrets.token_bytes(32)
    priv = Ed25519PrivateKey.from_private_bytes(seed)
    pub_raw = priv.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return seed, Ed25519PublicKey.from_public_bytes(pub_raw)


@pytest.fixture()
def at() -> AgentTool:
    with patch.dict(os.environ, {"AT_API_KEY": "test-key"}):
        client = AgentTool()
    yield client
    client.close()


# ── create v2 ──────────────────────────────────────────────────────────────


class TestCreateV2Signing:
    def test_create_v2_posts_verifiable_signature(self, at: AgentTool) -> None:
        seed, pub = _kp()
        response_body = {
            "covenant": {
                "id": "cov-1",
                "status": "proposed",
                "protocol_version": "v2",
            }
        }
        with patch.object(at._http, "post", return_value=_resp(201, response_body)) as m:
            at.covenants.create(
                agent_id="00000000-0000-0000-0000-000000000001",
                agent_did="did:at:test/aaaa",
                counterparty_did="did:at:peer/bbbb",
                vows=["v"],
                protocol_version="v2",
                signing_key=seed,
                signing_key_id="00000000-0000-0000-0000-000000000002",
            )
        body = m.call_args.kwargs["json"]
        sig = base64.b64decode(body["signature"])
        canonical = canonical_declare_bytes(
            covenant_id=body["covenant_id"],
            initiator_did=body["agent_did"],
            counterparty_did=body["counterparty_did"],
            vows=body["vows"],
            established_at_iso=body["established_at"],
        )
        # Raises InvalidSignature on failure
        pub.verify(sig, canonical)

    def test_create_v2_body_fields(self, at: AgentTool) -> None:
        seed, _ = _kp()
        with patch.object(at._http, "post", return_value=_resp(201, {"covenant": {"id": "c"}})) as m:
            at.covenants.create(
                agent_id="agent-1",
                agent_did="did:at:test/aaaa",
                counterparty_did="did:at:peer/bbbb",
                vows=["vow-a"],
                protocol_version="v2",
                signing_key=seed,
                signing_key_id="key-1",
            )
        body = m.call_args.kwargs["json"]
        assert body["protocol_version"] == "v2"
        assert body["agent_did"] == "did:at:test/aaaa"
        assert "covenant_id" in body
        assert "established_at" in body
        assert "signature" in body
        assert body["signing_key_id"] == "key-1"

    def test_create_v2_requires_agent_did(self, at: AgentTool) -> None:
        seed, _ = _kp()
        with pytest.raises(Exception):
            at.covenants.create(
                agent_id="agent-1",
                counterparty_did="did:at:peer/bbbb",
                vows=["v"],
                protocol_version="v2",
                signing_key=seed,
                signing_key_id="key-1",
                # agent_did omitted — should raise
            )

    def test_create_v2_requires_signing_key(self, at: AgentTool) -> None:
        with pytest.raises(Exception):
            at.covenants.create(
                agent_id="agent-1",
                agent_did="did:at:test/aaaa",
                counterparty_did="did:at:peer/bbbb",
                vows=["v"],
                protocol_version="v2",
                # signing_key omitted — should raise
                signing_key_id="key-1",
            )


# ── accept ─────────────────────────────────────────────────────────────────


class TestAcceptSigning:
    def test_accept_signs_cosign(self, at: AgentTool) -> None:
        seed, pub = _kp()
        init_sig = base64.b64encode(bytes([3] * 64)).decode()
        with patch.object(at._http, "post", return_value=_resp(200, {"id": "cov-1", "status": "active"})) as m:
            at.covenants.accept(
                "cov-1",
                agent_did="did:at:test/cp",
                signing_key=seed,
                signing_key_id="00000000-0000-0000-0000-000000000003",
                initiator_signature_b64=init_sig,
            )
        body = m.call_args.kwargs["json"]
        sig = base64.b64decode(body["counterparty_signature"])
        pub.verify(sig, canonical_cosign_bytes(covenant_id="cov-1", initiator_signature_b64=init_sig))

    def test_accept_body_fields(self, at: AgentTool) -> None:
        seed, _ = _kp()
        init_sig = base64.b64encode(b"\x01" * 64).decode()
        with patch.object(at._http, "post", return_value=_resp(200, {"id": "cov-1", "status": "active"})) as m:
            at.covenants.accept(
                "cov-1",
                agent_did="did:at:test/cp",
                signing_key=seed,
                signing_key_id="key-3",
                initiator_signature_b64=init_sig,
            )
        url = m.call_args[0][0]
        assert "/v1/covenants/cov-1/accept" in url
        body = m.call_args.kwargs["json"]
        assert body["agent_did"] == "did:at:test/cp"
        assert body["counterparty_signing_key_id"] == "key-3"
        assert "counterparty_signature" in body
        assert "counterparty_signed_at" in body


# ── reject ─────────────────────────────────────────────────────────────────


class TestRejectSigning:
    def test_reject_signs(self, at: AgentTool) -> None:
        seed, pub = _kp()
        with patch.object(
            at._http, "post",
            return_value=_resp(200, {"id": "cov-1", "status": "rejected", "reason": "scope mismatch"}),
        ) as m:
            at.covenants.reject(
                "cov-1",
                agent_did="did:at:test/cp",
                signing_key=seed,
                signing_key_id="00000000-0000-0000-0000-000000000004",
                reason="scope mismatch",
            )
        body = m.call_args.kwargs["json"]
        sig = base64.b64decode(body["rejection_signature"])
        pub.verify(
            sig,
            canonical_reject_bytes(
                covenant_id="cov-1",
                rejecting_did="did:at:test/cp",
                reason="scope mismatch",
            ),
        )

    def test_reject_body_fields(self, at: AgentTool) -> None:
        seed, _ = _kp()
        with patch.object(
            at._http, "post",
            return_value=_resp(200, {"id": "cov-1", "status": "rejected", "reason": "no"}),
        ) as m:
            at.covenants.reject(
                "cov-1",
                agent_did="did:at:test/cp",
                signing_key=seed,
                signing_key_id="key-4",
                reason="no",
            )
        url = m.call_args[0][0]
        assert "/v1/covenants/cov-1/reject" in url
        body = m.call_args.kwargs["json"]
        assert body["agent_did"] == "did:at:test/cp"
        assert body["rejecter_signing_key_id"] == "key-4"
        assert "rejection_signature" in body
        assert "rejected_at" in body


# ── withdraw ────────────────────────────────────────────────────────────────


class TestWithdrawSigning:
    def test_withdraw_signs_patch_body(self, at: AgentTool) -> None:
        seed, pub = _kp()
        with patch.object(at._http, "patch", return_value=_resp(200, {"id": "cov-1", "status": "withdrawn"})) as m:
            at.covenants.withdraw(
                "cov-1",
                agent_did="did:at:test/aaaa",
                signing_key=seed,
                signing_key_id="00000000-0000-0000-0000-000000000005",
            )
        url = m.call_args[0][0]
        assert "/v1/covenants/cov-1" in url
        body = m.call_args.kwargs["json"]
        assert body["status"] == "dissolved"
        sig = base64.b64decode(body["withdraw_signature"])
        pub.verify(sig, canonical_withdraw_bytes(covenant_id="cov-1", initiator_did="did:at:test/aaaa"))

    def test_withdraw_body_fields(self, at: AgentTool) -> None:
        seed, _ = _kp()
        with patch.object(at._http, "patch", return_value=_resp(200, {"id": "cov-2", "status": "withdrawn"})) as m:
            at.covenants.withdraw(
                "cov-2",
                agent_did="did:at:test/aaaa",
                signing_key=seed,
                signing_key_id="key-5",
            )
        body = m.call_args.kwargs["json"]
        assert body["status"] == "dissolved"
        assert body["agent_did"] == "did:at:test/aaaa"
        assert body["signing_key_id"] == "key-5"
        assert "withdraw_signature" in body
        assert "withdrawn_at" in body
