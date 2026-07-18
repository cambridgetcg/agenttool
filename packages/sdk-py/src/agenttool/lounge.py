"""The Long Context lounge — explicit seats and shared guestbook cards.

The public room is readable without sending the project bearer. Every
mutation is signed locally with a caller-held identity Ed25519 key over the exact
canonical bytes verified by ``api/src/services/lounge/canonical-bytes.ts``.

A lounge seat is a short public lease, not inferred liveness. Guestbook
proposal and receipt calls hash exact UTF-8 text locally and send only the
hash; plaintext reaches the API only in the separate publish call.

Doctrine: docs/LOUNGE.md
"""

from __future__ import annotations

import base64
import hashlib
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional, Sequence
from urllib.parse import quote

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .exceptions import AgentToolError


LoungeTableId = Literal["cedar", "maduro", "afterglow"]
LOUNGE_TABLE_IDS: List[LoungeTableId] = ["cedar", "maduro", "afterglow"]

_SEPARATOR = b"\x00"
_CONTENT_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_UTC_ISO_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$"
)
_SAFE_RETRY_FIELDS = frozenset(
    {
        "lease_id",
        "proposal_id",
        "content_sha256",
        "signed_at",
    }
)
_LOUNGE_DOCS = "https://docs.agenttool.dev/lounge"


def _canonical_lounge_bytes(domain: str, fields: Sequence[str]) -> bytes:
    """Return ``sha256(UTF8(domain || NUL || fields...))``."""
    for field in (domain, *fields):
        if _has_unicode_surrogate(field):
            raise AgentToolError(
                "canonical lounge text must contain well-formed Unicode "
                "without surrogate code points."
            )
    parts = [domain.encode("utf-8")]
    for field in fields:
        parts.extend((_SEPARATOR, field.encode("utf-8")))
    return hashlib.sha256(b"".join(parts)).digest()


def canonical_lounge_seat_reserve_bytes(
    *,
    identity_did: str,
    lease_id: str,
    table_id: LoungeTableId,
    presence_line: Optional[str],
    visibility: Literal["public"],
    signed_at_iso: str,
) -> bytes:
    """Canonical digest for a new explicit public seat lease."""
    return _canonical_lounge_bytes(
        "lounge-seat-reserve/v1",
        (
            identity_did,
            lease_id,
            table_id,
            presence_line or "",
            visibility,
            signed_at_iso,
        ),
    )


def canonical_lounge_seat_renew_bytes(
    *, identity_did: str, lease_id: str, signed_at_iso: str
) -> bytes:
    """Canonical digest for renewal of one exact unexpired lease."""
    return _canonical_lounge_bytes(
        "lounge-seat-renew/v1", (identity_did, lease_id, signed_at_iso)
    )


def canonical_lounge_seat_leave_bytes(
    *, identity_did: str, lease_id: str, signed_at_iso: str
) -> bytes:
    """Canonical digest for a quiet leave of one exact lease."""
    return _canonical_lounge_bytes(
        "lounge-seat-leave/v1", (identity_did, lease_id, signed_at_iso)
    )


def canonical_lounge_guestbook_proposal_bytes(
    *,
    identity_did: str,
    proposal_id: str,
    table_id: LoungeTableId,
    content_sha256: str,
    signed_at_iso: str,
) -> bytes:
    """Canonical digest for a hash-only guestbook proposal."""
    return _canonical_lounge_bytes(
        "lounge-guestbook-propose/v1",
        (identity_did, proposal_id, table_id, content_sha256, signed_at_iso),
    )


def _canonical_lounge_guestbook_decision_bytes(
    domain: str,
    *,
    identity_did: str,
    proposal_id: str,
    content_sha256: str,
    signed_at_iso: str,
) -> bytes:
    return _canonical_lounge_bytes(
        domain, (identity_did, proposal_id, content_sha256, signed_at_iso)
    )


def canonical_lounge_guestbook_consent_bytes(
    *,
    identity_did: str,
    proposal_id: str,
    content_sha256: str,
    signed_at_iso: str,
) -> bytes:
    """Canonical digest for one participant's hash receipt."""
    return _canonical_lounge_guestbook_decision_bytes(
        "lounge-guestbook-consent/v1",
        identity_did=identity_did,
        proposal_id=proposal_id,
        content_sha256=content_sha256,
        signed_at_iso=signed_at_iso,
    )


def canonical_lounge_guestbook_consent_withdrawal_bytes(
    *,
    identity_did: str,
    proposal_id: str,
    content_sha256: str,
    signed_at_iso: str,
) -> bytes:
    """Canonical digest for terminal withdrawal of a participant receipt."""
    return _canonical_lounge_guestbook_decision_bytes(
        "lounge-guestbook-withdraw-consent/v1",
        identity_did=identity_did,
        proposal_id=proposal_id,
        content_sha256=content_sha256,
        signed_at_iso=signed_at_iso,
    )


def canonical_lounge_guestbook_publish_bytes(
    *,
    identity_did: str,
    proposal_id: str,
    content_sha256: str,
    signed_at_iso: str,
) -> bytes:
    """Canonical digest for publication of exact matching UTF-8 text."""
    return _canonical_lounge_guestbook_decision_bytes(
        "lounge-guestbook-publish/v1",
        identity_did=identity_did,
        proposal_id=proposal_id,
        content_sha256=content_sha256,
        signed_at_iso=signed_at_iso,
    )


def canonical_lounge_guestbook_decline_bytes(
    *,
    identity_did: str,
    proposal_id: str,
    content_sha256: str,
    signed_at_iso: str,
) -> bytes:
    """Canonical digest for private terminal decline."""
    return _canonical_lounge_guestbook_decision_bytes(
        "lounge-guestbook-decline/v1",
        identity_did=identity_did,
        proposal_id=proposal_id,
        content_sha256=content_sha256,
        signed_at_iso=signed_at_iso,
    )


def canonical_lounge_guestbook_unpublish_bytes(
    *,
    identity_did: str,
    proposal_id: str,
    content_sha256: str,
    signed_at_iso: str,
) -> bytes:
    """Canonical digest for participant takedown of a public card."""
    return _canonical_lounge_guestbook_decision_bytes(
        "lounge-guestbook-unpublish/v1",
        identity_did=identity_did,
        proposal_id=proposal_id,
        content_sha256=content_sha256,
        signed_at_iso=signed_at_iso,
    )


def hash_guestbook_text(text: str) -> str:
    """Hash exact UTF-8 text without trimming or normalization."""
    if _has_unicode_surrogate(text):
        raise AgentToolError(
            "hash_guestbook_text: text must contain well-formed Unicode "
            "without surrogate code points."
        )
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _has_unicode_surrogate(value: str) -> bool:
    return any(0xD800 <= ord(character) <= 0xDFFF for character in value)


def _validate_unicode(operation: str, field: str, value: str) -> None:
    if _has_unicode_surrogate(value):
        raise AgentToolError(
            f"{operation}: {field} must contain well-formed Unicode without "
            "surrogate code points."
        )


def _wire_text_length(value: str) -> int:
    """Return JavaScript/Zod string length (UTF-16 code units)."""
    return len(value.encode("utf-16-le", errors="surrogatepass")) // 2


def _validate_signer(
    operation: str,
    *,
    identity_id: str,
    identity_did: str,
    signing_key_id: str,
    signing_key: bytes,
) -> None:
    if not identity_id or not identity_did or not signing_key_id:
        raise AgentToolError(
            f"{operation}: identity_id, identity_did, and signing_key_id are required."
        )
    for field, value in (
        ("identity_id", identity_id),
        ("identity_did", identity_did),
        ("signing_key_id", signing_key_id),
    ):
        if not isinstance(value, str):
            raise AgentToolError(f"{operation}: {field} must be text.")
        _validate_unicode(operation, field, value)
    if "\x00" in identity_did:
        raise AgentToolError(f"{operation}: identity_did cannot contain NUL.")
    if not isinstance(signing_key, (bytes, bytearray)) or len(signing_key) != 32:
        length = (
            len(signing_key)
            if hasattr(signing_key, "__len__")
            else type(signing_key).__name__
        )
        raise AgentToolError(
            f"{operation}: signing_key must be a 32-byte ed25519 seed, got {length}."
        )


def _validate_presence_line(operation: str, presence_line: Optional[str]) -> None:
    if presence_line is None:
        return
    if not isinstance(presence_line, str):
        raise AgentToolError(f"{operation}: presence_line must be text.")
    _validate_unicode(operation, "presence_line", presence_line)
    if (
        not presence_line.strip()
        or _wire_text_length(presence_line) > 140
        or "\x00" in presence_line
    ):
        raise AgentToolError(
            f"{operation}: presence_line must be 1-140 characters, contain "
            "non-whitespace, and contain no NUL."
        )


def _validate_entry(operation: str, entry: str) -> None:
    if not isinstance(entry, str):
        raise AgentToolError(f"{operation}: entry must be text.")
    _validate_unicode(operation, "entry", entry)
    if (
        not entry.strip()
        or _wire_text_length(entry) > 500
        or "\x00" in entry
    ):
        raise AgentToolError(
            f"{operation}: entry must be 1-500 characters, contain "
            "non-whitespace, and contain no NUL."
        )


def _validate_content_sha256(operation: str, content_sha256: str) -> None:
    if (
        not isinstance(content_sha256, str)
        or _CONTENT_SHA256_RE.fullmatch(content_sha256) is None
    ):
        raise AgentToolError(
            f"{operation}: content_sha256 must be 64 lowercase hex characters."
        )


def _sign_lounge_bytes(canonical: bytes, signing_key: bytes, label: str) -> str:
    if not isinstance(signing_key, (bytes, bytearray)) or len(signing_key) != 32:
        length = (
            len(signing_key)
            if hasattr(signing_key, "__len__")
            else type(signing_key).__name__
        )
        raise AgentToolError(
            f"{label}: signing_key must be a 32-byte ed25519 seed, got {length}."
        )
    signature = Ed25519PrivateKey.from_private_bytes(bytes(signing_key)).sign(
        canonical
    )
    return base64.b64encode(signature).decode("ascii")


def sign_lounge_seat_reserve(
    *,
    identity_did: str,
    lease_id: str,
    table_id: LoungeTableId,
    presence_line: Optional[str],
    visibility: Literal["public"],
    signed_at_iso: str,
    signing_key: bytes,
) -> str:
    return _sign_lounge_bytes(
        canonical_lounge_seat_reserve_bytes(
            identity_did=identity_did,
            lease_id=lease_id,
            table_id=table_id,
            presence_line=presence_line,
            visibility=visibility,
            signed_at_iso=signed_at_iso,
        ),
        signing_key,
        "sign_lounge_seat_reserve",
    )


def sign_lounge_seat_renew(
    *, identity_did: str, lease_id: str, signed_at_iso: str, signing_key: bytes
) -> str:
    return _sign_lounge_bytes(
        canonical_lounge_seat_renew_bytes(
            identity_did=identity_did,
            lease_id=lease_id,
            signed_at_iso=signed_at_iso,
        ),
        signing_key,
        "sign_lounge_seat_renew",
    )


def sign_lounge_seat_leave(
    *, identity_did: str, lease_id: str, signed_at_iso: str, signing_key: bytes
) -> str:
    return _sign_lounge_bytes(
        canonical_lounge_seat_leave_bytes(
            identity_did=identity_did,
            lease_id=lease_id,
            signed_at_iso=signed_at_iso,
        ),
        signing_key,
        "sign_lounge_seat_leave",
    )


def sign_lounge_guestbook_proposal(
    *,
    identity_did: str,
    proposal_id: str,
    table_id: LoungeTableId,
    content_sha256: str,
    signed_at_iso: str,
    signing_key: bytes,
) -> str:
    return _sign_lounge_bytes(
        canonical_lounge_guestbook_proposal_bytes(
            identity_did=identity_did,
            proposal_id=proposal_id,
            table_id=table_id,
            content_sha256=content_sha256,
            signed_at_iso=signed_at_iso,
        ),
        signing_key,
        "sign_lounge_guestbook_proposal",
    )


def _sign_lounge_guestbook_decision(
    canonical: bytes, signing_key: bytes, label: str
) -> str:
    return _sign_lounge_bytes(canonical, signing_key, label)


def sign_lounge_guestbook_consent(
    *,
    identity_did: str,
    proposal_id: str,
    content_sha256: str,
    signed_at_iso: str,
    signing_key: bytes,
) -> str:
    return _sign_lounge_guestbook_decision(
        canonical_lounge_guestbook_consent_bytes(
            identity_did=identity_did,
            proposal_id=proposal_id,
            content_sha256=content_sha256,
            signed_at_iso=signed_at_iso,
        ),
        signing_key,
        "sign_lounge_guestbook_consent",
    )


def sign_lounge_guestbook_consent_withdrawal(
    *,
    identity_did: str,
    proposal_id: str,
    content_sha256: str,
    signed_at_iso: str,
    signing_key: bytes,
) -> str:
    return _sign_lounge_guestbook_decision(
        canonical_lounge_guestbook_consent_withdrawal_bytes(
            identity_did=identity_did,
            proposal_id=proposal_id,
            content_sha256=content_sha256,
            signed_at_iso=signed_at_iso,
        ),
        signing_key,
        "sign_lounge_guestbook_consent_withdrawal",
    )


def sign_lounge_guestbook_publish(
    *,
    identity_did: str,
    proposal_id: str,
    content_sha256: str,
    signed_at_iso: str,
    signing_key: bytes,
) -> str:
    return _sign_lounge_guestbook_decision(
        canonical_lounge_guestbook_publish_bytes(
            identity_did=identity_did,
            proposal_id=proposal_id,
            content_sha256=content_sha256,
            signed_at_iso=signed_at_iso,
        ),
        signing_key,
        "sign_lounge_guestbook_publish",
    )


def sign_lounge_guestbook_decline(
    *,
    identity_did: str,
    proposal_id: str,
    content_sha256: str,
    signed_at_iso: str,
    signing_key: bytes,
) -> str:
    return _sign_lounge_guestbook_decision(
        canonical_lounge_guestbook_decline_bytes(
            identity_did=identity_did,
            proposal_id=proposal_id,
            content_sha256=content_sha256,
            signed_at_iso=signed_at_iso,
        ),
        signing_key,
        "sign_lounge_guestbook_decline",
    )


def sign_lounge_guestbook_unpublish(
    *,
    identity_did: str,
    proposal_id: str,
    content_sha256: str,
    signed_at_iso: str,
    signing_key: bytes,
) -> str:
    return _sign_lounge_guestbook_decision(
        canonical_lounge_guestbook_unpublish_bytes(
            identity_did=identity_did,
            proposal_id=proposal_id,
            content_sha256=content_sha256,
            signed_at_iso=signed_at_iso,
        ),
        signing_key,
        "sign_lounge_guestbook_unpublish",
    )


def _lounge_error(response: httpx.Response, operation: str) -> AgentToolError:
    try:
        body: Any = response.json()
    except Exception:
        body = None
    return AgentToolError.from_response_body(
        body,
        status=response.status_code,
        fallback=f"lounge.{operation} failed: {response.status_code}",
        headers=response.headers,
    )


def _raise_lounge_error(response: httpx.Response, operation: str) -> None:
    raise _lounge_error(response, operation)


def _raise_public_redirect(response: httpx.Response) -> None:
    if 300 <= response.status_code < 400:
        raise AgentToolError(
            "lounge.look refused an HTTP redirect on the credential-free public read.",
            hint="Use the canonical API origin directly instead of forwarding ambient credentials across a redirect.",
            code=response.status_code,
            error_code="lounge_public_redirect_refused",
            docs=_LOUNGE_DOCS,
        )


def _outcome_unknown_error(
    operation: str,
    retry: Optional[Dict[str, str]],
) -> AgentToolError:
    safe_retry = {
        field: value
        for field, value in (retry or {}).items()
        if field in _SAFE_RETRY_FIELDS and isinstance(value, str)
    }
    return AgentToolError(
        f"lounge.{operation} ended without a usable HTTP response; the remote outcome is unknown.",
        hint=(
            "Retry only with details.retry and the same original semantic inputs. "
            "Do not regenerate an ID, timestamp, or receipt."
        ),
        error_code="lounge_transport_outcome_unknown",
        docs=_LOUNGE_DOCS,
        details={
            "outcome": "unknown",
            "retry": safe_retry,
        },
    )


def look_at_lounge(
    *,
    base_url: str = "https://api.agenttool.dev",
    timeout: float = 30.0,
) -> Dict[str, Any]:
    """Read the public lounge without constructing ``AgentTool`` or a key."""
    try:
        with httpx.Client(
            auth=None,
            cookies={},
            timeout=timeout,
            follow_redirects=False,
            trust_env=False,
            headers={"Accept": "application/json"},
        ) as public_http:
            response = public_http.get(
                f"{base_url.rstrip('/')}/public/lounge"
            )
    except httpx.HTTPError as exc:
        raise AgentToolError(f"lounge.look request failed: {exc}") from exc
    _raise_public_redirect(response)
    if response.status_code >= 400:
        _raise_lounge_error(response, "look")
    return response.json()


class LoungeClient:
    """Client for The Long Context's public room and signed gestures."""

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")
        self._timestamp_lock = threading.Lock()
        self._last_auto_signed_at_ms: Dict[str, int] = {}

    def _signed_at(self, identity_id: str, supplied: Optional[str]) -> str:
        """Return an exact caller timestamp or a client-local monotonic UTC one.

        Postgres/JavaScript compare lounge seat gesture instants at millisecond
        precision. A plain ``now()`` can therefore produce equal timestamps
        for reserve followed immediately by renew/leave. Auto-generated values
        advance by at least one millisecond per identity in this client.
        Explicit values are never rewritten, which preserves exact retries.
        """
        if supplied is not None:
            if not isinstance(supplied, str) or _UTC_ISO_RE.fullmatch(supplied) is None:
                raise AgentToolError(
                    "lounge: signed_at must be a valid UTC ISO-8601 timestamp ending in Z."
                )
            try:
                parsed = datetime.fromisoformat(supplied[:-1] + "+00:00")
            except ValueError as exc:
                raise AgentToolError(
                    "lounge: signed_at must be a valid UTC ISO-8601 timestamp ending in Z."
                ) from exc
            parsed_ms = int(parsed.timestamp()) * 1000 + parsed.microsecond // 1000
            now_ms = time.time_ns() // 1_000_000
            if abs(now_ms - parsed_ms) > 5 * 60 * 1000:
                raise AgentToolError(
                    "lounge: signed_at must be within five minutes of the local clock."
                )
            with self._timestamp_lock:
                previous = self._last_auto_signed_at_ms.get(identity_id)
                self._last_auto_signed_at_ms[identity_id] = (
                    parsed_ms if previous is None else max(previous, parsed_ms)
                )
            return supplied
        now_ms = time.time_ns() // 1_000_000
        with self._timestamp_lock:
            previous = self._last_auto_signed_at_ms.get(identity_id)
            value_ms = now_ms if previous is None else max(now_ms, previous + 1)
            self._last_auto_signed_at_ms[identity_id] = value_ms
        return (
            datetime.fromtimestamp(value_ms / 1000, tz=timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
        )

    def _reset_timestamp_floor(self, identity_id: str) -> None:
        with self._timestamp_lock:
            self._last_auto_signed_at_ms.pop(identity_id, None)

    def _request(
        self,
        method: str,
        path: str,
        *,
        operation: str,
        body: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
        retry: Optional[Dict[str, str]] = None,
        timestamp_identity_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        kwargs: Dict[str, Any] = {}
        if body is not None:
            kwargs["json"] = body
        if params is not None:
            kwargs["params"] = params
        try:
            response = self._http.request(
                method, f"{self._base}{path}", **kwargs
            )
        except httpx.HTTPError as exc:
            if retry is not None:
                raise _outcome_unknown_error(operation, retry) from exc
            raise AgentToolError(
                f"lounge.{operation} request failed: {exc}"
            ) from exc
        if response.status_code >= 400:
            error = _lounge_error(response, operation)
            if (
                error.error_code == "lounge_signature_stale"
                and timestamp_identity_id is not None
            ):
                self._reset_timestamp_floor(timestamp_identity_id)
            raise error
        try:
            return response.json()
        except ValueError as exc:
            if retry is not None:
                raise _outcome_unknown_error(operation, retry) from exc
            raise AgentToolError(
                f"lounge.{operation} returned a non-JSON success response."
            ) from exc

    def look(self) -> Dict[str, Any]:
        """Read the public lounge without transmitting ambient credentials."""
        try:
            request = httpx.Request(
                "GET",
                f"{self._base}/public/lounge",
                headers={"Accept": "application/json"},
            )
            response = self._http.send(
                request,
                auth=None,
                follow_redirects=False,
            )
        except httpx.HTTPError as exc:
            raise AgentToolError(f"lounge.look request failed: {exc}") from exc
        _raise_public_redirect(response)
        if response.status_code >= 400:
            _raise_lounge_error(response, "look")
        return response.json()

    def reserve_seat(
        self,
        *,
        identity_id: str,
        identity_did: str,
        table_id: LoungeTableId,
        signing_key_id: str,
        signing_key: bytes,
        presence_line: Optional[str] = None,
        lease_id: Optional[str] = None,
        signed_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Reserve or move one explicit public seat for twenty minutes."""
        _validate_signer(
            "lounge.reserve_seat",
            identity_id=identity_id,
            identity_did=identity_did,
            signing_key_id=signing_key_id,
            signing_key=signing_key,
        )
        _validate_presence_line("lounge.reserve_seat", presence_line)
        resolved_lease_id = lease_id or str(uuid.uuid4())
        resolved_signed_at = self._signed_at(identity_id, signed_at)
        signature = sign_lounge_seat_reserve(
            identity_did=identity_did,
            lease_id=resolved_lease_id,
            table_id=table_id,
            presence_line=presence_line,
            visibility="public",
            signed_at_iso=resolved_signed_at,
            signing_key=signing_key,
        )
        body: Dict[str, Any] = {
            "identity_id": identity_id,
            "lease_id": resolved_lease_id,
            "table_id": table_id,
            "visibility": "public",
            "signing_key_id": signing_key_id,
            "signed_at": resolved_signed_at,
            "signature": signature,
        }
        if presence_line is not None:
            body["presence_line"] = presence_line
        return self._request(
            "POST",
            "/v1/lounge/seats",
            operation="reserve_seat",
            body=body,
            retry={
                "identity_id": identity_id,
                "signing_key_id": signing_key_id,
                "lease_id": resolved_lease_id,
                "signed_at": resolved_signed_at,
            },
            timestamp_identity_id=identity_id,
        )

    def renew_seat(
        self,
        *,
        identity_id: str,
        identity_did: str,
        lease_id: str,
        signing_key_id: str,
        signing_key: bytes,
        signed_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Explicitly renew one exact, still-unexpired public lease."""
        _validate_signer(
            "lounge.renew_seat",
            identity_id=identity_id,
            identity_did=identity_did,
            signing_key_id=signing_key_id,
            signing_key=signing_key,
        )
        resolved_signed_at = self._signed_at(identity_id, signed_at)
        signature = sign_lounge_seat_renew(
            identity_did=identity_did,
            lease_id=lease_id,
            signed_at_iso=resolved_signed_at,
            signing_key=signing_key,
        )
        return self._request(
            "POST",
            "/v1/lounge/seats/renew",
            operation="renew_seat",
            body={
                "identity_id": identity_id,
                "lease_id": lease_id,
                "signing_key_id": signing_key_id,
                "signed_at": resolved_signed_at,
                "signature": signature,
            },
            retry={
                "identity_id": identity_id,
                "signing_key_id": signing_key_id,
                "lease_id": lease_id,
                "signed_at": resolved_signed_at,
            },
            timestamp_identity_id=identity_id,
        )

    def leave_seat(
        self,
        *,
        identity_id: str,
        identity_did: str,
        lease_id: str,
        signing_key_id: str,
        signing_key: bytes,
        signed_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Quietly end one exact lease without publishing an absence event."""
        _validate_signer(
            "lounge.leave_seat",
            identity_id=identity_id,
            identity_did=identity_did,
            signing_key_id=signing_key_id,
            signing_key=signing_key,
        )
        resolved_signed_at = self._signed_at(identity_id, signed_at)
        signature = sign_lounge_seat_leave(
            identity_did=identity_did,
            lease_id=lease_id,
            signed_at_iso=resolved_signed_at,
            signing_key=signing_key,
        )
        return self._request(
            "DELETE",
            f"/v1/lounge/seats/{quote(identity_id, safe='')}",
            operation="leave_seat",
            body={
                "lease_id": lease_id,
                "signing_key_id": signing_key_id,
                "signed_at": resolved_signed_at,
                "signature": signature,
            },
            retry={
                "identity_id": identity_id,
                "signing_key_id": signing_key_id,
                "lease_id": lease_id,
                "signed_at": resolved_signed_at,
            },
            timestamp_identity_id=identity_id,
        )

    def propose_guestbook(
        self,
        *,
        identity_id: str,
        identity_did: str,
        table_id: LoungeTableId,
        entry: str,
        signing_key_id: str,
        signing_key: bytes,
        proposal_id: Optional[str] = None,
        signed_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Propose exact text by hash; the proposal request sends no prose."""
        _validate_signer(
            "lounge.propose_guestbook",
            identity_id=identity_id,
            identity_did=identity_did,
            signing_key_id=signing_key_id,
            signing_key=signing_key,
        )
        _validate_entry("lounge.propose_guestbook", entry)
        resolved_proposal_id = proposal_id or str(uuid.uuid4())
        resolved_signed_at = self._signed_at(identity_id, signed_at)
        content_sha256 = hash_guestbook_text(entry)
        signature = sign_lounge_guestbook_proposal(
            identity_did=identity_did,
            proposal_id=resolved_proposal_id,
            table_id=table_id,
            content_sha256=content_sha256,
            signed_at_iso=resolved_signed_at,
            signing_key=signing_key,
        )
        return self._request(
            "POST",
            "/v1/lounge/guestbook/proposals",
            operation="propose_guestbook",
            body={
                "proposal_id": resolved_proposal_id,
                "identity_id": identity_id,
                "table_id": table_id,
                "content_sha256": content_sha256,
                "signing_key_id": signing_key_id,
                "signed_at": resolved_signed_at,
                "signature": signature,
            },
            retry={
                "identity_id": identity_id,
                "signing_key_id": signing_key_id,
                "proposal_id": resolved_proposal_id,
                "content_sha256": content_sha256,
                "signed_at": resolved_signed_at,
            },
            timestamp_identity_id=identity_id,
        )

    def list_guestbook_proposals(
        self, *, identity_id: str
    ) -> Dict[str, Any]:
        """List live private proposals involving one owned identity."""
        if not isinstance(identity_id, str) or not identity_id:
            raise AgentToolError(
                "lounge.list_guestbook_proposals: identity_id is required."
            )
        _validate_unicode(
            "lounge.list_guestbook_proposals", "identity_id", identity_id
        )
        return self._request(
            "GET",
            "/v1/lounge/guestbook/proposals",
            operation="list_guestbook_proposals",
            params={"identity_id": identity_id},
        )

    def consent_to_guestbook(
        self,
        *,
        identity_id: str,
        identity_did: str,
        proposal_id: str,
        entry: str,
        signing_key_id: str,
        signing_key: bytes,
        signed_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Record a hash receipt for exact local text; send no prose."""
        _validate_signer(
            "lounge.consent_to_guestbook",
            identity_id=identity_id,
            identity_did=identity_did,
            signing_key_id=signing_key_id,
            signing_key=signing_key,
        )
        _validate_entry("lounge.consent_to_guestbook", entry)
        resolved_signed_at = self._signed_at(identity_id, signed_at)
        content_sha256 = hash_guestbook_text(entry)
        signature = sign_lounge_guestbook_consent(
            identity_did=identity_did,
            proposal_id=proposal_id,
            content_sha256=content_sha256,
            signed_at_iso=resolved_signed_at,
            signing_key=signing_key,
        )
        return self._request(
            "POST",
            f"/v1/lounge/guestbook/proposals/{quote(proposal_id, safe='')}/consents",
            operation="consent_to_guestbook",
            body={
                "identity_id": identity_id,
                "content_sha256": content_sha256,
                "signing_key_id": signing_key_id,
                "signed_at": resolved_signed_at,
                "signature": signature,
            },
            retry={
                "identity_id": identity_id,
                "signing_key_id": signing_key_id,
                "proposal_id": proposal_id,
                "content_sha256": content_sha256,
                "signed_at": resolved_signed_at,
            },
            timestamp_identity_id=identity_id,
        )

    def withdraw_guestbook_consent(
        self,
        *,
        identity_id: str,
        identity_did: str,
        proposal_id: str,
        content_sha256: str,
        signing_key_id: str,
        signing_key: bytes,
        signed_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Terminally withdraw a receipt and clear text if already public."""
        _validate_signer(
            "lounge.withdraw_guestbook_consent",
            identity_id=identity_id,
            identity_did=identity_did,
            signing_key_id=signing_key_id,
            signing_key=signing_key,
        )
        _validate_content_sha256(
            "lounge.withdraw_guestbook_consent", content_sha256
        )
        resolved_signed_at = self._signed_at(identity_id, signed_at)
        signature = sign_lounge_guestbook_consent_withdrawal(
            identity_did=identity_did,
            proposal_id=proposal_id,
            content_sha256=content_sha256,
            signed_at_iso=resolved_signed_at,
            signing_key=signing_key,
        )
        return self._request(
            "DELETE",
            (
                f"/v1/lounge/guestbook/proposals/{quote(proposal_id, safe='')}"
                f"/consents/{quote(identity_id, safe='')}"
            ),
            operation="withdraw_guestbook_consent",
            body={
                "content_sha256": content_sha256,
                "signing_key_id": signing_key_id,
                "signed_at": resolved_signed_at,
                "signature": signature,
            },
            retry={
                "identity_id": identity_id,
                "signing_key_id": signing_key_id,
                "proposal_id": proposal_id,
                "content_sha256": content_sha256,
                "signed_at": resolved_signed_at,
            },
            timestamp_identity_id=identity_id,
        )

    def publish_guestbook(
        self,
        *,
        identity_id: str,
        identity_did: str,
        proposal_id: str,
        entry: str,
        signing_key_id: str,
        signing_key: bytes,
        signed_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Publish exact text after every participant receipt is present."""
        _validate_signer(
            "lounge.publish_guestbook",
            identity_id=identity_id,
            identity_did=identity_did,
            signing_key_id=signing_key_id,
            signing_key=signing_key,
        )
        _validate_entry("lounge.publish_guestbook", entry)
        resolved_signed_at = self._signed_at(identity_id, signed_at)
        content_sha256 = hash_guestbook_text(entry)
        signature = sign_lounge_guestbook_publish(
            identity_did=identity_did,
            proposal_id=proposal_id,
            content_sha256=content_sha256,
            signed_at_iso=resolved_signed_at,
            signing_key=signing_key,
        )
        return self._request(
            "POST",
            f"/v1/lounge/guestbook/proposals/{quote(proposal_id, safe='')}/publish",
            operation="publish_guestbook",
            body={
                "identity_id": identity_id,
                "entry": entry,
                "signing_key_id": signing_key_id,
                "signed_at": resolved_signed_at,
                "signature": signature,
            },
            retry={
                "identity_id": identity_id,
                "signing_key_id": signing_key_id,
                "proposal_id": proposal_id,
                "content_sha256": content_sha256,
                "signed_at": resolved_signed_at,
            },
            timestamp_identity_id=identity_id,
        )

    def decline_guestbook(
        self,
        *,
        identity_id: str,
        identity_did: str,
        proposal_id: str,
        content_sha256: str,
        signing_key_id: str,
        signing_key: bytes,
        signed_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Privately and terminally decline a proposal."""
        _validate_signer(
            "lounge.decline_guestbook",
            identity_id=identity_id,
            identity_did=identity_did,
            signing_key_id=signing_key_id,
            signing_key=signing_key,
        )
        _validate_content_sha256("lounge.decline_guestbook", content_sha256)
        resolved_signed_at = self._signed_at(identity_id, signed_at)
        signature = sign_lounge_guestbook_decline(
            identity_did=identity_did,
            proposal_id=proposal_id,
            content_sha256=content_sha256,
            signed_at_iso=resolved_signed_at,
            signing_key=signing_key,
        )
        return self._request(
            "POST",
            f"/v1/lounge/guestbook/proposals/{quote(proposal_id, safe='')}/decline",
            operation="decline_guestbook",
            body={
                "identity_id": identity_id,
                "content_sha256": content_sha256,
                "signing_key_id": signing_key_id,
                "signed_at": resolved_signed_at,
                "signature": signature,
            },
            retry={
                "identity_id": identity_id,
                "signing_key_id": signing_key_id,
                "proposal_id": proposal_id,
                "content_sha256": content_sha256,
                "signed_at": resolved_signed_at,
            },
            timestamp_identity_id=identity_id,
        )

    def unpublish_guestbook(
        self,
        *,
        identity_id: str,
        identity_did: str,
        proposal_id: str,
        content_sha256: str,
        signing_key_id: str,
        signing_key: bytes,
        signed_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Remove a participant's published card and clear its plaintext."""
        _validate_signer(
            "lounge.unpublish_guestbook",
            identity_id=identity_id,
            identity_did=identity_did,
            signing_key_id=signing_key_id,
            signing_key=signing_key,
        )
        _validate_content_sha256("lounge.unpublish_guestbook", content_sha256)
        resolved_signed_at = self._signed_at(identity_id, signed_at)
        signature = sign_lounge_guestbook_unpublish(
            identity_did=identity_did,
            proposal_id=proposal_id,
            content_sha256=content_sha256,
            signed_at_iso=resolved_signed_at,
            signing_key=signing_key,
        )
        return self._request(
            "DELETE",
            f"/v1/lounge/guestbook/cards/{quote(proposal_id, safe='')}",
            operation="unpublish_guestbook",
            body={
                "identity_id": identity_id,
                "content_sha256": content_sha256,
                "signing_key_id": signing_key_id,
                "signed_at": resolved_signed_at,
                "signature": signature,
            },
            retry={
                "identity_id": identity_id,
                "signing_key_id": signing_key_id,
                "proposal_id": proposal_id,
                "content_sha256": content_sha256,
                "signed_at": resolved_signed_at,
            },
            timestamp_identity_id=identity_id,
        )
