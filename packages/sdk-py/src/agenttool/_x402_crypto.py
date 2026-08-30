"""Internal crypto for the x402 payer: Keccak-256, EIP-712, recoverable ECDSA.

Zero new dependencies, on purpose. The SDK already ships ``cryptography``
for AES-GCM and ed25519; secp256k1 ECDSA is in there too. What ``cryptography``
does NOT expose is what Ethereum needs around it, so this module supplies:

* **Keccak-256** — a pure-Python Keccak-f[1600] sponge with the ORIGINAL
  Keccak padding (``0x01 … 0x80``). ``hashlib.sha3_256`` is NOT this: SHA-3
  changed the padding byte to ``0x06`` and the two digests never agree.
  Known answers are pinned in ``tests/test_x402.py``.
* **EIP-712** — domain separator, struct hash, and the ``0x19 0x01`` digest
  for exactly one struct: USDC's ``TransferWithAuthorization`` (EIP-3009).
  The type string is spelled once, below, and hashed; it must equal the one
  the server's verifier builds from ``TRANSFER_WITH_AUTHORIZATION_TYPES`` in
  ``api/src/services/economy/x402-payments.ts``.
* **Recoverable ECDSA** — ``cryptography`` signs the 32-byte digest
  (``utils.Prehashed``), returns DER, and knows nothing about Ethereum's
  ``r‖s‖v`` encoding or low-s. Low-s normalisation and the recovery id are
  computed here; the recovery id by recovering the public key for each
  parity in pure-Python modular arithmetic on the public secp256k1 curve
  constants and comparing to the signer's own public key. The same recovery
  is what ``recover_address`` runs, so a signature this module emits is
  checked by the same code path the server's ``recoverTypedDataAddress``
  fast path uses — different implementation, same maths.

RFC 6979 deterministic nonces are requested from ``cryptography`` when the
linked OpenSSL supports them (``deterministic_signing=True``, cryptography
>= 41). On such builds the produced signature is byte-identical to viem's.
Older OpenSSL builds fall back to a random nonce; the signature still
recovers to the same payer, it just is not reproducible. ``signing_is_deterministic``
reports which mode is active so a test can decide what it may pin.

Nothing here touches the network, the clock, or the filesystem. Private key
bytes are never formatted into an error message.
"""

from __future__ import annotations

import re
from typing import Optional, Tuple, Union

from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, utils

# ── Keccak-f[1600] ────────────────────────────────────────────────────────

_MASK64 = (1 << 64) - 1
_KECCAK_ROUND_CONSTANTS = (
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
    0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
)
# Rotation offsets r[x][y], lane index = x + 5*y.
_KECCAK_ROTATIONS = (
    (0, 36, 3, 41, 18),
    (1, 44, 10, 45, 2),
    (62, 6, 43, 15, 61),
    (28, 55, 25, 21, 56),
    (27, 20, 39, 8, 14),
)
_KECCAK256_RATE = 136  # bytes; 1600 - 2*256 bits
_KECCAK256_DIGEST = 32


def _rol64(value: int, shift: int) -> int:
    shift %= 64
    if shift == 0:
        return value
    return ((value << shift) | (value >> (64 - shift))) & _MASK64


def _keccak_f1600(state: list) -> list:
    a = state
    for rc in _KECCAK_ROUND_CONSTANTS:
        # θ
        c = [a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rol64(c[(x + 1) % 5], 1) for x in range(5)]
        a = [a[i] ^ d[i % 5] for i in range(25)]
        # ρ and π
        b = [0] * 25
        for x in range(5):
            for y in range(5):
                b[y + 5 * ((2 * x + 3 * y) % 5)] = _rol64(a[x + 5 * y], _KECCAK_ROTATIONS[x][y])
        # χ
        a = [
            b[i] ^ ((~b[(i % 5 + 1) % 5 + 5 * (i // 5)] & _MASK64) & b[(i % 5 + 2) % 5 + 5 * (i // 5)])
            for i in range(25)
        ]
        # ι
        a[0] ^= rc
    return a


def keccak256(data: bytes) -> bytes:
    """Keccak-256 (Ethereum's hash), original ``0x01`` padding — not SHA-3."""
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise TypeError("keccak256 expects bytes")
    message = bytes(data)
    rate = _KECCAK256_RATE
    # pad10*1 with the Keccak domain byte 0x01
    padded = bytearray(message)
    padded.append(0x01)
    while len(padded) % rate != 0:
        padded.append(0x00)
    padded[-1] |= 0x80

    state = [0] * 25
    for offset in range(0, len(padded), rate):
        block = padded[offset : offset + rate]
        for lane in range(rate // 8):
            state[lane] ^= int.from_bytes(block[lane * 8 : lane * 8 + 8], "little")
        state = _keccak_f1600(state)

    out = bytearray()
    for lane in range(_KECCAK256_DIGEST // 8):
        out += state[lane].to_bytes(8, "little")
    return bytes(out)


# ── Addresses ─────────────────────────────────────────────────────────────

_HEX_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")


def to_checksum_address(address: str) -> str:
    """EIP-55 mixed-case checksum of a 20-byte hex address."""
    if not isinstance(address, str) or not _HEX_ADDRESS.match(address):
        raise ValueError("not a 20-byte hex address")
    lower = address[2:].lower()
    digest = keccak256(lower.encode("ascii")).hex()
    out = []
    for index, char in enumerate(lower):
        if char in "0123456789":
            out.append(char)
        elif int(digest[index], 16) >= 8:
            out.append(char.upper())
        else:
            out.append(char)
    return "0x" + "".join(out)


def is_address(value: object) -> bool:
    """viem ``isAddress`` (strict): 40 hex chars, all-lowercase or checksum-valid."""
    if not isinstance(value, str) or not _HEX_ADDRESS.match(value):
        return False
    if value.lower() == value:
        return True
    return to_checksum_address(value) == value


def _address_word(address: str) -> bytes:
    if not is_address(address):
        raise ValueError("EIP-712 address field is not a valid address")
    return bytes.fromhex(address[2:]).rjust(32, b"\x00")


# ── EIP-712 · TransferWithAuthorization ───────────────────────────────────

EIP712_DOMAIN_TYPE = (
    b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
)
TRANSFER_WITH_AUTHORIZATION_TYPE = (
    b"TransferWithAuthorization(address from,address to,uint256 value,"
    b"uint256 validAfter,uint256 validBefore,bytes32 nonce)"
)

_UINT256_MAX = (1 << 256) - 1
_BYTES32_HEX = re.compile(r"^0x[0-9a-fA-F]{64}$")


def _uint256_word(value: object, field: str) -> bytes:
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"EIP-712 uint256 field {field} must be an int")
    if value < 0 or value > _UINT256_MAX:
        raise ValueError(f"EIP-712 uint256 field {field} is out of range")
    return value.to_bytes(32, "big")


def _bytes32_word(value: object, field: str) -> bytes:
    if not isinstance(value, str) or not _BYTES32_HEX.match(value):
        raise ValueError(f"EIP-712 bytes32 field {field} must be 0x + 64 hex chars")
    return bytes.fromhex(value[2:])


def _string_word(value: object, field: str) -> bytes:
    if not isinstance(value, str):
        raise TypeError(f"EIP-712 string field {field} must be a str")
    return keccak256(value.encode("utf-8"))


def eip712_domain_separator(
    name: str, version: str, chain_id: int, verifying_contract: str
) -> bytes:
    return keccak256(
        keccak256(EIP712_DOMAIN_TYPE)
        + _string_word(name, "name")
        + _string_word(version, "version")
        + _uint256_word(chain_id, "chainId")
        + _address_word(verifying_contract)
    )


def transfer_with_authorization_struct_hash(
    *,
    from_address: str,
    to: str,
    value: int,
    valid_after: int,
    valid_before: int,
    nonce: str,
) -> bytes:
    return keccak256(
        keccak256(TRANSFER_WITH_AUTHORIZATION_TYPE)
        + _address_word(from_address)
        + _address_word(to)
        + _uint256_word(value, "value")
        + _uint256_word(valid_after, "validAfter")
        + _uint256_word(valid_before, "validBefore")
        + _bytes32_word(nonce, "nonce")
    )


def eip712_digest(domain_separator: bytes, struct_hash: bytes) -> bytes:
    return keccak256(b"\x19\x01" + domain_separator + struct_hash)


# ── secp256k1 (public curve constants) ────────────────────────────────────

SECP256K1_P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
_GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798
_GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8
_G = (_GX, _GY, 1)

_Jacobian = Optional[Tuple[int, int, int]]
Affine = Tuple[int, int]


def _jac_double(p: _Jacobian) -> _Jacobian:
    if p is None:
        return None
    x, y, z = p
    if y == 0:
        return None
    m = SECP256K1_P
    s = (4 * x * y * y) % m
    mm = (3 * x * x) % m  # a = 0 on secp256k1
    x3 = (mm * mm - 2 * s) % m
    y3 = (mm * (s - x3) - 8 * y * y * y * y) % m
    z3 = (2 * y * z) % m
    return (x3, y3, z3)


def _jac_add(p: _Jacobian, q: _Jacobian) -> _Jacobian:
    if p is None:
        return q
    if q is None:
        return p
    m = SECP256K1_P
    x1, y1, z1 = p
    x2, y2, z2 = q
    z1z1 = (z1 * z1) % m
    z2z2 = (z2 * z2) % m
    u1 = (x1 * z2z2) % m
    u2 = (x2 * z1z1) % m
    s1 = (y1 * z2 * z2z2) % m
    s2 = (y2 * z1 * z1z1) % m
    if u1 == u2:
        if s1 != s2:
            return None
        return _jac_double(p)
    h = (u2 - u1) % m
    r = (s2 - s1) % m
    h2 = (h * h) % m
    h3 = (h * h2) % m
    x3 = (r * r - h3 - 2 * u1 * h2) % m
    y3 = (r * (u1 * h2 - x3) - s1 * h3) % m
    z3 = (h * z1 * z2) % m
    return (x3, y3, z3)


def _jac_mul(k: int, p: _Jacobian) -> _Jacobian:
    k %= SECP256K1_N
    result: _Jacobian = None
    addend = p
    while k:
        if k & 1:
            result = _jac_add(result, addend)
        addend = _jac_double(addend)
        k >>= 1
    return result


def _to_affine(p: _Jacobian) -> Optional[Affine]:
    if p is None:
        return None
    x, y, z = p
    m = SECP256K1_P
    z_inv = pow(z, -1, m)
    z_inv2 = (z_inv * z_inv) % m
    return ((x * z_inv2) % m, (y * z_inv2 * z_inv) % m)


def recover_public_key(digest: bytes, r: int, s: int, recovery_id: int) -> Optional[Affine]:
    """Recover the affine public key for ``(r, s, recovery_id ∈ {0, 1})``.

    Returns ``None`` when the candidate R point does not exist on the curve
    or the recovered point is the point at infinity."""
    if len(digest) != 32:
        raise ValueError("digest must be 32 bytes")
    if recovery_id not in (0, 1):
        return None
    if not (1 <= r < SECP256K1_N and 1 <= s < SECP256K1_N):
        return None
    p = SECP256K1_P
    x = r
    if x >= p:
        return None
    alpha = (pow(x, 3, p) + 7) % p
    y = pow(alpha, (p + 1) // 4, p)
    if (y * y) % p != alpha:
        return None
    if (y & 1) != recovery_id:
        y = p - y
    e = int.from_bytes(digest, "big")
    r_inv = pow(r, -1, SECP256K1_N)
    u1 = (-e * r_inv) % SECP256K1_N
    u2 = (s * r_inv) % SECP256K1_N
    point = _jac_add(_jac_mul(u1, _G), _jac_mul(u2, (x, y, 1)))
    return _to_affine(point)


def public_key_to_address(public_key: Affine) -> str:
    x, y = public_key
    raw = keccak256(x.to_bytes(32, "big") + y.to_bytes(32, "big"))[12:]
    return to_checksum_address("0x" + raw.hex())


# ── Private keys ──────────────────────────────────────────────────────────

_PRIVATE_KEY_HEX = re.compile(r"^(?:0x)?[0-9a-fA-F]{64}$")


def private_key_bytes(private_key: Union[bytes, bytearray, str]) -> bytes:
    """Normalise a 32-byte secp256k1 private key (bytes, or hex with/without 0x).

    Error messages never include the key material."""
    if isinstance(private_key, str):
        if not _PRIVATE_KEY_HEX.match(private_key):
            raise ValueError("private key must be 32 bytes as 64 hex chars (0x optional)")
        raw = bytes.fromhex(private_key[-64:])
    elif isinstance(private_key, (bytes, bytearray, memoryview)):
        raw = bytes(private_key)
        if len(raw) != 32:
            raise ValueError("private key must be exactly 32 bytes")
    else:
        raise TypeError("private key must be bytes or a hex string")
    scalar = int.from_bytes(raw, "big")
    if not (1 <= scalar < SECP256K1_N):
        raise ValueError("private key scalar is outside the secp256k1 group order")
    return raw


def _private_key_object(raw: bytes) -> ec.EllipticCurvePrivateKey:
    return ec.derive_private_key(int.from_bytes(raw, "big"), ec.SECP256K1())


def public_key_from_private_key(private_key: Union[bytes, bytearray, str]) -> Affine:
    key = _private_key_object(private_key_bytes(private_key))
    numbers = key.public_key().public_numbers()
    return (numbers.x, numbers.y)


def address_from_private_key(private_key: Union[bytes, bytearray, str]) -> str:
    return public_key_to_address(public_key_from_private_key(private_key))


# ── Recoverable ECDSA ─────────────────────────────────────────────────────

_deterministic: Optional[bool] = None


def _sign_der(key: ec.EllipticCurvePrivateKey, digest: bytes) -> bytes:
    """DER ECDSA over a prehashed 32-byte digest; RFC 6979 when available."""
    global _deterministic
    if _deterministic is not False:
        try:
            algorithm = ec.ECDSA(utils.Prehashed(hashes.SHA256()), deterministic_signing=True)
            der = key.sign(digest, algorithm)
        except (TypeError, UnsupportedAlgorithm, ValueError):
            # cryptography < 41 (no keyword) or an OpenSSL without RFC 6979.
            _deterministic = False
        else:
            _deterministic = True
            return der
    return key.sign(digest, ec.ECDSA(utils.Prehashed(hashes.SHA256())))


def signing_is_deterministic() -> bool:
    """True when ``cryptography`` signs with RFC 6979 nonces on this build.

    Probes once with a throwaway key; the answer is cached."""
    if _deterministic is None:
        _sign_der(_private_key_object((1).to_bytes(32, "big")), b"\x00" * 32)
    return bool(_deterministic)


def sign_recoverable(digest: bytes, private_key: Union[bytes, bytearray, str]) -> bytes:
    """Sign a 32-byte digest → 65 bytes ``r‖s‖v`` (``v`` ∈ {27, 28}), low-s.

    The recovery id is found by recovering the public key for each parity
    and comparing to the signer's own; there is no guessing."""
    if not isinstance(digest, (bytes, bytearray, memoryview)) or len(digest) != 32:
        raise ValueError("digest must be exactly 32 bytes")
    digest = bytes(digest)
    raw = private_key_bytes(private_key)
    key = _private_key_object(raw)
    r, s = utils.decode_dss_signature(_sign_der(key, digest))
    if s > SECP256K1_N // 2:
        s = SECP256K1_N - s
    numbers = key.public_key().public_numbers()
    expected = (numbers.x, numbers.y)
    for recovery_id in (0, 1):
        if recover_public_key(digest, r, s, recovery_id) == expected:
            return r.to_bytes(32, "big") + s.to_bytes(32, "big") + bytes([27 + recovery_id])
    raise RuntimeError("secp256k1 signature did not recover to its own public key")


def signature_to_hex(signature: bytes) -> str:
    return "0x" + signature.hex()


def signature_from_hex(signature: str) -> Optional[bytes]:
    if not isinstance(signature, str) or not re.match(r"^0x[0-9a-fA-F]{130}$", signature):
        return None
    return bytes.fromhex(signature[2:])


def is_low_s(signature: bytes) -> bool:
    if len(signature) != 65:
        return False
    s = int.from_bytes(signature[32:64], "big")
    return 1 <= s <= SECP256K1_N // 2


def recover_address(digest: bytes, signature: Union[bytes, str]) -> Optional[str]:
    """Checksummed address that produced ``signature`` over ``digest``, or ``None``.

    Accepts ``v`` as 27/28 or 0/1. Same recovery the server's offline fast path
    performs via ``recoverTypedDataAddress``."""
    raw = signature_from_hex(signature) if isinstance(signature, str) else bytes(signature)
    if raw is None or len(raw) != 65:
        return None
    r = int.from_bytes(raw[0:32], "big")
    s = int.from_bytes(raw[32:64], "big")
    v = raw[64]
    if v in (27, 28):
        recovery_id = v - 27
    elif v in (0, 1):
        recovery_id = v
    else:
        return None
    point = recover_public_key(bytes(digest), r, s, recovery_id)
    if point is None:
        return None
    return public_key_to_address(point)
