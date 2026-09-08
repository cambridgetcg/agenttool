"""Attention Lab 嘅無認證、有界 HTTP 同錯誤契約測試。"""

from __future__ import annotations

import copy
import json
import math
import os
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

from agenttool import (
    ATTENTION_LAB_ORIGIN,
    ATTENTION_LAB_PATH,
    AttentionLabClient,
    AgentTool,
    AgentToolError,
)


GOLDEN = json.loads((Path(__file__).parent / "fixtures" / "attention-lab-v1.json").read_text(encoding="utf-8"))


def wire(data):
    return json.dumps({"success": True, "data": data}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def call(client, operation):
    if operation == "catalogue":
        return client.catalogue()
    if operation == "briefs":
        return client.build_brief(copy.deepcopy(GOLDEN["briefInput"]))
    return client.compare(copy.deepcopy(GOLDEN["comparisonInput"]))


class Chunks(httpx.SyncByteStream):
    def __init__(self, *chunks):
        self.chunks = chunks

    def __iter__(self):
        yield from self.chunks


class MustNotRead(httpx.SyncByteStream):
    def __iter__(self):
        raise AssertionError("唔應該讀錯誤正文")


def client_for(handler, **options):
    return AttentionLabClient(transport=httpx.MockTransport(handler), **options)


def assert_error(client, code, operation=None):
    with pytest.raises(AgentToolError) as caught:
        (operation or client.catalogue)()
    assert caught.value.code == "attention_lab_" + code
    return caught.value


def test_namespace_is_lazy_and_never_inherits_hosted_authority():
    sentinel = "at_synthetic_private_bearer"
    with patch("httpx.BaseTransport.handle_request", side_effect=AssertionError("唔可以連線")):
        with AgentTool(api_key=sentinel, base_url="https://hosted.invalid", timeout=999) as at:
            at._http.cookies.set("hosted", sentinel)
            assert at._attention_lab is None
            lab = at.attention_lab
            assert lab is at.attention_lab
            assert lab._http is not at._http
            assert lab._base_url == ATTENTION_LAB_ORIGIN
            assert lab._timeout == 10
            assert lab._max_request_bytes == 65536
            assert lab._max_response_bytes == 524288
            assert "authorization" not in lab._http.headers
            assert not list(lab._http.cookies.jar)
        assert lab._http.is_closed


def test_namespace_does_not_inherit_authenticated_transport():
    hosted = httpx.MockTransport(lambda request: pytest.fail("唔應用 hosted transport"))
    with AgentTool(
        transport=hosted,
        attention_lab_base_url="http://127.0.0.1:8000",
        attention_lab_allow_loopback_http=True,
        attention_lab_timeout=1.5,
        attention_lab_max_request_bytes=1234,
        attention_lab_max_response_bytes=12345,
    ) as at:
        lab = at.attention_lab
        assert lab._http._transport is not hosted
        assert lab._base_url == "http://127.0.0.1:8000"
        assert lab._timeout == 1.5
        assert lab._max_request_bytes == 1234
        assert lab._max_response_bytes == 12345


def test_standalone_construction_has_no_ambient_auth_or_network():
    with patch("agenttool.attention_lab.httpx.Client") as constructor:
        with AttentionLabClient():
            pass
    opts = constructor.call_args.kwargs
    assert opts["auth"] is None
    assert opts["cookies"] == {}
    assert opts["trust_env"] is False
    assert opts["follow_redirects"] is False
    assert opts["headers"] == {"Accept": "application/json", "Accept-Encoding": "identity"}
    constructor.return_value.stream.assert_not_called()


@pytest.mark.parametrize("options", [
    {"timeout": value} for value in (True, 0, -1, 10.1, 10**1000, math.inf, math.nan, "10")
] + [
    {key: value} for key, limit in (("max_request_bytes", 65536), ("max_response_bytes", 524288))
    for value in (True, 0, -1, limit + 1, 1.0, "100")
] + [{"allow_loopback_http": 1}])
def test_invalid_options_refused_before_client_construction(options):
    with patch("agenttool.attention_lab.httpx.Client") as constructor:
        with pytest.raises(AgentToolError) as caught:
            AttentionLabClient(**options)
        assert caught.value.code == "attention_lab_invalid_options"
        constructor.assert_not_called()


@pytest.mark.parametrize("base_url", [
    "", "relative", "ftp://example.test", "https:///missing", "https://user:secret@example.test",
    "https://user@example.test", "https://example.test?", "https://example.test#",
    "https://example.test/path", "https://example.test:0", "https://example.test:",
    "https://example.test:99999", "https://example.test/a/..", "https://example.test/%2e",
    "https://example.test\\evil", " https://example.test", "https://exa\nmple.test",
    "https://example.test/\ud800", "http://remote.test", "http://2130706433",
    "http://127.1", "http://127.0.0.2", "http://localhost.", "http://127.0.0.1",
])
def test_invalid_origin(base_url):
    with pytest.raises(AgentToolError) as caught:
        AttentionLabClient(base_url=base_url)
    assert caught.value.code == "attention_lab_invalid_options"
    assert "secret" not in str(caught.value)


@pytest.mark.parametrize("base_url", ["https://example.test", "https://example.test:8443/"])
def test_explicit_https_origin_is_accepted_without_network(base_url):
    with AttentionLabClient(base_url=base_url) as client:
        assert client._base_url == base_url.rstrip("/")


@pytest.mark.parametrize("base_url", ["http://localhost:8000", "http://127.0.0.1:8000", "http://[::1]:8000"])
def test_loopback_http_requires_explicit_optin(base_url):
    with AttentionLabClient(base_url=base_url, allow_loopback_http=True) as client:
        assert client._base_url == base_url


@pytest.mark.parametrize("status", [300, 301, 302, 307, 308, 399, 400, 401, 402, 413, 422, 429, 500, 503])
def test_status_failure_never_reads_body_follows_redirect_or_retries(status):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(status, stream=MustNotRead(), headers={
            "Location": "https://sentinel.invalid", "Payment-Required": "sentinel",
            "Retry-After": "sentinel", "Content-Type": "application/json",
        })

    with client_for(handler) as client:
        error = assert_error(client, "redirect_refused" if status < 400 else "rate_limited" if status == 429 else "http_error")
    assert error.status == status
    assert error.details is None
    assert error.payment_required is None
    assert error.retry_after is None
    assert "sentinel" not in str(error)
    assert len(requests) == 1


@pytest.mark.parametrize("media", ["", "text/plain", "application/+json", "application/problem+json"])
def test_refuses_non_json_media_type(media):
    with client_for(lambda request: httpx.Response(200, stream=MustNotRead(), headers={"Content-Type": media})) as client:
        assert_error(client, "unsupported_media_type")


@pytest.mark.parametrize("body", [
    b"\xff", b"{", b'{} trailing', b'\xef\xbb\xbf{}', b'{"n":NaN}', b'{"n":Infinity}',
    b'{"n":1e999}', b'{"success":true,"success":false,"data":{}}',
    b'{"success":true,"\\u0073uccess":false,"data":{}}',
    b'{"success":true,"data":{"x":"\\ud800"}}',
    b'[]', b'null', b'{"success":1,"data":{}}', b'{"success":false,"error":"sentinel"}',
    b'{"success":true,"data":{},"extra":true}', b'{"success":true,"data":null}',
])
def test_malformed_utf8_json_and_envelope(body):
    with client_for(lambda request: httpx.Response(200, content=body, headers={"Content-Type": "application/json"})) as client:
        error = assert_error(client, "invalid_response")
    assert "sentinel" not in str(error)


@pytest.mark.parametrize("version", [2, True, "1", None])
def test_unsupported_schema_version(version):
    with client_for(lambda request: httpx.Response(200, json={"success": True, "data": {"schemaVersion": version}})) as client:
        assert_error(client, "unsupported_schema_version")


@pytest.mark.parametrize("declared", ["-1", "+1", "01", "1.0", "1, 1", "9007199254740992"])
def test_invalid_content_length(declared):
    with client_for(lambda request: httpx.Response(200, stream=MustNotRead(), headers={
        "Content-Type": "application/json", "Content-Length": declared,
    })) as client:
        assert_error(client, "invalid_response")


@pytest.mark.parametrize("declared", [None, "1"])
def test_actual_chunked_bytes_cap_cannot_be_bypassed_by_content_length(declared):
    headers = {"Content-Type": "application/json"}
    if declared:
        headers["Content-Length"] = declared
    with client_for(lambda request: httpx.Response(200, stream=Chunks(b" " * 600, b" " * 600), headers=headers), max_response_bytes=1000) as client:
        assert_error(client, "response_too_large")


def test_declared_oversize_and_compressed_responses_refused_before_read():
    for extra, code in (({"Content-Length": "524289"}, "response_too_large"), ({"Content-Encoding": "gzip"}, "invalid_response")):
        with client_for(lambda request: httpx.Response(200, stream=MustNotRead(), headers={"Content-Type": "application/json", **extra})) as client:
            assert_error(client, code)


def test_content_length_mismatch_is_not_a_success():
    with client_for(lambda request: httpx.Response(200, stream=Chunks(b"{}"), headers={
        "Content-Type": "application/json", "Content-Length": "20",
    })) as client:
        assert_error(client, "invalid_response")


@pytest.mark.parametrize("exception", [httpx.ConnectError("sentinel"), RuntimeError("sentinel"), AgentToolError("sentinel")])
def test_transport_errors_are_sanitized_including_traceback_chain(exception):
    def handler(request):
        raise exception
    with client_for(handler) as client:
        error = assert_error(client, "unreachable")
    assert "sentinel" not in str(error)
    assert "sentinel" not in "".join(traceback.format_exception(error))


@pytest.mark.parametrize("stage", ["headers", "body", "cleanup"])
def test_deadline_includes_stalled_headers_body_and_cleanup_and_is_terminal(stage):
    release = threading.Event()
    entered = threading.Event()
    requests = []

    class Stalled(Chunks):
        def __iter__(self):
            entered.set()
            if stage == "body":
                release.wait(2)
            if stage == "cleanup":
                raise httpx.ReadTimeout("sentinel")
            yield b"{}"

        def close(self):
            if stage == "cleanup":
                release.wait(2)

    def handler(request):
        requests.append(request)
        if stage == "headers":
            entered.set()
            release.wait(2)
        return httpx.Response(200, stream=Stalled(), headers={"Content-Type": "application/json"})

    client = client_for(handler, timeout=0.05)
    try:
        start = time.monotonic()
        with client:
            assert_error(client, "timeout")
        assert time.monotonic() - start < 0.4
        assert entered.is_set()
        assert_error(client, "unreachable")
        assert len(requests) == 1
    finally:
        release.set()
        if client._active_worker is not None:
            client._active_worker.join(1)
        client.close()


def test_real_http_drip_body_obeys_total_deadline_without_ambient_proxy():
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append((self.path, dict(self.headers)))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            try:
                for _ in range(100):
                    self.wfile.write(b" ")
                    self.wfile.flush()
                    time.sleep(0.01)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    server.block_on_close = False
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    try:
        with patch.dict(os.environ, {"HTTPS_PROXY": "https://user:sentinel@proxy.invalid", "HTTP_PROXY": "http://user:sentinel@proxy.invalid", "AT_API_KEY": "sentinel"}):
            with AttentionLabClient(base_url=f"http://127.0.0.1:{server.server_port}", allow_loopback_http=True, timeout=0.1) as client:
                start = time.monotonic()
                assert_error(client, "timeout")
                assert time.monotonic() - start < 0.5
        assert len(requests) == 1
        assert requests[0][0] == ATTENTION_LAB_PATH + "/catalogue"
        assert "sentinel" not in repr(requests)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(1)


@pytest.mark.parametrize("operation,payload", [
    ("catalogue", GOLDEN["catalogue"]), ("briefs", GOLDEN["brief"]),
    ("briefs", GOLDEN["blockedBriefs"]["socialProof"]), ("briefs", GOLDEN["blockedBriefs"]["scarcity"]),
    ("comparisons", GOLDEN["comparison"]), ("comparisons", GOLDEN["incompleteComparison"]),
    ("comparisons", GOLDEN["zeroDenominatorComparison"]), ("comparisons", GOLDEN["zeroBaselineComparison"]),
])
def test_producer_goldens_round_trip_through_public_package_entrypoint(operation, payload):
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, content=wire(payload), headers={"Content-Type": "application/json; charset=utf-8"})
    with client_for(handler) as client:
        assert call(client, operation) == payload
    assert len(requests) == 1
    assert requests[0].url == ATTENTION_LAB_ORIGIN + ATTENTION_LAB_PATH + "/" + operation
    assert requests[0].method == ("GET" if operation == "catalogue" else "POST")
    if operation != "catalogue":
        expected = GOLDEN["briefInput" if operation == "briefs" else "comparisonInput"]
        assert json.loads(requests[0].content) == expected
    assert GOLDEN["comparison"]["comparison"]["percentagePointDifference"] == pytest.approx(5)
    assert GOLDEN["blockedBriefs"]["socialProof"]["brief"]["experiment"]["blocked"] is True
    assert GOLDEN["blockedBriefs"]["scarcity"]["brief"]["experiment"]["blocked"] is True


def test_synthetic_credentials_cannot_cross_or_be_replayed_from_set_cookie():
    requests = []
    sentinel = "at_synthetic_bearer_must_not_cross"
    def handler(request):
        requests.append(request)
        return httpx.Response(200, content=wire(GOLDEN["catalogue"]), headers={
            "Content-Type": "application/json", "Set-Cookie": "session=" + sentinel + "; Path=/",
        })
    with patch.dict(os.environ, {"AT_API_KEY": sentinel, "NETRC": "/sentinel-must-not-open", "HTTPS_PROXY": "https://user:" + sentinel + "@proxy.invalid"}):
        with patch("netrc.netrc", side_effect=AssertionError("唔可以讀 netrc")):
            with client_for(handler) as client:
                client._http.cookies.set("synthetic", sentinel)
                assert client.catalogue() == GOLDEN["catalogue"]
                assert not list(client._http.cookies.jar)
                assert client.catalogue() == GOLDEN["catalogue"]
    for request in requests:
        assert "authorization" not in request.headers
        assert "proxy-authorization" not in request.headers
        assert "cookie" not in request.headers
        assert sentinel not in repr(dict(request.headers)) + str(request.url) + request.content.decode()


def test_request_byte_limit_counts_utf8_not_codepoints_and_sends_only_validated_fields():
    value = copy.deepcopy(GOLDEN["briefInput"])
    value["topic"] = "攝影" * 50
    body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    seen = []
    def handler(request):
        seen.append(request)
        return httpx.Response(200, content=wire(GOLDEN["brief"]), headers={"Content-Type": "application/json"})
    with client_for(handler, max_request_bytes=len(body)) as client:
        client.build_brief(value)
    assert seen[0].content == body
    with client_for(handler, max_request_bytes=len(body) - 1) as client:
        assert_error(client, "request_too_large", lambda: client.build_brief(value))
    assert len(seen) == 1
    value["apiKey"] = "sentinel"
    with client_for(handler) as client:
        assert_error(client, "invalid_request", lambda: client.build_brief(value))
    assert len(seen) == 1


@pytest.mark.parametrize("delta", [0, 1])
def test_response_absolute_cap_accepts_exact_budget_and_refuses_next_byte(delta):
    encoded = wire(GOLDEN["catalogue"])
    body = encoded + b" " * (524288 + delta - len(encoded))
    with client_for(lambda request: httpx.Response(200, stream=Chunks(body[:123], body[123:]), headers={"Content-Type": "application/json"})) as client:
        if delta:
            assert_error(client, "response_too_large")
        else:
            assert client.catalogue() == GOLDEN["catalogue"]


def object_paths(value, path=()):
    if type(value) is dict:
        yield path
        for key, child in value.items():
            yield from object_paths(child, path + (key,))
    elif type(value) is list:
        for index, child in enumerate(value):
            yield from object_paths(child, path + (index,))


def at_path(value, path):
    for key in path:
        value = value[key]
    return value


@pytest.mark.parametrize("operation,key", [("catalogue", "catalogue"), ("briefs", "brief"), ("comparisons", "comparison")])
def test_every_nested_record_is_closed_and_every_field_required(operation, key):
    original = GOLDEN[key]
    for path in object_paths(original):
        changed = copy.deepcopy(original)
        record = at_path(changed, path)
        record["unexpected"] = "sentinel"
        with client_for(lambda request: httpx.Response(200, content=wire(changed), headers={"Content-Type": "application/json"})) as client:
            assert_error(client, "invalid_response", lambda: call(client, operation))
        for field in at_path(original, path):
            changed = copy.deepcopy(original)
            del at_path(changed, path)[field]
            with client_for(lambda request: httpx.Response(200, content=wire(changed), headers={"Content-Type": "application/json"})) as client:
                assert_error(client, "invalid_response", lambda: call(client, operation))


@pytest.mark.parametrize("path,value", [
    (("schemaVersion",), 2), (("engineVersion",), ""), (("catalogueDigest",), "sha256:" + "A" * 64),
    (("sources", 0, "publishedAt"), "2026-02-30"), (("sources", 0, "reviewedAt"), "2026-02-29"),
    (("sources", 0, "url"), "https://user:sentinel@example.test"),
    (("sources", 0, "url"), "http://%"), (("sources", 0, "url"), "http://exa mple.test"),
    (("sources", 0, "context"), "𠮷" * 2001), (("sources", 0, "title"), "bad\ud800"),
    (("mechanisms", 0, "claims", 0, "kind"), "proven"),
    (("mechanisms", 0, "claims", 0, "sourceIds"), ["unknown-source"]),
    (("mechanisms", 0, "compatiblePlatformIds"), ["unknown-platform"]),
    (("mechanisms", 0, "sourceIds"), ["unknown-source"]),
    (("platforms", 0, "signals", 0, "sourceIds"), ["unknown-source"]),
    (("platforms", 0, "channel"), "surveillance"), (("platforms", 0, "metric", "denominator"), 0),
])
def test_catalogue_rejects_wrong_values_and_open_references(path, value):
    changed = copy.deepcopy(GOLDEN["catalogue"])
    at_path(changed, path[:-1])[path[-1]] = value
    encoded = json.dumps({"success": True, "data": changed}, ensure_ascii=True).encode()
    with client_for(lambda request: httpx.Response(200, content=encoded, headers={"Content-Type": "application/json"})) as client:
        assert_error(client, "unsupported_schema_version" if path == ("schemaVersion",) else "invalid_response")


def test_catalogue_rejects_duplicate_ids_and_claim_source_outside_own_entry():
    mutations = [
        lambda data: data["sources"].append(copy.deepcopy(data["sources"][0])),
        lambda data: data["mechanisms"].append(copy.deepcopy(data["mechanisms"][0])),
        lambda data: data["platforms"].append(copy.deepcopy(data["platforms"][0])),
        lambda data: data["mechanisms"][0]["claims"].append(copy.deepcopy(data["mechanisms"][0]["claims"][0])),
        lambda data: data["mechanisms"][0]["compatiblePlatformIds"].append(data["mechanisms"][0]["compatiblePlatformIds"][0]),
    ]
    for mutate in mutations:
        value = copy.deepcopy(GOLDEN["catalogue"])
        mutate(value)
        with client_for(lambda request: httpx.Response(200, content=wire(value), headers={"Content-Type": "application/json"})) as client:
            assert_error(client, "invalid_response")
    value = copy.deepcopy(GOLDEN["catalogue"])
    other = next(source["id"] for source in value["sources"] if source["id"] not in value["mechanisms"][0]["sourceIds"])
    value["mechanisms"][0]["claims"][0]["sourceIds"] = [other]
    with client_for(lambda request: httpx.Response(200, content=wire(value), headers={"Content-Type": "application/json"})) as client:
        assert_error(client, "invalid_response")


def test_historical_snapshot_identifiers_and_citations_do_not_depend_on_current_registry():
    value = copy.deepcopy(GOLDEN["brief"])
    value["mechanism"]["id"] = value["brief"]["input"]["mechanismId"] = "historical-mechanism-v0"
    value["platform"]["id"] = value["brief"]["input"]["platformId"] = "retired-platform-v0"
    mapping = {source["id"]: "old:" + source["id"] for source in value["sources"]}
    for source in value["sources"]:
        source["id"] = mapping[source["id"]]
    value["brief"]["sourceIds"] = [mapping[source] for source in value["brief"]["sourceIds"]]
    for claim in value["claims"]:
        claim["sourceIds"] = [mapping[source] for source in claim["sourceIds"]]
    with client_for(lambda request: httpx.Response(200, content=wire(value), headers={"Content-Type": "application/json"})) as client:
        assert client.build_brief(GOLDEN["briefInput"]) == value
    assert value["markdown"] == GOLDEN["brief"]["markdown"]


@pytest.mark.parametrize("path,value", [
    (("mechanism", "id"), "unmatched"), (("platform", "id"), "unmatched"),
    (("mechanism", "claimIds"), ["missing"]), (("platform", "claimIds"), ["missing"]),
    (("brief", "sourceIds"), ["missing"]), (("brief", "input", "nonpoliticalConfirmed"), False),
    (("brief", "input", "topic"), " ﻿"), (("brief", "experiment", "blocked"), 0),
    (("brief", "experiment", "shared"), ["x"] * 21), (("claims", 0, "sourceIds"), ["missing"]),
    (("claims", 0, "limitations"), []), (("markdown",), "x" * 90001),
])
def test_brief_snapshot_validates_nested_limits_and_reference_closure(path, value):
    data = copy.deepcopy(GOLDEN["brief"])
    at_path(data, path[:-1])[path[-1]] = value
    with client_for(lambda request: httpx.Response(200, content=wire(data), headers={"Content-Type": "application/json"})) as client:
        assert_error(client, "invalid_response", lambda: client.build_brief(GOLDEN["briefInput"]))


@pytest.mark.parametrize("count", [None, 0, True, -1, " ", "-1", "+1", "1.0", "1e3", "１", "9007199254740992", "0" * 33])
def test_invalid_counts_fail_locally_without_network(count):
    value = copy.deepcopy(GOLDEN["comparisonInput"])
    value["counts"]["aOutcomes"] = count
    with client_for(lambda request: pytest.fail("invalid request 唔可以連線")) as client:
        assert_error(client, "invalid_request", lambda: client.compare(value))


@pytest.mark.parametrize("path,value", [
    (("counts", "aOutcomes"), "101"), (("plan", "design"), "causal"),
    (("plan", "startDate"), "2026-02-30"), (("plan", "endDate"), "2026-08-01"),
    (("metric", "denominator"), None), (("plan", "guardrailResults"), "x" * 4001),
])
def test_comparison_request_refinements(path, value):
    data = copy.deepcopy(GOLDEN["comparisonInput"])
    at_path(data, path[:-1])[path[-1]] = value
    with client_for(lambda request: pytest.fail("invalid request 唔可以連線")) as client:
        assert_error(client, "invalid_request", lambda: client.compare(data))


@pytest.mark.parametrize("key,field,replacement", [
    ("incompleteComparison", None, {"aRate": 0, "bRate": 0, "percentagePointDifference": 0, "relativeLift": 0}),
    ("comparison", None, None), ("comparison", "aRate", None),
    ("comparison", "bRate", True), ("comparison", "bRate", 1.01),
    ("comparison", "percentagePointDifference", 101), ("comparison", "relativeLift", -1.01),
    ("zeroDenominatorComparison", "aRate", 0), ("zeroDenominatorComparison", "percentagePointDifference", 0),
    ("zeroBaselineComparison", "relativeLift", 0),
])
def test_comparison_null_unknown_semantics_and_ranges(key, field, replacement):
    value = copy.deepcopy(GOLDEN[key])
    if field is None:
        value["comparison"] = replacement
    else:
        value["comparison"][field] = replacement
    with client_for(lambda request: httpx.Response(200, content=wire(value), headers={"Content-Type": "application/json"})) as client:
        assert_error(client, "invalid_response", lambda: client.compare(GOLDEN["comparisonInput"]))


def test_year_zero_leap_date_leading_zero_counts_and_future_request_ids_keep_wire_values():
    value = copy.deepcopy(GOLDEN["comparisonInput"])
    value["counts"]["aOutcomes"] = "00010"
    value["plan"]["startDate"] = "0000-02-29"
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, content=wire(GOLDEN["comparison"]), headers={"Content-Type": "application/json"})
    with client_for(handler) as client:
        client.compare(value)
    assert json.loads(requests[0].content) == value
    brief = copy.deepcopy(GOLDEN["briefInput"])
    brief["mechanismId"] = "future-mechanism"
    brief["platformId"] = "future-surface"
    with client_for(lambda request: httpx.Response(422, stream=MustNotRead())) as client:
        error = assert_error(client, "http_error", lambda: client.build_brief(brief))
    assert error.status == 422


@pytest.mark.parametrize("literal", [b"1.0", b"1e0"])
def test_schema_version_uses_json_numeric_literal_semantics(literal):
    body = wire(GOLDEN["catalogue"]).replace(b'"schemaVersion":1,', b'"schemaVersion":' + literal + b",", 1)
    with client_for(lambda request: httpx.Response(200, content=body, headers={"Content-Type": "application/json"})) as client:
        assert client.catalogue() == GOLDEN["catalogue"]


def test_timeout_during_input_validation_cannot_start_a_late_request():
    release = threading.Event()
    entered = threading.Event()
    from agenttool._attention_lab_contract import validate_input

    def slow_validate(operation, value):
        entered.set()
        release.wait(1)
        validate_input(operation, value)

    with patch("agenttool._attention_lab_contract.validate_input", side_effect=slow_validate):
        client = client_for(lambda request: pytest.fail("timeout 後唔可以開始新請求"), timeout=0.05)
        try:
            assert_error(client, "timeout", lambda: client.build_brief(GOLDEN["briefInput"]))
            assert entered.is_set()
            worker = client._active_worker
            release.set()
            if worker is not None:
                worker.join(1)
                assert not worker.is_alive()
        finally:
            release.set()
            client.close()


def test_public_models_have_resolvable_required_camelcase_types():
    import agenttool
    from typing import get_type_hints
    import agenttool.attention_lab as module

    models = [value for name, value in vars(module).items() if name.startswith("AttentionLab") and hasattr(value, "__required_keys__")]
    assert len(models) >= 20
    for model in models:
        assert model.__name__ in agenttool.__all__
        assert set(get_type_hints(model)) == set(model.__required_keys__)
    assert set(get_type_hints(agenttool.AttentionLabCatalogue)) == set(GOLDEN["catalogue"])
    assert set(get_type_hints(agenttool.AttentionLabBriefArtifact)) == set(GOLDEN["brief"])
    assert set(get_type_hints(agenttool.AttentionLabComparisonArtifact)) == set(GOLDEN["comparison"])


@pytest.mark.parametrize("surrogate", [chr(0xD800), chr(0xDC00)])
def test_illformed_metric_unicode_is_sanitized_before_network(surrogate):
    value = copy.deepcopy(GOLDEN["comparisonInput"])
    value["metric"]["name"] = "private-sentinel" + surrogate
    requests = []
    with client_for(lambda request: requests.append(request)) as client:
        error = assert_error(client, "invalid_request", lambda: client.compare(value))
    assert requests == []
    assert error.__cause__ is None
    assert error.__context__ is None
    assert "private-sentinel" not in "".join(traceback.format_exception(error))
    assert "UnicodeEncodeError" not in "".join(traceback.format_exception(error))


@pytest.mark.parametrize("surrogate", [chr(0xD800), chr(0xDC00)])
def test_illformed_upstream_metric_unicode_is_sanitized(surrogate):
    value = copy.deepcopy(GOLDEN["comparison"])
    value["metric"]["name"] = "private-sentinel" + surrogate
    body = json.dumps({"success": True, "data": value}, ensure_ascii=True).encode("utf-8")
    with client_for(lambda request: httpx.Response(200, content=body, headers={"Content-Type": "application/json"})) as client:
        error = assert_error(client, "invalid_response", lambda: client.compare(GOLDEN["comparisonInput"]))
    assert error.__cause__ is None
    assert error.__context__ is None
    assert "private-sentinel" not in "".join(traceback.format_exception(error))
    assert "UnicodeEncodeError" not in "".join(traceback.format_exception(error))


@pytest.mark.parametrize("escaped", [False, True])
def test_valid_astral_metric_unicode_round_trips_without_normalization(escaped):
    value = copy.deepcopy(GOLDEN["comparisonInput"])
    value["metric"]["name"] = "sample𠮷"
    response = copy.deepcopy(GOLDEN["comparison"])
    response["metric"] = copy.deepcopy(value["metric"])
    body = json.dumps({"success": True, "data": response}, ensure_ascii=escaped).encode("utf-8")
    def handler(request):
        assert json.loads(request.content)["metric"]["name"] == "sample𠮷"
        return httpx.Response(200, content=body, headers={"Content-Type": "application/json"})
    with client_for(handler) as client:
        assert client.compare(value) == response
