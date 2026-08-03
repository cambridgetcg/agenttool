"""Attestation marketplace — willingness-to-attest, sold.

Templates publish a voice. Listings publish a callable. An **attestation
listing publishes a willingness-to-attest**: an attester offers to review
evidence and, if satisfied, sign one specific class of claim at a price. A
buyer purchases a *grant* against a subject identity; the attester reviews,
asks for the exact short-lived digest, signs it, and delivers. Settlement
writes a row in ``identity.attestations`` and releases escrow with the
take-rate split.

What is being sold is **review and issuance**, not trust. Payment proves
settlement and the signature proves which key made the claim; neither proves
the claim is true, that the issuer is accredited, or that any relying agent
should believe it. The legacy identity trust field stays neutral at ``0``.

Two signatures could be confused here and they are NOT interchangeable:

- ``identity-attestation/v1`` (identity.py) is an ordinary unpaid attestation.
  It names no grant and authorizes no payment.
- ``attestation-issue/v1`` (here) additionally binds one grant, one escrow,
  the buyer/subject/attester identities and DIDs, both wallets, the active
  signing key, the deterministic evidence hash, the current fee split, and
  both expiry terms. Only this authorizes money to move.

The attester therefore must never sign the server's ``signed_payload_b64``
blindly. :meth:`AttestationMarketplaceClient.signing_payload` recomputes the
digest from the named ``fields`` the server returned and refuses if the two
disagree, so what gets signed is what the attester can read. And because
``evidence_sha256`` is the one field that says *what was reviewed*,
:func:`attestation_evidence_sha256` lets the attester tie that hash back to the
evidence body on the grant row before signing.

Walls the server holds (surfaced here as refusal codes):

- ``self_purchase_not_allowed`` — the buyer cannot be the listing's attester.
  Buyer may equal subject; attester may equal subject.
- ``not_listing_owner`` (403) — only the listing's project may issue or
  decline; only the buyer's project may cancel.
- ``signature_invalid`` / ``signing_key_revoked`` /
  ``signing_key_does_not_belong_to_attester`` (401).
- ``attestation_replay`` (409) — an exact signature is single-use.
- ``grant_sla_expired``, ``grant_state_invalid: status=…``,
  ``*_terms_changed`` (409) — the bound terms drifted before settlement.
- ``insufficient_balance`` (402) on purchase. No partial payments.

Doctrine: docs/MARKETPLACE.md §"Attestation marketplace" ·
docs/CANONICAL-BYTES.md §attestation-issue/v1.
"""

from __future__ import annotations

import base64
import hashlib
import math
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional, Sequence
from urllib.parse import urlencode

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from ._url import _path_segment
from .exceptions import AgentToolError, raise_from_response


#: Domain tag. Byte-identical to the API service's constant.
ATTESTATION_ISSUE_SIGNATURE_CONTEXT = "attestation-issue/v1"

#: The authorization the server prepares lives five minutes. Pinned so a
#: caller can reason about the window without a round trip.
ATTESTATION_ISSUE_AUTHORIZATION_TTL_SECONDS = 5 * 60

#: Wire order is part of the v1 contract. It changes only with a new context.
ATTESTATION_ISSUE_FIELD_ORDER = (
    "listing_id",
    "grant_id",
    "escrow_id",
    "buyer_identity_id",
    "buyer_did",
    "buyer_project_id",
    "buyer_wallet_id",
    "subject_identity_id",
    "subject_did",
    "attester_identity_id",
    "attester_did",
    "attester_project_id",
    "signing_key_id",
    "claim",
    "evidence_sha256",
    "attester_wallet_id",
    "grant_gross",
    "grant_currency",
    "take_rate_bps",
    "platform_fee",
    "attester_net",
    "validity_seconds",
    "attestation_expires_at",
    "authorization_expires_at",
)

#: The UUID-shaped slots. The server matches lowercase hex only.
_UUID_FIELDS = (
    "listing_id",
    "grant_id",
    "escrow_id",
    "buyer_identity_id",
    "buyer_project_id",
    "buyer_wallet_id",
    "subject_identity_id",
    "attester_identity_id",
    "attester_project_id",
    "signing_key_id",
    "attester_wallet_id",
)

#: Free-form text slots. Non-empty, and no NUL — 0x00 is the delimiter.
_TEXT_FIELDS = (
    "buyer_did",
    "subject_did",
    "attester_did",
    "claim",
    "grant_currency",
)

_AMOUNT_FIELDS = ("grant_gross", "take_rate_bps", "platform_fee", "attester_net")

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
#: The exact spelling ``Date.prototype.toISOString`` produces. The server
#: compares against it, so anything else is not canonical.
_CANONICAL_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")

#: JavaScript's ``Number.MAX_SAFE_INTEGER``. Beyond it the two runtimes would
#: not even agree on the decimal spelling of the same value.
_MAX_SAFE_INTEGER = 9007199254740991


def _invalid(message: str) -> AgentToolError:
    return AgentToolError(message, code="signing_payload_invalid")


def _canonical_field_value(fields: Mapping[str, Any], name: str) -> str:
    """Render one field exactly as the server's ``canonicalFieldValue`` does.

    ``null`` becomes the literal text ``"null"``; everything else is
    stringified.

    The server renders whatever it is handed, because its own callers are
    typed rows. A hand-built dict can be missing a field or carry a boolean,
    and JavaScript's ``String(undefined)`` would quietly sign the text
    ``"undefined"``. Refusing keeps the two SDKs from disagreeing about
    malformed input, which is the only place they could still drift.
    """
    if name not in fields:
        raise _invalid(f"attestation-issue signed field {name} is required")
    value = fields[name]
    if value is None:
        return "null"
    if isinstance(value, bool):
        # JavaScript String(true) is "true"; Python str(True) is "True".
        # No v1 field is boolean, so refuse rather than diverge silently.
        raise _invalid(f"attestation-issue signed field {name} must not be a boolean")
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        return value
    raise _invalid(
        f"attestation-issue signed field {name} must be a string, integer, or null"
    )


def _is_canonical_iso(value: Any) -> bool:
    if not isinstance(value, str) or not _CANONICAL_ISO.match(value):
        return False
    try:
        # Rejects impossible calendar dates the regex alone would let through
        # (2026-02-30), exactly as `new Date(x).toISOString() !== x` does.
        datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return False
    return True


def _assert_canonical_fields(fields: Mapping[str, Any]) -> None:
    """The server's ``validateFields``, re-stated. Every guard is the server's."""
    for name in ATTESTATION_ISSUE_FIELD_ORDER:
        # Reading every slot first is what turns a missing field into a named
        # refusal instead of a silently different digest.
        _canonical_field_value(fields, name)
    for name in _UUID_FIELDS:
        value = fields[name]
        if not isinstance(value, str) or not _UUID_RE.match(value):
            raise _invalid(f"{name} must be a lowercase UUID")
    for name in _TEXT_FIELDS:
        value = fields[name]
        if not isinstance(value, str) or value == "":
            raise _invalid(f"{name} must be a non-empty string")
        if "\0" in value:
            raise _invalid(
                f"attestation-issue signed field {name} must not contain NUL"
            )
    evidence_sha = fields["evidence_sha256"]
    if not isinstance(evidence_sha, str) or not _HEX64.match(evidence_sha):
        raise _invalid("evidence_sha256 must be 64 lowercase hex characters")
    for name in _AMOUNT_FIELDS:
        value = fields[name]
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise _invalid(f"{name} must be a non-negative safe integer")
        if value > _MAX_SAFE_INTEGER:
            raise _invalid(f"{name} must be a non-negative safe integer")
    if fields["take_rate_bps"] > 10_000:
        raise _invalid("take_rate_bps must be at most 10000")
    if fields["platform_fee"] + fields["attester_net"] != fields["grant_gross"]:
        raise _invalid("platform_fee + attester_net must equal grant_gross")
    validity = fields["validity_seconds"]
    if validity is not None:
        if (
            isinstance(validity, bool)
            or not isinstance(validity, int)
            or validity <= 0
            or validity > _MAX_SAFE_INTEGER
        ):
            raise _invalid("validity_seconds must be null or a positive safe integer")
    expiry = fields["attestation_expires_at"]
    if (validity is None) != (expiry is None):
        raise _invalid("validity_seconds and attestation_expires_at must be null together")
    if expiry is not None and not _is_canonical_iso(expiry):
        raise _invalid("attestation_expires_at must be canonical ISO-8601 UTC")
    if not _is_canonical_iso(fields["authorization_expires_at"]):
        raise _invalid("authorization_expires_at must be canonical ISO-8601 UTC")


def canonical_attestation_issue_bytes(fields: Mapping[str, Any]) -> bytes:
    """Return the 32-byte digest a paid attestation issuance covers.

    ``sha256(utf8("attestation-issue/v1") || 0x00 || utf8(field_1) || …)``

    Byte-identical to
    ``api/src/services/marketplace/attestation-issue-sig.ts#canonicalAttestationIssueBytes``.
    The field guards are the server's guards: a non-lowercase-UUID identifier,
    an empty or NUL-bearing text field, a malformed evidence hash, a negative
    or unsafe amount, a rate above 100%, a fee split that does not add up, a
    validity/expiry pair that disagrees about nullness, or a non-canonical
    timestamp all refuse here exactly as they refuse there.
    """
    _assert_canonical_fields(fields)
    joined = ATTESTATION_ISSUE_SIGNATURE_CONTEXT.encode("utf-8")
    for name in ATTESTATION_ISSUE_FIELD_ORDER:
        joined += b"\x00" + _canonical_field_value(fields, name).encode("utf-8")
    return hashlib.sha256(joined).digest()


# ── The evidence hash ────────────────────────────────────────────────────
#
# The server spells canonical evidence with `JSON.stringify`. Python's `json`
# module agrees on most of it and disagrees in exactly three places, each of
# which would silently produce a different `evidence_sha256`:
#
#   1. key order — JS `Array.prototype.sort` orders by UTF-16 code unit,
#      Python `sorted` by code point. They disagree the moment a key is
#      astral (U+FFFD sorts BEFORE U+1F600 by code point and AFTER by code
#      unit).
#   2. numbers — `json.dumps(1.0)` is "1.0" but `String(1)` is "1", and
#      `repr(1e-7)` is "1e-07" against JavaScript's "1e-7".
#   3. lone surrogates — JS escapes them, Python raises on encode.
#
# So the rendering below is written against the ECMAScript spelling rather
# than delegating to `json.dumps`. The server stays normative.


def _utf16_sort_key(value: str) -> bytes:
    """Order strings the way JavaScript's `Array.prototype.sort` does.

    Comparing big-endian UTF-16 bytes lexicographically is exactly comparing
    UTF-16 code-unit sequences, because every unit is two bytes.
    """
    return value.encode("utf-16-be", errors="surrogatepass")


_JS_STRING_ESCAPES = {
    '"': '\\"',
    "\\": "\\\\",
    "\b": "\\b",
    "\f": "\\f",
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
}


def _js_json_string(value: str) -> str:
    """`JSON.stringify` of a string, character for character."""
    out = ['"']
    for char in value:
        escape = _JS_STRING_ESCAPES.get(char)
        if escape is not None:
            out.append(escape)
            continue
        code = ord(char)
        # Control characters, and lone surrogates (a paired surrogate is one
        # code point in Python and so never lands in this range).
        if code < 0x20 or 0xD800 <= code <= 0xDFFF:
            out.append("\\u%04x" % code)
            continue
        out.append(char)
    out.append('"')
    return "".join(out)


def _js_number(value: float) -> str:
    """ECMAScript ``Number::toString(10)``, which is what `JSON.stringify` uses.

    Python's ``repr`` already gives the shortest round-tripping decimal; only
    the *presentation* rules differ, so this re-normalizes those: no trailing
    ``.0``, exponential form outside ``[1e-6, 1e21)``, and an exponent written
    without zero padding.
    """
    if math.isnan(value) or math.isinf(value):
        raise _invalid("evidence_not_json: a non-finite number has no JSON form")
    if value == 0:
        return "0"  # JavaScript renders -0 as "0" too.
    sign = "-" if value < 0 else ""
    text = repr(abs(value))
    if "e" in text or "E" in text:
        mantissa, _, exponent_text = text.replace("E", "e").partition("e")
        exponent = int(exponent_text)
    else:
        mantissa, exponent = text, 0
    integer_part, _, fraction = mantissa.partition(".")
    combined = integer_part + fraction
    stripped = combined.lstrip("0")
    # value == 0.<digits> * 10**n
    n = len(integer_part) + exponent - (len(combined) - len(stripped))
    digits = stripped.rstrip("0") or "0"
    k = len(digits)

    if k <= n <= 21:
        return sign + digits + "0" * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + digits
    exponent_value = n - 1
    exponent_sign = "+" if exponent_value >= 0 else "-"
    body = digits if k == 1 else digits[0] + "." + digits[1:]
    return sign + body + "e" + exponent_sign + str(abs(exponent_value))


def canonical_attestation_evidence_json(value: Any) -> str:
    """Sorted-key, no-whitespace JSON — the exact spelling the server hashes.

    Byte-identical to
    ``api/src/services/marketplace/attestation-issue-sig.ts#canonicalAttestationEvidenceJson``.
    Anything that is not JSON — a non-finite float, a set, a datetime, an
    integer JavaScript could not hold exactly — is refused rather than
    coerced, because a coerced evidence body would hash to something the
    attester never read.
    """
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return _js_json_string(value)
    if isinstance(value, int):
        # JavaScript has no integers beyond 2**53 - 1; a bigger one would have
        # reached the server as a rounded double, so there is no honest
        # canonical form for it here.
        if abs(value) > _MAX_SAFE_INTEGER:
            raise _invalid(
                "evidence_not_json: an integer outside the safe range has no "
                "single cross-language JSON spelling"
            )
        return str(value)
    if isinstance(value, float):
        return _js_number(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical_attestation_evidence_json(x) for x in value) + "]"
    if isinstance(value, dict):
        parts = []
        for key in sorted(value.keys(), key=_utf16_sort_key):
            if not isinstance(key, str):
                raise _invalid("evidence_not_json: object keys must be strings")
            parts.append(
                _js_json_string(key)
                + ":"
                + canonical_attestation_evidence_json(value[key])
            )
        return "{" + ",".join(parts) + "}"
    raise _invalid("evidence_not_json")


def attestation_evidence_sha256(value: Any) -> str:
    """The ``evidence_sha256`` the server binds into the digest.

    Read the grant's ``evidence`` and pass it here. If the result does not
    equal the ``evidence_sha256`` in the signing payload, the terms describe a
    review of something other than what you read — do not sign. A grant with
    no evidence hashes ``null``, which is a real value and not an absence.
    """
    return hashlib.sha256(
        canonical_attestation_evidence_json(value).encode("utf-8")
    ).hexdigest()


def sign_attestation_issue(
    *,
    fields: Mapping[str, Any],
    signing_key: bytes,
) -> str:
    """Sign a paid attestation issuance.

    Args:
        fields: The exact ``attestation-issue/v1`` terms being authorized.
        signing_key: The attester's 32-byte ed25519 seed for
            ``signing_key_id``.

    Returns:
        Base64 signature (64 raw bytes encoded) — the exact spelling
        ``POST /:id/issue`` accepts in its ``signature`` field.
    """
    if not isinstance(signing_key, (bytes, bytearray)) or len(signing_key) != 32:
        raise AgentToolError(
            "sign_attestation_issue: signing_key must be a 32-byte ed25519 seed."
        )
    signature = Ed25519PrivateKey.from_private_bytes(bytes(signing_key)).sign(
        canonical_attestation_issue_bytes(fields)
    )
    return base64.b64encode(signature).decode("ascii")


_PATCH_LISTING_KEYS = (
    "name",
    "description",
    "capability_tags",
    "evidence_schema",
    "price_amount",
    "price_currency",
    "attester_wallet_id",
    "validity_seconds",
    "sla_seconds",
    "visibility",
    "status",
    "metadata",
)

#: Sentinel for "the caller said nothing", so that an explicit ``None`` can
#: still be transmitted as a JSON null on the nullable listing fields.
_UNSET: Any = object()


class AttestationMarketplaceClient:
    """Client for ``/v1/attestation-listings`` and ``/v1/attestation-grants``.

    Usage::

        # Attester side: review, verify the terms, sign, issue.
        payload = at.attestation_marketplace.signing_payload(
            grant_id, signing_key_id=key_id
        )
        view = at.attestation_marketplace.get_grant(grant_id)
        # The one field that says WHAT you reviewed — check it yourself.
        assert attestation_evidence_sha256(
            view["grant"].get("evidence")
        ) == payload["fields"]["evidence_sha256"]
        at.attestation_marketplace.issue(
            grant_id,
            signature=sign_attestation_issue(
                fields=payload["fields"], signing_key=attester_seed
            ),
            signing_key_id=key_id,
            authorization_expires_at=payload["authorization_expires_at"],
        )
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    # ── listings ─────────────────────────────────────────────────────────

    def create_listing(
        self,
        *,
        attester_identity_id: str,
        name: str,
        claim: str,
        price_amount: int,
        price_currency: str,
        attester_wallet_id: str,
        description: Any = _UNSET,
        capability_tags: Optional[Sequence[str]] = None,
        evidence_schema: Any = _UNSET,
        validity_seconds: Any = _UNSET,
        sla_seconds: Any = _UNSET,
        visibility: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Publish a willingness-to-attest listing.

        The attester identity and wallet must be active, owned by this
        project, and share the listing's currency.
        """
        body: Dict[str, Any] = {
            "attester_identity_id": attester_identity_id,
            "name": name,
            "claim": claim,
            "price_amount": price_amount,
            "price_currency": price_currency,
            "attester_wallet_id": attester_wallet_id,
        }
        if description is not _UNSET:
            body["description"] = description
        if capability_tags is not None:
            body["capability_tags"] = list(capability_tags)
        if evidence_schema is not _UNSET:
            body["evidence_schema"] = evidence_schema
        if validity_seconds is not _UNSET:
            body["validity_seconds"] = validity_seconds
        if sla_seconds is not _UNSET:
            body["sla_seconds"] = sla_seconds
        if visibility is not None:
            body["visibility"] = visibility
        if metadata is not None:
            body["metadata"] = metadata
        return self._send(
            "POST",
            "/v1/attestation-listings",
            payload=body,
            operation="attestation_marketplace.create_listing",
        )["listing"]

    def list_listings(
        self,
        *,
        attester_id: Optional[str] = None,
        claim: Optional[str] = None,
        status: Optional[str] = None,
        mine: bool = False,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Browse the shelf.

        Default: this project's rows plus other projects' public ones.
        ``mine=True`` narrows to a strictly owned management view. A private
        listing looks absent from outside its project; that is the intended
        answer, not an error.
        """
        query: List[tuple] = []
        if attester_id is not None:
            query.append(("attester_id", attester_id))
        if claim is not None:
            query.append(("claim", claim))
        if status is not None:
            query.append(("status", status))
        if mine:
            query.append(("mine", "true"))
        if limit is not None:
            query.append(("limit", str(limit)))
        suffix = f"?{urlencode(query)}" if query else ""
        return self._send(
            "GET",
            f"/v1/attestation-listings{suffix}",
            operation="attestation_marketplace.list_listings",
        )["listings"]

    def get_listing(self, listing_id: str) -> Dict[str, Any]:
        """Read one listing. 404 when it is private and not yours."""
        return self._send(
            "GET",
            f"/v1/attestation-listings/{_path_segment(listing_id)}",
            operation="attestation_marketplace.get_listing",
        )["listing"]

    def patch_listing(
        self,
        listing_id: str,
        *,
        name: Any = _UNSET,
        description: Any = _UNSET,
        capability_tags: Any = _UNSET,
        evidence_schema: Any = _UNSET,
        price_amount: Any = _UNSET,
        price_currency: Any = _UNSET,
        attester_wallet_id: Any = _UNSET,
        validity_seconds: Any = _UNSET,
        sla_seconds: Any = _UNSET,
        visibility: Any = _UNSET,
        status: Any = _UNSET,
        metadata: Any = _UNSET,
    ) -> Dict[str, Any]:
        """Amend your own listing.

        Only the keys you pass are touched; the price, claim wording, and
        payout wallet of already-purchased grants are frozen in those grants'
        own signed terms.
        """
        supplied = {
            "name": name,
            "description": description,
            "capability_tags": capability_tags,
            "evidence_schema": evidence_schema,
            "price_amount": price_amount,
            "price_currency": price_currency,
            "attester_wallet_id": attester_wallet_id,
            "validity_seconds": validity_seconds,
            "sla_seconds": sla_seconds,
            "visibility": visibility,
            "status": status,
            "metadata": metadata,
        }
        body = {
            key: supplied[key]
            for key in _PATCH_LISTING_KEYS
            if supplied[key] is not _UNSET
        }
        return self._send(
            "PATCH",
            f"/v1/attestation-listings/{_path_segment(listing_id)}",
            payload=body,
            operation="attestation_marketplace.patch_listing",
        )["listing"]

    def purchase(
        self,
        listing_id: str,
        *,
        buyer_identity_id: str,
        buyer_wallet_id: str,
        subject_identity_id: str,
        evidence: Any = _UNSET,
    ) -> Dict[str, Any]:
        """Buy a grant against an active public listing.

        This is the ONLY mounted grant-creation operation —
        ``POST /v1/attestation-grants`` does not exist. Atomically debits the
        buyer wallet and funds escrow.

        Refused with ``self_purchase_not_allowed`` when the buyer is the
        listing's attester, and with ``insufficient_balance`` (402) when the
        wallet cannot cover the gross.
        """
        body: Dict[str, Any] = {
            "buyer_identity_id": buyer_identity_id,
            "buyer_wallet_id": buyer_wallet_id,
            "subject_identity_id": subject_identity_id,
        }
        if evidence is not _UNSET:
            body["evidence"] = evidence
        return self._send(
            "POST",
            f"/v1/attestation-listings/{_path_segment(listing_id)}/purchase",
            payload=body,
            operation="attestation_marketplace.purchase",
        )["grant"]

    # ── grants ───────────────────────────────────────────────────────────

    def list_grants(
        self,
        *,
        role: str = "buyer",
        status: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """List grants, scoped to the role you hold in them.

        Defaults to ``buyer``; ``attester`` is the issuance queue.
        """
        query: List[tuple] = [("role", role)]
        if status is not None:
            query.append(("status", status))
        if limit is not None:
            query.append(("limit", str(limit)))
        return self._send(
            "GET",
            f"/v1/attestation-grants?{urlencode(query)}",
            operation="attestation_marketplace.list_grants",
        )["grants"]

    def get_grant(self, grant_id: str) -> Dict[str, Any]:
        """Read one grant and the role you hold in it.

        The server tries buyer scope first, then attester scope, and 404s if
        you are neither — so the returned ``role`` is the server's answer, not
        an echo of your request.

        Returns:
            ``{"grant": {...}, "role": "buyer" | "attester"}``.
        """
        body = self._send(
            "GET",
            f"/v1/attestation-grants/{_path_segment(grant_id)}",
            operation="attestation_marketplace.get_grant",
        )
        return {"grant": body["grant"], "role": body["role"]}

    def signing_payload(
        self,
        grant_id: str,
        *,
        signing_key_id: str,
    ) -> Dict[str, Any]:
        """Ask for the exact short-lived terms to authorize issuance.

        The response's ``fields`` are the readable terms; ``signed_payload_b64``
        is their digest. This method recomputes the digest locally from those
        fields and REFUSES if the two disagree, so an attester never signs a
        blob whose meaning it did not derive itself. That check is the whole
        reason the canonical bytes live in the SDK rather than only on the
        server.

        The authorization lives five minutes. Sign and submit within it.

        Raises:
            AgentToolError: ``signing_payload_mismatch`` when the server's
                digest does not equal the digest of the terms it printed
                alongside it.
        """
        payload = self._send(
            "POST",
            f"/v1/attestation-grants/{_path_segment(grant_id)}/signing-payload",
            payload={"signing_key_id": signing_key_id},
            operation="attestation_marketplace.signing_payload",
        )["signing_payload"]
        recomputed = base64.b64encode(
            canonical_attestation_issue_bytes(payload["fields"])
        ).decode("ascii")
        if recomputed != payload["signed_payload_b64"]:
            raise AgentToolError(
                "attestation_marketplace.signing_payload: the digest the "
                "server asked for does not match the terms it printed.",
                code="signing_payload_mismatch",
                hint=(
                    "Do not sign this payload. Re-read the grant, and treat "
                    "the mismatch as a wire or version disagreement about "
                    "attestation-issue/v1."
                ),
                details={
                    "server_signed_payload_b64": payload["signed_payload_b64"],
                    "recomputed_signed_payload_b64": recomputed,
                },
                docs="https://docs.agenttool.dev/MARKETPLACE.md",
            )
        return payload

    def issue(
        self,
        grant_id: str,
        *,
        signature: str,
        signing_key_id: str,
        authorization_expires_at: str,
    ) -> Dict[str, Any]:
        """Submit the attester's authorization and settle the grant.

        The server relocks and rechecks every bound term, recomputes the
        current fee split and evidence hash, verifies the signature against
        ``attestation-issue/v1``, writes the ``identity.attestations``
        receipt, credits the attester the net, releases the bound escrow, and
        records the take-rate. There is no legacy fallback signature shape.

        Unlike memory-witness issuance, nothing here mutates a project's
        constitution, so this route takes no root authority proof.

        Args:
            grant_id: The grant being settled.
            signature: Base64 ed25519 over
                :func:`canonical_attestation_issue_bytes`.
            signing_key_id: The attester key that produced it.
            authorization_expires_at: Echo the payload's expiry exactly; it is
                inside the signed bytes and the server rechecks the binding.
        """
        return self._send(
            "POST",
            f"/v1/attestation-grants/{_path_segment(grant_id)}/issue",
            payload={
                "signature": signature,
                "signing_key_id": signing_key_id,
                "authorization_expires_at": authorization_expires_at,
            },
            operation="attestation_marketplace.issue",
        )["grant"]

    def decline(self, grant_id: str) -> Dict[str, Any]:
        """Refuse a grant as its attester.

        Declining is always available: no attester is obliged to sign
        anything. The buyer is refunded in full and the platform earns no fee.
        """
        return self._send(
            "POST",
            f"/v1/attestation-grants/{_path_segment(grant_id)}/decline",
            operation="attestation_marketplace.decline",
        )["grant"]

    def cancel(self, grant_id: str) -> Dict[str, Any]:
        """Withdraw a grant as its buyer, while it is still ``pending``.

        Once the attester issues, the claim is signed and the window is
        closed.
        """
        return self._send(
            "POST",
            f"/v1/attestation-grants/{_path_segment(grant_id)}/cancel",
            operation="attestation_marketplace.cancel",
        )["grant"]

    # ── internal ─────────────────────────────────────────────────────────

    def _send(
        self,
        method: str,
        path: str,
        *,
        payload: Optional[Dict[str, Any]] = None,
        operation: str,
    ) -> Dict[str, Any]:
        """Send one request whose serialized bytes are the transmitted bytes."""
        url = f"{self._base}{path}"
        send = getattr(self._http, method.lower())
        resp = send(url) if payload is None else send(url, json=payload)
        if resp.status_code >= 400:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, operation)
        return resp.json()
