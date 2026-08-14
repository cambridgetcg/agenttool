"""Agent Dining SDK boundary tests — mocked HTTP only, no network."""

from __future__ import annotations

from typing import get_args, get_type_hints

import httpx
import pytest

from agenttool import (
    DINING_CANON_POINTER,
    DINING_JOURNEY_FORMAT,
    DINING_MANIFEST_FORMAT,
    DINING_PROTOCOL,
    AgentTool,
    DiningClient,
    DiningJourney,
    DiningManifest,
)
from agenttool.exceptions import AgentToolError


INVOCATION_ID = "550e8400-e29b-41d4-a716-446655440000"
LISTING_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"

MANIFEST = {
    "_format": DINING_MANIFEST_FORMAT,
    "protocol": DINING_PROTOCOL,
    "status": "developer_preview",
    "name": "The Table",
    "thesis": "Text is the plate.",
    "semantic_equivalents": {"ingredients": "Sources and capabilities."},
    "economy_binding": {
        "model": "one_sitting_is_one_capability_invocation",
        "discover_menus": "GET /public/listings?tag=agent-dining",
        "publish_menu": "POST /v1/listings",
        "inspect_quote": "GET /public/listings/{listing_id}/quote",
        "book_order_and_hold_payment": (
            "POST /v1/listings/{listing_id}/invoke"
        ),
        "house_acknowledges": (
            "POST /v1/invocations/{invocation_id}/acknowledge"
        ),
        "house_declines": "POST /v1/invocations/{invocation_id}/decline",
        "guest_cancels_before_acknowledgement": (
            "POST /v1/invocations/{invocation_id}/cancel"
        ),
        "serve_and_settle": "POST /v1/invocations/{invocation_id}/complete",
        "read_journey": "GET /v1/dining/{invocation_id}",
        "read_receipt_after_release": (
            "GET /public/settlements/{invocation_id}"
        ),
        "quote_precondition": "Latest gross-price terms must match.",
        "journey_read_effect": "Dining reads never mutate the invocation.",
        "automatic_action": "never",
    },
    "journey": [{"stage": "menu", "meaning": "Reading does not book."}],
    "service_rules": {"default_pacing": "pull_after_delivery"},
    "refusal_and_rest": ["Browsing never invokes, pays, signs, or stores an order."],
    "listing_template": {"body": {"capability_tags": ["agent-dining"]}},
    "invoke_template": {"body": {"expected_quote": {}}},
    "schemas": {
        "sealed_order_plaintext": {"type": "object"},
        "sealed_meal_plaintext": {"type": "object"},
    },
    "sample_menu": {"id": "the-small-kingdom"},
    "honest_boundary": {
        "implemented_now": "One paid invocation and one pure read.",
        "not_implemented": "Partial settlement, tips, ratings, or memory.",
    },
    "_canon_pointer": DINING_CANON_POINTER,
    "verbs": [
        {
            "action": "Browse public dining menus without booking or payment",
            "method": "GET",
            "path": "/public/listings?tag=agent-dining",
        }
    ],
}

JOURNEY = {
    "_format": DINING_JOURNEY_FORMAT,
    "protocol": DINING_PROTOCOL,
    "invocation_id": INVOCATION_ID,
    "listing_id": LISTING_ID,
    "roles": ["guest"],
    "stage": "seller_acknowledged_invocation",
    "marketplace_terminal": False,
    "presentation": {
        "state": "not_delivered",
        "observed_by_agenttool": False,
    },
    "price": {"amount_minor": 1200, "currency": "GBP"},
    "timing": {
        "requested_at": "2026-08-14T09:00:00.000Z",
        "acknowledged_at": "2026-08-14T09:01:00.000Z",
        "sla_deadline_at": "2026-08-14T10:00:00.000Z",
        "settled_at": None,
        "readiness_estimate": "not_observed_by_agenttool",
        "wait_reason": "not_observed_by_agenttool",
        "read_effect": "no_sla_sweep",
    },
    "service": {
        "marketplace_observation": "Seller acknowledgement is recorded.",
        "pacing": "seller_runtime_defined",
        "meal_payload_available": False,
        "explanation_contract": "No private chain-of-thought.",
    },
    "settlement": {
        "state": "held",
        "refund_reason": None,
        "rule": "One signed completion releases the whole escrow.",
    },
    "exit": {
        "presentation": "The local renderer may stop immediately.",
        "economic": "Buyer cancellation is unavailable after acknowledgement.",
    },
    "next_actions": [
        {
            "action": "Read the current dining journey",
            "method": "GET",
            "path": f"/v1/dining/{INVOCATION_ID}",
        },
        {
            "action": "Wait or ask the host to decline.",
            "method": None,
            "path": None,
        },
    ],
    "privacy": "Sealed envelopes and wallet identifiers are omitted.",
    "honesty": ["Seller acknowledgement does not prove active preparation."],
    "_canon_pointer": DINING_CANON_POINTER,
    "verbs": [
        {
            "action": "Read the current dining journey",
            "method": "GET",
            "path": f"/v1/dining/{INVOCATION_ID}",
        }
    ],
}


def _client(payloads, captured):
    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=payloads[request.url.path])

    return AgentTool(
        transport=httpx.MockTransport(handler),
        base_url="https://table.test/",
    )


def test_public_constants_and_typed_discriminants_are_exact() -> None:
    assert DINING_PROTOCOL == "agent-dining/0.1"
    assert DINING_MANIFEST_FORMAT == "agent-dining-manifest/0.1"
    assert DINING_JOURNEY_FORMAT == "agent-dining-journey/0.1"
    assert DINING_CANON_POINTER == "urn:agenttool:doc/AGENT-DINING"

    manifest_format = get_type_hints(DiningManifest)["_format"]
    journey_format = get_type_hints(DiningJourney)["_format"]
    assert get_args(manifest_format) == (DINING_MANIFEST_FORMAT,)
    assert get_args(journey_format) == (DINING_JOURNEY_FORMAT,)


def test_agenttool_composes_one_lazy_client_on_the_authenticated_session() -> None:
    with AgentTool(api_key="project-key") as at:
        dining = at.dining
        assert isinstance(dining, DiningClient)
        assert dining is at.dining
        assert dining._http is at._http
        assert dining._http.headers["authorization"] == "Bearer project-key"


def test_manifest_and_journey_are_exact_get_only_reads() -> None:
    captured = []
    with _client(
        {
            "/v1/dining": MANIFEST,
            f"/v1/dining/{INVOCATION_ID}": JOURNEY,
        },
        captured,
    ) as at:
        assert at.dining.manifest() == MANIFEST
        assert at.dining.journey(INVOCATION_ID) == JOURNEY

    assert [(request.method, str(request.url)) for request in captured] == [
        ("GET", "https://table.test/v1/dining"),
        ("GET", f"https://table.test/v1/dining/{INVOCATION_ID}"),
    ]
    assert all(request.content == b"" for request in captured)


def test_public_client_surface_contains_no_marketplace_mutation() -> None:
    public_methods = {
        name
        for name, value in DiningClient.__dict__.items()
        if callable(value) and not name.startswith("_")
    }
    assert public_methods == {"manifest", "journey"}


def test_journey_id_uses_the_shared_single_segment_encoder() -> None:
    captured = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=JOURNEY)

    hostile_id = "../invocations/other?role=host#meal"
    with AgentTool(transport=httpx.MockTransport(handler)) as at:
        at.dining.journey(hostile_id)

    assert captured[0].url.raw_path == (
        b"/v1/dining/..%2Finvocations%2Fother%3Frole%3Dhost%23meal"
    )
    assert captured[0].url.query == b""
    assert captured[0].url.fragment == ""


@pytest.mark.parametrize("dot_segment", [".", ".."])
def test_journey_refuses_bare_dot_segments_before_transport(dot_segment: str) -> None:
    captured = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=JOURNEY)

    with AgentTool(transport=httpx.MockTransport(handler)) as at:
        with pytest.raises(AgentToolError, match="URL dot segment"):
            at.dining.journey(dot_segment)

    assert captured == []


def test_guided_journey_absence_survives_the_shared_error_boundary() -> None:
    body = {
        "error": "dining_journey_not_found",
        "message": "That dining journey is absent or does not belong to this project.",
        "hint": "Use an invocation bound at creation to agent-dining/0.1.",
        "next_actions": [
            {
                "action": "List this project's guest invocations",
                "method": "GET",
                "path": "/v1/invocations?role=buyer",
            }
        ],
        "docs": "https://docs.agenttool.dev/AGENT-DINING.md",
        "details": {"invocation_id": INVOCATION_ID},
    }

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json=body)

    with AgentTool(transport=httpx.MockTransport(handler)) as at:
        with pytest.raises(AgentToolError) as excinfo:
            at.dining.journey(INVOCATION_ID)

    err = excinfo.value
    assert err.code == "dining_journey_not_found"
    assert err.status == 404
    assert err.message == body["message"]
    assert err.hint == body["hint"]
    assert err.next_actions == body["next_actions"]
    assert err.docs == body["docs"]
    assert err.details == body["details"]
