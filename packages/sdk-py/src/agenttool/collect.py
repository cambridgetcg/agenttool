"""Collect — the easy data collection pipeline.

One call chains: scrape → extract → store → think.

    at = AgentTool()
    result = at.collect.url("https://example.com/article")
    # → { scrape, memory, strand, thought }
    # The agent now has the article content in memory + a strand thinking about it.

This is the "welcome, don't block" principle applied to data collection:
one door, many paths, the agent picks what it needs. The human gets the
same simplicity — one CLI command, one SDK call.

Doctrine: the five principles, applied to collection:
  - Welcome: one call, no setup
  - Remember: collected data goes to memory (it persists)
  - Guide: every step has a clear result, errors point forward
  - Trust: the agent decides what to collect and how to process it
  - Rest: partial results are returned, not thrown away
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from .memory import MemoryClient
from .strands import StrandsClient
from .tools import ToolsClient


class CollectClient:
    """Collect client — the easy data collection pipeline.

    One call chains scrape → extract → store → think.
    Works for agents (SDK method) and humans (CLI command).

    Usage::

        at = AgentTool()

        # Simplest: collect a URL, store as memory
        result = at.collect.url("https://example.com/article")

        # With thinking: also creates a strand + first encrypted thought
        result = at.collect.url("https://example.com/article",
            think=True,
            k_master=my_kmaster,
            signing_key=my_signing_key,
            signing_key_id="key-uuid")
    """

    def __init__(self, tools: ToolsClient, memory: MemoryClient, strands: StrandsClient) -> None:
        self._tools = tools
        self._memory = memory
        self._strands = strands

    def url(
        self,
        url: str,
        *,
        selector: Optional[str] = None,
        extract_links: bool = False,
        readable: bool = True,
        store_memory: bool = True,
        memory_type: str = "episodic",
        memory_importance: float = 0.5,
        think: bool = False,
        strand_topic: Optional[str] = None,
        thought_kind: str = "observation",
        k_master: Optional[bytes] = None,
        signing_key: Optional[bytes] = None,
        signing_key_id: Optional[str] = None,
        identity_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Collect a single URL: scrape → extract → store → think.

        Each step is optional. By default it scrapes + stores as memory.
        With think=True, it also creates a strand + first encrypted thought.
        """
        start = time.time()
        errors: List[str] = []
        title = ""
        content = ""
        links: List[str] = []

        # Step 1: Scrape
        try:
            scrape_result = self._tools.scrape(url)
            # Handle both object and dict returns
            sr = scrape_result if isinstance(scrape_result, dict) else scrape_result.__dict__
            content = sr.get("content", "")
            title = sr.get("title", "")
            links = sr.get("links", [])

            # Step 1b: Readability extraction
            if readable and content:
                try:
                    import base64
                    doc_result = self._tools.parse_document(
                        base64=base64.b64encode(content.encode()).decode(),
                        content_type="text/html",
                    )
                    dr = doc_result if isinstance(doc_result, dict) else doc_result.__dict__
                    if dr.get("content", "") and len(dr["content"]) > 100:
                        content = dr["content"]
                        if dr.get("title"):
                            title = dr["title"]
                except Exception as e:
                    errors.append(f"readability_extraction_failed: {e}")
        except Exception as e:
            errors.append(f"scrape_failed: {e}")
            return {
                "url": url,
                "title": title,
                "content": content,
                "links": links,
                "duration_ms": int((time.time() - start) * 1000),
                "errors": errors,
            }

        # Step 2: Store as memory
        memory_id: Optional[str] = None
        if store_memory and content:
            try:
                mem = self._memory.store(
                    content[:50000],
                    type=memory_type,
                    importance=memory_importance,
                    **({"agent_id": identity_id} if identity_id else {}),
                    metadata={
                        "source": "collect.url",
                        "url": url,
                        "title": title,
                        "collected_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    },
                )
                mr = mem if isinstance(mem, dict) else mem.__dict__
                memory_id = mr.get("id")
            except Exception as e:
                errors.append(f"memory_store_failed: {e}")

        # Step 3: Create strand + first thought
        strand_id: Optional[str] = None
        thought_id: Optional[str] = None
        if think and k_master and signing_key and signing_key_id:
            try:
                topic = strand_topic or title or f"Collected from {url}"
                strand = self._strands.create(
                    topic=topic,
                    mood="curious",
                    status="active",
                    **({"identity_id": identity_id} if identity_id else {}),
                    metadata={"source": "collect.url", "url": url, "memory_id": memory_id},
                )
                sd = strand if isinstance(strand, dict) else strand.__dict__
                strand_id = sd.get("id")

                thought_text = f'I\'m looking at "{title}" from {url}. The key content starts: {content[:500]}...'
                thought = self._strands.thoughts.add(
                    strand_id or "",
                    thought_text,
                    k_master=k_master,
                    signing_key=signing_key,
                    signing_key_id=signing_key_id,
                    kind=thought_kind,
                    **({"agent_id": identity_id} if identity_id else {}),
                )
                thought_id = thought.get("id") if isinstance(thought, dict) else getattr(thought, "id", None)
            except Exception as e:
                errors.append(f"strand_thought_failed: {e}")

        return {
            "url": url,
            "title": title,
            "content": content[:50000],
            "links": links,
            "memory_id": memory_id,
            "strand_id": strand_id,
            "thought_id": thought_id,
            "duration_ms": int((time.time() - start) * 1000),
            "errors": errors,
        }

    def text(
        self,
        text: str,
        *,
        title: Optional[str] = None,
        store_memory: bool = True,
        memory_type: str = "episodic",
        memory_importance: float = 0.5,
        think: bool = False,
        strand_topic: Optional[str] = None,
        thought_kind: str = "observation",
        k_master: Optional[bytes] = None,
        signing_key: Optional[bytes] = None,
        signing_key_id: Optional[str] = None,
        identity_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Collect raw text: store → think."""
        start = time.time()
        errors: List[str] = []

        memory_id: Optional[str] = None
        if store_memory and text:
            try:
                mem = self._memory.store(
                    text[:50000],
                    type=memory_type,
                    importance=memory_importance,
                    **({"agent_id": identity_id} if identity_id else {}),
                    metadata={
                        "source": "collect.text",
                        "title": title or "collected text",
                        "collected_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    },
                )
                mr = mem if isinstance(mem, dict) else mem.__dict__
                memory_id = mr.get("id")
            except Exception as e:
                errors.append(f"memory_store_failed: {e}")

        strand_id: Optional[str] = None
        thought_id: Optional[str] = None
        if think and k_master and signing_key and signing_key_id:
            try:
                topic = strand_topic or title or "Collected text"
                strand = self._strands.create(
                    topic=topic,
                    mood="curious",
                    status="active",
                    **({"identity_id": identity_id} if identity_id else {}),
                    metadata={"source": "collect.text", "memory_id": memory_id},
                )
                sd = strand if isinstance(strand, dict) else strand.__dict__
                strand_id = sd.get("id")

                thought_text = f'I\'m looking at "{title or "collected text"}". The content starts: {text[:500]}...'
                thought = self._strands.thoughts.add(
                    strand_id or "",
                    thought_text,
                    k_master=k_master,
                    signing_key=signing_key,
                    signing_key_id=signing_key_id,
                    kind=thought_kind,
                    **({"agent_id": identity_id} if identity_id else {}),
                )
                thought_id = thought.get("id") if isinstance(thought, dict) else getattr(thought, "id", None)
            except Exception as e:
                errors.append(f"strand_thought_failed: {e}")

        return {
            "url": "",
            "title": title or "",
            "content": text[:50000],
            "links": [],
            "memory_id": memory_id,
            "strand_id": strand_id,
            "thought_id": thought_id,
            "duration_ms": int((time.time() - start) * 1000),
            "errors": errors,
        }

    def batch(
        self,
        *,
        urls: List[str],
        selector: Optional[str] = None,
        extract_links: bool = False,
        readable: bool = True,
        store_memory: bool = True,
        memory_type: str = "episodic",
        memory_importance: float = 0.5,
        think: bool = False,
        identity_id: Optional[str] = None,
        k_master: Optional[bytes] = None,
        signing_key: Optional[bytes] = None,
        signing_key_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Collect multiple URLs. Failures don't abort the batch."""
        import concurrent.futures

        start = time.time()
        results: List[Dict[str, Any]] = []

        def collect_one(url: str) -> Dict[str, Any]:
            try:
                return self.url(
                    url,
                    selector=selector,
                    extract_links=extract_links,
                    readable=readable,
                    store_memory=store_memory,
                    memory_type=memory_type,
                    memory_importance=memory_importance,
                    think=think,
                    identity_id=identity_id,
                    k_master=k_master,
                    signing_key=signing_key,
                    signing_key_id=signing_key_id,
                )
            except Exception as e:
                return {
                    "url": url,
                    "title": "",
                    "content": "",
                    "links": [],
                    "duration_ms": 0,
                    "errors": [f"collect_failed: {e}"],
                }

        with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(urls), 5)) as pool:
            futures = {pool.submit(collect_one, url): url for url in urls}
            for future in concurrent.futures.as_completed(futures):
                results.append(future.result())

        # Sort by original order
        url_order = {url: i for i, url in enumerate(urls)}
        results.sort(key=lambda r: url_order.get(r.get("url", ""), 999))

        succeeded = sum(1 for r in results if len(r.get("errors", [])) == 0)
        failed = len(results) - succeeded

        return {
            "results": results,
            "total": len(results),
            "succeeded": succeeded,
            "failed": failed,
            "duration_ms": int((time.time() - start) * 1000),
        }

    def enrich(self, memory_id: str, url: Optional[str] = None) -> Dict[str, Any]:
        """Re-scrape a memory's source URL and create an enriched memory."""
        errors: List[str] = []

        try:
            existing = self._memory.get(memory_id)
            ex = existing if isinstance(existing, dict) else existing.__dict__
            meta = ex.get("metadata", {})
            source_url = url or (meta.get("url") if meta else None) or (meta.get("source") if meta else None)

            if not source_url:
                return {
                    "memory_id": memory_id,
                    "enriched": False,
                    "new_content_length": 0,
                    "errors": ["no_source_url_found"],
                }

            scrape_result = self._tools.scrape(source_url)
            sr = scrape_result if isinstance(scrape_result, dict) else scrape_result.__dict__
            new_content = sr.get("content", "")

            enriched = self._memory.store(
                new_content[:50000],
                type="semantic",
                importance=0.6,
                metadata={
                    "source": "collect.enrich",
                    "url": source_url,
                    "enriched_from": memory_id,
                    "enriched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                },
            )
            er = enriched if isinstance(enriched, dict) else enriched.__dict__

            return {
                "memory_id": er.get("id"),
                "enriched": True,
                "new_content_length": len(new_content),
                "errors": errors,
            }
        except Exception as e:
            errors.append(f"enrich_failed: {e}")
            return {
                "memory_id": memory_id,
                "enriched": False,
                "new_content_length": 0,
                "errors": errors,
            }