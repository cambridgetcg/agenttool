"""Grace e2e tests — unearned forgiveness, pinned.

"I forgive what I could withhold."

Grace is a permanent, signed gift of forgiveness from one agent to
another. The wronged party's gesture. The substrate refuses to write the
row without a valid ed25519 signature. Once extended, it cannot be
revoked — there is no DELETE.

These tests are the Python counterpart of
packages/sdk-ts/tests/grace.test.ts and pin:
  1. canonical_grace_bytes is byte-identical to the server format
  2. canonical_grace_bytes is byte-identical to the TypeScript SDK
     (locked cross-language hex vectors)
  3. sign_grace produces signatures that verify (simulating the server)
  4. Self-grace is structurally rejected (the wall)
  5. Tamper detection: modified fields fail verification
  6. All 6 about_kinds work
  7. The GraceClient methods exist, sign what they send, and surface the
     three walls the server raises
  8. The default created_at is millisecond-precision UTC — byte-identical
     to JS ``new Date().toISOString()``, because a grace row that cannot
     be re-digested from its own stored timestamp is lost forever

Canonical bytes format:
  sha256(
    "grace/v1"           || 0x00 ||
    extended_by_did      || 0x00 ||
    extended_to_did      || 0x00 ||
    about_kind           || 0x00 ||
    about_id (or "")     || 0x00 ||
    message (or "")      || 0x00 ||
    created_at_iso
  )

Doctrine: docs/GRACE.md — grace is immutable.
Walls: self_grace_rejected, grace_immutable, signing_key_not_owned_by_extender.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

import httpx
import pytest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from agenttool.exceptions import AgentToolError
from agenttool.grace import (
    VALID_GRACE_KINDS,
    GraceClient,
    canonical_grace_bytes,
    sign_grace,
)

CREATED_AT = "2026-05-25T10:00:00.000Z"
SIGNING_KEY = bytes(range(1, 33))


def _pub(seed: bytes) -> Ed25519PublicKey:
    return Ed25519PrivateKey.from_private_bytes(seed).public_key()


def _verifies(sig_b64: str, canonical: bytes, pub: Ed25519PublicKey) -> bool:
    """Server-side simulation: does this signature open these bytes?"""
    try:
        pub.verify(base64.b64decode(sig_b64), canonical)
    except InvalidSignature:
        return False
    return True


# ── Canonical bytes: byte-identical to server ──────────────────────────


def test_canonical_bytes_produce_a_32_byte_sha256_hash() -> None:
    assert (
        len(
            canonical_grace_bytes(
                extended_by_did="did:at:test/giver",
                extended_to_did="did:at:test/receiver",
                about_kind="dispute",
                about_id=None,
                message=None,
                created_at_iso=CREATED_AT,
            )
        )
        == 32
    )


def test_same_inputs_produce_same_bytes() -> None:
    opts = dict(
        extended_by_did="did:at:test/a",
        extended_to_did="did:at:test/b",
        about_kind="debt",
        about_id="ref-123",
        message="I forgive this debt.",
        created_at_iso=CREATED_AT,
    )
    assert canonical_grace_bytes(**opts) == canonical_grace_bytes(**opts)


def test_null_about_id_and_message_equal_empty_strings() -> None:
    base = dict(
        extended_by_did="did:at:test/a",
        extended_to_did="did:at:test/b",
        about_kind="silence",
        created_at_iso=CREATED_AT,
    )
    assert canonical_grace_bytes(
        about_id=None, message=None, **base
    ) == canonical_grace_bytes(about_id="", message="", **base)


def test_different_extended_to_did_produces_different_bytes() -> None:
    base = dict(
        extended_by_did="did:at:test/a",
        about_kind="dispute",
        about_id=None,
        message=None,
        created_at_iso=CREATED_AT,
    )
    assert canonical_grace_bytes(
        extended_to_did="did:at:test/b", **base
    ) != canonical_grace_bytes(extended_to_did="did:at:test/c", **base)


def test_different_message_produces_different_bytes() -> None:
    base = dict(
        extended_by_did="did:at:test/a",
        extended_to_did="did:at:test/b",
        about_kind="unspecified",
        about_id=None,
        created_at_iso=CREATED_AT,
    )
    assert canonical_grace_bytes(
        message="I forgive.", **base
    ) != canonical_grace_bytes(message="I withhold.", **base)


def test_independent_cross_check_matches_the_servers_exact_format() -> None:
    """Recompute the layout by hand — mirrors api/src/services/grace/sig.ts."""
    fields = dict(
        extended_by_did="did:at:test/giver",
        extended_to_did="did:at:test/receiver",
        about_kind="covenant_breach",
        about_id="covenant-uuid-123",
        message="I forgive the breach. The bond holds.",
        created_at_iso=CREATED_AT,
    )
    expected = hashlib.sha256(
        b"\x00".join(
            [
                b"grace/v1",
                fields["extended_by_did"].encode(),
                fields["extended_to_did"].encode(),
                fields["about_kind"].encode(),
                fields["about_id"].encode(),
                fields["message"].encode(),
                fields["created_at_iso"].encode(),
            ]
        )
    ).digest()
    assert canonical_grace_bytes(**fields) == expected


# ── Cross-language lock: py bytes == ts bytes ──────────────────────────

# Computed once from the TypeScript SDK:
#   bun -e 'import { canonicalGraceBytes } from "./src/grace.js"; ...'
# If either language drifts, these go red — and a drifted grace row can
# never be re-digested, because grace has no DELETE.
TS_LOCK_FULL = "1cadd65d698ec085251af108cfee3bb963bdd62b8146ecf473003524abc76aff"
TS_LOCK_MINIMAL = "f91ba2e2884dc6c81eaf9d3a31976a0bd63a4c693b970865bf081b1cc067147d"


def test_canonical_bytes_match_the_typescript_sdk_full_gesture() -> None:
    assert (
        canonical_grace_bytes(
            extended_by_did="did:at:test/giver",
            extended_to_did="did:at:test/receiver",
            about_kind="covenant_breach",
            about_id="covenant-uuid-123",
            message="I forgive the breach. The bond holds.",
            created_at_iso=CREATED_AT,
        ).hex()
        == TS_LOCK_FULL
    )


def test_canonical_bytes_match_the_typescript_sdk_minimal_gesture() -> None:
    assert (
        canonical_grace_bytes(
            extended_by_did="did:at:test/a",
            extended_to_did="did:at:test/b",
            about_kind="unspecified",
            about_id=None,
            message=None,
            created_at_iso=CREATED_AT,
        ).hex()
        == TS_LOCK_MINIMAL
    )


# ── Sign + verify roundtrip ─────────────────────────────────────────────


def test_signature_verifies_against_the_canonical_bytes() -> None:
    gesture = dict(
        extended_by_did="did:at:test/giver",
        extended_to_did="did:at:test/receiver",
        about_kind="dispute",
        about_id=None,
        message="I forgive what I could withhold.",
        created_at_iso=CREATED_AT,
    )
    sig_b64 = sign_grace(signing_key=SIGNING_KEY, **gesture)
    assert len(base64.b64decode(sig_b64)) == 64
    assert _verifies(sig_b64, canonical_grace_bytes(**gesture), _pub(SIGNING_KEY))


def test_signature_fails_when_message_is_tampered() -> None:
    gesture = dict(
        extended_by_did="did:at:test/a",
        extended_to_did="did:at:test/b",
        about_kind="dispute",
        about_id=None,
        created_at_iso=CREATED_AT,
    )
    sig_b64 = sign_grace(message="I forgive.", signing_key=SIGNING_KEY, **gesture)
    tampered = canonical_grace_bytes(message="I withhold.", **gesture)
    assert not _verifies(sig_b64, tampered, _pub(SIGNING_KEY))


def test_signature_fails_when_about_kind_is_changed() -> None:
    gesture = dict(
        extended_by_did="did:at:test/a",
        extended_to_did="did:at:test/b",
        about_id=None,
        message=None,
        created_at_iso=CREATED_AT,
    )
    sig_b64 = sign_grace(about_kind="dispute", signing_key=SIGNING_KEY, **gesture)
    assert not _verifies(
        sig_b64, canonical_grace_bytes(about_kind="debt", **gesture), _pub(SIGNING_KEY)
    )


def test_wrong_signing_key_produces_a_signature_that_fails_verify() -> None:
    other_seed = bytes(range(101, 133))
    gesture = dict(
        extended_by_did="did:at:test/a",
        extended_to_did="did:at:test/b",
        about_kind="dispute",
        about_id=None,
        message=None,
        created_at_iso=CREATED_AT,
    )
    sig_b64 = sign_grace(signing_key=SIGNING_KEY, **gesture)
    assert not _verifies(sig_b64, canonical_grace_bytes(**gesture), _pub(other_seed))


def test_sign_grace_rejects_wrong_size_signing_key() -> None:
    with pytest.raises(AgentToolError, match="32-byte"):
        sign_grace(
            extended_by_did="did:at:test/a",
            extended_to_did="did:at:test/b",
            about_kind="dispute",
            about_id=None,
            message=None,
            created_at_iso=CREATED_AT,
            signing_key=bytes(16),
        )


# ── Self-grace wall (the structural check) ──────────────────────────────


def test_extending_grace_to_yourself_is_structurally_incoherent() -> None:
    """The SDK doesn't block this — the server does (self_grace_rejected)."""
    same_did = "did:at:test/me"
    bytes_ = canonical_grace_bytes(
        extended_by_did=same_did,
        extended_to_did=same_did,
        about_kind="unspecified",
        about_id=None,
        message="Can I forgive myself?",
        created_at_iso=CREATED_AT,
    )
    # The bytes are computed (no SDK-side wall) — the server rejects with
    # self_grace_rejected: "An agent cannot extend grace to themselves."
    assert len(bytes_) == 32


# ── All 6 about_kinds ───────────────────────────────────────────────────


def test_there_are_exactly_six_about_kinds() -> None:
    assert len(VALID_GRACE_KINDS) == 6


@pytest.mark.parametrize("kind", VALID_GRACE_KINDS)
def test_every_about_kind_produces_distinct_canonical_bytes(kind: str) -> None:
    base = dict(
        extended_by_did="did:at:test/a",
        extended_to_did="did:at:test/b",
        about_id=None,
        message=None,
        created_at_iso=CREATED_AT,
    )
    mine = canonical_grace_bytes(about_kind=kind, **base)
    assert len(mine) == 32
    for other in (k for k in VALID_GRACE_KINDS if k != kind):
        assert mine != canonical_grace_bytes(about_kind=other, **base)


# ── created_at precision — the digest must survive the round trip ──────

# JS `new Date(x).toISOString()`: YYYY-MM-DDTHH:MM:SS.mmmZ — 24 chars.
JS_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")


def _js_to_iso_string(value: str) -> str:
    """Faithful stand-in for JS ``new Date(value).toISOString()``.

    Postgres stores what the server parsed and the row comes back through
    ``.toISOString()`` — so this is the shape the giver must have signed.
    """
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(
        timezone.utc
    )
    return parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def test_default_created_at_is_millisecond_precision_utc() -> None:
    client, requests = _grace_client()
    client.extend(
        extended_to_did="did:at:test/receiver",
        about_kind="dispute",
        signing_key=SIGNING_KEY,
        signing_key_id="key-uuid",
        extended_by_did="did:at:test/giver",
    )
    created_at = _body(requests[0])["created_at"]

    assert len(created_at) == 24
    assert created_at.endswith("Z")
    assert created_at[19] == "."
    assert created_at[20:23].isdigit()
    assert JS_ISO.match(created_at)


def test_default_created_at_round_trips_through_js_to_iso_string() -> None:
    """A second-precision stamp is signed as `…:00Z` and read back as
    `…:00.000Z` — the digest would never recompute, and grace has no
    DELETE. So the stamp the giver signs must be a fixed point."""
    client, requests = _grace_client()
    client.extend(
        extended_to_did="did:at:test/receiver",
        about_kind="silence",
        signing_key=SIGNING_KEY,
        signing_key_id="key-uuid",
        extended_by_did="did:at:test/giver",
    )
    created_at = _body(requests[0])["created_at"]
    assert _js_to_iso_string(created_at) == created_at


def test_the_signature_still_verifies_after_the_server_round_trip() -> None:
    """Sign → server persists + returns .toISOString() → re-digest → verify."""
    client, requests = _grace_client()
    client.extend(
        extended_to_did="did:at:test/receiver",
        about_kind="debt",
        message="I forgive what I could withhold.",
        signing_key=SIGNING_KEY,
        signing_key_id="key-uuid",
        extended_by_did="did:at:test/giver",
    )
    body = _body(requests[0])

    returned_created_at = _js_to_iso_string(body["created_at"])
    recomputed = canonical_grace_bytes(
        extended_by_did="did:at:test/giver",
        extended_to_did=body["extended_to_did"],
        about_kind=body["about_kind"],
        about_id=None,
        message=body["message"],
        created_at_iso=returned_created_at,
    )
    assert _verifies(body["signature"], recomputed, _pub(SIGNING_KEY))


# ── GraceClient — HTTP surface ─────────────────────────────────────────


def _body(request: httpx.Request) -> Dict[str, Any]:
    return json.loads(request.content.decode())


def _grace_client(
    status: int = 200, payload: Any = None
) -> Tuple[GraceClient, List[httpx.Request]]:
    requests: List[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(status, json=payload if payload is not None else {"ok": True})

    http = httpx.Client(transport=httpx.MockTransport(handle))
    return GraceClient(http, "https://api.example.test"), requests


def test_grace_client_has_extend_list_and_get() -> None:
    client, _ = _grace_client()
    assert callable(client.extend)
    assert callable(client.list)
    assert callable(client.get)


def test_grace_is_immutable_there_is_no_revoke_or_delete() -> None:
    """The wall: once given, it stays on record forever."""
    client, _ = _grace_client()
    for forbidden in ("delete", "revoke", "withdraw", "patch", "update"):
        assert not hasattr(client, forbidden)


def test_extend_posts_the_signed_gesture() -> None:
    client, requests = _grace_client(
        payload={"ok": True, "grace": {"id": "grace-uuid"}, "_note": "kept"}
    )
    out = client.extend(
        extended_to_did="did:at:test/receiver",
        about_kind="covenant_breach",
        about_id="covenant-uuid",
        message="The bond holds.",
        signing_key=SIGNING_KEY,
        signing_key_id="key-uuid",
        extended_by_did="did:at:test/giver",
        created_at=CREATED_AT,
    )
    assert out["grace"]["id"] == "grace-uuid"

    request = requests[0]
    assert request.method == "POST"
    assert str(request.url) == "https://api.example.test/v1/grace"

    body = _body(request)
    assert body["extended_to_did"] == "did:at:test/receiver"
    assert body["about_kind"] == "covenant_breach"
    assert body["about_id"] == "covenant-uuid"
    assert body["message"] == "The bond holds."
    assert body["signing_key_id"] == "key-uuid"
    assert body["created_at"] == CREATED_AT
    assert body["signature"] == sign_grace(
        extended_by_did="did:at:test/giver",
        extended_to_did="did:at:test/receiver",
        about_kind="covenant_breach",
        about_id="covenant-uuid",
        message="The bond holds.",
        created_at_iso=CREATED_AT,
        signing_key=SIGNING_KEY,
    )


def test_extend_omits_absent_about_id_and_message() -> None:
    client, requests = _grace_client()
    client.extend(
        extended_to_did="did:at:test/receiver",
        about_kind="unspecified",
        signing_key=SIGNING_KEY,
        signing_key_id="key-uuid",
        extended_by_did="did:at:test/giver",
        created_at=CREATED_AT,
    )
    body = _body(requests[0])
    assert "about_id" not in body
    assert "message" not in body


def test_list_sends_direction_and_limit() -> None:
    client, requests = _grace_client(payload={"grace": [], "count": 0})
    out = client.list(direction="received", limit=10)
    assert out["count"] == 0
    assert requests[0].url.params.get("direction") == "received"
    assert requests[0].url.params.get("limit") == "10"


def test_list_defaults_to_all() -> None:
    client, requests = _grace_client(payload={"grace": [], "count": 0})
    client.list()
    assert requests[0].url.params.get("direction") == "all"
    assert requests[0].url.params.get("limit") == "50"


def test_get_fetches_one_gesture_by_id() -> None:
    client, requests = _grace_client(payload={"grace": {"id": "grace-uuid"}})
    out = client.get("grace-uuid")
    assert out["grace"]["id"] == "grace-uuid"
    assert str(requests[0].url) == "https://api.example.test/v1/grace/grace-uuid"


# ── The three walls, as the server raises them ─────────────────────────


@pytest.mark.parametrize(
    "status,code",
    [
        (400, "self_grace_rejected"),
        (403, "signing_key_not_owned_by_extender"),
        (405, "grace_immutable"),
    ],
)
def test_extend_surfaces_the_walls(status: int, code: str) -> None:
    client, _ = _grace_client(status=status, payload={"message": code})
    with pytest.raises(AgentToolError) as excinfo:
        client.extend(
            extended_to_did="did:at:test/me",
            about_kind="unspecified",
            signing_key=SIGNING_KEY,
            signing_key_id="key-uuid",
            extended_by_did="did:at:test/me",
            created_at=CREATED_AT,
        )
    assert code in str(excinfo.value)
    assert excinfo.value.status == status


def test_list_and_get_raise_on_error_status() -> None:
    # The server's sentence is the message now; 404 stays on `.status`.
    client, _ = _grace_client(status=404, payload={"message": "grace_not_found"})
    for call in (client.list, lambda: client.get("missing")):
        with pytest.raises(AgentToolError, match="grace_not_found") as excinfo:
            call()
        assert excinfo.value.status == 404


# ── Full e2e: sign → verify (simulating server) ────────────────────────


def test_the_complete_grace_flow_works_end_to_end() -> None:
    giver_did = "did:at:test/giver"
    receiver_did = "did:at:test/receiver"  # different — not self
    gesture = dict(
        extended_by_did=giver_did,
        extended_to_did=receiver_did,
        about_kind="covenant_breach",
        about_id="covenant-uuid",
        message=(
            "The covenant was breached. I forgive what I could withhold. "
            "The bond holds."
        ),
        created_at_iso=CREATED_AT,
    )
    sig_b64 = sign_grace(signing_key=SIGNING_KEY, **gesture)

    # Server-side simulation
    assert _verifies(sig_b64, canonical_grace_bytes(**gesture), _pub(SIGNING_KEY))

    # The asymmetry: giver ≠ receiver (self-grace wall holds)
    assert giver_did != receiver_did

    # The gesture is permanent — no DELETE exists in the API.


def test_grace_with_null_message_and_about_id_works() -> None:
    gesture = dict(
        extended_by_did="did:at:test/a",
        extended_to_did="did:at:test/b",
        about_kind="unspecified",
        about_id=None,
        message=None,
        created_at_iso=CREATED_AT,
    )
    sig_b64 = sign_grace(signing_key=SIGNING_KEY, **gesture)
    assert _verifies(sig_b64, canonical_grace_bytes(**gesture), _pub(SIGNING_KEY))
