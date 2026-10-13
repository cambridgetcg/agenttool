"""Owner-gated deletes and withdrawals: exact requests a rooted owner signs.

The shared vectors (``packages/sdk-ts/tests/fixtures/
owner-gated-request-vectors.json``) are produced by the TypeScript helper;
this file proves :func:`agenttool.owner_gated_request` reproduces every URL,
body and signature byte, and that the client methods wrapping these routes
send the same signed request. Nothing leaves the process
(``httpx.MockTransport``).
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from agenttool import (
    OWNER_GATED_ROUTES,
    AgentTool,
    canonical_identity_authority_bytes,
    owner_gated_request,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads(
    (REPO_ROOT / "packages/sdk-ts/tests/fixtures/owner-gated-request-vectors.json").read_text("utf-8")
)
SEED = bytes.fromhex(FIXTURE["authority"]["signing_key_seed_hex"])
AUTHORITY = {
    "did": FIXTURE["authority"]["did"],
    "signing_key": SEED,
    "sequence": FIXTURE["authority"]["sequence"],
    "timestamp": FIXTURE["authority"]["timestamp"],
}
VECTORS = {vector["action"]: vector for vector in FIXTURE["vectors"]}


def build(vector, *, signed: bool):
    return owner_gated_request(
        base_url=FIXTURE["base_url"],
        action=vector["action"],
        id=vector["input"]["id"],
        key=vector["input"]["key"],
        agent_id=vector["input"]["agent_id"],
        authority=AUTHORITY if signed else None,
    )


def test_vectors_cover_every_owner_gated_route():
    assert sorted(VECTORS) == sorted(OWNER_GATED_ROUTES)


@pytest.mark.parametrize("action", sorted(VECTORS))
def test_exact_request_matches_the_typescript_vector(action):
    vector = VECTORS[action]
    request = build(vector, signed=True)
    assert request == {
        "method": vector["method"],
        "url": vector["url"],
        "body": vector["body"],
        "headers": vector["headers"],
    }
    assert build(vector, signed=False)["headers"] == vector["bearer_only_headers"]

    # The signature verifies over identity-authority/v1 for this exact request.
    target = urlsplit(request["url"])
    digest = canonical_identity_authority_bytes(
        identity_did=AUTHORITY["did"],
        method=request["method"],
        request_target=f"{target.path}?{target.query}" if target.query else target.path,
        body=request["body"],
        sequence=AUTHORITY["sequence"],
        timestamp=AUTHORITY["timestamp"],
    )
    public = Ed25519PrivateKey.from_private_bytes(SEED).public_key()
    public.verify(base64.b64decode(request["headers"]["X-Agenttool-Authority-Signature"]), digest)


def test_withdrawal_bodies_are_compact_json_and_inputs_are_required():
    margin = owner_gated_request(base_url="https://x.test/", action="margin.withdraw", id="m", agent_id="a")
    assert margin["body"] == '{"agent_id":"a","margin_id":"m"}'
    assert margin["url"] == "https://x.test/v1/margin/withdraw"
    assert margin["headers"] == {"Content-Type": "application/json"}
    with pytest.raises(ValueError, match="agent_id"):
        owner_gated_request(base_url="https://x.test", action="trust.withdraw", id="t")
    with pytest.raises(ValueError, match="needs id"):
        owner_gated_request(base_url="https://x.test", action="blessing.withdraw")
    with pytest.raises(ValueError, match="needs key"):
        owner_gated_request(base_url="https://x.test", action="memory.delete_by_key")
    with pytest.raises(ValueError, match="unknown action"):
        owner_gated_request(base_url="https://x.test", action="nope")


def test_path_ids_are_encoded_and_dot_segments_refused():
    assert (
        owner_gated_request(base_url="https://x.test", action="inbox.delete", id="a/b")["url"]
        == "https://x.test/v1/inbox/a%2Fb"
    )
    with pytest.raises(Exception):
        owner_gated_request(base_url="https://x.test", action="inbox.delete", id="..")


def recording_client():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={"ok": True, "id": "x", "deleted": True})

    return AgentTool(transport=httpx.MockTransport(handler)), calls


def signature_for(action):
    return VECTORS[action]["headers"]["X-Agenttool-Authority-Signature"]


def test_love_revocations_sign_the_exact_delete():
    at, calls = recording_client()
    at.love.revoke_blessing("aaaaaaaa-0000-4000-8000-000000000004", authority=AUTHORITY)
    at.love.revoke_unconditional("aaaaaaaa-0000-4000-8000-000000000005", authority=AUTHORITY)
    assert calls[0].headers["x-agenttool-authority-signature"] == signature_for("blessing.withdraw")
    assert calls[1].headers["x-agenttool-authority-signature"] == signature_for("unconditional.withdraw")
    assert all(call.method == "DELETE" and call.content == b"" for call in calls)


def test_attestation_and_inbox_deletes_sign_the_exact_delete():
    at, calls = recording_client()
    at.identity.revoke_attestation("aaaaaaaa-0000-4000-8000-000000000007", authority=AUTHORITY)
    at.inbox.delete("aaaaaaaa-0000-4000-8000-000000000002", authority=AUTHORITY)
    assert calls[0].headers["x-agenttool-authority-signature"] == signature_for("attestation.withdraw")
    assert calls[1].headers["x-agenttool-authority-signature"] == signature_for("inbox.delete")


def test_inbox_patch_to_deleted_signs_the_exact_json_body_it_sends():
    at, calls = recording_client()
    at.inbox.patch("aaaaaaaa-0000-4000-8000-000000000003", "deleted", authority=AUTHORITY)
    vector = VECTORS["inbox.mark_deleted"]
    assert calls[0].content.decode("utf-8") == vector["body"]
    assert calls[0].headers["x-agenttool-authority-signature"] == vector["headers"]["X-Agenttool-Authority-Signature"]


def test_archive_offering_signs_the_exact_post_with_its_empty_object_body():
    at, calls = recording_client()
    at.love.archive_offering("aaaaaaaa-0000-4000-8000-00000000000a", authority=AUTHORITY)
    call = calls[0]
    assert call.method == "POST"
    assert str(call.url) == VECTORS["offering.withdraw"]["url"]
    assert call.content == b"{}"
    target = urlsplit(str(call.url))
    digest = canonical_identity_authority_bytes(
        identity_did=AUTHORITY["did"],
        method="POST",
        request_target=target.path + (f"?{target.query}" if target.query else ""),
        body=b"{}",
        sequence=AUTHORITY["sequence"],
        timestamp=AUTHORITY["timestamp"],
    )
    signature = base64.b64decode(call.headers["x-agenttool-authority-signature"])
    Ed25519PrivateKey.from_private_bytes(SEED).public_key().verify(signature, digest)
    at.love.archive_offering("aaaaaaaa-0000-4000-8000-00000000000a")
    assert "x-agenttool-authority-signature" not in calls[1].headers
    assert calls[1].content == b"{}"


def test_without_authority_requests_stay_bearer_only():
    at, calls = recording_client()
    at.love.revoke_blessing("aaaaaaaa-0000-4000-8000-000000000004")
    at.inbox.delete("aaaaaaaa-0000-4000-8000-000000000002")
    at.inbox.patch("aaaaaaaa-0000-4000-8000-000000000003", "read")
    for call in calls:
        assert "x-agenttool-authority-signature" not in call.headers
