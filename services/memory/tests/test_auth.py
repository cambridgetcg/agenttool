"""Tests for API key generation and verification."""

from src.auth import hash_api_key, verify_api_key

import secrets


def _generate_test_key() -> str:
    return f"am_{secrets.token_urlsafe(32)}"


class TestApiKeyAuth:
    def test_hash_and_verify(self):
        key = _generate_test_key()
        hashed = hash_api_key(key)
        assert hashed != key  # not plaintext
        assert verify_api_key(key, hashed) is True

    def test_wrong_key_fails(self):
        key = _generate_test_key()
        hashed = hash_api_key(key)
        wrong_key = _generate_test_key()
        assert verify_api_key(wrong_key, hashed) is False

    def test_hash_is_unique(self):
        key = _generate_test_key()
        hash1 = hash_api_key(key)
        hash2 = hash_api_key(key)
        # bcrypt uses random salt, so same key → different hash
        assert hash1 != hash2
        # But both should verify
        assert verify_api_key(key, hash1) is True
        assert verify_api_key(key, hash2) is True

    def test_empty_key(self):
        hashed = hash_api_key("")
        assert verify_api_key("", hashed) is True
        assert verify_api_key("not-empty", hashed) is False
