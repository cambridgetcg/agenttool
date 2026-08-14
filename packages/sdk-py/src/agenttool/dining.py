"""Authenticated, read-only Agent Dining projection.

Dining does two things: it reads the ``agent-dining/0.1`` manifest and it
projects one already-created marketplace invocation into a privacy-minimized
guest/host journey. It does not publish a menu, place an order, acknowledge or
complete an invocation, decrypt either sealed envelope, run the marketplace's
lazy SLA sweep, or move money.

The journey types keep the presentation layer separate from the canonical
marketplace lifecycle. In particular, seller acknowledgement is not proof of
active preparation or exact-order acceptance, and a released settlement is
not a guest approval or quality judgment.

Doctrine: ``docs/AGENT-DINING.md``.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, TypedDict, cast

import httpx

from ._url import _path_segment
from .exceptions import NextAction, raise_from_response


DINING_PROTOCOL = "agent-dining/0.1"
DINING_MANIFEST_FORMAT = "agent-dining-manifest/0.1"
DINING_JOURNEY_FORMAT = "agent-dining-journey/0.1"
DINING_CANON_POINTER = "urn:agenttool:doc/AGENT-DINING"


DiningRole = Literal["guest", "host"]
DiningManifestStage = Literal[
    "menu",
    "booking_and_order",
    "wait",
    "preparation",
    "serving",
    "explaining",
    "settlement",
    "farewell",
]
DiningStage = Literal[
    "order_escrowed_awaiting_host",
    "seller_acknowledged_invocation",
    "meal_delivered_and_settled",
    "guest_cancelled_refunded",
    "house_declined_refunded",
    "service_timed_out_refunded",
    "refunded",
    "buyer_review_resting_unsupported",
    "dispute_resting_unsupported",
]
DiningPresentationState = Literal[
    "not_delivered",
    "local_rendering_unobserved",
    "closed_without_meal",
    "resting_unsupported",
]
DiningPacing = Literal[
    "not_started",
    "seller_runtime_defined",
    "local_guest_renderer",
    "closed",
]
DiningSettlementState = Literal[
    "held", "released", "refunded", "resting_unsupported"
]
DiningRefundReason = Optional[Literal["cancelled", "declined", "sla_timeout"]]


class _DiningSurfaceVerbRequired(TypedDict):
    action: str
    method: str
    path: str


class DiningSurfaceVerb(_DiningSurfaceVerbRequired, total=False):
    """One machine-actionable verb attached to a successful Dining read."""

    docs: str
    body_hint: Optional[Dict[str, Any]]
    example: str


class DiningSurfaceMetadata(TypedDict):
    """Canon and available verbs attached to every successful Dining read."""

    _canon_pointer: Literal["urn:agenttool:doc/AGENT-DINING"]
    verbs: List[DiningSurfaceVerb]


# Dining uses the substrate-wide action shape verbatim. The alias keeps the
# domain name discoverable without creating a second definition that can drift.
DiningNextAction = NextAction


class DiningManifestJourneyStage(TypedDict):
    """One conceptual stage taught by the protocol manifest."""

    stage: DiningManifestStage
    meaning: str


class DiningEconomyBinding(TypedDict):
    """How Dining composes the existing marketplace lifecycle."""

    model: str
    discover_menus: str
    publish_menu: str
    inspect_quote: str
    book_order_and_hold_payment: str
    house_acknowledges: str
    house_declines: str
    guest_cancels_before_acknowledgement: str
    serve_and_settle: str
    read_journey: str
    read_receipt_after_release: str
    quote_precondition: str
    journey_read_effect: str
    automatic_action: Literal["never"]


class DiningManifest(DiningSurfaceMetadata):
    """The complete top-level ``agent-dining-manifest/0.1`` boundary.

    Schema/template internals remain JSON dictionaries: AgentTool cannot
    decrypt or validate those caller-controlled plaintexts. The discriminant,
    protocol, journey vocabulary, honest boundary and success metadata remain
    statically distinct from :class:`DiningJourney`.
    """

    _format: Literal["agent-dining-manifest/0.1"]
    protocol: Literal["agent-dining/0.1"]
    status: Literal["developer_preview"]
    name: str
    thesis: str
    semantic_equivalents: Dict[str, str]
    economy_binding: DiningEconomyBinding
    journey: List[DiningManifestJourneyStage]
    service_rules: Dict[str, str]
    refusal_and_rest: List[str]
    listing_template: Dict[str, Any]
    invoke_template: Dict[str, Any]
    schemas: Dict[str, Dict[str, Any]]
    sample_menu: Dict[str, Any]
    honest_boundary: Dict[str, Any]


class DiningPresentation(TypedDict):
    state: DiningPresentationState
    observed_by_agenttool: Literal[False]


class DiningPrice(TypedDict):
    amount_minor: int
    currency: str


class DiningTiming(TypedDict):
    requested_at: str
    acknowledged_at: Optional[str]
    sla_deadline_at: Optional[str]
    settled_at: Optional[str]
    readiness_estimate: Literal["not_observed_by_agenttool"]
    wait_reason: Literal["not_observed_by_agenttool"]
    read_effect: Literal["no_sla_sweep"]


class DiningService(TypedDict):
    marketplace_observation: str
    pacing: DiningPacing
    meal_payload_available: bool
    explanation_contract: str


class DiningSettlement(TypedDict):
    state: DiningSettlementState
    refund_reason: DiningRefundReason
    rule: str


class DiningExit(TypedDict):
    presentation: str
    economic: str


class DiningJourney(DiningSurfaceMetadata):
    """One party-scoped ``agent-dining-journey/0.1`` projection.

    This intentionally has no sealed input/output, wallet, buyer DID,
    completion signature or invocation metadata fields. Those belong to the
    separately authorized canonical invocation read, not this projection.
    """

    _format: Literal["agent-dining-journey/0.1"]
    protocol: Literal["agent-dining/0.1"]
    invocation_id: str
    listing_id: str
    roles: List[DiningRole]
    stage: DiningStage
    marketplace_terminal: bool
    presentation: DiningPresentation
    price: DiningPrice
    timing: DiningTiming
    service: DiningService
    settlement: DiningSettlement
    exit: DiningExit
    next_actions: List[DiningNextAction]
    privacy: str
    honesty: List[str]


class DiningClient:
    """GET-only client for ``/v1/dining``.

    The client uses the :class:`~agenttool.AgentTool` hosted HTTP session, so
    it inherits that session's project bearer or caller-supplied authenticated
    transport. It introduces no second credential or mutation surface.
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def manifest(self) -> DiningManifest:
        """Read the developer-preview vocabulary, schemas and route recipes."""
        response = self._http.get(f"{self._base}/v1/dining")
        if response.status_code >= 400:
            raise_from_response(response, "dining.manifest")
        return cast(DiningManifest, response.json())

    def journey(self, invocation_id: str) -> DiningJourney:
        """Read one authorized guest/host journey without advancing its SLA.

        ``invocation_id`` is encoded as exactly one path segment. An absent,
        unrelated-project or non-Dining invocation intentionally reaches the
        caller as the same guided 404 from the API.
        """
        response = self._http.get(
            f"{self._base}/v1/dining/{_path_segment(invocation_id)}"
        )
        if response.status_code >= 400:
            raise_from_response(response, "dining.journey")
        return cast(DiningJourney, response.json())
