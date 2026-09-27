"""Canonical Vault wire shapes and the same exact-read vector as sdk-ts."""
import json
import httpx
import pytest
from agenttool.vault import VaultClient
from agenttool.exceptions import AgentToolError

IDENTITY = "22222222-2222-4222-8222-222222222222"
PROOF = dict(did=f"did:at:{IDENTITY}", signing_key=bytes([7]) * 32, current_sequence=0, timestamp="2026-09-27T20:00:00.000Z")
SIGNATURE = "i++BcEaHXgCJtmGgNeSi7D+Bv4wisOBLvWZFwrtfBwfYRskuP+rv72td+1NAthueOYUEByIuFVCr+zWTxPLxCg=="

@pytest.fixture
def fixture():
    calls = []
    reply = {"body": {}}
    def handle(request):
        calls.append(request)
        return httpx.Response(200, json=reply["body"])
    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        yield VaultClient(http, "https://vault.invalid/prefix"), calls, reply

def test_exact_get_proof_and_decrypted_forwarding(fixture):
    vault, calls, reply = fixture
    reply["body"] = {"value": "fixture", "agent_encrypted": False}
    vault.get("a/b #雨", version=2, read_authority=PROOF)
    request = calls[0]
    assert str(request.url) == "https://vault.invalid/prefix/v1/vault/a%2Fb%20%23%E9%9B%A8?version=2"
    assert request.method == "GET" and request.content == b""
    assert request.headers["X-Agent-Id"] == IDENTITY
    assert request.headers["X-Agenttool-Authority-Sequence"] == "0"
    assert request.headers["X-Agenttool-Authority-Signature"] == SIGNATURE
    vault.get_decrypted("a/b #雨", k_vault=bytes(32), version=2, read_authority=PROOF)
    assert calls[1].headers["X-Agenttool-Authority-Signature"] == SIGNATURE

def test_refuse_conflicting_identity_and_unsupported_read_before_transport(fixture):
    vault, calls, _ = fixture
    with pytest.raises(AgentToolError) as raised:
        vault.get("key", agent_id="33333333-3333-4333-8333-333333333333", read_authority=PROOF)
    assert raised.value.code == "vault_identity_conflict"
    with pytest.raises(AgentToolError) as raised:
        vault.bulk(["key"])
    assert raised.value.code == "vault_bulk_read_unavailable"
    assert calls == []

def test_explicit_policy_null_empty_alias_and_unsupported_fields(fixture):
    vault, calls, _ = fixture
    vault.put("key", "value")
    vault.put("key", "value", agent_ids=None)
    vault.set_policy("key", agent_ids=[])
    vault.set_policy("key", allowed_agents=[IDENTITY])
    assert [json.loads(r.content) for r in calls] == [
        {"value": "value"}, {"value": "value", "agent_ids": None}, {"agent_ids": []}, {"agent_ids": [IDENTITY]},
    ]
    for options, code in [
        ({"agent_ids": [], "read_only": False}, "vault_policy_option_unsupported"),
        ({"require_agent_id": True}, "vault_policy_option_unsupported"),
        ({}, "vault_policy_invalid"),
        ({"agent_ids": None, "allowed_agents": []}, "vault_policy_invalid"),
    ]:
        with pytest.raises(AgentToolError) as raised:
            vault.set_policy("key", **options)
        assert raised.value.code == code
    assert len(calls) == 4

def test_bulk_write_and_actual_metadata_envelopes(fixture):
    vault, calls, reply = fixture
    secrets = [{"name": "key", "value": "fixture", "agent_ids": []}]
    vault.bulk_put(secrets)
    assert json.loads(calls[0].content) == {"secrets": secrets}
    assert calls[0].url.path.endswith("/v1/vault/bulk")
    reply["body"] = {"results": [{"name": "key", "exists": True}, {"name": "missing", "exists": False}]}
    assert vault.check(["key", "missing"]) == {"key": True, "missing": False}
    reply["body"] = {"entries": [{"action": "runtime_read", "agent_id": IDENTITY}]}
    assert vault.audit() == [{"action": "runtime_read", "agent_id": IDENTITY}]
