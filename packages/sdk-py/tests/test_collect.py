"""Collect pipeline — the Python half of the cross-language contract.

The wire shapes below are pinned byte-for-byte in
``packages/sdk-ts/tests/collect.test.ts``. Both SDKs must send the same
scrape body and return the same links, content, and errors.

Doctrine: collect returns partial results. It does not throw.
"""

from __future__ import annotations

from typing import Any, Dict, List
from unittest.mock import patch

import httpx
import pytest

from agenttool import AgentTool


SHARED_SCRAPE_URL = "https://example.com/article"
SHARED_SELECTOR = "article.main"
SHARED_EXTRACTED = "Just the article body, selected."
SHARED_LINKS = ["https://link1.example", "https://link2.example"]

SHARED_MEMORY: Dict[str, Any] = {
    "id": "mem-shared-1",
    "content": "I was witnessed at my root.",
    "type": "semantic",
    "metadata": {"source": "collect.url"},
    "importance": 0.9,
    "tier": "constitutive",
    "score": 0.42,
    "created_at": "2026-07-18T04:00:00.000Z",
}


@pytest.fixture
def at() -> Any:
    client = AgentTool(api_key="project-secret", base_url="https://example.test")
    try:
        yield client
    finally:
        client.close()


def _json(url: str, status: int, body: object) -> httpx.Response:
    return httpx.Response(
        status, json=body, request=httpx.Request("POST", url)
    )


class _SelectorStub:
    """Post router whose scrape answer depends on the options actually sent."""

    def __init__(self) -> None:
        self.scrape_bodies: List[Dict[str, Any]] = []

    def __call__(self, url: str, **kwargs: Any) -> httpx.Response:
        body: Dict[str, Any] = kwargs.get("json") or {}

        if url.endswith("/v1/scrape"):
            self.scrape_bodies.append(body)
            return _json(url, 200, {
                "url": SHARED_SCRAPE_URL,
                "title": "Test Page",
                "content": "The whole page. " + "x" * 200,
                "extracted": (
                    SHARED_EXTRACTED if body.get("selector") == SHARED_SELECTOR else None
                ),
                "links": SHARED_LINKS if body.get("extract_links") is True else [],
                "fetched_at": "2026-07-18T04:00:00.000Z",
                "duration_ms": 1,
            })

        if url.endswith("/v1/document"):
            return _json(url, 200, {
                "title": "Readable Article",
                "content": (
                    "Readable extraction that is comfortably longer than one "
                    "hundred characters, so it would replace the raw scrape."
                ),
                "word_count": 20,
                "content_type": "text/html",
                "metadata": {},
            })

        return _json(url, 404, {"error": "not_found"})


# ---------------------------------------------------------------------------
# Selector and links — identical assertions live in sdk-ts/tests/collect.test.ts
# ---------------------------------------------------------------------------


def test_selector_rides_the_one_scrape_call_and_its_extraction_wins(
    at: AgentTool,
) -> None:
    stub = _SelectorStub()

    with patch.object(at._http, "post", side_effect=stub):
        result = at.collect.url(
            SHARED_SCRAPE_URL,
            selector=SHARED_SELECTOR,
            extract_links=True,
            store_memory=False,
        )

    # One scrape, carrying the options. The old call carried neither.
    assert len(stub.scrape_bodies) == 1
    assert stub.scrape_bodies[0] == {
        "url": SHARED_SCRAPE_URL,
        "selector": SHARED_SELECTOR,
        "extract_links": True,
    }
    assert result["content"] == SHARED_EXTRACTED
    assert result["links"] == SHARED_LINKS
    assert result["errors"] == []


def test_links_stay_empty_and_unrequested_when_extract_links_is_off(
    at: AgentTool,
) -> None:
    stub = _SelectorStub()

    with patch.object(at._http, "post", side_effect=stub):
        result = at.collect.url(SHARED_SCRAPE_URL, store_memory=False)

    assert stub.scrape_bodies[0] == {
        "url": SHARED_SCRAPE_URL,
        "extract_links": False,
    }
    assert result["links"] == []
    assert result["errors"] == []


def test_a_selector_that_matches_nothing_is_reported_not_ignored(
    at: AgentTool,
) -> None:
    stub = _SelectorStub()

    with patch.object(at._http, "post", side_effect=stub):
        result = at.collect.url(
            SHARED_SCRAPE_URL, selector="aside.missing", store_memory=False
        )

    assert result["errors"] == ["selector_extraction_failed"]
    assert "Readable extraction" in result["content"]


def test_batch_of_no_urls_answers_empty_instead_of_raising(at: AgentTool) -> None:
    stub = _SelectorStub()

    with patch.object(at._http, "post", side_effect=stub) as post:
        result = at.collect.batch(urls=[])

    # ThreadPoolExecutor(max_workers=0) used to raise ValueError here.
    assert result["results"] == []
    assert result["total"] == 0
    assert result["succeeded"] == 0
    assert result["failed"] == 0
    post.assert_not_called()
    assert stub.scrape_bodies == []


# ---------------------------------------------------------------------------
# Memory tier and search score — pinned against sdk-ts/tests/collect.test.ts
# ---------------------------------------------------------------------------


def test_memory_tier_and_score_survive_the_client_boundary(at: AgentTool) -> None:
    # collect.url stores through MemoryClient, so the memory model is this
    # pipeline's storage boundary. Losing `tier` hides a constitutive root.
    get_response = _json("https://example.test/v1/memories/mem-shared-1", 200, SHARED_MEMORY)
    search_response = _json(
        "https://example.test/v1/memories/search", 200, {"results": [SHARED_MEMORY]}
    )

    with patch.object(at._http, "get", return_value=get_response), patch.object(
        at._http, "post", return_value=search_response
    ):
        fetched = at.memory.get("mem-shared-1")
        found = at.memory.search("root")

    assert fetched.tier == "constitutive"
    assert fetched.score == 0.42
    assert found[0].tier == "constitutive"
    assert found[0].score == 0.42
