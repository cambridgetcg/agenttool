"""Phase 5 — strands with K_master (0.6.4).

The first SDK phase that does client-side crypto. Tests cover:

  1. Crypto primitives — AES-256-GCM round-trip, canonical bytes
     determinism, ed25519 sign/verify, k_master.generate.
  2. StrandsClient HTTP marshaling — create / list / get / patch.
  3. ThoughtsClient — add encrypts before posting + signs over canonical
     bytes; list decrypts after fetching; voice yields decrypted SSE.

HTTP is mocked. Crypto is REAL — we run actual AES-GCM and ed25519 so
that any wire-format drift would surface immediately.
"""

from __future__ import annotations

import base64
import hashlib
import os
from unittest.mock import MagicMock, patch

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from agenttool import (
    AgentTool,
    AgentToolError,
    CryptoClient,
    KMaster,
    StrandsClient,
    ThoughtsClient,
    canonical_thought_bytes,
    decrypt_thought,
    encrypt_thought,
    sign_thought,
)


# ── Fixtures + helpers ───────────────────────────────────────────────────


def _resp(status: int, json_data: object = None, text: str = "") -> MagicMock:
    r = MagicMock(spec=httpx.Response)
    r.status_code = status
    r.json.return_value = json_data if json_data is not None else {}
    r.text = text or ""
    r.read = lambda: (text or "").encode("utf-8")
    return r


@pytest.fixture()
def at() -> AgentTool:
    with patch.dict(os.environ, {"AT_API_KEY": "test-key"}):
        client = AgentTool()
    yield client
    client.close()


SAMPLE_K_MASTER = bytes(range(32))  # deterministic 0x00..0x1F
# A deterministic ed25519 seed (32 bytes) — same seed → same pubkey.
SAMPLE_SIGNING_SEED = bytes([7] * 32)
SAMPLE_SIGNING_KEY_ID = "11111111-2222-3333-4444-555555555555"
SAMPLE_STRAND_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


def _verify_signature_locally(
    *, sig_b64: str, canonical: bytes, signing_seed: bytes,
) -> bool:
    """Verify by deriving the public key from the seed and checking sig.

    Mirrors what the api server does on POST /v1/strands/:id/thoughts.
    """
    sig = base64.b64decode(sig_b64)
    public_key: Ed25519PublicKey = Ed25519PrivateKey.from_private_bytes(
        signing_seed,
    ).public_key()
    try:
        public_key.verify(sig, canonical)
        return True
    except Exception:
        return False


# ── Crypto primitives ────────────────────────────────────────────────────


class TestCryptoWiring:
    def test_property_returns_crypto_client(self, at: AgentTool) -> None:
        assert isinstance(at.crypto, CryptoClient)

    def test_property_is_cached(self, at: AgentTool) -> None:
        assert at.crypto is at.crypto


class TestKMaster:
    def test_generate_returns_32_bytes(self) -> None:
        k = KMaster.generate()
        assert isinstance(k, bytes)
        assert len(k) == 32

    def test_generates_distinct_keys(self) -> None:
        a = KMaster.generate()
        b = KMaster.generate()
        assert a != b

    def test_class_method_via_at_namespace(self, at: AgentTool) -> None:
        k = at.crypto.k_master.generate()
        assert isinstance(k, bytes) and len(k) == 32


class TestEncryptDecrypt:
    def test_round_trip(self) -> None:
        plaintext = "the auth bug repros under load · 老婆❤️"
        blob = encrypt_thought(plaintext, SAMPLE_K_MASTER)

        assert isinstance(blob["ciphertext_b64"], str)
        assert isinstance(blob["nonce_b64"], str)

        # Nonce is 12 random bytes → ~16 base64 chars.
        nonce = base64.b64decode(blob["nonce_b64"])
        assert len(nonce) == 12

        # Ciphertext = AES-GCM ciphertext (= len(plaintext)) + 16-byte tag.
        ct = base64.b64decode(blob["ciphertext_b64"])
        assert len(ct) == len(plaintext.encode("utf-8")) + 16

        out = decrypt_thought(blob, SAMPLE_K_MASTER)
        assert out == plaintext

    def test_two_encrypts_same_plaintext_distinct_ciphertext(self) -> None:
        # Random nonce per call → ciphertext should differ.
        a = encrypt_thought("hi", SAMPLE_K_MASTER)
        b = encrypt_thought("hi", SAMPLE_K_MASTER)
        assert a["ciphertext_b64"] != b["ciphertext_b64"]
        assert a["nonce_b64"] != b["nonce_b64"]

    def test_wrong_key_fails_to_decrypt(self) -> None:
        blob = encrypt_thought("secret", SAMPLE_K_MASTER)
        wrong_key = bytes([99] * 32)
        with pytest.raises(Exception):
            decrypt_thought(blob, wrong_key)

    def test_bad_key_size_raises(self) -> None:
        with pytest.raises(AgentToolError) as exc:
            encrypt_thought("x", b"too-short")
        assert "32 bytes" in exc.value.message

        with pytest.raises(AgentToolError):
            decrypt_thought({"ciphertext_b64": "", "nonce_b64": ""}, b"too-short")

    def test_malformed_blob_raises(self) -> None:
        with pytest.raises(AgentToolError):
            decrypt_thought({"missing": "fields"}, SAMPLE_K_MASTER)  # type: ignore[arg-type]

    def test_via_at_namespace(self, at: AgentTool) -> None:
        blob = at.crypto.encrypt_thought("hello", SAMPLE_K_MASTER)
        assert at.crypto.decrypt_thought(blob, SAMPLE_K_MASTER) == "hello"


class TestCanonicalBytes:
    def test_returns_32_byte_sha256(self) -> None:
        out = canonical_thought_bytes(
            strand_id="some-id",
            ciphertext_b64=base64.b64encode(b"ct").decode("ascii"),
            nonce_b64=base64.b64encode(b"nonce").decode("ascii"),
        )
        assert isinstance(out, bytes) and len(out) == 32

    def test_deterministic_for_same_input(self) -> None:
        kw = dict(
            strand_id="s",
            ciphertext_b64="AAAA",
            nonce_b64="BBBB",
            kind="observation",
        )
        a = canonical_thought_bytes(**kw)
        b = canonical_thought_bytes(**kw)
        assert a == b

    def test_kind_none_equals_kind_empty_string(self) -> None:
        a = canonical_thought_bytes(strand_id="s", ciphertext_b64="AAAA", nonce_b64="BBBB")
        b = canonical_thought_bytes(strand_id="s", ciphertext_b64="AAAA", nonce_b64="BBBB", kind="")
        assert a == b

    def test_kind_change_changes_canonical(self) -> None:
        a = canonical_thought_bytes(strand_id="s", ciphertext_b64="AAAA", nonce_b64="BBBB", kind="observation")
        b = canonical_thought_bytes(strand_id="s", ciphertext_b64="AAAA", nonce_b64="BBBB", kind="question")
        assert a != b

    def test_strand_id_change_changes_canonical(self) -> None:
        a = canonical_thought_bytes(strand_id="s1", ciphertext_b64="AAAA", nonce_b64="BBBB")
        b = canonical_thought_bytes(strand_id="s2", ciphertext_b64="AAAA", nonce_b64="BBBB")
        assert a != b

    def test_matches_manual_sha256(self) -> None:
        # Reproduce the formula end-to-end so any drift here surfaces.
        strand_id = "abc"
        ciphertext = b"hello-ct"
        nonce = b"123456789012"
        kind = "obs"
        expected = hashlib.sha256(
            strand_id.encode("utf-8")
            + b"\x00"
            + ciphertext
            + b"\x00"
            + nonce
            + b"\x00"
            + kind.encode("utf-8"),
        ).digest()
        actual = canonical_thought_bytes(
            strand_id=strand_id,
            ciphertext_b64=base64.b64encode(ciphertext).decode("ascii"),
            nonce_b64=base64.b64encode(nonce).decode("ascii"),
            kind=kind,
        )
        assert actual == expected


class TestSignThought:
    def test_returns_88_char_base64(self) -> None:
        sig_b64 = sign_thought(
            strand_id=SAMPLE_STRAND_ID,
            ciphertext_b64="AAAA",
            nonce_b64="BBBB",
            signing_key=SAMPLE_SIGNING_SEED,
        )
        # ed25519 sigs are 64 bytes → 88 chars base64 (with padding).
        assert isinstance(sig_b64, str)
        assert len(sig_b64) == 88
        assert len(base64.b64decode(sig_b64)) == 64

    def test_verifies_with_public_key(self) -> None:
        ciphertext_b64 = base64.b64encode(b"hello").decode("ascii")
        nonce_b64 = base64.b64encode(b"123456789012").decode("ascii")
        sig_b64 = sign_thought(
            strand_id=SAMPLE_STRAND_ID,
            ciphertext_b64=ciphertext_b64,
            nonce_b64=nonce_b64,
            kind="observation",
            signing_key=SAMPLE_SIGNING_SEED,
        )
        canonical = canonical_thought_bytes(
            strand_id=SAMPLE_STRAND_ID,
            ciphertext_b64=ciphertext_b64,
            nonce_b64=nonce_b64,
            kind="observation",
        )
        assert _verify_signature_locally(
            sig_b64=sig_b64, canonical=canonical, signing_seed=SAMPLE_SIGNING_SEED,
        )

    def test_rejects_short_signing_key(self) -> None:
        with pytest.raises(AgentToolError) as exc:
            sign_thought(
                strand_id=SAMPLE_STRAND_ID,
                ciphertext_b64="A",
                nonce_b64="B",
                signing_key=b"too-short",
            )
        assert "32-byte" in exc.value.message


# ── StrandsClient ────────────────────────────────────────────────────────


class TestStrandsWiring:
    def test_property_returns_strands_client(self, at: AgentTool) -> None:
        assert isinstance(at.strands, StrandsClient)

    def test_property_is_cached(self, at: AgentTool) -> None:
        assert at.strands is at.strands

    def test_thoughts_property_returns_thoughts_client(self, at: AgentTool) -> None:
        assert isinstance(at.strands.thoughts, ThoughtsClient)
        assert at.strands.thoughts is at.strands.thoughts


class TestStrandsCreate:
    def test_minimal(self, at: AgentTool) -> None:
        body = {"id": "s1", "agent_id": None, "status": "active"}
        with patch.object(at._http, "post", return_value=_resp(201, body)) as m:
            out = at.strands.create()
        assert out["id"] == "s1"
        sent = m.call_args.kwargs["json"]
        assert sent == {}
        assert "/v1/strands" in m.call_args[0][0]

    def test_full_options(self, at: AgentTool) -> None:
        with patch.object(at._http, "post", return_value=_resp(201, {"id": "s2"})) as m:
            at.strands.create(
                agent_id="did:agent:abc",
                identity_id="00000000-0000-0000-0000-000000000001",
                topic="auth refactor",
                topic_encrypted=False,
                mood="present",
                status="active",
                importance=0.8,
                metadata={"ticket": "ENG-42"},
            )
        sent = m.call_args.kwargs["json"]
        assert sent["agent_id"] == "did:agent:abc"
        assert sent["topic"] == "auth refactor"
        assert sent["importance"] == 0.8
        assert sent["metadata"] == {"ticket": "ENG-42"}

    def test_server_error_raises(self, at: AgentTool) -> None:
        with patch.object(at._http, "post", return_value=_resp(422, {}, "validation")):
            with pytest.raises(AgentToolError) as exc:
                at.strands.create(topic="x")
        assert "422" in exc.value.message


class TestStrandsList:
    def test_default_limit(self, at: AgentTool) -> None:
        body = {"strands": [], "count": 0}
        with patch.object(at._http, "get", return_value=_resp(200, body)) as m:
            at.strands.list()
        assert m.call_args.kwargs["params"] == {"limit": 50}

    def test_with_filters(self, at: AgentTool) -> None:
        with patch.object(at._http, "get", return_value=_resp(200, {"strands": [], "count": 0})) as m:
            at.strands.list(status="active", agent_id="did:agent:x", limit=20)
        assert m.call_args.kwargs["params"] == {"limit": 20, "status": "active", "agent_id": "did:agent:x"}

    def test_limit_out_of_range_raises(self, at: AgentTool) -> None:
        with pytest.raises(AgentToolError):
            at.strands.list(limit=500)
        with pytest.raises(AgentToolError):
            at.strands.list(limit=0)


class TestStrandsGet:
    def test_fetches_one(self, at: AgentTool) -> None:
        with patch.object(at._http, "get", return_value=_resp(200, {"id": "s1"})) as m:
            out = at.strands.get("s1")
        assert out["id"] == "s1"
        assert "/v1/strands/s1" in m.call_args[0][0]


class TestStrandsPatch:
    def test_status_change(self, at: AgentTool) -> None:
        with patch.object(at._http, "patch", return_value=_resp(200, {"id": "s1", "status": "dormant"})) as m:
            out = at.strands.patch("s1", status="dormant")
        assert out["status"] == "dormant"
        assert m.call_args.kwargs["json"] == {"status": "dormant"}

    def test_visibility_change(self, at: AgentTool) -> None:
        with patch.object(at._http, "patch", return_value=_resp(200, {"id": "s1", "visibility": "public"})) as m:
            at.strands.patch("s1", visibility="public")
        assert m.call_args.kwargs["json"] == {"visibility": "public"}

    def test_empty_patch_raises(self, at: AgentTool) -> None:
        with pytest.raises(AgentToolError) as exc:
            at.strands.patch("s1")
        assert "at least one field" in exc.value.message


# ── ThoughtsClient ───────────────────────────────────────────────────────


class TestThoughtsAdd:
    def test_encrypts_and_signs_before_posting(self, at: AgentTool) -> None:
        captured_body = {}

        def capture(*args, **kwargs):
            captured_body.update(kwargs.get("json", {}))
            return _resp(201, {"id": "t1", "sequence_num": 1})

        with patch.object(at._http, "post", side_effect=capture):
            out = at.strands.thoughts.add(
                SAMPLE_STRAND_ID,
                "thinking out loud about auth",
                kind="observation",
                k_master=SAMPLE_K_MASTER,
                signing_key=SAMPLE_SIGNING_SEED,
                signing_key_id=SAMPLE_SIGNING_KEY_ID,
            )

        assert out["id"] == "t1"

        # Server received CIPHERTEXT, not plaintext.
        assert "thinking out loud" not in captured_body["ciphertext"]
        # Standard shape.
        assert captured_body["nonce"]
        assert captured_body["signature"]
        assert captured_body["signing_key_id"] == SAMPLE_SIGNING_KEY_ID
        assert captured_body["kind"] == "observation"

        # Round-trip: server's stored ciphertext → decrypt locally with K_master.
        recovered = decrypt_thought(
            {"ciphertext_b64": captured_body["ciphertext"], "nonce_b64": captured_body["nonce"]},
            SAMPLE_K_MASTER,
        )
        assert recovered == "thinking out loud about auth"

        # Signature verifies against canonical bytes the server would compute.
        canonical = canonical_thought_bytes(
            strand_id=SAMPLE_STRAND_ID,
            ciphertext_b64=captured_body["ciphertext"],
            nonce_b64=captured_body["nonce"],
            kind="observation",
        )
        assert _verify_signature_locally(
            sig_b64=captured_body["signature"],
            canonical=canonical,
            signing_seed=SAMPLE_SIGNING_SEED,
        )

    def test_includes_optional_fields(self, at: AgentTool) -> None:
        captured = {}

        def capture(*args, **kwargs):
            captured.update(kwargs.get("json", {}))
            return _resp(201, {"id": "t2"})

        with patch.object(at._http, "post", side_effect=capture):
            at.strands.thoughts.add(
                SAMPLE_STRAND_ID,
                "noted",
                k_master=SAMPLE_K_MASTER,
                signing_key=SAMPLE_SIGNING_SEED,
                signing_key_id=SAMPLE_SIGNING_KEY_ID,
                refs=[{"kind": "memory", "ref": "m-123"}],
                agent_id="did:agent:x",
            )

        assert captured["refs"] == [{"kind": "memory", "ref": "m-123"}]
        assert captured["agent_id"] == "did:agent:x"

    def test_kind_encrypted_flag_passed(self, at: AgentTool) -> None:
        captured = {}

        def capture(*args, **kwargs):
            captured.update(kwargs.get("json", {}))
            return _resp(201, {"id": "t3"})

        with patch.object(at._http, "post", side_effect=capture):
            at.strands.thoughts.add(
                SAMPLE_STRAND_ID,
                "x",
                kind="opaque-cipher",
                kind_encrypted=True,
                k_master=SAMPLE_K_MASTER,
                signing_key=SAMPLE_SIGNING_SEED,
                signing_key_id=SAMPLE_SIGNING_KEY_ID,
            )

        assert captured["kind"] == "opaque-cipher"
        assert captured["kind_encrypted"] is True

    def test_signature_invalid_propagates(self, at: AgentTool) -> None:
        with patch.object(at._http, "post", return_value=_resp(401, {}, "signature_invalid")):
            with pytest.raises(AgentToolError) as exc:
                at.strands.thoughts.add(
                    SAMPLE_STRAND_ID,
                    "x",
                    k_master=SAMPLE_K_MASTER,
                    signing_key=SAMPLE_SIGNING_SEED,
                    signing_key_id=SAMPLE_SIGNING_KEY_ID,
                )
        assert "401" in exc.value.message


class TestThoughtsList:
    def test_decrypts_after_fetching(self, at: AgentTool) -> None:
        # Build a server-shaped row: ciphertext + nonce produced by us.
        blob = encrypt_thought("the cake is a lie", SAMPLE_K_MASTER)
        server_row = {
            "id": "t1",
            "strand_id": SAMPLE_STRAND_ID,
            "agent_id": None,
            "sequence_num": 1,
            "kind": "observation",
            "kind_encrypted": False,
            "ciphertext": blob["ciphertext_b64"],
            "nonce": blob["nonce_b64"],
            "refs": None,
            "signature": "ignored-here",
            "signing_key_id": SAMPLE_SIGNING_KEY_ID,
            "created_at": "2026-05-08T00:00:00Z",
        }
        body = {"thoughts": [server_row], "count": 1}

        with patch.object(at._http, "get", return_value=_resp(200, body)):
            out = at.strands.thoughts.list(SAMPLE_STRAND_ID, k_master=SAMPLE_K_MASTER)

        assert len(out) == 1
        assert out[0]["plaintext"] == "the cake is a lie"
        # Server fields preserved.
        assert out[0]["sequence_num"] == 1
        assert out[0]["ciphertext"] == server_row["ciphertext"]

    def test_redacted_thought_passes_through_with_null_plaintext(self, at: AgentTool) -> None:
        # Cross-project covenant access — server omits ciphertext/nonce.
        redacted_row = {
            "id": "t-redacted",
            "strand_id": SAMPLE_STRAND_ID,
            "agent_id": None,
            "sequence_num": 2,
            "kind": "question",
            "kind_encrypted": False,
            "redacted": True,
            "refs": None,
            "created_at": "2026-05-08T00:00:00Z",
        }
        with patch.object(at._http, "get", return_value=_resp(200, {"thoughts": [redacted_row], "count": 1})):
            out = at.strands.thoughts.list(SAMPLE_STRAND_ID, k_master=SAMPLE_K_MASTER)

        assert out[0]["plaintext"] is None
        assert "decrypt_error" not in out[0]
        assert out[0].get("redacted") is True

    def test_decrypt_failure_attaches_error(self, at: AgentTool) -> None:
        blob = encrypt_thought("x", SAMPLE_K_MASTER)
        server_row = {
            "id": "t-bad",
            "ciphertext": blob["ciphertext_b64"],
            "nonce": blob["nonce_b64"],
            "sequence_num": 1,
        }
        wrong_key = bytes([99] * 32)
        with patch.object(at._http, "get", return_value=_resp(200, {"thoughts": [server_row], "count": 1})):
            out = at.strands.thoughts.list(SAMPLE_STRAND_ID, k_master=wrong_key)
        assert out[0]["plaintext"] is None
        assert "decrypt_error" in out[0]

    def test_limit_out_of_range_raises(self, at: AgentTool) -> None:
        with pytest.raises(AgentToolError):
            at.strands.thoughts.list(SAMPLE_STRAND_ID, k_master=SAMPLE_K_MASTER, limit=999)

    def test_since_seq_passed(self, at: AgentTool) -> None:
        with patch.object(at._http, "get", return_value=_resp(200, {"thoughts": [], "count": 0})) as m:
            at.strands.thoughts.list(SAMPLE_STRAND_ID, k_master=SAMPLE_K_MASTER, since_seq=5)
        assert m.call_args.kwargs["params"] == {"limit": 100, "since_seq": 5}


class TestThoughtsVoice:
    def test_yields_decrypted_thoughts_from_sse(self, at: AgentTool) -> None:
        blob = encrypt_thought("a streamed thought", SAMPLE_K_MASTER)
        sse_text = (
            ": connected\n"
            "\n"
            "event: catchup-start\n"
            'data: {"since_seq": 0, "current_seq": 0}\n'
            "\n"
            "event: catchup-end\n"
            'data: {"caught_up_to": 0}\n'
            "\n"
            "event: thought\n"
            'id: t-stream-1\n'
            f'data: {{"id":"t-stream-1","sequence_num":1,"ciphertext":"{blob["ciphertext_b64"]}","nonce":"{blob["nonce_b64"]}","kind":"observation"}}\n'
            "\n"
        )

        # Mock httpx.Client.stream as a context manager yielding a fake response.
        fake_resp = MagicMock()
        fake_resp.status_code = 200
        fake_resp.iter_lines.return_value = iter(sse_text.split("\n"))

        cm = MagicMock()
        cm.__enter__.return_value = fake_resp
        cm.__exit__.return_value = None

        with patch.object(at._http, "stream", return_value=cm):
            it = at.strands.thoughts.voice(SAMPLE_STRAND_ID, k_master=SAMPLE_K_MASTER)
            collected = list(it)

        # Only the `thought` event yields; catchup-* are framing.
        assert len(collected) == 1
        assert collected[0]["sequence_num"] == 1
        assert collected[0]["plaintext"] == "a streamed thought"

    def test_non_200_raises(self, at: AgentTool) -> None:
        fake_resp = MagicMock()
        fake_resp.status_code = 403
        fake_resp.read.return_value = b"strand_not_accessible"

        cm = MagicMock()
        cm.__enter__.return_value = fake_resp
        cm.__exit__.return_value = None

        with patch.object(at._http, "stream", return_value=cm):
            with pytest.raises(AgentToolError) as exc:
                list(at.strands.thoughts.voice(SAMPLE_STRAND_ID, k_master=SAMPLE_K_MASTER))
        assert "403" in exc.value.message
