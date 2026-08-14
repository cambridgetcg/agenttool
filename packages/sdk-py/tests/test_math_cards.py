"""Hermetic contract tests for the credential-free Math Cards client."""

from __future__ import annotations

from copy import deepcopy
import json
import os
from threading import Event, Thread
from typing import Any, Callable
from unittest.mock import patch

import httpx
import pytest

import agenttool
from agenttool import AgentTool, AgentToolError, MathCardsClient
from tests.math_cards_fixture import MATH_CARD_INPUT, math_card_response


def _json_response(
    request: httpx.Request,
    body: object,
    *,
    status: int = 200,
    media_type: str = "application/json; charset=utf-8",
) -> httpx.Response:
    return httpx.Response(
        status,
        content=json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode(),
        headers={"content-type": media_type},
        request=request,
    )


def _client(
    handler: Callable[[httpx.Request], httpx.Response],
    **options: object,
) -> MathCardsClient:
    return MathCardsClient(transport=httpx.MockTransport(handler), **options)


class _ObservedRLock:
    """Expose a post-arm acquire attempt without using elapsed time as evidence."""

    def __init__(self, lock: Any) -> None:
        self._lock = lock
        self._armed = Event()
        self.attempted = Event()
        self.acquired = Event()

    def arm(self) -> None:
        self._armed.set()

    def __enter__(self) -> "_ObservedRLock":
        armed = self._armed.is_set()
        if armed:
            self.attempted.set()
        self._lock.acquire()
        if armed:
            self.acquired.set()
        return self

    def __exit__(self, *args: object) -> None:
        self._lock.release()


class TestMathCardsCredentialFreeBoundary:
    def test_transport_path_stays_module_private_at_root(self) -> None:
        assert "MATH_CARDS_PATH" not in agenttool.__all__
        assert not hasattr(agenttool, "MATH_CARDS_PATH")

    def test_exact_request_bytes_and_no_bearer_cookie_or_env_proxy(self) -> None:
        requests: list[httpx.Request] = []
        sentinel = "math-cards-secret-must-not-cross"

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return _json_response(
                request,
                math_card_response("ready_for_bounded_inquiry"),
            )

        with patch.dict(
            os.environ,
            {
                "AT_API_KEY": sentinel,
                "HTTP_PROXY": f"http://{sentinel}@proxy.invalid",
                "HTTPS_PROXY": f"https://{sentinel}@proxy.invalid",
            },
        ):
            with _client(
                handler,
                base_url="https://cards.example.test/prefix/",
            ) as cards:
                result = cards.assess(MATH_CARD_INPUT)

        assert result["assessment"]["status"] == "ready_for_bounded_inquiry"
        assert len(requests) == 1
        request = requests[0]
        assert request.method == "POST"
        assert request.url == httpx.URL(
            "https://cards.example.test/prefix/v1/math-cards/assess"
        )
        expected = json.dumps(
            MATH_CARD_INPUT,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode()
        assert request.content == expected
        assert request.headers["accept"] == "application/json"
        assert request.headers["content-type"] == "application/json"
        assert "authorization" not in request.headers
        assert "cookie" not in request.headers
        assert "x-agenttool-client" not in request.headers
        assert sentinel not in repr((request.url, dict(request.headers), request.content))
        assert "schema_version" not in json.loads(request.content)
        assert "card_id" not in json.loads(request.content)
        assert "boundaries" not in json.loads(request.content)

    def test_response_cookie_is_neither_retained_nor_replayed(self) -> None:
        cookies: list[str | None] = []

        def handler(request: httpx.Request) -> httpx.Response:
            cookies.append(request.headers.get("cookie"))
            response = _json_response(
                request,
                math_card_response("ready_for_bounded_inquiry"),
            )
            response.headers["set-cookie"] = "sid=sentinel; Path=/; HttpOnly"
            return response

        with _client(handler) as cards:
            cards.assess(MATH_CARD_INPUT)
            cards.assess(MATH_CARD_INPUT)
            assert len(cards._http.cookies) == 0

        assert cookies == [None, None]

    def test_guided_error_cookie_is_cleared_before_next_assessment(self) -> None:
        cookies: list[str | None] = []

        def handler(request: httpx.Request) -> httpx.Response:
            cookies.append(request.headers.get("cookie"))
            if len(cookies) == 1:
                response = _json_response(
                    request,
                    {
                        "error": "math_card_invalid_input",
                        "message": "Repair the bounded Math Card input.",
                        "hint": "Repair the named field and retry deliberately.",
                    },
                    status=400,
                )
                response.headers["set-cookie"] = "sid=sentinel; Path=/; HttpOnly"
                return response
            return _json_response(
                request,
                math_card_response("ready_for_bounded_inquiry"),
            )

        with _client(handler) as cards:
            with pytest.raises(AgentToolError) as exc_info:
                cards.assess(MATH_CARD_INPUT)
            assert exc_info.value.code == "math_card_invalid_input"
            assert len(cards._http.cookies) == 0
            result = cards.assess(MATH_CARD_INPUT)

        assert result["assessment"]["status"] == "ready_for_bounded_inquiry"
        assert cookies == [None, None]

    def test_concurrent_assessments_are_serialized_across_cookie_cleanup(self) -> None:
        first_entered = Event()
        release_first = Event()
        second_entered = Event()
        cookies: list[str | None] = []
        errors: list[BaseException] = []

        def handler(request: httpx.Request) -> httpx.Response:
            cookies.append(request.headers.get("cookie"))
            if len(cookies) == 1:
                first_entered.set()
                if not release_first.wait(2):
                    raise RuntimeError("timed out waiting to release first assessment")
            else:
                second_entered.set()
            response = _json_response(
                request,
                math_card_response("questions_open"),
            )
            response.headers["set-cookie"] = "sid=sentinel; Path=/; HttpOnly"
            return response

        cards = _client(handler)
        observed_lock = _ObservedRLock(cards._transaction_lock)
        cards._transaction_lock = observed_lock  # type: ignore[assignment]

        def assess() -> None:
            try:
                cards.assess(MATH_CARD_INPUT)
            except BaseException as error:  # pragma: no cover - asserted below
                errors.append(error)

        first = Thread(target=assess)
        second = Thread(target=assess)
        first.start()
        try:
            assert first_entered.wait(1)
            observed_lock.arm()
            second.start()
            assert observed_lock.attempted.wait(1)
            assert not observed_lock.acquired.is_set()
            assert not second_entered.is_set()
        finally:
            release_first.set()
            first.join(2)
            if second.ident is not None:
                second.join(2)
            cards.close()

        assert not first.is_alive()
        assert not second.is_alive()
        assert errors == []
        assert observed_lock.acquired.is_set()
        assert second_entered.is_set()
        assert cookies == [None, None]
        assert len(cards._http.cookies) == 0

    def test_close_waits_for_assessment_and_clears_the_cookie_jar(self) -> None:
        assessment_entered = Event()
        release_assessment = Event()
        close_started = Event()
        close_finished = Event()
        errors: list[BaseException] = []

        def handler(request: httpx.Request) -> httpx.Response:
            assessment_entered.set()
            if not release_assessment.wait(2):
                raise RuntimeError("timed out waiting to release assessment")
            response = _json_response(
                request,
                math_card_response("redesign_or_stop"),
            )
            response.headers["set-cookie"] = "sid=sentinel; Path=/; HttpOnly"
            return response

        cards = _client(handler)
        observed_lock = _ObservedRLock(cards._transaction_lock)
        cards._transaction_lock = observed_lock  # type: ignore[assignment]

        def assess() -> None:
            try:
                cards.assess(MATH_CARD_INPUT)
            except BaseException as error:  # pragma: no cover - asserted below
                errors.append(error)

        def close() -> None:
            close_started.set()
            try:
                cards.close()
            except BaseException as error:  # pragma: no cover - asserted below
                errors.append(error)
            finally:
                close_finished.set()

        assessment = Thread(target=assess)
        closer = Thread(target=close)
        assessment.start()
        try:
            assert assessment_entered.wait(1)
            observed_lock.arm()
            closer.start()
            assert close_started.wait(1)
            assert observed_lock.attempted.wait(1)
            assert not observed_lock.acquired.is_set()
            assert not close_finished.is_set()
        finally:
            release_assessment.set()
            assessment.join(2)
            if closer.ident is not None:
                closer.join(2)

        assert not assessment.is_alive()
        assert not closer.is_alive()
        assert errors == []
        assert observed_lock.acquired.is_set()
        assert close_finished.is_set()
        assert cards._http.is_closed
        assert len(cards._http.cookies) == 0

    def test_constructs_a_hardened_dedicated_http_client(self) -> None:
        with patch("agenttool.math_cards.httpx.Client") as client_type:
            client_type.return_value.close.return_value = None
            client = MathCardsClient()
            client.close()

        options = client_type.call_args.kwargs
        assert options["auth"] is None
        assert options["cookies"] == {}
        assert options["follow_redirects"] is False
        assert options["trust_env"] is False
        assert options["headers"] == {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def test_agenttool_composes_lazily_without_authenticated_transport(self) -> None:
        hosted_calls = 0

        def hosted_handler(request: httpx.Request) -> httpx.Response:
            nonlocal hosted_calls
            hosted_calls += 1
            raise AssertionError(f"hosted transport received {request.url}")

        at = AgentTool(
            transport=httpx.MockTransport(hosted_handler),
            base_url="https://composed.example.test/",
            math_cards_timeout=2.5,
            math_cards_max_response_bytes=32 * 1024,
        )
        assert at._math_cards is None
        cards = at.math_cards
        assert cards is at.math_cards
        assert cards._http is not at._http
        assert "authorization" not in cards._http.headers
        assert cards._base_url == "https://composed.example.test"

        cards._http.close()
        cards._http = httpx.Client(
            transport=httpx.MockTransport(
                lambda request: _json_response(
                    request,
                    math_card_response("questions_open"),
                )
            ),
            auth=None,
            cookies={},
            follow_redirects=False,
            trust_env=False,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
        )
        assert cards.assess(MATH_CARD_INPUT)["assessment"]["status"] == "questions_open"
        assert hosted_calls == 0
        at.close()
        assert cards._http.is_closed


@pytest.mark.parametrize(
    "status",
    ["ready_for_bounded_inquiry", "questions_open", "redesign_or_stop"],
)
def test_accepts_each_server_owned_assessment_status(status: str) -> None:
    with _client(
        lambda request: _json_response(
            request,
            math_card_response(status),  # type: ignore[arg-type]
            media_type="application/vnd.agenttool.math-card+json",
        )
    ) as cards:
        result = cards.assess(MATH_CARD_INPUT)
    assert result["assessment"]["status"] == status
    assert result["card"]["card_id"] == result["assessment"]["card_id"]


@pytest.mark.parametrize(
    ("state", "scope_refs"),
    [
        ("answered", []),
        ("unknown", [MATH_CARD_INPUT["scope_ref"]]),
    ],
)
def test_rejects_invalid_scoped_answer_input_before_network(
    state: str,
    scope_refs: list[str],
) -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return _json_response(request, math_card_response("questions_open"))

    candidate = deepcopy(MATH_CARD_INPUT)
    candidate["distribution"]["beneficiaries"] = {
        "state": state,
        "scope_refs": scope_refs,
    }
    with (
        _client(handler) as cards,
        pytest.raises(AgentToolError) as exc_info,
    ):
        cards.assess(candidate)
    assert exc_info.value.code == "math_card_invalid_input"
    assert calls == 0


@pytest.mark.parametrize(
    ("state", "scope_refs"),
    [
        ("answered", []),
        ("unknown", [MATH_CARD_INPUT["scope_ref"]]),
    ],
)
def test_rejects_invalid_scoped_answer_in_returned_card(
    state: str,
    scope_refs: list[str],
) -> None:
    body = math_card_response("questions_open")
    body["card"]["distribution"]["beneficiaries"] = {
        "state": state,
        "scope_refs": scope_refs,
    }
    with (
        _client(lambda request: _json_response(request, body)) as cards,
        pytest.raises(AgentToolError) as exc_info,
    ):
        cards.assess(MATH_CARD_INPUT)
    assert exc_info.value.code == "math_card_invalid_response"


def test_rejects_escaped_lone_surrogate_in_response_string() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = math_card_response("questions_open")
        body["assessment"]["open_questions"] = ["\ud800"]
        return httpx.Response(
            200,
            content=json.dumps(
                body,
                ensure_ascii=True,
                separators=(",", ":"),
            ).encode("ascii"),
            headers={"content-type": "application/json"},
            request=request,
        )

    with (
        _client(handler) as cards,
        pytest.raises(AgentToolError) as exc_info,
    ):
        cards.assess(MATH_CARD_INPUT)
    assert exc_info.value.code == "math_card_invalid_response"


class _ReadTimeoutStream(httpx.SyncByteStream):
    def __iter__(self):
        raise httpx.ReadTimeout("synthetic streamed read timeout")
        yield b""  # pragma: no cover


def test_streamed_timeout_clears_cookie_before_next_assessment() -> None:
    cookies: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        cookies.append(request.headers.get("cookie"))
        if len(cookies) == 1:
            return httpx.Response(
                200,
                stream=_ReadTimeoutStream(),
                headers={
                    "content-type": "application/json",
                    "set-cookie": "sid=sentinel; Path=/; HttpOnly",
                },
                request=request,
            )
        return _json_response(
            request,
            math_card_response("questions_open"),
        )

    with _client(handler) as cards:
        with pytest.raises(AgentToolError) as exc_info:
            cards.assess(MATH_CARD_INPUT)
        assert exc_info.value.code == "math_card_unreachable"
        assert len(cards._http.cookies) == 0
        result = cards.assess(MATH_CARD_INPUT)

    assert result["assessment"]["status"] == "questions_open"
    assert cookies == [None, None]


class TestMathCardsBoundsAndErrors:
    def test_request_limit_fails_before_network(self) -> None:
        calls = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return _json_response(request, math_card_response("questions_open"))

        with (
            _client(handler, max_request_bytes=1024) as cards,
            pytest.raises(AgentToolError) as exc_info,
        ):
            cards.assess(MATH_CARD_INPUT)
        assert exc_info.value.code == "math_card_request_too_large"
        assert calls == 0

    def test_response_limit_is_enforced_while_streaming(self) -> None:
        with (
            _client(
                lambda request: _json_response(
                    request,
                    math_card_response("ready_for_bounded_inquiry"),
                ),
                max_response_bytes=1024,
            ) as cards,
            pytest.raises(AgentToolError) as exc_info,
        ):
            cards.assess(MATH_CARD_INPUT)
        assert exc_info.value.code == "math_card_response_too_large"

    @pytest.mark.parametrize("status", [300, 302, 307, 308])
    def test_refuses_redirects(self, status: int) -> None:
        with (
            _client(
                lambda request: httpx.Response(
                    status,
                    headers={"location": "https://redirected.example.test"},
                    request=request,
                )
            ) as cards,
            pytest.raises(AgentToolError) as exc_info,
        ):
            cards.assess(MATH_CARD_INPUT)
        assert exc_info.value.code == "math_card_redirect_refused"
        assert exc_info.value.status == status

    def test_rejects_non_json_success_and_malformed_envelope(self) -> None:
        with (
            _client(
                lambda request: _json_response(
                    request,
                    math_card_response("ready_for_bounded_inquiry"),
                    media_type="text/plain",
                )
            ) as cards,
            pytest.raises(AgentToolError) as media_error,
        ):
            cards.assess(MATH_CARD_INPUT)
        assert media_error.value.code == "math_card_invalid_response"

        with (
            _client(lambda request: _json_response(request, {"card": {}})) as cards,
            pytest.raises(AgentToolError) as shape_error,
        ):
            cards.assess(MATH_CARD_INPUT)
        assert shape_error.value.code == "math_card_invalid_response"

    @pytest.mark.parametrize("status", [400, 413, 415])
    def test_preserves_guided_errors(self, status: int) -> None:
        body = {
            "error": f"math_card_http_{status}",
            "message": f"Math Card request stopped at {status}.",
            "hint": "Repair the named field and retry deliberately.",
            "details": {"field": "question_ref", "status": status},
            "next_actions": [
                {
                    "action": "Repair input",
                    "method": "POST",
                    "path": "/v1/math-cards/assess",
                }
            ],
            "docs": "https://docs.agenttool.dev/MATH-CARDS.md",
        }
        with (
            _client(
                lambda request: _json_response(
                    request,
                    body,
                    status=status,
                )
            ) as cards,
            pytest.raises(AgentToolError) as exc_info,
        ):
            cards.assess(MATH_CARD_INPUT)

        error = exc_info.value
        assert error.code == body["error"]
        assert error.status == status
        assert str(error).startswith(str(body["message"]))
        assert error.hint == body["hint"]
        assert error.details == body["details"]
        assert error.next_actions == body["next_actions"]
