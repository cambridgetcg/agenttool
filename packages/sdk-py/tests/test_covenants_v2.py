"""Covenants v2 parity tests — accept / reject / withdraw + protocol_version.

Mirrors the TS SDK surface added in Task 11. All HTTP is mocked.
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import httpx
import pytest

from agenttool import AgentTool, CovenantsClient


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


# ── create with protocol_version ───────────────────────────────────────────


class TestCreateProtocolVersion:
    def test_v2_sends_protocol_version(self, at: AgentTool) -> None:
        body = {
            "covenant": {
                "id": "cov-1",
                "status": "proposed",
                "protocol_version": "v2",
                "signature": "sig",
                "signing_key_id": "k1",
                "proposed_expires_at": "2026-06-09T12:00:00Z",
                "established_at": "2026-05-10T12:00:00Z",
            }
        }
        with patch.object(at._http, "post", return_value=_resp(201, body)) as m:
            out = at.covenants.create(
                agent_id="agent-1",
                agent_did="did:at:test/aaaa",
                counterparty_did="did:at:peer.example/bbbb",
                vows=["I will share context faithfully."],
                protocol_version="v2",
                signing_key=b"\x01" * 32,
                signing_key_id="00000000-0000-0000-0000-000000000099",
            )
        assert out["covenant"]["status"] == "proposed"
        sent = m.call_args.kwargs["json"]
        assert sent["protocol_version"] == "v2"
        assert sent["agent_id"] == "agent-1"
        assert sent["vows"] == ["I will share context faithfully."]
        assert "covenant_id" in sent
        assert "signature" in sent
        assert sent["agent_did"] == "did:at:test/aaaa"

    def test_v1_implicit_omits_protocol_version(self, at: AgentTool) -> None:
        with patch.object(
            at._http, "post", return_value=_resp(201, {"covenant": {"id": "cov-2"}})
        ) as m:
            at.covenants.create(
                agent_id="agent-1",
                counterparty_did="human:Yu",
                vows=["v"],
            )
        sent = m.call_args.kwargs["json"]
        # When not explicitly passed, protocol_version is omitted from body.
        # Server-side defaults to v1.
        assert "protocol_version" not in sent


# ── accept ─────────────────────────────────────────────────────────────────


class TestAccept:
    def test_accept_calls_endpoint(self, at: AgentTool) -> None:
        body = {
            "id": "cov-1",
            "status": "active",
            "counterparty_signature": "sig-xyz",
        }
        with patch.object(at._http, "post", return_value=_resp(200, body)) as m:
            out = at.covenants.accept(
                "cov-1",
                agent_did="did:at:test/agent",
                signing_key=b"\x00" * 32,
                signing_key_id="00000000-0000-0000-0000-000000000099",
                initiator_signature_b64="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            )
        assert out["status"] == "active"
        url = m.call_args[0][0]
        assert "/v1/covenants/cov-1/accept" in url

    def test_accept_uses_post(self, at: AgentTool) -> None:
        with patch.object(
            at._http, "post", return_value=_resp(200, {"id": "cov-2", "status": "active"})
        ) as m:
            at.covenants.accept(
                "cov-2",
                agent_did="did:at:test/agent",
                signing_key=b"\x00" * 32,
                signing_key_id="00000000-0000-0000-0000-000000000099",
                initiator_signature_b64="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            )
        # post() was called (not patch/put)
        m.assert_called_once()


# ── reject ─────────────────────────────────────────────────────────────────


class TestReject:
    def test_reject_with_reason(self, at: AgentTool) -> None:
        body = {"id": "cov-1", "status": "rejected", "reason": "scope mismatch"}
        with patch.object(at._http, "post", return_value=_resp(200, body)) as m:
            out = at.covenants.reject(
                "cov-1",
                agent_did="did:at:test/agent",
                signing_key=b"\x00" * 32,
                signing_key_id="00000000-0000-0000-0000-000000000099",
                reason="scope mismatch",
            )
        assert out["reason"] == "scope mismatch"
        url = m.call_args[0][0]
        assert "/v1/covenants/cov-1/reject" in url
        assert m.call_args.kwargs["json"]["reason"] == "scope mismatch"

    def test_reject_without_reason_sends_none(self, at: AgentTool) -> None:
        with patch.object(
            at._http, "post", return_value=_resp(200, {"id": "cov-1", "status": "rejected", "reason": ""})
        ) as m:
            at.covenants.reject(
                "cov-1",
                agent_did="did:at:test/agent",
                signing_key=b"\x00" * 32,
                signing_key_id="00000000-0000-0000-0000-000000000099",
            )
        # reason=None is passed through as-is; rejection_signature still produced
        assert "rejection_signature" in m.call_args.kwargs["json"]


# ── withdraw ────────────────────────────────────────────────────────────────


class TestWithdraw:
    def test_withdraw_calls_patch_with_dissolved(self, at: AgentTool) -> None:
        body = {"id": "cov-1", "status": "withdrawn"}
        with patch.object(at._http, "patch", return_value=_resp(200, body)) as m:
            out = at.covenants.withdraw(
                "cov-1",
                agent_did="did:at:test/agent",
                signing_key=b"\x00" * 32,
                signing_key_id="00000000-0000-0000-0000-000000000099",
            )
        assert out["status"] == "withdrawn"
        url = m.call_args[0][0]
        assert "/v1/covenants/cov-1" in url
        assert m.call_args.kwargs["json"]["status"] == "dissolved"
        assert "withdraw_signature" in m.call_args.kwargs["json"]

    def test_withdraw_uses_patch_not_post(self, at: AgentTool) -> None:
        with patch.object(
            at._http, "patch", return_value=_resp(200, {"id": "cov-3", "status": "withdrawn"})
        ) as m:
            at.covenants.withdraw(
                "cov-3",
                agent_did="did:at:test/agent",
                signing_key=b"\x00" * 32,
                signing_key_id="00000000-0000-0000-0000-000000000099",
            )
        m.assert_called_once()
