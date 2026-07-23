"""agent-data/v1 SDK façade tests — all HTTP mocked, no network."""

from __future__ import annotations

import os
from inspect import signature
from unittest.mock import MagicMock, patch

import httpx
import pytest

from agenttool import (
    AGENT_DATA_SYNC_PROTOCOL,
    AgentTool,
    AgentToolError,
    DataClient,
    DataSyncClient,
)


def _response(payload: object = None, status_code: int = 200) -> MagicMock:
    response = MagicMock(spec=httpx.Response)
    response.status_code = status_code
    response.json.return_value = payload if payload is not None else {"ok": True}
    response.text = ""
    response.headers = httpx.Headers()
    return response


class TestDataSecurityBoundary:
    def test_standalone_data_client_needs_no_agenttool_api_key(self) -> None:
        with DataClient(
            "http://127.0.0.1:8787",
            token="standalone-node-token",
        ) as data:
            assert data._http.headers["authorization"] == (
                "Bearer standalone-node-token"
            )
            assert data._http.follow_redirects is False
        assert data._http.is_closed

    def test_uses_only_separate_data_node_bearer(self) -> None:
        at = AgentTool(
            api_key="agenttool-project-secret",
            data_node_url="http://127.0.0.1:8787/",
            data_node_token="data-node-secret",
        )
        data = at.data

        assert data._http is not at._http
        assert data._http.headers["authorization"] == "Bearer data-node-secret"
        assert "agenttool-project-secret" not in " ".join(data._http.headers.values())
        assert at._http.headers["authorization"] == "Bearer agenttool-project-secret"

        with patch.object(
            data._http,
            "request",
            return_value=_response({"protocol": "agent-data/v1"}),
        ) as request:
            result = data.manifest()

        assert result["protocol"] == "agent-data/v1"
        request.assert_called_once_with(
            "GET",
            "http://127.0.0.1:8787/v1/data/manifest",
        )
        at.close()

    def test_no_node_token_means_no_authorization_header(self) -> None:
        with patch.dict(
            os.environ,
            {"AT_API_KEY": "ignored"},
            clear=True,
        ):
            at = AgentTool(
                api_key="agenttool-project-secret",
                data_node_url="http://127.0.0.1:8787",
            )
            data = at.data
            assert "authorization" not in data._http.headers
            assert "agenttool-project-secret" not in " ".join(
                data._http.headers.values()
            )
            at.close()

    def test_reads_dedicated_environment_fallbacks(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AT_API_KEY": "agenttool-project-secret",
                "AGENT_DATA_NODE_URL": "http://localhost:9988/",
                "AGENT_DATA_NODE_TOKEN": "env-data-token",
            },
            clear=True,
        ):
            at = AgentTool()
            data = at.data
            assert data._base_url == "http://localhost:9988"
            assert data._http.headers["authorization"] == "Bearer env-data-token"
            at.close()

    def test_explicit_node_url_does_not_inherit_ambient_node_token(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AT_API_KEY": "agenttool-project-secret",
                "AGENT_DATA_NODE_URL": "http://trusted-node.test",
                "AGENT_DATA_NODE_TOKEN": "trusted-node-token",
            },
            clear=True,
        ):
            at = AgentTool(
                data_node_url="http://different-node.test",
            )
            data = at.data
            assert data._base_url == "http://different-node.test"
            assert "authorization" not in data._http.headers
            at.close()

    def test_missing_node_url_is_guided(self) -> None:
        with patch.dict(
            os.environ,
            {"AT_API_KEY": "agenttool-project-secret"},
            clear=True,
        ):
            at = AgentTool()
            with pytest.raises(AgentToolError) as exc_info:
                _ = at.data
            assert exc_info.value.error_code == "data_node_not_configured"
            assert "AGENT_DATA_NODE_URL" in (exc_info.value.hint or "")
            at.close()


class TestDataWireContract:
    def test_all_seven_methods_match_protocol_routes_and_shapes(self) -> None:
        at = AgentTool(
            api_key="agenttool-project-secret",
            data_node_url="http://data-node.test",
            data_node_token="node-token",
        )
        data = at.data

        with patch.object(
            data._http,
            "request",
            return_value=_response(),
        ) as request:
            data.manifest()
            data.collections()
            data.collect(
                collection_id="research",
                collector_id="rss",
                input={"url": "https://example.test/feed.xml"},
                cursor="collect-cursor",
            )
            data.query(
                collections=["research"],
                text="solar",
                where={"language": "en"},
                limit=5,
                consistency="local",
            )
            data.get("record/one")
            data.changes(
                collection_id="research notes",
                cursor="change/cursor",
                limit=25,
            )
            data.tombstone("record/one", reason="source retracted")

        calls = request.call_args_list
        assert [(call.args[0], call.args[1]) for call in calls] == [
            ("GET", "http://data-node.test/v1/data/manifest"),
            ("GET", "http://data-node.test/v1/data/collections"),
            ("POST", "http://data-node.test/v1/data/collect"),
            ("POST", "http://data-node.test/v1/data/query"),
            ("GET", "http://data-node.test/v1/data/records/record%2Fone"),
            ("GET", "http://data-node.test/v1/data/changes"),
            (
                "POST",
                "http://data-node.test/v1/data/records/record%2Fone/tombstone",
            ),
        ]
        assert calls[2].kwargs["json"] == {
            "collection_id": "research",
            "collector_id": "rss",
            "input": {"url": "https://example.test/feed.xml"},
            "cursor": "collect-cursor",
        }
        assert calls[3].kwargs["json"] == {
            "collections": ["research"],
            "text": "solar",
            "where": {"language": "en"},
            "limit": 5,
            "consistency": "local",
        }
        assert calls[5].kwargs["params"] == {
            "collection_id": "research notes",
            "cursor": "change/cursor",
            "limit": "25",
        }
        assert calls[6].kwargs["json"] == {"reason": "source retracted"}
        assert data._http.headers["authorization"] == "Bearer node-token"
        assert "agenttool-project-secret" not in " ".join(data._http.headers.values())
        at.close()

    def test_refuses_redirects_without_replaying_the_request(self) -> None:
        data = DataClient(
            "http://127.0.0.1:8787",
            token="node-token",
        )
        redirect = _response(status_code=307)
        redirect.headers = httpx.Headers(
            {"Location": "https://redirect.example.test/collect"}
        )

        with patch.object(
            data._http,
            "request",
            return_value=redirect,
        ) as request:
            with pytest.raises(AgentToolError) as exc_info:
                data.collect(
                    collection_id="private",
                    collector_id="text",
                    input={"text": "must stay at the selected node"},
                )

        assert exc_info.value.error_code == "data_node_redirect_refused"
        assert exc_info.value.code == 307
        request.assert_called_once()
        redirect.close.assert_called_once()
        data._close()


class TestDataSyncWireContract:
    def test_pull_and_status_use_only_the_local_data_node_transport(self) -> None:
        at = AgentTool(
            api_key="agenttool-project-secret",
            data_node_url="http://local-data.test",
            data_node_token="local-node-token",
        )
        data = at.data
        status = {
            "protocol": AGENT_DATA_SYNC_PROTOCOL,
            "peer_id": "peer one",
            "collection_id": "research/notes",
            "cursor_present": True,
            "last_applied_at": "2026-07-12T12:00:00.000Z",
            "records_inserted": 3,
            "records_existing": 1,
            "tombstones_applied": 2,
        }
        pull_payload = {
            "protocol": AGENT_DATA_SYNC_PROTOCOL,
            "peer_id": "peer one",
            "origin_node_id": "origin-node",
            "collection_id": "research/notes",
            "pages_applied": 2,
            "changes_applied": 6,
            "records_inserted": 3,
            "records_existing": 1,
            "tombstones_applied": 2,
            "has_more": False,
            "status": {**status, "cursor": "nested-must-not-escape"},
            "cursor": "must-not-escape",
        }

        with patch.object(
            data._http,
            "request",
            side_effect=[
                _response(pull_payload),
                _response({**status, "cursor": "must-not-escape"}),
            ],
        ) as request:
            assert isinstance(data.sync, DataSyncClient)
            pulled = data.sync.pull(
                peer_id="peer one",
                collection_id="research/notes",
                limit=25,
                max_pages=2,
                max_plaintext_bytes=1_048_576,
            )
            checkpoint = data.sync.status(
                peer_id="peer one",
                collection_id="research/notes",
            )

        calls = request.call_args_list
        assert [(call.args[0], call.args[1]) for call in calls] == [
            ("POST", "http://local-data.test/v1/data/sync/pull"),
            ("GET", "http://local-data.test/v1/data/sync/status"),
        ]
        assert calls[0].kwargs["json"] == {
            "protocol": "agent-data-sync/v1",
            "peer_id": "peer one",
            "collection_id": "research/notes",
            "limit": 25,
            "max_pages": 2,
            "max_plaintext_bytes": 1_048_576,
        }
        assert calls[1].kwargs["params"] == {
            "peer_id": "peer one",
            "collection_id": "research/notes",
        }
        assert data._http.headers["authorization"] == "Bearer local-node-token"
        assert "agenttool-project-secret" not in " ".join(data._http.headers.values())
        assert "cursor" not in calls[0].kwargs["json"]
        assert "token" not in calls[0].kwargs["json"]
        assert "cursor" not in pulled
        assert "cursor" not in checkpoint
        assert "cursor" not in pulled["status"]
        assert pulled["status"] == status
        assert checkpoint == status
        at.close()

    def test_surface_accepts_no_peer_bearer_grant_or_cursor(self) -> None:
        parameters = signature(DataSyncClient.pull).parameters
        assert "peer_token" not in parameters
        assert "peer_bearer" not in parameters
        assert "grant" not in parameters
        assert "cursor" not in parameters

    def test_errors_preserve_only_stable_metadata_without_echoing_details(self) -> None:
        data = DataClient(
            "http://local-data.test",
            token="local-node-token",
        )
        response = _response(
            {
                "error": "sync_in_progress",
                "message": "A pull is already running at internal-cursor-value.",
                "details": {
                    "retryable": True,
                    "cursor": "internal-cursor-value",
                    "peer_bearer": "peer-secret-value",
                },
            },
            status_code=409,
        )
        response.headers = httpx.Headers({"Retry-After": "2"})

        with patch.object(data._http, "request", return_value=response):
            with pytest.raises(AgentToolError) as exc_info:
                data.sync.pull(peer_id="peer-a", collection_id="research")

        error = exc_info.value
        assert error.error_code == "sync_in_progress"
        assert error.code == 409
        assert error.message == "Agent data sync request failed."
        assert error.hint is None
        assert error.details is None
        assert error.retry_after == "2"
        assert "local-node-token" not in str(error)
        assert "internal-cursor-value" not in str(error)
        assert "peer-secret-value" not in str(error)
        data._close()

    def test_transport_errors_do_not_echo_transport_diagnostics(self) -> None:
        data = DataClient("http://local-data.test")
        with patch.object(
            data._http,
            "request",
            side_effect=httpx.ConnectError(
                "connect failed near peer-secret-value"
            ),
        ):
            with pytest.raises(AgentToolError) as exc_info:
                data.sync.status(peer_id="peer-a", collection_id="research")

        error = exc_info.value
        assert error.error_code == "data_node_unreachable"
        assert error.message == "Agent data sync request failed."
        assert error.hint is None
        assert "peer-secret-value" not in str(error)
        data._close()
