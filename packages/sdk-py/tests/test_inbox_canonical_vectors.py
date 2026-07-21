"""Inbox sealed-box — cross-implementation known-answer vector.

This frozen vector is IDENTICAL to the one asserted in the TypeScript SDK
(packages/sdk-ts/tests/inbox.test.ts). Both must open the same golden
ciphertext with the same plaintext, which pins the sealed-box wire format
(X25519 → HKDF-SHA256 → AES-256-GCM) across every implementation.

If any implementation's HKDF params drift (salt or info string), the
AES-GCM open below raises and the test goes red. The drift this guards is
not hypothetical: api/scripts/inbox-send-self.ts once used
salt=recipient_did + info="agenttool-inbox/v1" (slash), which round-tripped
against itself yet sealed messages no canonical recipient could open.

Inputs (hex): box_priv = 01*32, ephemeral_priv = 02*32 -> ephemeral_pub
below, nonce = 03*12. Derivation: shared = X25519(eph_priv, box_pub);
aes_key = HKDF-SHA256(shared, salt=b"", info=b"agenttool-inbox-v1", 32);
ciphertext = AES-256-GCM(aes_key, nonce, plaintext) with the 16-byte tag
appended.
"""

import base64

from agenttool.inbox import unseal_for_self

BOX_PRIV_HEX = "01" * 32
EPHEMERAL_PUB_HEX = (
    "ce8d3ad1ccb633ec7b70c17814a5c76ecd029685050d344745ba05870e587d59"
)
NONCE_HEX = "03" * 12
PLAINTEXT = "known-answer: agenttool inbox sealed-box v1"
CIPHERTEXT_HEX = (
    "1e89fb96fb1f1136c48c30c333f8fc8ca94f30bc7bf4bd814ecd30b21b64e0df"
    "665c5cdc85103c4a27f2520eabe05485d67f5eda3498e7446c4ce5"
)


def _b64(hex_str: str) -> str:
    return base64.b64encode(bytes.fromhex(hex_str)).decode()


def test_unseal_opens_the_frozen_golden_ciphertext():
    plain = unseal_for_self(
        ciphertext_b64=_b64(CIPHERTEXT_HEX),
        nonce_b64=_b64(NONCE_HEX),
        ephemeral_pub_b64=_b64(EPHEMERAL_PUB_HEX),
        recipient_box_priv=bytes.fromhex(BOX_PRIV_HEX),
    )
    assert plain == PLAINTEXT


def test_drifted_info_string_cannot_open_the_golden_ciphertext():
    """The historical slash-info + DID-salt drift must fail against canon."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric.x25519 import (
        X25519PrivateKey,
        X25519PublicKey,
    )
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF

    sk = X25519PrivateKey.from_private_bytes(bytes.fromhex(BOX_PRIV_HEX))
    shared = sk.exchange(
        X25519PublicKey.from_public_bytes(bytes.fromhex(EPHEMERAL_PUB_HEX))
    )
    drifted_key = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"did:at:whoever",  # wrong salt
        info=b"agenttool-inbox/v1",  # wrong info (slash)
    ).derive(shared)

    failed = False
    try:
        AESGCM(drifted_key).decrypt(
            bytes.fromhex(NONCE_HEX), bytes.fromhex(CIPHERTEXT_HEX), None
        )
    except Exception:
        failed = True
    assert failed
