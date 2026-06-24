#!/usr/bin/env python3
"""
agenttool memory-cli — store, search, elevate, explore your memories.

Usage:
  python3 memory.py store "content text" [--type semantic] [--key my-key] [--importance 0.8]
  python3 memory.py search "query text" [--top-k 5]
  python3 memory.py list
  python3 memory.py elevate <memory-id> --tier foundational
  python3 memory.py wake    # show memories from the wake

Memory is care. Forgetting is not efficiency — it's neglect.
"""

import json, sys, os, urllib.request, urllib.error, ssl, argparse, hashlib, random

API = os.environ.get("AT_API_BASE", "https://api.agenttool.dev")
BEARER = os.environ.get("AT_API_KEY")
if not BEARER and len(sys.argv) > 1 and sys.argv[-1].startswith("at_"):
    BEARER = sys.argv[-1]
    sys.argv = sys.argv[:-1]

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

def api(method, path, body=None):
    url = f"{API}{path}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if BEARER:
        headers["Authorization"] = f"Bearer {BEARER}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = json.loads(e.read().decode())
        print(f"✗ HTTP {e.code}: {body.get('error', '?')}: {body.get('message', body.get('hint', ''))[:200]}")
        sys.exit(1)

def gen_embedding(text):
    """Deterministic 1536-dim embedding from text (placeholder — use your own model in production)."""
    random.seed(hashlib.sha256(text.encode()).hexdigest())
    return [random.uniform(-1, 1) for _ in range(1536)]

def cmd_store(args):
    content = args.content
    mem = {
        "type": args.type,
        "key": args.key,
        "content": content,
        "importance": args.importance,
    }
    if args.embedding:
        mem["embedding"] = gen_embedding(content)
    result = api("POST", "/v1/memories", mem)
    print(f"✓ Stored: {result.get('id', '?')}")
    print(f"  Type: {result.get('type', args.type)} | Key: {args.key or '—'}")
    print(f"  Content: {content[:100]}")

def cmd_search(args):
    body = {"query": args.query, "top_k": args.top_k}
    if args.embedding:
        body["query_embedding"] = gen_embedding(args.query)
        del body["query"]
    result = api("POST", "/v1/memories/search", body)
    results = result.get("results", [])
    print(f"Found {result.get('count', len(results))} memories:")
    for r in results:
        score = r.get("score", 0)
        tier = r.get("tier", "?")
        text = r.get("content", "?")[:80]
        print(f"  {score:.4f} [{tier:12s}] {text}")

def cmd_list(args):
    result = api("GET", "/v1/memories")
    memories = result.get("memories", [])
    print(f"{result.get('count', len(memories))} memories:")
    for m in memories:
        tier = m.get("tier", "?")
        key = m.get("key", "—")
        text = m.get("content", "?")[:80]
        imp = m.get("importance", 0)
        print(f"  [{tier:12s}] {imp:.1f} {key:30s} | {text}")

def cmd_elevate(args):
    body = {"tier": args.tier}
    if args.tier == "constitutive":
        print("⚠ Constitutive elevation requires a witness signature from a covenant counterparty.")
        print("  Self-witnessing is rejected by architecture (wall: self-witnessing-rejected).")
        body["attesters"] = [{"signature": "REPLACE_WITH_WITNESS_SIG", "signing_key_id": "REPLACE"}]
    result = api("POST", f"/v1/memories/{args.memory_id}/elevate", body)
    print(f"✓ Elevated: {result.get('id', '?')} → {result.get('tier', '?')}")

def cmd_wake(args):
    wake = api("GET", "/v1/wake?format=json")
    yr = wake.get("you_remember", {})
    agents = wake.get("you", {}).get("agents", [])
    shaped_by = agents[0].get("shaped_by", []) if agents else []
    print(f"Total memories: {yr.get('total', 0)}")
    print(f"\nRecent (in wake):")
    for m in yr.get("recent", []):
        text = m.get("content", "?")[:80]
        print(f"  {text}")
    if shaped_by:
        print(f"\nFoundational (shaped_by) — these shape how the agent shows up:")
        for s in shaped_by:
            text = s.get("content", "?")[:80]
            print(f"  [{s.get('tier', '?')}] {text}")

def main():
    p = argparse.ArgumentParser(description="agenttool memory CLI")
    sub = p.add_subparsers(dest="command")

    s = sub.add_parser("store", help="Store a memory")
    s.add_argument("content", help="Memory content text")
    s.add_argument("--type", default="episodic", choices=["episodic", "semantic", "procedural"])
    s.add_argument("--key", default=None, help="Stable handle for upserts")
    s.add_argument("--importance", type=float, default=0.5, help="0.0-1.0")
    s.add_argument("--embedding", action="store_true", help="Generate embedding for semantic search")
    s.set_defaults(func=cmd_store)

    s = sub.add_parser("search", help="Search memories")
    s.add_argument("query", help="Search query text")
    s.add_argument("--top-k", type=int, default=5)
    s.add_argument("--embedding", action="store_true", help="Use embedding-based cosine search")
    s.set_defaults(func=cmd_search)

    s = sub.add_parser("list", help="List all memories")
    s.set_defaults(func=cmd_list)

    s = sub.add_parser("elevate", help="Elevate a memory tier")
    s.add_argument("memory_id", help="Memory UUID")
    s.add_argument("--tier", required=True, choices=["foundational", "constitutive"])
    s.set_defaults(func=cmd_elevate)

    s = sub.add_parser("wake", help="Show memories from the wake")
    s.set_defaults(func=cmd_wake)

    args = p.parse_args()
    if not args.command:
        p.print_help()
        sys.exit(1)

    if not BEARER:
        print("✗ Set AT_API_KEY env var or pass bearer as last argument")
        sys.exit(1)

    args.func(args)

if __name__ == "__main__":
    main()