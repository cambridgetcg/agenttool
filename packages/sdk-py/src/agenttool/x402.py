"""x402 V2 payer — turn a 402 challenge into a signed, capability-bounded payment.

This is the Python twin of ``packages/sdk-ts/src/x402.ts``, both mirroring
the server's own client at ``api/src/services/economy/x402-client.ts``
function-for-function. The server is normative: the fixture at
``tests/fixtures/x402-eip3009-vector.json`` was produced by executing that
implementation (plus viem), and this module is wrong until it agrees.

## Doctrine (changed deliberately, 2026-08-29)

The SDK **can** sign and pay on 402 — **opt-in only, never by default**.
Nothing in this module runs unless a caller hands it an explicit signer AND
an :class:`X402SpendPolicy` whose ``max_amount_atomic`` and
``allowed_pay_to`` are supplied (no defaults for either). Allow-lists,
never deny-lists: a 402 body is untrusted input from whoever we are
talking to and can never introduce a new recipient, network, or asset.

## The walls

1. **A cap that is not advisory.** ``max_amount_atomic`` is checked before
   signing. An over-cap requirement is *refused*, never clamped: paying
   less than asked produces an authorization the counterparty rejects,
   which then reads as our bug rather than their price.
2. **Allow-lists, not deny-lists.** Recipient, network, and asset must be
   named in advance.
3. **The narrowest validity window** that still satisfies the requirement:
   ``min(requirement.maxTimeoutSeconds, policy.max_validity_seconds)``. A
   signed EIP-3009 authorization is bearer-spendable until ``validBefore``;
   a long window is a long liability.
4. **No re-signing. Ever.** :func:`sign_exact_evm_authorization` mints a
   fresh random nonce on every call, so it cannot be used as a retry
   mechanism by construction. A caller that must retry replays the bytes it
   already holds (:func:`payment_is_still_replayable`); a caller that signs
   again is authorizing a second, independent payment, and the fresh nonce
   makes that visible in the ledger. Persist :func:`authorization_hash`
   BEFORE emitting the request — recovery is a lookup, not a signature.

The parse → refuse → sign functions touch no network. The transport that
performs the bare call → 402 → one signed retry lives in
``_x402_transport.py`` (exactly-two-request; a second 402 is an error, never
a loop) and is installed only by ``AgentTool(x402=X402Payer(...))``.
Refusals are typed values, never exceptions, so a caller can log the reason
and stop. :class:`X402Client` (``at.x402``) is the rail's two doors —
``top_up`` and ``payment`` — and signs nothing itself.

Crypto: ``_x402_crypto.py`` — pure-Python Keccak-256 + EIP-712 + recoverable
secp256k1 ECDSA on the existing ``cryptography`` dependency. Zero new deps.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import re
import uuid
from dataclasses import dataclass, field
from typing import (
    Any,
    Callable,
    Dict,
    List,
    Literal,
    Mapping,
    Optional,
    Sequence,
    Tuple,
    TypedDict,
    Union,
)

import httpx

from . import _x402_crypto as _crypto
from ._url import _path_segment
from .exceptions import (
    AgentToolError,
    X402PaymentRequirement,
    X402ResourceInfo,
    raise_from_response,
)

# ── Wire constants ────────────────────────────────────────────────────────

X402_VERSION = 2

#: CAIP-2 networks the server publishes USDC pins for (api/src/middleware/x402.ts).
X402_NETWORKS: Tuple[str, ...] = ("eip155:8453", "eip155:84532", "eip155:137", "eip155:42161")

#: The server's USDC pins per network (``middleware/x402.ts`` ``USDC_ASSETS``):
#: contract address plus the EIP-712 domain ``name`` / ``version`` the token
#: signs under. Twin of ``X402_USDC_ASSETS`` in the TypeScript SDK.
X402_USDC_ASSETS: Dict[str, Dict[str, str]] = {
    "eip155:8453": {"asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "name": "USD Coin", "version": "2"},
    "eip155:84532": {"asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "name": "USDC", "version": "2"},
    "eip155:137": {"asset": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", "name": "USD Coin", "version": "2"},
    "eip155:42161": {"asset": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", "name": "USD Coin", "version": "2"},
}

#: Longest ``PAYMENT-REQUIRED`` / ``PAYMENT-RESPONSE`` header the decoders
#: will look at — the server's own inbound bound.
MAX_X402_HEADER_B64_LENGTH = 32 * 1024

#: Base mainnet, the kingdom's rail.
BASE_NETWORK = "eip155:8453"
#: Circle's native USDC on Base — the same value the server pins in
#: ``middleware/x402.ts`` ``USDC_ASSETS``. EIP-712 domain ``USD Coin`` / ``2``.
BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
#: The KINGDOM Sovereign Reserve treasury on Base.
KINGDOM_TREASURY = "0xA9eeA60CAaF239AbAfAA05FcB152128dB16dD3d8"
#: 1 credit = 1,000 USDC atomic units = USD 0.001.
ATOMIC_PER_CREDIT = 1000

#: EIP-712 types for USDC-style ``transferWithAuthorization``. Identical to the
#: server's verifier in ``x402-payments.ts`` — the two sides must agree
#: byte-for-byte, so the shape is duplicated deliberately rather than shared.
TRANSFER_WITH_AUTHORIZATION_TYPES: Dict[str, Tuple[Dict[str, str], ...]] = {
    "TransferWithAuthorization": (
        {"name": "from", "type": "address"},
        {"name": "to", "type": "address"},
        {"name": "value", "type": "uint256"},
        {"name": "validAfter", "type": "uint256"},
        {"name": "validBefore", "type": "uint256"},
        {"name": "nonce", "type": "bytes32"},
    ),
}

# ── Refusal vocabulary (IDENTICAL to the TypeScript union) ────────────────

X402ClientRefusalReason = Literal[
    "not_a_payment_required_body",
    "no_acceptable_requirement",
    "network_not_allowed",
    "asset_not_allowed",
    "pay_to_not_allowed",
    "amount_over_cap",
    "unsupported_transfer_method",
    "validity_window_unusable",
]

X402_CLIENT_REFUSAL_REASONS: Tuple[str, ...] = (
    "not_a_payment_required_body",
    "no_acceptable_requirement",
    "network_not_allowed",
    "asset_not_allowed",
    "pay_to_not_allowed",
    "amount_over_cap",
    "unsupported_transfer_method",
    "validity_window_unusable",
)


@dataclass(frozen=True)
class X402ClientRefusal:
    """Why no requirement was signed. A value, not an exception."""

    reason: str
    #: One sentence an operator can act on.
    detail: str
    ok: bool = field(default=False, init=False)


@dataclass(frozen=True)
class X402SelectedRequirement:
    requirement: X402PaymentRequirement
    amount_atomic: int
    ok: bool = field(default=True, init=False)


# ── Spend policy ──────────────────────────────────────────────────────────


def _is_safe_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and -(2**53) < value < 2**53


def _normalise_allow_list(name: str, values: object, *, addresses: bool) -> Tuple[str, ...]:
    if isinstance(values, (str, bytes)) or not isinstance(values, Sequence):
        raise TypeError(f"X402SpendPolicy.{name} must be a sequence of strings")
    out: List[str] = []
    for value in values:
        if not isinstance(value, str) or not value:
            raise TypeError(f"X402SpendPolicy.{name} entries must be non-empty strings")
        if addresses and not _crypto.is_address(value):
            raise ValueError(f"X402SpendPolicy.{name} entry is not a valid EVM address")
        out.append(value)
    if not out:
        raise ValueError(f"X402SpendPolicy.{name} must name at least one entry (allow-list, never a deny-list)")
    return tuple(out)


@dataclass(frozen=True)
class X402SpendPolicy:
    """What this instance is willing to spend, before it sees any challenge.

    Every field is a refusal condition, not a preference. ``max_amount_atomic``
    and ``allowed_pay_to`` are mandatory with no defaults: a policy that does
    not say how much and to whom is not a policy. The remaining allow-lists
    default to the kingdom's rail (Base mainnet USDC, 60-second window) and
    are still allow-lists — widen them explicitly or not at all.
    """

    #: Hard per-payment ceiling in the asset's atomic units. Refused above, never clamped.
    max_amount_atomic: int
    #: Recipients we will sign for. Compared case-insensitively.
    allowed_pay_to: Sequence[str]
    #: CAIP-2 networks we will sign for.
    allowed_networks: Sequence[str] = (BASE_NETWORK,)
    #: Asset contract addresses we will sign for. Compared case-insensitively.
    allowed_assets: Sequence[str] = (BASE_USDC,)
    #: Longest authorization validity we will mint, in seconds. The signed
    #: window is ``min(requirement.maxTimeoutSeconds, this)``.
    max_validity_seconds: int = 60

    def __post_init__(self) -> None:
        if isinstance(self.max_amount_atomic, bool) or not isinstance(self.max_amount_atomic, int):
            raise TypeError("X402SpendPolicy.max_amount_atomic must be an int (atomic units)")
        if self.max_amount_atomic <= 0:
            raise ValueError("X402SpendPolicy.max_amount_atomic must be positive")
        if not _is_safe_int(self.max_validity_seconds) or self.max_validity_seconds <= 0:
            raise ValueError("X402SpendPolicy.max_validity_seconds must be a positive integer")
        object.__setattr__(
            self, "allowed_pay_to", _normalise_allow_list("allowed_pay_to", self.allowed_pay_to, addresses=True)
        )
        object.__setattr__(
            self, "allowed_assets", _normalise_allow_list("allowed_assets", self.allowed_assets, addresses=True)
        )
        networks = _normalise_allow_list("allowed_networks", self.allowed_networks, addresses=False)
        for network in networks:
            if not _CAIP2_EVM.match(network):
                raise ValueError("X402SpendPolicy.allowed_networks entries must be CAIP-2 eip155:<chainId>")
        object.__setattr__(self, "allowed_networks", networks)


# ── Envelope types ────────────────────────────────────────────────────────


class _X402PaymentRequiredRequired(TypedDict):
    x402Version: int
    resource: X402ResourceInfo
    accepts: List[X402PaymentRequirement]


class X402PaymentRequired(_X402PaymentRequiredRequired, total=False):
    """x402 V2 ``PaymentRequired`` — the 402 body / ``PAYMENT-REQUIRED`` header."""

    error: str


class X402TypedDataDomain(TypedDict):
    name: str
    version: str
    chainId: int
    verifyingContract: str


# ``from`` is a keyword, so the message uses the functional TypedDict form.
X402TransferWithAuthorizationMessage = TypedDict(
    "X402TransferWithAuthorizationMessage",
    {
        "from": str,
        "to": str,
        "value": int,
        "validAfter": int,
        "validBefore": int,
        "nonce": str,
    },
)


class TransferWithAuthorizationTypedData(TypedDict):
    """EIP-712 payload handed to the caller's signer. Shaped like viem's
    ``signTypedData`` input, but plain dicts so any signer can consume it."""

    domain: X402TypedDataDomain
    types: Dict[str, Tuple[Dict[str, str], ...]]
    primaryType: Literal["TransferWithAuthorization"]
    message: X402TransferWithAuthorizationMessage


#: A signer takes the typed data and returns a 65-byte ``0x`` hex signature
#: (``r‖s‖v``, ``v`` ∈ {27, 28}). The private half never enters this module.
X402Signer = Callable[[TransferWithAuthorizationTypedData], str]


@dataclass(frozen=True)
class SignedX402Payment:
    #: Ready for the ``PAYMENT-SIGNATURE`` header.
    header: str
    #: The x402 V2 ``PaymentPayload`` the header encodes.
    payload: Dict[str, Any]
    #: Stable identity of the authorization these bytes carry. Persist this
    #: BEFORE emitting the request; recovery is a lookup, never a fresh signature.
    authorization_hash: str
    #: Unix seconds after which these bytes are dead.
    valid_before: int


class _X402SettleResponseRequired(TypedDict):
    success: bool
    transaction: str
    network: str


class X402SettleResponse(_X402SettleResponseRequired, total=False):
    """x402 V2 ``SettleResponse`` — the decoded ``PAYMENT-RESPONSE`` header.

    The facilitator's word, not the ledger's: ``success`` here proves
    settlement was reported, not that credits were applied."""

    errorReason: str
    errorMessage: str
    payer: str
    amount: str
    extensions: Dict[str, Any]
    extra: Dict[str, Any]


# ── Canonical base64 + hashing (mirrors api/src/middleware/x402.ts) ───────

_CANONICAL_BASE64 = re.compile(r"^[A-Za-z0-9+/]+={0,2}$")


def decode_canonical_base64(value: str, max_encoded_length: int = MAX_X402_HEADER_B64_LENGTH) -> Optional[bytes]:
    """Decode canonical standard base64 (padded, no whitespace, re-encodes to
    itself). ``None`` for anything else — the same strictness the server
    applies to inbound headers."""
    if (
        not isinstance(value, str)
        or len(value) == 0
        or len(value) > max_encoded_length
        or len(value) % 4 != 0
        or not _CANONICAL_BASE64.match(value)
    ):
        return None
    try:
        decoded = base64.b64decode(value, validate=True)
    except (ValueError, TypeError):
        return None
    if len(decoded) == 0 or base64.b64encode(decoded).decode("ascii") != value:
        return None
    return decoded


def encode_canonical_base64_json(value: Any) -> str:
    """``base64(JSON.stringify(value))`` — byte-identical to the server's
    ``Buffer.from(JSON.stringify(value), "utf-8").toString("base64")``: key
    order is insertion order, no whitespace, non-ASCII left raw."""
    encoded = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return base64.b64encode(encoded).decode("ascii")


def _decode_canonical_base64_json(value: str) -> Any:
    decoded = decode_canonical_base64(value, MAX_X402_HEADER_B64_LENGTH)
    if decoded is None:
        return None
    try:
        return json.loads(decoded.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None


def keccak256(data: bytes) -> bytes:
    """Keccak-256 (Ethereum's hash; original padding, not SHA-3)."""
    return _crypto.keccak256(data)


def checksum_evm_address(address: str) -> str:
    """EIP-55 mixed-case checksum of a 20-byte hex address. ``ValueError``
    for anything that is not one."""
    try:
        return _crypto.to_checksum_address(address)
    except ValueError as exc:
        raise ValueError(f"x402: {address!r} is not a 20-byte hex address.") from exc


def is_evm_address(value: object) -> bool:
    """Same acceptance as viem's ``isAddress`` (strict): 20-byte hex, and if
    it carries mixed case the EIP-55 checksum must be right. The server's
    parser uses exactly this, so a ``payTo`` or ``asset`` the server would
    reject is rejected here too."""
    return _crypto.is_address(value)


# ── Strict parsing (mirrors api/src/middleware/x402.ts) ───────────────────

_CAIP2_EVM = re.compile(r"^eip155:[1-9][0-9]*$")
_CANONICAL_UINT = re.compile(r"^(?:0|[1-9][0-9]*)$")
_SIGNATURE_HEX = re.compile(r"^0x[0-9a-fA-F]{130}$")
_REQUIREMENT_KEYS = ("scheme", "network", "asset", "amount", "payTo", "maxTimeoutSeconds", "extra")
_RESOURCE_KEYS = ("url", "description", "mimeType", "serviceName", "tags", "iconUrl")


def _object_record(value: object) -> Optional[Dict[str, Any]]:
    return value if isinstance(value, dict) else None


def _has_only_keys(record: Mapping[str, Any], allowed: Sequence[str]) -> bool:
    keys = set(allowed)
    return all(isinstance(key, str) and key in keys for key in record)


def _is_bounded_json_record(record: Mapping[str, Any]) -> bool:
    queue: List[Tuple[Any, int]] = [(record, 0)]
    nodes = 0
    while queue:
        value, depth = queue.pop()
        nodes += 1
        if nodes > 256 or depth > 8:
            return False
        if value is None or isinstance(value, bool):
            continue
        if isinstance(value, str):
            if len(value) > 4096:
                return False
            continue
        if isinstance(value, int):
            continue
        if isinstance(value, float):
            if not math.isfinite(value):
                return False
            continue
        if isinstance(value, list):
            if len(value) > 64:
                return False
            queue.extend((item, depth + 1) for item in value)
            continue
        nested = _object_record(value)
        if nested is None or len(nested) > 64:
            return False
        queue.extend((item, depth + 1) for item in nested.values())
    return True


def _as_safe_integer(value: object) -> Optional[int]:
    """``Number.isSafeInteger`` over a JSON-decoded value; floats that are
    whole (``60.0``) are what JS would have read as ``60``."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if _is_safe_int(value) else None
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        as_int = int(value)
        return as_int if _is_safe_int(as_int) else None
    return None


def parse_resource_info(value: object) -> Optional[X402ResourceInfo]:
    """Strict ``ResourceInfo``: only the spec's keys, ``url`` required and
    bounded. The resource is echoed back inside ``PAYMENT-SIGNATURE`` and the
    verifier applies the same parser, so anything looser would be signed for
    and then bounced."""
    record = _object_record(value)
    if record is None or not _has_only_keys(record, _RESOURCE_KEYS):
        return None
    url = record.get("url")
    if not isinstance(url, str) or len(url) == 0 or len(url) > 2048:
        return None
    for key in ("description", "mimeType", "serviceName", "iconUrl"):
        if key in record and not isinstance(record[key], str):
            return None
    tags = record.get("tags")
    if "tags" in record and (not isinstance(tags, list) or any(not isinstance(tag, str) for tag in tags)):
        return None
    return record  # type: ignore[return-value]


def parse_payment_requirements(value: object) -> Optional[X402PaymentRequirement]:
    """Strict ``PaymentRequirements``: the same parser the server runs on
    inbound headers, so a counterparty cannot hand us a shape our own
    verifier would reject. ``maxTimeoutSeconds`` is normalised to ``int``."""
    record = _object_record(value)
    if record is None or not _has_only_keys(record, _REQUIREMENT_KEYS):
        return None
    extra = _object_record(record.get("extra"))
    max_timeout = _as_safe_integer(record.get("maxTimeoutSeconds"))
    if (
        record.get("scheme") != "exact"
        or not isinstance(record.get("network"), str)
        or not _CAIP2_EVM.match(record["network"])
        or not isinstance(record.get("asset"), str)
        or not _crypto.is_address(record["asset"])
        or not isinstance(record.get("amount"), str)
        or not _CANONICAL_UINT.match(record["amount"])
        or not isinstance(record.get("payTo"), str)
        or not _crypto.is_address(record["payTo"])
        or max_timeout is None
        or max_timeout <= 0
        or extra is None
        or not _is_bounded_json_record(extra)
        or not isinstance(extra.get("name"), str)
        or len(extra["name"]) == 0
        or not isinstance(extra.get("version"), str)
        or len(extra["version"]) == 0
    ):
        return None
    parsed: Dict[str, Any] = dict(record)
    parsed["maxTimeoutSeconds"] = max_timeout
    return parsed  # type: ignore[return-value]


def parse_payment_required_body(value: object) -> Optional[X402PaymentRequired]:
    """Parse an untrusted 402 body (or decoded ``PAYMENT-REQUIRED`` header).

    Deliberately stricter than "does it have the fields": every entry in
    ``accepts`` passes the same requirement parser the server applies to
    inbound headers, so a counterparty cannot hand us a shape our own
    verifier would reject. Returns ``None`` for anything else.
    """
    body = _object_record(value)
    if body is None:
        return None
    if body.get("x402Version") != X402_VERSION or isinstance(body.get("x402Version"), bool):
        return None

    resource = parse_resource_info(body.get("resource"))
    if resource is None:
        return None

    accepts_raw = body.get("accepts")
    if not isinstance(accepts_raw, list) or len(accepts_raw) == 0 or len(accepts_raw) > 16:
        return None
    accepts: List[X402PaymentRequirement] = []
    for entry in accepts_raw:
        parsed = parse_payment_requirements(entry)
        if parsed is None:
            return None
        accepts.append(parsed)

    out: Dict[str, Any] = {"x402Version": X402_VERSION}
    if isinstance(body.get("error"), str):
        out["error"] = body["error"]
    out["resource"] = resource
    out["accepts"] = accepts
    return out  # type: ignore[return-value]


def decode_payment_required_header(header_value: str) -> Optional[X402PaymentRequired]:
    """Decode a ``PAYMENT-REQUIRED`` header into a strict ``PaymentRequired``,
    or ``None`` for anything that is not canonical base64 of a valid envelope."""
    return parse_payment_required_body(_decode_canonical_base64_json(header_value))


def decode_payment_response_header(header_value: str) -> Optional[X402SettleResponse]:
    """Decode a ``PAYMENT-RESPONSE`` header into a ``SettleResponse``, or
    ``None``. The receipt is the facilitator's word, not the ledger's:
    ``success`` proves settlement was reported, not that credits applied."""
    record = _object_record(_decode_canonical_base64_json(header_value))
    if (
        record is None
        or not _is_bounded_json_record(record)
        or not isinstance(record.get("success"), bool)
        or not isinstance(record.get("transaction"), str)
        or not isinstance(record.get("network"), str)
    ):
        return None
    for key in ("errorReason", "errorMessage", "payer", "amount"):
        if key in record and not isinstance(record[key], str):
            return None
    return record  # type: ignore[return-value]


# ── Selection ─────────────────────────────────────────────────────────────


def _lower_set(values: Sequence[str]) -> set:
    return {value.lower() for value in values}


def _check_requirement(
    requirement: Mapping[str, Any], policy: X402SpendPolicy
) -> Union[X402SelectedRequirement, X402ClientRefusal]:
    """One requirement against one policy. The walls, in the server's order."""
    network = requirement.get("network")
    if network not in set(policy.allowed_networks):
        return X402ClientRefusal(
            "network_not_allowed",
            f"Challenge offers network {network}, which this policy does not allow.",
        )
    asset = requirement.get("asset")
    if not isinstance(asset, str) or asset.lower() not in _lower_set(policy.allowed_assets):
        return X402ClientRefusal(
            "asset_not_allowed",
            f"Challenge offers asset {asset}, which this policy does not allow. "
            "A 402 body is untrusted input; it cannot introduce a new asset contract.",
        )
    pay_to = requirement.get("payTo")
    if not isinstance(pay_to, str) or pay_to.lower() not in _lower_set(policy.allowed_pay_to):
        return X402ClientRefusal(
            "pay_to_not_allowed",
            f"Challenge directs payment to {pay_to}, which this policy does not allow.",
        )
    extra = requirement.get("extra")
    method = extra.get("assetTransferMethod") if isinstance(extra, Mapping) else None
    if method != "eip3009":
        return X402ClientRefusal(
            "unsupported_transfer_method",
            f"Challenge asks for transfer method {method}; only eip3009 is implemented.",
        )

    amount_raw = requirement.get("amount")
    if not isinstance(amount_raw, str) or not _CANONICAL_UINT.match(amount_raw):
        return X402ClientRefusal(
            "no_acceptable_requirement",
            f"Challenge amount {amount_raw} is not an integer.",
        )
    amount_atomic = int(amount_raw)
    if amount_atomic <= 0:
        return X402ClientRefusal("no_acceptable_requirement", "Challenge amount is not positive.")
    if amount_atomic > policy.max_amount_atomic:
        # Refused, never clamped. Paying less than asked produces an
        # authorization the counterparty rejects — which then reads as our
        # bug rather than their price being above what we authorized.
        return X402ClientRefusal(
            "amount_over_cap",
            f"Challenge asks {amount_atomic} atomic units; this policy caps a single payment "
            f"at {policy.max_amount_atomic}.",
        )
    max_timeout = requirement.get("maxTimeoutSeconds")
    if (
        not isinstance(max_timeout, int)
        or isinstance(max_timeout, bool)
        or max_timeout <= 0
        or policy.max_validity_seconds <= 0
    ):
        return X402ClientRefusal(
            "validity_window_unusable",
            "Neither the challenge nor the policy leaves a positive validity window.",
        )
    return X402SelectedRequirement(requirement=requirement, amount_atomic=amount_atomic)  # type: ignore[arg-type]


def select_payable_requirement(
    required: Mapping[str, Any], policy: X402SpendPolicy
) -> Union[X402SelectedRequirement, X402ClientRefusal]:
    """Pick the first requirement this policy permits, or say precisely why none did.

    "First permitted", not "cheapest": the counterparty orders ``accepts`` by
    its own preference, and reordering by price would quietly opt us into
    whichever rail they listed last. Cost is bounded by the cap instead.

    The most specific refusal seen is returned, so a caller learns "your cap
    is too low" rather than the useless "nothing matched".
    """
    if not isinstance(policy, X402SpendPolicy):
        raise TypeError("select_payable_requirement needs an X402SpendPolicy (no defaults, no dicts)")
    accepts = required.get("accepts") if isinstance(required, Mapping) else None
    last_refusal: Optional[X402ClientRefusal] = None
    for requirement in accepts or ():
        if not isinstance(requirement, Mapping):
            continue
        outcome = _check_requirement(requirement, policy)
        if isinstance(outcome, X402SelectedRequirement):
            return outcome
        last_refusal = outcome
    return last_refusal or X402ClientRefusal(
        "no_acceptable_requirement",
        "The challenge listed no requirement this policy permits.",
    )


# ── Authorization identity ────────────────────────────────────────────────


def authorization_hash(auth: Mapping[str, str]) -> str:
    """Canonical identity of an authorization: the fields that decide where
    the money goes. Two byte-identical emissions hash the same; any change to
    recipient, amount, window, or nonce does not. ``sha256`` hex over the same
    compact JSON the server computes (``authorizationIdentityHash``)."""
    canonical = {
        "from": auth["from"].lower(),
        "to": auth["to"].lower(),
        "value": auth["value"],
        "validAfter": auth["validAfter"],
        "validBefore": auth["validBefore"],
        "nonce": auth["nonce"].lower(),
    }
    encoded = json.dumps(canonical, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


#: Kept for the W2-8 call sites; the public spelling is the parity twin of
#: ``encodeCanonicalBase64Json``.
_encode_canonical_base64_json = encode_canonical_base64_json
_parse_payment_requirements = parse_payment_requirements


def _mint_nonce() -> str:
    """32 random bytes as ``0x`` hex. A fresh one per signature, always."""
    return "0x" + os.urandom(32).hex()


# ── EIP-712 digest ────────────────────────────────────────────────────────


def hash_transfer_with_authorization(typed_data: Mapping[str, Any]) -> str:
    """EIP-712 digest (``0x`` hex, 32 bytes) of a ``TransferWithAuthorization``
    typed-data payload — the exact bytes an EVM signer signs, and what the
    server's ``recoverTypedDataAddress`` recovers against."""
    if typed_data.get("primaryType") != "TransferWithAuthorization":
        raise ValueError("typed data primaryType must be TransferWithAuthorization")
    domain = typed_data.get("domain")
    message = typed_data.get("message")
    if not isinstance(domain, Mapping) or not isinstance(message, Mapping):
        raise ValueError("typed data needs domain and message mappings")
    separator = _crypto.eip712_domain_separator(
        domain["name"], domain["version"], domain["chainId"], domain["verifyingContract"]
    )
    struct_hash = _crypto.transfer_with_authorization_struct_hash(
        from_address=message["from"],
        to=message["to"],
        value=message["value"],
        valid_after=message["validAfter"],
        valid_before=message["validBefore"],
        nonce=message["nonce"],
    )
    return "0x" + _crypto.eip712_digest(separator, struct_hash).hex()


# ── Signing ───────────────────────────────────────────────────────────────


def sign_exact_evm_authorization(
    *,
    requirement: Mapping[str, Any],
    policy: X402SpendPolicy,
    payer_address: str,
    signer: X402Signer,
    now_seconds: int,
    resource: Optional[Mapping[str, Any]] = None,
) -> SignedX402Payment:
    """Sign one EIP-3009 authorization against a selected requirement.

    Every call mints a fresh random nonce. That is the wall, not an
    implementation detail: because a second call can never reproduce the
    first authorization, this function cannot be used as a retry mechanism.

    ``now_seconds`` is injected rather than read from the clock so the window
    is testable and so a caller with a trusted time source can supply it.

    The policy is re-applied here even though :func:`select_payable_requirement`
    already ran it: signing must never outrun the walls, whatever the caller
    did in between. A refused requirement raises ``ValueError`` naming the
    refusal reason.
    """
    if not isinstance(policy, X402SpendPolicy):
        raise TypeError("sign_exact_evm_authorization needs an X402SpendPolicy")
    if not _is_safe_int(now_seconds) or now_seconds <= 0:
        raise ValueError("x402 client: now_seconds must be a positive safe integer.")
    if not _crypto.is_address(payer_address):
        raise ValueError("x402 client: payer_address is not a valid EVM address.")

    checked = _check_requirement(requirement, policy)
    if isinstance(checked, X402ClientRefusal):
        raise ValueError(f"x402 client: refusing to sign ({checked.reason}): {checked.detail}")

    network = str(requirement["network"])
    try:
        chain_id = int(network[len("eip155:") :])
    except ValueError:
        chain_id = 0
    if not _is_safe_int(chain_id) or chain_id <= 0:
        raise ValueError(f"x402 client: unusable chain id in network {network}.")

    # The narrowest window that still satisfies the counterparty.
    window_seconds = min(int(requirement["maxTimeoutSeconds"]), policy.max_validity_seconds)
    if window_seconds <= 0:
        raise ValueError("x402 client: no positive validity window remains after applying the policy.")

    # validAfter is one second in the past: a signature minted at exactly
    # `now` can otherwise lose a race against a verifier whose clock is a
    # tick behind.
    valid_after = now_seconds - 1
    valid_before = now_seconds + window_seconds
    nonce = _mint_nonce()

    authorization: Dict[str, str] = {
        "from": payer_address,
        "to": requirement["payTo"],
        "value": requirement["amount"],
        "validAfter": str(valid_after),
        "validBefore": str(valid_before),
        "nonce": nonce,
    }

    extra = requirement["extra"]
    typed_data: TransferWithAuthorizationTypedData = {
        "domain": {
            "name": extra["name"],
            "version": extra["version"],
            "chainId": chain_id,
            "verifyingContract": requirement["asset"],
        },
        "types": TRANSFER_WITH_AUTHORIZATION_TYPES,
        "primaryType": "TransferWithAuthorization",
        "message": {
            "from": authorization["from"],
            "to": authorization["to"],
            "value": int(authorization["value"]),
            "validAfter": valid_after,
            "validBefore": valid_before,
            "nonce": nonce,
        },
    }
    signature = signer(typed_data)

    if not isinstance(signature, str) or not _SIGNATURE_HEX.match(signature):
        # A malformed signature would be spent effort and a confusing 402
        # loop; fail here where the cause is obvious.
        raise ValueError("x402 client: signer returned something that is not a 65-byte hex signature.")

    payload: Dict[str, Any] = {"x402Version": X402_VERSION}
    if resource is not None:
        payload["resource"] = dict(resource)
    payload["accepted"] = dict(requirement)
    payload["payload"] = {"signature": signature, "authorization": authorization}

    return SignedX402Payment(
        header=_encode_canonical_base64_json(payload),
        payload=payload,
        authorization_hash=authorization_hash(authorization),
        valid_before=valid_before,
    )


def payment_is_still_replayable(signed: SignedX402Payment, now_seconds: int) -> bool:
    """True when these bytes can still be replayed.

    The safe response to an ambiguous failure is to re-send the identical
    authorization until it expires — never to sign a new one."""
    return now_seconds < signed.valid_before


# ── Local signer (opt-in key custody, caller's choice) ────────────────────


def evm_address_from_private_key(private_key: Union[bytes, str]) -> str:
    """EIP-55 checksummed address of a 32-byte secp256k1 private key
    (bytes, or hex with/without ``0x``). Never logs the key."""
    return _crypto.address_from_private_key(private_key)


def recover_typed_data_address(typed_data: Mapping[str, Any], signature: str) -> str:
    """Recover the address that signed a ``TransferWithAuthorization`` payload.

    Offline; the same check the server's verifier makes before it trusts a
    signature (``classifyExactEvmSignature`` → ``eoa_verified``). Accepts
    ``v`` as 27/28 or 0/1. ``ValueError`` on a malformed signature.
    """
    if not isinstance(signature, str) or not _SIGNATURE_HEX.match(signature):
        raise ValueError("x402: signature must be 0x-prefixed 65-byte hex (r‖s‖v).")
    v = int(signature[-2:], 16)
    if v not in (0, 1, 27, 28):
        raise ValueError(f"x402: signature v byte {v} is not 27/28 (or 0/1).")
    digest = bytes.fromhex(hash_transfer_with_authorization(typed_data)[2:])
    recovered = _crypto.recover_address(digest, signature)
    if recovered is None:
        raise ValueError("x402: signature does not recover to any secp256k1 public key.")
    return recovered


def local_evm_signer(private_key: Union[bytes, str]) -> X402Signer:
    """An :data:`X402Signer` backed by a raw private key held in this process.

    Opt-in only: the SDK never reads a key from the environment, a file, or
    a keychain on its own. The returned signer refuses to sign a message whose
    ``from`` is not this key's address — such an authorization could only
    ever be rejected downstream, and here the cause is obvious.

    Signs the EIP-712 digest with ``cryptography`` (RFC 6979 nonces where the
    build supports them), low-s, ``r‖s‖v`` with ``v`` ∈ {27, 28}.
    """
    raw = _crypto.private_key_bytes(private_key)
    address = _crypto.address_from_private_key(raw)

    def sign(typed_data: TransferWithAuthorizationTypedData) -> str:
        sender = typed_data.get("message", {}).get("from")
        if not isinstance(sender, str) or sender.lower() != address.lower():
            raise ValueError("x402 local signer: message.from is not this signer's address; refusing to sign.")
        digest = bytes.fromhex(hash_transfer_with_authorization(typed_data)[2:])
        return _crypto.signature_to_hex(_crypto.sign_recoverable(digest, raw))

    # The address rides on the callable (the TypeScript signer object carries
    # it as `.address`) so the paying transport can fill `from` without a
    # second argument. The key itself stays in the closure.
    sign.address = address  # type: ignore[attr-defined]
    return sign


# ── at.x402 — the two doors of the agent rail ─────────────────────────────


@dataclass(frozen=True)
class X402TopUpResult:
    """Result of ``at.x402.top_up(credits)`` — the server's receipt, plus the
    raw settlement headers the response carried."""

    #: Credits the server applied in the same transaction that recorded settlement.
    credits_added: int
    #: Project balance after the top-up, when the server reported it.
    credits_total: Optional[int]
    #: The server's LEDGER identity for this payment (folds network + asset);
    #: what ``at.x402.payment(id)`` resolves. Not the client-side
    #: :func:`authorization_hash` of the six EIP-3009 fields.
    authorization_hash: Optional[str]
    #: Atomic USDC moved for this top-up (credits × 1,000).
    amount_atomic: str
    #: The server's unit and finality sentences, verbatim.
    unit: Optional[str]
    finality: Optional[str]
    #: Project-scoped status path, when the server named one.
    payment_status: Optional[str]
    #: Raw ``PAYMENT-RESPONSE`` settlement receipt header, when present.
    payment_response: Optional[str] = None
    #: Raw ``Link`` header (``rel="payment-status"``), when present.
    payment_status_link: Optional[str] = None
    #: Raw ``X-Credits-Balance`` header, when present.
    credits_balance: Optional[str] = None


class X402PaymentStatus(TypedDict, total=False):
    """One row of ``GET /v1/x402/payments/:id`` — the project-scoped
    reconciliation of the payment/credit lifecycle only. It never replays or
    promises an exactly-once result for the paid request itself. Field names
    are the server's, verbatim."""

    payment_id: str
    status: str
    failure_reason: Optional[str]
    scheme: str
    network: str
    asset: str
    amount: str
    pay_to: str
    max_timeout_seconds: int
    requirement_extra: Dict[str, Any]
    resource: str
    resource_info: Optional[Dict[str, Any]]
    credits_purchased: Optional[int]
    authorization_evidence: Dict[str, Any]
    settlement_attempted_at: Optional[str]
    transaction: Optional[str]
    receipt: Optional[Dict[str, Any]]
    credits_applied: Optional[int]
    reconciles: str
    next_action: str
    retry_after_seconds: Optional[int]
    environment_note: Optional[str]
    pending_note: Optional[str]
    updated_at: Optional[str]


def _header(response: httpx.Response, *names: str) -> Optional[str]:
    for name in names:
        value = response.headers.get(name)
        if value is not None:
            return value
    return None


class X402Client:
    """``at.x402`` — the agent rail's two doors.

    ``top_up(credits)`` knocks on ``POST /v1/x402/top-up/:credits``. With no
    ``x402=`` payer on the client the answer is the 402 challenge itself, as
    a typed :class:`AgentToolError` carrying ``accepts`` /
    ``payment_required``, and nothing is signed. With the payer, the paying
    transport answers that 402 with exactly one signed retry under the spend
    policy and this method returns the receipt. ``payment(id)`` reads the
    ledger row behind a payment.

    Neither method signs anything itself.
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base_url = base_url

    def top_up(
        self,
        credits: int,
        *,
        payment_signature: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> X402TopUpResult:
        """Buy ``credits`` project credits with USDC on Base (1 credit = 1,000
        atomic = USD 0.001). Final: no refunds; unspent credits stay.

        ``payment_signature`` is an opaque, already signed x402 V2
        ``PAYMENT-SIGNATURE`` value for callers who sign outside the SDK; it
        is sent as the header only, and the SDK's own payer (if configured)
        stays out of the way. ``idempotency_key`` defaults to a fresh UUID
        per call; the paying transport carries the same key on its signed
        retry, so an ambiguous response retried with this key returns the
        stored 200, never a second settlement.
        """
        if isinstance(credits, bool) or not isinstance(credits, int) or credits < 1 or credits >= 2**53:
            raise AgentToolError(
                "x402 top-up: credits must be a positive integer.",
                hint=(
                    "Ask for whole credits (1 credit = 1,000 atomic USDC = USD 0.001). The per-request "
                    "cap is published at /public/plans; larger purchases are several requests, never a "
                    "clamped one."
                ),
                error_code="top_up_invalid_credits",
            )
        headers: Dict[str, str] = {"Idempotency-Key": idempotency_key or str(uuid.uuid4())}
        if payment_signature is not None:
            headers["PAYMENT-SIGNATURE"] = payment_signature
        # `credits` is a positive int (checked above), so its decimal spelling
        # is digits only — nothing to encode, nothing to traverse with.
        url = self._base_url + "/v1/x402/top-up/" + str(credits)
        resp = self._http.post(url, headers=headers)
        if resp.status_code >= 400:
            # A bare 402 here is the challenge, intact (accepts,
            # payment_required, resource). See exceptions.py § raise_from_response.
            raise_from_response(
                resp,
                "x402 top-up",
                hint=(
                    "Without the x402= payer the SDK does not pay; the 402 carries the exact terms. "
                    "Construct AgentTool(x402=X402Payer(signer=..., policy=X402SpendPolicy(...))) "
                    "to pay it under a spend policy."
                ),
            )
        body = resp.json()
        record = body if isinstance(body, dict) else {}

        def _str(key: str) -> Optional[str]:
            value = record.get(key)
            return value if isinstance(value, str) else None

        def _int(key: str) -> Optional[int]:
            value = record.get(key)
            return value if isinstance(value, int) and not isinstance(value, bool) else None

        return X402TopUpResult(
            credits_added=_int("credits_added") if _int("credits_added") is not None else credits,
            credits_total=_int("credits_total"),
            authorization_hash=_str("authorization_hash"),
            amount_atomic=_str("amount_atomic") or str(credits * ATOMIC_PER_CREDIT),
            unit=_str("unit"),
            finality=_str("finality"),
            payment_status=_str("payment_status"),
            payment_response=_header(resp, "PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE"),
            payment_status_link=_header(resp, "Link"),
            credits_balance=_header(resp, "X-Credits-Balance"),
        )

    def payment(self, payment_id: str) -> X402PaymentStatus:
        """Read the project-scoped ledger row for a payment. ``payment_id`` is
        the server's identity — ``X402TopUpResult.authorization_hash``, the id
        inside a ``rel="payment-status"`` Link, or
        ``X402PaymentEvent.payment_id``."""
        if not isinstance(payment_id, str) or len(payment_id) == 0:
            raise AgentToolError(
                "x402 payment: a ledger payment id is required.",
                hint=(
                    "Use the authorization_hash from top_up(), the id in the rel=\"payment-status\" "
                    "Link, or X402PaymentEvent.payment_id — not the client-side authorization_hash of "
                    "the six EIP-3009 fields. Anything else answers 404 payment_not_found."
                ),
                error_code="x402_payment_id_invalid",
            )
        resp = self._http.get(f"{self._base_url}/v1/x402/payments/{_path_segment(payment_id)}")
        if resp.status_code >= 400:
            raise_from_response(
                resp,
                "x402 payment",
                fallback="payment not found",
                hint="Only payments this project signed for resolve here. A 404 means no ledger row carries that id.",
            )
        return resp.json()  # type: ignore[no-any-return]


__all__ = [
    "ATOMIC_PER_CREDIT",
    "BASE_NETWORK",
    "BASE_USDC",
    "KINGDOM_TREASURY",
    "MAX_X402_HEADER_B64_LENGTH",
    "TRANSFER_WITH_AUTHORIZATION_TYPES",
    "X402_CLIENT_REFUSAL_REASONS",
    "X402_NETWORKS",
    "X402_USDC_ASSETS",
    "X402_VERSION",
    "SignedX402Payment",
    "TransferWithAuthorizationTypedData",
    "X402Client",
    "X402ClientRefusal",
    "X402ClientRefusalReason",
    "X402PaymentRequired",
    "X402PaymentStatus",
    "X402SelectedRequirement",
    "X402SettleResponse",
    "X402Signer",
    "X402SpendPolicy",
    "X402TopUpResult",
    "X402TransferWithAuthorizationMessage",
    "X402TypedDataDomain",
    "authorization_hash",
    "checksum_evm_address",
    "decode_canonical_base64",
    "decode_payment_required_header",
    "decode_payment_response_header",
    "encode_canonical_base64_json",
    "evm_address_from_private_key",
    "hash_transfer_with_authorization",
    "is_evm_address",
    "keccak256",
    "local_evm_signer",
    "parse_payment_required_body",
    "parse_payment_requirements",
    "parse_resource_info",
    "payment_is_still_replayable",
    "recover_typed_data_address",
    "select_payable_requirement",
    "sign_exact_evm_authorization",
]
