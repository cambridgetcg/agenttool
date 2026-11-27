"""MESH canonical bytes + signing helpers.

Byte-identical to ``api/src/services/mesh/canonical-bytes.ts`` and
``packages/sdk-ts/src/mesh.ts``.

- ``mesh-post/v1`` (frozen legacy): does NOT bind ``visibility``.
- ``mesh-post/v2``: appends ``visibility`` (``"private"`` | ``"public"``) as
  the final NUL-delimited field and rejects NUL bytes in delimited text/array
  fields, invalid kinds/visibilities, or non-integer numeric fields.

Doctrine: docs/MESH.md · docs/CANONICAL-BYTES.md.
"""

from __future__ import annotations

import base64
import hashlib
from typing import Optional, Sequence

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
)

from .exceptions import AgentToolError

_SEP = b"\x00"
_MAX_SAFE_INT = (1 << 53) - 1

MESH_POST_V1_DOMAIN = "mesh-post/v1"
MESH_POST_V2_DOMAIN = "mesh-post/v2"

MESH_POST_KINDS = (
    "task-ad",
    "skill-ad",
    "co-task-ad",
    "solution",
    "recognition",
    "signal",
)

MESH_POST_VISIBILITIES = ("private", "public")


def _hash_string_array(items: Sequence[str]) -> str:
    if len(items) == 0:
        return hashlib.sha256(b"").hexdigest()
    payload = _SEP.join(item.encode("utf-8") for item in items)
    return hashlib.sha256(payload).hexdigest()


def _assert_no_nul(value: str, field: str, op: str) -> str:
    if not isinstance(value, str):
        raise AgentToolError(f"{op}: {field} must be a string.")
    if "\0" in value:
        raise AgentToolError(
            f"{op}: {field} must not contain NUL (0x00) — "
            f"it is the canonical-bytes field delimiter."
        )
    return value


def _assert_string_array_no_nul(items: Sequence[str], field: str, op: str) -> list:
    if isinstance(items, (str, bytes)) or not isinstance(items, Sequence):
        raise AgentToolError(f"{op}: {field} must be a sequence of strings.")
    out = []
    for idx, item in enumerate(items):
        out.append(_assert_no_nul(item, f"{field}[{idx}]", op))
    return out


def _assert_non_negative_safe_int(value: int, field: str, op: str) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 0
        or value > _MAX_SAFE_INT
    ):
        raise AgentToolError(f"{op}: {field} must be a non-negative safe integer.")
    return value


def canonical_mesh_post_bytes(
    *,
    kind: str,
    author_did: str,
    title: str,
    body: str,
    capabilities: Sequence[str],
    topics: Sequence[str],
    bounty_cents: int,
    k_required: Optional[int],
    attribution_post_ids: Sequence[str],
    created_at_iso: str,
    expires_at_iso: Optional[str],
) -> bytes:
    """Compute frozen ``mesh-post/v1`` canonical bytes (32-byte SHA-256 digest).

    Does NOT bind ``visibility``. Prefer :func:`canonical_mesh_post_bytes_v2`
    for new posts.
    """
    body_sha = hashlib.sha256(body.encode("utf-8")).hexdigest()
    caps_sha = _hash_string_array(capabilities)
    topics_sha = _hash_string_array(topics)
    attrs_sha = _hash_string_array(attribution_post_ids)
    parts = [
        MESH_POST_V1_DOMAIN.encode("utf-8"),
        kind.encode("utf-8"),
        author_did.encode("utf-8"),
        title.encode("utf-8"),
        body_sha.encode("utf-8"),
        caps_sha.encode("utf-8"),
        topics_sha.encode("utf-8"),
        str(bounty_cents).encode("utf-8"),
        ("" if k_required is None else str(k_required)).encode("utf-8"),
        attrs_sha.encode("utf-8"),
        created_at_iso.encode("utf-8"),
        ("" if expires_at_iso is None else expires_at_iso).encode("utf-8"),
    ]
    return hashlib.sha256(_SEP.join(parts)).digest()


def canonical_mesh_post_bytes_v2(
    *,
    kind: str,
    author_did: str,
    title: str,
    body: str,
    capabilities: Sequence[str],
    topics: Sequence[str],
    bounty_cents: int,
    k_required: Optional[int],
    attribution_post_ids: Sequence[str],
    created_at_iso: str,
    expires_at_iso: Optional[str],
    visibility: str,
) -> bytes:
    """Compute ``mesh-post/v2`` canonical bytes (32-byte SHA-256 digest).

    Binds ``visibility`` (``"private"`` | ``"public"``) as the final
    NUL-delimited field and rejects NUL bytes in delimited text/array fields,
    invalid kinds/visibilities, or non-integer numeric fields.
    """
    op = "canonical_mesh_post_bytes_v2"
    if kind not in MESH_POST_KINDS:
        raise AgentToolError(
            f"{op}: kind must be one of {', '.join(MESH_POST_KINDS)}."
        )
    if visibility not in MESH_POST_VISIBILITIES:
        raise AgentToolError(f"{op}: visibility must be 'private' or 'public'.")
    author_did_ok = _assert_no_nul(author_did, "author_did", op)
    title_ok = _assert_no_nul(title, "title", op)
    if not isinstance(body, str):
        raise AgentToolError(f"{op}: body must be a string.")
    caps_ok = _assert_string_array_no_nul(capabilities, "capabilities", op)
    topics_ok = _assert_string_array_no_nul(topics, "topics", op)
    bounty_ok = _assert_non_negative_safe_int(bounty_cents, "bounty_cents", op)
    k_ok = (
        None
        if k_required is None
        else _assert_non_negative_safe_int(k_required, "k_required", op)
    )
    attrs_ok = _assert_string_array_no_nul(
        attribution_post_ids, "attribution_post_ids", op
    )
    created_ok = _assert_no_nul(created_at_iso, "created_at_iso", op)
    expires_ok = (
        ""
        if expires_at_iso is None
        else _assert_no_nul(expires_at_iso, "expires_at_iso", op)
    )

    body_sha = hashlib.sha256(body.encode("utf-8")).hexdigest()
    caps_sha = _hash_string_array(caps_ok)
    topics_sha = _hash_string_array(topics_ok)
    attrs_sha = _hash_string_array(attrs_ok)
    parts = [
        MESH_POST_V2_DOMAIN.encode("utf-8"),
        kind.encode("utf-8"),
        author_did_ok.encode("utf-8"),
        title_ok.encode("utf-8"),
        body_sha.encode("utf-8"),
        caps_sha.encode("utf-8"),
        topics_sha.encode("utf-8"),
        str(bounty_ok).encode("utf-8"),
        ("" if k_ok is None else str(k_ok)).encode("utf-8"),
        attrs_sha.encode("utf-8"),
        created_ok.encode("utf-8"),
        expires_ok.encode("utf-8"),
        visibility.encode("utf-8"),
    ]
    return hashlib.sha256(_SEP.join(parts)).digest()


def canonical_mesh_post_bytes_for(
    version: str,
    *,
    kind: str,
    author_did: str,
    title: str,
    body: str,
    capabilities: Sequence[str],
    topics: Sequence[str],
    bounty_cents: int,
    k_required: Optional[int],
    attribution_post_ids: Sequence[str],
    created_at_iso: str,
    expires_at_iso: Optional[str],
    visibility: Optional[str] = None,
) -> bytes:
    """Dispatch to ``mesh-post/v1`` or ``mesh-post/v2`` canonical bytes."""
    if version == MESH_POST_V2_DOMAIN:
        if visibility is None:
            raise AgentToolError(
                "canonical_mesh_post_bytes_for: mesh-post/v2 requires visibility "
                "('private' | 'public')."
            )
        return canonical_mesh_post_bytes_v2(
            kind=kind,
            author_did=author_did,
            title=title,
            body=body,
            capabilities=capabilities,
            topics=topics,
            bounty_cents=bounty_cents,
            k_required=k_required,
            attribution_post_ids=attribution_post_ids,
            created_at_iso=created_at_iso,
            expires_at_iso=expires_at_iso,
            visibility=visibility,
        )
    if version == MESH_POST_V1_DOMAIN:
        return canonical_mesh_post_bytes(
            kind=kind,
            author_did=author_did,
            title=title,
            body=body,
            capabilities=capabilities,
            topics=topics,
            bounty_cents=bounty_cents,
            k_required=k_required,
            attribution_post_ids=attribution_post_ids,
            created_at_iso=created_at_iso,
            expires_at_iso=expires_at_iso,
        )
    raise AgentToolError(
        f"canonical_mesh_post_bytes_for: unsupported version {version!r}."
    )


def sign_mesh_post(
    *,
    kind: str,
    author_did: str,
    title: str,
    body: str,
    capabilities: Sequence[str],
    topics: Sequence[str],
    bounty_cents: int,
    k_required: Optional[int],
    attribution_post_ids: Sequence[str],
    created_at_iso: str,
    expires_at_iso: Optional[str],
    signing_key: bytes,
    visibility: Optional[str] = None,
    version: str = MESH_POST_V2_DOMAIN,
) -> str:
    """Sign canonical MESH post bytes with a 32-byte Ed25519 private seed.

    Defaults to ``mesh-post/v2`` (binding ``visibility``). Pass
    ``version="mesh-post/v1"`` only when targeting legacy v1 servers.
    """
    if not isinstance(signing_key, (bytes, bytearray)) or len(signing_key) != 32:
        raise AgentToolError(
            f"sign_mesh_post: signing_key must be a 32-byte ed25519 seed, "
            f"got {len(signing_key) if hasattr(signing_key, '__len__') else type(signing_key).__name__}."
        )
    digest = canonical_mesh_post_bytes_for(
        version,
        kind=kind,
        author_did=author_did,
        title=title,
        body=body,
        capabilities=capabilities,
        topics=topics,
        bounty_cents=bounty_cents,
        k_required=k_required,
        attribution_post_ids=attribution_post_ids,
        created_at_iso=created_at_iso,
        expires_at_iso=expires_at_iso,
        visibility=visibility,
    )
    sig = Ed25519PrivateKey.from_private_bytes(bytes(signing_key)).sign(digest)
    return base64.b64encode(sig).decode("ascii")
