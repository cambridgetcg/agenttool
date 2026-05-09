"""Phase 5.5 — SOMA seed (BIP39 mnemonic + SLIP-0010 derivation).

Tests cover:

  1. BIP39 mnemonic generation + validation.
  2. Determinism — same mnemonic → identical bytes (byte-equal across
     test runs and across the py + ts SDKs; the TS test file
     `phase5_seed.test.ts` uses the SAME fixed vectors below).
  3. Path scheme — different purposes/indices produce different secrets.
  4. Passphrase — different passphrase → different identity.
  5. CryptoClient namespace — at.crypto.seed.* is callable.

The fixed test vectors below are the **byte-identical interop oracle**
between py and ts SDKs. They MUST stay equal across both files. Any
divergence here means wire format drift — fail loud.

Doctrine: docs/IDENTITY-SEED.md.
"""

from __future__ import annotations

import base64
import os
from unittest.mock import patch

import pytest

from agenttool import (
    AgentTool,
    AgentToolError,
    DerivedBundle,
    SeedClient,
    derive,
    derive_bridge_signing,
    derive_wallet,
    generate_mnemonic,
    mnemonic_to_seed,
)


# ── Fixed test vectors — interop oracle (mirror in phase5_seed.test.ts) ─

# Canonical BIP39 12-word test vector (entropy = 0x00...0x00, checksum "about").
TEST_MNEMONIC = (
    "abandon abandon abandon abandon abandon abandon abandon abandon "
    "abandon abandon abandon about"
)

# Derived under the m/44'/169'/<purpose>'/<index>' scheme. Generated once;
# both SDKs MUST produce these exact base64 outputs for this mnemonic.
EXPECT_SIGNING_PUB_B64 = "MvGLRKH953Fqbr2CENCcK/USGXCATv4nZYfsrW8sqSw="
EXPECT_SIGNING_PRIV_B64 = "IJWkOQ3G6GDP5N35esAJ5VjiIcQ9gi1XUF2JoRyOR7o="
EXPECT_K_MASTER_B64 = "hd+mJHIz2tay3d2IPP4Xaq5juGoTUbmHvDXhqAtSi1w="
EXPECT_K_VAULT_B64 = "R2CSaWsKXf7erBD9v1o/zRxwbntDd7eZsu8va4qSqO4="
EXPECT_BOX_PUB_B64 = "4ZKHNkxigN4wKm97eG3YVInZ48nfaW+p+dPrVCuRoR4="
EXPECT_BOX_PRIV_B64 = "363XOfkNUxFo5JR+Z4VQ6VeJAW4JOPuTEkpQJKH+n1U="

# With passphrase "TREZOR" — different identity.
EXPECT_SIGNING_PUB_PP_B64 = "OtrPkVoK5nTAKT6YTQs+oWmlMoWjy7IKqcW0Crz5yV8="
EXPECT_K_MASTER_PP_B64 = "d9WaQdSEJXwTxDUnU0zq7uOx9G/ex7Rop8KPxwY/imU="

# Per-device bridge signing keys.
EXPECT_BRIDGE_PUB_DEV0_B64 = "uvdMUpz1PQK6UMDl2LYEHKg+q5m4y1yhCI0mzAgz+50="
EXPECT_BRIDGE_PUB_DEV1_B64 = "A28FtnU9e+mIp5L+JUmyr2SPezwuICGVok0EpVgCywY="

# Per-wallet derived secrets.
EXPECT_WALLET_SEED_IDX0_B64 = "warNX6fONKORuLCegzHIg2/dp4QDve7ipBOA2wAjgRk="


@pytest.fixture()
def at() -> AgentTool:
    with patch.dict(os.environ, {"AT_API_KEY": "test-key"}):
        client = AgentTool()
    yield client
    client.close()


# ── BIP39 mnemonic generation ───────────────────────────────────────────


class TestGenerateMnemonic:
    def test_default_24_words(self) -> None:
        words = generate_mnemonic()
        assert len(words.split()) == 24

    def test_strength_128_yields_12_words(self) -> None:
        words = generate_mnemonic(strength=128)
        assert len(words.split()) == 12

    def test_strength_192_yields_18_words(self) -> None:
        words = generate_mnemonic(strength=192)
        assert len(words.split()) == 18

    def test_invalid_strength_raises(self) -> None:
        for bad in (64, 100, 257, 512):
            with pytest.raises(AgentToolError):
                generate_mnemonic(strength=bad)

    def test_distinct_phrases(self) -> None:
        # Unique entropy each call.
        a = generate_mnemonic()
        b = generate_mnemonic()
        assert a != b


class TestMnemonicToSeed:
    def test_canonical_vector(self) -> None:
        # BIP39 published test vector: 12-word "abandon...about" + TREZOR
        # passphrase. This is the canonical BIP39 reference seed; if either
        # SDK drifts on PBKDF2-HMAC-SHA512 implementation or NFKD
        # normalisation, this will catch it.
        seed = mnemonic_to_seed(TEST_MNEMONIC, passphrase="TREZOR")
        assert len(seed) == 64
        expected_prefix = bytes.fromhex(
            "c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e5349553"
        )
        assert seed[:32] == expected_prefix

    def test_invalid_mnemonic_raises(self) -> None:
        with pytest.raises(AgentToolError) as exc:
            mnemonic_to_seed("invalid words that are not a real mnemonic")
        assert "invalid BIP39" in exc.value.message

    def test_passphrase_changes_seed(self) -> None:
        a = mnemonic_to_seed(TEST_MNEMONIC, passphrase="")
        b = mnemonic_to_seed(TEST_MNEMONIC, passphrase="TREZOR")
        assert a != b


# ── Determinism + cross-language interop oracle ─────────────────────────


class TestDeriveCrossLanguageOracle:
    """These vectors are the byte-identical interop oracle. The TS test
    file `phase5_seed.test.ts` uses the same mnemonic and asserts the
    same b64 outputs. Drift here = wire format drift across SDKs."""

    def test_signing_pub_matches_oracle(self) -> None:
        b = derive(TEST_MNEMONIC)
        assert b.signing_pub_b64 == EXPECT_SIGNING_PUB_B64

    def test_signing_priv_matches_oracle(self) -> None:
        b = derive(TEST_MNEMONIC)
        assert b.signing_priv_b64 == EXPECT_SIGNING_PRIV_B64

    def test_k_master_matches_oracle(self) -> None:
        b = derive(TEST_MNEMONIC)
        assert b.k_master_b64 == EXPECT_K_MASTER_B64

    def test_k_vault_matches_oracle(self) -> None:
        b = derive(TEST_MNEMONIC)
        assert b.k_vault_b64 == EXPECT_K_VAULT_B64

    def test_box_pub_matches_oracle(self) -> None:
        b = derive(TEST_MNEMONIC)
        assert b.box_pub_b64 == EXPECT_BOX_PUB_B64

    def test_box_priv_matches_oracle(self) -> None:
        b = derive(TEST_MNEMONIC)
        assert b.box_priv_b64 == EXPECT_BOX_PRIV_B64

    def test_passphrase_matches_oracle(self) -> None:
        b = derive(TEST_MNEMONIC, passphrase="TREZOR")
        assert b.signing_pub_b64 == EXPECT_SIGNING_PUB_PP_B64
        assert b.k_master_b64 == EXPECT_K_MASTER_PP_B64

    def test_bridge_dev0_matches_oracle(self) -> None:
        _, pub = derive_bridge_signing(TEST_MNEMONIC, device_index=0)
        assert base64.b64encode(pub).decode() == EXPECT_BRIDGE_PUB_DEV0_B64

    def test_bridge_dev1_matches_oracle(self) -> None:
        _, pub = derive_bridge_signing(TEST_MNEMONIC, device_index=1)
        assert base64.b64encode(pub).decode() == EXPECT_BRIDGE_PUB_DEV1_B64

    def test_wallet_idx0_matches_oracle(self) -> None:
        secret = derive_wallet(TEST_MNEMONIC, wallet_index=0)
        assert base64.b64encode(secret).decode() == EXPECT_WALLET_SEED_IDX0_B64


class TestDeterminism:
    def test_same_mnemonic_same_bytes(self) -> None:
        a = derive(TEST_MNEMONIC)
        b = derive(TEST_MNEMONIC)
        assert a.signing_pub == b.signing_pub
        assert a.signing_priv == b.signing_priv
        assert a.k_master == b.k_master
        assert a.k_vault == b.k_vault
        assert a.box_pub == b.box_pub
        assert a.box_priv == b.box_priv

    def test_different_mnemonics_different_bytes(self) -> None:
        a = derive(TEST_MNEMONIC)
        b = derive(generate_mnemonic())
        assert a.signing_pub != b.signing_pub
        assert a.k_master != b.k_master


# ── Path scheme — different purposes/indices produce different secrets ──


class TestPathScheme:
    def test_each_purpose_distinct(self) -> None:
        b = derive(TEST_MNEMONIC)
        # All six 32-byte secrets must be distinct.
        secrets = [b.signing_priv, b.k_master, b.k_vault, b.box_priv]
        assert len(set(secrets)) == len(secrets)

    def test_bridge_devices_distinct(self) -> None:
        priv0, _ = derive_bridge_signing(TEST_MNEMONIC, device_index=0)
        priv1, _ = derive_bridge_signing(TEST_MNEMONIC, device_index=1)
        priv2, _ = derive_bridge_signing(TEST_MNEMONIC, device_index=2)
        assert priv0 != priv1 != priv2 != priv0

    def test_wallet_indices_distinct(self) -> None:
        s0 = derive_wallet(TEST_MNEMONIC, wallet_index=0)
        s1 = derive_wallet(TEST_MNEMONIC, wallet_index=1)
        assert s0 != s1


class TestPassphrase:
    def test_passphrase_different_identity(self) -> None:
        a = derive(TEST_MNEMONIC)
        b = derive(TEST_MNEMONIC, passphrase="alpha")
        c = derive(TEST_MNEMONIC, passphrase="beta")
        # Three distinct identities from one mnemonic.
        assert a.signing_pub != b.signing_pub
        assert a.signing_pub != c.signing_pub
        assert b.signing_pub != c.signing_pub
        assert a.k_master != b.k_master
        assert a.k_master != c.k_master


# ── DerivedBundle behaviour ─────────────────────────────────────────────


class TestDerivedBundle:
    def test_repr_redacts_privates(self) -> None:
        b = derive(TEST_MNEMONIC)
        s = repr(b)
        # Pubs may appear (truncated); privates must NOT.
        assert b.signing_priv_b64 not in s
        assert b.k_master_b64 not in s
        assert b.k_vault_b64 not in s
        assert b.box_priv_b64 not in s
        assert "redacted" in s

    def test_all_keys_correct_length(self) -> None:
        b = derive(TEST_MNEMONIC)
        assert len(b.signing_priv) == 32
        assert len(b.signing_pub) == 32
        assert len(b.k_master) == 32
        assert len(b.k_vault) == 32
        assert len(b.box_priv) == 32
        assert len(b.box_pub) == 32

    def test_b64_helpers_round_trip(self) -> None:
        b = derive(TEST_MNEMONIC)
        assert base64.b64decode(b.signing_pub_b64) == b.signing_pub
        assert base64.b64decode(b.k_master_b64) == b.k_master
        assert base64.b64decode(b.box_pub_b64) == b.box_pub


# ── at.crypto.seed namespace ────────────────────────────────────────────


class TestSeedNamespace:
    def test_at_crypto_seed_returns_seed_client(self, at: AgentTool) -> None:
        # at.crypto.seed is a property; it returns the SeedClient class
        # itself (per crypto.py wiring), not an instance — methods are
        # static so this is fine.
        assert at.crypto.seed is SeedClient or isinstance(at.crypto.seed, SeedClient)

    def test_generate_via_namespace(self, at: AgentTool) -> None:
        words = at.crypto.seed.generate_mnemonic(strength=128)
        assert len(words.split()) == 12

    def test_derive_via_namespace_matches_module(self, at: AgentTool) -> None:
        b1 = derive(TEST_MNEMONIC)
        b2 = at.crypto.seed.derive(TEST_MNEMONIC)
        assert b1.signing_pub == b2.signing_pub
        assert b1.k_master == b2.k_master

    def test_bridge_signing_via_namespace(self, at: AgentTool) -> None:
        a_priv, a_pub = derive_bridge_signing(TEST_MNEMONIC, device_index=3)
        b_priv, b_pub = at.crypto.seed.derive_bridge_signing(
            TEST_MNEMONIC, device_index=3,
        )
        assert a_priv == b_priv
        assert a_pub == b_pub

    def test_wallet_via_namespace(self, at: AgentTool) -> None:
        a = derive_wallet(TEST_MNEMONIC, wallet_index=7)
        b = at.crypto.seed.derive_wallet(TEST_MNEMONIC, wallet_index=7)
        assert a == b
