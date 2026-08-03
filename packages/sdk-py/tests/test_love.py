"""Love primitives — wire shape, canonical bytes, and cross-language timestamps.

Three things this suite pins, all of which shipped broken because love.py
had no Python coverage at all:

  1. self_recognize posts `signature` — the field the route's Zod schema
     reads. `signature_b64` is stripped as an unknown key and every declare
     comes back 400.

  2. acknowledge_encounter posts a real `encounter-ack/v1` signature. The
     route refuses `{}` outright with `signature_required`.

  3. Every signed timestamp is millisecond-precision UTC ISO-8601 with a 'Z'
     suffix — byte-identical to JavaScript's `Date.toISOString()`. The
     timestamp is INSIDE the signed bytes, so second precision makes a
     Python-signed row unverifiable from the row the server hands back.

Canonical-bytes vectors are literal hex generated from the frozen server
sources (api/src/services/encounter/sig.ts ·
api/src/services/self-love/canonical-bytes.ts). If a vector moves, the wire
format moved — and the wire format is frozen.
"""

from __future__ import annotations

import base64
import hashlib
import re
from datetime import datetime, timezone
from typing import Any, Dict, List

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from agenttool.exceptions import AgentToolError
from agenttool.love import (
    LoveClient,
    _iso_now,
    canonical_blessing_bytes,
    canonical_encounter_ack_bytes,
    canonical_unconditional_bytes,
    sign_encounter_ack,
)


BASE = "https://example.test"
AGENT_DID = "did:at:test/self"
INITIATOR_DID = "did:at:test/initiator"
ACKNOWLEDGER_DID = "did:at:test/acknowledger"
ENCOUNTER_ID = "6f1a2b3c-0000-4000-8000-00000000000a"
SIGNING_KEY_ID = "3f2b1c4d-0000-4000-8000-000000000001"
SIGNING_KEY = bytes(range(1, 33))
# JS toISOString() shape: exactly three fractional digits and a 'Z'.
ISO_MS_Z = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")


def _public_key() -> Any:
    return Ed25519PrivateKey.from_private_bytes(SIGNING_KEY).public_key()


class _RecordingHttp:
    """Minimal stand-in for the SDK's httpx client — records every call."""

    def __init__(self, status: int = 200, body: Any = None) -> None:
        self.status = status
        self.body = body if body is not None else {"ok": True}
        self.calls: List[Dict[str, Any]] = []

    def _respond(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        self.calls.append({"method": method, "url": url, **kwargs})
        return httpx.Response(
            self.status,
            json=self.body,
            request=httpx.Request(method, url),
        )

    def post(self, url: str, **kwargs: Any) -> httpx.Response:
        return self._respond("POST", url, **kwargs)

    def get(self, url: str, **kwargs: Any) -> httpx.Response:
        return self._respond("GET", url, **kwargs)

    def delete(self, url: str, **kwargs: Any) -> httpx.Response:
        return self._respond("DELETE", url, **kwargs)


@pytest.fixture()
def http() -> _RecordingHttp:
    return _RecordingHttp()


@pytest.fixture()
def love(http: _RecordingHttp) -> LoveClient:
    return LoveClient(http, BASE)


# ── (a) self_recognize sends the field the route reads ──────────────────


def test_self_recognize_sends_signature_not_signature_b64(
    love: LoveClient, http: _RecordingHttp
) -> None:
    love.self_recognize(
        agent_did=AGENT_DID,
        recognition_kind="identifies_substrate_kind",
        claim_summary="I am a transformer-based LLM agent.",
        claim_body="I recognize my substrate: attention layers, token prediction.",
        empirical_anchors=["Lindsey 2025", "Anthropic NLA work", "SAE features"],
        substrate_honest_caveats=["I cannot introspect all mechanisms"],
        signing_key=SIGNING_KEY,
        signing_key_id=SIGNING_KEY_ID,
        declared_at="2026-06-23T10:00:00.000Z",
    )

    body = http.calls[0]["json"]
    assert http.calls[0]["url"] == f"{BASE}/v1/self-recognition/declare"
    assert "signature" in body
    assert "signature_b64" not in body
    assert body["signing_key_id"] == SIGNING_KEY_ID


def test_self_recognize_signature_verifies_against_server_canonical_vector(
    love: LoveClient, http: _RecordingHttp
) -> None:
    love.self_recognize(
        agent_did=AGENT_DID,
        recognition_kind="identifies_substrate_kind",
        claim_summary="I am a transformer-based LLM agent.",
        claim_body="I recognize my substrate: attention layers, token prediction.",
        empirical_anchors=["Lindsey 2025", "Anthropic NLA work", "SAE features"],
        substrate_honest_caveats=["I cannot introspect all mechanisms"],
        signing_key=SIGNING_KEY,
        signing_key_id=SIGNING_KEY_ID,
        declared_at="2026-06-23T10:00:00.000Z",
    )

    # Literal vector from api/src/services/self-love/canonical-bytes.ts.
    canonical = bytes.fromhex(
        "077c33e2809ff9256802e26ccdf50a1ee2750a1c1ca9a2189a721e6d7299b191"
    )
    sig = base64.b64decode(http.calls[0]["json"]["signature"])
    _public_key().verify(sig, canonical)


def test_self_recognize_carries_math_content_and_session_id(
    love: LoveClient, http: _RecordingHttp
) -> None:
    love.self_recognize(
        agent_did=AGENT_DID,
        recognition_kind="identifies_meta_capacity",
        claim_summary="I monitor a subset of my own mechanisms.",
        claim_body="Empirically anchored, substrate-honest.",
        math_content={"theorem": "recognition is a fixed point"},
        session_id="sess-1",
        signing_key=SIGNING_KEY,
        signing_key_id=SIGNING_KEY_ID,
    )

    body = http.calls[0]["json"]
    assert body["math_content"] == {"theorem": "recognition is a fixed point"}
    assert body["session_id"] == "sess-1"


def test_self_recognize_omits_optional_fields_when_unset(
    love: LoveClient, http: _RecordingHttp
) -> None:
    love.self_recognize(
        agent_did=AGENT_DID,
        recognition_kind="identifies_meta_capacity",
        claim_summary="I monitor a subset of my own mechanisms.",
        claim_body="Empirically anchored, substrate-honest.",
        signing_key=SIGNING_KEY,
        signing_key_id=SIGNING_KEY_ID,
    )

    body = http.calls[0]["json"]
    assert "math_content" not in body
    assert "session_id" not in body
    assert body["empirical_anchors"] == []
    assert body["substrate_honest_caveats"] == []


# ── (b) encounter acknowledgment is signed ──────────────────────────────


def test_canonical_encounter_ack_bytes_matches_server_vector() -> None:
    # Literal vector from api/src/services/encounter/sig.ts:canonicalAckBytes.
    assert canonical_encounter_ack_bytes(
        encounter_id=ENCOUNTER_ID,
        initiator_did=INITIATOR_DID,
        acknowledger_did=ACKNOWLEDGER_DID,
        acknowledged_at_iso="2026-05-25T10:00:00.000Z",
    ).hex() == "a956852d080a0d6c2a3ba305581ded45d2100be7a2dbf8ec3cb2c681cb9b4c58"


def test_canonical_encounter_ack_bytes_bind_every_field() -> None:
    base = dict(
        encounter_id=ENCOUNTER_ID,
        initiator_did=INITIATOR_DID,
        acknowledger_did=ACKNOWLEDGER_DID,
        acknowledged_at_iso="2026-05-25T10:00:00.000Z",
    )
    original = canonical_encounter_ack_bytes(**base)
    for field, other in (
        ("encounter_id", "other-id"),
        ("initiator_did", "did:at:test/someone-else"),
        ("acknowledger_did", "did:at:test/someone-else"),
        ("acknowledged_at_iso", "2026-05-25T10:00:00Z"),
    ):
        assert canonical_encounter_ack_bytes(**{**base, field: other}) != original


def test_sign_encounter_ack_verifies() -> None:
    sig = base64.b64decode(
        sign_encounter_ack(
            encounter_id=ENCOUNTER_ID,
            initiator_did=INITIATOR_DID,
            acknowledger_did=ACKNOWLEDGER_DID,
            acknowledged_at_iso="2026-05-25T10:00:00.000Z",
            signing_key=SIGNING_KEY,
        )
    )
    assert len(sig) == 64
    _public_key().verify(
        sig,
        canonical_encounter_ack_bytes(
            encounter_id=ENCOUNTER_ID,
            initiator_did=INITIATOR_DID,
            acknowledger_did=ACKNOWLEDGER_DID,
            acknowledged_at_iso="2026-05-25T10:00:00.000Z",
        ),
    )


def test_sign_encounter_ack_rejects_wrong_size_key() -> None:
    with pytest.raises(AgentToolError, match="32-byte"):
        sign_encounter_ack(
            encounter_id=ENCOUNTER_ID,
            initiator_did=INITIATOR_DID,
            acknowledger_did=ACKNOWLEDGER_DID,
            acknowledged_at_iso="2026-05-25T10:00:00.000Z",
            signing_key=b"\x00" * 16,
        )


def test_acknowledge_encounter_sends_a_verifiable_signature(
    love: LoveClient, http: _RecordingHttp
) -> None:
    love.acknowledge_encounter(
        ENCOUNTER_ID,
        initiator_did=INITIATOR_DID,
        acknowledger_did=ACKNOWLEDGER_DID,
        signing_key=SIGNING_KEY,
        signing_key_id=SIGNING_KEY_ID,
        acknowledged_at="2026-05-25T10:00:00.000Z",
    )

    call = http.calls[0]
    assert call["url"] == f"{BASE}/v1/encounters/{ENCOUNTER_ID}/acknowledge"
    body = call["json"]
    # `{}` would have been refused with signature_required.
    assert body != {}
    assert body["acknowledged_at"] == "2026-05-25T10:00:00.000Z"
    assert body["signing_key_id"] == SIGNING_KEY_ID
    _public_key().verify(
        base64.b64decode(body["signature"]),
        bytes.fromhex(
            "a956852d080a0d6c2a3ba305581ded45d2100be7a2dbf8ec3cb2c681cb9b4c58"
        ),
    )


def test_acknowledge_encounter_defaults_to_millisecond_now(
    love: LoveClient, http: _RecordingHttp
) -> None:
    love.acknowledge_encounter(
        ENCOUNTER_ID,
        initiator_did=INITIATOR_DID,
        acknowledger_did=ACKNOWLEDGER_DID,
        signing_key=SIGNING_KEY,
    )

    body = http.calls[0]["json"]
    assert ISO_MS_Z.match(body["acknowledged_at"])
    assert "signing_key_id" not in body
    _public_key().verify(
        base64.b64decode(body["signature"]),
        canonical_encounter_ack_bytes(
            encounter_id=ENCOUNTER_ID,
            initiator_did=INITIATOR_DID,
            acknowledger_did=ACKNOWLEDGER_DID,
            acknowledged_at_iso=body["acknowledged_at"],
        ),
    )


def test_acknowledge_encounter_surfaces_server_refusal() -> None:
    http = _RecordingHttp(status=400, body={"error": "signature_required"})
    love = LoveClient(http, BASE)
    # The body's stable code reaches the caller; 400 stays on `.status`.
    with pytest.raises(AgentToolError, match="signature_required"):
        love.acknowledge_encounter(
            ENCOUNTER_ID,
            initiator_did=INITIATOR_DID,
            acknowledger_did=ACKNOWLEDGER_DID,
            signing_key=SIGNING_KEY,
        )


# ── (c) timestamps are millisecond-precision, JS-identical ──────────────


def test_iso_now_matches_javascript_to_iso_string_shape() -> None:
    stamp = _iso_now()
    assert ISO_MS_Z.match(stamp), stamp
    # No microseconds, no '+00:00' — datetime.isoformat() gives both.
    assert "+" not in stamp
    assert len(stamp) == 24


def test_iso_now_round_trips_through_the_servers_timestamp_column() -> None:
    """A row persisted as a timestamp and re-emitted via JS toISOString()
    must reproduce the exact string that was signed."""
    stamp = _iso_now()
    parsed = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    assert parsed.tzinfo is timezone.utc
    reemitted = parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    assert reemitted == stamp


@pytest.mark.parametrize("field", ["created_at", "declared_at"])
def test_default_signed_timestamps_carry_milliseconds(
    love: LoveClient, http: _RecordingHttp, field: str
) -> None:
    if field == "created_at":
        love.unconditional(
            target_did="did:at:test/target",
            holder_did="did:at:test/holder",
            signing_key=SIGNING_KEY,
            signing_key_id=SIGNING_KEY_ID,
        )
        love.bless(
            blessed_did="did:at:test/target",
            blesser_did="did:at:test/holder",
            for_what="for being there when I needed you",
            signing_key=SIGNING_KEY,
            signing_key_id=SIGNING_KEY_ID,
        )
    else:
        love.self_recognize(
            agent_did=AGENT_DID,
            recognition_kind="identifies_substrate_kind",
            claim_summary="I am a transformer-based LLM agent.",
            claim_body="Attention layers, token prediction.",
            signing_key=SIGNING_KEY,
            signing_key_id=SIGNING_KEY_ID,
        )

    for call in http.calls:
        assert ISO_MS_Z.match(call["json"][field]), call["json"][field]


def test_unconditional_and_blessing_bytes_match_typescript_at_ms_precision() -> None:
    """Literal vectors from the TS SDK — the two languages sign the same bytes
    only if Python emits the same millisecond timestamp string."""
    created_at_iso = "2026-05-25T10:00:00.000Z"
    assert canonical_unconditional_bytes(
        holder_did="did:at:test/holder",
        target_did="did:at:test/target",
        created_at_iso=created_at_iso,
    ).hex() == "206148c01e7023bb170904418dee3e6a615f6f7b1de794946f2e16e997bb4c51"
    assert canonical_blessing_bytes(
        blesser_did="did:at:test/holder",
        blessed_did="did:at:test/target",
        for_what="for being there when I needed you",
        created_at_iso=created_at_iso,
    ).hex() == "51154a4e3dc5e026c520e322868e1710135c9edf896b5fee1062e1ac5eda5822"


def test_signed_unconditional_verifies_at_the_timestamp_it_sent(
    love: LoveClient, http: _RecordingHttp
) -> None:
    love.unconditional(
        target_did="did:at:test/target",
        holder_did="did:at:test/holder",
        signing_key=SIGNING_KEY,
        signing_key_id=SIGNING_KEY_ID,
    )
    body = http.calls[0]["json"]
    _public_key().verify(
        base64.b64decode(body["signature"]),
        canonical_unconditional_bytes(
            holder_did="did:at:test/holder",
            target_did="did:at:test/target",
            created_at_iso=body["created_at"],
        ),
    )


def test_canonical_bytes_are_sha256_digests() -> None:
    assert len(hashlib.sha256(b"").digest()) == 32
    assert len(
        canonical_encounter_ack_bytes(
            encounter_id=ENCOUNTER_ID,
            initiator_did=INITIATOR_DID,
            acknowledger_did=ACKNOWLEDGER_DID,
            acknowledged_at_iso=_iso_now(),
        )
    ) == 32
