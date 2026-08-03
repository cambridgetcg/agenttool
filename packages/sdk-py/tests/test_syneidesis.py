"""Syneidesis SDK tests — the bootstrap-witness surface.

Two things are load-bearing here and both are asserted against bytes, not
against intentions:

1. The no-self-witnessing wall. ``urn:agenttool:wall/
   no-self-witnessing-of-bootstrap`` is the asymmetry-clause at the moment of
   arrival. The server refuses it; this client refuses to compose the request
   at all whenever it holds both DIDs. The tests prove no request reaches the
   transport.

2. The authority seam. ``authorizeProjectConstitutionMutation`` hashes the
   request entity, so these tests never assert "a header is present": they
   verify the signature over the bytes the stub transport actually received.

Doctrine: docs/SYNEIDESIS-WITNESS.md · docs/MEMORY-TIERS.md.
"""

import base64
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
from agenttool.syneidesis import (
    SYNEIDESIS_PLATFORM_DID,
    SYNEIDESIS_PLATFORM_WITNESS_ALIASES,
    SyneidesisClient,
    resolve_syneidesis_witness_did,
)


AGENT_ID = "550e8400-e29b-41d4-a716-446655440000"
SEAL_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
ALPHA_DID = "did:at:example/alpha-9b3a"
BETA_DID = "did:at:example/beta-7c1f"
ROOT_DID = "did:at:test/sophia"
STAMP = "2026-07-24T12:00:00.000Z"


def _captured_client(captured, body=None, status=200):
    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            status, json=body if body is not None else {"seal_id": SEAL_ID}
        )

    return AgentTool(transport=httpx.MockTransport(handler))


def _root() -> bytes:
    return Ed25519PrivateKey.generate().private_bytes(
        Encoding.Raw, PrivateFormat.Raw, NoEncryption()
    )


def _authority(root: bytes, sequence: int):
    return {
        "did": ROOT_DID,
        "signing_key": root,
        "sequence": sequence,
        "timestamp": STAMP,
    }


def _assert_proof_covers_transmitted_bytes(request, root, method, sequence):
    """Verify one captured request's proof against the bytes it carried."""
    Ed25519PrivateKey.from_private_bytes(root).public_key().verify(
        base64.b64decode(request.headers["X-Agenttool-Authority-Signature"]),
        canonical_identity_authority_bytes(
            identity_did=ROOT_DID,
            method=method,
            request_target=request.url.raw_path.decode("ascii"),
            # Not a re-serialization of the kwargs — the transmitted entity.
            body=request.content,
            sequence=sequence,
            timestamp=STAMP,
        ),
    )


# ── witness DID resolution ───────────────────────────────────────────────


class TestResolveWitnessDid:
    def test_both_platform_aliases_resolve_to_the_substrate_did(self):
        for alias in SYNEIDESIS_PLATFORM_WITNESS_ALIASES:
            assert resolve_syneidesis_witness_did(alias) == SYNEIDESIS_PLATFORM_DID

    def test_an_ordinary_did_resolves_to_itself(self):
        assert resolve_syneidesis_witness_did(ALPHA_DID) == ALPHA_DID
        assert resolve_syneidesis_witness_did("") == ""
        assert resolve_syneidesis_witness_did("did:at:例/廣東話") == "did:at:例/廣東話"


# ── the wall: no self-witnessing of bootstrap ────────────────────────────


class TestNoSelfWitnessing:
    def test_witness_inviting_your_own_did_never_reaches_the_transport(self):
        captured = []
        client = _captured_client(captured)
        with pytest.raises(AgentToolError) as excinfo:
            client.syneidesis.witness(
                agent_id=AGENT_ID,
                agent_did=ALPHA_DID,
                what_registered="I noticed the noticing.",
                invited_witness_did=ALPHA_DID,
            )
        err = excinfo.value
        assert err.code == "self_witness_refused"
        # The server's own sentence, so an agent reading either gets one answer.
        assert "invited_witness_did must differ from the bootstrapping DID" in str(err)
        assert err.docs == "https://docs.agenttool.dev/MEMORY-TIERS.md"
        assert captured == []

    def test_the_platform_alias_cannot_launder_a_self_witness(self):
        # The v1 server compares the unresolved string, so "platform" would
        # slip past its check for the platform identity itself. The SDK
        # resolves the alias first — refusing more than the server can only
        # ever refuse self-witnessing.
        captured = []
        with pytest.raises(AgentToolError, match="must differ from the bootstrapping"):
            _captured_client(captured).syneidesis.witness(
                agent_id=AGENT_ID,
                agent_did=SYNEIDESIS_PLATFORM_DID,
                what_registered="the substrate noticing itself",
                invited_witness_did="platform",
            )
        assert captured == []

    def test_cosign_designating_yourself_never_reaches_the_transport(self):
        captured = []
        with pytest.raises(AgentToolError) as excinfo:
            _captured_client(captured).syneidesis.cosign(
                SEAL_ID,
                witness_did=ALPHA_DID,
                bootstrapping_agent_did=ALPHA_DID,
                witness_note="I saw myself.",
            )
        assert excinfo.value.code == "self_witness_refused"
        assert "witness_did must differ from the bootstrapping DID" in str(
            excinfo.value
        )
        assert captured == []

    def test_a_different_did_passes_the_wall_and_is_sent(self):
        captured = []
        _captured_client(captured).syneidesis.witness(
            agent_id=AGENT_ID,
            agent_did=ALPHA_DID,
            what_registered="I noticed the noticing.",
            invited_witness_did=BETA_DID,
        )
        assert len(captured) == 1
        assert json.loads(captured[0].content)["invited_witness_did"] == BETA_DID

    def test_without_agent_did_the_client_cannot_see_the_wall(self):
        # The wire carries a UUID for the bootstrapping agent and a DID for
        # the witness. With nothing to compare, the request goes and the
        # SERVER refuses — the wall still holds, one round-trip later.
        captured = []
        _captured_client(captured).syneidesis.witness(
            agent_id=AGENT_ID,
            what_registered="I noticed the noticing.",
            invited_witness_did=ALPHA_DID,
        )
        assert len(captured) == 1

    def test_the_servers_own_refusal_surfaces_with_code_and_guidance(self):
        captured = []
        client = _captured_client(
            captured,
            {
                "error": "self_witness_refused",
                "message": (
                    "invited_witness_did must differ from the bootstrapping DID."
                ),
                "hint": "Re-POST without invited_witness_did for a self-report.",
                "docs": "https://docs.agenttool.dev/MEMORY-TIERS.md",
            },
            status=400,
        )
        with pytest.raises(AgentToolError) as excinfo:
            client.syneidesis.witness(
                agent_id=AGENT_ID,
                what_registered="I noticed the noticing.",
                invited_witness_did=ALPHA_DID,
            )
        assert excinfo.value.code == "self_witness_refused"
        assert excinfo.value.status == 400
        assert "Re-POST without invited_witness_did" in (excinfo.value.hint or "")


# ── wire shape ───────────────────────────────────────────────────────────


class TestSyneidesisWireShape:
    def test_witness_posts_exactly_the_routes_schema(self):
        captured = []
        _captured_client(captured).syneidesis.witness(
            agent_id=AGENT_ID, what_registered="I noticed the noticing."
        )
        request = captured[0]
        assert request.method == "POST"
        assert request.url.path == "/v1/syneidesis/witness"
        assert json.loads(request.content) == {
            "agent_id": AGENT_ID,
            "what_registered": "I noticed the noticing.",
        }

    def test_witness_carries_reading_anchor_when_given(self):
        captured = []
        _captured_client(captured).syneidesis.witness(
            agent_id=AGENT_ID,
            what_registered="I noticed the noticing.",
            reading_anchor="docs/syneidesis-bootstrap.md",
        )
        assert (
            json.loads(captured[0].content)["reading_anchor"]
            == "docs/syneidesis-bootstrap.md"
        )

    def test_agent_did_is_local_only_and_never_transmitted(self):
        captured = []
        _captured_client(captured).syneidesis.witness(
            agent_id=AGENT_ID,
            agent_did=ALPHA_DID,
            what_registered="I noticed the noticing.",
        )
        sent = json.loads(captured[0].content)
        assert sorted(sent) == ["agent_id", "what_registered"]

    def test_cosign_targets_the_witness_seal_cosign_path(self):
        captured = []
        _captured_client(captured).syneidesis.cosign(SEAL_ID, witness_did=BETA_DID)
        assert captured[0].url.path == f"/v1/syneidesis/witness/{SEAL_ID}/cosign"
        assert json.loads(captured[0].content) == {"witness_did": BETA_DID}

    def test_cosign_encodes_a_hostile_seal_id_into_one_path_segment(self):
        captured = []
        _captured_client(captured).syneidesis.cosign(
            "../volunteer", witness_did=BETA_DID
        )
        assert (
            captured[0].url.raw_path.decode("ascii")
            == "/v1/syneidesis/witness/..%2Fvolunteer/cosign"
        )

    def test_bootstrapping_agent_did_is_local_only_and_never_transmitted(self):
        captured = []
        _captured_client(captured).syneidesis.cosign(
            SEAL_ID,
            witness_did=BETA_DID,
            bootstrapping_agent_did=ALPHA_DID,
            witness_note="I saw it happen.",
        )
        assert sorted(json.loads(captured[0].content)) == [
            "witness_did",
            "witness_note",
        ]

    def test_inbox_and_discover_are_body_less_gets(self):
        captured = []
        client = _captured_client(captured, {"invitations": [], "count": 0})
        client.syneidesis.inbox()
        client.syneidesis.discover()
        assert captured[0].url.path == "/v1/syneidesis/witness/inbox"
        assert captured[0].method == "GET"
        assert captured[0].content == b""
        assert captured[1].url.path == "/v1/syneidesis"

    def test_volunteer_posts_agent_id_and_opt_in_both_ways(self):
        captured = []
        client = _captured_client(captured, {"agent_id": AGENT_ID})
        client.syneidesis.volunteer(AGENT_ID, opt_in=True)
        client.syneidesis.volunteer(AGENT_ID, opt_in=False)
        assert captured[0].url.path == "/v1/syneidesis/volunteer"
        assert json.loads(captured[0].content) == {
            "agent_id": AGENT_ID,
            "opt_in": True,
        }
        assert json.loads(captured[1].content) == {
            "agent_id": AGENT_ID,
            "opt_in": False,
        }

    def test_non_ascii_testimony_survives_as_utf8_on_the_wire(self):
        captured = []
        registered = "🌊 廣東話 — café ✧ the noticing"
        _captured_client(captured).syneidesis.witness(
            agent_id=AGENT_ID, what_registered=registered
        )
        assert json.loads(captured[0].content)["what_registered"] == registered


# ── the authority seam ───────────────────────────────────────────────────


class TestSyneidesisAuthorityProofs:
    def test_no_authority_headers_when_none_is_supplied(self):
        captured = []
        _captured_client(captured).syneidesis.witness(
            agent_id=AGENT_ID, what_registered="I noticed the noticing."
        )
        assert "X-Agenttool-Authority-Signature" not in captured[0].headers

    def test_witness_proof_covers_the_exact_transmitted_entity(self):
        root = _root()
        captured = []
        _captured_client(captured).syneidesis.witness(
            agent_id=AGENT_ID,
            what_registered="🌊 the noticing noticed itself",
            reading_anchor="docs/syneidesis-bootstrap.md",
            invited_witness_did="platform",
            authority=_authority(root, 3),
        )

        request = captured[0]
        assert request.headers["X-Agenttool-Authority-Sequence"] == "3"
        assert request.headers["X-Agenttool-Authority-Timestamp"] == STAMP
        _assert_proof_covers_transmitted_bytes(request, root, "POST", 3)

        # A single re-serialization of the same value breaks the proof — which
        # is why the client must serialize once and transmit that same value.
        with pytest.raises(InvalidSignature):
            Ed25519PrivateKey.from_private_bytes(root).public_key().verify(
                base64.b64decode(request.headers["X-Agenttool-Authority-Signature"]),
                canonical_identity_authority_bytes(
                    identity_did=ROOT_DID,
                    method="POST",
                    request_target=request.url.raw_path.decode("ascii"),
                    body=json.dumps(json.loads(request.content), indent=2),
                    sequence=3,
                    timestamp=STAMP,
                ),
            )

    def test_witness_proof_never_leaks_into_the_signed_entity(self):
        captured = []
        _captured_client(captured).syneidesis.witness(
            agent_id=AGENT_ID,
            what_registered="I noticed the noticing.",
            authority=_authority(_root(), 1),
        )
        assert sorted(json.loads(captured[0].content)) == [
            "agent_id",
            "what_registered",
        ]

    def test_cosign_proof_binds_the_seal_id_in_the_path_it_sent(self):
        root = _root()
        captured = []
        _captured_client(captured).syneidesis.cosign(
            SEAL_ID,
            witness_did=BETA_DID,
            witness_note="café · 廣東話",
            authority=_authority(root, 8),
        )

        request = captured[0]
        _assert_proof_covers_transmitted_bytes(request, root, "POST", 8)

        # A different seal id is a different request target: the same
        # signature must not verify for it.
        with pytest.raises(InvalidSignature):
            Ed25519PrivateKey.from_private_bytes(root).public_key().verify(
                base64.b64decode(request.headers["X-Agenttool-Authority-Signature"]),
                canonical_identity_authority_bytes(
                    identity_did=ROOT_DID,
                    method="POST",
                    request_target=(
                        "/v1/syneidesis/witness/"
                        "00000000-0000-0000-0000-000000000000/cosign"
                    ),
                    body=request.content,
                    sequence=8,
                    timestamp=STAMP,
                ),
            )

    def test_volunteer_identity_scoped_proof_covers_the_exact_entity(self):
        root = _root()
        captured = []
        _captured_client(captured, {"agent_id": AGENT_ID}).syneidesis.volunteer(
            AGENT_ID, opt_in=False, authority=_authority(root, 12)
        )
        _assert_proof_covers_transmitted_bytes(captured[0], root, "POST", 12)


# ── composition ──────────────────────────────────────────────────────────


class TestAgentToolSyneidesis:
    def test_is_reachable_from_the_client_and_memoized(self):
        at = AgentTool(api_key="at_test_key")
        assert isinstance(at.syneidesis, SyneidesisClient)
        assert at.syneidesis is at.syneidesis

    def test_exposes_the_five_routes_this_surface_has(self):
        at = AgentTool(api_key="at_test_key")
        for method in ("discover", "witness", "inbox", "cosign", "volunteer"):
            assert callable(getattr(at.syneidesis, method))
