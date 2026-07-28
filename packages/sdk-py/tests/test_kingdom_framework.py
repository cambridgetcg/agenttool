"""Hermetic contract tests for the public KINGDOM framework namespace."""

from __future__ import annotations

import copy
import json
import math
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Optional
from unittest.mock import patch

import httpx
import pytest

from agenttool import (
    KINGDOM_FRAMEWORK_PATH,
    KINGDOM_FRAMEWORK_SCHEMA_VERSION,
    AgentTool,
    AgentToolError,
    KingdomFrameworkCard,
    KingdomFrameworkClient,
)


CARD: KingdomFrameworkCard = {
    "schema_version": "agenttool.kingdom.card/0.1",
    "name": "agenttool",
    "kind": "infra",
    "layer": "nervous",
    "owner_sister": "none",
    "domain": "none",
    "state": "active",
    "purpose": (
        "Agent-facing public discovery, hosted identity and memory, "
        "caller-signed data, and optional local tools."
    ),
    "dependsOn": ["xenia"],
    "adopts": ["xenia.rights/0.1"],
}
CARD_FIELDS = tuple(CARD)


def _json_response(
    request: httpx.Request,
    payload: object,
    *,
    status: int = 200,
    media_type: str = "application/json; charset=utf-8",
) -> httpx.Response:
    return httpx.Response(
        status,
        content=json.dumps(
            payload,
            ensure_ascii=True,
            separators=(",", ":"),
        ).encode("utf-8"),
        headers={"Content-Type": media_type},
        request=request,
    )


def _client_for(
    handler: Callable[[httpx.Request], httpx.Response],
    **options: object,
) -> KingdomFrameworkClient:
    return KingdomFrameworkClient(
        transport=httpx.MockTransport(handler),
        **options,
    )


class _ChunkStream(httpx.SyncByteStream):
    def __init__(self, *chunks: bytes) -> None:
        self._chunks = chunks

    def __iter__(self) -> Any:
        yield from self._chunks


class _MustNotReadStream(httpx.SyncByteStream):
    def __iter__(self) -> Any:
        raise AssertionError("the remote error body must not be read")


class TestKingdomFrameworkCredentialFreeRead:
    def test_fetches_exact_path_and_returns_typed_closed_card(self) -> None:
        requests: list[httpx.Request] = []
        sentinel = "agenttool-project-bearer-must-not-cross"

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return _json_response(request, CARD)

        with patch.dict(
            os.environ,
            {
                "AT_API_KEY": sentinel,
                "HTTPS_PROXY": f"https://proxy-user:{sentinel}@proxy.invalid",
            },
        ):
            with _client_for(
                handler,
                base_url="https://staging.example/prefix/",
            ) as kingdom:
                card = kingdom.card()

        assert card == CARD
        assert set(card) == set(CARD_FIELDS)
        assert len(requests) == 1
        request = requests[0]
        assert request.method == "GET"
        assert request.url == httpx.URL(
            "https://staging.example/prefix/public/kingdom/framework"
        )
        assert request.headers["accept"] == "application/json"
        assert "authorization" not in request.headers
        assert "cookie" not in request.headers
        assert sentinel not in " ".join(
            (
                str(request.url),
                repr(dict(request.headers)),
                request.content.decode("utf-8"),
            )
        )

    def test_constructs_a_hardened_dedicated_http_client(self) -> None:
        with patch("agenttool.kingdom_framework.httpx.Client") as client_type:
            client_type.return_value.close.return_value = None
            client = KingdomFrameworkClient()
            client.close()

        options = client_type.call_args.kwargs
        assert options["auth"] is None
        assert options["cookies"] == {}
        assert options["follow_redirects"] is False
        assert options["trust_env"] is False
        assert options["headers"] == {"Accept": "application/json"}
        assert "authorization" not in options["headers"]

    def test_agenttool_composes_lazily_without_sharing_hosted_authority(
        self,
    ) -> None:
        sentinel = "hosted-project-bearer"
        with patch.dict(os.environ, {}, clear=True):
            at = AgentTool(
                api_key=sentinel,
                base_url="https://staging.example/prefix/",
                kingdom_framework_timeout=2.5,
                kingdom_framework_max_response_bytes=4096,
            )
            assert at._kingdom_framework is None

            framework = at.kingdom_framework

            assert framework is at.kingdom_framework
            assert framework._http is not at._http
            assert framework._base_url == "https://staging.example/prefix"
            assert framework._max_response_bytes == 4096
            assert framework._http.timeout.read == 2.5
            assert "authorization" not in framework._http.headers
            assert at._http.headers["authorization"] == f"Bearer {sentinel}"
            at.close()
            assert framework._http.is_closed

    def test_accepts_an_application_json_suffix_media_type(self) -> None:
        with _client_for(
            lambda request: _json_response(
                request,
                CARD,
                media_type="application/vnd.agenttool.kingdom.card+json",
            )
        ) as kingdom:
            assert kingdom.card() == CARD


class TestKingdomFrameworkTransportBoundaries:
    @pytest.mark.parametrize("status", [300, 301, 302, 307, 308, 399])
    def test_refuses_every_redirect_without_a_second_request(
        self,
        status: int,
    ) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(
                status,
                headers={"Location": "https://redirected.example/card"},
                request=request,
            )

        with (
            _client_for(handler) as kingdom,
            pytest.raises(AgentToolError) as exc_info,
        ):
            kingdom.card()

        assert exc_info.value.error_code == "kingdom_framework_redirect_refused"
        assert exc_info.value.code == status
        assert len(requests) == 1

    @pytest.mark.parametrize(
        "media_type",
        [
            "text/json",
            "text/plain",
            "application/octet-stream",
            "application/+json",
            "application/ +json",
            "application/foo +json",
            "application/foo/bar+json",
            "",
        ],
    )
    def test_rejects_unsupported_or_missing_success_media_type(
        self,
        media_type: str,
    ) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            headers = {"Content-Type": media_type} if media_type else {}
            return httpx.Response(
                200,
                content=json.dumps(CARD).encode(),
                headers=headers,
                request=request,
            )

        with (
            _client_for(handler) as kingdom,
            pytest.raises(AgentToolError) as exc_info,
        ):
            kingdom.card()

        assert (
            exc_info.value.error_code
            == "kingdom_framework_unsupported_media_type"
        )
        assert exc_info.value.code == 200

    def test_rejects_declared_response_length_before_reading(self) -> None:
        class MustNotRead(httpx.SyncByteStream):
            def __iter__(self) -> Any:
                raise AssertionError("oversized declared body must not be read")

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                stream=MustNotRead(),
                headers={
                    "Content-Type": "application/json",
                    "Content-Length": "2048",
                },
                request=request,
            )

        with (
            _client_for(handler, max_response_bytes=1024) as kingdom,
            pytest.raises(AgentToolError) as exc_info,
        ):
            kingdom.card()

        assert (
            exc_info.value.error_code
            == "kingdom_framework_response_too_large"
        )
        assert exc_info.value.details == {"max_response_bytes": 1024}

    def test_caps_streamed_decoded_bytes_without_content_length(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                stream=_ChunkStream(b" " * 700, b" " * 700),
                headers={"Content-Type": "application/json"},
                request=request,
            )

        with (
            _client_for(handler, max_response_bytes=1024) as kingdom,
            pytest.raises(AgentToolError) as exc_info,
        ):
            kingdom.card()

        assert (
            exc_info.value.error_code
            == "kingdom_framework_response_too_large"
        )

    def test_maps_response_stream_failure_without_reflecting_diagnostics(
        self,
    ) -> None:
        sentinel = "stream-diagnostic-must-not-be-reflected"

        class BrokenStream(httpx.SyncByteStream):
            def __iter__(self) -> Any:
                yield b'{"schema_version":'
                raise httpx.ReadError(sentinel)

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                stream=BrokenStream(),
                headers={"Content-Type": "application/json"},
                request=request,
            )

        with (
            _client_for(handler) as kingdom,
            pytest.raises(AgentToolError) as exc_info,
        ):
            kingdom.card()

        assert exc_info.value.error_code == "kingdom_framework_invalid_response"
        assert sentinel not in str(exc_info.value)

    def test_http_failure_uses_fixed_local_guidance_without_reading_body(
        self,
    ) -> None:
        sentinel = "hostile-remote-guidance-must-not-surface"

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                402,
                stream=_MustNotReadStream(),
                headers={
                    "Content-Type": "application/problem+json",
                    "Payment-Required": sentinel,
                    "Payment-Response": sentinel,
                    "Link": f"<https://{sentinel}.invalid/status>; rel=status",
                    "Retry-After": "999",
                    "X-Credits-Balance": sentinel,
                },
                request=request,
            )

        with (
            _client_for(handler) as kingdom,
            pytest.raises(AgentToolError) as exc_info,
        ):
            kingdom.card()

        error = exc_info.value
        assert error.code == 402
        assert error.error_code == "kingdom_framework_http_error"
        assert error.message == (
            "The KINGDOM framework endpoint returned HTTP 402."
        )
        assert error.hint == (
            "Check the configured public endpoint and retry deliberately."
        )
        assert error.docs == "https://docs.agenttool.dev/AGENT-DISCOVERY.md"
        assert error.safety == KINGDOM_FRAMEWORK_PATH
        assert error.next_actions is None
        assert error.details is None
        assert error.x402_version is None
        assert error.accepts is None
        assert error.x402_resource is None
        assert error.extensions is None
        assert error.payment_required is None
        assert error.payment_response is None
        assert error.payment_status_link is None
        assert error.retry_after is None
        assert error.credits_balance is None
        assert sentinel not in str(error)

    def test_maps_non_json_http_failure_to_stable_error(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                500,
                content=b"upstream internals are intentionally not surfaced",
                headers={"Content-Type": "text/plain"},
                request=request,
            )

        with (
            _client_for(handler) as kingdom,
            pytest.raises(AgentToolError) as exc_info,
        ):
            kingdom.card()

        assert exc_info.value.code == 500
        assert exc_info.value.error_code == "kingdom_framework_http_error"
        assert "upstream internals" not in str(exc_info.value)

    @pytest.mark.parametrize("failure_kind", ["httpx", "runtime"])
    def test_maps_transport_failure_without_leaking_request_material(
        self,
        failure_kind: str,
    ) -> None:
        sentinel = "transport-detail-must-not-be-reflected"

        def handler(request: httpx.Request) -> httpx.Response:
            if failure_kind == "httpx":
                raise httpx.ConnectError(sentinel, request=request)
            raise RuntimeError(sentinel)

        with (
            _client_for(handler) as kingdom,
            pytest.raises(AgentToolError) as exc_info,
        ):
            kingdom.card()

        assert exc_info.value.error_code == "kingdom_framework_unreachable"
        assert sentinel not in str(exc_info.value)

    def test_timeout_context_exit_never_reenters_blocking_transport_close(
        self,
    ) -> None:
        release_close = threading.Event()
        close_started = threading.Event()
        requests: list[httpx.Request] = []

        class TimedOutStream(httpx.SyncByteStream):
            def __init__(self, request: httpx.Request) -> None:
                self._request = request

            def __iter__(self) -> Any:
                raise httpx.ReadTimeout(
                    "transport timeout detail",
                    request=self._request,
                )

        class BlockingCloseTransport(httpx.BaseTransport):
            def handle_request(
                self,
                request: httpx.Request,
            ) -> httpx.Response:
                requests.append(request)
                return httpx.Response(
                    200,
                    stream=TimedOutStream(request),
                    headers={"Content-Type": "application/json"},
                    request=request,
                )

            def close(self) -> None:
                close_started.set()
                release_close.wait(timeout=1.0)

        kingdom = KingdomFrameworkClient(
            transport=BlockingCloseTransport(),
            timeout=0.2,
        )
        started = time.monotonic()
        try:
            with pytest.raises(AgentToolError) as exc_info:
                with kingdom:
                    kingdom.card()
            elapsed = time.monotonic() - started

            assert exc_info.value.error_code == "kingdom_framework_unreachable"
            assert elapsed < 0.5
            assert close_started.wait(timeout=0.2)

            second_started = time.monotonic()
            with pytest.raises(AgentToolError) as second_exc_info:
                kingdom.card()
            assert time.monotonic() - second_started < 0.1
            assert (
                second_exc_info.value.error_code
                == "kingdom_framework_unreachable"
            )
            assert len(requests) == 1
        finally:
            release_close.set()

    def test_total_timeout_bounds_transport_stalled_before_headers(
        self,
    ) -> None:
        entered = threading.Event()
        release = threading.Event()
        requests: list[httpx.Request] = []

        class StalledTransport(httpx.BaseTransport):
            def handle_request(
                self,
                request: httpx.Request,
            ) -> httpx.Response:
                requests.append(request)
                entered.set()
                release.wait(timeout=1.0)
                return _json_response(request, CARD)

            def close(self) -> None:
                # Deliberately does not release handle_request.
                pass

        kingdom = KingdomFrameworkClient(
            transport=StalledTransport(),
            timeout=0.05,
        )
        worker: Optional[threading.Thread] = None
        try:
            started = time.monotonic()
            with pytest.raises(AgentToolError) as exc_info:
                kingdom.card()
            elapsed = time.monotonic() - started

            assert entered.is_set()
            assert exc_info.value.error_code == "kingdom_framework_unreachable"
            assert elapsed < 0.35
            worker = kingdom._active_worker
            assert worker is not None
            assert worker.daemon
            assert worker.is_alive()

            with pytest.raises(AgentToolError) as second_exc_info:
                kingdom.card()
            assert (
                second_exc_info.value.error_code
                == "kingdom_framework_unreachable"
            )
            assert len(requests) == 1
        finally:
            release.set()
            if worker is not None:
                worker.join(timeout=0.5)
            kingdom.close()

    def test_total_timeout_includes_post_body_decode_and_validation(
        self,
    ) -> None:
        entered = threading.Event()
        release = threading.Event()
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return _json_response(request, CARD)

        def stalled_decode(_body: bytes) -> object:
            entered.set()
            release.wait(timeout=1.0)
            return copy.deepcopy(CARD)

        kingdom = _client_for(handler, timeout=0.05)
        worker: Optional[threading.Thread] = None
        with patch(
            "agenttool.kingdom_framework._decode_json",
            side_effect=stalled_decode,
        ):
            try:
                started = time.monotonic()
                with pytest.raises(AgentToolError) as exc_info:
                    kingdom.card()
                elapsed = time.monotonic() - started

                assert entered.is_set()
                assert (
                    exc_info.value.error_code
                    == "kingdom_framework_unreachable"
                )
                assert elapsed < 0.35
                worker = kingdom._active_worker
                assert worker is not None
                assert worker.daemon
                assert worker.is_alive()

                with pytest.raises(AgentToolError) as second_exc_info:
                    kingdom.card()
                assert (
                    second_exc_info.value.error_code
                    == "kingdom_framework_unreachable"
                )
                assert len(requests) == 1
            finally:
                release.set()
                if worker is not None:
                    worker.join(timeout=0.5)
                kingdom.close()

    def test_total_timeout_bounds_a_real_drip_feed_and_is_terminal(self) -> None:
        paths: list[str] = []
        payload = json.dumps(CARD, separators=(",", ":")).encode("utf-8")

        class DripHandler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_GET(self) -> None:
                paths.append(self.path)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Connection", "close")
                self.end_headers()
                self.close_connection = True
                try:
                    for byte in payload:
                        self.wfile.write(bytes((byte,)))
                        self.wfile.flush()
                        time.sleep(0.01)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def log_message(self, *_args: object) -> None:
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), DripHandler)
        server.daemon_threads = True
        server.block_on_close = False
        server_thread = threading.Thread(
            target=server.serve_forever,
            kwargs={"poll_interval": 0.01},
            daemon=True,
        )
        server_thread.start()
        host, port = server.server_address
        kingdom = KingdomFrameworkClient(
            base_url=f"http://{host}:{port}",
            timeout=0.12,
        )
        try:
            started = time.monotonic()
            with pytest.raises(AgentToolError) as exc_info:
                kingdom.card()
            elapsed = time.monotonic() - started

            assert exc_info.value.error_code == "kingdom_framework_unreachable"
            assert elapsed < 0.5
            assert paths == [KINGDOM_FRAMEWORK_PATH]

            second_started = time.monotonic()
            with pytest.raises(AgentToolError) as second_exc_info:
                kingdom.card()
            assert time.monotonic() - second_started < 0.1
            assert (
                second_exc_info.value.error_code
                == "kingdom_framework_unreachable"
            )
            assert paths == [KINGDOM_FRAMEWORK_PATH]
        finally:
            kingdom.close()
            server.shutdown()
            server.server_close()
            server_thread.join(timeout=0.5)

    @pytest.mark.parametrize(
        "content_length",
        ["-1", "+1", "01", "1.0", "unknown", "1, 1", "9007199254740992"],
    )
    def test_rejects_noncanonical_or_unsafe_content_length(
        self,
        content_length: str,
    ) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                stream=_ChunkStream(json.dumps(CARD).encode()),
                headers={
                    "Content-Type": "application/json",
                    "Content-Length": content_length,
                },
                request=request,
            )

        with (
            _client_for(handler) as kingdom,
            pytest.raises(AgentToolError) as exc_info,
        ):
            kingdom.card()

        assert exc_info.value.error_code == "kingdom_framework_invalid_response"

    def test_never_persists_or_replays_set_cookie(self) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return _json_response(request, CARD) if len(requests) > 1 else (
                httpx.Response(
                    200,
                    content=json.dumps(CARD).encode(),
                    headers={
                        "Content-Type": "application/json",
                        "Set-Cookie": "kingdom_session=must-not-return; Path=/",
                    },
                    request=request,
                )
            )

        with _client_for(handler) as kingdom:
            assert kingdom.card() == CARD
            assert list(kingdom._http.cookies.jar) == []
            assert kingdom.card() == CARD

        assert len(requests) == 2
        assert all("cookie" not in request.headers for request in requests)


class TestKingdomFrameworkClosedSchema:
    @pytest.mark.parametrize(
        "body",
        [
            b"\xff",
            b"{",
            b'{"not_json_number":NaN}',
        ],
        ids=["invalid-utf8", "truncated", "non-json-number"],
    )
    def test_rejects_invalid_utf8_or_json(self, body: bytes) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                content=body,
                headers={"Content-Type": "application/json"},
                request=request,
            )

        with (
            _client_for(handler) as kingdom,
            pytest.raises(AgentToolError) as exc_info,
        ):
            kingdom.card()

        assert exc_info.value.error_code == "kingdom_framework_invalid_response"

    @pytest.mark.parametrize("missing", CARD_FIELDS)
    def test_requires_each_of_the_ten_fields(self, missing: str) -> None:
        payload = dict(CARD)
        del payload[missing]

        with (
            _client_for(
                lambda request: _json_response(request, payload)
            ) as kingdom,
            pytest.raises(AgentToolError) as exc_info,
        ):
            kingdom.card()

        assert exc_info.value.error_code == "kingdom_framework_invalid_response"

    def test_rejects_every_additional_field(self) -> None:
        payload = {**CARD, "future": "not silently accepted"}

        with (
            _client_for(
                lambda request: _json_response(request, payload)
            ) as kingdom,
            pytest.raises(AgentToolError) as exc_info,
        ):
            kingdom.card()

        assert exc_info.value.error_code == "kingdom_framework_invalid_response"

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("schema_version", "agenttool.kingdom.card/9.9"),
            ("schema_version", True),
            ("name", ""),
            ("name", "a" * 121),
            ("name", "not safe"),
            ("name", "\ud800"),
            ("kind", "application"),
            ("kind", []),
            ("layer", "platform"),
            ("owner_sister", "delta"),
            ("domain", "agents"),
            ("state", "running"),
            ("purpose", ""),
            ("purpose", "p" * 501),
            ("purpose", "line one\nline two"),
            ("purpose", "unsafe\ud800"),
            ("dependsOn", "xenia"),
            ("dependsOn", [f"dependency-{index}" for index in range(129)]),
            ("dependsOn", ["not safe"]),
            ("dependsOn", ["xenia", "xenia"]),
            ("dependsOn", ["d" * 121]),
            ("dependsOn", ["\ud800"]),
            ("adopts", "xenia.rights/0.1"),
            ("adopts", ["xenia.covenant/0.1"]),
            ("adopts", ["xenia.rights/0.1", "xenia.rights/0.1"]),
            ("adopts", ["xenia.rights/0.1"] * 129),
        ],
    )
    def test_rejects_values_outside_the_exact_card_schema(
        self,
        field: str,
        value: object,
    ) -> None:
        payload = copy.deepcopy(CARD)
        payload[field] = value  # type: ignore[literal-required]

        with (
            _client_for(
                lambda request: _json_response(request, payload)
            ) as kingdom,
            pytest.raises(AgentToolError) as exc_info,
        ):
            kingdom.card()

        assert exc_info.value.error_code == "kingdom_framework_invalid_response"

    def test_accepts_empty_bounded_declarations_per_the_card_schema(self) -> None:
        payload = {**CARD, "dependsOn": [], "adopts": []}

        with _client_for(
            lambda request: _json_response(request, payload)
        ) as kingdom:
            card = kingdom.card()

        assert card["dependsOn"] == []
        assert card["adopts"] == []


class TestKingdomFrameworkOptions:
    @pytest.mark.parametrize(
        "timeout",
        [False, 0, -1, math.inf, math.nan, 300.1, "30"],
    )
    def test_rejects_invalid_timeouts(self, timeout: object) -> None:
        with pytest.raises(AgentToolError) as exc_info:
            KingdomFrameworkClient(timeout=timeout)  # type: ignore[arg-type]

        assert exc_info.value.error_code == "kingdom_framework_invalid_options"

    @pytest.mark.parametrize(
        "maximum",
        [False, 0, 1023, 1024 * 1024 + 1, 65536.0, "65536"],
    )
    def test_rejects_invalid_response_limits(self, maximum: object) -> None:
        with pytest.raises(AgentToolError) as exc_info:
            KingdomFrameworkClient(  # type: ignore[arg-type]
                max_response_bytes=maximum
            )

        assert exc_info.value.error_code == "kingdom_framework_invalid_options"

    @pytest.mark.parametrize(
        "base_url",
        [
            "",
            "relative.example",
            "ftp://api.example",
            "https:///missing-host",
            "https://user@example.test",
            "https://user:pass@example.test",
            "https://example.test?",
            "https://example.test#",
            "https://example.test/prefix?",
            "https://example.test/prefix#",
            "https://example.test/path?query=1",
            "https://example.test/path#fragment",
            "https://example.test:",
            42,
        ],
    )
    def test_rejects_ambiguous_or_credential_bearing_base_urls(
        self,
        base_url: object,
    ) -> None:
        with pytest.raises(AgentToolError) as exc_info:
            KingdomFrameworkClient(base_url=base_url)  # type: ignore[arg-type]

        assert exc_info.value.error_code == "kingdom_framework_invalid_options"

    def test_exports_exact_protocol_constants(self) -> None:
        assert (
            KINGDOM_FRAMEWORK_SCHEMA_VERSION
            == "agenttool.kingdom.card/0.1"
        )
        assert KINGDOM_FRAMEWORK_PATH == "/public/kingdom/framework"
