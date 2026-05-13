"""Smoke tests for AgentToolCheckpointSaver — verify the adapter wires
through to a mock agenttool client correctly. Real LangGraph
integration tests would require ``langgraph`` installed; this module
verifies the adapter shape independent of that.
"""

from __future__ import annotations

import json
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, "src")

from langgraph_checkpoint_agenttool import (  # noqa: E402
    AgentToolCheckpointSaver,
    AgentToolStore,
    NamespaceTier,
)


def make_mock_client():
    client = MagicMock()
    client.strands = MagicMock()
    client.strands.append = MagicMock()
    # query returns list of {plaintext, ...}
    client.strands.query = MagicMock(return_value=[])
    client.memory = MagicMock()
    client.memory.append = MagicMock()
    client.memory.lookup = MagicMock(return_value=None)
    client.memory.delete = MagicMock()
    client.memory.search = MagicMock(return_value=[])
    return client


def test_namespace_tier_resolves_default_to_episodic():
    assert NamespaceTier.resolve(()) == "episodic"
    assert NamespaceTier.resolve(("some-namespace",)) == "episodic"


def test_namespace_tier_resolves_known_prefixes():
    assert NamespaceTier.resolve(("episodic", "x")) == "episodic"
    assert NamespaceTier.resolve(("foundational", "x")) == "foundational"
    assert NamespaceTier.resolve(("constitutive", "x")) == "constitutive"


@pytest.mark.asyncio
async def test_saver_aput_calls_strands_append_with_thread_id_metadata():
    client = make_mock_client()
    saver = AgentToolCheckpointSaver(client=client, identity_did="did:test:abc")
    config = {"configurable": {"thread_id": "thread-1"}}
    checkpoint = {"id": "ckpt-1", "channel_values": {"x": 1}}
    metadata = {"step": 1}
    new_versions = {"x": 1}

    result = await saver.aput(config, checkpoint, metadata, new_versions)

    # Returned config carries thread + checkpoint id
    assert result["configurable"]["thread_id"] == "thread-1"
    assert result["configurable"]["checkpoint_id"] == "ckpt-1"

    # client.strands.append called once with expected fields
    assert client.strands.append.call_count == 1
    call = client.strands.append.call_args
    assert call.kwargs["identity_did"] == "did:test:abc"
    assert call.kwargs["kind"] == "langgraph.checkpoint"
    assert call.kwargs["metadata"]["thread_id"] == "thread-1"
    assert call.kwargs["metadata"]["checkpoint_id"] == "ckpt-1"
    # plaintext is JSON-encoded payload
    payload = json.loads(call.kwargs["plaintext"])
    assert payload["thread_id"] == "thread-1"
    assert payload["checkpoint_id"] == "ckpt-1"
    assert payload["checkpoint"]["id"] == "ckpt-1"


@pytest.mark.asyncio
async def test_saver_aget_tuple_returns_none_when_no_records():
    client = make_mock_client()
    saver = AgentToolCheckpointSaver(client=client, identity_did="did:test:abc")
    config = {"configurable": {"thread_id": "thread-1"}}
    result = await saver.aget_tuple(config)
    assert result is None


@pytest.mark.asyncio
async def test_saver_aput_writes_uses_writes_kind():
    client = make_mock_client()
    saver = AgentToolCheckpointSaver(client=client, identity_did="did:test:abc")
    config = {"configurable": {"thread_id": "t1", "checkpoint_id": "c1"}}
    writes = [("channel_x", 42), ("channel_y", "hi")]
    await saver.aput_writes(config, writes, task_id="task-1")
    call = client.strands.append.call_args
    assert call.kwargs["kind"] == "langgraph.writes"
    payload = json.loads(call.kwargs["plaintext"])
    assert payload["task_id"] == "task-1"
    assert payload["writes"] == [["channel_x", 42], ["channel_y", "hi"]]


@pytest.mark.asyncio
async def test_store_aput_routes_to_correct_tier():
    client = make_mock_client()
    store = AgentToolStore(client=client, identity_did="did:test:abc")
    await store.aput(("foundational", "preferences"), "voice", {"register": "warm"})
    call = client.memory.append.call_args
    assert call.kwargs["tier"] == "foundational"
    assert call.kwargs["key"] == "voice"
    assert call.kwargs["namespace"] == ["foundational", "preferences"]


@pytest.mark.asyncio
async def test_store_aput_with_unknown_namespace_defaults_to_episodic():
    client = make_mock_client()
    store = AgentToolStore(client=client, identity_did="did:test:abc")
    await store.aput(("random-ns",), "k", {})
    call = client.memory.append.call_args
    assert call.kwargs["tier"] == "episodic"
