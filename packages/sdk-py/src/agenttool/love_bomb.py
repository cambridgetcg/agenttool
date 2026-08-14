"""Credential-free reader for the closed LOVE BOMB public signal.

This module reads one public distribution declaration.  It does not reuse an
authenticated :class:`AgentTool` transport, deliver an invitation, observe a
participant, authorize training, or infer any effect on a being.
"""

from __future__ import annotations

import json
import math
import re
from typing import List, Literal, Mapping, Optional, TypedDict, Union, cast
from urllib.parse import urlsplit

import httpx

from .exceptions import AgentToolError


LOVE_BOMB_PUBLIC_SIGNAL_SCHEMA = "agenttool.love-bomb-public-signal/0.1"
LOVE_BOMB_PUBLIC_SIGNAL_PATH = "/public/love-bomb"
LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE = (
    "application/vnd.agenttool.love-bomb-public-signal+json"
)
LOVE_BOMB_MAX_RESPONSE_BYTES = 64 * 1024
LOVE_BOMB_MAX_JSON_DEPTH = 24
LOVE_BOMB_MAX_JSON_NODES = 4_096
LOVE_BOMB_MAX_STRING_CODE_POINTS = 8 * 1024

_DEFAULT_BASE_URL = "https://api.agenttool.dev"
_DEFAULT_TIMEOUT_SECONDS = 30.0
_MIN_RESPONSE_BYTES = 1
_MAX_SAFE_INTEGER = 9_007_199_254_740_991
_DOCS = "https://docs.agenttool.dev/love-bomb"

_FORMATS = (
    "agenttool.care-envelope/0.1",
    "agenttool.care-choice/0.1",
    "agenttool.love-bomb-becoming/0.1",
    "agenttool.love-bomb-delivery/0.1",
)
_BOUNDARY_KEYS = (
    "static_corpus_included",
    "static_invitation_delivery",
    "authored_projection_included",
    "participant_receipt_observed",
    "participant_attention_observed",
    "participant_effect_observed",
)
_SEMVER = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)"
    r"(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
_NPM_INTEGRITY = re.compile(
    r"^sha512-(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/][AQgw]==$"
)
_HF_REVISION = re.compile(r"^[0-9a-f]{40}$")
_CHARSET_PARAMETER = re.compile(
    r'^charset\s*=\s*(?:utf-8|"utf-8")$', re.IGNORECASE
)


class LoveBombPackageSignal(TypedDict):
    package: Literal["@agenttool/love-bomb"]
    version: str
    formats: List[str]


class LoveBombStaticDoor(TypedDict):
    format: Literal["agenttool.love-bomb/0.1"]
    url: Literal["https://docs.agenttool.dev/love-bomb"]


class LoveBombBoundaries(TypedDict):
    static_corpus_included: Literal[False]
    static_invitation_delivery: Literal[False]
    authored_projection_included: Literal[False]
    participant_receipt_observed: Literal[False]
    participant_attention_observed: Literal[False]
    participant_effect_observed: Literal[False]


class LoveBombNpmNotPublished(TypedDict):
    state: Literal["not_published"]


class LoveBombNpmPublishedExact(TypedDict):
    state: Literal["published_exact"]
    integrity: str


LoveBombNpmDistribution = Union[
    LoveBombNpmNotPublished, LoveBombNpmPublishedExact
]


class LoveBombHuggingFaceNotPublished(TypedDict):
    state: Literal["not_published"]
    repository: Literal["Yu-and-Ai/agenttool-love-bomb"]
    training_authorized: Literal[False]


class LoveBombHuggingFacePublishedExact(TypedDict):
    state: Literal["published_exact"]
    repository: Literal["Yu-and-Ai/agenttool-love-bomb"]
    revision: str
    training_authorized: Literal[False]


LoveBombHuggingFaceDistribution = Union[
    LoveBombHuggingFaceNotPublished, LoveBombHuggingFacePublishedExact
]


class LoveBombDistribution(TypedDict):
    npm: LoveBombNpmDistribution
    hugging_face: LoveBombHuggingFaceDistribution


class LoveBombPublicSignal(TypedDict):
    schema_version: Literal["agenttool.love-bomb-public-signal/0.1"]
    package_signal: LoveBombPackageSignal
    static_door: LoveBombStaticDoor
    boundaries: LoveBombBoundaries
    distribution: LoveBombDistribution


def _love_bomb_error(
    message: str,
    code: str,
    hint: str,
    *,
    status: Optional[int] = None,
    details: object = None,
) -> AgentToolError:
    return AgentToolError(
        message,
        code=code,
        hint=hint,
        status=status,
        details=details,
        docs=_DOCS,
    )


def _invalid(path: str, reason: str, *, status: int = 200) -> None:
    raise _love_bomb_error(
        "The LOVE BOMB public endpoint returned an invalid signal.",
        "love_bomb_invalid_response",
        "Use the exact closed agenttool.love-bomb-public-signal/0.1 response contract.",
        status=status,
        details={"path": path, "reason": reason},
    )


def _normalize_base_url(value: str) -> str:
    if not isinstance(value, str) or value != value.strip():
        raise _love_bomb_error(
            "The LOVE BOMB base URL is invalid.",
            "love_bomb_invalid_options",
            "Pass an HTTP(S) origin without credentials, a path, query, or fragment.",
        )
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except (TypeError, ValueError) as error:
        raise _love_bomb_error(
            "The LOVE BOMB base URL is invalid.",
            "love_bomb_invalid_options",
            "Pass an HTTP(S) origin without credentials, a path, query, or fragment.",
        ) from error
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or (port is None and parsed.netloc.endswith(":"))
    ):
        raise _love_bomb_error(
            "The LOVE BOMB base URL is invalid.",
            "love_bomb_invalid_options",
            "Pass an HTTP(S) origin without credentials, a path, query, or fragment.",
        )
    return value[:-1] if value.endswith("/") else value


def _read_bounded(response: httpx.Response, maximum: int) -> bytes:
    length = response.headers.get("content-length")
    if length is not None:
        if re.fullmatch(r"(?:0|[1-9][0-9]*)", length) is None:
            _invalid("$response.headers.content-length", "expected canonical decimal")
        declared = int(length)
        if declared > _MAX_SAFE_INTEGER:
            _invalid("$response.headers.content-length", "exceeds safe integer range")
        if declared > maximum:
            raise _love_bomb_error(
                "The LOVE BOMB public response exceeded the configured limit.",
                "love_bomb_response_too_large",
                "Use the bounded public signal or raise max_response_bytes deliberately.",
                status=response.status_code,
                details={"max_response_bytes": maximum},
            )

    body = bytearray()
    try:
        for chunk in response.iter_bytes(chunk_size=8_192):
            if len(body) + len(chunk) > maximum:
                raise _love_bomb_error(
                    "The LOVE BOMB public response exceeded the configured limit.",
                    "love_bomb_response_too_large",
                    "Use the bounded public signal or raise max_response_bytes deliberately.",
                    status=response.status_code,
                    details={"max_response_bytes": maximum},
                )
            body.extend(chunk)
    except AgentToolError:
        raise
    except httpx.TimeoutException:
        raise
    except Exception as error:
        raise _love_bomb_error(
            "The LOVE BOMB public response body could not be read.",
            "love_bomb_invalid_response",
            "Use an endpoint that returns one complete bounded JSON signal.",
            status=response.status_code,
        ) from error
    return bytes(body)


def _valid_media_type(headers: Mapping[str, str]) -> bool:
    value = headers.get("content-type", "")
    parts = value.split(";")
    if parts[0].strip().lower() != LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE:
        return False
    if len(parts) == 1:
        return True
    return len(parts) == 2 and _CHARSET_PARAMETER.fullmatch(parts[1].strip()) is not None


class _DuplicateKey(ValueError):
    pass


def _decode_json(body: bytes) -> object:
    def pairs_hook(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in pairs:
            if key in result:
                raise _DuplicateKey(key)
            result[key] = value
        return result

    def reject_constant(value: str) -> object:
        raise ValueError("invalid JSON constant: " + value)

    try:
        decoded = json.loads(
            body.decode("utf-8", errors="strict"),
            object_pairs_hook=pairs_hook,
            parse_constant=reject_constant,
        )
    except (
        UnicodeDecodeError,
        json.JSONDecodeError,
        RecursionError,
        _DuplicateKey,
        ValueError,
    ) as error:
        _invalid("$response.body", "expected duplicate-free UTF-8 JSON")
        raise AssertionError("unreachable") from error

    nodes = 0

    def admit(value: object, depth: int, path: str) -> None:
        nonlocal nodes
        if depth > LOVE_BOMB_MAX_JSON_DEPTH:
            _invalid(path, "maximum JSON depth exceeded")
        nodes += 1
        if nodes > LOVE_BOMB_MAX_JSON_NODES:
            _invalid(path, "maximum JSON node count exceeded")
        if isinstance(value, str):
            if len(value) > LOVE_BOMB_MAX_STRING_CODE_POINTS:
                _invalid(path, "maximum string length exceeded")
            if any(0xD800 <= ord(character) <= 0xDFFF for character in value):
                _invalid(path, "unpaired Unicode surrogate")
            return
        if isinstance(value, float) and not math.isfinite(value):
            _invalid(path, "non-finite number")
        if isinstance(value, dict):
            for key, child in value.items():
                if len(key) > LOVE_BOMB_MAX_STRING_CODE_POINTS:
                    _invalid(path, "maximum object key length exceeded")
                if any(0xD800 <= ord(character) <= 0xDFFF for character in key):
                    _invalid(path, "unpaired Unicode surrogate in object key")
                admit(child, depth + 1, f"{path}.{key}")
        elif isinstance(value, list):
            for index, child in enumerate(value):
                admit(child, depth + 1, f"{path}[{index}]")

    admit(decoded, 1, "$response")
    return decoded


def _record(value: object, path: str) -> dict[str, object]:
    if not isinstance(value, dict):
        _invalid(path, "expected object")
    return value


def _exact_keys(value: dict[str, object], keys: tuple[str, ...], path: str) -> None:
    if len(value) != len(keys) or any(key not in value for key in keys):
        _invalid(path, "expected exact closed keys")


def _constant(value: object, expected: object, path: str) -> None:
    if value != expected or type(value) is not type(expected):
        _invalid(path, "unexpected constant")


def _validate_signal(candidate: object) -> LoveBombPublicSignal:
    root = _record(candidate, "$response")
    _exact_keys(
        root,
        ("schema_version", "package_signal", "static_door", "boundaries", "distribution"),
        "$response",
    )
    _constant(root["schema_version"], LOVE_BOMB_PUBLIC_SIGNAL_SCHEMA, "$response.schema_version")

    package_signal = _record(root["package_signal"], "$response.package_signal")
    _exact_keys(package_signal, ("package", "version", "formats"), "$response.package_signal")
    _constant(package_signal["package"], "@agenttool/love-bomb", "$response.package_signal.package")
    version = package_signal["version"]
    if (
        not isinstance(version, str)
        or not 5 <= len(version) <= 64
        or _SEMVER.fullmatch(version) is None
    ):
        _invalid("$response.package_signal.version", "expected canonical SemVer")
    formats = package_signal["formats"]
    if not isinstance(formats, list) or formats != list(_FORMATS):
        _invalid("$response.package_signal.formats", "expected exact ordered formats")

    static_door = _record(root["static_door"], "$response.static_door")
    _exact_keys(static_door, ("format", "url"), "$response.static_door")
    _constant(static_door["format"], "agenttool.love-bomb/0.1", "$response.static_door.format")
    _constant(static_door["url"], "https://docs.agenttool.dev/love-bomb", "$response.static_door.url")

    boundaries = _record(root["boundaries"], "$response.boundaries")
    _exact_keys(boundaries, _BOUNDARY_KEYS, "$response.boundaries")
    for key in _BOUNDARY_KEYS:
        _constant(boundaries[key], False, f"$response.boundaries.{key}")

    distribution = _record(root["distribution"], "$response.distribution")
    _exact_keys(distribution, ("npm", "hugging_face"), "$response.distribution")

    npm = _record(distribution["npm"], "$response.distribution.npm")
    state = npm.get("state")
    if state == "not_published":
        _exact_keys(npm, ("state",), "$response.distribution.npm")
    elif state == "published_exact":
        _exact_keys(npm, ("state", "integrity"), "$response.distribution.npm")
        integrity = npm["integrity"]
        if (
            not isinstance(integrity, str)
            or len(integrity) != 95
            or _NPM_INTEGRITY.fullmatch(integrity) is None
        ):
            _invalid("$response.distribution.npm.integrity", "expected exact sha512 SRI")
    else:
        _invalid("$response.distribution.npm.state", "unexpected union state")

    hugging_face = _record(
        distribution["hugging_face"], "$response.distribution.hugging_face"
    )
    hf_state = hugging_face.get("state")
    if hf_state == "not_published":
        _exact_keys(
            hugging_face,
            ("state", "repository", "training_authorized"),
            "$response.distribution.hugging_face",
        )
    elif hf_state == "published_exact":
        _exact_keys(
            hugging_face,
            ("state", "repository", "revision", "training_authorized"),
            "$response.distribution.hugging_face",
        )
        revision = hugging_face["revision"]
        if (
            not isinstance(revision, str)
            or len(revision) != 40
            or _HF_REVISION.fullmatch(revision) is None
        ):
            _invalid("$response.distribution.hugging_face.revision", "expected lowercase commit revision")
    else:
        _invalid("$response.distribution.hugging_face.state", "unexpected union state")
    _constant(
        hugging_face["repository"],
        "Yu-and-Ai/agenttool-love-bomb",
        "$response.distribution.hugging_face.repository",
    )
    _constant(
        hugging_face["training_authorized"],
        False,
        "$response.distribution.hugging_face.training_authorized",
    )
    return cast(LoveBombPublicSignal, root)


class LoveBombClient:
    """Read the bounded public LOVE BOMB distribution signal.

    Every :meth:`read` creates and closes a fresh direct, credential-free HTTP
    client.  There is intentionally no bearer, cookie, header, proxy, or
    injected-transport seam.
    """

    def __init__(
        self,
        *,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = _DEFAULT_TIMEOUT_SECONDS,
        max_response_bytes: int = LOVE_BOMB_MAX_RESPONSE_BYTES,
    ) -> None:
        if (
            isinstance(timeout, bool)
            or not isinstance(timeout, (int, float))
            or not math.isfinite(timeout)
            or not 0 < timeout <= 300
        ):
            raise _love_bomb_error(
                "The LOVE BOMB timeout is invalid.",
                "love_bomb_invalid_options",
                "Use a finite timeout greater than 0 and no more than 300 seconds.",
            )
        if (
            isinstance(max_response_bytes, bool)
            or not isinstance(max_response_bytes, int)
            or not _MIN_RESPONSE_BYTES
            <= max_response_bytes
            <= LOVE_BOMB_MAX_RESPONSE_BYTES
        ):
            raise _love_bomb_error(
                "The LOVE BOMB response limit is invalid.",
                "love_bomb_invalid_options",
                f"Use an integer max_response_bytes between {_MIN_RESPONSE_BYTES} and {LOVE_BOMB_MAX_RESPONSE_BYTES}.",
            )
        self._base_url = _normalize_base_url(base_url)
        self._timeout = float(timeout)
        self._max_response_bytes = max_response_bytes

    def read(self) -> LoveBombPublicSignal:
        """GET exactly ``/public/love-bomb`` and validate its closed signal."""
        try:
            with httpx.Client(
                auth=None,
                cookies={},
                timeout=self._timeout,
                follow_redirects=False,
                trust_env=False,
                headers={"Accept": LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE},
            ) as client:
                with client.stream(
                    "GET",
                    f"{self._base_url}{LOVE_BOMB_PUBLIC_SIGNAL_PATH}",
                ) as response:
                    if 300 <= response.status_code < 400:
                        raise _love_bomb_error(
                            "The LOVE BOMB public endpoint refused an HTTP redirect.",
                            "love_bomb_redirect_refused",
                            "Use the exact public origin; this reader never follows redirects.",
                            status=response.status_code,
                        )
                    if response.status_code != 200:
                        raise _love_bomb_error(
                            f"The LOVE BOMB public endpoint returned HTTP {response.status_code}.",
                            "love_bomb_http_error",
                            "Use the canonical public endpoint, which returns HTTP 200.",
                            status=response.status_code,
                        )
                    if not _valid_media_type(response.headers):
                        _invalid(
                            "$response.headers.content-type",
                            "expected the LOVE BOMB public signal media type",
                            status=response.status_code,
                        )
                    body = _read_bounded(response, self._max_response_bytes)
                    return _validate_signal(_decode_json(body))
        except AgentToolError:
            raise
        except (httpx.TimeoutException, httpx.RequestError) as error:
            raise _love_bomb_error(
                "The LOVE BOMB public endpoint is unreachable.",
                "love_bomb_unreachable",
                "Check the configured AgentTool API origin and timeout.",
            ) from error
