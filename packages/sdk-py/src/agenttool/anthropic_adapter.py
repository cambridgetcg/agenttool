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

A ``<chronicle>`` tag is a model-authored write to the agent's own
identity record, so it is gated: the emission goes through
``at.chronicle.write`` (which enforces the type union and the title
bounds) and only after a ``before_chronicle_write`` hook returns literal
``True``. With no hook installed the write is refused.

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
import sys
import threading
from collections.abc import Mapping
from contextlib import contextmanager, nullcontext
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Protocol

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
_ATTACH_AGENTTOOL_LOCK = threading.RLock()


@dataclass(frozen=True)
class ChronicleBeforeWriteContext:
    """Immutable local review context for one model-authored chronicle write.

    Attributes:
        source: Always ``"anthropic_markup"`` — the entry was authored by
            the model, not by the calling program.
        type: The raw type string the model emitted, before validation.
        title: The title the model emitted, before validation.
        body: The body the model emitted, or ``None``.
    """

    source: str
    type: str
    title: str
    body: Optional[str]


ChronicleBeforeWriteHook = Callable[[ChronicleBeforeWriteContext], bool]
"""Synchronous local gate that must return literal ``True`` to proceed.

The hook's return value is neither persisted nor signed — it only decides
whether the model-authored entry is written.
"""


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


@dataclass(frozen=True)
class _AmbientSnapshot:
    """Trace context copied at the provider-call boundary."""

    parent_trace_id: Optional[str]
    tags: tuple[str, ...]


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
        before_chronicle_write: Review gate for ``<chronicle>`` tags the
            model emits. Required for those emissions to be written at
            all: without it every model-authored chronicle write is
            refused, because a chronicle entry is a mark on the agent's
            own identity record. ``<trace>`` emissions are unaffected.

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
        before_chronicle_write: Optional[ChronicleBeforeWriteHook] = None,
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
        self._before_chronicle_write = before_chronicle_write
        self.messages = _MessagesProxy(self)

    def _do_create(self, params: dict) -> Any:
        meta, ambient = self._inspect_request(params)
        last_user_text = _extract_last_user_text(params)
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
            try:
                stream_like = _is_stream_like(response)
            except BaseException:
                _cleanup_invalid_stream_value(response)
                raise
            if not stream_like:
                _cleanup_invalid_stream_value(response)
                raise AgentToolError(
                    "Anthropic returned a non-iterable value for a streaming request.",
                    error_code="anthropic_stream_invalid",
                    hint=(
                        "Check that the wrapped client implements the "
                        "Anthropic streaming contract."
                    ),
                )
            try:
                return _LowLevelStreamProxy(
                    response,
                    self._empty_augmentation(meta, wake_meta),
                )
            except BaseException:
                _cleanup_invalid_stream_value(response)
                raise

        return self._finalize_response(
            params,
            response,
            meta,
            ambient,
            wake_meta,
            last_user_text,
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
        last_user_text = _extract_last_user_text(params)
        forward_params, wake_meta = self._prepare_request(params, meta)
        manager = provider_stream(**forward_params)
        try:
            valid_manager = callable(getattr(manager, "__enter__", None)) and callable(
                getattr(manager, "__exit__", None)
            )
        except BaseException:
            _cleanup_invalid_stream_value(manager)
            raise
        if not valid_manager:
            error = AgentToolError(
                "Anthropic messages.stream(...) returned no context manager.",
                error_code="anthropic_stream_helper_invalid",
                hint=(
                    "The wrapped helper must provide a context manager whose "
                    "stream exposes get_final_message()."
                ),
            )
            _cleanup_invalid_stream_value(manager)
            raise error
        return _ManagedStreamManagerProxy(
            manager,
            self,
            params,
            meta,
            ambient,
            wake_meta,
            last_user_text,
        )

    @staticmethod
    def _inspect_request(params: dict) -> tuple[dict, Any]:
        metadata = _as_dict(params.get("metadata"))
        meta = _as_dict(metadata.get("agenttool"))
        if isinstance(meta.get("tags"), (list, tuple)):
            meta["tags"] = list(meta["tags"])
        ambient = get_ambient()
        if ambient is not None:
            ambient = _AmbientSnapshot(
                parent_trace_id=ambient.parent_trace_id,
                tags=tuple(ambient.tags),
            )
        return meta, ambient

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
                shape = self._at.wake.system("anthropic", identity_id=self._identity_id)
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
        last_user_text: Optional[str] = None,
        terminal_guard: Optional[Callable[[], None]] = None,
        side_effect_scope: Optional[Callable[[], Any]] = None,
    ) -> Any:
        _run_terminal_guard(terminal_guard)
        trace_id: Optional[str] = None
        should_trace = meta.get("trace") == "decision" or ambient is not None
        if should_trace:
            trace_id = self._record_decision_trace(
                params,
                response,
                meta,
                ambient,
                last_user_text,
                terminal_guard,
                side_effect_scope,
            )

        _run_terminal_guard(terminal_guard)
        skip_markup = self._disable_markup_parsing or bool(meta.get("skip_markup"))
        emissions: list[MarkupEmission] = (
            []
            if skip_markup
            else self._parse_and_emit_markup(
                response,
                ambient,
                terminal_guard,
                side_effect_scope,
            )
        )

        _run_terminal_guard(terminal_guard)
        # Preserve the provider's response identity when it permits a local
        # receipt. Frozen SDK models and raw dictionaries use a forwarding
        # wrapper instead.
        aug = AgentToolAugmentation(
            trace_id=trace_id,
            wake_used=not bool(meta.get("skip_wake")),
            cache_eligible=(wake_meta or {}).get("cache_eligible"),
            markup_emissions=emissions,
        )
        return _attach_agenttool(response, aug)

    def _record_decision_trace(
        self,
        params: dict,
        response: Any,
        meta: dict,
        ambient: Any,
        last_user_text: Optional[str] = None,
        terminal_guard: Optional[Callable[[], None]] = None,
        side_effect_scope: Optional[Callable[[], Any]] = None,
    ) -> Optional[str]:
        conclusion = _extract_response_text(response).strip() or "(empty response)"
        user_text = (
            _extract_last_user_text(params)
            if last_user_text is None
            else last_user_text
        ).strip()

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

        _run_terminal_guard(terminal_guard)
        with _open_side_effect_scope(side_effect_scope):
            try:
                result = self._at.request("POST", "/v1/traces", body)
                if isinstance(result, Mapping):
                    return result.get("trace_id")
                return None
            except Exception as e:
                # Side-effect failures don't crash the call site — the
                # response body is still the agent's output.
                print(
                    f"[agenttool-adapter] auto-trace failed: {e}",
                    file=sys.stderr,
                    flush=True,
                )
                return None

    def _review_chronicle_write(
        self, context: ChronicleBeforeWriteContext
    ) -> None:
        """Fail-closed gate for one model-authored chronicle write.

        Mirrors the ``covenants.create`` before_submit discipline: only
        literal ``True`` proceeds, a raising hook is a refusal, and the
        hook's output is neither persisted nor signed. Absence of a hook is
        also a refusal — a covenant is submitted by the calling program,
        but a ``<chronicle>`` tag is written by the model, so the
        capability starts closed.
        """
        hook = self._before_chronicle_write
        if hook is None:
            raise AgentToolError(
                "anthropic-adapter: model-authored <chronicle> writes need a "
                "before_chronicle_write hook.",
                hint=(
                    "The entry was not written. Pass before_chronicle_write to "
                    "AnthropicAdapter and return literal True only after review, "
                    "or set disable_markup_parsing to drop the markup path "
                    "entirely."
                ),
                error_code="chronicle_before_write_missing",
            )
        try:
            review_result = hook(context)
        except Exception as exc:
            raise AgentToolError(
                "anthropic-adapter: before_chronicle_write hook failed locally.",
                hint=(
                    "The entry was not written. Inspect the local hook and "
                    "try again."
                ),
                error_code="chronicle_before_write_failed",
            ) from exc
        if review_result is not True:
            raise AgentToolError(
                "anthropic-adapter: before_chronicle_write hook did not return true.",
                hint=(
                    "The entry was not written. Return literal True only after "
                    "approval."
                ),
                error_code="chronicle_before_write_refused",
            )

    def _parse_and_emit_markup(
        self,
        response: Any,
        ambient: Any,
        terminal_guard: Optional[Callable[[], None]] = None,
        side_effect_scope: Optional[Callable[[], Any]] = None,
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
            _run_terminal_guard(terminal_guard)
            with _open_side_effect_scope(side_effect_scope):
                try:
                    # The gate runs before validation so it observes every
                    # attempt the model made, including the malformed ones — an
                    # out-of-union type is exactly what a reviewer wants to see.
                    self._review_chronicle_write(
                        ChronicleBeforeWriteContext(
                            source="anthropic_markup",
                            type=kind_type,
                            title=title,
                            body=body_text,
                        )
                    )
                    # Through the client, not raw at.request: chronicle.write is
                    # where the type union and the 1-200 title bound live.
                    result = self._at.chronicle.write(
                        type=kind_type,  # type: ignore[arg-type]
                        title=title,
                        body=body_text,
                    )
                    # /v1/chronicle returns {entry: {id, ...}}; tolerate flat
                    # {id, ...} too in case the route shape changes.
                    rid: Optional[str] = None
                    if isinstance(result, Mapping):
                        entry = result.get("entry")
                        if isinstance(entry, Mapping):
                            rid = entry.get("id")
                        if rid is None:
                            rid = result.get("id")
                    emissions.append(
                        MarkupEmission(
                            kind="chronicle",
                            id=rid,
                            error=None,
                            source=post,
                        )
                    )
                except Exception as e:
                    emissions.append(
                        MarkupEmission(
                            kind="chronicle",
                            id=None,
                            error=str(e),
                            source=post,
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
            _run_terminal_guard(terminal_guard)
            with _open_side_effect_scope(side_effect_scope):
                try:
                    result = self._at.request("POST", "/v1/traces", post)
                    rid = (
                        result.get("trace_id") if isinstance(result, Mapping) else None
                    )
                    emissions.append(
                        MarkupEmission(
                            kind="trace",
                            id=rid,
                            error=None,
                            source=post,
                        )
                    )
                except Exception as e:
                    emissions.append(
                        MarkupEmission(
                            kind="trace",
                            id=None,
                            error=str(e),
                            source=post,
                        )
                    )

        return emissions


class _CleanupOnce:
    """Choose one lifecycle layer and invoke it at most once.

    A distinct iterator can own the provider resource in its ``finally``
    block, so calling both ``iterator.close()`` and ``stream.close()`` is not
    safe. The first explicit cleanup request chooses one layer; later close or
    abort calls receive the same result or error.
    """

    def __init__(self) -> None:
        self._condition = threading.Condition(threading.RLock())
        self._started = False
        self._done = False
        self._owner: Optional[int] = None
        self._result: Any = None
        self._error: Optional[BaseException] = None

    def run(self, preference: str, iterator: Any, stream: Any) -> Any:
        owner = threading.get_ident()
        with self._condition:
            while self._started and not self._done:
                # Provider cleanup may synchronously re-enter the facade. A
                # synchronous API cannot wait on its own stack; the outer call
                # remains the one authoritative cleanup operation.
                if self._owner == owner:
                    return None
                self._condition.wait()
            if self._done:
                if self._error is not None:
                    raise self._error
                return self._result
            self._started = True
            self._owner = owner

        try:
            result = _invoke_one_cleanup_layer(preference, iterator, stream)
        except BaseException as error:
            with self._condition:
                self._error = error
                self._done = True
                self._owner = None
                self._condition.notify_all()
            raise

        with self._condition:
            self._result = result
            self._done = True
            self._owner = None
            self._condition.notify_all()
        return result

    def note_context_cleanup(
        self,
        result: Any = None,
        error: Optional[BaseException] = None,
    ) -> None:
        """Make a provider-manager exit authoritative when no manual cleanup ran."""

        with self._condition:
            if self._started:
                return
            self._started = True
            self._done = True
            self._result = result
            self._error = error
            self._condition.notify_all()


class _ExitOnce:
    """Invoke one captured context-manager exit method exactly once."""

    def __init__(self, exit_method: Callable[..., Any]) -> None:
        self._exit_method = exit_method
        self._condition = threading.Condition(threading.RLock())
        self._started = False
        self._done = False
        self._owner: Optional[int] = None
        self._result: Any = None
        self._error: Optional[BaseException] = None

    def run(self, exc_type: Any, exc: Any, exc_tb: Any) -> Any:
        owner = threading.get_ident()
        with self._condition:
            while self._started and not self._done:
                if self._owner == owner:
                    return None
                self._condition.wait()
            if self._done:
                if self._error is not None:
                    raise self._error
                return self._result
            self._started = True
            self._owner = owner

        try:
            result = self._exit_method(exc_type, exc, exc_tb)
        except BaseException as error:
            with self._condition:
                self._error = error
                self._done = True
                self._owner = None
                self._condition.notify_all()
            raise

        with self._condition:
            self._result = result
            self._done = True
            self._owner = None
            self._condition.notify_all()
        return result


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
        self.__dict__["_cleanup"] = _CleanupOnce()
        exit_method = getattr(stream, "__exit__", None)
        self.__dict__["_exit_once"] = (
            _ExitOnce(exit_method) if callable(exit_method) else None
        )

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
            try:
                iterator = iter(active)
            except BaseException as error:
                exit_once = self.__dict__["_exit_once"]
                if exit_once is not None:
                    try:
                        result = exit_once.run(
                            type(error),
                            error,
                            error.__traceback__,
                        )
                    except BaseException as exit_error:
                        self.__dict__["_cleanup"].note_context_cleanup(error=exit_error)
                    else:
                        self.__dict__["_cleanup"].note_context_cleanup(result=result)
                else:
                    _cleanup_invalid_stream_value(active)
                raise
            self.__dict__["_iterator"] = iterator
        return self

    def __exit__(self, exc_type: Any, exc: Any, exc_tb: Any) -> Any:
        exit_once = self.__dict__["_exit_once"]
        if exit_once is not None:
            try:
                result = exit_once.run(exc_type, exc, exc_tb)
            except BaseException as error:
                self.__dict__["_cleanup"].note_context_cleanup(error=error)
                raise
            self.__dict__["_cleanup"].note_context_cleanup(result=result)
            return result
        return self.close()

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
        return self.__dict__["_cleanup"].run(
            "close",
            self.__dict__["_iterator"],
            self.__dict__["_active"],
        )

    def abort(self) -> Any:
        return self.__dict__["_cleanup"].run(
            "abort",
            self.__dict__["_iterator"],
            self.__dict__["_active"],
        )

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
        last_user_text: str,
    ) -> None:
        self._manager = manager
        self._adapter = adapter
        self._params = params
        self._meta = meta
        self._ambient = ambient
        self._wake_meta = wake_meta
        self._last_user_text = last_user_text
        self._stream: Optional[_ManagedMessageStreamProxy] = None
        self._exit_condition = threading.Condition(threading.RLock())
        self._exit_started = False
        self._exit_done = False
        self._exit_owner: Optional[int] = None
        self._exit_result: Any = None
        self._exit_error: Optional[BaseException] = None

    def __enter__(self) -> "_ManagedMessageStreamProxy":
        provider_stream = self._manager.__enter__()
        try:
            if not callable(getattr(provider_stream, "get_final_message", None)):
                raise AgentToolError(
                    "Anthropic stream context returned no get_final_message().",
                    error_code="anthropic_stream_helper_invalid",
                    hint=(
                        "Use a client implementing the current Anthropic "
                        "MessageStream helper."
                    ),
                )
            stream = _ManagedMessageStreamProxy(
                provider_stream,
                self._adapter,
                self._params,
                self._meta,
                self._ambient,
                self._wake_meta,
                self._last_user_text,
            )
        except BaseException as error:
            # __enter__ succeeded, but this proxy cannot return its value.
            # Unwind the provider manager once, while preserving the exact
            # validation/construction error even if cleanup also fails.
            try:
                self._exit_provider_manager_once(
                    type(error),
                    error,
                    error.__traceback__,
                )
            except BaseException:
                pass
            raise
        self._stream = stream
        return stream

    def __exit__(self, exc_type: Any, exc: Any, exc_tb: Any) -> Any:
        if self._stream is not None:
            self._stream._mark_closed()
        try:
            result = self._exit_provider_manager_once(exc_type, exc, exc_tb)
        except BaseException as error:
            if self._stream is not None:
                self._stream._note_context_cleanup(error=error)
            raise
        if self._stream is not None:
            self._stream._note_context_cleanup(result=result)
        return result

    def _exit_provider_manager_once(
        self,
        exc_type: Any,
        exc: Any,
        exc_tb: Any,
    ) -> Any:
        owner = threading.get_ident()
        with self._exit_condition:
            while self._exit_started and not self._exit_done:
                if self._exit_owner == owner:
                    return None
                self._exit_condition.wait()
            if self._exit_done:
                if self._exit_error is not None:
                    raise self._exit_error
                return self._exit_result
            self._exit_started = True
            self._exit_owner = owner

        try:
            result = self._manager.__exit__(exc_type, exc, exc_tb)
        except BaseException as error:
            with self._exit_condition:
                self._exit_error = error
                self._exit_done = True
                self._exit_owner = None
                self._exit_condition.notify_all()
            raise

        with self._exit_condition:
            self._exit_result = result
            self._exit_done = True
            self._exit_owner = None
            self._exit_condition.notify_all()
        return result

    def __getattr__(self, name: str) -> Any:
        return getattr(self._manager, name)


class _ManagedTextStreamProxy:
    """Make text-facade cancellation effective before its first read.

    Python generators do not execute their body when ``close()`` is called
    before the first ``next()``. The managed stream's generator owns the
    cancellation logic, so a small eager facade must publish cancellation
    before delegating generator cleanup.
    """

    def __init__(self, owner: "_ManagedMessageStreamProxy", stream: Any) -> None:
        self._owner = owner
        self._stream = stream

    def __iter__(self) -> "_ManagedTextStreamProxy":
        return self

    def __next__(self) -> Any:
        return next(self._stream)

    def send(self, value: Any) -> Any:
        return self._stream.send(value)

    def throw(self, *args: Any) -> Any:
        try:
            return self._stream.throw(*args)
        except GeneratorExit:
            self._owner.close()
            raise
        except BaseException as error:
            selected = self._owner._mark_failed(error)
            if selected is error:
                raise
            raise selected

    def close(self) -> None:
        owner_error: Optional[BaseException] = None
        try:
            self._owner.close()
        except BaseException as error:
            owner_error = error

        try:
            self._stream.close()
        except BaseException:
            if owner_error is None:
                raise

        if owner_error is not None:
            raise owner_error


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
        last_user_text: str,
    ) -> None:
        self.__dict__["_stream"] = stream
        self.__dict__["_iterator"] = iter(stream)
        self.__dict__["_adapter"] = adapter
        self.__dict__["_params"] = params
        self.__dict__["_meta"] = meta
        self.__dict__["_ambient"] = ambient
        self.__dict__["_wake_meta"] = wake_meta
        self.__dict__["_last_user_text"] = last_user_text
        self.__dict__["_condition"] = threading.Condition(threading.RLock())
        self.__dict__["_terminal_intent_lock"] = threading.Lock()
        self.__dict__["_terminal_intent"] = None
        self.__dict__["_terminal_state"] = "open"
        self.__dict__["_terminal_error"] = None
        self.__dict__["_finalization_started"] = False
        self.__dict__["_finalization_done"] = False
        self.__dict__["_finalization_owner"] = None
        self.__dict__["_final_response"] = None
        self.__dict__["_final_error"] = None
        self.__dict__["_cleanup"] = _CleanupOnce()
        self.__dict__["agenttool"] = adapter._empty_augmentation(meta, wake_meta)
        self.__dict__["text_stream"] = _ManagedTextStreamProxy(
            self,
            self._iter_text(),
        )

    def __iter__(self) -> "_ManagedMessageStreamProxy":
        return self

    def __next__(self) -> Any:
        self._stop_if_event_read_is_terminal()
        try:
            value = next(self.__dict__["_iterator"])
        except StopIteration:
            if self._may_finish_naturally():
                self._finish_naturally()
            else:
                self._stop_if_event_read_is_terminal()
            raise
        except BaseException as error:
            selected = self._mark_failed(error)
            if selected is error:
                raise
            raise selected
        self._stop_if_event_read_is_terminal()
        return value

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
        self._mark_closed()
        return self.__dict__["_cleanup"].run(
            "close",
            self.__dict__["_iterator"],
            self.__dict__["_stream"],
        )

    def abort(self) -> Any:
        self._mark_closed()
        return self.__dict__["_cleanup"].run(
            "abort",
            self.__dict__["_iterator"],
            self.__dict__["_stream"],
        )

    def send(self, value: Any) -> Any:
        self._stop_if_event_read_is_terminal()
        send = _first_callable(
            "send",
            self.__dict__["_iterator"],
            self.__dict__["_stream"],
        )
        if send is None:
            raise AttributeError("wrapped Anthropic stream has no send()")
        try:
            result = send(value)
        except StopIteration:
            if self._may_finish_naturally():
                self._finish_naturally()
            raise
        except BaseException as error:
            selected = self._mark_failed(error)
            if selected is error:
                raise
            raise selected
        self._stop_if_event_read_is_terminal()
        return result

    def throw(self, *args: Any) -> Any:
        self._raise_or_throw_locally_if_terminal(args)
        throw = _first_callable(
            "throw",
            self.__dict__["_iterator"],
            self.__dict__["_stream"],
        )
        if throw is None:
            raise AttributeError("wrapped Anthropic stream has no throw()")
        try:
            result = throw(*args)
        except BaseException as error:
            # An injected exception is not natural provider completion, even
            # when the iterator reports it as StopIteration.
            selected = self._mark_failed(error)
            if selected is error:
                raise
            raise selected
        self._stop_if_event_read_is_terminal()
        return result

    def _iter_text(self) -> Any:
        try:
            self._stop_if_event_read_is_terminal()
        except StopIteration:
            return
        try:
            text_stream = iter(getattr(self.__dict__["_stream"], "text_stream"))
        except BaseException as error:
            selected = self._mark_failed(error)
            if selected is error:
                raise
            raise selected
        while True:
            try:
                self._stop_if_event_read_is_terminal()
            except StopIteration:
                return
            try:
                value = next(text_stream)
            except StopIteration:
                if self._may_finish_naturally():
                    self._finish_naturally()
                return
            except BaseException as error:
                selected = self._mark_failed(error)
                if selected is error:
                    raise
                raise selected
            try:
                self._stop_if_event_read_is_terminal()
            except StopIteration:
                return
            try:
                yield value
            except GeneratorExit:
                # Closing or abandoning the text facade is an early consumer
                # termination, not a provider failure.
                self.close()
                raise
            except BaseException as error:
                selected = self._mark_failed(error)
                if selected is error:
                    raise
                raise selected

    def _finish_naturally(self) -> None:
        self._finalize_once()

    def _mark_closed(self) -> None:
        self._publish_terminal_intent("closed", _stream_closed_error())
        with self.__dict__["_condition"]:
            self._apply_terminal_intent_locked()
            self.__dict__["_condition"].notify_all()

    def _mark_failed(self, error: BaseException) -> BaseException:
        self._publish_terminal_intent("failed", error)
        with self.__dict__["_condition"]:
            self._apply_terminal_intent_locked()
            self.__dict__["_condition"].notify_all()
            terminal = self._terminal_error_locked()
            return terminal if terminal is not None else error

    def _note_context_cleanup(
        self,
        result: Any = None,
        error: Optional[BaseException] = None,
    ) -> None:
        self.__dict__["_cleanup"].note_context_cleanup(result=result, error=error)

    def _may_finish_naturally(self) -> bool:
        with self.__dict__["_condition"]:
            return self.__dict__["_terminal_state"] == "open"

    def _stop_if_event_read_is_terminal(self) -> None:
        with self.__dict__["_condition"]:
            terminal = self._terminal_error_locked()
            state = self.__dict__["_terminal_state"]
            if state in ("closed", "completed"):
                raise StopIteration
            if terminal is not None:
                raise terminal

    def _raise_if_terminal(self) -> None:
        with self.__dict__["_condition"]:
            terminal = self._terminal_error_locked()
            if terminal is not None:
                raise terminal

    def _raise_or_throw_locally_if_terminal(self, args: tuple[Any, ...]) -> None:
        with self.__dict__["_condition"]:
            terminal = self._terminal_error_locked()
            state = self.__dict__["_terminal_state"]
            if state == "completed":
                throw_locally = True
            else:
                throw_locally = False
                if terminal is not None:
                    raise terminal
        if throw_locally:
            _throw_locally(*args)

    def _terminal_error_locked(self) -> Optional[BaseException]:
        self._apply_terminal_intent_locked()
        state = self.__dict__["_terminal_state"]
        if state == "closed":
            if self.__dict__["_terminal_error"] is None:
                self.__dict__["_terminal_error"] = _stream_closed_error()
            return self.__dict__["_terminal_error"]
        if state == "failed":
            if self.__dict__["_terminal_error"] is None:
                self.__dict__["_terminal_error"] = _stream_failed_error()
            return self.__dict__["_terminal_error"]
        return None

    def _publish_terminal_intent(
        self,
        state: str,
        error: BaseException,
    ) -> tuple[str, BaseException]:
        with self.__dict__["_terminal_intent_lock"]:
            intent = self.__dict__["_terminal_intent"]
            if intent is None:
                intent = (state, error)
                self.__dict__["_terminal_intent"] = intent
            return intent

    def _apply_terminal_intent_locked(self) -> None:
        if self.__dict__["_terminal_state"] not in ("open", "finalizing"):
            return
        with self.__dict__["_terminal_intent_lock"]:
            intent = self.__dict__["_terminal_intent"]
        if intent is None:
            return
        state, error = intent
        self.__dict__["_terminal_state"] = state
        self.__dict__["_terminal_error"] = error

    def _finalize_once(self) -> Any:
        owner = threading.get_ident()
        with self.__dict__["_condition"]:
            while True:
                terminal = self._terminal_error_locked()
                if terminal is not None:
                    raise terminal
                if self.__dict__["_finalization_done"]:
                    error = self.__dict__["_final_error"]
                    if error is not None:
                        raise error
                    return self.__dict__["_final_response"]
                if not self.__dict__["_finalization_started"]:
                    self.__dict__["_finalization_started"] = True
                    self.__dict__["_finalization_owner"] = owner
                    self.__dict__["_terminal_state"] = "finalizing"
                    break
                if self.__dict__["_finalization_owner"] == owner:
                    raise _stream_reentrant_finalization_error()
                self.__dict__["_condition"].wait()

        try:
            # This is the only call site for the provider helper's final
            # Message. It may consume remaining events when called early.
            final_message = self.__dict__["_stream"].get_final_message()
            self._raise_if_terminal()
            adapted = self.__dict__["_adapter"]._finalize_response(
                self.__dict__["_params"],
                final_message,
                self.__dict__["_meta"],
                self.__dict__["_ambient"],
                self.__dict__["_wake_meta"],
                self.__dict__["_last_user_text"],
                self._raise_if_terminal,
                self._side_effect_scope,
            )
            self._raise_if_terminal()
        except BaseException as error:
            selected = self._finish_finalization_failure(error)
            if selected is error:
                raise
            raise selected

        with self.__dict__["_condition"]:
            terminal = self._terminal_error_locked()
            if terminal is not None:
                self._complete_finalization_locked(error=terminal)
            else:
                self.__dict__["_final_response"] = adapted
                self.__dict__["agenttool"] = adapted.agenttool
                self.__dict__["_terminal_state"] = "completed"
                self._complete_finalization_locked()
                return adapted
        raise terminal

    def _finish_finalization_failure(
        self,
        error: BaseException,
    ) -> BaseException:
        self._publish_terminal_intent("failed", error)
        with self.__dict__["_condition"]:
            terminal = self._terminal_error_locked()
            if terminal is None:
                terminal = error
            self._complete_finalization_locked(error=terminal)
            return terminal

    @contextmanager
    def _side_effect_scope(self) -> Any:
        # A close/error from another thread either acquires this lock first and
        # prevents the request, or waits until this already-started synchronous
        # request returns. This is the linearization boundary for side effects.
        with self.__dict__["_condition"]:
            terminal = self._terminal_error_locked()
            if terminal is not None:
                raise terminal
            yield

    def _complete_finalization_locked(
        self,
        error: Optional[BaseException] = None,
    ) -> None:
        self.__dict__["_final_error"] = error
        self.__dict__["_finalization_done"] = True
        self.__dict__["_finalization_owner"] = None
        self.__dict__["_condition"].notify_all()

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
            # Fall through to item access for mapping-shaped responses.
            if isinstance(resp, Mapping) and name in resp:
                return resp[name]
            raise AttributeError(f"{type(self).__name__!r} has no attribute {name!r}")

    def __getitem__(self, key: Any) -> Any:
        resp = self.__dict__["_response"]
        if isinstance(resp, Mapping):
            return resp[key]
        return getattr(resp, key)

    def __contains__(self, key: Any) -> bool:
        resp = self.__dict__["_response"]
        if isinstance(resp, Mapping):
            return key in resp
        return hasattr(resp, key)

    def __repr__(self) -> str:
        return (
            f"<{type(self).__name__} agenttool={self.__dict__['agenttool']!r} "
            f"response={self.__dict__['_response']!r}>"
        )


class _MappingResponseWithAgentTool(_ResponseWithAgentTool, Mapping):
    """Preserve the full mapping protocol for read-only mapping responses."""

    def __iter__(self) -> Any:
        return iter(self.__dict__["_response"])

    def __len__(self) -> int:
        return len(self.__dict__["_response"])


# ── Helpers ──────────────────────────────────────────────────────────────


def _as_dict(value: Any) -> dict:
    return dict(value) if isinstance(value, Mapping) else {}


def _run_terminal_guard(
    terminal_guard: Optional[Callable[[], None]],
) -> None:
    if terminal_guard is not None:
        terminal_guard()


def _open_side_effect_scope(
    side_effect_scope: Optional[Callable[[], Any]],
) -> Any:
    if side_effect_scope is None:
        return nullcontext()
    return side_effect_scope()


def _throw_locally(*args: Any) -> Any:
    """Apply generator ``throw`` semantics without touching the provider."""

    stopped = (value for value in ())
    try:
        next(stopped)
    except StopIteration:
        pass
    return stopped.throw(*args)


def _attach_agenttool(
    response: Any,
    agenttool: AgentToolAugmentation,
) -> Any:
    """Keep extensible response objects intact; wrap immutable shapes safely.

    The official Python SDK returns models that may reject ``setattr`` and raw
    HTTP clients often return dictionaries. Both use the forwarding wrapper.
    A custom response object that explicitly permits a new attribute keeps its
    original identity and type.
    """

    # A provider may reuse one mutable response across concurrent calls.
    # Serialize the check-and-set so one call can keep provider identity while
    # every later call receives a wrapper with its own stable receipt.
    with _ATTACH_AGENTTOOL_LOCK:
        try:
            getattr(response, "agenttool")
        except AttributeError:
            try:
                setattr(response, "agenttool", agenttool)
                if getattr(response, "agenttool") is agenttool:
                    return response
            except Exception:
                pass
        except Exception:
            pass
        wrapper = (
            _MappingResponseWithAgentTool
            if isinstance(response, Mapping)
            else _ResponseWithAgentTool
        )
        return wrapper(response, agenttool)


def _cleanup_invalid_stream_value(value: Any) -> None:
    """Best-effort cleanup without hiding the useful shape error."""

    try:
        close = getattr(value, "close", None)
        if callable(close):
            close()
            return
        abort = getattr(value, "abort", None)
        if callable(abort):
            abort()
    except BaseException:
        pass


def _first_callable(name: str, *targets: Any) -> Any:
    """Return the first named lifecycle method across distinct targets."""

    seen: set[int] = set()
    for target in targets:
        if target is None or id(target) in seen:
            continue
        seen.add(id(target))
        method = getattr(target, name, None)
        if callable(method):
            return method
    return None


def _invoke_one_cleanup_layer(preference: str, iterator: Any, stream: Any) -> Any:
    """Invoke one adapter-visible cleanup layer.

    ``abort`` is provider-specific, so prefer it when requested. For ordinary
    close, a distinct iterator goes first because its ``finally`` block can own
    provider cleanup. The opaque provider context manager remains authoritative
    on context exit and may perform its own internal cleanup.
    """

    if preference == "abort":
        abort = _first_callable("abort", stream, iterator)
        if abort is not None:
            return abort()

    close = _first_callable("close", iterator, stream)
    if close is not None:
        return close()
    return None


def _stream_closed_error() -> AgentToolError:
    return AgentToolError(
        "Anthropic stream was closed before a final message became available.",
        error_code="anthropic_stream_closed",
        hint="Read the final message before closing the stream.",
    )


def _stream_failed_error() -> AgentToolError:
    return AgentToolError(
        "Anthropic stream failed before a final message became available.",
        error_code="anthropic_stream_failed",
        hint="Inspect the earlier provider stream error.",
    )


def _stream_reentrant_finalization_error() -> AgentToolError:
    return AgentToolError(
        "Anthropic final-message retrieval re-entered itself.",
        error_code="anthropic_stream_reentrant_finalization",
        hint="Wait for the current get_final_message() call to finish.",
    )


def _is_stream_like(value: Any) -> bool:
    return not isinstance(
        value, (Mapping, str, bytes, bytearray, list, tuple)
    ) and callable(getattr(value, "__iter__", None))


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
        if isinstance(response, Mapping)
        else getattr(response, "content", None)
    )
    if not blocks:
        return ""
    parts: list[str] = []
    for b in blocks:
        if isinstance(b, Mapping):
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
        if isinstance(response, Mapping)
        else getattr(response, "content", None)
    )
    parts: list[str] = []
    for block in blocks or []:
        if isinstance(block, Mapping):
            if block.get("type") == "text" and isinstance(block.get("text"), str):
                parts.append(block["text"])
        elif getattr(block, "type", None) == "text" and isinstance(
            getattr(block, "text", None), str
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
        if not isinstance(m, Mapping):
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
                if isinstance(b, Mapping) and b.get("text")
            )
    return ""
