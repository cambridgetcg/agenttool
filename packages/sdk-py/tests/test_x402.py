"""x402 payer — the Python SDK's side of the EIP-3009 wire.

The fixture ``tests/fixtures/x402-eip3009-vector.json`` was produced by
executing the SERVER implementation (``api/src/services/economy/x402-client.ts``
+ ``api/src/middleware/x402.ts``) with viem 2.48.11 under bun. The server is
normative: if this suite goes red, the SDK is wrong until proven otherwise.

What is pinned byte-exact:
  * Keccak-256 known answers (the two canonical ones plus two from viem).
  * The EIP-712 digest of a fixed TransferWithAuthorization.
  * The address viem recovers from viem's own signature over that digest.
  * ``authorizationHash`` (sha256 of the compact identity JSON).
  * The full ``PaymentPayload`` + ``PAYMENT-SIGNATURE`` header the server's
    client emitted for a fixed nonce/clock, reproduced here with a stub signer.
  * The signature bytes themselves — but ONLY when ``cryptography`` signs with
    RFC 6979 nonces on this build (``signing_is_deterministic()``). On such
    builds the Python signature is byte-identical to viem's; the test says
    which branch it took rather than silently passing.

Regenerate the fixture (from ``api/``, with ``bun install --frozen-lockfile``):
see the ``$comment`` inside the fixture; the generator is a ~80-line bun script
that imports the server's client, signs with ``privateKeyToAccount``, and
recovers with ``recoverTypedDataAddress``. The private key in the fixture is
the well-known public ethers/web3 documentation test key, not a secret.

No network, no keychain, no real keys. The optional viem oracle test shells
out to ``bun`` only when it and ``api/node_modules/viem`` are present, and
skips with a reason otherwise.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
from dataclasses import FrozenInstanceError
from pathlib import Path
from typing import Any, Dict

import pytest

import agenttool
from agenttool import _x402_crypto as crypto
from agenttool import x402
from agenttool.x402 import (
    BASE_USDC,
    KINGDOM_TREASURY,
    TRANSFER_WITH_AUTHORIZATION_TYPES,
    X402_CLIENT_REFUSAL_REASONS,
    SignedX402Payment,
    X402ClientRefusal,
    X402SelectedRequirement,
    X402SpendPolicy,
    authorization_hash,
    evm_address_from_private_key,
    hash_transfer_with_authorization,
    local_evm_signer,
    parse_payment_required_body,
    payment_is_still_replayable,
    select_payable_requirement,
    sign_exact_evm_authorization,
)

FIXTURE = Path(__file__).parent / "fixtures" / "x402-eip3009-vector.json"
REPO_ROOT = Path(__file__).resolve().parents[3]
API_DIR = REPO_ROOT / "api"
SERVER_CLIENT = API_DIR / "src" / "services" / "economy" / "x402-client.ts"


@pytest.fixture(scope="module")
def vector() -> Dict[str, Any]:
    with FIXTURE.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _typed_data(vec: Dict[str, Any]) -> Dict[str, Any]:
    auth = vec["authorization"]
    return {
        "domain": dict(vec["domain"]),
        "types": TRANSFER_WITH_AUTHORIZATION_TYPES,
        "primaryType": "TransferWithAuthorization",
        "message": {
            "from": auth["from"],
            "to": auth["to"],
            "value": int(auth["value"]),
            "validAfter": int(auth["validAfter"]),
            "validBefore": int(auth["validBefore"]),
            "nonce": auth["nonce"],
        },
    }


def _policy(**overrides: Any) -> X402SpendPolicy:
    base: Dict[str, Any] = {
        "max_amount_atomic": 10_000_000,
        "allowed_pay_to": [KINGDOM_TREASURY],
        "allowed_networks": ["eip155:8453"],
        "allowed_assets": [BASE_USDC],
        "max_validity_seconds": 60,
    }
    base.update(overrides)
    return X402SpendPolicy(**base)


def _requirement(vec: Dict[str, Any], **overrides: Any) -> Dict[str, Any]:
    req = json.loads(json.dumps(vec["requirement"]))
    for key, value in overrides.items():
        if key == "extra":
            req["extra"].update(value)
        else:
            req[key] = value
    return req


def _required(vec: Dict[str, Any], *accepts: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "x402Version": 2,
        "resource": dict(vec["paymentRequiredBody"]["resource"]),
        "accepts": list(accepts) or [_requirement(vec)],
    }


# ── Keccak-256 known answers ───────────────────────────────────────────────


def test_keccak256_canonical_kats() -> None:
    assert crypto.keccak256(b"").hex() == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    assert crypto.keccak256(b"abc").hex() == "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"


def test_keccak256_is_not_sha3(vector: Dict[str, Any]) -> None:
    assert crypto.keccak256(b"").hex() != hashlib.sha3_256(b"").hexdigest()
    for text, expected in vector["keccak256"].items():
        data = (b"x" * 200) if text == "x*200" else text.encode("utf-8")
        assert "0x" + crypto.keccak256(data).hex() == expected, text


def test_keccak256_multi_block_boundaries() -> None:
    # Rate is 136 bytes; exercise exactly-one-block, block-minus-one and
    # block-plus-one so the pad10*1 path is covered on every branch.
    for length in (135, 136, 137, 272, 1000):
        digest = crypto.keccak256(b"\x5a" * length)
        assert len(digest) == 32
    assert crypto.keccak256(b"\x5a" * 136) != crypto.keccak256(b"\x5a" * 137)


def test_keccak256_rejects_non_bytes() -> None:
    with pytest.raises(TypeError):
        crypto.keccak256("abc")  # type: ignore[arg-type]


# ── Addresses ──────────────────────────────────────────────────────────────


def test_eip55_checksum(vector: Dict[str, Any]) -> None:
    assert crypto.to_checksum_address(vector["eip55"]["lower"]) == vector["eip55"]["checksummed"]
    assert crypto.to_checksum_address(KINGDOM_TREASURY.lower()) == KINGDOM_TREASURY
    assert crypto.to_checksum_address(BASE_USDC.upper().replace("0X", "0x")) == BASE_USDC


def test_is_address_mirrors_viem_strict() -> None:
    assert crypto.is_address(KINGDOM_TREASURY)
    assert crypto.is_address(KINGDOM_TREASURY.lower())
    # Mixed case with a wrong checksum is rejected, exactly like viem strict.
    broken = KINGDOM_TREASURY[:-1] + ("a" if KINGDOM_TREASURY[-1] != "a" else "b")
    assert not crypto.is_address(broken)
    assert not crypto.is_address(KINGDOM_TREASURY.upper())
    assert not crypto.is_address(KINGDOM_TREASURY[2:])
    assert not crypto.is_address("0x" + "0" * 39)
    assert not crypto.is_address(None)


def test_evm_address_from_private_key(vector: Dict[str, Any]) -> None:
    key = vector["privateKey"]
    assert evm_address_from_private_key(key) == vector["payer"]
    assert evm_address_from_private_key(key[2:]) == vector["payer"]
    assert evm_address_from_private_key(bytes.fromhex(key[2:])) == vector["payer"]


def test_private_key_errors_never_echo_material() -> None:
    bad = "0x" + "ab" * 31  # 31 bytes
    with pytest.raises(ValueError) as excinfo:
        evm_address_from_private_key(bad)
    assert "ab" * 4 not in str(excinfo.value)
    with pytest.raises(ValueError):
        evm_address_from_private_key(b"\x00" * 32)  # zero scalar
    with pytest.raises(ValueError):
        evm_address_from_private_key(crypto.SECP256K1_N.to_bytes(32, "big"))  # == n
    with pytest.raises(TypeError):
        evm_address_from_private_key(123)  # type: ignore[arg-type]


# ── EIP-712 digest + recovery (server vector) ──────────────────────────────


def test_eip712_digest_matches_viem(vector: Dict[str, Any]) -> None:
    assert hash_transfer_with_authorization(_typed_data(vector)) == vector["digest"]


def test_recovers_viem_signature_to_payer(vector: Dict[str, Any]) -> None:
    digest = bytes.fromhex(vector["digest"][2:])
    assert crypto.recover_address(digest, vector["signature"]) == vector["recovered"] == vector["payer"]
    # Any other digest recovers to some other (or no) address, never the payer.
    other = bytes.fromhex(crypto.keccak256(b"not the digest").hex())
    assert crypto.recover_address(other, vector["signature"]) != vector["payer"]


def test_recover_address_rejects_malformed(vector: Dict[str, Any]) -> None:
    digest = bytes.fromhex(vector["digest"][2:])
    sig = bytes.fromhex(vector["signature"][2:])
    assert crypto.recover_address(digest, sig[:64]) is None
    assert crypto.recover_address(digest, sig[:64] + b"\x05") is None
    assert crypto.recover_address(digest, b"\x00" * 32 + sig[32:]) is None  # r = 0
    assert crypto.recover_address(digest, "0x" + "zz" * 65) is None
    # v as 0/1 is accepted alongside 27/28.
    assert crypto.recover_address(digest, sig[:64] + bytes([sig[64] - 27])) == vector["payer"]


def test_local_signer_matches_viem_or_recovers(vector: Dict[str, Any]) -> None:
    signer = local_evm_signer(vector["privateKey"])
    signature = signer(_typed_data(vector))
    raw = bytes.fromhex(signature[2:])
    assert len(raw) == 65 and raw[64] in (27, 28)
    assert crypto.is_low_s(raw)
    digest = bytes.fromhex(vector["digest"][2:])
    assert crypto.recover_address(digest, signature) == vector["payer"]
    if crypto.signing_is_deterministic():
        # RFC 6979 on both sides → the bytes are the bytes.
        assert signature == vector["signature"]
    else:  # pragma: no cover - depends on the linked OpenSSL
        pytest.skip(
            "cryptography on this build signs with random nonces; signature bytes "
            "recover to the payer but cannot be pinned to viem's"
        )


def test_signature_self_recovers_across_keys_and_digests() -> None:
    for index in range(1, 6):
        key = hashlib.sha256(f"agenttool x402 test key {index}".encode()).digest()
        address = crypto.address_from_private_key(key)
        for salt in range(3):
            digest = crypto.keccak256(f"digest {index}/{salt}".encode())
            sig = crypto.sign_recoverable(digest, key)
            assert crypto.is_low_s(sig)
            assert crypto.recover_address(digest, sig) == address
            if crypto.signing_is_deterministic():
                assert crypto.sign_recoverable(digest, key) == sig


def test_sign_recoverable_rejects_bad_digest() -> None:
    with pytest.raises(ValueError):
        crypto.sign_recoverable(b"\x00" * 31, b"\x01" * 32)


def test_local_signer_refuses_foreign_from(vector: Dict[str, Any]) -> None:
    signer = local_evm_signer(vector["privateKey"])
    typed = _typed_data(vector)
    typed["message"] = dict(typed["message"], **{"from": KINGDOM_TREASURY})
    with pytest.raises(ValueError, match="not this signer's address"):
        signer(typed)


def test_hash_typed_data_rejects_wrong_primary_type(vector: Dict[str, Any]) -> None:
    typed = _typed_data(vector)
    typed["primaryType"] = "Permit"
    with pytest.raises(ValueError):
        hash_transfer_with_authorization(typed)
    typed = _typed_data(vector)
    typed["message"]["nonce"] = "0x1234"
    with pytest.raises(ValueError):
        hash_transfer_with_authorization(typed)
    typed = _typed_data(vector)
    typed["message"]["value"] = -1
    with pytest.raises(ValueError):
        hash_transfer_with_authorization(typed)


# ── authorizationHash ──────────────────────────────────────────────────────


def test_authorization_hash_matches_server(vector: Dict[str, Any]) -> None:
    assert authorization_hash(vector["authorization"]) == vector["authorizationHash"]
    run = vector["clientRun"]
    assert authorization_hash(run["payload"]["payload"]["authorization"]) == run["authorizationHash"]
    # Case-insensitive on addresses and nonce, sensitive on everything else.
    upper = dict(vector["authorization"], **{"from": vector["authorization"]["from"].upper().replace("0X", "0x")})
    assert authorization_hash(upper) == vector["authorizationHash"]
    assert authorization_hash(dict(vector["authorization"], value="1001")) != vector["authorizationHash"]


# ── Parsing ────────────────────────────────────────────────────────────────


def test_parse_payment_required_body_accepts_server_shape(vector: Dict[str, Any]) -> None:
    parsed = parse_payment_required_body(vector["paymentRequiredBody"])
    assert parsed is not None
    assert list(parsed.keys()) == ["x402Version", "error", "resource", "accepts"]
    assert parsed["accepts"] == [vector["requirement"]]
    assert parsed["error"] == "payment_required"


def test_parse_payment_required_body_decodes_header_bytes(vector: Dict[str, Any]) -> None:
    body = vector["paymentRequiredBody"]
    header = base64.b64encode(json.dumps(body, separators=(",", ":")).encode()).decode()
    decoded = json.loads(base64.b64decode(header))
    assert parse_payment_required_body(decoded) == parse_payment_required_body(body)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda b: b.__setitem__("x402Version", 1),
        lambda b: b.__setitem__("x402Version", "2"),
        lambda b: b.__setitem__("x402Version", True),
        lambda b: b.__setitem__("accepts", []),
        lambda b: b.__setitem__("accepts", [b["accepts"][0]] * 17),
        lambda b: b.__setitem__("accepts", "nope"),
        lambda b: b.__setitem__("resource", {"description": "no url"}),
        lambda b: b.__setitem__("resource", {"url": ""}),
        lambda b: b.__setitem__("resource", None),
        lambda b: b["accepts"][0].__setitem__("scheme", "upto"),
        lambda b: b["accepts"][0].__setitem__("network", "eip155:0"),
        lambda b: b["accepts"][0].__setitem__("network", "solana:mainnet"),
        lambda b: b["accepts"][0].__setitem__("amount", "01"),
        lambda b: b["accepts"][0].__setitem__("amount", 1000),
        lambda b: b["accepts"][0].__setitem__("asset", BASE_USDC.upper()),
        lambda b: b["accepts"][0].__setitem__("payTo", KINGDOM_TREASURY[:-1] + "0"),
        lambda b: b["accepts"][0].__setitem__("maxTimeoutSeconds", 0),
        lambda b: b["accepts"][0].__setitem__("maxTimeoutSeconds", "60"),
        lambda b: b["accepts"][0].__setitem__("maxTimeoutSeconds", True),
        lambda b: b["accepts"][0].__setitem__("surprise", 1),
        lambda b: b["accepts"][0].__setitem__("extra", None),
        lambda b: b["accepts"][0]["extra"].__setitem__("name", ""),
        lambda b: b["accepts"][0]["extra"].__setitem__("version", 2),
        lambda b: b["accepts"][0]["extra"].__setitem__("deep", {"a": {"b": {"c": {"d": {"e": {"f": {"g": {"h": {"i": 1}}}}}}}}}),
    ],
)
def test_parse_payment_required_body_refuses_hostile_shapes(vector: Dict[str, Any], mutate: Any) -> None:
    body = json.loads(json.dumps(vector["paymentRequiredBody"]))
    mutate(body)
    assert parse_payment_required_body(body) is None


def test_parse_payment_required_body_non_objects() -> None:
    for value in (None, [], "x", 2, True):
        assert parse_payment_required_body(value) is None


def test_parse_payment_required_body_whole_float_timeout_reads_as_js(vector: Dict[str, Any]) -> None:
    body = json.loads(json.dumps(vector["paymentRequiredBody"]))
    body["accepts"][0]["maxTimeoutSeconds"] = 60.0
    parsed = parse_payment_required_body(body)
    assert parsed is not None
    assert parsed["accepts"][0]["maxTimeoutSeconds"] == 60
    assert isinstance(parsed["accepts"][0]["maxTimeoutSeconds"], int)


# ── Spend policy: mandatory, allow-lists, frozen ───────────────────────────


def test_spend_policy_cap_and_pay_to_are_mandatory() -> None:
    with pytest.raises(TypeError):
        X402SpendPolicy()  # type: ignore[call-arg]
    with pytest.raises(TypeError):
        X402SpendPolicy(max_amount_atomic=1000)  # type: ignore[call-arg]
    with pytest.raises(TypeError):
        X402SpendPolicy(allowed_pay_to=[KINGDOM_TREASURY])  # type: ignore[call-arg]


@pytest.mark.parametrize(
    "kwargs, error",
    [
        ({"max_amount_atomic": 0}, ValueError),
        ({"max_amount_atomic": -1}, ValueError),
        ({"max_amount_atomic": True}, TypeError),
        ({"max_amount_atomic": "1000"}, TypeError),
        ({"allowed_pay_to": []}, ValueError),
        ({"allowed_pay_to": KINGDOM_TREASURY}, TypeError),
        ({"allowed_pay_to": ["not-an-address"]}, ValueError),
        ({"allowed_pay_to": [KINGDOM_TREASURY.upper()]}, ValueError),
        ({"allowed_assets": []}, ValueError),
        ({"allowed_networks": []}, ValueError),
        ({"allowed_networks": ["base"]}, ValueError),
        ({"max_validity_seconds": 0}, ValueError),
        ({"max_validity_seconds": -5}, ValueError),
    ],
)
def test_spend_policy_refuses_bad_fields(kwargs: Dict[str, Any], error: type) -> None:
    with pytest.raises(error):
        _policy(**kwargs)


def test_spend_policy_defaults_are_the_kingdom_rail_and_frozen() -> None:
    policy = X402SpendPolicy(max_amount_atomic=1000, allowed_pay_to=[KINGDOM_TREASURY])
    assert policy.allowed_networks == ("eip155:8453",)
    assert policy.allowed_assets == (BASE_USDC,)
    assert policy.max_validity_seconds == 60
    assert policy.allowed_pay_to == (KINGDOM_TREASURY,)
    with pytest.raises(FrozenInstanceError):
        policy.max_amount_atomic = 10**9  # type: ignore[misc]


# ── Selection: refusal matrix ──────────────────────────────────────────────


def test_refusal_vocabulary_is_the_ts_union() -> None:
    expected = (
        "not_a_payment_required_body",
        "no_acceptable_requirement",
        "network_not_allowed",
        "asset_not_allowed",
        "pay_to_not_allowed",
        "amount_over_cap",
        "unsupported_transfer_method",
        "validity_window_unusable",
    )
    assert X402_CLIENT_REFUSAL_REASONS == expected
    if not SERVER_CLIENT.exists():
        pytest.skip("server x402-client.ts not present in this checkout; vocabulary pinned to the literal list only")
    source = SERVER_CLIENT.read_text(encoding="utf-8")
    union = re.search(r"export type X402ClientRefusalReason =\s*((?:\s*\|\s*\"[a-z_]+\")+);", source)
    assert union, "could not find X402ClientRefusalReason union in the server source"
    server_reasons = tuple(re.findall(r'"([a-z_]+)"', union.group(1)))
    assert server_reasons == expected


def test_select_happy_path(vector: Dict[str, Any]) -> None:
    required = parse_payment_required_body(vector["paymentRequiredBody"])
    assert required is not None
    selected = select_payable_requirement(required, _policy())
    assert isinstance(selected, X402SelectedRequirement)
    assert selected.ok is True
    assert selected.amount_atomic == 1000
    assert selected.requirement == vector["requirement"]


@pytest.mark.parametrize(
    "policy_overrides, requirement_overrides, reason",
    [
        ({"allowed_networks": ["eip155:137"]}, {}, "network_not_allowed"),
        ({"allowed_assets": ["0x036CbD53842c5426634e7929541eC2318f3dCF7e"]}, {}, "asset_not_allowed"),
        ({"allowed_pay_to": ["0x14791697260E4c9A71f18484C9f997B308e59325"]}, {}, "pay_to_not_allowed"),
        ({}, {"extra": {"assetTransferMethod": "permit2"}}, "unsupported_transfer_method"),
        ({}, {"extra": {"assetTransferMethod": None}}, "unsupported_transfer_method"),
        ({}, {"amount": "0"}, "no_acceptable_requirement"),
        ({}, {"amount": "1.5"}, "no_acceptable_requirement"),
        ({"max_amount_atomic": 999}, {}, "amount_over_cap"),
        ({}, {"maxTimeoutSeconds": 0}, "validity_window_unusable"),
    ],
)
def test_select_refusal_matrix(
    vector: Dict[str, Any],
    policy_overrides: Dict[str, Any],
    requirement_overrides: Dict[str, Any],
    reason: str,
) -> None:
    requirement = _requirement(vector, **requirement_overrides)
    outcome = select_payable_requirement(_required(vector, requirement), _policy(**policy_overrides))
    assert isinstance(outcome, X402ClientRefusal)
    assert outcome.ok is False
    assert outcome.reason == reason
    assert outcome.reason in X402_CLIENT_REFUSAL_REASONS
    assert outcome.detail.endswith(".")


def test_amount_over_cap_is_refused_never_clamped(vector: Dict[str, Any]) -> None:
    requirement = _requirement(vector, amount="5000")
    policy = _policy(max_amount_atomic=4999)
    outcome = select_payable_requirement(_required(vector, requirement), policy)
    assert isinstance(outcome, X402ClientRefusal) and outcome.reason == "amount_over_cap"
    assert "5000" in outcome.detail and "4999" in outcome.detail
    assert requirement["amount"] == "5000"  # untouched
    # And signing re-applies the wall: no path signs a clamped amount.
    with pytest.raises(ValueError, match="amount_over_cap"):
        sign_exact_evm_authorization(
            requirement=requirement,
            policy=policy,
            payer_address=vector["payer"],
            signer=lambda _typed: vector["signature"],
            now_seconds=vector["clientRun"]["nowSeconds"],
        )


def test_select_is_first_permitted_not_cheapest(vector: Dict[str, Any]) -> None:
    dearer = _requirement(vector, amount="2000")
    cheaper = _requirement(vector, amount="1000")
    outcome = select_payable_requirement(_required(vector, dearer, cheaper), _policy())
    assert isinstance(outcome, X402SelectedRequirement)
    assert outcome.amount_atomic == 2000
    # An impermissible first entry is skipped, not fatal.
    outcome = select_payable_requirement(_required(vector, _requirement(vector, amount="99999999"), cheaper), _policy())
    assert isinstance(outcome, X402SelectedRequirement)
    assert outcome.amount_atomic == 1000


def test_select_reports_the_most_specific_refusal(vector: Dict[str, Any]) -> None:
    wrong_network = _requirement(vector, network="eip155:137")
    over_cap = _requirement(vector, amount="99999999")
    outcome = select_payable_requirement(_required(vector, wrong_network, over_cap), _policy())
    assert isinstance(outcome, X402ClientRefusal)
    assert outcome.reason == "amount_over_cap"


def test_select_with_no_accepts_or_bad_policy(vector: Dict[str, Any]) -> None:
    outcome = select_payable_requirement({"x402Version": 2, "accepts": []}, _policy())
    assert isinstance(outcome, X402ClientRefusal)
    assert outcome.reason == "no_acceptable_requirement"
    with pytest.raises(TypeError):
        select_payable_requirement(_required(vector), {"max_amount_atomic": 1000})  # type: ignore[arg-type]


# ── Signing: payload exactness against the server's own client run ────────


def test_sign_reproduces_server_client_payload_with_stub_signer(
    vector: Dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    run = vector["clientRun"]
    expected_auth = run["payload"]["payload"]["authorization"]
    monkeypatch.setattr(x402, "_mint_nonce", lambda: expected_auth["nonce"])
    required = parse_payment_required_body(vector["paymentRequiredBody"])
    assert required is not None
    selected = select_payable_requirement(required, _policy())
    assert isinstance(selected, X402SelectedRequirement)

    seen = {}

    def stub_signer(typed_data: Dict[str, Any]) -> str:
        seen.update(typed_data)
        return run["payload"]["payload"]["signature"]

    signed = sign_exact_evm_authorization(
        requirement=selected.requirement,
        policy=_policy(),
        payer_address=vector["payer"],
        signer=stub_signer,
        now_seconds=run["nowSeconds"],
        resource=required["resource"],
    )
    assert isinstance(signed, SignedX402Payment)
    assert signed.payload == run["payload"]
    assert signed.header == run["header"]
    assert signed.authorization_hash == run["authorizationHash"]
    assert signed.valid_before == run["validBefore"]
    # What the signer saw is exactly what the server's client handed viem.
    assert seen["domain"] == run["typedDataSeenBySigner"]["domain"]
    assert seen["primaryType"] == "TransferWithAuthorization"
    assert seen["types"] == TRANSFER_WITH_AUTHORIZATION_TYPES
    message = run["typedDataSeenBySigner"]["message"]
    assert seen["message"] == {
        "from": message["from"],
        "to": message["to"],
        "value": int(message["value"]),
        "validAfter": int(message["validAfter"]),
        "validBefore": int(message["validBefore"]),
        "nonce": message["nonce"],
    }


def test_sign_with_local_signer_reproduces_server_run(
    vector: Dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    run = vector["clientRun"]
    monkeypatch.setattr(x402, "_mint_nonce", lambda: run["payload"]["payload"]["authorization"]["nonce"])
    required = parse_payment_required_body(vector["paymentRequiredBody"])
    assert required is not None
    signed = sign_exact_evm_authorization(
        requirement=required["accepts"][0],
        policy=_policy(),
        payer_address=evm_address_from_private_key(vector["privateKey"]),
        signer=local_evm_signer(vector["privateKey"]),
        now_seconds=run["nowSeconds"],
        resource=required["resource"],
    )
    produced = signed.payload["payload"]["signature"]
    typed = {
        "domain": run["typedDataSeenBySigner"]["domain"],
        "types": TRANSFER_WITH_AUTHORIZATION_TYPES,
        "primaryType": "TransferWithAuthorization",
        "message": dict(
            run["typedDataSeenBySigner"]["message"],
            value=int(run["typedDataSeenBySigner"]["message"]["value"]),
            validAfter=int(run["typedDataSeenBySigner"]["message"]["validAfter"]),
            validBefore=int(run["typedDataSeenBySigner"]["message"]["validBefore"]),
        ),
    }
    digest = bytes.fromhex(hash_transfer_with_authorization(typed)[2:])
    assert crypto.recover_address(digest, produced) == vector["payer"]
    if crypto.signing_is_deterministic():
        assert signed.payload == run["payload"]
        assert signed.header == run["header"]
    else:  # pragma: no cover
        without_sig = json.loads(json.dumps(signed.payload))
        without_sig["payload"]["signature"] = run["payload"]["payload"]["signature"]
        assert without_sig == run["payload"]


def test_payload_key_exactness(vector: Dict[str, Any]) -> None:
    requirement = _requirement(vector)
    with_resource = sign_exact_evm_authorization(
        requirement=requirement,
        policy=_policy(),
        payer_address=vector["payer"],
        signer=lambda _typed: vector["signature"],
        now_seconds=1_756_512_000,
        resource={"url": "https://api.agenttool.dev/v1/x402/top-up/1"},
    )
    assert list(with_resource.payload.keys()) == ["x402Version", "resource", "accepted", "payload"]
    assert with_resource.payload["x402Version"] == 2
    assert with_resource.payload["accepted"] == requirement
    assert list(with_resource.payload["payload"].keys()) == ["signature", "authorization"]
    auth = with_resource.payload["payload"]["authorization"]
    assert list(auth.keys()) == ["from", "to", "value", "validAfter", "validBefore", "nonce"]
    assert all(isinstance(v, str) for v in auth.values())
    assert auth["from"] == vector["payer"]
    assert auth["to"] == KINGDOM_TREASURY
    assert auth["value"] == "1000"
    assert auth["validAfter"] == "1756511999"
    assert auth["validBefore"] == "1756512060"
    assert re.fullmatch(r"0x[0-9a-f]{64}", auth["nonce"])
    without_resource = sign_exact_evm_authorization(
        requirement=requirement,
        policy=_policy(),
        payer_address=vector["payer"],
        signer=lambda _typed: vector["signature"],
        now_seconds=1_756_512_000,
    )
    assert list(without_resource.payload.keys()) == ["x402Version", "accepted", "payload"]
    # The header is canonical base64 of compact JSON and round-trips.
    raw = base64.b64decode(with_resource.header, validate=True)
    assert base64.b64encode(raw).decode() == with_resource.header
    assert json.loads(raw) == with_resource.payload
    # Compact JSON: no separator whitespace (the only spaces are inside "USD Coin").
    assert raw == json.dumps(with_resource.payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def test_sign_mints_a_fresh_nonce_every_call(vector: Dict[str, Any]) -> None:
    kwargs = dict(
        requirement=_requirement(vector),
        policy=_policy(),
        payer_address=vector["payer"],
        signer=lambda _typed: vector["signature"],
        now_seconds=1_756_512_000,
    )
    first = sign_exact_evm_authorization(**kwargs)
    second = sign_exact_evm_authorization(**kwargs)
    assert first.payload["payload"]["authorization"]["nonce"] != second.payload["payload"]["authorization"]["nonce"]
    assert first.authorization_hash != second.authorization_hash


def test_sign_uses_the_narrowest_window(vector: Dict[str, Any]) -> None:
    signed = sign_exact_evm_authorization(
        requirement=_requirement(vector, maxTimeoutSeconds=600),
        policy=_policy(max_validity_seconds=30),
        payer_address=vector["payer"],
        signer=lambda _typed: vector["signature"],
        now_seconds=1_000_000,
    )
    assert signed.valid_before == 1_000_030
    assert signed.payload["payload"]["authorization"]["validAfter"] == "999999"
    signed = sign_exact_evm_authorization(
        requirement=_requirement(vector, maxTimeoutSeconds=10),
        policy=_policy(max_validity_seconds=30),
        payer_address=vector["payer"],
        signer=lambda _typed: vector["signature"],
        now_seconds=1_000_000,
    )
    assert signed.valid_before == 1_000_010


def test_sign_rejects_bad_inputs(vector: Dict[str, Any]) -> None:
    base = dict(
        requirement=_requirement(vector),
        policy=_policy(),
        payer_address=vector["payer"],
        signer=lambda _typed: vector["signature"],
        now_seconds=1_756_512_000,
    )
    with pytest.raises(ValueError, match="now_seconds"):
        sign_exact_evm_authorization(**dict(base, now_seconds=0))
    with pytest.raises(ValueError, match="now_seconds"):
        sign_exact_evm_authorization(**dict(base, now_seconds=2**53))
    with pytest.raises(ValueError, match="payer_address"):
        sign_exact_evm_authorization(**dict(base, payer_address="0xnope"))
    with pytest.raises(ValueError, match="65-byte hex signature"):
        sign_exact_evm_authorization(**dict(base, signer=lambda _typed: "0x1234"))
    with pytest.raises(ValueError, match="65-byte hex signature"):
        sign_exact_evm_authorization(**dict(base, signer=lambda _typed: None))
    with pytest.raises(TypeError):
        sign_exact_evm_authorization(**dict(base, policy=None))
    with pytest.raises(ValueError, match="pay_to_not_allowed"):
        sign_exact_evm_authorization(**dict(base, requirement=_requirement(vector, payTo=vector["payer"])))


def test_payment_is_still_replayable_boundary(vector: Dict[str, Any]) -> None:
    signed = sign_exact_evm_authorization(
        requirement=_requirement(vector),
        policy=_policy(),
        payer_address=vector["payer"],
        signer=lambda _typed: vector["signature"],
        now_seconds=1_756_512_000,
    )
    assert payment_is_still_replayable(signed, 1_756_512_000)
    assert payment_is_still_replayable(signed, signed.valid_before - 1)
    assert not payment_is_still_replayable(signed, signed.valid_before)
    assert not payment_is_still_replayable(signed, signed.valid_before + 1)


# ── Package surface ────────────────────────────────────────────────────────


def test_public_surface_exported_from_package() -> None:
    for name in (
        "X402SpendPolicy",
        "SignedX402Payment",
        "X402ClientRefusal",
        "X402SelectedRequirement",
        "parse_payment_required_body",
        "select_payable_requirement",
        "sign_exact_evm_authorization",
        "authorization_hash",
        "payment_is_still_replayable",
        "hash_transfer_with_authorization",
        "local_evm_signer",
        "evm_address_from_private_key",
        "X402_CLIENT_REFUSAL_REASONS",
    ):
        assert hasattr(agenttool, name), name
        assert name in agenttool.__all__, name


#: The eighteen column-0 functions `packages/sdk-ts/src/x402.ts` exports
#: (W2-6/W2-7), snake_cased. `check-parity.ts` compares the two surfaces
#: package-wide with separators dropped, so this list IS the parity contract:
#: a name added on one side without its twin fails the gate.
X402_TS_EXPORTED_FUNCTIONS = (
    "decodeCanonicalBase64",
    "encodeCanonicalBase64Json",
    "keccak256",
    "checksumEvmAddress",
    "isEvmAddress",
    "parseResourceInfo",
    "parsePaymentRequirements",
    "parsePaymentRequiredBody",
    "decodePaymentRequiredHeader",
    "decodePaymentResponseHeader",
    "selectPayableRequirement",
    "authorizationHash",
    "hashTransferWithAuthorization",
    "evmAddressFromPrivateKey",
    "recoverTypedDataAddress",
    "localEvmSigner",
    "signExactEvmAuthorization",
    "paymentIsStillReplayable",
)


def _parity_key(name: str) -> str:
    return name.replace("_", "").lower()


def test_exactly_eighteen_public_functions_for_parity() -> None:
    source = (REPO_ROOT / "packages" / "sdk-py" / "src" / "agenttool" / "x402.py").read_text(encoding="utf-8")
    public = re.findall(r"^def ([a-z][a-z0-9_]*)\(", source, flags=re.MULTILINE)
    assert len(public) == 18
    assert sorted(_parity_key(name) for name in public) == sorted(
        _parity_key(name) for name in X402_TS_EXPORTED_FUNCTIONS
    )
    # And the same names are the package's public doors.
    for name in public:
        assert name in agenttool.__all__, name


# ── viem oracle (optional) ─────────────────────────────────────────────────


def _viem_oracle_available() -> bool:
    return (
        shutil.which("bun") is not None
        and (API_DIR / "node_modules" / "viem" / "package.json").exists()
    )


@pytest.mark.skipif(
    not _viem_oracle_available(),
    reason="viem oracle needs `bun` on PATH and api/node_modules/viem (run `bun install --frozen-lockfile` in api/)",
)
def test_server_offline_verifier_accepts_python_signature(vector: Dict[str, Any]) -> None:
    """The server's fast path is viem ``recoverTypedDataAddress``; feed it a
    signature Python produced over a FRESH nonce and expect the payer."""
    signer = local_evm_signer(vector["privateKey"])
    signed = sign_exact_evm_authorization(
        requirement=_requirement(vector),
        policy=_policy(),
        payer_address=vector["payer"],
        signer=signer,
        now_seconds=1_756_600_000,
    )
    auth = signed.payload["payload"]["authorization"]
    script = """
      import { recoverTypedDataAddress } from "viem";
      const input = JSON.parse(process.env.X402_ORACLE_INPUT);
      const recovered = await recoverTypedDataAddress({
        domain: input.domain,
        types: { TransferWithAuthorization: [
          { name: "from", type: "address" }, { name: "to", type: "address" },
          { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
        ] },
        primaryType: "TransferWithAuthorization",
        message: {
          from: input.auth.from, to: input.auth.to,
          value: BigInt(input.auth.value), validAfter: BigInt(input.auth.validAfter),
          validBefore: BigInt(input.auth.validBefore), nonce: input.auth.nonce,
        },
        signature: input.signature,
      });
      console.log(recovered);
    """
    payload = json.dumps(
        {
            "domain": {
                "name": "USD Coin",
                "version": "2",
                "chainId": 8453,
                "verifyingContract": BASE_USDC,
            },
            "auth": auth,
            "signature": signed.payload["payload"]["signature"],
        }
    )
    result = subprocess.run(
        ["bun", "-e", script],
        cwd=str(API_DIR),
        env={"PATH": os.environ.get("PATH", ""), "HOME": os.environ.get("HOME", ""), "X402_ORACLE_INPUT": payload},
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == vector["payer"]
