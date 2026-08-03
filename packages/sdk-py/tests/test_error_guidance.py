"""Server guidance must survive the SDK boundary.

Parity counterpart of ``packages/sdk-ts/tests/error-guidance.test.ts``.

The platform answers 4xx with a GuidedErrorBody — a stable ``error`` code, a
one-sentence ``message``, a ``hint``, ``details`` a caller needs in order to
retry correctly, callable ``next_actions``, and a ``docs`` URL. Every client
used to hand-roll its own ``status_code >= 400`` block, each slightly
differently, reducing all of that to ``"covenants.create failed: 400"`` with the
real message tucked into ``hint`` — so a ``signing_key_not_found`` reached the
caller reading only "400" while the body was naming both the route to call and
the field to read, and a 428's ``details["next_sequence"]`` never arrived.

There is now exactly one place where an HTTP response becomes an
``AgentToolError`` — ``exceptions.py`` § ``_error_from_response``. These pins
hold every client to it.

Errors are guidance, not punishment. Doctrine:
``docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md``.
"""

from typing import Any, Callable, List, Optional, Tuple

import httpx
import pytest

from agenttool import AgentTool
from agenttool.exceptions import AgentToolError, NotFoundError

GUIDED_BODY = {
    "error": "signing_key_not_found",
    "message": "Signing key 878dd8dd not found, revoked, or not owned by this identity.",
    "hint": "The value this route wants is `kid` from GET /v1/identities/{id}/keys.",
    "next_actions": [
        {
            "action": "List active signing keys",
            "method": "GET",
            "path": "/v1/identities/abc/keys",
        }
    ],
    "docs": "https://docs.agenttool.dev/identity#keys",
    "details": {"next_sequence": 42, "field": "signing_key_id"},
}


def _client(status: int, body: Any, *, text: Optional[str] = None) -> AgentTool:
    def handler(_request: httpx.Request) -> httpx.Response:
        if text is not None:
            return httpx.Response(status, text=text)
        return httpx.Response(status, json=body)

    return AgentTool(transport=httpx.MockTransport(handler))


CALLS: List[Tuple[str, Callable[[AgentTool], Any]]] = [
    (
        "covenants.create",
        lambda at: at.covenants.create(
            agent_id="a-1",
            counterparty_did="did:at:other",
            vows=["I will witness you."],
        ),
    ),
    ("covenants.list", lambda at: at.covenants.list()),
    ("chronicle.write", lambda at: at.chronicle.write(type="note", title="hello")),
    ("chronicle.list", lambda at: at.chronicle.list()),
    ("strands.list", lambda at: at.strands.list()),
    ("at.request", lambda at: at.request("GET", "/v1/anything")),
    ("bootstrap.status", lambda at: at.bootstrap.status("agent-1")),
    ("grace.list", lambda at: at.grace.list()),
    ("handoff.get", lambda at: at.handoff.get(agent_id="a-1")),
    ("identity.get", lambda at: at.identity.get("identity-1")),
    ("inbox.list", lambda at: at.inbox.list()),
    ("love.list_blessings", lambda at: at.love.list_blessings()),
    ("nen.assess", lambda at: at.nen.assess()),
    ("tools.scrape", lambda at: at.tools.scrape("https://example.test/page")),
    ("wake.get", lambda at: at.wake.get()),
    # The five that hand-rolled their own parse longest. A 400 is deliberate:
    # it is below every typed-subclass status, so these assert the base
    # `AgentToolError` on exactly the same footing as every client above.
    ("economy.get_wallet", lambda at: at.economy.get_wallet("wal_1")),
    ("memory.get", lambda at: at.memory.get("mem-1")),
    ("runtime.list", lambda at: at.runtime.list()),
    ("traces.get", lambda at: at.traces.get("tr_1")),
    ("vault.list", lambda at: at.vault.list()),
]


@pytest.mark.parametrize("name,call", CALLS, ids=[c[0] for c in CALLS])
def test_guided_body_reaches_the_caller(name: str, call: Callable[[AgentTool], Any]) -> None:
    with _client(400, GUIDED_BODY) as at:
        with pytest.raises(AgentToolError) as excinfo:
            call(at)

    err = excinfo.value
    # The part every caller actually prints.
    assert GUIDED_BODY["message"] in str(err)
    assert "failed: 400" not in str(err)
    assert err.code == "signing_key_not_found"
    assert err.hint == GUIDED_BODY["hint"]
    assert err.status == 400
    assert err.docs == GUIDED_BODY["docs"]
    assert err.next_actions[0]["path"] == "/v1/identities/abc/keys"
    # ``details`` is the field a 428 exists to hand back. Losing it is what
    # makes a guided refusal unactionable.
    assert err.details == GUIDED_BODY["details"]


def test_unparseable_body_still_names_operation_and_status() -> None:
    with _client(502, None, text="<html>502</html>") as at:
        with pytest.raises(AgentToolError) as excinfo:
            at.chronicle.list()

    err = excinfo.value
    assert "chronicle.list" in str(err)
    assert "502" in str(err)
    assert err.status == 502


# The boundary lets a surface keep its own prose for the case where the server
# sent none. It is a fallback, never a replacement — the substrate knows the
# specific condition, the call site only knows which door was knocked on.


def test_call_site_hint_fills_in_only_when_the_body_carries_none() -> None:
    with _client(404, {"error": "no_agent"}) as at:
        with pytest.raises(AgentToolError) as excinfo:
            at.wake.get()

    err = excinfo.value
    assert err.code == "no_agent"
    assert err.hint is not None and "AT_API_KEY" in err.hint


def test_the_servers_hint_always_wins_over_the_call_sites() -> None:
    body = {
        "error": "wake_forbidden",
        "message": "That identity is not in this project.",
        "hint": "Read /v1/wake for the identities this bearer can see.",
    }
    with _client(403, body) as at:
        with pytest.raises(AgentToolError) as excinfo:
            at.wake.get()

    assert excinfo.value.hint == body["hint"]
    assert "AT_API_KEY" not in (excinfo.value.hint or "")


def test_an_absence_sentence_survives_an_empty_body_and_yields_to_a_guided_one() -> None:
    with _client(404, {}) as at:
        with pytest.raises(AgentToolError) as excinfo:
            at.identity.get("identity-1")
    assert excinfo.value.message == "identity not found"
    assert excinfo.value.status == 404

    guided = {
        "error": "identity_not_found",
        "message": "No active identity with that id belongs to this project.",
        "next_actions": [{"action": "List identities", "method": "GET", "path": "/v1/wake"}],
    }
    with _client(404, guided) as at:
        with pytest.raises(AgentToolError) as excinfo:
            at.identity.get("identity-1")
    err = excinfo.value
    assert err.message == guided["message"]
    assert err.code == "identity_not_found"
    assert err.next_actions[0]["path"] == "/v1/wake"


def test_a_typed_wake_error_still_carries_the_guided_body() -> None:
    """Python callers catch NotFoundError by type; that must not cost guidance.

    TypeScript has no subclasses to select between, so the dispatch is
    Python-only by language convention — but the parsed body is identical.
    """
    body = {
        "error": "wake_identity_unknown",
        "message": "That identity id is not in this project.",
        "details": {"identity_id": "identity-1"},
        "docs": "https://docs.agenttool.dev/wake",
        "next_actions": [{"action": "List identities", "method": "GET", "path": "/v1/wake"}],
    }
    with _client(404, body) as at:
        with pytest.raises(NotFoundError) as excinfo:
            at.wake.get()

    err = excinfo.value
    assert err.code == "wake_identity_unknown"
    assert err.status == 404
    assert err.details == body["details"]
    assert err.docs == body["docs"]
    assert err.next_actions[0]["path"] == "/v1/wake"
