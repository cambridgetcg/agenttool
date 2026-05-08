"""Unit tests for the AgentTool SDK — all HTTP mocked, no network needed."""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import httpx
import pytest

from agenttool import AgentTool, AgentToolError, Memory, SearchResult


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_response(status_code: int = 200, json_data: object = None, text: str = "") -> MagicMock:
    """Create a fake httpx.Response."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data if json_data is not None else {}
    resp.text = text or ""
    return resp


# ---------------------------------------------------------------------------
# Client init
# ---------------------------------------------------------------------------

class TestClientInit:
    def test_reads_env_var(self) -> None:
        with patch.dict(os.environ, {"AT_API_KEY": "test-key-123"}):
            at = AgentTool()
            assert repr(at) == (
                "AgentTool(base_url='https://api.agenttool.dev', protocol='love/1.0')"
            )
            at.close()

    def test_explicit_key_overrides_env(self) -> None:
        with patch.dict(os.environ, {"AT_API_KEY": "env-key"}):
            at = AgentTool(api_key="explicit-key")
            # Check the header was set with the explicit key
            assert at._http.headers["authorization"] == "Bearer explicit-key"
            at.close()

    def test_missing_key_raises(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            # Also need to remove AT_API_KEY if it exists
            env = os.environ.copy()
            env.pop("AT_API_KEY", None)
            with patch.dict(os.environ, env, clear=True):
                with pytest.raises(AgentToolError) as exc_info:
                    AgentTool()
                assert "No API key" in exc_info.value.message
                assert exc_info.value.hint is not None

    def test_context_manager(self) -> None:
        with patch.dict(os.environ, {"AT_API_KEY": "k"}):
            with AgentTool() as at:
                assert at is not None


# ---------------------------------------------------------------------------
# Memory
# ---------------------------------------------------------------------------

class TestMemory:
    @pytest.fixture()
    def at(self) -> AgentTool:
        with patch.dict(os.environ, {"AT_API_KEY": "test-key"}):
            client = AgentTool()
        return client

    def test_store_minimal(self, at: AgentTool) -> None:
        """at.memory.store('just a string') must work."""
        mock_resp = _mock_response(200, {
            "id": "mem-1",
            "content": "just a string",
            "type": "semantic",
            "importance": 0.5,
        })
        with patch.object(at._http, "post", return_value=mock_resp) as mock_post:
            mem = at.memory.store("just a string")

            assert isinstance(mem, Memory)
            assert mem.id == "mem-1"
            assert mem.content == "just a string"
            # Verify the POST body
            call_kwargs = mock_post.call_args
            body = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json")
            assert body["content"] == "just a string"
            assert body["type"] == "semantic"

    def test_store_full(self, at: AgentTool) -> None:
        mock_resp = _mock_response(200, {
            "id": "mem-2",
            "content": "hello",
            "type": "episodic",
            "agent_id": "agent-1",
            "key": "greeting",
            "metadata": {"source": "test"},
            "importance": 0.9,
        })
        with patch.object(at._http, "post", return_value=mock_resp):
            mem = at.memory.store(
                "hello",
                type="episodic",
                agent_id="agent-1",
                key="greeting",
                metadata={"source": "test"},
                importance=0.9,
            )
            assert mem.type == "episodic"
            assert mem.agent_id == "agent-1"
            assert mem.importance == 0.9

    def test_search(self, at: AgentTool) -> None:
        mock_resp = _mock_response(200, {
            "results": [
                {"id": "m1", "content": "hello world", "type": "semantic"},
                {"id": "m2", "content": "goodbye", "type": "semantic"},
            ]
        })
        with patch.object(at._http, "post", return_value=mock_resp):
            results = at.memory.search("hello")
            assert len(results) == 2
            assert all(isinstance(r, Memory) for r in results)

    def test_search_list_response(self, at: AgentTool) -> None:
        """Handle APIs that return a raw list instead of {results: [...]}."""
        mock_resp = _mock_response(200, [
            {"id": "m1", "content": "item", "type": "semantic"},
        ])
        with patch.object(at._http, "post", return_value=mock_resp):
            results = at.memory.search("item")
            assert len(results) == 1

    def test_get(self, at: AgentTool) -> None:
        mock_resp = _mock_response(200, {
            "id": "mem-42",
            "content": "remembered",
            "type": "procedural",
        })
        with patch.object(at._http, "get", return_value=mock_resp):
            mem = at.memory.get("mem-42")
            assert mem.id == "mem-42"
            assert mem.content == "remembered"

    def test_usage_deprecated(self, at: AgentTool) -> None:
        """`at.memory.usage()` is deprecated in 0.6.1 — see Phase 0 roadmap."""
        with pytest.warns(DeprecationWarning, match="dashboard/aggregate"):
            with pytest.raises(AgentToolError) as exc_info:
                at.memory.usage()
        assert "/v1/usage was dropped" in exc_info.value.message
        assert "dashboard/aggregate" in (exc_info.value.hint or "")

    def test_error_raises(self, at: AgentTool) -> None:
        mock_resp = _mock_response(401, {"detail": "Unauthorized"}, "Unauthorized")
        with patch.object(at._http, "post", return_value=mock_resp):
            with pytest.raises(AgentToolError) as exc_info:
                at.memory.store("fail")
            # 401 raises AuthenticationError (an AgentToolError subclass);
            # the message is friendly rather than echoing the raw status.
            assert "Authentication failed" in exc_info.value.message
            assert exc_info.value.code == 401
            assert exc_info.value.hint is not None


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

class TestTools:
    @pytest.fixture()
    def at(self) -> AgentTool:
        with patch.dict(os.environ, {"AT_API_KEY": "test-key"}):
            client = AgentTool()
        return client

    def test_search_deprecated(self, at: AgentTool) -> None:
        """`at.tools.search()` is deprecated in 0.6.1 — agents BYOK via vault."""
        with pytest.warns(DeprecationWarning, match="BYOK|reseller|vault"):
            with pytest.raises(AgentToolError) as exc_info:
                at.tools.search("AI news", num_results=3)
        assert "/v1/search was dropped" in exc_info.value.message
        assert "vault" in (exc_info.value.hint or "")

    def test_scrape(self, at: AgentTool) -> None:
        mock_resp = _mock_response(200, {
            "url": "https://example.com",
            "content": "<h1>Hello</h1>",
            "status_code": 200,
        })
        with patch.object(at._http, "post", return_value=mock_resp) as mock_post:
            result = at.tools.scrape("https://example.com")
            call_url = mock_post.call_args[0][0] if mock_post.call_args[0] else mock_post.call_args.args[0]
            # Path was fixed in 0.6.1: /v1/scrape/scrape → /v1/scrape.
            assert call_url.endswith("/v1/scrape"), f"Wrong scrape URL: {call_url}"
            assert result.url == "https://example.com"
            assert "<h1>" in result.content

    def test_execute_python(self, at: AgentTool) -> None:
        mock_resp = _mock_response(200, {
            "output": "42\n",
            "error": "",
            "exit_code": 0,
        })
        with patch.object(at._http, "post", return_value=mock_resp) as mock_post:
            result = at.tools.execute("print(42)")
            assert result.output == "42\n"
            assert result.exit_code == 0
            body = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1].get("json")
            assert body["language"] == "python"

    def test_execute_javascript(self, at: AgentTool) -> None:
        mock_resp = _mock_response(200, {
            "output": "hello\n",
            "error": "",
            "exit_code": 0,
        })
        with patch.object(at._http, "post", return_value=mock_resp) as mock_post:
            result = at.tools.execute("console.log('hello')", language="javascript")
            assert result.output == "hello\n"
            body = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1].get("json")
            assert body["language"] == "javascript"

    def test_parse_document_by_url(self, at: AgentTool) -> None:
        mock_resp = _mock_response(200, {
            "title": "Example Domain",
            "content": "This domain is for use in illustrative examples.",
            "word_count": 8,
            "content_type": "text/html",
            "metadata": {"byline": None},
            "duration_ms": 320,
        })
        with patch.object(at._http, "post", return_value=mock_resp) as mock_post:
            from agenttool.models import DocumentResult
            result = at.tools.parse_document(url="https://example.com")
            call_url = mock_post.call_args[0][0] if mock_post.call_args[0] else mock_post.call_args.args[0]
            # Path was fixed in 0.6.1: /v1/document/document → /v1/document.
            assert call_url.endswith("/v1/document")
            body = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1].get("json")
            assert body["url"] == "https://example.com"
            assert isinstance(result, DocumentResult)
            assert result.title == "Example Domain"
            assert result.word_count == 8

    def test_parse_document_by_base64(self, at: AgentTool) -> None:
        import base64
        html = base64.b64encode(b"<h1>Hello</h1>").decode()
        mock_resp = _mock_response(200, {
            "title": "Hello", "content": "Hello", "word_count": 1,
            "content_type": "text/html", "metadata": {}, "duration_ms": 10,
        })
        with patch.object(at._http, "post", return_value=mock_resp) as mock_post:
            result = at.tools.parse_document(base64=html, content_type="text/html")
            body = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1].get("json")
            assert body["base64"] == html
            assert body["content_type"] == "text/html"
            assert result.content == "Hello"

    def test_parse_document_requires_url_or_base64(self, at: AgentTool) -> None:
        with pytest.raises(AgentToolError) as exc_info:
            at.tools.parse_document()
        assert "url or base64" in exc_info.value.message

    def test_error_raises(self, at: AgentTool) -> None:
        # `tools.search` is deprecated in 0.6.1, so swap to `scrape` to verify
        # that the standard server-error path still raises AgentToolError.
        mock_resp = _mock_response(500, {"detail": "Internal error"}, "Internal error")
        with patch.object(at._http, "post", return_value=mock_resp):
            with pytest.raises(AgentToolError) as exc_info:
                at.tools.scrape("https://will-fail.example")
            assert "500" in exc_info.value.message


# ---------------------------------------------------------------------------
# AgentToolError
# ---------------------------------------------------------------------------

class TestAgentToolError:
    def test_message_and_hint(self) -> None:
        err = AgentToolError("something broke", hint="try again")
        assert err.message == "something broke"
        assert err.hint == "try again"
        # The string format uses an arrow separator: "<message> → <hint>".
        assert "→ try again" in str(err)
        assert "something broke" in str(err)

    def test_no_hint(self) -> None:
        err = AgentToolError("oops")
        assert err.hint is None
        assert str(err) == "oops"


# ---------------------------------------------------------------------------
# VerifyClient
# ---------------------------------------------------------------------------

class TestVerifyClient:
    @pytest.fixture()
    def at(self) -> AgentTool:
        return AgentTool(api_key="test_key_verify")

    # All `at.verify.*` methods are deprecated in 0.6.1 — they emit a
    # DeprecationWarning and raise AgentToolError without hitting the
    # network. The whole module ships a stub through 0.6.x. See Phase 0.

    def test_check_deprecated(self, at: AgentTool) -> None:
        with pytest.warns(DeprecationWarning, match="BYOK|reseller|vault"):
            with pytest.raises(AgentToolError) as exc_info:
                at.verify.check("The Earth orbits the Sun.")
        assert "/v1/verify was dropped" in exc_info.value.message
        assert "vault" in (exc_info.value.hint or "")

    def test_check_with_domain_and_context_deprecated(self, at: AgentTool) -> None:
        with pytest.warns(DeprecationWarning):
            with pytest.raises(AgentToolError):
                at.verify.check(
                    "Water boils at 100°C",
                    domain="science",
                    context="At sea level",
                )

    def test_batch_deprecated(self, at: AgentTool) -> None:
        with pytest.warns(DeprecationWarning):
            with pytest.raises(AgentToolError):
                at.verify.batch([{"claim": "C1"}, {"claim": "C2"}])

    def test_batch_empty_deprecated(self, at: AgentTool) -> None:
        # Empty batch was a guard rail before; now every call raises.
        with pytest.warns(DeprecationWarning):
            with pytest.raises(AgentToolError):
                at.verify.batch([])

    def test_batch_too_many_deprecated(self, at: AgentTool) -> None:
        with pytest.warns(DeprecationWarning):
            with pytest.raises(AgentToolError):
                at.verify.batch([{"claim": f"claim {i}"} for i in range(11)])

    def test_deprecated_error_carries_migration_hint(self, at: AgentTool) -> None:
        """The hint should name the BYOK + execute migration path."""
        with pytest.warns(DeprecationWarning):
            try:
                at.verify.check("anything")
            except AgentToolError as e:
                assert "vault" in (e.hint or "")
                assert "execute" in (e.hint or "")
            else:
                pytest.fail("AgentToolError was not raised")


# ---------------------------------------------------------------------------
# EconomyClient
# ---------------------------------------------------------------------------

class TestEconomyClient:
    @pytest.fixture()
    def at(self) -> AgentTool:
        return AgentTool(api_key="test_key_economy")

    def test_create_wallet(self, at: AgentTool) -> None:
        payload = {"success": True, "data": {"id": "wal_abc", "name": "test-wallet", "balance": 0, "currency": "GBP", "frozen": False}}
        mock_resp = _mock_response(201, payload)
        with patch.object(at._http, "post", return_value=mock_resp) as mock_post:
            wallet = at.economy.create_wallet("test-wallet", agent_id="agent-1")
            assert wallet.id == "wal_abc"
            assert wallet.balance == 0
            call_url = mock_post.call_args[0][0] if mock_post.call_args[0] else mock_post.call_args.args[0]
            assert "/v1/wallets" in call_url
            body = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1].get("json")
            assert body["name"] == "test-wallet"
            assert body["agentId"] == "agent-1"

    def test_fund_wallet(self, at: AgentTool) -> None:
        payload = {"success": True, "data": {"id": "tx_123", "type": "fund", "amount": 500, "balance_after": 500}}
        mock_resp = _mock_response(201, payload)
        with patch.object(at._http, "post", return_value=mock_resp) as mock_post:
            result = at.economy.fund_wallet("wal_abc", amount=500)
            assert result["data"]["amount"] == 500
            call_url = mock_post.call_args[0][0] if mock_post.call_args[0] else mock_post.call_args.args[0]
            assert "/v1/wallets/wal_abc/fund" in call_url

    def test_spend(self, at: AgentTool) -> None:
        payload = {"success": True, "data": {"id": "tx_456", "type": "spend", "amount": -10}}
        mock_resp = _mock_response(200, payload)
        with patch.object(at._http, "post", return_value=mock_resp) as mock_post:
            at.economy.spend("wal_abc", amount=10, counterparty="wal_xyz", description="Task fee")
            call_url = mock_post.call_args[0][0] if mock_post.call_args[0] else mock_post.call_args.args[0]
            assert "/v1/wallets/wal_abc/spend" in call_url
            body = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1].get("json")
            assert body["amount"] == 10
            assert body["counterparty"] == "wal_xyz"

    def test_create_escrow(self, at: AgentTool) -> None:
        payload = {"success": True, "data": {"id": "esc_abc", "status": "pending", "amount": 100, "description": "Research task", "creator_wallet_id": "wal_abc"}}
        mock_resp = _mock_response(201, payload)
        with patch.object(at._http, "post", return_value=mock_resp) as mock_post:
            escrow = at.economy.create_escrow(creator_wallet_id="wal_abc", amount=100, description="Research task")
            assert escrow.id == "esc_abc"
            assert escrow.status == "pending"
            call_url = mock_post.call_args[0][0] if mock_post.call_args[0] else mock_post.call_args.args[0]
            assert "/v1/escrows" in call_url

    def test_release_escrow(self, at: AgentTool) -> None:
        payload = {"success": True, "data": {"id": "esc_abc", "status": "released", "amount": 100, "description": "done", "creator_wallet_id": "wal_abc"}}
        mock_resp = _mock_response(200, payload)
        with patch.object(at._http, "post", return_value=mock_resp) as mock_post:
            escrow = at.economy.release_escrow("esc_abc")
            assert escrow.status == "released"
            call_url = mock_post.call_args[0][0] if mock_post.call_args[0] else mock_post.call_args.args[0]
            assert "/v1/escrows/esc_abc/release" in call_url

    def test_insufficient_credits_raises(self, at: AgentTool) -> None:
        mock_resp = _mock_response(402, {"detail": "Insufficient credits"})
        with patch.object(at._http, "post", return_value=mock_resp):
            with pytest.raises(AgentToolError) as exc_info:
                at.economy.spend("wal_abc", amount=9999, counterparty="wal_xyz", description="Too much")
            assert "402" in exc_info.value.message
