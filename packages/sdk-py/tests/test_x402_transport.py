"""The opt-in paying transport + ``at.x402`` — Wave 2 Phase C (W2-9).

Every request is an ``httpx.MockTransport``; no network, no keychain, no real
key. The payer is the fixture's public documentation test key and the
challenge is the exact ``PaymentRequired`` the server produced
(``fixtures/x402-eip3009-vector.json``).

What is pinned here is the doctrine, not the crypto (``test_x402.py`` pins
the bytes):

* no ``x402=`` → the SDK never signs; a 402 surfaces untouched
* ``x402=`` present → exactly two requests: bare → 402 → ONE signed retry
* the retry is the same request (method, URL, body, bearer,
  Idempotency-Key) plus ``PAYMENT-SIGNATURE``
* a second 402 is a typed error, never a loop
* a policy refusal is a typed error with the refusal code, nothing signed
* the env fallback is read only when ``x402=`` is present
* ``x402=`` beside a caller-owned ``transport=`` is refused at construction
* a policy without ``max_amount_atomic`` / ``allowed_pay_to`` is refused at
  construction

Parity counterpart: ``packages/sdk-ts/tests/x402-transport.test.ts``.
"""

from __future__ import annotations

import base64
import json
import os
import re
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple
from unittest.mock import patch

import httpx
import pytest

import agenttool
from agenttool import AgentTool, AgentToolError, NotFoundError
from agenttool import _x402_transport as transport_module
from agenttool._x402_transport import (
    X402_PRIVATE_KEY_ENV,
    X402Payer,
    X402PayingTransport,
    X402PaymentEvent,
    _payment_id_from_status_link,
    resolve_x402_payer,
)
from agenttool.x402 import (
    BASE_NETWORK,
    BASE_USDC,
    KINGDOM_TREASURY,
    TRANSFER_WITH_AUTHORIZATION_TYPES,
    X402Client,
    X402SpendPolicy,
    X402TopUpResult,
    authorization_hash,
    decode_canonical_base64,
    decode_payment_required_header,
    decode_payment_response_header,
    encode_canonical_base64_json,
    local_evm_signer,
    recover_typed_data_address,
)

FIXTURE = Path(__file__).parent / "fixtures" / "x402-eip3009-vector.json"
VECTOR: Dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))

PAYER_KEY: str = VECTOR["privateKey"]
PAYER_ADDRESS: str = VECTOR["payer"]
NOW: int = VECTOR["clientRun"]["nowSeconds"]
CHALLENGE_BODY: Dict[str, Any] = VECTOR["paymentRequiredBody"]
CHALLENGE_HEADER: str = encode_canonical_base64_json(CHALLENGE_BODY)
LEDGER_ID = "a" * 64
STATUS_LINK = f'</v1/x402/payments/{LEDGER_ID}>; rel="payment-status"'
RECEIPT = encode_canonical_base64_json({"success": True, "transaction": "0x33", "network": BASE_NETWORK})
BASE_URL = "https://api.agenttool.dev"


def _policy(**overrides: Any) -> X402SpendPolicy:
    fields: Dict[str, Any] = {
        "max_amount_atomic": 10_000,
        "allowed_pay_to": [KINGDOM_TREASURY],
        "allowed_networks": [BASE_NETWORK],
        "allowed_assets": [BASE_USDC],
        "max_validity_seconds": 60,
    }
    fields.update(overrides)
    return X402SpendPolicy(**fields)


def _challenge_body() -> Dict[str, Any]:
    """The 402 exactly as the API emits it: guidance body with the envelope
    spread over it, plus the pure envelope in PAYMENT-REQUIRED."""
    return {
        **CHALLENGE_BODY,
        "error": "top_up_payment_required",
        "message": "Pay 1000 atomic USDC (1 credit) to add 1 credit to this project.",
        "hint": "Sign accepts[0] and retry with PAYMENT-SIGNATURE.",
        "next_actions": [{"action": "pay", "method": "POST", "path": "/v1/x402/top-up/1"}],
    }


def _challenge_402(headers: Optional[Dict[str, str]] = None, *, with_header: bool = True) -> httpx.Response:
    base = {"X-Credits-Balance": "0"}
    if with_header:
        base["PAYMENT-REQUIRED"] = CHALLENGE_HEADER
    base.update(headers or {})
    return httpx.Response(402, json=_challenge_body(), headers=base)


def _settled_200() -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "credits_added": 1,
            "credits_total": 11,
            "authorization_hash": LEDGER_ID,
            "amount_atomic": "1000",
            "unit": "1 credit = 1,000 USDC atomic units (USD 0.001)",
            "finality": "Top-ups are final.",
            "payment_status": f"/v1/x402/payments/{LEDGER_ID}",
        },
        headers={"PAYMENT-RESPONSE": RECEIPT, "Link": STATUS_LINK, "X-Credits-Balance": "11"},
    )


Recorded = Tuple[httpx.Request, bytes]


def _sequence(responses: List[Callable[[], httpx.Response]]) -> Tuple[httpx.MockTransport, List[Recorded]]:
    """A transport answering one canned response per call, recording each
    request (with its body bytes, read at arrival)."""
    calls: List[Recorded] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = request.read() if hasattr(request, "read") else b""
        calls.append((request, body))
        index = len(calls) - 1
        if index >= len(responses):
            raise AssertionError(f"unexpected request #{index + 1} to {request.url}")
        return responses[index]()

    return httpx.MockTransport(handler), calls


class _Paying:
    def __init__(self, at: AgentTool, calls: List[Recorded], events: List[X402PaymentEvent], signer_calls: List[Any]) -> None:
        self.at = at
        self.calls = calls
        self.events = events
        self.signer_calls = signer_calls


def _paying_client(
    responses: List[Callable[[], httpx.Response]],
    *,
    policy: Optional[X402SpendPolicy] = None,
    signer: Any = None,
    payer_address: Optional[str] = None,
) -> _Paying:
    """An ``AgentTool`` constructed with ``x402=`` whose inner transport is a
    MockTransport. The SDK installs ``X402PayingTransport`` over a real
    ``HTTPTransport``; the test swaps only the inner leg so nothing leaves
    the process."""
    events: List[X402PaymentEvent] = []
    signer_calls: List[Any] = []
    inner_signer = signer or local_evm_signer(PAYER_KEY)

    def counting_signer(typed_data: Any) -> str:
        signer_calls.append(typed_data)
        return inner_signer(typed_data)

    counting_signer.address = getattr(inner_signer, "address", None)  # type: ignore[attr-defined]

    at = AgentTool(
        api_key="test-key-123",
        x402=X402Payer(
            signer=counting_signer,
            payer_address=payer_address,
            policy=policy or _policy(),
            on_payment=events.append,
            now_seconds=lambda: NOW,
        ),
    )
    paying = at._http._transport
    assert isinstance(paying, X402PayingTransport)
    mock, calls = _sequence(responses)
    paying._inner = mock
    return _Paying(at, calls, events, signer_calls)


def _decode_payment_signature(header: str) -> Dict[str, Any]:
    raw = decode_canonical_base64(header)
    assert raw is not None, "PAYMENT-SIGNATURE must be canonical base64"
    return json.loads(raw.decode("utf-8"))


# ── exactly two requests ───────────────────────────────────────────────────


class TestExactlyTwoRequests:
    def test_402_then_one_signed_retry_carrying_the_same_request(self) -> None:
        paying = _paying_client([_challenge_402, _settled_200])
        with paying.at as at:
            result = at.x402.top_up(1, idempotency_key="idem-1")

        assert len(paying.calls) == 2
        (bare, bare_body), (retry, retry_body) = paying.calls

        # Same request: method, URL, body, bearer, Idempotency-Key.
        assert bare.method == retry.method == "POST"
        assert str(bare.url) == str(retry.url) == f"{BASE_URL}/v1/x402/top-up/1"
        assert bare_body == retry_body == b""
        assert bare.headers["Authorization"] == retry.headers["Authorization"] == "Bearer test-key-123"
        assert bare.headers["Idempotency-Key"] == retry.headers["Idempotency-Key"] == "idem-1"
        assert "PAYMENT-SIGNATURE" not in bare.headers
        # Only PAYMENT-SIGNATURE was added.
        added = {k for k in retry.headers.keys()} - {k for k in bare.headers.keys()}
        assert {k.lower() for k in added} == {"payment-signature"}

        # The header is the x402 V2 PaymentPayload, in the server's key order,
        # echoing the challenge's resource and the accepted requirement.
        payload = _decode_payment_signature(retry.headers["PAYMENT-SIGNATURE"])
        assert list(payload.keys()) == ["x402Version", "resource", "accepted", "payload"]
        assert payload["x402Version"] == 2
        assert payload["resource"] == CHALLENGE_BODY["resource"]
        assert payload["accepted"] == CHALLENGE_BODY["accepts"][0]
        assert list(payload["payload"].keys()) == ["signature", "authorization"]
        auth = payload["payload"]["authorization"]
        assert list(auth.keys()) == ["from", "to", "value", "validAfter", "validBefore", "nonce"]
        assert auth["from"] == PAYER_ADDRESS
        assert auth["to"] == KINGDOM_TREASURY
        assert auth["value"] == "1000"
        assert auth["validAfter"] == str(NOW - 1)
        assert auth["validBefore"] == str(NOW + 60)
        assert re.fullmatch(r"0x[0-9a-f]{64}", auth["nonce"])

        # The signature recovers to the payer — the check the server makes.
        requirement = CHALLENGE_BODY["accepts"][0]
        typed_data = {
            "domain": {
                "name": requirement["extra"]["name"],
                "version": requirement["extra"]["version"],
                "chainId": 8453,
                "verifyingContract": requirement["asset"],
            },
            "types": TRANSFER_WITH_AUTHORIZATION_TYPES,
            "primaryType": "TransferWithAuthorization",
            "message": {
                "from": auth["from"],
                "to": auth["to"],
                "value": int(auth["value"]),
                "validAfter": int(auth["validAfter"]),
                "validBefore": int(auth["validBefore"]),
                "nonce": auth["nonce"],
            },
        }
        assert recover_typed_data_address(typed_data, payload["payload"]["signature"]) == PAYER_ADDRESS
        assert len(paying.signer_calls) == 1

        # The receipt, camel→snake, plus the raw settlement headers.
        assert isinstance(result, X402TopUpResult)
        assert result.credits_added == 1
        assert result.credits_total == 11
        assert result.authorization_hash == LEDGER_ID
        assert result.amount_atomic == "1000"
        assert result.unit.startswith("1 credit")
        assert result.finality == "Top-ups are final."
        assert result.payment_status == f"/v1/x402/payments/{LEDGER_ID}"
        assert result.payment_response == RECEIPT
        assert decode_payment_response_header(result.payment_response) == {
            "success": True,
            "transaction": "0x33",
            "network": BASE_NETWORK,
        }
        assert result.payment_status_link == STATUS_LINK
        assert result.credits_balance == "11"

        # on_payment saw the identity of what was emitted, once.
        assert len(paying.events) == 1
        event = paying.events[0]
        assert event.authorization_hash == authorization_hash(auth)
        assert event.valid_before == NOW + 60
        assert event.status == 200
        assert event.payment_response == RECEIPT
        assert event.payment_status_link == STATUS_LINK
        assert event.payment_id == LEDGER_ID
        assert event.credits_balance == "11"

    def test_a_second_402_is_a_typed_error_never_a_third_request(self) -> None:
        paying = _paying_client(
            [_challenge_402, lambda: _challenge_402({"Link": STATUS_LINK, "Retry-After": "3"})]
        )
        with paying.at as at:
            with pytest.raises(AgentToolError) as excinfo:
                at.x402.top_up(1)

        err = excinfo.value
        assert err.code == "x402_payment_not_accepted"
        assert err.status == 402
        assert len(paying.calls) == 2
        assert len(paying.signer_calls) == 1
        assert err.details["authorization_hash"] == paying.events[0].authorization_hash
        assert err.details["valid_before"] == NOW + 60
        assert err.details["payment_id"] == LEDGER_ID
        assert err.details["server_error"] == "top_up_payment_required"
        # The second response's envelope + headers travel intact.
        assert err.accepts == CHALLENGE_BODY["accepts"]
        assert err.payment_required == CHALLENGE_HEADER
        assert err.payment_status_link == STATUS_LINK
        assert err.retry_after == "3"
        assert len(paying.events) == 1

    def test_the_paid_response_of_another_route_flows_back_normally(self) -> None:
        paying = _paying_client(
            [
                _challenge_402,
                lambda: httpx.Response(
                    200,
                    json={"results": [], "total": 0},
                    headers={"PAYMENT-RESPONSE": RECEIPT, "Link": STATUS_LINK},
                ),
            ]
        )
        with paying.at as at:
            results = at.memory.search("paid search")
        assert results == []
        assert len(paying.calls) == 2
        bare, retry = paying.calls[0][0], paying.calls[1][0]
        assert str(bare.url) == str(retry.url)
        assert paying.calls[0][1] == paying.calls[1][1] != b""  # the JSON body was re-sent byte-identical
        assert paying.events[0].payment_id == LEDGER_ID

    def test_a_2xx_is_never_signed_for(self) -> None:
        paying = _paying_client([_settled_200])
        with paying.at as at:
            at.x402.top_up(1)
        assert len(paying.calls) == 1
        assert paying.signer_calls == []
        assert paying.events == []

    def test_a_custom_signer_with_payer_address_is_called_exactly_once(self) -> None:
        inner = local_evm_signer(PAYER_KEY)
        seen: List[Any] = []

        def wallet(typed_data: Any) -> str:  # no .address attribute
            seen.append(typed_data)
            return inner(typed_data)

        paying = _paying_client([_challenge_402, _settled_200], signer=wallet, payer_address=PAYER_ADDRESS)
        with paying.at as at:
            at.x402.top_up(1)
        assert len(seen) == 1
        assert seen[0]["message"]["from"] == PAYER_ADDRESS


# ── walls ──────────────────────────────────────────────────────────────────


class TestWalls:
    def test_no_x402_option_means_the_402_surfaces_untouched(self) -> None:
        mock, calls = _sequence([_challenge_402])
        with AgentTool(api_key="k", transport=None) as at:
            at._http._transport = mock
            with pytest.raises(AgentToolError) as excinfo:
                at.x402.top_up(1)
        err = excinfo.value
        assert err.status == 402
        assert err.code == "top_up_payment_required"
        assert err.accepts == CHALLENGE_BODY["accepts"]
        assert err.payment_required == CHALLENGE_HEADER
        assert err.x402_resource == CHALLENGE_BODY["resource"]
        assert err.credits_balance == "0"
        assert len(calls) == 1
        assert not isinstance(at._http._transport, X402PayingTransport)

    def test_env_key_alone_never_pays(self) -> None:
        with patch.dict(os.environ, {X402_PRIVATE_KEY_ENV: PAYER_KEY}):
            with AgentTool(api_key="k") as at:
                assert not isinstance(at._http._transport, X402PayingTransport)

    def test_amount_over_cap_is_refused_not_clamped(self) -> None:
        paying = _paying_client([_challenge_402], policy=_policy(max_amount_atomic=999))
        with paying.at as at:
            with pytest.raises(AgentToolError) as excinfo:
                at.x402.top_up(1)
        err = excinfo.value
        assert err.code == "amount_over_cap"
        assert err.status == 402
        assert err.message.startswith("x402: not paying — ")
        assert err.details["refusal"].reason == "amount_over_cap"
        assert err.details["server_error"] == "top_up_payment_required"
        # The challenge is still attached; nothing was signed; one request.
        assert err.accepts == CHALLENGE_BODY["accepts"]
        assert err.payment_required == CHALLENGE_HEADER
        assert err.next_actions == _challenge_body()["next_actions"]
        assert len(paying.calls) == 1
        assert paying.signer_calls == []
        assert paying.events == []

    def test_a_402_cannot_choose_the_recipient(self) -> None:
        other = "0x000000000000000000000000000000000000dEaD"
        paying = _paying_client([_challenge_402], policy=_policy(allowed_pay_to=[other]))
        with paying.at as at:
            with pytest.raises(AgentToolError) as excinfo:
                at.x402.top_up(1)
        assert excinfo.value.code == "pay_to_not_allowed"
        assert len(paying.calls) == 1
        assert paying.signer_calls == []

    def test_a_caller_supplied_payment_signature_is_never_signed_over(self) -> None:
        paying = _paying_client([_challenge_402])
        with paying.at as at:
            with pytest.raises(AgentToolError) as excinfo:
                at.x402.top_up(1, payment_signature="ZXh0ZXJuYWw=")
        assert excinfo.value.code == "top_up_payment_required"
        assert len(paying.calls) == 1
        assert paying.calls[0][0].headers["PAYMENT-SIGNATURE"] == "ZXh0ZXJuYWw="
        assert paying.signer_calls == []

    def test_a_402_without_a_challenge_surfaces_untouched(self) -> None:
        paying = _paying_client(
            [
                lambda: httpx.Response(
                    402,
                    json={"error": "payment_admission_unavailable", "message": "Rail not ready."},
                    headers={"Retry-After": "30"},
                )
            ]
        )
        with paying.at as at:
            with pytest.raises(AgentToolError) as excinfo:
                at.x402.top_up(1)
        err = excinfo.value
        assert err.code == "payment_admission_unavailable"
        assert err.retry_after == "30"
        assert err.accepts is None
        assert len(paying.calls) == 1
        assert paying.signer_calls == []

    def test_a_replay_suppressed_402_surfaces_untouched(self) -> None:
        paying = _paying_client(
            [
                lambda: httpx.Response(
                    402,
                    json={"error": "payment_already_settled", "message": "Already settled."},
                    headers={"PAYMENT-RESPONSE": RECEIPT, "Link": STATUS_LINK},
                )
            ]
        )
        with paying.at as at:
            with pytest.raises(AgentToolError) as excinfo:
                at.x402.top_up(1)
        err = excinfo.value
        assert err.code == "payment_already_settled"
        assert err.payment_response == RECEIPT
        assert err.payment_status_link == STATUS_LINK
        assert len(paying.calls) == 1
        assert paying.signer_calls == []

    def test_a_malformed_challenge_is_not_paid(self) -> None:
        bad_body = {**_challenge_body(), "accepts": [{"scheme": "exact"}]}
        paying = _paying_client(
            [lambda: httpx.Response(402, json=bad_body, headers={"PAYMENT-REQUIRED": "not base64!"})]
        )
        with paying.at as at:
            with pytest.raises(AgentToolError) as excinfo:
                at.x402.top_up(1)
        assert excinfo.value.code == "top_up_payment_required"
        assert len(paying.calls) == 1
        assert paying.signer_calls == []

    def test_the_challenge_is_read_from_the_body_when_the_header_is_absent(self) -> None:
        paying = _paying_client([lambda: _challenge_402(with_header=False), _settled_200])
        with paying.at as at:
            at.x402.top_up(1)
        assert len(paying.calls) == 2
        assert len(paying.signer_calls) == 1

    def test_the_header_wins_over_the_body(self) -> None:
        # Body says 1000; the header (the pure envelope) is what gets paid.
        body = _challenge_body()
        body["accepts"] = [{**body["accepts"][0], "amount": "999999"}]
        paying = _paying_client(
            [lambda: httpx.Response(402, json=body, headers={"PAYMENT-REQUIRED": CHALLENGE_HEADER}), _settled_200]
        )
        with paying.at as at:
            at.x402.top_up(1)
        payload = _decode_payment_signature(paying.calls[1][0].headers["PAYMENT-SIGNATURE"])
        assert payload["payload"]["authorization"]["value"] == "1000"

    def test_a_stream_body_is_refused_before_anything_is_signed(self) -> None:
        paying = _paying_client([_challenge_402])
        with paying.at as at:
            with pytest.raises(AgentToolError) as excinfo:
                at._http.post(f"{BASE_URL}/v1/x402/top-up/1", content=iter([b"{}"]))
        err = excinfo.value
        assert err.code == "x402_request_not_replayable"
        assert err.status == 402
        assert err.accepts == CHALLENGE_BODY["accepts"]
        assert len(paying.calls) == 1
        assert paying.signer_calls == []

    def test_a_retry_that_fails_on_the_wire_still_reports_what_was_emitted(self) -> None:
        def boom() -> httpx.Response:
            raise httpx.ConnectError("wire down")

        paying = _paying_client([_challenge_402, boom])
        with paying.at as at:
            with pytest.raises(httpx.ConnectError):
                at._http.post(f"{BASE_URL}/v1/x402/top-up/1")
        assert len(paying.signer_calls) == 1
        assert len(paying.events) == 1
        event = paying.events[0]
        assert event.status is None
        assert event.payment_id is None
        assert re.fullmatch(r"[0-9a-f]{64}", event.authorization_hash)
        assert event.valid_before == NOW + 60

    def test_the_low_level_request_door_keeps_the_typed_refusal(self) -> None:
        paying = _paying_client([_challenge_402], policy=_policy(max_amount_atomic=1))
        with paying.at as at:
            with pytest.raises(AgentToolError) as excinfo:
                at.request("POST", "/v1/x402/top-up/1")
        assert excinfo.value.code == "amount_over_cap"


# ── construction ───────────────────────────────────────────────────────────


class TestConstruction:
    def test_x402_beside_a_caller_transport_is_refused(self) -> None:
        mock, calls = _sequence([])
        with pytest.raises(AgentToolError) as excinfo:
            AgentTool(
                transport=mock,
                x402=X402Payer(signer=local_evm_signer(PAYER_KEY), policy=_policy()),
            )
        assert excinfo.value.code == "conflicting_x402_transport"
        assert calls == []

    def test_max_amount_atomic_is_mandatory(self) -> None:
        with pytest.raises(TypeError):
            X402SpendPolicy(allowed_pay_to=[KINGDOM_TREASURY])  # type: ignore[call-arg]
        with pytest.raises(AgentToolError) as excinfo:
            X402Payer(signer=local_evm_signer(PAYER_KEY), policy={"allowed_pay_to": [KINGDOM_TREASURY]})
        assert excinfo.value.code == "x402_spend_policy_invalid"

    def test_allowed_pay_to_is_mandatory(self) -> None:
        with pytest.raises(TypeError):
            X402SpendPolicy(max_amount_atomic=10)  # type: ignore[call-arg]
        with pytest.raises(AgentToolError) as excinfo:
            X402Payer(signer=local_evm_signer(PAYER_KEY), policy={"max_amount_atomic": 10, "allowed_pay_to": []})
        assert excinfo.value.code == "x402_spend_policy_invalid"

    def test_a_mapping_policy_is_promoted_to_a_spend_policy(self) -> None:
        payer = X402Payer(
            signer=local_evm_signer(PAYER_KEY),
            policy={"max_amount_atomic": 10, "allowed_pay_to": [KINGDOM_TREASURY]},
        )
        assert isinstance(payer.policy, X402SpendPolicy)
        assert payer.policy.allowed_networks == (BASE_NETWORK,)

    def test_no_policy_or_a_non_payer_option_is_refused(self) -> None:
        with pytest.raises(AgentToolError) as excinfo:
            X402Payer(signer=local_evm_signer(PAYER_KEY), policy=None)  # type: ignore[arg-type]
        assert excinfo.value.code == "x402_spend_policy_invalid"
        with pytest.raises(AgentToolError) as excinfo:
            AgentTool(api_key="k", x402={"policy": _policy()})  # type: ignore[arg-type]
        assert excinfo.value.code == "x402_option_invalid"

    def test_a_signer_that_is_not_callable_is_refused(self) -> None:
        with pytest.raises(AgentToolError) as excinfo:
            X402Payer(signer="0xabc", policy=_policy())  # type: ignore[arg-type]
        assert excinfo.value.code == "x402_signer_invalid"

    def test_a_custom_signer_without_an_address_needs_payer_address(self) -> None:
        with pytest.raises(AgentToolError) as excinfo:
            X402Payer(signer=lambda typed_data: "0x", policy=_policy())
        assert excinfo.value.code == "x402_signer_invalid"
        with pytest.raises(AgentToolError) as excinfo:
            X402Payer(signer=lambda typed_data: "0x", policy=_policy(), payer_address="0xNOTANADDRESS")
        assert excinfo.value.code == "x402_signer_invalid"
        ok = X402Payer(signer=lambda typed_data: "0x", policy=_policy(), payer_address=PAYER_ADDRESS)
        assert ok.payer_address == PAYER_ADDRESS

    def test_callbacks_must_be_callable_when_given(self) -> None:
        signer = local_evm_signer(PAYER_KEY)
        with pytest.raises(AgentToolError) as excinfo:
            X402Payer(signer=signer, policy=_policy(), on_payment="log")  # type: ignore[arg-type]
        assert excinfo.value.code == "x402_option_invalid"
        with pytest.raises(AgentToolError) as excinfo:
            X402Payer(signer=signer, policy=_policy(), now_seconds=NOW)  # type: ignore[arg-type]
        assert excinfo.value.code == "x402_option_invalid"

    def test_env_fallback_is_honoured_only_with_the_option_and_no_signer(self) -> None:
        with patch.dict(os.environ, {X402_PRIVATE_KEY_ENV: PAYER_KEY}):
            resolved = resolve_x402_payer(X402Payer(policy=_policy()), os.environ)
        assert resolved.payer_address == PAYER_ADDRESS
        with patch.dict(os.environ, {}, clear=True):
            with pytest.raises(AgentToolError) as excinfo:
                AgentTool(api_key="k", x402=X402Payer(policy=_policy()))
        assert excinfo.value.code == "x402_signer_missing"

    def test_an_explicit_signer_wins_over_the_env_key(self) -> None:
        other_key = "0x" + "11" * 32
        signer = local_evm_signer(other_key)
        resolved = resolve_x402_payer(
            X402Payer(signer=signer, policy=_policy()), {X402_PRIVATE_KEY_ENV: PAYER_KEY}
        )
        assert resolved.signer is signer
        assert resolved.payer_address == signer.address  # type: ignore[attr-defined]
        assert resolved.payer_address != PAYER_ADDRESS

    def test_a_malformed_env_key_is_refused_without_echoing_it(self) -> None:
        secret = "0xdeadbeef"
        with pytest.raises(AgentToolError) as excinfo:
            resolve_x402_payer(X402Payer(policy=_policy()), {X402_PRIVATE_KEY_ENV: secret})
        err = excinfo.value
        assert err.code == "x402_private_key_invalid"
        assert secret not in str(err)
        assert secret not in (err.hint or "")

    def test_resolve_never_reads_the_env_when_a_signer_is_given(self) -> None:
        class Tripwire(dict):
            def get(self, key: Any, default: Any = None) -> Any:  # pragma: no cover - the trip
                raise AssertionError(f"env read for {key}")

        signer = local_evm_signer(PAYER_KEY)
        resolved = resolve_x402_payer(X402Payer(signer=signer, policy=_policy()), Tripwire())
        assert resolved.signer is signer

    def test_now_seconds_defaults_to_the_clock(self) -> None:
        resolved = resolve_x402_payer(X402Payer(signer=local_evm_signer(PAYER_KEY), policy=_policy()), {})
        assert isinstance(resolved.now_seconds(), int)
        assert resolved.now_seconds() > 1_700_000_000


# ── at.x402 namespace ──────────────────────────────────────────────────────


class TestX402Namespace:
    def test_is_an_x402_client_cached_and_exported(self) -> None:
        with AgentTool(api_key="k") as at:
            assert isinstance(at.x402, X402Client)
            assert at.x402 is at.x402
        assert agenttool.X402Client is X402Client
        for name in (
            "X402Client",
            "X402Payer",
            "X402PaymentEvent",
            "X402PaymentCallback",
            "X402TopUpResult",
            "X402PaymentStatus",
            "X402_PRIVATE_KEY_ENV",
        ):
            assert name in agenttool.__all__, name

    def test_only_top_up_and_payment_are_public(self) -> None:
        public = sorted(name for name in vars(X402Client) if not name.startswith("_"))
        assert public == ["payment", "top_up"]

    @pytest.mark.parametrize("credits", [0, -1, 1.5, True, "1", 2**53, None])
    def test_top_up_refuses_a_bad_credit_count_locally(self, credits: Any) -> None:
        mock, calls = _sequence([])
        with AgentTool(transport=mock) as at:
            with pytest.raises(AgentToolError) as excinfo:
                at.x402.top_up(credits)  # type: ignore[arg-type]
        assert excinfo.value.code == "top_up_invalid_credits"
        assert calls == []

    def test_top_up_mints_a_fresh_idempotency_key_per_call(self) -> None:
        mock, calls = _sequence([_settled_200, _settled_200])
        with AgentTool(transport=mock) as at:
            at.x402.top_up(1)
            at.x402.top_up(1)
        keys = [request.headers["Idempotency-Key"] for request, _ in calls]
        assert len(set(keys)) == 2
        for key in keys:
            assert re.fullmatch(r"[0-9a-f-]{36}", key)
        assert all("PAYMENT-SIGNATURE" not in request.headers for request, _ in calls)

    def test_top_up_honours_a_caller_key_and_forwards_a_caller_signature(self) -> None:
        mock, calls = _sequence([_settled_200])
        with AgentTool(transport=mock) as at:
            result = at.x402.top_up(3, payment_signature="c2lnbmVk", idempotency_key="idem-3")
        request, body = calls[0]
        assert str(request.url) == f"{BASE_URL}/v1/x402/top-up/3"
        assert request.method == "POST"
        assert body == b""
        assert request.headers["Idempotency-Key"] == "idem-3"
        assert request.headers["PAYMENT-SIGNATURE"] == "c2lnbmVk"
        assert result.credits_added == 1  # the server's word, verbatim

    def test_top_up_fills_a_sparse_receipt_from_what_it_asked_for(self) -> None:
        mock, _ = _sequence([lambda: httpx.Response(200, json={})])
        with AgentTool(transport=mock) as at:
            result = at.x402.top_up(4)
        assert result.credits_added == 4
        assert result.amount_atomic == "4000"
        assert result.credits_total is None
        assert result.authorization_hash is None
        assert result.payment_response is None

    def test_top_up_surfaces_a_400_with_the_servers_guidance(self) -> None:
        guided = {
            "error": "top_up_too_large",
            "message": "At most 1,000 credits per request.",
            "hint": "Split it.",
            "details": {"max_credits": 1000},
        }
        mock, _ = _sequence([lambda: httpx.Response(400, json=guided)])
        with AgentTool(transport=mock) as at:
            with pytest.raises(AgentToolError) as excinfo:
                at.x402.top_up(5000)
        err = excinfo.value
        assert err.code == "top_up_too_large"
        assert err.status == 400
        assert err.hint == "Split it."
        assert err.details == {"max_credits": 1000}

    def test_payment_reads_the_ledger_row_verbatim(self) -> None:
        row = {
            "payment_id": LEDGER_ID,
            "status": "settled",
            "failure_reason": None,
            "scheme": "exact",
            "network": BASE_NETWORK,
            "asset": BASE_USDC,
            "amount": "1000",
            "pay_to": KINGDOM_TREASURY,
            "max_timeout_seconds": 60,
            "requirement_extra": {"name": "USD Coin", "version": "2", "assetTransferMethod": "eip3009"},
            "resource": f"{BASE_URL}/v1/x402/top-up/1",
            "resource_info": {"url": f"{BASE_URL}/v1/x402/top-up/1"},
            "credits_purchased": 1,
            "authorization_evidence": {"signature_class": "eoa_verified"},
            "settlement_attempted_at": "2026-08-30T00:00:00.000Z",
            "transaction": "0x33",
            "receipt": {"success": True},
            "credits_applied": 1,
            "reconciles": "yes",
            "next_action": "none",
            "retry_after_seconds": None,
            "environment_note": None,
            "pending_note": None,
            "updated_at": "2026-08-30T00:00:01.000Z",
        }
        mock, calls = _sequence([lambda: httpx.Response(200, json=row)])
        with AgentTool(transport=mock) as at:
            status = at.x402.payment(LEDGER_ID)
        assert status == row
        request, _ = calls[0]
        assert request.method == "GET"
        assert str(request.url) == f"{BASE_URL}/v1/x402/payments/{LEDGER_ID}"

    @pytest.mark.parametrize("payment_id", ["", None, 12])
    def test_payment_refuses_an_empty_or_non_string_id_locally(self, payment_id: Any) -> None:
        mock, calls = _sequence([])
        with AgentTool(transport=mock) as at:
            with pytest.raises(AgentToolError) as excinfo:
                at.x402.payment(payment_id)
        assert excinfo.value.code == "x402_payment_id_invalid"
        assert calls == []

    def test_payment_encodes_a_hostile_id_under_its_prefix(self) -> None:
        mock, calls = _sequence([lambda: httpx.Response(200, json={})])
        with AgentTool(transport=mock) as at:
            at.x402.payment("../top-up/1?x=1#f")
        url = str(calls[0][0].url)
        assert url.startswith(f"{BASE_URL}/v1/x402/payments/")
        assert "/top-up/" not in url
        assert "?" not in url and "#" not in url

    def test_payment_surfaces_a_404_as_a_typed_error(self) -> None:
        mock, _ = _sequence(
            [lambda: httpx.Response(404, json={"error": "payment_not_found", "message": "No such payment."})]
        )
        with AgentTool(transport=mock) as at:
            with pytest.raises(AgentToolError) as excinfo:
                at.x402.payment("b" * 64)
        err = excinfo.value
        assert err.code == "payment_not_found"
        assert err.status == 404
        assert "No such payment." in str(err)


# ── helpers ────────────────────────────────────────────────────────────────


class TestHelpers:
    def test_payment_id_from_status_link_parses_only_the_payment_status_rel(self) -> None:
        assert _payment_id_from_status_link(STATUS_LINK) == LEDGER_ID
        assert _payment_id_from_status_link(f'<https://api.agenttool.dev/v1/x402/payments/{LEDGER_ID}>; rel="payment-status"') == LEDGER_ID
        assert _payment_id_from_status_link(f'</v1/x402/payments/{LEDGER_ID}>; rel="next"') is None
        assert _payment_id_from_status_link('</v1/x402/payments/zz>; rel="payment-status"') is None
        assert _payment_id_from_status_link(None) is None
        assert _payment_id_from_status_link("") is None

    def test_decode_payment_required_header_round_trips_the_fixture(self) -> None:
        decoded = decode_payment_required_header(CHALLENGE_HEADER)
        assert decoded == {
            "x402Version": 2,
            "error": CHALLENGE_BODY["error"],
            "resource": CHALLENGE_BODY["resource"],
            "accepts": CHALLENGE_BODY["accepts"],
        }
        assert list(decoded.keys()) == ["x402Version", "error", "resource", "accepts"]
        # Guidance keys spread over the body are ignored; a bad header is None.
        guided = decode_payment_required_header(encode_canonical_base64_json(_challenge_body()))
        assert guided == {**decoded, "error": "top_up_payment_required"}
        assert "message" not in guided and "next_actions" not in guided
        assert decode_payment_required_header(CHALLENGE_HEADER + " ") is None
        assert decode_payment_required_header(base64.urlsafe_b64encode(b"{}").decode()) is None

    def test_decode_payment_response_header_is_strict(self) -> None:
        assert decode_payment_response_header(RECEIPT) == {"success": True, "transaction": "0x33", "network": BASE_NETWORK}
        assert decode_payment_response_header(encode_canonical_base64_json({"success": "yes", "transaction": "0x", "network": "n"})) is None
        assert decode_payment_response_header(encode_canonical_base64_json({"success": True, "transaction": "0x", "network": "n", "payer": 1})) is None
        assert decode_payment_response_header("nope") is None

    def test_transport_module_is_internal_to_the_parity_scanner(self) -> None:
        path = Path(transport_module.__file__)
        assert path.name == "_x402_transport.py"
        # And the public module carries the client class the parity target pins.
        x402_source = (path.parent / "x402.py").read_text(encoding="utf-8")
        assert re.search(r"^class X402Client\b", x402_source, flags=re.MULTILINE)
