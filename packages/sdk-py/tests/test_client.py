"""Unit tests for the AgentTool SDK — all HTTP mocked, no network needed."""

from __future__ import annotations

import base64 as base64_module
import os
from typing import Optional
from unittest.mock import MagicMock, patch

import httpx
import pytest
import agenttool

from agenttool import (
    AgentTool,
    AgentToolError,
    DocumentResult,
    Memory,
    X402PaymentRequirement,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_response(
    status_code: int = 200,
    json_data: object = None,
    text: str = "",
    headers: Optional[dict[str, str]] = None,
) -> MagicMock:
    """Create a fake httpx.Response."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data if json_data is not None else {}
    resp.text = text or ""
    resp.headers = httpx.Headers(headers or {})
    return resp


# ---------------------------------------------------------------------------
# Client init
# ---------------------------------------------------------------------------

class TestClientInit:
    def test_document_result_is_publicly_exported(self) -> None:
        assert "DocumentResult" in agenttool.__all__
        assert DocumentResult.__name__ == "DocumentResult"

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

    def test_scrape(self, at: AgentTool) -> None:
        mock_resp = _mock_response(200, {
            "url": "https://example.com",
            "title": "Hello",
            "content": "Hello body",
            "extracted": "Picked",
            "links": ["https://example.com/next"],
            "fetched_at": "2026-07-11T00:00:00.000Z",
            "duration_ms": 12,
            "_welcomed": {
                "axiom_id": 5,
                "walls_held": [8],
                "by": "platform",
                "at_unix_ms": 1_752_192_000_000,
                "walls_intact": True,
                "module": "tool",
            },
        })
        with patch.object(at._http, "post", return_value=mock_resp) as mock_post:
            result = at.tools.scrape(
                "https://example.com", selector="main", extract_links=True
            )
            call_url = mock_post.call_args[0][0] if mock_post.call_args[0] else mock_post.call_args.args[0]
            # Path was fixed in 0.6.1: /v1/scrape/scrape → /v1/scrape.
            assert call_url.endswith("/v1/scrape"), f"Wrong scrape URL: {call_url}"
            assert result.url == "https://example.com"
            assert result.title == "Hello"
            assert result.content == "Hello body"
            assert result.extracted == "Picked"
            assert result.links == ["https://example.com/next"]
            assert result.duration_ms == 12
            assert result._welcomed is not None
            assert result._welcomed.module == "tool"
            body = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1].get("json")
            assert body["selector"] == "main"
            assert body["extract_links"] is True

    def test_scrape_payment_signature_is_v2_header_only_with_success_metadata(
        self, at: AgentTool
    ) -> None:
        mock_resp = _mock_response(
            200,
            {
                "url": "https://example.com",
                "title": "Paid page",
                "content": "Paid body",
                "extracted": None,
                "links": [],
                "fetched_at": "2026-07-11T00:00:00.000Z",
                "duration_ms": 9,
            },
            headers={
                "PAYMENT-RESPONSE": "scrape-settlement-receipt",
                "X-PAYMENT-RESPONSE": "legacy-receipt-must-not-win",
                "Link": '</v1/x402/payments/auth-1>; rel="payment-status"',
                "X-Credits-Balance": "41",
            },
        )
        payment_signature = "eyJ4NDAyVmVyc2lvbiI6MiwicGF5bG9hZCI6e319"
        with patch.object(at._http, "post", return_value=mock_resp) as mock_post:
            result = at.tools.scrape(
                "https://example.com",
                selector="main",
                payment_signature=payment_signature,
            )
        assert mock_post.call_args.kwargs["headers"] == {
            "PAYMENT-SIGNATURE": payment_signature
        }
        assert mock_post.call_args.kwargs["json"] == {
            "url": "https://example.com",
            "extract_links": False,
            "selector": "main",
        }
        assert result.payment_response == "scrape-settlement-receipt"
        assert result.payment_status_link == (
            '</v1/x402/payments/auth-1>; rel="payment-status"'
        )
        assert result.credits_balance == "41"

    def test_execute_python(self, at: AgentTool) -> None:
        mock_resp = _mock_response(200, {
            "stdout": "42\n",
            "stderr": "",
            "exit_code": 0,
            "duration_ms": 12,
            "timed_out": False,
            "credits_used": 2,
        })
        with patch.object(at._http, "post", return_value=mock_resp) as mock_post:
            result = at.tools.execute("print(42)")
            assert result.stdout == "42\n"
            assert result.output == "42\n"
            assert result.exit_code == 0
            assert result.duration_ms == 12
            assert result.timed_out is False
            assert result.credits_used == 2
            body = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1].get("json")
            assert body["language"] == "python"

    def test_execute_javascript(self, at: AgentTool) -> None:
        mock_resp = _mock_response(200, {
            "stdout": "hello\n",
            "stderr": "",
            "exit_code": 0,
            "duration_ms": 8,
            "timed_out": False,
            "credits_used": 2,
        })
        with patch.object(at._http, "post", return_value=mock_resp) as mock_post:
            result = at.tools.execute("console.log('hello')", language="javascript")
            assert result.stdout == "hello\n"
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

    def test_parse_document_payment_signature_is_v2_header_only_with_success_metadata(
        self, at: AgentTool
    ) -> None:
        mock_resp = _mock_response(
            200,
            {
                "title": "Paid document",
                "content": "Document body",
                "word_count": 2,
                "content_type": "text/html",
                "metadata": {},
                "duration_ms": 7,
            },
            headers={
                "PAYMENT-RESPONSE": "document-settlement-receipt",
                "X-Credits-Balance": "40",
            },
        )
        payment_signature = "eyJ4NDAyVmVyc2lvbiI6MiwicGF5bG9hZCI6e319"
        with patch.object(at._http, "post", return_value=mock_resp) as mock_post:
            result = at.tools.parse_document(
                url="https://example.com/document",
                payment_signature=payment_signature,
            )
        assert mock_post.call_args.kwargs["headers"] == {
            "PAYMENT-SIGNATURE": payment_signature
        }
        assert mock_post.call_args.kwargs["json"] == {
            "url": "https://example.com/document"
        }
        assert result.payment_response == "document-settlement-receipt"
        assert result.credits_balance == "40"

    def test_parse_document_by_base64(self, at: AgentTool) -> None:
        import base64
        html = base64.b64encode(b"<h1>Hello</h1>").decode()
        mock_resp = _mock_response(200, {
            "title": "Hello", "content": "Hello", "word_count": 1,
            "content_type": "text/html", "metadata": {}, "duration_ms": 10,
        })
        with patch.object(at._http, "post", return_value=mock_resp) as mock_post:
            result = at.tools.parse_document(
                base64=html,
                content_type="text/html; charset=utf-8",
            )
            body = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1].get("json")
            assert body["base64"] == html
            assert body["content_type"] == "text/html; charset=utf-8"
            assert result.content == "Hello"

    def test_parse_document_requires_url_or_base64(self, at: AgentTool) -> None:
        with pytest.raises(AgentToolError) as exc_info:
            at.tools.parse_document()
        assert "exactly one of url or base64" in exc_info.value.message

    def test_parse_document_rejects_ambiguous_or_oversized_input(self, at: AgentTool) -> None:
        with pytest.raises(AgentToolError, match="exactly one"):
            at.tools.parse_document(url="https://example.com", base64="eA==")
        with pytest.raises(AgentToolError, match="1,400,000 character limit"):
            at.tools.parse_document(base64="A" * 1_400_001)
        for malformed in (
            "",
            "%%%",
            "SGV sbG8=",
            "SGVsbG8",
            "SGVsbG8=garbage",
            "AB==",
            "AAB=",
        ):
            with pytest.raises(AgentToolError, match="canonical padded RFC 4648"):
                at.tools.parse_document(base64=malformed)
        oversized = base64_module.b64encode(b"\0" * 1_000_001).decode()
        with pytest.raises(AgentToolError, match="1,000,000 byte limit"):
            at.tools.parse_document(base64=oversized)
        with pytest.raises(AgentToolError, match="exactly one"):
            at.tools.parse_document(url="https://example.com", base64="")
        with pytest.raises(AgentToolError, match="content_type is only valid"):
            at.tools.parse_document(
                url="https://example.com", content_type="text/html"
            )

    def test_error_raises(self, at: AgentTool) -> None:
        # `tools.search` is deprecated in 0.6.1, so swap to `scrape` to verify
        # that the standard server-error path still raises AgentToolError.
        mock_resp = _mock_response(500, {"detail": "Internal error"}, "Internal error")
        with patch.object(at._http, "post", return_value=mock_resp):
            with pytest.raises(AgentToolError) as exc_info:
                at.tools.scrape("https://will-fail.example")
            assert "500" in exc_info.value.message

    def test_safe_fetch_error_keeps_structured_guidance(self, at: AgentTool) -> None:
        mock_resp = _mock_response(
            400,
            {
                "error": "safe_net_destination_not_public",
                "message": (
                    "The destination was rejected by the public-Web network policy."
                ),
                "safety": "/public/safety",
                "docs": "https://docs.agenttool.dev/tools",
                "details": {
                    "formErrors": [],
                    "fieldErrors": {"url": ["Destination is not public"]},
                },
            },
        )
        with patch.object(at._http, "post", return_value=mock_resp):
            with pytest.raises(AgentToolError) as exc_info:
                at.tools.scrape("https://private.example")
        assert exc_info.value.code == 400
        assert exc_info.value.error_code == "safe_net_destination_not_public"
        assert "public-Web network policy" in exc_info.value.message
        assert exc_info.value.safety == "/public/safety"
        assert exc_info.value.docs == "https://docs.agenttool.dev/tools"
        assert exc_info.value.details == {
            "formErrors": [],
            "fieldErrors": {"url": ["Destination is not public"]},
        }

    def test_x402_error_keeps_envelope_and_recovery_headers(
        self, at: AgentTool
    ) -> None:
        accepts: list[X402PaymentRequirement] = [
            {
                "scheme": "exact",
                "network": "eip155:8453",
                "amount": "1000",
                "payTo": "0x0000000000000000000000000000000000000000",
                "maxTimeoutSeconds": 60,
                "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                "extra": {
                    "name": "USD Coin",
                    "version": "2",
                    "assetTransferMethod": "eip3009",
                },
            }
        ]
        resource = {
            "url": "https://api.agenttool.dev/v1/scrape",
            "description": "Ring 2 tool call.",
            "mimeType": "application/json",
        }
        payment_required = "eyJ4NDAyVmVyc2lvbiI6Mn0="
        payment_response = "eyJzdWNjZXNzIjp0cnVlfQ=="
        mock_resp = _mock_response(
            402,
            {
                "x402Version": 2,
                "resource": resource,
                "accepts": accepts,
                "extensions": {"bazaar": {"info": {"input": {"type": "http"}}}},
                "error": "usage_cap_exceeded",
            },
            headers={
                "PAYMENT-REQUIRED": payment_required,
                "PAYMENT-RESPONSE": payment_response,
                "Link": '</v1/x402/payments/auth-2>; rel="payment-status"',
                "X-Credits-Balance": "0",
            },
        )
        with patch.object(at._http, "post", return_value=mock_resp):
            with pytest.raises(AgentToolError) as exc_info:
                at.tools.scrape("https://example.com")
        err = exc_info.value
        assert err.code == 402
        assert err.error_code == "usage_cap_exceeded"
        assert err.x402_version == 2
        assert err.x402Version == 2
        assert err.accepts == accepts
        assert err.x402_resource == resource
        assert err.x402Resource == resource
        assert err.extensions == {
            "bazaar": {"info": {"input": {"type": "http"}}}
        }
        assert err.payment_required == payment_required
        assert err.paymentRequired == payment_required
        assert err.payment_response == payment_response
        assert err.paymentResponse == payment_response
        assert err.payment_status_link == (
            '</v1/x402/payments/auth-2>; rel="payment-status"'
        )
        assert err.paymentStatusLink == err.payment_status_link
        assert err.credits_balance == "0"
        assert err.creditsBalance == "0"

    def test_4xx_after_payment_keeps_settlement_receipt(
        self, at: AgentTool
    ) -> None:
        mock_resp = _mock_response(
            422,
            {
                "error": "invalid_selector",
                "message": "The paid request reached the handler but was invalid.",
            },
            headers={
                "PAYMENT-RESPONSE": "settled-422-receipt",
                "X-Credits-Balance": "9",
            },
        )
        with patch.object(at._http, "post", return_value=mock_resp):
            with pytest.raises(AgentToolError) as exc_info:
                at.tools.scrape("https://example.com", selector="[")
        err = exc_info.value
        assert err.code == 422
        assert err.error_code == "invalid_selector"
        assert err.payment_required is None
        assert err.payment_response == "settled-422-receipt"
        assert err.paymentResponse == "settled-422-receipt"
        assert err.credits_balance == "9"

    def test_fail_closed_x402_admission_keeps_retry_after_without_challenge(
        self, at: AgentTool
    ) -> None:
        mock_resp = _mock_response(
            402,
            {
                "error": "insufficient_credits",
                "message": "Payment admission is temporarily unavailable.",
            },
            headers={"Retry-After": "600"},
        )
        with patch.object(at._http, "post", return_value=mock_resp):
            with pytest.raises(AgentToolError) as exc_info:
                at.tools.scrape("https://example.com")
        err = exc_info.value
        assert err.code == 402
        assert err.payment_required is None
        assert err.retry_after == "600"
        assert err.retryAfter == "600"


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

    def test_factory_prefers_canonical_v2_headers_case_insensitively(self) -> None:
        payment_required = "eyJ4NDAyVmVyc2lvbiI6Mn0="
        payment_response = "settled-factory-receipt"
        err = AgentToolError.from_response_body(
            {
                "x402Version": 2,
                "resource": {"url": "https://api.agenttool.dev/v1/scrape"},
                "accepts": [],
                "error": "payment_required",
            },
            402,
            "Payment Required",
            headers={
                "payment-required": payment_required,
                "payment-response": payment_response,
                "x-payment-required": "legacy-required-must-not-win",
                "x-payment-response": "legacy-response-must-not-win",
                "x-credits-balance": "12",
            },
        )
        assert err.x402_version == 2
        assert err.accepts == []
        assert err.x402_resource == {"url": "https://api.agenttool.dev/v1/scrape"}
        assert err.payment_required == payment_required
        assert err.payment_response == payment_response
        assert err.paymentResponse == payment_response
        assert err.credits_balance == "12"

    def test_factory_accepts_x_prefixed_headers_as_transition_fallback(self) -> None:
        err = AgentToolError.from_response_body(
            {"x402Version": 2, "accepts": [], "error": "payment_required"},
            402,
            "Payment Required",
            headers={
                "x-payment-required": "legacy-required",
                "x-payment-response": "legacy-response",
            },
        )
        assert err.payment_required == "legacy-required"
        assert err.payment_response == "legacy-response"


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
