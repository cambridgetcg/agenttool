"""agent-data/v1 SDK façade tests — all HTTP mocked, no network."""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import httpx
import pytest

from agenttool import AgentTool, AgentToolError, DataClient


def _response(payload: object = None, status_code: int = 200) -> MagicMock:
    response = MagicMock(spec=httpx.Response)
    response.status_code = status_code
    response.json.return_value = payload if payload is not None else {"ok": True}
    response.text = ""
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
