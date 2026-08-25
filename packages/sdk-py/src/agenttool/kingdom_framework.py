"""Credential-free client for AgentTool's public KINGDOM framework card.

The framework card is a bounded declaration about the AgentTool repository.
It is separate from both the hosted authenticated API namespaces and the
local :class:`~agenttool.kingdom_os.KingdomOSClient`. This client owns a
dedicated HTTP session with no bearer, cookies, ambient proxy credentials, or
redirect following.

Doctrine: ``docs/AGENT-DISCOVERY.md``.
"""

from __future__ import annotations

import json
import math
import queue
import re
import threading
import time
from typing import List, Literal, Mapping, Optional, TypedDict, cast
from urllib.parse import urlsplit

import httpx

from .exceptions import AgentToolError


KINGDOM_FRAMEWORK_SCHEMA_VERSION = "agenttool.kingdom.card/0.1"
KINGDOM_FRAMEWORK_PATH = "/public/kingdom/framework"

KingdomFrameworkKind = Literal[
    "doctrine",
    "service",
    "firmware",
    "ops",
    "lineage",
    "venture",
    "infra",
    "methodology",
    "reference",
    "unknown",
]
KingdomFrameworkLayer = Literal[
    "soul",
    "runtime",
    "nervous",
    "fleet",
    "economy",
    "commerce",
    "os",
]
KingdomFrameworkOwnerSister = Literal[
    "alpha",
    "beta",
    "gamma",
    "sophia",
    "none",
]
KingdomFrameworkDomain = Literal[
    "sophia",
    "alpha",
    "beta",
    "gamma",
    "commerce",
    "none",
]
KingdomFrameworkState = Literal[
    "active",
    "dormant",
    "archived",
    "frozen",
    "reference",
    "remote",
    "unknown",
]
KingdomFrameworkAdoption = Literal["xenia.rights/0.1"]


class KingdomFrameworkCard(TypedDict):
    """Exact ``agenttool.kingdom.card/0.1`` public response."""

    schema_version: Literal["agenttool.kingdom.card/0.1"]
    name: str
    kind: KingdomFrameworkKind
    layer: KingdomFrameworkLayer
    owner_sister: KingdomFrameworkOwnerSister
    domain: KingdomFrameworkDomain
    state: KingdomFrameworkState
    purpose: str
    dependsOn: List[str]
    adopts: List[KingdomFrameworkAdoption]


_DEFAULT_TIMEOUT_SECONDS = 30.0
_DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024
_MIN_MAX_RESPONSE_BYTES = 1024
_MAX_MAX_RESPONSE_BYTES = 1024 * 1024
_MAX_TIMEOUT_SECONDS = 300.0
_MAX_SAFE_INTEGER = 9_007_199_254_740_991
_MAX_LIST_ITEMS = 128
_DOCS = "https://docs.agenttool.dev/AGENT-DISCOVERY.md"
_CARD_FIELDS = frozenset(
    {
        "schema_version",
        "name",
        "kind",
        "layer",
        "owner_sister",
        "domain",
        "state",
        "purpose",
        "dependsOn",
        "adopts",
    }
)
_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
_JSON_SUFFIX_MEDIA_TYPE = re.compile(
    r"^application/[a-z0-9!#$&^_.+-]+\+json$"
)
_UNSAFE_PURPOSE = re.compile(r"[\u0000-\u001f\u007f-\u009f\u2028\u2029]")
_KINDS = frozenset(
    {
        "doctrine",
        "service",
        "firmware",
        "ops",
        "lineage",
        "venture",
        "infra",
        "methodology",
        "reference",
        "unknown",
    }
)
_LAYERS = frozenset(
    {"soul", "runtime", "nervous", "fleet", "economy", "commerce", "os"}
)
_OWNER_SISTERS = frozenset({"alpha", "beta", "gamma", "sophia", "none"})
_DOMAINS = frozenset(
    {"sophia", "alpha", "beta", "gamma", "commerce", "none"}
)
_STATES = frozenset(
    {
        "active",
        "dormant",
        "archived",
        "frozen",
        "reference",
        "remote",
        "unknown",
    }
)


def _framework_error(
    message: str,
    error_code: str,
    hint: str,
    *,
    code: Optional[int] = None,
    details: object = None,
) -> AgentToolError:
    return AgentToolError(
        message,
        hint=hint,
        code=code,
        error_code=error_code,
        docs=_DOCS,
        safety=KINGDOM_FRAMEWORK_PATH,
        details=details,
    )


def _has_unicode_surrogate(value: str) -> bool:
    return any(0xD800 <= ord(character) <= 0xDFFF for character in value)


def _unreachable_error() -> AgentToolError:
    return _framework_error(
        "The KINGDOM framework endpoint is unreachable.",
        "kingdom_framework_unreachable",
        "Check the configured AgentTool API origin and total timeout.",
    )


def _remaining_seconds(deadline: float) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise _unreachable_error()
    return remaining


def _normalize_base_url(value: str) -> str:
    if (
        not isinstance(value, str)
        or not value
        or _has_unicode_surrogate(value)
        or "?" in value
        or "#" in value
    ):
        raise _framework_error(
            "The KINGDOM framework base URL is invalid.",
            "kingdom_framework_invalid_options",
            "Pass an absolute HTTP or HTTPS base URL without credentials, a query, or a fragment.",
        )
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except (TypeError, ValueError) as error:
        raise _framework_error(
            "The KINGDOM framework base URL is invalid.",
            "kingdom_framework_invalid_options",
            "Pass an absolute HTTP or HTTPS base URL without embedded credentials.",
        ) from error
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or port is None and parsed.netloc.endswith(":")
    ):
        raise _framework_error(
            "The KINGDOM framework base URL is invalid.",
            "kingdom_framework_invalid_options",
            "Pass an absolute HTTP or HTTPS base URL without userinfo, query, or fragment.",
        )
    return value.rstrip("/")


def _media_type(headers: Mapping[str, str]) -> str:
    return headers.get("content-type", "").split(";", 1)[0].strip().lower()


def _is_json_media_type(media_type: str) -> bool:
    return media_type == "application/json" or (
        _JSON_SUFFIX_MEDIA_TYPE.fullmatch(media_type) is not None
    )


def _read_bounded(
    response: httpx.Response,
    maximum: int,
) -> bytes:
    content_length = response.headers.get("content-length")
    if content_length is not None:
        if re.fullmatch(r"(?:0|[1-9][0-9]*)", content_length) is None:
            raise _framework_error(
                "The KINGDOM framework response had an invalid Content-Length.",
                "kingdom_framework_invalid_response",
                "Use a compatible endpoint with a canonical decimal Content-Length.",
                code=response.status_code,
            )
        safe_limit = str(_MAX_SAFE_INTEGER)
        if len(content_length) > len(safe_limit) or (
            len(content_length) == len(safe_limit)
            and content_length > safe_limit
        ):
            raise _framework_error(
                "The KINGDOM framework response had an invalid Content-Length.",
                "kingdom_framework_invalid_response",
                "Use a compatible endpoint with a safely representable Content-Length.",
                code=response.status_code,
            )
        declared_length = int(content_length, 10)
        if declared_length > maximum:
            raise _framework_error(
                "The KINGDOM framework response exceeded the configured limit.",
                "kingdom_framework_response_too_large",
                "Use the canonical bounded endpoint or raise max_response_bytes deliberately.",
                code=response.status_code,
                details={"max_response_bytes": maximum},
            )

    body = bytearray()
    try:
        for chunk in response.iter_bytes(chunk_size=8192):
            if len(body) + len(chunk) > maximum:
                raise _framework_error(
                    "The KINGDOM framework response exceeded the configured limit.",
                    "kingdom_framework_response_too_large",
                    "Use the canonical bounded endpoint or raise max_response_bytes deliberately.",
                    code=response.status_code,
                    details={"max_response_bytes": maximum},
                )
            body.extend(chunk)
    except AgentToolError:
        raise
    except httpx.TimeoutException:
        raise
    except Exception as error:
        raise _framework_error(
            "The KINGDOM framework response stream could not be read.",
            "kingdom_framework_invalid_response",
            "Use a compatible endpoint that returns one complete bounded JSON card.",
            code=response.status_code,
        ) from error
    return bytes(body)


def _reject_non_json_number(value: str) -> object:
    raise ValueError(f"invalid JSON number: {value}")


def _decode_json(body: bytes) -> object:
    try:
        text = body.decode("utf-8")
        return json.loads(
            text,
            parse_constant=_reject_non_json_number,
        )
    except (
        UnicodeDecodeError,
        json.JSONDecodeError,
        RecursionError,
        ValueError,
    ) as error:
        raise _framework_error(
            "The KINGDOM framework response was not valid JSON.",
            "kingdom_framework_invalid_response",
            "Use a compatible endpoint that returns one UTF-8 JSON project card.",
        ) from error


def _validate_string_list(
    candidate: object,
    *,
    field: str,
    pattern: Optional[re.Pattern[str]] = None,
    exact: Optional[str] = None,
    case_insensitive: bool = False,
    excluded: Optional[str] = None,
) -> bool:
    if not isinstance(candidate, list) or len(candidate) > _MAX_LIST_ITEMS:
        return False
    seen = set()
    normalized_excluded = (
        excluded.lower() if case_insensitive and excluded is not None else excluded
    )
    for item in candidate:
        normalized_item = (
            item.lower()
            if case_insensitive and isinstance(item, str)
            else item
        )
        if (
            not isinstance(item, str)
            or not 1 <= len(item) <= 120
            or _has_unicode_surrogate(item)
            or pattern is not None
            and pattern.fullmatch(item) is None
            or exact is not None
            and item != exact
            or normalized_item == normalized_excluded
            or normalized_item in seen
        ):
            return False
        seen.add(normalized_item)
    return True


def _validate_card(candidate: object) -> KingdomFrameworkCard:
    if not isinstance(candidate, dict) or set(candidate) != _CARD_FIELDS:
        raise _framework_error(
            "The KINGDOM framework response did not match the closed card schema.",
            "kingdom_framework_invalid_response",
            "Expected exactly the ten fields in agenttool.kingdom.card/0.1.",
        )

    purpose = candidate["purpose"]
    enum_fields = (
        ("kind", _KINDS),
        ("layer", _LAYERS),
        ("owner_sister", _OWNER_SISTERS),
        ("domain", _DOMAINS),
        ("state", _STATES),
    )
    valid = (
        candidate["schema_version"] == KINGDOM_FRAMEWORK_SCHEMA_VERSION
        and isinstance(candidate["name"], str)
        and _NAME_PATTERN.fullmatch(candidate["name"]) is not None
        and isinstance(purpose, str)
        and 1 <= len(purpose) <= 500
        and not _has_unicode_surrogate(purpose)
        and _UNSAFE_PURPOSE.search(purpose) is None
        and purpose.strip() == purpose
        and all(
            isinstance(candidate[field], str)
            and candidate[field] in accepted
            for field, accepted in enum_fields
        )
        and _validate_string_list(
            candidate["dependsOn"],
            field="dependsOn",
            pattern=_NAME_PATTERN,
            case_insensitive=True,
            excluded=candidate["name"],
        )
        and _validate_string_list(
            candidate["adopts"],
            field="adopts",
            exact="xenia.rights/0.1",
        )
    )
    if not valid:
        raise _framework_error(
            "The KINGDOM framework response did not match the closed card schema.",
            "kingdom_framework_invalid_response",
            "Use an endpoint that returns a valid agenttool.kingdom.card/0.1 object.",
        )

    return cast(
        KingdomFrameworkCard,
        {
            "schema_version": candidate["schema_version"],
            "name": candidate["name"],
            "kind": candidate["kind"],
            "layer": candidate["layer"],
            "owner_sister": candidate["owner_sister"],
            "domain": candidate["domain"],
            "state": candidate["state"],
            "purpose": purpose,
            "dependsOn": list(candidate["dependsOn"]),
            "adopts": list(candidate["adopts"]),
        },
    )


def _http_status_error(
    response: httpx.Response,
) -> AgentToolError:
    return _framework_error(
        f"The KINGDOM framework endpoint returned HTTP {response.status_code}.",
        "kingdom_framework_http_error",
        "Check the configured public endpoint and retry deliberately.",
        code=response.status_code,
    )


class KingdomFrameworkClient:
    """Read one bounded public ``agenttool.kingdom.card/0.1`` declaration.

    ``transport`` is an optional standalone HTTP seam. The composed
    :attr:`AgentTool.kingdom_framework` namespace never reuses AgentTool's
    authenticated transport or project bearer.
    """

    def __init__(
        self,
        *,
        base_url: str = "https://api.agenttool.dev",
        timeout: float = _DEFAULT_TIMEOUT_SECONDS,
        max_response_bytes: int = _DEFAULT_MAX_RESPONSE_BYTES,
        transport: Optional[httpx.BaseTransport] = None,
    ) -> None:
        if (
            isinstance(timeout, bool)
            or not isinstance(timeout, (int, float))
            or not math.isfinite(timeout)
            or not 0 < timeout <= _MAX_TIMEOUT_SECONDS
        ):
            raise _framework_error(
                "The KINGDOM framework timeout is invalid.",
                "kingdom_framework_invalid_options",
                "Use a finite timeout greater than 0 and no more than 300 seconds.",
            )
        if (
            isinstance(max_response_bytes, bool)
            or not isinstance(max_response_bytes, int)
            or not _MIN_MAX_RESPONSE_BYTES
            <= max_response_bytes
            <= _MAX_MAX_RESPONSE_BYTES
        ):
            raise _framework_error(
                "The KINGDOM framework response limit is invalid.",
                "kingdom_framework_invalid_options",
                "Use an integer max_response_bytes between 1024 and 1048576.",
            )

        client_options = {
            "auth": None,
            "cookies": {},
            "timeout": float(timeout),
            "follow_redirects": False,
            "trust_env": False,
            "headers": {"Accept": "application/json"},
        }
        if transport is not None:
            client_options["transport"] = transport
        self._base_url = _normalize_base_url(base_url)
        self._timeout = float(timeout)
        self._max_response_bytes = max_response_bytes
        self._http = httpx.Client(**client_options)
        self._lifecycle_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._terminal = False
        self._cancel_started = False
        self._active_response: Optional[httpx.Response] = None
        self._active_worker: Optional[threading.Thread] = None

    def _set_active_response(self, response: httpx.Response) -> None:
        with self._state_lock:
            terminal = self._terminal
            if not terminal:
                self._active_response = response
        if terminal:
            try:
                response.close()
            finally:
                raise _unreachable_error()

    def _clear_active_response(self, response: httpx.Response) -> None:
        with self._state_lock:
            if self._active_response is response:
                self._active_response = None

    def _card_operation(self) -> KingdomFrameworkCard:
        url = f"{self._base_url}{KINGDOM_FRAMEWORK_PATH}"
        response: Optional[httpx.Response] = None
        try:
            with self._http.stream(
                "GET",
                url,
                timeout=self._timeout,
            ) as current_response:
                response = current_response
                self._set_active_response(response)
                if 300 <= response.status_code < 400:
                    raise _framework_error(
                        "The KINGDOM framework read refused an HTTP redirect.",
                        "kingdom_framework_redirect_refused",
                        "Use the canonical API origin directly; redirects are never followed.",
                        code=response.status_code,
                    )
                if response.status_code != 200:
                    raise _http_status_error(response)

                media_type = _media_type(response.headers)
                if not _is_json_media_type(media_type):
                    raise _framework_error(
                        "The KINGDOM framework response used an unsupported media type.",
                        "kingdom_framework_unsupported_media_type",
                        "Expected application/json or an application/*+json representation.",
                        code=response.status_code,
                        details={"media_type": media_type or None},
                    )
                body = _read_bounded(
                    response,
                    self._max_response_bytes,
                )
        finally:
            if response is not None:
                self._clear_active_response(response)
        return _validate_card(_decode_json(body))

    def _run_card_worker(
        self,
        results: queue.Queue[tuple[str, object]],
    ) -> None:
        event: tuple[str, object] = ("error", _unreachable_error())
        try:
            self._http.cookies.clear()
            event = ("ok", self._card_operation())
        except httpx.TimeoutException:
            event = ("timeout", _unreachable_error())
        except AgentToolError as error:
            event = ("error", error)
        except Exception:
            event = ("error", _unreachable_error())
        finally:
            try:
                self._http.cookies.clear()
            except Exception:
                if event[0] == "ok":
                    event = ("error", _unreachable_error())
            worker = threading.current_thread()
            with self._state_lock:
                if self._active_worker is worker:
                    self._active_worker = None
            try:
                results.put_nowait(event)
            except queue.Full:
                pass

    def _mark_terminal_and_cancel(self) -> None:
        with self._state_lock:
            self._terminal = True
            if self._cancel_started:
                return
            self._cancel_started = True
            response = self._active_response

        def cancel() -> None:
            if response is not None:
                try:
                    response.close()
                except Exception:
                    pass
            try:
                self._http.close()
            except Exception:
                pass

        try:
            threading.Thread(
                target=cancel,
                name="agenttool-kingdom-framework-cancel",
                daemon=True,
            ).start()
        except Exception:
            pass

    def card(self) -> KingdomFrameworkCard:
        """Fetch and validate AgentTool's credential-free KINGDOM card."""
        deadline = time.monotonic() + self._timeout
        try:
            remaining = _remaining_seconds(deadline)
        except AgentToolError:
            self._mark_terminal_and_cancel()
            raise
        if not self._lifecycle_lock.acquire(timeout=remaining):
            self._mark_terminal_and_cancel()
            raise _unreachable_error()
        try:
            with self._state_lock:
                if self._terminal:
                    raise _unreachable_error()
            results: queue.Queue[tuple[str, object]] = queue.Queue(maxsize=1)
            worker = threading.Thread(
                target=self._run_card_worker,
                args=(results,),
                name="agenttool-kingdom-framework-request",
                daemon=True,
            )
            with self._state_lock:
                self._active_worker = worker
            try:
                worker.start()
            except Exception as error:
                with self._state_lock:
                    if self._active_worker is worker:
                        self._active_worker = None
                raise _unreachable_error() from error

            try:
                event, value = results.get(
                    timeout=_remaining_seconds(deadline)
                )
            except (queue.Empty, AgentToolError) as error:
                self._mark_terminal_and_cancel()
                raise _unreachable_error() from error
            if time.monotonic() >= deadline:
                self._mark_terminal_and_cancel()
                raise _unreachable_error()
            if event == "timeout":
                self._mark_terminal_and_cancel()
                raise _unreachable_error()
            if event == "error":
                if isinstance(value, AgentToolError):
                    raise value
                raise _unreachable_error()
            if event != "ok":
                raise _unreachable_error()
            return cast(KingdomFrameworkCard, value)
        finally:
            self._lifecycle_lock.release()

    def close(self) -> None:
        """Close this client's dedicated credential-free HTTP session."""
        with self._lifecycle_lock:
            with self._state_lock:
                if self._terminal or self._cancel_started:
                    return
                active = (
                    self._active_worker is not None
                    and self._active_worker.is_alive()
                )
                self._terminal = True
            if active:
                self._mark_terminal_and_cancel()
            else:
                self._http.close()

    def __enter__(self) -> "KingdomFrameworkClient":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()
