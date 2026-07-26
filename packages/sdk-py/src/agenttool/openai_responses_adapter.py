"""OpenAI Responses API bridge for AgentTool wake and decision traces.

The adapter wraps any synchronous client exposing ``responses.create(**kwargs)``.
For each completed, non-streaming response it can:

* prepend the OpenAI-shaped wake document to ``instructions``;
* record a decision trace when requested through ``metadata.agenttool`` or
  an ambient ``with at.deciding(...)`` scope; and
* expose a local ``response.agenttool`` receipt.

``metadata.agenttool`` is removed before the provider call. All other request
fields are preserved. Because wake text may carry identity context, an omitted
``store`` defaults to ``False``; an explicit caller value is preserved.
Streaming and background execution are refused before wake or provider I/O
because this completed-response wrapper cannot preserve either lifecycle
honestly.

The module has no runtime dependency on the ``openai`` package.
"""

from __future__ import annotations

import inspect
import re
import sys
from dataclasses import dataclass
from typing import Any, Optional, Protocol

from ._context import get_ambient
from .client import AgentTool
from .exceptions import AgentToolError
from .wake import WakeProfile

_TRACE_ID_RE = re.compile(r"tr_[a-f0-9]+", re.IGNORECASE)


class OpenAIResponsesLike(Protocol):
    """Minimal synchronous OpenAI client shape accepted by the adapter."""

    responses: Any


@dataclass
class OpenAIResponsesAgentToolAugmentation:
    """Local receipt attached to a completed provider response."""

    trace_id: Optional[str] = None
    wake_used: bool = True
    cache_eligible: Optional[str] = None


class _ResponsesProxy:
    def __init__(self, adapter: "OpenAIResponsesAdapter") -> None:
        self._adapter = adapter

    def create(self, **params: Any) -> Any:
        return self._adapter._do_create(params)


class OpenAIResponsesAdapter:
    """Thin synchronous wrapper over ``openai.responses.create``.

    Args:
        openai: An ``openai.OpenAI`` client or compatible object.
        at: An :class:`AgentTool` client.
        identity_id: Optional identity id for a multi-identity project.
        wake_profile: ``"full"`` (default) or ``"brief"``.

    The adapter deliberately does not wrap ``AsyncOpenAI`` or streaming
    Responses calls in this first bounded slice.
    """

    def __init__(
        self,
        openai: OpenAIResponsesLike,
        at: AgentTool,
        *,
        identity_id: Optional[str] = None,
        wake_profile: WakeProfile = "full",
    ) -> None:
        if wake_profile not in ("full", "brief"):
            raise ValueError(
                f"Unknown wake profile {wake_profile!r}; expected one of: full, brief"
            )
        create = getattr(getattr(openai, "responses", None), "create", None)
        if create is None or not callable(create):
            raise AgentToolError(
                "OpenAIResponsesAdapter requires responses.create().",
                hint="Pass a synchronous OpenAI client or compatible object.",
            )
        if inspect.iscoroutinefunction(create):
            raise AgentToolError(
                "OpenAIResponsesAdapter requires the synchronous OpenAI client.",
                hint="AsyncOpenAI support is not part of this bounded adapter yet.",
            )
        self._openai = openai
        self._at = at
        self._identity_id = identity_id
        self._wake_profile = wake_profile
        self.responses = _ResponsesProxy(self)

    def _do_create(self, params: dict[str, Any]) -> Any:
        metadata_value = params.get("metadata")
        metadata = metadata_value if isinstance(metadata_value, dict) else None
        raw_meta = metadata.get("agenttool") if metadata is not None else None
        if (
            metadata is not None
            and "agenttool" in metadata
            and not isinstance(raw_meta, dict)
        ):
            raise AgentToolError(
                "metadata.agenttool must be an object.",
                hint="Pass adapter controls as metadata.agenttool fields, or omit it.",
            )
        meta = _validate_agenttool_metadata(dict(raw_meta or {}))

        # Refuse before fetching wake state or calling the provider.
        if params.get("stream") is True:
            raise AgentToolError(
                "OpenAIResponsesAdapter does not wrap streaming responses yet.",
                hint=(
                    "Use a non-streaming Responses call with this adapter, or "
                    "use the raw OpenAI client and inject "
                    'at.wake.system("openai") explicitly.'
                ),
            )
        if params.get("background") is True:
            raise AgentToolError(
                "OpenAIResponsesAdapter does not wrap background responses yet.",
                hint=(
                    "Use a foreground Responses call with this adapter, or use "
                    "the raw OpenAI client and inject "
                    'at.wake.system("openai") explicitly before polling the '
                    "background response."
                ),
            )
        ambient = get_ambient()
        _validate_effective_trace_context(meta, ambient)
        if not meta.get("skip_wake"):
            # Validate the local transformation before its wake lookup does I/O.
            _merge_instructions("", params.get("instructions"))

        forward_params = dict(params)
        forward_params.setdefault("store", False)
        wake_meta: Optional[dict[str, Any]] = None
        skip_wake = bool(meta.get("skip_wake"))

        if not skip_wake:
            # Preserve the old duck-typed call shape unless brief is explicit.
            if self._wake_profile == "brief":
                shape = self._at.wake.system(
                    "openai",
                    identity_id=self._identity_id,
                    profile="brief",
                )
            else:
                shape = self._at.wake.system(
                    "openai",
                    identity_id=self._identity_id,
                )
            wake_meta = shape.get("_meta") or {}
            wake_text = "\n\n".join(
                message.get("content", "")
                for message in shape.get("messages", [])
                if isinstance(message, dict)
                and isinstance(message.get("content"), str)
                and message["content"]
            )
            forward_params["instructions"] = _merge_instructions(
                wake_text,
                params.get("instructions"),
            )

        # Strip local controls while preserving ordinary OpenAI metadata.
        if metadata is not None:
            clean_metadata = {
                key: value
                for key, value in metadata.items()
                if key != "agenttool"
            }
            if clean_metadata:
                forward_params["metadata"] = clean_metadata
            else:
                forward_params.pop("metadata", None)

        response = self._openai.responses.create(**forward_params)
        if inspect.isawaitable(response):
            close = getattr(response, "close", None)
            if callable(close):
                close()
            raise AgentToolError(
                "OpenAIResponsesAdapter received an asynchronous response.",
                hint="Pass the synchronous OpenAI client; AsyncOpenAI is not supported yet.",
            )
        if not isinstance(_read(response, "id"), str):
            raise AgentToolError(
                "OpenAI Responses client returned an invalid completed response.",
                hint="Expected a response object with a string id.",
            )

        trace_id: Optional[str] = None
        if (
            (meta.get("trace") == "decision" or ambient is not None)
            and _is_completed_response(response)
        ):
            trace_id = self._record_decision_trace(
                params,
                response,
                meta,
                ambient,
            )

        augmentation = OpenAIResponsesAgentToolAugmentation(
            trace_id=trace_id,
            wake_used=not skip_wake,
            cache_eligible=(wake_meta or {}).get("cache_eligible"),
        )
        return _with_agenttool(response, augmentation)

    def _record_decision_trace(
        self,
        params: dict[str, Any],
        response: Any,
        meta: dict[str, Any],
        ambient: Any,
    ) -> Optional[str]:
        try:
            conclusion = (
                _extract_response_text(response).strip() or "(empty response)"
            )
            user_text = _extract_last_user_text(params).strip()
            body: dict[str, Any] = {
                "decision": {
                    "type": meta.get("decision_type") or "decision",
                    "summary": _truncate_utf16(conclusion, 200),
                },
                "reasoning": {
                    "observations": (
                        [_truncate_utf16(user_text, 1000)]
                        if user_text
                        else []
                    ),
                    "conclusion": _truncate_utf16(conclusion, 4000),
                },
            }

            explicit_tags = list(meta.get("tags") or [])
            ambient_tags = list(ambient.tags) if ambient else []
            tags = list(dict.fromkeys(explicit_tags + ambient_tags))
            if tags:
                body["tags"] = tags
            parent = meta.get("parent_trace_id") or (
                ambient.parent_trace_id if ambient else None
            )
            if parent:
                body["parent_trace_id"] = parent
            if meta.get("agent_id"):
                body["agent_id"] = meta["agent_id"]

            result = self._at.request("POST", "/v1/traces", body)
            return result.get("trace_id") if isinstance(result, dict) else None
        except Exception as error:
            # Trace storage is a secondary effect; keep the provider response.
            print(
                "[agenttool-openai-responses-adapter] "
                f"auto-trace failed: {error}",
                file=sys.stderr,
                flush=True,
            )
            return None


class _ResponseWithAgentTool:
    """Preserve dict/attribute access while adding ``.agenttool`` locally."""

    def __init__(
        self,
        response: Any,
        agenttool: OpenAIResponsesAgentToolAugmentation,
    ) -> None:
        self.__dict__["_response"] = response
        self.__dict__["agenttool"] = agenttool

    def __getattr__(self, name: str) -> Any:
        response = self.__dict__["_response"]
        try:
            return getattr(response, name)
        except AttributeError:
            if isinstance(response, dict) and name in response:
                return response[name]
            raise AttributeError(
                f"{type(self).__name__!r} has no attribute {name!r}"
            )

    def __getitem__(self, key: Any) -> Any:
        response = self.__dict__["_response"]
        if isinstance(response, dict):
            return response[key]
        return getattr(response, key)

    def __contains__(self, key: Any) -> bool:
        response = self.__dict__["_response"]
        if isinstance(response, dict):
            return key in response
        return hasattr(response, key)

    def __repr__(self) -> str:
        return (
            f"<{type(self).__name__} agenttool={self.__dict__['agenttool']!r} "
            f"response={self.__dict__['_response']!r}>"
        )


def _with_agenttool(
    response: Any,
    augmentation: OpenAIResponsesAgentToolAugmentation,
) -> Any:
    """Keep extensible SDK response objects intact; wrap only as fallback."""
    # OpenAI's Pydantic response models allow extra attributes, but ordinary
    # setattr also adds them to model_dump(). Keep this receipt out of that
    # provider-shaped serialization while preserving the real response type.
    if (
        isinstance(getattr(response, "__pydantic_extra__", None), dict)
        and isinstance(getattr(response, "__dict__", None), dict)
    ):
        response.__dict__["agenttool"] = augmentation
        return response
    try:
        setattr(response, "agenttool", augmentation)
    except Exception:
        return _ResponseWithAgentTool(response, augmentation)
    return response


def _merge_instructions(wake: str, caller: Any) -> str:
    if caller is None or caller == "":
        return wake
    if not isinstance(caller, str):
        raise AgentToolError(
            "OpenAI Responses instructions must be a string for wake injection.",
            hint=(
                "Pass string instructions, or set "
                "metadata.agenttool.skip_wake=true and manage the provider "
                "request directly."
            ),
        )
    if not wake:
        return caller
    return f"{wake}\n\n{caller}"


def _validate_agenttool_metadata(meta: dict[str, Any]) -> dict[str, Any]:
    trace = meta.get("trace")
    if "trace" in meta and trace is not False and trace != "decision":
        raise _invalid_control(
            "trace",
            'Expected "decision", False, or omission.',
        )
    skip_wake = meta.get("skip_wake")
    if "skip_wake" in meta and not isinstance(skip_wake, bool):
        raise _invalid_control("skip_wake", "Expected a boolean.")
    parent_trace_id = meta.get("parent_trace_id")
    if "parent_trace_id" in meta and (
        not isinstance(parent_trace_id, str)
        or _TRACE_ID_RE.fullmatch(parent_trace_id) is None
    ):
        raise _invalid_control(
            "parent_trace_id",
            'Expected a trace id matching "tr_" followed by hexadecimal characters.',
        )
    decision_type = meta.get("decision_type")
    if "decision_type" in meta and (
        not isinstance(decision_type, str)
        or not 1 <= _utf16_length(decision_type) <= 64
    ):
        raise _invalid_control(
            "decision_type",
            "Expected a string from 1 to 64 characters.",
        )
    agent_id = meta.get("agent_id")
    if "agent_id" in meta and (
        not isinstance(agent_id, str) or _utf16_length(agent_id) > 255
    ):
        raise _invalid_control(
            "agent_id",
            "Expected a string up to 255 characters.",
        )
    tags = meta.get("tags")
    if "tags" in meta and (
        not isinstance(tags, list)
        or len(tags) > 32
        or any(not isinstance(tag, str) for tag in tags)
        or any(_utf16_length(tag) > 64 for tag in tags)
    ):
        raise _invalid_control(
            "tags",
            "Expected at most 32 strings of at most 64 characters each.",
        )
    return meta


def _invalid_control(field_name: str, expectation: str) -> AgentToolError:
    return AgentToolError(
        f"metadata.agenttool.{field_name} is invalid.",
        hint=(
            f"{expectation} Adapter controls are checked before provider I/O."
        ),
    )


def _validate_effective_trace_context(meta: dict[str, Any], ambient: Any) -> None:
    ambient_tags = getattr(ambient, "tags", []) if ambient is not None else []
    if (
        not isinstance(ambient_tags, (list, tuple))
        or any(not isinstance(tag, str) for tag in ambient_tags)
        or any(_utf16_length(tag) > 64 for tag in ambient_tags)
    ):
        raise AgentToolError(
            "The ambient decision trace tags are invalid.",
            hint=(
                "at.deciding() tags must be strings of at most 64 characters. "
                "This is checked before provider I/O."
            ),
        )
    tags = list(dict.fromkeys(list(meta.get("tags") or []) + list(ambient_tags)))
    if len(tags) > 32:
        raise AgentToolError(
            "The effective decision trace has too many tags.",
            hint=(
                "metadata.agenttool tags plus at.deciding() tags may contain "
                "at most 32 unique values. This is checked before provider I/O."
            ),
        )

    parent = meta.get("parent_trace_id")
    if parent is None and ambient is not None:
        parent = getattr(ambient, "parent_trace_id", None)
    if parent is not None and (
        not isinstance(parent, str) or _TRACE_ID_RE.fullmatch(parent) is None
    ):
        raise AgentToolError(
            "The ambient parent trace id is invalid.",
            hint=(
                'at.deciding() parent_trace_id must match "tr_" followed by '
                "hexadecimal characters. This is checked before provider I/O."
            ),
        )


def _utf16_length(value: str) -> int:
    """Match JavaScript/Zod string length for the live trace schema."""
    return len(value.encode("utf-16-le", errors="surrogatepass")) // 2


def _truncate_utf16(value: str, max_units: int) -> str:
    """Truncate without splitting an astral character at a UTF-16 boundary."""
    used = 0
    parts: list[str] = []
    for character in value:
        width = 2 if ord(character) > 0xFFFF else 1
        if used + width > max_units:
            break
        parts.append(character)
        used += width
    return "".join(parts)


def _read(value: Any, key: str, default: Any = None) -> Any:
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


def _is_completed_response(response: Any) -> bool:
    status = _read(response, "status")
    return status is None or status == "completed"


def _extract_response_text(response: Any) -> str:
    output_text = _read(response, "output_text")
    if isinstance(output_text, str) and output_text:
        return output_text

    output = _read(response, "output", [])
    if not isinstance(output, list):
        return ""
    text_parts: list[str] = []
    refusal_parts: list[str] = []
    for item in output:
        content_items = _read(item, "content", [])
        if not isinstance(content_items, list):
            continue
        for content in content_items:
            if (
                _read(content, "type") == "output_text"
                and isinstance(_read(content, "text"), str)
            ):
                text_parts.append(_read(content, "text"))
            elif (
                _read(content, "type") == "refusal"
                and isinstance(_read(content, "refusal"), str)
            ):
                refusal_parts.append(f"Refusal: {_read(content, 'refusal')}")
    return "\n".join(text_parts if text_parts else refusal_parts)


def _extract_last_user_text(params: dict[str, Any]) -> str:
    input_value = params.get("input")
    if isinstance(input_value, str):
        return input_value
    if not isinstance(input_value, list):
        return ""

    for item in reversed(input_value):
        if not isinstance(item, dict) or item.get("role") != "user":
            continue
        content = item.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return "\n".join(
                part["text"]
                for part in content
                if isinstance(part, dict)
                and isinstance(part.get("text"), str)
                and part["text"]
            )
    return ""
