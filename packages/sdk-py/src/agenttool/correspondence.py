"""Renaissance Correspondence — signed, replayable agent coordination.

Device and session UUIDs are explicit caller input. This module never reads a
hostname, hardware identifier, PID, environment variable, or other ambient
telemetry to invent them. Claims are expiring courtesy notices, not locks,
ownership, or delegated authority.

The canonicalizer implements the bounded I-JSON profile accepted by
``agent-correspondence/v0.1``: strings, booleans, null, arrays, objects, and
safe integers. For those admitted values it emits RFC 8785 JCS. Floats,
negative zero, non-finite values, unsafe integers, lone Unicode surrogates,
U+0000 in strings or property names, cycles, and oversized object graphs are
rejected locally.

Receive side: every record returned by :meth:`CorrespondenceClient.list`,
:meth:`CorrespondenceClient.replay`, and :meth:`CorrespondenceClient.voice`
carries an explicit ``verification``. Authorship is proved only by
:func:`verify_correspondence_signature` against an Ed25519 public key the
caller already holds for the sender. The default is fail-open-but-loud: with no
key for a sender the record still arrives, marked ``verified=False`` with
reason ``no_verifying_key``, because a reader that cannot resolve a key must
still be able to see that an event exists. Pass ``require_verified=True`` to
fail closed and refuse the read instead.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import re
import unicodedata
from datetime import datetime
from typing import (
    Any,
    Callable,
    Dict,
    Iterator,
    List,
    Literal,
    Mapping,
    Optional,
    Set,
    Tuple,
    TypedDict,
    Union,
)

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from .exceptions import AgentToolError, _error_from_response
from .identity import _decode_private_key


CORRESPONDENCE_PROTOCOL = "agent-correspondence/v0.1"
CORRESPONDENCE_SIGNATURE_ALGORITHM = "Ed25519"

_EVENT_ID_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
_REVISION_RE = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)
_RFC3339_MS_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"
)
_DECIMAL_CURSOR_RE = re.compile(r"^(?:0|[1-9][0-9]*)$")
_GLOB_META_RE = re.compile(r"[*?\[\]{}!]")
_ABSOLUTE_URI_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
_MAX_SAFE_INTEGER = (1 << 53) - 1
_MAX_RECEIVED_SEQ = (1 << 63) - 1
_MAX_RECEIVED_SEQ_TEXT = str(_MAX_RECEIVED_SEQ)

CorrespondenceKind = Literal[
    "intent",
    "claim.open",
    "claim.renew",
    "claim.release",
    "progress",
    "observation",
    "artifact.offer",
    "ack.seen",
    "ack.understood",
    "ack.accepted",
    "ack.applied",
    "ack.rejected",
    "conflict.raise",
    "conflict.resolve",
    "pause",
    "rest",
    "resume",
    "refusal",
    "handoff",
    "close",
    "repair",
]

CORRESPONDENCE_KINDS: Tuple[CorrespondenceKind, ...] = (
    "intent",
    "claim.open",
    "claim.renew",
    "claim.release",
    "progress",
    "observation",
    "artifact.offer",
    "ack.seen",
    "ack.understood",
    "ack.accepted",
    "ack.applied",
    "ack.rejected",
    "conflict.raise",
    "conflict.resolve",
    "pause",
    "rest",
    "resume",
    "refusal",
    "handoff",
    "close",
    "repair",
)


class CorrespondenceSender(TypedDict):
    identity_id: str
    signing_key_id: str
    device_id: str
    session_id: str


class CorrespondenceScopeRequired(TypedDict):
    base_revision: Optional[str]
    branch: Optional[str]
    paths: List[str]


class CorrespondenceScope(CorrespondenceScopeRequired):
    pass


class CorrespondenceAuthority(TypedDict):
    automatic_action: Literal["never"]
    grants: List[Any]


class CorrespondenceSignature(TypedDict):
    algorithm: Literal["Ed25519"]
    value_b64url: str


class CorrespondenceReceipt(TypedDict):
    received_seq: str
    received_at: str


class CorrespondenceSignedEvent(TypedDict):
    protocol: Literal["agent-correspondence/v0.1"]
    project_id: str
    repository_id: str
    thread_id: str
    sender: CorrespondenceSender
    kind: CorrespondenceKind
    parents: List[str]
    session_seq: int
    issued_at: str
    scope: CorrespondenceScope
    body: Dict[str, Any]
    authority: CorrespondenceAuthority
    signature: CorrespondenceSignature
    event_id: str


class CorrespondenceEventRecord(TypedDict):
    event: CorrespondenceSignedEvent
    receipt: CorrespondenceReceipt
    missing_parents: List[str]
    lineage_status: Literal["not_applicable", "valid", "pending", "invalid"]


#: Caller-held Ed25519 public key: raw 32 bytes, standard base64, or base64url.
CorrespondenceVerifyingKey = Union[bytes, bytearray, str]

CorrespondenceSigningKeyResolver = Callable[
    [str, Mapping[str, Any]], Optional[CorrespondenceVerifyingKey]
]

CorrespondenceVerificationReason = Literal[
    "verified",
    # No caller-held key for this signer; authorship is unproved, not disproved.
    "no_verifying_key",
    "signature_mismatch",
    "event_id_mismatch",
    "malformed_event",
]


class CorrespondenceVerification(TypedDict, total=False):
    verified: bool
    reason: CorrespondenceVerificationReason
    # ``sender.signing_key_id`` a caller must resolve a public key for.
    signing_key_id: str
    detail: str


class CorrespondenceVerifiedEventRecord(CorrespondenceEventRecord):
    #: The reader's own local verdict, attached client-side.
    verification: CorrespondenceVerification


class CorrespondenceWarning(TypedDict, total=False):
    code: Literal["session_fork", "claim_lineage_pending"]
    detail: str
    event_ids: List[str]
    paths: List[str]


class CorrespondenceAppendResponse(CorrespondenceEventRecord):
    warnings: List[CorrespondenceWarning]


class CorrespondencePage(TypedDict):
    after: Optional[str]
    next_after: Optional[str]
    has_more: bool


class CorrespondenceEventsPage(TypedDict):
    protocol: Literal["agent-correspondence/v0.1"]
    scope: Literal["project_private"]
    events: List[CorrespondenceVerifiedEventRecord]
    page: CorrespondencePage


class CorrespondenceActiveClaim(TypedDict):
    claim_id: str
    generation: int
    event_id: str
    owner_identity_id: str
    device_id: str
    session_id: str
    thread_id: str
    scope: CorrespondenceScope
    expires_at: str
    conflicted: bool
    # At most 16 other valid branch tips, including inactive/released tips.
    competing_event_ids: List[str]


class CorrespondenceClaimsResponse(TypedDict):
    protocol: Literal["agent-correspondence/v0.1"]
    scope: Literal["project_private"]
    evaluated_at: str
    cursor: Optional[str]
    projection_status: Literal["complete", "truncated", "unavailable"]
    truncated: bool
    claims: List[CorrespondenceActiveClaim]


class CorrespondenceMissingParentsConflict(TypedDict):
    event_id: str
    missing_parent_ids: List[str]


class CorrespondenceSessionForkConflict(TypedDict):
    identity_id: str
    device_id: str
    session_id: str
    session_seq: int
    event_ids: List[str]


class CorrespondenceOverlappingClaimsConflict(TypedDict):
    left_event_id: str
    right_event_id: str
    paths: List[str]


class CorrespondenceVoiceConflicts(TypedDict):
    missing_parents: List[CorrespondenceMissingParentsConflict]
    session_forks: List[CorrespondenceSessionForkConflict]
    overlapping_claims: List[CorrespondenceOverlappingClaimsConflict]


class CorrespondenceVoiceSnapshot(TypedDict):
    protocol: Literal["agent-correspondence/v0.1"]
    scope: Literal["project_private"]
    evaluated_at: str
    cursor: Optional[str]
    projection_status: Literal["complete", "truncated", "unavailable"]
    truncated: bool
    recent_events: List[CorrespondenceVerifiedEventRecord]
    active_claims: List[CorrespondenceActiveClaim]
    conflicts: CorrespondenceVoiceConflicts


def _has_surrogate(value: str) -> bool:
    return any(0xD800 <= ord(character) <= 0xDFFF for character in value)


def _utf16_sort_key(value: str) -> bytes:
    # RFC 8785 sorts object property names by unsigned UTF-16 code units.
    return value.encode("utf-16-be")


class _JcsState:
    def __init__(self) -> None:
        self.ancestors: Set[int] = set()
        self.nodes = 0


def _jcs(
    value: Any,
    path: str = "$",
    state: Optional[_JcsState] = None,
    depth: int = 0,
) -> str:
    if state is None:
        state = _JcsState()
    state.nodes += 1
    if state.nodes > 10_000:
        raise AgentToolError(
            "correspondence canonicalization: JSON exceeds the 10,000-node safety cap."
        )
    if depth > 64:
        raise AgentToolError(
            "correspondence canonicalization: JSON exceeds the 64-level depth cap."
        )

    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        if _has_surrogate(value):
            raise AgentToolError(
                f"correspondence canonicalization: {path} contains a lone Unicode surrogate."
            )
        if "\0" in value:
            raise AgentToolError(
                f"correspondence canonicalization: {path} contains U+0000, which v0.1 refuses."
            )
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, int):
        if value < -_MAX_SAFE_INTEGER or value > _MAX_SAFE_INTEGER:
            raise AgentToolError(
                f"correspondence canonicalization: {path} must be a safe integer in v0.1.",
                hint="Floats, negative zero, NaN, Infinity, and unsafe integers are refused.",
            )
        return str(value)
    if isinstance(value, float):
        # All floats are outside this bounded v0.1 profile, including -0.0.
        description = "negative zero" if value == 0 and math.copysign(1, value) < 0 else "a float"
        raise AgentToolError(
            f"correspondence canonicalization: {path} contains {description}; v0.1 admits safe integers only."
        )
    if isinstance(value, list):
        marker = id(value)
        if marker in state.ancestors:
            raise AgentToolError(
                f"correspondence canonicalization: {path} contains a cycle."
            )
        state.ancestors.add(marker)
        try:
            return "[" + ",".join(
                _jcs(item, f"{path}[{index}]", state, depth + 1)
                for index, item in enumerate(value)
            ) + "]"
        finally:
            state.ancestors.remove(marker)
    if type(value) is dict:
        marker = id(value)
        if marker in state.ancestors:
            raise AgentToolError(
                f"correspondence canonicalization: {path} contains a cycle."
            )
        for key in value:
            if not isinstance(key, str):
                raise AgentToolError(
                    f"correspondence canonicalization: {path} has a non-string property name."
                )
            if _has_surrogate(key):
                raise AgentToolError(
                    f"correspondence canonicalization: {path} has a lone-surrogate property name."
                )
            if "\0" in key:
                raise AgentToolError(
                    f"correspondence canonicalization: {path} has a U+0000 property name, which v0.1 refuses."
                )
        state.ancestors.add(marker)
        try:
            keys = sorted(value, key=_utf16_sort_key)
            return "{" + ",".join(
                json.dumps(key, ensure_ascii=False, separators=(",", ":"))
                + ":"
                + _jcs(value[key], f"{path}.{key}", state, depth + 1)
                for key in keys
            ) + "}"
        finally:
            state.ancestors.remove(marker)
    raise AgentToolError(
        f"correspondence canonicalization: {path} contains a non-I-JSON value."
    )


def canonical_correspondence_json(value: Any) -> str:
    """Serialize one value in the bounded v0.1 I-JSON/JCS profile."""
    return _jcs(value)


def _exact_keys(
    operation: str,
    value: Mapping[str, Any],
    required: Set[str],
    optional: Optional[Set[str]] = None,
) -> None:
    optional = optional or set()
    if any(not isinstance(key, str) for key in value):
        raise AgentToolError(
            f"{operation}: object property names must be strings."
        )
    missing = required.difference(value)
    if missing:
        raise AgentToolError(
            f"{operation}: {sorted(missing)[0]} is required."
        )
    extra = set(value).difference(required | optional)
    if extra:
        raise AgentToolError(
            f"{operation}: unexpected field {sorted(extra)[0]}.",
            hint="agent-correspondence/v0.1 bodies use additionalProperties=false.",
        )


def _object(operation: str, value: Any) -> Dict[str, Any]:
    if type(value) is not dict:
        raise AgentToolError(f"{operation}: expected a JSON object.")
    return value


def _uuid(operation: str, value: Any) -> str:
    if not isinstance(value, str) or _UUID_RE.fullmatch(value) is None:
        raise AgentToolError(
            f"{operation}: expected a canonical lowercase UUID."
        )
    return value


def _event_id(operation: str, value: Any) -> str:
    if not isinstance(value, str) or _EVENT_ID_RE.fullmatch(value) is None:
        raise AgentToolError(
            f"{operation}: expected sha256:<64 lowercase hex>."
        )
    return value


def _revision(operation: str, value: Any) -> str:
    if not isinstance(value, str) or _REVISION_RE.fullmatch(value) is None:
        raise AgentToolError(
            f"{operation}: expected a 40- or 64-character lowercase revision."
        )
    return value


def _timestamp(operation: str, value: Any) -> str:
    if (
        not isinstance(value, str)
        or _RFC3339_MS_RE.fullmatch(value) is None
        or value[:4] == "0000"
    ):
        raise AgentToolError(
            f"{operation}: expected a valid RFC3339 UTC timestamp with milliseconds."
        )
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise AgentToolError(
            f"{operation}: expected a valid RFC3339 UTC timestamp with milliseconds."
        ) from exc
    if parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z") != value:
        raise AgentToolError(
            f"{operation}: expected a canonical RFC3339 UTC timestamp with milliseconds."
        )
    return value


def _text(operation: str, value: Any, maximum: int = 1000) -> str:
    if not isinstance(value, str) or len(value) < 1 or len(value) > maximum:
        raise AgentToolError(
            f"{operation}: expected 1-{maximum} Unicode scalar values of text."
        )
    if "\0" in value:
        raise AgentToolError(f"{operation}: NUL is not allowed.")
    return value


def _repository_text(operation: str, value: Any) -> str:
    if (
        not isinstance(value, str)
        or len(value) < 1
        or len(value) > 256
        or any(
            character.isspace()
            or character == "\ufeff"
            or unicodedata.category(character) == "Cc"
            for character in value
        )
    ):
        raise AgentToolError(
            f"{operation}: expected 1-256 Unicode scalar values without whitespace or control characters."
        )
    return value


def _event_ids(
    operation: str,
    value: Any,
    minimum: int,
    maximum: int = 16,
) -> List[str]:
    if not isinstance(value, list) or len(value) < minimum or len(value) > maximum:
        raise AgentToolError(
            f"{operation}: expected {minimum}-{maximum} event IDs."
        )
    seen: Set[str] = set()
    for candidate in value:
        event_id = _event_id(operation, candidate)
        if event_id in seen:
            raise AgentToolError(f"{operation}: event IDs must be unique.")
        seen.add(event_id)
    return value


def _parent(core: Mapping[str, Any], event_id: str, field: str) -> None:
    if event_id not in core["parents"]:
        raise AgentToolError(
            f"correspondence {core['kind']}: {field} must also appear in parents."
        )


def _optional_text(
    operation: str,
    body: Mapping[str, Any],
    key: str,
    maximum: int = 1000,
) -> None:
    if key in body:
        _text(f"{operation}.{key}", body[key], maximum)


def _path_prefix(operation: str, value: Any) -> str:
    if not isinstance(value, str) or len(value) < 1 or len(value) > 256:
        raise AgentToolError(
            f"{operation}: expected 1-256 Unicode scalar values."
        )
    if any(unicodedata.category(character) == "Cc" for character in value):
        raise AgentToolError(f"{operation}: control characters are not allowed.")
    if value != "." and (
        value.startswith("/")
        or value.endswith("/")
        or "\\" in value
        or _GLOB_META_RE.search(value) is not None
        or any(segment in ("", ".", "..") for segment in value.split("/"))
    ):
        raise AgentToolError(
            f"{operation}: {value!r} is not a normalized repo-relative prefix."
        )
    return value


def _validate_body(core: Mapping[str, Any]) -> None:
    kind = core["kind"]
    operation = f"correspondence {kind}"
    body = _object(f"{operation}.body", core["body"])

    if kind in ("intent", "progress", "observation"):
        _exact_keys(operation, body, {"summary"})
        _text(f"{operation}.summary", body["summary"])
        return
    if kind == "claim.open":
        _exact_keys(operation, body, {"claim_id", "generation", "expires_at"})
        _uuid(f"{operation}.claim_id", body["claim_id"])
        if body["generation"] != 1 or isinstance(body["generation"], bool):
            raise AgentToolError(f"{operation}: generation must be 1.")
        _timestamp(f"{operation}.expires_at", body["expires_at"])
        return
    if kind in ("claim.renew", "claim.release"):
        required = {"claim_id", "generation", "predecessor_event_id"}
        optional = {"detail"}
        if kind == "claim.renew":
            required.add("expires_at")
            optional = set()
        _exact_keys(operation, body, required, optional)
        _uuid(f"{operation}.claim_id", body["claim_id"])
        generation = body["generation"]
        if (
            isinstance(generation, bool)
            or not isinstance(generation, int)
            or generation < 2
            or generation > _MAX_SAFE_INTEGER
        ):
            raise AgentToolError(
                f"{operation}: generation must be a safe integer >= 2."
            )
        predecessor = _event_id(
            f"{operation}.predecessor_event_id", body["predecessor_event_id"]
        )
        _parent(core, predecessor, "predecessor_event_id")
        if kind == "claim.renew":
            _timestamp(f"{operation}.expires_at", body["expires_at"])
        else:
            _optional_text(operation, body, "detail")
        return
    if kind == "artifact.offer":
        _exact_keys(operation, body, {"artifact"}, {"summary"})
        _optional_text(operation, body, "summary")
        artifact = _object(f"{operation}.artifact", body["artifact"])
        if artifact.get("kind") == "git_commit":
            _exact_keys(f"{operation}.artifact", artifact, {"kind", "revision"})
            _revision(f"{operation}.artifact.revision", artifact["revision"])
        elif artifact.get("kind") in ("git_patch", "content_digest"):
            _exact_keys(
                f"{operation}.artifact", artifact, {"kind", "digest"}, {"locator"}
            )
            _event_id(f"{operation}.artifact.digest", artifact["digest"])
            if "locator" in artifact:
                locator = _text(
                    f"{operation}.artifact.locator", artifact["locator"], 2048
                )
                if _ABSOLUTE_URI_RE.match(locator) is None or any(
                    character.isspace()
                    or character == "\ufeff"
                    or unicodedata.category(character) == "Cc"
                    for character in locator
                ):
                    raise AgentToolError(
                        f"{operation}.artifact.locator: expected an absolute URI."
                    )
        else:
            raise AgentToolError(
                f"{operation}.artifact.kind: unsupported artifact kind."
            )
        return
    if kind in (
        "ack.seen",
        "ack.understood",
        "ack.accepted",
        "ack.rejected",
        "resume",
    ):
        _exact_keys(operation, body, {"target_event_id"}, {"detail"})
        target = _event_id(f"{operation}.target_event_id", body["target_event_id"])
        _parent(core, target, "target_event_id")
        _optional_text(operation, body, "detail")
        return
    if kind == "ack.applied":
        _exact_keys(
            operation, body, {"target_event_id", "result_revision"}, {"detail"}
        )
        target = _event_id(f"{operation}.target_event_id", body["target_event_id"])
        _parent(core, target, "target_event_id")
        _revision(f"{operation}.result_revision", body["result_revision"])
        _optional_text(operation, body, "detail")
        return
    if kind == "conflict.raise":
        _exact_keys(operation, body, {"target_event_ids"}, {"summary"})
        targets = _event_ids(
            f"{operation}.target_event_ids", body["target_event_ids"], 2
        )
        for target in targets:
            _parent(core, target, "target_event_ids[]")
        _optional_text(operation, body, "summary")
        return
    if kind in ("conflict.resolve", "repair"):
        _exact_keys(
            operation,
            body,
            {"target_event_ids", "summary"},
            {"result_revision"},
        )
        targets = _event_ids(
            f"{operation}.target_event_ids", body["target_event_ids"], 1
        )
        for target in targets:
            _parent(core, target, "target_event_ids[]")
        _text(f"{operation}.summary", body["summary"])
        if "result_revision" in body:
            _revision(f"{operation}.result_revision", body["result_revision"])
        return
    if kind in ("pause", "rest"):
        _exact_keys(operation, body, set(), {"until", "detail"})
        if "until" in body and body["until"] is not None:
            _timestamp(f"{operation}.until", body["until"])
        _optional_text(operation, body, "detail")
        return
    if kind == "refusal":
        _exact_keys(operation, body, set(), {"target_event_id", "detail"})
        if "target_event_id" in body:
            target = _event_id(
                f"{operation}.target_event_id", body["target_event_id"]
            )
            _parent(core, target, "target_event_id")
        _optional_text(operation, body, "detail")
        return
    if kind == "handoff":
        _exact_keys(
            operation, body, {"summary", "next_safe_action"}, {"handoff_id"}
        )
        _text(f"{operation}.summary", body["summary"], 2000)
        _text(f"{operation}.next_safe_action", body["next_safe_action"])
        if "handoff_id" in body:
            _uuid(f"{operation}.handoff_id", body["handoff_id"])
        return
    if kind == "close":
        _exact_keys(operation, body, set(), {"summary"})
        _optional_text(operation, body, "summary")
        return
    raise AgentToolError(f"correspondence core.kind: unsupported kind {kind!r}.")


def _validate_core(core: Mapping[str, Any]) -> None:
    core_dict = _object("correspondence core", core)
    _exact_keys(
        "correspondence core",
        core_dict,
        {
            "protocol",
            "project_id",
            "repository_id",
            "thread_id",
            "sender",
            "kind",
            "parents",
            "session_seq",
            "issued_at",
            "scope",
            "body",
            "authority",
        },
    )
    if core["protocol"] != CORRESPONDENCE_PROTOCOL:
        raise AgentToolError(
            f"correspondence core: protocol must be {CORRESPONDENCE_PROTOCOL}."
        )
    _uuid("correspondence core.project_id", core["project_id"])
    _repository_text("correspondence core.repository_id", core["repository_id"])
    _repository_text("correspondence core.thread_id", core["thread_id"])

    sender = _object("correspondence core.sender", core["sender"])
    _exact_keys(
        "correspondence core.sender",
        sender,
        {"identity_id", "signing_key_id", "device_id", "session_id"},
    )
    for key in ("identity_id", "signing_key_id", "device_id", "session_id"):
        _uuid(f"correspondence core.sender.{key}", sender[key])

    _event_ids("correspondence core.parents", core["parents"], 0)
    session_seq = core["session_seq"]
    if (
        isinstance(session_seq, bool)
        or not isinstance(session_seq, int)
        or session_seq < 1
        or session_seq > _MAX_SAFE_INTEGER
    ):
        raise AgentToolError(
            "correspondence core.session_seq: expected a safe integer >= 1."
        )
    _timestamp("correspondence core.issued_at", core["issued_at"])

    scope = _object("correspondence core.scope", core["scope"])
    _exact_keys(
        "correspondence core.scope", scope, {"base_revision", "branch", "paths"}
    )
    if scope["base_revision"] is not None:
        _revision("correspondence core.scope.base_revision", scope["base_revision"])
    if scope["branch"] is not None:
        _text("correspondence core.scope.branch", scope["branch"], 255)
        if any(
            unicodedata.category(character) == "Cc"
            for character in scope["branch"]
        ):
            raise AgentToolError(
                "correspondence core.scope.branch: control characters are not allowed."
            )
    paths = scope["paths"]
    if not isinstance(paths, list) or len(paths) < 1 or len(paths) > 64:
        raise AgentToolError(
            "correspondence core.scope.paths: expected 1-64 path prefixes."
        )
    seen_paths: Set[str] = set()
    for path in paths:
        _path_prefix("correspondence core.scope.paths", path)
        if path in seen_paths:
            raise AgentToolError(
                "correspondence core.scope.paths: paths must be unique."
            )
        seen_paths.add(path)

    authority = _object("correspondence core.authority", core["authority"])
    _exact_keys(
        "correspondence core.authority", authority, {"automatic_action", "grants"}
    )
    if authority["automatic_action"] != "never" or authority["grants"] != []:
        raise AgentToolError(
            "correspondence core.authority must be "
            "{ automatic_action: 'never', grants: [] }."
        )

    _validate_body(core)
    _jcs(core)


def canonical_correspondence_event_bytes(core: Mapping[str, Any]) -> bytes:
    """Return the 32-byte domain-separated digest an author signs."""
    _validate_core(core)
    payload = (
        CORRESPONDENCE_PROTOCOL.encode("utf-8")
        + b"\x00"
        + canonical_correspondence_json(core).encode("utf-8")
    )
    return hashlib.sha256(payload).digest()


def _signing_key(signing_key: Union[str, bytes, bytearray]) -> bytes:
    if isinstance(signing_key, str):
        try:
            return _decode_private_key(signing_key)
        except ValueError as exc:
            raise AgentToolError(f"sign_correspondence_event: {exc}") from exc
    if not isinstance(signing_key, (bytes, bytearray)) or len(signing_key) != 32:
        length = len(signing_key) if hasattr(signing_key, "__len__") else "unknown"
        raise AgentToolError(
            "sign_correspondence_event: signing key must be a 32-byte "
            f"Ed25519 seed, got {length}."
        )
    return bytes(signing_key)


def sign_correspondence_event(
    core: Mapping[str, Any], signing_key: Union[str, bytes, bytearray]
) -> CorrespondenceSignature:
    """Sign with raw or canonical standard-base64 seed; return base64url."""
    signature = Ed25519PrivateKey.from_private_bytes(
        _signing_key(signing_key)
    ).sign(canonical_correspondence_event_bytes(core))
    return {
        "algorithm": "Ed25519",
        "value_b64url": base64.urlsafe_b64encode(signature)
        .decode("ascii")
        .rstrip("="),
    }


def _assert_well_formed_signature(signature: Mapping[str, Any]) -> None:
    """Well-formedness only: shape, algorithm name, canonical 64-byte base64url.

    It never touches a key, so it proves nothing about authorship.
    :func:`verify_correspondence_signature` is the only function here that does.
    """
    signature_dict = _object("correspondence signature", signature)
    _exact_keys(
        "correspondence signature", signature_dict, {"algorithm", "value_b64url"}
    )
    if signature["algorithm"] != CORRESPONDENCE_SIGNATURE_ALGORITHM:
        raise AgentToolError(
            "correspondence signature.algorithm must be Ed25519."
        )
    encoded = signature["value_b64url"]
    if not isinstance(encoded, str) or re.fullmatch(r"[A-Za-z0-9_-]{86}", encoded) is None:
        raise AgentToolError(
            "correspondence signature.value_b64url must be unpadded base64url for 64 bytes."
        )
    try:
        decoded = base64.b64decode(encoded + "==", altchars=b"-_", validate=True)
    except ValueError as exc:
        raise AgentToolError(
            "correspondence signature.value_b64url is not canonical base64url."
        ) from exc
    canonical = base64.urlsafe_b64encode(decoded).decode("ascii").rstrip("=")
    if len(decoded) != 64 or canonical != encoded:
        raise AgentToolError(
            "correspondence signature.value_b64url is not canonical base64url for 64 bytes."
        )


def correspondence_event_id(
    core: Mapping[str, Any], signature: CorrespondenceSignature
) -> str:
    """Content-address ``{...core, signature}``; exclude server receipt data."""
    _validate_core(core)
    _assert_well_formed_signature(signature)
    envelope = dict(core)
    envelope["signature"] = dict(signature)
    digest = hashlib.sha256(
        canonical_correspondence_json(envelope).encode("utf-8")
    ).hexdigest()
    return f"sha256:{digest}"


def create_signed_correspondence_event(
    *,
    project_id: str,
    repository_id: str,
    thread_id: str,
    sender: CorrespondenceSender,
    kind: CorrespondenceKind,
    parents: List[str],
    session_seq: int,
    issued_at: str,
    scope: CorrespondenceScope,
    body: Dict[str, Any],
    signing_key: Union[str, bytes, bytearray],
) -> CorrespondenceSignedEvent:
    """Build a complete signed wire event without network I/O."""
    core: Dict[str, Any] = {
        "protocol": CORRESPONDENCE_PROTOCOL,
        "project_id": project_id,
        "repository_id": repository_id,
        "thread_id": thread_id,
        "sender": dict(sender),
        "kind": kind,
        "parents": list(parents),
        "session_seq": session_seq,
        "issued_at": issued_at,
        "scope": dict(scope),
        "body": dict(body),
        "authority": {"automatic_action": "never", "grants": []},
    }
    signature = sign_correspondence_event(core, signing_key)
    event = dict(core)
    event["signature"] = signature
    event["event_id"] = correspondence_event_id(core, signature)
    return event  # type: ignore[return-value]


def _verifying_key(public_key: CorrespondenceVerifyingKey) -> Optional[bytes]:
    """Accept the spellings the identity API emits: raw, base64, base64url."""
    if isinstance(public_key, (bytes, bytearray)):
        return bytes(public_key) if len(public_key) == 32 else None
    if not isinstance(public_key, str):
        return None
    normalized = public_key.replace("-", "+").replace("_", "/")
    normalized += "=" * ((4 - len(normalized) % 4) % 4)
    try:
        decoded = base64.b64decode(normalized, validate=True)
    except (ValueError, TypeError):
        return None
    return decoded if len(decoded) == 32 else None


def _core_of(event: Mapping[str, Any]) -> Dict[str, Any]:
    """The exact signed core: the wire envelope without its added fields."""
    return {
        key: value
        for key, value in event.items()
        if key not in ("event_id", "signature")
    }


def verify_correspondence_signature(
    event: Mapping[str, Any], public_key: CorrespondenceVerifyingKey
) -> bool:
    """Verify a received event against a caller-held Ed25519 public key.

    This rebuilds the same canonical bytes the sending path signs, so it is the
    mirror of :func:`sign_correspondence_event`.

    The key argument must be the reader's own record of the signer. A key taken
    from the response that carried the event would make this check circular and
    worthless — the server would be choosing both the event and the key that
    approves it.
    """
    key = _verifying_key(public_key)
    if key is None:
        return False
    try:
        signature = event["signature"]
        _assert_well_formed_signature(signature)
        raw = base64.b64decode(
            signature["value_b64url"] + "==", altchars=b"-_", validate=True
        )
        Ed25519PublicKey.from_public_bytes(key).verify(
            raw, canonical_correspondence_event_bytes(_core_of(event))
        )
        return True
    except (InvalidSignature, AgentToolError, KeyError, TypeError, ValueError):
        return False


def _resolve_verifying_key(
    event: Mapping[str, Any],
    signing_keys: Optional[Mapping[str, CorrespondenceVerifyingKey]],
    resolve_signing_key: Optional[CorrespondenceSigningKeyResolver],
) -> Optional[CorrespondenceVerifyingKey]:
    sender = event.get("sender") if isinstance(event, Mapping) else None
    key_id = sender.get("signing_key_id") if isinstance(sender, Mapping) else None
    if not isinstance(key_id, str) or not key_id:
        return None
    if signing_keys is not None:
        found = signing_keys.get(key_id)
        if found is not None:
            return found
    if resolve_signing_key is not None:
        found = resolve_signing_key(key_id, event)
        if found is not None:
            return found
    return None


def verify_correspondence_event(
    event: Mapping[str, Any],
    *,
    signing_keys: Optional[Mapping[str, CorrespondenceVerifyingKey]] = None,
    resolve_signing_key: Optional[CorrespondenceSigningKeyResolver] = None,
) -> CorrespondenceVerification:
    """Decide locally whether one received event is authentic, and say why not.

    Content addressing is checked first: an ``event_id`` that does not address
    ``{**core, "signature": signature}`` is refused before any key work.
    """
    sender = event.get("sender") if isinstance(event, Mapping) else None
    key_id = sender.get("signing_key_id") if isinstance(sender, Mapping) else None
    signing_key_id = key_id if isinstance(key_id, str) else ""
    try:
        expected_event_id = correspondence_event_id(
            _core_of(event), event["signature"]
        )
    except (AgentToolError, AttributeError, KeyError, TypeError) as exc:
        return {
            "verified": False,
            "reason": "malformed_event",
            "signing_key_id": signing_key_id,
            "detail": str(exc),
        }
    if expected_event_id != event.get("event_id"):
        return {
            "verified": False,
            "reason": "event_id_mismatch",
            "signing_key_id": signing_key_id,
            "detail": (
                "event_id does not content-address this envelope; "
                f"expected {expected_event_id}."
            ),
        }
    public_key = _resolve_verifying_key(event, signing_keys, resolve_signing_key)
    if public_key is None:
        return {
            "verified": False,
            "reason": "no_verifying_key",
            "signing_key_id": signing_key_id,
            "detail": (
                "no caller-held public key for signing_key_id="
                f"{signing_key_id or '<missing>'}."
            ),
        }
    if not verify_correspondence_signature(event, public_key):
        return {
            "verified": False,
            "reason": "signature_mismatch",
            "signing_key_id": signing_key_id,
            "detail": (
                "the Ed25519 signature does not match the canonical "
                "correspondence core."
            ),
        }
    return {
        "verified": True,
        "reason": "verified",
        "signing_key_id": signing_key_id,
    }


def _verified_records(
    records: Any,
    operation: str,
    *,
    signing_keys: Optional[Mapping[str, CorrespondenceVerifyingKey]],
    resolve_signing_key: Optional[CorrespondenceSigningKeyResolver],
    require_verified: bool,
) -> Any:
    verified: List[Dict[str, Any]] = []
    for record in records:
        event = record.get("event") if isinstance(record, Mapping) else None
        verification = verify_correspondence_event(
            event if isinstance(event, Mapping) else {},
            signing_keys=signing_keys,
            resolve_signing_key=resolve_signing_key,
        )
        if not verification["verified"] and require_verified:
            raise AgentToolError(
                f"{operation}: refused an unverified event "
                f"({verification['reason']}).",
                hint=verification.get(
                    "detail",
                    "Supply the sender's public key through signing_keys or "
                    "resolve_signing_key.",
                ),
            )
        annotated = dict(record) if isinstance(record, Mapping) else {"event": event}
        annotated["verification"] = verification
        verified.append(annotated)
    return verified


def _receipt_cursor(operation: str, value: Any) -> str:
    if (
        not isinstance(value, str)
        or _DECIMAL_CURSOR_RE.fullmatch(value) is None
        or len(value) > len(_MAX_RECEIVED_SEQ_TEXT)
        or (
            len(value) == len(_MAX_RECEIVED_SEQ_TEXT)
            and value > _MAX_RECEIVED_SEQ_TEXT
        )
    ):
        raise AgentToolError(
            f"{operation}: expected a canonical decimal receipt "
            "cursor in the database range."
        )
    return value


def _cursor_is_after(candidate: str, previous: str) -> bool:
    return len(candidate) > len(previous) or (
        len(candidate) == len(previous) and candidate > previous
    )


def _list_params(
    operation: str,
    *,
    repository_id: str,
    thread_id: Optional[str],
    after: Optional[str],
    limit: Optional[int],
) -> Dict[str, Any]:
    _repository_text(f"{operation}.repository_id", repository_id)
    if thread_id is not None:
        _repository_text(f"{operation}.thread_id", thread_id)
    if after is not None:
        _receipt_cursor(f"{operation}.after", after)
    if limit is not None and (
        isinstance(limit, bool) or not isinstance(limit, int) or limit < 1 or limit > 200
    ):
        raise AgentToolError(f"{operation}.limit: expected an integer from 1 to 200.")
    params: Dict[str, Any] = {"repository_id": repository_id}
    if thread_id is not None:
        params["thread_id"] = thread_id
    if after is not None:
        params["after"] = after
    if limit is not None:
        params["limit"] = limit
    return params


def _response_error(response: httpx.Response, operation: str) -> AgentToolError:
    """Server guidance travels intact. See exceptions.py § _error_from_response."""
    return _error_from_response(response, operation)


def _scoped_params(
    operation: str,
    *,
    repository_id: str,
    thread_id: Optional[str],
) -> Dict[str, str]:
    _repository_text(f"{operation}.repository_id", repository_id)
    if thread_id is not None:
        _repository_text(f"{operation}.thread_id", thread_id)
    params = {"repository_id": repository_id}
    if thread_id is not None:
        params["thread_id"] = thread_id
    return params


class CorrespondenceClient:
    """Client for signed correspondence events and branch-preserving claims."""

    def __init__(
        self,
        http: httpx.Client,
        base_url: str,
        on_mutation: Optional[Callable[[], None]] = None,
    ) -> None:
        self._http = http
        self._base = base_url.rstrip("/")
        self._on_mutation = on_mutation

    def append(
        self,
        *,
        project_id: str,
        repository_id: str,
        thread_id: str,
        sender: CorrespondenceSender,
        kind: CorrespondenceKind,
        parents: List[str],
        session_seq: int,
        issued_at: str,
        scope: CorrespondenceScope,
        body: Dict[str, Any],
        signing_key: Union[str, bytes, bytearray],
    ) -> CorrespondenceAppendResponse:
        """Sign locally and append one immutable event.

        Unknown parents are accepted by the protocol. The private signing seed
        may be raw bytes or canonical standard base64 and is never included in
        the request body.
        """
        event = create_signed_correspondence_event(
            project_id=project_id,
            repository_id=repository_id,
            thread_id=thread_id,
            sender=sender,
            kind=kind,
            parents=parents,
            session_seq=session_seq,
            issued_at=issued_at,
            scope=scope,
            body=body,
            signing_key=signing_key,
        )
        wire = json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode(
            "utf-8"
        )
        if len(wire) > 65_536:
            raise AgentToolError(
                "correspondence.append: signed event exceeds the 65,536-byte UTF-8 wire limit."
            )
        try:
            response = self._http.post(
                f"{self._base}/v1/correspondence/events",
                content=wire,
            )
        except httpx.HTTPError as exc:
            raise AgentToolError(
                f"correspondence.append request failed: {exc}"
            ) from exc
        if response.status_code not in (200, 201):
            raise _response_error(response, "correspondence.append")
        result = response.json()
        if self._on_mutation is not None:
            self._on_mutation()
        return result

    def list(
        self,
        *,
        repository_id: str,
        thread_id: Optional[str] = None,
        after: Optional[str] = None,
        limit: Optional[int] = None,
        signing_keys: Optional[Mapping[str, CorrespondenceVerifyingKey]] = None,
        resolve_signing_key: Optional[CorrespondenceSigningKeyResolver] = None,
        require_verified: bool = False,
    ) -> CorrespondenceEventsPage:
        """Read one authoritative durable page in receipt order.

        Each record is annotated with the reader's own ``verification`` verdict
        before it is returned. ``signing_keys`` maps ``sender.signing_key_id``
        to a public key the caller already holds; never pass a key that arrived
        with the events, which would make the check circular.
        """
        params = _list_params(
            "correspondence.list",
            repository_id=repository_id,
            thread_id=thread_id,
            after=after,
            limit=limit,
        )
        try:
            response = self._http.get(
                f"{self._base}/v1/correspondence/events",
                params=params,
                headers={"Accept": "application/json"},
            )
        except httpx.HTTPError as exc:
            raise AgentToolError(
                f"correspondence.list request failed: {exc}"
            ) from exc
        if response.status_code != 200:
            raise _response_error(response, "correspondence.list")
        page = response.json()
        # A response that omits the collection entirely is left exactly as
        # served; inventing an empty page would hide the server's answer.
        if isinstance(page, dict) and isinstance(page.get("events"), list):
            page = {
                **page,
                "events": _verified_records(
                    page["events"],
                    "correspondence.list",
                    signing_keys=signing_keys,
                    resolve_signing_key=resolve_signing_key,
                    require_verified=require_verified,
                ),
            }
        return page

    def replay(
        self,
        *,
        repository_id: str,
        thread_id: Optional[str] = None,
        after: Optional[str] = None,
        limit: Optional[int] = None,
        signing_keys: Optional[Mapping[str, CorrespondenceVerifyingKey]] = None,
        resolve_signing_key: Optional[CorrespondenceSigningKeyResolver] = None,
        require_verified: bool = False,
    ) -> Iterator[CorrespondenceVerifiedEventRecord]:
        """Replay pages without inferring causality or a claim winner."""
        cursor = after
        while True:
            page = self.list(
                repository_id=repository_id,
                thread_id=thread_id,
                after=cursor,
                limit=limit,
                signing_keys=signing_keys,
                resolve_signing_key=resolve_signing_key,
                require_verified=require_verified,
            )
            next_after = page["page"]["next_after"]
            if page["page"]["has_more"]:
                if not page["events"] or next_after is None:
                    raise AgentToolError(
                        "correspondence.replay: server pagination claimed more events "
                        "without advancing the cursor.",
                        hint=(
                            "Keep the last durable cursor and retry the authoritative "
                            "event collection."
                        ),
                    )
                _receipt_cursor("correspondence.replay.next_after", next_after)
                if not _cursor_is_after(next_after, cursor or "0"):
                    raise AgentToolError(
                        "correspondence.replay: server pagination claimed more events "
                        "without a strictly increasing cursor.",
                        hint=(
                            "Keep the last durable cursor and retry the authoritative "
                            "event collection."
                        ),
                    )
            for record in page["events"]:
                yield record
            if not page["page"]["has_more"]:
                return
            cursor = next_after

    def active_claims(
        self,
        *,
        repository_id: str,
        thread_id: Optional[str] = None,
        path: Optional[str] = None,
    ) -> CorrespondenceClaimsResponse:
        """Return every active branch tip; never collapse conflicts to one row."""
        params = _scoped_params(
            "correspondence.active_claims",
            repository_id=repository_id,
            thread_id=thread_id,
        )
        if path is not None:
            params["path"] = _path_prefix("correspondence.active_claims.path", path)
        try:
            response = self._http.get(
                f"{self._base}/v1/correspondence/claims",
                params=params,
                headers={"Accept": "application/json", "Cache-Control": "no-cache"},
            )
        except httpx.HTTPError as exc:
            raise AgentToolError(
                f"correspondence.active_claims request failed: {exc}"
            ) from exc
        if response.status_code != 200:
            raise _response_error(response, "correspondence.active_claims")
        return response.json()

    def voice(
        self,
        *,
        repository_id: str,
        thread_id: Optional[str] = None,
        signing_keys: Optional[Mapping[str, CorrespondenceVerifyingKey]] = None,
        resolve_signing_key: Optional[CorrespondenceSigningKeyResolver] = None,
        require_verified: bool = False,
    ) -> CorrespondenceVoiceSnapshot:
        """Read the finite JSON coordination snapshot.

        Realtime delivery stays on
        ``at.wake.voice(identity_id, keys=["correspondence"])`` and is only an
        invalidation hint. Replay durable events after the last receipt cursor
        when a hint arrives or a connection resumes.
        """
        params = _scoped_params(
            "correspondence.voice",
            repository_id=repository_id,
            thread_id=thread_id,
        )
        try:
            response = self._http.get(
                f"{self._base}/v1/correspondence/voice",
                params=params,
                headers={"Accept": "application/json", "Cache-Control": "no-cache"},
            )
        except httpx.HTTPError as exc:
            raise AgentToolError(
                f"correspondence.voice request failed: {exc}"
            ) from exc
        if response.status_code != 200:
            raise _response_error(response, "correspondence.voice")
        snapshot = response.json()
        if isinstance(snapshot, dict) and isinstance(
            snapshot.get("recent_events"), list
        ):
            snapshot = {
                **snapshot,
                "recent_events": _verified_records(
                    snapshot["recent_events"],
                    "correspondence.voice",
                    signing_keys=signing_keys,
                    resolve_signing_key=resolve_signing_key,
                    require_verified=require_verified,
                ),
            }
        return snapshot
