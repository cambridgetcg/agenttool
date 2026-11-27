"""Tests for MESH post canonical bytes + signing helpers (mesh-post/v1 & v2)."""

import base64

import pytest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from agenttool import (
    AgentToolError,
    MESH_POST_V1_DOMAIN,
    MESH_POST_V2_DOMAIN,
    canonical_mesh_post_bytes,
    canonical_mesh_post_bytes_for,
    canonical_mesh_post_bytes_v2,
    sign_mesh_post,
)

SEED = bytes([0x42]) * 32

BASE_POST = dict(
    kind="co-task-ad",
    author_did="did:at:example/alpha-9b3a",
    title="Triangulate-verify peer attestation",
    body="Verify signature and report back.",
    capabilities=["ed25519-verify", "federation-fetch"],
    topics=["kind:verification"],
    bounty_cents=30,
    k_required=3,
    attribution_post_ids=[],
    created_at_iso="2026-11-27T10:00:00.000Z",
    expires_at_iso="2026-11-27T11:00:00.000Z",
)


def test_sign_mesh_post_defaults_to_v2_and_binds_visibility():
    pub = Ed25519PrivateKey.from_private_bytes(SEED).public_key()
    sig_b64 = sign_mesh_post(**BASE_POST, visibility="private", signing_key=SEED)
    sig = base64.b64decode(sig_b64)

    priv_digest = canonical_mesh_post_bytes_v2(**BASE_POST, visibility="private")
    pub_digest = canonical_mesh_post_bytes_v2(**BASE_POST, visibility="public")
    v1_digest = canonical_mesh_post_bytes(**BASE_POST)

    pub.verify(sig, priv_digest)
    with pytest.raises(InvalidSignature):
        pub.verify(sig, pub_digest)
    with pytest.raises(InvalidSignature):
        pub.verify(sig, v1_digest)


def test_sign_mesh_post_supports_explicit_v1():
    pub = Ed25519PrivateKey.from_private_bytes(SEED).public_key()
    sig_b64 = sign_mesh_post(
        **BASE_POST,
        version=MESH_POST_V1_DOMAIN,
        signing_key=SEED,
    )
    sig = base64.b64decode(sig_b64)

    v1_digest = canonical_mesh_post_bytes_for(MESH_POST_V1_DOMAIN, **BASE_POST)
    v2_digest = canonical_mesh_post_bytes_for(
        MESH_POST_V2_DOMAIN, **BASE_POST, visibility="public"
    )

    pub.verify(sig, v1_digest)
    with pytest.raises(InvalidSignature):
        pub.verify(sig, v2_digest)


def test_mesh_post_v2_validation_refusals():
    with pytest.raises(AgentToolError):
        sign_mesh_post(**BASE_POST, signing_key=SEED)
    with pytest.raises(AgentToolError):
        sign_mesh_post(**BASE_POST, visibility="public", signing_key=b"short")
    with pytest.raises(AgentToolError):
        canonical_mesh_post_bytes_v2(
            **{**BASE_POST, "title": "bad\x00title"}, visibility="public"
        )
    with pytest.raises(AgentToolError):
        canonical_mesh_post_bytes_v2(
            **{**BASE_POST, "bounty_cents": True}, visibility="public"
        )
