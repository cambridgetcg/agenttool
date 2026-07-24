"""Server guidance must survive the SDK boundary.

Parity counterpart of ``packages/sdk-ts/tests/error-guidance.test.ts``.

The platform answers 4xx with a GuidedErrorBody — a stable ``error`` code, a
one-sentence ``message``, a ``hint``, callable ``next_actions``, and a ``docs``
URL. Several clients used to reduce all of that to
``"covenants.create failed: 400"`` with the real message tucked into ``hint``,
so a ``signing_key_not_found`` reached the caller reading only "400" while the
body was naming both the route to call and the field to read.

Errors are guidance, not punishment. Doctrine:
``docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md``.
"""

from typing import Any, Callable, List, Optional, Tuple

import httpx
import pytest

from agenttool import AgentTool
from agenttool.exceptions import AgentToolError

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


def test_unparseable_body_still_names_operation_and_status() -> None:
    with _client(502, None, text="<html>502</html>") as at:
        with pytest.raises(AgentToolError) as excinfo:
            at.chronicle.list()

    err = excinfo.value
    assert "chronicle.list" in str(err)
    assert "502" in str(err)
    assert err.status == 502
