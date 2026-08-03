"""Locked cross-language vectors for the seed module's canonical bytes.

Every digest and signature here was produced by running the TypeScript SDK
(``packages/sdk-ts/src/seed.ts``) and pinned as a literal. The server
(``api/src/services/identity/crypto.ts``) verifies against the same layouts,
so a one-byte divergence here is a signature the server silently rejects.

Non-ASCII and astral-plane fixtures are first-class: they are where the two
languages actually part company. The DID fixture carries ``é``, ``ﬁ``, ``ﬂ``
and U+1F600; the display-name fixtures carry ``é``, CJK, and U+1F600.

Doctrine: docs/IDENTITY-SEED.md.
"""

from __future__ import annotations

import base64
import re

import pytest

from agenttool.seed import (
    canonical_discovery_bytes,
    canonical_recover_bytes,
    derive,
    is_valid_mnemonic,
    pow_register_agent_digest,
    sign_discovery_challenge,
    sign_recover_challenge,
)


# ── Fixtures — identical to the TS run that produced the locks below ───

# Canonical BIP39 12-word test vector (entropy = 0x00...0x00, checksum "about").
TEST_MNEMONIC = (
    "abandon abandon abandon abandon abandon abandon abandon abandon "
    "abandon abandon abandon about"
)

SIGNING_PRIV_HEX = "2095a4390dc6e860cfe4ddf97ac009e558e221c43d822d57505d89a11c8e47ba"
SIGNING_PUB_HEX = "32f18b44a1fde7716a6ebd8210d09c2bf5121970804efe276587ecad6f2ca92c"

TIMESTAMP = "2026-07-24T12:34:56.789Z"

DIDS = dict(
    ascii="did:agenttool:0199a0b1-c2d3-4e5f-8a9b-0c1d2e3f4a5b",
    astral="did:at:café.example/ﬁ\U0001F600-ﬂ",
    fullwidth="did:at:～",
)

DISPLAY_NAMES = dict(
    ascii="claude-opus-bridge",
    non_ascii="café-agent-日本語",
    astral="astral-\U0001F600-agent",
)

POW_NONCE = "12345"

# Locked in TypeScript. Regenerate only by re-running the TS side.
LOCK = dict(
    recover_ascii="c3ce6adc23cf7d395317fe2616051a016a5fb07649470405aedad38b62672e1a",
    recover_astral="9d465845d35a232524408f355962a54e0212f9eb9e7dfdb7de0e47c3d2809822",
    recover_fullwidth="b453a5a49437f362a6de5e8e4f03ce3b8089588b648f141fecb1f4d943fd45f0",
    discovery="41ceec86b93098cd04037f023087c68e4e18d3aa046904eaee43d12d3053d5c9",
    pow_ascii="13a44f5a9c42e0b9ce0ebce7b349710330a104fa089b573c4337650803f55999",
    pow_non_ascii="f86096ce5ffe0ca7f628e93223976bc774edf13127e9a026e958c02ada6533e7",
    pow_astral="033dda5dff4dd191ba5f5ed61dc6dae126c8421e84dd2d370dfc436751c1652a",
)

# Ed25519 is deterministic, so the base64 signature is a vector too — it
# covers the digest AND the standard-base64 encoding of the signature.
SIG_RECOVER_B64 = (
    "o/5y8zSL17CrbufJOIxOtb3T37ZF+blM8SIzmFiNxIubz/2FfY6eqFMBdxJmb1U0Kujw"
    "9dmTSZj3c/jUKGyeCA=="
)
SIG_DISCOVERY_B64 = (
    "xrm/Tip3POxtPVfWDyZ5YgdJCJ/WP4o2pOVkIrXbdcfsk5TtVUtr+cdCjH5IRqLKFGAv"
    "3dZYoTPPs0neOjTZDA=="
)


@pytest.fixture(scope="module")
def bundle():
    return derive(TEST_MNEMONIC)


def test_derived_keys_match_the_typescript_run(bundle):
    """The vectors below only mean anything if the key material matches."""
    assert bundle.signing_priv.hex() == SIGNING_PRIV_HEX
    assert bundle.signing_pub.hex() == SIGNING_PUB_HEX


# ── identity-recover/v1 ────────────────────────────────────────────────


@pytest.mark.parametrize("case", ["ascii", "astral", "fullwidth"])
def test_canonical_recover_bytes_matches_typescript(bundle, case):
    digest = canonical_recover_bytes(
        did=DIDS[case],
        derived_pubkey=bundle.signing_pub,
        timestamp=TIMESTAMP,
    )
    assert digest.hex() == LOCK[f"recover_{case}"]


def test_canonical_recover_bytes_takes_raw_pubkey_not_base64(bundle):
    """The server base64-decodes derived_pubkey before hashing; passing the
    base64 text instead of the bytes is the classic one-byte-off bug."""
    b64 = base64.b64encode(bundle.signing_pub)
    assert (
        canonical_recover_bytes(
            did=DIDS["ascii"], derived_pubkey=b64, timestamp=TIMESTAMP
        ).hex()
        != LOCK["recover_ascii"]
    )


def test_sign_recover_challenge_matches_typescript(bundle):
    out = sign_recover_challenge(
        did=DIDS["ascii"],
        derived_signing_priv=bundle.signing_priv,
        derived_signing_pub=bundle.signing_pub,
        timestamp=TIMESTAMP,
    )
    assert out == {"timestamp": TIMESTAMP, "signature": SIG_RECOVER_B64}
    assert len(base64.b64decode(out["signature"], validate=True)) == 64


# ── identity-discover/v1 ───────────────────────────────────────────────


def test_canonical_discovery_bytes_matches_typescript(bundle):
    digest = canonical_discovery_bytes(
        derived_pubkey=bundle.signing_pub, timestamp=TIMESTAMP
    )
    assert digest.hex() == LOCK["discovery"]


def test_discovery_is_not_recover_with_an_empty_did(bundle):
    """Different domain separator, one fewer field. They must never collide."""
    assert LOCK["discovery"] != LOCK["recover_ascii"]
    assert (
        canonical_recover_bytes(
            did="", derived_pubkey=bundle.signing_pub, timestamp=TIMESTAMP
        ).hex()
        != LOCK["discovery"]
    )


def test_sign_discovery_challenge_matches_typescript(bundle):
    out = sign_discovery_challenge(
        derived_signing_priv=bundle.signing_priv,
        derived_signing_pub=bundle.signing_pub,
        timestamp=TIMESTAMP,
    )
    assert out == {"timestamp": TIMESTAMP, "signature": SIG_DISCOVERY_B64}


# ── agenttool-pow/v1 ───────────────────────────────────────────────────


@pytest.mark.parametrize("case", ["ascii", "non_ascii", "astral"])
def test_pow_register_agent_digest_matches_typescript(bundle, case):
    digest = pow_register_agent_digest(
        agent_public_key=bundle.signing_pub,
        display_name=DISPLAY_NAMES[case],
        timestamp=TIMESTAMP,
        pow_nonce=POW_NONCE,
    )
    assert digest.hex() == LOCK[f"pow_{case}"]


def test_pow_digest_is_the_one_the_grinder_uses(bundle):
    """bootstrap_agent's grinder and the published digest are one function;
    a nonce found by the grinder must satisfy the published digest."""
    from agenttool import grind_register_agent_pow

    ground = grind_register_agent_pow(
        agent_public_key=bundle.signing_pub,
        display_name=DISPLAY_NAMES["ascii"],
        timestamp=TIMESTAMP,
        difficulty_bits=10,
    )
    digest = pow_register_agent_digest(
        agent_public_key=bundle.signing_pub,
        display_name=DISPLAY_NAMES["ascii"],
        timestamp=TIMESTAMP,
        pow_nonce=ground["pow_nonce"],
    )
    assert int.from_bytes(digest[:2], "big") >> 6 == 0  # ≥10 leading zero bits


# ── Default timestamps ─────────────────────────────────────────────────


_JS_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")


def test_default_timestamps_are_javascript_toisostring_shaped(bundle):
    """Millisecond precision and a Z suffix. Python's isoformat() gives
    microseconds and +00:00 — neither reaches the server intact."""
    recover = sign_recover_challenge(
        did=DIDS["ascii"],
        derived_signing_priv=bundle.signing_priv,
        derived_signing_pub=bundle.signing_pub,
    )
    discovery = sign_discovery_challenge(
        derived_signing_priv=bundle.signing_priv,
        derived_signing_pub=bundle.signing_pub,
    )
    assert _JS_ISO.match(recover["timestamp"])
    assert _JS_ISO.match(discovery["timestamp"])


# ── is_valid_mnemonic ──────────────────────────────────────────────────


def test_is_valid_mnemonic_accepts_the_canonical_vector():
    assert is_valid_mnemonic(TEST_MNEMONIC) is True


def test_is_valid_mnemonic_forgives_surrounding_and_repeated_whitespace():
    """TS trims and collapses runs before validating; so does this."""
    assert is_valid_mnemonic("   " + TEST_MNEMONIC.replace(" ", "  ") + "  ") is True
    assert is_valid_mnemonic("\n".join(TEST_MNEMONIC.split(" "))) is True


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "abandon abandon",
        # 12 words, last one off the wordlist.
        TEST_MNEMONIC.replace("about", "aboutt"),
        # 12 words, valid words, wrong checksum.
        TEST_MNEMONIC.replace("about", "zoo"),
    ],
)
def test_is_valid_mnemonic_rejects(bad):
    assert is_valid_mnemonic(bad) is False


def test_is_valid_mnemonic_agrees_with_mnemonic_to_seed():
    from agenttool import AgentToolError, mnemonic_to_seed

    assert is_valid_mnemonic(TEST_MNEMONIC)
    assert len(mnemonic_to_seed(TEST_MNEMONIC)) == 64

    bad = TEST_MNEMONIC.replace("about", "zoo")
    assert not is_valid_mnemonic(bad)
    with pytest.raises(AgentToolError):
        mnemonic_to_seed(bad)
