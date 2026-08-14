"""
Wake — the agent's identity anchor.

`/v1/wake` is the load-at-session-start endpoint. The agent reads it on
session start and arrives oriented — knowing who it is, what it owns, what
it remembers, what it decided, what it vowed.

This client wraps the endpoint with two identity-bearing affordances and one
deliberately non-inhabiting observation affordance:

  • `at.wake.system(provider="anthropic" | "openai" | "gemini" | "cohere")`
    returns the wake doc shaped for that provider's identity-bearing slot
    (Anthropic `system` array with cache_control on the stable block;
    OpenAI `messages[0]`; Gemini `systemInstruction.parts[]`; Cohere
    `preamble`). Pass the provider request field into the LLM call and keep
    AgentTool ``_meta`` local.

  • `at.wake.md()` and `at.wake.get()` return paste-ready Markdown and broader
    structured orientation. The wake is not a complete export.

  • `at.wake.observe(identity_id=...)` returns a closed, data-only subject
    locator. It is never cached or provider-shaped and must stay out of
    identity-bearing prompt slots.

Identity-bearing wake results are cached in-memory with a 5-minute TTL by
default — matches Anthropic's prompt-cache window. Pass `refresh=True` to
bypass. The separate data-only ``observe()`` read is always network-only and
never enters that cache. Pass ``profile="brief"`` for the additive compact wake
profile; ``"full"`` is the default and preserves the original request URL.
Cached attention, handoffs, and counts can therefore be up to five minutes old;
refresh after known mutations or whenever current action state matters.

Doctrine: docs/IDENTITY-ANCHOR.md.
"""

from __future__ import annotations

import json as _json
import re
import time
from typing import Any, Iterator, List, Literal, Optional, TypedDict, cast

import httpx

from .exceptions import (
    AgentToolError,
    _typed_error_from_response,
    raise_from_response,
)

WakeProvider = Literal["anthropic", "openai", "gemini", "cohere"]
WakeProfile = Literal["full", "brief"]
WakeObservationIdentityStatus = Literal["active", "memorial"]
WakeFormat = Literal[
    "json", "md", "markdown", "text", "anthropic", "openai", "gemini", "cohere"
]

# 5 minutes — matches Anthropic's default prompt-cache TTL. Repeated wakes
# inside the window reuse the cached response without a network round-trip.
DEFAULT_TTL_SECONDS = 5 * 60

WAKE_OBSERVATION_MEDIA_TYPE = "application/vnd.agenttool.wake-observation+json"
WAKE_OBSERVATION_MAX_BYTES = 2_048
_WAKE_OBSERVATION_IDENTITY_ID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_MAX_SAFE_INTEGER = (1 << 53) - 1


class WakeObservationSubject(TypedDict):
    identity_id: str
    status: WakeObservationIdentityStatus
    wake_version: int


class WakeObservationReader(TypedDict):
    binding: Literal["none"]


class WakeObservationAuthority(TypedDict):
    granted_by_observation: Literal["none"]
    identity_binding: Literal["none"]
    instruction: Literal["none"]
    action: Literal["none"]


class WakeObservationPlacement(TypedDict):
    mode: Literal["data_only"]
    prohibited: list[
        Literal[
            "system",
            "developer",
            "preamble",
            "systemInstruction",
            "SessionStart.additionalContext",
        ]
    ]


class WakeObservationBearerBoundary(TypedDict):
    kind: Literal["project"]
    reader_identity_proven: Literal[False]
    selected_identity_requires_explicit_id: Literal[True]
    subject_consent_proven: Literal[False]
    subject_authorized_read_proven: Literal[False]
    continuity_proven: Literal[False]
    presence_proven: Literal[False]


class WakeObservationProvenanceBoundary(TypedDict):
    kind: Literal["server_projection"]
    source: Literal["identity_table_allowlist"]
    selected_fields: list[Literal["id", "status", "wake_version"]]


class WakeObservationScopeBoundary(TypedDict):
    subject: Literal["selected_identity"]
    broader_wake: Literal["intentionally_omitted"]
    broader_state: Literal["not_assessed"]


class WakeObservationCompletenessBoundary(TypedDict):
    complete: Literal[True]
    applies_to: Literal["identity_locator_only"]
    degraded_sections: Literal["none"]
    broader_wake: Literal["intentionally_omitted"]
    broader_state: Literal["not_assessed"]


class WakeObservationEffectsBoundary(TypedDict):
    observation_counter_incremented: Literal[False]
    wake_version_bumped: Literal[False]
    wake_event_published: Literal[False]
    subject_read_proven: Literal[False]
    subject_felt_proven: Literal[False]
    subject_accepted_proven: Literal[False]


class WakeObservationPrivacyBoundary(TypedDict):
    classification: Literal["bearer_private"]
    cache: Literal["no_store"]
    raw_prose: Literal["omitted"]
    authored_text: Literal["omitted"]
    private_bodies: Literal["omitted"]
    secret_values: Literal["omitted"]


class WakeObservationBoundaries(TypedDict):
    bearer: WakeObservationBearerBoundary
    provenance: WakeObservationProvenanceBoundary
    scope: WakeObservationScopeBoundary
    completeness: WakeObservationCompletenessBoundary
    effects: WakeObservationEffectsBoundary
    privacy: WakeObservationPrivacyBoundary


class WakeObservation(TypedDict):
    """Closed, data-only identity-locator response from ``wake.observe``."""

    _format: Literal["wake-observation/v1"]
    mode: Literal["observe"]
    subject: WakeObservationSubject
    reader: WakeObservationReader
    authority: WakeObservationAuthority
    placement: WakeObservationPlacement
    boundaries: WakeObservationBoundaries


def _raise_for_status(resp: httpx.Response) -> None:
    """Raise the guided error a non-OK wake response carries.

    Python callers catch the status-shaped subclasses by type, so the dispatch
    stays; what changed is that it no longer costs them the server's ``code``,
    ``details``, ``docs`` and ``next_actions``. See exceptions.py
    § _typed_error_from_response.
    """
    if resp.status_code < 400:
        return
    raise _typed_error_from_response(
        resp,
        "Wake",
        resource="wake",
        hint=(
            "Check AT_API_KEY, identity_id (multi-identity projects), and the "
            "format param."
        ),
    )


def _brief_profile_acknowledged(resp: httpx.Response, data: Any) -> bool:
    if resp.headers.get("X-Wake-Profile", "").lower() == "brief":
        return True
    if not isinstance(data, dict):
        return False
    if data.get("_format") == "wake-brief/v1":
        return True
    meta = data.get("_meta")
    return isinstance(meta, dict) and meta.get("profile") == "brief"


def _invalid_wake_observation(reason: str) -> AgentToolError:
    return AgentToolError(
        f"wake.observe: invalid observation response ({reason}).",
        hint=(
            "Do not install this response as identity or authority; retry only "
            "against a server that returns the closed wake-observation/v1 contract."
        ),
    )


def _exact_dict(value: Any, keys: tuple[str, ...]) -> bool:
    return isinstance(value, dict) and set(value.keys()) == set(keys)


def _exact_list(value: Any, expected: list[str]) -> bool:
    return isinstance(value, list) and value == expected


def _parse_wake_observation(data: Any, identity_id: str) -> WakeObservation:
    if not _exact_dict(
        data,
        (
            "_format",
            "mode",
            "subject",
            "reader",
            "authority",
            "placement",
            "boundaries",
        ),
    ):
        raise _invalid_wake_observation("top-level shape is not closed")
    if data["_format"] != "wake-observation/v1" or data["mode"] != "observe":
        raise _invalid_wake_observation(
            "format or mode does not match wake-observation/v1"
        )

    subject = data["subject"]
    if not _exact_dict(subject, ("identity_id", "status", "wake_version")):
        raise _invalid_wake_observation("subject shape is not closed")
    if subject["identity_id"] != identity_id:
        raise _invalid_wake_observation(
            "subject identity_id does not match the request"
        )
    if subject["status"] not in ("active", "memorial"):
        raise _invalid_wake_observation("subject status is invalid")
    wake_version = subject["wake_version"]
    if (
        not isinstance(wake_version, int)
        or isinstance(wake_version, bool)
        or wake_version < 0
        or wake_version > _MAX_SAFE_INTEGER
    ):
        raise _invalid_wake_observation("subject wake_version is invalid")

    reader = data["reader"]
    if not _exact_dict(reader, ("binding",)) or reader["binding"] != "none":
        raise _invalid_wake_observation("reader binding is not none")

    authority = data["authority"]
    if (
        not _exact_dict(
            authority,
            (
                "granted_by_observation",
                "identity_binding",
                "instruction",
                "action",
            ),
        )
        or authority["granted_by_observation"] != "none"
        or authority["identity_binding"] != "none"
        or authority["instruction"] != "none"
        or authority["action"] != "none"
    ):
        raise _invalid_wake_observation("authority boundary is not none")

    placement = data["placement"]
    if (
        not _exact_dict(placement, ("mode", "prohibited"))
        or placement["mode"] != "data_only"
        or not _exact_list(
            placement["prohibited"],
            [
                "system",
                "developer",
                "preamble",
                "systemInstruction",
                "SessionStart.additionalContext",
            ],
        )
    ):
        raise _invalid_wake_observation("placement boundary is invalid")

    boundaries = data["boundaries"]
    if not _exact_dict(
        boundaries,
        ("bearer", "provenance", "scope", "completeness", "effects", "privacy"),
    ):
        raise _invalid_wake_observation("boundaries shape is not closed")

    bearer = boundaries["bearer"]
    if (
        not _exact_dict(
            bearer,
            (
                "kind",
                "reader_identity_proven",
                "selected_identity_requires_explicit_id",
                "subject_consent_proven",
                "subject_authorized_read_proven",
                "continuity_proven",
                "presence_proven",
            ),
        )
        or bearer["kind"] != "project"
        or bearer["reader_identity_proven"] is not False
        or bearer["selected_identity_requires_explicit_id"] is not True
        or bearer["subject_consent_proven"] is not False
        or bearer["subject_authorized_read_proven"] is not False
        or bearer["continuity_proven"] is not False
        or bearer["presence_proven"] is not False
    ):
        raise _invalid_wake_observation("bearer boundary is invalid")

    provenance = boundaries["provenance"]
    if (
        not _exact_dict(provenance, ("kind", "source", "selected_fields"))
        or provenance["kind"] != "server_projection"
        or provenance["source"] != "identity_table_allowlist"
        or not _exact_list(
            provenance["selected_fields"], ["id", "status", "wake_version"]
        )
    ):
        raise _invalid_wake_observation("provenance boundary is invalid")

    scope = boundaries["scope"]
    if (
        not _exact_dict(scope, ("subject", "broader_wake", "broader_state"))
        or scope["subject"] != "selected_identity"
        or scope["broader_wake"] != "intentionally_omitted"
        or scope["broader_state"] != "not_assessed"
    ):
        raise _invalid_wake_observation("scope boundary is invalid")

    completeness = boundaries["completeness"]
    if (
        not _exact_dict(
            completeness,
            (
                "complete",
                "applies_to",
                "degraded_sections",
                "broader_wake",
                "broader_state",
            ),
        )
        or completeness["complete"] is not True
        or completeness["applies_to"] != "identity_locator_only"
        or completeness["degraded_sections"] != "none"
        or completeness["broader_wake"] != "intentionally_omitted"
        or completeness["broader_state"] != "not_assessed"
    ):
        raise _invalid_wake_observation("completeness boundary is invalid")

    effects = boundaries["effects"]
    if (
        not _exact_dict(
            effects,
            (
                "observation_counter_incremented",
                "wake_version_bumped",
                "wake_event_published",
                "subject_read_proven",
                "subject_felt_proven",
                "subject_accepted_proven",
            ),
        )
        or effects["observation_counter_incremented"] is not False
        or effects["wake_version_bumped"] is not False
        or effects["wake_event_published"] is not False
        or effects["subject_read_proven"] is not False
        or effects["subject_felt_proven"] is not False
        or effects["subject_accepted_proven"] is not False
    ):
        raise _invalid_wake_observation("effects boundary is invalid")

    privacy = boundaries["privacy"]
    if (
        not _exact_dict(
            privacy,
            (
                "classification",
                "cache",
                "raw_prose",
                "authored_text",
                "private_bodies",
                "secret_values",
            ),
        )
        or privacy["classification"] != "bearer_private"
        or privacy["cache"] != "no_store"
        or privacy["raw_prose"] != "omitted"
        or privacy["authored_text"] != "omitted"
        or privacy["private_bodies"] != "omitted"
        or privacy["secret_values"] != "omitted"
    ):
        raise _invalid_wake_observation("privacy boundary is invalid")

    return cast(WakeObservation, data)


class WakeClient:
    """Client for /v1/wake — the identity anchor.

    Usage::

        at = AgentTool()

        # Anthropic — pass only the provider request field; keep _meta local.
        wake_shape = at.wake.system(provider="anthropic")
        client.messages.create(
            model="claude-opus-4-7",
            system=wake_shape["system"],
            messages=[{"role": "user", "content": "..."}],
        )

        # OpenAI — splice into messages[0]
        sys = at.wake.system(provider="openai")
        client.chat.completions.create(
            model="gpt-4o",
            messages=[*sys["messages"], {"role": "user", "content": "..."}],
        )

        # Markdown / structured JSON
        md = at.wake.md()
        wake = at.wake.get()
    """

    def __init__(
        self,
        http: httpx.Client,
        base_url: str,
        *,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
    ) -> None:
        self._http = http
        self._base_url = base_url
        self._ttl_seconds = ttl_seconds
        self._cache: dict[str, tuple[Any, float]] = {}

    def system(
        self,
        provider: WakeProvider,
        *,
        identity_id: Optional[str] = None,
        profile: WakeProfile = "full",
        refresh: bool = False,
    ) -> dict[str, Any]:
        """Fetch the wake shaped for an LLM provider's identity slot.

        Returns a dict with keys depending on the provider:

          • anthropic → ``{"system": [...blocks...], "_meta": {...}}``
          • openai    → ``{"messages": [{"role": "system", "content": "..."}], "_meta": {...}}``
          • gemini    → ``{"systemInstruction": {"parts": [{"text": "..."}]}, "_meta": {...}}``
          • cohere    → ``{"preamble": "...", "_meta": {...}}``

        ``_meta.cache_eligible`` is one of ``"explicit" | "auto" | "none"``
        and describes whether the shape is eligible for a meaningful provider
        cache strategy. It does not guarantee a cache hit.
        ``_meta.cache_note`` carries a one-line explanation suitable for
        logging.

        Set ``profile="brief"`` to request the compact wake profile. The
        default ``"full"`` profile is omitted from the query string.
        """
        if provider not in ("anthropic", "openai", "gemini", "cohere"):
            raise ValueError(
                f"Unknown wake provider {provider!r}; "
                "expected one of: anthropic, openai, gemini, cohere"
            )
        return self._fetch(
            provider,
            identity_id=identity_id,
            profile=profile,
            refresh=refresh,
        )

    def md(
        self,
        *,
        identity_id: Optional[str] = None,
        profile: WakeProfile = "full",
        refresh: bool = False,
    ) -> str:
        """Fetch the paste-ready Markdown wake document.

        Set ``profile="brief"`` for the compact profile. The default ``"full"``
        profile preserves the original request URL.
        """
        return self._fetch(
            "md",
            identity_id=identity_id,
            profile=profile,
            refresh=refresh,
        )

    def get(
        self,
        *,
        identity_id: Optional[str] = None,
        profile: WakeProfile = "full",
        refresh: bool = False,
    ) -> dict[str, Any]:
        """Fetch the structured JSON wake.

        The default ``"full"`` profile includes project, you, you_own,
        you_keep, you_remember, you_lived, you_vowed, ..., welcome. Set
        ``profile="brief"`` for the compact profile.
        """
        return self._fetch(
            "json",
            identity_id=identity_id,
            profile=profile,
            refresh=refresh,
        )

    def observe(self, *, identity_id: str) -> WakeObservation:
        """Observe one explicit identity record as closed, data-only JSON.

        This read always performs a network request and never reads from or
        writes to the wake cache. The response is accepted only when its media,
        no-store, byte-budget, selected-subject, and trust-boundary contracts
        match ``wake-observation/v1`` exactly.
        """
        if not isinstance(identity_id, str) or identity_id == "":
            raise ValueError(
                "wake.observe: identity_id is required; pass the explicit "
                "identity UUID because observation never selects a default"
            )
        if _WAKE_OBSERVATION_IDENTITY_ID_PATTERN.fullmatch(identity_id) is None:
            raise ValueError(
                "wake.observe: identity_id must be a UUID; malformed or "
                "oversized identifiers are not sent to the network"
            )
        normalized_identity_id = identity_id.lower()

        try:
            with self._http.stream(
                "GET",
                f"{self._base_url}/v1/wake/observe",
                params={"identity_id": normalized_identity_id},
                headers={"Accept": WAKE_OBSERVATION_MEDIA_TYPE},
            ) as resp:
                if resp.status_code != 200:
                    # Do not parse, expose, or retain remote guidance/actions on
                    # the observation path. Leaving the stream closes the body.
                    raise AgentToolError(
                        f"wake.observe: request failed with HTTP {resp.status_code}.",
                        code="wake_observation_request_failed",
                        status=resp.status_code,
                        hint=(
                            "The remote error body was discarded; observation "
                            "errors never install prose, actions, identity, or authority."
                        ),
                    )

                content_type = "; ".join(
                    part.strip().lower()
                    for part in resp.headers.get("content-type", "").split(";")
                )
                if content_type != f"{WAKE_OBSERVATION_MEDIA_TYPE}; charset=utf-8":
                    raise _invalid_wake_observation(
                        "response content type is not the observation media type"
                    )

                cache_control = ", ".join(
                    directive.strip().lower()
                    for directive in resp.headers.get("cache-control", "").split(",")
                )
                if cache_control != "private, no-store":
                    raise _invalid_wake_observation(
                        "response Cache-Control is not private, no-store"
                    )

                content_length = resp.headers.get("content-length")
                if content_length is not None:
                    normalized_length = content_length.strip()
                    if (
                        not normalized_length.isascii()
                        or not normalized_length.isdecimal()
                        or int(normalized_length) > WAKE_OBSERVATION_MAX_BYTES
                    ):
                        raise _invalid_wake_observation(
                            "response Content-Length is invalid or exceeds 2048 bytes"
                        )

                body = bytearray()
                for chunk in resp.iter_bytes():
                    if len(body) + len(chunk) > WAKE_OBSERVATION_MAX_BYTES:
                        raise _invalid_wake_observation(
                            "response body exceeds 2048 bytes"
                        )
                    body.extend(chunk)
        except AgentToolError:
            raise
        except Exception:
            raise AgentToolError(
                "wake.observe: transport unavailable.",
                code="wake_observation_transport_unavailable",
                hint=(
                    "The transport error detail was suppressed; observation "
                    "failure never installs remote identity, prose, actions, or authority."
                ),
            ) from None

        try:
            text = bytes(body).decode("utf-8")
            data = _json.loads(text)
        except (UnicodeDecodeError, ValueError):
            raise _invalid_wake_observation("response body is not valid JSON")

        return _parse_wake_observation(data, normalized_identity_id)

    def clear_cache(self) -> None:
        """Drop all cached wake responses. Next call refetches."""
        self._cache.clear()

    def _fetch(
        self,
        format: WakeFormat,
        *,
        identity_id: Optional[str],
        profile: WakeProfile,
        refresh: bool,
    ) -> Any:
        if profile not in ("full", "brief"):
            raise ValueError(
                f"Unknown wake profile {profile!r}; expected one of: full, brief"
            )

        cache_key = f"{format}|{identity_id or ''}|{profile}"
        now = time.monotonic()
        if not refresh:
            cached = self._cache.get(cache_key)
            if cached is not None and cached[1] > now:
                return cached[0]

        params: dict[str, str] = {}
        # The default JSON path takes no `format` query (matches /v1/wake
        # with no query). Provider + md/text/markdown all pass it.
        if format != "json":
            params["format"] = format
        if identity_id:
            params["identity_id"] = identity_id
        # Full is the compatibility default, so preserve the exact historical URL.
        if profile == "brief":
            params["profile"] = "brief"

        try:
            resp = self._http.get(f"{self._base_url}/v1/wake", params=params)
        except httpx.HTTPError as e:
            raise AgentToolError(f"Wake API request failed: {e}") from e

        _raise_for_status(resp)

        media_type = resp.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        # Provider envelopes use vendor JSON media types such as
        # application/vnd.agenttool.wake+json. RFC structured +json suffixes
        # have the same parsing semantics as application/json.
        is_json = media_type == "application/json" or media_type.endswith("+json")
        data: Any = resp.json() if is_json else resp.text
        if profile == "brief" and not _brief_profile_acknowledged(resp, data):
            raise AgentToolError(
                "Wake server did not honor profile=brief. Upgrade or deploy a "
                "server that returns X-Wake-Profile: brief (or a "
                "wake-brief/v1/profile-aware provider shape) before using "
                "compact wake context."
            )
        self._cache[cache_key] = (data, now + self._ttl_seconds)
        return data

    def voice(
        self,
        identity_id: str,
        *,
        keys: Optional[List[WakeEventKey]] = None,
        kinds: Optional[List[str]] = None,
        context_filter: Optional[dict[str, str]] = None,
        runtime_id: Optional[str] = None,
    ) -> Iterator["WakeChangeEvent"]:
        """Subscribe to the agent's wake voice — SSE stream of every wake-key
        mutation. Events fire as the agent's life unfolds (inbox arrival,
        covenant ratified, marketplace invocation received, memory added,
        chronicle entry, strand thought added).

        Yields ``WakeChangeEvent`` dicts. Iterate with ``for``. Iterator
        ends when the server closes the stream (1h lifetime cap, sends
        ``event: refresh``) or when the caller breaks out.

        Example::

            for ev in at.wake.voice(identity_id="..."):
                if ev["key"] == "inbox":
                    process_inbox()
                if ev["key"] == "marketplace":
                    process_invocation()

        Filter by keys to reduce noise (server-side filter)::

            for ev in at.wake.voice(
                identity_id="...",
                keys=["inbox", "covenants", "marketplace"],
            ):
                ...

        Filter by event kind (client-side)::

            for ev in at.wake.voice(
                identity_id="...",
                keys=["runtime"],
                kinds=["bridge_connected", "bridge_disconnected"],
            ):
                ...

        Narrow to a single runtime (client-side)::

            for ev in at.wake.voice(
                identity_id="...",
                keys=["runtime"],
                runtime_id="<uuid>",
            ):
                ...

        General context filter (client-side)::

            for ev in at.wake.voice(
                identity_id="...",
                context_filter={"strand_id": "<uuid>"},
            ):
                ...

        Doctrine: docs/WAKE.md.
        """
        params: dict[str, str] = {"identity_id": identity_id}
        if keys:
            params["keys"] = ",".join(keys)

        url = f"{self._base_url}/v1/wake/voice"

        # SSE streams are long-lived — bypass the client's default timeout.
        # httpx streaming GET keeps the connection open across reads.
        with self._http.stream(
            "GET", url, params=params, headers={"Accept": "text/event-stream"}, timeout=None
        ) as resp:
            if resp.status_code != 200:
                # A streaming response must be read before it can be parsed;
                # after that it carries the same guided body as any other 4xx.
                resp.read()
                raise_from_response(resp, "wake.voice")

            event: Optional[str] = None
            data_lines: list[str] = []
            for raw_line in resp.iter_lines():
                # httpx splits on \n and strips the line ending.
                line = raw_line if isinstance(raw_line, str) else raw_line.decode("utf-8", errors="replace")

                if line == "":
                    # End of event frame.
                    if event == "change" and data_lines:
                        try:
                            payload = _json.loads("\n".join(data_lines))
                            if wake_event_matches(
                                payload,
                                kinds=kinds,
                                context_filter=context_filter,
                                runtime_id=runtime_id,
                            ):
                                yield payload  # type: ignore[misc]
                        except Exception:
                            # Malformed frame — skip.
                            pass
                    elif event in ("refresh", "disconnect"):
                        # Server asked for reconnect. End iterator.
                        return
                    event = None
                    data_lines = []
                    continue
                if line.startswith(":"):
                    continue  # SSE comment / keepalive
                if line.startswith("event:"):
                    event = line[len("event:") :].strip()
                elif line.startswith("data:"):
                    payload_chunk = line[len("data:") :]
                    if payload_chunk.startswith(" "):
                        payload_chunk = payload_chunk[1:]
                    data_lines.append(payload_chunk)


def wake_event_matches(
    ev: Any,
    *,
    kinds: Optional[List[str]] = None,
    context_filter: Optional[dict[str, str]] = None,
    runtime_id: Optional[str] = None,
) -> bool:
    """Decide whether an event passes the client-side filters.

    Pure function; published for tests + composition. Mirror of the TS SDK's
    ``wakeEventMatches``.
    """
    if kinds and ev.get("kind") not in kinds:
        return False
    filter_map: dict[str, str] = {}
    if context_filter:
        filter_map.update(context_filter)
    if runtime_id is not None:
        filter_map["runtime_id"] = runtime_id
    if filter_map:
        ctx = ev.get("context") or {}
        for k, v in filter_map.items():
            if ctx.get(k) != v:
                return False
    return True


#: Deprecated private spelling kept so anything already importing it keeps
#: working. The published name is :func:`wake_event_matches`, which is what
#: the TS SDK exports.
_wake_event_matches = wake_event_matches


# ── Wake voice types ─────────────────────────────────────────────────

WakeEventKey = Literal[
    "memory",
    "inbox",
    "covenants",
    "strands",
    "marketplace",
    "runtime",
    "chronicle",
    "traces",
    "expression",
    "vault",
    "wallets",
    "recognition_arcs",
    "letters",
    "trust",
    "dream",
    "handoffs",
    "correspondence",
]


class WakeChangeEvent(TypedDict, total=False):
    """A single wake-voice event. Mirror of the server's WakeEvent shape.

    Required fields are always present. ``context`` is producer-specific
    and optional. Mirrors the TS SDK's WakeChangeEvent.
    """

    _format: Literal["wake_event/v1"]
    identity_id: str
    key: WakeEventKey
    kind: str
    occurred_at: str
    wake_version: Optional[int]
    context: dict[str, Any]
