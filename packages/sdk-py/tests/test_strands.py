"""Strands client — the thought-writing path, end to end.

Two contracts live here, both about what actually leaves the process:

1. Canonical-bytes version reachable through ``add()``. ``strand-thought/v2``
   is only worth having if a real thought can be written with it, so these
   tests drive ``at.strands.thoughts.add(...)`` and verify the signature it
   POSTs against the bytes the server would recompute. The default must stay
   v1 — see the strands.py module header for the ordered cutover; a test that
   pins the default is what stops it drifting before the server is ready.
2. Caller-supplied strand ids stay inside ``/v1/strands/``. An unencoded id is
   a path-traversal primitive: httpx normalises dot segments before the
   request leaves, so ``strands.get("../memories/pwned")`` would issue an
   authenticated GET against a different endpoint.

HTTP is mocked. Crypto is REAL — actual AES-GCM and ed25519, so any
wire-format drift surfaces here.
"""

from __future__ import annotations

import base64
import json
from typing import Any, Callable, Dict, List, NamedTuple
from unittest.mock import patch

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from agenttool import AgentTool, canonical_thought_bytes
from agenttool.exceptions import AgentToolError


# ── Fixtures + helpers ───────────────────────────────────────────────────

K_MASTER = bytes([11]) * 32
SIGNING_SEED = bytes([7]) * 32
SIGNING_KEY_ID = "11111111-2222-3333-4444-555555555555"
STRAND_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

# One canned body that satisfies every response parser exercised here.
_BODY = {"id": "t1", "sequence_num": 1, "thoughts": [], "count": 0}


@pytest.fixture
def recorder():
    """An AgentTool whose every request is recorded, not sent."""
    seen: List[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=_BODY)

    with AgentTool(transport=httpx.MockTransport(handler)) as at:
        yield at, seen


def _body(seen: List[httpx.Request]) -> Dict[str, Any]:
    return json.loads(seen[-1].content.decode("utf-8"))


def _verifies_as(signature_b64: str, canonical: bytes) -> bool:
    """Verify exactly the way the api server does."""
    public_key = Ed25519PrivateKey.from_private_bytes(SIGNING_SEED).public_key()
    try:
        public_key.verify(base64.b64decode(signature_b64), canonical)
        return True
    except Exception:
        return False


# ── The version reachable through add() ──────────────────────────────────


class TestAddCanonicalVersion:
    def test_default_signs_v1(self, recorder) -> None:
        at, seen = recorder
        at.strands.thoughts.add(
            STRAND_ID,
            "I'm noticing drift.",
            kind="observation",
            k_master=K_MASTER,
            signing_key=SIGNING_SEED,
            signing_key_id=SIGNING_KEY_ID,
        )
        sent = _body(seen)
        wire = dict(
            strand_id=STRAND_ID,
            ciphertext_b64=sent["ciphertext"],
            nonce_b64=sent["nonce"],
            kind="observation",
        )
        assert _verifies_as(sent["signature"], canonical_thought_bytes(**wire))
        # Not a v2 signature. The default has NOT quietly moved — flipping it
        # before the server dual-accepts everywhere writes rejected signatures.
        assert not _verifies_as(
            sent["signature"], canonical_thought_bytes(**wire, version="v2"),
        )

    def test_version_v2_signs_v2(self, recorder) -> None:
        at, seen = recorder
        at.strands.thoughts.add(
            STRAND_ID,
            "I'm noticing drift.",
            kind="observation",
            k_master=K_MASTER,
            signing_key=SIGNING_SEED,
            signing_key_id=SIGNING_KEY_ID,
            version="v2",
        )
        sent = _body(seen)
        wire = dict(
            strand_id=STRAND_ID,
            ciphertext_b64=sent["ciphertext"],
            nonce_b64=sent["nonce"],
            kind="observation",
        )
        assert _verifies_as(
            sent["signature"], canonical_thought_bytes(**wire, version="v2"),
        )
        # Domain separation survives the trip to the wire.
        assert not _verifies_as(sent["signature"], canonical_thought_bytes(**wire))

    def test_none_kind_signs_the_same_way_under_v2(self, recorder) -> None:
        at, seen = recorder
        at.strands.thoughts.add(
            STRAND_ID,
            "unkinded",
            k_master=K_MASTER,
            signing_key=SIGNING_SEED,
            signing_key_id=SIGNING_KEY_ID,
            version="v2",
        )
        sent = _body(seen)
        assert "kind" not in sent
        assert _verifies_as(
            sent["signature"],
            canonical_thought_bytes(
                strand_id=STRAND_ID,
                ciphertext_b64=sent["ciphertext"],
                nonce_b64=sent["nonce"],
                kind=None,
                version="v2",
            ),
        )

    def test_unknown_version_refused_before_anything_is_sent(self, recorder) -> None:
        at, seen = recorder
        with pytest.raises(AgentToolError) as exc:
            at.strands.thoughts.add(
                STRAND_ID,
                "x",
                k_master=K_MASTER,
                signing_key=SIGNING_SEED,
                signing_key_id=SIGNING_KEY_ID,
                version="v3",  # type: ignore[arg-type]
            )
        assert "unknown version" in exc.value.message
        assert seen == []


# ── The hazard v2 exists for, on a real add() ────────────────────────────
#
# A 12-byte random nonce carries a 0x00 byte ~4.6% of the time. The nonce is
# stubbed here so the case is deterministic rather than one write in
# twenty-two; the bytes are otherwise exactly what add() produces.

#: Leading 0x00 — the byte v1 also uses as its field delimiter.
FIXED_NONCE = bytes(range(12))


def _shifted_split(sent: Dict[str, Any]) -> Dict[str, Any]:
    """The second reading of the same v1 byte string.

    ``ct || 00 || [00 01 ... 0b]`` is also ``(ct || 00) || 00 || [01 ... 0b]``
    — same bytes, different (ciphertext, nonce) split.
    """
    ct = base64.b64decode(sent["ciphertext"])
    nonce = base64.b64decode(sent["nonce"])
    assert nonce[0] == 0  # the stub held; the hazard is present
    return dict(
        strand_id=STRAND_ID,
        ciphertext_b64=base64.b64encode(ct + b"\x00").decode("ascii"),
        nonce_b64=base64.b64encode(nonce[1:]).decode("ascii"),
        kind="observation",
    )


class TestNulInNonceAmbiguity:
    def test_v1_signature_also_authorises_a_different_split(self, recorder) -> None:
        at, seen = recorder
        with patch("agenttool.crypto.os.urandom", return_value=FIXED_NONCE):
            at.strands.thoughts.add(
                STRAND_ID,
                "ambiguous under v1",
                kind="observation",
                k_master=K_MASTER,
                signing_key=SIGNING_SEED,
                signing_key_id=SIGNING_KEY_ID,
            )
        sent = _body(seen)
        # Documents the v1 defect rather than blessing it: the signature the
        # SDK just posted verifies against a (ciphertext, nonce) pair the
        # author never wrote.
        assert _verifies_as(
            sent["signature"], canonical_thought_bytes(**_shifted_split(sent)),
        )

    def test_v2_signature_authorises_exactly_one_split(self, recorder) -> None:
        at, seen = recorder
        with patch("agenttool.crypto.os.urandom", return_value=FIXED_NONCE):
            at.strands.thoughts.add(
                STRAND_ID,
                "unambiguous under v2",
                kind="observation",
                k_master=K_MASTER,
                signing_key=SIGNING_SEED,
                signing_key_id=SIGNING_KEY_ID,
                version="v2",
            )
        sent = _body(seen)
        assert not _verifies_as(
            sent["signature"],
            canonical_thought_bytes(**_shifted_split(sent), version="v2"),
        )
        # …and still verifies against what was actually written.
        assert _verifies_as(
            sent["signature"],
            canonical_thought_bytes(
                strand_id=STRAND_ID,
                ciphertext_b64=sent["ciphertext"],
                nonce_b64=sent["nonce"],
                kind="observation",
                version="v2",
            ),
        )


# ── Path containment ─────────────────────────────────────────────────────


def _drain_voice(at: AgentTool, strand_id: str) -> None:
    """``voice`` is a generator — nothing runs until it is pulled."""
    for _ in at.strands.thoughts.voice(strand_id, k_master=K_MASTER):
        pass  # The stub body carries no SSE frames; the loop ends immediately.


class Case(NamedTuple):
    """One client method that interpolates a caller-supplied path segment."""

    method: str
    prefix: str
    invoke: Callable[[AgentTool, str], Any]


CASES: List[Case] = [
    Case("strands.get", "/v1/strands/", lambda at, i: at.strands.get(i)),
    Case(
        "strands.patch",
        "/v1/strands/",
        lambda at, i: at.strands.patch(i, status="dormant"),
    ),
    Case(
        "strands.thoughts.add",
        "/v1/strands/",
        lambda at, i: at.strands.thoughts.add(
            i,
            "x",
            k_master=K_MASTER,
            signing_key=SIGNING_SEED,
            signing_key_id=SIGNING_KEY_ID,
        ),
    ),
    Case(
        "strands.thoughts.list",
        "/v1/strands/",
        lambda at, i: at.strands.thoughts.list(i, k_master=K_MASTER),
    ),
    Case("strands.thoughts.voice", "/v1/strands/", _drain_voice),
]

#: Ids a relayed or stored value can plausibly carry, all encodable.
HOSTILE_IDS = [
    "../memories/pwned",
    "a/b",
    "?x=1",
    "#frag",
    "%2e%2e",
    "café-日本語-ıd",
]

#: Bare dot segments cannot be encoded — the URL parser strips ``%2E%2E`` too.
UNENCODABLE_IDS = ["..", "."]

BENIGN_ID = "550e8400-e29b-41d4-a716-446655440000"


CASE_IDS = [case.method for case in CASES]


def _wire_path(url: httpx.URL) -> str:
    """The path exactly as it goes on the wire — ``URL.path`` is decoded."""
    return url.raw_path.split(b"?", 1)[0].decode()


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
@pytest.mark.parametrize("hostile_id", HOSTILE_IDS)
def test_hostile_id_stays_under_its_prefix(
    recorder, case: Case, hostile_id: str,
) -> None:
    at, seen = recorder
    case.invoke(at, BENIGN_ID)
    case.invoke(at, hostile_id)

    benign, hostile = (_wire_path(request.url) for request in seen)
    assert hostile.startswith(case.prefix), (
        f"{case.method}({hostile_id!r}) escaped to {hostile}"
    )
    # The hostile id must occupy exactly one segment, like the benign one.
    assert len(hostile.split("/")) == len(benign.split("/"))
    assert "x" not in dict(seen[1].url.params)
    assert seen[1].url.fragment == ""


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
@pytest.mark.parametrize("dot_id", UNENCODABLE_IDS)
def test_bare_dot_segment_is_refused_before_any_request(
    recorder, case: Case, dot_id: str,
) -> None:
    at, seen = recorder
    with pytest.raises(AgentToolError) as exc_info:
        case.invoke(at, dot_id)
    assert f'"{dot_id}" is a URL dot segment' in exc_info.value.message
    assert seen == []


def test_well_formed_id_is_not_double_encoded(recorder) -> None:
    at, seen = recorder
    at.strands.get(BENIGN_ID)
    assert _wire_path(seen[0].url) == f"/v1/strands/{BENIGN_ID}"


def test_suffixed_route_keeps_its_action_segment(recorder) -> None:
    at, seen = recorder
    _drain_voice(at, "../wallets")
    assert _wire_path(seen[0].url) == "/v1/strands/..%2Fwallets/voice"
