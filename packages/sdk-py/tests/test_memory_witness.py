"""Memory-witness marketplace SDK tests — paid constitutive seals.

Three properties carry weight here:

1. ``memory-witness-issue/v1`` is byte-identical to the server. The shared
   fixture (tests/test_canonical_vectors.py) pins the hexes; this suite pins
   the guards and the sign/verify roundtrip.

2. A witness never signs an opaque blob. ``signing_payload`` recomputes the
   digest from the terms the server printed and refuses on disagreement.

3. Issue elevates a memory to constitutive, so the route runs
   ``authorizeProjectConstitutionMutation``. The proof is asserted over the
   bytes the stub transport actually received.

Doctrine: docs/MARKETPLACE.md (Paid memory witness) · docs/MEMORY-TIERS.md.
"""

import base64
import hashlib
import json

import httpx
import pytest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
)

from agenttool import AgentTool
from agenttool.authority import canonical_identity_authority_bytes
from agenttool.exceptions import AgentToolError
from agenttool.memory_witness import (
    MEMORY_WITNESS_ISSUE_FIELD_ORDER,
    MEMORY_WITNESS_ISSUE_SIGNATURE_CONTEXT,
    MemoryWitnessClient,
    canonical_memory_witness_issue_bytes,
    memory_content_sha256,
    sign_memory_witness_issue,
)


GRANT_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
ROOT_DID = "did:at:test/buyer-root"
STAMP = "2026-07-24T12:00:00.000Z"
SHA_HEX = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

FIELDS = {
    "listing_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "grant_id": GRANT_ID,
    "escrow_id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
    "buyer_identity_id": "dddddddd-dddd-dddd-dddd-dddddddddddd",
    "buyer_project_id": "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    "buyer_wallet_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "memory_id": "11111111-1111-1111-1111-111111111111",
    "memory_identity_id": "22222222-2222-2222-2222-222222222222",
    "memory_content_sha256": SHA_HEX,
    "source_tier": "foundational",
    "target_tier": "constitutive",
    "claim_kind": "continuity_of_self",
    "witness_identity_id": "33333333-3333-3333-3333-333333333333",
    "witness_did": "did:at:example/witness",
    "witness_project_id": "44444444-4444-4444-4444-444444444444",
    "signing_key_id": "55555555-5555-5555-5555-555555555555",
    "witness_wallet_id": "66666666-6666-6666-6666-666666666666",
    "gross_amount": 10000,
    "currency": "USDC",
    "rate_bps": 500,
    "platform_fee": 500,
    "net_amount": 9500,
    "authorization_expires_at": "2026-05-11T12:00:00.000Z",
}


def _fields(**patch):
    merged = dict(FIELDS)
    merged.update(patch)
    return merged


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _seed() -> bytes:
    return Ed25519PrivateKey.generate().private_bytes(
        Encoding.Raw, PrivateFormat.Raw, NoEncryption()
    )


def _captured_client(captured, body, status=200):
    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(status, json=body)

    return AgentTool(transport=httpx.MockTransport(handler))


def _payload_response(fields, signed_payload_b64=None):
    return {
        "signing_payload": {
            "signature_context": MEMORY_WITNESS_ISSUE_SIGNATURE_CONTEXT,
            "field_order": list(MEMORY_WITNESS_ISSUE_FIELD_ORDER),
            "fields": fields,
            "signed_payload_b64": signed_payload_b64
            or _b64(canonical_memory_witness_issue_bytes(fields)),
            "authorization_expires_at": fields["authorization_expires_at"],
        }
    }


# ── canonical bytes ──────────────────────────────────────────────────────


class TestCanonicalMemoryWitnessIssueBytes:
    def test_produces_a_32_byte_digest_deterministically(self):
        a = canonical_memory_witness_issue_bytes(FIELDS)
        b = canonical_memory_witness_issue_bytes(dict(FIELDS))
        assert len(a) == 32
        assert a == b

    def test_independent_cross_check_against_the_documented_framing(self):
        joined = MEMORY_WITNESS_ISSUE_SIGNATURE_CONTEXT.encode("utf-8")
        for name in MEMORY_WITNESS_ISSUE_FIELD_ORDER:
            value = FIELDS[name]
            rendered = "null" if value is None else str(value)
            joined += b"\x00" + rendered.encode("utf-8")
        assert canonical_memory_witness_issue_bytes(FIELDS) == hashlib.sha256(
            joined
        ).digest()

    def test_null_and_the_literal_string_collide_by_construction(self):
        # Pinned rather than pretended away: both render as "null". The server
        # does the same, so the shared fixture carries this collision too.
        assert canonical_memory_witness_issue_bytes(
            _fields(memory_identity_id=None)
        ) == canonical_memory_witness_issue_bytes(_fields(memory_identity_id="null"))

    def test_every_field_is_load_bearing(self):
        baseline = canonical_memory_witness_issue_bytes(FIELDS)
        mutations = [
            {"listing_id": "different"},
            {"grant_id": "different"},
            {"escrow_id": "different"},
            {"buyer_identity_id": "different"},
            {"buyer_project_id": "different"},
            {"buyer_wallet_id": "different"},
            {"memory_id": "different"},
            {"memory_identity_id": None},
            {"memory_content_sha256": "0" * 64},
            {"claim_kind": "different"},
            {"witness_identity_id": "different"},
            {"witness_did": "different"},
            {"witness_project_id": "different"},
            {"signing_key_id": "different"},
            {"witness_wallet_id": "different"},
            {"gross_amount": 20000, "platform_fee": 1000, "net_amount": 19000},
            {"currency": "EURC"},
            {"rate_bps": 250, "platform_fee": 250, "net_amount": 9750},
            {"authorization_expires_at": "2026-05-11T12:00:01.000Z"},
        ]
        for patch in mutations:
            assert canonical_memory_witness_issue_bytes(_fields(**patch)) != baseline

    @pytest.mark.parametrize(
        "label,patch",
        [
            ("NUL in claim_kind", {"claim_kind": "before\u0000after"}),
            ("NUL in witness_did", {"witness_did": "before\u0000after"}),
            (
                "uppercase content hash",
                {"memory_content_sha256": SHA_HEX.upper()},
            ),
            ("short content hash", {"memory_content_sha256": "abc"}),
            ("unauthorized tier pair", {"source_tier": "episodic"}),
            ("fee split mismatch", {"platform_fee": 400}),
            (
                "rate over ceiling",
                {
                    "gross_amount": 100,
                    "rate_bps": 10001,
                    "platform_fee": 100,
                    "net_amount": 0,
                },
            ),
            (
                "negative amount",
                {"gross_amount": -1, "platform_fee": 0, "net_amount": -1},
            ),
            ("fractional amount", {"gross_amount": 10000.5}),
            (
                "expiry without milliseconds",
                {"authorization_expires_at": "2026-05-11T12:00:00Z"},
            ),
            (
                "impossible calendar date",
                {"authorization_expires_at": "2026-02-30T12:00:00.000Z"},
            ),
        ],
    )
    def test_refuses_the_same_inputs_the_server_refuses(self, label, patch):
        with pytest.raises(AgentToolError):
            canonical_memory_witness_issue_bytes(_fields(**patch))

    def test_refuses_malformed_shapes_the_server_would_stringify(self):
        # The server's own callers are typed rows, so it never sees these. A
        # hand-built dict can, and JavaScript's String(undefined) would
        # quietly sign the text "undefined" — a digest neither SDK could
        # ever explain.
        missing = dict(FIELDS)
        del missing["currency"]
        with pytest.raises(AgentToolError, match="currency is required"):
            canonical_memory_witness_issue_bytes(missing)
        with pytest.raises(AgentToolError, match="must not be a boolean"):
            canonical_memory_witness_issue_bytes(_fields(claim_kind=True))

    def test_accepts_the_boundary_cases_that_are_legitimately_valid(self):
        canonical_memory_witness_issue_bytes(
            _fields(gross_amount=0, rate_bps=0, platform_fee=0, net_amount=0)
        )
        canonical_memory_witness_issue_bytes(
            _fields(
                gross_amount=100, rate_bps=10000, platform_fee=100, net_amount=0
            )
        )
        # An empty field still occupies its NUL-delimited slot.
        canonical_memory_witness_issue_bytes(_fields(currency=""))


class TestMemoryContentSha256:
    def test_is_the_servers_nfc_normalized_sha256(self):
        assert memory_content_sha256("") == SHA_HEX
        # NFC vs NFD spell one word; the hash must not care which arrived.
        assert memory_content_sha256("café") == memory_content_sha256(
            "café"
        )
        assert len(memory_content_sha256("🌊 held")) == 64


class TestSignMemoryWitnessIssue:
    def test_signature_verifies_over_the_canonical_digest(self):
        seed = _seed()
        sig = sign_memory_witness_issue(fields=FIELDS, signing_key=seed)
        Ed25519PrivateKey.from_private_bytes(seed).public_key().verify(
            base64.b64decode(sig), canonical_memory_witness_issue_bytes(FIELDS)
        )

    def test_a_signature_over_one_fee_split_does_not_authorize_another(self):
        seed = _seed()
        sig = sign_memory_witness_issue(fields=FIELDS, signing_key=seed)
        with pytest.raises(InvalidSignature):
            Ed25519PrivateKey.from_private_bytes(seed).public_key().verify(
                base64.b64decode(sig),
                canonical_memory_witness_issue_bytes(
                    _fields(rate_bps=250, platform_fee=250, net_amount=9750)
                ),
            )

    def test_refuses_a_signing_key_that_is_not_a_32_byte_seed(self):
        with pytest.raises(AgentToolError, match="32-byte ed25519 seed"):
            sign_memory_witness_issue(fields=FIELDS, signing_key=b"\x00" * 16)


# ── the payload the witness is asked to sign ─────────────────────────────


class TestSigningPayload:
    def test_returns_the_payload_when_the_digest_matches_its_own_terms(self):
        captured = []
        payload = _captured_client(
            captured, _payload_response(FIELDS)
        ).memory_witness.signing_payload(
            GRANT_ID, signing_key_id=FIELDS["signing_key_id"]
        )
        assert (
            captured[0].url.path
            == f"/v1/memory-witness-grants/{GRANT_ID}/signing-payload"
        )
        assert json.loads(captured[0].content) == {
            "signing_key_id": FIELDS["signing_key_id"]
        }
        assert payload["signed_payload_b64"] == _b64(
            canonical_memory_witness_issue_bytes(FIELDS)
        )

    def test_refuses_when_the_digest_does_not_cover_the_printed_terms(self):
        # The attack this closes: a server (or a proxy) prints terms a witness
        # finds acceptable, and asks for a signature over different ones.
        captured = []
        lying = _payload_response(
            FIELDS,
            _b64(
                canonical_memory_witness_issue_bytes(
                    _fields(witness_wallet_id="99999999-9999-9999-9999-999999999999")
                )
            ),
        )
        with pytest.raises(AgentToolError) as excinfo:
            _captured_client(captured, lying).memory_witness.signing_payload(
                GRANT_ID, signing_key_id=FIELDS["signing_key_id"]
            )
        assert excinfo.value.code == "signing_payload_mismatch"
        assert "Do not sign this payload" in (excinfo.value.hint or "")

    def test_a_server_refusal_surfaces_with_its_code_intact(self):
        captured = []
        with pytest.raises(AgentToolError) as excinfo:
            _captured_client(
                captured,
                {
                    # errors.substrateTaskRefusal spells the code as `error`.
                    "error": "self_witness_forbidden",
                    "message": "A project cannot witness its own memory.",
                    "next_actions": [
                        {
                            "action": "Find a witness from a different project",
                            "method": "GET",
                            "path": "/public/memory-witness-listings",
                        }
                    ],
                },
                status=403,
            ).memory_witness.signing_payload(
                GRANT_ID, signing_key_id=FIELDS["signing_key_id"]
            )
        assert excinfo.value.code == "self_witness_forbidden"
        assert excinfo.value.status == 403
        assert (
            excinfo.value.next_actions[0]["path"]
            == "/public/memory-witness-listings"
        )


# ── the authority seam ───────────────────────────────────────────────────


class TestIssueAuthorityProofs:
    def test_the_proof_covers_the_transmitted_entity(self):
        root = _seed()
        captured = []
        signature = sign_memory_witness_issue(fields=FIELDS, signing_key=_seed())

        _captured_client(
            captured, {"grant": {"status": "issued"}}
        ).memory_witness.issue(
            GRANT_ID,
            signature_b64=signature,
            signing_key_id=FIELDS["signing_key_id"],
            authorization_expires_at=FIELDS["authorization_expires_at"],
            authority={
                "did": ROOT_DID,
                "signing_key": root,
                "sequence": 5,
                "timestamp": STAMP,
            },
        )

        request = captured[0]
        assert request.url.path == f"/v1/memory-witness-grants/{GRANT_ID}/issue"
        assert request.headers["X-Agenttool-Authority-Sequence"] == "5"
        public = Ed25519PrivateKey.from_private_bytes(root).public_key()
        public.verify(
            base64.b64decode(request.headers["X-Agenttool-Authority-Signature"]),
            canonical_identity_authority_bytes(
                identity_did=ROOT_DID,
                method="POST",
                request_target=request.url.raw_path.decode("ascii"),
                # Not a re-serialization of the kwargs — the transmitted entity.
                body=request.content,
                sequence=5,
                timestamp=STAMP,
            ),
        )
        with pytest.raises(InvalidSignature):
            public.verify(
                base64.b64decode(
                    request.headers["X-Agenttool-Authority-Signature"]
                ),
                canonical_identity_authority_bytes(
                    identity_did=ROOT_DID,
                    method="POST",
                    request_target=request.url.raw_path.decode("ascii"),
                    body=json.dumps(json.loads(request.content), indent=2),
                    sequence=5,
                    timestamp=STAMP,
                ),
            )

    def test_the_witness_signature_and_the_root_proof_stay_in_their_channels(self):
        captured = []
        signature = sign_memory_witness_issue(fields=FIELDS, signing_key=_seed())
        _captured_client(captured, {"grant": {}}).memory_witness.issue(
            GRANT_ID,
            signature_b64=signature,
            signing_key_id=FIELDS["signing_key_id"],
            authorization_expires_at=FIELDS["authorization_expires_at"],
            authority={
                "did": ROOT_DID,
                "signing_key": _seed(),
                "sequence": 1,
                "timestamp": STAMP,
            },
        )
        sent = json.loads(captured[0].content)
        assert sorted(sent) == [
            "authorization_expires_at",
            "signature_b64",
            "signing_key_id",
        ]
        # The paid authorization rides the body; the root proof rides headers.
        assert sent["signature_b64"] == signature

    def test_issue_without_an_authority_binding_sends_no_proof_headers(self):
        captured = []
        _captured_client(captured, {"grant": {}}).memory_witness.issue(
            GRANT_ID,
            signature_b64="c2ln",
            signing_key_id=FIELDS["signing_key_id"],
            authorization_expires_at=FIELDS["authorization_expires_at"],
        )
        assert "X-Agenttool-Authority-Signature" not in captured[0].headers


# ── the rest of the lifecycle ────────────────────────────────────────────


class TestMemoryWitnessLifecycle:
    def test_create_listing_omits_absent_optionals(self):
        captured = []
        _captured_client(
            captured, {"listing": {"id": "l"}}
        ).memory_witness.create_listing(
            witness_identity_id=FIELDS["witness_identity_id"],
            name="I will witness continuity claims",
            claim_kind="continuity_of_self",
            price_amount=10000,
            price_currency="USDC",
            witness_wallet_id=FIELDS["witness_wallet_id"],
        )
        assert captured[0].url.path == "/v1/memory-witness-listings"
        assert sorted(json.loads(captured[0].content)) == [
            "claim_kind",
            "name",
            "price_amount",
            "price_currency",
            "witness_identity_id",
            "witness_wallet_id",
        ]

    def test_list_listings_defaults_to_this_projects_shelf(self):
        captured = []
        client = _captured_client(captured, {"listings": []})
        client.memory_witness.list_listings()
        client.memory_witness.list_listings(
            scope="public", claim_kind="continuity of self"
        )
        assert (
            captured[0].url.raw_path.decode("ascii")
            == "/v1/memory-witness-listings?scope=mine"
        )
        assert captured[1].url.raw_path.decode("ascii") == (
            "/v1/memory-witness-listings?scope=public&claim_kind=continuity+of+self"
        )

    def test_create_grant_and_list_grants_carry_the_role_split(self):
        captured = []
        client = _captured_client(captured, {"grant": {}, "grants": []})
        client.memory_witness.create_grant(
            listing_id=FIELDS["listing_id"],
            buyer_identity_id=FIELDS["buyer_identity_id"],
            buyer_wallet_id=FIELDS["buyer_wallet_id"],
            memory_id=FIELDS["memory_id"],
        )
        client.memory_witness.list_grants(role="witness", status="pending")
        assert captured[0].url.path == "/v1/memory-witness-grants"
        assert (
            captured[1].url.raw_path.decode("ascii")
            == "/v1/memory-witness-grants?role=witness&status=pending"
        )

    def test_get_grant_and_get_listing_encode_a_hostile_id(self):
        captured = []
        client = _captured_client(captured, {"grant": {}, "listing": {}})
        client.memory_witness.get_grant("../issue")
        client.memory_witness.get_listing("../../v1/memories")
        assert (
            captured[0].url.raw_path.decode("ascii")
            == "/v1/memory-witness-grants/..%2Fissue"
        )
        assert (
            captured[1].url.raw_path.decode("ascii")
            == "/v1/memory-witness-listings/..%2F..%2Fv1%2Fmemories"
        )

    def test_decline_always_sends_a_reason_field(self):
        captured = []
        client = _captured_client(captured, {"grant": {}})
        client.memory_witness.decline(GRANT_ID)
        client.memory_witness.decline(GRANT_ID, reason="Not mine to witness.")
        assert json.loads(captured[0].content) == {"reason": None}
        assert json.loads(captured[1].content) == {
            "reason": "Not mine to witness."
        }


class TestAgentToolMemoryWitness:
    def test_is_reachable_from_the_client_and_memoized(self):
        at = AgentTool(api_key="at_test_key")
        assert isinstance(at.memory_witness, MemoryWitnessClient)
        assert at.memory_witness is at.memory_witness
