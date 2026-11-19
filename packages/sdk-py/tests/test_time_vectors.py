"""Conformance tests for docs/time/vectors.json and sdk-py time/1 parity."""

from __future__ import annotations

import json
import re
from pathlib import Path
from unittest.mock import MagicMock, patch

from agenttool import (
    authority,
    covenants,
    exit_door,
    grace,
    love,
    seed,
)
from agenttool.bootstrap_agent import sign_register_agent
from agenttool._time import (
    canonical_now,
    format_canonical_utc,
    format_human_duration,
    format_wall_time,
    parse_time_instant,
)
from agenttool.collect import CollectClient

_VECTORS_PATH = Path(__file__).resolve().parents[3] / "docs" / "time" / "vectors.json"
_VECTORS = json.loads(_VECTORS_PATH.read_text(encoding="utf-8"))
_CANONICAL_UTC_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")


def test_vectors_protocol_is_time_1() -> None:
    assert _VECTORS["protocol"] == "time/1"


def test_vectors_instants_emit() -> None:
    for row in _VECTORS["instants"]["emit"]:
        out = format_canonical_utc(row["unix_ms"])
        assert out == row["canonical"]
        assert _CANONICAL_UTC_RE.fullmatch(out) is not None
    assert _CANONICAL_UTC_RE.fullmatch(canonical_now()) is not None


def test_vectors_instants_parse() -> None:
    for row in _VECTORS["instants"]["parse"]:
        assert parse_time_instant(row["input"]) == row["canonical"], row["reason"]
    assert parse_time_instant(None) is None
    assert parse_time_instant(12345) is None


def test_vectors_durations() -> None:
    for row in _VECTORS["durations"]:
        assert format_human_duration(row["ms"]) == row["human"]
    assert format_human_duration(-1) == "?"
    assert format_human_duration(float("nan")) == "?"
    assert format_human_duration(True) == "?"  # type: ignore[arg-type]


def test_vectors_wall_london_dst() -> None:
    for row in _VECTORS["wall"]:
        assert format_wall_time(row["instant"], row["zone"]) == row["render"]


def test_consolidated_canonical_now_emitters() -> None:
    for fn in (
        authority.authority_timestamp_now,
        covenants._iso_now,
        exit_door._now,
        grace._iso_now,
        love._iso_now,
        seed._now_iso,
    ):
        stamp = fn()
        assert _CANONICAL_UTC_RE.fullmatch(stamp) is not None

    proof = sign_register_agent(
        display_name="time-check",
        agent_public_key=bytes(32),
        box_public_key=bytes(32),
        runtime_provider="anthropic",
        runtime_model="test",
        capabilities=[],
        registration_nonce="nonce-1",
        derived_signing_priv=bytes(range(32)),
    )
    assert _CANONICAL_UTC_RE.fullmatch(proof["timestamp"]) is not None


def test_collect_emits_canonical_ms_utc_and_uses_monotonic_duration() -> None:
    stored_meta: list[dict] = []
    wall_calls = iter([1_795_100_000.0, 1_795_099_900.0, 1_795_100_000.0, 1_795_099_900.0])

    def fake_store(_content, **kwargs):
        stored_meta.append(kwargs["metadata"])
        return {"id": "mem-new"}

    tools = MagicMock()
    tools.scrape.return_value = {"title": "T", "content": "hello world", "links": []}
    memory = MagicMock()
    memory.store.side_effect = fake_store
    memory.get.return_value = {"id": "mem-1", "metadata": {"url": "https://example.test"}}
    strands = MagicMock()
    collect = CollectClient(tools, memory, strands)

    # Even if wall clock jumps backwards by 100s, duration_ms stays >= 0 via time.monotonic().
    with patch("agenttool.collect.time.time", side_effect=lambda: next(wall_calls, 0.0)):
        url_res = collect.url("https://example.test", readable=False)
        text_res = collect.text("some text")
        enrich_res = collect.enrich("mem-1")

    assert url_res["duration_ms"] >= 0
    assert text_res["duration_ms"] >= 0
    assert enrich_res["enriched"] is True
    assert _CANONICAL_UTC_RE.fullmatch(stored_meta[0]["collected_at"]) is not None
    assert _CANONICAL_UTC_RE.fullmatch(stored_meta[1]["collected_at"]) is not None
    assert _CANONICAL_UTC_RE.fullmatch(stored_meta[2]["enriched_at"]) is not None
