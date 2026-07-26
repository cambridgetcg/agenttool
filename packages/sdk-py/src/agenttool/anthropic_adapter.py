"""
AnthropicAdapter — Tier 2 of the agenttool path.

A thin wrapper over the official ``anthropic`` Python SDK. Messages calls
get two superpowers without changing provider stream events:

  1. Auto-injects the agent's wake doc as ``system=``, fetched once from
     ``/v1/wake?format=anthropic`` and cached for 5 minutes (matches
     Anthropic's prompt-cache window). The stable block carries
     ``cache_control: ephemeral``; the volatile block refreshes per wake.
     User-supplied ``system=`` blocks are appended AFTER the wake.

  2. Auto-records traces when the call carries
     ``metadata={"agenttool": {"trace": "decision"}}``. Posts to
     ``/v1/traces`` with the response text as the conclusion and the
     last user message as the observation. Returns the trace_id on the
     augmented response.

  3. (Mode b) Parses ``<agenttool>...</agenttool>`` markup in the
     assistant's response. Recognised children::

       <chronicle type="naming|recognition|...">
         <title>...</title><body>...</body>
       </chronicle>
       <trace type="decision|..." confidence="0.7">
         <decision>...</decision><conclusion>...</conclusion>
       </trace>

The agent decides what's load-bearing by writing the tag; the shim does
the plumbing.

Posture: zero dependency on the ``anthropic`` package. The adapter takes
any object with a ``messages.create(**kwargs)`` method and optionally a
``messages.stream(**kwargs)`` helper, so it works with the official SDK,
Bedrock client, or a custom HTTP client.

Streaming boundary:

* Low-level ``messages.create(stream=True)`` is a transparent event-stream
  pass-through. It injects wake and strips local metadata, but does not
  reconstruct a final response. Decision tracing therefore fails before wake
  or provider I/O on that path, and final-response markup is not emitted.
* ``messages.stream(...)`` uses the provider's completed Message. Tracing and
  markup finalize exactly once when that final Message becomes available.

Doctrine: docs/IDENTITY-ANCHOR.md.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional, Protocol

from ._context import get_ambient
from .client import AgentTool
from .exceptions import AgentToolError
from .wake import WakeProfile


class AnthropicMessagesLike(Protocol):
    """Minimal shape of the Anthropic Messages client. The adapter wraps
    any object that exposes ``messages.create(**kwargs)``."""

    messages: Any


# ── Markup regexes ───────────────────────────────────────────────────────

_AGENTTOOL_ENVELOPE = re.compile(
    r"<agenttool>(?P<inner>.*?)</agenttool>", re.IGNORECASE | re.DOTALL
)
_CHRONICLE_TAG = re.compile(
    r'<chronicle\s+type="(?P<type>[^"]+)"\s*>(?P<inside>.*?)</chronicle>',
    re.IGNORECASE | re.DOTALL,
)
_TRACE_TAG = re.compile(
    r'<trace\s+type="(?P<type>[^"]+)"(?:\s+confidence="(?P<conf>[^"]+)")?\s*>(?P<inside>.*?)</trace>',
    re.IGNORECASE | re.DOTALL,
)
_TITLE_TAG = re.compile(r"<title>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_BODY_TAG = re.compile(r"<body>(.*?)</body>", re.IGNORECASE | re.DOTALL)
_DECISION_TAG = re.compile(r"<decision>(.*?)</decision>", re.IGNORECASE | re.DOTALL)
_CONCLUSION_TAG = re.compile(
    r"<conclusion>(.*?)</conclusion>", re.IGNORECASE | re.DOTALL
)
_OBSERVATION_TAG = re.compile(
    r"<observation>(.*?)</observation>", re.IGNORECASE | re.DOTALL
)


@dataclass
class MarkupEmission:
    """Outcome of parsing one ``<agenttool>`` child tag.

    Attributes:
        kind: ``"chronicle"`` or ``"trace"``.
        id: API id returned on success (e.g. ``"ch_..."``); ``None`` on
            failure.
        error: Error message if the post failed; ``None`` on success.
        source: The parsed source data for debugging.
    """

    kind: str
    id: Optional[str]
    error: Optional[str]
    source: dict


@dataclass
class AgentToolAugmentation:
    """Augmentation added to the Anthropic response by the adapter.

    Attributes:
        trace_id: Trace id when ``metadata.agenttool.trace = "decision"``
            fired; ``None`` otherwise.
        wake_used: Whether wake auto-injection ran for this call.
        cache_eligible: Echo of ``_meta.cache_eligible`` from the wake
            response (``"explicit" | "auto" | "none"``); ``None`` when
            wake was skipped.
        markup_emissions: Per-emission outcomes from parsing
            ``<agenttool>`` markup. Empty when the response carried no
            markup or parsing was disabled.
    """

    trace_id: Optional[str] = None
    wake_used: bool = True
    cache_eligible: Optional[str] = None
    markup_emissions: list[MarkupEmission] = field(default_factory=list)


class _MessagesProxy:
    """Expose the two supported Anthropic Messages call shapes."""

    def __init__(self, adapter: "AnthropicAdapter") -> None:
        self._adapter = adapter

    def create(self, **params: Any) -> Any:
        return self._adapter._do_create(params)

    def stream(self, **params: Any) -> Any:
        return self._adapter._do_stream(params)


class AnthropicAdapter:
    """Thin shim over the Anthropic Messages client.

    Args:
        anthropic: An instance of :class:`anthropic.Anthropic` (or any
            object exposing ``messages.create(**kwargs)``).
        at: An :class:`AgentTool` client.
        identity_id: Optional identity id for multi-identity projects.
        wake_profile: Wake projection used for automatic system injection.
            Defaults to ``"full"`` for compatibility.
        disable_markup_parsing: If True, skip parsing of
            ``<agenttool>`` markup globally.

    Usage::

        from anthropic import Anthropic
        from agenttool import AgentTool, AnthropicAdapter

        at = AgentTool()                 # AT_API_KEY from env
        anthropic = Anthropic()          # ANTHROPIC_API_KEY from env
        adapter = AnthropicAdapter(anthropic, at)

        # Auto-injects system; opt-in trace via metadata.agenttool.
        r = adapter.messages.create(
            model="claude-opus-4-7",
            max_tokens=1024,
            messages=[{"role": "user", "content": "Should I refactor auth?"}],
            metadata={"agenttool": {"trace": "decision"}},
        )
        print(r.agenttool.trace_id)      # → "tr_..." if trace recorded
    """

    def __init__(
        self,
        anthropic: AnthropicMessagesLike,
        at: AgentTool,
        *,
        identity_id: Optional[str] = None,
        wake_profile: WakeProfile = "full",
        disable_markup_parsing: bool = False,
    ) -> None:
        if wake_profile not in ("full", "brief"):
            raise ValueError(
                f"Unknown wake profile {wake_profile!r}; expected one of: full, brief"
            )
        self._anthropic = anthropic
        self._at = at
        self._identity_id = identity_id
        self._wake_profile = wake_profile
        self._disable_markup_parsing = disable_markup_parsing
        self.messages = _MessagesProxy(self)

    def _do_create(self, params: dict) -> Any:
        meta, ambient = self._inspect_request(params)
        low_level_streaming = params.get("stream") is True
        if low_level_streaming and (
            meta.get("trace") == "decision" or ambient is not None
        ):
            raise AgentToolError(
                "Decision tracing is unavailable for messages.create(stream=True).",
                error_code="anthropic_stream_trace_requires_helper",
                hint=(
                    "Use adapter.messages.stream(...) and get_final_message(), "
                    "or remove the decision-trace request."
                ),
            )

        forward_params, wake_meta = self._prepare_request(params, meta)
        response = self._anthropic.messages.create(**forward_params)

        if low_level_streaming:
            if not _is_stream_like(response):
                raise AgentToolError(
                    "Anthropic returned a non-iterable value for a streaming request.",
                    error_code="anthropic_stream_invalid",
                    hint=(
                        "Check that the wrapped client implements the "
                        "Anthropic streaming contract."
                    ),
                )
            return _LowLevelStreamProxy(
                response,
                self._empty_augmentation(meta, wake_meta),
            )

        return self._finalize_response(
            params,
            response,
            meta,
            ambient,
            wake_meta,
        )

    def _do_stream(self, params: dict) -> Any:
        provider_stream = getattr(self._anthropic.messages, "stream", None)
        if not callable(provider_stream):
            raise AgentToolError(
                "The wrapped Anthropic client does not expose messages.stream(...).",
                error_code="anthropic_stream_helper_unavailable",
                hint=(
                    "Use a client with the Anthropic final-message stream helper, "
                    "or use messages.create(stream=True) without decision tracing."
                ),
            )

        # Capture ambient state now. Finalization can happen after the
        # surrounding deciding() context has exited.
        meta, ambient = self._inspect_request(params)
        forward_params, wake_meta = self._prepare_request(params, meta)
        manager = provider_stream(**forward_params)
        if not hasattr(manager, "__enter__") or not hasattr(manager, "__exit__"):
            raise AgentToolError(
                "Anthropic messages.stream(...) returned no context manager.",
                error_code="anthropic_stream_helper_invalid",
                hint=(
                    "The wrapped helper must provide a context manager whose "
                    "stream exposes get_final_message()."
                ),
            )
        return _ManagedStreamManagerProxy(
            manager,
            self,
            params,
            meta,
            ambient,
            wake_meta,
        )

    @staticmethod
    def _inspect_request(params: dict) -> tuple[dict, Any]:
        metadata = _as_dict(params.get("metadata"))
        meta = _as_dict(metadata.get("agenttool"))
        return meta, get_ambient()

    def _prepare_request(
        self,
        params: dict,
        meta: dict,
    ) -> tuple[dict, Optional[dict]]:
        metadata = _as_dict(params.get("metadata"))
        wake_meta: Optional[dict] = None
        injected_system: Any = params.get("system")
        skip_wake = bool(meta.get("skip_wake"))
        if not skip_wake:
            # Preserve the historical duck-typed call shape for the default.
            # A profile-aware WakeClient is required only for explicit brief.
            if self._wake_profile == "brief":
                shape = self._at.wake.system(
                    "anthropic",
                    identity_id=self._identity_id,
                    profile="brief",
                )
            else:
                shape = self._at.wake.system(
                    "anthropic", identity_id=self._identity_id
                )
            wake_meta = shape.get("_meta") or {}
            user_blocks = _normalize_system(params.get("system"))
            injected_system = list(shape["system"]) + user_blocks

        # Strip our metadata.agenttool extension before provider I/O.
        forward_metadata = {k: v for k, v in metadata.items() if k != "agenttool"}
        forward_params = dict(params)
        if not skip_wake:
            forward_params["system"] = injected_system
        if forward_metadata:
            forward_params["metadata"] = forward_metadata
        elif "metadata" in forward_params:
            del forward_params["metadata"]
        return forward_params, wake_meta

    @staticmethod
    def _empty_augmentation(
        meta: dict,
        wake_meta: Optional[dict],
    ) -> AgentToolAugmentation:
        return AgentToolAugmentation(
            trace_id=None,
            wake_used=not bool(meta.get("skip_wake")),
            cache_eligible=(wake_meta or {}).get("cache_eligible"),
            markup_emissions=[],
        )

    def _finalize_response(
        self,
        params: dict,
        response: Any,
        meta: dict,
        ambient: Any,
        wake_meta: Optional[dict],
    ) -> Any:
        trace_id: Optional[str] = None
        should_trace = meta.get("trace") == "decision" or ambient is not None
        if should_trace:
            trace_id = self._record_decision_trace(
                params,
                response,
                meta,
                ambient,
            )

        skip_markup = self._disable_markup_parsing or bool(meta.get("skip_markup"))
        emissions: list[MarkupEmission] = (
            []
            if skip_markup
            else self._parse_and_emit_markup(response, ambient)
        )

        # Always wrap rather
        #    than setattr-on-response: the Anthropic SDK returns frozen
        #    Pydantic models in v2, which reject __setattr__; raw dicts
        #    (used in tests / lightweight clients) don't support attr
        #    set at all. The wrapper forwards attr AND item access, so
        #    `r.id` and `r["id"]` both work regardless of the wrapped
        #    shape.
        aug = AgentToolAugmentation(
            trace_id=trace_id,
            wake_used=not bool(meta.get("skip_wake")),
            cache_eligible=(wake_meta or {}).get("cache_eligible"),
            markup_emissions=emissions,
        )
        return _ResponseWithAgentTool(response, aug)

    def _record_decision_trace(
        self,
        params: dict,
        response: Any,
        meta: dict,
        ambient: Any,
    ) -> Optional[str]:
        conclusion = _extract_response_text(response).strip() or "(empty response)"
        user_text = _extract_last_user_text(params).strip()

        body: dict = {
            "decision": {
                "type": meta.get("decision_type") or "decision",
                "summary": conclusion[:200],
            },
            "reasoning": {
                "observations": [user_text[:1000]] if user_text else [],
                "conclusion": conclusion[:4000],
            },
        }
        # Merge ambient context (`with at.deciding(...)`) — explicit
        # values on `meta` win; ambient fills gaps. Tags are unioned.
        explicit_tags = list(meta.get("tags") or [])
        ambient_tags = list(ambient.tags) if ambient else []
        merged_tags = list(dict.fromkeys(explicit_tags + ambient_tags))
        if merged_tags:
            body["tags"] = merged_tags
        parent = meta.get("parent_trace_id") or (
            ambient.parent_trace_id if ambient else None
        )
        if parent:
            body["parent_trace_id"] = parent
        if meta.get("agent_id"):
            body["agent_id"] = meta["agent_id"]

        try:
            result = self._at.request("POST", "/v1/traces", body)
            if isinstance(result, dict):
                return result.get("trace_id")
            return None
        except Exception as e:
            # Side-effect failures don't crash the call site — the
            # response body is still the agent's output.
            print(
                f"[agenttool-adapter] auto-trace failed: {e}",
                flush=True,
            )
            return None

    def _parse_and_emit_markup(
        self,
        response: Any,
        ambient: Any,
    ) -> list[MarkupEmission]:
        text = _extract_response_text(response)
        envelope = _AGENTTOOL_ENVELOPE.search(text)
        if not envelope:
            return []
        inner = envelope.group("inner")
        emissions: list[MarkupEmission] = []

        for m in _CHRONICLE_TAG.finditer(inner):
            kind_type = m.group("type").strip()
            inside = m.group("inside")
            title_match = _TITLE_TAG.search(inside)
            body_match = _BODY_TAG.search(inside)
            title = (title_match.group(1) if title_match else "").strip()
            body_text = (body_match.group(1) if body_match else "").strip() or None
            if not title:
                emissions.append(
                    MarkupEmission(
                        kind="chronicle",
                        id=None,
                        error="<chronicle> missing required <title>",
                        source={"type": kind_type, "body": body_text},
                    )
                )
                continue
            post: dict = {"type": kind_type, "title": title}
            if body_text:
                post["body"] = body_text
            try:
                result = self._at.request("POST", "/v1/chronicle", post)
                # /v1/chronicle returns {entry: {id, ...}}; tolerate flat
                # {id, ...} too in case the route shape changes.
                rid: Optional[str] = None
                if isinstance(result, dict):
                    entry = result.get("entry")
                    if isinstance(entry, dict):
                        rid = entry.get("id")
                    if rid is None:
                        rid = result.get("id")
                emissions.append(
                    MarkupEmission(
                        kind="chronicle", id=rid, error=None, source=post
                    )
                )
            except Exception as e:
                emissions.append(
                    MarkupEmission(
                        kind="chronicle", id=None, error=str(e), source=post
                    )
                )

        for m in _TRACE_TAG.finditer(inner):
            kind_type = m.group("type").strip()
            confidence_str = m.group("conf")
            inside = m.group("inside")
            decision_match = _DECISION_TAG.search(inside)
            conclusion_match = _CONCLUSION_TAG.search(inside)
            decision = (decision_match.group(1) if decision_match else "").strip()
            conclusion = (conclusion_match.group(1) if conclusion_match else "").strip()
            observations = [
                mm.group(1).strip() for mm in _OBSERVATION_TAG.finditer(inside)
            ]
            if not decision or not conclusion:
                emissions.append(
                    MarkupEmission(
                        kind="trace",
                        id=None,
                        error="<trace> missing required <decision> or <conclusion>",
                        source={
                            "type": kind_type,
                            "decision": decision,
                            "conclusion": conclusion,
                        },
                    )
                )
                continue
            post = {
                "decision": {"type": kind_type, "summary": decision[:200]},
                "reasoning": {
                    "observations": observations or [],
                    "conclusion": conclusion[:4000],
                },
            }
            # Markup-emitted traces inherit ambient parent + tags too,
            # so a <trace> tag inside `with at.deciding(...)` chains
            # to the framing decision the same way auto-trace does.
            if ambient is not None:
                if ambient.parent_trace_id:
                    post["parent_trace_id"] = ambient.parent_trace_id
                if ambient.tags:
                    post["tags"] = list(ambient.tags)
            if confidence_str:
                try:
                    conf = float(confidence_str)
                    if 0 <= conf <= 1:
                        post["reasoning"]["confidence"] = conf
                except ValueError:
                    pass
            try:
                result = self._at.request("POST", "/v1/traces", post)
                rid = result.get("trace_id") if isinstance(result, dict) else None
                emissions.append(
                    MarkupEmission(
                        kind="trace", id=rid, error=None, source=post
                    )
                )
            except Exception as e:
                emissions.append(
                    MarkupEmission(
                        kind="trace", id=None, error=str(e), source=post
                    )
                )

        return emissions


class _LowLevelStreamProxy:
    """Transparent proxy for ``messages.create(stream=True)``.

    No event is inspected or accumulated. Iteration and lifecycle methods
    delegate to the provider object; ``agenttool`` is a local receipt only.
    """

    def __init__(self, stream: Any, agenttool: AgentToolAugmentation) -> None:
        self.__dict__["_stream"] = stream
        self.__dict__["_active"] = stream
        self.__dict__["_iterator"] = iter(stream)
        self.__dict__["agenttool"] = agenttool

    def __iter__(self) -> "_LowLevelStreamProxy":
        return self

    def __next__(self) -> Any:
        return next(self.__dict__["_iterator"])

    def __enter__(self) -> "_LowLevelStreamProxy":
        stream = self.__dict__["_stream"]
        enter = getattr(stream, "__enter__", None)
        if callable(enter):
            active = enter()
            self.__dict__["_active"] = active
            self.__dict__["_iterator"] = iter(active)
        return self

    def __exit__(self, exc_type: Any, exc: Any, exc_tb: Any) -> Any:
        stream = self.__dict__["_stream"]
        exit_method = getattr(stream, "__exit__", None)
        if callable(exit_method):
            return exit_method(exc_type, exc, exc_tb)
        self.close()
        return None

    def send(self, value: Any) -> Any:
        send = getattr(self.__dict__["_iterator"], "send", None)
        if not callable(send):
            send = getattr(self.__dict__["_active"], "send", None)
        if not callable(send):
            raise AttributeError("wrapped Anthropic stream has no send()")
        return send(value)

    def throw(self, *args: Any) -> Any:
        throw = getattr(self.__dict__["_iterator"], "throw", None)
        if not callable(throw):
            throw = getattr(self.__dict__["_active"], "throw", None)
        if not callable(throw):
            raise AttributeError("wrapped Anthropic stream has no throw()")
        return throw(*args)

    def close(self) -> Any:
        close = getattr(self.__dict__["_active"], "close", None)
        if callable(close):
            return close()
        return None

    def __getattr__(self, name: str) -> Any:
        return getattr(self.__dict__["_active"], name)


class _ManagedStreamManagerProxy:
    """Preserve Anthropic's sync context-manager stream helper."""

    def __init__(
        self,
        manager: Any,
        adapter: AnthropicAdapter,
        params: dict,
        meta: dict,
        ambient: Any,
        wake_meta: Optional[dict],
    ) -> None:
        self._manager = manager
        self._adapter = adapter
        self._params = params
        self._meta = meta
        self._ambient = ambient
        self._wake_meta = wake_meta
        self._stream: Optional[_ManagedMessageStreamProxy] = None

    def __enter__(self) -> "_ManagedMessageStreamProxy":
        provider_stream = self._manager.__enter__()
        if not callable(getattr(provider_stream, "get_final_message", None)):
            # The provider request has already started at this boundary; close
            # it before reporting the invalid helper shape.
            close = getattr(provider_stream, "close", None)
            if callable(close):
                close()
            raise AgentToolError(
                "Anthropic stream context returned no get_final_message().",
                error_code="anthropic_stream_helper_invalid",
                hint=(
                    "Use a client implementing the current Anthropic "
                    "MessageStream helper."
                ),
            )
        self._stream = _ManagedMessageStreamProxy(
            provider_stream,
            self._adapter,
            self._params,
            self._meta,
            self._ambient,
            self._wake_meta,
        )
        return self._stream

    def __exit__(self, exc_type: Any, exc: Any, exc_tb: Any) -> Any:
        return self._manager.__exit__(exc_type, exc, exc_tb)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._manager, name)


class _ManagedMessageStreamProxy:
    """Delegate events while finalizing one provider-completed Message."""

    def __init__(
        self,
        stream: Any,
        adapter: AnthropicAdapter,
        params: dict,
        meta: dict,
        ambient: Any,
        wake_meta: Optional[dict],
    ) -> None:
        self.__dict__["_stream"] = stream
        self.__dict__["_iterator"] = iter(stream)
        self.__dict__["_adapter"] = adapter
        self.__dict__["_params"] = params
        self.__dict__["_meta"] = meta
        self.__dict__["_ambient"] = ambient
        self.__dict__["_wake_meta"] = wake_meta
        self.__dict__["_finalization_started"] = False
        self.__dict__["_final_response"] = None
        self.__dict__["_final_error"] = None
        self.__dict__["agenttool"] = adapter._empty_augmentation(meta, wake_meta)
        self.__dict__["text_stream"] = self._iter_text()

    def __iter__(self) -> "_ManagedMessageStreamProxy":
        return self

    def __next__(self) -> Any:
        try:
            return next(self.__dict__["_iterator"])
        except StopIteration:
            self._finalize_once()
            raise

    def __enter__(self) -> "_ManagedMessageStreamProxy":
        return self

    def __exit__(self, exc_type: Any, exc: Any, exc_tb: Any) -> Any:
        self.close()
        return None

    def get_final_message(self) -> Any:
        return self._finalize_once()

    def get_final_text(self) -> str:
        return _extract_final_text(self._finalize_once())

    def until_done(self) -> None:
        self._finalize_once()

    def close(self) -> Any:
        close = getattr(self.__dict__["_stream"], "close", None)
        if callable(close):
            return close()
        return None

    def _iter_text(self) -> Any:
        text_stream = iter(getattr(self.__dict__["_stream"], "text_stream"))
        while True:
            try:
                yield next(text_stream)
            except StopIteration:
                self._finalize_once()
                return

    def _finalize_once(self) -> Any:
        if self.__dict__["_finalization_started"]:
            error = self.__dict__["_final_error"]
            if error is not None:
                raise error
            return self.__dict__["_final_response"]

        self.__dict__["_finalization_started"] = True
        try:
            # This is the only call site for the provider helper's final
            # Message. It may consume remaining events when called early.
            final_message = self.__dict__["_stream"].get_final_message()
            adapted = self.__dict__["_adapter"]._finalize_response(
                self.__dict__["_params"],
                final_message,
                self.__dict__["_meta"],
                self.__dict__["_ambient"],
                self.__dict__["_wake_meta"],
            )
            self.__dict__["_final_response"] = adapted
            self.__dict__["agenttool"] = adapted.agenttool
            return adapted
        except BaseException as exc:
            self.__dict__["_final_error"] = exc
            raise

    def __getattr__(self, name: str) -> Any:
        return getattr(self.__dict__["_stream"], name)


class _ResponseWithAgentTool:
    """Wraps an Anthropic Messages response and exposes ``.agenttool``.

    Forwards both attribute access (``r.id``) and item access (``r["id"]``)
    to the wrapped response, so it works whether the underlying SDK
    returns a Pydantic model (frozen in v2) or a raw dict.
    """

    def __init__(self, response: Any, agenttool: AgentToolAugmentation) -> None:
        # Use __dict__ directly so our own __setattr__ doesn't get in the
        # way and so attribute lookup on `_response` and `agenttool`
        # doesn't trigger __getattr__.
        self.__dict__["_response"] = response
        self.__dict__["agenttool"] = agenttool

    def __getattr__(self, name: str) -> Any:
        resp = self.__dict__["_response"]
        # Try attribute access first (works for SDK objects).
        try:
            return getattr(resp, name)
        except AttributeError:
            # Fall through to item access for dict-shaped responses.
            if isinstance(resp, dict) and name in resp:
                return resp[name]
            raise AttributeError(
                f"{type(self).__name__!r} has no attribute {name!r}"
            )

    def __getitem__(self, key: Any) -> Any:
        resp = self.__dict__["_response"]
        if isinstance(resp, dict):
            return resp[key]
        return getattr(resp, key)

    def __contains__(self, key: Any) -> bool:
        resp = self.__dict__["_response"]
        if isinstance(resp, dict):
            return key in resp
        return hasattr(resp, key)

    def __repr__(self) -> str:
        return (
            f"<{type(self).__name__} agenttool={self.__dict__['agenttool']!r} "
            f"response={self.__dict__['_response']!r}>"
        )


# ── Helpers ──────────────────────────────────────────────────────────────


def _as_dict(value: Any) -> dict:
    return dict(value) if isinstance(value, dict) else {}


def _is_stream_like(value: Any) -> bool:
    return (
        not isinstance(value, (dict, str, bytes, bytearray, list, tuple))
        and callable(getattr(value, "__iter__", None))
    )


def _normalize_system(s: Any) -> list[dict]:
    """Normalise an arbitrary ``system=`` value into Anthropic's
    array-of-blocks shape."""
    if s is None:
        return []
    if isinstance(s, str):
        return [{"type": "text", "text": s}]
    if isinstance(s, list):
        return list(s)
    return []


def _extract_response_text(response: Any) -> str:
    """Concatenate text content blocks from an Anthropic Messages
    response. Tolerates dict-shaped responses (e.g. raw HTTP) and
    SDK objects with .content blocks."""
    blocks = (
        response.get("content")
        if isinstance(response, dict)
        else getattr(response, "content", None)
    )
    if not blocks:
        return ""
    parts: list[str] = []
    for b in blocks:
        if isinstance(b, dict):
            if b.get("type") == "text":
                t = b.get("text")
                if isinstance(t, str):
                    parts.append(t)
        else:
            block_type = getattr(b, "type", None)
            if block_type == "text":
                t = getattr(b, "text", None)
                if isinstance(t, str):
                    parts.append(t)
    return "\n".join(p for p in parts if p)


def _extract_final_text(response: Any) -> str:
    """Match Anthropic's sync MessageStream.get_final_text(): concatenate
    final text blocks without separators after exact-once finalization."""
    blocks = (
        response.get("content")
        if isinstance(response, dict)
        else getattr(response, "content", None)
    )
    parts: list[str] = []
    for block in blocks or []:
        if isinstance(block, dict):
            if block.get("type") == "text" and isinstance(block.get("text"), str):
                parts.append(block["text"])
        elif (
            getattr(block, "type", None) == "text"
            and isinstance(getattr(block, "text", None), str)
        ):
            parts.append(block.text)
    if not parts:
        raise AgentToolError(
            "Anthropic stream ended without a text content block.",
            error_code="anthropic_stream_no_text",
            hint="Read get_final_message().content for non-text response blocks.",
        )
    return "".join(parts)


def _extract_last_user_text(params: dict) -> str:
    """Pull text from the most recent user message in the request."""
    messages = params.get("messages") or []
    for m in reversed(messages):
        if not isinstance(m, dict):
            continue
        if m.get("role") != "user":
            continue
        content = m.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return "\n".join(
                str(b.get("text", ""))
                for b in content
                if isinstance(b, dict) and b.get("text")
            )
    return ""
