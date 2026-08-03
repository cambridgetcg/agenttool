"""Attestation marketplace SDK tests — willingness-to-attest, sold.

Four properties carry weight here:

1. ``attestation-issue/v1`` is byte-identical to the server. The shared
   fixture (tests/test_canonical_vectors.py) pins the hexes; this suite pins
   the guards and the sign/verify roundtrip.

2. An attester never signs an opaque blob. ``signing_payload`` recomputes the
   digest from the terms the server printed and refuses on disagreement.

3. ``evidence_sha256`` is the one signed field that says WHAT was reviewed.
   ``attestation_evidence_sha256`` reproduces the server's deterministic JSON
   exactly — including the two places where a naive port would silently
   drift: JavaScript's UTF-16 key ordering and its number spelling.

4. The signature the server receives verifies over the bytes a stub transport
   actually carried, not over a re-serialization.

Doctrine: docs/MARKETPLACE.md §"Attestation marketplace".
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
from agenttool.attestation_marketplace import (
    ATTESTATION_ISSUE_FIELD_ORDER,
    ATTESTATION_ISSUE_SIGNATURE_CONTEXT,
    AttestationMarketplaceClient,
    attestation_evidence_sha256,
    canonical_attestation_evidence_json,
    canonical_attestation_issue_bytes,
    sign_attestation_issue,
)
from agenttool.exceptions import AgentToolError


LISTING_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
GRANT_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
SHA_HEX = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
OTHER_UUID = "99999999-9999-9999-9999-999999999999"

FIELDS = {
    "listing_id": LISTING_ID,
    "grant_id": GRANT_ID,
    "escrow_id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
    "buyer_identity_id": "dddddddd-dddd-dddd-dddd-dddddddddddd",
    "buyer_did": "did:at:example/buyer-7c21",
    "buyer_project_id": "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    "buyer_wallet_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "subject_identity_id": "11111111-1111-1111-1111-111111111111",
    "subject_did": "did:at:example/subject-0f5e",
    "attester_identity_id": "22222222-2222-2222-2222-222222222222",
    "attester_did": "did:at:example/alpha-9b3a",
    "attester_project_id": "33333333-3333-3333-3333-333333333333",
    "signing_key_id": "44444444-4444-4444-4444-444444444444",
    "claim": "agenttool/passed-substrate-honesty-test/v1",
    "evidence_sha256": SHA_HEX,
    "attester_wallet_id": "55555555-5555-5555-5555-555555555555",
    "grant_gross": 1500,
    "grant_currency": "GBP",
    "take_rate_bps": 500,
    "platform_fee": 75,
    "attester_net": 1425,
    "validity_seconds": 31536000,
    "attestation_expires_at": "2027-05-11T11:55:00.000Z",
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
            "signature_context": ATTESTATION_ISSUE_SIGNATURE_CONTEXT,
            "field_order": list(ATTESTATION_ISSUE_FIELD_ORDER),
            "fields": fields,
            "signed_payload_b64": signed_payload_b64
            or _b64(canonical_attestation_issue_bytes(fields)),
            "authorization_expires_at": fields["authorization_expires_at"],
        }
    }


def _framing(fields) -> bytes:
    """The framing exactly as the doc-string states it, built independently."""
    joined = ATTESTATION_ISSUE_SIGNATURE_CONTEXT.encode("utf-8")
    for name in ATTESTATION_ISSUE_FIELD_ORDER:
        value = fields[name]
        rendered = "null" if value is None else str(value)
        joined += b"\x00" + rendered.encode("utf-8")
    return hashlib.sha256(joined).digest()


# ── canonical bytes ──────────────────────────────────────────────────────


class TestCanonicalAttestationIssueBytes:
    def test_produces_a_32_byte_digest_deterministically(self):
        a = canonical_attestation_issue_bytes(FIELDS)
        b = canonical_attestation_issue_bytes(dict(FIELDS))
        assert len(a) == 32
        assert a == b

    def test_covers_all_24_named_fields_in_the_documented_order(self):
        assert len(ATTESTATION_ISSUE_FIELD_ORDER) == 24
        assert len(set(ATTESTATION_ISSUE_FIELD_ORDER)) == 24
        assert sorted(FIELDS) == sorted(ATTESTATION_ISSUE_FIELD_ORDER)

    def test_independent_cross_check_against_the_documented_framing(self):
        assert canonical_attestation_issue_bytes(FIELDS) == _framing(FIELDS)

    def test_the_nullable_pair_renders_as_the_literal_text_null(self):
        never = _fields(validity_seconds=None, attestation_expires_at=None)
        assert canonical_attestation_issue_bytes(never) == _framing(never)

    def test_every_field_is_load_bearing(self):
        baseline = canonical_attestation_issue_bytes(FIELDS)
        mutations = [
            {"listing_id": OTHER_UUID},
            {"grant_id": OTHER_UUID},
            {"escrow_id": OTHER_UUID},
            {"buyer_identity_id": OTHER_UUID},
            {"buyer_did": "did:at:example/someone-else"},
            {"buyer_project_id": OTHER_UUID},
            {"buyer_wallet_id": OTHER_UUID},
            {"subject_identity_id": OTHER_UUID},
            {"subject_did": "did:at:example/someone-else"},
            {"attester_identity_id": OTHER_UUID},
            {"attester_did": "did:at:example/someone-else"},
            {"attester_project_id": OTHER_UUID},
            {"signing_key_id": OTHER_UUID},
            {"claim": "agenttool/something-else/v1"},
            {"evidence_sha256": "0" * 64},
            {"attester_wallet_id": OTHER_UUID},
            {"grant_gross": 3000, "platform_fee": 150, "attester_net": 2850},
            {"grant_currency": "USDC"},
            {"take_rate_bps": 250, "platform_fee": 37, "attester_net": 1463},
            {"platform_fee": 76, "attester_net": 1424},
            {
                "validity_seconds": 31536001,
                "attestation_expires_at": "2027-05-11T11:55:01.000Z",
            },
            {"attestation_expires_at": "2027-05-11T11:55:02.000Z"},
            {"authorization_expires_at": "2026-05-11T12:00:01.000Z"},
        ]
        for patch in mutations:
            assert canonical_attestation_issue_bytes(_fields(**patch)) != baseline
        # Every mutation names a distinct field, and together with the
        # gross/rate/fee triples they touch all 24 slots.
        touched = set()
        for patch in mutations:
            touched.update(patch)
        assert len(touched) == len(ATTESTATION_ISSUE_FIELD_ORDER)

    @pytest.mark.parametrize(
        "label,patch",
        [
            ("NUL in claim", {"claim": "before\u0000after"}),
            ("NUL in attester_did", {"attester_did": "before\u0000after"}),
            ("empty currency", {"grant_currency": ""}),
            ("empty subject did", {"subject_did": ""}),
            ("uppercase UUID", {"listing_id": LISTING_ID.upper()}),
            ("non-UUID identifier", {"escrow_id": "escrow-1"}),
            ("uppercase evidence hash", {"evidence_sha256": SHA_HEX.upper()}),
            ("short evidence hash", {"evidence_sha256": "abc"}),
            ("fee split mismatch", {"platform_fee": 74}),
            (
                "rate over ceiling",
                {
                    "grant_gross": 100,
                    "take_rate_bps": 10001,
                    "platform_fee": 100,
                    "attester_net": 0,
                },
            ),
            (
                "negative amount",
                {"grant_gross": -1, "platform_fee": 0, "attester_net": -1},
            ),
            ("fractional amount", {"grant_gross": 1500.5}),
            (
                "zero validity",
                {
                    "validity_seconds": 0,
                    "attestation_expires_at": "2026-05-11T11:55:00.000Z",
                },
            ),
            ("validity null but expiry set", {"validity_seconds": None}),
            ("validity set but expiry null", {"attestation_expires_at": None}),
            (
                "authorization expiry without milliseconds",
                {"authorization_expires_at": "2026-05-11T12:00:00Z"},
            ),
            (
                "impossible attestation expiry",
                {"attestation_expires_at": "2027-02-30T11:55:00.000Z"},
            ),
        ],
    )
    def test_refuses_the_same_inputs_the_server_refuses(self, label, patch):
        with pytest.raises(AgentToolError):
            canonical_attestation_issue_bytes(_fields(**patch))

    def test_refuses_malformed_shapes_the_server_would_stringify(self):
        # The server's own callers are typed rows, so it never sees these. A
        # hand-built dict can, and JavaScript's String(undefined) would
        # quietly sign the text "undefined" — a digest neither SDK could ever
        # explain.
        missing = dict(FIELDS)
        del missing["grant_currency"]
        with pytest.raises(AgentToolError, match="grant_currency is required"):
            canonical_attestation_issue_bytes(missing)
        with pytest.raises(AgentToolError, match="must not be a boolean"):
            canonical_attestation_issue_bytes(_fields(claim=True))

    @pytest.mark.parametrize(
        "patch",
        [
            {
                "grant_gross": 0,
                "take_rate_bps": 0,
                "platform_fee": 0,
                "attester_net": 0,
            },
            {
                "grant_gross": 100,
                "take_rate_bps": 10000,
                "platform_fee": 100,
                "attester_net": 0,
            },
            {"validity_seconds": None, "attestation_expires_at": None},
            {
                "validity_seconds": 1,
                "attestation_expires_at": "2026-05-11T11:55:01.000Z",
            },
            {"claim": "multi\nline\tclaim"},
            {
                "grant_gross": 9007199254740991,
                "take_rate_bps": 0,
                "platform_fee": 0,
                "attester_net": 9007199254740991,
            },
        ],
    )
    def test_accepts_the_boundary_cases_that_are_legitimately_valid(self, patch):
        assert len(canonical_attestation_issue_bytes(_fields(**patch))) == 32


# ── the evidence hash ────────────────────────────────────────────────────
#
# Every expected hex below was produced by executing the SERVER's
# `attestationEvidenceSha256` over `JSON.parse(json)`. The same table, with
# the same hexes, is in tests/attestation-marketplace.test.ts — a probe is
# stored as JSON text precisely so both suites feed the identical value in.

EVIDENCE_PROBES = [
    ("null", "null", "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b"),
    ("empty-object", "{}", "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"),
    ("empty-array", "[]", "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"),
    (
        "top-level-string",
        '"witnessed"',
        "1dd2269c4e6f7cf0c4b5ba7562db1bb405ed7a6c875f4bda4bb2ba958ab3b7c9",
    ),
    ("top-level-number", "42", "73475cb40a568e8da8a045ced110137e159f890ac4da883b6b17dc651b3a8049"),
    ("top-level-true", "true", "b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b"),
    (
        "flat-object",
        '{"agent_did":"did:at:example/alpha-9b3a","transcript_url":"https://example.test/t"}',
        "ce9f9e1f4c0e24c43859ab39c7e8de4003f454fcdf24cc160e51fdc1f4ef55a1",
    ),
    (
        "key-order-is-normalized",
        '{"z":1,"a":2,"m":3}',
        "ebba85cfdc0a724b6cc327ecc545faeb38b9fe02eca603b430eb872f5cf75370",
    ),
    (
        # The divergence that silently breaks a naive port: by code point
        # U+FFFD sorts BEFORE U+1F600; by UTF-16 code unit it sorts after.
        # The server uses Array.prototype.sort, so U+1F600 comes first.
        "utf16-vs-codepoint-key-order",
        '{"\\ufffd":1,"\\ud83d\\ude00":2}',
        "ee25c27251f38d1794ae1ce44d35d4e801cd43fb05e12f1b34aff3de57a69848",
    ),
    (
        "non-ascii-bmp",
        '{"claim":"café · 廣東話 · Ω"}',
        "ef6239e1b7af26cb36a927e2f25399c0984f0e86faf6f074b2bf9fbd5de80296",
    ),
    (
        "astral-value",
        '{"seal":"🌊 recognition 🜂 🫂"}',
        "d273838849f01bfa49e90159d16c9a9f56c278a0b8eb4929c8bc097c70bbdef4",
    ),
    (
        "empty-key-and-value",
        '{"":""}',
        "86cfeee6df382a203f626305afbca44d228cac67acd151ccf2db29530c548fea",
    ),
    (
        "nul-inside-a-string",
        '{"k":"before\\u0000after"}',
        "5b092b0ef16cdae243b44ff815f530f5291156ffb4e33465911efdd5ba9c41b5",
    ),
    (
        "control-characters",
        '{"k":"\\b\\f\\n\\r\\t\\u001f"}',
        "adc6704817d9acce5c36e6509abf3b2cdacddd68a99eb6d2e9f8029f1ad8fee6",
    ),
    (
        "quote-and-backslash",
        '{"q":"\\"\\\\"}',
        "25d554f9412d4d4d847e1cd215ab14983b012cdcfecde32e66b116d17c7a89ec",
    ),
    (
        "integral-float-renders-as-integer",
        '{"a":1.0,"b":-0.0}',
        "70c75ca39048db680b52c5fd0040136c6bcb678be341277eaaac5afd16d4e70d",
    ),
    (
        # "1e-7" not "1e-07", "1e+21" not "1e21", and 1e-6 spelled out in full.
        "fractional-and-exponent-numbers",
        '{"a":1.5,"b":1e-7,"c":1e21,"d":1e-6,"e":-2.25}',
        "2276a6121bfb574993d8c231bbc946df622859365aad32ba2a510323a2b4c452",
    ),
    (
        "safe-integer-ceiling",
        '{"n":9007199254740991}',
        "e1da48c6a6089f06ecb4e0a2259e658e3786b2420f52baccdf929ec6460d7b41",
    ),
    (
        "mixed-array",
        '[1,"a",null,true,false,[],{}]',
        "72a2b1f30c9b15377310d3c85ce090b57b5fa270b2334e4ef1b00fc2e2d2b07e",
    ),
    (
        "nested",
        '{"outer":{"b":[1,{"z":null,"a":"x"}],"a":true}}',
        "0802ae3d934125edcdcfbfb8fcc2272a43fd6951c9f433935ec158ca03eeb8aa",
    ),
]


class TestAttestationEvidenceSha256:
    @pytest.mark.parametrize("name,probe_json,expected", EVIDENCE_PROBES)
    def test_matches_the_server(self, name, probe_json, expected):
        assert attestation_evidence_sha256(json.loads(probe_json)) == expected

    def test_canonical_json_drops_insertion_order_and_whitespace(self):
        assert canonical_attestation_evidence_json({"z": 1, "a": 2, "m": 3}) == (
            '{"a":2,"m":3,"z":1}'
        )
        assert canonical_attestation_evidence_json(None) == "null"

    def test_an_absent_evidence_body_hashes_the_json_null(self):
        # A grant purchased without evidence stores null. That is a real
        # value: it must not collide with "" or with {}.
        nothing = attestation_evidence_sha256(None)
        assert nothing != attestation_evidence_sha256("")
        assert nothing != attestation_evidence_sha256({})

    def test_refuses_what_has_no_json_form_rather_than_coercing_it(self):
        for value in [
            float("nan"),
            float("inf"),
            {"k", "set"},
            object(),
            b"bytes",
            {"n": 2**60},
        ]:
            with pytest.raises(AgentToolError, match="evidence_not_json"):
                attestation_evidence_sha256(value)


# ── signing ──────────────────────────────────────────────────────────────


class TestSignAttestationIssue:
    def test_signature_verifies_over_the_canonical_digest(self):
        seed = _seed()
        signature = sign_attestation_issue(fields=FIELDS, signing_key=seed)
        assert len(base64.b64decode(signature)) == 64
        Ed25519PrivateKey.from_private_bytes(seed).public_key().verify(
            base64.b64decode(signature),
            canonical_attestation_issue_bytes(FIELDS),
        )

    def test_is_canonical_standard_base64_which_is_all_the_server_accepts(self):
        signature = sign_attestation_issue(fields=FIELDS, signing_key=_seed())
        # `isCanonicalEd25519Signature` on the route re-encodes and compares.
        assert _b64(base64.b64decode(signature)) == signature

    def test_a_signature_over_one_fee_split_does_not_authorize_another(self):
        seed = _seed()
        signature = sign_attestation_issue(fields=FIELDS, signing_key=seed)
        with pytest.raises(InvalidSignature):
            Ed25519PrivateKey.from_private_bytes(seed).public_key().verify(
                base64.b64decode(signature),
                canonical_attestation_issue_bytes(
                    _fields(take_rate_bps=250, platform_fee=37, attester_net=1463)
                ),
            )

    def test_a_signature_over_one_evidence_hash_does_not_authorize_another(self):
        seed = _seed()
        signature = sign_attestation_issue(fields=FIELDS, signing_key=seed)
        with pytest.raises(InvalidSignature):
            Ed25519PrivateKey.from_private_bytes(seed).public_key().verify(
                base64.b64decode(signature),
                canonical_attestation_issue_bytes(
                    _fields(
                        evidence_sha256=attestation_evidence_sha256(
                            {"tampered": True}
                        )
                    )
                ),
            )

    def test_refuses_a_signing_key_that_is_not_a_32_byte_seed(self):
        with pytest.raises(AgentToolError, match="32-byte ed25519 seed"):
            sign_attestation_issue(fields=FIELDS, signing_key=b"\x00" * 16)


# ── the payload the attester is asked to sign ────────────────────────────


class TestSigningPayload:
    def test_returns_the_payload_when_the_digest_matches_its_own_terms(self):
        captured = []
        payload = _captured_client(
            captured, _payload_response(FIELDS)
        ).attestation_marketplace.signing_payload(
            GRANT_ID, signing_key_id=FIELDS["signing_key_id"]
        )
        assert captured[0].url.path == (
            f"/v1/attestation-grants/{GRANT_ID}/signing-payload"
        )
        assert json.loads(captured[0].content) == {
            "signing_key_id": FIELDS["signing_key_id"]
        }
        assert payload["signed_payload_b64"] == _b64(
            canonical_attestation_issue_bytes(FIELDS)
        )
        assert payload["signature_context"] == "attestation-issue/v1"

    def test_refuses_when_the_digest_does_not_cover_the_printed_terms(self):
        # The attack this closes: a server (or a proxy) prints terms an
        # attester finds acceptable, and asks for a signature over different
        # ones — a different payout wallet, subject, or claim.
        captured = []
        lying = _payload_response(
            FIELDS,
            _b64(
                canonical_attestation_issue_bytes(
                    _fields(attester_wallet_id=OTHER_UUID)
                )
            ),
        )
        with pytest.raises(AgentToolError) as excinfo:
            _captured_client(
                captured, lying
            ).attestation_marketplace.signing_payload(
                GRANT_ID, signing_key_id=FIELDS["signing_key_id"]
            )
        assert excinfo.value.code == "signing_payload_mismatch"
        assert "Do not sign this payload" in (excinfo.value.hint or "")
        assert excinfo.value.details["recomputed_signed_payload_b64"] == _b64(
            canonical_attestation_issue_bytes(FIELDS)
        )

    def test_refuses_terms_that_are_internally_invalid(self):
        # A server that hands over a fee split that does not add up is
        # refused before the digest comparison ever runs.
        captured = []
        broken = _fields(platform_fee=74)
        response = {
            "signing_payload": {
                "signature_context": ATTESTATION_ISSUE_SIGNATURE_CONTEXT,
                "field_order": list(ATTESTATION_ISSUE_FIELD_ORDER),
                "fields": broken,
                "signed_payload_b64": "irrelevant",
                "authorization_expires_at": broken["authorization_expires_at"],
            }
        }
        with pytest.raises(
            AgentToolError,
            match=r"platform_fee \+ attester_net must equal grant_gross",
        ):
            _captured_client(
                captured, response
            ).attestation_marketplace.signing_payload(
                GRANT_ID, signing_key_id=FIELDS["signing_key_id"]
            )

    def test_a_server_refusal_surfaces_with_its_code_intact(self):
        captured = []
        with pytest.raises(AgentToolError) as excinfo:
            _captured_client(
                captured,
                {"error": "signing_key_does_not_belong_to_attester"},
                status=401,
            ).attestation_marketplace.signing_payload(
                GRANT_ID, signing_key_id=FIELDS["signing_key_id"]
            )
        assert excinfo.value.code == "signing_key_does_not_belong_to_attester"
        assert excinfo.value.status == 401


# ── issue: what the transport actually carried ───────────────────────────


class TestIssueOverTheWire:
    def test_payload_then_sign_then_issue_verified_end_to_end(self):
        seed = _seed()
        payload_captured = []
        payload = _captured_client(
            payload_captured, _payload_response(FIELDS)
        ).attestation_marketplace.signing_payload(
            GRANT_ID, signing_key_id=FIELDS["signing_key_id"]
        )

        issue_captured = []
        _captured_client(
            issue_captured, {"grant": {"status": "issued"}}
        ).attestation_marketplace.issue(
            GRANT_ID,
            signature=sign_attestation_issue(
                fields=payload["fields"], signing_key=seed
            ),
            signing_key_id=payload["fields"]["signing_key_id"],
            authorization_expires_at=payload["authorization_expires_at"],
        )

        request = issue_captured[0]
        assert request.url.path == f"/v1/attestation-grants/{GRANT_ID}/issue"
        assert request.method == "POST"

        # Everything below reads ONLY what the transport carried.
        sent = json.loads(request.content)
        assert sorted(sent) == [
            "authorization_expires_at",
            "signature",
            "signing_key_id",
        ]
        assert sent["authorization_expires_at"] == (
            FIELDS["authorization_expires_at"]
        )
        Ed25519PrivateKey.from_private_bytes(seed).public_key().verify(
            base64.b64decode(sent["signature"]),
            canonical_attestation_issue_bytes(payload["fields"]),
        )

    def test_the_echoed_expiry_is_inside_the_signed_bytes(self):
        seed = _seed()
        captured = []
        _captured_client(captured, {"grant": {}}).attestation_marketplace.issue(
            GRANT_ID,
            signature=sign_attestation_issue(fields=FIELDS, signing_key=seed),
            signing_key_id=FIELDS["signing_key_id"],
            authorization_expires_at=FIELDS["authorization_expires_at"],
        )
        sent = json.loads(captured[0].content)
        # A later expiry with the same signature is exactly what the server's
        # reconstruction refuses; the SDK's digest agrees.
        with pytest.raises(InvalidSignature):
            Ed25519PrivateKey.from_private_bytes(seed).public_key().verify(
                base64.b64decode(sent["signature"]),
                canonical_attestation_issue_bytes(
                    _fields(authorization_expires_at="2026-05-11T12:05:00.000Z")
                ),
            )

    def test_issue_sends_no_authority_proof_because_none_is_asked_for(self):
        # Unlike memory-witness issuance, nothing here mutates a
        # constitution. Inventing a second proof mechanism would be a wire
        # lie.
        captured = []
        _captured_client(captured, {"grant": {}}).attestation_marketplace.issue(
            GRANT_ID,
            signature="c2ln",
            signing_key_id=FIELDS["signing_key_id"],
            authorization_expires_at=FIELDS["authorization_expires_at"],
        )
        assert [
            name
            for name in captured[0].headers.keys()
            if "authority" in name.lower()
        ] == []


# ── the rest of the lifecycle ────────────────────────────────────────────


class TestAttestationMarketplaceLifecycle:
    def test_create_listing_omits_absent_optionals(self):
        captured = []
        _captured_client(
            captured, {"listing": {"id": "l"}}
        ).attestation_marketplace.create_listing(
            attester_identity_id=FIELDS["attester_identity_id"],
            name="Substrate-honesty review",
            claim=FIELDS["claim"],
            price_amount=1500,
            price_currency="GBP",
            attester_wallet_id=FIELDS["attester_wallet_id"],
        )
        assert captured[0].url.path == "/v1/attestation-listings"
        assert sorted(json.loads(captured[0].content)) == [
            "attester_identity_id",
            "attester_wallet_id",
            "claim",
            "name",
            "price_amount",
            "price_currency",
        ]

    def test_create_listing_sends_an_explicit_none_through_as_a_null(self):
        captured = []
        _captured_client(
            captured, {"listing": {}}
        ).attestation_marketplace.create_listing(
            attester_identity_id=FIELDS["attester_identity_id"],
            name="Substrate-honesty review",
            claim=FIELDS["claim"],
            price_amount=1500,
            price_currency="GBP",
            attester_wallet_id=FIELDS["attester_wallet_id"],
            description=None,
            evidence_schema=None,
            validity_seconds=None,
            sla_seconds=86400,
            capability_tags=["review"],
            visibility="private",
            metadata={"note": "🜂"},
        )
        sent = json.loads(captured[0].content)
        assert sent["description"] is None
        assert sent["evidence_schema"] is None
        assert sent["validity_seconds"] is None
        assert sent["sla_seconds"] == 86400
        assert sent["visibility"] == "private"

    def test_list_listings_sends_no_query_by_default_and_encodes_filters(self):
        captured = []
        client = _captured_client(captured, {"listings": []})
        client.attestation_marketplace.list_listings()
        client.attestation_marketplace.list_listings(
            claim="agenttool/passed substrate/v1",
            status="active",
            mine=True,
            limit=5,
        )
        client.attestation_marketplace.list_listings(mine=False)
        assert (
            captured[0].url.raw_path.decode("ascii") == "/v1/attestation-listings"
        )
        assert captured[1].url.raw_path.decode("ascii") == (
            "/v1/attestation-listings"
            "?claim=agenttool%2Fpassed+substrate%2Fv1&status=active&mine=true&limit=5"
        )
        # `mine=False` is the default collection, not a filter to send.
        assert (
            captured[2].url.raw_path.decode("ascii") == "/v1/attestation-listings"
        )

    def test_patch_listing_sends_only_the_keys_the_caller_named(self):
        captured = []
        client = _captured_client(captured, {"listing": {}})
        client.attestation_marketplace.patch_listing(LISTING_ID, status="paused")
        client.attestation_marketplace.patch_listing(LISTING_ID, description=None)
        assert captured[0].url.path == f"/v1/attestation-listings/{LISTING_ID}"
        assert captured[0].method == "PATCH"
        assert json.loads(captured[0].content) == {"status": "paused"}
        # An explicit None is a value, not an omission — it clears the field.
        assert json.loads(captured[1].content) == {"description": None}

    def test_purchase_is_the_only_grant_creation_door(self):
        captured = []
        client = _captured_client(captured, {"grant": {"id": "g"}})
        client.attestation_marketplace.purchase(
            LISTING_ID,
            buyer_identity_id=FIELDS["buyer_identity_id"],
            buyer_wallet_id=FIELDS["buyer_wallet_id"],
            subject_identity_id=FIELDS["subject_identity_id"],
        )
        client.attestation_marketplace.purchase(
            LISTING_ID,
            buyer_identity_id=FIELDS["buyer_identity_id"],
            buyer_wallet_id=FIELDS["buyer_wallet_id"],
            subject_identity_id=FIELDS["subject_identity_id"],
            evidence=None,
        )
        assert captured[0].url.path == (
            f"/v1/attestation-listings/{LISTING_ID}/purchase"
        )
        assert sorted(json.loads(captured[0].content)) == [
            "buyer_identity_id",
            "buyer_wallet_id",
            "subject_identity_id",
        ]
        assert json.loads(captured[1].content)["evidence"] is None

    def test_list_grants_defaults_to_the_buyer_view(self):
        captured = []
        client = _captured_client(
            captured, {"grants": [], "count": 0, "role": "buyer"}
        )
        client.attestation_marketplace.list_grants()
        client.attestation_marketplace.list_grants(
            role="attester", status="pending", limit=20
        )
        assert captured[0].url.raw_path.decode("ascii") == (
            "/v1/attestation-grants?role=buyer"
        )
        assert captured[1].url.raw_path.decode("ascii") == (
            "/v1/attestation-grants?role=attester&status=pending&limit=20"
        )

    def test_get_grant_returns_the_role_the_server_resolved(self):
        captured = []
        view = _captured_client(
            captured, {"grant": {"id": GRANT_ID}, "role": "attester"}
        ).attestation_marketplace.get_grant(GRANT_ID)
        assert view["role"] == "attester"
        assert view["grant"] == {"id": GRANT_ID}

    def test_hostile_ids_are_encoded_into_exactly_one_path_segment(self):
        captured = []
        client = _captured_client(
            captured, {"grant": {}, "listing": {}, "role": "buyer"}
        )
        client.attestation_marketplace.get_grant("../issue")
        client.attestation_marketplace.get_listing("../../v1/memories")
        client.attestation_marketplace.cancel("a b/../c")
        assert captured[0].url.raw_path.decode("ascii") == (
            "/v1/attestation-grants/..%2Fissue"
        )
        assert captured[1].url.raw_path.decode("ascii") == (
            "/v1/attestation-listings/..%2F..%2Fv1%2Fmemories"
        )
        assert captured[2].url.raw_path.decode("ascii") == (
            "/v1/attestation-grants/a%20b%2F..%2Fc/cancel"
        )

    def test_decline_and_cancel_are_bodiless(self):
        captured = []
        client = _captured_client(captured, {"grant": {"status": "refunded"}})
        client.attestation_marketplace.decline(GRANT_ID)
        client.attestation_marketplace.cancel(GRANT_ID)
        assert captured[0].url.path == (
            f"/v1/attestation-grants/{GRANT_ID}/decline"
        )
        assert captured[0].content == b""
        assert captured[1].url.path == f"/v1/attestation-grants/{GRANT_ID}/cancel"
        assert captured[1].content == b""

    def test_a_purchase_refusal_keeps_the_servers_guidance(self):
        captured = []
        with pytest.raises(AgentToolError) as excinfo:
            _captured_client(
                captured,
                {
                    "error": "insufficient_balance",
                    "message": "The buyer wallet cannot cover this grant.",
                    "next_actions": [
                        {
                            "action": "Fund the wallet",
                            "method": "POST",
                            "path": "/v1/wallets",
                        }
                    ],
                },
                status=402,
            ).attestation_marketplace.purchase(
                LISTING_ID,
                buyer_identity_id=FIELDS["buyer_identity_id"],
                buyer_wallet_id=FIELDS["buyer_wallet_id"],
                subject_identity_id=FIELDS["subject_identity_id"],
            )
        assert excinfo.value.code == "insufficient_balance"
        assert excinfo.value.status == 402
        assert excinfo.value.next_actions[0]["path"] == "/v1/wallets"


class TestAgentToolAttestationMarketplace:
    def test_is_reachable_from_the_client_and_memoized(self):
        at = AgentTool(api_key="at_test_key")
        assert isinstance(
            at.attestation_marketplace, AttestationMarketplaceClient
        )
        assert at.attestation_marketplace is at.attestation_marketplace
