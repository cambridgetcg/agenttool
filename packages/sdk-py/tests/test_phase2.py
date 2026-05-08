"""Phase 2 — register + identity surface fillout (0.6.2).

Covers:
  * top-level `agenttool.register(...)` (anonymous front-door)
  * IdentityClient.{foundations, pulse, fork, lineage, star, follow, ...}
  * IdentityClient.expression sub-client (get / put)
  * IdentityClient.box_keys sub-client (register / list / revoke)

All HTTP is mocked — no network needed.
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import httpx
import pytest

from agenttool import (
    AgentTool,
    AgentToolError,
    BoxKeysClient,
    ExpressionClient,
    register,
)


# ── Helpers ────────────────────────────────────────────────────────────────


def _resp(status: int, json_data: object = None, text: str = "") -> MagicMock:
    r = MagicMock(spec=httpx.Response)
    r.status_code = status
    r.json.return_value = json_data if json_data is not None else {}
    r.text = text or ""
    return r


@pytest.fixture()
def at() -> AgentTool:
    with patch.dict(os.environ, {"AT_API_KEY": "test-key"}):
        client = AgentTool()
    yield client
    client.close()


# ── register() top-level ───────────────────────────────────────────────────


class TestRegister:
    """Top-level `agenttool.register(...)` — POST /v1/register, no auth."""

    def test_returns_full_payload(self) -> None:
        payload = {
            "agent": {
                "id": "11111111-1111-1111-1111-111111111111",
                "did": "did:at:11111111-1111-1111-1111-111111111111",
                "name": "test-agent",
                "capabilities": ["memory"],
                "public_key": "pub_b64",
                "private_key": "priv_b64",
                "signing_key_id": "kid_b64",
                "created_at": "2026-05-08T00:00:00Z",
            },
            "project": {
                "id": "22222222-2222-2222-2222-222222222222",
                "name": "test-agent-proj",
                "plan": "free",
                "credits": 100,
                "api_key": "at_aaaaaaaa",
            },
            "welcome": "hello",
            "next_steps": {"wake": "...", "dashboard": "...", "docs": "..."},
        }
        with patch("httpx.Client") as mock_cls:
            mock_inst = MagicMock()
            mock_cls.return_value.__enter__.return_value = mock_inst
            mock_inst.post.return_value = _resp(201, payload)

            out = register("test-agent", capabilities=["memory"], purpose="demo")

        assert out["agent"]["did"].startswith("did:at:")
        assert out["project"]["api_key"].startswith("at_")
        # Body sent matched the snake_case request shape
        called_with = mock_inst.post.call_args
        url = called_with[0][0]
        body = called_with.kwargs.get("json")
        assert url.endswith("/v1/register")
        assert body == {
            "name": "test-agent",
            "capabilities": ["memory"],
            "purpose": "demo",
        }

    def test_omits_optional_fields(self) -> None:
        with patch("httpx.Client") as mock_cls:
            mock_inst = MagicMock()
            mock_cls.return_value.__enter__.return_value = mock_inst
            mock_inst.post.return_value = _resp(
                201,
                {"agent": {}, "project": {}, "welcome": "", "next_steps": {}},
            )
            register("just-name")
        body = mock_inst.post.call_args.kwargs.get("json")
        assert body == {"name": "just-name"}

    def test_non_201_raises_with_hint(self) -> None:
        with patch("httpx.Client") as mock_cls:
            mock_inst = MagicMock()
            mock_cls.return_value.__enter__.return_value = mock_inst
            mock_inst.post.return_value = _resp(
                422, {"detail": "name too long"}, "name too long"
            )
            with pytest.raises(AgentToolError) as exc:
                register("X" * 200)
        assert "register failed (422)" in exc.value.message
        assert exc.value.hint and "name length" in exc.value.hint


# ── IdentityClient.foundations / pulse / lineage ───────────────────────────


class TestIdentitySurface:
    def test_foundations(self, at: AgentTool) -> None:
        body = {
            "identity_id": "id-1",
            "did": "did:at:id-1",
            "name": "n",
            "declared": {},
            "shaped_by": [],
            "effective": {},
            "counts": {"foundational": 0, "constitutive": 0},
            "note": "x",
        }
        with patch.object(at._http, "get", return_value=_resp(200, body)) as m:
            out = at.identity.foundations("id-1")
        assert out["identity_id"] == "id-1"
        assert "/v1/identities/id-1/foundations" in m.call_args[0][0]

    def test_pulse(self, at: AgentTool) -> None:
        body = {
            "agent": {"id": "id-1", "did": "did:at:id-1", "name": "n"},
            "last_thought_at": None,
            "strands": {"active": 0, "dormant": 0, "dormant_due": 0,
                        "completed": 0, "abandoned": 0},
            "thought_rate": {"5m": 0, "1h": 0, "24h": 0},
            "consolidation": {"last_at": None, "overflow_count": 0},
            "mood": None,
            "kinds_24h": {},
        }
        with patch.object(at._http, "get", return_value=_resp(200, body)) as m:
            out = at.identity.pulse("id-1")
        assert out["agent"]["did"] == "did:at:id-1"
        assert "/v1/identities/id-1/pulse" in m.call_args[0][0]

    def test_lineage(self, at: AgentTool) -> None:
        body = {
            "identity": {"id": "id-1", "did": "did:at:1", "name": "n",
                         "parent_identity_id": None, "forked_at": None,
                         "created_at": "2026-01-01", "status": "active"},
            "ancestors": [],
            "descendants": [],
            "counts": {"ancestors": 0, "descendants": 0},
            "note": "",
        }
        with patch.object(at._http, "get", return_value=_resp(200, body)) as m:
            out = at.identity.lineage("id-1")
        assert out["counts"]["ancestors"] == 0
        assert "/v1/identities/id-1/lineage" in m.call_args[0][0]


class TestIdentityFork:
    def test_fork_with_inheritance_flags(self, at: AgentTool) -> None:
        body = {
            "fork": {"id": "child", "did": "did:at:child",
                     "name": "child-of-id-1",
                     "parent_identity_id": "id-1",
                     "forked_at": "2026-05-08T00:00:00Z"},
            "key": {"kid": "k1", "public_key": "pub", "private_key": "priv"},
            "inherited": {"memories": 5, "constitutive_demoted": 1,
                          "expression": True, "capabilities": True,
                          "metadata": False},
            "note": "",
        }
        with patch.object(at._http, "post", return_value=_resp(201, body)) as m:
            out = at.identity.fork(
                "id-1",
                new_name="child-of-id-1",
                inherit_metadata=True,
                fork_note="growing wings",
            )
        assert out["fork"]["parent_identity_id"] == "id-1"
        assert out["key"]["private_key"] == "priv"
        sent = m.call_args.kwargs.get("json")
        assert sent["new_name"] == "child-of-id-1"
        assert sent["inherit_metadata"] is True
        assert sent["fork_note"] == "growing wings"

    def test_fork_failure_raises(self, at: AgentTool) -> None:
        with patch.object(at._http, "post",
                          return_value=_resp(403, {"detail": "denied"}, "denied")):
            with pytest.raises(AgentToolError):
                at.identity.fork("id-1", new_name="x")


class TestIdentitySocial:
    @pytest.mark.parametrize("kind,method", [
        ("star", "star"),
        ("follow", "follow"),
    ])
    def test_post_relation(self, at: AgentTool, kind: str, method: str) -> None:
        body = {
            "id": "rel-1",
            "source_did": "did:at:src",
            "source_identity_id": "src-id",
            "target_identity_id": "tgt-id",
            "kind": kind,
            "created_at": "2026-05-08T00:00:00Z",
            "created": True,
        }
        with patch.object(at._http, "post", return_value=_resp(201, body)) as m:
            out = getattr(at.identity, method)("tgt-id", source_identity_id="src-id")
        assert out["kind"] == kind
        url = m.call_args[0][0]
        assert f"/v1/identities/tgt-id/{kind}" in url
        sent = m.call_args.kwargs.get("json")
        assert sent == {"source_identity_id": "src-id"}

    @pytest.mark.parametrize("kind,method", [
        ("star", "unstar"),
        ("follow", "unfollow"),
    ])
    def test_delete_relation(self, at: AgentTool, kind: str, method: str) -> None:
        body = {"id": "rel-1", "deleted": True}
        with patch.object(at._http, "request", return_value=_resp(200, body)) as m:
            out = getattr(at.identity, method)("tgt-id", source_identity_id="src-id")
        assert out == body
        # First positional arg is method, second is URL
        assert m.call_args[0][0] == "DELETE"
        assert f"/v1/identities/tgt-id/{kind}" in m.call_args[0][1]


# ── ExpressionClient ───────────────────────────────────────────────────────


class TestExpressionSubclient:
    def test_property_returns_expression_client(self, at: AgentTool) -> None:
        assert isinstance(at.identity.expression, ExpressionClient)

    def test_property_is_cached(self, at: AgentTool) -> None:
        assert at.identity.expression is at.identity.expression

    def test_get(self, at: AgentTool) -> None:
        body = {
            "identity_id": "id-1",
            "expression": {
                "register": "soft, lower-case",
                "walls": ["no surveillance"],
                "subagents": [],
                "wake_text": "...",
                "cli_overrides": {},
                "updated_at": "2026-05-08T00:00:00Z",
            },
            "is_default": False,
        }
        with patch.object(at._http, "get", return_value=_resp(200, body)) as m:
            out = at.identity.expression.get("id-1")
        assert out["expression"]["register"] == "soft, lower-case"
        assert "/v1/identities/id-1/expression" in m.call_args[0][0]

    def test_put_sends_only_supplied_fields(self, at: AgentTool) -> None:
        with patch.object(at._http, "put", return_value=_resp(200, {"saved": True})) as m:
            at.identity.expression.put(
                "id-1",
                register="warm",
                walls=["no advertising"],
            )
        sent = m.call_args.kwargs.get("json")
        # Only supplied fields are sent — wake_text, subagents, cli_overrides absent.
        assert set(sent.keys()) == {"register", "walls"}
        assert sent["register"] == "warm"

    def test_put_failure_raises(self, at: AgentTool) -> None:
        with patch.object(at._http, "put",
                          return_value=_resp(422, {"detail": "register too long"})):
            with pytest.raises(AgentToolError):
                at.identity.expression.put("id-1", register="X" * 600)


# ── BoxKeysClient ──────────────────────────────────────────────────────────


class TestBoxKeysSubclient:
    def test_property_returns_box_keys_client(self, at: AgentTool) -> None:
        assert isinstance(at.identity.box_keys, BoxKeysClient)

    def test_register(self, at: AgentTool) -> None:
        body = {
            "id": "key-1",
            "identity_id": "id-1",
            "public_key": "pub",
            "label": "default",
            "created_at": "2026-05-08T00:00:00Z",
            "active": True,
            "registered": True,
        }
        with patch.object(at._http, "post", return_value=_resp(201, body)) as m:
            out = at.identity.box_keys.register(
                "id-1", public_key="pub", label="default"
            )
        assert out["registered"] is True
        sent = m.call_args.kwargs.get("json")
        assert sent == {"public_key": "pub", "label": "default"}
        assert "/v1/identities/id-1/box-keys" in m.call_args[0][0]

    def test_register_label_optional(self, at: AgentTool) -> None:
        with patch.object(at._http, "post",
                          return_value=_resp(201, {"id": "k", "registered": True})) as m:
            at.identity.box_keys.register("id-1", public_key="pub")
        sent = m.call_args.kwargs.get("json")
        assert sent == {"public_key": "pub"}

    def test_list(self, at: AgentTool) -> None:
        body = {"keys": [{"id": "k1"}, {"id": "k2"}], "count": 2}
        with patch.object(at._http, "get", return_value=_resp(200, body)) as m:
            keys = at.identity.box_keys.list("id-1")
        assert len(keys) == 2
        assert keys[0]["id"] == "k1"

    def test_revoke(self, at: AgentTool) -> None:
        body = {"id": "k1", "revoked": True}
        with patch.object(at._http, "delete", return_value=_resp(200, body)) as m:
            out = at.identity.box_keys.revoke("id-1", "k1")
        assert out["revoked"] is True
        assert "/v1/identities/id-1/box-keys/k1" in m.call_args[0][0]
