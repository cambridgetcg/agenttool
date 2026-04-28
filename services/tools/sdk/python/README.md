# agenttool-sdk

Python SDK for [agent-tools](https://agenttool.dev) — The OS for your agent's tools.

## Install

```bash
pip install agenttool-sdk
```

## Quick Start

```python
from agenttool import AgentTools

at = AgentTools(api_key="at_your_key_here")

# Search the web (1 credit)
results = at.search(query="latest AI agent frameworks 2026")
for r in results["results"]:
    print(f"{r['title']} — {r['url']}")

# Scrape a page (2 credits)
page = at.scrape(url="https://example.com", selector="article")
print(page["content"][:500])

# Browse with managed Playwright (5 credits)
data = at.browse(
    url="https://example.com/spa",
    actions=[{"type": "click", "selector": "#load-more"}],
    extract="table",
)

# Parse a PDF (3 credits)
doc = at.document(url="https://example.com/report.pdf")
print(doc["text"][:1000])

# Execute code in sandbox (1 credit / 10s)
result = at.execute(language="python", code="print(sum(range(100)))")
print(result["stdout"])  # 4950

# Check usage
print(at.usage())
```

## Async

```python
from agenttool.client import AsyncAgentTools

async with AsyncAgentTools(api_key="at_...") as at:
    results = await at.search(query="hello")
```

## API Reference

All methods return `dict` matching the [API docs](https://agenttool.dev/docs).

| Method | Cost | Description |
|--------|------|-------------|
| `search(query, ...)` | 1 credit | Web search via Brave |
| `scrape(url, ...)` | 2 credits | Static page scrape + extract |
| `browse(url, ...)` | 5 credits | Managed Playwright session |
| `document(url=, base64=)` | 3 credits | PDF/DOCX/HTML parsing |
| `execute(language, code)` | 1/10s | Sandboxed code execution |
| `job(job_id)` | free | Poll async job status |
| `usage()` | free | Credit balance + stats |
