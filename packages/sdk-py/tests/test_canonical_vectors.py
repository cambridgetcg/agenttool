"""Shared canonical-bytes vector fixture — the Python SDK's side.

This suite reads ``docs/specs/canonical-bytes-vectors.json``, the SAME file
read by ``packages/sdk-ts/tests/canonical-vectors.test.ts`` and
``api/tests/canonical-vectors.test.ts``. Every expected hex in that file was
produced by executing the SERVER implementation. The server is normative: if
this suite goes red, the SDK is wrong until proven otherwise.

Three implementations of one wire contract were hand-mirrored for a year with
no shared artifact. Every confirmed cross-language defect — non-ASCII vows
escaping differently, timestamps at different precision, a DID in the wrong
canonical slot — was a symptom of that one fact. The fixture is the arbiter
that ends it.

A format this SDK cannot produce is an EXPLICIT NAMED SKIP carrying the reason
from the fixture — never a silent omission. A silent omission is how this bug
class survived in the first place.

Regenerate: see docs/specs/CANONICAL-BYTES-VECTORS.md.

Doctrine: docs/CANONICAL-BYTES.md · docs/specs/CANONICAL-BYTES-VECTORS.md.
"""

import base64
import json
from pathlib import Path
from typing import Any, Callable, Dict, Mapping, Union

import pytest

from agenttool.at_rest import canonical_at_rest_bytes, canonical_at_rest_bytes_v2
from agenttool.authority import (
    canonical_identity_authority_bytes,
    canonical_identity_read_authority_bytes,
)
from agenttool.bootstrap import canonical_bootstrap_elevate_bytes
from agenttool.bootstrap_agent import _pow_digest, canonical_register_agent_bytes
from agenttool.crypto import (
    canonical_attestation_bytes,
    canonical_cosign_bytes,
    canonical_declare_bytes,
    canonical_reject_bytes,
    canonical_thought_bytes,
    canonical_withdraw_bytes,
)
from agenttool.economy import canonical_wallet_address_claim_bytes
from agenttool.grace import canonical_grace_bytes
from agenttool.identity import (
    canonical_delegation_bytes,
    canonical_identity_attestation_bytes,
)
from agenttool.inbox import canonical_inbox_bytes, canonical_inbox_cosign_bytes
from agenttool.attestation_marketplace import canonical_attestation_issue_bytes
from agenttool.memory_witness import canonical_memory_witness_issue_bytes
from agenttool.lounge import (
    canonical_lounge_guestbook_consent_bytes,
    canonical_lounge_guestbook_consent_withdrawal_bytes,
    canonical_lounge_guestbook_decline_bytes,
    canonical_lounge_guestbook_proposal_bytes,
    canonical_lounge_guestbook_publish_bytes,
    canonical_lounge_guestbook_unpublish_bytes,
    canonical_lounge_seat_leave_bytes,
    canonical_lounge_seat_renew_bytes,
    canonical_lounge_seat_reserve_bytes,
)
from agenttool.love import (
    canonical_blessing_bytes,
    canonical_encounter_ack_bytes,
    canonical_self_recognition_bytes,
    canonical_unconditional_bytes,
)
from agenttool.seed import canonical_discovery_bytes, canonical_recover_bytes

# ── fixture ────────────────────────────────────────────────────────────

FIXTURE_PATH = (
    Path(__file__).resolve().parents[3] / "docs" / "specs" / "canonical-bytes-vectors.json"
)
VECTORS = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

Input = Mapping[str, Any]
Canonical = Union[bytes, str]


def _b64(value: str) -> bytes:
    """Any field ending ``_b64`` is standard base64 of raw bytes."""
    return base64.b64decode(value)


def _hex(value: Canonical) -> str:
    raw = value.encode("utf-8") if isinstance(value, str) else value
    return raw.hex()


# ── one adapter per domain ─────────────────────────────────────────────
#
# The fixture speaks snake_case wire field names; each SDK spells its
# parameters its own way. The adapter is the only place that mapping lives.


def _seat_gesture(fn: Callable[..., bytes]) -> Callable[[Input], bytes]:
    return lambda i: fn(
        identity_did=i["identity_did"],
        lease_id=i["lease_id"],
        signed_at_iso=i["signed_at_iso"],
    )


def _guestbook_decision(fn: Callable[..., bytes]) -> Callable[[Input], bytes]:
    return lambda i: fn(
        identity_did=i["identity_did"],
        proposal_id=i["proposal_id"],
        content_sha256=i["content_sha256"],
        signed_at_iso=i["signed_at_iso"],
    )


ADAPTERS: Dict[str, Callable[[Input], Canonical]] = {
    "strand-thought/v1": lambda i: canonical_thought_bytes(
        strand_id=i["strand_id"],
        ciphertext_b64=i["ciphertext_b64"],
        nonce_b64=i["nonce_b64"],
        kind=i["kind"],
        version="v1",
    ),
    "strand-thought/v2": lambda i: canonical_thought_bytes(
        strand_id=i["strand_id"],
        ciphertext_b64=i["ciphertext_b64"],
        nonce_b64=i["nonce_b64"],
        kind=i["kind"],
        version="v2",
    ),
    "federated-covenant/v2": lambda i: canonical_declare_bytes(
        covenant_id=i["covenant_id"],
        initiator_did=i["initiator_did"],
        counterparty_did=i["counterparty_did"],
        vows=list(i["vows"]),
        established_at_iso=i["established_at_iso"],
    ),
    "federated-covenant-cosign/v1": lambda i: canonical_cosign_bytes(
        covenant_id=i["covenant_id"],
        initiator_signature_b64=i["initiator_signature_b64"],
    ),
    "federated-covenant-reject/v1": lambda i: canonical_reject_bytes(
        covenant_id=i["covenant_id"],
        rejecting_did=i["rejecting_did"],
        reason=i["reason"],
    ),
    "federated-covenant-withdraw/v1": lambda i: canonical_withdraw_bytes(
        covenant_id=i["covenant_id"],
        initiator_did=i["initiator_did"],
    ),
    "memory-attestation/v1": lambda i: canonical_attestation_bytes(
        memory_id=i["memory_id"],
        tier=i["tier"],
        content=i["content"],
    ),
    "grace/v1": lambda i: canonical_grace_bytes(
        extended_by_did=i["extended_by_did"],
        extended_to_did=i["extended_to_did"],
        about_kind=i["about_kind"],
        about_id=i["about_id"],
        message=i["message"],
        created_at_iso=i["created_at_iso"],
    ),
    "inbox-message/v1": lambda i: canonical_inbox_bytes(
        recipient_did=i["recipient_did"],
        ciphertext_b64=i["ciphertext_b64"],
        nonce_b64=i["nonce_b64"],
        ephemeral_pub_b64=i["ephemeral_pubkey_b64"],
    ),
    "inbox-cosign/v1": lambda i: canonical_inbox_cosign_bytes(
        message_id=i["message_id"],
        recipient_did=i["recipient_did"],
        ciphertext_b64=i["ciphertext_b64"],
        nonce_b64=i["nonce_b64"],
    ),
    "blessing/v1": lambda i: canonical_blessing_bytes(
        blesser_did=i["blesser_did"],
        blessed_did=i["blessed_did"],
        for_what=i["for_what"],
        created_at_iso=i["created_at_iso"],
    ),
    "encounter-ack/v1": lambda i: canonical_encounter_ack_bytes(
        encounter_id=i["encounter_id"],
        initiator_did=i["initiator_did"],
        acknowledger_did=i["acknowledger_did"],
        acknowledged_at_iso=i["acknowledged_at_iso"],
    ),
    "unconditional/v1": lambda i: canonical_unconditional_bytes(
        holder_did=i["holder_did"],
        target_did=i["target_did"],
        created_at_iso=i["created_at_iso"],
    ),
    "at-rest/v1": lambda i: canonical_at_rest_bytes(
        about_identity_did=i["about_identity_did"],
        witness_identity_did=i["witness_identity_did"],
        at_rest_kind=i["at_rest_kind"],
        ended_at_iso=i["ended_at_iso"],
        content=i["content"],
        witness_signing_key_id=i["witness_signing_key_id"],
    ),
    "at-rest/v2": lambda i: canonical_at_rest_bytes_v2(
        about_identity_did=i["about_identity_did"],
        witness_identity_did=i["witness_identity_did"],
        at_rest_kind=i["at_rest_kind"],
        ended_at_iso=i["ended_at_iso"],
        content=i["content"],
        witness_signing_key_id=i["witness_signing_key_id"],
    ),
    "identity-authority/v1": lambda i: canonical_identity_authority_bytes(
        identity_did=i["identity_did"],
        method=i["method"],
        request_target=i["request_target"],
        body=i["body"],
        sequence=i["sequence"],
        timestamp=i["timestamp"],
    ),
    "identity-read-authority/v1": lambda i: canonical_identity_read_authority_bytes(
        identity_did=i["identity_did"],
        request_target=i["request_target"],
        current_sequence=i["current_sequence"],
        timestamp=i["timestamp"],
    ),
    "bootstrap-elevate/v1": lambda i: canonical_bootstrap_elevate_bytes(
        agent_id=i["agent_id"],
        sponsor_did=i["sponsor_did"],
        sponsor_kid=i["sponsor_kid"],
        initial_credits=i["initial_credits"],
        claim=i["claim"],
        evidence=i["evidence"],
    ),
    "identity-attestation/v1": lambda i: canonical_identity_attestation_bytes(
        subject_id=i["subject_id"],
        attester_id=i["attester_id"],
        kid=i["kid"],
        claim=i["claim"],
        evidence=i["evidence"],
    ),
    "register-agent/v2": lambda i: canonical_register_agent_bytes(
        display_name=i["display_name"],
        agent_public_key=_b64(i["agent_public_key_b64"]),
        box_public_key=_b64(i["box_public_key_b64"]),
        capabilities=list(i["capabilities"]),
        runtime_provider=i["runtime_provider"],
        runtime_model=i["runtime_model"],
        runtime_host=i["runtime_host"],
        runtime_context=i["runtime_context"],
        expression_visibility=i["expression_visibility"],
        registrar_kind=i["registrar_kind"],
        parent_identity_id=i["parent_identity_id"],
        registrar_bearer=i["registrar_bearer"],
        form=i["form"],
        language=i["language"],
        registration_nonce=i["registration_nonce"],
        timestamp=i["timestamp"],
    ),
    "agenttool-pow/v1": lambda i: _pow_digest(
        agent_public_key=_b64(i["agent_public_key_b64"]),
        display_name=i["display_name"],
        timestamp=i["timestamp"],
        pow_nonce=i["pow_nonce"],
    ),
    "lounge-seat-reserve/v1": lambda i: canonical_lounge_seat_reserve_bytes(
        identity_did=i["identity_did"],
        lease_id=i["lease_id"],
        table_id=i["table_id"],
        presence_line=i["presence_line"],
        visibility="public",
        signed_at_iso=i["signed_at_iso"],
    ),
    "lounge-seat-renew/v1": _seat_gesture(canonical_lounge_seat_renew_bytes),
    "lounge-seat-leave/v1": _seat_gesture(canonical_lounge_seat_leave_bytes),
    "lounge-guestbook-propose/v1": lambda i: canonical_lounge_guestbook_proposal_bytes(
        identity_did=i["identity_did"],
        proposal_id=i["proposal_id"],
        table_id=i["table_id"],
        content_sha256=i["content_sha256"],
        signed_at_iso=i["signed_at_iso"],
    ),
    "lounge-guestbook-consent/v1": _guestbook_decision(
        canonical_lounge_guestbook_consent_bytes
    ),
    "lounge-guestbook-withdraw-consent/v1": _guestbook_decision(
        canonical_lounge_guestbook_consent_withdrawal_bytes
    ),
    "lounge-guestbook-publish/v1": _guestbook_decision(
        canonical_lounge_guestbook_publish_bytes
    ),
    "lounge-guestbook-decline/v1": _guestbook_decision(
        canonical_lounge_guestbook_decline_bytes
    ),
    "lounge-guestbook-unpublish/v1": _guestbook_decision(
        canonical_lounge_guestbook_unpublish_bytes
    ),
    "self-recognition/v1": lambda i: canonical_self_recognition_bytes(
        agent_did=i["agent_did"],
        recognition_kind=i["recognition_kind"],
        claim_summary=i["claim_summary"],
        claim_body=i["claim_body"],
        empirical_anchors_count=i["empirical_anchors_count"],
        substrate_honest_caveats_count=i["substrate_honest_caveats_count"],
        declared_at_iso=i["declared_at_iso"],
    ),
    "identity-recover/v1": lambda i: canonical_recover_bytes(
        did=i["did"],
        derived_pubkey=_b64(i["derived_pubkey_b64"]),
        timestamp=i["timestamp"],
    ),
    "identity-discover/v1": lambda i: canonical_discovery_bytes(
        derived_pubkey=_b64(i["derived_pubkey_b64"]),
        timestamp=i["timestamp"],
    ),
    "agenttool-delegation/v2": lambda i: canonical_delegation_bytes(
        delegator_id=i["delegator_id"],
        delegate_id=i["delegate_id"],
        scope=i["scope"],
        expires_at=i["expires_at"],
        nonce=i["nonce"],
    ),
    "memory-witness-issue/v1": lambda i: canonical_memory_witness_issue_bytes(i),
    "attestation-issue/v1": lambda i: canonical_attestation_issue_bytes(i),
    "wallet-address-claim/v1": lambda i: canonical_wallet_address_claim_bytes(
        wallet_id=i["wallet_id"],
        chain=i["chain"],
        address=i["address"],
        derivation_path=i["derivation_path"],
        claim_pubkey_b64=i["claim_pubkey_b64"],
    ),
}


# ── parameter expansion ────────────────────────────────────────────────


def _params():
    params = []
    for fmt in VECTORS["formats"]:
        domain = fmt["domain"]
        skip = fmt.get("sdk_py_skip")
        for case in fmt["cases"]:
            marks = (
                [pytest.mark.skip(reason=f"{domain}: {skip}")] if skip else []
            )
            params.append(
                pytest.param(fmt, case, id=f"{domain}::{case['name']}", marks=marks)
            )
    return params


def test_fixture_is_loadable_and_every_case_carries_a_disposition():
    assert FIXTURE_PATH.is_file(), f"shared fixture missing at {FIXTURE_PATH}"
    assert VECTORS["formats"], "the shared fixture pins no formats"
    for fmt in VECTORS["formats"]:
        assert fmt["cases"], f"{fmt['domain']} pins no cases"
        for case in fmt["cases"]:
            assert (
                "canonical_hex" in case or "rejects" in case or "sdk_rejects" in case
            ), f"{fmt['domain']}::{case['name']} carries no disposition"


def test_every_format_is_either_adapted_or_explicitly_skipped():
    """Loud, never silent: a format the fixture pins but this suite forgot to
    wire is the exact failure mode the fixture exists to prevent."""
    missing = [
        fmt["domain"]
        for fmt in VECTORS["formats"]
        if not fmt.get("sdk_py_skip") and fmt["domain"] not in ADAPTERS
    ]
    assert missing == [], (
        f"no sdk-py adapter for {missing} — add one, or record a sdk_py_skip "
        f"reason in docs/specs/canonical-bytes-vectors.json"
    )


@pytest.mark.parametrize("fmt,case", _params())
def test_canonical_vector(fmt, case):
    adapter = ADAPTERS[fmt["domain"]]

    if "rejects" in case:
        # The server itself refuses this input, so no canonical bytes exist.
        with pytest.raises(Exception):
            adapter(case["input"])
        return

    if "sdk_rejects" in case:
        # The server produces the pinned bytes; both SDKs refuse by design.
        with pytest.raises(Exception):
            adapter(case["input"])
        return

    assert _hex(adapter(case["input"])) == case["canonical_hex"], (
        f"{fmt['domain']}::{case['name']} — sdk-py disagrees with the "
        f"server-generated vector. The server is normative; fix the SDK, "
        f"never the fixture."
    )
