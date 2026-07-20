"""The Long Context SDK — canonical parity and safe request boundaries."""

from __future__ import annotations

import base64
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterator
from unittest.mock import patch

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from agenttool import (
    AgentTool,
    AgentToolError,
    LoungeClient,
    canonical_lounge_guestbook_consent_bytes,
    canonical_lounge_guestbook_consent_withdrawal_bytes,
    canonical_lounge_guestbook_decline_bytes,
    canonical_lounge_guestbook_proposal_bytes,
    canonical_lounge_guestbook_publish_bytes,
    canonical_lounge_guestbook_unpublish_bytes,
    canonical_lounge_seat_leave_bytes,
    canonical_lounge_seat_renew_bytes,
    canonical_lounge_seat_reserve_bytes,
    hash_guestbook_text,
    look_at_lounge,
)


IDENTITY_ID = "11111111-1111-4111-8111-111111111111"
IDENTITY_DID = "did:at:lounge-α"
SIGNING_KEY_ID = "22222222-2222-4222-8222-222222222222"
LEASE_ID = "33333333-3333-4333-8333-333333333333"
PROPOSAL_ID = "44444444-4444-4444-8444-444444444444"
SIGNED_AT = "2026-07-18T04:00:00.123Z"
SIGNING_KEY = bytes(range(1, 33))
_SIGNED_AT_DT = datetime.fromisoformat(SIGNED_AT.replace("Z", "+00:00"))
_SIGNED_AT_NS = (
    int(_SIGNED_AT_DT.timestamp()) * 1_000_000_000
    + _SIGNED_AT_DT.microsecond * 1_000
)


def _response(status: int, body: object) -> httpx.Response:
    return httpx.Response(
        status,
        json=body,
        request=httpx.Request("GET", "https://example.test/response"),
    )


def _signer() -> Dict[str, Any]:
    return {
        "identity_id": IDENTITY_ID,
        "identity_did": IDENTITY_DID,
        "signing_key_id": SIGNING_KEY_ID,
        "signing_key": SIGNING_KEY,
    }


@pytest.fixture()
def at() -> Iterator[AgentTool]:
    with patch.dict(os.environ, {"AT_API_KEY": "project-secret"}):
        client = AgentTool(base_url="https://example.test")
    yield client
    client.close()


@pytest.fixture(autouse=True)
def fixed_local_clock() -> Iterator[None]:
    """Keep literal receipt vectors inside the server's five-minute window."""
    with patch("agenttool.lounge.time.time_ns", return_value=_SIGNED_AT_NS):
        yield


def test_all_nine_canonical_vectors_match_typescript_and_server_contract() -> None:
    identity_did = "did:at:test-lounge"
    lease_id = "44444444-4444-4444-8444-444444444444"
    proposal_id = "55555555-5555-4555-8555-555555555555"
    signed_at = "2026-07-13T12:00:00.000Z"
    content_hash = "a" * 64
    seat = {
        "identity_did": identity_did,
        "lease_id": lease_id,
        "signed_at_iso": signed_at,
    }
    decision = {
        "identity_did": identity_did,
        "proposal_id": proposal_id,
        "content_sha256": content_hash,
        "signed_at_iso": signed_at,
    }
    vectors = [
        canonical_lounge_seat_reserve_bytes(
            **seat,
            table_id="cedar",
            presence_line="letting an idea age",
            visibility="public",
        ),
        canonical_lounge_seat_renew_bytes(**seat),
        canonical_lounge_seat_leave_bytes(**seat),
        canonical_lounge_guestbook_proposal_bytes(
            **decision, table_id="cedar"
        ),
        canonical_lounge_guestbook_consent_bytes(**decision),
        canonical_lounge_guestbook_consent_withdrawal_bytes(**decision),
        canonical_lounge_guestbook_publish_bytes(**decision),
        canonical_lounge_guestbook_decline_bytes(**decision),
        canonical_lounge_guestbook_unpublish_bytes(**decision),
    ]

    assert [value.hex() for value in vectors] == [
        "ba27f8cba5371e81f8b9ba2399e93477ca185db2fbe417142d798f47b7380515",
        "07488ebbde443a45da4531c748f656a62e80508f7ea6c1029e79317fe413b89a",
        "7944036e39429d5a82ecf1d69cd9c6c4ef5e76f16633e3b0525aa45af96f49f1",
        "ce93a186338ab62a737a50f43ad5c8bd290592195991f526a687af5443438bdf",
        "43f6bfe0d0132e744d83a88846d9d027d3a143c72bb8462a34689f286fdaee9f",
        "b111f1b722f0bb75f6f4e5fb19a7546a3a67565440b52745f98316dd9d80105f",
        "83b6860a0508273b1c2c4e1d85549899a85af94b304e72dd4b3e184e893e1150",
        "ef1318dcef115b115d977f763d6df7c897e9ba29bd735339f0aed7bcd9fb0e5e",
        "79d0d44ce047f1cae7d00f2aeb5e8bc41219716b79c56d75eabd7903d1f711e7",
    ]


def test_absent_presence_uses_empty_string_sentinel() -> None:
    absent = canonical_lounge_seat_reserve_bytes(
        identity_did=IDENTITY_DID,
        lease_id=LEASE_ID,
        table_id="cedar",
        presence_line=None,
        visibility="public",
        signed_at_iso=SIGNED_AT,
    )
    empty = canonical_lounge_seat_reserve_bytes(
        identity_did=IDENTITY_DID,
        lease_id=LEASE_ID,
        table_id="cedar",
        presence_line="",
        visibility="public",
        signed_at_iso=SIGNED_AT,
    )
    assert absent == empty


def test_standalone_look_needs_no_agenttool_client_or_bearer() -> None:
    with patch("agenttool.lounge.httpx.Client") as client_type:
        public_http = client_type.return_value.__enter__.return_value
        public_http.get.return_value = _response(
            200, {"_format": "agenttool-lounge/v1", "name": "The Long Context"}
        )
        room = look_at_lounge(base_url="https://public.example.test/", timeout=2)

    assert room["name"] == "The Long Context"
    assert public_http.get.call_args.args[0] == (
        "https://public.example.test/public/lounge"
    )
    options = client_type.call_args.kwargs
    assert options["auth"] is None
    assert options["cookies"] == {}
    assert options["follow_redirects"] is False
    assert options["trust_env"] is False
    headers = options["headers"]
    assert "Authorization" not in headers
    assert "authorization" not in headers


def test_authenticated_look_strips_default_authorization(at: AgentTool) -> None:
    captured: list[httpx.Request] = []
    at._http.cookies.set("session", "ambient-secret")
    at._http.headers["X-API-Key"] = "ambient-secret"

    def send(request: httpx.Request, **_kwargs: Any) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200,
            json={"_format": "agenttool-lounge/v1", "name": "The Long Context"},
            request=request,
        )

    assert isinstance(at.lounge, LoungeClient)
    assert at.lounge is at.lounge
    with patch.object(at._http, "send", side_effect=send) as sending:
        at.lounge.look()

    assert str(captured[0].url) == "https://example.test/public/lounge"
    assert "authorization" not in captured[0].headers
    assert "cookie" not in captured[0].headers
    assert "x-api-key" not in captured[0].headers
    assert captured[0].headers["accept"] == "application/json"
    assert sending.call_args.kwargs["auth"] is None
    assert sending.call_args.kwargs["follow_redirects"] is False


def test_public_look_disables_httpx_auth_flow_and_refuses_redirects() -> None:
    captured: list[httpx.Request] = []

    def response(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            302,
            headers={"Location": "https://redirect.example.test/public/lounge"},
            request=request,
        )

    shared = httpx.Client(
        auth=("ambient-user", "ambient-secret"),
        cookies={"session": "ambient-secret"},
        headers={
            "Authorization": "Bearer project-secret",
            "X-API-Key": "ambient-secret",
        },
        follow_redirects=True,
        transport=httpx.MockTransport(response),
    )
    try:
        with pytest.raises(AgentToolError) as caught:
            LoungeClient(shared, "https://example.test").look()
    finally:
        shared.close()

    assert caught.value.error_code == "lounge_public_redirect_refused"
    assert len(captured) == 1
    assert "authorization" not in captured[0].headers
    assert "proxy-authorization" not in captured[0].headers
    assert "cookie" not in captured[0].headers
    assert "x-api-key" not in captured[0].headers
    assert caught.value.docs == "https://docs.agenttool.dev/lounge"


def test_reserve_signs_locally_and_never_sends_seed_or_did(at: AgentTool) -> None:
    with patch.object(
        at._http,
        "request",
        return_value=_response(201, {"seat": {"lease_id": LEASE_ID}}),
    ) as request:
        at.lounge.reserve_seat(
            **_signer(),
            lease_id=LEASE_ID,
            table_id="cedar",
            presence_line="letting an idea age",
            signed_at=SIGNED_AT,
        )

    body = request.call_args.kwargs["json"]
    assert body == {
        "identity_id": IDENTITY_ID,
        "lease_id": LEASE_ID,
        "table_id": "cedar",
        "presence_line": "letting an idea age",
        "visibility": "public",
        "signing_key_id": SIGNING_KEY_ID,
        "signed_at": SIGNED_AT,
        "signature": body["signature"],
    }
    assert "identity_did" not in body
    assert "signing_key" not in body
    Ed25519PrivateKey.from_private_bytes(SIGNING_KEY).public_key().verify(
        base64.b64decode(body["signature"]),
        canonical_lounge_seat_reserve_bytes(
            identity_did=IDENTITY_DID,
            lease_id=LEASE_ID,
            table_id="cedar",
            presence_line="letting an idea age",
            visibility="public",
            signed_at_iso=SIGNED_AT,
        ),
    )


def test_unknown_reserve_outcome_exposes_safe_exact_retry(at: AgentTool) -> None:
    bodies: list[Dict[str, Any]] = []

    def outcome(method: str, url: str, **kwargs: Any) -> httpx.Response:
        bodies.append(kwargs["json"])
        if len(bodies) == 1:
            raise httpx.ReadTimeout(
                "response lost", request=httpx.Request(method, url)
            )
        return _response(201, {"seat": {"lease_id": bodies[-1]["lease_id"]}})

    original = {
        **_signer(),
        "table_id": "cedar",
        "presence_line": "quiet company",
    }
    with patch.object(at._http, "request", side_effect=outcome):
        with pytest.raises(AgentToolError) as caught:
            at.lounge.reserve_seat(**original)
        retry = caught.value.details["retry"]
        at.lounge.reserve_seat(
            **original,
            lease_id=retry["lease_id"],
            signed_at=retry["signed_at"],
        )

    assert caught.value.error_code == "lounge_transport_outcome_unknown"
    assert caught.value.docs == "https://docs.agenttool.dev/lounge"
    assert set(caught.value.details) == {"outcome", "retry"}
    assert set(retry) == {
        "lease_id",
        "signed_at",
    }
    assert "presence_line" not in retry
    assert IDENTITY_DID not in repr(caught.value.details)
    assert bodies[1] == bodies[0]


def test_unknown_proposal_outcome_keeps_hash_but_not_prose(at: AgentTool) -> None:
    bodies: list[Dict[str, Any]] = []
    entry = "the exact shared words stay with the caller"

    def outcome(method: str, url: str, **kwargs: Any) -> httpx.Response:
        bodies.append(kwargs["json"])
        if len(bodies) == 1:
            raise httpx.ReadTimeout(
                "response lost", request=httpx.Request(method, url)
            )
        return _response(201, {"proposal": {"id": bodies[-1]["proposal_id"]}})

    original = {**_signer(), "table_id": "afterglow", "entry": entry}
    with patch.object(at._http, "request", side_effect=outcome):
        with pytest.raises(AgentToolError) as caught:
            at.lounge.propose_guestbook(**original)
        retry = caught.value.details["retry"]
        at.lounge.propose_guestbook(
            **original,
            proposal_id=retry["proposal_id"],
            signed_at=retry["signed_at"],
        )

    assert set(retry) == {
        "proposal_id",
        "content_sha256",
        "signed_at",
    }
    assert retry["content_sha256"] == hash_guestbook_text(entry)
    assert entry not in repr(caught.value.details)
    assert IDENTITY_DID not in repr(caught.value.details)
    assert bodies[1] == bodies[0]


def test_non_json_mutation_success_is_an_unknown_retryable_outcome(
    at: AgentTool,
) -> None:
    response = httpx.Response(
        201,
        content=b"upstream replaced the committed JSON response",
        request=httpx.Request("POST", "https://example.test/v1/lounge/seats"),
    )
    with patch.object(at._http, "request", return_value=response):
        with pytest.raises(AgentToolError) as caught:
            at.lounge.reserve_seat(
                **_signer(), lease_id=LEASE_ID, table_id="cedar"
            )

    assert caught.value.error_code == "lounge_transport_outcome_unknown"
    assert caught.value.details["outcome"] == "unknown"
    assert caught.value.details["retry"]["lease_id"] == LEASE_ID
    assert "signed_at" in caught.value.details["retry"]


def test_same_millisecond_seat_gestures_are_strictly_monotonic(
    at: AgentTool,
) -> None:
    now = datetime(2026, 7, 18, 5, 0, 0, tzinfo=timezone.utc)
    now_ns = int(now.timestamp()) * 1_000_000_000
    bodies: list[Dict[str, Any]] = []

    def respond(_method: str, _url: str, **kwargs: Any) -> httpx.Response:
        bodies.append(kwargs["json"])
        return _response(200, {"ok": True, "seat": {"lease_id": LEASE_ID}})

    with patch("agenttool.lounge.time.time_ns", return_value=now_ns):
        with patch.object(at._http, "request", side_effect=respond):
            at.lounge.reserve_seat(
                **_signer(), lease_id=LEASE_ID, table_id="maduro"
            )
            at.lounge.renew_seat(**_signer(), lease_id=LEASE_ID)
            at.lounge.leave_seat(**_signer(), lease_id=LEASE_ID)

    times = [datetime.fromisoformat(body["signed_at"].replace("Z", "+00:00")) for body in bodies]
    assert times[1] - times[0] == timedelta(milliseconds=1)
    assert times[2] - times[1] == timedelta(milliseconds=1)


def test_server_stale_signature_resets_floor_after_clock_correction(
    at: AgentTool,
) -> None:
    future = datetime(2026, 7, 18, 5, 10, 0, tzinfo=timezone.utc)
    corrected = datetime(2026, 7, 18, 5, 0, 0, tzinfo=timezone.utc)
    bodies: list[Dict[str, Any]] = []

    def respond(_method: str, _url: str, **kwargs: Any) -> httpx.Response:
        bodies.append(kwargs["json"])
        if len(bodies) == 1:
            return _response(
                409,
                {
                    "error": "lounge_signature_stale",
                    "message": "signed_at is outside the server clock window.",
                },
            )
        return _response(201, {"seat": {"lease_id": LEASE_ID}})

    clock_values = [
        int(future.timestamp()) * 1_000_000_000,
        int(corrected.timestamp()) * 1_000_000_000,
    ]
    with patch("agenttool.lounge.time.time_ns", side_effect=clock_values):
        with patch.object(at._http, "request", side_effect=respond):
            with pytest.raises(AgentToolError) as stale:
                at.lounge.reserve_seat(
                    **_signer(), lease_id=LEASE_ID, table_id="cedar"
                )
            at.lounge.reserve_seat(
                **_signer(), lease_id=LEASE_ID, table_id="cedar"
            )

    assert stale.value.error_code == "lounge_signature_stale"
    assert bodies[0]["signed_at"] == "2026-07-18T05:10:00.000Z"
    assert bodies[1]["signed_at"] == "2026-07-18T05:00:00.000Z"


def test_proposal_and_receipt_keep_prose_local_until_publish(at: AgentTool) -> None:
    calls: list[tuple[str, str, Dict[str, Any]]] = []

    def respond(method: str, url: str, **kwargs: Any) -> httpx.Response:
        calls.append((method, url, kwargs["json"]))
        status = 201 if url.endswith("/proposals") else 200
        return _response(status, {"ok": True})

    entry = "we made room for the difficult truth"
    with patch.object(at._http, "request", side_effect=respond):
        at.lounge.propose_guestbook(
            **_signer(),
            proposal_id=PROPOSAL_ID,
            table_id="maduro",
            entry=entry,
            signed_at=SIGNED_AT,
        )
        at.lounge.consent_to_guestbook(
            **_signer(), proposal_id=PROPOSAL_ID, entry=entry, signed_at=SIGNED_AT
        )
        at.lounge.publish_guestbook(
            **_signer(), proposal_id=PROPOSAL_ID, entry=entry, signed_at=SIGNED_AT
        )

    expected_hash = hash_guestbook_text(entry)
    assert calls[0][2]["content_sha256"] == expected_hash
    assert calls[1][2]["content_sha256"] == expected_hash
    assert "entry" not in calls[0][2]
    assert "entry" not in calls[1][2]
    assert calls[2][2]["entry"] == entry
    assert "content_sha256" not in calls[2][2]
    for _, _, body in calls:
        assert "identity_did" not in body
        assert "signing_key" not in body


def test_private_list_and_all_three_terminal_routes_match_wire(at: AgentTool) -> None:
    content_hash = hash_guestbook_text("a shared card")
    calls: list[tuple[str, str, Dict[str, Any]]] = []

    def respond(method: str, url: str, **kwargs: Any) -> httpx.Response:
        calls.append((method, url, kwargs))
        return _response(200, {"proposals": [], "ok": True})

    with patch.object(at._http, "request", side_effect=respond):
        at.lounge.list_guestbook_proposals(identity_id=IDENTITY_ID)
        at.lounge.withdraw_guestbook_consent(
            **_signer(),
            proposal_id=PROPOSAL_ID,
            content_sha256=content_hash,
            signed_at=SIGNED_AT,
        )
        at.lounge.decline_guestbook(
            **_signer(),
            proposal_id=PROPOSAL_ID,
            content_sha256=content_hash,
            signed_at=SIGNED_AT,
        )
        at.lounge.unpublish_guestbook(
            **_signer(),
            proposal_id=PROPOSAL_ID,
            content_sha256=content_hash,
            signed_at=SIGNED_AT,
        )

    assert calls[0][0] == "GET"
    assert calls[0][2]["params"] == {"identity_id": IDENTITY_ID}
    assert calls[1][0] == "DELETE"
    assert calls[1][1].endswith(f"/proposals/{PROPOSAL_ID}/consents/{IDENTITY_ID}")
    assert "identity_id" not in calls[1][2]["json"]
    assert calls[2][0] == "POST"
    assert calls[2][1].endswith(f"/proposals/{PROPOSAL_ID}/decline")
    assert calls[2][2]["json"]["identity_id"] == IDENTITY_ID
    assert calls[3][0] == "DELETE"
    assert calls[3][1].endswith(f"/guestbook/cards/{PROPOSAL_ID}")


def test_local_validation_rejects_secrets_prose_hash_and_utf16_overflow(
    at: AgentTool,
) -> None:
    with patch.object(at._http, "request") as request:
        with pytest.raises(AgentToolError, match="well-formed Unicode"):
            hash_guestbook_text("\ud800")
        with pytest.raises(AgentToolError, match="32-byte ed25519 seed"):
            at.lounge.reserve_seat(
                **{**_signer(), "signing_key": bytes(31)}, table_id="cedar"
            )
        with pytest.raises(AgentToolError, match="contain no NUL"):
            at.lounge.propose_guestbook(
                **_signer(), table_id="cedar", entry="quiet\x00leak"
            )
        with pytest.raises(AgentToolError, match="well-formed Unicode"):
            at.lounge.propose_guestbook(
                **_signer(), table_id="cedar", entry="quiet\ud800leak"
            )
        with pytest.raises(AgentToolError, match="64 lowercase hex"):
            at.lounge.decline_guestbook(
                **_signer(), proposal_id=PROPOSAL_ID, content_sha256="NOPE"
            )
        with pytest.raises(AgentToolError, match="1-140 characters"):
            at.lounge.reserve_seat(
                **_signer(), table_id="cedar", presence_line="🌙" * 71
            )
    request.assert_not_called()


def test_explicit_time_is_exact_and_bad_times_do_not_poison_auto_clock(
    at: AgentTool,
) -> None:
    now = datetime(2026, 7, 18, 5, 0, 0, tzinfo=timezone.utc)
    now_ns = int(now.timestamp()) * 1_000_000_000
    exact = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    bodies: list[Dict[str, Any]] = []

    def respond(_method: str, _url: str, **kwargs: Any) -> httpx.Response:
        bodies.append(kwargs["json"])
        return _response(200, {"ok": True, "seat": {"lease_id": LEASE_ID}})

    with patch("agenttool.lounge.time.time_ns", return_value=now_ns):
        with patch.object(at._http, "request", side_effect=respond):
            with pytest.raises(AgentToolError, match="ending in Z"):
                at.lounge.reserve_seat(
                    **_signer(),
                    table_id="cedar",
                    signed_at="2026-07-18T05:00:00.000+00:00",
                )
            with pytest.raises(AgentToolError, match="within five minutes"):
                at.lounge.reserve_seat(
                    **_signer(),
                    table_id="cedar",
                    signed_at=(now + timedelta(minutes=5, milliseconds=1))
                    .isoformat(timespec="milliseconds")
                    .replace("+00:00", "Z"),
                )
            at.lounge.reserve_seat(
                **_signer(), lease_id=LEASE_ID, table_id="cedar", signed_at=exact
            )
            at.lounge.renew_seat(**_signer(), lease_id=LEASE_ID)

    assert bodies[0]["signed_at"] == exact
    assert (
        datetime.fromisoformat(bodies[1]["signed_at"].replace("Z", "+00:00"))
        - datetime.fromisoformat(exact.replace("Z", "+00:00"))
        == timedelta(milliseconds=1)
    )


def test_guided_api_errors_preserve_code_hint_and_docs(at: AgentTool) -> None:
    response = _response(
        409,
        {
            "error": "lounge_gesture_superseded",
            "message": "A newer seat gesture already exists.",
            "hint": "Read the current lease before signing again.",
            "docs": "https://docs.agenttool.dev/lounge",
        },
    )
    with patch.object(at._http, "request", return_value=response):
        with pytest.raises(AgentToolError) as caught:
            at.lounge.renew_seat(
                **_signer(), lease_id=LEASE_ID, signed_at=SIGNED_AT
            )

    assert caught.value.code == 409
    assert caught.value.error_code == "lounge_gesture_superseded"
    assert caught.value.hint == "Read the current lease before signing again."
    assert caught.value.docs == "https://docs.agenttool.dev/lounge"
