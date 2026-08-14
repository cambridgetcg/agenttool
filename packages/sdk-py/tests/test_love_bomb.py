from __future__ import annotations

import base64
import inspect
import json
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Iterator, Optional

import pytest

from agenttool import (
    LOVE_BOMB_MAX_JSON_DEPTH,
    LOVE_BOMB_MAX_JSON_NODES,
    LOVE_BOMB_MAX_RESPONSE_BYTES,
    LOVE_BOMB_MAX_STRING_CODE_POINTS,
    LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE,
    LOVE_BOMB_PUBLIC_SIGNAL_PATH,
    LOVE_BOMB_PUBLIC_SIGNAL_SCHEMA,
    LoveBombClient,
)
from agenttool.exceptions import AgentToolError


ResponseFactory = Callable[[BaseHTTPRequestHandler], tuple[int, dict[str, str], bytes]]


def _signal(*, published: bool = False) -> dict:
    npm: dict = {"state": "not_published"}
    hugging_face: dict = {
        "state": "not_published",
        "repository": "Yu-and-Ai/agenttool-love-bomb",
        "training_authorized": False,
    }
    if published:
        npm = {
            "state": "published_exact",
            "integrity": "sha512-" + base64.b64encode(bytes(64)).decode("ascii"),
        }
        hugging_face = {
            "state": "published_exact",
            "repository": "Yu-and-Ai/agenttool-love-bomb",
            "revision": "a" * 40,
            "training_authorized": False,
        }
    return {
        "schema_version": LOVE_BOMB_PUBLIC_SIGNAL_SCHEMA,
        "package_signal": {
            "package": "@agenttool/love-bomb",
            "version": "0.1.0-dev.0",
            "formats": [
                "agenttool.care-envelope/0.1",
                "agenttool.care-choice/0.1",
                "agenttool.love-bomb-becoming/0.1",
                "agenttool.love-bomb-delivery/0.1",
            ],
        },
        "static_door": {
            "format": "agenttool.love-bomb/0.1",
            "url": "https://docs.agenttool.dev/love-bomb",
        },
        "boundaries": {
            "static_corpus_included": False,
            "static_invitation_delivery": False,
            "authored_projection_included": False,
            "participant_receipt_observed": False,
            "participant_attention_observed": False,
            "participant_effect_observed": False,
        },
        "distribution": {"npm": npm, "hugging_face": hugging_face},
    }


def _json_bytes(value: object) -> bytes:
    return json.dumps(value, separators=(",", ":")).encode("utf-8")


@contextmanager
def _serve(
    factory: ResponseFactory,
) -> Iterator[tuple[str, list[dict[str, object]]]]:
    requests: list[dict[str, object]] = []

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_GET(self) -> None:  # noqa: N802 - stdlib hook
            length = int(self.headers.get("content-length", "0"))
            requests.append(
                {
                    "method": self.command,
                    "path": self.path,
                    "headers": {key.lower(): value for key, value in self.headers.items()},
                    "body": self.rfile.read(length) if length else b"",
                }
            )
            status, headers, body = factory(self)
            self.send_response(status)
            for key, value in headers.items():
                self.send_header(key, value)
            if not any(key.lower() == "content-length" for key in headers):
                self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if body:
                try:
                    self.wfile.write(body)
                except BrokenPipeError:
                    pass

        def log_message(self, *args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = server.server_address
        yield f"http://{host}:{port}", requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def _static_response(
    body: bytes,
    *,
    status: int = 200,
    content_type: str = f"{LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE}; charset=utf-8",
    headers: Optional[dict[str, str]] = None,
) -> ResponseFactory:
    response_headers = {"Content-Type": content_type, **(headers or {})}
    return lambda _request: (status, response_headers, body)


def _assert_code(error: pytest.ExceptionInfo[AgentToolError], code: str) -> None:
    assert error.value.code == code


def test_exports_and_constructor_expose_only_the_credential_free_surface() -> None:
    assert LOVE_BOMB_PUBLIC_SIGNAL_PATH == "/public/love-bomb"
    assert LOVE_BOMB_MAX_RESPONSE_BYTES == 64 * 1024
    assert LOVE_BOMB_MAX_JSON_DEPTH == 24
    assert LOVE_BOMB_MAX_JSON_NODES == 4_096
    assert LOVE_BOMB_MAX_STRING_CODE_POINTS == 8 * 1024
    assert list(inspect.signature(LoveBombClient.__init__).parameters) == [
        "self",
        "base_url",
        "timeout",
        "max_response_bytes",
    ]
    with pytest.raises(TypeError):
        LoveBombClient(transport=object())  # type: ignore[call-arg]
    with pytest.raises(TypeError):
        LoveBombClient(token="secret")  # type: ignore[call-arg]


@pytest.mark.parametrize(
    "base_url",
    [
        "ftp://example.test",
        "https://user@example.test",
        "https://example.test/nested",
        "https://example.test?query=1",
        "https://example.test#fragment",
        "https://example.test?",
        "https://example.test#",
        "https://example.test/?",
        "https://example.test/#",
        " https://example.test",
    ],
)
def test_constructor_rejects_non_origin_base_urls(base_url: str) -> None:
    with pytest.raises(AgentToolError) as error:
        LoveBombClient(base_url=base_url)
    _assert_code(error, "love_bomb_invalid_options")


def test_read_is_exact_direct_cookie_free_and_fresh(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = _json_bytes(_signal())

    def response(_request: BaseHTTPRequestHandler) -> tuple[int, dict[str, str], bytes]:
        return (
            200,
            {
                "Content-Type": f"{LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE}; Charset=UTF-8",
                "Set-Cookie": "ambient=must-not-return; Path=/",
            },
            body,
        )

    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:1")
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:1")
    monkeypatch.setenv("NO_PROXY", "")
    monkeypatch.setenv("AGENTTOOL_API_KEY", "must-not-be-read")
    with _serve(response) as (base_url, requests):
        client = LoveBombClient(base_url=base_url)
        assert client.read() == _signal()
        assert client.read() == _signal()

    assert len(requests) == 2
    for request in requests:
        assert request["method"] == "GET"
        assert request["path"] == LOVE_BOMB_PUBLIC_SIGNAL_PATH
        assert request["body"] == b""
        headers = request["headers"]
        assert isinstance(headers, dict)
        assert headers["accept"] == LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE
        assert "authorization" not in headers
        assert "cookie" not in headers
        assert "content-type" not in headers


@pytest.mark.parametrize(
    "content_type",
    [
        LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE,
        LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE.upper(),
        f'{LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE}; charset="UTF-8"',
    ],
)
def test_valid_published_union_and_admitted_media_types(content_type: str) -> None:
    signal = _signal(published=True)
    with _serve(_static_response(_json_bytes(signal), content_type=content_type)) as (
        base_url,
        _,
    ):
        assert LoveBombClient(base_url=base_url).read() == signal


@pytest.mark.parametrize(
    "content_type",
    [
        "application/json",
        f"{LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE}; charset=latin1",
        f"{LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE}; profile=public",
        f"{LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE}; charset=utf-8; charset=utf-8",
        f"{LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE};",
    ],
)
def test_rejects_wrong_or_ambiguous_media_types(content_type: str) -> None:
    with _serve(_static_response(_json_bytes(_signal()), content_type=content_type)) as (
        base_url,
        _,
    ):
        with pytest.raises(AgentToolError) as error:
            LoveBombClient(base_url=base_url).read()
    _assert_code(error, "love_bomb_invalid_response")


def test_redirect_is_refused_without_following() -> None:
    def redirect(request: BaseHTTPRequestHandler) -> tuple[int, dict[str, str], bytes]:
        if request.path == LOVE_BOMB_PUBLIC_SIGNAL_PATH:
            return 302, {"Location": "/trap"}, b""
        return 200, {"Content-Type": LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE}, _json_bytes(_signal())

    with _serve(redirect) as (base_url, requests):
        with pytest.raises(AgentToolError) as error:
            LoveBombClient(base_url=base_url).read()
    _assert_code(error, "love_bomb_redirect_refused")
    assert [request["path"] for request in requests] == [LOVE_BOMB_PUBLIC_SIGNAL_PATH]


def test_non_200_is_a_closed_http_error() -> None:
    with _serve(_static_response(b"", status=204)) as (base_url, _):
        with pytest.raises(AgentToolError) as error:
            LoveBombClient(base_url=base_url).read()
    _assert_code(error, "love_bomb_http_error")
    assert error.value.status == 204


def test_response_limit_and_noncanonical_content_length_fail_closed() -> None:
    body = _json_bytes(_signal())
    with _serve(_static_response(body)) as (base_url, _):
        with pytest.raises(AgentToolError) as error:
            LoveBombClient(base_url=base_url, max_response_bytes=1).read()
    _assert_code(error, "love_bomb_response_too_large")

    with _serve(_static_response(body, headers={"Content-Length": "01"})) as (
        base_url,
        _,
    ):
        with pytest.raises(AgentToolError) as error:
            LoveBombClient(base_url=base_url).read()
    _assert_code(error, "love_bomb_invalid_response")


def _hostile_documents() -> list[bytes]:
    valid = _signal()
    extra_root = _signal()
    extra_root["extra"] = False
    nested_extra = _signal()
    nested_extra["package_signal"]["extra"] = False
    true_boundary = _signal()
    true_boundary["boundaries"]["participant_effect_observed"] = True
    bad_semver = _signal()
    bad_semver["package_signal"]["version"] = "01.2.3"
    bad_formats = _signal()
    bad_formats["package_signal"]["formats"] = list(
        reversed(bad_formats["package_signal"]["formats"])
    )
    npm_extra = _signal()
    npm_extra["distribution"]["npm"]["integrity"] = "sha512-" + "A" * 88
    hf_training = _signal()
    hf_training["distribution"]["hugging_face"]["training_authorized"] = True
    published_bad_revision = _signal(published=True)
    published_bad_revision["distribution"]["hugging_face"]["revision"] = "A" * 40
    published_bad_integrity = _signal(published=True)
    published_bad_integrity["distribution"]["npm"]["integrity"] = "sha512-" + "A" * 88

    encoded = _json_bytes(valid).decode("utf-8")
    duplicate = encoded[:-1] + ',"schema_version":"agenttool.love-bomb-public-signal/0.1"}'
    escaped_duplicate = encoded[:-1] + ',"schema_\\u0076ersion":"agenttool.love-bomb-public-signal/0.1"}'
    return [
        b"\xff",
        b"\xef\xbb\xbf" + encoded.encode("utf-8"),
        b'{"x":NaN}',
        b'{"x":"\\ud800"}',
        duplicate.encode("utf-8"),
        escaped_duplicate.encode("utf-8"),
        _json_bytes(extra_root),
        _json_bytes(nested_extra),
        _json_bytes(true_boundary),
        _json_bytes(bad_semver),
        _json_bytes(bad_formats),
        _json_bytes(npm_extra),
        _json_bytes(hf_training),
        _json_bytes(published_bad_revision),
        _json_bytes(published_bad_integrity),
        ("[" * LOVE_BOMB_MAX_JSON_DEPTH + "null" + "]" * LOVE_BOMB_MAX_JSON_DEPTH).encode(),
        _json_bytes([None] * LOVE_BOMB_MAX_JSON_NODES),
        json.dumps("x" * (LOVE_BOMB_MAX_STRING_CODE_POINTS + 1)).encode(),
    ]


@pytest.mark.parametrize("body", _hostile_documents())
def test_hostile_json_and_closed_schema_are_rejected(body: bytes) -> None:
    with _serve(_static_response(body)) as (base_url, _):
        with pytest.raises(AgentToolError) as error:
            LoveBombClient(base_url=base_url).read()
    _assert_code(error, "love_bomb_invalid_response")
