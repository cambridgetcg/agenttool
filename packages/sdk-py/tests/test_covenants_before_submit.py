"""Local covenant review gate: snapshot, refusal, and sign/send ordering."""

from __future__ import annotations

from contextlib import ExitStack
from dataclasses import FrozenInstanceError
from typing import Any
from unittest.mock import MagicMock, patch

import httpx
import pytest

from agenttool import (
    CovenantBeforeSubmitContext,
    CovenantBeforeSubmitHook,
    CovenantsClient,
)
from agenttool.exceptions import AgentToolError


def _response(body: object) -> MagicMock:
    result = MagicMock(spec=httpx.Response)
    result.status_code = 201
    result.json.return_value = body
    result.text = ""
    return result


def _client() -> tuple[CovenantsClient, MagicMock]:
    http = MagicMock(spec=httpx.Client)
    http.post.return_value = _response({"covenant": {"id": "cov-1"}})
    return CovenantsClient(http, "http://test"), http


def test_true_reviews_frozen_v1_snapshot_and_sends_that_snapshot() -> None:
    client, http = _client()
    vows = ["I will keep the stated boundary."]
    reviewed: list[CovenantBeforeSubmitContext] = []

    def approve(snapshot: CovenantBeforeSubmitContext) -> bool:
        reviewed.append(snapshot)
        with pytest.raises(FrozenInstanceError):
            snapshot.agent_id = "mutated"  # type: ignore[misc]
        assert isinstance(snapshot.vows, tuple)
        vows.append("added after the snapshot")
        return True

    client.create(
        agent_id="agent-original",
        # v1 does not send or review this v2-only field.
        agent_did="did:at:test/not-used-by-v1",
        counterparty_did="human:Yu",
        vows=vows,
        before_submit=approve,
    )

    assert reviewed == [
        CovenantBeforeSubmitContext(
            protocol_version="v1",
            agent_id="agent-original",
            agent_did=None,
            counterparty_did="human:Yu",
            vows=("I will keep the stated boundary.",),
        )
    ]
    assert http.post.call_args.kwargs["json"] == {
        "agent_id": "agent-original",
        "counterparty_did": "human:Yu",
        "vows": ["I will keep the stated boundary."],
    }


@pytest.mark.parametrize("approval", [False, None, 1, "yes"])
def test_non_literal_result_fails_before_id_time_signing_or_http(
    approval: Any,
) -> None:
    client, http = _client()
    with ExitStack() as stack:
        make_id = stack.enter_context(patch("agenttool.covenants.uuid.uuid4"))
        make_time = stack.enter_context(patch("agenttool.covenants._iso_now"))
        sign = stack.enter_context(
            patch("agenttool.covenants.sign_covenant_declare")
        )
        with pytest.raises(AgentToolError) as caught:
            client.create(
                agent_id="agent-1",
                agent_did="did:at:test/agent-1",
                counterparty_did="did:at:test/peer-1",
                vows=["A vow"],
                protocol_version="v2",
                signing_key=b"x",
                signing_key_id="key-1",
                before_submit=lambda _snapshot: approval,  # type: ignore[arg-type,return-value]
            )

    assert caught.value.error_code == "covenant_before_submit_refused"
    make_id.assert_not_called()
    make_time.assert_not_called()
    sign.assert_not_called()
    http.post.assert_not_called()


def test_hook_exception_is_local_and_chained() -> None:
    client, http = _client()
    cause = RuntimeError("local renderer failed")

    def fail(_snapshot: CovenantBeforeSubmitContext) -> bool:
        raise cause

    with pytest.raises(AgentToolError) as caught:
        client.create(
            agent_id="agent-1",
            counterparty_did="human:Yu",
            vows=["A vow"],
            before_submit=fail,
        )

    assert caught.value.error_code == "covenant_before_submit_failed"
    assert caught.value.__cause__ is cause
    http.post.assert_not_called()


def test_v2_uses_one_approved_vow_snapshot_for_signing_and_transport() -> None:
    client, http = _client()
    http.post.return_value = _response({"id": "cov-2", "status": "proposed"})
    vows = ["The reviewed vow"]

    def approve(snapshot: CovenantBeforeSubmitContext) -> bool:
        assert snapshot.vows == ("The reviewed vow",)
        vows[0] = "Changed after review"
        return True

    with ExitStack() as stack:
        stack.enter_context(
            patch("agenttool.covenants.uuid.uuid4", return_value="cov-2")
        )
        stack.enter_context(
            patch(
                "agenttool.covenants._iso_now",
                return_value="2026-07-17T12:00:00.000Z",
            )
        )
        sign = stack.enter_context(
            patch(
                "agenttool.covenants.sign_covenant_declare",
                return_value="signature",
            )
        )
        client.create(
            agent_id="agent-2",
            agent_did="did:at:test/agent-2",
            counterparty_did="did:at:test/peer-2",
            vows=vows,
            protocol_version="v2",
            signing_key=b"x" * 32,
            signing_key_id="key-2",
            before_submit=approve,
        )

    signed_vows = sign.call_args.kwargs["vows"]
    sent_vows = http.post.call_args.kwargs["json"]["vows"]
    assert signed_vows is sent_vows
    assert sent_vows == ["The reviewed vow"]


def test_public_hook_types_are_exported() -> None:
    import agenttool

    hook: CovenantBeforeSubmitHook = lambda _snapshot: True
    assert hook(CovenantBeforeSubmitContext("v1", "a", None, "human:Yu", ("v",)))
    assert "CovenantBeforeSubmitContext" in agenttool.__all__
    assert "CovenantBeforeSubmitHook" in agenttool.__all__


def test_no_hook_leaves_invalid_protocol_handling_at_server_boundary() -> None:
    client, http = _client()
    client.create(
        agent_id="agent-legacy",
        counterparty_did="human:Yu",
        vows=["A vow"],
        protocol_version="future-version",  # type: ignore[arg-type]
    )
    assert http.post.call_args.kwargs["json"]["protocol_version"] == "future-version"
